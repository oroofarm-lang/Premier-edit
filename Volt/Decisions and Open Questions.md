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

> [!success] Backend language → TypeScript stays primary; Python is a deferred, staged idea (2026-07-31)
> The "CosmicEdit AI" PRD proposed a 10-agent Python/FastAPI backend, and the user chose Python when asked directly — but this **contradicted** `docs/superpowers/specs/2026-07-30-stage2-live-panel-design.md`'s explicit "No Python/FastAPI backend — everything stays in the Next.js app's `lib/`," found during a 2026-07-31 audit of the whole doc set. Reconciled by scoping Python as **Phase 4 of the roadmap: a staged strangler-fig migration, not an immediate rewrite** — starting with STT/vector work where Python's ecosystem genuinely helps, migrating orchestration next, and never moving the UXP panel (must be JS) or the Next.js UI. **As of this writing, zero Python/FastAPI code exists** beyond the pre-existing `scripts/transcribe.py`; the stage2-live-panel spec's "no Python backend" statement remains operative for everything actually being built right now.

> [!success] Where docs and code each live → `main` holds docs, `stage2-panel` holds all real code
> Same 2026-07-31 audit found this convention was undocumented and had already caused a real near-loss: the conversational-refinement spec sat **uncommitted** in `main`'s working tree for hours while the feature it describes shipped and was verified on `stage2-panel` — fixed by committing it (`893976c`). Stated explicitly now: `Volt/` and `docs/superpowers/specs/` are authored and committed on `main` only; `premiere-panel/`, `lib/`, `app/`, `prisma/` live and are committed on `stage2-panel` only. The worktree's own copy of `Volt/` is frozen at whatever commit the worktree branched from and is **not** kept current — always read/write the vault via the `main` checkout path, never the worktree's copy.

> [!success] RTL → shipped, then reverted same day → product stays English/LTR (2026-07-31)
> Flipped the whole document to `dir="rtl" lang="he"` (web app + UXP panel), verified it working (flexbox mirrors for free; plain English text with digits/punctuation needed explicit `dir="ltr"` islands to avoid bidi garbling — a real finding, see `docs/superpowers/specs/2026-07-31-rtl-support-design.md`), then the user decided immediately after that this was a mistake and asked to keep everything English/LTR. Reverted cleanly via `git revert` (commit `2493953`) — back to `<html lang="en">`, no `dir`, `components.json`'s `"rtl": false`. **Current state: LTR, English, no RTL support** — the spec above is kept for the bidi lesson only, not as a description of the live product.

> [!success] UXP panel parity gap → fully closed (2026-07-31 → 2026-08-01)
> The panel could only "load plan" + "build sequence" while everything else lived only at `localhost:3002` — see `docs/superpowers/specs/2026-07-31-panel-parity-design.md`. Closed in stages: profile switching + conversational refinement first (commit `16c8e91`), then the named beat-structure line (`a5a1104`), the "considered but not chosen" shortlist browser (`a5a1104`), and finally triggering a fresh multi-profile generation (`965b64f`, not itself triggered during verification since it's a real paid multi-call Anthropic batch — checked via `tsc`/`vitest`/route-exists only). **As of 2026-08-01 the panel has full feature parity with the web app**, except the already-documented, unrelated audio-crossfade limitation (no UXP API for it — see [[Tech Stack]]).

> [!success] Panel scroll/reachability fixed at the layout level, not just CSS (2026-08-01)
> First real-Premiere load this session hit two real bugs, both now fixed on `stage2-panel`. (1) **Manifest path**: `premiere-panel/` only exists inside `.worktrees/stage2-panel/` — a dot-prefixed folder hidden by default in Finder and native Open dialogs — so "Add Plugin" couldn't find it by browsing from the repo root. Fix: `Cmd+Shift+G` in the file picker, paste the full path. (2) **Content taller than the docked panel was silently clipped with no scrollbar** — UXP's panel webview doesn't provide ambient document scroll the way a browser tab does. Fixed two ways: CSS (`100vh` + `overflow-y: auto` on `html`/`body`, plus bounding each list to its own scroll region), and — the fix that actually matters regardless of whether the CSS one works — **reordering the panel so Load plan/Build sequence sit immediately after the picker**, with the newer profile/refine features moved below and collapsed by default. See [[Tech Stack]] for the technical detail. **Not yet confirmed working by the user in real Premiere** — same standing limitation as every panel change.

## Still open

- **Does the LLM selector ever choose a B-roll override on its own?** Verified the mechanism works end-to-end (manually-triggered override built correctly into Premiere), and reworked the prompt around a concrete shot-type signal — but on every real project tried so far, the model picks zero overrides. Inspection suggests this may be legitimately correct for the action-heavy moments the selector has picked so far (the visual already matches the audio), not a bug — needs a project with genuine talking-head narration next to strong alternative footage to actually confirm either way.

- **"Clean up an existing sequence" workflow has no design yet.** The original PRD (§5) required two workflows from day one — assemble from raw footage (built) and highlight-extraction from an existing project (never built). A 2026-07-31 roadmap entry renamed/reframed this as "Phase 3: clean up an existing Premiere sequence" (filler/silence removal, ripple delete) but it is a single roadmap sentence with no spec, no schema, no code, and depends on a Stage 3 read-back layer (Premiere → app) that doesn't exist. Whether this is meant to be the same thing as the PRD's original second workflow, or a different one, has never been clarified. Needs its own brainstorming pass before it becomes a task.

- **Does Adobe Spectrum (`sp-*`) actually honor `dir="rtl"` inside real Premiere?** Moot — RTL was reverted the same day it shipped (see above), so the panel is LTR/English like the rest of the product. Left here only as a note that this was never actually confirmed, in case RTL is revisited later.

## Automation boundary

Rough assembly only for MVP — see [[Premier Edit#Automation boundary]] for the full statement and the three approval checkpoints.
