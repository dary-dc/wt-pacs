# Why these changes exist

**The question this answers:** *someone opens the diff, sees a transport knob and a
rewritten default, and asks what problem any of it solved.*

One entry per **decision**, not per commit. This file, not the code, is where "why"
belongs. A comment earns its place only when a competent reader would otherwise do the
wrong thing.

The full register — including campaign-instrument entries (guards, analysers, sampler,
comment-placement) — is on tag `archive/transport-lab-2026-09`:

```bash
git show archive/transport-lab-2026-09:docs/transport/why-these-changes.md
```

Format: **what was true before → what forced the change → what else we could have done →
what would show it was wrong.**

---

## The measurements

### 1 · Two congestion controllers, because there are two kinds of loss

**Before.** The project flipped its controller recommendation three times. Each flip was a
campaign that had sat, by accident, in one loss regime and read the result as general.

**Forced by.** Building both regimes deliberately and running them side by side, each
verified by queue-drop counters rather than assumed. Congestive → Cubic; radio → BBR; the
margins are 44–63 % and they point in opposite directions.

**Alternative.** Pick one and move on. Rejected: whichever you pick is ~50 % wrong on half
your users, and nothing in the transport tells you which half.

**Falsified by.** Real client telemetry showing the regime mix is overwhelmingly one-sided,
which would make the second answer academic.

### 2 · One shared stream, against the textbook

**Before.** The classic argument says per-frame streams confine loss damage to one frame.
The project pre-registered that as hypothesis H4 and expected it to win.

**Forced by.** It lost, and not narrowly — 3.5× at 64 KB in simulation, 8.5× at 250 KB, and
**5.76× on real hardware at 250 KB**, separated 3/3. The mechanism was read out of quinn's
source *before* the campaign: `retransmit()` re-queues with `push_pending`, behind every
already-queued stream, regardless of fairness. Per-frame therefore defers recovery behind
other frames' backlogs. The classic argument is right about the receiver and silent about
the sender.

**Alternative.** A fixed-N pool between the two. Still untested, and R6 makes it less
promising: the deferral cost grows with N and the winning endpoint is N = 1.

**Falsified by.** Any cell where per-frame + FIFO separates in its own favour. None found on
either rig. (Individual repeats do favour per-frame — 8 of 12 on the real path at 64 KB —
but no cell separates, which is a different and weaker statement.)

### 3 · The rig had to be rebuilt before any of §2 counted

**Before.** Four campaigns compared stream shapes on a rig where the reader blocked on each
frame, so the transport could never fall behind and head-of-line blocking was structurally
impossible. Stranded bytes: **0.00 MB**.

**Forced by.** Review 4 noticing that the condition under test could not occur. The
open-loop reader strands 18.31 MB in the same cell. `window-harness --reader-mode open`
is that reader; `closed` is still the harness default, and no stream-shape result from it
is admissible.

**Alternative.** Trust the earlier numbers. Rejected: they measured a rig property.

**Falsified by.** A cell where the open-loop reader strands nothing — which is now a gate
that voids the row rather than a thing to notice afterwards.

### 4 · Flow-control windows are hygiene, not a lever

**Before.** "Bound the windows for memory at thousands of viewers" was carried on
arithmetic: quinn's `send_window` defaults to 10 MB, and 10 MB × 5 000 is 50 GB.

**Forced by.** Measuring the case it was reserved for. `window-harness --mode stall` asks
for 25 MB and stops reading; the server holds **180 kB** — 11 % more than one that merely
reads slowly, and 50× below the ceiling. The withheld bytes queue on the *client*, which
holds 2.20 MB, because a stalled peer's stack still ACKs and the server frees what is
acknowledged.

**Alternative.** Leave it unmeasured and bound the windows anyway. Cheap, but it would have
left the project believing a 50 GB risk it does not have — and would have hidden the
finding below.

**Falsified by.** A client that widens its own receive window on a high-BDP path, where the
in-flight window rather than the peer's credit bounds the server. Unmeasured; on this rig
such a client is killed by its own quinn first.

### 5 · The send path is a memory property, not only a CPU one

**Before.** `chunked` was adopted for −6…−14 % CPU per byte.

**Forced by.** The stalled-client campaign, which found the same client costs **198 kB on
chunked and 6 990 kB on copy + per-frame** — 68 % of the ceiling. The arithmetic worry in
§4 was well founded *for the send path the project used to ship*; the chunked default is
what removed it.

