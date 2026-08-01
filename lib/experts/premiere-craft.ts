import type { Expert } from "./types";

/**
 * What the Premiere execution layer can actually do, verified against the real
 * `@adobe/premierepro` v26.3.0 type definitions and against builds run into a
 * live Premiere — not against the API docs alone, which have been wrong twice
 * (see CLAUDE.md, Premiere Integration).
 *
 * This expert **guards** the automation boundary rather than expanding it. The
 * request for a "Premiere expert that does fades, effects and colour" was
 * deliberately scoped down: those stay the editor's own work, and the value
 * this expert adds is telling the rest of the system what it must not assume.
 */
export const PREMIERE_CAPABILITIES = {
  supported: [
    "יצירת סיקוונס חדש ופתיחתו",
    "ייבוא קבצי מקור חסרים לפרויקט",
    "הצבת קליפ בטריים מדויק על טראק וידאו ואודיו",
    "in/out points לפי frame דרך ClipProjectItem.cast()",
    "וידאו של קליפ אחד מעל אודיו של קליפ אחר (B-roll)",
    "הכל בתוך transaction אחד — undo יחיד",
  ],
  unsupported: [
    "קרוס-פייד אודיו — אין API לזה ב-UXP כלל (רק נתיב ה-FCP7 XML נותן את זה)",
    "תיקוני צבע ו-Lumetri",
    "אפקטים ו-transitions מעבר לוידאו בסיסי",
    "כתוביות מוטבעות",
    "מיקס אודיו סופי",
  ],
  manual: [
    "צבע",
    "מיקס",
    "כתוביות",
    "גרפיקה",
    "פיינטיונינג של נקודות חיתוך",
  ],
} as const;

export const premiereCraftExpert: Expert = {
  id: "premiere-craft",
  title: "מומחה פרמיר",
  summary:
    "יודע מה שכבת הביצוע בפרמיר באמת יכולה לעשות ומה נשאר ידני — ושומר על גבול האוטומציה במקום להרחיב אותו.",
  stages: ["selection", "execution"],
  worksWith: ["qc", "pacing", "cinematography"],
  sources: [
    "@adobe/premierepro v26.3.0 .d.ts",
    "https://github.com/AdobeDocs/uxp-premiere-pro-samples",
    "CLAUDE.md — Premiere Integration",
  ],

  promptSection(ctx) {
    if (ctx.stage !== "selection") return null;

    // The selector needs exactly one fact from this expert: every join is a
    // hard cut. A moment that only reads well with a dissolve or an audio
    // fade will not get one, so it must not be chosen on that assumption.
    return `## מה שכבת הביצוע יכולה

כל מעבר בין רגעים הוא **חיתוך קשה** — אין דיזולב, אין פייד אודיו, אין
transitions. תבחר רגעים שעובדים בחיתוך יבש:
- רגע שמתחיל באמצע נשימה או באמצע תנועה יישמע קטוע. העדף התחלה נקייה.
- שני רגעים רצופים מאותו מקום ובאותו גודל צילום ייראו כמו "קפיצה" (jump cut).
  אם אתה שם אותם ברצף, שיהיה ביניהם שינוי ויזואלי ברור.
- אל תסתמך על דעיכה בסוף. הרגע האחרון חייב להיגמר בעצמו.`;
  },
};
