import { describe, expect, it } from "vitest";
import { applyCraftCleanup } from "./craft-cleanup";
import type { CraftWord } from "@/lib/craft/types";
import type { ScriptLine } from "./types";

/** Contiguous words, the way faster-whisper actually emits them. */
function speech(from: number, count: number, step = 0.5): CraftWord[] {
  return Array.from({ length: count }, (_, i) => ({
    word: `מילה${i}`,
    startSec: from + i * step,
    endSec: from + (i + 1) * step,
  }));
}

function line(over: Partial<ScriptLine> = {}): ScriptLine {
  return {
    order: 0,
    mediaAssetId: "asset-1",
    startSec: 0,
    endSec: 2,
    text: "טקסט",
    reason: "כי כן",
    ...over,
  };
}

describe("applyCraftCleanup", () => {
  it("passes a line through unchanged when there is no removable gap", () => {
    // Matches the real project: internal word gaps here are all 0.16s or less.
    const words = speech(0, 4, 0.5); // 0-0.5, 0.5-1, 1-1.5, 1.5-2, back to back
    const result = applyCraftCleanup(
      [line({ startSec: 0, endSec: 2 })],
      { "asset-1": "clip.mp4" },
      { "asset-1": words },
      { "asset-1": null },
    );

    expect(result.selections).toEqual([
      { mediaAssetId: "asset-1", startSec: 0, endSec: 2, order: 0, score: 0, reason: "כי כן" },
    ]);
    expect(result.removalsCount).toBe(0);
    expect(result.secondsRemoved).toBe(0);
  });

  it("splits one line into two selections when a real interior gap is found", () => {
    // Two words, then a 1.5s silent gap, then two more words — a gap this
    // long is unambiguous dead air even under the padded threshold.
    const words = [...speech(0, 2, 0.5), ...speech(3, 2, 0.5)];
    const result = applyCraftCleanup(
      [line({ startSec: 0, endSec: 4, order: 0 })],
      { "asset-1": "clip.mp4" },
      { "asset-1": words },
      { "asset-1": null },
    );

    expect(result.selections).toHaveLength(2);
    expect(result.selections.map((s) => s.order)).toEqual([0, 1]);
    expect(result.selections[0].endSec).toBeLessThan(result.selections[1].startSec);
    // The reason is the writer's justification for the whole original line —
    // both fragments of it inherit that same justification, not half of it.
    expect(result.selections[0].reason).toBe("כי כן");
    expect(result.selections[1].reason).toBe("כי כן");
    expect(result.removalsCount).toBe(1);
    expect(result.secondsRemoved).toBeGreaterThan(0);
  });

  it("splices out quiet that was measured from the audio, not from word timings", () => {
    // The real defect: words are contiguous (no gap to find), but the audio is
    // silent for ~0.95s inside the last word's reported span. Only a measured
    // removal can catch this — see lib/craft/quiet.ts.
    const contiguous = speech(0, 4, 0.5); // 0-2, no gaps at all
    const result = applyCraftCleanup(
      [line({ startSec: 0, endSec: 2 })],
      { "asset-1": "clip.mp4" },
      { "asset-1": contiguous },
      { "asset-1": null },
      { 0: [{ kind: "silence", startSec: 0.7, endSec: 1.3, label: "measured" }] },
    );

    expect(result.removalsCount).toBe(1);
    expect(result.selections).toHaveLength(2);
    expect(result.selections[0].endSec).toBeCloseTo(0.7, 5);
    expect(result.selections[1].startSec).toBeCloseTo(1.3, 5);
  });

  it("keeps a short fragment of speech rather than deleting it to remove a pause", () => {
    // The measured case from 0X7A1692, exactly: a 2.42s line with a 0.78s
    // pause leaves fragments of 1.26s and 0.38s. Under the picture layer's
    // 0.7s floor that 0.38s — the word "מרווה", the point of the line — was
    // silently discarded. Removing a pause must never cost a word.
    const words = speech(0.43, 4, 0.6);
    const result = applyCraftCleanup(
      [line({ startSec: 0.43, endSec: 2.85 })],
      { "asset-1": "clip.mp4" },
      { "asset-1": words },
      { "asset-1": null },
      { 0: [{ kind: "silence", startSec: 1.69, endSec: 2.47, label: "measured" }] },
    );

    expect(result.selections).toHaveLength(2);
    const spans = result.selections.map((s) => Number((s.endSec - s.startSec).toFixed(2)));
    expect(spans).toEqual([1.26, 0.38]);
    // Total kept must equal the line minus exactly the pause — nothing else.
    const kept = spans.reduce((a, b) => a + b, 0);
    expect(kept).toBeCloseTo(2.42 - 0.78, 2);
  });

  it("renumbers order contiguously from 0 across multiple lines after a split", () => {
    const gappyWords = [...speech(0, 2, 0.5), ...speech(3, 2, 0.5)];
    const tightWords = speech(10, 2, 0.5);
    const result = applyCraftCleanup(
      [
        line({ order: 0, mediaAssetId: "asset-1", startSec: 0, endSec: 4 }),
        line({ order: 1, mediaAssetId: "asset-2", startSec: 10, endSec: 11 }),
      ],
      { "asset-1": "a.mp4", "asset-2": "b.mp4" },
      { "asset-1": gappyWords, "asset-2": tightWords },
      { "asset-1": null, "asset-2": null },
    );

    expect(result.selections.map((s) => s.order)).toEqual([0, 1, 2]);
    expect(result.selections.map((s) => s.mediaAssetId)).toEqual([
      "asset-1",
      "asset-1",
      "asset-2",
    ]);
  });
});
