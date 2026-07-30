import { prisma } from "@/lib/db";
import { ClaudeVisionAnalyzer } from "./claude-vision";
import type { VisionAnalyzer } from "./types";

export type VisionSummary = {
  analyzed: number;
  skipped: number;
  failed: { filePath: string; error: string }[];
};

// Same duplicate-invocation hazard as transcription — see run.ts there.
const inFlight = new Set<string>();

/**
 * Describes, visually, every video asset in the project that doesn't have an
 * analysis yet. Audio-only assets have nothing to look at and are skipped.
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

async function runVisionAnalysisInner(
  projectId: string,
  analyzer: VisionAnalyzer,
): Promise<VisionSummary> {
  const assets = await prisma.mediaAsset.findMany({
    where: { projectId, visualAnalysis: null },
    orderBy: { filePath: "asc" },
  });

  const summary: VisionSummary = { analyzed: 0, skipped: 0, failed: [] };

  const pending = assets.filter((asset) => {
    if (asset.kind !== "VIDEO" || asset.durationSec === null) {
      summary.skipped += 1;
      return false;
    }
    return true;
  });

  async function saveAnalysis(mediaAssetId: string, result: {
    engine: string;
    summary: string;
    shotType: string | null;
    tags: string[];
    qualityNotes: string | null;
  }) {
    await prisma.visualAnalysis.create({
      data: {
        mediaAssetId,
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
      pending.map((a) => ({ filePath: a.filePath, durationSec: a.durationSec as number })),
    );
    const byPath = new Map(pending.map((a) => [a.filePath, a]));
    for (const outcome of outcomes) {
      const asset = byPath.get(outcome.filePath);
      if (!asset) continue;
      if (!outcome.ok) {
        summary.failed.push({ filePath: outcome.filePath, error: outcome.error });
        continue;
      }
      try {
        await saveAnalysis(asset.id, outcome.result);
        summary.analyzed += 1;
      } catch (error) {
        summary.failed.push({
          filePath: outcome.filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } else {
    for (const asset of pending) {
      try {
        const result = await analyzer.describeClip({
          filePath: asset.filePath,
          durationSec: asset.durationSec as number,
        });
        await saveAnalysis(asset.id, result);
        summary.analyzed += 1;
      } catch (error) {
        summary.failed.push({
          filePath: asset.filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return summary;
}
