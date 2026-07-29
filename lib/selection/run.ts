import { prisma } from "@/lib/db";
import { HeuristicContentSelector } from "./heuristic";
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

export async function runContentSelection(
  projectId: string,
  selector: ContentSelector = new HeuristicContentSelector(),
): Promise<SelectionSummary> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: {
      mediaAssets: { include: { transcript: true } },
    },
  });

  const candidates: CandidateSegment[] = [];
  for (const asset of project.mediaAssets) {
    if (!asset.transcript) continue;

    const segments = JSON.parse(asset.transcript.segmentsJson) as {
      startSec: number;
      endSec: number;
      text: string;
    }[];

    for (const segment of segments) {
      candidates.push({
        mediaAssetId: asset.id,
        filePath: asset.filePath,
        startSec: segment.startSec,
        endSec: segment.endSec,
        text: segment.text,
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
