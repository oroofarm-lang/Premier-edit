import { HEBREW_STOPWORDS, normaliseHebrewWord } from "@/lib/experts/hebrew";
import type { Script, ScriptLine, ScriptSource, TimedWord } from "./types";

/**
 * A scorecard for a candidate script, computed before anything is applied.
 *
 * The commercial tools in this space all ship a version of this — Opus Clip's
 * "virality score" (0–99) is the headline feature of the category. Its four
 * inputs are hook strength, flow, perceived value and trend alignment, and the
 * consistent complaint in published tests is that it is a black box: reviewers
 * report clips scored 40 outperforming clips scored 85, with no way to see why
 * either number happened or what to change.
 *
 * So this is deliberately the opposite trade. It scores **fewer** things, only
 * the ones that can be measured from the transcript's own word timings, and
 * every band names the failure it is looking for — each of which is a real
 * defect this project shipped and the user rejected out loud. A band that loses
 * points tells you which line to fix. Nothing here predicts virality, because
 * nothing free can; it predicts whether the words *connect*, which is the axis
 * the user has actually complained about.
 *
 * Free by construction: arithmetic over data already in the database. Pure —
 * no Prisma import — so it is unit-testable, same split as `validate.ts`.
 */

/** The brief's hard rule: the first moment has to land inside this. */
export const HOOK_MAX_SEC = 3;

/**
 * Gap between consecutive words that still counts as one unbroken take.
 *
 * The unit here is a **take**, not a sentence, and the threshold is generous on
 * purpose — that is the whole finding. Set it to a sentence-sized 0.5s and the
 * real 1.04–13.86s take in `0X7A1694` splits at the 3.14s pause where nobody is
 * talking, which is precisely the split three separate writers made and the
 * user rejected. The user's rule is explicit: *"לא אכפת לי שיש רגעים של שקט"*,
 * and script D deliberately keeps a 3.3s stall inside `ונלך`. A pause a viewer
 * accepts is not a cut, so it must not be a boundary here either.
 *
 * 4s clears both observed pauses and still separates genuinely different
 * moments. Two further reasons the number cannot be tight: faster-whisper
 * absorbs silence into a neighbouring word's own span (a full second once sat
 * *inside* `מרווה`), so measured gaps understate real ones; and a gap is
 * measured between words, which says nothing about whether the camera stopped.
 */
export const TAKE_GAP_SEC = 4;

/** A take shorter than this is a sentence, not an opportunity worth reporting. */
export const MIN_REPORTABLE_RUN_SEC = 5;

/**
 * Below this, a line is a fragment rather than a thought — the `תמסוג` failure,
 * where `יאללה, תמסוג` was cut down to one orphaned word.
 *
 * The hook is exempt: a 1.94s question is the *point* of a good opening.
 */
const MIN_THOUGHT_SEC = 1.2;

/**
 * Words that point backwards, so a line opening on one is missing its setup.
 *
 * From a real rejection: `אבל פה זה צמח מדברי` cannot open a line, because the
 * `אבל` answers a `כולנו יודעים ש…` that the previous line no longer contains.
 */
const DANGLING_OPENERS = [
  "אבל", "אלא", "כי", "למרות", "לכן", "ולכן", "בגלל", "ובגלל", "שכן", "כלומר",
] as const;

/**
 * Words that open a dependency, so a line ending on one stops mid-thought.
 * `הרכיב הראשון,` is the canonical case — an ingredient announced, never named.
 */
const DANGLING_ENDINGS = [
  "של", "את", "עם", "על", "אל", "מן", "בין", "כמו", "ו", "ש", "כי", "אבל",
] as const;

export type ScoreBand = {
  id: "hook" | "wholeness" | "pace" | "closure" | "breadth";
  label: string;
  points: number;
  max: number;
  /** One line the user can act on. */
  detail: string;
};

export type ScoreFinding = {
  /** The line this concerns, or null for the script as a whole. */
  order: number | null;
  severity: "warn" | "note";
  message: string;
};

/** A stretch of unbroken speech in the source material. */
export type SpeechRun = {
  mediaAssetId: string;
  fileName: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  text: string;
};

