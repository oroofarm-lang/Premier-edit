# Stage 2: Live Premiere panel (UXP), direct execution instead of FCP7 XML

Status: proposed 2026-07-30, based on competitor research (AutoEdit) + this session's own findings. Not yet implemented — this doc is the design to review before a plan gets written.

## Why

The user asked to study AutoEdit (autoeditai.net — a commercial Claude-powered Premiere Pro plugin) and build toward a comparable product, then explicitly delegated the sequencing decision: act on what's needed, choose the steps.

What AutoEdit actually does, confirmed from their site + two public reference implementations of the same pattern ([ERB031/premiere-claude-plugin](https://github.com/ERB031/premiere-claude-plugin), [hetpatel-11/Adobe_Premiere_Pro_MCP](https://github.com/hetpatel-11/Adobe_Premiere_Pro_MCP)):

- Runs **inside** Premiere as a panel — no export/upload/reimport round-trip.
- The panel sends Claude a snapshot of the current sequence (clips, timecodes, markers); Claude replies with **structured JSON commands** (not prose), which the panel executes against Premiere's own API one at a time.
- Destructive commands carry `requiresConfirmation: true` and get an Execute/Cancel prompt before touching the timeline.
- Editorial scope is explicitly bounded: silence/filler/bad-take removal + captions + rough structuring — "cleaner rough cut," not a finished edit. This is the same automation boundary already in this project's `CLAUDE.md`.

This project's pipeline already does the hard part their marketing calls "Claude understands your recording" — transcription, vision analysis, and LLM-based narrative selection are all built and reviewed. What this project doesn't have is their **delivery mechanism**: everything here still ends at an FCP7 XML file the user imports by hand.

That XML step is also where this entire session's debugging effort went: frame-rate mismatches, missing `-1` sentinels, missing handle frames, wrong effect IDs — a whole class of bugs that exists *only* because the plan has to be serialized into a 1990s interchange format and re-interpreted by Premiere's importer. A UXP panel that calls Premiere's own timeline API directly doesn't have an XML layer to get wrong.

**Strategic read:** the highest-leverage next step isn't copying AutoEdit's feature list — it's copying their *delivery architecture*, because it simultaneously (a) closes the gap with a real competitor, and (b) permanently retires the bug class we just spent a full session fixing one symptom at a time.

## Approach

### Keep the existing "brain," replace the "hands"

No change to: ingest, transcription (`Transcriber`), vision (`VisionAnalyzer`), content selection (`ContentSelector`/`LlmContentSelector`), or `lib/cut/build.ts`'s `CutClip[]` output. That pipeline already produces exactly the plan a panel needs to execute — a list of clips with in/out points, ordering, and (after the in-flight `editing-quality` branch lands) audio-crossfade handle frames.

What changes is the last step: instead of `lib/export/fcp7.ts` serializing `CutClip[]` to XML for manual import, a new UXP panel takes the same `CutClip[]` and calls Premiere's API to build the sequence live, in the project the user already has open.

### Command protocol (mirrors the AutoEdit-pattern repos, not the 281-tool MCP approach)

Recommending the **direct UXP** architecture over the CEP+ExtendScript+MCP-bridge one, for reasons specific to this project:
- This project's plan is already a fixed, small vocabulary (import file, place clip, trim, add audio crossfade, add marker) — not open-ended arbitrary editing. A 281-tool general-purpose MCP surface is built for a different problem (an agent freely improvising edits) and is a much larger safety/maintenance surface than this project needs for a "review a plan, then execute it" workflow.
- UXP is Adobe's current, supported extensibility layer for Premiere (CEP is legacy). This project has no existing CEP investment to protect.
- The MVP's approval-checkpoint model (already in `CLAUDE.md` / `ApprovalCheckpoint` in the schema) maps directly onto "the panel shows the plan, the user clicks Approve, then the panel executes" — no chat/JSON-command round-trip with Claude is even required for v1, because content selection already happened earlier in the pipeline (in `LlmContentSelector`). The panel's job is to **execute an already-approved plan**, not to improvise one live.

So v1's panel does not need its own live Claude call at all — it's simpler than AutoEdit's Chat Edit:

```
existing pipeline → CutClip[] (already approved by the user, per the 3-checkpoint MVP flow)
       ↓
new: lib/premiere-panel/ (UXP panel, TypeScript)
   - reads the approved plan (via a small local API the Next.js app exposes, or a file handoff — TBD in the plan)
   - for each CutClip: ppro.Sequence.insertClip() / equivalent, import media if not already in the project bin
   - for each audio-crossfade join: apply the built-in Cross Fade (+3dB) transition via the API
   - surfaces a single confirmation ("Build N clips into a new sequence?") before doing anything, since creating a sequence is the only "destructive-ish" step — everything else is additive
```

A later version can add AutoEdit's actual differentiator — a live chat box where the user types free-form requests and Claude returns structured commands against a fresh sequence snapshot — but that is deliberately **out of scope for v1**, see below.

### Why not build Chat Edit first

Chat Edit (arbitrary natural-language commands against a live timeline) is AutoEdit's flashiest feature, but it's also the part of their product furthest from this project's stated MVP boundary: it means live, unreviewed LLM-generated edits touching a real timeline, which is exactly the "blind end-to-end run" the MVP's 3-checkpoint design was built to prevent. Shipping the plan-then-execute panel first gets most of the competitive value (no export/import round-trip, no XML bugs) with none of that risk. Chat Edit becomes a natural v2 once the execution layer already exists and is trusted.

## Scope

**In scope (v1):**
- UXP panel project scaffold (manifest, dev-mode loading instructions)
- Direct execution of an approved `CutClip[]` plan: media import, clip placement, audio-crossfade transitions (reusing the exact fixes from the in-flight `editing-quality` branch — handle frames, no `-1`-sentinel equivalent needed since this isn't XML anymore)
- One confirmation step before building the sequence
- Manual dev-mode testing (load unpacked via UXP Developer Tool) — no packaging/distribution yet

**Explicitly out of scope for v1:**
- Chat Edit / free-form natural-language commands against a live timeline
- Multicam speaker-switching ("Podcast Mode")
- Auto Reframe (horizontal → vertical via face/motion detection)
- Any MCP server / ExtendScript bridge — direct UXP only
- Packaging/distributing the panel outside this machine's dev-mode install

## Sequencing

This is new, separate work from the in-flight `editing-quality` branch (word-boundary cuts, audio crossfades, editorial rubric — currently at Task 7a, pending final Premiere verification, with Tasks 8-11 still queued). Recommendation: land `editing-quality` first — its output (`CutClip[]` with `audioInSec`/`audioOutSec`) is exactly what this panel will consume, so finishing it first means the panel is built against the final shape of that type, not a moving target. This spec is written now, while the research is fresh, so it's ready to go straight to `writing-plans` once `editing-quality` merges.
