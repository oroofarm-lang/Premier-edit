import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { prisma } from "@/lib/db";
import { PROFILE_TARGET_SECONDS } from "@/lib/selection/types";
import { scoreScript } from "@/lib/script/score";
import { toScriptSources } from "@/lib/script/sources";
import { validateScript } from "@/lib/script/validate";
import type { ScriptScorecard } from "@/lib/script/score";
import type { Script } from "@/lib/script/types";

/**
 * Scores candidate scripts side by side, before any of them is applied.
 *
 * The problem this closes: on 2026-08-07 four directions were written for one
 * project, and comparing them meant rendering four wavs and listening to all of
 * them in full. Listening is still the decider — nothing here replaces the ear —
 * but the mechanical faults (a hook over the rule, a line ending on a comma, a
 * continuous take chopped in half) are arithmetic, and finding those by ear is
 * a waste of the only judgement in the loop that cannot be automated.
 *
 * Free — no model call. Every number comes from word timings already stored.
 *
 *   npm run script:score -- "<project>"                    # every candidate found
 *   npm run script:score -- "<project>" a.json b.json       # just these
 */

const OUT_DIR = "scripts-out";

function bar(points: number, max: number): string {
  const filled = max === 0 ? 0 : Math.round((points / max) * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

/** Candidate scripts for a project, when none were named explicitly. */
async function discover(projectName: string): Promise<string[]> {
  const slug = projectName.trim().replace(/\s+/g, "-");
  let entries: string[];
  try {
    entries = await readdir(OUT_DIR);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.startsWith(slug) && f.endsWith(".json"))
    .sort()
    .map((f) => join(OUT_DIR, f));
}

async function main() {
  const args = process.argv.slice(2);
  const [query, ...named] = args;

  if (!query) {
    const all = await prisma.project.findMany({ select: { id: true, name: true } });
    console.error('Usage: npm run script:score -- "<project>" [script.json ...]\n');
    console.error("Projects:");
    for (const p of all) console.error(`  ${p.id}  ${p.name}`);
    process.exit(1);
  }

  const project = await prisma.project.findFirst({
    where: { OR: [{ id: query }, { name: { contains: query } }] },
  });
  if (!project) {
    console.error(`No project matching "${query}".`);
    process.exit(1);
  }

  const paths = named.length > 0 ? named : await discover(project.name);
  if (paths.length === 0) {
    console.error(`No candidate scripts found for "${project.name}" in ${OUT_DIR}/.`);
    console.error("Write one with the script-writer agent, or name a file explicitly.");
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

  console.log(`\n${project.name} — ${project.outputProfile}, ${targetDurationSec}s target`);
  console.log(`${sources.length} clip(s) with speech, ${paths.length} candidate(s)\n`);

  const scored: { name: string; card: ScriptScorecard; valid: boolean }[] = [];

  for (const path of paths) {
    let script: Script;
    try {
      script = JSON.parse(await readFile(path, "utf8")) as Script;
    } catch (err) {
      console.error(`  ! ${basename(path)}: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    if (!Array.isArray(script.lines) || script.lines.length === 0) {
      console.error(`  ! ${basename(path)}: no lines — not a script.`);
      continue;
    }

    // A script that cannot be applied should never top the table, however well
    // it scores. Fabricated text is the one fault that reads perfectly.
    const validation = validateScript(script, {
      outputProfile: project.outputProfile,
      targetDurationSec,
      sources,
    });
    const card = scoreScript(script, { sources, targetDurationSec });
    scored.push({ name: basename(path).replace(/\.json$/, ""), card, valid: validation.ok });

    if (!validation.ok) {
      console.error(`  ! ${basename(path)} fails validation — ${validation.errors.length} error(s):`);
      for (const e of validation.errors.slice(0, 3)) {
        console.error(`      line ${e.order}: ${e.message.split("\n")[0]}`);
      }
    }
  }

  if (scored.length === 0) {
    await prisma.$disconnect();
    process.exit(1);
  }

  scored.sort((a, b) => Number(b.valid) - Number(a.valid) || b.card.total - a.card.total);

  const width = Math.max(...scored.map((s) => s.name.length));
  console.log(`${"".padEnd(width)}  total  hook  whole  pace  close  broad   len   cuts`);
  for (const { name, card, valid } of scored) {
    const at = (id: string) => String(card.bands.find((b) => b.id === id)?.points ?? 0);
    const flag = valid ? " " : "!";
    console.log(
      `${flag}${name.padEnd(width)}  ${String(card.total).padStart(4)}   ` +
        `${at("hook").padStart(3)}   ${at("wholeness").padStart(4)}  ${at("pace").padStart(4)}  ` +
        `${at("closure").padStart(4)}   ${at("breadth").padStart(4)}  ` +
        `${card.totalDurationSec.toFixed(1).padStart(5)}s ${String(card.audibleMoments).padStart(4)}`,
    );
  }
  if (scored.some((s) => !s.valid)) {
    console.log("\n  ! = fails validation and cannot be applied, whatever it scores.");
  }

  for (const { name, card } of scored) {
    console.log(`\n─── ${name} — ${card.total}/100 ${"─".repeat(Math.max(0, 40 - name.length))}`);
    for (const band of card.bands) {
      console.log(
        `  ${band.label.padEnd(10)} ${bar(band.points, band.max)} ${String(band.points).padStart(2)}/${band.max}  ${band.detail}`,
      );
    }
    if (card.findings.length > 0) {
      console.log("");
      for (const f of card.findings) {
        const mark = f.severity === "warn" ? "  ✗" : "  ·";
        const where = f.order === null ? "" : `line ${f.order}: `;
        console.log(`${mark} ${where}${f.message}`);
      }
    }
  }

  // The corpus-level view, printed once: what is available and unopened. This
  // is the thing a writer reading a printed transcript structurally cannot see.
  const best = scored[0];
  const opportunities = best.card.missedRuns.filter((r) => r.largestUnusedSpan);
  if (opportunities.length > 0) {
    console.log(`\n─── Unused speech, against "${best.name}" ${"─".repeat(16)}`);
    for (const run of opportunities.slice(0, 5)) {
      const span = run.largestUnusedSpan!;
      const context =
        run.pieces === 0
          ? `take never opened (${run.durationSec}s total)`
          : `inside a ${run.durationSec}s take already used in ${run.pieces} piece(s)`;
      console.log(
        `  ${span.fileName} ${span.startSec}–${span.endSec}s  ${span.durationSec}s unbroken — ${context}`,
      );
      console.log(`      "${span.text.slice(0, 110)}${span.text.length > 110 ? "…" : ""}"`);
    }
    console.log(
      "\n  Each is one continuous run, so taking it whole costs one cut. Listen before trusting any number here.",
    );
  }

  console.log("");
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
