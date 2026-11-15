#!/usr/bin/env python3
"""§6 Fitting a session, from the pilot: a full round's wall time per throttle, *derived* — each pilot unit's clocks on
dbts_a1, scaled to a series by its pixels a frame (and its frames, for the series clock), and on a link no shorter
than its bytes ÷ rate; then the rounds that fit the cap, with the protocol's drops applied in its order.

usage: decode_fit.py PILOT.json WORK [--hours 5]
"""
import json
import statistics as st
import sys
from pathlib import Path

RATES = {"none": 0, "5": 5e6, "50": 50e6}
SETS = ("dbts_a1", "dbts_b1", "dbts_c1")


def main():
    rows = json.load(open(sys.argv[1]))
    work = Path(sys.argv[2])
    hours = float(sys.argv[sys.argv.index("--hours") + 1]) if "--hours" in sys.argv else 5.0
    e = {s: json.loads((work / f"{s}.json").read_text()) for s in SETS}
    a1 = e["dbts_a1"]
    px = {s: e[s]["width"] * e[s]["height"] / (a1["width"] * a1["height"]) for s in SETS}
    rank = {q: i for i, q in enumerate(sorted({c["q"] for c in a1["cells"]}))}

    def pilot(arm, dec, r, throttle):
        """Median over pilot rounds of each clock's total ms, and of the unit's wall s outside its clocks."""
        rs = [x for x in rows if x["arm"] == arm and x["dec"] == dec and x["throttle"] == throttle
              and (x["q"] is None or rank[x["q"]] == r) and not x.get("error")]
        tot = lambda f: st.median([f(x["clocks"]) for x in rs])
        frame = tot(lambda c: sum(c["frame"]))
        ask = tot(lambda c: sum(v for v in c.get("ask", {}).values() if v)) if arm[0] == "S" else 0
        series = tot(lambda c: c.get("series", 0))
        other = st.median([x["wall"] * 1000 - sum(x["clocks"]["frame"]) - sum(v for v in x["clocks"].get("ask", {}).values() if v)
                           - x["clocks"].get("series", 0) for x in rs])
        return frame, ask, series, other

    def unit(s, arm, dec, r, link, throttle, series_on):
        frame, ask, series, other = pilot(arm, dec, r, throttle)
        k, kn = px[s], px[s] * e[s]["frames"] / a1["frames"]
        rate = RATES[link]
        cell = None
        if arm not in ("H", "L"):
            form = f"{e[s]['bits']}bit" if e[s]["bits"] <= 10 or dec == "dav1d" else "top10"
            g = {"S1": 1, "S8": 8, "S16": 16, "SW": e[s]["frames"], "R": 16, "W": 16}[arm]
            q = sorted({c["q"] for c in e[s]["cells"]})[r]
            cell = next(c for c in e[s]["cells"] if c["form"] == form and c["q"] == q and c["g"] == g)
        sizes = (e[s]["htj2k"] if arm in ("H", "W") else e[s]["lossless"] if arm == "L"
                 else cell["residual_units"] if arm == "R" else cell["units"])
        m = e[s]["middle"]
        t = lambda b: sum(b) * 8 * 1000 / rate if rate else 0
        ms = max(frame * k, t(sizes[m:m + 16])) + other * k
        if arm[0] == "S":
            g = cell["g"]
            ms += sum(max(ask / 16 * k, t(sizes[i - i % g:i + 1])) for i in range(m, m + 16))
        if series_on:
            ms += max(series * kn, t(sizes))
        return ms / 1000

    def round_s(throttle, links, series):
        total = 0
        for s in SETS:
            ranks = range(len({c["q"] for c in e[s]["cells"]}))
            for link in links:
                arms = [("H", "openjph", 0)] + [("L", d, 0) for d in ("dav1d", "webcodecs")]
                arms += [(a, d, r) for r in ranks for d in ("dav1d", "webcodecs") for a in ("S1", "S8", "S16", "SW", "R", "W")]
                for arm, dec, r in arms:
                    on = series(s, arm, dec, throttle)
                    total += unit(s, arm, dec, r, link, throttle, on)
        return total

    every = lambda s, arm, dec, t: arm != "W"
    b1_l = lambda s, arm, dec, t: (s, arm, dec, t) == ("dbts_b1", "L", "dav1d", 4)
    for name, links, series in (("as written", ("none", "5", "50"), every),
                                ("whole series to L dav1d 4x dbts_b1", ("none", "5", "50"), b1_l),
                                ("then 50 Mbit/s dropped", ("none", "5"), b1_l)):
        r1, r4 = round_s(1, links, series), round_s(4, links, series)
        n = int(hours * 3600 // (r1 + r4))
        print(f"{name}: a round {r1 / 60:.0f} min at 1x + {r4 / 60:.0f} min at 4x = {(r1 + r4) / 3600:.2f} h; "
              f"{n} rounds fit {hours:g} h")


if __name__ == "__main__":
    main()
