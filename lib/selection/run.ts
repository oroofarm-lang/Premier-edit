import { prisma } from "@/lib/db";
import { HeuristicContentSelector } from "./heuristic";
import { LlmContentSelector } from "./llm-selector";
import { runVisionAnalysis } from "@/lib/vision/run";
import { getAssetSegments } from "./segments";
import {
  ALL_OUTPUT_PROFILES,
  PROFILE_TARGET_SECONDS,
  type CandidateSegment,
  type ContentSelector,
  type SelectionResult,
} from "./types";
import type { OutputProfile } from "@/lib/generated/prisma/enums";
import type { Project } from "@/lib/generated/prisma/client";

export type SelectionSummary = {
  selector: string;
  candidates: number;
  selected: number;
  totalDurationSec: number;
};

/** One profile's full selection result, as stored in `Project.multiProfilePreviewsJson`. */
export type ProfilePreview = SelectionResult & {
  outputProfile: OutputProfile;
  totalDurationSec: number;
};

function resolveDefaultSelector(): ContentSelector {
  // Auto-upgrades once ANTHROPIC_API_KEY exists — same button, no new UI.
  // See CLAUDE.md, "Budget / LLM sizing".
  return process.env.ANTHROPIC_API_KEY
    ? new LlmContentSelector()
    : new HeuristicContentSelector();
}

/**
 * Runs vision analysis (best-effort) and builds the candidate list — the
 * part of the pipeline that's the same regardless of which output profile
 * ends up being selected for. Shared by a single-profile run and the
 * generate-all-profiles run, so the (slow) vision pass only happens once
 * either way.
 */
async function buildCandidates(
  projectId: string,
): Promise<{ project: Project; candidates: CandidateSegment[] }> {
  // Visual analysis is an input to selection, not a separate approval step —
  // the user approves the resulting picks, not "does this clip show tea
  // being poured." Best-effort: a failed/missing vision pass still leaves
  // transcript-based candidates usable.
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      await runVisionAnalysis(projectId);
    } catch {
      // Selection proceeds on transcript-only candidates for whatever
      // couldn't be visually analyzed.
    }
  }

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: {
      mediaAssets: { include: { transcript: true, visualAnalyses: true } },
    },
  });

  const candidates: CandidateSegment[] = [];
  for (const asset of project.mediaAssets) {
    for (const segment of getAssetSegments(asset)) {
      // Exact-range match: vision analysis is keyed on the very same segment
      // boundaries this function computes, so different moments in one long
      // clip carry their own description instead of sharing a file-level one
      // (see CLAUDE.md task #45).
      const visual = asset.visualAnalyses.find(
        (v) => v.startSec === segment.startSec && v.endSec === segment.endSec,
      );
      const visualSummary = visual?.summary ?? null;
      const visualTags = visual ? (JSON.parse(visual.tagsJson) as string[]) : [];
      const visualShotType = visual?.shotType ?? null;

      if (segment.text === "") {
        // No speech at all (silent B-roll, or nothing Whisper could
        // transcribe) — without visual proof this segment is worth nothing
        // to a selector, so only add it once vision analysis has run.
        if (!visual) continue;
      }

      candidates.push({
        mediaAssetId: asset.id,
        filePath: asset.filePath,
        startSec: segment.startSec,
        endSec: segment.endSec,
        text: segment.text,
        visualSummary,
        visualTags,
        visualShotType,
      });
    }
  }

  return { project, candidates };
}

function totalDurationOf(result: SelectionResult): number {
  return (
    Math.round(
      result.selections.reduce((sum, s) => sum + (s.endSec - s.startSec), 0) * 10,
    ) / 10
  );
}

/**
 * Persists a selection result as the project's active cut — replaces
 * `Selection` wholesale (it's a re-runnable decision, not an accumulating
 * log) and snapshots the selector's own reasoning onto `Project`, same as
 * before. Shared by a direct single-profile run, by applying one of several
 * generated previews, and by applying a conversational refinement draft.
 */
