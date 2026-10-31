# lcevc

Row LCEVC's answer: whether MPEG-5 Part 2 (LCEVC) can carry a lossy AV1 base plus an enhancement
that ends **exact**, and whether this project could ship it. The verdict lives in
[`../../../../docs/av1/README.md`](../../../../docs/av1/README.md) §Preview, the licences in
[`../../../../docs/av1/licensing.md`](../../../../docs/av1/licensing.md); this says how it was found.
**No trial ran.** *Corrected 2026-10-31:* this first said there is no open encoder to make a stream
with; MPEG's own reference encoder is free to download under BSD (§Re-checked 2026-10-31).

```bash
python3 lab/av1/bytes/lcevc/reach.py   # ~10 s, exits 1 if a result moves
```

## Sources, pinned

Read, not built or run (the container refused to build the decoder):

| project | version | commit | read for |
| --- | --- | --- | --- |
| LCEVCdec (the decoder SDK) | 4.2.2 | `17804ac54db8fbb42717f3275b1e73f3c0b067d3` | licence, transforms, dequantisation, the add |
| LCEVCdecJS (the web decoder) | 1.3.0 | `50e4f35c7d82b1b1a9cca434ccca544622f38e11` | licence, how it renders |
| LCEVCdec | 4.3.1 (2026-10-27) | `e295d8438ba554bc541fb269baa9cbd567b626a8` | the re-check: the nine files below are byte-identical to 4.2.2's |
| LTM, the MPEG-5 Part 2 test model (ISO/IEC 23094-3 Amd 1 electronic insert) | 5.5 (`LTM_v5_5.zip`, 2024-09-09) | SHA-256 `62f2cfab…0fe360b` | the re-check: licence, the encoder, the decoder's fixed point |

SHA-256 of the files read:

```
7eae3ef5bdd383367ec9c1ce08020aec7aa224d8ccdcb9449ccb036d899928a4  LCEVCdec src/enhancement/src/transform.c
da716acd38328c42b513bb00dced743faae8aaab4acbb283aa8b95d050724ed4  LCEVCdec src/enhancement/src/dequant.c
1e8dbea07e9414fc7446c316af139e69cb8ffbcc9c1ad7da9dce50b77e0b378f  LCEVCdec src/common/include/LCEVC/common/limit.h
c0ffcab0ee9e74aa9be6bd0ecb2bb08d65e945b2e16ab000bf29e9fcc0e6b64e  LCEVCdec src/pixel_processing/src/apply_cmdbuffer_scalar.c
24d57d1cb083924d1835e71f5d985cde30c339662fbe01dec3d04fd93c8d59a0  LCEVCdec src/enhancement/include/LCEVC/enhancement/bitstream_types.h
14358b0ecf6e7036c211c10f0f25563c94483dee7b8c7c954e09e10f3771d0af  LCEVCdec LICENSE.md
3afa5369b4fb44e18280b6e0e275971f78bc6eaf5f53553f41f2483fd8b1267e  LCEVCdec COPYING
37fabc479a9ad9855b21494d9fc3574e95c7478a61bb43166dd2cc2634eb1c25  LCEVCdecJS LICENSE
a2d12e4c1bf215204d8504578009975b3969768504a8fc7a0b6aa4f31da1dfb3  LCEVCdecJS src/queue/queue.js
```

## What the decoder does to a residual

* **Dequantisation is the identity at step width 1.** The step width is clamped to 1…32767
  (`QMinStepWidth`), and at a master step width ≤ 16 the dead zone is `sw >> 1` = 0, so a
  coefficient at step width 1 is the coded integer.
* **The inverse transforms are unnormalised Hadamards.** 2×2 (`DD`): r = H c with H the 4×4
  ±1 Hadamard, H·H = 4I. 4×4 (`DDS`): H ⊗ H, (H ⊗ H)² = 16I. The 1D-scaling variants use other ±1
  matrices with the same normaliser. So the residuals a block can take are the lattice M·Z^n, which
  holds N·Z^n with N = 4 (`DD`) or 16 (`DDS`) and nothing finer in general.
