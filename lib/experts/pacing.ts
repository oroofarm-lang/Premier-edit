import type { OutputProfile } from "@/lib/generated/prisma/enums";
import type { Expert } from "./types";

/**
 * Average seconds a single moment should hold, per profile. Short vertical
 * content cuts roughly every 1.5-2.5s; long-form tolerates — and needs —
 * moments that breathe, otherwise it reads as frantic rather than considered.
 */
export const SHOT_DURATION_SEC: Record<
  OutputProfile,
  { min: number; ideal: number; max: number }
> = {
  REEL_SHORT: { min: 0.8, ideal: 2.0, max: 4.0 },
  SOCIAL_POST: { min: 1.0, ideal: 2.5, max: 6.0 },
  YOUTUBE_LONG: { min: 1.5, ideal: 4.0, max: 12.0 },
};

/**
 * How many moments a cut of this length should contain. Deterministic — this
 * is arithmetic, not judgment, so it costs nothing and belongs below the
 * token line.
 */
export function targetShotCount(
  targetDurationSec: number,
  profile: OutputProfile,
): { min: number; ideal: number; max: number } {
  const range = SHOT_DURATION_SEC[profile];
  return {
    min: Math.max(2, Math.floor(targetDurationSec / range.max)),
    ideal: Math.max(3, Math.round(targetDurationSec / range.ideal)),
    max: Math.max(4, Math.ceil(targetDurationSec / range.min)),
  };
}

/**
 * Deterministic pacing checks over a finished cut. Returns human-readable
 * problems, empty when the cut paces acceptably. Pure — no Prisma, no SDK —
 * so it is unit-testable and reusable by the QC stage.
 */
export function pacingProblems(
  shotDurationsSec: number[],
  profile: OutputProfile,
): string[] {
  const range = SHOT_DURATION_SEC[profile];
  const problems: string[] = [];
  if (shotDurationsSec.length === 0) return ["הקאט ריק."];

  const tooLong = shotDurationsSec.filter((d) => d > range.max).length;
  if (tooLong > 0) {
    problems.push(
      `${tooLong} רגעים ארוכים מ-${range.max}s — יאבדו קצב ביעד ${profile}.`,
    );
  }

  const tooShort = shotDurationsSec.filter((d) => d < range.min).length;
  if (tooShort > 0) {
    problems.push(
      `${tooShort} רגעים קצרים מ-${range.min}s — ייקראו כהבהוב, לא כשוט.`,
    );
  }

  // A cut where every shot is the same length reads mechanical even when each
  // individual shot is in range, so variety is checked separately.
  if (shotDurationsSec.length >= 4) {
    const mean =
      shotDurationsSec.reduce((sum, d) => sum + d, 0) / shotDurationsSec.length;
    const spread =
      Math.sqrt(
        shotDurationsSec.reduce((sum, d) => sum + (d - mean) ** 2, 0) /
          shotDurationsSec.length,
      ) / (mean || 1);
    if (spread < 0.15) {
      problems.push(
        "כל הרגעים באותו אורך בערך — הקאט ירגיש מכני. כדאי לגוון.",
      );
    }
  }

  return problems;
}

export const pacingExpert: Expert = {
  id: "pacing",
  title: "מומחה קצב",
  summary:
    "קובע כמה רגעים צריכים להיות בקאט ובאיזה אורך, ובודק דטרמיניסטית שהקצב לא אחיד מדי או איטי מדי.",
  stages: ["selection", "qc"],
  worksWith: ["hook", "narrative-structure", "qc"],
  sources: [
    "https://aibrify.com/blog/short-form-video-editing-captions-b-roll-guide",
    "https://blog.brandghost.ai/posts/instagram-reels-best-practices-for-creators/",
  ],

  promptSection(ctx) {
    if (ctx.stage !== "selection") return null;

    const range = SHOT_DURATION_SEC[ctx.outputProfile];
    const count = targetShotCount(ctx.targetDurationSec, ctx.outputProfile);

    return `## קצב

לקאט של ${ctx.targetDurationSec} שניות ביעד הזה: בערך **${count.ideal} רגעים**
(לא פחות מ-${count.min}, לא יותר מ-${count.max}).

אורך רגע בודד: ${range.min}-${range.max} שניות, ${range.ideal}s זה הטיפוסי.
רגע ארוך מ-${range.max}s מאבד את הצופה גם אם התוכן שלו טוב — קח ממנו חלק.

תן ורייאציה באורכים. רצף של רגעים באותו אורך בדיוק מרגיש מכני גם כשכל רגע
בנפרד תקין. בפרט: הוק קצר, ואז אפשר להאריך מעט בגוף.`;
  },
};
