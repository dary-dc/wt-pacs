# Transport: WebTransport, or a fetch or WebSocket stack; and the server's network defaults

Written 2026-11-22 by row TRANSPORT-PAGE (`claude/work-ledger:docs/queue-2026-11-14.md`), a session that ran none of
the transport's rows, from pushed results only; nothing run. Inputs at: `claude/transport-design` `dd754894`
(`docs/transport/evidence/stacks.md` §1–§6.6), `claude/transport-arms` `4b2abcb6` (the rows,
`lab/transport-arms/rows/`), `origin/claude/unified` (`docs/transport/design.md`, `network-mode.md`,
`transport-conclusions.md`, `docs/lines/codecs.md` §Open 6 and 13), `claude/docs-client`
(`docs/client/evidence/congestion-controller.md`, `lossless-after-a-failed-ask.md`, `hidden-page-decode.md`,
`docs/client/design.md` §Open contradiction 3), PR 254's index (closed 2026-11-18, its body kept); and, read
2026-11-26 by PAGES-AFTER-RUNS, `claude/page-runs` `b38906f58` (`docs/reviews/page-runs.md` §1, §Transport: results,
§Verdict review). § numbers below are `stacks.md`'s unless another file is named.

## 1 · The question

The browser receives every frame over one WebTransport session to our own QUIC server. Three questions are the
owner's because each changes what the product ships, not a setting a run can pick:

* **The stack.** Would a second wire (HTTP/3 or HTTP/2 `fetch` with a GET path on the server, or the WebSocket that
  is already built and off) serve some link better? A GET path is structural (§5.5).
* **The server's network defaults** still held for a yes or no: host networking, the 32-packet initial window, and
  the held defaults of PR 254's index.
* **Is `bbr` withdrawn** by the 2026-11-11 phone run's two failures under it (contradiction 3)?

## 2 · The recommendation, and the owner's yes or no

**Keep WebTransport as the one wire and build no GET path now. Queue one cloud run that asks whether WebTransport
itself, with flags it already has, gets the two wins the fetch arms showed (an ask during a fill; CR's credit-bound
fill), before any second wire is considered.** The run is done and verdicted: below the table, *Read against the
run*.

| # | the owner's yes or no | recommended | a yes changes | a no leaves |
| ---: | --- | --- | --- | --- |
| 1 | No GET path in the product now; WebTransport stays the one wire | **yes** (kept 2026-11-26, PAGES-AFTER-RUNS: asks first met the fetch arms' ask within WebTransport; below) | nothing built; the fetch arms stay lab arms on `claude/transport-arms` (PR 403) | a GET path designed as a structural draft PR (`delivery-prior-art.md` §8 *What the server would need*) |
| 2 | Queue a cloud run: cell AD and CR, WT-TS with `--send-window-follows-cwnd` (the one queue) and with `per-frame` streams, against H3-fill and H3-frame as reference, pre-registered by a session that runs none of it | **yes** (done: TRANSPORT-FLAGS-RUN 2026-11-24, with asks first added as WT-AF; verdicted 2026-11-26) | one protocol row and one run row in the next queue; the rig and arms exist | the fill shape's 0.50–0.68 ask unexplained, and whether WT can match it unknown |
| 3 | The WebSocket stays built and off, a fallback only (decided 2026-10-02, kept 2026-11-11) | **yes** | nothing; its wins recorded (§3) | a WebSocket-first or a race design, against its ×1.35–1.70 ask after a 5 s silence |
| 4 | Host networking stays a proposal: `deploy/compose.yml` keeps publishing until `network-mode.md` §6's check runs from a client off the host | **yes** | the check queued for a session with two hosts (the cloud's one container cannot place a client off the host) | an override with `network_mode: host` written now, unmeasured in a forwarded mode |
| 5 | The initial window stays quinn's 12 000 B; 32 packets (38 400 B) stays opt-in (PR 37: close) | **yes** | PR 254's #37 answered no | 38 400 B the default, on −28 to −33 % at one RTT and a slowdown under BBR nobody explained |
| 6 | PR 254's other held defaults, as the [appendix's table](#appendix-the-servers-held-defaults) reads them | **as that table** | each line's answer recorded | the index's open column stays open |
| 7 | `bbr` is **not** withdrawn by loads 6 and 13; it stays an option, never the default | **yes** | contradiction 3's second half closes | `bbr` withdrawn from what the next runs try (the 2026-11-11 Amendment's rule read literally) |

