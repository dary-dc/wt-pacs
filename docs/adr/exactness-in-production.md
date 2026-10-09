# ADR: proving every shown frame exact in production

**Status:** Proposed · 2026-10-07 · nothing built in the product; the owner decides. Queue row 73
(EXACTPROD) of [`../av1/queue.md`](../av1/queue.md); the bench is
[`lab/av1/exact/in-production`](../../lab/av1/exact/in-production/README.md).

## 1 · Today

*Corrected from the row's brief*, which describes another codebase: **in this repository the ingest
writes no per-frame hash, the store (SBND) carries none, and the product client checks nothing.**
The lab alone checks: every bench holds decoded samples to the `NNN.sha256` written from the
encoder's input when a series is fetched or generated ([`../decode/README.md`](../decode/README.md)
§Ground truth), and the WebCodecs path probes one tiny unit per layout with FNV-1a before trusting a
decoder ([`../decode/README.md`](../decode/README.md) §AV1). There is no BLAKE3 and no SHA-256
fallback at ingest, so the defect the brief names (a fallback that fails every client check) does
not exist here and nothing was fixed. What follows proposes the check from nothing.

## 2 · Recommendation

1. **Ingest** hashes each frame's stored samples (little-endian, the bytes `decodeFrame` hands on)
   with **XXH3-64** and writes the 16 hex digits per frame into the series's metadata — a change to
   the store's content, so structural; the bundle's metadata is JSON, so the binary format and the
   wire are unchanged.
2. **The decoder worker** hashes every frame **before it is handed on**, against that digest. No
   sampling: at ≤ 10 % of a decode it is cheaper to check everything than to reason about what a
   sample missed.
3. **On a mismatch**, the frame is not shown as exact: it is decoded once more on the other path
   (AV1 through WebCodecs → dav1d-WASM; HTJ2K in a fresh decoder instance, there being one HTJ2K
   decoder), and shown only if that passes; otherwise the viewport shows the frame as failed, never
   its pixels as if they were right. Asking the server again does not help: QUIC authenticates every
   byte, so the same bytes come back.
4. **Report** each failure at once, and per-path counts of frames checked, as in §5.

Why XXH3 and not a cryptographic hash: the check guards against a decoder, a build or an engine
returning wrong samples — a random fault, against which a 64-bit hash misses one in 2⁶⁴. It cannot
guard against a hostile server, which would send a matching hash with its wrong frame over the same
authenticated session; a cryptographic hash buys nothing there and costs 6–15× more (§3).

## 3 · What a check costs, measured

Headless Chromium 141, one decoder worker as the product runs it (OpenJPH 2.4.11 package, samples in
a `SharedArrayBuffer`), 10 rounds Williams-ordered, a fresh browser each, 4 cores; 4× is
`cpu_throttle.mjs`. Every digest of every frame matched an independent hasher over the encoder's
input, 1 110/1 110 hashes a throttle and 2 880/2 880 pool checks; `--mutate` failed every cell. Median ms a frame, then ×
that frame's decode paired by round:

| frame | MB | decode 1× / 4× | SHA-256 WebCrypto | SHA-256 WASM | BLAKE3 WASM | **XXH3 WASM** | CRC-32 WASM |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| MR 512², 16-bit | 0.52 | 3.1 / 14.6 | 1.7 ×0.54 / 7.9 ×0.54 | 2.0 ×0.66 / 10.3 ×0.72 | 0.85 ×0.28 / 1.5 ×0.11 | **0.12 ×0.04 / 0.15 ×0.01** | 0.33 ×0.10 / 0.37 ×0.03 |
| fluoroscopy 768², 12-bit | 1.18 | 5.9 / 26.6 | 4.5 ×0.77 / 20.2 ×0.74 | 4.7 ×0.79 / 20.0 ×0.72 | 2.1 ×0.34 / 10.1 ×0.38 | **0.27 ×0.04 / 0.39 ×0.02** | 0.78 ×0.13 / 0.96 ×0.03 |
| projections 1914×2572, 14-bit | 9.85 | 55 / 246 | 40 ×0.71 / 165 ×0.66 | 39 ×0.72 / 166 ×0.68 | 17 ×0.32 / 75 ×0.30 | **2.8 ×0.05 / 13.6 ×0.06** | 6.9 ×0.13 / 30 ×0.12 |
| mammogram 2560×3328, 12-bit | 17.0 | 47 / 210 | 68 ×1.44 / 290 ×1.37 | 68 ×1.44 / 290 ×1.37 | 30 ×0.64 / 124 ×0.60 | **4.7 ×0.10 / 21 ×0.10** | 12 ×0.27 / 53 ×0.25 |
| 4096×3328, 8-bit (bytes only) | 13.6 | — | 55 / 230 | 56 / 237 | 25 / 102 | **3.1 / 16** | 8.9 / 40 |
| 4096×3328, 16-bit (bytes only) | 27.3 | — | 109 / 459 | 111 / 462 | 50 / 203 | **6.5 / 34** | 18 / 85 |

