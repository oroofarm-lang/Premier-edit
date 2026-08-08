import { basename } from "node:path";
import type { TranscriptSegment } from "@/lib/transcription/types";
import type { ScriptSource, TimedWord } from "./types";

/**
 * Turns stored transcripts into the flat word list the script layer works in.
 *
 * Pure — the caller does the Prisma query and hands the rows in, so both the
 * brief writer and the validator-facing apply script share one definition of
 * "the words of this clip" without either importing the database.
 *
 * Segments whose engine gave no word timings are skipped rather than
 * approximated. A script line is only as trustworthy as the timings behind it,
 * and the whole point of the validator is that it can prove a line is real.
 */
export type TranscribedAsset = {
  id: string;
  filePath: string;
  segmentsJson: string | null;
};

export function parseSegments(segmentsJson: string | null): TranscriptSegment[] {
  if (!segmentsJson) return [];
  try {
    const parsed = JSON.parse(segmentsJson) as TranscriptSegment[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function toScriptSources(assets: TranscribedAsset[]): ScriptSource[] {
  const sources: ScriptSource[] = [];

  for (const asset of assets) {
    const words: TimedWord[] = [];
    for (const segment of parseSegments(asset.segmentsJson)) {
      for (const word of segment.words ?? []) {
        if (typeof word.startSec !== "number" || typeof word.endSec !== "number") continue;
        words.push({ word: word.word, startSec: word.startSec, endSec: word.endSec });
      }
    }
    if (words.length === 0) continue;
    words.sort((a, b) => a.startSec - b.startSec);
    sources.push({ mediaAssetId: asset.id, fileName: basename(asset.filePath), words });
  }

  return sources;
}