* **Residuals are added below a sample.** A pixel is lifted to a signed fixed point with f fraction
  bits — S8.7, S10.5, S12.3, S14.1 at 8, 10, 12 and 14 bits — the residual added, and the sum
  rounded back: out = p + ⌊(r + 2^(f−1)) / 2^f⌋. **14 bits is the deepest** the decoder takes;
  there is no 16-bit path.

So a sample offset d is reachable when some lattice point falls in the box 2^f·d ± 2^(f−1). With
2^f ≥ N every box of side 2^f holds a point of N·Z^n, so every offset is reachable.

Whether those fixed-point formats are what ISO/IEC 23094-2 itself specifies, or this decoder's
choice, is **not confirmed**: the standard is not freely available and was not read.
*Updated 2026-10-31:* MPEG's reference decoder (LTM 5.5) uses the same shifts, 7/5/3/1 at 8/10/12/14
bits, and adds every residual before a single rounding out (`decoder/src/Convert.cpp:105–121`,
`decoder/src/Decoder.cpp:304, 364, 426–429, 482`) — two implementations, one of them the conformance
reference, so the formats are *derived* to be the standard's; the text itself is still unread.

## Result (`reach.py`)

| depth | fraction bits | 2×2 (`DD`) | 4×4 (`DDS`) |
| --- | --- | --- | --- |
| 8 | 7 | every offset (2^f ≥ 4) | every offset (2^f ≥ 16) |
| 10 | 5 | every offset | every offset |
| 12 | 3 | every offset: 256/256 classes, exhaustive | **not proven**: 4 named patterns and 32/32 random ones reachable |
| 14 | 1 | **128/256 classes unreachable** — a single +1 in a block, `(0,0,0,1)` | **unreachable**: one sample +1, two samples +1 |

The same holds for the 1D-scaling `DD`. So an exact enhancement is possible in principle at 8 to 12
bits, with step width 1 and no dithering, and impossible in general at 14 — where this project's
13-bit CT and cone-beam would have to go. A 2×2 block at 14 bits cannot move one sample by one.

## The checks were mutated

Each mutation ran on a copy; the script's own check (expected counts) caught six of seven:

| mutation | caught by |
| --- | --- |
| one sign of H transcribed wrong | `DD` 14-bit: 0 unreachable, expected 128 |
| rounding box twice too wide (`DD`) | `DD`, `DD1D` 14-bit |
| 14 bits given 2 fraction bits | `DD`, `DD1D` 14-bit |
| `DDS` row filter V ≡ 0 mod 16 | `DDS` 12-bit one sample, random 2/32 |
| `DDS` rounding box twice too wide | `DDS` 14-bit one sample reachable |
| `DDS` match off by one | three `DDS` cases |
| `DDS` row filter V ≡ 0 mod 8 | **not caught**: no tested pattern needs a row with V ≢ 0 mod 8 |

## Why no trial

* **No encoder.** No LCEVC encoder under an open licence was found; the licensor's encoder is a
  commercial SDK. A trial would mean writing an encoder for the bitstream from the standard, which is
  not freely available. **Wrong, corrected 2026-10-31:** the MPEG reference software (LTM) carries an
  encoder under BSD and has been a free download from ISO since 2022 (below); it was not looked for.
* **The browser decoder is not an exact path.** LCEVCdecJS uploads the base from a `<video>`
  element as an 8-bit RGBA WebGL texture, applies residuals in shaders and draws to a canvas: no
  samples come back, and nothing above 8 bits or outside the browser's colour conversion survives.
  LCEVCdec's own WASM wrapper says it is "not complete yet".
* **No patent grant** comes with either decoder (below), unlike AV1's royalty-free licence.

## Re-checked 2026-10-31

