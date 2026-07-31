import { prisma } from "@/lib/db";
import { ClaudeVisionAnalyzer } from "./claude-vision";
import { getAssetSegments } from "@/lib/selection/segments";
import type { VisionAnalyzer } from "./types";

export type VisionSummary = {
  analyzed: number;
  skipped: number;
  failed: { filePath: string; startSec: number; endSec: number; error: string }[];
};

// Same duplicate-invocation hazard as transcription — see run.ts there.
const inFlight = new Set<string>();

type PendingSegment = {
  mediaAssetId: string;
  filePath: string;
  durationSec: number;
  startSec: number;
  endSec: number;
};

/**
 * Describes, visually, every not-yet-analyzed (asset, time range) pair in the
 * project. The unit of work is a segment, not a file: a long clip covered by
 * several transcript segments gets one vision call per segment, so two
 * moments in the same file can end up with different descriptions instead of
 * all sharing one file-level summary (see CLAUDE.md task #45). Audio-only
 * assets have nothing to look at and are skipped.
 */
export async function runVisionAnalysis(
  projectId: string,
  analyzer: VisionAnalyzer = new ClaudeVisionAnalyzer(),
): Promise<VisionSummary> {
  if (inFlight.has(projectId)) {
    return { analyzed: 0, skipped: 0, failed: [] };
  }
  inFlight.add(projectId);
  try {
    return await runVisionAnalysisInner(projectId, analyzer);
  } finally {
    inFlight.delete(projectId);
  }
}

/** Exact-match key for "have we already analyzed this range of this asset." */
function segmentKey(startSec: number, endSec: number): string {
  return `${startSec}:${endSec}`;
}

async function runVisionAnalysisInner(
  projectId: string,
  analyzer: VisionAnalyzer,
): Promise<VisionSummary> {
  const assets = await prisma.mediaAsset.findMany({
    where: { projectId },
    include: {
      transcript: true,
      visualAnalyses: { select: { startSec: true, endSec: true } },
    },
    orderBy: { filePath: "asc" },
  });

  const summary: VisionSummary = { analyzed: 0, skipped: 0, failed: [] };
  const pending: PendingSegment[] = [];

  for (const asset of assets) {
    if (asset.kind !== "VIDEO" || asset.durationSec === null) {
      summary.skipped += 1;
      continue;
    }

    const alreadyAnalyzed = new Set(
      asset.visualAnalyses.map((v) => segmentKey(v.startSec, v.endSec)),
    );

    for (const segment of getAssetSegments(asset)) {
      if (alreadyAnalyzed.has(segmentKey(segment.startSec, segment.endSec))) {
        continue;
      }
      pending.push({
        mediaAssetId: asset.id,
        filePath: asset.filePath,
        durationSec: asset.durationSec,
        startSec: segment.startSec,
        endSec: segment.endSec,
      });
    }
  }

  async function saveAnalysis(
    seg: PendingSegment,
    result: {
      engine: string;
      summary: string;
      shotType: string | null;
      tags: string[];
      qualityNotes: string | null;
    },
  ) {
    await prisma.visualAnalysis.create({
      data: {
        mediaAssetId: seg.mediaAssetId,
        startSec: seg.startSec,
        endSec: seg.endSec,
        engine: result.engine,
        summary: result.summary,
        shotType: result.shotType,
        tagsJson: JSON.stringify(result.tags),
        qualityNotes: result.qualityNotes,
      },
    });
  }

  if (analyzer.describeMany) {
    const outcomes = await analyzer.describeMany(
      pending.map((s) => ({
        filePath: s.filePath,
        durationSec: s.durationSec,
        segmentStartSec: s.startSec,
        segmentEndSec: s.endSec,
      })),
    );
    // Positional correlation, not a filePath map — the same file appears
    // once per segment, so a filePath-keyed lookup would collide and only
    // keep the last segment's outcome. See VisionAnalyzer.describeMany.
    for (let i = 0; i < pending.length; i++) {
      const seg = pending[i];
      const outcome = outcomes[i];
      if (!outcome.ok) {
        summary.failed.push({
          filePath: seg.filePath,
          startSec: seg.startSec,
          endSec: seg.endSec,
          error: outcome.error,
        });
        continue;
      }
      try {
        await saveAnalysis(seg, outcome.result);
        summary.analyzed += 1;
      } catch (error) {
        summary.failed.push({
          filePath: seg.filePath,
          startSec: seg.startSec,
          endSec: seg.endSec,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } else {
    for (const seg of pending) {
      try {
        const result = await analyzer.describeClip({
          filePath: seg.filePath,
          durationSec: seg.durationSec,
          segmentStartSec: seg.startSec,
          segmentEndSec: seg.endSec,
        });
        await saveAnalysis(seg, result);
        summary.analyzed += 1;
      } catch (error) {
        summary.failed.push({
          filePath: seg.filePath,
          startSec: seg.startSec,
          endSec: seg.endSec,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return summary;
}
