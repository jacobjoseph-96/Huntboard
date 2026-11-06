# How Huntboard works

```
 you ──▶ the app (browser window, app/public)  ──REST + live events──▶  app/server.js (127.0.0.1 only, token)
                                                                          │
                     ┌────────────────────────────────────────────────────┤
                     ▼                                                    ▼
             lib/store.js, profile, documents, inbox        lib/ai/runner.js ──▶ your AI tool, in the background
             (all data in workspace/)                            ▲                (Claude Code, Gemini, Codex, OpenCode…)
                     ▲                                           │ progress (JSON stream)    │
                     └──────────── node tools/hunt.js ◀──────────┴────────────────────────────┘
                                   (the only way the AI changes data; `hunt ask` = a dialog in the app)
```

## Data (`workspace/`, never committed)

| Path | What |
|---|---|
| `profile/profile.json` | contact, location, search targets, applying mode, form answers |
| `profile/cv.json` | the structured CV every document is rendered from |
| `profile/search_plan.json` | boards, search words, towns per search target |
| `profile/story_bank.md` | reusable interview stories |
| `documents/` | uploaded CV, degrees, certificates, references (+ extracted text) |
| `applications/JOB-NNNN-*/` | one folder per ticket: `ticket.json`, `posting.md`, `docs/`, `interview/` |
| `data/postings.json`, `data/ads/` | every job ad seen, for duplicates and "seen before" |
| `data/decisions.jsonl` | decisions the AI took for you in fully automatic mode |
| `runs/` | every AI run: prompt, raw output, steps |
| `browser-profile/` | the logins of the AI's browser window |

## Tickets

Status: **Found → To apply → Applied → Interview → Offer → Closed** (closed with a resolution: accepted, rejected,
declined, withdrawn, dismissed, expired). `furthest_status` never goes back, so a rejection after an interview still
counts as "got to interview". Every change is in the ticket's history. Notes you write are facts and wishes for the AI.

## A search

1. `plan-search` (AI) picks boards from `boards/registry.json` ranked by `lib/boards.js` (country, field, job type),
   writes search words in the local language, and the towns inside your radius.
2. `hunt search run` (code) reads the API boards (`lib/collectors.js`), drops what is clearly wrong (`lib/gate.js`),
   reads the ad texts (`lib/adtext.js`, checked by `lib/validate.js`) and counts every step (`lib/funnel.js`: in =
   kept + dropped + unread).
3. The AI searches the browser boards with `boards/playbooks/*.md` and adds results with `hunt ingest`.
4. The AI scores every candidate (0–100, reasons, red flags) and adds the good ones as tickets.

## Documents

The AI writes JSON only (`cv.json`, per-job changes, letter JSON); `lib/render.js` turns it into HTML/PDF with the
labels and date formats of `templates/locales.json`. `hunt factcheck` lists every number, level or acronym that is
not in your data.

## Applying modes

`off` (prepare only) · `assist` (fill in, you submit) · `auto` (submit after one OK per run) · `full_auto` (search and
apply on their own, decide for you, write every decision down, park what needs you). In every mode the AI never types
passwords or gets around robot checks.

## Instructions for every AI tool

`agent/rules.md` and `agent/skills/*/SKILL.md` are the single source. `tools/sync-agents.js` writes each tool's own
files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, skill folders, MCP configs, permission allowlists).
