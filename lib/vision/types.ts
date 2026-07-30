// Vision analysis is a second, independent read on a clip alongside the
// transcript — what's visually happening, not what's said. A silent or
// sparsely-spoken clip (see CLAUDE.md, real-footage findings) is invisible to
// a transcript-only selector no matter how good the transcript is; this is
// what lets content selection judge it anyway.

export type ClipVisualDescription = {
  /** Engine identifier stored on the VisualAnalysis row, e.g. "claude-vision:claude-haiku-4-5". */
  engine: string;
  /** 1-3 sentence description of what's visually happening, in the project's language. */
  summary: string;
  /** e.g. "close-up", "wide shot", "medium", "detail insert". Null if not clearly one thing. */
  shotType: string | null;
  /** Short keywords: subjects, objects, actions — used for matching against a brief. */
  tags: string[];
  /** e.g. "shaky", "underexposed", "well framed". Null if nothing notable. */
  qualityNotes: string | null;
};

export type VisionClipInput = {
  filePath: string;
  durationSec: number;
};

export type VisionOutcome =
  | { filePath: string; ok: true; result: ClipVisualDescription }
  | { filePath: string; ok: false; error: string };

export interface VisionAnalyzer {
  readonly name: string;
  describeClip(input: VisionClipInput): Promise<ClipVisualDescription>;
  /**
   * Optional batch path. Unlike local Whisper, a vision API call has no
   * shared fixed cost to amortize — batching here just means "run many
   * concurrently instead of one huge sequential loop," bounded so a folder
   * of 38 clips doesn't fire 38 requests at once.
   */
  describeMany?(inputs: VisionClipInput[]): Promise<VisionOutcome[]>;
}
