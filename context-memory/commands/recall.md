---
description: Search past and open Claude Code conversations for the given words
argument-hint: <words to search> [--since 7d] [--project PATH]
---
Use the session-recall skill. Run `recall.py search $ARGUMENTS` (add `--exclude-current`), then for the
most relevant session run `recall.py extract <id>` and answer the user's underlying question with the
session prefix and date as provenance. If nothing matches, run `recall.py list --since 2w` and say what
sessions exist instead.
