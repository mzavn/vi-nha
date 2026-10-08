#!/usr/bin/env python3
"""Report (never rewrite) spec hygiene gaps: missing UC sections/metadata, code identifiers in business text,
commits without a UC/BR/ADR ID since metrics.since.

Usage: audit.py [--root DIR] [--config FILE] [--limit N]
Always exits 0; it is a to-do list for converting specs when they are next touched.
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
ap.add_argument("--limit", type=int, default=3, help="examples shown per UC")
args = ap.parse_args()

P = mkspecs.load(args.root, args.config)
A = P.cfg["audit"]

# Signals that a line speaks code instead of business language.
CODE = [
    ("endpoint", re.compile(r"\b(GET|POST|PUT|PATCH|DELETE) /|`/[\w/:.-]+`")),
    ("identifier", re.compile(r"`[^`]*([a-z][a-z0-9]*[A-Z]\w*|\w+_\w+|\w+\(\)?|\w+\.\w+\(|=>|\{)[^`]*`")),
    ("status code", re.compile(r"\b[1-5]\d\d `?[a-z]+_[a-z_]+")),
]
BUSINESS = {"## Main Flow", "## Alternative Flows", "## Exceptions", "## Acceptance Criteria", "## Postconditions"}

missing_req, missing_rec, code_lines = [], [], []
n_uc = 0
for ctx, _ in P.contexts:
    for f in P.uc_files(ctx):
        n_uc += 1
        rel = f"{ctx}/{f}"
        lines = mkspecs.read(os.path.join(P.specs, ctx, f)).split("\n")
        heads = [l.strip() for l in lines if l.startswith("## ")]
        has = lambda s: any(h == s or h.startswith(s + " ") for h in heads)  # noqa: E731
        meta = {m.group(1) for l in lines for m in [re.match(r"^- ([\w ]+): ", l)] if m}
        req = [s for s in A["required_sections"] if not has(s)] + [f"- {k}:" for k in A["metadata"] if k not in meta]
        rec = [s for s in A["recommended_sections"] if not has(s)] + \
              [f"- {k}:" for k in A["recommended_metadata"] if k not in meta]
        if req:
            missing_req.append((rel, req))
        if rec:
            missing_rec.append((rel, rec))
        section, hits = None, []
        for i, l in enumerate(lines, 1):
            if l.startswith("## "):
                section = next((b for b in BUSINESS if l.strip() == b or l.strip().startswith(b + " ")), None)
                continue
            if section is None or l.lstrip().startswith(("- Tests:", "- Kỹ thuật:", "Kỹ thuật:", "- Tech:")):
                continue
            kinds = [k for k, rx in CODE if rx.search(l)]
            if kinds:
                hits.append((i, kinds, l.strip()))
        if hits:
            code_lines.append((rel, hits))

print(f"# mk-specs audit — {n_uc} UC\n")
print(f"## Missing required sections / metadata: {len(missing_req)} UC")
for rel, items in missing_req:
    print(f"- {rel}: {', '.join(items)}")
print(f"\n## Missing recommended sections / metadata: {len(missing_rec)} UC")
for rel, items in missing_rec:
    print(f"- {rel}: {', '.join(items)}")
total = sum(len(h) for _, h in code_lines)
print(f"\n## Code in business text (Main Flow, flows, exceptions, AC): {total} line(s) in {len(code_lines)} UC")
print("Move endpoints, symbols, error codes, payloads to `## Traceability` or a `Kỹ thuật:` sub-bullet when the UC is next edited.")
for rel, hits in sorted(code_lines, key=lambda x: -len(x[1])):
    print(f"- {rel}: {len(hits)} line(s)")
    for i, kinds, text in hits[: args.limit]:
        print(f"    {i}: [{', '.join(kinds)}] {text[:120]}")

subjects = P.commits()
if subjects is None:
    print("\n## Commits without ID: skipped (metrics.since not set or not a git repo)")
else:
    known = P.known_ids()
    bad = [s for s in subjects if P.classify_commit(s, known) == "untraced"]
    print(f"\n## Commits without a valid UC/BR/ADR ID since {P.cfg['metrics']['since']}: {len(bad)}/{len(subjects)}")
    for s in bad:
        print(f"- {s}")
