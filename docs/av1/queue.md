# AV1 queue

The AV1 phase's work, handed to cloud agents: order and state here, findings in the doc that owns
the subject ([`README.md`](README.md) for the phase's decisions, `decode/README.md`, `FIXTURES.md`,
`WIRE.md` for theirs). Separate from [`../cloud-queue.md`](../cloud-queue.md) on purpose: that queue
and its branch belong to other work.

## Protocol

**This queue lives on `claude/av1`. Push only to `claude/av1`** — never to
`claude/unified-2026-09-23`, `main` or any other branch, and never edit `docs/cloud-queue.md`.

1. `git fetch origin && git checkout claude/av1 && git rebase origin/claude/av1`.
2. Read `CLAUDE.md`, then [`README.md`](README.md) (this phase), then the table below.
3. Take the **topmost `ready` row**. Set it to `claimed` with the date, commit that alone, push. The
   push is the lock: if it is rejected, rebase and take the next `ready` row.
4. Do the lane. Push your work (rebase first).
5. Set the row to `done` with the commit hash after the rebase that pushed it, a one-line verdict
   with its numbers, and where the finding lives. Flip any `after …` row whose prerequisites are now
   all done to `ready` in the same commit. Push.
6. Back to 1. Stop when no row is `ready` and say so; do not invent work.

**Rules every row keeps.**

* **Bit-exact, always.** Ground truth is the encoder's input samples (a checksum written when the
  input is made), never the output of a decoder under test. A path that is not exact is reported,
  not used.
* **Mutate every new test or check** and watch it fail before trusting it.
* **Interleave arms** in any timing (`lab/order.mjs`, `lab/scripts/order.py`); give n and the
  spread; say where the host saturates and claim nothing past it. Containers are not phones: a
  decode time is a container's unless measured elsewhere, and says so.
* **Pin every tool** (tag or version, and a checksum of anything fetched). Fetched data and built
  binaries are not committed; the script that makes them is.
* **Code beside today's path, not instead of it.** HTJ2K keeps working unchanged; the gate
  (`scripts/gate.sh`) stays green. A change to the transport's unit, the wire or the store's format
  is structural: propose it in the owning doc, do not build it.
* **This repository is public.** Never name another viewer, its SDK, a vendor, or any private
  project. Licences go in [`licensing.md`](licensing.md); anything new that is shipped or fetched
  is added there with its licence before it is used.
* Commit messages hold the change only — no attribution, co-author or session trailers.
* Blocked on a decision only the owner can make: add it under `## Blocked`, push, take the next row.

## Queue

