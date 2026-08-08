/**
 * Tracks which pipeline stages are running right now.
 *
 * Deliberately in-memory and deliberately narrow: it answers only "is this
 * stage currently running, and did the last attempt fail". Whether a stage is
 * *finished* is always derived from the database instead (are there assets?
 * transcripts? selections?), because that survives a dev-server restart and
 * this map does not. Splitting the question that way means a restart can
 * never leave the panel reporting that completed work is unfinished.
 *
 * Same reasoning as the in-flight Set already guarding runTranscription
 * against double-invocation — a stage runner started twice against one
 * project is a real race, not a theoretical one.
 */

export const STAGE_NAMES = ["ingest", "transcribe", "select"] as const;
export type StageName = (typeof STAGE_NAMES)[number];

export type JobState =
  | { status: "running"; startedAt: string }
  | { status: "error"; message: string; failedAt: string };

const jobs = new Map<string, JobState>();

const key = (projectId: string, stage: StageName) => `${projectId}:${stage}`;

export type StartOutcome = "started" | "already-running";

/**
 * Kicks off `work` in the background and returns immediately. The caller
 * responds 202; the panel learns the result by polling the state route.
 */
export function startJob(
  projectId: string,
  stage: StageName,
  work: () => Promise<unknown>,
): StartOutcome {
  const id = key(projectId, stage);
  if (jobs.get(id)?.status === "running") return "already-running";

  jobs.set(id, { status: "running", startedAt: new Date().toISOString() });

  // Detached on purpose. Nothing awaits this promise, so it must not be able
  // to reject — an unhandled rejection would take down the dev server.
  void work()
    .then(() => {
      jobs.delete(id);
    })
    .catch((err: unknown) => {
      jobs.set(id, {
        status: "error",
        message: err instanceof Error ? err.message : String(err),
        failedAt: new Date().toISOString(),
      });
    });

  return "started";
}

export function getJobs(projectId: string): Record<StageName, JobState | null> {
  return {
    ingest: jobs.get(key(projectId, "ingest")) ?? null,
    transcribe: jobs.get(key(projectId, "transcribe")) ?? null,
    select: jobs.get(key(projectId, "select")) ?? null,
  };
}

export function anyRunning(projectId: string): boolean {
  return STAGE_NAMES.some(
    (stage) => jobs.get(key(projectId, stage))?.status === "running",
  );
}
