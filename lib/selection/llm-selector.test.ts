import { describe, expect, it } from "vitest";
import { validatePlan } from "./llm-selector";
import type { CandidateSegment } from "./types";

function candidate(mediaAssetId: string, startSec: number, endSec: number): CandidateSegment {
  return { mediaAssetId, filePath: `/tmp/${mediaAssetId}.mp4`, startSec, endSec, text: "" };
}

describe("validatePlan", () => {
  const shortlist = [
    candidate("a", 0, 2),
    candidate("b", 0, 3),
    candidate("c", 0, 2.5),
    candidate("d", 0, 4),
  ];

  it("accepts a plan with a hook in the first 3 seconds and no clip reused too often", () => {
    const plan = {
      premise: "test",
      beatPlan: ["הוק", "גוף", "סיום"],
      choices: [
        { index: 0, score: 0.9, reason: "hook", beat: "הוק" },
        { index: 1, score: 0.8, reason: "body", beat: "גוף" },
        { index: 2, score: 0.7, reason: "end", beat: "סיום" },
      ],
    };
    expect(validatePlan(plan, shortlist)).toEqual({ ok: true });
  });

  it("rejects a plan whose first clip alone exceeds the hook window", () => {
    const plan = {
      premise: "test",
      beatPlan: ["גוף"],
      choices: [{ index: 3, score: 0.9, reason: "too long to open with", beat: "גוף" }],
    };
    // candidate "d" is 4 seconds — longer than the ~3s hook window on its own.
    const result = validatePlan(plan, shortlist);
    expect(result.ok).toBe(false);
  });

  it("rejects a plan that reuses the same media asset more than twice", () => {
    const repeatedShortlist = [
      candidate("a", 0, 1),
      candidate("a", 1, 2),
      candidate("a", 2, 3),
    ];
    const plan = {
      premise: "test",
      beatPlan: ["הוק", "גוף", "סיום"],
      choices: [
        { index: 0, score: 0.9, reason: "r1", beat: "הוק" },
        { index: 1, score: 0.8, reason: "r2", beat: "גוף" },
        { index: 2, score: 0.7, reason: "r3", beat: "סיום" },
      ],
    };
    const result = validatePlan(plan, repeatedShortlist);
    expect(result.ok).toBe(false);
  });

  it("rejects an empty selection list", () => {
    const plan = { premise: "test", beatPlan: [], choices: [] };
    expect(validatePlan(plan, shortlist)).toEqual({
      ok: false,
      reason: "The plan selected no clips.",
    });
  });

  it("accepts a videoFrom pointing at another moment the plan also selected", () => {
    const plan = {
      premise: "test",
      beatPlan: ["הוק", "גוף"],
      choices: [
        { index: 0, score: 0.9, reason: "hook", beat: "הוק" },
        { index: 1, score: 0.8, reason: "body over b-roll", beat: "גוף", videoFrom: 0 },
      ],
    };
    expect(validatePlan(plan, shortlist)).toEqual({ ok: true });
  });

  it("rejects a videoFrom pointing at a shortlist entry the plan did not select", () => {
    const plan = {
      premise: "test",
      beatPlan: ["הוק", "גוף"],
      choices: [
        { index: 0, score: 0.9, reason: "hook", beat: "הוק" },
        { index: 1, score: 0.8, reason: "body", beat: "גוף", videoFrom: 3 },
      ],
    };
    const result = validatePlan(plan, shortlist);
    expect(result.ok).toBe(false);
  });

  it("rejects a videoFrom that points at a moment which itself overrides its video", () => {
    const plan = {
      premise: "test",
      beatPlan: ["הוק", "גוף", "סיום"],
      choices: [
        { index: 0, score: 0.9, reason: "hook", beat: "הוק" },
        { index: 1, score: 0.8, reason: "body", beat: "גוף", videoFrom: 0 },
        { index: 2, score: 0.7, reason: "end", beat: "סיום", videoFrom: 1 },
      ],
    };
    const result = validatePlan(plan, shortlist);
    expect(result.ok).toBe(false);
  });
});
