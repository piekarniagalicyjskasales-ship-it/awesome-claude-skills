#!/usr/bin/env bash
# Kopiuje projekt do repo (pamięć trwała), commituje i pushuje. Użycie: sync.sh "wiadomość"
set -e
SRC=/home/user/kanalik
REPO=/home/user/awesome-claude-skills
DST=$REPO/projekty/kanalik
BR=claude/happy-noether-a0xnz3
mkdir -p "$DST"
rm -rf "$DST" && mkdir -p "$DST" && tar -C "$SRC" --exclude=node_modules --exclude=data --exclude="*.db*" -cf - . | tar -C "$DST" -xf -
cd "$REPO"
git add projekty/kanalik
if git diff --cached --quiet; then echo "brak zmian"; exit 0; fi
git commit -q -m "$1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018iaFRyeBzvqYS71TyHyCre"
for i in 0 2 4 8 16; do sleep $i; git push -q -u origin "$BR" && { echo pushed; exit 0; }; done
exit 1
