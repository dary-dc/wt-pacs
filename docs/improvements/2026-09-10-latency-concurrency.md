# Latency, fourth pass — 2026-09-10: why the number does not move

**Branch:** `cursor/latency-max-concurrency-1676` · **Status:** analysis + protocol, plus **three
small code changes** ([§What this pass changes](#what-this-pass-changes)). Every number on this page
is quoted from an earlier pass; **this pass took no numbers of its own** and the three changes are
unmeasured here (see [§Unmeasured](#unmeasured-on-this-host-and-why)). Front door:
[`README.md`](README.md); ledger: [`ledger.md`](ledger.md).

**Brief.** The ask was "minimize latency as much as we can", at "the highest amount of concurrency
possible". Four branches have now tried. What landed is three changes each argued from an ordering
or an RFC rather than from a measurement; the rest of this page is the reason the arms tie, the
levers already closed so nobody reopens them, and the interleaved A/B a later run on a quiet box
must use to price what landed. On concurrency itself the answer is negative and recorded as such:
[§Considered and rejected](#considered-and-rejected-concurrent-frame-writes).

**Two of the sources are not on this branch.** `docs/improvements/2026-09-10.md` and
`docs/serving-cells-and-run-variance.md` live on `claude/serene-rubin-wakfg7`; links to them go to
that branch. Locally: `git show origin/claude/serene-rubin-wakfg7:<path>`.

---

## What was already closed

Measured to nil, or measured and found to be a property of something we do not own. Each row
links the document that closed it. **Do not retry these without new hardware or a new client.**

| lever | verdict | closed by |
| ----- | ------- | --------- |
| `max_udp_payload_size` 1472 → 4000 B (−35 % CPU, +55 % throughput with a quinn peer) | **closed for browser clients.** Chromium 141 advertises 1 472; quinn bounds discovery by the peer's parameter. With the server bound at 8 972 the largest datagram was still 1 472, 0 of ~85 k above it. Nothing server-side moves it | [`2026-09-10.md` §UDP payload size](https://github.com/dary-dc/wt-pacs/blob/claude/serene-rubin-wakfg7/docs/improvements/2026-09-10.md) |
| `aws-lc-rs` instead of `ring`, on VAES/AVX-512 | **tie or loss.** +3–5 % CPU/frame at 32 KB (4/4), a tie at 250 KB, +10–18 % peak RSS, +2.2 MB binary in every cell | [`2026-09-10.md` §Crypto provider](https://github.com/dary-dc/wt-pacs/blob/claude/serene-rubin-wakfg7/docs/improvements/2026-09-10.md) |
| server application code as a hotspot | `exact_server::*` **< 0.3 %** of instructions under callgrind; ring AES-GCM 31–36 %, `memcpy` 13–15 %, quinn ~10 %. Two small per-frame allocations against 140–900 µs of QUIC work | [`ledger.md` §3](ledger.md) |
| tokio worker count / blocking-pool cap | not a lever: the tile ring and the fill reader bound OS threads by design | [`2026-09-10.md` §Checked and left alone](https://github.com/dary-dc/wt-pacs/blob/claude/serene-rubin-wakfg7/docs/improvements/2026-09-10.md) |
| `tracing` per-packet events | interest-cached off under the default filter; absent from the instruction profile | [`2026-09-10.md` §Checked and left alone](https://github.com/dary-dc/wt-pacs/blob/claude/serene-rubin-wakfg7/docs/improvements/2026-09-10.md) |
| `posix_fadvise(WILLNEED)` look-ahead, warm | nil by construction, and **−7.5 % (18/25, P = 0.022) under a browser** on the fill cell: the study is wholly page-cached, so the syscalls buy nothing. Its worth is the cold 250 kB regime only | [`serving-cells-and-run-variance.md`](https://github.com/dary-dc/wt-pacs/blob/claude/serene-rubin-wakfg7/docs/serving-cells-and-run-variance.md) §branch vs main |
| cold storage as a stall source, on NVMe | **eviction has nothing to bite on.** A fully evicted 61 MB study still reports `fill_hits=237 fill_misses=0`; residency verified 1.0 → 0 → 1.0 per run. The one-frame look-ahead completes before the reader needs it | [`serving-cells-and-run-variance.md`](https://github.com/dary-dc/wt-pacs/blob/claude/serene-rubin-wakfg7/docs/serving-cells-and-run-variance.md) §Why it cannot |
| `new TextEncoder()` per FoD ask (client) | 8–11 µs either way in Chromium, 1.8 µs either way in Node — the constructor is free | [`ledger.md` §3](ledger.md) |
| zero-copy send path / coalesced header write | withdrawn: already shipped as the chunked send path | [`ledger.md` §2](ledger.md) |

`lto = "fat"` + `codegen-units = 1` is the one server lever that ever cleared its noise on this
class of box: **−4 to −8 % CPU per frame, 4/4 repeats, in all four cells, with no overlap between
arms** ([`2026-09-10.md` §P1](https://github.com/dary-dc/wt-pacs/blob/claude/serene-rubin-wakfg7/docs/improvements/2026-09-10.md)). It is already landed. Note what it is — a compiler
setting that speeds up *quinn and ring*, not our code. That is the shape of every real win here.

---

## Why the number has not moved

Five branches, one direction of evidence.

**1 · The send path is the ceiling, and it is not ours.** On the browser-free rig, `locate` and
`prepare` are ~0 and **99 %+ of `serve_us` is `send`**. All three arms — `main`, the branch, and an
independent reference implementation of the same protocol — land inside 225–284 MB/s. The two
stacks are paying the same QUIC cost, and the profile agrees: AES-GCM plus `memcpy` plus quinn is
~60 % of instructions, our code is 0.3 %. There is no latency left in the parts of the process we
wrote; the levers that remain are in the crates below us (a compiler profile reaches them) or in
the client (`max_udp_payload_size` — closed).

**2 · The rigs are transfer-bound, so a real win hides inside run-to-run spread.** Quoted from the
docs that closed the arms:

* Same binary, same cell, four independent batches: **median spread 1.86×** — 13 474 µs against
  25 083 µs with no code change ([`serving-cells-and-run-variance.md`](https://github.com/dary-dc/wt-pacs/blob/claude/serene-rubin-wakfg7/docs/serving-cells-and-run-variance.md)).
* Re-running an identical configuration moves a median up to 7 % within a run and ~11 % p50
  across runs ([`2026-09-08.md`](2026-09-08.md)).
* On the reference rig, **one arm's own run-to-run range is wider than every median gap between
  arms** (fill wall 203–286 ms against a 1.5 % median difference).

A lever worth 5 % is invisible against that unless it is paired and interleaved. Most of these
passes reported "indistinguishable", which is the honest reading of a tie, not a failed change.

**3 · Several branches measured the wrong quantity.** `serve_us` is not a speed. It covers the read
plus `write_all` into the `SendStream`, and `write_all` returns when the send buffer accepts the
bytes — **awaiting only on flow control, which is the peer's**. Consequences, all measured:

* Identical server code reads **2.18× lower under a browser** than under the native driver
  (fill `serve_us` p10 12 846 → 5 881), because a browser's larger send window lets the span close
  before delivery finishes.
* At depth 1 the serve spans are a ninth of the session wall (ratio 0.11 vs 0.94 in fill); a depth
  ladder makes `serve_us` p50 climb **10×** (15.0 → 156.5 µs) while wall per frame *falls*
  (276.6 → 196.3 µs).
* On the reference rig the branch read *closer to the reference* than `main` did (213 942 vs
  224 478) while wall time showed no difference at all.

So a `serve_us` figure without its client and its depth is not comparable to anything, and three of
the tables that once looked like movement were the driver moving, not the server. **Compare wall
time.**

**4 · Retracted: "planner read-ahead reach, ~20 % p50, written and reverted".** An earlier revision
of this page named that as the one real unshipped latency lever, citing
`cursor/read-path-p1-p7-dfb4` §16.4 for the number and `83dc813` ("written and tested, then
reverted") for the loss. **Both halves are wrong**, and nothing should be spent chasing the 20 %
figure. Corrected here rather than deleted, per [`CLAUDE.md`](../../CLAUDE.md):

* **It was not reverted, and it is not a lever.** `83dc813` is documentation-only — 1 file changed,
  `docs/disk-access/READ-PATH-DESIGN.md`; its subject line refers to the *other eight* proposals in
  §18, not P1. P1 landed two commits later in `4d6b1ce`, §18.1 on that branch is headed
  "— landed", and P1 is on **this** branch today at
  [`read_path.rs:295-306`](../../server/src/media/read_path.rs). It is telemetry: two `u16` maxima
  and two log fields (`named`, `in_flight`).
* **§16.4 labels that cell a tie.** −20.6 % with 7 of 8 signs agreeing across eight interleaved
  rounds does not clear this repo's 28.5 % rule (see [§How to measure it
  honestly](#how-to-measure-it-honestly)). What it compared was read-ahead **present against wholly
  absent** — the `serve` seam severed — not one reach against another.
* **Reach was never a constant to raise.** The planner names only frames the client has already
  asked for, so reads in flight are `min(client depth − 1, W − 1) + 1` (§16.5).
  `ASKS_AHEAD = 8` already exceeds `TILE_SLOTS = 4` and `read_path.rs:295` truncates to the slots,
  so **no slot idles for want of a planner constant**. What the reach actually follows is client
  depth, which is the client's call ([`adr-client-window-depth.md`](../adr-client-window-depth.md)).

So there is no unshipped read-path win on that branch. What §16.4 did leave is the point in §5
below: read-ahead matters when a read can miss, and neither box here can make one miss.

**5 · Neither box can price the read path at all.** The 8-core workstation never produces a major
fault on NVMe, and the 4 vCPU VM is transfer-bound. The interesting design variable — this server
probes with `preadv2(RWF_NOWAIT)` and escalates to a blocking pool, the reference faults inline on
the reactor via `mmap` — should decide the question on hardware where a fault costs milliseconds.
**A rig that cannot make the reader miss cannot price either design.** Candidates are recorded:
slower storage, a study far past RAM, or a reduced `read_ahead_kb`
([`disk-access/NEXT.md`](../disk-access/NEXT.md) #6, where that knob already moves miss rate 2–15×).

---

## What this pass changes

Three code changes landed. **None of them has a number on this host** — see
[§Unmeasured](#unmeasured-on-this-host-and-why). Each is argued from an ordering or from an RFC,
and where a test pins the ordering the test is named.

**1 · The tile reader recycles a slot with no read in flight**
([`read_path.rs`](../../server/src/media/read_path.rs)). `free_slot` returned the first slot not
holding a *named* frame. On a jump out of the named window that slot can be one still holding an
**abandoned in-flight prefetch**; `read` then awaited that dead read before submitting the read for
the frame the client actually asked for — a full miss round trip in front of a wanted frame.
On-demand sessions jump, and there a miss is the norm. Steady forward serving always recycled the
just-served slot and is unaffected, so this is a **jump-path fix only**. Pinned by
`an_abandoned_tile_prefetch_does_not_delay_the_frame_that_replaces_it`, mutation-checked: with the
preference disabled it fails, reporting 2 reads in flight against 3. **The claim is that ordering,
not a latency number.**

**2 · `send_fairness(false)`, plus the RFC initial window**
([`tuning.rs`](../../server/src/transport/tuning.rs)). In per-frame mode each frame is its own uni
stream, and `write_all` returns when quinn accepts the bytes into the send buffer, not when they are
acked (§3 above) — so with a 10 MB send window several frames sit queued on distinct streams at
once. quinn's default fair queuing round-robins their bytes onto the wire, which makes each frame's
completion time the **batch's** rather than its own, and an in-order decoder waits out the
interleaving. FIFO service makes a frame's completion its own. Shared-stream mode has one stream, so
it is a no-op there and **cannot regress that arm**.

Separately, Cubic/NewReno `initial_window` 12 000 → 14 720 B: that is RFC 9002 §7.2's
`min(10*MTU, max(2*MTU, 14720))` at this path's real 1 472-byte datagram, which quinn otherwise
clamps down because it computes against a conservative 1 200-byte base. Also `keep_alive_interval`
at a third of the idle timeout, so an idle session is not dropped mid-study (a dead peer still times
out — RFC 9000 §10.1); and `initial_rtt` exposed as `--initial-rtt-ms` with **its default
unchanged**, because it times handshake loss recovery only, until the first RTT sample, and a blind
default change was not defensible.

**3 · Session setup joins two independent awaits**
([`server.rs`](../../server/src/transport/server.rs)). `handle_incoming` accepted the client's
control bidi stream and only then opened the media uni stream; the two are independent and now run
under `tokio::try_join!`. QUIC stream creation is local, so the saving is the open cost, **not a
round trip — microseconds**. Small, and said to be small.

### Considered and rejected: concurrent frame writes

The brief for this pass was literally "the highest amount of concurrency possible". The answer is
that **more concurrency here is a latency regression**, on three counts.

* **Serving is already read/write concurrent.** The tile reader starts the current read plus up to
  `TILE_SLOTS - 1` upcoming and awaits only the current; the fill reader starts the next frame's
  read before returning. A missed read for frame *k+1* is already in flight for the whole write of
  frame *k*. Concurrent writes add nothing to that overlap.
* **A bandwidth-bound link divides one window N ways.** N concurrent frame writes split the
  congestion window, so the **first** frame — the one the client's decoder is waiting on — completes
  *later*, and the aggregate finishes no sooner. This is change 2 above, in reverse.
* **It is a second ordering scheme over the client's ask order**, which
  [`adr-reject-server-ordering.md`](../adr-reject-server-ordering.md) rejects on its own terms; and
  shared mode commits frames to one stream in order by construction.

---

## How to measure it honestly

Browser-free, native driver on both sides. The repo already has the interleaved rig; use it rather
than a new script. `lab/scripts/server_ab.sh` builds the base in a **git worktree with its own
target directory**, keeps **both servers up for the whole run** and alternates the driver between
them, so a host drift cannot masquerade as a delta.

```bash
# fixtures + cert once; the script generates what is missing
bash server/scripts/gen_dev_cert.sh

# interleaved A/B of exact-server: HEAD against a base commit.
# Both arms live for the whole run; the driver alternates. Reports tie / RESOLVED per cell.
REPEATS=12 ASKS=256 lab/scripts/server_ab.sh <base-commit>

# read-path only, rotating binary order every round (round r even: before,after; odd: after,before)
REPEATS=12 lab/scripts/read_path_ab.sh <base-commit>
```

For a send-path or CPU-per-frame question, the saturate harness, one binary per arm in a **separate
target dir**, arm order reversed every repeat:

```bash
cargo build --release -p window-harness
CARGO_PROFILE_RELEASE_LTO=false CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16 \
  cargo build --release -p exact-server --features telemetry --target-dir /tmp/base
cargo build --release -p exact-server --features telemetry --target-dir /tmp/arm
git show archive/improvements-lab-2026-09:lab/improvements/scripts/sendpath_ab_bench.sh > /tmp/ab.sh
sed -i 's/--ipv4/--bind 127.0.0.1/' /tmp/ab.sh
REPEATS=4 bash /tmp/ab.sh out.jsonl base /tmp/base/release/exact-server arm /tmp/arm/release/exact-server
```

Four cells (32 KB / 250 KB × shared / per-frame), `--mode saturate --depth 4 --read-bps 0`, 4 s
dwell. **A batch of one arm followed by a batch of the other is not a comparison** — a sequential
before/after read +8.1 % on code that was a tie here, and produced a false 30 %-versus-43 %
"improvement" before it was caught.

**Which statistic to quote.** Contention only ever makes a run slower, so the low decile measures
the server and the median measures how busy the box was:

| statistic | spread across four batches of the same binary |
| --------- | --------------------------------------------: |
| min | 1.10× |
| **p10** | **1.05×** |
| p25 | 1.28× |
| median | 1.86× |

Quote **p10 across runs** — not inside a run; each run reports exactly one total — or quote the whole
distribution. Never a median from one batch against a median from another. Two caveats from the same
document: p10's stability was established on the **87-frame** cell and does **not** carry to cells an
eighth the size (a 10-frame cell's p10 read 26 % apart across batches), and every figure must name
its **driver and depth** or it is not comparable.

Prefer **wall time** for a "is it faster" question and treat `serve_us` as a span-placement
diagnostic. Report paired deltas per repeat with sign counts, sign-tested against a fair coin; the
campaign rule is |median| ≥ 28.5 % **and** sign ≥ 0.8n **and** the same sign in both runs, `MIN_N`
5.

**Where the host saturates, so nothing is claimed past it.** The 4 vCPU VM's saturate rig tops out
at **~1 830 frames/s at 32 KB (~60 MB/s)** and **~1 110–1 300 frames/s at 250 KB (~280–325 MB/s)**;
the 8-core workstation's browser-free rig lands at **225–284 MB/s** across all three arms including
the reference implementation. Both are transfer-bound at those points: throughput there moves
+2 to +5 % inside its own noise and is worth quoting only to prove nothing regressed. **No latency
claim from either rig extends past its own saturation point**, and neither rig can produce a read
miss, so neither says anything about the read path.

---

## Unmeasured on this host, and why

**Everything under §What this pass changes is UNMEASURED.** It was written on a **4 vCPU VM with
four agents building and running concurrently**, and three reasons make any number taken in that
window worthless:

1. **Concurrent load.** The median-vs-p10 table above is exactly this effect: 1.86× on the same
   binary from nothing but how busy the box was. With three other builds competing for four vCPUs,
   even p10 is not protected, because p10's stability was established on an otherwise idle host.
2. **Transfer-bound.** Both sides share the CPU on localhost with no shaping; wall time in fill
   cells moves inside its own noise, which is wider than any effect this pass could plausibly have.
3. **The rig cannot miss.** Per §5 above, no cell available here exercises the read path, so a
   read-path change cannot show even in principle.

Per [`CLAUDE.md`](../../CLAUDE.md), an unmeasured claim says so. This one does. The protocol above
is what makes it measurable later: run it on a quiet box, interleaved, and quote p10 across runs on
wall time.
