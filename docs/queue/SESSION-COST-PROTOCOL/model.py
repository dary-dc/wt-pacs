"""SESSION-COST-PROTOCOL's derivation: the frames a reading session asks, per arm and volume, and their bytes.

Theory: a simulation of the code as built at claude/unified b059388b6 (client/view/controller.js wantFrom and
memoryWindow, client/view/store.js's farthest-first eviction, client/transport/downloader.js wholeGroups), with an
infinitely fast pipeline: every step's misses are asked and held before the next step. Usage:
  python3 model.py INPUTS_JSON   (claude/delivery:lab/delivery/inputs.json)
"""
import json, sys

MIB256 = 256 * 2**20
DWELLS = 3


def want_from(c, n, w):
    order = [c]
    d = 1
    while len(order) < min(n, w):
        for i in (c + d, c - d):
            if 0 <= i < n and len(order) < w:
                order.append(i)
        d += 1
    return order


def sawtooth(n, strokes=3):
    top = n // 3
    stroke = list(range(1, top + 1)) + [top - 1 - k for k in range(top)]
    return stroke * strokes


def trace(n):
    """Open at 0; the drilling sawtooth; one pass 1..n-1; dwells at n-1, n//2, n//4 (jumps between)."""
    steps = sawtooth(n) + list(range(1, n))
    return steps + [n // 2, n // 4], [n - 1, n // 2, n // 4]


def asked(n, w, g):
    held, count = set(), [0] * n
    def step(c):
        misses = [i for i in want_from(c, n, w) if i not in held]
        groups = sorted({j for i in misses for j in range(i - i % g, min(i - i % g + g, n))})
        for j in groups:
            count[j] += 1
            held.add(j)
        while len(held) > w:
            held.remove(max(held, key=lambda i: (abs(i - c), i)))
    step(0)
    steps, _ = trace(n)
    for c in steps:
        step(c)
    return count


def window(width, height, bits):
    return MIB256 // (width * height * (1 if bits <= 8 else 2))


DIMS = {"dbts_a1": (1142, 1785, 12), "dbts_b1": (2560, 3328, 10), "dbts_c1": (976, 2513, 12)}
FIT_PREFIX = 0.271  # dbts_b1's level-1 prefix share, RESLEVEL (delivery-comparison.md A2.7, source)

if __name__ == "__main__":
    vols = json.load(open(sys.argv[1]))["volumes"]
    print("volume n W | arm frames-asked (of n) MB-asked | exact presses")
    for v, (wd, ht, bits) in DIMS.items():
        view, exact = vols[v]["view"]["frames"], vols[v]["exact"]["frames"]
        n, w = len(exact), min(len(exact), window(wd, ht, bits))
        _, dwells = trace(n)
        cA = asked(n, w, vols[v]["view"]["group"])
        cB = asked(n, w, 1)
        mbA = sum(k * b for k, b in zip(cA, view)) / 1e6
        mbB = sum(k * b for k, b in zip(cB, exact)) / 1e6
        c1 = sum(exact[i] for i in dwells) / 1e6
        print(f"{v} n={n} W={w} | A {sum(cA)} {mbA:.2f} | A+C1 {mbA + c1:.2f} (C1 {c1:.2f}) | B {sum(cB)} {mbB:.2f}", end="")
        if v == "dbts_b1":
            fit = sum(k * b for k, b in zip(cB, exact)) * FIT_PREFIX / 1e6
            zoom = sum(exact[i] for i in dwells) * (1 - FIT_PREFIX) / 1e6
            print(f" | FIT {fit:.2f} + zoom {zoom:.2f} = {fit + zoom:.2f}", end="")
        else:
            print(" | FIT = B", end="")
        print(f" | whole series once: view {sum(view)/1e6:.2f}, exact {sum(exact)/1e6:.2f}")
    usb = 78004
    print(f"usb_cine n=64 W={min(64, window(512, 512, 8))} | B 64 {64 * usb / 1e6:.2f} (mean frame bytes, us-dbt-carry §3) | FIT = B")
