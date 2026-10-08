#!/usr/bin/env python3
"""Regenerate <specs>/traceability.md and <specs>/open-issues.md, refresh README counters, print metrics.

Usage: gen.py [--root DIR] [--config FILE] [--verified-on YYYY-MM-DD] [--tests FILE.json]
  --root         project root (default: cwd); config defaults to <root>/specs/mk-specs.yml
  --verified-on  date written in the traceability header (default: keep the date already there, else today)
  --tests        test list JSON (only needed for tests.citation_style = name; else tests.list_command runs)
Output is deterministic: running twice on the same tree yields identical bytes.
"""
import argparse
import datetime
import os
import posixpath
import re
import sys

sys.dont_write_bytecode = True  # keep the installed skill folder clean
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mkspecs  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--root", default=None)
ap.add_argument("--config", default=None)
ap.add_argument("--verified-on", default=None)
ap.add_argument("--tests", default=None)
args = ap.parse_args()

P = mkspecs.load(args.root, args.config)
specs, t = P.specs, P.t
read = mkspecs.read
LINK = re.compile(r"\]\(([^)#\s]+)")


def relink(text, file_dir):
    """Links relative to the file's dir → relative to the specs dir."""
    def sub(m):
        target = m.group(1)
        if re.match(r"^[a-z]+:", target) or target.startswith("/"):
            return m.group(0)
        resolved = posixpath.normpath(posixpath.join(file_dir, target))
        return "](" + posixpath.relpath(resolved, ".")
    return LINK.sub(sub, text)


def meta(lines, key):
    line = next((l for l in lines if l.startswith(f"- {key}: ")), None)
    return line[len(f"- {key}: "):] if line else "—"


# Tests found by name (`UC-xxx / AC-n` inside the test name) for citation_style = name.
by_name = {}
if P.cfg["tests"]["citation_style"] == "name":
    tl = P.test_list(args.tests)
    if tl is None:
        sys.exit("mk-specs: citation_style = name needs tests.list_command or --tests")
    tag = re.compile(rf"({P.uc_id})\s*/\s*(AC-\d+[a-z]?)\b")
    for file, name in sorted(tl):
        for m in tag.finditer(name):
            by_name.setdefault((m.group(1), m.group(2)), []).append(f"`{file}` › \"{name.replace(' > ', ' › ')}\"")

# ── traceability ──
summary, body = [], []
tot = [0, 0, 0, 0]
active = set(P.cfg["metrics"]["active_status"])
spec_active = spec_covered = 0
for ctx, title in P.contexts:
    body.append(f"## {title}\n")
    n_uc = n_ac = n_ok = n_no = 0
    for f in P.uc_files(ctx):
        lines = read(os.path.join(specs, ctx, f)).split("\n")
        m = re.match(rf"# ({P.uc_id}): (.*)", lines[0])
        if not m:
            sys.exit(f"mk-specs: {ctx}/{f}: first line must be '# <UC-ID>: <name>'")
        uc, name = m.group(1), m.group(2)
        status, br = meta(lines, "Status"), meta(lines, "BR")
        body.append(f"### [{uc}]({ctx}/{f}) {name}\nStatus: `{status}` · BR: {br}\n\n| AC | Test |\n|---|---|")
        n_uc += 1
        in_ac = False
        cur = None
        rows = []
        for l in lines:
            if l.startswith("## "):
                in_ac = l.strip() == "## Acceptance Criteria"
                continue
            if not in_ac:
                continue
            mm = re.match(r"### (AC-\d+[a-z]?): (.*)", l)
            if mm:
                cur = [mm.group(1), mm.group(2), None]
                rows.append(cur)
                continue
            if cur is not None and l.startswith("- Tests:"):
                cur[2] = l[len("- Tests:"):].strip()
        uc_ok = 0
        for ac, acname, tests in rows:
            if tests is None and (uc, ac) in by_name:
                tests = "; ".join(by_name[(uc, ac)])
            tests = relink(tests or t["no_test"], ctx)
            ok = not (tests.startswith("⚠") or tests.endswith(t["no_test"]))
            n_ac += 1
            if ok:
                n_ok += 1
                uc_ok += 1
            else:
                n_no += 1
            body.append(f"| {'✅' if ok else '⚠'} {ac}: {acname} | {tests} |")
        body.append("")
        st = re.match(r"\W*([\w-]+)", status)
        if st and st.group(1) in active:
            spec_active += 1
            spec_covered += 1 if uc_ok else 0
    summary.append(f"| {ctx} | {n_uc} | {n_ac} | {n_ok} | {n_no} |")
    for i, v in enumerate((n_uc, n_ac, n_ok, n_no)):
        tot[i] += v

trace_path = os.path.join(specs, "traceability.md")
verified = args.verified_on
if not verified and os.path.exists(trace_path):
    old = re.search(r"\((\d{4}-\d{2}-\d{2})\)\.\n", read(trace_path)[:1000])
    verified = old.group(1) if old else None
verified = verified or datetime.date.today().isoformat()
head = (
    t["trace_head"].format(specs=P.cfg["specs_dir"], date=verified)
    + "\n".join(summary)
    + f"\n| **{t['total']}** | **{tot[0]}** | **{tot[1]}** | **{tot[2]}** | **{tot[3]}** |\n\n"
)
mkspecs.write_if_changed(trace_path, head + "\n".join(body))

