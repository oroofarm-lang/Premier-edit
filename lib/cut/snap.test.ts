import { describe, expect, it } from "vitest";
import { snapToWordBoundary } from "./snap";

describe("snapToWordBoundary", () => {
  const words = [
    { startSec: 1.0, endSec: 1.5 }, // "word A"
    { startSec: 1.6, endSec: 2.4 }, // "word B"
    { startSec: 2.7, endSec: 3.2 }, // "word C"
  ];

  it("pulls a start that lands mid-word back to before that word, minus pre-roll", () => {
    // 1.2 is inside word A (1.0-1.5) — should snap out to just before it.
    const result = snapToWordBoundary(1.2, 3.5, words);
    expect(result.startSec).toBeCloseTo(1.0 - 0.12, 5);
  });

  it("pushes an end that lands mid-word forward to after that word, plus breath tail", () => {
    // 2.2 is inside word B (1.6-2.4) — should snap out to just after it.
    const result = snapToWordBoundary(0.5, 2.2, words);
    expect(result.endSec).toBeCloseTo(2.4 + 0.2, 5);
  });

  it("leaves a boundary unchanged when it already sits in a gap between words", () => {
    // 1.55 is between word A's end (1.5) and word B's start (1.6) — a clean gap.
    const result = snapToWordBoundary(1.55, 3.5, words);
    expect(result.startSec).toBe(1.55);
  });

  it("passes through unchanged when there are no words at all", () => {
    const result = snapToWordBoundary(1.2, 2.2, []);
    expect(result).toEqual({ startSec: 1.2, endSec: 2.2 });
  });

  it("clamps the start snap so it never overlaps the previous word", () => {
    const tightWords = [
      { startSec: 1.0, endSec: 1.19 }, // ends just 0.01s before the pre-roll would reach
      { startSec: 1.2, endSec: 1.8 },
    ];
    // 1.5 is inside the second word; a full 0.12s pre-roll would land at 1.08,
    // which overlaps the first word (ends 1.19) — must clamp to 1.19 instead.
    const result = snapToWordBoundary(1.5, 3.5, tightWords);
    expect(result.startSec).toBe(1.19);
  });

  it("clamps the end snap so it never overlaps the next word", () => {
    const tightWords = [
      { startSec: 1.0, endSec: 1.5 },
      { startSec: 1.55, endSec: 2.0 }, // starts just 0.05s after word A ends
    ];
    // 1.2 is inside word A; a full 0.2s breath tail would land at 1.7, which
    // overlaps word B (starts 1.55) — must clamp to 1.55 instead.
    const result = snapToWordBoundary(0.5, 1.2, tightWords);
    expect(result.endSec).toBe(1.55);
  });
});
