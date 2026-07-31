# Conversational refinement of an existing cut

**Status:** Approved
**Date:** 2026-07-31
**Roadmap:** task #50, Phase 2 of the CosmicEdit roadmap (`Volt/Progress Log.md`, 2026-07-31 entry).

## Problem

Today the only way to change a cut is `runContentSelection`, which always builds a plan from scratch (`lib/selection/llm-selector.ts`, `ContentSelector.select()`). A user who likes 9 of 10 moments has no way to say "swap the third one" — they re-roll everything and lose the parts they liked.

This is the project's real differentiator against chatvideopro.com's Story Cutter (transcript-only, no B-roll/visual awareness, no iterative refinement loop).

## Decisions

Taken with the user 2026-07-31, in order:
1. **Interaction style: combine free text and guided selection** — a text box for natural-language instructions, plus clickable numbered moment references, rather than picking one over the other.
2. **Multi-turn conversation** — each instruction builds on the previous refined state, not on the original cut. Re-typing from scratch is not required between edits.
3. **Scope: the active version only** — refinement targets the project's live `Selection` rows for whichever `OutputProfile` is currently active. To refine a different profile, the user first switches to it with the existing "Use this cut" button (`ApplyProfileButton`).

**Deliberately out of scope:** semantic Q&A over the transcript ("what did they say about pricing?"). That is the roadmap's other Phase 2 capability, needs an embeddings/vector layer that doesn't exist anywhere in this codebase, and shares no code with refinement. Separate spec when it's prioritized.

## The key enabler already in the codebase

`persistSelection` (`lib/selection/run.ts`) already snapshots the LLM's full pre-filter shortlist to `Project.selectionShortlistJson` — every candidate the original plan considered, each tagged `chosenOrder: number | null`. That is the entire pool a refinement can draw from, including everything the original plan rejected.

Refinement reuses that snapshot instead of rebuilding candidates from media. Consequences:
- No vision analysis, no ffmpeg, no heuristic pre-filter, no database scan of `MediaAsset`/`Transcript` — **one Anthropic call per instruction**, same cost shape as the existing selector's single `requestPlan` call.
- The shortlist array's order is unchanged from the original run, so the existing positional `index` contract (the model returns `#i` into the shortlist) stays valid, and `validatePlan`'s hook-window, diversity, `videoFrom`, and constraint checks apply verbatim with zero modification.
- A caveat this implies: refinement is only possible for a project whose active selection came from the LLM selector (the one that populates `selectionShortlistJson`). A project running the no-API-key heuristic selector has no shortlist to refine against — refinement is unavailable there. This is acceptable: refinement is meaningless without an Anthropic key already being in play for the original cut.

## Architecture

### The refinement call: full replacement, not a diff

The model receives the current cut (numbered 1-based, matching the UI), the shortlist it can still draw from, the conversation so far, and the new instruction. It returns **a complete plan in the exact same JSON shape** the cold-start selector already uses (`{premise, constraints, beatPlan, selections: [{index, score, beat, reason, videoFrom?}]}`) — not an operations/diff format (add/remove/move commands).

**Why full replacement:** `parsePlan` and the exported `validatePlan` already parse and validate that shape. A diff format would need a parallel parser, a parallel validator re-implementing every rule, and its own apply logic against the live plan — for a result the model would not deliver more reliably than just re-emitting the whole thing.

**The risk is drift** — the model silently changing moments nobody asked about. Two required mitigations:
1. **Prompt rule:** any moment not touched by the instruction must come back unchanged (same shortlist index, same `videoFrom`), and the model must state in one sentence what it actually changed.
2. **UI-level diff:** before anything is applied, the interface computes and shows kept / removed / added / reordered against the previous draft (or the live cut, if no draft exists yet). Drift becomes visible instead of silent.

### New module: `lib/selection/refine.ts`

Kept separate from `llm-selector.ts` so cold-start selection logic doesn't grow a second responsibility. Two pieces of `llm-selector.ts` become exported for reuse: `parsePlan` and the `LlmPlan` type (currently module-private) — refinement parses the identical response shape and must not duplicate that parser.

```ts
export type RefinementTurn = {
  instruction: string;   // what the user typed (or "רגע N: ..." from a chip)
  response: string;      // one-sentence summary of what changed, or the rejection reason
  ok: boolean;           // false when validatePlan rejected it — draft unchanged by this turn
  at: string;            // ISO timestamp
};

export type RefinementDraft = {
  result: SelectionResult;   // the refined cut, not yet live
  turns: RefinementTurn[];   // full conversation, oldest first
};

export async function refineSelection(
  projectId: string,
  instruction: string,
): Promise<RefinementDraft>;

export async function applyRefinementDraft(projectId: string): Promise<void>;
export async function discardRefinementDraft(projectId: string): Promise<void>;
```

