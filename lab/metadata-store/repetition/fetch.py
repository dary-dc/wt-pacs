#!/usr/bin/env python3
"""Fetch the measured series from The Cancer Imaging Archive and check every file against series.json.

usage: fetch.py OUT [NAME ...]        OUT/<name>/<file> per series; a mismatch exits non-zero
       fetch.py --pin OUT [NAME ...]  write the fetched files' SHA-256 into series.json instead of checking
"""
import hashlib
import io
import json
import os
import sys
import urllib.request
import zipfile

NBIA = "https://services.cancerimagingarchive.net/nbia-api/services/v1/getImage?SeriesInstanceUID="
MANIFEST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "series.json")


def fetch(series: dict, out: str, pin: bool) -> None:
    folder = os.path.join(out, series["name"])
    if not os.path.isdir(folder):
        with urllib.request.urlopen(NBIA + series["series_uid"], timeout=600) as r:
            archive = zipfile.ZipFile(io.BytesIO(r.read()))
        os.makedirs(folder + ".part", exist_ok=True)
        for member in archive.namelist():
            if member.endswith(".dcm"):
                with open(os.path.join(folder + ".part", os.path.basename(member)), "wb") as fh:
                    fh.write(archive.read(member))
        os.replace(folder + ".part", folder)
    got = {}
    for name in sorted(os.listdir(folder)):
        with open(os.path.join(folder, name), "rb") as fh:
            got[name] = hashlib.sha256(fh.read()).hexdigest()
    if pin:
        series["files"] = got
    elif got != series["files"]:
        sys.exit(f"{series['name']}: {len(got)} files fetched do not match the {len(series['files'])} pinned")
    print(f"{series['name']}: {len(got)} files {'pinned' if pin else 'match'}")


def main() -> None:
    args = sys.argv[1:]
    pin = args[:1] == ["--pin"]
    out, names = args[pin], args[pin + 1:]
    manifest = json.load(open(MANIFEST))
    for series in manifest["series"]:
        if not names or series["name"] in names:
            fetch(series, out, pin)
    if pin:
        with open(MANIFEST, "w") as fh:
            json.dump(manifest, fh, indent=1)
            fh.write("\n")


if __name__ == "__main__":
    main()