**Alternative.** Report the CPU number alone. That would leave `main` — which has the copy
path only — exposed in a way nobody had written down.

**Falsified by.** A measurement where `RssAnon` and total RSS disagree, which would mean the
chunked figure is a file-backed blind spot rather than a real saving. Checked: they agree
to within 1.2 % in every arm.

---

## The product

### 6 · A default may not outrun its evidence

`transport-conclusions.md` §2 records that the binary shipped `per-frame` while the answer
sheet recommended `shared`. Rather than asking someone to adjudicate it, a rule was fixed:
X3L decides. X3L ran and separated (5.76× at 250 KB on the real path, stranding gate
passing), so the default flipped to `shared`. `per-frame` stays a product flag.

The general form: **when a decision is contested, write the measurement that would settle
it and commit to the outcome in advance.**

### 7 · A measurement rig and a shipped server want different things

**Before.** Thirteen transport flags and three send paths reached a product build, because
every variable a campaign swept had been given a knob.

**Forced by.** Reading the diff as a product change rather than as a campaign. A campaign
needs a knob per swept variable; a server needs one only where a decision is genuinely
open. The flags that pass that test are on the product CLI: `--stream-mode`,
`--send-window` / `--send-window-bytes`, `--receive-window`, `--stream-receive-window-bytes`,
`--congestion`, `--bind`, `--prefault`, plus the windows / idle timeout already on `main`.

**2026-09-09.** The campaigns closed. Rejected arms were deleted from `server/`, not copied
into `lab/` and not left behind `--features lab`. Reproduction of `copy` / `split` /
`--ask-priority` is git history (and the archive tag), not a feature flag.

**Falsified by.** A campaign that cannot be reproduced from the tag. Restore:

```bash
git checkout archive/transport-lab-2026-09 -- docs/transport lab/transport
```

(Checking out `docs/transport` from the tag overwrites these lean face files.)

### 8 · One endpoint per core, each on a single-threaded runtime

**Before.** One QUIC endpoint on tokio's multi-thread runtime, a worker per core. A frame
crosses five tasks — I/O driver, endpoint driver, connection driver, ask reader, serving loop,
and the connection driver again to send — and tokio hands a woken task to whichever worker is
idle. At depth 1 every hop was a cross-thread wake: **28 context switches per 250 KB frame**,
and the server spent more CPU on a frame (790 µs) than the whole round trip took (630 µs).
Three passes on the read path and the build had left `serve_us` at 15 µs of that round trip.

**Forced by.** Holding everything but the worker count. 4 vCPU VM, warm page cache, the native
driver (`server_ab`) pinned to CPUs 2–3, the server to CPUs 0–1, depth 1, p50 of 200–300 asks,
three repeats each, ranges never overlapping:

| frame | 2 workers | 1 worker | round trip | CPU / frame | ctx switches / frame |
| ----- | --------: | -------: | ---------: | ----------: | -------------------: |
| 100 B | 83–96 µs | 57–62 µs | **−35 %** | −55 % | 4.2 → 1.2 |
| 32 KB | 152–155 | 115–121 | **−23 %** | −45 % | 5.3 → 1.6 |
| 250 KB | 577–613 | 368–376 | **−37 %** | −50 % | 20 → 1.6 |

One worker on four CPUs reads the same as one worker on two: the cost is the hand-offs, not
the cores.

**What shipped.** `--workers N`, default one per core: N OS threads, each a `current_thread`
runtime owning its own endpoint on an `SO_REUSEPORT` socket. The kernel hashes a client's
4-tuple to one socket, so a session's packets, connection driver, ask reader, serving loop and
blocking-pool returns all stay on one thread, and every core still serves. `--workers 1` is
one endpoint on an exclusive bind, as before. The blocking pool and the tile ring (`AsyncFd`)
run unchanged on the per-thread runtime — the disk ADR's "a hop costs 40 µs on current-thread,
103 µs here" was this all along.

Interleaved A/B on the same VM, `main` against this branch, both servers up, arm order
reversed every repeat, six repeats paired per repeat, client unpinned as a user runs it. p50
is the driver's ask-to-envelope round trip; a fill's is the inter-arrival:

