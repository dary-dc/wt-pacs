#!/usr/bin/env python3
"""LOSSCLASS: how often a round-trip loss classifier is wrong when the relay knows each drop's cause.
Protocol and rule: docs/transport/transport-conclusions.md §1, R2; the terms fixed before the data: README.md.

    lab/loss-class/run.py [--rounds N] [--first-round K] [--cells a,b] [--ccs cubic-restart,bbr] --out rows.jsonl
    lab/loss-class/run.py --summary --out rows.jsonl [--mutate truth]

A visit is a fresh server (`WTPACS_LOSS_TRACE`: one row per congestion event), a fresh relay
(`link_impair.py --self-timing --drop-log`) and one `window-harness --mode saturate` fill. Each round runs the
(cell, controller) units in a Williams order (lab/scripts/order.py). Env: BIN (target/release), TRACES.
"""
import argparse
import bisect
import json
import os
import re
import statistics
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "lab/scripts"))
from order import order  # noqa: E402

BIN = os.environ.get("BIN", os.path.join(ROOT, "target/release"))
TRACES = os.environ.get("TRACES", os.path.join(ROOT, "lab/.traces"))
LTE = {"TMobile-LTE-short": "4f33dce8dd811b5702272af64aaf64d3913719919abd776edf1e0f7c0965da43",
       "Verizon-LTE-short": "c918436fbd6246af134c76585d9395881fdd27203c59a8902b9a7c675b8a8e3e",
       "TMobile-LTE-driving": "d48ff134fc29c36cc3c3dee203464246bd698f0faede42534a27b0cbe3057055"}
FRAMES, FRAME_BYTES, DWELL_MS, DEPTH = 64, 65536, 12000, 8
# A drop at the relay lands this long after quinn stamps its packet sent, at most (README: the lag).
LAG_NS = 2_000_000
Q_FIXED_MS = (10, 20)


def ge(mean):
    """Gilbert–Elliott in percent, bursts of 3.5 packets on average, as profile_cells.sh."""
    r = 100 / 3.5
    m = mean / 100
    return ["--loss-model", "ge", "--ge-p", "%.5f" % (m * r / (1 - m)), "--ge-r", "%.4f" % r]


def cells():
    """name -> (one-way ms, relay args, kind): kind is what the rule reads the cell as."""
    fixed = ["--rate-kbit", "20000"]
    c = {}
    for q in (20, 500):
        c["of-q%d" % q] = (20, fixed + ["--queue-pkts", str(q)], "overflow")
        for p in (1, 2, 5):
            c["iid%d-q%d" % (p, q)] = (20, fixed + ["--queue-pkts", str(q), "--loss", str(p)], "random-q%d" % q)
            c["ge%d-q%d" % (p, q)] = (20, fixed + ["--queue-pkts", str(q)] + ge(p), "random-q%d" % q)
        for j in (5, 20):
            c["j%d-q%d" % (j, q)] = (20, fixed + ["--queue-pkts", str(q), "--jitter-ms", str(j),
                                                  "--jitter-mode", "ordered"], "jitter")
    lte = lambda f: ["--trace", os.path.join(TRACES, f + ".down")]
    c["lte-good"] = (25, lte("TMobile-LTE-short") + ge(0.01) + ["--queue-ms", "500"], "lte")
    c["lte-loaded"] = (30, lte("Verizon-LTE-short") + ge(0.1) + ["--queue-ms", "1000"], "lte")
    c["lte-moving"] = (35, lte("TMobile-LTE-driving") + ge(0.3) + ["--queue-ms", "500"], "lte")
    return c


def wait_for(path, needle, seconds):
    end = time.time() + seconds
    while time.time() < end:
        if os.path.exists(path) and needle in open(path, errors="replace").read():
            return True
        time.sleep(0.05)
    return False


