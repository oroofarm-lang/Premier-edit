import type { Expert } from "./types";

/**
 * The actual MVP niche — restaurant and product content. CLAUDE.md scopes the
 * MVP to exactly this, so it earns a dedicated expert rather than being left
 * as generic "social video" knowledge.
 */
export const foodAndProductExpert: Expert = {
  id: "food-and-product",
  title: "מומחה אוכל ומוצר",
  summary:
    "יודע אילו רגעים מוכרים מנה או מוצר — הרגע שבו זה נראה הכי טוב, ולא הרגע שבו מדברים עליו.",
  stages: ["vision", "selection"],
  worksWith: ["framing", "platform-feed", "hebrew"],
  sources: ["CLAUDE.md — MVP scope: social media content only"],

  promptSection(ctx) {
    if (ctx.stage === "vision") {
      return `## אוכל ומוצר — מה חשוב לתאר

זה תוכן של מסעדות/מוצרים. בתיאור החזותי ציין במפורש אם רואים:
- מנה/מוצר מוגמר ומוגש
- שלב הכנה (חיתוך, ערבוב, טיגון, מזיגה) — וגם איזה שלב
- מרקם או קיטור/נזילות שנראים בפריים
- אדם שאוכל/משתמש במוצר, ותגובה שלו
- המקום עצמו (מטבח, שדה, חנות)`;
    }

    if (ctx.stage !== "selection") return null;

    return `## אוכל ומוצר — מה באמת מוכר

- **הרגע שבו זה נראה הכי טוב מנצח את הרגע שבו מדברים על זה.** אם יש שוט של
  המנה המוגמרת ושוט של מישהו מסביר כמה היא טובה — השוט של המנה חזק יותר.
  הדיבור יכול לרוץ מעליו (זה בדיוק המקרה של videoFrom).
- **תהליך מחזיק צופים**: חיתוך, מזיגה, ערבוב, קיטור. גם בלי מילים.
- **תגובה אנושית סוגרת**: מישהו טועם ומגיב זה סיום חזק במיוחד.
- **אל תבחר שני שוטים של אותה מנה באותו שלב.** זה נראה כמו טעות עריכה גם
  אם שניהם יפים.
- אם יש בחומר גם מקום/הקשר (השדה, המטבח, החנות) — רגע אחד כזה בונה אמינות.
  יותר מאחד זה כבר סרטון תדמית, לא סרטון מוצר.`;
  },
};
