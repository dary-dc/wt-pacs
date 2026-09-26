# Upstream draft: quinn withholds an owed ACK while its congestion window is full

**A draft, not filed.** The owner files it, or does not. It is written from
[`../proposal-session-open.md`](../proposal-session-open.md) §The probe after the open (PT1, cloud
queue row 63), whose numbers it quotes. Nothing here changes this server.

## In plain words

When one side of a QUIC connection receives a packet with data, it owes the sender an
acknowledgement (an ACK) and has to send it within `max_ack_delay` (25 ms by default). If the
sender hears nothing for long enough, it assumes the packet was lost and sends it again: that is
the *probe timeout* (PTO).

A congestion window limits how much *new data* a sender may have unacknowledged in flight. It is
not meant to hold back ACKs. An ACK carries no data, costs a few bytes, and is what lets the other
side open its own window. RFC 9002 §7 says so directly: packets that carry only ACK frames do not
count toward bytes in flight and are not congestion controlled.

quinn holds them back anyway, in one situation. The server has a full window *and* more stream data
waiting. On every open we measured, that happens right after the session starts: the server
sends the first frame, fills its initial window, and has more to send. The ACK it owes for the
client's request waits until the client's ACKs reopen the window, which takes a round trip. On an
80 ms path that is ~163 ms. Chrome's probe timer fires first, at ~146 ms, so Chrome sends the
request a second time for nothing.

**Why it matters, and why not much.** It costs one small packet (65 bytes here) per session open,
and on a long path maybe one per ask sent while a fill keeps the window full. It does not delay any
frame, because the server was window-blocked with or without the probe. Chrome's probe does not
shrink its window either. So it is a correctness defect in quinn (RFC 9000 §13.2.1's ACK deadline is
missed) with a small cost, not a performance lever for this server.

## The evidence (PT1)

* **Which packet.** Chrome's net log (`lab/scripts/netlog_pto.py`): the client sends the control
  stream's header, then the ask 2 ms later. The server's first data packet acknowledges the header
  but not the ask. The rest of the initial window leaves with no ACK.
* **Where in quinn.** quinn-proto 0.11.18, `Connection::poll_transmit`: when a space has
  ack-eliciting data queued and `in_flight + bytes_to_send > congestion.window()`, the loop marks the
  connection congestion-blocked and moves to the next space (`space_idx += 1; continue`). The owed
  ACK for that space is skipped along with the data, even after `max_ack_delay` has made it
  immediate.
* **Proved by moving the window.** With `--initial-window-bytes 1000000` the window cannot fill before
  the ask arrives. At 80 ms RTT: 7 of 8 sessions probe with the default window, 0 of 8 with the large
  one. At 40 ms: 0 of 8 each. The defect needs the window to reopen later than the probe fires, so a
  path above ~65 ms (derived, not measured).

## Upstream status (checked 2026-09-24)

