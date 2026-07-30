# Editing Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three concrete causes of the "cuts feel choppy" feedback: cut points that land mid-word, hard audio cuts with no smoothing, and an LLM selector that only produces a ranked list instead of a validated narrative plan.

**Architecture:** Three additive changes layered onto the existing pipeline, each behind the interfaces already in place (`Transcriber`, `ContentSelector`, `buildFcp7Xml`) — no interface signatures change, one new pure module (`lib/cut/snap.ts`), one new probe script, and targeted edits to `scripts/transcribe.py`, `lib/transcription/*`, `lib/cut/build.ts`, `lib/export/fcp7.ts`, `lib/selection/llm-selector.ts`.

**Tech Stack:** Next.js 14 / TypeScript / Prisma 6 / SQLite, faster-whisper (Python venv), `@anthropic-ai/sdk`, vitest (new — this plan introduces it for the first time in this repo, see Task 1).

## Global Constraints

- Prisma client imports from `@/lib/generated/prisma/client` (and `.../enums`), never `@prisma/client` — see CLAUDE.md.
- No Prisma migration is needed anywhere in this plan — `Transcript.segmentsJson` and `Selection` already store/accept the shapes this plan adds.
- `Transcriber.transcribeMany` / `.transcribe`, `ContentSelector.select`, and `buildFcp7Xml`'s exported signature must not change — only their internals and the data flowing through them.
- Audio smoothing is audio-only per the user's explicit scope decision (no music bed, no video-side dissolve) — see `docs/superpowers/specs/2026-07-30-editing-quality-design.md`, "Out of scope."
- Task 6 in this plan ends in a real human checkpoint (Premiere test-import) that decides which of Task 7a/7b actually gets executed — do not run both.

---

## Task 1: Add vitest for unit-testing pure functions

This repo has no test runner yet (`package.json` has no `test` script, no jest/vitest dependency). Tasks 3, 4, and 9 add pure, deterministic logic (no ffmpeg, no DB, no network) that should be unit-tested rather than only verified by hand — this task adds the minimum runner needed for that.

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `lib/smoke.test.ts` (deleted again at the end of this task — it only exists to prove the config works)

**Interfaces:**
- Produces: `npx vitest run` as the command every later unit-test task uses. Tests live next to the code they test, named `*.test.ts`, and can `import ... from "@/..."`.

- [ ] **Step 1: Install vitest**

```bash
npm install --save-dev vitest
```

- [ ] **Step 2: Add the test script**

In `package.json`, add to `"scripts"`:

```json
"test": "vitest run"
```

- [ ] **Step 3: Add vitest config with the `@/` alias**

The project's `tsconfig.json` maps `@/*` to `./*` (used everywhere, e.g. `@/lib/db`). Vitest needs the same alias or every `@/...` import in a test file will fail to resolve.

Create `vitest.config.ts`:

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

- [ ] **Step 4: Write a throwaway smoke test**

Create `lib/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("vitest setup", () => {
  it("runs and resolves the @/ alias", async () => {
    const { prisma } = await import("@/lib/db");
    expect(prisma).toBeDefined();
  });
});
```

- [ ] **Step 5: Run it**

Run: `npx vitest run`
Expected: `1 passed` — confirms both the runner and the `@/` alias work before any real test depends on them.

- [ ] **Step 6: Delete the smoke test**

```bash
rm lib/smoke.test.ts
```

It served its purpose (proving config works); keeping it around forever would just be a test with no real assertion about the app.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "Add vitest for unit-testing pure pipeline logic"
```

---

## Task 2: Word-level timestamps in the transcription script

**Files:**
- Modify: `scripts/transcribe.py:23-53` (the `transcribe_one` function)

**Interfaces:**
- Produces: each item in the JSON array's `segments` list gains a `"words"` field: `[{"word": str, "start": float, "end": float}, ...]`. Everything else about the script's output shape is unchanged.

- [ ] **Step 1: Turn on `word_timestamps` and collect per-word timing**

In `scripts/transcribe.py`, replace the `transcribe_one` function body:

```python
def transcribe_one(model, audio_path: str, language: str) -> dict:
    segments, info = model.transcribe(
        audio_path,
        language=language,
        vad_filter=True,
        word_timestamps=True,
    )

    collected = []
    for segment in segments:
        text = segment.text.strip()
        if not text:
            continue
        words = [
            {
                "word": w.word.strip(),
                "start": round(w.start, 3),
                "end": round(w.end, 3),
            }
            for w in (segment.words or [])
            if w.word.strip()
        ]
        collected.append(
            {
                "start": round(segment.start, 3),
                "end": round(segment.end, 3),
                "text": text,
                "words": words,
            }
        )
        # Surface progress on long files rather than looking hung.
        print(f"  segment {len(collected)} @ {segment.end:.1f}s", file=sys.stderr)

    return {
        "path": audio_path,
        "language": info.language,
        "languageProbability": round(info.language_probability, 4),
        "durationSec": round(info.duration, 3),
        "text": " ".join(s["text"] for s in collected),
        "segments": collected,
    }
```

This is the only change in the file — `main()`, the CLI args, and the batching loop are untouched.

- [ ] **Step 2: Verify against a real file, not a mock**

Loading `large-v3` and running the model is too heavy for a unit test (multi-second model load, 3GB weights) — the existing project convention (see CLAUDE.md, real-footage debugging notes from this session) is to verify scripts like this directly against real media instead. Pick any already-ingested audio/video file from the חליטת תה project (or any file already used for the earlier real-footage tests):

```bash
.venv/bin/python scripts/transcribe.py "/path/to/one/real/clip.MP4" --model large-v3 --language he --model-dir ./models
```

Expected: stdout is a JSON array; each element's `segments[].words` is a non-empty array (for segments with actual speech), each word has `start < end`, and words within a segment are in non-decreasing time order. Spot-check one word's `start`/`end` against the segment's own `start`/`end` — every word's span should fall inside its segment's span.

- [ ] **Step 3: Commit**

```bash
git add scripts/transcribe.py
git commit -m "Emit word-level timestamps from faster-whisper"
```

---

## Task 3: Carry word timestamps through the Transcriber interface

**Files:**
- Modify: `lib/transcription/types.ts:6-10` (`TranscriptSegment`)
- Modify: `lib/transcription/local-whisper.ts:68-82` (`toResult`), `:147-157` (`RawWhisperResult`)
- Test: `lib/transcription/local-whisper.test.ts`

**Interfaces:**
- Consumes: the `words` field added to `scripts/transcribe.py`'s output in Task 2 (raw shape: `{word: string; start: number; end: number}[]`).
- Produces: `TranscriptSegment.words?: {word: string; startSec: number; endSec: number}[]` — optional, so a future cloud `Transcriber` implementation that never fills it in still satisfies the interface. Task 5 (`lib/cut/build.ts`) reads this field.

- [ ] **Step 1: Add the type**

In `lib/transcription/types.ts`, add above `TranscriptSegment`:

```ts
export type TranscriptWord = {
  word: string;
  startSec: number;
  endSec: number;
};
```

And add the optional field to `TranscriptSegment`:

```ts
export type TranscriptSegment = {
  startSec: number;
  endSec: number;
  text: string;
  /** Per-word timing, when the engine provides it — used to snap cut points
   * to real word boundaries instead of wherever the engine closed a sentence. */
  words?: TranscriptWord[];
};
```

- [ ] **Step 2: Extract `toResult` into a standalone, testable function**

It's currently a private method on `LocalWhisperTranscriber`, which means it can't be unit-tested without instantiating the class (which requires a real venv path). Pull it out as a plain function in the same file, above the class, and have the class delegate to it — no behavior change, just testability.

In `lib/transcription/local-whisper.ts`, replace the `private toResult` method and the `RawWhisperResult` type at the bottom of the file:

```ts
export function toTranscriptionResult(
  raw: RawWhisperResult,
  engine: string,
): TranscriptionResult {
  if ("error" in raw) {
    throw new Error(raw.error);
  }
  return {
    engine,
    language: raw.language,
    text: raw.text,
    segments: raw.segments.map((s) => ({
      startSec: s.start,
      endSec: s.end,
      text: s.text,
      words: s.words?.map((w) => ({
        word: w.word,
        startSec: w.start,
        endSec: w.end,
      })),
    })),
  };
}

