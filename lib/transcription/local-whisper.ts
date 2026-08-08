import { spawn } from "node:child_process";
import path from "node:path";
import { withExtractedAudio, withExtractedAudioMany } from "./extract-audio";
import type {
  TranscribeOptions,
  Transcriber,
  TranscriptionOutcome,
  TranscriptionResult,
  TranscriptSegment,
} from "./types";

const PROJECT_ROOT = process.cwd();
const VENV_PYTHON = path.join(PROJECT_ROOT, ".venv", "bin", "python");
const SCRIPT = path.join(PROJECT_ROOT, "scripts", "transcribe.py");
const MODEL_DIR = path.join(PROJECT_ROOT, "models");

export type LocalWhisperOptions = {
  /** faster-whisper model size. large-v3 is the most accurate for Hebrew. */
  model?: string;
};

export type RawWhisperResult =
  | {
      path: string;
      language: string;
      languageProbability: number;
      durationSec: number;
      text: string;
      segments: {
        start: number;
        end: number;
        text: string;
        words?: { word: string; start: number; end: number }[];
      }[];
    }
  | { path: string; error: string };

export function toTranscriptionResult(
  raw: RawWhisperResult,
  engine: string,
): TranscriptionResult {
  if ("error" in raw) {
    throw new Error(raw.error);
  }
  return {
    engine,
    language: raw.language,
    text: raw.text,
    segments: raw.segments.map(
      (s): TranscriptSegment => ({
        startSec: s.start,
        endSec: s.end,
        text: s.text,
        words: s.words?.map((w) => ({
          word: w.word,
          startSec: w.start,
          endSec: w.end,
        })),
      }),
    ),
  };
}

/**
 * Runs faster-whisper locally via the project venv. Nothing leaves the
 * machine, which also sidesteps the privacy question the PRD raises about
 * cloud transcription of client footage.
 */
export class LocalWhisperTranscriber implements Transcriber {
  readonly name: string;
  private readonly model: string;

  constructor(options: LocalWhisperOptions = {}) {
    this.model = options.model ?? "large-v3";
    this.name = `local-whisper:${this.model}`;
  }

  async transcribe(
    mediaFilePath: string,
    options: TranscribeOptions = {},
  ): Promise<TranscriptionResult> {
    return withExtractedAudio(mediaFilePath, async (wavPath) => {
      const [raw] = await this.runPython([wavPath], options);
      return toTranscriptionResult(raw, this.name);
    });
  }

  /**
   * Transcribes many files in one model load. Extraction still happens per
   * file (cheap), but the python process — and the ~10s weight load that
   * dominates a short clip's runtime — is shared across the whole batch.
   */
  async transcribeMany(
    mediaFilePaths: string[],
    options: TranscribeOptions = {},
  ): Promise<TranscriptionOutcome[]> {
    if (mediaFilePaths.length === 0) return [];

    return withExtractedAudioMany(mediaFilePaths, async (wavPaths) => {
      const rawResults = await this.runPython(wavPaths, options);
      return rawResults.map((raw, i) => {
        const filePath = mediaFilePaths[i];
        if ("error" in raw) {
          return { filePath, ok: false, error: raw.error };
        }
        return { filePath, ok: true, result: toTranscriptionResult(raw, this.name) };
      });
    });
  }

  /** Spawns one python process covering every path in `wavPaths`, in order. */
  private runPython(
    wavPaths: string[],
    options: TranscribeOptions,
  ): Promise<RawWhisperResult[]> {
    const language = options.language ?? "he";

    return new Promise((resolve, reject) => {
      const child = spawn(VENV_PYTHON, [
        SCRIPT,
        ...wavPaths,
        "--model", this.model,
        "--language", language,
        "--model-dir", MODEL_DIR,
      ]);

      let stdout = "";
      let stderrTail = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });

      child.stderr.on("data", (chunk) => {
        const text = String(chunk);
        // Keep only the tail; model downloads emit a lot of progress noise.
        stderrTail = (stderrTail + text).slice(-4000);
        options.onProgress?.(text.trim());
      });

      child.on("error", (error) =>
        reject(
          new Error(
            `Could not start the local transcriber (${VENV_PYTHON}). ` +
              `Run scripts/setup-transcription.sh first. Cause: ${error.message}`,
          ),
        ),
      );

      child.on("close", (code) => {
        if (code !== 0) {
          reject(
            new Error(`Transcription failed (exit ${code}):\n${stderrTail}`),
          );
          return;
        }

        try {
          resolve(JSON.parse(stdout));
        } catch (error) {
          reject(
            new Error(
              `Could not parse transcriber output: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          );
        }
      });
    });
  }
}
