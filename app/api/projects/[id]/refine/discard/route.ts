import { NextResponse } from "next/server";
import { discardRefinementDraft } from "@/lib/selection/refine";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    await discardRefinementDraft(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const notFound = message.includes("No record was found for a query");
    return NextResponse.json(
      { error: message },
      { status: notFound ? 404 : 500 },
    );
  }
}
