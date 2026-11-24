"""ASK-CELLS: ASK-MODEL-FIX's legs.py (imported unchanged) with the series bounded to frames 0 … n − 1, the legs
placed as the run places them. Derived, not a prediction: the protocol's predictions stand; this says what the
series' edges change under the same model."""
import sys
sys.path.insert(0, sys.argv[1])
import legs  # noqa: E402

def run(policy, W, leg, v, mu, n, lo, dwell=0.0, nlegs=60, warm=10):
    orig = legs.run.__code__
    # The candidates of legs.run's pick() bounded to the series: shift so frame 0 is 10 000 - lo.
    base = 10_000 - lo
    src = open(legs.__file__).read()
    src = src.replace("cands = [i for i in range(s - 3 * W, s + 3 * W + 1) if i not in held]",
                      f"cands = [i for i in range(max({base}, s - 3 * W), min({base + n}, s + 3 * W + 1)) if i not in held]")
    ns = {}
    exec(compile(src, "legs_bounded", "exec"), ns)
    return ns["run"](policy, W, leg, v, mu, dwell, nlegs, warm)

if __name__ == "__main__":
    W, v, n = 15, 25, 50
    arms = ("allahead", "ahead34", "centred", "rule", "scroll-ahead")
    print("arms:", " ".join(arms), "(allahead = behind first; rule = the struck split; scroll-ahead = behind first moving, centred dwelling)")
    for rho, leg, lo, dw in ((0.216, 12, 19, 0), (0.216, 20, 15, 0), (0.216, 40, 5, 0), (0.216, 40, 0, 0), (0.216, 40, 5, 3.0),
                             (0.86, 40, 5, 0)):
        unb = "  ".join(f"{legs.run(p, W, leg, v, rho * v, dwell=dw):.2f}" for p in arms)
        bnd = "  ".join(f"{run(p, W, leg, v, rho * v, n, lo, dwell=dw):.2f}" for p in arms)
        print(f"rho={rho} leg={leg} dwell={dw} legs {lo}..{lo + leg} of {n}: unbounded {unb} | bounded {bnd}")
