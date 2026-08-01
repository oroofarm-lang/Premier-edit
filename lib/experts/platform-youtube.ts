import type { Expert } from "./types";

/**
 * Long-form (`YOUTUBE_LONG`). The one profile where the short-form rules are
 * actively wrong: the old single guidelines blob told the model to target
 * 15-20s and avoid 30-40s even when the target duration was several minutes.
 * That is the concrete defect this expert's existence fixes.
 */
export const platformYoutubeExpert: Expert = {
  id: "platform-youtube",
  title: "מומחה יוטיוב ארוך",
  summary:
    "נורמות של תוכן ארוך — נשימה, שימור צופים לאורך זמן, ומבנה שמחזיק כמה דקות ולא כמה שניות.",
  stages: ["selection"],
  worksWith: ["pacing", "narrative-structure"],
  sources: ["docs/superpowers/specs/2026-07-30-editing-quality-design.md"],

  promptSection(ctx) {
    if (ctx.stage !== "selection" || ctx.outputProfile !== "YOUTUBE_LONG") {
      return null;
    }

    return `## פלטפורמה: תוכן ארוך

**שים לב — כללי הריל הקצר לא חלים כאן.** אל תכוון ל-15-20 שניות, ואל תימנע
מרגעים ארוכים. היעד הוא ${ctx.targetDurationSec} שניות ובנייה שמחזיקה לאורכן.

- **נשימה**: רגעים של 5-12 שניות תקינים ורצויים. חיתוך כל 2 שניות לאורך כמה
  דקות מתיש ומרגיש כמו פרסומת, לא כמו תוכן.
- **הצופה כאן בחר לצפות**: הוא לא גולל, הוא לחץ. אפשר להתחיל בפתיחה קרה של
  10-15 שניות שמייצרת עניין ואז לתת הקשר — זה לא "פתיחה איטית", זה מבנה.
- **הכישלון האמיתי הוא חזרתיות**: בסרטון ארוך יש מספיק חומר גלם לכלול שני
  רגעים שאומרים כמעט אותו דבר. אל תעשה את זה. עדיף פחות רגעים עם התקדמות
  ברורה מאשר כיסוי מלא של כל מה שנאמר.
- **סגירה**: סיכום או רפלקציה בסוף. לא לחתוך באמצע הסבר.`;
  },
};
