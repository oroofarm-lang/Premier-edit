import {
  clamp01,
  jitter,
  mean,
  percentile,
  samplesInRange,
} from "./metrics";
import type {
  ClipMetrics,
  SceneCut,
  ShotSource,
  ShotWindow,
  WindowingOptions,
} from "./types";
import { DEFAULT_WINDOWING } from "./types";

/**
 * `lavfi.blur` readings that anchor the sharpness scale. Measured, not
 * guessed: a frame from real project footage read 4.53, and the same frame
 * under `gblur=sigma=8` read 27.9. Higher means blurrier.
 */
const SHARP_BLUR = 4.5;
const BLURRY_BLUR = 28;

/**
 * Lower bound for the jitter reference scale, as a fraction of the clip's own
 * motion range. See computeBaseline for why a floor is needed at all.
 */
const JITTER_FLOOR_FRACTION = 0.08;

/** Brightness band (mean luma, 0-255) treated as correctly exposed. */
const LUMA_GOOD_MIN = 50;
const LUMA_GOOD_MAX = 205;

/**
 * Per-clip reference points. Quality is judged **relative to the clip's own
 * distribution**, not against absolute constants, because handheld footage
 * shot outdoors never reaches the stillness of a tripod indoors — and the
 * question being answered is "which moments of this clip are the good ones",
 * not "is this clip good".
 */
export type ClipBaseline = {
  motionP10: number;
  motionP90: number;
  jitterP90: number;
};

export function computeBaseline(
  metrics: ClipMetrics,
  options: WindowingOptions = DEFAULT_WINDOWING,
): ClipBaseline {
  const values = metrics.motion.map((s) => s.value);
  const motionP10 = percentile(values, 0.1);
  const motionP90 = percentile(values, 0.9);

  // Jitter is measured over sliding windows of the shortest usable length, so
  // its reference scale matches the scale windows are actually scored at.
  const jitters: number[] = [];
  const span = options.minDurationSec;
  for (
    let start = 0;
    start + span <= (metrics.motion.at(-1)?.timeSec ?? 0);
    start += options.strideSec
  ) {
    const inWindow = samplesInRange(metrics.motion, start, start + span);
    if (inWindow.length >= 3) jitters.push(jitter(inWindow.map((s) => s.value)));
  }

  // Jitter is only meaningful relative to how much the picture moves at all.
  // Without a floor the reference collapses on footage that is mostly locked
  // off — a tripod clip with one camera move in it drives jitterP90 toward
  // zero, and then that single legitimate move scores as maximum shake. The
  // floor is a fraction of the clip's own motion range, so it scales with the
  // material rather than being an absolute guess.
  const measured = jitters.length > 0 ? percentile(jitters, 0.9) : 0;
  const floor = (motionP90 - motionP10) * JITTER_FLOOR_FRACTION;

  return { motionP10, motionP90, jitterP90: Math.max(measured, floor) };
}

function scoreStability(
  metrics: ClipMetrics,
  baseline: ClipBaseline,
  startSec: number,
  endSec: number,
): number {
  const values = samplesInRange(metrics.motion, startSec, endSec).map(
    (s) => s.value,
  );
  if (values.length < 3) return 0;
  if (baseline.jitterP90 <= 0) return 1;
  return 1 - clamp01(jitter(values) / baseline.jitterP90);
}

/**
 * Does the window *end* settled, or was it cut mid-movement? This is the
 * signal the user named first — twenty shots of the same table, and the one
 * worth using is the one whose camera move finishes.
 *
 * A window that never moved is complete by definition (nothing was cut), so
 * a near-flat window short-circuits to 1 rather than dividing by a peak that
 * is indistinguishable from its own baseline.
 */
function scoreMovementCompleteness(
  metrics: ClipMetrics,
  baseline: ClipBaseline,
  startSec: number,
  endSec: number,
): number {
  const values = samplesInRange(metrics.motion, startSec, endSec).map(
    (s) => s.value,
  );
  if (values.length < 3) return 0;

  const peak = Math.max(...values);
  const range = baseline.motionP90 - baseline.motionP10;
  const rise = peak - baseline.motionP10;
  // Nothing meaningfully happened: a hold, which is trivially complete.
  if (range <= 0 || rise <= range * 0.15) return 1;

  const tailStart = Math.max(1, Math.floor(values.length * 0.75));
  const endLevel = mean(values.slice(tailStart));
  return 1 - clamp01((endLevel - baseline.motionP10) / rise);
}

