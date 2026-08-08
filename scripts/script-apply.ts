import "dotenv/config";
import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { persistSelection } from "@/lib/selection/run";
import { PROFILE_TARGET_SECONDS } from "@/lib/selection/types";
import { applyCraftCleanup } from "@/lib/script/craft-cleanup";
import { measureQuietRemovals } from "@/lib/craft/measure-quiet";
import { toScriptSources } from "@/lib/script/sources";
import { validateScript } from "@/lib/script/validate";
import type { Script } from "@/lib/script/types";
import type { CraftWord, Removal } from "@/lib/craft/types";

/**
 * Applies a written script to a project: validate first, persist only if every
 * line checks out.
 *
 * The validation is the reason this script exists as its own step rather than
 * the agent writing to the database directly. An agent can be wrong, and the
 * one failure mode that would be invisible downstream is a fabricated line —
 * text that reads well and was never said. `validateScript` proves each line
 * against the transcript's own word timings before anything is written.
 *
 * Nothing is partially applied. A single bad line rejects the whole script,
 * because a cut assembled from "most of" a story is not the story.
 *
 * `--check` validates and reports without writing anything, so a writer can
 * find its own mistakes instead of discovering them through the user.
 *
 * Run: npm run script:apply -- "<project name or id>" <script.json> [--check]
 */

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  // Off by default, and that is a decision from the user's own ear: they do not
  // mind pauses ("לא אכפת לי שיש רגעים של שקט"), and every removal adds a cut
  // to a cut they want *fewer* cuts in. Splicing dead air is a polish step, not
  // a default — coherent speech comes first.
  const trimSilence = args.includes("--trim-silence");
  const [query, scriptPath] = args.filter(
    (a) => a !== "--check" && a !== "--trim-silence",
  );
  if (!query || !scriptPath) {
    console.error(
      'Usage: npm run script:apply -- "<project name or id>" <script.json> [--check]',
    );
    process.exit(1);
  }

  const project = await prisma.project.findFirst({
    where: { OR: [{ id: query }, { name: { contains: query } }] },
  });
  if (!project) {
    console.error(`No project matching "${query}".`);
    process.exit(1);
  }

  let script: Script;
  try {
    script = JSON.parse(await readFile(scriptPath, "utf8")) as Script;
  } catch (err) {
    console.error(`Could not read ${scriptPath}: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  const assets = await prisma.mediaAsset.findMany({
    where: { projectId: project.id },
    include: { transcript: true },
  });
  const sources = toScriptSources(
    assets.map((a) => ({
      id: a.id,
      filePath: a.filePath,
      segmentsJson: a.transcript?.segmentsJson ?? null,
    })),
  );

  const targetDurationSec = PROFILE_TARGET_SECONDS[project.outputProfile];
  const result = validateScript(script, {
    outputProfile: project.outputProfile,
    targetDurationSec,
    sources,
  });

  for (const warning of result.warnings) {
    const where = warning.order === null ? "script" : `line ${warning.order}`;
    console.warn(`  warning (${where}): ${warning.message}`);
  }

  if (!result.ok) {
    console.error(`\nRejected — ${result.errors.length} problem(s), nothing was written:\n`);
    for (const error of result.errors) {
      const where = error.order === null ? "script" : `line ${error.order}`;
      console.error(`  ${where}: ${error.message}`);
    }
    await prisma.$disconnect();
    process.exit(1);
  }

  // Deterministic craft pass: splices out any real interior pause inside a
  // line's own take (faster-whisper's word timings are already in `sources`,
  // so this costs nothing extra). `planCleanup` has existed since the old
  // heuristic pipeline but was only ever wired into `craft:preview` — this is
  // the first caller that actually persists what it finds.
  const fileNameByAssetId = Object.fromEntries(
    assets.map((a) => [a.id, basename(a.filePath)]),
  );
  const wordsByAssetId: Record<string, CraftWord[]> = Object.fromEntries(
    sources.map((s) => [s.mediaAssetId, s.words]),
  );
  const durationByAssetId = Object.fromEntries(
    assets.map((a) => [a.id, a.durationSec]),
  );
  // Measure each line's own audio. This is the check that word timings cannot
  // do: faster-whisper absorbs a pause into a neighbouring word's span rather
  // than reporting a gap, so a line can read as continuous speech and carry a
  // full second of silence. Measured on this footage — see lib/craft/quiet.ts.
  const pathByAssetId = Object.fromEntries(assets.map((a) => [a.id, a.filePath]));
  const measuredQuietByOrder: Record<number, Removal[]> = {};
  for (const line of trimSilence ? result.lines : []) {
    const filePath = pathByAssetId[line.mediaAssetId];
    if (!filePath) continue;
    try {
      const quiet = await measureQuietRemovals(
        filePath,
        line.startSec,
        line.endSec,
        wordsByAssetId[line.mediaAssetId] ?? [],
      );
      if (quiet.length > 0) measuredQuietByOrder[line.order] = quiet;
    } catch (err) {
      // Footage can be moved after ingest. A failed measurement must not block
      // the apply — it only means this line keeps whatever quiet it has.
      console.warn(
        `  warning (line ${line.order}): could not measure audio ` +
          `(${err instanceof Error ? err.message : err}).`,
      );
    }
  }

  const cleaned = applyCraftCleanup(
    result.lines,
    fileNameByAssetId,
    wordsByAssetId,
    durationByAssetId,
    measuredQuietByOrder,
  );

  for (const warning of cleaned.warnings) console.warn(`  craft: ${warning}`);
  if (cleaned.removalsCount > 0) {
    console.log(
      `\nCraft cleanup: removed ${cleaned.removalsCount} interior pause(s), ` +
        `-${cleaned.secondsRemoved}s (${result.lines.length} line(s) -> ` +
        `${cleaned.selections.length} moment(s)).`,
    );
  }

  if (checkOnly) {
    console.log(
      `\nValid: ${result.lines.length} line(s), ${result.totalDurationSec}s against a ` +
        `${targetDurationSec}s target. Nothing written (--check).`,
    );
    await prisma.$disconnect();
    return;
  }

  await persistSelection(project.id, project.outputProfile, {
    selections: cleaned.selections,
    premise: script.premise,
    beatPlan: script.beats,
  });

  console.log(`\nApplied ${cleaned.selections.length} moment(s) to ${project.name}.`);
  console.log(`  ${result.totalDurationSec}s against a ${targetDurationSec}s target`);
  console.log(`  premise: ${script.premise}`);
  console.log(
    "\nThe content-selection checkpoint is now unapproved and any picture layer was cleared —" +
      "\nreview the cut, then Build sequence in the panel.",
  );

  await prisma.$disconnect();
}

main();
