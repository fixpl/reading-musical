#!/bin/sh
# Snapshot the working tree (tracked + untracked, honoring .gitignore) as a git tree object,
# so a reviewer can diff only what fixer agents changed even when the tree holds unrelated edits.
#   sh scripts/agent-snapshot.sh save            -> stores the tree id in .git/agent-snapshot
#   sh scripts/agent-snapshot.sh diff [paths...] -> diff from the snapshot to the working tree
#   sh scripts/agent-snapshot.sh stat            -> changed file list since the snapshot
# Nothing touches the real index, HEAD, or the working tree.
set -eu
ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
STATE="$(git rev-parse --git-dir)/agent-snapshot"

current_tree() {
  idx=$(mktemp)
  cp "$(git rev-parse --git-dir)/index" "$idx"
  GIT_INDEX_FILE="$idx" git add -A >/dev/null 2>&1
  GIT_INDEX_FILE="$idx" git write-tree
  rm -f "$idx"
}

cmd=${1:-}
[ $# -gt 0 ] && shift
case "$cmd" in
  save)
    current_tree > "$STATE"
    printf 'snapshot %s\n' "$(cat "$STATE")"
    ;;
  diff|stat)
    [ -f "$STATE" ] || { echo "no snapshot — run: sh scripts/agent-snapshot.sh save" >&2; exit 1; }
    now=$(current_tree)
    if [ "$cmd" = stat ]; then
      git diff --stat "$(cat "$STATE")" "$now" -- "$@"
    else
      git diff "$(cat "$STATE")" "$now" -- "$@"
    fi
    ;;
  *)
    echo "usage: sh scripts/agent-snapshot.sh save | diff [paths...] | stat [paths...]" >&2
    exit 1
    ;;
esac
