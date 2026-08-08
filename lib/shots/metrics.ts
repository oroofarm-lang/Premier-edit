import type { MetricSample, SceneCut } from "./types";

/**
 * Parses one metric series out of ffmpeg's `metadata=print` output.
 *
 * The format interleaves a frame header with its metadata keys:
 *
 *     frame:0    pts:1       pts_time:0.1
 *     lavfi.signalstats.YAVG=13.3837
 *     lavfi.blur=4.528566
 *
 * so the parser carries the most recent timestamp forward and attaches any
 * matching key to it. Keys that appear before any frame header, or values
 * that are not finite numbers, are skipped rather than throwing — a partial
 * series is still usable, and one malformed line in a several-thousand-line
 * dump should not lose the whole clip.
 */
export function parseMetricSeries(
  output: string,
  key: string,
): MetricSample[] {
  const samples: MetricSample[] = [];
  let timeSec: number | null = null;

  for (const line of output.split("\n")) {
    const header = /pts_time:(-?[\d.]+)/.exec(line);
    if (header) {
      const parsed = Number(header[1]);
      timeSec = Number.isFinite(parsed) ? parsed : null;
      continue;
    }
    if (timeSec === null) continue;

    const trimmed = line.trim();
    if (!trimmed.startsWith(`${key}=`)) continue;
    const value = Number(trimmed.slice(key.length + 1));
    if (!Number.isFinite(value)) continue;

    samples.push({ timeSec, value });
  }

  return samples;
}

/**
 * Parses scene-cut times from `scdet`'s metadata, which reports the time of
 * each detected cut under `lavfi.scd.time`.
 */
export function parseSceneCuts(output: string): SceneCut[] {
  const cuts: SceneCut[] = [];
  for (const line of output.split("\n")) {
    const match = /lavfi\.scd\.time=(-?[\d.]+)/.exec(line);
    if (!match) continue;
    const timeSec = Number(match[1]);
    if (Number.isFinite(timeSec)) cuts.push({ timeSec });
  }
  return cuts;
}

/** Linear-interpolation percentile over an unsorted numeric array. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Samples falling inside [startSec, endSec). */
export function samplesInRange(
  samples: MetricSample[],
  startSec: number,
  endSec: number,
): MetricSample[] {
  return samples.filter((s) => s.timeSec >= startSec && s.timeSec < endSec);
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Mean absolute second difference — how *erratically* a series moves, as
 * opposed to how much. This is the distinction that separates a smooth pan
 * (large motion, small jitter) from handheld shake (large motion, large
 * jitter), and it is why stability is not simply "low motion": the user
 * asked for camera movements that complete, so a moving shot must be able to
 * score well.
 */
export function jitter(values: number[]): number {
  if (values.length < 3) return 0;
  const deltas: number[] = [];
  for (let i = 2; i < values.length; i++) {
    deltas.push(Math.abs(values[i] - 2 * values[i - 1] + values[i - 2]));
  }
  return mean(deltas);
}