export async function persistSelection(
  projectId: string,
  outputProfile: OutputProfile,
  result: SelectionResult,
): Promise<void> {
  const { selections: selected, premise, beatPlan, shortlist } = result;

  // Tag each shortlist entry with whether (and where) it ended up in the
  // final cut, so the UI can show "considered but not used" alongside
  // "picked" without a second lookup.
  const shortlistWithStatus = shortlist?.map((c) => {
    const match = selected.find(
      (s) =>
        s.mediaAssetId === c.mediaAssetId &&
        s.startSec === c.startSec &&
        s.endSec === c.endSec,
    );
    return { ...c, chosenOrder: match?.order ?? null };
  });

  await prisma.$transaction([
    prisma.selection.deleteMany({ where: { projectId } }),
    prisma.selection.createMany({
      data: selected.map((s) => ({
        projectId,
        mediaAssetId: s.mediaAssetId,
        startSec: s.startSec,
        endSec: s.endSec,
        order: s.order,
        score: s.score,
        reason: s.reason,
        videoAssetId: s.videoOverride?.mediaAssetId ?? null,
        videoStartSec: s.videoOverride?.startSec ?? null,
        videoEndSec: s.videoOverride?.endSec ?? null,
      })),
    }),
    prisma.project.update({
      where: { id: projectId },
      data: {
        outputProfile,
        selectionPremise: premise || null,
        selectionBeatPlan: beatPlan ? JSON.stringify(beatPlan) : null,
        selectionShortlistJson: shortlistWithStatus
          ? JSON.stringify(shortlistWithStatus)
          : null,
        // Any pending refinement was refining the cut we just replaced.
        refinementDraftJson: null,
      },
    }),
  ]);

  const existing = await prisma.approvalCheckpoint.findFirst({
    where: { projectId, stage: "CONTENT_SELECTION" },
  });
  if (!existing) {
    await prisma.approvalCheckpoint.create({
      data: { projectId, stage: "CONTENT_SELECTION" },
    });
  } else if (existing.approved) {
    // The cut the user approved no longer exists. Leaving the checkpoint
    // approved would unlock export against a cut nobody signed off on —
    // which the three-checkpoint design exists specifically to prevent.
    await prisma.approvalCheckpoint.update({
      where: { id: existing.id },
      data: { approved: false, approvedAt: null },
    });
  }
}

export async function runContentSelection(
  projectId: string,
  selector: ContentSelector = resolveDefaultSelector(),
): Promise<SelectionSummary> {
  const { project, candidates } = await buildCandidates(projectId);

  const result = await selector.select({
    brief: project.brief,
    outputProfile: project.outputProfile,
    targetDurationSec: PROFILE_TARGET_SECONDS[project.outputProfile],
    candidates,
  });

  await persistSelection(projectId, project.outputProfile, result);

  return {
    selector: selector.name,
    candidates: candidates.length,
    selected: result.selections.length,
    totalDurationSec: totalDurationOf(result),
  };
}

/**
 * Generates a candidate cut for all three output profiles from one pipeline
 * run — the vision-analysis pass and candidate list are computed once and
 * shared, so this doesn't cost 3x what a single profile costs (only the
 * selector's own call runs per-profile, since editorial choices genuinely
 * differ by target length). Stores all three as a preview on the project;
 * none of them become the active `Selection` until `applyProfilePreview`
 * picks one. See docs/superpowers/specs/2026-07-31-chatvideopro-competitive-roadmap.md, task #49.
 */
export async function runContentSelectionAllProfiles(
  projectId: string,
  selector: ContentSelector = resolveDefaultSelector(),
): Promise<ProfilePreview[]> {
  const { project, candidates } = await buildCandidates(projectId);

  const previews = await Promise.all(
    ALL_OUTPUT_PROFILES.map(async (outputProfile): Promise<ProfilePreview> => {
      const result = await selector.select({
        brief: project.brief,
        outputProfile,
        targetDurationSec: PROFILE_TARGET_SECONDS[outputProfile],
        candidates,
      });
      return { ...result, outputProfile, totalDurationSec: totalDurationOf(result) };
    }),
  );

  await prisma.project.update({
    where: { id: projectId },
    data: { multiProfilePreviewsJson: JSON.stringify(previews) },
  });

  return previews;
}

/**
 * Makes a previously generated profile preview the project's active cut —
 * same persistence path a direct single-profile run uses, plus switching
 * `Project.outputProfile` so downstream cut/export/panel steps (which all
 * key off the project's one active profile) pick it up automatically.
 */
export async function applyProfilePreview(
  projectId: string,
  outputProfile: OutputProfile,
): Promise<void> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (!project.multiProfilePreviewsJson) {
    throw new Error(
      "No multi-profile previews to apply — generate them first.",
    );
  }
  const previews = JSON.parse(project.multiProfilePreviewsJson) as ProfilePreview[];
  const chosen = previews.find((p) => p.outputProfile === outputProfile);
  if (!chosen) {
    throw new Error(`No preview found for profile ${outputProfile}.`);
  }
  await persistSelection(projectId, outputProfile, chosen);
}
