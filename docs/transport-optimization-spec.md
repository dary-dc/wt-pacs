# Transport optimisation — portable implementation spec

**Written to survive the server rewrite.** Nothing here names a file, a struct, or a
function in the current tree. Each item is stated as **invariant → mechanism → change →
verification**, so it can be applied to whatever the server looks like after the new
architecture lands, and so an item whose invariant no longer holds can be *recognised as
inapplicable* rather than cargo-culted.

Evidence behind each item: [`quic-transport-optimization.md`](quic-transport-optimization.md)
(measurements, T2) and its §7 (external corroboration). Where an item is **unmeasured**, it
says so — those are specified as experiments, not as changes to make.

---

## 0 · The target, and why it re-ranks the evidence

| | |
| --- | --- |
| **Primary metric** | **p95 time-to-displayable** — ask → frame on screen |
| **Secondary metric** | **server CPU per byte** — density, cloud cost |
| **Client** | **browser only, indefinitely** (WebTransport API) |
| **Path** | wt-pacs server ↔ browser, over a real network |
| **Concurrency** | ~3 simultaneous viewers per server (not final) |

**This inverts the ranking in the measurement document.** That campaign measured
throughput and CPU per byte, because that is what a saturating harness on loopback can
measure. The primary metric here is p95, and the two rank the work differently:

- At **~3 viewers** a 4-core host is nowhere near CPU-saturated. The CPU wins (GSO cap,
  send-path copies) are real and worth taking, but they buy **density, not latency** at
  this concurrency. They stop being the top of the list.
- The knobs that move p95 — congestion window, loss recovery, stream scheduling — are
  precisely the ones the loopback rig **could not test**, because it had no RTT and no
  loss. Their nulls in that document are nulls *for that rig only*.
- One result must be **actively un-learned**: "BBR is 4–6 % worse" was measured on a
  zero-RTT lossless link, which is the one regime where BBR cannot show value. **For a
  browser over a real path, the congestion controller question is open, not closed.**

Two levers larger than anything transport-level are already decided elsewhere and are not
restated here: resolution fitting to the viewport
([`adr-resolution-fitting-for-large-frames.md`](adr-resolution-fitting-for-large-frames.md))
and stride ([`adr-stride-is-bandwidth-conservation.md`](adr-stride-is-bandwidth-conservation.md)).
**Sending fewer bytes beats sending bytes faster.** This spec is the transport layer
underneath those.

---

## 1 · Invariants this spec depends on

Check these against the new architecture first. Each item in §2–§4 names which it needs.

| id | invariant | how to check it survived |
| -- | --------- | ------------------------ |
| **I1** | Frame bytes originate in a memory region the server can hand out as a refcounted slice without copying (an mmap, an `Arc<[u8]>`, an arena) | Can you produce a `bytes::Bytes` for a frame without `to_owned()`/`Vec` allocation? |
| **I2** | The send path can reach the underlying QUIC send stream, not only a `&[u8]` wrapper | Is there a path to `quinn::SendStream` (e.g. an escape hatch on the WebTransport stream type)? |
| **I3** | The per-frame code path is a distinct, interceptable step (locate → send) | Can you time and swap the locate step and the send step independently? |
| **I4** | The server owns its `quinn::TransportConfig` / endpoint construction | Can you pass a custom transport config when building the endpoint? |
| **I5** | Frames are served over QUIC streams whose priority the server can set | Is there a per-stream `set_priority`, or a documented scheduling order? |
| **I6** | The client is a browser using the WebTransport API | If a native client ever appears, §5 unlocks |

**If I1 or I2 is false, item A2 is not implementable as written** — say so and re-derive,
do not approximate it.

---

## 2 · Ranked for p95 time-to-displayable

Ordered by expected effect on the primary metric. **The first two are unmeasured** — they
are specified as experiments because they are the largest untested latency levers, not
because they are known wins.

### P1 · Initial congestion window — **unmeasured, largest suspected p95 lever**

*Invariant: I4.*

