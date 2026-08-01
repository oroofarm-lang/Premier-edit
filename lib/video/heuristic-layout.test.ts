import { describe, expect, it } from "vitest";
import { planLayoutHeuristically } from "./heuristic-layout";
import { layOutSpine, validateLayout, type ShotCandidate } from "./layout-plan";

const spine = layOutSpine([
  { order: 0, fileName: "A.MP4", startSec: 0, endSec: 6, text: "", reason: "הוק: x" },
  { order: 1, fileName: "B.MP4", startSec: 0, endSec: 8, text: "", reason: "גוף: y" },
  { order: 2, fileName: "C.MP4", startSec: 0, endSec: 6, text: "", reason: "סיום: z" },
]);

/** A catalogue spread over several files, the shape lib/shots produces. */
function catalogue(): ShotCandidate[] {
  const files = ["A.MP4", "B.MP4", "C.MP4", "D.MP4", "E.MP4"];
  const out: ShotCandidate[] = [];
  for (const [f, fileName] of files.entries()) {
    for (let k = 0; k < 5; k++) {
      out.push({
        shotId: `${fileName}-${k}`,
        fileName,
        startSec: k * 6,
        endSec: k * 6 + 4,
        qualityScore: 0.9 - f * 0.05 - k * 0.02,
        movementCompleteness: 0.85,
        activity: 0.6,
        description: null,
        isSyncFor: [],
      });
    }
  }
  return out;
}

describe("planLayoutHeuristically", () => {
  it("produces a layout that passes the same validator the model must pass", () => {
    const shots = catalogue();
    const plan = planLayoutHeuristically(spine, shots, "SOCIAL_POST");
    expect(validateLayout(plan, shots, 20)).toEqual({ ok: true });
  });

  it("covers the spine exactly, with no gap and no overrun", () => {
    const shots = catalogue();
    const plan = planLayoutHeuristically(spine, shots, "SOCIAL_POST");
    expect(plan.placements[0].timelineStartSec).toBe(0);
    expect(plan.placements.at(-1)!.timelineEndSec).toBe(20);
    for (let i = 1; i < plan.placements.length; i++) {
      expect(plan.placements[i].timelineStartSec).toBeCloseTo(
        plan.placements[i - 1].timelineEndSec,
        2,
      );
    }
  });

  it("cuts the picture more often than the spine has moments", () => {
    const plan = planLayoutHeuristically(spine, catalogue(), "SOCIAL_POST");
    expect(plan.placements.length).toBeGreaterThan(spine.length);
  });

  it("spreads across source files instead of draining the best one", () => {
    const plan = planLayoutHeuristically(spine, catalogue(), "SOCIAL_POST");
    const shots = catalogue();
    const files = new Set(plan.placements.map((p) => shots[p.index].fileName));
    expect(files.size).toBeGreaterThan(2);
  });

  it("never reuses a shot", () => {
    const plan = planLayoutHeuristically(spine, catalogue(), "SOCIAL_POST");
    const indexes = plan.placements.map((p) => p.index);
    expect(new Set(indexes).size).toBe(indexes.length);
  });

  it("leaves source audio off, since the spine already carries the speech", () => {
    const plan = planLayoutHeuristically(spine, catalogue(), "SOCIAL_POST");
    expect(plan.placements.every((p) => p.useSourceAudio === false)).toBe(true);
  });

  it("still covers the spine when the catalogue is thin", () => {
    // Two shots for twenty seconds: it must stretch rather than leave a hole,
    // because a gap in the picture layer is a black frame.
    const thin: ShotCandidate[] = [
      { shotId: "a", fileName: "A.MP4", startSec: 0, endSec: 12, qualityScore: 0.8, movementCompleteness: 0.9, activity: 0.5, description: null, isSyncFor: [] },
      { shotId: "b", fileName: "B.MP4", startSec: 0, endSec: 12, qualityScore: 0.7, movementCompleteness: 0.9, activity: 0.5, description: null, isSyncFor: [] },
    ];
    const plan = planLayoutHeuristically(spine, thin, "SOCIAL_POST");
    expect(plan.placements.at(-1)!.timelineEndSec).toBe(20);
    expect(validateLayout(plan, thin, 20)).toEqual({ ok: true });
  });

  it("returns nothing rather than guessing when there are no shots", () => {
    expect(planLayoutHeuristically(spine, [], "SOCIAL_POST")).toEqual({ placements: [] });
  });
});
