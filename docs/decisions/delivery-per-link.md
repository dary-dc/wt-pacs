# The view, the exact series, or both, per link

Written 2026-11-23 by row DELIVERY-PAGE (`claude/work-ledger:docs/queue-2026-11-14.md`), a session that ran none of
this question's rows, from pushed results only; nothing run. Inputs at: `claude/delivery` `b8cd8c71`
(`docs/client/evidence/delivery-comparison.md`: the protocol §1–§10, DELIVERY-RUN's §11 amendments A1–A5 and §Results,
DELIVERY-VERDICT-REVIEW's §Verdict review, no blocker, m1–m5; `lab/delivery/rows/judged/<CELL>.txt`, from which every
median below in seconds is the prediction × its median ratio); [`../transport/link-profiles.md`](../transport/link-profiles.md)
§2 and §4; [`phone-decode-route.md`](phone-decode-route.md) (ROUTE-POLICY's policies, PHONE-ROUTE-PAGE);
[`../client/evidence/optimal-quality-bytes.md`](../client/evidence/optimal-quality-bytes.md);
`claude/phone-run:docs/phone-rows/next-round-results.md` §Cell 2. **Missing:** PHONE-READ-CODE-CHECK is not done, so the
phone's cell 2 numbers below are loads it may set apart. Every row of this question is done; the recommendation rests
on no phone number alone, so it is **not provisional**.

Labels: **source**, **theory**, **derived**, **measured**; *the view* is the optimal-quality AV1 series, *the exact
series* its HTJ2K pair ([`../glossary.md`](../glossary.md)). Arms: **A** the view alone; **B** the exact series alone;
**C1** the view, then one exact frame on the reader's request (the product today); **C2** the view, then the whole
exact series by a second downloader.

## 1 · The question

On each kind of link a reader may have, and each class of phone, should the product send the view (A), the exact
series (B), or the view and then exact frames (C1 one on request, C2 all of them)? It is the owner's: every answer
trades the reader's seconds against bytes that the server and the reader pay for, and against what the picture on
screen is (a lossy view, unchecked once hardware decodes it, against the original, checked, bit for bit). No
measurement prices that trade.

## 2 · The recommendation, and the owner's yes or no

**Keep A with C1 (the view, the exact frame on request) on every link and every phone class; do not make B or C2 a
default; price B on fast clean links by the switch test the route page already queued; run the next delivery run
with C1's wire time recorded, a lossy-link model registered before it, and the relay off the decoding cores.**

| # | the owner's yes or no | recommended | a yes changes | a no leaves |
| ---: | --- | --- | --- | --- |
| 1 | A + C1 stays the delivery on every link profile and device class | **yes** | nothing in the product; §3's table becomes the record of where B would fill faster | the arm open on every link page |
| 2 | B (the exact series alone) as a default where *G* exceeds the class's *G*★ (fast clean links) | **no, for now**; the same answer as [`phone-decode-route.md`](phone-decode-route.md) item 4 | — | B's faster fill on those links (B ÷ A 0.51–0.77 on the round's phone, **measured**; on this host's software decode A was faster everywhere) not taken until that page's item 3 (the switch and the split, cloud) has run |
| 3 | C2 (the whole exact series after the view) as an arm the product offers | **no** | — | C2 stays a lab lever (`exactFill=1`): its exact series ends no sooner than B's alone (span ×0.995–1.002 of B's prediction on every clean form, **measured**, after A's fill) at 1.07–1.22× B's bytes (**derived**) |
| 4 | The next delivery run (phase 2, amendment 28 rule 2, no product code): C1's ask → last byte recorded (§5 of the protocol, not in the rows); LTE and LOSS predicted by a goodput that depends on the fill's bytes, registered from K3 before any row; the relay on a host or container of its own, the guard kept; DELIVERY-FIT-ARM interleaved as the HTJ2K-only control | **yes** | PHASE2-PLAN queues protocol amendment, build, review, run | lossy links keep no model, C1's short-trip excess no cause, 52 of 750 loads voided by the rig |

**How it serves the value statement** (amendment 27 item 7). "The lowest server and network cost per reading
session" is item 1: A sends 0.07–0.22 of B's bytes at Q 8 (**measured**, three volumes). "A fast first picture, a fast
full fill" is where A loses on fast clean links (item 2) and wins on every wire-bound one (§3); item 4 measures the
links where that turns. "Every frame the reader asks to see exactly is the original, bit for bit, and checked" is C1:
an exact frame in 0.19–0.46 s on short round trips and 6.2–7.1 s at 800 ms (**measured**, this host).

## 3 · The options

**The arms on this host** (*measured*, medians, one counted period a cell, 3 DBT volumes; LTE's fills are 16 frames,
LOSS's 8; in seconds unless marked):

| form (scaled from) | A fill | B fill | B ÷ A | C1, the exact frame | C2 span | the model held for |
| --- | --- | --- | --- | --- | --- | --- |
| CLEAN, 1 ms, 90 Mbit (home Wi-Fi) | 1.63–6.04 | 6.28–9.97 | 1.65–3.85 | 186–339 ms | 6.30–9.99 | A (decode-bound), B, C2 span; not C1 |
| PUB, 10 ms, 90 Mbit (public Wi-Fi) | 1.72–5.85 | 6.39–10.08 | 1.72–3.72 | 281–456 ms | 6.41–10.10 | A, B, C2 span; C1 on `dbts_c1` only |
| CR, 400 ms, 90 Mbit (LTE's loaded RTT) | 9.02–13.97 | 24.73–35.07 | 2.51–2.74 | 6.22–7.14 s | 24.76–35.07 | every arm and clock |
| LTE, 19 ms, 50 Mbit, 0.1 %, blackouts | 0.78–2.69 | 7.91–23.40 | 8.7–14.1 | 459–689 ms | 10.29–22.72 | B on `dbts_b1` only |
| LOSS, 20 ms, 20 Mbit, GE 1 % | 0.78–4.36 | 11.31–24.36 | 5.6–18.4 | 680–1 168 ms | 10.27–24.31 | nothing (C2 span `dbts_b1` under the latency band only, m1) |

On this host A is the faster fill everywhere, but CLEAN's and PUB's A is this host's two-core software decode, never a
phone's (protocol §9); only the wire-bound order (CR, LTE, LOSS) is the link's.

**The arm that fills faster, per device class and link** (*derived*: DELIVERY-VERDICT-REVIEW's *G*★, the goodput
above which B fills first, from DEVICE-THEORY's view decode ranges; carried only through the regimes that held, i.e.
clean links; every *G*★ above 90 Mbit/s is extrapolated past the run's ceiling, *theory*). Profiles' goodput from
[`link-profiles.md`](../transport/link-profiles.md) §2 (*source*/*derived*).

| class (*G*★ `dbts_b1`; `dbts_a1`/`c1`) | home Wi-Fi measured, ≥ 600 | home Wi-Fi median, ~218 (p10 40) | public Wi-Fi, ~101 | LTE 27–85; far stream | 5G sub-6, mmWave | enterprise Wi-Fi |
| --- | --- | --- | --- | --- | --- | --- |
| entry (77–170; 140–327) | B | B on `dbts_b1`; either on a1/c1; A at p10 | either on `dbts_b1`; A | A, wire-bound (not by the model) | not carried (loss) | unknown |
| middle (117–375; 213–716) | B on `dbts_b1`; either | either; A at p10 | A | A | not carried | unknown |
| premium (320–466; 584–890) | B on `dbts_b1`; either (the round's phone: B on both, **measured**) | A | A | A | not carried | unknown |

"Either" means the link's goodput lies inside the class's *G*★ range. On LTE and the far stream the order is by bytes
and the cloud's measured fills (B ÷ A 2.5–18.4), not by the model, which missed there.

**What each arm costs beside its fill:**

| arm | bytes a session (against B) | storage on the server | what the reader sees | checked |
| --- | --- | --- | --- | --- |
| A | 0.0686, 0.2161, 0.089 at Q 8 (**measured**); 0.10–0.28 at the noise rule's Q (**derived**); 4.6–14.6× fewer than B (**derived**: 1 ÷ the three volumes' Q 8 ratios) | both forms: 1.07–1.22× B's at Q 8, 1.10–1.28× at the rule's Q (**derived**) | a lossy view, labelled lossy AV1 and its ratio ([`visually-lossless.md`](visually-lossless.md)) | in software; **unchecked when hardware decodes it** (the owner, 2026-11-23 ~02:00) |
| B | 1 | B's alone | the original | every frame, bit for bit |
| C1 | A's + 1.02–2.15 MB a pressed frame | both forms | the view, the original on request | the exact frame, bit for bit |
| C2 | A's + B's: 1.07–1.22× B's | both forms | the view, then the original everywhere | every exact frame |

The owner's ~02:00 word makes the unchecked hardware view a recorded disadvantage of A, C1 and C2 against B (and
against DELIVERY-FIT-ARM, the HTJ2K-only control of phase 2), named here beside speed and bytes.

## 4 · Where it holds

**Fixtures and limits.** Three DBT volumes of one dataset (`dbts_a1`, `dbts_b1`, `dbts_c1`; 56, 50, 69 frames), the
view at Q 8 G 8 only; one 4-core cloud container (Intel Xeon @ 2.10 GHz) without a GPU, software decode, Chromium 153
headless; a userspace TUN relay at ≤ 90 Mbit/s, its forms scaled from the profiles and assumed, none a radio; one
period of 10 rounds a cell, 750 counted loads, 61 `VOID`. The phone beside it: one premium phone, one home link, one
evening (cell 2). No breast ultrasound cine in the run (`usb_cine` is in `docs/FIXTURES.md`, lossy-sourced, not one of
the arms' series), no Firefox or WebKit, no radio, nothing above 90 Mbit/s.

**Where the host saturates**: the browser's two cores in every decode-bound load (CLEAN, PUB): that is the decode
being measured, not a phone's. The TUN at 100 Mbit/s; nothing is claimed above 90.

**The population** (devices by DEVICE-THEORY's price bands of 2025 shipments, entry 40.6 %, middle 38.3 %, premium
21.1 %; links by `link-profiles.md`). The model carried, and its tested predictions, misses included
(`delivery-comparison.md` §Results, §Verdict review):

* **Held**: the decode-bound view on CLEAN and PUB (21 hold, 3 cannot hold, none miss); every wire-bound fill and C2
  span on CLEAN, PUB and CR (×0.964–1.012); C1's exact frame at 800 ms (×1.08–1.11).
* **Missed**: C1's exact frame at 2–20 ms round trips (×1.25–1.38; of six, 4 miss, 1 holds, 1 cannot hold); every
  lossy-form fill shorter than K3's second prefix (×0.32–0.70, below, as amendment A2 foresaw); B and C2's span on LTE
  and LOSS but two (×0.62–0.92); amendment A2's CR note (small fills below their band: they held); the predicted
  direction of decode-bound loads (above prediction: held on `dbts_b1`, not on `dbts_a1`, mixed on `dbts_c1`, m4).
* **On the phone** (cell 2, *measured*, pending PHONE-READ-CODE-CHECK): B was the faster fill on `dbts_b1` and
  `dbts_a1` at ≥ 568–595 Mbit/s (B ÷ A 0.513, 0.771), the direction §3's premium row gives; the phone's A was slower
  than DEVICE-THEORY's premium range, so its *G*★ (~242 Mbit/s on `dbts_b1`) sits below that row.

**Where the link, not the decode, binds** (amendment 28 item 3.7): B on every link below its class's *G*★, so on
public Wi-Fi, LTE, a far stream and the median home's p10 for every class; A on LTE, a far stream, LOSS-like links and
public Wi-Fi below ~83 Mbit/s (`link-profiles.md` §2's crossover for `dbts_b1` on the round's phone); C1's exact frame
on every link (round trips and slow start on an idle session). The decode binds A on clean links above that crossover.
Transport rows are lowered by none of this.

**US and DBT stacks** (amendment 27 item 6). DBT stacks: measured on three volumes, carried to the 19 by bytes and to
the classes by the model. Breast ultrasound clips: the model's form carries (*theory*: fill ≈ max(wire, decode) +
rest does not depend on the modality), its numbers do not: a clip's 8-bit, often colour, lossy-sourced frames change
the view's ratio to the exact series and its decode time, so no *G*★ is known for US (no US clip in the run; `usb_cine` exists, lossy-sourced; US-DBT-CARRY,
phase 2).

**Every limitation, with what found it:**

* Lossy links have no model: one goodput per form does not predict a fill (DELIVERY-RUN's K3 line gave negative
  starts, amendment A2; §Results: the first megabytes go at ~3× the late ones).
* C1's short-round-trip excess (+43 to +117 ms) grows with the frame's bytes and the round trip, not fixed
  (DELIVERY-VERDICT-REVIEW m2); its wire and decode parts cannot be split because §5's ask → last byte is not recorded.
* C2's span was judged with the latency band; under the fill band LOSS `dbts_b1` misses (DELIVERY-VERDICT-REVIEW m1).
  This page uses the fill band.
* The relay's guard voided 52 loads, 51 on decoding view arms, with the relay already pinned to its own core: a pinned
  core alone did not keep it (DELIVERY-RUN A1; DELIVERY-VERDICT-REVIEW m5; RESULTS-BRIEF §1.12); the voided fills were
  not faster (median ×0.980 against ×1.000).
* The view's per-frame decode at two decoders was ~2.1× the lone-decoder figure, cause not established (DELIVERY-RUN A3).
* A container restart cut CLEAN's first pass at 89 loads, kept in no bar (DELIVERY-RUN A5).
* Every *G*★ but the entry band's low end lies above 90 Mbit/s, the TUN's ceiling (`docs/rig-limits.md` §3): extrapolated.
* The view's decode ranges per class were tested on one phone, and missed at one and four decoders
  ([`phone-decode-route.md`](phone-decode-route.md) §4).

## 5 · The mechanism

A fill ends when the later of two clocks ends: the wire (bytes ÷ goodput, after a start of a few round trips) and the
decode (frames × a frame's decode ÷ decoders). The view has 4.6–14.6× fewer bytes (three volumes) and a slower decode a frame; the exact
series the reverse. So on a slow or far link the wire binds both and the view, with its fewer bytes, wins; on a fast
clean link the wire stops binding and the exact series, whose frames decode faster, wins once the link's goodput
passes *G*★ = (the exact series' bytes less the view's first group) ÷ the view's decode floor. A phone's slower decode
lowers *G*★: an entry phone gets there at 77–170 Mbit/s on `dbts_b1`, a premium phone at 320–466. An exact frame on
request starts on a session idle since its dial, so it pays slow start from 12 000 B again: round trips dominate it.
C2 adds the exact series after the view, so its exact frames end later than B's and cost both series' bytes.

## 6 · What would change the recommendation

* **The switch test** ([`phone-decode-route.md`](phone-decode-route.md) item 3) showing that a fill that measures its
  own first group switches to B without a slower fill on wire-bound links: then B on fast clean links stops costing
  seconds anywhere and item 2 is asked again with its byte price.
* **A lossy-link model that holds** (item 4): then *G*★ reaches LTE and 5G, where today no arm is carried by the model.
* **DELIVERY-FIT-ARM** (HTJ2K only, each frame first at the resolution level that fits the screen): if it fills as fast
  as A on wire-bound links with B's exactness, it replaces A + C1 with an arm that is never unchecked.
* **One middle-band phone's cell 1 and 2** (a real-device cloud, [`phone-decode-route.md`](phone-decode-route.md) item
  8): it places the middle row of §3 on a measurement instead of a range ×3.6–5.2 wide.

## 7 · What it would reopen

Nothing among the decided approaches: A + C1 is the product as decided (the exact HTJ2K frame on an explicit Lossless
request, bit for bit). Item 2's yes would not reopen one either, but it is structural (a second form on the default
path). The owner's ~02:00 word already reopened "every frame checked" for the view; this page records its cost and
reopens nothing further.

## 8 · Rows and links

DELIVERY-PROTOCOL, DELIVERY-BUILD, DELIVERY-BUILD-REVIEW, DELIVERY-BUILD-FIX, DELIVERY-BUILD-FIX-REVIEW, DELIVERY-RUN,
DELIVERY-VERDICT-REVIEW (status files on `claude/work-ledger:docs/queue/`); PR 406 (`claude/delivery`):
`docs/client/evidence/delivery-comparison.md`, `docs/reviews/delivery.md`, `lab/delivery/rows/` and
`rows/judged/recount.py`; [`../transport/link-profiles.md`](../transport/link-profiles.md);
[`../client/evidence/optimal-quality-bytes.md`](../client/evidence/optimal-quality-bytes.md);
[`phone-decode-route.md`](phone-decode-route.md) (ROUTE-POLICY, PR 397); [`visually-lossless.md`](visually-lossless.md);
[`../reviews/results-2026-11-22.md`](../reviews/results-2026-11-22.md) §1.12; `claude/phone-run:docs/phone-rows/next-round-results.md` §Cell 2.
