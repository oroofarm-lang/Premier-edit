/**
 * The deterministic craft layer: cleaning up the audio spine using nothing
 * but arithmetic over word timings. No model call, no API key, no cost.
 *
 * Why this layer can exist at all: faster-whisper already returns word-level
 * timestamps, so "where is the speech and where is the dead air" is a
 * measurement, not a judgment. Judgment is what the model call buys; this is
 * what it should never be asked to do.
 *
 * Why it is safe *here* specifically: under the two-timeline model the
 * picture layer is planned independently and runs continuously over the
 * spine. Splicing dead air out of the audio therefore does not create a
 * visible jump cut — the picture simply keeps going. The same edit under the
 * old one-timeline model would have shown every splice.
 */

/** A word as the craft layer needs it — the timing, and the text to match fillers against. */
export type CraftWord = {
  word: string;
  startSec: number;
  endSec: number;
};

export type RemovalKind = "silence" | "filler";

/** One span the craft layer proposes cutting out of a moment's source footage. */
export type Removal = {
  kind: RemovalKind;
  /** Span inside the source file, in seconds. */
  startSec: number;
  endSec: number;
  /** Shown to the user at the approval checkpoint. */
  label: string;
};

/** One moment of the audio spine, as stored in a `Selection` row. */
export type SpineMomentInput = {
  order: number;
  mediaAssetId: string;
  fileName: string;
  startSec: number;
  endSec: number;
  text: string;
  score: number | null;
  reason: string | null;
};

/**
 * A moment after cleanup. One input moment can produce several of these when
 * an interior pause was removed, which is why `sourceOrder` is kept: the UI
 * shows "moment 3 became two fragments", not two unrelated moments.
 */
export type CleanedMoment = SpineMomentInput & {
  sourceOrder: number;
};

export type PlannedRemoval = Removal & {
  sourceOrder: number;
  fileName: string;
};

export type CraftPlan = {
  /** The spine after cleanup, renumbered from 0. */
  moments: CleanedMoment[];
  removals: PlannedRemoval[];
  /** Total seconds the removals take off the cut. */
  secondsRemoved: number;
  durationBeforeSec: number;
  durationAfterSec: number;
  /** Things the user should know rather than discover in Premiere. */
  warnings: string[];
};
