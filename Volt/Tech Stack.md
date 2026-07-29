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
| Local media layer | ffmpeg / ffprobe / transcription | not implemented yet |
| Premiere bridge | Timeline XML export (Stage 1) → UXP/CEP panel (Stage 2) | Stage 1 only |

> [!bug] shadcn/ui version trap
> `npx shadcn init` defaults today to Tailwind v4 conventions and the **Base UI** component library, neither of which match this project (Tailwind v3, **Radix UI**). Left unchecked this breaks the build with errors like `border-border` / `outline-ring/50` not existing, and a bad `next/font/google` import for `Geist` (not a real Google font).
>
> Fix already applied in the repo: `components.json` pinned to `"base": "radix"`, colors in `app/globals.css` stored as raw decomposed OKLCH components (`--ring: 0.708 0 0;`) with `tailwind.config.ts` wrapping them as `oklch(var(--x) / <alpha-value>)` so opacity modifiers (`bg-primary/80`) work under v3.

## Prisma specifics

- Import `PrismaClient` from `@/lib/generated/prisma/client` (enums from `.../enums`), **not** `@prisma/client` — the schema uses the newer `prisma-client` generator with a custom output path, and there is no barrel `index.ts`, so the bare folder path fails to resolve.
- Config lives in `prisma.config.ts`, not just `.env` — Prisma 6+ no longer auto-loads `.env` on its own.
- Schema models the 8 entities from the PRD's data model section: `Project`, `MediaAsset`, `Transcript`, `Selection`, `Timeline`, `EditVersion`, `StylePreference`, `ApprovalCheckpoint`.

See [[Decisions and Open Questions]] for why FCP7 XML was chosen over OTIO for the timeline format.
