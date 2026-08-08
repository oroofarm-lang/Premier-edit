/**
 * Runs the shot catalogue over a folder of footage and prints what it found.
 *
 * This exists to make threshold tuning a conversation with real numbers
 * rather than a guess: run it, look at which windows come back, adjust
 * DEFAULT_WINDOWING, run it again. It touches no database and needs no API
 * key, so it is free to run as often as it takes.
 *
 *   npm run analyze:shots -- "/path/to/footage" [concurrency]
 */
import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { analyzeClip } from "../lib/shots/analyze";
import { findShotWindows } from "../lib/shots/windows";
import { percentile } from "../lib/shots/metrics";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".avi", ".mkv"]);

async function analyzeOne(filePath: string, fileName: string) {
  const started = Date.now();
  const { metrics, cuts } = await analyzeClip(filePath);

  const lastSample = metrics.motion.at(-1)?.timeSec ?? 0;
  const windows = findShotWindows(metrics, cuts, lastSample);
  const values = metrics.motion.map((s) => s.value);

  return {
    fileName,
    seconds: lastSample,
    elapsedSec: (Date.now() - started) / 1000,
    cuts: cuts.length,
    samples: metrics.motion.length,
    hasAppearance: Boolean(metrics.blur),
    p10: percentile(values, 0.1),
    p50: percentile(values, 0.5),
    p90: percentile(values, 0.9),
    windows,
  };
}

/** Simple worker pool — ffmpeg saturates cores quickly, so this stays small. */
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

async function main() {
  const folder = process.argv[2];
  if (!folder) {
    console.error('usage: npm run analyze:shots -- "/path/to/footage" [concurrency]');
    process.exit(1);
  }
  const concurrency = Number(process.argv[3] ?? 3);

  const names = (await readdir(folder))
    .filter((n) => VIDEO_EXTENSIONS.has(extname(n).toLowerCase()))
    .sort();

  console.log(`analysing ${names.length} clip(s) from ${folder}, ${concurrency} at a time\n`);
  const started = Date.now();

  const results = await mapWithConcurrency(names, concurrency, (name) =>
    analyzeOne(join(folder, name), name),
  );

  let totalWindows = 0;
  let totalSeconds = 0;
  for (const r of results) {
    totalWindows += r.windows.length;
    totalSeconds += r.seconds;
    console.log(
      `${r.fileName}  ${r.seconds.toFixed(1)}s  cuts=${r.cuts}  ` +
        `motion p10/p50/p90=${r.p10.toFixed(1)}/${r.p50.toFixed(1)}/${r.p90.toFixed(1)}  ` +
        `${r.hasAppearance ? "" : "(motion only) "}[${r.elapsedSec.toFixed(1)}s]`,
    );
    if (r.windows.length === 0) {
      console.log("    no window cleared the quality floor");
    }
    for (const w of r.windows) {
      const parts = [
        `q=${w.qualityScore.toFixed(2)}`,
        `steady=${w.stability.toFixed(2)}`,
        `complete=${w.movementCompleteness.toFixed(2)}`,
        `active=${w.activity.toFixed(2)}`,
      ];
      if (w.sharpness !== null) parts.push(`sharp=${w.sharpness.toFixed(2)}`);
      if (w.exposure !== null) parts.push(`expo=${w.exposure.toFixed(2)}`);
      console.log(
        `    ${w.startSec.toFixed(1)}-${w.endSec.toFixed(1)}s ` +
          `(${(w.endSec - w.startSec).toFixed(1)}s)  ${parts.join("  ")}`,
      );
    }
  }

  const elapsed = (Date.now() - started) / 1000;
  console.log(
    `\n${totalWindows} window(s) from ${totalSeconds.toFixed(0)}s of footage ` +
      `in ${elapsed.toFixed(0)}s wall clock (${(totalSeconds / elapsed).toFixed(1)}x realtime)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
