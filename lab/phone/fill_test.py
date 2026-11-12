#!/usr/bin/env python3
"""lab/phone/fill.py's claims, on a beacon load and path rows made by hand."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fill  # noqa: E402


def load(fill_ms, decode_ms, link="wifi"):
    return {"step": 4, "link": link, "controller": "bbr", "view": "page", "fillMs": fill_ms,
            "frames": [{"i": i, "decodeMs": d} for i, d in enumerate(decode_ms)]}


def row(t_ms, sent):
    return {"t_ms": t_ms, "sent_packets": sent, "rtt_us": 2000}


def test_the_decode_floor_is_the_frames_decode_time_over_three_decoders_and_a_frame_without_one_counts_zero():
    s = fill.split(load(1000, [300, 300, None, 300]), [])
    assert s["decode_floor_ms"] == 300 and s["rest_ms"] == 700 and s["decode_share"] == 0.3
    assert s["frame_decode_ms"] == 300 and s["step"] == 5


def test_the_wire_time_counts_the_rows_that_sent_from_the_sessions_start_including_the_first_row():
    """The first row's 250 ms, from the session's start, is the one the README's wire time counts and a pair of rows misses."""
    rows = [row(250, 5000), row(500, 9000), row(750, 9010)]
    assert fill.split(load(1000, [1]), rows)["wire_ms"] == 500


def test_a_load_without_a_fill_has_no_share_and_no_rest_and_is_left_out_of_the_medians():
    failed, done = fill.split(load(None, [900]), []), fill.split(load(2000, [600, 600, 600]), [])
    assert failed["decode_share"] is None and failed["rest_ms"] is None
    s = fill.summary([failed, done])
    assert s["loads"] == 1 and s["fill_ms"] == 2000 and s["decode_floor_ms"] == 600


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
