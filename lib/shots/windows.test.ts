import { describe, expect, it } from "vitest";
import {
  clamp01,
  jitter,
  mean,
  parseMetricSeries,
  parseSceneCuts,
  percentile,
  samplesInRange,
} from "./metrics";
import { computeBaseline, findShotWindows, scoreWindow } from "./windows";
import { DEFAULT_WINDOWING } from "./types";
import type { ClipMetrics, MetricSample } from "./types";

/** Builds a motion series from per-sample values at 10 Hz. */
function curve(values: number[]): MetricSample[] {
  return values.map((value, i) => ({
    timeSec: Math.round((i + 1) * 0.1 * 100) / 100,
    value,
  }));
}

/** `n` samples of `value`, optionally with alternating +/- jitter. */
function flat(n: number, value: number, shake = 0): number[] {
  return Array.from({ length: n }, (_, i) => value + (i % 2 === 0 ? shake : -shake));
}

describe("parseMetricSeries", () => {
  const output = `frame:0    pts:1       pts_time:0.1
lavfi.signalstats.YAVG=13.3837
lavfi.blur=4.52
frame:1    pts:2       pts_time:0.2
lavfi.signalstats.YAVG=12.1226
lavfi.blur=4.61`;

  it("pairs each key with the most recent frame timestamp", () => {
    expect(parseMetricSeries(output, "lavfi.signalstats.YAVG")).toEqual([
      { timeSec: 0.1, value: 13.3837 },
      { timeSec: 0.2, value: 12.1226 },
    ]);
  });

  it("reads a second key out of the same output", () => {
    expect(parseMetricSeries(output, "lavfi.blur")).toEqual([
      { timeSec: 0.1, value: 4.52 },
      { timeSec: 0.2, value: 4.61 },
    ]);
  });

  it("does not confuse a key with one that shares its prefix", () => {
    // YAVG and YAVGX would both match a naive `includes` check.
    const tricky = `frame:0 pts_time:0.1\nlavfi.signalstats.YAVGX=99\nlavfi.signalstats.YAVG=5`;
    expect(parseMetricSeries(tricky, "lavfi.signalstats.YAVG")).toEqual([
      { timeSec: 0.1, value: 5 },
    ]);
  });

  it("skips malformed values rather than throwing", () => {
    const broken = `frame:0 pts_time:0.1\nlavfi.blur=nan\nframe:1 pts_time:0.2\nlavfi.blur=7`;
    expect(parseMetricSeries(broken, "lavfi.blur")).toEqual([
      { timeSec: 0.2, value: 7 },
    ]);
  });

  it("ignores keys appearing before any frame header", () => {
    expect(parseMetricSeries("lavfi.blur=4.0", "lavfi.blur")).toEqual([]);
  });
});

describe("parseSceneCuts", () => {
  it("reads cut times", () => {
    const output = `lavfi.scd.time=3.5\nsomething else\nlavfi.scd.time=11.25`;
    expect(parseSceneCuts(output)).toEqual([{ timeSec: 3.5 }, { timeSec: 11.25 }]);
  });

  it("returns nothing for a single continuous take", () => {
    // Verified real behaviour: a 55s handheld clip from this project's own
    // footage produced zero detected cuts.
    expect(parseSceneCuts("frame:0 pts_time:0.1\n")).toEqual([]);
  });
});

describe("metric helpers", () => {
  it("interpolates percentiles", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5);
    expect(percentile([5], 0.9)).toBe(5);
    expect(percentile([], 0.5)).toBe(0);
  });

  it("clamps non-finite values to zero", () => {
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(7)).toBe(1);
  });

  it("measures erraticness, not magnitude", () => {
    // A steady ramp is large but smooth; alternating values are small but erratic.
    const smoothRamp = jitter([0, 10, 20, 30, 40, 50]);
    const shaky = jitter([0, 4, 0, 4, 0, 4]);
    expect(smoothRamp).toBeLessThan(shaky);
  });

  it("selects a half-open range", () => {
    const samples = curve([1, 2, 3, 4]);
    expect(samplesInRange(samples, 0.2, 0.4).map((s) => s.value)).toEqual([2, 3]);
  });

  it("averages an empty array to zero instead of NaN", () => {
    expect(mean([])).toBe(0);
  });
});

