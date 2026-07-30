# Editing quality: word-boundary cuts, audio smoothing, editorial rubric

Status: approved by user 2026-07-30. Scope for this spec only — see "Out of scope" below for what comes after.

## Why

Real-footage feedback (חליטת תה project, 38 clips) after the vision/LLM-selector work landed:

> "התוצא עבדה טוב רק שהתוכן והעריכה לא מספיק טובה... היא נקטעת אין מעבר חלק ביניהם ולא בסאונד שיש שם."

Two mechanical root causes were confirmed by reading the current code, not guessed:

1. **`scripts/transcribe.py:28` sets `word_timestamps=False`.** Every cut boundary is wherever faster-whisper closed a sentence — often mid-breath, never aligned to an actual word. There is no way to cut cleanly without word-level timestamps.
2. **`lib/export/fcp7.ts` and `lib/cut/build.ts` contain zero transitions, fades, or overlap.** `build.ts`'s own comment says so directly: "butt-joined sequence... no transitions." Every cut is a hard video+audio cut at the same instant, so background-noise/room-tone jumps are audible on every join.

Research into how Opus Clip / Descript / Submagic / DaVinci actually work (see prior turn's sources) confirmed the same 5-stage pipeline shape we're already following, and specifically that:
- word-level ASR timestamps are the industry baseline this project is missing,
- J-cuts/L-cuts + short crossfades are the standard fix for the exact "audio jumps at the cut" complaint,
- competitors score candidates on decomposed dimensions (Hook/Flow/Trend), not one fuzzy number.

User's explicit scope decision (via AskUserQuestion, this session): **audio smoothing only** for now (no music-bed layer) — "לא נוגע במיקס הסופי" already matches the project's MVP automation boundary in CLAUDE.md. And: **fix quality on the existing 38-clip project first**, multi-video-per-folder generation comes after.

## Approach

Three independent changes, each behind the same interfaces already in place (`Transcriber`, `ContentSelector`, FCP7 export) so nothing about the vendor-neutral architecture changes:

### 1. Word-boundary snapping

- `scripts/transcribe.py`: flip `word_timestamps=True`, add each segment's `words: [{word, start, end}]` to the JSON it already emits.
- `lib/transcription/types.ts`: add optional `words?: {word: string; startSec: number; endSec: number}[]` to `TranscriptSegment`. Optional so a future non-word-level transcriber (cloud vendor) still satisfies the interface.
- `Transcript.segmentsJson` already stores arbitrary JSON — **no Prisma migration needed**, the new `words` array just rides inside the existing blob.
- New `lib/cut/snap.ts`: `snapToWordBoundary(startSec, endSec, words[]): {startSec, endSec}`. Moves `startSec` to the start of the first word it falls inside minus a ~120ms pre-roll (clamped to 0 and to the previous word's end), moves `endSec` to the end of the last word it falls inside plus a ~200ms breath tail (clamped to the next word's start). A boundary with no matching words (silent clip, candidate built from visual analysis alone) passes through unchanged.
- Applied once, in `lib/cut/build.ts`, right before a `Selection` becomes a `CutClip` — after the user has already approved the selection, so approval always reflects real content, only the millisecond-level edges move.

### 2. Audio smoothing at cut boundaries

This branches on one fact we don't have yet: **does Premiere actually import `<transitionitem>` from FCP7 XML, or does it strip effects on import?** Sources disagree (one says XML carries only clips/tracks/timing, not effects; UXP's own docs don't mention transition APIs at all). Rather than build on an assumption, produce a 2-clip probe XML with a Cross Dissolve (video) + Cross Fade (audio) transition and have the user test-import it into their real Premiere. That answer decides which of these two paths gets built:

- **If transitions survive import:** `lib/cut/build.ts` gives adjacent clips a small overlap (2-4 frames, computed from the *audio* track only — video cut point stays exactly where selection put it, this is intentionally an audio-only L-cut, not a visual dissolve, since the user asked for "audio smoothing" specifically). `lib/export/fcp7.ts` emits a `<transitionitem>` Cross Fade on the audio track spanning that overlap. Requires splitting `CutClip`'s single in/out range into a separate audio range from the video range — today they're identical.
- **If transitions don't survive import:** fall back to a short fade-in/fade-out per clip's audio via a `<filter>` audiolevels keyframe pair at the very start/end of each audio clipitem (no overlap needed, still masks the room-tone jump, less smooth than a true crossfade but doesn't depend on a feature Premiere might discard).

Either way this is additive to `fcp7.ts`/`build.ts` — no interface changes, no schema changes.

### 3. Editorial rubric for the LLM selector

Today `lib/selection/llm-selector.ts` asks for one `score` per candidate and free-text `reason`. Replacing with:

- **A stated plan first.** The prompt asks for a one-line premise and an ordered list of narrative beats (hook / body / payoff — or however many the brief implies) *before* it lists chosen clips, and each chosen clip must declare which beat it fills. This mirrors Opus's decomposed Hook/Flow/Trend scoring instead of one fuzzy number, and gives the user something legible to look at in the approval UI instead of just a ranked list.
- **Response shape** (`LlmChoice` in `llm-selector.ts`) gains `beat: string` and splits `score` into `hookScore`/`flowScore` is overkill for what's needed here — keep one `score` but require `reason` to name the beat, e.g. `"הוק — 2 שניות ראשונות"`. (Decided against a full rubric object: the existing budget-cap loop and approval UI only consume `score`/`reason`; a heavier response shape earns its complexity only once the UI actually surfaces per-dimension scores, which it doesn't yet.)
- **Hard validation in code, not just prompt instructions** — a plan that violates a stated rule should be caught, not silently accepted:
  - first selected clip's `startSec` offset within its own narrative position must put the hook within the first ~3s of the assembled cut (already knowable from `SOCIAL_EDITING_GUIDELINES`),
  - no `mediaAssetId` chosen more than N times (source diversity — today nothing stops the model from reusing one clip four times, which was the original complaint that motivated building the LLM selector at all),
  - reject and retry once (single retry, not a loop) if either check fails, surfacing the failure reason back to the model in the retry prompt.
- `SOCIAL_EDITING_GUIDELINES` (already Hebrew, already sourced) is the source of truth for the numeric thresholds used in validation, so the prompt text and the code check can't drift apart silently.

## Data flow (updated)

```
transcript segments (+ words[]) ──┐
                                   ├─> selection candidates (unchanged shape)
visual analysis ───────────────────┘
        │
        v
  LLM/heuristic select → Selection rows (unchanged schema)
        │
        v
  buildCutTimeline: snapToWordBoundary() applied per clip
        │
        v
  CutClip (video range unchanged; audio range gets ±overlap if transitions confirmed)
        │
        v
  buildFcp7Xml: <transitionitem> Cross Fade OR per-clip audiolevels fade
```

## Testing

- `snapToWordBoundary`: unit tests with hand-built word arrays — word found mid-boundary, boundary already on a word edge, no words (pass-through), boundary past all words (clamp).
- FCP7 probe file: hand-built 2-clip `CutTimeline`, real user test-import — this is the one step that needs a human, not an automated check, because it's answering a Premiere-version-specific import question.
- LLM selector validation: unit tests against fixed shortlists — one that should pass, one with a late hook, one with 4x reuse of one asset, confirming the retry path fires and a second bad response surfaces a clear error rather than silently shipping a bad cut.
- End-to-end: re-run the full pipeline on the existing חליטת תה project (already ingested, transcribed, visually analyzed) and diff the new export's cut points and reasons against the previous run reported earlier this session.

## Out of scope (explicitly, for this spec)

- Music bed / background audio layer — user chose "smoothing only" this round.
- Multiple distinct videos generated from one folder — user chose "fix quality first."
- Video-side dissolves/wipes, reframing/cropping to 9:16, burned-in captions, Premiere UXP plugin — all separately tracked in CLAUDE.md's pipeline stage list and decision log; UXP specifically is blocked on transitions/effects APIs not existing yet as of Premiere 26.3 per this session's research.
