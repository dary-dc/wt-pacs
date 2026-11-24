# The pages' cloud runs: one pre-registered protocol

Written 2026-11-24 by row PAGE-RUNS-PROTOCOL (`claude/work-ledger:docs/queue-2026-11-24.md`), a session that runs
none of the runs below and builds nothing; nothing was run for this file but `git` reads. It pre-registers the cloud
runs the decision pages queue (`claude/reviews-2026-11-28:docs/decisions/README.md` §*Not answered*, last paragraph),
one section each. Inputs read at: `origin/claude/unified` `b059388b6`, `claude/reviews-2026-11-28` (the pages),
`claude/transport-arms`, `claude/transport-design`, `claude/report-arms`, `claude/report-plan`, `claude/engines`,
`claude/core-m5b`, `claude/cache-arms`, `claude/cache-plan`, `claude/non-cine`, `claude/docs-client`. A path given
without a branch is on the branch the section names.

**For every section.** Arms are interleaved (a Williams order per round, `lab/order.mjs`), never in blocks; each cell
says latency or throughput, not both; every cell is read against its prediction here, misses included; a protocol
change after the first counted row is an amendment in this file, dated, before the next row. Every number is
labelled **measured** (an earlier row's, cited), **derived**, **theory**, **simulated** or **assumed**.
Rows are pushed as they land. **Fixtures and limits** (every run): 19 DBT volumes of one dataset, three timed
(`dbts_a1`, `dbts_b1`, `dbts_c1`); breast ultrasound only `usb_cine` and `usb_cine_rgb`, lossy-sourced, so no run here
gives an ultrasound number; one 4-core cloud container without a GPU, software WebCodecs, headless Chromium, Firefox
where the run fetches it; a userspace relay, not a radio. On which links the link, not the decode, binds: §1's cells
are wire-bound by design (the relay's models of PUB, LTE and the full LTE queue); §4's are wire-bound at ρ ≈ 0.22.

| § | run row | page and item | runs in the cloud | built first (lab only) |
| ---: | --- | --- | --- | --- |
| 1 | TRANSPORT-FLAGS-RUN | `transport-stack` 2 | yes | per-arm server arguments; WT-TW, WT-PF; `lab-levers` build |
| 2 | REPORT-RERUNS | `reports` 3 | yes | the Firefox driver's three fixes; a µs sink clock; KEEPALIVE-Y° |
| 3 | ENGINE-CELLS | `engines` 3, 4 | yes | the G = 8 trace; pinned Firefox builds |
| 4 | ASK-CELLS | `asking` §6 | yes | the never-skipping display, the hold key, leg traces, the per-leg wait |
| 5 | CACHE-CELLS | `cache` 1 | yes, if CACHE-DESIGN-1124 keeps it | PSS by process, per-index verify, a handle a group, two VOID rules |
| 6 | as time allows | `pacs-sync`, `client-calls` 1 and 3, fault bench, `non-cine-series` | yes, but 6.4's cell 11; 6.5 after a build | as each names |
| 7 | — | `repository` 4 | **no**: two hosts | — (`blocked`; local commands) |

A build listed here is the run row's first step, lab code only, with its mutant killed before any counted row; if a
build cannot be made without product code, the run row stops, names it, and the cell stays unrun.

## 1 · Transport (`transport-stack` item 2) → TRANSPORT-FLAGS-RUN

**The question.** Does WebTransport, with flags the server already has, get the two wins the fetch arms showed (an
ask during a fill, cell AD; the credit-bound fill at ~0.8 s RTT, cell CR) before any second wire is considered? It
also answers PR 254's #39 and #96, which `transport-stack` §3 holds "for item 2's run".

**The rig as it stands, and what the run row adds first** (read at `origin/claude/transport-arms`):

* The arms are a fixed map in `lab/transport-arms/run.mjs:42-51` (`WT-TS`, `WT-TS'`, `WT-WASM`, `WS`, `H3-frame`,
  `H3-fill`, `H2-frame`, `H2-fill`); every visit starts the server with the same arguments (`run.mjs:188-191`), built
  with `--features lab-get` only (`run.mjs:113`).
* `--send-window-follows-cwnd` exists only under the `lab-levers` feature (`server/src/transport/lab_levers.rs:23-27`;
  a build without it refuses the flag, `server/README.md:142-147`). `--stream-mode per-frame` is in the default build
  (`server/src/transport/stream_mode.rs:12`).
* So **before any counted row** the run row adds, as lab code with one mutant each: a per-arm server argument list
  in `run.mjs`; the server built `--features lab-get,lab-levers`; two arms, **WT-TW** (`--send-window-follows-cwnd`)
  and **WT-PF** (`--stream-mode per-frame`). Mutants: WT-TW started without its flag must read as a tie with WT-TS on
  AD-PUB (the flag is what is measured); a server that silently ignores an argument must fail the visit (the server's
  start line, which echoes its options, is checked by `judge.mjs`). No product code changes.

**A naming conflict, recorded, not resolved here.** The page calls `--send-window-follows-cwnd` "the one queue". In
`claude/docs-client:docs/client/evidence/ask-during-a-fill.md:21-23` the one queue (Q) is `--fill-resumes-after-asks`,
QW is Q plus the window, and TW is the window alone; the same file finds TW's asks within ±0.04 of QW's (`:132`).
`--fill-resumes-after-asks` is on `origin/claude/unified` (`server/src/main.rs:140`) and absent from the rig's server.
This run measures **TW and PF**, the two flags the page names; QW is not an arm. If TW misses below, the page's
"WT with its flags" is answered for TW and PF only, and QW is named as untested.

**Arms (6):** WT-TS (reference), WT-TS' (A/A), WT-TW, WT-PF, H3-fill, H3-frame. **Cells**, the rig's own
(`run.mjs:54-68`): AD-PUB (10 ms one way, 90 000 kbit, 2 000-packet queue; n 50, the ask at frame 8), AD-LTE (19 ms,
50 000 kbit, 3 300 packets, iid loss 0.1 %; n 16, the ask at frame 4), CR (400 ms one way, 90 000 kbit, 1 875 packets;
a fill of 50). Measures as the rig records them: AD the asked frame's last byte − the page's ask call; CR the latest
last byte − the dial. **Latency for AD, fill time for CR**; never both for one cell. Fixture `dbts_b1` as HTJ2K
(50 frames, 2.15 MB a frame), as the baselines.

**Rounds and order.** 12 rounds a cell (two Williams periods of six arms, `lab/order.mjs`; `balanced()` must not flag
`UNBALANCED`), the cells in the order AD-PUB, CR, AD-LTE, each cell's rounds contiguous, arms rotated within each
round. `aa_rule.py --bar 0.05` on WT-TS' and each candidate, as §6.6.

**Predictions** (ratio to WT-TS in the same round, median; **derived** unless labelled):

| cell | WT-TW | WT-PF | H3-fill / H3-frame (reference, re-measured) |
| --- | --- | --- | --- |
| AD-PUB | **×0.80–1.02** | ×1.00–1.80 | 0.50–0.60 / 1.6–2.0 (measured 0.548 / 1.809) |
| AD-LTE | **×0.85–1.02** | ×1.00–1.70 | 0.47–0.58 / 1.5–1.9 (measured 0.525 / 1.678) |
| CR | ×0.97–1.03 | **×0.60–1.00** | 0.95–1.05 / 0.58–0.70 (measured 1.001 / 0.630) |

* **WT-TW on AD.** What the ask waits behind is the fill already admitted to the send window. TW sets that window
  to cwnd plus two of the series' largest frames (`server.rs:148-155`): 2 × 2.15 MB ≈ 4.3 MB plus cwnd, against
  today's 6 MiB. It gains only while cwnd < 6 MiB − 4.3 MB ≈ 2.0 MB. PUB's queue holds 3.0 MB and LTE's 5.0 MB, and
  Cubic fills a tail-drop queue, so under a fill cwnd may pass 2 MB: hence a band that reaches a tie (**theory**,
  not traced). The earlier ×0.32–0.90 was QW's, measured on 0.57 MB frames, where two frames are 1.1 MB
  (`ask-during-a-fill.md:76-88,130`; Chromium 141, another rig), so it does not carry to `dbts_b1` (**derived**).
* **WT-PF on AD.** A stream a frame does not by itself put the asked frame ahead of streams already open; H3-frame,
  its nearest analogue, was ×1.68–1.81 slower. Predicted no gain (**theory**; quinn's scheduling of equal-priority
  streams not read for this file: the run records each stream's priority if the server exposes it).
* **WT-PF on CR.** H3-frame's ×0.630 came from escaping one stream's 6 MiB credit, which caps a stream at ~63 Mbit/s
  over 0.8 s (`transport-stack` §5). PF escapes it too **if** Chromium's connection-level receive window for a
  WebTransport session exceeds 6 MiB; not read here, an **assumption**, which is why the band reaches a tie. A tie
  says the connection window binds; the run records the session's flow-control-blocked events from the server's
  QUIC statistics if present.
* **WT-TW on CR**: the cap is the client's stream credit, not the server's window, so a tie (**theory**).

**Refuted, for each:** the cell's median outside its band. **What decides the page** (its §6): WT-TW or WT-PF at
≤ ×0.8 of WT-TS's ask on AD, i.e. as good as the fill-shape fetch's ×0.50–0.68 band's upper end, keeps "no GET path";
both above ×0.8 on AD leaves the page's next step ("a GET path for asks alone is the next structural draft"). WT-PF
≤ ×0.75 on CR answers CR within WebTransport. #39 and #96 (asks first under a 6 MiB send window; the one queue as
product code) are answered **only** by these rows' AD ask and CR fill together: a lever that gains the ask and costs
the fill more than ×1.05 is a trade-off for the owner, not a default.

**VOID** (the rig's `judge.mjs:27-31`): the relay guard's p99 over 1 ms; the busiest core over 0.95; a crash; a fetch
arm on the wrong protocol; a visit past 3 × the pilot median (`rows/pilot-medians.json`, extended by a 2-round
pilot for WT-TW and WT-PF, not counted); a server whose start line lacks the arm's flag. Over 25 % `VOID` in a cell:
both readings, strict and round-paired, as §6.6. **Host:** relay on core 0, server on core 1, driver and browser on
2–3 (the rig's pinning, RESULTS-BRIEF §1.12's recommendation already met); the relay saturates at 100 Mbit/s and
nothing is claimed above 90. The links are a userspace relay's models, **assumed**, not a radio.

**Commands** (after the additions above, on `claude/page-runs` from `origin/claude/transport-arms`):

```bash
cargo build --release -p series-server --features lab-get,lab-levers
node lab/transport-arms/run.mjs --cell AD --rounds 12 --arms WT-TS,WT-TS\',WT-TW,WT-PF,H3-fill,H3-frame \
  --pilot-medians lab/transport-arms/rows/pilot-medians.json --limit-ms 600000 --out rows/flags-AD.jsonl
node lab/transport-arms/run.mjs --cell CR --rounds 12 --arms WT-TS,WT-TS\',WT-TW,WT-PF,H3-fill,H3-frame \
  --pilot-medians lab/transport-arms/rows/pilot-medians.json --limit-ms 600000 --out rows/flags-CR.jsonl
python3 lab/transport-arms/summary.py lab/transport-arms/rows flags-AD
```

Rows are pushed after each cell.

## 2 · Reports (`reports` item 3) → REPORT-RERUNS

**The question.** The page's item 3 (`docs/decisions/reports.md:41`): "two rerun rows in phase 2, each written before
its rows": **(a)** C, "judged by its median within the A/A's band, with a KEEPALIVE arm that uses `off`'s decoder";
**(b)** Lbusy, plus D5a on a busy page, "with an absolute A/A and a sub-ms sink clock". What they decide
(`reports.md:135-137`): KEEPALIVE-Y over BEACON-Y if (b) shows a race the page-thread carriers lose on a busy page
**and** (a) shows KEEPALIVE-Y's C cost comes from its wrapped decoder; otherwise BEACON-Y. First, **the Firefox rig
defect** that left REPORT-RUN-2's Firefox cells unrun.

**0. The Firefox defect, fixed first (lab code, `claude/report-arms`).** REPORT-RUN-2 started D1 on Firefox 160.0.1
three times and finished none: a silent hang at loads 70 and 69, and a full disk at load 101
(`claude/report-plan:docs/client/evidence/report-plan.md:1582-1596`; `claude/work-ledger:docs/queue/REPORT-RUN-2.md`).
Causes read in code: `lab/report-arms/bidi.mjs:24-37` keeps pending calls in a map that nothing rejects when the socket
closes; the Firefox path of `run.mjs` has no per-load timeout; `launch()` (`bidi.mjs:42`) leaves a ~108 MB profile in
`/tmp` per load. The fix the plan names (`report-plan.md:1723`): `bidi.mjs` rejects pending calls on close, a load
times out (120 s, then the browser is killed and the load recorded `VOID: driver`), the profile is removed after each
load; `FIREFOX_PATH` required, no scratch default (`docs/reviews/report-arms.md:306-308`). Three mutants, each killed
by a test with a fake BiDi socket: the close not rejecting, the timeout removed, the profile kept. ~2–3 % of Firefox
loads never fill (`reached: "starting"`, 7 of 240, cause unknown): recorded, each `VOID: no fill`, never dropped.

**(a) C, the page thread's cost.** Arms (7): `off`, `off′` (A/A), BEACON-H, BEACON-Y, KEEPALIVE-H, KEEPALIVE-Y,
**KEEPALIVE-Y°** (KEEPALIVE-Y's carrier with `off`'s decoder: the run row builds it as a unit string, `keepalive:Y:offdecoder`
or as the rig names it, with a mutant: KEEPALIVE-Y° built with the wrapped decoder must not read as `off`).
28 rounds (two Williams periods of seven, mirrored) × 7 arms = 196 loads, Chromium only (Firefox has no long-task
observer, `report-plan.md:1055`). Measure: fill time, ratio to `off` in the same round. **Bar**: an arm's median
per-round ratio inside `off′`'s own interquartile band in this run (measured last run 0.964–1.104,
`report-plan.md:1671-1673`), and no added long task ≥ 50 ms.

| arm | predicted median ratio to `off` | basis |
| --- | --- | --- |
| `off′` | 0.98–1.02 | A/A (measured 1.013, 0.989) |
| BEACON-H, BEACON-Y | 0.96–1.06 | measured 1.052, 0.976; sign tests p 0.24, 1.0 |
| KEEPALIVE-H | 1.06–1.18 | measured 1.137, +16.7 ms, p 0.001 |
| KEEPALIVE-Y | 1.03–1.12 | measured 1.072, +9.2 ms, p 0.03 |
| **KEEPALIVE-Y°** | **0.97–1.03** | **theory**: the carrier's own page-thread cost is 0.44–1.73 ms a load (measured), far under 9 ms, so the cost is the decoder wrapping |

Refuted: KEEPALIVE-Y° outside 0.97–1.03; above it, the cost is the carrier's and (a)'s condition for KEEPALIVE-Y fails.

**(b) Lbusy and D5a on a busy page.** The sink's clock first: the receiver stamps each report's arrival with a
monotonic clock in microseconds (lab change, `lab/report-arms/`; mutant: a clock rounded to whole ms must fail the
A/A below). **Absolute A/A, written before any row:** BEACON-H's floor in even rounds against odd rounds within
0.95–1.05 (last run 1.28 against 1.16 ms, 1.095, `VOID`, `report-plan.md:1456-1464`; **theory**: the miss was the
whole-millisecond clock, 1 ms on a ~1.2 ms floor). Arms: all nine (`off`, the seven carriers, `off′`), 18 rounds,
Williams order, Chromium. Lbusy: a 50 ms long task every 100 ms (the rig's). D5a busy: Lbusy's long task, the
renderer killed 0–50 ms after the fault (`report-plan.md:1703-1705`).

| cell | predicted | basis |
| --- | --- | --- |
| Lbusy p99, `off` and BEACON-* | 45–55 ms | measured 50.84–51.39 (the run was `VOID` on its A/A only) |
| Lbusy p99, KEEPALIVE-* | ≤ 5 ms | measured 2.46 |
| Lbusy p99, SESSION-* | ≤ 5 ms | measured 1.99–2.31 |
| D5a busy, safety report delivered, KEEPALIVE-* and SESSION-* | 18/18 each | idle D5a 18/18 every arm (measured); these carriers sent within 5 ms under the long task |
| D5a busy, safety report delivered, BEACON-* | **4–14 of 18** | **theory**: the report waits for the page thread (p99 ≈ 51 ms) and the kill lands 0–50 ms after the fault, so about half are killed before the send |
| D5a busy, fill record | Y arms 18/18, H arms 0/18 | idle pattern (measured) |

Refuted: any band missed. **The race (b) asks for exists** if BEACON-* deliver ≤ 16/18 and KEEPALIVE-Y 18/18.

**Firefox cells (after 0).** The full list (D1 D2 D9 D4 D5b D8 D5a D3 D7 L Lbusy C, then D6 under `--tun`) is
~45 h of host time (`report-plan.md:1062-1063`), past this row's latest. In this order, as time allows, each a whole
cell of 18 rounds or not counted: **D5a, D1, L, D6**; the rest named unrun. Predicted: Chromium's pattern of
REPORT-RUN-2 (safety 18/18 every HTTP arm; H arms lose the fill record under a kill; SESSION-H fails the load bar),
with Firefox's known limits (`report-plan.md:1055`: no long-task observer; D7 not a bfcache test; D9 no freeze; the
renderer kill takes every content process). The uncounted partial D1 (240 loads) had the safety report in every
filled load and BEACON-H's fill record 24/28 (`report-plan.md:1598-1601`).

**VOID**: C if `off′`/`off` median outside 0.95–1.05; L if the A/A above fails; D's A/A `off` = `off′`; a mutant
not caught makes its arm's cell `VOID`; a round with host CPU over 90 % not counted (`report-plan.md:919-931`).
**Host:** peak 38 % CPU last run; the relay at 50 Mbit under `--tun` (100 Mbit its ceiling on 4 cores).

```bash
cargo build --release -p series-server --features telemetry -p pack-series -p report-receiver
C="beacon:H,beacon:Y,keepalive:H,keepalive:Y"   # (a) adds off, off', and KEEPALIVE-Y° as the rig names it
node lab/report-arms/run.mjs --receiver receiver --wait 60 --engine chromium --units "off,$C,<KEEPALIVE-Y°>,off'" \
  --endings C --rounds 28 --out rows/r3-chromium-C.jsonl
node lab/report-arms/run.mjs --receiver receiver --wait 60 --engine chromium --units "off,beacon:H,beacon:Y,keepalive:H,keepalive:Y,session:1,session:Y,session:H,off'" \
  --endings Lbusy --rounds 18 --out rows/r3-chromium-Lbusy.jsonl      # then --endings D5a with the busy page
FIREFOX_PATH=... node lab/report-arms/run.mjs ... --engine firefox --endings D5a --rounds 18 --out rows/r3-firefox-D5a.jsonl
```

## 3 · Engines (`engines` items 3 and 4) → ENGINE-CELLS

**Firefox builds.** No script installs a pinned Firefox: `scripts/wtcompat.py --fetch` takes only the latest release
and nightly (`origin/claude/engines:scripts/wtcompat.py:282-311`). The run row fetches 159.0.1 and 160.0.1 by hand from
`https://archive.mozilla.org/pub/firefox/releases/<ver>/linux-x86_64/en-US/firefox-<ver>.tar.xz`, checks each against
that release's `SHA256SUMS`, and records the binary's `--version` in every row.

**3a. The G = 8 trace (item 3).** On `client/contract/av1/g8x20` (8-bit, groups of 8, 20 frames), Firefox 159.0.1 and
160.0.1 return frames 1–7, 9–15 and 17–19 inexact and "elsewhere", not on their keyframe's decoder, on the WebCodecs
route only; every `dav1d:` variant is exact (`origin/claude/engines:docs/decode/engines.md:25,104,114-117`). The trace
says whose fault it is. Record, per frame, on each version: the decoder instance it was submitted to (by
`av1-webcodecs.js`), its keyframe's instance, the `EncodedVideoChunk`'s timestamp and type, each `output` callback's
`VideoFrame.timestamp` and the instance it came from, `decodeQueueSize` at submit, and every `flush()` and `reset()`.
The trace is lab instrumentation around the contract clause (no product change); mutant: a trace that drops the
instance id must fail its own completeness check (every frame has a submit and an output or an error).

* **Prediction (theory, low confidence):** the dispatch is ours. "Elsewhere" means the frame reached a decoder that
  did not hold its keyframe, which is the client's routing, and the same clauses pass on Chromium; so a decision in
  `av1-webcodecs.js` that depends on callback timing (when an output or a dequeue arrives) routes differently on
  Gecko. **Refuted** if the trace shows every frame submitted to its keyframe's instance and the wrong samples
  coming back from it: then the engine's `VideoDecoder` is at fault, and the page's item 3 reads so.
* Command: `FIREFOX_PATH=<159.0.1 or 160.0.1> client/contract/run_firefox.sh dispatch` with the trace on; 3 runs a
  version (the clause is deterministic in its failure set, `engines-smoke/c2-dispatch-firefox159.log` and `…160.log`).

**3b. M5 under the amended bar on 160.0.1 (item 4).** The rig is `claude/frame-memory-m5-run@1a90eb9` with
`claude/core-m5b`'s `lab/opfs-cache/` (`run.mjs`, `summary.py` and the arm files are not on `claude/unified`),
decoders checked against its `manifest.sha256`; Firefox over Marionette on Xvfb, not BiDi (BiDi hangs nested
workers, `origin/claude/unified:docs/client/evidence/frame-memory-ownership.md:396-426`, *FMO* below).
**Arms.** The page names "`ring` and `disk` with the A/A pair"; `m5` runs six arms, `ring, ring2, transfer,
transfer-k, disk, today` (`core-m5b:lab/opfs-cache/run.mjs:433-447`), and cannot run a subset outside `--mutant`, and
the fill bar is a ratio to `today`. So all six run (the Williams order unchanged); `ring`, `ring2` and `disk` are the
ones this cell rules on, the other three reported.
**Setup** (FMO:90-125): 80 frames of 3328×4096 (2.03 GiB) on loopback, a 256 MiB window, a fresh profile per arm;
growth = the browser tree's peak PSS, sampled each second, minus the value before the dial; every frame checked.
**The amended bar** (2026-11-02, before data; FMO:199-216, 490-523): every round's growth ≤ median `disk` growth +
320 MiB; median ask and step ≤ `ring`'s + 16.7 ms; median fill ≤ 1.10 × `today`'s, fill time = navigation to the
last frame written to disk, read the same way in every arm; fewer than 80 frames on disk is incomplete; the stamp
check 0–500 ms. 7 rounds, Firefox 160.0.1 alone (the page's cell; Chromium was measured under this bar already).

| measure (MiB, median) | predicted, 160.0.1 | anchors (measured) |
| --- | --- | --- |
| `disk` growth | 420–580 | 440 on 155.0; 542 on 159.0 |
| `ring` growth | 680–880 | 702 on 155.0; 828 on 159.0 |
| `ring` − `disk` | **250–310**, so `ring` qualifies on memory | 262 (155.0), 286 (159.0, struck bar) |
| `ring` fill ÷ `today` (amended reading) | **0.80–0.95** | 0.85 on 155.0; 159.0's 1.30 was under the struck reading, which read 155.0 at 1.23 |
| `ring2` vs `ring` | within 64 MiB and 0.90–1.10 in fill | A/A 22–30 MiB |

**Theory** (`engines` §5): the ring's memory is fixed by its design, so a new Firefox moves only the floor; the bar is
not expected to flip. Refuted: `ring` − `disk` over 320 (the bar flips), or the fill ratio over 1.10.

**VOID** (FMO:112-119, unchanged by the amendment): median |`ring2` − `ring`| over 64 MiB, or median `ring2`/`ring`
fill outside 0.90–1.10; a `VOID` cell decides nothing. A fill that drops the host under 1 536 MiB available stops as
"host saturated" (`run.mjs:193`); Firefox's quota is set to 4 096 MiB (`run.mjs:25`). **Host:** 4 vCPU, 16 GiB, no
GPU; CPU 0.65–0.80 busy through Firefox fills last time, so the host is near its ceiling and a fill time is claimed
only as a ratio inside a round, never as an absolute.

```bash
NODE_PATH=$(npm root -g) PYTHON=.venv/bin/python FIREFOX_PATH=<160.0.1> \
  node lab/opfs-cache/run.mjs --cell m5 --rounds 7 --engine firefox --out rows/m5-ff160-amended.jsonl
python3 lab/opfs-cache/summary.py rows/
```

## 4 · Asking (`asking` §6: P1, P1b, P1c, the corrected P2) → ASK-CELLS

**The question.** Which frames does the store let go first when a reader scrolls back and forth past its window?
The definitions are `origin/claude/unified:docs/client/evidence/ask-model.md` §7 (the table at lines 320–325), the
page's §6 (`docs/decisions/asking.md:119-123`) points to them, and P2 as corrected by ASK-MODEL-FIX-REVIEW's n1
(`claude/work-ledger:docs/queue/ASK-MODEL-FIX-REVIEW.md:10-12`). The model leaves to this row "the bands, the VOID
rule and the A/A pair before any row" (`ask-model.md:313-315`); they are fixed here.

**Fixture and cell.** `dbts_b1`, 50 × 2560×3328, 10 of 16 bits (`docs/FIXTURES.md:393`), 17.04 MB a decoded frame,
so 256 MiB holds 15: W = 15 (`ask-model.md:106`). ρ = 0.216 is 20 Mbit/s over 3.71 Mbit a frame at 25 steps a
second (`ask-model.md:277`): link `r20000`, the relay's round trip 40 ms. Each cell measures μ̂ (frames a second
the link delivers, no reader) first, and reports its own ρ.

**Built first (lab only, `lab/viewer/` and `lab/av1/delivery/total-time/`), each with a mutant; none exists today:**
(a) a display that never skips, its target apart from the displayed frame; (b) the hold key, the arms' order of what
to let go (`client/view/controller.js:74` takes a budget and lets go the farthest frame, which is *centred*; the other
orders are lab levers); (c) traces with a set leg length, a dwell at each turn and a one-way path (`lab/viewer/trace.js:7`
runs only 0 → ⌊n/3⌋ → 0, legs of 16 on n = 50); (d) the wait per leg after the first pass; (e) the budget set from the
run, not only the constructor. Mutants: a hold key that is ignored must make every arm read as *centred* (P1's
order then fails its own refutation check); a trace whose legs are one frame short must fail its leg-length assert.
W_min is not built (`docs/lines/client.md:22`) and is not needed: W = 15 > 8.

**Arms (5):** behind first, three quarters ahead, centred (as built), the struck split, and centred′ (the A/A copy).
P1b replaces the four with: behind first always, centred, the rule (behind first moving, centred dwelling), centred′.

| cell | trace | predicted wait per leg after the first pass, s (simulated: no RTT, one fetch at a time, constant μ) | refuted when |
| --- | --- | --- | --- |
| **P1** legs 20 | sawtooth, 25 steps/s, no dwell | 0.50, 0.50, 0.87, 1.24 | centred or the struck split is the shortest, or behind first is not within the A/A spread of the shortest |
| **P1** legs 40 | the same | 3.40, 3.40, 3.77, 4.14 | the same |
| **P1b** legs 40 | a 3 s dwell at each turn, each ending in a turn | 5.85, 4.55, 4.55 (always, centred, the rule) | behind first always is not the longest |
| **P1c** legs 12 | no dwell | every arm 0 (sim ≤ 0.03); no byte received after the first pass in any arm | any arm outside the A/A spread, or a byte after the first pass |
| **P1c** ρ ≥ 0.8, legs 40 | `r80000` | every arm within A/A (sim gaps ≤ 0.10) | any arm differs |
| **P2** corrected | one way, W < n | **a tie**: every arm within A/A after the first W frames (sim, 600 frames at ρ 0.216: 87.11 / 87.11 / 87.48 / 88.41 s in all) | any arm outside the A/A spread |

The model's own words bind the reading: "The run adds an RTT and decode jitter, so the order and the gaps are
predicted, not the values" (`ask-model.md:322`). **The A/A spread**, fixed here: the 10th–90th percentile of
centred′ − centred's per-round difference in mean wait per leg; a cell whose A/A median |Δ| exceeds 0.10 s (one
frame-step at 25/s is 0.04 s; P1's smallest predicted gap is 0.37 s) is too noisy and reads nothing. **The live-cell
guard** (`ask-order-during-fill.md:66-77`): at least 10 % of forward steps not held, or the cell is dead and a tie
there is not a null (P1c legs 12 is expected dead by design and is read as the control it is).

**Decision** (page:119–121): P1 refuted, the hold is dropped and the store stays centred; P1b says whether the rule
earns its two states over centred alone.

**Rounds and order.** 10 rounds a cell (one mirrored Williams period of five arms), cells in a Williams order each
round (`run.mjs:7,518-521`). `--mutate sample` before round 0 must turn every arm's exactness to 0.
**VOID:** a visit whose relay prints `VOID` (p99 lateness over 1 ms), or that fails or fills short, is re-run at the
round's end (the re-run breaks the interleave for that visit: said in the rows); a cell left with under 8 counted
visits an arm is saturated and claims nothing. **Host:** relay on core 3 at `chrt -f 50`, browser and server on 0–2
(`run.mjs:46-48`); hosts like this one voided 27–46 % of visits before (`ask-order-during-fill.md:232-235`,
`total-time/README.md:197`), so the run budgets for half again its visits. `r80000` runs only if the pilot's busiest
core stays under 0.85 and the relay's guard holds; else P1c's second control is named unrun (the relay's ceiling for
this driver is not recorded; `transport-stack` §4 claims nothing above 90 Mbit/s for its own relay).

```bash
python3 lab/av1/delivery/total-time/make_frames.py ...            # dbts_b1 under lab/.av1-work, as ask-order-during-fill.md:228-229
node lab/av1/delivery/total-time/run.mjs --trace legs --legs 20,40 --dwell 0 --hold behind,ahead34,centred,struck,centred \
  --link r20000rtt40 --rounds 10 --rig-core 3 --out rows/ask-P1.jsonl        # flag names as (b)-(d) build them
```

## 5 · Cache (`cache` item 1's narrowed §10.4 run) → CACHE-CELLS

**Runs only if CACHE-DESIGN-1124 keeps it** (contradiction 5 of `docs/decisions/README.md`): at the time of writing
that row has no status file and nothing pushed. CACHE-CELLS reads its output; if it is still absent at 2026-11-25
12:00 (the row's latest), the run goes ahead and its verdict is **provisional** on the store question.

**The run** (`claude/cache-plan:docs/client/evidence/cache-plan.md` §10.4, CP:899-921, items 1, 3 and 4; the page drops
items 2 and 5, `docs/decisions/cache.md:26`). **Arms (4):** `none`, OPFS-SYNC, OPFS-SYNC′ (A/A), OPFS-ASYNC, with the
pilot picks of `lab/cache-arms/pilot-<engine>.json` (OPFS-ASYNC `group=8MiB&inflight=3&read=sync`). **IDB is left
out:** §10.4 listed it beside item 2 (IDB `value=buffer`), which the page drops, and none of items 1, 3, 4 rules on
it; this is this protocol's reading, and the review may restore it. **Engines:** Chromium (the run's build, printed)
and Firefox 159.0.1 as §10.4 names (fetched as §3), Firefox on Xvfb with `FIREFOX_PATH`.

**Built first (lab only, `claude/cache-arms`), each with a mutant:** PSS by process (baseline and peak a process, its
type: browser, renderer, GPU, utility or storage; today `treePss` sums the tree, `lab/opfs-cache/browser.mjs:44-48`);
the PSS A/A rule; `verify`'s per-index record; OPFS-ASYNC's one sync handle a group for a reopen; item 3's VOID line.

| cell | what | predicted | refuted when |
| --- | --- | --- | --- |
| L, S1 1× and S2 1×, 12 rounds, both engines (item 1) | PSS growth by process | OPFS-SYNC's ~100 MiB over `none` on Chromium (measured 125 / 123 against 25) sits in **one** process and does not scale with the frame: S1 and S2 within 20 MiB of each other; in the storage or utility process it is a constant per origin, in the renderer it is the rig's (CP:905-910) | the growth spread over processes, or differing by more than 20 MiB between S1 and S2 |
| T, Chromium, OPFS-SYNC, 12 rounds (item 3) | per index: `hit`, `why`, XXH3, SHA-256 | every non-exact index is a failed re-read (`hit` false); none a SHA-256 mismatch after a passing XXH3 (CP:915-918; last run `verify.notOk` 2, 0, 1, 0 over 4 rounds; a probe on Chromium 157 read 343 of 343 exact) | one SHA-256 mismatch after a passing XXH3: "a correctness defect: it blocks OPFS-SYNC until it is traced" |
| O, S1 and S3, both engines (item 4) | OPFS-ASYNC reopen, ms a frame | Firefox S1 from 4.6 to **under 1 ms** a frame, passing its 3.0 ms bar; S3 (G = 1) unchanged (916 / 1 036 ms warm / cold) (CP:919-921) | Firefox S1 ≥ 1 ms a frame, or S3 moved by more than ×1.10 |

**Bars**, as §8 (CP:582-599): the memory bar the stores failed, "PSS growth ≤ `none`'s + its writes in flight ×
frame + 64 MiB", in ≥ 75 % of rounds (9 of 12). **VOID** (§8.4, CP:632-644, plus this run's two): A/A on L, |Δ missed
share| over 1 % of ticks or |Δ p99| over 4 ms; on W, R and O, a ratio outside 0.90–1.10; **L is VOID for its PSS bar
when the A/A pair's median |ΔPSS| exceeds 32 MiB** (item 1); **an L cell with a round whose `none` errored is VOID,
unless its period is rerun whole** (item 3's line, `cache.md:27`, replacing `lBars`' `unjudged`,
`lab/cache-arms/cells.mjs:87-110`); a mutant not caught keeps its arm's cell `VOID` until fixed and rerun whole;
`none` missing over 5 % of ticks in L's median round claims nothing.
**Order:** Williams per round (`lab/order.mjs`), 12 rounds = three periods of four arms, `balanced()` reported.
**Host:** one 4-vCPU, 16 GiB container, no GPU, one run at a time; each job under two hours (the container stops a
background job at two hours, CP:725-726), so each cell is its own job; saturated points last time were Chromium S3 4×
and Firefox S2 and S3 4×, none of them in this run; nothing is claimed for them.

```bash
bash lab/cache-arms/rows/mutants.sh chromium && bash lab/cache-arms/rows/mutants.sh firefox
bash lab/cache-arms/rows/counted.sh chromium L-2560-1x      # one cell a job; counted.sh's lines with --arms none,opfs-sync,opfs-sync-aa,opfs-async
```

## 6 · As time allows (each already pre-registered where named; the order and VOID rules here)

These run only after §1–§5's runs are done or at their latest, in this order, each by a session that wrote none of
this file. Each cell's prediction is the one already pre-registered at the place named, quoted there and not
restated here, so that it has one home; this section adds only the order, the VOID rules and the host's ceiling.
**Not written further for want of time:** none of these four has a section of its own with rig commands checked
against the tree; the runner reads the named file and records any departure as an amendment before its first row.

| # | run | pre-registered at | rig | runs in the cloud? |
| ---: | --- | --- | --- | --- |
| 6.1 | `pacs-sync`'s **M-R2**: bytes of rsync's file list for ct's series directory and the 2 000-instance one, with and without `-z` | `origin/claude/unified:docs/ingest/rsync-updates.md` §7 (prediction "40–60 KB and 300–420 KB raw; `-z` ≤ 0.6×", contradicted "outside") | `rsync --list-only` over ssh to `localhost` in the container; no relay needed (bytes, not time) | yes |
| 6.2 | `client-calls` item 1, **cell T** (`pixels: "transfer"`'s costs) | `docs/client/evidence/transferred-buffer-per-frame.md` (cell T; cell W is not runnable: the store's window under a want is not built) | the build named there | yes |
| 6.3 | `client-calls` item 3, **rule (3)'s registered re-read** (outcome sets against an A/A pair, 9 rounds) | `docs/client/evidence/dav1d-fetched-on-need.md` | its harness, forms (a), (a′), (c) | yes |
| 6.4 | **the fault bench's twelve cells** | `origin/claude/unified:docs/client/evidence/integrity-model.md` §8 (one prediction a cell) | `lab/faultbench/run.py` (faults today: `none`, `sample`, `sample-always`, `truncate`, `hang`) | cells 1, 2, 3, 5, 6, 7, 8, 10, 12 on the cloud's hosts once their faults are added; 9 on SwiftShader only (its device number is not the cloud's); **11 not the cloud's** (a hardware AV1 decoder, Safari) |
| 6.5 | `non-cine-series` §6's run: W, L at level 1, V as reference, at 5, 20 and 50 Mbit/s on `ffdm_d`, and its two probes | `origin/claude/non-cine:docs/client/evidence/non-cine-series.md` §7 (bands and refutation rules there) | **not built**: §7 is "an outline for the next queue"; L at level 1 needs the level set by the run, not the harness's 1 000-pixel rule | yes, after a build row the runner names as missing |

**VOID, for all five.** A visit is `VOID` when the busiest core's median over the visit exceeds 0.85 or the relay's
send-time slip exceeds its guard (the delivery rig's, `lab/` as it stands); a `VOID` visit is re-run once in the same
position of the order and counted as `VOID` if it fails again; a cell with more than a quarter of its visits `VOID`
is reported as **not conclusive**, never read. 6.1 has no time cell, so no CPU guard: its rows are byte counts.
**Order.** Within each run, arms are rotated per round (round *r* starts at arm *r* mod *k*), never in blocks.
**Ceiling.** One 4-core container, no GPU; the relay at ≤ 90 Mbit/s (`transport-stack` §4); nothing is claimed above
the highest rate at which no visit was `VOID` for CPU.
6.4's added faults (a metadata digit, a stale texture, an index swap, a flip after the check, a store flip, a refused
frame) are lab code under `lab/faultbench/`, each with its mutant, built by the run row before any counted row; a
fault that cannot be injected without product code is named and its cell left unrun.

## 7 · Not runnable in one container: `repository` item 4's two-host check

The page: "first one cloud row runs `scripts/demo-series.sh` on two cloud hosts and compares every bundle's SHA-256"
(`docs/decisions/repository.md` item 4); the rule, `docs/reviews/dataset-hub.md` §1: "`scripts/demo-series.sh` on
two different hosts, SHA-256 of every bundle compared, 23 of 23 or the first that differs named". One container is
one host, so this row is `blocked` here. **Prediction (theory):** 23 of 23 equal on two x86-64 hosts at the same tool
pins (libaom 3.15.1 wrote the same bytes as libaom's head on 11 series, `docs/av1/queue.md` row 57); a host of
another SIMD level or architecture is where a difference would appear, and the first differing bundle is named.
23 is the count with `STORED_FORM=1` (3 exact series, 18 optimal-quality ones, 2 stored forms); without it, 21.

Commands, on each host, from a checkout of the same commit (`git rev-parse HEAD` recorded beside the sums):

```bash
ingest/tools.sh                                   # the pinned tools into ingest/.build
STORED_FORM=1 scripts/demo-series.sh /tmp/demo-series
( cd /tmp/demo-series && sha256sum *.sbnd *.metadata.json | sort -k2 ) > sums-$(hostname -s).txt
uname -m; grep -m1 'model name' /proc/cpuinfo; grep -m1 -o 'avx512[a-z]*\|avx2' /proc/cpuinfo | sort -u
diff sums-hostA.txt sums-hostB.txt && echo "23 of 23 equal"
```

Two cloud sessions started separately may land on two hosts (the CPU line tells); that is a cloud form of the same
check, not a local one, and counts only if the two CPU lines differ.

## Review

PAGE-RUNS-PROTOCOL-REVIEW, 2026-11-24 13:47–14:10 UTC, by a session that wrote none of this file and will run none of
it (`by:` in `claude/work-ledger:docs/queue/PAGE-RUNS-PROTOCOL-REVIEW.md`). Read: this file at `f85b2b5e4`; its brief
(`claude/work-ledger:docs/queue-2026-11-24.md`); each rig and source it cites, at the branches its header names
(`transport-arms` `run.mjs`, `judge.mjs`, `server/src/transport/{lab_levers,stream_mode,link,server}.rs`,
`server/README.md`; `report-arms` `run.mjs`, `bidi.mjs`; `report-plan.md` §7.9 and §Results 2; `engines` `engines.md`,
`run_firefox.sh`; `core-m5b` `lab/opfs-cache/{run,browser}.mjs`; `unified` `ask-model.md` §6–§7, `av1/queue.md` rows 180,
207, 211, `main.rs`; `docs-client` `ask-during-a-fill.md`; `cache-plan.md` §10.4; `cache-arms` `lab/`; the pages
`transport-stack`, `reports`, `cache`). Nothing run but `git` reads and one binomial sum; the gate not run (docs only).
CACHE-DESIGN-1124 still has no output (`git log --all --since=2026-11-24T00:00Z`, 13:58), so §5's fallback stands.

**Coverage.** Every section the brief names is here (Transport, Reports with the Firefox defect first, Engines items 3
and 4, Asking P1/P1b/P1c/P2, Cache items 1, 3, 4 with item 3's VOID line, the four as-time-allows runs, `repository`
item 4 `blocked` with its commands). Arms, cells, predictions, VOID rules, order and ceiling are given for §1, §2,
§3b, §4 and §5. Checked and holding: §1's arms, cells and build line (`run.mjs:41-52,54-68,113`), the flag only under
`lab-levers` (`lab_levers.rs:23-27`), TW's window (`server.rs:148-150`), PUB's and LTE's queues (2 000 and 3 300 × 1 500 B
= 3.0 and 5.0 MB), the 6 MiB credit's ~63 Mbit/s over 0.8 s; §2's Firefox causes (`bidi.mjs:23-37`, `report-plan.md`
§Firefox's counted cells) and every *measured* C and Lbusy anchor; §4's W = 15 (17.04 MB a frame, 256 MiB / 17.04 MB
= 15.75), ρ = 20 ÷ (3.71 × 25) = 0.216 and every simulated value (`ask-model.md:320-325`), P2 corrected to a tie as n1
asks; §5 is §10.4 narrowed as `cache` items 1–3 say. Williams periods: §1's 12 rounds = two of six, §2's 28 = two
mirrored of seven and 18 = one mirrored of nine, §4 P1's 10 = one mirrored of five, §5's 12 = three of four.
**IDB's exclusion (§5) holds:** `cache` item 2's reason (both stores already lose cells to their API's floor, so no item
left can change which store passes, **derived**) covers IDB as built as well as `value=buffer`.

**Blockers.**

* **B1. §1 says its rows answer #39 and #96, but neither PR's lever is an arm.** `transport-stack` §3: "#39 | asks
  first under a 6 MiB send window | hold for item 2's run | a trade-off: the ask ×0.18–0.31, the fill +2 to +44 % (row
  211)"; row 211 measured `--stream-mode per-frame-asks-first` with a 6 MiB send window (`av1/queue.md:310`). "#96 |
  the one queue as product code, no flag": the one queue is `--fill-resumes-after-asks`
  (`ask-during-a-fill.md:21`), which this file itself says is "absent from the rig's server" and not an arm. Yet §1:
  "#39 and #96 … are answered **only** by these rows' AD ask and CR fill together". As written the run would close two
  held PRs on arms that measure neither. `per-frame-asks-first` is already in the rig's `lab-levers` build
  (`stream_mode.rs:13-15`), so an arm WT-AF (`--stream-mode per-frame-asks-first`, the default 6 MiB window) costs one
  argument list, not product code. Fix: add WT-AF with its prediction (row 211's ×0.18–0.31 behind 20 ms queues is
  *measured* on another rig and fixture: say what carries) and say WT-AF decides #39; and say #96 stays held, untested
  here, unless `--fill-resumes-after-asks` is ported to the rig's server as lab code (or the arms run on
  `claude/unified`'s server), named either way.
* **B2. §2(b)'s decisive cell, D5a on a busy page, is not built and its band does not follow from its mechanism.** The
  rig kills the renderer a fixed 50 ms after the fault (`report-arms/run.mjs:208`: `ending === "D5a" ? 50 : 500`) and
  sets `busy` only for Lbusy (`:201`); §2's built-first list has the clock, the Firefox fixes and KEEPALIVE-Y° but not
  this, and the command's "then `--endings D5a` with the busy page" names no option. The band: with Lbusy's measured
  shape (p50 ≈ 2 ms, p99 ≈ 51 ms for BEACON-*, `report-plan.md` §Results 2: the page is in its 50 ms task about half
  the time, the wait then ~uniform on 0–50 ms) and a kill uniform on 0–50 ms, a page-thread report is killed first with
  probability ≈ 0.5 × 0.5 = 0.25, so ~13.5 of 18 delivered (**derived**; binomial, 18 at 0.75: 10–17 holds 94 %), not
  "about half"; the band 4–14 would call a theory-consistent 15–18 a miss 31 % of the time. With the rig's fixed 50 ms
  kill nearly every report beats the kill (~18/18), so the race (b) exists to find is not placed. Fix: name the build
  (D5a with Lbusy's long task, the kill delay drawn per load on 0–50 ms by a seeded rule and recorded in the row; a
  mutant: a fixed delay must fail a spread check), state the delay's distribution, re-derive the band from it; the
  race rule (BEACON-* ≤ 16/18, KEEPALIVE-Y 18/18) then reads against that band.

**Minor.**

* **m1.** WT-PF on AD: "quinn's scheduling of equal-priority streams not read". The streams are not equal: per-frame
  gives each a rank strictly below every earlier ask (`link.rs:214-225`; test `:262-266`), so the asked frame ranks below
  every open fill stream (**source**), and row 180 measured `per-frame` tying `shared` at ×0.96–1.03 (Chromium 141,
  another rig). Restate the basis; the band can narrow.
* **m2.** §1's cell order "AD-PUB, CR, AD-LTE" cannot be run: `--cell AD` runs both forms (`run.mjs:63`). Say AD, then
  CR, or name the option the run row adds.
* **m3.** WT-TW's band reaches ×0.80, the very threshold that decides the page, but its own theory predicts a tie: it
  gains only while cwnd < 2.0 MB, and Cubic fills 3.0–5.0 MB queues (row 207: "cwnd + M is no cap … Cubic grows into the
  queue"; row 211: cwnd at the ask ≤ 4.1 MB). State the tie as the prediction, with the band from the A/A, so a ×0.80
  reads as a refutation, not a hit.
* **m4.** §3b: 7 rounds of six arms is one Williams period and one round over (a period of six is six rounds), so
  `balanced()` holds only for six or twelve; and `ring` − `disk` is predicted 250–310 but "refuted" only above 320, so a
  median of 311–320 or under 250 is outside the prediction and named no miss. The bar is per round ("every round's
  growth ≤ median `disk` + 320"): predict the rounds, not only the median.
* **m5.** §4 P1b has four arms; 10 rounds is not a whole period of four (8 or 12).
* **m6.** §5's "S1 and S2 within 20 MiB of each other" is this file's number, not §10.4's ("does not scale with the
  frame"); label it (**assumed** or derived, with why 20).
* **m7.** §3a gives no VOID rule and no order for its 2 versions × 3 runs: say both (e.g. alternate versions; a run whose
  trace fails its completeness check is `VOID` and rerun).

**Verdict.** Two blockers (B1, B2), both in sections whose run rows they stop: TRANSPORT-FLAGS-RUN and REPORT-RERUNS wait
on PAGE-RUNS-PROTOCOL-FIX-REVIEW with no blocker open; ENGINE-CELLS, ASK-CELLS and CACHE-CELLS wait only on
PAGE-RUNS-PROTOCOL-FIX (m4–m7 fixed in place by a session that runs none of it). Rows appended to
`claude/work-ledger:docs/queue-2026-11-24.md`. How it serves the value statement: the transport and report runs are
what "a fast full fill, and low latency on every jump" and the checked frame's safety report rest on, so their
predictions must be able to miss.
