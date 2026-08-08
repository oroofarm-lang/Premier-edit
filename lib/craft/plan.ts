import { findFillerRemovals } from "./fillers";
import { findSilenceRemovals, MIN_REMOVAL_SEC } from "./silence";
import type {
  CleanedMoment,
  CraftPlan,
  CraftWord,
  PlannedRemoval,
  Removal,
  SpineMomentInput,
} from "./types";

/**
 * Turns per-moment removals into a clean spine.
 *
 * This is the half of the craft layer that keeps the other half honest.
 * Finding dead air is easy; the ways it goes wrong are all here — removals
 * that overlap each other, removals that reach past the source file, and
 * fragments of speech left so short they read as a flicker rather than a
 * cut. Each of those produces a timeline that imports into Premiere and
 * looks broken, which is exactly the class of bug this project has been
 * bitten by before.
 */

/**
 * Shorter than this and a surviving fragment is a flicker, not a moment.
 * Matches the floor the picture layer already uses (`MIN_PLACEMENT_SEC` in
 * lib/video/heuristic-layout.ts) so the two timelines agree on what counts
 * as long enough to see or hear.
 */
export const MIN_FRAGMENT_SEC = 0.7;

const EPSILON = 0.01;

export type CleanupOptions = {
  /** Per-asset source duration, so a removal can never reach past the file. */
  durationByAssetId?: Record<string, number | null>;
  removeSilence?: boolean;
  removeFillers?: boolean;
  /**
   * Removals measured from the audio itself rather than from word timings,
   * keyed by the moment's `order`. See `quiet.ts` — word timings cannot see a
   * pause that faster-whisper absorbed into a word's own span, and that is the
   * defect that actually reached the user's ear. Merged with everything else,
   * so the fragment and overlap rules below apply to these identically.
   */
  measuredQuietByOrder?: Record<number, Removal[]>;
  /**
   * Shortest surviving fragment to keep, in seconds. Defaults to
   * `MIN_FRAGMENT_SEC` (0.7), which is a *picture* floor — it matches
   * `MIN_PLACEMENT_SEC` so a shot is never on screen for a flicker.
   *
   * The audio spine needs a much smaller one, and getting this wrong deleted
   * real speech: splitting a 2.42s written line around a measured pause left
   * fragments of 1.26s and 0.38s, and the 0.38s one — which held the word
   * "מרווה", the whole point of that line — fell under the picture floor and
   * was silently discarded. A short fragment of audio is a *word*, not a
   * flicker. Losing a word to remove a pause is a strictly worse cut.
   */
  minFragmentSec?: number;
};

/**
 * Clamps every removal into the moment, drops the degenerate ones, then
 * merges anything that overlaps or touches. Merging matters because a filler
 * word sitting at the edge of a pause produces two removals describing one
 * continuous piece of dead air — subtracting them separately would leave a
 * sliver of nothing between two splices.
 */
export function mergeRemovals(
  removals: Removal[],
  startSec: number,
  endSec: number,
): Removal[] {
  const clamped = removals
    .map((r) => ({
      ...r,
      startSec: Math.max(startSec, r.startSec),
      endSec: Math.min(endSec, r.endSec),
    }))
    .filter((r) => r.endSec - r.startSec >= MIN_REMOVAL_SEC)
    .sort((a, b) => a.startSec - b.startSec);

  const merged: Removal[] = [];
  for (const removal of clamped) {
    const last = merged.at(-1);
    if (last && removal.startSec <= last.endSec + EPSILON) {
      // Keep the earlier removal's kind and label; the merged span is what
      // matters downstream, and one label reads better than two stapled.
      last.endSec = Math.max(last.endSec, removal.endSec);
      continue;
    }
    merged.push({ ...removal });
  }

  return merged;
}

