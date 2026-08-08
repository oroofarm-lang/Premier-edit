"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  OUTPUT_PROFILES,
  ProjectInputError,
  createProjectRecord,
} from "@/lib/projects/create";
import { runIngest } from "@/lib/ingest/run";
import { runTranscription } from "@/lib/transcription/run";
import {
  applyProfilePreview,
  runContentSelection,
  runContentSelectionAllProfiles,
} from "@/lib/selection/run";
import {
  applyRefinementDraft,
  discardRefinementDraft,
  refineSelection,
} from "@/lib/selection/refine";
import { runExport } from "@/lib/export/run";
import type { OutputProfile } from "@/lib/generated/prisma/enums";

export type ActionState = { error: string } | null;

export async function createProject(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let projectId: string;
  try {
    const project = await createProjectRecord({
      name: String(formData.get("name") ?? ""),
      outputProfile: String(formData.get("outputProfile") ?? ""),
      brief: String(formData.get("brief") ?? ""),
      footageFolder: String(formData.get("footageFolder") ?? ""),
      audioFolder: String(formData.get("audioFolder") ?? ""),
    });
    projectId = project.id;
  } catch (error) {
    if (error instanceof ProjectInputError) return { error: error.message };
    throw error;
  }

  // Outside the try: redirect() signals by throwing, so catching around it
  // would swallow the navigation.
  redirect(`/projects/${projectId}`);
}

export async function ingestProject(projectId: string): Promise<void> {
  await runIngest(projectId);
  revalidatePath(`/projects/${projectId}`);
}

export async function transcribeProject(projectId: string): Promise<void> {
  await runTranscription(projectId);
  revalidatePath(`/projects/${projectId}`);
}

export async function selectContent(projectId: string): Promise<void> {
  await runContentSelection(projectId);
  revalidatePath(`/projects/${projectId}`);
}

export async function selectContentAllProfiles(projectId: string): Promise<void> {
  await runContentSelectionAllProfiles(projectId);
  revalidatePath(`/projects/${projectId}`);
}

export async function applyProfileSelection(
  projectId: string,
  outputProfile: string,
): Promise<void> {
  if (!OUTPUT_PROFILES.includes(outputProfile as OutputProfile)) {
    throw new Error(`Unknown output profile: ${outputProfile}`);
  }
  await applyProfilePreview(projectId, outputProfile as OutputProfile);
  revalidatePath(`/projects/${projectId}`);
}

export async function refineSelectionAction(
  projectId: string,
  instruction: string,
): Promise<void> {
  const trimmed = instruction.trim();
  if (!trimmed) return;
  await refineSelection(projectId, trimmed);
  revalidatePath(`/projects/${projectId}`);
}

export async function applyRefinementAction(projectId: string): Promise<void> {
  await applyRefinementDraft(projectId);
  revalidatePath(`/projects/${projectId}`);
}

export async function discardRefinementAction(projectId: string): Promise<void> {
  await discardRefinementDraft(projectId);
  revalidatePath(`/projects/${projectId}`);
}

export async function exportTimeline(projectId: string): Promise<void> {
  await runExport(projectId);
  revalidatePath(`/projects/${projectId}`);
}

export async function approveCheckpoint(checkpointId: string, projectId: string) {
  await prisma.approvalCheckpoint.update({
    where: { id: checkpointId },
    data: { approved: true, approvedAt: new Date() },
  });
  revalidatePath(`/projects/${projectId}`);
}
