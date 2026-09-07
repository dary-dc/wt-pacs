#!/usr/bin/env python3
"""Decide E0-STALL from the two runs `e0_stall_validate.sh` just made.

Separate file rather than an inline heredoc so the checks can be read, diffed and reused
without the quoting contortions that nesting a Python heredoc inside a shell heredoc
requires.
"""
import json
import pathlib
import sys


def peak_bytes(label):
    """Peak RssAnon of that run's client process, in bytes."""
    p = pathlib.Path(f"/tmp/e0stall_{label}.peak")
    t = p.read_text().strip() if p.exists() else ""
    return int(t) * 1024 if t else 0


def main(expect, frame):
    out = {}
    for label in ("reading", "parked"):
        try:
            out[label] = json.load(open(f"/tmp/e0stall_{label}.json"))
        except Exception as err:
            print(f"FAIL - {label}: no usable output ({err})")
            return 1
        o = out[label]
        held = peak_bytes(label)
        ratio = held / o["bytes_read"] if o["bytes_read"] else float("inf")
        print(
            f"  {label:8s} read={o['bytes_read']:>10d} B  held={held / 1e6:6.2f} MB  "
            f"held/read={ratio:8.2f}  stalled={str(o['stall_engaged']):5s} "
            f"alive={str(o['connection_alive_at_end']):5s} "
            f"unis={o['uni_streams_opened']:4d}"
        )
    print()

    r, p = out["reading"], out["parked"]
    r_held, p_held = peak_bytes("reading"), peak_bytes("parked")
    checks = [
        ("READING reads exactly asks x 64008", r["bytes_read"] == expect),
        ("PARKED reads less than one frame", p["bytes_read"] < frame),
        (
            "both connections alive at end",
            r["connection_alive_at_end"] and p["connection_alive_at_end"],
        ),
        ("PARKED holds >4x what it read", p_held > 4 * p["bytes_read"]),
        ("READING read >4x what it holds", r["bytes_read"] > 4 * r_held),
    ]
    for name, ok in checks:
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    print()
    if all(ok for _, ok in checks):
        print("E0-STALL PASS - the stalled client withholds bytes the reading client consumes.")
        return 0
    print("E0-STALL FAIL - do not run the campaign; its null result would be uninterpretable.")
    return 1


if __name__ == "__main__":
    sys.exit(main(int(sys.argv[1]), int(sys.argv[2])))
