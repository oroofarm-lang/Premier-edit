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

See [[Decisions and Open Questions]] for why FCP7 XML was chosen over OTIO for the timeline format, and for the open question on whether the B-roll override ever fires on its own.

## Stage 2 UXP panel (`premiere-panel/`)

Reads an approved cut over HTTP from the local app (port 3002) and builds it directly into a new Premiere sequence via the real `premierepro` UXP API — no XML round-trip. Four real defects only showed up testing against actual Premiere, not from reading the API types:

> [!bug] `createOverwriteItemAction` wants a raw `ProjectItem`, not the `ClipProjectItem` cast
> The cast is needed to set in/out points, but passing the cast object to the overwrite action itself fails with "Invalid parameter." Matches Adobe's own sample code, not the more "consistent-looking" API guess.

> [!bug] A sequence must be open before it's edited
> `createSequence()` alone isn't enough — `openSequence()` first, then `getActiveSequence()`, or the first edit fails.

> [!bug] A stereo source on mono sequence tracks occupies two audio tracks
> The scratch track used to park a B-roll placement's unwanted audio/video half landed on the second channel of the real narration audio and silently destroyed it. Moved scratch indices well clear (V3/A5-A6) and sweep both channels.

> [!bug] `TrackItemSelection` is only valid inside its own callback
> Holding a reference to use after `createEmptySelection`'s callback returns fails with "The script object is no longer valid." Build the selection and remove the items in the same callback.
