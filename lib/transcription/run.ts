import { prisma } from "@/lib/db";
import { LocalWhisperTranscriber } from "./local-whisper";
import type { Transcriber } from "./types";

export type TranscriptionSummary = {
  transcribed: number;
  skipped: number;
  failed: { filePath: string; error: string }[];
};

/**
 * Transcribes every asset in the project that has speech worth reading.
 * Assets already transcribed are left alone so a re-run is cheap — Whisper on
 * a long clip is minutes, not seconds.
 */
export async function runTranscription(
  projectId: string,
  transcriber: Transcriber = new LocalWhisperTranscriber(),
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

  for (const asset of assets) {
    // A silent B-roll clip has no audio stream at all; nothing to transcribe.
    if (asset.kind === "VIDEO" && asset.sampleRate === null) {
      summary.skipped += 1;
      continue;
    }

    try {
      const result = await transcriber.transcribe(asset.filePath, {
        language: "he",
      });

      await prisma.transcript.create({
        data: {
          mediaAssetId: asset.id,
          language: result.language,
          engine: result.engine,
          text: result.text,
          segmentsJson: JSON.stringify(result.segments),
        },
      });
      summary.transcribed += 1;
    } catch (error) {
      summary.failed.push({
        filePath: asset.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
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
