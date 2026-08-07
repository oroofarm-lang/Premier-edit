/**
 * Renders the approved audio spine to a single audio file, using ffmpeg only.
 *
 * This exists because "does the story hold up as sound alone" was a question
 * that could previously only be answered by building a sequence in Premiere
 * and listening there — which is the user's own manual step, and a slow loop
 * for something the pipeline already knows completely.
 *
 * It renders exactly what the cut would place: each selected span, butt-joined
 * in order, same arithmetic as `buildCutTimeline`. Then it measures the result
 * with ffmpeg's own silence detector, so a report of "there is silence in it"
 * becomes a number with a timestamp instead of an impression.
 *
 * Free — ffmpeg only, no API key, no model call.
 *
 *   npm run render:spine -- <projectId|nameFragment>
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { prisma } from "../lib/db";

const OUT_DIR = "scripts-out";

/** Silence threshold and duration for the report. Matches lib/craft/silence.ts's
 *  0.7s notion of "dead air worth cutting", at a level well below speech. */
const NOISE_DB = -30;
const MIN_SILENCE_SEC = 0.4;

function run(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg-static did not resolve a binary path."));
    const child = spawn(ffmpegPath, args);
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stderr }));
  });
}

async function main() {
  const query = process.argv[2];
  if (!query) {
    const all = await prisma.project.findMany({ select: { id: true, name: true } });
    console.error("Usage: npm run render:spine -- <projectId|nameFragment>\n");
    console.error("Projects:");
    for (const p of all) console.error(`  ${p.id}  ${p.name}`);
    process.exit(1);
  }

  const project = await prisma.project.findFirst({
    where: { OR: [{ id: query }, { name: { contains: query } }] },
    include: {
      selections: { orderBy: { order: "asc" }, include: { mediaAsset: true } },
    },
  });
  if (!project) {
    console.error(`No project matching "${query}".`);
    process.exit(1);
  }
  if (project.selections.length === 0) {
    console.error(`"${project.name}" has no audio spine yet.`);
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const slug = project.name.trim().replace(/\s+/g, "-");
  const tmpDir = join(OUT_DIR, `.spine-${project.id}`);
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });

  console.log(`\n${project.name} — ${project.selections.length} moment(s)\n`);

  // Each span is extracted separately, then concatenated. Extracting first
  // (rather than one filter_complex) keeps the failure of one clip legible
  // instead of collapsing the whole render into one opaque error.
  const parts: string[] = [];
  let playhead = 0;
  const timeline: { order: number; startSec: number; endSec: number; fileName: string }[] = [];

  for (const s of project.selections) {
    const src = s.mediaAsset.filePath;
    const dur = s.endSec - s.startSec;
    const part = join(tmpDir, `${String(s.order).padStart(3, "0")}.wav`);

    const { code, stderr } = await run([
      "-hide_banner", "-loglevel", "error",
      "-ss", String(s.startSec),
      "-t", String(dur),
      "-i", src,
      "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le",
      "-y", part,
    ]);
    if (code !== 0) {
      console.error(`  ! moment ${s.order + 1} (${basename(src)}) failed to extract:\n${stderr}`);
      console.error("    Is the footage still at that path? Ingest records it at scan time.");
      process.exit(1);
    }

    parts.push(part);
    timeline.push({
      order: s.order,
      startSec: playhead,
      endSec: playhead + dur,
      fileName: basename(src),
    });
    console.log(
      `  ${String(s.order + 1).padStart(2)}. [${playhead.toFixed(2)}s-${(playhead + dur).toFixed(2)}s] ` +
        `${basename(src)} src[${s.startSec.toFixed(2)}-${s.endSec.toFixed(2)}]`,
    );
    playhead += dur;
  }

  const listPath = join(tmpDir, "list.txt");
  await writeFile(
    listPath,
    parts.map((p) => `file '${basename(p)}'`).join("\n") + "\n",
    "utf8",
  );

  const outPath = join(OUT_DIR, `${slug}-spine.wav`);
  const concat = await run([
    "-hide_banner", "-loglevel", "error",
    "-f", "concat", "-safe", "0", "-i", listPath,
    "-c", "copy", "-y", outPath,
  ]);
  if (concat.code !== 0) {
    console.error(`concat failed:\n${concat.stderr}`);
    process.exit(1);
  }

  // Measure the rendered result rather than the plan — the whole point is to
  // check the thing that actually plays.
  const probe = await run([
    "-hide_banner", "-i", outPath,
    "-af", `silencedetect=noise=${NOISE_DB}dB:d=${MIN_SILENCE_SEC}`,
    "-f", "null", "-",
  ]);

  const silences = [...probe.stderr.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_duration: ([\d.]+)/g)]
    .map((m) => ({ at: Number(m[1]), forSec: Number(m[2]) }));

  console.log(`\ntotal: ${playhead.toFixed(2)}s  ->  ${outPath}`);
  console.log(`\nsilence at or below ${NOISE_DB}dB lasting ${MIN_SILENCE_SEC}s or more:`);
  if (silences.length === 0) {
    console.log("  none found in the rendered audio.");
  } else {
    for (const s of silences) {
      const moment = timeline.find((t) => s.at >= t.startSec && s.at < t.endSec);
      const where = moment ? `moment ${moment.order + 1} (${moment.fileName})` : "between moments";
      console.log(`  ${s.at.toFixed(2)}s for ${s.forSec.toFixed(2)}s  — ${where}`);
    }
  }

  await rm(tmpDir, { recursive: true, force: true });
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
