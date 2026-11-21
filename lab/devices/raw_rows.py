#!/usr/bin/env python3
"""The round's raw files, made fit for a public repository: only what a cell reads (docs/devices.md §4).

  python3 lab/devices/raw_rows.py DEST SRC... --strip VALUE=NAME [--strip VALUE=NAME]
"""

import argparse
import re
import shutil
import sys
import tempfile
from pathlib import Path

WIFI_FIELDS = ("Wi-Fi standard", "RSSI", "Link speed", "Tx Link speed", "Rx Link speed", "Frequency")
COMPONENT = re.compile(r"(?:c2|OMX)\.[A-Za-z0-9._-]+")
LEAK = re.compile(r"(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}|SSID")


def band(mhz: int) -> str:
    return "2.4 GHz" if mhz < 2500 else "5 GHz" if mhz < 5925 else "6 GHz"


def wifi(text: str) -> str:
    """Each `mWifiInfo` line (AOSP's WifiInfo.toString()) as its band and WIFI_FIELDS; every other line dropped."""
    rows = []
    for line in text.splitlines():
        if "mWifiInfo" not in line:
            continue
        fields = dict(f.split(": ", 1) for f in line.split(", ") if ": " in f)
        kept = [f"{k}: {fields[k]}" for k in WIFI_FIELDS if k in fields]
        mhz = re.match(r"\d+", fields.get("Frequency", ""))
        rows.append(", ".join(([f"band: {band(int(mhz[0]))}"] if mhz else []) + kept))
    return "".join(r + "\n" for r in rows)


def codecs(text: str) -> str:
    return "".join(c + "\n" for c in COMPONENT.findall(text))


def filtered(path: Path, text: str) -> str:
    if "wifi" in path.name:
        return wifi(text)
    if "logcat" in path.name or path.name == "media.player.txt":
        return codecs(text)
    return text


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dest", type=Path)
    ap.add_argument("src", type=Path, nargs="+")
    ap.add_argument("--strip", action="append", default=[], help="VALUE=NAME, VALUE never empty")
    a = ap.parse_args()
    strips = [s.split("=", 1) for s in a.strip]
    if any(len(s) != 2 or not s[0].strip() for s in strips):
        ap.error(f"--strip needs VALUE=NAME with VALUE set: {a.strip}")
    leaks = []
    with tempfile.TemporaryDirectory() as tmp:
        for src in (s for s in a.src if s.exists()):
            files = [src] if src.is_file() else [f for f in src.rglob("*") if f.is_file()]
            for f in files:
                text = filtered(f, f.read_text(errors="replace"))
                for value, name in strips:
                    text = text.replace(value, name)
                out = Path(tmp) / src.name / f.relative_to(src) if src.is_dir() else Path(tmp) / f.name
                leaks += [f"{out.relative_to(tmp)}:{n}" for n, line in enumerate(text.splitlines(), 1) if LEAK.search(line)]
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_text(text)
        if leaks:
            print("refused, a MAC or an SSID left:\n  " + "\n  ".join(leaks), file=sys.stderr)
            return 1
        shutil.copytree(tmp, a.dest, dirs_exist_ok=True)
    print(f"{a.dest}: {sum(1 for f in a.dest.rglob('*') if f.is_file())} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
