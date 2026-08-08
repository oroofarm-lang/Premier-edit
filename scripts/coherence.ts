import "dotenv/config";
import { basename } from "node:path";
import { prisma } from "@/lib/db";
import type { TranscriptSegment } from "@/lib/transcription/types";

/**
 * Prints the cut as sound against picture, moment by moment: what is said,
 * and what is on screen while it is said.
 *
 * This exists because the two timelines are planned independently — the spine
 * from the transcript, the picture from ffmpeg metrics — and nothing else in
 * the project shows them side by side. The user's words for the gap were
 * "we have audio content and visual content, and we need to make them work
 * together"; you cannot work on that without being able to look at it, and
 * looking at it in Premiere costs a rebuild every time.
 *
 * Free: reads the database only. No model call, no API key.
 *
 * Run: npm run coherence
 */

/** Trim spoken text to something that fits one line beside the shot list. */
const TEXT_WIDTH = 62;

type Shown = {
  fileName: string;
  startSec: number;
  endSec: number;
  inSync: boolean;
  reason: string;
};

function bar(fraction: number, width = 12): string {
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * width);
  return "█".repeat(filled) + "·".repeat(width - filled);
}

async function main() {
  const projects = await prisma.project.findMany({ select: { id: true, name: true } });
  let reported = 0;

  for (const project of projects) {
    const selections = await prisma.selection.findMany({
      where: { projectId: project.id },
      orderBy: { order: "asc" },
      include: { mediaAsset: { select: { filePath: true, id: true } } },
    });
    const placements = await prisma.videoPlacement.findMany({
      where: { projectId: project.id },
      orderBy: { order: "asc" },
      include: { shot: { include: { mediaAsset: { select: { filePath: true, id: true } } } } },
    });
    if (selections.length === 0 || placements.length === 0) continue;
    reported += 1;

    // The transcript text for a moment is not stored on the Selection, so it
    // is recovered from the transcript segments the moment's times overlap.
    // Segments live as JSON on the Transcript row, not as their own table.
    const transcripts = (
      await prisma.transcript.findMany({
        where: { mediaAsset: { projectId: project.id } },
      })
    ).map((t) => {
      let segments: TranscriptSegment[] = [];
      try {
        segments = JSON.parse(t.segmentsJson) as TranscriptSegment[];
      } catch {
        segments = [];
      }
      return { mediaAssetId: t.mediaAssetId, segments };
    });

    console.log(`\n=== ${project.name} ===\n`);

    let cursor = 0;
    let syncTotal = 0;
    let shownTotal = 0;

    for (const sel of selections) {
      const start = cursor;
      const end = cursor + (sel.endSec - sel.startSec);
      cursor = end;

      const words = transcripts
        .filter((t) => t.mediaAssetId === sel.mediaAssetId)
        .flatMap((t) => t.segments)
        .filter((s) => s.startSec < sel.endSec && sel.startSec < s.endSec)
        .map((s) => s.text.trim())
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      const shown: Shown[] = placements
        .filter((p) => p.timelineStartSec < end - 0.01 && start < p.timelineEndSec - 0.01)
        .map((p) => ({
          fileName: basename(p.shot.mediaAsset.filePath),
          startSec: p.timelineStartSec,
          endSec: p.timelineEndSec,
          inSync:
            p.shot.mediaAsset.id === sel.mediaAsset.id &&
            p.shot.startSec < sel.endSec &&
            sel.startSec < p.shot.endSec,
          reason: p.reason,
        }));

      shownTotal += shown.length;
      syncTotal += shown.filter((s) => s.inSync).length;

      const heard = words.length > TEXT_WIDTH ? `${words.slice(0, TEXT_WIDTH)}…` : words;
      console.log(
        `  [${start.toFixed(1)}–${end.toFixed(1)}s] ${basename(sel.mediaAsset.filePath)}`,
      );
      console.log(`     HEARD: ${heard || "(no transcript text)"}`);
      if (shown.length === 0) {
        console.log("     SEEN : (nothing — the picture layer does not cover this)");
      }
      for (const s of shown) {
        const mark = s.inSync ? "SYNC" : "    ";
        console.log(
          `     SEEN : ${mark} ${s.fileName} ${s.startSec.toFixed(1)}–${s.endSec.toFixed(1)}s` +
            (s.reason ? `  — ${s.reason.slice(0, 40)}` : ""),
        );
      }
      console.log("");
    }

    const audioEnd = cursor;
    const pictureEnd = placements.at(-1)?.timelineEndSec ?? 0;
    const ratio = shownTotal > 0 ? syncTotal / shownTotal : 0;

    console.log(`  sound and picture together: ${bar(ratio)} ${syncTotal}/${shownTotal} in sync`);
    console.log(`  audio ends ${audioEnd.toFixed(2)}s · picture ends ${pictureEnd.toFixed(2)}s`);
    if (pictureEnd > audioEnd + 0.1) {
      console.log(
        `  note: ${(pictureEnd - audioEnd).toFixed(2)}s of picture runs past the audio.`,
      );
    }
    console.log(
      `  sources: ${new Set(placements.map((p) => p.shot.mediaAsset.id)).size} distinct file(s) on screen`,
    );
  }

  if (reported === 0) console.log("No project has both a spine and a picture layer yet.");
  await prisma.$disconnect();
}

main();
