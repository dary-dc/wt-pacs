#!/usr/bin/env python3
"""wire.py's windows, rounds and times against hand-worked cases. Run: python -I wire_test.py"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import wire  # noqa: E402

LOSSLESS = {"rtt": 0.1, "up_mbit": 1000, "loss": 0.0}


class Wire(unittest.TestCase):
    def test_quic_initial_window_is_rfc_9002s(self):
        """RFC 9002 §7.2 with 1 200-byte datagrams: min(12 000, max(14 720, 2 400)) = 12 000 bytes."""
        self.assertEqual(wire.quic_initial_window(), 12000)

    def test_slow_start_doubles_from_the_initial_window(self):
        """10, 20, 40 … packets per round: 70 packets take three rounds, 71 four."""
        self.assertEqual(wire.rounds(70, 10), [10, 20, 40])
        self.assertEqual(wire.rounds(71, 10), [10, 20, 40, 1])
        self.assertEqual(wire.rounds(1, 10), [1])

    def test_a_small_tcp_request_takes_three_round_trips(self):
        """TCP's handshake, TLS's, then one flight answered: 3 RTT on a fast lossless link."""
        got = wire.transfer(1000, "tcp", LOSSLESS)
        self.assertEqual((got["packets"], got["round_trips"]), (2, 3))
        self.assertAlmostEqual(got["seconds"], 0.3, places=3)

    def test_quic_saves_the_tcp_handshake(self):
        """The same small body over QUIC: one handshake round trip, then one flight, 2 RTT."""
        self.assertEqual(wire.transfer(1000, "quic", LOSSLESS)["round_trips"], 2)

    def test_crossing_the_initial_window_costs_a_round_trip(self):
        """A body that just fits the first TCP flight with the client's flight takes 3 RTT; one byte more takes 4."""
        fits = 10 * wire.TCP_MSS - wire.CLIENT_FLIGHT - wire.REQUEST_HEAD - wire.TLS_RECORD_OVERHEAD
        self.assertEqual(wire.transfer(fits, "tcp", LOSSLESS)["round_trips"], 3)
        self.assertEqual(wire.transfer(fits + 1, "tcp", LOSSLESS)["round_trips"], 4)

    def test_quic_crosses_its_window_after_the_client_flight(self):
        """QUIC's first flight is 10 datagrams shared with the client's certificate flight; one byte past costs a round trip."""
        fits = 10 * (wire.QUIC_DATAGRAM - wire.QUIC_PACKET_OVERHEAD) - wire.CLIENT_FLIGHT - wire.H3_HEAD
        self.assertEqual(wire.transfer(fits, "quic", LOSSLESS)["round_trips"], 2)
        self.assertEqual(wire.transfer(fits + 1, "quic", LOSSLESS)["round_trips"], 3)

    def test_a_slow_link_is_serialisation_bound(self):
        """1 MB at 1 Mbit/s and a 1 ms RTT takes about 8 s, whatever the rounds."""
        got = wire.transfer(1_000_000, "tcp", {"rtt": 0.001, "up_mbit": 1, "loss": 0.0})
        self.assertGreater(got["seconds"], 8.0)
        self.assertLess(got["seconds"], 8.6)

    def test_loss_adds_its_expected_cost(self):
        """At 1 % per packet, two packets add (1 − 0.99²) × 1.5 RTT."""
        lossy = dict(LOSSLESS, loss=0.01)
        got = wire.transfer(1000, "tcp", lossy)
        self.assertAlmostEqual(got["seconds"] - got["seconds_lossless"], (1 - 0.99 ** 2) * 1.5 * 0.1, places=6)


if __name__ == "__main__":
    unittest.main()
