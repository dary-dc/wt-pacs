# Cloud queue

A place to hand work to a cloud agent between sessions, and for it to hand results back: the order
and the state of the work, and nothing else. What a finished row found lives in the doc that owns its
subject (the index is in `README.md` §Docs); every retired brief and note is in the history before
the commit that folded it.

## Protocol

**The queue lives on `claude/unified-2026-09-23`**, the one branch that carries every lab
improvement. **Work the `ready` rows top to bottom — the table is in priority order, not number
order.** Several agents may work the queue at once; the claim commit is the lock.

**New session?** Read `CLAUDE.md`, then `README.md` §Docs for which doc owns what, and
[`rig-limits.md`](rig-limits.md) §6 for the instrument traps that have already cost time.

**You are the cloud agent.** After you finish a lane and push:

1. `git fetch && git rebase origin/claude/unified-2026-09-23` — the queue changes while you work.
2. Read the table below. Take the **topmost row marked `ready`**.
3. Edit that row to `claimed` with the date, commit it alone, push it. That is the lock; if the
   push is rejected someone took it first, so rebase and take the next one.
4. Do the lane. Push your work.
5. Set the row to `done` with the commit — the hash **after** the rebase that pushed it — and
   **add anything you learned that changes another row**: a lane that is now pointless, a
   prerequisite that turned out missing. Push.
6. Go back to step 1. Stop when no row is `ready`, and say so in your final message rather than
   inventing work.

**Rows that wait.** `after N` becomes `ready` when row N is done; the agent that marks N done
flips it in the same commit.

**What a row may not change** (the owner, 2026-09-18). The work is judged on one comparison, on one
content: the same frames, the same lossless encoding, the same measurement, as the baseline. So
**the final image is bit-exact, always** — nothing lossy, no dropped channel, no alternative source
decode — and **the comparison's content and encode settings are fixed**. A lever may change *when*
bytes arrive or *what is shown first* (a smaller first image, a different order), as long as every
frame ends bit-exact. A row that would change the content, or that moves no figure the comparison
reports, is not queued; if a row drifts that way while you work it, stop and say so in `## Blocked`.

**The downloader lives beside today's path, and the merge is not an adoption**: nothing today's
path does has been removed ([`ARCHITECTURE.md`](ARCHITECTURE.md)). Adoption is the workstation's
call. A code row that finds the design wrong stops and says why in `## Blocked` rather than building
a different shape.

**Answering a question rather than running a lane.** Answer it in the doc that owns the subject,
push, and mark the row done with one line saying where.

**Asking for something.** If a lane is blocked on a decision only the workstation can make, add an
item to `## Blocked` saying what you need, push, and move to the next `ready` row. Do not wait.

**A commit message holds the change and nothing else** — no attribution, co-author or session
trailers. This is the owner's rule for every repository.

**This repository is public.** Never name the other implementation or any part of its stack, and
never describe its internals — in code, comments, docs, file names, branch names or commit messages.
The term scanner that checks it runs on the workstation, not in a container.

## Queue

