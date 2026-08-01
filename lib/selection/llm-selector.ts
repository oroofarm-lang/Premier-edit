import Anthropic from "@anthropic-ai/sdk";
import { assembleExpertSections } from "@/lib/experts";
import { HOOK_WINDOW_SEC } from "@/lib/experts/hook";
import { HeuristicContentSelector } from "./heuristic";
import type {
  CandidateSegment,
  ContentSelector,
  SelectionRequest,
  SelectionResult,
} from "./types";

const MODEL = "claude-sonnet-5";

// Keeps the prompt bounded for a large folder: the heuristic pre-ranks every
// candidate on delivery + keyword signal, and the LLM does the actual
// editorial judgment (narrative order, diversity, pacing) over a shortlist
// of the strongest ones rather than sifting all of them itself.
const SHORTLIST_MULTIPLE = 4;
const MAX_SHORTLIST = 60;

/** Covers the model's reasoning plus the JSON plan — see requestPlan. */
const MAX_RESPONSE_TOKENS = 16000;

type LlmChoice = {
  index: number;
  score: number;
  reason: string;
  beat: string;
  /** Shortlist index whose footage plays over this moment's audio, if any. */
  videoFrom?: number;
};

/**
 * Explicit "must include" / "must not include" instructions the model itself
 * extracted from the free-text brief. Mechanically checked in validatePlan
 * rather than trusted — this catches the model stating an intent ("the brief
 * says to include the funding round") and then not actually honoring it in
 * `choices`, the same class of self-consistency bug validatePlan's other
 * checks already guard against.
 */
type LlmConstraints = {
  requiredTopics: string[];
  excludedTopics: string[];
};

function buildPrompt(
  request: SelectionRequest,
  shortlist: CandidateSegment[],
): string {
  const items = shortlist
    .map((c, i) => {
      const seconds = (c.endSec - c.startSec).toFixed(1);
      return `#${i} | ${c.filePath.split("/").pop()} | ${seconds}s | ${c.text.trim()}`;
    })
    .join("\n");

  return `אתה עורך תוכן לרשתות חברתיות. אתה בונה עכשיו את **פס האודיו** של
הסרטון — הסיפור המדובר, ורק אותו. יש לך רשימת רגעים מדוברים מתוך חומר הגלם,
ואתה בוחר תת-קבוצה מהם ומסדר אותה לכדי סיפור אחד קוהרנטי.

**התמונה לא באחריותך בשלב הזה.** אל תשקול איך רגע נראה, אל תעדיף רגע כי הוא
מצולם יפה, ואל תפסול רגע כי הוא לא. שכבת וידאו נפרדת תולבש אחר כך מעל מה
שתבחר, והיא תבחר תמונות לפי הקריטריונים שלה. תפקידך הוא לבחור **מה נאמר
ובאיזה סדר** — זה וזה בלבד.

היעד:

בריף: ${request.brief ?? "(לא ניתן בריף — תבחר את הרגעים שהתוכן שלהם הכי חזק)"}
משך יעד: ${request.targetDurationSec} שניות (זה לא חובה מדויקת, אבל תישאר קרוב)

${assembleExpertSections({
  stage: "selection",
  outputProfile: request.outputProfile,
  targetDurationSec: request.targetDurationSec,
})}

רשימת המועמדים (מספר # הוא המזהה שאתה מחזיר):
${items}

לפני שאתה בוחר, תכנן: מה הפרמיסה של הסרטון במשפט אחד, ובאיזה מבנה מהרשימה
למעלה אתה בונה אותו (או שילוב שלהם).

רק את המועמדים שאתה בפועל בוחר לקאט הסופי — לא צריך לחוות דעה על כולם.
לכל מועמד שנבחר ציין גם "beat" — איזה חלק מהמבנה שתכננת הוא ממלא (למשל
"הוק", "גוף", "סיום"). "reason" חייב להיות קצר: עד 12 מילים, לא משפט מלא.

אילוצים מפורשים מהבריף: אם הבריף מכיל הוראה מפורשת מהצורה "חייב לכלול X" /
"אסור לכלול Y" / "בלי Z" — ולא רק נושא כללי — תחלץ אותם ל-"constraints"
למטה. אם הבריף לא מכיל אילוץ מפורש כזה, החזר מערכים ריקים. אל תמציא אילוץ
שלא נאמר בפירוש — "requiredTopics"/"excludedTopics" הם רק למה שהבריף דורש
במפורש, לא לכל נושא שמוזכר בו. התוכנית שלך תיבדק אחר כך שהיא באמת מכבדת
את מה שאתה עצמך מחלץ כאן.

החזר אך ורק JSON תקין בפורמט הבא, בלי שום טקסט לפני או אחרי:
{
  "premise": "משפט אחד שמתאר את הרעיון המרכזי של הסרטון",
  "constraints": { "requiredTopics": [], "excludedTopics": [] },
  "beatPlan": ["הוק", "גוף", "סיום"],
  "selections": [
    { "index": 0, "score": 0.9, "beat": "הוק", "reason": "עד 12 מילים — למה זה ההוק" },
    { "index": 5, "score": 0.8, "beat": "גוף", "reason": "מסביר את המרכיבים" }
  ]
}
הסדר במערך selections הוא סדר ההופעה בקאט הסופי.`;
}

