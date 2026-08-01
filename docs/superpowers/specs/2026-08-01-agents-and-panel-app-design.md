# Premier Edit: from pipeline to product

**Date:** 2026-08-01
**Status:** approved, implementation starting with Phase 1

## Why

The pipeline works end to end and has since 2026-07-31. It is still not a tool anyone would choose to use. Three problems, each verified against the code rather than assumed:

**The panel is not an app.** `premiere-panel/index.html` is a single flat scroll of stacked blocks rendered at 11px, with no navigation model — no home screen, no way to create a project, no indication of where you are in the process. Worse, it cannot originate work at all: `app/api/projects/route.ts` exports only `GET`, and `runIngest` / `runTranscription` / `runContentSelection` are reachable exclusively as Next.js server actions bound to the browser form. Every new project still starts at localhost:3002, which defeats the entire point of a panel that lives inside Premiere.

**There are no agents.** `.claude/agents/` contains one 0-byte `.gitkeep`. The eleven "planned agents" listed in CLAUDE.md and PRD §6 are TypeScript modules under `lib/`, invoked by stage runners. The agent framing has been vocabulary, not architecture, since the project started. The Obsidian vault reflects this: five populated notes, twenty-five wikilinks, a hub-and-spoke rather than the connected map the user wants to navigate.

**Capabilities are missing.** No filler-word or silence removal — the headline feature of AutoEdit, the competitor studied on 2026-07-30, and roadmap tasks #29/#30, both still pending. No understanding of what the footage is *about*, so no way to catalogue it or bring it into Premiere organized. No way to adjust a cut by hand without asking a model to do it.

## Decisions taken 2026-08-01

- Panel work and agent architecture proceed **together** as one design, executed in phases.
- **"Agent" means a local expert brain**: a knowledge module that feeds the LLM calls that already exist, not a new API call per agent. This is the decision that reconciles "I want a crew of agents" with "stop burning tokens" — the two requests only conflict if agents are assumed to be LLM invocations.
- **The rough-assembly boundary holds.** No color, no effects, no fades, no caption burn-in. CLAUDE.md's automation boundary is unchanged, and the request for a "Premiere expert that does fades, effects and color" was explicitly scoped down rather than silently expanded.
- The panel runs the pipeline **end to end**. The browser becomes optional.

## Architecture: four layers, one of which costs tokens

| Layer | Costs tokens? | Contents |
|---|---|---|
| Deterministic craft | No | Filler/silence detection, word-boundary snapping (`lib/cut/snap.ts`, exists), micro-cut merging, QC rules, pacing math |
| Expert knowledge | No | `lib/experts/` — per-platform norms, hook craft, Hebrew specifics, framing, food/product niche |
| LLM reasoning | Yes — three calls | Vision captioning (haiku), topic clustering (new), content selection (sonnet) |
| Premiere execution | No | Bin organization, sequence building, manual edits — all UXP API |

Two LLM calls become three. Everything else the user asked for is added below the token line. Quality rises because domain knowledge is encoded locally once instead of re-derived on every run — which is the same reason this lowers cost rather than raising it.

## Phase 1 — The panel becomes an app

### Screen model

One screen visible at a time, `<div class="screen" hidden>` toggled by a `showScreen(name)` router in `index.js`:

- **Home** — project cards (name, profile, stage progress) plus a primary "New project" action.
- **New project** — name, output profile, footage folder, audio folder (optional), brief.
- **Pipeline** — stages as rows (Ingest → Transcribe → Select → Review → Build), each showing state and its own action, with approval checkpoints inline.
- **Cut review** — today's `#cut-block` and `#refine-block`, given their own screen instead of competing for vertical space.

This also retires the scroll-clipping problem structurally. The 2026-08-01 finding that UXP's panel webview provides no ambient document scroll stays relevant, but a one-screen-at-a-time model means far less content is ever in play at once.

### Folder picking inside Premiere

`manifest.json` declares only `network` permissions today. Adding `"localFileSystem": "fullAccess"` enables `require("uxp").storage.localFileSystem.getFolder()`, whose returned entry exposes `nativePath` — the absolute path the existing API already expects. This replaces hand-typing a filesystem path, the worst part of the current flow.

### New API routes

Thin wrappers over the existing `lib/*/run.ts` entry points, copying the `try/catch` plus 404-on-not-found shape already established in `app/api/projects/[id]/timeline/route.ts`.

| Route | Method | Wraps |
|---|---|---|
| `app/api/projects/route.ts` | add `POST` | validation currently inline in `app/actions.ts` `createProject`, extracted to `lib/projects/create.ts` and shared |
| `app/api/projects/[id]/ingest/route.ts` | POST | `runIngest` |
| `app/api/projects/[id]/transcribe/route.ts` | POST | `runTranscription` |
| `app/api/projects/[id]/select/route.ts` | POST | `runContentSelection` |
| `app/api/projects/[id]/approve/route.ts` | POST | the checkpoint update inline in `app/actions.ts` |

### Long-running stages

Transcription takes roughly five minutes on a real folder. The POST routes start work and return `202` immediately. A module-level job registry — the same pattern as the in-flight `Set` already guarding double-invocation in `lib/transcription/run.ts` — tracks what is running and what failed. `app/api/projects/[id]/state/route.ts` gains a `stages` field; the panel polls every two seconds while anything is running.

