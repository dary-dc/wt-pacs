# ADR: proving every shown frame exact in production

**Status:** Built, §2 steps 1–3, on by default wherever the series' metadata carries digests · 2026-10-09,
§Built (queue row 88, EXACT). Reporting (§5) stays proposed; the open questions, the owner's calls among them, end §6
and §Built. Proposed 2026-10-07 (queue row 73, EXACTPROD, of [`../av1/queue.md`](../av1/queue.md)); its bench is
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
   byte, so the same bytes come back. What follows a mismatch, with a cache and without, is §8.
4. **Report** each failure at once, and per-path counts of frames checked, as in §5.

Why XXH3 and not a cryptographic hash: the check guards against a decoder, a build or an engine
returning wrong samples — a random fault, against which a 64-bit hash misses one in 2⁶⁴. It cannot
guard against a hostile server, which would send a matching hash with its wrong frame over the same
authenticated session; a cryptographic hash buys nothing there and costs 6–15× more (§3). The sources behind each
step, the probability at world volume and the alternatives are §7.

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
wire is the fill's clock (the total-time measurement's 1× cells, queue row 23,
[`../av1/README.md`](../av1/README.md) §Total time) a
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

## 7 · Why XXH3-64: the sources

*2026-10-10, queue row 122 (HASHWHY). Theory only: from outside sources and §3's measurements, nothing built or timed.*

**In short.** Each frame the viewer shows is hashed and compared with the digest the ingest wrote from the encoder's
input. The check is there to catch a decoder, a browser engine, a processor or a memory that returns wrong samples.
Large operators find such faults in the field, and nothing on the wire can see them: QUIC already authenticates every
byte between the server and the browser. A random wrong frame passes a 64-bit digest about once in 1.8 × 10¹⁹ tries.
If every frame of every medical imaging exam in the world for a year came out wrong, about 10¹⁴, the check would
let one through about once in 180 000 years. XXH3-64 passes the hash test suites wherever its seed is fixed and its
input is long, as ours are. It is 7× faster than BLAKE3 and 16× faster than SHA-256 in the browser (§3). A
cryptographic hash would protect against a hostile server only if the digests were also signed by a key the viewer
trusts, which is a different design. File systems, databases and compressors make the same choice: a fast
non-cryptographic checksum for damage, and a cryptographic hash only where a collision does harm.

**Read.** Each was fetched on 2026-10-10 and pinned by its sha256 (first 12 hex) or its commit:

* RFC 9001, QUIC-TLS (`3bbaecdf5afd`); the W3C Web Cryptography API (`e211cbfe5185`); the WebAssembly SIMD proposal
  (`9c29fd45b95d`).
* xxHash v0.8.3 (`e626a72b`): its README (`750a69246094`) and specification (`61c47af338b2`).
* SMHasher, rurban's fork at `93316446`: its README (`6c9a6b55114f`), `doc/xxh3.txt` (`a80a255ac176`) and
  `KeysetTest.h` (`a54fa1f3bfeb`). SMHasher3 at `3b619371`: its results summary (`062f9ef96b28`) and
  `raw/XXH3-64.txt` (`1d75b391a4bd`).
* Btrfs's *Checksumming* (`8418d6fbffb8`) and *Deduplication* (`4a9721616693`) pages. OpenZFS's *Checksums and
  Their Use in ZFS* (`07b5721e4dd0`). RocksDB at `4b44c2b4`: `include/rocksdb/table.h` (`d512f6fbf0d8`) and
  `HISTORY.md` (`51b303182170`). RFC 8878, Zstandard (`8ee6be035341`). The LZ4 frame format v1.10.0
  (`8c2a10c4b99b`).
* Koopman, "32-bit cyclic redundancy codes for Internet applications", DSN 2002 (`fb143ae1843b`), and his CRC zoo's
  32-bit page (`079e3bc9fe2f`).
* Dixit et al., "Silent data corruptions at scale", arXiv 2102.11245, 2021 (`8cdaf6dcb39c`). Hochschild et al.,
  "Cores that don't count", HotOS 2021 (`482b7318d0ba`). Nightingale, Douceur and Orgovan, "Cycles, cells and
  platters", EuroSys 2011 (`5c06312a0992`). Schroeder, Pinheiro and Weber, "DRAM errors in the wild", SIGMETRICS 2009
  (`f66c2edcb704`).
* UNSCEAR 2020/2021 Report, Volume I, Annex A (`cfced4646561`).
* The READMEs of hash-wasm v4.12.0 (`240e346e626e`), BLAKE3 at `f55849f8` (`129edcd4fe45`) and rapidhash at
  `1ae7842f` (`ea72fbd30295`).

