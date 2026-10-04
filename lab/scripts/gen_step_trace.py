#!/usr/bin/env python3
"""A synthetic step trace for `link_impair.py --trace`, in mahimahi's format: one millisecond
timestamp per 1500-byte delivery opportunity, spread evenly over each step and the last on its
final millisecond. A step at 0 kbit is an outage; the trace loops at its last timestamp, so it
cannot end on one.

usage: gen_step_trace.py KBIT:MS [KBIT:MS ...] > trace.txt
       gen_step_trace.py 40000:2000 8000:2000 0:300 20000:1000
"""
import sys

PACKET_BITS = 1500 * 8


def opportunities(steps):
    t0 = 0
    for kbit, ms in steps:
        n = round(kbit * ms / PACKET_BITS)
        for j in range(1, n + 1):
            yield t0 - (-j * ms // n)
        t0 += ms


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    steps = [tuple(int(x) for x in arg.split(":")) for arg in sys.argv[1:]]
    stamps = list(opportunities(steps))
    if not stamps or stamps[-1] != sum(ms for _, ms in steps):
        sys.exit("the trace loops at its last opportunity: it cannot end on an outage")
    sys.stdout.write("".join("%d\n" % t for t in stamps))


if __name__ == "__main__":
    main()
