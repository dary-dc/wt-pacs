#!/usr/bin/env python3
"""docs/native/README.md §The interim run: M2's fill cells with native-window on each paint thread in place of
native-fill, against the browser at the core's default view. That section holds the predictions, the rule and the reading.

    run.py --series DIR --rounds 7 --out lab/native-window/rows.jsonl   # DIR from lab/native-fill/run.py --make-series
    run.py --summary --out lab/native-window/rows.jsonl
"""
import argparse
import importlib.util
import json
import os
import re
import statistics
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("m2", os.path.join(HERE, "..", "native-fill", "run.py"))
m2 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m2)

ARMS = ("ui", "view", "core", "browser")
WINDOWS = ARMS[:3]
SERIES = ("large", "small")
LINKS = ("loopback", "20M")
CANVAS = "1280x691"
BUDGET = 256 << 20  # holds either series decoded, so the want is the whole series
# The rule's bands, and the A/A's VOID at half of each.
EARLIER_RATIO, EARLIER_MS = 0.9, 16.7
FILL_LOOPBACK, FILL_RELAY = 0.6, 0.03
VOID_AA = {("first", "loopback"): 0.05, ("first", "20M"): 0.05, ("fill", "loopback"): 0.20, ("fill", "20M"): 0.015}
CLIENT_SATURATED, RELAY_SATURATED, MIN_PAIRS = 0.9, 0.8, 3


def cells():
    return [f"fill/{s}/{link}/0" for s in SERIES for link in LINKS]


def units():
    return [f"{c}/{a}/{k}" for c in cells() for a in ARMS for k in ("A", "A2")]


browser_cmd, browser_parse = m2.client_cmd, m2.parse


def client_cmd(arm, kind, series, url, a):
    if arm == "browser":
        return browser_cmd(arm, kind, series, url, a)
    return [f"{m2.BIN}/native-window", "--url", url, "--cert-sha256", a.cert, "--bundle", f"{a.series}/{series}.sbnd",
            "--paint-thread", arm, "--budget", str(BUDGET), "--size", CANVAS, "--stamp-painted", "--exit"]


def parse(arm, kind, out, end):
    if arm == "browser":
        r = browser_parse(arm, kind, out, end)
        r["first_exact_ms"] = json.loads(out.strip().splitlines()[-1])["first_exact_ms"]
        return r
    lines = out.strip().splitlines()
    v = dict(re.findall(r"(\w+)=(\S+)", next(line for line in lines if line.startswith("visit "))))
    ms = {k: float(v[k]) for k in ("first_exact_ms", "first_shown_ms", "last_exact_ms", "inter_arrival_p99_ms")}
    exact, frames = map(int, v["exact"].split("/"))
    failed = [line for line in lines if line.startswith("failed ") or "exact=false" in line or "refused=" in line]
    return {"frames": frames, "exact": exact if not failed else 0, "from_dial_ms": ms["last_exact_ms"], "shown_ms": ms["first_shown_ms"],
            "first_exact_ms": ms["first_exact_ms"], "inter_arrival_p99_ms": ms["inter_arrival_p99_ms"],
            "settings": [line for line in lines if line.startswith(("renderer ", "decoders="))],
            "window": (end - ms["last_exact_ms"] / 1e3, end)}