**Not read**, so not cited: NHS England's Diagnostic Imaging Dataset (the host answered 202 with no body, and NHS
Digital 403), so no national figure is given and the world's figure bounds any nation; the xxHash wiki's collision
study (403).

### The threat model

**What the wire already covers.** QUIC protects every 1-RTT packet with the AEAD that TLS negotiated, with a 16-byte
authentication tag (RFC 9001 §5, §5.3). A packet that fails is discarded (§5.5) and its data is sent again, so the
browser receives the bytes the server's QUIC stack encrypted, or nothing. Only Initial and Retry packets lack integrity
protection (§5), and they carry no frame. AES-GCM's forgery limit is 2⁵² invalid packets per key (§6.6). The wire
needs no hash of ours.

**What it cannot cover**, and the check does, is everything before encryption and after decryption: the server's store
and memory, then the client's worker memory, the decoder, the browser engine, the JIT and the processor. Field faults
in these places are measured, not hypothetical:

* Meta found hundreds of CPUs that silently compute wrong results across hundreds of thousands of machines (Dixit et
  al., abstract). Their worked case is a decompression whose size computation returned 0 on one core, so files were
  silently skipped (§3–4).
* Google sees "on the order of a few mercurial cores per several thousand machines" (Hochschild et al., §1).
* Consumer machines usually lack ECC memory. Over 8 months, a PC with 30 days of CPU time had a 1 in 190 chance of a
  crash from a CPU fault, and DRAM faults recur in the same place (Nightingale et al., abstract).
* Even with ECC, more than 8 % of a server fleet's DIMMs see errors in a year (Schroeder et al., abstract).
* In this repository's own benches, a lossless path has come out not exact: libaom 3.8.2's inter 10- and 12-bit
  frames on some content ([`../decode/README.md`](../decode/README.md) §AV1).

These are random faults with respect to the hash: nothing in a broken multiplier or a flipped bit knows XXH3.

