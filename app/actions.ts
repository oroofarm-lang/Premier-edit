"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { stat } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { runIngest } from "@/lib/ingest/run";
import { runTranscription } from "@/lib/transcription/run";
import { runContentSelection } from "@/lib/selection/run";
import { runExport } from "@/lib/export/run";
import type { OutputProfile } from "@/lib/generated/prisma/enums";

const OUTPUT_PROFILES = ["REEL_SHORT", "SOCIAL_POST", "YOUTUBE_LONG"] as const;

export type ActionState = { error: string } | null;

async function assertFolderExists(label: string, folder: string) {
  try {
    const info = await stat(folder);
    if (!info.isDirectory()) throw new Error("not a directory");
  } catch {
    throw new Error(`${label} is not a folder that exists on this machine: ${folder}`);
  }
}

export async function createProject(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const outputProfile = String(formData.get("outputProfile") ?? "");
  const brief = String(formData.get("brief") ?? "").trim();
  const footageFolder = String(formData.get("footageFolder") ?? "").trim();
  const audioFolder = String(formData.get("audioFolder") ?? "").trim();

  if (!name) return { error: "Project name is required." };
  if (!footageFolder) return { error: "Footage folder is required." };
  if (!OUTPUT_PROFILES.includes(outputProfile as OutputProfile)) {
    return { error: "Pick an output profile." };
  }

  try {
    await assertFolderExists("Footage folder", footageFolder);
    if (audioFolder) await assertFolderExists("Audio folder", audioFolder);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  const project = await prisma.project.create({
    data: {
      name,
      outputProfile: outputProfile as OutputProfile,
      brief: brief || null,
      footageFolder,
      audioFolder: audioFolder || null,
    },
  });

  redirect(`/projects/${project.id}`);
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
