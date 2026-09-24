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

> **Parked 2026-09-18 — this is not in `server/`.** The measurements below stand; what they do
> not cover is what removed the change. Per-core endpoints pin a session to the thread its
> 4-tuple hashed to, so a NAT rebind or a Wi-Fi-to-cellular move lands on an endpoint that does
> not know the connection: **12 of 16 rebinds kill the session, against 0 of 6 on one endpoint**
> ([`../lanes/T6-session-survival.md`](../lanes/T6-session-survival.md)), and the client gets no
> error, just a 30-second freeze. The target is a browser on a mobile link, so that is a
> correctness cliff and not a tuning trade. The scale case was never measured either: the
> saturation cells here are 16–32 sessions on 2–4 cores with the clients on the same box, and
> the load a hash cannot balance is a few heavy fills among many idle viewers (T10). The work is
> whole on branch `claude/per-core-endpoints` and returns if T6 finds a steering answer and T10
> shows it scales.


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
defeats (eBPF reuseport steering on the connection ID is the usual answer and is not here) — though
**a browser page has no migration to lose**, verified in Chromium's source 2026-09-22
([`../proposal-session-survival.md`](../proposal-session-survival.md) §What this means for the
stack choice), so on the product's own client this paragraph costs a NAT rebind, not a handover; and
a
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
viewers — since the load, not the session count, is what the hash cannot balance. That mix is
the placement question at thousands of sessions; `--workers` above the core count is not
(§10 entry 4). Splitting the
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
hashes to another endpoint, which does not know the connection. This said "answers with a
stateless reset: the session drops and the client reconnects" until 2026-09-18; T6 step 1
measured it and both halves were wrong. The wrong endpoint drops the packets in silence, so
the client freezes and dies of `connection timed out` at 30 001 ms — quinn's idle timeout —
with no error to reconnect on and no reconnect in either product client. It happens on 12 of
16 rebinds at `--workers 4`, the `(W−1)/W` the hash predicts, against 0 of 6 at `--workers 1`
([`../lanes/T6-session-survival.md`](../lanes/T6-session-survival.md)). A front that forwards many sessions from
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

| cell | GSO cap (MTU-derived) | PGO | mimalloc | pooled hand-off |
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
overlapped the server encrypting batch *n* + 1 with the client decrypting batch *n*; at ~45
packets a batch there is less of that overlap, and nothing else is running to fill it. At
depth 2 or two sessions the pipe is full and the cell joins the others. That is the lab's
regime, not the product's — and the latency-first cell, since a viewer with no cache waits
on depth 1. Combined rows above quote CPU, asks/s and p50 together; the house rule is one
of latency or throughput, and the depth-1 p50 is the latency column.

The formula is `65527 / mtu` (integer division), so **45 segments at 1452 bytes** and 44 at
1472. An earlier write-up said 44 at 1452. Quinn 0.11.11 and upstream `main` still hard-code
10; there is no `TransportConfig` knob (`quinn-rs/quinn#2189`).

**What shipped.**

- **`patches/quinn-0.11.11-mtu-gso.patch`** — applied at build time to the crates.io
  quinn 0.11.11 tarball (`scripts/patch_quinn.sh`, `[patch.crates-io]` → `patched/quinn`).
  **Corrected 2026-09-23: not the default build on the unified tree** — `--config
  'patch.crates-io.quinn.path="patched/quinn"'` opts in, because the depth-1 cell below reproduced.
  Segments per `sendmsg` follow the MTU under the kernel's 65 527-byte GSO payload instead
  of the constant 10, and the driver sends up to 64 datagrams per poll instead of 20. The
  patch is the whole behavioural delta; wtransport's `quinn` dependency is patched too.
  The repo does not vendor Quinn sources. This mechanism was not re-A/B'd against the
  vendored tree: `scripts/patch_quinn.sh --check` and a `connection.rs` diff against that
  vendor are the equivalence. Refresh: point `scripts/patch_quinn.sh` and
  `patched/quinn/Cargo.toml` at the new crates.io version, retarget the hunks, run
  `scripts/patch_quinn.sh --check`. The upstream shape would be a `TransportConfig` knob.
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

