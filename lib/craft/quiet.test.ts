import { describe, expect, it } from "vitest";
import { parseSilenceRegions, planQuietRemovals, QUIET_PAD_SEC } from "./quiet";

/** A realistic chunk of ffmpeg silencedetect stderr. */
const FFMPEG_STDERR = `
[silencedetect @ 0x14da04260] silence_start: 1.14
[silencedetect @ 0x14da04260] silence_end: 2.09 | silence_duration: 0.95
[silencedetect @ 0x14da04260] silence_start: 4.5
[silencedetect @ 0x14da04260] silence_end: 5.2 | silence_duration: 0.7
`;

describe("parseSilenceRegions", () => {
  it("reads every start/end pair out of ffmpeg's output", () => {
    expect(parseSilenceRegions(FFMPEG_STDERR)).toEqual([
      { startSec: 1.14, endSec: 2.09 },
      { startSec: 4.5, endSec: 5.2 },
    ]);
  });

  it("returns nothing when ffmpeg found no silence", () => {
    expect(parseSilenceRegions("size=0kB time=00:00:00.00\n")).toEqual([]);
  });

  it("closes a region ffmpeg left open at end of stream", () => {
    // silencedetect omits silence_end when the file ends mid-silence.
    const open = "[silencedetect] silence_start: 3.0\n";
    expect(parseSilenceRegions(open, 4.0)).toEqual([{ startSec: 3.0, endSec: 4.0 }]);
  });
});

describe("planQuietRemovals", () => {
  it("finds the real defect: quiet inside a single reported word span", () => {
    // The measured case from 0X7A1692 — "מרווה" is reported as 1.57-2.85 but
    // only the last third is speech. Times here are source-relative.
    const removals = planQuietRemovals(
      [{ startSec: 1.57, endSec: 2.52 }],
      0.43,
      2.85,
    );

    expect(removals).toHaveLength(1);
    // Padded on both sides, because speech sits on both sides of this quiet.
    expect(removals[0].startSec).toBeCloseTo(1.57 + QUIET_PAD_SEC, 5);
    expect(removals[0].endSec).toBeCloseTo(2.52 - QUIET_PAD_SEC, 5);
    expect(removals[0].kind).toBe("silence");
  });

  it("ignores a dip too short to be worth splicing", () => {
    expect(planQuietRemovals([{ startSec: 1.0, endSec: 1.2 }], 0, 5)).toEqual([]);
  });

  it("does not pad against the span edge, where there is no speech to protect", () => {
    // Quiet running to the very end of the span: nothing on its right.
    const removals = planQuietRemovals([{ startSec: 3.0, endSec: 5.0 }], 0, 5);
    expect(removals).toHaveLength(1);
    expect(removals[0].startSec).toBeCloseTo(3.0 + QUIET_PAD_SEC, 5);
    expect(removals[0].endSec).toBeCloseTo(5.0, 5);
  });

  it("clamps a region that ffmpeg reported outside the span", () => {
    const removals = planQuietRemovals([{ startSec: -1, endSec: 2.0 }], 0.5, 5);
    expect(removals[0].startSec).toBeCloseTo(0.5, 5);
  });

  it("drops a region that is entirely outside the span", () => {
    expect(planQuietRemovals([{ startSec: 8, endSec: 9 }], 0, 5)).toEqual([]);
  });
});
