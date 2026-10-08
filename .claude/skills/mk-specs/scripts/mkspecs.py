"""Shared helpers for mk-specs scripts: config loading (YAML subset), spec discovery, metrics.

Standard library only. The config file `specs/mk-specs.yml` is parsed by `parse_yaml`, which supports
the subset documented in references/traceability.md: block mappings, block sequences (of scalars or
mappings), flow lists `[a, b]`, 'single'/"double"-quoted and plain scalars, ints, true/false/null,
and `#` comments. Anchors, multi-line scalars and flow mappings are not supported.
"""
import glob
import json
import os
import re
import subprocess
import sys

CONFIG_REL = os.path.join("specs", "mk-specs.yml")


class ConfigError(Exception):
    pass


# ── YAML subset ──

def _strip_comment(line):
    quote, i = None, 0
    while i < len(line):
        ch = line[i]
        if quote:
            if quote == '"' and ch == "\\":
                i += 1
            elif ch == quote and quote == "'" and line[i + 1:i + 2] == "'":
                i += 1
            elif ch == quote:
                quote = None
        elif ch in "'\"" and (i == 0 or line[i - 1] in " :[,-"):
            quote = ch
        elif ch == "#" and (i == 0 or line[i - 1] in " \t"):
            return line[:i]
        i += 1
    return line


def _split_flow(text):
    items, cur, quote = [], "", None
    for ch in text:
        if quote:
            cur += ch
            if ch == quote:
                quote = None
        elif ch in "'\"":
            quote = ch
            cur += ch
        elif ch == ",":
            items.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        items.append(cur.strip())
    return items


def _scalar(text):
    s = text.strip()
    if s.startswith("'"):
        if len(s) < 2 or not s.endswith("'"):
            raise ConfigError(f"unterminated quoted string: {s}")
        return s[1:-1].replace("''", "'")
    if s.startswith('"'):
        return json.loads(s)
    if s.startswith("["):
        if not s.endswith("]"):
            raise ConfigError(f"unterminated flow list: {s}")
        return [_scalar(x) for x in _split_flow(s[1:-1])]
    if s in ("null", "~", ""):
        return None
    if s in ("true", "false"):
        return s == "true"
    if re.fullmatch(r"-?\d+", s):
        return int(s)
    return s


_KEY = re.compile(r"""^(?:'((?:[^']|'')*)'|"((?:[^"\\]|\\.)*)"|([^'"\s][^:]*?))\s*:(?:\s+|$)""")


def _is_seq(content):
    return content == "-" or content.startswith("- ")


def _block(lines, i, indent):
    return _seq(lines, i, indent) if _is_seq(lines[i][1]) else _map(lines, i, indent)


def _map(lines, i, indent):
    out = {}
    while i < len(lines) and lines[i][0] == indent and not _is_seq(lines[i][1]):
        m = _KEY.match(lines[i][1])
        if not m:
            raise ConfigError(f"expected 'key: value', got: {lines[i][1]}")
        key = m.group(1).replace("''", "'") if m.group(1) is not None else (
            json.loads('"' + m.group(2) + '"') if m.group(2) is not None else m.group(3).strip())
        rest = lines[i][1][m.end():]
        i += 1
        if rest.strip():
            out[key] = _scalar(rest)
        elif i < len(lines) and (lines[i][0] > indent or (lines[i][0] == indent and _is_seq(lines[i][1]))):
            out[key], i = _block(lines, i, lines[i][0])
        else:
            out[key] = None
    if i < len(lines) and lines[i][0] > indent:
        raise ConfigError(f"unexpected indentation: {lines[i][1]}")
    return out, i


def _seq(lines, i, indent):
    out = []
    while i < len(lines) and lines[i][0] == indent and _is_seq(lines[i][1]):
        rest = lines[i][1][1:].lstrip()
        if not rest:
            i += 1
            if i < len(lines) and lines[i][0] > indent:
                item, i = _block(lines, i, lines[i][0])
            else:
                item = None
        elif _KEY.match(rest) and not rest.startswith(("'", '"', "[")) or re.match(r"""^['"][^'"]*['"]\s*:""", rest):
            sub = indent + len(lines[i][1]) - len(rest)
            lines[i] = (sub, rest)
            item, i = _map(lines, i, sub)
        else:
            item = _scalar(rest)
            i += 1
        out.append(item)
    return out, i


def parse_yaml(text):
    lines = []
    for raw in text.splitlines():
        if raw.strip() == "---":
            continue
        s = _strip_comment(raw).rstrip()
        if not s.strip():
            continue
        body = s.lstrip(" ")
        if body.startswith("\t"):
            raise ConfigError("tabs are not allowed for indentation")
        lines.append((len(s) - len(body), body))
    if not lines:
        return {}
    value, i = _block(lines, 0, lines[0][0])
    if i != len(lines):
        raise ConfigError(f"could not parse line: {lines[i][1]}")
    return value


