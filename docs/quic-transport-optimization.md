# QUIC transport optimisation — research and measurement

**2026-09-05 · T2** (single-host loopback + TBF shaping in a private netns).
Raw data: [`measurements/quic-opt/`](measurements/quic-opt/). Rig:
[`lab/scripts/quic_opt_bench.sh`](../lab/scripts/quic_opt_bench.sh) (unshaped),
[`lab/scripts/quic_opt_shaped.sh`](../lab/scripts/quic_opt_shaped.sh) (rate-shaped),
[`lab/aead-bench`](../lab/aead-bench) (cipher microbench).

Prompted by a generic "make QUIC faster" checklist. Two thirds of it turned out to be
**already on by default** in `quinn`, and the item with the biggest headline number is
the one we were already getting for free. The one real win was not on the list.

---

## Summary

| # | Change | Effect | Status |
| - | ------ | ------ | ------ |
| 1 | **Chunked send path** — `Bytes` slice of the mapping + `write_all_chunks` | **+15…20 % throughput** at 250 KB frames above ~1.4 Gbps; **−6…−17 % server CPU per byte at every rate** | **Adopted as default** |
| 2 | UDP GSO | **3.7×** at 250 KB, **1.8×** at 32 KB | Already on — quinn default |
| 3 | DPLMTUD (RFC 8899) | no measurable effect on this path | Already on — quinn default |
| 4 | `aws-lc-rs` instead of `ring` | +1–2 % end to end (AEAD itself is 1.33× faster) | Opt-in feature, **not** default |
| 5 | `send_fairness(false)` | +11.8 % for **per-frame** mode at D=4; nil for shared | Exposed, default unchanged |
| 6 | ACK frequency extension | +2.7 % at 250 KB, nil at 32 KB | Exposed, default off |
| 7 | BBR instead of Cubic | **−4…−6 % throughput, up to 2× CPU** | Exposed, default Cubic |
| 8 | Flow-control windows, socket buffers, `initial_mtu` | **nil, all of them** | Left at quinn defaults |

Everything is a runtime flag on `exact-server`, so any of these is one process restart
away from being re-measured. Unset means "quinn's own default", so an arm that changes
nothing measures nothing.

---

## 1 · The send path — the actual win

### What was there

Per frame, the server made **two full-frame copies**:

```rust
let payload = wrap(idx, bytes);        // 1. alloc + copy the whole frame
uni.write_all(&payload).await?;        // 2. quinn copies it again
```

The second one is not obvious from the signature. `wtransport::SendStream::write_all`
takes `&[u8]`, which reaches `quinn_proto`'s `ByteSlice::pop_chunk`:

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

### The knee

`docs/send-path-copy-costs.md` asked for exactly this sweep — *"the rate at which copies
stop being noise"* — and predicted the shape from arithmetic. Measured, `frames_250k`,
D=16, mean of 3:

| link rate | copy | chunked | throughput Δ | CPU/GB Δ |
| --------- | ---- | ------- | ------------ | -------- |
| 189 Mbps | 188.8 | 189.0 | +0.1 % | **−12.5 %** |
| 378 Mbps | 377.7 | 376.8 | −0.2 % | −5.9 % |
| 755 Mbps | 755.2 | 755.4 | +0.0 % | **−13.9 %** |
| 1.5 Gbps | 1440.9 | 1506.7 | **+4.6 %** | −7.6 % |
| 1.76 Gbps | 1602.7 | 1755.7 | **+9.5 %** | −10.0 % |
| unshaped | 1585.2 | **1904.9** | **+20.2 %** | **−17.1 %** |
| unshaped, replicated | 1633.6 | **1884.3** | **+15.4 %** | **−15.1 %** |

**The knee is ~1.4 Gbps.** Below it the link is the bottleneck and the copies are free;
above it they *are* the bottleneck. That is the document's arithmetic, confirmed.

