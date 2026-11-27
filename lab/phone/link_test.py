#!/usr/bin/env python3
"""lab/phone/link.py's claims, on path rows and congestion events made by hand."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import link  # noqa: E402


def row(t_ms, sent, rtt_us, min_rtt_us=None):
    return {"t_ms": t_ms, "sent_packets": sent, "rtt_us": rtt_us, "min_rtt_us": min_rtt_us or rtt_us}


def event(rtt_latest_us, min_rtt_us):
    return {"rtt_latest_us": rtt_latest_us, "min_rtt_us": min_rtt_us}


def test_a_row_counts_as_sending_only_above_fifty_packets_and_its_rate_is_the_packets_over_the_rows_interval():
    rows = [row(0, 0, 9000), row(250, 10_000, 8000), row(500, 10_050, 7000), row(750, 10_051, 6000)]
    assert link.sending(rows) == [(8.0, 10_000 * 1452 * 8 / 250_000)]


def test_the_queue_at_a_loss_is_the_latest_round_trip_above_the_minimum():
    assert link.queue_ms(event(31_000, 2_000)) == 29.0


def test_the_minimum_round_trip_is_the_loss_traces_not_the_path_rows_smoothed_minimum():
    """A fill's smoothed RTT freezes once the server stops sending, so the rows' minimum reads the fill's queue."""
    rows = [row(0, 0, 30_000), row(250, 9000, 20_000, 6000), row(500, 10_000, 9000, 6000)]
    with_loss = ("wifi", rows, [event(30_000, 1_500), event(12_000, 1_800), event(4_000, 1_500)])
    without = ("wifi", [row(0, 0, 9000), row(250, 0, 9000)], [])
    s = link.summary([with_loss, without])
    assert s["min_rtt_ms"] == (1.5, 1.5, 1.5, 1)
    assert s["row_min_ms"] == 7.5
    assert s["queue_at_loss_ms"] == (10.2, 28.5, 3)
    assert s["peak_mbit"][1:] == (0, 9000 * 1452 * 8 / 250_000)


def test_a_link_with_no_congestion_event_reports_no_minimum_and_no_queue_rather_than_zero():
    s = link.summary([("tether", [row(0, 0, 2000), row(250, 6000, 2200)], [])])
    assert s["min_rtt_ms"] is None and s["queue_at_loss_ms"] is None
    assert s["peak_mbit"][0] == 6000 * 1452 * 8 / 250_000


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