**What it does not cover.** The check holds the samples the worker hashed. Painting them is outside it: the GPU, the
grey pipeline and the display. A hostile server is outside it too. It can serve a wrong frame with a digest that
matches, since the digests come from the same server over the same session. To cover that, the ingest would sign each
series's digest list with a site key, and the viewer would check the signature with a public key it trusts from
somewhere other than that server. The digest would then have to resist a crafted second preimage, which XXH3 is not
designed to do (its specification's introduction: "not meant to avoid intentional collisions … or to prevent producing a
message with a predefined digest"). So the frame hash becomes BLAKE3: ×0.28–0.64 of a decode at 1× instead of
×0.04–0.10, and a decode-bound fill ×1.15–1.51 instead of ×1.00–1.15 (§3). There would also be one signature check a
series, plus a key's issue, storage and rotation. This is sketched only, not proposed: today the server is trusted for
the metadata, the page and the code that does the checking.

### The probability

Assume XXH3-64's output acts as a random function of a damaged frame, which is the property the suites below test. A
damaged frame then passes its own digest with probability 2⁻⁶⁴ ≈ 5.4 × 10⁻²⁰.

**There is no birthday bound here.** Each decoded frame is compared with one expected value, its own, so N damaged
frames are N independent tries at 2⁻⁶⁴. The birthday bound, about N²/2⁶⁵ colliding pairs among N digests, applies when
digests are used as identities: deduplication, content addressing, or a cache keyed by digest. At 10¹⁴ frames that is
2.7 × 10⁸ pairs at 64 bits, so **a cache must not use these digests as keys.** At 128 bits it is 1.5 × 10⁻¹¹. The
check also binds each digest to its frame's index ([`../FIXTURES.md`](../FIXTURES.md) §Frame digests). A frame
delivered at the wrong index fails unless its samples equal the right frame's, and then the picture is right anyway.
RocksDB had to add this binding later (below).

**The volume.** Worldwide there are about 4.2 × 10⁹ radiological examinations a year, about 4 × 10⁸ of them CT
(UNSCEAR 2020/2021, Vol. I, Annex A, ¶63 and the summary; MR and ultrasound are not in its count). A screening
tomosynthesis exam is four views of about 60 slices plus 15–26 projections each ([`../av1/series.md`](../av1/series.md)
§1c), so about 300–350 frames. Allowing 10⁴ frames an exam and rounding up for the modalities UNSCEAR leaves out gives
a deliberately high ceiling of **10¹⁴ frames a year** (an assumption, not a source).

**Expected misses a year, at that ceiling:**

* If every frame were damaged: 10¹⁴ × 2⁻⁶⁴ ≈ 5.4 × 10⁻⁶, one miss in about 184 000 years. A real fault rate is many
  orders of magnitude below "every frame".
* With a 32-bit check (CRC-32C, or RocksDB's and zstd's truncated digests): 10¹⁴ × 2⁻³² ≈ 23 000 misses a year if
  every frame were damaged. That is why 32 bits are not used here and 64 bits are enough.

### The hash's quality

* **XXH3's maintainers** state that every xxHash variant passes the original SMHasher, along with newer forks' extended
  tests and their own collision tester at billions of hashes (README, *Quality*). The specification labels it
  non-cryptographic.
* **rurban's SMHasher** (`doc/xxh3.txt`) records no full 64-bit collision in any keyset with a fixed seed. The one
  64-bit failure is *PerlinNoise AV*: 1 260 collisions among 16–38-byte keys, with the seed varied as one of the
  coordinates (`KeysetTest.h`, `PerlinNoiseAV`). The README's other notes on xxh3, *DiffDist bit 7 w. 36 bits, BIC*,
  are biases seen at 32–36-bit truncations of short keys. XXH128 and xxh3's low 32 bits carry no failure note.
* **SMHasher3** fails XXH3-64 on 27 of 250 tests (XXH3-128 on 36; rapidhash and BLAKE3 pass all). Full 64-bit
  collisions appear only in the tests that vary the seed: *Seed Zeroes*, *SeedSparse*, *Seed BlockLength* and *Seed
  BlockOffset*. The fixed-seed failures are biases at 32–40-bit truncations on keys of 3–11 bytes (*BIC*, *Sparse*,
  *Bitflip*).
* **Why none of this applies here.** We hash with the default seed and secret, never varied, and every frame is
  hundreds of kilobytes or more. XXH3 runs a separate algorithm for inputs of 241 bytes and more (specification,
  *XXH3 Algorithm Overview*), a path the
  short-key failures do not test. The weaknesses found are seed-independent collisions and short-key bias. Turning
  either into a missed frame would take inputs chosen against the hash, which is an adversary, not a fault. Even if
  the hash were 2²⁰ times worse than ideal on our inputs, a miss would still be 2⁻⁴⁴ ≈ 6 × 10⁻¹⁴.

### Precedent

* **Btrfs** defaults to CRC-32C. Since kernel 5.5 it also offers xxhash (64-bit XXH64), which "can be used as CRC32C
  successor … good collision resistance and error detection", and SHA-256 or BLAKE2b, which are "cryptographic-strength".
  Its cycles per 4 KiB are CRC-32C 470, XXHASH 870, SHA-256 7 600–78 000, and BLAKE2b 10 000–14 100. Its
  deduplication compares bytes, not checksums.
* **OpenZFS** defaults to `fletcher4`, which it marks not OK for dedup. A deduped dataset uses `sha256` by default,
  with `blake3`, `sha512` and `skein` as the other dedup-safe choices. Edon-R forces byte verification "in an abundance
  of caution".
* **RocksDB** made `kXXH3` its default block checksum in 7.8.0, "because it is faster on common hardware"
  (`HISTORY.md`). Every type stores 32 bits of "checking power (1 in 4B chance of failing to detect random
  corruption)". It found that a block moved within a file, or from another file, passed more often than that, and
  `format_version=6` made the checksum depend on the block's file and offset (`table.h`). Our per-index digest does
  the same thing from the start.
* **Zstandard** has an optional content checksum: the low 4 bytes of XXH64 over the decoded data (RFC 8878 §3.1.1).
* **LZ4's frame format** has xxHash-32 over the decoded data, which "validates … that the encoding/decoding process
  itself generated no distortion". That is this check's own purpose, a decoder's output against its input.

All five use a fast non-cryptographic checksum against random damage. The two that deduplicate keep a cryptographic
hash or a byte comparison for that, which is where the birthday bound applies.

### The alternatives

Speeds are §3's browser-worker figures at 1× where measured, otherwise native and labelled.

* **CRC-32C.** It guarantees detection of every error of up to 3 bits and every burst of up to 32 bits, for data words
  up to 2 147 483 615 bits (≈ 268 MB), and of up to 5 bits for words up to 5 243 bits (Koopman's zoo, `0x8f6e37a0`).
  Any other change passes with probability 2⁻³². The WebAssembly SIMD proposal has no CRC or carry-less multiply
  instruction, so its CRC-32 runs at ≈ 1 500 MB/s against XXH3's 4 000 (§3). It is slower, and half the bits. A
  decoder's or a processor's fault damages whole blocks or frames, not 3 bits, so the burst guarantee buys nothing
  here.
* **CRC-64** (hash-wasm has the ECMA polynomial): 2⁻⁶⁴, with bursts of up to 64 bits guaranteed. It is not timed here,
  and natively its hardware CRC runs at about a quarter of xxh3's speed (SMHasher: `crc64_hw` 5 579 MiB/s, `xxh3`
  20 854).
