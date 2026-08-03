import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { assembleExpertSections } from "@/lib/experts";
import { PROFILE_TARGET_SECONDS } from "@/lib/selection/types";
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
  lines.push("- לחתוך באמצע משפט. יש תזמון לכל מילה, אז אפשר לקחת חצי משפט בלבד.");
  lines.push("- לקחת מאותו קליפ כמה פעמים, כל עוד הקטעים לא חופפים.");
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