# ── config ──

DEFAULTS = {
    "version": 1,
    "language": "vi",
    "specs_dir": "specs",
    "contexts": None,          # [{id, title}] in output order
    "contexts_glob": None,     # e.g. "*" or "use-cases/*" when contexts is not listed
    "ids": {"uc": r"UC-\d+", "br": r"BR-\d+", "adr": r"ADR-\d+"},
    "decisions_file": "decisions.md",
    "tests": {
        "list_command": None,  # prints JSON [{"file": ..., "name": "describe > it"}] (vitest list --json)
        "file_pattern": r"[^`]+\.(?:test|spec)\.[cm]?[jt]sx?",
        "citation_style": "pointer",  # pointer | name | both
    },
    "readme": {
        "file": "README.md",
        "banner": {"match": r"^> (Cập nhật|Hợp nhất) ", "keep": 5},
        "lines": [],           # [{match: regex with named groups = metric keys}]
    },
    "metrics": {
        "since": None,         # YYYY-MM-DD; commits from this day count toward Trace Ratio
        "active_status": ["implemented", "partial"],
        "exempt_scopes": ["specs"],
    },
    "audit": {
        "required_sections": ["## History", "## Main Flow", "## Acceptance Criteria"],
        "recommended_sections": ["## Preconditions", "## Alternative Flows", "## Exceptions",
                                 "## Postconditions", "## Dependencies", "## Traceability",
                                 "## Divergences & Open Questions"],
        "metadata": ["Status", "BR"],
        "recommended_metadata": ["Owner"],
    },
}

TEXT = {
    "vi": {
        "no_test": "⚠ Chưa có test",
        "trace_head": (
            "# Traceability — UC ↔ AC ↔ Test\n\n"
            "> Sinh tự động từ các file `{specs}/*/UC-*.md` (dòng `- Tests:` dưới mỗi AC). Đừng sửa tay — sửa UC rồi sinh lại.\n"
            "> Mọi tên test ở đây đã được kiểm là có thật trong file test ({date}).\n\n"
            "| Context | UC | AC | Có test | ⚠ Chưa có test |\n|---|---|---|---|---|\n"
        ),
        "total": "Tổng",
        "oi_head": (
            "# Divergences & Open Questions — toàn bộ\n\n"
            "> Sinh tự động từ các dòng `[DIVERGENCE]` / `[OPEN]` trong `{specs}/`. Nguồn sự thật là file UC/ADR được link; sửa ở đó rồi sinh lại.\n"
            "> `[DIVERGENCE]` = tài liệu/plan nói một đằng, code làm một nẻo — **chưa quyết bên nào đúng**. `[OPEN]` = câu hỏi chưa có câu trả lời trong repo.\n"
            "> Danh sách đã lọc theo mức ảnh hưởng nằm ở `README.md` § \"Hàng đợi quyết định\".\n\n"
        ),
        "adr_section": "Quyết định (ADR)",
        "decimal": ",",
        "since_word": "từ",
    },
    "en": {
        "no_test": "⚠ No test",
        "trace_head": (
            "# Traceability — UC ↔ AC ↔ Test\n\n"
            "> Generated from `{specs}/*/UC-*.md` (the `- Tests:` line under each AC). Do not edit — edit the UC and regenerate.\n"
            "> Every test name here was checked to exist in its test file ({date}).\n\n"
            "| Context | UC | AC | Tested | ⚠ No test |\n|---|---|---|---|---|\n"
        ),
        "total": "Total",
        "oi_head": (
            "# Divergences & Open Questions — all\n\n"
            "> Generated from `[DIVERGENCE]` / `[OPEN]` lines in `{specs}/`. The linked UC/ADR file is the source of truth; edit there and regenerate.\n"
            "> `[DIVERGENCE]` = docs/plan say one thing, code does another — **not yet decided which is right**. `[OPEN]` = question without an answer in the repo.\n"
            "> The filtered list by impact lives in `README.md` § \"Decision queue\".\n\n"
        ),
        "adr_section": "Decisions (ADR)",
        "decimal": ".",
        "since_word": "since",
    },
}


def _merge(base, over):
    if not isinstance(base, dict) or not isinstance(over, dict):
        return over
    out = dict(base)
    for k, v in over.items():
        out[k] = _merge(base.get(k), v) if k in base else v
    return out


