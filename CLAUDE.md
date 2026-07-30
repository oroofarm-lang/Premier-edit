# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Premier Edit** — an agent-based video editing system. The user gives instructions in natural language (or adjusts parameters directly), and the system performs real edits inside an Adobe Premiere Pro project: from pointing at a raw footage folder + audio folder through to a near-final cut.

Full product spec: [docs/PRD.md](docs/PRD.md). Read it for the reasoning behind any decision below — this file only summarizes the parts that should shape how code gets written.

**MVP scope: social media content only** (restaurant/product reels, short posts). Wedding/long-form editing is a stated future target, not part of this version — don't build for it yet.

**Automation boundary (MVP):** rough assembly only. The system finds, selects, and orders takes based on the transcript + a short natural-language brief, and does a rough cut — it does **not** touch color, do final captions burn-in, or do final audio mix. The user finishes those by hand in Premiere. Three approval checkpoints gate the pipeline (after ingest+transcription, after content selection, after rough cut) — no blind end-to-end runs.

## Collaboration note

The user is **new to software development** — first project touching TypeScript/Next.js/Prisma. Build working code directly rather than leaving scaffolding as an exercise; briefly explain new patterns/tools as they're introduced instead of assuming familiarity. No deadline pressure — prefer the PRD's own staged roadmap (§12) over compressing steps.

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| UI + orchestration | Next.js 14 (App Router) | `npm run dev` |
| Styling / components | Tailwind CSS + shadcn/ui | `npx shadcn@latest add <component>` to add more |
| Data | Prisma 6 + SQLite | see below — client import path is non-default |
| Local media layer | ffmpeg / ffprobe (npm static binaries) | see Media & transcription below |
| Transcription | faster-whisper in a local Python venv | see Media & transcription below |
| Visual understanding + smart selection | Anthropic API (`@anthropic-ai/sdk`) | needs `ANTHROPIC_API_KEY` in `.env`; see Visual understanding below |
| Premiere bridge | Timeline XML export (Stage 1) → UXP/CEP panel (Stage 2) | Stage 1 only; see Premiere Integration below |

