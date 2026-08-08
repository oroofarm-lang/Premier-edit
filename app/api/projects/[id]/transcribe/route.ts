import { runTranscription } from "@/lib/transcription/run";
import { startStageRoute } from "@/lib/pipeline/stage-route";

/** Starts transcription in the background — this one genuinely takes minutes. */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  return startStageRoute(params.id, "transcribe", () =>
    runTranscription(params.id),
  );
}
