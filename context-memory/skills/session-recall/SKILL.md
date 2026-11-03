---
name: session-recall
description: Search, read and extract information from other Claude Code conversations, including sessions that are open right now in other terminals. Use when the user refers to an earlier or parallel chat ("w tamtej rozmowie", "w drugim oknie", "co ustaliliśmy wczoraj", "find the session where we...", "what did I do in the other project"), asks what other sessions are working on, wants to copy a decision, command or file list from another session, or needs context that this session does not have. Reads ~/.claude/projects/*/*.jsonl transcripts and ~/.claude/sessions for live sessions. Standard-library Python, read-only, local.
---

# Session recall

Claude Code writes every conversation to `~/.claude/projects/<project>/<session-id>.jsonl` and
registers running sessions in `~/.claude/sessions/*.json`. The script `scripts/recall.py` (next to
this file) turns those files into readable text. Run it with `python3 <this skill dir>/scripts/recall.py ...`.

## Workflow

1. **Find out what exists.**
   - `recall.py open` - sessions running right now, with working directory, status and first prompt.
     Use this when the user talks about "the other window / the other chat".
   - `recall.py list [--project PATH] [--since 7d] [--limit 20]` - recent sessions, newest first.
     `●` marks sessions that are open now. Without `--project` all projects are listed.
2. **Locate the information.**
   - `recall.py search "words" [--since 2w] [--project .] [--role user] [--tools] [--exclude-current]`
     Case-insensitive substring search; `--regex` for patterns; `--tools` also searches tool calls and
     results (file paths, commands, outputs). Results show a snippet per hit and the session prefix.
3. **Read only what you need.** Transcripts are long; never cat the JSONL directly.
   - `recall.py extract <id-prefix>` - every user prompt, files edited, files read, commands run, last
     assistant message. Start here when the question is "what was done / decided there".
   - `recall.py show <id-prefix> --last 10` - the last turns as readable text.
   - `recall.py show <id-prefix> --tools --max-chars 60000` - more detail, including tool calls.
   - Add `--json` to any command when you need to post-process the output.
4. **Answer with provenance.** Quote the session prefix and date you took the information from, so the
   user can verify it. If several sessions match, list them briefly and ask which one, unless one is
   clearly the right one.

## Rules

- Everything is read-only. Never edit or delete files under `~/.claude/projects` or `~/.claude/sessions`.
- Prefer `extract` and `show --last N` over full dumps; pull more only when the answer is not there.
- Transcripts may contain secrets that other sessions printed. Do not copy tokens, passwords or keys
  into this conversation; describe where they are instead.
- Claude Code deletes transcripts older than `cleanupPeriodDays` (default 30). If an old session is
  missing, tell the user and point them to that setting (see the plugin README).
- Other agents' transcripts (Codex, Cursor) are out of scope; say so if asked.

## Examples

- "Co ustaliliśmy w tamtej rozmowie o fakturach?" ->
  `recall.py search faktur --since 1m` then `recall.py extract <id>`.
- "Which of my open sessions is editing the CRM repo?" -> `recall.py open`, then
  `recall.py extract <id>` to list the changed files.
- "Przenieś tu komendy, których użyliśmy w drugim oknie" -> `recall.py extract <id> --json` and read
  the `commands` array.
