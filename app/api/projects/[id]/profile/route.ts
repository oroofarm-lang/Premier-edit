import { NextResponse } from "next/server";
import { applyProfilePreview } from "@/lib/selection/run";
import type { OutputProfile } from "@/lib/generated/prisma/enums";

const OUTPUT_PROFILES = ["REEL_SHORT", "SOCIAL_POST", "YOUTUBE_LONG"] as const;

/** Switches the project's active cut to a previously generated profile preview — same effect as the web app's "Use this cut" button. */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const body = await req.json();
    const outputProfile = String(body?.outputProfile ?? "");
    if (!OUTPUT_PROFILES.includes(outputProfile as OutputProfile)) {
      return NextResponse.json(
        { error: `Unknown output profile: ${outputProfile}` },
        { status: 400 },
      );
    }
    await applyProfilePreview(params.id, outputProfile as OutputProfile);
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