def setup(t):
    subprocess.run(["openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1",
                    "-keyout", t + "/key.pem", "-out", t + "/cert.pem", "-days", "2", "-nodes", "-subj", "/CN=localhost",
                    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], check=True, capture_output=True)
    os.makedirs(t + "/frames")
    for i in range(FRAMES):
        with open("%s/frames/%03d.htj2k" % (t, i), "wb") as f:
            f.write(os.urandom(FRAME_BYTES))
    with open(t + "/metadata.json", "w") as f:
        json.dump({"frameCount": FRAMES}, f)
    subprocess.run([BIN + "/pack-series", "--metadata", t + "/metadata.json", "--frames", t + "/frames",
                    "--output", t + "/series.sbnd"], check=True, capture_output=True)


def visit(t, rnd, prev, cell, cc):
    one_way, relay_args, kind = cells()[cell]
    srv, front = 30000 + os.getpid() % 5000, 36000 + os.getpid() % 5000
    losses, drops = t + "/losses.jsonl", t + "/drops.log"
    for p in (losses, drops, t + "/server.log", t + "/relay.log"):
        if os.path.exists(p):
            os.remove(p)
    server = subprocess.Popen([BIN + "/series-server", "--port", str(srv), "--series", t + "/series.sbnd",
                               "--cert-pem", t + "/cert.pem", "--key-pem", t + "/key.pem", "--congestion", cc],
                              stdout=open(t + "/server.log", "w"), stderr=subprocess.STDOUT,
                              env={**os.environ, "RUST_LOG": "series_server=info", "WTPACS_LOSS_TRACE": losses})
    relay_cmd = ["python3", os.path.join(ROOT, "lab/scripts/link_impair.py"), "--udp", "%d:%d" % (front, srv),
                 "--delay-ms", str(one_way), "--self-timing", "--drop-log", drops, "--seed", str(rnd)] + relay_args
    relay = subprocess.Popen(relay_cmd, stdout=open(t + "/relay.log", "w"), stderr=subprocess.STDOUT)
    try:
        if not wait_for(t + "/server.log", "wt_url=", 10) or not wait_for(t + "/relay.log", "READY", 10):
            raise SystemExit("server or relay did not start")
        fill = subprocess.run([BIN + "/window-harness", "--url", "https://127.0.0.1:%d/" % front, "--bind", "0.0.0.0",
                               "--mode", "saturate", "--fill-dwell-ms", str(DWELL_MS), "--frame-count", str(FRAMES),
                               "--depth", str(DEPTH), "--read-bps", "0", "--stream-mode", "shared",
                               "--timeout-ms", "60000", "--json"], capture_output=True, text=True, timeout=120)
    finally:
        relay.terminate()
        relay.wait()
        server.terminate()
        server.wait()
    try:
        m = json.loads(fill.stdout)
        mbps = m["fill_bytes"] * 8 / m["fill_dwell_ms"] / 1000
    except (ValueError, KeyError):
        mbps = None
    log = open(t + "/relay.log").read()
    late = re.search(r"late p50 \S+ p99 (\S+)", log)
    return {"round": rnd, "prev": prev, "cell": cell, "kind": kind, "cc": cc, "one_way_ms": one_way,
            "settings": {"server": ["--congestion", cc], "relay": relay_cmd[2:], "fill": ["saturate", DWELL_MS, DEPTH]},
            "mbps": mbps, "void": "VOID" in log, "relay_late_p99_ms": float(late.group(1)) if late else None,
            "relay_tally": [l for l in log.splitlines() if "server->client" in l],
            "losses": [json.loads(l) for l in open(losses)] if os.path.exists(losses) else [],
            "drops": [l.split() for l in open(drops)] if os.path.exists(drops) else []}


