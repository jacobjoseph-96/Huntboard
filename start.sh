#!/usr/bin/env sh
# Starts Huntboard and opens it in its own window. Close this terminal (or press Ctrl+C) to stop it.
# Everything runs inside main(), which the shell reads in one go: an update may replace this file while it runs.
main() {
  cd "$(dirname "$0")" || exit 1
  if [ ! -d node_modules ]; then
    echo "Huntboard is not installed yet. Run: sh install.sh"
    exit 1
  fi
  node tools/sync-agents.js --quiet
  HUNTBOARD_SUPERVISED=1
  export HUNTBOARD_SUPERVISED
  open_flag="--open"
  while true; do
    node app/server.js $open_flag
    code=$?
    # 75 = restart after an update (the window is already open).
    [ "$code" -eq 75 ] || exit "$code"
    open_flag=""
    echo "Huntboard was updated. Starting it again..."
  done
}
main "$@"; exit
