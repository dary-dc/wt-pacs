# The receive loop beside the paint

**Question:** Does a WebTransport receive loop keep the fill's rate when it shares a worker's thread with the paint?

*Moved 2026-11-14 from `docs/adr/frame-path.md` at `e5b20cba` (§The receive loop beside the paint), word for word but
for queue-row names. A bare §N or §Name is a section of that ADR: [its map](../../adr/frame-path.md) names the file
each now lives in. Choices 1–8 are [the cache's](cache-in-opfs.md#the-choices-and-what-decides-each). The design these
findings shape is [`../design.md`](../design.md).*

## The receive loop beside the paint (2026-10-29)

*Theory and a harness; nothing measured. The question is difference 2 above: does a WebTransport receive loop keep
the fill's rate when it shares one dedicated worker's thread with OPFS reads, XXH3 checks, uploads and paints?
Sources at the pins in [`frame-path-sources.txt`](sources.txt) under 2026-10-29, line numbers as fetched.
The harness is [`../../lab/recv-loop/`](https://github.com/dary-dc/wt-pacs/tree/cf38708b2c4f1b5743e15c7cee89a7d5778abad4/lab/recv-loop/README.md); the protocol's runs are a separate row.*

### Where received bytes wait while the worker's thread is busy

**The standards.** A receive stream is a byte stream set up with no high-water mark, so 0 (webtransport `index.bs`
2585–2587; streams `index.bs` 6938): the user agent reads from the QUIC stream on a pull, in parallel, and
delivers what it read in a network task on the transport's event loop (2595–2628), the worker's, which waits for
the thread like any task. A buffer below it "SHOULD have a fixed upper limit, to carry the backpressure information
to the server" (2618–2619).

| engine | where the bytes wait | the receive window, and when it advertises more | what reaches the server |
| --- | --- | --- | --- |
| Chromium | a 256 KiB mojo pipe per stream (`services/network/web_transport.cc` 1445–1446); the network service reads QUIC only while the pipe has room (369–395); Blink empties the pipe in a task on the worker's thread, on a pull or the pipe's watcher (`incoming_stream.cc` 46–50, 160–170, 255–260) | 6 MiB a stream, 15 MiB the connection (`net/quic/quic_context.cc` 21–22, 95–97), WebTransport's too (`dedicated_web_transport_http3_client.cc` 853); a client never auto-tunes (QUICHE `quic_session.cc` 184, `quic_stream.cc` 149); an update once less than half the window is unread (`quic_flow_controller.cc` 190–192, 194–219), unread meaning not yet copied into the pipe (`web_transport_stream_adapter.cc` 41–52) | flow control: with the pipe full the window stops moving, and the server blocks 6 MiB + 256 KiB past what the script took |
| Gecko | a 96 KiB pipe on the socket thread (`WebTransportStreamBase.cpp` 44–49; 24 × 4 096 B, `nsIOService.cpp` 212–213), which stops reading neqo when full (`Http3WebTransportStream.cpp` 474–501); a 64 KiB IPC pipe copied into on the socket thread (`WebTransportParent.cpp` 283–301; `DataPipe.h` 149); the worker reads it in a task on its own event target, on a pull (`WebTransportReceiveStream.cpp` 57–60; `UnderlyingSourceCallbackHelpers.cpp` 253–268, 280–297) | neqo's default for the server's uni streams, 1 MiB auto-tuned to at most 10 MiB (`neqo-transport` `params.rs` 60, 83, 193; `fc.rs` 405–430): Firefox sets only the connection's 24 MiB and its own bidi streams' 12 MiB (`neqo_glue` `lib.rs` 489–494; `StaticPrefList.yaml` 16883–16892); an update once a quarter of the window is read (`fc.rs` 38, 288–310), read meaning copied into the pipe (`recv_stream.rs` 1142–1162) | flow control, as Chromium's, past W + 160 KiB, W between 1 and 10 MiB |
| WebKit | nowhere bounded: the network process re-arms `nw_connection_receive` (0 to 2³² − 1 bytes) after every delivery, whatever the worker does (`NetworkTransportStreamCocoa.mm` 242–291), sends each over IPC (`NetworkTransportSession.cpp` 77–80); the web process posts it to the worker as a task (`WorkerWebTransportSession.cpp` 116–125), which appends it to an unbounded queue (`WebTransportReceiveStreamByteSource.cpp` 116–144) | Network.framework's, not in WebKit's source; apart from it, a session stalls after 16 MB ([`../CLIENTS.md`](../../CLIENTS.md), bug 319818), which recycling answers | nothing from a busy worker: the bytes queue in its memory and the spec's SHOULD is not met |

**What this corrects.** The independent design's failure case read the 6 MiB window as filling in ~0.4 s at
125 MB/s. That holds for a reader that stops; one that runs between reads drains the window at each gap. A cine
step holds the thread for T: 22 ms of read and check, the brief's figure (M1 measured 22.3 ms at 27 MB, so a 17 MB
step is likely less), plus a ~6 ms upload, so T ≈ 20–28 ms, the upper end used below. Chromium's server stalls
inside one step only when R × T passes the 3 MiB left after an update: 3.5 MB at 125 MB/s, just over; 0.36 MB at
103 Mbit/s, a ninth of it. *Corrected 2026-10-29 (independent review):* 6 MiB at 125 MB/s fills in ~0.05 s, not
0.4 s (0.4 s is 125 Mbit/s); and the bytes in flight hold the window too, so the stall is R × (RTT + T) past W, as
the formula below: 1.5 MB at 103 Mbit/s and 92 ms, still far inside. **What binds first is the thread's time.** The receive loop costs the renderer ~2.3 ms
per MB plus ~50 µs a frame ([`../rig-limits.md`](../../rig-limits.md) §1: Chromium 141, a container; Gecko's and
WebKit's not measured, taken equal below). A 30 frames/s cine of 28 ms steps holds 84 % of the thread, and the
16 % left carries ~64 MB/s.

### Predictions, per engine

Merged ≈ min(R, (1 − 30 T) ÷ c, W ÷ (RTT + T)); split ≈ min(R, the network process's ceiling, W ÷ RTT); R the link,
c ≈ 2.5 ms per MB, W the stream window. The fill is 250 KB frames as the harness's; T = 28 ms at 1× on a host with
a GPU.

| cell | split's last frame | merged ÷ split, last frame | merged's inter-arrival p99 − split's | engines |
| --- | --- | --- | --- | --- |
| 18 Mbit/s, 92 ms, cine | 6.7 s + the dial | ×1.00, one step at most | **+~28 ms**: a frame landing in a step waits it out | all three alike: a step's 63 KB fits the pipes |
| 103 Mbit/s, 46 and 92 ms, cine | 3.9 s + the dial | ×1.00–1.01 | **+~28 ms**, on a nominal 19.4 ms | Chromium, Gecko: a step's 0.36 MB spills past the pipes into the window, far inside it; WebKit: the wire untouched |
| any of those, drag | — | ×1.00 | +≤ 1 ms | a drag's tick holds the thread for a draw call, not an upload |
| 125 MB/s, 46 ms, cine (beyond the relay) | the network process's, ~100–150 MB/s on a container | **×1.3–2** (the thread, 64 MB/s at T = 28; the window, 85–95 MB/s). *Corrected 2026-10-29 (independent review):* the formula gives ×1.6–2 at T = 28, the thread binding, and ×1.05–1.3 at T = 20, the window binding | — | Chromium; Gecko once neqo's window has tuned past R × T; WebKit's wire keeps 125 MB/s and its worker's queue grows ~60 MB a second |
| 125 MB/s, 92 ms, cine | window-bound: 6 MiB ÷ 92 ms = 68 MB/s | ×1.3 (52 MB/s, the window over RTT + T) | — | Chromium; Gecko's 10 MiB: ×~1.8 (114 against 64 MB/s) |
| 4× on every thread | a step ~112 ms: the cine saturates in both arms | excluded by the guard | — | claim nothing |

*Corrected 2026-10-29 (independent review):* +~28 ms is the longest wait, not the p99's rise. Merged, arrivals
snap to the gaps between steps, so at 103 Mbit/s a gap is at most a period, 33.3 ms: a model with frames at their
nominal pace and a 28 ms step every 33.3 ms (not measured) gives merged's p99 − split's ≈ +12 ms at 103 Mbit/s,
under the rule's 16.7 ms, and ≈ +20 ms at 18 Mbit/s (+15 at T = 20), at the bar.

**So: at the target links the fill's rate is kept on every engine, and its pace is not.** Merged, a frame reaches the
script up to a step late, so the p99 rises by about a step. In the target that frame reaches the screen no sooner,
since the view worker is in the same step; what the split keeps is the decoders fed during it. The rule counts the
pace anyway, as the question names it. The 125 MB/s cells are where the independent design's failure is real, on
the thread's time more than on the window.

### Protocol (pre-registered; not run)

* **Arms**, one lever: `split` (the receive loop in its own worker beside the view worker), `split2` (the same, the
  A/A), `merged` (one worker). Williams order (`lab/order.mjs`), 12 rounds, a fresh browser a visit on a disk-backed
  profile.
* **Cells:** cine and drag (lab README) × 103 Mbit/s at 46 and 92 ms and 18 Mbit/s at 92 ms through
  `link_impair.py`; loopback printed as the host's ceiling and outside the rule. Chromium and Firefox, on a host with
  a GPU on which the split arm's cine holds 30 frames/s; software GL does not (one-worker probe: a 46 ms draw at
  2560×3328). *Corrected 2026-10-29 (independent review):* the harness forced SwiftShader on Chromium whatever the
  host; `--angle` now picks ANGLE's backend, and the row's `renderer` shows which ran. WebKit is not runnable in the lab; its row stands on the source.
* **Checks**, each mutated (lab README): every frame exact; `merged` is one thread (no arrival inside a load task);
  `split` is two (some arrival inside one).
* **Saturation guard:** `VOID` when the host passes 90 % CPU or the relay's send p99 passes 1 ms; a round of a cell
  is dropped for all arms when `split`'s cine runs under 27 frames/s.
* **The rule.** In every shaped cell on both engines: (1) *rate*, `aa_rule.py` on the last frame, merged against split
  with split2 as the A/A, bar 2 %; (2) *pace*, merged's inter-arrival p99 within 16.7 ms of the same round's split in
  ≥ 9 of 12 rounds, the A/A meeting the same bound; (3) *paint*, the same on the cine's step lateness p99, so merged
  cannot keep the fill by starving the cine. **The downloader may merge into the view worker only if all three hold
  everywhere.** `worse` on (1), or a failure of (2) or (3) where its A/A holds, keeps the split; anything else is
  undecided and runs again with `--confirm`. `run.mjs summary` applies it. *Corrected 2026-10-29 (independent
  review):* `summary` judges one run; the `--confirm` run is `aa_rule.py --confirm` on the two `.cells.json` files.
* **Predicted outcome:** (1) and (3) hold, (2) fails on every cine cell: the split stands, on pace, not on rate.
  *Corrected 2026-10-29 (independent review):* by the model above (2) holds at 103 Mbit/s and sits at the bar at
  18 Mbit/s, so the predicted outcome is undecided, not the split.

**Smoke, 2026-10-29:** one round of loopback cine, one visit of 103 Mbit/s drag, each mutant once, Chromium 153 on
software GL. It ran and the checks caught all three mutants; no number from it is a result. No Firefox or WebKit
binary is in this container.

**Not traced:** Network.framework's receive window; Blink's high-water mark past the spec's default; the receive
cost per MB in a Gecko or WebKit worker.
