#!/usr/bin/env python3
"""Hard checks for human-facing Markdown documents.

Exit 0 when no errors are found. Warnings do not fail unless --strict is set.
The gate is deliberately dependency-free so every project can run it.

Usage:
    python3 ~/.claude/scripts/docs_qa.py --root .
    python3 ~/.claude/scripts/docs_qa.py docs README.md --strict
    python3 ~/.claude/scripts/docs_qa.py --canary
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import re
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover
    tomllib = None

DEFAULT_EXCLUDES = [
    ".git", ".ci-runs", ".zvec-grep", "node_modules", "vendor",
    "archive", "sources", "exports",
    ".venv", "venv", ".tox", "__pycache__", ".mypy_cache",
    ".pytest_cache", ".ruff_cache", "coverage", "htmlcov",
    ".next", "third_party", "external",
    ".uv-cache", ".cache", ".npm", ".pnpm-store", ".local",
    ".claude", ".remember", ".cursor", ".codex",
]
ROOT_BUILD_DIRS = {"dist", "build", "out", "target", "bin", "obj"}

STRONG_SLOP = [
    "landscape", "pivotal", "underscore", "showcase", "testament",
    "tapestry", "interplay", "delve", "fostering", "holistic",
    "seamless", "leverage", "vibrant", "profound", "groundbreaking",
    "renowned", "boasts", "nestled", "in the heart of", "game-changer",
    "revolutionize", "transformative", "serves as", "stands as",
    "not only", "not just", "the real question", "at its core",
    "what really matters", "future outlook", "despite these challenges",
    "the bottom line",
]

STATUS_CLAIMS = [
    "fully operational", "fully implemented", "fielded system",
    "production-ready", "certified for",
]

SECRET_PATTERNS = [
    ("SEC001", "private key block", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("SEC002", "AWS access key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("SEC003", "GitHub token", re.compile(r"\bghp_[A-Za-z0-9]{36}\b")),
    ("SEC004", "API key assignment", re.compile(r"\b(?:sk|pk)-[A-Za-z0-9]{24,}\b")),
]


@dataclass
class Finding:
    severity: str
    rule: str
    path: Path
    line: int
    message: str


@dataclass
class Options:
    root: Path
    excludes: list[str] = field(default_factory=lambda: list(DEFAULT_EXCLUDES))
    ignore: set[str] = field(default_factory=set)
    strict: bool = False


def load_config(root: Path) -> dict:
    path = root / ".docs-qa.toml"
    if not path.exists() or tomllib is None:
        return {}
    try:
        return tomllib.loads(path.read_text())
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise SystemExit(f"docs-qa: cannot read {path}: {exc}")


def is_excluded(rel: str, patterns: list[str]) -> bool:
    parts = Path(rel).parts
    if parts and parts[0] in ROOT_BUILD_DIRS:
        return True
    for pattern in patterns:
        if "/" not in pattern:
            if pattern in parts:
                return True
        elif fnmatch.fnmatch(rel, pattern) or fnmatch.fnmatch(rel, f"**/{pattern}") or fnmatch.fnmatch(rel, f"{pattern}/**"):
            return True
    return False


def ignored(rule: str, line: str, previous: str, file_ignores: set[str]) -> bool:
    for source in (line, previous):
        for match in re.finditer(r"docs-qa:\s*ignore(?:-file)?\s+([A-Z0-9, *_-]+)", source):
            for token in re.split(r"[,\s]+", match.group(1)):
                if token and fnmatch.fnmatch(rule, token):
                    return True
    return any(fnmatch.fnmatch(rule, token) for token in file_ignores)


def prose_only(line: str) -> str:
    return re.sub(r"`[^`]*`", "", line)


INVISIBLE = {
    0x00AD, 0x180E, 0x200B, 0x200C, 0x200D, 0x200E, 0x200F,
    0x202A, 0x202B, 0x202C, 0x202D, 0x202E,
    0x2060, 0x2061, 0x2062, 0x2063, 0x2064,
    0x2066, 0x2067, 0x2068, 0x2069, 0xFEFF,
}


def invisible_char(line: str) -> str | None:
    for char in line:
        code = ord(char)
        if code in INVISIBLE or 0xFE00 <= code <= 0xFE0F or 0xE0100 <= code <= 0xE01EF or 0xE0000 <= code <= 0xE007F:
            return f"U+{code:04X}"
    return None


def slug(text: str) -> str:
    text = text.strip().lower()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"\s+", "-", text)
    return text.strip("-")


def split_table_row(line: str) -> list[str]:
    cells, current, in_code = [], [], False
    text = line.strip().strip("|")
    index = 0
    while index < len(text):
        char = text[index]
        if char == "\\" and index + 1 < len(text) and text[index + 1] == "|":
            current.append("|")
            index += 2
            continue
        if char == "`":
            in_code = not in_code
            current.append(char)
        elif char == "|" and not in_code:
            cells.append("".join(current).strip())
            current = []
        else:
            current.append(char)
        index += 1
    cells.append("".join(current).strip())
    return cells


def check_file(path: Path, root: Path, options: Options) -> list[Finding]:
    findings: list[Finding] = []
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return [Finding("error", "DOC000", path, 1, "file is not UTF-8")]
    if not text.strip():
        return [Finding("error", "DOC001", path, 1, "empty document")]

    lines = text.splitlines()
    in_fence = False
    fence_token = ""
    fence_start = 0
    headings: list[tuple[int, str, int]] = []
    anchors: dict[str, int] = {}
    previous = ""
    table_rows: list[tuple[int, list[str]]] = []
    file_ignores = set()

    for index, line in enumerate(lines, 1):
        for match in re.finditer(r"docs-qa:\s*ignore-file\s+([A-Z0-9, *_-]+)", line):
            for token in re.split(r"[,\s]+", match.group(1)):
                if token:
                    file_ignores.add(token)

    def add(severity: str, rule: str, line_no: int, message: str) -> None:
        line = lines[line_no - 1] if 0 < line_no <= len(lines) else ""
        prev = lines[line_no - 2] if line_no >= 2 else ""
        if ignored(rule, line, prev, file_ignores):
            return
        findings.append(Finding(severity, rule, path, line_no, message))

    for index, line in enumerate(lines, 1):
        stripped = line.lstrip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            token = stripped[:3]
            if not in_fence:
                in_fence, fence_token, fence_start = True, token, index
            elif token == fence_token:
                in_fence = False
            previous = line
            continue
        if in_fence:
            previous = line
            continue

        # Table collection
        if line.lstrip().startswith("|"):
            table_rows.append((index, split_table_row(line)))
        else:
            if table_rows:
                widths = {len(cells) for _, cells in table_rows}
                if len(widths) > 1:
                    add("error", "MD004", table_rows[0][0], f"table has inconsistent column counts {sorted(widths)}")
                table_rows = []

        # Headings
        heading = re.match(r"^(#{1,6})\s+(.*)$", line)
        if heading:
            level = len(heading.group(1))
            title = heading.group(2).strip()
            if not title:
                add("error", "MD005", index, "empty heading")
            headings.append((level, title, index))
            anchor = slug(title)
            if anchor in anchors:
                add("warning", "MD006", index, f"duplicate heading anchor #{anchor}")
            anchors.setdefault(anchor, index)
            words = [word for word in title.split() if word]
            if len(words) >= 4:
                capitalised = sum(1 for word in words if word[:1].isupper())
                if capitalised / len(words) >= 0.75:
                    add("warning", "SLOP005", index, "title-case heading")
            if any(ord(char) > 0x2100 for char in title):
                add("warning", "SLOP006", index, "emoji or symbol in heading")

        # Typography
        for rule, char, label in (("TY001", "—", "em dash"), ("TY002", "–", "en dash")):
            if char in line:
                add("error", rule, index, label)
        if " -- " in line:
            add("warning", "TY003", index, "double hyphen used as a dash")
        if any(char in line for char in ("“", "”", "‘", "’")):
            add("warning", "TY004", index, "curly quote")
        if line != line.rstrip():
            add("warning", "TY005", index, "trailing whitespace")
        mark = invisible_char(line)
        if mark:
            add("error", "TY006", index, f"invisible Unicode character {mark}")

        # Status and slop
        lower = prose_only(line).lower()
        for phrase in STATUS_CLAIMS:
            if phrase in lower:
                add("warning", "CLAIM001", index, f"status claim '{phrase}' needs evidence")
        for phrase in STRONG_SLOP:
            if phrase in lower:
                add("warning", "SLOP001", index, f"stock phrase '{phrase}'")
        if re.search(r"\bnot only\b.*\bbut\b", lower):
            add("warning", "SLOP004", index, "not only ... but construction")
        if re.search(r"\b(?:in conclusion|the future looks bright|exciting times|in today's rapidly evolving)\b", lower):
            add("warning", "SLOP003", index, "generic closing or outlook")

        # Secrets
        for rule, label, pattern in SECRET_PATTERNS:
            if pattern.search(line):
                add("error", rule, index, label)

        # Links
        for match in re.finditer(r"!?\[[^\]]*\]\(([^)]+)\)", line):
            target = match.group(1).strip()
            if target.startswith(("http://", "https://", "mailto:", "#")):
                continue
            if any(char in target for char in "{}*<$"):
                continue
            path_part, _, anchor = target.partition("#")
            if not path_part:
                continue
            resolved = (path.parent / path_part).resolve()
            root_resolved = root.resolve()
            outside_root = root_resolved not in resolved.parents and resolved != root_resolved
            if outside_root:
                if not resolved.exists():
                    add("warning", "LINK003", index, f"workspace link not mounted: {target}")
                continue
            if not resolved.exists():
                add("error", "LINK001", index, f"dead link {target}")
                continue
            if anchor and resolved.suffix == ".md":
                try:
                    target_text = resolved.read_text(encoding="utf-8")
                except (OSError, UnicodeDecodeError):
                    continue
                target_anchors = {
                    slug(m.group(2))
                    for m in re.finditer(r"^(#{1,6})\s+(.*)$", target_text, re.MULTILINE)
                }
                if slug(anchor) not in target_anchors:
                    add("warning", "LINK002", index, f"missing anchor #{anchor} in {path_part}")

        previous = line

    if table_rows:
        widths = {len(cells) for _, cells in table_rows}
        if len(widths) > 1:
            add("error", "MD004", table_rows[0][0], f"table has inconsistent column counts {sorted(widths)}")
    if in_fence:
        add("error", "MD001", fence_start, "unbalanced code fence")
    if not headings:
        add("warning", "DOC002", 1, "no heading")
    else:
        h1s = [head for head in headings if head[0] == 1]
        if not h1s:
            add("warning", "DOC003", 1, "no H1 heading")
        if len(h1s) > 1:
            add("warning", "DOC004", h1s[1][2], "multiple H1 headings")
        last = headings[0][0]
        for level, _, line_no in headings[1:]:
            if level > last + 1:
                add("warning", "MD003", line_no, f"heading level jumps from {last} to {level}")
            last = level

    # Bold-label list density
    list_items = [line for line in lines if re.match(r"^\s*[-*]\s+", line)]
    bold_labels = [line for line in list_items if re.match(r"^\s*[-*]\s+\*\*[^*]+\*\*", line)]
    if len(list_items) >= 5 and len(bold_labels) / len(list_items) > 0.6:
        add("warning", "SLOP002", 1, "most list items start with a bold label")

    return findings


def run(root: Path, paths: list[Path], options: Options) -> list[Finding]:
    files: list[Path] = []
    for path in paths:
        if path.is_dir():
            files.extend(sorted(path.rglob("*.md")))
        elif path.suffix == ".md":
            files.append(path)
    findings: list[Finding] = []
    for path in files:
        try:
            rel = path.resolve().relative_to(root).as_posix()
        except ValueError:
            rel = path.name
        if is_excluded(rel, options.excludes):
            continue
        findings.extend(check_file(path, root, options))
    return findings


def canary() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        clean = root / "clean.md"
        clean.write_text("# Clean document\n\nA short paragraph with a [link](clean.md).\n")
        bad = root / "bad.md"
        bad.write_text(
            "# Bad document — title\n\n"
            "## Strategic Negotiations And Global Partnerships\n\n"
            "A sentence with an en dash 2020–2024 and a -- dash.\n\n"
            "A zero\u200bwidth mark.\n\n"
            "A curly “quote” and trailing space \n\n"
            "| A | B |\n|---|---|\n| 1 |\n\n"
            "[dead](missing.md)\n\n"
            "-----BEGIN RSA PRIVATE KEY-----\n\n"
            "The platform is fully operational and serves as a showcase.\n\n"
            "- **One:** text\n- **Two:** text\n- **Three:** text\n- **Four:** text\n- **Five:** text\n\n"
            "```\n# heading inside fence\n"
        )
        findings = run(root, [root], Options(root=root, excludes=[]))
        rules = {finding.rule for finding in findings}
        expected = {"TY001", "TY002", "TY003", "TY004", "TY005", "TY006", "MD004", "LINK001", "SEC001", "CLAIM001", "SLOP001", "SLOP002", "SLOP005", "MD001"}
        missing = sorted(expected - rules)
        clean_findings = [finding for finding in run(root, [clean], Options(root=root, excludes=[])) if finding.severity == "error"]
        if clean_findings:
            print(f"canary: clean document produced errors: {clean_findings}", file=sys.stderr)
            return 1
        if missing:
            print(f"canary: {len(expected) - len(missing)}/{len(expected)} planted defects caught; missing {missing}", file=sys.stderr)
            return 1
        print(f"canary: {len(expected)}/{len(expected)} planted defects caught")
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="QA Markdown documents before human review.")
    parser.add_argument("paths", nargs="*", help="files or directories; defaults to the root")
    parser.add_argument("--root", type=Path, default=Path("."), help="repository root for excludes and links")
    parser.add_argument("--exclude", action="append", default=[], help="extra glob to exclude")
    parser.add_argument("--strict", action="store_true", help="treat warnings as errors")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument("--errors-only", action="store_true", help="print errors and the summary only")
    parser.add_argument("--canary", action="store_true", help="prove the gate catches planted defects")
    args = parser.parse_args()

    if args.canary:
        return canary()

    root = args.root.resolve()
    if not root.exists():
        print(f"docs-qa: root does not exist: {root}", file=sys.stderr)
        return 2
    config = load_config(root)
    excludes = list(DEFAULT_EXCLUDES) + list(config.get("exclude", [])) + args.exclude
    ignore = set(config.get("ignore", []))
    strict = args.strict or bool(config.get("strict", False))
    paths = [Path(p) for p in args.paths] or [root]
    findings = run(root, paths, Options(root=root, excludes=excludes, ignore=ignore, strict=strict))
    errors = [finding for finding in findings if finding.severity == "error"]
    warnings = [finding for finding in findings if finding.severity != "error"]
    if args.json:
        print(json.dumps({"errors": len(errors), "warnings": len(warnings), "findings": [
            {"severity": f.severity, "rule": f.rule, "path": str(f.path), "line": f.line, "message": f.message}
            for f in findings
        ]}, indent=2))
    else:
        shown = errors if args.errors_only else findings
        for finding in sorted(shown, key=lambda f: (str(f.path), f.line, f.rule)):
            try:
                display = finding.path.resolve().relative_to(root)
            except ValueError:
                display = finding.path
            print(f"{display}:{finding.line}: {finding.severity} {finding.rule} {finding.message}")
        print(f"docs-qa: {len(errors)} errors, {len(warnings)} warnings")
    if errors:
        return 1
    if strict and warnings:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
