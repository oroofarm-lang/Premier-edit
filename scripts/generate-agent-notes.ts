/**
 * Generates one Obsidian note per expert from the real `lib/experts` registry,
 * plus an index note.
 *
 * The point of generating rather than hand-writing these is that the link map
 * cannot drift from the code: `worksWith` is unit-tested to only reference
 * experts that exist, so every wikilink here resolves. Hand-maintained notes
 * would go stale the first time an expert was renamed.
 *
 * The vault lives on `main` and the code on `stage2-panel` (see
 * "Where docs and code each live" in Volt/Decisions and Open Questions), so
 * this writes across checkouts by default rather than into the worktree's own
 * frozen copy of Volt/.
 *
 *   npm run generate:agent-notes [-- <vault-Agents-dir>]
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { EXPERTS, expertsForStage } from "../lib/experts/index";
import type { Expert, PipelineStage } from "../lib/experts/types";

const DEFAULT_VAULT_AGENTS = resolve(
  import.meta.dirname,
  "../../../Volt/Agents",
);

const STAGE_LABELS: Record<PipelineStage, string> = {
  transcription: "תמלול",
  vision: "ראייה",
  selection: "בחירת תוכן",
  cut: "חיתוך",
  qc: "בקרת איכות",
  execution: "ביצוע בפרמיר",
};

/** Stages in pipeline order, so the index reads as a flow rather than a set. */
const STAGE_ORDER: PipelineStage[] = [
  "transcription",
  "vision",
  "selection",
  "cut",
  "qc",
  "execution",
];

function frontmatter(expert: Expert): string {
  return [
    "---",
    `title: ${expert.title}`,
    "tags:",
    "  - project/agent",
    ...expert.stages.map((s) => `  - stage/${s}`),
    "aliases:",
    `  - ${expert.id}`,
    "---",
  ].join("\n");
}

function noteFor(expert: Expert): string {
  // Plain note link, no heading anchor: Pipeline and Agents is written in
  // English, so a Hebrew stage label would be a dead anchor.
  const stages = expert.stages.map((s) => STAGE_LABELS[s]).join(", ");

  const siblings = expert.worksWith.map((id) => `[[${id}]]`).join(", ");

  // Which experts name *this* one — the reverse edge. Obsidian shows
  // backlinks anyway, but stating it makes the note readable on its own.
  const namedBy = EXPERTS.filter((e) => e.worksWith.includes(expert.id))
    .map((e) => `[[${e.id}]]`)
    .join(", ");

  const sources = expert.sources.map((s) => `- ${s}`).join("\n");

  const contributes = expert.stages
    .map((stage) => {
      const text = expert.promptSection({
        stage,
        outputProfile: "REEL_SHORT",
        targetDurationSec: 20,
      });
      return text === null
        ? `- **${STAGE_LABELS[stage]}** — תורם חוקים בקוד, לא טקסט לפרומפט.`
        : `- **${STAGE_LABELS[stage]}** — ${text.split("\n")[0].replace(/^#+\s*/, "")}`;
    })
    .join("\n");

  return `${frontmatter(expert)}

# ${expert.title}

${expert.summary}

חלק מ-[[Agents]] · חלק מ-[[Premier Edit]].

## שלבים

${stages} — ראה [[Pipeline and Agents]].

${contributes}

## עובד מול

${siblings || "—"}

${namedBy ? `נקרא על ידי: ${namedBy}` : ""}

## קוד

\`lib/experts/${expert.id}.ts\` — ראה [[Tech Stack#Expert layer]].

## מקורות

${sources}
`;
}

function indexNote(): string {
  const byStage = STAGE_ORDER.map((stage) => {
    const members = expertsForStage(stage);
    if (members.length === 0) return null;
    const list = members
      .map((e) => `- [[${e.id}\\|${e.title}]] — ${e.summary}`)
      .join("\n");
    return `### ${STAGE_LABELS[stage]}\n\n${list}`;
  })
    .filter((s): s is string => s !== null)
    .join("\n\n");

  const edges = EXPERTS.flatMap((e) =>
    e.worksWith.map((w) => `  ${e.id} --- ${w}`),
  );
  // Undirected pairs, deduplicated, so the diagram draws one line per link.
  const seen = new Set<string>();
  const uniqueEdges = edges.filter((line) => {
    const [a, , b] = line.trim().split(" ");
    const key = [a, b].sort().join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return `---
title: Agents
tags:
  - project/reference
aliases:
  - סוכנים
  - מומחים
---

# Agents

צוות המומחים המקומיים של [[Premier Edit]]. **מומחה הוא לא קריאה למודל** — הוא
מודול ידע ב-\`lib/experts/\` שמזין את הקריאות שכבר קיימות. זו ההחלטה שמאפשרת
לצוות לגדול בלי שמספר הקריאות ל-API יגדל איתו: להוסיף מומחה מוסיף טקסט
לפרומפט קיים, לא קריאה חדשה.

הקובץ הזה נוצר אוטומטית מ-\`lib/experts/index.ts\` דרך
\`npm run generate:agent-notes\`. אל תערוך אותו ביד — ערוך את המומחה בקוד
והרץ מחדש.

${EXPERTS.length} מומחים, ${uniqueEdges.length} קשרים.

## לפי שלב

${byStage}

## מפת הקשרים

\`\`\`mermaid
graph LR
${uniqueEdges.join("\n")}
\`\`\`

## למה זה קיים

לפני השכבה הזו כל הידע העריכתי ישב בקובץ אחד, \`lib/editing/social-guidelines.ts\`,
שנשלח כמו שהוא לכל שלושת פרופילי הפלט. הוא הורה למודל לכוון ל-15-20 שניות
ולהימנע מ-30-40 שניות **גם כשהיעד היה יוטיוב ארוך של כמה דקות** — כלומר הנחיה
שגויה בשני שלישים מהמקרים. ראה [[Decisions and Open Questions]].
`;
}

function main() {
  const target = process.argv[2] ?? DEFAULT_VAULT_AGENTS;
  mkdirSync(target, { recursive: true });

  // Remove notes for experts that no longer exist, so a rename doesn't leave
  // an orphan note behind that Obsidian would still show in the graph.
  const expected = new Set([...EXPERTS.map((e) => `${e.id}.md`)]);
  for (const file of readdirSync(target)) {
    if (file.endsWith(".md") && !expected.has(file)) {
      rmSync(join(target, file));
      console.log(`removed stale ${file}`);
    }
  }

  for (const expert of EXPERTS) {
    writeFileSync(join(target, `${expert.id}.md`), noteFor(expert));
  }
  writeFileSync(resolve(target, "..", "Agents.md"), indexNote());

  console.log(
    `wrote ${EXPERTS.length} agent notes + index to ${target}`,
  );
}

main();