**Mechanism.** QUIC starts in slow start with a small congestion window and doubles per
RTT. quinn's Cubic default is `14720.clamp(2 × 1200, 10 × 1200)` = **12 000 bytes**. A
250 KB frame therefore needs roughly `log2(250000 / 12000) ≈ 4.4` doublings before it can
be in flight at once — **~5 RTTs of slow start for the first frame**, or ~300 ms at a
60 ms RTT, spent entirely on ramp rather than on bandwidth. This is charged to *every cold
connection*, and it lands directly on time-to-first-displayable.

**Change.** `CubicConfig::initial_window(n)` (also on `NewRenoConfig`, `BbrConfig`), passed
through `TransportConfig::congestion_controller_factory`. The setter is not clamped.

**Do not just raise it.** A large initial window is a real fairness and congestion hazard —
it is the classic way to make your own latency better and everyone else's worse, and on a
congested access link it can cause the loss it was meant to avoid. RFC 9002 sanctions 10
packets / 14 600 bytes; anything beyond is a deployment decision, not a default.

**Experiment.** Sweep `initial_window` ∈ {12 000 (default), 30 000, 60 000, 120 000} × RTT
∈ {20, 60, 150 ms} × loss ∈ {0, 0.5, 2 %}, measuring **p95 time-to-displayable for the
first N frames of a cold connection**, plus retransmission count as the safety check.
**Requires netem** (see §6). Stop condition: any arm where retransmissions rise
super-linearly with the window is disqualified regardless of its p95.

### P2 · Stream scheduling — priority, or the fairness switch

*Invariants: I4, I5.*

**Mechanism.** QUIC round-robins between same-priority streams by default. With `D`
frames in flight on `D` streams, all `D` progress together and *all* finish late — so the
frame the reader is waiting for arrives at the end, not at the front. For strictly ordered
demand this is pure p95 damage. This is measured and mechanistically established in
`measurements/r2/CAMPAIGN_V2_ANALYSIS.md`.

**Two ways to fix it, and they are not equivalent:**

| | effect | cost |
| --- | --- | --- |
| Per-stream `set_priority` | Full control: the frame the reader wants can be promoted *after* it was asked for | Per-frame bookkeeping; needs a policy for what priority to assign |
| `TransportConfig::send_fairness(false)` | Global FIFO: streams drain in the order they were written | One line; no control once a frame is queued |

**Measured:** `send_fairness(false)` recovers per-frame mode's deficit (+11.8 % throughput
at D=4, never worse in any cell) — but that was a *throughput* measurement on loopback,
and the p95 question it bears on is still open (lane L1).

**Caution, untested.** With one media stream and one control stream on the same connection,
FIFO scheduling could let a long media write delay a control write. That interaction was
never measured. If the new architecture multiplexes anything latency-sensitive alongside
frame bytes, measure it before flipping the switch.

**Which to choose depends on a decision this repo has not yet made** (shared vs per-frame
streams — lanes L1/L2). Rule: **if per-frame streams are chosen, one of these two ships
with it.** Per-frame streams without either is the configuration measured to lose 10–25 %.

### P3 · Remove per-frame latency from the serving path

*Invariant: I3.*

**Mechanism.** Anything the server does per frame between "ask arrives" and "first byte
written" is added directly to time-to-displayable. At ~3 concurrent viewers the server has
CPU to spare, so this is a *latency* concern, not a throughput one — the opposite of how
the measurement document frames it.

The known instance is the unconditional blocking prefault hop: one `spawn_blocking` per
frame to fault pages in before writing. Measured cost with a warm page cache: **−10 %
throughput, +14 % CPU/byte at 250 KB, +34 % at 32 KB**. The per-frame latency is a
thread-pool handoff plus scheduling delay.

**This is a safety mechanism and the default must not be flipped casually.**
[`disk-access/adr.md`](disk-access/adr.md) accepts this cost deliberately: a major page
fault is not an `.await`, so taking it on the executor stalls every task on that thread,
and the ADR explicitly rejected a `mincore` residency gate as the default because
residency is not a lease for the write window.

**The change that is compatible with the ADR:** keep the guarantee, stop paying per frame.
If asks can arrive in batches, do **one hop per batch** rather than one per frame — every
fault still leaves the executor, and the handoff amortises over N frames. Unmeasured;
needs a batching client to test.

