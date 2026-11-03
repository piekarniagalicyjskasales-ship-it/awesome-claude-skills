#!/usr/bin/env python3
"""memory.py - durable notes and session handoffs for Claude Code.

Storage (plain Markdown, safe to read and edit by hand):
  global notes    ~/.claude/memory/global.md
  project notes   ~/.claude/projects/<project>/memory/notes.md
  handoffs        ~/.claude/projects/<project>/memory/handoff.md   (latest first, last 5 kept)
<project> is the working directory with every non-alphanumeric character replaced by '-',
the same folder where Claude Code keeps the project's transcripts and its auto-memory MEMORY.md.

Subcommands:
  add TEXT [--tag decision|preference|todo|fact|context] [--global] [--project PATH]
  done PATTERN                 mark the matching todo as done
  list [--global] [--project]  show notes
  search QUERY                 search notes and handoffs everywhere
  handoff [--transcript FILE | --session ID] [--note TEXT]   write a handoff from a transcript
  resume                       print what a new session should know (notes + last handoff)
  hook session-start|pre-compact|session-end                  called by Claude Code hooks (JSON on stdin)
"""
import argparse
import datetime as dt
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "session-recall", "scripts"))
try:
    import recall  # shared transcript parser
except ImportError:  # skills copied separately: try sibling folder in ~/.claude/skills
    sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "session-recall", "scripts"))
    import recall

CLAUDE_DIR = recall.CLAUDE_DIR
GLOBAL_DIR = os.environ.get("CLAUDE_MEMORY_DIR") or os.path.join(CLAUDE_DIR, "memory")
GLOBAL_FILE = os.path.join(GLOBAL_DIR, "global.md")
TAGS = ("decision", "preference", "todo", "fact", "context")
MAX_HANDOFFS = 5


def today():
    return dt.date.today().isoformat()


def project_memory_dir(path=None):
    enc = recall.encode_project(path or os.getcwd())
    return os.path.join(recall.PROJECTS_DIR, enc, "memory")


def notes_file(args):
    if getattr(args, "global_", False):
        return GLOBAL_FILE
    return os.path.join(project_memory_dir(getattr(args, "project", None)), "notes.md")


def handoff_file(path=None):
    return os.path.join(project_memory_dir(path), "handoff.md")


