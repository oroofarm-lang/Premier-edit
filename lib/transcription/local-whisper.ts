import { spawn } from "node:child_process";
import path from "node:path";
import { withExtractedAudio } from "./extract-audio";
import type {
  TranscribeOptions,
  Transcriber,
  TranscriptionResult,
} from "./types";

const PROJECT_ROOT = process.cwd();
const VENV_PYTHON = path.join(PROJECT_ROOT, ".venv", "bin", "python");
const SCRIPT = path.join(PROJECT_ROOT, "scripts", "transcribe.py");
const MODEL_DIR = path.join(PROJECT_ROOT, "models");

export type LocalWhisperOptions = {
  /** faster-whisper model size. large-v3 is the most accurate for Hebrew. */
  model?: string;
};

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
    return withExtractedAudio(mediaFilePath, (wavPath) =>
      this.runPython(wavPath, options),
    );
  }

  private runPython(
    wavPath: string,
    options: TranscribeOptions,
  ): Promise<TranscriptionResult> {
    const language = options.language ?? "he";

    return new Promise((resolve, reject) => {
      const child = spawn(VENV_PYTHON, [
        SCRIPT,
        wavPath,
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
          const parsed = JSON.parse(stdout);
          resolve({
            engine: this.name,
            language: parsed.language,
            text: parsed.text,
            segments: parsed.segments.map(
              (s: { start: number; end: number; text: string }) => ({
                startSec: s.start,
                endSec: s.end,
                text: s.text,
              }),
            ),
          });
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
