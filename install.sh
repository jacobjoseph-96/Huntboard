#!/usr/bin/env sh
# Huntboard one-time setup for macOS and Linux.
set -e
cd "$(dirname "$0")"

echo "== Huntboard: one-time setup =="

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or newer is needed: https://nodejs.org (or: brew install node / your package manager)"
  exit 1
fi
node -e "process.exit(parseInt(process.versions.node) >= 22 ? 0 : 1)" || { echo "Node.js is too old: version 22 or newer is needed."; exit 1; }

node -e "process.exit(require('./lib/browser').findChromium() ? 0 : 1)" 2>/dev/null || \
  echo "Note: no Chrome / Chromium / Edge found. Install one for PDFs, the app window and job boards."

npm install --no-audit --no-fund

found=""
for t in claude gemini agy codex opencode cursor-agent; do
  command -v "$t" >/dev/null 2>&1 && found="$found $t"
done
if [ -z "$found" ]; then
  echo
  echo "No AI tool found. Install one (it uses your own account), for example:"
  echo "  npm install -g @google/gemini-cli     # Gemini, free with a Google account"
  echo "  curl -fsSL https://claude.ai/install.sh | bash   # Claude Code"
  echo "  npm install -g @openai/codex          # Codex"
  echo "  npm install -g opencode-ai            # OpenCode: any provider, also local models"
else
  echo "AI tools found:$found"
fi

echo
echo "All done. Start Huntboard with: sh start.sh"
echo "The first time, sign in to your AI tool once by running it in this folder (e.g. 'gemini' or 'claude')."
