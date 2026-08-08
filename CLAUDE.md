# CLAUDE.md

Guidance for Claude Code working in this repository.

**This file is an index, not an archive.** It is injected into every session and re-injected after every compaction, so it holds only what changes what you type. Depth lives in `Volt/` — see *Token discipline* at the bottom before reading anything large.

## Project

**Premier Edit** — an agent-based video editing system. The user points at a footage folder and an audio folder, gives a brief in natural language, and the system performs real edits inside Adobe Premiere Pro.

- Product spec: [docs/PRD.md](docs/PRD.md). Architecture and history: `Volt/Tech Stack.md`, `Volt/Progress Log.md`, `Volt/Decisions and Open Questions.md`.
- **MVP scope: social media only** (restaurant/product reels, short posts). Wedding/long-form is a future target — don't build for it.
- **Automation boundary: rough assembly only.** No color, no captions burn-in, no final mix. Three approval checkpoints (after ingest+transcription, after content selection, after rough cut) — no blind end-to-end runs.

## Standing constraints

These are not negotiable and have each been re-established more than once.

1. **No Anthropic API calls.** The balance is empty and stays empty. Editorial intelligence runs as **Claude Code agents** on the user's subscription (`.claude/agents/`), never as in-app LLM calls. `LlmContentSelector` and `lib/vision/` stay in the tree, unused, for whenever a key is funded. **Every stage must have a free path** — and reaching it must not require predicting the failure in advance (a key that cannot be billed is not the same state as no key; fall back on the *error*).
2. **Never open or script real Premiere.** Loading the panel and watching the cut is the user's own step. `npm run panel:sim` proves bookkeeping, not that a cut looks right.
3. **`main` now carries everything** — task #27 merged `stage2-panel` on 2026-08-08 (83 commits, ~17.7k lines) after a week of the code living only on the branch. Verified on `main`: 220 tests, tsc clean, `next build` succeeds, `panel:sim` 20/20. The `stage2-panel` worktree still exists and still works; **whether new code goes to `main` directly or keeps using the branch is the user's call and has not been decided.** Until it is, prefer `main` and merge promptly — a week of divergence is what made this a task.
4. **Update Volt and git every round.** The user asks for this explicitly and repeatedly.
5. **Red-first, always.** Disable the fix and watch the test fail before believing it. Three false greens so far, two of them because a find-and-replace pattern silently matched nothing — **assert the text actually changed** before trusting a run. Agent: `red-first`.

## Collaboration note

The user is **new to software development** — first project touching TypeScript/Next.js/Prisma. Build working code rather than leaving scaffolding as an exercise; explain new patterns briefly as they appear. No deadline pressure. The user writes in Hebrew; the product UI is English/LTR by their own decision (RTL was shipped and reverted the same day).

## Tech stack

| Layer | Technology |
|---|---|
| UI + orchestration | Next.js 14 App Router (`npm run dev`, port 3002 for the panel) |
| Styling | Tailwind **v3** + shadcn/ui pinned to **Radix** |
| Data | Prisma 6 + SQLite |
| Media | ffmpeg / ffprobe (npm static binaries) |
| Transcription | faster-whisper `large-v3`, local `.venv` |
| Shot analysis | ffmpeg filters — free, no model |
| Premiere bridge | UXP panel (`premiere-panel/`, primary) + FCP7 XML export (fallback) |

**Rules that silently break code if ignored** — full explanations in `Volt/Tech Stack.md § Build and runtime traps` and `§ Prisma specifics`:

- Import from `@/lib/generated/prisma/client` and `.../enums`, **never** `@prisma/client`. No barrel — the bare folder path does not resolve. Use the `lib/db.ts` singleton.
- `ffmpeg-static` / `@ffprobe-installer/ffprobe` must stay in `next.config.mjs` → `experimental.serverComponentsExternalPackages`.
- Adding a shadcn component: **use the `shadcn-add-safe` skill**, not the bare CLI. Tailwind v3 + Radix vs. the CLI's v4 + Base UI default has broken the build three times.
- `lib/ingest/probe.ts` reads `r_frame_rate` (not `avg_frame_rate`) and applies the rotation Display Matrix. Both only matter on real camera footage; skipping the second produced a landscape sequence from vertical footage.
- Vitest does not load `.env`, so a module importing `@/lib/db` cannot be unit-tested. This is why `refine.ts`/`refine-plan.ts` and `validate.ts`/`script-apply.ts` are split — **keep pure logic Prisma-free.**

## Architecture: two timelines, and a script in front of them

The pipeline chooses **what is said** and **what is seen** separately.

```
ingest → transcription
       → script      (lib/script/)     what is said, written by an agent
       → audio spine (lib/selection/)  the story, from the spoken word alone
       → shots       (lib/shots/)      every usable span, scored by ffmpeg, free
       → picture     (lib/video/)      shots laid over the spine
       → cut/export  (lib/cut/, lib/export/) → UXP panel or FCP7 XML
       → manual polish in Premiere (color, mix, finish)
```

**The script layer is the front door**, because every other quality problem turned out to be downstream of it: a cut can have clean tracks, completed actions and matched picture and still be about nothing.

```bash
npm run script:brief -- "<project>"                          # everything spoken, one file
npm run script:score -- "<project>" [script.json ...]        # rank candidates, list unopened takes
npm run script:apply -- "<project>" <script.json> [--check]  # validate, then persist
```