| cell | p50, base → new | asks / s | CPU per ask | ctx / ask |
| ---- | --------------- | -------: | ----------: | --------: |
| 100 B, depth 1 | 93.5 → 58.1 µs (**−37 %**, 6/6) | +60 % (6/6) | −64 % (6/6) | 5.0 → 1.1 |
| 32 KB, depth 1 | 138 → 107 µs (**−23 %**, 6/6) | +29 % (6/6) | −48 % (6/6) | 5.9 → 1.5 |
| 250 KB, depth 1 | 629 → 408 µs (**−34 %**, 6/6) | +47 % (6/6) | −58 % (6/6) | 29 → 2.0 |
| 250 KB, depth 4 | 2 194 → 1 352 µs (**−40 %**, 6/6) | +58 % (6/6) | −56 % (6/6) | 27 → 0.2 |
| 250 KB fill | 527 → 314 µs per frame (**−40 %**, 6/6) | +54 % (6/6) | −53 % (6/6) | 24 → 0.3 |
| 32 KB fill | 52 → 11 µs per frame (6/6); p99 374 → 503 (4/6 higher) | +12 % (5/6) | −39 % (6/6) | 3.8 → 0.2 |

Where the box saturates — 16 and 32 sessions at depth 4, one client socket per session
(`server_ab` opens one per session now; `--one-socket` is the old behaviour), six repeats
paired. First the server pinned to two cores with the driver on the other two, then all four
shared:

| cell | asks / s | CPU per ask | p50 | p99 |
| ---- | -------: | ----------: | --: | --: |
| 250 KB, 16 sessions, server on 2 cores | −3.6 % (4/6 lower) — tie | −5 % (4/6) — tie | +20 % (6/6) | −5 % (4/6) |
| 32 KB, 16 sessions, server on 2 cores | **+9 % (6/6)** | −22 % (6/6) | −19 % (6/6) | −2.5 % (4/6) |
| 250 KB, 32 sessions, server on 2 cores | +8 % (4/6) | −13 % (6/6) | +3 % — tie | −53 % (4/6) |
| 32 KB, 32 sessions, server on 2 cores | **+17 % (6/6)** | −23 % (6/6) | −9 % (6/6) | −42 % (4/6) |
| 250 KB, 16 sessions, 4 cores shared | +10 % (4/6) | −12 % (6/6) | −19 % (6/6) | +1.5 % — tie |
| 32 KB, 16 sessions, 4 cores shared | **+12 % (6/6)** | −21 % (6/6) | −32 % (6/6) | +23 % (6/6 higher) |
| 250 KB, 4 sessions at depth 4, 4 cores shared | +8 % (5/6) | −16 % (6/6) | −10 % (6/6) | −3 % — tie |
| 250 KB, 4 sessions at depth 1, 4 cores shared | **+15 % (6/6)** | −24 % (6/6) | −17 % (6/6) | −14 % (6/6) |

Reading: busy, the multi-thread runtime wastes fewer wake-ups — there is no parked worker to
notify — so the saving per ask shrinks from 40–64 % at one session to 5–24 % here, and
throughput follows it: +8 to +17 % on six of eight cells, a tie on the two 250 KB
sixteen-session cells. The one column against is the 32 KB tail on four shared cores
(+23 %, 6/6): sixteen sessions hash unevenly onto four endpoints and the busiest thread's
sessions wait longest. Not measured: thousands of sessions on many cores with the clients off
the box, which is P0's rig; the hash evens out with count, while a few heavy sessions landing
on one endpoint is the case work stealing handled and this does not.

**One socket, one thread.** The first run of these cells read −31 to −41 % throughput (6/6):
the driver had opened every session from a single client socket, so they shared one 4-tuple
and the kernel hashed all of them onto one endpoint thread while the others idled. A browser
opens a socket per session and a fleet of viewers has as many addresses; a UDP proxy or load
balancer that forwards every session from one source port would do the same to the product.

**Placement is a lottery, and count balance is the wrong statistic** (2026-09-11, a second box:
8-core workstation, `intel_pstate`/`powersave`, server pinned to four cores and the driver to the
other four, 87 × 49.1 KB frames, on-demand depth 4, 100 asks per session, six repeats paired,
order reversed each repeat). Against `main`, with each arm's own per-round throughput range:

