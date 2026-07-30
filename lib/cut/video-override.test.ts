import { describe, expect, it } from "vitest";
import { resolveVideoOverride } from "./video-override";

describe("resolveVideoOverride", () => {
  it("trims a B-roll range that is longer than the audio it covers", () => {
    const result = resolveVideoOverride(
      { startSec: 2, endSec: 10, sourceDurationSec: 30 },
      3,
    );
    expect(result).toEqual({ startSec: 2, endSec: 5 });
  });

  it("extends forward when the range is too short and there is footage after it", () => {
    const result = resolveVideoOverride(
      { startSec: 1, endSec: 3, sourceDurationSec: 30 },
      5,
    );
    expect(result).toEqual({ startSec: 1, endSec: 6 });
  });

  it("extends backward too when forward alone cannot cover the audio", () => {
    // Only 1s of footage after endSec, but 4s available before startSec.
    const result = resolveVideoOverride(
      { startSec: 4, endSec: 6, sourceDurationSec: 7 },
      5,
    );
    expect(result).toEqual({ startSec: 2, endSec: 7 });
  });

  it("returns null when the source clip is too short even fully extended", () => {
    const result = resolveVideoOverride(
      { startSec: 0, endSec: 1, sourceDurationSec: 1.5 },
      5,
    );
    expect(result).toBeNull();
  });

  it("returns the range unchanged when it already matches the audio duration", () => {
    const result = resolveVideoOverride(
      { startSec: 3, endSec: 8, sourceDurationSec: 20 },
      5,
    );
    expect(result).toEqual({ startSec: 3, endSec: 8 });
  });
});