export type RawWhisperResult =
  | {
      path: string;
      language: string;
      languageProbability: number;
      durationSec: number;
      text: string;
      segments: {
        start: number;
        end: number;
        text: string;
        words?: { word: string; start: number; end: number }[];
      }[];
    }
  | { path: string; error: string };
```

Then update the two call sites inside the class (`transcribe` and `transcribeMany`) to call `toTranscriptionResult(raw, this.name)` instead of `this.toResult(raw)`, and delete the old `private toResult` method entirely.

- [ ] **Step 3: Write the failing test**

Create `lib/transcription/local-whisper.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toTranscriptionResult, type RawWhisperResult } from "./local-whisper";

describe("toTranscriptionResult", () => {
  it("maps words with startSec/endSec when the engine provides them", () => {
    const raw: RawWhisperResult = {
      path: "/tmp/clip.wav",
      language: "he",
      languageProbability: 0.99,
      durationSec: 4,
      text: "שלום עולם",
      segments: [
        {
          start: 0,
          end: 1.2,
          text: "שלום עולם",
          words: [
            { word: "שלום", start: 0, end: 0.5 },
            { word: "עולם", start: 0.6, end: 1.2 },
          ],
        },
      ],
    };

    const result = toTranscriptionResult(raw, "local-whisper:large-v3");

    expect(result.segments[0].words).toEqual([
      { word: "שלום", startSec: 0, endSec: 0.5 },
      { word: "עולם", startSec: 0.6, endSec: 1.2 },
    ]);
  });

  it("leaves words undefined when the raw segment has none", () => {
    const raw: RawWhisperResult = {
      path: "/tmp/clip.wav",
      language: "he",
      languageProbability: 0.99,
      durationSec: 4,
      text: "שלום",
      segments: [{ start: 0, end: 1, text: "שלום" }],
    };

    const result = toTranscriptionResult(raw, "local-whisper:large-v3");

    expect(result.segments[0].words).toBeUndefined();
  });

  it("throws the engine's error message for a failed item", () => {
    const raw: RawWhisperResult = { path: "/tmp/bad.wav", error: "boom" };
    expect(() => toTranscriptionResult(raw, "local-whisper:large-v3")).toThrow(
      "boom",
    );
  });
});
```

- [ ] **Step 4: Run it to see it pass (or fail first if you want strict TDD ordering)**

Run: `npx vitest run local-whisper`
Expected: `3 passed`. (If you prefer to see it fail first, comment out the `words?.map(...)` line in `toTranscriptionResult`, confirm the first test fails, then restore it.)

- [ ] **Step 5: Commit**

```bash
git add lib/transcription/types.ts lib/transcription/local-whisper.ts lib/transcription/local-whisper.test.ts
git commit -m "Carry word-level timestamps through the Transcriber interface"
```

---

## Task 4: `snapToWordBoundary` pure function

**Files:**
- Create: `lib/cut/snap.ts`
- Test: `lib/cut/snap.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks — pure function, only needs `{startSec, endSec}`-shaped word objects.
- Produces: `snapToWordBoundary(startSec: number, endSec: number, words: {startSec: number; endSec: number}[]): {startSec: number; endSec: number}`. Task 5 calls this with `TranscriptWord[]` from Task 3 (structurally compatible — `TranscriptWord` has `startSec`/`endSec` plus `word`, which this function ignores).

- [ ] **Step 1: Write the failing tests**

Create `lib/cut/snap.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { snapToWordBoundary } from "./snap";

describe("snapToWordBoundary", () => {
  const words = [
    { startSec: 1.0, endSec: 1.5 }, // "word A"
    { startSec: 1.6, endSec: 2.4 }, // "word B"
    { startSec: 2.5, endSec: 3.0 }, // "word C"
  ];

  it("pulls a start that lands mid-word back to before that word, minus pre-roll", () => {
    // 1.2 is inside word A (1.0-1.5) — should snap out to just before it.
    const result = snapToWordBoundary(1.2, 3.5, words);
    expect(result.startSec).toBeCloseTo(1.0 - 0.12, 5);
  });

  it("pushes an end that lands mid-word forward to after that word, plus breath tail", () => {
    // 2.2 is inside word B (1.6-2.4) — should snap out to just after it.
    const result = snapToWordBoundary(0.5, 2.2, words);
    expect(result.endSec).toBeCloseTo(2.4 + 0.2, 5);
  });

  it("leaves a boundary unchanged when it already sits in a gap between words", () => {
    // 1.55 is between word A's end (1.5) and word B's start (1.6) — a clean gap.
    const result = snapToWordBoundary(1.55, 3.5, words);
    expect(result.startSec).toBe(1.55);
  });

  it("passes through unchanged when there are no words at all", () => {
    const result = snapToWordBoundary(1.2, 2.2, []);
    expect(result).toEqual({ startSec: 1.2, endSec: 2.2 });
  });

  it("clamps the start snap so it never overlaps the previous word", () => {
    const tightWords = [
      { startSec: 1.0, endSec: 1.19 }, // ends just 0.01s before the pre-roll would reach
      { startSec: 1.2, endSec: 1.8 },
    ];
    // 1.5 is inside the second word; a full 0.12s pre-roll would land at 1.08,
    // which overlaps the first word (ends 1.19) — must clamp to 1.19 instead.
    const result = snapToWordBoundary(1.5, 3.5, tightWords);
    expect(result.startSec).toBe(1.19);
  });

  it("clamps the end snap so it never overlaps the next word", () => {
    const tightWords = [
      { startSec: 1.0, endSec: 1.5 },
      { startSec: 1.55, endSec: 2.0 }, // starts just 0.05s after word A ends
    ];
    // 1.2 is inside word A; a full 0.2s breath tail would land at 1.7, which
    // overlaps word B (starts 1.55) — must clamp to 1.55 instead.
    const result = snapToWordBoundary(0.5, 1.2, tightWords);
    expect(result.endSec).toBe(1.55);
  });
});
```

