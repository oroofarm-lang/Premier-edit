import { ENGLISH_FILLERS, HEBREW_FILLERS } from "@/lib/experts/hebrew";
import type { CraftWord, Removal } from "./types";

/**
 * Filler-word removal — the headline feature of tools like AutoEdit.
 *
 * **Measured result on this project's own footage: it finds nothing.** Across
 * all 356 words that carry timings in the database, zero match the filler
 * list. That is not a bug in the matcher: faster-whisper normalises speech as
 * it transcribes and simply does not emit most disfluencies, so there is no
 * "אהה" in the transcript to remove even when the speaker said one.
 *
 * It is kept anyway, and kept small, for two honest reasons: the word list
 * belongs somewhere and this is where, and the finding is about the *engine*,
 * not about the idea — a different transcriber (Deepgram, ivrit.ai, still an
 * open decision) or a verbatim mode would produce hits. What it must not do
 * is get presented as a working feature. `planCleanup` reports the count it
 * actually found.
 */

/** Fillers, longest first, so "סוג של" is matched before "של" could be. */
const PHRASES: string[] = [...HEBREW_FILLERS, ...ENGLISH_FILLERS]
  .map((f) => f.toLowerCase())
  .sort((a, b) => b.split(" ").length - a.split(" ").length);

const LONGEST_PHRASE_WORDS = Math.max(...PHRASES.map((p) => p.split(" ").length));

/**
 * Strips punctuation and Hebrew niqqud so "אהה," matches "אהה".
 * Deliberately does NOT strip Hebrew prefix letters — "ואהה" is a real word
 * being mistranscribed, not a filler, and stripping the vav would delete it.
 */
function normalise(word: string): string {
  return word
    .replace(/[֑-ׇ]/g, "")
    .replace(/[.,!?;:"'׳״\-–—…()]/g, "")
    .trim()
    .toLowerCase();
}

export function findFillerRemovals(
  words: CraftWord[],
  startSec: number,
  endSec: number,
): Removal[] {
  const inside = words
    .filter((w) => w.startSec >= startSec && w.endSec <= endSec)
    .sort((a, b) => a.startSec - b.startSec);

  const normalised = inside.map((w) => normalise(w.word));
  const removals: Removal[] = [];

  let i = 0;
  while (i < inside.length) {
    let matched = 0;

    for (let span = LONGEST_PHRASE_WORDS; span >= 1 && matched === 0; span--) {
      if (i + span > inside.length) continue;
      const candidate = normalised.slice(i, i + span).join(" ");
      if (candidate.length > 0 && PHRASES.includes(candidate)) matched = span;
    }

    if (matched === 0) {
      i += 1;
      continue;
    }

    const first = inside[i];
    const last = inside[i + matched - 1];
    removals.push({
      kind: "filler",
      startSec: first.startSec,
      endSec: last.endSec,
      label: `מילת מוטה: "${normalised.slice(i, i + matched).join(" ")}"`,
    });
    i += matched;
  }

  return removals;
}
