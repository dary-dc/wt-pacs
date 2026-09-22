# A session that dies is noticed and resumed

**2026-09-19 as a proposal; built and measured in the lab's client 2026-09-22.** §What is built,
and where. The product's half — the viewer re-asking through the same path, and the page's notice
— is not built, and neither is the screen-lock pair in §A fill outlasts the screen lock. A1, from
[S2 and S3](improvements/2026-09-18.md). What the stack choice assumed and what is left of it is
§What this means for the stack choice.

## The problem, stated as a freeze

**Chromium does not move a WebTransport session to a new network.** Its dedicated WebTransport
client keeps one socket, made once at connect, watches no network change, and carries none of the
migration code Chromium's pooled HTTP/3 path has — read from the public source on 2026-09-22, file
by file, in §What this means for the stack choice. So Wi-Fi → cellular ends the session whatever
the server does, and nothing in the API reports it.

**What that evidence is, exactly.** Absence in the files that would have to implement it, read once
on one date — which says no code path exists for the browser to move the session, and is not a
device result. **No phone has been tried here**, and on WebKit the same question is not answerable
from source at all ([`improvements/2026-09-19-sweep.md`](improvements/2026-09-19-sweep.md) S25).

The client discovers the path is dead only when an idle timeout fires — the smaller of the two
peers' — and until then it sits holding a session that cannot carry a byte.

**The length of that freeze has not been measured on a browser; both sides of it have.** L15
(2026-09-16, container) read what Chromium advertises: `max_idle_timeout 30000`, and a self-ping
every 15 s that keeps an *idle* session alive for 180 s with server keep-alive off
([`transport/adr-idle-sessions.md`](transport/adr-idle-sessions.md) §What a real Chromium does).
The 30-second freeze itself was measured on a **native** client, not a browser, and after a **NAT
rebind**, not a radio change: T6 step 1, where `lab/scripts/link_impair.py` moved its own upstream
source port mid-session, the client saw no reset at all, and the session ended at `connection timed
out` **30 001 ms** later — quinn's default — in 3/3 repeats
([`lanes/T6-session-survival.md`](lanes/T6-session-survival.md)). A browser's freeze is that
mechanism with Chromium's 30 s in place of quinn's: arithmetic, not a reading.

That makes [`transport/adr-idle-sessions.md`](transport/adr-idle-sessions.md)'s recommendation read
differently than when it was written. The pair there is **20 s keep-alive, 60 s server idle
timeout**, chosen against the 30 s Chromium advertises (L15 confirmed it does, exactly). Those are
still the right numbers for *holding a session open*. But the timeout is also **the detection
bound**, and the effective one is the lower of the two ends — the ADR's own §Picking the pair — so
a 60 s server timeout leaves detection where the browser puts it, at **30 s**. **Corrected in place
2026-09-22:** this paragraph used to say the recommendation *doubles the 30 s freeze L15 measured*.
It does neither — it cannot push detection past the client's own bound, and L15 measured an
advertised timeout, not a freeze. Only a server idle timeout **below 30 s** moves detection, which
is the number A1 asks for at 10 s (§The measurement this owes).

**The timeout is a detection bound, and it is the wrong instrument.** It exists to reclaim a dead
session, not to tell a viewer its data stopped. Detection should come from the platform, and the
timeout should stay where it is.

**What is not evidence here.** The blink and blackout lanes
([`improvements/2026-09-20.md`](improvements/2026-09-20.md)) interrupt the **same** path: the
4-tuple never changes, the session survives the outage by construction, and what they measure is
what slow start does afterwards. They say nothing either way about a network change.

## What this means for the stack choice

**The assumption this transport was partly chosen on.** A QUIC session is named by a connection ID,
not by its 4-tuple, so connection migration was expected to carry a viewer across a Wi-Fi ↔ cellular
handover that would break a TCP socket. [`transport/why-these-changes.md`](transport/why-these-changes.md)
§8 states it in that form: "connection migration is the QUIC feature 4-tuple hashing defeats".
**That property is not available to a browser page today.** The two halves below are verified
differently, and neither is a device.

**Client half — Chromium's public source, read 2026-09-22 at `refs/heads/main`** (each row
`https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/quic/<file>`):

