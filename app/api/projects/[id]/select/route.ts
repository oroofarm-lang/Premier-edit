import { runContentSelection } from "@/lib/selection/run";
import { startStageRoute } from "@/lib/pipeline/stage-route";

/** Starts content selection for the project's current output profile.
 * Vision analysis runs inside this when ANTHROPIC_API_KEY is set. */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  return startStageRoute(params.id, "select", () =>
    runContentSelection(params.id),
  );
}
