"""An ask behind the decoders' queues during a fill, by dispatch policy: a discrete-event model of the downloader.

  python3 lab/ask-behind/sim.py            # the table docs/decode/README.md §An ask behind the decoders quotes
  python3 lab/ask-behind/sim.py --test     # the model's claims, each checked

Frames reach the downloader one every `wire` ms; each decodes in `decode` ms on one of `n` decoders that each hold up
to `cap`; a decoder's "done" frees its slot `hop` ms after its decode ends. At a random moment one ask's bytes arrive;
its wait is from then to its pixels. Policies:
  today   asks queue first; a frame goes to the decoder with the fewest outstanding, at most `cap` each;
  hold    today, but fill frames never take the last free slot of all decoders: one stays for an ask;
  jump    an ask goes at once to the decoder whose work ends first, over its cap, and decodes before its queued frames.
"""
import random
import sys

POLICIES = ("today", "hold", "jump")


def run(policy, frames, wire, decode, n=3, cap=2, hop=0.5, ask_at=None, jitter=0.0, seed=0):
    rng = random.Random(seed)
    cost = lambda: decode * (1 + rng.uniform(-jitter, jitter))
    # A decoder: the time its current decode ends (or None), and its queue of (frame, ms).
    busy_until = [None] * n
    queues = [[] for _ in range(n)]
    held = [0] * n  # outstanding: decoding + queued, until its done reaches the downloader
    waiting = []  # in the downloader, asks first
    events = []  # (time, kind, data)
    for k in range(frames):
        events.append((k * wire, 1, ("arrive", k)))
    if ask_at is not None:
        events.append((ask_at, 0, ("arrive", "ask")))
    done = {}
    now = 0.0

    def start(d):
        if busy_until[d] is None and queues[d]:
            f, ms = queues[d].pop(0)
            busy_until[d] = now + ms
            events.append((busy_until[d], 2, ("end", d, f)))

    def free_slots():
        return sum(cap - h for h in held if h < cap)

    def remaining(d):
        return (busy_until[d] - now if busy_until[d] is not None else 0) + sum(ms for _, ms in queues[d])

    def pump():
        i = 0
        while i < len(waiting):
            f = waiting[i]
            if f == "ask" and policy == "jump":
                d = min(range(n), key=lambda j: (remaining(j), j))
                queues[d].insert(0, (f, cost()))
            else:
                open_ = [j for j in range(n) if held[j] < cap]
                if not open_ or (policy == "hold" and f != "ask" and free_slots() <= 1):
                    i += 1
                    continue
                d = min(open_, key=lambda j: (held[j], j))
                queues[d].append((f, cost()))
            held[d] += 1
            waiting.pop(i)
            start(d)

    while events:
        events.sort()
        now, _, ev = events.pop(0)
        if ev[0] == "arrive":
            waiting.insert(0 if ev[1] == "ask" else len(waiting), ev[1])
        elif ev[0] == "end":
            _, d, f = ev
            busy_until[d] = None
            done[f] = now
            start(d)
            events.append((now + hop, 3, ("free", d)))
        else:
            held[ev[1]] -= 1
        pump()
    fill_end = max(t for f, t in done.items() if f != "ask")
    return (done["ask"] - ask_at if ask_at is not None else None), fill_end


