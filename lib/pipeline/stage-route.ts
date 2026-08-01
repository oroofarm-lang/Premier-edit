import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { startJob, type StageName } from "./jobs";

/**
 * Shared body of the three stage-start routes. Each of them differs only in
 * which runner it hands over, so the 404 check and the 202 contract live here
 * once rather than three times.
 */
export async function startStageRoute(
  projectId: string,
  stage: StageName,
  work: () => Promise<unknown>,
) {
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json(
        { error: `No project found for id ${projectId}` },
        { status: 404 },
      );
    }

    const outcome = startJob(projectId, stage, work);
    // 202: accepted and running. The caller polls the state route for the
    // result — it never blocks on the five minutes transcription can take.
    return NextResponse.json({ ok: true, stage, outcome }, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
