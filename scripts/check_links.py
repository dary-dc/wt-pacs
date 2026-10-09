#!/usr/bin/env python3
"""scripts/check_links.py — in every tracked .md file, each link, anchor and backticked repo path resolves."""

import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO_DIRS = ("client/", "common/", "deploy/", "docs/", "fixtures/", "ingest/", "lab/", "patched/", "patches/", "scripts/", "server/", "tools/")
LINK = re.compile(r"\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
HEADING = re.compile(r"^#{1,6}\s+(.*?)\s*#*\s*$")
HTML_ANCHOR = re.compile(r'<a (?:name|id)="([^"]+)"')
# A path that no longer exists may be named beside the commit, tag or word that says so.
# Another queue's record, which this repository's later moves do not rewrite: its links resolve, its paths are its own.
PATHS_AS_WRITTEN = {"docs/cloud-queue.md"}
HISTORICAL = re.compile(r"\b[0-9a-f]{7,40}\b|archive/|removed|retired|history|in git", re.I)


def unfenced_lines(path):
    """The file's lines, with fenced code blocks blanked so line numbers still match."""
    lines, fence = [], False
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if line.lstrip().startswith("```"):
            fence = not fence
            line = ""
        lines.append("" if fence else line)
    return lines


def slug(heading):
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", heading.strip().lower())
    return "".join("-" if c == " " else c for c in text if c.isalnum() or c in "-_ ")


anchors_by_file = {}


def anchors(path):
    if path not in anchors_by_file:
        found, seen = set(), {}
        for line in unfenced_lines(path):
            if m := HEADING.match(line):
                base = slug(m.group(1))
                n = seen.get(base, 0)
                seen[base] = n + 1
                found.add(base if n == 0 else f"{base}-{n}")
            found.update(HTML_ANCHOR.findall(line))
        anchors_by_file[path] = found
    return anchors_by_file[path]


def local_links(line):
    return [t for t in LINK.findall(line) if not re.match(r"[a-z]+:", t)]


def link_errors(md, n, line):
    for target in local_links(line):
        path, _, fragment = target.partition("#")
        dest = os.path.normpath(os.path.join(os.path.dirname(md), path)) if path else md
        if not os.path.exists(dest):
            yield f"LINK {md}:{n}: {target} -> missing {dest}"
        elif fragment and dest.endswith(".md") and fragment not in anchors(dest):
            yield f"ANCHOR {md}:{n}: {target}"


def backticked_paths(line):
    for span in re.findall(r"`([^`\n]+)`", line):
        span = span.strip()
        if span.startswith(REPO_DIRS):
            path = re.split(r"[\s:#]", span)[0].rstrip(".,;)")
            if not any(c in path for c in "*{}<>$[]|?"):
                yield path


def resolves(md, path):
    if os.path.exists(path) or os.path.exists(os.path.join(os.path.dirname(md), path)):
        return True
    # A build or run artifact; the trailing slash matches an ignored directory not yet built.
    ignored = subprocess.run(["git", "check-ignore", path, path + "/"], stdout=subprocess.DEVNULL)
    return ignored.returncode == 0


def main():
    os.chdir(ROOT)
    files = subprocess.check_output(["git", "ls-files", "*.md"], text=True).split()
    bad, links, paths, historical = [], 0, 0, 0
    for md in files:
        lines = unfenced_lines(md)
        for i, line in enumerate(lines):
            links += len(local_links(line))
            bad += link_errors(md, i + 1, line)
            for path in [] if md in PATHS_AS_WRITTEN else backticked_paths(line):
                paths += 1
                if resolves(md, path):
                    continue
                if HISTORICAL.search(" ".join(lines[max(0, i - 2) : i + 3])):
                    historical += 1
                else:
                    bad.append(f"PATH {md}:{i + 1}: `{path}`")
    for error in bad:
        print(error)
    print(f"checked {len(files)} files, {links} links, {paths} backticked paths "
          f"({historical} named beside their commit or removal); {len(bad)} unresolved")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
