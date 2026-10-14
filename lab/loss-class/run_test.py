#!/usr/bin/env python3
"""lab/loss-class/run.py's attribution and rule, on made-up traces: python3 lab/loss-class/run_test.py"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run  # noqa: E402

MS = 1_000_000


def event(sent_ms, rtt_ms, min_ms=40, persistent=False):
    return {"now_ns": (sent_ms + 50) * MS, "sent_ns": sent_ms * MS, "rtt_latest_us": rtt_ms * 1000,
            "min_rtt_us": min_ms * 1000, "persistent": persistent}


class Attribution(unittest.TestCase):
    def test_each_drop_goes_to_the_first_event_that_covers_it(self):
        """A drop counts toward the earliest-declared event whose largest lost packet was sent no earlier than
        the drop arrived, less the lag; an overflow among an event's drops makes it congestive."""
        events = [event(100, 60), event(200, 41), event(300, 41)]
        drops = [[str(99 * MS), "loss", "1452"], [str(int(99.9 * MS)), "overflow", "1452"],
                 [str(int(201.5 * MS)), "loss", "1452"], [str(int(302.5 * MS)), "loss", "1452"],
                 [str(500 * MS), "overflow", "1452"]]
        out, unmatched = run.attribute(events, drops)
        self.assertEqual([e["truth"] for e in out], ["congestion", "radio", "none"])
        self.assertEqual([e["drops"] for e in out], [2, 1, 0])
        self.assertEqual(unmatched, 2)

    def test_an_event_inside_the_last_recovery_does_not_open_one(self):
        """Only an event whose largest lost packet was sent after the last opening event was declared opens a
        recovery epoch, as Cubic's cut does."""
        out, _ = run.attribute([event(100, 60), event(120, 60), event(160, 60)], [])
        self.assertEqual([e["opens"] for e in out], [True, False, True])

    def test_the_classifier_reads_the_round_trip_against_min_plus_q(self):
        """Radio below min RTT + q*, congestion at or above it; RFC 9406's q* is min RTT/8, at least 4 ms."""
        self.assertTrue(run.radio_classed(event(0, 44), run.q_stars(event(0, 44))["rfc9406"]))
        self.assertFalse(run.radio_classed(event(0, 45), run.q_stars(event(0, 45))["rfc9406"]))
        self.assertEqual(run.q_stars(event(0, 0, min_ms=80))["rfc9406"], 10_000)


def rows(overflow_rtt, random_rtt, n=12):
    def visit(kind, cell, rtt, cause):
        return {"cell": cell, "kind": kind, "cc": "cubic-restart", "void": False, "relay_tally": [],
                "losses": [event(100 * i, rtt) for i in range(1, n + 1)],
                "drops": [[str(100 * i * MS), cause, "1452"] for i in range(1, n + 1)]}
    return [visit("overflow", "of-q20", overflow_rtt, "overflow"), visit("random-q20", "iid1-q20", random_rtt, "loss")]


class Rule(unittest.TestCase):
    def test_a_q_star_passes_when_both_shares_are_under_their_bars(self):
        """Overflow losses at a high round trip and random ones at the floor pass every q*; random ones at a
        12 ms queue fail the two q* under 12 ms and pass 20 ms."""
        self.assertIn("rule: q* rfc9406 passes, q* 10ms passes, q* 20ms passes", run.summary(rows(80, 40)))
        self.assertIn("rule: q* rfc9406 fails, q* 10ms fails, q* 20ms passes", run.summary(rows(80, 52)))

    def test_too_few_events_judge_nothing(self):
        """Fewer than MIN_N events of the class a rule cell is judged on leave the rule not judged."""
        self.assertIn("q* rfc9406 not judged", run.summary(rows(80, 40, n=run.MIN_N - 1)))

    def test_mutating_the_truth_swaps_the_causes(self):
        """--mutate truth relabels every loss an overflow and back, so the clean case no longer passes."""
        self.assertNotIn("q* rfc9406 passes", run.summary(run.mutate(rows(80, 40), "truth")))


if __name__ == "__main__":
    unittest.main()
