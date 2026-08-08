import { access } from "node:fs/promises";
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

    // Footage can be moved or renamed long after ingest recorded its path.
    // Reporting it here lets the panel refuse to build rather than importing
    // half the sources and leaving a broken sequence behind.
    const paths = [...new Set(timeline.clips.map((c) => c.filePath))];
    const checks = await Promise.all(
      paths.map(async (p) => {
        try {
          await access(p);
          return null;
        } catch {
          return p;
        }
      }),
    );
    const missingSources = checks.filter((p): p is string => p !== null);

    return NextResponse.json({ ...timeline, missingSources });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const notFound = message.includes("No record was found for a query");
    return NextResponse.json(
      { error: message },
      { status: notFound ? 404 : 500 },
    );
  }
}
