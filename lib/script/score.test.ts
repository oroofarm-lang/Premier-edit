import { describe, expect, it } from "vitest";
import { findMissedRuns, findSpeechRuns, scoreScript } from "./score";
import type { Script, ScriptSource, TimedWord } from "./types";

/**
 * The cases here are the real defects this project shipped, not invented ones.
 * Each `it` names the complaint it encodes so a future change that "improves"
 * the score has to argue with the rejection that produced the rule.
 */

/** Builds a word list from `[word, start, end]` triples. */
function timed(...triples: [string, number, number][]): TimedWord[] {
  return triples.map(([word, startSec, endSec]) => ({ word, startSec, endSec }));
}

function source(id: string, fileName: string, words: TimedWord[]): ScriptSource {
  return { mediaAssetId: id, fileName, words };
}

/** A clean two-line script: 2s question, then a 6s answer that echoes it. */
function goodScript(): Script {
  return {
    premise: "test",
    beats: [],
    lines: [
      {
        order: 0,
        mediaAssetId: "a",
        startSec: 0,
        endSec: 2,
        text: "בא לך על כוס תה?",
        reason: "hook",
      },
      {
        order: 1,
        mediaAssetId: "b",
        startSec: 10,
        endSec: 16,
        text: "הנה כוס תה, בא לך? ברור",
        reason: "close",
      },
    ],
  };
}

const twoSources = [
  source("a", "a.mp4", timed(["בא", 0, 0.4], ["לך", 0.4, 0.9], ["תה?", 0.9, 2])),
  source("b", "b.mp4", timed(["כוס", 10, 11], ["תה", 11, 16])),
];

describe("scoreScript — hook band", () => {
  it("gives full marks to a hook inside the 3s rule", () => {
    const short = scoreScript(goodScript(), { sources: twoSources, targetDurationSec: 30 });
    // 24 base + 6 for the question mark.
    expect(short.bands.find((b) => b.id === "hook")!.points).toBe(30);
  });

  it("flags a hook whose first sentence lands late", () => {
    // Nothing resolves until 7.5s, so the viewer waits 7.5s for a thought.
    const slow = [
      source(
        "a",
        "a.mp4",
        timed(["אנחנו", 0, 2], ["נמצאים", 2.1, 5], ["פה", 5.1, 7.5]),
      ),
      twoSources[1],
    ];
    const script = goodScript();
    script.lines[0].endSec = 7.5;
    script.lines[0].text = "אנחנו נמצאים פה";
    const scored = scoreScript(script, { sources: slow, targetDurationSec: 30 });
    expect(scored.bands.find((b) => b.id === "hook")!.points).toBeLessThan(24);
    expect(
      scored.findings.some((f) => f.message.includes("first complete sentence")),
    ).toBe(true);
  });

  it("does not punish a long take whose opening question resolves early", () => {
    // The real shape: one 12.82s take that asks and answers in the first 2s.
    // Scoring the line length instead would give this 0 and push the writer
    // back to chopping the take up.
    const take = source(
      "a",
      "a.mp4",
      timed(
        ["נמרוד,", 1.04, 1.5],
        ["תה?", 1.5, 2.98],
        ["ברור", 6.12, 7],
        ["לבנה", 7, 13.86],
      ),
    );
    const script: Script = {
      premise: "t",
      beats: [],
      lines: [
        { order: 0, mediaAssetId: "a", startSec: 1.04, endSec: 13.86, text: "נמרוד, תה? ברור לבנה", reason: "" },
      ],
    };
    const scored = scoreScript(script, { sources: [take], targetDurationSec: 30 });
    const band = scored.bands.find((b) => b.id === "hook")!;
    expect(band.points).toBe(30); // full, plus the question bonus
    expect(band.detail).toContain("1.94s");
    expect(band.detail).toContain("line runs 12.82s");
  });

  it("falls back to the line length when the line never completes a sentence", () => {
    const noPunctuation = [
      source("a", "a.mp4", timed(["אנחנו", 0, 3], ["נמצאים", 3.1, 8])),
      twoSources[1],
    ];
    const script = goodScript();
    script.lines[0].endSec = 8;
    script.lines[0].text = "אנחנו נמצאים";
    const scored = scoreScript(script, { sources: noPunctuation, targetDurationSec: 30 });
    expect(scored.bands.find((b) => b.id === "hook")!.points).toBeLessThan(24);
  });

  it("does not award the question bonus to a hook that only announces", () => {
    const script = goodScript();
    script.lines[0].text = "אנחנו הולכים להכין תה";
    const scored = scoreScript(script, { sources: twoSources, targetDurationSec: 30 });
    expect(scored.bands.find((b) => b.id === "hook")!.points).toBe(24);
  });
});

