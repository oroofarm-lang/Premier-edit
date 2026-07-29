import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

const execFileAsync = promisify(execFile);

/**
 * Whisper models expect 16kHz mono PCM. Source clips are whatever the camera
 * or recorder produced, so normalize into a temp WAV first and hand the model
 * a format it won't have to resample itself.
 */
export async function withExtractedAudio<T>(
  mediaFilePath: string,
  run: (wavPath: string) => Promise<T>,
): Promise<T> {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static did not resolve a binary path.");
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "premier-edit-audio-"));
  const wavPath = path.join(workDir, "audio.wav");

  try {
    await execFileAsync(ffmpegPath, [
      "-y",
      "-i", mediaFilePath,
      "-vn",
      "-ar", "16000",
      "-ac", "1",
      "-c:a", "pcm_s16le",
      wavPath,
    ]);
    return await run(wavPath);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