* **XXH3-128**: 2⁻¹²⁸, at 29.6 GB/s natively against XXH3-64's 31.5 (xxHash README), and in hash-wasm 4.12.0. It is
  not timed in WASM here. It adds 16 hex digits a frame to `metadata.json`, about 16 kB uncompressed for a
  1 000-frame series. It would matter only if the digests became identities (the birthday bound above).
* **BLAKE3**: cryptographic, ≈ 570 MB/s here, 7× XXH3's cost. It is the hash to choose if the signed design above is
  ever wanted.
* **SHA-256 through WebCrypto**: ≈ 250 MB/s here, even on a host with SHA instructions. `digest()` takes a
  `BufferSource`, not shared memory, so it pays a copy first (§3), and it is asynchronous. WebCrypto offers SHA-1,
  -256, -384 and -512 only.
* **rapidhash / wyhash**: rapidhash passes every test in both suites. Natively its bulk speed is 8.8 bytes a cycle
  against XXH3-64's 12.8, while wyhash fails 15 tests (SMHasher3). Neither is in hash-wasm, so it would be a build of
  our own, with a second implementation for the ingest's independent check. What they improve is short-key and
  seeded behaviour, which this job does not use.

**Verdict.** None beats XXH3-64 for this job. CRC-32C is slower in WASM and has too few bits at scale. XXH3-128,
BLAKE3 and SHA-256 cost more and buy protection against a collision or an adversary that the check cannot meet without
signatures anyway. rapidhash would be a new build for no gain on long, unseeded input. The one rule this adds to §2 is
that **these digests are checks, never keys.**

**Proposed, not queued.** Time XXH3-128 and CRC-64 in hash-wasm beside §3's table, by `lab/av1/exact/in-production`'s
harness, only if a 128-bit digest is ever wanted for identity.

## 8 · After a mismatch

*2026-10-10, queue row 123 (MISMATCH). Theory only: from sources and the code as built (§Built), nothing built or
timed.*

**In short.** Today a frame whose digest does not match is decoded once more on the other path. If that one
matches, it is shown; if not, it is delivered marked `false`, and the viewer paints it under a red *NOT EXACT* banner
(`client/viewer/viewer.js`, `repaint`). That is *mark*, where §2.3 recommended *block*; which one is the owner's call
(§Blocked). Four gaps are left. Without a cache, re-fetching never helps, but a digest of the coded bytes would say
whether the store or the decoder is at fault. A frame with no second path (AV1 on WebKit, 12-bit streams, groups)
has no recovery. Reporting is not built, and as written in §5 it would carry an identifier that DICOM's
de-identification profile replaces. A cache, when there is one, must hold only verified frames and must be able to
check them again.

**Read**, fetched 2026-10-10, sha256 (first 12 hex) or commit:

* DICOM PS3.3 2026d §C.7.6.1 (`8d7d584b8f88`) and PS3.15 2026d Annex E (`cb214710fce7`).
* The ACR–AAPM–SIIM *Technical Standard for Electronic Practice of Medical Imaging*, revised 2022, amended 2023
  (`382d1bf36947`), and the *Practice Parameter for Determinants of Image Quality in Mammography* (`1e4481e5b9a1`).
* FDA, *Content of Premarket Submissions for Device Software Functions*, 2023-06-14 (`dee0c15e1149`).
* Cornerstone3D v5.11.7 (`50f7341e`): `StackViewport.ts` (`811ca9da7ddf`). OHIF v3.13.12 (`e844561f`): the
  cornerstone extension's `init.tsx` (`2fb3454afaac`) and `ViewportImageSliceLoadingIndicator.tsx` (`dc1ac63f8ac8`).
* Orthanc 1.12.9: `OrthancRestResources.cpp` (`ca36396fda51`) and `Configuration.json` (`8c9905fdfe95`).
* dcm4chee-arc-light 5.35.1 (`674a8642`): `StorageDescriptor.java` (`9839554b566c`) and
  `StorageVerificationPolicy.java` (`01422946599c`).

**Not read**, so not cited: IEC 62304, IEC 82304-1 and ISO 14971, which are sold, not published (iso.org answered
403); the FDA's 2000 guidance on medical image management devices, which the ACR standard cites for the display label
(its link gave no PDF); and HHS's de-identification guidance (403).

### Locating the fault

A mismatch means one of two things: the coded bytes the decoder was given are wrong, or the decode of right bytes is
wrong. Today the ladder tries the second (a second decode) and cannot tell the first apart.

