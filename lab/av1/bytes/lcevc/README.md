# lcevc

Row LCEVC's answer: whether MPEG-5 Part 2 (LCEVC) can carry a lossy AV1 base plus an enhancement
that ends **exact**, and whether this project could ship it. The verdict lives in
[`../../../../docs/av1/README.md`](../../../../docs/av1/README.md) §A5, the licences in
[`../../../../docs/av1/licensing.md`](../../../../docs/av1/licensing.md); this says how it was found.
**No trial ran**: there is no open encoder to make a stream with (below).

```bash
python3 lab/av1/bytes/lcevc/reach.py   # ~10 s, exits 1 if a result moves
```

## Sources, pinned

Read, not built or run (the container refused to build the decoder):

| project | version | commit | read for |
| --- | --- | --- | --- |
| LCEVCdec (the decoder SDK) | 4.2.2 | `17804ac54db8fbb42717f3275b1e73f3c0b067d3` | licence, transforms, dequantisation, the add |
| LCEVCdecJS (the web decoder) | 1.3.0 | `50e4f35c7d82b1b1a9cca434ccca544622f38e11` | licence, how it renders |

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
  not freely available.
* **The browser decoder is not an exact path.** LCEVCdecJS uploads the base from a `<video>`
  element as an 8-bit RGBA WebGL texture, applies residuals in shaders and draws to a canvas: no
  samples come back, and nothing above 8 bits or outside the browser's colour conversion survives.
  LCEVCdec's own WASM wrapper says it is "not complete yet".
* **No patent grant** comes with either decoder (below), unlike AV1's royalty-free licence.
