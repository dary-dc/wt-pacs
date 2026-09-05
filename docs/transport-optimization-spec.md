# Transport optimisation — implementation spec

**Architecture-independent.** Written to outlive the server it was measured on. Nothing
below names a function, a module, or a stream mode; each item states an **invariant**, the
**evidence tier** behind it, and an **acceptance test** you can run against whatever the
send path looks like when you read this.

**Target profile** (fixed 2026-09-05, and the ranking below follows from it):

| | |
| --- | --- |
| Primary metric | **p95 time-to-displayable** |
| Secondary metric | **server density** — CPU per byte, memory per connection |
| Path | wt-pacs ↔ **browser**, over the public internet |
| Client | **browser only, indefinitely** |
| Scale | possibly **thousands** of simultaneous viewers per server |

Companion: [`quic-transport-optimization.md`](quic-transport-optimization.md) is the
measurement record. It optimised **throughput and CPU/byte on a zero-RTT loopback**, which
is *not* the profile above. Read this document for what to do; read that one for what was
actually observed and how far it can be trusted.

---

## The ranking changes with the metric — read this first

The measurement campaign ranked work by throughput on a CPU-bound loopback. Under the
profile above the ranking is different, and the difference is not a detail:

> **On a WAN, p95 time-to-displayable for a cold frame is set by round trips, not by
> bandwidth or CPU.** A 250 KB frame cannot arrive faster than the congestion window
> lets it, and the window starts at 12 000 bytes.

Cubic's default initial window is **IW10 — 12 000 bytes**. Slow start doubles per RTT, so
a 250 KB frame needs cumulative 12 → 36 → 84 → 180 → 372 KB: **five round trips**. At
60 ms that is **~300 ms**; at 150 ms, **~750 ms** — before a single byte of link capacity
matters. Every CPU-side optimisation in the companion document is invisible against that
term.

So the order below is: **round trips first, then bytes on the wire, then CPU, then
memory.** Items are numbered by priority, not by confidence.

---

## S1 · Initial congestion window — the largest lever, and unmeasured

**Tier: T0 (arithmetic + source read). Nothing measured. Highest expected value.**

### Invariant

The transport must not need five round trips to deliver one frame on a fresh connection.

### What is true today

| controller | initial window | frame-1 RTTs for 250 KB |
| ---------- | -------------- | ----------------------- |
| Cubic (quinn default) | 12 000 B (IW10) | ~5 |
| BBR (quinn) | **240 000 B** (200 × 1200) | ~1–2 |

Both are settable without switching controller: `CubicConfig::initial_window()` and
`BbrConfig::initial_window()`.

### What to do

1. **Measure this before anything else in this document.** It is the only item that can
   plausibly move p95 by hundreds of milliseconds.
2. Treat it as a **sweep, not a switch**: IW10 (12 KB) / IW32 / IW100 / BBR's 240 KB, at
   60 and 150 ms RTT, at 0 / 0.5 / 2 % loss.
3. **Do not simply adopt BBR's 240 KB.** RFC 9002 specifies IW10 for a reason; 200 packets
   unpaced into an unknown path is a burst that can cause the loss it is trying to
   outrun. The sweep must report loss rate and retransmissions per arm, not just p95.

### Acceptance test

`--mode trace`, p95 time-to-displayable, cold connection per repeat (a warm connection has
already left slow start and will show nothing). Arms differ **only** in initial window.
A cell showing a p95 win with elevated loss is not a win — record both.

### Consequence for the companion document

**The "BBR is 4–6 % worse" finding does not transfer to this profile and should not be
cited against BBR here.** It was measured at ~0 RTT, where slow start completes instantly
and the 20× initial-window advantage cannot appear. BBR may well win on this path; it is
untested where it matters.

---

## S2 · Frame size is a transport parameter

**Tier: T0 (arithmetic). Application-level, larger than any knob below.**

### Invariant

The unit the client waits on should be small enough to clear slow start quickly, or
progressive enough that something displays before the whole unit arrives.

### Rationale

S1's five-RTT figure is a function of *frame size*. The same arithmetic at 32 KB is **two**
round trips, not five. HTJ2K is a progressive codestream: a truncated prefix is a viewable
lower-resolution image. If the wire carried resolution-ordered prefixes, first-displayable
could be one RTT regardless of full-frame size.

