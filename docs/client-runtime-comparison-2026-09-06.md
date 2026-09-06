# WASM vs TypeScript client, same wire — measured

**For:** wt-pacs implementer · 2026-09-06 · **Status:** N6 ran. Nine cells reported plus one
voided and kept, 106 runs in total, one of the nine an A/A control. Plan: [`client-runtime-experiment-plan.md`](client-runtime-experiment-plan.md).
Data: [`measurements/n6/`](measurements/n6/). Tools: `lab/scripts/n6_*`, `lab/scripts/link_shim*`.

The plan asks one question: **what does the WASM/JS boundary cost on the receive path?** Both
clients in this repo talk to the same server over the same wire, so the transport is held
constant and the runtime is the only variable.

No product code was changed for this. Everything added lives in `lab/` and `docs/`;
`scripts/gate.sh` passes on the measured tree, both telemetry-absence checks included.

---

## 1 · The answer

**1. The WASM receive path costs a real, repeatable extra per frame — and it is small.**
The cost sits in `deliver` (last byte on the wire → the app holds the bytes) and is
**+25 to +58 µs per frame**, in every paced on-demand cell, at every frame size and every RTT
tested. The A/A control's own slot-to-slot floor is 6.7 µs, so the effect is 3.8–8.6× the noise.

**2. It is not the extra copy the plan predicted.** Plan §2 predicted "one extra full-frame copy
per frame" and said to state it in advance so a null result would be informative. The byte
accounting is right — WASM does move each frame twice where TS moves it once — but the timing
says the bytes are not what costs. Going from 32 KB frames to 250 KB frames, a 7.8× increase,
makes the penalty *smaller* (+57.5 → +34.2 µs on the same link and cell). A byte-proportional
cost cannot do that. What the data shows is a **fixed per-frame boundary cost**, flat in frame
size. **The pre-registered mechanism is not confirmed.**

**3. It does not reach the reader.** On a shaped link the same 50 µs is **0.014 %–0.024 %** of
time-to-frame, and end-to-end per-frame latency does not separate the arms in any cell except one
(shaped 60 ms, +127 µs on 267 ms — significant and 0.05 %). At RTT 150 ms the arms are
indistinguishable end to end.

**4. What does separate them is not per-frame latency.** Three things, in rough order of how much
they would matter to a deployment:

| | WASM | TS | |
| --- | --- | --- | --- |
| **Batch timeout** | delivers 80/80 | loses 29/80 | same constant, different arming point — §6 |
| **First load** | 270 292 B, +17 ms compile | 8 812 B | 30.7× the bytes; ~209 ms extra at 10 Mbit |
| **Bulk footprint** | 50.8 MB JS heap **+** 23.8 MB linear | 32.6 MB JS heap | §7 |

The per-frame question the plan set out to answer has a small answer. The interesting differences
turned out to be elsewhere, and one of them (the timeout) runs the other way.

### 1.1 Side by side

Every criterion this campaign actually measured. "—" means the two arms did not separate. Cells:
`L` = unshaped loopback, `S20/S60/S150` = shim at that nominal RTT, 10 Mbit. Per-run medians,
exact permutation p. Positive delta = WASM slower / larger.

