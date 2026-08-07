---
title: Tech Stack
tags:
  - project/reference
aliases:
  - Stack
---

# Tech Stack

Part of [[Premier Edit]].

| Layer | Technology | Notes |
|---|---|---|
| UI + orchestration | Next.js 14 (App Router) | pinned — `create-next-app@latest` currently ships Next 16 |
| Styling / components | Tailwind CSS v3 + shadcn/ui | shadcn's CLI now defaults to Tailwind v4 + Base UI — see warning below |
| Data | Prisma 6.19.3 + SQLite | pinned — `prisma@latest` is now a v7 with a different config paradigm |
| Local media layer | ffmpeg / ffprobe (npm static binaries) | see gotchas below |
| Transcription | faster-whisper `large-v3` in a local Python venv | behind a `Transcriber` interface |
| Shot analysis | ffmpeg filters (`scdet`, `blurdetect`, `signalstats`, `tblend`) | **free** — no key, no model; see Two timelines |
| Visual understanding + editorial judgement | Anthropic API (`@anthropic-ai/sdk`), `claude-haiku-4-5` (vision) + `claude-sonnet-5` (selection, video layout) | `ANTHROPIC_API_KEY` in `.env`. **Optional** — every stage has a heuristic fallback and the pipeline runs end to end without it |
| Premiere bridge | UXP panel (`premiere-panel/`, Stage 2) + FCP7 XML export (Stage 1, fallback) | Both implemented; panel is the primary path — see below |

> [!bug] shadcn/ui version trap
> `npx shadcn init` defaults today to Tailwind v4 conventions and the **Base UI** component library, neither of which match this project (Tailwind v3, **Radix UI**). Left unchecked this breaks the build with errors like `border-border` / `outline-ring/50` not existing, and a bad `next/font/google` import for `Geist` (not a real Google font).
>
> Fix already applied in the repo: `components.json` pinned to `"base": "radix"`, colors in `app/globals.css` stored as raw decomposed OKLCH components (`--ring: 0.708 0 0;`) with `tailwind.config.ts` wrapping them as `oklch(var(--x) / <alpha-value>)` so opacity modifiers (`bg-primary/80`) work under v3.

## Build and runtime traps

These four break things silently rather than loudly, and each cost a debugging session. Kept here rather than in `CLAUDE.md` so that file stays a short index — see [[Decisions and Open Questions]] on token discipline.

> [!bug] ffmpeg/ffprobe must stay external to the Next bundle
> `ffmpeg-static` and `@ffprobe-installer/ffprobe` ship native binaries and non-JS files, so they must remain listed in `next.config.mjs` under `experimental.serverComponentsExternalPackages`. Bundling them fails the build.

> [!bug] A relative `DATABASE_URL` resolves against the importing bundle, not the repo root
> `file:./dev.db` works from a server action (bundled near the root, finds `prisma/dev.db`) and silently **creates a fresh empty database** from a route handler (bundled into `.next/server/app/api/<route>/`). Every query then fails with `table \`main.Project\` does not exist` (P2021) while `prisma/dev.db` sits fine on disk. `lib/db.ts` now resolves the URL against `process.cwd()` first. If P2021 ever appears on a route that works from a page, check which file the process actually opened — `lsof -p <pid> | grep '\.db'`. The error names the table, not the wrong file.

> [!bug] The vision model describes each frame separately unless told not to
> Three frames sampled from one clip produced 2–3 concatenated JSON objects that failed `JSON.parse`, often after blowing the token budget. Two fixes, both needed: the prompt states explicitly that multiple frames describe *one continuous clip* and asks for exactly one object even when content changes across them, and `lib/vision/claude-vision.ts` extracts the first balanced-brace object rather than trusting the whole response to be valid.

> [!bug] Quiet is not the same as "no speech" — a stop consonant's closure is silence
> The measured-quiet trim cut *inside* the word `בא` (timed 1.66–2.18s, measuring −39dB across 1.71–1.99s), leaving `נמרוד,` + `לך על כוס תה?` — broken Hebrew, shipped to the user. A level check alone cannot catch it: the span genuinely is quiet, and only the transcript knows a word is standing there. **ffmpeg decides where it is quiet; the transcript decides where cutting is allowed** — `rejectRegionsOverlappingWords` in `lib/craft/quiet.ts`. The trim is also opt-in (`--trim-silence`) because the user does not mind pauses and every removal adds a cut.

