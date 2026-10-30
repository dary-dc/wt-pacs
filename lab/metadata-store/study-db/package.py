#!/usr/bin/env python3
"""Run the parser on each fetched series and write what the study DB is built from: one package per series.

usage: package.py DATA PARSER OUT [NAME ...]
DATA as ../repetition/fetch.py writes it, PARSER the ESIPFfiled that ../parser-output/build.sh prints. Per series, in OUT:
  <name>.tar          the group files the parser wrote, at their paths in its tree (pax, sorted, no owner or time)
  <name>.masked.tar   the same with ../parser-output's key mask on the instance and private groups, renamed by BLAKE3
  <name>[.masked].ce  ../parser-output's converted-enhanced records of that package's groups, for ct, pt and mr: the
                      Rust port's reference
"""
import argparse
import io
import json
import os
import sys
import tarfile

import blake3

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "parser-output"))
sys.path.insert(0, os.path.join(HERE, "..", "repetition"))
import measure as split  # noqa: E402
import measure_parser as mp  # noqa: E402


def package(groups: list, path: str) -> None:
    """A deterministic pax tar of (path in the tree, bytes)."""
    with tarfile.open(path, "w", format=tarfile.PAX_FORMAT) as tar:
        for name, data in sorted(groups):
            info = tarfile.TarInfo(name)
            info.size, info.mode, info.mtime = len(data), 0o644, 0
            tar.addfile(info, io.BytesIO(data))


def masked_tree(groups: list) -> list:
    out = []
    for name, kind, data, _ in groups:
        if kind in ("instance", "private"):
            data = b"".join(split.record(k, v) for k, v in mp.masked_group(mp.records(data)))
            name = os.path.join(os.path.dirname(name), name.rsplit("/", 1)[-1].split(".", 1)[0] + "." +
                                blake3.blake3(data).hexdigest())
        out.append((name, data))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("data")
    ap.add_argument("parser")
    ap.add_argument("out")
    ap.add_argument("names", nargs="*")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    manifest = json.load(open(os.path.join(HERE, "..", "repetition", "series.json")))
    for series in manifest["series"]:
        name = series["name"]
        if args.names and name not in args.names:
            continue
        source = os.path.join(args.out, name + ".explicit")
        mp.explicit_copy(os.path.join(args.data, name), source)
        tree = os.path.join(args.out, name + ".tree")
        mp.run_parser(os.path.abspath(args.parser), [os.path.join(source, f) for f in sorted(os.listdir(source))], tree)
        seen = mp.survey(tree)
        package([(n, d) for n, _, d, _ in seen["groups"]], os.path.join(args.out, name + ".tar"))
        package(masked_tree(seen["groups"]), os.path.join(args.out, name + ".masked.tar"))
        if series["modality"] in mp.LEGACY_CONVERTED:
            masked = [{"groups": {lv: mp.masked_group(i["groups"][lv]) for lv in ("instance", "private")}}
                      for i in seen["instances"]]
            for suffix, instances in (("", seen["instances"]), (".masked", masked)):
                recs = mp.converted_enhanced(instances, series["modality"])
                with open(os.path.join(args.out, name + suffix + ".ce"), "wb") as fh:
                    fh.write(b"".join(split.record(k, v) for k, v in recs))
        print(json.dumps({"series": name, "group_files": len(seen["groups"]), "instances": len(seen["instances"])}))


if __name__ == "__main__":
    main()
