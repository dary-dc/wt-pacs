# Loss-regime classifier — validated against known ground truth

**Reproduce:** `lab/scripts/e0_regime_validate.sh`
(requires `cargo build --release -p exact-server --features telemetry` — the sampler is
compiled out otherwise).

The classifier's output selects a congestion controller, and the two answers are opposite:
**congestive → Cubic** (BBR measured 63 % worse), **exogenous → BBR** (Cubic measured 48 %
worse). A classifier that is confidently wrong is worse than none at all, so it does not get
used until it reproduces an answer already known.

---

## The test

`netsim` can construct each regime **by construction**, which is what makes this a test
rather than a demonstration:

| cell | how it is built | ground truth |
| ---- | --------------- | ------------ |
| **EXO** | 1 % injected loss, depth 4 → 256 KB in flight against a ~725 KB queue, which therefore cannot overflow | every lost packet was injected on an empty path → **exogenous** |
| **CONG** | 0 % injected loss, depth 32 → 2 MB in flight against the same queue, ~3× its capacity | nothing injected, so every lost packet is overflow → **congestive** |

`netsim`'s own `down_queue` counter is the **independent witness**: it must be 0 in EXO and
large in CONG, or the cell did not build the regime it claims and the row proves nothing.

## Result — pass

| cell | queue drops (witness) | ground truth | classifier | samples |
| ---- | --------------------: | ------------ | ---------- | ------: |
| EXO | **0** ✓ | exogenous | **exogenous** (100 %) | 722 |
| CONG | **492** ✓ | congestive | **congestive** (100 %) | 105 |

Both witnesses agree with their cell's intent, and the classifier gets both right with no
ambiguous or insufficient verdicts.

## What this does and does not establish

**Establishes:** the queueing-delay signal (`rtt_us − min_rtt_us` at the moment loss is
detected) separates the two regimes cleanly when they are cleanly separated, and the
sampler plumbing works end to end — quinn's `PathStats` → JSONL → classifier.

**Does not establish:**

- **Behaviour on a mixed link.** Real 5G carries both regimes at once, and neither cell
  here does. The classifier reports `mixed` between 30 % and 70 % congestive intervals, but
  that threshold is *chosen*, not validated — nothing here tests whether it lands in the
  right place on a genuinely mixed path.
- **The 0.25 queueing-ratio threshold.** It separates these two cells by a wide margin, so
  the test cannot distinguish 0.25 from any other value in a broad range. A real path with
  marginal queueing would.
- **Anything about a browser.** These samples come from the lab harness. Chrome's ACK
  timing under a busy tab could add delay that looks like queueing, which is why the tool
  prints that caveat with every verdict.
- **`black_holes_detected`.** Never exercised — `netsim` has no handover model. On a real
  mobile link this is the field that marks "neither regime", and it is untested.

## How to use it on real sessions

```bash
WTPACS_PATH_TELEMETRY=1 WTPACS_PATH_TELEMETRY_PATH=/var/log/wtpacs/path.jsonl \
  exact-server ...            # built with --features telemetry

python3 lab/scripts/classify_loss_regime.py /var/log/wtpacs/path.jsonl --per-session
```

One row per connection per second, roughly 200 bytes each: a 1 000-viewer hour is ~700 MB
uncompressed, so rotate it or raise `WTPACS_PATH_TELEMETRY_MS`.

**Read the per-session output, not just the summary.** The aggregate hides the thing that
matters most — whether the *mix* differs by access type. If wired viewers classify
congestive and mobile ones exogenous, that is a much more useful finding than a single
verdict over both.
