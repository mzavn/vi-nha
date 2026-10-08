#!/usr/bin/env python3
"""Wire a project's agent instruction files to mk-specs (idempotent).

  agent-files.py <project-dir> [--uninstall]

- AGENTS.md (the cross-agent standard): owns one block between
  `<!-- mk-specs:start vX -->` and `<!-- mk-specs:end -->`. Missing file → created;
  block present → replaced only when it differs; absent → appended. Nothing outside
  the markers is touched.
- CLAUDE.md (Claude Code reads only this): gets an `@AGENTS.md` import line when it
  has none; missing file → created with just that line.
- GEMINI.md: only if it already exists, gets one line pointing at AGENTS.md.
- --uninstall removes the AGENTS.md block; the import lines are left (harmless).

Prints one line per file: created | added | updated | unchanged | removed.
"""
import os
import re
import sys

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)
START = re.compile(r"^<!-- mk-specs:start[^>]*-->\s*$", re.M)
END = re.compile(r"^<!-- mk-specs:end -->\s*$", re.M)
IMPORT = re.compile(r"^@(\./)?AGENTS\.md\s*$", re.M)
GEMINI_LINE = "Đọc và làm theo `AGENTS.md` (luật chung của repo, gồm Spec-Driven Development)."


def version():
    with open(os.path.join(SKILL, "SKILL.md"), encoding="utf-8") as fh:
        m = re.search(r'^\s*version:\s*"?([^"\n]+)"?', fh.read(), re.M)
    return m.group(1).strip() if m else "0"


def block():
    with open(os.path.join(SKILL, "assets", "agents-block.md"), encoding="utf-8") as fh:
        body = fh.read().strip("\n")
    return f"<!-- mk-specs:start v{version()} -->\n{body}\n<!-- mk-specs:end -->\n"


def read(path):
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def write(path, text):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def find_block(text):
    s = START.search(text)
    if not s:
        return None
    e = END.search(text, s.end())
    if not e:
        sys.exit(f"agent-files: {START.pattern} without end marker — fix the file by hand")
    end = e.end() + (1 if text[e.end():e.end() + 1] == "\n" else 0)
    return s.start(), end


def agents_md(proj, uninstall):
    path = os.path.join(proj, "AGENTS.md")
    text = read(path)
    if uninstall:
        span = text and find_block(text)
        if not span:
            return "unchanged"
        rest = (text[:span[0]] + text[span[1]:]).rstrip("\n")
        write(path, rest + "\n" if rest else "")
        return "removed"
    new = block()
    if text is None:
        write(path, "# AGENTS.md\n\n" + new)
        return "created"
    span = find_block(text)
    if span:
        if text[span[0]:span[1]] == new:
            return "unchanged"
        write(path, text[:span[0]] + new + text[span[1]:])
        return "updated"
    write(path, text.rstrip("\n") + "\n\n" + new)
    return "added"


def claude_md(proj):
    path = os.path.join(proj, "CLAUDE.md")
    text = read(path)
    if text is None:
        write(path, "@AGENTS.md\n")
        return "created"
    if IMPORT.search(text):
        return "unchanged"
    write(path, "@AGENTS.md\n\n" + text)
    return "added"


def gemini_md(proj):
    path = os.path.join(proj, "GEMINI.md")
    text = read(path)
    if text is None:
        return None
    if "AGENTS.md" in text:
        return "unchanged"
    write(path, GEMINI_LINE + "\n\n" + text)
    return "added"


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    if len(args) != 1 or not os.path.isdir(args[0]):
        sys.exit(__doc__)
    proj = os.path.abspath(args[0])
    uninstall = "--uninstall" in argv
    print(f"agents: {os.path.join(proj, 'AGENTS.md')} ({agents_md(proj, uninstall)})")
    if uninstall:
        return
    print(f"agents: {os.path.join(proj, 'CLAUDE.md')} (@AGENTS.md {claude_md(proj)})")
    g = gemini_md(proj)
    if g:
        print(f"agents: {os.path.join(proj, 'GEMINI.md')} ({g})")


if __name__ == "__main__":
    main(sys.argv[1:])