| # | what | state |
| --- | --- | --- |
| 1 | **TOOL** — the encoders and a native decoder, pinned, and a lossless round trip at every depth and layout | done `c20e37f` — libaom 3.8.2 and 3.15.1 (pinned), SVT-AV1 v4.2.0, dav1d 1.5.4 built from pinned sources; lossless intra exact in every cell (grey 8/10/12 4:0:0, RGB 8/12 4:4:4, odd size, 2 presets, 16/16 frames, each unit decodes alone); **inter at 10/12 bits inexact on both libaom versions** (1–8 of 16 frames, ≤ 61 669 samples, \|Δ\| ≤ 11; dav1d and aomdec agree, so the encoder) and **exact with `--auto-alt-ref=0`**; 3.15.1's aomenc cannot encode 12-bit 4:4:4; SVT-AV1 4:2:0 8/10-bit only, its 10-bit inter inexact under every setting tried; rav1e 0.7.1 has no lossless mode (1 674 of 196 608 samples wrong at qp 0); 4 mutations caught 4/4 — [`lab/av1`](../../lab/av1/README.md), [`README.md`](README.md) §Measured here |
| 2 | **DATA** — public, freely licensed multi-frame series, fetched and checksummed | done `7dee2a5` — 5 CC BY series, 310 frames, ~205 MB from the NCI Imaging Data Commons public bucket (TCIA's API, Zenodo, PhysioNet refused by the container's network policy): CT 100 × 512² signed (LIDC-IDRI), MR 58 × 512² (ISPY1), RGB ultrasound cine 70 × 760×421, 12-bit fluoroscopy 18 × 768², 16-bit cone-beam 64 × 512²; every file and set SHA-256-pinned, frames identical to `PixelData` 310/310, 5 mutations caught 5/5; CT spans −2048..3746 and cone-beam 0..7364, both 13 bits after any offset; no open angiography run — [`FIXTURES.md`](../FIXTURES.md) §AV1 data |
| 3 | **WCAP** — what WebCodecs' AV1 decoder supports in headless Chromium, and whether it returns samples exactly | done `c0cc63e` — Chromium 141 (headless, no GPU): every 8- and 10-bit cell exact, 16/16 (4:0:0, 4:2:0, 4:2:2, 4:4:4 GBR × intra and G = 8, 8/8 frames each, per plane against the encoder input); **12-bit refused, 8/8** — `decode()` rejects its keyframe while `isConfigSupported` says true (it also says true to profile-illegal strings); `prefer-hardware` unsupported; 4:0:0 returns `I420` with mid-grey chroma; the decoder holds 2 frames until `flush()`, so 1 unflushed chunk gives 0 frames (*corrected:* not the earlier empty probe's cause — it flushed; that stays unexplained) — [`decode/README.md`](../decode/README.md) §AV1, [`README.md`](README.md) §A2, [`lab/av1/wcap`](../../lab/av1/wcap/README.md) |
| 4 | **WASM** — dav1d built to WASM, exact against native dav1d | done `0af2b78` — exact: dav1d 1.5.4 / emscripten 3.1.74, scalar, `-msimd128` and `-pthread` arms match native dav1d and a native build with assembly on every frame of 12 lossless streams (8/10/12-bit 4:0:0 and 4:4:4, intra and G = 8), one picture per temporal unit at frame delay 1; 546 / 623 / 635 KB `.wasm` (219 / 238 / 244 KB gzip); libaom 3.8.2 inter 10/12-bit inexact reproduced (≤ 15 904 of 1 M samples, \|Δ\| ≤ 11) — [`lab/av1/dav1d-wasm`](../../lab/av1/dav1d-wasm/README.md), [`README.md`](README.md) §A2 |
| 5 | **SEAM** — the codec seam and, if inter coding pays, the group as the transport's unit: a proposal | done `7e42c0a` — proposed, not measured: `codec` in the bundle's metadata (absent = htj2k, unknown = refused before the dial), one decoder module per codec behind `decoder.js`; G > 1 as the client's unit (`request_frames [k … N]`, a group to one decoder) with 0 wire, store or server changes, 7 invariants named as broken; needs SIZE and SPEED before a G — [`adr-unit.md`](adr-unit.md) |
| 6 | **SIZE** — lossless bytes: AV1 intra, AV1 inter by group length, HTJ2K | done `4c8b288` — **AV1 lossless coded whole is larger than HTJ2K on every real series** (*corrected by DEPTH: split, it is below HTJ2K on every series over 10 bits*)**, and inter collects nothing**: bytes over HTJ2K's at libaom 3.15.1 cpu0, intra → whole series, fluoroscopy 1.024 → 1.027, MR 1.034 → 1.062, ultrasound RGB 1.117 → 1.534 (cpu6 1.04–1.75); smallest G with most of the gain is G = 1; JPEG XL 0.83–0.93 (reference); CT and cone-beam need 13 bits (DEPTH); 122/122 codings exact, each group decoded alone; cjxl 0.7.0 found inexact on 12-bit PGM; 5 mutations caught — [`lab/av1`](../../lab/av1/README.md) §SIZE, [`README.md`](README.md) §A1 |
| 7 | **DEPTH** — 12-bit, signed and 16-bit samples in AV1 | done `abcf738` — CT (−2048..3746) and cone-beam (0..7364) need 13 bits after any offset, MR and fluoroscopy fit 12; best split **top11+low** (v ≫ 2 at 12 bits, v & 3 at 8): bytes over HTJ2K at libaom cpu0 CT **0.918**, cone-beam 0.997, MR 0.990 (direct 1.034), fluoroscopy 0.946 (direct 1.024); hi/lo bytes worst, 1.20–1.37; top10+low keeps every stream ≤ 10 bits (WebCodecs-decodable) at 0.994–1.071; two streams decode in the time of one (native dav1d, n = 15 interleaved; merge 0.05 ms/512²); 12-bit needs dav1d, WebCodecs refuses it; 44/44 splits exact, 3 mutations caught — [`lab/av1`](../../lab/av1/README.md) §DEPTH, [`README.md`](README.md) §A3 |
| 8 | **DEC** — an AV1 decoder behind `decoder.js`'s contract, chosen by the series' codec | done `794c42d` — built at G = 1: `decoder.codec: "av1"` loads `decode-av1.js` (dav1d-WASM `simd`, 623 KB, flushed before every frame) behind the unchanged contract; all 6 shapes (8/10/12-bit grey and RGB) exact through the downloader against the generator's checksums, a frame of a group, an empty unit and a non-AV1 file refused, an unknown codec refused before the dial; dispatch 105 → 123/123, every new check mutated to fail; no wire or store change needed — [`client/downloader/README.md`](../../client/downloader/README.md), [`adr-unit.md`](adr-unit.md) §2 |
| 9 | **SPEED** — decode time per frame and per group: dav1d-WASM, WebCodecs, OpenJPH; the ask and fill it implies | done `15f29e3` — **AV1 decodes 5–10× slower than HTJ2K and wins on nothing here**: product worker, first 18 frames of fluoroscopy, MR and ultrasound, 16 interleaved rounds, Node and Chromium 141 at 1× and 4×, 7 488/7 488 frames exact, 2 mutations caught 13/13 cells; dav1d-WASM 5.4–9.7× OpenJPH (fluoroscopy 70 vs 9.8 ms, MR 26 vs 4.9, ultrasound 48 vs 7.9 in Chromium at 1×), slower in 224/224 paired rounds, dav1d itself ~90 % of it; WebCodecs 4.1–4.2× (ultrasound only: it refuses 12 bits); at G = 1 an ask pays 20–260 ms more decoding, and at 4× on a 50 Mbit link AV1 becomes the fill's clock on every series where HTJ2K never is (arithmetic) — [`decode/README.md`](../decode/README.md) §Decode time against HTJ2K, [`README.md`](README.md) §A1–A2, [`lab/av1/speed`](../../lab/av1/speed/README.md) |
| 10 | **CONTENT** — the content the verdicts lack: tomosynthesis and a contrast angiography run | done `72c6560` — **inter does not pay on tomosynthesis either**: two CC BY 4.0 breast tomosynthesis volumes (EA1141, 1 mm; 29 × 614×1359 12-bit, 24 × 678×1727 10-bit cropped to the breast, crop drops only zeros), libaom 3.15.1 cpu0: best group against intra +1.2 % (12-bit, G = 2) and −0.6 % (10-bit, whole; −1.8 % at cpu6), far from `adr-unit.md` §4's fifth; AV1 over HTJ2K intra 1.043 and **0.977 — the first series where AV1 coded whole is smaller**; top11+low 0.943 and 0.946; JPEG XL 0.917, 0.851; 54/54 codings exact, each group decoded alone; the new crop and its pin mutated, 2/2 caught; **no open angiography run**: every IDC XA series is single frames (Blocked) — [`lab/av1`](../../lab/av1/README.md) §SIZE, §DEPTH, [`FIXTURES.md`](../FIXTURES.md) §AV1 data, [`README.md`](README.md) §A1, §A3 |
| 11 | **FILL** — the fill's decode measured, not multiplied: three decoders, HTJ2K against AV1, through the downloader | done `be03c64` — **at 1× AV1 fills at the wire's pace; at 4× on 50 Mbit it is the fill's clock on every series, HTJ2K on none**: whole series through the downloader, three decoders, real server behind the relay (40 ms), Chromium 141, 20 and 50 Mbit, 40/16 rounds Williams-ordered, 230/784 `VOID` dropped, n = 12–30; 40 544/40 544 frames exact, 2 mutations caught 7/7; AV1 slower in 174/174 pairs — at 1× +86 to +895 ms (+4–12 %, its bytes; decoding ends 24–72 ms after the last byte), at 4×/50 Mbit 0.50–1.85 s of decoding after the last byte against HTJ2K's 20–38 ms, the fill +27 % MR, +35 % fluoroscopy, +68 % ultrasound (5.34 vs 3.17 s); 94–274 ms behind at 4×/20 Mbit; WebCodecs keeps up on the 8-bit ultrasound (116 ms behind at 4×); the arithmetic's verdict holds, its sizes were optimistic — [`README.md`](README.md) §A1, [`lab/av1/fill`](../../lab/av1/fill/README.md) |
| 12 | **PREVIEW** — a lossy first picture, the exact frame after: what it buys a cine on a phone link | done `0c59dfd` — **a lossy AV1 preview at 0.78 % (fluoroscopy, CRF 20, 43.9 dB, max \|Δ\| 433 of 4095) and 7.0 % (ultrasound, CRF 32, 34.2 dB) of the exact HTJ2K bytes makes the cine playable 74–124× and 14× sooner on 5 Mbit/s** (0.12–0.20 s against 14.8 s; 2.0 s against 28.8 s) and 4–32× sooner than HTJ2K's half-size prefix (26–32 % of the bytes, 27 dB); every frame exact later by that share, +0.8 % and +7 %; dav1d-WASM decodes a preview frame 1.1–3.3× slower than OpenJPH the exact one, so at 50 Mbit/s and 4× it loses to HTJ2K's prefix (1.21 against 0.93 s), WebCodecs 2.4–13× faster than dav1d-WASM (0.24 s); G = 8, not the whole series, keeps decoders parallel; timeline arithmetic over measured bytes and decode times (15 interleaved rounds, Chromium 141, 1× and 4×, 68 640/68 640 frames matching), no angiography run available, whether a lossy first picture is acceptable is the owner's — [`README.md`](README.md) §A5, [`lab/av1/preview`](../../lab/av1/preview/README.md) |
| 13 | **SPLIT10** — the top10+low split through WebCodecs: exact, and how fast | done `25ddebd` — **exact, and 2–3× faster than dav1d-WASM, still 2–4× slower than HTJ2K**: Chromium 141 headless, CT, cone-beam, MR and fluoroscopy, first 18 frames, 16 interleaved rounds at 1× and 4×, 9 216/9 216 frames exact; WebCodecs top10+low (two `VideoDecoder`s, merged) 0.44–0.50 of dav1d-WASM top11+low's time at 1× and 0.32–0.40 at 4× (faster in 128/128 paired rounds; CT 13.5 against 29.2 ms, fluoroscopy 36.3 against 83.4), 2.6–3.9× OpenJPH at 1×, 2.1–3.7× at 4×; the decoder, not the split, is the gain (dav1d-WASM on top10+low 0.89–0.97 of top11+low); bytes top10+low 0.973–1.064 of HTJ2K, top11+low 0.904–0.998; WebCodecs' thread count not measured; 5 mutations caught — [`README.md`](README.md) §A3, [`lab/av1/split10`](../../lab/av1/split10/README.md) |
| 14 | **ENC** — encode time, uncontended, per preset and content: ingest cost, and whether lossless can run live | done `7e572d0`, `ce6f81c` — **lossless AV1 cannot be encoded live except at its fastest intra preset, and then larger than HTJ2K**: libaom 3.15.1, one uncontended core, 8 frames a set × 26 presets × 3 interleaved rounds, 546/546 runs exact; slowest preset 3.0–11.1 s a frame; fastest intra within 2 % of its bytes 0.35–1.6 s (0.6–2.9 frames/s: MR good6, CT allintra6, cone-beam good6, fluoroscopy allintra7, tomosynthesis good6 / allintra5), the RGB ultrasound only at the slowest (7.2 s); 30 frames/s of 512² only at allintra9 on MR (36.7) and CT (33.3), 1.05–1.19 of the slowest's bytes and above HTJ2K's; real-time inter exact at 10–13 bits and the smallest AV1 coding on 10-bit tomosynthesis (0.94 of HTJ2K, 5.5–9.6 frames/s); `ojph_compress` 58–136 frames/s into fewer bytes; 5 mutations caught — [`lab/av1`](../../lab/av1/README.md) §ENC, [`README.md`](README.md) §Measured here |
| 15 | **SVC** — libaom's real-time scalable encoder in lossless mode at 10 and 12 bits: exact or not | done `49a101b` — **exact in every cell it encodes**: libaom 3.15.1 `svc_encoder_rtc` at `--min-q=0 --max-q=0` (no hook), grey 4:0:0 and RGB 4:4:4 at 8/10/12 bits, L1T1/L1T3/L2T1/L3T3 scaled and full-size, speeds 7 and 10, synthetic and the fluoroscopy, MR and ultrasound series: 418 layers, 10 436/10 436 frames, each operating point decoded alone; the stock example encodes 8/10-bit 4:2:0 only — 12-bit, 4:4:4 and 4:0:0 need a patch to its CLI, kept in the lab; scaled layers have no truth and are not compared; 1.07–1.58 of HTJ2K's bytes at L1T1; 5 mutations caught — [`lab/av1/svc`](../../lab/av1/svc/README.md), [`README.md`](README.md) §Measured here |
| 16 | **GOP** — the group as the item: whole groups asked and sent in order, a group to one decoder, fill start to end | done `dc71635` — **built, no wire, store or server change**: `groupLength` + `frameCount` beside `decoder`; an ask for any frame asks its whole group k … k+G−1 (cut at the series' end), a fill asks whole groups and a fill cut by an ask resumes mid-group on the decoder still holding it; a group goes to one decoder in index order — a split across decoders impossible by construction (a non-keyframe goes only to the decoder that took its predecessor) and refused by `decode-av1.js` if it happens; a failure fails the rest of its group by name; groups decode through dav1d-WASM only (WebCodecs is flushed per frame), a split series stays G = 1; a G = 8 set (20 frames, short last group) and a one-group set (12 × 12-bit) exact frame by frame against the generator's checksums, frames landing last to first still decode in order; 191/191 dispatch checks, 11 mutations caught 11/11, gate green; nothing timed — [`adr-unit.md`](adr-unit.md) §3 *Built*, [`client/downloader/README.md`](../../client/downloader/README.md) |
| 17 | **RESID** — a lossy AV1 preview plus a lossless residual: does the exact frame cost more than HTJ2K alone? | done `3dcee3c` — **the preview is free in bytes, not in decode**: the exact frame as a lossy AV1 preview (libaom 3.15.1 cpu6, G = 8, CRF 8–44, grey 4:0:0 10-bit, colour BT.601 4:2:0 converted back in integer arithmetic) plus source − preview coded losslessly; all seven series: preview + HTJ2K residual **0.947–1.002 of HTJ2K alone** at each series' best CRF (−5.3 % ultrasound, −5.0 % CT, +0.2 % 12-bit tomosynthesis; 0.947–1.021 over all 28 cells) against preview-then-HTJ2K's 1.001–1.222; the residual in AV1 better only on 10-bit tomosynthesis (0.930), colour 1.13–1.61; decode of preview + residual + add **1.31–1.89× HTJ2K alone through WebCodecs** at 1× (1.23–1.74× at 4×; slower in 207/210 paired rounds), 2.1–3.1× through dav1d-WASM, 4.9–11× with the residual in AV1; lossy output bit-identical across native dav1d, dav1d-WASM and WebCodecs 13 440/13 440 (8-bit 4:2:0, 10-bit 4:0:0), every frame exact 16 800/16 800 (headless Chromium 141, first 16 frames, 15 interleaved rounds at 1× and 4×); 5 of 6 mutations caught, a 1/65 536 nudge of a colour constant changed no sample — [`README.md`](README.md) §A5, [`lab/av1/resid`](../../lab/av1/resid/README.md) |
| 18 | **SVCQ** — one scalable AV1 payload, a lossy base layer and a lossless top: the overhead of the layers | done `9b85a77` — **exact, and scalability nearly free, but it carries lossless AV1's size**: libaom 3.15.1 `svc_encoder_rtc` (lab patch `--layer-q`), two spatial layers, base half or full size at q 20–55, top lossless; every top frame exact on fluoroscopy, MR, ultrasound and two synthetic sets; total 0.95–1.04 of single-layer lossless AV1, so **1.04–1.64 of HTJ2K** against PREVIEW's 1.008–1.07 and RESID's 0.947–1.002; a half-size base is 0.03–2.4 % of HTJ2K at q 40–55 and decodes in 2–13 % of a lossless frame's time; the exact frame 3–30 % slower than single-layer (dav1d-WASM, Chromium 141 and Node, 1× and 4×, n = 15 interleaved, 270/270 a cell); `decode-av1.js`'s `all_layers` 1 returns the base then fails on such a payload; WebCodecs returns the top exactly and cannot choose an operating point; 5 mutations caught — [`lab/av1/svcq`](../../lab/av1/svcq/README.md), [`README.md`](README.md) §A5 |
| 19 | **LCEVC** — the enhancement-layer standard: licence, whether it can end lossless, a browser decoder, a trial | done `cce8cc8` — **no trial possible, and not exact at 14 bits**: no open LCEVC encoder exists; LCEVCdec 4.2.2 and LCEVCdecJS 1.3.0 are BSD-3-Clause-Clear and grant no patents (commercial terms unconfirmed); the web decoder draws 8-bit RGBA through WebGL, no samples back, and the decoder's own WASM port is "not complete"; no lossless mode, but from the source at step width 1 the dequantisation is the identity and residuals land at 2^−f of a sample (f = 7/5/3/1 at 8/10/12/14 bits, nothing deeper), so an exact frame is reachable at 8–10 bits, at 12 with the 2×2 transform (256/256 classes; 4×4 36/36 patterns, not proven), and **not at 14: 128/256 offset classes of a 2×2 block unreachable**, so the 13-bit CT and cone-beam cannot end exact; a model of the decoder (the container refused to build it), 6 of 7 mutations caught — [`README.md`](README.md) §A5, [`licensing.md`](licensing.md), [`lab/av1/lcevc`](../../lab/av1/lcevc/README.md) |
| 20 | **WCDEC** — a WebCodecs AV1 decoder module beside dav1d-WASM, chosen per series where exact | done `ff7d38e` (`575abb5`) — built at G = 1: `decode-av1-webcodecs.js` taken when the series says `depth` ≤ 10 and `VideoDecoder` exists, dav1d-WASM otherwise (absent depth included); the top10+low split (`[u32le top length][top][low]`, `split`) and a signed `offset` undone by both through a shared `av1-frame.js`; headless Chromium 141 dispatch arm 123 → 167/167: 8/10-bit grey and RGB exact through WebCodecs (4/4 units seen reaching it), the same with `VideoDecoder` removed and 12-bit with it present exact through dav1d (0 units), 13-bit, 13-bit signed and 16-bit signed splits exact through both, 7 bad units refused by both and the next frame exact, frames one at a time; 17/17 mutations caught, 1 equivalent (`codedWidth` = `visibleRect` on Chromium); YUV 4:4:4 with an unspecified matrix would pass WebCodecs' check where dav1d refuses it; **G > 1 not built** — waits on row 16's group path; not timed — [`decode/README.md`](../decode/README.md) §WebCodecs, the decoder the client runs, [`adr-unit.md`](adr-unit.md) §2 |
| 21 | **TAXO** — the cine-like taxonomy's content: breast ultrasound cine, automated breast ultrasound, tomosynthesis projections, angiography | done `3ad8171` — **inter does not pay on tomosynthesis projections either, and split they are under HTJ2K**: two CC BY 4.0 EA1141 series of raw views from two vendors' systems (9 × 1914×2572 cropped to the breast, 15 × 1280×2048), 14 bits as stored (one saturated value, 16383, above data ending at 3648 and 1794); top11+low by group, libaom 3.15.1: best group 0.29 % under intra (G = 8) on one, 0.2–1.0 % over on the other; **top12+low — the two low bits apart, the rule DEPTH found at 13 bits — 0.952 and 0.923 of HTJ2K**, top11+low 0.998 and 1.002, hi8+lo8 1.08–1.34; JPEG XL 0.937, 0.929; 32/32 split codings exact, each group decoded alone, 387/387 frames identical to `PixelData`; 3 pin and 3 group mutations caught 6/6; **no breast ultrasound cine, ABUS or multi-frame angiography reachable** — IDC has none, the other hosts are refused (Blocked) — [`lab/av1`](../../lab/av1/README.md) §SIZE, §DEPTH, [`FIXTURES.md`](../FIXTURES.md) §AV1 data, [`README.md`](README.md) §A1, §A3 |
| 22 | **EMBED** — embedded lossy-to-lossless intra codecs for contrast: JPEG 2000 quality layers, progressive lossless JPEG XL | done `9862837` — **an embedded preview is free in bytes and dear in decode**: JPEG 2000 Part 1 with three quality layers (OpenJPEG 2.5.4, 5/3, LRCP) costs 0.09–0.19 % over one layer and is 0.93–0.96 of HTJ2K's bytes whole; its first layer is 0.4–0.9 % of them at 37–43 dB on grey (25 dB RGB ultrasound) and decodes in 1.0–1.4× OpenJPH's exact time, but **the exact frame decodes 6–12× slower than OpenJPH** (210/210 paired rounds); about twice AV1's preview bytes for the same PSNR, though inside the exact frame; progressive lossless JPEG XL (libjxl 0.12.0, `-p`) draws its first picture only after 6–48 % of the bytes (28–47 dB; libjxl pauses at no step in a lossless frame), first picture 1.3–2.9× and whole 4.0–6.2× OpenJPH, 0.91–0.95 of its bytes; all seven sets, headless Chromium 141, 15 interleaved rounds at 1× and 4×, 22 680/22 680 frames exact, 4 mutations caught — [`README.md`](README.md) §A5, [`lab/av1/embed`](../../lab/av1/embed/README.md), [`licensing.md`](licensing.md) |
| 23 | **TOTAL** — total time on phone-like links, the measure that decided against AV1 before: HTJ2K against every AV1 form, per taxonomy series | claimed 2026-10-03 |
| 24 | **SVCDEC** — a scalable payload in the client: the base operating point first, the exact frame from the same bytes | claimed 2026-10-03 |
| 25 | **SVCSHAPE** — the scalable shape with the least overhead: layers, scale, base quality, per content | claimed 2026-10-03 |
| 26 | **SVCORDER** — delivering bases first: what the store and the group-as-item model need (a proposal) | claimed 2026-10-03 |
| 27 | **DECSPEED** — the decode is what loses on a phone: encoder settings and decoder threads that cut it, lossless kept | claimed 2026-10-03 |
| 28 | **LLSIZE** — closing lossless AV1's byte gap to HTJ2K with AV1 alone | claimed 2026-10-03 |
| 29 | **SWEEP** — AV1-only options nobody has listed yet: a read-only identification sweep | ready |

## Briefs

### 1 TOOL

Build pinned **libaom** (`aomenc`), **SVT-AV1** (`SvtAv1EncApp`) and **dav1d** (CLI, `-Dbitdepths=8,16`)
from source, `lab/av1/tools.sh` (the way `lab/scripts/gen_htj2k_fixtures.sh` builds OpenJPH). For
each encoder, find the settings that code **mathematically lossless** (libaom `--lossless=1`; check
what SVT-AV1 offers — if it has no lossless mode, say so and drop it) and test a round trip
(encode → `dav1d` → compare against the input's checksum) on synthetic frames from
`lab/scripts/gen_frame_pnm.py`:

* grey 8 and 10 bit as 4:0:0 (`--monochrome`, Main profile) and 12 bit as 4:0:0 (Professional);
  RGB 8-bit as 4:4:4 with identity matrix (`matrix_coefficients` 0, GBR; High profile) — 4:2:0
  would drop colour and is not lossless;
* intra-only (every frame a keyframe) and inter (a group length of 8, say).

**Test two libaom versions**: an older 3.8.x and the newest release. Inter-coded 10- and 12-bit
grey is known to have come back inexact from 3.8.x ([`README.md`](README.md) §Prior evidence); the
verdict says, per version, which cells are exact, and pins the one the project uses. A cell inexact
on every version is not used, and says so. SVT-AV1 and rav1e are reported to have no usable
lossless mode: confirm or correct in one line each.

Record the exact command lines in `lab/av1/README.md` and which (encoder × depth × layout × mode)
cells are exact. A pipeline that writes Y4M or IVF: say which container the decoder is fed, and how a
frame's OBUs are split out (a temporal unit per frame), since the store holds one frame per entry.

### 2 DATA

The synthetic sets add independent noise to every frame, so they cannot answer whether inter coding
pays ([`README.md`](README.md) §A4). Find public multi-frame series under CC0 or CC BY (or a licence
as open — record it). Candidates, **each licence verified, not assumed**: TCIA collections through
the public NBIA `getImage` API (LIDC-IDRI CT, ISPY1 MR, CBIS-DDSM), the MONAI ultrasound working
group's anonymised clip, DICOM test-data repositories (a test-data directory inside a GPL project
may not be open for reuse). Wanted: a CT stack (12-bit signed), an MR stack, an ultrasound cine (8-bit colour), and
an X-ray angiography run if one is open. Prefer sources a container can reach without an account.
This is the one exception to `FIXTURES.md`'s generated-only rule, because the question is about real
content: say so there. Write `lab/av1/fetch_data.sh` that downloads them to a gitignored directory, checks a pinned
SHA-256, and extracts frames as raw samples plus their checksums (pydicom or similar, pinned). The
set, its source, licence, attribution and checksums go in `FIXTURES.md` §AV1 data (new). If nothing
reachable is open enough, say so under `## Blocked` with what you found.

### 3 WCAP

In headless Chromium (the version the lab already uses), run `VideoDecoder.isConfigSupported` over
AV1 profiles 0/1/2 × bit depth 8/10/12 × mono/4:2:0/4:4:4, hardware and software preference. For
every supported config, decode a lossless stream — one `EncodedVideoChunk` per temporal unit, `key`
only on keyframes, the sequence header in-band. An earlier probe got **no frames** from lossless
streams with the config reported supported ([`README.md`](README.md) §Prior evidence): find out
why (packaging, the decoder chosen, lossless itself) before concluding. Make the streams with any pinned encoder — ffmpeg's
libaom is fine for this row — and record the command), `copyTo` each `VideoFrame` and compare against
the encoder input's checksum. Record the `VideoFrame.format` returned, whether a mono stream comes
back with chroma planes, and any conversion. Verdict: the list of (profile, depth, layout) cells
WebCodecs returns exactly on this platform, and what that cannot say about phones or Safari. Into
`docs/decode/README.md` §AV1 (new) and [`README.md`](README.md) §A2.

