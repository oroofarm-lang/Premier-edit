import type { Expert } from "./types";

/**
 * Why a video travels, which is not the same as why it is watched.
 *
 * Every other expert in this roster optimises for attention — hook, retention,
 * pacing. None of them ask what makes a viewer *do something* at the end. That
 * matters because watch time alone does not distribute a video: a save or a
 * share is a stronger signal than a completed view, and the two come from
 * different motivations that need different endings.
 *
 * Researched 2026-08-03:
 * https://skyhoora.com/social-media-saves-shares-dms-2026/
 * https://marketingagent.blog/2026/01/06/tiktok-saves-in-2026-the-high-intent-signal-that-quietly-trains-the-algorithm/
 * https://quso.ai/blog/youtube-shorts-algorithm
 * https://www.opus.pro/blog/short-form-video-trends-reshaping-creator-marketing-2026
 *
 * Aggregated creator and marketing-industry consensus, **not** platform-
 * published data. Informed defaults, not guarantees — the same caveat the
 * rest of the roster carries.
 *
 * **This expert cannot manufacture what the footage does not contain.** It
 * decides which of the available endings to reach for; if the material has no
 * useful takeaway and nothing surprising, the honest answer is a clean ending
 * rather than a bolted-on call to action.
 */

/** What a viewer has to feel for each action, and what an ending must carry. */
const SPREAD_MOTIVES = [
  {
    action: "שמירה",
    why: "'אני ארצה את זה שוב' — הצופה מתכוון לחזור",
    needs:
      "משהו שאפשר להשתמש בו: מתכון, רשימת רכיבים, שיטה, יחס מדויק. " +
      "ידע שאפשר ליישם, לא רק להתפעל ממנו",
  },
  {
    action: "שיתוף",
    why: "'זה אומר משהו עליי' או 'חבר ספציפי צריך לראות את זה'",
    needs:
      "משהו מפתיע, מצחיק, או שמחמיא למי שמשתף אותו. " +
      "עובדה שרוב האנשים לא יודעים היא סיבה טובה לשתף",
  },
  {
    action: "תגובה",
    why: "'יש לי מה להגיד על זה'",
    needs: "עמדה, שאלה פתוחה, או משהו שאפשר לחלוק עליו",
  },
] as const;

export const shareabilityExpert: Expert = {
  id: "shareability",
  title: "מומחה תפוצה",
  summary:
    "אחראי על מה שקורה בסוף — האם הצופה שומר, משתף, או גולל הלאה. שמירה ושיתוף נובעים ממניעים שונים ודורשים סיומים שונים.",
  stages: ["selection"],
  worksWith: ["retention", "narrative-structure", "hook", "food-and-product"],
  sources: [
    "https://skyhoora.com/social-media-saves-shares-dms-2026/",
    "https://marketingagent.blog/2026/01/06/tiktok-saves-in-2026-the-high-intent-signal-that-quietly-trains-the-algorithm/",
    "https://quso.ai/blog/youtube-shorts-algorithm",
    "https://www.opus.pro/blog/short-form-video-trends-reshaping-creator-marketing-2026",
  ],

  promptSection(ctx) {
    if (ctx.stage !== "selection") return null;

    const motives = SPREAD_MOTIVES.map(
      (m) => `- **${m.action}** — "${m.why}". דורש: ${m.needs}.`,
    ).join("\n");

    return `## תפוצה — למה שמישהו יעביר את זה הלאה

צפייה מלאה היא לא המדד היחיד. **שמירה ושיתוף הם אותות חזקים יותר מצפייה**,
והם באים ממניעים שונים — אז הסיום צריך לכוון לאחד מהם, לא לשניהם.

${motives}

**החלט לאיזה מהם אתה הולך, והפנה את הסיום לשם.** בתוכן של אוכל ומוצר,
שמירה היא בדרך כלל הריאלית: מי שרואה חליטת עשבים ורוצה להכין אותה בעצמו
ישמור. זה אומר שהרכיבים בשמותיהם שווים יותר מאמירה כללית על טעם.

**עובדה שרוב האנשים לא יודעים היא הדבר הכי משותף שיש.** אם יש בחומר משפט
אחד כזה — הוא לא שייך לאמצע. או שהוא ההוק, או שהוא הסיום.

**ואם אין:** אל תמציא. סיום נקי עדיף על קריאה לפעולה מודבקת שאין לה כיסוי
בחומר — היא נשמעת כמו פרסומת, וזה בדיוק מה שגורם לגלול הלאה.`;
  },
};
