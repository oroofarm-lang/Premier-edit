import type { OutputProfile } from "@/lib/generated/prisma/enums";
import { ENGLISH_FILLERS, HEBREW_FILLERS, HEBREW_STOPWORDS } from "@/lib/experts/hebrew";
import { SHOT_DURATION_SEC } from "@/lib/experts/pacing";
import type {
  ContentSelector,
  SelectionRequest,
  SelectionResult,
} from "./types";

// Words with no topical signal, from the Hebrew expert so there is one list
// rather than a copy per consumer. The English additions are here because
// they only matter to keyword matching, not to the language knowledge itself.
const STOPWORDS = new Set<string>([
  ...HEBREW_STOPWORDS,
  "the", "and", "for", "with", "this", "that", "you", "are", "was",
]);

// Speech disfluencies — a take full of these is usually the worse take.
const FILLERS: readonly string[] = [...HEBREW_FILLERS, ...ENGLISH_FILLERS];

/** Below this, a segment hurts the cut more than the extra seconds help. */
const MIN_SCORE = 0.15;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"'`()\[\]{}…—–-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

/**
 * Hebrew attaches prefixes (ו, ב, ל, כ, מ, ה, ש) directly to words, so a plain
 * string match misses "ובעגבניות" when the brief says "עגבניות". Comparing
 * suffixes catches most of these without a real morphological analyzer.
 */
function looselyMatches(a: string, b: string): boolean {
  if (a === b) return true;
  const [longer, shorter] = a.length >= b.length ? [a, b] : [b, a];
  if (shorter.length < 3) return false;
  return longer.endsWith(shorter) && longer.length - shorter.length <= 2;
}

/**
 * Spoken text is the primary signal; visual tags/summary (present only when
 * vision analysis ran) are a weaker secondary one — a tag match means "this
 * is probably relevant," not "this is definitely what the brief is about."
 */
function briefRelevance(
  text: string,
  briefTokens: string[],
  visualText?: string,
): number {
  if (briefTokens.length === 0) return 0;

  const spokenWords = tokenize(text);
  const spokenMatched = briefTokens.filter((briefWord) =>
    spokenWords.some((word) => looselyMatches(word, briefWord)),
  ).length;
  if (spokenMatched > 0) return spokenMatched / briefTokens.length;

  if (!visualText) return 0;
  const visualWords = tokenize(visualText);
  const visualMatched = briefTokens.filter((briefWord) =>
    visualWords.some((word) => looselyMatches(word, briefWord)),
  ).length;
  // Capped below what spoken relevance could reach, and scaled down —
  // visual-only relevance is a hint, not the same confidence as hearing it.
  return Math.min(0.6, (visualMatched / briefTokens.length) * 0.75);
}

function fillerPenalty(text: string): number {
  const lower = text.toLowerCase();
  const hits = FILLERS.filter((filler) => lower.includes(filler)).length;
  return Math.min(hits * 0.15, 0.45);
}

/**
 * How well a segment's length suits the target format, scored against the
 * pacing expert's per-profile ranges.
 *
 * This used to be one fixed curve that peaked at 3-10s for every profile,
 * which put it in direct conflict with the rest of the system: `validatePlan`
 * rejects any plan whose opening moment is longer than the 3s hook window,
 * while this function ranked those very moments at 0.7 and 3-10s ones at 1.0.
 * Since this selector also builds the LLM selector's shortlist, short punchy
 * moments could be filtered out before the LLM ever saw them — and then the
 * only plans it could write were ones that fail validation. Profile-aware
 * ranges remove that conflict, and also stop long-form footage from being
 * scored as if it were a reel.
 */
function durationFitness(seconds: number, profile: OutputProfile): number {
  const { min, ideal, max } = SHOT_DURATION_SEC[profile];

  if (seconds < min) {
    // Fragments still score above zero — a 0.6s beat can be a real hook — but
    // fall away fast as they get too short to read as a shot at all.
    return Math.max(0.1, 0.7 * (seconds / min));
  }
  if (seconds <= max) {
    // Full marks across the usable band, tapering slightly toward the edges so
    // a moment near `ideal` still outranks one at the extreme.
    const distance = Math.abs(seconds - ideal) / Math.max(ideal - min, max - ideal);
    return 1 - 0.25 * Math.min(1, distance);
  }
  // Over the ceiling: usable if trimmed by hand, but not what we want to rank.
  return Math.max(0.15, 0.6 * (max / seconds));
}

