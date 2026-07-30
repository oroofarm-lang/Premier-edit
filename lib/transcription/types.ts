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

export type TranscriptionOutcome =
  | { filePath: string; ok: true; result: TranscriptionResult }
  | { filePath: string; ok: false; error: string };

export interface Transcriber {
  readonly name: string;
  transcribe(
    audioFilePath: string,
    options?: TranscribeOptions,
  ): Promise<TranscriptionResult>;
  /**
   * Optional batch path. A local model-based transcriber pays a large fixed
   * cost (loading model weights) per process it spawns; batching many files
   * into one process pays that cost once instead of once per file. A cloud
   * transcriber can simply not implement this — callers fall back to
   * transcribe() per file.
   */
  transcribeMany?(
    audioFilePaths: string[],
    options?: TranscribeOptions,
  ): Promise<TranscriptionOutcome[]>;
}
