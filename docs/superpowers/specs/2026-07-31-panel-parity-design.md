# Bring the UXP panel to parity: profile switching + conversational refinement

**Status:** Approved
**Date:** 2026-07-31

## Problem

An audit of the whole project (prompted by the user asking to step back and reconcile the docs, and to prioritize seeing real progress "as a plugin inside Premiere") found that `premiere-panel/` — the actual thing running inside Adobe Premiere — can do exactly two things: load an approved plan, and build it. Every feature shipped since the B-roll work — named story structures, the visible shortlist, structured constraints, multi-profile generation, and conversational refinement (tasks #46–50, all shipped 2026-07-31) — landed entirely in the Next.js web app at `localhost:3002` and never touched the panel.

Both competitors this project studied (AutoEdit, chatvideopro.com) run entirely inside one host-app panel with no separate web dashboard. This project's split into a full-featured web app plus a thin panel was a reasonable way to build the decision-making logic fast, but it means the surface the user actually wants to watch progress on is the least-developed part of the whole project.

Full audit findings are recorded in `Volt/Decisions and Open Questions.md` (commit `fac2c13`): the reconciled Python/FastAPI contradiction, the documented main/stage2-panel doc-vs-code split, and this exact panel gap as an open item.

## Scope

This closes the gap for the two most valuable, most recently-shipped capabilities — **switching between generated output profiles**, and **conversational refinement** — both driven directly from inside the panel. It deliberately does not attempt full parity: the "considered but not chosen" shortlist browser and the named story-structure display stay web-only, and so does triggering a fresh multi-profile generation (a multi-call LLM batch better watched in a full browser tab than a 320px docked panel — the panel only switches between previews someone already generated). This is the highest-value slice, not the whole gap.

## What's reused, not rebuilt

- `lib/selection/run.ts`'s `applyProfilePreview(projectId, outputProfile)` — already does everything switching a profile needs.
- `lib/selection/refine.ts`'s `refineSelection`, `applyRefinementDraft`, `discardRefinementDraft` — already do everything refinement needs.
- `lib/selection/refine-plan.ts`'s `diffSelections(before, after)` — the exact kept/removed/added/moved diff the web app's `RefinementPanel` already renders. The new route computes this server-side so the panel never has to port that logic to vanilla JS.
- `app/api/projects/[id]/timeline/route.ts`'s error-handling shape (`try/catch`, 404 on a `"No Project found"` message, 500 otherwise) — copied verbatim by the new routes.
- `premiere-panel/build-sequence.js`'s `fetchPlan`/`fetchProjects` shape (plain `fetch` against `APP_ORIGIN`, throw with the HTTP status on `!res.ok`) — copied by the new fetch helpers.
- `components/refinement-panel.tsx`'s UX decisions: numbered chips seed `רגע N: ` into the textarea instead of making the user count moments; Enter sends, Shift+Enter inserts a newline; a rejected turn renders in red without blocking the conversation.

## New API routes

All under `app/api/projects/[id]/`, all thin wrappers with no new business logic.

| Route | Method | Body | Does |
|---|---|---|---|
| `state/route.ts` | GET | — | Consolidated read: current profile, premise, live moment list (with B-roll annotation), lightweight profile-preview summaries, and — if a draft is pending — its turns, its moment list, and the precomputed diff against the live cut. |
| `profile/route.ts` | POST | `{ outputProfile }` | `applyProfilePreview`. |
| `refine/route.ts` | POST | `{ instruction }` | `refineSelection`. |
| `refine/apply/route.ts` | POST | — | `applyRefinementDraft`. |
| `refine/discard/route.ts` | POST | — | `discardRefinementDraft`. |

`state/route.ts` is the only one with real shaping logic:

```ts
const project = await prisma.project.findUniqueOrThrow({
  where: { id: params.id },
  include: {
    mediaAssets: { select: { id: true, filePath: true } },
    selections: { orderBy: { order: "asc" }, include: { mediaAsset: true, videoAsset: true } },
  },
});
```

- `fileNameById`: a `Map<mediaAssetId, fileName>` built once from `project.mediaAssets`. The draft only stores `mediaAssetId`, not a file name, so this map resolves file names for both the live selections and the draft's selections consistently.
- Live selections map to `{ fileName, startSec, endSec, reason, videoFileName }` — the last field mirrors `page.tsx`'s existing `🎥 וידיאו מ:` annotation, essentially free since `videoAsset` is already in the query.
- `profilePreviews`: parsed from `multiProfilePreviewsJson` (same try/catch-default-to-`[]` as `page.tsx`'s `parseProfilePreviews`), mapped down to `{ outputProfile, momentCount, totalDurationSec, premise }` — the panel never needs the full shortlist.
- `refinementDraft`: parsed from `refinementDraftJson` when present; its selections go through the same `fileNameById`, and `diffSelections(liveSelectedSegments, draft.result.selections)` (imported directly from `lib/selection/refine-plan.ts`) produces `{status, fileName, startSec, endSec}` entries ready to render.
- `canRefine: project.selectionShortlistJson !== null` — the same gate `page.tsx` already uses to decide whether to render `RefinementPanel` at all.

## Panel changes

**New `premiere-panel/state.js`** — fetch helpers only (`fetchState`, `applyProfile`, `sendRefinement`, `applyDraft`, `discardDraft`), kept separate from `build-sequence.js` because that file is specifically "things that call the Premiere API" — same reasoning that already split `refine.ts` (I/O) from `refine-plan.ts` (pure logic) on the web side.

**`premiere-panel/index.html`** — two new blocks between the existing `#plan-block` and the Load/Build actions row, so reading order is "here's the cut → here's how to change it → here's how to put it in Premiere":
- `#cut-block`: profile chip row (English labels, matching the panel's existing UI-chrome language — dynamic content stays Hebrew, chrome stays English, matching the existing "Load plan"/"Build sequence" convention), premise text, numbered moment list with the B-roll annotation.
- `#refine-block`: numbered reference chips, a `dir="auto"` textarea, a Send button, a turn-history list, and — only when a draft is pending — a diff list plus Apply/Discard buttons.

Both blocks start hidden (matching `#premiere-block`/`#plan-block`) and only appear once a project with an approved cut is picked.

**`premiere-panel/index.js`**:
- A `change` listener on `#project-picker` (new — today the picker's value is only read when "Load plan" is clicked) that stores the picked project id, calls `loadState()`, and clears any already-loaded build plan.
- `loadState(projectId)`: fetches `/state`, renders or hides the two new blocks.
- `onApplyProfile`, `onSendRefinement`, `onApplyDraft`, `onDiscardDraft`: each disables its own control for the duration and, on success, **also clears the loaded build plan** — any of these four actions can change what an already-loaded plan would build, so "Load plan" must be repeated before "Build sequence" re-enables. This is a deliberate explicit-refresh choice, not a silent background refetch, matching the panel's existing philosophy that "Load plan" is the one moment the user reviews what's about to be built.
- Enter-to-send on the textarea, matching the web `RefinementPanel`.

**`premiere-panel/styles.css`**: chip active/inactive states, the number-chip row, a plain-textarea style (nothing in this file has needed a text input before), and diff-status colors — finally using the already-defined-but-unused `--cosmic-green` alongside the existing `--cosmic-red`.

**`premiere-panel/README.md`**: one paragraph noting the panel can now switch profiles and refine a cut directly.

## Explicitly deferred

- The "considered but not chosen" shortlist browser and the named story-structure/beat-plan display stay web-only.
- Triggering "Generate all 3 profiles" stays web-only; the panel only switches between already-generated previews.
- Approving/un-approving the `CONTENT_SELECTION` checkpoint stays web-only.

## Verification

**Can verify directly:** `npx tsc --noEmit` and `npx vitest run` stay clean (the new routes wrap already-tested `lib/selection` functions, no new business logic to unit-test); direct HTTP calls to all five new routes against a real project with the dev server on 3002 confirm the JSON shapes, the diff computation, and the error/404 paths before anything touches Premiere; careful static review of the new panel code, since it can't run outside UXP.

**Cannot verify directly, and why:** `premiere-panel/index.js` does `require("premierepro")` at the top, which only resolves inside Premiere's own UXP runtime — the panel can't be opened in a plain browser tab, and this project's standing rule is that Premiere itself is never opened or scripted directly (the user reserved that). The real verification is the user's own: reload via the UXP Developer Tool, pick a project with an approved cut, confirm the profile chips and moment list render, try a refinement instruction, confirm the diff, apply it, confirm "Load plan" reflects the new cut.

## Self-review

No placeholders — every route, field, and file path above is concrete. Internally consistent: the "clear the loaded plan on any mutation" rule is stated once and applies uniformly to all four mutating actions plus a project switch. Scope is a single implementation pass — five small routes, one new fetch-helper file, and additive changes to three existing panel files.
