import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

const execFileAsync = promisify(execFile);

export type ProbeResult = {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  codec: string | null;
  sampleRate: number | null;
  channels: number | null;
};

type FfprobeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
  side_data_list?: { side_data_type?: string; rotation?: number }[];
  tags?: { rotate?: string };
};

type FfprobeOutput = {
  streams?: FfprobeStream[];
  format?: { duration?: string };
};

// ffprobe reports frame rate as a "30000/1001" style rational string.
function parseFrameRate(rate: string | undefined): number | null {
  if (!rate) return null;
  const [num, den] = rate.split("/").map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  const fps = num / den;
  return fps > 0 ? Math.round(fps * 1000) / 1000 : null;
}

function parseNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Phones and cameras routinely store frames landscape and flag a 90/270°
 * rotation to be applied at playback — every NLE (and QuickTime, and the
 * phone itself) shows the clip upright, but the encoded width/height are
 * still landscape. Reading width/height straight off the stream without
 * checking this is how a vertical shoot ends up in a horizontal sequence.
 */
function parseRotationDegrees(video: FfprobeStream | undefined): number {
  const displayMatrix = video?.side_data_list?.find(
    (s) => s.side_data_type === "Display Matrix" && typeof s.rotation === "number",
  );
  if (displayMatrix) return displayMatrix.rotation as number;
  const tagRotate = Number(video?.tags?.rotate);
  return Number.isFinite(tagRotate) ? tagRotate : 0;
}

function isQuarterTurn(rotationDegrees: number): boolean {
  const normalized = ((rotationDegrees % 360) + 360) % 360;
  return Math.abs(normalized - 90) < 1 || Math.abs(normalized - 270) < 1;
}

export async function probeMediaFile(filePath: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync(ffprobeInstaller.path, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);

  const parsed: FfprobeOutput = JSON.parse(stdout);
  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");

  const durationSec =
    parseNumber(parsed.format?.duration) ??
    parseNumber(video?.duration) ??
    parseNumber(audio?.duration);

  const rotated = isQuarterTurn(parseRotationDegrees(video));
  const rawWidth = video?.width ?? null;
  const rawHeight = video?.height ?? null;

  return {
    durationSec,
    width: rotated ? rawHeight : rawWidth,
    height: rotated ? rawWidth : rawHeight,
    // r_frame_rate is the container's declared nominal rate (e.g. exactly
    // 50/1). avg_frame_rate is computed from frame count / duration and comes
    // out slightly off for almost every real file (e.g. 13300/267 = 49.81 for
    // footage that is actually a clean 50fps) — using it here would tag every
    // clip with a fractional rate and wrongly trip the FCP7 NTSC flag.
    fps: parseFrameRate(video?.r_frame_rate ?? video?.avg_frame_rate),
    codec: video?.codec_name ?? audio?.codec_name ?? null,
    sampleRate: parseNumber(audio?.sample_rate),
    channels: audio?.channels ?? null,
  };
}