class Project:
    def __init__(self, root=".", config_path=None):
        self.root = os.path.abspath(root)
        path = config_path or os.path.join(self.root, CONFIG_REL)
        if not os.path.exists(path):
            raise ConfigError(f"config not found: {path} (run install.sh --project or mode init)")
        with open(path, encoding="utf-8") as fh:
            self.cfg = _merge(DEFAULTS, parse_yaml(fh.read()) or {})
        self.specs = os.path.join(self.root, self.cfg["specs_dir"])
        self.lang = self.cfg["language"] if self.cfg["language"] in TEXT else "vi"
        self.t = TEXT[self.lang]
        ids = self.cfg["ids"]
        self.uc_id = ids["uc"]
        self.id_patterns = [ids[k] for k in ("uc", "br", "adr") if ids.get(k)]
        self.uc_file = re.compile(rf"({self.uc_id})-.*\.md$")
        self.contexts = self._contexts()

    def _contexts(self):
        listed = self.cfg.get("contexts")
        if listed:
            out = [(c["id"], c.get("title") or c["id"]) if isinstance(c, dict) else (c, c) for c in listed]
            missing = [c for c, _ in out if not os.path.isdir(os.path.join(self.specs, c))]
            if missing:
                raise ConfigError(f"context folder(s) missing under {self.cfg['specs_dir']}/: {', '.join(missing)}")
            return out
        pattern = self.cfg.get("contexts_glob") or "*"
        out = []
        for d in sorted(glob.glob(os.path.join(self.specs, pattern))):
            rel = os.path.relpath(d, self.specs).replace(os.sep, "/")
            if os.path.isdir(d) and not rel.startswith("changes") and any(self.uc_file.match(f) for f in os.listdir(d)):
                out.append((rel, rel))
        return out

    def uc_files(self, ctx):
        d = os.path.join(self.specs, ctx)
        files = [f for f in os.listdir(d) if self.uc_file.match(f)]
        return sorted(files, key=lambda f: natural_key(self.uc_file.match(f).group(1)))

    def known_ids(self):
        """IDs defined in specs: UC file names + headings `#… <ID>` (BR, ADR) outside changes/."""
        found = set()
        heading = re.compile(r"^#{1,6} (" + "|".join(f"(?:{p})" for p in self.id_patterns) + r")\b", re.M)
        for root, dirs, files in os.walk(self.specs):
            dirs[:] = [d for d in dirs if os.path.relpath(os.path.join(root, d), self.specs) != "changes"]
            for f in files:
                m = self.uc_file.match(f)
                if m:
                    found.add(m.group(1))
                if f.endswith(".md"):
                    found.update(heading.findall(read(os.path.join(root, f))))
        return found

    def test_list(self, tests_json=None):
        """[(relative file, full test name)] from a JSON file or tests.list_command; None if unavailable."""
        if tests_json:
            with open(tests_json, encoding="utf-8") as fh:
                data = json.load(fh)
        else:
            cmd = self.cfg["tests"].get("list_command")
            if not cmd:
                return None
            res = subprocess.run(cmd, shell=True, cwd=self.root, capture_output=True, text=True)
            if res.returncode != 0:
                sys.stderr.write(res.stderr)
                raise ConfigError(f"tests.list_command failed ({res.returncode}): {cmd}")
            out = res.stdout
            start = out.find("[")
            data = json.loads(out[start:] if start >= 0 else out)
        return [(os.path.relpath(t["file"], self.root) if os.path.isabs(t["file"]) else t["file"], t["name"]) for t in data]

    def commits(self):
        """Subjects of non-merge commits since metrics.since; None when not configured / not a git repo."""
        since = self.cfg["metrics"].get("since")
        if not since:
            return None
        since = str(since)
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", since):
            since += "T00:00:00"
        res = subprocess.run(["git", "-C", self.root, "log", "--no-merges", f"--since={since}", "--format=%s"],
                             capture_output=True, text=True)
        if res.returncode != 0:
            return None
        return [l for l in res.stdout.split("\n") if l]

    def classify_commit(self, subject, known):
        """'traced' | 'exempt' | 'untraced' for a conventional-commit subject."""
        m = re.match(r"^[a-z]+(?:\(([^)]*)\))?!?: ", subject)
        scopes = [s.strip() for s in (m.group(1) or "").split(",")] if m else []
        if any(s in known and any(re.fullmatch(p, s) for p in self.id_patterns) for s in scopes):
            return "traced"
        if scopes and all(s in self.cfg["metrics"]["exempt_scopes"] for s in scopes):
            return "exempt"
        return "untraced"

    def pct(self, num, den):
        if not den:
            return "—"
        return f"{100 * num / den:.1f}%".replace(".", self.t["decimal"])


def natural_key(s):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", s)]


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def write_if_changed(path, text):
    if os.path.exists(path) and read(path) == text:
        return False
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    return True


def load(argv_root=None, config=None):
    try:
        return Project(argv_root or os.getcwd(), config)
    except ConfigError as e:
        sys.exit(f"mk-specs: {e}")
