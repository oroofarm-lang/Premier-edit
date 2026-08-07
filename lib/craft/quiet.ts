import { MIN_REMOVAL_SEC } from "./silence";
import type { Removal } from "./types";

/**
 * Dead air found by *listening to the audio*, not by reading word timings.
 *
 * This exists because `silence.ts` is structurally blind to the defect that
 * actually reached the user's ear. It looks for gaps *between* words, and
 * faster-whisper often reports no gap at all: it absorbs a pause into the
 * neighbouring word's own span instead. Measured on real footage — the word
 * "מרווה" in `0X7A1692` is reported as 1.57–2.85s (1.28s long), but the level
 * profile shows −34 to −38dB for the first 0.95s and speech only in the last
 * third. The previous word ends at exactly 1.57, so the gap detector sees a
 * contiguous run of speech and finds nothing, while the cut carries a full
 * second of silence.
 *
 * The lesson is the one this project keeps relearning: a transcript is a
 * measurement of *words*, and trusting it as a measurement of *sound* is a
 * category error. ffmpeg can answer the question directly, and for free.
 *
 * Pure by construction — parsing and planning only. The ffmpeg call lives in
 * `measure-quiet.ts`, so this half stays unit-testable.
 */

/**
 * How much quiet to leave next to speech, in seconds.
 *
 * ffmpeg reports the moment the level crosses the threshold, which is slightly
 * inside the consonant that follows — a plosive ramps up over a few
 * milliseconds. Padding keeps the onset intact and leaves the cut breathing
 * rather than clipped tight against the syllable.
 */
export const QUIET_PAD_SEC = 0.12;

/**
 * Level at or below which this footage counts as silent, in dBFS.
 *
 * Measured, and the first guess was wrong in a way worth recording. Mean levels
 * separate cleanly — speech −12 to −20dB, quiet −33 to −39dB — which suggested
 * −28dB. That finds **nothing**: `silencedetect` needs a *continuous* run below
 * the threshold, and this is outdoor footage whose room tone peaks at −23.7dB
 * inside the quiet, breaking the run into fragments shorter than
 * `MIN_QUIET_SEC`. The threshold has to clear the noise floor's peaks, not its
 * mean.
 *
 * At −22dB the real region is found at 1.018s; at −20dB, 1.028s — so the value
 * is robust across that range rather than finely tuned. Speech never triggers
 * it despite −20dB means, because a run needs `MIN_QUIET_SEC` continuously
 * below and speech peaks at −2 to −5dB.
 */
export const QUIET_NOISE_DB = -22;

/** Shorter than this and a quiet stretch is a natural beat, not dead air. */
export const MIN_QUIET_SEC = 0.35;

export type QuietRegion = { startSec: number; endSec: number };

/** A word's span, for the overlap guard below. */
export type SpokenWord = { startSec: number; endSec: number };

/**
 * Drops any quiet region that overlaps a transcribed word.
 *
 * **Quiet is not the same as "no speech", and assuming so cut a word in half.**
 * The word `בא` is timed 1.66–2.18s and measures −39dB across 1.71–1.99s,
 * because a stop consonant's closure *is* silence — the mouth is shut before
 * the burst. Removing that span left "נמרוד, ..." followed by "לך על כוס תה?",
 * which is broken Hebrew, and it shipped to the user.
 *
 * The level check alone cannot catch this: the span really is quiet. Only the
 * transcript knows a word is standing there. So the two signals are used for
 * what each is actually good for — ffmpeg decides *where it is quiet*, the
 * transcript decides *where it is allowed to cut*.
 */
export function rejectRegionsOverlappingWords(
  regions: QuietRegion[],
  words: SpokenWord[],
): QuietRegion[] {
  return regions.filter(
    (r) => !words.some((w) => w.startSec < r.endSec && w.endSec > r.startSec),
  );
}

/**
 * Pulls silence regions out of ffmpeg's `silencedetect` stderr.
 *
 * `silencedetect` prints `silence_start` and later a matching `silence_end`.
 * When the stream ends while still quiet it prints no end at all, so an open
 * region is closed at `streamEndSec` when one is given — otherwise it is
 * dropped, because a region with no known end cannot be trimmed safely.
 */
export function parseSilenceRegions(
  stderr: string,
  streamEndSec?: number,
): QuietRegion[] {
  const regions: QuietRegion[] = [];
  let openStart: number | null = null;

  for (const line of stderr.split("\n")) {
    const start = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (start) {
      openStart = Number(start[1]);
      continue;
    }
    const end = line.match(/silence_end:\s*(-?[\d.]+)/);
    if (end && openStart !== null) {
      regions.push({ startSec: openStart, endSec: Number(end[1]) });
      openStart = null;
    }
  }

  if (openStart !== null && streamEndSec !== undefined) {
    regions.push({ startSec: openStart, endSec: streamEndSec });
  }

  return regions;
}

/**
 * Turns measured quiet regions into removals inside one span.
 *
 * Padding is applied only where there is speech to protect: a region touching
 * the span's own edge has nothing beyond it, so that side is left flush.
 */
export function planQuietRemovals(
  regions: QuietRegion[],
  spanStartSec: number,
  spanEndSec: number,
  minQuietSec = MIN_QUIET_SEC,
): Removal[] {
  const removals: Removal[] = [];

  for (const region of regions) {
    const start = Math.max(spanStartSec, region.startSec);
    const end = Math.min(spanEndSec, region.endSec);
    const length = end - start;
    if (length < minQuietSec) continue;

    const padStart = start > spanStartSec ? QUIET_PAD_SEC : 0;
    const padEnd = end < spanEndSec ? QUIET_PAD_SEC : 0;

    const from = start + padStart;
    const to = end - padEnd;
    if (to - from < MIN_REMOVAL_SEC) continue;

    removals.push({
      kind: "silence",
      startSec: from,
      endSec: to,
      label: `שתיקה נמדדת של ${length.toFixed(1)} שניות`,
    });
  }

  return removals;
}