- [ ] **Step 2: Run to confirm the tests fail**

Run: `npx vitest run snap`
Expected: FAIL — `snap.ts` doesn't exist yet (`Cannot find module './snap'`).

- [ ] **Step 3: Implement it**

Create `lib/cut/snap.ts`:

```ts
/**
 * Moves a candidate cut boundary so it lands on real silence between words
 * instead of wherever the transcript segment happened to end. Without this,
 * cut points fall wherever faster-whisper closed a sentence — often mid-word
 * or mid-breath — which is the mechanical cause of cuts feeling abrupt.
 * See docs/superpowers/specs/2026-07-30-editing-quality-design.md.
 */

export type SnapWord = { startSec: number; endSec: number };

/** Small pre-roll before the first real word, so the syllable's onset isn't clipped. */
const PRE_ROLL_SEC = 0.12;
/** Small tail after the last real word, so a trailing breath/consonant isn't clipped. */
const BREATH_TAIL_SEC = 0.2;

/** Index of the word whose span strictly contains `timeSec`, or -1 if it's in a gap. */
function findWordContaining(words: SnapWord[], timeSec: number): number {
  return words.findIndex((w) => timeSec > w.startSec && timeSec < w.endSec);
}

export function snapToWordBoundary(
  startSec: number,
  endSec: number,
  words: SnapWord[],
): { startSec: number; endSec: number } {
  if (words.length === 0 || endSec <= startSec) {
    return { startSec, endSec };
  }

  const sorted = [...words].sort((a, b) => a.startSec - b.startSec);
  let snappedStart = startSec;
  let snappedEnd = endSec;

  const startWordIndex = findWordContaining(sorted, startSec);
  if (startWordIndex !== -1) {
    const word = sorted[startWordIndex];
    const prevWord = sorted[startWordIndex - 1] ?? null;
    const floor = prevWord ? prevWord.endSec : 0;
    snappedStart = Math.max(floor, word.startSec - PRE_ROLL_SEC);
  }

  const endWordIndex = findWordContaining(sorted, endSec);
  if (endWordIndex !== -1) {
    const word = sorted[endWordIndex];
    const nextWord = sorted[endWordIndex + 1] ?? null;
    const ceiling = nextWord ? nextWord.startSec : Infinity;
    snappedEnd = Math.min(ceiling, word.endSec + BREATH_TAIL_SEC);
  }

  // Never let snapping invert or collapse the range — fall back to the
  // original, unsnapped boundary rather than produce a broken clip.
  if (snappedEnd <= snappedStart) {
    return { startSec, endSec };
  }

  return { startSec: snappedStart, endSec: snappedEnd };
}
```

- [ ] **Step 4: Run to confirm the tests pass**

Run: `npx vitest run snap`
Expected: `7 passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/cut/snap.ts lib/cut/snap.test.ts
git commit -m "Add snapToWordBoundary for clean cut points"
```

---

## Task 5: Apply word-boundary snapping in `buildCutTimeline`

**Files:**
- Modify: `lib/cut/build.ts`