describe("scoreScript — wholeness band", () => {
  it("penalises a line ending on a comma (the `הרכיב הראשון,` failure)", () => {
    const script = goodScript();
    script.lines[1].text = "הרכיב הראשון,";
    const scored = scoreScript(script, { sources: twoSources, targetDurationSec: 30 });
    expect(scored.bands.find((b) => b.id === "wholeness")!.points).toBeLessThan(30);
    expect(scored.findings.some((f) => f.message.includes("Ends on a comma"))).toBe(true);
  });

  it("penalises a non-hook line that opens on a backward-pointing word", () => {
    const script = goodScript();
    script.lines[1].text = "אבל פה זה צמח מדברי";
    const scored = scoreScript(script, { sources: twoSources, targetDurationSec: 30 });
    expect(scored.findings.some((f) => f.message.includes("points back at a setup"))).toBe(true);
  });

  it("penalises a sub-second non-hook line (the `תמסוג` failure)", () => {
    const script = goodScript();
    script.lines[1].startSec = 10;
    script.lines[1].endSec = 10.6;
    const scored = scoreScript(script, { sources: twoSources, targetDurationSec: 30 });
    expect(scored.findings.some((f) => f.message.includes("fragment, not a thought"))).toBe(true);
  });

  it("exempts the hook from the fragment rule — a 1.9s question is the point", () => {
    const script = goodScript();
    script.lines[0].endSec = 0.9;
    const scored = scoreScript(script, { sources: twoSources, targetDurationSec: 30 });
    expect(scored.findings.some((f) => f.message.includes("fragment, not a thought"))).toBe(false);
  });

  it("scores a clean script at full wholeness", () => {
    const scored = scoreScript(goodScript(), { sources: twoSources, targetDurationSec: 30 });
    expect(scored.bands.find((b) => b.id === "wholeness")!.points).toBe(30);
  });
});

describe("scoreScript — pace counts moments, not lines", () => {
  it("treats a clip resuming with no gap as one moment, not two cuts", () => {
    const script: Script = {
      premise: "t",
      beats: [],
      lines: [
        { order: 0, mediaAssetId: "a", startSec: 0, endSec: 5, text: "אחד", reason: "" },
        { order: 1, mediaAssetId: "a", startSec: 5, endSec: 10, text: "שתיים", reason: "" },
      ],
    };
    const scored = scoreScript(script, { sources: twoSources, targetDurationSec: 30 });
    expect(scored.audibleMoments).toBe(1);
    expect(scored.findings.some((f) => f.message.includes("resuming where it stopped"))).toBe(true);
  });
});

describe("scoreScript — closure band", () => {
  it("rewards an ending that echoes the opening", () => {
    const scored = scoreScript(goodScript(), { sources: twoSources, targetDurationSec: 30 });
    expect(scored.bands.find((b) => b.id === "closure")!.points).toBe(10);
  });

  it("scores nothing when the ending shares no content word with the opening", () => {
    const script = goodScript();
    script.lines[1].text = "הרים ומדבר ונוף פתוח";
    const scored = scoreScript(script, { sources: twoSources, targetDurationSec: 30 });
    expect(scored.bands.find((b) => b.id === "closure")!.points).toBe(0);
  });

  it("does not close a loop on stopwords alone", () => {
    const script = goodScript();
    script.lines[0].text = "יש לנו זה על זה";
    script.lines[1].text = "יש זה על זה";
    const scored = scoreScript(script, { sources: twoSources, targetDurationSec: 30 });
    expect(scored.bands.find((b) => b.id === "closure")!.points).toBe(0);
  });
});

describe("findSpeechRuns", () => {
  it("splits on a gap wider than the threshold and keeps a take whole across small ones", () => {
    const s = source(
      "a",
      "a.mp4",
      timed(
        ["אחת", 0, 0.5],
        ["שתיים", 0.7, 1.2], // 0.2s gap — same take
        ["שלוש", 8.0, 8.5], // 6.8s gap — new take
        ["ארבע", 8.6, 9.0],
      ),
    );
    const runs = findSpeechRuns(s);
    expect(runs).toHaveLength(2);
    // Sorted longest first: 0–1.2 is 1.2s, 8.0–9.0 is 1.0s.
    expect(runs[0].startSec).toBe(0);
    expect(runs[0].endSec).toBe(1.2);
    expect(runs[1].startSec).toBe(8);
    expect(runs[1].text).toBe("שלוש ארבע");
  });

  it("keeps a take whole across a pause the user said they do not mind", () => {
    // 3.14s of nobody talking, the exact gap inside the real 0X7A1694 take.
    // A sentence-sized threshold splits here; that split is the rejected cut.
    const s = source("a", "a.mp4", timed(["א", 1.04, 2.98], ["ב", 6.12, 13.86]));
    const runs = findSpeechRuns(s);
    expect(runs).toHaveLength(1);
    expect(runs[0].durationSec).toBe(12.82);
  });

  it("returns a single run when nothing exceeds the gap", () => {
    const s = source("a", "a.mp4", timed(["א", 0, 1], ["ב", 1.1, 2]));
    expect(findSpeechRuns(s)).toHaveLength(1);
  });
});

