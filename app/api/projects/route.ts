import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Read-only project list for the UXP panel (Phase 2) to pick from. Runs on
 * the same local Next.js server the rest of the app already uses — no new
 * auth model, since this machine is the only client that can reach it.
 */
export async function GET() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });
  return NextResponse.json({ projects });
}
