import type { OutputProfile } from "@/lib/generated/prisma/enums";
import {
  targetPlacementCount,
  type LayoutPlacement,
  type LayoutPlan,
  type ShotCandidate,
  type SpineMoment,
} from "./layout-plan";

/**
 * Lays the picture layer out without a model.
 *
 * The project already has this shape elsewhere: `HeuristicContentSelector`
 * sits beside `LlmContentSelector` and runs with no API key, so the pipeline
 * works end to end for free and there is a baseline to judge the model
 * against. The video layer had no such fallback, which meant an empty API
 * balance stopped the stage dead — this closes that gap.
 *
 * Everything it needs is already measured for free by `lib/shots/`: quality,
 * activity, movement completeness, source file and source times.
 *
 * **What it cannot do**, stated plainly rather than discovered later: it has
 * no idea what is *in* a shot. It cannot put the pour under the words about
 * pouring, because it cannot read either. It produces a varied, well-shot,
 * gapless picture layer that respects the craft rules — not one that means
 * anything. Content matching is exactly what the model call buys.
 */

/** How much a source file's score decays per placement already taken from it. */
const REUSE_PENALTY = 0.12;

/** Matches the same rule the validator enforces on consecutive same-file spans. */
const SAME_FILE_ANGLE_GAP_SEC = 2;

/** Anything shorter than this is a flicker, not a shot. */
const MIN_PLACEMENT_SEC = 0.7;

/**
 * How far a cut will move to land on a spine boundary instead of wherever
 * the arithmetic put it.
 *
 * Measured, not guessed. The first version of this planner sliced at a fixed
 * density and produced 21 placements of 1.65s each — a metronome. Only 3 of
 * the 21 cuts landed within a quarter second of a boundary in the spoken
 * story; the median cut was 0.86s away from one. That is the mechanical
 * reason the picture read as mechanical: a human editor cuts *on* something,
 * and these cut on nothing.
 *
 * Half a second is wide enough to catch a boundary the metronome nearly hit
 * and narrow enough that snapping never drags a cut somewhere it does not
 * belong.
 */
const SNAP_WINDOW_SEC = 0.5;

/**
 * How far a placement's length may stray from the nominal span, driven by
 * what the shot analysis already measured about the shot.
 *
 * A shot with real activity that carries a camera move through to its end
 * wants to be watched; a static one has said everything it has within a
 * beat. Deriving the variation from measurement rather than randomness is
 * what makes it read as pacing instead of noise.
 */
const MIN_HOLD_FACTOR = 0.7;
const MAX_HOLD_FACTOR = 1.35;

const EPSILON = 0.01;

/**
 * Where the spoken story changes gear: the timeline position of every moment
 * boundary. These are the points where a picture cut is motivated rather
 * than arbitrary — the speaker has finished a thought, so the eye expects
 * something new.
 */
function spineBoundaries(spine: SpineMoment[]): number[] {
  const points = new Set<number>();
  for (const moment of spine) {
    points.add(round(moment.timelineStartSec));
    points.add(round(moment.timelineEndSec));
  }
  return [...points].sort((a, b) => a - b);
}

/** How long this shot deserves to be held, relative to the nominal span. */
function holdFactor(shot: ShotCandidate): number {
  const energy = clamp01(0.6 * shot.activity + 0.4 * shot.movementCompleteness);
  return MIN_HOLD_FACTOR + energy * (MAX_HOLD_FACTOR - MIN_HOLD_FACTOR);
}

/**
 * Moves the end of a placement onto a nearby spine boundary, when one is
 * close enough and the shot has the frames to reach it. Returns the span to
 * use — unchanged when no boundary is in range, which is the common case
 * early in a cut and the reason this degrades quietly rather than distorting
 * the pacing to chase boundaries that are not there.
 */
