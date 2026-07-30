import Anthropic from "@anthropic-ai/sdk";
import { SOCIAL_EDITING_GUIDELINES } from "@/lib/editing/social-guidelines";
import { HeuristicContentSelector } from "./heuristic";
import type {
  CandidateSegment,
  ContentSelector,
  SelectedSegment,
  SelectionRequest,
} from "./types";

const MODEL = "claude-sonnet-5";

// Keeps the prompt bounded for a large folder: the heuristic pre-ranks every
// candidate on delivery + keyword signal, and the LLM does the actual
// editorial judgment (narrative order, diversity, pacing) over a shortlist
// of the strongest ones rather than sifting all of them itself.
const SHORTLIST_MULTIPLE = 4;
const MAX_SHORTLIST = 60;

type LlmChoice = { index: number; score: number; reason: string; beat: string };

function buildPrompt(
  request: SelectionRequest,
  shortlist: CandidateSegment[],
): string {
  const items = shortlist
    .map((c, i) => {
      const speech = c.text.trim() || "(אין דיבור)";
      const visual = c.visualSummary
        ? `ראייה: ${c.visualSummary}${c.visualTags?.length ? ` [${c.visualTags.join(", ")}]` : ""}`
        : "ראייה: (לא נותח)";
      const seconds = (c.endSec - c.startSec).toFixed(1);
      return `#${i} | ${c.filePath.split("/").pop()} | ${seconds}s | דיבור: ${speech} | ${visual}`;
    })
    .join("\n");

  return `אתה עורך תוכן לרשתות חברתיות. יש לך רשימת רגעים מועמדים מתוך חומר גלם
(כל אחד עם דיבור אם יש, ותיאור חזותי אם נותח). תבחר תת-קבוצה מהם ותסדר אותם
לכדי קאט אחד קצר וקוהרנטי, שמתאים ליעד הבא:

בריף: ${request.brief ?? "(לא ניתן בריף — תבחר את הרגעים הכי חזקים מבחינה חזותית ותוכנית)"}
משך יעד: ${request.targetDurationSec} שניות (זה לא חובה מדויקת, אבל תישאר קרוב)

${SOCIAL_EDITING_GUIDELINES}

רשימת המועמדים (מספר # הוא המזהה שאתה מחזיר):
${items}

לפני שאתה בוחר, תכנן: מה הפרמיסה של הסרטון במשפט אחד, ומה מבנה הביטים
(לדוגמה: הוק, גוף, סיום) שאתה מתכוון לבנות מהם.

רק את המועמדים שאתה בפועל בוחר לקאט הסופי — לא צריך לחוות דעה על כולם.
לכל מועמד שנבחר ציין גם "beat" — איזה חלק מהמבנה שתכננת הוא ממלא (למשל
"הוק", "גוף", "סיום"). "reason" חייב להיות קצר: עד 12 מילים, לא משפט מלא.

החזר אך ורק JSON תקין בפורמט הבא, בלי שום טקסט לפני או אחרי:
{
  "premise": "משפט אחד שמתאר את הרעיון המרכזי של הסרטון",
  "beatPlan": ["הוק", "גוף", "סיום"],
  "selections": [
    { "index": 0, "score": 0.9, "beat": "הוק", "reason": "עד 12 מילים — למה זה ההוק" }
  ]
}
הסדר במערך selections הוא סדר ההופעה בקאט הסופי.`;
}

type LlmPlan = {
  premise: string;
  beatPlan: string[];
  choices: LlmChoice[];
};

/** How many seconds into the cut the hook must land, per the researched
 * short-form guidelines already used elsewhere in this prompt. */
const HOOK_WINDOW_SEC = 3;
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

  return { ok: true };
}

function parsePlan(text: string): LlmPlan {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed.selections)) {
    throw new Error("LLM selection response missing a 'selections' array.");
  }
  return {
    premise: String(parsed.premise ?? ""),
    beatPlan: Array.isArray(parsed.beatPlan) ? parsed.beatPlan.map(String) : [],
    choices: parsed.selections.map(
      (s: { index: unknown; score: unknown; reason: unknown; beat: unknown }) => ({
        index: Number(s.index),
        score: Number(s.score),
        reason: String(s.reason ?? ""),
        beat: String(s.beat ?? ""),
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

  async select(request: SelectionRequest): Promise<SelectedSegment[]> {
    if (request.candidates.length === 0) return [];

    const shortlist = await this.buildShortlist(request);
    if (shortlist.length === 0) return [];

    const message = await this.client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: "user", content: buildPrompt(request, shortlist) }],
    });

    const textBlock = message.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("LLM selection response contained no text block.");
    }
    if (message.stop_reason === "max_tokens") {
      throw new Error(
        "LLM selection response was cut off at the token limit before finishing its JSON.",
      );
    }
    const plan = parsePlan(textBlock.text);
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

    return chosen.map(({ candidate, choice }, order) => ({
      mediaAssetId: candidate.mediaAssetId,
      startSec: candidate.startSec,
      endSec: candidate.endSec,
      order,
      score: Math.max(0, Math.min(1, choice.score)),
      reason: choice.reason || "נבחר על ידי מודל השפה",
    }));
  }

  private async buildShortlist(
    request: SelectionRequest,
  ): Promise<CandidateSegment[]> {
    const preSelected = await this.shortlister.select({
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
