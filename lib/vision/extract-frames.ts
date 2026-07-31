import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

const execFileAsync = promisify(execFile);

/** Fraction of the clip's duration to sample a frame at. */
const SAMPLE_POINTS = [0.1, 0.5, 0.9];

/**
 * Grabs a few representative frames from a clip as JPEGs. ffmpeg applies the
 * container's rotation tag automatically when it decodes a frame to an
 * image, so these come out right-side-up even for the phone/camera footage
 * that stores pixels landscape and flags a 90° rotation (see probe.ts) —
 * unlike ffprobe's raw width/height, we don't have to correct for that here.
 *
 * `range`, when given, samples the 10/50/90% points of that sub-range
 * instead of the whole file — this is what makes two different transcript
 * segments of one long clip get frames from their own moment rather than
 * three frames that describe the file in general.
 */
export async function withExtractedFrames<T>(
  videoFilePath: string,
  durationSec: number,
  run: (framePaths: string[]) => Promise<T>,
  range?: { startSec: number; endSec: number },
): Promise<T> {
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static did not resolve a binary path.");
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "premier-edit-frames-"));

  try {
    const rangeStart = range ? Math.max(0, range.startSec) : 0;
    const rangeEnd = range ? Math.min(durationSec, range.endSec) : durationSec;
    const rangeSpan = Math.max(0, rangeEnd - rangeStart);

    const timestamps = SAMPLE_POINTS.map((fraction) =>
      Math.max(rangeStart, Math.min(rangeEnd, rangeStart + rangeSpan * fraction)),
    );

    const framePaths = await Promise.all(
      timestamps.map(async (timestamp, i) => {
        const framePath = path.join(workDir, `frame-${i}.jpg`);
        await execFileAsync(ffmpegPath as string, [
          "-y",
          "-ss", timestamp.toFixed(3),
          "-i", videoFilePath,
          "-frames:v", "1",
          "-vf", "scale=768:-2",
          "-q:v", "4",
          framePath,
        ]);
        return framePath;
      }),
    );

    return await run(framePaths);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