* **Without a cache, the coded bytes can only be wrong at the server.** QUIC delivers the server's bytes or nothing
  (§7). Damage in the store or in the server's memory comes back the same on every fetch, so §2.3's "asking again does
  not help" holds. The archives make the same choice and check their store on the server: Orthanc stores an MD5
  per file "to detect disk corruption" (`StoreMD5ForAttachments`, on by default) and verifies it on demand
  (`/attachments/{name}/verify-md5`). dcm4chee keeps a digest per stored object (`StorageDescriptor.digestAlgorithm`)
  and offers `OBJECT_CHECKSUM` as a storage verification policy.
* **A digest of the coded bytes**, written by the ingest beside the samples' digest, would tell the two cases apart:
  if the coded bytes match, the decoder is at fault; if they don't, the store is. Hashed only after a mismatch, it
  costs the client nothing on the common path, because the wire bytes are still in the worker when `checked` runs. It
  adds 16 hex digits a frame to the metadata and one XXH3 a frame at ingest. It changes the store's content, so it is
  structural (§2.1): proposed, not built. Without a cache it only *names* the fault, for the report and the operator.
  A server that checks its own store on read, or in a scrub as the archives do, finds the same damage without any
  client.

### A client cache

None exists: the cache seam is open ([`../ARCHITECTURE.md`](../ARCHITECTURE.md), §A cache seam and a paint sink).
When one is built:

* **Never cache an unverified frame.** Store a frame only once its check is `true`, never `false` or `"unchecked"`.
  A frame rescued by a second decode is stored as its coded bytes, which were right.
* **Store what is needed to check it again on read:** the coded bytes, the frame's sample digest and the metadata's
  version. The version is needed because a check against newer metadata would wrongly fail an old entry. The key is
  the series, the frame index and that version, never a digest (§7: digests are checks, not keys).
* **On read**, the decode's own check re-verifies the entry at no extra cost. A mismatch on a cached frame then runs
  this ladder: second decode; if that fails, evict the entry and fetch the frame again (here asking again *does*
  help); if the fresh copy passes, the cache was damaged. With a coded-bytes digest, the cache case is found before
  any second decode.
* Caching decoded samples instead would take their full size rather than the coded size, and would be re-checked
  by one XXH3 on read.

### Block or mark

**What the standards say.**

* DICOM records lossy compression permanently: once Lossy Image Compression (0028,2110) is "01" it "shall not be
  reset" (PS3.3 §C.7.6.1.1.5).
* The display requirement comes from the FDA, as the ACR states it: "when an image is displayed it be labeled with a
  message stating if irreversible compression has been applied", along with the ratio and the method. The ACR adds
  that a display should indicate "prior application of irreversible compression ratio, processing, or cropping"
  (Technical Standard, §III.B and §III.D).
* For mammography the FDA "does not allow irreversible compression … for retention, transmission, or final
  interpretation", priors for comparison excepted (both ACR documents).
* None of these sources covers a frame whose fidelity is *unknown*, which is what a mismatch is. The nearest case is
  lossy compression of unknown degree. That is labelled everywhere and excluded from reading mammograms.
* The FDA asks for Enhanced Documentation where a software failure "could present a hazardous situation with a
  probable risk of death or serious injury … prior to implementation of risk control measures" (the 2023 guidance,
  §V). A wrong but plausible frame in a diagnostic read is such a hazard. The check is a risk control, and so is the
  response to a mismatch.

**What open viewers do with a frame that fails to decode.** None checks decoded samples against a digest, so a wrong
decode that does not throw is drawn. When a decode does throw:

* Cornerstone3D draws only on success; on failure it raises `IMAGE_LOAD_ERROR` and leaves the viewport's index
  unchanged (`StackViewport.ts`).
* OHIF lays a half-opaque veil over the viewport with "Error Loading Image" and the error text
  (`ViewportImageSliceLoadingIndicator.tsx`), and passes the error to its HTTP error handler (`init.tsx`).
* Orthanc answers 415 for an instance it cannot decode, or redirects to an `unsupported.png` placeholder when asked
  (`returnUnsupportedImage`).

So all three block: none draws the pixels of a frame that failed.

**The options, for the owner:**

* **Mark** (today): the pixels are drawn under a banner. The reader sees the frame, and the banner can be missed, or
  ignored once it has been seen often. Measurements and window/level work on possibly wrong values.
* **Block**: a placeholder that names the failure, and no pixels, as the open viewers do on a decode error. The
  reader loses that frame and steps on. It is safe, and a whole series failing on one path still shows nothing.
* **Block, with an explicit reveal**: the placeholder, plus an action that shows the pixels under a mark that stays
  for as long as they are on screen, with measurement off. The reader can still look, and does so knowingly.

The sources lean towards *block* by default for anything read for diagnosis: mammography forbids even known lossy
frames for final reading. Whether a reveal exists is a product decision, not a technical one.

### Frames with no second path

