# Send-path copy costs, and where zero-copy stops

**2026-08-28 · T1, arithmetic and source-read. Nothing measured.**

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

**1. `wtransport` has no chunk write.** `quinn` can take ownership of a `Bytes` without copying —
`write_chunk(Bytes)`, `write_all_chunks(&mut [Bytes])`. `wtransport::SendStream` exposes only
`write` and `write_all` over `&[u8]`. Browsers can speak only WebTransport, so on any browser-facing
path this copy is not removable without upstream work in `wtransport`.

**2. QUIC cannot use kernel zero-copy at all.** No `sendfile`, no splice: QUIC encrypts in userspace,
so the kernel never sees plaintext to hand to the NIC. TCP + kTLS can go further; QUIC cannot,
absent NIC offload. **"Zero-copy" here means one copy, not zero.** Worth knowing before anyone
chases a number that does not exist.

---

## Position

Do not chase copies for the browser path. Remove the avoidable one when touching the wire for another
reason, not as a standalone task.

For a native or LAN path the conclusion is different and **unmeasured**. A native client is not
browser-constrained, so `quinn`'s chunk API is available, and there is no JS heap to copy into on
receive — two of the copies disappear by construction.

**Open, cheap, and worth doing before anyone argues about this again:** sweep link rate against
per-frame copy time and find the knee — the rate at which copies stop being noise. An afternoon on
existing hardware, and it converts this document from arithmetic into a threshold.
