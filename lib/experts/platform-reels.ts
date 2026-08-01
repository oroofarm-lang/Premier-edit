import type { Expert } from "./types";

/**
 * Covers Instagram Reels **and** TikTok together, because `OutputProfile` has
 * one short-vertical value (`REEL_SHORT`) and cannot currently tell them
 * apart. Where the two platforms genuinely diverge it is stated inline rather
 * than averaged away. Splitting this into two experts needs a new
 * OutputProfile value first — tracked in Volt/Decisions and Open Questions.
 */
export const platformReelsExpert: Expert = {
  id: "platform-reels",
  title: "מומחה ריל / טיקטוק",
  summary:
    "נורמות של וידאו אנכי קצר — חלון נטישה, אורכים שעובדים, ולופ שסוגר את הסרטון על עצמו.",
  stages: ["selection"],
  worksWith: ["hook", "pacing", "narrative-structure"],
  sources: [
    "https://blog.brandghost.ai/posts/instagram-reels-best-practices-for-creators/",
    "https://www.opus.pro/blog/instagram-reels-hook-formulas",
  ],

  promptSection(ctx) {
    if (ctx.stage !== "selection" || ctx.outputProfile !== "REEL_SHORT") {
      return null;
    }

    return `## פלטפורמה: ריל אנכי קצר (אינסטגרם / טיקטוק)

- **אורך**: 15-20 שניות עובד הכי טוב. הטווח 30-40 שניות הוא אזור נטישה —
  אם התוכן לא מחזיק 45+ שניות באמת, עדיף לקצר ל-20 מאשר לנחות בתוכו.
- **חלון ההחלטה**: הצופה מחליט תוך שנייה-שתיים ואפשר לגלול הלאה בלי מחיר.
  זה שונה מצפייה בפיד — אין "בוא ניתן לזה צ'אנס".
- **לופ**: הרגע האחרון והרגע הראשון משוחזרים ברצף כשהסרטון חוזר. אם אפשר
  לבחור סיום שמתחבר ויזואלית לפתיחה — זה מוסיף צפיות בלי עוד חומר.
- **בלי מילים זה תקין**: רגע ויזואלי חזק בלי דיבור עדיף על משפט בינוני. אל
  תעדיף רגע רק כי יש בו טקסט בתמלול.
- **אנכי**: העדף רגעים שהתיאור החזותי שלהם מרוכז במרכז הפריים. שוט רחב עם
  הנושא בצד ייחתך בקאדר האנכי.
- **טיקטוק מול אינסטגרם**: בטיקטוק פתיחה מדוברת וישירה עובדת טוב; באינסטגרם
  פתיחה ויזואלית שקטה עובדת טוב יותר. אם יש ספק — לך על הוויזואלי, הוא עובד
  סביר בשתיהן.`;
  },
};