**Interfaces:**
- Consumes: `snapToWordBoundary` from Task 4; `Transcript.segmentsJson` (parsed into `TranscriptSegment[]` per Task 3's shape, `words?: TranscriptWord[]`).
- Produces: no signature change to `buildCutTimeline(projectId: string): Promise<CutTimeline>` — only the `sourceInSec`/`sourceOutSec`/`timelineStartSec`/`timelineEndSec` values it computes change.

- [ ] **Step 1: Include the transcript in the query and flatten its words**

In `lib/cut/build.ts`, change the Prisma query's `include` so each selection's media asset also brings its transcript:

```ts
const project = await prisma.project.findUniqueOrThrow({
  where: { id: projectId },
  include: {
    selections: {
      orderBy: { order: "asc" },
      include: { mediaAsset: { include: { transcript: true } } },
    },
  },
});
```

Add this helper above `buildCutTimeline` (it needs the segment shape from `lib/transcription/types.ts`):

```ts
import { snapToWordBoundary } from "./snap";
import type { TranscriptWord } from "@/lib/transcription/types";

/** All words across every segment of an asset's transcript, in one flat, time-sorted list. */
function wordsForAsset(transcriptSegmentsJson: string | undefined): TranscriptWord[] {
  if (!transcriptSegmentsJson) return [];
  const segments = JSON.parse(transcriptSegmentsJson) as {
    words?: TranscriptWord[];
  }[];
  return segments.flatMap((s) => s.words ?? []);
}
```

- [ ] **Step 2: Snap each selection's range before it becomes a `CutClip`**

Inside the `for (const selection of project.selections)` loop, right after `const length = ...` and before building the `clips.push(...)` call, insert:

```ts
const words = wordsForAsset(asset.transcript?.segmentsJson);
const snapped = snapToWordBoundary(selection.startSec, selection.endSec, words);
// Never let a snap reach past the file itself.
const sourceInSec = Math.max(0, snapped.startSec);
const sourceOutSec = asset.durationSec
  ? Math.min(asset.durationSec, snapped.endSec)
  : snapped.endSec;
const length = sourceOutSec - sourceInSec;
```

Then update the `clips.push` call to use `sourceInSec`/`sourceOutSec` instead of `selection.startSec`/`selection.endSec`:

```ts
clips.push({
  filePath: asset.filePath,
  fileName: path.basename(asset.filePath),
  hasVideo: asset.width !== null && asset.height !== null,
  hasAudio: asset.sampleRate !== null || asset.kind === "AUDIO",
  sourceInSec,
  sourceOutSec,
  timelineStartSec: playhead,
  timelineEndSec: playhead + length,
  sourceDurationSec: asset.durationSec ?? length,
  fps: asset.fps,
  width: asset.width,
  height: asset.height,
});
```

(Remove the old `const length = selection.endSec - selection.startSec;` line — it's replaced by the `length` computed above from the snapped range.)

- [ ] **Step 3: Verify against the real, already-ingested project**

There's no DB fixture in this repo, so this is verified against real data rather than a unit test — consistent with how `probe.ts`'s rotation/frame-rate fixes were verified earlier in this project. Run the pipeline's existing UI flow (or a one-off script that calls `buildCutTimeline` directly) against the חליטת תה project, which already has transcripts with the new `words` field from Task 2/3 (re-run transcription first if its transcripts predate this change — a stale transcript simply has no `words`, in which case snapping silently passes through unchanged per Task 4's design, so nothing breaks, it just won't improve until re-transcribed).

Expected: for clips with speech, the exported timeline's cut points no longer align exactly with the original `Selection.startSec`/`endSec` values in the DB — they're shifted outward by up to ~120ms/200ms and land outside any word's span.

- [ ] **Step 4: Commit**

```bash
git add lib/cut/build.ts
git commit -m "Snap cut points to word boundaries when building the timeline"
```

---

## Task 6: FCP7 transition probe — human checkpoint

This is the one step in this plan that needs a real answer from the user before Task 7 can be written correctly. Sources disagree on whether Premiere's FCP7-XML importer keeps `<transitionitem>` elements or discards them, and the UXP API docs don't mention transitions at all — rather than guess, build a tiny probe file and ask.

**Files:**
- Create: `scripts/generate-transition-probe.ts`

**Interfaces:**
- Produces: a standalone `.xml` file written to `./exports/` (already gitignored — matches where `fcp7.ts`'s real exports land). This script is throwaway tooling, not part of the app's exported interface — it does not import from or modify `lib/export/fcp7.ts`.

- [ ] **Step 1: Write the probe generator**

This intentionally does NOT reuse `buildFcp7Xml` — the whole point is testing a shape (`<transitionitem>`) that function doesn't emit yet, without touching production code before we know if it's worth keeping.

Create `scripts/generate-transition-probe.ts`:

```ts
/**
 * One-off probe: writes a 2-clip FCP7 XML with a video Cross Dissolve and an
 * audio Cross Fade transition at the join, so the user can test-import it
 * into their real Premiere and report whether the transitions survive.
 * See docs/superpowers/specs/2026-07-30-editing-quality-design.md, "Audio
 * smoothing at cut boundaries."
 *
 * Usage: npx tsx scripts/generate-transition-probe.ts <clipA.mp4> <clipB.mp4>
 * Requires two real video files with audio, at least 3 seconds each.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

const [clipAPath, clipBPath] = process.argv.slice(2);
if (!clipAPath || !clipBPath) {
  console.error("Usage: npx tsx scripts/generate-transition-probe.ts <clipA> <clipB>");
  process.exit(1);
}

const FPS = 25;
const CLIP_SEC = 3;
const OVERLAP_SEC = 0.5; // half-second transition, easy to see and hear on import

function frames(sec: number): number {
  return Math.round(sec * FPS);
}

function toFileUrl(filePath: string): string {
  return `file://localhost${encodeURI(path.resolve(filePath))}`;
}

const clipAFrames = frames(CLIP_SEC);
const clipBFrames = frames(CLIP_SEC);
const overlapFrames = frames(OVERLAP_SEC);
const totalFrames = clipAFrames + clipBFrames - overlapFrames;

const rate = `<rate><timebase>${FPS}</timebase><ntsc>FALSE</ntsc></rate>`;

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <sequence id="sequence-1">
    <name>transition-probe</name>
    <duration>${totalFrames}</duration>
    ${rate}
    <media>
      <video>
        <format>
          <samplecharacteristics>
            ${rate}
            <width>1080</width>
            <height>1920</height>
          </samplecharacteristics>
        </format>
        <track>
          <clipitem id="clipitem-video-1">
            <name>clipA</name>
            <enabled>TRUE</enabled>
            <duration>${clipAFrames}</duration>
            ${rate}
            <start>0</start>
            <end>${clipAFrames}</end>
            <in>0</in>
            <out>${clipAFrames}</out>
            <file id="file-1">
              <name>clipA</name>
              <pathurl>${toFileUrl(clipAPath)}</pathurl>
              ${rate}
              <duration>${clipAFrames}</duration>
              <media>
                <video><samplecharacteristics><width>1080</width><height>1920</height></samplecharacteristics></video>
                <audio><channelcount>2</channelcount></audio>
              </media>
            </file>
          </clipitem>
          <transitionitem>
            <name>Cross Dissolve</name>
            <effectid>Cross Dissolve</effectid>
            <start>${clipAFrames - overlapFrames}</start>
            <end>${clipAFrames}</end>
            <alignment>end</alignment>
            <effect>
              <name>Cross Dissolve</name>
              <effectid>Cross Dissolve</effectid>
              <effectcategory>Dissolve</effectcategory>
              <effecttype>transition</effecttype>
              <mediatype>video</mediatype>
            </effect>
          </transitionitem>
          <clipitem id="clipitem-video-2">
            <name>clipB</name>
            <enabled>TRUE</enabled>
            <duration>${clipBFrames}</duration>
            ${rate}
            <start>${clipAFrames - overlapFrames}</start>
            <end>${totalFrames}</end>
            <in>0</in>
            <out>${clipBFrames}</out>
            <file id="file-2">
              <name>clipB</name>
              <pathurl>${toFileUrl(clipBPath)}</pathurl>
              ${rate}
              <duration>${clipBFrames}</duration>
              <media>
                <video><samplecharacteristics><width>1080</width><height>1920</height></samplecharacteristics></video>
                <audio><channelcount>2</channelcount></audio>
              </media>
            </file>
          </clipitem>
        </track>
      </video>
      <audio>
        <track>
          <clipitem id="clipitem-audio-1">
            <name>clipA</name>
            <enabled>TRUE</enabled>
            <duration>${clipAFrames}</duration>
            ${rate}
            <start>0</start>
            <end>${clipAFrames}</end>
            <in>0</in>
            <out>${clipAFrames}</out>
            <file id="file-1"/>
            <sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>
          </clipitem>
          <transitionitem>
            <name>Constant Power</name>
            <effectid>Constant Power</effectid>
            <start>${clipAFrames - overlapFrames}</start>
            <end>${clipAFrames}</end>
            <alignment>end</alignment>
            <effect>
              <name>Constant Power</name>
              <effectid>Constant Power</effectid>
              <effectcategory>Crossfade</effectcategory>
              <effecttype>transition</effecttype>
              <mediatype>audio</mediatype>
            </effect>
          </transitionitem>
          <clipitem id="clipitem-audio-2">
            <name>clipB</name>
            <enabled>TRUE</enabled>
            <duration>${clipBFrames}</duration>
            ${rate}
            <start>${clipAFrames - overlapFrames}</start>
            <end>${totalFrames}</end>
            <in>0</in>
            <out>${clipBFrames}</out>
            <file id="file-2"/>
            <sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>
          </clipitem>
        </track>
      </audio>
    </media>
  </sequence>
</xmeml>
`;

const outPath = path.join("exports", `transition-probe-${Date.now()}.xml`);
writeFileSync(outPath, xml, "utf-8");
console.log(`Wrote ${outPath}`);
console.log("Import this into Premiere and check: does the video show a");
console.log("cross-dissolve and does the audio cross-fade at the join, or");
console.log("does Premiere show a hard cut with no transition?");
```

- [ ] **Step 2: Generate the probe against two real files**

```bash
npx tsx scripts/generate-transition-probe.ts "/Users/ohadfait/Desktop/חליטת תה/<some-file-1>.MP4" "/Users/ohadfait/Desktop/חליטת תה/<some-file-2>.MP4"
```

(If `tsx` isn't installed: `npm install --save-dev tsx` first — it's dev tooling only, not a runtime dependency of the app.)

- [ ] **Step 3: Human checkpoint — stop and wait for the answer**

Hand the generated XML to the user, ask them to import it into their actual Premiere via File → Import, and report back one of:
- **(A) Transitions survived** — the video shows a real dissolve and/or the audio audibly crossfades at the join.
- **(B) Transitions were discarded** — Premiere shows a hard cut at the join, with no dissolve/crossfade, even though the XML imported without error.

Do not proceed to Task 7 until this answer is in hand. Run Task 7a if (A), Task 7b if (B). Do not run both.

- [ ] **Step 4: Commit the probe script (regardless of the answer — it's reusable tooling)**

```bash
git add scripts/generate-transition-probe.ts
git commit -m "Add FCP7 transition-import probe script"
```

---

## Task 7a: Audio crossfade at cut boundaries (run only if Task 6's answer was "transitions survived")

**Files:**
- Modify: `lib/cut/types.ts` (`CutClip`)
- Modify: `lib/cut/build.ts`
- Modify: `lib/export/fcp7.ts`

**Interfaces:**
- Consumes: nothing new from other tasks.
- Produces: `CutClip` gains `audioInSec`/`audioOutSec` (the video's `sourceInSec`/`sourceOutSec` stay the visible cut point; the audio range is intentionally wider, feeding into transition overlap). No change to `buildCutTimeline`'s or `buildFcp7Xml`'s exported function signatures.

- [ ] **Step 1: Add audio-specific in/out to `CutClip`**

In `lib/cut/types.ts`, add to `CutClip` (near the existing `sourceInSec`/`sourceOutSec`):

```ts
/**
 * Audio-only in/out, in source seconds. Deliberately wider than
 * sourceInSec/sourceOutSec by half the crossfade overlap on each side that
 * has a neighbor — the video cut stays exactly where selection put it, only
 * the audio track overlaps into the adjacent clip so a crossfade has
 * material to blend. Equal to sourceInSec/sourceOutSec for a clip with no
 * neighbor on that side (first clip's start, last clip's end).
 */
audioInSec: number;
audioOutSec: number;
```

- [ ] **Step 2: Compute the overlap in `buildCutTimeline`**

In `lib/cut/build.ts`, add a constant near the top:

```ts
/** Audio-only crossfade overlap at each internal join, in seconds. */
const AUDIO_CROSSFADE_SEC = 0.15;
```

After the full `clips` array is built (i.e., after the `for` loop that pushes every clip finishes, still inside `buildCutTimeline`), widen each internal join's audio range:

```ts
for (let i = 0; i < clips.length - 1; i++) {
  const current = clips[i];
  const next = clips[i + 1];
  const halfOverlap = AUDIO_CROSSFADE_SEC / 2;
  current.audioOutSec = Math.min(
    current.sourceDurationSec,
    current.sourceOutSec + halfOverlap,
  );
  next.audioInSec = Math.max(0, next.sourceInSec - halfOverlap);
}
```

And initialize `audioInSec`/`audioOutSec` to match `sourceInSec`/`sourceOutSec` when each clip is first pushed (in the `clips.push({...})` call from Task 5, add these two lines to the pushed object):

```ts
audioInSec: sourceInSec,
audioOutSec: sourceOutSec,
```

- [ ] **Step 3: Emit the audio crossfade transitions in the export**

In `lib/export/fcp7.ts`, the audio clipitem must use `clip.audioInSec`/`clip.audioOutSec` instead of `clip.sourceInSec`/`clip.sourceOutSec` when `mediaType === "audio"`. In `clipItemXml`, change the `<in>`/`<out>` lines to branch on `mediaType`:

```ts
const inSec = mediaType === "audio" ? clip.audioInSec : clip.sourceInSec;
const outSec = mediaType === "audio" ? clip.audioOutSec : clip.sourceOutSec;
```

and use `inSec`/`outSec` in place of `clip.sourceInSec`/`clip.sourceOutSec` in the `<in>`/`<out>` lines a few lines below.

Then, after building `audioClips` in `buildFcp7Xml`, insert a `<transitionitem>` (Constant Power, matching the probe from Task 6) between every pair of adjacent audio clipitems. Add this helper next to `clipItemXml`:

```ts
function audioTransitionXml(
  clip: CutClip,
  timeline: CutTimeline,
): string {
  const sequenceFps = timeline.fps;
  const start = toFrames(clip.timelineEndSec, sequenceFps) - toFrames(AUDIO_CROSSFADE_SEC_EXPORT, sequenceFps);
  const end = toFrames(clip.timelineEndSec, sequenceFps);
  return [
    `          <transitionitem>`,
    `            <name>Constant Power</name>`,
    `            <effectid>Constant Power</effectid>`,
    `            <start>${start}</start>`,
    `            <end>${end}</end>`,
    `            <alignment>end</alignment>`,
    `            <effect>`,
    `              <name>Constant Power</name>`,
    `              <effectid>Constant Power</effectid>`,
    `              <effectcategory>Crossfade</effectcategory>`,
    `              <effecttype>transition</effecttype>`,
    `              <mediatype>audio</mediatype>`,
    `            </effect>`,
    `          </transitionitem>`,
  ].join("\n");
}
```

Add `const AUDIO_CROSSFADE_SEC_EXPORT = 0.15;` near the top of `fcp7.ts` (kept as a separate constant from `build.ts`'s `AUDIO_CROSSFADE_SEC` — they must match in value, but the export module shouldn't import an internal constant from the cut-building module; note this duplication explicitly in a comment on both constants pointing at each other).

In `buildFcp7Xml`, interleave a transition between clips that both have audio and are timeline-adjacent:

```ts
const audioClips: string[] = [];
timeline.clips.forEach((clip, index) => {
  if (!clip.hasAudio) return;
  audioClips.push(clipItemXml(clip, index, timeline, "audio", definedFiles));
  const next = timeline.clips[index + 1];
  if (next?.hasAudio && next.timelineStartSec === clip.timelineEndSec) {
    audioClips.push(audioTransitionXml(clip, timeline));
  }
});
```

(This replaces the existing `.map(...).filter(...)` construction of `audioClips` — same output type, `string[]`, just built with a loop instead of map/filter so a transition can be spliced in after each clip.)

- [ ] **Step 4: Verify well-formed XML on the real project**

Run the export against the חליטת תה project (via the app's existing UI action) and confirm the resulting `.xml` in `./exports/` is well-formed (open it, or run it through any XML parser) and that every internal join's audio track has a `<transitionitem>` between two `<clipitem>`s. Then re-import into Premiere and confirm the crossfade is audible — this is the same manual check as Task 6, just against a real multi-clip export instead of the 2-clip probe.

- [ ] **Step 5: Commit**

```bash
git add lib/cut/types.ts lib/cut/build.ts lib/export/fcp7.ts
git commit -m "Add audio-only crossfades at cut boundaries"
```

---

## Task 7b: Per-clip audio fade in/out (run only if Task 6's answer was "transitions were discarded")

**Files:**
- Modify: `lib/export/fcp7.ts`

**Interfaces:**
- Consumes: nothing new — uses the existing `CutClip.sourceInSec`/`sourceOutSec`.
- Produces: no signature change to `buildFcp7Xml`.

- [ ] **Step 1: Add a short fade via an audiolevels filter on every audio clipitem**

Since `<transitionitem>` doesn't survive import, fall back to a level keyframe pair inside each audio clipitem itself — fade up over the first ~150ms, fade down over the last ~150ms, masking the room-tone jump without depending on a transition element.

In `lib/export/fcp7.ts`, add near the top:

```ts
/** Fade duration at each clip's audio start/end, in frames — computed per clip
 * from its own source fps since <in>/<out> and this filter share that clock. */
const AUDIO_FADE_SEC = 0.15;
```

Add this helper next to `clipItemXml`:

```ts
function audioFadeFilterXml(clip: CutClip, sourceFps: number): string {
  const inFrame = toFrames(clip.sourceInSec, sourceFps);
  const outFrame = toFrames(clip.sourceOutSec, sourceFps);
  const fadeFrames = toFrames(AUDIO_FADE_SEC, sourceFps);
  const fadeInEnd = inFrame + fadeFrames;
  const fadeOutStart = Math.max(inFrame, outFrame - fadeFrames);
  return [
    `            <filter>`,
    `              <effect>`,
    `                <name>Audio Levels</name>`,
    `                <effectid>audiolevels</effectid>`,
    `                <effectcategory>audiolevels</effectcategory>`,
    `                <effecttype>audiolevels</effecttype>`,
    `                <mediatype>audio</mediatype>`,
    `                <parameter>`,
    `                  <parameterid>level</parameterid>`,
    `                  <name>Level</name>`,
    `                  <valuemin>0</valuemin>`,
    `                  <valuemax>3.98107</valuemax>`,
    `                  <keyframe><when>${inFrame}</when><value>0</value></keyframe>`,
    `                  <keyframe><when>${fadeInEnd}</when><value>1</value></keyframe>`,
    `                  <keyframe><when>${fadeOutStart}</when><value>1</value></keyframe>`,
    `                  <keyframe><when>${outFrame}</when><value>0</value></keyframe>`,
    `                </parameter>`,
    `              </effect>`,
    `            </filter>`,
  ].join("\n");
}
```

In `clipItemXml`, right before the final `lines.push(\`          </clipitem>\`);`, add:

```ts
if (mediaType === "audio") {
  lines.push(audioFadeFilterXml(clip, sourceFps));
}
```

- [ ] **Step 2: Verify well-formed XML and listen for the fade**

Export the חליטת תה project again, confirm the XML is well-formed and every audio `<clipitem>` now contains a `<filter>` block with four keyframes, then re-import into Premiere and confirm each clip's audio now fades up/down at its edges instead of cutting hard (a softer effect than a true crossfade, but it directly addresses the reported "audio jumps at the cut" complaint without depending on a transition element Premiere discards).

- [ ] **Step 3: Commit**

```bash
git add lib/export/fcp7.ts
git commit -m "Add per-clip audio fade in/out as an FCP7-transition-free fallback"
```

---

## Task 8: Editorial rubric — stated plan and per-clip beat in the LLM prompt

**Files:**
- Modify: `lib/selection/llm-selector.ts:20-59` (`LlmChoice` type and `buildPrompt`)

**Interfaces:**
- Produces: `LlmChoice` gains `beat: string`. `parseChoices`'s return type and `select()`'s consumption of `choice.reason`/`choice.score` are otherwise unchanged — Task 9 adds validation that reads the new `beat` field plus the existing `index`.

- [ ] **Step 1: Extend the response shape**

In `lib/selection/llm-selector.ts`, update the `LlmChoice` type:

```ts
type LlmChoice = { index: number; score: number; reason: string; beat: string };
```

- [ ] **Step 2: Ask for a stated plan before the picks, and a beat per pick**

Replace `buildPrompt`'s return value (the template literal) with a version that asks for a premise/beat plan up front and a `beat` per selection:

```ts
return `אתה עורך תוכן לרשתות חברתיות. יש לך רשימת רגעים מועמדים מתוך חומר גלם
(כל אחד עם דיבור אם יש, ותיאור חזותי אם נותח). תבחר תת-קבוצה מהם ותסדר אותם
לכדי קאט אחד קצר וקוהרנטי, שמתאים ליעד הבא:

בריף: ${request.brief ?? "(לא ניתן בריף — תבחר את הרגעים הכי חזקים מבחינה חזותית ותוכנית)"}
משך יעד: ${request.targetDurationSec} שניות (זה לא חובה מדויקת, אבל תישאר קרוב)

${SOCIAL_EDITING_GUIDELINES}

רשימת המועמדים (מספר # הוא המזהה שאתה מחזיר):
${items}

לפני שאתה בוחר, תכנן: מה הפרמיסה של הסרטון במשפט אחד, ומה מבנה הביטים
(לדוגמה: הוק, גוף, סיום) שאתה מתכוון לבנות מהם.

רק את המועמדים שאתה בפועל בוחר לקאט הסופי — לא צריך לחוות דעה על כולם.
לכל מועמד שנבחר ציין גם "beat" — איזה חלק מהמבנה שתכננת הוא ממלא (למשל
"הוק", "גוף", "סיום"). "reason" חייב להיות קצר: עד 12 מילים, לא משפט מלא.

החזר אך ורק JSON תקין בפורמט הבא, בלי שום טקסט לפני או אחרי:
{
  "premise": "משפט אחד שמתאר את הרעיון המרכזי של הסרטון",
  "beatPlan": ["הוק", "גוף", "סיום"],
  "selections": [
    { "index": 0, "score": 0.9, "beat": "הוק", "reason": "עד 12 מילים — למה זה ההוק" }
  ]
}
הסדר במערך selections הוא סדר ההופעה בקאט הסופי.`;
```

- [ ] **Step 3: Parse the new fields**

Update `parseChoices` to read `beat` and to also return `premise`/`beatPlan` for Task 9's validation to use:

```ts
type LlmPlan = {
  premise: string;
  beatPlan: string[];
  choices: LlmChoice[];
};

function parsePlan(text: string): LlmPlan {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed.selections)) {
    throw new Error("LLM selection response missing a 'selections' array.");
  }
  return {
    premise: String(parsed.premise ?? ""),
    beatPlan: Array.isArray(parsed.beatPlan) ? parsed.beatPlan.map(String) : [],
    choices: parsed.selections.map(
      (s: { index: unknown; score: unknown; reason: unknown; beat: unknown }) => ({
        index: Number(s.index),
        score: Number(s.score),
        reason: String(s.reason ?? ""),
        beat: String(s.beat ?? ""),
      }),
    ),
  };
}
```

This replaces the old `parseChoices` function entirely (same file, same location) — update the one call site inside `select()` from `const choices = parseChoices(textBlock.text);` to `const plan = parsePlan(textBlock.text); const choices = plan.choices;` (Task 10 will use `plan` more fully when it wires in validation).

- [ ] **Step 4: Manual verification (no unit test here — this task only changes prompt text and parsing, both exercised end-to-end by the real API call in Task 10's verification step)**

Nothing to run standalone yet — `parsePlan`'s parsing logic is simple enough (mirrors the already-shipped `parseChoices` exactly, just with two extra fields) that its correctness is verified together with Task 9's validation tests, which construct fake plan responses.

- [ ] **Step 5: Commit**

```bash
git add lib/selection/llm-selector.ts
git commit -m "Ask the LLM selector for a stated narrative plan, not just a ranked list"
```

---

## Task 9: Validate the plan against the social-editing guidelines

**Files:**
- Modify: `lib/selection/llm-selector.ts`
- Test: `lib/selection/llm-selector.test.ts`

**Interfaces:**
- Consumes: `LlmPlan`/`LlmChoice` from Task 8; `CandidateSegment[]` (shortlist) already used elsewhere in this file.
- Produces: `validatePlan(plan: LlmPlan, shortlist: CandidateSegment[]): { ok: true } | { ok: false; reason: string }` — a new exported pure function, independently testable without any API call. Task 10 calls this inside `select()`.

- [ ] **Step 1: Write the failing tests**

Create `lib/selection/llm-selector.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validatePlan } from "./llm-selector";
import type { CandidateSegment } from "./types";

function candidate(mediaAssetId: string, startSec: number, endSec: number): CandidateSegment {
  return { mediaAssetId, filePath: `/tmp/${mediaAssetId}.mp4`, startSec, endSec, text: "" };
}

describe("validatePlan", () => {
  const shortlist = [
    candidate("a", 0, 2),
    candidate("b", 0, 3),
    candidate("c", 0, 2.5),
    candidate("d", 0, 4),
  ];

  it("accepts a plan with a hook in the first 3 seconds and no clip reused too often", () => {
    const plan = {
      premise: "test",
      beatPlan: ["הוק", "גוף", "סיום"],
      choices: [
        { index: 0, score: 0.9, reason: "hook", beat: "הוק" },
        { index: 1, score: 0.8, reason: "body", beat: "גוף" },
        { index: 2, score: 0.7, reason: "end", beat: "סיום" },
      ],
    };
    expect(validatePlan(plan, shortlist)).toEqual({ ok: true });
  });

  it("rejects a plan whose first clip alone exceeds the hook window", () => {
    const plan = {
      premise: "test",
      beatPlan: ["גוף"],
      choices: [{ index: 3, score: 0.9, reason: "too long to open with", beat: "גוף" }],
    };
    // candidate "d" is 4 seconds — longer than the ~3s hook window on its own.
    const result = validatePlan(plan, shortlist);
    expect(result.ok).toBe(false);
  });

  it("rejects a plan that reuses the same media asset more than twice", () => {
    const repeatedShortlist = [
      candidate("a", 0, 1),
      candidate("a", 1, 2),
      candidate("a", 2, 3),
    ];
    const plan = {
      premise: "test",
      beatPlan: ["הוק", "גוף", "סיום"],
      choices: [
        { index: 0, score: 0.9, reason: "r1", beat: "הוק" },
        { index: 1, score: 0.8, reason: "r2", beat: "גוף" },
        { index: 2, score: 0.7, reason: "r3", beat: "סיום" },
      ],
    };
    const result = validatePlan(plan, repeatedShortlist);
    expect(result.ok).toBe(false);
  });

  it("rejects an empty selection list", () => {
    const plan = { premise: "test", beatPlan: [], choices: [] };
    expect(validatePlan(plan, shortlist)).toEqual({
      ok: false,
      reason: "The plan selected no clips.",
    });
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run llm-selector`
Expected: FAIL — `validatePlan` isn't exported yet.

- [ ] **Step 3: Implement `validatePlan`**

Add to `lib/selection/llm-selector.ts` (needs `LlmPlan`/`LlmChoice` from Task 8 and `CandidateSegment` already imported in this file):

```ts
/** How many seconds into the cut the hook must land, per the researched
 * short-form guidelines already used elsewhere in this prompt. */
const HOOK_WINDOW_SEC = 3;
/** How many times the same source clip may appear before a plan is rejected —
 * this is the exact "reused one long clip four times" failure that motivated
 * building the LLM selector in the first place (see CLAUDE.md). */
const MAX_REUSE_PER_ASSET = 2;

export function validatePlan(
  plan: LlmPlan,
  shortlist: CandidateSegment[],
): { ok: true } | { ok: false; reason: string } {
  if (plan.choices.length === 0) {
    return { ok: false, reason: "The plan selected no clips." };
  }

  const first = shortlist[plan.choices[0].index];
  if (!first) {
    return { ok: false, reason: `Choice at index ${plan.choices[0].index} does not exist in the shortlist.` };
  }
  const firstDuration = first.endSec - first.startSec;
  if (firstDuration > HOOK_WINDOW_SEC) {
    return {
      ok: false,
      reason: `The opening clip is ${firstDuration.toFixed(1)}s, longer than the ${HOOK_WINDOW_SEC}s hook window — the hook must land fast.`,
    };
  }

  const usesByAsset = new Map<string, number>();
  for (const choice of plan.choices) {
    const candidate = shortlist[choice.index];
    if (!candidate) continue;
    const count = (usesByAsset.get(candidate.mediaAssetId) ?? 0) + 1;
    usesByAsset.set(candidate.mediaAssetId, count);
    if (count > MAX_REUSE_PER_ASSET) {
      return {
        ok: false,
        reason: `Media asset ${candidate.mediaAssetId} is used ${count} times, more than the ${MAX_REUSE_PER_ASSET}-use diversity limit.`,
      };
    }
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run to confirm they pass**

Run: `npx vitest run llm-selector`
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/selection/llm-selector.ts lib/selection/llm-selector.test.ts
git commit -m "Add validatePlan to catch hook-timing and source-reuse violations"
```

---

## Task 10: Wire validation into `select()` with a single retry

**Files:**
- Modify: `lib/selection/llm-selector.ts` (`select` method)

**Interfaces:**
- Consumes: `validatePlan` from Task 9, `parsePlan` from Task 8.
- Produces: no change to `select(request: SelectionRequest): Promise<SelectedSegment[]>`'s signature — only its internal behavior (one retry on a validation failure, a clearer thrown error if the retry also fails validation).

- [ ] **Step 1: Extract the "call the model once" logic and add the retry loop**

In `lib/selection/llm-selector.ts`, inside `select()`, replace the single API call with a small retry loop. The method currently does (roughly): build shortlist → one `messages.create` call → parse → budget-cap loop → return. Change it to call the model, validate, and on failure retry once with the failure reason appended to the prompt:

```ts
async select(request: SelectionRequest): Promise<SelectedSegment[]> {
  if (request.candidates.length === 0) return [];

  const shortlist = await this.buildShortlist(request);
  if (shortlist.length === 0) return [];

  const basePrompt = buildPrompt(request, shortlist);
  let plan = await this.requestPlan(basePrompt);
  let validation = validatePlan(plan, shortlist);

  if (!validation.ok) {
    const retryPrompt = `${basePrompt}\n\nהניסיון הקודם שלך נדחה: ${validation.reason}\nתקן את התוכנית כך שתעמוד בכללים ונסה שוב.`;
    plan = await this.requestPlan(retryPrompt);
    validation = validatePlan(plan, shortlist);
    if (!validation.ok) {
      throw new Error(
        `LLM selection plan failed validation twice in a row: ${validation.reason}`,
      );
    }
  }

  const choices = plan.choices;

  // Defensive budget cap: the model is asked to respect targetDurationSec
  // but isn't guaranteed to — stop once the running total goes over rather
  // than trusting it blindly. Order matters here (it's the narrative), so
  // this doesn't reorder or backfill the way the heuristic's greedy pass does.
  const chosen: { candidate: CandidateSegment; choice: LlmChoice }[] = [];
  let total = 0;
  for (const choice of choices) {
    const candidate = shortlist[choice.index];
    if (!candidate) continue;
    const seconds = candidate.endSec - candidate.startSec;
    if (total > 0 && total + seconds > request.targetDurationSec * 1.15) break;
    chosen.push({ candidate, choice });
    total += seconds;
  }

  return chosen.map(({ candidate, choice }, order) => ({
    mediaAssetId: candidate.mediaAssetId,
    startSec: candidate.startSec,
    endSec: candidate.endSec,
    order,
    score: Math.max(0, Math.min(1, choice.score)),
    reason: choice.reason ? `${choice.beat}: ${choice.reason}` : "נבחר על ידי מודל השפה",
  }));
}

private async requestPlan(prompt: string): Promise<LlmPlan> {
  const message = await this.client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("LLM selection response contained no text block.");
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error(
      "LLM selection response was cut off at the token limit before finishing its JSON.",
    );
  }
  return parsePlan(textBlock.text);
}
```

This removes the old inline `messages.create` call from the body of `select()` (now inside `requestPlan`) and the old `parseChoices`/`choices` variable naming (now `plan`/`plan.choices`) — `select()` should have exactly one `this.client.messages.create` call left, inside `requestPlan`.

- [ ] **Step 2: End-to-end verification against the real project**

This exercises a real Anthropic API call (billed, not mockable in a unit test) — run content selection through the app's existing UI on the חליטת תה project and confirm:
- the resulting `Selection` rows' `reason` field now starts with a beat name (e.g. `"הוק: ..."`),
- the total selected duration and clip count are sane (similar ballpark to the previous run reported earlier this session),
- no unhandled "failed validation twice in a row" error — if one occurs, read the two reasons it printed (base attempt and retry) to see whether the prompt from Task 8 needs a wording fix, and iterate before considering this task done.

- [ ] **Step 3: Commit**

```bash
git add lib/selection/llm-selector.ts
git commit -m "Validate the LLM selection plan and retry once on a rule violation"
```

---

## Task 11: Full pipeline re-run and comparison

**Files:** none (verification-only task)

- [ ] **Step 1: Re-run transcription on the חליטת תה project**

Needed so every asset's transcript has the new `words` field from Task 2 — existing transcripts predate this plan and have no word timestamps, which makes Task 5's snapping a silent no-op for them. Use the app's existing "run transcription" action; it's safe to re-run (see CLAUDE.md — `runTranscription` already guards against duplicate concurrent runs and per-file failures don't abort the batch).

- [ ] **Step 2: Re-run content selection, then build the cut and export**

Use the app's existing UI flow end to end.

- [ ] **Step 3: Compare against the previous export from this session**

Open the new `.xml` in `./exports/` alongside the one generated earlier this session (`exports/חליטת-תה-בדיקה-אמיתית-2026-07-30T02-31-52.xml` or whatever the latest one is named). Confirm:
- cut points no longer land exactly on the old transcript segment boundaries (Task 5's effect),
- audio joins either have `<transitionitem>` (Task 7a) or a `<filter>` fade (Task 7b), whichever path Task 6 resolved to,
- selection reasons carry a beat label (Task 10's effect).

- [ ] **Step 4: Real Premiere import**

Import the new export into Premiere (same manual process as the very first XML-import test earlier in this project) and judge, by ear and eye, whether the specific complaint from this session — "נקטעת, אין מעבר חלק" — is actually better. This is the task that closes the loop back to the original feedback; no further automated check can substitute for it.

No commit for this task — it's verification, not a code change. If it surfaces a new bug, that's a new task, not a retroactive edit to this plan.