| sessions | Δ asks / s | Δ p50 | Δ CPU per ask | range, new | range, `main` |
| -------: | ---------: | ----: | -------------: | ---------- | ------------- |
| 1 | **+36 % (6/6)** | −33 % (6/6) | −58 % | 7 233–8 895 | 5 427–5 732 |
| 4 | **−14 % (4/6 worse)** | +2 % — tie | −33 % | **8 690–13 604** | 12 072–14 921 |
| 16 | +2 % — tie | −18 % (6/6) | −27 % | 12 235–16 060 | 13 311–14 369 |
| 32 | **+14 % (6/6)** | −12 % (5/6) | −23 % | 7 809–16 053 | 6 975–13 885 |

At four sessions the new arm's floor (8 690) sits inside the band one worker gives
(8 516–9 277, same cell): when two of four sessions hash to one endpoint the run performs like a
single thread while the others idle. By sixteen the counts even out and the floor lifts.

**What a collision costs.** `server_ab --one-socket` puts every session on one 4-tuple, which is
the hash collision made deliberate. Sixteen sessions, depth 4, same pinning, six repeats paired:

| arm | p50 | p99 | asks / s | CPU per ask |
| --- | --: | --: | -------: | ----------: |
| `main`, spread | 3.26 ms | 6.92 ms | 14 003 | 205 µs |
| `main`, one thread | 2.34 ms | 32.2 ms | 13 294 (−5 %, 6/6) | 219 µs |
| new, spread | 2.63 ms | 7.21 ms | 13 121 | 151 µs |
| new, one thread | 6.24 ms | 8.55 ms | **8 898 (−32 %, 6/6)** | 103 µs |

The multi-thread runtime does not care which socket a packet arrived on — it steals the work to a
free core and loses 5 %. Per-core endpoints lose a third of the throughput and 2.4× the p50, at
the *lowest* CPU per ask of the four: the efficiency survives, the parallelism does not.

At a thousand sessions over eight endpoints the **counts** even out (125 ± 10). The **load** does
not. A viewer filling a 61 MB study is worth hundreds of idle on-demand viewers, so the heavy
sessions are few, their placement is a small-N lottery, and it is fixed for the life of the
session; everyone hashed onto a thread with a heavy session pays the row above. Work stealing is
the mechanism that absorbs exactly this, and it is the one this removes. Three things compound it,
none of them measured here: a UDP front forwarding sessions from one source port makes the
one-thread row permanent rather than exceptional; a mobile fleet's Wi-Fi-to-cellular handovers and
NAT rebinds change the 4-tuple, and connection migration is the QUIC feature 4-tuple hashing
defeats (eBPF reuseport steering on the connection ID is the usual answer and is not here); and a
`current_thread` runtime has no relief valve when one session blocks its thread — this box never
makes the reader miss, so that path has never run blocked.

**To a browser.** The same A/B driven by the product TypeScript client in headless Chromium 141
on this VM (`lab/scripts/browser_cell.py`; one session, six interleaved repeats, wall per frame):

| cell | base | new | paired |
| ---- | ---: | --: | ------ |
| 32 KB, depth 1, 1 500 asks | 442 µs | 445 µs | +1.8 % (2/6 lower) — tie |
| 32 KB fill, 2 000 frames | 179 | 170 | −5.2 % (4/6) — tie |
| 250 KB, depth 1, 320 asks | 1 777 | 1 694 | −4.3 % (4/6) |
| 250 KB fill, 320 frames | 1 202 | 1 278 | +4.4 % (3/6) — tie |
| no media (`cell=refuse`: 1 500 asks past the study, each refused on the control stream) | 268 | 200 | **−25 % (6/6)** |

Reading: with no media in the round trip the browser sees the server's change whole — 268 to
200 µs, 6/6. Put 32 KB of media in it and the cell is a tie: that ask costs the native driver
107 µs end to end and Chromium 442 µs, and the ~240 µs Chromium adds for the bytes (decrypt in
the network process, the Mojo hop, the copy into the renderer) is untouched by anything the
server does. At 250 KB that path is 1.7 ms per frame — about 150 MB/s — and is the ceiling.
**On a browser client the server's whole slice of a depth-1 round trip is about a quarter at
32 KB, and this change removes most of what was left in it.** That is why three passes of
server work did not move the workstation numbers: the rest of the round trip is Chromium, and
the levers that reach it are the client's prefetch depth
([`../adr-client-window-depth.md`](../adr-client-window-depth.md)) and per-frame priority
([`../adr-frame-framing-and-loop-shape.md`](../adr-frame-framing-and-loop-shape.md) §4),
which change what the reader waits *for*, not how fast one frame is served.

