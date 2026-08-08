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
  /**
   * e.g. "close-up", "medium", "wide" — the strongest available signal for
   * "this is a person talking to camera," which is the classic B-roll
   * opportunity (see LlmContentSelector's videoFrom prompt).
   */
  visualShotType?: string | null;
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
  /**
   * Footage to show over this moment's audio, when the strongest visual for
   * the beat lives in a different clip than the one being heard (B-roll
   * cutaway). Absent means picture and sound both come from this moment.
   */
  videoOverride?: {
    mediaAssetId: string;
    startSec: number;
    endSec: number;
  };
};

export type SelectionRequest = {
  brief: string | null;
  outputProfile: OutputProfile;
  targetDurationSec: number;
  candidates: CandidateSegment[];
};

export type SelectionResult = {
  selections: SelectedSegment[];
  /**
   * One-sentence narrative idea the selector was building toward, and which
   * named story structure it followed — present only for a selector that
   * actually reasons about narrative (the LLM one). Absent for the heuristic
   * selector, which has no such concept.
   */
  premise?: string;
  beatPlan?: string[];
  /**
   * Every candidate the selector considered before narrowing down to
   * `selections`, when it pre-filters (the LLM selector's heuristic shortlist
   * stage). Lets the UI show what didn't make the cut, not just what did.
   */
  shortlist?: CandidateSegment[];
};

export interface ContentSelector {
  readonly name: string;
  select(request: SelectionRequest): Promise<SelectionResult>;
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

/** Every profile value, for iterating (e.g. generating all of them at once). */
export const ALL_OUTPUT_PROFILES: OutputProfile[] = [
  "REEL_SHORT",
  "SOCIAL_POST",
  "YOUTUBE_LONG",
];

export const PROFILE_LABELS: Record<OutputProfile, string> = {
  REEL_SHORT: "Reel / Short",
  SOCIAL_POST: "Social post",
  YOUTUBE_LONG: "YouTube long-form",
};
