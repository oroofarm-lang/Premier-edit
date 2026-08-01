import { describe, expect, it } from "vitest";
import {
  buildLayoutPrompt,
  layOutSpine,
  parseLayoutPlan,
  targetPlacementCount,
  validateLayout,
} from "./layout-plan";
import type { LayoutPlacement, ShotCandidate } from "./layout-plan";

function shot(over: Partial<ShotCandidate> = {}): ShotCandidate {
  return {
    shotId: "s1",
    fileName: "A.MP4",
    startSec: 0,
    endSec: 4,
    qualityScore: 0.8,
    movementCompleteness: 0.9,
    activity: 0.7,
    description: "ידיים מוזגות תה",
    isSyncFor: [],
    ...over,
  };
}

function place(
  index: number,
  timelineStartSec: number,
  timelineEndSec: number,
): LayoutPlacement {
  return { index, timelineStartSec, timelineEndSec, reason: "r" };
}

describe("layOutSpine", () => {
  it("positions moments end to end from zero", () => {
    const laid = layOutSpine([
      { order: 0, fileName: "A.MP4", startSec: 10, endSec: 12, text: "א", reason: "הוק: פתיחה" },
      { order: 1, fileName: "B.MP4", startSec: 3, endSec: 6.5, text: "ב", reason: "גוף: הסבר" },
    ]);

    expect(laid[0].timelineStartSec).toBe(0);
    expect(laid[0].timelineEndSec).toBe(2);
    expect(laid[1].timelineStartSec).toBe(2);
    expect(laid[1].timelineEndSec).toBe(5.5);
  });

  it("extracts the beat from the selector's 'beat: reason' format", () => {
    const laid = layOutSpine([
      { order: 0, fileName: "A.MP4", startSec: 0, endSec: 1, text: "", reason: "שיא: מזיגה" },
      { order: 1, fileName: "B.MP4", startSec: 0, endSec: 1, text: "", reason: "no colon here" },
    ]);
    expect(laid[0].beat).toBe("שיא");
    expect(laid[1].beat).toBe("");
  });

  it("sorts by order rather than trusting input order", () => {
    const laid = layOutSpine([
      { order: 1, fileName: "B.MP4", startSec: 0, endSec: 2, text: "", reason: "" },
      { order: 0, fileName: "A.MP4", startSec: 0, endSec: 1, text: "", reason: "" },
    ]);
    expect(laid.map((m) => m.fileName)).toEqual(["A.MP4", "B.MP4"]);
  });
});

