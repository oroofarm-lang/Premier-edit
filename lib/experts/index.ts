import type { Expert, ExpertContext, PipelineStage } from "./types";

import { cinematographyExpert } from "./cinematography";
import { foodAndProductExpert } from "./food-and-product";
import { framingExpert } from "./framing";
import { hebrewExpert } from "./hebrew";
import { hookExpert } from "./hook";
import { narrativeStructureExpert } from "./narrative-structure";
import { pacingExpert } from "./pacing";
import { platformFeedExpert } from "./platform-feed";
import { platformReelsExpert } from "./platform-reels";
import { platformYoutubeExpert } from "./platform-youtube";
import { premiereCraftExpert } from "./premiere-craft";
import { qcExpert } from "./qc";

export type { Expert, ExpertContext, PipelineStage } from "./types";

/**
 * The expert roster, in the order their sections appear in an assembled
 * prompt. Order is editorial, not alphabetical: the platform frames what kind
 * of video this is, structure decides the shape, the hook decides the opening,
 * pacing decides the lengths, and the domain/language experts qualify the
 * material — each one narrowing the decision the one before it opened.
 */
export const EXPERTS: readonly Expert[] = [
  platformReelsExpert,
  platformFeedExpert,
  platformYoutubeExpert,
  narrativeStructureExpert,
  hookExpert,
  pacingExpert,
  framingExpert,
  foodAndProductExpert,
  hebrewExpert,
  cinematographyExpert,
  premiereCraftExpert,
  qcExpert,
];

export function expertById(id: string): Expert | undefined {
  return EXPERTS.find((e) => e.id === id);
}

/** Every expert that declares participation in `stage`, in roster order. */
export function expertsForStage(stage: PipelineStage): Expert[] {
  return EXPERTS.filter((e) => e.stages.includes(stage));
}

/**
 * The experts that actually contribute text for this exact context. This is
 * narrower than `expertsForStage` — a platform expert participates in
 * `selection` but stays silent for a profile it doesn't cover, and that
 * silence is the whole reason a roster this size stays cheap.
 */
export function contributingExperts(ctx: ExpertContext): Expert[] {
  return expertsForStage(ctx.stage).filter((e) => e.promptSection(ctx) !== null);
}

/**
 * Assembles the knowledge sections for one LLM call. Callers splice the result
 * into their own prompt rather than this owning the whole prompt — the
 * candidate list, the response schema, and the task framing stay with the
 * stage that understands them.
 */
export function assembleExpertSections(ctx: ExpertContext): string {
  return expertsForStage(ctx.stage)
    .map((e) => e.promptSection(ctx))
    .filter((section): section is string => section !== null)
    .join("\n\n");
}