**Without §8, it still pays — measured 2026-09-18, after one false alarm.** §8's closing
paragraph claimed these three mechanisms were "per-byte work removal with no scheduling
change" that would carry to the stock multi-thread runtime. They do. The first attempt to
check it said the opposite — −38 % throughput — and that was a bug in the measurement, not a
finding: reverting §8 restored the endpoint but left the binary on
`#[tokio::main(flavor = "current_thread")]`, which §8 had set because it ran its own threads.
Every arm in that run was single-threaded. Recorded because the shape of the wrong answer was
convincing: CPU per ask down, context switches down, throughput down, which reads like lock
contention and is equally what one worker looks like.

With `#[tokio::main]` restored, `main` against this tree, release builds without PGO, server
pinned to two cores and the driver to the other two, six repeats paired:

| cell | asks / s | CPU per ask | p50 | p99 |
| ---- | -------: | ----------: | --: | --: |
| 250 KB, 16 sessions, depth 4 | **+13.5 % (6/6)** | −16.8 % (6/6) | +18 % | −15 % (4/6) |
| 32 KB, 16 sessions, depth 4 | **+23.2 % (6/6)** | −22.0 % (6/6) | −25 % (6/6) | −11 % (5/6) |

Depth 4 with sixteen sessions is a throughput cell, so throughput is the column; the 250 KB
p50 is depth over that throughput and moves with the queue.

**Attributed.** `main` carrying only the quinn patch, against `main`: asks/s +10.3 % and
+21.4 %, CPU per ask −11.0 % and −20.6 %, p50 −7 % and −22 %, receive drops −71 % — the GSO
cap is a clean win on the stock runtime by itself. The pooled hand-off roughly doubles the
throughput half at 250 KB (+13.5 % with it against +6.0 % without) and pays for the rest of
the CPU. Neither depends on §8. PGO is not in these numbers: `cargo build --release` stays
the plain build, and `scripts/pgo_build.sh` was not run for them.

**Verified where the product actually sits, 2026-09-18.** The cells above are saturation, and
neither product client keeps asks outstanding, so depth 1 is today's behaviour. Against `main`,
one session, six repeats paired:

| cell | p50 | p99 | CPU per ask |
| ---- | --: | --: | ----------: |
| 250 KB, depth 1 | **−32.5 % (6/6)** | −23.0 % (5/6) | −46.3 % (6/6) |
| 32 KB, depth 1 | **−6.9 % (6/6)** | −5.7 % (5/6) | −30.9 % (6/6) |

Depth 1 is a latency cell, so p50 is the column. §9 recorded a 250 KB depth-1 cell that lost
15 % of its throughput; that was against the tree with §8 underneath, not against `main`, and
the comparison that matters to a viewer goes the other way.