| file | what it shows |
| --- | --- |
| `dedicated_web_transport_http3_client.h` | `class DedicatedWebTransportHttp3Client : public WebTransportClient, public quic::WebTransportVisitor, public QuicChromiumPacketReader::Visitor, public QuicChromiumPacketWriter::Delegate` — **no `NetworkChangeNotifier` observer among the bases**, and the session it owns is a plain `std::unique_ptr<quic::QuicSpdyClientSession>`, not `QuicChromiumClientSession` |
| `dedicated_web_transport_http3_client.cc` | the socket is created once in `DoConnect()` (`CreateDatagramClientSocket(DatagramSocket::DEFAULT_BIND, target_network_, ...)`, then `ConnectAsync`) and **never re-created or re-bound**; `OnWriteError` forwards to `connection_->OnWriteError`, `OnReadError` closes the connection; the file contains no `Migrate*`, no `OnNetworkMadeDefault`, no network-change observer or timer |
| `quic_chromium_client_session.h` | where the migration that does exist lives: `MigrateNetworkImmediately`, `MigrateSessionOnWriteError`, `MigrateWithoutProbing`, `OnNetworkConnected`, `OnNetworkDisconnectedV2`, `OnNetworkMadeDefault`, with `MigrationResult` and `ConnectionMigrationMode` |
| `quic_session_pool.h` | `class QuicSessionPool : public NetworkChangeNotifier::IPAddressObserver, public NetworkChangeNotifier::NetworkObserver, ...` — the observer that drives those calls, over the pool's HTTP/3 sessions. **WebTransport is not mentioned in the file** |
| `quic_context.h` | and even there it is conditional: `migrate_sessions_on_network_change_v2` defaults to `base::FeatureList::IsEnabled(features::kMigrateSessionsOnNetworkChangeV2)`, `migrate_sessions_early_v2` and `migrate_idle_sessions` to `false`, `allow_port_migration` to `true` |

The page's WebTransport session is built by the first two rows and is on none of the machinery of
the last three. **What the file's own history would add is missing:** the gitiles `+log` page for
that file answered HTTP 403, so nothing here is pinned to a commit — only to `refs/heads/main` on
the date above. RFC 9000 §10.1 could not be fetched whole either (both renderings truncate before
§10), so the lower-of-the-two idle timeout rule above is cited from the ADR that already measured
it, not from the RFC.

**Server half — ours, and measured.** Per-core endpoints hash a session onto one socket, so a moved
session lands on a worker that does not know it and its packets are dropped in silence: **12 of 16
rebinds killed the session at `--workers 4` against 0 of 6 at `--workers 1`**, the `(W−1)/W` kill
rate the hash predicts, with **no stateless reset reaching the client**
([`lanes/T6-session-survival.md`](lanes/T6-session-survival.md), 2026-09-18, this container, a
native probe). This half is ours to fix — one endpoint, connection-ID steering, or the multi-thread
runtime without §8 — each costed in that lane.

**Not tried, by anyone here.** A device: no phone, no SIM, no radio handover, and no browser reading
of the freeze. Nor a genuinely different client **address**: the probe changes a port on one
loopback address, and a port-only rebind on a single endpoint costs nothing at all
([`transport/NEXT.md`](transport/NEXT.md) row 6). The device row is
[`cloud-queue.md`](cloud-queue.md) row 59.

**The consequence, for the stack choice.**

* **An application-layer reconnect is required regardless of the server shape.** Fixing the server
  half restores nothing on a handover: the browser's socket stays bound to the dead path and there
  is no code in its WebTransport client to move the session. The triggers, probe and re-issue this
  document proposes are the mechanism, not a workaround for a server bug.
* **QUIC migration is not usable from a browser page today.** It is real in the protocol and real in
  Chromium's pooled HTTP/3 path; it is not on the path a page reaches, and the API exposes no knob
  for it. Third-party write-ups saying a phone moving from Wi-Fi to cellular keeps its WebTransport
  session — the common claim a search returns on 2026-09-22 — describe the protocol, not the
  browser's WebTransport client, and none of them cites the code.
* **A reconnect is a cold session** — 2 RTT plus certificate verification, no 0-RTT for CONNECT and
  no pooling onto a warm connection in Chromium or Safari (`transport/NEXT.md` row 6) — so the
  round-trip cuts in [`proposal-session-open.md`](proposal-session-open.md) are worth more than
  their own cells say: they are paid again on every handover.
