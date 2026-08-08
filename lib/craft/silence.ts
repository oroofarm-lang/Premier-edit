import type { CraftWord, Removal } from "./types";

/**
 * Dead air removal — the part of this layer that actually earns its place.
 *
 * Thresholds below are measured against this project's own transcripts, not
 * borrowed from an article. Across every gap between words in the real
 * footage the distribution is sharply bimodal: gaps are either at most 0.58s
 * or at least 1.17s, with nothing in between. That is why the threshold is
 * robust — anywhere from 0.6 to 1.0 selects exactly the same gaps, so the
 * exact value is not a tuning knob that has to be right.
 */

/** A gap has to be at least this long before it counts as dead air worth cutting. */
export const SILENCE_THRESHOLD_SEC = 0.7;

/**
 * How much of the pause to leave in, next to speech.
 *
 * Not zero, deliberately. faster-whisper's word boundaries carry real slop —
 * in this project's own data single short words are timed as long as 3.3
 * seconds, because the engine stretches a word to fill the space around it.
 * Cutting a pause flush against a word boundary would therefore clip the
 * onset of real speech some of the time. Trimming to a pad instead keeps the
 * breath that makes a sentence sound natural and absorbs the timing error.
 */
export const SILENCE_PAD_SEC = 0.35;

/** Below this, splicing costs more than the dead air it saves. */
export const MIN_REMOVAL_SEC = 0.25;

type Gap = { startSec: number; endSec: number };

/**
 * Every stretch inside [startSec, endSec] with no word in it — including the
 * lead-in before the first word and the tail after the last, which are where
 * a selected moment most often carries dead air.
 */
export function findGaps(
  words: CraftWord[],
  startSec: number,
  endSec: number,
): Gap[] {
  if (endSec <= startSec) return [];

  const inside = words
    .filter((w) => w.endSec > startSec && w.startSec < endSec)
    .sort((a, b) => a.startSec - b.startSec);

  // No speech at all in this span. The caller decides what that means — this
  // function only reports that the whole span is silent.
  if (inside.length === 0) return [{ startSec, endSec }];

  const gaps: Gap[] = [];

  if (inside[0].startSec > startSec) {
    gaps.push({ startSec, endSec: inside[0].startSec });
  }

  // Track the furthest point reached rather than just the previous word's
  // end: whisper occasionally emits overlapping words, and comparing against
  // the previous one alone would invent a gap that runs backwards.
  let reached = inside[0].endSec;
  for (let i = 1; i < inside.length; i++) {
    if (inside[i].startSec > reached) {
      gaps.push({ startSec: reached, endSec: inside[i].startSec });
    }
    reached = Math.max(reached, inside[i].endSec);
  }

  if (reached < endSec) gaps.push({ startSec: reached, endSec });

  return gaps;
}

/**
 * Turns the gaps into removals, keeping a pad next to any adjacent speech.
 * A gap at the very start of the moment has speech only on its right, so it
 * is padded only on that side — there is nothing on the left to protect.
 */
export function findSilenceRemovals(
  words: CraftWord[],
  startSec: number,
  endSec: number,
  thresholdSec = SILENCE_THRESHOLD_SEC,
): Removal[] {
  const removals: Removal[] = [];

  for (const gap of findGaps(words, startSec, endSec)) {
    const length = gap.endSec - gap.startSec;
    if (length < thresholdSec) continue;

    const padStart = gap.startSec > startSec ? SILENCE_PAD_SEC : 0;
    const padEnd = gap.endSec < endSec ? SILENCE_PAD_SEC : 0;

    const from = gap.startSec + padStart;
    const to = gap.endSec - padEnd;
    if (to - from < MIN_REMOVAL_SEC) continue;

    removals.push({
      kind: "silence",
      startSec: round(from),
      endSec: round(to),
      label: `שתיקה של ${length.toFixed(1)} שניות`,
    });
  }

  return removals;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
