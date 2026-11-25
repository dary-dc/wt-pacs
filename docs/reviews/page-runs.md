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
| 1 | TRANSPORT-FLAGS-RUN | `transport-stack` 2 | yes | per-arm server arguments; WT-TW, WT-PF, WT-AF; `lab-levers` build |
| 2 | REPORT-RERUNS | `reports` 3 | yes | the Firefox driver's three fixes; a µs sink clock; KEEPALIVE-Y°; D5a on a busy page with a drawn kill delay |
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
also answers PR 254's #39, which `transport-stack` §3 holds "for item 2's run"; #96 stays held, untested here (below).

**The rig as it stands, and what the run row adds first** (read at `origin/claude/transport-arms`):

* The arms are a fixed map in `lab/transport-arms/run.mjs:42-51` (`WT-TS`, `WT-TS'`, `WT-WASM`, `WS`, `H3-frame`,
  `H3-fill`, `H2-frame`, `H2-fill`); every visit starts the server with the same arguments (`run.mjs:188-191`), built
  with `--features lab-get` only (`run.mjs:113`).
* `--send-window-follows-cwnd` exists only under the `lab-levers` feature (`server/src/transport/lab_levers.rs:23-27`;
  a build without it refuses the flag, `server/README.md:142-147`). `--stream-mode per-frame` is in the default build
  (`server/src/transport/stream_mode.rs:12`).