// Exported for lib/selection/refine.ts, which parses the identical response
// shape for a refinement turn and must not duplicate this parser.
export type LlmPlan = {
  premise: string;
  beatPlan: string[];
  constraints?: LlmConstraints;
  choices: LlmChoice[];
};

/** Joins a candidate's speech + visual description into one lowercased blob for a topic substring check. */
function candidateText(c: CandidateSegment): string {
  return [c.text, c.visualSummary, ...(c.visualTags ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** How many times the same source clip may appear before a plan is rejected —
 * this is the exact "reused one long clip four times" failure that motivated
 * building the LLM selector in the first place (see CLAUDE.md). */
const MAX_REUSE_PER_ASSET = 2;

export function validatePlan(
  plan: LlmPlan,
  shortlist: CandidateSegment[],
): { ok: true } | { ok: false; reason: string } {
  if (plan.choices.length === 0) {
    return { ok: false, reason: "The plan selected no clips." };
  }

  const first = shortlist[plan.choices[0].index];
  if (!first) {
    return { ok: false, reason: `Choice at index ${plan.choices[0].index} does not exist in the shortlist.` };
  }
  const firstDuration = first.endSec - first.startSec;
  if (firstDuration > HOOK_WINDOW_SEC) {
    return {
      ok: false,
      reason: `The opening clip is ${firstDuration.toFixed(1)}s, longer than the ${HOOK_WINDOW_SEC}s hook window — the hook must land fast.`,
    };
  }

  const usesByAsset = new Map<string, number>();
  for (const choice of plan.choices) {
    const candidate = shortlist[choice.index];
    if (!candidate) continue;
    const count = (usesByAsset.get(candidate.mediaAssetId) ?? 0) + 1;
    usesByAsset.set(candidate.mediaAssetId, count);
    if (count > MAX_REUSE_PER_ASSET) {
      return {
        ok: false,
        reason: `Media asset ${candidate.mediaAssetId} is used ${count} times, more than the ${MAX_REUSE_PER_ASSET}-use diversity limit.`,
      };
    }
  }

  // A video override may only borrow from a moment this same plan is actually
  // placing — otherwise the cut would pull in footage the user never approved.
  const chosenIndexes = new Set(plan.choices.map((c) => c.index));
  const overriddenIndexes = new Set(
    plan.choices.filter((c) => c.videoFrom !== undefined).map((c) => c.index),
  );
  for (const choice of plan.choices) {
    if (choice.videoFrom === undefined) continue;
    if (!shortlist[choice.videoFrom]) {
      return {
        ok: false,
        reason: `videoFrom ${choice.videoFrom} does not exist in the shortlist.`,
      };
    }
    if (!chosenIndexes.has(choice.videoFrom)) {
      return {
        ok: false,
        reason: `videoFrom ${choice.videoFrom} points at a clip this plan does not select — B-roll may only come from moments already in the cut.`,
      };
    }
    if (overriddenIndexes.has(choice.videoFrom)) {
      return {
        ok: false,
        reason: `videoFrom ${choice.videoFrom} points at a moment that itself overrides its video — a moment's video must resolve in one hop.`,
      };
    }
  }

  // Mechanically check the plan against constraints the model itself
  // extracted from the brief — catches the model stating an explicit
  // requirement and then not actually honoring it in `choices`.
  const chosenText = plan.choices
    .map((c) => shortlist[c.index])
    .filter((c): c is CandidateSegment => c !== undefined)
    .map(candidateText)
    .join(" | ");

  for (const topic of plan.constraints?.requiredTopics ?? []) {
    if (!topic.trim()) continue;
    if (!chosenText.includes(topic.toLowerCase())) {
      return {
        ok: false,
        reason: `Required topic "${topic}" (the plan's own extracted constraint) is not covered by any selected moment.`,
      };
    }
  }
  for (const topic of plan.constraints?.excludedTopics ?? []) {
    if (!topic.trim()) continue;
    if (chosenText.includes(topic.toLowerCase())) {
      return {
        ok: false,
        reason: `Excluded topic "${topic}" (the plan's own extracted constraint) appears in a selected moment.`,
      };
    }
  }

  return { ok: true };
}

export function parsePlan(text: string): LlmPlan {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed.selections)) {
    throw new Error("LLM selection response missing a 'selections' array.");
  }
  const rawConstraints = parsed.constraints ?? {};
  return {
    premise: String(parsed.premise ?? ""),
    beatPlan: Array.isArray(parsed.beatPlan) ? parsed.beatPlan.map(String) : [],
    constraints: {
      requiredTopics: Array.isArray(rawConstraints.requiredTopics)
        ? rawConstraints.requiredTopics.map(String)
        : [],
      excludedTopics: Array.isArray(rawConstraints.excludedTopics)
        ? rawConstraints.excludedTopics.map(String)
        : [],
    },
    choices: parsed.selections.map(
      (s: {
        index: unknown;
        score: unknown;
        reason: unknown;
        beat: unknown;
        videoFrom?: unknown;
      }) => ({
        index: Number(s.index),
        score: Number(s.score),
        reason: String(s.reason ?? ""),
        beat: String(s.beat ?? ""),
        ...(s.videoFrom === undefined || s.videoFrom === null
          ? {}
          : { videoFrom: Number(s.videoFrom) }),
      }),
    ),
  };
}

/**
 * LLM-backed selector: uses transcript + visual analysis + researched
 * social-editing guidelines to make an actual editorial judgment — narrative
 * order and diversity across sources, not just greedy duration-fitting on a
 * relevance score. Requires ANTHROPIC_API_KEY; see CLAUDE.md.
 */
export class LlmContentSelector implements ContentSelector {
  readonly name = `llm-selector:${MODEL}`;
  private readonly client: Anthropic;
  private readonly shortlister = new HeuristicContentSelector();

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. The LLM content selector needs an " +
          "Anthropic API key (separate from a Claude.ai subscription) — see CLAUDE.md.",
      );
    }
    this.client = new Anthropic({ apiKey });
  }

  async select(request: SelectionRequest): Promise<SelectionResult> {
    if (request.candidates.length === 0) return { selections: [] };

    const shortlist = await this.buildShortlist(request);
    if (shortlist.length === 0) return { selections: [] };

    const basePrompt = buildPrompt(request, shortlist);
    let plan = await this.requestPlan(basePrompt);
    let validation = validatePlan(plan, shortlist);

    if (!validation.ok) {
      const retryPrompt = `${basePrompt}\n\nהניסיון הקודם שלך נדחה: ${validation.reason}\nתקן את התוכנית כך שתעמוד בכללים ונסה שוב.`;
      plan = await this.requestPlan(retryPrompt);
      validation = validatePlan(plan, shortlist);
      if (!validation.ok) {
        throw new Error(
          `LLM selection plan failed validation twice in a row: ${validation.reason}`,
        );
      }
    }

    const choices = plan.choices;

    // Defensive budget cap: the model is asked to respect targetDurationSec
    // but isn't guaranteed to — stop once the running total goes over rather
    // than trusting it blindly. Order matters here (it's the narrative), so
    // this doesn't reorder or backfill the way the heuristic's greedy pass does.
    const chosen: { candidate: CandidateSegment; choice: LlmChoice }[] = [];
    let total = 0;
    for (const choice of choices) {
      const candidate = shortlist[choice.index];
      if (!candidate) continue;
      const seconds = candidate.endSec - candidate.startSec;
      if (total > 0 && total + seconds > request.targetDurationSec * 1.15) break;
      chosen.push({ candidate, choice });
      total += seconds;
    }

    // Validation guaranteed every videoFrom pointed at a selected moment, but
    // the budget cap above can drop one afterwards — so re-check against what
    // actually survived rather than trusting the pre-cap guarantee.
    const survivingIndexes = new Set(chosen.map(({ choice }) => choice.index));

    const selections = chosen.map(({ candidate, choice }, order) => {
      const source =
        choice.videoFrom !== undefined && survivingIndexes.has(choice.videoFrom)
          ? shortlist[choice.videoFrom]
          : undefined;

      return {
        mediaAssetId: candidate.mediaAssetId,
        startSec: candidate.startSec,
        endSec: candidate.endSec,
        order,
        score: Math.max(0, Math.min(1, choice.score)),
        reason: choice.reason ? `${choice.beat}: ${choice.reason}` : "נבחר על ידי מודל השפה",
        ...(source
          ? {
              videoOverride: {
                mediaAssetId: source.mediaAssetId,
                startSec: source.startSec,
                endSec: source.endSec,
              },
            }
          : {}),
      };
    });

    return { selections, premise: plan.premise, beatPlan: plan.beatPlan, shortlist };
  }

  private async requestPlan(prompt: string): Promise<LlmPlan> {
    const message = await this.client.messages.create({
      model: MODEL,
      // Generous because the budget covers the model's own reasoning as well
      // as the JSON. At 4096 a deliberative prompt could spend the entire
      // allowance thinking and return a response with no text block at all —
      // observed, not theoretical.
      max_tokens: MAX_RESPONSE_TOKENS,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = message.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error(
        `LLM selection response contained no text block. ` +
          `stop_reason=${message.stop_reason}, blocks=[${message.content.map((b) => b.type).join(",")}]`,
      );
    }
    if (message.stop_reason === "max_tokens") {
      throw new Error(
        "LLM selection response was cut off at the token limit before finishing its JSON.",
      );
    }
    return parsePlan(textBlock.text);
  }

  private async buildShortlist(
    request: SelectionRequest,
  ): Promise<CandidateSegment[]> {
    const { selections: preSelected } = await this.shortlister.select({
      ...request,
      targetDurationSec: request.targetDurationSec * SHORTLIST_MULTIPLE,
    });
    const byKey = new Map(
      request.candidates.map((c) => [`${c.mediaAssetId}:${c.startSec}:${c.endSec}`, c]),
    );
    return preSelected
      .map((s) => byKey.get(`${s.mediaAssetId}:${s.startSec}:${s.endSec}`))
      .filter((c): c is CandidateSegment => c !== undefined)
      .slice(0, MAX_SHORTLIST);
  }
}
