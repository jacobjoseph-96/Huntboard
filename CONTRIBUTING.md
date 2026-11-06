# Contributing to Huntboard

Thanks for helping! Huntboard is a plain Node.js project with no build step.

## Set up

```sh
npm install        # also runs `npm run sync`
npm test
npm run serve      # app on http://127.0.0.1:4317 (uses ./workspace)
```

Use a throwaway data folder while developing: `HUNTBOARD_WORKSPACE=/tmp/hb npm run serve`.

## Where things are

| Folder | What |
|---|---|
| `agent/rules.md`, `agent/skills/*/SKILL.md` | What the AI does. **Edit these, never the generated copies** (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.claude/`, `.agents/`, `.gemini/`…). Then run `npm run sync` and commit `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`. |
| `agent/platforms.json`, `lib/ai/adapters.js` | Supported AI tools: where they read instructions and how the app runs them in the background. |
| `lib/` | Tickets (`store.js`), profile, documents, inbox, the AI runner. All data writes go through these modules. |
| `app/` | The local app: `server.js` (API) and `public/` (pages). |
| `tools/hunt.js` | The command-line tool the AI uses to read and change data. |
| `boards/` | Job board registry and browser playbooks. See docs/adding-a-board.md. |

## Adding an AI tool

1. Add an entry to `agent/platforms.json` (binary name, instruction/skill/MCP paths, install hint).
2. Add an adapter to `lib/ai/adapters.js`: the arguments for a background run (the task always arrives as
   "read this prompt file"; never put user text on the command line) and a parser for its output stream.
3. Add a parser test in `test/lib.test.js` with a recorded sample of the tool's output.
4. Mark it `"verified": true` only after a real run on your machine.

## Adding a job board

Add an entry to `boards/registry.json`, plus a collector (API boards, with a recorded-answer test) or a playbook
(browser boards). New boards start as `"verified": false`. Run `node tools/hunt.js boards validate`. Details:
[docs/adding-a-board.md](docs/adding-a-board.md).

## Rules

- **No real personal data** in code, fixtures, screenshots or issues. Use the fictional profile in `examples/alex-doe/`.
- Skills must keep the safety rules in `agent/rules.md`: no invented facts, no passwords, no getting around captchas,
  applying only as far as the user allowed.
- Keep the always-loaded `agent/rules.md` short; put details into skills, which are loaded only when needed.
- Every user-facing text is plain, friendly language for people who are not technical.

## Pull requests

- `npm test` passes (CI runs it on Windows and Ubuntu).
- `npm run sync:check` passes.
- One topic per pull request, with a short description of what changes for the user.