describe("findMissedRuns — the finding no writer reported", () => {
  /** One 12.8s unbroken take, exactly the shape of the real one. */
  const longTake = source(
    "a",
    "0X7A1694.MP4",
    timed(
      ["נמרוד", 1.04, 1.5],
      ["בא", 1.6, 2.0],
      ["לך", 2.1, 2.98],
      ["יש", 6.12, 6.5],
      ["פה", 6.6, 7.0],
      ["מרווה", 7.1, 13.86],
    ),
  );

  it("reports a run the script chopped into pieces, with the seconds left behind", () => {
    const script: Script = {
      premise: "t",
      beats: [],
      lines: [
        { order: 0, mediaAssetId: "a", startSec: 1.04, endSec: 2.98, text: "", reason: "" },
        { order: 1, mediaAssetId: "a", startSec: 6.12, endSec: 13.86, text: "", reason: "" },
      ],
    };
    const missed = findMissedRuns(script, [longTake]);
    expect(missed).toHaveLength(1);
    expect(missed[0].durationSec).toBe(12.82);
    expect(missed[0].pieces).toBe(2);
    // The 3.14s between the two lines is what the script left on the table.
    expect(missed[0].usedSec).toBeCloseTo(9.68, 2);
    // ...but there is no speech in that gap, so there is nothing to point at.
    expect(missed[0].largestUnusedSpan).toBeNull();
  });

  it("reports the longest unused span as words, not as dead air", () => {
    // Words either side of a hole the script uses; the hole itself is silent.
    const take = source(
      "a",
      "a.mp4",
      timed(
        ["פתיחה", 0, 1],
        ["המשך", 1.1, 2],
        ["אמצע", 5.5, 6.5], // the script takes this
        ["סיום", 7, 8],
        ["אחרון", 8.1, 9.4],
      ),
    );
    const script: Script = {
      premise: "t",
      beats: [],
      lines: [{ order: 0, mediaAssetId: "a", startSec: 5.5, endSec: 6.5, text: "", reason: "" }],
    };
    const [missed] = findMissedRuns(script, [take]);
    // Two free stretches: 0–2 (2s) and 7–9.4 (2.4s). The wider one wins, and
    // it is reported snapped onto real words rather than the raw gap bounds.
    expect(missed.largestUnusedSpan).not.toBeNull();
    expect(missed.largestUnusedSpan!.startSec).toBe(7);
    expect(missed.largestUnusedSpan!.endSec).toBe(9.4);
    expect(missed.largestUnusedSpan!.text).toBe("סיום אחרון");
  });

  it("reports a run nothing touched", () => {
    const script: Script = { premise: "t", beats: [], lines: [] };
    const missed = findMissedRuns(script, [longTake]);
    expect(missed[0].pieces).toBe(0);
    expect(missed[0].usedSec).toBe(0);
  });

  it("stays silent when the run is taken whole in one line — the good case", () => {
    const script: Script = {
      premise: "t",
      beats: [],
      lines: [
        { order: 0, mediaAssetId: "a", startSec: 1.04, endSec: 13.86, text: "", reason: "" },
      ],
    };
    expect(findMissedRuns(script, [longTake])).toHaveLength(0);
  });

  it("ignores runs shorter than the reporting floor", () => {
    const short = source("a", "a.mp4", timed(["א", 0, 1], ["ב", 1.1, 2]));
    expect(findMissedRuns({ premise: "", beats: [], lines: [] }, [short])).toHaveLength(0);
  });
});

describe("scoreScript — total", () => {
  it("sums the bands and stays inside 0..100", () => {
    const scored = scoreScript(goodScript(), { sources: twoSources, targetDurationSec: 30 });
    expect(scored.total).toBe(scored.bands.reduce((sum, b) => sum + b.points, 0));
    expect(scored.total).toBeGreaterThan(0);
    expect(scored.total).toBeLessThanOrEqual(100);
  });
});
