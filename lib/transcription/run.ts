import { prisma } from "@/lib/db";
import { LocalWhisperTranscriber } from "./local-whisper";
import type { Transcriber } from "./types";

export type TranscriptionSummary = {
  transcribed: number;
  skipped: number;
  failed: { filePath: string; error: string }[];
};

// Guards against a duplicate concurrent run for the same project — e.g. a
// double-fire on the button before React re-renders it disabled. Without
// this, two batches spawn against the same files and can both try to insert
// the same (unique) Transcript row, and the second insert throwing aborts
// that whole batch's remaining saves.
const inFlight = new Set<string>();

/**
 * Transcribes every asset in the project that has speech worth reading.
 * Assets already transcribed are left alone so a re-run is cheap — Whisper on
 * a long clip is minutes, not seconds.
 */
export async function runTranscription(
  projectId: string,
  transcriber: Transcriber = new LocalWhisperTranscriber(),
): Promise<TranscriptionSummary> {
  if (inFlight.has(projectId)) {
    return { transcribed: 0, skipped: 0, failed: [] };
  }
  inFlight.add(projectId);
  try {
    return await runTranscriptionInner(projectId, transcriber);
  } finally {
    inFlight.delete(projectId);
  }
}

async function runTranscriptionInner(
  projectId: string,
  transcriber: Transcriber,
): Promise<TranscriptionSummary> {
  const assets = await prisma.mediaAsset.findMany({
    where: { projectId, transcript: null },
    orderBy: { filePath: "asc" },
  });

  const summary: TranscriptionSummary = {
    transcribed: 0,
    skipped: 0,
    failed: [],
  };

  const pending = assets.filter((asset) => {
    // A silent B-roll clip has no audio stream at all; nothing to transcribe.
    if (asset.kind === "VIDEO" && asset.sampleRate === null) {
      summary.skipped += 1;
      return false;
    }
    return true;
  });

  async function saveTranscript(mediaAssetId: string, result: {
    language: string;
    engine: string;
    text: string;
    segments: unknown;
  }) {
    await prisma.transcript.create({
      data: {
        mediaAssetId,
        language: result.language,
        engine: result.engine,
        text: result.text,
        segmentsJson: JSON.stringify(result.segments),
      },
    });
  }

  if (transcriber.transcribeMany) {
    const outcomes = await transcriber.transcribeMany(
      pending.map((a) => a.filePath),
      { language: "he" },
    );
    const byPath = new Map(pending.map((a) => [a.filePath, a]));
    for (const outcome of outcomes) {
      const asset = byPath.get(outcome.filePath);
      if (!asset) continue;
      if (!outcome.ok) {
        summary.failed.push({ filePath: outcome.filePath, error: outcome.error });
        continue;
      }
      try {
        await saveTranscript(asset.id, outcome.result);
        summary.transcribed += 1;
      } catch (error) {
        summary.failed.push({
          filePath: outcome.filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } else {
    for (const asset of pending) {
      try {
        const result = await transcriber.transcribe(asset.filePath, {
          language: "he",
        });
        await saveTranscript(asset.id, result);
        summary.transcribed += 1;
      } catch (error) {
        summary.failed.push({
          filePath: asset.filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const existing = await prisma.approvalCheckpoint.findFirst({
    where: { projectId, stage: "TRANSCRIPTION" },
  });
  if (!existing) {
    await prisma.approvalCheckpoint.create({
      data: { projectId, stage: "TRANSCRIPTION" },
    });
  }

  return summary;
}
