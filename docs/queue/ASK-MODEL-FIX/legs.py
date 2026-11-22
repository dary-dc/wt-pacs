"""ASK-MODEL §5 under its own model: no slice skipped, one fetch at a time at mu, a store of W frames that lets go
only past its budget, and a hold that refuses a fetch it would at once let go. A reader scrolls a sawtooth of legs
of `leg` steps at v, optionally dwelling `dwell` seconds at each turn; the client knows a turn only once the
input asks for the step back. Prints the mean wait a leg after warm-up."""
import sys

def key(policy, delta, moving, rho):
    # delta > 0 ahead of the display in the reader's direction, < 0 behind
    if policy == "centred" or (policy in ("rule", "scroll-ahead") and not moving):
        return abs(delta)
    if policy == "allahead":
        return delta if delta >= 0 else 1e6 - delta
    if policy == "ahead34":
        return delta / 3 if delta >= 0 else -delta
    if policy == "rule":
        return delta / rho if delta >= 0 else -delta
    if policy == "scroll-ahead":
        return delta if delta >= 0 else 1e6 - delta
    raise ValueError(policy)

def run(policy, W, leg, v, mu, dwell=0.0, legs=60, warm=10):
    rho = min(1.0, mu / v)
    lo, hi = 10_000, 10_000 + leg
    s, d, seen = lo, 1, 1  # d the path's direction; seen the client's, the last step it observed
    held = {s}
    t = 0.0
    fetching, done = None, None
    next_step = 1 / v
    dwell_until = None
    moving = True
    wait, waits, legs_done, stalled_since = 0.0, [], 0, None

    def k(i):
        return key(policy, (i - s) * seen, moving, rho)

    def pick():
        cands = [i for i in range(s - 3 * W, s + 3 * W + 1) if i not in held]
        c = min(cands, key=k)
        if len(held) >= W and k(c) >= max(k(h) for h in held if h != s):
            return None
        return c

    while legs_done < legs:
        if fetching is None:
            fetching = pick()
            done = t + 1 / mu if fetching is not None else None
        t = min(x for x in (done, next_step) if x is not None)
        if done is not None and t == done:
            held.add(fetching)
            fetching, done = None, None
            while len(held) > W:
                held.remove(max((h for h in held if h != s), key=k))
        if t < next_step:
            continue
        if dwell_until is not None:
            dwell_until, moving = None, True
        n = s + d
        if n in held:
            if stalled_since is not None:
                wait += t - stalled_since
                stalled_since = None
            s, seen = n, d
            next_step = t + 1 / v
            if s in (lo, hi):
                d = -d
                legs_done += 1
                if legs_done > warm:
                    waits.append(wait)
                wait = 0.0
                if dwell > 0:
                    moving, dwell_until = False, t + dwell
                    next_step = dwell_until
        else:
            seen = d  # the input names the target p before the display reaches it (§2)
            if stalled_since is None:
                stalled_since = t
            next_step = t + 1e-4
    return sum(waits) / len(waits)

def closed_form(policy, W, leg, rho, v):
    """Leg with no wait n = (b - rho*k0) / (1 - rho), b = W - 1 held behind at a turn, k0 the steps the reader
    crosses before the hold lets the first fetch ahead in; wait = (leg - n)+ * (1/mu - 1/v). No dwell."""
    b = W - 1
    k0 = {"allahead": 0, "scroll-ahead": 0, "ahead34": (b + 1) / 4, "centred": (b + 1) / 2,
          "rule": (b + 1) / (1 + rho)}[policy]
    n = (b - rho * k0) / (1 - rho)
    mu = rho * v
    return n, max(0.0, leg - n) * (1 / mu - 1 / v)

if __name__ == "__main__":
    W, v = 15, 25
    arms = ("allahead", "ahead34", "centred", "rule", "scroll-ahead")
    print("no dwell: simulated wait a leg (s) | closed form wait (s) [leg with no wait, frames]")
    for rho in (0.216, 0.5, 0.8):
        for leg in (12, 20, 40):
            sim = "  ".join(f"{p}={run(p, W, leg, v, rho * v):.2f}" for p in arms)
            cf = "  ".join(f"{p}={closed_form(p, W, leg, rho, v)[1]:.2f}[{closed_form(p, W, leg, rho, v)[0]:.1f}]"
                           for p in arms)
            print(f"rho={rho} leg={leg}: {sim}\n    closed form: {cf}")
    print("\ndwell at each turn (s), legs of 40: simulated wait a leg (s)")
    for rho in (0.216, 0.8):
        for dw in (0.5, 1.0, 3.0):
            print(f"rho={rho} dwell={dw}: " + "  ".join(f"{p}={run(p, W, 40, v, rho * v, dwell=dw):.2f}" for p in arms))
