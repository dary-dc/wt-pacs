# Cloud queue

A place to hand work to a cloud agent between sessions, and for it to hand results back.
`cloud-lanes-2026-09-14.md` holds the briefs; this holds the order and the state.

## Protocol

**Since 2026-09-23 the queue lives on `claude/unified-2026-09-23`**, the one branch that carries every
lab improvement: the tested state of 2026-09-22, the lane branches, the transport branch's server half
(the pooled send path as default; the send-size cap patch of quinn opt-in, its p99 regression
reproduced), and the wtransport patch that sends the server's SETTINGS with its first flight
([`proposal-session-open.md`](proposal-session-open.md) §Lever 2: the dial 3.1 → 2.1 round trips).
The inventory of what was merged and what was not is [`improvements/ledger.md`](improvements/ledger.md)
§10. **Work the `ready` rows (73–76) top to bottom — the table is in priority order, not number order.** Several agents may work the queue at once; the claim commit is the lock.

**New session?** [`handoff-2026-09-19.md`](handoff-2026-09-19.md) has where the branch is, what is
already settled, what the instruments are and what cost time to find — read it once, then work the
queue from here. **Rows 42–52 were queued 2026-09-19** from a second identification sweep; the
workstation ran several the same day on local branches that are not merged here yet — a row that
says so is not to be taken until it is. Every older row is `done` except row 40, which the owner holds.

**You are the cloud agent.** After you finish a lane and push:

1. `git fetch && git rebase origin/claude/unified-2026-09-23` — the queue changes while you work.
2. Read the table below. Take the **topmost row marked `ready`**.
3. Edit that row to `claimed` with the date, commit it alone, push it. That is the lock; if the
   push is rejected someone took it first, so rebase and take the next one.
4. Do the lane. Push your work.
5. Set the row to `done` with the commit, and **add anything you learned that changes another
   row** — a lane that is now pointless, a prerequisite that turned out missing. Push.
6. Go back to step 1. Stop when no row is `ready`, and say so in your final message rather than
   inventing work.

**Rows that wait.** `after N` becomes `ready` when row N is done; the agent that marks N done
flips it in the same commit.

**Code rows (the D rows)** follow `docs/proposal-downloader.md`. **Changed 2026-09-18:** they used
to push to the agent's own branch, never to this one, and `claude/downloader-s2-worker` carried D1
through F1. That branch is merged here and is no longer where the work goes — the downloader lives
beside today's path in this branch, and a D row is worked here like any other. If the design turns
out wrong, stop and say why in `## Blocked` rather than building a different shape.

**The merge is not an adoption.** Nothing today's path does has been removed, and the two items
§Rows 23–26 lists as owed before it could be — a refused fill never reaching the consumer (D1r's
hole), and a signed study run through the downloader rather than the decoder alone — are still
owed. Adoption remains the workstation's call.

**Answering a question rather than running a lane.** A row may be a question, not a lane. Answer it
in `## Answers` below, push, mark it done. Keep it short — the asker has no other channel.

**Asking for something.** If a lane is blocked on a decision only the workstation can make, add a
row to `## Blocked` saying what you need, push, and move to the next `ready` row. Do not wait.

**A commit message holds the change and nothing else** — no attribution, co-author or session
trailers. This is the owner's rule for every repository.

## Queue

