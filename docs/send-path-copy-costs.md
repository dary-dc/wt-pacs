# Send-path copy costs, and where zero-copy stops

**2026-08-28 · T1, arithmetic and source-read. Nothing measured.**

> ## Superseded in part, 2026-09-05 — see [`quic-transport-optimization.md`](quic-transport-optimization.md)
>
> The arithmetic below held up. Two things changed:
>
> - **Ceiling 1 is gone.** `wtransport` 0.7.2 exposes `quic_stream_mut()`, which returns
>   the underlying `quinn::SendStream` and with it `write_all_chunks`. The chunk write is
>   reachable from the browser-facing path today, with no upstream work. Both full-frame
>   copies are now removed on `main`; the wire is byte-identical.
> - **The open question at the bottom is answered.** The knee is **~1.4 Gbps** for 250 KB
>   frames. Below it throughput is identical and the copies cost only CPU (−6…−17 % per
>   byte, at every rate); above it they cost throughput too (+20 % unshaped). At 32 KB
>   frames the gain is inside noise at every rate — **frame size decides this, not link
>   rate alone**, which the table below does not capture.
>
> Ceiling 2 — QUIC cannot use kernel zero-copy, so "zero-copy" means *one* copy — stands.

Recorded so nobody re-derives it. The short version: **on a slow link the copies are invisible; on a
fast one they are the thing you are measuring.** The usual "it's just a memcpy" dismissal is only
correct in one regime, and we work in both.

---

## What it costs

A copy costs a fixed amount per byte. Transmission costs less as the link gets faster. So the ratio
moves entirely with link rate:

| link | 250 KB frame send | one 250 KB memcpy (~10 GB/s) | copy as % of frame time |
| --- | --- | --- | --- |
| 10 Mbit | 200 ms | 25 µs | **0.01%** |
| 1 Gbit | 2 ms | 25 µs | **1.2%** |
| 10 Gbit | 200 µs | 25 µs | **12.5%** |

Quoting the first row as if it settled the question is the mistake to avoid. It settles the browser /
WAN case only.

---

## Where the copies are

**Ours — building a contiguous buffer.** Any scheme that prepends bytes to a payload held in a
read-only memory map forces an allocation and a full-frame copy: you cannot write in front of a
mapped page. Carrying the identifier in a header field instead leaves the payload untouched, and
`FrameStore` can then hand out `Bytes` pointing straight at the mapping:

```rust
// bytes 1.12.1: Bytes::from_owner<T: AsRef<[u8]> + Send + 'static>
// memmap2::Mmap implements AsRef<[u8]> — no wrapper type needed.
all: Bytes,                                 // built once at open
fn frame_bytes(&self, i: u32) -> Bytes {
    self.all.slice(offset..offset + len)    // refcount bump, no copy
}
```

**Not ours — the send buffer.** `write_all` copies because QUIC must retain bytes for
retransmission.

---

## Two hard ceilings

**1. ~~`wtransport` has no chunk write.~~ — wrong, see the banner.** `quinn` can take ownership of a
`Bytes` without copying — `write_chunk(Bytes)`, `write_all_chunks(&mut [Bytes])`. `wtransport::SendStream`
exposes only `write` and `write_all` over `&[u8]` — **but also `quic_stream_mut()`, which hands back the
`quinn::SendStream` underneath**. The chunk API was reachable all along; nobody looked.

**2. QUIC cannot use kernel zero-copy at all.** No `sendfile`, no splice: QUIC encrypts in userspace,
so the kernel never sees plaintext to hand to the NIC. TCP + kTLS can go further; QUIC cannot,
absent NIC offload. **"Zero-copy" here means one copy, not zero.** Worth knowing before anyone
chases a number that does not exist.

---

## Position

**Superseded.** Both copies are gone on `main` (`--send-path chunked`, the default). The position
below was written when the chunk API was believed unreachable.

~~Do not chase copies for the browser path. Remove the avoidable one when touching the wire for another
reason, not as a standalone task.~~

For a native or LAN path the conclusion is different and **unmeasured**. A native client is not
browser-constrained, so `quinn`'s chunk API is available, and there is no JS heap to copy into on
receive — two of the copies disappear by construction.

**Done, 2026-09-05.** The sweep asked for here is
[`measurements/quic-opt/copy_knee.tsv`](measurements/quic-opt/copy_knee.tsv); the threshold is
~1.4 Gbps at 250 KB frames. The native/LAN case the paragraph above calls unmeasured is still
unmeasured — but it is now the *smaller* remaining gap, because the browser path turned out not to
be constrained after all.
