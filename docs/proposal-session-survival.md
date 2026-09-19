# Proposal: a session that dies is noticed and resumed

**2026-09-19 · Status: proposed, nothing built.** Structural, so this is a proposal first
(`CLAUDE.md`). A1, from [S2 and S3](improvements/2026-09-18.md). One number it asks for cannot be
taken here yet — see §The measurement this owes.

## The problem, stated as a freeze

**Chromium never migrates a WebTransport session.** Its client has no network-change handling, so
Wi-Fi → cellular ends the session whatever the server does. Nothing in the API reports it. The
client discovers the path is dead only when an idle timeout fires — the smaller of the two peers'
— and until then it sits holding a session that cannot carry a byte.

That makes [`transport/adr-idle-sessions.md`](transport/adr-idle-sessions.md)'s recommendation
read differently than when it was written. The pair there is **20 s keep-alive, 60 s server idle
timeout**, chosen against the 30 s Chromium advertises (L15 confirmed it does, exactly). Those are
still the right numbers for *holding a session open*. But the timeout is also **the length of the
freeze**: a 60 s server timeout against Chromium's 30 s means the client notices at 30 s, and the
recommendation doubles the 30 s freeze L15 measured rather than shortening it.

**The timeout is a detection bound, and it is the wrong instrument.** It exists to reclaim a dead
session, not to tell a viewer its data stopped. Detection should come from the platform, and the
timeout should stay where it is.

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
should start a check, not a re-dial.

## The check: a probe ask with a deadline

The cheapest honest test of a session is to use it. On any trigger above, the downloader asks for
**one frame it already holds** — a frame already delivered, so the answer is discardable and the
decode path is not disturbed — with a deadline well under the idle timeout.

* It arrives → the path is alive; nothing else happens.
* The deadline passes → the session is dead regardless of what the API says; re-dial.

The frame index is chosen from the downloader's own records, so the probe costs one small frame and
no bookkeeping of its own. A study with nothing delivered yet has nothing in flight to lose, so the
probe is skipped and the first real ask is the probe.

## Re-dial and re-issue, on records that already exist

This is the part that needs no new state. `proposal-downloader.md` §The downloader already keeps
**one record per frame** — not asked, on the wire, waiting for a decoder, decoding, delivered — and
already re-issues the undelivered remainder of a fill after an ask ends it (L16). A dead session is
the same problem with a wider blast radius:

1. Re-dial. With [`proposal-session-open.md`](proposal-session-open.md)'s opening ask this costs two
   round trips rather than four, which is why that row went first.
2. Re-issue every frame whose record is *on the wire* or *not asked*, in the same priority order
   asks and fills already have.
3. Frames already *delivered*, *decoding* or *waiting for a decoder* are untouched. They are in
   memory and the wire is not needed for them.

**Nothing is re-decoded and nothing is re-fetched that arrived.** That property is the reason to
put resumption behind the records rather than behind a session-level retry.

## A fill outlasts the screen lock

A 61 MB fill at 20 Mbit is **24 seconds**. A phone's screen locks well inside that, and a frozen
page runs nothing — no reader, no decoder, no timers. The fill does not fail; it stops, and then
the idle timeout kills the session under it.

Two measures, both platform calls and neither novel:

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

## The measurement this owes

**One number, and it cannot be taken on this branch yet.** A1 asks for the rebind probe re-run at a
10 s idle timeout, to put a figure on how fast a path change is noticed when the timeout is short.
The probe is `lab/window-harness/src/bin/rebind_probe.rs` with `lab/scripts/link_impair.py`, both
here since T1 and N1; the rebind survives in this container at a 30 s timeout, so the number the
lane wants is the same probe against a 10 s one. This file's other quantities are the two measured
elsewhere: Chromium advertises 30 s (L15) and a 61 MB fill at 20 Mbit is 24 s (arithmetic).

Everything above is a design. The order it should be proved in: the rebind number after T1, then
the triggers on a phone, which is the only place `freeze` and a radio change both happen for real.
