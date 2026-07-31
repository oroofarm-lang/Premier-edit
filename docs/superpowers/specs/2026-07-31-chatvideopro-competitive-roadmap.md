# Competitive roadmap: what Chat Video Pro does, and what's actually worth taking from it

Status: research + proposed roadmap, 2026-07-31. Not a design for one feature — this is the "study the biggest player in the space, then decide what applies" pass the user asked for, in the same spirit as the earlier AutoEdit research that led to the Stage 2 UXP panel. Nothing here is built yet.

## What was studied

[chatvideopro.com](https://www.chatvideopro.com) (product, marketing pages, `/compare/`) plus its real technical docs at `docs.chatvideopro.com` — specifically the Story Cutter workflow doc, the B-roll generation doc, and the documentation index. This is a commercial one-time-license + pay-per-use Premiere Pro UXP plugin built by "Momentohm Media," ~1000+ customers, positioned against Descript, Eddie AI, PremiereCopilot, and others.

Its two halves:

- **Story Cutter** — reads a transcript **exported from Premiere's own built-in Text panel** (`.json`, timestamp-linked to clip positions), takes a brief/prompt, and returns a "paper cut" (verbatim quotes + timestamps + section labels) that gets inserted directly onto the timeline via a chat thread. Explicitly **only handles dialogue** — its own docs state it "does not analyze b-roll, graphics, or visual-only footage."
- **Studio** — a generative-media panel: AI image/video generation (Seedance 2, Kling 3.0, Veo, Sora, etc. via Fal.ai, billed at cost), color grading, transitions, rotoscoping, relighting, reframing, upscaling, and "Avatar Studio" (talking-head video from a photo). This is a completely different kind of B-roll from ours — **synthetic, prompted footage**, not real footage the editor already shot.

## Where this project already matches or beats it

Worth saying plainly, because it's easy to read a competitor's landing page and feel behind when the actual gap is narrower than it looks:

- **Non-destructive, direct timeline execution instead of an XML round-trip.** Story Cutter "moves clips to the playhead inside your existing sequence" via UXP — exactly the architecture this project already built and verified in real Premiere for Stage 2 (`premiere-panel/`). This wasn't a lucky guess; it was the same conclusion independently reached from the AutoEdit research. No gap here.
- **Dual audio+visual understanding is a real, stated gap in their product, not a nice-to-have we're behind on.** Their own docs say Story Cutter "does not analyze b-roll, graphics, or visual-only footage" — full stop. This project's `VisionAnalyzer` (now per-segment, see task #45) plus the `videoFrom` B-roll override are things Chat Video Pro's rough-cut engine cannot do at all: it has no path from "the transcript segment describes X" to "show a different real clip that visually is X." For social content that's often light on dialogue (product shots, ambient footage, cooking demos), that's not a minor feature gap — it's the exact case their tool tells its own users to expect to fail on.
- **Local, private Hebrew transcription is a genuine niche advantage**, not a limitation to apologize for. Their transcription path is Premiere's own Text panel or ElevenLabs — both cloud, both unproven on Hebrew, and CLAUDE.md's own testing already found meaningful quality differences between Whisper model sizes on real Hebrew speech. Nothing in Chat Video Pro's stack replaces the reason `large-v3` local was chosen.

## Ideas worth adopting — mapped onto what already exists here

These are ordered roughly by leverage-per-effort, not by how impressive they sound.

**1. Named per-platform story structures.** Chat Video Pro ships explicit named beat templates per platform (TikTok/Reels: Hook→Payoff→Proof→CTA; YouTube 2–3min: Problem→Credibility→Steps→Result→CTA; long-form: Cold-Open→Context→Rising Tension→Resolution→Reflection). This project's [lib/editing/social-guidelines.ts](../../../lib/editing/social-guidelines.ts) already carries loose heuristics (hook timing, cut frequency, length windows) but no named structure the LLM selector is asked to pick from — right now `beatPlan` in `llm-selector.ts` is invented fresh every run. Giving it 2-3 named structures per `OutputProfile` to choose between (or default to) is a small prompt change with a real consistency payoff.

**2. Expose the pre-filter shortlist as its own browsable checkpoint.** `LlmContentSelector` already computes a shortlist (~4x target duration) via `HeuristicContentSelector` before committing to a final cut — but today it's an internal implementation detail the user never sees. Chat Video Pro's `/select` command does something structurally similar (full-scan, categorize by hook/value/emotional-peak/CTA, let the human hand-pick) and treats it as a first-class step. This actually fits *this* project's own MVP philosophy — three approval checkpoints, no blind runs — better than it fits Chat Video Pro's single committed paper-cut. Surfacing the shortlist (with its visual+text signals) as something the user can see before the LLM narrows it down would strengthen the existing "Content selection" checkpoint rather than compete with it.

**3. Structured constraints instead of one free-text brief.** Their hard-constraint list (timecode range, required topic, excluded topic, named soundbite, pinned start/end) all stack and persist. This project's `brief` is one Hebrew string the LLM selector interprets loosely. `validatePlan` already exists as a mechanism for hard, code-enforced rules (hook window, `MAX_REUSE_PER_ASSET`) — extending it to check a small set of explicit constraints (e.g. "must include a moment mentioning X," "nothing after timestamp Y") the same reject-and-retry way is very much in this project's existing style, and arguably stronger than Chat Video Pro's version: theirs is prompt-level ("tell it to skip pricing"), enforced only by the model's compliance — this project already has the infrastructure to actually verify it.

**4. One pass, multiple deliverables (`/batch`).** Chat Video Pro generates a TikTok + YouTube + long-form cut from one transcript in one message. This project's `OutputProfile` enum (`REEL_SHORT` / `SOCIAL_POST` / `YOUTUBE_LONG`) already models exactly this axis, but today the user re-triggers `runContentSelection` once per profile by hand, and each run redoes vision analysis lookups from scratch (cheap now that it's cached per-segment, but the selection call itself still runs 3 separate times). A "generate all profiles from one pipeline run" mode is a real time/click saver, not a new capability — everything it needs already exists.

**5. Conversational refinement after the first cut.** "Cut 30 seconds from section 2," "replace the third soundbite" — Chat Video Pro's Story Cutter holds thread context and re-generates a paper cut per instruction instead of the user editing a full new brief and re-running from zero. Nothing in this project supports narrow follow-up edits today — `runContentSelection` is all-or-nothing. This is the biggest lift of the five (needs the LLM selector to accept a prior plan + a single instruction and return a targeted diff, plus UI for it), so it's listed last, but it's the one most likely to change how the approval checkpoint actually feels to use — right now "I don't like moment 3" means re-running the whole selection and hoping the brief wording nudges it correctly.

## Ideas deliberately not adopted (with why)

- **AI-generated synthetic B-roll (Seedance/Kling).** Conceptually the opposite of this project's approach: they generate footage that was never filmed; this project selects and reuses footage the client actually shot. For local restaurant/product reels specifically, the real footage often *is* the point — a generated stand-in cutaway risks looking exactly as generic as the stock-footage problem their own docs say they're solving. Worth flagging as a possible far-future "gap-filler when no real coverage exists at all" idea — which is what the still-undocumented `broll-agent` in CLAUDE.md's Planned Agents table was already reserved for — but it is not close to the current MVP boundary and shouldn't be scheduled now.
- **The rest of Studio (Cinematic Lab, Avatar Studio, Rotoscope, Relight, Reframe, Upscale, Motion Director, AI Transitions, color grading).** All of this lives past this project's explicit automation boundary — "rough assembly only... does not touch color, do final captions burn-in, or do final audio mix" (CLAUDE.md). Adopting any of it now would be scope creep against a boundary the user set deliberately, not an oversight to fix.
- **BYOK multi-model wholesale billing via Fal.ai.** A monetization design for a commercial product selling to many customers. This is a single-user local tool with one Anthropic key already resolved (Open Decision #3) — there's no stack of vendor subscriptions here to consolidate.
- **Switching transcription to Premiere's built-in Text panel export.** Would trade a proven, tested-on-real-Hebrew-footage local pipeline for an unproven one, purely to match their architecture. No evidence it would be better, real evidence (CLAUDE.md's own testing) that Whisper `large-v3` handles Hebrew well. Not worth it without a specific reason.

## Proposed new tasks

In priority order, each buildable independently on top of the current architecture:

| # | Task | Touches | Why this order |
|---|---|---|---|
| 46 | Named per-platform story structures in the selection prompt | `lib/editing/social-guidelines.ts`, `lib/selection/llm-selector.ts` | Smallest change, prompt-only, immediate consistency gain |
| 47 | Surface the pre-filter shortlist as a visible pre-selection checkpoint | `lib/selection/llm-selector.ts` (export the shortlist), `app/projects/[id]/page.tsx` | Fits the existing 3-checkpoint model directly; no new selection logic, just visibility |
| 48 | Structured constraints (topic include/exclude, timecode bounds) enforced via `validatePlan` | `lib/selection/llm-selector.ts`, `lib/selection/types.ts` | Reuses the existing reject-and-retry validator; makes the brief mechanically reliable, not just suggestive |
| 49 | One-pass multi-profile generation (`/batch` equivalent) | `lib/selection/run.ts`, UI trigger | Pure orchestration — no new selection intelligence, just running the existing pipeline 3x under one click and one shared vision pass |
| 50 | Conversational refinement of an existing selection | `lib/selection/llm-selector.ts` (accept prior plan + instruction), new UI | Highest lift, highest payoff — changes the approval checkpoint from "accept or full re-run" to "accept, or nudge" |

Not scheduled, tracked as a future idea only: AI-generated B-roll as a last-resort gap-filler when no real footage covers a moment (ties to the long-reserved but unbuilt `broll-agent`).
