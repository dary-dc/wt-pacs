# Transport optimisation — conclusions

What this lane decided. On this branch the product source carries `--stream-mode` default
`shared`, Cubic default and windows at quinn defaults; the chunked send path, the GSO patch and
`--prefault` are the transport branch's server, not merged here — [`README.md`](README.md) says
which rows below are its (corrected 2026-09-19).

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
| **Congestion controller** | **Two opposite answers, depending on which kind of loss the link has.** Congestive → **Cubic**. Radio/exogenous → **BBR**. Both directions large and separated. **Default to Cubic** until the mix is measured. *Priced in Chromium 2026-09-24:* under 1–3 % random loss BBR fills 12–19× faster, and pays with ~45 % of its datagrams overflowing a 120 ms queue or 294 ms of standing queue in a 900 ms one; **neither as they stand**, Cubic stays (§1, CC1) |
| **Stream shape** | **One shared stream — the binary defaults to it.** In simulation, per-frame is 3.5× worse at 64 KB and 8.5× worse at 250 KB. On a real path the 64 KB cell is noise-dominated; the 250 KB cell separates: per-frame is **5.76× worse**, 3/3, and the absolute penalty matches the simulator to 1.6 %. No cell on either rig separates in per-frame's favour |
| **Fixed-N pool** | Untested. R6 makes it less promising: retransmit-deferral cost grows with N, and the winning endpoint is N = 1 |
| **Initial congestion window** | **Leave at quinn's default — but the ≤ 7 % that used to be the whole reason is corrected 2026-09-19.** That cell averaged many asks on one session, where every arm converges after a frame or two; it never measured the first ask, which is the only place the initial window can matter. On the first ask of an idle session 32 packets is **−28 to −33 %** (§3, the first ask). The default stays because the win is one frame per session and the cost lands on the shallow-buffered link the target has: at 80 ms on 10 Mbit behind a 20-packet queue it takes per-session loss from 2.1 % to 6.5 %. **Swept by queue depth 2026-09-20:** that loss does not reverse the win — from 20 packets up it is a flat −16…−33 %, and the lever fails in exactly one cell, a 10-packet queue at 250 KB / 80 ms (+11.8 %, and it ends on half the default arm's window). It also buys nothing on top of the session-open push, which is the larger lever |
| **GSO segment cap 10 → MTU-derived** | **Costs a depth-1 tail, measured 2026-09-18: at 250 KB with four sessions at depth 1 it takes p99 from 2.2 ms to 27.9 ms and throughput −29 % against `main`, the patch alone reproducing it — a probe timeout on a lost frame tail. Every other cell of the 24 in the depth × sessions plane is neutral or better. Unresolved until §10 proposal 3 lands or the client window makes depth ≥ 2 normal.** **Applied 2026-09-10** (build-time patch on crates.io quinn 0.11.11): −16 to −21 % CPU per ask, 6/6 in six of seven pinned cells, +19 to +29 % throughput where the pipe is full. 45 segments at 1452-byte MTU (`65527 / mtu`); an earlier write-up said 44 at 1452. The earlier real-hardware cell was path-bound, so it could not show a CPU lever. [`why-these-changes.md` §9](why-these-changes.md#9--cpu-per-byte-segments-per-sendmsg-a-profile-guided-build-one-copy-fewer) |
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

### Priced in a browser, on a lossy link, 2026-09-24 (CC1)

L3 (row 6) found BBR 5–9× faster than Cubic at 1–3 % loss on the native client and left it "to be
priced in a browser, not taken". [`../../lab/scripts/controller_browser_cells.sh`](../../lab/scripts/controller_browser_cells.sh):
headless Chromium, the downloader against the real server through `link_impair.py` at **20 Mbit and
80 ms**, a 200-packet queue (120 ms) unless stated, one server per run started with the arm's
`--congestion`, arms rotated inside every round, the relay seeded by the round, **7 rounds**. A fill
is 20 × 428 KB from the moment it is asked; an ask is one 428 KB frame on a fresh session. Lost and
overflowed are shares of the server's datagrams, from its own `session path` line and the relay's
queue counter; the queue is the smoothed round trip at the session's end less 80 ms. Median [range],
and rounds won against Cubic:

| cell | fill: Cubic | Cubic + restart | BBR | ask: Cubic | BBR |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 % loss | 45.1 s [39.6–48.3] | 42.7 s, 3/7 | **3.8 s** [3.7–3.8], 7/7 | 807 ms | **338**, 7/7 |
| 3 % loss | 75.5 s [71.1–82.5] | 78.0 s, 2/7 | **3.9 s** [3.8–4.1], 7/7 | 2 360 | **380**, 7/7 |
| radio: ordered ±10 ms, Gilbert–Elliott | 6.4 s [4.0–15.0] | 5.2 s, 2/7 | **3.9 s** [3.8–4.0], 6/7 | 624 | **484**, 7/7 |
| a 500 ms blink, no loss | **4.54 s** [4.52–4.56] | 4.85 s, 0/7 | 4.89 s, 0/7 | 553 | **315**, 7/7 |
| 1 % loss, 1 500-packet queue | 43.4 s [38.5–49.2] | — | **3.8 s** [3.7–3.8], 7/7 | 795 | **344**, 6/7 |

| what BBR costs | Cubic | BBR |
| --- | ---: | ---: |
| datagrams lost, 1 % / 3 % / radio | 1.1 / 3.0 / 0.7 % | **46.4 / 47.1 / 40.6 %** |
| of which the queue overflowed | 0 | **45.3 / 44.0 / 40.1 %** |
| standing queue, 200 packets | 4–11 ms | **43–77 ms** |
| standing queue, 1 500 packets (no overflow) | 5 ms | **294 ms** |

*Re-taken 2026-09-24 on an idle box.* The first run of every cell shared the four cores with four
runaway server processes from another lane (`decode/README.md` §The decode tail says how it was
found); the tables are the re-take. The first run agreed in every verdict and within a few points in
every figure — its overflow read 45.7 / 48.4 / 48.2 %, its deep standing queue 287 ms, its blink cell
BBR 4 % slower rather than 7.8 %.

**The browser confirms L3 and widens it**: under random loss BBR fills **12× (1 %) to 19× (3 %)
faster** and answers a fresh ask **1.3 to 6.2× sooner**, 6/7 or 7/7 in every lossy cell. A fresh ask
is ~1.8× faster on a clean link too (the blink cell's ask, which the blink at 3 s never reached).
**Its price is the queue, both ways.** Against a 120 ms buffer it sends about twice the fill's bytes
and the bottleneck drops the other half; against a 900 ms buffer it stops overflowing and **stands
294 ms of queue** in front of everything else the phone does. On a link whose only trouble is one
blink, it is 7.8 % slower than Cubic (0/7). The restart W3 built ties Cubic in every lossy cell and
loses in the blink cell here (0/7) — this blink lands late in a 3.6 s fill, where W3 found it
neutral to negative.

**Why BBR overdrives the queue — one reading refuted.** quinn's pacer sends `1.25 × window / RTT`
and never reads the pacing rate BBR computes, which goes only to its metrics (`connection/pacing.rs`,
`congestion/bbr/mod.rs`, 0.11.18). With BBR's window at twice the path's BDP that paces at ~2.5×
the bottleneck — a plausible cause. **It is not the cause here:** a prototype that paces a
rate-reporting controller at its own rate overflowed as much (57.6 % against 47.8 %, 3 rounds, 1 %;
taken under the same load as the first run, and not re-taken).
The excess is BBR's own estimate or window, which this lane did not trace; §quinn's BBR read against
the published BBRv1 below has the other candidate, loss ignored during Startup.

**The answer: neither, as they stand.** Cubic is an order of magnitude wrong for the target's
random loss. quinn's BBRv1 buys that back by doubling the bytes on a shallow link or standing a
quarter-second of queue on a deep one, and §1's table has it starving a neighbour 150× — a cost
this lab's users do not pay but their networks do. **The default stays Cubic**, as the safer error,
and what would change it is a controller that treats random loss as noise *and* bounds its queue —
BBRv2/v3's loss- and inflight-bounded probing, which quinn does not carry. Nothing was changed.

**Where the host saturates.** The relay's 20 Mbit is far below loopback's reach and every fill here
is link-bound (BBR's 3.8 s is 18 Mbit of goodput); latency and completion are quoted, not
throughput. **What this rig does not decide:** the relay's loss is exogenous by construction, and a
real radio's mix of exogenous and congestive loss — §1's diagnostic — is not modelled; nor is a
phone's receive path.

---

### A bounded BBR, 2026-09-25 (BB2)

CC1 left one question: can BBR keep its loss tolerance without its queue? **quinn exposes neither
knob the row asked for** — `BbrConfig` sets only an initial window, and Cubic's β is a constant — so
the variant is built as `restart.rs` is, over the public `Controller` trait:
[`bounded.rs`](../../server/src/transport/bounded.rs), `--congestion bbr-bounded --bdp-gain g`, quinn's
BBR with its window held to `g` × (the best delivery rate of the last ten round trips × the minimum
round trip). A larger Cubic β needs a Cubic of our own or a quinn patch, and is not built.

**The reading, fixed before the run.** The same rig and cells as CC1 (1 % and 3 % behind 200 packets,
1 % behind 1 500, a 500 ms blink), arms `cubic`, `bbr` and the bound at 1.0, 1.25 and 1.5, 7 rounds
rotated. A variant *keeps BBR's loss tolerance* if its median fill is within 2× BBR's at 1 % and 3 %;
it does so *at Cubic's queue cost* if under 5 % of its datagrams overflow the 200-packet queue and it
stands under 50 ms in the 1 500-packet one (Cubic: 0 % and 5 ms; BBR: 45 % and 294 ms).

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
| Chunked send path | −6…−14 % CPU/byte at every rate. Only path in the transport branch's `server/`; this tree still sends with `write_all` (corrected 2026-09-19) |
| Per-frame prefault hop, warm cache | costs 10 % throughput, 14–34 % CPU/byte |
| `aws-lc-rs`, ACK frequency, socket buffers, initial MTU | ≤ 3 % or nil. `aws-lc-rs` re-measured 2026-09-10 on VAES / AVX-512 hardware: +3–5 % CPU at 32 KB, a tie at 250 KB, +10–18 % peak RSS — [`improvements/2026-09-10.md`](../improvements/2026-09-10.md) |

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

### The first ask on an idle session, 2026-09-19

**W1.** One frame, asked as the first thing a session asks for, through
[`../../lab/scripts/link_impair.py`](../../lab/scripts/link_impair.py) at 40 and 80 ms round
trip. `lab/scripts/first_ask_cells.sh`, five rounds a cell, medians; "trips" is the median over
the link's round trip. The link has no rate limit, so nothing here is the link.

| session state | 50 KB | trips | 250 KB | trips |
| --- | ---: | ---: | ---: | ---: |
| **fresh** — nothing sent yet | 127.5 / 248.2 | 3.1 | 234.5 / 454.7 | 5.8 |
| **filled** — after eight frames | 51.8 / 98.6 | 1.3 | 55.5 / 104.3 | 1.3 |
| **lossy** — a fill through a 300 ms blackout | 103.8 / 190.8 | 2.5 | 220.1 / 430.8 | 5.4 |
| **rebound** — a fill, then the relay changes its source port | ~~49.4 / 93.9~~ 135.6 / 255.6 | 3.3 | ~~52.0 / 101.1~~ 236.7 / 454.7 | 5.8 |

**S7's headline holds and is now a number: the first ask is slow start.** A 250 KB frame costs
**5.8 round trips on a fresh session against 1.3 on a warmed one** — 4.4 of the 5.8 are the
window opening, and 12 KB doubling to 250 KB is exactly six flights. At 50 KB it is 3.1 against
1.3. A warmed session is **4.2× faster** at 250 KB and 2.5× at 50 KB, at both round trips.

**One of S7's clauses did not reproduce.** "After a lossy fill the ask is slower than on a fresh
session": it is not — the lossy arm lands *between* fresh and filled (−6 % against fresh at
250 KB, −23 % at 50 KB), because the blackout collapses the window without taking it below where
it started.

**The rebound row is corrected 2026-09-20 (LD): a source-port change does reset the controller.**
This table read it as indistinguishable from filled; re-run on the same script it reads as
**fresh** — 236.7 / 454.7 ms at 250 KB against the fresh arm's 250.8 / 465.5 and the filled arm's
52.9 / 109.3, five rounds, and again at n = 3 with the relay's own `REBOUND <old> -> <new>` lines
in view, so the poke is known to have landed. That is RFC 9000 §9.4, a new path resetting the
congestion controller and the RTT estimator. What produced the earlier reading is not known — same
script, same relay, and the relay's rebind has not changed since it was written. **It is the
target's case**: a mobile NAT rebind puts a warmed session back at the initial window, so a
session is warm only until its 4-tuple moves, and every lever below is worth its cost again after
each rebind. A genuinely different client address is untested here; this container has one
loopback address.

#### Lever 1 — the bytes the viewer needs anyway, pushed at session open

The prototype is `--open-ask` ([`../proposal-session-open.md`](../proposal-session-open.md)):
the session URL carries `?ask=fill:0-k`, so the study's first frames are already moving when the
control stream opens. Swept by how much it pushes, then one more frame asked:

| pushed | 50 KB ask | 250 KB ask |
| --- | ---: | ---: |
| nothing (fresh) | 127.5 / 248.2 | 234.5 / 454.7 |
| 1 frame | 85.1 / 165.9 | 107.1 / 204.0 |
| 2 frames | 66.0 / 124.8 | 86.8 / 157.2 |
| 4 frames | 57.8 / 108.5 | 63.1 / 127.6 |
| 8 frames | 53.1 / 98.1 | 52.8 / 103.9 |

**It reaches the warmed session's speed, and most of the way there at 1 MB.** At 250 KB and
80 ms the ask falls 454.7 → 127.6 ms once 1 MB has been pushed, and 103.9 at 2 MB, which is the
filled arm's 104.3. S7 predicted ~260 ms for this lever; it is better than that.

#### Lever 2 — a 32-packet initial window

`--initial-window-bytes 38400` against quinn's 12 000. On the unshaped link it is free:

| | 50 KB | 250 KB |
| --- | ---: | ---: |
| fresh, default | 127.5 / 248.2 | 234.5 / 454.7 |
| fresh, 32 packets | 85.8 / 165.5 | 167.7 / 319.5 |
| | **−33 %** | **−28 to −30 %** |

Zero loss and zero congestion events in every arm above, and no effect once the session is warm
(filled reads 51.6 / 98.6 with it, against 51.8 / 98.6 without). **But an uncongested link cannot
punish a burst.** On 10 Mbit with a 20-packet queue — shallower than the window itself:

| arm | 40 ms | lost / session | 80 ms | lost / session |
| --- | ---: | ---: | ---: | ---: |
| fresh, default | 324.2 | 37.0 of 230 | 578.2 | 4.2 of 196 |
| fresh, 32 packets | 266.6 | 45.5 of 241 | 432.5 | 13.5 of 208 |
| open-push 1 MB | 248.7 | 72.8 of 970 | 305.7 | 118.5 of 1017 |

Both levers still win the asked frame there — −18 to −25 % for the window, −23 to −47 % for the
push — and both pay for it in loss: the 80 ms cell goes from 2.1 % of datagrams lost to 6.5 %
with the wider window and 11.7 % with the push. The loss column counts the whole session, so the
push arm's is mostly its own.

**Neither is changed in the product.** The window's win is one frame per session and its cost
lands on exactly the shallow-buffered link the target has; the push is the larger lever and is
already prototyped behind a flag, where it waits on a browser cell rather than another native one.

#### Which default for which session shape, 2026-09-20 (LD)

**W1b.** The cells W1 does not have, on the same probe and the same relay: the two levers
*together*, a warmed session left idle before the ask, and the wide first flight against the queue
depth. Seven rounds a cell, **arms interleaved inside every round with the order reversed on every
other round**, medians with their range, and wins counted round against round.
`lab/scripts/first_ask_cells.sh together|idle|queue`. The box carried other lanes throughout, so
every figure here reads 3–8 % slower than W1's and only the within-cell comparisons are claimed.

**The two levers do not stack.** Ask-to-last-byte medians, 40 ms / 80 ms, against the `fresh` arm:

| arm | 50 KB | 250 KB | wins vs fresh |
| --- | ---: | ---: | ---: |
| fresh | 133.8 / 255.9 | 244.0 / 463.3 | |
| 32-packet window | 89.7 / 171.8 | 182.3 / 333.4 | 7/7 |
| push 4 frames | 57.5 / 109.9 | 69.2 / 137.9 | 7/7 |
| **push + 32-packet window** | 58.5 / 110.7 | 65.8 / 132.5 | 7/7 |
| warmed (the ceiling) | 55.0 / 102.2 | 53.9 / 109.4 | 7/7 |

Every lever arm beats `fresh` 7/7 on disjoint ranges, with zero loss and zero congestion events in
all of them — this link is unshaped, so nothing here is the link. **But the combined arm is not
the two wins added.** Against the push alone it is +1.7 % and +0.7 % at 50 KB (worse) and −4.9 %
and −3.9 % at 250 KB (better), on ranges that overlap in all four cells. The push already leaves
the ask within 5–28 % of a warmed session; there is no slow start left for a wider first flight to
skip. **If the push is taken, the window buys nothing on top of it.**

**A warmed window survives a silence, on both controllers.** The on-demand regime is a fill, then
a pause while the user reads, then one ask. Eight frames, then 0, 10 or 30 s of silence, then the
ask, carrying the pair [`adr-idle-sessions.md`](adr-idle-sessions.md) proposes — a 20 s
keep-alive under a 60 s idle timeout — in **every** arm, because without it the 30 s arm measures a
dead session rather than a cold window. That is measured, not assumed: the same cell run with
`HOLD=` (library defaults — a 30 s idle timeout at both ends, no keep-alive) loses the session in
**2 of 2 rounds on both controllers at 30 s**, while every 0 s and 10 s arm survives and reads the
same ask as below. A real Chromium would not die there — it pings itself every 15 s
([`adr-idle-sessions.md`](adr-idle-sessions.md) §What a real Chromium does) — so the pair is
what makes the native probe model the browser, not a thumb on the scale:

| arm | 50 KB, 40 ms | 50 KB, 80 ms | 250 KB, 40 ms | 250 KB, 80 ms |
| --- | ---: | ---: | ---: | ---: |
| Cubic, no idle | 54.1 | 103.3 | 53.8 | 108.0 |
| Cubic, 10 s | 56.7 | 103.3 | 58.4 | 109.0 |
| Cubic, 30 s | 55.6 | 99.4 | 58.7 | 111.1 |
| BBR, no idle | 54.8 | 97.2 | 52.5 | 105.1 |
| BBR, 10 s | 56.1 | 98.4 | 61.0 | 108.1 |
| BBR, 30 s | 52.8 | 94.8 | 61.4 | 107.3 |

**No arm anywhere goes back to slow start**, which at 250 KB would be 4.4 round trips and a 4.2×
ask. The worst cell is 250 KB at 40 ms — Cubic +9 %, BBR +17 % and 0/7 against its own no-idle
arm, the one range in the block that nearly separates — and at 50 KB the 30 s arm is the *fastest*
of the three on both controllers. Every arm ends on the window it had before the silence
(~1.12–1.16 MB at 250 KB), and **no arm lost a session: 56 of 56 rounds with 30 s of silence served the ask**, 168 of 168
across the block, so the 20 s keep-alive is enough to carry 30 s of quiet. The mechanism agrees: quinn 0.11.18 implements
no congestion-window restart after idle in any of its controllers, and the pacer only clamps the
first flight after the silence to its own burst capacity.

**The wide first flight is bounded by the queue, and by one cell only.** A 32-packet initial window
is 38 400 bytes, about 26 datagrams, so a 10-packet queue cannot hold it. Against the default
window on a 10 Mbit link, by the relay's queue depth (`default → iw 32 pkt`, medians, 7 rounds,
every cell 7/7 for the wider window except the one marked):

| queue | 50 KB, 40 ms | 50 KB, 80 ms | 250 KB, 40 ms | 250 KB, 80 ms |
| --- | ---: | ---: | ---: | ---: |
| 10 pkt (12 ms of buffer) | 149.5 → 113.0 | 268.9 → 205.2 | 354.5 → 346.0 | 557.3 → **623.3, 0/7** |
| 20 pkt | 150.5 → 102.8 | 270.0 → 182.9 | 334.2 → 275.0 | 600.1 → 456.4 |
| 40 pkt | 149.0 → 102.6 | 271.7 → 183.0 | 359.3 → 291.1 | 498.7 → 373.4 |
| 100 pkt | 149.5 → 102.7 | 269.9 → 182.9 | 325.3 → 272.1 | 499.5 → 373.5 |

From 20 packets up the win is flat — −31…−33 % at 50 KB and −16…−25 % at 250 KB, unchanged from
20 to 100 — and W1's own 20-packet row reads the same (324.2 → 266.6 and 578.2 → 432.5 there).
**Depth is not a dial the lever is sensitive to; it is a cliff, and the cliff is below 20
packets.** At 10 packets the 50 KB cells still win by ~24 %, the 250 KB / 40 ms cell is a tie at
−2.4 % on overlapping ranges, and the 250 KB / 80 ms cell **loses by 11.8 %**. That cell is the
lever's failure mode and it is visible in the window: the wider arm ends the session on 44 kB
against the default arm's 87 kB, having lost *fewer* datagrams (3.0 against 10.4). The burst is
chopped at the queue, the controller reads the drop and never gets the window back inside one
session — it pays a round trip to lose half its window, which is the opposite of what it was
bought for.

#### What the numbers support, by session shape

**A session that opens with a fill is warmed by the fill**, and needs neither lever: by frame two
it is at the warmed figure, and the fill's own first frames are what the push would have pushed.
**An ask-only session is not warmed** and pays 4.4 round trips, 4.2× at 250 KB, once per session —
and again after every NAT rebind (the corrected rebound row above). For it, in order:

| lever | what it buys on the first ask | what it costs |
| --- | --- | --- |
| push at session open | fresh → within 5–28 % of warmed (−70 % at 250 KB / 80 ms) | a page-side change (named below); pushes bytes before any ACK, so on a shallow queue it is the arm that loses the most datagrams (W1: 11.7 % at 20 packets) |
| 32-packet initial window | −28…−33 % unshaped, −16…−33 % at 20+ packets of queue | +11.8 % and half the window in the one cell where 250 KB meets 80 ms and a 10-packet queue; nothing at all on top of the push |
| keep-alive 20 s / idle 60 s | nothing on a first ask | holds a warmed session through 30 s of silence at full window (28 of 28 rounds); two datagrams per 20 s per idle session, the ping and its ACK |

**The page-side change the push needs, named and not made** (read from the client, not measured):
today a page would drop every pushed frame. `client/transport-ts/session.ts:86` builds the
`WebTransport` URL, which has to carry `?ask=fill:0-k`; `session.ts:336` arms `this.fill` only
inside `fillFrames`, which sends the ask in the same breath at `:337`, so a pushed fill needs that
record armed *without* an ask before `pumpUni` starts at `:97` — otherwise `deliver` finds no
waiter and counts the frame as `droppedEarly` at `:155`. In the default client the two lines are
`client/downloader/downloader.js:190` (the dial) and `:144` (the ask).

**The two levers are alternatives, not a pair** — together they are the push alone, ±5 %. The
window is the one to take if the page cannot be changed; the push is the one to take if it can.
One asymmetry is not measured here: a path reset restarts the controller at the *initial* window,
so the window lever is re-applied after every NAT rebind while the push is spent at session open.
The rebound arm is the cell that would measure it; it was run without either lever.
**Every product default is unchanged here**: each arm above is a flag on the lab's own binary, and
which of these becomes a default is the owner's call.

### The slow-start exit, an outage and the first timeout, 2026-09-19

**W2.** `lab/scripts/controller_cells.sh`, three rounds a cell, through
[`../../lab/scripts/link_impair.py`](../../lab/scripts/link_impair.py) at 80 ms round trip and
20 Mbit; the fill is 40 frames of 64 KB. `lost` and `cong` are per session and count the whole of
it.

**The early slow-start exit is a tie, in every cell.** `server/src/transport/hystart.rs` is
RFC 9406's detector over the public `Controller` trait — no fork, no patch: it watches the
per-round minimum RTT and, when it rises, caps the window where slow start left it and opens one
datagram per round trip after that.

| buffer | jitter | Cubic | Cubic + exit | BBR |
| --- | --- | ---: | ---: | ---: |
| 20 packets | none | 1 679 | 1 693 | 1 316 |
| 1 500 packets | none | 1 437 | 1 437 | 1 231 |
| 20 packets | ±2 ms | 13 418 | 11 479 | 1 461 |
| 1 500 packets | ±2 ms | 12 440 | 12 610 | 1 287 |
| 20 packets | ±10 ms | 36 438 | 33 706 | 3 596 |
| 1 500 packets | ±10 ms | 35 410 | 33 923 | 3 597 |

Fill milliseconds. The exit is within 5 % of Cubic everywhere, in both directions — **it does not
pay for itself and it is not the default.** It stays as `--congestion cubic-hystart` because the
cell it was built for is owed on the rig, where `netem` shapes instead of a userspace relay.

**What these cells did find is reordering, and it is not small.** Cubic takes **8.6×** longer at
±2 ms of jitter and **25×** at ±10 ms, where BBR takes 1.05× and 2.9×. The jitter here is
independent per packet, which at 20 Mbit spaces packets 0.58 ms apart and reorders across seven
of them. BBR's cost is unchanged and large — on the 20-packet queue it sends 3 834 datagrams to
Cubic's 2 158 and loses 1 887 of them.

**Corrected 2026-09-19 (N2): the whole of it is the reordering, and it is the relay's model, not
a radio's.** `lab/scripts/link_impair.py` gained `--jitter-mode ordered`, which clamps each
direction's delivery to non-decreasing — the same wobble, on one leg, which is what LTE, 5G and
Wi-Fi deliver ([`../rig-limits.md`](../rig-limits.md) §3). `lab/scripts/radio_link_cells.sh`,
five rounds, arms interleaved inside each round, the deep queue, against each controller's own
no-jitter fill:

| arm | ±2 ms reordering | ±2 ms ordered | ±10 ms reordering | ±10 ms ordered |
| --- | ---: | ---: | ---: | ---: |
| Cubic | **8.22×** | **1.01×** | **23.68×** | **1.03×** |
| BBR | 1.02× | 0.99× | 2.65× | 1.17× |

Ordered beats reordering 5/5 in the three cells where reordering costs anything, and 4/5 in
BBR's ±2 ms cell, where it costs 2 %. **On a link that delivers in sequence there is no effect
left to measure** — Cubic's fill is within 3 % of its own no-jitter figure at ±10 ms, and most
of BBR's 2.9× was the reordering too. The reordering cells stand, as what a path with more than
one leg would do; nothing in them supports "Cubic cannot take a radio's jitter", and §1's regime
argument for BBR, which rests on loss and not on this, is untouched. The table above was
reproduced on the same script the same day before any of this was built: 7.6× and 24.2×.

**S26's mechanism is refuted.** It read every one of those losses as quinn's
`packet_threshold = 3`; `--packet-threshold` now exposes the setter (default unchanged) and the
threshold is not what is costing the fill:

| under reordering jitter | threshold 3 | 6 | 12 | 48 |
| --- | ---: | ---: | ---: | ---: |
| ±2 ms | 11 880 | 6 124 | 6 135 | 6 124 |
| ±10 ms | 34 217 | 30 214 | 31 094 | 31 428 |

Fill milliseconds, medians of five. At ±2 ms raising it removes the spurious losses — 21 per
session become 0 or 1 — and still leaves **4.2×**, because *one* congestion event is worth that
much: every round that declared one ended on an 84 ms smoothed RTT and a 6.1 s fill, every round
that declared none on ~140 ms and a 1.44 s fill, with no case in between. That is S30's regrowth,
priced from a different direction. At ±10 ms the threshold buys 8–12 %, and it cannot be the
mechanism there at all: the model's largest possible overtake is 20 ms of wobble over 0.58 ms of
spacing, ~34 packet numbers, under a threshold of 48 — yet ~140 packets a session are still
declared lost, and the relay's own tally on that link says it dropped and overflowed nothing.
What declares them is unattributed here; quinn's other detector is the 9/8 × RTT time threshold,
which S26 argued could never fire at an 80 ms round trip. A qlog cell owes the answer.

**The deep buffer holds 39 ms of standing queue at the session's end — corrected 2026-09-19
(W3): during the fill it holds ten times that.** The 39 ms was read off the end-of-session path
line, after the queue had drained. Sampled every 50 ms through the fill instead, one clean trace
has the smoothed RTT climbing to **468 ms against the link's 80** before the last frame lands:
388 ms of standing queue, a megabyte of it, in a 1 500-packet buffer. The session still ends with
zero loss and zero congestion events, which is why the end-of-session figure reads as it does.
One trace, not an interleaved cell.

#### An outage: the threshold is not the lever

| blackout | threshold 3 (default) | 6 | 12 | fill with no outage |
| --- | ---: | ---: | ---: | ---: |
| 500 ms | 6 836 | 6 881 | 6 871 | 1 437 |
| 1 000 ms | 7 503 | 7 508 | 7 626 | |
| 2 000 ms | 8 704 | 9 058 | 9 092 | |

**Raising the persistent-congestion threshold changes nothing** — every arm is within noise, and
where it moves it moves the wrong way. The reason is in the counters: one congestion event and
3 to 11 lost datagrams per session, so persistent congestion is never declared and a threshold
on it has nothing to act on. The outage costs **+5.4 s** of fill at 500 ms, +6.1 s at 1 s and
+7.3 s at 2 s, and the outage itself is a fraction of that. S9's "~0.9 s per outage" understates
it.

**"The cost is the probe-timeout ladder" is wrong — corrected 2026-09-19 (W3), below.** The cost
is the window's regrowth from a window the outage halved; the ladder is only the *difference*
between the three rows. The table itself reproduces: re-run today, unchanged, it gives
6 995 / 7 796 / 9 197 against a 1 448 ms fill.

### After a blink, 2026-09-19

**W3.** [`../../lab/scripts/blink_cells.sh`](../../lab/scripts/blink_cells.sh), five rounds a
cell, **arms interleaved within every round**, on W2's link: 80 ms round trip, 20 Mbit, a
1 500-packet queue, a fill of 40 × 64 KB. Times are medians; `wins` counts rounds beaten against
Cubic, round against round.

**The window says what the clock only suggested.** Sampled every 50 ms through the server's path
telemetry, a 1 s blink fired as the fill is requested: the session holds the 12 000 B initial
window for the length of the outage, takes one congestion event, drops to **8 400 B —
0.7 × 12 000 — and opens by one MTU every second round trip**, a measured 0.51 packets per round
trip over the 3.4 s it spends climbing from 36 to 66 kB. It never re-enters slow start, and the
fill takes 7 659 ms where a clean one takes 1 440. **S30 is confirmed off the window itself:** the cost is regrowth from a window that was tiny when the blink hit, so it is
the *position* of the blink that prices it, not its length.

| the blink | Cubic | wins | Cubic + restart | wins | BBR |
| --- | ---: | ---: | ---: | ---: | ---: |
| none | 1 440 | | 1 437 | 2/5 | **1 222** |
| 500 ms, at the fill's start | 6 915 | | **2 116** | 5/5 | **1 897** |
| 1 s, at the fill's start | 7 659 | | **2 891** | 5/5 | **2 802** |
| 2 s, at the fill's start | 9 326 | | **4 409** | 5/5 | **4 352** |
| 1 s, at frame 20 of 40 | 2 444 | | 2 175 | 2/5 | 2 880 |
| 1 s, at frame 36 of 40 | 1 445 | | 1 441 | 3/5 | 1 230 |

Fill milliseconds. **A blink is expensive only in a fill's first round trips**: at the start it
costs Cubic +5.5 to +7.9 s, at frame 20 it costs +1.0 s, and by frame 36 it costs nothing
measurable — though that last row measures little, because at this buffer depth the fill's
remaining bytes are already sitting in the relay's queue, which a blackout does not drop.

**S32 works and is worth about five seconds.** `server/src/transport/restart.rs` is
`--congestion cubic-restart`: a wrapper over the public `Controller` trait, like `hystart.rs`,
that watches the acknowledgement stream and, when a congestion event's lost packets all predate a
silence of four round trips, replaces the inner Cubic with a fresh one — quinn's only way back
into slow start. It takes **4.8 to 4.9 s off every start-of-fill row, 5/5**, and what is left is
the outage plus a second. It is **not** the default.

**The detector's first form was refuted by the 500 ms cell**, which is why it reads as it does: a
rule that compared only the two most recent acknowledgements missed the outage entirely, because
quinn declares the loss an acknowledgement or two *after* the one that ended the silence. The
silence is now remembered until a congestion event spends it, and the gap is measured against the
RTT estimate that held *before* it — the sample that closes an outage is the outage.

**S31 half holds.** BBR through a start-of-fill blink is as predicted (1 897 ms against a
predicted ~1.8 s at 500 ms) and beats Cubic 5/5 on all three rows. Mid-fill it is **worse**
than Cubic, 0/5. **And BBR's known price does not appear on this link**: across every blink cell
the three arms send within 1 % of each other — 1 914 to 1 930 datagrams for a 1 920-datagram fill
— and lose the same 3 / 5 / 7. Mid-fill all three lose 104 to 116, which is the deep queue
overflowing, not an arm.

| one ask, on a warmed session | Cubic | Cubic + restart | wins | BBR | wins |
| --- | ---: | ---: | ---: | ---: | ---: |
| 250 KB, clean | 195 | 192 | 3/5 | 197 | 1/5 |
| 250 KB, blinked 1 s | 2 099 | 2 312 | 1/5 | **1 859** | 5/5 |
| 64 KB, blinked 1 s | 2 586 | 2 563 | 3/5 | **2 282** | 5/5 |

Ask to last byte, milliseconds; the blink fires as the ask goes out. **A blink across an ask
costs ~2 s of a 195 ms ask and the restart does not help** — on a warmed session the server's
window is already large, so there is no regrowth to save, and what is left is the client's own
request being retransmitted through the outage. The restart is a shade *worse* here (1/5), which
is the shape of its cost: it throws away a large window to rebuild it.

#### The misfire check: it is not neutral at 1 % loss

| link, no blackout | Cubic | Cubic + restart | wins | BBR |
| --- | ---: | ---: | ---: | ---: |
| clean | 1 440 | 1 437 | 2/5 | 1 222 |
| 1 % loss | 10 774 (3 564–13 814) | 4 387 (2 230–12 608) | 3/5 | **1 354** |
| 3 % loss | 24 306 | 24 519 | 3/5 | **1 517** |

Fill milliseconds. At 3 % the two Cubics tie, within 1 %. **At 1 % they do not** — the restart's
median is 2.5× faster, on the same datagrams sent and lost (1 932 / 23.0 against 1 934 / 24.7),
so the detector is firing where there is no outage: at this loss rate a whole flight goes missing
often enough to look like one. The direction is favourable and the spread is four-fold on both
arms, so five rounds size nothing here beyond "not neutral". **Before this is a default it needs
the cell that decides it**, at 0.1–1 % loss with enough rounds to separate.

**Neither is changed in the product.** Cubic stays the default, and `--congestion cubic-restart`
is one flag away. What the three tables say together is that a blink is a *slow-start* problem:
fix it in slow start, at the start of a session or a fill, and the lever is large; look for it
anywhere else and there is nothing to win. BBR wins the same rows for the same reason and loses
the mid-fill one.

**A blackout that holds instead of dropping costs the outage and nothing else, 2026-09-19 (N2).**
S33 asked whether that +5.4 s is the relay's model: `link_impair.py` discarded both directions
through a blackout, where a radio's link layer usually buffers and delivers late.
`--blackout-mode hold` freezes each direction's rate clock for the outage instead, and
`radio_link_cells.sh outage`, five rounds interleaved, separates the two models completely:

| blackout | Cubic, dropping | Cubic, holding | BBR, dropping | BBR, holding |
| --- | ---: | ---: | ---: | ---: |
| 500 ms | 6 984 | **1 943** | 1 970 | 1 822 |
| 1 000 ms | 7 727 | **2 475** | 2 720 | 2 371 |
| 2 000 ms | 8 920 | **3 449** | 4 362 | 3 392 |

Fill milliseconds against the jitter cells' 1 445 ms fill with no outage, on the same link and
the same 2.56 MB; holding wins 5/5 in all six cells.
**Held, there is no congestion event and no lost datagram at all**, and the fill is the
undisturbed fill plus the outage, to within 30 ms in each of the three rows. Every number in the
table above it — the ladder, the regrowth, the threshold that does nothing — belongs to the
dropping model.

**S33's second half is refuted.** It predicted that the outage-sized round-trip sample would take
the next probe timeout to ~2.4 s and wreck the *next* blink. On a 12.8 MB fill with a second
1 s blink (medians of five, interleaved): held, one blink costs 6 773 ms and a second costs
**+1 003 ms** three seconds later and **+1 097 ms** two hundred milliseconds after the first ends
— its own length, wherever it lands, still with zero congestion events. Dropping, the same second
blink costs +1 998 ms at three seconds and +694 ms at two hundred milliseconds, where it overlaps
a recovery already being paid for. **Which model a radio is remains unverified** — no primary
source for the discard timer was found — and it decides whether the outage work has a target at
all.

#### The first timeout, at 1 % loss

200 cold connects an arm, 80 ms round trip, 1 % loss each way.

| `initial_rtt` | p50 | p95 | p99 |
| --- | ---: | ---: | ---: |
| 333 ms (quinn's default) | 252.3 | 417.6 | **1 335.1** |
| 100 ms | 252.3 | **255.6** | **637.8** |
| 50 ms | 252.3 | 334.4 | 502.4 |

**S10 is confirmed and has a lever.** One cold open in a hundred waits 1.3 s where the median
waits 0.25 — the 999 ms first probe timeout, which is three times a 333 ms assumption. Setting
`--initial-rtt-ms 100` halves the p99 and leaves the median untouched. **50 ms is worse, not
better**: its p95 rises to 334 ms because the first probe now fires before an 80 ms path could
have answered, which is the cost a too-low assumption buys. Twenty-four connects showed none of
this; the tail needs a couple of hundred.

**Not changed in the product.** `--initial-rtt-ms` is the one lever here worth a default, and the
number that decides it is the target's round trip, which this rig cannot stand in for: 100 ms is
right at 80 ms and wrong at 300. It waits on the shaped-link VM.

**S11's two BBR leads** — the pacer ignoring BBR's pacing rate, and `exiting_quiescence` never
being set — are source questions, not cells. They go to the controller lane's source review with
§1's BBR-against-BBRv1 reading.

---

## 4 · Larger levers, still above this layer

On a real-looking link a third to a half of steps wait on the network. These still
dominate the absolute millisecond figures:

1. **Progressive delivery** — a truncated HTJ2K prefix is a viewable image. A coarse-to-fine
   fill order is the same idea along the time axis, and it is measured below.
2. **Cache size and eviction** — a 64-frame cap on a 500-frame series costs +65 % offered
   load for +2.8 pp of misses.
3. **Ask window depth** — [`adr-client-window-depth.md`](../adr-client-window-depth.md).
   Neither product client implements it. Open proposals (including when depth 1 is the
   right answer, and the tail that then costs a probe timeout):
   [`why-these-changes.md` §10](why-these-changes.md#10--latency-and-throughput-on-one-tree-where-they-part-and-what-joins-them).

### The fill's order, 2026-09-19

**O1 / S21.** A fill asked coarse to fine — every 8th frame, then every 4th, then every 2nd, then
the rest — against the sequential order, each frame asked exactly once and at the same depth.
`lab/scripts/fill_order_cells.sh`, 200 frames of 64 KB (12 MB), depth 4, arms interleaved with
the order reversed every round.

| cell | order | fill ms | every 8th frame in hand |
| --- | --- | ---: | ---: |
| 80 ms round trip, 20 Mbit (n = 3) | sequential | 6 032 | 5 688 |
| | coarse to fine | 5 826 | **1 043** |
| loopback, every frame a miss (n = 12) | sequential | 190 | 183 |
| | coarse to fine | 189 | **27** |
| loopback, warm store (n = 12) | sequential | 185 | 178 |
| | coarse to fine | 182 | **26** |

**It moves time-to-scrubbable by 5.5× and the fill by nothing**, which is what S21 predicted.
Sequentially, every 8th frame is only in hand at 94 % of the fill — the last multiple of eight is
the 192nd of 200 — so a viewer that can scrub as soon as the coarse pass lands waits 1.0 s
instead of 5.7 s on this link.

**The permuted order costs the read path nothing measurable.** Under `--force-pool-reads`, where
every frame is a miss and the store cannot lean on anything a previous read brought in, the two
orders are within 0.3 % over twelve interleaved rounds, and warm they are within 1.9 %. The
frames are 64 KB and the study is one file; a stride of eight moves the read head half a megabyte,
which is nothing to an NVMe and would be something to a spinning disk or a cold object store.

**No server change.** Ask order is already the client's priority, so this is a client decision
and it is not made here: the downloader fills sequentially today
([`../proposal-downloader.md`](../proposal-downloader.md)), and what the order should be depends
on what the viewer does with a partly-filled study, which is the display library's half.

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
