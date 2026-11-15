#!/usr/bin/env python3
"""The interim run's rule on made-up rows: python3 lab/native-window/run_test.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from run import ARMS, cells, judge, verdict  # noqa: E402

FRAMES = {"large": 37, "small": 102}
# Per arm, the first exact frame on screen and the fill after it, in ms: the window well ahead of the browser.
TIMES = {"ui": (60, 300), "view": (60, 300), "core": (60, 300), "browser": (300, 700)}


def rows(times=TIMES, rounds=4, busy=0.5, change=lambda r: r):
    out = []
    for n in range(rounds):
        for cell in cells():
            _, series, link, _ = cell.split("/")
            relay = link != "loopback"
            for arm in ARMS:
                for c in ("A", "A2"):
                    first, fill = times[arm]
                    if relay:
                        first, fill = first + 200, 25000 * (1.01 if arm == "ui" else 1)
                    r = {"unit": f"{cell}/{arm}/{c}", "series": series, "round": n, "void": False, "frames": FRAMES[series],
                         "exact": FRAMES[series], "shown_ms": first, "first_exact_ms": first - 20, "from_dial_ms": first - 20 + fill,
                         "busy": {"client": busy, "relay": 0.3, "server": 0.2}}
                    out.append(change(r))
    return out


def labels(judged, **match):
    return {j["label"] for j in judged if all(j[k] == v for k, v in match.items())}


def test_a_clear_case_holds():
    """The window well ahead on loopback and tied at 20 Mbit holds in every cell; ui's fill 1 % slower still ties."""
    bad, judged = judge(rows())
    assert not bad and labels(judged) == {"holds"}, {(j["cell"], j["metric"], j["arm"]): j["label"] for j in judged}
    assert all(line.endswith("holds in 8 decided cells") for line in verdict(judged)), verdict(judged)


def test_a_relay_fill_past_three_percent_fails():
    """At 20 Mbit a fill 5 % faster than the browser's is not a tie: the cell fails and so does the verdict."""
    def faster(r):
        if r["unit"].startswith("fill/large/20M/0/view/"):
            r["from_dial_ms"] = r["first_exact_ms"] + 25000 * 0.95
        return r
    _, judged = judge(rows(change=faster))
    assert labels(judged, cell="fill/large/20M/0", metric="fill", arm="view") == {"fails"}
    assert "does not hold (fill/large/20M/0 fill)" in verdict(judged)[1], verdict(judged)


def test_a_first_frame_needs_both_bars_to_be_earlier():
    """Earlier means both bars: 15 ms earlier at 0.85 is not (under 16.7 ms), nor 50 ms earlier at 0.95 (over 0.9);
    the other paint threads, 40 and 950 ms earlier at 0.6 and 0.05, are."""
    for core, browser, ui in ((85, 100, 60), (950, 1000, 50)):
        _, judged = judge(rows(times={**TIMES, "ui": (ui, 300), "view": (ui, 300), "core": (core, 300), "browser": (browser, 700)}))
        cell = "fill/small/loopback/0"
        assert labels(judged, metric="first", arm="core", cell=cell) == {"fails"}, (core, browser)
        assert labels(judged, metric="first", arm="ui", cell=cell) == {"holds"}, (ui, browser)


def test_the_relay_core_saturates_only_where_a_relay_runs():
    """The relay's core at 0.85 busy saturates the 20 Mbit cells; on loopback it carries no relay and is not read."""
    def relay(r):
        r["busy"]["relay"] = 0.85
        return r
    _, judged = judge(rows(change=relay))
    assert {j["label"] for j in judged if "/20M/" in j["cell"]} == {"saturated"}
    assert {j["label"] for j in judged if "/loopback/" in j["cell"]} == {"holds"}


def test_an_aa_past_half_the_band_voids_the_cell():
    """The browser's A2 first frame 10 % later than its A voids every first-frame cell, and nothing else."""
    def later(r):
        if r["unit"].endswith("/browser/A2"):
            r["shown_ms"] *= 1.10
        return r
    _, judged = judge(rows(change=later))
    assert labels(judged, metric="first") == {"VOID"} and labels(judged, metric="fill") == {"holds"}


def test_a_busy_client_saturates_and_claims_nothing():
    """Client cores at 0.95 busy label every cell saturated, and the verdict is undecided."""
    _, judged = judge(rows(busy=0.95))
    assert labels(judged) == {"saturated"} and all("undecided" in line for line in verdict(judged))


def test_an_inexact_visit_and_a_late_relay_are_dropped():
    """A visit with a frame not exact is failed and one the relay voided is not counted; with every core visit so,
    no core cell is decided."""
    def drop(r):
        if "/core/" in r["unit"]:
            r["exact" if r["round"] % 2 else "void"] = r["frames"] - 1 if r["round"] % 2 else True
        return r
    bad, judged = judge(rows(change=drop))
    assert len(bad) == 2 * 2 * len(cells()) and labels(judged, arm="core") == {"undecided"}


if __name__ == "__main__":
    for name, test in list(globals().items()):
        if name.startswith("test_"):
            test()
            print("ok", name)