**Read against the run** (2026-11-26, PAGES-AFTER-RUNS, from `page-runs.md` §Verdict review §1, whose counts hold,
recomputed; **measured**, `dbts_b1` as HTJ2K, 14 rounds a cell, ratio to WT-TS in the same round). The one queue's
window (TW) ties on AD-PUB (×0.993) and misses its AD-LTE gain (×1.037 against ×0.70–0.88); `per-frame` streams (PF)
are worse on AD (×1.55, ×1.70) and answer CR (×0.571); **asks first under a 6 MiB send window (WT-AF, #39) is
×0.780 and ×0.535 on AD and ×0.676 on CR**, 14 of 14 rounds better on AD-PUB and CR, 13 of 13 on AD-LTE. AD-PUB's
×0.780 is 0.02 under the rule's ×0.8, its range reaching ×0.802: met by the median, as registered. By `page-runs.md`
§1's own rules both readings stand together (README §Pass re-review r-m1): rule (1), TW and PF above ×0.8, keeps "a
GET path for asks alone is the next structural draft" for those two flags; rule (3), WT-AF at ≤ ×0.8, keeps "no GET
path" open, on a `lab-levers` build, not a flag the default build has. So item 1 stays **yes** and the GET path
draft waits on the #39 build's own measurement; item 2 is done; the appendix's #39 becomes a **yes** (a product build
row, the verdict's recommendation); #96 stays held (its lever is not in the rig). CR's reason is the ratios, not the
credit's cap: the one-stream fill ran at 24.5 Mbit/s, 39 % of the cap (§5, *corrected*).

**How it serves the value statement** (amendment 27 item 7): "low latency on every jump" during a fill and "a fast
full fill" over a long round trip come together from one WebTransport flag (#39), on the one wire item 1 keeps.

## 3 · The options

**The four stacks**, ratio to WT-TS in the same round, median (`aa_rule --bar 0.05` against the A/A arm); < 1 is faster.
All **measured** (§6.1 as corrected by §6.5, AD from §6.6), on §4's fixtures; profiles are relay models, **assumed**
and scaled to ≤ 90 Mbit.

| cell (what it stands for) | WT-TS | WS | H2-frame | H2-fill | H3-frame | H3-fill |
| --- | --- | --- | --- | --- | --- | --- |
| CLEAN, PUB: a fill, clean wire-bound link | 9.92 s, 10.03 s | tie | tie | tie | tie | tie |
| CR: a fill at ~0.8 s RTT (LTE's full queue) | 35.0 s | 1.088 slower | 1.091 slower | 1.052 slower | **0.630** | 1.001 |
| LOSS: a fill, GE loss 1 % | 24.4 s | 0.962 | 0.951 | n.c. | n.c. | n.c. |
| HOL: frame inter-arrival p99 under LOSS | 4.74 s | 0.871 | n.c. | n.c. | 1.598 slower | n.c. |
| ENT: uniform 10 ms reorder (unbalanced, cut) | 176 s | 0.842 | 0.858 | 0.847 | 0.987 | 0.970 |
| FF: first frame cold, 2–56 ms RTT | 214–626 ms | tie to 1.013 | 1.002–1.016 | 1.001–1.014 | 1.001–1.012 | tie |
| AD: an ask during a fill, PUB / LTE | 743 ms / 5 287 ms | **0.738 / 0.468** | 1.974 / 1.932 | **0.682 / 0.501** | 1.809 / 1.678 | **0.548 / 0.525** |
| AA: an ask after 0.1 s / 1 s of silence | 229–252 ms | 0.97–1.01 | 0.975–1.000 | 0.974–0.992 | 1.007–1.019 | 1.006–1.009 |
| AA: an ask after 5 s of silence | 229–251 ms | **1.391 / 1.635** | 1.366 / 1.687 | 1.350 / 1.699 | 1.020 / 1.021 | tie |
| CPU: server CPU a GB | 573 ticks | **0.145** | 0.162 | 0.145 | 1.112 | 1.075 |
| CPU-C: client CPU a GB | 82 s | 0.695 | 0.770 | 0.723 | 1.665 | 1.628 |
| BYTES on the wire | 1.037 × | 1.000–1.002 | same | same | same | same |
| built in the product? | yes (default) | yes, off | no: a GET path | no | no | no |

n.c.: not conclusive (the A/A arm itself is not conclusive in that cell, §6.5). FP (a pooled connection) not run.

**The stack per link profile** is in §4, under *Where the link, not the decode, binds* (moved there 2026-11-25,
PAGES-PASS, unchanged).

**The server's held defaults** (PR 254's index; items 5 and 6): the table is in
[*Appendix: the server's held defaults*](#appendix-the-servers-held-defaults), after §8 (moved 2026-11-25, PAGES-PASS,
unchanged).

## 4 · Where it holds

**Fixtures and limits.** One series, `dbts_b1` as HTJ2K (50 frames, 2.15 MB a frame); one 4-core container (Xeon @ 2.30
GHz); headless Chromium 157.0.8103.78; the userspace TUN relay at ≤ 90 Mbit, every profile **assumed** and scaled,
none a radio; the kernel default `bbr`, the TCP arms' sockets set to `cubic` and read back every visit; the busiest
core's median 0.08–0.52 a cell, no visit `VOID` for CPU, so the host did not saturate below 90 Mbit and nothing is
claimed above it. FP not run (the 12 h stop); ENT cut inside a period and unbalanced; AD's re-run (§6.6) has had no
review of its own. No Firefox, no Safari, no phone, no Android `tcp_rmem`, no handover.

**Population.** The four stacks were read from their specifications and Chromium's `net/` at three tags (§1, §5.7);
the TCP window's restart from Linux `tcp_cwnd_restart()` at `v6.12` and `v6.18` (§6.2, **source**). So AA's line (a
TCP arm loses its window after a few RTOs of silence; QUIC here keeps it) carries to any Linux server and Chromium
client on any link (**derived**); the fill ties carry to any link where the wire binds under the same controller
family. What does not carry: ENT's reorder model, CR's credit numbers to other engines' receive windows, and every
absolute time to a radio. Tested predictions (§6.1, §6.6), misses included: the fill ties held; the cold-dial penalty
of TCP (×1.03–1.15) **missed** and is retracted; the ask after a fill held the record's line at 5 s and missed it at
1 s; the fill shapes' ask (×1.0–2.0) **missed** below the band; server CPU over TCP ×0.145 against ×0.5–0.9 **missed**.
WT-TS's own times against §5.3's predictions (§6.1, §6.6; **measured** against **derived**; added 2026-11-25,
PAGES-PASS): CLEAN 9.92 s, PUB 10.03 s, AD on PUB (743 ms against ~0.8 s) and LTE (24.0 s against 20–30 s) held,
FF and AA not judged against an absolute; CR 35.0 s against ~20 s, AD on LTE 5 287 ms (5 664 the first run) against ~1.4 s, LOSS 24.4 s against ~46 s,
HOL's p99 4.74 s against 1.4 s and ENT 176 s against ~9.6 s (×18) **missed**. §5's ~63 Mbit/s cap is the arithmetic behind
CR's ~20 s, and it is not what binds WT-TS (§5, corrected 2026-11-26); AD's mechanism is read from the ratios.

**Where the link, not the decode, binds** (2026-11-25, PAGES-PASS). This page's question is the link's: a stack, a
window or a controller moves a fill or an ask only where the wire, not the phone's decode, sets it. On this rig the
metric (§5.3's) ends at a frame's last byte, so no decode enters it (§6, **measured**): every number in §3 is the link's and
the stack's. Per profile, for A (the view's fill), B (the exact series') and C1 (the exact frame on request), each
**derived** in [`link-profiles.md`](../transport/link-profiles.md) §2 *Per profile and arm* on the round's phone unless
marked:

* **Home Wi-Fi, measured (≥ 600 Mbit/s):** the decode binds A (2.25 s against a wire of 0.31 s); B is near the line
  (wire 1.43 s, its phone decode unmeasured); C1 is "~0.04 s after a silence, + one HTJ2K decode", the decode
  its unknown. The stacks tie on CLEAN's fill (**measured**).
* **Home Wi-Fi, median (~218, p10 40):** the decode binds A at the median, the wire at p10 (4.6 s); the wire binds B
  (3.9 s) and C1.
* **Public Wi-Fi (~101):** A at the line (wire 1.84 s against decode 2.25 s); below ~83 Mbit/s, `link-profiles.md`
  §2's crossover for `dbts_b1` on the round's phone, the wire binds it ([`delivery-per-link.md`](delivery-per-link.md)
  §4); the wire binds B (8.5 s) and C1. The stacks tie on PUB's fill (**measured**).
* **Enterprise Wi-Fi (unknown):** A on an unknown side of 83; the wire binds B unless above ~470 (on an unmeasured
  decode); ENT's model decides nothing here (the table below).
* **LTE, one far stream (27–85, lower quartile 7–26):** the wire binds A (2.2–6.9 s), B (10–32 s) and C1 (~0.5 s,
  1–2.8 s behind a fill); every arm is not conclusive on LTE's fill (**measured**).
* **LTE with a full queue (~0.8 s RTT, cell CR):** the link binds (WT-TS 35.0 s, **measured**); no decode enters.
  Not the stream credit's ~63 Mbit/s cap: WT-TS's fill ran at 24.5 Mbit/s, 39 % of it, and what holds it there is
  not read; PF's ×0.571 and AF's ×0.676 are measured gains whose mechanism is not shown (corrected 2026-11-26, PAGES-AFTER-RUNS, `page-runs.md`
  §Verdict review m3; it read "the link and the one stream's credit bind ... the ~63 Mbit/s cap").
* **LOSS-like links (GE 1 %):** the wire binds A and B ([`delivery-per-link.md`](delivery-per-link.md) §4); the
  controller's loss slope sets it, not the framing (§5).
* **5G sub-6 (> 100, a target):** the decode binds A; the wire binds B (1.1–3.0 s at a PHY of 284–771); goodput,
  loss and loaded RTT not read.
* **5G mmWave (~1 467):** the decode binds A (wire 0.13 s), and B if the cloud's ratio holds (1.3–1.8 s against a
  wire of 0.59 s); Cubic's loss bound (~20 Mbit/s at 0.01 % and 56 ms) may make it the wire after all; above 90 Mbit,
  so not measurable here.
* **An ask, on any link:** the link binds it: what it waits behind during a fill (AD) and the window left after a
  silence (AA), **measured**; C1's exact frame is round trips and slow start on an idle session on every link
  ([`delivery-per-link.md`](delivery-per-link.md) §4), plus one HTJ2K decode: its wire and decode parts "cannot be split" (the same §4),
  so "link-bound" is **derived** for its wire part only.

The premise under it is untested ([`README.md`](README.md) §Premises item 1): on the one phone measured, the exact
series filled faster than the view in 15 of 15 rounds, median 0.705 (**measured**,
[`phone-decode-route.md`](phone-decode-route.md) §4), so on that fast clean link the phone's decode bound the view (**derived** from B ÷ A: "no wire time was recorded,
so no fill's regime was read", `route-policy.md` §PHONE-READ on `claude/mobile-decode`).
No transport row is lowered by it: where the decode binds A every stack already ties on the fill (CLEAN, PUB), and
item 2's run (TRANSPORT-FLAGS-RUN, done 2026-11-24, unverdicted) asked about the ask, which the link binds on every
profile.

**For the owner and PAGES-AFTER-RUNS** (2026-11-25, PAGES-PASS-FIX; README §Pass review B3). Item 2's run is done;
its rows are unverdicted until PAGE-RUNS-VERDICT (`claude/page-runs:docs/reviews/page-runs.md` §Transport: results).
Read by its own §1 rules it bears on three lines here, none changed by this fix: §6's first bullet ("WT-TW and WT-PF
are both above ×0.8 on AD … the page's next step stands, 'a GET path for asks alone is the next structural draft'"),
which reopens item 1; "#39: net on these cells" (WT-AF ×0.780, ×0.535 on AD, a CR fill of ×0.676), against the
appendix's "hold for item 2's run"; and "CR is answered within WebTransport" by `per-frame` (×0.571). #96 "is not
answered". PAGES-AFTER-RUNS carries the verdict into items 1 and 2, #39 and §6. *Carried 2026-11-26* (§2, *Read
against the run*): rule (1) of the same paragraph reopens item 1 for TW and PF, and its rule (3) keeps "no GET path"
open on WT-AF's build; both are said there.

