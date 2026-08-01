/** One measurement of one ffmpeg metric at one point in time. */
export type MetricSample = {
  timeSec: number;
  value: number;
};

/**
 * Everything measured about one clip, before any windowing decision.
 *
 * `motion` is the only required series: it is the mean luma of the difference
 * between consecutive sampled frames, i.e. how much the picture changed. Note
 * that this measures **visual change**, which conflates camera motion with
 * subject motion — someone pouring tea in front of a locked-off camera reads
 * as high motion. See the two-timeline design spec for why this is used
 * anyway (ffmpeg 6.0 writes vidstabdetect's true camera transform as a binary
 * TRF1 file, which is real parsing work and deferred).
 */
export type ClipMetrics = {
  motion: MetricSample[];
  /** `lavfi.blur` — **higher means blurrier.** Verified empirically: a sharp
   * frame from real footage measured ~4.5, the same frame under gblur=8
   * measured ~28. */
  blur?: MetricSample[];
  /** `lavfi.signalstats.YAVG` on the original frames — overall brightness. */
  luma?: MetricSample[];
};

/** A detected hard cut between two shots inside one file. */
export type SceneCut = {
  timeSec: number;
};

export type ShotSource = "scene-cut" | "motion-window";

/**
 * A candidate span of footage worth considering for the cut, with the
 * deterministic quality signals the user named: a camera movement that
 * completes rather than being cut mid-move, and steadiness.
 */
export type ShotWindow = {
  startSec: number;
  endSec: number;
  source: ShotSource;
  /** 0..1 — free of shake. High for both a locked-off hold and a smooth pan. */
  stability: number;
  /** 0..1 — the window ends settled rather than mid-movement. */
  movementCompleteness: number;
  /** 0..1, or null when blur was not measured. */
  sharpness: number | null;
  /** 0..1, or null when luma was not measured. */
  exposure: number | null;
  /** 0..1 — weighted combination of whichever signals are present. */
  qualityScore: number;
};

export type WindowingOptions = {
  minDurationSec: number;
  maxDurationSec: number;
  /** How far apart candidate window start times are tried. */
  strideSec: number;
  /** Cap per clip, so one long file cannot flood the catalogue. */
  maxWindowsPerClip: number;
  /** Windows scoring below this are not worth cataloguing at all. */
  minQualityScore: number;
};

export const DEFAULT_WINDOWING: WindowingOptions = {
  minDurationSec: 1.2,
  maxDurationSec: 4,
  strideSec: 0.5,
  maxWindowsPerClip: 12,
  minQualityScore: 0.35,
};
