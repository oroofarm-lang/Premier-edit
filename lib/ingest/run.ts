import { prisma } from "@/lib/db";
import { scanMediaFolder } from "./scan";
import { probeMediaFile } from "./probe";

export type IngestSummary = {
  scanned: number;
  registered: number;
  skipped: number;
  failed: { filePath: string; error: string }[];
};

export async function runIngest(projectId: string): Promise<IngestSummary> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
  });

  const folders = [project.footageFolder];
  if (project.audioFolder) folders.push(project.audioFolder);

  const scanned = (await Promise.all(folders.map(scanMediaFolder))).flat();

  const existing = await prisma.mediaAsset.findMany({
    where: { projectId },
    select: { filePath: true },
  });
  const alreadyIngested = new Set(existing.map((a) => a.filePath));

  const summary: IngestSummary = {
    scanned: scanned.length,
    registered: 0,
    skipped: 0,
    failed: [],
  };

  for (const file of scanned) {
    if (alreadyIngested.has(file.filePath)) {
      summary.skipped += 1;
      continue;
    }

    try {
      const metadata = await probeMediaFile(file.filePath);
      await prisma.mediaAsset.create({
        data: { projectId, kind: file.kind, filePath: file.filePath, ...metadata },
      });
      summary.registered += 1;
    } catch (error) {
      // One unreadable file shouldn't abort the whole card — collect and report.
      summary.failed.push({
        filePath: file.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const existingCheckpoint = await prisma.approvalCheckpoint.findFirst({
    where: { projectId, stage: "INGEST" },
  });
  if (!existingCheckpoint) {
    await prisma.approvalCheckpoint.create({
      data: { projectId, stage: "INGEST" },
    });
  }

  return summary;
}
