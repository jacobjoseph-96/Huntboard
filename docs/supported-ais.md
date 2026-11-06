# Supported AI tools

Huntboard runs an AI command-line tool that is installed on your computer. The app starts it in the background for
each task, gives it the task in a file (`workspace/runs/<id>/prompt.md`), shows its progress, and lets it ask you
questions through dialogs (`node tools/hunt.js ask`).

| Tool | Background run | What the AI may do without asking | Notes |
|---|---|---|---|
| **Claude Code** (`claude`) | `claude -p … --output-format stream-json` | the `hunt` tool (Bash/PowerShell), the browser tools, web search, reading files, editing files in the project and workspace | Verified. Sign in once with `claude`. |
| **Antigravity CLI** (`agy`) | `agy -p … --output-format stream-json` | file edits (`--mode accept-edits`) and `command(node tools/hunt.js *)` | Verified for simple tasks. Headless mode cannot ask for permission; some steps are still refused. If a task stops with "was not allowed to do …", turn on **Settings → AI tool → Let the AI work without asking** (`--dangerously-skip-permissions`). Only do this if you are fine with the AI running any command in the Huntboard folder. |
| Gemini CLI (`gemini`) | `gemini -p … --output-format stream-json` | `run_shell_command(node tools/hunt.js)`, edits | Experimental. |
| Codex CLI (`codex`) | `codex exec --json --full-auto …` | sandboxed workspace writes | Experimental. |
| OpenCode (`opencode`) | `opencode run --format json …` | as configured in `opencode.json` | Experimental. Use it for any provider or a local model (Ollama, LM Studio). |
| GitHub Copilot CLI (`copilot`) | `copilot -p …` | `shell(node)` | Experimental; plain-text output. |
| Cursor CLI (`cursor-agent`) | `cursor-agent -p --output-format stream-json …` | | Experimental. |

## One source of instructions

`agent/rules.md` and `agent/skills/` are the only files to edit. `npm run sync` (also run by `npm install` and on
every start) writes each tool's native files:

| Tool | Instructions | Skills / commands | Browser (MCP) |
|---|---|---|---|
| Claude Code | `CLAUDE.md` (imports `AGENTS.md`) | `.claude/skills/` | `.mcp.json` |
| Antigravity | `GEMINI.md` | `.agents/skills/`, `.agents/workflows/` | `.agents/plugins/job-browser/mcp_config.json` |
| Gemini CLI | `GEMINI.md` | `.gemini/skills/`, `.gemini/commands/` | `.gemini/settings.json` |
| Codex | `AGENTS.md` | `.agents/skills/` | `.codex/config.toml` |
| OpenCode | `AGENTS.md` | `.opencode/skills/`, `.opencode/command/` | `opencode.json` |
| Copilot | `AGENTS.md` | `.github/skills/`, `.github/prompts/` | `.vscode/mcp.json` |
| Cursor | `AGENTS.md` | `.cursor/skills/`, `.cursor/commands/` | `.cursor/mcp.json` |

Only `AGENTS.md`, `CLAUDE.md` and `GEMINI.md` are committed. The rest contains machine-specific paths and is
gitignored. CI checks that the committed files match `agent/` (`npm run sync:check`).

Paths marked experimental follow each tool's documentation at the time of writing; please open an issue if your
version reads them from somewhere else.