**Generalise the rule when reviewing the new architecture:** for every per-frame step,
ask whether it is on the ask→first-byte path, and whether it can be batched, cached, or
moved off it. Enumerate them; do not assume the prefault is the only one.

### P4 · Loss recovery and early-RTT parameters — **unmeasured**

*Invariant: I4.*

Three defaults that shape the p95 *tail* and that the loopback rig could not exercise at
all, because it had neither loss nor RTT:

| knob | quinn default | why it may matter |
| ---- | ------------- | ----------------- |
| `initial_rtt` | **333 ms** | Before the first RTT sample, PTO derives from this. A lost handshake or first-flight packet costs a ~333 ms timeout — straight onto cold-start p95 |
| `packet_threshold` | 3 | Packets of reordering before loss is declared. Lower = faster recovery, more spurious retransmits |
| `time_threshold` | 9/8 | Time-based loss detection multiplier, same trade |

`initial_rtt` is the one worth attention: it is a pure cold-start tail parameter, and 333 ms
is the spec's conservative default for an unknown path, not a measurement of yours.

**Experiment.** Under netem at the real deployment's RTT and loss, measure p95 and p99
time-to-displayable across `initial_rtt` ∈ {333 ms (default), 100 ms, measured-median}.
Watch spurious retransmission rate as the disqualifier.

### P5 · Congestion controller — **re-opened, previously mis-measured**

*Invariant: I4.*

The measurement document records BBR as **4–6 % worse than Cubic with up to 2× the CPU**.
**Do not carry that conclusion into this deployment.** It was measured on loopback and TBF:
zero RTT, zero loss, a shallow token bucket — the regime where Cubic is already optimal and
BBR's entire reason for existing (bandwidth-delay probing, buffer-bloat avoidance) cannot
appear. It is a valid result about that rig and says nothing about a browser on a real path.

Note also that quinn's BBR is a port of quiche's **BBRv1** and is marked experimental
upstream. BBRv3 is not available in this stack at any price.

**Experiment.** Cubic vs BBR at RTT ∈ {20, 60, 150 ms} × loss ∈ {0, 0.5, 2 %}, metric p95
time-to-displayable, with the CPU cost recorded alongside — the 2× CPU finding *is*
transferable and must be weighed against any latency gain.

---

## 3 · Ranked for server CPU per byte

These are measured, land in the current architecture, and are worth taking — but at ~3
viewers they buy headroom, not responsiveness. Take them; do not let them displace §2.

### C1 · GSO segment cap — **largest measured effect, needs an upstream change**

*Invariant: I4 (and a Linux host).*

**Mechanism.** quinn packs at most `MAX_TRANSMIT_SEGMENTS = 10` datagrams into one
`sendmsg` — ~14.5 KB at a 1452-byte MTU — while the kernel allows far more. quinn-udp has
no `sendmmsg` batching on send, so this constant alone decides syscall count.

**Measured:** raising it to **32** gives **+17.2 % throughput and −20.9 % CPU/byte** at
250 KB frames (+5.1 % / −15.6 % at 32 KB). 44 adds nothing further. Independently
corroborated by an ETH Zürich benchmarking thesis that patched the same constant.

**The trap, and it is severe.** The binding limit is **bytes, not segments**: Linux caps a
UDP GSO payload at `65535 − 8 = 65527`, which is **45 segments at a 1452-byte MTU**. Exceed
it and `sendmsg` returns `EINVAL`, whereupon quinn-udp **permanently sets
`max_gso_segments = 1`** — offload is dead for the life of that socket. Measured: a
48-segment cap collapsed throughput by 91 %.

**Therefore: never set a constant. Derive it** — `min(platform_max_segments, 65527 / mtu)`
— and re-derive it whenever the MTU changes, because DPLMTUD raises the MTU at runtime and
a cap that was safe at 1200 is not safe at 1452.

**Status: not implementable in-tree.** It is a `quinn` crate constant. Options, in order of
preference: (a) contribute the measurement to upstream issue **#2201**, which is open and
asks quinn-udp to handle exactly this; (b) carry a patched quinn only if the density
justifies a vendored dependency — at 3 viewers it does not. `lab/scripts/gso_cap_experiment.sh`
reproduces the arms without vendoring a fork.