Named, not measured: on the workstation (`intel_pstate`/`powersave`) the cross-core wakes this
removes also crossed C-states, so the saving there may read larger than on this VM; the depth-1
cell with the governor at `performance` would price the rest of it. The native driver and the
browser are both multi-threaded clients and pay the same kind of hand-off on their side.

**The receive thread is the ceiling, and it is unmoved** (2026-09-11, the same second box; this
whole branch — §8 and §9 together — against `main`, driven by a product page in Chromium 148,
87 × 49.1 KB, five arms interleaved, n = 6 per cell, page clock). Paired against `main`: all
frames received −0 % (3/6), all frames decoded +5 % (3/6); on demand, serve p50 −2 % (4/6) and
gesture to on-screen −3 % (3/6). Every pairwise rounds-ahead cell reads 3/6 or 4/6.

Chromium's network-service IO thread (`Chrome_ChildIOT`), busy milliseconds to receive the same
4.38 MB:

| arm | IO thread busy | peak over 100 ms | fill span |
| --- | -------------: | ---------------: | --------: |
| a reference implementation, TCP through a proxy | 178 ms | 50 % of a core | 297 ms |
| a reference implementation, QUIC | 243 ms | 57 % | 58 ms |
| `main` | 268 ms | **84 %** | 110 ms |
| this branch | 274 ms | **82 %** | 126 ms |

Natively this branch serves that study at 507 MB/s against `main`'s 305 MB/s. The thread that has
to take the bytes did not move, and at 82–85 % of a core it is what sets the fill. That is the
whole of the tie — a conclusive negative for loopback, not a shortage of repeats.

Two things fall out. **The drops hypothesis is dead**: 44 datagrams per `sendmsg` did not worsen
Chromium's socket overflow (866 → 852 per run, 3/6), so burst size is not what sheds them. And the
rig favours TCP by a measurable amount — loopback's 65 536-byte MTU gives a TCP peer ~64 KB
segments where our datagrams stop at 1 452, and the same 4.38 MB costs Chromium 178 ms of receive
CPU that way against our 268. A real link gives both ~1.5 KB packets.

**Open for whoever takes these two entries.** Neither can be priced for a viewer on loopback
(§1 and §3 of the limits doc — `git show origin/docs/rig-limits:docs/rig-limits.md`,
which records what this box cannot decide and what would lift each limit); the cell that would
price them is a shaped,
lossy, rate-limited link where the wire binds before the receiver does — the same rig §8's
falsifier already asks for. Add a heavy-tailed mix to that falsifier — a few fills among many idle
viewers — since the load, not the session count, is what the hash cannot balance. Splitting the
branch is the other open question: §9 is per-byte work removal with no scheduling change, so the
quinn patch and the frame pool on the stock multi-thread runtime would carry that win with none of
the placement risk. The commits are stacked, so it needs a revert rather than a flag, and
`--workers 1` is not that build (one `current_thread` endpoint, −26 to −38 % at four sessions
and up).

**Alternative.** One endpoint on its own thread handing accepted connections to per-core
runtimes keeps the endpoint-to-connection hop, half the cost, and quinn's endpoint driver stays
one core (S2). One worker in total is the same latency and no scale. Neither was measured; the
per-core shape is what quinn's own docs give for scaling out.

**Costs.** A client whose 4-tuple changes mid-session (NAT rebinding, a Wi-Fi to cellular move)
hashes to another endpoint, which does not know the connection and answers with a stateless
reset: the session drops and the client reconnects. A front that forwards many sessions from
one source port puts them all on one thread (−31 to −41 % throughput at 16–32 sessions,
above); a per-flow port on the front, or `--workers 1`, avoids it. `--workers 1` also keeps
the exclusive bind: two servers of one user started on one port otherwise share it silently. Yielding the serving loop after every frame (`yield_now`), so the driver
sends before the next ask is read, was measured on this shape and rejected: +7 % p50 and −9 %
asks/s at 32 KB depth 1 (6/6), a tie at 250 KB depth 4; it only smooths a fill's inter-arrival
(p99 −63 %), which no reader waits on.

