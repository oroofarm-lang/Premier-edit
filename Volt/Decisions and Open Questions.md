---
title: Decisions and Open Questions
tags:
  - project/reference
aliases:
  - Decisions
  - Open Questions
---

# Decisions and Open Questions

Part of [[Premier Edit]]. Living log — update as questions get resolved instead of duplicating entries.

## Resolved

> [!success] Timeline export format → FCP7 XML
> Premiere Pro has native File→Import support for FCP7 XML, going back many versions, no plugin required. OTIO has no native Premiere import path — it needs a third-party panel/adapter. Revisit once a real sample file gets test-imported into the actual Premiere version in use.

> [!success] Experience level → beginner
> User is new to software development — first project touching TypeScript/Next.js/Prisma. Claude Code should build working code directly rather than leaving scaffolding as an exercise, and briefly explain new patterns as they show up. See [[Tech Stack]] for concrete gotchas already hit and fixed.

> [!success] Deadline → none
> No concrete deadline. Prefer the PRD's own staged roadmap over compressing steps.

## Still open

> [!question] Transcription engine / privacy
> Whisper (local) vs. Deepgram/ivrit.ai (cloud) — undecided until a real quality test on Hebrew material happens. Current approach: build against an abstracted transcriber interface so the engine stays swappable; don't hard-code a vendor.

> [!question] Budget / LLM sizing
> Not yet relevant until the content-selection agent is actually built.

## Automation boundary

Rough assembly only for MVP — see [[Premier Edit#Automation boundary]] for the full statement and the three approval checkpoints.
