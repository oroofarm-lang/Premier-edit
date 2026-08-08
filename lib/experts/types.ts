import type { OutputProfile } from "@/lib/generated/prisma/enums";

/**
 * The pipeline stages an expert can contribute to. These mirror the per-stage
 * `run.ts` entry points under `lib/`, plus the two non-LLM surfaces (`qc`,
 * `execution`) where an expert contributes rules rather than prompt text.
 */
export type PipelineStage =
  | "transcription"
  | "vision"
  | "selection"
  | "cut"
  | "qc"
  | "execution";

/**
 * What a prompt-assembling caller knows about the run. An expert decides from
 * this whether it has anything to say — a platform expert stays silent for a
 * profile it doesn't cover, which is what keeps a large roster cheap.
 */
export type ExpertContext = {
  stage: PipelineStage;
  outputProfile: OutputProfile;
  targetDurationSec: number;
};

/**
 * A local expert brain: domain knowledge encoded once, in code, feeding the
 * LLM calls that already exist. An expert is deliberately **not** an LLM
 * invocation of its own — that is the decision that lets the roster grow
 * without raising token cost, since adding an expert adds prompt text to an
 * existing call rather than adding a call.
 *
 * See docs/superpowers/specs/2026-08-01-agents-and-panel-app-design.md.
 */
export type Expert = {
  /** Stable slug. Matches the file name and the `Volt/Agents/` note name. */
  id: string;
  /** Display name, used in the vault index and the panel. */
  title: string;
  /** One sentence: what this expert knows that no other expert does. */
  summary: string;
  /** Stages this expert participates in. */
  stages: PipelineStage[];
  /** Sibling expert ids. Drives the vault's link map, not the runtime. */
  worksWith: string[];
  /** Where the knowledge came from — URLs, specs, or observed project history. */
  sources: string[];
  /**
   * The text this expert contributes for `ctx`, or `null` when it has nothing
   * to say. Returning `null` is the normal case, not a failure: an expert is
   * expected to stay quiet outside its stages and profiles.
   */
  promptSection(ctx: ExpertContext): string | null;
};
