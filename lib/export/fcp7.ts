import type { CutClip, CutTimeline } from "@/lib/cut/types";

/**
 * FCP7 XML ("xmeml") export — chosen for the MVP because Premiere Pro imports
 * it natively via File→Import with no plugin. See CLAUDE.md, open decision #2.
 *
 * Everything in this format is measured in frames, not seconds, so all timing
 * is converted through the sequence frame rate. Getting that conversion wrong
 * is the classic way to produce an XML that imports but drifts out of sync.
 */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Premiere expects a percent-encoded file:// URL. encodeURI leaves the path
 * separators alone but escapes spaces and non-ASCII, which matters here since
 * this project lives under a Hebrew directory name.
 */
function toFileUrl(filePath: string): string {
  return `file://localhost${encodeURI(filePath)}`;
}

function toFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

/** NTSC rates (29.97, 23.976, 59.94) are expressed as a rounded timebase + a flag. */
function rateXml(fps: number, indent: string): string {
  const isNtsc = Math.abs(fps - Math.round(fps)) > 0.001;
  const timebase = Math.round(fps);
  return [
    `${indent}<rate>`,
    `${indent}  <timebase>${timebase}</timebase>`,
    `${indent}  <ntsc>${isNtsc ? "TRUE" : "FALSE"}</ntsc>`,
    `${indent}</rate>`,
  ].join("\n");
}

function clipItemXml(
  clip: CutClip,
  index: number,
  timeline: CutTimeline,
  mediaType: "video" | "audio",
  definedFiles: Set<string>,
  edges: { startIsTransition?: boolean; endIsTransition?: boolean } = {},
): string {
  // Two different clocks are in play. <start>/<end> place the clip on the
  // timeline, so they count sequence frames. <in>/<out> point into the source
  // file, so they count that file's OWN frames — mixing the two is how a cut
  // that looks right in the XML ends up pulling the wrong footage.
  const sequenceFps = timeline.fps;
  const sourceFps = clip.fps ?? timeline.fps;
  const id = `clipitem-${mediaType}-${index + 1}`;
  const fileId = `file-${index + 1}`;
  const name = escapeXml(clip.fileName);

  // Audio uses the wider, handle-inclusive range reserved for the crossfade
  // to blend from (see CutClip.audioInSec/audioOutSec); video is untouched.
  const inSec = mediaType === "audio" ? clip.audioInSec : clip.sourceInSec;
  const outSec = mediaType === "audio" ? clip.audioOutSec : clip.sourceOutSec;

  const lines = [
    `          <clipitem id="${id}">`,
    `            <name>${name}</name>`,
    `            <enabled>TRUE</enabled>`,
    `            <duration>${toFrames(clip.sourceDurationSec, sourceFps)}</duration>`,
    rateXml(sourceFps, "            "),
    // Whichever edge touches a <transitionitem> must literally be -1, not a
    // computed frame number — that sentinel is how Premiere knows the
    // transition governs that boundary instead of a hard cut.
    `            <start>${edges.startIsTransition ? "-1" : toFrames(clip.timelineStartSec, sequenceFps)}</start>`,
    `            <end>${edges.endIsTransition ? "-1" : toFrames(clip.timelineEndSec, sequenceFps)}</end>`,
    `            <in>${toFrames(inSec, sourceFps)}</in>`,
    `            <out>${toFrames(outSec, sourceFps)}</out>`,
  ];

  // A <file> is defined in full exactly once, then referenced by id. The
  // definition has to go on whichever clipitem comes first — for an audio-only
  // source that is the audio track, and emitting only a bare reference there
  // would leave Premiere with media it cannot resolve.
  const needsDefinition = !definedFiles.has(fileId);
  if (needsDefinition) {
    definedFiles.add(fileId);
    lines.push(
      `            <file id="${fileId}">`,
      `              <name>${name}</name>`,
      `              <pathurl>${escapeXml(toFileUrl(clip.filePath))}</pathurl>`,
      rateXml(sourceFps, "              "),
      `              <duration>${toFrames(clip.sourceDurationSec, sourceFps)}</duration>`,
      `              <media>`,
    );
    if (clip.hasVideo) {
      lines.push(
        `                <video>`,
        `                  <samplecharacteristics>`,
        `                    <width>${clip.width ?? timeline.width}</width>`,
        `                    <height>${clip.height ?? timeline.height}</height>`,
        `                  </samplecharacteristics>`,
        `                </video>`,
      );
    }
    if (clip.hasAudio) {
      lines.push(
        `                <audio>`,
        `                  <channelcount>2</channelcount>`,
        `                </audio>`,
      );
    }
    lines.push(`              </media>`, `            </file>`);
  } else {
    lines.push(`            <file id="${fileId}"/>`);
  }

  // Tells Premiere which stream of the source feeds this audio clipitem.
  if (mediaType === "audio") {
    lines.push(
      `            <sourcetrack>`,
      `              <mediatype>audio</mediatype>`,
      `              <trackindex>1</trackindex>`,
      `            </sourcetrack>`,
    );
  }

  lines.push(`          </clipitem>`);
  return lines.join("\n");
}

