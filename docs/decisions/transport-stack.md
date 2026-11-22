# Transport: WebTransport, or a fetch or WebSocket stack; and the server's network defaults

Written 2026-11-22 by row TRANSPORT-PAGE (`claude/work-ledger:docs/queue-2026-11-14.md`), a session that ran none of
the transport's rows, from pushed results only; nothing run. Inputs at: `claude/transport-design` `dd754894`
(`docs/transport/evidence/stacks.md` §1–§6.6), `claude/transport-arms` `4b2abcb6` (the rows,
`lab/transport-arms/rows/`), `origin/claude/unified` (`docs/transport/design.md`, `network-mode.md`,
`transport-conclusions.md`, `docs/lines/codecs.md` §Open 6 and 13), `claude/docs-client`
(`docs/client/evidence/congestion-controller.md`, `lossless-after-a-failed-ask.md`, `hidden-page-decode.md`,
`docs/client/design.md` §Open contradiction 3), PR 254's index (closed 2026-11-18, its body kept). § numbers below are
`stacks.md`'s unless another file is named.

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
fill), before any second wire is considered.**

| # | the owner's yes or no | recommended | a yes changes | a no leaves |
| ---: | --- | --- | --- | --- |
| 1 | No GET path in the product now; WebTransport stays the one wire | **yes** | nothing built; the fetch arms stay lab arms on `claude/transport-arms` (PR 403) | a GET path designed as a structural draft PR (`delivery-prior-art.md` §8 *What the server would need*) |
| 2 | Queue a cloud run: cell AD and CR, WT-TS with `--send-window-follows-cwnd` (the one queue) and with `per-frame` streams, against H3-fill and H3-frame as reference, pre-registered by a session that runs none of it | **yes** | one protocol row and one run row in the next queue; the rig and arms exist | the fill shape's 0.50–0.68 ask unexplained, and whether WT can match it unknown |
| 3 | The WebSocket stays built and off, a fallback only (decided 2026-10-02, kept 2026-11-11) | **yes** | nothing; its wins recorded (§3) | a WebSocket-first or a race design, against its ×1.35–1.70 ask after a 5 s silence |
| 4 | Host networking stays a proposal: `deploy/compose.yml` keeps publishing until `network-mode.md` §6's check runs from a client off the host | **yes** | the check queued for a session with two hosts (the cloud's one container cannot place a client off the host) | an override with `network_mode: host` written now, unmeasured in a forwarded mode |
| 5 | The initial window stays quinn's 12 000 B; 32 packets (38 400 B) stays opt-in (PR 37: close) | **yes** | PR 254's #37 answered no | 38 400 B the default, on −28 to −33 % at one RTT and a slowdown under BBR nobody explained |
| 6 | PR 254's other held defaults, as §3's last table reads them | **as that table** | each line's answer recorded | the index's open column stays open |
| 7 | `bbr` is **not** withdrawn by loads 6 and 13; it stays an option, never the default | **yes** | contradiction 3's second half closes | `bbr` withdrawn from what the next runs try (the 2026-11-11 Amendment's rule read literally) |

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

**The stack per link profile** (**derived** from the table; LINK-TARGETS' profiles, `link-profiles.md`):

| profile | what binds | the stack that serves it |
| --- | --- | --- |
| home Wi-Fi, public Wi-Fi, 5G sub-6, clean | the wire or the phone's decode; every stack ties on the fill | WebTransport: no stack gains; WT and H3 keep their window through a reader's pause (AA at 5 s) |
| enterprise Wi-Fi | reordering | not decided: ENT's model is uniform jitter, unbalanced, its fill ×18 the prediction (§6.3) |
| LTE, one far stream, 0.1 % loss | the controller's loss slope | WebTransport: every arm not conclusive on the fill (LTE) |
| LTE with a full queue (~0.8 s RTT) | the 6 MiB stream credit | H3-frame, by escaping the one stream's credit; WT's own `per-frame` flag is the untested equivalent (item 2) |
| 5G mmWave | the stream credit or the decode | not measurable here (above 90 Mbit) |
| any, an ask during a fill | what the ask waits behind | fill-shape fetch and WS ×0.47–0.74; WT's one-queue flag measured ×0.32–0.90 earlier on other rigs (`ask-during-a-fill.md`), never in this rig (item 2) |
| any, a UDP-hostile network | the dial | the WebSocket fallback, as decided |

**The server's held defaults** (PR 254's index, closed 2026-11-18; the line carries each result, no default changed):

| PR | held default | recommended | why |
| --- | --- | --- | --- |
| #37 | 38 400 B initial window | **no**; close | item 5 |
| #39 | asks first under a 6 MiB send window | **hold for item 2's run** | a trade-off: the ask ×0.18–0.31, the fill +2 to +44 % (row 211) |
| #40 | `cubic-classify` the controller | **no**; close | row 212: not the default in either reading; now compiled only under `lab-classify` |
| #41 | 100 ms initial RTT; the repeated-Initial reply removed | **hold** | the owner's 2026-10-14 reading (H over R) is recorded; a run at the target's real RTT decides (`design.md` §Open) |
| #96 | the one queue as product code, no flag | **hold for item 2's run** | its measurement (row 253) is not on the line; the flag form is what item 2 runs |
| #88, #102, #103, #122, #123, #137, #139 | disk and design rows, no default | **no default to set** | each index line's open question stays where it is recorded |

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

## 5 · The mechanism

* **The fill ties** because all four run Cubic with slow start restarted after a silence under the same 6 MiB stream
  credit: the controller sets the rate, not the framing.
* **An ask during a fill** waits behind whatever the server has already queued for the client. WT-TS's ask shares the
  connection with up to 6 MiB of fill in flight; the fill-shape fetch aborts the range, so the asked frame's GET meets
  an empty send queue (**theory**, not traced, §6.6). The one-queue flag is WT's way to the same empty queue, which is
  why item 2 runs it before any second wire.
* **An ask after a pause**: the kernel halves a TCP window once per RTO of idle, down to the initial window; quinn
  0.11.18 does not restart after idle. A 5 s reading pause therefore costs the TCP stacks ×1.35–1.70 and WT nothing.
* **CR**: one stream's 6 MiB credit over 0.8 s caps a single stream at ~63 Mbit/s; a stream a frame escapes it.
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
  the next structural draft, measured on a phone. One cloud run decides.
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