* **A frame inside a group (G > 1)** cannot be decoded alone on the other path (`av1.js`: "a frame inside a group
  decodes on its group's decoder alone"). Recovering it means decoding its group again from the key frame on the
  other decoder, up to G decodes for the last frame. The product codes G = 1 ([`../av1/README.md`](../av1/README.md)
  §Frame groups), so nothing needs building until a G > 1 series ships.
* **A 12-bit stream, or AV1 on an engine whose WebCodecs refuses the payload** (Firefox here; WebKit takes only 8-bit
  4:2:0, [`../av1/queue.md`](../av1/queue.md) §Blocked) has one AV1 decoder. That is every AV1 frame on an iPhone.
  The cheapest fallback is the one HTJ2K already uses: a fresh instance of the same decoder. It catches a corrupted
  state but not a deterministic decoder or engine bug. A frame that still fails is a frame to block. Neither the
  fallback nor its cost is measured.

### Reporting

§5's design checked against what it needs:

* **Privacy.** §5 reports a "series key". If that is a Series or Study Instance UID, it is one of the identifiers
  DICOM's Basic Application Level Confidentiality Profile replaces (`U`, PS3.15 Table E.1-1). The report should carry
  an opaque key the server issued for the session, which the server alone maps back. Engine, version, decoder path,
  codec string and both digests carry no patient data. Pixels never leave the device.
* **The denominator.** The counts per path and engine (`stats().exact`) give the rate. A path whose second decode
  rescued frames (`mismatchOn`) is the faulty path; a frame both paths failed points at the bytes, or at both.
* **Turning a path off per engine.** A correct decoder fails no frame, so there is no "acceptable" rate to estimate.
  A proposed rule: one rescued mismatch puts the path on that engine's major version in front of the owner, and
  rescued mismatches from two distinct sessions turn it off for that engine version, through the metadata or the
  configuration the server sends. The thresholds are the owner's.
* **Phones** send at `visibilitychange` (§5). Nothing here depends on the series being closed.

### The fault bench, run 2026-10-11

*Queue row 145 (FAULTBENCH).* One fault on frame 2 of a six-frame series, through the real server, the product's
downloader and its `decoder.js` unchanged; the fault lives in the harness, which wraps the codec modules
([`../../lab/faultbench`](../../lab/faultbench/README.md)). HTJ2K: six copies of the contract's `grey-16` frame; AV1: the
optimized golden payloads `g8 g10 s11 s13 c8 g9`, digests from Python's `xxhash`. Headless Chromium 141 and Firefox
157.0.1, one visit per cell; the control (no fault) delivered 6/6 exact in every cell. *Sample* flips one byte of the
first decode's output; *always* flips it on every decode; *truncate* gives the decoder half the frame's coded bytes on
every decode (a store that serves a short frame with a matching length); *hang* never returns from frame 2's decode.

| fault | HTJ2K (both engines) | AV1, dav1d-WASM (Chromium with WebCodecs taken away; all of Firefox) | AV1, WebCodecs (Chromium) |
| --- | --- | --- | --- |
| sample | caught; a fresh object decodes it again: **exact, shown** | caught; **no second path** ("no WebCodecs decoder"): **marked false, shown** | caught; dav1d-WASM decodes it again: **exact, shown** |
| always | caught; second decode wrong too: **marked false, shown** | **marked false, shown** | caught, dav1d wrong too: **marked false, shown** |
| truncate | OpenJPH decodes the short codestream without error; caught: **marked false, shown** | refused before decode, "av1 payload: frame 0 overruns the payload": **failed by name**, not shown | as dav1d |
| hang | **never arrives, no failure**; frame 5, queued behind it on the same decoder, never arrives either | the same | the same |

*Marked false, shown* is §8's *mark*: the viewer draws the pixels under the red *NOT EXACT* banner with the reason;
*failed by name* reaches the viewer's `onError` and its status line, with nothing drawn. Every frame not faulted was
exact wherever it arrived, in all 30 visits. **What it adds to §8:** a transient fault in dav1d-WASM is not rescued — the AV1 ladder's only
second path is the other decoder, so on Firefox and WebKit, where WebCodecs refuses these payloads, a decoder fault
that a fresh instance would clear is shown marked; HTJ2K's fresh object rescues the same fault. A truncated HTJ2K
codestream is not an error to OpenJPH, so only the digest stands between it and a silent wrong frame. A decode that
never returns is invisible to the check and to the page and takes the frames queued behind it on its decoder (row 144
lists the missing deadline). Not run: WebKit (none in a container).

**Proposed, not queued:** a fault-injection bench that flips samples in each path on each engine (Chromium, Firefox,
WebKit) and records which rung of the ladder catches it and what it costs; the server's own check of each frame's
coded bytes on read, timed against today's send path (queue row 51's harness); and the report endpoint, once the
owner's choices below are made.