**Prisma specifics:** this project uses the newer `prisma-client` generator with a custom output path. Import `PrismaClient` from `@/lib/generated/prisma/client` and enums/types from `@/lib/generated/prisma/enums` — **not** `@prisma/client` (older tutorials assume the latter — don't follow that pattern here), and note the generated folder has no barrel `index.ts`, so the bare `@/lib/generated/prisma` path does not resolve. Use the shared singleton in [lib/db.ts](lib/db.ts) rather than constructing a client per module. Config lives in `prisma.config.ts` (not just `.env`) because Prisma 6+ no longer auto-loads `.env` — `prisma.config.ts` explicitly does `import "dotenv/config"`. Schema: [prisma/schema.prisma](prisma/schema.prisma), already modeling the 8 entities from PRD §10 (`Project`, `MediaAsset`, `Transcript`, `Selection`, `Timeline`, `EditVersion`, `StylePreference`, `ApprovalCheckpoint`).

**Media & transcription specifics:** this machine has no Homebrew and no system ffmpeg, so the binaries come from npm — `ffmpeg-static` and `@ffprobe-installer/ffprobe`. Both ship native binaries and non-JS files, so they must stay listed in `next.config.mjs` under `experimental.serverComponentsExternalPackages`; bundling them fails the build. Transcription runs **locally** through faster-whisper in `.venv` (created by `scripts/setup-transcription.sh`, gitignored), driven by `scripts/transcribe.py`, which accepts multiple audio paths in one process (loading the ~10s model weight cost once per batch, not once per file — real-footage testing showed the naive one-process-per-file approach wasted more time on reloading than on actual transcription) and prints a JSON array on stdout, progress on stderr. Model weights land in `./models` (gitignored, large-v3 is ~3GB). Node never imports a vendor SDK directly — it goes through the `Transcriber` interface in [lib/transcription/types.ts](lib/transcription/types.ts), which is what keeps open decision #1 open. `runTranscription` ([lib/transcription/run.ts](lib/transcription/run.ts)) guards against a real duplicate-invocation race observed in testing (the button disables on the next render, not synchronously, so a fast double-fire can start two batches against the same project) with an in-flight `Set` per project.

**Ingest gotcha found on real camera footage, not synthetic test clips:** [lib/ingest/probe.ts](lib/ingest/probe.ts) has two ffprobe subtleties that only show up on real files. (1) It reads `r_frame_rate` (the container's declared nominal rate, e.g. exactly `50/1`) rather than `avg_frame_rate` (frame-count/duration, computed per file and almost always slightly off — e.g. `49.81` for footage that's actually a clean 50fps — which wrongly trips the FCP7 NTSC flag). (2) It reads the video stream's rotation (`side_data_list` Display Matrix, falling back to the legacy `tags.rotate`) and swaps width/height on a 90/270° turn — phones and cameras routinely store frames landscape and flag a rotation to apply at playback, so the raw encoded width/height are not the display orientation. Skipping this produced a horizontal sequence from footage shot vertically for social media.

**shadcn/ui specifics — read before running `npx shadcn add ...` again:** `components.json` is pinned to `"base": "radix"` (Radix UI primitives), matching this project's Tailwind **v3** setup (`tailwind.config.ts` + `@tailwind` directives). The shadcn CLI's current defaults target Tailwind v4 and the newer Base UI library instead — running `init` without care, or trusting its generated `globals.css`/font wiring blindly, will reintroduce that mismatch. Two project-specific things exist only to bridge this gap:
- Colors in `app/globals.css` are stored as **raw decomposed OKLCH components** (e.g. `--ring: 0.708 0 0;`, no `oklch(...)` wrapper), and `tailwind.config.ts` wraps them as `oklch(var(--x) / <alpha-value>)`. This is required so opacity-modifier utilities (`bg-primary/80`, `outline-ring/50`, etc.) work under Tailwind v3 — plain `var(--x)` mappings silently break any class using a `/NN` opacity suffix.
- `app/layout.tsx` uses `next/font/local` for the Geist fonts (matching the files already in `app/fonts/`) — do **not** re-add `next/font/google`'s `Geist`, it isn't a real Google Fonts entry and will fail the build.

When adding a new shadcn component, sanity-check its generated class list against this before assuming it works (things like `--radius-md`, `in-data-*` variants are v4-only and won't have effect here — usually harmless visually, but know why).

## Open decisions resolved so far

1. **Transcription engine (PRD §2.3/§7):** **local faster-whisper `large-v3`** for now, behind the `Transcriber` interface so a cloud vendor stays swappable. Chosen after an actual Hebrew test: on a clean 8s Hebrew sample, `large-v3` was near-perfect while `small` mangled ordinary words (השף→אשף, עגבניות→הגווניות), so the small models are not viable for Hebrew. Re-tested on 38 real camera clips (~8 min total audio, outdoor/noisy, natural conversation) — batched into one process (see below), the whole folder took ~5 minutes. Quality on real speech: handles natural conversation well, but consistently mangled the domain-specific botanical term "זעתר" (za'atar) in a recurring phrase across ~6 different clips — different garbage each time, never correct. Confirms the standing caveat that TTS-clean audio is an easy case; still worth comparing against Deepgram/ivrit.ai specifically on domain vocabulary, not general speech quality. The local path's real advantage remains that client footage never leaves the machine.
2. **Timeline export format (PRD §11.6):** **FCP7 XML** for the MVP — Premiere Pro has native File→Import support for it, no plugin needed. OTIO has no native Premiere import path. Revisit once the user test-imports a sample file in their actual Premiere version.
3. **Budget / LLM sizing (PRD §7):** **resolved** — the user created an Anthropic API key (separate billing from a Claude.ai subscription) specifically to get real visual understanding and narrative-aware content selection, after real-footage testing showed the no-API heuristic couldn't see silent clips or build a coherent sequence. See "Visual understanding & smart selection" below.

## Visual understanding & smart selection

Real-footage testing (see below) surfaced two hard limits of the transcript-only heuristic selector: a clip with no speech is invisible to it no matter how visually relevant it is, and it has no sense of narrative — it will happily reuse one long clip four times rather than build a hook→body→payoff sequence. Both needed an LLM, which needed the budget decision above resolved.

**Architecture**, following the same vendor-neutral-interface pattern as `Transcriber`:
- [lib/vision/types.ts](lib/vision/types.ts) — `VisionAnalyzer` interface. [lib/vision/claude-vision.ts](lib/vision/claude-vision.ts) — the only implementation so far, `claude-haiku-4-5` (cost-efficient; this is closer to captioning than open-ended reasoning, so the cheapest vision-capable tier is the right default).
- [lib/vision/extract-frames.ts](lib/vision/extract-frames.ts) samples 3 frames per clip (10%/50%/90% of duration) via ffmpeg. ffmpeg applies the container's rotation tag automatically when decoding to an image, so these come out upright even for the rotated phone/camera footage below — no manual correction needed here, unlike probe.ts.
- A `VisualAnalysis` row (schema: `prisma/schema.prisma`) is stored per `MediaAsset`, one-to-one, parallel to `Transcript`.
- Visual analysis is **not** a separate approval-gated pipeline stage — it runs automatically inside `runContentSelection` ([lib/selection/run.ts](lib/selection/run.ts)) when `ANTHROPIC_API_KEY` is set, best-effort. The user approves the resulting selection, not the visual analysis itself; this was a deliberate choice to keep manual steps from growing every time a capability is added.
- [lib/selection/llm-selector.ts](lib/selection/llm-selector.ts) — `LlmContentSelector`, `claude-sonnet-5`. It does not see every candidate: it re-uses `HeuristicContentSelector` as a pre-filter (asking for ~4x the target duration) to keep the prompt bounded, then does the actual editorial judgment — order, diversity across sources, hook/body/payoff structure — over that shortlist. `runContentSelection`'s default selector auto-upgrades from heuristic to LLM based on whether the env var is set — same button in the UI either way.
- [lib/editing/social-guidelines.ts](lib/editing/social-guidelines.ts) — short-form social video editing heuristics researched 2026-07-30 (hook within 1-3s, 15-20s or 45-60s ideal length avoiding a 30-40s drop-off zone, ~1.5-2.5s average cut frequency, diversity over reusing one source). These are aggregated creator/marketing-industry consensus, **not** Meta's own published algorithm data — treat as informed defaults for the prompt, not guarantees. Sources: [BrandGhost](https://blog.brandghost.ai/posts/instagram-reels-best-practices-for-creators/), [Fobet Media](https://fobetmedia.com/instagram-reel-hooks/), [OpusClip](https://www.opus.pro/blog/instagram-reels-hook-formulas), [Aibrify](https://aibrify.com/blog/short-form-video-editing-captions-b-roll-guide).

**A real bug worth knowing if you touch the vision prompt again:** for clips where the 3 sampled frames show meaningfully different content (e.g. someone walking across a field), the model would describe each frame as its own separate JSON object instead of one summary of the whole clip — producing 2-3 concatenated JSON blocks that fail `JSON.parse`, and often exceeding the token budget before finishing. Fixed by being explicit in the prompt that multiple frames describe one continuous clip and asking for exactly one JSON object even when content changes across frames, plus defensive parsing in `claude-vision.ts` that extracts the first balanced-brace JSON object rather than trusting the whole response is valid on its own.

**Still unverified:** the LLM selector's real editorial quality has only been checked on one real project (see below) — it produced a genuinely better sequence than the heuristic there, but that's one data point, not a validated pattern.

## Planned Pipeline (MVP, PRD §9)

```
ingest → transcription → content selection (per brief) → rough cut → audio sync
   → captions (pre-chosen font/style) → assembly → QC → export timeline (FCP7 XML)
   → manual import to Premiere → manual polish (color, mix, finish)
```

Color and final finish are explicitly outside the automation boundary for this version.

## Planned Agents (PRD §6)

Documentation only — none of these exist as files under `.claude/agents/` yet.

| Agent | Stage | Responsibility |
|---|---|---|
| `ingest-agent` | ingest | Scan footage + audio folders, register media assets, run proxies |
| `transcription-agent` | transcription | Hebrew speech-to-text, audio/video sync |
| `content-selection-agent` | content selection | Pick takes/moments per a natural-language brief + transcript |
| `cut-agent` | cut & pacing | Build rough sequence and pacing |
| `audio-agent` | audio | Sync sources, basic cleanup — not final mix |
| `captions-agent` | captions | Burned-in captions using a pre-chosen font/style, Hebrew RTL |
| `assembly-agent` | assembly | Combine everything into one exportable timeline |
| `qc-agent` | QC | Sanity checks — duration matches profile, no gaps/overlaps, sync OK |
| `color-agent` | — | **Out of MVP.** Documented for a future stage only. |
| `style-memory-agent` | — | Learns and stores recurring editing preferences over time (PRD §6.2) |
| `broll-agent` | — | Detects missing B-roll/coverage and suggests a replacement |

## `.claude/`

Project-specific customizations live here:

- `.claude/agents/` — subagent definitions
- `.claude/skills/` — project skills
- `.claude/commands/` — slash commands

All three are currently empty placeholders (`.gitkeep` only) and will be filled in as the pipeline is built, one agent at a time.

## Premiere Integration

- **Stage 1 (current target):** the system produces an FCP7 XML timeline file; the user imports it into Premiere manually and polishes from there.
- **Stage 2 (future):** a UXP panel inside Premiere for live interaction — no manual export/import round-trip.
- **Stage 3 (future, not committed):** a read-back layer so the system also sees manual changes the user made, not just push changes to Premiere.

Stage 1 is **implemented**: [lib/export/fcp7.ts](lib/export/fcp7.ts) writes xmeml v5 into `./exports` (gitignored). Two things to know before touching it: everything in that format is measured in **frames**, so all timing goes through the sequence frame rate (getting it wrong yields an XML that imports but drifts out of sync), and each source `<file>` must be defined in full exactly **once** anywhere in the document and referenced by id thereafter — an audio-only source is defined on the audio track, so the definition cannot be hardcoded to the video branch.

The generated XML is verified well-formed with correct frame math and no dangling file references, but **has not yet been test-imported into a real Premiere install** — that is still the open half of decision #2.
