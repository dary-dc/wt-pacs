# R2 — data collection brief

**For:** wt-pacs implementer (cloud) · 2026-08-29 · **Branch: `main`**
**Governing doc:** [`stream-mode-remediation.md`](stream-mode-remediation.md) §R0a

**Collect data. Do not interpret it.** Analysis is done elsewhere; a conclusion in your report is
noise at best and anchoring at worst. If something looks like it needs a judgment call, stop and say
so rather than making it.

`feat/set-priority-per-frame` is **frozen**. Do not merge it, build on it, or run against it.

---

## Task A · Reprove the client fixes on a real fixture

`0adea45` was verified against `fixtures/us_cine_smoke/us_cine_smoke.sbnd` — **151 bytes, 19-byte
frames.** A 19-byte frame arrives in one `read()`, so none of the paths that commit fixed actually
ran: the framing loop across chunk boundaries, the split-header case, `ChunkBuffer.take()`, and the
per-chunk allocation in the WASM client.

Rerun the same end-to-end check against **`lab/fixtures/frames_250k/frames_250k.sbnd`** (~180 chunks
per frame), both clients × both stream modes:

| | |
| --- | --- |
| Clients | `transport-ts`, `transport-wasm` |
| Modes | `--stream-mode shared`, `--stream-mode per-frame` |
| Check | every frame's byte length matches the fixture exactly, and the display index is the asked index |

Also run one pass against `lab/fixtures/queue_large` (variable frame sizes) — equal-sized frames can
hide an off-by-one in a length-prefix loop.

**Report:** pass/fail per cell, and any mismatch verbatim. Nothing else.

**Also:** the WASM harness logged a console 404 last run. Name the resource. It is probably nothing,
but two campaigns have been damaged by unexplained anomalies that were noted and passed over.

---

## Task B · Reproduce the `mild_cell` timeout, with instrumentation

The X3 campaign's full trace timed out and was silently swapped for an 80-step trace. **Why it timed
out is unknown, and a server or client that stalls on a realistic trace is a defect, not a harness
inconvenience.**

Reproduce it. Netns netem, the cell X3 used:

```bash
unshare --user --map-root-user --net -- bash
ip link set lo up
tc qdisc add dev lo root netem delay 30ms rate 10mbit     # RTT 60 ms, no loss
ping -c3 127.0.0.1                                        # confirm ~60 ms before trusting anything
```

Run the **full `mild_cell` trace**, both modes, `--read-bps 0`, `RUST_LOG=debug`, and a timeout
generous enough to see the stall rather than cut it short (≥ 900 s).

**Capture, per run:**

- full server log and full harness stdout/stderr, kept as files
- the last frame index the server served, and the last ask it read
- `peak_outstanding` and `asks_sent` at the point of the stall
- wall-clock time to the stall
- whether the stall is a hang (no progress) or a crawl (progress, too slow)

That last distinction is the one that matters most and is the easiest to lose. Say which it is.

If it does **not** reproduce, that is a result — report it with the exact command, and do not retry
with a shorter trace.

---

## Task C · Full depth curves at 150 ms RTT

X2 reported only `D_min`. At 150 ms the two modes diverge (shared 3, per-frame 5 at 250 KB; 5 and 8 at
51 KB) and at ≤ 60 ms they do not. **I need the whole curve, not the knee.**

| | |
| --- | --- |
| Link | 10 Mbit, **RTT 150 ms**, no loss |
| Fixtures | `frames_250k`, `frames_32k` |
| Modes | both |
| Depth | **D = 1,2,3,4,6,8,12,16** — every value, do not stop at the knee |
| Repeats | 3 per cell, report all three, not a mean |

`--read-bps 0`. One server process per depth (`--depth-sweep` panics with *"rustls ring provider
already installed"*).

**Report as a TSV**: `mode, fixture, rtt, depth, run, mbps, p95_wait_ms, peak_outstanding, asks_sent`.
Raw rows. No summary, no knee-finding, no interpretation.

Run the same grid at **RTT 60 ms** as a control, so the divergence has a baseline in the same
campaign rather than a comparison against older data.

---

## What not to do

- Do not run the X3 rerun. Its grid does not exist yet and depends on what B and C show
- Do not touch `feat/set-priority-per-frame`
- Do not change product source. A/B/C are verification and measurement only
- Do not shorten a trace, drop a depth, or substitute a fixture to make a run finish. If a run will
  not complete, that is the finding — report it

## Rules

- `--read-bps 0` whenever `tc` is shaping, or `LinkPacer` fights netem
- Never measure on localhost without netem — every term here is RTT-proportional
- Evidence tier on anything you report; nothing goes above T2
- **Reporting is not optional and `.local/` is gitignored.** Raw data written there never reaches
  anyone. Commit results to **`docs/measurements/r2/`** (tracked): the Task C TSV, and for Task B a
  short `FINDINGS.md` stating hang-or-crawl, last frame served, last ask read, and wall time to the
  stall. Large logs stay in `.local/`; quote the relevant lines in `FINDINGS.md`
- State facts, not conclusions. "Stalled at frame 412 after 143 s, no further progress" is the
  deliverable; "per-frame mode is slower" is not
- No Claude attribution in commit messages