* **Nothing here re-opens the rest of the choice.** Streams, loss behaviour and the fill's numbers
  are measured elsewhere and are not what this finding touches. One assumed property is gone.

**What would change it.** Browser support: Chromium wiring its dedicated client to the
network-change machinery, which would show as those symbols appearing in
`dedicated_web_transport_http3_client.cc` — re-read the file before re-deciding. **No public
tracking issue was found for it** (searched 2026-09-22): `w3c/webtransport` returns five closed
issues for "migration", none on the subject, and the nearest Chromium one,
<https://issues.chromium.org/issues/40849481> "WebTransport should reconnect after …", is indexed
with its title truncated and its tracker page requires sign-in — it could not be read, so nothing is
claimed about what it says. The other two changes are ours: the server half above, and a device that
puts a reading where the source inference is.

## What the platform already offers

Free signals, none of which this client listens to today:

| Signal | What it means here |
| --- | --- |
| `navigator.connection` `change` | the radio moved — the most direct notice of the Wi-Fi → cellular case |
| `online` / `offline` | connectivity went away or came back; coarse, and it lies on captive portals |
| `visibilitychange` | the viewer came back to the tab; a good moment to check rather than assume |
| `pageshow` | restored from the back/forward cache, where the session is already gone |
| `freeze` / `resume` | the page was frozen and thawed — see §A fill outlasts the screen lock |

**None of them proves the path works**, which is why they are triggers and not verdicts. Each one
starts a check, not a re-dial.

**A sixth, added when this was built: a fill that has gone quiet.** `stallMs` with frames owed
and none arriving is the only trigger a path change raises on one host — no platform signal fires
when the bytes simply stop — and the only one that is about this session's data rather than the
platform's guess about the network. It is what §The measurement below actually exercises.

## The check: a probe ask with a deadline

The cheapest honest test of a session is to use it. On any trigger above, the downloader asks for
**one frame it already holds** — a frame already delivered, so the answer is discardable and the
decode path is not disturbed — with a deadline well under the idle timeout.

* It arrives → the path is alive; nothing else happens.
* The deadline passes → the session is dead regardless of what the API says; re-dial.

The frame index is chosen from the downloader's own records, so the probe costs one small frame and
no bookkeeping of its own. A study with nothing delivered yet has nothing in flight to lose, so the
probe is skipped and the first real ask is the probe.

Two more skips, both from building it. A check already running does not start another. And a
session that delivered a frame **within the last `stallMs`** has just proved itself, so a tab
switch during a healthy fill costs nothing — which matters, because an ask ends a running fill on
the server (`transport/ask-during-fill.md`) and a probe that interrupts a live fill costs the
round trip to re-issue the remainder. While the fill is *stalled*, which is when the probe
actually fires, that cost is zero. The same reasoning settles what to do when the probe's deadline
passes but a frame arrived while it was out: the frame wins, because it is the better evidence.

## Re-dial and re-issue, on records that already exist

This is the part that needs no new state. `proposal-downloader.md` §The downloader already keeps
**one record per frame** — not asked, on the wire, waiting for a decoder, decoding, delivered — and
already re-issues the undelivered remainder of a fill after an ask ends it (L16). A dead session is
the same problem with a wider blast radius:

1. Re-dial. With [`proposal-session-open.md`](proposal-session-open.md)'s opening ask this costs two
   round trips rather than four, which is why that row went first. A dial that fails is retried
   `tries` times `redialMs` apart while anything is still owed; after the last one every owed frame
   is failed, which is what LG/LH already did and is now the terminal state rather than the first
   response.
2. Re-issue every frame whose record is *on the wire* or *not asked*, in the same priority order
   asks and fills already have.
3. Frames already *delivered*, *decoding* or *waiting for a decoder* are untouched. They are in
   memory and the wire is not needed for them.

**The request's generation does not change.** A generation is a *request's* identity and `cancel()`
is what moves it (`client/downloader/README.md` §A request is a generation); a resume is the same
request continuing. Bumping it would drop frames still inside a decoder under the old generation
and would have to be told to the page. A session **epoch**, private to the worker, fences the dead
session's callbacks instead — so the page's records stay valid without being told anything, and
the only thing it is told is when each resume happened, as `stats().resumedAt`.

