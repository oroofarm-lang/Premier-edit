// The transcription engine is deliberately not decided yet (see CLAUDE.md,
// "Open decisions resolved so far" #1). Everything downstream — content
// selection, captions — talks to this interface, so swapping a local Whisper
// for a cloud vendor later is a new implementation, not a rewrite.

export type TranscriptSegment = {
  startSec: number;
  endSec: number;
  text: string;
};

export type TranscriptionResult = {
  /** Engine identifier stored on the Transcript row, e.g. "local-whisper:large-v3". */
  engine: string;
  language: string;
  text: string;
  segments: TranscriptSegment[];
};

export type TranscribeOptions = {
  /** BCP-47-ish language hint. Hebrew ("he") is the default for this project. */
  language?: string;
  /** Called with human-readable progress lines for long files. */
  onProgress?: (message: string) => void;
};

export interface Transcriber {
  readonly name: string;
  transcribe(
    audioFilePath: string,
    options?: TranscribeOptions,
  ): Promise<TranscriptionResult>;
}
