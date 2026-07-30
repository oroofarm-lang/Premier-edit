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

## Agent decomposition (added 2026-07-30, after an 8-agent architecture proposal)

A later proposal in the same session laid out an 8-agent architecture (Orchestrator, Ingest/Proxy, STT+Alignment, Context/Semantic, Creative Editor, QC/Safety, Timeline Execution, Documentation/Git). It was written against a hypothetical Python/FastAPI backend that **does not exist in this repo** — the only `.py` file here is `scripts/transcribe.py`, a thin faster-whisper helper the TypeScript pipeline shells out to. The user chose to adapt the proposal into the existing TypeScript stack rather than stand up a second service.

Two of its assumptions were rejected on purpose:
- **No Python/FastAPI backend.** Everything stays in the Next.js app's `lib/`. Adding a second service in a second language to re-host logic that already exists and has been reviewed would contradict the proposal's own "do not re-create existing working logic" directive.
- **No cloud STT.** The proposal specified WhisperX/Deepgram. This project chose local faster-whisper deliberately so client footage never leaves the machine (see `CLAUDE.md` open decision #1, resolved after real Hebrew testing). That guarantee stays.

What the proposal is genuinely useful for is **naming the boundaries** — most of these responsibilities already exist as modules; the agent framing mostly confirms the decomposition is right, and surfaces two real gaps.

| Proposed agent | Status in this codebase |
|---|---|
| 1. Orchestrator | Partly exists as the pipeline's stage runners (`lib/*/run.ts`) + the approval-checkpoint flow. No separate router module needed; the 3-checkpoint UI *is* the orchestration surface. |
| 2. Ingest & Media Proxy | Exists: `lib/ingest/probe.ts` (ffprobe metadata, rotation/frame-rate handling). Proxy generation is not built and not currently needed. |
| 3. STT & Word-Level Alignment | Exists: `scripts/transcribe.py` + `lib/transcription/*`, with word-level timestamps added by the `editing-quality` branch (Tasks 2-5). **Gap: filler-word and silence-gap detection are not built** — see below. |
| 4. Context & Semantic Analysis | Exists in effect: `lib/vision/*` (visual understanding) + the LLM selector's narrative-beat plan (Tasks 8-10). Topic segmentation as a separate step is not built. |
| 5. Creative Editor | Exists: `lib/selection/llm-selector.ts` — produces the cut plan from a brief, with a stated premise/beat structure and validation. `apply_editing_style(preset)` is not built (`StylePreference` exists in the schema, unused). |
| 6. QC & Safety | Partly exists: the handle-frame reservation and word-boundary snapping from the `editing-quality` branch are exactly this agent's `apply_word_padding` and anti-truncation role. **Gap: `merge_adjacent_ranges` (micro-cut prevention) and explicit timecode-bounds validation are not built** — see below. |
| 7. Timeline Execution | **This is the subject of this spec.** Currently FCP7 XML export (`lib/export/fcp7.ts`); becomes direct UXP execution. The proposal's `duplicate_active_sequence()` (non-destructive backup) and `export_fallback_edl_xml()` (fall back to file export when the DOM path fails) are both good ideas worth adopting — the fallback in particular means the XML path stays as a safety net rather than being deleted. |
| 8. Documentation & Git Sync | Exists informally: the Obsidian vault at `Volt/` is already maintained with a progress log, and commits already carry descriptive messages. Automating per-edit logs is plausible later; auto-committing on every edit is **not** adopted (silent automatic commits on a shared repo are the kind of hard-to-reverse action that should stay a human decision). |

**Two real gaps worth adding to the roadmap** (not to this spec's v1 scope, which stays as written above):
- **Filler-word / silence-gap detection** (proposed agent 3). This is AutoEdit's headline feature and this project has no equivalent. Word-level timestamps — just landed on the `editing-quality` branch — are the prerequisite, so this is now unblocked and is the strongest candidate for the next feature after Stage 2.
- **Micro-cut merging + timecode-bounds validation** (proposed agent 6). Cheap to add, guards a real failure mode (a plan with two kept ranges 40ms apart produces a stutter, not an edit). Belongs in `lib/cut/build.ts` alongside the handle-frame logic.

## Sequencing

This is new, separate work from the in-flight `editing-quality` branch (word-boundary cuts, audio crossfades, editorial rubric). Recommendation: land `editing-quality` first — its output (`CutClip[]` with `audioInSec`/`audioOutSec`) is exactly what this panel will consume, so finishing it first means the panel is built against the final shape of that type, not a moving target. This spec is written now, while the research is fresh, so it's ready to go straight to `writing-plans` once `editing-quality` merges.

Roadmap order after this spec: **(1)** finish `editing-quality`, **(2)** Stage 2 UXP panel per this spec, **(3)** filler-word/silence detection, **(4)** micro-cut merging + bounds validation (could fold into 1 or 3 if convenient).
