---
description: Write a handoff note for this session so the next session can continue
argument-hint: [one-line status note]
---
Use the context-memory skill: run `memory.py handoff --note "$ARGUMENTS"` (omit --note if empty).
Then read the printed handoff and, if anything important from this conversation is missing (a decision,
an open question, a blocker), add it with `memory.py add ... --tag decision|todo`. Tell the user the
handoff is saved and will be restored automatically at the next session start.