This is not a transport change and it is out of scope for a transport spec — but it
**dominates every item below it**, so a spec that omitted it would be misleading.
`adr-resolution-fitting-for-large-frames.md` is the existing thread; this is the
performance argument for pulling it.

### Acceptance test

Same rig as S1, sweeping mean frame size at fixed total study bytes. If p95 falls roughly
with log(frame size), the ramp is the mechanism and S1/S2 are the whole game.

---

## S3 · Loss recovery and stream shape

**Tier: T2 for the lossless part, T0 for the loss part — the loss dimension is still
unmeasured after three campaigns.**

### Invariant

A lost packet must not delay a frame the reader is waiting for behind frames it is not.

### State of the question

`docs/measurements/r2/CAMPAIGN_V2_ANALYSIS.md` established that concurrent streams
fair-share bandwidth, that per-frame streams lose 10–25 % without priority, and that
priority recovers it. It did **not** measure loss, which is the only regime where per-frame
delivery can beat a shared stream. `docs/lanes/L1-loss-run.md` is that run and is still
outstanding.

Two mechanisms are available and only one has been tried:

- **Stream priority** — the campaign's proposal; per-stream bookkeeping.
- **`send_fairness(false)`** — one connection-level flag that makes same-priority streams
  FIFO instead of round-robin. Measured here as recovering the per-frame deficit
  (+11.8 % at D=4) at no cost in any cell, but **only at zero RTT and zero loss**, and its
  interaction with the control stream is untested.

### What to do

1. Run L1 as written — it is the blocking measurement, not this document.
2. Include `send_fairness(false)` as an arm; it is cheaper than priority bookkeeping and
   may make it unnecessary.
3. Whichever stream shape wins, the acceptance test is p95 at **0.5 % loss**, not
   throughput.

### Constraint the spec must respect

The client cannot un-ask: server-side cancel is rejected
(`adr-reject-server-cancel.md`) and so is server-side reordering
(`adr-reject-server-ordering.md`). Any design that recovers p95 by discarding stale
commitment must re-open those ADRs explicitly, not quietly.

---

## S4 · Bytes on the wire per syscall — the GSO segment cap

**Tier: T2, measured, and independently corroborated. Highest-value *measured* item.**

### Invariant

A GSO batch must be as large as the kernel permits **by bytes**, and must never exceed it.

### The rule

```
segments_per_sendmsg = min(platform_max_gso_segments, 65527 / current_mtu)
```

65 527 = 65 535 − 8, the Linux UDP GSO payload ceiling. At a 1452-byte MTU that is **45**;
at 1200, **54**. The quinn default is a hard-coded **10**.

### Why it must be derived, not a constant

Exceeding the byte limit returns `EINVAL`, and `quinn-udp` responds by storing
`max_gso_segments = 1` — **permanently disabling offload for that socket**. One oversized
send costs GSO for the life of the connection. Measured: a cap of 48 at a 1452-byte MTU
collapses throughput by 91 %.

### Evidence

| | |
| --- | --- |
| Measured here | 10 → 32 is **+17.2 % throughput, −20.9 % CPU/byte** at 250 KB frames |
| Independent | an ETH Zürich QUIC benchmarking thesis patched the same constant to 40× MTU and measured gains in every scenario, up to 2× |
| Upstream | quinn issue **#2201** (open) derives the same byte bound and asks `quinn-udp` to chunk internally |

### What to do

This is **upstream code, not ours**. Options in order of preference:

1. Push the derived cap upstream — add the measurement to **#2201**, do not file a new
   issue.
2. Until then, if the throughput matters more than the dependency hygiene, carry a patched
   `quinn` behind a documented `[patch.crates-io]`. `lab/scripts/gso_cap_experiment.sh`
   builds the arms without vendoring a fork into the tree.
3. Do **not** ship a raised constant without the MTU-derived bound. A fixed 32 is safe at
   1452 and 1200; it is *not* safe at every MTU, and DPLMTUD changes MTU at runtime.

### Acceptance test

Throughput and CPU/byte, two or more concurrent clients (see S7). Assert the server log
never contains `halting segmentation offload` — that string is the failure mode.

---

## S5 · Do not copy the frame on the way out

**Tier: T2, measured, and the change is already made on this branch.**

### Invariant

Frame bytes travel from the page cache to the QUIC send buffer **without a bulk copy**.
QUIC must retain bytes for retransmission, so exactly one ownership transfer is
unavoidable and zero is not achievable — "zero-copy" here means *no copy we control*.

