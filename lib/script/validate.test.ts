import { describe, expect, it } from "vitest";
import { MIN_LINE_SEC, validateScript, wordsInSpan } from "./validate";
import type { Script, ScriptSource, ValidateOptions } from "./types";

/**
 * One clip whose words are laid out on a predictable grid: word N runs from
 * N.0 to N.8, so a span of 0–3 holds exactly the first three words.
 */
function source(mediaAssetId: string, fileName: string, text: string[]): ScriptSource {
  return {
    mediaAssetId,
    fileName,
    words: text.map((word, i) => ({ word, startSec: i, endSec: i + 0.8 })),
  };
}

const A = source("asset-a", "A.MP4", ["יש", "פה", "מרווה", "וזעתר", "ואזוביון"]);
const B = source("asset-b", "B.MP4", ["הרכיב", "הראשון", "הוא", "מרווה"]);

const options: ValidateOptions = {
  outputProfile: "REEL_SHORT",
  targetDurationSec: 30,
  sources: [A, B],
};

function script(lines: Script["lines"]): Script {
  return { premise: "תה מהשדה", beats: ["hook", "body"], lines };
}

/** A line quoting words `from`..`to` (inclusive) of a source. */
function line(
  order: number,
  src: ScriptSource,
  from: number,
  to: number,
  overrides: Partial<Script["lines"][number]> = {},
) {
  return {
    order,
    mediaAssetId: src.mediaAssetId,
    startSec: from,
    endSec: to + 0.8,
    text: src.words.slice(from, to + 1).map((w) => w.word).join(" "),
    reason: "test",
    ...overrides,
  };
}

describe("wordsInSpan", () => {
  it("takes only words fully inside the span", () => {
    expect(wordsInSpan(A.words, 0, 2.8).map((w) => w.word)).toEqual(["יש", "פה", "מרווה"]);
  });

  it("does not half-take a word that straddles the edge", () => {
    expect(wordsInSpan(A.words, 0, 2.4).map((w) => w.word)).toEqual(["יש", "פה"]);
  });
});

describe("validateScript — the anti-fabrication gate", () => {
  it("rejects a line whose text was never spoken, and shows both sides", () => {
    const result = validateScript(
      script([line(0, A, 0, 2, { text: "יש פה קמומיל ולואיזה" })]),
      options,
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toContain("does not match what was said");
    expect(result.errors[0].message).toContain("קמומיל");
    expect(result.lines).toEqual([]);
  });

  it("accepts the same words written with punctuation and niqqud", () => {
    const result = validateScript(
      script([line(0, A, 0, 2, { text: "יֵשׁ, פה — מרווה!" })]),
      options,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a line that quietly drops a word from the span", () => {
    const result = validateScript(
      script([line(0, A, 0, 2, { text: "יש מרווה" })]),
      options,
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toContain("does not match");
  });
});

describe("validateScript — spans must be real", () => {
  it("rejects a clip that is not in the project", () => {
    const result = validateScript(
      script([line(0, A, 0, 1, { mediaAssetId: "asset-zzz" })]),
      options,
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toContain("not a clip in this project");
  });

  it("rejects a span with no speech in it", () => {
    const result = validateScript(
      script([line(0, A, 0, 1, { startSec: 90, endSec: 95, text: "" })]),
      options,
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toContain("no transcribed speech");
  });

  it("rejects a backwards span", () => {
    const result = validateScript(
      script([line(0, A, 0, 1, { startSec: 4, endSec: 2 })]),
      options,
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toContain("must be greater than");
  });

  it("rejects a line too short to read", () => {
    // One word 0.2s long — under the MIN_LINE_SEC floor once tightened.
    const brief: ScriptSource = {
      mediaAssetId: "asset-c",
      fileName: "C.MP4",
      words: [{ word: "כן", startSec: 0, endSec: 0.2 }],
    };
    const result = validateScript(
      script([{ order: 0, mediaAssetId: "asset-c", startSec: 0, endSec: 0.2, text: "כן", reason: "t" }]),
      { ...options, sources: [brief] },
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toContain(`${MIN_LINE_SEC}s minimum`);
  });
});

describe("validateScript — shape of the whole script", () => {
  it("rejects an empty script", () => {
    expect(validateScript(script([]), options).ok).toBe(false);
  });

  it("rejects orders that skip a number", () => {
    const result = validateScript(
      script([line(0, A, 0, 1), line(2, B, 0, 1)]),
      options,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("order must run"))).toBe(true);
  });

  it("rejects two lines from one clip that overlap", () => {
    const result = validateScript(
      script([line(0, A, 0, 2), line(1, A, 1, 3)]),
      options,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("Overlaps another line"))).toBe(true);
  });

  it("allows the same clip twice when the spans are disjoint", () => {
    const result = validateScript(
      script([line(0, A, 0, 1), line(1, A, 3, 4)]),
      options,
    );
    expect(result.ok).toBe(true);
  });
});

describe("validateScript — what it returns when it passes", () => {
  it("tightens each span onto the words it holds", () => {
    // Asked for 0–3.5s; the words inside end at 2.8, so the line should too.
    const result = validateScript(
      script([line(0, A, 0, 2, { startSec: 0, endSec: 3.5, text: "יש פה מרווה" })]),
      options,
    );
    expect(result.ok).toBe(true);
    expect(result.lines[0].startSec).toBeCloseTo(0);
    expect(result.lines[0].endSec).toBeCloseTo(2.8);
  });

  it("returns lines sorted by order, whatever order they arrived in", () => {
    const result = validateScript(
      script([line(1, B, 0, 1), line(0, A, 0, 1)]),
      options,
    );
    expect(result.ok).toBe(true);
    expect(result.lines.map((l) => l.order)).toEqual([0, 1]);
  });

  it("warns about length without refusing a script that works", () => {
    const result = validateScript(script([line(0, A, 0, 1)]), options);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.message.includes("30s target"))).toBe(true);
  });

  it("reports the total duration it would build", () => {
    const result = validateScript(
      script([line(0, A, 0, 1), line(1, B, 0, 1)]),
      options,
    );
    expect(result.totalDurationSec).toBeCloseTo(3.6);
  });
});
