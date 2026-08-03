import "dotenv/config";
import { readFile } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { persistSelection } from "@/lib/selection/run";
import { PROFILE_TARGET_SECONDS } from "@/lib/selection/types";
import type { SelectedSegment } from "@/lib/selection/types";
import { toScriptSources } from "@/lib/script/sources";
import { validateScript } from "@/lib/script/validate";
import type { Script } from "@/lib/script/types";

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
  const [query, scriptPath] = args.filter((a) => a !== "--check");
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

  if (checkOnly) {
    console.log(
      `Valid: ${result.lines.length} line(s), ${result.totalDurationSec}s against a ` +
        `${targetDurationSec}s target. Nothing written (--check).`,
    );
    await prisma.$disconnect();
    return;
  }

  // A script line and a Selection row are the same thing — see lib/script/types.ts
  // — so this is a rename, not a translation. Score is null: a written line has
  // an argued reason, not a computed one, and inventing a number would make
  // editorial judgement look like measurement.
  const selections: SelectedSegment[] = result.lines.map((line) => ({
    mediaAssetId: line.mediaAssetId,
    startSec: line.startSec,
    endSec: line.endSec,
    order: line.order,
    score: 0,
    reason: line.reason,
  }));

  await persistSelection(project.id, project.outputProfile, {
    selections,
    premise: script.premise,
    beatPlan: script.beats,
  });

  console.log(`Applied ${selections.length} line(s) to ${project.name}.`);
  console.log(`  ${result.totalDurationSec}s against a ${targetDurationSec}s target`);
  console.log(`  premise: ${script.premise}`);
  console.log(
    "\nThe content-selection checkpoint is now unapproved and any picture layer was cleared —" +
      "\nreview the cut, then Build sequence in the panel.",
  );

  await prisma.$disconnect();
}

main();