### 4 WASM

Build dav1d (pinned tag) with emscripten for both bit-depth templates (`-Dbitdepths=8,16`,
`-Denable_asm=false` — its assembly is x86/Arm only), plain and with `-msimd128` (the compiler's
vectorisation; an earlier build had none); one build with
threads off and one with threads on if it builds (record why not if not). A small JS wrapper in the
shape `decoder.js` needs — bytes of one temporal unit in, the planes out, decoder state reused across
a group — under `lab/av1/dav1d-wasm/`. Exact against native dav1d (row 1, or ffmpeg's libdav1d if
row 1 is not done) on lossless streams at 8/10/12 bit and 4:0:0/4:4:4. Report the `.wasm` size raw
and gzipped and the build's flags. Nothing built is committed; the build script is.

### 5 SEAM

An answer, not code. In [`README.md`](README.md) §A1 (or a new `docs/av1/adr-unit.md` if it does
not fit), propose:

* where the codec tag lives (series metadata field name, values, and what a client does with a value
  it does not know);
* how `decoder.js` dispatches by it, keeping the output contract `{pixels, width, bits, signed, range}`;
* **if** a group of G > 1 frames is the unit: how an ask for frame N is served (the group from its
  keyframe? which bytes go first?), how the store indexes a group, how the fill's order and the
  decoder pool change (a group to one decoder), and what the cache holds. Read `WIRE.md`,
  `ARCHITECTURE.md` and `adr-stream-shape.md` first; name every invariant the change breaks.

