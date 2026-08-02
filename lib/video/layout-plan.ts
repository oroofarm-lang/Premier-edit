import type { OutputProfile } from "@/lib/generated/prisma/enums";
import { assembleExpertSections } from "@/lib/experts";
import { SHOT_DURATION_SEC } from "@/lib/experts/pacing";

/**
 * Pure logic for the video layer: prompt assembly, response parsing, and
 * validation. No Prisma and no SDK import, deliberately — vitest does not
 * load `.env`, so a module importing `@/lib/db` at the top cannot be
 * unit-tested at all. Same split as refine.ts / refine-plan.ts.
 */

/** One moment of the audio spine, positioned on the finished timeline. */
export type SpineMoment = {
  order: number;
  fileName: string;
  /** Where this moment sits on the finished cut, not inside its source clip. */
  timelineStartSec: number;
  timelineEndSec: number;
  text: string;
  beat: string;
};

/** One catalogued shot offered to the layout stage. */
export type ShotCandidate = {
  shotId: string;
  fileName: string;
  /** Times inside the source clip. */
  startSec: number;
  endSec: number;
  qualityScore: number;
  movementCompleteness: number;
  activity: number;
  /** What the vision pass saw, when it ran for this shot. */
  description: string | null;
  /** True when this shot comes from the same clip as the spine moment it
   * would cover — i.e. keeping it in sync shows the speaker actually
   * speaking. */
  isSyncFor: number[];
};

export type LayoutPlacement = {
  /** Index into the candidate array handed to the model. */
  index: number;
  timelineStartSec: number;
  timelineEndSec: number;
  useSourceAudio?: boolean;
  reason: string;
};

export type LayoutPlan = {
  placements: LayoutPlacement[];
};

/** Floating-point slack when comparing timeline positions, in seconds. */
const EPSILON = 0.05;

/**
 * Where a shot stops being "cut mid-move" and starts being "settles". Below
 * ANCHOR_MIN the window has no ending worth protecting; at ANCHOR_FULL it is
 * entirely about its ending. Between them the anchor ramps, so no shot jumps
 * behaviour because its score moved by a hundredth.
 */
const ANCHOR_MIN = 0.5;
const ANCHOR_FULL = 0.85;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Picks which `span` seconds of a shot's window to actually use.
 *
 * The catalogue grades a window on how it **ends** — `movementCompleteness`
 * is literally "the window ends settled rather than mid-movement". Taking the
 * head of the window therefore throws away the exact property the shot was
 * chosen for. Measured on a real 19-placement cut before this existed: 18 of
 * 19 placements were trimmed, and 11 shots graded >= 0.80 lost 16.5s of their
 * own endings. The user's report was the plain-language version of that
 * number — someone tilts a kettle and the tea never reaches the cup.
 *
 * So a shot whose movement completes is anchored to the **end** of its
 * window, and the trim eats into its lead-in instead. A shot that does not
 * complete keeps the old head-anchored behaviour, where the action at least
 * begins cleanly.
 *
 * `span` is assumed to fit the window; the caller clamps against the real
 * file duration, which is the error Premiere reports late and unhelpfully.
 */
export function resolveSourceWindow(
  shot: { startSec: number; endSec: number; movementCompleteness: number },
  span: number,
): { sourceInSec: number; sourceOutSec: number } {
  const windowSec = Math.max(0, shot.endSec - shot.startSec);
  const used = Math.max(0, Math.min(span, windowSec));
  const slack = windowSec - used;

  const anchor = clamp01(
    (shot.movementCompleteness - ANCHOR_MIN) / (ANCHOR_FULL - ANCHOR_MIN),
  );

  const sourceInSec = shot.startSec + slack * anchor;
  return { sourceInSec, sourceOutSec: sourceInSec + used };
}

