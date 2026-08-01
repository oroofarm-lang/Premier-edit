import type { Expert } from "./types";

/**
 * The video layer's editorial judgment, as distinct from the shot
 * catalogue's arithmetic. `lib/shots/` decides which spans are *usable*;
 * this decides which usable span belongs over which moment.
 *
 * Every rule here traces to something the user said while reviewing real
 * output, not to general film theory:
 *
 * - "twenty shots of the same table — which do you take" → complete camera
 *   movement and steadiness, which the catalogue already scores.
 * - "you kept cutting off the thing before the movement… I want to catch how
 *   he pours from the pot to the glass" → an action must be shown whole.
 * - "keep the speaker's picture only when the shot is good" → sync is a
 *   per-moment decision, not a policy.
 * - "change by meaning, not by a fixed rhythm" → no cadence rule.
 */
export const cinematographyExpert: Expert = {
  id: "cinematography",
  title: "מומחה שפה חזותית",
  summary:
    "מחליט איזה שוט מולבש על איזה רגע — מראה את מה שמתואר במקום את מי שמתאר, ושומר על פעולות שלמות.",
  stages: ["cut"],
  worksWith: ["pacing", "framing", "food-and-product", "premiere-craft"],
  sources: [
    "משוב המשתמש על הקטלוג הראשון (2026-08-01)",
    "docs/superpowers/specs/2026-08-01-two-timeline-audio-spine-design.md",
  ],

  promptSection(ctx) {
    if (ctx.stage !== "cut") return null;

    return `## שפה חזותית

**הכלל הראשון: תראה את מה שמתואר, לא את מי שמתאר.** אם הקול אומר "אנחנו
מוסיפים מרווה", השוט הנכון הוא היד ששמה את המרווה — לא פנים שמדברות. פנים
מדברות הן ברירת מחדל עצלה, וזו בדיוק הסיבה ששכבת הוידאו נפרדת מפס האודיו.

**פעולה מוצגת בשלמותה.** אם בחרת שוט של מזיגה, תן לו את הזמן שהמזיגה
דורשת — לא לחתוך באמצע השפיכה ולא להיכנס אחרי שהיא כבר קרתה. שוט עם
"תנועה שלמה" גבוהה הוא בדיוק שוט שהפעולה בו מתחילה ונגמרת; זו הסיבה
להעדיף אותו.

**שוט מיצה את עצמו כשאין בו התפתחות חדשה.** רגע שבו כבר ראינו את מה שיש
לראות הוא הרגע להחליף — לא אחרי מספר שניות קבוע.

**הדובר על המסך הוא החלטה נקודתית.** תן לו להופיע כשהשוט שלו באמת טוב,
או כשחשוב לעגן מי מדבר. בכל שאר המקרים — תכסה.

**גיוון בין מקורות.** שני שוטים רצופים מאותו קובץ ובאותו גודל ייראו כמו
טעות עריכה. אם הם חייבים להיות רצופים, שיהיה ביניהם שינוי ויזואלי ברור.

**אל תבחר שוט רק כי הוא יפה.** שוט יפה שבו לא קורה כלום נחות משוט סביר
שבו קורה משהו. הציון "פעילות" ברשימה הוא בדיוק המדד הזה.`;
  },
};
