import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ProjectInputError, createProjectRecord } from "@/lib/projects/create";

/**
 * Project list for the UXP panel's home screen. Runs on the same local
 * Next.js server the rest of the app already uses — no new auth model, since
 * this machine is the only client that can reach it.
 *
 * Counts come back with each project so the home screen can show how far
 * along each one is without a request per card.
 */
export async function GET() {
  const rows = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      outputProfile: true,
      createdAt: true,
      _count: { select: { mediaAssets: true, selections: true } },
    },
  });

  const transcribedByProject = await prisma.mediaAsset.groupBy({
    by: ["projectId"],
    where: { transcript: { isNot: null } },
    _count: { _all: true },
  });
  const transcriptCountByProject = new Map(
    transcribedByProject.map((row) => [row.projectId, row._count._all]),
  );

  const projects = rows.map((row) => ({
    id: row.id,
    name: row.name,
    outputProfile: row.outputProfile,
    createdAt: row.createdAt.toISOString(),
    assetCount: row._count.mediaAssets,
    transcriptCount: transcriptCountByProject.get(row.id) ?? 0,
    momentCount: row._count.selections,
  }));

  return NextResponse.json({ projects });
}

/** Creates a project from the panel. Shares its validation with the web
 * form's server action via lib/projects/create.ts. */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const project = await createProjectRecord({
      name: String(body?.name ?? ""),
      outputProfile: String(body?.outputProfile ?? ""),
      brief: body?.brief == null ? null : String(body.brief),
      footageFolder: String(body?.footageFolder ?? ""),
      audioFolder: body?.audioFolder == null ? null : String(body.audioFolder),
    });
    return NextResponse.json(
      { ok: true, project: { id: project.id, name: project.name } },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof ProjectInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
