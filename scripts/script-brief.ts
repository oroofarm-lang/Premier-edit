import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { assembleExpertSections } from "@/lib/experts";
import { PROFILE_TARGET_SECONDS } from "@/lib/selection/types";
import { findSpeechRuns, MIN_REPORTABLE_RUN_SEC } from "@/lib/script/score";
import { parseSegments, toScriptSources } from "@/lib/script/sources";
import { MIN_LINE_SEC } from "@/lib/script/validate";

/**
 * Writes everything a writer needs to build a story out of one project's
 * footage, into a single file that can be read cold.
 *
 * The reason this is a file and not an API call: the Anthropic balance is
 * empty, so the writing is done by a Claude Code agent on the user's
 * subscription rather than by the app. The app's half of the deal is to hand
 * over a complete, unambiguous brief — and then to refuse anything that comes
 * back and does not check out (`lib/script/validate.ts`).
 *
 * Run: npm run script:brief -- "<project name or id>"
 */

const OUT_DIR = "scripts-out";

/** Filenames from Hebrew project names, without mangling them into nothing. */
function slug(name: string): string {
  return name.trim().replace(/[\s/\\]+/g, "-").replace(/[^\p{L}\p{N}-]/gu, "");
}

function formatSeconds(value: number): string {
  return value.toFixed(2);
}

