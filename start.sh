#!/usr/bin/env sh
# Starts Huntboard and opens it in its own window. Close this terminal (or press Ctrl+C) to stop it.
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "Huntboard is not installed yet. Run: sh install.sh"
  exit 1
fi
node tools/sync-agents.js --quiet
exec node app/server.js --open
