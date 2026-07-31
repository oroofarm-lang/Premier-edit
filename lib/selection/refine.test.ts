import { describe, expect, it } from "vitest";
import {
  buildRefinementPrompt,
  buildStartingDraft,
  diffSelections,
  type RefinementDraft,
} from "./refine-plan";
import type { CandidateSegment, SelectedSegment } from "./types";

function candidate(mediaAssetId: string, startSec: number, endSec: number): CandidateSegment {
  return { mediaAssetId, filePath: `/tmp/${mediaAssetId}.mp4`, startSec, endSec, text: "" };
}

function selected(
  mediaAssetId: string,
  startSec: number,
  endSec: number,
  order: number,
): SelectedSegment {
  return { mediaAssetId, startSec, endSec, order, score: 0.8, reason: "הוק: בדיקה" };
}

describe("diffSelections", () => {
  const a = selected("a", 0, 2, 0);
  const b = selected("b", 0, 3, 1);
  const c = selected("c", 0, 2.5, 2);

  it("reports every moment as kept when nothing changed", () => {
    const result = diffSelections([a, b, c], [a, b, c]);
    expect(result.map((e) => e.status)).toEqual(["kept", "kept", "kept"]);
  });

  it("reports exactly one removal when a moment is dropped", () => {
    const result = diffSelections([a, b, c], [a, b]);
    expect(result.filter((e) => e.status === "removed")).toHaveLength(1);
    expect(result.find((e) => e.status === "removed")?.mediaAssetId).toBe("c");
    expect(result.filter((e) => e.status === "kept")).toHaveLength(2);
    expect(result.filter((e) => e.status === "added")).toHaveLength(0);
  });

  it("does not report survivors as moved when an earlier moment is removed", () => {
    // b and c shift down an array slot, but their relative order is unchanged —
    // reporting them as "moved" would drown the real change in noise.
    const result = diffSelections([a, b, c], [b, c]);
    expect(result.filter((e) => e.status === "moved")).toHaveLength(0);
    expect(result.filter((e) => e.status === "kept")).toHaveLength(2);
    expect(result.filter((e) => e.status === "removed")).toHaveLength(1);
  });

  it("reports a reorder as moved rather than as an add plus a remove", () => {
    const result = diffSelections([a, b, c], [c, b, a]);
    expect(result.filter((e) => e.status === "added")).toHaveLength(0);
    expect(result.filter((e) => e.status === "removed")).toHaveLength(0);
    expect(result.filter((e) => e.status === "moved").length).toBeGreaterThan(0);
  });

  it("reports a newly introduced moment as added", () => {
    const d = selected("d", 0, 1.5, 3);
    const result = diffSelections([a, b], [a, b, d]);
    expect(result.filter((e) => e.status === "added")).toHaveLength(1);
    expect(result.find((e) => e.status === "added")?.mediaAssetId).toBe("d");
  });
});

describe("buildStartingDraft", () => {
  const shortlist = [candidate("a", 0, 2), candidate("b", 0, 3)];

  it("continues an existing draft when one is pending", () => {
    const pending: RefinementDraft = {
      result: { selections: [selected("b", 0, 3, 0)], premise: "כבר עודכן" },
      turns: [{ instruction: "קודם", response: "בוצע", ok: true, at: "2026-07-31T00:00:00.000Z" }],
    };
    const draft = buildStartingDraft(
      {
        refinementDraftJson: JSON.stringify(pending),
        selectionPremise: "הפרמיסה החיה",
        selectionBeatPlan: null,
        selections: [
          {
            mediaAssetId: "a",
            startSec: 0,
            endSec: 2,
            order: 0,
            score: 0.9,
            reason: "חי",
            videoAssetId: null,
            videoStartSec: null,
            videoEndSec: null,
          },
        ],
      },
      shortlist,
    );

    // The draft wins over the live rows — that is what makes the conversation chain.
    expect(draft.result.premise).toBe("כבר עודכן");
    expect(draft.result.selections[0].mediaAssetId).toBe("b");
    expect(draft.turns).toHaveLength(1);
  });

  it("reconstructs from live Selection rows when no draft is pending", () => {
    const draft = buildStartingDraft(
      {
        refinementDraftJson: null,
        selectionPremise: "הפרמיסה החיה",
        selectionBeatPlan: JSON.stringify(["הוק", "גוף"]),
        selections: [
          {
            mediaAssetId: "a",
            startSec: 0,
            endSec: 2,
            order: 0,
            score: 0.9,
            reason: "חי",
            videoAssetId: null,
            videoStartSec: null,
            videoEndSec: null,
          },
        ],
      },
      shortlist,
    );

    expect(draft.turns).toEqual([]);
    expect(draft.result.premise).toBe("הפרמיסה החיה");
    expect(draft.result.beatPlan).toEqual(["הוק", "גוף"]);
    expect(draft.result.selections).toHaveLength(1);
    expect(draft.result.selections[0].mediaAssetId).toBe("a");
  });

  it("carries a B-roll video override back out of the live rows", () => {
    const draft = buildStartingDraft(
      {
        refinementDraftJson: null,
        selectionPremise: null,
        selectionBeatPlan: null,
        selections: [
          {
            mediaAssetId: "a",
            startSec: 0,
            endSec: 2,
            order: 0,
            score: 0.9,
            reason: "חי",
            videoAssetId: "b",
            videoStartSec: 0,
            videoEndSec: 3,
          },
        ],
      },
      shortlist,
    );

    expect(draft.result.selections[0].videoOverride).toEqual({
      mediaAssetId: "b",
      startSec: 0,
      endSec: 3,
    });
  });
});

describe("buildRefinementPrompt", () => {
  const shortlist = [candidate("a", 0, 2), candidate("b", 0, 3), candidate("c", 0, 2.5)];
  const draft: RefinementDraft = {
    result: {
      selections: [selected("a", 0, 2, 0), selected("b", 0, 3, 1)],
      premise: "פרמיסה",
    },
    turns: [],
  };

  it("numbers the current cut 1-based so it matches the moment chips in the UI", () => {
    const prompt = buildRefinementPrompt(draft, shortlist, "תוריד את האחרון");
    expect(prompt).toContain("1. #0 a.mp4");
    expect(prompt).toContain("2. #1 b.mp4");
    expect(prompt).not.toContain("0. #0");
  });

  it("includes the full shortlist so a refinement can pull in an unused moment", () => {
    const prompt = buildRefinementPrompt(draft, shortlist, "תחליף רגע 2");
    // "c" is in the shortlist but not in the current cut — it must still be offered.
    expect(prompt).toContain("#2 | c.mp4");
  });

  it("carries the instruction verbatim", () => {
    const prompt = buildRefinementPrompt(draft, shortlist, "רגע 2: תחליף למשהו קצר יותר");
    expect(prompt).toContain("רגע 2: תחליף למשהו קצר יותר");
  });

  it("includes prior turns once a conversation is under way", () => {
    const withHistory: RefinementDraft = {
      ...draft,
      turns: [
        { instruction: "הוראה קודמת", response: "הסרתי רגע", ok: true, at: "2026-07-31T00:00:00.000Z" },
      ],
    };
    const prompt = buildRefinementPrompt(withHistory, shortlist, "ועכשיו עוד משהו");
    expect(prompt).toContain("היסטוריית השיחה");
    expect(prompt).toContain("הוראה קודמת");
    expect(prompt).toContain("הסרתי רגע");
  });

  it("omits the history block entirely on the first turn", () => {
    const prompt = buildRefinementPrompt(draft, shortlist, "הוראה ראשונה");
    expect(prompt).not.toContain("היסטוריית השיחה");
  });
});
