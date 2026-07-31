# RTL support for the web app and the UXP panel

**Status:** REVERTED 2026-07-31, same day. The user asked for RTL, the work below shipped and was verified (`be68695`), then the user said it was a mistake and asked to keep everything English/LTR instead. Reverted cleanly via `git revert be68695` → commit `2493953` on `stage2-panel`. Left in place for history, not deleted — the bidi lesson in it (plain English text with digits/punctuation garbles under an RTL ambient direction) is still true and worth knowing if RTL is ever revisited.
**Date:** 2026-07-31

## Problem

The product is Hebrew-content-first (project briefs, transcripts, selection reasons, premises, refinement conversations) but the document has never had a direction set — `app/layout.tsx` is `<html lang="en">` with no `dir`, and `premiere-panel/index.html` has no `dir` either. The only RTL handling that exists is scattered per-element `dir="auto"` on individual Hebrew text blocks, added incrementally as each feature shipped. That's a patch, not a real implementation.

## Investigation before deciding anything

Read the actual current code rather than trusting the earlier audit (which flagged this as a gap but didn't quantify it):

- **Tailwind version is 3.4.1** — built-in `rtl:`/`ltr:` variants (added in Tailwind v3.3) are already available; no `tailwindcss-rtl` plugin needed.
- **Physical-direction utility classes are nearly absent**: a full grep of `app/` and `components/` for `pl-|pr-|ml-|mr-|left-|right-|rounded-l-|rounded-r-|border-l-|border-r-|text-left|text-right` found exactly **10 occurrences, all in `button.tsx`/`badge.tsx`'s icon-spacing logic** (`has-data-[icon=inline-start]:pl-2` etc.), plus one `text-left` on the media-assets table header. Everything else already uses flex/gap layouts, which are direction-aware by the CSS spec (`flex-direction: row` runs along the inline axis, so it already flips under `dir="rtl"` with zero code changes — confirmed this is not something to "implement," it's already true).
- **`components.json` has `"rtl": false`** — a shadcn CLI setting that only affects the class conventions of future `npx shadcn add` runs, not already-generated files.
- **The app's chrome is bilingual**: card titles, button labels, and table headers are English ("Content selection", "Load plan", "Export timeline XML"); the actual content inside those chrome elements — briefs, transcripts, premises, reasons, refinement turns — is Hebrew. This mix is the real design question: flipping the whole document to RTL will *also* mirror the English chrome (title/button pairs swap sides, table headers right-align by default). That is not a bug — it's standard, expected behavior on real Hebrew products that mix English brand/technical terms into an RTL layout (Hebrew Gmail, Hebrew news sites, Israeli SaaS dashboards all do exactly this) — but it's a real visual change worth stating as a deliberate choice, not something that slips in unnoticed.

## Decision

**Flip the whole document to RTL** (`dir="rtl" lang="he"` on `<html>`, both surfaces) rather than continuing the per-element `dir="auto"` patch approach. Reasoning:
1. This is the standard, complete way a Hebrew-primary product implements RTL — not "RTL paragraphs inside an LTR shell."
2. Every instruction in every conversation this project has had is in Hebrew; this is unambiguously a Hebrew-first personal tool.
3. English chrome mirroring is a cosmetic, expected side effect, not a defect — verified by checking real Hebrew products behave the same way.
4. The alternative (targeted per-region RTL, leaving the shell LTR) is exactly the current state, and it's insufficient — that's why this task exists.

**Existing `dir="auto"`/`dir="ltr"` overrides on individual elements are kept, not removed.** They still do real work under a RTL-base document: `dir="auto"` on the beat-plan line (`מבנה: הוק ← גוף ← סיום`) independently resolves to RTL from its own Hebrew content regardless of the ambient direction (so no change in behavior there — already correct); `dir="ltr"` on file paths and timecodes stays exactly as important as before, since a file path or a `12.34–15.67s` range should never flow RTL regardless of the surrounding document.

## Scope

### Web app
- `app/layout.tsx`: `<html lang="he" dir="rtl" ...>`.
- `components.json`: `"rtl": true`, so future `npx shadcn add` runs generate RTL-correct components by default.
- `components/ui/button.tsx`, `components/ui/badge.tsx`: the 10 physical `pl-`/`pr-` icon-spacing classes become logical `ps-`/`pe-` (`padding-inline-start`/`-end`). These are currently dead code (nothing in the app sets the `data-icon` attribute they key off), but fixing them now means the *next* button that uses an icon is correct by default instead of silently wrong under RTL.
- The media-assets table's `text-left` header: kept as a deliberate LTR island via an explicit override rather than converted to logical `text-start` — a file-listing table (paths, byte-oriented format info) reads more naturally kept left-anchored regardless of document direction, matching how tabular/technical data commonly stays LTR even in RTL products. This is checked visually, not assumed.
- Everything else (flex rows, gap-based spacing, grid `justify-self-end` which is already a logical CSS Box Alignment keyword, `dir="auto"` paragraphs) needs no code change — verified by reading the CSS spec, then confirmed visually.

### UXP panel
- `premiere-panel/index.html`: same `dir="rtl" lang="he"` on `<html>`.
- `premiere-panel/styles.css`: `#plan-list`/`#log`'s `padding: 6px 6px 6px 18px` is a physical box (extra-wide left padding for the list marker/indent) that will not flip under RTL on its own — converted to `padding-block: 6px; padding-inline: 6px 18px;` so the marker-side space follows the reading direction instead of staying stuck on the left.
- The `.chip-row` flex layout and the numbered-chip rendering in `index.js` need **no JS change** — flex row ordering is direction-aware by spec, so chip "1" already lands on the reading-start side (right, under RTL) automatically once `dir="rtl"` is set on an ancestor.
- Adobe Spectrum web components (`sp-heading`, `sp-body`, `sp-button`, `sp-picker`, `sp-menu`) are documented as RTL-aware as part of Adobe's design system (Creative Cloud ships in Hebrew/Arabic locales) — this is stated from general knowledge of Spectrum, **not verified against this project's actual UXP runtime**, consistent with the standing rule that Premiere itself is never opened or scripted directly here. Flagged explicitly as something the user's own load-and-check step should confirm.

## Verification

- Web app: `preview_start` on port 3002, screenshot before/after on a real project page with Hebrew content (moment list, premise, refinement conversation) and English-chrome areas (media table, card headers), at both mobile and desktop widths. Confirm nothing overlaps or truncates, confirm chip ordering reads right-to-left, confirm the back-link and beat-plan arrow still read sensibly.
- `npx tsc --noEmit` and `npx vitest run` stay clean — no logic changed, only markup/class attributes.
- UXP panel: static review only (same limitation as every prior panel change this session) — `index.js` requires `premierepro`, which only resolves inside Premiere's own runtime. The user's own reload-and-check via the UXP Developer Tool is the real verification, with Spectrum's RTL behavior as the one specific thing to watch for.

## Self-review

No placeholders. The one judgment call (full-document RTL vs. targeted) is stated with its reasoning, not left implicit. Scope is genuinely small — confirmed by grep before writing any change, not assumed from the earlier audit's more alarming framing.
