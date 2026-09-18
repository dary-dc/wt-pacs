# Transport optimisation — conclusions

What this lane decided. Product source is the chunked send path, `--stream-mode`
default `shared`, `--prefault true`, Cubic default, windows at quinn defaults.

**Target (2026-09-14):** a browser on a mobile, lossy wireless link — radio loss, which is
§1's BBR regime, pending the congestive share of the mix. What is open: [`NEXT.md`](NEXT.md).

The full campaign write-up (method, reviews, TSVs, reproduce commands) is on tag
`archive/transport-lab-2026-09` at this same path:

```bash
git show archive/transport-lab-2026-09:docs/transport/transport-conclusions.md
```

---

## The answer

| decision | verdict |
| -------- | ------- |
| **Congestion controller** | **Two opposite answers, depending on which kind of loss the link has.** Congestive → **Cubic**. Radio/exogenous → **BBR**. Both directions large and separated. **Default to Cubic** until the mix is measured |
| **Stream shape** | **One shared stream — the binary defaults to it.** In simulation, per-frame is 3.5× worse at 64 KB and 8.5× worse at 250 KB. On a real path the 64 KB cell is noise-dominated; the 250 KB cell separates: per-frame is **5.76× worse**, 3/3, and the absolute penalty matches the simulator to 1.6 %. No cell on either rig separates in per-frame's favour |
| **Fixed-N pool** | Untested. R6 makes it less promising: retransmit-deferral cost grows with N, and the winning endpoint is N = 1 |
| **Initial congestion window** | Leave at quinn's default — ≤ 7 %, ranges overlapping |
| **GSO segment cap 10 → MTU-derived** | **Applied 2026-09-10** (build-time patch on crates.io quinn 0.11.11): −16 to −21 % CPU per ask, 6/6 in six of seven pinned cells, +19 to +29 % throughput where the pipe is full. 45 segments at 1452-byte MTU (`65527 / mtu`); an earlier write-up said 44 at 1452. The earlier real-hardware cell was path-bound, so it could not show a CPU lever. [`why-these-changes.md` §9](why-these-changes.md#9--cpu-per-byte-segments-per-sendmsg-a-profile-guided-build-one-copy-fewer) |
| **Chunked send path** | Keep. −6…−14 % CPU/byte, and it is what contains a stalled client (below). The only send path in `server/` |
| **Flow-control windows** | Hygiene on this send path. A client that asks for 25 MB and stops reading costs **180 kB**. Left at quinn defaults |
| **Runtime shape** | **Parked 2026-09-18, not in `server/`.** One endpoint per core on single-threaded runtimes won every single-session cell (−23 to −40 % on the depth-1 round trip, −40 to −64 % CPU per frame) and +8 to +17 % at saturation on six of eight cells — but it pins a session to the thread its 4-tuple hashed to, and T6 measured the cost: **12 of 16 NAT rebinds kill the session**, silently, against 0 of 6 on one endpoint ([`../lanes/T6-session-survival.md`](../lanes/T6-session-survival.md)). On a mobile target that is a correctness cliff, and the saturation case at thousands of sessions was never measured. The work is whole on branch `claude/per-core-endpoints`; it returns if T6 finds a steering answer and T10 shows it scales. `server/` is back to one endpoint on the multi-thread runtime. [`why-these-changes.md` §8](why-these-changes.md#8--one-endpoint-per-core-each-on-a-single-threaded-runtime) |

Rejected arms (`copy` / `split`, MTU / GSO / socket knobs) are not in `server/`.
`--stream-mode per-frame` stays a product flag, and since 2026-09-14 ranks its streams by ask
order — the L1 lane's arm Q, one flag away for the rig ([`NEXT.md`](NEXT.md) item 3).

---

## 1 · Controller: two answers, which applies is measurable

Every flip in this work happened because a campaign sat in one loss regime and the result
was read as general. The two regimes were run side by side, each verified by queue-drop
counters.

**Congestive** (queue overflow is the only loss) — Cubic wins, and the margin is at high
RTT. At 600 ms / 8 Mbps: Cubic 941 ms vs BBR 1535 ms (BBR is n = 2; Cubic's worst repeat
still beats BBR's best). BBR also drops 30–100× more packets at the bottleneck.

**Exogenous** (1 % radio loss, queue never drops) — BBR wins by roughly half at both RTTs
(−48 % at 50 ms / 20 Mbps; −44 % at 600 ms / 8 Mbps).

5G, satellite and WiFi have both kinds. The diagnostic is: is loss correlated with
queueing delay? RTT rising before loss → congestive → Cubic; loss with RTT flat → radio →
BBR.

**Default Cubic** until that mix is measured: it is the incumbent; it is the safer error
(63 % worse if wrong, against 48 % the other way); and BBRv1's queue-drop excess is
inflicted on other traffic sharing the link.

That neighbour cost is measured. Two flows, one shared 5 Mbps bottleneck, Oracle rig:

| bottleneck buffer | our flow | competing TCP Cubic | our share |
| --- | --- | --- | --- |
| shallow, ≈48 ms | QUIC BBR | 0.03 Mbps | 99.4 % |
| shallow, ≈48 ms | QUIC Cubic | 1.46 Mbps | 70.0 % |
| deep, ≈1.2 s | QUIC BBR | 2.12 Mbps | 55.1 % |
| deep, ≈1.2 s | QUIC Cubic | 1.07 Mbps | 76.8 % |

The same TCP flow takes 4.5 Mbps alone against the shallow bottleneck — BBR starves it
150×. In a shallow buffer (an access link) BBR takes essentially everything. Cubic is not
innocent (70–77 % from a flow that can take 90 % alone). BBR's 48 % latency win in the
radio regime still stands; the Cubic default is a case about people who are not our users.

---

### quinn's BBR read against the published BBRv1, 2026-09-15

[`T2`](../lanes/T2-controller.md) step 1 asks for this before any cell, because moq-dev's issue
#686 calls quinn's BBR "horribly broken from every indication" without naming a cause. Reading
`quinn-proto-0.11.17/src/congestion/bbr` (651 lines) found no such thing.

**What is faithful.** The four modes and their transitions; the constants, all matching
BBRv1 — high gain 2.885, pacing cycle `[1.25, 0.75, 1×6]`, startup growth target 1.25, three
rounds without growth before leaving Startup, derived cwnd gain 2.0; the gain-cycle seed, which
draws 0–6 and bumps anything ≥1 so the phase never starts at 0.75; and the recovery window's
arithmetic including its floor at `in_flight + bytes_acked`. There is not one `TODO`, `FIXME`
or "simplified" marker in the file.

**One candidate deviation, and it may explain §1's two-sided result.** `window()` applies the
recovery window only when `mode != Startup`, unconditionally:

```rust
} else if self.recovery_state.in_recovery() && self.mode != Mode::Startup {
    return self.cwnd.min(self.recovery_window);
}
```

Chromium's BBR gates that same exemption on a `rate_based_startup_` option; quinn has no such
flag and no way to turn it off. If that reading is right, **loss never limits the window during
Startup** — which is precisely the behaviour that would produce both halves of the measurement
above: −44 to −48 % on exogenous loss, where ignoring loss is correct because the link is not
congested, and worse on congestive loss, where it is not.

**What this review cannot do.** T2 asks for a diff against quiche's `bbr_sender.cc`, and that
source is not available in this environment — this is a reading against the published algorithm
instead. The `rate_based_startup_` claim above is from recollection of Chromium's source, not
from reading it, so **treat it as the first thing to check rather than as a finding**. Whoever
has quiche to hand should confirm or kill it before any rig time is spent: if it holds, the
controller question is partly a one-line question, and the cells should be designed to separate
Startup behaviour from steady state rather than to compare two controllers whole.

## 2 · One shared stream

The textbook argument (per-frame confines loss to one frame) was pre-registered as H4 and
lost. quinn's `retransmit()` re-queues with `push_pending` — behind every already-queued
stream, regardless of fairness. With one stream, recovery goes out ahead of newer data on
that stream. With per-frame, the lost stream goes to the back of the queue and waits
behind other frames' full backlogs.

| | shared | per-frame + FIFO | ratio |
| --- | --- | --- | --- |
| netsim, 64 KB | 182.2 ms | 637.1 ms | 3.5× |
| netsim, 250 KB | 372.7 ms | 3159.5 ms | 8.5× |
| real path, 64 KB | — | — | not a result (realisation noise 4.32×) |
| **real path, 250 KB** | **594.7 ms** | **3426.2 ms** | **5.76×** |

The mechanism predicts an *absolute* penalty (wait behind D−1 whole frames). That penalty
reproduced across rigs: 2787 ms on netsim vs 2832 ms on the real path, **1.6 % apart**.

X3L on the Oracle rig was the deciding cell, pre-registered before it ran: if `shared`
separates with the stranding gate passing, flip the default. It did (3/3, 10.8–29.0 MB
stranded, zero censoring). The binary defaults to `shared`. `per-frame` remains a product
flag.

`send_fairness(true)` is worse than FIFO in every cell it was tried — a scheduling
penalty, not a HOL finding. The flag is gone from the product crate.

A closed-loop reader cannot produce head-of-line blocking (stranded bytes: 0.00 MB). No
stream-shape result from `--reader-mode closed` is admissible. The harness default is
still `closed`; campaign cells that ask this question use `open`.

### The three-arm campaign, 2026-09-15 — the default is confirmed, and a third shape is closed

The 2026-09-11 verdict above compared `shared` against per-frame **with FIFO scheduling**. Two
things had changed since: per-frame streams now descend in priority with their ask, which
removes the retransmit deferral that lost it 5.76×, and `--stream-mode pool:k` deals frames
round-robin over `k` long-lived streams — a shape nothing in the record had tested.

Six repeats per cell at 250 KB, depth 2, 10 Mbit / 60 ms, arms interleaved with the order
reversed every repeat; the bursty cell re-run at eighteen. Full method, the faults found in it,
and every retraction: [`../lanes/T3-stream-shape.md`](../lanes/T3-stream-shape.md).

| cell | `per-frame` vs `shared` | `pool:2` vs `shared` |
| --- | --- | --- |
| no loss | +0.1 %, CI [−17.2, +21.0] | **+74.9 %**, CI [+16.9, +41.5] |
| 0.5 % iid | −7.0 %, CI [−23.8, +2.9] | **+69.2 %**, CI [+34.1, +85.1] |
| bursty, 18 repeats | −21.7 %, CI [−45.2, +79.8] | **+88.1 %**, CI [+73.9, +294.3] |

Equal-N p95 over every step. The pre-registered metric pooled positive waits only, which
compares one arm's bulk against another's tail when their miss rates differ — `shared` gave 126
samples to `pool:2`'s 867 in the bursty cell — so both are reported and this is the one to read.

**`shared` stays the default.** No `per-frame` interval excludes zero at any loss level, and
its per-run p95 in the bursty cell has the same median as `shared`'s, 65 ms, on distributions
that overlay. Priority repaired what FIFO broke — per-frame is no longer 5.76× behind, it is
level — but level is not a reason to change a default.

**`pool:k` is closed, and not narrowly.** It costs ~75 % on the tail with no loss at all, from
interleaving two frames a shared stream would serialise; it strands 24–26 frames per run of 49
against 2–6; its mean wait is seven times the others'; and in the bursty cell it sat at exactly
483 ms in fifteen runs and **collapsed to 26 seconds in two of eighteen**. Four independent
signals, one direction. The flag stays for the record; nothing recommends it.

**Throughput separates the arms nowhere.** Six 10-second saturation probes per arm per loss
level, no latency repeats (`REPS=0 PROBE_REPS=6`):

| loss | `shared` | `pool:2` | `per-frame` | spread within an arm |
| --- | ---: | ---: | ---: | ---: |
| 0 % | 4.30 f/s | 4.10 (−4.7 %) | 4.30 (+0.0 %) | 1.0–1.1× |
| 0.5 % | 4.30 | 4.00 (−7.0 %) | 4.35 (+1.2 %) | 1.3–3.0× |
| 2 % | 2.65 | 1.95 (−26.4 %) | 2.05 (−22.6 %) | 2.3–3.5× |

At 2 % every arm's six probes span roughly 3×, and all three ranges overlap almost entirely, so
the medians order nothing. `pool:2` is a few percent low everywhere, consistent with its cost
elsewhere but not separable here either.

This cell exists because a **single 4-second probe** had read `shared` 1.00 f/s against
`per-frame` 3.50, which this lane published as a 3.5× capacity finding and retracted within the
hour ([`../lanes/T3-stream-shape.md`](../lanes/T3-stream-shape.md)). The powered cell shows why:
`shared`'s six probes span 1.3–3.8 and `per-frame`'s 1.0–3.5. **Both of those single values sit
inside the other arm's range** — two draws from opposite ends of overlapping distributions. The
variance at 2 % loss is most of the signal, and one sample of it is worth nothing.

**The finding that outweighs the arms.** From the same baselines, bursty loss degrades `shared`
by 38 % where scattered loss of the same 0.5 % mean degrades it by 9 %. The delivery *shape* of
the loss costs four times what its rate does, and neither stream arm changes that. On a target
stated as a mobile radio link that points at the congestion controller
([`../lanes/T2-controller.md`](../lanes/T2-controller.md)), not at the streams.

---

## 3 · Density, send path, windows

Measured on loopback, never through the path simulator (which forwards datagram-by-datagram
and destroys GSO batching).

| item | effect |
| ---- | ------ |
| GSO cap 10 → 32 | +17.2 % / −20.9 % CPU/byte at 250 KB, n = 1; real-hardware re-run −1.0 % / +8.1 %, overlapping. Superseded: the tree now derives the cap from the MTU (below) |
| Chunked send path | −6…−14 % CPU/byte at every rate. Only path in `server/` |
| Per-frame prefault hop, warm cache | costs 10 % throughput, 14–34 % CPU/byte |
| `aws-lc-rs`, ACK frequency, socket buffers, initial MTU | ≤ 3 % or nil |

**The GSO cap is not a server flag.** `MAX_TRANSMIT_SEGMENTS` is still a compile-time
constant in quinn 0.11.11 and on upstream `main`; there is no `TransportConfig` knob.
The tree applies `patches/quinn-0.11.11-mtu-gso.patch` at build time to the crates.io
tarball: segments per `sendmsg` are `min(platform, 65527 / mtu)` (45 at 1452, 44 at
1472) and the driver may emit 64 datagrams per poll instead of 20. Never raise the cap
by reading `max_gso_segments()` alone: exceeding 65 527 bytes returns `EINVAL` and
`quinn-udp` disables offload permanently for that socket. Refresh: bump the version in
`scripts/patch_quinn.sh` / `patched/quinn/Cargo.toml`, retarget the patch, `--check`.

**A stalled client does not approach the 10 MB `send_window`.** `window-harness --mode stall`
asks 400 frames (25 MB) then stops reading. On chunked + shared the server holds **180 kB**.
On the old `copy` + per-frame path the same client cost **6.8 MB**. Chunked is a memory
property, not only a CPU one. Windows stay at quinn defaults.

---

## 4 · Larger levers, still above this layer

On a real-looking link a third to a half of steps wait on the network. These still
dominate the absolute millisecond figures:

1. **Progressive delivery** — a truncated HTJ2K prefix is a viewable image.
2. **Cache size and eviction** — a 64-frame cap on a 500-frame series costs +65 % offered
   load for +2.8 pp of misses.
3. **Ask window depth** — [`adr-client-window-depth.md`](../adr-client-window-depth.md).
   Neither product client implements it. Open proposals (including when depth 1 is the
   right answer, and the tail that then costs a probe timeout):
   [`why-these-changes.md` §10](why-these-changes.md#10--latency-and-throughput-on-one-tree-where-they-part-and-what-joins-them).

---

## 5 · Confidence (compact)

T2 throughout — n = 3 except where a row says otherwise. One arm is n = 2: BBR in the
congestive 600 ms cell.

| conclusion | strength |
| ---------- | -------- |
| Controller depends on loss regime | Strong for the ordering; magnitude of the 600 ms cell is n = 2 for BBR |
| Which regime the deployment mix is in | Unknown — needs client telemetry |
| Keep shared stream | Strong, and on real hardware at 250 KB (5.76×, 3/3) |
| Per-frame is worse because of retransmit deferral | Strong — absolute penalty reproduced to 1.6 % across rigs |
| GSO cap worth 17 % | Weak — loopback, n = 1, fixture-dependent; real path overlapping |
| Windows never approached on chunked | Moderate — 48 rows, T2 loopback, N ≤ 16 |
| One endpoint per core beats the shared multi-thread runtime | Strong for one session (6/6 per cell, 5 cells, two independent measurements); T2 loopback, 4 vCPU. Moderate at saturation: 16–32 sessions, six of eight cells up, two ties; thousands of sessions with clients off the box unmeasured |
| Segments per `sendmsg`, PGO and the pooled hand-off cut CPU per byte | **Independent of §8, confirmed 2026-09-18 on the multi-thread runtime: +13 to +23 % throughput and −17 to −22 % CPU per ask at saturation, and p50 −32.5 % / −6.9 % at depth 1, all 6/6. The quinn patch alone carries +10 to +21 %; PGO adds +7 to +8 % with no depth-1 cost; the pool's shared-vs-thread-local shape is a tie.** Strong on this VM: −24 to −35 % combined, 6/6 in seven of eight pinned cells, two independent runs; one lab cell (250 KB, depth 1, one session) loses 15 % throughput. Not run on the target |

What would overturn the shipped defaults: a cell where per-frame + FIFO separates in its
favour (none found), or client telemetry showing the loss mix is overwhelmingly radio
(which would reopen the Cubic default, not the stream default).