### C2 · Zero-copy send path

*Invariants: I1, I2.*

**Mechanism.** Writing frame bytes as `&[u8]` makes quinn allocate and copy the whole frame
into its send buffer (`ByteSlice::pop_chunk` → `Bytes::from(data.to_owned())`). Handing it
an owned `Bytes` instead makes the same step a `mem::take` — the buffer is moved, not
copied. QUIC must retain bytes for retransmission, so *one* copy is unavoidable; this
removes the *extra* one.

**Change.** Three parts, all required:
1. Hold the frame source as something sliceable without copying — e.g. `Bytes::from_owner(mmap)`, mapped **once** (a second mapping makes any prefault touch pages the send path never reads).
2. Build the frame header as its own small `Bytes` chunk; never prepend it to the payload, because prepending forces a contiguous buffer and reintroduces the copy.
3. Write header and payload together through the chunked write (`write_all_chunks`), reaching the underlying `quinn::SendStream` if the WebTransport wrapper exposes only `&[u8]`.

**Measured:** **−6…−14 % CPU per byte at every link rate**, and +5.3 % throughput with two
clients (+17.9 % single-client, where the client shares the bottleneck). At 32 KB frames
the gain is inside noise — **this is a large-frame optimisation**.

**Verification is not optional.** The wire bytes must be identical to the non-chunked path.
Pin it with a test that constructs both encodings and asserts equality, including the
zero-length and maximum-index cases. If the new architecture's pipeline is `&[u8]` end to
end, this requires a **signature change** to carry `Bytes` — not a call-site edit.

### C3 · Crypto provider — available, and not worth taking first

*Invariant: I4.*

`aws-lc-rs` is genuinely **1.33× faster than `ring`** at the AEAD (1452-byte packets,
VAES/AVX-512 host) — but the AEAD is only ~5 % of server CPU per byte in this stack, so the
end-to-end gain is **1–2 %**, which is what was measured. The microbenchmark predicts the
end-to-end result, so both are believed.

**Ordering rule, and it generalises:** the published figures showing crypto as the dominant
QUIC cost are measured **with kernel bypass already applied**, which removes the syscall
and copy overhead that dominates a normal stack. **Batching and copies first, cipher last.**
Revisit C3 only after C1 and C2 are in and crypto has actually risen to the top of a
profile.

Cipher *choice* matters more than the library: ChaCha20-Poly1305 is ~3.6× slower than
AES-GCM on a host with AES-NI. rustls already prefers AES-GCM, so this is a property to
preserve, not one to add.

---

## 4 · Measured null or negative — do not re-litigate without new evidence

Every one of these was run at 250 KB and 32 KB, three repeats, against a matched baseline.

| knob | result | caveat that could reopen it |
| ---- | ------ | --------------------------- |
| `stream_receive_window` (6.7× default) | nil | **Reopens on a real path.** The default is tuned for 100 Mbps × 100 ms; a null at ~0 RTT says nothing about a WAN BDP |
| `receive_window`, `send_window` | nil | same |
| `initial_mtu` 1452 + DPLMTUD off | nil | DPLMTUD already reaches 1452 within a few RTTs; a null here is expected |
| Socket buffers (`SO_SNDBUF`/`SO_RCVBUF`) 8 MB | nil | Reopens under real loss/queueing |
| ACK frequency extension | +2.7 % at 250 KB, nil at 32 KB | Marginal, and it is an extension the peer must negotiate — browser support unverified |
| BBR | −4…−6 %, up to 2× CPU | **Reopened — see P5.** The rig could not show BBR's value |

**The pattern worth carrying:** every null in this table came from a rig with no RTT and no
loss. Nulls for the CPU-side items (MTU, socket buffers) are trustworthy. Nulls for the
*window and congestion* items are artefacts of the rig and must be re-run before being
treated as settled.

---

## 5 · Blocked by the browser client

The client is browser-only indefinitely, which closes these permanently unless that changes
(invariant I6):

- **Receive-side zero-copy.** The WebTransport API delivers into the JS heap; there is no
  chunk API and no way to avoid that copy.
