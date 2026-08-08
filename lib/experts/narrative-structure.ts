import type { OutputProfile } from "@/lib/generated/prisma/enums";
import type { Expert } from "./types";

/**
 * Named beat structures per output profile, researched 2026-07-31 from how
 * commercial AI editing tools (e.g. Chat Video Pro's Story Cutter) frame
 * platform-specific structure — see
 * docs/superpowers/specs/2026-07-31-chatvideopro-competitive-roadmap.md.
 *
 * Giving the selector named options to pick from (or blend) replaces having
 * it invent a beatPlan from nothing every run, which produced inconsistent
 * structure across otherwise-similar cuts.
 *
 * Absorbed from the former lib/editing/social-guidelines.ts, which was
 * deleted so there is exactly one source of truth for editorial knowledge.
 */
export const STORY_STRUCTURES: Record<
  OutputProfile,
  { name: string; beats: string[] }[]
> = {
  REEL_SHORT: [
    { name: "הוק-תוצאה", beats: ["הוק", "תוצאה/פאנץ׳", "הוכחה/פרט תומך", "קריאה לפעולה"] },
    { name: "הוק-תהליך", beats: ["הוק", "תהליך/הכנה", "הגשה/סיום"] },
  ],
  SOCIAL_POST: [
    { name: "בעיה-פתרון", beats: ["בעיה/צורך", "אמינות/הקשר", "שלבים", "תוצאה", "קריאה לפעולה"] },
    { name: "הוק-גוף-שיא", beats: ["הוק", "גוף (כמה נקודות)", "שיא", "סיום"] },
  ],
  YOUTUBE_LONG: [
    { name: "שלוש מערכות", beats: ["פתיחה/הצגה", "עימות/מכשול/פירוט", "פתרון/סיכום"] },
    {
      name: "פתיחה קרה מורחבת",
      beats: ["פתיחה קרה", "הקשר", "מתח עולה", "פתרון", "רפלקציה/סיכום"],
    },
  ],
};

/** Formats the named structures available for one profile. */
export function describeStoryStructures(profile: OutputProfile): string {
  return STORY_STRUCTURES[profile]
    .map((s) => `- "${s.name}": ${s.beats.join(" -> ")}`)
    .join("\n");
}

export const narrativeStructureExpert: Expert = {
  id: "narrative-structure",
  title: "מומחה מבנה סיפורי",
  summary:
    "בוחר מבנה בּיטים מוכר ליעד, ומוודא שכל ביט מאויש ושהקאט נגמר בסגירה ולא באמצע משפט.",
  stages: ["selection"],
  worksWith: ["hook", "pacing", "platform-reels", "platform-feed", "platform-youtube"],
  sources: [
    "docs/superpowers/specs/2026-07-31-chatvideopro-competitive-roadmap.md",
    "docs/superpowers/specs/2026-07-30-editing-quality-design.md",
  ],

  promptSection(ctx) {
    if (ctx.stage !== "selection") return null;

    return `## מבנה סיפורי

מבנים מוכרים ליעד הזה — בחר אחד, או מזג בין שניים אם באמת מתאים יותר:
${describeStoryStructures(ctx.outputProfile)}

לפני שאתה בוחר רגעים, תכנן: מה הפרמיסה במשפט אחד, ובאיזה מבנה אתה בונה אותה.
אחר כך תמלא את הביטים — לא ההפך. אל תבחר רגעים חזקים ואז תמציא להם מבנה.

שלושה כללים על הסדר, כי כאן הקאטים נכשלים הכי הרבה:
1. **כל ביט במבנה שבחרת חייב רגע אחד לפחות.** אם אין חומר לביט מסוים — בחר
   מבנה אחר, אל תדלג עליו בשקט.
2. **הרגע האחרון חייב להרגיש כמו סוף** — תוצאה, סיכום, או פאנץ׳. משפט שנקטע
   באמצע, או רגע אקראי מהגוף, הופך את כל הקאט למרגיש לא גמור.
3. **הסדר הוא הסדר הנרטיבי, לא סדר הצילום.** אם הרגע החזק ביותר צולם אחרון,
   הוא עדיין יכול לפתוח. אל תשמור על סדר הקבצים.`;
  },
};