/**
 * How far apart in the source clip two consecutive spans must sit before
 * they count as different angles rather than a jump cut.
 *
 * The first version of this rule banned consecutive placements from one file
 * outright, which was too blunt: the user explicitly wants the same subject
 * revisited from several angles ("show the field a few times, from all sorts
 * of angles"), and in a single continuous take those angles are different
 * moments of one file. Source-time distance is a proxy for "the camera has
 * moved since", not proof of it — but it distinguishes the case the rule was
 * written for (two adjacent spans of the same shot, which really does read as
 * a jump) from the case the user is asking for.
 */
const SAME_FILE_ANGLE_GAP_SEC = 2;

/**
 * How much denser the picture cuts than the spoken moments.
 *
 * The video layer is not paced by the audio. A single sentence can carry
 * three shots — the subject, a detail, a reaction — and the user asked for
 * exactly that: "show the field a few times, from all sorts of angles",
 * "jump between moments". The first real layout returned 12 placements over
 * 34.8s, roughly one per spoken moment, which is the cadence this factor
 * exists to break. It also anticipates cutting to music later, which needs
 * more cut points available, not fewer.
 */
const VIDEO_DENSITY_FACTOR = 0.65;

/** Suggested number of picture cuts for a cut of this length and profile. */
export function targetPlacementCount(
  totalDurationSec: number,
  profile: OutputProfile,
): { min: number; ideal: number; max: number } {
  const ideal = SHOT_DURATION_SEC[profile].ideal * VIDEO_DENSITY_FACTOR;
  return {
    min: Math.max(3, Math.round(totalDurationSec / (ideal * 1.6))),
    ideal: Math.max(4, Math.round(totalDurationSec / ideal)),
    max: Math.max(6, Math.round(totalDurationSec / (ideal * 0.55))),
  };
}

