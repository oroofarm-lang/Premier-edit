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
| Premiere bridge | Timeline XML export (Stage 1) → UXP/CEP panel (Stage 2) | Stage 1 only |

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

Added after real-footage testing showed the no-API heuristic selector's limits — see [[Decisions and Open Questions]] for the budget decision this required. Architecture mirrors `Transcriber`: a `VisionAnalyzer` interface, one implementation (`claude-haiku-4-5`, cost-efficient for short captioning-style descriptions), 3 sampled frames per clip via ffmpeg (which auto-applies rotation, so no manual correction needed there). The `LlmContentSelector` (`claude-sonnet-5`) pre-filters candidates with the existing heuristic to keep its prompt bounded, then makes the actual editorial call — order, source diversity, hook/body/payoff structure — informed by researched short-form social editing norms (hook within 1-3s, avoid a 30-40s "dead zone," ~1.5-2.5s average cut frequency). `runContentSelection` auto-upgrades from heuristic to LLM based on whether `ANTHROPIC_API_KEY` is set — same UI button either way.

See [[Decisions and Open Questions]] for why FCP7 XML was chosen over OTIO for the timeline format.
