import { describe, expect, it } from "vitest";
import {
  EXPERTS,
  assembleExpertSections,
  contributingExperts,
  expertsForStage,
} from "./index";
import { SHOT_DURATION_SEC, pacingProblems, targetShotCount } from "./pacing";
import { qcFindings } from "./qc";
import type { ExpertContext } from "./types";

function ctx(over: Partial<ExpertContext> = {}): ExpertContext {
  return {
    stage: "selection",
    outputProfile: "REEL_SHORT",
    targetDurationSec: 20,
    ...over,
  };
}

describe("expert roster", () => {
  it("has unique ids", () => {
    const ids = EXPERTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only references sibling experts that exist", () => {
    // The vault's link map is generated from worksWith, so a dangling id here
    // becomes a broken wikilink in Obsidian rather than a runtime error.
    const ids = new Set(EXPERTS.map((e) => e.id));
    for (const expert of EXPERTS) {
      for (const sibling of expert.worksWith) {
        expect(ids, `${expert.id} -> ${sibling}`).toContain(sibling);
      }
    }
  });

  it("declares at least one stage per expert", () => {
    for (const expert of EXPERTS) {
      expect(expert.stages.length, expert.id).toBeGreaterThan(0);
    }
  });
});

describe("prompt assembly is profile-scoped", () => {
  it("includes only the matching platform expert", () => {
    const reels = contributingExperts(ctx({ outputProfile: "REEL_SHORT" })).map((e) => e.id);
    expect(reels).toContain("platform-reels");
    expect(reels).not.toContain("platform-feed");
    expect(reels).not.toContain("platform-youtube");

    const long = contributingExperts(ctx({ outputProfile: "YOUTUBE_LONG" })).map((e) => e.id);
    expect(long).toContain("platform-youtube");
    expect(long).not.toContain("platform-reels");
  });

  it("does not give long-form the short-form length rule", () => {
    // The concrete defect this layer fixes: one shared guidelines blob told
    // the model to target 15-20s and avoid a 30-40s dead zone even when the
    // profile was YOUTUBE_LONG and the target was several minutes.
    const long = assembleExpertSections(
      ctx({ outputProfile: "YOUTUBE_LONG", targetDurationSec: 300 }),
    );
    const short = assembleExpertSections(ctx({ outputProfile: "REEL_SHORT" }));

    // The reel's own length advice reaches only the reel.
    expect(short).toContain("15-20 שניות עובד הכי טוב");
    expect(long).not.toContain("עובד הכי טוב");
    expect(short).toContain("אזור נטישה");
    expect(long).not.toContain("אזור נטישה");

    // Long-form is told the real target, and told the short rules are off.
    expect(long).toContain("300 שניות");
    expect(long).toContain("כללי הריל הקצר לא חלים כאן");
  });

  it("gives the vision stage framing knowledge but not platform knowledge", () => {
    const vision = contributingExperts(ctx({ stage: "vision" })).map((e) => e.id);
    expect(vision).toContain("framing");
    expect(vision).not.toContain("platform-reels");
  });

  it("produces no prompt text for the qc stage", () => {
    // QC contributes code, not prose — assembling it must yield nothing
    // rather than a stray heading.
    expect(assembleExpertSections(ctx({ stage: "qc" }))).toBe("");
    expect(expertsForStage("qc").map((e) => e.id)).toContain("qc");
  });
});

describe("pacing", () => {
  it("scales the shot count to the target duration", () => {
    const short = targetShotCount(20, "REEL_SHORT");
    expect(short.ideal).toBe(10);
    expect(short.min).toBeLessThan(short.ideal);
    expect(short.max).toBeGreaterThan(short.ideal);
  });

  it("allows long-form shots that short-form would reject", () => {
    expect(SHOT_DURATION_SEC.YOUTUBE_LONG.max).toBeGreaterThan(
      SHOT_DURATION_SEC.REEL_SHORT.max,
    );
    expect(pacingProblems([8, 6, 10, 7], "YOUTUBE_LONG")).toEqual([]);
    expect(pacingProblems([8, 6, 10, 7], "REEL_SHORT").join(" ")).toContain("ארוכים");
  });

  it("flags a cut where every shot is the same length", () => {
    expect(pacingProblems([2, 2, 2, 2], "REEL_SHORT").join(" ")).toContain("מכני");
  });

  it("accepts a varied in-range cut", () => {
    expect(pacingProblems([1.2, 2.5, 1.8, 3.2], "REEL_SHORT")).toEqual([]);
  });
});

describe("qc findings", () => {
  const m = (id: string, startSec: number, endSec: number) => ({
    mediaAssetId: id,
    startSec,
    endSec,
  });

  it("errors on an empty cut", () => {
    expect(qcFindings([], "REEL_SHORT", 20)).toEqual([
      { severity: "error", message: "הקאט ריק — אין רגעים." },
    ]);
  });

  it("errors when a moment ends before it starts", () => {
    const found = qcFindings([m("a", 5, 2)], "REEL_SHORT", 20);
    expect(found.some((f) => f.severity === "error")).toBe(true);
  });

  it("warns on two consecutive moments from one source", () => {
    const found = qcFindings(
      [m("a", 0, 2), m("a", 4, 6), m("b", 0, 2)],
      "REEL_SHORT",
      6,
    );
    expect(found.some((f) => f.message.includes("jump cut"))).toBe(true);
  });

  it("warns when the cut drifts far from the target duration", () => {
    const found = qcFindings([m("a", 0, 2), m("b", 0, 2)], "REEL_SHORT", 20);
    expect(found.some((f) => f.message.includes("רחוק מהיעד"))).toBe(true);
  });

  it("passes a clean varied cut", () => {
    const found = qcFindings(
      [m("a", 0, 1.2), m("b", 0, 2.5), m("c", 0, 1.8), m("d", 0, 3.2)],
      "REEL_SHORT",
      8.7,
    );
    expect(found).toEqual([]);
  });
});