> [!bug] Word-level cutting is the wrong default — a validated script can still be incoherent
> Guidance used to say mid-sentence cutting "is usually where the good writing is." It produced `הרכיב הראשון,` announcing an ingredient and never naming it, then `הרכב השני`, plus `תמסוג` orphaned from its `יאללה` — and the user's verdict was *"המילים פשוט לא מתחברות"*. **Every line passed `validateScript`**, because the anti-fabrication gate proves each word was really said and cannot see whether words *connect*.
>
> A line is **one continuous, complete run of speech**; merge adjacent segments into one long line rather than splitting them; fewer cuts is a feature; a clause keeps its setup (`אבל פה זה צמח מדברי` cannot open a line — the `אבל` answers `כולנו יודעים ש…`). The one check that catches this class: **read the script aloud as one paragraph**, end to end, before trusting it.

> [!bug] A transcript measures words, not sound — dead air can hide *inside* a word
> `lib/craft/silence.ts` looks for gaps *between* words and is structurally blind to the defect that reached the user's ear. faster-whisper often reports no gap at all, absorbing a pause into a neighbouring word's own span: `מרווה` in `0X7A1692` is reported as 1.57–2.85s while the level profile shows −34 to −38dB for the first 0.95s and speech only in the last third. The previous word ends at exactly 1.57, so there is nothing for a gap rule to see. `lib/craft/quiet.ts` measures with ffmpeg instead.
>
> **Pick the threshold off the noise floor's peaks, not its mean.** Speech means −12 to −20dB and quiet means −33 to −39dB argue for −28dB, which finds *nothing*: `silencedetect` needs a continuous run below the threshold, and this footage's room tone peaks at −23.7dB inside the quiet. `QUIET_NOISE_DB` is −22 and stable (−22 → 1.018s, −20 → 1.028s).
>
> **`MIN_FRAGMENT_SEC` (0.7) is a picture floor — never apply it to audio.** It matches `MIN_PLACEMENT_SEC` so a shot is never a flicker. Used on the spine it discarded the 0.38s fragment carrying `מרווה` itself: deleting a word to remove a pause. `planCleanup` takes `minFragmentSec`; the spine passes `MIN_SPINE_FRAGMENT_SEC` (0.3).
>
> Validate a removal by measuring the level *inside* it — a loud one means speech is being cut. That check is what caught the dropped word.

> [!bug] Splitting a run of speech at word boundaries is not a cut
> `CONTIGUOUS_JOIN_SEC` (0.05s) in `lib/script/validate.ts` warns when two consecutive script lines come from the same clip with no audible gap. A critic reading a real script found 7 of 14 joins were the same take resuming exactly where it stopped, so a "15 line" cut was **8 moments** to a listener, with one 9.5s unbroken take inside it. Every line validated individually — the fault is in the *seam*, which no per-line rule can see. The validator now reproduces that count as arithmetic so a critic does not have to notice it.

Tuning constants worth knowing before changing them: `SYNC_BONUS` 0.20 (a judgement, sized against `REUSE_PENALTY` 0.12) and `MAX_SYNC_RUN` 2, both in `lib/video/heuristic-layout.ts` — an unbroken run of sync is just the untouched take.

## Prisma specifics

- Import `PrismaClient` from `@/lib/generated/prisma/client` (enums from `.../enums`), **not** `@prisma/client` — the schema uses the newer `prisma-client` generator with a custom output path, and there is no barrel `index.ts`, so the bare folder path fails to resolve.
- Config lives in `prisma.config.ts`, not just `.env` — Prisma 6+ no longer auto-loads `.env` on its own.
- Schema models the 8 entities from the PRD's data model section (`Project`, `MediaAsset`, `Transcript`, `Selection`, `Timeline`, `EditVersion`, `StylePreference`, `ApprovalCheckpoint`) plus a `VisualAnalysis` model added alongside `Transcript` for per-clip vision understanding.

## Ingest gotchas found on real camera footage

Two ffprobe subtleties that synthetic test clips never surfaced:

> [!bug] Frame rate: prefer `r_frame_rate` over `avg_frame_rate`
> `avg_frame_rate` (frame-count / duration) comes out slightly off per file — e.g. `49.81` for footage that's actually a clean 50fps — which wrongly trips the FCP7 NTSC flag. `r_frame_rate` is the container's declared nominal rate and what every NLE actually uses.

> [!bug] Rotation metadata: raw width/height isn't display orientation
> Phones and cameras routinely store frames landscape and flag a 90/270° rotation to apply at playback. Missing this took footage shot vertically for social media straight into a horizontal Premiere sequence. Fixed by reading `side_data_list` Display Matrix rotation (falling back to the legacy `tags.rotate`) and swapping width/height on a quarter turn.

## Visual understanding + smart selection

