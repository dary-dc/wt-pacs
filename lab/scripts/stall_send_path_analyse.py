#!/usr/bin/env python3
"""Did the send path change what a stalled client costs the server?

Reads `stall_send_path_probe.sh` output and fits per-connection slopes for **both** memory
measures, because the question is precisely whether one of them is blind:

* `RssAnon` misses anything file-backed. On the `chunked` path the queued frame bytes are
  refcounted slices of the study mmap, so a cost paid there would not appear in it.
* Total `RSS` sees those pages, but it is not a per-connection figure — every connection
  maps the *same* study file, so the pages are shared and the total is bounded by the
  fixture size no matter how many clients stall. Its slope is reported to be *watched*,
  and a large one is the signal that the RssAnon reading was an artefact.

The comparison that decides it is `copy` against `chunked`. `copy` queues a private heap
copy per frame, which is unambiguously anonymous; if the flat `chunked` line were an
artefact of the metric, `copy` would have to show the cost that `chunked` hides.
"""
import sys
from collections import defaultdict


def load(path):
    rows = [l.rstrip("\n").split("\t") for l in open(path) if l.strip()]
    return [dict(zip(rows[0], r)) for r in rows[1:]]


def fit(xs, ys):
    n = len(xs)
    if n < 2:
        return float("nan"), float("nan")
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx == 0:
        return float("nan"), float("nan")
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    intercept = my - slope * mx
    ss_res = sum((y - (slope * x + intercept)) ** 2 for x, y in zip(xs, ys))
    ss_tot = sum((y - my) ** 2 for y in ys)
    return slope, (1 - ss_res / ss_tot if ss_tot else float("nan"))


def main(path):
    rows = load(path)
    good = [r for r in rows if r.get("void") != "1"]
    void = [r for r in rows if r.get("void") == "1"]
    if void:
        print(f"VOID — {len(void)} row(s) excluded:")
        seen = defaultdict(int)
        for r in void:
            seen[(r["send_path"], r["stream_mode"], r["void_reason"])] += 1
        for (sp, sm, why), k in sorted(seen.items()):
            print(f"  send_path={sp:8s} stream={sm:9s} n={k:2d}  {why}")
        print()

    by = defaultdict(list)
    for r in good:
        by[(r["send_path"], r["stream_mode"])].append(
            (int(r["clients"]), int(r["srv_delta_anon_kb"]),
             int(r["srv_delta_rss_kb"]), int(r["cli_anon_kb"]))
        )

    fits = {}
    print(f"{'send_path':10s} {'stream':10s} {'srv anon/conn':>14s} {'srv RSS/conn':>13s} {'client/conn':>12s}")
    for key in sorted(by):
        pts = by[key]
        a, ar = fit([p[0] for p in pts], [p[1] for p in pts])
        t, tr = fit([p[0] for p in pts], [p[2] for p in pts])
        c, cr = fit([p[0] for p in pts], [p[3] for p in pts])
        fits[key] = (a, t, c)
        print(f"{key[0]:10s} {key[1]:10s} {a:11.1f} kB {t:10.1f} kB {c:9.1f} kB"
              f"   (r2 anon {ar:.3f} / rss {tr:.3f})")
    print()

    # TWO questions, never run together: is RssAnon blind (anon vs RSS WITHIN an arm), and does
    # the send path matter (copy vs chunked, in whichever measure the first showed trustworthy).
    print("=== (a) is RssAnon blind? anon vs total RSS slope, within each arm " + "=" * 3)
    blind = False
    for key in sorted(fits):
        a, t, _ = fits[key]
        ratio = t / a if a else float("nan")
        flag = "  <-- RSS outruns anon: file-backed cost is being missed" if ratio > 1.5 else ""
        blind |= ratio > 1.5
        print(f"  {key[0]:8s} {key[1]:9s}  anon {a:8.1f} kB   RSS {t:8.1f} kB   RSS/anon {ratio:4.2f}{flag}")
    print()
    if blind:
        print("  VERDICT: RssAnon is missing file-backed queueing. The campaign's server")
        print("  figures understate the cost and must be re-read against total RSS.")
    else:
        print("  VERDICT: the two measures agree in every arm, so RssAnon is not blind here")
        print("  and the campaign's server figures stand as measured.")
    print()

    print("=== (b) does the send path matter? copy vs chunked " + "=" * 18)
    for sm in sorted({k[1] for k in fits}):
        ch, cp = fits.get(("chunked", sm)), fits.get(("copy", sm))
        if not ch or not cp:
            continue
        print(f"  {sm:9s}  chunked {ch[0]:8.1f} kB   copy {cp[0]:8.1f} kB   "
              f"copy/chunked {cp[0] / ch[0]:5.1f}x")
    print()
    print("  `chunked` queues refcounted slices of one shared mapping; `copy` and `split`")
    print("  leave quinn holding a private copy per connection. A large ratio here is a")
    print("  real difference in what the server retains, not a difference in what is seen.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1
         else ".local/measurements/mem/stall_send_path.tsv")
