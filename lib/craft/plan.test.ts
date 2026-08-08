import { describe, expect, it } from "vitest";
import { findFillerRemovals } from "./fillers";
import { findGaps, findSilenceRemovals, SILENCE_PAD_SEC } from "./silence";
import { mergeRemovals, planCleanup, subtractRemovals } from "./plan";
import type { CraftWord, SpineMomentInput } from "./types";

/** Contiguous words, the way faster-whisper actually emits them. */
function speech(from: number, count: number, step = 0.5): CraftWord[] {
  return Array.from({ length: count }, (_, i) => ({
    word: `מילה${i}`,
    startSec: from + i * step,
    endSec: from + (i + 1) * step,
  }));
}

function moment(over: Partial<SpineMomentInput> = {}): SpineMomentInput {
  return {
    order: 0,
    mediaAssetId: "asset-1",
    fileName: "clip.mp4",
    startSec: 0,
    endSec: 10,
    text: "טקסט",
    score: 1,
    reason: null,
    ...over,
  };
}

describe("findGaps", () => {
  it("reports the lead-in, the interior pause and the tail", () => {
    const words = [...speech(2, 2), ...speech(6, 2)];
    expect(findGaps(words, 0, 10)).toEqual([
      { startSec: 0, endSec: 2 },
      { startSec: 3, endSec: 6 },
      { startSec: 7, endSec: 10 },
    ]);
  });

  it("treats a span with no words as entirely silent", () => {
    expect(findGaps([], 1, 4)).toEqual([{ startSec: 1, endSec: 4 }]);
  });

  it("does not invent a backwards gap when whisper overlaps two words", () => {
    const words: CraftWord[] = [
      { word: "a", startSec: 0, endSec: 5 },
      { word: "b", startSec: 1, endSec: 2 },
      { word: "c", startSec: 6, endSec: 7 },
    ];
    expect(findGaps(words, 0, 7)).toEqual([{ startSec: 5, endSec: 6 }]);
  });
});

describe("findSilenceRemovals", () => {
  it("ignores a pause below the threshold", () => {
    const words = [...speech(0, 2), ...speech(1.4, 2)];
    expect(findSilenceRemovals(words, 0, 2.4)).toEqual([]);
  });

  it("pads both sides of an interior pause", () => {
    const words = [...speech(0, 2), ...speech(4, 2)];
    const [removal] = findSilenceRemovals(words, 0, 5);
    expect(removal.kind).toBe("silence");
    expect(removal.startSec).toBeCloseTo(1 + SILENCE_PAD_SEC, 5);
    expect(removal.endSec).toBeCloseTo(4 - SILENCE_PAD_SEC, 5);
  });

  it("pads only the speech side of a lead-in", () => {
    const words = speech(3, 2);
    const [removal] = findSilenceRemovals(words, 0, 4);
    expect(removal.startSec).toBe(0);
    expect(removal.endSec).toBeCloseTo(3 - SILENCE_PAD_SEC, 5);
  });

  it("skips a pause whose padded remainder is not worth a splice", () => {
    // 0.8s gap, 0.35s padding each side leaves 0.1s — below MIN_REMOVAL_SEC.
    const words = [...speech(0, 2), ...speech(1.8, 2)];
    expect(findSilenceRemovals(words, 0, 2.8)).toEqual([]);
  });
});

describe("findFillerRemovals", () => {
  it("matches a filler through its punctuation", () => {
    const words: CraftWord[] = [
      { word: "טוב", startSec: 0, endSec: 1 },
      { word: "כאילו,", startSec: 1, endSec: 1.4 },
    ];
    const [removal] = findFillerRemovals(words, 0, 2);
    expect(removal.kind).toBe("filler");
    expect(removal.startSec).toBe(1);
    expect(removal.endSec).toBe(1.4);
  });

  it("matches a two-word filler as one span", () => {
    const words: CraftWord[] = [
      { word: "סוג", startSec: 0, endSec: 0.4 },
      { word: "של", startSec: 0.4, endSec: 0.7 },
      { word: "דבר", startSec: 0.7, endSec: 1.2 },
    ];
    const removals = findFillerRemovals(words, 0, 2);
    expect(removals).toHaveLength(1);
    expect(removals[0].endSec).toBe(0.7);
  });

  it("leaves a real word that merely starts with a Hebrew prefix", () => {
    const words: CraftWord[] = [{ word: "ואהה", startSec: 0, endSec: 1 }];
    expect(findFillerRemovals(words, 0, 2)).toEqual([]);
  });
});