/** What is left of [startSec, endSec] once the removals are taken out. */
export function subtractRemovals(
  startSec: number,
  endSec: number,
  removals: Removal[],
): { startSec: number; endSec: number }[] {
  const fragments: { startSec: number; endSec: number }[] = [];
  let cursor = startSec;

  for (const removal of removals) {
    if (removal.startSec > cursor + EPSILON) {
      fragments.push({ startSec: cursor, endSec: removal.startSec });
    }
    cursor = Math.max(cursor, removal.endSec);
  }
  if (endSec > cursor + EPSILON) fragments.push({ startSec: cursor, endSec });

  return fragments;
}

export function planCleanup(
  moments: SpineMomentInput[],
  wordsByAssetId: Record<string, CraftWord[]>,
  options: CleanupOptions = {},
): CraftPlan {
  const {
    durationByAssetId = {},
    removeSilence = true,
    removeFillers = true,
    measuredQuietByOrder = {},
    minFragmentSec = MIN_FRAGMENT_SEC,
  } = options;

  const cleaned: CleanedMoment[] = [];
  const planned: PlannedRemoval[] = [];
  const warnings: string[] = [];
  let durationBeforeSec = 0;
  let durationAfterSec = 0;

  for (const moment of moments) {
    durationBeforeSec += moment.endSec - moment.startSec;

    const words = wordsByAssetId[moment.mediaAssetId] ?? [];
    const duration = durationByAssetId[moment.mediaAssetId] ?? null;

    // Bounds first (roadmap task #30): a moment whose end runs past the file
    // is already broken, and cleaning it would only hide that.
    const start = Math.max(0, moment.startSec);
    const end = duration ? Math.min(duration, moment.endSec) : moment.endSec;

    if (end - start < minFragmentSec) {
      cleaned.push({ ...moment, startSec: start, endSec: end, sourceOrder: moment.order });
      durationAfterSec += Math.max(0, end - start);
      continue;
    }

    // Quiet measured from the audio needs no transcript, so it applies even to
    // an asset with no word timings — 2 of the 11 clips in the current project
    // have none, and those used to pass through untouched.
    const measured = measuredQuietByOrder[moment.order] ?? [];

    const found: Removal[] = [
      ...measured,
      ...(words.length > 0 && removeSilence ? findSilenceRemovals(words, start, end) : []),
      ...(words.length > 0 && removeFillers ? findFillerRemovals(words, start, end) : []),
    ];

    if (found.length === 0) {
      cleaned.push({ ...moment, startSec: start, endSec: end, sourceOrder: moment.order });
      durationAfterSec += end - start;
      continue;
    }

    const removals = mergeRemovals(found, start, end);

    const fragments = subtractRemovals(start, end, removals).filter(
      (f) => f.endSec - f.startSec >= minFragmentSec,
    );

    // Everything was dead air. Rather than delete a moment the user approved,
    // keep it whole and say so — an all-silent moment means the selection
    // stage picked wrong, and silently dropping it would hide that.
    if (fragments.length === 0) {
      warnings.push(
        `רגע ${moment.order + 1} (${moment.fileName}) כמעט כולו שתיקה — נשאר כמו שהוא.`,
      );
      cleaned.push({ ...moment, startSec: start, endSec: end, sourceOrder: moment.order });
      durationAfterSec += end - start;
      continue;
    }

    for (const removal of removals) {
      planned.push({ ...removal, sourceOrder: moment.order, fileName: moment.fileName });
    }

    for (const fragment of fragments) {
      cleaned.push({
        ...moment,
        startSec: round(fragment.startSec),
        endSec: round(fragment.endSec),
        sourceOrder: moment.order,
      });
      durationAfterSec += fragment.endSec - fragment.startSec;
    }
  }

  return {
    moments: cleaned.map((m, index) => ({ ...m, order: index })),
    removals: planned,
    secondsRemoved: round(Math.max(0, durationBeforeSec - durationAfterSec)),
    durationBeforeSec: round(durationBeforeSec),
    durationAfterSec: round(durationAfterSec),
    warnings,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