### The rule, stated without naming an API

- The store hands out a **refcounted view of the mapping**, not a slice that must be
  materialised.
- The framing header is a **separate small buffer**, never prepended into a new allocation
  containing the payload.
- The write call **takes ownership of buffers** rather than borrowing a `&[u8]` the
  transport must copy.

In `quinn`/`wtransport` terms as of 0.11/0.7: `Bytes::from_owner(mmap)` + `slice()` for the
view, `write_all_chunks(&mut [header, body])` for the write, reached via
`quic_stream_mut()` — because the `&[u8]` write lands in `ByteSlice::pop_chunk`, which
allocates and memcpys, while the `Bytes` path is a `mem::take`.

### Evidence and its limits

| cell | vs one-copy baseline |
| ---- | -------------------- |
| link-limited (378 / 756 Mbps) | 0 % throughput, **−6…−9 % CPU/byte** |
| CPU-bound, 2 clients | **+5.3 %** throughput, **−6.7 % CPU/byte** |
| CPU-bound, 1 client | +17.9 % throughput (client-limited rig — see S7) |

**Under the target profile this is a density item, not a latency item.** A browser on a
WAN gets its frames no sooner; the server spends 6–14 % less CPU delivering them. Rank it
accordingly.

### Migration note for the new architecture

If the send path is expressed as a trait or interface, **the `&[u8]` signature is the
thing that blocks this**. A pipeline shaped
`locate(..) -> &[u8]` → `send(.., &[u8])` cannot reach the owned-buffer write without
changing both signatures to carry an owned refcounted buffer. Decide that at interface
design time; retrofitting it later is a wider change than it looks.

### Acceptance test

Byte-for-byte wire identity against the previous path, pinned by a unit test over an
empty frame, a 1-byte frame, a typical frame, and `u32::MAX` as the index. Then CPU/byte
at a link-limited rate, where throughput is equal by construction and only CPU can move.

---

## S6 · Memory per connection — the item that scales with viewers

**Tier: T0 (arithmetic + upstream documentation). Unmeasured, and mandatory at this scale.**

### Invariant

Per-connection buffer commitments must be sized so that the worst case across all
simultaneous viewers fits in RAM.

### The arithmetic

quinn's defaults are documented as tuned for *"a 100 Mbps link with a 100 ms round trip"*
— one connection, not thousands:

| parameter | default | × 1 000 viewers | × 5 000 |
| --------- | ------- | --------------- | ------- |
| `send_window` | 10 MB | 10 GB | 50 GB |
| `stream_receive_window` | 1.25 MB | 1.25 GB | 6.25 GB |
| `receive_window` | unlimited | unbounded | unbounded |

These are ceilings, not allocations — a connection only buffers what is in flight — but
they are the ceilings that decide whether a bad hour is slow or fatal. quinn's own
documentation says endpoints handling large numbers of connections should set these low
enough that memory exhaustion cannot occur if every connection uses its full window.

**The companion document records these knobs as "nil".** That was measured on *throughput*
at zero RTT with one or two connections, and it is true for that. **It says nothing about
memory at a thousand connections**, which is the constraint that actually applies here.

### What to do

1. Set `receive_window` to a finite value. Unlimited is not a policy.
2. Size `send_window` from `target_bandwidth_per_viewer × target_RTT`, not from the
   default. For 10 Mbps × 150 ms that is ~190 KB, two orders below the default.
3. Re-check `stream_receive_window` against the real BDP once S1's sweep has told you what
   the real RTT distribution is. On a WAN it may bind where it did not on loopback.
4. Bound `max_concurrent_uni_streams` (default 100) to what the stream shape from S3
   actually needs.

### Acceptance test

RSS per connection at N = 1, 10, 100 idle and active viewers; extrapolate and compare to
the box. And a deliberate adversarial cell: every connection stalled mid-frame, which is
where the windows are actually committed.

---

## S7 · How to measure any of this without fooling yourself

**Tier: T2, learned the hard way in the companion campaign.**

Four methodology rules, each of which produced a wrong answer here before it was adopted:

1. **Interleave arms within each repeat.** Running arm A to completion then arm B lets host
   drift land on one arm. This produced a different answer for the same change; the VM was
   replaced mid-campaign and nobody noticed until the numbers disagreed.
