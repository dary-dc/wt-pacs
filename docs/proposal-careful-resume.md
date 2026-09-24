# Proposal: Careful Resume for the reconnects — and why not yet

**Status: proposed, not built, and not recommended now** (C1, row 51, 2026-09-24). A reconnect
starts its new session in slow start. Careful Resume would start it at a remembered window. The
cells below say the push at open, already prototyped, recovers the same round trips without
remembering anything. So this file specifies the design and the cells that would change the
verdict, and stops there.

## What it is

Careful Resume (IETF tsvwg, `draft-ietf-tsvwg-careful-resume`; S41 cites it as RFC 9959, a number
not verified here) saves a peer's congestion window and minimum round trip at the end of a
connection. The next connection over the same path then goes through four phases:

* **Reconnaissance.** Ordinary slow start until the first round-trip sample. If that sample is far
  from the saved one (below half of it, or ten times above it), the saved state is dropped.
* **Unvalidated.** The window jumps to half the saved one, and the jump is paced over a round trip.
* **Validating.** When the data sent in the jump is acknowledged without loss, the connection goes
  on from there.
* **Safe retreat.** On loss during the jump or its validation, the window falls to half of what was
  actually delivered and ordinary recovery takes over.

It is the per-client form of W1's 32-packet window: a larger first flight, justified by this peer's
own history instead of assumed for everyone.

## Why it looked worth asking

S2 (a network change kills the session), S3 (the screen lock outlasts a fill) and S30 (a blink at
a fill's start collapses the window) make reconnects routine, and survival
([`proposal-session-survival.md`](proposal-session-survival.md)) now re-dials for each of them.
W1 measured what a fresh session costs the first ask: 5.8 round trips at 250 KB against 1.3 on a
warmed one. S41 put Careful Resume at ~180 ms a reconnect if it recovered half of that.

## Reachability, settled

* **quinn does not tell the controller who the peer is.** `ControllerFactory::build(now, mtu)`
  takes neither an address nor a token. Per-peer state has to arrive with the connection's own
  config: `quinn::Incoming::accept_with(Arc<ServerConfig>)`, whose transport config carries a
  factory already given that peer's saved state.
* **wtransport 0.7.2 does not expose `accept_with`.** `IncomingSession` wraps `quinn::Incoming`
  privately and offers `remote_address`, `retry`, `refuse` and `ignore`. That was S22's verdict,
  and it stands for the crate as published.
* **This tree already patches the one function that calls `accept()`**,
  `IncomingSessionFuture::new` in `patches/wtransport-0.7.2-settings-early.patch` (lever 2). An
  `IncomingSession::accept_with` passing a config through is a few more lines in a patch already
  carried, with no fork. That is the route, if it is ever built.
* **The key arrives after the controller is built.** The session URL, which is where a token
  would ride, is read from the CONNECT half a round trip after the connection is accepted. The
  factory's controller would therefore hold a slot that the session code fills when the CONNECT is
  parsed, and it jumps then. That is also the moment the push at open starts sending, so nothing
  is lost by the wait.

## What is saved, and keyed on what

**Not the client's address.** Behind a carrier-grade NAT many subscribers share one address, and a
window saved for one of them would be jumped to on another's path. On S2's network change the
address changes anyway, which is correct but means address keying never fires where it looks most
wanted. Instead:

* At the end of a session the server issues a **token**: the window it ended with, the minimum
  round trip, the client's address prefix (/24 or /48) and the time. It is authenticated with the
  server's key so a client cannot mint itself a window, and sent on the control stream.
* The client carries it in the next session's URL (`?cr=`), as the opening ask rides it
  ([`proposal-session-open.md`](proposal-session-open.md) Lever 1).
* The server honours it only if the prefix matches, it is recent (seconds to minutes: S3's lock,
  S30's blink), and reconnaissance agrees on the round trip. A token presented from another network
  — S2 — falls back to slow start, which is what the draft asks for a changed path.

## How it composes with the push at open and the 32-packet window

Measured, not argued: `lab/scripts/first_ask_cells.sh resume`. It is a first ask of 250 KB at
80 ms through `link_impair.py`, 7 rounds with the arms rotated. "jump" approximates Careful Resume
as a fresh session whose initial window is half the one a filled session ended with. That arm has
no pacing of the jump beyond quinn's own, no validation, and no retreat, so on the shallow link it
shows the jump's unmitigated cost. Ask to last byte, median ms, and packets lost per session:

| arm | open link | lost | 10 Mbit, 20-packet queue | lost |
| --- | --: | --: | --: | --: |
| fresh | 461.6 | 0 | 587.4 | 4.0 |
| warmed (the ceiling) | 104.6 | 0 | 302.8 | 120.7 |
| jump to half the warmed window | 134.0 (7/7) | 0 | 419.7 (7/7) | 14.1 |
| push at open, 4 frames | 130.1 (7/7) | 0 | 313.7 (7/7) | 127.0 |
| push + jump | 112.7 (7/7) | 0 | 318.2 (7/7) | 129.0 |

(The warmed window ended at 1.16 MB on the open link and 102 KB on the shaped one. The shaped
link's warmed and pushed arms lose packets during their own fill, which the loss column counts.)

**The push gets what the jump gets, and needs no state.** On the open link the two are within 3 %.
Together they come to 112.7 ms, 13 % past the push alone, where the ceiling is 104.6. On the
shallow link the push reaches the ceiling by itself (313.7 against 302.8), and the jump adds nothing
to it (318.2). Alone there, the jump is 38 % slower than the push and triples the fresh session's
loss. W1b already showed the 32-packet window buys nothing once the push is taken, and the jump
behaves the same way.

**And the re-dial already can push.** With `openAsk` set, the downloader's `connect` puts the
fill's remainder in the new session's URL on every re-dial, not only the first dial. A resumed fill
is pushed behind the accept as the first one is.

## Verdict, and what would change it

Not built. On this product's reconnects the push at open recovers the slow start that Careful
Resume would, keyed on nothing, and it is already prototyped behind `--open-ask` / `openAsk`. What
it still waits on is the browser cell W1 named, not another transport change.

What would reopen this:

* **Reconnects that have nothing to push.** An on-demand viewer re-dialling with no fill and no
  ask owed. The deciding cell is `first_ask`'s fresh / warmed / resumed, with no push arm.
* **A bottleneck the push cannot fill in one burst**, where the remembered window is the only
  thing that knows the path. The same cell, on the target link rather than this relay.
* **A real Careful Resume arm in that cell**, replacing the approximation above: the patch's
  `accept_with`, a controller with the slot, the token on the control stream and in the URL. That
  is structural and would be proposed again with the cell in hand.

The rig: loopback through the userspace relay on one shared box (`rig-limits.md` §3); the approximation's
caveats above; nothing here is a radio.
