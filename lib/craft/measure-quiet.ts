import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import {
  parseSilenceRegions,
  planQuietRemovals,
  rejectRegionsOverlappingWords,
  QUIET_NOISE_DB,
  MIN_QUIET_SEC,
} from "./quiet";
import type { CraftWord, Removal } from "./types";

/**
 * The I/O half of energy-based dead-air detection: runs ffmpeg over one span
 * of one file and reports the quiet inside it.
 *
 * Split from `quiet.ts` so the parsing and planning stay pure and testable —
 * the same reason `refine.ts`/`refine-plan.ts` and `validate.ts`/`script-apply.ts`
 * are split.
 */

/**
 * Runs ffmpeg and **fails loudly on a non-zero exit.**
 *
 * Checking the exit code is not defensive noise here. Without it, an
 * unreadable file makes ffmpeg print "No such file or directory", produce no
 * `silence_start` lines, and this function report *no silence found* — a
 * silent no-op that looks exactly like a clean measurement. That is the
 * failure mode this project has been burned by three times, and it was caught
 * in this very function during development.
 */
function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg-static did not resolve a binary path."));
    const child = spawn(ffmpegPath, args);
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        const tail = stderr.trim().split("\n").slice(-3).join("; ");
        reject(new Error(`ffmpeg exited ${code}: ${tail}`));
        return;
      }
      resolve(stderr);
    });
  });
}

/**
 * Measured quiet inside `[startSec, endSec]` of `filePath`, as removals in
 * source time.
 *
 * ffmpeg is seeked to the span and reports times relative to that seek, so
 * every region is shifted back to absolute source time before planning.
 */
export async function measureQuietRemovals(
  filePath: string,
  startSec: number,
  endSec: number,
  words: CraftWord[] = [],
  noiseDb = QUIET_NOISE_DB,
  minQuietSec = MIN_QUIET_SEC,
): Promise<Removal[]> {
  const duration = endSec - startSec;
  if (duration <= 0) return [];

  const stderr = await runFfmpeg([
    "-hide_banner",
    "-ss", String(startSec),
    "-t", String(duration),
    "-i", filePath,
    "-af", `silencedetect=noise=${noiseDb}dB:d=${minQuietSec}`,
    "-f", "null", "-",
  ]);

  const relative = parseSilenceRegions(stderr, duration);
  const absolute = relative.map((r) => ({
    startSec: r.startSec + startSec,
    endSec: r.endSec + startSec,
  }));

  // ffmpeg says where it is quiet; the transcript says where cutting is allowed.
  // Without this guard a stop consonant's silent closure reads as dead air and
  // the word gets cut in half.
  const safe = rejectRegionsOverlappingWords(absolute, words);

  return planQuietRemovals(safe, startSec, endSec, minQuietSec);
}
