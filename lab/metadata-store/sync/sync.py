#!/usr/bin/env python3
"""Weigh the two synchronization shapes per event on the parser's own groups: E, a snapshot of every group, and B,
the group list with the changed groups; count the receiver's work in each; time both on the link classes by arithmetic.

usage: sync.py DATA PARSER OUT [NAME ...]   one JSON line per series on stdout, the synthetic 2 000 last
DATA as ../repetition/fetch.py writes it, PARSER the ESIPFfiled that ../parser-output/build.sh prints.
"""
import argparse
import json
import os
import struct
import sys

import blake3
import xxhash
import zstandard

HERE = os.path.dirname(os.path.abspath(__file__))
for sibling in ("repetition", "parser-output", "update-link"):
    sys.path.insert(0, os.path.join(HERE, "..", sibling))

import measure as split  # noqa: E402
import measure_parser  # noqa: E402
import packages  # noqa: E402
import wire  # noqa: E402

LEVEL_CODE = {"exam": 1, "series": 2, "instance": 3, "private": 4}
PATIENT_NAME, SERIES_DESCRIPTION, IMAGE_COMMENTS = (0x0010, 0x0010), (0x0008, 0x103E), (0x0020, 0x4000)
SOP_INSTANCE_UID, MEDIA_SOP_INSTANCE_UID = (0x0008, 0x0018), (0x0002, 0x0003)
INSTANCE_NUMBER, IMAGE_POSITION = (0x0020, 0x0013), (0x0020, 0x0032)
SYNTHETIC_INSTANCES = 2000
PROFILES = {**wire.CLASSES,
            "satellite-1": {"rtt": 0.700, "up_mbit": 1, "loss": 0.001},
            "satellite-2": {"rtt": 0.700, "up_mbit": 2, "loss": 0.001},
            "adsl-0.5": {"rtt": 0.060, "up_mbit": 0.5, "loss": 0.001},
            "adsl-1": {"rtt": 0.060, "up_mbit": 1, "loss": 0.001}}


class Group:
    """One group file of the series: its path in the tree, level, the coded UID naming it (its folder), bytes.

    `copy` tells apart the files the parser wrote for one level and UID (pt's five series groups, us's two exam
    groups), which a row would otherwise merge; the list on the wire does not carry it.
    """

    def __init__(self, path: str, level: str, data: bytes, copy: int = 0):
        self.path, self.level, self.data, self.copy = path, level, data, copy
        self.uid = os.path.basename(os.path.dirname(path))
        self.hash = xxhash.xxh3_64_digest(data)
        self.key = (level, self.uid, copy)

    def with_data(self, data: bytes) -> "Group":
        marker = os.path.basename(self.path).split(".", 1)[0]
        return Group(f"{os.path.dirname(self.path)}/{marker}.{blake3.blake3(data).hexdigest()}", self.level, data,
                     self.copy)


def tree_groups(tree: str) -> list:
    seen, out = {}, []
    for path, level, data, _ in sorted(measure_parser.survey(tree)["groups"]):
        uid = os.path.basename(os.path.dirname(path))
        seen[level, uid] = seen.get((level, uid), -1) + 1
        out.append(Group(path, level, data, seen[level, uid]))
    return out


def with_record(data: bytes, tag: tuple, vr: bytes, value: bytes) -> bytes:
    """The group with `tag`'s top-level value set, the record appended when absent."""
    recs = measure_parser.records(data)
    if any(len(k) == 8 and measure_parser.tag(k) == tag for k, _ in recs):
        recs = [(k, value if len(k) == 8 and measure_parser.tag(k) == tag else v) for k, v in recs]
    else:
        recs.append((measure_parser.top_key(tag, vr), value))
    return b"".join(split.record(k, v) for k, v in recs)


def list_entry(g: Group) -> bytes:
    uid = g.uid.encode()
    return bytes([LEVEL_CODE[g.level], len(uid)]) + uid + g.hash


def group_list(groups: list) -> bytes:
    return b"".join(list_entry(g) for g in groups)


