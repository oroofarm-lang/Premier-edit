import { stat } from "node:fs/promises";
import { prisma } from "@/lib/db";
import type { OutputProfile } from "@/lib/generated/prisma/enums";

export const OUTPUT_PROFILES = ["REEL_SHORT", "SOCIAL_POST", "YOUTUBE_LONG"] as const;

/** Distinguishes "the user typed something wrong" (400 / inline form error)
 * from an unexpected failure (500), which the panel and the web form report
 * very differently. */
export class ProjectInputError extends Error {}

export type CreateProjectInput = {
  name: string;
  outputProfile: string;
  brief?: string | null;
  footageFolder: string;
  audioFolder?: string | null;
};

async function assertFolderExists(label: string, folder: string) {
  try {
    const info = await stat(folder);
    if (!info.isDirectory()) throw new Error("not a directory");
  } catch {
    throw new ProjectInputError(
      `${label} is not a folder that exists on this machine: ${folder}`,
    );
  }
}

export async function createProjectRecord(input: CreateProjectInput) {
  const name = input.name.trim();
  const footageFolder = input.footageFolder.trim();
  const audioFolder = (input.audioFolder ?? "").trim();
  const brief = (input.brief ?? "").trim();

  if (!name) throw new ProjectInputError("Project name is required.");
  if (!footageFolder) throw new ProjectInputError("Footage folder is required.");
  if (!OUTPUT_PROFILES.includes(input.outputProfile as OutputProfile)) {
    throw new ProjectInputError("Pick an output profile.");
  }

  await assertFolderExists("Footage folder", footageFolder);
  if (audioFolder) await assertFolderExists("Audio folder", audioFolder);

  return prisma.project.create({
    data: {
      name,
      outputProfile: input.outputProfile as OutputProfile,
      brief: brief || null,
      footageFolder,
      audioFolder: audioFolder || null,
    },
  });
}
