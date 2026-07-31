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

> [!success] Premiere integration → Stage 2 UXP panel (direct execution), not just XML export
> Studied a real competitor (AutoEdit) and confirmed its architecture independently: a UXP panel that calls Premiere's own timeline API directly permanently retires the whole class of frame-math/transition bugs an XML round-trip invites. Built (`premiere-panel/`) and verified in real Premiere against actual footage, including placing one file's video over a different file's audio at the same timeline position. FCP7 XML export (Stage 1) stays as the fallback path — it's still the only route to a true audio crossfade, since UXP has no scripted audio-transition API.

> [!success] Audio/video separation → real-footage B-roll only, not AI-generated
> User's framing: the story is built through two channels in parallel — spoken content and visual content — and they don't have to come from the same clip. Implemented as `Selection.videoAsset`/`videoStartSec`/`videoEndSec`: a moment's audio stays put, its picture can come from a different already-selected moment. Deliberately **not** AI-generated B-roll (studied as part of the chatvideopro.com competitive research) — for real client footage, synthetic stand-in footage undermines the authenticity that's often the point. See [[Tech Stack]].

## Still open

- **Does the LLM selector ever choose a B-roll override on its own?** Verified the mechanism works end-to-end (manually-triggered override built correctly into Premiere), and reworked the prompt around a concrete shot-type signal — but on every real project tried so far, the model picks zero overrides. Inspection suggests this may be legitimately correct for the action-heavy moments the selector has picked so far (the visual already matches the audio), not a bug — needs a project with genuine talking-head narration next to strong alternative footage to actually confirm either way.

## Automation boundary

Rough assembly only for MVP — see [[Premier Edit#Automation boundary]] for the full statement and the three approval checkpoints.