**`refineSelection` chaining logic:** loads `Project.refinementDraftJson`. If present, the draft's `result` is the starting point (continuing the conversation). If absent, it reconstructs a `SelectionResult` from the live `Selection` rows (`mediaAssetId, startSec, endSec, order, score, reason, videoOverride`) plus `selectionPremise`/`selectionBeatPlan` — this is the first turn of a new conversation against the currently-applied cut. Either way, the candidate pool is always `JSON.parse(project.selectionShortlistJson)`, never re-derived.

Builds the refinement prompt (current cut numbered 1-based + shortlist + conversation history + new instruction), calls the same Anthropic client shape as `LlmContentSelector.requestPlan` (model `claude-sonnet-5`, `max_tokens: 16000`, single user-role message — no `system` prompt, matching existing convention), parses with the now-exported `parsePlan`, validates with the existing `validatePlan`.

**Validation failure is a conversation turn, not a throw.** `LlmContentSelector.select()` throws after one retry; that's correct for cold-start (nothing to fall back to) but wrong for refinement, where "make the opening longer" can legitimately collide with the 3-second hook rule and the user deserves an answer, not a crash. `refineSelection` catches a `validatePlan` failure (after the same one-retry-with-reason pattern already established), appends a turn with `ok: false` and the rejection reason as `response`, and returns the draft **with its `result` unchanged** — the failed attempt doesn't corrupt the working draft.

Every call — success or failure — writes the updated `RefinementDraft` back to `Project.refinementDraftJson` and returns it.

