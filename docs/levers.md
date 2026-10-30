# Levers outside the codecs — tried and open

*Queue row 166, AUDITPATH, 2026-10-13. An audit: nothing here was built or timed. Each line points to the doc that
owns the lever; the numbers are that doc's. The codecs' own levers are row 165's, in
[`codecs/README.md`](codecs/README.md#tried-and-open) §Tried and open.*

**The question.** Outside the codecs, is every lever tried, and what is left that would be net?

**The answer, short.** Most of the path is closed by measurement that still holds: the read path, the send path's
copies, the stream shape, the client's state machines, the decoder's build and memory. What is left falls into
three groups. **Reopened by row 162's links** (a ~100 Mbit/s median and a 0.7–0.8 s loaded RTT on cellular): server
CPU per byte weighs ~5× more, so PGO and the multi-core cell matter; the wire outruns the decoders on large frames,
so client-side per-frame cost (the exactness hash, the copy out of the decoder heap, an ask queued behind a decoder)
and the coded queue's memory matter; and the RTT at which server-side ask ordering flips is now crossed. **Reopened
by the owner's net ruling** (2026-10-13): two levers that were refused by a fixed bar, not by a loss — P-COPY and
`startOnNeed` — now want only an A/A spread. **Never tried**, cheaply: answering a client's repeated Initial, a PING
after an isolated frame, the MTU bound, deploy limits. The ranked list is [§Proposed rows](#proposed-rows-ranked-by-expected-net-gain);
the trade-offs, for the owner, [§Trade-offs](#trade-offs-for-the-owner). The largest single item outside this
audit is row 167's: an ask waits behind the fill the server has written ahead, ~0.5 s at the cellular median (D).

**How to read a line.** *Rows* are the [AV1 queue](av1/queue.md)'s (current copy on `claude/av1-mainbase`); "cq X"
is a row of the closed [`cloud-queue.md`](cloud-queue.md); "RP" is the read-path campaign of 2026-09-06…10
([`adr/disk-access.md`](adr/disk-access.md)). The class is one of:

* **held** — closed by evidence that still holds;
* **premise** — closed by a premise since changed (named: the link band, row 162; the net ruling; a newer release);
* **never** — never tried: a lever argued but never measured counts here;
* **owner** — waiting on the owner (queue §Blocked, or an owning doc's §Open);
* **queued** — a `ready` or `claimed` row already takes it.

---

## Disk: the read path and the writer

Owner: [`adr/disk-access.md`](adr/disk-access.md) (§5 · Every candidate, one table, unless named) and
[`disk-layout/`](disk-layout/README.md).

| lever | measured by | class | owning section |
| --- | --- | --- | --- |
| `RWF_NOWAIT` inline hit | RP: 2.5× warm (60.9 against 152.3 µs) | held | §5; refused on overlayfs, tmpfs (§6) |
| io_uring on a tile miss, against the pool's `pread` | RP: −56 to −75 % CPU (sandbox), a tie (workstation), pool +106–138 % (agent container); L7 could not answer | **never** on the target | §9 · What is next, #1 (P0); no queue row |
| Every read through the ring; a ring per runtime; tokio's driver; `tokio::fs`; `SQPOLL`; registered buffers | RP: hits +165 % CPU; 1.36–1.45× slower; 2.8× CPU; no change | held | §5 |
| Fill on the pool, one frame named | RP: ties every variant | held | §5 |
| `FILL_WINDOW` 4 MiB `WILLNEED` | RP: misses 60 % → ~1 %; L7: 1 % past RAM | held | §5 |
| Tile depth 4, read-ahead by one | RP v36 +73.8 % asks/s; v35 2→4 +37 % | premise (link band: §9 #3's throttled 20 Mbit/s cell is moot) | §5, §9 #3 |
| Ahead-N `WILLNEED` for tiles | RP: 4.6–4.9× cold strided, a loss on sweeps | owner (layout 1, rows 133/143) | §5 |
| `read_ahead_kb` | L7: 128 against 2 048 KiB, no clean result | never | §Read-ahead, §9 #6 |
| mmap | RP: `gap_max` 1.5–7.7 ms; row 51: not re-timed | held | §5 |
| `O_DIRECT`, SPDK | — (argued: loses the shared page cache) | never | §5 |
| Park on the ring fd, drop the eventfd | RP x14: a tie on CPU and latency, 1 fd and 3 `unsafe` blocks fewer (*corrected 2026-10-15*: said 2). Row 250 re-measured the tie on the product (`read_path_ab.sh`, 12 rounds) and counted the fd | **built 2026-10-16**, row 250, on the owner's word that P0 waits (*was:* held, deferred to P0; proposed as row 244) | §9 #7 |
| tokio-uring, glommio, monoio, compio | — (a transport rewrite) | never | §2 |
| `sendfile`, `splice` | — (userspace QUIC copies anyway) | never | §5 |
| A process-private frame cache | RP: −20.2 % CPU at a 0.92 hit rate, +4.2 % with no repeats | trade-off; premise (link band: server CPU ×5) | §8 · Levers outside this decision |
| Pool capped by bytes (16 MiB) | row 51: RSS at rest −32 %, CPU +8.4 % | held (a trade-off, refused) | §Frames past 250 kB, and memory at rest |
| `MALLOC_MMAP_THRESHOLD_` 1 MiB | row 51: RSS at rest −46 to −57 %, CPU a tie to +5 % | owner (row 51's cell; not in §Blocked) | §8 |
| Whole-frame inline probe on large frames | RP: a 250 kB inline copy `gap_max` 4.0 ms; row 160: a 2.8 MB hit 216–220 µs; 16 MB unmeasured | never (since whole-frame probes shipped) | §5 |
| `io-uring` 0.7.14 → 0.7.15 | — | held: in since 2026-10-03, untimed (*corrected 2026-10-16, row 251*: said never) | §9 #8 |
| Deploy limits: `LimitMEMLOCK`, `nofile`, `check-fastpath` in the image | — (`deploy/compose.yml` sets `memlock` 64 MiB and `nofile` 65 535 since row 231, with the io_uring profile; `check-fastpath` in the image never tried) | held (row 231, the owner's ruling) | §Limits: `ulimit -n` and `ulimit -l`, §9 #5 |
| Release LTO, one codegen unit | RP: −4 to −8 % CPU | held (landed) | §8 |
| Container format (MP4, fMP4, MKV, MXF, DICOM EOT, IVF) against `.sbnd` | rows 159, 160: reads, fill, CPU tie; the open loses 13–26 ms; none round-trips | held (verdict proposed to the owner) | [`disk-layout/containers.md`](disk-layout/containers.md) §Verdict |
| `.sbnd` v2 (148 B header, 28 B entries) | row 160: ties v1, 0.006–0.07 % smaller | held; the build not queued | [`disk-layout/target.md`](disk-layout/target.md) §Layout 0 |
| The writer's 8 KiB `BufWriter` against 1 MiB writes | row 160: hits 24–31 % and fill 24–32 % slower; row 168 (theory): write-sized page-cache folios; row 172: folios confirmed on ext4 (4.9 → 1.3 a 32–41 kB frame), hit p50 ×0.62–0.83, none beyond the A/A resolution | **never** (row 172's rule (e): closed; WRITERAA proposed) | [`disk-layout/README.md`](disk-layout/README.md) §The writer |
| `fallocate` to the final size; frames aligned to 4 KiB | row 172: `fallocate` ties `pack-series` on folios and hits | never (row 168, theory: `fallocate` touches no hit; alignment is in its folio model) | §The writer; containers.md §5 |
| Publish by `.partial` → fsync → rename → fsync | row 153 (theory) | never (agreed in the draft target) | target.md §Packing and publishing |
| A coded-bytes hash per entry, checked on read | rows 73, 123 (theory); 151: XXH3 ~3.3 GB/s client-side | owner (row 123 (2)) | target.md §The two hashes |
| Metadata stored twice, read by neither the server nor `from-parser` | row 164 (documented) | never | README.md §The metadata, twice |
| Layout 1, tiled band-major | 2026-09-06: 17.6× (1.50× cached); row 133: ask ×0.39–0.45, +0.12 % bytes | owner (rows 133, 143) | target.md §Layout 1 |
| Display order on disk | cq L20: a coarse-to-fine order cost the read path 0.3 % | held | README.md §The reader |

## Server: the send path

Owner: [`transport/transport-conclusions.md`](transport/transport-conclusions.md) (TC) §4 · CPU per byte, and
[`adr/disk-access.md`](adr/disk-access.md).

| lever | measured by | class | owning section |
| --- | --- | --- | --- |
| Pooled hand-off, one copy fewer | TC §4: −3 to −8 % CPU, 6/6; row 51 confirms | held | TC §4 |
| mmap, `sendfile`, the per-send copy | row 51: CPU per byte flat 1.5–2.6 µs/kB from 250 kB to 16 MB | held — no per-frame cost is left, so row 162's ×5 falls on CPU per byte | disk-access §Frames past 250 kB |
| PGO | TC §4: −13 to −20 % CPU per ask, no cell against; PGOSHIP (2026-10-22): −13 % CPU per MB through the relay at 103 and 18 Mbit/s, A/A ±1 % | held; opt-in, not in the image (the owner's) | [`lab/pgo-relay/`](../lab/pgo-relay/README.md) |
| LTO fat | TC §4: −3.7 to −8.4 % CPU, +7 % p50 at 32 KB depth 1 | held | TC §4 |
| mimalloc; `aws-lc-rs` | TC §3, §4 | held | TC §3, §4 |
| One endpoint per core; `yield_now` | TC §6: −39 to −64 % CPU, but 12 of 16 rebinds kill the session; `yield_now` +7 % p50 | held (parked until connection-ID steering) | TC §6 |
| Fills per core beyond one core | row 81: ~400 MB/s a core, 2.0–3.1 ms CPU per MB, one core only | never (the scale cell) | TC §Many fills at once |
| Admission control; 1 000 stalled sessions | — | never | TC §9 #9 |
| Stream shape (shared, per frame, pool) | cq HOL1 (cq 78): level; cq T12: per frame −26 % / −62 % browser throughput | held | [`adr/stream-shape.md`](adr/stream-shape.md) §Decision |
| Per-frame streams under BBR | — | never | stream-shape §What would reopen it |
| Server-side cancel and ask ordering | ADR sweeps (a weak null) and an argument that flips "above roughly 100 ms" | **premise** (link band: loaded RTT 0.2–0.8 s); not among row 167's items | [`adr/reject-server-ordering.md`](adr/reject-server-ordering.md) §6 |
| Fill order coarse-to-fine | cq O1: 5.5× sooner to scrubbable | held | TC §The fill's order |
| Telemetry | +0.3 to +2.1 % CPU in its build, 0 in the default | held | [`adr/telemetry-server-pipeline.md`](adr/telemetry-server-pipeline.md) §What it costs |

## Transport

Owner: TC, [`native/quic.md`](native/quic.md), [`WIRE.md`](WIRE.md). Row 167 (done) re-derived the eight verdicts in
[`transport/link-conditions.md`](transport/link-conditions.md) §Verdicts that rest on the band, plus an ask behind
the session's own fill (theory, (D)); each line gives its result and the protocol it proposed, none queued.

| lever | measured by | class | owning section |
| --- | --- | --- | --- |
| Controller: `cubic-restart` default, BBR opt-in | row 60: 1 % loss turns 0.62 s into 4.0 s; row 75: BBR 0.04–0.76 of the fill under loss, +2–13 % clean; cq ASKL, L3, PROF, NBR, FQC: BBR takes 94–99 % from a neighbour | owner (§Blocked, row 75); holds at the measured links (row 167 item 2) | TC §1 |
| `cubic-restart` after a silence | cq W3, W5b: −4.6 to −6.6 s after a dropped blink, a tie otherwise | held | TC §After a blink |
| `bbr-bound` (v3's loss bound) | rows 103, 104, 107: fails its rule | owner (§Blocked, row 107: retire or keep) | TC §The bound, reviewed |
| Bounded BBR (BB2, BBF) | cq BBF, TAX: +95 to +106 ms tax | held | TC §A bounded BBR, retired |
| HyStart, early slow-start exit | cq W2: within 5 %; cq W4b: a tie on time, 239–454 ms less standing queue | **premise** (link band: at a 0.7 s loaded RTT the queue cut is ask latency) | TC §The slow-start exit |
| Cubic that skips the cut on random loss | rows 119, 141: no q* passes; row 146 closed it unrun | owner (§Blocked, row 141) | TC §The way out, surveyed |
| A per-peer controller switch | row 141 | held | TC §1 |
| 32-packet initial window | cq W1: −28 to −33 % first ask; cq W1b: +11.8 % on a 10-packet queue; rows 119, 132, 140 | open (row 167 item 3: its losing cell is a 10-packet queue; IWDEEP proposed) | TC §A 32-packet initial window |
| The opening ask, pushed at open | cq PUSH, W1b: 454.7 → 103.9 ms; cq WSA | held (the default) | TC §The bytes the viewer needs anyway |
| A per-client jump start from a saved window | — (the push recovers 130 of 134 ms) | never (little to win) | TC §What the numbers support |
| Initial RTT 100 ms | cq W2; rows 130, 139: the rule fails, the 100 ms arm never worse | held; row 139's "review's call" has no row | TC §Measured: IRTTMEASURE |
| Answering a repeated client Initial (RFC 9002 §6.2.3) | — (row 139's rule says to queue it; never queued) | **never** | TC §A 100 ms initial RTT, read from sources |
| A per-address RTT cache | — | never | same |
| Packet and persistent-congestion thresholds | cq W2, N2: nothing changes | held | TC §An outage |
| Flow-control windows | window harness: a stalled client costs 180 kB; row 152 | held for Chromium (6 MiB); flips for a quinn client (row 167 item 4) | TC §Flow-control windows |
| Send window 768 KB against 10 MB | cq T12: drops 1 348 → 0, +17.8 % CPU/MB at depth 4; row 81: 3.7–4.8 MB per session | held (row 167 item 5) | [`rig-limits.md`](rig-limits.md) §What a browser receives |
| A send window tracking cwnd + 2 frames, so an ask does not wait behind the written-ahead fill | row 167's ninth item (theory): an ask waits behind 6 MiB written ahead, 0.49 s at 103 Mbit/s and 2.8 s at 18 (D), ~0.1 s with the cap | **trade-off** (row 171: ask −34 to −67 % where the credit does not bind, fill +0.7–11 %, RSS −1.5 to −4.5 MB; ASKTHENFILL proposed) | [`transport/link-conditions.md`](transport/link-conditions.md) §Re-measured, proposed |
| GSO segment cap 45 or 24 | TC §4: −16 to −21 % CPU, p99 1.9 → 27.5 ms; cq GS1: `cap24` −16 % with no tail; FASTCLOCK: 24 −14 to −21 % CPU a MB, fills and asks a tie | **adopted, 24** (the default build since 2026-10-14, row 192) | TC §4 |
| Pacing (quinn's, always on) | — (cq TAX inferred it) | never | native/quic.md §7.1, §7.6 |
| A frame's tail sent twice | row 131: dropped (one PTO, 2–8 % of p95) | held (row 167 item 8) | TC §A frame's tail sent twice |
| A PING after an isolated frame | — (row 131's third arm, never run) | **never** | TC §9 #7 |
| ACK frequency | Chromium 141 does not advertise `min_ack_delay` | owner (row 152 choice 2, native only) | [`CLIENTS.md`](CLIENTS.md) §ACK frequency, by browser |
| 0-RTT, resumption | TC §9: 0 of 216 browser dials resumed | held (browsers); owner (row 152 choice 3, native) | TC §9 |
| Payload above 1 472 B for browsers | TC §5: none in 85 k datagrams | held | TC §5 |
| MTU upper bound 1 452 → 1 472 | — | **never** | TC §9 #6 |
| Keep-alive; a wake sent ahead of an ask | cq IDL, I1: a keep-alive every 3 s saves 399 ms | keep-alive owner (ADR off until accepted); the wake never | [`adr/transport-idle-sessions.md`](adr/transport-idle-sessions.md) §The decision |
| TCP fallback, race | loopback smoke only; cq WSA | never (performance) | [`ARCHITECTURE.md`](ARCHITECTURE.md) §The TCP fallback |
| Plain HTTP/3 `fetch()` | row 128 (theory) | never | [`transport/delivery-prior-art.md`](transport/delivery-prior-art.md) §8 |
| The server's QUIC stack | rows 152, 156–158 (theory): ~1.3× sessions per core | owner (row 152 choice 4) | native/quic.md §7.5 |
| quinn 0.11.12, quinn-proto 0.11.19, quinn-udp 0.6.3 (pins 0.11.11, 0.11.18, 0.5.15) | — | never (newer releases; quinn still hard-codes the GSO cap of 10) | TC §4 |
| Certificate compression; `dns-prefetch`; an HTTPS DNS record | ARCHITECTURE: the hint and the record −1 RTT each, 7/7 | owner (ARCHITECTURE §Open) | ARCHITECTURE.md §What production adds |

## Client: downloader, decoders, checks, paint, memory

Owner: [`ARCHITECTURE.md`](ARCHITECTURE.md), [`decode/README.md`](decode/README.md),
[`adr/exactness-in-production.md`](adr/exactness-in-production.md), [`adr/frame-path.md`](adr/frame-path.md).

| lever | measured by | class | owning section |
| --- | --- | --- | --- |
| Downloader, worker and consumer state machines | rows 50, 53: fill 0.99–1.00 | held | ARCHITECTURE.md §The downloader |
| One codec-module interface; the range pass in two loops | row 49: HTJ2K ×0.79–0.88 | held (adopted) | ARCHITECTURE.md §The decoders |
| WebCodecs output into a reused buffer | row 49: ×0.91–0.96, +37 MB a worker | held (reverted) | — (see §Found on the way) |
| The range in the pack | cq 83–85: one ask −8 to −58 % | held | decode/README.md §The range in the pack |
| Dispatch: first free + 1, `perDecoder` 2 | lab dispatch bench: a short queue ends 20 % sooner | held; **never** for the value 2 and what an ask waits behind | decode/README.md §Dispatch |
| Decoder count `min(3, cores)` | downloader-cost: a third decoder wins 7/7 on 4 cores, loses on 2 | held (phones unmeasured) | ARCHITECTURE.md §Resources |
| Decode paced to the wire (`followQueue`) | row 112: fill ×0.998–1.002, CPU ×0.85–0.98, wake-ups ×0.18–0.47; one cell 12/16 | held (the flag removed by row 224; at `ba408823`) | ARCHITECTURE.md §The decoders |
| Decoders started on first need (`startOnNeed`) | row 142: fill ×0.994–1.004, CPU ×0.86–0.96, wake-ups ×0.18–0.44; two fill cells and one cold ask miss a fixed bar, no A/A arm | **premise** (net ruling) | decode/README.md §Not yet tried (P-START) |
| Zero-copy hand-off: frames packed into a heap the page keeps (P-COPY) | row 134: grey ×0.95–1.05, RGB ×0.866 at 4×, peak memory −5 to −25 MB | **premise** (net ruling: refused by a ≤ ×0.95-everywhere bar, not by a loss) | decode/README.md §Not yet tried (P-COPY) |
| Helper started after `ready` | rows 108, 113: cold ask ×1.06, ×1.19 | held | [`decode/levers-protocol.md`](decode/levers-protocol.md) §Review |
| The code-block pool for large series | rows 78, 91, 108, 113: cold ×0.89–0.94, warm ×0.72–0.76, +2.2–2.5 MB a worker | owner (row 113) | decode/README.md §Code-blocks on threads, measured |
| A coarser pool unit; stripes or region decode | rows 109, 110, 113 | held; stripes owner (row 113) | decode/README.md §A coarser hand-off unit, §Region decode |
| Tiles on k idle decoders | row 133: ×0.388–0.448 at 4× | owner (rows 133, 143) | [`adr/resolution-fitting-for-large-frames.md`](adr/resolution-fitting-for-large-frames.md) §8.5 |
| WebGPU block decoder | rows 111, 113: exact, untimed | owner (phones) | levers-protocol.md §Review |
| Warm-up decode before `ready` | lab decoder-warmup: frames 0–2 30–65 % faster; cq 85: 6–28 ms, hidden at ≥ 6.5–28 ms idle; removed (cq 114) | **premise** (link band: a 0.7 s loaded RTT hides it many times over); near a trade-off on phones (CPU) | decode/README.md §Warming the decoders |
| WASM instantiated by streaming | decode-first-frame D8: a tie | held | decode/README.md §Instantiating by streaming |
| Decoder glue as a cacheable script | — (argued 22.9 → 13.1 ms in the lab page) | never | decode/README.md §Open |
| Dispatch on the first ready decoder | — | never | decode/README.md §On a slow CPU |
| The 4 MB decoder heap | row 91: fill ×0.93–0.94, cold ask ×0.72, 157 → 22 MB | held | decode/README.md §The build, as delivered |
| Decoder reuse; copy out against keep in the heap; the wire buffer ring | decoder-memory, decode-bench: 0.81 MB; keeping 1.42–4.78×; −19.2 MB peak | held | decode/README.md §Retention, measured; §The wire buffer ring |
| A reader pause bounding the coded queue | — | **never**; its premise is stronger at row 162's rates | ARCHITECTURE.md §The downloader (Memory) |
| Worker leak on `close()`; Firefox `MessagePort` collection | worker-leak: 50 → 10–12 threads; row 144: 2/17 → 0/14 lost | held (fixed) | ARCHITECTURE.md §Closing a client |
| No frame lost silently; the per-ask deadline under loss | rows 145, 147: ack cost 0.985–1.022; row 76: 0 asks failed | held | ARCHITECTURE.md §The downloader |
| XXH3-64 against SHA-256 and BLAKE3 | rows 73, 88, 122 | premise (owner rule, 2026-10-12: XXH3-64) | exactness ADR §7 |
| The check's cost; the second-decode ladder | rows 88, 145, 151: 0.15 / 2.8 / 8 ms, 4–12 % of an HTJ2K decode | held (the cost of the check, which stays) | exactness ADR §9 |
| A faster hash: in the decoder heap, SIMD128, no copy | — | **never** | exactness ADR §9 |
| A fresh dav1d instance as AV1's second path | rows 123, 145: proposed, not measured | never | exactness ADR §8 |
| Block or mark; reporting | row 123 | owner (row 123) | exactness ADR §8 |
| Frame path B′ (the page out of the pixel path); OPFS cache; a phone's window budget | row 148 (theory); row 151 | owner (row 148 choices 1–5) | frame-path.md §4, §6–§8 |
| Coalescing decoded frames across decoders | downloader-cost: 2 a message 0.385 → 0.212 ms at 4× | owner (cq §Open) | ARCHITECTURE.md §The hand-off |
| A thread hop; the downloader worker | thread-hops, decode-tail: nothing to remove | held | ARCHITECTURE.md §What a thread hop costs |
| Cancelling queued decodes out of band | — | never (conditional on a phone) | ARCHITECTURE.md §Open |
| `readMin`, a 16 KB BYOB read | cq 94, 101: CPU −97 to −105 ms a fill, peak −37 MB, fill a tie; a cut-stream defect | owner (cq §Open); its liveness premise (< 44 kbit/s) weaker at row 162's rates | CLIENTS.md §Reading a frame whole |
| WASM transport client against TS | both clients: fill 120 against 125 ms | held (TS the default) | CLIENTS.md §The implementations |
| Receive CPU per client stack | row 135: Chromium 6.4–12.4 ms/MB | premise (link band: ~8–16 % of a desktop core at 103 Mbit/s) | native/quic.md §6 |
| The browser's ask window depth | removed for pushed fills, its win never measured | never | [`adr/client-window-depth.md`](adr/client-window-depth.md) §Which depth ships — open |
| Stride | ADR accepted, not built | never | [`adr/stride-is-bandwidth-conservation.md`](adr/stride-is-bandwidth-conservation.md) §Follow-up actions |
| The fill inside `start` | fill-at-start: first frame 486 → 335 ms under a blocked page | held | ARCHITECTURE.md §The first fill |
| Asks first, centre-out | rows 65, 120: 0.30–0.77 | held (row 167 item 8) | ARCHITECTURE.md §The first fill |
| The level picture first | row 59: first view ×0.09–0.69 at 5–50 Mbit/s | owner (row 143 choice 4); weaker at row 162's rates | resolution-fitting ADR §7 |
| Page-open preloads, the inlined URL, the page-carried worker graph | cq 87–109: −1.0 to −1.24 round trips each | owner (cq §Open) | ARCHITECTURE.md §The session open |
| dav1d fetched at decoder start | row 79: −1.0 / −3.0 round trips | owner (§Blocked, row 79: the ≤ 10-bit skip) | [`page-open`](../lab/page-open/README.md) §Cold round trips by codec |
| The paint route, gl against 2d | paint-floor: 0.34 against 7.55 ms | held | ARCHITECTURE.md §Paint |
| The painter on a real GPU | row 87: SwiftShader only | never | [`client/paint`](../client/paint/README.md) §What it costs |
| What reaches the screen after the window | row 169 (theory): 8 bits after the window, no presentation LUT or ICC handling; gaps G1–G6 | never (its protocol proposed) | [`display.md`](display.md) §The gaps, each change, and whether it is net |

## Ingest

Owner: [`ingest/design.md`](ingest/design.md), [`FIXTURES.md`](FIXTURES.md) §From DICOM,
[`coded-frame`](../lab/av1/exact/coded-frame/README.md) §One pipeline.

| lever | measured by | class | owning section |
| --- | --- | --- | --- |
| One pipeline with the check in process | row 52: HTJ2K CPU −21 to −27 %, 69/69 identical | held | coded-frame §One pipeline |
| Frames in parallel (`--jobs`) | row 52: 4 workers 3.5–3.9× | held | same |
| One aomenc run per frame | row 71: +12–13 % CPU, 0 bytes (provisional, row 94) | held | same |
| Several series at once | row 89: mammogram ×2.52 serial → ×0.65 | held; not in the Rust ingest | FIXTURES.md §From DICOM |
| The compiled ingest's CPU | row 126 predicts 0.4–0.6 of Python's; row 136: the non-encoder share 57–85 %; row 155 built it, byte-identical, untimed | **never** (the CPU claim) | FIXTURES.md §A compiled ingest at the site — the plan |
| SHA-256 → XXH3-64 | row 136: hashing 16–41 % of HTJ2K CPU | premise (owner rule, 2026-10-12); built in row 155 | design.md §6 |
| No temporary files, no process a frame | row 136: 11–24 % | built (row 155), untimed | FIXTURES.md plan |
| The parser's hand-off: files, pipe, library | row 126 predicts < 5 % | never | design.md §3 |
| Where frames are coded | row 153 (theory): raw + zstd ≈ 1.0–1.8× HTJ2K's bytes, from outside sources | owner (row 153 choice 3) | design.md §2 |
| Metadata compression | row 153 (theory) | owner (row 153 choice 9) | design.md §7 |
| Streaming the pack; coding on arrival | row 163 (theory): saves ≤ min(coding, sending) | never (blocked by the index-first writer) | design.md §11.6 |
| `from-parser` holds every coded frame to the end | — | never | FIXTURES.md plan |
| The site link: TCP or QUIC; the upload's shape | row 154 (theory) | TCP closed by owner rule (2026-10-11); the shape owner | [`ingest/link.md`](ingest/link.md) §9 |
| When a series is complete | rows 153, 163 | owner (row 153 choice 1) | design.md §4 |

## The gate and tooling

| lever | measured by | class | owning section |
| --- | --- | --- | --- |
| Timer-bound steps side by side | row 54: 161 → 106 s | held | none on this branch (§Found on the way) |
| Hand-made mutants | row 54: 140/151 killed | held | same |
| The skip recap, stale-build guards | rows 86, 118 | held | [`deploy/README.md`](../deploy/README.md) §The checks |
| rustfmt and clippy | row 114 | owner (after the owner merges main) | the queue's row 114 |
| A JS/TS formatter; shellcheck | rows 83, 86: "a style decision first" | never | — |
| Wider gate parallelism; a shared build cache | row 118 gives the step times (server tests 77 + 30 + 22 s in series) | never | `scripts/gate.sh` |
| Automated mutation (cargo-mutants); a CI runner | — | never | — |
| `fetch_data.sh` pinned whole | row 160's side finding; row 170 pinned `typing-extensions` with its hash | held | `lab/av1/requirements.txt` |

## Proposed rows, ranked by expected net gain

Each is a theory row: a name and one question, for the orchestrator to queue (ORCHESTRATE.md §2, beside the queue on
`claude/av1-mainbase`). The gain is the expected one and its basis; none is measured. Ahead of every line below, by size, stand
proposals already written in their owning docs and not repeated: row 167's **ASKAHEAD** (an ask's wait behind the
written-ahead fill, 0.49 s → ~0.1 s at 103 Mbit/s, (D)), **IWDEEP**, **FASTCLOCK** and **B4FAST**
([`transport/link-conditions.md`](transport/link-conditions.md) §Re-measured, proposed), and row 168's measuring
row for the writer (hits and fill −24–32 %, [`disk-layout/README.md`](disk-layout/README.md) §The writer).

1. **HASHFAST** — how fast can XXH3-64 over the handed-on samples run in the decoder worker with no copy (SIMD128,
   in the decoder's heap), and is it any faster than today's ~3.3 GB/s? *Basis:* the check is 4–12 % of every
   HTJ2K frame and ask (row 151: 8 ms on a 69 ms mammogram); the digest is over the same bytes, so exactness is
   unchanged. Whether the shipped hasher copies into its own heap is not verified.
2. **COPYNET** — is P-COPY's shared-heap pack net on every set when judged against an A/A arm's spread rather than
   a fixed ≤ ×0.95 bar? *Basis:* row 134: memory −5 to −25 MB, RGB ×0.866 at 4×, grey a tie.
3. **PGOSHIP** — does the deploy image built through `scripts/pgo_build.sh` keep −13 to −20 % server CPU per MB on
   fills paced at 103 Mbit/s, with no cell worse? *Basis:* TC §4; at row 162's rates server CPU sets fills per core
   (~31 a core at 103 Mbit/s against ~160 at 20, D from row 81). *Measured 2026-10-22, on `feeb162`'s build through
   the script, not the image:* **held** — CPU per MB ×0.867 at 103 Mbit/s and ×0.873 at 18, A/A ×0.989 and ×0.994,
   better in both halves of 24 interleaved rounds, the server on 2 of 4 vCPUs and never past 0.16 of a core
   ([`lab/pgo-relay/`](../lab/pgo-relay/README.md)). One paced fill cost ~0.13 core, ~4× the derived share; whether
   that adds up across fills is SCALECORE's.
4. **STARTAA** — does `startOnNeed` stay inside an A/A arm's spread on every fill and cold ask at 100 and 300 Mbit/s
   and a 0.7 s loaded RTT? *Basis:* row 142: decoder CPU −4 to −14 % and wake-ups −56 to −82 % in every cell; the
   misses were against a fixed bar with no A/A arm; an unused decoder is ~6 MB resident.
5. **ASKBEHIND** — at the measured rates, what does an ask wait behind in a decoder's queue, and does ask-aware
   dispatch (the decoder with least work left, or a slot held free) cut it with the fill unchanged? *Basis:* an ask
   can queue behind `perDecoder − 1` frames, up to ~280 ms at 4× on large frames; at ~100 Mbit/s decode is the
   clock more often. Distinct from row 167's ninth item, which is the ask behind the wire's queue.
6. **READERPAUSE** — at 100–300 Mbit/s, how large does the coded queue grow on large series, and does a reader pause
   bound it with fill and ask unchanged? *Basis:* a 250 KB frame is ~19 ms on the wire at 103 Mbit/s against 55–70 ms
   of desktop decode; the queue then grows with the series, on a phone's memory.
7. **INITIALREPLY** — does answering a client's repeated Initial with the unacknowledged server flight cut a lost
   first flight's wait, with no spurious datagram on clean or slow links? *Basis:* row 139 measured +700 ms to
   ready on a lost first flight; the reply is clocked by the client's own PTO, so it sends nothing unless a flight is
   lost. Row 139's own rule asked for it.
8. **ASKORDER** — at loaded RTTs of 0.2–0.8 s, does `reject-server-ordering.md`'s flip condition (RTT above ~100 ms)
   now hold, and what would last-ask-first save over FIFO? *Basis:* the ADR's own §6.
9. **TAILPING** — does one ack-eliciting PING after an isolated frame cut an ask's p99 by PTO − 9/8·RTT for 21–41 B a
   frame? *Basis:* under a loaded queue the variance term grows the saving (20–80 ms derived at the lab links);
   the third arm row 131 proposed and never ran; row 167 item 8 keeps the tail copy dropped. Mechanism, saving and protocol: `transport/transport-conclusions.md` §9 item 7.
10. **INLINECAP** — what does the whole-frame inline `RWF_NOWAIT` copy cost co-tenant tasks at 2.8–16 MB frames, and
    does sending frames above a size to the pool remove it at no fill cost? *Basis:* a 4.0 ms gap at 250 kB (RP); a
    pool hop is 24–34 µs.
11. **DEPLOYLIMITS** — do `memlock` and `nofile` limits in `deploy/compose.yml` and a `check-fastpath` health check stop
    the silent fall to the pool? *Basis:* ~940 rings by default; the refused fast path costs 132.5 against 48.4 µs a
    frame.
12. **MTU1472** — with an upper bound of 1 472 for IPv4 peers that allow it, are server and browser CPU per MB ~1.4 %
    lower with no black-hole regression?
13. **RELEASEBUMP** — what do quinn 0.11.12, quinn-proto 0.11.19, quinn-udp 0.6.3 and io-uring 0.7.15 change for the
    carried patches and the GSO cap, and is each bump a tie or better on `runtime_ab.sh`?
14. **SCALECORE** — do fills per server scale with cores (2 to 8) at 103 Mbit/s pacing, and where does the host
    saturate? A measurement the others' claims need, not a lever.
15. **RUSTINGESTCPU** — is the compiled ingest 0.4–0.6 of the Python ingest's CPU a frame, as row 126 predicted?
16. **STREAMWRITE** — can `from-parser` write frames as they are coded, seeking back for the index, bounding its
    memory to `jobs` frames? *Basis:* today it holds the whole series.
17. **PUBLISHSYNC** — what does `.partial` → fsync → rename add to a pack on ext4 or XFS? Durability at code cost,
    net if inside the spread of a 10–20 ms pack.
18. **READMINFIX** — can `readMin` name a cut queued before the read, and does 16 KB then hold every dispatch clause?
    Fixing the defect is net; it unblocks a −97 ms CPU, −37 MB a fill default for the owner.
19. **GATEPAR** — how much faster is the gate, warm and cold, with the three server test builds and the browser
    steps run concurrently? Tooling; row 118's step times suggest ~106 → ~60 s.
20. Small, each one question: **FIRSTREADY** (does dispatching to the first ready decoder ever move frame 0 or a cold
    ask?), **GLUECACHE** (does a cacheable glue script cut a second visit's time to ready?), **ONECOPY** (can one of
    the two metadata copies go?). And to ASKAHEAD's protocol, an arm: HyStart's queue cut (cq W4b: 239–454 ms less
    standing queue).

## Trade-offs, for the owner

Not proposed as net; each trades one measure for another.

| lever | gains | costs |
| --- | --- | --- |
| BBR as the default | 0.04–0.76 of the fill under loss | +2–13 % clean; queue; a neighbour's share |
| GSO cap 45 or 24 (*24 adopted, 2026-10-14*) | −16 to −21 % server CPU | the depth-1 tail on clients without a large receive buffer |
| 32-packet initial window | −28 to −33 % first ask | +11.8 % on a 10-packet queue |
| Send window 768 KB | 0 drops, less memory | +17.8 % CPU per MB |
| `MALLOC_MMAP_THRESHOLD_` 1 MiB | −46 to −57 % RSS at rest | up to +5 % CPU |
| A byte-capped pool | −32 % RSS | +8.4 % CPU |
| A frame cache | −20 % CPU at high reuse | +4 % with none; RAM |
| Per-core endpoints | −39 to −64 % CPU | rebinds kill sessions |
| LTO fat (landed) | −4 to −8 % CPU | +7 % p50 at 32 KB, depth 1 |
| A keep-alive under the radio's idle timer | −399 ms on an ask after idle | energy, bytes |
| The warm-up decode | first frame 4.5–24 ms sooner | 6–28 decoder-ms of CPU on every open |
| The code-block pool | warm ask ×0.72 | +2.2 MB a worker, cold ×1.16 on `g512` |
| Tiles, layout 1 | ask ×0.39–0.45 | a format change, +0.12 % bytes |
| The level picture first | first view ×0.09–0.69 at 5–50 Mbit/s | less at row 162's rates |
| Overlap the check with paint | 4–12 % off an ask | breaks "checked before handed on" |
| Coalescing frames across decoders | ~10 ms of main thread | a merge point |
| Frame path B′ | the busy-page win | one more thread |
| Decoded samples in OPFS | no decode on reopen | disk at the lossless ratio |
| A coded hash checked on read | integrity at rest | server CPU (unmeasured) |
| Coding at the site against the cloud | ~1.4× fewer link bytes | site CPU |
| Streaming the pack | ≤ min(coding, sending) | a format change, late failures |
| Ahead-N `WILLNEED` for tiles | strided 4.6–4.9× | a loss on sweeps |
| A server stack change | ~1.3× sessions per core | a WebTransport layer, 927 lines of controllers |
| A TCP race | networks that block UDP | a connection per open |
| Certificate compression | −1 RTT on RSA chains | +1.29 MiB binary |
| rustfmt, clippy | one style | a 1 324-line churn |

## Found on the way

Not corrected here (an audit edits only its deliverable); each for the session that owns the doc.

* **Not corrected for row 162's band:** [`rig-limits.md`](rig-limits.md) §1 still says 768 KB "never binds" on the
  target link; [`native/quic.md`](native/quic.md) §7 still states 5–50 Mbit/s and "0.4–0.7 % of a core". Row 167
  re-derived both in link-conditions.md; neither doc is corrected in place.
* **Dangling owners:** rows 54 and 86 cite `README.md` §What the gate costs and what it catches, which is not on this
  branch; row 49 cites [`decode/README.md`](decode/README.md) §The decoder worker's hand-off, also missing, and its
  numbers (the WebCodecs buffer reuse, +37 MB a worker) are in no doc. Rows 52 and 71's owner, once in ingest's coded-frames README (removed), is now [`coded-frame`](../lab/av1/exact/coded-frame/README.md). `CLAUDE.md`'s
  pointer to [`adr/disk-access.md`](adr/disk-access.md) resolves (*corrected 2026-10-17*: this line said it named
  docs/disk-access/adr.md).
* **Stale in place:** [`ARCHITECTURE.md`](ARCHITECTURE.md) §Open says a pool that follows the queue "is not built"
  (rows 112, 142 built it as a lab flag) and lists one shared store per fill as not run (row 134's P-COPY measured a
  close relative).
* **A coded-bytes digest** is open in [`ingest/README.md`](ingest/README.md) §4 and §Blocked (row 123 (2)), but in
  the agreed draft of [`disk-layout/target.md`](disk-layout/target.md) §The two hashes.
* **The owner's calls not in §Blocked:** the GSO cap (*decided since: 24, row 192*), the initial window, `MALLOC_MMAP_THRESHOLD_` and the keep-alive
  ADR are each named the owner's call in their docs only. **P0** (ring against pool on the production host,
  [`adr/disk-access.md`](adr/disk-access.md) §9 #1) has no row and no §Blocked line.
* **cq 78 against row 78:** [`adr/stream-shape.md`](adr/stream-shape.md) cites HOL1 as "queue row 78", the closed
  queue's; the AV1 queue's row 78 is HTJ2KMT. Row 139's rule leaves a "review's call" with no review row.