Mark what the proposal needs from SIZE and SPEED before a G can be chosen.

### 6 SIZE

Lossless bytes per frame and per series on every set from rows 1 and 2: HTJ2K (the project's
profile, `docs/FIXTURES.md`), lossless JPEG XL as a reference column only (libjxl, effort 7 — not
a candidate unless the owner says), AV1 intra, AV1 inter at G = 2, 4, 8, 16, 32 and the whole series, for
each encoder row 1 found exact, at its slowest preset and one practical preset. Record encode time
(an ingest cost, offline). Verdict per content: AV1's ratio against HTJ2K at each G, and the
smallest G that collects most of the gain. Into [`README.md`](README.md) §A1 with the content named.

### 7 DEPTH

For the CT data (12-bit signed) and a 16-bit set: signed → offset (a series whose stored range fits 12 bits
after its offset is coded as 12-bit — check the range per series, never assume it), coded as 12-bit (Professional
profile) — which decoders take it (row 3's list, dav1d); and for > 12 bits, the splits that stay
exact (high and low bytes as two 8-bit 4:0:0 streams; 12 + 4; others you find), their bytes against
HTJ2K's, and what each costs the decoder (two decodes and a merge). Into [`README.md`](README.md) §A3.

### 8 DEC

Behind the proposal of row 5 **for G = 1 only** (a frame decodes alone): the series' codec tag picks
the decoder module in `client/downloader/decoder.js` (or a sibling module it loads); AV1 frames go
through the row 4 build; the output contract is unchanged, so `consumer.js` and everything above do
not change. Add an AV1 set to the conformance suite's downloader arm with exact checksums, a
warm-up frame per shape (`decode/README.md` §Warming the decoders), the notices the shipped build
owes ([`licensing.md`](licensing.md) §What it obliges) served beside it, and keep the gate green. If row
5's proposal says G = 1 needs a wire or store change after all, stop and say so under `## Blocked`.

### 9 SPEED

The fill is decoder-bound, and an earlier desktop measurement put AV1 near 10× HTJ2K's decode time
a frame, so this row may decide the phase. Decode time per frame, interleaved, n ≥ 15, in Node and headless Chromium, unthrottled and at 4×
CPU throttle: OpenJPH on the HTJ2K frames, dav1d-WASM and WebCodecs (where row 3 says exact) on
the AV1 frames of the same content, intra and at the G row 6 recommends. From those and row 6's
bytes, the implied cost of an ask during a fill (bytes and decodes from the keyframe) and the fill's
decode time with today's decoder count. Into `docs/decode/README.md` §AV1 and
[`README.md`](README.md) §A1–A2.

## The preparation rows (10–15)

Rows 1–9 found lossless AV1 larger than HTJ2K coded whole, smaller only split on series over 10 bits,
and 5–10× slower to decode. The owner's decision on the phase is taken later, with every option on
the table; rows 10–15 measure what can be known now. None changes a default; each answers in the doc
that owns its subject.

### 10 CONTENT

Rows 2 and 6 had no tomosynthesis and no contrast run at 15–30 frames/s — the content where inter
prediction has the most to find, and where an earlier private study's medians favoured AV1 most
(10-bit tomosynthesis, AV1 inter 0.055 of raw against HTJ2K 0.080; not reproduced here). Find an open
tomosynthesis series and an open angiography or cardiac cine run (CC BY or CC0 preferred; a
non-commercial licence only if it is fetched at run time and never redistributed — record it and add
an item under `## Blocked` for the owner either way). Extend `lab/av1/fetch_data.sh` and
`FIXTURES.md` §AV1 data. Run row 6's matrix (HTJ2K, AV1 intra, G = 2…32 and whole, JPEG XL as a
reference) and row 7's splits on each, every coding exact. Verdict: does inter pay on either, by row
5's rule (`adr-unit.md` §4)?

