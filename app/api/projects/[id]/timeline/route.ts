import { NextResponse } from "next/server";
import { buildCutTimeline } from "@/lib/cut/build";

/**
 * Serves the same CutTimeline the FCP7 export already builds, as JSON, so
 * the UXP panel (Phase 2) can read the approved plan without a file
 * handoff. This is the plan the user already approved at the content-
 * selection checkpoint — this route does not re-run selection, it just
 * reads what buildCutTimeline computes from the stored Selection rows.
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const timeline = await buildCutTimeline(params.id);
    return NextResponse.json(timeline);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const notFound = message.includes("No Project found");
    return NextResponse.json(
      { error: message },
      { status: notFound ? 404 : 500 },
    );
  }
}
