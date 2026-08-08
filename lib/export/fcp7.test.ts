import { describe, expect, it } from "vitest";
import { buildFcp7Xml } from "./fcp7";
import type { CutClip, CutTimeline } from "@/lib/cut/types";

function clip(overrides: Partial<CutClip> & Pick<CutClip, "filePath" | "fileName">): CutClip {
  return {
    hasVideo: true,
    hasAudio: true,
    sourceInSec: 0,
    sourceOutSec: 3,
    audioInSec: 0,
    audioOutSec: 3,
    timelineStartSec: 0,
    timelineEndSec: 3,
    sourceDurationSec: 20,
    fps: 50,
    width: 1080,
    height: 1920,
    ...overrides,
  };
}

/** The document's two tracks, without the <audio> blocks inside file definitions. */
function tracks(xml: string): { video: string; audio: string } {
  const [, video = "", audio = ""] =
    xml.match(/<video>\s*<format>[\s\S]*?<track>([\s\S]*?)<\/track>[\s\S]*?<audio>\s*<track>([\s\S]*?)<\/track>/) ?? [];
  return { video, audio };
}

describe("buildFcp7Xml", () => {
  const timeline: CutTimeline = {
    name: "b-roll",
    fps: 50,
    width: 1080,
    height: 1920,
    durationSec: 8,
    clips: [
      clip({ filePath: "/f/talking.mp4", fileName: "talking.mp4" }),
      clip({
        filePath: "/f/talking2.mp4",
        fileName: "talking2.mp4",
        sourceOutSec: 5,
        audioOutSec: 5,
        timelineStartSec: 3,
        timelineEndSec: 8,
        sourceDurationSec: 30,
        videoOverride: {
          filePath: "/f/broll.mp4",
          fileName: "broll.mp4",
          sourceInSec: 2,
          sourceOutSec: 7,
          sourceDurationSec: 25,
          fps: 25,
          width: 1080,
          height: 1920,
        },
      }),
    ],
  };

  it("defines every source file exactly once and leaves no dangling reference", () => {
    const xml = buildFcp7Xml(timeline);
    const definitions = [...xml.matchAll(/<file id="([^"]+)">/g)].map((m) => m[1]);
    const references = [...xml.matchAll(/<file id="([^"]+)"\/>/g)].map((m) => m[1]);

    expect(new Set(definitions).size).toBe(definitions.length);
    expect(definitions).toHaveLength(3);
    for (const ref of references) expect(definitions).toContain(ref);
  });

  it("puts the override's footage on the video track and keeps the moment's own audio", () => {
    const { video, audio } = tracks(buildFcp7Xml(timeline));

    expect(video).toContain("broll.mp4");
    expect(video).not.toContain("talking2.mp4");
    expect(audio).toContain("talking2.mp4");
    expect(audio).not.toContain("broll.mp4");
  });

  it("counts the override's in/out in the override file's own frame rate", () => {
    const { video } = tracks(buildFcp7Xml(timeline));
    const brollItem = video.split("<clipitem").find((c) => c.includes("broll.mp4"))!;

    // 2s and 7s at the override's own 25fps — not the 50fps narration clip's.
    expect(brollItem).toContain("<in>50</in>");
    expect(brollItem).toContain("<out>175</out>");
    expect(brollItem).toContain("<timebase>25</timebase>");
  });

  it("still places the clip at its planned position on the timeline", () => {
    const { video } = tracks(buildFcp7Xml(timeline));
    const brollItem = video.split("<clipitem").find((c) => c.includes("broll.mp4"))!;

    // Timeline position is unaffected by which file supplies the picture.
    expect(brollItem).toContain("<start>150</start>");
    expect(brollItem).toContain("<end>400</end>");
  });
});
