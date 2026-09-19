# Cloud queue

A place to hand work to a cloud agent between sessions, and for it to hand results back.
`cloud-lanes-2026-09-14.md` holds the briefs; this holds the order and the state.

## Protocol

**New session?** [`handoff-2026-09-16.md`](handoff-2026-09-16.md) has where the branches are, what
is already settled, and the container recipes — read it once, then work the queue from here.

**You are the cloud agent.** After you finish a lane and push:

1. `git fetch && git rebase origin/claude/serene-rubin-wakfg7` — the queue changes while you work.
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
| 32 | **R1** — two round trips off a cold open: a proposal, then a prototype behind a flag | queue §Rows 30–41 | **done** — `proposal-session-open.md`; lever 1 (`--open-ask`) prototyped and tested, no crate patch needed; lever 2 needs one, specced not built. **No doc stated a round-trip count to correct** — this one states it. **Timed under row 36: four round trips to first byte, confirmed; the two levers are still unmeasured** |
| 33 | **P1** — a decoder pool that follows the queue, and a reader that waits: a proposal | queue §Rows 30–41 | **done** — `proposal-downloader.md` §The decoders and §The downloader; `client-shape-plan.md` M2/M3 and its shape table corrected in place. **M3's fill window is deleted, not built**; the reader pausing gives the same bound through QUIC flow control. Nothing built |
| 34 | **A1** — a session that dies is noticed and resumed: a proposal | queue §Rows 30–41 | **done** — `proposal-session-survival.md`. The idle timeout is the freeze length, so detection moves to platform triggers + a probe ask; resumption rides the downloader's per-frame records. **The rebind number still waits on a run** — the probe and relay came over with T1 |
| 29 | **L21** — when UDP is blocked: a proposal, no code — **amended 2026-09-18** | queue §Rows 28–29, §Rows 30–41 | **done** — `proposal-udp-fallback.md`. **Measured: 2 ms when UDP is refused, 4 004 ms when it is silently dropped** — 2000x, and the realistic impairment is the slow one. iOS (S1) makes the scope all iPhones, not ~5 % of networks; recycling before 16 MB is the cheaper experiment. Race, do not detect |
| 25 | **D6** — a fresh decoder's first frame — **amended 2026-09-18** | queue §Rows 23–26, §Rows 30–41 | **done** — **the first frame costs ~4x the steady state** on both fixtures, and frames 1–5 pay a smaller version. The code cache does nothing (S13 confirmed); D6's own warm-up decode helps but does not remove it (3.9x → 3.5x). May be §BYOB's unexplained ~12 ms. `decode/README.md` §The first frame |
| 23 | **D2d** — the WASM client behind the downloader — **amended 2026-09-18** | queue §Rows 23–26, §Rows 30–41 | **done** — the capability row is **green on both clients**: single ask byte-exact, fill a tie. And S6 fixed — the dial now overlaps decoder start-up, start+dial 58→52 ms (TS) and 70→57 (WASM), conformance 46/46 + 19/19. `proposal-downloader.md` §The decoders |
| 24 | **D5** — what the decoder's range pass costs a fill — **amended 2026-09-18** | queue §Rows 23–26, §Rows 30–41 | **done** — the range pass is 10–25 % of a decode, and **folding it into the copy is slower** (1.06x, 1.17x), so D5's remedy is refused with the measurement. S14's redundant copy removed; the stale "no signed fixture" comment corrected. `decode/README.md` §The range pass |
| 26 | **D7** — the downloader on the 4 MB decoder | queue §Rows 23–26 | **done** — the 4 MB build cuts the decode arm from **161.4 MB to 16.3 MB** (10x) with fill and cold ask unchanged to the tenth of a ms. Parity byte-identical on all six sets, 40 frames, signed included. `proposal-downloader.md` §Results |
| 35 | **T1** — the transport branch's lab and client pieces, here; not its server | queue §Rows 30–41 | **done** 2026-09-19 — 45 paths taken whole, 4 merged by hand (`session.ts`, `build.sh`, `docs/transport/README.md`, `transport-conclusions.md`). No `server/`, no `patches/`. Its `window.ts` is `ask-window.ts` here: the worker-safe check read a bundle's `// window.ts` banner as a reach. The ask window's 5 tests are in the gate. Gate green — conformance 84/84, downloader 46/46, dispatch 19/19, refusals 64/64 on both clients |
| 36 | **N1** — an impaired link in a container | queue §Rows 30–41 | **done** 2026-09-19 — `lab/scripts/link_impair.py`, both planes, no root; `link_impair_check.sh` reads every lever back against arithmetic and each was mutated to watch it fail. **A cold open's first byte is 4.01 round trips + 17.7 ms** (R1's count confirmed, its attribution corrected in place: the session alone is 3.00, the control stream free) and **a 250 KB ask is 5.59** (S7's ~5). It replaces `nat_rebind_relay.py`. `rig-limits.md` §3 **Calibrated on the rig 2026-09-19: the relay and `netem` agree to 0.01 round trips on every phase**, so its round-trip counts stand without a VM run (`rig-limits.md` §3). |
| 37 | **R2** — navigation to first byte on a real round trip: count, then cut | queue §Rows 30–41 | **done** 2026-09-19 — `lab/page-open/`. Cold serial round trips to a session: **ts 9.69 → 6.64, wasm 11.86 → 6.72, downloader 12.53 → 6.37**, cut one change at a time (config preload, modulepreload, the worker and decoder bundles); a warm profile spent none of it either way. All three now converge on the dial's 3.0 plus 3.6 for the page. The 6.4 left between session and first frame is slow start on a 428 KB frame, not the page. **S6 corrected in place.** gzip and the immutable rule are in `deploy/nginx` with checks, but **unverified here** — no nginx, no container runtime |
| 38 | **W1** — the first ask on an idle session | queue §Rows 30–41 | **done** 2026-09-19 — `lab/scripts/first_ask_cells.sh` + `first_ask` probe; `transport-conclusions.md` §3. **250 KB is 5.8 round trips on a fresh session against 1.3 on a warmed one**; the push lever reaches the warmed figure (454.7 → 103.9 ms at 80 ms), a 32-packet initial window is −28 to −33 %. **Two of S7's clauses did not reproduce** — a lossy fill lands between fresh and warmed, and a port-only rebind does not reset the controller — corrected in place, as is the ≤ 7 % verdict. Product defaults unchanged, and why is in the row |
| 39 | **W2** — slow-start exit, an outage, the first timeout | queue §Rows 30–41 | **claimed** 2026-09-19 |
| 40 | **E1** — the ingest format | queue §Rows 30–41 | **held** 2026-09-18 by the owner — see "What a row may not change" below; do not take it |
| 41 | **O1** — the fill's order; prerender, yes or no | queue §Rows 30–41 | ready |
| 27 | **L19** — how much of a frame draws a smaller image | queue §Row 27 | **done** — a quarter of the bytes draws the half-size image, on all four formats; only the package can do it. `decode/README.md` §A prefix draws a smaller image |
| 28 | **L20** — opening a study nobody has read | queue §Rows 28–29 | **done** — a tie in both scenarios; the miss *path* costs ~0.5 ms on one ask and nothing across a fill. What a cold study costs is the device's, not this container's. `disk-access/EVIDENCE.md` §A study nobody has read |
| 9 | **L13** — what a thread hop costs a frame | lanes §L13 | **done** `3cd29fd` — `docs/thread-hops.md` |
| 10 | **L14** — what retained frames cost in memory | lanes §L14 | **done** `dfbd4e8` — `docs/decode/README.md` §Retention |
| 11 | **L15** — how long an idle browser session survives | lanes §L15 | **done** `444dd36` — 30 s confirmed, and the browser pings itself |
| 12 | **L16** — whether an ask can overtake a running fill | lanes §L16 | **done** `9714d41` — it ends the fill; `transport/ask-during-fill.md` |
| 13 | **L17** — a faster decoder, byte for byte | lanes §L17 | **done** `6f87cbb` — no win; the toolchain is a 15 % regression |
| 14 | **L18** — what the BYOB read path allocates | lanes §L18 | **done** `bb86253` — byob allocates **less**; `decode/README.md` §The BYOB read path |
| 5 | **L2** — the BYOB frame-0 cost | lanes §L2 | **part done on the workstation** 2026-09-15: reader acquisition eliminated; module warm-up untested |
| 6 | **L3** — a lossy, rate-limited link | lanes §L3 | **not for cloud** — workstation lane; drives the VM over ssh |
| 7 | **L7** — a regime where the read path misses | lanes §L7 | **not for cloud** — workstation lane; drives the VM over ssh |
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

**29 · L21, amended.** Three additions to the brief below. iOS: WebKit bug 319818 stalls a
connection after 16 MB (S1), so the fallback may be every iPhone, not ~5 % of networks — and the
route that keeps QUIC there is recycling the session before 16 MB and re-issuing; cost it. Racing
the fallback against WebTransport instead of detecting failure (S22), which makes the time to
rejection moot. And what a device check must show before any of this is built.

**25 · D6, amended.** The decoder is instantiated from a buffer and its glue evaluated as text, so
the engine's compiled-code cache can never engage (S13) and a warm-up decode would not tier up.
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