# ── open issues ──
ITEM = re.compile(r"^- \[(DIVERGENCE|OPEN)\]")
sections = []
total = [0, 0]


def issues(path, rel_dir):
    found = [l for l in read(path).split("\n") if ITEM.match(l)]
    return [relink(l, rel_dir) for l in found]


for ctx, title in P.contexts:
    files = (["README.md"] if os.path.exists(os.path.join(specs, ctx, "README.md")) else []) + P.uc_files(ctx)
    blocks, d, o = [], 0, 0
    for f in files:
        items = issues(os.path.join(specs, ctx, f), ctx)
        if not items:
            continue
        d += sum(1 for l in items if l.startswith("- [DIVERGENCE]"))
        o += sum(1 for l in items if l.startswith("- [OPEN]"))
        blocks.append(f"### [{ctx}/{f}]({ctx}/{f})\n" + "\n".join(items) + "\n")
    total[0] += d
    total[1] += o
    sections.append(f"## {title} — {d} divergence, {o} open\n\n" + "\n".join(blocks))

dec_name = P.cfg.get("decisions_file")
dec_path = os.path.join(specs, dec_name) if dec_name else None
if dec_path and os.path.exists(dec_path):
    items = issues(dec_path, ".")
    d = sum(1 for l in items if l.startswith("- [DIVERGENCE]"))
    o = len(items) - d
    total[0] += d
    total[1] += o
    sections.append(f"## {t['adr_section']} — {d} divergence, {o} open\n\n### [{dec_name}]({dec_name})\n" + "\n".join(items) + "\n")

oi = t["oi_head"].format(specs=P.cfg["specs_dir"]) + "\n".join(sections)
mkspecs.write_if_changed(os.path.join(specs, "open-issues.md"), oi)

# ── metrics ──
known = P.known_ids()
subjects = P.commits()
traced = trace_total = 0
if subjects is not None:
    for s in subjects:
        kind = P.classify_commit(s, known)
        if kind != "exempt":
            trace_total += 1
            traced += kind == "traced"


def last_id(key):
    pat = P.cfg["ids"].get(key)
    ids = [i for i in known if pat and re.fullmatch(pat, i)]
    if not ids:
        return "—"
    best = max(ids, key=mkspecs.natural_key)
    return re.findall(r"\d+", best)[-1]


since = P.cfg["metrics"].get("since")
M = {
    "uc": tot[0], "ac": tot[1], "tested": tot[2], "untested": tot[3],
    "divergence": total[0], "open": total[1],
    "ac_coverage": P.pct(tot[2], tot[1]),
    "spec_coverage": P.pct(spec_covered, spec_active), "spec_covered": spec_covered, "spec_active": spec_active,
    "trace_ratio": P.pct(traced, trace_total) if subjects is not None else "—",
    "traced": traced, "trace_total": trace_total, "since": since or "—",
    "adr_last": last_id("adr"), "br_last": last_id("br"),
}

# ── README: drop old banner lines, refresh counter lines ──
rcfg = P.cfg["readme"]
readme_path = os.path.join(specs, rcfg["file"]) if rcfg.get("file") else None
notes = []
if readme_path and os.path.exists(readme_path):
    lines = read(readme_path).split("\n")
    banner = rcfg.get("banner") or {}
    if banner.get("match") and banner.get("keep") is not None:
        rx = re.compile(banner["match"])
        idx = [i for i, l in enumerate(lines) if rx.search(l)]
        if len(idx) > banner["keep"]:
            def age(i):
                dm = re.search(r"\d{4}-\d{2}-\d{2}", lines[i])
                return (dm.group(0) if dm else "", i)
            drop = set(sorted(idx, key=age)[: len(idx) - banner["keep"]])
            lines = [l for i, l in enumerate(lines) if i not in drop]
            notes.append(f"README: dropped {len(drop)} old banner line(s), kept {banner['keep']}")
    for spec in rcfg.get("lines") or []:
        rx = re.compile(spec["match"])
        hit = False
        for i, l in enumerate(lines):
            m = rx.search(l)
            if not m:
                continue
            hit = True
            groups = [(m.start(g), m.end(g), g) for g in rx.groupindex if m.group(g) is not None]
            for s, e, g in sorted(groups, reverse=True):
                if g not in M:
                    sys.exit(f"mk-specs: readme.lines group '{g}' is not a metric ({', '.join(M)})")
                l = l[:s] + str(M[g]) + l[e:]
            lines[i] = l
        if not hit:
            notes.append(f"README: no line matches {spec['match']!r}")
    if mkspecs.write_if_changed(readme_path, "\n".join(lines)):
        notes.append("README: updated")

print(f"UC {tot[0]} · AC {tot[1]} · test {tot[2]} · no test {tot[3]} · divergence {total[0]} · open {total[1]}")
print(f"AC Coverage {M['ac_coverage']} · Spec Coverage {M['spec_coverage']} ({spec_covered}/{spec_active} UC) · "
      f"Trace Ratio {M['trace_ratio']} ({traced}/{trace_total} commit {t['since_word']} {M['since']})")
for n in notes:
    print(n)