| # | Criterion | `transport-wasm` | `transport-ts` | Delta | p | Better |
| --- | --- | --- | --- | --- | --- | --- |
| | **Per-frame receive path** | | | | | |
| 1 | `deliver_us` median, 250 KB (S60) | 387.0 µs | 337.0 µs | +50.0 µs (1.15×) | 0.0079 | **TS** |
| 2 | `deliver_us` median, 250 KB (L) | 310.0 µs | 275.8 µs | +34.2 µs (1.12×) | 0.0152 | **TS** |
| 3 | `deliver_us` median, 32 KB (L) | 187.5 µs | 130.0 µs | +57.5 µs (1.44×) | 0.0022 | **TS** |
| 4 | `deliver_us` p95, 250 KB (S60) | 520.0 µs | 459.0 µs | +61.0 µs | 0.0317 | **TS** |
| 5 | Scales with frame size? | 7.8× the bytes → penalty *falls* (+57.5 → +34.2 µs) | | | | not byte-bound |
| 6 | Scales with RTT? | +53.8 / +50.0 / +50.0 µs at 20 / 60 / 150 ms | | | | flat — it is CPU |
| 7 | Size vs the A/A floor (6.7 µs) | 3.8–8.6× the noise | | | | effect is real |
| | **End-to-end per frame** | | | | | |
| 8 | `ask_to_complete` median (S150) | 356.295 ms | 356.269 ms | +26 µs | 0.57 | — |
| 9 | `ask_to_complete` median (S60) | 266.941 ms | 266.814 ms | +127 µs | 0.0079 | TS, by 0.048 % |
| 10 | `ask_to_complete` median (S20) | 227.428 ms | 227.555 ms | −128 µs | 0.66 | — |
| 11 | `ask_to_complete` median (L, 250 KB) | 2.668 ms | 2.635 ms | +33 µs | 0.56 | — |
| 12 | `ask_to_complete` median (L, 32 KB) | 1.503 ms | 1.380 ms | +123 µs | 0.16 | — |
| 13 | Boundary cost as share of time-to-frame | 0.014 – 0.024 % shaped; 1.3 – 3.8 % on loopback | | | | negligible shaped |
| | **Bulk / throughput** | | | | | |
| 14 | Fill wall-clock, 10 MB (S60) | 8 370 ms | 8 372 ms | −2 ms | — | — |
| 15 | Fill wall-clock, 20 MB (L) | 236 ms | 244 ms | −8 ms | — | — |
| 16 | Fill `ask_to_complete` median (S60) | 8.315 s | 8.330 s | −14.3 ms | 0.064 | — (trend WASM) |
| 17 | Fill `ask_to_complete` median (L) | 216.8 ms | 222.7 ms | −5.9 ms | 0.71 | — |
| | **Startup, one-time** | | | | | |
| 18 | First-load bytes (product build) | 270 292 B (242 290 wasm + 28 002 glue) | 8 812 B | +261 480 B (30.7×) | — | **TS** |
| 19 | First-load bytes, gzip -9 | 108 869 B | 2 537 B | +106 332 B (42.9×) | — | **TS** |
| 20 | Implied first-load transfer @ 10 / 100 Mbit | 216 / 22 ms | 7 / 0.7 ms | +209 / +21 ms | — | **TS** |
| 21 | `connect_ms` — compile + instantiate | 24.4 ms (L) · 212.6 ms (S60) | 7.4 ms (L) · 194.9 ms (S60) | +16.6 to +18.8 ms, all 8 cells | — | **TS** |
| 22 | Cold first frame (`first_ask_row` deliver) | 745 – 1 150 µs | 345 – 780 µs | +300 to +420 µs | — | **TS** |
| | **Memory** | | | | | |
| 23 | Peak footprint, fill 20 MB (L) | 50.8 MB heap + 23.8 MB linear = **74.6 MB** | 32.6 MB heap | +42.0 MB (2.3×) | — | **TS** |
| 24 | Peak footprint, fill 10 MB (S60) | 28.6 MB heap + 17.1 MB linear = **45.7 MB** | 24.7 MB heap | +21.0 MB (1.9×) | — | **TS** |
| 25 | Peak JS heap, paced on-demand | 14.5 – 72.2 MB | 17.8 – 70.7 MB | no consistent sign across 6 cells | — | — |
| | **Robustness / behaviour** | | | | | |
| 26 | 20 MB batch on a 10 Mbit link | **80 / 80 delivered**, 16.5 s | **51 / 80**, 29 timeouts at 15.002 s, report VOID | 5 repeats of 5 | — | **WASM** |
| 27 | Where the frame deadline is armed | per await (`await_bytes:449`) | per batch, at ask (`armWaiter:77`) | same 15 s constant | — | **WASM** |
| 28 | Frames lost on the wire in that cell | 0 | 0 — the bytes arrived, the deadline fired | | | |
| | **Implementation shape (source, not timing)** | | | | | |
| 29 | Full-frame passes per frame | 2 — `push_chunk` in, `js_buffer_from` out | 1 — `ByteAccumulator.take` | +1 pass | — | TS (but see #5) |
| 30 | Reads per frame observed | 166 / 168 / 175 / 206 shaped; 6 (L) | 166 / 168 / 176 / 206 shaped; 6 (L) | identical in every paced cell | — | — |
| | **Cross-cutting checks** | | | | | |
| 31 | Replicates in `shared` stream mode? | 201.7 µs | 175.8 µs | +25.8 µs, p 0.0022 | | yes |
| 32 | Server work induced, paced cells | `serve_us` p50 94 – 177 µs | 94 – 173 µs | ≤ 4 % — a clean control | — | — |
| 33 | Server work induced, fill (L) | 318 µs | 257 µs | +24 % — server not independent under fill | — | n/a |
| 34 | Link treated both arms alike? | drops 38 / 120 / 0 / 1 205 | 46 / 119 / 0 / 1 197 | balanced; `transfer` Δ 4 µs on 202 ms (p 0.94) | — | — |
| 35 | Report integrity | valid in every reported run | valid except the 5 in #26 | 0 long tasks in window, 0 busy rows, all cells | — | — |

**Reading it.** TS wins more rows, but the rows are not equal. Rows 1–4 are real and 0.02 % of what
a reader waits for (row 13). Rows 18–24 are one-time or bulk-only. Row 26 is the one that would
change a study on a slow link. Nothing here is a per-frame speed argument for either arm.

---

## 2 · What was held constant, what varied

| | |
| --- | --- |
| Arms | `transport-ts`, `transport-wasm` |
| Consuming code | **identical** — `client/harness/shell.js`, one implementation; the pages supply only `loadSession` |
| Telemetry seam | **identical** — external Proxy on `globalThis.WebTransport` (`client/record/`), shared by both arms; `delivered` is stamped by the same `wrapSession` for both |
| Wire | identical — same server binary, same fixture, same `--stream-mode` |
| Server | a fresh `exact-server` per run, its own telemetry file, telemetry feature build |
| Browser | a fresh Chromium 141.0.7390.37 per run, headless |
| Ordering | interleaved per repeat, **and the slot order alternates**, so "went first" is not confounded with arm |
| Varied | frame size (32 KB / 250 KB), link (loopback / 20 / 60 / 150 ms at 10 Mbit), ask cell (on-demand d=1 / fill), stream mode (per-frame / shared) |

Percentiles are nearest-rank everywhere, the rule this repo's three other reporters already use.
Row selection repeats the client report's own rule (`client/record/report.ts`): drop the run's
first ask, drop rows that did not close on a stamp, drop rows whose stamps were shadowed by a long
task. So the numbers here and `summary.distributions` in each run agree.

Two levels of statistic, because they answer different things. **Per-run**: one median (or p95)
per run, arms compared over runs, exact two-sided permutation test — rows inside a run are not
independent, runs are the unit that repeats. **Pooled**: every usable row of the arm, for
distribution shape and a tail with enough samples. Headline claims use the per-run test.

---

## 3 · Where this deviates from the plan's method

Stated up front, because two of these change how the result should be read.

**No netem.** Plan §4 asks for netem in a user netns. This kernel is built without it
(`CONFIG_NET_SCH_NETEM` is not set; `tc` accepts only `htb`/`tbf`/`pfifo` here). The shaping is
done instead by `lab/scripts/link_shim.py`, a user-space FIFO bottleneck in front of the server's
UDP port: serialization at the configured rate, propagation delay, tail drop past the buffer.
`lab/scripts/link_shim_check.py` measures what it actually delivers:

| asked | measured RTT median | min / max | σ | one-way goodput | loss |
| --- | --- | --- | --- | --- | --- |
| 20 ms, 10 Mbit | 22.80 ms | 22.60 / 23.32 | 0.14 ms | 10.006 Mbit | 0 / 800 |
| 60 ms, 10 Mbit | 62.94 ms | 62.02 / 63.42 | 0.20 ms | 9.992 Mbit | 0 / 800 |
| 150 ms, 10 Mbit | 153.06 ms | 152.91 / 153.44 | 0.12 ms | 10.007 Mbit | 0 / 800 |

A fixed +2.8 to +3.1 ms of shim overhead, σ ≤ 0.20 ms. That overhead is a **common term**: it sits
identically in front of both arms, so it cannot create a difference between them. The cells report
nominal RTT; add ~3 ms for what the packets saw.

**An unshaped loopback cell was added.** Plan §4 says "do not run this on localhost", and that
warning is respected for the *headline*: §1's conclusion about whether the runtime reaches the
reader comes from the shaped cells. The loopback cells are kept for the opposite purpose — with
the network floor removed they are the most sensitive place to detect a CPU-side difference at
all, and they are where the frame-size comparison in §5 is possible. They are reported as a
sensitivity cell, never as a latency claim.

**One machine, 4 cores.** T2 at best, as the plan says. Server and link on cores 0–1, Chromium on
cores 2–3 (§4).

**The shaped fill cell was mis-sized on the first attempt** and is kept as evidence rather than
deleted — see §6.

---

## 4 · Controls

### 4.1 A control failed in the pilot, and the apparatus was fixed before anything was recorded

The first pilot reported the server's own `prepare_us` at **877 µs** for whichever arm ran first
against **108 µs** for the second. The server does identical work in both cases; that is the page
cache, not the arm — and it leaked straight into the client's `serve_plus_path`, which would have
been read as a WASM cost. Plan §6: *a control that fails is a stop, not a footnote.*

Three fixes, all in the driver: the study file is read once before the cell and each arm gets a
discarded warm-up run; server and browser are pinned to different core pairs, so the arm that
burns more client CPU cannot slow the server it is measured against; and the slot order alternates
per repeat. Nothing in this report was recorded before those were in.

### 4.2 A/A — the whole apparatus against itself

`--arms ts,ts`: the same client, twice, through every part of the rig — 6 repeats each,
2 394 usable rows per slot.

| metric | slot 0 | slot 1 | delta | ratio | p |
| --- | --- | --- | --- | --- | --- |
| `deliver_us` median | 273.3 | 266.7 | −6.7 µs | 0.976 | 0.38 |
| `deliver_us` p95 | 375.0 | 368.3 | −6.7 µs | 0.982 | 0.67 |
| `ask_to_complete_us` median | 2 509.2 | 2 534.2 | +25.0 µs | 1.010 | 0.54 |
| `ask_to_complete_us` p95 | 3 198.3 | 3 338.3 | +140.0 µs | 1.044 | 0.19 |

**The floor: ≤1 % on medians, ≤5 % on p95, nothing significant.** Any A/B claim below that is the
apparatus talking.

### 4.3 Per-cell controls — the server and the link did the same thing for both arms

Independent of the client report. Server figures come from the server's own Tap; link figures from
the shim's own counters.

| cell | server `serve_us` p50 (wasm / ts) | bytes sent | `transfer_us` median Δ (wasm − ts) | link drops (wasm / ts) |
| --- | --- | --- | --- | --- |
| local-250k-ondemand | 177 / 173 | identical | +8.3 µs, p 0.53 | — |
| local-250k-ondemand-shared | 160 / 161 | identical | +21.7 µs, p 0.13 | — |
| local-32k-ondemand | 94 / 94 | identical | n/a — 5 / 2 multi-read rows of 2 394 | — |
| shaped20-250k-ondemand | 162 / 165 | identical | −196 µs on 203 ms, p 0.31 | 120 / 119 of ~66 k |
| shaped60-250k-ondemand | 165 / 162 | identical | **−4 µs on 202 ms, p 0.94** | 38 / 46 of ~70 k |
| shaped150-250k-ondemand | 165 / 172 | identical | −113 µs on 202 ms, p 0.06 | **0 / 0** of ~56 k |
| shaped60-250k-fill | 196 / 198 | identical | −994 µs on 8.13 s, p 0.91 | 1 205 / 1 197 of ~42 k |

Reads per frame match arm to arm in every paced cell — 1/1 at 32 KB, 6/6 and 7/7 on loopback,
166/166, 168/168, 175/176 shaped. The one exception is `local-250k-fill`, where the same 20 MB
arrives in 57 reads per frame on the WASM arm and 108 on the TS arm: on an unshaped loopback the
read granularity follows the consumer's pace, so it is an outcome of the arm, not a wire the arms
were given differently. It is another reason §5 leans on the paced cells.

Across all nine cells: rows opened equal rows closed, rows usable and rows total match arm to arm,
**zero** long tasks inside any run window, and **zero** rows set aside as busy. Every client report
is `integrity.valid` except the five in §6.

### 4.4 Where the controls do *not* hold, and what that costs

Two honest exceptions, both in the **fill** cells:

- **The server is not independent under fill.** It blocks in `write_all`, so the client's read rate
  feeds back into the server's own timing. `local-250k-fill` shows `serve_us` 318 µs (wasm) against
  257 µs (ts) for identical work. Server-side numbers are a valid control only in the paced
  on-demand cells; in fill they are an outcome.
- **`deliver_us` is not a boundary measure under fill.** Per the report contract, preload rows close
  at `last_byte` and a later `delivered` mark backfills them — so the 45 ms figure in
  `shaped60-250k-fill` is the app's in-order wait position, not the WASM/JS crossing. It is
  reported but carries no §5 weight.

---

## 5 · Results

### 5.1 The per-frame boundary cost

`deliver_us` = last byte observed on the wire → the app's promise settles. Positive = WASM slower.
Per-run medians, mean over runs, exact permutation p.

| cell | frames | link | wasm | ts | **delta** | ratio | p |
| --- | --- | --- | --- | --- | --- | --- | --- |
| local-32k-ondemand | 32 KB | loopback | 187.5 | 130.0 | **+57.5 µs** | 1.44 | 0.0022 |
| local-250k-ondemand | 250 KB | loopback | 310.0 | 275.8 | **+34.2 µs** | 1.12 | 0.0152 |
| local-250k-ondemand-shared | 250 KB | loopback | 201.7 | 175.8 | **+25.8 µs** | 1.15 | 0.0022 |
| shaped20-250k-ondemand | 250 KB | 20 ms | 387.5 | 333.8 | **+53.8 µs** | 1.16 | 0.0286 |
| shaped60-250k-ondemand | 250 KB | 60 ms | 387.0 | 337.0 | **+50.0 µs** | 1.15 | 0.0079 |
| shaped150-250k-ondemand | 250 KB | 150 ms | 392.5 | 342.5 | **+50.0 µs** | 1.15 | 0.0286 |
| *A/A floor* | 250 KB | loopback | *273.3* | *266.7* | *−6.7 µs* | *0.98* | *0.38* |

In the A/A row the two columns are slot 0 and slot 1 of the same TypeScript client, not two arms.

Six independent cells, same sign, same order of magnitude, every one past the A/A floor. Note the
p-values on the shaped cells are at the floor their run counts allow (0.0079 = 2/252 at 5×5;
0.0286 = 2/70 at 4×4) — that is *perfect separation of every run*, not a marginal result.

### 5.2 It is flat in frame size — so it is not the copy

The cleanest comparison in the campaign: same link, same cell, same stream mode, same depth, only
the frame size differs.

| frame size | reads/frame | wasm | ts | delta |
| --- | --- | --- | --- | --- |
| 32 KB | 1 | 187.5 | 130.0 | **+57.5 µs** |
| 250 KB | 6 | 310.0 | 275.8 | **+34.2 µs** |

**7.8× more bytes, and the penalty goes down.** Whatever the WASM path is paying, it is not paying
per byte. Across the shaped cells — where the frame arrives in ~170 reads and the CPU is otherwise
idle between frames — the penalty is a flat +50 to +54 µs at 250 KB.

The source reading confirms the byte accounting the plan relied on, and it is still right:

- **TS** — `ByteAccumulator.take` (`client/transport-ts/session.ts:291`) is one full-frame copy;
  `unwrapEnvelope` (`wire.ts:25`) then returns a `subarray`, which copies nothing. **One pass.**
- **WASM** — `RecvBuf::push_chunk` (`client/transport-wasm/src/session.rs:106`) copies each read
  from the JS heap into linear memory; `js_buffer_from` (`session.rs:30`) allocates a fresh
  `Uint8Array` and copies the finished frame back out. **Two passes**, as
  `copies_per_frame_declared: 2` says.

So the WASM arm really does move every frame twice. The extra pass is real. Two things say it is
not what the clock is measuring:

- **At 32 KB the copy is too small to pay for the penalty.** The extra pass moves 32 KB. Even at a
  pessimistic 2 GB/s that is ~16 µs against a measured penalty of **57.5 µs** — at least two thirds
  of the cost is something other than copying, and at a more realistic 8 GB/s it is over 90 %.
- **Multiplying the extra bytes by 7.8 makes the penalty smaller, not larger.** No byte-proportional
  term can do that. Whatever grew, something else shrank by more.

**The extra copy is real and it is not the cost.** What the data supports is a charge for crossing
the boundary once per frame at all, roughly fixed in frame size. This experiment does not separate
the candidates for it — a JS-heap allocation per frame, the wasm-bindgen glue, and the
futures-executor wake that resolves the promise are all per-frame and all consistent with the shape
observed. Deciding between them needs a probe inside the delivery path that this telemetry does not
have, and the report does not pick one.

One attribution note that matters for reading §5.1: WASM's per-read copy into linear memory happens
*during* arrival, before `last_byte`, so at 170 reads per frame it is charged to `transfer`, not to
`deliver`. `transfer` shows no arm difference (§4.3) — at 10 Mbit the link has 200 ms to hide it in.

### 5.3 End to end, it does not reach the reader

`ask_to_complete_us` = ask → the app holds the bytes, summed from the stages actually timed.

| cell | end-to-end median | measured delta | p | **boundary cost as a share of time-to-frame** |
| --- | --- | --- | --- | --- |
| local-32k-ondemand | 1.50 ms | +123.3 µs | 0.16 | 3.83 % |
| local-250k-ondemand | 2.67 ms | +33.3 µs | 0.56 | 1.28 % |
| shaped20-250k-ondemand | 227.4 ms | −127.5 µs | 0.66 | 0.024 % |
| shaped60-250k-ondemand | 266.9 ms | **+127.0 µs** | **0.0079** | 0.019 % |
| shaped150-250k-ondemand | 356.3 ms | −26.2 µs | 0.57 | 0.014 % |
| shaped60-250k-fill (40 frames) | 8.32 s | −14.3 ms | 0.064 | — |

Only one cell separates end to end, and there the difference is 127 µs on 267 ms — **0.048 %**.
Everywhere else the arms are statistically indistinguishable, and in two shaped cells the sign
flips to TS being slower, which is what noise looks like. The `shaped20` p95 shows TS 7.0 ms worse
(p 0.029), but that tracks a `transfer` p95 difference and 4 % more downstream packets on the TS
arm for identical bytes — link-tail retransmission, not a runtime term, and it is not claimed as a
WASM win.

Read §5.1 and §5.3 together: **the effect is real, and it is 0.02 % of the thing the reader waits
for.** Statistical significance and practical significance point in opposite directions here, and
the shaped link is deterministic enough (σ ≤ 0.20 ms) to make a 50 µs shift separate every single
run while remaining invisible to anyone using the product.

### 5.4 Bulk transfer

`local-250k-fill` (20 MB on loopback) and `shaped60-250k-fill` (10 MB at 10 Mbit):

| cell | wasm wall | ts wall | `ask_to_complete` median delta | p |
| --- | --- | --- | --- | --- |
| local-250k-fill | 236 ms | 244 ms | −5.9 ms (WASM faster) | 0.71 |
| shaped60-250k-fill | 8 370 ms | 8 372 ms | −14.3 ms (WASM faster) | 0.064 |

Nothing significant, and the sign is *toward* WASM. On the shaped link 8.13 s of the 8.32 s is the
link itself, delivered to both arms within 994 µs of each other. **Bulk throughput does not
distinguish these two clients.**

---

## 6 · A behavioural divergence: the batch timeout

The first shaped fill cell was mis-sized — 80 × 250 KB is 20 MB, ~16.5 s at 10 Mbit, past the
15 s frame deadline both clients declare. That makes it useless as a throughput cell, and it is
excluded from §5. But it is not noise, and it reproduced **5 repeats out of 5**:

| arm | delivered | wall | client report |
| --- | --- | --- | --- |
| `transport-wasm` | **80 / 80** | 16 546 ms | valid |
| `transport-ts` | **51 / 80** | 15 002 ms | **VOID** — `byte_closure_ok false`, 29 timeouts |

Both clients define `FRAME_TIMEOUT_MS = 15_000`. The constant is the same; **the arming point is
not**:

- **TS** — `startExactFrames` (`session.ts:181`) calls `armWaiter` for every index up front, and
  `armWaiter` (`session.ts:77`) starts its `setTimeout` immediately. All 80 deadlines run
  concurrently from the ask, so the deadline is on the **whole batch**.
- **WASM** — `start_frames` (`session.rs:368`) stores only a `oneshot::Receiver` per frame; the
  `TimeoutFuture` is created inside `await_bytes` (`session.rs:449`), which runs when the app awaits
  *that* frame. Awaiting in order restarts the deadline per frame, so the deadline is on **one
  frame's wait**.

A batch that cannot drain in 15 s loses its tail on TS and completes on WASM. For a PACS client
this matters more than the 50 µs: at 10 Mbit, 15 s is about 75 frames of 250 KB — well inside one
cine loop — and the failure mode is a partial study, with nothing lost on the wire and no error
that names the real cause. It is a divergence in the clients, not in the runtimes — nothing about WASM or JS forces
either arming point — but it is exactly what a same-wire comparison is for. The evidence is kept
at `.local/measurements/n6/VOID-shaped60-250k-fill-80f/`; the valid 40-frame cell replaced it.

**Not fixed here.** Product code was out of scope for this work. The narrower shape, if it is
wanted, is to arm the TS batch deadline where the WASM one is armed — in `waitExactFrame` — or to
scale it by working-set size.

---

## 7 · One-time and footprint

Both are real costs that per-frame latency never sees.

**First load.** What a page fetches before the first ask, product builds, uncompressed / gzip -9:

| arm | bytes | gzip | at 10 Mbit | at 100 Mbit |
| --- | --- | --- | --- | --- |
| `transport-wasm` | 270 292 (242 290 wasm + 28 002 glue) | 108 869 | 216 ms | 22 ms |
| `transport-ts` | 8 812 | 2 537 | 7 ms | 0.7 ms |
| delta | **+261 480 B (30.7×)** | +106 332 | **+209 ms** | **+21 ms** |

These transfer figures are computed, not measured: the static host was deliberately left unshaped
so the module download would not contaminate the per-frame cells. What *was* measured is the rest
of startup — `connect_ms` is **+17 ms** for WASM in every cell (24.4 vs 7.4 local; 212.6 vs 194.9
at 60 ms RTT), stable across links, so it is compile and instantiate rather than transfer.

**Footprint.** `usedJSHeapSize` is coarse and GC-dependent — read these as direction, not precision.
In the paced on-demand cells the two arms are indistinguishable (70.9 vs 70.7 MB). Under fill they
are not, because WASM holds the receive buffer in linear memory *as well as* handing frames to the
JS heap:

| cell | WASM JS heap + linear | TS JS heap |
| --- | --- | --- |
| local-250k-fill (20 MB) | 50.8 + 23.8 = **74.6 MB** | **32.6 MB** |
| shaped60-250k-fill (10 MB) | 28.6 + 17.1 = **45.7 MB** | **24.7 MB** |

Roughly 1.9–2.3× the peak footprint for the same work. For a viewer holding several studies this is
worth more attention than the 50 µs.

---

## 8 · What this does and does not say

**Says.** On one wire, one server and one shell, the WASM receive path costs a fixed ~50 µs per
frame more than the TypeScript one, it is not the predicted copy cost, and it is 0.02 % of
time-to-frame on any realistic link. Choosing between these two clients on per-frame receive
performance is choosing on a term that does not matter. The costs that do differ are first load,
peak memory under bulk, and one timeout behaviour that today favours WASM.

**Does not say.**

- **Nothing about decode or paint.** The telemetry's decode / paint / cache stages are `null` by
  design. The plan's goal metric is *time-to-displayable*; this measures time-to-bytes. If a
  clinical decoder lives in WASM, handing it bytes that are already in linear memory could reverse
  the sign of §5.1 entirely — the copy the WASM arm pays here is a copy the TS arm would then owe.
  **That is the experiment worth running next**, and it is the one that decides the architecture.
- **Nothing about a different transport stack.** Out of scope by plan §7, and still is.
- **Nothing above T2.** One 4-core machine, synthetic shaping, no competing load, no real network,
  no loss beyond what the bottleneck buffer produced. The zero-loss 150 ms cell is a clean link,
  not a realistic one.
- **Nothing about `set_priority`, stream-mode choice, or depth.** Depth was pinned at 1 (the
  control) throughout; both stream modes were tested only to check the finding replicates, which
  it did.
- **Not a claim that the 15 s divergence is a WASM property.** It is a difference between two
  hand-written clients that happens to fall this way.

**One asymmetry worth naming.** The per-frame finding disfavours WASM; the timeout finding
disfavours TS; the footprint finding disfavours WASM; the bulk-throughput sign, though not
significant, favours WASM. Nothing here lines up behind one arm, which is roughly what should be
expected from two implementations of the same protocol whose real differences are structural
rather than a matter of speed.

---

## 9 · Reproduce

```bash
scripts/gate.sh                                    # the tree, before anything is measured
lab/scripts/gen_tf_fixtures.sh                     # 32 KB / 250 KB studies
lab/scripts/link_shim_check.py --delay-ms 30 --rate-mbit 10   # the link is the link it claims
lab/scripts/n6_run_all.sh                          # the campaign — nine cells, about an hour
lab/scripts/n6_analyze.py --all --tsv out.tsv      # controls, then the comparison
```

Runs land in `.local/measurements/n6/<cell>/r<NN>-s<slot>-<arm>/` — the client report, the server
report, every server row, the shim's own counters, the `verify_e2e.py` log, and an `n6.json` naming
the cell. Harvest is `server/scripts/verify_e2e.py`, unchanged; the driver only owns the server and
the link and hands the browser over via `--wt-url`.

Recorded here: [`measurements/n6/n6_summary.tsv`](measurements/n6/n6_summary.tsv) (every
metric × statistic × cell), [`n6_cells.json`](measurements/n6/n6_cells.json) (full per-cell
aggregate), [`n6_runs.tsv`](measurements/n6/n6_runs.tsv) (one row per run, with git sha and
Chromium version), [`n6_analyzer_output.txt`](measurements/n6/n6_analyzer_output.txt) (the
analyzer's own rendering of all ten cell directories — the nine reported plus the voided one), and
the three [`link-shim-check-*.json`](measurements/n6/) validations.

**Provenance.** Chromium 141.0.7390.37, 4 × Xeon @ 2.10 GHz, 16 GB. The runs span five commits
(`n6_runs.tsv` carries the sha per run) because the analyzer and the cell list were edited while
the campaign was in flight. Nothing that produced a measurement changed across them: every commit
between the first cell and the last touched only `lab/scripts/n6_analyze.py` (which reads the data
afterwards) and `lab/scripts/n6_run_all.sh` (which only sequences cells). The product code, the
harness shell, both client builds, the telemetry seam, the server binary, `n6_campaign.py` and
`link_shim.py` were byte-identical for all 106 runs.

    git log --oneline 07a070f..fb080cc --name-only    # the five commits and what each touched
