import { prisma } from "@/lib/db";
import { HeuristicContentSelector } from "./heuristic";
import { LlmContentSelector } from "./llm-selector";
import { runVisionAnalysis } from "@/lib/vision/run";
import { getAssetSegments } from "./segments";
import {
  PROFILE_TARGET_SECONDS,
  type CandidateSegment,
  type ContentSelector,
} from "./types";

export type SelectionSummary = {
  selector: string;
  candidates: number;
  selected: number;
  totalDurationSec: number;
};

function resolveDefaultSelector(): ContentSelector {
  // Auto-upgrades once ANTHROPIC_API_KEY exists — same button, no new UI.
  // See CLAUDE.md, "Budget / LLM sizing".
  return process.env.ANTHROPIC_API_KEY
    ? new LlmContentSelector()
    : new HeuristicContentSelector();
}

export async function runContentSelection(
  projectId: string,
  selector: ContentSelector = resolveDefaultSelector(),
): Promise<SelectionSummary> {
  // Visual analysis is an input to selection, not a separate approval step —
  // the user approves the resulting picks, not "does this clip show tea
  // being poured." Best-effort: a failed/missing vision pass still leaves
  // transcript-based candidates usable.
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      await runVisionAnalysis(projectId);
    } catch {
      // Selection proceeds on transcript-only candidates for whatever
      // couldn't be visually analyzed.
    }
  }

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: {
      mediaAssets: { include: { transcript: true, visualAnalyses: true } },
    },
  });

  const candidates: CandidateSegment[] = [];
  for (const asset of project.mediaAssets) {
    for (const segment of getAssetSegments(asset)) {
      // Exact-range match: vision analysis is keyed on the very same segment
      // boundaries this function computes, so different moments in one long
      // clip carry their own description instead of sharing a file-level one
      // (see CLAUDE.md task #45).
      const visual = asset.visualAnalyses.find(
        (v) => v.startSec === segment.startSec && v.endSec === segment.endSec,
      );
      const visualSummary = visual?.summary ?? null;
      const visualTags = visual ? (JSON.parse(visual.tagsJson) as string[]) : [];
      const visualShotType = visual?.shotType ?? null;

      if (segment.text === "") {
        // No speech at all (silent B-roll, or nothing Whisper could
        // transcribe) — without visual proof this segment is worth nothing
        // to a selector, so only add it once vision analysis has run.
        if (!visual) continue;
      }

      candidates.push({
        mediaAssetId: asset.id,
        filePath: asset.filePath,
        startSec: segment.startSec,
        endSec: segment.endSec,
        text: segment.text,
        visualSummary,
        visualTags,
        visualShotType,
      });
    }
  }

  const {
    selections: selected,
    premise,
    beatPlan,
    shortlist,
  } = await selector.select({
    brief: project.brief,
    outputProfile: project.outputProfile,
    targetDurationSec: PROFILE_TARGET_SECONDS[project.outputProfile],
    candidates,
  });
  // Tag each shortlist entry with whether (and where) it ended up in the
  // final cut, so the UI can show "considered but not used" alongside
  // "picked" without a second lookup.
  const shortlistWithStatus = shortlist?.map((c) => {
    const match = selected.find(
      (s) =>
        s.mediaAssetId === c.mediaAssetId &&
        s.startSec === c.startSec &&
        s.endSec === c.endSec,
    );
    return { ...c, chosenOrder: match?.order ?? null };
  });

  // Selection is a re-runnable decision, not an accumulating log — replace the
  // previous pass rather than stacking duplicates.
  await prisma.$transaction([
    prisma.selection.deleteMany({ where: { projectId } }),
    prisma.selection.createMany({
      data: selected.map((s) => ({
        projectId,
        mediaAssetId: s.mediaAssetId,
        startSec: s.startSec,
        endSec: s.endSec,
        order: s.order,
        score: s.score,
        reason: s.reason,
        videoAssetId: s.videoOverride?.mediaAssetId ?? null,
        videoStartSec: s.videoOverride?.startSec ?? null,
        videoEndSec: s.videoOverride?.endSec ?? null,
      })),
    }),
    prisma.project.update({
      where: { id: projectId },
      data: {
        selectionPremise: premise || null,
        selectionBeatPlan: beatPlan ? JSON.stringify(beatPlan) : null,
        selectionShortlistJson: shortlistWithStatus
          ? JSON.stringify(shortlistWithStatus)
          : null,
      },
    }),
  ]);

  const existing = await prisma.approvalCheckpoint.findFirst({
    where: { projectId, stage: "CONTENT_SELECTION" },
  });
  if (!existing) {
    await prisma.approvalCheckpoint.create({
      data: { projectId, stage: "CONTENT_SELECTION" },
    });
  }

  return {
    selector: selector.name,
    candidates: candidates.length,
    selected: selected.length,
    totalDurationSec:
      Math.round(
        selected.reduce((sum, s) => sum + (s.endSec - s.startSec), 0) * 10,
      ) / 10,
  };
}
