#!/usr/bin/env bash
# sync-to-global.sh — copy the skill from this repo into the user's global
# Claude Code skills directory so it becomes available as /pr-autopilot.
#
# Usage:
#   ./scripts/sync-to-global.sh           # sync (overwrites)
#   ./scripts/sync-to-global.sh --dry-run # show what would be copied
#   ./scripts/sync-to-global.sh --diff    # show diff between repo and installed

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILL_NAME="pr-autopilot"
TARGET_DIR="${HOME}/.claude/skills/${SKILL_NAME}"
SOURCE_FILE="${REPO_ROOT}/SKILL.md"

if [[ ! -f "$SOURCE_FILE" ]]; then
  echo "ABORT: $SOURCE_FILE not found" >&2
  exit 1
fi

case "${1:-}" in
  --dry-run)
    echo "Would copy:"
    echo "  $SOURCE_FILE"
    echo "  → $TARGET_DIR/SKILL.md"
    exit 0
    ;;
  --diff)
    if [[ ! -f "$TARGET_DIR/SKILL.md" ]]; then
      echo "No installed copy at $TARGET_DIR/SKILL.md"
      exit 0
    fi
    diff -u "$TARGET_DIR/SKILL.md" "$SOURCE_FILE" || true
    exit 0
    ;;
esac

mkdir -p "$TARGET_DIR"
cp "$SOURCE_FILE" "$TARGET_DIR/SKILL.md"

echo "✅ Synced ${SKILL_NAME} → $TARGET_DIR/SKILL.md"
echo "   Reload Claude Code (or run /reload-plugins) to pick up the change."
