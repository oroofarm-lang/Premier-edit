import { planCleanup } from "@/lib/craft/plan";
import type { CraftWord, Removal, SpineMomentInput } from "@/lib/craft/types";
import type { SelectedSegment } from "@/lib/selection/types";
import type { ScriptLine } from "./types";

/**
 * Runs the deterministic craft layer over a validated script, so a real
 * interior pause inside one line's own take is spliced out before the line
 * ever becomes a `Selection` row.
 *
 * `planCleanup` has existed since the old heuristic pipeline but was never
 * connected to anything that writes to the database — `npm run craft:preview`
 * was its only caller. This is the first live wiring. Pure and Prisma-free,
 * same split as `validate.ts`/`script-apply.ts`, so it is unit-testable.
 */
/**
 * Shortest fragment of the spine worth keeping, in seconds.
 *
 * Well below `MIN_FRAGMENT_SEC` (0.7) on purpose: that is a floor for how long
 * a *shot* must be on screen, and applying it to audio deletes words. Set just
 * under the validator's own `MIN_LINE_SEC` (0.4) so any line that passed
 * validation survives cleanup, and a fragment carrying a single short word is
 * kept rather than traded away for a pause.
 */
export const MIN_SPINE_FRAGMENT_SEC = 0.3;

export type CraftCleanupResult = {
  selections: SelectedSegment[];
  removalsCount: number;
  secondsRemoved: number;
  warnings: string[];
};

export function applyCraftCleanup(
  lines: ScriptLine[],
  fileNameByAssetId: Record<string, string>,
  wordsByAssetId: Record<string, CraftWord[]>,
  durationByAssetId: Record<string, number | null>,
  measuredQuietByOrder: Record<number, Removal[]> = {},
): CraftCleanupResult {
  const moments: SpineMomentInput[] = lines.map((line) => ({
    order: line.order,
    mediaAssetId: line.mediaAssetId,
    fileName: fileNameByAssetId[line.mediaAssetId] ?? "",
    startSec: line.startSec,
    endSec: line.endSec,
    text: line.text,
    score: null,
    reason: line.reason,
  }));

  const plan = planCleanup(moments, wordsByAssetId, {
    durationByAssetId,
    measuredQuietByOrder,
    minFragmentSec: MIN_SPINE_FRAGMENT_SEC,
  });

  // A fragment carries the same reason as the line it split from — that
  // justification still describes it; splitting a line into two moments
  // doesn't halve why either half earns its place.
  const selections: SelectedSegment[] = plan.moments.map((m) => ({
    mediaAssetId: m.mediaAssetId,
    startSec: m.startSec,
    endSec: m.endSec,
    order: m.order,
    score: 0,
    reason: m.reason ?? "",
  }));

  return {
    selections,
    removalsCount: plan.removals.length,
    secondsRemoved: plan.secondsRemoved,
    warnings: plan.warnings,
  };
}
