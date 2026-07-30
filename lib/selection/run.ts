import { prisma } from "@/lib/db";
import { HeuristicContentSelector } from "./heuristic";
import { LlmContentSelector } from "./llm-selector";
import { runVisionAnalysis } from "@/lib/vision/run";
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
      mediaAssets: { include: { transcript: true, visualAnalysis: true } },
    },
  });

  const candidates: CandidateSegment[] = [];
  for (const asset of project.mediaAssets) {
    const visualSummary = asset.visualAnalysis?.summary ?? null;
    const visualTags = asset.visualAnalysis
      ? (JSON.parse(asset.visualAnalysis.tagsJson) as string[])
      : [];

    const segments = asset.transcript
      ? (JSON.parse(asset.transcript.segmentsJson) as {
          startSec: number;
          endSec: number;
          text: string;
        }[])
      : [];

    if (segments.length > 0) {
      for (const segment of segments) {
        candidates.push({
          mediaAssetId: asset.id,
          filePath: asset.filePath,
          startSec: segment.startSec,
          endSec: segment.endSec,
          text: segment.text,
          visualSummary,
          visualTags,
        });
      }
    } else if (asset.visualAnalysis && asset.durationSec) {
      // No speech at all (silent B-roll, or nothing Whisper could transcribe)
      // — without this, a clip like that is invisible to selection no matter
      // how visually relevant it is. One candidate spanning the full clip.
      candidates.push({
        mediaAssetId: asset.id,
        filePath: asset.filePath,
        startSec: 0,
        endSec: asset.durationSec,
        text: "",
        visualSummary,
        visualTags,
      });
    }
  }

  const selected = await selector.select({
    brief: project.brief,
    outputProfile: project.outputProfile,
    targetDurationSec: PROFILE_TARGET_SECONDS[project.outputProfile],
    candidates,
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
