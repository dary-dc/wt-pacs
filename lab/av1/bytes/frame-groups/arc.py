#!/usr/bin/env python3
"""Each DBT set's scan arc and projection count, wherever its DICOM header records them (docs/av1/gop-protocol.md §1):
the source fetched and checked against data.json's pin, its header read, the file removed again.

usage: arc.py DATA_DIR OUT.jsonl SET ...   — README.md here
"""
import json
import os
import sys
from pathlib import Path

import pydicom

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from fetch_data import fetch  # noqa: E402

ACQUISITION = 0x00189507
SCAN_ARC = 0x00189508
WANTED = {SCAN_ARC: "scanArc", 0x00189509: "secondaryScanArc", 0x00189514: "primaryIncrement",
          0x00189510: "primaryStartAngle", 0x00189515: "secondaryIncrement", 0x00181150: "exposureTime",
          0x00189547: "projectionCount"}


def found(ds, path=""):
    """Every wanted attribute anywhere in the header, with where it sits."""
    for el in ds:
        if el.VR == "SQ":
            for i, payload in enumerate(el.value):
                yield from found(payload, f"{path}{el.keyword or el.tag}[{i}].")
        elif el.tag in WANTED or el.tag == ACQUISITION:
            yield f"{path}{WANTED.get(el.tag, el.keyword)}", str(el.value)


def main():
    data, out, *sets = sys.argv[1:]
    manifest = {s["name"]: s for s in json.loads((Path(__file__).resolve().parents[2] / "data.json").read_text())["sets"]}
    with open(out, "a") as fh:
        for name in sets:
            row = dict(set=name)
            for entry in manifest[name]["files"]:
                path = fetch(entry, data)
                ds = pydicom.dcmread(path, stop_before_pixels=True)
                row.update(dict(found(ds)))
                row["acquisitionItems"] = len(ds.get("XRay3DAcquisitionSequence", []) or [])
                os.remove(path)
            fh.write(json.dumps(row) + "\n")
            fh.flush()
            print(json.dumps(row), flush=True)


if __name__ == "__main__":
    main()