**Nothing is re-decoded and nothing is re-fetched that arrived.** That property is the reason to
put resumption behind the records rather than behind a session-level retry.

## A fill outlasts the screen lock

A 61 MB fill at 20 Mbit is **24 seconds**. A phone's screen locks well inside that, and a frozen
page runs nothing — no reader, no decoder, no timers. The fill does not fail; it stops, and then
the idle timeout kills the session under it.

Two measures, both platform calls and neither novel:

**Neither of these is built** — both are phone behaviour and neither is measurable on this host.

* **A screen wake lock for the duration of a fill**, released the moment it finishes. Held only
  while a fill is running — not for the session, and not while merely viewing.
* **A deliberate close on `freeze`, and a re-dial on `resume`/`pageshow`.** A session that is
  going to die anyway should die on the client's terms, with its records intact, so that resume is
  the ordinary path above rather than a timeout.

The wake lock is a request the platform may refuse, so the `freeze` path must work without it.

## What this does not change

* **The idle-timeout pair stays at 20 s / 60 s.** Nothing here argues those numbers; it argues that
  they should stop being the detection mechanism.
* **No new wire message.** Every part of this is client-side, and the probe is an ordinary ask.
* **No server change.** The server already serves a repeat ask and already reclaims a dead session
  on its timeout.

## What is built, and where

**2026-09-22, the lab's client.** All of the mechanism is in `client/downloader/downloader.js` —
the worker that owns the session, the records and the queue — with four lines in `consumer.js` for
the triggers a worker cannot see. No wire message, no server change and no transport change: the
probe is an ordinary ask and both transports already serve it.
[`../client/downloader/README.md`](../client/downloader/README.md) §A session that dies is resumed
is the reader's entry.

A session is **live**, **suspect** (one probe out, with a deadline), **dead**, or being
**re-dialled**. Every trigger moves it from live to suspect; only a session the API itself reports
closed goes straight to dead.

| trigger | where it is listened for |
| --- | --- |
| `online`, `offline`, `navigator.connection` `change` | the downloader's worker |
| `visibilitychange` to visible, `pageshow`, `freeze`, `resume` | the page, forwarded as one message |
| a fill quiet for `stallMs` with frames owed | the downloader's own records |

The deadlines are `{ stallMs: 3000, probeMs: 2000, redialMs: 1000, tries: 5 }`, so detection costs
`stallMs + probeMs` and a resume costs a dial after it; `survival: false` turns the whole of it off
and an object overrides them. Nothing in it runs when nothing dies, which is what keeps the
conformance and dispatch suites green unchanged.

**`tries` bounds the dials within one resumption, not the resumptions.** A dial that succeeds onto
a path that still carries nothing leaves the fill owed and quiet, so the cycle starts again about
`stallMs + probeMs` later, for as long as the consumer wants frames. That is deliberate: a network
that is genuinely down refuses the dial, which is the case `tries` ends.

**Five clauses**, `client/conformance/dispatch-rig.ts`, each mutated and seen to fail: a trigger
checks before it re-dials and a session that answers the probe is kept; a probe nobody answers
re-dials and re-issues exactly what was owed; a session the API calls closed is re-dialled with no
probe at all; an ask outstanding at the death is re-asked and settles the promise the page is still
holding; and when the re-dials run out, every frame the fill still owed is named once — LG/LH's
behaviour, as the terminal state.

## The measurement this owes

**One number, and it cannot be taken on this branch yet.** A1 asks for the rebind probe re-run at a
10 s idle timeout, to put a figure on how fast a path change is noticed when the timeout is short.
The probe is `lab/window-harness/src/bin/rebind_probe.rs` with `lab/scripts/link_impair.py`, both
here since T1 and N1; the rebind survives in this container at a 30 s timeout, so the number the
lane wants is the same probe against a 10 s one. This file's other quantities are the two measured
elsewhere: Chromium advertises 30 s (L15) and a 61 MB fill at 20 Mbit is 24 s (arithmetic).

Everything above is a design. The order it should be proved in: the rebind number after T1, then
the triggers on a phone, which is the only place `freeze` and a radio change both happen for real
— [`cloud-queue.md`](cloud-queue.md) row 59.