export function buildLayoutPrompt(
  spine: SpineMoment[],
  candidates: ShotCandidate[],
  outputProfile: OutputProfile,
): string {
  const totalSec = spine.at(-1)?.timelineEndSec ?? 0;

  const spineLines = spine
    .map(
      (m) =>
        `[${m.timelineStartSec.toFixed(1)}-${m.timelineEndSec.toFixed(1)}s] ` +
        `(${m.beat}) ${m.fileName}: ${m.text.trim()}`,
    )
    .join("\n");

  const shotLines = candidates
    .map((c, i) => {
      const length = (c.endSec - c.startSec).toFixed(1);
      const sync =
        c.isSyncFor.length > 0
          ? ` | סנכרון אפשרי לרגעים: ${c.isSyncFor.join(", ")}`
          : "";
      const desc = c.description ? ` | ${c.description}` : " | (לא תואר)";
      return (
        `#${i} | ${c.fileName} ${c.startSec.toFixed(1)}-${c.endSec.toFixed(1)}s ` +
        `| אורך ${length}s | איכות ${c.qualityScore.toFixed(2)} ` +
        `| תנועה שלמה ${c.movementCompleteness.toFixed(2)} ` +
        `| פעילות ${c.activity.toFixed(2)}${sync}${desc}`
      );
    })
    .join("\n");

  const count = targetPlacementCount(totalSec, outputProfile);

  return `אתה עורך וידאו. **פס האודיו כבר בנוי וסגור** — הסיפור המדובר נקבע,
ואתה לא משנה בו כלום. התפקיד שלך הוא **להלביש עליו תמונה**.

התמונה לא חייבת להגיע מאותו רגע שממנו מגיע הקול. זו הנקודה המרכזית: הקול
מספר, והתמונה מראה. לרוב עדיף להראות את מה שמתואר מאשר את מי שמתאר.

## פס האודיו (${totalSec.toFixed(1)} שניות, קבוע)

${spineLines}

## שוטים זמינים

${shotLines}

${assembleExpertSections({
  stage: "cut",
  outputProfile,
  targetDurationSec: Math.round(totalSec),
})}

## חוקים

1. **כיסוי מלא**: ההשמות חייבות לכסות מ-0.0 עד ${totalSec.toFixed(1)} שניות ברצף,
   בלי חורים ובלי חפיפות. השמה מתחילה בדיוק איפה שהקודמת נגמרת.
2. **אורך**: השמה לא יכולה להיות ארוכה מהשוט שממנו היא לקוחה. שוט של 2.6
   שניות לא יכול לכסות 5 שניות. אפשר להשתמש בחלק משוט.
3. **צפיפות**: כוון ל-**${count.ideal} השמות בערך** (לא פחות מ-${count.min},
   לא יותר מ-${count.max}). שכבת הוידאו מתחלפת **הרבה יותר מהר מהאודיו** —
   משפט אחד יכול לשאת שלושה שוטים: הנושא, פרט, תגובה. עדיין לפי משמעות ולא
   לפי שעון: תחליף כשהתוכן מתקדם או כשהשוט מיצה את עצמו.
3א. **חזור לאותו נושא מזוויות שונות**: אם יש כמה שוטים של השדה, של הקנקן או
   של הידיים — תשתמש בכמה מהם לאורך הקאט, לא רק באחד. זה מה שגורם לעריכה
   להרגיש עשירה במקום סטטית. מותר לחזור לאותו קובץ בהמשך, בתנאי שזה קטע
   אחר ומרוחק בזמן המקור.
4. **סנכרון רק כשהשוט טוב**: אם רגע מסומן "סנכרון אפשרי" ואיכות השוט גבוהה,
   אפשר להשאיר את הדובר על המסך. אם השוט חלש — תכסה אותו במשהו אחר.
   ההחלטה היא לכל רגע בנפרד, לא כלל גורף.
5. **בלי חזרות**: אל תשתמש באותו שוט פעמיים. תפזר בין מקורות.
6. **העדף תנועה שלמה ופעילות**: שוט שבו קורה משהו והתנועה בו מסתיימת עדיף
   על שוט יפה שבו לא קורה כלום.
7. **נימוק קצר**: "reason" עד 6 מילים. אתה מייצר הרבה השמות, ונימוק ארוך
   לכל אחת מבזבז את תקציב התשובה.
8. **"useSourceAudio"**: ברירת המחדל false. תסמן true רק אם בשוט יש סאונד
   אפקט שכדאי לשמוע (חיתוך, מזיגה, טפטוף) — אף פעם לא בשביל דיבור, כי
   הדיבור כבר בנוי בפס האודיו.

החזר אך ורק JSON תקין, בלי טקסט לפני או אחרי:
{
  "placements": [
    { "index": 3, "timelineStartSec": 0.0, "timelineEndSec": 2.4, "useSourceAudio": false, "reason": "עד 6 מילים" }
  ]
}`;
}

export function parseLayoutPlan(text: string): LayoutPlan {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed.placements)) {
    throw new Error("Layout response missing a 'placements' array.");
  }
  return {
    placements: parsed.placements.map((p: Record<string, unknown>) => ({
      index: Number(p.index),
      timelineStartSec: Number(p.timelineStartSec),
      timelineEndSec: Number(p.timelineEndSec),
      useSourceAudio: p.useSourceAudio === true,
      reason: String(p.reason ?? ""),
    })),
  };
}

/**
 * Mechanically checks what the prompt asks for, rather than trusting it.
 * Same philosophy as `validatePlan` for selection: the model can state an
 * intent and then not honour it, and a gap in the video layer is a black
 * frame in the finished cut.
 */
