# Two timelines: audio spine, video dressing

**Date:** 2026-08-01
**Status:** approved, replaces the current single-selection model

## Why

The user described how they actually edit, and it is not what the system does.

They build **two timelines**. First an audio timeline: take all the speech — from the video files' own audio when there is no separate audio folder, from both when there is — understand the words, and build the story from the words alone. Hook, structure, order, all decided on content. That produces a spoken spine sitting in the sequence. Then they lay **video over it**, and the video does not have to be the picture that came with that audio. Video is chosen on feel: which shot is beautiful, which camera move completes, which frame earns its place.

The current system inverts this. `runContentSelection` picks *moments* where audio and picture travel together, and `Selection.videoOverride` is a documented exception for the occasional B-roll cutaway. Which means the picture is always chosen in service of the audio, and always compromises. That is the most likely structural reason behind the standing complaint that the cuts pick the wrong moments — the system was never choosing picture on its own merits at all.

This also explains why the B-roll override "never fires on its own" (open question in [[Decisions and Open Questions]]): it was modelled as an exception to a rule that should not have been the rule.

## Decisions taken 2026-08-01

Four questions were asked before designing. The answers:

1. **What makes one shot better than another**, given twenty shots of the same thing: **camera movement that completes** (starts and settles, not cut mid-move) and **stability/sharpness**. Composition/light and "a real human moment" were explicitly *not* chosen. This is the single most consequential answer in the document — both selected signals are measurable locally with ffmpeg, so the primary shot-quality judgment costs nothing.
2. **When to keep the speaker's own picture in sync**: only when that shot is genuinely good. A per-moment decision, not a global rule.
3. **How fast video changes relative to audio**: by meaning — a shot changes when the content advances or when the shot has exhausted itself. Not a fixed cadence.
4. **Does this replace the current model**: yes. Not a second mode.

## Architecture

```
ingest → transcription (all audio, video files included)
   ↓
[A] audio story      words only → the spine, ordered
   ↓
[B] shot catalogue   all footage, independent of speech → candidate shots + quality
   ↓
[C] video layout     dress the spine with shots, by meaning
   ↓
build: A1 = spine · V1 = shots        (two tracks, already supported)
```

### Cost, stated plainly

| Layer | Costs tokens? | What |
|---|---|---|
| Shot segmentation | No | ffmpeg scene detection + motion-curve windowing |
| Shot quality | No | motion completeness, stability, sharpness, exposure |
| Audio story | Yes — 1 call | the existing selection call, with vision input removed |
| Shot description | Yes — 1 call | vision, **only on shots that survive the free filter** |
| Video layout | Yes — 1 call | placing described shots over the spine |

Three calls, the same as today. The deterministic filter running *before* vision is the cost control that makes analysing ten minutes of wedding footage affordable: a bad shot is rejected by arithmetic, never described by a model.

### [B] Shot catalogue — the new part, and the part already verified

Two sources of shot boundaries, because real footage has both problems:

- **Cuts between shots** — `scdet=threshold=12`. Handles multi-shot files.
- **Windows inside one long take** — the harder and more common case. The user's example is five minutes of table setting yielding twenty possible shots; verification against a real 55s clip from `חליטת תה copy` found **zero** scene cuts, because it is one continuous handheld take. Scene detection alone would have produced one useless 55-second "shot".

The motion curve solves the second case. Measured per clip:

```
fps=10,scale=240:-2,tblend=all_mode=difference,signalstats,
metadata=print:key=lavfi.signalstats.YAVG:file=<out>
```

This emits a plain-text time/value series — 10 samples per second — where the value is the mean luma of the difference between consecutive frames, i.e. how much the picture changed. **Verified on real footage before this document was written**, not assumed:

- 55s clip, 549 samples, 15.5s to compute — about 3.5× realtime, comparable to transcription.
- Distribution: mean 9.6, p10 6.4, p50 9.6, p90 12.8, max 21.6 — a real spread, not noise.
- Windowing at ≤p40 for ≥1.5s found four usable windows: 4.9–6.4s, 7.2–8.9s, 27.0–29.5s, 40.2–42.9s.

