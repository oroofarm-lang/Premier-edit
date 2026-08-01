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

const EPSILON = 0.01;

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

  const used = new Set<number>();
  const usesByFile = new Map<string, number>();
  const placements: LayoutPlacement[] = [];
  let cursor = 0;
  let previous: ShotCandidate | null = null;

  while (cursor < totalSec - EPSILON) {
    const remaining = totalSec - cursor;
    // Absorb a final sliver rather than leaving a placement too short to read.
    const want = remaining < idealSpan * 1.5 ? remaining : idealSpan;

    const pick = choose(candidates, used, usesByFile, previous, want, remaining);
    if (pick === null) break;

    const shot = candidates[pick];
    const available = shot.endSec - shot.startSec;
    // Never ask a shot for more frames than it has, never overrun the spine,
    // and never leave a remainder too small to be its own placement.
    let span = Math.min(want, available, remaining);
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
