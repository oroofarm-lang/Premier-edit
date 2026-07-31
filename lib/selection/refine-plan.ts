import type { LlmPlan } from "./llm-selector";
import type { CandidateSegment, SelectedSegment, SelectionResult } from "./types";

// Pure logic for conversational refinement — prompt assembly, draft
// reconstruction, plan mapping, and diffing. Deliberately free of Prisma and
// the Anthropic SDK so it is unit-testable without a database or an API key
// (the same split every other tested module in lib/ follows). The I/O half
// lives in refine.ts.

export type RefinementTurn = {
  /** What the user typed, or "רגע N: ..." seeded from a moment chip. */
  instruction: string;
  /** One-sentence summary of what changed, or the rejection reason on failure. */
  response: string;
  /** false when validatePlan rejected the attempt — the draft's result is unchanged by this turn. */
  ok: boolean;
  at: string;
};

export type RefinementDraft = {
  /** The refined cut. Not live until applyRefinementDraft persists it. */
  result: SelectionResult;
  /** Full conversation, oldest first. */
  turns: RefinementTurn[];
};

export type SelectionDiffEntry = {
  status: "kept" | "removed" | "added" | "moved";
  mediaAssetId: string;
  startSec: number;
  endSec: number;
};

/** The live `Selection` row shape this module needs — narrower than Prisma's model so tests don't need the generated client. */
export type LiveSelectionRow = {
  mediaAssetId: string;
  startSec: number;
  endSec: number;
  order: number;
  score: number | null;
  reason: string | null;
  videoAssetId: string | null;
  videoStartSec: number | null;
  videoEndSec: number | null;
};

/**
 * Same candidate-line format llm-selector.ts's buildPrompt uses — kept in
 * sync deliberately, since the model's `index`/`videoFrom` values must
 * resolve against the exact same array either way.
 */
function candidateLine(c: CandidateSegment, i: number): string {
  const speech = c.text.trim() || "(אין דיבור)";
  const visual = c.visualSummary
    ? `ראייה: ${c.visualSummary}${c.visualTags?.length ? ` [${c.visualTags.join(", ")}]` : ""}`
    : "ראייה: (לא נותח)";
  const shotType = c.visualShotType ? ` | צילום: ${c.visualShotType}` : "";
  const seconds = (c.endSec - c.startSec).toFixed(1);
  return `#${i} | ${c.filePath.split("/").pop()} | ${seconds}s | דיבור: ${speech} | ${visual}${shotType}`;
}

/**
 * The starting point for a refinement turn: an existing draft if a
 * conversation is already under way, otherwise a SelectionResult rebuilt
 * from the project's live Selection rows (the first turn against whatever
 * is currently applied).
 */
export function buildStartingDraft(
  project: {
    refinementDraftJson: string | null;
    selectionPremise: string | null;
    selectionBeatPlan: string | null;
    selections: LiveSelectionRow[];
  },
  shortlist: CandidateSegment[],
): RefinementDraft {
  if (project.refinementDraftJson) {
    return JSON.parse(project.refinementDraftJson) as RefinementDraft;
  }

  const selections: SelectedSegment[] = project.selections.map((s) => ({
    mediaAssetId: s.mediaAssetId,
    startSec: s.startSec,
    endSec: s.endSec,
    order: s.order,
    score: s.score ?? 0,
    reason: s.reason ?? "",
    ...(s.videoAssetId !== null && s.videoStartSec !== null && s.videoEndSec !== null
      ? {
          videoOverride: {
            mediaAssetId: s.videoAssetId,
            startSec: s.videoStartSec,
            endSec: s.videoEndSec,
          },
        }
      : {}),
  }));

  return {
    result: {
      selections,
      premise: project.selectionPremise ?? undefined,
      beatPlan: project.selectionBeatPlan
        ? (JSON.parse(project.selectionBeatPlan) as string[])
        : undefined,
      shortlist,
    },
    turns: [],
  };
}

/**
 * Prompt for one refinement turn: the current cut numbered 1-based (matching
 * the UI's moment chips), the full shortlist it may still draw from, the
 * conversation so far, and the new instruction.
 */