/** A run the script did not take whole, with how much of it was used. */
export type MissedRun = SpeechRun & {
  /** Seconds of this run that appear anywhere in the script. */
  usedSec: number;
  /** How many separate lines the script broke this run into. 0 = untouched. */
  pieces: number;
  /**
   * The longest stretch inside this take that no line touches.
   *
   * This is the actionable half, and the reason the raw run length is not
   * enough on its own: the real corpus contains a 51.8s take, and "use it
   * whole" is not advice you can act on inside a 30s reel. What you *can* act
   * on is the longest unbroken piece still sitting unused.
   */
  largestUnusedSpan: SpeechRun | null;
};

export type ScriptScorecard = {
  /** 0–100. A shortlist aid, never a verdict — the ear decides. */
  total: number;
  bands: ScoreBand[];
  findings: ScoreFinding[];
  /** Continuous takes in the corpus that this script did not use whole. */
  missedRuns: MissedRun[];
  totalDurationSec: number;
  /** Lines that a listener hears as separate moments — not the line count. */
  audibleMoments: number;
};

export type ScoreOptions = {
  sources: ScriptSource[];
  /** The profile's target length, for the pace band. */
  targetDurationSec: number;
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function words(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normaliseHebrewWord)
    .filter((w) => w.length > 0);
}

/** Content words only — matching on `זה` or `יש` makes every line look related. */
function contentWords(text: string): Set<string> {
  const stop = new Set<string>(HEBREW_STOPWORDS);
  return new Set(words(text).filter((w) => w.length > 1 && !stop.has(w)));
}

/**
 * Every continuous run of speech in one source, longest-first.
 *
 * This is the function that answers the question no writer asked. On the tea
 * project three separate agents each grabbed one half of the same unbroken
 * 12.8-second take, and none of them reported that the whole thing existed —
 * because reading a printed transcript makes a run look like several sentences.
 * Arithmetic over the word timings sees it immediately.
 */
export function findSpeechRuns(
  source: ScriptSource,
  gapSec: number = TAKE_GAP_SEC,
): SpeechRun[] {
  const runs: SpeechRun[] = [];
  let current: TimedWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const startSec = current[0].startSec;
    const endSec = current[current.length - 1].endSec;
    runs.push({
      mediaAssetId: source.mediaAssetId,
      fileName: source.fileName,
      startSec: round(startSec),
      endSec: round(endSec),
      durationSec: round(endSec - startSec),
      text: current.map((w) => w.word).join(" "),
    });
    current = [];
  };

  for (const word of source.words) {
    if (current.length > 0) {
      const previous = current[current.length - 1];
      if (word.startSec - previous.endSec > gapSec) flush();
    }
    current.push(word);
  }
  flush();

  return runs.sort((a, b) => b.durationSec - a.durationSec);
}

/**
 * Seconds of `run` covered by any line, how many lines touch it, and the
 * longest stretch of it left alone.
 */
function coverageOf(run: SpeechRun, lines: ScriptLine[], source: ScriptSource) {
  const touching = lines
    .filter(
      (l) =>
        l.mediaAssetId === run.mediaAssetId &&
        l.endSec > run.startSec &&
        l.startSec < run.endSec,
    )
    .sort((a, b) => a.startSec - b.startSec);

  const usedSec = touching.reduce(
    (sum, l) =>
      sum + (Math.min(l.endSec, run.endSec) - Math.max(l.startSec, run.startSec)),
    0,
  );

  // Walk the stretches between what is used, and keep the one holding the most
  // *speech*. Ranking on raw width instead would hand back whichever gap
  // contains the longest silence — the opposite of an opportunity. Clamped to
  // the run's own bounds so a line overrunning the take cannot invent a span.
  let largestUnusedSpan: SpeechRun | null = null;
  const consider = (from: number, to: number) => {
    if (to - from <= 0) return;
    const spanWords = source.words.filter(
      (w) => w.startSec >= from - 0.02 && w.endSec <= to + 0.02,
    );
    // Dead air is not material. Reporting it would send a writer to a stretch
    // where nobody is talking.
    if (spanWords.length === 0) return;
    const startSec = round(spanWords[0].startSec);
    const endSec = round(spanWords[spanWords.length - 1].endSec);
    const durationSec = round(endSec - startSec);
    if (largestUnusedSpan && largestUnusedSpan.durationSec >= durationSec) return;
    largestUnusedSpan = {
      mediaAssetId: run.mediaAssetId,
      fileName: run.fileName,
      startSec,
      endSec,
      durationSec,
      text: spanWords.map((w) => w.word).join(" "),
    };
  };

  let cursor = run.startSec;
  for (const line of touching) {
    consider(cursor, Math.max(cursor, Math.min(line.startSec, run.endSec)));
    cursor = Math.max(cursor, Math.min(line.endSec, run.endSec));
  }
  consider(cursor, run.endSec);

  return { usedSec: round(usedSec), pieces: touching.length, largestUnusedSpan };
}