function describe(
  relevance: number,
  filler: number,
  duration: number,
  hasBrief: boolean,
  hasSpeech: boolean,
): string {
  const parts: string[] = [];

  if (!hasBrief) {
    parts.push("no brief given — ranked on delivery only");
  } else if (relevance >= 0.5) {
    parts.push("strongly matches the brief");
  } else if (relevance > 0) {
    parts.push(hasSpeech ? "partly matches the brief" : "matches the brief visually, no speech");
  } else {
    parts.push("no brief keywords");
  }

  if (duration >= 1) parts.push("good clip length");
  else if (duration <= 0.3) parts.push("awkward length");

  if (filler > 0) parts.push("contains filler words");

  return parts.join("; ");
}

/**
 * Keyword-and-heuristics selector. Deliberately simple and free to run: it
 * gives the pipeline a working default and a baseline to measure an LLM
 * selector against. It cannot judge meaning, only surface signals.
 */
export class HeuristicContentSelector implements ContentSelector {
  readonly name = "heuristic-v1";

  async select(request: SelectionRequest): Promise<SelectionResult> {
    const briefTokens = request.brief ? tokenize(request.brief) : [];
    const hasBrief = briefTokens.length > 0;

    const scored = request.candidates.map((candidate) => {
      const seconds = candidate.endSec - candidate.startSec;
      const visualText = [candidate.visualSummary, ...(candidate.visualTags ?? [])]
        .filter(Boolean)
        .join(" ");
      const relevance = briefRelevance(candidate.text, briefTokens, visualText);
      const filler = fillerPenalty(candidate.text);
      const duration = durationFitness(seconds, request.outputProfile);

      // Without a brief there is nothing to be relevant *to*, so lean entirely
      // on delivery signals rather than scoring everything as irrelevant.
      const raw = hasBrief
        ? relevance * 0.6 + duration * 0.4 - filler
        : duration - filler;

      return {
        candidate,
        seconds,
        score: Math.max(0, Math.min(1, raw)),
        reason: describe(relevance, filler, duration, hasBrief, candidate.text.trim().length > 0),
      };
    });

    // Take the best material first, then restore shooting order so the cut
    // still reads as a coherent sequence rather than a highlight jumble.
    const chosen: typeof scored = [];
    let total = 0;
    for (const item of [...scored].sort((a, b) => b.score - a.score)) {
      // Weak material makes the cut worse, not longer — a 0.4s "אז" fragment
      // technically scores above zero but nobody wants it in the edit.
      if (item.score < MIN_SCORE) continue;
      // Keep scanning instead of breaking: a later, shorter segment may still
      // fit the remaining budget where this one didn't.
      if (total + item.seconds > request.targetDurationSec) continue;
      chosen.push(item);
      total += item.seconds;
    }

    // A single strong take longer than the whole target would otherwise leave
    // the cut empty; better to hand back one overlong clip to trim by hand.
    if (chosen.length === 0) {
      const best = [...scored]
        .filter((item) => item.score >= MIN_SCORE)
        .sort((a, b) => b.score - a.score)[0];
      if (best) chosen.push(best);
    }

    const selections = chosen
      .sort((a, b) => {
        const byFile = a.candidate.filePath.localeCompare(b.candidate.filePath);
        return byFile !== 0 ? byFile : a.candidate.startSec - b.candidate.startSec;
      })
      .map((item, index) => ({
        mediaAssetId: item.candidate.mediaAssetId,
        startSec: item.candidate.startSec,
        endSec: item.candidate.endSec,
        order: index,
        score: Math.round(item.score * 1000) / 1000,
        reason: item.reason,
      }));

    return { selections };
  }
}