The unshaped cell was re-run after the code was refactored, as arms `R_copy` /
`R_chunked`: chunked reproduced to 1 % (1904.9 → 1884.3), the copy arm drifted 3 %
faster, and the gap came out +15.4 % rather than +20.2 %. **Quote this as +15–20 %, not
+20 %** — within a campaign the spread is 1–3 %, but across campaigns the copy arm is
the noisier of the two.

Two things it also says that the arithmetic did not:

- **The CPU saving is there at every rate**, including rates where throughput is
  identical. A browser on a 200 Mbps link gets its frames no sooner — but the server
  spends 12 % less CPU delivering them, which is server density, not client latency.
- **Frame size decides it, not just link rate.** At 32 KB frames the gain is +0.6 %
  (inside noise). Per-frame fixed costs dominate there; the copy is a rounding error.

### One correction to `send-path-copy-costs.md`

That document lists as a hard ceiling: *"`wtransport` has no chunk write … on any
browser-facing path this copy is not removable without upstream work in `wtransport`."*
**That is no longer true.** `wtransport` 0.7.2 exposes `quic_stream_mut()`, which hands
back the underlying `quinn::SendStream` and with it `write_all_chunks`. No upstream work
was needed and the browser path is unaffected, because the bytes on the wire are the
same. Its other ceiling — that QUIC cannot use kernel zero-copy, so "zero-copy" means
*one* copy — still stands.

---

## 2 · GSO — the big number, already collected

Turning segmentation offload **off** is the largest single effect measured anywhere in
this campaign:

| fixture | GSO on | GSO off | | CPU/GB on | CPU/GB off |
| ------- | ------ | ------- | - | --------- | ---------- |
| 250 KB | 1904.9 | **514.4** | **3.7×** | 2.90 | 10.71 |
| 32 KB | 6352.3 | **3547.6** | **1.8×** | 5.14 | 12.35 |

`quinn` sets `enable_segmentation_offload: true` by default and `quinn-udp` probes
`UDP_SEGMENT` support at socket creation; GRO is enabled opportunistically on the
receive path the same way. So the checklist's "2–3× throughput, ~50 % less CPU" is real
and we already had it — this run only proves we still have it. The flag exists so the
control can be re-run, **not** because anyone should turn it off.

One upstream limit worth knowing: `quinn` caps a GSO batch at
`MAX_TRANSMIT_SEGMENTS = 10` (~14.5 KB per `sendmsg` at a 1452-byte MTU) even though the
kernel allows 64. Raising it would need a patched `quinn`; unmeasured.

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
5. **One host, one CPU model.** The AEAD numbers especially are CPU-specific — this Xeon
   has VAES and AVX-512, which is the best case for `aws-lc-rs` and therefore the *most
   generous* setting for the arm that still only returned 1 %.

## Reproducing

```bash
bash lab/scripts/gen_tf_fixtures.sh
bash server/scripts/gen_dev_cert.sh
cargo build --release -p exact-server -p window-harness

# unshaped arms (CPU-bound regime)
SRV_FLAGS="--send-path copy"    bash lab/scripts/quic_opt_bench.sh copy    target/release/exact-server frames_250k 4,16 3
SRV_FLAGS="--send-path chunked" bash lab/scripts/quic_opt_bench.sh chunked target/release/exact-server frames_250k 4,16 3

# rate-shaped arms (needs iproute2; runs in a private netns)
RATE=1600mbit SRV_FLAGS="--send-path chunked" bash lab/scripts/quic_opt_shaped.sh chunked target/release/exact-server frames_250k 16 3

# cipher microbench, both providers
cargo run --release -p aead-bench --no-default-features --features ring
cargo run --release -p aead-bench --no-default-features --features aws-lc-rs
```

`--bind 127.0.0.1` exists on both server and harness because the default bind is
dual-stack and fails with `EAFNOSUPPORT` on a host without an IPv6 stack.