def read(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return ""


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def ensure_header(path, title):
    if not read(path).strip():
        write(path, f"# {title}\n\nOne note per line: `- [tag] YYYY-MM-DD text`. Tags: {', '.join(TAGS)}.\n\n")


# --------------------------------------------------------------------------- notes

def cmd_add(args):
    path = notes_file(args)
    ensure_header(path, "Global memory" if args.global_ else f"Project memory: {args.project or os.getcwd()}")
    text = " ".join(args.text).strip()
    line = f"- [{args.tag}] {today()} {text}\n"
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(line)
    print(f"saved to {path}:\n{line.rstrip()}")


def cmd_done(args):
    changed = []
    for path in [GLOBAL_FILE] + glob.glob(os.path.join(recall.PROJECTS_DIR, "*", "memory", "notes.md")):
        lines = read(path).splitlines(keepends=True)
        out = []
        for ln in lines:
            if ln.startswith("- [todo]") and re.search(args.pattern, ln, re.IGNORECASE):
                ln = ln.replace("- [todo]", f"- [done {today()}]", 1)
                changed.append((path, ln.rstrip()))
            out.append(ln)
        if lines != out:
            write(path, "".join(out))
    if not changed:
        print("no open todo matched", repr(args.pattern))
    for path, ln in changed:
        print(f"{path}: {ln}")


def cmd_list(args):
    paths = []
    if args.global_ or not args.project_only:
        paths.append(("GLOBAL", GLOBAL_FILE))
    if not args.global_:
        paths.append(("PROJECT " + (args.project or os.getcwd()), notes_file(argparse.Namespace(global_=False, project=args.project))))
    any_out = False
    for label, path in paths:
        body = read(path).strip()
        if body:
            any_out = True
            print(f"## {label}  ({path})\n{body}\n")
    if not any_out:
        print("no notes yet - add one with: memory.py add \"text\" --tag decision")


def cmd_search(args):
    rx = re.compile(" ".join(args.query), re.IGNORECASE)
    files = [GLOBAL_FILE] + sorted(glob.glob(os.path.join(recall.PROJECTS_DIR, "*", "memory", "*.md")))
    n = 0
    for path in files:
        hits = [ln for ln in read(path).splitlines() if rx.search(ln)]
        if hits:
            print(f"## {path}")
            for ln in hits[: args.limit]:
                print("  " + recall.truncate(ln, 300))
            n += len(hits)
    if not n:
        print("no matches")


# --------------------------------------------------------------------------- handoff

def build_handoff(transcript_path, note=None, session_id=None):
    s = recall.Session(transcript_path).load()
    prompts = [t["text"] for t in s.turns if t["role"] == "user" and t["text"]]
    answers = [t["text"] for t in s.turns if t["role"] == "assistant" and t["text"]]
    edited = sorted(f for f, ops in s.files.items() if ops & {"Edit", "Write", "MultiEdit", "NotebookEdit"})
    todos = [ln.strip() for ln in read(os.path.join(project_memory_dir(s.cwd), "notes.md")).splitlines()
             if ln.startswith("- [todo]")]
    lines = [f"## Handoff {dt.datetime.now().strftime('%Y-%m-%d %H:%M')}  session {recall.short(s.session_id or session_id)}",
             f"project: {s.cwd or '?'}  branch: {s.branch or '-'}  "
             f"{recall.fmt_ts(s.first_ts)} -> {recall.fmt_ts(s.last_ts)}  ({len(prompts)} prompts)"]
    if note:
        lines += ["", f"**Note from Claude:** {note}"]
    lines += ["", "### What the user asked"]
    lines += [f"{i}. {recall.truncate(p, 240)}" for i, p in enumerate(prompts[-12:], 1)] or ["(nothing)"]
    lines += ["", "### Files changed"]
    lines += [f"- {f}" for f in edited[:40]] or ["(none)"]
    if s.commands:
        lines += ["", "### Last commands"]
        lines += [f"- `{recall.truncate(c, 160)}`" for c in s.commands[-8:]]
    if todos:
        lines += ["", "### Open todos (project memory)"] + todos
    lines += ["", "### Where it stopped (last assistant message)"]
    lines += [recall.truncate(answers[-1], 1500) if answers else "(no answer yet)", ""]
    return s, "\n".join(lines) + "\n"


def save_handoff(s, block):
    path = handoff_file(s.cwd)
    old = read(path)
    sections = [sec for sec in re.split(r"(?m)^(?=## Handoff )", old) if sec.strip() and sec.startswith("## Handoff")]
    # replace an earlier handoff of the same session instead of stacking duplicates
    sid = recall.short(s.session_id)
    sections = [sec for sec in sections if f"session {sid}" not in sec.splitlines()[0]]
    sections = [block] + sections
    header = f"# Session handoffs for {s.cwd or '?'}\n\nNewest first. Written automatically before compaction and at session end.\n\n"
    write(path, header + "\n".join(sections[:MAX_HANDOFFS]))
    return path


def resolve_transcript(args):
    if getattr(args, "transcript", None):
        return args.transcript
    sid = getattr(args, "session", None) or recall.current_session_id()
    if sid:
        return recall.find_session(sid)
    paths = recall.transcript_paths(argparse.Namespace(project=os.getcwd(), since=None))
    if not paths:
        sys.exit("no transcript found for this project; pass --transcript FILE or --session ID")
    return paths[0]


def cmd_handoff(args):
    path = resolve_transcript(args)
    s, block = build_handoff(path, note=" ".join(args.note) if args.note else None)
    out = save_handoff(s, block)
    print(block)
    print(f"-> saved to {out}")


def resume_text(cwd=None, max_chars=12000):
    parts = []
    g = read(GLOBAL_FILE).strip()
    if g:
        parts.append("### Global memory (all projects)\n" + g)
    p = read(os.path.join(project_memory_dir(cwd), "notes.md")).strip()
    if p:
        parts.append("### Project memory\n" + p)
    h = read(handoff_file(cwd))
    if h.strip():
        secs = [sec for sec in re.split(r"(?m)^(?=## Handoff )", h) if sec.startswith("## Handoff")]
        if secs:
            parts.append("### Last handoff\n" + secs[0].strip())
    text = "\n\n".join(parts)
    if len(text) > max_chars:
        text = text[:max_chars] + "\n... (truncated; run `memory.py resume` for everything)"
    return text


def cmd_resume(args):
    text = resume_text(args.project)
    print(text if text else "no memory for this project yet")


# --------------------------------------------------------------------------- hooks

def other_open_sessions(current_sid, cwd):
    rows = []
    for sid, d in recall.open_sessions().items():
        if sid == current_sid:
            continue
        enc = recall.encode_project(d.get("cwd", "")) if d.get("cwd") else None
        tp = os.path.join(recall.PROJECTS_DIR, enc, f"{sid}.jsonl") if enc else None
        first = ""
        if tp and os.path.exists(tp):
            first = recall.Session(tp).load().first_prompt
        rows.append(f"- {recall.short(sid)} ({d.get('status', '?')}) {d.get('cwd', '?')}: {recall.truncate(first, 120) or '(no prompt yet)'}")
    return rows


def cmd_hook(args):
    try:
        payload = json.load(sys.stdin) if not sys.stdin.isatty() else {}
    except json.JSONDecodeError:
        payload = {}
    cwd = payload.get("cwd") or os.getcwd()
    sid = payload.get("session_id")
    transcript = payload.get("transcript_path")

    if args.event == "session-start":
        text = resume_text(cwd)
        others = other_open_sessions(sid, cwd)
        chunks = []
        if text:
            chunks.append("## Memory restored by context-memory plugin\n" + text)
        if others:
            chunks.append("### Other open Claude Code sessions right now\n" + "\n".join(others)
                          + "\n(Use the session-recall skill to read any of them: `recall.py show <id>`.)")
        if chunks:
            out = {"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "\n\n".join(chunks)}}
            print(json.dumps(out, ensure_ascii=False))
        return

    if args.event in ("pre-compact", "session-end"):
        if not transcript or not os.path.exists(transcript):
            return
        try:
            s, block = build_handoff(transcript, note=f"auto handoff on {args.event}", session_id=sid)
            if s.user_count == 0:
                return
            save_handoff(s, block)
        except Exception as exc:  # never break the user's session because of a hook
            print(f"context-memory: handoff skipped: {exc}", file=sys.stderr)
        return


# --------------------------------------------------------------------------- CLI

def main(argv=None):
    ap = argparse.ArgumentParser(prog="memory.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("add", help="add a note")
    p.add_argument("text", nargs="+")
    p.add_argument("--tag", choices=TAGS, default="fact")
    p.add_argument("--global", dest="global_", action="store_true", help="store in global memory (all projects)")
    p.add_argument("--project", metavar="PATH", help="project directory (default: cwd)")
    p.set_defaults(func=cmd_add)

    p = sub.add_parser("done", help="mark a todo as done")
    p.add_argument("pattern")
    p.set_defaults(func=cmd_done)

    p = sub.add_parser("list", help="show notes")
    p.add_argument("--global", dest="global_", action="store_true")
    p.add_argument("--project-only", action="store_true")
    p.add_argument("--project", metavar="PATH")
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("search", help="search notes and handoffs")
    p.add_argument("query", nargs="+")
    p.add_argument("--limit", type=int, default=20)
    p.set_defaults(func=cmd_search)

    p = sub.add_parser("handoff", help="write a handoff note from a transcript")
    p.add_argument("--transcript", metavar="FILE")
    p.add_argument("--session", metavar="ID", help="session id or prefix (default: current session)")
    p.add_argument("--note", nargs="+", help="free-text note to put on top")
    p.set_defaults(func=cmd_handoff)

    p = sub.add_parser("resume", help="print memory + last handoff for a project")
    p.add_argument("--project", metavar="PATH")
    p.set_defaults(func=cmd_resume)

    p = sub.add_parser("hook", help="entry point for Claude Code hooks")
    p.add_argument("event", choices=["session-start", "pre-compact", "session-end"])
    p.set_defaults(func=cmd_hook)

    args = ap.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
