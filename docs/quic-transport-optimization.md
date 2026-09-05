# QUIC transport optimisation — research and measurement

**2026-09-05 · T2** (single-host loopback + TBF shaping in a private netns).
Claims cross-checked against upstream source, kernel documentation and published
measurement in [§7](#7--what-the-outside-evidence-says).

> **This is the measurement record, not the implementation guide.** For applying any of
> it to the post-rewrite server, and for the ranking against *our* primary metric, read
> [`transport-optimization-spec.md`](transport-optimization-spec.md) instead — it is
> written against invariants rather than against this tree's file layout, and it re-ranks
> everything below for **p95 time-to-displayable**, which this campaign did not measure.
Raw data: [`measurements/quic-opt/`](measurements/quic-opt/). Rig:
[`lab/scripts/quic_opt_bench.sh`](../lab/scripts/quic_opt_bench.sh) (unshaped),
[`lab/scripts/quic_opt_shaped.sh`](../lab/scripts/quic_opt_shaped.sh) (rate-shaped),
[`lab/aead-bench`](../lab/aead-bench) (cipher microbench).

Prompted by a generic "make QUIC faster" checklist. Two thirds of it turned out to be
**already on by default** in `quinn`, and the item with the biggest headline number —
GSO — was one we were already getting for free.

The wins were all one level below the checklist. GSO is on, but `quinn` uses a sixth of
what the kernel allows, and raising it is worth more than anything on the list. The send
path copied every frame, and the copy that survived an earlier fix turned out to be the
expensive one. And the cheapest CPU in the server is the work it does per frame whether
or not the page cache is warm.

---

## Summary

| # | Change | Effect | Status |
| - | ------ | ------ | ------ |
| 1 | **quinn's GSO segment cap, 10 → 32** | **+17.2 % throughput, −20.9 % CPU/byte** at 250 KB; +5.1 % / −15.6 % at 32 KB | **Upstream constant — needs a quinn patch.** Biggest lever found; independently corroborated (§7) |
| 2 | **Chunked send path** — `Bytes` slice of the mapping + `write_all_chunks` | **+5.3 % throughput, −6…−14 % CPU/byte** vs the current baseline | **Adopted as default** |
| 3 | **Per-frame prefault hop**, warm cache | **costs 10 % throughput and 14–34 % CPU/byte** | Measured, **default unchanged** — it is a safety decision, see §6 |
| 4 | UDP GSO itself | 1.8–3.7× here, but **rig-inflated** — published stacks see +19…+33 % (§2, §7) | Already on — quinn default |
| 5 | DPLMTUD (RFC 8899) | no measurable effect on this path | Already on — quinn default |
| 6 | `aws-lc-rs` instead of `ring` | +1–2 % end to end (AEAD itself is 1.33× faster) | Opt-in feature, **not** default |
| 7 | `send_fairness(false)` | +11.8 % for **per-frame** mode at D=4; nil for shared | Exposed, default unchanged |
| 8 | ACK frequency extension | +2.7 % at 250 KB, nil at 32 KB | Exposed, default off |
| 9 | BBR instead of Cubic | **−4…−6 % throughput, up to 2× CPU** | Exposed, default Cubic |
| 10 | Flow-control windows, socket buffers, `initial_mtu` | **nil, all of them** | Left at quinn defaults |

Everything except #1 is a runtime flag on `exact-server`, so it is one process restart
away from being re-measured. Unset means "quinn's own default", so an arm that changes
nothing measures nothing. #1 needs a rebuilt quinn —
[`lab/scripts/gso_cap_experiment.sh`](../lab/scripts/gso_cap_experiment.sh) does it
reproducibly without vendoring a fork into the tree.

---

## 0 · The rig had a bottleneck of its own — read this before any throughput figure

One `window-harness` process saturates **~0.93 of a core** and caps a single session at
~1.4 Gbps on this box, while the server is still at 1.3 of 4 cores. Running more clients
against one server:

| clients | aggregate | vs 1 client |
| ------- | --------- | ----------- |
| 1 | 1406.7 Mbps | — |
| 2 | 2705.7 Mbps | **1.92×** |
| 3 | 3470.0 Mbps | 2.47× |

**So every single-client throughput number is a client ceiling, not a server capability.**
Two clients nearly doubles it; the server was never the limit. This was caught late, and
it changes how the earlier tables must be read:

- **CPU per byte is the load-bearing metric.** It measures server work per byte and does
  not care which side is limiting. It is consistent across all four rigs used here.
- **Throughput deltas are regime-dependent.** The same send-path change reads **+17.9 %**
  in the single-client closed loop and **+5.3 %** when two clients push the server —
  because in the first the client and server share the bottleneck and server latency
  feeds back into client rate.
- At two clients the box runs ~3.5 of 4 cores with clients and server competing, so even
  the aggregate is a *whole-box* number. **A clean server-throughput ceiling cannot be
  measured with local clients on one host at all.** That needs two machines.

Sections 4–5, 7–10 were measured single-client before this was understood. Their
*rankings* stand — every arm faced the same rig — but read their throughput percentages
as lower bounds on a shared-bottleneck loop, not as server capability.

---

## 1 · The send path — one copy left, and it was the dear one

### Three shapes, not two

There are **three** send shapes in this tree's history, and the increment that matters is
the last one. Measuring against the oldest would overstate the change.

| arm | shape | full-frame copies |
| --- | ----- | ----------------- |
| `copy` | `wrap()` into a fresh `Vec`, then one `write_all(&[u8])` | **2** |
| `split` | `[len]`, `[index]`, codestream as three `write_all(&[u8])` calls | **1** |
| `chunked` | 8-byte header `Bytes` + mapping slice → `write_all_chunks` | **0** |

`split` is **already on `cursor/client-frame-pipeline-telemetry-8017`**
(`FrameOut::send_frame`), so it — not `copy` — is the baseline any new claim must beat.
All three are selectable at runtime and pinned to identical wire bytes by
`all_send_paths_are_the_same_wire`.

The remaining copy in `split` is not visible in the signature.
`wtransport::SendStream::write_all` takes `&[u8]`, which reaches `quinn_proto`'s
`ByteSlice::pop_chunk`:

```rust
let chunk = Bytes::from(self.data[..limit].to_owned());   // allocate, memcpy
```

QUIC must retain bytes for retransmission, so *a* copy is unavoidable — but only one,
and only if you hand it something it can take ownership of. `BytesArray::pop_chunk`,
the path a `Bytes` takes, is a `mem::take`.

### What it is now

`FrameStore` maps the study once and holds it as `Bytes::from_owner(mmap)`, so
`frame_bytes()` is a refcount bump. The 8-byte `[len][index]` header is one small chunk,
the codestream is a slice of the mapping, and both go to
`quinn::SendStream::write_all_chunks` — reached through `wtransport`'s
`quic_stream_mut()` escape hatch.

Wire output is **byte-identical**, pinned by `chunked_header_matches_copy_path`. Both
paths remain selectable (`--send-path copy|chunked`) so the arm stays re-runnable.

### The knee, measured against `split`

`docs/send-path-copy-costs.md` asked for exactly this sweep — *"the rate at which copies
stop being noise"* — and predicted the shape from arithmetic.

**Arms are interleaved within each repeat**, not run one arm at a time. That matters: the
first pass at this table ran arm-by-arm, the VM was replaced mid-campaign, and the drift
landed unevenly across arms and produced a different answer. Interleaving makes host
drift common-mode. `frames_250k`, D=16:

| cell | `copy` | `split` | `chunked` | `chunked` vs `split` |
| ---- | ------ | ------- | --------- | -------------------- |
| 378 Mbps, CPU-s/GB | 5.044 | 4.860 | **4.419** | **−9.1 %** |
| 756 Mbps, CPU-s/GB | 5.497 | 5.453 | **5.138** | **−5.8 %** |
| unshaped, 1 client, Mbps | 1170.8 ± 17.2 | 1171.3 ± 29.0 | **1381.4 ± 54.1** | **+17.9 %** |
| unshaped, 1 client, CPU-s/GB | 4.813 | 4.683 | **4.035** | **−13.8 %** |
| unshaped, 2 clients, Mbps | 2442.8 ± 184.7 | 2633.2 ± 100.8 | **2772.5 ± 143.2** | **+5.3 %** |
| unshaped, 2 clients, CPU-s/GB | 2.877 | 2.619 | **2.443** | **−6.7 %** |

Below the knee all three arms sit exactly on the link rate (377.7 / 755.8 Mbps to three
figures) and only CPU separates them. Above it, throughput separates them too.

**The two copies are not equally priced, and how unequally depends on the rig.** With one
client, removing `wrap()`'s copy — the `copy` → `split` step already taken on the
telemetry branch — is worth **0.0 %** throughput and quinn's is worth +17.9 %. With two
clients the same two steps read **+7.8 %** and **+5.3 %**. The CPU numbers are steadier
and rank the same way in every cell: `chunked` is always cheapest, and `split` → `chunked`
is **−6…−14 % CPU per byte** across all four rigs.

Why the last copy is dearer than the first, **inferred, not measured**: in the `copy` arm
quinn's copy reads `payload`, a buffer written microseconds earlier and still in cache,
while in `split` the single remaining copy reads the *mapping* and allocates a fresh
`Bytes` to hold it. The last copy standing is the one that touches cold pages and the
allocator. Worth confirming with a cache-miss counter before it is repeated as fact.

Two further things the arithmetic did not say:

- **The CPU saving is there at every rate**, including rates where throughput is
  identical. A browser on a 378 Mbps link gets its frames no sooner — but the server
  spends 9 % less CPU delivering them, which is server density, not client latency.
- **Frame size decides it, not just link rate.** At 32 KB frames the gain is inside
  noise. Per-frame fixed costs dominate there; the copy is a rounding error.

Adopting this on `cursor/client-frame-pipeline-telemetry-8017` is not a drop-in: that
branch's `FramePipeline` trait is `&[u8]` end to end —
`locate<'a>(..) -> Result<&'a [u8]>` feeding `send(&mut self, frame, bytes: &[u8])`.
Reaching the chunk API means those two signatures carry `Bytes` instead, which is a
trait change, not a call-site change.

### A caution about absolute numbers in this document

The host was replaced mid-campaign — a Xeon @ 2.10 GHz became a Xeon @ 2.80 GHz, and
unshaped 250 KB throughput moved from ~1.9 Gbps to ~1.4 Gbps with CPU-s/GB rising from
~2.9 to ~4.0. **Compare arms within a table, never absolute figures across tables.**
Sections 2–5 were measured on the first host; this section's table on the second.

### One correction to `send-path-copy-costs.md`

That document lists as a hard ceiling: *"`wtransport` has no chunk write … on any
browser-facing path this copy is not removable without upstream work in `wtransport`."*
**That is no longer true.** `wtransport` 0.7.2 exposes `quic_stream_mut()`, which hands
back the underlying `quinn::SendStream` and with it `write_all_chunks`. No upstream work
was needed and the browser path is unaffected, because the bytes on the wire are the
same. Its other ceiling — that QUIC cannot use kernel zero-copy, so "zero-copy" means
*one* copy — still stands.

---

## 2 · GSO — already on, and still leaving 17 % on the table

Turning segmentation offload **off** is the largest single effect measured anywhere in
this campaign — and then the cap on how much of it `quinn` uses is the largest available
*gain*. First, that GSO is doing the work it claims:

| fixture | GSO on | GSO off | | CPU/GB on | CPU/GB off |
| ------- | ------ | ------- | - | --------- | ---------- |
| 250 KB | 1904.9 | **514.4** | **3.7×** | 2.90 | 10.71 |
| 32 KB | 6352.3 | **3547.6** | **1.8×** | 5.14 | 12.35 |

**Do not quote 3.7× as "what GSO is worth".** It is what GSO is worth *against this
baseline on this rig*, and both inflate it. `quinn-udp`'s Linux send path is one
`libc::sendmsg` per `Transmit` — there is no `sendmmsg` batching on send, only on receive
(`recvmmsg`) — so the GSO-off arm is one syscall per datagram, the worst possible
comparator. Published numbers for stacks whose baseline already batches are far smaller:
quiche **+19 %** (3.5 → 4.16 Gbit/s) and ngtcp2 **+33 %** (3.7 → 4.94) with GSO/GRO on;
Cloudflare's own progression from plain `sendmsg` to `sendmmsg`+GSO was **2.5×**
(640 Mbps → 1.6 Gbps), which is the closest analogue to what this row measures. Loopback
inflates it further, because with no driver or DMA the syscall is a larger share of total
cost than it would be on a NIC.

The honest statement is: **on this stack, disabling GSO costs 1.8–3.7× because quinn has
nothing else batching the send path.** The direction is not in doubt; the multiplier is
rig-specific.

`quinn` sets `enable_segmentation_offload: true` by default and `quinn-udp` probes
`UDP_SEGMENT` support at socket creation; GRO is enabled opportunistically on the
receive path the same way. So the checklist's "2–3× throughput, ~50 % less CPU" is real
and we already had it — this run only proves we still have it. The flag exists so the
control can be re-run, **not** because anyone should turn it off.

### The segment cap — the biggest lever in this document

Having GSO is not the same as having enough of it. `quinn` bounds a batch with

```rust
/// This can be lower than the maximum platform capabilities, to avoid excessive
/// memory allocations when calling `poll_transmit()`. Benchmarks have shown
/// that numbers around 10 are a good compromise.
const MAX_TRANSMIT_SEGMENTS: usize = 10;
```

so at most ten datagrams — ~14.5 KB at a 1452-byte MTU — go out per `sendmsg`. This host
reports **64** for both `max_gso_segments` and `gro_segments`, so the cap is 6.4× below
what the kernel offers. Two clients, interleaved arms, n=4:

| segments | bytes per `sendmsg` | `frames_250k` | vs 10 | `frames_32k` | vs 10 |
| -------- | ------------------- | ------------- | ----- | ------------ | ----- |
| 10 (upstream) | 14 520 | 4034.3 ± 58.3 Mbps · 1.678 CPU-s/GB | — | 13 651.8 ± 169.0 · 3.216 | — |
| **32** | 46 464 | **4728.3 ± 204.1 · 1.328** | **+17.2 % · −20.9 %** | **14 348.0 ± 56.7 · 2.715** | **+5.1 % · −15.6 %** |
| 44 | 63 888 | 4695.9 ± 78.3 · 1.272 | +16.4 % · −24.2 % | 14 342.4 ± 52.0 · 2.688 | +5.1 % · −16.4 % |

**32 captures the whole gain**; 44 adds only a little more CPU saving and no throughput.

### And a cliff, at exactly 64 KB

Setting the cap to 64 — the number the kernel reports — does not merely stop helping, it
**collapses throughput by 91 %** (238.2 Mbps, and CPU per byte *rises* 38 %). Bisecting
finds the edge exactly where the arithmetic puts it:

| segments | bytes per `sendmsg` | aggregate |
| -------- | ------------------- | --------- |
| 44 | 63 888 | 4705.2 Mbps |
| **45** | **65 340** | **4642.7 Mbps** |
| **48** | **69 696** | **236.3 Mbps** |

**The binding limit is bytes, not segments.** Linux caps a UDP GSO payload at
`65535 − 8 = 65527` bytes. At a 1452-byte MTU that is **45 segments** (45 × 1452 = 65 340
fits; 46 would not), which is exactly where the bracket above lands. `max_gso_segments()`
reporting 64 is the kernel's segment *count* limit — reachable only at an MTU of ~1024.
Anything that reads that number and uses it directly falls off this cliff at any normal
MTU.

**And the collapse is worse than losing batching, because the failure is sticky.** An
oversized GSO buffer returns `EINVAL`, and `quinn-udp` responds by *permanently* disabling
offload for that socket:

```rust
if let Some(libc::EIO) | Some(libc::EINVAL) = e.raw_os_error() {
    if state.max_gso_segments() > 1 {
        crate::log::info!("`libc::sendmsg` failed with {e}; halting segmentation offload");
        state.max_gso_segments.store(1, Ordering::Relaxed);
    }
}
```

So one oversized send costs GSO for the life of the connection — which is why the 48-segment
arm reads 236 Mbps rather than merely "GSO-off fast". This is not a hypothetical: it is
`quinn-udp` 0.5.15 `unix.rs`, and upstream issues #2202 ("EINVAL may happen even if GSO was
previously working") and #2575 ("Automatic GSO deactivation no longer works") are about
this same path.

**A cap derived from the current MTU** — `min(platform_segments, 65527 / mtu)`, i.e. 45 at
1452 and 54 at 1200 — is safe at any MTU and captures the gain. quinn issue **#2201**
("Should `quinn-udp` automatically chunk `Transmit::contents`?", **open**) already asks for
exactly this, having hit the same arithmetic from the other direction: at
`max_gso_segments = 64`, any segment larger than 1023 bytes overflows the limit. **The
contribution here is the measurement, not the diagnosis** — add it to #2201 rather than
filing a new issue.

Reproduce with [`lab/scripts/gso_cap_experiment.sh`](../lab/scripts/gso_cap_experiment.sh),
which vendors and patches quinn outside the tree and leaves nothing behind. **No forked
quinn is committed here** and the default build is unchanged.

---

## 3 · Crypto — why the provider swap is worth 1 %, and it is not a broken arm

`aws-lc-rs` moved end-to-end throughput by 1–2 %. Published rustls benchmarks report
1.26–1.47× on bulk AES-GCM, so the arm needed explaining rather than reporting.

`lab/aead-bench` measures the seal alone, at QUIC datagram sizes, on this CPU
(Xeon @ 2.10 GHz, with `aes`, `vaes`, `vpclmulqdq`, `avx512f`):

| payload | ring AES-128-GCM | aws-lc-rs AES-128-GCM | ratio |
| ------- | ---------------- | --------------------- | ----- |
| 1200 B | 47.6 Gbps · 0.168 CPU-s/GB | 52.2 Gbps · 0.153 | 1.10× |
| 1452 B | 42.6 Gbps · 0.188 CPU-s/GB | 56.7 Gbps · 0.141 | **1.33×** |
| 14520 B | 70.8 Gbps · 0.113 CPU-s/GB | 109.9 Gbps · 0.073 | 1.55× |

The library difference is real and matches the published figures. The arithmetic that
kills it: the whole server costs **~3.5 CPU-s/GB**, of which the AEAD at a 1452-byte MTU
is **0.188 — about 5 %**. A 1.33× faster cipher can therefore return at most
**1.3 % of total**. Measured end to end: 1–2 %. The microbench predicts the e2e result,
so both are believed.

**Do not adopt it as the default.** It is a 1 % gain in exchange for a C toolchain and
`bindgen` in the build. The feature exists (`--no-default-features --features
crypto-aws-lc-rs`) for anyone whose deployment is genuinely AEAD-bound.

**The larger crypto finding is cipher choice, not library.** ChaCha20-Poly1305 runs at
11.9 Gbps against AES-128-GCM's 42.6 on this CPU — **3.6× slower**, which would take
crypto from 5 % of server CPU to ~19 %. rustls already prefers AES-GCM in its default
suite order, so this is another one we have rather than one to get; it is worth knowing
only because it is the crypto decision that would actually cost something if it went the
other way.

---

## 4 · Stream fairness — a one-line answer to a question this repo already asked

`CAMPAIGN_V2_ANALYSIS.md` established that per-frame streams lose 10–25 % to shared
because *"QUIC fair-shares bandwidth across concurrent streams, so all of them finish
late"*, and that per-stream `set_priority` recovers it.

`quinn` has a direct switch for that mechanism, which the campaign did not use:

> `send_fairness` — *"When enabled, connections schedule data from outgoing streams
> having the same priority in a round-robin fashion. When disabled, streams are scheduled
> in the order they are written to."* Default: **enabled**.

Measured, per-frame mode, mean of 3:

| cell | fairness on | fairness off | shared reference |
| ---- | ----------- | ------------ | ---------------- |
| 250 KB, D=4, unshaped | 1262.7 | **1411.6** (+11.8 %) | 1387.4 |
| 250 KB, D=16, unshaped | 1837.6 | **1902.8** (+3.5 %) | 1839.9 |
| 250 KB, D=16, 47 Mbps shaped | 45.4 | **47.3** (+4.2 %) | 47.3 |
| 32 KB, D=4/D=16 | 1832 / 6446 | 1850 / 6455 | 1828 / 6419 |

`send_fairness(false)` closes the per-frame deficit — at D=4 it lands slightly *above*
shared — and never costs anything in any cell measured. At the shaped 47 Mbps cell it is
the difference between reaching link rate and not.

**The default is unchanged, deliberately.** In `shared` mode there is one media stream
and the switch is a no-op, so there is nothing to gain; and shared mode also carries the
bidi control stream, where FIFO scheduling could in principle let a long media write
delay a control write. That interaction is **not measured**. The knob is exposed and
documented so that whoever closes the stream-mode question can take it with them:
**if per-frame is ever chosen, `--send-fairness false` goes with it**, and it is cheaper
than the `set_priority` bookkeeping the campaign proposed.

---

## 5 · Measured and rejected

Every one of these was run at 250 KB and 32 KB, D=16, three repeats, against the same
chunked-path baseline (1904.9 / 6352.3 Mbps):

| arm | 250 KB | 32 KB | verdict |
| --- | ------ | ----- | ------- |
| `--stream-receive-window 8388608` | 1878.0 (−1.4 %) | 6360.2 (+0.1 %) | nil |
| `--send-window 67108864` | 1876.1 (−1.5 %) | 6301.0 (−0.8 %) | nil |
| `--initial-mtu 1452 --mtu-discovery false` | 1903.4 (−0.1 %) | 6400.1 (+0.8 %) | nil |
| `--socket-send-buffer/-recv-buffer 8388608` | 1865.7 (−2.1 %) | 6445.9 (+1.5 %) | nil |
| `--ack-frequency true` | 1957.0 (**+2.7 %**) | 6360.0 (+0.1 %) | marginal |
| `--congestion bbr` | 1788.1 (**−6.1 %**) | 6070.0 (**−4.4 %**) | **worse** |

The windows are the interesting null. The default `stream_receive_window` is 1.25 MB —
tuned for 100 Mbps × 100 ms — and 6.7× it changed nothing, which says the ceiling on
this path is CPU and syscalls, not flow control. **On a real WAN path the same knob is
untested and may well matter**; the null here is a null *for this rig*, not a general one.

BBR lost on every cell, and at the 47 Mbps shaped cell it delivered identical goodput for
**2× the CPU** (8.8 vs 4.2 CPU-s/GB). This is unsurprising and does not generalise:
loopback and TBF give a lossless link with a shallow queue, which is the regime Cubic is
already good at and the one BBR exists to improve on. Note also that `quinn`'s BBR is a
port of quiche's **BBRv1** and is marked experimental upstream — the checklist's "BBRv3"
is not available in this stack at any price.

ACK frequency is a real +2.7 % at 250 KB but it is a QUIC extension the peer must
negotiate, and browser support is not something this rig can speak to. Left off.

---

## 6 · The prefault hop — pricing a decision already made

`docs/disk-access/adr.md` accepts an unconditional `spawn_blocking(touch_frame_pages)`
before every frame, on a sound argument: a major fault on an mmap'd slice is not an
`.await`, so taking it on the executor freezes every task sharing that OS thread. The ADR
records the cost as *"Warm path pays only a pool hop (~10–30 µs lab)"* and explicitly
**rejects a `mincore` gate as the product default**, because under memory pressure
residency is not a lease for the write window.

None of that is disturbed by what follows. What follows is the price tag, which the ADR
states in microseconds and never in throughput. Two clients, warm page cache,
`--send-path chunked`, n=4:

| fixture | prefault on | prefault off | cost of the hop |
| ------- | ----------- | ------------ | --------------- |
| 250 KB | 2857.0 Mbps · 2.379 CPU-s/GB | 3145.9 · 2.050 | **−10.1 % throughput, +13.8 % CPU/byte** |
| 32 KB | 12 175.7 Mbps · 4.233 CPU-s/GB | 13 385.1 · 2.789 | **−9.9 % throughput, +34.1 % CPU/byte** |

"~10–30 µs" is accurate per frame and misleading in aggregate: at 32 KB frames the server
is doing roughly **47 000 of these hops per second**, and the hop is then a third of the
CPU it spends per byte. The smaller the frame, the worse — the cost is per frame, the
benefit is per byte.

**The default is unchanged and should be.** This is a warm-cache measurement with no
memory pressure, which is precisely the regime the ADR did *not* optimise for, and
`--prefault false` reintroduces exactly the co-tenant stall the ADR exists to prevent.

What the number does justify is a **third option the ADR did not consider**: keep the
always-touch guarantee but stop paying per frame for it. `FodMsg::RequestFrames { frames }`
already arrives as a batch and the loop currently calls `send_one_frame` — and therefore
`spawn_blocking` — once per frame in it. One hop covering the whole batch keeps every
fault off the executor while amortising the handoff over N frames. That is neither the
rejected `mincore` gate nor a change of default; it is the same guarantee, bought in
bulk. **Unmeasured** — the harness asks one frame at a time, so testing it needs a
batching client first.

---

## 7 · What the outside evidence says

Every load-bearing claim above, checked against upstream source, kernel documentation, and
published measurement. Two survived unchanged, two needed correcting, one is corroborated
by an independent thesis, and one is contradicted only in a way that turns out to agree.

| claim | external evidence | verdict |
| ----- | ----------------- | ------- |
| quinn's `write_all(&[u8])` copies the payload | `quinn-proto` 0.11.17 `ByteSlice::pop_chunk` = `Bytes::from(data.to_owned())`; `BytesArray::pop_chunk` = `mem::take` | **confirmed, source** |
| The 10-segment cap leaves throughput on the table | ETH Zürich benchmark thesis patched the same constant from 10× to 40× MTU and measured gains "in all test scenarios, up to doubling in the best cases" | **independently confirmed** |
| The cliff is the 65 535-byte GSO limit | Linux caps UDP GSO payload at 65535 − 8 = 65 527 B; quinn issue #2201 derives the same bound from the other side (>1023 B/segment at 64 segments overflows) | **confirmed, kernel + upstream** |
| GSO is worth 3.7× | quiche +19 %, ngtcp2 +33 %, Cloudflare 2.5× `sendmsg`→`sendmmsg`+GSO | **rig-inflated — corrected above** |
| `aws-lc-rs` AEAD is ~1.33× `ring` | rustls benchmarks report 1.26× send / 1.47× receive on bulk AES-128-GCM | **confirmed** |
| Crypto is only ~5 % of server CPU | literature puts crypto at up to 40 % per connection — but *after* kernel bypass, and separately finds user/kernel data copy at ~50 % of protocol CPU | **consistent, see below** |
| quinn's BBR is BBRv1, experimental | `quinn-proto` source: "Experimental! Use at your own risk", ported from quiche's `bbr_sender.cc` (draft-cardwell-iccrg-bbr) | **confirmed, source** |

### The crypto share is not a contradiction

The high-speed-QUIC literature reports crypto becoming *the* bottleneck at up to 40 % of
per-connection CPU, against my 5 %. Both are right, and the difference is the point: those
figures are measured **with kernel bypass (DPDK) already applied**, which removes exactly
the syscall and copy overhead that dominates here. The same body of work independently puts
**user/kernel data copy at ~50 % of protocol CPU** in a normal stack — which is the finding
in §1, arrived at from a different direction.

That ordering is the practical conclusion: **syscall batching and copies first, cipher
last.** Swapping the crypto provider before removing the copies is optimising the 5 %.

### Where the evidence cuts against a first read

- The **3.7× GSO figure was the weakest number in this document** and is now framed as
  rig-specific. It is right about direction and wrong as a portable multiplier.
- quinn issue **#2221** reports a *performance regression* when `MAX_TRANSMIT_SEGMENTS`
  stopped being applied — the opposite sign to "raise the cap". It most likely resolves to
  the same mechanism as the cliff: uncapped segments overflow 65 527 B, `sendmsg` returns
  `EINVAL`, and `quinn-udp` disables offload permanently. **Raising the cap and removing it
  are not the same change**, and the 48-segment arm is what removing it looks like.
- The upstream comment "benchmarks have shown that numbers around 10 are a good compromise"
  is contradicted by two independent measurements now (the thesis and this one). Neither
  reproduces the benchmark behind it; it may have been taken before the byte limit was
  understood, or on hardware where it held.

### Still uncorroborated

The **prefault** result (§6) and the **`send_fairness`** result (§4) have no external
analogue found — the first is specific to this server's design, the second is a quinn knob
with no published measurement. Both rest on this rig alone.

---

## 8 · What this ranks wrong for the actual goal

Recorded after the target was pinned down: **p95 time-to-displayable primary, server CPU
per byte secondary, browser-only client, ~3 concurrent viewers.** Against that, this
document's ordering is wrong in three ways, and the corrected ranking lives in
[`transport-optimization-spec.md`](transport-optimization-spec.md).

1. **It measures the secondary metric.** A saturating harness on loopback produces
   throughput and CPU per byte. It produces no p95 at all (`--mode saturate` yields no
   wait times). Everything ranked #1–#3 in the summary is a *density* result.

2. **At ~3 viewers, density is not the constraint.** Four cores serving three sessions is
   not close to saturated, so the GSO cap and the send-path copies buy headroom rather
   than responsiveness. They are still worth taking; they are not the top of the list.

3. **The knobs that move p95 are exactly the ones this rig could not test.** No RTT axis
   and no loss axis means congestion window, loss recovery and congestion control were
   either untested or tested in the one regime where they cannot matter.

**One conclusion here must be actively un-learned.** Row 9 — "BBR is 4–6 % worse than
Cubic" — was measured on a zero-RTT lossless link with a shallow token bucket. That is the
regime where Cubic is already optimal and where BBR's entire purpose cannot appear. It is
a true statement about this rig and **not** evidence about a browser on a real path. The
congestion-controller question is **open**, not closed.

The same caution applies to every null in §5 involving a *window*: the default
`stream_receive_window` is tuned for 100 Mbps × 100 ms, and finding it makes no difference
at ~0 RTT is not a finding about a WAN. The MTU and socket-buffer nulls are more
trustworthy, because those are CPU-side.

And the largest untested lever is not in this document at all: quinn's default initial
congestion window is 12 000 bytes, so a 250 KB frame spends roughly five RTTs in slow start
before the link is used. See P1 of the spec.

---

## What this does **not** establish

Stated plainly, because the rig's limits are sharp:

1. **No RTT axis and no loss axis.** This kernel (Firecracker, no loadable modules) has
   no `sch_netem`. `htb`/`tbf` give rate only. **Every congestion-control, window, and
   ACK-frequency result here is therefore a result about a zero-RTT lossless link**, which
   is the one regime where those three knobs matter least. The Oracle São Paulo rig in
   `cloud-rig-access.md` has netem and is where these three must be re-run before any of
   them is believed for the WAN.
2. **Loopback is not a NIC.** No driver, no interrupt path, no real segmentation. The GSO
   ratio in particular is a software-segmentation result and the real-NIC number will
   differ.
3. **The TBF shaping is half-rate.** Achieved goodput is a consistent 47.3 % of the
   configured bucket on loopback. Arms are compared at equal *achieved* rate, so the
   comparisons hold; the absolute rate labels do not.
4. **`--mode saturate` yields no p95.** This campaign is throughput and CPU only. It says
   nothing about time-to-displayable, which is the metric the stream-mode decision rule is
   written in.
4b. **No clean server throughput ceiling exists in this data.** Clients and server share
   four cores; see §0. Every throughput figure is a whole-box result. Two machines would
   fix this and nothing short of that will.
5. **Two hosts, mid-campaign.** A Xeon @ 2.10 GHz was replaced by a Xeon @ 2.80 GHz
   partway through. Arms are only ever compared within a table. The AEAD numbers are
   CPU-specific either way — both have VAES and AVX-512, the best case for `aws-lc-rs`
   and therefore the *most generous* setting for the arm that still returned 1 %.
6. **The GSO cliff is MTU-specific.** 45 segments is the ceiling at a 1452-byte MTU; at
   1200 it is 54. Any cap chosen as a constant rather than derived from the MTU is wrong
   at some MTU.

## Reproducing

```bash
bash lab/scripts/gen_tf_fixtures.sh
bash server/scripts/gen_dev_cert.sh
cargo build --release -p exact-server -p window-harness

# single-client, unshaped — reports server AND client cores; if cli_cores nears 1.00
# the throughput number is a client result (see §0)
SRV_FLAGS="--send-path chunked" bash lab/scripts/quic_opt_bench.sh chunked target/release/exact-server frames_250k 16 3

# multi-client — the rig to use for any server-side arm
SRV_FLAGS="--send-path chunked" bash lab/scripts/quic_opt_multiclient.sh chunked target/release/exact-server 4

# rate-shaped (needs iproute2; runs in a private netns; tbf only, no netem)
RATE=1600mbit SRV_FLAGS="--send-path chunked" bash lab/scripts/quic_opt_shaped.sh chunked target/release/exact-server frames_250k 16 3

# GSO segment cap — patches quinn outside the tree, leaves nothing behind
bash lab/scripts/gso_cap_experiment.sh 10 32 44
SRV_FLAGS="--send-path chunked" bash lab/scripts/quic_opt_multiclient.sh seg32 target/gso-arms/exact-server-32 4

# cipher microbench, both providers
cargo run --release -p aead-bench --no-default-features --features ring
cargo run --release -p aead-bench --no-default-features --features aws-lc-rs
```

**Interleave arms within each repeat.** Running one arm to completion and then the next
is how the first pass at §1 got a different answer: the VM was replaced mid-campaign and
the drift landed on one arm. Every table above with tight error bars was interleaved.

`--bind 127.0.0.1` exists on both server and harness because the default bind is
dual-stack and fails with `EAFNOSUPPORT` on a host without an IPv6 stack.