## Built · 2026-10-09

*Queue row 88, EXACT.*

**What.** §2's steps 1–3, as the client README's *A frame is checked against its digest* describes them:

* `ingest/coded-frames/ingest.py` writes `digests` into `metadata.json`
  ([`../FIXTURES.md`](../FIXTURES.md) §Frame digests), from the samples its `.sha256` was written from.
* The decoder worker loads hash-wasm 4.12.0's XXH3 build (`client/decode/wasm/fetch_xxh3.sh`) when `connect` is given
  `digests`, and checks every frame before it is posted.
* A mismatch is decoded once more: an AV1 payload by the other AV1 decoder, an HTJ2K codestream by a fresh decoder
  object, since the reused one is the suspect.
* The frame carries `exact` (`true`, `false` or `"unchecked"`), `path`, `mismatchOn` when a second decode
  rescued it and, when false, `reason`. `stats().exact` counts them per path.

§2.3's "the viewport shows the frame as failed" is left to the page: the frame is delivered, marked `false`.

**What it does not cover.** A second decode of an AV1 frame inside a group (G > 1) on the other decoder has no
reference frames, so it fails and the frame stays `false`: the check still holds, but there is no recovery. A
payload with a 12-bit stream has no other AV1 decoder in any engine, and neither has any payload in an engine whose
WebCodecs refuses it (Firefox here), so the second decode fails by name. HTJ2K always has its fresh object.

**Held by.** `aFrameSaysWhetherItIsExact` (HTJ2K) and `anAv1FrameIsCheckedAgainstItsDigest` in
`client/contract/dispatch-rig.ts`, with `client/decode/av1.test.mjs`. Their digests were written by Python's `xxhash`,
an implementation independent of the browser's (`NAME.xxh3` beside each golden payload). They check:

* every golden AV1 shape and all 90 matrix payloads (8–16 bits, every split, both signs), and the two HTJ2K contract
  frames, `true`;
* a frame without a digest `"unchecked"`;
* one sample changed in the reused HTJ2K object's output (`flip-glue.js`), or in WebCodecs' (`webcodecs-spy.js?mode=flip`),
  `true` after the second decode;
* digests that match nothing, `false`, with both decodes named.

Mutants, each caught:

* `verify` always true;
* a frame with no digest `true`;
* no second decode;
* the HTJ2K second decode on the reused object;
* the AV1 one through WebCodecs again;
* the ingest digest big-endian: 80 of 90 matrix frames `false`, every two-byte one;
* the ingest digest zero-extended from 13 bits instead of sign-extended: 40 of 90 `false`, every signed two-byte one.

Chromium 141: 766 of 766 rig checks on the merged code. Firefox 157.0.1 (`client/contract/run_firefox.sh`): 13 of 13, with OpenJPH and
dav1d-WASM frames `true`; its WebCodecs took none of these payloads, so that path is unverified there.

**Cost through the product, measured.** The fill through the downloader, check off (`htj2k`) against on
(`check`): the four series of §3 as the served HTJ2K, behind the relay on the total-time measurement's (queue row
23) r20000, r50000 and wifi-home links, at 1× and 4×. Headless Chromium 141 on cores 0–2, 3 decoders, 14 rounds interleaved by `lab/order.mjs`
(the last 4 on r20000 and wifi-home only). The harness is
[`lab/av1/delivery/total-time`](../../lab/av1/delivery/total-time/README.md) §Row EXACT.

All 13 528 delivered frames matched their sha256, and every `check` frame was `true` (6 764/6 764). 184 of 608
visits were `VOID` and are dropped. The table gives the fill on, ÷ off, as the median of paired rounds with its
range:

| series | r20000 1× | r50000 1× | wifi-home 1× | r20000 4× | r50000 4× | wifi-home 4× |
| --- | --- | --- | --- | --- | --- | --- |
| MR 512², 58 frames | ×1.001 [1.000–1.001] | ×1.002 [0.999–1.006] | ×1.003 [0.998–1.008] | ×0.998 [0.995–1.000] | ×1.002 [0.992–1.025] | ×1.002 [0.944–1.368] |
| fluoroscopy 768², 18 | ×1.001 [0.998–1.002] | ×1.000 [0.978–1.006] | ×0.999 [0.932–1.039] | ×1.001 [0.999–1.012] | ×0.998 [0.988–1.019] | ×0.945 [0.514–1.086] |
| projections 1914×2572, 9 | ×0.999 (1 pair) | ×0.998 [0.988–1.007] | ×0.991 [0.938–1.109] | ×0.996 [0.993–1.009] | ×1.002 [0.980–1.017] | ×0.968 [0.802–1.017] |
| mammogram 2560×3328, 4 | ×1.001 [0.996–1.005] | ×1.011 [0.992–1.051] | ×1.005 [0.982–1.388] | ×1.006 [0.985–1.025] | ×1.013 [0.942–1.077] | ×1.006 [0.944–1.227] |

