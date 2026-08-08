import { NextResponse } from "next/server";
import { runContentSelectionAllProfiles } from "@/lib/selection/run";

/**
 * Runs a fresh selection for all three output profiles (a real multi-call
 * LLM batch — one vision pass shared across profiles, then one selector
 * call per profile) and stores the results as previews. Purely additive:
 * only writes `multiProfilePreviewsJson`, does not touch the active
 * selection or any approval checkpoint. Same effect as the web app's
 * "Generate all 3 profiles" button.
 */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const previews = await runContentSelectionAllProfiles(params.id);
    return NextResponse.json({ ok: true, count: previews.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const notFound = message.includes("No record was found for a query");
    return NextResponse.json(
      { error: message },
      { status: notFound ? 404 : 500 },
    );
  }
}