def changed(before: list, after: list) -> list:
    """The groups of `after` the receiver holding `before` lacks: new, or a different hash."""
    held = {g.key: g.hash for g in before}
    return [g for g in after if held.get(g.key) != g.hash]


def snapshot_members(after: list) -> list:
    return [(g.path, g.data) for g in after]


def list_members(before: list, after: list) -> list:
    return [("list", group_list(after))] + [(g.path, g.data) for g in changed(before, after)]


def receive(rows: dict, listed: list, sent: list) -> tuple:
    """§5's rule on rows {key: hash}: `listed` the (key, hash) the package names, `sent` the groups whose bytes it
    carries, each hashed on arrival. Returns the new rows and the work: hashed, bytes hashed, compared, needed."""
    arrived = {g.key: xxhash.xxh3_64_digest(g.data) for g in sent}
    out, need = {}, []
    for key, digest in listed:
        if rows.get(key) == digest or arrived.get(key) == digest:
            out[key] = digest
        else:
            need.append(key)
            if key in rows:
                out[key] = rows[key]
    work = {"hashed": len(sent), "hashed_bytes": sum(len(g.data) for g in sent), "compared": len(listed),
            "need": len(need)}
    return out, work


def receive_e(rows: dict, after: list) -> tuple:
    return receive(rows, [(g.key, g.hash) for g in after], after)


def receive_b(rows: dict, before: list, after: list) -> tuple:
    return receive(rows, [(g.key, g.hash) for g in after], changed(before, after))


def instances(groups: list) -> dict:
    """{coded UID: its instance and private groups}, in path order."""
    out = {}
    for g in groups:
        if g.level in ("instance", "private"):
            out.setdefault(g.uid, []).append(g)
    return out


