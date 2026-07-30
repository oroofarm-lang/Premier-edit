# B-roll: independent audio and video sources per selected moment

Status: approved by user 2026-07-31.

## Why

Real-footage testing (חליטת תה, reduced 11-clip set) confirmed the LLM selector now produces genuinely diverse, hook/body/close-structured cuts (see Progress Log, 2026-07-30/31). But every chosen moment still hard-couples its audio and video to the same source range — one file drives both tracks. User feedback:

> "בונים סיפור דרך הסאונד של הדיבור והתוכן המילולי וגם מספרים סיפור ע"י הוידיאו... צריך לעשות הפרדה בינהם ולפעמים לשים וידיאו אחר ממה שהסאונד המקורי שלו."

A cut tells its story through two separate channels — spoken narration and visual content — and the right visual for a beat isn't always the clip that happens to carry that beat's audio. This is the standard documentary/reels B-roll cutaway: keep the narration audio running, cut the video to something more interesting than a static talking-head shot.

Decided (via direct questions, this session):
- **Fully automatic** — the LLM decides both what's said and what's shown, same as it already decides beat order.
- **B-roll comes only from clips already selected elsewhere in the same plan** — never a clip nobody chose otherwise. Simpler to reason about and validate; a wider "any candidate" pool is a possible future step, not needed now.
- **Duration mismatches are resolved by deterministic code, not the LLM** — the model just points at a good visual; frame-accurate extension/trimming is mechanical, same philosophy as `snapToWordBoundary`.

## Approach

### 1. Selection: `videoFrom` on a chosen moment

`llm-selector.ts`'s existing per-choice JSON (`index`, `score`, `beat`, `reason`) gains one optional field:

```json
{ "index": 4, "score": 0.9, "beat": "גוף", "reason": "...", "videoFrom": 2 }
```

`videoFrom` is a shortlist index, exactly like `index` — pointing at a *different* shortlist entry whose video should play during this moment's audio. Omitted in the normal case (moment uses its own video).

Prompt instruction: point here only when this moment's own footage is not the strongest visual for its beat (e.g. a static talking-head shot) and a *different moment already being chosen* has a better visual — otherwise omit the field.

**Validation** (`validatePlan`, already the home of the hook-window and source-diversity checks): if `videoFrom` is present, its target index must exist in the shortlist **and** also appear as the `index` of another entry in `plan.choices` — i.e. it must genuinely be one of the moments this same plan is already selecting. **No chaining**: the target entry itself must not carry its own `videoFrom` — a moment's video always resolves in one hop, never through another override. A violation of either rule fails validation and triggers the existing single-retry path, same as the other two rules.

**Storage**: `Selection` gains three nullable columns — `videoAssetId String?`, `videoStartSec Float?`, `videoEndSec Float?` (with a distinct Prisma relation name from the primary `mediaAssetId` relation, since a row can now reference two different `MediaAsset`s). Populated only when `videoFrom` was present; a normal moment's row is byte-for-byte what it is today. Requires a migration.

`llm-selector.ts` resolves `videoFrom`'s shortlist index to a concrete `{mediaAssetId, startSec, endSec}` at selection time (it already has the shortlist in scope) and writes it onto the returned `SelectedSegment` as an optional `videoOverride` field.

### 2. Cut builder: resolving duration mismatches

Pure, testable function in `lib/cut/build.ts`, run once per moment that has a `videoOverride`, using that override's own source clip's real ffprobe duration (`MediaAsset.durationSec`, already tracked):

1. **B-roll segment ≥ audio duration** — trim it to exactly the audio's duration, starting from the point the model picked. It shouldn't run past the speech it illustrates.
2. **B-roll segment < audio duration** — extend the *out* point forward first, up to the source clip's real full duration. If still short, extend the *in* point backward too, down to 0.
3. **Still not enough even fully extended** (source clip genuinely too short) — drop the override for that one moment; use its own original video instead. No looping, no freeze-frames, no gaps — silently falls back to today's behavior for that moment only.

This keeps the LLM's job purely editorial (point at a good visual) and keeps all frame-accurate boundary math in one deterministic, unit-testable place.

### 3. `CutClip`: additive, not restructured

All existing fields (`filePath`, `sourceInSec`, `sourceOutSec`, `audioInSec`, `audioOutSec`, `timelineStartSec`, `timelineEndSec`, `sourceDurationSec`, `fps`, `width`, `height`) are unchanged and continue to describe the audio side. One new optional field:

```ts
videoOverride?: {
  filePath: string;
  fileName: string;
  sourceInSec: number;
  sourceOutSec: number;
};
```

Absent → identical to today's behavior, no other code needs to change. Present → the video track uses `videoOverride`'s file/in/out; the audio track keeps using the clip's own fields as it always has.

### 4. Export and panel: placing two sources instead of one

- **`lib/export/fcp7.ts`**: the `<video>` clipitem branch is built from `clip.videoOverride ?? clip`; the `<audio>` branch always from `clip` itself. The existing "define each `<file>` exactly once, reference by id thereafter" rule now potentially applies to two files per cut instead of one — no change to that rule, just more files satisfying it.
- **`premiere-panel/build-sequence.js`**: when `videoOverride` is present, two separate `createOverwriteItemAction` calls are made (video track from the override's source, audio track from the moment's own source) instead of the current single shared placement. Both still go through the existing `lockedAccess`/`executeTransaction` wrapper.

### 5. UI

The approval screen (`app/projects/[id]/page.tsx`) shows one extra line under a moment's existing reason, only when overridden: e.g. "🎥 וידיאו מ: 0X7A1668.MP4" — visible before the cut ever reaches Premiere.

## Data flow (updated)

```
LLM selection (shortlist) ──> per choice: {index, score, beat, reason, videoFrom?}
        │
        v
validatePlan: hook-window + diversity + videoFrom-is-a-final-pick checks (single retry)
        │
        v
SelectedSegment (+ optional videoOverride: {mediaAssetId, startSec, endSec})
        │
        v
buildCutTimeline: snapToWordBoundary (existing) + resolve videoOverride duration
  (trim / forward-extend / both-directions extend / fallback-to-self)
        │
        v
CutClip (unchanged fields = audio; + optional videoOverride = video)
        │
        ├─> buildFcp7Xml: <video> from videoOverride ?? clip, <audio> from clip
        └─> build-sequence.js: two overwrite actions when videoOverride present
```

## Testing

- Duration-resolution function: trim (B-roll long enough), forward-extend only, forward+backward extend, and give-up-and-fallback (source too short even fully extended).
- `validatePlan`: a plan where `videoFrom` points at a valid shortlist entry that's also a final pick (passes), and one where it points at a shortlist entry that was *not* otherwise chosen (fails, triggers retry).
- `llm-selector.ts` parsing: a response with `videoFrom` present and one without, confirming `videoOverride` is only set in the first case.

## Out of scope

- B-roll sourced from clips outside the final selection (wider candidate pool) — noted as a possible future step, not needed now.
- Any overlay/compositing (picture-in-picture, split screen) — this is a straight video-track *replacement* per moment, matching the MVP's "rough assembly only" automation boundary. Still a single V1/A1 pair, not multiple video tracks.
- Looping or freeze-framing short B-roll — the fallback is to not swap, not to fabricate extra frames.

## Where this lands

As more tasks on the existing `editing-quality` branch/plan — this builds directly on `validatePlan`'s already-reviewed retry mechanism (Tasks 8-10) rather than opening a new branch.
