import { normaliseHebrewWord } from "@/lib/experts/hebrew";
import type {
  Script,
  ScriptLine,
  ScriptProblem,
  ScriptSource,
  ScriptValidation,
  TimedWord,
  ValidateOptions,
} from "./types";

/**
 * The gate between an agent's script and the database.
 *
 * A script is written by something that can be wrong, so nothing here trusts
 * it. Pure by construction — no Prisma import — because vitest does not load
 * `.env`, so a module importing `@/lib/db` cannot be unit-tested at all. Same
 * split as `refine.ts` / `refine-plan.ts`.
 *
 * **The check that matters is #3, the quoted text.** Every other rule catches
 * a mistake; that one catches a *fabrication*. A writer that hallucinates a
 * better sentence than the one actually spoken would otherwise produce a cut
 * whose subtitle and audio disagree, and nothing downstream would notice.
 */

/** Shorter than this is a flicker, not a line of speech. */
export const MIN_LINE_SEC = 0.4;

/**
 * How close two consecutive lines from one clip have to be before the join
 * between them is inaudible.
 *
 * Found by a critic reading a real script: seven of fourteen joins were the
 * same clip resuming exactly where it left off, so a "15 line" cut was eight
 * moments as far as a listener was concerned, with one 9.5-second unbroken
 * take inside it. Every line validated — the fault is in the *seam*, which no
 * per-line rule can see.
 *
 * Splitting a single run of speech at word boundaries is not editing, and it
 * inflates every count that is supposed to describe pace. Cheap arithmetic
 * catches it, so the critic should not have to.
 */
export const CONTIGUOUS_JOIN_SEC = 0.05;

/** Timing slack when asking whether a word falls inside a span, in seconds. */
const EPSILON = 0.02;

/**
 * How far from the profile's target length before it is worth mentioning.
 * A warning, never a rejection — the PRD treats these as guidance for a rough
 * cut, and a good 40s story should not be refused for a 30s target.
 */
const DURATION_TOLERANCE = 0.4;

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** The words of one source that fall inside a span, in spoken order. */
export function wordsInSpan(
  words: TimedWord[],
  startSec: number,
  endSec: number,
): TimedWord[] {
  return words.filter(
    (w) => w.startSec >= startSec - EPSILON && w.endSec <= endSec + EPSILON,
  );
}

/** Comparable form of a phrase: normalised words, single-spaced. */
function normalisePhrase(text: string): string {
  return text
    .split(/\s+/)
    .map(normaliseHebrewWord)
    .filter((w) => w.length > 0)
    .join(" ");
}

/**
 * Tightens a span onto the words it actually contains.
 *
 * An agent picks times by reading a printed transcript, so its boundaries land
 * near a word rather than on it. Snapping to the first and last word's own
 * timings means the cut never clips a syllable and never carries a fragment of
 * the neighbouring one.
 */
function tightenToWords(line: ScriptLine, spoken: TimedWord[]): ScriptLine {
  if (spoken.length === 0) return line;
  return {
    ...line,
    startSec: round(spoken[0].startSec),
    endSec: round(spoken[spoken.length - 1].endSec),
  };
}

