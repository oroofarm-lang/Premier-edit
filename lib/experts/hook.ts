import type { Expert } from "./types";

/**
 * How many seconds the opening moment gets before a viewer decides. Shared
 * with `validatePlan`'s HOOK_WINDOW_SEC in lib/selection/llm-selector.ts —
 * that check is the mechanical half of what this expert argues for in prose.
 */
export const HOOK_WINDOW_SEC = 3;

/**
 * Named opening patterns, so the selector picks a hook *type* rather than
 * "whatever looked most interesting". Each carries the signal to look for in
 * the candidate list, which is what makes it actionable against real
 * transcript + vision data rather than generic advice.
 */
export const HOOK_PATTERNS = [
  {
    name: "תוצאה מראש",
    what: "פותחים בתוצאה הסופית לפני שמראים איך הגיעו אליה",
    lookFor: "רגע ויזואלי של המנה/המוצר המוגמר, או משפט שמתאר את התוצאה",
  },
  {
    name: "פעולה באמצע",
    what: "נכנסים לתוך פעולה שכבר קורית, בלי הקדמה",
    lookFor: "צילום של ידיים עובדות, שפיכה, חיתוך, ערבוב — תנועה, לא דיבור",
  },
  {
    name: "אמירה חדה",
    what: "משפט קצר ובוטה שמייצר עניין או מחלוקת",
    lookFor: "משפט קצר (מתחת ל-3 שניות) שעומד בפני עצמו בלי הקשר קודם",
  },
  {
    name: "ניגוד ויזואלי",
    what: "מראים משהו לא צפוי שמייצר שאלה",
    lookFor: "רגע שהתיאור החזותי שלו לא מסתדר עם מה שמצפים מהנושא",
  },
  {
    name: "שאלה ישירה",
    what: "שואלים את הצופה שאלה שהסרטון עונה עליה",
    lookFor: "משפט שאלה בתמלול",
  },
] as const;

/** Openings that reliably lose the viewer — stated as a ban list, not a hint. */
const HOOK_ANTI_PATTERNS = [
  "ברכות והצגה עצמית (\"היי\", \"אז\", \"מה קורה\", \"אני X ואני\")",
  "הקדמה שמסבירה מה עומד לקרות במקום פשוט להראות אותו",
  "שוט נוף/כותרת סטטי בלי תנועה ובלי דיבור",
  "משפט שנחתך באמצע ולא עומד בפני עצמו",
];

export const hookExpert: Expert = {
  id: "hook",
  title: "מומחה הוק",
  summary:
    "אחראי על 1-3 השניות הראשונות — בוחר סוג פתיחה מתוך רשימה מוכרת ופוסל פתיחות שמאבדות צופים.",
  stages: ["selection"],
  worksWith: ["narrative-structure", "pacing", "platform-reels", "platform-feed"],
  sources: [
    "https://fobetmedia.com/instagram-reel-hooks/",
    "https://www.opus.pro/blog/instagram-reels-hook-formulas",
    "docs/superpowers/specs/2026-07-30-editing-quality-design.md",
  ],

  promptSection(ctx) {
    if (ctx.stage !== "selection") return null;

    const patterns = HOOK_PATTERNS.map(
      (p) => `- "${p.name}": ${p.what}. חפש: ${p.lookFor}.`,
    ).join("\n");
    const anti = HOOK_ANTI_PATTERNS.map((a) => `- ${a}`).join("\n");

    return `## הוק — הרגע הראשון

הרגע הראשון בקאט חייב להיות קצר מ-${HOOK_WINDOW_SEC} שניות, ותוכנית שלא עומדת
בזה נדחית אוטומטית. אל תבחר רגע ארוך "כי הוא הכי טוב" — תמצא את החלק הקצר
והחד שבתוכו, או רגע אחר.

בחר סוג הוק אחד מהרשימה והצהר עליו ב-beat של הרגע הראשון:
${patterns}

פתיחות שאסור לבחור:
${anti}

אם אף מועמד לא מתאים לאף סוג הוק — בחר את הרגע הקצר ביותר עם התנועה הכי
ברורה בתיאור החזותי. תנועה בלי דיבור עדיפה על דיבור בלי תנועה בפתיחה.`;
  },
};
