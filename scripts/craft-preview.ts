/**
 * Runs the deterministic craft layer over a real project's audio spine and
 * prints what it would remove — without changing anything.
 *
 * Same purpose as `analyze:shots`: this project's thresholds have repeatedly
 * turned out wrong when reasoned about and right when measured, so the cheap
 * way to judge a cleanup rule is to run it over real transcripts and read the
 * numbers. Costs nothing — no API key, no model call, no writes.
 *
 *   npm run craft:preview -- <projectId|projectNameFragment>
 */
// Prisma 6 no longer auto-loads .env, and this runs outside Next.js — which
// loads it for the app but not for a bare tsx script. Same reason
// prisma.config.ts does this.
import "dotenv/config";
import { basename } from "node:path";
import { prisma } from "../lib/db";
import { planCleanup } from "../lib/craft/plan";
import type { CraftWord, SpineMomentInput } from "../lib/craft/types";

async function main() {
  const query = process.argv[2];
  if (!query) {
    const all = await prisma.project.findMany({ select: { id: true, name: true } });
    console.error("Usage: npm run craft:preview -- <projectId|nameFragment>\n");
    console.error("Projects:");
    for (const p of all) console.error(`  ${p.id}  ${p.name}`);
    process.exit(1);
  }

  const project = await prisma.project.findFirst({
    where: { OR: [{ id: query }, { name: { contains: query } }] },
    include: {
      selections: {
        orderBy: { order: "asc" },
        include: { mediaAsset: { include: { transcript: true } } },
      },
    },
  });

  if (!project) {
    console.error(`No project matching "${query}".`);
    process.exit(1);
  }
  if (project.selections.length === 0) {
    console.error(`"${project.name}" has no audio spine yet — run selection first.`);
    process.exit(1);
  }

  const wordsByAssetId: Record<string, CraftWord[]> = {};
  const durationByAssetId: Record<string, number | null> = {};
  let assetsWithWords = 0;

  for (const selection of project.selections) {
    const asset = selection.mediaAsset;
    if (wordsByAssetId[asset.id]) continue;
    durationByAssetId[asset.id] = asset.durationSec;

    const segments = asset.transcript
      ? (JSON.parse(asset.transcript.segmentsJson) as { words?: CraftWord[] }[])
      : [];
    const words = segments.flatMap((s) => s.words ?? []);
    wordsByAssetId[asset.id] = words;
    if (words.length > 0) assetsWithWords += 1;
  }

  const moments: SpineMomentInput[] = project.selections.map((s) => ({
    order: s.order,
    mediaAssetId: s.mediaAssetId,
    fileName: basename(s.mediaAsset.filePath),
    startSec: s.startSec,
    endSec: s.endSec,
    text: "",
    score: s.score,
    reason: s.reason,
  }));

  const plan = planCleanup(moments, wordsByAssetId, { durationByAssetId });

  console.log(`\n${project.name}`);
  console.log(
    `${moments.length} moments, ${Object.keys(wordsByAssetId).length} assets ` +
      `(${assetsWithWords} with word timings)\n`,
  );

  const silence = plan.removals.filter((r) => r.kind === "silence");
  const fillers = plan.removals.filter((r) => r.kind === "filler");

  console.log(`removals: ${silence.length} silence, ${fillers.length} filler`);
  console.log(
    `duration: ${plan.durationBeforeSec}s -> ${plan.durationAfterSec}s ` +
      `(-${plan.secondsRemoved}s)`,
  );
  console.log(`moments:  ${moments.length} -> ${plan.moments.length}\n`);

  for (const removal of plan.removals) {
    console.log(
      `  moment ${removal.sourceOrder + 1}  ${removal.startSec}s-${removal.endSec}s  ` +
        `${(removal.endSec - removal.startSec).toFixed(2)}s  ${removal.label}`,
    );
  }
  for (const warning of plan.warnings) console.log(`  ! ${warning}`);

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