**Falsified by.** A cell where per-core endpoints lose on wall or CPU per ask with the clients
off the box (P0's target, 64–256 sessions), or a deployment whose sessions migrate. Re-run:

```bash
bash server/scripts/gen_dev_cert.sh
FRAMES=80 bash lab/scripts/gen_tf_fixtures.sh
NAME=frames_tiny BYTES=100 FRAMES=80 bash lab/scripts/gen_live_cell_fixture.sh
cargo build --release -p exact-server -p disk-access-bench
git worktree add /tmp/base main && (cd /tmp/base && cargo build --release -p exact-server --target-dir /tmp/base-target)
lab/scripts/runtime_ab.sh lab/fixtures/frames_250k/frames_250k.sbnd on-demand 1 200 1 6 \
  base /tmp/base-target/release/exact-server -- new target/release/exact-server > rt.tsv
lab/scripts/runtime_ab_pair.py rt.tsv base new
# saturation: 16 sessions at depth 4, 100 asks each; SERVER_CPUS / CLIENT_CPUS pin the two sides
SERVER_CPUS=0,1 CLIENT_CPUS=2,3 lab/scripts/runtime_ab.sh lab/fixtures/frames_32k/frames_32k.sbnd \
  on-demand 4 200 16 6 base /tmp/base-target/release/exact-server -- new target/release/exact-server
# the browser cells: static host, TS bundle, then one server per run
python3 server/dev-server.py --port 8765 &
bash client/transport-ts/build.sh
lab/scripts/browser_cell.py new target/release/exact-server lab/fixtures/frames_32k_big/frames_32k_big.sbnd ondemand 1500 1 6
```

### 9 · CPU per byte: segments per `sendmsg`, a profile-guided build, one copy fewer

**Before.** After §8 a 250 KB frame still cost about 340 µs of CPU under load — some 2 µs per
1452-byte datagram, spread over AES-GCM, quinn's packet assembly, four copies of every byte
(page cache to buffer, buffer into quinn, quinn into the packet, packet into the kernel) and
the kernel's per-segment work. quinn sends at most 10 datagrams per `sendmsg`, a constant its
authors call "a good compromise"; the transport lane had measured 10 → 32 at −21 % CPU per
byte on loopback, n = 1, and left it because its real-hardware cell was path-bound. Nothing
here is a lever a lossy link cares about; every item is sessions per core.

**Forced by.** Four candidates built as separate binaries and run against the tree in one
interleaved A/B: server pinned to two cores, the driver to the other two, one client socket per
session, six repeats paired per repeat. CPU per ask, then asks per second:

| cell | segments 44 | PGO | mimalloc | pooled hand-off |
| ---- | ----------: | --: | -------: | --------------: |
| 100 B, depth 1 | −13 % (5/6) · +8 % | **−26 % (6/6)** · +20 % | −9 % (6/6) · +12 % | −8 % (5/6) · +5 % |
| 32 KB, depth 1 | **−18 % (6/6)** · +3 % | −13 % (6/6) · +2 % | +3 % · −6 % | 0 % · −2 % |
| 250 KB, depth 1 | **−21 % (6/6)** · +2 % | −15 % (6/6) · +15 % | −2 % · +2 % | −7 % (6/6) · +4 % |
| 250 KB fill, 80 frames | **−20 % (6/6)** · +19 % (6/6) | −10 % (5/6) · +9 % | +9 % · −9 % | −10 % (5/6) · +9 % (5/6) |
| 250 KB, 16 sessions, depth 4 | **−16 % (6/6)** · +7 % (5/6) | −9 % (6/6) · +12 % (4/6) | +4 % · −6 % | −3 % (5/6) · −1 % |
| 32 KB, 16 sessions, depth 4 | **−17 % (6/6)** · +29 % (6/6) | −11 % (5/6) · −1 % | −3 % · +3 % | −2 % (5/6) · +4 % |

The 32 KB fill of 80 frames is 6 ms per run and read worse for every arm, the tree's own
included; it resolves nothing and is not quoted. mimalloc ties or loses everywhere but the
100-byte cell and is not taken. The other three are independent mechanisms, so they were then
built into one binary and profiled on that source:

| cell | CPU per ask | asks / s | p50 | p99 |
| ---- | ----------: | -------: | --: | --: |
| 100 B, depth 1 | −11 % (5/6) | +2.5 % — tie | −3 % (6/6) | tie |
| 32 KB, depth 1 | **−24 % (6/6)** | +6 % (4/6) | −6 % (4/6) | −10 % (5/6) |
| 250 KB, depth 1 | **−30 % (6/6)** | **−15 % (5/6)** | −3.5 % (4/6) | +13 % (5/6) |
| 32 KB fill, 2 000 frames | **−30 % (6/6)** | **+40 % (6/6)** | −50 % (6/6) | −46 % (6/6) |
| 250 KB fill, 320 frames | **−32 % (6/6)** | **+39 % (6/6)** | −18 % (6/6) | −35 % (6/6) |
| 32 KB, 4 sessions, depth 4 | **−35 % (6/6)** | **+46 % (6/6)** | −32 % (6/6) | −39 % (6/6) |
| 32 KB, 16 sessions, depth 4 | **−29 % (6/6)** | **+25 % (5/6)** | −21 % (5/6) | −5 % (4/6) |
| 250 KB, 16 sessions, depth 4 | **−33 % (6/6)** | **+44 % (6/6)** | −29 % (6/6) | −12 % (5/6) |

The three add up, near enough: −24 to −35 % CPU per ask and +25 to +46 % throughput wherever
the pipe is full. The one cell against is 250 KB at depth 1 with one session: the median holds
and the mean rises (throughput −15 %, 5/6; p99 +13 %) while CPU falls 30 %. A serial session
overlapped the server encrypting batch *n* + 1 with the client decrypting batch *n*; at 44
packets a batch there is less of that overlap, and nothing else is running to fill it. At
depth 2 or two sessions the pipe is full and the cell joins the others. That is the lab's
regime, not the product's, and the segment count is one constant in `third_party/quinn` if a
target ever wants to sweep it.

**What shipped.**

- **`third_party/quinn`** — quinn 0.11.11, one change: the segments per `sendmsg` follow the
  MTU (44 at 1452 bytes, under the kernel's 65 527-byte GSO payload) instead of the constant
  10, and the driver sends up to 64 datagrams per poll instead of 20. The workspace
  `[patch.crates-io]` points every `quinn` dependency, wtransport's included, at it. The cost
  is a crate to refresh by hand on a quinn upgrade; the upstream shape would be a
  `TransportConfig` knob.
- **`scripts/pgo_build.sh`** — instrument, train on the cells this file measures (fill, depth 4
  with 4 and 16 sessions, depth 1, three frame sizes), rebuild with the profile. A profile is
  bound to the source it was taken from, so the script runs per release build and
  `cargo build --release` stays the plain build; a stale profile is worse than none.
- **`media/frame_pool.rs`** — both readers hand the frame off as `Bytes` over their own buffer
  and take the next buffer from a per-thread pool; `FrameOut` gives quinn head and body with
  `write_all_chunks`, and the buffer comes back when quinn drops it after acknowledgement.
  One copy of four gone, and the 64 KiB write chunking with it. This corrects the disk ADR's
  §5 row: the 2026-09 attempt was rejected for a fresh 64 KiB allocation per window, which was
  the allocation, not the hand-off.

**Costs.** A 64 KB batch holds the connection lock about 30 µs longer than a 14 KB one, which
is where a fill's inter-arrival p99 widens (+68 % on the short 32 KB cell, n = 80; the 320-frame
fill below is the one to read). quinn now holds the reader's buffer until the peer acknowledges
it: memory per session is unchanged in total, since quinn held a copy before, and the pool keeps
at most 64 buffers per thread. PGO doubles the release build.

**Falsified by.** A CPU-bound cell on the production target where the combined binary does not
beat the plain one on CPU per ask; a quinn upgrade that moves the batching itself. Re-run:

```bash
cargo build --release -p exact-server -p disk-access-bench     # the tree: patched quinn + pool
scripts/pgo_build.sh                                             # → target/pgo/release/exact-server
git worktree add /tmp/before <commit-before-§9> && (cd /tmp/before && cargo build --release -p exact-server --target-dir /tmp/before-target)
SERVER_CPUS=0,1 CLIENT_CPUS=2,3 lab/scripts/runtime_ab.sh lab/fixtures/frames_250k/frames_250k.sbnd on-demand 4 100 16 6 \
  base /tmp/before-target/release/exact-server -- tree target/release/exact-server -- pgo target/pgo/release/exact-server > rt.tsv
lab/scripts/runtime_ab_pair.py rt.tsv base tree pgo
```

---

## Campaign instruments (on the tag)

Guards that refuse the wrong fixture, analysers that print `n` and do not average VOID
rows, the loss-regime sampler's one-write-per-row fix, and the comment-placement pass are
not product decisions. They live in the tag copy of this file as entries 6–13 and 16–17.
