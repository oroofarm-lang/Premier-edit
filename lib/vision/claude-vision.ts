import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { withExtractedFrames } from "./extract-frames";
import { mapWithConcurrency } from "@/lib/concurrency";
import type {
  ClipVisualDescription,
  VisionAnalyzer,
  VisionClipInput,
  VisionOutcome,
} from "./types";

// Cost-efficient model for bulk, short per-clip descriptions — see CLAUDE.md,
// "Budget / LLM sizing". Vision quality differences between tiers matter far
// less here than for open-ended reasoning: this is closer to captioning.
const MODEL = "claude-haiku-4-5-20251001";

// A folder of real footage is dozens of clips; this keeps a batch from
// firing them all at the API simultaneously.
const MAX_CONCURRENT_REQUESTS = 4;

const PROMPT = `אתה מנתח קליפ וידאו לצורך עריכת תוכן לרשתות חברתיות (רילס/סושיאל).
קיבלת 3 תמונות שנדגמו מתוך אותו קליפ אחד (התחלה, אמצע, סוף) — לא 3 קליפים
נפרדים. גם אם הן מראות רגעים שונים (למשל מישהו הולך ממקום למקום), הן יחד
מתארות קליפ וידאו רציף אחד.

תאר מה רואים בפועל לאורך הקליפ — לא מה שאולי נאמר, רק מה שנראה בתמונות.
אם התוכן משתנה בין הפריימים, תסכם את זה כתנועה/התקדמות אחת במשפט אחד
("X מתחיל ב-A והולך לעבר B"), ולא כתיאור נפרד לכל תמונה.

החזר אך ורק אובייקט JSON תקין אחד — לא מערך, לא כמה אובייקטים, לא markdown
fence — בפורמט הבא, בלי שום טקסט נוסף לפניו או אחריו:
{
  "summary": "משפט אחד או שניים קצרים בעברית שמסכמים את כל הקליפ",
  "shotType": "אחד מ: close-up, medium, wide, detail, unclear",
  "tags": ["3-6 מילות מפתח קצרות באנגלית, נושאים/פעולות/אובייקטים"],
  "qualityNotes": "הערה קצרה על איכות הצילום או null אם אין הערה"
}`;

function parseJsonResponse(text: string): ClipVisualDescription {
  // Models sometimes wrap JSON in a markdown fence, or (rarer, seen on clips
  // whose sampled frames differ a lot) emit several JSON blocks — one per
  // frame — despite being told this is one clip. Take the first well-formed
  // object rather than failing the whole clip over that.
  const withoutFences = text.replace(/```(?:json)?/gi, "");
  const firstBrace = withoutFences.indexOf("{");
  if (firstBrace === -1) {
    throw new Error("Vision response contained no JSON object.");
  }
  let depth = 0;
  let end = -1;
  for (let i = firstBrace; i < withoutFences.length; i++) {
    if (withoutFences[i] === "{") depth++;
    else if (withoutFences[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) {
    throw new Error("Vision response JSON object was not closed (truncated?).");
  }

  const parsed = JSON.parse(withoutFences.slice(firstBrace, end + 1));
  return {
    engine: `claude-vision:${MODEL}`,
    summary: String(parsed.summary ?? ""),
    shotType: parsed.shotType ? String(parsed.shotType) : null,
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
    qualityNotes: parsed.qualityNotes ? String(parsed.qualityNotes) : null,
  };
}

export class ClaudeVisionAnalyzer implements VisionAnalyzer {
  readonly name = `claude-vision:${MODEL}`;
  private readonly client: Anthropic;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Visual analysis needs an Anthropic API " +
          "key (separate from a Claude.ai subscription) — see CLAUDE.md.",
      );
    }
    this.client = new Anthropic({ apiKey });
  }

  async describeClip(input: VisionClipInput): Promise<ClipVisualDescription> {
    const range =
      input.segmentStartSec !== undefined && input.segmentEndSec !== undefined
        ? { startSec: input.segmentStartSec, endSec: input.segmentEndSec }
        : undefined;

    return withExtractedFrames(
      input.filePath,
      input.durationSec,
      async (framePaths) => {
        const images = await Promise.all(
          framePaths.map(async (framePath) => ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: "image/jpeg" as const,
              data: (await readFile(framePath)).toString("base64"),
            },
          })),
        );

        const message = await this.client.messages.create({
          model: MODEL,
          max_tokens: 700,
          messages: [
            {
              role: "user",
              content: [...images, { type: "text", text: PROMPT }],
            },
          ],
        });

        const textBlock = message.content.find((block) => block.type === "text");
        if (!textBlock || textBlock.type !== "text") {
          throw new Error("Vision response contained no text block.");
        }
        return parseJsonResponse(textBlock.text);
      },
      range,
    );
  }

  async describeMany(inputs: VisionClipInput[]): Promise<VisionOutcome[]> {
    return mapWithConcurrency(inputs, MAX_CONCURRENT_REQUESTS, async (input) => {
      try {
        const result = await this.describeClip(input);
        return { filePath: input.filePath, ok: true, result } as const;
      } catch (error) {
        return {
          filePath: input.filePath,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        } as const;
      }
    });
  }
}