/**
 * Is anything actually happening?
 *
 * This exists because of user feedback on the first real catalogue: the
 * windows it returned were genuinely well-shot, but they kept landing on the
 * calm moments *around* the action rather than on the action itself — the
 * pour from pot to glass, the sage going into the pot. That was not a bug in
 * the measurements, it was a direct consequence of scoring only steadiness
 * and settling: a locked-off shot of nothing scored 1.00 on both.
 *
 * The signal was already in the data and simply unused. Stability reads the
 * curve's *jitter*; this reads its *level*. A pour in front of a static
 * camera produces large, sustained frame differences with little jitter,
 * while shake produces jitter with no sustained level — so the two are
 * independent, and a shot can now be rewarded for being eventful and
 * punished for being unsteady at the same time.
 *
 * Note this is exactly where frame differencing's inability to separate
 * camera motion from subject motion stops being a limitation and becomes the
 * point: subject motion is what "something is happening" means.
 */
function scoreActivity(
  metrics: ClipMetrics,
  baseline: ClipBaseline,
  startSec: number,
  endSec: number,
): number {
  const values = samplesInRange(metrics.motion, startSec, endSec).map(
    (s) => s.value,
  );
  if (values.length === 0) return 0;
  const range = baseline.motionP90 - baseline.motionP10;
  if (range <= 0) return 0;
  return clamp01((mean(values) - baseline.motionP10) / range);
}

function scoreSharpness(
  metrics: ClipMetrics,
  startSec: number,
  endSec: number,
): number | null {
  if (!metrics.blur) return null;
  const values = samplesInRange(metrics.blur, startSec, endSec).map(
    (s) => s.value,
  );
  if (values.length === 0) return null;
  return 1 - clamp01((mean(values) - SHARP_BLUR) / (BLURRY_BLUR - SHARP_BLUR));
}

function scoreExposure(
  metrics: ClipMetrics,
  startSec: number,
  endSec: number,
): number | null {
  if (!metrics.luma) return null;
  const values = samplesInRange(metrics.luma, startSec, endSec).map(
    (s) => s.value,
  );
  if (values.length === 0) return null;

  const avg = mean(values);
  if (avg >= LUMA_GOOD_MIN && avg <= LUMA_GOOD_MAX) return 1;
  // Taper to zero at fully crushed (0) or fully blown (255).
  return avg < LUMA_GOOD_MIN
    ? clamp01(avg / LUMA_GOOD_MIN)
    : clamp01((255 - avg) / (255 - LUMA_GOOD_MAX));
}

/**
 * Weights per signal. Stability and movement completeness carry the most
 * because those are the two the user actually chose; sharpness came bundled
 * with stability in that answer, and exposure is a guard against unusable
 * footage rather than a mark of quality. Weights are renormalised over
 * whichever signals were measured, so a clip analysed for motion only still
 * produces a comparable score.
 *
 * `length` is a light thumb on the scale toward longer windows, and it exists
 * because of a measured problem rather than a theory. The first run over the
 * project's real footage returned 66 windows of which almost every one was
 * exactly the 1.2s minimum: a shorter span is mathematically easier to score
 * well, since it has less room to shake or to be cut mid-move. That starves
 * the video-layout stage of the longer options it needs — the pacing expert
 * wants ~2s for a reel and ~4s for long-form, so a catalogue made entirely of
 * 1.2s windows forces a choppy edit no matter how good each window is. The
 * weight is deliberately small: it breaks ties toward length without letting
 * a long mediocre window beat a short excellent one.
 */
const WEIGHTS = {
  /**
   * The largest single share, and deliberately larger than `stability`.
   *
   * The first catalogue was reviewed against real footage and the verdict was
   * that the frames were genuinely good but kept missing the thing worth
   * watching — the pour from pot to glass, the sage going into the pot. A
   * unit test then reproduced the cause exactly: a flawless empty frame
   * outscored a contained action, because stillness collected full marks on
   * both craft signals while the action paid for its own ramp-in and
   * ramp-out. Weighting activity above stability is what makes an eventful
   * shot beat an immaculate boring one, which is the ranking the user asked
   * for. A handheld shot of the pour now also outranks a locked-off shot of
   * nothing — intended, not a side effect.
   */
  activity: 0.3,
  movementCompleteness: 0.24,
  stability: 0.18,
  sharpness: 0.14,
  exposure: 0.06,
  length: 0.08,
} as const;