Added after real-footage testing showed the no-API heuristic selector's limits — see [[Decisions and Open Questions]] for the budget decision this required. Architecture mirrors `Transcriber`: a `VisionAnalyzer` interface, one implementation (`claude-haiku-4-5`, cost-efficient for short captioning-style descriptions). Frames are sampled **per transcript segment**, not per whole file — `VisualAnalysis` is keyed on `(mediaAssetId, startSec, endSec)`, so two different moments in one long clip get their own description instead of sharing one file-level summary (this was a real bug: it's part of why the B-roll override, below, rarely had a visual reason to fire). ffmpeg auto-applies rotation when extracting frames, so no manual correction is needed there.

The `LlmContentSelector` (`claude-sonnet-5`) pre-filters candidates with the existing heuristic to keep its prompt bounded, then makes the actual editorial call informed by researched short-form social editing norms (hook within 1-3s, avoid a 30-40s "dead zone," ~1.5-2.5s average cut frequency) and a set of **named per-`OutputProfile` story structures** (e.g. "הוק-תוצאה" for reels, "בעיה-פתרון" for longer posts) it picks or blends between, instead of inventing a beat plan from nothing every run. `runContentSelection` auto-upgrades from heuristic to LLM based on whether `ANTHROPIC_API_KEY` is set — same UI button either way.

`ContentSelector.select()` returns `{ selections, premise?, beatPlan?, shortlist? }`, not a bare array — the LLM's one-sentence narrative premise, its chosen structure, and its full pre-filter shortlist (previously computed and discarded) now persist on the `Project` row and render in the UI: a premise/structure line above the picks, and a collapsible list of every candidate considered but not chosen.

**B-roll (audio/video separation):** a selected moment's audio and video don't have to come from the same clip. `Selection` carries optional `videoAssetId`/`videoStartSec`/`videoEndSec` — when set, the moment's picture comes from a different already-selected moment while the audio stays put. Duration mismatches are resolved deterministically (trim, then forward-extend, then backward-extend, then give up) in `lib/cut/video-override.ts`. The LLM prompt also self-extracts explicit brief constraints ("must include X" / "must not include Y") into a `constraints` field, and `validatePlan` mechanically checks the final picks against them — the model can't just state an intent and then ignore it.

**Multiple output profiles from one project:** `outputProfile` used to be fixed at project creation with no way to try another length without a separate project (re-ingesting the same footage). `runContentSelectionAllProfiles()` shares one vision-analysis pass across all three profiles, runs the three profile-specific selector calls concurrently, and stores them as a preview (`Project.multiProfilePreviewsJson`) the user can compare before `applyProfilePreview()` promotes one into the real `Selection` + switches `outputProfile` — Cut/Export/the panel need no changes, they just see the active selection changed.

**Conversational refinement (`lib/selection/refine.ts` + `refine-plan.ts`):** a cut can be edited by instruction instead of only re-rolled from scratch. The user types Hebrew ("תוריד את הרגע האחרון") or clicks a numbered moment chip to seed a reference, and the model returns a revised plan. Three things make this cheap and safe:
- It draws from `Project.selectionShortlistJson` — the candidate pool the original cut was already chosen from — so a turn is **one Anthropic call** with no vision pass, no ffmpeg, no candidate rebuild, and the shortlist's positional `index` contract stays valid so `validatePlan` is reused unchanged.
- The model returns a *complete* plan, not a diff (reusing `parsePlan`/`validatePlan` rather than duplicating them). Drift is caught by showing a computed kept/removed/added/moved diff before anything is applied. "moved" is measured on relative order among moments common to both sides, so removing one moment doesn't misreport every survivor as moved.
- Turns chain off `Project.refinementDraftJson` (the pending cut + the whole conversation); the live `Selection` rows change only when the user clicks apply, which routes through the same `persistSelection` as every other write path.

> [!bug] A contradicted instruction can make the model return nothing at all
> Asking for a 9-second opening against the 3-second hook rule made it spend its entire 16k token budget reasoning and return `stop_reason=max_tokens, blocks=[thinking]` — a 4.5-minute request that then 500'd. Same failure class already documented at 4096 tokens in `llm-selector.ts`. The fix was **removing the contradiction, not raising the budget**: the prompt now tells the model that returning the cut unchanged with an explanation is a valid answer. Same instruction then completed in 46s with a readable refusal.

> [!bug] Replacing a cut used to leave its approval checkpoint standing
> `persistSelection` created the `CONTENT_SELECTION` checkpoint only when absent and never reset `approved`, so re-running selection (or applying a preview) after approval left export unlocked against a cut nobody signed off on. Now any selection replacement resets `approved`/`approvedAt`.