Completion is derived from the **database** (do assets exist, do transcripts exist, do selections exist), never from the registry. A dev-server restart therefore cannot leave the panel reporting that finished work is unfinished, or vice versa. The registry answers only "is something running right now," which is the one question the database cannot answer.

### Visual redesign

The current design fails for structural reasons, not palette reasons: everything renders at 11px, nothing has a surface, and there is no spacing rhythm or visual hierarchy. The fix is a type scale (13px body, 11px meta, 15px headings), card surfaces built from the existing `--cosmic-*` variables, exactly one accent-colored primary action per screen, and a persistent header showing the current project with a back affordance. `preferredDockedSize` rises from 320×480, which is too narrow for the content it now has to carry.

## Phase 2 — Expert brains and the vault star map

`lib/experts/`, one module per domain. Each exports typed knowledge plus a `promptSection()` returning the text it contributes, and declares which pipeline stage it participates in. A given LLM call assembles its prompt from only the relevant experts — the mechanism that makes many experts cheap instead of expensive.

| Expert | Feeds | Justification |
|---|---|---|
| `platform-tiktok`, `platform-reels`, `platform-youtube` | selection | One generic `lib/editing/social-guidelines.ts` currently serves all three output profiles; their norms differ materially |
| `hook` | selection | The opening three seconds decide the video and deserve more than one bullet |
| `narrative-structure` | selection | Absorbs the existing `STORY_STRUCTURES` |
| `pacing` | selection, QC | Shot-duration ranges by energy; half of it is deterministic math |
| `hebrew` | transcription, selection | RTL, word-boundary rules, and the known failure modes — domain terms like זעתר were mangled differently across six clips and never once correct |
| `framing` | vision | Composition and headroom judgment, improving shot picks; affects selection only, so it stays inside the boundary |
| `food-and-product` | selection, vision | The actual MVP niche |
| `premiere-craft` | execution | What UXP can and cannot do, and what remains the human's job — this expert *guards* the boundary rather than expanding it |
| `qc` | QC | Deterministic checks, no LLM at all |

`lib/editing/social-guidelines.ts` is absorbed and deleted rather than left as a competing source of truth.

`Volt/Agents/` gets one note per expert, each linking to the stage it serves, its code module, its sibling experts, and its sources, with `Volt/Agents.md` as an index. Roughly ten densely cross-linked notes — a map generated from real structure, not decoration.

## Phase 3 — Deterministic craft layer

Closes roadmap tasks #29 and #30. faster-whisper already returns word-level timestamps, so this is local arithmetic with no model involved.

- `lib/craft/filler-words.ts` — Hebrew and English filler detection over `TranscriptWord[]`, drawing its word list from the `hebrew` expert.
- `lib/craft/silence.ts` — gap detection between words against a configurable threshold.
- `lib/craft/merge.ts` — micro-cut merging and timecode bounds validation.

These produce *proposed* removals surfaced in cut review for approval, never silent mutations — consistent with the three-checkpoint rule. All are pure functions with no Prisma import, so they are unit-testable; this is the same constraint that forced the `refine.ts` / `refine-plan.ts` split, since vitest does not load `.env` and a module importing `prisma` at the top cannot be tested at all.

## Phase 4 — Topics and organized import

- **`lib/topics/run.ts`** — one LLM call over all transcript and vision segments, returning topic clusters with labels and members. Persisted as `Project.topicsJson`, following the same JSON-blob-on-`Project` pattern as `selectionShortlistJson` and `multiProfilePreviewsJson`. No new table.
- **A Topics screen** in the panel showing what the footage covers.
- **Bin-organized import.** `project.importFiles(paths, suppress, targetBin, false)` already accepts a target bin as its third argument — `build-sequence.js` passes `rootItem` there today. One bin per topic is the same call with a different target. The bin-*creation* call must be confirmed against the `premierepro` API surface before building; if unavailable, fall back to a topic-prefixed naming convention and say so rather than pretend.
- **Feeds selection.** The selector can be instructed to cover topics rather than infer coverage, which is a genuine quality lift.

## Phase 5 — Manual cut editing

Reorder and delete moments directly in cut review with no LLM turn. Routes through the same `persistSelection` as every other write path, which already resets `CONTENT_SELECTION` approval whenever a selection is replaced.

## Boundaries held

- Rough assembly only. No color, effects, fades, or caption burn-in.
- Three approval checkpoints stay. Filler/silence removals and topic groupings are proposals the user approves.
- No Python/FastAPI backend; everything stays in the Next.js app's `lib/`.
- FCP7 XML export remains the fallback path — still the only route to a true audio crossfade, since UXP exposes no scripted audio-transition API.

## Verification

Per phase: `npx tsc --noEmit` and `npx vitest run` clean in `.worktrees/stage2-panel`; every new API route exercised directly with `curl` on port 3002 — shapes, 404 path, and the 202-plus-poll flow — before being wired into the panel; unit tests for every new pure module.

Panel behavior inside real Premiere remains the user's own verification step. `index.js` requires `premierepro` at the top, which resolves only in the UXP runtime, and this project's standing rule is that Claude never opens or scripts Premiere directly. Static review is the limit, and that limit gets stated rather than papered over.
