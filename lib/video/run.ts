import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { ClaudeVisionAnalyzer } from "@/lib/vision/claude-vision";
import type { VisionAnalyzer } from "@/lib/vision/types";
import { planLayoutHeuristically } from "./heuristic-layout";
import {
  buildLayoutPrompt,
  layOutSpine,
  parseLayoutPlan,
  validateLayout,
  type LayoutPlacement,
  type ShotCandidate,
} from "./layout-plan";

const MODEL = "claude-sonnet-5";
/**
 * Covers the model's reasoning plus the JSON. Raised from 16000 after the
 * density target pushed a real run past the limit mid-JSON: roughly twenty
 * placements, each with a Hebrew justification, on top of deliberating about
 * angles and coverage. Unlike the documented failure in llm-selector.ts —
 * where a contradicted instruction burned the whole budget on thinking and
 * the fix was removing the contradiction — here the output genuinely is
 * larger, so the budget is the right thing to change.
 */
const MAX_RESPONSE_TOKENS = 32000;

/**
 * How many shots get a vision description, best first.
 *
 * This cap is the whole cost story of the video layer. The deterministic
 * catalogue is free and can index hundreds of spans from ten minutes of
 * wedding footage; describing all of them would not be. Ranking by the free
 * signal first and paying only for the top slice is what keeps the stage
 * affordable — a bad shot is rejected by arithmetic and never reaches a model.
 */
const MAX_DESCRIBED_SHOTS = 40;

export type VideoLayoutSummary = {
  /**
   * Which planner produced the layout. "heuristic" when no API key is set —
   * and also when the model was tried and failed, in which case
   * `fellBackReason` says why rather than letting a downgrade pass silently.
   */
  planner: "llm" | "heuristic";
  /** Null unless the model was attempted and the free planner took over. */
  fellBackReason: string | null;
  spineMoments: number;
  spineDurationSec: number;
  shotsConsidered: number;
  shotsDescribed: number;
  placements: number;
};

const inFlight = new Set<string>();

/**
 * Describes the best shots visually, reusing the existing `VisualAnalysis`
 * table. Its unique key is `(mediaAssetId, startSec, endSec)` and a `Shot`
 * carries exactly those, so a shot's description slots in with no schema
 * change — and re-running never pays twice for the same span.
 */
async function describeShots(
  shots: { id: string; mediaAssetId: string; startSec: number; endSec: number }[],
  assetsById: Map<string, { filePath: string; durationSec: number | null }>,
  analyzer: VisionAnalyzer,
): Promise<Map<string, string>> {
  const existing = await prisma.visualAnalysis.findMany({
    where: { mediaAssetId: { in: [...new Set(shots.map((s) => s.mediaAssetId))] } },
    select: { mediaAssetId: true, startSec: true, endSec: true, summary: true },
  });
  const key = (a: string, s: number, e: number) => `${a}:${s}:${e}`;
  const described = new Map(
    existing.map((v) => [key(v.mediaAssetId, v.startSec, v.endSec), v.summary]),
  );

  const missing = shots.filter(
    (s) => !described.has(key(s.mediaAssetId, s.startSec, s.endSec)),
  );

  if (missing.length > 0 && analyzer.describeMany) {
    const inputs = missing.map((s) => {
      const asset = assetsById.get(s.mediaAssetId)!;
      return {
        filePath: asset.filePath,
        durationSec: asset.durationSec ?? s.endSec,
        segmentStartSec: s.startSec,
        segmentEndSec: s.endSec,
      };
    });

    // Positional, not keyed on filePath: one file contributes many shots, so
    // outcomes[i] answers inputs[i] and nothing else. This is stated in the
    // VisionAnalyzer contract and is easy to get wrong.
    const outcomes = await analyzer.describeMany(inputs);
    for (const [i, outcome] of outcomes.entries()) {
      if (!outcome.ok) continue;
      const s = missing[i];
      described.set(key(s.mediaAssetId, s.startSec, s.endSec), outcome.result.summary);
      await prisma.visualAnalysis.upsert({
        where: {
          mediaAssetId_startSec_endSec: {
            mediaAssetId: s.mediaAssetId,
            startSec: s.startSec,
            endSec: s.endSec,
          },
        },
        create: {
          mediaAssetId: s.mediaAssetId,
          startSec: s.startSec,
          endSec: s.endSec,
          engine: outcome.result.engine,
          summary: outcome.result.summary,
          shotType: outcome.result.shotType,
          tagsJson: JSON.stringify(outcome.result.tags),
          qualityNotes: outcome.result.qualityNotes,
        },
        update: { summary: outcome.result.summary },
      });
    }
  }

  const byShotId = new Map<string, string>();
  for (const s of shots) {
    const summary = described.get(key(s.mediaAssetId, s.startSec, s.endSec));
    if (summary) byShotId.set(s.id, summary);
  }
  return byShotId;
}

