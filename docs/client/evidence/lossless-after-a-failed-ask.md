# A Lossless ask that the transport failed: asked again, or left failed

**The question:** when a reader's *Lossless* ask fails in the transport (the exact frame never comes), should the
client ask again, how often and for how long, and what should the label say meanwhile? The on-demand exact frame is
the product's promise on a lossy link (`../../ARCHITECTURE.md` §The product).

*Folded 2026-11-14 from `claude/lossless-under-loss:docs/reviews/lossless-under-loss.md` (`aa81e3fc`, 2026-11-12,
with its review by a session that wrote neither fix), `claude/direction:docs/lines/client.md` §4 item 1 and
`claude/reviews-2026-11-13:docs/reviews-2026-11-13.md` §5. The fix is PR 378 on `claude/lossless-under-loss`, a draft
into the demo's branch; **not on this branch** (`EXACT_RETRY_MS` is absent from `client/` here).*

## What the phone showed (measured, one failure)

Load 6 of the first phone run ([`phone-run-method.md`](phone-run-method.md)): Wi-Fi with the server wired, `bbr`, the
worker view, `dbts_b1-q8-g8` and its exact series. The fill's bytes left the laptop by 21:14:12 (its 9.7 s was the
phone's decode, [`fill-bound-on-phone.md`](fill-bound-on-phone.md)); the press came about a second after the load's
beacon at 21:14:25. Then **both sessions timed out within half a second of each other, 30 s after the fill's bytes
left** (21:14:41), the exact one at `sent=10`, its handshake alone. Read with the servers' settings (no keep-alive,
quinn's 30 s idle timeout) and RFC 9000 §10.1 (the idle timer restarts on every packet received from the peer): from
about 21:14:11 **no packet from the phone reached either server for 30 s**, not the ask, not Chromium's 15 s keep-alive
ping (measured on Chromium 141 desktop; Chrome 157 on Android is not), and no re-dial. The phone was not dead (it
decoded until 21:14:20.6, beaconed at 21:14:25, and ~0.6 MB of TCP left the static host to it). **Why its UDP went
silent is not shown.** The rerun an hour later reached *Lossless* 0.95 s after the press.

## The exact session in the client (read in code)

`connectExact` opens the exact series on a downloader of its own (one decoder, no fill), in both views. While nothing
is asked, **nothing watches it** (`watch()` returns while nothing is owed), so its loss is found only at the ask. An
asked frame has the frame's waiter (`FRAME_TIMEOUT_MS`, 15 s of quiet) and the stall watch (3 s, doubling), then
`resume()`: up to 5 dials of at most 5 s, 1 s apart; then the ask fails. The controller labels any rejected ask, and
any frame whose digest did not match, *Lossless check failed*, and asks once: a second ask needs a second press.
Load 6 took that path: the ask went onto a session the phone still held, met silence, the downloader resumed, its dials
did not reach the server, and *Lossless check failed* named a transport failure as a check failure.

## The fix proposed, and its reproduction (simulated)

An exact ask the transport failed (rejected, no frame came) is **asked again after 1, 4 and 16 s** while the reader
stays on the frame (`EXACT_RETRY_MS` in `client/view/controller.js`); the label says *fetching lossless…* until the
frame comes or the last re-ask fails. A frame that came and failed its check is a verdict and is not asked again.
Leaving the frame, or going back to optimal quality, ends the re-asks. *Lossless* still only for the exact frame whose
digest matched, once painted. **The schedule is a choice, not a measurement:** 21 s beyond the downloader's own budget.

*Simulated, not a phone:* one 4-core cloud host without a GPU, headless Chromium 153, loopback through
`link_impair.py` (5 ms each way, 100 Mbit/s, a 200-packet queue, 7 % iid loss each way on both sessions), two
`series-server`s (`bbr`, 30 s idle timeout, no keep-alive), one packed series of 50 random 460 KB frames, the product's
`Controller` and `DownloaderClient` with `decode: false`; after the fill a **45 s blackout** both ways, `l` pressed a
second into it; arms interleaved over 3 rounds. Rows `claude/lossless-under-loss:lab/lossless-under-loss/rows/2026-11-12-blackout-45s.jsonl`.

| arm | rounds | the downloader fails the ask | re-asks | label at the end | after the press |
| --- | --- | --- | --- | --- | --- |
| re-asks off | 3 | 28.2 s, *could not be re-dialled* | none | *Lossless check failed*, 3 of 3 | 28.2 s |
| re-asks on | 3 | 28.2 s | +1 s and +4 s fail (*Opening handshake failed*), +16 s succeeds | *Lossless*, 3 of 3 | 58.1–58.7 s |

The timings depend on the outage's length and decide nothing about the schedule; the host was not near saturation.

**Review** (2026-11-12, a session that wrote neither fix): the two re-ask tests fail without the fix and three further
mutants are killed; the fix touches `controller.js` only. **Findings:** *every* rejection is re-asked, not only a lost
transport, so a refusal that will repeat (e.g. `no decoder: …`) shows *asking* for about 21 s before *failed* (bounded,
harmless to the frame); and the lab rig `claude/lossless-under-loss:lab/lossless-under-loss/` rides the PR, which under the owner's 2026-11-11
rule stays off the product path.

## Not done, for the owner

* **The label:** a fetch that failed reads *Lossless check failed*, which a reader may take for a frame that failed its
  digest; a separate text (say *Lossless unavailable*) is a label change, the owner's.
* **The retry's scope and schedule:** transport losses only, or every rejection; 1, 4, 16 s or another.
* **The idle exact session is not watched**, so a dead path is found 15 s late at the ask; server keep-alive under 15 s
  would find it first (the ADR's 60 s / 20 s pair is still proposed, [`../../adr/transport-idle-sessions.md`](../../adr/transport-idle-sessions.md)).
* The beacon records neither the failure's reason nor the label after the load's own beacon.

## Verdict, scope

The failure is real (one phone load) and its path is traced in code; the fix holds on a simulated 45 s outage (3 of 3
against 0 of 3), one rig, three rounds a side. It is a proposal, not on this branch; its label and retry scope are the
owner's. *Decides it on a phone:* the next phone round, with the failure's reason in the beacon.