/**
 * Must match lib/cut/build.ts's AUDIO_CROSSFADE_SEC — kept as a separate
 * constant because the export module shouldn't import an internal constant
 * from the cut-building module, but the two values are load-bearing together.
 */
const AUDIO_CROSSFADE_SEC_EXPORT = 0.15;

/**
 * The transitionitem sits centered on the original cutpoint (matches
 * Premiere's own default "center" alignment, confirmed against a real
 * Premiere-exported reference file).
 */
function audioTransitionXml(cutpointSec: number, sequenceFps: number): string {
  const halfFrames = toFrames(AUDIO_CROSSFADE_SEC_EXPORT / 2, sequenceFps);
  const cutFrame = toFrames(cutpointSec, sequenceFps);
  return [
    `          <transitionitem>`,
    `            <start>${cutFrame - halfFrames}</start>`,
    `            <end>${cutFrame + halfFrames}</end>`,
    `            <alignment>center</alignment>`,
    `            <effect>`,
    // "Constant Power" is only the label Premiere's UI shows — the real FCP7
    // effect id, confirmed against a Premiere-exported reference file, is this:
    `              <name>Cross Fade (+3dB)</name>`,
    `              <effectid>KGAudioTransCrossFade3dB</effectid>`,
    `              <effecttype>transition</effecttype>`,
    `              <mediatype>audio</mediatype>`,
    `            </effect>`,
    `          </transitionitem>`,
  ].join("\n");
}

export function buildFcp7Xml(timeline: CutTimeline): string {
  const { fps } = timeline;
  const durationFrames = toFrames(timeline.durationSec, fps);

  // Shared across both tracks: each source file is defined once in the whole
  // document, wherever it first appears, and referenced by id after that.
  const definedFiles = new Set<string>();

  const videoClips = timeline.clips
    .map((clip, index) =>
      clip.hasVideo
        ? clipItemXml(clip, index, timeline, "video", definedFiles)
        : null,
    )
    .filter((x): x is string => x !== null);

  // Track adjacency on both sides among audio-bearing clips only, so the
  // clipitem edges that touch a transition can be marked with the -1
  // sentinel and a <transitionitem> spliced in between them.
  const audioIndexed = timeline.clips
    .map((clip, index) => ({ clip, index }))
    .filter(({ clip }) => clip.hasAudio);

  const audioClips: string[] = [];
  audioIndexed.forEach(({ clip, index }, i) => {
    const prevEntry = audioIndexed[i - 1];
    const nextEntry = audioIndexed[i + 1];
    const touchesPrevTransition =
      prevEntry !== undefined && prevEntry.clip.timelineEndSec === clip.timelineStartSec;
    const touchesNextTransition =
      nextEntry !== undefined && nextEntry.clip.timelineStartSec === clip.timelineEndSec;

    audioClips.push(
      clipItemXml(clip, index, timeline, "audio", definedFiles, {
        startIsTransition: touchesPrevTransition,
        endIsTransition: touchesNextTransition,
      }),
    );
    if (touchesNextTransition) {
      audioClips.push(audioTransitionXml(clip.timelineEndSec, timeline.fps));
    }
  });

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE xmeml>`,
    `<xmeml version="5">`,
    `  <sequence id="sequence-1">`,
    `    <name>${escapeXml(timeline.name)}</name>`,
    `    <duration>${durationFrames}</duration>`,
    rateXml(fps, "    "),
    `    <media>`,
    `      <video>`,
    `        <format>`,
    `          <samplecharacteristics>`,
    rateXml(fps, "            "),
    `            <width>${timeline.width}</width>`,
    `            <height>${timeline.height}</height>`,
    `          </samplecharacteristics>`,
    `        </format>`,
    `        <track>`,
    ...videoClips,
    `        </track>`,
    `      </video>`,
    `      <audio>`,
    `        <track>`,
    ...audioClips,
    `        </track>`,
    `      </audio>`,
    `    </media>`,
    `  </sequence>`,
    `</xmeml>`,
    ``,
  ].join("\n");
}
