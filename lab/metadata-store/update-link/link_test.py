#!/usr/bin/env python3
"""link.py's one-way link: serialisation at the rate, the delay, the queue's limit and loss. Run: python -I link_test.py"""
import os
import random
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import link  # noqa: E402


class Direction(unittest.TestCase):
    def test_packets_leave_one_after_another_at_the_rate_then_the_delay(self):
        """At 1 Mbit/s and 50 ms, two 1 250-byte packets offered together arrive at 60 and 70 ms."""
        way = link.Direction(1, 0.05, 0.0, random.Random(0))
        self.assertAlmostEqual(way.admit(0.0, 1250), 0.060)
        self.assertAlmostEqual(way.admit(0.0, 1250), 0.070)

    def test_an_idle_link_starts_a_packet_when_it_arrives(self):
        """A packet offered after the queue drained waits for nothing but its own serialisation."""
        way = link.Direction(1, 0.0, 0.0, random.Random(0))
        way.admit(0.0, 1250)
        self.assertAlmostEqual(way.admit(1.0, 1250), 1.010)

    def test_no_rate_means_only_the_delay(self):
        """The floor class: no rate limit, each packet arrives after the delay alone."""
        way = link.Direction(None, 0.3, 0.0, random.Random(0))
        self.assertEqual(way.admit(2.0, 1500), 2.3)

    def test_a_full_queue_drops(self):
        """The queue holds QUEUE_PACKETS packets not yet sent; the next one is dropped, and admitted once one leaves."""
        way = link.Direction(1, 0.0, 0.0, random.Random(0))
        for _ in range(link.QUEUE_PACKETS):
            self.assertIsNotNone(way.admit(0.0, 1250))
        self.assertIsNone(way.admit(0.0, 1250))
        self.assertIsNotNone(way.admit(0.011, 1250))

    def test_loss_drops_at_its_rate(self):
        """At 10 % loss about a tenth of 20 000 packets is dropped."""
        way = link.Direction(None, 0.0, 0.1, random.Random(1))
        lost = sum(way.admit(0.0, 100) is None for _ in range(20000))
        self.assertGreater(lost, 1800)
        self.assertLess(lost, 2200)


if __name__ == "__main__":
    unittest.main()
