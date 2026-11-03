#!/usr/bin/env python3
"""recall.py - search, list and extract information from Claude Code conversations.

Reads the JSONL transcripts Claude Code keeps in ~/.claude/projects/<project>/<session>.jsonl
and the live-session registry in ~/.claude/sessions/*.json. Standard library only.

Subcommands:
  open                      currently open (running) sessions
  list     [filters]        sessions, newest first
  search   QUERY [filters]  full-text / regex search across sessions
  show     SESSION          readable transcript of one session
  extract  SESSION          prompts, files touched, commands run, last answer
Run with -h for options. Add --json for machine-readable output.
"""
import argparse
import datetime as dt
import glob
import json
import os
import re
import sys

CLAUDE_DIR = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")
PROJECTS_DIR = os.path.join(CLAUDE_DIR, "projects")
SESSIONS_DIR = os.path.join(CLAUDE_DIR, "sessions")

# --------------------------------------------------------------------------- helpers

def encode_project(path):
    """Claude Code names the project folder by replacing every non-alphanumeric char with '-'."""
    return re.sub(r"[^A-Za-z0-9]", "-", os.path.abspath(path))


def parse_since(value):
    if not value:
        return None
    m = re.fullmatch(r"(\d+)([hdwm])", value.strip())
    now = dt.datetime.now(dt.timezone.utc)
    if m:
        n, unit = int(m.group(1)), m.group(2)
        delta = {"h": dt.timedelta(hours=n), "d": dt.timedelta(days=n),
                 "w": dt.timedelta(weeks=n), "m": dt.timedelta(days=30 * n)}[unit]
        return now - delta
    try:
        d = dt.datetime.fromisoformat(value)
        if d.tzinfo is None:
            d = d.replace(tzinfo=dt.timezone.utc)
        return d
    except ValueError:
        sys.exit(f"Bad --since value: {value!r} (use 7d, 12h, 2w or YYYY-MM-DD)")


def parse_ts(s):
    if not s:
        return None
    try:
        return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def fmt_ts(d):
    if not d:
        return "----------------"
    return d.astimezone().strftime("%Y-%m-%d %H:%M")


def short(sid):
    return (sid or "")[:8]


def truncate(text, n):
    text = " ".join(text.split())
    return text if len(text) <= n else text[: n - 1] + "…"


