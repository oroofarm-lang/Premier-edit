import { describe, expect, it } from "vitest";
import { getAssetSegments } from "./segments";

describe("getAssetSegments", () => {
  it("returns the transcript's own segments when there is speech", () => {
    const segments = getAssetSegments({
      transcript: {
        segmentsJson: JSON.stringify([
          { startSec: 0, endSec: 2.5, text: "שלום" },
          { startSec: 2.5, endSec: 5, text: "עולם" },
        ]),
      },
      durationSec: 5,
    });

    expect(segments).toEqual([
      { startSec: 0, endSec: 2.5, text: "שלום" },
      { startSec: 2.5, endSec: 5, text: "עולם" },
    ]);
  });

  it("falls back to the whole clip as one silent segment when there is no transcript", () => {
    const segments = getAssetSegments({ transcript: null, durationSec: 8 });

    expect(segments).toEqual([{ startSec: 0, endSec: 8, text: "" }]);
  });

  it("falls back to the whole clip when the transcript has zero segments", () => {
    const segments = getAssetSegments({
      transcript: { segmentsJson: JSON.stringify([]) },
      durationSec: 4,
    });

    expect(segments).toEqual([{ startSec: 0, endSec: 4, text: "" }]);
  });

  it("returns nothing for a clip with neither transcript nor known duration", () => {
    const segments = getAssetSegments({ transcript: null, durationSec: null });

    expect(segments).toEqual([]);
  });
});
