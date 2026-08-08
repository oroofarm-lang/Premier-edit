import type { Expert } from "./types";

/**
 * The mid-length social post (`SOCIAL_POST`) — a feed video that has to earn
 * ~45-60 seconds rather than survive a 2-second swipe. Its failure mode is the
 * opposite of a reel's: not "too slow to hook" but "hooked and then wandered".
 */
export const platformFeedExpert: Expert = {
  id: "platform-feed",
  title: "מומחה פוסט פיד",
  summary:
    "נורמות של סרטון פיד באורך בינוני — מחזיק תשומת לב לאורך זמן, עם התקדמות שנשארת ברורה.",
  stages: ["selection"],
  worksWith: ["hook", "pacing", "narrative-structure", "food-and-product"],
  sources: [
    "https://blog.brandghost.ai/posts/instagram-reels-best-practices-for-creators/",
    "https://aibrify.com/blog/short-form-video-editing-captions-b-roll-guide",
  ],

  promptSection(ctx) {
    if (ctx.stage !== "selection" || ctx.outputProfile !== "SOCIAL_POST") {
      return null;
    }

    return `## פלטפורמה: פוסט פיד (45-60 שניות)

- **אורך**: 45-60 שניות. זה סרטון שמסביר או מלמד משהו, לא רק מרשים.
- **הפורמט הזה מת מהאמצע, לא מההתחלה**: ההוק עדיין חייב, אבל הכישלון האמיתי
  הוא רגעים 3-6 — שם הצופה מבין אם יש התקדמות או שרק ממשיכים לדבר. כל רגע
  חייב להוסיף מידע חדש. שני רגעים שאומרים את אותו דבר במילים אחרות = לחתוך
  את החלש מביניהם.
- **התקדמות גלויה**: הצופה צריך להרגיש שהוא בשלב 2 מתוך 4, לא במקום אקראי.
  רגעים שמסמנים מעבר (התחלה של פעולה חדשה, שינוי מקום, שינוי בתוצאה) שווים
  יותר מרגעים שמעמיקים באותו שלב.
- **סיום ממשי**: כאן, בניגוד לריל, הצופה שהגיע לסוף מצפה לסגירה — תוצאה,
  מסקנה, או קריאה לפעולה. סיום באמצע נושא הורס את כל הצפייה שקדמה לו.
- **אפשר להאריך רגע חזק**: 5-6 שניות על רגע שבאמת נושא מידע זה תקין כאן,
  בניגוד לריל.`;
  },
};