def run(a):
    m2.client_cmd, m2.parse = client_cmd, parse
    os.makedirs(a.work, exist_ok=True)
    a.cert = m2.make_cert(a.work)
    clients = ",".join(map(str, m2.CLIENT_CPUS))
    xvfb = subprocess.Popen(["taskset", "-c", clients, "Xvfb", "-displayfd", "1", "-noreset", "-screen", "0", "1920x1080x24"],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    os.environ["DISPLAY"] = f":{xvfb.stdout.readline().strip()}"
    os.environ.setdefault("VK_ICD_FILENAMES", "/usr/share/vulkan/icd.d/lvp_icd.json")
    statics = {s: m2.start_static(a, s) for s in SERIES}
    a.static = {s: url for s, (_, url) in statics.items()}
    log_path = f"{a.out}.server.log"
    try:
        with open(a.out, "a") as out:
            for rnd in range(a.first_round, a.first_round + a.rounds):
                for pos, unit in enumerate(u for u in m2.order(units(), rnd) if a.only in u):
                    server = m2.start_server(a, unit.split("/")[1], log_path)
                    try:
                        row = m2.visit(unit, a)
                    finally:
                        server.terminate()
                        server.wait()
                    row.update(round=rnd, pos=pos)
                    if pos == 0:
                        row["server_banner"] = [line.strip().replace(m2.ROOT + "/", "") for line in open(log_path) if re.match(r"^[a-z_]+=", line)]
                    out.write(json.dumps(row) + "\n")
                    out.flush()
                    print(rnd, pos, unit, row.get("shown_ms"), row.get("from_dial_ms"), f"{row.get('exact')}/{row.get('frames')}",
                          row.get("busy"), "VOID" if row["void"] else "", row.get("error", "")[:200], flush=True)
    finally:
        for p, _ in statics.values():
            p.terminate()
        xvfb.terminate()


def med(v):
    return statistics.median(v) if v else float("nan")


def metric(r, name):
    """`first`: the dial to the first exact frame on screen; `fill`: the first exact frame to the last."""
    return r["shown_ms"] if name == "first" else r["from_dial_ms"] - r["first_exact_ms"]


def judge(rows):
    """Per cell, native paint thread and metric: the round-paired ratio to the browser, its label and its reading."""
    bad = [r for r in rows if "error" in r or r["exact"] != r["frames"] or r["frames"] != m2.SERIES[r["series"]][5]]
    at = {(r["round"], r["unit"]): r for r in rows if r not in bad and not r["void"]}
    rounds = sorted({r["round"] for r in rows})
    out = []
    for cell in cells():
        link = cell.split("/")[2]
        busy = {arm: [r["busy"] for r in rows if r["unit"].startswith(f"{cell}/{arm}/") and "busy" in r] for arm in ARMS}
        for name in ("first", "fill"):
            def get(n, arm, c):
                r = at.get((n, f"{cell}/{arm}/{c}"))
                return r and metric(r, name)

            aa = {arm: med([get(n, arm, "A2") / get(n, arm, "A") for n in rounds if get(n, arm, "A") and get(n, arm, "A2")]) for arm in ARMS}
            for arm in WINDOWS:
                pairs = [(get(n, arm, c), get(n, "browser", c)) for n in rounds for c in ("A", "A2") if get(n, arm, c) and get(n, "browser", c)]
                ratio, earlier = med([x / b for x, b in pairs]), med([b - x for x, b in pairs])
                void = [x for x in (arm, "browser") if not abs(aa[x] - 1) <= VOID_AA[(name, link)]]
                saturated = [x for x in (arm, "browser") if busy[x] and (med([b["client"] for b in busy[x]]) >= CLIENT_SATURATED
                                                                        or link != "loopback" and med([b["relay"] for b in busy[x]]) >= RELAY_SATURATED)]
                if name == "first":
                    holds = ratio <= EARLIER_RATIO and earlier >= EARLIER_MS
                else:
                    holds = ratio <= FILL_LOOPBACK if link == "loopback" else abs(ratio - 1) <= FILL_RELAY
                label = ("undecided" if len(pairs) < MIN_PAIRS else "VOID" if void else "saturated" if saturated
                         else "holds" if holds else "fails")
                out.append({"cell": cell, "metric": name, "arm": arm, "n": len(pairs), "ratio": ratio, "earlier_ms": earlier,
                            "aa": {x: aa[x] for x in (arm, "browser")}, "void": void, "saturated": saturated, "label": label})
    return bad, out


def verdict(judged):
    """Per paint thread: M2's reading holds for the window if every decided cell holds and at least one is decided."""
    lines = []
    for arm in WINDOWS:
        decided = [j for j in judged if j["arm"] == arm and j["label"] in ("holds", "fails")]
        failed = [f"{j['cell']} {j['metric']}" for j in decided if j["label"] == "fails"]
        lines.append(f"{arm}: " + ("undecided: no decided cell" if not decided else
                                   f"M2's reading does not hold ({', '.join(failed)})" if failed else
                                   f"M2's reading holds in {len(decided)} decided cells"))
    return lines


def summary(a):
    rows = [json.loads(line) for line in open(a.out)]
    bad, judged = judge(rows)
    print(f"{len(rows)} visits; {len(bad)} failed; {sum(r['void'] for r in rows)} VOID by the relay's p99")
    for r in bad:
        print("  failed:", r["round"], r["unit"], r.get("error", "")[:300] or f"{r.get('exact')}/{r.get('frames')}")
    for j in judged:
        print(f"{j['cell']} {j['metric']:5} {j['arm']:4} ÷ browser {j['ratio']:.3f}, {j['earlier_ms']:+.1f} ms earlier, n={j['n']}; "
              f"A/A {j['aa'][j['arm']]:.3f} · {j['aa']['browser']:.3f}  {j['label']}"
              + (f" (A/A: {', '.join(j['void'])})" if j["void"] else "") + (f" (busy: {', '.join(j['saturated'])})" if j["saturated"] else ""))
    for cell in cells():
        for arm in ARMS:
            s = [r for r in rows if r["unit"].startswith(f"{cell}/{arm}/") and "busy" in r]
            if s:
                p99 = [r["inter_arrival_p99_ms"] for r in s if "inter_arrival_p99_ms" in r]
                print(f"{cell} {arm}: first {med([metric(r, 'first') for r in s]):.1f} ms, fill after it {med([metric(r, 'fill') for r in s]):.1f} ms; "
                      f"client cores {med([r['busy']['client'] for r in s]):.2f} (max {max(r['busy']['client'] for r in s):.2f}) of 2, "
                      f"server {med([r['busy']['server'] for r in s]):.2f}, relay {max(r['busy']['relay'] for r in s):.2f} max"
                      + (f"; inter-arrival p99 {med(p99):.2f} ms" if p99 else ""))
    print("\n".join(["verdict:"] + verdict(judged)))


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--series", help="the directory lab/native-fill/run.py --make-series wrote")
    p.add_argument("--work", default="/tmp/native-window", help="cert and transport files")
    p.add_argument("--rounds", type=int, default=7)
    p.add_argument("--first-round", type=int, default=0)
    p.add_argument("--summary", action="store_true")
    p.add_argument("--out")
    p.add_argument("--only", default="", help="run only the units containing this, for a smoke or a mutant")
    a = p.parse_args()
    summary(a) if a.summary else run(a)
