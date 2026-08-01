import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getJobs } from "@/lib/pipeline/jobs";
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
        mediaAssets: {
          select: { id: true, filePath: true, transcript: { select: { id: true } } },
        },
        selections: {
          orderBy: { order: "asc" },
          include: { mediaAsset: true, videoAsset: true },
        },
        checkpoints: { select: { stage: true, approved: true } },
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

    let beatPlan: string[] = [];
    if (project.selectionBeatPlan) {
      try {
        beatPlan = JSON.parse(project.selectionBeatPlan) as string[];
      } catch {
        beatPlan = [];
      }
    }

    type ShortlistEntry = {
      mediaAssetId: string;
      filePath: string;
      startSec: number;
      endSec: number;
      text: string;
      visualSummary?: string | null;
      chosenOrder: number | null;
    };
    let notChosen: {
      fileName: string;
      startSec: number;
      endSec: number;
      text: string | null;
      visualSummary: string | null;
    }[] = [];
    if (project.selectionShortlistJson) {
      try {
        const shortlist = JSON.parse(project.selectionShortlistJson) as ShortlistEntry[];
        notChosen = shortlist
          .filter((c) => c.chosenOrder === null)
          .sort((a, b) => a.filePath.localeCompare(b.filePath) || a.startSec - b.startSec)
          .map((c) => ({
            fileName: fileNameById.get(c.mediaAssetId) ?? c.filePath.split("/").pop() ?? c.filePath,
            startSec: c.startSec,
            endSec: c.endSec,
            text: c.text || null,
            visualSummary: c.visualSummary || null,
          }));
      } catch {
        notChosen = [];
      }
    }

    // Whether a stage is *done* comes from the database; whether it is
    // *running* comes from the in-memory job registry. Keeping those two
    // sources separate is what makes the panel survive a dev-server restart
    // without ever claiming finished work is unfinished.
    const jobs = getJobs(params.id);
    const approvedStages = new Set(
      project.checkpoints.filter((c) => c.approved).map((c) => c.stage),
    );
    const transcriptCount = project.mediaAssets.filter((a) => a.transcript).length;

    const stages = {
      ingest: {
        done: project.mediaAssets.length > 0,
        detail: `${project.mediaAssets.length} file(s)`,
        approved: approvedStages.has("INGEST"),
        job: jobs.ingest,
      },
      transcribe: {
        done: transcriptCount > 0 && transcriptCount === project.mediaAssets.length,
        detail: `${transcriptCount}/${project.mediaAssets.length} transcribed`,
        approved: approvedStages.has("TRANSCRIPTION"),
        job: jobs.transcribe,
      },
      select: {
        done: project.selections.length > 0,
        detail: `${project.selections.length} moment(s)`,
        approved: approvedStages.has("CONTENT_SELECTION"),
        job: jobs.select,
      },
    };

    return NextResponse.json({
      name: project.name,
      outputProfile: project.outputProfile,
      stages,
      premise: project.selectionPremise,
      beatPlan,
      selections: toPanelSelections(liveSelections, fileNameById),
      canRefine: project.selectionShortlistJson !== null,
      notChosen,
      profilePreviews,
      refinementDraft,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Prisma's own not-found message is a multi-line invocation dump. The
    // panel renders whatever it gets, so give it something readable.
    if (message.includes("No record was found for a query")) {
      return NextResponse.json(
        { error: `No project found for id ${params.id}` },
        { status: 404 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
