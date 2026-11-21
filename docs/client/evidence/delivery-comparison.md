# The delivery comparison, in the cloud: a test of the fill model

*Pre-registered 2026-11-19 by DELIVERY-PROTOCOL, a session that will neither build nor run any of it. Nothing here is
measured: every prediction is **theory** or **derived** from the measured rows it names, with their fixtures. The run
follows this file as written; a departure the host forces is an amendment in §11, dated, before any counted row,
never after. Builds on [`../design.md`](../design.md) §Open *The delivery comparison*,
[`../../transport/link-profiles.md`](../../transport/link-profiles.md) and `claude/transport-design`
`b2f30e33:docs/transport/evidence/stacks.md` §5–§6 (the transport comparison's rig, forms and results).*

**The question.** Arm A the optimal-quality view only, B HTJ2K lossless only, C1 the view's fill then one exact frame
on request, C2 the view's fill then the whole exact series ([`../design.md`](../design.md) §Open, and §Decided
2026-11-14). Which arm a phone should get depends on its decode, which this host is not. **So the run tests the
model, not the arms' ranking**:

* fill ≈ max(bytes × 8 ÷ goodput, frames × decode a frame ÷ decoders) + rest;
* an exact frame on request is bound by the round trip: the ask, then slow start on an idle session, then one decode.

A cell where the model holds lets the page carry it to a device class with that class's own decode time and a
profile's own goodput and round trip; a cell where it misses is named, and nothing is carried through it (§8).

---

## 1 · Arms

Five arms, one viewer build, one server, the same stored series and digests. Every arm is the product's viewer
(`client/viewer/`) with the round's levers of `claude/phone-round` `033833f6:lab/devices/` (its README §The round's
levers), served only through the viewer's lab gate.

| arm | what loads | lever | its clock (§5) |
| --- | --- | --- | --- |
| **A** | the view (`<stem>-q8-g8[-cut].sbnd`) with its pair, no ask | — | fill |
| **A′** (A/A) | A again, the same URL | — | fill |
| **B** | the exact series alone, the viewer pointed at it, no pair | — | fill |
| **C1** | A, then 1 s after its fill ends, one exact frame | `press=lossless` | fill, then exact-frame latency |
| **C2** | A, then the whole exact series by a second downloader | `exactFill=1` | fill, then C2's span |

