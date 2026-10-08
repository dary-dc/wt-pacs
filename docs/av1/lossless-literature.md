# Lossless medical image coding, 2023–2026, and what runs in a browser (row 58 LITERATURE)

The lab compared the codecs it knew: HTJ2K (the product's), AV1, JPEG 2000 Part 1 and JPEG XL (rows 6, 22, 28).
This file asks what has been published since 2023 that could beat them, and whether a browser could decode it today.
Web research only, 2026-10-06, no measurement. Each claim cites its source and the source's date. **Unconfirmed**
marks a claim that rests on a search summary or secondary text, where the primary source was not read. The bit
split and the alternatives above 12 bits are in [`split-prior-art.md`](split-prior-art.md) and are not repeated here.

Ratios against HTJ2K below are this file's arithmetic on the sources' own tables. A ratio against HTJ2K that goes
through JPEG 2000 Part 1 (×1.05, the slides in §1) is an **inference** and is marked as one.

## 1. Standards: the codecs did not change, DICOM did

* **HTJ2K** (ISO/IEC 15444-15 | ITU-T T.814) is still its 2019 first edition, confirmed at systematic review
  (stage 90.60; jpeg.org work plan, read 2026-10-06). **JPEG-LS** (14495-1:1999, -2:2003) likewise has no new edition.
* **DICOM added three lossless transfer syntaxes**: HTJ2K, Sup 235 (final text 2023-11-14, `.4.201`–`.203`);
  JPEG XL, Sup 232 (final text 2024-09-18, `.4.110` lossless); and **Deflated Image Frame**, Sup 244 (first in 2025a,
  `1.2.840.10008.1.2.8.1`). Sup 244 is DEFLATE on each frame alone, with no limit on pixel attributes. It targets
  1-bit segmentations, and it says zstd and the like "do slightly better than Deflate", but not by enough to justify
  them. A browser inflates it natively (`DecompressionStream("deflate-raw")`). It is therefore the standard's own
  form of row 36's deflated low bits.
* **HTJ2K costs about 5 % over JPEG 2000 Part 1** in bytes ("~5 %", WG-04's Sup 235 slides, Wallace and Hafey). That is
  advocacy, not a study. The one independent table (§3, Tomoz README) gives 4.5–6.8 %.
* **AVIF 1.2** (AOM, 2025-12-09) adds *Sample Transform* derived items: a 16-bit image rebuilt from a 12-bit and an
  8-bit AV1 item. That is a standard container for a bit split like the lab's. Its example is 10 % under 16-bit PNG
  on non-medical content. No browser's native AVIF decoder was found documenting support (**unconfirmed**).
* Out of scope: **JPEG AI** (ISO/IEC 6048-1:2025) is learned and lossy, and no lossless mode was found
  (**unconfirmed** absence). **JPEG XS** has a lossless profile but no browser decoder. WebP lossless is 8-bit
  (RFC 9649, 2024-11).

## 2. Standard codecs measured on medical data since 2023

No paper since 2023 measures HTJ2K and JPEG XL side by side on medical data under control. The tables that exist are
baselines in learned-codec papers, plus one industry white paper.

**16-bit CT and MR volumes, bits a voxel** (BD-LVIC, Wang et al., IEEE TIP 34:113, 2024-12, arXiv:2410.17814 v1,
Table III; read):

| codec | Heart-MRI | Chaos-CT | Covid-CT | Trabit-MRI |
| --- | --- | --- | --- | --- |
| JPEG-LS | 11.049 | 7.383 | 5.019 | 2.224 |
| JPEG 2000 | 11.436 | 6.872 | 5.318 | 2.579 |
| JPEG XL | 9.592 | 6.257 | 4.773 | 2.102 |
| HEVC RExt intra | 11.608 | 6.721 | 5.183 | 2.281 |
| HEVC RExt, slices as video | 10.507 | 5.931 | 5.144 | 2.124 |
| VVC, slices as video | — | 6.293 | 5.284 | 2.392 |
| JP3D | 10.221 | 5.624 | 5.272 | 2.324 |
| BD-LVIC (learned, §3) | 8.842 | 5.012 | 4.421 | 1.856 |

* **JPEG XL is the smallest standard intra codec on all four**: 0.85–0.95 of JPEG-LS and 0.82–0.91 of JPEG 2000.
  Inferred against HTJ2K, it is about 0.78–0.87. The lab measured 0.83–0.95 of HTJ2K (rows 6, 22).
* **Coding slices as video helps on the 5 mm CT (Chaos: HEVC 0.88 of its intra) and little elsewhere.** On
  breast tomosynthesis, JPEG 2000 Part 2 across slices gained 3 % over single frames (Clunie, RSNA 2012,
  25 DBT objects, slides read). That predates the window, and it agrees with what the lab measured on four DBT volumes
  (rows 10, 46: libaom only, alt-ref off, G = 8 and 16 alone in row 46); row 21's projections are outside the target series.
* Decode a 512² slice, i9-10900K: JPEG-LS 0.067 s, JPEG XL 0.120 s, HEVC 0.024 s (Table V). A second paper on the
  same machine gives JPEG-LS 0.02 s and JPEG XL 0.05 s (TCT, §3, Table VI). The two disagree by 2–3×, so neither is
  a speed claim to carry here.

**JPEG XL against HTJ2K on 16-bit CT and mammograms** (an industry white paper by a CPU vendor and an imaging
vendor, 2024-05; read). The images are four signed 16-bit frames: a 512² CT, two mammograms and a 2000×4164
radiograph. libjxl effort 3 against OpenJPH. JPEG XL's bytes are **0.78 (CT), 0.93 and 0.88 (the mammograms), 0.95
(radiograph) of HTJ2K's**. JPEG XL took 98–746 ms to decode against HTJ2K's 11–145 ms, but the two were timed on
different machines, so no speed ratio follows. It recommends HTJ2K for latency. It also says H.264/H.265 lossless
compete only with 16-bit samples split into MSB and LSB planes.

**Breast imaging: a gap.** No paper from 2020–2026 reports lossless HTJ2K, JPEG XL, learned or video-codec ratios on
FFDM, synthesized 2D, DBT slices or projections, or breast ultrasound. The white paper's two mammograms are the only
data point. The newest controlled breast numbers are Clunie's 2012 DBT set: JPEG-LS 4.97 and JPEG 2000 4.89 (ratio
against 16-bit words), and inter-slice JPEG 2000 5.07. **Rows 46 and 45 hold more breast measurements than the
literature.**

**Implementations since 2023:**

* **OpenJPH** reached 0.32.0 (2026-09-17). Its 0.28.0 notes claim 1.17–1.29× faster decode from AVX2 block-coder
  work, with no CPU stated. Those are native x86 numbers, and WASM SIMD-128 is not AVX2.
* **libjxl 0.12.0** (2026-07-01) claims a "major overhaul for faster decoding": lossless at faster-decoding levels
  1–4 is 30–80 % smaller than before, and modular decode is up to 4× faster. These are general-content claims.
  Row 63 measures them.
* **jxl-rs** is the decoder Chromium and Firefox adopted (v0.7.4, 2026-09-17). Its README says its speed "closely
  matches" libjxl's, with no numbers given.
* **CharLS** 2.4.3–2.4.4 (2026) are fixes only. Mapping tables (Part 2) are in an unreleased 3.0.
* **OpenHTJ2K** v0.19 (2026-05) adds WASM SIMD pack paths. The lab benched it against OpenJPH, and OpenJPH won 40/40
  rounds ([`decode/README.md`](../decode/README.md) §A second decoder, measured).
* **No new HT block-decoding paper since 2023**, on CPU or GPU, was found. The GPU line is still Naman and
  Taubman, ICIP 2019 and 2020. No WebGPU decoder for JPEG 2000 or HTJ2K was found, as paper or repository (row 62
  asks).

## 3. Learned and context-model coders since 2023

| method | source | gain, on what | decode | browser |
| --- | --- | --- | --- | --- |
| **TCT**, tri-plane context trees learned per volume, tANS, no DNN | Bai et al., IEEE TIP, doi:10.1109/TIP.2026.3696120, arXiv:2608.13897, 2026-08-14 (read) | **0.90, 0.97, 0.88 of JPEG XL** on Chaos and MosMedData CT and Trabit MR (16-bit); 0.96 on 8-bit MRNet | 0.05 s a slice, CPU (i9-10900K), equal to JPEG XL there; serial in raster order; encode 0.18–7.24 s | integer lookups and tANS, so deterministic in WASM by construction; **no code released** |
| **Tomoz**, integer network, 3D prediction, range coding | GitHub README, Apache-2.0, undated, 99 commits (read 2026-10-06); **not peer reviewed** | bits a voxel on 37 TCIA series: CT 4.17, MR 5.05, PET 3.22. That is **0.82, 0.85, 0.73 of HTJ2K** and 0.95, 0.97, 0.89 of JPEG XL. Self-reported; 2-D radiographs and mammograms only "on par with JPEG XL (±1 %)" | 10.1 MB/s on one Neoverse-N1 core, against JPEG XL's 24 MB/s there | **WASM build on npm; claims byte-identical output across platforms.** The only learned lossless codec found that runs in a browser today |
| **SR-LVC**, gated recurrent CNN, 4 866 parameters | Chen and Chen, arXiv:2311.16200, 2023-11 | 0.82 of JPEG 2000 on 12-bit CHAOS CT, 0.85 on 12-bit DeepLesion | 0.086 s a slice, CPU (the figure stated for encode); 0.026 s on an FPGA | small enough for WASM; fixed point plausible (it runs on an FPGA); code cited, URL not seen |
| **BD-LVIC**, MSB volume through a standard codec, LSB through a learned model | Wang et al., TIP 2024-12 (read, §2) | 0.80–0.93 of JPEG XL (16-bit, table in §2); about 11.7 % on average | 0.65 s a 512² slice, RTX 3090; 5.6 M parameters | float network on a GPU; no code |
| **BCM-Net**, a lossy video base plus a learned residual | IEEE TIP 33, 2024 (venue **unconfirmed**) | 0.99 of JPEG XL on MosMedData, 0.88 on Trabit (TCT's Table V) | 2.82 s a slice, GPU | not plausible |
| **LVPNet** | Song et al., MICCAI 2025, arXiv:2506.17983 | 2.65 against JPEG XL 2.93 bpp on ChestX-ray8 (8-bit) | 184 ms, RTX 3060 | float; code on GitHub |
| **FNLIC**, per-image fitted latent plus a light prior | Zhang, Chen, Liu, CVPR 2025 (read) | ≈ JPEG XL on Kodak (2.88 against 2.87), 0.95 on histology | 13 ms GPU, 221 ms CPU (768×512); encode ~100 min | the README warns that "bitstreams may not be decoded correctly on your device" |
| ArIB-BPS, DLPR, P²-LLM, LLM coders | CVPR 2024; arXiv:2209.04847; NeurIPS 2025, arXiv:2411.12448; Delétang et al., ICLR 2024 | 1–10 % under JPEG XL on 8-bit RGB | 1.8 s (DLPR, GPU) to 273 s an image (P²-LLM, 8 GPUs) | not plausible |

**What a browser needs from a learned codec is determinism, not speed alone.** An arithmetic decoder fails
"catastrophically" if its probability model differs by a bit between encoder and decoder (Ballé, Johnston, Minnen,
ICLR 2019, integer networks). WGSL allows float operations to be reassociated and fused, specifies no rounding mode,
and lets subnormals flush to zero, while its integer arithmetic is exact (W3C CR draft, 2026-09-21). A float entropy
model on WebGPU is therefore not exact by spec. The 2026 practice keeps the entropy parameters bit-exact, quantized
to UINT8 and still computed on the CPU (Tatwawadi et al., arXiv:2605.05148, 2026-05). WebNN (CR draft, 2026-09-10)
states no numerical-determinism requirement and is behind an origin trial (Chromium M146–M148). **Only an integer
or table-driven model can be exact in a browser: TCT, Tomoz, possibly SR-LVC.** No paper that runs a learned image
decoder in a browser was found.

## 4. The browser's exact paths, unchanged

Every exact path over 8 bits is still a decoder in WASM writing typed arrays, as
[`split-prior-art.md`](split-prior-art.md) §2 found. Native JPEG XL (Safari 17+, Chrome 145 behind a flag, Firefox's
intent to ship of 2026-08-24, all through jxl-rs or libjxl) reaches a page only through `<img>` and a canvas. A canvas
gives `unorm8` or `float16` (HTML Living Standard; Chrome 137). float16 holds 11 significant bits, so native JPEG XL
is exact only on 8-bit sources. That is inference from the formats; row 63 tests it. The JPEG XL WASM packages found
return 8-bit `ImageData` or PNG bytes (`jxl-oxide-wasm` 0.12.6, read from its typings). An exact 16-bit path means
building libjxl or jxl-rs to WASM with a sample API, as row 22 did.

## 5. Ranked: expected gain against browser feasibility

Gain is bytes against HTJ2K on the lab's kind of content. Feasibility is an exact decoder in a browser today.

| rank | candidate | expected bytes against HTJ2K | browser today | why here |
| --- | --- | --- | --- | --- |
| 1 | **JPEG XL lossless, libjxl 0.12 or jxl-rs in WASM** | 0.78–0.95 (white paper; BD-LVIC inferred); **lab 0.83–0.95** | yes, WASM; native not exact over 8 bits | the best standard codec, with a DICOM syntax since 2024. Its decode was 4.0–6.2× OpenJPH's (row 22) and 0.12 claims speed: row 63 |
| 2 | **Tomoz** | 0.73–0.85 claimed on CT/MR/PET volumes; ≈ JPEG XL on 2-D mammograms | **yes, WASM on npm**, claimed deterministic | the only learned codec runnable now. Self-reported, unreviewed, and slower to decode than JPEG XL by its own figure. Breast content is where it claims least |
| 3 | **JPEG-LS (CharLS in WASM)** | 0.91–0.94 (Tomoz's table); ≈ JPEG 2000 Part 1 elsewhere | yes, WASM | never measured here; DICOM since 1999; decode cost in WASM unknown here |
| 4 | **TCT** | ≈ 0.70–0.83 inferred (0.74–0.87 of JPEG 2000 in its own table) | no code; would be deterministic | the best published result with a CPU decode at JPEG XL's speed. Watch for a code release |
| 5 | SR-LVC | ≈ 0.78–0.81 inferred on 12-bit CT | code cited, not found; fixed point plausible | tiny model, but recurrent across slices: an ask for one slice would decode its predecessors (README §A1's cost) |
| 6 | Slices coded as video, JP3D | 0.88–1.0 of intra on CT; 0.97 on DBT (2012) | AV1 already is one | the lab measured inter on DBT and found nothing (rows 10, 21, 46) |
| — | BD-LVIC, BCM-Net, FNLIC, ArIB-BPS, LLM coders | ≈ 0.69–0.79 inferred (BD-LVIC) | no: float on a GPU, not exact by spec, 0.2–273 s a frame | none until an integer version exists |

**Verdict.** JPEG XL lossless is still the codec to beat, and the literature has nothing standard that beats it.
The gains published since 2023 are 3–20 % under JPEG XL. All of them come from learned or context-tree models on
CT and MR volumes. Only two of them could be exact in a browser: one is unreviewed (Tomoz), and the other has no code
(TCT). **No published work measures modern lossless codecs on breast imaging.** For the AV1 phase's priority content,
the lab's own rows are the reference.

## Proposed measurements (not queued)

1. **JPEG-LS beside HTJ2K and JPEG XL** on the breast series of rows 45–46. Measure bytes, and decode through CharLS in
   WASM against OpenJPH in headless Chromium, interleaved, every frame exact. It is the one standard lossless codec
   the lab has not measured, and the literature puts it 6–9 % under HTJ2K.
2. **Tomoz on the lab's volumes**, if its licence (Apache-2.0, to be confirmed in `licensing.md`) and a pinned
   version allow. Measure bytes against HTJ2K and JPEG XL on the DBT volumes, the CT and one FFDM. Then measure its
   WASM decode a frame. Check that it decodes byte-exact in Chromium, Firefox and WebKit against the encoder's
   input. Its claims are self-reported, and this would test them.
3. **TCT when its code appears**: the same bytes-and-decode measurement, with its per-volume model's cost to an ask
   for one slice.
