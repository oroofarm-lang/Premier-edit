---
title: Premier Edit
tags:
  - project
  - active
aliases:
  - Premier Editing Agent
status: in-progress
---

# Premier Edit

Agent-based video editing system: natural-language instructions in, real edits inside an **Adobe Premiere Pro** project out — from a raw footage folder to a near-final cut.

> [!abstract] MVP scope
> **Social media content only** — restaurant/product reels and short posts. Wedding/long-form editing is a stated future target, not part of this version.

## Notes in this vault

- [[Tech Stack]] — what the system is built on, and the non-obvious gotchas
- [[Pipeline and Agents]] — the MVP pipeline stages and the planned agent roster
- [[Decisions and Open Questions]] — what's been resolved so far, and what's still open
- [[Progress Log]] — what's actually been done, step by step

## Automation boundary

> [!warning] Rough assembly only (MVP)
> The system finds, selects, and orders takes based on the transcript + a short natural-language brief, and does a rough cut. It does **not** touch color, final captions burn-in, or final audio mix — the user finishes those by hand in Premiere.
>
> Three approval checkpoints gate the pipeline: after ingest+transcription, after content selection, after rough cut. No blind end-to-end runs.

## Source of truth

The full product spec lives in the code repo at `docs/PRD.md` (not duplicated here — this vault summarizes and links, it doesn't replace it). Day-to-day coding guidance for Claude Code lives in the repo's `CLAUDE.md`.
