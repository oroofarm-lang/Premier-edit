---
title: Progress Log
tags:
  - project/log
aliases:
  - Progress
  - Changelog
---

# Progress Log

Part of [[Premier Edit]]. Newest entry on top.

## 2026-07-29 — Step 1: Technical foundation

- Installed `nvm` + Node.js 24 LTS (machine had no JS runtime at all beforehand).
- Initialized Next.js **14.2.35** (pinned — see [[Tech Stack]] for why `@latest` was wrong here).
- Set up shadcn/ui on **Radix UI**, fixed the Tailwind v3/v4 mismatch it defaults to.
- Installed Prisma **6.19.3** + SQLite, wrote the full schema (8 entities), ran the first migration.
- Copied the PRD into the repo at `docs/PRD.md`.
- Rewrote `CLAUDE.md` to reflect the PRD, the four clarified decisions, and the collaboration note about experience level.
- Installed the `obsidian-markdown` skill (from `kepano/obsidian-skills`) into `.claude/skills/` and organized this vault with it.

Full detail: [[Decisions and Open Questions]], [[Tech Stack]].

## 2026-07-29 — Step 0: Scaffold

- Created `.claude/{agents,skills,commands}` as empty placeholders.
- Wrote the first `CLAUDE.md` (pre-PRD version).