Note the file split: pure logic (prompt assembly, draft reconstruction, diffing) lives in `refine-plan.ts` with no Prisma or SDK import; `refine.ts` holds the I/O. This isn't stylistic — vitest doesn't load `.env`, so a module that imports `prisma` at the top can't be unit-tested at all. Every tested module in `lib/` already follows this shape.

See [[Decisions and Open Questions]] for why FCP7 XML was chosen over OTIO for the timeline format, and for the open question on whether the B-roll override ever fires on its own.

## Two timelines

The middle of the pipeline is two independent layers, decided separately and joined only at build time. Design: `docs/superpowers/specs/2026-08-01-two-timeline-audio-spine-design.md`.

**Audio spine** (`lib/selection/`) — the story, chosen from the spoken word alone. The prompt tells the model outright that the picture is not its responsibility. Silent segments never reach it; vision no longer runs here at all.

**Shot catalogue** (`lib/shots/`) — every usable span of footage, found and scored by ffmpeg with no model involved. Two boundary sources, because real footage has two problems: `scdet` splits a multi-shot file, and a sliding search inside continuous takes does the rest. That second half does the real work — a 55s clip from this project contains **zero** detected scene cuts.

Four signals, each 0..1, weighted and renormalised over whichever were measured:

| Signal | What it reads | Weight |
|---|---|---|
| `activity` | mean level of the motion curve — is anything happening | 0.30 |
| `movementCompleteness` | does the span end settled, or was it cut mid-action | 0.24 |
| `stability` | *jitter*, not level — so a smooth pan scores well and only shake is punished | 0.18 |
| `sharpness` / `exposure` | guards against unusable footage | 0.14 / 0.06 |

**Video layout** (`lib/video/`) — places catalogued shots over the spine. `layout-plan.ts` is pure (prompt, parsing, validation, spine positioning); `run.ts` holds the I/O. Validation is mechanical: full coverage from zero with no gap, no overlap, no placement longer than its source shot, no shot reused, no two adjacent spans of one take back to back.

> [!tip] The cost control is the ordering, not the cap
> The catalogue is free and can index hundreds of spans. Vision runs **only** on the best 40 by that free score, so a bad shot is rejected by arithmetic and never reaches a model. This is what makes ten minutes of wedding footage affordable.

> [!bug] A locked-off shot of nothing used to score 1.00
> The first catalogue scored only steadiness and settling, which both reward stillness — so an immaculate empty frame outranked the pour from pot to glass. The signal was already in the motion curve and simply unused: stability reads its *jitter*, `activity` reads its *level*. Activity now carries the largest weight, above stability, so a handheld shot of the pour beats a perfect shot of nothing.

> [!bug] Frame differencing cannot separate camera motion from subject motion
> This is a real limit, not an oversight. `activity` measures "how much is changing", which is not "what is happening" — it cannot tell the pour from someone walking past the lens. `vidstabdetect` measures true camera transform but ffmpeg 6 writes it as a binary `TRF1` file. Where the curve misjudges, the vision pass is the backstop.

> [!bug] VideoPlacement's foreign key made the catalogue fail silently
> A placement points at a `Shot`, so once a picture layer existed the catalogue could not replace those shots. The per-clip `catch` discarded the reason and counted it as a skip, so a re-run reported **1 clip analysed, 10 skipped, 0 shots written** with no explanation anywhere. The picture layer is now cleared before shots are replaced, and every skip carries its reason.

**Free fallback.** `planLayoutHeuristically` lays out the picture layer with no model at all, using only the catalogue's free signals — the same pattern `HeuristicContentSelector` has always had beside the LLM selector. `runVideoLayout` auto-downgrades on a missing key. Verified: 21 placements over 34.8s, gapless, across 9 of 11 clips, in under a second. It cannot match content to words; that is exactly what the model call buys.

## Expert layer

`lib/experts/` — eleven domain modules, one per area of craft, indexed in [[Agents]]. Each exports typed knowledge plus a `promptSection(ctx)` that returns the text it contributes for a given stage and output profile, or `null` when it has nothing to say.

**An expert is not an LLM call.** This is the decision that reconciles "I want a crew of agents" with "stop burning tokens" — the two only conflict if an agent is assumed to be a model invocation. Adding an expert adds prose to a call that already runs. The pipeline still makes exactly three model calls (vision captioning, content selection, and a refinement turn when asked), and the selection prompt's knowledge section grew from ~1k to ~4.7k characters — roughly 1.5k extra input tokens per selection, which is fractions of a cent, against eleven extra calls if each expert had been an agent in the literal sense.

