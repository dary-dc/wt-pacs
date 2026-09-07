# Loss-regime classifier — validated against known ground truth

**Reproduce:** `lab/scripts/e0_regime_validate.sh`
(requires `cargo build --release -p exact-server --features telemetry` — the sampler is
compiled out otherwise).

The classifier's output selects a congestion controller, and the two answers are opposite:
**congestive → Cubic** (BBR measured 63 % worse), **exogenous → BBR** (Cubic measured 48 %
worse). A classifier that is confidently wrong is worse than none at all, so it does not get
used until it reproduces an answer already known.

---

## What this validation could not have caught, and did not

**The classifier's logic is validated by what follows. Its input path was not.**

Both cells below run **one client**. On 2026-09-07 an adversarial review found that the
sampler emitted each row as two `write` calls onto one append-mode file, so with more than
one connection the rows interleaved — `{row A}{row B}` on one line, an empty line after it.
Reproduced here at realistic concurrency: **at 32 connections only 1 842 of 6 400 rows
survived intact, 29 %**, and `classify_loss_regime.py` skipped every damaged line in
silence, so the series merely looked quieter.

A single-client validation cannot exercise a concurrency bug. That is not a criticism of
the test below — it is the reason this note exists beside it.

**Nothing concluded so far is affected**, because the sampler has never been deployed
against real multi-client traffic; §4.1 of the handoff still lists that as the outstanding
work. The defect was found before the data it would have corrupted was ever collected,
which is the only good time to find it.

Fixed in `server/src/record/path.rs`: one `write` per row, with a `dropped_since_last`
counter carried in the data the way `FrameRecord` already carries its own, plus a
concurrency regression test. `classify_loss_regime.py` now counts unreadable lines, reports
them, and **refuses to classify** a log that lost more than 2 %.

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
