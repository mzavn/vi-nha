#!/usr/bin/env python3
"""Verify specs: cited tests exist, relative links resolve, test-name tags point at real UC/AC.

Usage: verify.py [--root DIR] [--config FILE] [--tests FILE.json]
  --tests  test list JSON ([{"file", "name"}], e.g. `vitest list --json`); default: run tests.list_command.
           Without either, only the cited test files are checked for existence.
Exit 1 when any citation, link or tag is unresolved. `chưa commit` left in History is a warning.
"""
import argparse
import os
import re
import sys

sys.dont_write_bytecode = True  # keep the installed skill folder clean
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mkspecs  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--root", default=None)
ap.add_argument("--config", default=None)
ap.add_argument("--tests", default=None)
args = ap.parse_args()

P = mkspecs.load(args.root, args.config)
repo, specs = P.root, P.specs
style = P.cfg["tests"]["citation_style"]
test_list = P.test_list(args.tests)
names = None
if test_list is not None:
    names = {}
    for file, name in test_list:
        names.setdefault(file, set()).add(name)

TOKEN = re.compile(rf"`({P.cfg['tests']['file_pattern']})`|\"((?:[^\"\\]|\\.)*)\"|`([^`]* › [^`]*)`")
TAG = re.compile(rf"({P.uc_id})\s*/\s*(AC-\d+[a-z]?)\b")


def find(file, cited):
    """Full test names in `file` matching the cited `describe › it` (None if the list is unavailable)."""
    if names is None:
        return None
    pool = names.get(file)
    if pool is None:
        return []
    # Vitest joins describe/it with " > "; a describe title may itself contain " › ".
    rx = "(?: › | > )".join(re.escape(p) for p in cited.split(" › "))
    rx = re.sub(r"%[sdijfo#%]", ".+", rx)
    rx = re.sub(r"\\\$\w+", ".+", rx)
    return [n for n in pool if re.fullmatch(rx, n)]


bad_tests, n_cites, acs = [], 0, set()
for root, _, files in os.walk(specs):
    for f in files:
        um = P.uc_file.match(f)
        if not um:
            continue
        uc = um.group(1)
        path = os.path.join(root, f)
        ac = None
        for i, line in enumerate(open(path, encoding="utf-8"), 1):
            am = re.match(r"### (AC-\d+[a-z]?): ", line)
            if am:
                ac = am.group(1)
                acs.add((uc, ac))
            if not line.startswith("- Tests:"):
                continue
            cur_file, prev = None, None
            for m in TOKEN.finditer(line):
                if m.group(1):
                    cur_file = m.group(1)
                    if names is None and not os.path.exists(os.path.join(repo, cur_file)):
                        bad_tests.append((path, i, cur_file, "", "file not found"))
                    continue
                cited = (m.group(2) or m.group(3)).replace('\\"', '"')
                if cur_file is None:
                    continue
                if cited.startswith("… › "):
                    if prev is None or " › " not in prev:
                        bad_tests.append((path, i, cur_file, cited, "ellipsis without previous describe"))
                        continue
                    cited = prev.rsplit(" › ", 1)[0] + cited[1:]
                n_cites += 1
                hits = find(cur_file, cited)
                if hits is not None and not hits:
                    bad_tests.append((path, i, cur_file, cited, "not found"))
                elif hits and style == "both" and ac and not any(
                        (m2.group(1), m2.group(2)) == (uc, ac) for h in hits for m2 in TAG.finditer(h)):
                    bad_tests.append((path, i, cur_file, cited, f"test name lacks '{uc} / {ac}'"))
                prev = cited

bad_tags = []
if style in ("name", "both") and test_list is not None:
    for file, name in test_list:
        for m in TAG.finditer(name):
            if (m.group(1), m.group(2)) not in acs:
                bad_tags.append((file, name, f"{m.group(1)} / {m.group(2)}"))

LINK = re.compile(r"\]\(([^)\s]+)\)")
bad_links, n_links = [], 0
pending = []
for root, _, files in os.walk(specs):
    for f in files:
        if not f.endswith(".md"):
            continue
        path = os.path.join(root, f)
        text = open(path, encoding="utf-8").read()
        for m in LINK.finditer(text):
            target = m.group(1).split("#", 1)[0]
            if not target or re.match(r"^[a-z]+:", target):
                continue
            n_links += 1
            if not os.path.exists(os.path.normpath(os.path.join(os.path.dirname(path), target))):
                bad_links.append((os.path.relpath(path, repo), target))
        for i, line in enumerate(text.split("\n"), 1):
            if re.match(r"^- (v\d+ \(|Status:)", line) and re.search(r"(?<!`)chưa commit(?!`)", line):
                pending.append(f"{os.path.relpath(path, repo)}:{i}")

if names is None:
    print("test list unavailable (tests.list_command not set): checked cited files only")
print(f"citations checked: {n_cites}, unresolved: {len(bad_tests)}")
for b in bad_tests:
    print("  TEST", os.path.relpath(b[0], repo) + ":" + str(b[1]), b[2], "›", b[3], "—", b[4])
if style in ("name", "both"):
    print(f"test-name tags pointing at unknown UC/AC: {len(bad_tags)}")
    for b in bad_tags:
        print("  TAG", b[0], "›", b[1], "—", b[2])
print(f"relative links checked: {n_links}, unresolved: {len(bad_links)}")
for b in bad_links:
    print("  LINK", b[0], "→", b[1])
if pending:
    print(f"warning: 'chưa commit' still in {len(pending)} History/Status line(s) — run commit-hash.py after the code commit")
    for p in pending:
        print("  PENDING", p)
sys.exit(1 if bad_tests or bad_links or bad_tags else 0)
