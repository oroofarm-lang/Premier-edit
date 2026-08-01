import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { PipelineStage } from "@/lib/generated/prisma/enums";

/** The three checkpoints that actually gate the MVP pipeline. The schema's
 * PipelineStage enum has more members, but only these are ever created. */
const APPROVABLE = ["INGEST", "TRANSCRIPTION", "CONTENT_SELECTION"] as const;

/**
 * Approves a checkpoint by stage rather than by checkpoint id — the panel
 * knows which stage it is looking at, not the row's cuid.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const body = await req.json();
    const stage = String(body?.stage ?? "");
    if (!APPROVABLE.includes(stage as (typeof APPROVABLE)[number])) {
      return NextResponse.json(
        { error: `Not an approvable stage: ${stage}` },
        { status: 400 },
      );
    }

    const checkpoint = await prisma.approvalCheckpoint.findFirst({
      where: { projectId: params.id, stage: stage as PipelineStage },
    });
    if (!checkpoint) {
      return NextResponse.json(
        { error: `No ${stage} checkpoint exists yet for this project` },
        { status: 404 },
      );
    }

    await prisma.approvalCheckpoint.update({
      where: { id: checkpoint.id },
      data: { approved: true, approvedAt: new Date() },
    });
    return NextResponse.json({ ok: true, stage });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