`applyRefinementDraft(projectId)` loads the draft, throws if none exists, calls the existing `persistSelection(projectId, project.outputProfile, draft.result)` — the exact function `applyProfilePreview` already calls — then clears `refinementDraftJson` (which `persistSelection`'s own change, below, also does as a matter of course).

`discardRefinementDraft(projectId)` just nulls the column. No `Selection` row is ever touched by a discard.

### Storage: one additive column, established pattern

```prisma
model Project {
  // ...
  refinementDraftJson String?  // JSON RefinementDraft — see lib/selection/refine.ts
}
```

Same shape as `selectionShortlistJson`/`multiProfilePreviewsJson`: a nullable `String` holding `JSON.stringify` output, replaced wholesale, no history table. Migration is additive; existing rows get `NULL`.

**Cleared in three places:** `applyRefinementDraft` (drafts becomes the live cut, nothing pending), `discardRefinementDraft` (explicit cancel), and `persistSelection` itself (any fresh selection run — whether from re-running selection or applying a different profile preview — invalidates a draft that was refining the *old* cut).

### Correctness fix bundled into `persistSelection`

Found while tracing the checkpoint lifecycle: `persistSelection` creates the `CONTENT_SELECTION` `ApprovalCheckpoint` only `if (!existing)` and never resets `approved`. So today, re-running selection (or applying a different profile) after approval leaves the export section unlocked against a cut nobody actually approved — a pre-existing gap, not something refinement introduces, but refinement makes it worse (edits become frequent and casual). Fix, inside the same transaction: whenever `Selection` rows are replaced, also set the checkpoint's `approved: false, approvedAt: null` if a checkpoint exists. Called out explicitly because it changes behavior on the existing re-run and apply-preview paths too, not just the new refinement path.

## UI

Everything lives inside the existing Content selection `Card` in `app/projects/[id]/page.tsx`, directly below the moment `<ol>`. No new shadcn primitives — `Textarea`, `Button`, `Badge`, `Spinner` already exist, and per `CLAUDE.md` / the `shadcn-add-safe` skill, running `npx shadcn add` here risks reintroducing the Tailwind v4/Base UI mismatch this project deliberately avoids.

New client component `components/refinement-panel.tsx`:

- **Numbered moment chips** — small buttons `1 2 3 …` matching the `<ol>`'s existing order (which today renders no visible ordinal — this is the first place one appears). Clicking chip *N* appends `רגע N: ` to the textarea, so the user can follow with why. This is the concrete form of "combine both": free text stays free, but referencing "the third moment" becomes a click instead of a guess about which clip that is.
- **Textarea**, `dir="auto"` (the codebase's established convention for bidi content — see `page.tsx`'s existing `dir="auto"` usages on Hebrew text blocks), with a send button following the `useTransition` + `Spinner` + `shadow-glow` pattern every other pipeline button already uses.
- **Conversation history** — `turns` rendered oldest-first, each showing the instruction and the model's one-line response; `ok: false` turns get `text-destructive` (existing token, already used for form errors in `new-project-form.tsx`).
- **Draft review**, shown only when `refinementDraftJson` is non-null: the diff (kept/removed/added/reordered, computed client-side or server-side from `draft.result` vs. the live `project.selections` — a pure function, easy to unit test either way) and two buttons: "החל" (apply) and "בטל" (discard).

This is the first controlled input in the codebase (`useState` for the textarea value) — everything else so far is either an uncontrolled form (`new-project-form.tsx`, `useFormState`) or a no-input `useTransition` button. Not a concern, just worth noting in the vault since the user is learning the stack and every new React pattern gets a brief explanation per `CLAUDE.md`'s collaboration note.

### Server actions (`app/actions.ts`)

Following the existing plain-args, throw-on-error, `revalidatePath`-at-the-end shape (matches every action except `createProject`):

```ts
export async function refineSelectionAction(projectId: string, instruction: string): Promise<void>;
export async function applyRefinementAction(projectId: string): Promise<void>;
export async function discardRefinementAction(projectId: string): Promise<void>;
```

## Files touched

| File | Change |
|---|---|
| `prisma/schema.prisma` + new migration | `Project.refinementDraftJson String?` |
| `lib/selection/llm-selector.ts` | Export `parsePlan` and `LlmPlan` (currently internal) |
| `lib/selection/refine.ts` | **New** — types, prompt building, the three exported functions |
| `lib/selection/refine.test.ts` | **New** — unit tests, see Verification |
| `lib/selection/run.ts` | `persistSelection`: clear `refinementDraftJson`; reset checkpoint `approved`/`approvedAt` |
| `app/actions.ts` | Three new actions |
| `components/refinement-panel.tsx` | **New** |
| `app/projects/[id]/page.tsx` | Parse `refinementDraftJson`, render `RefinementPanel` below the moment list |

Reused as-is: `validatePlan`, `persistSelection`, `SelectionResult`/`SelectedSegment`/`CandidateSegment` (`lib/selection/types.ts`), the `useTransition`/`Spinner`/`shadow-glow` button pattern, `dir="auto"` convention.

## Verification

**Unit (vitest — 33/33 passing today, must not regress):**
- Diff function: identical plan → everything `kept`; one moment dropped → exactly one `removed`, rest `kept`; reordered moments → detected as a move, not a spurious add+remove pair.
- `refineSelection` reads from an existing `refinementDraftJson` when present; reconstructs from live `Selection` rows when absent.
- A `validatePlan` rejection appends an `ok: false` turn with the rejection reason and leaves `draft.result` byte-identical to before the call.
- Prompt assembly renders the current cut 1-based, matching the UI's chip numbering.

**Types:** `npx tsc --noEmit` clean.

**End-to-end in the browser** (port 3002) against `חליטת תה - סט מוקטן` (`cms7pzzru0000gs9kp5v5axao`), which already has an approved 9-moment selection:
1. A concrete instruction ("תוריד את הרגע האחרון") → one Anthropic call, a draft appears, diff shows exactly one removal.
2. A second instruction without applying → chains off the draft (turn count 2; the first change is still present in the draft, not reverted).
3. Clicking a numbered chip → `רגע N` lands in the textarea.
4. Apply → `Selection` rows replaced, `refinementDraftJson` cleared, `CONTENT_SELECTION` checkpoint back to unapproved.
5. An instruction that must be refused (e.g. demanding a long opening past the hook window) → a red turn with the reason, draft unchanged, no unhandled error surfaced to the user.

Checked by querying SQLite directly for row state after each step, not by trusting the rendered page alone.

## Self-review

- No placeholders — every field, function signature, and file path above is concrete.
- Internal consistency checked: the draft-clearing behavior in `persistSelection` matches what `applyRefinementDraft` also independently does (belt-and-suspenders, not a contradiction — `persistSelection` is the shared choke point both `applyRefinementDraft` and every other write path go through).
- Scope: single implementation plan, no decomposition needed — one new module, one new column, one new component, three new actions.
- Ambiguity resolved explicitly: "active version only" means refinement is unavailable without an existing shortlist (heuristic-selector projects), stated above rather than left implicit.