The pairs per cell are 1–10: kept visits run 5–12 a variant, and n ≥ 10 kept is not met on every cell. The first
picture moves ×0.945–1.097 (medians), its pairs' ranges covering 1 on every cell but the MR on r50000 at 1× (×1.055 [1.008–1.086]: one hash on the first frame).

**The check costs the fill nothing measurable at 1× or 4×.** Every median is within ×0.94–1.02, and every cell's
range covers 1. The largest is the mammogram on r50000: ×1.011 at 1× (slower in 8 of 10 pairs, about 24 ms of
2.2 s) and ×1.013 at 4×, against §3's decode-bound ×1.09.

Here the wire is the clock: on these links the decoders' idle time absorbs the hash, as §3 predicted. A link
faster than 50 Mbit/s, or a phone, would move toward §3's decode-bound ×1.00–1.15. That is not measured. The host
has 4 cores, browser on 3, so nothing past 3 decoders is claimed.

The dropped links, r5000 and lte-good, are wire-bound at 5–20 s a frame on the projections. They could only
hide a check further, so they were not run.

**All five of the total-time measurement's links, measured since** (the other build's session, `lab/av1/exact/checked`). The same
pair, `htj2k` against `chk` (its frames with the ingest's digests), on r5000, r20000, lte-good, wifi-home and
r50000 at 1× and 4×, 10 rounds each, the projections as `dbtproj_c` (9 × 1914×2294, 14-bit: `dbtproj_ge` answered
404 from the bucket). 17 800/17 800 frames matched their sha256 and 8 900/8 900 `chk` frames were `true`. On this
host the relay's guard voided 569 of 800 visits (its p99 1–2 ms against the 1 ms bar, on every link but r50000), so
the table pairs every visit, `VOID` included: both arms ran on the same link in the same round. Fill on ÷ off,
median of 10 pairs:

| series | r5000 1× / 4× | r20000 | lte-good | wifi-home | r50000 |
| --- | --- | --- | --- | --- | --- |
| MR | ×1.000 / ×1.000 | ×1.000 / ×1.000 | ×1.003 / ×0.999 | ×1.036 / ×0.997 | ×1.001 / ×1.003 |
| fluoroscopy | ×1.000 / ×1.001 | ×1.000 / ×1.003 | ×1.000 / ×1.000 | ×1.008 / ×1.002 | ×0.998 / ×0.997 |
| projections | ×1.000 / ×1.001 | ×1.000 / ×0.999 | ×1.000 / ×0.998 | ×0.981 / ×0.983 | ×1.001 / ×1.005 |
| mammogram | ×1.001 / ×1.002 | ×1.000 / ×1.018 | ×0.999 / ×1.009 | ×0.996 / ×1.088 | ×1.014 / ×1.025 |

Every cell's range covers 1. The mammogram at 4× leans slower on the faster links: r20000 ×1.018 [0.96–1.03],
9 of 10 pairs slower; r50000 ×1.025 [0.97–1.11], 7 of 10; wifi-home ×1.088 [0.93–2.10], whose step trace spreads
every cell's pairs (×0.62–2.10). The first picture moves ×0.98–1.09. The
kept visits alone agree where they are many (r50000, n = 5–9 a cell: ×0.992–1.019). So r5000 and LTE hide the
check entirely, as predicted; the mammogram at 4× on the faster links is the one place it shows, 2–3 %, well
inside the rule's 15 %. Through every decoder path on r50000 at 1×, one round, every frame `true`: Chromium
`htj2k` 89, `av1-webcodecs` 80, `av1-dav1d` 98, `av1-mixed` 9 (the projections' 12-bit top through dav1d, its low
through WebCodecs); Firefox 157.0.1 `htj2k` 89, `av1-dav1d` 187 (its WebCodecs refused every grey payload). The
ingest digest mutated big-endian turned every frame `false`, the first 4 of MR and of CT on both codecs (16 of 16);
masked to 12 bits in place of sign-extended, all 8 of CT's (every frame has negative samples) and none of MR's (none
has).

Two sessions built this row at once. The timed build was the first one (`a784b62`), and the merged code is the
other's (`29c9361`). The work per frame is the same in both: one XXH3 over the frame's shared buffer, in the decoder
worker, before it is posted.

**Adopted** by the row's rule: the 1× fill stays within its spread, and 4× moves ≤ 15 %. The check is on wherever
`connect` is given the digests. Open: phones; Firefox's and WebKit's WebCodecs paths; reporting (§5); and whether a
page shows a `false` frame (§2.3, the owner's).

