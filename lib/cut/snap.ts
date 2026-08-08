/**
 * Moves a candidate cut boundary so it lands on real silence between words
 * instead of wherever the transcript segment happened to end. Without this,
 * cut points fall wherever faster-whisper closed a sentence — often mid-word
 * or mid-breath — which is the mechanical cause of cuts feeling abrupt.
 * See docs/superpowers/specs/2026-07-30-editing-quality-design.md.
 */

export type SnapWord = { startSec: number; endSec: number };

/** Small pre-roll before the first real word, so the syllable's onset isn't clipped. */
const PRE_ROLL_SEC = 0.12;
/** Small tail after the last real word, so a trailing breath/consonant isn't clipped. */
const BREATH_TAIL_SEC = 0.2;

/** Index of the word whose span strictly contains `timeSec`, or -1 if it's in a gap. */
function findWordContaining(words: SnapWord[], timeSec: number): number {
  return words.findIndex((w) => timeSec > w.startSec && timeSec < w.endSec);
}

export function snapToWordBoundary(
  startSec: number,
  endSec: number,
  words: SnapWord[],
): { startSec: number; endSec: number } {
  if (words.length === 0 || endSec <= startSec) {
    return { startSec, endSec };
  }

  const sorted = [...words].sort((a, b) => a.startSec - b.startSec);
  let snappedStart = startSec;
  let snappedEnd = endSec;

  const startWordIndex = findWordContaining(sorted, startSec);
  if (startWordIndex !== -1) {
    const word = sorted[startWordIndex];
    const prevWord = sorted[startWordIndex - 1] ?? null;
    const floor = prevWord ? prevWord.endSec : 0;
    snappedStart = Math.max(floor, word.startSec - PRE_ROLL_SEC);
  }

  const endWordIndex = findWordContaining(sorted, endSec);
  if (endWordIndex !== -1) {
    const word = sorted[endWordIndex];
    const nextWord = sorted[endWordIndex + 1] ?? null;
    const ceiling = nextWord ? nextWord.startSec : Infinity;
    snappedEnd = Math.min(ceiling, word.endSec + BREATH_TAIL_SEC);
  }

  // Never let snapping invert or collapse the range — fall back to the
  // original, unsnapped boundary rather than produce a broken clip.
  if (snappedEnd <= snappedStart) {
    return { startSec, endSec };
  }

  return { startSec: snappedStart, endSec: snappedEnd };
}
