import { runIngest } from "@/lib/ingest/run";
import { startStageRoute } from "@/lib/pipeline/stage-route";

/** Starts the ingest stage in the background. Returns 202 immediately. */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  return startStageRoute(params.id, "ingest", () => runIngest(params.id));
}