/**
 * Dresses the approved audio spine with video.
 *
 * Requires an approved spine (`Selection` rows) and a built shot catalogue
 * (`Shot` rows) — run `runContentSelection` and `runShotCatalogue` first.
 */
export async function runVideoLayout(
  projectId: string,
  /**
   * Left undefined on purpose so the analyzer is constructed lazily. As a
   * default parameter it was built before the function body ran, and its
   * constructor throws without an API key — which defeated the whole point
   * of the no-key fallback below.
   */
  analyzer?: VisionAnalyzer,
): Promise<VideoLayoutSummary> {
  // No key means the free planner, not a dead stage — the same
  // auto-downgrade `resolveDefaultSelector` already does for selection, so
  // the whole pipeline still runs end to end without an Anthropic account.
  // A key that cannot be billed lands in the same place, but only after the
  // call fails; see the try/catch around the model path below.
  const useLlm = Boolean(process.env.ANTHROPIC_API_KEY);
  if (inFlight.has(projectId)) {
    throw new Error("Video layout is already running for this project.");
  }
  inFlight.add(projectId);

  try {
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { outputProfile: true },
    });

    const selections = await prisma.selection.findMany({
      where: { projectId },
      orderBy: { order: "asc" },
      include: { mediaAsset: { select: { filePath: true } } },
    });
    if (selections.length === 0) {
      throw new Error(
        "This project has no audio spine yet — run content selection first.",
      );
    }

    const assets = await prisma.mediaAsset.findMany({
      where: { projectId, kind: "VIDEO" },
      select: { id: true, filePath: true, durationSec: true },
    });
    const assetsById = new Map(assets.map((a) => [a.id, a]));

    const shots = await prisma.shot.findMany({
      where: { mediaAssetId: { in: assets.map((a) => a.id) } },
      orderBy: { qualityScore: "desc" },
      take: MAX_DESCRIBED_SHOTS,
    });
    if (shots.length === 0) {
      throw new Error(
        "This project has no shot catalogue yet — run shot analysis first.",
      );
    }

    // Vision is the expensive half. Without a key there is nothing to spend
    // it on, and the heuristic planner does not read descriptions anyway.
    const descriptions = useLlm
      ? await describeShots(shots, assetsById, analyzer ?? new ClaudeVisionAnalyzer())
      : new Map<string, string>();

    // Positioning the spine is arithmetic: the cut plays its moments back to
    // back, so timeline position is a running total rather than stored state.
    const spine = layOutSpine(
      selections.map((s) => ({
        order: s.order,
        fileName: s.mediaAsset.filePath.split("/").pop() ?? "",
        startSec: s.startSec,
        endSec: s.endSec,
        text: "",
        reason: s.reason ?? "",
      })),
    );
    const totalSec = spine.at(-1)?.timelineEndSec ?? 0;

    // A shot can stay in sync only for a spine moment drawn from the same
    // clip whose source times actually overlap it — otherwise "sync" would
    // show a different part of the take than the one being heard.
    const candidates: ShotCandidate[] = shots.map((shot) => {
      const fileName = assetsById.get(shot.mediaAssetId)?.filePath.split("/").pop() ?? "";
      const isSyncFor = selections
        .filter(
          (s) =>
            s.mediaAssetId === shot.mediaAssetId &&
            s.startSec < shot.endSec &&
            shot.startSec < s.endSec,
        )
        .map((s) => s.order);

      return {
        shotId: shot.id,
        fileName,
        startSec: shot.startSec,
        endSec: shot.endSec,
        qualityScore: shot.qualityScore,
        movementCompleteness: shot.movementCompleteness,
        activity: shot.activity,
        description: descriptions.get(shot.id) ?? null,
        isSyncFor,
      };
    });

    let plan: { placements: LayoutPlacement[] } | null = null;
    /** Set when the model was tried and could not deliver, for the summary. */
    let fellBackReason: string | null = null;

    if (useLlm) {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const basePrompt = buildLayoutPrompt(spine, candidates, project.outputProfile);

      async function requestLayout(prompt: string) {
        // Streamed rather than a plain create(): at this token budget the SDK
        // refuses a non-streaming request outright, because it may run past
        // ten minutes. finalMessage() reassembles the whole response, so
        // nothing downstream has to care that it arrived in pieces.
        const message = await client.messages
          .stream({
            model: MODEL,
            max_tokens: MAX_RESPONSE_TOKENS,
            messages: [{ role: "user", content: prompt }],
          })
          .finalMessage();
        const block = message.content.find((b) => b.type === "text");
        if (!block || block.type !== "text") {
          throw new Error(
            `Layout response had no text block. stop_reason=${message.stop_reason}`,
          );
        }
        if (message.stop_reason === "max_tokens") {
          throw new Error("Layout response was cut off before finishing its JSON.");
        }
        return parseLayoutPlan(block.text);
      }

      // A key that exists but cannot be billed is not the same state as no
      // key, and the difference used to kill the stage: "credit balance is
      // too low" surfaced as a failed run rather than falling back. Having a
      // free path only helps if reaching it does not require predicting the
      // failure in advance, so the fallback is on the error, not on config.
      try {
        plan = await requestLayout(basePrompt);
        let validation = validateLayout(plan, candidates, totalSec);
        if (!validation.ok) {
          // One retry carrying the rejection reason — the same shape the
          // selection stage already uses, and the same reason: a near-miss on
          // coverage arithmetic is usually fixable by saying what was wrong.
          plan = await requestLayout(
            `${basePrompt}\n\nהניסיון הקודם נדחה: ${validation.reason}\nתקן ונסה שוב.`,
          );
          validation = validateLayout(plan, candidates, totalSec);
          if (!validation.ok) {
            throw new Error(
              `Video layout failed validation twice: ${validation.reason}`,
            );
          }
        }
      } catch (err) {
        plan = null;
        fellBackReason = err instanceof Error ? err.message : String(err);
      }
    }

    if (plan === null) {
      plan = planLayoutHeuristically(spine, candidates, project.outputProfile);
      const validation = validateLayout(plan, candidates, totalSec);
      if (!validation.ok) {
        // The heuristic planner is deterministic, so a rejection here is a
        // bug in it rather than a model misbehaving. Say which, so it is not
        // mistaken for an unlucky generation.
        throw new Error(
          `The heuristic layout planner produced an invalid layout: ${validation.reason}`,
        );
      }
    }

    const ordered = [...plan.placements].sort(
      (a, b) => a.timelineStartSec - b.timelineStartSec,
    );

    await prisma.$transaction([
      prisma.videoPlacement.deleteMany({ where: { projectId } }),
      prisma.videoPlacement.createMany({
        data: ordered.map((p, order) => ({
          projectId,
          shotId: candidates[p.index].shotId,
          order,
          timelineStartSec: p.timelineStartSec,
          timelineEndSec: p.timelineEndSec,
          useSourceAudio: p.useSourceAudio ?? false,
          reason: p.reason,
        })),
      }),
    ]);

    return {
      planner: useLlm && fellBackReason === null ? "llm" : "heuristic",
      fellBackReason,
      spineMoments: spine.length,
      spineDurationSec: Math.round(totalSec * 10) / 10,
      shotsConsidered: candidates.length,
      shotsDescribed: descriptions.size,
      placements: ordered.length,
    };
  } finally {
    inFlight.delete(projectId);
  }
}
