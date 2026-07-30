/**
 * Short-form social video editing heuristics, researched 2026-07-30 for the
 * LLM-backed content selector. These are aggregated industry consensus from
 * creator/marketing sources (see CLAUDE.md for links) — NOT Meta's own
 * published algorithm data, which isn't public. Treat as informed defaults
 * to prompt against, not guarantees, and revisit if real posted results
 * later disagree with them.
 */
export const SOCIAL_EDITING_GUIDELINES = `
כללי עריכה לתוכן קצר ברשתות חברתיות (ריל/סושיאל), על בסיס נורמות מקובלות בתעשייה:

1. הוק (שניות ראשונות): חייב לתפוס תוך כ-1-3 שניות. אסור פתיחה איטית, "היי מה
   קורה", הצגות עצמיות, או הקדמות. תתחיל ישר ברגע הכי מעניין/ויזואלי/מפתיע.
2. אורך: 15-20 שניות (תוכן מהיר ומשעשע) או 45-60 שניות (תוכן שמסביר/מלמד).
   להימנע מ-30-40 שניות — טווח שבו יש נטייה לנטישה באמצע.
3. קצב חיתוכים: שינוי ויזואלי בערך כל 1.5-2.5 שניות בממוצע. פחות מזה מרגיש
   איטי מדי; הרבה יותר צפוף מזה (חיתוך כל פחות משנייה) מרגיש רועש ומבלבל.
4. מבנה: הוק -> גוף (הקשר/תהליך/פרטים) -> פאנץ' או תוצאה בסוף. לא רק רצף
   מקרי של רגעים — צריך שיהיה סדר שמספר משהו, גם אם קצר וגם אם בלי מילים.
5. גיוון מקורות: להעדיף לדגום ממגוון קליפים שונים על פני חיתוך חוזר מאותו
   קליפ ארוך, אלא אם יש סיבה נרטיבית ספציפית לכך.
`.trim();
