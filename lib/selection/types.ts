import type { OutputProfile } from "@/lib/generated/prisma/enums";

// Same pattern as the Transcriber interface: the LLM vendor (or the absence of
// one) is an implementation detail. The heuristic selector exists so the whole
// pipeline can run end-to-end with no API key, and so there is a baseline to
// judge an LLM selector against rather than assuming it is better.

export type CandidateSegment = {
  mediaAssetId: string;
  filePath: string;
  startSec: number;
  endSec: number;
  /** Spoken text for this span, "" if there is none (silent or no transcript). */
  text: string;
  /**
   * What a vision model saw in the clip, independent of speech — present only
   * when visual analysis has run (requires an Anthropic API key). Lets a
   * silent or sparsely-spoken clip still be judged on visual merit instead of
   * being invisible to a transcript-only selector.
   */
  visualSummary?: string | null;
  visualTags?: string[];
};

export type SelectedSegment = {
  mediaAssetId: string;
  startSec: number;
  endSec: number;
  /** Position in the final cut, 0-based. */
  order: number;
  /** 0..1 — how well this earned its place. */
  score: number;
  /** Human-readable justification, shown in the approval UI. */
  reason: string;
};

export type SelectionRequest = {
  brief: string | null;
  outputProfile: OutputProfile;
  targetDurationSec: number;
  candidates: CandidateSegment[];
};

export interface ContentSelector {
  readonly name: string;
  select(request: SelectionRequest): Promise<SelectedSegment[]>;
}

/**
 * Rough target lengths per profile. These drive how much material the selector
 * keeps; the PRD treats them as guidance for a rough cut, not hard limits.
 */
export const PROFILE_TARGET_SECONDS: Record<OutputProfile, number> = {
  REEL_SHORT: 30,
  SOCIAL_POST: 60,
  YOUTUBE_LONG: 180,
};
