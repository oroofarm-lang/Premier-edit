import { NextResponse } from "next/server";
import { refineSelection } from "@/lib/selection/refine";

/** Sends one conversational-refinement instruction; the caller re-fetches /state for the result rather than this route echoing it back. */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const body = await req.json();
    const instruction = String(body?.instruction ?? "").trim();
    if (!instruction) {
      return NextResponse.json({ error: "instruction is required" }, { status: 400 });
    }
    await refineSelection(params.id, instruction);
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
