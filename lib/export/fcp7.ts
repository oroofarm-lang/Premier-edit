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

  const lines = [
    `          <clipitem id="${id}">`,
    `            <name>${name}</name>`,
    `            <enabled>TRUE</enabled>`,
    `            <duration>${toFrames(clip.sourceDurationSec, sourceFps)}</duration>`,
    rateXml(sourceFps, "            "),
    `            <start>${toFrames(clip.timelineStartSec, sequenceFps)}</start>`,
    `            <end>${toFrames(clip.timelineEndSec, sequenceFps)}</end>`,
    `            <in>${toFrames(clip.sourceInSec, sourceFps)}</in>`,
    `            <out>${toFrames(clip.sourceOutSec, sourceFps)}</out>`,
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

  const audioClips = timeline.clips
    .map((clip, index) =>
      clip.hasAudio
        ? clipItemXml(clip, index, timeline, "audio", definedFiles)
        : null,
    )
    .filter((x): x is string => x !== null);

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