### 11 FILL

`README.md` §A1's "AV1 becomes the fill's clock at 4×" is arithmetic. Measure it: the downloader
against the real server, today's decoder count, headless Chromium at 1× and 4× CPU throttle, the
relay at 20 and 50 Mbit/s (`--self-timing`, VOID runs dropped), interleaved, n ≥ 10: all-received
and all-decoded times for the same series as HTJ2K and as AV1 (row 8's decoder; WebCodecs as a
third arm on the 8-bit series if a WebCodecs decoder module is a few lines — say so if not). Every
frame exact. Into `README.md` §A1, replacing the arithmetic.

### 12 PREVIEW

The one place AV1 is known to win is lossy coding of a cine. The rule here is that every frame ends
bit-exact; a preview that is shown first and then replaced by the exact frame is allowed by that rule,
and whether a lossy first picture is acceptable in the product is the owner's ruling, not this row's.
Measure what it would buy, on the ultrasound cine, the fluoroscopy and row 10's angiography if found:
lossy AV1 (4:2:0, G and CRF swept, `cpu-used` practical) bytes and decode time through dav1d-WASM and
WebCodecs; then the exact HTJ2K frames. On 5, 20 and 50 Mbit/s: time to a playable cine (every frame
of the preview decoded) and to every frame exact, against exact HTJ2K alone and against HTJ2K's own
resolution prefix as the preview (`decode/README.md`, the prefix rows). Quality of the preview as
PSNR and max |Δ| per frame. Into `README.md` (a new §A5 Preview).

