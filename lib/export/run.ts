import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { buildCutTimeline } from "@/lib/cut/build";
import { buildFcp7Xml } from "./fcp7";

export type ExportSummary = {
  filePath: string;
  clips: number;
  durationSec: number;
  fps: number;
};

/** Exports live next to the project data so the user can find them predictably. */
const EXPORT_DIR = path.join(process.cwd(), "exports");

function slugify(name: string): string {
  // Project names are often Hebrew, which would make an unusable filename;
  // keep letters and digits from any script and collapse the rest.
  const cleaned = name
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "timeline";
}

export async function runExport(projectId: string): Promise<ExportSummary> {
  const timeline = await buildCutTimeline(projectId);
  const xml = buildFcp7Xml(timeline);

  await mkdir(EXPORT_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filePath = path.join(
    EXPORT_DIR,
    `${slugify(timeline.name)}-${stamp}.xml`,
  );
  await writeFile(filePath, xml, "utf8");

  const record = await prisma.timeline.create({
    data: { projectId, format: "fcp7-xml", filePath },
  });

  // Version numbers are per project, so a re-export reads as v2 rather than
  // silently overwriting the history of what was handed to Premiere.
  const previous = await prisma.editVersion.count({ where: { projectId } });
  await prisma.editVersion.create({
    data: {
      projectId,
      timelineId: record.id,
      versionNum: previous + 1,
      note: `${timeline.clips.length} clips, ${timeline.durationSec}s`,
    },
  });

  return {
    filePath,
    clips: timeline.clips.length,
    durationSec: timeline.durationSec,
    fps: timeline.fps,
  };
}
