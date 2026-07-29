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

  return {
    durationSec,
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps: parseFrameRate(video?.avg_frame_rate ?? video?.r_frame_rate),
    codec: video?.codec_name ?? audio?.codec_name ?? null,
    sampleRate: parseNumber(audio?.sample_rate),
    channels: audio?.channels ?? null,
  };
}