| # | what | brief | state |
| --- | --- | --- | --- |
| 83 | **RP2** — the range skipped in the pack where nothing reads it (8-bit colour) | queue §Rows 83–86 | **done** 2026-09-27, `acc65e6`: `pack<T, Ranged>`; `decoder.js`'s `unranged` gives the frame 0..255 with no pass, whichever decoder (the package's colour frames too — nothing reads it); parity bit-exact on six sets, 522 frames, new `g8` set; six mutants caught. The colour WASM call back to the pre-row-80 figure (a tie), 16-bit unchanged — container figures, under the 5 % bar. `decode/README.md` §An 8-bit colour frame takes no range. **Row 84 benches against this wrapper.** In a container, `wasm-pack` cannot fetch its `wasm-opt`: put emsdk's `upstream/bin` on `PATH` |
| 84 | **WEX** — `-fwasm-exceptions` instead of `-fexceptions` in the decoder builds | queue §Rows 83–86 | **done** 2026-09-27, `4957d5a`: **not adopted, default unchanged.** Bit-exact (six sets, 522 frames; an undecodable frame throws and the reused decoder recovers, as before); all 81 `invoke_*` sites gone; steady −0.2 to −1.7 %, frames 0–2 a tie, Node and headless Chromium, n = 15 — under the 5 % bar. 4.9 KB less glue is its only case. `decode/README.md` §Faster; `lab/decode-bench/cold_arms.mjs` is the cold-frame bench. Measured at 1× only; a phone-class CPU is the workstation's cell |
| 85 | **WU2** — the decoder warm-up, sized again for a slower dial | queue §Rows 83–86 | **done** 2026-09-27, `a040a73`: the shipped 160² frame is the one to ship — **6.0–6.5 ms a decoder at 1×, 28 at 4×**, saving 4.5–4.8 / 21–24 ms on frame 0; frame 0 breaks even at **1–7 ms** of idle window and the warm-up hides entirely at 6.5 / 28 ms; a 512² or own-shape frame costs 2–3× for ~6–10 ms more on the second frame at 4×. Every frame now carries `stamps.decoderReady` (three mutants caught). One decoder, headless shell, the package. `decode/README.md` §Sizing the warm-up. **Default unchanged — per transport, the workstation's call, read off the stamp.** The gate's `autoWithoutStatsReadsIdleAsks` (transport-ts, wall-clock timers, untouched here) failed once (depth 10 for 8) and passed on the rerun |
| 86 | **PROF** — link profiles close to a phone: a rate trace, bursty loss, a deep or managed queue; the controllers on them | queue §Rows 83–86 | **done** 2026-10-02, `2cf0354`, `e2190d0`: `profile_cells.sh` — 8 profiles through the relay (3 mahimahi LTE traces fetched not committed, sha256 in the doc; Wi-Fi step traces; GE bursts of 3.5; FIFO in ms; CoDel 5:100 variants; a quinn-Cubic neighbour in LTE-loaded and Wi-Fi busy; a 200 ms held outage for LTE-moving); a 250 KB first ask then a 30 s fill with a queue probe; Cubic · BBR · bounded, `order.py`, 5 rounds, `--self-timing`, 10/120 `VOID` dropped. **BBR ties or beats Cubic on every profile, 0.97–2.26× the fill (uniform 1 % control: 7.29×), its first ask −84 to −219 ms on LTE every round**; Cubic at 0.5 % bursty Wi-Fi fills 10.4 of 22 Mbit. **CoDel halves Cubic on LTE-good (16.2 → 8.3 Mbit, queue 360 → 4.7 ms); BBR ignores its drops (6.6 %) and keeps 200 ms.** **The bound keeps 1 % (0.07 Mbit) behind a neighbour on LTE-loaded's 1 s FIFO**, ties Cubic on Wi-Fi busy, else BBR's fill with Cubic's queue. LTE-loaded stands 0.6–0.7 s of queue for every arm (Cubic's ask 6.1 s). Loss/FIFO values are the brief's knobs, not fitted; 30 s fill rate, not 61 MB. No default changed. `transport-conclusions.md` §1 PROF, §9 item 2; `rig-limits.md` §3 (GE model read back: burst 0.95–0.99 of 1/r, iid mutant 0.14–0.29) |
| 87 | **ENC** — what compression costs on a fast link, and whether an encoding makes it free | queue §Rows 87–88 | **done** 2026-09-27, `badcf76`, **corrected** the same day: **no encoding is resolvably later to the first frame on loopback**, at 1× or 4× (6/20 to 11/20; gzip and zstd tie, brotli leans later, +23 ms at 4×, 6/20). The cost that shows is the network service's decoding — brotli +10 ms CPU a visit in 16–18/20 — and the decoder WASM's preload, +26 to +48 ms at 4× (1/20 for gzip and brotli). A streamed compile still resolves 2–5 ms after its last byte in every arm. Break-even 206–700 Mbit/s at 4×; **gzip is within noise and keeps 92 % of brotli's saving** — one mode, always on. zstd needs Safari 26.3 (MDN compat data). No default changed. `lab/page-open/README.md` §What an encoding costs on loopback, `enc.mjs`; the page takes `?transport=wasm` and `?meta=`. *The first two batches were biased:* the precompressed copies were seconds old, so every worker fetch in those arms revalidated (a 304) — a file's heuristic freshness is a fraction of its age; corrected in place, and a trap in `rig-limits.md` §6. **For row 88:** give every file the page or its workers fetch an age or a lifetime, or its worker fetches revalidate; `run.mjs` rewrites the config before each visit, which may be why PO1 saw it fetched twice (unchecked). In a container: `apt-get install nginx libnss3-tools brotli zstd`, and `npm i -g binaryen@117.0.0` for `wasm-pack`'s `wasm-opt` (apt's 108 builds a WASM client whose externref table cannot grow) |
| 88 | **H2** — does HTTP/2 serving take the worker's script off the socket queue | queue §Rows 87–88 | **done** 2026-09-27, `bde3e52`: **HTTP/2 removes the socket wait, and only that** — on the bare page the wait falls on the downloader worker's first import, 89 ms queued over HTTP/1.1 against 1 ms, −64 ms to the first frame (994 → 930, 10/10); the chain stays serial. **The page's hints are the larger lever**: today's preloads over HTTP/2 put the first frame at 481 ms (−449 against bare); over HTTP/1.1 each preload pays its own connection's two round trips (632). A `modulepreload` of the worker graph alone recovers the module hops, not the glue or the WASM (763 on HTTP/2). **Deciding: the serving change needs the page change** — cut 3's preloads, over HTTP/2. `lab/page-open/README.md` §The worker graph over HTTP/1.1 and HTTP/2, `h2.mjs`. The instrument is the relay, not DevTools emulation: that does not reach a page's workers' `fetch()` and charges no connection setup; the relay's TCP plane gains `--tcp-rate shared` and no longer drops bytes under a rate (no published cell set one), `rig-limits.md` §3 and §6. PO1's config round trip was the harness's (a config rewritten before each visit revalidates), corrected in place |
| 89 | **SE2** — the SETTINGS-early patch on the library's other server entry point | queue §Rows 89–90 | **done** 2026-09-28, `69d4f5d`: both entry points share one 0.5-RTT `accept`, which takes the `quinn::Connecting` (22 lines in `endpoint.rs`; the probe patch untouched). `settings_ride_the_handshake_flight_from_a_quic_connecting` is the second path's test: the old patch fails it and passes the first; the driver started after the handshake fails both. `ARCHITECTURE.md` §Lever 2 corrected in place, quoting the workstation's 5.19 → 4.19 (not re-measured: this server uses `Endpoint::accept`); the upstream draft carries the new diff and test, not posted. A client-side `Connecting` handed to `with_quic_connecting` would hit the patch's `unreachable!` — misuse, but an upstream reviewer may ask for an error instead |
| 90 | **ORD** — a balanced arm order and a by-predecessor split in the lab's interleaved campaigns | queue §Rows 89–90 | **done** 2026-09-28, `abc55e6`: `lab/order.mjs` and `lab/scripts/order.py` (`order.py row N ROUND` for shell) — a Williams square, each odd-N row alternating with its mirror, so a campaign cut short stays within one of balance at every length but exactly N rounds. Page-open, the link campaigns and the decode benches (24 files) take it by default, record each visit's predecessor, and print each paired lead split by it with `UNBALANCED predecessors` on a tilted cell. `node lab/order.test.mjs`, now in the gate: five mutants caught, among them the fixed cycle; against `first_ask_cells.sh together` (five arms, six rounds) the new order flags nothing and the fixed one flags every lead. `rig-limits.md` §6 has the record, a table of where each doc names its driver's former order (those figures left as taken), and the drivers outside the row's three groups, not converted (downloader-campaign, stream-shape, session-*, thread-hops, telemetry-cost and others) — a row of their own if wanted. The gate's `auto without getStats` client test (wall-clock timers, untouched) failed once more (depth 10 for 8) and passed on the rerun, as in row 85 |
| 91 | **BBF** — the bounded BBR's floor: does an all-time minimum RTT pin it at 4 packets on a jittery link | queue §Rows 91–100 | **done** 2026-10-01, `3a221e5`: **yes at ±20 ms, no at ±10.** `controller_browser_cells.sh jitter10|jitter20` (ordered jitter, no loss, 20 Mbit / 80 ms / 200 packets, 40-frame fill, 7 rounds under the host lock, `--self-timing`, VOID dropped): at ±20 the bound fills in **79.9 s [12.6–281.4] against Cubic's 7.62, +156.9 s paired, 0/3**, four of seven ending at the 5.8 KB floor; at ±10 it never reaches the floor, +0.70 s against BBR, 1/7 (+0.74 s, 1/6, in 120-frame fills). **A 10 s windowed minimum (`--bdp-rtt-window-ms`) does not rescue it**: −4.6 s against the bound, 4/7, also 4/7 on the floor — a jitter trough recurs inside any window; the all-time-minimum mutant is the bound's own arm, and the unit test fails when the window never expires. `transport-conclusions.md` §1 BB2 corrected in place, BBF, §8, §9 item 2. **For other rows:** the bound is no longer a candidate as built, so rows 99/100 and 86's managed-queue cells need not carry it as one; row 97's open question (the bound's ask tax) is unmeasured still — its stream-shape cell logs no window, this cell does. **Instrument:** at ±20 ms the relay ran p99 1.03–1.21 ms late in every BBR run and 4/7 Cubic runs (VOID) — a full 20 Mbit link with ±20 ms ordered jitter is past what it times on this host. The gate's comment budget fails at the tip on `lab/order.mjs` (0.26, row 90's), not this row's |
| 92 | **RLY** — the relay as a phone link: a self-timing guard, an opportunity-trace player, a queue in bytes | queue §Rows 91–100 | **done** 2026-10-01, `3ebfd14`: `link_impair.py` gains `--self-timing` (each send's lateness, p50/p99/max, `VOID` over 1 ms), `--rate-up-kbit`, `--trace` (mahimahi format, the server→client clock on both planes; unused opportunities lost, small packets share one; `READY` prints its sha256 and `epoch=`) with `gen_step_trace.py` (steps, outages, grant cycles such as `0:9 400000:1`), and `--queue-bytes` / `--queue-ms`. Every 100 ms bin of a step trace exact at 2× its mean; eleven mutants caught; the full `link_impair_check.sh` passes, its round-trip counts unchanged (3.02, 5.47). **The loop waited on epoll, which rounds up to whole milliseconds: packets left up to 1 ms late (p99 0.74–1.03 ms); now `select()`, 0.13–0.26** — `rig-limits.md` §3 corrected in place, a trap in §6. **For rows 94–100:** run every relay cell with `--self-timing` and drop a `VOID` one — with other agents' builds and browsers on this box the p99 crossed 1 ms in several runs; with a trace on the TCP plane use `--tcp-rate shared`; sizes are UDP payloads (~2 % under a trace's IP packets). Row 96's rate step is a trace anchored at the relay's start (`epoch=`). `scripts/comment_budget.sh` fails on `lab/order.mjs` (0.26, row 90's), not touched here |
| 93 | **DL0** — the dial started from the HTML, not after the config | queue §Rows 91–100 | **done** 2026-10-01, `5782c12`, `5896c08`: **the brief's arm cannot be built — a `WebTransport` cannot be cloned or transferred to the downloader's worker** (Chromium 141, `DataCloneError` both ways). Two lab rungs instead: `inline` (the URL in the page, no config fetch) is **−1.24 round trips to the first frame against `r1` at 1×, −0.73 at 4×** (−51 ms at 80, 4/4; −129 at 160; a tie at 40); `dial0`, a head dial timed to `ready`, has its session **~2 round trips before `inline`'s** (−167 ms at 80, −334 at 160, every paired round, both throttles) — the worker graph's boot, which only a new shape collects; that question and inlining the URL are under `## Blocked`. 100 Mbit relay, 9 rounds Williams-ordered, a self-timed relay per visit, 31/108 (1×) and 21/108 (4×) VOID dropped; missing- and wrong-URL mutants fail, a config-fallback page is caught. **Unshaped, the relay is VOID in most browser visits** (bursts, not preemption — `chrt` did not help): `rig-limits.md` §6. `run.mjs` was revalidating a seconds-old config every visit (H2's trap) — the R-ladder's absolute counts high by 1–2 round trips, corrected in place; it now ages the file, and takes `THROTTLE`, `RELAY_ARGS`. `lab/page-open/README.md` §The dial before the config |
| 94 | **BYM** — a frame read whole (`read(view, {min})`) on a link that delivers in bursts | queue §Rows 91–100 | **done** 2026-10-01, `9f906c0`, `5337755`: **the regime reproduces under smooth pacing, not bursts** — through the relay a uniform 40 Mbit trace gives the default reader 42 reads a 250 KB frame and 72–74 a 410 KB one; grant bursts of the same mean only 6–10 (`browser_reads.py` takes `RELAY=`, `rig-limits.md` §1). `readMin` (opt-in BYOB, each frame straight into its wire buffer; the downloader passes it; `stats().mediaReads`) on 87 16-bit 512² frames, Dw and Dd, 1× and 4×, 8 rounds, Williams order, self-timed (7 of 128 `VOID`, dropped), every frame's sha256 matched: **whole frame −191 to −227 ms of downloader CPU a fill (all rounds, 2 reads a frame), 64 KB −156 to −192, 16 KB −119 to −157; renderer peak −36 to −41 MB (all rounds)**; fill time and frame 0 tie (4× Dd frame 0 +7/+11 at 64/16 KB, 2/7); context switches −5 to −8 % only. The cgroup throttle does not inflate on-CPU time, so the 4× rows read as 1×. Three client mutants caught (`min` ignored, a cut's bytes dropped, the truncation unnamed), and a flipped byte reads 87/87 wrong in the campaign. **Default unchanged — the workstation's call**; K is bounded by `stallMs` (whole 410 KB frame ≥ 1.1 Mbit/s). Row 5's WASM-path 12 ms not rechecked. `CLIENTS.md` §Reading a frame whole |
| 95 | **IDL** — one radio's idle penalty in the relay, and a wake sent on the first touch | queue §Rows 91–100 | **done** 2026-10-01, `ece7e89`, `e534009`: `link_impair.py --idle-promote S:P` — after S quiet seconds the next UDP packet either way holds both directions P ms (the blackout's hold; active from the relay's start; the TCP plane neither wakes nor waits). Read back: idle 6 s at 5:300 → 341 ms rtt, idle 4 s → 40.6; a server reply that ends the quiet holds a client packet sent inside it (2 062 ms, 1 840 if one direction); five mutants caught; the full `link_impair_check.sh` passes, round trips 3.01 / 5.49. `first_ask --wake-lead-ms L` and `first_ask_cells.sh wake` (11 arms, 7 rounds, 80 ms, 250 and 50 KB, `--self-timing`, 21 of 154 runs `VOID` and dropped): **every cell base + max(0, P − L) within 4 ms**, P = 80 and 300, L = 0/50/100/200; with the datagram dropped every lead reads +299–301 (mutant caught). Plumbing only — the page's `pointerdown` wake is not built, and S, P, the overlap and the energy need a device. `transport-conclusions.md` §3 (IDL) and §9, `rig-limits.md` §3. `round_robin` now prints a paired lead and drops `VOID` runs. **For row 49:** `--idle-promote` is the idle penalty, and `first_ask --idle-ms` past S triggers it |
| 96 | **STW** — the window kept through a silence, when the link got slower meanwhile | queue §Rows 91–100 | **done** 2026-10-01, `fe9994e`: **the kept window wins** — a trace 40 → 8 Mbit inside an 8 s silence, 250 KB, 60 ms, 50-packet queue, 9 rounds (5 of 45 `VOID`): plain Cubic 340.9 ms, faster than a session warmed at 8 Mbit (382.8, 7/7); the derived loss storm did not happen. New `--congestion cubic-idle-restart` (slow start on the first send after 4 RTT with nothing in flight; five mutants caught) +39.6 (1/6), a tie with the slow link. **`cubic-restart` misfires on an idle spell**: +489.6 (0/5), it reads the first flight's overflow as an outage and rebuilds at the initial window — a cost beyond §After a blink, for row 50. `transport-conclusions.md` §3 STW, §9 item 4. One step, one depth; 40 → 2 or a shallower queue not run. No default changed |
| 97 | **TAX** — the ask's controller and pacing tax over a rate-limited queue | queue §Rows 91–100 | **done** 2026-10-01, `d6068e9`: `lab/stream-shape/run.mjs --tax`; arms `ws` (WebSocket through the relay's TCP plane, the ideal-TCP floor, +1.6–1.7 ms over RTT + size/rate), `cc:`, `iw:`. 131 KB depth-1 asks, 60 ms, 50-packet queue: **Cubic +0.7 ms (7/7) at 15 Mbit, +11.8 (7/7) at 25** (the ask under one BDP; consistent with the pacer, not measured); iw 38 400 only changes the first ask (284 → 197); **bounded BBR +103.6 / +76.8 on every steady ask, no loss, no neighbour** (for row 91). 1 of 32 and 15 of 62 runs `VOID`. The floor arm dialled past the relay (mutant) reads −128 ms. **TUN: a container can take one** (`## Blocked`). `transport-conclusions.md` §5 TAX, §1 BB2. **The gate's type-check fails on `9f906c0` (row 94's `read(view, {min})`, not in TypeScript 5.9's DOM types), not touched here** |
| 98 | **PORD** — the order the page's files leave in over HTTP/2 and HTTP/3 | queue §Rows 91–100 | **done** 2026-10-01, `168c689`, `ee5cc41`, `37d2af7`: **0 round trips — the config lands first whatever was asked before it**, 112/112 visits over HTTP/2 and HTTP/3; with a ~120 KB-gz metadata preload parsed ahead of it the config ties (within 13 ms at 40/80/160; config 3.85 against 3.91 round trips on h3, session 9.18 against 9.27). **The brief's premise is wrong for this page:** a script-made preload leaves after every parsed one, so `?meta=` was asked 3–33 ms *after* the config in 63/63 visits; only a static link (`meta-first.html`, written per run) puts it first (49/49; a mutant page leaving it unchanged flips the check). The HTTP/3 host interleaves streams; the TCP plane cannot show order, as expected. The metadata's real cost is the dial: +8 / +30 ms at 80 / 160 against no metadata, 0/10 and 0/8 rounds faster. 12 rounds Williams-ordered, self-timed relay per visit, 61/180 VOID dropped, the h3 pair topped up at 80 ms. Order read from resource timing, not the net log. `lab/page-open/README.md` §The order the page's files leave in; `metadata.mjs` now shared with `enc.mjs`. A host that serves in request order is the workstation's cell |
| 99 | **NBR** — a neighbour flow through the same bottleneck | queue §Rows 91–100 | **done** 2026-10-01, `87df230`, `07bda80`: `--udp` may repeat; every pair crosses one queue and one rate clock each way (`cut`/`rebind`/`swallow` act on the first, `--idle-promote` takes one pair only); `link_impair_check.sh` reads it back (two 250 kB streams at 4 Mbit take 0.98–1.00 s, not 0.5; two bursts of 100 leave 10 of a 10-packet queue, not 20), two mutants caught, the full check passes (3.03 / 5.50). `neighbour_cells.sh` re-runs the `netem` neighbour table (5 Mbit, 56 ms, 30 s native fills, a quinn-Cubic neighbour as the proxy for TCP, 7 rounds, 6 of 84 runs `VOID` and dropped): **within ±10 points in every cell but two** — BBR against the proxy 94.0 / 95.6 % shallow (rig 99.4 %), Cubic pairs 47.8–54.0 / 50.9 % (55.6 / 50.4), the rig's 1.5 s start skew reproduced turns a deep Cubic pair 51.8 → 67.4 % (rig's TCP row 76.8 — most of "Cubic is not innocent" was the late start, corrected in place). **The proxy's difference: a deep buffer's BBR against TCP, 15–19 % against 55 %** (the skew explains 3.7 pt; the rest is quinn's paced, HyStart-less Cubic against the rig's Linux TCP over ssh, not separated); the deep BBR pair 50.5 against the rig's noisy 27.6. **The bounded BBR starves itself behind a Cubic neighbour: 17.6 % of a 20-packet queue, 2.5 % of 500** (80 % only at 10) — BBF's mechanism with a queue for jitter. `transport-conclusions.md` §1 (NBR), BB2, §9; `rig-limits.md` §3. **For row 100:** fq_codel matters now — a neighbour shares one FIFO; for row 86, the neighbour is a QUIC flow, never TCP |
| 100 | **CDL** — CoDel in the relay | queue §Rows 91–100 | **done** 2026-10-02, `4ea2d05`: `link_impair.py --codel TARGET:INTERVAL` (ms, `5:100` is the RFC's) — RFC 8289's dequeue run at offer time on each UDP queue, now := the packet's dequeue time (the one-packet guard reads the bytes ahead of it; `drop_next` advances on the drop); the TCP plane unmanaged; the tally gains `codel N` per direction. `link_impair_check.sh` reads it back: 1.5× open-loop overload at 1 Mbit on a virtual clock — the first ten drop gaps within 4 ms of 100/√count, 62.4 drops/s against an excess of 62.5, **sojourn 40 ms, not 5: against a sender that does not back off that is the RFC's algorithm**; a native Cubic fill plus a probe on one 5 Mbit / 56 ms link, 200-packet queue: **the standing queue 4.7–5.1 ms with CoDel, 389–395 tail drop only** (`--self-timing`, none `VOID`). Seven mutants caught (no √, fixed interval, count never resumed, never above target, sojourn zero, no first interval, live: never drops → 369 ms). fq_codel not built — one FIFO for every `--udp` pair. `rig-limits.md` §3. **For row 86:** one run each, quinn's BBR under `--codel 5:100` lost 2 219 of 4 273 packets to CoDel and stood 53 ms of queue (71 tail drop) — it does not read loss; measure it there. **The check's three older cells fail on this 4-core box with and without the change** (GE blast: the echo's socket overflows; the trace queue keeps 14–15 for 10–12; the neighbour probe starts first, 0.51–0.83 s) — host timing, `rig-limits.md` §3. The gate stops at `transport_wasm.js` missing (an unbuilt WASM client), not run past it |
| 101 | **RMD** — `readMin` as the default, at a chunk that keeps a slow link alive | queue §Rows 101–104 | **claimed** 2026-10-02 |
| 102 | **W4b** — row 48's open half: the deep-buffer fill and the trace arm | queue §Rows 101–104 | **claimed** 2026-10-02 |
| 105 | **RCY** — the session recycled before a 16 MB stall: what it costs | queue §Rows 105–106 | **claimed** 2026-10-02 |
| 106 | **WSA** — the opening ask in the WebSocket upgrade's URL | queue §Rows 105–106 | **done** 2026-10-02, `e834abe`: with `--open-ask` the WebSocket listener reads `?ask=` from the upgrade and serves it behind the 101; `ws-session.ts` carries an opening fill there (armed, never sent). **−1.03 to −1.09 round trips to the first frame, every paired round**: −43.6 ms at 40 (7/7), −83.8 at 80 (10/10), −164.3 at 160 (7/7), the fill's end the same; relay TCP plane, 20 Mbit, four 250 KB frames, 12 rounds Williams-ordered, a self-timed relay per visit (14 of 72 `VOID`, dropped), every frame bit-exact. A server ignoring the query gives the arm no frame (the client trusts the push, as over QUIC), not the brief's tie — caught either way; the Rust test (`an_opening_ask_rides_the_websocket_upgrade`) and three conformance clauses fail on their mutants. **The race** now puts an opening fill on the WebSocket's URL alone and asks it on QUIC if QUIC wins — only under `openAsk`, off by default; the losing socket may push up to a round trip of the fill before it is closed, unmeasured. `lab/tcp-fallback/README.md` §The opening ask in the upgrade's URL, `ARCHITECTURE.md` §What was built, `WIRE.md`, `CLIENTS.md`. No default changed. In a container: `rustup target add wasm32-unknown-unknown`, `cargo install wasm-pack`, `npm i -g binaryen@117.0.0` build the WASM client and the full `gate.sh --quick` passes |
| 103 | **W5b** — row 50's open half, with row 96's misfire: size the restart at 0.1–1 % loss | queue §Rows 101–104 | **claimed** 2026-10-02 |
| 104 | **PUSH** — row 56's open half: the push at session open, in a browser | queue §Rows 101–104 | ready |
| 82 | **DC2** — the docs cleaned to the essential, in one commit | queue §Row 82 | **done** 2026-09-26, `0752e5d`: 103 documents folded into the ones that own their subjects (fold map in the commit body), `ARCHITECTURE.md` and `adr-stream-shape.md` new, every code pointer follows its section. The term scanner was run over `0752e5d` and every doc on the workstation 2026-09-26: clean. Judgement calls under `## Blocked`. `lab/window-harness/src/stall.rs` still cites a `mem/stall-client.md` that was never in this tree |
| 5 | **L2** — the BYOB frame-0 cost | queue §Row 5 | **part done on the workstation** 2026-09-15: reader acquisition eliminated; module warm-up untested |
| 43 | **N2** — the impaired link, made to behave like a radio | queue §Rows 43–50 | **half done on the workstation** 2026-09-19, merged 2026-09-20: `--jitter-mode reorder\|ordered` and `--blackout-mode drop\|hold`, each checked against arithmetic and mutated. **Still open: the idle penalty and trace replay** — 2026-10-01: trace replay done by row 92; the idle penalty by row 95 (`--idle-promote`) |
| 44 | **H1** — the production handshake: a real chain, compression, the static plane | queue §Rows 43–50 | **first half done on the workstation** 2026-09-19, merged 2026-09-20: an RSA-2048 chain costs exactly one round trip (4.03 → 5.05, 7/7 at three delays), an ECDSA P-256 chain none; brotli compression (feature `cert-compression`, off) brings RSA back to 4.08 and Chrome 148 offers brotli only; the leaf-only-PEM guard is built. **S40, the static plane: done** 2026-09-26, `c367f5e` — an HTTPS record with `alpn=h3` takes a round trip off the first visit (7/7); the transport on its own port pays a whole lookup after the config, as a second hostname does (S40's "a port is free" corrected); a `dns-prefetch` to its origin removes it (7/7). `ARCHITECTURE.md` §What production adds. A lane about names needs full Chromium, not the headless shell (`rig-limits.md` §8) |
| 48 | **W4** — the controller verdicts, re-run on a link that does not reorder | queue §Rows 43–50 | **half answered on the workstation** 2026-09-19: on ordered jitter Cubic is 1.01× / 1.03× where it was 8.2× / 23.7×; `--packet-threshold` does *not* explain it (0.52× at ±2 ms, ~0.9× at ±10 ms) — what declares those losses owes a qlog cell. **Still open: the deep-buffer fill (S28 is half wrong — the queue does fill) and the trace arm** |
| 49 | **I1** — the idle ask when the first packet is late | queue §Rows 43–50 | **done** 2026-10-01, `2fbcd2e`: relay `--idle-promote 5:P`, 250 KB, 80 ms, 7 rounds, `--self-timing` (25 of 112 runs `VOID`, dropped). **A late first packet costs P and nothing else**: P = 200/400/1 000/1 900 after 6 and 10 s idle reads +197.5…+1 902.4, each within 3 ms of P; no loss; the next ask (`first_ask --next-ask`, new) 100–104 ms in every arm — the inflated sample is the client's, and the server sends the frame (mutant: the probe quiet 6 s before the next ask, which then pays P). **Keep-alive 3 s / 5 s −399 (4/4 each), 10 s +1.8 (0/4); a poke 100 / 300 ms ahead −100 / −301.** `first_ask_cells.sh late` and `keep`; `transport-conclusions.md` §3 I1, §9 item 4. The native client's own PTO count during the hold was not read; S, P and a keep-alive's energy are a device's |
| 50 | **W5** — a blink that holds instead of dropping; slow start restarted after a silence | queue §Rows 43–50 | **mostly answered on the workstation** 2026-09-19: held, a blink costs the outage and nothing else — no congestion event, no loss — and a second blink is no worse; the restart is built. **Still open: the restart against plain Cubic at 0.1–1 % loss with rounds enough to size it** — five rounds gave a four-fold spread |
| 56 | **W1b** — a default for the first ask | queue §Row 56 | **measured on the workstation** 2026-09-20, merged 2026-09-22 — **no default changed, the owner's call.** The push at session open is **463.3 → 137.9 ms (−70 %, 7/7)** at 250 KB / 80 ms and needs three lines on the page; a 32-packet initial window is **−16 to −33 % at queues ≥ 20 packets** and **+11.8 % (0/7) behind a 10-packet queue**; **the two do not stack**; the keep-alive pair keeps a 30 s idle session alive **56/56**. `transport/transport-conclusions.md` §3. **Still open: the push's browser cell, and which lever a rebind re-applies** |
| 59 | **A1b** — the handover, on a device: does a session survive Wi-Fi → cellular, and how long is the freeze | [`ARCHITECTURE.md`](ARCHITECTURE.md) §What this means for the stack choice | **waiting on a device — no container can take this row.** An Android phone with a SIM, the fill running, Wi-Fi switched off mid-fill: what the page sees (any event at all, and when), whether any frame arrives afterwards, and the wall time from the switch to the first error |
| 40 | **E1** — the ingest format | queue §Row 40 | **held** 2026-09-18 by the owner — see "What a row may not change"; do not take it |

**Finished**, one line a batch — what each found is in the doc named:

* **Rows 1–14** (lanes L1–L18, 2026-09-14 to 16): the gate, thread hops, retained memory, idle sessions, an ask overtaking a fill, a faster decoder, the BYOB path — `decode/README.md`, `ARCHITECTURE.md`, `transport/adr-idle-sessions.md`, `WIRE.md` §An ask during a fill.
* **Rows 15–26** (D1–D7, F1, 2026-09-16 to 18): the downloader built beside today's path, its capabilities, the conformance suite's downloader arm, a signed fixture — `ARCHITECTURE.md`, `CLIENTS.md` §The conformance suite, `FIXTURES.md`.
* **Rows 27–29** (L19–L21): a prefix draws a smaller image; a study nobody has read; the UDP-fallback proposal — `decode/README.md`, `disk-access/adr.md`, `ARCHITECTURE.md` §The TCP fallback.
* **Rows 30–41** (Q1–O1, 2026-09-18 to 19): the QUIC bump, the session-open levers, detection and resumption, the impaired link, the first ask, slow-start exit — `transport/transport-conclusions.md`, `ARCHITECTURE.md`, `rig-limits.md` §3.
* **Rows 42, 45–47, 51–55, 57–58** (2026-09-19 to 22): after a blink, WebKit's dial, streaming instantiation, the paint floor, careful resume (not recommended), the wrapper pass, a second decoder, the warm-up's shape, an undecodable frame, a frame's wire bytes — `transport/transport-conclusions.md` §3, `ARCHITECTURE.md`, `decode/README.md`.
* **Rows 60–64** (2026-09-23 to 24): a closed client's worker, the probe after the open, resumption, lever 2 for upstream — `ARCHITECTURE.md`, `transport/upstream-*.md`.
* **Rows 65–72** (2026-09-24): early messages, detection by the bytes, the controller on a lossy link, the decode tail, hops during a fill, the send-size cap's tail, lever 2 against other clients, the page's first frame — `ARCHITECTURE.md`, `transport/transport-conclusions.md` §1 and §5, `decode/README.md`.
* **Rows 73–76** (2026-09-25): the warm-up, the decode tail and resources under a throttled CPU, the hand-off to the page — `decode/README.md`, `ARCHITECTURE.md` §Resources and §The hand-off.
* **Row 77** (TC1): the TCP fallback, built, off by default — `WIRE.md` §The WebSocket mapping, `CLIENTS.md` §The race, `ARCHITECTURE.md` §What was built.
* **Rows 78–81** (2026-09-25): stream shape under loss in a browser (no); the range in the pack (a third off a colour fill at 4–6×); a bounded BBR (keeps BBR's fill, none of its queue); quinn's withheld ACK, reproduced and fixed as an opt-in patch — `adr-stream-shape.md` §HOL1, `decode/README.md` §The range in the pack, `transport/transport-conclusions.md` §1, `transport/upstream-quinn-ack.md`.

### Rows 105–106

Opened 2026-10-01 by a sweep of what an iPhone runs (every iOS browser is WebKit; every lab cell so far is Chromium).

**105 · RCY.** WebKit bug 319818 (NEW, filed 2026-07-20): QUIC flow control never refills, so a session stalls after
16 MB of `MAX_DATA` or 7 600 streams — reproduced on Safari 26 / macOS 26 and on iOS 26.6.1 through a WKWebView, so on
every iPhone browser; `ARCHITECTURE.md` (§What TCP gives up's iOS paragraph) says "nobody has measured what recycling
costs". Measure it: a lab server flag `--stall-after-bytes N` (the session sends nothing after N bytes, no FIN — the
bug's shape), and a downloader option `recycleAtBytes` that dials session 2 in the background at ~0.75 N and re-issues
what the records still owe (§Re-dial and re-issue). Arms: stall + reactive (today: `stallMs` then a re-dial), stall +
proactive, no stall + proactive (the recycle's own cost on a healthy session — the case if it ships everywhere), no
stall + none. A 61 MB fill, 20 Mbit, 40/80/160 ms through the relay, `--self-timing`, ≥ 7 rounds ordered; report the
fill time and the gap at each recycle, bit-exact frames. Mutate: no pre-dial → each recycle pays the dial (~2 round
trips). Also correct the WebTransport version in `CLIENTS.md` / `ARCHITECTURE.md` in place from MDN's
browser-compat-data (`api.WebTransport`: reported as Safari / iOS 26.4, not 26 — check the JSON). Whether a real
iPhone stalls at 16 MB, and the detection rule, stay a device's.

**106 · WSA.** On the WebSocket fallback the opening ask is not honoured: the fill is the socket's first message, a
round trip after the upgrade (`WIRE.md` ~:160). The upgrade is an HTTP request with a URL, so the server can read
`?ask=` there and send right after the 101 — row 56's push at open (−70 % natively) taken from the upgrade. It matters
for every WebSocket client: an iPhone below 26.4 and any network that blocks UDP. Build it in
`server/src/transport/websocket.rs` (the race client puts the ask on the WebSocket URL only, so the two servers do not
both push); cell `lab/tcp-fallback` through the relay's TCP plane at 40/80/160 ms, `ws` with and without the URL ask,
first frame at the client, ≥ 9 rounds ordered. Expect −1 round trip. Mutate: the server ignores the query → the arm
ties the control. No default changes on the race client — the owner's call, like row 56.

### Rows 101–104

Opened 2026-10-01 by rows 92–99's results.

**101 · RMD.** Row 94 measured `readMin` (each frame read straight into its wire buffer): −191 to −227 ms of downloader
CPU a fill and −36 to −41 MB of renderer peak at K = whole frame, −156 to −192 ms at 64 KB, fill time and frame 0 a
tie, bit-exact — but a whole-frame `min` condemns a live session below ~1.1 Mbit/s (`stallMs`), and at 4× with decode
on frame 0 read +7 / +11 ms at 64 / 16 KB (2/7, unresolved). Decide the default: K = 64 KB (and 128 KB) against the
default reader, (a) frame 0 and fill at 1× and 4×, Dd, ≥ 15 rounds so ±10 ms resolves; (b) a slow-link liveness cell —
a relay trace at 0.5 and 1 Mbit with 2 s outages: no session condemned that the default reader keeps alive, mutated
(a K above the bound must be condemned). If (a) shows no regression and (b) holds, make it the default and say so in
`CLIENTS.md`; otherwise record the trade-off under `## Blocked`.

**102 · W4b.** Row 48's open half, now runnable: the deep-buffer fill (`--queue-ms 500` and `1000` at the trace's mean
rate, row 92) and the trace arm (a step trace from `gen_step_trace.py` shaped like a home Wi-Fi link: 15/40/10/30/15
Mbit, 12 s each; plus a burst-cycle trace), arms `cubic | bbr` (the bound is retired, row 91), a 237-frame fill,
`order.py`, ≥ 7 rounds, `--self-timing`. Report fill time and the standing queue (srtt − min) per arm; settle S28's
"the queue does not fill" in `transport-conclusions.md` in place.

**103 · W5b.** Row 50 left the restart unsized (five rounds, a four-fold spread); row 96 found `cubic-restart`
misfires on an idle spell (+489.6 ms, 0/5: the first flight's overflow read as an outage) and built
`cubic-idle-restart`. Size both against plain Cubic: blinks held (`--blackout-mode hold`) of 0.5 and 2 s inside a
fill at 0.1, 0.3 and 1 % GE loss, plus row 96's idle cell; ≥ 15 rounds; report the fill's and the next ask's time.
If `cubic-restart`'s misfire cannot be fixed without losing its blink win, say which to keep.

**104 · PUSH.** Row 56 measured the push at session open natively (463.3 → 137.9 ms, −70 %, 7/7 at 250 KB / 80 ms)
and left its browser cell open. Build the three page lines in the lab's page (`first-byte.html` / `downloader.html`
behind a flag), then page-open through the relay at 40/80/160 ms, 1× and 4×, arms off / push / push + the inline URL
(row 93's `inline`), ≥ 9 rounds Williams-ordered; first frame on the page clock. Also which lever a rebind re-applies
(row 56's second open item), if the relay's rebind mode reaches it. No default changes — the owner's call (row 56).

### Rows 91–100

Found 2026-10-01 by an identification sweep against the target (a phone on a lossy, rate-swinging radio link),
with the reference implementation's workstation measurements of 2026-09-29/30 as leads. Nothing here is measured
yet; every size is derived and says so. **The relay is the instrument for most of them** (`lab/scripts/link_impair.py`):
today it has one fixed rate (:78-79), a tail drop counted in packets (:75), loss before the queue, and no trace, AQM,
idle state or shared bottleneck between flows. Rows 92, 95, 99 and 100 all edit it — take them in order, never two at once.

**91 · BBF.** `server/src/transport/bounded.rs` caps the window at gain × best rate × `rtt.min()`, and quinn's
minimum is all-time, never windowed (quinn-proto 0.11.18 `paths.rs` ~:338). At k capped packets the next cap is
1.25·k·min/srtt, so the cap shrinks whenever srtt/min > 1.25 — and the bound's own queue already sits near 1.25, so
jitter, burst delivery or a neighbour tips it over; the 4-packet floor is then absorbing (leaving it needs srtt ≤ min).
Derived: ordered jitter ±20 ms at 80 ms takes it to the floor in under 1 s (~0.6 Mbit against BBR's ~18); ±10 ms in
~7 s. Row 80 (BB2) ran neither jitter nor a neighbour (srtt/min 1.16–1.20). On the workstation the reference
implementation's windowed variant still sat on the floor behind a neighbour flow. Cell: `controller_browser_cells.sh`
with an ordered-jitter case (`--jitter-ms 20 --jitter-mode ordered`, and ±10), arms `cubic | bbr | bbr-bounded`
ordered by `order.py`, ≥ 7 rounds, a fill long enough to show a collapse; log the window at close. Then a windowed
minimum (e.g. 10 s) as a fourth arm: say whether it rescues the bound. Mutate: the all-time minimum restored in the
windowed arm must reproduce the collapse. Correct `transport-conclusions.md` §1 (BB2) and §9 in place.

**92 · RLY.** In this order, each off by default, each checked against arithmetic and mutated:
(a) a self-timing guard — tally each packet's `sent_at − due` (p50/p99/max) and print it; a cell whose p99 exceeds
1 ms is void (a preempted relay reads as link jitter; at 40 Mbit the relay handles ~5 k packets/s); add
`--rate-up-kbit` for an asymmetric link.
(b) `--trace FILE`: a mahimahi-format opportunity trace (one millisecond timestamp per 1500-byte delivery chance,
looped) replacing `next_free = start + bits/rate` with "the next unused opportunity ≥ max(now, cursor)" — one
mechanism for rate steps, grant bursts, aggregation and outages; a generator for synthetic step traces.
(c) `--queue-bytes` / `--queue-ms` (ms at the trace's mean rate): a FIFO limited in bytes, since a packet count
changes meaning as the rate steps (200 packets are 116 ms at 20 Mbit, 464 ms at 5).
Checks: an open-loop probe at 2× the trace's mean delivers, per 100 ms bin, within ±1 packet of the trace; burst
survivors = limit bytes / size. Record a trace's source and hash, never commit a trace whose licence is unstated.
This closes row 43's trace half and opens row 48's trace arm and the FIFO profiles of row 86.

**93 · DL0.** The dial waits for `fetch(config)` and module evaluation; `lab/page-open/README.md` (~:72-74) notes
inlining the config "would remove the last one", unpriced, and R3 bought nothing because the dial still cannot start
before the URL. Derived: ~1 round trip (−80 ms at 80 ms, ~6–8 % of the 12.65 to frame 0). Lab only: in
`first-byte.html` add `stage=dial0` that creates the `WebTransport` in an inline head script from a URL `run.mjs`
writes into the page and hands the promise to `connect()`; otherwise identical to `r1`. Ladder `today,r1,dial0,all` at
40/80/160 ms, 1× and 4× CPU, ≥ 9 rounds, order by `order.mjs`; report the `session` and `frame` slopes and paired wins.
Mutate: a wrong URL must fail, not fall back silently. **A client entry that adopts an open session is structural —
build only the lab arm; the product change is proposed in `## Blocked` if it wins.**

**94 · BYM.** The default reader hands the transport one browser-allocated chunk per read, copied into the wire ring
(`client/transport-ts/frame-session.ts` ~:405). Loopback coalesces to ~5 reads per 250 KB (`rig-limits.md`), which is
where the BYOB tie verdicts were reached; on burst-delivering radio profiles the reference implementation's workstation
counted 88–217 reads per 254 KB frame (7–10 on uniform shaping) and 2 when read whole. Derived (per-read cost not
measured): 136–335 reads a 392 KB 16-bit frame, ~1.3–6.3 s of downloader-worker CPU a 237-frame fill at 4×. First
extend `lab/scripts/browser_reads.py` to run through the relay with row 92's trace; **if it gives fewer than 20 reads
a frame, record that the regime is not reproduced and stop.** Arms: the default reader; BYOB `{min: min(remaining, K)}`
into the wire ring at K = whole frame, 64 KB, 16 KB; each also with decode off. Read the downloader thread's on-CPU ms
and voluntary context switches per fill, reads per frame, fill time, frame 0 and renderer peak (no regression), 1× and
4×, `order.mjs`, n ≥ 8, `.sha256` per frame. Traps: `lastByteAt` advances per read (~:180) — a whole-frame `min` at a
trickle would condemn a live session, so K must satisfy K / slowest survivable rate < `stallMs`; a cut stream under
`{min}` resolves done with bytes (the truncated-frame path must still name it); row 5's ~12 ms BYOB frame 0 rechecked.
Mutants: `min` ignored; a cut's bytes dropped.

**95 · IDL.** (a) `--idle-promote S:P` in the relay: when neither direction has carried a packet for S seconds, the
next packet either way holds **both** pipes until now+P (one radio; reuse the blackout's hold path). Check: idle 6 s →
RTT = 2·delay + P; idle 4 s → none; mutate. This is row 43's idle penalty; row 49 runs after it. (b) A wake on the
first touch: after > ~4 s quiet the page sends one datagram on `pointerdown`, so the radio's promotion overlaps the
gesture instead of the ask (nothing on the server reads datagrams; a control-stream message would end a running fill —
`WIRE.md` §An ask during a fill). Add a lead arm to `first_ask_cells.sh idle`: one datagram L ms before the ask, L in
0/50/100/200, P = 80 and 300, interleaved, ≥ 7 rounds; the check is arithmetic, ask = base + max(0, P − L) ± 5 ms, plus
a mutant that drops the datagram. This proves the plumbing, not a radio: the saving and its energy cost need a device.

**96 · STW.** quinn 0.11.18 keeps the window through a silence (`transport-conclusions.md` ~:384; the restart patch
fires only on a congestion event spanning one). W1b's idle cell held the link fixed. Derived: a 400 KB window from a
40 Mbit moment, paced at 1.25× into a link now at 8 Mbit with a 50-packet queue, drops ~145 of 200 packets — the ask
~0.6–0.8 s against 0.31 s; a restart pays slow start (~0.6 s), so the sign is unknown. Cell: a relay rate step during
the silence (row 92's trace, or a `rate` control command), `first_ask_cells.sh idle`, 250 KB, 60 ms, 40 → 8 Mbit;
arms plain Cubic, `cubic-restart`, a window clamp after the idle spell; interleaved, ≥ 7 rounds.

**97 · TAX.** The relay's TCP plane is a byte-stream proxy without loss or a congestion window, so the WebSocket arm is
an ideal-TCP floor, not a TCP reference (`rig-limits.md` §3). Use it as one: steady depth-1 asks at 15 and 25 Mbit,
`--queue-pkts 50`, 60 ms; report ask − (RTT + size/rate), the controller and pacing tax, per arm `cubic`, `bbr-bounded`,
`--initial-window-bytes`; no new code beyond a rate on the stream-shape cell. A faithful TCP reference under loss needs
a TUN mode: check first, one minute, whether the container allows it (`ls /dev/net/tun; unshare -rn ip tuntap add t0
mode tun`) and record the answer under `## Blocked` for the workstation.

**98 · PORD.** Chrome sends a page's preloads at one priority and HTTP/2 serves them in request order, so a file
requested after a large one arrives with its last byte (seen on the workstation on a reference page). `downloader.html`
issues its script-made `?meta=` and WASM preloads before the static config and `session.js` links (~:8-22); the relay's
TCP plane has no congestion window, so the lab cannot see it on HTTP/2. Cell: page-open `HOST=dns`, the h3 arm (real
QUIC congestion control through the UDP plane), `?meta=` of a ~120 KB-gz file, the meta preload before and after the
config link, n ≥ 9 at 80 ms; report the `config` and `session` round trips and the net log's response order. Derived:
0 if the config already leaves first, else +1–2 round trips on the dial.

**99 · NBR.** A neighbour flow (another app's download) shares the phone's queue. Accept `--udp` more than once, each
pair its own server, every to-client pipe on one link (as `--tcp-rate shared` does, ~:274); the neighbour is a second
native Cubic fill — quinn's Cubic, not Linux's (no HyStart): name it a proxy. The TCP plane cannot serve (unbounded,
above TCP). Check: re-run the netem neighbour table in `transport-conclusions.md` (5 Mbit, 48 ms / 1.2 s) through the
relay; shares within ±10 points, or the proxy's difference is named.

**100 · CDL.** CoDel (RFC 8289) at the relay's virtual clock: in one FIFO each packet's departure is known at enqueue,
in order, so the control law can run at offer time with now := departure (only the backlog ≤ MTU guard is
approximated). Check: 1.5× overload → sojourn near 5 ms, drops at interval/√count; mutate. fq_codel (RFC 8290) needs a
real dequeue loop and matters only with row 99. Then row 86's managed-queue cells.

**Held for the owner, not queued:** showing a lower-resolution prefix of frame 0 first, then the bit-exact frame
(the fixtures' progression order makes the first bytes a smaller whole image; derived −2 to −4 round trips to a first
drawable image at 80 ms). The owner has not ruled whether a reduced first image counts as the first picture.

### Rows 89–90

Found on the workstation 2026-09-27 while porting two lab results to the reference implementation.

**89 · SE2.** `patches/wtransport-0.7.2-settings-early.patch` sends the server's HTTP/3 SETTINGS in the handshake's
first flight only for a server built through the library's usual constructor. A server that accepts its own QUIC
connections and hands each to the library through `with_quic_connecting` still sends them after the handshake: the
workstation's port had to route that path too (42 lines against 0.7.1; the dial then lost its round trip, 5.19 → 4.19,
7/7 at 40 and 80 ms, with the probe patch unchanged). Extend the lab's patch so both entry points send them early, with
a test on each path that fails without the change (mutate it); keep the probe-every-space patch as it is. Record in
`docs/ARCHITECTURE.md` beside §What lever 2 costs, and bring the upstream draft of row 64 in step (not posted).

**90 · ORD.** On the workstation a fixed arm cycle tilted loopback rows: the same arm always followed the same
predecessor, and a run that started after an idle gap paid a one-off cost (there, a laptop GPU waking from runtime
suspend, ~0.3 s at browser start — not reproducible in a container). A Williams-square order removes the tilt whatever
its cause: every arm follows every other equally often and sits at every position equally often (period N rounds, 2N
for odd N). Give the lab's interleaved drivers (page-open, the link campaigns, the decode benches that alternate arms)
that order by default, with a test, and have their summaries print each paired lead split by predecessor and flag a
cell whose predecessors are unbalanced. Mutate: the old fixed order → the test fails and the flag shows. Say where each
doc names its driver's order; nothing else changes. Record in `docs/rig-limits.md`.

### Rows 87–88

Measured on the workstation 2026-09-26 against the reference implementation (not reachable from here); these rows take
the part that is about serving a page, which is not specific to it.

**87 · ENC.** gzip (level 6, compressed once and cached, so no server CPU per request) saved ~2.2 MB before the first
image on a 20 Mbit / 80 ms link (−837 / −447 ms) but made it **+34 / +55 ms later on loopback** (n = 7). The owner wants
one serving mode, not a link-speed switch (the server cannot know the link at the first request). So: where does the
loopback cost go, and does an encoding remove it? On the lab's page served by nginx (page-open's HOST mode, TLS),
precompressed files, no on-the-fly compression: identity · gzip-6 · brotli-11 · zstd (each only where the browser
advertises it). Assets: the lab's own page bundle, its transport WASM, its decoder WASM, and a metadata-sized JSON —
bytes of each per encoding. Rows, headless Chromium, loopback, n ≥ 10 interleaved, at 1× and at a 4× CPU throttle
(a proxy, not a phone — say so): each response's end, the script evaluated, `WebAssembly.compileStreaming` resolved
(does streaming compile still overlap the download under each encoding?), the first image. Then the break-even rate
per encoding: bytes saved against the loopback cost. Deciding: an encoding within noise of identity on loopback that
keeps most of gzip's saving would let "always on" be right everywhere. State each browser's support from primary
sources (a browser without zstd must fall back by `Accept-Encoding`, never break). No default changed here; record in
the doc that owns serving (README §Docs).

**88 · H2.** On the workstation's page, served over HTTP/1.1, the downloader's worker script is requested at IDLE
priority (a `Worker` takes none) and waited ~180 ms for one of the six sockets behind the page's module fetches, at the
head of a four-deep chain (page script → worker script → transport glue → WASM) that put the WASM's request ~1.2 s
after navigation at 20 Mbit / 80 ms. On the lab's page, HOST mode, HTTP/1.1 vs HTTP/2, with the browser's own HTTP
throttle at 20 Mbit / 80 ms (it throttles HTTP only, not the WebTransport session — say so; add it to the harness if
missing), n ≥ 7 interleaved: when the worker script, its imports and each WASM are requested and end, and the first
image. Also a `<link rel=modulepreload>` of the worker graph on each protocol. Deciding: does HTTP/2 alone remove the
socket wait, so the serving change needs no page change? Record in the doc that owns page open.

### Rows 83–86

Measured on the workstation 2026-09-26, against the reference implementation (not reachable from here); these rows take
the lab's side of what it found.

**83 · RP2.** Row 80 put each frame's min/max into the wrapper's pack. On the workstation it won the 16-bit (a steady
ask 9.63 → 8.22 ms, 10/10) but cost 8-bit colour ~0.5 ms a frame, because the page never reads a colour frame's range
(the window/level comes from the tags) and the pack still computed it. The change: `pack` takes a template flag
`Ranged`; the min/max updates run only when it is true; the caller passes `false` for an unsigned 8-bit 3-component
frame (`comps == 3 && bitsPerSample == 8 && !isSigned`) and `true` for everything else, 16-bit always. The RGB loop is
otherwise byte-for-byte the old one — no runtime `if` in the loop. `client/downloader/decoder.js` then must not take the
decoder's (now empty) range for 8-bit colour: it keeps today's path there (the constant range, or `finish()` under a
scan). Gates: `lab/decode-bench/parity.mjs` pixels and ranges on every fixture; mutants: min −1, max +1, signed read
unsigned, **the skip widened to an 8-bit grey frame** (needs a synthetic 8-bit grey frame — add one) — each must fail.
Bench: the colour WASM call back to row 80's pre-change figure, the 16-bit keeps row 80's win. Record in
`docs/decode/README.md` §The range in the pack.

**84 · WEX.** Both decoder builds pass `-fexceptions` (the library's CMake and the wrapper's `build.sh`), which routes
every call that may throw through a JS `invoke_*` trampoline; `wasm-dis` of the 4 MB build shows 73 such sites in 17
functions, 10 of them two to three loops deep in the decode driver. `-fwasm-exceptions` uses native Wasm exception
handling (every current browser, phones included). Rebuild both builds with it (and `-sSUPPORT_LONGJMP=wasm` if the
toolchain asks), parity bit-exact on every fixture, then bench, interleaved, n ≥ 10: frames 0–2 (cold) and steady, per
content, Node and — if the container has one — a headless browser. Estimated 2–5 % of decode, more on cold frames;
unmeasured. Default only if bit-exact and it wins with no regression. Record in `docs/decode/README.md` §Faster.

**85 · WU2.** The warm-up (`docs/decode/README.md` §Warming the decoders) was judged "never reaches the page" on the
lab's transport, whose session is ready early. On the workstation's other transport the dial takes longer (a session
ready ~1.5 s after navigation on an 80 ms link), and each of three decoders pays a cold tier-up on its own first frames:
41–71 ms for the first, 17–27 for the second, against 6.4–6.8 steady — ~190 decoder-ms per cine fill, all on frames
0–5 (the first image and the start of a scroll). Size it: warm-up frame shape (160² vs 512² vs the series' own shape),
its cost per decoder, frames 0–5's decode time with and without, and how long an idle window before the first byte it
needs to pay for itself (so the workstation can tell, per transport, whether it is hidden). Add a decoder `ready` stamp.

**86 · PROF.** Every link cell so far is netem with uniform random loss on a fixed rate. Real Wi-Fi and LTE hide most
radio loss with link-layer retransmission and show it as rate swings, delay spikes and loss bursts behind deep buffers,
and a controller verdict reached on uniform loss (row 79: bounded BBR 4–14× over Cubic) may not survive. Build, in the
lab's link harness, a profile = (rate trace, base RTT, `slot` delivery, Gilbert–Elliott loss, queue): a netem delay line
(no `delay … jitter` — it reorders, row 48) → an `htb` bottleneck whose rate a `tc -batch` loop steps from a trace every
20–50 ms → a `bfifo` (sized in ms at the trace's rate) or `fq_codel` leaf. **Read every lever back against arithmetic
and mutate it before any campaign** (goodput follows the trace; GE loss rate and burst length from counters; the FIFO's
standing queue; codel drops); if `htb` under netem misbehaves, say so and use the simplest order that works. Profiles
(sources: public measurement papers; where the literature has no fitted parameters the value is a knob to sweep):
LTE-good (a public per-ms LTE capacity trace, 50 ms, GE mean 0.01 % in bursts of 2–5, FIFO ~500 ms); LTE-loaded (a lower
trace, 60 ms, 0.1 %, FIFO ~1 s, a competing bulk flow); LTE-moving (a driving trace, 70 ms, 0.3 % + a burst at each
handover every ~30 s: 50 ms outage and a ~200 ms queue spike); WiFi-home (steps 15/40/10/30/15 Mbit/s of 12 s, 30 ms,
0.25–1 % bursty, FIFO); WiFi-busy (5–20 Mbit/s swings, 40 ms, 1 %, FIFO, a competing flow, one 0.5 s roaming gap);
fq_codel variants of LTE-good and WiFi-home; and today's uniform 1 % as the control. Then Cubic · BBR · the bounded BBR
(row 79) on the lab's transport, n ≥ 5 interleaved: a 250 KB first ask and a 61 MB fill, loss/overflow, standing queue,
a neighbour's share. Traces are fetched for local use only — never committed; record their source and hash. Record in
`docs/transport/transport-conclusions.md` and the harness's doc; say plainly where bounded BBR loses.

### Row 82

Queued 2026-09-25 by the workstation; the owner approved it ("proceed with the docs"). `TODO.md` is the task; this row is
its keep list. **One cleaning commit; history stays.** Take it last, when no other row is claimed (it touches every doc).

**82 · DC2 — the docs cleaned to the essential.** Keep, and make each the single owner of its subject:
`README.md` (+ a short index of what follows), `CLAUDE.md`, `TODO.md`, `WIRE.md`, `CLIENTS.md`, `FIXTURES.md`, the ADRs
(`adr-*.md`, `disk-access/adr.md`), **one architecture doc** made from `proposal-downloader.md` with
`proposal-session-open.md` and `proposal-session-survival.md` folded in, `transport/transport-conclusions.md` with
`transport/why-these-changes.md` folded in, `decode/README.md` trimmed to what holds, `rig-limits.md`, and `cloud-queue.md`
slimmed to its Protocol, the live rows and a one-line pointer per finished batch. Fold every still-true, still-needed
claim from the rest into the doc that owns its subject (a retracted claim stays corrected in place there), then delete.
Fix every link; the private-term scanner over the result; `scripts/gate.sh` green. The commit body carries the fold map.
If a file's survival is a judgement call, keep it and list it under `## Blocked` for the owner rather than guessing.

### Row 5

**5 · L2 — the first frame on the BYOB read path.** A timing claim; the workstation's, with a WASM build
per arm. A reproducible ~12 ms cost on the first frame of a session on the BYOB read path in
`client/transport-wasm` (features `byob` / `byob-min` / `byob-count`, off by default). The path removes
both compressed-frame copies and ties on everything else, but the worst frame of an on-demand run is
frame 0 in every run measured, ~12 ms more than the default path, worse in 8 of 8 rounds with ranges
that do not overlap. It is the only thing keeping the path from adoption (−140 lines of frame
reassembly against +93). Reader acquisition is eliminated (2026-09-15); **the cold allocator / module
warm-up is untested** — instrument it as `byob-count` does. One-time setup that can move before the
first ask clears the path; per-frame allocation that only shows cold closes it (worse on a phone).
Interleave the arms, n ≥ 8. `decode/README.md` §The BYOB read path.

### Rows 43–50

"What a row may not change" binds these rows. The S-numbers are findings of the second
identification sweep (`git show 823d52d:docs/cloud-queue.md`), none measured when
queued. A finding is a claim until your cell reproduces it; where it does not, say so in the owning doc.

**43 · N2.** `link_impair.py` is what every container verdict stands on, and four things it does
are not what a radio does. Done: jitter that does not reorder, and a blackout that holds and bursts.
Still to add, each read back against arithmetic and mutated: an **idle penalty** — the first packet
after *N* ms without traffic waits *X* ms, each direction (S34); and **replay of a delivery-opportunity
trace**, one millisecond timestamp per MTU-sized opportunity, with a Poisson option (S29).
`rig-limits.md` §3 says what the relay can and cannot stand in for.

**44 · H1.** Done: the certificate chains, compression, the leaf-only guard, and the static plane
(`lab/page-open` `HOST=dns`). Unmeasured there: the record and the hint together, the transport on UDP 443.

**48 · W4.** After 43. W2's controller cells on jitter that does not reorder are done. Still open: the
slow-start-exit cells with a fill at least ten times the buffer, so the deep queue actually forms
(S28), and BBR against Cubic on a replayed trace instead of iid loss (S27, S29). Correct
`transport/transport-conclusions.md` §1 and §3 in place.

**49 · I1.** After 43. With the idle penalty at 200 / 400 / 1 000 / 1 900 ms after 5 and 10 s idle:
what one ask on a warmed session costs, what the client's and the server's probe timers do with a
first packet that late, and what the inflated round-trip sample does to the *next* ask. A keep-alive
arm at 3 / 5 / 10 s against none, and a one-packet poke sent 100–300 ms before the ask (S35, S36).
This shows the stack's half only; the sizes and the battery are a device's.

**50 · W5.** The restart (`--congestion cubic-restart`) against plain Cubic at 0.1–1 % background
loss, with rounds enough to size it — five gave a four-fold spread. Default unchanged.

### Row 56

**56 · the first ask.** A decision, not a measurement. **It ends undecided on purpose**: the push wants
a page change and loses datagrams behind a shallow queue, the window is free but loses one cell, and
which matters depends on whether the session opens with a fill or an ask. The confirming run on the
shaped link waits on that choice.

### Row 40

**40 · E1.** Held by the owner. On a sweep over TLM markers with per-resolution tile-parts, and
code-block geometry: bytes, both decoders byte-exact, decode time, and TLM lengths equal to a prefix's
level boundaries — mutation-checked. Then the tooling for a lossy-source transcode question, ready for
when a census of source formats exists.

## When the queue runs dry: an identification sweep

A procedure, not a finding; it **identifies** levers and does not measure, build or fix. Run it when
the queue is empty, the target changes, or a constraint is lifted (re-run only the areas that
constraint had closed).

1. **Split the clock from raw runs** per goal (a fill's time to all frames; one frame asked on an idle
   session). A stage that is 5 % of the clock cannot be the answer.
2. **List what the rig's regime hides**: loopback hides every round trip, loss, slow start, buffer depth
   and outages; a desktop hides compile time, cores and memory; a warm profile hides first visits; one
   browser hides the others. Each hidden dimension is a search area.
3. **Inventory what is documented** per area — the verdicts and the regimes they were reached in. A
   verdict from a regime that does not apply to the target is a lead, not an exclusion.
4. **One read-only investigator per area**, in parallel, each opening from a code fact already verified
   (file:line), reading library source rather than docs, with arithmetic for the size on the target, a
   novelty check against the docs, and a "looked at and dropped" list; at most five candidates, each
   with mechanism, evidence, size, cost elsewhere, and the measurement that decides it and who can run it.
5. **Reconcile** conflicting reports by asking which cell the older result actually measured.
6. **Screen against the goal before ranking**: a candidate stays only if it moves a figure the
   comparison reports, on its content, bit-exact (§What a row may not change).
7. **Rank by effect on the target**, keep the dropped lists, record corrections owed to existing docs,
   and queue rows with the split between container, shaped-link VM, workstation and device.

Launch fresh investigators in two waves, highest expected effect first: a usage limit then costs the
tail, not the head.

## Blocked

**The rig is not reachable from a cloud container** (2026-09-15, still true): no key, and no egress to
its SSH port. Rig and timing lanes are the workstation's; `rig-limits.md` §9.

**Coalesce the decoded frames across decoders — design it, or drop it?** (2026-09-25, row 76). Batching
per decoder batches nothing on a slow CPU; batching across decoders needs a point they all pass
through, which changes §The decoders' shape. Its ceiling at 4–6×: about 10 ms of a fill's main
thread; less on the target link. **What is needed:** whether a proposal for the merge point is wanted
at that price ([`ARCHITECTURE.md`](ARCHITECTURE.md) §The hand-off). Not built meanwhile.

**Row 86 (PROF): where do the link profiles live?** (2026-09-27). The brief's pipeline — a netem delay
line, an `htb` bottleneck stepped by `tc -batch`, a `bfifo` or `fq_codel` leaf — cannot be built in an
agent container: its 6.18 kernel has `htb` and the FIFOs (`CONFIG_NET_SCH_HTB=y`, `CONFIG_NET_SCH_FIFO=y`)
and veth pairs in a network namespace, and a live `tc class change … htb rate` works, but
`CONFIG_NET_SCH_NETEM` and `CONFIG_NET_SCH_FQ_CODEL` are not set and there are no modules to load
(`rig-limits.md` §9 already says netem needs a VM). So no delay line, no Gilbert–Elliott loss and no
fq_codel leaf in-kernel, and none of it can be read back and mutated here before a campaign. Row 79's
verdict it would test stands on `link_impair.py`, the userspace relay, not on netem. **What is
needed:** one of —
* **the relay:** extend `link_impair.py` with a rate trace, a queue sized in ms of the trace's rate, and
  a CoDel leaf of our own (Gilbert–Elliott, delay and tail drop are already there), calibrated where
  netem exists (§9 item 2 of `transport/transport-conclusions.md` already owes that calibration);
* **a hybrid:** the relay for delay and loss in front of a namespaced `htb` + `bfifo` stepped from the
  trace — no fq_codel variants;
* **the VM:** keep the brief's pipeline for the cloud rig or a shaped-link VM, where every lever can be
  read back, and take the row off the container queue.

Nothing was built; no trace was fetched.

**Row 93 (DL0): the ~2 round trips before the downloader's dial — which shape, if any?** (2026-10-01).
Inlining the transport URL into the page is worth ~1 round trip to the first frame on top of R1
(−1.24 at 1×, −0.73 at 4×) and needs no client change: `connect()` already takes the URL as a value.
It changes how the config reaches the browser (the page templated by the host), which is the
owner's call. Beyond it, a dial from the page's head has its session ~2 round trips sooner still
(−167 ms at 80, every paired round), but **a `WebTransport` cannot be cloned or transferred to the
downloader's worker** (Chromium 141), so the brief's "hand the open session to `connect()`" cannot
be built. The shapes that could collect it: the dial on the page with its streams transferred to the
worker (each chunk then crosses the page thread — the hop the downloader exists to avoid), or a
worker graph that boots sooner (one bundle, or the worker's script inlined as a blob). **What is
needed:** whether to template the URL into the page, and whether either shape is wanted at its
price — `lab/page-open/README.md` §The dial before the config. Nothing built beyond the lab rungs.

**Signed data in the product?** Still the workstation's: whether the product serves signed samples at
all. The decoders and the parity run cover signed 12- and 16-bit ([`decode/README.md`](decode/README.md) §Ground truth).

**Kept by DC2 as judgement calls** (2026-09-26) — the owner decides whether each stays:

* `docs/transport/upstream-quinn-ack.md` and `docs/transport/upstream-wtransport-settings.md` — drafts for
  the owner to file, not docs of this tree; kept so they are not lost before filing.
* `docs/telemetry/adr-server-pipeline.md` and `docs/telemetry/adr-instrument-clients-from-outside.md` —
  `telemetry/` was on the delete list and "the ADRs" on the keep list; they are ADRs, and now the only
  owners of the telemetry subject, so they stay under `telemetry/`.
* `--stream-mode pool:k` in the server — `adr-stream-shape.md` closes the shape, and the code stays only so
  its cells can be reproduced; removing it is a code row of its own.
* A second sequential telemetry session truncates `telemetry-server.rows` — a known defect, recorded in
  `telemetry/adr-server-pipeline.md` §Harvest, not fixed.

**A TUN mode for the relay — wanted?** (2026-10-01, row 97). The check the row asked for: a container
**can** take one. `/dev/net/tun` exists; `apt-get install iproute2` (no `ip` otherwise), then
`unshare -rn ip tuntap add t0 mode tun` succeeds, and a Python `TUNSETIFF` inside `unshare -rn` reads
a 128-byte IPv4 UDP packet sent to the tun's subnet off the fd. So a relay that forwards IP packets,
under which the kernel's own TCP sees loss and retransmits, can be built here. **What is needed:**
whether a faithful TCP reference under loss is worth that build (row 97 used the TCP plane as an
ideal-TCP floor instead). Not built meanwhile.
