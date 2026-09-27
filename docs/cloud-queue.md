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
| 86 | **PROF** — link profiles close to a phone: a rate trace, bursty loss, a deep or managed queue; the controllers on them | queue §Rows 83–86 | **blocked** 2026-09-27 — no netem or fq_codel in a container kernel; which substrate is the workstation's call, `## Blocked` |
| 87 | **ENC** — what compression costs on a fast link, and whether an encoding makes it free | queue §Rows 87–88 | **done** 2026-09-27, `badcf76`: **no encoding is resolvably later to the first frame on loopback**, at 1× or 4× (5/20 to 11/20 in two batches of 20; the codec order did not survive the second batch, so none is ranked on time); the decoder WASM's preload arrives later under each (1–2/20 at 4×, +17 to +49 ms), with ~10 ms more network-service CPU a visit; a streamed compile still resolves 3–7 ms after its last byte in every arm. Break-even 108–220 Mbit/s even at the worse batch at 4×; **gzip is within noise and keeps 92 % of brotli's saving** — one mode, always on. Support from MDN compat data; zstd needs Safari 26.3. No default changed. `lab/page-open/README.md` §What an encoding costs on loopback, `enc.mjs`; the page takes `?transport=wasm` and `?meta=`. **For row 88:** behind nginx the decoder workers' `fetch()` of the glue and WASM revalidates on the wire (a 304) rather than taking the preload — no `Cache-Control`, and a minutes-old file has almost no heuristic freshness — so a HOST-mode worker graph pays a round trip a fetch whatever the protocol; set a cache lifetime or read it as part of the result. In a container: `apt-get install nginx libnss3-tools brotli zstd`, and `npm i -g binaryen@117.0.0` for `wasm-pack`'s `wasm-opt` (apt's 108 builds a WASM client whose externref table cannot grow) |
| 88 | **H2** — does HTTP/2 serving take the worker's script off the socket queue | queue §Rows 87–88 | **claimed** 2026-09-27 |
| 82 | **DC2** — the docs cleaned to the essential, in one commit | queue §Row 82 | **done** 2026-09-26, `0752e5d`: 103 documents folded into the ones that own their subjects (fold map in the commit body), `ARCHITECTURE.md` and `adr-stream-shape.md` new, every code pointer follows its section. The term scanner was run over `0752e5d` and every doc on the workstation 2026-09-26: clean. Judgement calls under `## Blocked`. `lab/window-harness/src/stall.rs` still cites a `mem/stall-client.md` that was never in this tree |
| 5 | **L2** — the BYOB frame-0 cost | queue §Row 5 | **part done on the workstation** 2026-09-15: reader acquisition eliminated; module warm-up untested |
| 43 | **N2** — the impaired link, made to behave like a radio | queue §Rows 43–50 | **half done on the workstation** 2026-09-19, merged 2026-09-20: `--jitter-mode reorder\|ordered` and `--blackout-mode drop\|hold`, each checked against arithmetic and mutated. **Still open: the idle penalty and trace replay** |
| 44 | **H1** — the production handshake: a real chain, compression, the static plane | queue §Rows 43–50 | **first half done on the workstation** 2026-09-19, merged 2026-09-20: an RSA-2048 chain costs exactly one round trip (4.03 → 5.05, 7/7 at three delays), an ECDSA P-256 chain none; brotli compression (feature `cert-compression`, off) brings RSA back to 4.08 and Chrome 148 offers brotli only; the leaf-only-PEM guard is built. **S40, the static plane: done** 2026-09-26, `c367f5e` — an HTTPS record with `alpn=h3` takes a round trip off the first visit (7/7); the transport on its own port pays a whole lookup after the config, as a second hostname does (S40's "a port is free" corrected); a `dns-prefetch` to its origin removes it (7/7). `ARCHITECTURE.md` §What production adds. A lane about names needs full Chromium, not the headless shell (`rig-limits.md` §8) |
| 48 | **W4** — the controller verdicts, re-run on a link that does not reorder | queue §Rows 43–50 | **half answered on the workstation** 2026-09-19: on ordered jitter Cubic is 1.01× / 1.03× where it was 8.2× / 23.7×; `--packet-threshold` does *not* explain it (0.52× at ±2 ms, ~0.9× at ±10 ms) — what declares those losses owes a qlog cell. **Still open: the deep-buffer fill (S28 is half wrong — the queue does fill) and the trace arm** |
| 49 | **I1** — the idle ask when the first packet is late | queue §Rows 43–50 | after 43 |
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