describe("mergeRemovals", () => {
  it("merges a filler that sits against a pause into one span", () => {
    const merged = mergeRemovals(
      [
        { kind: "filler", startSec: 1, endSec: 1.6, label: "f" },
        { kind: "silence", startSec: 1.5, endSec: 3, label: "s" },
      ],
      0,
      5,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ startSec: 1, endSec: 3 });
  });

  it("clamps a removal that reaches past the moment", () => {
    const [merged] = mergeRemovals(
      [{ kind: "silence", startSec: -2, endSec: 12, label: "s" }],
      0,
      5,
    );
    expect(merged).toMatchObject({ startSec: 0, endSec: 5 });
  });
});

describe("subtractRemovals", () => {
  it("leaves the pieces on either side of a removal", () => {
    expect(
      subtractRemovals(0, 10, [{ kind: "silence", startSec: 4, endSec: 6, label: "s" }]),
    ).toEqual([
      { startSec: 0, endSec: 4 },
      { startSec: 6, endSec: 10 },
    ]);
  });
});

describe("planCleanup", () => {
  const words = [...speech(0, 4), ...speech(6, 4)];

  it("splits one moment into two fragments and renumbers the spine", () => {
    const plan = planCleanup([moment({ endSec: 8 })], { "asset-1": words });

    expect(plan.moments).toHaveLength(2);
    expect(plan.moments.map((m) => m.order)).toEqual([0, 1]);
    expect(plan.moments.every((m) => m.sourceOrder === 0)).toBe(true);
    expect(plan.removals).toHaveLength(1);
    expect(plan.durationAfterSec).toBeLessThan(plan.durationBeforeSec);
    expect(plan.secondsRemoved).toBeGreaterThan(0);
  });

  it("keeps the spine untouched when the asset has no word timings", () => {
    const plan = planCleanup([moment({ endSec: 8 })], {});
    expect(plan.moments).toHaveLength(1);
    expect(plan.removals).toEqual([]);
    expect(plan.secondsRemoved).toBe(0);
  });

  it("never lets a removal reach past the source file", () => {
    const plan = planCleanup([moment({ endSec: 30 })], { "asset-1": words }, {
      durationByAssetId: { "asset-1": 8 },
    });
    for (const m of plan.moments) expect(m.endSec).toBeLessThanOrEqual(8);
    for (const r of plan.removals) expect(r.endSec).toBeLessThanOrEqual(8);
  });

  it("warns instead of deleting a moment that is all dead air", () => {
    const plan = planCleanup([moment({ endSec: 9 })], { "asset-1": speech(20, 2) });
    expect(plan.moments).toHaveLength(1);
    expect(plan.moments[0].endSec).toBe(9);
    expect(plan.warnings).toHaveLength(1);
  });

  it("drops a surviving fragment too short to read as a moment", () => {
    // Speech at 0-0.4 then a long pause then speech from 6: the opening 0.4s
    // fragment is below MIN_FRAGMENT_SEC and must not become its own clip.
    const sparse: CraftWord[] = [
      { word: "א", startSec: 0, endSec: 0.4 },
      ...speech(6, 4),
    ];
    const plan = planCleanup([moment({ endSec: 8 })], { "asset-1": sparse });
    expect(plan.moments.every((m) => m.endSec - m.startSec >= 0.7)).toBe(true);
  });

  it("can be told to leave silence alone", () => {
    const plan = planCleanup([moment({ endSec: 8 })], { "asset-1": words }, {
      removeSilence: false,
    });
    expect(plan.removals).toEqual([]);
  });
});