def iter_records(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue
    except OSError:
        return


def message_parts(rec):
    """Yield (kind, text) for a user/assistant record.
    kind: 'text', 'tool_use', 'tool_result'."""
    msg = rec.get("message") or {}
    content = msg.get("content")
    if isinstance(content, str):
        if content.strip():
            yield "text", content
        return
    if not isinstance(content, list):
        return
    for block in content:
        if not isinstance(block, dict):
            continue
        t = block.get("type")
        if t == "text" and block.get("text", "").strip():
            yield "text", block["text"]
        elif t == "tool_use":
            yield "tool_use", block
        elif t == "tool_result":
            c = block.get("content")
            if isinstance(c, list):
                c = " ".join(x.get("text", "") for x in c if isinstance(x, dict))
            if c:
                yield "tool_result", str(c)


def tool_summary(block):
    name = block.get("name", "?")
    inp = block.get("input") or {}
    for key in ("file_path", "command", "pattern", "query", "url", "path", "prompt", "description"):
        if key in inp and isinstance(inp[key], str):
            return f"{name}: {truncate(inp[key], 160)}"
    return name


def is_system_prompt(text):
    """Filter out harness-injected pseudo-user turns."""
    t = text.lstrip()
    return t.startswith("<") and (t.startswith("<system-reminder>") or t.startswith("<local-command")
                                  or t.startswith("<command-name>") or t.startswith("<task-notification")
                                  or t.startswith("<wake") or t.startswith("<webhook"))


# --------------------------------------------------------------------------- session model

class Session:
    def __init__(self, path):
        self.path = path
        self.session_id = os.path.splitext(os.path.basename(path))[0]
        self.project_dir = os.path.basename(os.path.dirname(path))
        self.cwd = None
        self.branch = None
        self.first_ts = None
        self.last_ts = None
        self.first_prompt = ""
        self.user_count = 0
        self.assistant_count = 0
        self.turns = []  # list of dict(role, ts, text, tools)
        self.files = {}
        self.commands = []
        self.mtime = os.path.getmtime(path)

    def load(self, full=False):
        for rec in iter_records(self.path):
            rtype = rec.get("type")
            if rtype not in ("user", "assistant"):
                continue
            if rec.get("isSidechain") and not full:
                continue
            ts = parse_ts(rec.get("timestamp"))
            if self.cwd is None and rec.get("cwd"):
                self.cwd = rec["cwd"]
            if rec.get("gitBranch") and rec["gitBranch"] != "HEAD":
                self.branch = rec["gitBranch"]
            if ts:
                self.first_ts = self.first_ts or ts
                self.last_ts = ts
            texts, tools = [], []
            for kind, payload in message_parts(rec):
                if kind == "text":
                    if rtype == "user" and is_system_prompt(payload):
                        continue
                    texts.append(payload)
                elif kind == "tool_use":
                    tools.append(tool_summary(payload))
                    inp = payload.get("input") or {}
                    name = payload.get("name", "")
                    fp = inp.get("file_path") or inp.get("notebook_path")
                    if fp:
                        self.files.setdefault(fp, set()).add(name)
                    if name == "Bash" and inp.get("command"):
                        self.commands.append(inp["command"])
                elif kind == "tool_result" and full:
                    tools.append("result: " + truncate(payload, 300))
            if not texts and not tools:
                continue
            if rtype == "user":
                if texts:
                    self.user_count += 1
                    if not self.first_prompt:
                        self.first_prompt = texts[0]
            else:
                self.assistant_count += 1
            self.turns.append({"role": rtype, "ts": ts, "text": "\n".join(texts), "tools": tools})
        return self

    def header(self):
        return {
            "session": self.session_id,
            "project": self.cwd or self.project_dir,
            "branch": self.branch,
            "started": self.first_ts.isoformat() if self.first_ts else None,
            "last": self.last_ts.isoformat() if self.last_ts else None,
            "user_messages": self.user_count,
            "assistant_messages": self.assistant_count,
            "first_prompt": truncate(self.first_prompt, 200),
            "path": self.path,
        }


def open_sessions():
    """Sessions that have a live Claude Code process (from ~/.claude/sessions/*.json)."""
    result = {}
    for p in glob.glob(os.path.join(SESSIONS_DIR, "*.json")):
        try:
            with open(p, encoding="utf-8") as fh:
                d = json.load(fh)
        except (OSError, json.JSONDecodeError):
            continue
        sid = d.get("sessionId")
        if sid:
            result[sid] = d
    return result


def transcript_paths(args):
    if getattr(args, "project", None):
        pattern = os.path.join(PROJECTS_DIR, encode_project(args.project), "*.jsonl")
    else:
        pattern = os.path.join(PROJECTS_DIR, "*", "*.jsonl")
    paths = [p for p in glob.glob(pattern) if os.path.isfile(p)]
    since = parse_since(getattr(args, "since", None))
    if since:
        paths = [p for p in paths if dt.datetime.fromtimestamp(os.path.getmtime(p), dt.timezone.utc) >= since]
    paths.sort(key=os.path.getmtime, reverse=True)
    return paths


def find_session(prefix):
    matches = [p for p in glob.glob(os.path.join(PROJECTS_DIR, "*", "*.jsonl"))
               if os.path.basename(p).startswith(prefix)]
    if not matches:
        sys.exit(f"No session starting with {prefix!r} under {PROJECTS_DIR}")
    if len(matches) > 1:
        sys.exit("Ambiguous prefix, candidates:\n  " + "\n  ".join(os.path.basename(m) for m in matches))
    return matches[0]


def current_session_id():
    sid = os.environ.get("CLAUDE_SESSION_ID")
    if sid:
        return sid
    # fall back: the open session whose cwd is our cwd and that was updated most recently
    cwd = os.getcwd()
    best = None
    for sid, d in open_sessions().items():
        if d.get("cwd") == cwd and (best is None or d.get("updatedAt", 0) > best[1]):
            best = (sid, d.get("updatedAt", 0))
    return best[0] if best else None


# --------------------------------------------------------------------------- commands

def cmd_open(args):
    live = open_sessions()
    rows = []
    for sid, d in sorted(live.items(), key=lambda kv: kv[1].get("updatedAt", 0), reverse=True):
        enc = encode_project(d.get("cwd", "")) if d.get("cwd") else None
        path = os.path.join(PROJECTS_DIR, enc, f"{sid}.jsonl") if enc else None
        s = Session(path).load() if path and os.path.exists(path) else None
        rows.append({
            "session": sid,
            "cwd": d.get("cwd"),
            "status": d.get("status"),
            "name": d.get("name"),
            "started": dt.datetime.fromtimestamp(d.get("startedAt", 0) / 1000).isoformat() if d.get("startedAt") else None,
            "first_prompt": truncate(s.first_prompt, 200) if s else "",
            "user_messages": s.user_count if s else 0,
            "transcript": path if s else None,
        })
    if args.json:
        print(json.dumps(rows, indent=2, ensure_ascii=False))
        return
    me = current_session_id()
    if not rows:
        print("No open Claude Code sessions found in", SESSIONS_DIR)
        return
    print(f"Open sessions ({len(rows)}):")
    for r in rows:
        tag = "  <- this session" if r["session"] == me else ""
        print(f"● {short(r['session'])}  {r['status'] or '?':<6} {r['cwd'] or '?'}{tag}")
        if r["first_prompt"]:
            print(f"    {r['user_messages']:>3} prompts | {r['first_prompt']}")


def cmd_list(args):
    live = open_sessions()
    me = current_session_id()
    rows = []
    for p in transcript_paths(args)[: args.limit]:
        s = Session(p).load()
        if s.user_count == 0 and not args.all_types:
            continue
        rows.append(s)
    if args.json:
        print(json.dumps([dict(s.header(), open=s.session_id in live) for s in rows], indent=2, ensure_ascii=False))
        return
    if not rows:
        print("No sessions found.")
        return
    for s in rows:
        mark = "●" if s.session_id in live else " "
        tag = "  <- this session" if s.session_id == me else ""
        print(f"{mark} {short(s.session_id)}  {fmt_ts(s.last_ts)}  {s.user_count:>3}u/{s.assistant_count:<3}a  {s.cwd or s.project_dir}{tag}")
        print(f"      {truncate(s.first_prompt, 140)}")


def cmd_search(args):
    query = " ".join(args.query)
    flags = re.IGNORECASE if not args.case_sensitive else 0
    rx = re.compile(query if args.regex else re.escape(query), flags)
    me = current_session_id() if args.exclude_current else None
    live = open_sessions()
    results = []
    total_hits = 0
    for p in transcript_paths(args):
        s = Session(p)
        if me and s.session_id == me:
            continue
        s.load(full=args.tools)
        hits = []
        for t in s.turns:
            if args.role != "any" and t["role"] != args.role:
                continue
            hay = t["text"] + ("\n" + "\n".join(t["tools"]) if args.tools else "")
            last_end = -1
            for m in rx.finditer(hay):
                if m.start() < last_end:
                    continue  # already covered by the previous snippet
                a = max(0, m.start() - args.context)
                b = min(len(hay), m.end() + args.context)
                last_end = b
                hits.append({"role": t["role"], "ts": t["ts"].isoformat() if t["ts"] else None,
                             "snippet": truncate(hay[a:b], 2 * args.context + len(m.group(0)))})
                if len(hits) >= args.per_session:
                    break
            if len(hits) >= args.per_session:
                break
        if hits:
            total_hits += len(hits)
            results.append((s, hits))
            if len(results) >= args.limit:
                break
    if args.json:
        print(json.dumps([dict(s.header(), open=s.session_id in live, hits=h) for s, h in results],
                         indent=2, ensure_ascii=False))
        return
    if not results:
        print(f"No matches for {query!r}.")
        return
    print(f"{total_hits} hit(s) in {len(results)} session(s) for {query!r}\n")
    for s, hits in results:
        mark = "●" if s.session_id in live else " "
        print(f"{mark} {short(s.session_id)}  {fmt_ts(s.last_ts)}  {s.cwd or s.project_dir}")
        print(f"      first prompt: {truncate(s.first_prompt, 120)}")
        for h in hits:
            who = "U" if h["role"] == "user" else "A"
            print(f"      [{who}] {h['snippet']}")
        print(f"      -> show: recall.py show {short(s.session_id)}")
        print()


def cmd_show(args):
    path = find_session(args.session)
    s = Session(path).load(full=args.tools)
    turns = s.turns[-args.last:] if args.last else s.turns
    if args.json:
        out = dict(s.header(), turns=[dict(t, ts=t["ts"].isoformat() if t["ts"] else None) for t in turns])
        print(json.dumps(out, indent=2, ensure_ascii=False))
        return
    h = s.header()
    print(f"# Session {s.session_id}")
    print(f"project: {h['project']}  branch: {h['branch'] or '-'}")
    print(f"from {fmt_ts(s.first_ts)} to {fmt_ts(s.last_ts)}  ({s.user_count} user / {s.assistant_count} assistant messages)\n")
    budget = args.max_chars
    for t in turns:
        who = "USER" if t["role"] == "user" else "ASSISTANT"
        block = f"## {who} {fmt_ts(t['ts'])}\n"
        if t["text"]:
            block += t["text"].strip() + "\n"
        if args.tools and t["tools"]:
            block += "".join(f"  · {x}\n" for x in t["tools"])
        if budget is not None:
            if budget <= 0:
                print(f"... output truncated at --max-chars (use --max-chars 0 for everything)")
                break
            if len(block) > budget:
                block = block[:budget] + "\n... [truncated]\n"
            budget -= len(block)
        print(block)


def cmd_extract(args):
    path = find_session(args.session)
    s = Session(path).load()
    prompts = [t for t in s.turns if t["role"] == "user" and t["text"]]
    answers = [t for t in s.turns if t["role"] == "assistant" and t["text"]]
    files = sorted(s.files.items())
    edited = [f for f, ops in files if ops & {"Edit", "Write", "MultiEdit", "NotebookEdit"}]
    read_only = [f for f, ops in files if not (ops & {"Edit", "Write", "MultiEdit", "NotebookEdit"})]
    data = dict(s.header(),
                prompts=[{"ts": t["ts"].isoformat() if t["ts"] else None, "text": t["text"]} for t in prompts],
                files_edited=edited, files_read=read_only, commands=s.commands,
                last_answer=answers[-1]["text"] if answers else "")
    if args.json:
        print(json.dumps(data, indent=2, ensure_ascii=False))
        return
    print(f"# Extract of session {s.session_id}")
    print(f"project: {data['project']}  branch: {data['branch'] or '-'}  {fmt_ts(s.first_ts)} -> {fmt_ts(s.last_ts)}\n")
    print(f"## User prompts ({len(prompts)})")
    for i, t in enumerate(prompts, 1):
        print(f"{i:>3}. [{fmt_ts(t['ts'])}] {truncate(t['text'], args.prompt_chars)}")
    print(f"\n## Files edited ({len(edited)})")
    for f in edited:
        print(f"  {f}")
    print(f"\n## Files read only ({len(read_only)})")
    for f in read_only[: args.max_items]:
        print(f"  {f}")
    if len(read_only) > args.max_items:
        print(f"  ... {len(read_only) - args.max_items} more")
    print(f"\n## Commands run ({len(s.commands)})")
    for c in s.commands[-args.max_items:]:
        print(f"  $ {truncate(c, 200)}")
    print("\n## Last assistant message")
    print(truncate(data["last_answer"], args.answer_chars) if data["last_answer"] else "(none)")


# --------------------------------------------------------------------------- CLI

def add_filters(p):
    p.add_argument("--project", metavar="PATH", help="only sessions whose working directory is PATH (default: all projects)")
    p.add_argument("--since", metavar="WHEN", help="only sessions modified since: 7d, 12h, 2w, 1m or YYYY-MM-DD")
    p.add_argument("--json", action="store_true", help="machine-readable output")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="recall.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("open", help="currently open Claude Code sessions")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_open)

    p = sub.add_parser("list", help="list sessions, newest first")
    add_filters(p)
    p.add_argument("--limit", type=int, default=20)
    p.add_argument("--all-types", action="store_true", help="include sessions without any user prompt")
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("search", help="search text across sessions")
    p.add_argument("query", nargs="+")
    add_filters(p)
    p.add_argument("--regex", action="store_true", help="treat QUERY as a regular expression")
    p.add_argument("--case-sensitive", action="store_true")
    p.add_argument("--role", choices=["user", "assistant", "any"], default="any")
    p.add_argument("--tools", action="store_true", help="also search tool calls and tool results")
    p.add_argument("--context", type=int, default=120, help="characters of context around each hit")
    p.add_argument("--per-session", type=int, default=3, help="max hits shown per session")
    p.add_argument("--limit", type=int, default=15, help="max sessions shown")
    p.add_argument("--exclude-current", action="store_true", help="skip the session this command runs in")
    p.set_defaults(func=cmd_search)

    p = sub.add_parser("show", help="print one session as readable text")
    p.add_argument("session", help="session id or unique prefix")
    p.add_argument("--tools", action="store_true", help="include tool calls and results")
    p.add_argument("--last", type=int, default=0, help="only the last N turns")
    p.add_argument("--max-chars", type=int, default=30000, help="truncate output (0 = unlimited)")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_show)

    p = sub.add_parser("extract", help="structured summary input: prompts, files, commands, last answer")
    p.add_argument("session", help="session id or unique prefix")
    p.add_argument("--prompt-chars", type=int, default=300)
    p.add_argument("--answer-chars", type=int, default=3000)
    p.add_argument("--max-items", type=int, default=40)
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_extract)

    args = ap.parse_args(argv)
    if args.cmd == "show" and args.max_chars == 0:
        args.max_chars = None
    args.func(args)


if __name__ == "__main__":
    main()
