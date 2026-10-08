#!/usr/bin/env python3
"""Replace the placeholder `chưa commit` with ``commit `<hash>` `` in History / Status lines of the specs.

Usage: commit-hash.py [--root DIR] [--config FILE] [--dry-run] [HASH]
  HASH defaults to `git rev-parse --short HEAD` (run it right after the code commit, before the merge commit).
Only lines starting with `- vN (` or `- Status:` are touched; a backticked `chưa commit` (prose about the rule) is left alone.
"""
import argparse
import os
import re
import subprocess
import sys

sys.dont_write_bytecode = True  # keep the installed skill folder clean
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mkspecs  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("hash", nargs="?")
ap.add_argument("--root", default=None)
ap.add_argument("--config", default=None)
ap.add_argument("--dry-run", action="store_true")
args = ap.parse_args()

P = mkspecs.load(args.root, args.config)
h = args.hash or subprocess.run(["git", "-C", P.root, "rev-parse", "--short", "HEAD"],
                                capture_output=True, text=True, check=True).stdout.strip()
if not re.fullmatch(r"[0-9a-f]{7,40}", h):
    sys.exit(f"mk-specs: not a commit hash: {h}")

PLACEHOLDER = re.compile(r"(?<!`)chưa commit(?!`)")
LINE = re.compile(r"^- (v\d+ \(|Status:)")
changed = 0
for root, _, files in os.walk(P.specs):
    for f in sorted(files):
        if not f.endswith(".md"):
            continue
        path = os.path.join(root, f)
        lines = mkspecs.read(path).split("\n")
        hits = 0
        for i, l in enumerate(lines):
            if LINE.match(l) and PLACEHOLDER.search(l):
                lines[i] = PLACEHOLDER.sub(f"commit `{h}`", l)
                hits += 1
                print(f"{os.path.relpath(path, P.root)}:{i + 1}")
        if hits and not args.dry_run:
            mkspecs.write_if_changed(path, "\n".join(lines))
        changed += hits
print(f"{'would replace' if args.dry_run else 'replaced'} {changed} placeholder(s) with commit `{h}`")