async function main() {
  const query = process.argv[2];
  if (!query) {
    console.error('Usage: npm run script:brief -- "<project name or id>"');
    process.exit(1);
  }

  const project = await prisma.project.findFirst({
    where: { OR: [{ id: query }, { name: { contains: query } }] },
  });
  if (!project) {
    console.error(`No project matching "${query}".`);
    process.exit(1);
  }

  const assets = await prisma.mediaAsset.findMany({
    where: { projectId: project.id },
    include: { transcript: true },
    orderBy: { filePath: "asc" },
  });

  const sources = toScriptSources(
    assets.map((a) => ({
      id: a.id,
      filePath: a.filePath,
      segmentsJson: a.transcript?.segmentsJson ?? null,
    })),
  );
  if (sources.length === 0) {
    console.error(
      "No clip in this project has word-level transcript timings. " +
        "Run transcription first — the script layer cannot verify a line without them.",
    );
    process.exit(1);
  }

  const targetDurationSec = PROFILE_TARGET_SECONDS[project.outputProfile];
  const experts = assembleExpertSections({
    stage: "selection",
    outputProfile: project.outputProfile,
    targetDurationSec,
  });

  // Segment text per asset, so the writer reads sentences rather than a wall
  // of words — and the word grid underneath, so it can cut inside one.
  const segmentsByAsset = new Map(
    assets.map((a) => [a.id, parseSegments(a.transcript?.segmentsJson ?? null)]),
  );

  const totalWords = sources.reduce((n, s) => n + s.words.length, 0);

  const lines: string[] = [];
  lines.push(`# תסריט עבור: ${project.name}`);
  lines.push("");
  lines.push(`- **פרופיל:** ${project.outputProfile}`);
  lines.push(`- **אורך מטרה:** ${targetDurationSec} שניות`);
  lines.push(`- **בריף המשתמש:** ${project.brief?.trim() || "(לא נכתב)"}`);
  lines.push(`- **חומר גלם:** ${sources.length} קליפים עם דיבור, ${totalWords} מילים בסך הכל`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## מה שצריך לכתוב");
  lines.push("");
  lines.push(
    "בנה סיפור מהמילים שנאמרו בפועל. אתה בוחר אילו מילים נשמעות, באיזה סדר, ומה נזרק.",
  );
  lines.push("");
  lines.push("**מה מותר:**");
  lines.push("- לסדר מחדש — השורה האחרונה בהקלטה יכולה להיות הראשונה בסרטון.");
  lines.push("- לקחת מאותו קליפ כמה פעמים, כל עוד הקטעים לא חופפים.");
  lines.push("");
  lines.push("**הכלל שקובע יותר מכולם: שורה היא ריצה אחת רצופה ושלמה של דיבור.**");
  lines.push("");
  lines.push(
    "הבריף הזה נהג לומר שחיתוך באמצע משפט \"הוא כל העניין\". זה היה **שגוי**, והמשתמש דחה את " +
      "התוצאה במפורש: *\"המילים פשוט לא מתחברות\"*. הפיצול ייצר `הרכיב הראשון,` — רכיב שמוכרז " +
      "ולעולם לא נקרא בשמו — ושורה שכולה `תמסוג`, שנתלשה מה-`יאללה` שלה.",
  );
  lines.push("");
  lines.push("- **פחות חיתוכים זה יתרון.** אותן מילים בשורה אחת ארוכה עדיפות על אותן מילים מפוצלות.");
  lines.push(
    "- **הפסקות זה בסדר** — *\"לא אכפת לי שיש רגעים של שקט\"*. אל תפצל כדי להדק.",
  );
  lines.push(
    "- **פסוקית שצריכה את ההקדמה שלה שומרת עליה.** `אבל פה זה צמח מדברי` לא יכולה לפתוח שורה — " +
      "ה-`אבל` עונה ל-`כולנו יודעים ש…` שכבר לא נמצא שם.",
  );
  lines.push(
    "- חתוך באמצע משפט רק כשאתה יכול לנסח מה זה קונה. יש תזמון לכל מילה, אז זה **אפשרי** — " +
      "זה פשוט כמעט תמיד לא נכון.",
  );
  lines.push("");
  lines.push(
    "**קרא את התסריט בקול כפסקה אחת לפני שאתה מדווח.** הוולידטור מוכיח שכל מילה נאמרה באמת; " +
      "רק קריאה תופסת עברית שבורה בתפר או כינוי גוף בלי מה שהוא מחליף.",
  );
  lines.push("");
  lines.push("**מה אסור, ונדחה אוטומטית:**");
  lines.push(
    "- **להמציא מילים.** ה-`text` של כל שורה נבדק מול המילים שבאמת נאמרו בטווח הזמן הזה. " +
      "משפט יפה יותר שלא נאמר — נדחה, והתסריט כולו לא נכנס.",
  );
  lines.push(`- שורה קצרה מ-${MIN_LINE_SEC} שניות.`);
  lines.push("- שני קטעים חופפים מאותו קליפ.");
  lines.push("");
  lines.push("## פורמט הפלט");
  lines.push("");
  lines.push(`כתוב JSON לקובץ \`${OUT_DIR}/${slug(project.name)}-script.json\`:`);
  lines.push("");
  lines.push("```json");
  lines.push(
    JSON.stringify(
      {
        premise: "משפט אחד: על מה הסרטון",
        beats: ["הוק", "גוף", "סיום"],
        lines: [
          {
            order: 0,
            mediaAssetId: sources[0].mediaAssetId,
            startSec: sources[0].words[0].startSec,
            endSec: sources[0].words[Math.min(2, sources[0].words.length - 1)].endSec,
            text: sources[0].words.slice(0, 3).map((w) => w.word).join(" "),
            reason: "למה השורה הזו פותחת",
          },
        ],
      },
      null,
      2,
    ),
  );
  lines.push("```");
  lines.push("");
  lines.push("`order` מתחיל ב-0 ורץ ברצף. `startSec`/`endSec` הם זמנים **בתוך קובץ המקור**.");
  lines.push("");

  if (experts.trim().length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## ידע מקצועי לפרופיל הזה");
    lines.push("");
    lines.push(experts);
    lines.push("");
  }

  // The takes, before the transcript. This section exists because reading a
  // printed transcript makes an unbroken take look like several sentences —
  // and on this project's own footage three separate writers each took half of
  // the same 12.82s run without any of them reporting that the whole thing was
  // there. Arithmetic sees it; prose does not. Putting it first is the point:
  // the failure was never a lack of care, it was a lack of visibility.
  const takesByAsset = new Map(
    sources.map((s) => [s.mediaAssetId, findSpeechRuns(s)]),
  );
  const longTakes = [...takesByAsset.values()]
    .flat()
    .filter((r) => r.durationSec >= MIN_REPORTABLE_RUN_SEC)
    .sort((a, b) => b.durationSec - a.durationSec);

  if (longTakes.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## טייקים רצופים — קרא את זה לפני התמלול המלא");
    lines.push("");
    lines.push(
      `כל אחד מאלה הוא **ריצה אחת בלי הפסקה ארוכה מ-4 שניות**. לקחת אחד מהם בשלמותו ` +
        `עולה **חיתוך אחד** — וזו בדיוק הצורה שהכלל למעלה מבקש.`,
    );
    lines.push("");
    lines.push(
      "אל תסיק את הגבולות האלה מהתמלול שלמטה. בטקסט מודפס ריצה רצופה נראית כמו כמה " +
        "משפטים נפרדים, ובדיוק ככה שלושה כותבים שונים לקחו כל אחד חצי מאותו טייק של " +
        "12.82 שניות בלי שאף אחד מהם ראה שהוא קיים במלואו.",
    );
    lines.push("");

    for (const take of longTakes) {
      lines.push(
        `- **${take.fileName}  ${formatSeconds(take.startSec)}–${formatSeconds(take.endSec)}s** ` +
          `(${formatSeconds(take.durationSec)}s) — \`${take.mediaAssetId}\``,
      );
      lines.push(`  > ${take.text}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## כל מה שנאמר");
  lines.push("");
  lines.push(
    "לכל קליפ: המשפטים כפי שתומללו, ומתחת רשת המילים עם התזמון המדויק של כל מילה.",
  );
  lines.push("");

  for (const source of sources) {
    lines.push(`### ${source.fileName}`);
    lines.push("");
    lines.push(`\`mediaAssetId\`: \`${source.mediaAssetId}\``);
    lines.push("");

    const segments = segmentsByAsset.get(source.mediaAssetId) ?? [];
    for (const segment of segments) {
      const text = segment.text.trim();
      if (!text) continue;
      lines.push(
        `- **${formatSeconds(segment.startSec)}–${formatSeconds(segment.endSec)}s** — ${text}`,
      );
    }
    lines.push("");
    lines.push("<details><summary>תזמון מילים</summary>");
    lines.push("");
    lines.push("```");
    for (const w of source.words) {
      lines.push(`${formatSeconds(w.startSec)}–${formatSeconds(w.endSec)}  ${w.word}`);
    }
    lines.push("```");
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  await mkdir(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${slug(project.name)}-brief.md`);
  await writeFile(outPath, lines.join("\n"), "utf8");

  console.log(`Brief written to ${outPath}`);
  console.log(
    `  ${project.name} · ${project.outputProfile} · target ${targetDurationSec}s · ` +
      `${sources.length} clip(s), ${totalWords} words`,
  );

  await prisma.$disconnect();
}

main();
