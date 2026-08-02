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

> [!success] "Agent" → a local expert brain, not an LLM call (2026-08-01)
> The user asked for a crew of agents — a social-media expert, a Premiere expert, designers — and in the same breath asked to stop burning tokens. Those two only conflict if an agent is assumed to be a model invocation. Resolved by defining an agent as a knowledge module in `lib/experts/` that feeds the calls which already exist: eleven experts, still three model calls. Built and shipped the same day — see [[Agents]] for the roster and [[Tech Stack#Expert layer]] for the mechanism and the real token cost. The `Volt/Agents/` notes are generated from the registry, so the map matches the code by construction rather than by discipline.

> [!success] Premiere expert scoped to guarding the boundary, not extending it (2026-08-01)
> The request was for an expert that "knows how to cut, do fades, effects and colour." Fades, effects, and colour are outside the MVP automation boundary, and two of them have no UXP API at all. Rather than silently dropping the request or silently expanding scope, `premiere-craft` was built to hold the opposite job: it tells the *selector* that every join is a hard cut with no dissolve and no audio fade, so moments are chosen to work dry. Colour and effects remain the editor's own work, as stated.

> [!success] Editing model → two timelines, built separately (2026-08-01)
> The user described how they actually edit and it was not what the system did: build the **audio** story first from the spoken word, then lay **video** over it chosen on its own merits, where the picture need not come from the moment the sound came from. The old model picked *moments* where sound and picture travelled together, with `Selection.videoOverride` as a documented exception — so the picture was always chosen in service of the audio and always compromised. Inverted: `VideoPlacement` is now the norm and the override the legacy path. This also answered the standing question about the B-roll override never firing on its own — it was an exception to a rule that should not have been the rule. See [[Tech Stack#Two timelines]].

> [!success] Shot quality → measured, not modelled (2026-08-01)
> Asked what makes one of twenty shots of the same table worth using, the user chose **complete camera movement** and **stability**, and explicitly did *not* choose composition, light, or "a real human moment". Both chosen signals are measurable in ffmpeg, so the primary quality judgment for video costs nothing and vision runs only on what survives it. The single most consequential answer of the day.

> [!success] Every stage has a free path (2026-08-01)
> The Anthropic balance ran out mid-session and the video stage stopped dead, which exposed an architectural gap rather than bad luck: selection had always had a heuristic beside the LLM so the pipeline runs end to end without an account, and the video layer had none. Now it does. The rule going forward: **a stage that only works with an API key is an incomplete stage.**

> [!success] Sequence format → derived from the footage (2026-08-01)
> `createSequence(name)` takes no dimensions at all, so Premiere used its default landscape preset and vertical social footage landed in a horizontal sequence. Now built with `createSequenceFromMedia()` from the plan's first clip. Worth noting the bug was narrower than it looked: `buildCutTimeline` already reported 1080x1920 because ingest's rotation handling was correct from the start, so the FCP7 export path was **always** vertical.

> [!success] The panel unlinks by hand, because Unlink does not exist (2026-08-02)
> Premiere links a clip's video and audio, `createOverwriteItemAction` always places both halves, and there is no Unlink anywhere in the UXP API — checked across the whole 4,675-line `.d.ts`. So the only way to put one source's picture over another's sound is to park the unwanted halves on tracks nobody reads and delete them. That was already the design; what was broken was the deletion, and it left the user with two pictures and two soundtracks per moment. **The rule that came out of it: sweep by reading the sequence back, never by fixed track index, and re-fetch every handle after every transaction.**

> [!success] A shot is trimmed from its lead-in, not its ending (2026-08-02)
> The catalogue grades a window on how it **ends**; the trim was keeping its **head**, discarding the property the shot was chosen for. On real footage, 11 shots graded ≥0.80 on `movementCompleteness` lost 16.5s of their own endings and only 1 of them reached its resolution. Now a completing shot is anchored to the end of its window. **The wider rule: when something reads badly on screen, check whether the signal that was measured survives all the way to the frames that actually land in the sequence** — here it shaped the hold length and was ignored by the trim.

> [!warning] A test that the broken code also passes is not evidence (2026-08-02)
> The first simulation written for the Unlink fix passed — and then passed identically against the *old* code, which the user had just demonstrated was broken. It proved only that the arithmetic was fine under an over-charitable model of Premiere. Widening it until it **reproduced the reported symptom** is what located the real cause (stale handles aborting the sweep mid-way), and widening it once more found a defect in the fix itself and a third pre-existing one. Applies generally here: for anything that cannot be run directly — the panel above all — **watch the check fail against the known-bad version before trusting it green.**

## Still open

- **Does the picture layer read well to a human?** Two separate blockers have now been cleared in front of this question, and it has still never actually been answered. First the timeline was unreadable (parked halves — fixed). Then, with it readable, the first real look found the trim discarding every action's ending — fixed, 1 → 11 shots reaching their resolution. Only now is the question askable on its own terms. The user's verdict on the variable-length cuts so far is *"אחרים… לא באיכות יותר טובה"*, which is a genuine result, not a pass — but it was measured on a cut that was also dropping every payoff, so it is worth re-judging before drawing conclusions about pacing.

- **Are the shots themselves the right shots?** Raised by the user in the same breath as the pour ("צריך גם שם לדייק את העניין של בחירת הפריימים עצמם"), and deliberately not acted on yet — the trim bug had to be cleared first, since a well-chosen shot cut off before its payoff looks identical to a badly-chosen one. Distinct from the layout question above: this is about which windows the catalogue offers and how `choose()` ranks them, not where they land.

- **Does the video layer read well to a human?** Partly answered on 2026-08-02, and the answer had a measurable half. "The cuts are not smooth or pretty yet" turned out to be caused by the picture layer being a **metronome** — 21 placements of exactly 1.65s, with only 3 of 21 landing near a boundary in the spoken story. That part is fixed (snapping to spine boundaries, length driven by measured shot energy; see [[Progress Log]] `6bc8238`). What remains genuinely unmeasured is whether the *result* now reads well — the numbers improved, the eye has not been consulted. Needs the user's own verdict on a rebuilt sequence.

- **Filler-word removal has nothing to remove, and that is a fact about the transcriber.** Built and measured 2026-08-02: 0 hits across all 356 words that carry timings, because faster-whisper normalises disfluencies out of the transcript. Silence removal likewise finds 0 gaps *inside the spine*, because a selected moment's boundaries are exactly a transcript segment's and butt-joining already discards what separates segments. The layer is kept for interview and wedding footage, where intra-segment pauses are real. This ties directly to the open transcriber decision above — a verbatim mode or a vendor engine would change the answer.

- **Offering a sequence preset instead of always deriving one.** Raised by the user; not built. Deriving from the footage is right by default, but a user targeting a different delivery format has no way to say so.

- **Cutting to music beats.** Raised by the user as a near-term want. The density work anticipates it — more cut points available is a precondition — but nothing reads audio for beats yet.

- **Does the expert layer actually improve the cut?** The two defects it fixed are real and mechanical (see [[Tech Stack#Expert layer]]) — wrong length guidance for two of three profiles, and a pre-filter that down-ranked the very short moments the hook validator requires. But "the cuts pick wrong moments and the order doesn't build a story" was a subjective report, and the fix has **not** been re-measured against real footage yet. Needs a fresh selection run on a real project, compared against the previous cut for the same project.

- **TikTok and Instagram Reels share one expert because `OutputProfile` can't tell them apart.** `platform-reels` covers both and states the differences inline (TikTok favours a spoken direct opening, Instagram a quiet visual one). Splitting them into two experts needs a fourth `OutputProfile` value first — schema change, migration, and UI — which was judged out of scope for the day the roster was built.

- **Does the LLM selector ever choose a B-roll override on its own?** Verified the mechanism works end-to-end (manually-triggered override built correctly into Premiere), and reworked the prompt around a concrete shot-type signal — but on every real project tried so far, the model picks zero overrides. Inspection suggests this may be legitimately correct for the action-heavy moments the selector has picked so far (the visual already matches the audio), not a bug — needs a project with genuine talking-head narration next to strong alternative footage to actually confirm either way.

- **"Clean up an existing sequence" workflow has no design yet.** The original PRD (§5) required two workflows from day one — assemble from raw footage (built) and highlight-extraction from an existing project (never built). A 2026-07-31 roadmap entry renamed/reframed this as "Phase 3: clean up an existing Premiere sequence" (filler/silence removal, ripple delete) but it is a single roadmap sentence with no spec, no schema, no code, and depends on a Stage 3 read-back layer (Premiere → app) that doesn't exist. Whether this is meant to be the same thing as the PRD's original second workflow, or a different one, has never been clarified. Needs its own brainstorming pass before it becomes a task.

- **Does Adobe Spectrum (`sp-*`) actually honor `dir="rtl"` inside real Premiere?** Moot — RTL was reverted the same day it shipped (see above), so the panel is LTR/English like the rest of the product. Left here only as a note that this was never actually confirmed, in case RTL is revisited later.

## Automation boundary

Rough assembly only for MVP — see [[Premier Edit#Automation boundary]] for the full statement and the three approval checkpoints.
