#!/usr/bin/env sh
# Updates Huntboard to the newest version. Your data (workspace folder) is kept; a backup is made first.
# Everything runs inside main(), read in one go: the update may replace this file while it runs.
main() {
  cd "$(dirname "$0")" || exit 1
  node tools/hunt.js update "$@"
}
main "$@"; exit
