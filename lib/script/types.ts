import type { OutputProfile } from "@/lib/generated/prisma/enums";

/**
 * The script: what the finished video says, in order.
 *
 * This is the artefact an agent writes and the pipeline builds from. It is
 * deliberately *not* a new database concept — a script line is a `Selection`
 * row (`prisma/schema.prisma`), because a line is exactly "this span of this
 * clip, in this position". Keeping them the same thing means the script path
 * inherits the approval checkpoint, the picture-layer invalidation and the
 * whole cut/export chain for free.
 *
 * The one thing this format cannot do is invent speech. Every line names a
 * real span of real footage; `validateScript` proves it before anything is
 * written.
 */

/** One line of the script: a span of one clip, at one position in the cut. */
export type ScriptLine = {
  /** Position in the finished cut, 0-based and contiguous. */
  order: number;
  mediaAssetId: string;
  /** Times inside the source clip, in seconds. */
  startSec: number;
  endSec: number;
  /**
   * The words this span contains. Not decoration — `validateScript` checks it
   * against the transcript's own word timings, which is what makes it
   * impossible for a writer to put words in the speaker's mouth.
   */
  text: string;
  /** Why this line earns its place. Shown at the approval checkpoint. */
  reason: string;
};

export type Script = {
  /** One sentence: what this video is about. */
  premise: string;
  /** The beats the writer was building, in order. */
  beats: string[];
  lines: ScriptLine[];
};

/** One transcribed word with its timing, as faster-whisper produces them. */
export type TimedWord = {
  word: string;
  startSec: number;
  endSec: number;
};

/** Everything known about one source clip, for validation. */
export type ScriptSource = {
  mediaAssetId: string;
  fileName: string;
  /** Every word spoken in this clip, in order. */
  words: TimedWord[];
};

export type ScriptProblem = {
  /** Which line, or null for a whole-script problem. */
  order: number | null;
  message: string;
};

export type ScriptValidation = {
  ok: boolean;
  /** Anything here means nothing is persisted. */
  errors: ScriptProblem[];
  /** Worth saying, but not worth refusing over. */
  warnings: ScriptProblem[];
  /**
   * The lines with their spans tightened onto real word boundaries. Empty
   * when `ok` is false — there is nothing safe to apply.
   */
  lines: ScriptLine[];
  totalDurationSec: number;
};

export type ValidateOptions = {
  outputProfile: OutputProfile;
  targetDurationSec: number;
  sources: ScriptSource[];
};
