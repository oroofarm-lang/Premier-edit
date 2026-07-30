import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

const execFileAsync = promisify(execFile);

async function extractOne(mediaFilePath: string, wavPath: string): Promise<void> {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static did not resolve a binary path.");
  }
  await execFileAsync(ffmpegPath, [
    "-y",
    "-i", mediaFilePath,
    "-vn",
    "-ar", "16000",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    wavPath,
  ]);
}

/**
 * Whisper models expect 16kHz mono PCM. Source clips are whatever the camera
 * or recorder produced, so normalize into a temp WAV first and hand the model
 * a format it won't have to resample itself.
 */
export async function withExtractedAudio<T>(
  mediaFilePath: string,
  run: (wavPath: string) => Promise<T>,
): Promise<T> {
  const workDir = await mkdtemp(path.join(tmpdir(), "premier-edit-audio-"));
  const wavPath = path.join(workDir, "audio.wav");

  try {
    await extractOne(mediaFilePath, wavPath);
    return await run(wavPath);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Batch variant: extracts every source into its own WAV inside one shared
 * temp dir (ffmpeg extraction is cheap — it's the model load that isn't),
 * hands the whole list to `run`, and cleans up once at the end.
 */
export async function withExtractedAudioMany<T>(
  mediaFilePaths: string[],
  run: (wavPaths: string[]) => Promise<T>,
): Promise<T> {
  const workDir = await mkdtemp(path.join(tmpdir(), "premier-edit-audio-"));

  try {
    const wavPaths = mediaFilePaths.map((_, i) =>
      path.join(workDir, `audio-${i}.wav`),
    );
    await Promise.all(
      mediaFilePaths.map((mediaFilePath, i) =>
        extractOne(mediaFilePath, wavPaths[i]),
      ),
    );
    return await run(wavPaths);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
