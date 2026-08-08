import { NextResponse } from "next/server";
import { runVideoLayout } from "@/lib/video/run";

/**
 * Builds the picture layer over the approved audio spine. Runs a vision pass
 * on the best catalogued shots and one layout call, so it takes minutes —
 * the panel shows a warning before triggering it.
 */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const summary = await runVideoLayout(params.id);
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const notFound = message.includes("No record was found for a query");
    return NextResponse.json(
      { error: message },
      { status: notFound ? 404 : 500 },
    );
  }
}