/**
 * Runs the script left on the table: untouched, part-used, or chopped up.
 *
 * A run used whole in one line is not reported — that is the good case, and it
 * is what the "one continuous, complete run of speech" rule asks for.
 */
export function findMissedRuns(
  script: Script,
  sources: ScriptSource[],
  minSec: number = MIN_REPORTABLE_RUN_SEC,
): MissedRun[] {
  const missed: MissedRun[] = [];

  for (const source of sources) {
    for (const run of findSpeechRuns(source)) {
      if (run.durationSec < minSec) continue;
      const { usedSec, pieces, largestUnusedSpan } = coverageOf(
        run,
        script.lines,
        source,
      );
      // Whole and in one piece: nothing was missed.
      if (pieces === 1 && usedSec >= run.durationSec - 0.1) continue;
      missed.push({ ...run, usedSec, pieces, largestUnusedSpan });
    }
  }

  // Ranked by what a writer could actually take next — the longest unbroken
  // stretch still free — not by raw take length. On the real corpus those
  // disagree: the longest take is 51.8s, far past a reel, while the biggest
  // usable opportunity inside it is a fraction of that.
  return missed.sort(
    (a, b) =>
      (b.largestUnusedSpan?.durationSec ?? 0) - (a.largestUnusedSpan?.durationSec ?? 0),
  );
}

/** Terminal punctuation, as faster-whisper emits it on Hebrew. */
const SENTENCE_END = /[?!.]$/;

/** The first sentence of a line's quoted text, or the whole thing if it has none. */
export function firstSentenceText(text: string): string {
  const parts = text.trim().split(/\s+/);
  const at = parts.findIndex((w) => SENTENCE_END.test(w));
  return at === -1 ? text.trim() : parts.slice(0, at + 1).join(" ");
}

/**
 * How long the viewer waits for the first complete sentence of a line.
 *
 * The hook rule is about the *viewer's* first moment, not about where the cut
 * lands, and conflating the two penalises exactly the thing this project now
 * asks for. The real 12.82s take in `0X7A1694` opens on `נמרוד, בא לך על כוס תה?`
 * and resolves it in 1.94s: a viewer is hooked before the second second,
 * whatever happens for the remaining eleven. Scoring the line length would
 * have given that take 0 and pushed writers back to chopping it up — the
 * failure the whole "one continuous take" rule exists to prevent.
 *
 * Falls back to the line's own length when the source has no word timings or
 * the line carries no terminal punctuation.
 */
export function timeToFirstSentence(
  line: ScriptLine,
  source: ScriptSource | undefined,
): number {
  const lineSec = round(line.endSec - line.startSec);
  if (!source) return lineSec;

  const spoken = source.words.filter(
    (w) => w.startSec >= line.startSec - 0.02 && w.endSec <= line.endSec + 0.02,
  );
  const at = spoken.findIndex((w) => SENTENCE_END.test(w.word.trim()));
  if (at === -1) return lineSec;
  return round(spoken[at].endSec - line.startSec);
}