function snapSpan(
  cursor: number,
  span: number,
  boundaries: number[],
  available: number,
  remaining: number,
): number {
  const target = cursor + span;
  let best: number | null = null;

  for (const boundary of boundaries) {
    if (Math.abs(boundary - target) > SNAP_WINDOW_SEC) continue;
    const candidateSpan = boundary - cursor;
    // Never snap into a flicker, past the end of the source shot, or past
    // the end of the spine.
    if (candidateSpan < MIN_PLACEMENT_SEC) continue;
    if (candidateSpan > available || candidateSpan > remaining) continue;
    if (best === null || Math.abs(boundary - target) < Math.abs(best - target)) {
      best = boundary;
    }
  }

  return best === null ? span : best - cursor;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function isJumpCut(a: ShotCandidate, b: ShotCandidate): boolean {
  if (a.fileName !== b.fileName) return false;
  const gap = Math.min(
    Math.abs(b.startSec - a.endSec),
    Math.abs(a.startSec - b.endSec),
  );
  return gap < SAME_FILE_ANGLE_GAP_SEC;
}

export function planLayoutHeuristically(
  spine: SpineMoment[],
  candidates: ShotCandidate[],
  outputProfile: OutputProfile,
): LayoutPlan {
  const totalSec = spine.at(-1)?.timelineEndSec ?? 0;
  if (totalSec <= 0 || candidates.length === 0) return { placements: [] };

  const target = targetPlacementCount(totalSec, outputProfile);
  // Never plan more cuts than there are shots to fill them with. Dividing by
  // the density target alone made the planner take short slices until the
  // catalogue ran dry and the spine was left uncovered — a black frame.
  // With a thin catalogue the right answer is fewer, longer placements.
  const affordable = Math.max(1, Math.min(target.ideal, candidates.length));
  const idealSpan = totalSec / affordable;
  const boundaries = spineBoundaries(spine);

  const used = new Set<number>();
  const usesByFile = new Map<string, number>();
  const placements: LayoutPlacement[] = [];
  let cursor = 0;
  let previous: ShotCandidate | null = null;

  while (cursor < totalSec - EPSILON) {
    const remaining = totalSec - cursor;
    // Recompute the span budget from what is actually left rather than using
    // one fixed slice for the whole cut. This is what lets a placement run
    // long or short without the difference being paid for at the end: a shot
    // held longer than nominal simply leaves fewer seconds per remaining
    // slot. A fixed slice plus variable lengths would drift, and drifting
    // short exhausts the catalogue before the spine is covered — a black
    // frame, which is the failure this planner has already produced once.
    const slotsLeft = Math.max(
      1,
      Math.min(Math.round(remaining / idealSpan), candidates.length - used.size),
    );
    const baseSpan = remaining / slotsLeft;
    // Absorb a final sliver rather than leaving a placement too short to read.
    const want = remaining < baseSpan * 1.5 ? remaining : baseSpan;

    const pick = choose(candidates, used, usesByFile, previous, want, remaining);
    if (pick === null) break;

    const shot = candidates[pick];
    const available = shot.endSec - shot.startSec;
    // Never ask a shot for more frames than it has, never overrun the spine,
    // and never leave a remainder too small to be its own placement.
    let span = Math.min(want * holdFactor(shot), available, remaining);
    span = Math.max(span, Math.min(MIN_PLACEMENT_SEC, available, remaining));
    span = snapSpan(cursor, span, boundaries, available, remaining);
    if (remaining - span < MIN_PLACEMENT_SEC) span = Math.min(remaining, available);

    placements.push({
      index: pick,
      timelineStartSec: round(cursor),
      timelineEndSec: round(cursor + span),
      useSourceAudio: false,
      reason: describe(shot),
    });

    used.add(pick);
    usesByFile.set(shot.fileName, (usesByFile.get(shot.fileName) ?? 0) + 1);
    previous = shot;
    cursor += span;
  }

  // Close the last sliver of floating-point drift — but only as far as the
  // final shot actually has frames. Blindly snapping the end to totalSec
  // would ask Premiere for footage that does not exist, which the validator
  // catches and which was a real bug here: with a thin catalogue the planner
  // ran out of shots and stretched the last one from 1.7s to 20s.
  const last = placements.at(-1);
  if (last) {
    const shot = candidates[last.index];
    const room = shot.endSec - shot.startSec;
    last.timelineEndSec = round(
      Math.min(totalSec, last.timelineStartSec + room),
    );
  }

  return { placements };
}

/**
 * Picks the next shot: highest quality, penalised for how often its source
 * file has already been used, rejecting anything that would read as a jump
 * cut or is too short for the slot. Falls back by relaxing the length
 * requirement first and the jump-cut rule last, because a repeated angle is
 * a worse defect than a slightly short shot.
 */
function choose(
  candidates: ShotCandidate[],
  used: Set<number>,
  usesByFile: Map<string, number>,
  previous: ShotCandidate | null,
  want: number,
  remaining: number,
): number | null {
  // Constraints relax in order of how much each defect costs: a slightly
  // short shot is cheap, a repeated angle is worse. Reuse is deliberately not
  // among them — the validator rejects a shot used twice, so a planner that
  // reused one would simply produce layouts that never pass.
  const passes = [
    { minLength: Math.min(want, remaining) * 0.8, allowJumpCut: false },
    { minLength: MIN_PLACEMENT_SEC, allowJumpCut: false },
    { minLength: MIN_PLACEMENT_SEC, allowJumpCut: true },
  ];

  for (const pass of passes) {
    let best: number | null = null;
    let bestScore = -Infinity;

    for (const [i, shot] of candidates.entries()) {
      if (used.has(i)) continue;
      if (shot.endSec - shot.startSec < pass.minLength) continue;
      if (!pass.allowJumpCut && previous && isJumpCut(previous, shot)) continue;

      const reuse = usesByFile.get(shot.fileName) ?? 0;
      const score = shot.qualityScore - reuse * REUSE_PENALTY;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best !== null) return best;
  }
  return null;
}

function describe(shot: ShotCandidate): string {
  if (shot.description) return shot.description.slice(0, 60);
  const traits: string[] = [];
  if (shot.activity >= 0.6) traits.push("פעולה");
  if (shot.movementCompleteness >= 0.8) traits.push("תנועה שלמה");
  if (traits.length === 0) traits.push("שוט יציב");
  return traits.join(", ");
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