### 13 SPLIT10

Row 7: top10+low keeps every stream ≤ 10 bits, so WebCodecs could decode 12–13-bit content, at
0.994–1.071 of HTJ2K's bytes. Measure it: exact through WebCodecs in Chromium on CT, cone-beam, MR
and fluoroscopy (two decoders, merged), and the frame's decode time against dav1d-WASM on top11+low
and OpenJPH, interleaved, n ≥ 15, 1× and 4×. Into `README.md` §A3.

### 14 ENC

Encode cost decides whether AV1 can be an ingest format and whether lossless can be encoded live.
Uncontended (nothing else running; say how that was checked), per content of rows 2 and 10: seconds a
frame and frames a second per core for libaom 3.15.1 lossless at `cpu-used` 0…9 (intra and the G row 6
or 10 prefers), with the bytes each gives, against `ojph_compress` on the same frames. Verdict: the
preset that is within 2 % of the slowest's bytes, its frames/s, and whether any lossless preset
reaches 30 frames/s of 512² on one core.

### 15 SVC

A real-time encoder is likely to be scalable (SVC). An earlier private test found libaom 3.14.1's
`svc_encoder_rtc` exact in lossless at 8 and 10 bits 4:2:0 with a local test hook; 12-bit grey was not
covered. Build libaom 3.15.1's `svc_encoder_rtc` (pinned), and test lossless (`--min-q=0 --max-q=0`
or whatever its lossless control is — find it; if lossless needs a source patch, write it in the row's
README and keep it outside the product) at 8/10/12-bit 4:0:0 and 4:4:4, spatial and temporal layers,
every layer's frames against the input. Verdict per cell: exact, inexact, or not encodable.