export function validateScript(
  script: Script,
  options: ValidateOptions,
): ScriptValidation {
  const errors: ScriptProblem[] = [];
  const warnings: ScriptProblem[] = [];
  const sourcesById = new Map(options.sources.map((s) => [s.mediaAssetId, s]));

  if (!Array.isArray(script.lines) || script.lines.length === 0) {
    errors.push({ order: null, message: "The script has no lines." });
    return { ok: false, errors, warnings, lines: [], totalDurationSec: 0 };
  }

  const tightened: ScriptLine[] = [];

  for (const line of script.lines) {
    const at = line.order;
    const source = sourcesById.get(line.mediaAssetId);

    if (!source) {
      errors.push({
        order: at,
        message: `mediaAssetId "${line.mediaAssetId}" is not a clip in this project.`,
      });
      continue;
    }
    if (!(line.endSec > line.startSec)) {
      errors.push({
        order: at,
        message: `endSec (${line.endSec}) must be greater than startSec (${line.startSec}).`,
      });
      continue;
    }

    const spoken = wordsInSpan(source.words, line.startSec, line.endSec);
    if (spoken.length === 0) {
      errors.push({
        order: at,
        message:
          `${source.fileName} ${line.startSec}–${line.endSec}s contains no transcribed speech. ` +
          `A line must be words someone actually said.`,
      });
      continue;
    }

    // The anti-fabrication gate. Compared on normalised words so punctuation
    // and niqqud never reject an honest quote.
    const claimed = normalisePhrase(line.text);
    const actual = normalisePhrase(spoken.map((w) => w.word).join(" "));
    if (claimed !== actual) {
      errors.push({
        order: at,
        message:
          `The quoted text does not match what was said in ${source.fileName} ` +
          `${line.startSec}–${line.endSec}s.\n      claimed: "${claimed}"\n      spoken:  "${actual}"`,
      });
      continue;
    }

    const snapped = tightenToWords(line, spoken);
    const duration = snapped.endSec - snapped.startSec;
    if (duration < MIN_LINE_SEC) {
      errors.push({
        order: at,
        message: `Line is ${duration.toFixed(2)}s, shorter than the ${MIN_LINE_SEC}s minimum.`,
      });
      continue;
    }

    tightened.push(snapped);
  }

  // Order must be contiguous from 0, so the cut has an unambiguous sequence.
  const orders = script.lines.map((l) => l.order).sort((a, b) => a - b);
  const expected = orders.every((o, i) => o === i);
  if (!expected) {
    errors.push({
      order: null,
      message: `order must run 0..${script.lines.length - 1} with no gaps or repeats; got [${orders.join(", ")}].`,
    });
  }

  // Two lines from one clip must not overlap: the same audio twice in one cut
  // is a stutter, and it usually means a span was widened by accident.
  const byAsset = new Map<string, ScriptLine[]>();
  for (const line of tightened) {
    const list = byAsset.get(line.mediaAssetId) ?? [];
    list.push(line);
    byAsset.set(line.mediaAssetId, list);
  }
  for (const [assetId, list] of byAsset) {
    const sorted = [...list].sort((a, b) => a.startSec - b.startSec);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].startSec < sorted[i - 1].endSec - EPSILON) {
        const name = sourcesById.get(assetId)?.fileName ?? assetId;
        errors.push({
          order: sorted[i].order,
          message:
            `Overlaps another line from ${name}: ` +
            `${sorted[i - 1].startSec}–${sorted[i - 1].endSec}s and ` +
            `${sorted[i].startSec}–${sorted[i].endSec}s.`,
        });
      }
    }
  }

  const totalDurationSec = round(
    tightened.reduce((sum, l) => sum + (l.endSec - l.startSec), 0),
  );

  // Joins the ear will not hear. Reported against the script's own order, not
  // the source times, because the question is what a listener experiences.
  const inOrder = [...tightened].sort((a, b) => a.order - b.order);
  let inaudibleJoins = 0;
  for (let i = 1; i < inOrder.length; i++) {
    const prev = inOrder[i - 1];
    const next = inOrder[i];
    if (
      prev.mediaAssetId === next.mediaAssetId &&
      Math.abs(next.startSec - prev.endSec) <= CONTIGUOUS_JOIN_SEC
    ) {
      inaudibleJoins += 1;
      warnings.push({
        order: next.order,
        message:
          `Continues line ${prev.order} from the same clip with no gap — the ear ` +
          `hears one moment, not a cut. Splitting a run of speech does not make it two beats.`,
      });
    }
  }
  if (inaudibleJoins > 0) {
    warnings.push({
      order: null,
      message:
        `${inOrder.length} lines, but ${inOrder.length - inaudibleJoins} audible moment(s) — ` +
        `${inaudibleJoins} join(s) are the same clip resuming where it stopped.`,
    });
  }

  const target = options.targetDurationSec;
  const drift = Math.abs(totalDurationSec - target) / target;
  if (drift > DURATION_TOLERANCE) {
    warnings.push({
      order: null,
      message:
        `The script runs ${totalDurationSec}s against a ${target}s target for ` +
        `${options.outputProfile}. Not a rejection — but worth a look.`,
    });
  }

  const ok = errors.length === 0;
  return {
    ok,
    errors,
    warnings,
    lines: ok ? tightened.sort((a, b) => a.order - b.order) : [],
    totalDurationSec,
  };
}
