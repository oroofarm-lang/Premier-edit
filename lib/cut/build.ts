import path from "node:path";
import { prisma } from "@/lib/db";
import type { CutClip, CutTimeline } from "./types";

/** Fallbacks for when the source material carries no usable video metadata. */
const DEFAULT_FPS = 25;
const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 1920;

/**
 * Turns approved selections into a butt-joined sequence: each chosen moment
 * follows the previous one with no gap. That is what "rough assembly" means
 * here — no transitions, no ripple trimming, no reordering beyond the
 * selection order the user already approved.
 */
export async function buildCutTimeline(projectId: string): Promise<CutTimeline> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: {
      selections: {
        orderBy: { order: "asc" },
        include: { mediaAsset: true },
      },
    },
  });

  if (project.selections.length === 0) {
    throw new Error(
      "Nothing selected yet — run content selection before building a cut.",
    );
  }

  // Take the sequence format from the first clip that actually has video;
  // an audio-only selection would otherwise produce a 0x0 sequence.
  const firstVideo = project.selections.find(
    (s) => s.mediaAsset.width !== null && s.mediaAsset.height !== null,
  );
  const fps = firstVideo?.mediaAsset.fps ?? DEFAULT_FPS;
  const width = firstVideo?.mediaAsset.width ?? DEFAULT_WIDTH;
  const height = firstVideo?.mediaAsset.height ?? DEFAULT_HEIGHT;

  const clips: CutClip[] = [];
  let playhead = 0;

  for (const selection of project.selections) {
    const asset = selection.mediaAsset;
    const length = selection.endSec - selection.startSec;

    clips.push({
      filePath: asset.filePath,
      fileName: path.basename(asset.filePath),
      hasVideo: asset.width !== null && asset.height !== null,
      hasAudio: asset.sampleRate !== null || asset.kind === "AUDIO",
      sourceInSec: selection.startSec,
      sourceOutSec: selection.endSec,
      timelineStartSec: playhead,
      timelineEndSec: playhead + length,
      sourceDurationSec: asset.durationSec ?? length,
      fps: asset.fps,
      width: asset.width,
      height: asset.height,
    });

    playhead += length;
  }

  return {
    name: project.name,
    fps,
    width,
    height,
    durationSec: Math.round(playhead * 1000) / 1000,
    clips,
  };
}
