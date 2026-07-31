---
title: Pipeline and Agents
tags:
  - project/reference
aliases:
  - Agents
  - Pipeline
---

# Pipeline and Agents

Part of [[Premier Edit]].

## MVP pipeline

```mermaid
graph LR
    A[ingest] --> B[transcription]
    B --> C[content selection]
    C --> D[rough cut]
    D --> E[audio sync]
    E --> F[captions]
    F --> G[assembly]
    G --> H[QC]
    H --> I[export timeline - FCP7 XML]
    I --> J[manual import to Premiere]
    J --> K[manual polish: color, mix, finish]
```

Color and final finish are explicitly outside the automation boundary — see [[Premier Edit#Automation boundary]].

Steps I/J (export timeline → manual import) are the **Stage 1** path. The Stage 2 UXP panel replaces both with a single step — build the approved cut directly into a live Premiere sequence — and is now the primary route; Stage 1 stays as the fallback (it's still the only way to get a true audio crossfade, since UXP has no scripted audio-transition API).

## Planned agents

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
| `style-memory-agent` | — | Learns and stores recurring editing preferences over time |
| `broll-agent` | — | Detects missing B-roll/coverage and suggests a replacement — **partially landed**: `LlmContentSelector`'s `videoFrom` override picks a different already-selected clip's footage over a moment's audio (see [[Tech Stack]]). Not yet a standalone agent, and doesn't cover "no real footage exists for this beat at all" — that gap is still open. |

## Premiere integration stages

- [x] **Stage 1:** FCP7 XML export, manual import into Premiere
- [x] **Stage 2:** UXP panel (`premiere-panel/`) — builds the approved cut directly into a live Premiere sequence, no export/import round-trip. Verified working in real Premiere, including B-roll (one file's picture over another's audio at the same timeline position).
- [ ] **Stage 3 (not committed):** read-back layer so the system also sees manual changes