- **Client-side pacing, congestion control, or socket tuning.** Not exposed.
- **Kernel bypass anywhere on the client.**

Reachable but unexplored, and worth naming so nobody assumes it was considered and rejected:

- **WebTransport datagrams** are available in browsers. For scrub-ahead frames that are
  worthless once stale, unreliable delivery avoids retransmitting data nobody will look at.
  The obstacle is size: a datagram is bounded near the MTU, so a 250 KB frame needs
  application-level fragmentation and reassembly with no retransmission underneath.
  **Probably not worth it — but it is the one transport mechanism that changes the shape of
  the problem rather than the constant factor, and it has never been evaluated.**
- **Connection reuse / 0-RTT across navigations.** Cold-start p95 includes a QUIC handshake
  plus HTTP/3 SETTINGS plus CONNECT. What the browser exposes here is unverified.

---

## 6 · How to verify any of this on the new architecture

The measurement campaign made three methodological mistakes. Do not repeat them.

**1 · Interleave arms within each repeat.** Running arm A to completion then arm B lets
host drift land on one arm. This produced a wrong answer once: a VM was replaced
mid-campaign and the two arms disagreed by 20 % for reasons that had nothing to do with
the code.

**2 · Measure both sides' CPU, and check the client is not the bottleneck.** One native
harness saturated ~0.93 of a core and capped a session at ~1.4 Gbps while the server sat at
1.3 of 4 cores — so every single-client throughput figure was a *client* ceiling. Two
clients reached 1.92×. **Record cores-busy for client and server on every run**; if the
client is near 1.0, the number is not about the server.

Note that the harness is a native Rust client. **A browser's receive path is different and
probably slower**, so the production client ceiling is unmeasured and may be lower still.

**3 · Prefer CPU per byte over throughput where the question is server cost.** It measures
server work per byte regardless of which side is limiting, and it ranked the arms
identically on all four rigs used. Throughput deltas swing with the bottleneck's location:
the same change read +17.9 % and +5.3 % on two rigs.

**And one gap to close before any §2 work:** the rig has **no p95 and no loss/RTT axis**.
`--mode saturate` produces no wait times, and the container kernel has no `sch_netem`
(only `tbf`/`htb` rate shaping). **Every item in §2 needs `--mode trace` on a netem-capable
host** — the Oracle São Paulo rig in [`cloud-rig-access.md`](cloud-rig-access.md). Without
that, §2 cannot be evaluated at all.

### Minimum acceptance for adopting any item here

1. Arms interleaved, ≥3 repeats, all rows kept.
2. Client and server cores-busy recorded; client not saturated.
3. For §2 items: p95 time-to-displayable from `--mode trace`, on netem, at the
   deployment's RTT and loss.
4. For a wire-format-touching change: a test asserting byte-identical output against the
   previous encoding.
5. Raw rows committed under `docs/measurements/`, with the rig and host named.

---

## 7 · So — is this everything?

**No.** Honestly scoped, for the goal in §0:

**Well covered.** The server's CPU-per-byte path: copies, syscall batching, cipher. These
were measured properly, corroborated externally, and §3 is close to exhaustive for a
`quinn`/`wtransport` server on Linux.

**Specified but unmeasured** — the whole of §2, which is where the *primary* metric lives.
The initial congestion window (P1) is the largest suspected lever and has never been
touched. Loss recovery (P4) and congestion control (P5) were nominally tested but on a rig
that could not exercise them.

**Not explored at all:**
- WebTransport datagrams as a delivery mode for stale-able frames (§5).
- Cold-start cost: handshake, HTTP/3 setup, connection reuse, 0-RTT.
- Multi-core scaling and `SO_REUSEPORT` — **deliberately dropped**: at ~3 viewers a single
  endpoint is not the constraint. Reopen only if concurrency targets change by an order of
  magnitude.
- Anything measured through a real browser rather than a native harness.

**Larger than all of it,** and already decided elsewhere: resolution fitting and stride.
A 2.99 MB frame delivered as a viewport-sized rung beats every optimisation in this
document combined. Transport work is what remains after the byte count is right.
