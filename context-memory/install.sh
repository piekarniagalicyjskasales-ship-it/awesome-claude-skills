#!/usr/bin/env bash
# Installs the context-memory plugin for the current user and keeps transcripts for a year.
# Usage:  bash install.sh [--with-claude-mem] [--keep-days N]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
KEEP_DAYS=365
WITH_CLAUDE_MEM=0
for a in "$@"; do
  case "$a" in
    --with-claude-mem) WITH_CLAUDE_MEM=1 ;;
    --keep-days=*) KEEP_DAYS="${a#*=}" ;;
    --keep-days) shift_next=1 ;;
    *) if [ "${shift_next:-0}" = 1 ]; then KEEP_DAYS="$a"; shift_next=0; fi ;;
  esac
done

command -v claude >/dev/null || { echo "claude CLI not found in PATH"; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required (the skills are pure standard-library Python)"; exit 1; }

echo "1/3 Registering marketplace and installing plugin (user scope)"
if [ -f "$REPO_ROOT/.claude-plugin/marketplace.json" ]; then
  claude plugin marketplace add "$REPO_ROOT" >/dev/null 2>&1 || true
  MARKET="$(python3 -c "import json;print(json.load(open('$REPO_ROOT/.claude-plugin/marketplace.json'))['name'])")"
  claude plugin install "context-memory@$MARKET" --scope user
else
  echo "   no marketplace.json above this folder - copying skills to ~/.claude/skills instead"
  mkdir -p "$HOME/.claude/skills"
  cp -R "$HERE/skills/session-recall" "$HERE/skills/context-memory" "$HOME/.claude/skills/"
  echo "   hooks are not installed in this mode; add them from hooks/hooks.json to ~/.claude/settings.json"
fi

echo "2/3 Keeping transcripts for $KEEP_DAYS days (cleanupPeriodDays)"
python3 - "$KEEP_DAYS" <<'PY'
import json, os, sys
path = os.path.join(os.path.expanduser("~"), ".claude", "settings.json")
try:
    data = json.load(open(path, encoding="utf-8"))
except (OSError, json.JSONDecodeError):
    data = {}
data["cleanupPeriodDays"] = int(sys.argv[1])
os.makedirs(os.path.dirname(path), exist_ok=True)
json.dump(data, open(path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print("   ", path, "-> cleanupPeriodDays =", data["cleanupPeriodDays"])
PY

if [ "$WITH_CLAUDE_MEM" = 1 ]; then
  echo "3/3 Installing claude-mem (automatic AI-compressed memory, Apache-2.0)"
  claude plugin marketplace add thedotmack/claude-mem || true
  claude plugin install claude-mem@claude-mem --scope user || echo "   run inside Claude Code: /plugin install claude-mem"
else
  echo "3/3 Skipping claude-mem (pass --with-claude-mem to add it)"
fi
echo "Done. Start a new Claude Code session; try /sessions, /recall <words>, /remember <note>, /handoff, /resume."