- **A script line *is* a `Selection` row** — no new table, and the path inherits the approval checkpoint, picture-layer invalidation and the whole export chain unchanged.
- **`validateScript` rule 3 is the one that matters.** Quoted text is compared against the transcript's own word timings, so a writer cannot put words in the speaker's mouth — the real voice plays over those frames. **Tell a writer to quote the mangled transcription**, not the corrected phrase: the audio is right even when the transcript is not.
- **A line is one continuous, complete run of speech — default to whole sentences.** This file used to say word-level cutting "is the point"; that was wrong and the user rejected the result outright (*"המילים פשוט לא מתחברות"*). Fragmenting produced `הרכיב הראשון,` never naming the ingredient, and a line that was just `תמסוג`. **Fewer cuts is a feature** (*"פחות חיתוכים"*), merging adjacent segments into one long line is preferred, and **pauses are fine** (*"לא אכפת לי שיש רגעים של שקט"*) — never fragment to tighten. Cut mid-sentence only when you can name what it buys.
- **`npm run script:score` before choosing between candidates** (`lib/script/score.ts`). Five bands, each a rejected defect, plus the unbroken takes nobody opened. Two rules easy to get backwards: **a take is not a sentence** (4s gap — the real 12.82s take holds a 3.14s pause, and splitting there *is* the rejected cut) and **the hook is time to the first complete sentence, not the line length**. **It ranks craft, never story choice** — v3 scores 96 and was rejected on content.
- **Read any script aloud as one paragraph before trusting it.** The validator proves every word is real; only reading catches broken Hebrew at a join or a pronoun with no referent. `scripts/_read-cut.ts`-style concatenation is the check.
- **Audio-only builds** (`placeAudioOnly`, checkbox on the pipeline screen, on by default) leave V1 empty deliberately — picture is the loudest thing in a sequence, so stripping it is the only way to hear whether the words hold up.

**Agents do the writing:** `script-writer` → `script-critic` (fresh context, never sees the writer's reasoning). Others: `cut-coherence`, `premiere-api`, `panel-check`, `red-first`, `shot-tuner`.

**The expert layer (`lib/experts/`) is prose, not agents.** An expert appends guidance to a call that already runs — that is what reconciles "a crew of agents" with "stop burning tokens."

## Recurring failure patterns

All three have caused user-visible quality complaints more than once. Check for them before theorising.

1. **A signal measured, stored, then ignored by the decision that consumes it.** `movementCompleteness` scaled hold length while the trim ignored it (the pour that never reached the cup: 11 shots graded ≥0.80 lost 16.5s of *their own endings*). `isSyncFor` was read by the LLM prompt but not by the heuristic planner that actually runs. When something reads badly on screen, verify the signal survives all the way to the frames that ship.
2. **State that outlives what it describes.** `VideoPlacement` rows are absolute positions on a timeline of a particular length. A 34.75s picture layer once survived a re-selection down to a 20.3s spine, leaving 14.45s of picture past the end of the audio.

3. **A transcript trusted as a measurement of sound.** Word timings found no gap over 0.16s in a cut that carried a full second of silence — faster-whisper absorbs a pause into a neighbouring word's *own span*, so no gap rule can see it. Measure audio with ffmpeg (`lib/craft/quiet.ts`), and pick a silence threshold off the noise floor's **peaks**, not its mean. Never apply the picture floor `MIN_FRAGMENT_SEC` (0.7) to audio — it deletes words.

Diagnostics, all free: `npm run render:spine` (renders the spine to a wav and measures its silence — answers "does the story hold up as sound" without Premiere), `npm run coherence` (HEARD vs SEEN per moment), `npm run measure:trim`, `npm run craft:preview`.

## Premiere / UXP

Panel at [premiere-panel/](premiere-panel/) — deliberately **not** under `lib/`; it has its own manifest and runtime. Load instructions: `premiere-panel/README.md`. Verify with `npm run panel:sim` (20 scenarios) and `npm run panel:preview` (browser, real `index.html` + UXP stub).

**Before writing any UXP call, use the `premiere-api` agent.** Guessed signatures have been wrong repeatedly. The API's hard facts:

- Every timeline write goes through `project.lockedAccess(() => project.executeTransaction(...))` — required, and it makes a build one undo step.
- **No Unlink, no link, no setLinked** anywhere in the 4,675-line `.d.ts`. `createOverwriteItemAction` always places both halves, so the panel parks unwanted halves and sweeps them. Sweep **by read-back, never by fixed index** (an N-channel source occupies N tracks) and **re-fetch every handle per track** (a transaction invalidates objects read before it → `"The script object is no longer valid."`).
- **No audio-transition API** — FCP7 XML remains the only route to a real crossfade.
- **Volume automation was tried and reverted.** Do not retry without reading `Volt/Tech Stack.md`: **keyframe positions are sequence-relative, not clip-relative**, so clip-local ramps piled up at the start of the timeline and damaged the audio. **Hard audio cuts are correct until the user asks otherwise.**

FCP7 export ([lib/export/fcp7.ts](lib/export/fcp7.ts)): everything is measured in **frames** via the sequence rate, and each `<file>` is defined in full exactly **once** anywhere in the document, then referenced by id.

## Token discipline

Sessions here run long and compact repeatedly, so reading cost compounds.

- **Never read `Volt/Progress Log.md` whole** (~120KB). Grep it, or read a dated section. Same for `Volt/Decisions and Open Questions.md` (~28KB) and `docs/PRD.md`.
- **Never grep or read `lib/generated/prisma/`** — ~20k lines of generated client. It is gitignored; regenerate with `npx prisma generate`.
- Prefer `grep -c` / heading listings over full reads when checking whether a fact is already recorded.
- Put new war stories in Volt and a one-line rule here. If this file grows past ~10KB, that is the bug.
