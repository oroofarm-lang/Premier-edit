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

> [!success] Transcription engine → local faster-whisper `large-v3`
> Decided after a real Hebrew test rather than by reputation. On a clean 8s Hebrew sample `large-v3` was near-perfect; `small` mangled everyday words (השף→אשף, עגבניות→הגווניות), ruling out the small models for Hebrew entirely. Runs locally so client footage never leaves the machine, which also sidesteps the privacy question. Re-tested on 38 real camera clips (~8 min audio) — batched into one process, ~5 min total. Handles natural conversation well but consistently mangled the botanical term "זעתר" (za'atar) across ~6 clips. Confirms TTS-clean audio was the easy case; worth comparing against Deepgram/ivrit.ai on domain vocabulary specifically. The `Transcriber` interface keeps the swap cheap. See [[Tech Stack]].

> [!success] Experience level → beginner
> User is new to software development — first project touching TypeScript/Next.js/Prisma. Claude Code should build working code directly rather than leaving scaffolding as an exercise, and briefly explain new patterns as they show up. See [[Tech Stack]] for concrete gotchas already hit and fixed.

> [!success] Deadline → none
> No concrete deadline. Prefer the PRD's own staged roadmap over compressing steps.

> [!success] Budget / LLM sizing → user opened an Anthropic API key
> Real-footage testing showed the no-API heuristic selector's hard limits: a silent clip is invisible to it no matter how visually relevant, and it has no sense of narrative (it reused one long clip four times instead of building a sequence). The user chose to open an Anthropic API key (separate billing from Claude.ai) specifically to fix this — see [[Tech Stack]] for the vision + LLM-selector architecture that resulted.

## Still open

(none currently — revisit as new stages get built)

## Automation boundary

Rough assembly only for MVP — see [[Premier Edit#Automation boundary]] for the full statement and the three approval checkpoints.
