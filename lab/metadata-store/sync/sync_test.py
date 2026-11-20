#!/usr/bin/env python3
"""sync.py's list, receiver rule, events and synthetic series. Run: python -B -I sync_test.py"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import xxhash  # noqa: E402

import sync  # noqa: E402
from sync import Group, measure_parser, split  # noqa: E402


def group_bytes(*recs) -> bytes:
    return b"".join(split.record(measure_parser.top_key(tag, vr), value) for tag, vr, value in recs)


def series(n: int) -> list:
    exam = Group("d/S/--.e", "exam", group_bytes(((0x0010, 0x0010), b"PN", b"DOE^JOHN")))
    ser = Group("d/S/R/---.s", "series", group_bytes(((0x0008, 0x103E), b"LO", b"AXIAL ")))
    out = [exam, ser]
    for i in range(1, n + 1):
        inst = group_bytes((sync.SOP_INSTANCE_UID, b"UI", f"1.2.{i}".encode() + b"\0" * (i < 10)),
                           (sync.INSTANCE_NUMBER, b"IS", f"{i} ".encode()), (sync.IMAGE_POSITION, b"DS", b"0\\0\\0 "),
                           ((0x0028, 0x0010), b"US", b"\0\2" * i))
        priv = group_bytes(((0x0009, 0x0010), b"LO", b"ab"))
        out += [Group(f"d/S/R/I{i}/----.x", "instance", inst), Group(f"d/S/R/I{i}/priv.p", "private", priv)]
    return out


class List(unittest.TestCase):
    def test_entry_is_level_uid_and_xxh3(self):
        """An entry is the level's byte, the coded UID's length and bytes, then the group's 8-byte XXH3-64."""
        g = series(1)[2]
        self.assertEqual(sync.list_entry(g), b"\3\2I1" + xxhash.xxh3_64_digest(g.data))
        self.assertEqual(len(sync.group_list(series(3))), sum(2 + len(g.uid) + 8 for g in series(3)))

    def test_with_record_sets_or_appends(self):
        """with_record replaces a top-level value in place and appends a missing one; the result parses back."""
        data = series(1)[0].data
        set_ = measure_parser.records(sync.with_record(data, sync.PATIENT_NAME, b"PN", b"NEW^NAME"))
        self.assertEqual(set_, [(measure_parser.top_key(sync.PATIENT_NAME, b"PN"), b"NEW^NAME")])
        added = measure_parser.records(sync.with_record(data, sync.IMAGE_COMMENTS, b"LT", b"x "))
        self.assertEqual(added[1], (measure_parser.top_key(sync.IMAGE_COMMENTS, b"LT"), b"x "))
        self.assertEqual(len(added), 2)


class Receiver(unittest.TestCase):
    def test_both_shapes_reach_the_same_rows_on_every_event(self):
        """E and B bring a receiver holding `before` to exactly `after`'s rows, every event, nothing needed."""
        for event, (before, after) in sync.events(series(5)).items():
            rows = {g.key: g.hash for g in before}
            want = {g.key: g.hash for g in after}
            for shape, (got, work) in (("E", sync.receive_e(rows, after)), ("B", sync.receive_b(rows, before, after))):
                self.assertEqual(got, want, f"{event} {shape}")
                self.assertEqual(work["need"], 0, f"{event} {shape}")

    def test_b_carries_only_what_changed(self):
        """B's package is the list and the changed groups: one for a fix, every instance group for a fan-out, the
        two of a late instance, none for a withdrawal; E hashes every group, B only those it carries."""
        ev = sync.events(series(5))
        counts = {e: len(sync.changed(*ev[e])) for e in ev}
        self.assertEqual(counts, {"unchanged": 0, "exam fix": 1, "series fix": 1, "instance fix": 1, "fan-out": 5,
                                  "late instance": 2, "withdrawal": 0})
        before, after = ev["instance fix"]
        rows = {g.key: g.hash for g in before}
        self.assertEqual(sync.receive_e(rows, after)[1]["hashed"], 12)
        self.assertEqual(sync.receive_b(rows, before, after)[1], {"hashed": 1, "hashed_bytes": len(
            sync.changed(before, after)[0].data), "compared": 12, "need": 0})
        self.assertEqual([m[0] for m in sync.list_members(*ev["withdrawal"])], ["list"])

    def test_withdrawal_deletes_the_row(self):
        """A row whose group the package no longer lists is deleted, in both shapes."""
        before, after = sync.events(series(5))["withdrawal"]
        rows = {g.key: g.hash for g in before}
        gone = rows.keys() - {g.key for g in after}
        self.assertEqual(len(gone), 2)
        self.assertFalse(gone & sync.receive_b(rows, before, after)[0].keys())
        self.assertFalse(gone & sync.receive_e(rows, after)[0].keys())

    def test_a_listed_hash_the_receiver_lacks_is_needed(self):
        """A listed group whose hash the receiver does not hold and whose bytes did not come is answered `need`,
        and its row is kept as it was."""
        before, after = sync.events(series(3))["exam fix"]
        rows = {g.key: g.hash for g in before}
        got, work = sync.receive(rows, [(g.key, g.hash) for g in after], [])
        self.assertEqual(work["need"], 1)
        self.assertEqual(got, rows)

    def test_copies_of_one_uid_stay_apart(self):
        """Two files the parser wrote for one level and UID are two rows, not one."""
        a = Group("d/S/R/---.a", "series", b"\0", 0)
        b = Group("d/S/R/---.b", "series", b"\1", 1)
        self.assertNotEqual(a.key, b.key)
        self.assertEqual(a.with_data(b"\2").key, a.key)


class Synthetic(unittest.TestCase):
    def test_instances_differ_only_in_uid_number_and_position(self):
        """n instances from the median one, each its own UID (folder too), number and position, the rest copied."""
        base = series(3)
        out = sync.synthetic(base, 40)
        insts = sync.instances(out)
        self.assertEqual(len(insts), 40)
        self.assertEqual(len({g.hash for g in out if g.level == "instance"}), 40)
        for t in (sync.INSTANCE_NUMBER, sync.IMAGE_POSITION):
            key = measure_parser.top_key(t, b"IS" if t == sync.INSTANCE_NUMBER else b"DS")
            self.assertEqual(len({dict(measure_parser.records(g.data))[key] for g in out if g.level == "instance"}), 40)
        template = dict(measure_parser.records(next(g for g in base if g.uid == "I2" and g.level == "instance").data))
        varied = {sync.SOP_INSTANCE_UID, sync.MEDIA_SOP_INSTANCE_UID, sync.INSTANCE_NUMBER, sync.IMAGE_POSITION}
        for groups in insts.values():
            inst = next(g for g in groups if g.level == "instance")
            for k, v in measure_parser.records(inst.data):
                if measure_parser.tag(k) not in varied:
                    self.assertEqual(v, template[k])
            self.assertTrue(os.path.basename(inst.path).startswith("----."))
            uid = dict(measure_parser.records(inst.data))[measure_parser.top_key(sync.SOP_INSTANCE_UID, b"UI")]
            self.assertEqual(inst.uid, split.coded_uid(uid.rstrip(b"\0").decode()))
            self.assertEqual(len(uid) % 2, 0)


if __name__ == "__main__":
    unittest.main()