describe("scoreWindow", () => {
  function scoreOf(values: number[], startSec: number, endSec: number) {
    const metrics: ClipMetrics = { motion: curve(values) };
    return scoreWindow(
      metrics,
      computeBaseline(metrics),
      startSec,
      endSec,
      "motion-window",
    );
  }

  it("rates a smooth pan as stable, unlike shake of the same magnitude", () => {
    const ramp = Array.from({ length: 60 }, (_, i) => 5 + i);
    const shake = Array.from({ length: 60 }, (_, i) => 35 + (i % 2 === 0 ? 30 : -30));
    expect(scoreOf(ramp, 1, 3).stability).toBeGreaterThan(
      scoreOf(shake, 1, 3).stability,
    );
  });

  it("marks a window that ends settled as complete", () => {
    // Rises to a peak, then returns to baseline and stays there.
    const settles = [...flat(10, 2), ...Array.from({ length: 15 }, (_, i) => 2 + i * 4), ...flat(25, 2)];
    const window = scoreOf(settles, 1.0, 5.0);
    expect(window.movementCompleteness).toBeGreaterThan(0.7);
  });

  it("marks a window cut mid-movement as incomplete", () => {
    // Still climbing when the window ends.
    const climbing = [...flat(10, 2), ...Array.from({ length: 40 }, (_, i) => 2 + i * 2)];
    const window = scoreOf(climbing, 1.0, 5.0);
    expect(window.movementCompleteness).toBeLessThan(0.3);
  });

  it("treats a window with no movement at all as complete", () => {
    // A hold: nothing was cut, so completeness must not divide by a
    // meaningless peak and land near zero.
    const held = [...flat(20, 3), ...Array.from({ length: 30 }, (_, i) => 3 + i * 3)];
    expect(scoreOf(held, 0.2, 1.8).movementCompleteness).toBe(1);
  });

  it("separates something-happening from camera shake", () => {
    // The distinction the user's feedback turned on: a pour in front of a
    // steady camera is eventful and smooth; shake is neither.
    const eventful = [...flat(30, 3), ...flat(40, 30), ...flat(30, 3)];
    const shaky = [...flat(30, 3), ...flat(40, 16, 14), ...flat(30, 3)];

    const pour = scoreOf(eventful, 3.5, 6.5);
    const shake = scoreOf(shaky, 3.5, 6.5);

    expect(pour.activity).toBeGreaterThan(0.8);
    expect(shake.activity).toBeGreaterThan(0.3); // shake registers as motion
    expect(pour.stability).toBeGreaterThan(shake.stability); // but not as steady
    expect(pour.qualityScore).toBeGreaterThan(shake.qualityScore);
  });

  it("no longer gives a shot of nothing a near-perfect score", () => {
    // Before activity was scored, a locked-off window of nothing took 1.00 on
    // both stability and completeness — the exact reason the first catalogue
    // kept returning the calm moments around the action instead of the action.
    // A real action ramps in and out over a few tenths of a second rather
    // than stepping instantly, and the ramp shape matters: an instant step is
    // indistinguishable from a one-frame glitch.
    const ramp = (from: number, to: number, n: number) =>
      Array.from({ length: n }, (_, i) => from + ((to - from) * (i + 1)) / n);
    const clip = [
      ...flat(35, 3), // calm      0.1 - 3.5
      ...ramp(3, 30, 6), // rises  3.6 - 4.1
      ...flat(18, 30), // action   4.2 - 5.9
      ...ramp(30, 3, 6), // settles 6.0 - 6.5
      ...flat(35, 3), // calm      6.6 - 10.0
    ];
    const still = scoreOf(clip, 0.5, 3.5);
    const wholeAction = scoreOf(clip, 3.4, 7.4);
    const cutMidAction = scoreOf(clip, 4.0, 5.8);

    expect(still.stability).toBeGreaterThan(0.9);
    expect(still.activity).toBeLessThan(0.1);

    // A contained action beats a shot of nothing. Activity lands around 0.6
    // rather than near 1 because the window deliberately includes the ramp in
    // and the settle at its edges — that is what "contained" means.
    expect(wholeAction.activity).toBeGreaterThan(0.5);
    expect(wholeAction.movementCompleteness).toBeGreaterThan(0.9);
    expect(wholeAction.qualityScore).toBeGreaterThan(still.qualityScore);

    // But an action cut off mid-pour does not — the two rules work together:
    // "something is happening" and "it finishes" are both required.
    expect(cutMidAction.activity).toBeGreaterThan(0.9);
    expect(cutMidAction.movementCompleteness).toBeLessThan(0.2);
    expect(cutMidAction.qualityScore).toBeLessThan(wholeAction.qualityScore);
  });

  it("scores sharpness from measured blur anchors", () => {
    const motion = curve(flat(50, 5));
    const sharp: ClipMetrics = { motion, blur: curve(flat(50, 4.5)) };
    const blurry: ClipMetrics = { motion, blur: curve(flat(50, 28)) };
    const baseline = computeBaseline(sharp);
    expect(scoreWindow(sharp, baseline, 0.5, 2, "motion-window").sharpness).toBeCloseTo(1);
    expect(scoreWindow(blurry, baseline, 0.5, 2, "motion-window").sharpness).toBeCloseTo(0);
  });

  it("penalises crushed and blown exposure but not a normal range", () => {
    const motion = curve(flat(50, 5));
    const baseline = computeBaseline({ motion });
    const at = (y: number) =>
      scoreWindow({ motion, luma: curve(flat(50, y)) }, baseline, 0.5, 2, "motion-window")
        .exposure;
    expect(at(120)).toBe(1);
    expect(at(10)).toBeLessThan(0.3);
    expect(at(250)).toBeLessThan(0.3);
  });

  it("reports null for signals that were not measured", () => {
    const window = scoreOf(flat(50, 5), 0.5, 2);
    expect(window.sharpness).toBeNull();
    expect(window.exposure).toBeNull();
    // and still produces a usable score from motion alone
    expect(window.qualityScore).toBeGreaterThan(0);
  });
});