The owner asked again, for lossless breast cine-like series (DBT slices, ultrasound cine, ABUS; 8–12
bits; bit-exact). Read, not built or run. Each claim: a source, or *derived*, or *unverified*.

**1. An open encoder — changed.** MPEG's reference software ships an encoder and is a free download:
ISO/IEC 23094-3 [ed-1 insert](https://standards.iso.org/iso-iec/23094/-3/ed-1/en/ReferenceSoftwareLTM/)
(`lcevc_test_model.zip`, LTM 4.1.3, 2022-09-14) and its
[Amd 1 insert](https://standards.iso.org/iso-iec/23094/-3/ed-1/en/amd/1/ReferenceSoftwareLTM/)
(`LTM_v5_5.zip`, 2024-09-09). Its `COPYING` (identical in both):

> The copyright in this software is being made available under the BSD License, included below. This
> software may be subject to other third party and contributor rights, including patent rights, and no such rights are granted

The ISO portal adds that inserts are used "in their original format without any modifications for the
purposes specified"; which governs a modified build is *unverified*. Its limits, from source (LTM 5.5,
the last resort): bases are AVC, HEVC, EVC or VVC elementary streams — the encoder opens the base as
one (`encoder/src/FileEncoder.cpp:358`) and has no YUV-base path (no `BaseCoding_YUV` under
`encoder/`), while the decoder takes a prepared YUV base (`src/ModelDecoderApp.cpp:200`). So **no AV1
base without a patch**. Its forward 2×2 transform truncates, `( … ) / 4`
(`encoder/src/TransformDD.cpp:65–69`), so at step width 1 it does not pick an exact residual
(*derived*). Step widths: "range: [1, 32767]" in the code (`src/ModelEncoderApp.cpp:164–165`),
"[4, 32767]" in its manual — they disagree; *unverified* until built. Formats `y`, `y10`, `y12`, `y14`
are offered, though its README says "either 8 bpp or 10 bpp". The licensor's encoder SDK is still
commercial, and LCEVCdec still says nothing of an encoder.

**2. A lossless mode or profile — unchanged.** The one amendment is "Amendment 1: Additional levels"
([ISO/IEC 23094-2:2021/Amd 1:2024](https://committee.iso.org/standard/86436.html), published 2024-01-22);
no second edition was found. MPEG's
[white paper](https://www.lcevc.org/wp-content/uploads/Whitepaper-on-Low-Complexity-Enhancement-Video-Coding-LCEVC-MPEG-meeting-137-January-2022.pdf)
(SC 29/AG 3 N0058, 2022-01-23) claims reach, not a mode:

> offering an efficient method of encoding residual data and providing up to mathematically
> lossless picture reconstruction.

It names no bit depth; the 14-bit result above stands against it for a base at the output size (a
base upsampled to fractional values was not modelled).

**3. Decoders that return samples — unchanged.** LCEVCdecJS is still 1.3.0 at the same commit
(`50e4f35`, its HEAD on 2026-10-31). LCEVCdec 4.3.0 (2026-10-14) and 4.3.1 (2026-10-27) are Vulkan,
Android and RISC-V work; their notes name no WASM, encoder or lossless change
([releases](https://github.com/v-novaltd/LCEVCdec/releases)), and the WASM wrapper still reads "The WASM
port of `enhancement` and `pixel_processing` functions is not complete yet" (`wrappers/wasm/README.md:3`,
4.3.1). No browser decodes LCEVC natively: at W3C's Media & Entertainment IG
([2025-11-10](https://www.w3.org/2025/11/10-me-minutes.html)) the licensor asked for a native path, the
chair answered "this group can't work on specifications, we have to focus on use cases", and WebKit's
"support in hardware is generally a requirement for us". No WebCodecs path exists (*unverified* beyond
those minutes).

**4. Licence and patents — clarified, no pool.** The licensor licenses alone, not through a pool, in
two programmes. [Video distribution](https://v-nova.com/licensing-lcevc-vdlp/):

> The Video Distribution Licensing Program grants a single, convenient license to patents essential
> to MPEG-5 LCEVC

— royalties by tier, $0 up to 1.14M monthly active video users, "Royalties for free-to-air
broadcasting are waived", early-adopter rates before 31 December 2026.
[Consumer devices](https://v-nova.com/licensing-lcevc-dlp/): "A royalty is due upon the sale of a
Consumer Device implementing MPEG-5 LCEVC" ($0.20–0.70 a unit). Whether a PACS viewer is a "Video
Distribution Service", defined as "any branded media & entertainment service", is *unverified*:
the owner would ask licensing@v-nova.com. Row 19's "royalty-bearing per service, unconfirmed" is now
confirmed from the licensor's own pages.

**5. Published lossless or medical results — none found.** Searches for LCEVC with lossless, medical,
ultrasound, tomosynthesis or radiology found no paper; the nearest is the white paper's claim above.

**6. AV1 base + LCEVC exact end to end — *derived*, not run.**

* The base is any decoded picture: the reference decoder takes a YUV base as is. An AV1 decoder's
  output is fixed by the AV1 specification (*unverified* here, not re-read), so exactness rests on
  the enhancement alone.
* Every residual — sub-layer 1, sub-layer 2, the temporal buffer — is added in the S*n*.*f* domain
  before one rounding (`Decoder.cpp` above); sums of lattice points stay on the lattice, so the
  reach table above holds with temporal prediction and both sub-layers.
* So, with the base at the output size, step width 1, no dithering, and an encoder that solves for
  coefficients rather than truncating: **exact at 8 and 10 bits** with either transform, **at 12 bits
  with the 2×2**, the 4×4 at 12 not proven, **not at 14**.
* The base may be shallower than the output — LCEVC encodes "a lower resolution (and potentially also
  lower bit depth) version" (white paper) and LTM shifts between them (`Convert.cpp:141`) — so a
  12-bit series could take a 10-bit AV1 base, which WebCodecs decodes exactly (row 13). *Derived*.
* Nothing returns exact samples in a browser (3), so "end to end" means natively, today.

### Verdict

**A trial is possible now, natively and offline, for exactness and bytes** — an open encoder exists —
but not with the encoder as shipped: it needs two patches (a YUV base, and exact coefficients at step
width 1). It is **not a product path**: no browser decoder returns samples, and the patents are
royalty-bearing under terms that may or may not reach a PACS.

### Protocol, pre-registered for a separate session

1. Pin `LTM_v5_5.zip` (SHA-256 `62f2cfab386d4ece281ff2f57ab72f5e162f23333469926a37aedc0df0fe360b`),
   LCEVCdec 4.3.1 (`e295d84`), the lab's libaom and dav1d (`lab/av1/tools/tools.sh`). Build natively.
2. Patch the LTM encoder, smallest diff, kept as a file: P1 a `yuv` base read from a decoded
   AV1 file with the enhancement as its own elementary stream; P2 at step width 1, 2×2 transform,
   choose integer coefficients whose inverse lands each sample's box (`reach.py`'s construction), and
   fail loudly where none exists.
3. Series: `dbts_a1` (12-bit DBT slices), `dbt10_ea1141` (10-bit), one plane of `us_liver` (8-bit
   cine; no open breast cine exists, `docs/FIXTURES.md`). The base: AV1 lossy at the output size at
   two quality points; for the 12-bit series also a 10-bit base.
4. Exact means every frame byte-identical to the source **from both decoders**, LTM's and LCEVCdec's;
   a disagreement between them is a finding, not a retry.
5. Predicted before running: exact at 8, 10 and 12 with the 2×2; P2 never fails at those depths.
6. Bytes: base + enhancement against single-layer lossless AV1 and HTJ2K of the same frames (bytes are
   deterministic; no timing claimed). Gain only if smaller than lossless HTJ2K.
7. Mutate: one coefficient ±1, and P2 replaced by LTM's truncation — exactness must fail in both.
8. Stop at the first hard no and record it here.
