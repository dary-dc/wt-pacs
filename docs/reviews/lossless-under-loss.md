# Lossless under loss: the phone run's load 6

The phone run of 2026-11-11 (`claude/phone-rows` `4e492c92`, `docs/phone-rows/README.md`), load 6: Wi-Fi with the
server wired, `bbr`, the worker view, `dbts_b1-q8-g8` and its exact series `dbts_b1`. The fill took 9.7 s with 7 % of
the server's packets lost; the reader's *Lossless* ended on *Lossless check failed*, and the exact series' session
carried its handshake only. One phone, one home link, one evening, one failure: what follows reads that failure from
the client's code and the run's traces; the outage's own cause on the phone is **not shown**.

## What the traces show

All times are the laptop's (UTC); the phone's beacon stamps agree with the laptop's interface counters to under a
second (the rerun's exact frame: pressed at 22:20:29 on the phone, 2.85 MB on the laptop's wire at 22:20:29).

| when | what | source |
| --- | --- | --- |
| 21:14:10.9 | the fill starts | beacon `abab2022`, `fillFrom` |
| 21:14:10–12 | the fill's 26 MB leave the laptop; nothing after (no retransmission tail) | `raw/counters.log`, `enp3s0` |
| 21:14:20.6 | the page has decoded the 50th frame (`fillMs` 9 665) | beacon, `fillTo` |
| 21:14:25.1 | the load's beacon; the runner presses *Lossless* about a second later (the rerun's gap: 1.06 s) | beacon |
| 21:14:25–26 | about 0.6 MB leave the laptop on the same wire (the static host, TCP) | `raw/counters.log` |
| 21:14:41.1 | the exact session (4444) ends **timed out**, `sent=10` | `raw/servers/srv-4444.log` |
| 21:14:41.6 | the optimal-quality session (4443) ends **timed out**, `sent=17549 lost=1255` | `raw/servers/srv-4443.log` |
| 22:20:2x | the next session on 4444: the rerun, which reached *Lossless* | `raw/servers/srv-4444.log`, beacon |

Read with the server's settings (no keep-alive, quinn's 30 s idle timeout: neither `run-env.sh` nor the image passes
`--max-idle-timeout-ms` or `--keep-alive-interval-ms`):

1. **Both sessions timed out within half a second of each other, 30 s after the fill's bytes left.** A QUIC endpoint
   restarts its idle timer on every packet it receives from its peer (RFC 9000 §10.1). So from about 21:14:11 no
   packet from the phone reached either server for 30 s: not the fill's acknowledgements (all in by then), not
   Chromium's keep-alive ping, which it sends after 15 s of quiet (`docs/adr/transport-idle-sessions.md` §What a
   real Chromium does, Chromium 141 on a desktop; Chrome 157 on Android is not measured), and not the ask.
2. **The ask never arrived.** `sent=10` is the handshake alone: a request stream would have drawn at least an ACK.
   The exact sessions of loads that never asked show the same 10–11.
3. **No re-dial arrived.** The next session on 4444 is the rerun an hour later.
4. **The phone was not dead.** Its page decoded until 21:14:20.6 and beaconed at 21:14:25; about 0.6 MB went from the
   laptop's static host to the wire at 21:14:25–26. Whether that TCP reached the phone, and why its UDP did not reach
   the laptop (Wi-Fi power save, a network change on a phone that is tethered and on Wi-Fi at once, Chrome moving its
   QUIC to another network), is not shown: the beacon has no receive time and nothing on the phone was recorded.

## The exact session in the client

`client/viewer/viewer.js` `connectExact` opens the exact series on a downloader of its own (`decoders: 1`, no fill)
once the page has connected, in both views (`client/view/view-worker.js` `connectExact`). From then:

| state | what watches it | on failure |
| --- | --- | --- |
| idle, nothing asked | **nothing**: `watch()` (`client/transport/downloader.js`) returns while nothing is owed | unseen until an ask |
| asked, on the wire | the frame's waiter (`FRAME_TIMEOUT_MS` 15 s of quiet, `frame-session.ts`) and the stall watch (3 s, doubling) | `lost()` → `resume()` |
| resuming | `resume()`: up to 5 dials, each at most 5 s, 1 s apart | the ask failed, *the session was lost and could not be re-dialled* |
| session closed before the ask | `live()` dials once | the ask failed with the dial's error |