**PGO, measured on this runtime for the first time.** `scripts/pgo_build.sh` against the plain
release build of the same source, six repeats paired: 250 KB at 16 sessions +7.2 % asks/s and
−8.8 % CPU per ask (6/6, p99 +7.5 % the one column against); 32 KB at 16 sessions +8.0 % asks/s,
−10.6 % CPU, p50 −10.3 % (6/6); 250 KB at depth 1 p50 −4.7 % (6/6), CPU −8.6 %. The −9 to −25 %
CPU this entry claimed was taken with §8 underneath; −8.6 to −10.6 % is what it is worth here.
Unlike LTO ([§10 entry 5](#10--latency-and-throughput-on-one-tree-where-they-part-and-what-joins-them))
it does not cost the depth-1 cell, so nothing vetoes it. It stays a per-build script, never a
stored profile, and `cargo build --release` stays the plain build.

**The frame pool's shape is free.** The shared pool this entry now uses was written because a
thread-local one assumes a session's buffer comes back on the thread that read it, which a
work-stealing runtime does not promise. Measured against a thread-local arm on the same source,
250 KB at 16 sessions: a tie on every column (0.1–0.8 %, 2–3/6). So the rework buys correctness
of the invariant, not speed, and the drift it removes is not observable in this cell — worth
recording so nobody re-measures it hoping for a win.

**The conditions beyond saturation, 2026-09-18.** Throughput on a native driver is one axis;
these are the others this box can reach.

*Fill, the other product path* (250 KB, one session, six repeats paired against `main`):
p50 −42.2 %, p99 −42.8 %, asks/s +73.9 %, CPU per ask −44.0 %, all 6/6. The on-demand cells
above understate it, because a fill is where the send path runs uninterrupted.

*A stalled client, which the pool changes the shape of.* quinn now holds the reader's own
buffer until the peer acknowledges it, so a peer that never reads pins it — the case §4 and
§5 price. `lab/scripts/stall_memory_cell.sh`, peak `RssAnon` over the hold minus the settled
baseline: at 250 KB, `main` holds 3 584 KiB and this tree 3 364 KiB; at 32 KB, 2 364 against
2 152 KiB. The ceiling did not move, and the pool does not add to it.

*A real browser, which is the target's client.* `lab/scripts/browser_cell.py`, headless
Chromium 141, arms interleaved and the order reversed every repeat, wall per frame, n = 6:
32 KB on demand **−0.8 %, 2/6 paired lower — a tie**; 250 KB on demand **+3.2 %, 1/6 paired
lower**, ranges overlapping (base 2 375–2 712 µs, tree 2 431–2 619 µs). So none of the
native-driver win reaches a viewer here. That is the finding §8 already recorded for its own
change — at 250 KB Chromium's receive path is about 1.7 ms per frame and is the ceiling — now
confirmed for §9. The 250 KB cell reading 5/6 slower rather than evenly split is worth one
more look before it is called noise.

**What this means for keeping them.** The case for §9 is **cost per session**, which is the
target's actual constraint at thousands of viewers, and that is measured and large. It is not
a latency win for a browser on this rig, and the docs should not be read as promising one.

**The depth x sessions plane against `main`, 2026-09-18.** The cells above are two points;
`lab/scripts/depth_session_matrix.sh` walks 24 — both frame sizes, depth 1/2/4/8, 1/4/16
sessions, six interleaved repeats each.

**CPU per ask falls in every one of the 24 cells, 6/6 in each**, by −5.9 % to −45.3 %. That
is the claim this work is kept for and it has no exception on this box. Throughput is up in
22 of the 24, from +1.5 % to +63 %; the two that are not are below. The 4-session rows at
32 KB are flat on throughput (+1.5 to +4.4 %, 1–3/6) because four sessions do not saturate
two cores — the CPU column still moves there, which is the point.

**One cell is materially worse, and it is not an obscure one.** 250 KB, depth 1, four
sessions:

| arm | p50 | p99 | asks / s |
| --- | --: | --: | -------: |
| `main` | 1 220 µs | **2 210 µs** | 2 936 |
| `main` + the quinn patch only | 776 µs (−33 %) | **27 928 µs (+1 160 %)** | 2 215 (−29 %) |
| this tree | 757 µs (−37 %) | **27 786 µs (+1 163 %)** | 2 109 (−29 %) |

The median ask gets faster and the tail becomes a probe timeout: ~28 ms is
`srtt + 4·rttvar` plus the peer's 25 ms `max_ack_delay`. **The GSO cap is the whole of it** —
`main` carrying only the patch reproduces it to within 1 %, so neither the pooled hand-off nor
anything else on this branch is implicated. [§10 entry 3](#10--latency-and-throughput-on-one-tree-where-they-part-and-what-joins-them)
predicted this from the other direction and measured the reverse of it (clamping 44 to 10 took
the same cell's p99 from 28.1 ms to 2.9 ms); this is the confirmation, arrived at from the
plane rather than from the hypothesis.

Why that cell and not its neighbours: at one session nothing drops (`rcvbuf_drops` 0) so no
tail is lost; at sixteen there is always another session's packet behind the frame, so a lost
tail is a gap and recovers in an RTT. Four is the band with enough traffic to drop and not
enough to backfill. Depth 1 is required — depth 2 at the same size and count is +12.5 %.

**So the branch is not unconditionally better than `main`.** It is better on CPU per ask
everywhere, better on throughput nearly everywhere, and worse at 250 KB when the client keeps
one ask outstanding and a handful of sessions share the box — which is what the product does
today, because neither client ships a window. The fix is already designed in §10 proposal 3:
clamp the batch when the session has nothing queued, or put an ACK-eliciting packet after an
isolated frame. Until one of those lands, or the client window ships and makes depth ≥ 2 the
normal case, this cell is the honest cost of the segment cap.

**Costs.** A 64 KB batch holds the connection lock about 30 µs longer than a 14 KB one, which
is where a fill's inter-arrival p99 widens (+68 % on the short 32 KB cell, n = 80; the 320-frame
fill below is the one to read). quinn now holds the reader's buffer until the peer acknowledges
it: memory per session is unchanged in total, since quinn held a copy before, and the pool keeps
at most 64 buffers per thread. PGO doubles the release build.

**Falsified by.** A CPU-bound cell on the production target where the combined binary does not
beat the plain one on CPU per ask; a quinn upgrade that moves the batching itself. Re-run:

```bash
cargo build --release -p exact-server -p disk-access-bench     # the tree: crates.io quinn + pool
# + --config 'patch.crates-io.quinn.path="patched/quinn"'     # the GSO cap, opt-in
scripts/pgo_build.sh                                             # → target/pgo/release/exact-server
git worktree add /tmp/before <commit-before-§9> && (cd /tmp/before && cargo build --release -p exact-server --target-dir /tmp/before-target)
SERVER_CPUS=0,1 CLIENT_CPUS=2,3 lab/scripts/runtime_ab.sh lab/fixtures/frames_250k/frames_250k.sbnd on-demand 4 100 16 6 \
  base /tmp/before-target/release/exact-server -- tree target/release/exact-server -- pgo target/pgo/release/exact-server > rt.tsv
lab/scripts/runtime_ab_pair.py rt.tsv base tree pgo
```

**Re-checked on this tree, 2026-09-23**, before the branch's server became this tree's: four
release binaries of the same source — `base` (this tree before the merge), `pool` (the hand-off
alone, the default build), `gso` (`pool` + the quinn patch) and `pgo` (`gso` through
`scripts/pgo_build.sh`) — in one `lab/scripts/runtime_ab.sh` run, server on cores 0–1 and the driver
on 2–3 of a 4-core i5-8250U laptop shared with other jobs, loopback, six repeats with the order
reversed every repeat, paired against `base`. Throughput cells quote asks/s, latency cells p50 or p99:

| cell | `pool` | `gso` | `pgo` | CPU per ask, `pool` · `gso` · `pgo` |
| ---- | -----: | ----: | ----: | ---: |
| 250 KB, 16 sessions, depth 4 — asks/s | +7.4 % (6/6) | **+25.8 % (6/6)** | +27.8 % (6/6) | −7.7 · −16.9 · −19.6 % (6/6) |
| 32 KB, 16 sessions, depth 4 — asks/s | +2.3 % (4/6) | **+26.8 % (6/6)** | +41.8 % (6/6) | −6.0 · −23.3 · −32.0 % (6/6) |
| 250 KB, 4 sessions, depth 1 — **p99** | −3.1 % (4/6) | **+1 390 %, 1.9 → 27.5 ms (0/6)** | +1 380 % (0/6) | −3.2 · −7.3 · −19.6 % |
| 250 KB, 1 session, depth 1 — p50 | −4.6 % (5/6) | −15.5 % (5/6) | −19.1 % (5/6) | −5.8 · −35.7 · −42.5 % |
| 32 KB, 1 session, depth 1 — p50 | −2.3 % (5/6) | −4.3 % (6/6) | −8.1 % (6/6) | −3.0 · −28.8 · −37.4 % |
| 250 KB fill, 80 frames — asks/s | +7.9 % (6/6) | +27.5 % (6/6) | +34.2 % (5/6) | −6.5 · −25.8 · −33.0 % (6/6) |

The pooled hand-off holds in every cell with nothing against it, so it is the tree's send path. The
GSO cap holds its win and **its regression reproduces** — the four-session depth-1 tail, to within
1 % of the 2026-09-18 figure — so it is an opt-in, not the default, until §10 proposal 3 or a
shipped client window removes that cell. PGO was then re-run **without** the cap (`base` · `pool` ·
`pgo` of the default build, same rig, n = 6): CPU per ask −13.4 / −19.6 / −14.9 / −18.0 / −15.3 %
against `base` on the 250 KB depth-4, 32 KB depth-4, 4-session depth-1, 1-session depth-1 and fill
cells, and the 4-session depth-1 p99 **−11.8 % (5/6)** — no cell against. It stays a per-build
script, as above. The host saturates at the two server cores in the depth-4 and fill cells; nothing
is claimed past them.

**With a browser and the wire buffer ring.** The hand-off changes what quinn holds, the ring what
the client holds, on the same frames. `lab/decoder-memory/` `path=downloader&hold=1`, three
decoders, a ring of 8, 87 × 512² 16-bit frames, headless Chromium 148, `base` and `pool` servers
up together, eight rounds with the order alternating: fill-and-decode wall **394.2 → 394.9 ms,
+0.4 % (3/8 lower)**, renderer peak **256.4 → 255.5 MB, −0.4 % (5/8)**, 87/87 frames bit-exact on
both arms. No interaction on loopback, where the browser's receive thread binds first (`T12`).

### 10 · Latency and throughput on one tree: where they part, and what joins them

**The question.** Minimise the round trip and maximise sessions per core at once. On this tree
the two part in four places. Each was measured 2026-09-12 on the 4 vCPU VM, client on the box and
unpinned, `--workers` at its default, six repeats paired and arm order reversed unless a row says
otherwise; loss is read from the client socket's `Udp: RcvbufErrors` (`runtime_ab.sh` now carries
the column), never assumed.

**1 · Depth.** One session, `server_ab`, medians of three sweeps with their ranges:

| frame | depth | p50 | asks / s | CPU / ask |
| ----- | ----: | --: | -------: | --------: |
| 32 KB | 1 | 148 µs (143–160) | 6 241 | 96 µs |
| 32 KB | 2 | 204 | 8 618 | 69 |
| 32 KB | 4 | 241 | 13 710 | 56 |
| 32 KB | 8 | 436 | 15 007 | 49 |
| 32 KB | 16 | 757 | 18 252 | 49 |
| 250 KB | 1 | 495 µs (495–512) | 1 855 | 373 µs |
| 250 KB | 2 | 790 | 2 306 | 338 |
| 250 KB | 4 | 1 443 | 2 614 | 345 |
| 250 KB | 8 | 3 085 | 2 380 | 369 |

Throughput is depth over latency, and the table is where the division stops paying: at 32 KB,
1 → 4 is 2.2× the asks per second for 1.6× the p50 and −42 % CPU per ask (fewer wakes and ACKs
per frame); past 4 the p50 grows with depth and the throughput barely. At 250 KB one session
saturates its endpoint thread at depth 2 — 345 µs of CPU per ask is one core at 2 900 asks per
second — and everything above is queue. The client library schedules none of this: each
`requestExactFrame` is one ask, a batch or a fill arms every waiter at once, and depth is whatever
the caller keeps outstanding. `D_min = ceil(0.95 × (1 + RTT / Tf))`
([`../adr-client-window-depth.md`](../adr-client-window-depth.md)) is the one setting that takes
the link's throughput at the least queueing, and it is built nowhere; L2 was to decide fixed
against dynamic and never ran.

Depth 1 is not a default for tiles. It is the formula's answer when `Tf ≫ RTT` — a large frame
on a slow link (the window ADR's 2.85 MB / 10 Mbps row: `D_min` = 1 already reaches 97 % of the
link). That is the case entries 2 and 3 have to survive, because "just ask two" is then the
wrong latency trade.

**2 · A lost tail at depth 1 costs a probe timeout.** 250 KB, depth 1, four and sixteen
sessions: p99 28–31 ms against a p50 of 1–3 ms in every repeat, with 22–81 datagrams dropped on
the client socket per run (212 KB default buffer). quinn's PTO is `srtt + 4·rttvar` plus the
peer's `max_ack_delay`, 25 ms by default and in Chromium, so a lost tail with nothing behind it
waits at least 26 ms; a loss mid-frame is found by the packets behind it within an RTT. With the
receive buffer at 1 MiB — Chromium's `kDefaultSocketReceiveBuffer` — the drops go to zero and the
tail with them: p99 30.7 → 8.5 ms at sixteen sessions, 28.1 → 2.5 at four. The buffer is the rig's;
the mechanism is the product's on any lossy link at depth 1, and only depth ≥ 2 (something
follows the loss) or the ack-frequency extension (quinn peers only) shortens it. A 1 MiB
receive buffer hid the drops on this rig; it does not hide loss on the path. If the product
ships depth 1 for large frames, this tail is inevitable the first time a last datagram is
lost — not a lab curiosity.

**3 · The 44-segment batch makes a drop a tail loss.** The patched quinn at its 44 against the
same source clamped to quinn's 10, 250 KB:

| cell | drops / run, 44 → 10 | p99 | asks / s | CPU / ask |
| ---- | -------------------: | --: | -------: | --------: |
| depth 1, 4 sessions | 24 → 56 | 28.1 → 2.9 ms (**−90 %**, 6/6) | +24 % (6/6) | +10 % (5/6) |
| depth 1, 16 sessions | 86 → 196 | 30.7 → 9.0 ms (**−71 %**, 6/6) | +4 % (5/6) | +10 % (6/6) |
| depth 4, 16 sessions | 226 → 670 | +9 % (5/6) | **−5 % (6/6)** | **+11 % (6/6)** |
| depth 1, 1 session | 0 → 4 | +6 % — tie | −7 % — tie | +20 % (6/6) |

Ten segments drop more often and lose ten packets each time; forty-four drop less often and lose
the frame's tail in one event. Where the pipe is full the 44 wins as §9 says; where a session is
serial and the receiver's buffer is short, it is the whole of the tail. One thing §9 did not
measure bounds it: quinn's pacer (`quinn-proto` `pacing.rs`) caps a burst at
`window × 2 ms / RTT`, clamped to 10–256 packets, and `poll_transmit` ends the batch when the
tokens run out. A 20 Mbps, 50 ms path has a window near 125 KB, so its burst is the 10-packet
floor and the cap never binds; a hospital LAN at 1 ms fills it. §9's −16 to −21 % is a loopback
and LAN figure. Derived from source, not measured: the cloud rig with netem prices it.

Clamping the product to 10 is one way to shrink the depth-1 tail, and it spends the CPU that
§9 bought wherever the pacer would have let a burst form. It is not the only way: a lost tail
is a missing packet with nothing after it, so anything that puts a packet after the frame
(the next ask, or an ACK-eliciting probe) turns it into a gap. Investigate that before
accepting 10 as the depth-1 answer — proposals below.

**4 · More endpoints than cores.** The same binary at `--workers` 4, 16 and 64 on four cores:

| cell | 16 vs 4 | 64 vs 4 |
| ---- | ------- | ------- |
| 32 KB, depth 4, 4 sessions | p50 −14 % (5/6), asks/s +10 % (5/6), CPU +4 % (5/6) | p50 −17 % (5/6), p99 −13 % (6/6), asks/s +14 % (5/6), CPU +4 % (6/6) |
| 250 KB, depth 4, 4 sessions | tie | tie |
| 250 KB, depth 4, 16 sessions | CPU +8 % (6/6), p50 — tie | CPU +12 % (6/6), p50 +8 % (5/6), asks/s −4 % (5/6) |
| 250 KB, depth 1, 3 or 15 sessions beside one fill | tie | tie |

A **worker** here is ours, not quinn's: `--workers N` binds N UDP sockets on one port
(`SO_REUSEPORT`) and runs N OS threads (`wt-endpoint-*`), each a `current_thread` runtime with
its own wtransport endpoint. Default `N` is the core count. The kernel hashes a client's
4-tuple onto one socket; that session's packets, connection driver, ask reader and serving loop
stay on that thread for life.

A session shares a thread with probability about `1 − (1 − 1/W)^(S−1)`; idle endpoint threads
cost nothing, and the kernel's scheduler is the work stealer at thread granularity until every
core is busy, where it charges thread switches. `--workers` above the core count is a
**small-N** hedge for that lottery (four sessions on four endpoints share a thread 58 % of the
time; on sixty-four, 5 %). It is not how thousands of viewers scale. Thousands already
multiplex on N threads; §8 recorded that the **counts** even out (~125 ± 10 on eight endpoints)
and the remaining risk is **load** — a few fills among idle on-demand sessions hashing onto
one thread. Extra threads do not add cores, and they do not stop two heavies colliding. Do not
take oversubscription as the scale-out plan. One endpoint per core remains the default that
uses every core; sessions per core is the CPU-per-byte work in §9.

**5 · LTO on this tree** (PR #27's profile, `lto = "fat"`, one codegen unit): sixteen sessions at
depth 4, CPU per ask −5.6 % (6/6) at 250 KB and −3.1 % (4/6) at 32 KB; 32 KB, depth 1, one
session: p50 +7 % (6/6 higher), asks/s −3.4 % (6/6), CPU −3.7 % (5/6). Small both ways, one
campaign. The p50 regression is a **depth-1** cell. If the product does not live at depth 1,
it does not decide the profile; if it does (large frames, above), that cell is the one to
weigh, not the saturation CPU win.

**6 · Closed by reading.** `max_udp_payload_size` 1472 → 4000 B, the largest lever in
[`../disk-access/adr.md`](../disk-access/adr.md) §8: Chromium's packet reader allocates
`kMaxIncomingPacketSize + 1` = 1 473 bytes per read and drops a datagram that does not fit, so
path discovery toward a browser cannot pass 1 472 whatever the path carries. Native quinn peers on
a jumbo-frame LAN remain the only takers.

**What joins them.** Per session there is one variable, **network** depth: `D_min` takes the
link's throughput at the least queueing, and depth ≥ 2 is also what turns a lost tail from a
probe timeout into a fast retransmit — except when `D_min` is 1, where that fix is the wrong
latency trade and the tail has to be solved some other way. Across sessions the currency is CPU
per byte (PGO and the frame pool on every path; the segment cap only where the pacer lets a
burst form). Placement is one endpoint per core, with sessions multiplexed on those threads;
oversubscription is not the thousands-of-users plan. The receiver sets the browser's ceiling
(`docs/rig-limits.md` §1 on the `docs/rig-limits` branch) and nothing here moves it.

**Proposals.** Product direction on the six entries, 2026-09-14. Not coded.

**1 · Network depth lives on the client; disk depth already lives on the server.**

Fill and on-demand already split the metric: fill is throughput (`StreamFrames`, one ask, the
server recites); on-demand is latency (named `RequestFrame`s, FIFO). Disk look-ahead is already
internal and independent of how the client issued messages — `TILE_SLOTS = 4` for tiles,
`FILL_AHEAD = 1` for fill, planner `ASKS_AHEAD = 8`. Do not couple "the user asked for N" to
"run the disk at depth N", and do not invent the next on-demand tile on the server: only fill
knows the next index.

What still needs building is the **on-demand network window**. `requestExactFrame` is one ask;
neither product client keeps outstanding asks. Decide who owns that schedule — this library or
the viewer — then hold a window there. L2
([`../lanes/L2-ask-policy.md`](../lanes/L2-ask-policy.md)) still decides fixed versus live
`D_min` once a window exists; it has not run. Fixed 4 is a plausible on-demand MVP for small
tiles on a fast link, not a constant for fill and not for large frames.

When `Tf ≫ RTT`, `D_min` is 1 and entries 2–3 apply. When it is not, depth ≥ 2 is both the
throughput setting and the tail-loss fix.

**2 · Treat the depth-1 probe timeout as a product risk, not a rig artefact.**

A lost last datagram at depth 1 waits quinn's PTO (~28 ms here: `srtt + 4·rttvar` + 25 ms
`max_ack_delay`). Mid-frame loss is a gap and recovers in an RTT. This will bite on the first
lossy link that ships depth 1. The interesting depth-1 case is large frames (entry 1), not
"we forgot to pipeline tiles."

**3 · Do not answer the 44-segment tail by accepting 10 packets as the product.**

44 is a LAN/loopback CPU and throughput win when the pipe is full, and a depth-1 tail tax when
a drop takes the end of the frame. On a 20 Mbps / 50 ms path the pacer's burst floor is already
10, so the 44 never forms — unmeasured here (no `sch_netem`). Clamping to 10 everywhere spends
that CPU on LAN to buy a tail that only exists when nothing follows the frame.

Investigate, in this order, before changing the vendored cap:

1. **An ACK-eliciting packet after an isolated frame** (nothing else queued — the depth-1 /
   large-frame case). A lost last datagram then has a packet after it and becomes a gap, not a
   PTO. Depth ≥ 2 already does this with the next ask; this is the same mechanism when the
   next ask must not exist.
2. **Clamp 44 only when the session has nothing queued**, not on every send. Fill and
   pipelined on-demand keep the 44.
3. **The shaped cell** at 20 Mbps / 50 ms: if the pacer already holds the burst at 10, the
   LAN/loopback 44 can stay.

Ack-frequency shortens PTO only for quinn peers; Chromium is not one. Splitting the last
datagrams of a GSO batch without putting something after the frame still leaves a tail.

**4 · `--workers` is endpoint threads. One per core is the scale-out default.**

See entry 4. Do not sweep `N` ≫ cores as the thousands-of-users plan. Measure the heavy-tail
mix (a few fills among many idle on-demand sessions) on the target at the default worker
count; that is the placement question that remains.

**5 · Weigh LTO on the depth-1 cell if we ship depth 1; otherwise take the CPU.**

PR #27. The +7 % p50 (6/6) is 32 KB, depth 1, one session. Saturation at depth 4 is a 3–6 %
CPU win. Large-frame depth 1 is the cell that can veto it; depth 4 cannot.

Still unrun on this VM (no `sch_netem`): per-frame streams with ask-order priority at 250 KB
under loss (arm Q; at 32 KB it read inside noise at 0.5 % loss, +1.5 % pooled at 2 %, and +28 %
on the reader clock at 2 % — `L1_V3_PHASE_C_REVIEW.md` on the archive tag).

Re-run:

```bash
lab/scripts/runtime_ab.sh lab/fixtures/frames_250k/frames_250k.sbnd on-demand 1 100 4 6 \
  w4 target/release/exact-server --workers 4 -- w16 target/release/exact-server --workers 16 > rt.tsv
lab/scripts/runtime_ab_pair.py rt.tsv w4 w16              # p99 and rcvbuf_drops are the columns to read
sysctl -w net.core.rmem_default=1048576                      # entry 2's control; 212992 restores it
# entry 3: clamp `max_transmit_segments` to 10 in patches/quinn-0.11.11-mtu-gso.patch and pass both binaries
```

---

## Campaign instruments (on the tag)

Guards that refuse the wrong fixture, analysers that print `n` and do not average VOID
rows, the loss-regime sampler's one-write-per-row fix, and the comment-placement pass are
not product decisions. They live in the tag copy of this file as entries 6–13 and 16–17.