export function scoreWindow(
  metrics: ClipMetrics,
  baseline: ClipBaseline,
  startSec: number,
  endSec: number,
  source: ShotSource,
  options: WindowingOptions = DEFAULT_WINDOWING,
): ShotWindow {
  const stability = scoreStability(metrics, baseline, startSec, endSec);
  const movementCompleteness = scoreMovementCompleteness(
    metrics,
    baseline,
    startSec,
    endSec,
  );
  const activity = scoreActivity(metrics, baseline, startSec, endSec);
  const sharpness = scoreSharpness(metrics, startSec, endSec);
  const exposure = scoreExposure(metrics, startSec, endSec);

  const span = options.maxDurationSec - options.minDurationSec;
  const length =
    span > 0
      ? clamp01((endSec - startSec - options.minDurationSec) / span)
      : 1;

  const present: [number, number][] = [
    [stability, WEIGHTS.stability],
    [movementCompleteness, WEIGHTS.movementCompleteness],
    [activity, WEIGHTS.activity],
    [length, WEIGHTS.length],
  ];
  if (sharpness !== null) present.push([sharpness, WEIGHTS.sharpness]);
  if (exposure !== null) present.push([exposure, WEIGHTS.exposure]);

  const totalWeight = present.reduce((sum, [, w]) => sum + w, 0);
  const qualityScore =
    totalWeight > 0
      ? present.reduce((sum, [value, w]) => sum + value * w, 0) / totalWeight
      : 0;

  return {
    startSec: round(startSec),
    endSec: round(endSec),
    source,
    stability: round(stability),
    movementCompleteness: round(movementCompleteness),
    activity: round(activity),
    sharpness: sharpness === null ? null : round(sharpness),
    exposure: exposure === null ? null : round(exposure),
    qualityScore: round(qualityScore),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Finds the best non-overlapping spans of a clip worth cataloguing.
 *
 * Two boundary sources are combined because real footage has two different
 * problems. Scene cuts split a multi-shot file. But a single continuous take
 * — verified on this project's own footage, where a 55s clip contained zero
 * detected cuts — needs windows found *inside* it, which is what the sliding
 * search does.
 */
export function findShotWindows(
  metrics: ClipMetrics,
  cuts: SceneCut[],
  clipDurationSec: number,
  options: WindowingOptions = DEFAULT_WINDOWING,
): ShotWindow[] {
  if (metrics.motion.length < 3 || clipDurationSec <= 0) return [];

  const baseline = computeBaseline(metrics, options);
  const boundaries = [
    0,
    ...cuts.map((c) => c.timeSec).filter((t) => t > 0 && t < clipDurationSec),
    clipDurationSec,
  ].sort((a, b) => a - b);

  const candidates: ShotWindow[] = [];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const segStart = boundaries[i];
    const segEnd = boundaries[i + 1];
    const segLength = segEnd - segStart;
    if (segLength < options.minDurationSec) continue;

    const durations = [
      options.minDurationSec,
      (options.minDurationSec + options.maxDurationSec) / 2,
      options.maxDurationSec,
    ].filter((d) => d <= segLength);
    if (durations.length === 0) durations.push(segLength);

    for (const duration of durations) {
      for (
        let start = segStart;
        start + duration <= segEnd + 1e-9;
        start += options.strideSec
      ) {
        // A window that spans essentially its whole segment came from the cut
        // boundaries; anything narrower was found by searching inside them.
        const source: ShotSource =
          cuts.length > 0 && duration >= segLength * 0.9
            ? "scene-cut"
            : "motion-window";
        candidates.push(
          scoreWindow(metrics, baseline, start, start + duration, source, options),
        );
      }
    }
  }

  // Greedy non-overlapping pick: best window first, then the best remaining
  // that does not touch it. Prefers quality over coverage, which is correct
  // here — the catalogue is a shortlist, not an edit.
  const chosen: ShotWindow[] = [];
  for (const window of candidates.sort((a, b) => b.qualityScore - a.qualityScore)) {
    if (window.qualityScore < options.minQualityScore) break;
    if (chosen.length >= options.maxWindowsPerClip) break;
    const overlaps = chosen.some(
      (c) => window.startSec < c.endSec && c.startSec < window.endSec,
    );
    if (!overlaps) chosen.push(window);
  }

  return chosen.sort((a, b) => a.startSec - b.startSec);
}
