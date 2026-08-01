import { prisma } from "@/lib/db";
import { analyzeClip } from "./analyze";
import { findShotWindows } from "./windows";
import { DEFAULT_WINDOWING, type ShotWindow, type WindowingOptions } from "./types";

/**
 * How many clips are measured at once. ffmpeg already saturates cores on a
 * single clip, so this is deliberately small — raising it past 3 made no
 * measurable difference on the project's own footage (190s of video analysed
 * in 116s wall clock, 1.6x realtime).
 */
const CONCURRENCY = 3;

/**
 * Guards against the same duplicate-invocation race already documented in
 * `lib/transcription/run.ts`: a button disables on the next render, not
 * synchronously, so a fast double-click can start two analyses of one
 * project. Shot analysis is idempotent thanks to the unique constraint, but
 * running it twice wastes minutes of ffmpeg time for nothing.
 */
const inFlight = new Set<string>();

export type ShotCatalogueResult = {
  clipsAnalyzed: number;
  clipsSkipped: number;
  shotsWritten: number;
};

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await fn(items[index]);
      }
    }),
  );
  return results;
}

async function persistShots(
  mediaAssetId: string,
  windows: ShotWindow[],
): Promise<number> {
  if (windows.length === 0) return 0;

  // Replace rather than merge: window boundaries shift when the scoring
  // settings change, so leaving old rows behind would mix two generations of
  // the catalogue with no way to tell them apart.
  await prisma.shot.deleteMany({ where: { mediaAssetId } });
  const created = await prisma.shot.createMany({
    data: windows.map((w) => ({
      mediaAssetId,
      startSec: w.startSec,
      endSec: w.endSec,
      source: w.source,
      stability: w.stability,
      movementCompleteness: w.movementCompleteness,
      activity: w.activity,
      sharpness: w.sharpness,
      exposure: w.exposure,
      qualityScore: w.qualityScore,
    })),
  });
  return created.count;
}

/**
 * Builds the shot catalogue for every video asset in a project.
 *
 * Costs nothing but time — no API key, no model call. This is the stage that
 * makes the video layer affordable: a shot rejected here by arithmetic is
 * never described by a vision model later.
 */
export async function runShotCatalogue(
  projectId: string,
  options: WindowingOptions = DEFAULT_WINDOWING,
): Promise<ShotCatalogueResult> {
  if (inFlight.has(projectId)) {
    throw new Error("Shot analysis is already running for this project.");
  }
  inFlight.add(projectId);

  try {
    const assets = await prisma.mediaAsset.findMany({
      where: { projectId, kind: "VIDEO" },
      select: { id: true, filePath: true, durationSec: true },
      orderBy: { filePath: "asc" },
    });

    let clipsSkipped = 0;
    const counts = await mapWithConcurrency(assets, CONCURRENCY, async (asset) => {
      try {
        const { metrics, cuts } = await analyzeClip(asset.filePath);
        // Prefer the measured extent of the motion curve over the container's
        // declared duration: they disagree slightly on variable-frame-rate
        // footage, and a window must never run past real samples.
        const measuredEnd = metrics.motion.at(-1)?.timeSec ?? 0;
        const durationSec = Math.min(
          measuredEnd,
          asset.durationSec ?? measuredEnd,
        );
        const windows = findShotWindows(metrics, cuts, durationSec, options);
        return await persistShots(asset.id, windows);
      } catch {
        // One unreadable file must not lose the whole folder's analysis.
        clipsSkipped++;
        return 0;
      }
    });

    return {
      clipsAnalyzed: assets.length - clipsSkipped,
      clipsSkipped,
      shotsWritten: counts.reduce((sum, n) => sum + n, 0),
    };
  } finally {
    inFlight.delete(projectId);
  }
}