The controller (`client/view/controller.js` `showExact`) labels any rejected ask, and any frame whose digest did not
match, *Lossless check failed*. It asked once; a second ask needs a second press of `l`.

**Which path load 6 took.** The label turned *failed*, so the ask was settled; no frame reached the phone, so it was
not a digest mismatch nor a frame without a digest. That leaves the downloader failing the ask: the ask went onto a
session the phone still held open, met silence, and after the waiter's 15 s or Chrome's own idle timeout (both near
21:14:41) the downloader resumed; its dials did not reach the server (point 3) and it failed the frame. *Lossless
check failed* then named a transport failure as a check failure, and nothing asked again. The rerun, on the same
link an hour later, reached *Lossless* 0.95 s after the press.

## The fix proposed

On `claude/lossless-under-loss`: an exact ask the transport failed — the ask rejected, no frame came — is **asked
again after 1, 4 and 16 s** while the reader stays on the frame (`EXACT_RETRY_MS`, `client/view/controller.js`); the
label says *fetching lossless…* until the frame comes or the last re-ask fails. A frame that came and failed its check
is a verdict and is not asked again. Each re-ask reaches the downloader, which dials afresh once its own resume has
given up. Leaving the frame, or going back to optimal quality, ends the re-asks. The clinical invariant is unchanged:
*Lossless* only for the exact frame whose digest matched, once painted.

The schedule is a choice, not a measurement: 21 s more after the downloader's own budget (15 s of waiting, up to 30 s
of dials). Whether it would have saved load 6 depends on how long the phone's path stayed silent, which the run does
not show (the 30 s of point 1 is a lower bound).

**Not done, for the owner:**

* The label names a transport failure *Lossless check failed* (`client/viewer/screen.js`). A reader may take an
  unreachable exact series for a frame that failed its digest. A separate text for a fetch that failed (say
  *Lossless unavailable*) is a label change, the owner's.
* The idle exact session is not watched, so its loss is found only at the ask, 15 s late. Server keep-alive below
  15 s (`--keep-alive-interval-ms`, off in the run) would make the server, not the reader, find a dead path; the ADR's
  60 s / 20 s pair is still *proposed*.
* The beacon records neither the failure's reason nor the label after the load's own beacon, so a run cannot tell
  which branch of the table above a failure took (RUNNER-AUTO's beacon could carry the `failed` event's `reason`).

## Reproduced on a simulated link

*Simulated*, not a phone: `lab/lossless-under-loss/run.sh 3 45000` on one 4-core cloud host without a GPU, headless
Chromium 153 (Playwright 1.63), loopback through `lab/scripts/link_impair.py`: 5 ms each way, 100 Mbit/s, a
200-packet queue, 7 % iid loss each way on both sessions. Two `series-server`s (`--congestion bbr`, quinn's 30 s idle
timeout, no keep-alive) serve one packed series of 50 random 460 KB frames: one session fills it, the other is the
exact session, idle until asked. The page (`page.html`) runs the product's `Controller` and `DownloaderClient` with
`decode: false`; a frame that arrives stands in for one whose digest matched, so the check itself is not under test.
After the fill, a 45 s `blackout` drops every datagram both ways on both sessions, and `l` is pressed a second into
it. The two arms are the same code, the re-asks on (`retry`) or off (`off`, `exactRetryMs: []`), interleaved over
three rounds. Raw rows: `lab/lossless-under-loss/rows/2026-11-12-blackout-45s.jsonl`.

| arm | rounds | the downloader fails the ask | re-asks | label at the end | after the press |
| --- | --- | --- | --- | --- | --- |
| `off` | 3 | 28.2 s, *could not be re-dialled* | none | *Lossless check failed*, 3 of 3 | 28.2 s |
| `retry` | 3 | 28.2 s, the same | at +1 s and +4 s each fail (*Opening handshake failed*), at +16 s succeeds | *Lossless*, 3 of 3 | 58.1–58.7 s |

The silence is load 6's shape: the ask goes onto a session the client still holds, the downloader's resume spends
its budget inside the outage, and with the re-asks off the reader is left on *Lossless check failed* once the link is
back. With them on, the frame comes on the first re-ask after the link returns. A 45 s outage and one rig, three
rounds per arm: the timings depend on the outage's length and decide nothing about the schedule; nothing here was
near saturating the host.