def attribute(events, drops, lag_ns=LAG_NS):
    """Each drop to the earliest-declared event whose largest lost packet was sent no earlier than
    the drop arrived, less the lag; each event's truth from its drops. Persistent events stay unclassed."""
    events = sorted(events, key=lambda e: e["now_ns"])
    found = [[] for _ in events]
    unmatched = 0
    for t_ns, cause, _size in drops:
        hit = next((i for i, e in enumerate(events) if e["sent_ns"] >= int(t_ns) - lag_ns), None)
        if hit is None:
            unmatched += 1
        else:
            found[hit].append(cause)
    out = []
    epoch = None
    for e, causes in zip(events, found):
        truth = ("congestion" if {"overflow", "codel"} & set(causes) else "radio" if causes else "none")
        opens = epoch is None or e["sent_ns"] > epoch
        if opens:
            epoch = e["now_ns"]
        out.append({**e, "truth": truth, "opens": opens, "drops": len(causes)})
    return out, unmatched


def lag_after(events, drops):
    """For each event, how long after its largest lost packet's stamp the nearest drop reached the relay."""
    times = sorted(int(t) for t, _, _ in drops)
    out = []
    for e in events:
        i = bisect.bisect_left(times, e["sent_ns"])
        if i < len(times):
            out.append(times[i] - e["sent_ns"])
    return out


def tally_agrees(row):
    """The drop log's count per cause against the relay's own server->client tally."""
    m = re.search(r"server->client sent \d+ lost (\d+) overflowed (\d+) codel (\d+)", " ".join(row["relay_tally"]))
    logged = [sum(c == k for _, c, _ in row["drops"]) for k in ("loss", "overflow", "codel")]
    return bool(m) and logged == [int(x) for x in m.groups()]


def q_stars(e):
    rfc = max(4000, e["min_rtt_us"] / 8)
    return {"rfc9406": rfc, **{"%dms" % q: q * 1000 for q in Q_FIXED_MS}}


def radio_classed(e, q_us):
    return e["rtt_latest_us"] < e["min_rtt_us"] + q_us


def mutate(rows, how):
    if how == "truth":
        swap = {"loss": "overflow", "overflow": "loss"}
        for r in rows:
            r["drops"] = [[t, swap.get(c, c), s] for t, c, s in r["drops"]]
    return rows


def shares(events, q):
    """(congestion classed radio, n congestion, radio classed congestion, n radio) at q*."""
    cr = [radio_classed(e, q_stars(e)[q]) for e in events if e["truth"] == "congestion"]
    rc = [not radio_classed(e, q_stars(e)[q]) for e in events if e["truth"] == "radio"]
    return sum(cr), len(cr), sum(rc), len(rc)


MIN_N = 10


