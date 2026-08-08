import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { parseMetricSeries, parseSceneCuts } from "./metrics";
import type { ClipMetrics, SceneCut } from "./types";

const run = promisify(execFile);

/**
 * Analysis resolution. Everything is measured on a 240px-wide, 10fps
 * decimation of the clip: the signals here are about how the picture moves
 * and settles, which survives downscaling intact, while full-resolution
 * decoding of 4K/50fps footage would dominate the runtime for no gain.
 * Measured on real footage: ~15s for a 55s clip, roughly 3.5x realtime,
 * comparable to transcription.
 */
const ANALYSIS_FPS = 10;
const ANALYSIS_WIDTH = 240;

/** Scene-detection sensitivity. Lower finds more cuts. */
const SCENE_THRESHOLD = 12;

/** ffmpeg writes metadata to stderr paths but prints to stdout via `file=-`. */
const MAX_BUFFER = 64 * 1024 * 1024;

function ffmpeg(): string {
  if (!ffmpegPath) {
    throw new Error(
      "ffmpeg-static did not resolve a binary path. See CLAUDE.md — this " +
        "machine has no system ffmpeg, the binaries come from npm.",
    );
  }
  return ffmpegPath;
}

async function runFilter(filePath: string, filter: string): Promise<string> {
  const { stdout } = await run(
    ffmpeg(),
    [
      "-hide_banner",
      "-nostdin",
      "-i",
      filePath,
      "-vf",
      filter,
      "-an",
      "-f",
      "null",
      "-",
    ],
    { maxBuffer: MAX_BUFFER },
  );
  return stdout;
}

const BASE = `fps=${ANALYSIS_FPS},scale=${ANALYSIS_WIDTH}:-2`;

/**
 * The motion curve: mean luma of the difference between consecutive sampled
 * frames. `tblend=all_mode=difference` produces the difference image and
 * `signalstats` reduces it to one number per frame.
 */
export async function measureMotion(filePath: string) {
  const output = await runFilter(
    filePath,
    `${BASE},tblend=all_mode=difference,signalstats,` +
      `metadata=print:key=lavfi.signalstats.YAVG:file=-`,
  );
  return parseMetricSeries(output, "lavfi.signalstats.YAVG");
}

/**
 * Sharpness, exposure and scene cuts in **one** pass.
 *
 * All three read the original frames — blur measured on a frame-difference
 * image would be meaningless, and `scdet` compares real frames — so they
 * share a decode. Only the motion curve needs its own pass, because
 * `tblend` replaces each frame with a difference image and nothing
 * downstream of it sees the original picture again. Two passes instead of
 * three cut measured runtime by about a third.
 */
export async function measureAppearanceAndCuts(filePath: string) {
  const output = await runFilter(
    filePath,
    `${BASE},scdet=threshold=${SCENE_THRESHOLD},blurdetect,signalstats,` +
      `metadata=print:file=-`,
  );
  return {
    blur: parseMetricSeries(output, "lavfi.blur"),
    luma: parseMetricSeries(output, "lavfi.signalstats.YAVG"),
    cuts: parseSceneCuts(output),
  };
}

/**
 * Full measurement of one clip.
 *
 * The appearance pass is best-effort: if `blurdetect` is missing from
 * whatever ffmpeg build is installed, the motion curve alone still produces
 * usable windows, because scoring renormalises over whichever signals are
 * present. A missing filter degrades quality rather than failing the clip.
 */
export async function analyzeClip(
  filePath: string,
): Promise<{ metrics: ClipMetrics; cuts: SceneCut[] }> {
  const motionPromise = measureMotion(filePath);
  const appearancePromise = measureAppearanceAndCuts(filePath).catch(() => null);

  const [motion, appearance] = await Promise.all([
    motionPromise,
    appearancePromise,
  ]);

  return {
    metrics: {
      motion,
      blur: appearance?.blur.length ? appearance.blur : undefined,
      luma: appearance?.luma.length ? appearance.luma : undefined,
    },
    cuts: appearance?.cuts ?? [],
  };
}