describe("validateLayout", () => {
  const candidates = [
    shot({ endSec: 3, fileName: "A.MP4" }),
    shot({ endSec: 4, fileName: "B.MP4" }),
    shot({ endSec: 2, fileName: "C.MP4" }),
  ];

  it("accepts a gapless layout covering the whole spine", () => {
    const plan = { placements: [place(0, 0, 3), place(1, 3, 6)] };
    expect(validateLayout(plan, candidates, 6)).toEqual({ ok: true });
  });

  it("rejects an empty layout", () => {
    expect(validateLayout({ placements: [] }, candidates, 6)).toEqual({
      ok: false,
      reason: "The layout placed no shots.",
    });
  });

  it("rejects a layout that does not start at zero", () => {
    const result = validateLayout({ placements: [place(0, 0.5, 3)] }, candidates, 3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("black frame");
  });

  it("rejects a gap between placements", () => {
    // The failure that matters most: a hole in the video layer is a black
    // frame in the finished cut, and nothing downstream would notice.
    const plan = { placements: [place(0, 0, 2), place(1, 2.5, 6)] };
    const result = validateLayout(plan, candidates, 6);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("Gap of 0.50s");
  });

  it("rejects overlapping placements", () => {
    const plan = { placements: [place(0, 0, 3), place(1, 2, 6)] };
    const result = validateLayout(plan, candidates, 6);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("overlap");
  });

  it("rejects a placement longer than the shot it comes from", () => {
    // A 2s shot cannot cover 5s of timeline; Premiere would run out of frames.
    const plan = { placements: [place(2, 0, 5)] };
    const result = validateLayout(plan, candidates, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("only has 2.0s");
  });

  it("rejects reusing the same shot twice", () => {
    const plan = { placements: [place(0, 0, 3), place(0, 3, 6)] };
    const result = validateLayout(plan, candidates, 6);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("used more than once");
  });

  it("rejects two adjacent spans of the same take back to back", () => {
    // Caught on the first real layout run: 0X7A1682 appeared at placements 3
    // and 4. Different shots, so the same-shot check passed, but the
    // execution layer only produces hard cuts and it reads as a jump.
    const adjacent = [
      shot({ startSec: 0, endSec: 3, fileName: "A.MP4" }),
      shot({ startSec: 3.2, endSec: 6.2, fileName: "A.MP4" }),
    ];
    const result = validateLayout(
      { placements: [place(0, 0, 3), place(1, 3, 6)] },
      adjacent,
      6,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("jump cut");
  });

  it("allows the same file back to back when the spans are a real angle apart", () => {
    // The user explicitly wants a subject revisited from several angles, and
    // in one continuous take those angles are distant moments of one file.
    // Banning the file outright fought that; source distance distinguishes.
    const differentAngles = [
      shot({ startSec: 0, endSec: 3, fileName: "A.MP4" }),
      shot({ startSec: 12, endSec: 15, fileName: "A.MP4" }),
    ];
    expect(
      validateLayout({ placements: [place(0, 0, 3), place(1, 3, 6)] }, differentAngles, 6),
    ).toEqual({ ok: true });
  });

  it("allows the same file again once another source separates them", () => {
    const spread = [
      shot({ endSec: 2, fileName: "A.MP4" }),
      shot({ endSec: 2, fileName: "B.MP4" }),
      shot({ startSec: 7, endSec: 9, fileName: "A.MP4" }),
    ];
    const plan = { placements: [place(0, 0, 2), place(1, 2, 4), place(2, 4, 6)] };
    expect(validateLayout(plan, spread, 6)).toEqual({ ok: true });
  });

  it("rejects a shot index that does not exist", () => {
    const result = validateLayout({ placements: [place(9, 0, 2)] }, candidates, 2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("does not exist");
  });

  it("rejects coverage that stops short of the spine", () => {
    const plan = { placements: [place(0, 0, 3)] };
    const result = validateLayout(plan, candidates, 6);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("covers 3.0s");
  });

  it("tolerates sub-frame floating point drift", () => {
    const plan = {
      placements: [place(0, 0, 2.999999), place(1, 3.000001, 6.0000001)],
    };
    expect(validateLayout(plan, candidates, 6)).toEqual({ ok: true });
  });

  it("sorts before checking, so out-of-order placements still validate", () => {
    const plan = { placements: [place(1, 3, 6), place(0, 0, 3)] };
    expect(validateLayout(plan, candidates, 6)).toEqual({ ok: true });
  });
});

describe("parseLayoutPlan", () => {
  it("parses a fenced JSON response", () => {
    const text = '```json\n{"placements":[{"index":1,"timelineStartSec":0,"timelineEndSec":2.5,"reason":"x"}]}\n```';
    expect(parseLayoutPlan(text).placements).toEqual([
      { index: 1, timelineStartSec: 0, timelineEndSec: 2.5, useSourceAudio: false, reason: "x" },
    ]);
  });

  it("defaults useSourceAudio to false rather than undefined", () => {
    // Off by default is a product decision, not an accident: the spine
    // already carries the speech, so a clip's own dialogue is noise.
    const plan = parseLayoutPlan('{"placements":[{"index":0,"timelineStartSec":0,"timelineEndSec":1}]}');
    expect(plan.placements[0].useSourceAudio).toBe(false);
  });

  it("keeps useSourceAudio when explicitly true", () => {
    const plan = parseLayoutPlan(
      '{"placements":[{"index":0,"timelineStartSec":0,"timelineEndSec":1,"useSourceAudio":true}]}',
    );
    expect(plan.placements[0].useSourceAudio).toBe(true);
  });

  it("throws when placements is missing", () => {
    expect(() => parseLayoutPlan('{"foo":1}')).toThrow(/placements/);
  });
});

describe("targetPlacementCount", () => {
  it("asks for more picture cuts than the audio has moments", () => {
    // The first real layout returned 12 placements over 34.8s, roughly one
    // per spoken moment. The user wanted markedly more.
    const count = targetPlacementCount(34.8, "SOCIAL_POST");
    expect(count.ideal).toBeGreaterThan(12);
    expect(count.min).toBeLessThan(count.ideal);
    expect(count.max).toBeGreaterThan(count.ideal);
  });

  it("still paces long-form less frantically than a reel", () => {
    expect(targetPlacementCount(60, "YOUTUBE_LONG").ideal).toBeLessThan(
      targetPlacementCount(60, "REEL_SHORT").ideal,
    );
  });
});

describe("buildLayoutPrompt", () => {
  const spine = layOutSpine([
    { order: 0, fileName: "A.MP4", startSec: 0, endSec: 2, text: "מוסיפים מרווה", reason: "הוק: פתיחה" },
  ]);

  it("states the fixed spine duration and includes the cinematography expert", () => {
    const prompt = buildLayoutPrompt(spine, [shot()], "SOCIAL_POST");
    expect(prompt).toContain("2.0 שניות");
    expect(prompt).toContain("שפה חזותית");
    expect(prompt).toContain("תראה את מה שמתואר, לא את מי שמתאר");
  });

  it("marks which shots could stay in sync", () => {
    const prompt = buildLayoutPrompt(spine, [shot({ isSyncFor: [0] })], "SOCIAL_POST");
    expect(prompt).toContain("סנכרון אפשרי לרגעים: 0");
  });

  it("says so when a shot has no description rather than leaving a blank", () => {
    const prompt = buildLayoutPrompt(spine, [shot({ description: null })], "SOCIAL_POST");
    expect(prompt).toContain("(לא תואר)");
  });
});