def summary(rows):
    qs = ["rfc9406"] + ["%dms" % q for q in Q_FIXED_MS]
    lines, verdict = [], {}
    for reading, keep in (("strict", lambda r: not r["void"]), ("all visits", lambda r: True)):
        kept = [r for r in rows if keep(r)]
        lines.append("\n== %s: %d of %d visits (%d VOID)" % (reading, len(kept), len(rows), sum(r["void"] for r in rows)))
        by = {}
        lag, unmatched, none = [], 0, 0
        for r in kept:
            ev, un = attribute([e for e in r["losses"] if not e["persistent"]], r["drops"])
            lag += lag_after(r["losses"], r["drops"]) if r["kind"].startswith("random") else []
            unmatched += un
            ev = [e for e in ev if e["opens"]]
            none += sum(e["truth"] == "none" for e in ev)
            by.setdefault((r["cell"], r["cc"]), {"kind": r["kind"], "ev": [], "n": 0, "pers": 0})
            b = by[(r["cell"], r["cc"])]
            b["ev"] += ev
            b["n"] += 1
            b["pers"] += sum(e["persistent"] for e in r["losses"])
        if lag:
            lag.sort()
            over = sum(x > LAG_NS for x in lag) / len(lag)
            lines.append("lag, drop after its event's stamp (random cells): p50 %.2f ms, p99 %.2f ms, n %d; "
                         "%.1f %% over the %.1f ms bar%s" % (lag[len(lag) // 2] / 1e6, lag[int(len(lag) * 0.99)] / 1e6,
                                                           len(lag), 100 * over, LAG_NS / 1e6,
                                                           "  OVER THE 1 % ALLOWED" if over > 0.01 else ""))
        lines.append("visits whose drop log disagrees with the relay's tally: %d" % sum(not tally_agrees(r) for r in kept))
        lines.append("drops matched to no event: %d; epoch-opening events with no drop: %d" % (unmatched, none))
        lines.append("%-12s %-14s %6s %9s %9s %9s  %s" % ("cell", "cc", "visits", "events", "cong", "radio",
                                                         "  ".join("C→R|R→C @" + q for q in qs)))
        ok = {q: True for q in qs}
        judged = {q: True for q in qs}
        for (cell, cc), b in sorted(by.items()):
            nc = sum(e["truth"] == "congestion" for e in b["ev"])
            nr = sum(e["truth"] == "radio" for e in b["ev"])
            cols = []
            for q in qs:
                cr, ncr, rc, nrc = shares(b["ev"], q)
                cols.append("%5s|%5s" % ("%.0f%%" % (100 * cr / ncr) if ncr else "-", "%.0f%%" % (100 * rc / nrc) if nrc else "-"))
                if b["kind"] == "overflow":
                    if ncr >= MIN_N:
                        ok[q] &= cr / ncr <= 0.05
                    elif cc == "cubic-restart":
                        judged[q] = False
                if b["kind"] == "random-q20":
                    if nrc >= MIN_N:
                        ok[q] &= rc / nrc <= 0.30
                    elif cc == "cubic-restart":
                        judged[q] = False
            lines.append("%-12s %-14s %6d %9d %9d %9d  %s" % (cell, cc, b["n"], len(b["ev"]), nc, nr, "  ".join(cols)))
        for q in qs:
            verdict.setdefault(q, []).append("passes" if ok[q] and judged[q] else "fails" if not ok[q] else "not judged")
        lines.append("rule: " + ", ".join("q* %s %s" % (q, verdict[q][-1]) for q in qs))
    lines.append("\nreadings agree: %s" % all(len(set(v)) == 1 for v in verdict.values()))
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rounds", type=int, default=1)
    ap.add_argument("--first-round", type=int, default=0)
    ap.add_argument("--cells", default=",".join(cells()))
    ap.add_argument("--ccs", default="cubic-restart,bbr")
    ap.add_argument("--out", required=True)
    ap.add_argument("--summary", action="store_true")
    ap.add_argument("--mutate", choices=("truth",))
    args = ap.parse_args()
    if args.summary:
        rows = [json.loads(l) for l in open(args.out) if l.strip()]
        print(summary(mutate(rows, args.mutate)))
        return
    for f, sha in LTE.items():
        got = subprocess.run(["sha256sum", os.path.join(TRACES, f + ".down")], capture_output=True, text=True).stdout.split()
        if not got or got[0] != sha:
            raise SystemExit("%s/%s.down: missing or not the pinned trace (README)" % (TRACES, f))
    units = [(c, cc) for c in args.cells.split(",") for cc in args.ccs.split(",")]
    with tempfile.TemporaryDirectory() as t:
        setup(t)
        for rnd in range(args.first_round, args.first_round + args.rounds):
            prev = None
            for cell, cc in order(units, rnd):
                row = visit(t, rnd, prev, cell, cc)
                prev = "%s/%s" % (cell, cc)
                with open(args.out, "a") as f:
                    f.write(json.dumps(row) + "\n")
                print("round %d %-11s %-13s %s Mbit, %d events, %d drops%s" % (
                    rnd, cell, cc, "%.1f" % row["mbps"] if row["mbps"] else "-", len(row["losses"]), len(row["drops"]),
                    " VOID" if row["void"] else ""), flush=True)


if __name__ == "__main__":
    main()
