import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { diffSelections } from "@/lib/selection/refine-plan";
import type { RefinementDraft } from "@/lib/selection/refine-plan";
import type { SelectedSegment } from "@/lib/selection/types";

/**
 * Consolidated read for the UXP panel: the currently active cut, whatever
 * generated profile previews exist, and a pending refinement draft (with its
 * diff against the live cut precomputed here) if there is one. The panel
 * fetches this once per project pick and after every mutating action rather
 * than juggling several endpoints or reimplementing diffSelections in
 * vanilla JS.
 */

type PanelSelection = {
  fileName: string;
  startSec: number;
  endSec: number;
  reason: string | null;
  videoFileName: string | null;
};

function toPanelSelections(
  selections: SelectedSegment[],
  fileNameById: Map<string, string>,
): PanelSelection[] {
  return selections.map((s) => ({
    fileName: fileNameById.get(s.mediaAssetId) ?? s.mediaAssetId,
    startSec: s.startSec,
    endSec: s.endSec,
    reason: s.reason || null,
    videoFileName: s.videoOverride
      ? (fileNameById.get(s.videoOverride.mediaAssetId) ?? s.videoOverride.mediaAssetId)
      : null,
  }));
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: params.id },
      include: {
        mediaAssets: { select: { id: true, filePath: true } },
        selections: {
          orderBy: { order: "asc" },
          include: { mediaAsset: true, videoAsset: true },
        },
      },
    });

    const fileNameById = new Map(
      project.mediaAssets.map((a) => [a.id, a.filePath.split("/").pop() ?? a.filePath]),
    );

    const liveSelections: SelectedSegment[] = project.selections.map((s) => ({
      mediaAssetId: s.mediaAssetId,
      startSec: s.startSec,
      endSec: s.endSec,
      order: s.order,
      score: s.score ?? 0,
      reason: s.reason ?? "",
      ...(s.videoAssetId && s.videoStartSec !== null && s.videoEndSec !== null
        ? {
            videoOverride: {
              mediaAssetId: s.videoAssetId,
              startSec: s.videoStartSec,
              endSec: s.videoEndSec,
            },
          }
        : {}),
    }));

    let profilePreviews: {
      outputProfile: string;
      momentCount: number;
      totalDurationSec: number;
      premise: string | null;
    }[] = [];
    if (project.multiProfilePreviewsJson) {
      try {
        const previews = JSON.parse(project.multiProfilePreviewsJson) as {
          outputProfile: string;
          selections: unknown[];
          totalDurationSec: number;
          premise?: string;
        }[];
        profilePreviews = previews.map((p) => ({
          outputProfile: p.outputProfile,
          momentCount: p.selections.length,
          totalDurationSec: p.totalDurationSec,
          premise: p.premise ?? null,
        }));
      } catch {
        profilePreviews = [];
      }
    }

    let refinementDraft: {
      turns: RefinementDraft["turns"];
      selections: PanelSelection[];
      premise: string | null;
      totalDurationSec: number;
      diff: { status: string; fileName: string; startSec: number; endSec: number }[];
    } | null = null;
    if (project.refinementDraftJson) {
      try {
        const draft = JSON.parse(project.refinementDraftJson) as RefinementDraft;
        const diff = diffSelections(liveSelections, draft.result.selections);
        refinementDraft = {
          turns: draft.turns,
          selections: toPanelSelections(draft.result.selections, fileNameById),
          premise: draft.result.premise ?? null,
          totalDurationSec:
            Math.round(
              draft.result.selections.reduce((sum, s) => sum + (s.endSec - s.startSec), 0) * 10,
            ) / 10,
          diff: diff.map((d) => ({
            status: d.status,
            fileName: fileNameById.get(d.mediaAssetId) ?? d.mediaAssetId,
            startSec: d.startSec,
            endSec: d.endSec,
          })),
        };
      } catch {
        refinementDraft = null;
      }
    }

    return NextResponse.json({
      outputProfile: project.outputProfile,
      premise: project.selectionPremise,
      selections: toPanelSelections(liveSelections, fileNameById),
      canRefine: project.selectionShortlistJson !== null,
      profilePreviews,
      refinementDraft,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const notFound = message.includes("No record was found for a query");
    return NextResponse.json(
      { error: message },
      { status: notFound ? 404 : 500 },
    );
  }
}
