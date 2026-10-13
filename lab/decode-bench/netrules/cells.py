#!/usr/bin/env python3
"""Row NETMEASURE's raw rounds as lab/scripts/aa_rule.py's cells, judged: one line a cell, both readings where a
visit was VOID (strict drops the round in all three arms; round-paired keeps it).

    cells.py CAMPAIGN [--confirm TAG] [--bar 0.05]      CAMPAIGN as run.sh names it — lab/decode-bench/netrules/README.md
"""
import glob
import json
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "scripts"))
from aa_rule import judge  # noqa: E402

RAW = HERE / "raw"
# Each campaign's arms (A, A′, then the levers judged against them) and what a visit's value is.
ARMS = {"emsdk-frame": ("ojph-del-3.1.74", "ojph-delcopy-3.1.74", ["ojph-em6-6.0.11"]),
        "copy-frame": ("del", "delcopy", ["copy", "pt"]), "copy-memory": ("del", "delcopy", ["copy", "pt"]),
        "emsdk-net": ("del", "delcopy", ["em6"]), "start-net": ("del", "delname", ["need"]),
        "copy-net": ("del", "delcopy", ["copy"])}


def frame_rows(tag):
    """A frame: the round's median ms a frame for each (engine, set, throttle, arm); every frame exact or no value."""
    for f in sorted(glob.glob(str(RAW / f"{tag}-*.json"))):
        for r in json.load(open(f)):
            ok = not r.get("error") and r["exact"] == r["frames"] and r["ms"]
            yield (r.get("engine", "chromium"), r["set"], f"{r['throttle']}x"), r["round"], r["variant"], \
                {"ms": statistics.median(r["ms"]) if ok else None}, False


def memory_rows(tag):
    for f in sorted(glob.glob(str(RAW / f"{tag}-*.json"))):
        for r in json.load(open(f)):
            yield (r["engine"], r["set"]), r["round"], r["variant"], {"peakMB": r["peakKb"] / 1024 if r.get("kept") else None}, False


def net_rows(tag):
    """A fill (every frame on the page) and a cold ask (frame 0, the session's first work), with the decoders' work."""
    for mode in ("fill", "ask"):
        p = RAW / f"{tag}-{mode}.jsonl"
        if not p.exists():
            continue
        for line in open(p):
            r = json.loads(line)
            ok = r["exact"] == r["owed"] and not r.get("failures")
            v = {"fill": r.get("decodedMs") if mode == "fill" else (r.get("afterMs") or [None])[0]}
            if mode == "fill" and ok:
                v.update(cpuMs=r.get("cpuMs"), wakes=r.get("wakes"), decoders=r.get("decodersUsed"))
            yield (mode, r["set"], r["link"], f"{r['throttle']}x"), r["round"], r["variant"], \
                {k: (x if ok else None) for k, x in v.items()}, r["void"]


def cells(tag, campaign):
    rows = memory_rows(tag) if campaign == "copy-memory" else frame_rows(tag) if campaign.endswith("frame") else net_rows(tag)
    by = {}
    for key, rnd, arm, values, void in rows:
        for metric, x in values.items():
            by.setdefault((key, metric), {}).setdefault(rnd, {})[arm] = (x, void)
    ref, aa, levers = ARMS[campaign]
    out = {"strict": {}, "paired": {}}
    for (key, metric), rounds in sorted(by.items(), key=lambda kv: str(kv[0])):
        for lever in levers:
            name = " ".join(key) + f" {metric} {lever}"
            for reading in out:
                c = {"ref": [], "aa": [], "arm": []}
                for rnd in sorted(rounds):
                    got = [rounds[rnd].get(a, (None, False)) for a in (ref, aa, lever)]
                    if reading == "strict" and any(v for _, v in got):
                        got = [(None, True)] * 3
                    for slot, (x, _) in zip(("ref", "aa", "arm"), got):
                        c[slot].append(x)
                if sum(None not in t for t in zip(*c.values())) >= 3:
                    out[reading][name] = c
    return out


def main(argv):
    campaign = argv[0]
    bar = float(argv[argv.index("--bar") + 1]) if "--bar" in argv else 0.05
    first = cells(campaign, campaign)
    second = cells(argv[argv.index("--confirm") + 1], campaign) if "--confirm" in argv else None
    voids = any(None in c["ref"] for c in first["paired"].values()) or first["strict"] != first["paired"]
    for reading in ("strict", "paired") if voids else ("strict",):
        judged = judge(first[reading], second and second[reading], bar)
        for name, j in judged.items():
            print(f"{reading:6s} {name:52s} n={j['n']:2d} arm×{j['arm']:.3f} A′×{j['aa']:.3f} sd {j['sd']:.3f} "
                  f"mdl {j['mdl']:+.1%} {j['verdict']}")


if __name__ == "__main__":
    main(sys.argv[1:])