* So **before any counted row** the run row adds, as lab code with one mutant each: a per-arm server argument list
  in `run.mjs`; the server built `--features lab-get,lab-levers`; three arms, **WT-TW** (`--send-window-follows-cwnd`),
  **WT-PF** (`--stream-mode per-frame`) and **WT-AF** (`--stream-mode per-frame-asks-first --send-window-bytes
  6291456`: #39's lever as row 211 measured it, asks first under a 6 MiB send window; `per-frame-asks-first` is in the
  `lab-levers` build, `stream_mode.rs:13-15`, and the default send window is quinn's 10 MB, `tuning.rs:58-61` and
  `quic-compared.md` §9.7, so the 6 MiB is set). Mutants: WT-TW started without its flag must read as a tie with WT-TS
  on AD-PUB (the flag is what is measured); WT-AF started as `per-frame` must lose its AD gain (its asks no longer
  ranked above the fill, `link.rs:228-231`); a server that silently ignores an argument must fail the visit (the
  server's start line, which echoes its options, is checked by `judge.mjs`). No product code changes.

**A naming conflict, recorded, not resolved here.** The page calls `--send-window-follows-cwnd` "the one queue". In
`claude/docs-client:docs/client/evidence/ask-during-a-fill.md:21-23` the one queue (Q) is `--fill-resumes-after-asks`,
QW is Q plus the window, and TW is the window alone; the same file finds TW's asks within ±0.04 of QW's (`:132`).
`--fill-resumes-after-asks` is on `origin/claude/unified` (`server/src/main.rs:140`) and absent from the rig's server.
This run measures **TW and PF**, the two flags the page names, and **AF**, #39's lever; QW is not an arm. If TW
misses below, the page's "WT with its flags" is answered for TW, PF and AF only, and QW is named as untested.
**#96 stays held, untested here**: its lever is the one queue as product code (`transport-stack` §3: "#96 | the one
queue as product code, no flag"), `--fill-resumes-after-asks`, which the rig's server lacks; porting it to the rig is
a lab build no row names, and the arms do not run on `claude/unified`'s server. BRIEF-WEEKEND's list names it.

**Arms (7):** WT-TS (reference), WT-TS' (A/A), WT-TW, WT-PF, WT-AF, H3-fill, H3-frame. **Cells**, the rig's own
(`run.mjs:54-68`): AD-PUB (10 ms one way, 90 000 kbit, 2 000-packet queue; n 50, the ask at frame 8), AD-LTE (19 ms,
50 000 kbit, 3 300 packets, iid loss 0.1 %; n 16, the ask at frame 4), CR (400 ms one way, 90 000 kbit, 1 875 packets;
a fill of 50). Measures as the rig records them: AD the asked frame's last byte − the page's ask call; CR the latest
last byte − the dial. **Latency for AD, fill time for CR**; never both for one cell. Fixture `dbts_b1` as HTJ2K
(50 frames, 2.15 MB a frame), as the baselines.

**Rounds and order.** 14 rounds a cell (one mirrored Williams period of seven arms, `lab/order.mjs`: "the period is
n rounds, 2n for odd n"; `balanced()` must not flag `UNBALANCED`), the cell AD first, then CR, each cell's rounds
contiguous, arms rotated within each round. `--cell AD` runs AD-PUB and AD-LTE as its two forms (`run.mjs:68`), so
CR cannot fall between them; the rig's order is kept. `aa_rule.py --bar 0.05` on WT-TS' and each candidate, as §6.6.

**Predictions** (ratio to WT-TS in the same round, median; **derived** unless labelled):

| cell | WT-TW | WT-PF | WT-AF | H3-fill / H3-frame (reference, re-measured) |
| --- | --- | --- | --- | --- |
| AD-PUB | **a tie, ×0.95–1.05** | ×0.95–1.45 | **×0.52–0.98** | 0.50–0.60 / 1.6–2.0 (measured 0.548 / 1.809) |
| AD-LTE | **×0.70–0.88** | ×0.95–1.45 | **×0.25–0.57** | 0.47–0.58 / 1.5–1.9 (measured 0.525 / 1.678) |
| CR | ×0.97–1.03 | **×0.60–1.00** | ×0.97–1.45 (fill) | 0.95–1.05 / 0.58–0.70 (measured 1.001 / 0.630) |

(Amended 2026-11-24 by PAGE-RUNS-PROTOCOL-FIX, before any row: WT-AF added (§Review B1); WT-TW's AD bands were
×0.80–1.02 and ×0.85–1.02 (m3); WT-PF's AD bands were ×1.00–1.80 and ×1.00–1.70 (m1). Amended again 2026-11-24 by
PAGE-RUNS-PROTOCOL-FIX-2, before any row: WT-AF's AD bands were ×0.52–0.95 and ×0.25–0.50 (§Re-review r-m1, r-m2).)

* **WT-TW on AD.** What the ask waits behind is the fill already admitted to the send window. TW sets that window
  to cwnd plus two of the series' largest frames (`server.rs:148-155`): 2 × 2.15 MB ≈ 4.3 MB plus cwnd, against
  today's 6 MiB, the client's stream credit, which bounds what `shared` has written ahead. It gains only while cwnd <
  6 MiB − 4.3 MB ≈ 2.0 MB. **AD-PUB: a tie.** PUB's queue holds 3.0 MB and has no random loss; Cubic fills a
  tail-drop queue ("cwnd + M is no cap … Cubic grows into the queue", row 207; asks first's cwnd at the ask up to
  4.1 MB behind deep FIFOs, row 211, **measured** on another rig), so cwnd sits above 2 MB and the band is the A/A's,
  ×0.95–1.05 (`aa_rule.py --bar 0.05`); a ×0.80 there is a refutation, not a hit (**theory**). **AD-LTE: a gain.**
  Its 0.1 % iid loss holds Cubic's window near 1.2 ÷ √p ≈ 38 packets (37.9) ≈ 0.06 MB (`quic-compared.md` §9.6's form,
  **theory**), far under 2 MB, so the ask waits behind ≈ 4.4 MB, not 6.29 MB: (4.4 + 2.15) ÷ (6.29 + 2.15) ≈ ×0.78
  (**derived**), the band ×0.70–0.88. This reads the review's m3 (a tie on both forms) as holding for PUB only; LTE's
  loss is what keeps cwnd under the 2 MB. A median within ×0.75–0.85 on AD-LTE alone is named as not deciding the
  page. The earlier ×0.32–0.90 was QW's, measured on 0.57 MB frames, where two frames are 1.1 MB
  (`ask-during-a-fill.md:76-88,130`; Chromium 141, another rig), so it does not carry to `dbts_b1` (**derived**).
* **WT-PF on AD.** The streams are not of equal priority: `per-frame` gives each stream a rank strictly below every
  earlier ask (`link.rs:215-226`; test `later_asks_rank_strictly_below_earlier_ones`, `:262-266`), so the asked frame
  ranks below every fill stream already open (**source**). Row 180 measured `per-frame` tying `shared`, ×0.96–1.03
  (Chromium 141, `lab/ask-ahead`, 0.57 MB frames: **measured**, another rig and fixture), the band's lower end. Its
  upper end: the per-frame streams escape the one stream's 6 MiB credit and are bounded by quinn's 10 MB send window
  instead, if Chromium's connection credit allows it (the CR assumption below), so up to (10 + 2.15) ÷ (6.29 + 2.15)
  ≈ ×1.44 (**derived**). No gain predicted.
* **WT-PF on CR.** H3-frame's ×0.630 came from escaping one stream's 6 MiB credit, which caps a stream at ~63 Mbit/s
  over 0.8 s (`transport-stack` §5). PF escapes it too **if** Chromium's connection-level receive window for a
  WebTransport session exceeds 6 MiB; not read here, an **assumption**, which is why the band reaches a tie. A tie
  says the connection window binds; the run records the session's flow-control-blocked events from the server's
  QUIC statistics if present.
* **WT-TW on CR**: the cap is the client's stream credit, not the server's window, so a tie (**theory**).
* **WT-AF on AD.** Asks first ranks the ask's stream above every fill stream (`link.rs:228-231`), so the ask waits
  only behind the bytes in flight, ≤ min(cwnd, the 6 MiB send window), not behind the 6.29 MB `shared` has written
  ahead (`quic-compared.md` §9.7's mechanism, **theory**). AD-PUB: cwnd 2.25–3.2 MB, its top the 3.0 MB queue
  plus the 0.23 MB path (90 Mbit/s × 20 ms), its floor that top × Cubic's β = 0.7 after a drop (RFC 9438 §4.6: "The
  parameter β__cubic_ SHOULD be set to 0.7"), gives (2.25–3.2 + 2.15) ÷ 8.44 ≈ ×0.52–0.63 (**derived**); the band's
  upper end ×0.98 is row 211's miss of the same theory behind deep FIFOs: the + 6 MiB arm, the one WT-AF copies,
  measured ×0.91–0.98 (18/800, 103/360, 103/800, 103/92/800; ×0.87 there is uncapped asks first's) where it
  predicted ≈ ×0.68 (103 Mbit/s behind 360 ms: (4.1 + 0.57) ÷ (6.29 + 0.57)). A median in ×0.95–0.98 sits inside the
  A/A's band, so it is read as no gain for #39 (the ≤ ×0.8 rule below decides), not as a hit that separates WT-AF from
  WT-TS. AD-LTE: cwnd ≈ 0.06 MB under the loss gives ≈ (0.06 + 2.15) ÷ 8.44 ≈ ×0.26 (**derived**), the band's lower
  end. Its upper end: row 211's loss cells measured ×0.18–0.19 where the same arithmetic gives ≈ ×0.09, 2.1–2.2 times
  it; that ratio applied to ×0.26 gives ×0.55–0.57, so the band is ×0.25–0.57. The carry is **assumed**: row 211's
  loss was 1 % behind 20 ms (a window ~√10 smaller), its frames 0.57 MB, and the excess's cause is not isolated, so
  it is carried as a ratio for want of a term; a median above ×0.57 refutes the arithmetic, not the lever, and still
  counts against the ≤ ×0.8 rule as measured.
* **WT-AF on CR (its fill).** Its streams escape the one stream's credit, but the 6 MiB send window caps the bytes in
  flight at the same ~63 Mbit/s over 0.8 s, so the cap predicts a tie (**theory**). Row 211 measured asks first under
  a 6 MiB send window costing its fill +2 to +44 % in all nine cells, the cap binding in none, with more, smaller
  packets and stalls of up to 2.9 s that the model has no term for (**measured**, cause not isolated). Hence ×0.97–1.45.
  **What carries from row 211:** the mechanism and the existence of the fill cost; **not** its values: its frames were
  0.57 MB (`dbt10_ea1141`, 24 frames) against `dbts_b1`'s 2.15 MB, so a fill here opens about a quarter as many
  streams a byte; Chromium 141 through `lab/ask-ahead`, not this rig's relay and build.

**Refuted, for each:** the cell's median outside its band. **What decides the page** (its §6): WT-TW or WT-PF at
≤ ×0.8 of WT-TS's ask on AD, i.e. as good as the fill-shape fetch's ×0.50–0.68 band's upper end, keeps "no GET path";
both above ×0.8 on AD leaves the page's next step ("a GET path for asks alone is the next structural draft"). WT-PF
≤ ×0.75 on CR answers CR within WebTransport. **WT-AF decides #39** (asks first under a 6 MiB send window) by its
AD ask and CR fill together: ≤ ×0.8 on both AD forms with a CR fill ≤ ×1.05 makes the lever net on these cells, the
owner's to adopt (it is a `lab-levers` flag: a product build row would follow, not this run); a gain on AD with a
CR fill above ×1.05 is a trade-off for the owner, as row 211 found, not a default; no gain on AD answers #39 no. The
prediction is the trade-off if row 211's fill cost carries to 2.15 MB frames, a tie on CR if it does not. WT-AF alone
at ≤ ×0.8 also keeps "no GET path" open, on that build. **#96 is not answered** by this run (above).

**VOID** (the rig's `judge.mjs:27-31`): the relay guard's p99 over 1 ms; the busiest core over 0.95; a crash; a fetch
arm on the wrong protocol; a visit past 3 × the pilot median (`rows/pilot-medians.json`, extended by a 2-round
pilot for WT-TW, WT-PF and WT-AF, not counted); a server whose start line lacks the arm's flag. Over 25 % `VOID` in a cell:
both readings, strict and round-paired, as §6.6. **Host:** relay on core 0, server on core 1, driver and browser on
2–3 (the rig's pinning, RESULTS-BRIEF §1.12's recommendation already met); the relay saturates at 100 Mbit/s and
nothing is claimed above 90. The links are a userspace relay's models, **assumed**, not a radio.

**Commands** (after the additions above, on `claude/page-runs` from `origin/claude/transport-arms`):

```bash
cargo build --release -p series-server --features lab-get,lab-levers
node lab/transport-arms/run.mjs --cell AD --rounds 14 --arms WT-TS,WT-TS\',WT-TW,WT-PF,WT-AF,H3-fill,H3-frame \
  --pilot-medians lab/transport-arms/rows/pilot-medians.json --limit-ms 600000 --out rows/flags-AD.jsonl
node lab/transport-arms/run.mjs --cell CR --rounds 14 --arms WT-TS,WT-TS\',WT-TW,WT-PF,WT-AF,H3-fill,H3-frame \
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

**D5a busy is built first** (lab code in the report rig's `run.mjs` on `claude/report-arms`; it is not there today: the kill is a fixed 50 ms
after the fault for D5a, `ending === "D5a" ? 50 : 500`, and `busy` is set only for Lbusy). An ending `D5a-busy`: the
page as for Lbusy (`busy: "1"`), then D5a's fault and kill, the kill delay *d* drawn per load uniformly on 0–50 ms
by a seeded rule (seed = round × 100 + the unit's index, printed), passed to `killAfterFault` and recorded in the row
with the delay the driver actually saw (`row.kill`). Mutant: a fixed 50 ms delay must fail a spread check, run on
each cell before it is read: the 18 drawn delays of an arm span at least 30 ms (a uniform 0–50 ms draw of 18 spans
under 30 ms with probability ≈ 1.3 × 10⁻³, **derived**), else the cell is `VOID`.

**The band, derived from the delay's distribution.** A page-thread carrier (BEACON-*) hands the report off only
when the long task ends. With a 50 ms task every 100 ms and the fault at a time independent of the task's phase
(**assumed**), the fault falls inside a task with probability 0.5 and the remaining wait *w* is then uniform on
0–50 ms; outside a task the hand-off is within Lbusy's p50 ≈ 2 ms, before any kill but the first ~2 ms
(**measured** shape: p50 ≈ 2, p99 ≈ 51 ms, `report-plan.md` §Results 2). The report is lost when *d* < *w*:
P(lost | *d*) = 0.5 × (1 − *d* ÷ 50), and over *d* uniform on 0–50, P(lost) = 0.25. So **13.5 of 18 delivered
expected** (**derived**), and under Binomial(18, 0.75) the band **10–17 of 18** holds 97.5 % (**derived**, recomputed
here; §Review's 94 % was for the same band). The pre-registered reading uses the recorded delays: expected delivered
= 18 − Σ 0.5 × (1 − *dᵢ* ÷ 50), the band that sum ± 3.5. 18 of 18 has probability 0.006 under this model: it refutes
the race as modelled (the hand-off does not wait on the task), it is not a hit for BEACON-*.

| cell | predicted | basis |
| --- | --- | --- |
| Lbusy p99, `off` and BEACON-* | 45–55 ms | measured 50.84–51.39 (the run was `VOID` on its A/A only) |
| Lbusy p99, KEEPALIVE-* | ≤ 5 ms | measured 2.46 |
| Lbusy p99, SESSION-* | ≤ 5 ms | measured 1.99–2.31 |
| D5a busy, safety report delivered, KEEPALIVE-* and SESSION-* | 18/18 each | idle D5a 18/18 every arm (measured); these carriers sent within 5 ms under the long task |
| D5a busy, safety report delivered, BEACON-* | **10–17 of 18** (expected 13.5; read against the recorded delays, above) | **derived**: the report waits for the page thread half the time, ~uniform on 0–50 ms, and the kill is drawn on 0–50 ms, so a quarter are killed before the send (amended 2026-11-24 from "4–14 of 18", §Review B2) |
| D5a busy, fill record | Y arms 18/18, H arms 0/18 | idle pattern (measured) |

Refuted: any band missed. **The race (b) asks for exists** if BEACON-* deliver ≤ 16/18 and KEEPALIVE-Y 18/18; under
the band above, BEACON-* ≤ 16 has probability 0.96 (**derived**), so the rule reads the race the model predicts and
a 17 is a hit of the band that the rule does not count as a race.

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
  --endings Lbusy --rounds 18 --out rows/r3-chromium-Lbusy.jsonl
node lab/report-arms/run.mjs ... --engine chromium --endings D5a-busy --rounds 18 --out rows/r3-chromium-D5a-busy.jsonl  # after its build
FIREFOX_PATH=... node lab/report-arms/run.mjs ... --engine firefox --endings D5a --rounds 18 --out rows/r3-firefox-D5a.jsonl
```

### §2 Amendment (REPORT-RERUNS, 2026-11-24 19:40 UTC, before the first counted row)

Found in the run row's smoke (rows not counted), each a lab change on `claude/report-arms` `f23fb35e6`:

* **D5a-busy's kill could not land inside the long task as written.** Timed through `rig.sinceFault()` and followed
  by a read of `rig.safety` before `Page.crash`, every driver call waited for the page thread's 50 ms task (the driver
  learned of the fault 25–44 ms late; a dedicated worker's CDP session waited too), so the kill always fell after the
  hand-off and the race (b) asks for could not be placed. Now the decoder worker POSTs `{load, at}` to the sink's
  `/fault` at the fault and the driver sends `Page.crash` at the drawn delay, with no call through the page
  (`Page.crash` measured to land ~20 ms after it is sent, mid-task, **measured** in one probe). The driver learns
  2–12 ms after the fault (**measured**, smoke), so a drawn delay under that is sent at once and marked `late`.
* **The delays the reading uses** are the delays the crash was sent at, `row.kill.atKill` (capped at 50 ms), as "the
  delay the driver actually saw" reads; the drawn `row.killDelay` is reported beside. The band is unchanged:
  Σ 0.5 × (1 − *dᵢ* ÷ 50) lost, ± 3.5.
* **KEEPALIVE-Y°** is the unit `keepalive-offdecoder:Y`. The µs clock's mutant (a whole-ms clock) is killed by unit
  tests in RECEIVER and the sink, not by failing a cell's A/A, which would cost a cell (~3 h).
* **Hosts:** headless Chromium is 158.0.8127.36 here (REPORT-RUN-2's was 153.0.8010.12); Firefox 160.0.1; nginx 1.31.8.
* **Cell order:** D5a-busy, Lbusy, C on Chromium; then Firefox D5a, D1, L, D6 (`--tun`), as time allows.

### §2 Results (REPORT-RERUNS)

Fixtures and limits: the grey-16 frame × 32 (not `dbts_c1`), the fault bench's forced mismatch at frame 10; one 4-core
cloud container, no GPU; headless Chromium 158.0.8127.36; loopback, RECEIVER behind nginx 1.31.8; host CPU ≤ 15 %
throughout (no round over 90 %). Rows `claude/report-arms:lab/report-arms/rows/r3-*.jsonl`; reading
`claude/work-ledger:docs/queue/REPORT-RERUNS/read.py`.

**D5a busy** (`r3-chromium-D5a-busy.jsonl`, 18 rounds × 9 units, Williams-balanced, every arm's delays spanning
39–50 ms, 162 of 162 reached the mismatch, no error). Safety report delivered, **measured**, against §2(b):

| arm | delivered | predicted | |
| --- | ---: | --- | --- |
| `off`, `off′` | 6, 8 of 18 | (as BEACON-*: the page's `sendBeacon`) | below the band |
| BEACON-H, BEACON-Y | 9, 9 of 18 | 10–17 (expected 13.6, 13.2 from the delays sent) | **miss**, below |
| KEEPALIVE-H, KEEPALIVE-Y | 18, 18 of 18 | 18/18 | hit |
| SESSION-1, SESSION-Y, SESSION-H | 16, 16, 15 of 18 | 18/18 | **miss** |
| fill record, Y arms | BEACON-Y 6, KEEPALIVE-Y 9, SESSION-1 9, SESSION-Y 7 | 18/18 | **miss** |
| fill record, H arms | 0 each | 0/18 | hit |

* **The race (b) asks for exists** by its rule: BEACON-* ≤ 16 and KEEPALIVE-Y 18/18. BEACON-* and `off` pooled lose
  32 of 72; KEEPALIVE-* lose 0 of 36 (Fisher's exact p 4 × 10⁻⁷ for BEACON-* against KEEPALIVE-*, **derived**).
* **The model under-predicts the loss.** 9 of 18 has P ≈ 0.02 under Binomial(18, 0.75) (**derived**): the page-thread
  carriers lose about half, not a quarter. Not established why; a candidate (**theory**, untested): the page hands the
  report off only after it handles the decoder's failed-frame message, which queues behind the task too, so the wait
  is longer than the task's remainder alone.
* **SESSION's 2–3 losses** were not predicted: its safety report also left before the kill in idle D5a; under the busy
  page it does not always. Not traced here.
* **The fill record** (sent at the fill's end) is lost when the kill falls before the fill ends (~135 ms, the fault at
  frame 10): the idle cell's 18/18 was for a kill always 50 ms after the fault; not a carrier property.
* **The A/A by the letter:** §2's VOID rule reads "D's A/A `off` = `off′`", written for idle cells where every arm was
  18/18. Here `off` 6 and `off′` 8 differ (Fisher's p 0.73, **derived**): VOID by the letter, a tie under the race's
  noise. Left to PAGE-RUNS-VERDICT; both readings stand above.
* The driver learned of each fault 5–8 ms after it (p50; max 21 ms), so 1–5 delays an arm were sent late (§2 Amendment).

**Lbusy** (`r3-chromium-Lbusy.jsonl`, 18 rounds × 9 units, Williams-balanced, 20 later faults a load, none lost, no
error). A container restart cut the cell at round 14; rounds 0–13 were kept, round 14's two rows set apart
(`r3-chromium-Lbusy.cut-round14.jsonl`, in no reading) and the cell went on from round 14 in its own Williams order
(`run.mjs --from-round`, `0092cf5e6`; the cell line carries `fromRound: 14`). **Measured**, against §2(b):

| cell | measured: per-load p99, median of 18 loads (pooled p99 of 360) | predicted | |
| --- | --- | --- | --- |
| **absolute A/A**: BEACON-H's floor, even rounds ÷ odd | 1.790 ÷ 1.722 ms = **1.040** | 0.95–1.05 | pass (REPORT-RUN-2's 1.095 failed on the whole-ms clock) |
| `off`, `off′`, BEACON-H, BEACON-Y | 51.4, 51.0, 50.9, 51.4 ms (52.5, 52.5, 52.3, 52.3) | 45–55 ms | hit |
| KEEPALIVE-H, KEEPALIVE-Y | 2.81, 2.72 ms (4.10, 3.30) | ≤ 5 ms | hit |
| SESSION-1, SESSION-Y, SESSION-H | 1.92, 2.13, 1.98 ms (5.79, 2.38, 2.54) | ≤ 5 ms | hit per load; SESSION-1's pooled p99 5.79 over |

The page-thread carriers hand a report off after the long task (p99 ≈ the 50 ms task); the worker carriers do not.
Read with D5a busy above: a kill inside that wait takes the report, so the race (b) asks for exists, and Lbusy gives its size.

**C** (`r3-chromium-C.jsonl`, 28 rounds × 7 units, Williams-balanced, no error, no long task ≥ 50 ms in any arm).
A second container restart cut it after round 26; it went on from round 27 (`fromRound: 27`). Fill time ÷ `off`'s in
the same round, median of 28 (IQR), **measured**, against §2(a):

| arm | median ratio (IQR) | paired with `off`: median Δ, rounds slower, sign test | predicted | |
| --- | --- | --- | --- | --- |
| **A/A** `off′` | **1.053** (0.997–1.130) | +5.3 ms, 21 of 28, p 0.013 | 0.98–1.02; VOID outside 0.95–1.05 | **VOID** |
| BEACON-H, BEACON-Y | 1.018 (0.984–1.053), 1.028 (0.949–1.093) | | 0.96–1.06 | hit |
| KEEPALIVE-H | 1.096 (1.026–1.195) | | 1.06–1.18 | hit |
| KEEPALIVE-Y | 1.102 (1.038–1.179) | +9.8 ms, 25 of 28, p < 0.001 | 1.03–1.12 | hit |
| **KEEPALIVE-Y°** | **1.038** (0.936–1.091) | +3.9 ms, 19 of 28, p 0.09 | **0.97–1.03** | miss, above |

* **The cell is VOID by its A/A** (`off′` 5.3 ms slower than `off`, p 0.013, on a ~100 ms fill): two loads of the
  same arm differ by about what (a) set out to attribute, so nothing in this cell is adopted. REPORT-RUN-2's C also
  met its per-round bar for no arm, `off′` included; on this host C may not be measurable at this size.
* **As read, not adopted:** KEEPALIVE-Y against KEEPALIVE-Y° is +7.3 ms, 19 of 28 rounds, p 0.09 (**derived**, sign
  test): most of KEEPALIVE-Y's cost goes with the wrapped decoder, as the theory said, but KEEPALIVE-Y° sits above its
  band and inside `off′`'s own spread. The carrier's metered page-thread time: KEEPALIVE-Y° 2.47 ms, KEEPALIVE-Y
  1.50 ms, `off` 0.55 ms a load (medians, **measured**).
* So (a)'s condition for KEEPALIVE-Y ("its C cost comes from its wrapped decoder") is **not shown**: leaning that way,
  under a failed A/A. With (b)'s race shown, the page's rule is the verdict's to apply (PAGE-RUNS-VERDICT).

**Firefox D1** (`r3-firefox-D1.jsonl`, Firefox 160.0.1, 18 rounds × 9 units, Williams-balanced; cut at round 9 by the
driver defect below and resumed from round 9, `fromRound: 9`; round 9's partial rows in `r3-firefox-D1.cut-round9.jsonl`).
**Measured**, against §2's Firefox prediction (Chromium's REPORT-RUN-2 pattern):

| | measured | predicted | |
| --- | --- | --- | --- |
| safety report, every arm | 18/18, but `off` 16/18: its 2 loads never filled (`reached: "starting"`, `VOID: no fill`) | 18/18 every HTTP arm; ~2–3 % no fill | hit (2 of 162 no fill, 1.2 %) |
| fill record, Y arms and SESSION-1 | 18/18 each | delivered | hit |
| fill record, BEACON-H, KEEPALIVE-H | 17, 14 of 18 | H arms deliver at a navigation | hit (BEACON-H), KEEPALIVE-H loses 4 |
| fill record, SESSION-H | 2 of 18 | SESSION-H fails the load bar | hit |

**Firefox D5a** (`r3-firefox-D5a.jsonl`, idle page, the kill 50 ms after the fault, every content process; 18 rounds
× 9 units, Williams-balanced; cut at rounds 2 and 5 and resumed, `fromRound: 8` for its last part; 162 of 162 reached
the mismatch, no error, no late kill). **Measured**: safety report 18/18 every arm; fill record 18/18 for each Y arm
and SESSION-1, 0/18 for each H arm and `off`. Predicted: Chromium's idle pattern (safety 18/18; H arms lose the fill
record under a kill): **hit** on every cell. The race is not placed on an idle page (each report left before 50 ms),
as on Chromium in REPORT-RUN-2.

**Firefox L** (`r3-firefox-L.jsonl`, idle page, 20 later faults a load; 18 rounds × 9 units, Williams-balanced;
resumed, `fromRound: 12` for its last part). **Measured**: no later report lost (one `off` load never filled,
`VOID: no fill`); per-load p99, median of 18: BEACON-* and `off` 5.6–6.4 ms, KEEPALIVE-* 5.3–5.5 ms, SESSION-* 3.2–3.4
ms. **VOID by the A/A**: BEACON-H's floor even ÷ odd rounds 7.12 ÷ 3.17 ms = 2.25, outside 0.95–1.05 (the µs clock in
place): Firefox's beacon floor is not stable on this host; the latencies stand beside, adopted for nothing.

**Firefox D6: unrun.** Under `--tun` every Firefox load's WebTransport session to the relay's address timed out
(`NS_ERROR_NET_TIMEOUT`, 3 of 3 loads in each try; rows kept as `r3-firefox-D6.unrun-wt-timeout.jsonl`); Chromium's
D6 ran under the same relay in REPORT-RUN-2. Not traced (Firefox's WebTransport with a certificate hash on a
non-loopback http origin is the first suspect, **theory**). The remaining Firefox cells (D2 D9 D4 D5b D8 D3 D7 Lbusy C)
are not run, as §2 allows.

**Summary for PAGE-RUNS-VERDICT.** (b) **the race exists** on Chromium: on a busy page BEACON-* deliver 9 of 18,
KEEPALIVE-* 18 of 18 (D5a busy), and Lbusy places the page carriers' hand-off at the long task's end (p99 ≈ 51 ms
against ≤ 3 ms for the worker carriers, its A/A passing). (a) **is VOID** by its A/A (`off′` 1.053); read beside,
KEEPALIVE-Y's cost leans on its wrapped decoder (+7.3 ms over KEEPALIVE-Y°, p 0.09), not shown. SESSION lost 2–3 of 18
safety reports on a busy page, unpredicted. Host CPU ≤ 63 % in every sample of the run (16 257 samples of 5 s; none over
90 %). How it serves the value statement: the checked frame's safety report is what makes a failed check known; on a
busy phone page only a worker carrier delivered it every time.

**Driver defects found while running Firefox (lab only):** step 0's close-rejects-pending left a rejected call no
caller awaited, and Node ended the process on it (cut D5a at round 2, D1 at 9, L at 4): fixed in `e9b0e0a9b`,
`712a3fc67`, and the driver now logs a dropped `BiDi socket closed` and goes on (any other error still stops it). Each
cut cell went on from its first incomplete round; no partial round is counted.

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
* **Order and VOID** (§Review m7): the six runs alternate versions in the order 159, 160, 160, 159, 159, 160, a fresh
  profile each. A run whose trace fails its completeness check (a frame with no submit, or with neither an output
  nor an error) is `VOID` and rerun once at the end; a version with fewer than 2 complete runs is not read. A
  complete run whose failure set differs from the logs' (frames 1–7, 9–15, 17–19) is reported beside them, never
  dropped: the clause is then not deterministic on that build, and the prediction is read on each run.

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
check 0–500 ms. **12 rounds**, two whole Williams periods of six arms (`lab/order.mjs`; a period of six is six
rounds, so the page's 7 would leave one round over and `balanced()` false), Firefox 160.0.1 alone (the page's cell;
Chromium was measured under this bar already). The page's "7 rounds" is met by 12; if the host's time runs short the
cell stops only at a whole period, and 6 rounds is named as under the page's 7 (§Review m4).

| measure (MiB, median) | predicted, 160.0.1 | anchors (measured) |
| --- | --- | --- |
| `disk` growth | 420–580 | 440 on 155.0; 542 on 159.0 |
| `ring` growth | 680–880 | 702 on 155.0; 828 on 159.0 |
| `ring` − `disk` | **250–310**, so `ring` qualifies on memory | 262 (155.0), 286 (159.0, struck bar) |
| rounds with `ring`'s growth ≤ median `disk` + 320 (the bar is per round) | **12 of 12** (low confidence) | room under the bar in the largest round: 50 MiB on 155.0, 12 on 159.0 (`engines` §3) |
| `ring` fill ÷ `today` (amended reading) | **0.80–0.95** | 0.85 on 155.0; 159.0's 1.30 was under the struck reading, which read 155.0 at 1.23 |
| `ring2` vs `ring` | within 64 MiB and 0.90–1.10 in fill | A/A 22–30 MiB |

**Theory** (`engines` §5): the ring's memory is fixed by its design, so a new Firefox moves only the floor; the bar is
not expected to flip. **Refuted** (each a miss, named): the `ring` − `disk` median outside 250–310; any round of
`ring` over median `disk` + 320; the fill ratio outside 0.80–0.95. **The bar flips** (the decision, apart from the
misses) when any round is over `disk` + 320 or the fill ratio is over 1.10: then `ring` does not qualify on 160.0.1.

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

### Results (ENGINE-CELLS, 2026-11-24, a session that wrote none of this protocol)

**3a, measured.** Six counted runs, 19:37 UTC, in the pre-registered order (159.0.1, 160.0.1, 160.0.1, 159.0.1,
159.0.1, 160.0.1), each a fresh profile; Firefox fetched from `archive.mozilla.org`, both tarballs matching their
`SHA256SUMS`. Rig `claude/engines` `7048b6534` (`client/contract/webcodecs-trace.js`, clause
`aGroupTracedThroughWebCodecs`, run only when named); its mutant (`drop=instance`) fails the completeness check. Raw
logs, a summary and a node read of the units' layouts: `claude/engines:docs/decode/engine-cells/3a/`.

* **Complete:** 6 of 6, none `VOID`. The failure set is the logs' on every run (frames 1–7, 9–15, 17–19), so the
  clause is deterministic on both builds.
* **Routing:** every frame of every run was submitted to its keyframe's decoder worker (20 of 20, six times).
  Keyframes 0, 8 and 16 went to the stream's `VideoDecoder`, came back with the chunk's own timestamp, and were exact.
* **Inter frames never reach a `VideoDecoder`** (0 chunks in six runs). `av1.js` `route()` chooses per payload from
  `av1-payload.js` `layouts()` (lines 168–174), which reads the layout from the unit's own sequence header. A delta
  unit has none, so an 8-bit inter frame is probed as `g8` (Main, 4:0:0), while its keyframe (profile 1) is probed
  as `c8`. Firefox refuses the `g8` probe at configure (`av01.0.00M.08.1.110.02.02.02.0`: "The given encoding is not
  supported.", every run), so the frame goes to dav1d-WASM. dav1d never decoded the keyframe, and `continues()`
  fails the frame: "frame N−1 was not decoded before it here".
* **"Elsewhere" is a reading of missing frames.** `dispatch-rig.ts:1228` compares the decoder of a frame that never
  arrived (`undefined`) with its keyframe's. Every "elsewhere" frame is a failed frame, not a misrouted one.
* **Against the prediction:** *the dispatch is ours* **held as to whose fault it is**: the client's, not Gecko's.
  **Its mechanism missed**: the cause is not the downloader's dispatch and not callback timing in
  `av1-webcodecs.js`, but the layout chosen for a unit with no sequence header. The refutation condition did not
  arise: no wrong samples came back from Firefox's `VideoDecoder`, because it was never handed an inter frame. So
  how the engine decodes inter frames is **not shown** by this cell, right or wrong.
* **Derived, not run:** Chromium passes because it accepts the `g8` probe, so its inter frames stay on the stream
  that holds the keyframe. On Firefox, an 8-bit AV1 series in groups whose keyframe layout passes (`c8`, `g8f`)
  fails every inter frame by name. An ultrasound colour view coded AV1 at G > 1 would be one such series. The grey
  DBT view is not affected, because Firefox also refuses its keyframe's `g8`, so the whole group goes to dav1d
  (`engines` row 1). Frames fail by name and never come back wrong.
* **A bug with no trade-off, not built here** (a run row): the fix is for an inter frame to take its group's layout
  from its keyframe. It is named for BRIEF-WEEKEND's list. `engines` item 3 now reads: the client's layout choice,
  not the engine.

Fixtures and limits: `client/contract/av1/g8x20` only, the rig's synthetic 8-bit 4:4:4 set of 20 frames in groups
of 8, not DBT, not ultrasound; one 4-vCPU cloud container without a GPU, headless Firefox 159.0.1 and 160.0.1 on
Linux x86-64, software decode; no timing claimed. Decode only, no link, so the transport line does not apply. How it
serves the value statement: the Firefox reader of a colour stack in groups gets a view that fails by name; the fix
restores that view, and every frame stays exact.

**3b, measured.** 12 rounds, two whole Williams periods of the six arms (72 rows, every row 80 of 80 frames exact
and on disk, none stopped). Run 2026-11-24 19:53–20:15 UTC on Firefox 160.0.1 over Marionette on Xvfb. The rig is
`claude/frame-memory-m5-run` `1a90eb992` with `claude/core-m5b`'s `lab/opfs-cache/`, its decoders matching
`manifest.sha256`. One uncounted smoke round ran first. Rows, `summary.py`'s output and `against.py`:
`claude/engines:docs/decode/engine-cells/3b/`. The command block above says `--rounds 7`; this run used the
text's 12 (§Review m4).

| measure (MiB, median) | predicted | measured | |
| --- | --- | --- | --- |
| `disk` growth | 420–580 | 526 [477–594] | held |
| `ring` growth | 680–880 | 764 [691–831] | held |
| `ring` − `disk` | 250–310 | 237 (of the medians; 226 paired by round) | **missed**, below the band: the ring sits nearer the floor than predicted |
| rounds with `ring` ≤ median `disk` + 320 (846) | 12 of 12 | 12 of 12, least room 15 MiB | held |
| `ring` fill ÷ `today` | 0.80–0.95 | **1.241** [1.130–1.430], every round over 1.10 | **missed** |
| `ring2` vs `ring` | within 64 MiB, 0.90–1.10 | 47 MiB, 0.980 | held, not `VOID` |

**The bar flips** on the fill, not on memory: `ring` does not qualify on 160.0.1 (median fill 8.27 s against
`today`'s 6.26 s on loopback, a ratio inside each round). `summary.py`'s verdict: no arm qualifies on Firefox
(`transfer` and `transfer-k` 1.47–1.49 and over the memory bar; `disk` 1.23, and its ask 29.7 ms against `ring`'s
0.02 + 16.7). 155.0's 0.85 is not reproduced. 160.0.1 reads like 159.0's 1.30, which was taken under the struck
reading. So `engines` item 4 reads: on Firefox 160.0.1 the ring holds its memory and misses the fill bar. Chromium's
rows under the same bar stand as measured; the rule wants both engines, so lever 2 stays with the owner, as
`summary.py` prints. **Host:** CPU busy 0.71 median [0.62–0.92] through the fills, so the host is near its ceiling.
No fill time is claimed as an absolute, only as a ratio inside a round. None stopped for "host saturated".

Fixtures and limits: one synthetic series of 80 frames of 3328×4096 (2.03 GiB decoded), from
`lab/viewer-ceiling/make_series.py`. It is not DBT pixel data, though DBT-sized; no ultrasound. Loopback, no relay,
so neither the link nor the decode binds: the cell is memory and the store's write path. One 4-vCPU, 16 GiB cloud
container without a GPU; Firefox 160.0.1 alone; a 256 MiB window. How it serves the value statement: on Firefox the
fixed memory bound costs about a quarter more full-fill time than today's store. The owner's lever 2 decides between
a bounded tab and the "fast full fill".

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

**Rounds and order.** 10 rounds a cell of five arms (one mirrored Williams period of five); P1b's four arms run 12
rounds (three whole periods of four: a period of four is four rounds, so 10 is not whole, §Review m5); cells in a
Williams order each round (`run.mjs:7,518-521`). `--mutate sample` before round 0 must turn every arm's exactness to 0.
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

### §4 Amendment (ASK-CELLS, 2026-11-24, before the first counted row)

Found in the run row's builds and smoke (rows not counted; `claude/ask-cells`, `lab/viewer/rows/ask/pilot*.jsonl`,
`mutate-*.jsonl`), by a session that wrote none of this protocol. The predictions above are unchanged; what changes is
what the cell is, and how its ρ is read.

* **The series is the exact one, not the view.** `dbts_b1` goes through the product's ingest as HTJ2K
  (`lab/viewer/view_frames.py`): an exact frame is 16.9 Mbit (**measured**, `000.htj2k`), not the 3.71 Mbit of the AV1
  view that ρ = 0.216 was derived from (`ask-model.md:277`). The view is coded in groups of 8, under which the tip's
  window asks whole groups again (`claude/work-ledger:docs/queue/IMPROVE-1/candidates.md` §2, WINDOW-WHOLE-GROUPS);
  the hold the model ranks is a frame's, so the exact series is run. On `r20000rtt40` μ̂ is about 1.1 frames a second
  (**measured**, pilot; below).
* **The paint sets the pace.** The page view paints an 8.5-Mpixel frame through software WebGL in ~100–150 ms
  (**measured**, smoke): the display cannot step at 25 a second on this host. The reader steps 40 ms after a frame is
  painted; a step's wait is from its due time to its frame held (the paint is not a wait). Each visit reports μ̂ (the
  window's first fill of W frames, no reader: (W − 1) over its time) and the step's pace without waits; ρ = μ̂ × the
  step. The model's words already bind the values ("the order and the gaps are predicted, not the values"); the
  order and the refutation rules are read as registered, at the cell's own ρ.
* **The legs sit away from the series' edges**: 12 at 19–31, 20 at 15–35, 40 at 5–45 (approached from frame 0, the
  approach and the first leg not counted). ASK-MODEL-FIX's `legs.py`, bounded to 50 frames
  (`claude/work-ledger:docs/queue/ASK-CELLS/bounded.py`, **derived**): every no-dwell cell is edge-free (bounded =
  unbounded to 0.01 s), but **P1b is not**: with a 3 s dwell at 45 and 5, the 4–5 frames past each turn fill during
  the dwell and the bounded model gives 4.09, 4.19, 4.09 s (always, centred, the rule), so P1b's own refutation line
  ("behind first always is not the longest") is met by the model itself on 50 frames. P1b runs as registered and is
  read against both; it cannot decide `asking` §6's P1b on this series.
* **Legs a visit**: 9 at 12 and 20 (8 counted), 5 at 40 (4 counted), for a visit's length.
* **(e) is not built**: the product's default is W = 15 on `dbts_b1` (`memoryWindow`), every cell's W; each visit
  reports the window it ran.
* **The page view only**: the hold is installed on the page view's controller (`claude/ask-cells:lab/viewer/hold.js`); the worker
  view's store is the same class and is not driven. *Centred* and *centred′* are the product's own store, no lever.
* **The struck split's ρ** is the cell's nominal (0.216; 0.862 on `r80000rtt40`), not its measured one.
* **Mutants**: `--mutate hold` (no hold installed) and `--mutate legs` (legs one frame short, which the driver's
  leg-length assert fails) run before round 0, with `--mutate sample`; unit mutants M1–M6 each fail `hold.test.mjs`
  or `trace.test.mjs`.
* **The pilot** (one round, not counted, `lab/viewer/rows/ask/pilot*.jsonl` at `claude/ask-cells`): on `r20000rtt40`
  μ̂ 1.17–1.18 frames a second, a step of 178–239 ms without its waits, so ρ 0.21–0.28 (**measured**), near the
  registered 0.216 by the paint's pace rather than by design. P1-20, one visit an arm: behind first 4.89, centred
  5.33, the struck split 7.55 s a leg. `--mutate hold`: behind first 5.82, the struck split 5.61 s (each reads as
  centred); `--mutate legs`: the visit fails "leg 1 took 11 steps, not 12"; `--mutate sample`: 0 of 15 exact in
  every arm. On `r80000rtt40` μ̂ 5.29 a second against a step of 226 ms: ρ ≈ 1.2, the paint, not the link, sets the
  pace, so P1c's second control is ρ > 1, not ρ ≈ 0.8. Its gate: the busiest core 0.79 at most (1 s samples of
  `/proc/stat` over one visit), the relay's p99 0.43 ms: it runs. Also seen: P1c-12 received 20–21 frames after the
  first pass in both arms piloted (the window follows the display past 19–31), where P1c predicts none; read in the
  counted rows.
* **The live guard** is read over every counted step, both directions (the legs are symmetric).
* **Order**: per round, P1-20, P1-40, P1c-12 and P2 (five arms) in one Williams order, then P1b's round (four arms),
  rounds 0–9 and P1b's 10–11; P1c-80 after. VOID visits are re-run after the last round.

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
| L, S1 1× and S2 1×, 12 rounds, both engines (item 1) | PSS growth by process | OPFS-SYNC's ~100 MiB over `none` on Chromium (measured 125 / 123 against 25) sits in **one** process and does not scale with the frame: S1 and S2 within 20 MiB of each other (**assumed**: this file's number, not §10.4's, which says only "does not scale with the frame"; 20 sits above the 2 MiB between the measured 125 and 123 and under the 32 MiB A/A line, item 1); in the storage or utility process it is a constant per origin, in the renderer it is the rig's (CP:905-910) | the growth spread over processes, or differing by more than 20 MiB between S1 and S2 |
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

### §5 Amendment (CACHE-CELLS, 2026-11-25 12:18 UTC, before the first counted row)

By the run row, a session that wrote none of this file. Nothing here changes a prediction above; it says what this
container runs and how the record is kept.

* **CACHE-DESIGN-1124 has no output** (no status file; nothing by `git log --all --since=2026-11-24T00:00Z` but the
  rows of the phase 2 queue): the run goes ahead at its fallback, and its verdict is **provisional** on the store question.
* **Firefox is not run here.** Fetching `firefox-159.0.1.tar.xz` from `archive.mozilla.org` was refused in this
  container (the session's tool permission check, 2026-11-25 12:12 UTC: "Permission for this action was denied"), so
  every Firefox cell, item 4's pre-registered one among them, is `blocked`; the commands for a run elsewhere are below.
* **Chromium is Playwright's build 1243**, `--version` "Google Chrome for Testing 158.0.8127.36" (the run's build,
  printed in each settings row; CACHE-RUN's was 153.0.8010.12). Headless, it runs as `chrome-headless-shell`. A probe
  of its process tree (*run once*, 12:10, not a cell) found a browser, a network utility, two zygotes, a renderer and
  a GPU process, and **no storage-service process**: on this build OPFS is served by the browser process, so the
  `storage` kind cannot occur, and a growth there reads as the browser's.
* **Item 4 on Chromium** (*derived* by this row from CACHE-RUN's rows, before any counted row; the pre-registered cell
  is Firefox's): OPFS-ASYNC's O at S1 was 1.85 ms a frame warm (`rows/chromium/O-512-1x.jsonl`, median of 10) against
  OPFS-SYNC's 0.36, which opens one handle a series. If the handle's open is the difference, one open a group
  (*G* = 15 at S1: 8 MiB ÷ (512² × 2 + 28 B); 16 above is a rounding) predicts 0.36 + (1.85 − 0.36) ÷ 15 ≈ **0.46 ms,
  under 1 ms**, refuted at ≥ 1 ms; S3 (*G* = 1) unchanged, its warm read 749 ms, refuted outside ×0.90–1.10.
* **O's arms** are OPFS-SYNC, OPFS-SYNC′ and OPFS-ASYNC (the A/A ratio rule needs the pair), 6 rounds, one mirrored
  Williams period of three. **T** runs OPFS-SYNC alone, 12 rounds (no order to balance).
* **`verify`'s record**: every index's `[i, hit, why, xxh3, sha]` when a row has at most 256 (T, O), and past that (L
  at S1, 2 389) the non-exact ones with the count of each class; an exact index is one with all three true.
* **Mutants**: of `mutants.sh`'s seven, the four that reach these cells (slot-held and view-copy on L, drop-writes on
  O, tab-writes on T), one round each, on the run's arms only. The builds' own mutants are in their unit tests
  (`claude/cache-arms` `5766cfc53`, `dbccc29d3`, `8f2110c83`).

Commands (this run, and Firefox's elsewhere):

```bash
bash lab/cache-arms/rows/cells-1125.sh chromium mutants     # then L-512, L-2560, T, O-512, O-3328: one job each
# Firefox, on a host that can fetch it:
curl -LO https://archive.mozilla.org/pub/firefox/releases/159.0.1/linux-x86_64/en-US/firefox-159.0.1.tar.xz
tar xf firefox-159.0.1.tar.xz && Xvfb :99 & export FIREFOX_PATH=$PWD/firefox/firefox DISPLAY=:99
for c in mutants L-512 L-2560 O-512 O-3328; do bash lab/cache-arms/rows/cells-1125.sh firefox $c; done
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

**Fix** (PAGE-RUNS-PROTOCOL-FIX, 2026-11-24, by a session that wrote neither this file nor its review and will run
none of it; this file and `docs/lines/coordination.md` only; nothing run but `git` reads and two binomial sums).
B1: arm **WT-AF** (`--stream-mode per-frame-asks-first --send-window-bytes 6291456`, row 211's arm; the review's "the
default 6 MiB window" is quinn's 10 MB unless set, `tuning.rs:58-61`, so it is set) with its mutant and predictions,
what carries from row 211 and what does not; WT-AF decides #39; **#96 stays held**, its lever absent from the rig's
server, named for BRIEF-WEEKEND; §1 now 7 arms, 14 rounds (one mirrored period). B2: D5a on a busy page is a build
(`D5a-busy`: Lbusy's page, the kill delay drawn per load on 0–50 ms by a seeded rule, recorded; its mutant fails a
spread check); the band re-derived, 10–17 of 18 (expected 13.5), read against the recorded delays; 18 of 18 refutes
the race as modelled. m1: WT-PF's basis restated (ranks, row 180's tie), its AD band ×0.95–1.45. m2: AD, then CR
(`--cell AD` runs both forms). m3: **argued in part**: AD-PUB's prediction is a tie at the A/A's ×0.95–1.05, so a ×0.80
refutes; on AD-LTE the 0.1 % loss holds cwnd near 0.06 MB, under the 2 MB TW needs, so TW gains, ×0.70–0.88 (≈ ×0.78
derived), and a median of ×0.75–0.85 there alone is named as not deciding. m4: §3b 12 rounds (two whole periods),
the ring − disk band a miss either side, the per-round bar predicted 12 of 12. m5: P1b 12 rounds. m6: 20 MiB labelled
**assumed**, with why. m7: §3a's order (alternating versions) and VOID rule (an incomplete trace, rerun once).

### Re-review

PAGE-RUNS-PROTOCOL-FIX-REVIEW, 2026-11-24 16:07–16:20 UTC, by a session that wrote none of this file, its review or
its fix and will run none of it (`by:` in `claude/work-ledger:docs/queue/PAGE-RUNS-PROTOCOL-FIX-REVIEW.md`). Read: the
fix's commits `b630a3738`, `131198c9d`, `4d263a209` (`git diff 9c752355f..4d263a209`: this file and
`docs/lines/coordination.md` only, every hunk under B1, B2 or m1–m7); at `origin/claude/transport-arms`
`stream_mode.rs`, `link.rs:205-232,255-270`, `tuning.rs:55-61,100-112`, `run.mjs:43-70`, `lab/order.mjs`; at
`origin/claude/report-arms` its rig's `run.mjs:138-209`; at `origin/claude/av1-unified-mainbase`
`quic-compared.md` §9.7 (its theory table and *Measured*); `av1/queue.md` rows 180, 207, 211 on `claude/unified`.
Nothing run but `git` reads, `scripts/check_links.py` (9 unresolved, as before the fix) and the fix's sums, recomputed:
Binomial(18, 0.75) gives P(10–17) 0.975, P(18) 0.0056, P(≤ 16) 0.961; the range of 18 uniform draws on 0–50 ms is
under 30 ms with probability 1.3 × 10⁻³; 1.2 ÷ √0.001 = 37.9 packets = 0.057 MB; (4.36 + 2.15) ÷ 8.44 = ×0.77,
(2.25–3.2 + 2.15) ÷ 8.44 = ×0.52–0.63, (0.06 + 2.15) ÷ 8.44 = ×0.26, (10 + 2.15) ÷ 8.44 = ×1.44. All hold.

* **B1: open in part (R-B1, blocker).** The arm, its flags (`--send-window-bytes` is the rig server's, `tuning.rs:60`;
  quinn's 10 MB default is `quic-compared.md` §9.7's "quinn's 10 MB send window"), its mutant, its predictions, "WT-AF
  decides #39" and "#96 stays held" are in §1 as B1 asks. But §1's **Commands**, which TRANSPORT-FLAGS-RUN runs, still
  read `--rounds 12 --arms WT-TS,WT-TS\',WT-TW,WT-PF,H3-fill,H3-frame` for both cells, and the VOID line's pilot is
  "for WT-TW and WT-PF". Run as written, WT-AF is never measured, so #39 is again claimed on no arm, and 12 rounds of
  the seven arms §1 now names would not be one whole period (`lab/order.mjs:16`: "2n for odd n", 14). Fix: both
  commands with `WT-AF` in `--arms` and `--rounds 14`; the pilot for WT-TW, WT-PF and WT-AF; nothing else.
  (§Review's coverage line "§1's 12 rounds = two of six" is the record of the file it read, not a defect.)
* **B2: closed.** `D5a-busy` is named as a build with its seed rule, the delay recorded beside `row.kill` (the rig's
  `killAfterFault`, `run.mjs:139`, and its fixed `ending === "D5a" ? 50 : 500`, `:208`, read), a spread mutant whose
  false-alarm rate is derived, the band re-derived from the stated distribution (the task phase **assumed** independent,
  said), read against the recorded delays, and 18 of 18 named a refutation. The race rule's 0.96 is right.
* **m1: closed** (ranks from `link.rs:215-226` and its test; row 180's ×0.96–1.03 labelled another rig; the ×1.44
  upper end derived). **m2: closed** (AD, then CR; `--cell AD` runs both forms, `run.mjs:68`). **m3: argued, accepted**:
  PUB a tie at the A/A's band, so ×0.80 refutes there; LTE's gain rests on Cubic's window under random loss at
  ~1.2 ÷ √p, the form §9.7 itself uses ("Under random loss Cubic's window is ~1.2 ÷ √p packets"), **theory**, and a
  median of ×0.75–0.85 on AD-LTE alone is named as not deciding. **m4–m7: closed** as §Fix says.
* **r-m1 (minor).** WT-AF's AD-PUB upper end cites row 211 "×0.87–0.98 measured" behind deep FIFOs. In §9.7's table
  ×0.87 is uncapped asks first's; the + 6 MiB arm, the one WT-AF copies, measured ×0.91–0.98 there (18/800, 103/360,
  103/800, 103/92/800), and its 0.98 is above the band's ×0.95. Restate the anchor, and widen the band to it or say why
  not.
* **r-m2 (minor).** WT-AF's AD-LTE band ×0.25–0.50 leans on row 211's loss cells (×0.18–0.19 measured against the
  arithmetic's ×0.09, about twice it), but twice ×0.26 is ≈ ×0.54, above the band; and row 211's loss was 1 % behind
  20 ms, not 0.1 %, a window ~√10 smaller, so the carry is weaker than "the band is" says. Widen or argue.
* **r-n1 (nit).** AD-PUB's cwnd lower end of 2.25 MB has no source in the line; it reads as Cubic's β (0.7 × 3.2 MB):
  say so. "≈ 39 packets" is 37.9 by the formula given.

**Verdict.** One blocker open (R-B1, §1's commands); PAGE-RUNS-PROTOCOL-FIX-2 and -FIX-2-REVIEW appended to
`claude/work-ledger:docs/queue-2026-11-24.md`. TRANSPORT-FLAGS-RUN waits on the second re-review; REPORT-RERUNS
does not (its blocker, B2, is closed; R-B1 is §1's alone); ENGINE-CELLS, ASK-CELLS and CACHE-CELLS were never waiting
on this. How it serves the value statement: the run that decides #39 is the one that says whether an ask during a fill
("low latency on every jump") can be had within WebTransport, so the arm must be in the commands that run.

**Fix 2** (PAGE-RUNS-PROTOCOL-FIX-2, 2026-11-24, by a session that wrote none of this file, its review, its fix or its
re-review and will run none of it; §1 only, before any row). **R-B1**: both commands carry `WT-AF` in `--arms` and
`--rounds 14` (seven arms, one mirrored Williams period, `lab/order.mjs:16`), and the VOID line's pilot covers WT-TW,
WT-PF and WT-AF. **r-m1**: the anchor restated as the + 6 MiB arm's ×0.91–0.98 behind deep FIFOs (row 211, §9.7's
table; ×0.87 named as uncapped asks first's), WT-AF's AD-PUB band widened to ×0.52–0.98, and a median in ×0.95–0.98
read as no gain for #39, since it sits inside the A/A's band. **r-m2**: the AD-LTE band widened to ×0.25–0.57 (row
211's measured-to-arithmetic ratio, 2.1–2.2, applied to ×0.26), the carry labelled **assumed** with its two
differences (1 % loss behind 20 ms against 0.1 %; 0.57 MB frames); the band stays under the ≤ ×0.8 rule, so #39's
decision does not move. **r-n1**: AD-PUB's cwnd range sourced (the 3.0 MB queue plus the 0.23 MB path; the floor
× Cubic's β = 0.7, RFC 9438 §4.6, quoted), and "≈ 38 packets (37.9)". Each change is dated in §1's amendment note.
Nothing run but `scripts/check_links.py` (9 unresolved, as before) and the sums: 1.2 ÷ √0.001 = 37.9; 3.0 + 0.225 =
3.2 MB, × 0.7 = 2.26 MB; 0.18–0.19 ÷ 0.086 = 2.1–2.2, × 0.262 = ×0.55–0.57.

### Re-review 2

PAGE-RUNS-PROTOCOL-FIX-2-REVIEW, 2026-11-24 17:16–17:25 UTC, by a session that wrote none of this file, its review,
its fix, its re-review or fix 2 and will run none of it (`by:` in
`claude/work-ledger:docs/queue/PAGE-RUNS-PROTOCOL-FIX-2-REVIEW.md`). Read: `git diff 784c88420..cc7b9ccee` (this file's
§1 and §Fix 2, `docs/lines/coordination.md`; every hunk under R-B1, r-m1, r-m2 or r-n1, nothing else changed); at
`origin/claude/transport-arms` `lab/order.mjs`, `lab/transport-arms/run.mjs:31-77,258-274`, `summary.py`,
`stream_mode.rs:8-16`, `tuning.rs:56-61`; at `origin/claude/av1-unified-mainbase` `docs/native/quic-compared.md` §9.7
(its *Measured* table, row 211); RFC 9438 (https://www.rfc-editor.org/rfc/rfc9438.txt, §4.6). Run: `williams(7)` from
`lab/order.mjs` over 12 and 14 rounds (14: every arm twice at every position, `balanced()` true for all seven; 12:
positions uneven, 1–3), `scripts/check_links.py` (9 unresolved, the same as before: 0 new), and the sums below.

* **R-B1: closed.** Both commands read `--rounds 14 --arms WT-TS,WT-TS\',WT-TW,WT-PF,WT-AF,H3-fill,H3-frame`
  (`run.mjs:52,76` read `--arms` and `--rounds`), 14 being one mirrored period of seven (`order.mjs`: "the period is
  n rounds, 2n for odd n", checked above); the VOID line's pilot covers WT-TW, WT-PF and WT-AF. WT-AF's flags exist
  in the rig's server: `PerFrameAsksFirst` under `#[cfg(feature = "lab-levers")]` (`stream_mode.rs:13-15`) and
  `#[arg(long = "send-window-bytes")]` (`tuning.rs:59`), and the build line carries `lab-levers`.
* **r-m1: closed.** Row 211's + 6 MiB column behind the deep FIFOs reads ×0.98 (18/800), ×0.92 (103/360), ×0.92
  (103/800), ×0.91 (103, 92 ms, 800): ×0.91–0.98 as stated; ×0.87 is the uncapped column's. The band now reaches
  ×0.98, and a median in ×0.95–0.98 is read as no gain, inside the A/A band, so the ≤ ×0.8 rule still decides.
* **r-m2: closed (argued and labelled).** The loss cells' + 6 MiB asks are ×0.19 and ×0.18; the arithmetic for them,
  cwnd 1.2 ÷ √0.01 = 12 packets = 0.018 MB, gives (0.018 + 0.57) ÷ (6.29 + 0.57) = ×0.086; 0.18–0.19 ÷ 0.086 = 2.10–2.22;
  × (0.057 + 2.15) ÷ 8.44 = ×0.262 gives ×0.550–0.580. The carry is labelled **assumed** with both differences named.
  See r2-n1 for the band's top.
* **r-n1: closed.** RFC 9438 §4.6, quoted verbatim from the text edition: "The parameter β__cubic_ SHOULD be set to
  0.7" (the underscores are the plain-text rendering of the subscript). 90 Mbit/s × 20 ms = 0.225 MB; 3.0 + 0.225 =
  3.225 MB; × 0.7 = 2.26 MB; (2.26 + 2.15) ÷ 8.44 = ×0.52, (3.225 + 2.15) ÷ 8.44 = ×0.64 (the line's ×0.63 rounds
  3.2, not 3.225: inside the band either way). "≈ 38 packets (37.9)" holds.

New, none blocking (each the run row's first step, lab only, or a line):

* **r2-m1 (minor).** §1's summary cannot report the three arms that decide the page: `summary.py:13` fixes `ARMS` to
  the eight of §5.1, and its tables iterate that list (`:35`, `:45`, `:76`), so WT-TW, WT-PF and WT-AF are never
  read. Add "`summary.py`'s arm list" to §1's built-first list (lab only, with the per-arm server arguments).
* **r2-m2 (minor).** `--out rows/flags-AD.jsonl` is not resolved against the repository (`run.mjs:77` takes it as
  given; only the default is under `ROOT`), so run from the root the rows land in `./rows/`, while the summary reads
  the rig's own rows directory (its first argument as §1 writes it); and the summary names `flags-AD` only, not
  `flags-CR`. Write both `--out` under the rig's rows directory, beside `pilot-medians.json`, and the summary as
  `summary.py <that directory> flags-AD flags-CR`.
* **r2-n1 (nit).** r-m2's ratio applied gives ×0.55–0.58, not ×0.57 (0.19 ÷ 0.086 × 0.262 = 0.580): a median of
  0.575 would be called a refutation of a band its own sum contains. Write ×0.25–0.58. #39's decision does not move
  (both under ×0.8).

**Verdict.** No blocker open: R-B1, r-m1, r-m2 and r-n1 closed. TRANSPORT-FLAGS-RUN may start; it makes r2-m1 and
r2-m2 as part of its built-first step (lab only, said in its rows, before its first counted row). r2-n1 changes a
prediction, which the run row may not write: the band stands as pre-registered (×0.25–0.57), and PAGE-RUNS-VERDICT
names a WT-AF AD-LTE median in ×0.57–0.58 as inside the band's own sum, not a refutation. How it serves the value statement: the commands that run are now the ones that measure whether WebTransport
alone gives "low latency on every jump" during a fill, and the summary must read the arms that answer it.

## Transport: results (TRANSPORT-FLAGS-RUN)

TRANSPORT-FLAGS-RUN, 2026-11-24 18:50–21:54 UTC, by a session that wrote none of this file, its reviews or its
fixes (`by:` in `claude/work-ledger:docs/queue/TRANSPORT-FLAGS-RUN.md`). Every number below is **measured** on this
run unless labelled. Raw rows: `claude/transport-flags` `lab/transport-arms/rows/flags-*.jsonl` (`007ab4bf4`,
`5b38c8982`), copied into [`page-runs-rows/`](page-runs-rows/) with the summary,
[`flags.summary.md`](page-runs-rows/flags.summary.md) (`summary.py lab/transport-arms/rows flags-AD flags-CR`).

**Built first** (lab only, `claude/transport-flags` `4aa86d5de`, from `origin/claude/transport-arms` `4b2abcb6d`; no
product code): the three arms with their own server arguments in `run.mjs`'s `ARMS`; the driver's build
`--features lab-get,lab-levers`; a start-up check (`judge.mjs`): a visit whose server output lacks what its arm's
flags print (`stream_mode=…`, `send_window=6291456`, TW's lab warning) is `VOID` (§Re-review 2's r2-m1 too: `summary.py`
reads every arm). The banner prints no line for `--send-window-follows-cwnd`; TW is checked by the server's own
lab-lever warning, not the banner. `judge.test.mjs` has the case; with the check removed the test fails.
**Mutants**, rows not counted: `ignored-arg` (WT-AF's arguments dropped, its expectation kept), 1 round of AD: WT-AF
`VOID` on both forms, killed. `af-as-pf` (WT-AF as plain `per-frame` under the same 6 MiB window), 2 rounds: AD-PUB
×1.00 against WT-AF's ×0.78, its gain lost, killed. `no-arm-flag` (WT-TW without its flag), 2 rounds: AD-PUB ×1.01,
a tie as §1 requires; it cannot tell TW from WT-TS there, since TW's own prediction on PUB is a tie too.
**Pilot** (2 rounds of WT-TS, WT-TW, WT-PF, WT-AF on AD and CR, not counted) extended `rows/pilot-medians.json` by
the three arms. **Departures from §1's commands**, none changing a cell: `--series` (the run's `dbts_b1` HTJ2K, 50
frames, 107 407 602 B, every one decoded exact by `ingest_coded.py --codec htj2k`) and `--server` (the binary built
by §1's `cargo build` line) passed; `--out` under the rig's rows directory (r2-m2).

**AD** (latency: the asked frame's last byte − the page's ask; ratio to WT-TS in the same round, median, range;
14 rounds, `balanced()` flagged nothing):

| arm | AD-PUB | band | | AD-LTE | band | |
| --- | --- | --- | --- | --- | --- | --- |
| WT-TS (ms) | 736 | | | 5 603 | | |
| WT-TS' | ×0.996 (0.963–1.028), tie | ×0.95–1.05 | hit | ×1.029 (0.881–1.389), not conclusive | ×0.95–1.05 | hit |
| WT-TW | ×0.993 (0.969–1.015), tie | ×0.95–1.05 | **hit** | ×1.037 (0.803–1.227), 4 of 14 better | ×0.70–0.88 | **miss** |
| WT-PF | ×1.549 (1.278–1.598), worse | ×0.95–1.45 | **miss** (above) | ×1.696 (1.239–2.253), worse | ×0.95–1.45 | **miss** (above) |
| WT-AF | ×0.780 (0.722–0.802), 14 of 14 better | ×0.52–0.98 | **hit** | ×0.535 (0.270–0.835), 13 of 13 better | ×0.25–0.57 | **hit** |
| H3-fill | ×0.548 (0.518–0.581) | 0.50–0.60 | hit | ×0.564 (0.304–0.770) | 0.47–0.58 | hit |
| H3-frame | ×1.829 (1.702–2.243) | 1.6–2.0 | hit | ×1.671 (0.920–6.595) | 1.5–1.9 | hit |

AD-LTE: 3 of 98 visits `VOID` (the relay's guard twice, one H3-frame visit that spoke nothing); AD-PUB none.

**CR** (fill time: the latest last byte − the dial; 14 rounds; 2 of 98 `VOID`, the relay's guard):

| arm | CR | band | |
| --- | --- | --- | --- |
| WT-TS (ms) | 35 020 | | |
| WT-TS' | ×1.000 (0.999–1.000), tie | ×0.95–1.05 | hit |
| WT-TW | ×1.000 (0.999–1.001), tie | ×0.97–1.03 | **hit** |
| WT-PF | ×0.571 (0.571–0.572), 14 of 14 better | ×0.60–1.00 | **miss** (below) |
| WT-AF | ×0.676 (0.675–0.678), 14 of 14 better | ×0.97–1.45 | **miss** (below) |
| H3-fill | ×1.001 (1.000–1.002) | 0.95–1.05 | hit |
| H3-frame | ×0.620 (0.610–0.663) | 0.58–0.70 | hit |

**Each miss, read.** *WT-TW on AD-LTE* (×1.04 against ×0.70–0.88): the theory that 0.1 % loss holds Cubic's window
near 0.06 MB, so TW's window (cwnd + 4.3 MB) sits under the 6 MiB credit, is refuted as a prediction of the ask;
the run does not say which term failed (cwnd was not read). *WT-PF on AD* (×1.55, ×1.70 against a top of ×1.45):
the asked frame's stream ranks below every open fill stream (§1's **source**) and waits behind more than the 10 MB
window's arithmetic gives; worse than predicted, same direction. *WT-PF on CR* (×0.571, under ×0.60): it escapes
the stream credit by more than H3-frame (×0.620); §1's **assumption** that Chromium's connection window exceeds
6 MiB holds on this build, and better than the band, not a refutation of the lever. *WT-AF on CR* (×0.676, under
×0.97): the 6 MiB send window did not cap the fill at the stream credit's ~63 Mbit/s (§1's **theory**, refuted), and
row 211's fill cost (+2 to +44 %, 0.57 MB frames) does not carry to `dbts_b1`'s 2.15 MB frames on this rig: the fill
is 32 % faster, not slower.

**What it decides, by §1's rules.** (1) WT-TW and WT-PF are both above ×0.8 on AD (×0.99/×1.04; ×1.55/×1.70): the
page's next step stands, "a GET path for asks alone is the next structural draft", for TW and PF; QW is untested
(§1). (2) WT-PF at ×0.571 ≤ ×0.75 on CR: **CR is answered within WebTransport** (`--stream-mode per-frame`, a default
build's flag), at the cost of a 1.5–1.7× slower ask during a fill. (3) **#39: net on these cells.** WT-AF is ≤ ×0.8
on both AD forms (×0.780, ×0.535) with a CR fill of ×0.676 ≤ ×1.05: asks first under a 6 MiB send window is the
owner's to adopt; it is a `lab-levers` flag, so a product build row follows, not this run. AD-PUB's ×0.780 sits
0.02 under the rule's ×0.8, its range reaching ×0.802; 14 of 14 rounds better and `aa_rule` "better", but a
narrow margin: named for PAGE-RUNS-VERDICT. WT-AF alone at ≤ ×0.8 keeps "no GET path" open, on that build.
(4) **#96 is not answered** (§1: its lever is not in the rig's server). For the owner, through PAGE-RUNS-VERDICT and
BRIEF-WEEKEND: adopt asks first under a 6 MiB window (#39) as a product build row, yes or no.

**On which links the link, not the decode, binds:** every cell here; the browser decodes only to check each frame
(4 900, 1 568 and 4 900 frames exact on AD-PUB, AD-LTE and CR; none failed). **Where the host saturates:** the
busiest core reached 0.86 (AD) and 0.47 (CR), under §1's 0.95; the relay saturates at 100 Mbit/s and every link here
is at or under 90, so nothing is claimed above it.
**How it serves the value statement:** "low latency on every jump" during a fill is measured here per lever: asks
first gives it (×0.54–0.78) with a faster fill; the one queue's window and per-frame streams do not.

**Fixtures and limits.** `dbts_b1` as HTJ2K only (50 frames, 2.15 MB a frame), one DBT volume of one dataset, no
ultrasound; one 4-core cloud container without a GPU; headless Chromium 158.0.8127.36 (Playwright's; the baselines
of §1 were 157.0.8103.78, which the re-measured H3 arms match within their bands); the rig's userspace relay
(`link_impair.py --tun`), its models of PUB, LTE and CR **assumed**, not a radio; 14 rounds a cell. Limits found by
this run: the banner does not echo `--send-window-follows-cwnd` (found by the start-up check's build); cwnd is not
recorded, so TW's AD-LTE miss is not attributed (found by the miss itself); AD-LTE's spread (WT-TS' 0.88–1.39) is
the 0.1 % iid loss's, so the 2-round mutants' AD-LTE readings say nothing (found by `aa_rule`'s "not conclusive").

## Asking: results (ASK-CELLS)

By ASK-CELLS, 2026-11-24 20:07 to 2026-11-25 06:05 UTC, sessions that wrote none of §4 (the builds, the pilot and main
round 0 by one session; the rest, after it stalled, by a second). Rows `claude/ask-cells:lab/viewer/rows/ask/`
`main.jsonl` (P1-20, P1-40, P1c-12, P2), `p1b.jsonl`, `p1c80.jsonl` at `5364c9f4`; the table is
`node lab/viewer/ask-summary.mjs` over the three, run as written. Read under §4 as amended: an exact HTJ2K series,
the paint sets the step, the order and the refutation lines bind, "the order and the gaps are predicted, not the
values" (`ask-model.md:322`). Waits are per leg after the first pass, median over rounds [10th–90th]; every value is
**measured**.

| cell | ρ (measured) | behind | ¾ ahead | centred | centred′ | struck / rule | A/A median \|Δ\| | prediction | read |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1 legs 20 | 0.21 | 5.23 [4.96–5.33] | 5.25 | 6.14 | 6.11 | struck 7.91 | 0.048 | 0.50, 0.50, 0.87, 1.24 | **holds**: behind first and ¾ ahead shortest and tied, centred, then struck; each 9 of 9 rounds outside A/A |
| P1 legs 40 | 0.21 | 19.19 [18.86–19.34] | 19.20 | 20.06 | 20.06 | struck 21.44 | 0.096 | 3.40, 3.40, 3.77, 4.14 | **holds**: the same order, 10 of 10 rounds each |
| P1b legs 40, 3 s dwell | 0.28 | 19.29 [19.02–19.66] | — | 20.33 | 20.36 | rule 19.28 | 0.070 | 5.85, 4.55, 4.55 (always longest); bounded to 50 frames 4.09, 4.19, 4.09 | **refuted** as registered: behind first always is the shortest (with the rule), centred the longest, 12 of 12 rounds; the bounded model's order |
| P1c legs 12 (control) | 0.21 | 0.42 [0.00–0.73] | 0.10 | 0.00 | 0.00 | struck 0.00 | 0.000 | every arm 0, no byte after the first pass | **refuted** on both lines: behind first above the A/A spread in 9 of 10 rounds; 19–23 frames received after the first pass in every arm |
| P1c ρ ≥ 0.8, legs 40 | 0.92 | 0.00 [0.00–0.03] | 0.03 | 0.47 | 0.40 | struck 0.57 | 0.089 | every arm within A/A | **refuted**: behind first and ¾ ahead 0.43–0.47 s under centred, 10 of 10 rounds |
| P2 corrected, one way | 0.18–0.21 | 22.26 [21.75–22.45] | 22.83 | 23.40 | 23.51 | struck 23.76 | 0.088 | a tie | **refuted**: behind first 1.20 s under centred, ¾ ahead 0.61 s, 10 of 10 rounds; struck 0.30 s over, 9 of 10 |

Every cell's A/A median |Δ| is under §4's 0.10 s bar, so every cell reads (P1-40 at 0.096, closest to it). μ̂ was
1.17–1.18 frames a second on `r20000rtt40` and 5.22–5.29 on `r80000rtt40`; W was 15 in every visit; 298 counted
visits, every frame shown exact (15 of 15 checked a visit, no HTJ2K check false).

**Against the model.** The order is the model's in P1 (both leg lengths); the gaps are larger (0.9 s and 1.8 s at legs
20 against 0.37 s and 0.37 s; values not predicted). Where the model predicts a tie or a null, the run does not give
one: in P1c-12, P1c-80 and P2 behind first and ¾ ahead wait least, and in P1c-12 behind first is the one arm that
waits. *Theory, not tested here*: the window follows the display past the legs (the pilot's finding, §4 Amendment),
so the store asks across the leg's ends and the hold's order decides which frames are there at the turn; the model,
one fetch at a time with no RTT, keeps every arm's frames in reach. P1b meets its own refutation line, as the bounded
model said it would on 50 frames (§4 Amendment): it cannot decide `asking` §6's P1b on this series. The rule waits
as behind first always does (19.28 against 19.29 s), both 1.0–1.1 s under centred.

**What it decides, by §4's rule** (page:119–121): P1 is not refuted on either leg length, so the hold is not dropped
by this run: behind first (or ¾ ahead, tied with it in every cell) waits less than the product's centred store in
P1, P1b, P1c-80 and P2, and never more but in P1c-12's dead control (0.42 s against 0). P1b's two states earn
nothing over behind first always on this series. The adoption is the owner's, through PAGE-RUNS-VERDICT and
BRIEF-WEEKEND: the hold's order behind first as the store's default, yes or no (a product build row; none here).

**Live guard.** At least 10 % of forward steps not held in P1-20 (30–40 %), P1-40 (65–70 %), P1b (70–74 %), P2
(94–100 %) and P1c-80's centred, centred′ and struck arms (25–34 %); P1c-12 is dead by design (0–2 %) and read as the
control; P1c-80's behind first (0 %) and ¾ ahead (3 %) arms are dead *because* they waited for almost nothing, which
is the reading, not a null.

**VOID and interruptions.** 2 visits VOID (P1-20 centred, round 0; P1c-12 struck, round 6; relay p99 over 1 ms),
re-run after the last round as round 12, out of the interleave: those two cells' paired A/A and arm differences are
over the 9 rounds with both, their arm medians over 10. Not counted: main round 5's 13 visits stopped by a container
restart (`interrupted-main-r5.jsonl`; round 5 re-run whole), and P1b round 0's first attempt, lost unpushed when the
first session stopped; nothing else was dropped. The counted visits' relay p99 was 0.95 ms at most.

**On which links the link, not the decode, binds:** on `r20000rtt40` the link (μ̂ 1.17 frames a second of 16.9 Mbit
exact frames, a step of 155–236 ms); on `r80000rtt40` the paint nearly does (ρ 0.92: the step, 176 ms, is the
software WebGL paint's pace; §4 Amendment). **Where the host saturates:** the browser cores were at most 0.62 busy
during a fill (P1c-80; 0.36 elsewhere), the relay held its 1 ms guard on 298 of 300 visits; nothing is claimed for a
paint faster than this host's ~150 ms. **How it serves the value statement:** "low latency on every jump": a scroll
back over a series longer than the window waits 0.4–1.2 s a leg less with the hold behind first than with the
product's centred store, on these cells.

**Fixtures and limits.** `dbts_b1` only (50 × 2560×3328, 10 of 16 bits), one DBT volume of one dataset, run as the
exact HTJ2K series (2.11 MB a frame), not the AV1 view the model's ρ was derived for (found by the pilot); no
ultrasound; one 4-core cloud container without a GPU, software WebGL; headless Chromium 158.0.8127.36 (Playwright's);
the rig's userspace relay at 20 and 80 Mbit/s, 40 ms round trip, no loss, not a radio; the page view only, W = 15
(`memoryWindow`), the budget not set from the run ((e) not built). Limits found by this run: P1b cannot decide on 50
frames (found by `bounded.py` before the run, confirmed by the rows); P1c's "no byte after the first pass" does not
hold for any arm (found by the pilot, confirmed in every counted visit); the two control cells' nulls fail, so the
model's tie predictions do not carry to this driver (found by the rows); the host's container restarted twice during
the run (found by the lost background job), costing one round's re-run.

## Cache: results (CACHE-CELLS)

CACHE-CELLS, 2026-11-25 12:43–13:25 UTC, a session that wrote none of this file, ran by §5 and its Amendment. Rows on
`claude/cache-arms` under `lab/cache-arms/rows/chromium-1125/` (last `e4a032947`); the builds `5766cfc53`, `dbccc29d3`,
`8f2110c83`, the script `b82e1c2c4`. Chromium only: **every Firefox cell is unrun** (§5 Amendment), item 4's
pre-registered Firefox cell among them. **Provisional on the store question**: CACHE-DESIGN-1124 never ran.

**Mutants** (one round each, the run's arms): slot-held on L (delivered 0, backlog and exact fail, every arm),
view-copy on L (delay p99 fails, every arm), drop-writes on O (exact fails), tab-writes on T (the reading tab's writes
fail): **four of four caught**; no cell is VOID for a mutant.

| cell | measured (medians, 12 rounds unless said) | predicted | reading |
| --- | --- | --- | --- |
| L S1 1×, PSS growth | `none` 25.3 MiB; OPFS-SYNC 112.1, OPFS-SYNC′ 121.4, OPFS-ASYNC 129.4; OPFS-SYNC's growth 109.6 MiB in the renderer, ≤ 0.2 anywhere else (`none`'s renderer 22.6) | ~100 MiB over `none`, in one process | **held**: one process, the renderer |
| L S2 1×, PSS growth | `none` 25.5; OPFS-SYNC 115.8 (renderer 115.1), OPFS-SYNC′ 119.0, OPFS-ASYNC 92.7 (renderer 90.9, browser 6.3) | S1 and S2 within 20 MiB | **held**: 112.1 against 115.8, 3.7 MiB apart; it does not scale with the frame (×32 in bytes) |
| L, PSS A/A | median \|ΔPSS\| 9.8 MiB (S1), 9.7 (S2) | VOID over 32 | not VOID: the PSS bar judges |
| L, the bars (§8.3) | S1: OPFS-SYNC and OPFS-ASYNC fail PSS only (0 / 12 rounds each), every other bar 12 / 12, every frame exact; S2: OPFS-SYNC fails PSS (2 / 12), **OPFS-ASYNC passes every bar** (12 / 12) | — (§5 predicts the place, not the bar) | the growth is ~87–90 MiB over `none` at both sizes; the bar's slack is 64.5 MiB at S1 and 80.3 (SYNC) or 112.8 (ASYNC, 3 in flight) at S2, so a constant of this size fails S1 for both and passes ASYNC at S2 |
| T, Chromium, OPFS-SYNC | tab 1: 600 of 600 exact; tab 2: 336 exact, **13 not** (7 rounds of 12), every one `hit` false, `why` `NotReadableError`, no bytes hashed; **0 SHA-256 mismatches after a passing XXH3** | every non-exact index a failed re-read; none a SHA mismatch after XXH3 | **held**: no correctness defect; the three of CACHE-RUN are re-reads the arm refused |
| O S1, OPFS-ASYNC reopen | cold 135.8 ms, **0.53 ms a frame** (CACHE-RUN 1.46); warm 146.0, 0.57 (1.85); OPFS-SYNC 0.37 / 0.38; 6 rounds | under 1 ms (0.46, *derived*, Amendment) | cold **held** (+0.07 ms on 0.46); warm **VOID**: the A/A ratio is 0.892, outside 0.90–1.10 (cold's 0.977), read beside only |
| O S3, OPFS-ASYNC reopen | warm 1 132 ms, cold 887 (CACHE-RUN 749, 743); OPFS-SYNC 735 / 709 (648 / 653); A/A 0.931, 0.974 | unchanged, within ×0.90–1.10 of 749 | **refuted**: ×1.51 warm, ×1.19 cold. At *G* = 1 the read path is unchanged (one handle a frame opened and closed, as before), and OPFS-SYNC moved ×1.13 on the same cell, so part is the build or the host (158 against 153, another day); the rest is not explained by these rows |

**What it means.** (1) OPFS-SYNC's ~90 MiB is a constant in the renderer, the same at S1 and S2: by §10.4 (1)'s
reading "it is the rig's", not a per-origin cost of the engine; on this build there is no storage process, so the
other branch could not occur, and the renderer also holds the arm's worker and its sync handle, so these rows do not
separate the rig from the engine's handle (**open**). (2) T's three of CACHE-RUN are explained as a class:
`NotReadableError` on the reading tab's re-read while the writing tab still writes the series' one file. *Theory*,
not checked here: a `File` from `getFile()` is a snapshot, and the File API fails a read of a snapshot whose file has
since changed with `NotReadableError`; T's reader is then a miss, as §8.1 requires, never a wrong frame. (3) Item 4's
change does what §10.4 says on Chromium's cold reopen (×0.36 a frame); Firefox's cell, the one with the bar to cross,
is unrun.

**On which links the link, not the decode, binds:** none here; the cache cells are local (a re-read from disk, no
link), and the decode is stood in for by the feeders. **Where the host saturates:** no cell ran at 4×; S3 4× was the
saturated point last time and is not run; nothing is claimed past 1×. **How it serves the value statement:** "fewer
asks reaching the servers" and "the lowest server and network cost per reading session" rest on a store that keeps
the frame exact and within the tab's memory: on Chromium, OPFS-SYNC's re-reads are exact and its failures misses, and
its memory cost is a constant ~90 MiB, which the bar prices against S1's small frames.

**Fixtures and limits.** The rig's four synthetic 16-bit fields (`claude/cache-arms:lab/cache-arms/fields.js`) at S1 512², S2 2560 ×
3328, S3 3328 × 4096, no DBT or ultrasound pixels (no fixture enters a cell); one 4-vCPU, 16 GiB cloud container
without a GPU; headless Chromium 158.0.8127.36 (Playwright's `chrome-headless-shell`), not the run's 153 (found by the
settings rows); no Firefox (found by the refused fetch, §5 Amendment); O's 6 rounds against CACHE-RUN's 10, and its
S3 prediction read against a former run's medians, not an interleaved control (found by the S3 miss, where OPFS-SYNC
moved too); `pssByProcess` sampled every 500 ms, so a peak shorter than that is missed (found by the rig's code,
`cells.mjs` `pssGrowth`); IDB and Cache Storage not run (§5).

