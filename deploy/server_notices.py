#!/usr/bin/env python3
"""deploy/server_notices.py — the licence notices of every crate series-server links, into deploy/THIRD_PARTY_NOTICES.

  deploy/server_notices.py           write it from Cargo.lock and each crate's own licence files
  deploy/server_notices.py --check   fail unless it is what Cargo.lock ships now (gate.sh)

What it covers and why: docs/av1/licensing.md §The server.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NOTICES = ROOT / "deploy" / "THIRD_PARTY_NOTICES"
STANDARD_TEXTS = ROOT / "deploy" / "licence-texts"
SPDX_RELEASE = "SPDX License List v3.29.0"
TARGETS = ("x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu")
LICENCE_FILE = re.compile(r"(licen[cs]e|copying|copyright|notice|unlicense)", re.I)
NOT_AN_ID = {"OR", "AND", "WITH"}


def cargo(*args):
    return subprocess.run(["cargo", *args, "--locked"], cwd=ROOT, check=True, capture_output=True, text=True).stdout


def shipped():
    """(name, version) of every crate in series-server's normal graph on a shipped target."""
    crates = set()
    for target in TARGETS:
        tree = cargo("tree", "-p", "series-server", "-e", "normal", "--target", target, "--prefix", "none", "-f", "{p}")
        for line in tree.splitlines():
            name, version = line.split()[:2]
            crates.add((name, version.removeprefix("v")))
    return crates


def version_key(package):
    return package["name"], [int(n) for n in re.findall(r"\d+", package["version"])]


def licence_texts(package):
    """[(label, text)] and whether they are standard texts: the crate's own licence files, else each licence it names."""
    home = Path(package["manifest_path"]).parent
    files = sorted(f for f in home.iterdir() if f.is_file() and LICENCE_FILE.match(f.name))
    if files:
        return [(f.name, f.read_text(encoding="utf-8", errors="replace")) for f in files], False
    ids = sorted(set(re.findall(r"[\w.+-]+", package["license"] or "")) - NOT_AN_ID)
    missing = [i for i in ids if not (STANDARD_TEXTS / f"{i}.txt").is_file()]
    if not ids or missing:
        sys.exit(f"{package['name']} {package['version']} ships no licence file and deploy/licence-texts has no {missing or 'licence'}")
    return [(f"{i} ({SPDX_RELEASE})", (STANDARD_TEXTS / f"{i}.txt").read_text(encoding="utf-8")) for i in ids], True


def render():
    metadata = json.loads(cargo("metadata", "--format-version", "1"))
    ours = set(metadata["workspace_members"])
    wanted = shipped()
    packages = sorted((p for p in metadata["packages"] if (p["name"], p["version"]) in wanted and p["id"] not in ours), key=version_key)

    texts, rows = {}, []
    for p in packages:
        numbers, (found, standard) = [], licence_texts(p)
        for label, text in found:
            text = text.replace("\r\n", "\n").strip() + "\n"
            entry = texts.setdefault(text, (len(texts) + 1, []))
            entry[1].append(f"{p['name']} {p['version']} {label}")
            numbers.append(str(entry[0]))
        unfiled = f"; ships no licence file, so the standard text; authors: {', '.join(p['authors'])}" if standard else ""
        rows.append(f"{p['name']} {p['version']}  {p['license']}  texts {', '.join(numbers)}{unfiled}")

    out = [
        "Third-party notices for series-server: every crate it links, from Cargo.lock,",
        f"for {' and '.join(TARGETS)}. Written by deploy/server_notices.py; docs/av1/licensing.md §The server.",
        "",
        f"{len(packages)} crates: name, version, licence expression, and the texts below that each ships.",
        "",
        *rows,
    ]
    for text, (number, sources) in texts.items():
        out += ["", f"==== text {number}, from: {'; '.join(sources)} ====", "", text.rstrip("\n")]
    return "\n".join(out) + "\n", len(packages), len(texts)


def main():
    body, crates, distinct = render()
    if sys.argv[1:] == ["--check"]:
        if not NOTICES.is_file() or NOTICES.read_text(encoding="utf-8") != body:
            sys.exit("deploy/THIRD_PARTY_NOTICES is not what Cargo.lock ships: run deploy/server_notices.py")
        print(f"deploy/THIRD_PARTY_NOTICES is current: {crates} crates, {distinct} distinct licence texts")
    elif not sys.argv[1:]:
        NOTICES.write_text(body, encoding="utf-8")
        print(f"wrote deploy/THIRD_PARTY_NOTICES: {crates} crates, {distinct} distinct licence texts")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