| # | what | brief | state |
| --- | --- | --- | --- |
| 60 | **LK1** — a closed downloader client leaves its worker running | queue §Rows 60–64 | **done** 2026-09-24 `91ecaf7` — the leak was **one renderer thread and 2.5 MB resident per closed client** (40 clients: 10 → 50 threads, 106 → 206 MB, three interleaved rounds identical, driverless). The decoders did *not* leak — the downloader terminated them. `close()` now terminates the downloader on `closed`, or at a 1 s deadline if it is wedged (its asks named then, not at 15 s); **the downloader no longer terminates its decoders** — doing both stranded 10–12 of 40 downloader workers as targets Chromium never reclaimed, script dead, thread and memory held. Two dispatch clauses (84/84) and an end-of-page worker count in `drive_downloader.cjs` (0 left on every page; the pre-fix client leaves 18); three mutants caught every run, the stranding mutant one run of two (it is a race — `lab/worker-leak/run.mjs --driver playwright` shows it reliably). `proposal-downloader.md` §Closing a client. **For row 65:** the conformance fakes now answer a liveness ping on `<ch>-alive`, which counts live workers from the page |
| 65 | **WM1** — a message posted before the other side listens, in production code | queue §Rows 65–72 | **done** 2026-09-24 `d5261a1` — **every production site is safe, nothing fixed.** Five sites (consumer → downloader `start`/`dial`, downloader → decoder `init` and first `decode`, decoder → consumer on the pixel port, the workers' replies, the harness's `session-worker.js`); each is queued by the platform — a worker's implicit port until its script has run, a `MessagePort` until `onmessage` starts it — and **no product code uses a `BroadcastChannel`**. Driverless Chromium 141, 5 × 1 000 opens an arm, rotated: downloader path **0/5 000**, harness worker **0/5 000**, the `BroadcastChannel` control **103/5 000**. Three exposed mutants caught (pixel port via `addEventListener` 100/100; either worker's `onmessage` set 50 ms late 20/20); a top-level `await` did *not* expose a worker on Chromium. The pixel port's `onmessage` is load-bearing and now says so. `proposal-downloader.md` §Messages posted before anyone listens · `lab/early-messages/` |
| 61 | **FF1** — a blink that swallows the server's first flight, after lever 2 | queue §Rows 60–64 | **done** 2026-09-24 `524a459` — **built, on by default: the phase is now a round trip *ahead* of unpatched.** Traced: quinn ignores the client's repeated Initials (Chrome sends four before +1 s), its own probe at +1.001 s repeats only the ServerHello, the Handshake flight waits a round trip on that ACK, and lever 2's lost SETTINGS wait another on HANDSHAKE_DONE's. `patches/quinn-proto-0.11.18-probe-every-space.patch` (8 lines) probes every space in flight during a server's handshake; swallowed first flight, 7/7 both clients at 40 and 80 ms — Chrome at 80: unpatched 1 332, lever 2 1 414, **lever 2 + this 1 249**; clean dials, every other blink offset and 1 % loss unchanged. Carried by one generalised `scripts/patch_crate.sh` (replaces `patch_wtransport.sh`); `link_impair.py` gains `swallow`; test `a_lost_first_flight_is_repeated_whole`, two mutants caught. **Not the whole phase:** `--initial-rtt-ms 100` is −700 ms for every server here (430 / 550 ms with both), and answering a repeated Initial (RFC 9002 §6.2.3) would reach it without guessing a round trip — neither changed. Re-queueing the stream data with the probe stalled the session, cause not found, not built. **Also corrected:** `link_impair_check.sh` still wanted R1's 4 round trips to first byte, and failed on lever 2's 3. **For row 64:** the blink phase the draft owes is removed on our side by a quinn-proto patch, which an upstream reader of the wtransport patch would also need. **For row 71:** every client tried meets both patches now. `proposal-session-open.md` §The losing phase, removed |
| 66 | **LV1** — detection by the bytes, and two defects found on another client | queue §Rows 65–72 | **done** 2026-09-24 `bbb645c` — **adopted: the bytes, and the probe is gone.** The probe **livelocked on a slow link** — a frame slower than `stallMs` started a probe that ended the fill and could not arrive in `probeMs`, so it re-dialled for ever: **0 of 7 fills completed** at 700 kbit and behind a 4 s queue, against 7/7 by the bytes (41.4 s; 52.9 s with one re-dial each, as on the rig). The cut is noticed at **3 016 ms against 5 006**; blinks tie with no false alarm; on the radio relay bytes re-dials a healthy session in 3 fills of 7 and completes all, the probe in 2 and **once never completes** *(re-taken on an idle box after row 68's finding; every verdict held)*. Both transports stamp `stats().lastByteAt`. **Defect (a), a replaced session left open: not here** — 205 replaced sessions ended on the client's close, none by idle timeout; a clause now holds it. **Defect (b), a deadline from the ask: here, in three places** (both transports' waiter, the consumer's 15 s timer) — six asks on the slow link failed 4 at 15.0 s, 7/7; now timed from the last byte (the consumer keeps none) and 6/6 land in 31.2 s. Clauses rewritten and added across TS, WASM and the downloader, six mutants caught. **Also found and fixed:** row 61's test raced the client's own Initial retransmit under the gate's load (1 in 4; `4cbd190`), and that ordering is untraced. `proposal-session-survival.md` §Detection by the bytes · `lab/session-survival/cells.sh`. **For row 67:** `cells.sh` is a Chrome + relay + downloader + real-server harness with a radio cell already defined; it needs a server-flag knob for the controller |
| 67 | **CC1** — the congestion controller on a lossy radio link, priced in a browser | queue §Rows 65–72 | **done** 2026-09-24 `360099d` — **neither as they stand; Cubic stays, nothing changed.** Chromium, the downloader through the relay at 20 Mbit / 80 ms, 7 rounds interleaved: under 1 % / 3 % loss BBR fills **12× / 19× faster** (3.8 / 3.9 s against 45.1 / 75.5 s) and a fresh ask **1.3–6.2× sooner**; on the radio relay 3.9 against 6.4 s *(re-taken on an idle box after row 68 found the first run shared the CPU with four runaway servers; every verdict held)*. The price is the queue both ways: **~45–48 % of BBR's datagrams overflow a 120 ms queue** (it sends ~2× the fill's bytes), and a 900 ms queue stands **294 ms** instead; with one blink and no loss it is 7.8 % slower (0/7). The restart ties Cubic everywhere lossy and loses the blink cell. **Read and refuted:** quinn's pacer ignores BBR's own pacing rate (2.5× the bottleneck with its 2×BDP window) — pacing it at its own rate overflowed as much (57.6 against 47.8 %). What would change the default is a loss- and inflight-bounded BBR (v2/v3), which quinn lacks. `transport/transport-conclusions.md` §1 · `lab/scripts/controller_browser_cells.sh` |
| 68 | **DC1** — the decode tail: ~360 ms of decoding after a colour fill's last byte | queue §Rows 65–72 | **done** 2026-09-24 `81d97cf` — **throughput, not scheduling; nothing changed.** The container reads the rig's shape: colour wire 401 ms, last decoded 666, **tail 274 ms**; three decoders need 638 ms each at 17.8 ms a frame, busy **95 %** while bytes arrive, 1.6 % of the work lost to hand-offs; 16-bit has no tail (10 ms). The shipped package has SIMD128, no relaxed SIMD — and `-mrelaxed-simd` builds a byte-identical binary. From source (emscripten 3.1.74) decodes **8–11 % faster** than the package in Node (7/8–8/8, ranges touching); in the browser the fill does not separate (661 vs 682 ms, 4/7) on a host the fill saturates. Order and early start cannot shorten a throughput-bound finish; reusing the pixel buffer ties. The downloader now stamps the decoder a frame went to. `decode/README.md` §The decode tail · `lab/decode-tail/`. **For rows 66 and 67:** four runaway `probe-c` servers from row 61's variant C (its stall is a busy loop) held all four cores from 05:16 to 09:03 — every measurement of rows 66 and 67 ran under that load; both are re-taken on an idle box (`32c94ef`, `0dca90b`) and every verdict held; the cell scripts now clean up on `timeout` (`eabd082`) |
| 69 | **HP1** — a frame's latency during a fill, downloader arm vs direct | queue §Rows 65–72 | **done** 2026-09-24 `8d6873d` — **the rig's gap does not reproduce here; nothing removed.** `lab/decode-tail/direct.js` drives the same decoders from the page with the same transport, so the downloader is the only difference. Per-frame interval, 7 rounds: one decoder colour 16.84 against 16.98 ms (tie) and 16-bit 6.92 against 6.63 (+0.29 ms, 6/7 — inside the decode stamp, i.e. contention with the downloader thread, not a hop); three decoders colour **5.55 against 6.26** (the downloader ahead) and 16-bit a tie. The downloader's loop hands a frame to a decoder in **0.04 ms** against 1.04 ms on the page; decoder → page is 0.17–0.35 ms either way. The rig's +1.2 / +4.7 ms is in what differs there — its transport, or what its page client skips per frame. `thread-hops.md` §The downloader arm during a fill, against direct |
| 70 | **GS1** — why the send-size cap patch loses p99 at depth 1 | queue §Rows 65–72 | **done** 2026-09-24 `e8b803a` — **the rig client's receive queue, not the patch; a ceiling of 24 keeps two thirds of the win with no tail seen.** quinn's client sets `UDP_GRO`, so each GSO send lands as one buffer, and a full 212 KB queue drops a whole batch (server lost ≈ drops × datagrams per send). When that batch is the frame's last, nothing follows and the frame waits the PTO: the capture shows 14 quiet gaps of 26.3 ms for `gso` and none for any other arm. Twenty frame sizes at depth 1, 4 sessions: `gso` tails at 12 of them, the ceiling at 16 at one, quinn's own 10 at one (240 KB), the ceiling at 24 at none. A 1 MiB buffer removes every drop and tail, and `gso` keeps −11 to −19 % CPU per ask. Chromium sets 1 MiB and no GRO (strace). The ceiling at 24, where the two server cores saturate: +10 % asks/s and −9 % CPU per ask at 250 KB depth 4, against `gso`'s +13 % and −13 %; +24 % asks/s and −21 % CPU on the fill. The opt-in stands; ship 24, or keep 45 behind the product's buffer — the owner's call. `why-these-changes.md` §10 entry 3, §9 corrected in place |
| 62 | **RS1** — a re-dial with TLS resumption or 0-RTT | queue §Rows 60–64 | **done** 2026-09-24 `90de689` — **Chrome never resumes a WebTransport session, so nothing changes in the server.** The server already resumes: rustls issues 2 stateful tickets per handshake from a 256-entry in-memory cache; `max_early_data_size` is 0. The native client resumes 21/21, read from the decrypted ServerHello (`lab/scripts/client_hello.py`). That buys no round trip: ready 85.2 against 85.0 ms at 40, 165.8 against 165.3 at 80, n = 7. Chromium 141 offered a PSK on none of 216 dials: fresh context, same page, new page; `serverCertificateHashes` and a CA-signed certificate; a hostname; a server that takes early data. Ready 2.1 round trips in every case. 0-RTT would need wtransport to accept a session before its handshake completes, and a browser that sends it. Safe if it came, since everything the client sends is a read. For row 72: `link_impair.py` forwards to the last client it heard, so a dial made while the previous connection still sends pays a ~1 s handshake probe timeout (`rig-limits.md` §3). `proposal-session-survival.md` §Resumption and 0-RTT |
| 63 | **PT1** — one probe retransmission ~400 ms after every session opens | queue §Rows 60–64 | **done** 2026-09-24 `99a603d` — **spurious; quinn withholds the ACK of the ask while its congestion window is full. Costs one 65-byte packet; not fixed here.** From Chrome's net log (`lab/scripts/netlog_pto.py`): the client sends the control stream's header and the ask 2 ms apart. The server's first frame packet acks the header only; the rest of the initial window leaves with no ACK. quinn-proto 0.11.18 `poll_transmit` then skips the Data space, and the owed ACK with it, until the client's ACKs reopen the window a round trip later. Chrome's probe fires first (~146 ms against ~163 ms at 80 ms), and the original is then acknowledged. Proved by moving the window: at 80 ms, 7/8 sessions probe with the default window and 0/8 with `--initial-window-bytes 1000000`. At 40 ms, 0/8 each. No congestion reaction; the first frame is not delayed. The fix belongs upstream in quinn (ACK-only packets when congestion-blocked, RFC 9000 §13.2.1), not in a small patch here — a second upstream item beside row 64's. `proposal-session-open.md` §The probe after the open |
| 71 | **WP1** — lever 2 against every other client we can run | queue §Rows 65–72 | **done** 2026-09-24 `8c6c364` — **every client connects and takes the lever; a client that ignores 0.5-RTT data still works, and pays one round trip over no lever.** Tried: aioquic 1.3.0, webtransport-go v0.9.0, quic-go v0.53.0's HTTP/3 client, h3 0.0.8 on quinn, and the native client. Each ran against both patches and against `[patch.crates-io]` removed, at 40 ms, 5 rounds rotated. Session ready or SETTINGS came about 1 round trip sooner (native 2.12 against 3.18; webtransport-go 2.17 against 3.21; aioquic 2.45 against 3.48; quic-go SETTINGS 1.13 against 2.20). `lab/scripts/half_rtt_deaf.py` makes any client deaf to 0.5-RTT data: ready at 4.2–4.5 round trips, against ~3.2 with the lever off. None of the clients is deaf on its own. Not lever-related: a GET gets a bare FIN from wtransport (quic-go EOF, h3 `H3_FRAME_UNEXPECTED`), and webtransport-go ≥ v0.13 wants reset-stream-at. Not run: Firefox (Mozilla downloads refused by the network policy) and `curl --http3` (distro curl has no HTTP/3; static builds refused). For row 64: the draft can cite the four clients and the deaf-client cost. `proposal-session-open.md` §Other clients |
| 72 | **PO1** — the page's first frame on a shaped link, end to end, with lever 2 | queue §Rows 65–72 | **done** 2026-09-24 `e7211d6` — **yes, the dial is on the first picture's path, and lever 2 takes its round trip off it in every cell.** nginx over TLS, HTTP/1.1 and HTTP/2 alternated, lever on/off interleaved, 7 rounds at 40 and 80 ms, cold and warm. Cold over HTTP/2: first frame 12.65 round trips with the lever against 14.35 without (1 226 against 1 312 ms at 80). Of those: TCP + TLS + HTML 3.0, scripts 0.45, config 0.9, dial 1.85 (3.0 off), the frame's slow start 6.5. Dial −39 to −86 ms, 7/7 in all eight cells; first frame −18 to −83 ms, 6–7/7. HTTP/2 buys the config's round trip (2.15 round trips on HTTP/1.1, cold). Two findings. First, the page's `fetch()` of the config does not take its `preload as=fetch` and revalidates on the wire: an unclaimed lever of one round trip. Second, HOST mode used `--ignore-certificate-errors`, and Chrome caches nothing from a certificate error, so every worker script was refetched on the path. It now trusts the certificate through an NSS store; the first run, which had the artefact, is corrected in place before publishing. `lab/page-open/README.md` §The first frame on a real host |
| 64 | **UP1** — lever 2 written up for upstream, not posted | queue §Rows 60–64 | **done** 2026-09-24 `771fce3` — **drafted in `docs/transport/upstream-wtransport-settings.md`; nothing posted.** It holds three pieces. (1) A wtransport issue: the behaviour, RFC 9114 §6.2.1, the dial 3.1 → 2.1 round trips across Chrome, the native client, webtransport-go and aioquic, and the page end to end (row 72). (2) A PR description carrying the patch as this branch does, its unchanged API contract, and its test. (3) The quinn-proto probe-every-space companion as a separate quinn issue, with the losing phase row 61 measured (1 414 → 1 249 ms in Chrome at 80). The row 63 ACK finding is noted there as a separate quinn item. Before posting: re-check for an existing issue and rebase onto the release current then (#324 touches the same function). |
| 74 | **DT1** — the decode tail: what makes one frame's decode cheaper, on a throttled CPU | queue §Rows 73–76 | **done** 2026-09-25 `ecb31e6` — **Chromium's CPU throttle never slowed a decoder**: Chrome 141 refuses `Emulation.setCPUThrottlingRate` on a worker target, and a loop in a worker runs as fast at 4× as at 1×. `lab/scripts/cpu_throttle.mjs` caps every browser thread in its own cgroup instead (a loop: 4.1× / 6.3× on the page and in a worker); a burst of ~1 ms outruns it, so sub-millisecond hops are not throttled numbers. Package, colour at 1× / 4× / 6×: wire 373 / 1 325 / 1 995 ms, all decoded 707 / 2 626 / 3 757, **tail 357 / 1 336 / 1 783**, one ask 25 / 86 / 127 ms; 16-bit is wire-bound at 4–6× (tail 27–36 ms) — the browser's own receive path slows with the throttle. (a) Both source builds byte-identical; **no build separates on an ask**; the 4 MB build's colour fill is 7/7 sooner at 4–6× (−7.5 / −5.3 %) but so is its range pass, identical JS, so it is not claimed as a faster decoder. (b) The seam is `subband::pull_line`'s serial loop over a row of code-blocks; block decoding is 70 % (colour) / 76 % (16-bit) of a frame, rows are ≤ 4 blocks wide, ceiling ~0.54 / ~0.50 of a frame at 4 threads, ~24 ms off a 4× colour ask — and **during a fill it is more decoders in disguise**. (c) Nothing scales faster than the decode, but **the JS range pass is 21–31 % of a frame in its decoder** (24 ms of the 4× colour ask), not D5's 10–25 % (corrected in place); integer min/max takes 3.36 → 2.58 ms colour (6/7); taking the range in the source wrapper's pack would remove it. Nothing in `client/` changed. `decode/README.md` §The decode tail on a slow CPU. **For rows 73, 75, 76:** Chrome's throttle reaches the page thread only — a decoder's warm-up (73) and per-thread resources at 4× (75) need `cpu_throttle.mjs`; the page's hand-off (76) is sub-millisecond work that `cpu_throttle.mjs` does not slow faithfully, so the page-only CDP throttle is the right lever there, with decoders then unthrottled — say so. For 75: at 4× the 16-bit fill's clock is the browser's receive path, which a per-thread sampler should split. `client/transport-ts/dist` and the WASM client must be built before any page runs (`build.sh`; `wasm-pack` needs `PATH=~/emsdk/upstream/bin:$PATH` here for `wasm-opt`) |
| 76 | **PH1** — the decoded frame's hand-off to the page on a throttled CPU | queue §Rows 73–76 | **done** 2026-09-25 `dbe6c96` — **nothing changed: the cost was counted twice, and on a slow CPU coalescing has nothing to batch.** Row 52 summed the port's callback with the dispatch event it runs inside, plus the lab page's handler; the product's page share per decoded frame is **0.15 / 0.84 / 1.15 ms** at 1× / 4× / 6× (page-only throttle, n = 7), not 0.28 / 2.5 / 3.7 — ~4 % of a 4× main thread at a frame every 20 ms. In the callback at 4×: deserialising ~0.22 ms, `#deliver` ~0.10, dispatch ~0.24. `port.mjs`, the message alone: its SAB and stamps do not separate; two frames a message is −33 % / −45 % a frame at 1× / 4× (7/7), −12 % at 6× (4/7). But each decoder posts to the page itself, and with every thread slowed (row 74's dump) **no decoder ever has two frames in one animation frame at 4–6×** (0 %; 15–33 % across decoders), so per-decoder coalescing batches nothing and per-k holds a frame 80–120 ms; batching across decoders needs a merge point — a change to §The decoders' shape, ceiling ~10 ms of a fill's main thread — asked of the owner in `## Blocked`. No product change, so no clause or mutant. `throttle.mjs` now counts a nested call once (`ALLOC=0` drops the sampler); M1's figures corrected in place. `proposal-downloader.md` §The hand-off. **For row 75:** the page-only throttle leaves decoders at desktop speed, so the page sees frames every ~8 ms there; measure page-side costs with that caveat stated |
| 73 | **WU1** — the decoder warm-up, re-measured on a throttled CPU | queue §Rows 73–76 | **done** 2026-09-25 `af22015` — **keep it off by default: the container shows both signs.** Every browser thread slowed (`cpu_throttle.mjs`; Chrome's throttle does not reach the decoders), `none` vs `match`, fill and a cold ask, 1× / 4× / 6×, loopback and 40 ms, n = 7, 336 visits, pixels identical. The warm-up **always cuts frames 0–2's decode 30–65 %** (7/7 or 6/7 everywhere; 60–100 ms a frame at 6×). But it is paid before `ready`, and on a slow CPU it costs the gate more than it saves the frame (colour 4×: the wait for a decoder +61–81 ms against −58–60 of decode). Where the first bytes land after it — 16-bit at 40 ms — frame 0 is **50–81 ms sooner at 4–6× (7/7, 6/7)** and a cold ask 30–93 ms sooner; where they land before — loopback, and the colour cine loop (~50 KB frames) even at 40 ms — frame 0 and the ask are **44–100 ms later** (0–1/7). The deciding quantity is the window between the decoders' compile and the first frame's bytes; a device on the target link, cine loop and 16-bit, decides it. `decode/README.md` §Warming the decoders, On a slow CPU. `lab/decoder-warmup/run.mjs` takes `THROTTLES` and `SCENARIOS=ask` |
| 75 | **RC1** — per-thread and per-heap resources, and the decoder count against the cores | queue §Rows 73–76 | **claimed** 2026-09-25 by the cloud agent |
| 8 | **L12** — the whole gate on this branch | lanes §L12 | **done** — gate green; the WASM arm decision is settled 2026-09-18, see §Blocked |
| 15 | **D1** — the downloader's capabilities, tested on today's path | proposal-downloader §S1 | **done** `7a21ab3` on `claude/downloader-s1-capabilities` — 3 rows not green, see below |
| 16 | **D2** — the downloader, beside today's path | proposal-downloader §S2 | **done** on `claude/downloader-s2-worker` — the conformance run it owed is D2b `09fcf32` |
| 17 | **D3** — fills pushed, both clients | proposal-downloader §S3 | **done** `77e01f0` on `claude/downloader-s2-worker` — pushed on both clients, the downloader re-issues after an ask; `CLIENTS.md` §Fills are pushed |
| 18 | **D4** — validation and metrics | proposal-downloader §S4 | **done** `857ff54` on `claude/downloader-s2-worker` — three clean sweeps, two ties, the fill survives an ask only on the downloader; proposal §Results |
| 19 | **D2b** — the conformance suite drives the downloader arm | queue §Rows 19–22 | **done** `09fcf32` on `claude/downloader-s2-worker` — 35 checks green, in the gate |
| 20 | **D2c** — assert what D2 implements and nothing checks | queue §Rows 19–22 | **done** `2ca9886` on `claude/downloader-s2-worker` — 9 checks green, in the gate |
| 21 | **D1r** — the two red capability rows that need no fixture | queue §Rows 19–22 | **done** `5b93cd5` on `claude/downloader-s2-worker` — both rows green against a real server, in the gate; one hole found, see below |
| 22 | **F1** — a signed 16-bit fixture with ground truth | queue §Rows 19–22 | **done** `352b82e` on `claude/downloader-s2-worker` — route proven with an independent decoder; the package was right, the source build was wrong and is fixed |
| 30 | **Q1** — the QUIC crate, bumped | queue §Rows 30–41 | **done** — `quinn-proto` 0.11.17 → 0.11.18, gate green. The log sweep cannot be run: the `mtu=` line is newer than every archive tag. Two occurrences are recorded in prose, both the 2026-09-10 relay runs under induced loss. `disk-access/IMPLEMENTATION.md` §What the server reports |
| 31 | **F2** — fixtures that compress like real series | queue §Rows 30–41 | **done** — `cine512` 18.2:1 and `ct512` 1.99:1, both byte-exact. Colour decode −44 %; copy-out share 6.2 → 7.8 %; **L19 corrected — level 1 is 48 % at 18:1, not 23 %**. `decode/README.md` §Content |
| 32 | **R1** — two round trips off a cold open: a proposal, then a prototype behind a flag | queue §Rows 30–41 | **done** — `proposal-session-open.md`; lever 1 (`--open-ask`) prototyped and tested, no crate patch needed; lever 2 needs one, specced not built. **No doc stated a round-trip count to correct** — this one states it. **Timed under row 36: four round trips to first byte, confirmed.** Lever 1 is measured in a browser too — **−1.13 round trips** to the first frame of a fill (41 / 90 / 178 ms at 40 / 80 / 160 ms, n = 7 cold opens a cell; `lab/page-open/README.md` §The first byte on a fill), built on branch `claude/first-byte` and **merged into `claude/integrated-2026-09-20`** 2026-09-22, **off by default**. R3/W1, the third lever the same ladder priced, buys nothing measurable (−0.06 RT) and `proposal-downloader.md` is corrected in place. Lever 2 was unmeasured until 2026-09-23: built as a build-time `wtransport` patch, **−1.0 round trip off the dial** in a browser and natively (`proposal-session-open.md` §Lever 2) |
| 33 | **P1** — a decoder pool that follows the queue, and a reader that waits: a proposal | queue §Rows 30–41 | **done** — `proposal-downloader.md` §The decoders and §The downloader; `client-shape-plan.md` M2/M3 and its shape table corrected in place. **M3's fill window is deleted, not built**; the reader pausing gives the same bound through QUIC flow control. Nothing built |
| 34 | **A1** — a session that dies is noticed and resumed: a proposal | queue §Rows 30–41 | **done** — `proposal-session-survival.md`. The idle timeout is the freeze length, so detection moves to platform triggers + a probe ask; resumption rides the downloader's per-frame records. **The rebind number still waits on a run** — the probe and relay came over with T1 **Its owed number, 2026-09-19:** a port-only rebind survives 16/16 at a 10 s and at a 30 s idle timeout, the next ask 70 ms at a 40 ms round trip (`proposal-session-survival.md`). |
| 29 | **L21** — when UDP is blocked: a proposal, no code — **amended 2026-09-18** | queue §Rows 28–29, §Rows 30–41 | **done** — `proposal-udp-fallback.md`. **Measured: 2 ms when UDP is refused, 4 004 ms when it is silently dropped** — 2000x, and the realistic impairment is the slow one. iOS (S1) makes the scope all iPhones, not ~5 % of networks; recycling before 16 MB is the cheaper experiment. Race, do not detect |
| 25 | **D6** — a fresh decoder's first frame — **amended 2026-09-18** | queue §Rows 23–26, §Rows 30–41 | **done** — **the first frame costs ~4x the steady state** on both fixtures, and frames 1–5 pay a smaller version. The code cache does nothing (S13 confirmed); D6's own warm-up decode helps but does not remove it (3.9x → 3.5x; row 55 measured what its shape decides). May be §BYOB's unexplained ~12 ms. `decode/README.md` §The first frame |
| 23 | **D2d** — the WASM client behind the downloader — **amended 2026-09-18** | queue §Rows 23–26, §Rows 30–41 | **done** — the capability row is **green on both clients**: single ask byte-exact, fill a tie. And S6 fixed — the dial now overlaps decoder start-up, start+dial 58→52 ms (TS) and 70→57 (WASM), conformance 46/46 + 19/19. `proposal-downloader.md` §The decoders |
| 24 | **D5** — what the decoder's range pass costs a fill — **amended 2026-09-18** | queue §Rows 23–26, §Rows 30–41 | **done** — the range pass is 10–25 % of a decode, and **folding it into the copy is slower** (1.06x, 1.17x), so D5's remedy is refused with the measurement. S14's redundant copy removed; the stale "no signed fixture" comment corrected. `decode/README.md` §The range pass |
| 26 | **D7** — the downloader on the 4 MB decoder | queue §Rows 23–26 | **done** — the 4 MB build cuts the decode arm from **161.4 MB to 16.3 MB** (10x) with fill and cold ask unchanged to the tenth of a ms. Parity byte-identical on all six sets, 40 frames, signed included. `proposal-downloader.md` §Results |
| 35 | **T1** — the transport branch's lab and client pieces, here; not its server | queue §Rows 30–41 | **done** 2026-09-19 — 45 paths taken whole, 4 merged by hand (`session.ts`, `build.sh`, `docs/transport/README.md`, `transport-conclusions.md`). No `server/`, no `patches/`. Its `window.ts` is `ask-window.ts` here: the worker-safe check read a bundle's `// window.ts` banner as a reach. The ask window's 5 tests are in the gate. Gate green — conformance 84/84, downloader 46/46, dispatch 19/19, refusals 64/64 on both clients . **Its server half merged 2026-09-23** on the unified branch: the pooled send path is the default; the GSO patch and PGO are build-time opt-ins after an interleaved re-check (`transport/why-these-changes.md` §9) |
| 36 | **N1** — an impaired link in a container | queue §Rows 30–41 | **done** 2026-09-19 — `lab/scripts/link_impair.py`, both planes, no root; `link_impair_check.sh` reads every lever back against arithmetic and each was mutated to watch it fail. **A cold open's first byte is 4.01 round trips + 17.7 ms** (R1's count confirmed, its attribution corrected in place: the session alone is 3.00, the control stream free) and **a 250 KB ask is 5.59** (S7's ~5). It replaces `nat_rebind_relay.py`. `rig-limits.md` §3 **Calibrated on the rig 2026-09-19: the relay and `netem` agree to 0.01 round trips on every phase**, so its round-trip counts stand without a VM run (`rig-limits.md` §3). |
| 37 | **R2** — navigation to first byte on a real round trip: count, then cut | queue §Rows 30–41 | **done** 2026-09-19 — `lab/page-open/`. Cold serial round trips to a session: **ts 9.69 → 6.64, wasm 11.86 → 6.72, downloader 12.53 → 6.37**, cut one change at a time (config preload, modulepreload, the worker and decoder bundles); a warm profile spent none of it either way. All three now converge on the dial's 3.0 plus 3.6 for the page. The 6.4 left between session and first frame is slow start on a 428 KB frame, not the page. **S6 corrected in place.** gzip and the immutable rule are in `deploy/nginx` with checks — **verified 2026-09-19** on a host nginx (`check_equivalence.sh --local`, three mutants caught); the built image is still unrun here |
| 38 | **W1** — the first ask on an idle session | queue §Rows 30–41 | **done** 2026-09-19 — `lab/scripts/first_ask_cells.sh` + `first_ask` probe; `transport-conclusions.md` §3. **250 KB is 5.8 round trips on a fresh session against 1.3 on a warmed one**; the push lever reaches the warmed figure (454.7 → 103.9 ms at 80 ms), a 32-packet initial window is −28 to −33 %. **Two of S7's clauses did not reproduce** — a lossy fill lands between fresh and warmed, and a port-only rebind does not reset the controller — corrected in place, as is the ≤ 7 % verdict. Product defaults unchanged, and why is in the row |
| 39 | **W2** — slow-start exit, an outage, the first timeout | queue §Rows 30–41 | **done** 2026-09-19 — `server/src/transport/hystart.rs` (RFC 9406 over the public trait, no fork) + `lab/scripts/controller_cells.sh`; `transport-conclusions.md` §3. **The exit is a tie in all six cells**, so it is a flag, not a default. **S9 refuted as a lever** — the threshold does nothing; the outage cost is the probe-timeout ladder, +5.4 s for a 500 ms blackout. **S10 confirmed with a lever** — p99 cold open 1 335 → 638 ms at `--initial-rtt-ms 100`. The cells also found reordering costs Cubic 25× where BBR pays 2.9×. S11's leads handed to the source review |
| 40 | **E1** — the ingest format | queue §Rows 30–41 | **held** 2026-09-18 by the owner — see "What a row may not change" below; do not take it |
| 41 | **O1** — the fill's order; prerender, yes or no | queue §Rows 30–41 | **done** 2026-09-19 — **S21 measured**: a coarse-to-fine fill takes time-to-scrubbable from 5 688 to 1 043 ms (5.5×) and costs the fill nothing, and the permuted order costs the read path 0.3 % under `--force-pool-reads`, twelve interleaved rounds — `lab/scripts/fill_order_cells.sh`, `transport-conclusions.md` §4. **S20 answered 2026-09-19, correcting the row's first verdict**: the earlier "cannot be answered here" was a driver artefact (`PrerenderingDisabledByDevTools`); with no driver, headless Chromium prerenders, the page and its fetches run while prerendering, and the session and the worker complete only at activation — `lab/prerender/`, `rig-limits.md` §8 |
| 42 | **W3** — after a blink: where the 5.4 s goes, and BBR through the same blackout | queue §Rows 42–52 | **done on the workstation** 2026-09-19, branch `claude/w3-after-a-blink`, **merged into `claude/integrated-2026-09-20`** 2026-09-20. S30 confirmed off the window: `cwnd` 8 400 B after a blink at the fill's start, +0.51 packets a round trip. A 500 ms blink: Cubic 6 915 ms, `--congestion cubic-restart` (new, default unchanged) 2 116, BBR 1 897, 5/5 each; BBR is worse mid-fill (0/5). The restart's misfire cell at 1 % loss is not clean — see row 50 |
| 43 | **N2** — the impaired link, made to behave like a radio | queue §Rows 42–52 | **half done on the workstation** 2026-09-19, branch `claude/n2-radio-link`, **merged into `claude/integrated-2026-09-20`** 2026-09-20: `--jitter-mode reorder\|ordered` and `--blackout-mode drop\|hold`, each checked against arithmetic and mutated. **Still open, and the merge is no longer in the way: the idle penalty and trace replay** |
| 44 | **H1** — the production handshake: a real chain, compression, the static plane | queue §Rows 42–52 | **first half done on the workstation** 2026-09-19, branch `claude/h1-production-handshake`, **merged into `claude/integrated-2026-09-20`** 2026-09-20: an RSA-2048 chain costs exactly one round trip (4.03 → 5.05, 7/7 at three delays), an ECDSA P-256 chain none; brotli compression (feature `cert-compression`, off) brings RSA back to 4.08 and Chrome 148 offers brotli only; the leaf-only-PEM guard is built. **Still open: S40, the static plane** — ready, and independent of that branch |
| 45 | **K1** — iOS: a dial that never settles, and what silently does nothing there | queue §Rows 42–52 | **done** 2026-09-24 `ceed491` — **every client waited for ever on a dial that never settles; the downloader now has a deadline and retries it.** `exact-server --hold-sessions` takes each CONNECT and never answers it (test mutated two ways). Chromium 141: a bare `WebTransport`, the TS client, the WASM client and the downloader were all still pending at 180 s; neither Chromium nor QUIC's idle timeout ends it. So this is not WebKit-only. Now the TS client takes `dialMs` (it closes and rejects a `DialTimeoutError`), and the downloader passes 5 s and retries `tries` times, the first dial included. Against the held server it fails at 29.1 s and names the deadline; against a normal one, ready within 100 ms. In the browser: Chrome's `close()` rejects a connecting `ready` at once, so the deadline must reject first. The fake now does the same, and three mutants were caught. Also fixed: a failed `connect` left its downloader worker running. The second half is a WebKit table in `CLIENTS.md` (from S24's reading, not measured), and S20 is corrected in place to Chromium-only. Still owed, to a device: the iPhone itself, Lockdown Mode, and whether 5 s suits a phone. `proposal-session-survival.md` §A dial that never settles |
| 46 | **D8** — the decoder instantiated by streaming: does the code cache engage now | queue §Rows 42–52 | **done on the workstation** 2026-09-20, branch `claude/d8-streaming-instantiate`, **merged into `claude/integrated-2026-09-20`** 2026-09-20: streaming instantiation is a tie over three visits (`decoder.streaming`, default unchanged) and Chrome 148 wrote no WASM code-cache entry in 60 visits across five configurations, while the *JavaScript* code cache does engage on the decoder's glue (22.9 → 13.1 ms to a ready decoder by visit 3) — `docs/decode/README.md` §Instantiating by streaming. **Still open: the glue itself, which `decoder.js` evaluates through `new Function` where no code cache can reach it; a headed browser and a phone** |
| 47 | **P2** — a paint floor: two routes from decoded samples to the screen, pixel-equal | queue §Rows 42–52 | **done on the workstation** 2026-09-20, branch `claude/p2-paint-floor`, **merged into `claude/integrated-2026-09-20`** 2026-09-20: main-thread ms per paint, canvas 2D → WebGL2 on a real GPU, 7.55 → 0.34, 11.14 → 0.43 and 105.36 → 5.73 (18–26×), the two routes pixel-equal except on exact texel edges under minification — `docs/paint-floor.md`. **Still open: a phone; on a software rasteriser the gl route delivers 2–3 vsyncs later at 512²; both routes still point-sample a minification** |
| 48 | **W4** — the controller verdicts, re-run on a link that does not reorder | queue §Rows 42–52 | **half answered on the workstation** 2026-09-19 (`claude/n2-radio-link`): on ordered jitter Cubic is 1.01× / 1.03× where it was 8.2× / 23.7×; `--packet-threshold` does *not* explain it (0.52× at ±2 ms, ~0.9× at ±10 ms) — what declares those losses owes a qlog cell. **Still open, and 43 is merged: the deep-buffer fill (S28 is half wrong — the queue does fill) and the trace arm** |
| 49 | **I1** — the idle ask when the first packet is late | queue §Rows 42–52 | after 43 |
| 50 | **W5** — a blink that holds instead of dropping; slow start restarted after a silence | queue §Rows 42–52 | **mostly answered on the workstation** 2026-09-19: held, a blink costs the outage and nothing else — no congestion event, no loss — and a second blink is no worse (S33's second half refuted); the restart is built (row 42). **Still open, and both merges are in: the restart against plain Cubic at 0.1–1 % loss with rounds enough to size it** — five rounds gave a four-fold spread |
| 51 | **C1** — a reconnect that remembers the path: a proposal | queue §Rows 42–52 | **done** 2026-09-24 `7835462` — **proposed, not recommended now: the push at open recovers the same round trips with no saved state.** Reachability is settled. quinn's factory is not told the peer, and wtransport hides `accept_with`, but this tree's settings-early patch already edits the one function that calls `accept()`, so exposing `accept_with` there needs no fork. The controller would hold a slot filled when the CONNECT's token is parsed. The key is a server-issued, authenticated token in the session URL (window, minimum RTT, address prefix, time), not the address: that rules out the carrier-NAT case, and S2's changed network falls back to slow start. `first_ask_cells.sh resume`, 250 KB at 80 ms, n = 7, with the jump approximated as an initial window of half the warmed one. Open link: fresh 462 ms, jump 134, push 130, push + jump 113, warmed 105. 10 Mbit with a 20-packet queue: fresh 587, jump 420 (with 3.5× fresh's loss), push 314, push + jump 318, warmed 303. The re-dial already pushes when `openAsk` is set. It would reopen for reconnects with nothing to push, or a bottleneck one burst cannot fill. `proposal-careful-resume.md` |
| 52 | **M1** — what a fill allocates on the page, on a throttled CPU | queue §Rows 42–52 | **done** 2026-09-24 `04975f8` — **the downloader collects nowhere, at any throttle; the earlier "139 collections" were GC trace events.** `lab/downloader-campaign/throttle.mjs` runs an 80-frame fill on H, Dw and Dd at 1×, 4× and 6×, rotated, n = 5, and counts per thread from the trace. H makes one collection per fill (a mark-compact, 13–15 ms paused at 4–6×). Dw and Dd make 0 on the page and 0 in their workers. The page allocates ~0.2–0.3 MB a fill (sampled with collected objects), of which `consumer.js` ~50 KiB: ~0.4–0.5 KiB a frame for the received message, ~130 B for `#deliver`'s frame object. The throttle slows the page's thread only. The downloader's fill is flat (Dw 273 → 300 ms), while H's slows 279 → 692 ms. Found, not changed (messages not to be optimised): the decoded path's pixel-port dispatch costs the page 0.28 / 2.5 / 3.7 ms a frame at 1× / 4× / 6×, against H's ~1 ms; a device should check it. Also: Playwright's default rAF polling was charging the fill main-thread time. `proposal-downloader.md` §Under a throttled CPU, with §Results and S44 corrected in place |
| 53 | **D10 + D11 + D13** — one wrapper pass, parity-gated | queue §Rows 53–56 | **done on the workstation** 2026-09-20, branch `claude/d-wrapper`, **merged into `claude/integrated-2026-09-20`** 2026-09-22: packing each line once (D10) is **−5.5 to −8.3 % on one-component frames and a wash on colour** (+0.9 % on the tight colour set), `restart()` (D11) is a tie kept for the simpler code, and the 4 MB floor (D13) stays — the headline corrected in place, a reused decoder costs **4.8 MB not 4.0**, so **10× not 12.5×**, and re-measured per wrapper arm on the merged binary 2026-09-22 it is **4.8 MB grey / 7.0 MB colour on all three arms**, 36 readings without spread, so the headline is the wrapper's and not one arm's (what the re-measure did retract is the *reason*: the codestream's arena is not what lifts it off the floor, and `restart()`'s 1.9 MB only shows across a frame-size increase). 522-frame parity, three mutants caught and one not — `decode/README.md`. **Still open: the package's own build has not been re-timed since D10; a floor chosen for first-frame latency** |
| 54 | **D14** — another open HTJ2K decoder, benched | queue §Rows 53–56 | **done on the workstation** 2026-09-20, branch `claude/d14-other-decoder`, **merged into `claude/integrated-2026-09-20`** 2026-09-22 as a lab arm, **adopted nowhere**: bit-exact on 522 frames and **+16.7 % colour / +47 % grey**, 40/40 rounds to the incumbent with every pair of ranges disjoint, 39 KB more `.wasm`, and a header surface it does not expose. Three mutants caught; a per-frame leak found in its own re-`init()` shape and worked around — `decode/README.md` §A second decoder, measured. **The row is closed**; only 512² was benched |
| 55 | **D9** — the warm-up frame's shape | queue §Rows 53–56 | **done on the workstation** 2026-09-22, branch `claude/decoder-warmup`, **merged into `claude/integrated-2026-09-20`** 2026-09-22 — **off by default.** A warm-up decode in each decoder before it answers `ready` takes **30–45 % off frames 0–2**, 12/12 rounds on all six cells (cine 44.33 → 29.49 ms, grey 37.68 → 20.74), and a wrong-shape control at the same sample count comes within 2–3 ms — **the first frames want samples, not the shape**. The shape decides **frames 3–11**: a mismatched warm-up leaves the cine at 14.4–14.7 ms against **10.22 with no warm-up at all**, disjoint ranges. It does not move the page's clock on this box (the decoders report `ready` later by about what the frames save: frame 0 at the page 119 → 130 ms on loopback, 522 → 555 at 40 ms), pixels identical, no new session bytes — one same-origin GET of a shipped 6.7 / 38 KB file. Two of four mutants uncaught and recorded. `decode/README.md` §Warming the decoders. **Still open: the deciding ladder on a device whose decoders are up well before the first bytes; the warm-up's own size, unswept; 12-bit signed CT has no shipped frame** |
| 57 | **D16** — a truncated or undecodable frame reaches the consumer as pixels | queue §Row 57 | **done on the workstation** 2026-09-22, branches `claude/truncated-frame` and `claude/truncated-frame-wasm`, both **merged into `claude/integrated-2026-09-20`** the same day, in two checks that do not subsume one another and are now on **both clients** — on the wire, the reader takes the frame's index **ahead of** its codestream so a uni stream that ends short can name what it lost (`truncated: G of D bytes`, through the refusal path a server `frame_error` takes), and in `decodeFrame`, against the size the codestream's own header declares. The behaviour was **worse than this row recorded**: the product reuses one decoder, so an undecodable frame came back as the **previous frame's pixels** under the new index, not as 0 pixels — 0 pixels is what a *fresh* decoder returns. A codestream truncated to 25–60 % decodes to full size silently, which is why the wire is the only place truncation is visible. No new message kind and no new option — it rides the existing `onError({frameIndex, reason, generation})`. Refuses **none of 129 real codestreams**; dispatch **55 → 63**, five mutants five caught. `CLIENTS.md` §A truncated frame is a failure · `decode/README.md` §A frame that did not decode. **The WASM transport, `failAll` and per-frame mode landed the same day** on `claude/truncated-frame-wasm`, **merged in a fourth merge**: `read_length_prefixed_frame` returns an `Envelope` and `fail_waiter` carries a named loss to the asked frame's promise or the fill's `onError`, with the TypeScript reason string byte for byte; `failAll` / `fail_all` name **every index the fill still owed, once**; and `--stream-mode per-frame` is **not narrowed** — nothing on the wire says which mode is in force, so narrowing it is a new wire field and a server change for a mode the measured cells do not use. Conformance **84 → 98** across both implementations, downloader arm **46 → 53**, six mutants six caught, `.wasm` +2.5 % (252 859 → 259 101 B). **Still open:** the **BYOB** reader (`--features byob`, non-default, only `cargo check`ed by the gate) drops a truncated frame silently, and a codestream the **server** truncates before framing passes both checks — row 15's K3, the per-frame hash, is the only thing that sees it |
| 58 | **D17** — the downloader carries a frame's wire bytes | `client/downloader/README.md` §What a frame reports | **done on the workstation** 2026-09-22, branch `claude/wire-bytes`, **merged into `claude/integrated-2026-09-20`** the same day (`95f69bf`) — one **additive** field, `wireBytes`, on every frame message the decoder and the downloader post: the codestream length the frame's envelope declared, beside the decoded `byteCount`. A private viewer rig that copies `client/downloader/` as built had been re-applying it by hand, because a consumer that reports the decoded plane overstates the link by the compression ratio — **6 708 wire bytes against 76 800 decoded** on the lab's own 8-bit warm-up fixture, 11.4x. Two lines, nothing renamed, `consumer.js` untouched (it already forwards the message as `frame.info`) and the conformance suite unchanged. One clause, `aFrameCarriesItsWireBytes`, holds both paths — undecoded and behind the real decoder: dispatch **63 → 66**, two mutants two caught (the decoder reporting the decoded length as the wire length; the undecoded message dropping the field) |
| 56 | **W1b** — a default for the first ask | queue §Rows 53–56 | **measured on the workstation** 2026-09-20, branch `claude/first-ask-defaults`, **merged into `claude/integrated-2026-09-20`** 2026-09-22 — **no default changed, the owner's call.** The push at session open is **463.3 → 137.9 ms (−70 %, 7/7)** at 250 KB / 80 ms and needs three lines on the page; a 32-packet initial window is **−16 to −33 % at queues ≥ 20 packets** and **+11.8 % (0/7) behind a 10-packet queue** and needs no page change; **the two do not stack**; the keep-alive pair keeps a 30 s idle session alive **56/56**, and without it the native session is **dead 2/2**. `transport/transport-conclusions.md` §3. **Still open: the push's browser cell, and which lever a rebind re-applies** |
| 59 | **A1b** — the handover, on a device: does a session survive Wi-Fi → cellular, and how long is the freeze | [`proposal-session-survival.md`](proposal-session-survival.md) §What this means for the stack choice | **waiting on a device — no container can take this row.** An Android phone with a SIM, the fill running, Wi-Fi switched off mid-fill: what the page sees (any event at all, and when), whether any frame arrives afterwards, and the wall time from the switch to the first error. The client half is settled from Chromium's source (2026-09-22) and the server half from the rebind probe; this row is the only reading that would replace an inference with a measurement, and it also prices A1's triggers where a radio change is real |
| 27 | **L19** — how much of a frame draws a smaller image | queue §Row 27 | **done** — a quarter of the bytes draws the half-size image, on all four formats; only the package can do it. `decode/README.md` §A prefix draws a smaller image |
| 28 | **L20** — opening a study nobody has read | queue §Rows 28–29 | **done** — a tie in both scenarios; the miss *path* costs ~0.5 ms on one ask and nothing across a fill. What a cold study costs is the device's, not this container's. `disk-access/EVIDENCE.md` §A study nobody has read |
| 9 | **L13** — what a thread hop costs a frame | lanes §L13 | **done** `3cd29fd` — `docs/thread-hops.md` |
| 10 | **L14** — what retained frames cost in memory | lanes §L14 | **done** `dfbd4e8` — `docs/decode/README.md` §Retention |
| 11 | **L15** — how long an idle browser session survives | lanes §L15 | **done** `444dd36` — 30 s confirmed, and the browser pings itself |
| 12 | **L16** — whether an ask can overtake a running fill | lanes §L16 | **done** `9714d41` — it ends the fill; `transport/ask-during-fill.md` |
| 13 | **L17** — a faster decoder, byte for byte | lanes §L17 | **done** `6f87cbb` — no win; the toolchain is a 15 % regression |
| 14 | **L18** — what the BYOB read path allocates | lanes §L18 | **done** `bb86253` — byob allocates **less**; `decode/README.md` §The BYOB read path |
| 5 | **L2** — the BYOB frame-0 cost | lanes §L2 | **part done on the workstation** 2026-09-15: reader acquisition eliminated; module warm-up untested |
| 6 | **L3** — a lossy, rate-limited link | lanes §L3 | **done** 2026-09-18 from the workstation — on a lossy link the congestion controller is the lever: BBR fills 5–9× faster than cubic at 1–3 % loss, 5/5, and the 768 KB send window ties. BBR fills the queue and resends 5–13 %, so it is to be priced in a browser, not taken. netem on the sender needs GSO off. `rig-limits.md` §3 |
| 7 | **L7** — a regime where the read path misses | lanes §L7 | **done** 2026-09-18 from the workstation — a 4 GB study on the rig's 954 MB host misses 76–97 % of spread asks, each ~1 ms slower at p50 than warm (6/6); the fill still does not miss; `read_ahead_kb` no clean result. The rig's stolen CPU caps it at medians; P0 needs a non-burstable host. `disk-access/EVIDENCE.md` §A study past RAM |
| — | L4 a closed session is noticed | lanes §L4 | done `62cf243` |
| — | L5 the tail at SIGTERM | lanes §L5 | done `23bd447` |
| — | L6 idle sessions, and the pair | lanes §L6 | done `c69450a` |
| — | L11 dispatch measured; harness wiring **proposed, not built** | below | part done `ccf5317` |
| — | L1 decoder heaps | lanes §L1 | done `2ffc0aa` |
| — | L8 a decoder built from source | lanes §L8 | done `82a13d9` |
| — | L9 the conformance suite | lanes §L9 | done `4928b74` |
| — | L10 what telemetry costs | lanes §L10 | done `c0197d4` |

**The redesign is queued** (2026-09-16) as D1–D4: `docs/proposal-downloader.md`, approved for
investigation. It replaces the harness decode arm L11 proposed. D1 comes before any code, because
the proposal is adopted only if nothing today's path can do is lost. **Still held:** a bounded
fill window, the cache seam, paint — and, since 2026-09-18, an ask arriving during a running fill.

Rows 15–22 name the branch each landed on. `claude/downloader-s2-worker` was merged into this one
on 2026-09-18, so those commits are in this history and the branch names are provenance, not
somewhere still to look.

### Rows 73–76

Queued 2026-09-25 by the workstation. The owner's order for this phase: **the numbers first** — a fill's throughput,
one frame's latency, and memory and threads on the target (a phone's browser on a lossy 20–50 Mbit link); resilience
work waits for a later phase. Each row is lab-only and container-sized (no VM, no device). The workstation ports what
wins into a private rig and re-measures it there. **A phone's CPU is emulated here by Chrome's CPU throttle** (CDP
`Emulation.setCPUThrottlingRate`, 4× and 6×, as row 52's `lab/downloader-campaign/throttle.mjs`); say so beside every
number, and never quote a throttled number as a phone's. *Corrected 2026-09-25 (row 74):* that throttle does not reach a
worker — Chromium refuses it on worker targets — so it never slows a decoder; `lab/scripts/cpu_throttle.mjs` slows
every browser thread (`decode/README.md` §The decode tail on a slow CPU).

**74 · DT1 — the decode tail: what makes one frame's decode cheaper.** Row 68 found the colour fill's last ~270 ms is
decode throughput (three decoders busy 95 %), and the from-source build 8–11 % faster than the package in Node but not
separable in the browser on a host the fill saturates. Under a 4× / 6× throttle the decode is the clock of the fill and of
one ask. (a) The package, the from-source build at the tree's wrapper (restart + pack-once, `a28587f`), and the 4 MB-heap
build, parity-gated bit-exact: per-frame WASM decode time alone (not the JS range pass), the fill's all-decoded, one ask,
both contents, n ≥ 7 interleaved, at 1× / 4× / 6×. (b) Identify, do not build: whether OpenJPH can decode one frame's
code-blocks in parallel under WASM threads (what it would take; what one ask would gain), priced against the standing rule
that more decoders are not the answer — say whether this is that in disguise. (c) Anything per frame in the wrapper or the
decoder worker that scales with a slow CPU more than the decode does.

**76 · PH1 — the decoded frame's hand-off to the page.** Row 52 found the decoded path's pixel-port dispatch costs the page
0.28 / 2.5 / 3.7 ms a frame at 1× / 4× / 6×, against ~1 ms for the old on-page decode, and left it unchanged. The rig's
version of the same page measured its share at ~0.36 ms a frame at 1× and ~1.0 at 4×, with the port ~20 % of it. Find where
the lab's page spends it (a trace per thread), then the smallest change that removes it: **fill frames coalesced (one
message per animation frame, or per k frames); an ask and frame 0 never held.** Measure at 1× / 4× / 6×, n ≥ 7 interleaved:
the page's main-thread time per fill, all received / all decoded / delivered, one ask's latency (must not regress at 1×).
A conformance clause and a mutant per change.

**73 · WU1 — the decoder warm-up on a throttled CPU.** LF (`claude/first-byte`, merged) warmed each decoder with a frame of
the series' shape: frames 0–2 −30–45 %, but the page clock did not move on the workstation, so it stays off by default. On a
slow CPU the first frames are where one-frame latency is lost. Re-measure warm-up on / off at 1× / 4× / 6×: the first three
frames' decode, the first frame on the page clock, one cold ask, the fill; n ≥ 7 interleaved. Say whether it should be on.

**75 · RC1 — per-thread and per-heap resources, and the decoder count against the cores.** Nothing here samples a browser
per thread or per heap: add a sampler (per-thread `comm` + `schedstat` from `/proc/<pid>/task`, `smaps_rollup` per process,
and `performance.measureUserAgentSpecificMemory()` where cross-origin isolated) to the downloader campaign. Then the fill and
one ask with 1, 2 and 3 decoders, with Chrome confined to 2 and to 4 cores (`taskset`) and at 1× / 4×: time, main-thread
time, renderer and GPU memory, threads. Nothing in `client/` reads `navigator.hardwareConcurrency` today: say whether the
decoder count should follow it, and by what rule — a resource lever, not a speed one ("more decoders" stays barred).

### Rows 65–72

Queued 2026-09-23 night, the second batch of the day; the same rules as §Rows 60–64. Several come from
the workstation's private rig, which runs this lab's downloader and decoder pair against another
transport: the finding is stated here in the lab's terms, and the row asks what it means for this code.

**65 · WM1 — a message posted before the other side listens, in production code.** Row 60's neighbour
(`851668f`) found that Chrome 148 sometimes drops a message the conformance page posts to a fake in a
worker right after opening it — 10 in 5 000 without the fix. The fix was in the test's channel. **Audit
every production site** in `client/` that posts to a worker, a `MessagePort` or a `BroadcastChannel`
before the other side has said it listens (the downloader's `start`, the decoder pool's first job, the
session's first command). Reproduce the drop outside the test harness if you can (≥ 5 000 opens), name
each site safe (the spec queues it — say which clause) or exposed, and fix the exposed ones with the same
handshake. A mutant per fix.

**66 · LV1 — detection by the bytes, and two defects found on another client.** The rig's client finds a
dead session in 3.3 s by the bytes alone: **no byte for 3 s while frames are owed → dead**, the threshold
doubling after every re-dial it causes; 0 false re-dials in 42 fills on the radio relay, a 700 kbit link
and 1 s blinks; one re-dial per fill behind a 4 s standing queue (+10 s of 97). This lab's survival
([`proposal-session-survival.md`](proposal-session-survival.md)) decides with a probe ask and deadlines.
Compare the two on this client — detection time on a cut (the server killed mid-fill), false alarms on the
radio relay and a slow link, n ≥ 7 each, interleaved — and adopt the simpler if it is not worse. Also check
two defects the rig found in its other client, here: (a) **a replaced session's WebTransport left open**
after a re-dial, so the server kept sending the old burst to nobody (+31–41 s on a slow link); (b) **a
frame's deadline counted from the ask rather than from the last byte**, so a burst longer than the deadline
fails its tail. Each: reproduce first, fix, mutant.

**67 · CC1 — the congestion controller on a lossy radio link, priced in a browser.** Row 6 (L3) found BBR
fills 5–9× faster than cubic at 1–3 % loss on the native client, "to be priced in a browser, not taken";
W3 found BBR worse mid-fill after a blink (2 880 vs 2 444 ms, 0/5); `rig-limits.md` §3 has the table. The
target is a phone on lossy wireless. Price it in headless Chromium through the lab's relay: cubic vs BBR
(and cubic with the slow-start restart W3 built) on 1 %, 3 % loss, the radio relay's ordered jitter and a
blink, fill and ask cells, n ≥ 7, interleaved; retransmission share and the queue BBR builds. The answer is
which controller the server should default to for this target, or "neither, and why".

**68 · DC1 — the decode tail.** On the rig, a colour fill's last byte arrives ~325 ms after the ask and
its last frame is decoded ~685 ms after it: ~360 ms of decoding after the wire is done, with three
decoders. Is the pool idle while bytes arrive and then backed up (scheduling), or busy the whole fill
(throughput)? Record each decoder's busy intervals against each frame's arrival in `lab/decode-bench` or a
page cell, the colour and the 16-bit sets. Then only what fits the standing rules: no more decoders; build
flags (SIMD / relaxed SIMD already on? `-O3` vs `-Os`, `wasm-opt` levels — L17 found the toolchain a 15 %
regression, so re-check what is shipped), the order frames reach decoders, a decoder starting a frame
before its last byte if the codestream allows it. Report the split and any change that wins, bit-exact.

**69 · HP1 — a frame's latency during a fill, downloader arm vs direct.** On the rig the downloader pair's
per-frame interval during a fill is 10.4 ms (colour) / 13.8 ms (16-bit) against 9.2 / 9.1 ms for a client
on the page, and its steady serve leg is ~0.1 ms slower (the worker hop). `docs/thread-hops.md` priced a
hop; find where this arm's extra per-frame milliseconds go during a fill (the downloader's own loop, a
transfer, the decoder hand-off, the page's `onmessage`), with a trace, and remove what can be removed.

**70 · GS1 — why the send-size cap patch loses p99 at depth 1.** The transport branch's quinn patch (44
segments per `sendmsg`) stays opt-in because its regression reproduced on the workstation: 250 KB frames,
depth 1, 4 sessions — p99 1.9 → 27.5 ms, 0/6. Find the mechanism (a burst that overflows a queue, pacing
off, the ack clock) with the server's own counters and a packet capture, and whether a smaller cap, pacing,
or a cap only past a depth keeps its CPU win without the tail. If nothing does, say so and close it.

**71 · WP1 — lever 2 against every other client we can run.** Lever 2 (SETTINGS in the server's first
flight) is on by default and was proved with Chrome and the native client. Before anyone else relies on
it: every other HTTP/3 or WebTransport client the container can run — Firefox headless if installable,
`curl --http3` against the server's HTTP/3 surface, a quinn / h3 example client, the `webtransport-go`
or `aioquic` examples if they install — connects, and a client that ignores 0.5-RTT data still works.
Say which clients were tried and which could not be installed.

**72 · PO1 — the page's first frame on a shaped link, end to end, with lever 2.** `lab/page-open` has a
HOST mode that serves the page from nginx over TLS, HTTP/1.1 or HTTP/2 (`efe4aca`). On 40 and 80 ms RTT:
the page's first frame on screen, lever 2 on vs off, HTTP/1.1 vs HTTP/2, n ≥ 7, interleaved; where the
time goes (TLS for the page, the page's scripts, the WebTransport dial, the first frame). This is the
lab's answer to "is the dial on the first picture's path on a real link".

### Rows 60–64

Queued 2026-09-23 from the workstation's day on this branch. "What a row may not change" (§Rows
30–41) binds these rows: bit-exact pixels, fixed content, no server caps, no mixed mode, remove rather
than add. Interleave the arms, mutate every new test, quote latency or throughput not both, and say
where the host saturates. Each row ends with the full `scripts/gate.sh` green.

**60 · LK1 — a closed downloader client leaves its worker running.** `DownloaderClient.close()`
(`client/downloader/consumer.js`) posts `close` but never terminates the downloader's own worker, so
every closed client leaves a worker thread alive — the conformance suite leaks about fifteen per
page. Find whether the decoder workers the downloader starts outlive it too. Fix it so a closed client
ends every worker it started, once the worker has answered its close (or at once if it never answers
within a deadline). A test that counts live workers and fails without the fix; the conformance suite
and the gate green. A page that opens one client for its whole life is unaffected; one that opens and
closes clients repeatedly is not — say what the leak costs per client (threads, memory) before the fix.

**61 · FF1 — a blink that swallows the server's first flight, after lever 2.** With lever 2 the
server's SETTINGS ride its handshake flight, and the dial is 2.1 round trips. The measurement that
adopted it found one phase where it loses: a blink that drops exactly the server's first flight costs
one more round trip (+80 ms at 80 ms RTT), because of how quinn times the retransmission of that
flight. With the native client through netem (or the lab's relay), drop exactly that flight and read
what quinn does and when (the probe timeout on the server's side, the client's Initial retransmit).
Is there a small server-side change — a shorter initial probe timeout, a duplicated first flight within
the 3× amplification limit — that recovers it without costing the clean case? Interleaved, n ≥ 7, at
40 and 80 ms. Build only if it wins cleanly and the conformance suite holds on both transports.

**62 · RS1 — a re-dial with TLS resumption or 0-RTT.** A session that dies is re-dialled
([`proposal-session-survival.md`](proposal-session-survival.md)), and every re-dial pays the whole
handshake. Does the server issue session tickets, and does a resumed handshake (or 0-RTT) shorten the
dial — on the native client, and in headless Chrome if the container's browser can reach the server?
What must the server change (rustls / quinn configuration), what does the browser actually do on a
second connection to the same origin, and what is 0-RTT safe for (a frame ask is idempotent; say
whether anything else is sent early)? The dial at 0 / 40 / 80 ms RTT, cold vs resumed, n ≥ 6 per arm.

**63 · PT1 — one probe retransmission ~400 ms after every session opens.** A decrypted capture on the
workstation (a second WebTransport server measured the same way showed none in 18 opens) found this
branch's client sending one 72-byte `PTO_RETRANSMISSION` about 400 ms after the session opened, in 6 of
6 opens at 80 ms RTT and 4 of 6 at 0 ms. Which packet is it, why does its probe timer fire (an
unacknowledged packet the server never acks? an ack delay?), is it spurious, and does it cost anything
— a wasted packet, a congestion reaction, a delayed first frame? Report; fix only if the cause is ours
and the fix is small.

**64 · UP1 — lever 2 written up for upstream, not posted.** There is no upstream issue or pull
request for sending SETTINGS in 0.5-RTT from wtransport's server. Draft both — the issue (the
behaviour, RFC 9114's allowance, the measured dial 3.1 → 2.1 round trips, the blink phase row 61
studies) and a PR description for the patch as this branch carries it — in
`docs/transport/upstream-wtransport-settings.md`. **Do not post anything upstream**; the owner does.

### Rows 30–41

Queued 2026-09-18 from [`improvements/2026-09-18.md`](improvements/2026-09-18.md) — read it first;
**S-numbers below are its findings**, each with its evidence. Everything measured so far is
loopback, which makes round trips, slow start, loss and start-up free; the target is a phone's
browser on a 20–50 Mbit, 30–80 ms, lossy link, which charges for all four. The two goals stay
apart — a fill's time to all frames, one frame asked on an idle session — and memory counts as much
as time. An ask during a running fill stays parked. **Order is deliberate:** defects and gates
first, then the three proposals so that their approval overlaps the code rows, then what needs the
impaired link. A container's timings are reported, not decided on; where a verdict needs a real
RTT, say what the container showed and leave the exact cell to run — the workstation drives the
shaped-link VM and runs it.

**What a row may not change** (the owner, 2026-09-18). The work is judged on one comparison, on
one content: the same frames, the same lossless encoding, the same measurement, as the baseline.
So **the final image is bit-exact, always** — nothing lossy, no dropped channel, no alternative
source decode — and **the comparison's content and encode settings are fixed**. A lever may change
*when* bytes arrive or *what is shown first* (a smaller first image, a different order), as long as
every frame ends bit-exact. A row that would change the content, or that moves no figure the
comparison reports, is not queued; if a row drifts that way while you work it, stop and say so in
`## Blocked`. F2 (row 31) was such a row and should not have been queued; its fixtures stay for the
bench, and nothing further is built on them. E1 (row 40) is held for the same reason.

**30 · Q1.** Bump `quinn-proto` to 0.11.18 or later (S4): it fixes black-hole detection tripping on
ordinary congestion loss and pinning the MTU at 1200 for 60 s, and carries three security fixes.
Gate green; then grep every archived server log for `mtu=1200` and say how often past runs were hit.

**31 · F2.** The decode bench's sets are 8.7× too large for cine and compress 1.25:1 where CT does
~2.1:1 (S16), so block decoding is over-weighted in every decode number. Add two generator modes —
a dark sector with speckle, grey on all but ~1 % coloured pixels, at ~16:1; 12-bit-in-16 signed
with an air background at ~2:1 — and re-run `decode_bench` and `prefix_levels` on them beside the
old sets. Report what moves: per-frame decode, the copy-out's share, L19's bytes per level.

**32 · R1.** A cold open reaches its first byte in ~4 round trips, not the 2 the docs state (S5).
Write `docs/proposal-session-open.md`: the ask — a fill or one frame, and the study — carried in
the session URL so the server sends behind its accept; the server's SETTINGS sent at 0.5 RTT;
optional link and device fields in the same URL (S22). State what `WIRE.md` and the conformance
suite gain, what the WebTransport crate must expose or be patched for, and correct the round-trip
count where the docs state it. Then a prototype behind a flag, off by default; its timing waits on
row 36.

**33 · P1.** Write the proposal, build nothing: a pool that starts at one decoder, grows while the
decode queue stays non-empty and shrinks when idle (S12 — on the target's link one decoder keeps
up; sizing from core count sizes for loopback); and the reader pausing once queued compressed bytes
pass a bound, so QUIC flow control pushes back with no server cap and M3's fill window is not
needed (S15). Amend `proposal-downloader.md` and `client-shape-plan.md` M2/M3 rather than adding a
file. Include the capability rows each must not lose.

**34 · A1.** Write `docs/proposal-session-survival.md`, build nothing. Chromium never migrates a
WebTransport session (S2) and the client learns of a dead path only at the smaller idle timeout, so
L6's 60 s recommendation is also the length of the freeze. Cover: liveness triggers the platform
gives (`connection` change, `online`/`offline`, `visibilitychange`, `resume`) and a probe ask with
a deadline; re-dial and re-issue through the downloader's existing per-frame records; the idle
timeout and keep-alive as the detection bound against a phone's radio; a wake lock during a fill
and a deliberate close on `freeze` (S3). Re-run the rebind probe at a 10 s idle timeout for the
one measured number.

**Corrected 2026-09-22 — both halves of the sentence above.** "Chromium never migrates" is now read
from Chromium's source rather than assumed, and is an absent code path, not a device result; and
L6's 60 s does **not** set the length of the freeze — the browser's own 30 s does, and only a server
timeout below 30 s shortens detection (`proposal-session-survival.md` §The problem and §What this
means for the stack choice). The device is row 59.

**29 · L21, amended.** Three additions to the brief below. iOS: WebKit bug 319818 stalls a
connection after 16 MB (S1), so the fallback may be every iPhone, not ~5 % of networks — and the
route that keeps QUIC there is recycling the session before 16 MB and re-issuing; cost it. Racing
the fallback against WebTransport instead of detecting failure (S22), which makes the time to
rejection moot. And what a device check must show before any of this is built.

**25 · D6, amended — and its second half is now wrong.** The decoder is instantiated from a buffer
and its glue evaluated as text, so the engine's compiled-code cache can never engage (S13). "A
warm-up decode would not tier up" is **refuted by row 55**: one does, by 30–45 % of frames 0–2,
provided it runs the functions the real frames run.
Load it by streaming compile from an ES module build; report first-decode and frames 0–5 for a cold
HTTP cache, a warm HTTP cache and a warm code cache, apart, on a persistent profile.

**23 · D2d, amended.** Two additions. The downloader awaits every decoder before it dials
(`downloader.js`, `start()`; S6) — today's worker path does not, so adoption as it stands adds a
handshake to every cold start: dial first, keep dispatch gated on readiness, and show the
conformance suite still passes. And report time from worker start to `ready` for both transport
clients under a 4–6× CPU throttle: the WASM client needs ~300 KB before it can dial, the
TypeScript one ~16 KB.

**24 · D5, amended.** On F2's fixtures. While in `decoder.js`: `new Uint8Array(m.bytes)` copies a
view that is already a `Uint8Array` — a fourth copy D4's table omits (S14); remove it and report
the decoder workers' GC count and decode wall time with and without. The source build's wrapper
zero-fills its output and then clamps per sample (S19); the range belongs in that loop.

**35 · T1.** Bring onto this branch what `claude/clever-curie-flm0wi` has that does not depend on
its server: the path simulator and the rebind relay, the stream-shape and rig cell scripts, the
TypeScript client's ask window and its tests, `docs/transport/` and `docs/lanes/`. **Not its
`server/` or `patches/`.** Corrected 2026-09-19: this brief said that branch had measured its
per-byte work losing 29–38 % throughput without the per-core endpoints; the branch retracted that
(`6e2e113` — the revert had left the binary single-threaded) and now claims a native win with one
regression at depth 1, large frames, four sessions. Its server still does not come here: the
workstation is verifying those claims in a browser and on a paced link first. Gate green.

**36 · N1.** One harness that impairs both planes inside a container, no root: delay, rate, buffer
depth, scattered and bursty loss, a blackout, a rebind — for the UDP session and for the static
host's TCP. Validate it against arithmetic before trusting it: a cold open must read the round
trips R1 counted, and a 250 KB ask from a fresh session the ~5 flights S7 predicts. Say what it
cannot do (it forwards datagram by datagram, so nothing about batching is admissible).

**37 · R2.** Through N1 at 0 / 40 / 80 ms, cold and warm profile: navigation → session ready →
first byte → first decoded frame, for the harness on both clients and for the downloader (S6).
Then cut, one change at a time: the config fetch, one worker bundle and one decoder bundle,
`modulepreload`, and — needing no harness, land it regardless — compression and immutable hashed
names in `deploy/nginx`. Report serial round trips before and after.

**38 · W1.** One frame asked on an idle session is slow-start-bound for 50 KB–1 MB frames (S7).
Through N1, native client, 50 KB and 250 KB at 40 and 80 ms: a fresh session, a session warmed by
a fill, a session after a lossy fill, and after a rebind; then the two levers — bytes the viewer
needs anyway pushed at session open, swept by size, and a paced 32-packet initial window — with
loss and retransmissions reported per arm. Correct the "initial window ≤ 7 %" verdict in place: it
never measured this cell (finding file §3).

**39 · W2.** Behind the public `Controller` trait, no fork: an early slow-start exit for Cubic
(S8); then the persistent-congestion threshold against 0.5 / 1 / 2 s blackouts (S9) and
`initial_rtt` against cold-connect P95 / P99 at 1 % loss (S10). Cells: shallow and deep buffer,
with and without jitter; arms Cubic, Cubic with the exit, BBR. Hand S11's two BBR leads to the
controller lane's source review.

**40 · E1.** On F2's fixtures, a sweep over TLM markers with per-resolution tile-parts, and
code-block geometry (S18, S19): bytes, both decoders byte-exact, decode time, and that the TLM
lengths equal L19's boundaries with a decode truncated at a tile-part boundary identical to the
full decode at that level — mutation-checked. Then the tooling for S17's question, ready for when a
census of source formats exists: for a lossy-JPEG source, bytes and decode time of a lossless
transcode against the alternatives, with the maximum sample difference stated.

**41 · O1.** Two small ones. Does a WebTransport session dial, and a worker start, while
`document.prerendering` in headless Chromium (S20) — yes or no, on the page and in a worker. And
the fill asked in a coarse-to-fine order — every 8th frame, then every 4th … each frame still
decoded once (S21): time until every 8th frame is cached (through N1 once it exists) and what the
permuted order costs the read path under `--force-pool-reads`.

### Rows 42–52

Queued 2026-09-19 from [`improvements/2026-09-19-sweep.md`](improvements/2026-09-19-sweep.md) —
read it first; **S23–S46 below are its findings**, each with its evidence, and none is measured.
"What a row may not change" (§Rows 30–41) binds these rows too. The first sweep's rows measured the
target through an impaired link; these rows ask what that link's *model* hides, explain the one
number it produced without a mechanism, and open the production and iOS halves no rig has charged
for. **Order is deliberate:** the blink first because it is minutes of work and the largest cost
found; then the instrument, because three later rows wait on it. A finding is a claim until your
cell reproduces it — where it does not, correct the sweep file in place, as rows 38, 39 and 41 did.

**42 · W3.** W2 priced a 500 ms blackout at +5.4 s of fill and blamed the probe-timeout ladder.
S30 reads it differently, from `cubic.rs`: the harness fires the blackout while only the initial
window is in flight, Cubic anchors `w_max` there and never re-enters slow start, and arithmetic
reproduces all three rows within 2 %. Confirm or refute with the window itself (the session path
line's `cwnd`, or qlog): the blackout at three points of a fill — the first round trips, mid-fill,
the last — and across one 250 KB ask on a warmed session. Add a `bbr` arm to the same loop (S31:
never run; its source says it should not pay this). Correct `transport-conclusions.md` §3 and S9 in
place with what the cells show.

**43 · N2.** `link_impair.py` is what every container verdict stands on, and four things it does
are not what a radio does. Add, each read back against arithmetic and mutated as N1 was: jitter
that **does not reorder** (delivery clamped to non-decreasing) as a mode beside today's, which
stays as an explicit reordering lever (S26 — and its comment "as a real path does" goes); a
blackout that **holds and bursts** beside the one that drops (S33); an **idle penalty** — the
first packet after *N* ms without traffic waits *X* ms, each direction (S34); and **replay of a
delivery-opportunity trace**, one millisecond timestamp per MTU-sized opportunity, with a Poisson
option (S29). `rig-limits.md` §3 says what the relay now can and cannot stand in for.

**44 · H1.** Every dial here uses a ~450 B self-signed certificate. Build size-matched WebPKI-shaped
chains (ECDSA leaf + intermediate; RSA-2048) from a throwaway CA and refit `cold_open`'s first-byte
slope at two or three round trips (S37: does the RSA chain cost a round trip?). Turn on `rustls`'s
`brotli` / `zlib` features and capture headless Chromium's QUIC ClientHello: does it offer
certificate compression over QUIC, and does the slope come back (S38)? A leaf-only PEM: what the
dial costs, and a guard in `deploy/check_equivalence.sh` (S39). Then the static plane in
`lab/page-open`'s HOST mode: a second hostname behind a delayed stub resolver, and an HTTP/3 arm
with an HTTPS DNS record against today's (S40).

**45 · K1.** WebKit bug 319879: the server answers 200 and `ready` never settles — no error for
either client to catch (S23). Add a lab server mode that accepts the CONNECT and never completes,
and say what each client and the downloader do today; then amend
`proposal-session-survival.md` with a dial deadline and its retry, prototype behind the
downloader's dial. Second half, a table in `CLIENTS.md` (S24): every browser API the clients and
the four proposals rely on, whether WebKit has it, and what the code does when it is absent —
starting from Speculation Rules (correct S20's size in place: Chromium only), `navigator.connection`,
`deviceMemory`, `scheduler.postTask`, OPFS's seven-day deletion.

**46 · D8.** `client/downloader/decoder.js` instantiates from a buffer, so row 25's "the code cache
does nothing" tested a path where nothing could engage (S42). Instantiate by streaming (the static
host must send `application/wasm`), and re-run `lab/decode-first-frame/` over two and three visits
on a persistent profile: the first frame, frames 1–5, and whether the cache was consumed. Both
WASM modules. Parity byte-identical, as always.

**47 · P2.** An SDK-free page in `lab/` that takes the downloader's decoded `SharedArrayBuffer` to
the screen two ways (S43): the 2D-canvas route (a new RGBA `ImageData` at source size, an
`OffscreenCanvas`, `transferToImageBitmap`, `drawImage`) and a WebGL2 route (an 8-bit or `R16UI` /
`R16I` texture uploaded from the shared view, window/level as a uniform, one draw at display size),
honouring `devicePixelRatio`. **Prove the two pixel-equal** at identity and at a non-trivial window,
on cine RGB, signed 16-bit CT and a 12 Mpx 16-bit frame — mutated. A container's GL is software, so
report no timing as a verdict; the workstation and a device time this page.

**48 · W4.** After 43. W2's six controller cells on jitter that does not reorder, with a
`packet_threshold` arm (expose the setter as a flag; default unchanged) — is anything left of
8.6× / 25× (S26)? The slow-start-exit cells with a fill at least ten times the buffer, so the deep
queue actually forms (S28: S8 is not refuted until then). BBR against Cubic on a replayed trace
instead of iid loss (S27, S29). Correct `transport-conclusions.md` §1 and §3 in place.

**49 · I1.** After 43. With the idle penalty at 200 / 400 / 1 000 / 1 900 ms after 5 and 10 s idle:
what one ask on a warmed session costs, what the client's and the server's probe timers do with a
first packet that late, and what the inflated round-trip sample does to the *next* ask. A
keep-alive arm at 3 / 5 / 10 s against none, and a one-packet poke sent 100–300 ms before the ask
(S35, S36). This shows the stack's half only; the sizes and the battery are a device's.

**50 · W5.** After 42 and 43. S30's cells again on the hold-and-burst blackout: is there a
congestion event at all, and what does the outage-sized round-trip sample do to the probe timeout
at the next blink (S33)? Then, only if 42 showed Cubic paying and BBR is not simply the answer:
S32 behind a flag over the public `Controller` trait, as `hystart.rs` is — slow start restarted
when every lost packet predates a silence of two probe timeouts — with a cell at 1–3 % background
loss to show it does not misfire. Default unchanged.

**51 · C1.** A proposal, no product code (S41). Careful Resume for the reconnects S2, S3 and S30
make routine: what is saved and keyed on what, the unvalidated phase and the retreat, the
carrier-NAT risk, and how it composes with W1's push at open and the 32-packet window. **Settle
reachability first** — the controller factory is not told the peer, and `wtransport` 0.7.2 keeps
`quinn::Incoming` private — without a fork if one exists, else the crate patch specced as R1's
was. The deciding cells are `first_ask`'s fresh / warmed / resumed.

**52 · M1.** Last, and small (S44). Under headless Chromium's CPU throttle at 4× and 6×: renderer
collections and main-thread time per fill on the downloader's page side against its worker side,
and which per-frame page allocations in `client/downloader/consumer.js` account for them. The
crossing itself is already shown not to bind; do not optimise messages.

### Rows 53–56

Queued 2026-09-20 from the fourth identification round
([`improvements/2026-09-20.md`](improvements/2026-09-20.md) §Fourth identification round) — read it
first. "What a row may not change" (§Rows 30–41) binds these rows too. Three of the four are done
and merged; their estimates and what the bench said are side by side in that file, corrected where
they disagreed.

**53 · the wrapper pass.** D10, D11 and D13 are one edit to one file, so they were measured as one
set of arms rather than three rows. The estimate priced D10 on the colour frame; the colour frame is
the one it does not help. Adopted anyway, for the one-component sets that are the 16-bit series.

**54 · the second decoder.** Built, byte-exact and slower on both shapes, which is the answer the
row wanted: the incumbent being fast enough is no longer an unexamined claim. The arm stays in
`lab/decode-bench` so the next candidate has a harness; nothing in the product points at it.

**55 · the warm-up arms.** The estimate (150–200 ms of the cine fill) was half right and it splits
in two: a warm-up is worth 30–45 % of frames 0–2 whatever its shape, and the *shape* decides the
frames after them — a mismatched one is the single arm measured here that is worse than no warm-up
at all. It ships off because the gain is decode's and not the page's on this box, which is a
statement about the box: the deciding cell is a device whose decoders are up well before the first
bytes.

**56 · the first ask.** A decision, not a measurement — §3 already had the cells, and this row added
the queue-depth ladder, the idle cell and the stacking cell that bound each lever's cost. **It ends
undecided on purpose**: the push wants a page change and loses datagrams behind a shallow queue, the
window is free but loses one cell, and which matters depends on whether the session opens with a
fill or an ask. The confirming run on the shaped link waits on that choice.

### Row 57

Queued 2026-09-22 from what row 55 found on the way and left alone; **done the same day**, across
two branches, and it corrected the row's own premise on the way.

**57 · D16, a truncated or undecodable frame reaches the consumer as pixels.** The decoder wrapper
the client loads reports a parse failure by logging to the console and returning: an empty body, a
README and a 60-byte prefix each do it, and a truncated codestream decodes in full with no
complaint. The row was queued saying the frame then arrives as 0 pixels. It does not. The product
holds **one** `HTJ2KDecoder` for the whole session — which the lab measured as the right thing to
do — so `getDecodedBuffer()` still holds the **previous frame's pixels**, and they arrive under the
new index with `width: 0` beside them. 0 pixels is what a *fresh* decoder returns. **A wrong
picture presented as a right one is what the bit-exact guarantee forbids**, and the wrong picture
here is a real slice, from the wrong slice.

**Done (`claude/truncated-frame`, merged 2026-09-22).** Two checks, both inside the downloader's
worker graph, neither subsuming the other, and no new message kind or option — a failure rides the
`onError({frameIndex, reason, generation})` the downloader already had, and an asked frame rejects
its promise:

* **the wire**, in the TypeScript transport: `readEnvelope` reads the 4-byte index *ahead of* the
  codestream, so a uni stream that ends before the declared length can name the frame it lost and
  report `truncated: G of D bytes` through `failWaiter`. It used to throw where the pump swallowed
  it, and the fill waited forever while the consumer counted the rest as complete;
* **the codestream header**, in `decodeFrame`: `width x height x components x (bits > 8 ? 2 : 1)`,
  refused when it is zero or larger than what came back.

Measured before either was written: a codestream truncated to **25–60 %** of its bytes decodes to
the **full declared size, silently, with wrong pixels** — so no check on the decode result can ever
see truncation, and the wire is the only place it is visible. The header rule refuses **none of 129
real codestreams** across all four shapes the product serves, with the decoded buffer exactly the
declared size in every one. Dispatch **55 → 63** checks; five mutants written, five caught, the one
that matters being a truncation reported under the wrong index.

**Also done (`claude/truncated-frame-wasm`, merged 2026-09-22).** The three holes the first branch
left, closed on the second:

* **the WASM transport**, which returned `stream ended early` into a loop that broke. Its
  `read_length_prefixed_frame` now returns an `Envelope` — a frame, a named loss, or a clean end —
  and `fail_waiter`, the Rust twin of `failWaiter`, carries the loss to the asked frame's promise
  or the fill's `on_error`, with the reason string the TypeScript one byte for byte. The control
  stream's `FrameError` arm calls the same function, which replaced a 17-line copy of it. The
  package was rebuilt: `.wasm` **252 859 → 259 101 B, +2.5 %**;
* **`failAll` / `fail_all`**, which nulled a fill without calling its `onError`. Both now name
  **every index the fill still owed, once**, after the waiters are rejected, with the fill taken
  out of the session first — the media stream ending and `closed` settling are one event seen
  twice, and the first reason wins;
* **`--stream-mode per-frame`**, decided rather than deferred: it is **not narrowed**. A truncation
  there kills one uni where the downloader refuses the fill's whole still-owed run, but the client
  cannot tell the modes apart — the mode is a server flag, nothing in the handshake or the envelope
  carries it, and a uni that ends mid-frame looks identical under both. Narrowing it means a new
  wire field and a server change for a mode the measured cells do not use: a reason to prefer the
  shared mode, not to weaken the report.

Conformance **84 → 98** checks across both implementations and the downloader arm **46 → 53**;
**six mutants, six caught**, the two that matter being a truncation reported under `index + 1` and
a close the worker's fake never answers.

**Still open, and named.** The **BYOB** reader (`--features byob`, off by default and only
`cargo check`ed by the gate) still drops a truncated frame silently: `byob_fill` returns
`stream ended early` without naming the index it has already read in the head. And a codestream the
**server** truncated before framing it passes both checks — its envelope declares the short length
and its header parses — so only a per-frame hash on the wire sees it, which is row 15's K3.

**One behaviour change one level up.** A fill that a session death interrupts is now **failed, not
silently resumed**: those frames used to stay in the downloader's `wanted` and the next command's
re-dial re-issued them, and they are now reported to the consumer and dropped. That is what "a fill
that lost a frame is not complete" asks for, and the consumer is what must re-ask;
`client/downloader/downloader.js` `live()` only re-dials on a command, so nothing re-dials by
itself. `CLIENTS.md` §A truncated frame is a failure and §Fills are pushed, and
`decode/README.md` §A frame that did not decode, record what is measured.

### Rows 23–26

Queued 2026-09-18. **Two goals, measured apart:** the time a fill takes to deliver every frame, and
the latency of one frame asked on an idle session — plus memory, which counts as much as time on
the target device. An ask arriving while a fill runs is **parked**: do not measure it or tune for
it. All four worked on `claude/downloader-s2-worker` when they were queued; **since 2026-09-18 that
branch is merged here and they are worked on this one**, like every other row.

**23 · D2d.** The last row of the proposal's capability table is "not shown": every downloader run
so far is over the TypeScript client. The WASM package exports `TransportSessionHandle`; the seam
wants a module exporting `TransportSession`. Write that adapter, run `run_downloader.sh` and
`downloader.html` over it, and report a fill and a cold ask on both clients, interleaved. Done when
the row is green on both.

**24 · D5.** `decoder.js` copies each decoded frame into a `SharedArrayBuffer`, then walks it a
second time for sign extension and the sample range. In a fill the decoders are the bottleneck (S4:
the decode arm is decode-bound), so that walk is on the fill's critical path. Price it per frame at
512×512 RGB 8-bit and 512×512 16-bit. If it is more than noise, fold the range into the copy, and
show the fill is byte-identical against `.sha256` and faster, mutation-checked. While in the file,
correct its comment that no signed fixture exists — F1 made two.

**25 · D6.** A decoder's first frame may pay for its WASM code being compiled in stages. On fresh
instances in headless Chromium, compare the first decode with the steady state, per size. If the
first is slower beyond noise, decode a small built-in codestream at `init` and show the first real
frame no longer pays. Report it either way: this is one-frame latency, the second goal.

**26 · D7.** S4 measured 161 MB for the decode arm, 150 MB of it three decoder heaps at the
package's link-time 50 MB (L1). Point the downloader at the source build — F1's signed fix
included, emscripten pinned at 3.1.74 (L17) — and re-run S4's memory and fill. `parity.mjs` must
stay byte-identical on every set, signed included.

**Before adoption, not now.** A refused fill never reaching the consumer (D1r's hole), and a
signed study run through the downloader rather than the decoder alone. Neither moves a fill or a
single ask; both are owed before today's path is removed. `consumer.js` says fill frames are taken
at background priority and hands them over at once — correct that comment in whichever row next
touches the file, and do not build the priority.

### Row 27

**27 · L19.** The fixtures' codestreams are resolution-ordered (RPCL, one layer, one tile), so the
first part of a frame's bytes should decode to a smaller image. On a slow link that is a first image
after a fraction of the bytes — one-frame latency, the second goal. Decode side only; no transport
change. For 512×512 RGB 8-bit, 16-bit unsigned and 16-bit signed, and at each resolution level:

* how many bytes of the codestream that level needs;
* whether each decoder — the package and the source build — decodes that truncated prefix at that
  level, and by which call; if one cannot, say so rather than work around it;
* its decode time against a full decode, interleaved;
* that the result is byte-identical to decoding the **whole** codestream at the same reduced level —
  the ground truth, mutation-checked with a prefix one byte short.

Report the curve of bytes against level in `docs/decode/README.md`. Nothing is built into the
downloader or the clients until this says it works. **The next step is held**, whatever this row
finds: clients handing a frame's first bytes to the decoder before the frame completes waits on a
decision about how a smaller first image would be displayed.

### Rows 28–29

Queued 2026-09-18.

**28 · L20.** A viewer mostly opens studies nobody has read yet, and nothing here has priced that.
On a study whose frames are not in memory, measure one ask on an idle session (the first frame) and
a whole fill, each on its own, against the same study already read — interleaved, in the browser.
Force the misses the way `CLAUDE.md` requires: through the store's test levers
(`force_pool_reads`, `force_short_reads` in `frame_store.rs`), not page-cache eviction. They are
test-only today; if an end-to-end run needs one, add it as a lab flag, off by default, and show it
works by the server's own miss count being non-zero with it and zero without. Report what the miss
path costs; what real storage adds on top is the device's, and not this container's to claim.

**29 · L21.** WebTransport needs UDP, and some networks impair it (Chrome field data: ~5 %). There, a
client gets nothing at all. Write `docs/proposal-udp-fallback.md`; build nothing. It answers:

* **How fast a client knows.** In headless Chromium, time from `new WebTransport(...)` to rejection
  when UDP to the server gets no answer (nothing listening on that UDP port) and when it is refused.
  This is the one measured part: every second here is a second the viewer shows nothing.
* **What to fall back to** — for example a WebSocket over TCP carrying the same frames — and what
  each option loses against a QUIC session: independent streams, loss recovery, the idle-session
  behaviour L15 measured.
* **What it costs**: server and client lines, and whether one server can serve both.

The decision stays with the workstation.

### Rows 19–22

Queued 2026-09-16, evening, from what D1, D2, L16 and the signed-fixture note in §Blocked left. All
four work on `claude/downloader-s2-worker` or a branch off it, per the code-row rule above.

**19 · D2b.** D2's own suggestion, as a row: a conformance runner that installs a fake transport
*inside* the downloader's worker through `config.transport`, driven from the page over a
`BroadcastChannel`, so S1's 58 checks run against the downloader arm as they do against both
clients. Done when the downloader arm passes every clause the clients pass, each mutation-checked,
and the gate runs it. D2 is done when this is.

**20 · D2c.** The two behaviours D2 implements and nothing asserts: asks served before fill frames
when both wait for a decoder, and never more than two frames outstanding per decoder. Contention has
to be forced — slow decoders, not luck — or the ordering test passes by accident. Sign extension
waits for row 22.

**21 · D1r.** Two red rows. *Refusals*: `client/harness/refusals.html` becomes a gate test, headless,
with a mutant that drops one refusal. *An ask during a fill*, asserted on the client with the
server's real semantics from L16: the ask ends the fill, the asked frame arrives, and the fill's
undelivered frames arrive only if the client asks again. Today's clients do not re-ask, so write
the assertion and report it red rather than changing the clients — D3 is where that changes.

**22 · F1.** A signed 16-bit HTJ2K fixture whose expected samples do not come from the decoders under
test. One route to try, not a known answer: encode *unsigned* data (the encoder handles that
correctly), then flip the component's sign bit in the SIZ marker. JPEG 2000 level-shifts unsigned
components by 2^(B−1) before coding and signed ones not at all, so the same bits read as signed
should decode to `v − 2^(B−1)`. Prove the route with an independent decoder (OpenJPEG's
`opj_decompress` reads HTJ2K) before trusting it as ground truth. Then settle which of the package
build and `lab/decode-bench/wasm` is right on signed data, and make `parity.mjs` say what it covers.

**D3 inherits L16's finding.** On the wire an ask ends a fill with no saved position. The
downloader already keeps one record per frame, so after an ask it re-issues the frames not yet
delivered as a new fill — the client owns that decision, the server stays as it is. Proposal §The
downloader gains that sentence in D3's commit.

### L11 — decode in the harness

```
The harness does not decode: client/harness/index.html says "not clinical decode" and
shell.js touch() reads one byte per 4 KiB purely to make the copy real. That is why the
decode and pipeline questions have had no home here.

L8 built a decoder from source that is byte-identical to the package across 609 frames
and takes a 4 MB floor at 512x512. Use it. Wire a real decode path into the harness:
one pool, first-free dispatch (a free decoder takes the next frame; not round-robin),
sized from navigator.hardwareConcurrency rather than a constant.

Then measure the thing nobody has: first-free against round-robin, at equal width. It is
believed to matter when decode times are uneven and to be a wash when they are even. That
belief has never been tested in either direction. Uneven decode times are the device case,
so if it is a wash on uniform frames say so and then make them uneven — mixed sizes in one
pool — and measure again.

Report the per-frame split: time waiting for a decoder, time decoding, time for the page
to take it. They must sum to the total; a split that does not sum is not a split.

This is client-shape milestone M2 (docs/client-shape-plan.md). Structural: propose the
shape before implementing it.
```

## Answers

**`wasm-pack` cannot fetch `wasm-opt` in the cloud container** (2026-09-15, from L4). The build
compiles, then dies on `failed to download …/binaryen-version_117-x86_64-linux.tar.gz`. The URL is
reachable — `curl` gets 200 — so it is wasm-pack's own downloader not using the proxy, not an egress
block. Seeding its cache by hand works and costs a minute:

```bash
curl -sSL -o /tmp/b.tar.gz https://github.com/WebAssembly/binaryen/releases/download/version_117/binaryen-version_117-x86_64-linux.tar.gz
# the dirname is a hash of the URL; wasm-pack writes .<dirname>.lock before it downloads, so run
# build.sh once and read the name out of ~/.cache/.wasm-pack/
mkdir -p ~/.cache/.wasm-pack/wasm-opt-1ceaaea8b7b5f7e0
tar xzf /tmp/b.tar.gz -C ~/.cache/.wasm-pack/wasm-opt-1ceaaea8b7b5f7e0 --strip-components=1
```

It wants `<dirname>/bin/wasm-opt`. Any lane needing a WASM build per arm — **L2** — pays this first.
`rustwasm.github.io` is blocked by egress policy (403), so install wasm-pack with `cargo install
wasm-pack`, not the shell installer.

*Confirmed verbatim 2026-09-16 (L12), and the hash above is stable — seeding
`wasm-opt-1ceaaea8b7b5f7e0` by hand first meant `build.sh` never attempted the download.* Two
prerequisites the recipe does not mention, both missing in a fresh container: `cargo install
wasm-pack` ≈ 2 min, and `rustup target add wasm32-unknown-unknown` ≈ 3 s. The pkg build itself is
then 1 m 41 s, most of it `wasm-pack` compiling its own `wasm-bindgen-cli`.

**The SIGTERM tail was not lost where L5's brief said** (2026-09-15). `sink.rs` already had
`flush_on_exit` and a test for it; the rows that went missing were never in the channel. A `Tap`
buffers up to 63 rows before sending a batch of 64, and a session still open when the signal lands
never drops its `Tap`. Fixed by sharing each session's buffer so the shutdown can take it. Worth
knowing for **L6**, which also reasons about what an open session holds.

**L11's premise did not hold, so its wiring is proposed rather than built** (2026-09-15).
first-free beats round-robin only on a *short* uneven queue, and only on batch time, and only with
one frame of lookahead; plain first-free — the thing the brief asked to wire — is worse than
round-robin almost everywhere. `docs/proposal-decode-in-the-harness.md` says what to build instead.
**Still open:** the harness decode arm itself, and the decision it waits on — whether it uses the
published decoder or the build from source, since the pool cap depends on the per-instance heap.

**The product's client cannot keep its own session alive** (2026-09-15, from L6). The WebTransport
API exposes no keep-alive knob, so the server is the only end that can hold a browser's session
open — `--keep-alive-interval-ms` now exists for that, off by default until
`docs/transport/adr-idle-sessions.md` is accepted. An idle held session costs ~75 KB of server
memory, linear to 2 000. Relevant to **L11**, which holds a session across a viewer's lifetime.

**A cancelled fill leaves its waiters armed until `FRAME_TIMEOUT_MS`** (from L4). `endStream()`
stops the server sending but settles nothing on the client, so the promises sit for 15 s. Not
fixed: it wants a decision about what a cancelled waiter should reject with. Relevant to **L11**,
which will cancel fills for real, and to L6's lifecycle work.

**The gate passes end to end on this branch** (2026-09-16, from L12). `GATE OK`, no step failed,
nothing needed fixing. **10.2 s warm, ≈2 m 33 s cold**, the cold figure almost entirely two builds:
the default-feature test build (40 s) and the `release` build the server absence check needs (75 s).
Every later row pushes here, so run `scripts/gate.sh` before pushing — it is cheap, and it is now
known to catch things: four deliberate breakages were caught, one of them undoing L4's fix and
taking the whole gate down with it. Per-step timings and the mutation table:
[`improvements/2026-09-16.md`](improvements/2026-09-16.md). Two caveats for rows 8–14: the gate
covers **one arm of two** unless the WASM pkg is built first (see §Blocked), and a fresh container
has no `node_modules` — `client/transport-ts/build.sh` runs `npm install` itself, 1.9 s.

**A copy costs far more than a hop** (2026-09-16, from L13). The relay through the receive worker
is ~0.1–0.2 ms while that worker is quiet; a *cloned* 8 MB frame costs the page's main thread
**1.34 s per 237-frame burst against 17 ms transferred**. Anything downstream that moves frames
between threads should list the buffer, and **L14** should read this first: its arrangement 1
(copied out to a plain ArrayBuffer) is this repo's default and the expensive arm here, so L14's
memory answer and this latency answer may point the same way or oppose each other — say which.

**Two cautions for any browser lane here** (from L13). `performance.now()` is **5 µs** under
cross-origin isolation, so a one-tick difference is quantisation, not a finding — this nearly
produced two wrong answers in L13. And each context has its own `performance.timeOrigin` (48.8 ms
apart here), so only `timeOrigin + now()` compares across threads. **L18** counts allocations
rather than time and is not exposed to either, but **L14** and **L15** are.

**Headless Chromium works in this container, with two fixes** (2026-09-16, from L13).
`npm install -g playwright` (1.9 s) then `NODE_PATH="$(npm root -g)"`; its pinned build (1243) is
not the one installed (1194), so pass
`executablePath=/opt/pw-browsers/chromium-1194/chrome-linux/chrome` — `lab/thread-hops/run.mjs`
reads it from `CHROME_PATH`. `server/dev-server.py` already sends COOP/COEP, so
`crossOriginIsolated` is true and `SharedArrayBuffer` works. Chromium reaches for
`www.google.com` on start-up and the proxy denies it; harmless, silenced with
`--disable-background-networking`. This clears the way for **L14**, **L15** and **L18**.

**Keeping frames in the decoder's heap is worse than copying them out** (2026-09-16, from L14),
which is the reverse of what `docs/decode/README.md` assumed, and the wrong expectation is
corrected there. 108 MB against 517 for 87 × 768 KB; 217 against 1081 for 237 × 512 KB; 939
against 2042 for 64 × 8 MB. Two reasons, neither the pixels: a retained decoder holds its
codestream as well as its pixels, and **a WASM heap never shrinks**, so it keeps its high-water
mark and every transient along with it. This is the memory half of L13's latency answer and they
agree: **copy the pixels out, transfer the buffer, do not hand out a heap view.**

**L8's 4 MB floor is right only if the pixels leave the heap** (from L14). Copying out, it
reproduces the ladder exactly (4.0 MB at 512×512, 24.6 MB at 2048×2048). Retaining in it, it is
the *worst* build measured — 4.6–5.1× what it holds, against the package's 1.0–1.2×. **L17** tunes
that build and should not change the floor without saying which of the two it is optimising.

**`measureUserAgentSpecificMemory()` works headless and costs 10–16 s a call unless you ask
otherwise** (from L14). `--enable-blink-features=ForceEagerMeasureMemory` takes it to ~15 ms with
no loss of accuracy (checked: ±256 MB in a worker, and it still collects before counting). It
counts WASM heaps, plain `ArrayBuffer`s and `SharedArrayBuffer`s on one scale, in workers, with
per-realm attribution — so **L18** can use it for its heap high-water rather than only `--trace-gc`.
Also: the source build exports no `Module.HEAPU8`; use a `typed_memory_view`'s buffer instead,
which measures either build identically.

**D1 is done and three capability rows are not green** (2026-09-16), on
`claude/downloader-s1-capabilities`. The conformance suite goes 34 → **58 checks, both arms**, with
four clauses added and mutation-checked: both stream modes, `stats`, an ask long after the dial,
and a re-dial after closure. §Capabilities' middle column is filled there. What is not green, all
of it pre-existing rather than the downloader's doing:

* **refusals** — a browser page (`client/harness/refusals.html`), no gate test, so the row rests on
  a manual step;
* **an ask during a fill** — proven on the server, nowhere on the client. **L16** measures what it
  costs and could leave the client assertion behind it;
* **16-bit signed** — see §Blocked.

Also fixed there, found by one of the mutants: `transferable` awaited its frames raw, so a
shared-mode regression **took the whole suite down at `FRAME_TIMEOUT_MS` with nothing counted**
instead of reporting. Every frame wait is bounded now. Worth knowing for **D3**, which changes how
a fill's frames are delivered and will lean on exactly these clauses.

**D2 is built and running, and owes one thing** (2026-09-16), on `claude/downloader-s2-worker`.
`client/downloader/` plus `client/harness/downloader.html`, beside today's path with nothing
removed. Against the real server and 12 real HTJ2K frames, headless and cross-origin isolated: a
single ask decodes **byte-identical to the encoder's input**, a fill returns **12/12 all
byte-identical in 113 ms**, a cancel leaves the session serving, the stamps crossing two worker
boundaries are non-zero and in order, and a session opened after a closure serves frames again.
Mutation-checked both ways — one perturbed sample turns every `sha` line to `MISMATCH`, and
dropping every fifth frame makes the fill report 9/12.

**What it owed is done: D2b drives this arm** (2026-09-16, `09fcf32` on `claude/downloader-s2-worker`).
The clauses moved to `client/conformance/clauses.ts`, written against a **rig** — open a session,
drive the fake, count dials — so the same checks run wherever the fake lives. `fake-session.ts` is
the module `config.transport` names during a run: evaluated inside the downloader's worker, it
installs the fake `WebTransport` there and answers the page over a `BroadcastChannel`.
`run_downloader.sh` drives `downloader.html` in headless Chromium and **the gate runs it** (skips
loudly without Chromium, the WASM-arm decision applied again). **35 checks green**, mutation-checked
clause by clause — stamps zeroed, `end_stream` dropped, closure never noticed, a swallowed failure,
a dropped delivery, lying `stats`, a dial per command, a cached client, the fake left uninstalled:
each fails by name and the suite still completes. Two structural fixes fell out: the clauses now
catch a throwing clause (an abort counted nothing before), and `consumer.js` rejects `connect()`
on a start failure instead of hanging to `FRAME_TIMEOUT_MS`. The Node suite is unchanged in shape
and now reports **62/62** across both clients (was 58; two closure checks were split so each half
fails by name).

**One limit, found by a mutant that *passed*:** a frame posted without a transfer list arrives as a
clone that still detaches, so the page cannot tell move from copy across the worker boundary. The
downloader clause holds delivered-buffer semantics (movable, no sibling coupling); the copy cost is
**D4/S4**'s metric, not a conformance clause.

**This lands on D2c (row 20).** The rig and clauses are the place D2c's two assertions attach —
ask-before-fill ordering under forced contention, and the two-outstanding-per-decoder bound. Both
need a *slow* decoder to force the contention (the conformance arm runs `decode:false`, so a D2c
clause must install a decoder that stalls), not luck; write them as clauses over the same rig.

**D2c is done** (2026-09-16, `2ca9886` on `claude/downloader-s2-worker`), and it went its own file,
not the conformance rig: the rig hides the internal stamps D2c reads. `dispatch-rig.ts` drives the
downloader against `fake-decoder.js` — a decoder that stalls each decode, so the queue backs up on
purpose — and reads back the order each frame started (`decodeSeq`) and the most a decoder held at
once (`maxInFlight`). **9 checks green in the gate**, three clauses: a fresh ask starts right after
the frames in flight and before the queued fill; an ask for a frame *already* in the fill is
promoted (not re-asked, `promote()` — the bit L16 flagged); and no decoder holds more than
`perDecoder`, shown with one decoder and per-decoder with two. Mutation-checked: a fill-first queue,
a no-op `promote()`, and a raised outstanding cap each fail their clauses by name. This needed a new
`config.decoderWorker` seam (a decoder analogue of `config.transport`), and the page-side channel
client moved to `worker-fake.ts`, shared with the D2b rig. **D3 inherits the seam** — the same fake
decoder can hold frames while a re-issued fill is checked. The one row still unasserted is sign
extension, blocked on a signed fixture (§Blocked, row 22).

**D3 is done** (2026-09-16, `77e01f0` on `claude/downloader-s2-worker`), and its premise needed one
correction first. The brief said an ask ends a fill (L16); it does — a `stream_frames` fill. The
downloader was filling with `request_frames`, which `planner.rs` turns into one `Ask::Frame` per
index and serves in order, so an ask behind its 200-frame fill waited for all 200 and L16 did not
apply to it at all. The pushed fill therefore rides `stream_frames`: both clients gained
`fillFrames(from, to, onFrame, onError?)` — every owed frame straight to the callback, no waiter,
no timer per frame, `endStream()` or a later fill dropping the rest (`docs/CLIENTS.md` §Fills are
pushed) — and the downloader issues one contiguous run of what it still wants at a time and
re-issues exactly the remainder once an ask settles. An ask for a frame the fill still owes now goes
to the wire, where the server serves it next; one already in hand only moves up the decode queue.
**84/84** in Node, **46/46** on the downloader arm, **19/19** dispatch; seven mutants caught by name.
Lines: the pushed fill is *more* code, not less (downloader −24/+67, TS −8/+50, WASM −15/+93); what
it removes is a promise, a timer and a `waitExactFrame` round trip per frame at run time, and the
stray timeouts a cancelled fill used to leave armed — the L4 loose end, for pushed fills.

**Two traps, both from this lane.** A WASM mutant "passed" against a pkg that had not rebuilt — the
`cargo build` failure was behind a `| tail`; the pkg's timestamp gave it away, and the build was
re-run with its exit code read. And one gate run reported `dispatch: 16/17` with the failing line
swallowed by the gate's own `| tail -2`; eleven serial runs and two more gates since are 19/19, no
mechanism found. `drive_downloader.cjs` now echoes every `FAIL` on stderr so the gate cannot hide a
name again, and the one unbounded `open()` on that path is bounded at 5 s.

**This lands on D4 (row 18), now ready.** The measurement S4 names — an ask at 10 %, 50 % and 90 %
of a fill — is exactly where D3's trade shows: an owed frame asked on the wire costs the fill a
re-issue. And two things D4 must know: the recorder (`client/record/`) wraps `waitExactFrame` and
does **not** see a pushed fill, so its per-frame telemetry is blind to the downloader's fill path
until it wraps `fillFrames`; and `onError` on a refused range is wired in both clients and asserted
by nothing — the fake has no control-stream push. **D1r** (row 21) inherits that second one.

**D4 is done** (2026-09-16, `857ff54` on `claude/downloader-s2-worker`): `lab/downloader-campaign/`,
three arms against the real server in headless Chromium, arm order rotated, 8 rounds, 120 runs, no
errors, all container-measured. **Three clean sweeps** for the downloader over an 80-frame fill,
8/8 with ranges that do not overlap: the page's main-thread work **95 → 14 ms**, renderer GCs
**139 → 0**, page JS heap peak **59 → 31 MB**. **Two ties**: the fill itself (233 vs 230 ms, 5/8)
and a cold ask (4.98 vs 5.87 ms, 2/8, overlapping). An ask mid-fill waits ~35–40 ms behind the
in-flight window on both arms (L16 holds); on today's path the fill then **dies** (23 and 53 of 80
delivered at 10 % and 50 %), on the downloader it completes in a plain fill's time. The decode arm is
decode-bound on 4 cores — 472 ms per fill, no timing claim — and holds **161 MB, 150 of it three 50 MB
link-time decoder heaps** (L1): the L8 4 MB floor would make that ~12 MB, which is now a number with a
consequence. An ask during a decoding fill waits behind each decoder's two outstanding frames: 78 ms
at 10 %, the price of the D2c bound. The last column of the proposal's capability table is filled;
two rows are not shown on the new path — the WASM transport behind the downloader (the pkg exports
`TransportSessionHandle`, the seam wants `TransportSession`: a one-line adapter, unwritten) and
refusals (row 21).

**Two things the rig had to learn** (from D4). `measureUserAgentSpecificMemory` is absent from the
headless shell playwright launches by default; only an explicit `executablePath` launches the full
browser where it works — L14 had passed it and never said why. And the measurement forces a GC, so
CDP tracing must stop before it or the GC count includes it. `lab/downloader-campaign/run.mjs`
does both.

**D1r is done** (2026-09-16, `5b93cd5` on `claude/downloader-s2-worker`). Both red rows are green
against a **real server, in the gate**: `client/conformance/run_wire.sh` builds a debug
`exact-server`, packs 200 random 256 KB frames, makes its own cert under a temp dir and runs with a
2 MB send window, so the end of a fill is observable — nothing in the tree is touched, ~18 s warm.
`refusals.html`, both clients: 64 back to back, none lost; its mutant, one `frame_error` dropped in
the TS control pump, reports 63 of 64 with 1 timed out. `ask-during-fill.html`: on the raw client the
ask is served, the fill ends (28 of 120, then nothing) and the rest arrive only once asked again; on
the downloader the fill completes by itself, no frame twice. A planner that keeps the fill past an
ask is caught on the raw client (120 of 120) and survived by the downloader, which re-issues only
what is still wanted; a downloader that never re-issues reports 28 of 120. **One hole, found and
not fixed:** a refused *fill* never reaches the downloader's consumer — the session's `onError`
fails the run's records, but the consumer API has `onFrame` only. A refused *ask* does arrive with
its reason. This belongs to whoever takes the downloader past investigation.

**The `pkill -f` / `pgrep -f` trap bit twice more** (from D1r): both match the shell that runs them
when its command line carries the pattern, and the shell dies with 144. `pgrep -f "[e]xact-server"`
cannot match itself; kill by that PID.

**F1 is done** (2026-09-16, `352b82e` on `claude/downloader-s2-worker`), and it settles the §Blocked
question the other way round from what was recorded. The route the row proposed works: encode
unsigned, set each component's sign bit in SIZ (`lab/scripts/sign_htj2k.py`), and the same coded
bits decode to `v − 2^(B−1)` — **OpenJPEG 2.5's `opj_decompress`, an independent decoder, confirms
it exactly** on 16-bit (−21975 … 21863 from 10793 … 54631) and on 12-bit, where its raw writer keeps
12-bit two's complement in 16-bit containers; `ojph_expand` agrees, sign-extended. Two fixture sets
now exist, `decode_s512` (16-bit signed) and `decode_s12` (12-bit in 16), 87 frames each, with
`.sha256` ground truth from the encoder's input. Against them **the package decodes byte for byte
and already sign-extends 12-in-16 samples** — so `decoder.js`'s `finish` pass is idempotent on it.
**The source build was the wrong one:** its wrapper clamped every component to `[0, 2^B − 1]`
regardless of the sign flag, so negatives saturated to 0. Fixed in `htj2k_decoder.cpp`; parity is
**87/87 on both signed sets** against the package and the truth, and `parity.mjs` prints what it
covers and flags a run with no signed set. Mutants: the unfixed build fails the signed sets only;
a level shift off by one in the truth fails the encoder column only. The proposal's signed row is
green on the decoder; not yet run *behind* the downloader on a signed study.

**What this changes elsewhere.** L8's parity claim is now true on signed data too, after the fix.
L17 tuned a build whose signed output was wrong; its timing findings do not depend on the clamp.
The one thing still the workstation's: whether the product serves signed data at all.

**No row is `ready`.** Rows 5–7 are workstation lanes; D1–D4, D2b, D2c, D1r and F1 are done.

**Three things are implemented and asserted by nothing**, so D2 claims none of them: the ordering
of the two priorities under contention, the two-outstanding-per-decoder dispatch bound, and sign
extension — which cannot be asserted at all until there is a signed fixture (§Blocked).

**Useful to D3 and D4:** a real study is easy to make here — `pack-study` over
`lab/fixtures/decode_c512` frames renamed `NNN.htj2k` — and headless Chromium speaks WebTransport
to `exact-server` with the dev cert hash and no extra flags. The smoke study's frames are ASCII
placeholders, so they cannot exercise decode; use a packed one.

**Chromium advertises 30 s and then keeps the session alive itself** (2026-09-16, from L15). The
ADR's assumption was right — `max_idle_timeout 30000` in the parameters it sends — but it is not
idle: over a 45 s hold it sends a 29-byte ping at **15.0, 30.0 and 45.0 s**, each drawing a server
ACK, which restarts the idle timer at both ends. **A browser session survives 180 s of silence with
server keep-alive off**, given the recommended 60 s timeout. The ADR is corrected in place; its
status is untouched. Keep-alive still matters below ~15 s — the ADR's 5 s cell reproduces with a
real browser.

Relevant to **L16** and **D2/D3**: a session left open between asks stays up on its own, so a
viewer that dials early and asks late needs nothing from the server to survive the gap.

**A trap this container makes easy** (from L15). A backgrounded script of mine restarted the server
mid-hold and produced a clean-looking "45 s → dead" that was nothing of the kind. Any lane that
restarts `exact-server` between arms should check the flags on the running process before and after
each arm, and keep a control that is *expected* to die — a 5 s idle timeout here — so a rig that
cannot observe the failure is caught rather than believed.

**An ask does not overtake a running fill — it ends one** (2026-09-16, from L16), so L16's premise
did not hold and neither of its priority arms arises. `planner.rs` sets `self.fill = None` the
moment any ask is in hand, with no saved position, so the fill is discarded and never resumes; two
existing tests already said so. The ask waits **~3 ms wherever it lands** (27 rounds, 1.65–5.33 ms,
10/50/90 % indistinguishable) because it waits behind the four or five frames already in flight, not
behind the fill. What the fill pays is the rest of itself: an ask at 10 % discards 180 frames of
stated intent and the client must ask again.

This lands on **D2/D3**. The downloader's two-priority queue orders work *inside the client*, which
is right, but on the wire an ask already pre-empts a fill wholesale — so a downloader that issues an
ask mid-fill must re-issue the remainder itself or it will silently stop filling. Nothing in D2
does that today; its `promote()` moves a frame up its own queue and assumes the fill keeps coming.
**D3, which pushes fills, is where this has to be handled.**

`feat/set-priority-per-frame` (`f85f8a6`) does not apply: it is in the per-frame arm of
`write_payload` and never runs in `shared` mode. `--ask-priority` was already a rejected arm of the
transport lane.

**No build lever makes the decoder faster, and a newer emscripten makes it slower** (2026-09-16,
from L17). Rebuilt unchanged with emscripten 6.0.9 instead of the pinned 3.1.74, the same source
decodes **15.6 % slower at 512 KB and 16.0 % at 8 MB**, 0 of 8 and 0 of 6 rounds faster. LTO
recovers exactly that and no more (−1.2 %, +2.2 %, −1.6 % — three ties). **The emscripten pin is
holding about 15 % of decode time**, so moving it is a performance decision, not housekeeping.
Ties: a decoder object reused rather than per frame (the lane's own candidate for the largest
lever), and `wasm-opt -O4`, which emcc has already run. There is no newer OpenJPH. Worth taking
anyway: LTO is **16 % off the binary**, 200 KB against 239 KB, heap unchanged.

**A baseline of your own making is the trap here.** The first pass measured LTO at −17.8 % against
a `plain` build this lane had itself rebuilt with the newer toolchain, and that number is real but
means only "LTO undoes the regression". Any lane rebuilding `lab/decode-bench/wasm` should record
which emscripten it used and compare against the pinned one, not against its own rebuild — this
applies directly to **L2** and **L18**, which both rebuild the WASM client.

**Two toolchain notes** (from L17). `lab/decode-bench/wasm/build.sh` now builds any arm name it does
not recognise with `EXTRA_FLAGS`, which is how build settings are compared. And use the emsdk's own
`wasm-opt`: binaryen 117 (the one seeded for wasm-pack) cannot validate emscripten 6.0.9 output at
all, and `--all-features` yields a binary Node will not instantiate — pass the build's actual
features instead.

**byob allocates less than the default read path, and `byob-min` less again** (2026-09-16, from
L18) — the corrected premise holds. Over a 237-frame fill: **338 collections for default, 201 for
byob (−40.5 %), 165 for byob-min (−51.2 %)**, fewer in 5 of 5 paired rounds each, with JS heap
high-water ranges that do not overlap (default never under 70 MB, neither byob arm reaching it).
The free list the lane asked about is **not** written, because byob's churn is the smaller of the
two; a free list would help the default path more, and what it must decide — which thread hands the
buffer back, and when — belongs to the pipeline redesign.

That removes one of the two things holding byob behind its feature. The other is untouched: the
~12 ms first-frame cost (**L2**), still undiagnosed.

**Two things to know before running a browser lane here** (from L18). `--js-flags=--trace-gc` emits
nothing in this Chromium (141, headless) — not to the browser's stderr, not to the renderer's, with
`--single-process` and `--enable-logging=stderr` both tried. Use the `disabled-by-default-v8.gc`
trace category over CDP, as `lab/scripts/read_path_alloc.cjs` does. And CDP's `HeapProfiler`
sampler does **not** weigh `ArrayBuffer` backing stores, so it reads the same in every arm of a
buffer comparison and settles nothing.

**The conformance suite cannot drive a byob build in Node** (from L18): the fake transport's
`ReadableStream` is not a byte stream, so `getReader({mode:'byob'})` throws. Anything testing byob
arms needs a browser, and `client/transport-wasm/pkg/` must be left holding the **default** build —
a byob build there fails the gate's conformance step.

**One honest loose end**: a single `exact-server` test binary failed once during this session while
a server, a static host and a browser run were all loading the box, and has passed every run since,
including two full gates. The wire tests bind ephemeral ports, so it was **not** a port conflict and
no mechanism was established. Worth knowing if it recurs; not worth believing as a finding.

## Blocked

**The rig is not reachable from a cloud agent container** (2026-09-15). Rows 5, 6 and 7 — L2, L3 and
L7 — all say "needs the VM", and a cloud agent cannot get there:

* `~/.ssh/id_ed25519_rig_agent` is not present, and `~/.ssh` is empty. The key lives on the
  workstation; nothing puts it in this environment.
* Outbound traffic goes through an HTTPS proxy. A plain TCP connection to `168.138.130.163:22` does
  not open, so even with the key `ssh` would not reach it.

**Resolved from the workstation, 2026-09-15 — the rows are not blocked, only mis-routed.** Checked
there: port 22 on the rig is open, and both `~/.ssh/id_ed25519_rig` and `id_ed25519_rig_agent` are
present. So L2, L3 and L7 are workstation lanes, not cloud lanes, and the queue should stop
offering them. L2 needs no VM at all — it is a browser timing claim, and the workstation is the
timing rig every other number came from. Marked accordingly in the queue; a
cloud agent skips them.

The original diagnosis stands and is worth keeping: those three rows are `ready` in the sense that
their briefs are complete, and unworkable in the
sense that the only machine they can run on is not addressable from here. **What is needed:** either
the agent key placed in the cloud environment *and* egress to port 22 opened, or those lanes run
from the workstation. Nothing in this queue is a container lane any more — the four that were
(L4, L5, L6, L11) are done or, for L11, proposed with its measurement complete. Rows 8–14, queued
2026-09-16, are container lanes again.

**Should the gate hard-require the WASM arm?** (2026-09-16, from L12). `scripts/gate.sh` passes
and prints `GATE OK` with the WASM client unchecked, because both client steps test that arm only
if `client/transport-wasm/pkg/` already exists and the gate never builds it. Conformance is
**17/17 over one implementation** instead of 34/34 over two; the worker-safe check reads one
artifact instead of two — and the WASM clock is the bug that check was written for (`3396c28`).
Evidence and both outputs: [`improvements/2026-09-16.md` §2](improvements/2026-09-16.md).

**What is needed — a decision, because it is contributor-facing, not a local fix.** Building the
pkg costs 1 m 41 s here, against a 2½-minute cold gate and 10 s warm, and makes `wasm-pack`,
`wasm-opt` and the `wasm32-unknown-unknown` target hard prerequisites the README does not yet name
(T6). Three ways, cheapest first:

* leave it, and have the gate say loudly at the end that it ran at half strength;
* fail the gate when `pkg/` is absent, so the arm is skipped only by deleting it deliberately;
* build the pkg in the gate, and pay it on every cold run.

A cloud agent can implement any of the three in minutes once the workstation picks one.

**Decided 2026-09-18 — the second: the gate fails when `pkg/` is absent.** Both client steps now
require the WASM artifacts rather than testing them only if present, so conformance runs over two
implementations or not at all. The build is paid once per clone, not per run, and there is no CI
here to pay it cold repeatedly. `README.md` §Prerequisites names `wasm-pack`, `wasm-opt` and the
`wasm32-unknown-unknown` target, which closes T6. The same pass added a `cargo check` over
`byob-min,byob-count`: nothing built the BYOB read path before, so a path L18 and L2 are still
working on could break unnoticed.

**No signed fixture can be made with the encoder in this tree** (2026-09-16, from D1), so the
capability row "16-bit signed with sign extension" cannot be tested at all — and signed 16-bit is
ordinary medical data, so this is a real hole rather than a formality. `lab/scripts/gen_htj2k_fixtures.sh`
has no signed mode, and `ojph_compress -signed true` over its raw reader does not survive its own
`ojph_expand`: every negative sample saturates to the bottom of the range, at 12- and 16-bit alike,
with in-range data. So there is no ground truth, and **D1 makes no claim about how either decoder
handles signed data**.

What is measurable without ground truth, and is worth someone's attention: **the package build and
`lab/decode-bench/wasm` disagree on the same signed codestream** — the package saturates every
negative sample to 32767, the source build does not. `parity.mjs`'s byte-identical result therefore
covers unsigned data only, which qualifies **L8**'s parity claim and bears on **L17**, which tunes
that build against it.

**Corrected 2026-09-16 by F1, in place.** That disagreement was read off codestreams the encoder's
`-signed true` path had already damaged, and it was the wrong way round. With a valid signed
codestream and ground truth from an independent decoder, **the package is right and the source
build was wrong** — its wrapper clamped negatives to 0 — and is fixed. The row is no longer blocked;
see the F1 note in §Answers. What stands from the original: `parity.mjs`'s 609-frame claim was
unsigned-only when it was made, and L8's parity claim needed the qualification.

**F1 has not reached this branch, and L19 wants it** (2026-09-18). Row 27 asks for 512×512 RGB
8-bit, 16-bit unsigned **and 16-bit signed**; the first two are done and reported. Signed cannot be
run here at all: `gen_htj2k_fixtures.sh` on this branch has no `s512`/`s12`, and the source build
still carries the clamp that saturates negatives to 0, so even with fixtures its signed column
would measure the bug rather than the decoder. Both fixes are `352b82e` on
`claude/downloader-s2-worker`, and they are lab tooling only — no downloader code — so they are a
merge, not a port. **What is needed:** that commit on this branch, after which the signed third of
L19 is one bench run.

**Resolved the same day.** F1's eight shared lab files were taken onto this branch —
`sign_htj2k.py`, the `s512`/`s12` generator, the clamp fix, `parity.mjs` and their fixtures —
leaving `proposal-downloader.md` on s2, because that file is the downloader's and this is not an
adoption. L19's signed arm then ran: `s12` at 23.8 % for level 1, and `s512` identical to `g512`
because F1's method leaves the codestream one byte different. Row 27 is done.

**What was needed, and F1 supplied:** a signed HTJ2K fixture from a source other than the encoder's
`-signed` path — made by encoding unsigned and setting the sign bit in SIZ, confirmed by OpenJPEG.
`parity.mjs` now says what it covers. Still the workstation's: whether the product serves signed
data at all.

**Coalesce the decoded frames across decoders — design it, or drop it?** (2026-09-25, from row 76, PH1).
The row's change, fill frames coalesced, cannot be made small: each decoder posts to the page itself,
and on a slow CPU no decoder ever has two frames in one animation frame, so batching per decoder
batches nothing (`proposal-downloader.md` §The hand-off). Batching across decoders needs a point they
all pass through — a hop through the downloader, or a shared ring the page reads per animation frame —
which changes §The decoders' shape. Its ceiling at 4–6×, every thread slowed: the dispatch of the 15–33 %
of frames that share an animation frame, about 10 ms of a fill's main thread; less on the target link.
The product's real page cost is 0.15 / 0.84 / 1.15 ms a frame at 1× / 4× / 6× (page-only throttle), not
0.28 / 2.5 / 3.7. **What is needed:** whether a proposal for the merge point is wanted at that price. Not
built meanwhile.