**The stack per link profile** (**derived** from §3's table; LINK-TARGETS' profiles, `link-profiles.md`):

| profile | what binds | the stack that serves it |
| --- | --- | --- |
| home Wi-Fi, public Wi-Fi, 5G sub-6, clean | the wire or the phone's decode; every stack ties on the fill | WebTransport: no stack gains; WT and H3 keep their window through a reader's pause (AA at 5 s) |
| enterprise Wi-Fi | reordering | not decided: ENT's model is uniform jitter, unbalanced, its fill ×18 the prediction (§6.3) |
| LTE, one far stream, 0.1 % loss | the controller's loss slope | WebTransport: every arm not conclusive on the fill (LTE) |
| LTE with a full queue (~0.8 s RTT) | the one stream, below its credit's cap (24.5 Mbit/s against ~63; what holds it not read) (corrected 2026-11-26, PAGES-AFTER-RUNS, m3; it read "the 6 MiB stream credit") | within WebTransport: `per-frame` ×0.571 of WT-TS, asks first ×0.676; H3-frame ×0.620 (verdicted 2026-11-26) |
| 5G mmWave | the stream credit or the decode | not measurable here (above 90 Mbit) |
| any, an ask during a fill | what the ask waits behind | WT asks first (#39) ×0.535–0.780, as fast as the fill-shape fetch and WS (×0.47–0.74), verdicted 2026-11-26; WT's one-queue flag ×0.32–0.90 on other rigs (`ask-during-a-fill.md`), ×0.99–1.04 on this rig's AD |
| any, a UDP-hostile network | the dial | the WebSocket fallback, as decided |

**Each limitation, and what found it** (2026-11-25, PAGES-PASS):

* One series, `dbts_b1` as HTJ2K; one 4-core container; headless Chromium 157. Found by TRANSPORT-RUN (§6 *Fixtures
  and limits*).
* Every profile a relay's model, **assumed** and scaled to ≤ 90 Mbit, none a radio; nothing claimed above 90. Found by
  TRANSPORT-PROTOCOL (§5.0) and TRANSPORT-RUN (§6).
* The host did not saturate below 90 Mbit (busiest core's median 0.08–0.52 a cell, no visit `VOID` for CPU). Found by
  TRANSPORT-RUN's CPU sampler (§6.1).
* The kernel's default controller is `bbr`; the TCP arms' sockets set to `cubic`, read back every visit. Found by
  TRANSPORT-BUILD-FIX (its §5.7 amendment), read back in TRANSPORT-RUN (§6).
* FP not run. Found by TRANSPORT-RUN: the 12 h stop (§6.1).
* ENT cut inside a period and unbalanced, its model uniform jitter, its fill ×18 the prediction. Found by
  TRANSPORT-VERDICT-REVIEW (§6.5 item 2) and TRANSPORT-RUN (§6.1, §6.3).
* The A/A arm not conclusive in `ad-lte`'s first run, LOSS, HOL, LTE and CPU (§3's n.c.). Found by
  TRANSPORT-VERDICT-REVIEW (§6.5).
* AD's fill-shape arms in the first run measured the fill, not the ask (a build defect, struck). Found by
  TRANSPORT-VERDICT-REVIEW (§6.5); re-run by TRANSPORT-AD-RERUN (§6.6).
* AD's re-run has had no review of its own. Found by this page (TRANSPORT-PAGE), from the rows of §8.
* Why the fill shape's ask is faster is **theory**, not traced. Found by TRANSPORT-AD-RERUN (§6.6).
* WT's flags on this rig (TW ×0.993, ×1.037, ×1.000 of WT-TS on AD-PUB, AD-LTE and CR; PF, AF) are one volume
  (`dbts_b1`), one 4-core container, Chromium 158; QW and #96's lever not run; cwnd not recorded, so TW's AD-LTE miss
  is not attributed. Verdicted 2026-11-26 (PAGE-RUNS-VERDICT, `page-runs.md` §Verdict review: the counts hold); the
  CR fill runs under the credit's stated cap for a reason not read (its m3). Found by
  TRANSPORT-FLAGS-RUN (`page-runs.md` §Transport: results); the earlier "never measured on this rig" corrected
  2026-11-25 by PAGES-PASS-FIX (README §Pass review B3).
* No Firefox, no Safari, no phone, no Android `tcp_rmem`, no handover; Chromium's `net/` read, not traced. Found by
  TRANSPORT-THEORY (`stacks.md` *Fixtures and limits*, "Not read").
* ENT's reorder model, CR's credit numbers to other engines and every absolute time to a radio do not carry. Found by
  this page's reading of §5.0 (TRANSPORT-PAGE).
* The tested predictions' misses, and WT-TS's absolute misses, above. Found by TRANSPORT-RUN (§6.1, §6.2),
  TRANSPORT-AD-RERUN (§6.6); the absolute misses' omission from this page by DECISION-PAGES-REVIEW (§Review, nits).
* Rootless publish's tap-ring drops are unmeasured in a forwarded mode, and the cloud's one container cannot place a
  client off the host. Found by `network-mode.md` §1–§2 and §6 (**sourced**, **derived**).
* The 32-packet window's slowdown under BBR is unexplained. Source not found: PR 254's index (#37: rows 181 IWDEEP
  and 191 IWOPTIN) states nothing about BBR (PAGES-PASS-REVIEW m4); item 5 carries the claim unsourced.
* Load 13's page is hidden only by the run's notes. Found by `hidden-page-decode.md`.
* #41's 100 ms initial RTT and #96's one queue have no run at the target's real RTT or on the line. Found by
  `design.md` §Open (#41) and row 253 (#96), as the appendix's table says.

## 5 · The mechanism

* **The fill ties** because all four run Cubic with slow start restarted after a silence under the same 6 MiB stream
  credit: the controller sets the rate, not the framing.
* **An ask during a fill** waits behind whatever the server has already queued for the client. WT-TS's ask shares the
  connection with up to 6 MiB of fill in flight; the fill-shape fetch aborts the range, so the asked frame's GET meets
  an empty send queue (**theory**, not traced, §6.6). The one-queue flag is WT's way to the same empty queue, which is
  why item 2 runs it before any second wire.
* **An ask after a pause**: the kernel halves a TCP window once per RTO of idle, down to the initial window; quinn
  0.11.18 does not restart after idle. A 5 s reading pause therefore costs the TCP stacks ×1.35–1.70 and WT nothing.
* **CR**: one stream's 6 MiB credit over 0.8 s caps a single stream at ~63 Mbit/s (**derived**: 6 × 2²⁰ × 8 bit ÷
  0.8 s = 62.9 Mbit/s, §5.3's CR line, whose ~20 s for WT-TS missed at 35.0 s, §4); a stream a frame escapes it.
  *Corrected 2026-11-26* (PAGES-AFTER-RUNS, `page-runs.md` §Verdict review m3): the cap is not what binds. WT-TS moved
  107 407 602 B in 35.02 s, 24.5 Mbit/s (**derived**), 39 % of the cap (51 % with the queue's 0.25 s on the round
  trip), so something not read holds the one stream under its credit; PF's ×0.571 and AF's ×0.676 are measured gains
  whose mechanism is not shown.
* **CPU**: the kernel segments and encrypts TCP with offloads; quinn spends ~2 µs a datagram in userspace.

**The defaults.** Rootless publish forwards each datagram through pasta and a 726 kB tap ring whose drops the
controller reads as congestion (`network-mode.md` §1–§2, **sourced** and **derived**, unmeasured in a forwarded mode).
The 32-packet window helps only a fresh session's first ask (−28 to −33 %, measured, `transport-conclusions.md` §3)
and does not stack with the opening ask, which is the default. **`bbr`'s two failures**: load 6 was 30 s in which no
packet from the phone reached either server (`lossless-after-a-failed-ask.md`, measured), and load 13 an 18 s decode
call on a page the run's notes call hidden (`hidden-page-decode.md`). A server's controller paces what the server
sends; it cannot stop the phone's packets reaching the server or stall the phone's decoder, so neither failure is the
controller's (**derived**). The Wi-Fi pairs (9 of 10 faster under `cubic-restart`, congestive loss only) already keep
`bbr` from being the default; its gain lives under random loss (fill ×0.11–0.12 at 1 % iid, measured).

## 6 · What would change the recommendation

* **Item 2's run shows WT with its flags still above ×0.8 of the fill shape's ask**: then a GET path for asks alone is
  the next structural draft, measured on a phone. One cloud run decides. *Run 2026-11-24, verdicted 2026-11-26:* TW
  and PF above ×0.8 on AD, so the draft stands for those flags (rule (1)); WT-AF at ×0.780 and ×0.535, so "no GET
  path" stays open on its build (rule (3)). What decides it now: the #39 product build's own measurement, the
  appendix's #39.
* **A real radio's loss and reordering** (an enterprise Wi-Fi or LTE trace) where the TCP stacks' ENT and LOSS wins
  hold: the WebSocket earns more than a fallback. A device session decides.
* **`network-mode.md` §6's check** shows a tap drop in a counted load: host networking becomes the recommendation. A
  client off the host decides.
* **A `bbr` failure reproduced with the server's controller as its only difference**: then withdraw it.

## 7 · What it would reopen

Nothing among §Decided approaches: `cubic-restart` stays the default, the WebSocket stays off, the initial window
stays quinn's. Item 7 reads the 2026-11-11 Amendment's rule ("a `bbr` load failing where `cubic-restart` does not") as a
failure caused by the controller; the owner may read it otherwise. Contradiction 3's first half (the 10-minute rule
against the six octets) was closed by amendment 11: the six-octet reading is of record.

## 8 · Rows and links

* Rows (client queue): TRANSPORT-INVENTORY, TRANSPORT-THEORY, TRANSPORT-PROTOCOL, TRANSPORT-BUILD, -REVIEW, -FIX,
  -FIX-REVIEW, TRANSPORT-RUN, TRANSPORT-VERDICT-REVIEW, -FIX, -FIX-REVIEW, TRANSPORT-AD-RERUN; this page's,
  TRANSPORT-PAGE. Status files: `claude/work-ledger:docs/queue/<ROW>.md`.
* PRs: 391 (`claude/transport-design`), 403 (`claude/transport-arms`), 254 (the server line's index, closed).
* Files: `claude/transport-design:docs/transport/evidence/stacks.md`; `claude/transport-arms:lab/transport-arms/rows/`,
  `docs/reviews/transport-arms.md`; [`../transport/design.md`](../transport/design.md),
  [`../transport/network-mode.md`](../transport/network-mode.md),
  [`../transport/transport-conclusions.md`](../transport/transport-conclusions.md) §3,
  [`../transport/delivery-prior-art.md`](../transport/delivery-prior-art.md) §8;
  `claude/docs-client:docs/client/evidence/congestion-controller.md`, `lossless-after-a-failed-ask.md`,
  `hidden-page-decode.md`, `ask-during-a-fill.md`.

## Appendix: the server's held defaults

Moved here from §3 on 2026-11-25 (PAGES-PASS, §Review m13), unchanged.

**The server's held defaults** (PR 254's index, closed 2026-11-18; the line carries each result, no default changed):

| PR | held default | recommended | why |
| --- | --- | --- | --- |
| #37 | 38 400 B initial window | **no**; close | item 5 |
| #39 | asks first under a 6 MiB send window | **yes: a product build row** (corrected 2026-11-26, PAGES-AFTER-RUNS; it read "hold for item 2's run") | row 211's trade-off (the ask ×0.18–0.31, the fill +2 to +44 % on 0.57 MB frames) does not carry to `dbts_b1`'s 2.15 MB frames: on item 2's run the ask is ×0.780, ×0.535 and the CR fill ×0.676, 32 % faster, verdicted (§2, *Read against the run*); AD-PUB's margin is 0.02 |
| #40 | `cubic-classify` the controller | **no**; close | row 212: not the default in either reading; now compiled only under `lab-classify` |
| #41 | 100 ms initial RTT; the repeated-Initial reply removed | **hold** | the owner's 2026-10-14 reading (H over R) is recorded; a run at the target's real RTT decides (`design.md` §Open) |
| #96 | the one queue as product code, no flag | **hold** (corrected 2026-11-26, PAGES-AFTER-RUNS; it read "hold for item 2's run") | its measurement (row 253) is not on the line; item 2's run, verdicted: "#96 unanswered", its lever not in the rig; the one queue's window flag (TW) tied or missed (§2, *Read against the run*) |
| #88, #102, #103, #122, #123, #137, #139 | disk and design rows, no default | **no default to set** | each index line's open question stays where it is recorded |