def cell(frames, wire, decode, asks=200, jitter=0.1, **kw):
    """Median and p90 of the ask's wait, and the fill's end against today's, over asks at uniform moments."""
    span = frames * max(wire, decode / kw.get("n", 3))
    out = {}
    for p in POLICIES:
        waits, ends = [], []
        for s in range(asks):
            t = random.Random(1000 + s).uniform(0.1 * span, 0.7 * span)
            w, e = run(p, frames, wire, decode, ask_at=t, jitter=jitter, seed=s, **kw)
            waits.append(w)
            ends.append(e)
        waits.sort()
        out[p] = (waits[len(waits) // 2], waits[int(0.9 * len(waits))], sum(ends) / len(ends))
    return out


# Wire ms a frame at 100 and 300 Mbit/s and decode ms at 1x and 4x: docs/decode/README.md §Net protocols (row 133's ref).
# AV1 at 1.6x and 4.1x HTJ2K's decode, the ends of docs/av1/README.md's range; frames as each set has them.
CELLS = [
    ("dbt12 HTJ2K", 29, {100: 40, 300: 13}, {"1x": 9.3, "4x": 33.8}),
    ("dbt12 AV1 1.6x", 29, {100: 40, 300: 13}, {"1x": 14.9, "4x": 54.1}),
    ("dbt12 AV1 4.1x", 29, {100: 40, 300: 13}, {"1x": 38.1, "4x": 138.6}),
    ("ffdm_d HTJ2K", 4, {100: 385, 300: 128}, {"1x": 91.9, "4x": 395}),
]


def table():
    print("ms from the ask's bytes in hand to its pixels: median / p90 by policy; fill end vs today's")
    for name, frames, wires, decodes in CELLS:
        for rate, wire in wires.items():
            for cpu, dec in decodes.items():
                c = cell(frames, wire, dec)
                t = c["today"]
                row = " | ".join(f"{p} {c[p][0]:6.1f} / {c[p][1]:6.1f}" + ("" if p == "today" else f" fill {c[p][2] / t[2]:.3f}")
                                 for p in POLICIES)
                print(f"{name:24} {rate:3} Mbit/s {cpu}: decode÷3 {dec / 3:6.1f} vs wire {wire:3}: {row}")


def test():
    failed = 0

    def check(ok, what):
        nonlocal failed
        if not ok:
            failed += 1
            print("FAIL", what)

    # An idle decoder takes the ask at once, whatever the policy.
    for p in POLICIES:
        w, _ = run(p, 4, 100, 10, ask_at=50, hop=0)
        check(abs(w - 10) < 1e-9, f"{p}: an ask with a decoder idle waits its own decode, got {w}")
    # Decode-bound, today: the first slot frees as that decoder starts its queued frame, so the ask waits behind it.
    w, _ = run("today", 30, 1, 30, ask_at=200.5, hop=0)
    check(w >= 2 * 30 - 1e-9, f"today, decode-bound: the ask waits a whole fill frame and its own, got {w}")
    # ...and no longer: the ask is taken before every queued fill frame.
    w, _ = run("today", 30, 1, 30, ask_at=200.5, hop=0)
    check(w <= 3 * 30 + 1e-9, f"today, decode-bound: the ask goes before the queued fill frames, got {w}")
    # A slot frees `hop` after its decode ends: one decoder holding one frame idles a hop between frames.
    _, end = run("today", 3, 0, 10, n=1, cap=1, hop=5)
    check(abs(end - 40) < 1e-9, f"one decoder, cap 1, three 10 ms frames and 5 ms hops end at 40, got {end}")
    # jump: the ask waits only for the first decode to end, then its own.
    w, _ = run("jump", 30, 1, 30, ask_at=200.5, hop=0)
    check(w <= 30 + 30 + 1e-9 and w < run("today", 30, 1, 30, ask_at=200.5, hop=0)[0] - 29, f"jump cuts a frame, got {w}")
    # jump does no more work: decode-bound, the fill ends when the same work ends.
    a = run("today", 30, 1, 30, ask_at=200.5, hop=0)[1]
    b = run("jump", 30, 1, 30, ask_at=200.5, hop=0)[1]
    check(abs(a - b) < 30 + 1e-9, f"jump keeps the fill's end within one frame's decode, {a} vs {b}")
    # hold costs a decode-bound fill: one decoder runs with no frame ahead, so each hop idles it.
    a = run("today", 60, 1, 30, hop=3)[1]
    b = run("hold", 60, 1, 30, hop=3)[1]
    check(b > a, f"hold slows a decode-bound fill when hops cost, {a} vs {b}")
    print(f"{failed} failed" if failed else "sim claims: ok")
    return failed


if __name__ == "__main__":
    sys.exit(1 if test() else 0) if "--test" in sys.argv else table()