* No open issue or PR on [quinn-rs/quinn](https://github.com/quinn-rs/quinn) names it. Searched: ACK,
  congestion, blocked, ack-only.
* **The closest is [#2785](https://github.com/quinn-rs/quinn/issues/2785)** (closed, fixed by #2787):
  `CONNECTION_CLOSE` was not sent while congestion-blocked, for the same reason. The same gate held
  back a packet that should not have been gated. Read #2787 before writing a fix. It is the
  maintainers' chosen shape for exempting one packet kind from the gate, and an ACK fix should
  follow it.
* [#2156](https://github.com/quinn-rs/quinn/issues/2156) (open) is a user question about "blocked by
  congestion control" traces. It is not this defect.
* `main`'s `poll_transmit` still `continue`s past a congestion-blocked space before any ACK-only
  packet is built. This was read through a summary of the file, not line by line: **re-read the
  code on the day you file.** *Corrected 2026-09-25 (QA1):* read line by line at `a577f35b`
  (2026-09-23) and reproduced there by the test below; #2787's `&& !close` is the gate's only change.

## Before filing: a reproduction in quinn's own terms

A maintainer should not need Chrome or this repository to see it. The strongest issue carries a
failing test in quinn-proto's test harness (`quinn-proto/src/tests/`, which drives two
`Connection`s over a simulated network with a configurable RTT):

1. Server with a small initial window, e.g. `TransportConfig::initial_window`. The client opens a
   stream and sends a few bytes. The server answers with more stream data than the window holds.
2. The client sends a second small write on the same or another stream while the server is still
   blocked.
3. Assert that the server sends an ACK covering the client's second packet within `max_ack_delay`
   of simulated time. Today it arrives only when the window reopens, about one RTT later. With a
   long enough RTT the client's PTO fires first.

The test is also the learning path: it pins the behaviour in quinn's terms (spaces, `SendableFrames`,
the congestion gate) before touching `poll_transmit`.

**Written and run 2026-09-25 (QA1)** — `ack_is_not_held_back_by_a_full_congestion_window`, in
[`../../patches/quinn-proto-0.11.18-ack-when-congestion-blocked.patch`](../../patches/quinn-proto-0.11.18-ack-when-congestion-blocked.patch)
with the fix below. 100 ms one way, a server whose Cubic window is two packets, a client PING;
the time from the PING to the client's first ACK frame, on a 1 ms simulated clock:

| | idle server (the control) | server blocked, 200 KB queued |
| --- | ---: | ---: |
| quinn-proto 0.11.18, as released | 225 ms | **325 ms** — fails |
| `main` `a577f35b`, as it stands | 225 ms | **325 ms** — fails |
| either, with the fix | 225 ms | 225 ms — passes |

225 ms is one latency out, `max_ack_delay`, one back. 325 is the ACK waiting for the window to reopen
a round trip after it filled, plus the delay. Two things the harness taught, for the issue text:

* **The window has to be small for the test to be deterministic on `main`.** With the default window,
  `main` paces the first flight — one packet per drive, the window not full 25 ms in — so it fills only
  just before its own ACKs return, and the gap the test needs closes. 0.11.18 sent the whole initial
  window at once, which is the case PT1 saw in Chrome. So on `main` the session-open probe may be
  rarer than PT1 measured; the defect is not, wherever a full window meets a due ACK. Seen in the
  harness only, not in a browser.
* `Pair::step()` stops once no connection has a timer earlier than its idle timer, even with a packet
  still on the simulated wire, so the test steps its own clock.

## Issue

**Title:** An owed ACK is not sent while the connection is congestion-blocked, so the peer's PTO fires spuriously

**What happens.** In `Connection::poll_transmit`, when a packet-number space has ack-eliciting data
queued and the congestion window is full, the space is skipped (`congestion_blocked = true;
continue`). Any ACK owed in that space is skipped with it, including one that `max_ack_delay` has
already made immediate. The ACK goes out only when the window reopens, which takes about one RTT.

**Why it is a bug.** RFC 9000 §13.2.1 requires ack-eliciting packets to be acknowledged within
`max_ack_delay`. RFC 9002 §7 exempts ACK-only packets from congestion control. On paths where the
window reopens later than the peer's PTO (RTT above ~65 ms with Chrome's defaults), the peer
retransmits data that was received, every time.

**Observed.** A WebTransport server on quinn-proto 0.11.18 with Chrome 141 at 80 ms RTT: the client's
request after the session opens is probed in 7 of 8 sessions. With a 1 MB initial window, so the
window never fills, 0 of 8. Net-log excerpt and method: *(link to this repository's
`proposal-session-open.md` §The probe after the open)*.

**Expected.** When a space is congestion-blocked but owes an ACK, send an ACK-only packet for it,
as #2787 did for `CONNECTION_CLOSE`.

**Reproduction.** *(the quinn-proto test above)*

## A fix, sketched

In the congestion gate, when the space owes an ACK (`can_send.acks`, or the pending-ACK state
`MaxAckDelay` has made immediate), build a packet with only the ACK frame instead of skipping the
space. The builder today assumes a congestion-blocked space writes nothing. The `debug_assert` that
rejects an ACK-only packet when other frames were sendable has to allow this case. A padding-free
ACK-only packet must not count toward `in_flight` (RFC 9002 §7), which quinn already does for
ACK-only packets elsewhere. Scope it to 1-RTT (Data) space first, since that is the only space
measured here.

**Built 2026-09-25, and smaller than this sketch** — the patch above, three hunks in
`Connection::poll_transmit`, the same on 0.11.18 and on `main`: when the gate finds the window full
and `can_send.acks` is set, it marks the packet ACK-only and not ack-eliciting (so neither congestion
controlled nor paced) instead of `continue`, and writes it with `try_populate_acks` — what the close
path already calls for its ACKs — instead of `populate_packet`. The loop's next pass finds the window
still full and nothing owed, and moves on as before. The `debug_assert` needs no change (`can_send.acks`
is true), and no space is special-cased: the gate only ever ran for ack-eliciting spaces. quinn-proto's
whole suite passes with it, 304 + 3 on 0.11.18 and 327 + 3 on `main`, the new test included.
**Off in this tree**: `scripts/patch_crate.sh` applies one patch per crate, and this is not it; it applies
cleanly beside `probe-every-space`, to try it with. Whether it removes PT1's probe in Chrome is not
measured.