export function validateLayout(
  plan: LayoutPlan,
  candidates: ShotCandidate[],
  totalDurationSec: number,
): { ok: true } | { ok: false; reason: string } {
  const { placements } = plan;
  if (placements.length === 0) {
    return { ok: false, reason: "The layout placed no shots." };
  }

  const ordered = [...placements].sort(
    (a, b) => a.timelineStartSec - b.timelineStartSec,
  );

  if (Math.abs(ordered[0].timelineStartSec) > EPSILON) {
    return {
      ok: false,
      reason: `The video layer starts at ${ordered[0].timelineStartSec.toFixed(2)}s instead of 0 — the opening would be a black frame.`,
    };
  }

  const seen = new Set<number>();
  for (const [i, p] of ordered.entries()) {
    const shot = candidates[p.index];
    if (!shot) {
      return { ok: false, reason: `Shot #${p.index} does not exist.` };
    }
    if (seen.has(p.index)) {
      return { ok: false, reason: `Shot #${p.index} is used more than once.` };
    }
    seen.add(p.index);

    const span = p.timelineEndSec - p.timelineStartSec;
    if (span <= 0) {
      return {
        ok: false,
        reason: `Placement ${i + 1} ends at or before it starts (${p.timelineStartSec}-${p.timelineEndSec}).`,
      };
    }

    const available = shot.endSec - shot.startSec;
    if (span > available + EPSILON) {
      return {
        ok: false,
        reason: `Placement ${i + 1} needs ${span.toFixed(1)}s but shot #${p.index} only has ${available.toFixed(1)}s.`,
      };
    }

    if (i > 0) {
      // Two adjacent spans of the same take, back to back, read as a jump
      // cut — the execution layer produces hard cuts only, so nothing
      // downstream softens it. Spans far apart in the same file are a
      // different matter: that is the same subject from another angle, which
      // is wanted.
      const previousShot = candidates[ordered[i - 1].index];
      if (previousShot && previousShot.fileName === shot.fileName) {
        const gap = Math.min(
          Math.abs(shot.startSec - previousShot.endSec),
          Math.abs(previousShot.startSec - shot.endSec),
        );
        if (gap < SAME_FILE_ANGLE_GAP_SEC) {
          return {
            ok: false,
            reason: `Placements ${i} and ${i + 1} are adjacent spans of ${shot.fileName} (${gap.toFixed(1)}s apart in the source) — that reads as a jump cut rather than a new angle.`,
          };
        }
      }

      const previousEnd = ordered[i - 1].timelineEndSec;
      const delta = p.timelineStartSec - previousEnd;
      if (Math.abs(delta) > EPSILON) {
        return {
          ok: false,
          reason:
            delta > 0
              ? `Gap of ${delta.toFixed(2)}s before placement ${i + 1} — that is a black frame.`
              : `Placements ${i} and ${i + 1} overlap by ${(-delta).toFixed(2)}s.`,
        };
      }
    }
  }

  const covered = ordered.at(-1)!.timelineEndSec;
  if (Math.abs(covered - totalDurationSec) > EPSILON) {
    return {
      ok: false,
      reason: `The video layer covers ${covered.toFixed(1)}s but the audio spine is ${totalDurationSec.toFixed(1)}s.`,
    };
  }

  return { ok: true };
}

/**
 * Positions the spine's moments end-to-end on the finished timeline. The
 * moments carry source in/out points; the cut plays them back to back, so
 * timeline position is the running total rather than anything stored.
 */
export function layOutSpine(
  moments: { order: number; fileName: string; startSec: number; endSec: number; text: string; reason: string }[],
): SpineMoment[] {
  let cursor = 0;
  return [...moments]
    .sort((a, b) => a.order - b.order)
    .map((m) => {
      const length = m.endSec - m.startSec;
      const positioned: SpineMoment = {
        order: m.order,
        fileName: m.fileName,
        timelineStartSec: Math.round(cursor * 100) / 100,
        timelineEndSec: Math.round((cursor + length) * 100) / 100,
        text: m.text,
        // The selector writes "beat: reason"; the beat is the part before the
        // colon, and an absent colon means it never named one.
        beat: m.reason.includes(":") ? m.reason.split(":")[0].trim() : "",
      };
      cursor += length;
      return positioned;
    });
}
