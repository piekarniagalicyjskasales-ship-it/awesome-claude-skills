---
description: Save a note to persistent memory (decision, preference, fact or todo)
argument-hint: <note text> [--tag decision|preference|todo|fact] [--global]
---
Use the context-memory skill. Pick the right tag from the text if none was given (a rule about how to
work -> preference --global; a choice for this project -> decision; something to do later -> todo;
otherwise fact) and run `memory.py add "$ARGUMENTS" --tag <tag>`. Confirm in one line what was saved
and where.