describe("findShotWindows", () => {
  it("finds windows inside a single continuous take with no scene cuts", () => {
    // The verified real case: scene detection returns nothing, so all the
    // value has to come from searching inside the take.
    const values = [
      ...flat(40, 20, 8), // shaky
      ...flat(40, 3), // calm hold
      ...flat(40, 20, 8), // shaky
      ...flat(40, 3), // calm hold
    ];
    const metrics = { motion: curve(values) };
    const windows = findShotWindows(metrics, [], 16);
    expect(windows.length).toBeGreaterThan(0);

    // Since activity is scored, "calm always wins" is no longer the rule and
    // should not be asserted: a window that starts moving and settles into a
    // hold is a legitimately good shot. The property that must hold is
    // narrower — a window spent entirely inside the shaky stretch must lose
    // to one spent entirely inside the calm stretch.
    const baseline = computeBaseline(metrics);
    const shaky = scoreWindow(metrics, baseline, 0.2, 4.0, "motion-window");
    const calm = scoreWindow(metrics, baseline, 4.2, 8.0, "motion-window");
    expect(shaky.qualityScore).toBeLessThan(calm.qualityScore);

    // And nothing catalogued may sit wholly within a shaky stretch.
    for (const w of windows) {
      const whollyShaky =
        (w.startSec >= 0 && w.endSec <= 4.0) || (w.startSec >= 8 && w.endSec <= 12.0);
      expect(whollyShaky, `${w.startSec}-${w.endSec}`).toBe(false);
    }
  });

  it("returns non-overlapping windows in chronological order", () => {
    const values = [...flat(60, 3), ...flat(30, 25, 10), ...flat(60, 3)];
    const windows = findShotWindows({ motion: curve(values) }, [], 15);
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].startSec).toBeGreaterThanOrEqual(windows[i - 1].endSec);
    }
  });

  it("prefers a longer window when quality is otherwise equal", () => {
    // Measured problem, not a theory: the first real run returned 66 windows
    // of which nearly all were exactly the 1.2s minimum, because a shorter
    // span has less room to shake. That starves the layout stage of the
    // longer options the pacing expert asks for.
    const steady = { motion: curve(flat(300, 4)) };
    const windows = findShotWindows(steady, [], 30);
    const meanLength = mean(windows.map((w) => w.endSec - w.startSec));
    expect(meanLength).toBeGreaterThan(DEFAULT_WINDOWING.minDurationSec);
  });

  it("does not let a long mediocre window beat a short excellent one", () => {
    // The length bonus is 0.1 — a tiebreaker, not an override.
    const metrics = { motion: curve(flat(200, 5)) };
    const baseline = computeBaseline(metrics);
    const shortExcellent = scoreWindow(metrics, baseline, 1, 2.2, "motion-window");
    const longShaky = scoreWindow(
      { motion: curve([...flat(100, 5), ...flat(100, 40, 25)]) },
      computeBaseline({ motion: curve([...flat(100, 5), ...flat(100, 40, 25)]) }),
      10.5,
      14.5,
      "motion-window",
    );
    expect(shortExcellent.qualityScore).toBeGreaterThan(longShaky.qualityScore);
  });

  it("respects the per-clip cap", () => {
    const windows = findShotWindows({ motion: curve(flat(600, 4)) }, [], 60, {
      ...DEFAULT_WINDOWING,
      maxWindowsPerClip: 3,
    });
    expect(windows.length).toBeLessThanOrEqual(3);
  });

  it("splits at scene cuts and labels full-segment windows accordingly", () => {
    const windows = findShotWindows(
      { motion: curve(flat(200, 4)) },
      [{ timeSec: 10 }],
      20,
    );
    // No window may straddle the cut.
    for (const w of windows) {
      expect(w.startSec >= 10 || w.endSec <= 10).toBe(true);
    }
    expect(windows.some((w) => w.source === "scene-cut")).toBe(false);
  });

  it("returns nothing for a clip too short to hold one window", () => {
    expect(findShotWindows({ motion: curve(flat(5, 4)) }, [], 0.5)).toEqual([]);
  });

  it("returns nothing when there is no motion data", () => {
    expect(findShotWindows({ motion: [] }, [], 30)).toEqual([]);
  });
});
