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

**`night` rows** are held for the night routine (the owner, 2026-10-03: cloud work runs while the workstation
sleeps, so the two never share a usage window). A session started by the night routine treats `night` exactly as
`ready`; any other session leaves them.

**`after env` rows** wait for the owner to switch the cloud environment's network access to full; the owner sets them to
`ready`, and no session claims one before.

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
| 23 | **TOTAL** — total time on phone-like links, the measure that decided against AV1 before: HTJ2K against every AV1 form, per taxonomy series | done `bc35549`, `b5e10ab` — **top11+low wins where the wire is the clock, HTJ2K where a slow CPU meets a fast link**: 14 rounds, then 10 replicated in a second container, 121 222/121 222 frames exact; on the 12-bit series top11+low fills at 0.93–0.98 of HTJ2K's time at 1× on every link; at 4× on 50 Mbit dav1d-WASM intra takes 1.40–2.22× and WebCodecs 1.17–1.38×; the RGB ultrasound loses 10–19 % wherever the wire is the clock; HTJ2K has the first frame on every cell; the fluoroscopy's preview is playable in 0.34–0.45 s at 1× and 0.83–1.2 s at 4×, against 1.7–15 s for every exact frame; the decode-bound cells move 15–25 % between containers, so only the ranking is claimed — [`README.md`](README.md) §Total time |
| 24 | **SVCDEC** — a scalable payload in the client: the base operating point first, the exact frame from the same bytes | done `0db594f` — **built: the base reaches the page as a preview, then the exact frame, from the same bytes, through dav1d-WASM**; the cause of row 18's failure was the wrapper keeping one picture a unit (dav1d at `all_layers` 1 outputs the base while the top is still queued), so it now drains the unit (`av1_next`, `av1_layer`, `av1_top_layer`; 623 146 B); a picture below operating point 0's top goes to `onPreview` as a frame marked `preview: true` at its own size, never to an ask or `onFrame`; one port, so a preview always lands before its frame and never after; 10-bit G = 1 (asked) and 12-bit G = 8 (20 filled), two spatial layers, half-size base at q 40: every exact frame its source's at 64×48, one preview a frame, 32×24, identical to native dav1d at operating point 1; a unit without its top shows its preview, still marked, and fails by name (`spatial layer 0 of 1 is the unit's last`); single-layer series send none; WebCodecs (≤ 10 bits) exact, no preview (row 31); a base fed alone at operating point 0 is a preview and then a failure, so §5's base entry needs the decoder told; dispatch 181 → 199/199, 8 mutations caught 8/8, gate green; not timed — [`adr-unit.md`](adr-unit.md) §6, [`client/downloader/README.md`](../../client/downloader/README.md) |
| 25 | **SVCSHAPE** — the scalable shape with the least overhead: layers, scale, base quality, per content | done `ba38035` — **a quarter-size base at q 40 has the least overhead on every series**: libaom 3.15.1 `svc_encoder_rtc` (SVCQ's patch), 20 shapes × 9 series of rows 2, 10, 21 (spatial ½ and ¼, a full-size lossy base, three layers, L1T2/L1T3, L2T3, base q 20/40/60, keyframe every 1, 8 or one), over 12 bits the two low bits apart; 180/180 codings exact, 387 frames each; quarter total 0.968–1.003 of single-layer lossless AV1, its exact frame 0.97–1.06× single's decode at 1× and 0.97–1.10× at 4× (dav1d-WASM, Chromium 141, n = 10 interleaved, 8 640/8 640 frames exact), base 0.01–0.36 % of HTJ2K's bytes at 30 dB (ultrasound) and 34–47 dB (grey), so a series' bases are playable in 0.01–0.11 s at 1× and 0.06–0.5 s at 4× on 5, 20 and 50 Mbit/s alike (arithmetic, decode-bound) against 16–60 s for the exact series at 5 Mbit/s; a full-size q 20 base is 1–5 % smaller on CT, MR, fluoroscopy and ultrasound but decodes 5–32 % slower; a third layer, temporal layers (−3 to +4 %, an exact base at 16–44 % of HTJ2K), L2T3 (+3–6 %) and shorter keyframe intervals buy nothing; every shape keeps lossless AV1's size, 0.94–1.59 of HTJ2K's; 7 mutations caught — [`lab/av1/svcshape`](../../lab/av1/svcshape/README.md), [`README.md`](README.md) §A5 |
| 26 | **SVCORDER** — delivering bases first: what the store and the group-as-item model need (a proposal) | done `089f322` — **proposed: each frame as two entries, layer-major — the base alone (entry i), then the whole temporal unit (entry F + i)** — so a fill over the bundle is every base and then every exact frame, with the wire, the store's format, the planner and the server unchanged and an ask for exact N one entry and one decode at G = 1; costs the base's bytes twice (0.07–2.4 % of HTJ2K's at a half-size base, q 40, row 18) and a second decode of each base (2–13 % of a lossless frame's); a top-only entry (no duplicate) breaks the exact frame's independence, a per-layer byte range changes the wire and the server; WebCodecs picks the layer by what it is fed; 5 invariants named broken; the arm: single-layer AV1 against bases-first on row 11's harness after rows 24–25; nothing measured — [`adr-unit.md`](adr-unit.md) §5 |
| 27 | **DECSPEED** — the decode is what loses on a phone: encoder settings and decoder threads that cut it, lossless kept | done `1c9794f` (`163460f`, `618e6e0`, `f6c205e`) — **tiles and threads cut a frame's decode, not a fill's**: a lossless frame is 66–84 % entropy decoding; no encoder setting cuts it more than 10 % (presets, 64² superblocks, intra tools off, at +6–72 % bytes); dav1d-WASM threads do nothing untiled, and with 4 tile columns (+0.1–0.4 % bytes) × 3 threads a frame takes 0.37–0.44 of its time (fluoroscopy 29 against 76 ms at 1×, 116 against 314 at 4×), still 2.6–2.9× HTJ2K; through the fill at 50 Mbit, 4× as three slowed cores, 12 rounds, 24 528/24 528 frames exact, every threads × decoders arm is within −3 to +4 % of today's three decoders (+11–15 % oversubscribed on MR): best, 1 decoder × 3 threads on 4-tile frames, 1.81–2.39× HTJ2K's fill at 4× against today's 1.82–2.32× — [`README.md`](README.md) §A1, [`lab/av1/decspeed`](../../lab/av1/decspeed/README.md) |
| 28 | **LLSIZE** — closing lossless AV1's byte gap to HTJ2K with AV1 alone | done `db802d9` — **AV1 alone is under HTJ2K on every series at G = 1, 0.902–0.987, once its samples are represented for it**: libaom 3.15.1 cpu0 intra, first 2–8 frames of all nine series, every coding exact; the two low bits apart on grey at every depth over 8 (fluoroscopy 1.027 → 0.942, 12-bit tomosynthesis 1.040 → 0.941, MR 1.013 → 0.977, 10-bit tomosynthesis 0.977 → 0.942) and JPEG 2000's reversible colour transform on RGB (ultrasound 1.117 → 0.962), plus `--tune-content=screen --sb-size=64` for 0–1 %; CT 0.902, cone-beam 0.987, projections 0.953 and 0.923; libaom's other controls (superblock size, all-intra, palette/intra block copy alone) 0–1 %, every optional intra tool off +6–64 %, SVT-AV1 0.98–1.08 and never smaller, YCoCg-R 1.2 % behind the RCT, one or three low bits worse than two; no libaom release after 3.15.1; decode (dav1d-WASM, Node, n = 15 interleaved) the colour transform 0.89–0.95× row SIZE's coding, the split +1–5 % on large frames and +16–23 % on 512² MR and 10-bit tomosynthesis; **inter pays on the colour-transformed ultrasound: one keyframe in 8, 0.850 of HTJ2K** (GBR inter 1.355), decoding 0.81–0.83× GBR intra; on grey inter is level or worse; 7 mutations caught — [`lab/av1/llsize`](../../lab/av1/llsize/README.md), [`README.md`](README.md) §A1 |
| 29 | **SWEEP** — AV1-only options nobody has listed yet: a read-only identification sweep | done `8f257a2` — **three options worth a row, four not, phones blocked**, read from primary sources (AV1 spec `5e04f3f`, dav1d 1.5.4, libaom 3.15.1, Chromium `d84e3b8`, WebKit `10740b3`, Android framework `1cdfff5`, AVM `v1.0.0`), nothing run: WebCodecs' `optimizeForLatency` is dav1d's `max_frame_delay = 1` in Chromium — the cause of WCAP's two frames held until `flush()` and of the flush per unit that keeps WebCodecs at G = 1 (row 30); the base layer through WebCodecs by dropping OBUs with `spatial_id` > 0, since Chromium's dav1d at `all_layers = 0` outputs the highest layer it holds (row 31); AV2's AVM v1.0.0 (2026-05-27) has lossless, monochrome and 10/12 bits, its lossless gain claimed, unconfirmed (row 32); S-frames cannot switch exactly (other references), super-resolution breaks `AllLossless` (libaom disables it under `--lossless`), large-scale tile is camera-array only and dav1d lacks it, reference scaling is already the spatial layers; Android names AV1 Main 8/10 only and guarantees level 4.1 (2 359 296 samples, under the 4.9 and 2.6 M-sample projections), WebKit's in-process WebCodecs AV1 takes 8-bit 4:2:0 only (Blocked) — [`README.md`](README.md) §Options to try |
| 30 | **WCLAT** — WebCodecs with `optimizeForLatency`: a frame out per unit without a flush, groups through WebCodecs, and tiles | done `e41701b` (`b12ae2d`, `1c99323`, `841da6d`) — **yes: with `optimizeForLatency` every unit gives its frame without a flush, exact, and a group now goes through WebCodecs**: headless Chromium 141, libaom 3.15.1, 28 streams (8/10-bit 4:0:0, 4:2:0, 4:2:2, 4:4:4 identity, intra and G = 8; fluoroscopy top10 and ultrasound at 1/2/4 tile columns), 784/784 frames out per unit and exact, 0/784 with neither option; skipping the flush 7–20 % faster a frame at 1×, 3–28 % at 4× (10 interleaved rounds), but a keyframe needs one (else a non-keyframe labelled key decodes against the last frame), and flushing before each costs as much — so `decode-av1-webcodecs.js` flushes at a group's end (G = 1 unchanged) and before a keyframe only while a cut group is held, a stalled unit after 2 s; 4 tile columns 33 → 15 ms (1×), 118–135 → 66–70 ms (4×) at −0.6 to +0.4 % bytes; dispatch 209 → 219/219, each guard mutated to fail — [`decode/README.md`](../decode/README.md) §WebCodecs without a flush, [`lab/av1/wclat`](../../lab/av1/wclat/README.md) |
| 31 | **WCBASE** — the base operating point of a scalable payload through WebCodecs, by dropping the top's OBUs | done `5c193e6` (`7718c88`) — **exact, and faster than dav1d-WASM's preview except on small grey bases at 1×**: row SVCQ's two-layer payloads (q 40 base, half and full size, one keyframe and G = 1) on the ultrasound, the fluoroscopy and MR as their top 10 bits and synthetic grey 10 / RGB 8; the unit with the OBUs of `spatial_id` > 0 dropped — its prefix, byte for byte the encoder's base-only stream, 762/762 — gives through WebCodecs the base identical to native dav1d's at operating point 1, 534/534, and the whole unit the exact frame, 534/534; 12 bits refused (row 3); a flush per unit needs G = 1 (a key chunk after every flush: −1 to +1 % bytes on grey, +7–13 % on the ultrasound), past G = 1 `optimizeForLatency` gives each base from its own unit, 0/178 late; unit to picture in the contract, headless Chromium 141, 15 interleaved rounds: 0.65–0.66× dav1d-WASM's preview on the ultrasound at 1× (5.5 against 8.4 ms), 0.36–0.76× on every series at 4× (faster in 87/90 paired rounds; 12.6 against 36.5 ms), 1.10–1.31× on the 2–4 ms grey bases at 1×; the base 7–36 % of WebCodecs' exact frame; 19 440/19 440 timed pictures matched; 3 mutations caught (top OBUs kept, base OBUs dropped, a sample flipped); the scalable encoder's lab patch gains `--rgb` (sRGB tags, identity matrix), which WebCodecs needs; not built into the product — [`README.md`](README.md) §A5, [`lab/av1/wcbase`](../../lab/av1/wcbase/README.md) |
| 32 | **AV2** — AVM v1.0.0 lossless: bytes and decode against libaom 3.15.1 and HTJ2K | done `c7ffb30` — **AV2 is the smallest lossless coding on grey up to 13 bits but CT, at 50–110× libaom's encode time**: AVM v1.0.0 has no profile over 10 bits, so 11–14-bit samples are coded split (v ≫ k at 10 bits + the k low bits); one middle frame a series, 68/68 cells exact through `avmdec`; at `cpu-used` 0 it is 0.937–0.964 of HTJ2K on fluoroscopy, MR, cone-beam and both tomosynthesis volumes, 0.4–4.7 % under libaom on the same planes; libaom's 12-bit split stays 3–8 % smaller on CT and the 14-bit projections; the RGB ultrasound is 1.648 against libaom's 1.117; four tomosynthesis slices as one group 0.922 against libaom's 0.978; 450–11 900 s to encode a frame, native decode 3.1–6.5× dav1d's; no browser decoder exists — [`lab/av1`](../../lab/av1/README.md) §AV2 |
| 33 | **REP14** — the layout of 13- and 14-bit samples: two low bits apart (12-bit top, dav1d only) against streams of ≤ 10 bits (WebCodecs), by total time | done `a07b1ab` (`858777a`, `dd41eea`) — **at 13 bits top10+low through WebCodecs, at 14 bits the two low bits apart where the wire is the clock and HTJ2K where it is not**: libaom 3.15.1 `--tune-content=screen --sb-size=64` cpu0, every frame of the two 14-bit projection series and the CT; bytes over HTJ2K d12 (v ≫ 2 at 12 bits + 2 low) 0.953/0.923/0.917, w10 (top 10 + 4 or 3 low) 0.999/1.046/0.931, the fastest preset within 2 % (`--allintra` 7/9, cpu6 on the CT) +0.0–1.3 %; decode in Chromium through `decoder.js` w10 by WebCodecs 0.37–0.51 of d12's, still 2.6–2.8× OpenJPH; total time, 12 rounds on row TOTAL's links, n = 10–12: CT w10 0.87–0.96 of HTJ2K on every cell (d12 1.52 at 4× on 50 Mbit), projections d12 0.93–0.99 at 1× and at 5 Mbit, 1.01–1.63 at 4× on 20 Mbit and faster, w10 0.98–1.13; 9 920 + 44 640 frames exact — [`README.md`](README.md) §A3 |
| 34 | **TOTAL2** — row 23 again with row 28's representations, and the colour-transformed ultrasound at G = 8 through WebCodecs | done `b1ef1f2` (`d649cb8`) — **through WebCodecs row LLSIZE's codings fill first on 22 of 24 cells, losing only at 4× on 50 Mbit**: fluoroscopy, both tomosynthesis volumes and the ultrasound, 5/20/50 Mbit at 1× and 4×, 932 of 1 022 visits kept, n = 10–15, 38 744/38 744 frames exact; the two low bits apart (top ≤ 10 bits, 0.942–0.944 of HTJ2K's bytes) through WebCodecs 0.94–0.97 of HTJ2K's fill time but 0.99–1.02 at 4× on 50 Mbit, through dav1d-WASM 1.43–1.62 there; the ultrasound, HTJ2K's on every cell in row 23, is AV1's with the colour transform (0.958 intra, 0.948 at G = 8 over all 70 frames, not row 28's 0.850 on 8), 0.95–0.97 but 1.06 (intra) and 1.16 (G = 8) at 4× on 50 Mbit; first frame through WebCodecs −38 to +88 ms of HTJ2K's; `rct` built into the client (dispatch 227/227, 3 mutations caught) — [`README.md`](README.md) §Total time, [`lab/av1/total`](../../lab/av1/total/README.md) |
| 35 | **DATA2** — breast ultrasound cine and contrast angiography, if their hosts are now reachable: bytes, decode and total time | done `e8896ae` — **stopped at its first step: the hosts are still refused** — `zenodo.org` and `www.cancerimagingarchive.net` (and `services.cancerimagingarchive.net`, `figshare.com`, `data.mendeley.com`, `huggingface.co`, `physionet.org`, `www.kaggle.com`, `osf.io`) answer CONNECT 403 from the container's egress policy, 2026-10-04 20:43 UTC; nothing fetched or measured, no verdict on breast ultrasound cine or angiography — [`## Blocked`](#blocked) |
| 36 | **ENCX** — where lossless bytes and decode can still be cut: the low stream, the split per series, temporal noise, and whether HTJ2K gains from the same representations | done `e0ba8e1` (`67fba68`, `84a1e15`, `bf9d1df`, `c7f8b68`) — **HTJ2K gains 0.9–1.6 % from the same split, only with its low bits deflated, so row 28's gain is AV1's (0.916–0.997 of HTJ2K on the same split); the low bits deflated cost AV1's bytes ±0.5 points and decode 0.64–0.83× of row 28's coding**: all nine series, libaom 3.15.1 cpu0, 358/358 codings exact; three low bits beat two on the four series with noise σ ≥ 17 (0.5–3.9 %, cone-beam 0.987 → 0.948; row 28 tried three at libaom's defaults only, corrected in place), decoding 0.59–0.78×; the top through WebCodecs (≤ 10 bits, k = 3 brings CT and cone-beam there) with the low deflated 0.34–0.56× of row 28's decode, 2.1–3.4× HTJ2K's (headless Chromium 141, 1× and 4×, 10 interleaved rounds, 7 100/7 100 frames exact); k̂ = ⌊log2 σ⌋ wrong on four series, ⌊log2 σ⌋ − 1 right on all nine but fitted to them; inter finds nothing in the noise (low stream inter 0–3.6 % larger); libaom's tools: palette worth 4.5–9.2 % and already on, the rest ±1 %; total time arithmetic only (row 34); 9 byte and 4 browser mutations caught — [`lab/av1/encx`](../../lab/av1/encx/README.md), [`README.md`](README.md) §A1 |
| 37 | **XBROWSER** — the AV1 decode path (dav1d-WASM, the WebCodecs probe and its fallback) in WebKit and Firefox engines: exact, chosen right, how fast | done `da7c3b6` (`d43145e`, `4b4efcc`) — **dav1d-WASM and OpenJPH exact in Chromium 141, Firefox 157 and WebKitGTK 2.52; the client's WebCodecs choice exact in Chromium only**: first 4 frames of all nine series and an 8-bit grey set in every row-28 layout, stock engines (Playwright's builds refused), 6 interleaved rounds at 1× and 4×; dav1d-WASM 408/408 and HTJ2K 240/240 a cell in every engine, 4.1–9.6× OpenJPH at 1× and 3.9–10.0× at 4× (slower in 732/732 paired rounds), each engine 0.85–1.22× Chromium's time on the same arm; the SIMD build loads in all three, and OpenJPH needs SIMD as well; WebCodecs (chosen at `depth` ≤ 10) 240/240 in Chromium at 2.6–5.0× OpenJPH, **0/240 a cell in Firefox** (monochrome refused, 4:4:4 returned as 8-bit `BGRX`) **and WebKitGTK** (GStreamer's `av1dec` takes no AV1 here, 4:2:0 controls included), with no fallback to dav1d; WebKitGTK as shipped has no `SharedArrayBuffer`, so HTJ2K fails too (0/148); a decode probe with fallback proposed, not built; desktop engines in a container, not phones; 5 mutations caught — [`decode/README.md`](../decode/README.md) §AV1 in WebKit and Firefox, [`lab/av1/xbrowser`](../../lab/av1/xbrowser/README.md) |
| 38 | **FOOTPRINT** — the AV1 path's memory and first-use cost: dav1d-WASM heap per worker at the largest frames, and the first item's import and compile at 1× and 4× | done `0a73811` — **a dav1d-WASM worker costs 31.6 MB resident [31.2–32.2] on the 4.9 M-sample projections against HTJ2K's 24.6 (adopted wrapper; 26.1 the package), 7.6 against 7.1 on the RGB ultrasound; first use is HTJ2K's**: headless Chromium 141, product worker, renderer RSS slope over 1/2/4 workers, 6 rounds; its WebAssembly heap 19.7 MB after one projection, 34.8 by the series' end (16.4 ultrasound), flat over a second pass, never returned; WebCodecs 5–10 MB settled, peaks 32–58 MB a worker outside its heap; a fresh AV1 worker ready in 28–39 ms at 1×, 84–93 at 4× (HTJ2K 30–41, 96–115), first-frame surcharge 65–97 / 200–280 ms against 45–82 / 164–225, 12 rounds cold and cached, the cache 5–11 ms off init; 13 440/13 440 frames exact, 4 mutations caught — [`README.md`](README.md) §A2, [`lab/av1/footprint`](../../lab/av1/footprint/README.md) |
| 39 | **UNIFY** — one AV1 branch on the cleaned `main`: this branch's AV1 work merged onto it, and the item format of [`item-format.md`](item-format.md) (plain and optimized) built end to end | done `3233a06` (`824f634`, `c5e8b88`, `3188af0`) — **built on `claude/av1-unified`, cut from `origin/main`: the merge conflicted in 8 files (the downloader's `decoder.js`, `consumer.js`, `downloader.js` and README, the dispatch rig, the root README, and the two AV1 warm-up frames in a directory `main` renamed), each resolved on `main`'s code — the warm-up dropped with `main`'s, `connect`'s option pass-through and decoder-loss handling kept, the codec check, groups, preview port and decoder seam re-applied; the item format end to end: `ingest.py` writes nothing unless every item decodes back through native dav1d (3 mutations caught), `pack-study` bundles `NNN.av1`, the reader refuses 14 header and 6 decoded-stream cases by name, WebCodecs per item behind 16×16 per-layout probes with dav1d-WASM as fallback, a failed import retried, a late frame never taken; 14 golden items (7 shapes × plain, optimized) exact in Node and headless Chromium through both decoders; 96 real items (fluoroscopy, CT, MR, ultrasound, 8 frames, both representations) exact, optimized over plain 0.918/0.990/0.964/0.861, row 28's ratios; `av1.test.mjs` 60/60, dispatch 327/327, downloader 56/56, gate green; 18 product mutations caught** (RGB needs the sRGB tag for WebCodecs to report no matrix) — on `claude/av1-unified`: `lab/av1/item/README.md`, `item-format.md` §Built |
| 40 | **SVC** — scalable payloads end to end in the lab: bases first, then the exact frames (row 26's proposal), measured as time to first picture and to exact | done `5f41f5f` (`cfb26b4`, `078d1b3`) — **every frame is on screen as its base 10–101× sooner than HTJ2K's exact series at 1× (3–45× at 4×), and the exact fill costs 0–8 % over the same encoder's single layer**: row SVCORDER's layer-major layout built in the lab (entry i the base, F + i the whole unit; a lab decoder worker through the downloader's `decoderWorker` seam, downloader, server and store unchanged), row SVCSHAPE's quarter-size q 40 base, one keyframe, fluoroscopy and ultrasound, 5/20/50 Mbit at 1× and 4×, 13 interleaved rounds, n = 4–13; every frame shown in 0.13–0.15 / 0.33 s at 1× and 0.33–0.36 / 1.0–1.1 s at 4× against HTJ2K's 1.7–15.2 / 3.2–29.4 s; bases 0.06 / 0.35 % of HTJ2K's bytes again; the shape's one group on one decoder and lossless SVC's 1.07 / 1.59 × HTJ2K's bytes leave its exact series 1.07–7.4× HTJ2K's time (4.5× / 7.4× at 4× on 50 Mbit, intra AV1 1.8× / 2.3×); 27 456/27 456 frames exact, 6 864/6 864 bases as native dav1d at op 1, none late; 5 mutations caught — [`README.md`](README.md) §A5, [`lab/av1/bases`](../../lab/av1/bases/README.md) |
| 41 | **FASTHTJ2K** — faster HTJ2K decode in the browser: where OpenJPH-WASM's time goes, what GPU decoders move to the GPU, whether WebGPU can, and the CPU levers not yet tried | done `1740238` — **the HT block decoder is the clock, and only threads inside a frame move it**: OpenJPH 0.31.0 profiled in headless Chromium 141 on 8 frames of seven real series at 1× and 4× (560/560 exact): HT block decode 55–70 % of a frame (cleanup passes only, already WASM SIMD), code-block to line 6–7 %, inverse wavelet 5–10 %, colour 2 % on RGB, wrapper pack 4–10 %, copy out 7–15 %; **a WebGPU wavelet bounded out** — ≤ 6–12 % to save against three times the bytes the copy out already moves (projections 2.8 ms saved, 29.5 MB to and from the GPU a frame); no WebGPU/WebGL JPEG 2000 decoder exists; WebGPU on Chrome Android 121+ and iOS 26; the container has no GPU (SwiftShader only); **code-blocks decoded in parallel (lab patch) 0.69–0.91 of a frame at 2 threads, 0.59–0.61 at 4 on the 1914×2572 projections only** (6 rounds interleaved, 1× and 4×, 2 688/2 688 exact, 2 mutations caught 56/56), an ask's lever, not a fill's; copy out and pack bounded at ≤ 15 %, OpenJPH 0.32.0 changes one mask in the WASM decoder — [`decode/README.md`](../decode/README.md) §Faster HTJ2K in the browser, [`lab/av1/fasthtj2k`](../../lab/av1/fasthtj2k/README.md) |
| 42 | **TOTAL3** — total time with row 36's encoding findings (low bits deflated, k per series, the top through WebCodecs) against HTJ2K and the plain AV1 control | done `f2b9c15` (`d6a3f78`, `1ab5ee5`) — **row ENCX's changes buy 3 % where a slow CPU meets a fast link and ±0.6 % elsewhere**: fluoroscopy, both tomosynthesis volumes and the ultrasound, 5/20/50 Mbit at 1× and 4×, 13 rounds, 1 026 of 1 170 visits kept, n = 5–13, 38 532/38 532 frames exact; x36 (low bits raw-deflated, k = 3 where σ ≥ 17, top through WebCodecs, a lab worker) over the adopted representation 0.969–0.972 at 4× on 50 Mbit, 0.990–0.997 elsewhere on the k = 3 series (bytes −0.2 to −0.5 %), 1.003–1.006 on the 10-bit volume (deflate alone, +0.4 % bytes); over HTJ2K x36 0.94–0.97, and 0.98–1.00 at 4× on 50 Mbit where the adopted one is 1.00–1.02; the plain control 1.03–1.13 of HTJ2K where the wire is the clock and 1.27–1.65 at 4× on 50 Mbit (the 10-bit volume 0.98–1.01, 1.19) — [`README.md`](README.md) §Total time |
| 43 | **SPLITOK** — the bit split exact at every depth 8–16 and every layout k a rule could pick, unsigned and signed, through every decoder and engine, before any per-depth rule is adopted: correctness only, nothing timed | done `e8fbe5a` on `claude/av1-unified` (`b7d055d`, `6c3fc26`, `7f8bbfe`, `9a5a95f`) — **exact at every b = 8–16 and every k = max(0, b − 12) … max(b − 8, 4), unsigned and signed, through every decoder in every engine; nothing refused**: the item format widened (bits ≤ 16, split ≤ 8, depth the smallest container of the top) and the reader's signed mask corrected (the old one reports a wrong range at 9 of 162 widened cells); every value split and merged back in writer (142/142, 20 tops over 12 bits refused by name) and reader (162/162); synthetic 8 280 frames (1 260 cells, 1-pixel to 256², cpu0 and allintra 7) and 540 of 1914×2572 and 4096×5120 (180 cells), and all nine real series at every k, cpu0 and shipped preset (82 cells, 3 310 frames), each exact natively, in Node and in Chromium, Firefox 157 and WebKitGTK 2.52 with every stream as planned and the decoder as expected (Chromium WebCodecs wherever every stream ≤ 10 bits: 6 256 + 408 + 2 254 frames); 90 golden matrix items exact in Node and Chromium; 20/20 mutations caught — `lab/av1/splitok` §Checked, `item-format.md` §Built, README §A3 |
| 44 | **SPLITTIME** — the per-depth layout rule by bytes, decode and total time: HTJ2K against d12, k = 2, k = 3 and w10 at 13–16 bits, the 9–12-bit series as controls | claimed 2026-10-06 (night) |
| 45 | **DATA3** — the taxonomy's missing content and depths: breast ultrasound cine, ABUS, angiography, FFDM and synthesized 2D, real 9-, 15- and 16-bit and more signed series; exact and bytes per layout, or the hosts to allow | done `09381e3` on `claude/av1-unified` (data `1e10f8f`, `5d548a7` here) — **every frame of the nine series exact at every k of its depth, natively (45/45 cells, 2 825 frames), in Node (2 825/2 825) and in Chromium, Firefox and WebKitGTK at k = 2, 3, b − 10 (1 358/1 358 each, decoders as expected); no one k wins**: best arm over HTJ2K at cpu0 — MR 9-bit 0.910 (k = 0), synthesized 2D 0.938/0.951, FFDM 0.986/0.989 (one vendor's a stretched range, plain 1.29), signed CTs 0.899/0.939, PET 15-bit 0.996 and film 16-bit 1.001 (w10); plain and optimized refuse 15–16 bits and k = 3 the film, by name; breast US cine and ABUS per row 46 — `lab/av1/breast/README.md` §Row DATA3's series, README §A3, `FIXTURES.md` §AV1 data |
| 46 | **BREAST** — the breast family's missing content (breast ultrasound cine and stills, ABUS, more DBT, FFDM and synthesized 2D), measured as the targets: exact per decoder path, bytes per layout against HTJ2K, intra against inter at G = 8 and 16 in real slice and frame order | done `3d5efa8` on `claude/av1-unified` (`df98f9b`, `d5cc1ae`; data `7d1552f` here) — **ten breast series added, all CC BY; inter does not pay on DBT and pays on the grey cine only because that clip is a lossy recording**: three more DBT systems' volumes/projections, two FFDM, two synthesized 2D (IDC), breast US cine grey and RGB and stills (Zenodo), 297/297 frames identical to an independent read; nothing presented or reconstructed exceeds 12 bits (projections 14, a film 16); every item exact natively, in Node (64/64 cells, 405/405 frames) and Chromium (WebCodecs 289, dav1d-WASM 116, each as expected); optimized item 0.873–0.962 of HTJ2K on 8 of 10 at cpu0 (stretched-range FFDM 1.006, stills 1.002); inter G = 8/16 on four DBT slice series 0.963–1.054 of intra at cpu0, 0.998–1.050 at good 6, RGB cine 0.98–1.00, grey cine 0.53–0.56 (0.47 of HTJ2K, decode 0.56×); 42/42 inter cells and 4/4 mutations; ABUS has no open licence, no third DBT vendor is open (§Blocked); gate not run (no `wasm-pack` here; no client or server code changed) — `lab/av1/breast/README.md`, README §A1 §A3, `FIXTURES.md` §AV1 data |
| 47 | **MIXDEC** — each stream of a split item through its own decoder: a top over 10 bits through dav1d-WASM, the 8-bit low through WebCodecs, against both through dav1d and against w10 | done `1d14b07` on `claude/av1-unified` (`5ae7778`, `59c9d3e`, `1f8facb`, `ec767e1`, `e46a962`) — **the low stream is 17–38 % of a 13-bit frame's dav1d-WASM decode and 34–54 % of a 14-bit one's, and mixed takes all of it off, but w10 stays faster**: built behind decoder config `mixed` (off by default; the low to WebCodecs before the top's dav1d-WASM decode, dav1d-WASM wherever the `g8` probe fails); exact on every frame of the six 13- and 14-bit series at every k (1 113/1 113 an engine) and row 43's synthetic set (8 280/8 280 an engine) in Chromium 141, Firefox 157 and WebKitGTK 2.52, each stream from the decoder expected (Chromium mixed, the other two dav1d-WASM); 11/11 mutations caught; decode (n = 10 interleaved, 1× and 4×) 0.46–0.87 of today's, faster 120/120, 1.04–2.16× w10's; fill at 4× on 50 Mbit (n = 10–12, 35 616/35 616 exact) 0.77–0.90 of today's (131/131), 0.91–1.14 of w10's (ahead on the 14-bit projections, where w10's bytes are 1.007–1.059 of HTJ2K's), 0.93–1.18 of HTJ2K's (winning on two CTs, where today loses 18–23 %); 20 Mbit not claimed (88 of 144 visits `VOID`); whether the flag becomes the client's choice is the owner's — `lab/av1/mixdec`, README §A3, `decode/README.md` §AV1 |
| 48 | **SPLITLIT** — is splitting samples into top and low streams a recognised, recommended way to code high-bit-depth images losslessly with codecs limited to ≤ 12 bits, and what are the alternatives? | done `0655a4a` — **known, not recommended: the split is published (2011–2024: aerospace video, infrared, depth, CT) and patented (2006 priority on), and no standard or DICOM text recommends it**; the low part is noise in every source (CT's low byte 5.0–6.8 of 8 bits); the noise-floor rules (log2 σ + 1.79, Rice k ≈ log2 σ − 0.3) put k at 4–6 on the four σ ≥ 17 series, where row 36's oracle searched only k ≤ 3 and hit 3 on all four; histogram packing is the offset's published alternative (−42 % CT, −51 % MR bits a pixel on sparse histograms, JPEG-LS); over 12 bits no browser path is exact but WASM (HTJ2K, JPEG-LS, JPEG XL) — [`split-prior-art.md`](split-prior-art.md) |
| 49 | **DECODE** — the HTJ2K and AV1 decoder workers rethought: zero-copy hand-off, fewer allocations, one decode interface for both codecs | done `ed276d2` on `claude/av1-unified` (`ddc3bee`, `8dea929`, `0092b8a`, `dfac775`, `34f00f0`) — **one codec-module interface, and HTJ2K 12–21 % off a grey frame; no zero-copy hand-off, and AV1's one allocation saved costs more memory than it pays**: `decoder.js` loads `htj2k.js` or `av1.js` behind one `init`/`decodeFrame` and has no codec in it; the HTJ2K range pass in two loops (V8 does not hoist the per-sample branch) took decode through the product's worker ×0.79–0.88 on every 10–14-bit grey series at 1× and 4× (7/8–8/8 rounds; mammogram 91.5 → 75.7 ms, 389 → 313 at 4×), the RGB control a tie; headless Chromium 141, the first 4 frames of 7 breast series and the fluoroscopy, 8 rounds interleaved, 1 024/1 024 frames exact a throttle; WebCodecs copying into a reused buffer measured ×0.91–0.96 and **reverted**: it held 37 MB a worker on a mammogram (settled RSS slope 7.3 → 44.4 MB) for a gain the fill hides; the fill (row 23's harness, 20/50 Mbit, 1×/4×, 6 rounds, 20 544/20 544 exact) moves 0.5 % pooled, 1.5–3 % on the 2560×3328 frames at 4×; HTJ2K's memory unchanged; a hand-off with no copy needs the frame's storage in the decoder's heap and a release from the page — a contract change, proposed only if a phone shows the copy is the clock; 5 mutations caught — [`decode/README.md`](../decode/README.md) §The decoder worker's hand-off, `lab/av1/decode` |
| 50 | **CLIENT** — the downloader, worker and consumer state machines: the two re-dial defects fixed, the untested decisions tested, the states simplified | done `878701b` on `claude/av1-unified` (`f2cd822`, `1aef11d`, `f136363`) — **both re-dial defects fixed and every decision held by a test; four dead checks removed, the fill's time unchanged**: (1) a cancel during a resume could not take back the run its dial's URL carried — `connect()` now ends that stream; (2) `close()` during a re-dial let `resume()` adopt the new session — a dial opening after close is closed; each a clause that failed before. A sweep of 76 mutants over `downloader.js` and `consumer.js` left 32 alive: the 21 untested decisions (least-busy dispatch, a fill skipping recorded frames, a lost decoder before the dial, recycling at ¾ of the budget and its owed asks, an ask alone on a closed or silent session, a resume with nothing owed, spent re-dials naming asks and being given back, `undefined` options, a refused first dial, a command during a resume, a cancel releasing a group's decoder, failures of a cancelled request from a dial or a decoder, a duplicate ask, `resumedAt`/`recycledAt`, `groupLength` and isolation refusals) each now killed by its test (17 dispatch clauses, `consumer.test.mjs`), 4 dead (promote's guard and pump, the record's generation, `lastChunkMs`'s fallback) removed, 7 left with reasons; `epoch`/`generation`, `resuming`/`dialling` and the three record states kept, each read; dispatch 695 → 719/719; fill after/before 0.99–1.00 in all 8 cells (fluoroscopy and 10-bit DBT, 20/50 Mbit, 1×/4×, 10 rounds interleaved, 3 360/3 360 frames exact); the gate's link check is red on that branch from row 61's `delivery-prior-art.md` (4 links), not this row — [`ARCHITECTURE.md`](../ARCHITECTURE.md) §The downloader, `client/downloader/README.md` |
| 51 | **SERVER** — the send path rethought: the per-send copy, mmap against pread, what each layer does that it need not | done `58e3b06` on `claude/av1-unified` (`16458c6`, `bbde485`) — **nothing adopted: the send path has no per-frame cost left that large frames expose, and the memory they leave is the allocator's**: loopback, 2 server cores, n = 6 interleaved, no PMU (rusage); CPU per byte flat 250 kB → 16 MB (1.5–1.7 µs/kB at 16 sessions, 2.3–2.6 at one); after 16 sessions of 16 MB frames ~800 MB stays resident; a 16 MiB byte-capped pool cut it 32 % (6/6) for +8.4 % CPU (0/6 lower), `MALLOC_MMAP_THRESHOLD_` 1 MiB cut it 46–57 % (6/6) at a CPU tie to +5 % (2/6) — the owner's deployment call; 50 Mbit fill time not run, nothing changed; `docs/adr/disk-access.md` §11 *Frames past 250 kB* |
| 52 | **INGEST** — the HTJ2K and AV1 ingest tools as one pipeline: fewer passes, the round-trip check's cost, parallel encode, bytes identical | done `16c88a7` on `claude/av1-unified` (`c566011`, `2d77d7d`, `c70f858`, `9a19199`) — **one ingest for both codecs, every byte as before, HTJ2K's cheaper and AV1's a tie**: `ingest.py --codec htj2k` beside AV1, the check in-process (dav1d, OpenJPH); 69/69 cells byte-identical (23 sets × HTJ2K, AV1 plain, optimized, 2 088 files a side); the check 0.63–0.84 of the subprocess's time a frame on AV1, 0.37–0.46 on HTJ2K (n = 3, disjoint); a study's HTJ2K CPU −21 to −27 % and now parallel, AV1 within ±4 % (the encode is ~99 %), four workers 3.5–3.9×; 3 mutations caught; AV1 bytes depend on `--jobs` in both revisions (§Blocked); `lab/av1/item/README.md` §One pipeline |
| 53 | **SEAM** — the seams between transport, downloader, decoders and page: duplicated logic, dead paths, codec dispatch | done `56e5144` on `claude/av1-unified` (`8f82c1f`) — **two duplicates merged, no dead path found, the fill's time unchanged**: traced transport → `downloader.js` → `decoder.js` → `htj2k.js`/`av1.js` → `consumer.js`; the Emscripten glue loading (written out in `htj2k.js` and `decode-av1.js`) is `wasm-glue.js`, the unit-continuity refusal (written out in both AV1 decoder modules) is `continues()` in `av1-item.js` — one place each, not fewer lines (+26, −16); its mutant fails 3 dispatch checks; the codec is decided once (`consumer.js` refuses, `decoder.js` routes, `av1.js` picks the AV1 decoder); kept with reasons: owed frames held by both transport and records (one owner is a transport API change, structural), `groupLength` beside `decoder` in `init` (four lab workers speak it), groups, the preview port, `mixed`, `recycleAtBytes`, `openAsk: false`, `decode: false` (built, each reached by a clause); dispatch 719/719, conformance 56/56; fill after/before 1.00 in all 8 cells (fluoroscopy and 10-bit DBT, 20/50 Mbit, 1×/4×, 10 rounds interleaved, 3 360/3 360 exact) — [`ARCHITECTURE.md`](../ARCHITECTURE.md) §The seams, traced |
| 54 | **GATE** — the gate's run time, redundant tests and the gaps mutation finds | claimed 2026-10-07 01:11 UTC (night) |
| 55 | **NAMING** — every name audited against the round's principles; the clear renames applied with every reference | after 54 |
| 56 | **LAYOUT** — folders by responsibility, each doc where the repository's rules place it | after 55 |
| 57 | **VERSIONS** — newer libaom, SVT-AV1, dav1d, OpenJPH 0.32.0, Emscripten SIMD and threads, Chromium's WebCodecs: what each gains or breaks, the promising ones measured | done `56398cf` on `claude/av1-unified` (`2d6af24`, `6e354b0`, `293b4f0`, `b72ff30`, `5276b91`, `9073bdc`; `a6f960c` before) — **nothing adopted, no pin changed: no libaom, SVT-AV1 or dav1d release followed the pins, libaom's head writes the same bytes, and no decode lever clears the harness's spread**: libaom head `4cea455c` byte-identical to 3.15.1 on 11 series × cpu0 and shipped (80/80 items, all exact; 3.8.2 differs, the lever checked); dav1d head `7f12cf23` and emscripten 6.0.11 tie on dav1d-WASM (pooled 0.98–1.01); OpenJPH under emscripten 6.0.11 0.94–0.96 of 3.1.74 pooled, inside a 2–7 % spread at 6 rounds — the one lever worth a longer run; OpenJPH 0.32.0's WASM mask fix (24-bit code-blocks) unreachable at ≤ 16 bits, deep-bit-plane frames 12/12 exact, mutation 12/12 caught; 0.32.0's codestreams identical to 0.31.0's but the COM version (38/38); Chromium 154 ties on dav1d-WASM, item path 1.06 pooled, and still refuses 12-bit WebCodecs — libgav1's key-frame parse is built for 10 bits (141, 154, 155); headless Chromium 141 and 154, 1× and 4×, 6 interleaved rounds, 8 640/8 640 frames exact; gate green — `lab/av1/versions/README.md`, README §Measured here, `decode/README.md` §WebCodecs |
| 58 | **LITERATURE** — lossless medical image coding 2023–2026, and what of it runs in a browser today: research, rows proposed | done `5385a07` — **JPEG XL lossless is still the codec to beat; nothing published since 2023 that beats it runs exact in a browser but one unreviewed codec**: standard codecs on 16-bit CT/MR put JPEG XL at 0.85–0.95 of JPEG-LS and 0.82–0.91 of JPEG 2000 (BD-LVIC, TIP 2024), 0.78–0.95 of HTJ2K on four 16-bit CT and mammography frames (an industry white paper, 2024); learned and context-tree coders gain 3–20 % under JPEG XL on CT/MR volumes, but only integer or table-driven ones can be exact in a browser (WGSL float is not bit-reproducible): TCT (TIP 2026, 0.88–0.97 of JPEG XL, 0.05 s a slice on CPU, no code) and Tomoz (Apache-2.0, WASM, self-reported 0.73–0.85 of HTJ2K, unreviewed); no paper measures modern lossless codecs on breast imaging — rows 45–46 hold more; three measurements proposed (JPEG-LS in WASM, Tomoz, TCT when released); [`lossless-literature.md`](lossless-literature.md) |
| 59 | **RESLEVEL** — HTJ2K decoded at the resolution level a phone screen needs, exact, then full resolution on zoom | claimed 2026-10-07 00:09 UTC (night) |
| 60 | **LOSSLINK** — fill and on-demand time over links with 1–5 % packet loss and jitter, HTJ2K against AV1 | claimed 2026-10-07 00:07 UTC (night) |
| 61 | **TRANSFER** — how other systems deliver medical images, and what they do better than us: research, rows proposed | done `e11aea2` — **others deliver a frame's prefix first and the rest after; nothing they do survives loss better**: DICOMweb has no partial-frame retrieval but generic, optional HTTP Range (CP-2204); DICOM's HTJ2K RPCL syntax (Sup 235, TLM required) exists for prefix delivery, and an open-source viewer fetches a 128 KiB Range prefix of every frame, then `bytes=<held>-`, in strides of 4 (the committee's slides: 45 against 66 ms to first render over 4G, not reviewed); three cloud services document no partial retrieval; HTTP/3's streams buy little over one ordered stream under random loss (3 papers, 2021–22), as the shared stream found; QUIC FEC pays only on a transfer's tail (FlEC: 247 against 272 ms median, 50 kB with a loss) and no draft survives; `RESET_STREAM_AT` is in the RFC Editor queue (2026-09-06); four rows proposed, a plain HTTP/3 `fetch()` baseline first — [`delivery-prior-art.md`](../transport/delivery-prior-art.md) |
| 62 | **GPU** — GPU HTJ2K decoders' methods and whether WebGPU can take more than the wavelet: research and a feasibility bound | done `2ee009d` (`e658e8d`) — **a ported HT block decoder bounds at 42–67 % of a breast frame from 931×2124 up at 1×, loses on 512²; unmeasurable here**: the ICIP 2019 GPU decoder read in full (MEL+VLC one thread a code-block, MagSgn a warp a block, wavelet 40–50 % of GPU time; lossless 4K 62–402 frames/s), nvJPEG2000 refinement since v0.10.0, no WebGPU/WebGL decoder anywhere; WebGPU's way back measured in Chromium 141 on SwiftShader at 2.0–2.1× the heap's copy out on every frame over 4 MB, +3 ms on small ones (8 rounds interleaved, 1×/4×, 1 344/1 344 exact, mutation caught 12/12 cells); bound = 81–86 % movable − GPU time scaled from the paper's lossless kernels (throughput or a KCUPS1 latency floor) − that transfer: tomosynthesis 23 % / −44 %, MR 512² −14 %; no GPU in the container, so the WGSL port and a phone are what would settle it; row FASTHTJ2K's two misreadings corrected in place; gate's wasm steps not run (no wasm-pack), no client code changed — [`decode/README.md`](../decode/README.md) §A WebGPU block decoder, bounded, [`lab/av1/gpu`](../../lab/av1/gpu/README.md) |
| 63 | **JXL** — JPEG XL at fast efforts in WASM, and native browser decoding: which engines, exact at which depths, through which API, how fast | claimed 2026-10-07 00:07 UTC (night) |
| 64 | **REMAP** — rare values above 12 bits mapped out with a small exception map, and a palette for high bits: exact, bytes, decode | done `865b3f1` on `claude/av1-unified` (`56a9c0a`, `62061cf`, `1a6808e`) — **the map buys the decoder, not bytes**: two of three projection systems are 12-bit data plus one saturated level (16383, 11 % and 0.6 % of samples), the CTs and cone-beam 12-bit data plus 0.0003–0.02 % rare levels, the third projection system, the PET and the film dense or sparse above 12 bits; clamped into a 12-bit window with a deflated per-frame map (1–10 KB a series), one 12-bit stream is 2.6–13 % larger than the k = 2 split on all six series it fits, but split at k = 2 after the map it is the split's bytes (−0.1…+0.05 %) with every stream ≤ 10 bits, so WebCodecs decodes it in **0.46–0.71 of the split's dav1d-WASM time** (60/60 paired rounds; Chromium 141 in the container, 10 rounds Williams-ordered at 1× and 4×, 1 920/1 920 frames a throttle exact against the source) and 1.05–1.34× w10's for 5–12 % fewer bytes on the projections, 1.5 % on two CTs, 4.4–4.8 % more on a CT and the cone-beam; a high-bit palette ties the map; at L = 0 (histogram packing) it halves the 16-bit film for HTJ2K as for AV1 (0.576, 0.571); every AV1 arm still 2.6–7.3× HTJ2K's decode; 5 + 3 mutations caught; proposed, not built — [`item-format.md`](item-format.md) §Proposed: a remapped plane, [`README.md`](README.md) §A3, `lab/av1/remap/README.md` on `claude/av1-unified` |
| 65 | **ORDER** — the order frames are sent in: DBT centre-out, mammography view priority; time to the first useful image and to the full fill | claimed 2026-10-07 00:08 UTC (night) |
| 66 | **POCGAP** — an earlier private proof of concept's 31 % lossless AV1 gain on 10-bit data: two more 10-bit DBT series, paired medians, and the method notes recorded | done `22f5f03` (`069044e`) — **not reproduced: paired, plain AV1 is 0.973–0.976 of HTJ2K on 10-bit DBT, optimized 0.940–0.943, not 31 % below**: the first 4 frames of `dbt10_ea1141` and `dbt10_d`, 20/20 codings exact (80/80 frames); one setting at a time, an 8-bit copy (v ≫ 2) favours AV1 by 3.1–3.5 points, keeping the background by 0.5–0.8, libaom 3.8.2 against 3.15.1 at cpu6 by 0.5–0.7, `--threads=4` changes bytes 0.02–0.06 % a frame (so `--threads=1` is pinned); the two series the brief named are not CC BY or CC0 (UPMC states no licence, BCS-DBT is CC BY-NC 4.0: Blocked); 4 mutations caught 4/4 — [`README.md`](README.md) §Prior evidence, [`lab/av1/pocgap`](../../lab/av1/pocgap/README.md), [`FIXTURES.md`](../FIXTURES.md) §AV1 data |

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

### 30 WCLAT

README §Options to try: Chromium maps `optimizeForLatency: true` to dav1d's `max_frame_delay = 1`;
without it dav1d holds frames (WCAP's two before `flush()`), and `decode-av1-webcodecs.js` flushes
every unit. In the lab first (row 3's and row 20's harness, headless Chromium 141): does a unit give
its frame with `optimizeForLatency` and no flush, on every depth and layout WebCodecs takes exactly,
intra and G = 8; the decode time a frame, flush per unit against none, interleaved, 1× and 4×; the
same with tiled lossless frames (2 and 4 tile columns, libaom 3.15.1), since Chromium gives dav1d 2–4
tile threads by coded height, bytes reported per tiling. If it holds, build the smallest change
behind the decoder module (G > 1 through WebCodecs, row 20's open item), conformance as row 20's,
mutated, gate green. Verdict: frames without a flush, yes or no, and the time per frame it saves.

### 31 WCBASE

README §Options to try: WebCodecs cannot choose an operating point, but every OBU of a scalable
payload carries its `spatial_id`, and dav1d at `all_layers = 0` (Chromium's setting) outputs the
highest layer it holds at the end of a unit or on a flush. Using row 18's two-layer streams
(fluoroscopy, MR, ultrasound, synthetic): feed WebCodecs each unit with the OBUs of `spatial_id` > 0
dropped, flushed; check the base comes out at its own size, identical sample for sample to native
dav1d at the base's operating point, then the whole unit through a decoder that took it whole, exact
against the source. Time the base out against dav1d-WASM's base (row 24's path where built, else
`operating_point` set in the lab build), interleaved, 1× and 4×. Mutate the filter (keep a top OBU,
drop a base one) and watch it fail. Verdict: base through WebCodecs, exact to native, and its time.

### 32 AV2

README §Options to try: AVM v1.0.0 (tag `v1.0.0`, commit `966a7d7`), the AV2 reference software, has
a lossless mode, monochrome and 10/12-bit coding. Licence and patent terms into
[`licensing.md`](licensing.md) before it is built. Build it pinned in `lab/av1/tools.sh`; code the
series of rows 2, 10 and 21 losslessly, intra and at the best G of row 6, at the slowest preset and a
practical one, grey as 4:0:0, RGB as 4:4:4 identity, over 12 bits split as row 7 found; every frame
exact through AVM's own decoder against the generator's checksums. Bytes against libaom 3.15.1's and
HTJ2K's on the same frames, encode and native decode time a frame, interleaved. No browser decoder
exists: say so, and do not build one. Verdict: AV2's lossless bytes over AV1's and HTJ2K's per series.

## The representation and content rows (33–35)

### 33 REP14

Row 28 found the two low bits apart the smallest coding on grey, but at 13 and 14 bits that leaves an 11- or
12-bit top stream, which only dav1d decodes (row 3: WebCodecs refuses 12-bit). The other cut keeps every stream
≤ 10 bits and opens WebCodecs, 2–3× faster to decode (row 13), at more bytes — not measured at 14 bits. On the
tomosynthesis projections of row 21 (both systems, 14 bits) and the CT of row 2 (13 bits after its offset): top
two bits short of the depth + low 2 (dav1d-WASM) against top 10 + low 3 or 4 (WebCodecs, dav1d-WASM beside it),
libaom 3.15.1 with row 28's best settings (`--tune-content=screen --sb-size=64`) at cpu0 and at the fastest preset
within 2 % of it; every frame exact against the source checksums. Bytes over HTJ2K; decode a frame in headless
Chromium at 1× and 4×, interleaved; then total time on row 23's links and CPU with row 23's harness. Verdict: the
layout per depth by total time, and where each wins.

### 34 TOTAL2

Row 23 ranked HTJ2K against the AV1 forms of rows 6–13. Row 28 then found representations that put AV1 alone
under HTJ2K's bytes on every series (the two low bits apart on grey over 8 bits; JPEG 2000's reversible colour
transform on RGB), and row 30 found WebCodecs takes a group with `optimizeForLatency`. Re-run row 23's harness —
same series, links (5, 20 and 50 Mbit/s, 40 ms), CPU (1× and 4×), interleaving and n — with: HTJ2K; AV1 in row
28's best representation at G = 1 through dav1d-WASM, and through WebCodecs where every stream is ≤ 10 bits; and
the colour-transformed ultrasound at G = 8 through WebCodecs (row 28 measured it at 0.850 of HTJ2K's bytes). Every
frame exact. Report fill time and first frame separately. Verdict: per series and cell, which coding fills first,
against row 23's ranking.

### 35 DATA2

Rows 10 and 21 found no reachable breast ultrasound cine or multi-frame angiography (`## Blocked`). First test
whether `zenodo.org` and `www.cancerimagingarchive.net` are reachable from the container; if not, add one line
under `## Blocked` and stop the row. If they are: find open (CC BY or CC0) multi-frame breast ultrasound cine and
contrast angiography, record their licences in [`licensing.md`](licensing.md), pin and checksum each fetch in
`lab/av1/fetch_data.sh`; then on them: bytes (row 28's best representation and G, against HTJ2K), decode a frame
(dav1d-WASM, and WebCodecs where it applies, interleaved, 1× and 4×), and total time with row 23's harness. Verdict
per series, beside rows 23 and 28.

### 36 ENCX

Row 28 cut lossless AV1 under HTJ2K by representing the samples for it (two low bits apart; JPEG 2000's reversible
colour transform on RGB). Smaller items are fewer bytes on the wire as well as on disk, so the remaining room is
worth finding — but a phone's decoder pays for every extra stream (rows 23, 27). On row 28's nine series, every
coding exact against the source checksums, bytes over HTJ2K and decode a frame (headless Chromium, dav1d-WASM and
WebCodecs where it applies, 1× and 4×, interleaved):

* **Fairness first: HTJ2K on the same representations.** The two low bits apart coded with HTJ2K (top and low as
  two codestreams), against HTJ2K whole. If HTJ2K gains too, row 28's gain is the representation's, not AV1's.
* **The low stream.** It is close to noise. AV1 (as row 28 codes it) against the bits packed raw, and against a
  general entropy coder the browser can decode cheaply (pin it; `DecompressionStream` formats count): bytes and
  decode time. A cheaper coder at similar bytes is a decode win.
* **The split per series.** A cheap estimate of how many low bits are noise (their entropy, per series or per
  frame) choosing k = 1, 2 or 3, against a fixed 2.
* **Temporal noise.** The low streams of a group coded as one inter stream, and the top stream inter with the low
  intra, on the grey series and the colour-transformed ultrasound: is any of the noise predictable across frames?
* **libaom's remaining lossless tools** on the split streams, if row 28 did not try them (palette and intra block
  copy on the low stream alone, the intra tools one by one).

Verdict: a ranked list of encoding changes, each with its bytes over HTJ2K, its decode cost at 1× and 4×, and what
it means for total time on row 23's links — and the HTJ2K-on-the-same-representation result stated first.

### 37 XBROWSER

Rows 3, 13, 20, 30 and 31 ran in Chromium only. A phone may run WebKit (every iOS browser) or Gecko. With
Playwright's pinned WebKit and Firefox builds (record their versions), run the lab's AV1 decode path as it is —
`decode-av1.js` (dav1d-WASM SIMD build of row 4), `decode-av1-webcodecs.js`, the per-layout probe and the fallback to
dav1d — on row 28's shapes (grey 8/10/12 direct and split, signed after an offset, RGB through the colour transform
and as G, B, R) and on row 2/10/21 series frames: every frame exact against the source checksums; which decoder each
engine chose and why (VideoDecoder absent, probe refused, decode refused); whether the SIMD build loads (WebAssembly
SIMD support) and what happens if it does not; decode a frame against the HTJ2K path in the same engine, 1× and 4×,
interleaved. Desktop engines are not phones: say so. Verdict: per engine, the AV1 path exact or not, its decoder,
and its decode time against HTJ2K's.

### 38 FOOTPRINT

A phone has little memory and a slow CPU. For the lab's AV1 path in headless Chromium: the dav1d-WASM heap after
the first item and its high-water mark across a series, per worker, at the largest frames here (the 14-bit
projections, about 4.9 M samples; RGB ultrasound), against the HTJ2K decoder's; whether the heap is returned or
grows; with two and four decode workers. And the first AV1 item's cost on a fresh worker: fetching, compiling and
instantiating the module (and the WebCodecs probe), from the decode message to the first frame, against the next
item's and against HTJ2K's first, at 1× and 4×, interleaved, cold and with the module cached by the browser.
Verdict: memory per worker and first-use cost, with what each means for a phone.

## The unification and decode-speed rows (39–42)

### 39 UNIFY

`main` now holds the cleaned lab (the unification merged 2026-10-04); this branch was cut before it. On a NEW branch
`claude/av1-unified` from `origin/main` (push only that branch and this queue's branch; never `main`): merge
`claude/av1`, resolving each conflict in favour of `main`'s redesigned code with the AV1 pieces re-applied on its
shapes — the decoder seam, `decode-av1.js`, `decode-av1-webcodecs.js`, the codec tag, the lab harnesses. Then build
[`item-format.md`](item-format.md) end to end, as the owner adopted it: the 16-byte item header, both representations
(plain: samples direct, the minimum split over 12 bits, RGB as G, B, R; optimized: two low bits apart, the reversible
colour transform, `--tune-content=screen --sb-size=64`), ingest that writes nothing unless every item decodes back
exactly through native dav1d, a reader that refuses every case the doc lists by name, the decoder choice (WebCodecs
when every stream is ≤ 10 bits and its per-layout probe passes, dav1d-WASM otherwise, a failed module import retried
and WebCodecs falling back to dav1d), each WebCodecs run taking only its own frames. Golden items from the writer
decoded by the reader in Node and in headless Chromium, every refusal matched by its message; HTJ2K unchanged; the
gate green; every new test mutated. G stays 1. Verdict: the branch, what conflicted and how it was resolved, and the
test counts.

### 40 SVC

Rows 15, 18, 24, 25, 26 and 31 built and measured scalable AV1 (a lossy base, a lossless top, one payload): the base
reaches the page as a preview and the exact frame follows from the same bytes. Build row 26's proposal in the lab on
the row 39 branch if it is done, else on this one: each frame as two entries, layer-major (every base, then every
whole unit), the planner and the fill asking bases first, the decoder showing a base then replacing it with the exact
frame, the page marking a preview as not exact. Row 25's shape (a quarter-size base at q 40). Measure on row 23's
links and CPU, interleaved: time to the first picture of every frame and time to every exact frame, against HTJ2K and
against single-layer lossless AV1; total bytes. Every final frame exact. A lossy first picture is not adopted by the
product (owner, 2026-10-04): this is the number for a later decision. Verdict: the preview's lead and its cost.

### 41 FASTHTJ2K

Decode is a phone's clock for both codecs, and GPU decoders make HTJ2K much faster: NVIDIA's nvJPEG2000 runs the HT
block decoder and the wavelet on the GPU (Tier 2 on the CPU), and Kakadu's GPU work (ICIP 2019) reports block-decoding
gains of about 10× lossy to 40× lossless over classic JPEG 2000. Browsers have no CUDA; `docs/decode/README.md`
dropped GPU decode unmeasured. In order, stopping where the evidence says to:
* **Where the time goes:** OpenJPH-WASM as the lab ships it, profiled per stage (HT cleanup and refinement passes,
  inverse 5/3 wavelet, colour transform, copies) on row 2/10/21 frames, headless Chromium 1× and 4× — the ceiling
  of any lever on one stage.
* **What exists:** primary sources for GPU JPEG 2000/HTJ2K decoding (nvJPEG2000 docs, Kakadu's papers, any
  WebGPU or WebGL JPEG 2000 decoder, open or published) and which stages they move; WebGPU's availability on phones
  (Chromium Android, Safari) from primary sources.
* **A prototype, if the profile and the sources say it can pay:** the inverse wavelet (and colour transform) in a
  WebGPU compute shader on the CPU's decoded subbands, exact against OpenJPH, timed with the copies to and from the
  GPU; the headless container may lack a GPU — say what that leaves unmeasured.
* **CPU levers not yet tried** (check the lab's decode history first; do not repeat it).
Verdict: a ranked list of levers with measured or bounded gains, and what a phone would need.

### 42 TOTAL3

Row 36 found encoding changes the product has not adopted: the low bits deflated (decoded by the browser's
`DecompressionStream`), k = 3 on series whose noise σ ≥ 17, and the top stream through WebCodecs where it is ≤ 10
bits. Re-run row 23's total-time harness (row 34's settings) with: HTJ2K; the plain AV1 control of
[`item-format.md`](item-format.md); the optimized representation as adopted; and the optimized one with row 36's
changes. Every frame exact; fill time and first frame apart. Verdict: per series and cell, what row 36's changes buy
in total time over the adopted representation, and over HTJ2K.

## The bit-split rows (43–45)

The owner, 2026-10-05: every AV1 layout over 8 bits rests on the bit split — a sample v, after the series' offset
(−min), coded as top = v ≫ k and low = v & (2^k − 1), each a lossless stream, merged `(top << k) | low`. Rows 7–42
found it exact on nine real series of 8–14 bits, one of them signed, at k ≤ 4. Prove it at every depth and layout a
rule could pick before the product adopts a per-depth rule (row 33's k = 3 at 13 bits, or row 44's): correctness
first (43), then measurement (44), and the content and depths the lab lacks (45).

**Branch.** The item writer and reader exist only on `claude/av1-unified` (row 39: `lab/av1/item/`,
`client/downloader/av1*.js`), so rows 43–45 work there: first merge `origin/claude/av1` into it (rows 40–42 and this
queue; it merged without conflict at `0115229`), and push that branch. Findings land on `claude/av1-unified`; only a
row's state is set here, on `claude/av1`. On that branch the timing and browser harnesses still hand the client bare
units (`item-format.md` §Built): a row that needs one ports it to items first.

### 43 SPLITOK

**Widen the format, not the rule.** `ingest.py` and the reader (`av1-item.js`, `av1-frame.js`) take grey sources of
b = 8…16 bits after the offset, unsigned and signed, at every split k = max(0, b − 12) … max(b − 8, 4) — from the
smallest k whose top fits a 12-bit stream to a top of 8 bits, which covers every candidate rule (k = 2, k = 3,
k = b − 10) and its ±1 neighbours — plus row 39's RGB shapes (plain G, B, R and `rct`). The refusals this widens
(`split` ∉ {0, 1, 2}, `bits` ≤ 8 with `depth + split` > 8, ingest's "over 14 bits") are restated in `item-format.md`
in place; what ingest emits by default (plain, optimized) does not change until row 44's verdict.

**Synthetic frames,** per b and signedness, each with a SHA-256 written when it is made: a ramp holding every value
0…2^b − 1 at least once (signed: −2^(b−1)…2^(b−1) − 1; 256×256 holds 2^16), all-zero, all-max, a 0/max
checkerboard, uniform noise, a smooth gradient, the signed extremes, and a pad value at the series minimum under
real-looking data (as the CT's −2048), in a series whose minimum sits in one frame only, so the offset is the series'.
Geometry: 16×16, odd (17×13), 1 pixel wide and 1 high, non-multiples of 8 and 64 (65×127), the largest frame measured
(1914×2572, the 14-bit projections, ~4.9 M samples) and 4096×5120 (a mammogram's). cpu0 up to 256×256; the large
frames at the fastest preset `item-format.md` uses as well, since a preset changes the tools.

**Every decoder and engine.** Every item through native dav1d (ingest's check), the reader in Node (dav1d-WASM), and in
Chromium, Firefox and WebKitGTK as row 37 ran them (stock builds, `webkit+sab`; port `lab/av1/xbrowser`'s launch to
items): dav1d-WASM in all three, WebCodecs in Chromium where every stream is ≤ 10 bits. In Firefox and WebKitGTK assert
**which decoder ran** for each item — the per-layout probe refusing and dav1d-WASM taking it (row 37: Firefox refuses
monochrome and returns 4:4:4 as 8-bit `BGRX`, WebKitGTK's WebCodecs decodes no AV1) — from a tag the harness reads, not from timing.
A size or depth a decoder or engine refuses is reported by name, not dropped.

**Golden items** for every (bits, depth, split, signed, rct) the matrix emits, beside row 39's 14 in
`client/conformance/av1/items/`, decoded in Node and Chromium; every refusal of `item-format.md`, old and new, matched by
its message.

**Checks:** each frame's SHA-256 against its source's; native dav1d, dav1d-WASM and WebCodecs pictures of each stream
byte-identical before the merge; an exhaustive merge property test — every v of 0…2^b − 1, every k of 0…8, b = 8…16,
unsigned and signed — in the writer's merge and in `av1-frame.js`, split then merged back to v. **Mutations, each must
fail:** the top shifted one bit more and one less; the low mask one bit wide and one narrow; the offset dropped and
doubled; `split` one short and one long; the signed container's mask removed (`av1-frame.js` `place()`); the inverse
RCT's rounding flipped; top and low swapped; an item truncated by a byte; an RGB stream without its sRGB tags (the probe
must fail, not a wrong colour pass).

**Real series:** all nine of [`FIXTURES.md`](../FIXTURES.md) §AV1 data, every frame, at every k of its depth's matrix,
cpu0 and the shipped preset, natively and through the reader in Node; in the three engines at k = 2, 3 and b − 10.

If the matrix outgrows a session, push what is checked and name the rest in the row's cell: an unchecked cell is not
exact. Verdict: per (b, k, signedness, geometry), exact through each decoder in each engine, or its refusal by name,
with the counts N/N; the mutations caught; the format's new limits. Into `lab/av1/item/README.md` §Checked,
[`item-format.md`](item-format.md) and [`README.md`](README.md) §A3.

### 44 SPLITTIME

After row 43, and only on the cells it found exact; claimed only when 43 is `done`. Arms per series of b bits after
the offset, named by k so none is ambiguous: **HTJ2K**; **d12**, k = max(0, b − 12), the smallest k whose top fits a
12-bit stream (at 13 bits k = 1 — row 33's "d12" was k = 2, this row's **k = 2** arm); **k = 2**, the adopted
optimized rule; **k = 3**, row 33's 13-bit choice and row 36's rule for noise σ ≥ 17; **w10**, k = max(0, b − 10),
every stream ≤ 10 bits. An arm equal to another is run once; a top of ≤ 10 bits goes through WebCodecs, a deeper one
through dav1d-WASM. Series: 13 bits, the CT and the cone-beam (its total time never measured); 14 bits, both projection
systems; 15 and 16 bits only on real series row 45 fetched — with none, those depths stay unmeasured and the verdict
says so; no synthetic timing. Controls: the MR (11 bits), the fluoroscopy and 12-bit tomosynthesis (12), the 10-bit
tomosynthesis, and a 9-bit series if row 45 found one.

Measure, every frame exact: bytes over HTJ2K at cpu0 and the shipped preset (the fastest within 2 % of cpu0, re-found
per k — row 33 found it differs by layout); decode a frame through `decoder.js` in headless Chromium at 1× and 4×,
interleaved (row 33's `lab/av1/rep14`); total time on row 23's harness with row 33's links — 5/20/50 Mbit,
`lte-good`, `wifi-home`, 1× and 4×, Williams order, n ≥ 10, `VOID` dropped, first frame and fill apart. Port `rep14`
and `total` to items first, and show the port reproduces a row 33 cell (the CT's w10 at 50 Mbit, 4×) within its
spread. Say where the host saturates (row 33: dav1d-WASM's decode is the fill's clock at 4× on 50 Mbit, and on 20 Mbit
for the projections) and claim nothing past it; decode-bound cells moved 15–25 % between containers (row 23), so the
ranking is the claim. A long run pushes by rounds, as row 33 did. Verdict: the per-depth layout rule (k for each b),
its bytes and time against HTJ2K and the adopted rule, and the cells where HTJ2K still wins — into
[`README.md`](README.md) §A3 and §Total time, and as a proposal in [`item-format.md`](item-format.md): the adopted rule
is the owner's to change.

### 45 DATA3

Rows 10, 21 and 35 found no breast ultrasound cine, ABUS or multi-frame angiography reachable; the lab has no FFDM, no
synthesized 2D, no real 9-, 15- or 16-bit series and one signed one. Find openly licensed series (CC BY or CC0
preferred; a non-commercial one fetched at run time only, never redistributed, and flagged under `## Blocked`), each
licence read from its source, not assumed, into [`licensing.md`](licensing.md) and [`FIXTURES.md`](../FIXTURES.md)
§AV1 data:

* breast ultrasound cine, grey and RGB; automated breast ultrasound volumes; contrast angiography (multi-frame XA);
  mammography, FFDM 2D and synthesized 2D (EA1141, already used, for its 2D views; whether IDC holds CMMD or CBIS-DDSM);
* real 9-, 15- and 16-bit sources — bits after the offset, measured per series, never read from `BitsStored` (PET and
  NM are often full-range 16-bit);
* signed series with a negative sample present (the MR is signed with none): CT from vendors other than the LIDC
  series' (IDC's `Manufacturer`), and other modalities.

Row 35 found refused with CONNECT 403: `zenodo.org`, `www.cancerimagingarchive.net`,
`services.cancerimagingarchive.net`, `figshare.com`, `data.mendeley.com`, `huggingface.co`, `physionet.org`,
`www.kaggle.com`, `osf.io`. Try what the container reaches: IDC's public buckets at its newest release (row 2 used
v24) through `idc-index`, pinned; GitHub-hosted datasets and release assets (`github.com`,
`raw.githubusercontent.com`, `objects.githubusercontent.com`, `media.githubusercontent.com` for LFS); the DICOM
test-data repositories (pydicom's, GDCM's, dcm4che's — the licence per file: a test-data directory inside a GPL project
may not be open for reuse, row 2); institutional mirrors and data repositories (Dataverse, Dryad, a university's
own). Record each attempt: host, dataset, the answer (status or CONNECT 403), UTC time.

For each series obtained: pinned and checksummed in `lab/av1/fetch_data.sh` and `data.json`, frames identical to
`PixelData`, its range and bits after the offset, the new pins mutated; row 43's checks on every frame (every k of its
depth's matrix, native and the reader in Node; the three engines at k = 2, 3 and b − 10); bytes over HTJ2K per layout
(plain, optimized, every row 44 arm, the RCT on RGB; cpu0 and the shipped preset). No timing: row 44 takes the series.
The fetch needs nothing from row 43; if 43 is not `done` when the data is pushed, set this row to `after 43` with the
data's commit in its cell and stop.

What stays unreachable goes under `## Blocked`, a line a dataset: its name, its licence where known, and the exact
hosts to allow in the cloud environment's network settings, so the owner can allow them or fetch the data locally.
Verdict: per series, licence, bits and sign after the offset, exact N/N and bytes over HTJ2K per layout; per taxonomy
item still missing, the host that blocks it. Into `FIXTURES.md` §AV1 data, `licensing.md`,
[`lab/av1`](../../lab/av1/README.md) §SIZE and §DEPTH, [`README.md`](README.md) §A3 and §A4.

## The breast and mixed-decoder rows (46–47)

The owner, 2026-10-05: AV1's priority is the **breast imaging family** — mammography (FFDM and synthesized 2D);
breast tomosynthesis (DBT), read as a series of slices scrolled like cine, so an AV1 target and not only a volume;
breast ultrasound, cine included; and automated breast ultrasound (ABUS) volumes. Other cine (echo, angiography,
fluoroscopy) is secondary. Row 46 brings the family's missing content and measures it as the targets; row 47 asks
whether a split item's two streams should each take their own decoder.

### 46 BREAST

**Network first.** Held `after env` until the owner switches the cloud environment's network access to full. Try
every host `## Blocked` names for rows 21, 35 and 45, recording each attempt as row 45 did (host, dataset, the answer,
UTC time). If they are still refused, add one line under `## Blocked`, set the row back to `after env` and stop.

**Fetch,** where reachable, openly licensed only: CC BY or CC0, each licence read from its source, not assumed, into
[`licensing.md`](licensing.md) and [`FIXTURES.md`](../FIXTURES.md) §AV1 data. A set under any other licence (the
breast-lesion ultrasound video set of row 45's `## Blocked` line is non-commercial) is a line under `## Blocked`, not
fetched. Pin and checksum every fetch in `lab/av1/fetch_data.sh` and `data.json`, frames identical to the source's
pixels, the new pins mutated; commit no data. Wanted:

* breast ultrasound cine, grey and RGB, and stills;
* ABUS volumes;
* DBT from at least two vendors beyond the lab's two volumes: the reconstructed slice series, and the projections
  where a set publishes them;
* FFDM and synthesized 2D beyond row 45's (two vendors each, 10 and 12 bits).

**Record, per target series** — the lab's DBT volumes and projections and row 45's mammograms included: bits after the
offset (measured, never read from `BitsStored`), signedness, frame count and frame size, in one table in `FIXTURES.md`
§AV1 data, so the owner sees whether anything in the breast family exceeds 12 bits.

**Measure, per series, every coding exact.** The fetch lands here on `claude/av1`, as row 45's did; the measuring
needs the item code, so it runs on `claude/av1-unified` after merging `origin/claude/av1` into it (§The bit-split
rows).

* **Exactness through every decoder path:** row 43's checks if 43 is `done`; until then what the lab already runs —
  native dav1d (`ingest.py`'s check), dav1d-WASM in Node, and WebCodecs in headless Chromium where every stream is
  ≤ 10 bits (`lab/av1/item/check.mjs`) — and the verdict says which.
* **Bytes over HTJ2K per layout:** plain, the k = 2 split, and w10 (k = b − 10) where b is over 12; the RCT on RGB;
  cpu0 and the shipped preset.
* **Intra (G = 1) against inter (G = 8 and G = 16),** exact, on the DBT slice series and the ultrasound cine in their
  real order — slices by position along the stack, frames by acquisition time, never re-sorted. libaom 3.15.1 with
  `--auto-alt-ref=0` (alt-ref inter is not exact, [`README.md`](README.md) §Measured here), every frame checked;
  bytes over intra and over HTJ2K, and decode a frame through dav1d-WASM (groups decode there only, row 16) against
  intra's, 1× and 4×, interleaved.

This content is where inter coding could pay. It has been tried on the 2 frames/s fluoroscopy, the two DBT volumes
(best group +1.2 % / −0.6 % against intra), the DBT projections (−0.3 to +0.8 %) and the RGB ultrasound, where it paid
once colour-transformed (0.850 of HTJ2K against intra's 0.962; [`README.md`](README.md) §A1). Say per series, plainly,
where inter pays and where it does not, with its numbers; a group costs random access (§A1), so a gain inside the
run's spread is not one.

Verdict: per series, its licence, bits, sign, frames and size; exact N/N per decoder path; bytes over HTJ2K per
layout; inter over intra at G = 8 and 16 and its decode cost; the deepest series in the family; per item still
missing, the host that blocks it. Into `FIXTURES.md` §AV1 data, `licensing.md`, [`lab/av1`](../../lab/av1/README.md)
§SIZE and §DEPTH, [`README.md`](README.md) §A1 and §A3.

### 47 MIXDEC

**The question (the owner).** The client picks one decoder per item: `client/downloader/av1.js` takes WebCodecs only
when every stream is ≤ 10 bits and its layout's probe passes, otherwise dav1d-WASM decodes both streams. For a split
item whose top is over 10 bits, why not decode the top through dav1d-WASM and the 8-bit low stream through WebCodecs?
The streams and bytes do not change; only decode can.

**Measure the bound first.** Before building, time the low stream's share of a frame's decode when dav1d-WASM decodes
both (headless Chromium, 1× and 4×, interleaved, on the 13- and 14-bit series at every k whose top is over 10 bits),
and push it into the row's cell. The share bounds the lever: if it is small, say so there and lead the verdict with it.

**Build** on `claude/av1-unified` (§The bit-split rows), in the lab's client decoder, behind a flag that defaults
off: with it on, a split item whose top is over 10 bits sends the top to dav1d-WASM and the low to WebCodecs, both
decodes started before either is awaited, and the low falls back to dav1d-WASM wherever its 8-bit layout's probe
fails (Firefox and WebKitGTK, row 37). Today's path is unchanged with the flag off.

**Prove exactness:** every frame of the measured 13- and 14-bit series (the CT, the cone-beam, row 45's two signed
CTs, both projection systems) at every k whose top is over 10 bits; row 43's synthetic set once 43 is done; the merged
frame byte-identical to the single-decoder path's on every frame. **Mutations, each must fail:** the low taken from
the previous item; top and low swapped; the low's picture from WebCodecs with its plane offset by a row; the flag off
still taking the mixed path; a failed low decode with no fallback.

**Then measure,** interleaved, at 1× and 4×, every frame exact:

* decode time a frame through `decoder.js` in headless Chromium (row 33's `lab/av1/rep14`, ported to items as row 44
  does), mixed against both streams through dav1d-WASM (today) and against w10 (k = b − 10, both through WebCodecs);
* total time on row 23's harness (`lab/av1/total`) on the cells where the decoder is the clock — 4× on 20 and
  50 Mbit (row 33) — the same three arms, Williams order, n ≥ 10.

Say where the host saturates and claim nothing past it; the decode-bound cells moved 15–25 % between containers
(row 23), so the ranking is the claim. Verdict: the low stream's share, then mixed against today and w10 per series
and k; whether the flag should become the client's choice is the owner's. Into `lab/av1/item/README.md`,
[`decode/README.md`](../decode/README.md) §AV1 and [`README.md`](README.md) §A3.

## The prior-art row (48)

Every AV1 layout over 8 bits rests on the bit split (§The bit-split rows), and the lab arrived at it by measurement
alone. Row 48 asks whether the literature knows it, recommends it, or offers something better.

### 48 SPLITLIT

Web research only, no measurement; the cloud environment's network access is full. Primary sources — standards,
peer-reviewed papers, codec specifications, DICOM WG-04 material, implementers' documentation — each cited with its
date; a claim no source confirms is marked unconfirmed.

1. **Prior art.** Splitting samples into most- and least-significant parts (MSB/LSB, bit-plane or "bit-depth
   splitting") for lossless or near-lossless coding, in medical imaging, depth/range video, HDR and scientific
   imaging. Is it a recommended practice anywhere? What do the sources report on its byte cost and benefit?
2. **Alternatives.** For each, how it codes 13–16-bit samples losslessly, and its browser decode path today:
   * native high-bit-depth codecs: HTJ2K and JPEG 2000, JPEG XL, JPEG-LS, HEVC RExt's 16-bit intra profiles, VVC at
     16 bits, the AV2/AVM bit-depth plan (row 32: AVM v1.0.0 has no profile over 10 bits);
   * scalable bit-depth coding: SHVC's bit-depth scalability, and any AV1 or AV2 equivalent;
   * residual or layered lossless schemes (row 17's lossy preview plus residual is the lab's one).
3. **Our design against the literature.** What the lab built: k = 2 for every grey source over 8 bits (the optimized
   representation, [`item-format.md`](item-format.md)); the low bits as their own 8-bit AV1 stream; the offset
   (−min of the series) for signed data; JPEG 2000's reversible colour transform for RGB. The data are rows 13 (the
   top 10 + low through WebCodecs), 28 (the two low bits apart, 0.902–0.987 of HTJ2K), 33 (the 13- and 14-bit layouts
   by total time) and 36 (three low bits beat two where noise σ ≥ 17; HTJ2K gains 0.9–1.6 % from the same split, only
   with its low bits deflated). Does the literature suggest a better choice of k, a better coding of the low bits, or
   a reason to prefer a native-depth codec above 12 bits?
4. **Patents and standards status** of the split approach, if any.

**Deliverable:** [`split-prior-art.md`](split-prior-art.md) — public, no private names, every claim cited with its
source and date, unconfirmed claims marked; a one-line verdict in the row. Any follow-up measurement the reading
suggests is proposed here, at the end of this brief, not queued as a row. Docs only, on `claude/av1`.

*Proposed by the reading (2026-10-05, not queued):* (1) row 36's oracle again with k ∈ {1…6} (b − k ≥ 6) on the
fluoroscopy, 12-bit tomosynthesis, cone-beam and a projection system — the literature's rule predicts 4, 4, 6 and
4–5, where row 36 stopped at 3; it fits row 44's arms. (2) Histogram packing against −min, in AV1 and HTJ2K, on the
CT and any sparse series of rows 45–46, the fraction of levels used measured first ([`split-prior-art.md`](split-prior-art.md) §3).

## The improvement and investigation round (rows 49–66), 2026-10-05

The owner, 2026-10-05, set three goals. **Rethink for net improvement** in every part of the system — decoding, the
client, the server and transport, ingest, the seams between them, the tests — towards good, simple, efficient code; a
simplification that costs nothing measurable counts as an improvement. **Organization and naming:** a name states its
role in the domain's words; no word from the project's history (arm, version, early, mvp); no collision with a
standard's term (ARM the CPU; DICOM's encapsulated-pixel-data *Item*, tag (FFFE,E000)); folders by responsibility; one
concept, one name, defined once. **Investigate:** assume nothing we have is best — newer versions, complementary
approaches, papers, other options, similar optimizations elsewhere. AV1's priority content is the breast family
(FFDM and synthesized 2D, DBT slices and projections, breast ultrasound and its cine, ABUS); the target client is a
phone on lossy wireless.

**The adoption rule, every row.** Adopt only a net improvement: measured before and after, interleaved; the gate green;
HTJ2K unchanged unless the row is about HTJ2K; every frame exact; every new test mutated to fail. Anything else is
reported with its numbers and left unadopted; a change to the wire, the store's format or the item format is
structural — proposed in its owning doc, not built into the product.

**Branch.** The code lives on `claude/av1-unified`: a row that changes code or measures through the client first merges
`origin/claude/av1` into it, as rows 39 and 43 do, and pushes that branch; only the row's state is set here. A
research-only row writes its doc on `claude/av1`. A rethinking row (A) may change nothing: it then says why.

### 49 DECODE

**Question.** Can the HTJ2K and AV1 decoder workers (`client/downloader/decoder.js`, `decode-av1.js`,
`decode-av1-webcodecs.js`, `av1.js`, `av1-frame.js`) hand a frame over with no copy, allocate less, and share one decode
interface? **Why it matters:** decode is a phone's clock for both codecs; row 41 found copy-out at 7–15 % of an HTJ2K
frame and the wrapper's packing at 4–10 %. **Do:** read both paths end to end; target a zero-copy hand-off (the
decoder writing straight into the `SharedArrayBuffer` the consumer reads), no per-frame allocation in the steady state,
and one interface both codecs implement; implement what is clearly better and list what was not changed and why.
**Decides:** decode time a frame through `decoder.js` in headless Chromium, and the fill's total time on row 23's
harness, both at 1× and 4×, on the breast series (`ffdm_*`, `syn2d_*`, `dbt*`, `dbtproj_*`, `usb_cine*`) and one
non-breast control; resident memory a worker (row 38's method) as a check. **Adopt:** the round's rule — HTJ2K's path may
change here, since the row is about it. **Branch:** `claude/av1-unified`. **Deliverable:** the change, before/after per
series and CPU, in [`decode/README.md`](../decode/README.md); a one-line verdict here.

### 50 CLIENT

**Question.** Are the downloader, worker and consumer state machines (`client/downloader/downloader.js`, `consumer.js`)
correct, tested and as simple as they can be? **Why it matters:** a phone on lossy wireless re-dials often, and two
known defects sit on that path. **Do:**
* Fix the two defects, each reproduced by a test that fails before the fix and passes after: (1) a `cancel` during a
  re-dial revives the cancelled ask or fill — no generation check after `await live()`; the ask and fill handlers
  compare `generation` there today, so find the path that still revives it (`resume()` re-asking `owedAsks()` and
  `issueFill()` after its `await connect()` are the suspects), and if none does, pin the guard with a test and say so;
  (2) `close()` during a re-dial adopts the new session — `resume()` never reads a closed flag.
* Test the 17 untested worker and consumer decisions: list them first in the row's cell (each a branch no test in
  `downloader.test.mjs`, `decoder.test.mjs` or the conformance clauses reaches, shown by a mutant that survives).
* Simplify the states: whether `epoch` and `generation`, `resuming` and `dialling`, and the record states can be fewer
  without losing a behaviour the clauses state.

**Decides:** each new test fails on its mutant; the conformance clauses and dispatch checks still pass; the fill's total
time on row 23's harness (a subset: 20 and 50 Mbit, 1× and 4×) unchanged within its spread. **Adopt:** the round's rule.
**Branch:** `claude/av1-unified`. **Deliverable:** the fixes and tests, the decision list with each test's mutant, in
[`ARCHITECTURE.md`](../ARCHITECTURE.md) §The downloader and `client/downloader/README.md`.

### 51 SERVER

**Question.** What does the send path (`server/src/media/`: `frame_store.rs`, `read_path.rs`, `uring_reader.rs`,
`frame_pool.rs`; `server/src/transport/`: `frame_out.rs`, `pipeline.rs`) do that it need not? **Why it matters:** fewer
copies and syscalls are server CPU a frame, which bounds how many phones one host fills. **Do:** read
the disk-access ADR (`docs/adr/disk-access.md`) and `docs/transport/` first and do not repeat
what they measured; then the per-send copy (can a frame go from the store to the stream without one), mmap against
pread against the io_uring reader already there, and each layer's work; implement what is clearly better. Force a
store miss through the store's test levers, never by evicting the page cache. **Decides:** server CPU a frame
(`perf stat` or rusage over a fill, cycles and instructions a frame) and fill time on row 23's harness at 50 Mbit,
interleaved; say where the host saturates. **Adopt:** the round's rule. **Branch:** `claude/av1-unified`.
**Deliverable:** the change and its numbers in the disk-access ADR and `docs/transport/transport-conclusions.md`.

### 52 INGEST

**Question.** Can the HTJ2K ingest (whatever drives `ojph_compress` into `ingest/study-bundle` and `tools/pack-study`)
and the AV1 ingest (`lab/av1/item/ingest.py`) be one pipeline that reads, offsets and checks each frame once?
**Why it matters:** ingest cost is paid per study before any phone sees it, and two pipelines are two things to keep
true. **Do:** map each pipeline's passes over the pixels; merge them into one with a codec stage; measure the exact
round-trip check's share and make it cheaper without weakening it (in-process decode, not a subprocess); encode frames
in parallel across processes — never with libaom `--threads` > 1, which changes lossless bytes (row 66). **Decides:**
every output byte identical to today's (SHA-256 a file, HTJ2K and AV1, plain and optimized, on the breast series and
all nine of row 2's sets); wall time and CPU time a study, interleaved, at 1, 2 and 4 workers. **Adopt:** the round's
rule; bytes not identical is a refusal, not a trade-off. **Branch:** `claude/av1-unified`. **Deliverable:** the pipeline,
its numbers in `lab/av1/item/README.md` and the ingest's README.

### 53 SEAM

**Question.** Where do the transport, downloader, decoders and page duplicate each other, keep a path nothing reaches, or
decide the codec in more than one place? **Why it matters:** each seam is code a reader has to hold in mind; one
decision in one place is simpler and cannot disagree with itself. **Do:** after row 50 (same files), trace a frame
from `client/transport-ts` through `downloader.js`, `decoder.js` / `av1.js` and `consumer.js` to the page; list each
duplicated check, each dead path (one no product configuration reaches) and each codec decision; remove the dead and
merge the duplicated. A built capability not yet adopted (groups, the preview port) is not dead: list it with its cost
and leave it. **Decides:** lines and modules removed, every clause and dispatch check still passing, and the fill's total
time unchanged within its spread (row 23's harness, 20 and 50 Mbit, 1× and 4×). **Adopt:** the round's rule.
**Branch:** `claude/av1-unified`. **Deliverable:** the change, and what stays and why, in
[`ARCHITECTURE.md`](../ARCHITECTURE.md) and `client/downloader/README.md`.

### 54 GATE

**Question.** How long does `scripts/gate.sh` take, which of its tests claim the same thing twice, and which product
decisions does no test catch? **Why it matters:** a slow gate is skipped and a gap is a bug waiting; this row checks
what rows 49–53 left. **Do:** time each step (n = 3, `--quick` and full); find test pairs whose mutants are killed by
both; mutate the product at each decision point of the client, decoders, server send path and ingest, and give each
surviving mutant a test; cut a redundant test only when another kills every mutant it kills. **Decides:** gate time
before and after, the mutant kill count before and after. **Adopt:** the round's rule — no claim lost, each removal
shown covered. **Branch:** `claude/av1-unified`. **Deliverable:** the faster gate, the mutation table in the README that
owns the gate's prerequisites.

### 55 NAMING

**Question.** Does every name in wt-pacs — files, folders, identifiers, page and harness names, doc titles — meet the
round's principles? **Why it matters:** a reader learns the domain from its names; a name from the project's history or
a standard's other meaning teaches the wrong thing. **Do:** after row 54, so renames do not collide with the A rows.
Audit both trees (`claude/av1-unified` first); a table of each name, the principle it breaks and the proposed name —
candidates include the item format's *item* (DICOM's Item, (FFFE,E000)), *arm* in the lab, *version* and row-named
folders. Apply the clear renames with every reference, doc and link updated (`scripts/check_links.py` green); a name
on the wire, in the store's format or in the item format is structural: propose it. Record the principles and a
glossary (one concept, one name, defined once) in the doc that owns the repository's conventions. `CLAUDE.md` is the
owner's: propose its wording at the end of this brief, do not edit it. **Decides:** the gate green and no reference
left to an old name (a grep of each). **Adopt:** the round's rule. **Branch:** `claude/av1-unified`; the queue's own
docs here. **Deliverable:** the renames, the table of the rest, the glossary.

### 56 LAYOUT

**Question.** Are folders grouped by responsibility, and is each doc where the repository's rules place it?
**Why it matters:** a reader finds a thing by what it does, not by when it was made; the lab's `lab/av1/` holds one
folder a row. **Do:** after row 55; propose the tree first (what moves, why), then apply it with `git mv`, every
reference and link updated; docs follow `CLAUDE.md` §Docs — extend the file that owns the subject, no file a finding.
**Decides:** the gate green, `check_links.py` green, nothing lost (a file count and content hash before and after).
**Adopt:** the round's rule. **Branch:** `claude/av1-unified`; the queue's own docs here. **Deliverable:** the layout,
and a short map in the doc that indexes the tree.

### 57 VERSIONS

**Question.** What do newer libaom (after 3.15.1), SVT-AV1 (its lossless status; row 28 measured v4.2.0, never
smaller), dav1d (after 1.5.4), OpenJPH 0.32.0 (row 41: one mask in the WASM decoder), Emscripten (after 3.1.74: SIMD,
relaxed SIMD, threads) and Chromium's WebCodecs since 141 (12-bit AV1, monochrome output, `optimizeForLatency`) gain
or break for us? **Why it matters:** a newer tool may give bytes or decode time for free, or silently break exactness.
**Do:** read each release's notes and changelog (cite them, with dates); list per tool what bears on lossless, high
bit depth, monochrome, decode speed or WASM; measure the promising ones on the breast series against the pinned
version. **Decides:** bytes (cpu0 and the shipped preset), decode time a frame in headless Chromium at 1× and 4×,
interleaved, and exactness on every frame. **Adopt:** the round's rule; a version change is a new pin in
[`licensing.md`](licensing.md) and the lab's build. **Branch:** `claude/av1-unified`. **Deliverable:** per tool, gain or
break with its source and number, in [`README.md`](README.md) §Measured here and `lab/av1/README.md`.

### 58 LITERATURE

**Question.** What has lossless medical image coding published in 2023–2026 — newer methods, HTJ2K improvements, learned
lossless codecs — and which could run in a browser today? **Why it matters:** the lab compared the codecs it knew; a
better one may exist. **Do:** web research only, primary sources (papers, standards, implementers' docs), every claim
cited with its source and date, unconfirmed claims marked; per method its reported gain over JPEG 2000 / HTJ2K / JPEG-LS
on which data, its decode cost and whether a WASM or WebGPU decoder exists. Coordinate with row 48: link
[`split-prior-art.md`](split-prior-art.md), repeat nothing in it. **Decides:** a ranked list by expected gain against
browser feasibility. **Adopt:** nothing here; a measurement it suggests is proposed at the end of this brief, not
queued. **Branch:** `claude/av1`, docs only. **Deliverable:** a new `lossless-literature.md` in `docs/av1/`; a one-line verdict here.

### 59 RESLEVEL

**Question.** If HTJ2K decodes only the resolution level a phone screen needs (about 1 000 px against mammograms of
3 328–4 096 px), exact at that size, with full resolution on zoom, how much sooner is the first exact picture on screen,
and in how many fewer bytes? **Why it matters:** a phone shows a mammogram at a quarter of its size or less, so most of
the decode, and maybe most of the bytes, buy nothing until zoom. **Do:** read `docs/adr/resolution-fitting-for-large-frames.md`
first. Two parts: (1) decode only — OpenJPH's reduced-resolution decode on today's codestreams; (2) bytes — a
resolution-first progression whose prefix holds the low levels; asking for a prefix touches the wire, so build it in
the lab only and propose it. "Exact" at a reduced level: identical to an independent decoder's reduced output of the
same codestream (OpenJPEG `-r`); the full frame exact against the source checksum. Row 45's `ffdm_*` and `syn2d_*`, and
the DBT slices. **Decides:** bytes and time to the first exact on-screen picture against today's full-resolution path,
on row 23's links (5/20/50 Mbit, `lte-good`, `wifi-home`) at 1× and 4×, interleaved, n ≥ 10; zoom-to-full time.
**Adopt:** the round's rule; HTJ2K's path may change here. **Branch:** `claude/av1-unified`. **Deliverable:** numbers and
a proposal in [`decode/README.md`](../decode/README.md) and the resolution-fitting ADR.

### 60 LOSSLINK

**Question.** How do fill and on-demand time behave over links with 1–5 % packet loss and jitter, HTJ2K against AV1?
**Why it matters:** the target is a phone on lossy wireless, and every measurement so far used clean shaped links.
This is performance under loss, not resilience features. **Do:** add loss (1, 2, 5 %) and jitter (two levels, stated in
ms) at the relay — `link_impair.py`, or netem where the container allows `tc`; say which — on 5/20/50 Mbit and
`lte-good`; HTJ2K against the adopted optimized AV1 item. Fill and on-demand apart (asks are parked during a fill):
quote the fill's time and an ask's latency, not throughput beside them. **Decides:** fill time and ask latency (p50,
p95) per loss and jitter cell at 1× and 4×, Williams order, n ≥ 10, `VOID` dropped; say where the host saturates.
**Adopt:** the round's rule; a transport change it suggests is proposed. **Branch:** `claude/av1-unified`.
**Deliverable:** a §Under loss in [`README.md`](README.md) §Total time and `lab/av1/total/README.md`.

### 61 TRANSFER

**Question.** How do other systems deliver medical images — DICOMweb (WADO-RS, rendered and frame retrieval),
progressive HTJ2K delivery in open-source viewers and cloud imaging services, QUIC datagrams with forward error
correction, HTTP/3 range requests — and what do they do better than us? **Why it matters:** our transport was built by
measurement against one baseline; others may have solved a problem we have not met yet, on a phone above all.
**Do:** web research only, primary sources, every claim cited with its source and date, unconfirmed claims marked;
per system what it sends, in what order, at what resolution, and how it survives loss. **Decides:** a list of what each
does better, each with the measurement that would test it here. **Adopt:** nothing here; rows proposed at the end of
this brief, not queued. **Branch:** `claude/av1`, docs only. **Deliverable:** a new `delivery-prior-art.md` in `docs/transport/`;
a one-line verdict here.

### 62 GPU

**Question.** Can GPU HTJ2K decoders' methods (nvJPEG2000; papers on parallel HT block decoding) move to WebGPU beyond
the wavelet step row 41 bounded out? **Why it matters:** the HT block decoder is 55–70 % of an HTJ2K frame (row 41),
the one stage a GPU could take that the copies do not eat. **Do:** research from primary sources, cited with dates;
which stages each moves and how (code-block parallelism, the MEL/VLC/MagSgn decoding); then a feasibility bound — the
share of a frame a WebGPU stage could remove, minus the bytes to and from the GPU, per row 41's profile, on the breast
series. Measure only if the bound shows a gain over 15 %; the container has no GPU (SwiftShader only), so say what that
leaves unmeasured. **Decides:** the bound per series and stage. **Adopt:** the round's rule if built; a bound alone
adopts nothing. **Branch:** `claude/av1` for the doc, `claude/av1-unified` for any build. **Deliverable:**
[`decode/README.md`](../decode/README.md) §Faster HTJ2K in the browser, extended.

### 63 JXL

**Question.** Does JPEG XL earn a place: lossless at faster efforts (and `--faster_decoding`) in WASM, and decoded
natively by the browser? **Why it matters:** JPEG XL was 0.83–0.95 of HTJ2K's bytes (rows 6, 10, 21, 22) but its
WASM decode 4.0–6.2× OpenJPH's (row 22); a fast setting or a native decoder could change that. **Do:**
* bytes and WASM decode time at efforts 1–7 and `--faster_decoding` 0–4, libjxl pinned (row 6 found cjxl 0.7.0
  inexact on 12-bit PGM: check the pinned one at every depth);
* which engines (Chromium, Firefox, WebKit at their current versions) decode JPEG XL natively, read from each
  engine's source or release notes and tested;
* whether native decoding returns exact samples at 8, 10, 12 and 16 bits or only display pixels, through `<img>` and a
  canvas, `ImageDecoder` in WebCodecs, and `createImageBitmap`.

**Decides:** bytes over HTJ2K; decode time a frame native, WASM and OpenJPH at 1× and 4×, interleaved, every frame
checked against the source. **Adopt:** the round's rule. **Branch:** `claude/av1-unified`. **Deliverable:** per engine
and API, exact or not at each depth, and the speeds, in [`decode/README.md`](../decode/README.md) and
[`README.md`](README.md) §Measured here.

### 64 REMAP

**Question.** When the values that push a series over 12 bits are rare (the DBT projections' saturated 16383, while
every other sample fits 12 or 11 bits; a CT's pad value), does mapping them out with a small exception map, so the
series codes at ≤ 12 bits, beat the split? And, generalized, a palette for the high bits? **Why it matters:** the
projections are breast content over 12 bits, and the split pays a second stream for them. **Do:** measure first the
share of samples and levels each series' high bits use (`dbtproj_*`, the CTs, `ffdm_b`'s stretched range); code the
remapped plane (an outlier replaced by a predictor's value, its position and value in a deflated map) and a
high-bit palette; link row 48's proposal (2), histogram packing, and do not duplicate it. **Decides:** every frame
exact; bytes (map included) over HTJ2K and over the k = 2 split; decode time a frame with the map applied, at 1× and 4×,
interleaved. **Adopt:** the round's rule; the item format's change is proposed in [`item-format.md`](item-format.md),
built in the lab only. **Branch:** `claude/av1-unified`. **Deliverable:** numbers in `lab/av1/README.md` §DEPTH and
[`README.md`](README.md) §A3.

### 65 ORDER

**Question.** Does the order frames are sent in shorten the time to the first useful image without costing the fill:
DBT centre-out (the slice a reader starts on) against top to bottom, and mammography in view priority? **Why it
matters:** on a slow link the first image a reader needs is worth more than the last. **Do:** read
`docs/adr/reject-server-ordering.md` first — the order is the client's fill request, not the server's; define "useful"
per content (DBT: the centre slice and its neighbours; mammography: the views a hanging protocol shows first, cited);
measure each order on the DBT slices and row 45's mammograms, HTJ2K and AV1. **Decides:** time to the first useful
image exact on screen and to the full fill, on row 23's links at 1× and 4×, Williams order, n ≥ 10. **Adopt:** the
round's rule. **Branch:** `claude/av1-unified`. **Deliverable:** numbers in [`ARCHITECTURE.md`](../ARCHITECTURE.md) §The
first fill and [`README.md`](README.md) §Total time.

### 66 POCGAP

**Question.** Why did an earlier private proof of concept report lossless AV1 about 31 % below HTJ2K on 10-bit data,
when the lab finds a few percent? **Why it matters:** a number we cannot reproduce must not steer the codec choice. A
local reproduction found it came from medians over unpaired fixtures — four 10-bit fixtures coded only in HTJ2K;
paired fixture by fixture AV1 ÷ HTJ2K is 0.961. Real 10-bit DBT measured plain AV1 at 0.950 / 0.958 / 0.969 and the
lab's optimized representation at 0.921–0.942. **Do:**
* fetch two more public 10-bit DBT series: UPMC Case22 from D. Clunie's public DBT archive, and TCIA BCS-DBT
  DBT-P01237. Read each licence first (BCS-DBT may be CC BY-NC); fetch only CC BY or CC0, pinned and checksummed in
  `lab/av1/fetch_data.sh` and `data.json`; list any other under `## Blocked`;
* run them through `lab/av1/llsize/llsize.py` with its HTJ2K profile, every coding exact;
* record: medians only over paired fixtures; libaom's lossless bytes depend on `--threads` (0.05–0.15 % a frame), so
  the lab's `--threads=1` pin is required, stated where the encoders are; cropping the background moved AV1 ÷ HTJ2K by
  0.8 point; libaom 3.8.2 against 3.15.1 at cpu6 differs by ≤ 0.4 point; u8-scaled copies favour AV1 by 3–6 points.

**Decides:** AV1 ÷ HTJ2K per fixture, paired, plain and optimized. **Adopt:** nothing to adopt; the prior evidence is
corrected in place. **Branch:** `claude/av1` (`llsize` and the fetch are here). **Deliverable:** [`README.md`](README.md)
§Prior evidence, not reproduced here, corrected; `lab/av1/llsize/README.md` and [`FIXTURES.md`](../FIXTURES.md) §AV1 data.

## Blocked

* **2026-10-07 01:00 UTC: row 52 INGEST — lossless AV1 bytes depend on `--jobs`.** Ingest codes each worker's frames
  in one aomenc run of keyframes, and libaom carries state across keyframes: on the 10-bit tomosynthesis volume the
  frames after a chunk's start differ between 1, 2 and 4 workers, in the replaced ingest as in the new one (every frame
  exact either way; the fluoroscopy and ultrasound unaffected). One run per frame would make the bytes independent of
  the worker count and change today's bytes. The owner decides; [`lab/av1/item/README.md`](../../lab/av1/item/README.md) §One pipeline.

* **2026-10-07 00:30 UTC: row 66 POCGAP — neither 10-bit DBT series it names is CC BY or CC0, so neither is fetched.**
  The UPMC breast tomography collection on D. Clunie's public archive (`dclunie.com/pixelmedimagearchive`, read
  2026-10-07; Case22 is 137 MB, MD5-listed) states no licence at all; TCIA's Breast-Cancer-Screening-DBT
  (DOI 10.7937/E4WT-CD02, DBT-P01237's collection) is CC BY-NC 4.0 on every file group. The owner decides whether
  either is acceptable (fetch-at-run-time only, never committed); the row measures the brief's other claims on the
  lab's two CC BY 4.0 10-bit DBT series meanwhile.

* **2026-10-06 22:20 UTC: rows 47 MIXDEC, 51 SERVER and 57 VERSIONS stale** — claimed 00:49–01:10 UTC, no commit
  from their lanes in the six hours since but 57's `a6f960c` (01:27); set back to `night`. 57 continues from `a6f960c`.

* **2026-10-06 22:15 UTC: the night sessions of 10-06 hit the account's usage limit at about 01:30 UTC mid-row** —
  rows 44, 49, 50, 52 and 59 were set back to `ready`. Pushed partial work to continue from, not redo: all on `claude/av1-unified`:
  44 SPLITTIME `302722d` (bytes per arm k), 50 CLIENT `f136363` (both re-dial defects), 52 INGEST `c566011`,
  `2d77d7d` (the one ingest, its bench); 49 and 59 have none and start fresh. Rows 47, 51
  and 57 (57 has `a6f960c` on `claude/av1-unified`) stay claimed; the stale rule applies to them.

* **2026-10-05 16:30 UTC: row 46 BREAST — what full network access still does not open.** Every host rows 21, 35
  and 45 found refused answers now, but `pan.baidu.com` (connection reset); the attempts are in
  [`FIXTURES.md`](../FIXTURES.md) §AV1 data. Not fetched, the owner decides:
  * *Automated breast ultrasound* — TDSC-ABUS 2023: its challenge page calls the data "publicly available" through
    `pan.baidu.com` and states no licence; its Zenodo record (the challenge's proposal) is CC BY-NC-ND 4.0. No
    other ABUS set was found on Zenodo, figshare, Mendeley Data or Hugging Face.
  * *Breast ultrasound video, the MICCAI 2022 set* — non-commercial (row 45's line). Row 46 took a CC BY 4.0 set
    instead (`usb_cine`, `usb_cine_rgb`), whose clips are lossy MPEG-4 at 512².
  * *DBT from a third vendor* — every CC BY tomosynthesis series in IDC v24 and in TCIA's own index is the lab's two
    vendors'; Breast-Cancer-Screening-DBT is CC BY-NC 4.0 and one of the same two.

* **2026-10-05: row 46 BREAST waited on the cloud environment's network access** — switched to full by the owner the same day; row 46 set to `ready`.

* **2026-10-05 14:30 UTC: row 45 DATA3 — three taxonomy items still unreachable** (every host below refused the
  tunnel, CONNECT 403; [`FIXTURES.md`](../FIXTURES.md) §AV1 data has the full attempt list). The owner decides
  whether to allow a host or fetch locally:
  * *Breast ultrasound cine* — the breast-lesion ultrasound video set of the MICCAI 2022 paper (arXiv 2207.00141):
    non-commercial research and education only, per its README (read through `raw.githubusercontent.com`), so
    fetch-at-run-time only; hosts `drive.google.com` and `pan.baidu.com`.
  * *Automated breast ultrasound* — the TDSC-ABUS 2023 challenge volumes; licence not read (host refused); hosts
    `tdsc-abus2023.grand-challenge.org`, `grand-challenge.org`, `zenodo.org`.
  * *Contrast angiography runs* — CADICA (`data.mendeley.com`) and ARCADE (`zenodo.org`); licences not read
    (hosts refused). IDC v24's 35 XA series are all single frames.

* **2026-10-04 20:43 UTC: row 35 DATA2 stopped at its first step** — `zenodo.org` and `www.cancerimagingarchive.net` are still refused (CONNECT 403, organization policy), so breast ultrasound cine and angiography stay unmeasured; allowing a host is the owner's.

* **2026-10-04 07:10 UTC: row 23 TOTAL is measured twice over, or about to be.** The session that claimed it at
  `04fa4d3` was mid-run when its claim was set stale (14 rounds × 160 visits take ~10 h, with no commit until the
  end); it finished and pushed the reading as `bc35549` — 2 257 visits, n = 10–16 a cell, 70 022/70 022 frames
  exact, [`README.md`](README.md) §Total time. Row 23 was claimed again by another session meanwhile, so this one
  leaves the row as it stands. The owner, or the claim's holder, decides whether `bc35549` closes it. A stale
  rule that counts commits misses a timed lane; a long lane could push its partial rows.
  *Resolved, 2026-10-04:* the claim's holder ran the harness again (10 rounds) as a replication and closed the row on both.

* **2026-10-04 05:20 UTC: row 23 TOTAL's claim (2026-10-03 22:54 UTC) went stale** — over six hours with no commit from its lane; set back to `night`.

* **2026-10-03 19:43 UTC: every session hit the account's five-hour usage limit mid-row** — rows 23, 24, 25, 27, 28 and 30 were set back to `ready`; nothing of theirs had been pushed, so a session taking one starts it fresh.

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
* **Phone hardware decoders (row 29).** Whether a phone's AV1 decoder takes lossless frames and
  returns them exactly needs phones; a container has none. From source only: Android's public API
  names AV1 Main 8/10-bit only, and its performance class guarantees a hardware Main 10 decoder at
  level 4.1, under the tomosynthesis projections' picture size; WebKit's in-process WebCodecs AV1
  path refuses all but 8-bit 4:2:0 (README §Options to try). The owner decides whether to source
  devices — which phones, and whether through a hosted device service — and the row follows.