At 1×: SHA-256 ≈ 250 MB/s either way, BLAKE3 ≈ 570, CRC-32 ≈ 1 500, XXH3 ≈ 4 000; 4× divides each by
about 4. **WebCrypto's native SHA-256 is no faster than WASM's here, on a host with SHA instructions**
(Xeon with `sha_ni`), and it refuses a view of shared memory, so it pays a copy out first; whether a
phone's is faster is not measured. A 512² frame at 4× takes under the throttle's 4 ms period and runs
unthrottled: its 4× cells (and the MR's sub-ms hash cells) are not slowed figures, and no claim is
made from them.

**The fill and the first picture.** Three decoder workers take a series' frames 24 times over as
fast as they finish, each checked before it is handed on (n = 10 each, × unchecked paired by round):

| series | XXH3 first / fill, 1× | 4× | BLAKE3 1× | 4× | SHA-256 WebCrypto 1× | 4× |
| --- | --- | --- | --- | --- | --- | --- |
| MR | ×1.09 / ×1.15 | ×1.13 / ×1.05 | ×1.34 / ×1.19 | ×1.47 / ×1.23 | ×1.21 / ×1.27 | ×1.27 / ×1.24 |
| fluoroscopy | ×0.94 / ×1.00 | ×1.04 / ×1.06 | ×1.04 / ×1.15 | ×1.30 / ×1.29 | ×1.10 / ×1.41 | ×1.30 / ×1.50 |
| projections | ×1.02 / ×1.01 | ×1.07 / ×1.05 | ×1.16 / ×1.20 | ×1.13 / ×1.26 | ×1.33 / ×1.49 | ×1.42 / ×1.56 |
| mammogram | ×1.12 / ×1.09 | ×1.06 / ×1.09 | ×1.35 / ×1.49 | ×1.27 / ×1.51 | ×1.53 / ×2.08 | ×1.77 / ×2.23 |

**An XXH3 check before paint costs 0–15 % of a decode-bound fill and of the first picture; SHA-256
up to double the fill on a mammogram.** These are the fill's decode side alone, no wire: where the
wire is the fill's clock (row 23's 1× cells, [`../av1/README.md`](../av1/README.md) §Total time) a
check that fits the decoders' idle time costs the fill nothing, and the first picture still pays one
hash. The MR's sub-100-ms fills carry the most noise (ranges overlap); the host has 4 cores and the
pool 3 decoders plus the page, so nothing past 3 parallel decoders is claimed.

## 4 · The options, weighed

* **Where.** In the decoder worker: only the client can act before a wrong picture is seen, and the
  worker already holds the samples, off the page's thread. The server can only record after the fact.
* **Before or after paint.** Before: one hash (§3, ≤ 5 ms at 1× on a mammogram) added to the first
  picture, and no wrong pixel ever reaches the screen. After paint saves that and paints a frame it
  may then withdraw; for diagnostic display that is the worse trade.
* **On a mismatch.** Decode again on the other path (catches an engine's or a decoder's fault, which
  is what the check exists for); ask again (useless, §2); mark (honest, but shows wrong pixels);
  block (safe). Recommended: the second decode, then block, as §2.
* **Sampling** — every combination checked fully the first time, then a rate — saves at most XXH3's
  1–10 % and lets a fault in an unsampled frame through. Not recommended at these costs; it would be
  if only a cryptographic hash were allowed.
* **The hash.** XXH3-64 (§2). BLAKE3 if a cryptographic hash is required anyway: 2.3× cheaper than
  SHA-256 in WASM here. SHA-256 through WebCrypto has no advantage measured and needs the copy.
  A hash inside the decoder's own WASM, over its heap before the copy out, would save the read of
  shared memory; not built.

## 5 · Reporting and persistence (proposed, not measured)

* **A failure, at once:** series key, frame index, codec, decoder path (`htj2k`, `av1-dav1d`,
  `av1-webcodecs`), WebCodecs codec string, engine and version, `navigator.hardwareConcurrency`,
  expected and actual digest, whether the second decode passed. No pixels, which are patient data,
  and no identifier the session does not already use.
* **Counts:** frames checked and failed per decoder path, so a failure rate has a denominator.
* **Transport:** `fetch(…, { keepalive: true })` at once for a failure, counts flushed with
  `navigator.sendBeacon` on `visibilitychange` to hidden — phones do not reliably fire anything at
  series close. A report over the WebTransport session would be a wire change; an HTTP endpoint
  beside the series's is not.
* **Server:** append-only, one record per failure and per flush, keyed by engine × decoder path, so
  a path that fails on one engine can be turned off for it.

## 6 · What adopting it takes

The XXH3 digest at ingest (both codecs, the AV1 payload's samples after its split is undone), the
metadata field, a WASM hasher in the decoder worker (hash-wasm's XXH3 or a build of
our own), the second-decode path, the endpoint. HTJ2K's codestreams and the wire are unchanged.
Open: phones' hash speed; the owner's choice of block against mark; whether the endpoint lives in
the server or the deployment beside it.
