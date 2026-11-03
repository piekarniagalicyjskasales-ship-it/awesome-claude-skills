---
name: context-memory
description: Durable memory across Claude Code sessions - remember decisions, user preferences, facts and todos, write a handoff before context is lost, and resume from it. Use when the user says "zapamiętaj", "remember this", "nie zapominaj", "na przyszłość", asks what was decided earlier, starts a session with "kontynuujmy" / "where were we", asks for a handoff or summary before closing, or when the conversation is long and compaction is near. Stores Markdown notes in ~/.claude/memory and ~/.claude/projects/<project>/memory; a SessionStart hook injects them automatically.
---

# Context memory

Two layers, both plain Markdown you can show the user at any time:

| Layer | File | Scope |
|---|---|---|
| Global notes | `~/.claude/memory/global.md` | every project (preferences, how the user likes to work) |
| Project notes | `~/.claude/projects/<project>/memory/notes.md` | this working directory (decisions, facts, todos) |
| Handoffs | `~/.claude/projects/<project>/memory/handoff.md` | last 5 session summaries, newest first |

The script is `scripts/memory.py` next to this file: `python3 <this skill dir>/scripts/memory.py ...`.
When the plugin is installed, hooks run it for you: **SessionStart** injects notes + last handoff +
the list of other open sessions, **PreCompact** and **SessionEnd** write a handoff automatically.

## When to write

- The user states a preference or correction ("zawsze po polsku", "używaj pnpm", "nie dotykaj prod") ->
  `memory.py add "..." --tag preference --global` (or without `--global` if it is project-specific).
- A decision is made that later sessions must respect (architecture, naming, which library) ->
  `memory.py add "..." --tag decision`.
- A fact that was expensive to discover (port numbers, where the config lives, which branch is deployed) ->
  `memory.py add "..." --tag fact`.
- Work left for later -> `memory.py add "..." --tag todo`; when finished -> `memory.py done "pattern"`.
- Before a long session ends or when you are asked for a summary -> `memory.py handoff --note "one-line status"`.
  The handoff is built from the real transcript (prompts, files changed, commands, last answer), so it
  costs you one command, not a long summary written by hand.

Keep notes short (one line), concrete and in the user's language. Do not store secrets.

## When to read

- At session start the hook already printed the memory. If it did not (plugin not installed), run
  `memory.py resume` first thing when the user says "kontynuujmy", "where were we", or refers to past work.
- `memory.py list` shows global + project notes; `memory.py search <words>` searches notes and handoffs
  in every project.
- For details that the handoff only summarizes, switch to the **session-recall** skill and read the
  original transcript (`recall.py extract <session-prefix>`).

## Rules

- Ask before storing anything personal that the user did not clearly intend to be remembered.
- Never store passwords, tokens or keys; store where they live instead.
- One note per line, prefixed `- [tag] YYYY-MM-DD`; the script does this for you. If the user edits
  the files by hand, that is fine - they are the source of truth.
- The project folder name is the working directory with non-alphanumeric characters replaced by `-`,
  the same folder where Claude Code keeps its built-in auto-memory `MEMORY.md`. Do not rewrite MEMORY.md
  from this skill; the two coexist.
