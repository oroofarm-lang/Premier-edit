import "dotenv/config";
import { basename } from "node:path";
import { prisma } from "@/lib/db";
import { resolveSourceWindow } from "@/lib/video/layout-plan";

/**
 * Reports how much of each catalogued shot the picture layer actually uses,
 * and — the part that matters — whether the placement reaches the end of the
 * window it was graded on.
 *
 * The shot catalogue scores a window on `movementCompleteness`, "ends settled
 * rather than mid-movement". A trim that keeps the head of the window
 * discards exactly that. This script is what turned "the pour never reaches
 * the cup" into a number.
 *
 * Run: npm run measure:trim
 */

/** How close to the window's end still counts as reaching it, in seconds. */
const REACH_EPSILON = 0.05;
/** movementCompleteness at or above which the ending is the point of the shot. */
const COMPLETING = 0.8;

async function main() {
  const projects = await prisma.project.findMany({ select: { id: true, name: true } });
  let reported = 0;

  for (const proj of projects) {
    const placements = await prisma.videoPlacement.findMany({
      where: { projectId: proj.id },
      orderBy: { order: "asc" },
      include: { shot: { include: { mediaAsset: true } } },
    });
    if (placements.length === 0) continue;
    reported += 1;

    console.log(`\n=== ${proj.name} — ${placements.length} placement(s) ===`);
    console.log("  #  file            window  placed  complete   takes          reaches end?");

    let completing = 0;
    let completingReached = 0;
    let completingReachedBefore = 0;

    for (const p of placements) {
      const shot = p.shot;
      const windowSec = shot.endSec - shot.startSec;
      const span = p.timelineEndSec - p.timelineStartSec;
      const { sourceInSec, sourceOutSec } = resolveSourceWindow(shot, span);

      const reaches = sourceOutSec >= shot.endSec - REACH_EPSILON;
      // What the old head-anchored trim would have produced.
      const reachedBefore =
        shot.startSec + Math.min(span, windowSec) >= shot.endSec - REACH_EPSILON;

      if (shot.movementCompleteness >= COMPLETING) {
        completing += 1;
        if (reaches) completingReached += 1;
        if (reachedBefore) completingReachedBefore += 1;
      }

      const mark = reaches ? (reachedBefore ? "yes" : "yes  (was NO)") : "no";
      console.log(
        `  ${String(p.order).padStart(2)}  ${basename(shot.mediaAsset.filePath).padEnd(14)}` +
          ` ${windowSec.toFixed(2).padStart(5)}s ${span.toFixed(2).padStart(6)}s` +
          ` ${shot.movementCompleteness.toFixed(2).padStart(8)}` +
          `   ${sourceInSec.toFixed(2)}→${sourceOutSec.toFixed(2)}   ${mark}`,
      );
    }

    console.log(
      `\n  Shots graded >= ${COMPLETING} on movementCompleteness: ${completing}.` +
        ` Reaching their own ending — before: ${completingReachedBefore}, now: ${completingReached}.`,
    );
  }

  if (reported === 0) console.log("No project has a picture layer yet.");
  await prisma.$disconnect();
}

main();
