import type { Expert } from "./types";

/**
 * The middle of the video — the part every other expert skips.
 *
 * `hook` owns the first three seconds and `narrative-structure` owns the shape,
 * but between them nothing answered "why is anyone still watching at second
 * eight". That gap showed up as a real complaint about this project's output:
 * the cut was informative, correct, and a walkthrough. The user's words were
 * that the content "broke" — it did not hold together as something worth
 * staying for.
 *
 * Researched 2026-08-03. The finding that names the defect exactly: a flat
 * middle that **explains instead of unfolding** produces a drop-off cliff
 * around seconds 5-8, after the hook has already done its job. Sources:
 * https://www.selfstorming.com/tools/libraries/frameworks/hook-retain-reward
 * https://www.socialync.io/blog/short-form-video-structure-guide-2026
 * https://www.opus.pro/blog/tiktok-length-format-retention-data
 * https://hypenest.ai/blogs/tiktok-algorithm-2026-video-hooks-retention
 *
 * Aggregated creator and marketing-industry consensus, **not** platform-
 * published data — informed defaults for a prompt, not guarantees. Same
 * caveat as the rest of the roster.
 */

/** Where attention is lost once the hook has already worked. */
export const DROP_OFF_WINDOW_SEC = { from: 5, to: 8 } as const;

/**
 * Ways to keep a question alive across the middle. Each is stated as
 * something to look for in a real transcript, not as advice — the writer is
 * choosing between sentences that already exist and cannot script a new one.
 */
const RETENTION_DEVICES = [
  {
    name: "לולאה פתוחה",
    what: "שאלה נשאלת מוקדם והתשובה מגיעה בסוף",
    lookFor:
      "משפט שאלה, או אמירה שמבטיחה משהו ('אני אראה לך', 'תכף תבינו') — " +
      "ואז רגע אחר בהמשך שעונה עליה",
  },
  {
    name: "הסלמה",
    what: "כל שורה מוסיפה משהו גדול יותר מקודמתה, לא עוד אחת באותו גובה",
    lookFor: "שורות שאפשר לסדר לפי עוצמה — הקטן קודם, החזק אחריו",
  },
  {
    name: "ניגוד",
    what: "'ככה חשבת, אבל בעצם' — שינוי כיוון בתוך הסרטון",
    lookFor: "'אבל', 'בעצם', 'דווקא', 'לא' — מילות פנייה בתוך התמלול",
  },
  {
    name: "פרט קונקרטי",
    what: "מספר, שם, או פרט חושי שאי אפשר להמציא",
    lookFor: "שמות ספציפיים, מספרים, מקומות — לא 'כמה' ו'הרבה'",
  },
] as const;

export const retentionExpert: Expert = {
  id: "retention",
  title: "מומחה החזקה",
  summary:
    "אחראי על האמצע — למה מישהו עדיין צופה בשנייה השמינית, ואיך שורות נבחרות כך שהסרטון נפרש במקום להסביר.",
  stages: ["selection"],
  worksWith: ["hook", "narrative-structure", "pacing", "shareability"],
  sources: [
    "https://www.selfstorming.com/tools/libraries/frameworks/hook-retain-reward",
    "https://www.socialync.io/blog/short-form-video-structure-guide-2026",
    "https://www.opus.pro/blog/tiktok-length-format-retention-data",
    "https://hypenest.ai/blogs/tiktok-algorithm-2026-video-hooks-retention",
  ],

  promptSection(ctx) {
    if (ctx.stage !== "selection") return null;
    // The middle only exists once there is one. A very short cut is hook and
    // payoff with nothing between, and this advice would just add noise.
    if (ctx.targetDurationSec < 15) return null;

    const devices = RETENTION_DEVICES.map(
      (d) => `- **${d.name}** — ${d.what}. חפש: ${d.lookFor}.`,
    ).join("\n");

    return `## החזקה — האמצע

ההוק קונה שלוש שניות. את מה שבא אחריהן צריך להרוויח.

**הכישלון הנפוץ, וזה מה שקורה כאן הכי הרבה:** אמצע שטוח ש**מסביר במקום
להיפרש**. הסרטון נכון, מדויק, ומשעמם — הצופה נושר בסביבות שניות
${DROP_OFF_WINDOW_SEC.from}-${DROP_OFF_WINDOW_SEC.to}, אחרי שההוק כבר עבד.
סקירה כרונולוגית של תהליך היא בדיוק הצורה הזו.

ההבדל בפועל: **"קודם זה ואז זה ואז זה" מול "זה — אבל".** אם אפשר לתאר את
הקאט כרשימה, האמצע שטוח.

ארבע דרכים להחזיק, כולן דברים שמחפשים בתמלול הקיים:
${devices}

שלושה כללים על האמצע:
1. **שורה שלא מוסיפה — יורדת.** אם אפשר להסיר שורה והסיפור לא נפגע, היא
   מזיקה: היא לוקחת שניות ולא נותנת סיבה להישאר.
2. **אל תענה על השאלה של ההוק מיד.** אם הפתיחה שואלת משהו, התשובה המלאה
   שייכת לסוף. זה מה שמחזיק צפייה עד הסוף במקום עד האמצע.
3. **קונקרטי מנצח כללי, תמיד.** שם של צמח עדיף על "עשבים". "מותאם לקרקע
   בנגב" עדיף על "מיוחד". אם יש שתי שורות שאומרות אותו דבר, קח את זו עם
   הפרט שאי אפשר להמציא.`;
  },
};