Silence is the mechanism that keeps this cheap: `contributingExperts()` is narrower than `expertsForStage()`, because a platform expert participates in `selection` but returns `null` for a profile it doesn't cover. A REEL_SHORT selection sees `platform-reels` and never sees the other two.

> [!bug] One guidelines blob was actively wrong for two of three profiles
> `lib/editing/social-guidelines.ts` (now absorbed and deleted) sent identical text to every output profile: target 15-20 seconds, avoid a 30-40 second drop-off zone, cut every 1.5-2.5 seconds. For `YOUTUBE_LONG` with a several-minute target, all three instructions were wrong. Platform knowledge is now scoped per profile, and `platform-youtube` opens by explicitly telling the model the short-form rules don't apply.

> [!bug] The pre-filter and the hook rule were pulling against each other
> `HeuristicContentSelector.durationFitness` scored 3-10s segments at 1.0 and ≤3s segments at 0.7 — while `validatePlan` rejects any plan whose **opening** moment exceeds the 3s hook window. Because the heuristic also builds the LLM selector's shortlist, short punchy moments could be filtered out before the model ever saw them, leaving it unable to write a plan that passes its own validator. Fixed by scoring duration against the `pacing` expert's per-profile ranges instead of one fixed curve. This is the most likely single cause of the "it picks the wrong moments" complaint, though it has not yet been re-measured on real footage.

The notes under `Volt/Agents/` are **generated** from the registry by `npm run generate:agent-notes` (`scripts/generate-agent-notes.ts`, needs the `tsx` dev dependency added for it). Editing them by hand is pointless — edit the expert in code and regenerate. A unit test asserts every `worksWith` id resolves to a real expert, so no generated wikilink can dangle.

## Stage 2 UXP panel (`premiere-panel/`)

Reads an approved cut over HTTP from the local app (port 3002) and builds it directly into a new Premiere sequence via the real `premierepro` UXP API — no XML round-trip. As of 2026-08-01 the panel has full feature parity with the web app (profile switching, conversational refinement, beat-structure display, the "considered but not chosen" shortlist, and triggering a fresh multi-profile generation) — see [[Decisions and Open Questions]] for how that closed in stages. Several real defects only showed up testing against actual Premiere, not from reading the API types:

> [!bug] `createOverwriteItemAction` wants a raw `ProjectItem`, not the `ClipProjectItem` cast
> The cast is needed to set in/out points, but passing the cast object to the overwrite action itself fails with "Invalid parameter." Matches Adobe's own sample code, not the more "consistent-looking" API guess.

> [!bug] A sequence must be open before it's edited
> `createSequence()` alone isn't enough — `openSequence()` first, then `getActiveSequence()`, or the first edit fails.

> [!bug] A stereo source on mono sequence tracks occupies two audio tracks
> The scratch track used to park a B-roll placement's unwanted audio/video half landed on the second channel of the real narration audio and silently destroyed it. Moved scratch indices well clear (V3/A5-A6) and sweep both channels.

> [!bug] `TrackItemSelection` is only valid inside its own callback
> Holding a reference to use after `createEmptySelection`'s callback returns fails with "The script object is no longer valid." Build the selection and remove the items in the same callback.

> [!bug] UXP's panel webview has no ambient document scroll
> A normal browser tab makes any page taller than the viewport scrollable automatically. UXP's docked panel does not — content past the panel's rendered height is silently **clipped with no scrollbar at all**. First hit when the panel accumulated enough content (profile chips + moment list + refine block + plan list) to exceed a typical docked size, hiding the Build sequence button entirely. Two independent fixes, both worth keeping: `html`/`body` sized with `height: 100vh` (not a `height: 100%` chain — that only works if every ancestor also reports a real, non-auto height, which can't be confirmed from outside Premiere's own host chrome) plus `overflow-y: auto`; and, more robust because it doesn't depend on scroll mechanics working at all, **keeping the primary action reachable by layout order** — `premiere-panel/index.html` puts the project picker → Load plan → Build sequence sequence immediately together, with newer secondary features (profile switching, refinement) below and collapsed by default.

> [!bug] The UXP Developer Tool's file picker can't see `.worktrees/`
> `premiere-panel/` only exists inside `.worktrees/stage2-panel/` (see [[Decisions and Open Questions]] on the main/stage2-panel split) — a dot-prefixed folder, hidden by default in Finder and in native macOS Open dialogs. Browsing from the repo root in "Add Plugin" simply won't show it. Use `Cmd+Shift+G` in the file picker and paste the full path instead.