export function buildRefinementPrompt(
  draft: RefinementDraft,
  shortlist: CandidateSegment[],
  instruction: string,
): string {
  const currentCutLines = draft.result.selections
    .map((s, i) => {
      const shortlistIndex = shortlist.findIndex(
        (c) =>
          c.mediaAssetId === s.mediaAssetId &&
          c.startSec === s.startSec &&
          c.endSec === s.endSec,
      );
      const label =
        shortlistIndex >= 0
          ? `#${shortlistIndex} ${shortlist[shortlistIndex].filePath.split("/").pop()}`
          : s.mediaAssetId;
      return `${i + 1}. ${label} | ${(s.endSec - s.startSec).toFixed(1)}s | ${s.reason}`;
    })
    .join("\n");

  const items = shortlist.map((c, i) => candidateLine(c, i)).join("\n");

  const historyBlock =
    draft.turns.length > 0
      ? `היסטוריית השיחה עד כה:\n${draft.turns
          .map(
            (t, i) =>
              `סבב ${i + 1} — הוראה: ${t.instruction}\nתוצאה: ${t.ok ? t.response : `נדחה: ${t.response}`}`,
          )
          .join("\n\n")}\n\n`
      : "";

  return `אתה מעדכן קאט קיים לפי הוראה חדשה של המשתמש. המשימה שלך היא לבצע רק
את מה שההוראה מבקשת, ולהשאיר כל דבר אחר בדיוק כמו שהוא.

הקאט הנוכחי (מספור 1 עד N, בדיוק כמו שהמשתמש רואה אותו):
${currentCutLines}

רשימת כל המועמדים הזמינים (מספר # הוא המזהה שאתה מחזיר ב-"index"/"videoFrom" —
זהה לרשימה שממנה נבנה הקאט המקורי):
${items}

${historyBlock}ההוראה החדשה של המשתמש: "${instruction}"

כללים:
- שנה רק את מה שההוראה מבקשת. כל רגע שלא קשור אליה חייב לחזור עם אותו
  index ברשימת המועמדים ואותו videoFrom (אם היה), באותו מקום יחסי בסדר —
  אלא אם ההוראה עצמה מבקשת שינוי סדר.
- אם ההוראה מתייחסת ל"רגע N", הכוונה למספר בקאט הנוכחי למעלה (1 עד N),
  לא למספר ברשימת המועמדים.
- "changeSummary" חייב לתאר במשפט אחד מה בפועל שינית.
- כל שאר הכללים מהבחירה המקורית עדיין תקפים: ההוק חייב לפתוח תוך 3 שניות,
  אותו מקור לא יכול להופיע יותר מפעמיים, ו-videoFrom חייב להצביע על רגע
  שנבחר בפועל ושאין לו בעצמו videoFrom.
- אם אי אפשר לבצע את ההוראה בלי לשבור אחד מהכללים האלה, או שאין ברשימת
  המועמדים חומר שמאפשר אותה — אל תנסה להתחכם ואל תאריך במחשבה. פשוט החזר
  את הקאט הנוכחי בדיוק כמו שהוא, ותסביר ב-"changeSummary" במשפט אחד למה
  לא ביצעת. זו תשובה תקינה ומועילה, לא כישלון.

החזר אך ורק JSON תקין בפורמט הבא, בלי שום טקסט לפני או אחרי:
{
  "premise": "משפט אחד שמתאר את הרעיון המרכזי של הסרטון",
  "changeSummary": "משפט אחד שמתאר מה שינית בפועל",
  "constraints": { "requiredTopics": [], "excludedTopics": [] },
  "beatPlan": ["הוק", "גוף", "סיום"],
  "selections": [
    { "index": 0, "score": 0.9, "beat": "הוק", "reason": "עד 12 מילים" }
  ]
}
הסדר במערך selections הוא סדר ההופעה בקאט הסופי.`;
}

/** The model's one-line description of what it changed, alongside the plan itself. */
export function extractChangeSummary(text: string): string {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const parsed = JSON.parse(cleaned);
  return String(parsed.changeSummary ?? "");
}

/**
 * Turns a validated plan into SelectedSegments — same mapping
 * llm-selector.ts's select() does, minus its duration budget cap. An explicit
 * user edit should not be silently truncated for going a little long; the
 * user can see the resulting duration in the diff and say so if it bothers them.
 */
export function planToSelections(
  plan: LlmPlan,
  shortlist: CandidateSegment[],
): SelectedSegment[] {
  const chosen = plan.choices
    .map((choice) => ({ choice, candidate: shortlist[choice.index] }))
    .filter(
      (c): c is { choice: LlmPlan["choices"][number]; candidate: CandidateSegment } =>
        c.candidate !== undefined,
    );
  const chosenIndexes = new Set(chosen.map(({ choice }) => choice.index));

  return chosen.map(({ candidate, choice }, order) => {
    const source =
      choice.videoFrom !== undefined && chosenIndexes.has(choice.videoFrom)
        ? shortlist[choice.videoFrom]
        : undefined;

    return {
      mediaAssetId: candidate.mediaAssetId,
      startSec: candidate.startSec,
      endSec: candidate.endSec,
      order,
      score: Math.max(0, Math.min(1, choice.score)),
      reason: choice.reason ? `${choice.beat}: ${choice.reason}` : "עודכן על ידי מודל השפה",
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
}

/**
 * Kept/removed/added/moved against the moment's stable identity (the same
 * mediaAssetId:startSec:endSec triple used throughout lib/selection).
 * "moved" is judged by relative order among the moments common to both
 * sides, not raw array position — otherwise removing moment 1 of 3 would
 * misreport moments 2 and 3 as moved just because the array compacted.
 */
export function diffSelections(
  before: SelectedSegment[],
  after: SelectedSegment[],
): SelectionDiffEntry[] {
  const key = (s: { mediaAssetId: string; startSec: number; endSec: number }) =>
    `${s.mediaAssetId}:${s.startSec}:${s.endSec}`;

  const beforeKeys = before.map(key);
  const afterKeys = after.map(key);
  const beforeSet = new Set(beforeKeys);
  const afterSet = new Set(afterKeys);

  const beforeCommonPos = new Map(
    beforeKeys.filter((k) => afterSet.has(k)).map((k, i) => [k, i]),
  );
  const afterCommonPos = new Map(
    afterKeys.filter((k) => beforeSet.has(k)).map((k, i) => [k, i]),
  );

  const entries: SelectionDiffEntry[] = [];

  for (const s of after) {
    const k = key(s);
    if (!beforeSet.has(k)) {
      entries.push({ status: "added", mediaAssetId: s.mediaAssetId, startSec: s.startSec, endSec: s.endSec });
      continue;
    }
    entries.push({
      status: beforeCommonPos.get(k) !== afterCommonPos.get(k) ? "moved" : "kept",
      mediaAssetId: s.mediaAssetId,
      startSec: s.startSec,
      endSec: s.endSec,
    });
  }

  for (const s of before) {
    if (!afterSet.has(key(s))) {
      entries.push({ status: "removed", mediaAssetId: s.mediaAssetId, startSec: s.startSec, endSec: s.endSec });
    }
  }

  return entries;
}
