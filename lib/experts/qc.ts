import type { OutputProfile } from "@/lib/generated/prisma/enums";
import type { Expert } from "./types";
import { pacingProblems } from "./pacing";

/** One moment as QC sees it — deliberately minimal so this stays pure. */
export type QcMoment = {
  mediaAssetId: string;
  startSec: number;
  endSec: number;
  beat?: string;
};

export type QcFinding = {
  severity: "error" | "warning";
  message: string;
};

/** How far the cut may drift from the requested duration before QC complains. */
const DURATION_TOLERANCE = 0.25;

/**
 * Deterministic checks over a finished cut. No LLM, no Prisma, no SDK — pure
 * functions only, which is both why this costs nothing to run and why it is
 * unit-testable (vitest does not load `.env`, so a module importing prisma at
 * the top cannot be tested at all).
 */
export function qcFindings(
  moments: QcMoment[],
  profile: OutputProfile,
  targetDurationSec: number,
): QcFinding[] {
  const findings: QcFinding[] = [];

  if (moments.length === 0) {
    return [{ severity: "error", message: "הקאט ריק — אין רגעים." }];
  }

  for (const [i, m] of moments.entries()) {
    if (m.endSec <= m.startSec) {
      findings.push({
        severity: "error",
        message: `רגע ${i + 1}: זמן סיום (${m.endSec}s) לא אחרי זמן ההתחלה (${m.startSec}s).`,
      });
    }
    if (m.startSec < 0) {
      findings.push({
        severity: "error",
        message: `רגע ${i + 1}: זמן התחלה שלילי (${m.startSec}s).`,
      });
    }
  }

  const durations = moments.map((m) => Math.max(0, m.endSec - m.startSec));
  const total = durations.reduce((sum, d) => sum + d, 0);
  const drift = Math.abs(total - targetDurationSec) / (targetDurationSec || 1);
  if (drift > DURATION_TOLERANCE) {
    findings.push({
      severity: "warning",
      message: `אורך הקאט ${total.toFixed(1)}s רחוק מהיעד ${targetDurationSec}s (${Math.round(drift * 100)}% סטייה).`,
    });
  }

  // Two consecutive moments from the same source read as a jump cut — the
  // execution layer only produces hard cuts, so nothing smooths this over.
  for (let i = 1; i < moments.length; i++) {
    if (moments[i].mediaAssetId === moments[i - 1].mediaAssetId) {
      findings.push({
        severity: "warning",
        message: `רגעים ${i} ו-${i + 1} מגיעים מאותו קובץ ברצף — ייראה כמו jump cut.`,
      });
    }
  }

  for (const problem of pacingProblems(durations, profile)) {
    findings.push({ severity: "warning", message: problem });
  }

  return findings;
}

export const qcExpert: Expert = {
  id: "qc",
  title: "מומחה בקרת איכות",
  summary:
    "בודק את הקאט הגמור בדיקות דטרמיניסטיות — זמנים תקינים, אורך מול היעד, jump cuts וקצב. בלי מודל בכלל.",
  stages: ["qc"],
  worksWith: ["pacing", "premiere-craft", "hebrew"],
  sources: ["docs/superpowers/specs/2026-08-01-agents-and-panel-app-design.md"],

  // QC contributes rules, not prompt text — it runs as code. Returning null
  // everywhere is the honest answer rather than inventing a prompt section
  // nothing would consume.
  promptSection() {
    return null;
  },
};