def median_instance(groups: list) -> str:
    sized = sorted((g for g in groups if g.level == "instance"), key=lambda g: (len(g.data), g.path))
    return sized[len(sized) // 2].uid


def edited(groups: list, pick, tag: tuple, vr: bytes, value: bytes) -> list:
    return [g.with_data(with_record(g.data, tag, vr, value)) if pick(g) else g for g in groups]


def events(groups: list) -> dict:
    """{event: (before, after)}; the snapshot and the list alone are the series unchanged."""
    first_exam = next(g for g in groups if g.level == "exam").path
    first_series = next(g for g in groups if g.level == "series").path
    middle = median_instance(groups)
    last = sorted(instances(groups))[-1]
    comment = b"corrected "
    return {
        "unchanged": (groups, groups),
        "exam fix": (groups, edited(groups, lambda g: g.path == first_exam, PATIENT_NAME, b"PN", b"CORRECTED^NAME")),
        "series fix": (groups, edited(groups, lambda g: g.path == first_series, SERIES_DESCRIPTION, b"LO",
                                      b"CORRECTED DESCRIPTION ")),
        "instance fix": (groups, edited(groups, lambda g: g.level == "instance" and g.uid == middle, IMAGE_COMMENTS,
                                        b"LT", comment)),
        "fan-out": (groups, edited(groups, lambda g: g.level == "instance", IMAGE_COMMENTS, b"LT", comment)),
        "late instance": ([g for g in groups if g.uid != last], groups),
        "withdrawal": (groups, [g for g in groups if g.uid != middle]),
    }


def even(text: str, pad: bytes) -> bytes:
    raw = text.encode()
    return raw + pad * (len(raw) % 2)


def synthetic(groups: list, n: int) -> list:
    """`n` instances from the median instance's groups, each its own SOP instance UID, number and position, as
    ../src/group.rs's synthetic_series makes them; the exam and series groups as they are."""
    template = instances(groups)[median_instance(groups)]
    inst = next(g for g in template if g.level == "instance")
    uid = next(v for k, v in measure_parser.records(inst.data) if measure_parser.tag(k) == SOP_INSTANCE_UID)
    uid = uid.rstrip(b"\0 ").decode()
    series_dir = os.path.dirname(os.path.dirname(inst.path))
    out = [g for g in groups if g.level in ("exam", "series")]
    for i in range(1, n + 1):
        values = {SOP_INSTANCE_UID: even(f"{uid}.{i}", b"\0"), MEDIA_SOP_INSTANCE_UID: even(f"{uid}.{i}", b"\0"),
                  INSTANCE_NUMBER: even(str(i), b" "),
                  IMAGE_POSITION: even(f"-158.135803\\-179.035797\\{-77.2 + 5.0 * i:.6f}", b" ")}
        folder = f"{series_dir}/{split.coded_uid(f'{uid}.{i}')}"
        data = b"".join(split.record(k, values.get(measure_parser.tag(k), v) if len(k) == 8 else v)
                        for k, v in measure_parser.records(inst.data))
        out += [Group(f"{folder}/----.x", "instance", data).with_data(data)]
        out += [Group(f"{folder}/{os.path.basename(g.path)}", g.level, g.data) for g in template if g is not inst]
    return sorted(out, key=lambda g: g.path)


def sizes(kind: str, members: list) -> dict:
    stream = packages.tar(members)
    out = {"content": sum(len(d) for _, d in members), "raw": len(packages.package(kind, "u", members, None))}
    for level in (1, 3):
        out[f"zstd_{level}"] = len(packages.package(kind, "u", members, level))
    out["stream_zstd_1"] = len(zstandard.ZstdCompressor(level=1).compress(stream))
    return out


def timed(nbytes: int) -> dict:
    return {name: {protocol: {k: wire.transfer(nbytes, protocol, link)[k] for k in ("seconds", "round_trips")}
                   for protocol in ("tcp", "quic")} for name, link in PROFILES.items()}


def measure_series(name: str, groups: list) -> dict:
    row = {"series": name, "groups": len(groups), "instances": len(instances(groups)), "events": {}}
    the_list = group_list(groups)
    row["list"] = {"bytes": len(the_list), "per_entry": len(the_list) / len(groups),
                   "zstd_1": len(zstandard.ZstdCompressor(level=1).compress(the_list)),
                   "zstd_3": len(zstandard.ZstdCompressor(level=3).compress(the_list))}
    for event, (before, after) in events(groups).items():
        rows = {g.key: g.hash for g in before}
        expected = {g.key: g.hash for g in after}
        e_rows, e_work = receive_e(rows, after)
        b_rows, b_work = receive_b(rows, before, after)
        assert e_rows == expected and b_rows == expected and not e_work["need"] and not b_work["need"], event
        e, b = sizes("snapshot", snapshot_members(after)), sizes("list", list_members(before, after))
        row["events"][event] = {"changed": len(changed(before, after)), "deleted": len(rows.keys() - expected.keys()),
                                "E": e, "B": b, "receiver": {"E": e_work, "B": b_work},
                                "wire": {"E": timed(e["zstd_1"]), "B": timed(b["zstd_1"])}}
    return row


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("data")
    ap.add_argument("parser")
    ap.add_argument("out")
    ap.add_argument("names", nargs="*")
    args = ap.parse_args()
    parser = os.path.abspath(args.parser)
    large = None
    for series in json.load(open(os.path.join(HERE, "..", "repetition", "series.json")))["series"]:
        name = series["name"]
        if args.names and name not in args.names:
            continue
        source = os.path.join(args.out, name + ".explicit")
        measure_parser.explicit_copy(os.path.join(args.data, name), source)
        tree = os.path.join(args.out, name)
        measure_parser.run_parser(parser, [os.path.join(source, f) for f in sorted(os.listdir(source))], tree)
        groups = tree_groups(tree)
        print(json.dumps(measure_series(name, groups)), flush=True)
        if name == "ct":
            large = measure_series(f"synthetic {SYNTHETIC_INSTANCES}", synthetic(groups, SYNTHETIC_INSTANCES))
    if large:
        print(json.dumps(large), flush=True)


if __name__ == "__main__":
    main()