From the curve, per candidate window:

- **`stability`** — inverse of mean motion across the window.
- **`movementCompleteness`** — does the window *end* settled? A window whose motion is still high at its final samples was cut mid-move, which is the defect the user named first. This is the ranking signal that matters most.
- **`sharpness`** — `blurdetect`, available in this build.
- **`exposure`** — `signalstats` YMIN/YMAX for crushed blacks and blown highlights.

> **Honest limitation, to be recorded rather than discovered later.** Frame differencing measures *visual change*, which conflates camera motion with subject motion. Someone pouring tea in front of a locked-off camera reads as high motion. `vidstabdetect` measures true camera transform and would separate them, but ffmpeg 6.0 writes its `.trf` result as a binary `TRF1` file, not the older human-readable text format — parsing it is real work and is deferred. Frame differencing is used because it is text, cheap, and verified working today. Where it misjudges, the vision pass is the backstop.

### Verifier tools were checked, not assumed

`ffmpeg-static` ships **6.0**, and `scdet`, `select`, `vidstabdetect`, `blurdetect`, `signalstats`, `showinfo`, `freezedetect`, and `metadata` are all present in this build.

### [A] Audio story

The existing `LlmContentSelector` with visual input removed and its output reinterpreted as a spine rather than a finished cut. Every expert it already consults stays: `hook`, `narrative-structure`, `platform-*`, `pacing`, `hebrew`. A silent-but-beautiful clip no longer needs to reach this stage at all — it belongs to the video layer, which is where it was always going to be useful.

### [C] Video layout

One call over the spine plus the surviving described shots. Rules, drawn from the answers:

- Change shot when the content advances or the shot exhausts itself — no fixed cadence.
- Keep the speaker's own picture only where that shot passes the quality filter; cover it otherwise.
- Prefer windows with high `movementCompleteness`.
- No repeats; spread across sources.
- Cover the full spine duration, with no gaps.

**Source audio is off by default.** A placement may optionally carry its own clip's audio, for sound effects. The user's framing: with speech, the audio is already built, so the clip's own speech is noise — but a knife on a board is worth keeping. Modelled as `VideoPlacement.useSourceAudio`, default `false`.

## Schema

The two layers have different counts and different boundaries — ten spoken moments may be covered by twenty-five shots or by six — so one table cannot carry both.

- **`Shot`** — `mediaAssetId`, `startSec`, `endSec`, `stability`, `movementCompleteness`, `sharpness`, `exposure`, `qualityScore`, `source` (`scene-cut` | `motion-window`).
- **`VideoPlacement`** — `projectId`, `order`, `shotId`, `timelineStartSec`, `timelineEndSec`, `useSourceAudio`, `reason`.
- **`Selection`** keeps its meaning as the audio spine. `videoOverride` becomes redundant once `VideoPlacement` exists and is removed in the phase that lands the layout stage — not before, so nothing breaks mid-migration.

## Phases

1. **Shot catalogue.** `lib/shots/` — detection, motion curve parsing, quality math, `Shot` persistence. Pure functions, unit-tested, verifiable end-to-end against real footage with no API key and no cost. Ships first because it is the foundation and the only phase that can be fully proven locally.
2. **Audio spine.** Strip vision from selection; reframe output.
3. **Video layout.** The third call, `VideoPlacement`, plus a `cinematography` expert encoding the two chosen quality signals.
4. **Build both tracks.** Panel and FCP7 export place spine on A1 and placements on V1. The panel already does two-track placement for B-roll, so this extends proven code.
5. **Review UI.** Two timelines shown separately in the panel, since that is how the work is actually thought about.

## Boundaries held

Unchanged: rough assembly only, no colour, no effects, no fades, no caption burn-in. Three approval checkpoints. The video layer is a proposal the user approves like everything else.

## Verification

Per phase: `tsc` and `vitest` clean; every new pure module unit-tested. Phase 1 additionally verified against real clips in `חליטת תה copy` by inspecting the detected windows directly — the numbers in this document came from that run and are the baseline to compare against. Behaviour inside real Premiere remains the user's own step.