2. **Instrument the load generator's CPU, not just the server's.** One harness process
   saturates ~0.93 of a core and caps a session at ~1.4 Gbps while the server sits at 1.3
   of 4 cores. Two clients reach 1.92× that. **Any throughput number taken with one client
   is a client ceiling.** Report client cores alongside server cores; if it approaches
   1.00, the row measures the client.
3. **Prefer CPU per byte over throughput** whenever the metric is density. It measures
   server work per byte regardless of which side is limiting, and it ranked the arms
   identically on every rig used here — where throughput did not.
4. **A single host cannot measure a server throughput ceiling** with local clients. At two
   clients the box was at ~3.5 of 4 cores with clients and server competing; the aggregate
   is a whole-box number. Use two machines, or quote CPU per byte and say nothing about
   ceilings.

And one gap that invalidates a whole class of result: **the container used for the
companion campaign had no `sch_netem`**, so every congestion-control, window, ACK-frequency
and MTU result in it was taken at **zero RTT and zero loss** — the regime where those four
matter least. Under the target profile, all four need re-running on a path with RTT and
loss before any of them is believed. The Oracle São Paulo rig
(`docs/cloud-rig-access.md`) has netem.

---

## S8 · Settled — apply without re-measuring

Measured, mechanism understood, low risk. Not worth a campaign each.

| item | state | note |
| ---- | ----- | ---- |
| UDP GSO | on by quinn default | keep. Disabling it costs 1.8–3.7× here. The *cap* is S4 |
| GRO | on by quinn default | receive side; the browser's send path is not ours |
| DPLMTUD (RFC 8899) | on by quinn default | keep. No measurable effect either way on this path |
| AES-GCM over ChaCha20 | rustls default order | keep. ChaCha20 is 3.6× slower on a CPU with AES-NI |
| Cipher provider (`ring` vs `aws-lc-rs`) | `ring`, opt-in feature for the other | AEAD is 1.33× faster but only ~5 % of server CPU, so ≤1.3 % total. Revisit only after S4 and S5, which is when crypto's share rises |

---

## S9 · Open, unmeasured, and worth a look in this order

| # | item | why it might matter here | cost to find out |
| - | ---- | ------------------------ | ---------------- |
| 1 | **Initial congestion window (S1)** | hundreds of ms of p95 on every cold frame | one netem campaign |
| 2 | **Congestion controller on a real path** | the loopback verdict against BBR does not transfer | same campaign as #1 |
| 3 | **Loss dimension for stream shape (S3 / lane L1)** | the whole reason per-frame delivery exists | already specified in L1 |
| 4 | **Per-connection memory at scale (S6)** | decides how many viewers a box holds | an afternoon, no netem needed |
| 5 | **Multi-core scaling / `SO_REUSEPORT`** | one endpoint is one UDP socket; the recv path may bottleneck before the cores do | needs two machines to answer honestly |
| 6 | **Connection setup cost** | thousands of handshakes is real CPU (ECDSA sign) and one RTT of p95 each. Session resumption / 0-RTT reachability from a browser is unverified | a day, plus a browser test |
| 7 | **ACK frequency on a lossy path** | +2.7 % at zero RTT, but delaying ACKs slows loss detection — the sign may flip where it matters | fold into #1's campaign |
| 8 | **Batched page prefault** | the per-frame blocking hop costs 10 % throughput and 14–34 % CPU/byte warm; one hop per ask-batch keeps the safety property and amortises it. Needs a batching client to test | small, blocked on the harness |
| 9 | **Raising quinn's `MAX_TRANSMIT_SEGMENTS` cap upstream** | S4, but done properly rather than patched locally | a PR and a conversation |

**Items 1–3 are the ones that move the primary metric.** Everything else moves density.

---

## What this spec deliberately does not cover

- **Anything requiring a native client.** Browser-only is fixed indefinitely, so
  receive-side offload, custom congestion control at the client, and reliable-datagram
  designs are out of scope by construction.
- **Kernel bypass (DPDK / AF_XDP / io_uring).** The published gains are real but they
  arrive after syscall and copy overhead are gone, and they are incompatible with running
  behind an ordinary browser-facing TLS endpoint at this scale. `io_uring` remains deferred
  in `docs/disk-access/adr.md` for the storage side.
- **Changing the ask protocol.** Cancel and server-side reordering are both rejected by
  standing ADRs; a design that needs either must re-open them.