export function scoreScript(
  script: Script,
  options: ScoreOptions,
): ScriptScorecard {
  const bands: ScoreBand[] = [];
  const findings: ScoreFinding[] = [];
  const lines = [...script.lines].sort((a, b) => a.order - b.order);
  const sourcesById = new Map(options.sources.map((s) => [s.mediaAssetId, s]));

  const totalDurationSec = round(
    lines.reduce((sum, l) => sum + (l.endSec - l.startSec), 0),
  );

  // A join between two lines of one clip with no gap is not a cut — the ear
  // hears one moment. Counting lines instead would flatter every script that
  // split a run of speech at word boundaries.
  let inaudibleJoins = 0;
  for (let i = 1; i < lines.length; i++) {
    const previous = lines[i - 1];
    const next = lines[i];
    if (
      previous.mediaAssetId === next.mediaAssetId &&
      Math.abs(next.startSec - previous.endSec) <= 0.05
    ) {
      inaudibleJoins += 1;
    }
  }
  const audibleMoments = Math.max(1, lines.length - inaudibleJoins);

  // ---- Hook (30) -----------------------------------------------------------
  // The single highest-leverage moment in a reel, and the brief's only hard
  // numeric rule. Every commercial tool in the category scores it first.
  const hook = lines[0];
  let hookPoints = 0;
  let hookDetail: string;
  if (!hook) {
    hookDetail = "No lines.";
  } else {
    const lineSec = round(hook.endSec - hook.startSec);
    const hookSec = timeToFirstSentence(hook, sourcesById.get(hook.mediaAssetId));
    const spans = hookSec < lineSec - 0.05 ? ` (line runs ${lineSec}s)` : "";
    if (hookSec <= HOOK_MAX_SEC) {
      hookPoints = 24;
      hookDetail = `${hookSec}s to the first complete sentence — inside the ${HOOK_MAX_SEC}s rule.${spans}`;
    } else {
      // Linear decay: 3s is full marks, 9s or worse scores nothing.
      const over = hookSec - HOOK_MAX_SEC;
      hookPoints = Math.max(0, Math.round(24 * (1 - over / 6)));
      hookDetail = `${hookSec}s to the first complete sentence — ${round(over)}s over the ${HOOK_MAX_SEC}s rule.${spans}`;
      findings.push({
        order: hook.order,
        severity: "warn",
        message:
          `The viewer waits ${hookSec}s for the first complete sentence, against a ` +
          `${HOOK_MAX_SEC}s rule. This is the one place length is not a matter of taste.`,
      });
    }
    // A question opens a loop the material can close; an announcement does not.
    // Tested against the *first sentence*, not the whole line — on a long take
    // the closing words are minutes of viewing away from the opening.
    if (/[?]\s*$/.test(firstSentenceText(hook.text))) {
      hookPoints += 6;
      hookDetail += " Opens on a question.";
    }
    if (DANGLING_OPENERS.includes(words(hook.text)[0] as never)) {
      hookPoints = Math.max(0, hookPoints - 8);
      findings.push({
        order: hook.order,
        severity: "warn",
        message: `The hook opens on "${words(hook.text)[0]}", which answers something the viewer has not heard.`,
      });
    }
  }
  bands.push({ id: "hook", label: "Hook", points: Math.min(30, hookPoints), max: 30, detail: hookDetail });

  // ---- Wholeness (30) ------------------------------------------------------
  // "המילים פשוט לא מתחברות" in numbers. Each check below is a line the user
  // rejected out loud, generalised.
  let broken = 0;
  for (const line of lines) {
    const lineSec = line.endSec - line.startSec;
    const w = words(line.text);
    const trimmed = line.text.trim();
    const isHook = line.order === lines[0]?.order;

    if (/,\s*$/.test(trimmed)) {
      broken += 1;
      findings.push({
        order: line.order,
        severity: "warn",
        message: `Ends on a comma — "${trimmed}". This is the \`הרכיב הראשון,\` failure: something is announced and never named.`,
      });
    } else if (DANGLING_ENDINGS.includes(w[w.length - 1] as never)) {
      broken += 1;
      findings.push({
        order: line.order,
        severity: "warn",
        message: `Ends on "${w[w.length - 1]}", which opens a dependency the line never closes.`,
      });
    }

    if (!isHook && DANGLING_OPENERS.includes(w[0] as never)) {
      broken += 1;
      findings.push({
        order: line.order,
        severity: "warn",
        message: `Opens on "${w[0]}" — it points back at a setup this line does not carry.`,
      });
    }

    if (!isHook && lineSec < MIN_THOUGHT_SEC) {
      broken += 1;
      findings.push({
        order: line.order,
        severity: "warn",
        message: `${round(lineSec)}s is a fragment, not a thought — the \`תמסוג\` failure.`,
      });
    }
  }
  const wholenessPoints =
    lines.length === 0 ? 0 : Math.max(0, Math.round(30 * (1 - broken / lines.length)));
  bands.push({
    id: "wholeness",
    label: "Wholeness",
    points: wholenessPoints,
    max: 30,
    detail:
      broken === 0
        ? "Every line is a complete run of speech."
        : `${broken} broken join(s) across ${lines.length} line(s).`,
  });

  // ---- Pace (20) -----------------------------------------------------------
  // Fewer cuts is a feature here, stated by the user in those words. So this
  // rewards long moments, and the only thing it punishes is churn.
  const averageMomentSec = audibleMoments === 0 ? 0 : round(totalDurationSec / audibleMoments);
  let pacePoints = 0;
  if (averageMomentSec >= 5) pacePoints = 14;
  else if (averageMomentSec >= 3) pacePoints = 11;
  else if (averageMomentSec >= 2) pacePoints = 7;
  else pacePoints = 3;

  const drift = options.targetDurationSec
    ? Math.abs(totalDurationSec - options.targetDurationSec) / options.targetDurationSec
    : 0;
  if (drift <= 0.4) pacePoints += 6;
  else if (drift <= 0.7) pacePoints += 3;

  bands.push({
    id: "pace",
    label: "Pace",
    points: Math.min(20, pacePoints),
    max: 20,
    detail:
      `${audibleMoments} audible moment(s), ${averageMomentSec}s each on average, ` +
      `${totalDurationSec}s total against a ${options.targetDurationSec}s target.`,
  });

  if (inaudibleJoins > 0) {
    findings.push({
      order: null,
      severity: "note",
      message:
        `${lines.length} lines but ${audibleMoments} audible moment(s) — ` +
        `${inaudibleJoins} "cut" is the same clip resuming where it stopped.`,
    });
  }

  // ---- Closure (10) --------------------------------------------------------
  // The loop: does the ending answer the opening? Measured as shared content
  // words, which is crude but catches the real thing — `בא לך? ברור` closing
  // `בא לך על כוס תה?` scores, and an unrelated ending does not.
  let closurePoints = 0;
  let closureDetail = "Only one line — nothing to close.";
  if (lines.length >= 2) {
    const first = contentWords(lines[0].text);
    const last = contentWords(lines[lines.length - 1].text);
    const shared = [...last].filter((w) => first.has(w));
    if (shared.length >= 2) {
      closurePoints = 10;
      closureDetail = `The ending echoes the opening on ${shared.join(", ")}.`;
    } else if (shared.length === 1) {
      closurePoints = 6;
      closureDetail = `The ending echoes the opening on "${shared[0]}".`;
    } else {
      closureDetail = "The ending shares no content word with the opening — the loop is left open.";
      findings.push({
        order: lines[lines.length - 1].order,
        severity: "note",
        message: "Nothing in the last line answers the first. A reel that closes its own loop rewatches better.",
      });
    }
  }
  bands.push({ id: "closure", label: "Closure", points: closurePoints, max: 10, detail: closureDetail });

  // ---- Breadth (10) --------------------------------------------------------
  // A known open question: the best writing concentrates in a couple of clips,
  // which makes the picture layer load-bearing. Worth surfacing, not worth
  // weighting heavily — a stronger story from two clips beats a weak survey.
  const used = new Set(lines.map((l) => l.mediaAssetId));
  const available = options.sources.length;
  const ratio = available === 0 ? 0 : used.size / available;
  const breadthPoints = Math.round(10 * Math.min(1, ratio * 2.5));
  bands.push({
    id: "breadth",
    label: "Breadth",
    points: breadthPoints,
    max: 10,
    detail: `${used.size} of ${available} clip(s) with speech. Picture has to carry the rest.`,
  });

  for (const line of lines) {
    if (!sourcesById.has(line.mediaAssetId)) {
      findings.push({
        order: line.order,
        severity: "warn",
        message: `mediaAssetId "${line.mediaAssetId}" has no transcript in this project.`,
      });
    }
  }

  const missedRuns = findMissedRuns(script, options.sources);
  for (const run of missedRuns.slice(0, 3)) {
    const span = run.largestUnusedSpan;
    if (!span) continue;
    findings.push({
      order: null,
      severity: span.durationSec >= 5 ? "warn" : "note",
      message:
        run.pieces === 0
          ? `Never opened: ${run.fileName} ${span.startSec}–${span.endSec}s is ${span.durationSec}s of unbroken speech no line uses.`
          : `${run.fileName} ${span.startSec}–${span.endSec}s — ${span.durationSec}s of unbroken speech sits unused inside a take the script already draws on in ${run.pieces} piece(s).`,
    });
  }

  const total = bands.reduce((sum, b) => sum + b.points, 0);
  return { total, bands, findings, missedRuns, totalDurationSec, audibleMoments };
}
