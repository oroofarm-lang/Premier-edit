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
| Visual understanding + smart selection | Anthropic API (`@anthropic-ai/sdk`), `claude-haiku-4-5` (vision) + `claude-sonnet-5` (selection) | needs `ANTHROPIC_API_KEY` in `.env` |
| Premiere bridge | UXP panel (`premiere-panel/`, Stage 2) + FCP7 XML export (Stage 1, fallback) | Both implemented; panel is the primary path — see below |

> [!bug] shadcn/ui version trap
> `npx shadcn init` defaults today to Tailwind v4 conventions and the **Base UI** component library, neither of which match this project (Tailwind v3, **Radix UI**). Left unchecked this breaks the build with errors like `border-border` / `outline-ring/50` not existing, and a bad `next/font/google` import for `Geist` (not a real Google font).
>
> Fix already applied in the repo: `components.json` pinned to `"base": "radix"`, colors in `app/globals.css` stored as raw decomposed OKLCH components (`--ring: 0.708 0 0;`) with `tailwind.config.ts` wrapping them as `oklch(var(--x) / <alpha-value>)` so opacity modifiers (`bg-primary/80`) work under v3.

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
