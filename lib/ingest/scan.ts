import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export const VIDEO_EXTENSIONS = [
  ".mp4",
  ".mov",
  ".m4v",
  ".mxf",
  ".avi",
  ".mkv",
  ".mts",
  ".m2ts",
  ".braw",
  ".r3d",
];

export const AUDIO_EXTENSIONS = [
  ".wav",
  ".aif",
  ".aiff",
  ".mp3",
  ".m4a",
  ".flac",
  ".aac",
  ".caf",
];

export type ScannedFile = {
  filePath: string;
  kind: "VIDEO" | "AUDIO";
};

function classify(filePath: string): ScannedFile["kind"] | null {
  const ext = path.extname(filePath).toLowerCase();
  if (VIDEO_EXTENSIONS.includes(ext)) return "VIDEO";
  if (AUDIO_EXTENSIONS.includes(ext)) return "AUDIO";
  return null;
}

// Camera cards nest media several levels deep (e.g. DCIM/100CANON, PRIVATE/M4ROOT),
// so scanning has to recurse rather than just read the top level.
async function walk(dir: string, acc: ScannedFile[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await walk(fullPath, acc);
      continue;
    }

    const kind = classify(fullPath);
    if (kind) acc.push({ filePath: fullPath, kind });
  }
}

export async function scanMediaFolder(folder: string): Promise<ScannedFile[]> {
  const info = await stat(folder);
  if (!info.isDirectory()) {
    throw new Error(`Not a folder: ${folder}`);
  }

  const found: ScannedFile[] = [];
  await walk(folder, found);
  return found.sort((a, b) => a.filePath.localeCompare(b.filePath));
}