## The integration and options rows (16–23)

The owner, 2026-10-03: AV1 is retaken; earlier it lost on **total time** in network-profile
simulations (decoding was the bottleneck) and because groups > 1 were not lossless (row TOOL has
since fixed that with `--auto-alt-ref=0`). Goals: the codec seam (the workstation's), AV1 integrated
and measured for the cine-like taxonomy (tomosynthesis, breast ultrasound, the mammography family
first), and every option tried that might give a preview and a lossless final view from one payload.
Rows 16, 20 and 23 are integration; 17–19 and 22 are options; 21 is content. Keep it simple: a group
is requested and sent whole, in order; no seeking inside a group.

### 16 GOP

Build [`adr-unit.md`](adr-unit.md) §3 in its simplest form, beside G = 1: `groupLength` in the
series metadata (absent = 1, keyframe at every multiple of G); **a group is the item** — the fill
asks whole groups start to end as `request_frames [k … k+G−1]`, an ask for any frame asks its whole
group (no partial group, no seek inside one); a group goes to one decoder and its frames decode in
order, the decoder's state reset at each keyframe; frames still leave the decoder one by one under the
unchanged contract. No wire, store or server change — if one turns out to be needed, stop and say so
under `## Blocked`. Conformance: a G = 8 and a whole-series set in the downloader arm, every frame
exact, a group split across two decoders refused or impossible by construction (say which), an ask
mid-fill re-issued from a keyframe; every check mutated. Gate green.

### 17 RESID

Row 12 measured a lossy AV1 preview at 0.8–7 % of the exact bytes. Can the exact frame be the
preview **plus** a lossless residual, so the preview is not extra? AV1 decoding is normative, so a
preview frame decodes to the same samples on every conforming decoder — verify that on dav1d native,
dav1d-WASM and WebCodecs for the 8- and 10-bit cases (bit-identical lossy output), since the residual
is only exact against identical predictions. Then per content (rows 2, 10): residual = source −
preview (signed, one bit wider), coded losslessly with HTJ2K and with AV1 intra; bytes of preview +
residual against HTJ2K alone; decode time of preview + residual + the add against HTJ2K alone,
interleaved. Verdict: the preview's net cost (or saving) in bytes and decode time.

### 18 SVCQ

After row 15 (which encoders code lossless SVC exactly): one AV1 payload with a lossy base layer
(spatial ½ and/or a quality layer) and a lossless top layer predicted from it. Bytes of base, of top,
and of both against single-layer lossless AV1 and HTJ2K; decode time of the base alone and of
everything, dav1d-WASM and WebCodecs (does WebCodecs decode a chosen operating point? say). Verdict:
the overhead of scalability against row 17's residual and row 12's separate preview.

### 19 LCEVC

MPEG-5 Part 2 adds enhancement layers over any base codec. Answer from primary sources, then try:
(a) the licence of the reference/open decoder and encoder (code licence and patent terms — whether an
MIT project may ship or depend on them; add to [`licensing.md`](licensing.md)); (b) whether its
enhancement can reconstruct **losslessly** (a lossless or near-lossless mode, residual precision,
bit depths up to 12/16); (c) a browser decoder (WASM/JS) and its licence; (d) if (a)–(c) allow, a
trial on the ultrasound cine and one grey series: base AV1 lossy + LCEVC, bytes and exactness. Stop
at the first hard no and record it; an answer row if no trial is possible.

### 20 WCDEC

Row 13: WebCodecs decodes ≤ 10-bit AV1 exactly and 2–3× faster than dav1d-WASM. Add
`decode-av1-webcodecs.js` beside `decode-av1.js`, behind the same contract (flush per frame at
G = 1, per group at G > 1; 4:0:0 read from the Y plane; the top10+low split merged), chosen per
series only where row 3's list says exact (≤ 10 bits) and the browser has `VideoDecoder`; otherwise
dav1d-WASM. Conformance in headless Chromium, every frame exact, the fallback exercised, mutated.
Gate green.

### 21 TAXO

The taxonomy the owner names first: breast tomosynthesis (reconstructed slices — row 10 — and the
projections if open), breast ultrasound **cine** and automated breast ultrasound volumes, other
mammography-family multi-frame content, and a contrast angiography run (row 10 found none reachable).
Search IDC and every source the container can reach; record licences (CC BY/CC0; a non-commercial one
fetched at run time only, flagged under `## Blocked`); extend `lab/av1/fetch_data.sh` and
`FIXTURES.md`. Run row 6's SIZE matrix and row 7's splits on each new series. If the network policy
refuses a source, name the host so the owner can allow it.

### 22 EMBED

For contrast with rows 17–19: intra codecs whose one codestream is a preview first and lossless at
the end. JPEG 2000 Part 1 with quality layers (OpenJPEG, pinned; reversible 5/3, several layers):
bytes against single-layer HTJ2K, bytes and PSNR to the first layer, decode time in WASM of the first
layer and of all. JPEG XL progressive lossless (libjxl, squeeze): the same, with a WASM decoder
(record its licence). HTJ2K's own resolution prefix is the baseline already measured (row 12).

### 23 TOTAL

The measure that decided before: total time, wire plus decode, for a fill start to end through the
downloader against the real server, on row 86's phone-like link profiles (`docs/cloud-queue.md`
§Rows 83–86: the LTE traces and Wi-Fi steps, `--self-timing`, VOID runs dropped) and at 5/20/50
Mbit/s, 1× and 4× CPU, interleaved (`lab/order.mjs`), n ≥ 10. Arms per series: HTJ2K; AV1 intra
(dav1d-WASM and row 20's WebCodecs where exact); AV1 at the best G of rows 6/10/21 through row 16;
the split where it applies; and the time to a playable preview for row 12's preview arm. Report
time to first frame, to all frames exact, and the preview's time where it applies. Verdict per
taxonomy series: which arm wins on which link, and where the host saturates.

## The AV1-only rows (24–29)

The owner, 2026-10-03: AV1 **alone**, without HTJ2K, is the focus (README §Threads). Scalable AV1 —
a lossy base layer and a lossless top in one payload — is the AV1-only way to a preview first and an
exact frame last: rows 15 and 18 found it exact at 8–12 bits, nearly free over single-layer lossless
AV1, but carrying lossless AV1's size (1.04–1.64 of HTJ2K) and decode. The rows below develop it and
attack AV1's two losses, decode time and bytes. A lossy first picture is shown only as a preview that
the exact frame replaces; whether the product shows one at all is the owner's ruling, not a row's.

### 24 SVCDEC

Row 18: `decode-av1.js` with `all_layers` 1 returns the base and then fails on a scalable payload, and
WebCodecs returns the top exactly but cannot choose an operating point. Make dav1d-WASM decode a
scalable frame twice from the same bytes as they arrive: the base operating point as a **preview**
(marked as such through the contract — propose the smallest addition, e.g. `preview: true` and the
base's own width/height, rather than reshaping the contract), then the full operating point, exact.
Single-layer streams unchanged. Conformance: every exact frame against the source, the preview
delivered before it and never left on screen after it, a top layer missing → the preview stays marked
and the frame fails by name; mutated. Gate green. If the contract change looks structural, propose it
in `adr-unit.md` and build only what the proposal allows.

### 25 SVCSHAPE

Rows 15/18 tried two spatial layers. Sweep the shapes (libaom 3.15.1 `svc_encoder_rtc`, the lab
patch): spatial ½ and ¼, a quality-only layer (same size, lossy base), two and three layers, temporal
layers L1T2/L1T3, base q 20–60, keyframe interval; per content of rows 2, 10, 21. For each: total
bytes against single-layer lossless AV1 and HTJ2K, base bytes and PSNR / max |Δ|, decode time of the
base and of the full point (dav1d-WASM, 1× and 4×, interleaved), every exact frame exact. Verdict per
content: the shape with the least overhead, and the time to a playable base on 5/20/50 Mbit/s.

### 26 SVCORDER

An answer, not code. A preview is only worth having if the bases of a whole cine arrive before the
tops. Today a scalable frame is one store entry, so its base and top travel together. Propose, in
`adr-unit.md`: how bases-first delivery fits the group-as-item model (row 16) — the layers of a frame
as separate entries (index arithmetic, as groups are), or a byte range per layer in the entry, or
something better — what the store, the wire, the fill order, the ask during a fill and the cache each
change, every invariant it breaks, and the smallest arm that would measure it. Read `WIRE.md`,
`ARCHITECTURE.md`, `adr-stream-shape.md` first.

### 27 DECSPEED

Row 11: at 4× CPU AV1's decode is the fill's clock on every series. Find what cuts it with the frame
still exact: (a) encoder settings that make decoding cheaper or parallel — tiles (and whether dav1d
uses them in WASM), superblock size, tools a lossless frame can drop, rows 6/10's presets; (b) dav1d-WASM
with threads (row 4's pthread build) — per-decoder threads against more decoders, under the fill's
decoder count, at 1× and 4×; (c) where a lossless frame's decode time goes (a profile: entropy decoding,
reconstruction, copy-out). Measure every candidate with row 11's fill harness, interleaved, exact.
Verdict: the best combination and its fill time against HTJ2K's at 4×.

### 28 LLSIZE

Lossless AV1 is 2–53 % over HTJ2K coded whole (rows 6, 10, 21), under it only split. Search AV1-only
ways to close that, every coding exact: libaom's lossless controls beyond the defaults (palette,
intra block copy, `--tune-content=screen`, superblock size, transform/partition search depth,
reference structure, `--enable-*` tools that still apply at qindex 0), the splits of row 7 applied to
≤ 12-bit content, SVT-AV1's lossless intra where it is exact (row 1: 4:2:0 8/10-bit), and anything
newer in libaom's changelog since 3.15.1. Bytes per content against HTJ2K, encode and decode time for
each winner. Verdict: the best AV1-only lossless coding per content and what it costs to decode.

### 29 SWEEP

Read-only research, primary sources only (AV1 spec, AOM, libaom/dav1d/SVT-AV1 changelogs and issues,
browser WebCodecs docs, AV2 if published): AV1-only options this queue has not tried for **scalable
preview-to-lossless, lossless size, decode speed, random access and real-time delivery** — e.g.
operating-point selection in browsers, S-frames, large-scale tile, reference scaling, hardware decoders'
lossless and bit-depth support per phone platform, AV2's lossless and scalability changes. For each:
what it is, why it might help here, the measurement that would decide it, and whether a container can
run it. Answer in `README.md` (a new §Options to try) and add each worthwhile one as a new `ready` row
at the bottom of this table with a brief.

## Blocked

* **A contrast angiography run (row 10).** No open one is reachable: every XA series in the NCI
  Imaging Data Commons (v24) is single frames, and TCIA's API, Zenodo and PhysioNet are refused by
  the container's network policy. The owner decides whether one is worth sourcing elsewhere (a host
  to allow, or a licence other than CC BY/CC0); until then no verdict covers angiography. A
  CC BY-NC 4.0 tomosynthesis collection exists in IDC and was not needed: two CC BY 4.0 volumes were.
* **Breast ultrasound cine, automated breast ultrasound and angiography (row 21).** None is open
  and reachable: IDC v24 holds no ultrasound of the breast but one series of 14 single-frame stills
  (CMB-BRCA, Ultrasound Image Storage), no automated breast ultrasound volume, and no multi-frame
  XA; its only multi-frame ultrasound is liver (`us_liver`) and colorectal (CMB-CRC). The other
  hosts such data lives on are refused by this container's network policy: `zenodo.org`,
  `figshare.com`, `data.mendeley.com`, `huggingface.co`, `www.kaggle.com`, `physionet.org`,
  `www.cancerimagingarchive.net`, `grand-challenge.org`, `www.synapse.org`, `osf.io`,
  `drive.google.com`. The owner decides whether to allow one, and which dataset and licence to
  take. IDC also holds an in-silico tomosynthesis collection (VICTRE, CC BY 3.0, simulated
  projections and volumes); not used, since the question is about real content.
