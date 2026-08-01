import type { Expert } from "./types";

/**
 * Shot-type vocabulary the vision pass is asked to use. A closed vocabulary
 * matters because `llm-selector.ts` branches on the `close-up` / `medium`
 * values when deciding whether a moment is a B-roll override candidate — free
 * text there would silently stop that rule from ever firing.
 */
export const SHOT_TYPES = [
  "close-up",
  "medium",
  "wide",
  "detail",
  "over-the-shoulder",
  "pov",
] as const;

export type ShotType = (typeof SHOT_TYPES)[number];

export const framingExpert: Expert = {
  id: "framing",
  title: "מומחה קומפוזיציה",
  summary:
    "מגדיר את אוצר המילים של סוגי הצילום ומה נחשב שוט שאפשר להשתמש בו — מזין את שלב הראייה.",
  stages: ["vision"],
  worksWith: ["food-and-product", "platform-reels", "cinematography"],
  sources: ["lib/vision/claude-vision.ts", "lib/selection/llm-selector.ts"],

  promptSection(ctx) {
    if (ctx.stage !== "vision") return null;

    return `## קומפוזיציה — איך לתאר את הפריים

סוג הצילום חייב להיות בדיוק אחד מהערכים האלה: ${SHOT_TYPES.join(", ")}.
אל תמציא ערך אחר — יש קוד שמסתמך על הערכים האלה בדיוק.

בתיאור, ציין גם אם רלוונטי:
- **תנועה**: האם קורה משהו בפריים (ידיים עובדות, מזיגה, הליכה) או שזה סטטי.
  רגע עם תנועה שווה יותר לעריכה מרגע סטטי באותו נושא.
- **נושא במרכז**: האם הנושא מרוכז או בצד. שוט רחב עם הנושא בצד לא שורד
  קאדר אנכי.
- **בעיות**: פוקוס רך, חשיפה שרופה, מישהו חוצה את הפריים, מצלמה רועדת.
  ציין אותן — עדיף לדעת מראש שרגע לא שמיש.`;
  },
};
