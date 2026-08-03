import type { Expert } from "./types";

/**
 * Speech disfluencies. A take full of these is usually the worse take, and
 * they are the first thing a human editor removes.
 *
 * Single source of truth: `lib/selection/heuristic.ts` scores against this,
 * and the deterministic filler-removal craft module (roadmap tasks #29/#30)
 * draws its word list from here rather than defining a second copy.
 */
export const HEBREW_FILLERS = [
  "אהה", "אמם", "כאילו", "יעני", "אה", "אמ", "אהמ", "בקיצור", "סוג של",
] as const;

export const ENGLISH_FILLERS = ["um", "uh", "like", "you know"] as const;

/**
 * Strips punctuation and Hebrew niqqud so "אהה," matches "אהה".
 *
 * Deliberately does NOT strip Hebrew prefix letters — "ואהה" is a real word
 * being mistranscribed, not a filler, and dropping the vav would delete it.
 *
 * Lives here rather than beside either caller because two very different
 * things need the *same* answer to "are these the same word": filler removal
 * (`lib/craft/fillers.ts`) and the script validator (`lib/script/validate.ts`),
 * which compares an agent's quoted text against the words actually spoken. If
 * those two ever disagreed, the validator would reject honest scripts over
 * punctuation.
 */
export function normaliseHebrewWord(word: string): string {
  return word
    .replace(/[֑-ׇ]/g, "")
    .replace(/[.,!?;:"'׳״\-–—…()]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Words that carry no topical signal, so matching on them makes every segment
 * look equally relevant to a brief.
 */
export const HEBREW_STOPWORDS = [
  "של", "את", "עם", "על", "אני", "אנחנו", "אתה", "הוא", "היא", "הם",
  "זה", "זאת", "יש", "אין", "לא", "כן", "גם", "רק", "אבל", "או",
  "כי", "אם", "מה", "מי", "איך", "כמה", "היום", "פה", "שם", "כל",
  "היה", "היתה", "להיות", "אז", "ואז", "ככה", "בעצם", "פשוט", "ממש",
] as const;

/**
 * Transcription failures observed on this project's own real footage, not
 * assumed. Domain nouns are the weak spot: "זעתר" was mangled differently
 * across ~6 clips and never once transcribed correctly by faster-whisper
 * large-v3, while ordinary conversational Hebrew came through well.
 */
export const KNOWN_TRANSCRIPTION_WEAKNESSES = [
  "שמות מוצרים ומונחים בוטניים/קולינריים ספציפיים (למשל \"זעתר\") — כמעט תמיד משובשים",
  "שמות פרטיים ושמות מקומות",
  "מספרים ומחירים בדיבור מהיר",
] as const;

export const hebrewExpert: Expert = {
  id: "hebrew",
  title: "מומחה עברית",
  summary:
    "מכיר את מבנה העברית (תחיליות, RTL) ואת נקודות הכשל המוכחות של התמלול המקומי על החומר של הפרויקט הזה.",
  stages: ["transcription", "selection"],
  worksWith: ["food-and-product", "qc"],
  sources: [
    "בדיקות אמיתיות על 38 קליפים מהפרויקט (ראה Volt/Decisions and Open Questions)",
    "CLAUDE.md — Open decisions resolved so far #1",
  ],

  promptSection(ctx) {
    if (ctx.stage !== "selection") return null;

    const weaknesses = KNOWN_TRANSCRIPTION_WEAKNESSES.map((w) => `- ${w}`).join("\n");

    return `## עברית — קרא את התמלול בזהירות

התמלול הופק מקומית ויש לו נקודות כשל ידועות:
${weaknesses}

לכן:
- **מילה שנראית שגויה או חסרת פשר היא כנראה שגיאת תמלול, לא ראיה שהרגע גרוע.**
  אל תפסול רגע בגלל מילה אחת מוזרה — תסתמך על שאר המשפט ועל התיאור החזותי.
- אם התיאור החזותי והתמלול סותרים זה את זה, **התיאור החזותי אמין יותר.**
- בעברית תחיליות (ו, ב, ל, כ, מ, ה, ש) נדבקות למילה. "ובעגבניות" ו"עגבניות"
  הם אותו נושא לצורך התאמה לבריף.
- אל תחתוך רגע באמצע מילה או באמצע צירוף סמיכות. גבול הרגע צריך ליפול בין
  משפטים או לפחות בין מילים שלמות.`;
  },
};
