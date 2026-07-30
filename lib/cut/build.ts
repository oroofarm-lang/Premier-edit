import path from "node:path";
import { prisma } from "@/lib/db";
import { snapToWordBoundary } from "./snap";
import type { CutClip, CutTimeline } from "./types";
import type { TranscriptWord } from "@/lib/transcription/types";

/** Fallbacks for when the source material carries no usable video metadata. */
const DEFAULT_FPS = 25;
const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 1920;

/** All words across every segment of an asset's transcript, in one flat, time-sorted list. */
function wordsForAsset(transcriptSegmentsJson: string | undefined): TranscriptWord[] {
  if (!transcriptSegmentsJson) return [];
  const segments = JSON.parse(transcriptSegmentsJson) as {
    words?: TranscriptWord[];
  }[];
  return segments.flatMap((s) => s.words ?? []);
}

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
        include: { mediaAsset: { include: { transcript: true } } },
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

    const words = wordsForAsset(asset.transcript?.segmentsJson);
    const snapped = snapToWordBoundary(selection.startSec, selection.endSec, words);
    // Never let a snap reach past the file itself.
    const sourceInSec = Math.max(0, snapped.startSec);
    const sourceOutSec = asset.durationSec
      ? Math.min(asset.durationSec, snapped.endSec)
      : snapped.endSec;
    const length = sourceOutSec - sourceInSec;

    clips.push({
      filePath: asset.filePath,
      fileName: path.basename(asset.filePath),
      hasVideo: asset.width !== null && asset.height !== null,
      hasAudio: asset.sampleRate !== null || asset.kind === "AUDIO",
      sourceInSec,
      sourceOutSec,
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