All arms: `cubic-restart` (the default build), the page view, **`decoders=2`** for every fill (the browser owns two
cores, §2; the downloader's default `min(3, navigator.hardwareConcurrency)` would put three decoders on two cores),
recorded with `cores`. C1's exact frame goes through the viewer's exact downloader as built: one decoder (OpenJPH),
its session dialed at load and idle until the ask (`client/viewer/viewer.js`, `connectExact`). C2's second fill uses
the load's two decoders. The exact frame C1 asks is the one on screen when its fill ends.

## 2 · Rig, order, engine

* **Rig** as `stacks.md` §5.2 and its amendments §5.7: one 4-core container; `lab/scripts/link_impair.py --tun` inside
  `unshare -rn`, its guard `lab/scripts/link_impair_check.sh` (both on `claude/transport-arms` `9fad9d9b`); the relay
  pinned to core 0, the series server to core 1, the browser to cores 2–3. A fresh browser profile a load, one load at
  a time, 10 s idle between loads. WebTransport by `serverCertificateHashes`.
* **Series**: the three timed volumes, each as `scripts/demo-series.sh` codes it: `dbts_a1` (56 frames, the view the
  depth cut), `dbts_b1` (50, its own 10 bits), `dbts_c1` (69, the depth cut); the view at Q 8 G 8, the exact series
  HTJ2K. Every frame of every fill checked by its XXH3 as the product checks it; one failure stops the run and is
  reported, never voided. A form with a prefix (§3) loads the first *N* frames of both series of every arm.
* **Order.** A Williams square over the five arms (`lab/order.mjs`; odd *n*, so a period is 10 rounds); within a
  round the arms run in their row's order for each volume, the volumes in the order a1, b1, c1 rotated by one each
  round. Each row carries round, volume, arm and predecessor; the summary prints the split by predecessor and
  `UNBALANCED`.
* **Engine.** Headless Chromium, the host's version, printed. Firefox and WebKit: not run.
* **Printed per run**: the server's flags; the relay's arguments and seed; the browser's version and switches; the
  coded files' sizes and XXH3; the commit of every branch the build merged.

## 3 · Forms (cells)

The forms of `stacks.md` §5.3 that a fill here can use, each a relay's scaled model of a profile in
[`../../transport/link-profiles.md`](../../transport/link-profiles.md) §4, none fitted to a radio. Delay one way,
each direction; queue in 1 500 B packets; nothing above 90 Mbit (the TUN's ceiling, `docs/rig-limits.md` §3).

| cell | relay form (scaled from) | prefix *N* | in the run as |
| --- | --- | --- | --- |
| **CLEAN** | 1 ms, 90 Mbit, 300 pkts (the measured home Wi-Fi; 600 → 90) | whole | `stacks.md`'s CLEAN |
| **PUB** | 10 ms, 90 Mbit, 2 000 pkts (public Wi-Fi; 101 → 90) | whole | its PUB |
| **CR** | 400 ms, 90 Mbit, 1 875 pkts (LTE's loaded RTT, ~0.8 s) | whole | its CR |
| **LTE** | 19 ms, 50 Mbit, 3 300 pkts, iid 0.1 %, a 40 ms blackout every 30 s | 16 | its LTE |
| **LOSS** | 20 ms, 20 Mbit, 200 pkts, Gilbert–Elliott 1 % | 8 | its LOSS |

**Left out, and why.** ENT: its uniform 10 ms reorder made every fill ~18× the prediction on every arm (`stacks.md`
§6.3, "the enterprise row is not decided here"), and at ~176 s a load its cell would not fit a 2 h job. The median
home Wi-Fi, 5G sub-6 and mmWave: scaled to 90 Mbit they differ from CLEAN and PUB by their round trip alone, which
the model's start term covers; their loss and capacity are what a scaled form cannot show.

## 4 · The model, its inputs, and the predictions

### 4.1 · The formula (theory)

For one fill of *n* frames, total entry bytes *B*, on a form with start *S* and goodput *G* (both from K3):

* **wire** *W*(*b*) = *S* + 8*b* ÷ *G*: from the dial to the last byte of *b* bytes;
* **decode floor** *D*: the makespan of the fill's decoder units handed in order to the first free of *k* = 2
  decoders, a unit taking (its frames) × *d*₁. A unit is a group of *g* frames for the view (*g* = 8, one decoder a
  group) and one frame for HTJ2K; *d*₁ is a frame's decode on one decoder while the other also decodes (K2);
* **fill** = max(*W*(*B*) + *d*₁, *W*(*b*₁) + *D*), *b*₁ the first unit's bytes. The first term is the wire-bound
  fill (the last frame decodes after its last byte), the second the decode-bound one (the decoders wait for the
  first unit, then never for the wire). The **rest** of `design.md`'s formula is what lies outside max(*W*, *D*).
* **Regime** of a load: *wire* when *W*(*B*) > *D* by more than 10 %, *decode* when *D* > *W*(*B*) by more than 10 %,
  else *near*.
* **Exact-frame latency** (C1; [`next-round.md`](../../phone-rows/next-round.md) §Names: "from the *Lossless* control pressed, to the exact frame painted
  with *✓ Lossless*") = RTT + *T*ₛₛ(*f*) + *h*₁ + 17 ms. RTT is the form's base round trip; *T*ₛₛ(*f*) sends the frame's
  *f* bytes from quinn's initial window of 12 000 B, doubling each round trip until the window reaches the
  bandwidth-delay product *G* × RTT, then at *G*; *h*₁ is one HTJ2K frame's decode on a lone decoder (K2); 17 ms is
  one paint at 60 Hz. The idle exact session has never grown its window, so the warmed window of `stacks.md` §6.2
  (cell AA) does not apply.
* **C2** is one load, its span from the second downloader's issue to its last frame checked, predicted by the fill
  formula on the exact series with the form's *S* (its session dials at the issue; if the build finds it dialed
  earlier, *S* less the form's 3 RTT, recorded as `exactFill.dial`). C2 is never A's and B's loads added.

### 4.2 · The inputs, measured on the run's own host before any row (calibration; not counted)

* **K1 · Bytes.** Each series' entry bytes as coded on the host, whole and at each prefix, and each frame's.
* **K2 · Decode.** The `bench=<frames>` lever on the unimpaired relay (CLEAN's form without a rate), each volume
  and codec, three loads each: at `decoders=2`, *d*₁ = the median per-frame time (`decodeEnd − decodeStart`, the
  check included) and `effectiveMs` beside it; at `decoders=1` on HTJ2K, *h*₁ = the median per-frame time.
* **K3 · Wire.** Per form, `claude/transport-arms:lab/transport-arms/run.mjs`'s WT-TS arm alone (today's downloader,
  no decode) on `dbts_b1` HTJ2K at two prefixes, *n*₁ = 8 and *n*₂ = the form's *N* (50; LTE 4 and 16; LOSS 4 and
  8), four visits each, interleaved; *S* and *G* are the line through the two medians of (bytes, dial → last frame's
  last byte). *G* there is a model input, not a result.
* **The predictions file**: `lab/delivery/predictions.json`, every (cell, volume, arm) with its predicted fill or
  latency, regime and band, computed by the build's predictor from K1–K3 alone, committed with its inputs' rows and
  pushed **before the first counted row**. Its XXH3 is in every counted row.

### 4.3 · The predictions as the inputs stand today (derived, for scale)

From the inputs already measured: bytes from `docs/av1/payload-format.md` §Bytes and
[`optimal-quality-bytes.md`](optimal-quality-bytes.md) (the cut views at 0.0686 and 0.089 of HTJ2K, `dbts_b1`'s at
0.2161); *d*₁ as one decoder's 1× time, the product's HTJ2K 19.8, 57.1, 20.1 ms and the view at 1.24, 1.74, 1.36 of it
([`decode-speed-of-the-optimal-quality-picture.md`](decode-speed-of-the-optimal-quality-picture.md)); *S* = 3 RTT +
20 ms and *G* from `stacks.md` §6.1's WT-TS fills (CLEAN 86.8, PUB 86.4, CR 26.4, LTE 11.5, LOSS 5.7 Mbit/s of entry
bytes). Seconds; C1 is the exact-frame latency. If K1–K3 differ from these inputs by more than 25 %, the run's
amendment says which and why.

| cell | volume | A | B | C1 | C2 span | A's regime | B's |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CLEAN | `dbts_a1` | 0.87 | 6.29 | 0.15 | 6.29 | decode | wire |
| CLEAN | `dbts_b1` | 2.95 | 9.98 | 0.28 | 9.98 | decode | wire |
| CLEAN | `dbts_c1` | 1.10 | 6.56 | 0.13 | 6.56 | decode | wire |
| PUB | `dbts_a1` | 0.93 | 6.38 | 0.24 | 6.38 | decode | wire |
| PUB | `dbts_b1` | 3.01 | 10.09 | 0.36 | 10.09 | decode | wire |
| PUB | `dbts_c1` | 1.16 | 6.65 | 0.22 | 6.65 | decode | wire |
| CR | `dbts_a1` | 3.86 | 23.0 | 5.8 | 23.0 | wire | wire |
| CR | `dbts_b1` | 9.56 | 35.1 | 6.7 | 35.1 | wire | wire |
| CR | `dbts_c1` | 4.36 | 23.9 | 5.7 | 23.9 | wire | wire |
| LTE (16) | `dbts_a1` | 1.08 | 13.6 | 0.97 | 13.6 | wire | wire |
| LTE (16) | `dbts_b1` | 5.39 | 24.1 | 1.66 | 24.1 | wire | wire |
| LTE (16) | `dbts_c1` | 1.17 | 11.5 | 0.84 | 11.5 | wire | wire |
| LOSS (8) | `dbts_a1` | 1.27 | 13.8 | 1.8 | 13.8 | wire | wire |
| LOSS (8) | `dbts_b1` | 6.18 | 24.5 | 3.2 | 24.5 | wire | wire |
| LOSS (8) | `dbts_c1` | 1.39 | 11.7 | 1.6 | 11.7 | wire | wire |

What this table already says (derived): on this host **B is wire-bound in every cell** (its crossover, 2.15 MB ÷
28.6 ms effective on `dbts_b1`, is ~600 Mbit/s, past the TUN's ceiling), and **A is decode-bound only at 90 Mbit with
a short round trip** (CLEAN, PUB). So the run tests the decode side of the model on the view alone, and the wire
side on both codecs. CR's C1 is ~8 round trips of slow start on the idle exact session.

## 5 · What each load records, and each clock

* **Fill**: the beacon's `fillFrom` (the dial) → `fillTo` (`claude/phone-round:lab/devices/beacon.js`), the second
  downloader's for C2's span.
* **Wire time**: the dial → the last frame's last byte at the downloader (the clock of K3 and `stacks.md` §5.3).
* **Decode floor**: Σ per-frame `decodeMs` ÷ the decoders, and the makespan of §4.1 recomputed from the load's own
  per-frame times beside it.
* **Exact-frame latency** (C1): the press → the exact frame painted with *✓ Lossless*; and its ask → last byte.
* Per frame: route, KB, `decodeMs`, `decodedAt`, last byte; bytes at the relay per flow; the cores' busy time per
  load (`/proc/stat`) and the server's CPU (`/proc/<pid>/stat`); the predictions file's XXH3.

Latency throughout: a fill and an exact frame are times, never restated as a rate.

## 6 · Rounds, `VOID`, saturation, stopping, pilot

* **Rounds**: one period, 10 rounds, a cell; at the predicted times ~36 min (CLEAN), ~37 (PUB), ~68 (CR), ~48 (LTE),
  ~49 (LOSS) with the gaps (derived). One cell a job, each under 2 h (this container stops background jobs at 2 h,
  TRANSPORT-RUN's finding); the 12 h stop of `stacks.md` §5.4, counted from the first counted row; cells not reached
  are reported not run.
* **Order of cells** (what they decide first): CLEAN, PUB (the decode side), LTE, LOSS, CR.
* **`VOID`** (a load), kept in the rows with its reason: the relay's guard p99 above 1 ms (`--self-timing`); core 0
  (the relay) or core 1 (the server) above 95 % busy over the load; a crash; a load past 3× its (cell, volume, arm)
  pilot median; the decoder count read back other than 2 (C1's exact downloader: 1). The browser's cores 2–3 are
  **not** a `VOID` reason: in a decode-bound load they are the decode bound being measured. A cell over 25 % `VOID`
  reports *strict* and *round-paired* (the owner's rule of 2026-10-09).
* **Where the host saturates**: the TUN at 100 Mbit (nothing claimed above 90); Chromium's receive path near
  100 MB/s (`docs/rig-limits.md` §1), above every form; the browser's two cores in every decode-bound load, which is
  this host's decode, never a phone's.
* **Pilot**: two rounds of every cell, not counted, after K1–K3. It may set only the visit timeout and confirm the
  prefixes; it checks the relay's tally against each form's loss and rate, and that every arm's lever took effect
  (C1 painted *✓ Lossless*, C2 filled every exact frame, two decoders). Its choices are an amendment in §11 before
  CLEAN's first counted row.

## 7 · The A/A pair

A′ against A per round and volume, by `lab/scripts/aa_rule.py --bar 0.05` (`claude/transport-arms`). If A′ is not
a **tie** in a cell, that cell's spread is the band's floor: a band narrower than the A/A pair's own range on that
cell is widened to it in the result, labelled so, and the reading reported both ways.

## 8 · The rule, stated before any data

* **Per (cell, volume, arm)**: the ratio measured ÷ predicted for each counted load. The model **holds** when the
  median ratio lies in the band and at least 8 of the 10 rounds do; otherwise it **misses**, reported with its
  median, range and side.
* **Bands** (an *assumption*, arbitrary until a run shows otherwise; amendment 24's wording): fills ×0.85–1.15 on
  CLEAN, PUB and CR; ×0.75–1.33 on LTE and LOSS, whose loss makes *G* a fill's own draw. Exact-frame latency
  ×0.75–1.33 on CLEAN, PUB and CR; ×0.6–1.67 on LTE and LOSS.
* **Regime**: a load's measured regime (its wire time against its decode floor, §4.1's 10 %) against the
  prediction's; a (cell, volume, arm) whose regime misses in more than 2 of 10 rounds is a **regime miss** whatever
  its ratio, because a device class is carried by which side binds. *Near* predictions are reported, not judged.
* **Predicted direction** (theory): decode-bound loads land above prediction, because the browser's receive path
  costs ~9.8 ms of CPU a MB on the decoders' cores (`docs/rig-limits.md` §1; ~11 % of a core at 90 Mbit, D), inside
  the band.
* **What the page may carry**: to a device class only through the (regime, codec, form) where the model held, with
  that class's *d*₁ and *h*₁ (DEVICE-THEORY's ranges, labelled derived) and a profile's *S*, *G* and RTT; every miss
  named. The arms' order per device class and profile is then derived, never measured here.
* **Nothing is adopted.** Which arm the product serves is the owner's.

## 9 · What the run cannot decide

* **Anything decode-bound on a phone**: the run's *d*₁ is a 4-core container's software decode, so it tests the
  formula, not a phone's place on it. The phone's HTJ2K decode per frame (the next round's cell 1) places B.
* **B decode-bound**: no form here reaches B's crossover (§4.3), so the decode side of the model is tested on the view
  alone.
* **A radio**: handovers past one 40 ms blackout, a radio's own loss and reordering, enterprise Wi-Fi (ENT, §3),
  capacity above 90 Mbit.
* **Quality**: the view at Q 8, not the noise rule's Q (0.10–0.28 of HTJ2K's bytes,
  [`optimal-quality-bytes.md`](optimal-quality-bytes.md)); the model takes bytes as an input, so the page may carry
  it to another Q's bytes, labelled derived.
* Firefox, WebKit, a GPU's paint, and what a reader sees or prefers.

## 10 · What must be built first, and its mutants

Owed by DELIVERY-BUILD and its review (neither this session's), lab only (`scripts/check_lab_absent.sh` green), on
`claude/delivery` over `claude/phone-run` (or `claude/phone-round`):

1. **The link** around the runner's loads: the relay of `claude/transport-arms`, its guard, its tally per flow, the
   LTE blackouts; the answer to whether this container runs `--tun`, in the Resume first.
2. **The plan of cells**: §2's order over §3's forms, the prefixes as a lever on both series, `decoders=2`, C1's
   1 s gap.
3. **K1–K3 and the predictor** (§4.2), writing `predictions.json`; **the judge**, §6–§8 from the rows and that file.

Each check fails once with its code broken: a frame flipped in one exact entry (the run stops); the relay at 0 %
where 1 % is asked (the pilot's tally refuses); the order forced to a fixed cycle (`UNBALANCED`); the `decoders` lever
ignored (`VOID` by the read-back); C1 painted without an exact frame (the load fails); C2 judged from A's and B's rows
added (the judge refuses: C2 reads only its own `exactFill` record); `predictions.json` changed after the first
counted row (the judge refuses: its XXH3 differs from the rows').

## 11 · Amendments

None yet.

---

## Fixtures and limits

Three DBT volumes of one dataset (`dbts_a1`, `dbts_b1`, `dbts_c1`; 56, 50, 69 frames), the view at Q 8 G 8 only, no
breast ultrasound cine; one 4-core cloud container without a GPU, software decode, headless Chromium; a userspace TUN
relay at ≤ 90 Mbit, its forms scaled and assumed, none a radio. §4.3's numbers are derived from rows measured on
other 4-core hosts (2026-11-09 to 11-19); the run's predictions come from its own host's K1–K3.
