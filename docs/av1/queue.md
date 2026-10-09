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
3. Take the **topmost `ready` row**. Set it to `claimed` with the date and a 6-hex id you draw once per session (`openssl rand -hex 3`), e.g. `claimed 2026-10-07 (night, a3f91c)`, commit that alone, push; a row whose claim does not carry your id is not yours. The
   push is the lock: if it is rejected, rebase and take the next `ready` row.
4. Do the lane. Push your work (rebase first).
5. Set the row to `done` with the commit hash after the rebase that pushed it, a one-line verdict
   with its numbers, and where the finding lives. Flip any `after …` row whose prerequisites are now
   all done to `ready` in the same commit. Push.
6. Back to 1. Stop when no row is `ready` and say so; do not invent work.

**`night` rows** are held for the night routine (the owner, 2026-10-03: cloud work runs while the workstation
sleeps, so the two never share a usage window). A session started by the night routine treats `night` exactly as
`ready`; any other session leaves them.

**Theory first, then measurement in a separate context (owner, 2026-10-07).** A row that measures to decide writes,
before any new data, a hypothesis document from primary sources: the mechanism, explicit predictions per content and
parameter, the measurement protocol, and a pre-stated decision rule (what result adopts or rejects what). The
measurement runs in a separate session that is given only the protocol and the decision rule, not the reasoning; it
reports the numbers, then whether each prediction held. A short review closes the row: theory against data,
conclusive or not, and why. Rows already queued keep their briefs.

**`held until <UTC time>` rows** wait for the owner's next usage window: a session treats one as `ready` once
`date -u` is at or past that time, and leaves it before. An `after …` clause on the same row still applies.

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
* **A host that cannot meet its `VOID` bar decides alone (the owner, 2026-10-09).** A timed row whose host voids more
  than its bar allows reports both readings: *strict* (pairs with neither visit `VOID`) and *round-paired* (both
  variants on the same link in the same round, `VOID` included, as row 88's five-link table did). If they agree, that
  is the row's verdict, stated with both. If they disagree, the row is "not conclusive on this host" and goes back to
  `ready` or `night`, as it was, for a host that passes; it does not wait on the owner.
* **A timed row longer than an hour writes a provisional reading** — one line in its cell after each pushed round —
  so the owner sees results early.
* **Sound data only decides** (row DATAGUARD, 2026-10-08). A set classed `lossy-sourced` or `unknown` in
  `lab/av1/data.json` ([`../FIXTURES.md`](../FIXTURES.md) §Provenance, on `claude/av1-unified`) enters no bytes,
  time or inter verdict: its numbers are reported as measured and marked provisional. Exactness on it still counts.
* **Pin every tool** (tag or version, and a checksum of anything fetched). Fetched data and built
  binaries are not committed; the script that makes them is.
* **Code beside today's path, not instead of it.** HTJ2K keeps working unchanged; the gate
  (`scripts/gate.sh`) stays green. A change to the transport's unit, the wire or the store's format
  is structural: propose it in the owning doc, do not build it.
* **This repository is public.** Never name the private comparison stack the term scanner guards: write "the
  reference implementation". Open-source projects, vendors and standards are named and cited as sources like any
  other (the owner, 2026-10-09). Licences go in [`licensing.md`](licensing.md); anything new that is shipped or fetched
  is added there with its licence before it is used.
* Commit messages hold the change only — no attribution, co-author or session trailers.
* Blocked on a decision only the owner can make: add it under `## Blocked`, push, take the next row.

## Queue

| # | what | state |
| --- | --- | --- |
| 1 | **TOOL** — the encoders and a native decoder, pinned, and a lossless round trip at every depth and layout | done `c20e37f` — libaom 3.8.2 and 3.15.1 (pinned), SVT-AV1 v4.2.0, dav1d 1.5.4 built from pinned sources; lossless intra exact in every cell (grey 8/10/12 4:0:0, RGB 8/12 4:4:4, odd size, 2 presets, 16/16 frames, each unit decodes alone); **inter at 10/12 bits inexact on both libaom versions** (1–8 of 16 frames, ≤ 61 669 samples, \|Δ\| ≤ 11; dav1d and aomdec agree, so the encoder) and **exact with `--auto-alt-ref=0`**; 3.15.1's aomenc cannot encode 12-bit 4:4:4; SVT-AV1 4:2:0 8/10-bit only, its 10-bit inter inexact under every setting tried; rav1e 0.7.1 has no lossless mode (1 674 of 196 608 samples wrong at qp 0); 4 mutations caught 4/4 — [`lab/av1`](../../lab/av1/README.md), [`README.md`](README.md) §Measured here |
| 2 | **DATA** — public, freely licensed multi-frame series, fetched and checksummed | done `7dee2a5` — 5 CC BY series, 310 frames, ~205 MB from the NCI Imaging Data Commons public bucket (TCIA's API, Zenodo, PhysioNet refused by the container's network policy): CT 100 × 512² signed (LIDC-IDRI), MR 58 × 512² (ISPY1), RGB ultrasound cine 70 × 760×421, 12-bit fluoroscopy 18 × 768², 16-bit cone-beam 64 × 512²; every file and set SHA-256-pinned, frames identical to `PixelData` 310/310, 5 mutations caught 5/5; CT spans −2048..3746 and cone-beam 0..7364, both 13 bits after any offset; no open angiography run — [`FIXTURES.md`](../FIXTURES.md) §AV1 data |
| 3 | **WCAP** — what WebCodecs' AV1 decoder supports in headless Chromium, and whether it returns samples exactly | done `c0cc63e` — Chromium 141 (headless, no GPU): every 8- and 10-bit cell exact, 16/16 (4:0:0, 4:2:0, 4:2:2, 4:4:4 GBR × intra and G = 8, 8/8 frames each, per plane against the encoder input); **12-bit refused, 8/8** — `decode()` rejects its keyframe while `isConfigSupported` says true (it also says true to profile-illegal strings); `prefer-hardware` unsupported; 4:0:0 returns `I420` with mid-grey chroma; the decoder holds 2 frames until `flush()`, so 1 unflushed chunk gives 0 frames (*corrected:* not the earlier empty probe's cause — it flushed; that stays unexplained) — [`decode/README.md`](../decode/README.md) §AV1, [`README.md`](README.md) §A2, [`lab/av1/exact/webcodecs`](../../lab/av1/exact/webcodecs/README.md) |
| 4 | **WASM** — dav1d built to WASM, exact against native dav1d | done `0af2b78` — exact: dav1d 1.5.4 / emscripten 3.1.74, scalar, `-msimd128` and `-pthread` arms match native dav1d and a native build with assembly on every frame of 12 lossless streams (8/10/12-bit 4:0:0 and 4:4:4, intra and G = 8), one picture per temporal unit at frame delay 1; 546 / 623 / 635 KB `.wasm` (219 / 238 / 244 KB gzip); libaom 3.8.2 inter 10/12-bit inexact reproduced (≤ 15 904 of 1 M samples, \|Δ\| ≤ 11) — [`client/decode/wasm/dav1d`](../../client/decode/wasm/dav1d/README.md), [`README.md`](README.md) §A2 |
| 5 | **SEAM** — the codec seam and, if inter coding pays, the group as the transport's unit: a proposal | done `7e42c0a` — proposed, not measured: `codec` in the bundle's metadata (absent = htj2k, unknown = refused before the dial), one decoder module per codec behind `decoder.js`; G > 1 as the client's unit (`request_frames [k … N]`, a group to one decoder) with 0 wire, store or server changes, 7 invariants named as broken; needs SIZE and SPEED before a G — [`adr-unit.md`](adr-unit.md) |
| 6 | **SIZE** — lossless bytes: AV1 intra, AV1 inter by group length, HTJ2K | done `4c8b288` — **AV1 lossless coded whole is larger than HTJ2K on every real series** (*corrected by DEPTH: split, it is below HTJ2K on every series over 10 bits*)**, and inter collects nothing**: bytes over HTJ2K's at libaom 3.15.1 cpu0, intra → whole series, fluoroscopy 1.024 → 1.027, MR 1.034 → 1.062, ultrasound RGB 1.117 → 1.534 (cpu6 1.04–1.75); smallest G with most of the gain is G = 1; JPEG XL 0.83–0.93 (reference); CT and cone-beam need 13 bits (DEPTH); 122/122 codings exact, each group decoded alone; cjxl 0.7.0 found inexact on 12-bit PGM; 5 mutations caught — [`lab/av1`](../../lab/av1/README.md) §SIZE, [`README.md`](README.md) §A1 *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 7 | **DEPTH** — 12-bit, signed and 16-bit samples in AV1 | done `abcf738` — CT (−2048..3746) and cone-beam (0..7364) need 13 bits after any offset, MR and fluoroscopy fit 12; best split **top11+low** (v ≫ 2 at 12 bits, v & 3 at 8): bytes over HTJ2K at libaom cpu0 CT **0.918**, cone-beam 0.997, MR 0.990 (direct 1.034), fluoroscopy 0.946 (direct 1.024); hi/lo bytes worst, 1.20–1.37; top10+low keeps every stream ≤ 10 bits (WebCodecs-decodable) at 0.994–1.071; two streams decode in the time of one (native dav1d, n = 15 interleaved; merge 0.05 ms/512²); 12-bit needs dav1d, WebCodecs refuses it; 44/44 splits exact, 3 mutations caught — [`lab/av1`](../../lab/av1/README.md) §DEPTH, [`README.md`](README.md) §A3 |
| 8 | **DEC** — an AV1 decoder behind `decoder.js`'s contract, chosen by the series' codec | done `794c42d` — built at G = 1: `decoder.codec: "av1"` loads `av1-dav1d.js` (dav1d-WASM `simd`, 623 KB, flushed before every frame) behind the unchanged contract; all 6 shapes (8/10/12-bit grey and RGB) exact through the downloader against the generator's checksums, a frame of a group, an empty unit and a non-AV1 file refused, an unknown codec refused before the dial; dispatch 105 → 123/123, every new check mutated to fail; no wire or store change needed — [`client/README.md`](../../client/README.md), [`adr-unit.md`](adr-unit.md) §2 |
| 9 | **SPEED** — decode time per frame and per group: dav1d-WASM, WebCodecs, OpenJPH; the ask and fill it implies | done `15f29e3` — **AV1 decodes 5–10× slower than HTJ2K and wins on nothing here**: product worker, first 18 frames of fluoroscopy, MR and ultrasound, 16 interleaved rounds, Node and Chromium 141 at 1× and 4×, 7 488/7 488 frames exact, 2 mutations caught 13/13 cells; dav1d-WASM 5.4–9.7× OpenJPH (fluoroscopy 70 vs 9.8 ms, MR 26 vs 4.9, ultrasound 48 vs 7.9 in Chromium at 1×), slower in 224/224 paired rounds, dav1d itself ~90 % of it; WebCodecs 4.1–4.2× (ultrasound only: it refuses 12 bits); at G = 1 an ask pays 20–260 ms more decoding, and at 4× on a 50 Mbit link AV1 becomes the fill's clock on every series where HTJ2K never is (arithmetic) — [`decode/README.md`](../decode/README.md) §Decode time against HTJ2K, [`README.md`](README.md) §A1–A2, [`lab/av1/decode/per-frame`](../../lab/av1/decode/per-frame/README.md) *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 10 | **CONTENT** — the content the verdicts lack: tomosynthesis and a contrast angiography run | done `72c6560` — **inter does not pay on tomosynthesis either**: two CC BY 4.0 breast tomosynthesis volumes (EA1141, 1 mm; 29 × 614×1359 12-bit, 24 × 678×1727 10-bit cropped to the breast, crop drops only zeros), libaom 3.15.1 cpu0: best group against intra +1.2 % (12-bit, G = 2) and −0.6 % (10-bit, whole; −1.8 % at cpu6), far from `adr-unit.md` §4's fifth; AV1 over HTJ2K intra 1.043 and **0.977 — the first series where AV1 coded whole is smaller**; top11+low 0.943 and 0.946; JPEG XL 0.917, 0.851; 54/54 codings exact, each group decoded alone; the new crop and its pin mutated, 2/2 caught; **no open angiography run**: every IDC XA series is single frames (Blocked) — [`lab/av1`](../../lab/av1/README.md) §SIZE, §DEPTH, [`FIXTURES.md`](../FIXTURES.md) §AV1 data, [`README.md`](README.md) §A1, §A3 *Confirmed at scale (row DBTSCALE): coded whole 1.054–1.083 of HTJ2K on ten 12-bit volumes, 0.776–0.975 on five 10-bit ones.* |
| 11 | **FILL** — the fill's decode measured, not multiplied: three decoders, HTJ2K against AV1, through the downloader | done `be03c64` — **at 1× AV1 fills at the wire's pace; at 4× on 50 Mbit it is the fill's clock on every series, HTJ2K on none**: whole series through the downloader, three decoders, real server behind the relay (40 ms), Chromium 141, 20 and 50 Mbit, 40/16 rounds Williams-ordered, 230/784 `VOID` dropped, n = 12–30; 40 544/40 544 frames exact, 2 mutations caught 7/7; AV1 slower in 174/174 pairs — at 1× +86 to +895 ms (+4–12 %, its bytes; decoding ends 24–72 ms after the last byte), at 4×/50 Mbit 0.50–1.85 s of decoding after the last byte against HTJ2K's 20–38 ms, the fill +27 % MR, +35 % fluoroscopy, +68 % ultrasound (5.34 vs 3.17 s); 94–274 ms behind at 4×/20 Mbit; WebCodecs keeps up on the 8-bit ultrasound (116 ms behind at 4×); the arithmetic's verdict holds, its sizes were optimistic — [`README.md`](README.md) §A1, [`lab/av1/delivery/fill`](../../lab/av1/delivery/fill/README.md) *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 12 | **PREVIEW** — a lossy first picture, the exact frame after: what it buys a cine on a phone link | done `0c59dfd` — **a lossy AV1 preview at 0.78 % (fluoroscopy, CRF 20, 43.9 dB, max \|Δ\| 433 of 4095) and 7.0 % (ultrasound, CRF 32, 34.2 dB) of the exact HTJ2K bytes makes the cine playable 74–124× and 14× sooner on 5 Mbit/s** (0.12–0.20 s against 14.8 s; 2.0 s against 28.8 s) and 4–32× sooner than HTJ2K's half-size prefix (26–32 % of the bytes, 27 dB); every frame exact later by that share, +0.8 % and +7 %; dav1d-WASM decodes a preview frame 1.1–3.3× slower than OpenJPH the exact one, so at 50 Mbit/s and 4× it loses to HTJ2K's prefix (1.21 against 0.93 s), WebCodecs 2.4–13× faster than dav1d-WASM (0.24 s); G = 8, not the whole series, keeps decoders parallel; timeline arithmetic over measured bytes and decode times (15 interleaved rounds, Chromium 141, 1× and 4×, 68 640/68 640 frames matching), no angiography run available, whether a lossy first picture is acceptable is the owner's — [`README.md`](README.md) §A5, [`lab/av1/delivery/preview`](../../lab/av1/delivery/preview/README.md) *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 13 | **SPLIT10** — the top10+low split through WebCodecs: exact, and how fast | done `25ddebd` — **exact, and 2–3× faster than dav1d-WASM, still 2–4× slower than HTJ2K**: Chromium 141 headless, CT, cone-beam, MR and fluoroscopy, first 18 frames, 16 interleaved rounds at 1× and 4×, 9 216/9 216 frames exact; WebCodecs top10+low (two `VideoDecoder`s, merged) 0.44–0.50 of dav1d-WASM top11+low's time at 1× and 0.32–0.40 at 4× (faster in 128/128 paired rounds; CT 13.5 against 29.2 ms, fluoroscopy 36.3 against 83.4), 2.6–3.9× OpenJPH at 1×, 2.1–3.7× at 4×; the decoder, not the split, is the gain (dav1d-WASM on top10+low 0.89–0.97 of top11+low); bytes top10+low 0.973–1.064 of HTJ2K, top11+low 0.904–0.998; WebCodecs' thread count not measured; 5 mutations caught — [`README.md`](README.md) §A3, [`lab/av1/decode/split-webcodecs`](../../lab/av1/decode/split-webcodecs/README.md) |
| 14 | **ENC** — encode time, uncontended, per preset and content: ingest cost, and whether lossless can run live | done `7e572d0`, `ce6f81c` — **lossless AV1 cannot be encoded live except at its fastest intra preset, and then larger than HTJ2K**: libaom 3.15.1, one uncontended core, 8 frames a set × 26 presets × 3 interleaved rounds, 546/546 runs exact; slowest preset 3.0–11.1 s a frame; fastest intra within 2 % of its bytes 0.35–1.6 s (0.6–2.9 frames/s: MR good6, CT allintra6, cone-beam good6, fluoroscopy allintra7, tomosynthesis good6 / allintra5), the RGB ultrasound only at the slowest (7.2 s); 30 frames/s of 512² only at allintra9 on MR (36.7) and CT (33.3), 1.05–1.19 of the slowest's bytes and above HTJ2K's; real-time inter exact at 10–13 bits and the smallest AV1 coding on 10-bit tomosynthesis (0.94 of HTJ2K, 5.5–9.6 frames/s); `ojph_compress` 58–136 frames/s into fewer bytes; 5 mutations caught — [`lab/av1`](../../lab/av1/README.md) §ENC, [`README.md`](README.md) §Measured here *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 15 | **SVC** — libaom's real-time scalable encoder in lossless mode at 10 and 12 bits: exact or not | done `49a101b` — **exact in every cell it encodes**: libaom 3.15.1 `svc_encoder_rtc` at `--min-q=0 --max-q=0` (no hook), grey 4:0:0 and RGB 4:4:4 at 8/10/12 bits, L1T1/L1T3/L2T1/L3T3 scaled and full-size, speeds 7 and 10, synthetic and the fluoroscopy, MR and ultrasound series: 418 layers, 10 436/10 436 frames, each operating point decoded alone; the stock example encodes 8/10-bit 4:2:0 only — 12-bit, 4:4:4 and 4:0:0 need a patch to its CLI, kept in the lab; scaled layers have no truth and are not compared; 1.07–1.58 of HTJ2K's bytes at L1T1; 5 mutations caught — [`lab/av1/delivery/scalable/encoder`](../../lab/av1/delivery/scalable/encoder/README.md), [`README.md`](README.md) §Measured here |
| 16 | **GOP** — the group as the item: whole groups asked and sent in order, a group to one decoder, fill start to end | done `dc71635` — **built, no wire, store or server change**: `groupLength` + `frameCount` beside `decoder`; an ask for any frame asks its whole group k … k+G−1 (cut at the series' end), a fill asks whole groups and a fill cut by an ask resumes mid-group on the decoder still holding it; a group goes to one decoder in index order — a split across decoders impossible by construction (a non-keyframe goes only to the decoder that took its predecessor) and refused by `av1-dav1d.js` if it happens; a failure fails the rest of its group by name; groups decode through dav1d-WASM only (WebCodecs is flushed per frame), a split series stays G = 1; a G = 8 set (20 frames, short last group) and a one-group set (12 × 12-bit) exact frame by frame against the generator's checksums, frames landing last to first still decode in order; 191/191 dispatch checks, 11 mutations caught 11/11, gate green; nothing timed — [`adr-unit.md`](adr-unit.md) §3 *Built*, [`client/README.md`](../../client/README.md) |
| 17 | **RESID** — a lossy AV1 preview plus a lossless residual: does the exact frame cost more than HTJ2K alone? | done `3dcee3c` — **the preview is free in bytes, not in decode**: the exact frame as a lossy AV1 preview (libaom 3.15.1 cpu6, G = 8, CRF 8–44, grey 4:0:0 10-bit, colour BT.601 4:2:0 converted back in integer arithmetic) plus source − preview coded losslessly; all seven series: preview + HTJ2K residual **0.947–1.002 of HTJ2K alone** at each series' best CRF (−5.3 % ultrasound, −5.0 % CT, +0.2 % 12-bit tomosynthesis; 0.947–1.021 over all 28 cells) against preview-then-HTJ2K's 1.001–1.222; the residual in AV1 better only on 10-bit tomosynthesis (0.930), colour 1.13–1.61; decode of preview + residual + add **1.31–1.89× HTJ2K alone through WebCodecs** at 1× (1.23–1.74× at 4×; slower in 207/210 paired rounds), 2.1–3.1× through dav1d-WASM, 4.9–11× with the residual in AV1; lossy output bit-identical across native dav1d, dav1d-WASM and WebCodecs 13 440/13 440 (8-bit 4:2:0, 10-bit 4:0:0), every frame exact 16 800/16 800 (headless Chromium 141, first 16 frames, 15 interleaved rounds at 1× and 4×); 5 of 6 mutations caught, a 1/65 536 nudge of a colour constant changed no sample — [`README.md`](README.md) §A5, [`lab/av1/delivery/residual`](../../lab/av1/delivery/residual/README.md) *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 18 | **SVCQ** — one scalable AV1 payload, a lossy base layer and a lossless top: the overhead of the layers | done `9b85a77` — **exact, and scalability nearly free, but it carries lossless AV1's size**: libaom 3.15.1 `svc_encoder_rtc` (lab patch `--layer-q`), two spatial layers, base half or full size at q 20–55, top lossless; every top frame exact on fluoroscopy, MR, ultrasound and two synthetic sets; total 0.95–1.04 of single-layer lossless AV1, so **1.04–1.64 of HTJ2K** against PREVIEW's 1.008–1.07 and RESID's 0.947–1.002; a half-size base is 0.03–2.4 % of HTJ2K at q 40–55 and decodes in 2–13 % of a lossless frame's time; the exact frame 3–30 % slower than single-layer (dav1d-WASM, Chromium 141 and Node, 1× and 4×, n = 15 interleaved, 270/270 a cell); `av1-dav1d.js`'s `all_layers` 1 returns the base then fails on such a payload; WebCodecs returns the top exactly and cannot choose an operating point; 5 mutations caught — [`lab/av1/delivery/scalable/two-layer`](../../lab/av1/delivery/scalable/two-layer/README.md), [`README.md`](README.md) §A5 *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 19 | **LCEVC** — the enhancement-layer standard: licence, whether it can end lossless, a browser decoder, a trial | done `cce8cc8` — **no trial possible, and not exact at 14 bits**: no open LCEVC encoder exists; LCEVCdec 4.2.2 and LCEVCdecJS 1.3.0 are BSD-3-Clause-Clear and grant no patents (commercial terms unconfirmed); the web decoder draws 8-bit RGBA through WebGL, no samples back, and the decoder's own WASM port is "not complete"; no lossless mode, but from the source at step width 1 the dequantisation is the identity and residuals land at 2^−f of a sample (f = 7/5/3/1 at 8/10/12/14 bits, nothing deeper), so an exact frame is reachable at 8–10 bits, at 12 with the 2×2 transform (256/256 classes; 4×4 36/36 patterns, not proven), and **not at 14: 128/256 offset classes of a 2×2 block unreachable**, so the 13-bit CT and cone-beam cannot end exact; a model of the decoder (the container refused to build it), 6 of 7 mutations caught — [`README.md`](README.md) §A5, [`licensing.md`](licensing.md), [`lab/av1/bytes/lcevc`](../../lab/av1/bytes/lcevc/README.md) |
| 20 | **WCDEC** — a WebCodecs AV1 decoder module beside dav1d-WASM, chosen per series where exact | done `ff7d38e` (`575abb5`) — built at G = 1: `av1-webcodecs.js` taken when the series says `depth` ≤ 10 and `VideoDecoder` exists, dav1d-WASM otherwise (absent depth included); the top10+low split (`[u32le top length][top][low]`, `split`) and a signed `offset` undone by both through a shared `av1-frame.js`; headless Chromium 141 dispatch arm 123 → 167/167: 8/10-bit grey and RGB exact through WebCodecs (4/4 units seen reaching it), the same with `VideoDecoder` removed and 12-bit with it present exact through dav1d (0 units), 13-bit, 13-bit signed and 16-bit signed splits exact through both, 7 bad units refused by both and the next frame exact, frames one at a time; 17/17 mutations caught, 1 equivalent (`codedWidth` = `visibleRect` on Chromium); YUV 4:4:4 with an unspecified matrix would pass WebCodecs' check where dav1d refuses it; **G > 1 not built** — waits on row 16's group path; not timed — [`decode/README.md`](../decode/README.md) §WebCodecs, the decoder the client runs, [`adr-unit.md`](adr-unit.md) §2 |
| 21 | **TAXO** — the cine-like taxonomy's content: breast ultrasound cine, automated breast ultrasound, tomosynthesis projections, angiography | done `3ad8171` — **inter does not pay on tomosynthesis projections either, and split they are under HTJ2K**: two CC BY 4.0 EA1141 series of raw views from two vendors' systems (9 × 1914×2572 cropped to the breast, 15 × 1280×2048), 14 bits as stored (one saturated value, 16383, above data ending at 3648 and 1794); top11+low by group, libaom 3.15.1: best group 0.29 % under intra (G = 8) on one, 0.2–1.0 % over on the other; **top12+low — the two low bits apart, the rule DEPTH found at 13 bits — 0.952 and 0.923 of HTJ2K**, top11+low 0.998 and 1.002, hi8+lo8 1.08–1.34; JPEG XL 0.937, 0.929; 32/32 split codings exact, each group decoded alone, 387/387 frames identical to `PixelData`; 3 pin and 3 group mutations caught 6/6; **no breast ultrasound cine, ABUS or multi-frame angiography reachable** — IDC has none, the other hosts are refused (Blocked) — [`lab/av1`](../../lab/av1/README.md) §SIZE, §DEPTH, [`FIXTURES.md`](../FIXTURES.md) §AV1 data, [`README.md`](README.md) §A1, §A3 |
| 22 | **EMBED** — embedded lossy-to-lossless intra codecs for contrast: JPEG 2000 quality layers, progressive lossless JPEG XL | done `9862837` — **an embedded preview is free in bytes and dear in decode**: JPEG 2000 Part 1 with three quality layers (OpenJPEG 2.5.4, 5/3, LRCP) costs 0.09–0.19 % over one layer and is 0.93–0.96 of HTJ2K's bytes whole; its first layer is 0.4–0.9 % of them at 37–43 dB on grey (25 dB RGB ultrasound) and decodes in 1.0–1.4× OpenJPH's exact time, but **the exact frame decodes 6–12× slower than OpenJPH** (210/210 paired rounds); about twice AV1's preview bytes for the same PSNR, though inside the exact frame; progressive lossless JPEG XL (libjxl 0.12.0, `-p`) draws its first picture only after 6–48 % of the bytes (28–47 dB; libjxl pauses at no step in a lossless frame), first picture 1.3–2.9× and whole 4.0–6.2× OpenJPH, 0.91–0.95 of its bytes; all seven sets, headless Chromium 141, 15 interleaved rounds at 1× and 4×, 22 680/22 680 frames exact, 4 mutations caught — [`README.md`](README.md) §A5, [`lab/av1/bytes/embedded`](../../lab/av1/bytes/embedded/README.md), [`licensing.md`](licensing.md) *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 23 | **TOTAL** — total time on phone-like links, the measure that decided against AV1 before: HTJ2K against every AV1 form, per taxonomy series | done `bc35549`, `b5e10ab` — **top11+low wins where the wire is the clock, HTJ2K where a slow CPU meets a fast link**: 14 rounds, then 10 replicated in a second container, 121 222/121 222 frames exact; on the 12-bit series top11+low fills at 0.93–0.98 of HTJ2K's time at 1× on every link; at 4× on 50 Mbit dav1d-WASM intra takes 1.40–2.22× and WebCodecs 1.17–1.38×; the RGB ultrasound loses 10–19 % wherever the wire is the clock; HTJ2K has the first frame on every cell; the fluoroscopy's preview is playable in 0.34–0.45 s at 1× and 0.83–1.2 s at 4×, against 1.7–15 s for every exact frame; the decode-bound cells move 15–25 % between containers, so only the ranking is claimed — [`README.md`](README.md) §Total time *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 24 | **SVCDEC** — a scalable payload in the client: the base operating point first, the exact frame from the same bytes | done `0db594f` — **built: the base reaches the page as a preview, then the exact frame, from the same bytes, through dav1d-WASM**; the cause of row 18's failure was the wrapper keeping one picture a unit (dav1d at `all_layers` 1 outputs the base while the top is still queued), so it now drains the unit (`av1_next`, `av1_layer`, `av1_top_layer`; 623 146 B); a picture below operating point 0's top goes to `onPreview` as a frame marked `preview: true` at its own size, never to an ask or `onFrame`; one port, so a preview always lands before its frame and never after; 10-bit G = 1 (asked) and 12-bit G = 8 (20 filled), two spatial layers, half-size base at q 40: every exact frame its source's at 64×48, one preview a frame, 32×24, identical to native dav1d at operating point 1; a unit without its top shows its preview, still marked, and fails by name (`spatial layer 0 of 1 is the unit's last`); single-layer series send none; WebCodecs (≤ 10 bits) exact, no preview (row 31); a base fed alone at operating point 0 is a preview and then a failure, so §5's base entry needs the decoder told; dispatch 181 → 199/199, 8 mutations caught 8/8, gate green; not timed — [`adr-unit.md`](adr-unit.md) §6, [`client/README.md`](../../client/README.md) |
| 25 | **SVCSHAPE** — the scalable shape with the least overhead: layers, scale, base quality, per content | done `ba38035` — **a quarter-size base at q 40 has the least overhead on every series**: libaom 3.15.1 `svc_encoder_rtc` (SVCQ's patch), 20 shapes × 9 series of rows 2, 10, 21 (spatial ½ and ¼, a full-size lossy base, three layers, L1T2/L1T3, L2T3, base q 20/40/60, keyframe every 1, 8 or one), over 12 bits the two low bits apart; 180/180 codings exact, 387 frames each; quarter total 0.968–1.003 of single-layer lossless AV1, its exact frame 0.97–1.06× single's decode at 1× and 0.97–1.10× at 4× (dav1d-WASM, Chromium 141, n = 10 interleaved, 8 640/8 640 frames exact), base 0.01–0.36 % of HTJ2K's bytes at 30 dB (ultrasound) and 34–47 dB (grey), so a series' bases are playable in 0.01–0.11 s at 1× and 0.06–0.5 s at 4× on 5, 20 and 50 Mbit/s alike (arithmetic, decode-bound) against 16–60 s for the exact series at 5 Mbit/s; a full-size q 20 base is 1–5 % smaller on CT, MR, fluoroscopy and ultrasound but decodes 5–32 % slower; a third layer, temporal layers (−3 to +4 %, an exact base at 16–44 % of HTJ2K), L2T3 (+3–6 %) and shorter keyframe intervals buy nothing; every shape keeps lossless AV1's size, 0.94–1.59 of HTJ2K's; 7 mutations caught — [`lab/av1/delivery/scalable/shape`](../../lab/av1/delivery/scalable/shape/README.md), [`README.md`](README.md) §A5 *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 26 | **SVCORDER** — delivering bases first: what the store and the group-as-item model need (a proposal) | done `089f322` — **proposed: each frame as two entries, layer-major — the base alone (entry i), then the whole temporal unit (entry F + i)** — so a fill over the bundle is every base and then every exact frame, with the wire, the store's format, the planner and the server unchanged and an ask for exact N one entry and one decode at G = 1; costs the base's bytes twice (0.07–2.4 % of HTJ2K's at a half-size base, q 40, row 18) and a second decode of each base (2–13 % of a lossless frame's); a top-only entry (no duplicate) breaks the exact frame's independence, a per-layer byte range changes the wire and the server; WebCodecs picks the layer by what it is fed; 5 invariants named broken; the arm: single-layer AV1 against bases-first on row 11's harness after rows 24–25; nothing measured — [`adr-unit.md`](adr-unit.md) §5 |
| 27 | **DECSPEED** — the decode is what loses on a phone: encoder settings and decoder threads that cut it, lossless kept | done `1c9794f` (`163460f`, `618e6e0`, `f6c205e`) — **tiles and threads cut a frame's decode, not a fill's**: a lossless frame is 66–84 % entropy decoding; no encoder setting cuts it more than 10 % (presets, 64² superblocks, intra tools off, at +6–72 % bytes); dav1d-WASM threads do nothing untiled, and with 4 tile columns (+0.1–0.4 % bytes) × 3 threads a frame takes 0.37–0.44 of its time (fluoroscopy 29 against 76 ms at 1×, 116 against 314 at 4×), still 2.6–2.9× HTJ2K; through the fill at 50 Mbit, 4× as three slowed cores, 12 rounds, 24 528/24 528 frames exact, every threads × decoders arm is within −3 to +4 % of today's three decoders (+11–15 % oversubscribed on MR): best, 1 decoder × 3 threads on 4-tile frames, 1.81–2.39× HTJ2K's fill at 4× against today's 1.82–2.32× — [`README.md`](README.md) §A1, [`lab/av1/decode/settings`](../../lab/av1/decode/settings/README.md) |
| 28 | **LLSIZE** — closing lossless AV1's byte gap to HTJ2K with AV1 alone | done `db802d9` — **AV1 alone is under HTJ2K on every series at G = 1, 0.902–0.987, once its samples are represented for it**: libaom 3.15.1 cpu0 intra, first 2–8 frames of all nine series, every coding exact; the two low bits apart on grey at every depth over 8 (fluoroscopy 1.027 → 0.942, 12-bit tomosynthesis 1.040 → 0.941, MR 1.013 → 0.977, 10-bit tomosynthesis 0.977 → 0.942) and JPEG 2000's reversible colour transform on RGB (ultrasound 1.117 → 0.962), plus `--tune-content=screen --sb-size=64` for 0–1 %; CT 0.902, cone-beam 0.987, projections 0.953 and 0.923; libaom's other controls (superblock size, all-intra, palette/intra block copy alone) 0–1 %, every optional intra tool off +6–64 %, SVT-AV1 0.98–1.08 and never smaller, YCoCg-R 1.2 % behind the RCT, one or three low bits worse than two; no libaom release after 3.15.1; decode (dav1d-WASM, Node, n = 15 interleaved) the colour transform 0.89–0.95× row SIZE's coding, the split +1–5 % on large frames and +16–23 % on 512² MR and 10-bit tomosynthesis; **inter pays on the colour-transformed ultrasound: one keyframe in 8, 0.850 of HTJ2K** (GBR inter 1.355), decoding 0.81–0.83× GBR intra; on grey inter is level or worse; 7 mutations caught — [`lab/av1/bytes/represented`](../../lab/av1/bytes/represented/README.md), [`README.md`](README.md) §A1 *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 29 | **SWEEP** — AV1-only options nobody has listed yet: a read-only identification sweep | done `8f257a2` — **three options worth a row, four not, phones blocked**, read from primary sources (AV1 spec `5e04f3f`, dav1d 1.5.4, libaom 3.15.1, Chromium `d84e3b8`, WebKit `10740b3`, Android framework `1cdfff5`, AVM `v1.0.0`), nothing run: WebCodecs' `optimizeForLatency` is dav1d's `max_frame_delay = 1` in Chromium — the cause of WCAP's two frames held until `flush()` and of the flush per unit that keeps WebCodecs at G = 1 (row 30); the base layer through WebCodecs by dropping OBUs with `spatial_id` > 0, since Chromium's dav1d at `all_layers = 0` outputs the highest layer it holds (row 31); AV2's AVM v1.0.0 (2026-05-27) has lossless, monochrome and 10/12 bits, its lossless gain claimed, unconfirmed (row 32); S-frames cannot switch exactly (other references), super-resolution breaks `AllLossless` (libaom disables it under `--lossless`), large-scale tile is camera-array only and dav1d lacks it, reference scaling is already the spatial layers; Android names AV1 Main 8/10 only and guarantees level 4.1 (2 359 296 samples, under the 4.9 and 2.6 M-sample projections), WebKit's in-process WebCodecs AV1 takes 8-bit 4:2:0 only (Blocked) — [`README.md`](README.md) §Options to try |
| 30 | **WCLAT** — WebCodecs with `optimizeForLatency`: a frame out per unit without a flush, groups through WebCodecs, and tiles | done `e41701b` (`b12ae2d`, `1c99323`, `841da6d`) — **yes: with `optimizeForLatency` every unit gives its frame without a flush, exact, and a group now goes through WebCodecs**: headless Chromium 141, libaom 3.15.1, 28 streams (8/10-bit 4:0:0, 4:2:0, 4:2:2, 4:4:4 identity, intra and G = 8; fluoroscopy top10 and ultrasound at 1/2/4 tile columns), 784/784 frames out per unit and exact, 0/784 with neither option; skipping the flush 7–20 % faster a frame at 1×, 3–28 % at 4× (10 interleaved rounds), but a keyframe needs one (else a non-keyframe labelled key decodes against the last frame), and flushing before each costs as much — so `av1-webcodecs.js` flushes at a group's end (G = 1 unchanged) and before a keyframe only while a cut group is held, a stalled unit after 2 s; 4 tile columns 33 → 15 ms (1×), 118–135 → 66–70 ms (4×) at −0.6 to +0.4 % bytes; dispatch 209 → 219/219, each guard mutated to fail — [`decode/README.md`](../decode/README.md) §WebCodecs without a flush, [`lab/av1/decode/latency`](../../lab/av1/decode/latency/README.md) |
| 31 | **WCBASE** — the base operating point of a scalable payload through WebCodecs, by dropping the top's OBUs | done `5c193e6` (`7718c88`) — **exact, and faster than dav1d-WASM's preview except on small grey bases at 1×**: row SVCQ's two-layer payloads (q 40 base, half and full size, one keyframe and G = 1) on the ultrasound, the fluoroscopy and MR as their top 10 bits and synthetic grey 10 / RGB 8; the unit with the OBUs of `spatial_id` > 0 dropped — its prefix, byte for byte the encoder's base-only stream, 762/762 — gives through WebCodecs the base identical to native dav1d's at operating point 1, 534/534, and the whole unit the exact frame, 534/534; 12 bits refused (row 3); a flush per unit needs G = 1 (a key chunk after every flush: −1 to +1 % bytes on grey, +7–13 % on the ultrasound), past G = 1 `optimizeForLatency` gives each base from its own unit, 0/178 late; unit to picture in the contract, headless Chromium 141, 15 interleaved rounds: 0.65–0.66× dav1d-WASM's preview on the ultrasound at 1× (5.5 against 8.4 ms), 0.36–0.76× on every series at 4× (faster in 87/90 paired rounds; 12.6 against 36.5 ms), 1.10–1.31× on the 2–4 ms grey bases at 1×; the base 7–36 % of WebCodecs' exact frame; 19 440/19 440 timed pictures matched; 3 mutations caught (top OBUs kept, base OBUs dropped, a sample flipped); the scalable encoder's lab patch gains `--rgb` (sRGB tags, identity matrix), which WebCodecs needs; not built into the product — [`README.md`](README.md) §A5, [`lab/av1/delivery/scalable/webcodecs-base`](../../lab/av1/delivery/scalable/webcodecs-base/README.md) *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 32 | **AV2** — AVM v1.0.0 lossless: bytes and decode against libaom 3.15.1 and HTJ2K | done `c7ffb30` — **AV2 is the smallest lossless coding on grey up to 13 bits but CT, at 50–110× libaom's encode time**: AVM v1.0.0 has no profile over 10 bits, so 11–14-bit samples are coded split (v ≫ k at 10 bits + the k low bits); one middle frame a series, 68/68 cells exact through `avmdec`; at `cpu-used` 0 it is 0.937–0.964 of HTJ2K on fluoroscopy, MR, cone-beam and both tomosynthesis volumes, 0.4–4.7 % under libaom on the same planes; libaom's 12-bit split stays 3–8 % smaller on CT and the 14-bit projections; the RGB ultrasound is 1.648 against libaom's 1.117; four tomosynthesis slices as one group 0.922 against libaom's 0.978; 450–11 900 s to encode a frame, native decode 3.1–6.5× dav1d's; no browser decoder exists — [`lab/av1`](../../lab/av1/README.md) §AV2 *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 33 | **REP14** — the layout of 13- and 14-bit samples: two low bits apart (12-bit top, dav1d only) against streams of ≤ 10 bits (WebCodecs), by total time | done `a07b1ab` (`858777a`, `dd41eea`) — **at 13 bits top10+low through WebCodecs, at 14 bits the two low bits apart where the wire is the clock and HTJ2K where it is not**: libaom 3.15.1 `--tune-content=screen --sb-size=64` cpu0, every frame of the two 14-bit projection series and the CT; bytes over HTJ2K d12 (v ≫ 2 at 12 bits + 2 low) 0.953/0.923/0.917, w10 (top 10 + 4 or 3 low) 0.999/1.046/0.931, the fastest preset within 2 % (`--allintra` 7/9, cpu6 on the CT) +0.0–1.3 %; decode in Chromium through `decoder.js` w10 by WebCodecs 0.37–0.51 of d12's, still 2.6–2.8× OpenJPH; total time, 12 rounds on row TOTAL's links, n = 10–12: CT w10 0.87–0.96 of HTJ2K on every cell (d12 1.52 at 4× on 50 Mbit), projections d12 0.93–0.99 at 1× and at 5 Mbit, 1.01–1.63 at 4× on 20 Mbit and faster, w10 0.98–1.13; 9 920 + 44 640 frames exact — [`README.md`](README.md) §A3 |
| 34 | **TOTAL2** — row 23 again with row 28's representations, and the colour-transformed ultrasound at G = 8 through WebCodecs | done `b1ef1f2` (`d649cb8`) — **through WebCodecs row LLSIZE's codings fill first on 22 of 24 cells, losing only at 4× on 50 Mbit**: fluoroscopy, both tomosynthesis volumes and the ultrasound, 5/20/50 Mbit at 1× and 4×, 932 of 1 022 visits kept, n = 10–15, 38 744/38 744 frames exact; the two low bits apart (top ≤ 10 bits, 0.942–0.944 of HTJ2K's bytes) through WebCodecs 0.94–0.97 of HTJ2K's fill time but 0.99–1.02 at 4× on 50 Mbit, through dav1d-WASM 1.43–1.62 there; the ultrasound, HTJ2K's on every cell in row 23, is AV1's with the colour transform (0.958 intra, 0.948 at G = 8 over all 70 frames, not row 28's 0.850 on 8), 0.95–0.97 but 1.06 (intra) and 1.16 (G = 8) at 4× on 50 Mbit; first frame through WebCodecs −38 to +88 ms of HTJ2K's; `rct` built into the client (dispatch 227/227, 3 mutations caught) — [`README.md`](README.md) §Total time, [`lab/av1/delivery/total-time`](../../lab/av1/delivery/total-time/README.md) *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 35 | **DATA2** — breast ultrasound cine and contrast angiography, if their hosts are now reachable: bytes, decode and total time | done `e8896ae` — **stopped at its first step: the hosts are still refused** — `zenodo.org` and `www.cancerimagingarchive.net` (and `services.cancerimagingarchive.net`, `figshare.com`, `data.mendeley.com`, `huggingface.co`, `physionet.org`, `www.kaggle.com`, `osf.io`) answer CONNECT 403 from the container's egress policy, 2026-10-04 20:43 UTC; nothing fetched or measured, no verdict on breast ultrasound cine or angiography — [`## Blocked`](#blocked) |
| 36 | **ENCX** — where lossless bytes and decode can still be cut: the low stream, the split per series, temporal noise, and whether HTJ2K gains from the same representations | done `e0ba8e1` (`67fba68`, `84a1e15`, `bf9d1df`, `c7f8b68`) — **HTJ2K gains 0.9–1.6 % from the same split, only with its low bits deflated, so row 28's gain is AV1's (0.916–0.997 of HTJ2K on the same split); the low bits deflated cost AV1's bytes ±0.5 points and decode 0.64–0.83× of row 28's coding**: all nine series, libaom 3.15.1 cpu0, 358/358 codings exact; three low bits beat two on the four series with noise σ ≥ 17 (0.5–3.9 %, cone-beam 0.987 → 0.948; row 28 tried three at libaom's defaults only, corrected in place), decoding 0.59–0.78×; the top through WebCodecs (≤ 10 bits, k = 3 brings CT and cone-beam there) with the low deflated 0.34–0.56× of row 28's decode, 2.1–3.4× HTJ2K's (headless Chromium 141, 1× and 4×, 10 interleaved rounds, 7 100/7 100 frames exact); k̂ = ⌊log2 σ⌋ wrong on four series, ⌊log2 σ⌋ − 1 right on all nine but fitted to them; inter finds nothing in the noise (low stream inter 0–3.6 % larger); libaom's tools: palette worth 4.5–9.2 % and already on, the rest ±1 %; total time arithmetic only (row 34); 9 byte and 4 browser mutations caught — [`lab/av1/bytes/low-stream`](../../lab/av1/bytes/low-stream/README.md), [`README.md`](README.md) §A1 |
| 37 | **XBROWSER** — the AV1 decode path (dav1d-WASM, the WebCodecs probe and its fallback) in WebKit and Firefox engines: exact, chosen right, how fast | done `da7c3b6` (`d43145e`, `4b4efcc`) — **dav1d-WASM and OpenJPH exact in Chromium 141, Firefox 157 and WebKitGTK 2.52; the client's WebCodecs choice exact in Chromium only**: first 4 frames of all nine series and an 8-bit grey set in every row-28 layout, stock engines (Playwright's builds refused), 6 interleaved rounds at 1× and 4×; dav1d-WASM 408/408 and HTJ2K 240/240 a cell in every engine, 4.1–9.6× OpenJPH at 1× and 3.9–10.0× at 4× (slower in 732/732 paired rounds), each engine 0.85–1.22× Chromium's time on the same arm; the SIMD build loads in all three, and OpenJPH needs SIMD as well; WebCodecs (chosen at `depth` ≤ 10) 240/240 in Chromium at 2.6–5.0× OpenJPH, **0/240 a cell in Firefox** (monochrome refused, 4:4:4 returned as 8-bit `BGRX`) **and WebKitGTK** (GStreamer's `av1dec` takes no AV1 here, 4:2:0 controls included), with no fallback to dav1d; WebKitGTK as shipped has no `SharedArrayBuffer`, so HTJ2K fails too (0/148); a decode probe with fallback proposed, not built; desktop engines in a container, not phones; 5 mutations caught — [`decode/README.md`](../decode/README.md) §AV1 in WebKit and Firefox, [`lab/av1/exact/engines`](../../lab/av1/exact/engines/README.md) |
| 38 | **FOOTPRINT** — the AV1 path's memory and first-use cost: dav1d-WASM heap per worker at the largest frames, and the first item's import and compile at 1× and 4× | done `0a73811` — **a dav1d-WASM worker costs 31.6 MB resident [31.2–32.2] on the 4.9 M-sample projections against HTJ2K's 24.6 (adopted wrapper; 26.1 the package), 7.6 against 7.1 on the RGB ultrasound; first use is HTJ2K's**: headless Chromium 141, product worker, renderer RSS slope over 1/2/4 workers, 6 rounds; its WebAssembly heap 19.7 MB after one projection, 34.8 by the series' end (16.4 ultrasound), flat over a second pass, never returned; WebCodecs 5–10 MB settled, peaks 32–58 MB a worker outside its heap; a fresh AV1 worker ready in 28–39 ms at 1×, 84–93 at 4× (HTJ2K 30–41, 96–115), first-frame surcharge 65–97 / 200–280 ms against 45–82 / 164–225, 12 rounds cold and cached, the cache 5–11 ms off init; 13 440/13 440 frames exact, 4 mutations caught — [`README.md`](README.md) §A2, [`lab/av1/decode/memory`](../../lab/av1/decode/memory/README.md) |
| 39 | **UNIFY** — one AV1 branch on the cleaned `main`: this branch's AV1 work merged onto it, and the item format of [`payload-format.md`](payload-format.md) (plain and optimized) built end to end | done `3233a06` (`824f634`, `c5e8b88`, `3188af0`) — **built on `claude/av1-unified`, cut from `origin/main`: the merge conflicted in 8 files (the downloader's `decoder.js`, `consumer.js`, `downloader.js` and README, the dispatch rig, the root README, and the two AV1 warm-up frames in a directory `main` renamed), each resolved on `main`'s code — the warm-up dropped with `main`'s, `connect`'s option pass-through and decoder-loss handling kept, the codec check, groups, preview port and decoder seam re-applied; the item format end to end: `ingest.py` writes nothing unless every item decodes back through native dav1d (3 mutations caught), `pack-study` bundles `NNN.av1`, the reader refuses 14 header and 6 decoded-stream cases by name, WebCodecs per item behind 16×16 per-layout probes with dav1d-WASM as fallback, a failed import retried, a late frame never taken; 14 golden items (7 shapes × plain, optimized) exact in Node and headless Chromium through both decoders; 96 real items (fluoroscopy, CT, MR, ultrasound, 8 frames, both representations) exact, optimized over plain 0.918/0.990/0.964/0.861, row 28's ratios; `av1.test.mjs` 60/60, dispatch 327/327, downloader 56/56, gate green; 18 product mutations caught** (RGB needs the sRGB tag for WebCodecs to report no matrix) — on `claude/av1-unified`: `ingest/coded-frames/README.md`, `payload-format.md` §Built *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 40 | **SVC** — scalable payloads end to end in the lab: bases first, then the exact frames (row 26's proposal), measured as time to first picture and to exact | done `5f41f5f` (`cfb26b4`, `078d1b3`) — **every frame is on screen as its base 10–101× sooner than HTJ2K's exact series at 1× (3–45× at 4×), and the exact fill costs 0–8 % over the same encoder's single layer**: row SVCORDER's layer-major layout built in the lab (entry i the base, F + i the whole unit; a lab decoder worker through the downloader's `decoderWorker` seam, downloader, server and store unchanged), row SVCSHAPE's quarter-size q 40 base, one keyframe, fluoroscopy and ultrasound, 5/20/50 Mbit at 1× and 4×, 13 interleaved rounds, n = 4–13; every frame shown in 0.13–0.15 / 0.33 s at 1× and 0.33–0.36 / 1.0–1.1 s at 4× against HTJ2K's 1.7–15.2 / 3.2–29.4 s; bases 0.06 / 0.35 % of HTJ2K's bytes again; the shape's one group on one decoder and lossless SVC's 1.07 / 1.59 × HTJ2K's bytes leave its exact series 1.07–7.4× HTJ2K's time (4.5× / 7.4× at 4× on 50 Mbit, intra AV1 1.8× / 2.3×); 27 456/27 456 frames exact, 6 864/6 864 bases as native dav1d at op 1, none late; 5 mutations caught — [`README.md`](README.md) §A5, [`lab/av1/delivery/bases-first`](../../lab/av1/delivery/bases-first/README.md) *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 41 | **FASTHTJ2K** — faster HTJ2K decode in the browser: where OpenJPH-WASM's time goes, what GPU decoders move to the GPU, whether WebGPU can, and the CPU levers not yet tried | done `1740238` — **the HT block decoder is the clock, and only threads inside a frame move it**: OpenJPH 0.31.0 profiled in headless Chromium 141 on 8 frames of seven real series at 1× and 4× (560/560 exact): HT block decode 55–70 % of a frame (cleanup passes only, already WASM SIMD), code-block to line 6–7 %, inverse wavelet 5–10 %, colour 2 % on RGB, wrapper pack 4–10 %, copy out 7–15 %; **a WebGPU wavelet bounded out** — ≤ 6–12 % to save against three times the bytes the copy out already moves (projections 2.8 ms saved, 29.5 MB to and from the GPU a frame); no WebGPU/WebGL JPEG 2000 decoder exists; WebGPU on Chrome Android 121+ and iOS 26; the container has no GPU (SwiftShader only); **code-blocks decoded in parallel (lab patch) 0.69–0.91 of a frame at 2 threads, 0.59–0.61 at 4 on the 1914×2572 projections only** (6 rounds interleaved, 1× and 4×, 2 688/2 688 exact, 2 mutations caught 56/56), an ask's lever, not a fill's; copy out and pack bounded at ≤ 15 %, OpenJPH 0.32.0 changes one mask in the WASM decoder — [`decode/README.md`](../decode/README.md) §Faster HTJ2K in the browser, [`lab/av1/decode/htj2k-profile`](../../lab/av1/decode/htj2k-profile/README.md) |
| 42 | **TOTAL3** — total time with row 36's encoding findings (low bits deflated, k per series, the top through WebCodecs) against HTJ2K and the plain AV1 control | done `f2b9c15` (`d6a3f78`, `1ab5ee5`) — **row ENCX's changes buy 3 % where a slow CPU meets a fast link and ±0.6 % elsewhere**: fluoroscopy, both tomosynthesis volumes and the ultrasound, 5/20/50 Mbit at 1× and 4×, 13 rounds, 1 026 of 1 170 visits kept, n = 5–13, 38 532/38 532 frames exact; x36 (low bits raw-deflated, k = 3 where σ ≥ 17, top through WebCodecs, a lab worker) over the adopted representation 0.969–0.972 at 4× on 50 Mbit, 0.990–0.997 elsewhere on the k = 3 series (bytes −0.2 to −0.5 %), 1.003–1.006 on the 10-bit volume (deflate alone, +0.4 % bytes); over HTJ2K x36 0.94–0.97, and 0.98–1.00 at 4× on 50 Mbit where the adopted one is 1.00–1.02; the plain control 1.03–1.13 of HTJ2K where the wire is the clock and 1.27–1.65 at 4× on 50 Mbit (the 10-bit volume 0.98–1.01, 1.19) — [`README.md`](README.md) §Total time *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 43 | **SPLITOK** — the bit split exact at every depth 8–16 and every layout k a rule could pick, unsigned and signed, through every decoder and engine, before any per-depth rule is adopted: correctness only, nothing timed | done `e8fbe5a` on `claude/av1-unified` (`b7d055d`, `6c3fc26`, `7f8bbfe`, `9a5a95f`) — **exact at every b = 8–16 and every k = max(0, b − 12) … max(b − 8, 4), unsigned and signed, through every decoder in every engine; nothing refused**: the item format widened (bits ≤ 16, split ≤ 8, depth the smallest container of the top) and the reader's signed mask corrected (the old one reports a wrong range at 9 of 162 widened cells); every value split and merged back in writer (142/142, 20 tops over 12 bits refused by name) and reader (162/162); synthetic 8 280 frames (1 260 cells, 1-pixel to 256², cpu0 and allintra 7) and 540 of 1914×2572 and 4096×5120 (180 cells), and all nine real series at every k, cpu0 and shipped preset (82 cells, 3 310 frames), each exact natively, in Node and in Chromium, Firefox 157 and WebKitGTK 2.52 with every stream as planned and the decoder as expected (Chromium WebCodecs wherever every stream ≤ 10 bits: 6 256 + 408 + 2 254 frames); 90 golden matrix items exact in Node and Chromium; 20/20 mutations caught — `lab/av1/exact/split` §Checked, `payload-format.md` §Built, README §A3 |
| 44 | **SPLITTIME** — the per-depth layout rule by bytes, decode and total time: HTJ2K against d12, k = 2, k = 3 and w10 at 13–16 bits, the 9–12-bit series as controls | done `f50ac3d` on `claude/av1-unified` (`19ade60`, `c65b961`, `1884814`, `2a123bf`, `302ceb2`, `a2cc8c7`) — **k = 0 at 9 bits, 2 at 10–12 and 14, 3 at 13, HTJ2K at 15–16**: eleven real series of 9–16 bits at every arm k, cpu0 items, every frame exact (decode 59 280/59 280, fill 246 760/246 760); decode a frame through `decoder.js`, 12 rounds at 1× and 4×: WebCodecs' arm fastest on every series, 1.59–4.12× HTJ2K, dav1d-WASM's 12-bit top 5.6–11.6×; total time, round-paired over HTJ2K, 13–16 bits on five links (12 rounds, n = 10–12 but one cell 9), 9–12 bits on the fixed links (10 rounds, n = 8–10): 9 bits k = 0 0.93–1.01 (k = 2 1.03–1.07), 10 bits k = 2 0.95–0.99, 11 bits k = 1–3 tie 0.99–1.02, 12 bits k = 3 or 2 within 0.02 (0.94–1.02), 13 bits k = 3 = w10 0.91–0.98 on every cell (k = 2 1.66–1.68 at 4× on 50 Mbit), 14 bits k = 2 or 3 0.92–0.99 where the wire is the clock and HTJ2K where a slow CPU meets ≥ 20 Mbit (1.02–1.69), 15–16 bits every AV1 arm 1.02–3.11; the port reproduces row 33's cells (CT w10 at 50 Mbit 4× 0.95 against 0.94); mutations 2/2 caught in each harness; bytes per arm at the shipped preset from `302722d`; gate: the link check fails on this queue's row 69 brief (`docs/av1/MERGE.md` not yet written), not this row's — `lab/av1/delivery/split-rule/README.md`, README §A3 and §Total time, `payload-format.md` §Proposed: the split per depth *Corrected at scale (row DBTSCALE): bytes hold (k = 2 smallest on 15/15 whole DBT volumes at the shipped preset), but at 4× on 50 Mbit/s the DBT arms lose 25–39 % to HTJ2K, not 0.97–0.99.* |
| 45 | **DATA3** — the taxonomy's missing content and depths: breast ultrasound cine, ABUS, angiography, FFDM and synthesized 2D, real 9-, 15- and 16-bit and more signed series; exact and bytes per layout, or the hosts to allow | done `09381e3` on `claude/av1-unified` (data `1e10f8f`, `5d548a7` here) — **every frame of the nine series exact at every k of its depth, natively (45/45 cells, 2 825 frames), in Node (2 825/2 825) and in Chromium, Firefox and WebKitGTK at k = 2, 3, b − 10 (1 358/1 358 each, decoders as expected); no one k wins**: best arm over HTJ2K at cpu0 — MR 9-bit 0.910 (k = 0), synthesized 2D 0.938/0.951, FFDM 0.986/0.989 (one vendor's a stretched range, plain 1.29), signed CTs 0.899/0.939, PET 15-bit 0.996 and film 16-bit 1.001 (w10); plain and optimized refuse 15–16 bits and k = 3 the film, by name; breast US cine and ABUS per row 46 — `lab/av1/bytes/breast/README.md` §Row DATA3's series, README §A3, `FIXTURES.md` §AV1 data |
| 46 | **BREAST** — the breast family's missing content (breast ultrasound cine and stills, ABUS, more DBT, FFDM and synthesized 2D), measured as the targets: exact per decoder path, bytes per layout against HTJ2K, intra against inter at G = 8 and 16 in real slice and frame order | done `3d5efa8` on `claude/av1-unified` (`df98f9b`, `d5cc1ae`; data `7d1552f` here) — **ten breast series added, all CC BY; inter does not pay on DBT and pays on the grey cine only because that clip is a lossy recording**: three more DBT systems' volumes/projections, two FFDM, two synthesized 2D (IDC), breast US cine grey and RGB and stills (Zenodo), 297/297 frames identical to an independent read; nothing presented or reconstructed exceeds 12 bits (projections 14, a film 16); every item exact natively, in Node (64/64 cells, 405/405 frames) and Chromium (WebCodecs 289, dav1d-WASM 116, each as expected); optimized item 0.873–0.962 of HTJ2K on 8 of 10 at cpu0 (stretched-range FFDM 1.006, stills 1.002); inter G = 8/16 on four DBT slice series 0.963–1.054 of intra at cpu0, 0.998–1.050 at good 6, RGB cine 0.98–1.00, grey cine 0.53–0.56 (0.47 of HTJ2K, decode 0.56×); 42/42 inter cells and 4/4 mutations; ABUS has no open licence, no third DBT vendor is open (§Blocked); gate not run (no `wasm-pack` here; no client or server code changed) — `lab/av1/bytes/breast/README.md`, README §A1 §A3, `FIXTURES.md` §AV1 data *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* *Intra confirmed at scale (row DBTSCALE): k = 2 0.939–0.956 of HTJ2K on 13 of 15 whole volumes, 0.760–0.797 on two.* |
| 47 | **MIXDEC** — each stream of a split item through its own decoder: a top over 10 bits through dav1d-WASM, the 8-bit low through WebCodecs, against both through dav1d and against w10 | done `1d14b07` on `claude/av1-unified` (`5ae7778`, `59c9d3e`, `1f8facb`, `ec767e1`, `e46a962`) — **the low stream is 17–38 % of a 13-bit frame's dav1d-WASM decode and 34–54 % of a 14-bit one's, and mixed takes all of it off, but w10 stays faster**: built behind decoder config `mixed` (off by default; the low to WebCodecs before the top's dav1d-WASM decode, dav1d-WASM wherever the `g8` probe fails); exact on every frame of the six 13- and 14-bit series at every k (1 113/1 113 an engine) and row 43's synthetic set (8 280/8 280 an engine) in Chromium 141, Firefox 157 and WebKitGTK 2.52, each stream from the decoder expected (Chromium mixed, the other two dav1d-WASM); 11/11 mutations caught; decode (n = 10 interleaved, 1× and 4×) 0.46–0.87 of today's, faster 120/120, 1.04–2.16× w10's; fill at 4× on 50 Mbit (n = 10–12, 35 616/35 616 exact) 0.77–0.90 of today's (131/131), 0.91–1.14 of w10's (ahead on the 14-bit projections, where w10's bytes are 1.007–1.059 of HTJ2K's), 0.93–1.18 of HTJ2K's (winning on two CTs, where today loses 18–23 %); 20 Mbit not claimed (88 of 144 visits `VOID`); whether the flag becomes the client's choice is the owner's — `lab/av1/decode/mixed`, README §A3, `decode/README.md` §AV1 |
| 48 | **SPLITLIT** — is splitting samples into top and low streams a recognised, recommended way to code high-bit-depth images losslessly with codecs limited to ≤ 12 bits, and what are the alternatives? | done `0655a4a` — **known, not recommended: the split is published (2011–2024: aerospace video, infrared, depth, CT) and patented (2006 priority on), and no standard or DICOM text recommends it**; the low part is noise in every source (CT's low byte 5.0–6.8 of 8 bits); the noise-floor rules (log2 σ + 1.79, Rice k ≈ log2 σ − 0.3) put k at 4–6 on the four σ ≥ 17 series, where row 36's oracle searched only k ≤ 3 and hit 3 on all four; histogram packing is the offset's published alternative (−42 % CT, −51 % MR bits a pixel on sparse histograms, JPEG-LS); over 12 bits no browser path is exact but WASM (HTJ2K, JPEG-LS, JPEG XL) — [`split-prior-art.md`](split-prior-art.md) |
| 49 | **DECODE** — the HTJ2K and AV1 decoder workers rethought: zero-copy hand-off, fewer allocations, one decode interface for both codecs | done `ed276d2` on `claude/av1-unified` (`ddc3bee`, `8dea929`, `0092b8a`, `dfac775`, `34f00f0`) — **one codec-module interface, and HTJ2K 12–21 % off a grey frame; no zero-copy hand-off, and AV1's one allocation saved costs more memory than it pays**: `decoder.js` loads `htj2k.js` or `av1.js` behind one `init`/`decodeFrame` and has no codec in it; the HTJ2K range pass in two loops (V8 does not hoist the per-sample branch) took decode through the product's worker ×0.79–0.88 on every 10–14-bit grey series at 1× and 4× (7/8–8/8 rounds; mammogram 91.5 → 75.7 ms, 389 → 313 at 4×), the RGB control a tie; headless Chromium 141, the first 4 frames of 7 breast series and the fluoroscopy, 8 rounds interleaved, 1 024/1 024 frames exact a throttle; WebCodecs copying into a reused buffer measured ×0.91–0.96 and **reverted**: it held 37 MB a worker on a mammogram (settled RSS slope 7.3 → 44.4 MB) for a gain the fill hides; the fill (row 23's harness, 20/50 Mbit, 1×/4×, 6 rounds, 20 544/20 544 exact) moves 0.5 % pooled, 1.5–3 % on the 2560×3328 frames at 4×; HTJ2K's memory unchanged; a hand-off with no copy needs the frame's storage in the decoder's heap and a release from the page — a contract change, proposed only if a phone shows the copy is the clock; 5 mutations caught — [`decode/README.md`](../decode/README.md) §The decoder worker's hand-off, `lab/av1/decode/worker` |
| 50 | **CLIENT** — the downloader, worker and consumer state machines: the two re-dial defects fixed, the untested decisions tested, the states simplified | done `878701b` on `claude/av1-unified` (`f2cd822`, `1aef11d`, `f136363`) — **both re-dial defects fixed and every decision held by a test; four dead checks removed, the fill's time unchanged**: (1) a cancel during a resume could not take back the run its dial's URL carried — `connect()` now ends that stream; (2) `close()` during a re-dial let `resume()` adopt the new session — a dial opening after close is closed; each a clause that failed before. A sweep of 76 mutants over `downloader.js` and `consumer.js` left 32 alive: the 21 untested decisions (least-busy dispatch, a fill skipping recorded frames, a lost decoder before the dial, recycling at ¾ of the budget and its owed asks, an ask alone on a closed or silent session, a resume with nothing owed, spent re-dials naming asks and being given back, `undefined` options, a refused first dial, a command during a resume, a cancel releasing a group's decoder, failures of a cancelled request from a dial or a decoder, a duplicate ask, `resumedAt`/`recycledAt`, `groupLength` and isolation refusals) each now killed by its test (17 dispatch clauses, `consumer.test.mjs`), 4 dead (promote's guard and pump, the record's generation, `lastChunkMs`'s fallback) removed, 7 left with reasons; `epoch`/`generation`, `resuming`/`dialling` and the three record states kept, each read; dispatch 695 → 719/719; fill after/before 0.99–1.00 in all 8 cells (fluoroscopy and 10-bit DBT, 20/50 Mbit, 1×/4×, 10 rounds interleaved, 3 360/3 360 frames exact); the gate's link check is red on that branch from row 61's `delivery-prior-art.md` (4 links), not this row — [`ARCHITECTURE.md`](../ARCHITECTURE.md) §The downloader, `client/README.md` |
| 51 | **SERVER** — the send path rethought: the per-send copy, mmap against pread, what each layer does that it need not | done `58e3b06` on `claude/av1-unified` (`16458c6`, `bbde485`) — **nothing adopted: the send path has no per-frame cost left that large frames expose, and the memory they leave is the allocator's**: loopback, 2 server cores, n = 6 interleaved, no PMU (rusage); CPU per byte flat 250 kB → 16 MB (1.5–1.7 µs/kB at 16 sessions, 2.3–2.6 at one); after 16 sessions of 16 MB frames ~800 MB stays resident; a 16 MiB byte-capped pool cut it 32 % (6/6) for +8.4 % CPU (0/6 lower), `MALLOC_MMAP_THRESHOLD_` 1 MiB cut it 46–57 % (6/6) at a CPU tie to +5 % (2/6) — the owner's deployment call; 50 Mbit fill time not run, nothing changed; `docs/adr/disk-access.md` §11 *Frames past 250 kB* |
| 52 | **INGEST** — the HTJ2K and AV1 ingest tools as one pipeline: fewer passes, the round-trip check's cost, parallel encode, bytes identical | done `16c88a7` on `claude/av1-unified` (`c566011`, `2d77d7d`, `c70f858`, `9a19199`) — **one ingest for both codecs, every byte as before, HTJ2K's cheaper and AV1's a tie**: `ingest.py --codec htj2k` beside AV1, the check in-process (dav1d, OpenJPH); 69/69 cells byte-identical (23 sets × HTJ2K, AV1 plain, optimized, 2 088 files a side); the check 0.63–0.84 of the subprocess's time a frame on AV1, 0.37–0.46 on HTJ2K (n = 3, disjoint); a study's HTJ2K CPU −21 to −27 % and now parallel, AV1 within ±4 % (the encode is ~99 %), four workers 3.5–3.9×; 3 mutations caught; AV1 bytes depend on `--jobs` in both revisions (§Blocked); `ingest/coded-frames/README.md` §One pipeline |
| 53 | **SEAM** — the seams between transport, downloader, decoders and page: duplicated logic, dead paths, codec dispatch | done `56e5144` on `claude/av1-unified` (`8f82c1f`) — **two duplicates merged, no dead path found, the fill's time unchanged**: traced transport → `downloader.js` → `decoder.js` → `htj2k.js`/`av1.js` → `consumer.js`; the Emscripten glue loading (written out in `htj2k.js` and `av1-dav1d.js`) is `wasm-glue.js`, the unit-continuity refusal (written out in both AV1 decoder modules) is `continues()` in `av1-payload.js` — one place each, not fewer lines (+26, −16); its mutant fails 3 dispatch checks; the codec is decided once (`consumer.js` refuses, `decoder.js` routes, `av1.js` picks the AV1 decoder); kept with reasons: owed frames held by both transport and records (one owner is a transport API change, structural), `groupLength` beside `decoder` in `init` (four lab workers speak it), groups, the preview port, `mixed`, `recycleAtBytes`, `openAsk: false`, `decode: false` (built, each reached by a clause); dispatch 719/719, conformance 56/56; fill after/before 1.00 in all 8 cells (fluoroscopy and 10-bit DBT, 20/50 Mbit, 1×/4×, 10 rounds interleaved, 3 360/3 360 exact) — [`ARCHITECTURE.md`](../ARCHITECTURE.md) §The seams, traced |
| 54 | **GATE** — the gate's run time, redundant tests and the gaps mutation finds | done `f9022a0` on `claude/av1-unified` (`8ad0684`, `2533134`, `91ef6ea`) — **the gate 161 → 106 s, and 140 of 151 viable mutants killed against 108 before**: n = 3 interleaved a cell, `--quick` 161.4 [159.8–161.7] → 105.9 [104.9–106.1] s, full 160.7 → 107.0; two timer-bound steps now wait side by side — transport conformance one process an implementation (54.4 → 18.2 s, one clause trickles 16 s on each), the two browser rigs in parallel pages (57.0 → 38.3 s), every check as before, each runner mutated (a failing implementation, a child with no result, a failing rig) and caught; 156 hand-made mutants at each decision: client 44 → 65 of 72 (row 50), decoder modules 45/45, send path 16 → 20 of 24, study bundle 3 → 10/10 — 13 new tests (planner's asks held and look-ahead past an end_stream, per-frame stream rank, a byte budget's cut, the bundle's short file, magic, version, metadata bound, one-byte overrun, a mis-sized frame, a short finish), 5 dead branches removed, 11 left alive with reasons (log lines, timers only a frozen page shows, lab-only stall bytes); no test cut (overlaps are checks within one clause, or too few mutants); the dispatch rig skips its 591 AV1 checks without dav1d-WASM built, now said; the branch's 4 broken ADR links fixed (`91ef6ea`) — [`README.md`](../../README.md) §What the gate costs and what it catches |
| 55 | **NAMING** — every name audited against the round's principles; the clear renames applied with every reference | done `cb7e312` on `claude/av1-unified` (`e7effcd`, `dba25fb`) — **five things under three *lever* numbers renamed, the conformance suite's *arms* are clients and rigs, five renames proposed**: ARCHITECTURE's *Lever 1–3* and transport-conclusions' *Lever 1–2* are now the opening ask, early SETTINGS, hints in the session URL, the bytes pushed at session open and a 32-packet initial window, *S4* the container campaign — 21 files, every reference, 0 left by grep; `run.ts` `CLIENTS`, the wire pages' `?client=`, `consumer.js` `#arm` → `#waitFor`; gate green, links 0 unresolved; proposed, not applied: *item* → **coded frame** (DICOM's Item; the item format is structural), telemetry rows' `arm` → `client` (a row schema), the lab's *arm* → **variant** (≈1 900 lines; `CLAUDE.md`'s word), queue-row folder names (row 56 moves folders), campaign labels; principles and a 15-term glossary — [`README.md`](../../README.md) §Names; `CLAUDE.md` wording at the end of the brief |
| 56 | **LAYOUT** — folders by responsibility, each doc where the repository's rules place it | done `7b97026` (the queue's paths `8bee3a3`, merged `2a53f04`) — **lab/av1 by subject in five groups, the product's three dependencies out of lab/, behaviour unchanged**: 274 files moved, 1 148 → 1 149 (the ingest's README split: product beside the code, measurements in the lab), 880 byte-identical, 232 differing only in paths, 36 with checked edits; dav1d-WASM build → `client/decode/wasm/dav1d/`, OpenJPH fetch → `client/decode/wasm/fetch_openjph.sh` (its `vendor/` beside it), ingest → `ingest/coded-frames/` (its bench → `lab/av1/exact/coded-frame/`); `size.py`, `depth.py`, `roundtrip.py` stay at the top, imported across groups; the golden coded frames regenerated through the moved ingest byte-identical (a mutant changes 99), dav1d-WASM rebuilt from its new place at 623 146 B as before, the tools from theirs; gate green with no step skipped (dispatch 750/750 with every AV1 check, 0 links unresolved) — [`lab/av1/README.md`](../../lab/av1/README.md) §The folders |
| 57 | **VERSIONS** — newer libaom, SVT-AV1, dav1d, OpenJPH 0.32.0, Emscripten SIMD and threads, Chromium's WebCodecs: what each gains or breaks, the promising ones measured | done `56398cf` on `claude/av1-unified` (`2d6af24`, `6e354b0`, `293b4f0`, `b72ff30`, `5276b91`, `9073bdc`; `a6f960c` before) — **nothing adopted, no pin changed: no libaom, SVT-AV1 or dav1d release followed the pins, libaom's head writes the same bytes, and no decode lever clears the harness's spread**: libaom head `4cea455c` byte-identical to 3.15.1 on 11 series × cpu0 and shipped (80/80 items, all exact; 3.8.2 differs, the lever checked); dav1d head `7f12cf23` and emscripten 6.0.11 tie on dav1d-WASM (pooled 0.98–1.01); OpenJPH under emscripten 6.0.11 0.94–0.96 of 3.1.74 pooled, inside a 2–7 % spread at 6 rounds — the one lever worth a longer run; OpenJPH 0.32.0's WASM mask fix (24-bit code-blocks) unreachable at ≤ 16 bits, deep-bit-plane frames 12/12 exact, mutation 12/12 caught; 0.32.0's codestreams identical to 0.31.0's but the COM version (38/38); Chromium 154 ties on dav1d-WASM, item path 1.06 pooled, and still refuses 12-bit WebCodecs — libgav1's key-frame parse is built for 10 bits (141, 154, 155); headless Chromium 141 and 154, 1× and 4×, 6 interleaved rounds, 8 640/8 640 frames exact; gate green — `lab/av1/tools/newer/README.md`, README §Measured here, `decode/README.md` §WebCodecs |
| 58 | **LITERATURE** — lossless medical image coding 2023–2026, and what of it runs in a browser today: research, rows proposed | done `5385a07` — **JPEG XL lossless is still the codec to beat; nothing published since 2023 that beats it runs exact in a browser but one unreviewed codec**: standard codecs on 16-bit CT/MR put JPEG XL at 0.85–0.95 of JPEG-LS and 0.82–0.91 of JPEG 2000 (BD-LVIC, TIP 2024), 0.78–0.95 of HTJ2K on four 16-bit CT and mammography frames (an industry white paper, 2024); learned and context-tree coders gain 3–20 % under JPEG XL on CT/MR volumes, but only integer or table-driven ones can be exact in a browser (WGSL float is not bit-reproducible): TCT (TIP 2026, 0.88–0.97 of JPEG XL, 0.05 s a slice on CPU, no code) and Tomoz (Apache-2.0, WASM, self-reported 0.73–0.85 of HTJ2K, unreviewed); no paper measures modern lossless codecs on breast imaging — rows 45–46 hold more; three measurements proposed (JPEG-LS in WASM, Tomoz, TCT when released); [`lossless-literature.md`](lossless-literature.md) |
| 59 | **RESLEVEL** — HTJ2K decoded at the resolution level a phone screen needs, exact, then full resolution on zoom | done `dece2e4` on `claude/av1-unified` (`a7b017a`, `b305d44`, `91300de`) — **a level picture first: the first view on screen at ×0.09–0.69 of today's fill, a four-view study at ×0.06–0.50, every whole frame at a tie (×0.98–1.04); exact only once clamped**: the breast series at the level whose long side holds 1 000 px (level 1, level 2 on 3328×4096), today's RPCL codestreams cut at the smallest exact prefix — 25.8–29.0 % of a frame at level 1, 7.0–7.5 % at level 2; the package's `decodeSubResolution` leaves the 5/3 low band unclamped above 2^B − 1 (15 of 35 frames, up to 1 439 on 10 bits), clamped it matches OpenJPEG 2.5.4 `-r` and a 5/3 analysis of the source on 35/35; decode at the level ×0.27–0.31 of the whole (×0.08 at level 2), Chromium 141, n = 10, 2 100/2 100 exact; on row 23's five links at 1× and 4×, 13 rounds, paired n = 5–13 (under 10 in 9 of 50 cells), 5 200/5 200 frames and 2 600/2 600 level pictures exact, sooner in every paired round — 3328×4096 at 5 Mbit on screen in 2.6 s, not 31.6; §6's 2× rule holds at 5 and 20 Mbit on every series, at 50 Mbit on the mammograms only; prefix ask, level offsets in the store, the clamp and a smaller picture in the render path proposed, not built; 4 mutations caught — [`decode/README.md`](../decode/README.md) §A frame at the level the screen needs, [`adr/resolution-fitting-for-large-frames.md`](../adr/resolution-fitting-for-large-frames.md) §7, `lab/av1/decode/resolution-level` |
| 60 | **LOSSLINK** — fill and on-demand time over links with 1–5 % packet loss and jitter, HTJ2K against AV1 | done `1e81fe4` on `claude/av1-unified` (`20aa92d`) — **under loss the controller is the clock and AV1 is its bytes**: the 10-bit volume, 4 frames filled then 4 asked one at a time, 5/20/50 Mbit and `lte-good` × none, 1/2/5 % loss, ±5/±20 ms ordered jitter (userspace relay; no `tc` here) × 1×/4×; 1 % turns a 0.62 s fill at 50 Mbit into 4.0 s and an ask's 153 ms into 1.5 s, 5 % into 12.4 s and 3.3 s (20–22×), whatever the rate (5 % at 5/20/50 Mbit: 14.1/12.8/12.4 s), the same for both codecs; the optimized item is 0.89–0.99 of HTJ2K's fill on 20 of 24 loss cells and its 4× penalty on fast clean links (1.07–1.26) is gone under loss (0.93–0.97); bursty 5 % puts an ask's p95 at 8–15 s on both; ±20 ms jitter adds 0.05–0.22 s a fill; Williams order, n = 8–15 a cell, 143 of 1 344 visits `VOID`, 10 752/10 752 frames exact, both mutations caught; `--congestion bbr` on the loss cells proposed, not built — [`README.md`](README.md) §Under loss and jitter, `lab/av1/delivery/total-time/README.md` |
| 61 | **TRANSFER** — how other systems deliver medical images, and what they do better than us: research, rows proposed | done `e11aea2` — **others deliver a frame's prefix first and the rest after; nothing they do survives loss better**: DICOMweb has no partial-frame retrieval but generic, optional HTTP Range (CP-2204); DICOM's HTJ2K RPCL syntax (Sup 235, TLM required) exists for prefix delivery, and an open-source viewer fetches a 128 KiB Range prefix of every frame, then `bytes=<held>-`, in strides of 4 (the committee's slides: 45 against 66 ms to first render over 4G, not reviewed); three cloud services document no partial retrieval; HTTP/3's streams buy little over one ordered stream under random loss (3 papers, 2021–22), as the shared stream found; QUIC FEC pays only on a transfer's tail (FlEC: 247 against 272 ms median, 50 kB with a loss) and no draft survives; `RESET_STREAM_AT` is in the RFC Editor queue (2026-09-06); four rows proposed, a plain HTTP/3 `fetch()` baseline first — [`delivery-prior-art.md`](../transport/delivery-prior-art.md) |
| 62 | **GPU** — GPU HTJ2K decoders' methods and whether WebGPU can take more than the wavelet: research and a feasibility bound | done `2ee009d` (`e658e8d`) — **a ported HT block decoder bounds at 42–67 % of a breast frame from 931×2124 up at 1×, loses on 512²; unmeasurable here**: the ICIP 2019 GPU decoder read in full (MEL+VLC one thread a code-block, MagSgn a warp a block, wavelet 40–50 % of GPU time; lossless 4K 62–402 frames/s), nvJPEG2000 refinement since v0.10.0, no WebGPU/WebGL decoder anywhere; WebGPU's way back measured in Chromium 141 on SwiftShader at 2.0–2.1× the heap's copy out on every frame over 4 MB, +3 ms on small ones (8 rounds interleaved, 1×/4×, 1 344/1 344 exact, mutation caught 12/12 cells); bound = 81–86 % movable − GPU time scaled from the paper's lossless kernels (throughput or a KCUPS1 latency floor) − that transfer: tomosynthesis 23 % / −44 %, MR 512² −14 %; no GPU in the container, so the WGSL port and a phone are what would settle it; row FASTHTJ2K's two misreadings corrected in place; gate's wasm steps not run (no wasm-pack), no client code changed — [`decode/README.md`](../decode/README.md) §A WebGPU block decoder, bounded, [`lab/av1/decode/webgpu`](../../lab/av1/decode/webgpu/README.md) |
| 63 | **JXL** — JPEG XL at fast efforts in WASM, and native browser decoding: which engines, exact at which depths, through which API, how fast | done `f4ccb34` on `claude/av1-unified` (`6c153b2`, `4532ec2`, `fc36d50`, `2511075`) — **no setting is both smaller and as fast as HTJ2K, and the browsers return 8 bits**: libjxl 0.12.0 exact at every effort 1–7 × `--faster_decoding` 0–4, 8–16 bits (35 × 37 frames); e1 0.94–1.03 of HTJ2K's bytes at 1.03–1.91× OpenJPH's WASM decode, e7 f3 0.91–0.98 at 1.56–2.45×, the default 0.81–0.96 at 5.35–10.0× (0.53 on the 16-bit scan), 8 interleaved rounds, Chromium 154 and Firefox 157, 1× and 4×, 7 040/7 040 frames exact; native JPEG XL in Chromium 154 (jxl-rs, `JXLImageFormat`, off; none in 141) and Firefox 157.0.1 (`image.jxl.enabled`, off), none in WebKitGTK 2.52.6 — every path (`<img>`, `createImageBitmap`, `ImageDecoder` `BGRX`, float16 canvas) 8-bit: exact on 8-bit grey and RGB, display pixels above; native under libjxl-WASM only at the default effort (2.2–6.1×); mutations caught 3/3 — [`decode/README.md`](../decode/README.md) §JPEG XL, [`README.md`](README.md) §Measured here |
| 64 | **REMAP** — rare values above 12 bits mapped out with a small exception map, and a palette for high bits: exact, bytes, decode | done `865b3f1` on `claude/av1-unified` (`56a9c0a`, `62061cf`, `1a6808e`) — **the map buys the decoder, not bytes**: two of three projection systems are 12-bit data plus one saturated level (16383, 11 % and 0.6 % of samples), the CTs and cone-beam 12-bit data plus 0.0003–0.02 % rare levels, the third projection system, the PET and the film dense or sparse above 12 bits; clamped into a 12-bit window with a deflated per-frame map (1–10 KB a series), one 12-bit stream is 2.6–13 % larger than the k = 2 split on all six series it fits, but split at k = 2 after the map it is the split's bytes (−0.1…+0.05 %) with every stream ≤ 10 bits, so WebCodecs decodes it in **0.46–0.71 of the split's dav1d-WASM time** (60/60 paired rounds; Chromium 141 in the container, 10 rounds Williams-ordered at 1× and 4×, 1 920/1 920 frames a throttle exact against the source) and 1.05–1.34× w10's for 5–12 % fewer bytes on the projections, 1.5 % on two CTs, 4.4–4.8 % more on a CT and the cone-beam; a high-bit palette ties the map; at L = 0 (histogram packing) it halves the 16-bit film for HTJ2K as for AV1 (0.576, 0.571); every AV1 arm still 2.6–7.3× HTJ2K's decode; 5 + 3 mutations caught; proposed, not built — [`payload-format.md`](payload-format.md) §Proposed: a remapped plane, [`README.md`](README.md) §A3, `lab/av1/bytes/remap/README.md` on `claude/av1-unified` |
| 65 | **ORDER** — the order frames are sent in: DBT centre-out, mammography view priority; time to the first useful image and to the full fill | done `1fdaaf5` on `claude/av1-unified` (`06f6083`, `79c800b`, `51286bd`) — **the useful frames asked before the fill reach the screen in 0.30–0.52 of the sequential fill's time on tomosynthesis (centre slice ±2) and 0.47–0.77 on a four-view mammogram's MLO pair, for two round trips on the whole fill (+72–113 ms, +0.4–4 %), HTJ2K and AV1 alike; nothing adopted, no product change needed**: both DBT volumes and two FFDM, HTJ2K and the optimized item, 5/20/50 Mbit at 1× and 4×, 13 Williams rounds, 1 191 of 1 248 visits kept, n = 10–13 (one cell 9), 19 032/19 032 frames exact; IHE's display test hangs all four views at once, so no order shortens a full hanging — [`README.md`](README.md) §The order frames are asked in, [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The first fill |
| 66 | **POCGAP** — an earlier private proof of concept's 31 % lossless AV1 gain on 10-bit data: two more 10-bit DBT series, paired medians, and the method notes recorded | done `22f5f03` (`069044e`) — **not reproduced: paired, plain AV1 is 0.973–0.976 of HTJ2K on 10-bit DBT, optimized 0.940–0.943, not 31 % below**: the first 4 frames of `dbt10_ea1141` and `dbt10_d`, 20/20 codings exact (80/80 frames); one setting at a time, an 8-bit copy (v ≫ 2) favours AV1 by 3.1–3.5 points, keeping the background by 0.5–0.8, libaom 3.8.2 against 3.15.1 at cpu6 by 0.5–0.7, `--threads=4` changes bytes 0.02–0.06 % a frame (so `--threads=1` is pinned); the two series the brief named are not CC BY or CC0 (UPMC states no licence, BCS-DBT is CC BY-NC 4.0: Blocked); 4 mutations caught 4/4 — [`README.md`](README.md) §Prior evidence, [`lab/av1/bytes/prior-gap`](../../lab/av1/bytes/prior-gap/README.md), [`FIXTURES.md`](../FIXTURES.md) §AV1 data |
| 67 | **CODECSTR** — the WebCodecs codec string derived from each stream's own sequence header, not one fixed `av01.0.04M.10` | done `8c2b24d` on `claude/av1-unified` (`e945e57`) — **the string is each stream's own, the frames and the decoder unchanged**: each keyframe's sequence header gives `av01.P.LLT.DD.M.CCC.cp.tc.mc.F`, reconfigured only when it changes; 91 distinct headers (419 units: every fixture, the probes, 59 items of all 28 taxonomy series, 8 full headers with timing, decoder model, frame ids, High tier, nine operating points) derive the string ffmpeg 6.1.1 reads; libaom writes levels 2.0–6.0 by picture size, never 31, and 31 changes no engine's answer; `isConfigSupported` true for every string in Chromium 141, every full string in Firefox 157.0, Main only in WebKitGTK 2.52.6; 115/115 frames exact in all three, Chromium's decoder per item the same as before (61 WebCodecs, 54 dav1d-WASM), none falling back; Chromium echoes the string's colour on the frame, so the 4:4:4 identity check now reads the header's matrix as dav1d's does — an untagged identity stream now decodes exact through WebCodecs; 13/13 derivation and 3/3 decoder mutations caught; gate green — `lab/av1/exact/codec-string`, `payload-format.md` §Decoder choice, `decode/README.md` §AV1 |
| 68 | **AV1DOCS** — the AV1 docs made the complete, essential source of truth: one place per subject, the round's findings in, the terms fixed | done `24e758a`, `afbc7f6`, `6094117` (the queue's paths `69087bf`) — **the AV1 item is the AV1 payload everywhere, and the phase doc reads by subject**: defined once in README §Names; `payload-format.md`, `parsePayload`, the error text `av1 payload:`, the 214 golden payloads (regenerated byte-identical at their new path, `av1-probe.js` unchanged), every doc and lab script (478 lines, DICOM's Item, AVIF's items and DICOM's work items left alone); no DICOM frame called an AV1 frame (7 places); `docs/av1/README.md` opens with where the phase stands and what is decided, then one section a subject (bytes, frame groups, exactness and the decoders with a diagram of the decode path, decode time and memory, samples over 12 bits, content, preview, encoding, total time, options, prior evidence) — every old paragraph moved verbatim but its lead or cross-reference, the one dropped list a duplicate of §Preview; `lab/av1/README.md` 459 → 338 lines, its encode-cost and AV2 cells beside `enc.py` and `av2.py` in `bytes/README.md`; 33 references to the old section names follow; gate green (dispatch 750/750, payload reader 356/356, its renamed refusal mutated to fail); *not condensed:* `adr-unit.md`, `payload-format.md` and the lab READMEs beyond their terms and references — [`README.md`](README.md) |
| 69 | **MERGEPREP** — `claude/av1` folded into `claude/av1-unified`, the gate green, the merge into `main` described for the owner | after 108–113 and 115–118 (every row but 114 FMT, which follows the merge) |
| 70 | **HTJ2KENC** — HTJ2K encoder settings (block size, decompositions, progression) by bytes and decode time, exact | done `14103cc` on `claude/av1-unified` (`e125d38`, `5b4e9aa`, `ecc9d68`) — **the served profile kept: no setting wins**: 35 settings on nine series, the best per series 0.990–1.000 of the served bytes (−0.9 % only on 256² PET); decode within the round spread everywhere (every paired range spans 1; 0.95–1.10 where decode is the clock); 6 decompositions, the fewest bytes overall, ties on total time ×0.99–1.02 on 5/20/50 Mbit at 1× and 4×; `imagecodecs`' defaults differ only in SIZ depth (container bits, 1.000–1.002 of the bytes); 315 × 35 codings and 12 400 + 339 visits' frames exact — [`docs/decode/README.md`](../decode/README.md) §Encoder settings | |
| 71 | **INGEST1** — the AV1 ingest coded one encoder run per frame, so its bytes no longer depend on the worker count | done `3402411` on `claude/av1-unified` (`d4f7b30`, `ef72890`, `7d022d1`, `d2c4408`) — **adopted: one aomenc run per frame makes every item byte-identical at 1, 2 and 4 workers, for +12–13 % encode CPU and no byte cost**: libaom 3.15.1 `good:6`, the first 16 frames of all 23 sets of rows 2, 45 and 46 (252 items), every set identical across worker counts (`ffdm_d` at 1 and 2: four exceed memory, as before), bytes 0.99987–1.00015 of the chunked ingest's, 0.999998 in total — a one-frame run writes the reduced still-picture header every golden item already carried (forcing video mode would rewrite 106 golden items, not taken; row 80's `grey420/g8`, written while it was on the branch, regenerated, exact through the gate); whole series, n = 5 interleaved, wall at 1 worker 54.1 → 61.0 s fluoroscopy, 92.2 → 103.4 s 10-bit volume, 147.8 → 165.7 s ultrasound, every range disjoint, +6–13 % at 4 workers; the chunked ingest gave three totals for the 10-bit volume at 1/2/4 workers, the new one the same every round; mutation (the chunked loop as the new arm) caught on both tomosynthesis volumes, the regenerated golden broken caught by the gate; gate green — [`ingest/coded-frames/README.md`](../../ingest/coded-frames/README.md) §One pipeline *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 72 | **SPLITRULE** — row 44's per-depth split rule adopted: the payload format and ingest widened to every depth it picks | done `953dbfd` on `claude/av1-unified` — **adopted: ingest's optimized split is k = 0 up to 9 bits, 3 at 13, 2 at 10–12 and 14; 15–16 bits refused by name, served as HTJ2K**: the format did not change (row 43 already carries every k), only `ingest.py`'s `optimized_split`; its per-depth test held against three mutants (each caught), the writer's 142/142 split-and-merge cells still exact; a 9-bit golden item (`g9`, plain and optimized) and `optimized/s13` remade at k = 3 (10-bit top, WebCodecs), every other golden and matrix item and the probes byte-identical; the real 9- and 13-bit series (MR 9-bit, CT, cone-beam) ingested by the rule, 198/198 frames exact natively, in Node (dav1d-WASM) and in Chromium 141 (WebCodecs 198/198, as chosen); Firefox and WebKitGTK not installed here — row 43 ran these layouts there; gate green on every step but the link check, which fails only on row 69's brief (`docs/av1/MERGE.md` not yet written) — `payload-format.md` §Representation at ingest and §The split per depth, README §A3 |
| 73 | **EXACTPROD** — exactness in production: how a client proves every shown frame bit-exact, acts on a mismatch and reports it; a measured design proposal | done `5421dda` on `claude/av1-unified` (`8ebe03a`) — **check every frame with XXH3-64 before paint: 1–10 % of a decode, SHA-256 up to 1.44×**: headless Chromium 141, a decoder worker (OpenJPH package, samples in shared memory), 10 rounds Williams-ordered at 1× and 4×, 2 220/2 220 hashes and 5 760/5 760 pool checks exact against independent hashers over the encoder's input, `--mutate` failed every cell; at 1× SHA-256 ≈ 250 MB/s through WebCrypto and WASM alike (WebCrypto refuses shared memory and pays a copy; the host has SHA instructions), BLAKE3 ≈ 570, XXH3 ≈ 4 000; a decode-bound fill checked before paint ×1.00–1.15 with XXH3, ×1.15–1.51 BLAKE3, ×1.24–2.23 SHA-256; the brief's "today" corrected — this repository stores and checks no hash in production, so no SHA-256 fallback defect exists; proposed, not built, in [`docs/adr/exactness-in-production.md`](../adr/exactness-in-production.md) on that branch |
| 74 | **XENGINE** — why WebCodecs AV1 is not exact outside Chromium, and what would make it exact | done `cf4db15` on `claude/av1-unified` (`f446c90`, `2d63d82`) — **Firefox 157 can be exact only at 8 bits, WebKitGTK 2.52.6 not without engine changes; the client now reads 8-bit GBR returned as RGB**: from the engines' sources and 13 layouts × 6 engine variants, every plane against the encoder's input: Firefox refuses monochrome (its FFmpeg path knows no grey format) and returns everything else as 8-bit `BGRX` through a compositor texture, so 10-bit is cut to 8 bits, but 8-bit GBR and 8-bit grey coded 4:2:0 at full range come back exact (all 256 values; limited range is off by ≤ 20); WebKitGTK takes only `av01.0`, hands the decoder frame alignment that libaom's `av1dec` refuses, maps no grey or 10-bit format, and with `dav1ddec` installed copies an even-width `I420` at the wrong stride (exact at 768 wide, wrong at 760); Safari's WebCodecs AV1 is a preview preference, off, software dav1d at 8-bit 4:2:0 only (device run under `## Blocked`); built: GBR from `BGRX`/`RGBX`, exact 40/40 per cell, 0.77× dav1d-WASM's decode at 1× and 0.62× at 4× in Firefox (10 rounds), Chromium unchanged, 3 mutations caught, gate green; proposed: 8-bit grey as full-range 4:2:0 (+0.07 % bytes) — [`docs/decode/README.md`](../decode/README.md) §Why, and what would make it exact |
| 75 | **LOSSCC** — the congestion controller under loss: today's against BBR and a Cubic that restarts after silence, on row 60's lossy cells | done `08b4f3d` on `claude/av1-unified` (`c5b5b4e`, `c20e7b0`) — **BBR is the larger lever under loss on both codecs, but costs some clean cells, so it is not adopted: the owner's call**: the 10-bit volume, 4 frames filled then 4 asked, 5/20/50 Mbit and `lte-good` × none, 1/2/5 % loss, ±20 ms × 1×/4×, HTJ2K and the optimized item each under `cubic-restart` and `bbr`; 28 Williams-ordered rounds, 3 416 visits, 1 281 `VOID` (the host's steal time rose), n = 8–19, 27 328/27 328 frames exact; under loss BBR fills in 0.04–0.76 of `cubic-restart`'s time (5 % at 50 Mbit 12.5 s → 0.55 s) and an ask's median falls from 1.4–3.6 s to 0.21–1.1 s, `lte-good`'s 5 % p95 from 10.2–10.7 s to 0.7–1.9 s; with nothing lost +2–3 % at 5 Mbit (8/8, 11/11 pairs), +12–13 % at 50 Mbit with ±20 ms jitter, ask p50 +70 ms on clean 20 and 50 Mbit at 4×; `cubic-restart` reproduces row 60 — `transport-conclusions.md` §1 (LOSSCC), `lab/av1/delivery/total-time` §Row LOSSCC |
| 76 | **ASKDEADLINE** — the client's own per-ask deadline under loss: does it fail asks the transport is still delivering; bytes as the only judge | done `935ce64` on `claude/av1-unified` (`37d7cb1`, `1cb3430`) — **no client timer failed an ask under loss, before or after; one could, and now resumes instead**: the timers that can end a frame are the downloader's 3 s stall (doubling), `dialMs` and each transport's 15 s per-ask waiter (no byte for 15 s, restarted by every byte); the waiter failed an open session's ask outright once three silences had doubled the stall past 15 s — now `FrameTimeoutError` in both WebTransport clients, taken as silence and resumed until `tries` runs out (a node test that failed first, a conformance clause, 3 mutations caught); row 60's harness, 10-bit volume as HTJ2K, 4 filled + 8 asked, 20 Mbit and `lte-good` × clean/2 %/5 %, 1×, before/after/`stallMs` 15 s, 10 rounds interleaved, 155 of 180 visits kept, 2 160/2 160 frames exact, 0 asks failed in every arm; clean and iid loss: no silence over 1 s, fill ×0.98–1.03; `lte-good` bursts: sessions live through silences of up to 9.3–12.4 s, 3 s re-dials 2–12 a cell, ask p95 12.8–13.8 s at 5 % either way; a 15 s stall not adopted (p95 19.5 s, max 54 s; Chromium drops sessions at 6.6 s itself) — [`client/README.md`](../../client/README.md) §A session that dies is resumed, on that branch |
| 77 | **TOTAL4** — total time with every change adopted this round, per taxonomy series, HTJ2K against AV1, in Chromium and Firefox; the per-series codec rule | done `f6a0f7e` on `claude/av1-unified` (`b2e2d78`) — **no series fills first in both engines on every cell, so ingest keeps HTJ2K**: 7 series, 5 links, 1× and 4×, Chromium 141 and Firefox 157.0.1, 3 746 visits, 90 949/90 949 frames exact; AV1 0.89–0.98 of HTJ2K's time wherever the wire is the clock on MR, 10-bit DBT, fluoroscopy, CT and ultrasound, but Firefox at 4× on 50 Mbit loses on every series (1.33–2.53, n = 8–13) and the mammogram and 14-bit projections lose even at 1× on 50 Mbit in both engines (1.05–1.18); 46 % of visits `VOID`, so the wire-bound cells are n = 1–9; ultrasound provisional (lossy-sourced); `docs/av1/README.md` §Every change of the round |
| 78 | **HTJ2KMT** — one HTJ2K frame decoded on several threads in the browser (code blocks in parallel): exact, and what it buys a phone-like CPU | done `e9831a1` on `claude/av1-unified` (`3477c04`) — **adopted: two threads, one helper, as the delivered OpenJPH build; an ask's lever, not a fill's**: OpenJPH 0.31.0 with row 41's code-block pool, headless Chromium 141 on 4 cores, 10 rounds interleaved; a frame ×0.70–0.83 at 2 threads on every frame from 1914×2572 up at 4× (10/10 rounds; 4 threads ×0.62–0.87), ×0.81–0.98 under it; a fill through the product's three decoders on 50 Mbit and LTE ×0.975–1.001 (largest frames at 4× only, slower nowhere; n = 10); +2.2–2.5 MB RSS a worker at 2 threads, +6–7 at 4 (n = 1–2); 2 560 + 9 600 + 250 frames exact, a flipped byte, a block left undecoded and the helper's glue URL removed each caught; the package the product loads is 0.5–8 % slower than the same OpenJPH built here — [`decode/README.md`](../decode/README.md) §Code-blocks on threads, measured, [`lab/av1/decode/htj2k-threads`](../../lab/av1/decode/htj2k-threads/README.md) |
| 79 | **COLDRTT** — round trips before the first exact frame on high-RTT links, cold and warm, HTJ2K and AV1 pages; preload or bundle what is serial | done `873f537` on `claude/av1-unified` (`7d30674`, `21c5cd9`) — **the AV1 decoder's load was 2.0 serial round trips through WebCodecs and 3.9 through dav1d after the first item; fetched at the decoder's start −1.0 and −3.0, adopted; with the page's preloads AV1 reaches HTJ2K's 8.0**: cold, slope over 100/200/300 ms, HTJ2K 7.99, WebCodecs 10.02 → 8.98 (page preloads 7.98), dav1d 11.93 → 8.96 (7.96), every paired round won (29–38 a cell), 2 856 against 3 777 ms at 300 ms; warm 5.9–6.0 in every arm; session unmoved, +27 to +41 ms with the preloads; under 20 ms a ≤ 10-bit series pays +26 ms at 10 ms and +67 on loopback for the fallback's WASM, dav1d wins from 10 ms (−25, 3/4); 24 rounds Williams-ordered, 15–22 visits a cell, every frame exact against its source's checksum, the check and the two new tests mutated — [`lab/page-open/README.md`](../../lab/page-open/README.md) §Cold round trips by codec, `client/README.md` |
| 80 | **GREY420** — 8-bit grey coded as full-range 4:2:0 so Firefox's WebCodecs returns it exact (row 74's proposal): bytes, decode, total time per engine | done `c1df284` on `claude/av1-unified` (`e7243f5`, `3e9bbc0`, `172cf24`) — **not adopted: 4:2:0 makes every 8-bit grey frame exact through Firefox's WebCodecs, but slows every Chromium fill**: `usb_cine` and `usb_still`, +0.20–0.23 % bytes; a frame 1.06–1.11× in Chromium, 0.63–0.66× in Firefox at 4× (1.03–1.04× at 1×), 10 rounds, 18 600/18 600 exact; whole fills, 17 rounds, n = 7–17, 75 760 frames exact (two Firefox visits got none): Chromium +0.2–0.5 % where the wire is the clock and +3.4 % on the cine at 4× on LTE and 50 Mbit (24/26 rounds slower), Firefox 0.74–0.87 at 4× on LTE and 50 Mbit, ±3 % elsewhere. The readers take 4:2:0 grey (`g8f` probe), the ingest keeps 4:0:0 (`--grey8 420` opts in); Firefox cannot dial the relay's fixed 5 Mbit link (§Blocked). [`payload-format.md`](payload-format.md) §8-bit grey as 4:2:0, [`lab/av1/delivery/grey-420`](../../lab/av1/delivery/grey-420/README.md) *Provisional (row DATAGUARD): its verdict rests wholly on `usb_cine` (lossy-sourced, an MPEG-4 clip) and `usb_still` (unknown, a PNG export); no sound 8-bit grey series was measured.* |
| 81 | **SERVERLOAD** — the server under many concurrent fills: where it saturates, and what each client's fill time does before and after | done `5db386d` on `claude/av1-unified` (`7423b1a`, `73d478d`, `f45e0aa`) — **one server core delivers about 400 MB/s of fills; a fill holds its single-session time until the sessions' rates sum past that**: server on one core of a 4-vCPU container, N native sessions (`fill_load`) on the other three, each asking the whole 10-bit DBT volume (13.6 MB HTJ2K, 13.0 MB optimized AV1) at once, unpaced or read-paced at 20 and 50 Mbit; 10 Williams rounds of 54 cells plus 10 of 10 around the knee, 640 runs, 1 012 320/1 012 320 frames byte-identical to ingest's checked items (a flipped reference byte failed every run); at 50 Mbit ×1.00 at 64 sessions (0.98–0.99 cores), ×1.25 at 80, ×2.12–2.19 at 128; at 20 Mbit ×1.00 to 128 (0.84–0.89 cores, 0.7 % of a core a fill), ×1.03 at 160; unpaced the server is the clock from 2 sessions; 2.0–3.1 ms CPU a MB, the same for both codecs; 3.7–4.8 MB resident a filling session (1.1 GB at 256); the server's core saturates, the host 58–60 % busy; from 192 sessions the rig's client sockets drop enough datagrams to back the server off, so nothing is claimed past 160 or beyond one core; gate green — [`docs/transport/transport-conclusions.md`](../transport/transport-conclusions.md) §4 *Many fills at once*, [`lab/server-load`](../../lab/server-load/README.md) on that branch |
| 82 | **CLIENTLAYOUT** — the client's folders by worker: `client/decode/` (the decode worker, its codec modules and their WASM builds) and `client/transport/` (the page side, the download worker, its transports) | done `a4fce87`, `19b5c31` (the queue's paths `662ed7c`) — **the client by worker, behaviour unchanged**: `client/transport/` holds `consumer.js`, `downloader.js`, their tests, `ts/` and `wasm/` (the WASM transport's crate); `client/decode/` the decode worker, `wasm-glue.js`, `htj2k.js`, the AV1 modules by role (`av1.js`, `av1-payload.js`, `av1-dav1d.js`, `av1-webcodecs.js`, `av1-frame.js`, `av1-probe.js`) and `wasm/`; 34 files moved, 987 of 1 149 byte-identical, 135 differing only in paths; the golden coded frames and `av1-probe.js` regenerated into the new tree byte-identical; the gate green (dispatch 750/750, conformance 199/199 and 57/57, 0 links unresolved); the lab's before/after rigs keep archiving `client/downloader` from the commits that had it; `docs/cloud-queue.md`, not this queue's to edit, is exempt from the path check (`PATHS_AS_WRITTEN`, its mutant leaves 2 unresolved) — [`client/README.md`](../../client/README.md) |
| 83 | **TEAMAUDIT** — the repository against the team-readiness principles below: every gap, partitioned for rows 84–86 | done `3006e6c` — **about 170 gaps at their lines, in three lists for rows 84–86 and four groups of owner decisions under Blocked**: one concept carrying 2–4 names in 17 places, queue and campaign labels in ~250 doc and code lines, no toolchain pin and 9 unlisted prerequisites, a gate that prints OK over 128 of 719 skipped checks with one stale-build guard; findings under this row |
| 84 | **NAMES** — names, the one glossary, environment variables and folder leftovers, per the principles | done `a8c7686`, `332d4fd`, `b6aad3e`, `f872173`, `064b31b`, `e129979`, `f22bbd8`, `f9b83a7`, `9131048`, `6b45a4b` (the queue's paths `1215426` and after) — **every rename the owner adopted, the one glossary, the Names rule; gate green after each step** (dispatch 750/750, contract 199/199 and 57/57): "study" is the series it serves (`--series`, `/series/metadata`, `pack-series`, `series-bundle` moved to `common/`), `exact-server` is `series-server`, the conformance suite is the contract suite (`client/contract/`; DICOM's conformance statements keep theirs), an A/B arm is a variant (≈2 780 lines, `VARIANTS`, six lab files; arming a waiter or fill keeps its verb, ARM the CPU), the telemetry schema's `arm` is `client` and its row kinds ask/fill, the always-null paint and preload fields dropped (their mutant fails the record test), the patch `settings-in-handshake`, `Ask` enum → `Command`, `SeqReader` → `FillReader`, `--open-ask`/`openAsk` → the opening ask's name, `ENVELOPE_LEN` → `INDEX_LEN`, `session-telemetry.js`, the download worker; `docs/glossary.md` (32 terms) linked from the README, the Names rule in `CLAUDE.md`; no personal path as a default (the pinned emsdk, its absence refused by name; the rig's key and checkout required; traces in `lab/.traces/`); leftovers: five unread warm-up fixtures removed, the unapplied quinn patch beside its draft, two unreferenced lab files named where their numbers are, the campaign-named lab files and `lab/downloader-cost/` named by what they measure; `git grep` finds none of the old names outside the queues; *kept and defined instead:* "tile" (the server's read of an asked frame, the read-path ADR's vocabulary) and Media-complete; *not done:* queue-row labels in product docs' prose and headings (`docs/av1/README.md`, `docs/decode/README.md`, `transport-conclusions.md`) and campaign labels in lab code comments, which need each measurement named, and the several-names cases row 83 lists without a fix (`stallMs`/`quietMs`, the last byte's three names, the TCP client's four, `wt_port`) — [`docs/glossary.md`](../glossary.md) |
| 85 | **ONBOARD** — clone to green from the README alone, the docs essential and current, diagrams, each subject stated once | done `2245248`, `5a0fb60` — **a fresh clone, the README followed literally, reaches a running page and a green gate with nothing skipped**: two clones of `claude/av1-unified` in this container (Rust 1.97, Node 22.22, Python 3.11, Chromium of playwright 1.56.1); the first, on the old README, stopped at step 1 — wasm-pack's own fetch of binaryen 117 fails behind a TLS-intercepting proxy, though curl gets it — and its gate skipped 598 of 750 dispatch checks and the painter, which the README never named; fixed: `build.sh` fetches binaryen 117 with curl, SHA-256-pinned (a wrong checksum refused, exit 2), and wasm-pack runs it from PATH; the second, on the new README, ran every step to exit 0 — the AV1 build and the numpy venv included — a cell delivering 3/3 frames on both clients, and `scripts/gate.sh` GATE OK in 3 m 44 s cold, dispatch 750/750; the README now states Linux x86-64, Rust ≥ 1.88, Node 22 (`.nvmrc`, `engines`), Python ≥ 3.11 and every tool on PATH, pins wasm-pack 0.15.0 and playwright 1.56.1, numbers the steps through the gate (about 100 s warm, `--quick`, measured once), says the smoke bundle repacks byte-identical and what the dev certificate is; `CLAUDE.md` gains `--no-browser`; corrected: `rig-limits.md` seven limits, the framing ADR built, `adr-unit.md` in the ADR index, `server-load/` in the lab index, the client folders in `CLIENTS.md`, the AV1 test payloads and their generators in `FIXTURES.md`, nine fixture READMEs' dangling §0b and one-rate line and their generator, the nginx template's garbled line, a comment pointing at "the proposal"; a diagram of an ask during a fill in `WIRE.md`; *not done:* product docs pointing at the queues rather than their own §Open, the history narrative, the duplicates (the race, BBR's 12–19×, `read_ahead_kb`, FoD's two decoders in code), the other diagrams, READMEs for eight lab folders, the lab's copied helpers — [`README.md`](../../README.md) §Prerequisites |
| 86 | **CHECKS** — the gate runs every suite and says what it skipped, a stale-build guard, formatting, hygiene, dead code | done `e2b9e11`, `0f6ec47`, `02ba15e`, `0f3f5fd`, `d390252`, `a10aeca` — **the gate says what it ran, what it skipped and how long each step took, and catches four things it let through**: each step timed, a failing step printed whole (not its `tail`), `GATE OK in N s; skipped:` with every SKIPPED line — the AV1 build, numpy, `--quick`, `--no-browser`, and now the io_uring tests that could not run (`SKIPPED:` from the server, `--nocapture`); refused before anything runs: a dav1d-WASM build older than `build.sh` or `dav1d_wrap.c` (exit 2), missing `nm`/`strings`; new steps: no personal path in any tracked file (`scripts/check_personal_paths.sh`), the split's merge test, `pack-series` and `check-fastpath` built and tested, the recorder's tests type-checked; the client absence check fails on a missing WASM build instead of passing, the server's drops two patterns that matched nothing; hygiene: 94 files with a shebang made executable, a sourced one not, `.gitignore` and `.cargo/config.toml` each thing once, the link check over every top folder; the comment budget reads shell and Python (four scripts trimmed) and skips tests as it says; dead code: one unused read-path helper removed, nine recorder exports made private; product comments: numbers, narratives, history and quinn's doubled defaults out; mutants, each caught: a touched `dav1d_wrap.c` (stale, exit 2), no numpy and `--quick` (three SKIPPED in the recap), `TMPDIR=/dev/shm` (three io_uring tests reported skipped), a `$HOME/.ssh` default (personal path), a broken link (the failing step printed whole), `proces.exit` in a recorder test (type error), eight comment lines in a script (over budget); gate green in 113–180 s; *not done:* a Rust, TypeScript or shell formatter and linter (the workspace is unformatted: 171 `cargo fmt` hunks — a style decision first), stale guards for the image and `cellcheck.sh`, the lab's Go and h3 clients compiled |
| 87 | **PAINTER** — a GPU painter in a worker for the client's decoded frames: the DICOM grayscale pipeline (rescale, VOI LUT function, MONOCHROME1), bilinear placement, fit, zoom, pan, quarter turns, flips, invert; proved against an independent CPU reference | done `8b45d45` on `claude/av1-unified` — **built as the paint sink, and equal to an independent CPU reference to the code in every 1:1 cell on SwiftShader**: `client/paint/` (page half, WebGL2 worker half, the PS3.3 window table, a float64 reference); 50 exact cells × DPR 1 and 2 (4 frames: 8-bit grey and RGB, 16-bit, signed 12-bit CT; every window, VOI function, MONOCHROME1, invert, rescale, quarter turn, flip, whole-pixel pan) at |Δ| 0; fractional cells reported, |Δ| ≤ 1–5 on 0–4 % of samples; mutants: the signed offset caught by 15 exact cells, the 4 formula mutants by 12 hand-worked VOI tests, NEAREST and the window after the filter only by fractional cells (|Δ| 1 → 26, 1 → 8), the 1/512 px quad by nothing here — a GPU run owed; SwiftShader paint 8.5 ms at 512², 211 ms new and 97 ms on a window change at 4096×3072, the page thread 0.1 ms; the 1:1 check in the gate, 2.4 s — `client/paint/README.md`, `ARCHITECTURE.md` §Paint |
| 88 | **EXACT** — row 73's proposal built: a per-frame XXH3-64 written at ingest and checked in the decoder worker before a frame is handed on; a mismatch decoded again and never shown as exact | done `78b6bfa` on `claude/av1-unified` (`a784b62`, `10d940c`; built twice — `29c9361` by a session whose claim this one overwrote, kept as the product code) — **the check costs the fill nothing measurable, and is on wherever the metadata carries digests**: XXH3-64 per frame at ingest (`digests` in `metadata.json`), hashed in the decoder worker before a frame is posted, a mismatch decoded again on the other path (`exact` true/false/`"unchecked"`, `path`, `stats().exact` per path); fill check on ÷ off through the downloader, MR, fluoroscopy, projections and mammogram as served HTJ2K, r20000/r50000/wifi-home at 1× and 4×, 14 rounds interleaved, headless Chromium 141: ×0.945–1.013 medians, every cell's paired range covering 1 (largest ×1.011 mammogram r50000 1×, 8/10 slower, ~24 ms of 2.2 s); first picture ×0.945–1.097; 13 528/13 528 frames exact, 6 764/6 764 checked `true`; 184/608 visits `VOID`, kept n 5–12 a variant (n ≥ 10 not met on every cell); r5000 and LTE not run (wire-bound, could only hide it); rig 766/766 in Chromium, 13/13 in Firefox 157.0.1 (OpenJPH and dav1d-WASM `true`; its WebCodecs took none of the payloads, unverified there); 90 matrix payloads and every golden shape `true` against Python's xxhash; 7 mutants caught (verify always true, no digest true, no second decode, HTJ2K again on the reused object, AV1 again through WebCodecs, digest big-endian at ingest 80/90 `false`, zero-extended 40/90 `false`), `--mutate digest` 4/4 `false` — [`docs/adr/exactness-in-production.md`](../adr/exactness-in-production.md) §Built *All five links since (`91c227c` on `claude/av1-unified`): n = 10 a cell, r5000 and LTE included, fill on ÷ off ×0.98–1.04 at 1× and ×0.98–1.09 at 4× (the mammogram 2–3 % slower at 4× on r20000 and r50000), 8 900/8 900 `true`; every path `true` in Chromium (htj2k, WebCodecs, dav1d, mixed) and Firefox 157 (htj2k, dav1d) — ADR §Built.* |
| 89 | **INGEST** — one product command from a DICOM file or folder to a served bundle: the display attributes in the metadata, the per-frame digest, the codec chosen per series, exact at ingest | done `df4cbca` on `claude/av1-unified` (merged `63f9d7a`) — **adopted: one command from DICOM to a served bundle, as exact as the two steps and no slower but on single-frame series run one after another**: `ingest/from-dicom/from_dicom.py` (pydicom 3.0.1, NumPy, xxhash pinned) reads one object or a folder of one series by InstanceNumber, native pixel data parsed by hand (RLE through pydicom), refuses by name mixed series or sizes, ties, lossy and unpinned-lossless syntaxes; writes `.sbnd` and its metadata — bits, photometric, modality, frame time, rescale, every window (functional groups, per-frame over shared), `perFrame` where they vary, digests, no identifier; `auto` = HTJ2K (row 77 adopted none), AV1 presets by content from row 14; the core in `ingest/coded-frames` imports nothing from the lab, refuses aomenc, OpenJPH or the in-process decoders unless pinned, and the lab imports it; on `ct_nlst` (76 signed single-frame files), `us_liver` (RGB), `dbt12_ea1141` (enhanced) and `ffdm_a` (4 views, 4 series — refused as one folder, by name): samples 180/180 = `fetch_data.py`'s `NNN.raw`, attributes = DCMTK 3.6.9's `dcmdump` 180/180, bundles identical at `--jobs` 1/2/4, `check.mjs` 180/180 HTJ2K and 180/180 AV1, fill 180 + 180 `exact: true`; ingest time a frame ÷ the two steps, 6 rounds interleaved: CT ×0.81 [0.66–0.91], cine ×0.71 [0.65–0.86], tomosynthesis ×1.30 [0.81–1.56] (within the spread), mammogram ×2.52 one view after another but ×0.65 [0.49–0.97] with the four series run at once; 5/5 named mutants fail their test (sort reversed, PlanarConfiguration ignored, sign not extended, shared window over per-frame, lossy accepted); several series a study proposed in `docs/FIXTURES.md`, not built — [`docs/FIXTURES.md`](../FIXTURES.md) §From DICOM, `lab/av1/exact/from-dicom` |
| 90 | **VIEWER** — the product's page on its own downloader: metadata → fill → exactness → paint; step, cine, window/level, a status line; a page check that fails anything short of a complete, exact, drawn page | done `36c0b9c` on `claude/av1-unified` (merged `a54cf75`) — **adopted: the viewer is the product's page, and it adds nothing to the fill**: `client/viewer/` at `/` (dev-server.py and nginx), the whole series as the opening fill, the codec's code alone preloaded, painted through the painter, a frame not exact marked and counted, step, cine (FrameTime/CineRate), window and level, zoom, pan, turn, flips, invert, `?fill=0`; `dev-server.py` makes the dev certificate when missing or ending within a day (`gen_dev_cert.sh --if-needed`); `client/viewer/check.mjs` (Chromium, stock Firefox, `--url`) green in Chromium 141 and Firefox 157.0.1 (Xvfb, Mesa llvmpipe) on row 89's CT (76), RGB cine (70, cine run) and tomosynthesis (29), each as HTJ2K and AV1: every frame exact, the protocol after the fill, first/middle/last readback = CPU reference byte for byte, HTJ2K and AV1 readbacks identical; 5/5 mutants fail it by name (frame dropped, sample altered, WebCodecs taken away, AV1 code on an HTJ2K page, paint a row off); the gate runs it on a 3-frame series and names the cross-codec arm and Firefox skipped; fill against total-time's page (same downloader and decoders, no paint), from navigation, CT, row 23's five links at 1× and 4×, 12 rounds interleaved: ×0.994–1.004 on the fixed links and LTE in both codecs (wifi-home ×0.86–1.53, n = 2–7), first exact frame on screen +55–148 ms at 1×, +212–331 ms at 4× (the first paint, on SwiftShader); 36 480/36 480 frames exact and checked; 177/480 `VOID`, 1–12 pairs a cell (n ≥ 10 on r50000 only) — [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) §The viewer, `client/README.md` §The viewer |
| 91 | **DECODERBUILD** — the client's decoder builds made by the product, reproducible from pinned sources: OpenJPH at a 4 MB heap with the range in the pack, dav1d-WASM, the third-party notices | done `b947ddd`, `f160030`, `9796643` on `claude/av1-unified` — **adopted: the product builds its decoders, OpenJPH single-threaded at a 4 MB heap, faster than the package in every cell**: through the downloader on `g512` (three decoders, 10 rounds Williams-ordered, every frame exact) fill ×0.927 at 1× and ×0.941 at 4×, cold ask ×0.715 and ×0.732 (10/10), JS+WASM 157 → 22 MB; row HTJ2KMT's pool tied fills and lost the 4× cold ask (×1.078, 3/10), so it is not shipped; parity 783/783 frames on nine sets, signed included; the 107 AV1 payloads exact through dav1d in Chromium, Firefox and WebKitGTK (with SAB); two clones at different paths build identical bytes; the page and the gate load only what the manifest pins; mutants caught — `docs/decode/README.md` §The build, as delivered |
| 92 | **DEPLOY** — the two images and compose made fit to run unattended: ten fixes, TLS for the page off loopback, the viewer, decoder builds and notices in the web image, verified by the page check against the deployment | done `1fe15ed` on `claude/av1-unified` (merged `149885c`) — **adopted: the deployment runs the viewer, the decoder builds and the server unattended, from this tree**: the ten fixes (`:z` kept; stop 0.45–0.49 s server, 0.51–0.54 s web, so no `init`; a new ECDSA certificate (10 days) and transport file, written whole, at every start, the server under `timeout 9d`; gzip on modules, WASM and metadata; crates copied alone with cargo cache mounts, `npm ci`; `restart: unless-stopped`; healthchecks and `service_healthy`; uid 10001 owning `/certs` 0700 and the transport volume (web's mount point too: a fresh volume took root from it on the first run); every base pinned by digest, `REGISTRY` for a mirror; `--locked`, `server_tokens off`, unused routes gone), `PUBLISH_ADDR` (127.0.0.1), `TLS_DIR` (443, HTTP/2), `WT_URL`, `STUDIES`/`SERIES` mounted, only `/`, `/client/**`, the metadata and the transport file served; docker 29.8.2 (rootless podman not installed here, unchecked; Docker Hub 429, built through `mirror.gcr.io`, with `BUILD_CA` for this host's proxy): cold build 114 s, after a doc edit 1 s with 23/23 steps cached; images 132 MB server, 95.8 MB web; row 90's page check `--url` on row 89's CT (76 frames) passes on loopback with no certificate flag and off loopback over TLS from the host's second address (CA in Chromium's NSS store); `restart server` rotates the certificate and the next open passes; `check_equivalence.sh` green on 10 paths, 8 hidden, gzip and the Server header, its 4 new assertions each mutated to fail; the gate is green but for `lab/bb3/cell3-w4b-summary.txt`'s personal path, row 104's file — [`deploy/README.md`](../../deploy/README.md) |
| 93 | **CODECDOCS** — the codec docs as the one source of truth: a comparison of every codec measured, one doc per codec under the same headings, the target series' bit depths with their sources | done `4bbddd3` on `claude/av1-unified` — **the codecs side by side in one place, every number keyed to the doc that states it**: docs/codecs/README.md (the rule; AV1's series, breast family first, CT and MR HTJ2K, none qualifying by row TOTAL4's rule; the choice per series and depth as built; 13 target series' depths with sources; at-a-glance and side-by-side tables, 10 columns × 5 codecs, every cell's numbers found in its keyed source by script, the four derived ranges restated exactly; why HTJ2K is the default and four things that would reopen it; 9 specifications with edition, URL and date read 2026-10-09 — AV1 1.0.0 Errata 1, AV1-ISOBMFF v1.3.0 §5, WebCodecs WD 2026-10-07, its AV1 registration, DICOM PS3.3/3.5/3.6 2026d (no AV1 UID in Table A-1), Sup 232, T.814 (06/19) — and the sold or unread ones); `htj2k.md`, `jpeg-xl.md`, `jpeg2000.md`, `av2.md` under the 17 headings, `docs/av1/README.md` nested under them with every section name kept and a new §The bit split, explained (worked example 2731 → 682 + 3 at k = 2, CT −997 → 131 + 3 at k = 3); six passages moved, listed in the commit; glossary + `representation`; link check 0 unresolved (a broken link in the new docs mutated to fail), gate green (`--quick`) — docs/codecs/README.md on `claude/av1-unified` |
| 94 | **DATAGUARD** — every set's pixel provenance recorded and enforced: a provenance column, the fetch refusing lossy or video sources unless marked, the ultrasound claims corrected in place | done `ac1e878` on `claude/av1-unified` (`fde3710`) — **one DICOM set is flagged lossy, `us_liver` (Lossy Image Compression 01 at 12.4:1); every other IDC set uncompressed and never flagged (25 sets, 827 files read)**: a provenance class per set in `data.json` (23 sound, `mg16_cbis` lossless-but-unrepresentative, `us_liver` and the two MPEG-4 breast cine lossy-sourced, `usb_still` unknown); `fetch_data.py` records transfer syntax, Lossy Image Compression, Image Type and Presentation Intent and refuses a source its class does not admit — 17/17 guard cases in the gate, 4 mutations each caught, on the real files `us_liver` and `usb_still` marked sound refused and five sets accepted with their digests unchanged (the 1.5 GB cine zip not fetched; its path is the unit test's); the sound-data rule in §Protocol; the ultrasound claims of `README.md` and 20 rows' verdicts marked provisional in place; the missing sound sources under §Blocked. Finding: `docs/FIXTURES.md` §Provenance. |
| 95 | **DBTSCALE** — DBT slices at scale on sound data: whole uncropped volumes, every system of the large CC BY collection, bytes, inter and total time | done `9f2778b` on `claude/av1-unified` (`0cf2136`, `b416212`, `f09b218`, `888254a`) — **the per-depth rule holds on bytes at scale; the time verdict narrows: HTJ2K's at 4× on 50 Mbit/s**: fifteen whole, uncropped DBT volumes, five exams from each of the three systems, all sound, 994 slices, every frame exact in every arm; k = 2 the smallest arm on 15/15 at `allintra` 7 — 0.948–0.956 of HTJ2K at 12 bits, 0.939–0.956 at 10 bits and 0.760/0.797 on two 10-bit volumes (unexplained); cpu0 on the middle slices puts k = 3 ahead at 12 bits by 0.3–0.8 %; decode (every 8th slice, 8 rounds, 8 320/8 320 exact) never as fast as HTJ2K, fastest 2.9–3.7× at 12 bits and 2.0–2.6× at 10; total time on one exam a system (every 8th slice, 6 rounds, 3 024/3 024 exact, 119 of 324 visits `VOID` and counted, within 0.04 of the kept) k = 2 0.96–0.97 at 5 Mbit, ties at 50 Mbit 1×, 1.30–1.39 at 4× on 50 Mbit — whole volumes in every cell were ~100 h here, not run. Finding: `README.md` §The split per depth, `lab/av1/bytes/dbt-at-scale`. |
| 96 | **FFDMSCALE** — full-field and synthesized 2D mammography at scale on sound data, FOR PRESENTATION and the 14-bit FOR PROCESSING raw images | done `69bd92e` on `claude/av1-unified` (`31ca887`, `7d5739a`, `52d6c03`) — **HTJ2K for mammograms; where AV1 is used, k = 2 at 10 and 12 bits, and at 14 bits k = 2 at 1× and w10 at 4×**: 39 four-view exams of EA1141, all sound — five per system of FFDM for presentation and of its 14-bit raw on all three systems, five of one vendor's synthesized 2D and four of the other's (all it holds; CMB-BRCA's one, `syn2d_c`, the fifth), 159 images exact in every arm; bytes at `allintra` 7: for presentation AV1's best 0.945–0.992 of HTJ2K on system C, 0.956–1.017 on A, only 0.990–1.003 on B (k = 3; k = 2 1.030–1.043), synthesized k = 2 0.940–0.971, raw k = 2 or 3 0.935–0.975; decode (one median exam a kind and system, 6 rounds, 1 536/1 536 exact) never as fast as HTJ2K — 3.1–3.7× at 12 bits, 1.7× at 10, at 14 w10 1.9–3.9× and the 12-bit top 6.9–8.3×; total time on the same exams (4 rounds, 2 304/2 304 exact over 576 visits) as fast or faster for HTJ2K on every cell but 5 Mbit/s at 1×, where AV1's best is 0.95–1.01, elsewhere 0.99–1.23 at 20 Mbit/s and 1.04–1.61 at 50; cpu0 not run (some 17 hours here); [`lab/av1/bytes/mammography-at-scale`](../../lab/av1/bytes/mammography-at-scale/README.md), `README.md` §The split per depth |
| 97 | **RGBNATIVE** — the colour transform (RCT) against GBR on natively stored, uncompressed colour ultrasound stills | done `2fbab8a` on `claude/av1-unified` (`b2ec90d`) — **the RGB rule holds on sound data, by more than it was sized: RCT is 0.54–0.66 of GBR's bytes and 0.65–0.94 of HTJ2K's**: 48 colour ultrasound stills stored natively, uncompressed, flag `00` (six sets, six CC BY collections, 42 with colour flow), cpu0, every item exact natively and 2 304/2 304 frames in Chromium (dav1d-WASM; `--mutate sample`/`truth` 0 exact); GBR 1.05–1.53 of HTJ2K; RCT decodes in 0.65–0.90 of GBR's time (faster in 96/96 set-rounds) but 2.1–2.9× HTJ2K's at 1× and 1.4–2.3× at 4× (8 rounds); stills, not a cine; why AV1 gains a third over HTJ2K here (4 % on `us_liver`) not measured. Finding: `lab/av1/bytes/colour-transform`, `README.md` §A1 (LLSIZE). |
| 98 | **GOPSCOPE** — the frame-group evidence re-scoped to the AV1 taxonomy and its wording corrected in place; closed rows resting on off-taxonomy content or thin sampling listed for the owner | done `ed4ecb4` on `claude/av1-unified` — **the group evidence that bears on AV1 is four DBT volumes, libaom only, alt-ref off, two presets, G = 8 and 16 alone on three of them**: a Scope paragraph in `README.md` §A1 marks rows 6 and 21 and any CT or MR outside the target series and the ultrasound lossy-sourced; "inter does not pay" narrowed in place in 9 statements over 6 files (`README.md`, `lossless-literature.md`, `lab/av1`, `breast`, `llsize`, `encx`); 17 closed rows listed under the brief for the owner; `check_links.py` green |
| 99 | **GOPTHEORY** — frame groups, phase 1: why inter should or should not help lossless coding of each target type, from primary sources; predictions, protocol and decision rule pre-registered | done `821a368` — **inter can beat intra on noise only where the next frame's noise correlates above ½; on DBT that is predicted not to happen (ρ 0.2–0.5, gain < 5 %), on native ultrasound cine it is (≥ 20 %)**: AV1 lossless keeps every inter tool and changes only the residual (spec §5.9.2, §7.13.3); libaom 3.15.1 still filters its hidden alt-ref in lossless, SVT-AV1 4.2.0 does not; ten predictions P1–P10, ρ measurable before any encode; adopt G > 1 for a type only at ≥ 20 % under intra and ≤ 0.80 of HTJ2K on every sound series, with the mid-group ask inside one HTJ2K decode plus the wire time saved — `gop-theory.md`, the protocol alone in `gop-protocol.md` |
| 100 | **GOPMEASURE** — frame groups, phase 2: row 99's protocol run on the target content available, by a session given only the protocol and the decision rule | done `4306310` on `claude/av1-unified` (`c7def5f`, `0145beb`) — **DBT: G = 1, conclusive by the pre-stated rule**: run in a separate session given only `gop-protocol.md`; ρ on every adjacent slice pair of the 15 sound DBT volumes (top stream, best offset: system medians A 0.112, B 0.215, C 0.117; low stream at the noise floor 0.058–0.061); codings on each volume's middle 16 slices (cpu0 needs ~1 h a 16-slice group here; whole volumes and G ∈ {24, 32, whole} not run, not claimed): libaom `good` 6 alt-ref off, every G > 1 larger than intra on 14/15 (best +1.51 %, `b3` G16), cpu0 best +0.13 %; alt-ref on and SVT-AV1 inter not lossless on the 10-bit tops of systems A and C (aomdec and dav1d agree: the streams are wrong), exact on B, where alt-ref adds 1.2–6.8 points (best +3.19 %) and SVT preset 0 +2.43 %; libaom alt-ref off 159/159 cells exact; decode at 4× every G > 1 4.6–24.6× over the rule's bound (WebCodecs, n = 10, 5 760/5 760 exact). Predictions: P2 and P5 held, P1 not refuted, P3 did not hold, P4 not refuted (its 80 % clause failed), P6 and P7 refuted on system B, P8–P10 not testable (no sound data, §Blocked). Found: dav1d-WASM fails every split group at G > 1 (the low unit decoded on the top's instance with `key: true` flushes its references) — reported, not fixed. Finding: `lab/av1/bytes/frame-groups/README.md`, `README.md` §A1. |
| 101 | **GOPREVIEW** — frame groups, the review: row 99's predictions against row 100's numbers, conclusive or not, and why | done `56e8721` (`490d471` on `claude/av1-unified`) — **conclusive for DBT: G = 1; open for cine, ABUS and angiography for want of sound data**: the mechanism held where it decides (median ρ 0.11–0.22 on every system, far under the ½ inter needs; P2 held, best gain +1.51 %; P5 held, the low stream is independent noise), P1 missed its 0.2–0.5 band on two systems (0.11–0.12) without being refuted, P3 near untestable (14 of 15 gains ≤ 0), P4's 80 % clause failed on gains of 0.1–1.5 %, P6 and P7 refuted on system B (alt-ref on and SVT-AV1 find up to 3.2 % of structure, lossless only on its 8-bit tops), P8–P10 untested; the rule's clause 2 met by three systems of five series. Finding: `gop-theory.md` §4a, `README.md` §A1. |
| 102 | **PUBLICAUDIT** — what a public repository should not carry, analysed for the owner: each item's risk, what depends on it, keep, reword or cut; nothing cut | done `b2b31ba` — **no secret anywhere; one item asks for action outside the repository, nine are reword-or-keep calls**: six branches' trees, 37 tags and 1 990 commits swept for keys, tokens, passwords, addresses, hosts, accounts, personal paths, third-party names, drafts to other projects and archive tags; the rig's public address is still in `claude/av1`'s tree (10 lines, 9 scripts), all 37 tags' trees and 19 commits — re-address the rig or close its ports to the workstation rather than rewrite history; `docs/rig-limits.md` §9's port and root-account detail and the npm scope naming another viewer's SDK (17 files, 20 lines) to reword; vendor citations, identities, 37 tags (23 named for a coding tool), drafts and paths to keep; found on the way: `archive/variants-2026-10-03`, cited 15 times, does not exist (the tag is `archive/arms-2026-10-03`) — the brief's *The audit*, one line under §Blocked |
| 103 | **BB3** — v3's loss bound over BBR built opt-in, and its pre-registered protocol written apart | done `3d59546` on `claude/av1-unified` (`3619991` the codec docs' follow-up) — **built opt-in, unmeasured, its protocol fixed before data**: `--congestion bbr-bound` (`server/src/transport/loss_bound.rs`, a cap over quinn's BBR through the public trait: a round losing > 2 % sets `inflight_hi` := max(in-flight, 0.7 × BDP), the window ≤ 0.85 × `inflight_hi`, regrown 1, 2, 4… packets a clean round), the default still `cubic-restart`; 5 unit tests (4 rules, 1 wiring), 9 mutations each caught; gate green (full, absence checks included); `docs/transport/bb3-protocol.md` (4 cells, 3 arms, the brief's rule); predictions per cost in §1 under BB3 — passes PROF's CoDel cell, ASKL's 4 % and W4b's overrun (≲ 2 600 lost, derived), but not the default: on `l2`/`l5` its cap sits near 0.6 BDP, up to ~1.7 × `bbr`'s fill where the wire is the clock — [`transport-conclusions.md`](../transport/transport-conclusions.md) §1 BB3 |
| 104 | **BB3MEASURE** — row 103's protocol run by a session given only the protocol and the decision rule | done `c822024`, `a083c68` on `claude/av1-unified` (raw `lab/bb3/`) — **the bound fails its rule; `cubic-restart` stays the default, `bbr-bound` opt-in**: cell 1 (7 rounds) 2.27–3.23 % of its packets meet CoDel against 2 % (queue 49.9 ms, fill ×0.933 of `bbr`, both inside), but every `bbr` and `bbr-bound` visit there `VOID`; cell 2 (9 rounds) +375 ms over `bbr` on the 4 % ask p50 against +73, 0/5 rounds lower; cell 3 (7) passes, 927 lost against 3 300; cell 4 6 of 10 rounds (the 5 h budget), 603/1 440 `VOID`, 34 of 44 lossy cells over 1.10 × `bbr` — `docs/transport/transport-conclusions.md` §1, The bound, measured |
| 105 | **CROSSOVER** — where AV1 fills first: a model from the measured bytes and decode times predicting the link speed at which each codec wins, per target series and engine; protocol pre-registered | done `49b2643` on `claude/av1-unified` — **a pipeline model predicts the fill within 0.05 on 44 of rows 95–96's 48 cells (one parameter fitted); AV1 fills first below 45–56 Mbit/s on DBT at 1× and 11–14 at 4× in Chromium, 4–7 and ≤ 2 on FFDM, 15–36 and 4–10 on synthesized 2D, about half that in Firefox; a per-link rule gains < 5 % on phone links except on the two volumes AV1 codes a fifth smaller (13–22 %, a per-series choice)**; misses all at 4× on 50 Mbit (saturation); protocol pre-registered — `docs/av1/README.md` §Where AV1 fills first, a model; `docs/av1/crossover-protocol.md` |
| 106 | **CROSSMEASURE** — row 105's protocol run by a session given only the protocol and the decision rule | done `54c2b57` on `claude/av1-unified` (`ad70d26`; rounds `dcd8303`…`0cc7355`) — **strict and round-paired agree (§Protocol's rule for a host over its bar): 8 762/8 762 frames exact over 1 422 visits, but 44 % `VOID` (35 % fixed, 56 % `lte-good`) and 143 of 192 Firefox 10 Mbit/s dials unsettled leave n ≥ 10 kept pairs on 5 of 60 cells; paired every visit (n = 12 on 48), 50 of 54 cells fall on the predicted side, the misses all `lte-good` (Firefox 1× DBT 1.01–1.03 against 0.99, `syn2ds_b3` Chromium 1× 1.016 against 0.97, `dbts_b4` Firefox 4× 1.29 against 0.87); Firefox 4× runs 0.29–0.77 over prediction on `lte-good`; no series gains ≥ 5 % on a phone link in both engines at both CPUs (`dbts_b4` 13–22 % on all but Firefox 4×), so no per-link rule and no per-series one; `syn2ds_a3` Chromium 1× alone not conclusive on this host (1.010 strict, 1.028 paired)** — `docs/av1/README.md` §Where AV1 fills first, measured |
| 107 | **EVENREVIEW** — rows 103–106 reviewed: predictions against numbers, conclusive or not, and why | done `36ff482` on `claude/av1-unified` — **BB3: conclusive for the decision on cell 2 alone (+375 ms against +73, 8 kept runs), so `cubic-restart` stays the default; refuted the CoDel share (2.3–3.2 %, all-`VOID` visits) and the ask slope, held the fill (×0.933) and the overrun (927 lost). CROSSOVER: both readings agree no per-link rule and no per-series one; sides held on 28/30 Chromium and 17/20 Firefox kept cells, the misses `lte-good`; refuted Firefox's assumed AV1 decode (fitted 2.1–3.3 × WebCodecs', not 1.6–2.2) and the LTE trace as its mean (every 4× cell above prediction); `syn2ds_a3` Chromium 1× and Firefox 10 Mbit/s not conclusive** — `docs/transport/transport-conclusions.md` §1 The bound, reviewed; `docs/av1/README.md` §Where AV1 fills first, reviewed |
| 108 | **HELPERSTART** — the HTJ2K pool's helper started after the decoder answers ready: the cold ask against the single-threaded build, exact | claimed 2026-10-09 (night, 97b754); provisional: round 4 of 10 (n = 5), medians paired by round: cold ask g512 loopback 4× × the pool, ×1.358 helper-after-ready; large warm ask 1× × and ×0.730, 4× × and ×0.624 (raw on claude/av1-unified `ab95ec32`) |
| 109 | **REGIONDECODE** — region decode, the container half: a 1:1 viewport decoded alone, one asked frame in stripes across the idle decoders; exact and container speed | done `b085c15` on `claude/av1-unified` (`95676b2` the harness, `fb4c3ee` the licence) — **not worth a design by §L2's rule; stripes beat today's pool**: OpenHTJ2K v0.19.0 to WASM, 10 rounds, 2 800/2 800 regions, stripes and frames exact; a 1080×2400 viewport costs its rows, not its area (it decodes every block of each row it reaches, 72–84 % of a 3328×4096 frame's block bytes), ×0.82–0.97 of OpenJPH's whole frame there against ≤ 0.40 and ×1.06–1.25 under it; 3 stripes on 3 workers ×0.60–0.68 of OpenJPH at 4× on the large series against ≤ 0.60 (×0.70–0.74 at 1×), ×0.77–0.85 of the pool (10/10); OpenHTJ2K whole ×1.13–1.41 of OpenJPH; L2-P1, P2 refuted, P3 held at 4× only; `docs/decode/README.md` §Region decode, measured |
| 110 | **COARSEPOOL** — the pool's hand-off unit a subband or a resolution instead of a row of code-blocks | done `43627fe`, `81f4e27` on `claude/av1-unified` — **the row unit stays**: §L4's rule fails for both coarser units; frame bench, first 4 frames of `g512` and five breast sets, 10 rounds × 3 passes, 1× and 4×, 1 920/1 920 frames exact, 3 mutants caught on all six sets; × single-threaded: 512² subband ×0.70–0.71, resolution ×0.68–0.70 against the row's ×0.80–0.86 (≤ ×0.80 in 7/10 rounds, resolution 10/10 at 4×); 0.03 under the row on every large series in only 2–7/10 rounds (projections at 1× tie: row ×0.68, subband ×0.69, resolution ×0.70); heap +20–22 MB at 1914×2572 (not ~15) and +54–61 MB at 3328×4096, the subband as costly as the resolution, since OpenJPH pulls every band at once; P1 coarse held, row faster than predicted; P2 row 4/6 held; P3 refuted — `docs/decode/README.md` §A coarser hand-off unit, measured. *The unified branch's gate is red on one path of row 108 to `levers-protocol.md` (not on that branch; row 109 fixed its own) and, in this container, on the viewer check for want of the docker-built decoder (Docker Hub 429).* |
| 111 | **WEBGPUHT** — a WebGPU HT block decoder, built and proved exact on a software WebGPU; no timing | done `5118523` on `claude/av1-unified` (`dd00b9a`) — **L3-P1 and L3-P2 held; the container stage passes: 4 768 of 4 768 frames exact on SwiftShader**, the cleanup pass as two WGSL kernels (MEL/VLC a thread a block, MagSgn a workgroup a block), the 5/3 synthesis and the pack; the 12 synthetic sets and every frame of the 5 breast series, one frame a dispatch (13 dispatches, 1 read-back a frame) and batched (0.15–3.25 and 0.01–0.25 a frame), workgroup scan and `subgroups`, plus 136 frames in mixed batches of all 17 sets; 4 mutants each 0 / 580, the lane check's inverted counts faults; refinement passes not built — no frame here has one; no timing (SwiftShader is the CPU). `docs/decode/README.md` §A WebGPU block decoder, built |
| 112 | **DECODEPACE** — decode paced to the wire during a fill: fill time unchanged, CPU busy time and wake-ups | done `4f3de0c` on `claude/av1-unified` (`fc70cc8`, `e1cac11`) — **the fill holds, the decoders' CPU and wake-ups fall, but the container stage misses its rule on one cell**: `followQueue` on the downloader (off by default, both dispatch clauses tested), the delivered OpenJPH build, whole tomosynthesis 29 × 614×1359 and full-field 4 × 3328×4096, 20/50 Mbit and `lte-good`, 1× and 4×, 16 rounds Williams-ordered, 6 336/6 336 frames exact, 41/384 `VOID`; pace ÷ today paired by round, fill ×0.998–1.002 median a cell (L5-P1 held; P2, full-field 50M 4×, ×1.001, 15/16), decoders' CPU ×0.85–0.98 (P3's ×0.97–1.03 refuted low in 7 of 12 cells: today starts two decoders it never uses), wake-ups ×0.18–0.47 (P4 held); tomosynthesis on LTE at 4× is ≤ ×1.01 in 12 of 16 rounds (strict 8 of 11; the readings agree), its overshoot mostly in the last byte's arrival. Energy not measured; the phone stage waits on phones. `docs/ARCHITECTURE.md` §How many |
| 113 | **LEVERREVIEW** — rows 108–112 reviewed: each lever's predictions against its numbers, conclusive or not, and the phone or GPU measurement each still needs | after 108, 109, 110, 111, 112 |
| 114 | **FMT** — rustfmt and clippy defaults adopted, checked by the gate | after the owner merges main |
| 115 | **FFDIAL** — Firefox's dial through the relay that does not settle on 5–20 Mbit/s links: the cause, and a fix if it is ours | done `4f7e3d2`, `54bfd45` on `claude/av1-unified` — **ours, fixed: the server's early SETTINGS never left for a ClientHello split across two datagrams; Firefox's dial now settles 30/30 on every fixed link, against 0, 4, 12 and 21 of 30 at 5, 10, 20 and 50 Mbit/s before**: Firefox 157's ClientHello is 1 841 B in two Initial datagrams (Chromium 141's fits one); the 0.5-RTT patch started the HTTP/3 driver on the first, its `open_uni` found a stream budget of 0, and quinn-proto 0.11.18 raises the budget from the transport parameters without waking it — the QUIC handshake completes, SETTINGS never go, Firefox holds its CONNECT (RFC 9220 §3) until the 5 s deadline; a slower link spaces the two datagrams further. Fix: the driver starts once the ClientHello is whole (`handshake_data`, one line in the wtransport patch); `a_client_hello_in_two_datagrams_still_gets_its_session` fails without it (no session in 3 s), passes with it. Bare dial, 20 ms each way, 30 rounds Williams-ordered, settled medians 183–200 ms after; SETTINGS now ride the flight's second datagram (217 → 245 B), Chromium's dial ties (87.6 → 87.4 ms, 20/20 each). Gate here: all green but the viewer check (no Docker-built decoder) and row 108's dangling path, both before this row; the missing wake not reported upstream — `docs/transport/transport-conclusions.md` §3 Firefox's dial on a slow link |
| 116 | **TAGCITE** — the 15 citations of `archive/variants-2026-10-03`, a tag that does not exist, point at the one that does | done `66f1ca4` on `claude/av1-unified` — **15 of 15 citations now name `archive/arms-2026-10-03`, 0 cite a missing tag**: 8 files; four cited paths had moved since the tag and now read as they were at it (`client/transport-ts/`, `client/downloader/decoder.js`, `tools/pack-study/`), all 11 `tag:path` citations `git cat-file -e` clean; `claude/av1` cites it only in the queue's record of the finding; `scripts/check_links.py` now fails on a backticked or `git show` archive tag `git ls-remote --tags origin` lacks (outside the two queues), SKIPPED offline, mutated twice to fail. The link step stays at 1 unresolved from row 108's lane (`lab/decode-bench/helper-start/README.md` names `docs/decode/levers-protocol.md`, which is on `claude/av1` only) |
| 117 | **DOCLABELS** — rows 84 and 85's documentation leftovers that need no decision | done `edebcd9`, `ef1b94f`, `cbd9564`, `a981781`, `8982ca8` — **the three product docs and the lab's code comments name the measurement, the label kept as a pointer; eight lab READMEs; each doc's open items in its own §Open**: queue and campaign labels named in `docs/av1/` (10 files), `docs/decode/README.md` (61 → 47 matches, all pointers), `transport-conclusions.md` (~133 bare labels → 0; 18 headings' labels and dates moved to a pointer line), `rig-limits.md`, `disk-access.md`, the codec docs, `FIXTURES.md`, `ARCHITECTURE.md`; 98 lab code files (109 → 23 `row X` hits, the rest pointers, output strings or CLI help); `docs/av1/README.md`, `decode/README.md`, `transport-conclusions.md` §9, `ARCHITECTURE.md`, `CLIENTS.md`, `FIXTURES.md`, `client-window-depth.md` point at their own §Open instead of a queue; READMEs for `clock-resolution`, `decode-tail`, `disk-access-bench`, `early-messages`, `idle-sessions`, `telemetry-bench`, `window-harness`, `worker-leak`; BBR's 12–19× kept in `transport-conclusions.md` §1, `read_ahead_kb` in `disk-access.md` §6, the race's measurement in `ARCHITECTURE.md` and its behaviour in `CLIENTS.md`, each pointed at elsewhere; FoD's two decoders (`parse.ts`, `wire.ts`) are duplicated code, not comments — each now points at `WIRE.md` and the other, not merged (a refactor); no anchor with an inbound link changed; link check 0 unresolved from this row (1 left: row 108's `lab/decode-bench/helper-start/README.md` names `docs/decode/levers-protocol.md`, which reaches this branch with the merge); `scripts/gate.sh --no-browser` OK in 123 s, the contract and downloader browser steps pass, the viewer check fails here only for want of the docker decoder builds (pinned-build refusal, environmental); *left:* labels used as a lab folder's own name (~150, lab READMEs' `§Row …` headings), a few undefined short labels (S14, C4, R1, L19) |
| 118 | **GUARDS** — row 86's check leftovers that need no decision | done `e8a244b`, `6fe5caa` on `claude/av1-unified` — **two stale-build guards and the lab's Go and h3 clients compiled, each mutant caught; gate green in 345 s**: `cellcheck.sh` refuses a transport WASM build older than its sources (exit 2), one `require_transport_wasm` shared with the gate; `deploy/check_equivalence.sh` refuses a web image whose page or nginx files differ from the tree's, by content not time (an mtime guard was built first and failed: a cached rebuild keeps the image's creation time, so a touched file was refused after every rebuild), tested on a real `wt-pacs-web` build: equivalent on 10 paths fresh, refused (exit 2, each file named) on a changed module, template and decoder build, a file added, one removed and no image, passed on a touched file and changed `*.md`/`*.test.mjs`; new gate step `lab: the Go and h3 clients compile` (`go build` in `lab/other-clients/go` and `lab/page-open/h3-host`, `cargo check --locked` in `lab/other-clients/h3`): 2 s warm, about 75 s cold, a syntax error in each of the three caught, `SKIPPED` by name without `go`; cellcheck ALL OK on a fresh build. Gate steps: client unit tests 8 s, contract 19 s, downloader in Chromium 44 s, viewer page 78 s, server tests 77 + 30 + 22 s, the rest ≤ 22 s each. Note: the gate on `claude/av1-unified` fails its link check today on row 108's `lab/decode-bench/helper-start/README.md:5` → `docs/decode/levers-protocol.md`, which is on `claude/av1` only; green with that doc present. Finding: `deploy/README.md` §The checks, `README.md` §Prerequisites. |

## Briefs

### 1 TOOL

Build pinned **libaom** (`aomenc`), **SVT-AV1** (`SvtAv1EncApp`) and **dav1d** (CLI, `-Dbitdepths=8,16`)
from source, `lab/av1/tools/tools.sh` (the way `lab/scripts/gen_htj2k_fixtures.sh` builds OpenJPH). For
each encoder, find the settings that code **mathematically lossless** (libaom `--lossless=1`; check
what SVT-AV1 offers — if it has no lossless mode, say so and drop it) and test a round trip
(encode → `dav1d` → compare against the input's checksum) on synthetic frames from
`lab/scripts/gen_frame_pnm.py`:

* **2026-10-08 05:30 UTC: row 75 LOSSCC is measured twice over, or about to be.** The claim set stale at 03:10
  (`c0a3d8`) was mid-run (13 rounds × 288 visits, ~10 h, no commit until the end); it finished and pushed its reading
  as `3792b24` on `claude/av1-unified` — all three controllers (`cubic-restart`, BBR, plain Cubic) × both codecs on
  row 60's cells with ±5 ms too, 2 879 of 3 312 visits kept, n = 5–13 an arm and cell, 26 496/26 496 frames exact:
  BBR fills in 0.04–0.74 of Cubic's time under 1–5 % loss and is 1.01–1.04 of it on clean 5 Mbit, so not adopted by
  the round's rule; the restart ties plain Cubic. [`../transport/transport-conclusions.md`](../transport/transport-conclusions.md)
  §1 (LOSSCC, first run). Row 75 is claimed again (`ae32e0`), so this session leaves it as it stands; the claim's
  holder, or the owner, decides whether `3792b24` closes it or replicates it.

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
a group — under `client/decode/wasm/dav1d/`. Exact against native dav1d (row 1, or ffmpeg's libdav1d if
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
the decoder module in `client/decode/decoder.js` (or a sibling module it loads); AV1 frames go
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
`av1-webcodecs.js` beside `av1-dav1d.js`, behind the same contract (flush per frame at
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

Row 18: `av1-dav1d.js` with `all_layers` 1 returns the base and then fails on a scalable payload, and
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
without it dav1d holds frames (WCAP's two before `flush()`), and `av1-webcodecs.js` flushes
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
[`licensing.md`](licensing.md) before it is built. Build it pinned in `lab/av1/tools/tools.sh`; code the
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
`av1-dav1d.js` (dav1d-WASM SIMD build of row 4), `av1-webcodecs.js`, the per-layout probe and the fallback to
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
shapes — the decoder seam, `av1-dav1d.js`, `av1-webcodecs.js`, the codec tag, the lab harnesses. Then build
[`payload-format.md`](payload-format.md) end to end, as the owner adopted it: the 16-byte item header, both representations
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
[`payload-format.md`](payload-format.md); the optimized representation as adopted; and the optimized one with row 36's
changes. Every frame exact; fill time and first frame apart. Verdict: per series and cell, what row 36's changes buy
in total time over the adopted representation, and over HTJ2K.

## The bit-split rows (43–45)

The owner, 2026-10-05: every AV1 layout over 8 bits rests on the bit split — a sample v, after the series' offset
(−min), coded as top = v ≫ k and low = v & (2^k − 1), each a lossless stream, merged `(top << k) | low`. Rows 7–42
found it exact on nine real series of 8–14 bits, one of them signed, at k ≤ 4. Prove it at every depth and layout a
rule could pick before the product adopts a per-depth rule (row 33's k = 3 at 13 bits, or row 44's): correctness
first (43), then measurement (44), and the content and depths the lab lacks (45).

**Branch.** The item writer and reader exist only on `claude/av1-unified` (row 39: `ingest/coded-frames/`,
`client/decode/av1*.js`), so rows 43–45 work there: first merge `origin/claude/av1` into it (rows 40–42 and this
queue; it merged without conflict at `0115229`), and push that branch. Findings land on `claude/av1-unified`; only a
row's state is set here, on `claude/av1`. On that branch the timing and browser harnesses still hand the client bare
units (`payload-format.md` §Built): a row that needs one ports it to items first.

### 43 SPLITOK

**Widen the format, not the rule.** `ingest.py` and the reader (`av1-payload.js`, `av1-frame.js`) take grey sources of
b = 8…16 bits after the offset, unsigned and signed, at every split k = max(0, b − 12) … max(b − 8, 4) — from the
smallest k whose top fits a 12-bit stream to a top of 8 bits, which covers every candidate rule (k = 2, k = 3,
k = b − 10) and its ±1 neighbours — plus row 39's RGB shapes (plain G, B, R and `rct`). The refusals this widens
(`split` ∉ {0, 1, 2}, `bits` ≤ 8 with `depth + split` > 8, ingest's "over 14 bits") are restated in `payload-format.md`
in place; what ingest emits by default (plain, optimized) does not change until row 44's verdict.

**Synthetic frames,** per b and signedness, each with a SHA-256 written when it is made: a ramp holding every value
0…2^b − 1 at least once (signed: −2^(b−1)…2^(b−1) − 1; 256×256 holds 2^16), all-zero, all-max, a 0/max
checkerboard, uniform noise, a smooth gradient, the signed extremes, and a pad value at the series minimum under
real-looking data (as the CT's −2048), in a series whose minimum sits in one frame only, so the offset is the series'.
Geometry: 16×16, odd (17×13), 1 pixel wide and 1 high, non-multiples of 8 and 64 (65×127), the largest frame measured
(1914×2572, the 14-bit projections, ~4.9 M samples) and 4096×5120 (a mammogram's). cpu0 up to 256×256; the large
frames at the fastest preset `payload-format.md` uses as well, since a preset changes the tools.

**Every decoder and engine.** Every item through native dav1d (ingest's check), the reader in Node (dav1d-WASM), and in
Chromium, Firefox and WebKitGTK as row 37 ran them (stock builds, `webkit+sab`; port `lab/av1/exact/engines`'s launch to
items): dav1d-WASM in all three, WebCodecs in Chromium where every stream is ≤ 10 bits. In Firefox and WebKitGTK assert
**which decoder ran** for each item — the per-layout probe refusing and dav1d-WASM taking it (row 37: Firefox refuses
monochrome and returns 4:4:4 as 8-bit `BGRX`, WebKitGTK's WebCodecs decodes no AV1) — from a tag the harness reads, not from timing.
A size or depth a decoder or engine refuses is reported by name, not dropped.

**Golden items** for every (bits, depth, split, signed, rct) the matrix emits, beside row 39's 14 in
`client/contract/av1/payloads/`, decoded in Node and Chromium; every refusal of `payload-format.md`, old and new, matched by
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
with the counts N/N; the mutations caught; the format's new limits. Into `lab/av1/exact/coded-frame/README.md` §Checked,
[`payload-format.md`](payload-format.md) and [`README.md`](README.md) §A3.

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
interleaved (row 33's `lab/av1/decode/high-depth`); total time on row 23's harness with row 33's links — 5/20/50 Mbit,
`lte-good`, `wifi-home`, 1× and 4×, Williams order, n ≥ 10, `VOID` dropped, first frame and fill apart. Port `rep14`
and `total` to items first, and show the port reproduces a row 33 cell (the CT's w10 at 50 Mbit, 4×) within its
spread. Say where the host saturates (row 33: dav1d-WASM's decode is the fill's clock at 4× on 50 Mbit, and on 20 Mbit
for the projections) and claim nothing past it; decode-bound cells moved 15–25 % between containers (row 23), so the
ranking is the claim. A long run pushes by rounds, as row 33 did. Verdict: the per-depth layout rule (k for each b),
its bytes and time against HTJ2K and the adopted rule, and the cells where HTJ2K still wins — into
[`README.md`](README.md) §A3 and §Total time, and as a proposal in [`payload-format.md`](payload-format.md): the adopted rule
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
  ≤ 10 bits (`ingest/coded-frames/check.mjs`) — and the verdict says which.
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

**The question (the owner).** The client picks one decoder per item: `client/decode/av1.js` takes WebCodecs only
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

* decode time a frame through `decoder.js` in headless Chromium (row 33's `lab/av1/decode/high-depth`, ported to items as row 44
  does), mixed against both streams through dav1d-WASM (today) and against w10 (k = b − 10, both through WebCodecs);
* total time on row 23's harness (`lab/av1/delivery/total-time`) on the cells where the decoder is the clock — 4× on 20 and
  50 Mbit (row 33) — the same three arms, Williams order, n ≥ 10.

Say where the host saturates and claim nothing past it; the decode-bound cells moved 15–25 % between containers
(row 23), so the ranking is the claim. Verdict: the low stream's share, then mixed against today and w10 per series
and k; whether the flag should become the client's choice is the owner's. Into `ingest/coded-frames/README.md`,
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
   representation, [`payload-format.md`](payload-format.md)); the low bits as their own 8-bit AV1 stream; the offset
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

**Question.** Can the HTJ2K and AV1 decoder workers (`client/decode/decoder.js`, `av1-dav1d.js`,
`av1-webcodecs.js`, `av1.js`, `av1-frame.js`) hand a frame over with no copy, allocate less, and share one decode
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

**Question.** Are the downloader, worker and consumer state machines (`client/transport/downloader.js`, `consumer.js`)
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
[`ARCHITECTURE.md`](../ARCHITECTURE.md) §The downloader and `client/README.md`.

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

**Question.** Can the HTJ2K ingest (whatever drives `ojph_compress` into `common/series-bundle` and `tools/pack-series`)
and the AV1 ingest (`ingest/coded-frames/ingest.py`) be one pipeline that reads, offsets and checks each frame once?
**Why it matters:** ingest cost is paid per study before any phone sees it, and two pipelines are two things to keep
true. **Do:** map each pipeline's passes over the pixels; merge them into one with a codec stage; measure the exact
round-trip check's share and make it cheaper without weakening it (in-process decode, not a subprocess); encode frames
in parallel across processes — never with libaom `--threads` > 1, which changes lossless bytes (row 66). **Decides:**
every output byte identical to today's (SHA-256 a file, HTJ2K and AV1, plain and optimized, on the breast series and
all nine of row 2's sets); wall time and CPU time a study, interleaved, at 1, 2 and 4 workers. **Adopt:** the round's
rule; bytes not identical is a refusal, not a trade-off. **Branch:** `claude/av1-unified`. **Deliverable:** the pipeline,
its numbers in `ingest/coded-frames/README.md` and the ingest's README.

### 53 SEAM

**Question.** Where do the transport, downloader, decoders and page duplicate each other, keep a path nothing reaches, or
decide the codec in more than one place? **Why it matters:** each seam is code a reader has to hold in mind; one
decision in one place is simpler and cannot disagree with itself. **Do:** after row 50 (same files), trace a frame
from `client/transport/ts` through `downloader.js`, `decoder.js` / `av1.js` and `consumer.js` to the page; list each
duplicated check, each dead path (one no product configuration reaches) and each codec decision; remove the dead and
merge the duplicated. A built capability not yet adopted (groups, the preview port) is not dead: list it with its cost
and leave it. **Decides:** lines and modules removed, every clause and dispatch check still passing, and the fill's total
time unchanged within its spread (row 23's harness, 20 and 50 Mbit, 1× and 4×). **Adopt:** the round's rule.
**Branch:** `claude/av1-unified`. **Deliverable:** the change, and what stays and why, in
[`ARCHITECTURE.md`](../ARCHITECTURE.md) and `client/README.md`.

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

**Proposed for `CLAUDE.md` (row 55, the owner's to adopt):** *"**Names.** A name states its role in the domain's words. No word from the project's history — a queue row, a campaign label, a numbered lever — and none that a standard the code touches uses for something else (DICOM's Item; ARM). One concept, one name, defined once in `README.md` §Names."*

### 56 LAYOUT

**Question.** Are folders grouped by responsibility, and is each doc where the repository's rules place it?
**Why it matters:** a reader finds a thing by what it does, not by when it was made; the lab's `lab/av1/` holds one
folder a row. **Do:** after row 55; propose the tree first (what moves, why), then apply it with `git mv`, every
reference and link updated; docs follow `CLAUDE.md` §Docs — extend the file that owns the subject, no file a finding.
**Decides:** the gate green, `check_links.py` green, nothing lost (a file count and content hash before and after).
**Adopt:** the round's rule. **Branch:** `claude/av1-unified`; the queue's own docs here. **Deliverable:** the layout,
and a short map in the doc that indexes the tree.

**The owner's decision, 2026-10-08.** Product dependencies leave `lab/` first, to product folders, each moved once:
the shipped AV1 decoder's build (`lab/av1/dav1d-wasm/`) goes where row 82 puts the decoders' WASM builds
(`client/decode/wasm/`, created here if row 82 has not; all three moved by `7b97026`), the AV1 ingest (`lab/av1/item/ingest.py` and what only it
uses) to a product tool folder beside the HTJ2K ingest's (row 89 builds the one command on it), and the HTJ2K decoder's
fetch (`lab/decode-bench/fetch_decoder.sh`, its `vendor/` output) beside the decoder it serves. Then apply the proposed
tree (`lab/av1/README.md` §The folders) to everything left in `lab/av1/`, with the subject names it proposes. Every
build script, page, test, doc and the gate follows; behaviour unchanged.

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
**Deliverable:** a §Under loss in [`README.md`](README.md) §Total time and `lab/av1/delivery/total-time/README.md`.

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
interleaved. **Adopt:** the round's rule; the item format's change is proposed in [`payload-format.md`](payload-format.md),
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
* run them through `lab/av1/bytes/represented/llsize.py` with its HTJ2K profile, every coding exact;
* record: medians only over paired fixtures; libaom's lossless bytes depend on `--threads` (0.05–0.15 % a frame), so
  the lab's `--threads=1` pin is required, stated where the encoders are; cropping the background moved AV1 ÷ HTJ2K by
  0.8 point; libaom 3.8.2 against 3.15.1 at cpu6 differs by ≤ 0.4 point; u8-scaled copies favour AV1 by 3–6 points.

**Decides:** AV1 ÷ HTJ2K per fixture, paired, plain and optimized. **Adopt:** nothing to adopt; the prior evidence is
corrected in place. **Branch:** `claude/av1` (`llsize` and the fetch are here). **Deliverable:** [`README.md`](README.md)
§Prior evidence, not reproduced here, corrected; `lab/av1/bytes/represented/README.md` and [`FIXTURES.md`](../FIXTURES.md) §AV1 data.

## The closing rows (67–69), 2026-10-07

### 67 CODECSTR

**Question.** `client/decode/av1-webcodecs.js` configures every stream as `av01.0.04M.10` (Main profile,
level 3.0, 10 bits). Our streams include 8-bit grey, 4:4:4 colour (High profile) and frames far above level 3.0's
picture size (a 3 328 × 4 096 mammogram is about 13.6 M samples, level 6.0's range). A browser uses the string to
decide support and to pick a decoder; desktop Chromium's software path tolerates the mismatch, a hardware decoder or
another engine may refuse it or route it wrongly, and the exactness probe would then fall back to dav1d-WASM silently.
**Do:** derive the string from the stream's sequence header OBU (`seq_profile`, `seq_level_idx[0]`, `seq_tier[0]`,
`high_bitdepth`/`twelve_bit`, `mono_chrome`, and the optional fields where they matter), per the AV1 codecs parameter
string (AV1 ISOBMFF binding §Codecs Parameter String). Where the encoder writes level 31 (no level constraint), report
what each engine's `isConfigSupported` answers and choose the value with a reason. Apply it wherever the client and the
lab's WebCodecs paths configure a decoder (`lab/av1/*` probes that sweep strings on purpose stay as they are).
**Decides:** for every AV1 fixture and taxonomy series, the derived string equals one read independently from the
bitstream (e.g. `dav1d --verbose` or a reference parser), `isConfigSupported` is true in each engine row 37 used where
the stream is exact there, every frame stays exact, and the decoder chosen per series is unchanged or explained. Mutate
the derivation (wrong profile, level, depth) and watch the test fail. **Adopt:** the round's rule. **Branch:**
`claude/av1-unified`. **Deliverable:** the change, its test, and the rule in `docs/av1/payload-format.md` or the decoder doc
that owns the WebCodecs path.

### 68 AV1DOCS

**Question.** Are this repository's AV1 docs complete and essential enough to be the one source another project cites?
**Do:** after rows 44, 56 and 67, read every AV1 doc (`docs/av1/`, `lab/av1/**/README.md`, the decode and item-format
docs) and the round's verdicts. One place per subject, extended rather than added to; `lab/av1/README.md` (about 800
lines) cut to what a reader needs, the rest pointed to; diagrams where a mechanism is easier drawn. Terms: the AV1
specification's own words (OBU, temporal unit, sequence header, frame); a DICOM frame is never called an AV1 frame;
row 55's open *item* question is settled as **AV1 payload** — one DICOM frame's AV1 data, the payload header plus its
temporal units — defined once in `README.md` §Names and carried through every doc and identifier it names (file
renames included, every reference updated). A retracted claim is corrected in place, never dropped. **Decides:**
`check_links.py` green, the gate green, nothing lost (each removed passage's fact found elsewhere, listed in the
commit). **Branch:** `claude/av1-unified`. **Deliverable:** the docs.

### 69 MERGEPREP

**Question.** Is the AV1 work ready for the owner to merge into `main`? **Do:** when every other row is done, merge
`origin/claude/av1` (the queue and its docs) into `claude/av1-unified`, resolve, run `scripts/gate.sh` in full, check
`git diff origin/main...claude/av1-unified --stat` for anything that should not ship (fetched data, built binaries,
scratch), and write docs/av1/MERGE.md (written by this row): what the branch adds, what it changes in the HTJ2K path (nothing, or each
change with its measurement), the commands that verify it, and what stays open with its decision. The owner merges;
never push to `main`. **Branch:** `claude/av1-unified`. **Deliverable:** the merge, the green gate, the merge note.

### 70 HTJ2KENC

**Question.** Which HTJ2K encoder settings minimise lossless bytes and browser decode time together: code-block size
(32², 64², 32×128, 128×32), number of wavelet decompositions (3–6), progression order (RPCL, LRCP), precincts, and
whether the library defaults another project uses (`imagecodecs`' HTJ2K encoder defaults) differ from the lab's
`ojph_compress` settings in either? **Why it matters:** every HTJ2K fill pays these bytes and this decode; no row has
swept them. **Decides:** bytes per series and OpenJPH-WASM decode time per frame in headless Chromium (interleaved,
n ≥ 10) on the taxonomy series, every frame exact against the source checksum; the fill's total time on row 23's links
for the best candidates. **Adopt:** the round's rule — a setting changes the shipped codestreams only if it wins on
total time with no loss elsewhere. **Branch:** `claude/av1-unified`. **Deliverable:** the table and the decision in
`decode/README.md` and the ingest's README.

### 71 INGEST1

**Question.** Row 52 found that lossless AV1 bytes depend on `--jobs`: each worker codes its frames in one aomenc run of
keyframes and libaom carries state across them. Does coding one aomenc run per frame make the bytes independent of the
worker count, and at what cost in ingest time and bytes? **Decides:** byte-identical items at 1, 2 and 4 workers on every
series; ingest time and total bytes against today's chunked runs (interleaved, n ≥ 5); every frame exact. **Adopt:**
the round's rule; determinism is required, so the per-frame run is adopted unless it costs more than 5 % in bytes or
doubles ingest time, in which case report and stop. **Branch:** `claude/av1-unified`. **Deliverable:** the change and
its numbers in `lab/av1/exact/coded-frame/README.md` §One pipeline; close row 52's `## Blocked` entry.

### 72 SPLITRULE

**Question.** Row 44 decided the per-depth layout (which k, or w10, at each depth 9–16). What does adopting it take
end to end: the payload header and reader must accept every k the rule picks (today's reader refuses a split above 2,
and the ingest refuses more than 14 bits), the ingest picks k from the series' depth, and the docs state the rule.
**Decides:** every frame exact at every depth 8–16 through every decoder path row 43 covered; golden vectors for each
new layout; the gate green; HTJ2K unchanged. **Adopt:** the rule as row 44 states it. **Branch:**
`claude/av1-unified`. **Deliverable:** the code, the vectors, and the rule in `docs/av1/payload-format.md`.

### 73 EXACTPROD

**Question.** How should a production client prove that every frame it shows is bit-exact, act on a mismatch, and report
it so the server can persist it? **Today:** the ingest hashes each source frame's samples with blake3 into the study
metadata; the client compares only under a switch, and on a mismatch it warns and still paints the frame.
**Options to weigh, each with what it costs and what it protects:**
* *Where to compare:* in the client, where only it can act at once, or on the server, which can only record after the fact.
* *On a mismatch:* decode again with the other decoder, ask for the frame again, mark it, or block its display.
* *Reporting:* failures sent at once with context (study, series, frame, codec, decoder path, codec string, engine,
  device, expected and actual hash); counts of checked frames per decoder path, so failure rates can be computed;
  transport over the open session, or `sendBeacon` on `visibilitychange` — never only at study close, which phones do not
  reliably fire; no pixel data, which is patient data.
* *Persistence on the server.*
* *Sampling:* check everything the first time a browser, device and decoder-path combination is seen, then sample at a rate.
* *Timing:* check before paint or after paint.
* *The hash:* blake3 through WASM against SHA-256 through WebCrypto (native, and maybe faster on phones with SHA
  instructions); fix the defect where a SHA-256 fallback at ingest fails every client check.
**Measure, interleaved:** hashing cost per frame size (512² up to 4 096 × 3 328, 8 and 16 bits) at 1× and 4× CPU,
against decode time; each option's effect on the fill and on the time to the first exact picture.
**Branch:** `claude/av1-unified`. **Deliverable:** a proposal with numbers and a recommendation in `docs/`. Nothing is
adopted; the owner decides.

### 74 XENGINE

**Question.** Why is WebCodecs AV1 not exact outside Chromium, and what would make it exact? **Facts:** Firefox desktop
(≥ 130) and Safari (≥ 17.5, hardware AV1 only, `av01.0…` strings) both expose AV1 in WebCodecs. Row 37 measured that
Firefox refuses monochrome and returns 4:4:4 as 8-bit, that WebKitGTK decodes no AV1 through WebCodecs, and Safari was
never run.
**Part 1, theory from primary sources.** Firefox, from its source (WebCodecs → bundled dav1d or platform decoders):
which output pixel formats it produces and why; whether high bit depth or 4:4:4 is converted or truncated, and where;
whether monochrome is refused, and by which check; whether the configure options, the codec string (row 67's derived
one), `VideoFrame.copyTo` with a `format` option, or a preference change the outcome. WebKit: the same questions for the
hardware path (VideoToolbox) and for WebKitGTK through GStreamer. Result: which of our layouts (8- and 10-bit grey,
10-bit 4:4:4 after the colour transform) each engine could return exactly.
**Part 2, measurement.** In Firefox and WebKitGTK on Linux, test each hypothesis from part 1 with the lab's exactness
harness: every layout and each option, every frame checked against the source hash; mutate the checks. Safari cannot run
here: state what a device run must test, and add it under `## Blocked` for the owner's phone decision.
**Branch:** `claude/av1-unified`. **Deliverable:** findings with sources and numbers in the decode doc. Change the client
only where an engine becomes exact with no regression in Chromium.

## The follow-up rows (75–81), 2026-10-07 evening

### 75 LOSSCC

**Question.** Row 60 found that under loss the congestion controller is the clock (1 % loss turns a 0.62 s fill into
4.0 s and a 153 ms ask into 1.5 s; 5 % gives 12.4 s). Which controller serves a phone on a lossy link best: today's,
BBR, or a Cubic that restarts its window after a silence? **Decides:** fill and single-ask time on row 60's cells
(5/20/50 Mbit, `lte-good`; 0, 1, 2, 5 % loss; ±5/±20 ms jitter; 1× and 4×), HTJ2K and the optimized AV1 payload,
interleaved, n ≥ 10, every frame exact; and the clean cells, where no controller may regress. **Adopt:** the round's
rule. **Branch:** `claude/av1-unified`. **Deliverable:** the table and the decision in `docs/transport/` where the
controller is documented.

### 76 ASKDEADLINE

**Question.** Does the client keep a per-ask deadline of its own (e.g. a fixed timer in the consumer) that fails an ask
the transport is still delivering or re-asking? Under row 60's bursty 5 % loss an ask's p95 reaches 8–15 s. **Do:**
find every client-side timer that can fail a frame; for each, show under row 60's cells whether it fires while bytes
are still arriving; make received bytes the only judge (drop the timer, or restart it on progress), with a test that
fails first and a mutation. **Decides:** asks failed and ask time under loss before and after, interleaved; no change on
clean links. **Adopt:** the round's rule. **Branch:** `claude/av1-unified`. **Deliverable:** the change and its
numbers in the client's README.

### 77 TOTAL4

**Correction, 2026-10-07 (data audit):** the lab's ultrasound sets are lossy-sourced (`us_liver`: Lossy Image Compression `01`, ratio 12.4, DERIVED; `usb_cine*`: MPEG-4 Part 2 clips). Their cells are **provisional** and enter no per-series rule; say so in the verdict.

**Question.** With every change adopted this round in place (row 72's per-depth split, row 67's codec string, row 49's
decoder interface, row 74's GBR read in Firefox), which codec reaches the full exact fill first, per taxonomy series?
**Decides:** total time per series on row 23's links at 1× and 4×, HTJ2K against the optimized AV1 payload, in
Chromium and in Firefox, round-paired, n ≥ 10, every frame exact. **Deliverable:** the table, and a per-series rule the
ingest can apply (which codec a series is served in), stated in `docs/av1/README.md`; adopt the rule in the ingest only
where it wins in both engines.

### 78 HTJ2KMT

**Question.** Row 41 found the HT block decoder is the clock and that only threads inside a frame move it. Can OpenJPH's
WASM build decode one frame's code blocks on several threads (shared memory, a small fixed pool), exact? **Decides:**
decode time per frame for 512² to 4 096 × 3 328 at 1× and 4×, the fill's total time on row 23's links, memory per
worker, against today's single-threaded decode, interleaved, n ≥ 10, every frame exact against the source checksum;
mutate the exactness check. **Adopt:** the round's rule. **Branch:** `claude/av1-unified`. **Deliverable:** the build,
its numbers and the decision in `decode/README.md`.

### 79 COLDRTT

**Question.** How many serial round trips stand between opening the page and the first exact frame on high-RTT links
(100, 200, 300 ms), cold cache and warm, for an HTJ2K study and an AV1 one (whose decoder module loads on the first AV1
payload)? Which of them can go in parallel (`modulepreload`, one bundle per worker, preloading the AV1 module when the
metadata names AV1)? **Decides:** time to the first exact frame and the serial round-trip count, before and after,
interleaved, n ≥ 10; nothing slower on a low-RTT link. **Adopt:** the round's rule. **Branch:** `claude/av1-unified`.
**Deliverable:** the change and its numbers in the client's README.

### 80 GREY420

**Correction, 2026-10-07 (data audit):** this row's 8-bit grey series (`usb_cine`, `usb_still`) are lossy-sourced or of unknown history: adopt only on exactness and Chromium no-regression, never on a byte gain.

**Question.** Row 74 found Firefox's WebCodecs returns 8-bit grey exact only when it is coded as full-range 4:2:0
(+0.07 % bytes). What does serving 8-bit grey that way buy in each engine? **Decides:** bytes, decode time and total
time per 8-bit grey series in Firefox (WebCodecs now possible) and Chromium (must not regress), on row 23's links at
1× and 4×, interleaved, n ≥ 10, every frame exact in both. **Adopt:** the round's rule — only if Chromium's total time is
unchanged within the spread. **Branch:** `claude/av1-unified`. **Deliverable:** the numbers and the decision in
`payload-format.md`.

### 81 SERVERLOAD

**Question.** How many concurrent fills does the server carry before it, not the links, becomes the clock? **Decides:**
each client's fill time and the server's CPU and memory for 1, 2, 4, 8, 16 and 32 concurrent sessions (HTJ2K and AV1
studies, clients on separate cores or hosts so the client side does not saturate first), interleaved; the point where
fill time departs from the single-client figure. Say where the host saturates and claim nothing past it. **Branch:**
`claude/av1-unified`. **Deliverable:** the table and the saturation point in the server's docs.

### 82 CLIENTLAYOUT

**Question.** `client/downloader/` (split by `a4fce87`) holds three things — the page side (`consumer.js`), the download worker
(`downloader.js`) and the decode worker with its codec modules (`decoder.js`, `wasm-glue.js`, `htj2k.js`, the AV1
modules) — and the decoders' WASM builds sit beside the transport's. **Do:** after row 56, move them by worker:
client/decode/ (the decode worker, `wasm-glue.js`, `htj2k.js`, the AV1 modules named by role — `av1.js`,
`av1-payload.js` (the term row 68 fixes), `av1-dav1d.js`, `av1-webcodecs.js` — and the decoders' WASM builds under
client/decode/wasm/, both written by this row) and client/transport/ (`consumer.js`, `downloader.js`, the transports, with the WASM transport's
crate under `client/transport/wasm/`), tests beside their code as today; every import, path, build script, page, doc
and the gate updated; behaviour unchanged. **Decides:** the gate green, `check_links.py` green, `git grep` finds no old
path outside history notes, a content hash of every moved file equal before and after. **Branch:**
`claude/av1-unified`. **Deliverable:** the move and the client's README.

## The team-readiness rows (83–86), 2026-10-07

The owner's reading of another project's clean-up: its organization, terminology and semantics improved the code for
everyone, not only for that project's team. These rows bring the same principles here. They are general; nothing below
names that project.

**The principles.**
* *Names.* A name states its role in the domain's words. No word from the project's history (a queue row, a campaign
  label, a numbered lever, a phase like "early" or "mvp", "arm" for an A/B arm). None that a standard the code touches
  uses for something else (DICOM's *Item* and *Conformance Statement*, the AV1 specification's terms, ARM the CPU). One
  concept, one name, defined once in **one** project glossary that the README links; vendor or upstream terms in their
  own glossary. Environment variables and scripts carry this project's name, not another's.
* *Layout.* Folders by responsibility — in a client, by worker (what runs in the page, in the download worker, in the
  decode worker); each concern's WASM build beside its code, not beside another concern's.
* *Onboarding.* A new developer goes from clone to a running page and a green gate by following the README alone:
  every prerequisite listed and pinned (a toolchain file; tool versions), commands in order with one terminal each for
  long-running servers, every check named with its cost, no personal default paths.
* *Docs.* Lean, formal, diagram-first where a mechanism is hard to follow; no work tracking or history narrative (git and
  this queue hold those); a retracted claim corrected in place; each subject stated once, pointers elsewhere; no
  reference a reader of this repository cannot follow (local paths, private material).
* *Checks.* One entry point runs every suite and prints the claims it skipped (so a fresh clone does not look fully
  green); a formatting check; a guard that refuses to serve a build output older than its sources, naming the command
  that rebuilds it; no tracked file carries a personal path; executable bits match how files are run.
* *Code.* The comment rules of `CLAUDE.md`, plans and "for now" removed from comments, no debug logging, no dead code.

### 83 TEAMAUDIT

**Do:** read the whole repository against the principles, verifying each finding at its line. Read-only. Rows 56, 82 and 68 may still be moving folders and docs: note each finding's path as of your read; rows 84–86 re-locate them.
**Deliverable:** under this row in this queue (not in `docs/`), the findings partitioned by the row that will fix them —
84 (names, glossary, environment variables, folder leftovers), 85 (README onboarding, docs, diagrams, duplicates), 86
(the gate, the stale-build guard, formatting, hygiene, dead code, comments) — each with file:line, and a list of what
needs the owner (decisions only the owner can take), added under `## Blocked`.

**Findings (2026-10-08, read at `claude/av1-unified` `1f49ac3`; paths as of that read).** Grouped by pattern; a count
with examples where one pattern repeats.

*Row 84 — names, glossary, environment variables, folder leftovers*
* One glossary: README §Names (`README.md:141`) mixes definitions with a rename log ("Renamed", "Proposed, not applied",
  "row NAMING") — keep definitions only. Missing there: FoD (never expanded: `common/fod/src/lib.rs:1`, `README.md:110`),
  Media-complete (`server/Cargo.toml:5`, `client/transport/ts/session.ts:2`), SBND, series/study, cell, rig, tile, Tap,
  stream mode, preview, golden item, ring, top/low stream, RCT. No vendor/upstream glossary.
* One concept, several names: the stored series — study / bundle / SBND / the store (`docs/FIXTURES.md:8`,
  `README.md:156`, `--study` `server/src/main.rs:13`, `tools/pack-series`, `common/series-bundle`); the on-demand ask —
  "tile" (`server/src/media/read_path.rs:28,274` `TILE_SLOTS`/`TileReader`, `docs/adr/disk-access.md:13,25`, clashes
  with codec tiles); the fill reader — `SeqReader` (`read_path.rs:115`); `enum Ask` also carries Fill/EndStream/EndSession
  (`server/src/transport/planner.rs:13`); `open_ask`/`--open-ask` against "the opening ask" (`server/src/main.rs:52`);
  `ENVELOPE_LEN` = the display index's 4 bytes against `envelope_len` = the whole envelope
  (`common/frame-envelope/src/lib.rs:5,10`); "exact" for the server, a wire tier and a percentile method
  (`server/src/record/report.rs:6`, `frame-envelope/src/lib.rs:1`); the client's stall timeout — `stallMs` / `quietMs` /
  "silence" (`client/transport/downloader.js:16,33,263`); the last byte — `lastByte` / `lastChunkMs` / `lastByteAt`
  (`client/transport/consumer.js:107`); the recorder — `Tap` / `record/` / telemetry (`client/record/tap.ts:20`); the TCP
  client — transport-ws / `ws` / `OverTcp` / TCP fallback (`client/contract/run.ts:85`, `race-session.ts:8`); the
  downloader worker — "receive worker" (`docs/ARCHITECTURE.md:18`); "harness" for the rig and for `client/harness/`
  (`README.md:163`, `client/harness/shell.js:2`); "client" for the whole stack and for a transport
  (`docs/ARCHITECTURE.md:1`); `epoch` defined twice (`docs/ARCHITECTURE.md:829`, `README.md:158`); "unit" for a group
  (`docs/av1/adr-unit.md:1`) and an AV1 temporal unit; `session-telemetry.ts` emitted as `session.telemetry.js`
  (`client/transport/ts/build.sh:15`); `.j2c` and `.htj2k` (`README.md:93`); `wtpacs` and `wt-pacs`
  (`deploy/check_equivalence.sh:57`, `deploy/Containerfile:24`); `wt_port` also binds the TCP port
  (`server/src/transport/server.rs:53`).
* History words in names: "arm" in the A/B sense — `webcodecsArms` (`client/contract/dispatch-rig.ts:778`), `armFill`
  (`client/transport/ts/frame-session.ts:249`), `read_path.rs:921`, `scripts/gate.sh:66,79`, `deploy/README.md:21,82`,
  `README.md:9`, and the variables `ARMS` (19 reads, `README.md:22`), `ARM_LIST`, `ARM_URL`, `ARM_PID`, `ARM_BIN`,
  `ARM_LOG`, `ARMS_DIR` (`lab/scripts/server_ab.sh`); "phase" (`README.md:135`, `docs/av1/README.md:3`,
  `lab/README.md:20`, `lab/av1/fetch_data.sh:2`); "campaign" (`lab/downloader-cost/`,
  `lab/disk-access-bench/src/bin/read_campaign.rs`, `tools/check-fastpath/src/main.rs:43`,
  `server/src/transport/tuning.rs:166`, `read_path.rs:837`); "exact-tier", "Media-complete … ask-only"
  (`server/Cargo.toml:2,5`, crate `exact-server`); "early" (`patches/wtransport-0.7.2-settings-in-handshake.patch`,
  `scripts/patch_crate.sh:14`); `READ_WINDOW` "the retired 64 KiB read chunk" (`server/src/media/frame_store.rs:15`);
  `.gitignore:34,38,62` ("Tf-axis", "Rung-layout", "The earlier client"); "S4" (`docs/ARCHITECTURE.md:10`), "pre-S2"
  (`docs/adr/telemetry-server-pipeline.md:270,281,300`).
* Campaign and queue labels: 12 lab file names (`lab/scripts/netem_validation.sh`, `e1_saturation_*.sh`,
  `e2_miss_cost_*.sh`, `l3_lossy_link.sh`, `l3_summary.py`, `l7_*`, `n1_netem_calibration.sh`, `s5_split.py`,
  `lab/traces/short_scroll.json`); `lab/scripts/cloud_common.sh:16` (`.local/r2/`); `lab/av1/` folders named for rows
  (`splitok`, `encx`, `llsize`, `rep14`, `wcap`, …) with product comments pointing into them
  (`client/decode/av1.js:13`, `av1-webcodecs.js:51,124`, `av1-payload.js:171`, `av1-frame.js:80`); test and code
  comments `client/contract/dispatch-rig.ts:557,579,797,1388`, `client/harness/shell.js:43`,
  `client/README.md:149,157,160,177`; product docs — `docs/av1/README.md` (96 "row X", headings :541–:871),
  `docs/decode/README.md` (53), `docs/transport/transport-conclusions.md` (FQC, CC1, BB2, BBF, PROF, BB3, LD, IDL,
  W4b, LOAD, GS1, ASKL in headings :123–:1039), `docs/rig-limits.md:43,240,256,258,261,398,517`,
  `docs/av1/payload-format.md:41,94,115,137,154`, `docs/av1/adr-unit.md:3,83,101`, `docs/av1/licensing.md:73`,
  `docs/adr/exactness-in-production.md:3`, `docs/ARCHITECTURE.md:161,241`, `docs/FIXTURES.md:93,161,176,205`; 85 in lab
  code comments (e.g. `lab/av1/exact/codec-string/check.mjs:4`, `lab/av1/exact/split/merge_test.py:3`), 52 campaign labels in 31 lab
  files (e.g. `lab/disk-access-bench/src/bin/read_campaign.rs:34`, `lab/page-open/downloader.html:35`). Fix: name what
  was measured. The working branch named as where something lives: `docs/av1/README.md:8`, `docs/av1/payload-format.md:94`,
  `docs/adr/disk-access.md:679` — a commit.
* Standards' terms: "item" (DICOM Item; 96 uses in 14 docs, `av1-payload.js`, `parseItem`, `client/contract/av1/payloads/`);
  "conformance" (`client/contract/`, `scripts/gate.sh:53,61`, `docs/CLIENTS.md:90`) beside DICOM's Conformance
  Statement; "study" for one series (DICOM Study); telemetry row kinds `interaction`/`preload` for ask/fill
  (`client/record/parse.ts:61,65`).
* Environment variables and paths: `CHROME_PATH` (`client/contract/browser_env.sh:13`, `drive_page.cjs:9`); personal
  defaults `EMSDK=${EMSDK:-$HOME/emsdk}` (`lab/decode-bench/wasm/build.sh:12`, `lab/decode-bench/README.md:29,32`,
  `lab/decode-bench/retained/README.md:16`), `$HOME/.ssh/id_ed25519_rig_agent` (`lab/scripts/cloud_common.sh:12`),
  `~/.ssh/id_ed25519_rig` (`lab/scripts/lossy_link_levers.sh:6`), `/home/ubuntu/wt-pacs` (`cloud_common.sh:14,52,64`,
  `l3_lossy_link.sh:15`), `/tmp/goclient` (`lab/other-clients/README.md:18`), `~/.cache/wtpacs-traces`
  (`lab/av1/delivery/total-time/run.mjs:44`, its README:108).
* Folder leftovers: `lab/fixtures/decode_warmup_{c,c92,g,g277,g512}/` referenced nowhere; `lab/fixtures/queue_large/README.md:1`
  titled `lab_queue_large`; `lab/scripts/cert_chain_cells.sh` referenced nowhere; `lab/av1/decode/mixed/bound.html` named in no
  README; `.gitignore:47-49` (`frames_500x64k`, `frames_500x250k`, a README that does not exist); the unapplied
  `docs/transport/upstream-quinn-ack.patch` beside the applied ones (its draft:
  `docs/transport/upstream-quinn-ack.md:81`); the study-bundle format the server reads lives in `ingest/`
  (`common/series-bundle/src/format.rs:1`, read by `server/src/media/frame_store.rs:8`) — `common/`.

*Row 85 — README onboarding, docs, diagrams, duplicates*
* Prerequisites (`README.md:5-18`): no `rust-toolchain.toml` (`patched/wtransport/Cargo.toml:6` needs 1.88), no Node
  pin (`.nvmrc`/`engines`; the image uses 22, `deploy/Containerfile:31`), Python unpinned; Linux not stated though io_uring
  is a default feature (`server/Cargo.toml:16`); `wasm-pack` and `playwright` installed unpinned (`README.md:15-16`);
  unlisted: openssl (`server/scripts/gen_dev_cert.sh:10`, `client/contract/run_wire.sh:20`), curl, patch, tar,
  sha256sum (`scripts/patch_crate.sh:42,49`), binutils `nm`/`strings` (`server/scripts/check_telemetry_absent.sh:22`,
  `client/scripts/check_worker_safe.sh:13`), cmake and a C++ compiler (only in a comment, `README.md:91`), llvm-tools
  (`scripts/pgo_build.sh:130`), podman or docker, Chrome and its minimum version (`README.md:70`), network for
  `npm install` on first build (`client/transport/ts/build.sh:9`); the AV1 build's git, ninja, Emscripten download
  (`client/decode/wasm/dav1d/build.sh:22-38`) and who needs it (`README.md:22-23`). Image bases float
  (`deploy/Containerfile:7,31,38`).
* Order and steps: the gate is never a numbered step and exits 2 before the WASM `pkg/` exists, built only at
  `README.md:49` (`scripts/gate.sh:22`); step 3 rewrites the tracked `fixtures/us_cine_smoke/us_cine_smoke.sbnd`
  (`README.md:55-59`); the dev certificate's 10 days and fixed port unsaid (`gen_dev_cert.sh:13,32`); the c512 block sits
  outside its list item (`README.md:90-101`); `scripts/cellcheck.sh` and `deploy/check_equivalence.sh` have no cost or
  place (`README.md:103-108`); `CLAUDE.md:63-64` omits `--no-browser`; `lab/README.md:1-21` has no prerequisites
  (`requirements.txt`, emsdk, sudo for netem).
* Costs and history in the README: per-check costs missing; the gate's before → after timings ("row GATE",
  `README.md:25-30`) and the mutant table (`README.md:35-43`, also `client/README.md:177-212`) are history.
  `README.md:110-115` restates WIRE and ARCHITECTURE. `README.md:134-137` maps docs to work queues and "older campaign
  evidence"; `README.md:186-193` Provenance (owner, below).
* Product docs that depend on the queues: `README.md:134`, `docs/ARCHITECTURE.md:580`, `docs/CLIENTS.md:316`,
  `docs/adr/client-window-depth.md:307` (cloud queue §Open owner decisions); `docs/adr/exactness-in-production.md:4`,
  `docs/av1/README.md:6,77,96,858,933`, `docs/av1/series.md:3,22,187`, `docs/decode/README.md:1635`,
  `docs/FIXTURES.md:175` (this queue) — each owning doc's §Open.
* History narrative: `docs/transport/transport-conclusions.md` (63 dates, dated headings :100–:1039),
  `docs/adr/disk-access.md:116-127` and dated headings :461–:674, `docs/av1/README.md:27-541`,
  `docs/decode/README.md:1083,1088`, `docs/rig-limits.md:14,556-569,613-627`, `docs/ARCHITECTURE.md:692`,
  `docs/FIXTURES.md:205`, `deploy/README.md:76,79-87,99-102,113-122`, `client/README.md:37-44,74-99,128,145,149-167`
  (measurements belong in docs/), lab comments with dates (`lab/downloader-cost/page.js:3`, `throttle.mjs:78`,
  `lab/disk-access-bench/src/main.rs:51,1489,1619`, `src/bin/server_ab.rs:54`, `lab/scripts/controller_cells.sh:3,5`,
  `radio_link_cells.sh:4`, `lab/decode-bench/parity.mjs:81`, `lab/scripts/lossy_link_levers.sh:20`).
* Duplicates: the race (`docs/CLIENTS.md:78-89`, `docs/ARCHITECTURE.md:982-986`); BBR 12–19×
  (`transport-conclusions.md:176`, `docs/rig-limits.md:205`, `docs/av1/README.md:824`); the gate's steps (`CLAUDE.md:60-63`,
  `README.md:7-30`, `docs/CLIENTS.md:180`); `read_ahead_kb` (`docs/adr/disk-access.md:246,295`, `docs/rig-limits.md:346`);
  the quick start (`client/README.md:216-222`); FoD's decoder (`client/record/parse.ts:8` against
  `client/transport/ts/wire.ts:3`); the two image ignore files kept equal by hand (`deploy/README.md:89-91`).
* Stale or uncorrected: `docs/adr/reject-server-cancel.md:87,103` (a banner only, :6);
  `docs/adr/frame-framing-and-loop-shape.md:3` "open" though built (:150, :240, :260); `docs/rig-limits.md:13` "eight
  limits", §8 lifted (:508); `docs/av1/adr-unit.md` not in `docs/adr/README.md`; `lab/README.md:9-20` omits
  `server-load/`; `lab/av1/README.md` §The folders omits `htj2kenc/`, `htj2kmt/`, `xengine/`; 8 lab folders without a
  README (`clock-resolution`, `decode-tail`, `early-messages`, `idle-sessions`, `worker-leak`, `window-harness`,
  `disk-access-bench`, `telemetry-bench`); `lab/scripts/gen_live_cell_fixture.sh:40-41` writes a dangling "§0b" and one
  rate for every size into 10 fixture READMEs; `docs/FIXTURES.md` omits `client/contract/av1/**` and its generators;
  `docs/CLIENTS.md:8-12` omits `downloader/`, `harness/`, `record/`, `scripts/`; `client/transport/downloader.js:424`
  "the proposal" names no doc; `deploy/nginx/wt-pacs.conf.template:2` garbled.
* Diagrams: an ask during a fill (`docs/WIRE.md:105`), session survival (`docs/ARCHITECTURE.md:752-890`), session open's
  round trips (`docs/ARCHITECTURE.md:547`), the read path (`docs/adr/disk-access.md:333-365`), the item's byte layout and
  the split (`docs/av1/payload-format.md:10`, `README.md:162`), the client's folders by worker.
* Lab duplication: `inChromium` copied in 23 files (e.g. `lab/av1/decode/worker/run.mjs`, `lab/av1/decode/per-frame/speed.mjs`),
  `write_y4m` in 10 bodies and `ivf_units`/`read_pnm`/`read_y4m` in 4–5, `arg`/`med`/`sha256` in 46/51/12 files,
  `make_frames.py` 16 copies.

*Row 86 — the gate, the stale-build guard, formatting, hygiene, dead code, comments*
* The gate's report: "GATE OK" (`scripts/gate.sh:97`) with no recap of what it skipped — the AV1 dispatch clauses
  (`client/contract/dispatch-rig.ts:874,899`, 128 of 719 checks), the golden items (`av1.test.mjs:291`), the io_uring
  tests that `eprintln!("skipped…")` and pass (`server/src/media/read_path.rs:930,981,1019,1046`,
  `uring_reader.rs:196,231,265,292,335`), `client/scripts/check_telemetry_absent.sh:25,31,38` skipping silently,
  `cellcheck.sh` and `deploy/check_equivalence.sh` never run; `| tail -N` hides failures (`gate.sh:42-48,54,84`); no
  per-step time; `nm` not checked up front.
* Not run or not compiled: `pack-study`, `check-fastpath` (`gate.sh:70-80`); `lab/other-clients/h3`, the Go modules
  `lab/other-clients/go`, `lab/page-open/h3-host`; `lab/av1/exact/split/merge_test.py` (pure numpy, tests ingest's split);
  `ingest/coded-frames/check.mjs`, `lab/av1/exact/codec-string/check.mjs` (SKIPPED without the AV1 build); the record tests are never
  type-checked (`client/record/tsconfig.json:13`).
* Formatting: no `cargo fmt --check`, clippy, JS/TS formatter, shellcheck or config; 29 product lines over 120 characters
  (e.g. `client/decode/av1-frame.js:32`, `av1-payload.js:36`).
* Stale-build guard: only `transport-wasm` (`gate.sh:22-23`); none for `lab/.av1-build/out/simd.wasm`,
  `client/contract/run_browser.sh:16`, `client/scripts/check_worker_safe.sh:16`,
  `client/scripts/check_telemetry_absent.sh:13-14`, `server/dev-server.py:12`, `scripts/cellcheck.sh:174`, the image
  (`deploy/Containerfile:41`).
* Hygiene: `server/dev-server.py` and `lab/scripts/lossy_link_summary.py:6`, `l7_summary.py:4` have shebangs at 100644; 86 lab
  `.py` with a shebang at 100644 run through `python3`; `lab/scripts/cloud_common.sh` 100755 but only sourced;
  `.gitignore:12-13` and `:51,71` duplicates; `.cargo/config.toml:1-6` the same rustflags twice;
  `patched/quinn/Cargo.toml:5-14` generated boilerplate; `deploy/check_equivalence.sh:10` `set -u` alone;
  `scripts/check_links.py:11` omits `common/`, `ingest/`, `tools/`, `patches/`, `patched/`, `fixtures/`;
  `docs/CLIENTS.md:85` a link as plain text; `client/contract/run_wire.sh:3` unwrapped.
* Comment budget's reach: `scripts/comment_budget.sh:24` counts `*.test.mjs` (tests are exempt) and never `.sh`, `.py`,
  `.c`, `.go`, the Containerfile, Cargo.toml, the nginx template or inline `<script>`; three shell scripts would be over
  0.18 (`lab/scripts/gen_htj2k_fixtures.sh`, `lab/av1/delivery/scalable/client/make_frames.sh`, `lab/scripts/runtime_ab.sh`).
* Comments: numbers in product comments (`read_path.rs:116-117`, `server/src/transport/server.rs:205`, `server/src/record/tap.rs:89`,
  `deploy/nginx/wt-pacs.conf.template:34`); narrative module docs (`server/src/record/report.rs:1-12`, `sink.rs:1-8`,
  `tap.rs:1-5`, `read_path.rs:1-6`, `server/src/main.rs:105-106`, `client/scripts/check_worker_safe.sh:2-3`,
  `client/record/report.ts:66`, `client/record/install.ts:1` "option G", `client/decode/htj2k.js:1` a bare filename);
  quinn's defaults stated twice (`server/src/main.rs:25-29`, `tuning.rs:31-42`); test text telling history
  (`server/src/transport/restart.rs:258`, `read_path.rs:879`, `stream_mode.rs:49`).
* Dead code and logging: `touch_frame_pages_if_cold` behind `#[allow(dead_code)]`, no caller
  (`lab/disk-access-bench/src/rejected_access.rs:74-80`); `install.ts:23,26`'s `transport-wasm` branches, nothing installs
  the recorder there (`client/harness/shell.js:34`); `ack_us` and `server_work_us` in the absence check match nothing that
  exists (`server/scripts/check_telemetry_absent.sh:22,24`); exports used only in their own file
  (`client/record/proxy.ts:31,80,84,106,110,152`, `client/record/report.ts:70,91`, `parse.ts:17`); a line logged
  twice (`client/harness/shell.js:184,203`); undocumented `DEBUG` logging (`lab/session-survival/run.mjs:55-60`). No
  TODO, FIXME or "for now" anywhere; no debug logging in product code.

*The owner's* — under `## Blocked`, 2026-10-08 03:55 UTC.

### 84 NAMES

**Do:** row 83's 84-list: renames with every reference, the one glossary (merging any project terms kept in a codec or
other doc), environment variables, folder leftovers. Behaviour unchanged. **Decides:** the gate green, `check_links.py`
green, `git grep` finds no old name outside history notes. **Branch:** `claude/av1-unified`.

**The owner's decision, 2026-10-08: every rename row 83 proposed (§Blocked, *Renames*) is adopted**, with every
reference: one frame's coded data, any codec, is a *coded frame*, and AV1's is the *AV1 payload* (row 68); "arm" →
"variant" (the lab, its variables, `CLAUDE.md` §Measurement); the telemetry schema's `arm` → `client`, its row kinds to
ask/fill, the always-null fields dropped; `exact-server` and "exact-tier" by role; "study" → "series" where it means one
series (`--study`, `pack-study`, `study-bundle`); "conformance" → the transport contract suite; "early" out of the patch
name; "Media-complete" defined once or renamed. The glossary gets its own file, docs/glossary.md, linked from the
README; the Names rule (row 83's principles, *Names*) goes into `CLAUDE.md`. What a public repository carries and
which rule governs are not this row's: row 102 analyses them for the owner.

### 85 ONBOARD

**Do:** row 83's 85-list. Prove onboarding by doing it: a fresh clone in a clean container, the README followed
literally, to a running page and a green gate; every step that failed is fixed in the README, not worked around.
**Decides:** that run's log; `check_links.py` green. **Branch:** `claude/av1-unified`.

### 86 CHECKS

**Do:** row 83's 86-list. Mutate every new check and watch it fail (a stale build refused, a skipped claim reported, a
personal path caught). **Decides:** the gate green, each mutation caught. **Branch:** `claude/av1-unified`.

## The product rows (87–93), 2026-10-07

The owner, 2026-10-07: this repository becomes a complete, independent product, not only a lab. A person can open a
study and read it, and an operator can deploy it. These rows build what that needs and the lab does not have yet.
Each is re-derived from public standards and from this repository's own measurements. The order: the painter (87),
the exactness check (88) and the ingest (89) come before the viewer page (90). The decoder builds (91) and the viewer
come before the deployment (92). The codec docs (93) follow row 68's AV1 docs.

### 87 PAINTER

**Question.** The client hands decoded frames to no renderer. `docs/ARCHITECTURE.md` §Paint says the paint path is
not built into the product, and §Open lists the paint sink. What is the simplest painter that draws a decoded frame
in a worker, as the DICOM grayscale pipeline defines it, and how is it proved? (This row does not wait for row 82: put the painter in its own folder, `client/paint/`, and touch no file row 82 moves.)

**Why it matters:** a product must put frames on screen. `lab/paint-floor` measured the WebGL2 route at 0.34 ms a
512² paint against 7.55 ms for canvas 2D, inside one 60 Hz frame at 12.58 Mpx. Nothing ships it.

**Do:** start from `lab/paint-floor/routes.js`'s `WebGL2Route`. Build one module: a page half that places a canvas,
calls `transferControlToOffscreen` and answers each paint with one promise, and a worker half that does the WebGL2.

* **Input.** The frame exactly as the consumer receives it (`pixels` in a `SharedArrayBuffer`, `width`, `height`,
  `bits`, `components`, `signed`). Upload it to an integer texture (`R8UI`, `R16UI`, `R16I`, `RGB8UI`) straight from
  shared memory, with no copy on either thread. Skip the upload when the same frame is painted again.
* **The grayscale pipeline, from DICOM PS3.3 2026d**, cited by section in the code's doc pointer and the README:
  * the Modality LUT as rescale (C.11.1): x = stored × slope + intercept. A missing, zero or non-finite slope counts
    as 1, a non-finite intercept as 0.
  * the VOI LUT Function (C.11.2.1.2): LINEAR, LINEAR_EXACT and SIGMOID, with the window centre and width in modality
    units and an output range of 0–255. A width the function does not allow (LINEAR needs ≥ 1, the others > 0) is
    refused by name.
  * MONOCHROME1 shown inverted (C.7.6.3.1.2), and a user invert on top.
* **The window table.** Evaluate the pipeline in float64 on the CPU, once per (window, rescale, function, invert),
  into a table indexed by stored code: 256 entries for 8 bits, 65 536 for 16, a signed code offset by 32 768. State
  how a real output becomes an 8-bit code (the rounding and the clamp) and use it in both implementations. The
  shader only indexes the table.
* **Colour.** RGB takes no VOI (the module applies to grayscale) and is shown as stored; invert is allowed. Any other
  photometric interpretation is declined by name.
* **Placement.** Pass 1 windows the frame through the table into an RGBA8 texture at source size (`texelFetch`).
  Pass 2 draws one quad that samples it with `LINEAR` and `CLAMP_TO_EDGE`. WebGL2 cannot filter integer textures, so
  the bilinear filter needs the 8-bit picture.
* **Geometry.** Fit to the canvas, zoom, pan (fractional), quarter-turn rotation, horizontal and vertical flip, and
  opaque black outside the image. The backing store is in device pixels (CSS size × `devicePixelRatio`).
* **No WebGL2, or a lost context.** The painter says so (`lost` and the reason) and draws nothing. There is no
  fallback renderer.
* **An independent reference.** Write the same contract a second time on the CPU, in plain JS: its own geometry, its
  own bilinear in float64, and the window table built by its own call. Correctness of the formula is anchored apart:
  unit tests of each VOI function against values worked by hand from the standard's equations, at the boundaries
  (x on each edge of the window, the smallest width each function allows, a negative intercept, a signed 16-bit
  input).
* **The harness.** Frames from `lab/scripts/gen_frame_pnm.py` with their `.sha256`: 8-bit RGB, 8-bit grey, 16-bit
  unsigned, 12-bit signed CT, one shown as MONOCHROME1, one of odd width and one not square. The cells: identity, a
  tight window, each VOI function, invert, each quarter turn, each flip, rotate-and-flip, a whole-pixel pan, a
  fractional pan, fit, zooms 2, 0.5 and 1.37, at DPR 1 and 2. `check` prints the renderer string first and fails any
  cell that differs by one code anywhere, edge included.
* **Mutants**, each seen to fail where its cell runs:
  * `NEAREST` in place of `LINEAR`;
  * the quad moved by 1/512 px;
  * the rounding turned the other way;
  * the window applied after the filter;
  * the signed offset dropped;
  * MONOCHROME1 not inverted;
  * LINEAR and LINEAR_EXACT swapped;
  * the −0.5 of LINEAR dropped.

**Decides:**

* On the cloud's software renderer (SwiftShader; the cloud has no GPU), every zoom-1 cell equals the reference to
  the code: every rotation, flip, whole-pixel pan, window, depth and DPR.
* The fractional cells are reported as measured differences (the largest |Δ| and the fraction of samples that
  differ), not claimed.
* Each mutant is caught, or the row says which ones need a fractional cell, and so a GPU, to be caught.
* The VOI unit tests pass.
* The paint's cost, in the worker and on the page's main thread, for a 512² frame and a 4096×3072 16-bit frame, on a
  new frame and on a window change. Interleaved, n ≥ 10, named as the software renderer's.

**The GPU proof is a later local step.** The README gives the exact command that runs every cell on a hardware
renderer (`--renderer gl`) and what must hold there. Until that run, it says the fractional zooms are unproved.

**Adopt:** built as the product's paint sink. Update `docs/ARCHITECTURE.md` §Paint and §Open: the paint sink is
built; the cache seam is still open.

**Branch:** `claude/av1-unified`.

**Deliverable:** the module (in the folder row 82's layout gives the page side), its harness, its mutants and its
README: the contract, the formula with its PS3.3 citations, what is proved on which renderer, and the GPU command.
Run the zoom-1 check in `scripts/gate.sh` if it fits row 54's budget, and state its cost.

### 88 EXACT

**Question.** `docs/adr/exactness-in-production.md` (row 73) proposes three steps, and nothing of it is built:

1. ingest writes each frame's XXH3-64 of its stored samples into the study's metadata;
2. the decoder worker hashes every frame before handing it on, and compares;
3. a mismatch is decoded once more on the other path and is never shown as exact.

What do steps 1–3 cost and protect through the product's own path?

**Why it matters:** bit-exact is the rule every codec here is held to. Today only the lab checks it, against `.sha256`
files beside its sets. A served frame carries no proof.

**Do:**

1. **A digest writer**, which `ingest/coded-frames/ingest.py` calls now and row 89's ingest after it. The digest is XXH3-64
   (16 hex digits) of the frame's samples exactly as `decodeFrame` hands them on: little-endian, colour interleaved,
   signed samples sign-extended to 16 bits. It goes into `metadata.json` as a per-frame array, with the algorithm
   named. When the metadata has no digests, nothing is checked and the client says the frames are unchecked.
2. **The check in the decoder worker.** A WASM XXH3, added with its licence to the licensing doc before it is used.
   It hashes each decoded frame, and the frame message carries `exact: true`, `false` or `unchecked`. The downloader
   carries it, the consumer puts it on `frame.info`, and `stats()` counts it per decoder path.
3. **On a mismatch,** decode once more: an AV1 payload through the other AV1 decoder, an HTJ2K codestream through a
   fresh decoder instance. Mark the frame exact only if that passes. Otherwise deliver it with `exact: false` and
   the reason, and count it. Do not ask the server again: QUIC authenticates every byte, so the same bytes come back.

Reporting to a server (the ADR's §5) stays proposed, not built.

**Decides:**

* The fill's time and the time to the first exact frame through the downloader, check on against off, on row 23's
  links at 1× and 4×, for the ADR's four series (MR, fluoroscopy, projections, mammogram). Interleaved, n ≥ 10, every
  frame `exact: true`.
* `exact: true` in Chromium and Firefox through every decoder path (OpenJPH, WebCodecs, dav1d-WASM).
* Mutants:
  * one sample changed after the decode gives `exact: false`, and the second decode is attempted;
  * the digest's byte order, or the sign extension, changed at ingest makes every frame `false`;
  * a frame without a digest is `unchecked`, never `true`.

**Adopt:** on by default wherever the metadata carries digests, if the fill does not move beyond the spread at 1× and
moves by no more than the ADR's measured bound (≤ 15 %) at 4×. Otherwise the check is built behind a consumer option
that defaults to off, and the trade-off goes under `## Blocked` for the owner. Update the ADR's status in place.

**Branch:** `claude/av1-unified`.

**Deliverable:** the code, the numbers in the ADR (a §Built), and the digest's format in `docs/FIXTURES.md` and the
client's README.

### 89 INGEST

**Question.** This repository serves generated studies and the lab's pinned sets. Those go `lab/av1/fetch_data.py` →
raw planes → `ingest/coded-frames/ingest.py` → `pack-study`. There is no product command from a DICOM file or folder to a
served bundle. Its metadata carries no display attribute, so no page can window a CT, invert a MONOCHROME1 frame or
run a cine at its frame rate. Close those gaps, nothing else.

**Why it matters:** a product reads the studies its users have, not only the lab's.

**Do:** write a product ingest (under `ingest/` or `tools/`, in Python, with pydicom and numpy pinned). It moves the
encode-and-check core of `ingest/coded-frames/ingest.py` into the product. The lab imports it from there and keeps no copy.

* **Input.** One multi-frame object, or a folder of single-frame objects of one series. A file whose SeriesInstanceUID,
  rows, columns, bits or photometric interpretation differ is refused by name.
  * Single-frame objects are sorted by InstanceNumber; a tie is refused by name.
  * Transfer syntaxes: native, and the lossless encapsulated ones that pydicom decodes with pinned plugins. A lossy
    one is refused by name: its samples are not the original's.
  * Samples are extracted as `fetch_data.py` does: little-endian, colour interleaved, PlanarConfiguration honoured,
    signed samples sign-extended.
* **The metadata, per series, and per frame where it varies.** Enhanced multi-frame objects' Shared and Per-frame
  Functional Groups are read too (Frame VOI LUT, Pixel Value Transformation). The attributes:
  * Rows, Columns, BitsAllocated, BitsStored, HighBit, PixelRepresentation, SamplesPerPixel and
    PhotometricInterpretation;
  * RescaleSlope and RescaleIntercept;
  * WindowCenter and WindowWidth (every value, the first the default) and VOILUTFunction;
  * FrameTime or CineRate, and Modality;
  * row 88's per-frame digest.

  **No patient or study identifier is copied** (no name, ID, birth date, accession number or UID). The bundle is
  keyed by its file name.
* **The codec per series.** `--codec htj2k|av1|auto`. `auto` applies the per-series rule row 77 states in
  `docs/av1/README.md`, or HTJ2K when row 77 adopted none. The AV1 preset defaults by content from row 14's table
  (the fastest within 2 % of the slowest's bytes) and can be overridden.
* **Exact at ingest**, as now: every codestream decoded back in-process and compared with its source, and nothing
  written unless every frame passes; a failure names its frame. The encoder and decoder binaries are refused unless
  they report the pinned versions.
* **One command** writes the `.sbnd` and its `metadata.json`.
* **Several series of one study.** Propose in `docs/FIXTURES.md` how such a study would be served; today a server
  process serves one bundle. Do not build it: it changes what the server serves.

**Decides:** on the lab's pinned CC BY sets (`lab/av1/data.json`), using a single-frame signed CT series, an RGB
ultrasound cine, an enhanced multi-frame tomosynthesis volume and a mammogram:

* every frame's samples byte-identical to `fetch_data.py`'s `NNN.raw` of the same file, an independent path;
* every display attribute equal to an independent reader's (DCMTK's `dcmdump`, pinned);
* bundles byte-identical at `--jobs` 1, 2 and 4;
* every frame exact through the client (`ingest/coded-frames/check.mjs` and a fill);
* mutants, each failing a named test: the sort reversed, PlanarConfiguration ignored, the sign not extended, the
  per-frame window taken from the shared group, a lossy transfer syntax accepted;
* ingest time a frame against today's two-step path, interleaved, n ≥ 5: no slower beyond the spread.

**Adopt:** the product's ingest.

**Branch:** `claude/av1-unified`.

**Deliverable:** the tool, its tests, and `docs/FIXTURES.md` §From DICOM: the command, what is read, what is refused
and why, and the metadata's schema.

### 90 VIEWER

**Question.** There is a client but no page a person can read a study with. `client/harness/` checks frames and runs
lab cells. What is the smallest viewer page on the product's own downloader (metadata → fill → exactness → paint, with
step, cine and a status line), and a check that fails anything short of a complete, exact, drawn page?

**Why it matters:** this is the product's face. It is also the only end-to-end proof that the transport, the
decoders, the exactness check and the painter work together.

**Do:** one page (HTML and one module, in the client folder row 82's layout names), served at `/` by
`server/dev-server.py` and by the nginx template.

* **The page head.** Request `/study/metadata` and `/wt/dev-transport.json` as promises, and call
  `DownloaderClient.connect` at once with the whole series as the opening fill. Preload the decoder modules and WASM
  that the metadata's codec needs, as `lab/page-open/codec.html` does (row 79). Boot the painter (row 87) in
  parallel.
* **Frames.** Keep them in memory by index; the cache seam stays open (ARCHITECTURE §Open). Paint the current frame
  when it arrives. A step to a frame not yet arrived asks it (`requestExactFrame`), ahead of the fill.
* **The on-demand mode** (`?fill=0`). No fill: each step asks its frame, and during a step only the newest ask is
  kept.
* **Exactness.** Each frame carries row 88's `exact`. A frame that is not exact is shown marked as such and counted,
  never shown as exact.
* **Controls.** The wheel and the arrow keys step. Space or a button runs the cine at the series' FrameTime or
  CineRate, or else 10 frames a second. A pointer drag moves window and level, starting from the metadata's
  default, or from the frame's decoded range when the metadata has none. Zoom, pan, quarter turn, flips, invert and
  reset are on keys and the pointer. Pointer events, so touch drags work too.
* **The status line.** Frame i of n; frames received, exact, not exact and unchecked; the decoder per path; the
  codec; the renderer, saying so when it is software; the fill's time; any error by name.
* **The dev certificate.** `server/dev-server.py` makes it when it is missing or ends within a day (a new
  `gen_dev_cert.sh --if-needed`).
* **The page check** (Node and headless Chromium; `--url` drives a host already running, for row 92). It runs the
  protocol: the fill, an ask of a delivered frame, a fill cancelled at once, then an ask after the cancel. It fails:
  * a fill that did not complete, or a frame lost or refused;
  * any frame not exact;
  * a decoder other than the one `--decoder` names;
  * an HTJ2K page that fetched AV1 code, or an AV1 page whose frames were not decoded as AV1;
  * a readback of the first, middle and last frame that differs from row 87's CPU reference at zoom 1;
  * the cross-codec arm: the same series ingested as HTJ2K and as AV1 must paint byte-identical readbacks.

**Decides:**

* The page's fill time against `client/harness/cell.html` on the same study (the viewer may add nothing to the
  clock), and the time to the first exact frame on screen. On row 23's links at 1× and 4×, an HTJ2K and an AV1
  series, interleaved, n ≥ 10.
* The page check green in Chromium and Firefox on a windowed signed CT, an RGB cine (with the cine run) and a
  tomosynthesis series, each ingested by row 89.
* Each failure the check names is seen to fail it by mutation: a frame dropped, a sample altered, the wrong decoder
  forced, AV1 code fetched on an HTJ2K page, a frame painted off by one row.

**Adopt:** the viewer is the product's page.

**Branch:** `claude/av1-unified`.

**Deliverable:**

* the page and its check;
* the check in `scripts/gate.sh`, or, if the gate cannot run it, named in the gate's skipped claims with the reason;
* a README section that runs the viewer, one terminal per server;
* `docs/ARCHITECTURE.md`'s status updated.

### 91 DECODERBUILD

**Question.** The product's HTJ2K decoder is the published OpenJPH npm package that `client/decode/wasm/fetch_openjph.sh`
fetches: a 50 MB initial heap, with the range taken in a JS pass. dav1d-WASM is served from the lab's build output.
`docs/decode/README.md` measured the lab's own OpenJPH wrapper:

* at a 4 MB heap, 16.3 MB against 161.4 MB for three decoders, with the fill and the cold ask identical (§Where to
  put the floor);
* taking the range in the pack (§The range in the pack).

But §The build, as delivered predates the range in the pack, and no page loads it. Should the product ship its own
decoder builds, reproducible from pinned sources?

**Why it matters:** heap per decoder is expected to bind on a phone. A product cannot depend on a lab folder for the
code its page runs.

**Do:** one build recipe, run in a container: Debian slim pinned by digest, emscripten 3.1.74, cmake pinned, OpenJPH
0.31.0 and dav1d 1.5.4 at their commits. The script refuses any other version of each. It builds:

* **OpenJPH**, from the wrapper as it stands (`client/decode/wasm/openjph/htj2k_decoder.cpp` since this row moved it) (the range in the pack), with
  `INITIAL_MEMORY` 4 MB and `-O3 -msimd128 -fexceptions`.
  * The pack's range becomes a compile-time switch, off for 8-bit unsigned 3-component frames: nothing reads their
    range (`htj2k.js`'s `unranged`). `getRange()` returns an empty range (min > max) for them.
  * `htj2k.js` reads `getRange()` where the build has it and runs its JS pass only where it does not.
* **dav1d's SIMD arm**, as `client/decode/wasm/dav1d/build.sh` builds it.
* **Reproducible builds.** Every source path the binaries embed is mapped with `-ffile-prefix-map` (OpenJPH's
  assertions carry `__FILE__`), so two builds in different directories give the same bytes. Each output's sha256 is
  pinned in a manifest beside the recipe. Built outputs are not committed (the queue's rule). The page and the gate
  check what they load against the manifest, and row 86's stale-build guard names the build command.
* **Notices.** Each build's licence files sit beside it. One `THIRD_PARTY_NOTICES` lists everything the page loads:
  OpenJPH (BSD-2-Clause), dav1d (BSD-2-Clause, with the AOM patent licence), Emscripten's runtime and musl, and row
  88's XXH3. It is served with the client, and the licensing doc is updated.
* **The client loads these builds**, at the paths row 82's layout gives the decoders' WASM.

**Decides:**

* `lab/decode-bench/parity.mjs` byte-identical on every fixture set, signed included, against the encoder's input and
  the package.
* The AV1 conformance items exact through the dav1d build in Chromium, Firefox and WebKitGTK.
* Two builds in different directories byte-identical.
* The fill and the cold ask through the downloader with three decoders, against the package: interleaved, n ≥ 10,
  at 1× and 4×, and the renderer's peak memory.
* Mutants: the range switch turned off for grey frames (a range test fails); the manifest check given another
  build (it refuses).

**Adopt:** the round's rule. The product's builds replace the package wherever they are not slower; the package stays
as the parity reference.

**Branch:** `claude/av1-unified`.

**Deliverable:** the recipe and its README (pins, flags, verified hashes), the client wired to the builds, and the
numbers in `docs/decode/README.md` §The build, as delivered, corrected in place.

### 92 DEPLOY

**Question.** `deploy/` builds and runs both halves (checked 2026-10-03 with docker), but in a lab's shape:

* base images on floating tags;
* a certificate made on the host and mounted with its key world-readable;
* no restart policy and no healthcheck;
* every port published on every interface;
* no TLS for the page off loopback.

What does it take to run the product (the viewer, the decoder builds and the server) unattended on a host, from this
tree alone?

**Why it matters:** a product is something an operator can deploy. Off loopback, a page served over plain HTTP is
not a secure context, so it gets neither WebTransport nor cross-origin isolation.

**Do:** on this repository's own `deploy/Containerfile`, `deploy/compose.yml` and `deploy/nginx/wt-pacs.conf.template`,
make these ten fixes. A container test of a deployment of this same shape found each one.

1. **SELinux.** Every bind mount is `:z` (shared), never `:Z`. It is already so; keep it.
2. **Stop.** The server is PID 1 and handles SIGTERM itself (`server/src/main.rs`), so `stop` must take under a
   second. Measure it. Add compose's `init: true` only if it does not.
3. **The certificate's lifetime.** The server container makes the transport's certificate at each start (ECDSA P-256,
   10 days, as `gen_dev_cert.sh`). The server runs under `timeout $RESTART_AFTER` (default 9 days), so it restarts
   with a new certificate before the browser refuses the old one: a certificate pinned by hash must be valid for at
   most 14 days.
4. **gzip** on every compressible type the page fetches, the study metadata included (the template has it; verify).
   Add `gzip_proxied any` if anything is proxied.
5. **The build cache.** Toolchains and tools are installed in stages before the source copy. The cargo registry and
   target dirs get cache mounts. The ignore files exclude docs and lab results, so editing a doc rebuilds nothing.
6. **`restart: unless-stopped`** on both services.
7. **The start order.** The start script removes the previous transport file (the volume outlives the container) and
   writes the new one whole, through a temporary file and a rename. A healthcheck on the server (the file exists) and
   one on web (`/` answers 200); web waits with `depends_on: condition: service_healthy`.
8. **Non-root.** The server runs as uid 10001 and owns its certificate and transport directories. They are made in
   the image, so a fresh named volume inherits the ownership. No key is world-readable.
9. **Every base image pinned by digest.** The server's runtime image is the same Debian release as its builder.
10. **The small ones.** `cargo build --locked`; `npm ci` from the lock file; `server_tokens off`; no route that nothing
    uses; `charset utf-8`.

And:

* **Publishing.** 8765/TCP, 4433/UDP and 4433/TCP on `127.0.0.1` by default, with `PUBLISH_ADDR` to widen.
* **TLS on web.** `listen 443 ssl` with `http2 on`; `lab/page-open` measured this template over TLS and HTTP/2.
  `TLS_DIR` holds `cert.pem` and `key.pem`.
* **`WT_URL`** passed to the start script, so the transport file names the address the browser dials.
* **The web image** carries `client/` whole except its tests and dev files, plus the TS bundles, row 91's decoder
  builds and the notices. Studies are mounted, not baked; the 32 KB smoke fixtures may stay baked.
* **Only what the page loads is reachable:** `client/`, `/`, the metadata and the transport file; everything else is
  a 404. `check_equivalence.sh` is extended to assert it.

**Decides:**

* On a fresh clone, with rootless podman (and docker where the environment has it; say which ran): build both
  images, cold and after a doc edit (the second must rebuild nothing), and report their sizes.
* `compose up`; row 90's page check `--url` against the deployment passes (complete, exact, drawn) in Chromium with no
  certificate flag.
* The same off loopback over TLS, from a second address or a network namespace.
* `restart server` writes a new certificate and transport file, and the next page open connects.
* The time `stop` takes.
* `check_equivalence.sh` green, with each new assertion mutated to fail.

**Adopt:** the deployment.

**Branch:** `claude/av1-unified`.

**Deliverable:** the files; `deploy/README.md` (a diagram, the variables table, each fix's reason, what stays open);
and the verified run, summarised there.

### 93 CODECDOCS

**Question.** The codec findings are spread over `docs/av1/`, `docs/decode/README.md`, `lab/av1/*/README.md` and this
queue's verdicts, and nothing compares the codecs side by side. Make the codec docs the one source of truth that a
reader, or another project, cites.

**Why it matters:** the choice of codec per series is the product's main trade-off. A reader should find it argued
in one place, every number with its source.

**Do:** after row 68 (the AV1 docs). Extend; do not duplicate.

* **docs/codecs/README.md** (new, unquoted so the link check passes before it exists), holding:
  * the rule every codec is held to (bit-exact);
  * which series AV1 is for: the breast family first, general cine second, CT and MR staying HTJ2K;
  * a diagram of the codec choice per series and per depth as built (row 72's per-depth split, and row 77's rule if
    adopted);
  * the target series' bit depths after any offset, each with where it is known from (a row, `docs/FIXTURES.md`,
    `docs/av1/series.md`);
  * an at-a-glance table, and a side-by-side table with every cell keyed to its source. Its columns: lossless bytes
    against HTJ2K; decode time a frame at 1× (and 4×); total time, wire and CPU; client code size; decoder-worker
    memory at the largest frames; deepest sample in one bitstream; the exact browser path per engine; the DICOM
    transfer syntax; licence and patents; encode time a frame;
  * why HTJ2K is the default, and what would reopen it;
  * a specifications table: the AV1 specification, the AV1 ISOBMFF codecs-parameter string, WebCodecs, DICOM PS3.3,
    PS3.5 and PS3.6 2026d, Supplement 232 and T.814, each with its edition, URL and date read, and what was not read
    and why (the standards that are sold).
* **One doc per codec, under the same 17 headings:** What it is · How we use it (or would) · Bytes · Decode speed ·
  Total time · Client resources · Browser and device support · Bit depths, signed, colour · Random access and
  on-demand · Progressive / preview · Exactness risks and how they're checked · Licensing / patents · DICOM standing ·
  Maturity / tooling · Where it wins · Where it loses · Open questions.
  * The codecs: HTJ2K; JPEG XL (rows 22, 58, 63); JPEG 2000 Part 1 (row 22); AV2 (row 32).
  * AV1's entry is `docs/av1/README.md` itself, given the same headings if row 68 did not.
  * The scalable preview (rows 18, 24, 25, 31, 40) is a section of AV1's entry.
* **The bit split explained once**, in row 68's place, added only if its docs lack it: the offset; who decodes what;
  a worked example with numbers; how a top and a low stream become one DICOM frame; why split at all; which k at
  which depth (row 72's rule).
* **Every number moved, not restated.** A number lives in one doc, and the others point to it. `docs/av1/series.md`
  stays the taxonomy. Terms go into the one glossary (row 84). An unmeasured cell says "unmeasured".

**Decides:**

* `scripts/check_links.py` green.
* Every table cell's source resolves to a row or a doc that states that number; check each.
* Nothing lost: each passage moved is found at its new place, listed in the commit.
* The gate green.

**Adopt:** the docs; no code changes.

**Branch:** `claude/av1-unified`.

**Deliverable:** the docs.

## The data rows (94–97), 2026-10-07

A data audit (2026-10-07) read the DICOM header of every set the lab measured. The X-ray, CT, MR, PET and fluoroscopy
sets are sound (lossy flag `00` or full-fidelity derivation, or originals stored uncompressed). **Every ultrasound
source is lossy or of unknown history**: `us_liver` carries Lossy Image Compression `01`, ratio 12.4, DERIVED\SECONDARY;
`usb_cine` and `usb_cine_rgb` are MPEG-4 Part 2 clips; `usb_still` are PNG exports of unknown history. `mg16_cbis` is a
digitized film stretched to 16 bits. Lossy-sourced pixels bias toward AV1 (less noise, block structure AV1's intra tools
exploit, exact repeats for inter prediction, and faster decode because time follows bytes). Exactness verdicts stand:
any input proves a decoder exact. Bytes, time and inter verdicts on those sets do not count as evidence.

### 94 DATAGUARD

**Do:** in `FIXTURES.md`, a provenance column per set: original transfer syntax, Lossy Image Compression (0028,2110)
with ratio and method, Image Type (ORIGINAL/DERIVED; FOR PRESENTATION/PROCESSING for mammography), cropping or
conversion by the lab, and a class — sound, lossless-but-unrepresentative, lossy-sourced, unknown. `fetch_data.py`
records those attributes and refuses a lossy or video source unless the set is marked lossy-sourced; a lossy-sourced
set enters no bytes, time or inter verdict (a protocol rule in this queue). Correct in place, never drop: the
ultrasound claims in `docs/av1/README.md` (§A1, §Total time: "inter pays on the colour-transformed ultrasound", "the
ultrasound turns over"), every verdict cell that rests on `us_liver`, `usb_cine*` or `usb_still` (rows 6, 9, 11, 12,
17, 22, 23, 25, 28, 32, 34, 39, 40, 42, 46 and any later), marked provisional with the reason. Add under `## Blocked`:
no public sound source exists for breast ultrasound stills or cine, ABUS or multi-frame angiography (every one found is
an image or video export, or carries no licence); the owner decides between a partner's native DICOM under a data use
agreement and phantom scans on real scanners. Non-commercial (CC BY-NC) data is not usable for this work: its licence
restricts purpose, not where the copy lives. **Decides:** the guard refuses a known lossy set (mutate: it must) and
accepts every sound one; `check_links.py` and the gate green.

### 95 DBTSCALE

**Question.** Do the DBT verdicts (bytes, inter against intra, total time, the per-depth split) hold on sound data at
scale? **Do:** from the large CC BY 4.0 breast collection the lab already uses (its full DBT volumes, every system it
holds), at least 5 whole, uncropped exams per system; bytes per layout against HTJ2K (intra; frame groups are rows 99–101's), decode and total time on row 23's links at 1× and 4×; every frame exact. **Decides:** the same cells as
rows 10, 44, 46 and 77 on this data, with the spread across exams and systems; each earlier DBT verdict confirmed or
corrected in place. **Branch:** `claude/av1-unified`.

### 96 FFDMSCALE

**Question.** The same for full-field mammography and synthesized 2D, FOR PRESENTATION as a viewer receives them, and
the 14-bit FOR PROCESSING raw images the lab never measured. **Do:** at least 5 exams per system from the same
collection and the second CC BY collection with synthesized 2D; bytes per layout against HTJ2K, decode and total time
on row 23's links at 1× and 4×; every frame exact. **Decides:** the per-depth split and the per-series codec rule for
these images on sound data. **Branch:** `claude/av1-unified`.

### 97 RGBNATIVE

**Question.** The adopted colour transform for RGB (RCT) was sized on lossy-sourced ultrasound. Does it still beat
GBR on natively stored, uncompressed colour ultrasound (lossy flag `00`) — the only open sound source is a small set of
colour stills in a CC BY collection? **Decides:** bytes and decode time per layout against HTJ2K, every frame exact; the
RGB rule confirmed or corrected in place, with the caveat that a handful of stills is not a cine. **Branch:**
`claude/av1-unified`.

## The frame-group rows (98–101), 2026-10-07

The owner, 2026-10-07: the conclusion "inter does not pay" is not conclusive. The AV1 taxonomy is the breast family
first (FFDM, synthesized 2D, DBT slices, breast ultrasound cine, ABUS); other cine is secondary. FFDM and synthesized 2D
are single images, so frame groups do not apply to them.

### 98 GOPSCOPE

**Do:** re-scope the frame-group evidence, corrected in place, never deleted. Rows 6 (fluoroscopy, MR, ultrasound
RGB), 21 (DBT projections, FOR PROCESSING) and anything measured on CT or MR concern content AV1 no longer targets: mark
them so in `docs/av1/README.md` §A1 and wherever "inter does not pay" is stated. What remains in scope: DBT slices (rows
10 and 46, six series), breast ultrasound cine (lossy recordings only — row 94's provenance applies), ABUS and
angiography (no data). Replace any "conclusive" wording with what was actually measured: on these series, libaom only,
alt-ref off (required for exactness), a keyframe at every G, two presets; row 46 sampled only G = 8 and 16. Then list,
under this row, every other closed row whose verdict rests on content outside the taxonomy or on thin sampling (few
series, few frames, one encoder, one preset), with what a verification would need — for the owner; redo none of them.
**Decides:** `check_links.py` and the gate green. **Branch:** `claude/av1-unified`.

**Closed rows to verify, for the owner (2026-10-08; none redone).** Each verdict rests on content outside the AV1
target series ([`series.md`](series.md)) or on thin sampling; what a verification would need follows the dash.
* *Frame groups.* **6 SIZE** — fluoroscopy, MR and an RGB ultrasound (lossy-sourced), none a target; its "inter
  collects nothing" decides nothing for AV1 — rows 99–101 on DBT. **10 CONTENT** — two DBT volumes, libaom only, alt-ref
  off, cpu0/cpu6, coded whole — the denser sweep of row 99's protocol, a second encoder, the k = 2 split. **21 TAXO** —
  projections (FOR PROCESSING, not loaded for reading), groups on top11+low only, top12+low not run — none unless
  projections become a target. **46 BREAST** — four DBT volumes at G = 8 and 16 only, libaom only; the grey cine's
  halving is a lossy MPEG-4 clip's — a scanner's native cine (Blocked, row 94). **28 LLSIZE**'s and **36 ENCX**'s "inter
  pays on the ultrasound" — `us_liver`, lossy-sourced (row 94).
* *Decode and total time on off-target series.* **9 SPEED**, **11 FILL**, **12 PREVIEW** (the fluoroscopy's preview),
  **15 SVC**, **18 SVCQ** — fluoroscopy, MR, ultrasound and synthetic sets only — DBT slices and mammograms, the frames
  the targets are. **23 TOTAL**, **34 TOTAL2**, **42 TOTAL3** — four series, two of them off-target (fluoroscopy,
  `us_liver`) — their DBT cells alone carry; row 77 TOTAL4 re-runs the taxonomy.
* *Thin sampling.* **28 LLSIZE** — the first 2–8 frames a series, one encoder — whole series where a verdict turns on
  < 2 %. **32 AV2** — one middle frame a series. **66 POCGAP** — the first 4 frames of two 10-bit volumes. **14 ENC** —
  8 frames a set, 3 rounds. **60 LOSSLINK** and **75 LOSSCC** — one series (the 10-bit volume), 8 frames a visit —
  enough for a transport's verdict, not a codec's.

### 99 GOPTHEORY

**Do:** before any new data, a hypothesis document from primary sources (codec specifications, encoder documentation
and source, peer-reviewed literature on lossless and near-lossless inter coding of medical image sequences): why inter
prediction should or should not reduce lossless bytes for each target type — noise and its frame-to-frame correlation,
DBT slice-to-slice change (reconstruction filter, slice spacing), ultrasound speckle and its decorrelation with motion —
and which AV1 inter tools stay usable when coding is lossless and the output must be exact (alt-ref and filtered
references; libaom and SVT-AV1, from their source). It ends with explicit predictions per content and group size; the
measurement protocol (a denser G sweep, e.g. 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, whole; alt-ref on and off where exact;
libaom and SVT-AV1; presets; the series and frame counts; every frame exact against the source checksum; interleaved
timing); and a decision rule stated before the data: what byte gain, at what decode and random-access cost, justifies
giving up per-frame random access. Write the protocol and the decision rule as their own file, separate from the
reasoning, so row 100 can be given them alone. **Deliverable:** the hypothesis document and the protocol file in
`docs/av1/`; no measurement.

### 100 GOPMEASURE

**Do:** read only row 99's protocol file and decision rule — not its reasoning — and run it on the target content
available on sound data (row 94's provenance): DBT slices, whole and uncropped, every system the CC BY collection holds;
breast ultrasound cine and ABUS only from a sound, licensed source — otherwise list the data needed under `## Blocked`.
Report the numbers per cell, then whether each prediction held, against the pre-stated rule. **Branch:**
`claude/av1-unified`.

### 101 GOPREVIEW

**Do:** a short review: row 99's theory against row 100's data, prediction by prediction; whether the frame-group
question is now conclusive for each target type, and why or why not; corrected in place where `docs/av1/README.md`
§A1 states it.

## The evening rows (102–107), 2026-10-08

The owner, 2026-10-08: everything runs tonight, scheduled so that no session waits. Rows 104 and 106 must be taken by a
session that did not do their theory row (103, 105): a session that did leaves them and takes the next row. That keeps
the measuring context apart, as §Protocol asks.

### 102 PUBLICAUDIT

**Question.** What in this public repository should it not carry, and what would cutting each cost? **Do:** read-only.
Take row 83's two lists under §Blocked — *What a public repository carries* and *Which rule governs* — and sweep the
whole tree, the remote's tags and branch names for more of the same kind: host names, addresses, ports, key or account
roles, personal paths, third-party product or company names, notes addressed to other projects, archive tags. Never
quote a secret; if one is found, say where, that it is one, and that it should be rotated. Per item, for an owner who is
not a security specialist, in plain words: what it is; who reads it or what depends on it (`git grep`); the risk of
keeping it (security, licence, naming the private stack, reputation), with how likely and how bad; the cost of removing
it (lost knowledge, broken links, references to rewrite); a recommendation — keep, reword, cut from the tree (history
keeps it), or cut from history too (a rewrite of a pushed branch, only if a risk demands it) — and what each choice
changes. Group by recommendation, the riskiest first. **Deliverable:** under this brief, nothing else edited; one line
under §Blocked pointing here for the owner's decision. **Branch:** this one.

**The audit (2026-10-09, `60f7db`), read-only.** Swept: the trees of all six remote branches (`claude/av1-unified` at
`4bbddd3` as the fullest, 1 281 files), the 37 tags on the remote (row 83 counted 59), and the whole history reachable
from them (1 990 commits), for secrets, addresses, host and account details, personal paths, third-party names, notes
to other projects and archive tags. Items are named here by place and kind, never by the name or value itself.
**No secret was found**: no private key, no token of the common services, no password assignment, in any tree or in
the history.

*Act outside the repository — the one item whose risk asks for it:*

1. **The rig's public address.** The cloud rig's public IPv4 address was in the lab scripts from 2026-08-26 until
   `b537cce7` (2026-10-02) replaced it with `CLOUD_HOST` on `main`. It is still in **the tree of `claude/av1`** (10
   lines in 9 `lab/scripts/*.sh`, as the default host and login), in **the tree of every one of the 37 tags** (7–13
   lines each), and in 19 commits of history. Read with what else is public — `docs/rig-limits.md` §9 (which UDP port
   is open, which one a long-lived server holds, that two keys exist by role and that root accounts once accepted the
   agent's key), the cloud provider and region named in 14 commit messages, and that image's default login in three
   history paths — it tells a scanner which machine, which ports and what runs there. *Risk:* not a credential (the
   login is by key); likely to be scanned anyway, as every public address is; bad mainly for the rig's measurements and
   whatever else that machine serves. *Choices:* (a) **give the rig a new address, or let only the workstation reach
   its SSH and UDP ports** — every mention, in tags and history alike, then points at nothing; nothing in the repository
   changes; this is the recommendation if the rig still exists, and nothing if it does not; (b) drop the defaults from
   `claude/av1`'s scripts as `b537cce7` did on `main` (9 files, `${CLOUD_HOST:?…}`), or let row 69 fold the branch;
   (c) cutting it from history is **not** recommended: it rewrites 6 branches and 37 tags, changes every hash the docs
   cite (434 backticked on `claude/av1-unified`), and clones and forks keep the old objects anyway.

*Reword — cheap, and the knowledge stays:*

2. **`docs/rig-limits.md` §9 (`:531-575` on `claude/av1-unified`): the rig's firewall and accounts.** What a campaign
   needs is the host's size, its throttled volume and that one UDP port is reachable; the second port's long-lived
   server and the root accounts that once took the agent's key add only to item 1's map. *Who reads it:* the owner
   and a local agent running a campaign; nothing links to those lines. *Risk:* low alone, moderate beside item 1.
   *Recommendation:* keep the key-rotation procedure (it is general and correct), cut the two details. Cost: two
   sentences.
3. **Another viewer's SDK named as the HTJ2K decoder package's npm scope**: `client/decode/wasm/fetch_openjph.sh:8`
   (the pin the gate's prerequisites run, `README.md` §Prerequisites) and prose in `docs/decode/README.md` and 15 lab
   READMEs — 17 files, 20 lines. *Risk:* the queue's own rule (never name another viewer or its SDK); licence none (the
   wrapper is MIT); reputation low. *Recommendation:* keep the name where it is a pin — a fetch must name what it
   fetches — and reword the prose to "the OpenJPH npm package (`client/decode/wasm/fetch_openjph.sh`)"; once row 91's
   own OpenJPH build is all the product loads, the fetch is lab-only. Cost: 20 lines, no links.
4. **Imaging and GPU vendors named as sources**: `docs/av1/series.md` (35 lines: six vendors' conformance statements,
   [S1]–[S6], and two more under *Still open*), GPU vendors in `docs/decode/README.md`, a DICOM toolkit's test data
   at `docs/av1/queue.md:800`. They are citations of public primary documents, which the docs rule asks for. *Risk:*
   legal negligible (factual citation); it is the rule question below. *Recommendation:* keep, as citations.
5. **"A private codebase" and "an earlier private proof of concept"**: README §Provenance (`README.md:130-136`), the
   AV1 README's §Prior evidence, row 66 and `lab/av1/bytes/prior-gap`. No project is named; each confirms one exists.
   *Risk:* low. *Recommendation:* keep — §Provenance is where a reader learns why commits carry attribution trailers.

*Keep — low risk, and cutting costs more:*

6. **Commit identities**: the owner's name (three spellings) and e-mail on 879 commits, one coding agent's identity on
   931, a second third-party coding tool's agent and bot on 179; 811 messages carry attribution trailers. Inherent to
   git; changing any of it is item 1(c)'s rewrite.
7. **Archive tags**: 37 on the remote. 23 are named `archive/<tool>/…` after that second coding tool; the docs cite
   only `archive/transport-lab-2026-09`, `archive/downloader-opts-2026-10-03`, `archive/n6-wasm-vs-ts-2026-09` and the
   five `read-path-*` tags. Deleting an uncited tag removes the tool's name from the tag list but not its commits from
   GitHub, and every tag's tree carries item 1's address — so (a) there settles them. **Found on the way:**
   `archive/variants-2026-10-03`, cited 15 times on `claude/av1-unified`, does not exist on the remote; the tag is
   `archive/arms-2026-10-03` (row 84 renamed the word in the text, not the tag). Either name works if the owner adds
   the other; the link check does not see tags.
8. **Branch names** carrying the coding agent's name (5 of 6), three of them idle since 2026-10-03–05
   (`claude/onerror`, `claude/unified-2026-09-23`, `claude/server-design`). The tool's convention; deleting the idle
   ones once merged is housekeeping, the owner's.
9. **Drafts addressed to other projects**: `docs/transport/upstream-quinn-ack.md` (and its `.patch`) and
   `docs/transport/upstream-wtransport-settings.md`, unfiled issues for two open-source libraries, one linking its
   maintainer's repository. *Risk:* a note read before it is filed; none else. Keep until filed or dropped.
10. **Paths and private addresses**: no personal path in any tree (`scripts/check_personal_paths.sh` runs in the
    gate); history has the owner's local home directory 8 times and the rig's home ~600. The lab's TUN and loopback
    addresses (`10.77.0.x`, `127.0.0.2`) and two LAN addresses in history are private ranges. The product's default
    ports are documentation. The cloud image's default login in 3 scripts on `claude/av1-unified` (7 lines,
    `ubuntu@$HOST`) is harmless without the address; reading it from `CLOUD_USER`, as `cloud_common.sh` does, is two
    lines. Public-key fingerprints of the rig's keys are in history (`0752e5db` removed the last): they identify a
    key, they cannot log in.

*Which rule governs, from the sweep:* the queue's "never name another viewer, SDK, vendor" against the docs rule that
every claim cites its primary source (items 3 and 4) — whether the rule means *never cite* or *never compare with,
endorse or copy from* is the owner's; and README §Provenance's "names cleaned" against a history that keeps them,
already corrected in place on 2026-10-03 (item 6).

### 103 BB3

**Question.** Does v3's loss bound keep BBR's win under random loss while removing its measured costs?
**Why it matters:** row 75 found BBR fills 0.04–0.76 of today's time under 1–5 % loss but did not adopt it for its
clean-link costs; `docs/transport/transport-conclusions.md` §1 names the bound as the next candidate (BB3), with what it
should remove and what not, the smallest build and the cell that decides it. **Do:** (1) build the bound as §1
*The smallest build* states it, opt-in beside `bbr` and `cubic-restart` (a controller name the server's flag takes),
the default unchanged; unit tests of its rules (a round over 2 % sets the cap, the 0.7 × BDP floor, the 1, 2, 4…
regrowth), each mutated and seen to fail; the gate green. (2) Before any timed run, write
docs/transport/bb3-protocol.md alone, with no reasoning in it: the cells, the arms (`bbr`, the bound, `cubic-restart`),
rounds and order (`lab/scripts/order.py`, `--self-timing`), what is recorded, and this decision rule stated before data:
*the bound passes* when on PROF's LTE-good + CoDel profile under 2 % of its packets meet CoDel, it stands under 50 ms
of queue and keeps ≥ 0.9 × `bbr`'s throughput; on ASKL's 4 % cell its ask is ≤ +73 ms over `bbr`; on W4b's `flat`
500 ms it loses < 3 300 packets; *it becomes the default* only if it also fills, through the product as row 75 ran it,
in ≤ 1.10 × `bbr`'s time on row 75's lossy cells and ≤ 1.01 × `cubic-restart`'s on its clean and jitter cells. Add §1's
predictions per cost to §1 under BB3 if they are not stated there. **Deliverable:** the controller, its tests, the
protocol file. **Branch:** `claude/av1-unified`.

### 104 BB3MEASURE

**Do:** given only docs/transport/bb3-protocol.md and its decision rule (not §1's reasoning), run it. Report the
numbers, n and spread, `VOID` visits counted, where the host saturates; then apply the rule — adopt the default only if
it says so, in its own commit. Budget about 5 hours of runs; push each round's data as it lands. **Deliverable:**
the numbers in §1 under BB3, the verdict in the queue. **Branch:** `claude/av1-unified`.

### 105 CROSSOVER

**Question.** At which link speed does each codec fill a target series first, per engine and CPU speed — and can the
server know enough to choose? **Why it matters:** row 77 found AV1 0.89–0.98 of HTJ2K's time where the wire is the
clock and up to 2.53× where a slow CPU meets a fast link, so no single codec wins; its wire-bound cells rest on n = 1–9
(46 % `VOID`). Rows 95 and 96 measured bytes and decode at scale on sound DBT and mammography. **Do:** theory first, no
new timed data: from the measured bytes and decode times (rows 77, 95, 96 and their lab READMEs) and the downloader's
pipeline (decode overlaps the wire), a model of fill time per codec, link speed and CPU speed; predict, per sound target
series (DBT 10 and 12 bits, mammography for presentation, synthesized 2D) and engine (Chromium, Firefox), the link speed
where AV1 and HTJ2K tie at 1× and 4×, with the band the measured spread allows; check the model against row 77's and
95's existing cells and say where it fails. Then write docs/av1/crossover-protocol.md alone: the cells on both sides
of each predicted crossover, n ≥ 10 kept visits a cell, interleaved, how `VOID` is kept under 20 % (fewer concurrent
arms, steal time read before each round), and the rule stated before data: *the model holds* where every measured
cell falls on its predicted side or within its band; *a per-link rule is worth building* only if a series gains
≥ 5 % of fill time on a link a phone commonly has (≤ 20 Mbit/s or LTE) while the rule's input (the client's measured
throughput and decode rate at the first frames) is known before the first frame is asked. Name the rule's input and
cost (a second encoding stored per series). **Deliverable:** the model in `docs/av1/README.md` beside row 77's
section, the protocol file. **Branch:** `claude/av1-unified`.

### 106 CROSSMEASURE

**Do:** given only docs/av1/crossover-protocol.md and its decision rule, run it; sound data only. Report numbers, n,
spread, `VOID` share, every frame exact; then whether each predicted side held. Budget about 5 hours of runs; push each
round's data as it lands. **Deliverable:** the numbers beside row 77's in `docs/av1/README.md`. **Branch:**
`claude/av1-unified`.

### 107 EVENREVIEW

**Do:** row 103's predictions against row 104's numbers, row 105's against row 106's: per prediction held, refuted or
untested; conclusive or not, and why; what each now decides (the controller's default, a per-link codec rule) and what
the owner must still choose, in plain words. **Deliverable:** a review section in each owning doc; one line under
§Blocked for each choice left to the owner. **Branch:** `claude/av1-unified`.

## The decode-lever and formatting rows (108–114), 2026-10-09

The owner, 2026-10-09: five decode levers, measured as data only — nothing changes a product default. Each row runs
its section of [`../decode/levers-protocol.md`](../decode/levers-protocol.md) as written, given that file and its
rules only. Rows 110–112 wait for the owner's next usage window; the owner or the orchestrator sets them `ready`.
Row 113 is taken by a session that measured none of 108–112.

### 108 HELPERSTART

**Do:** `levers-protocol.md` §L1 as written: the arms, cells, predictions and rule there. Report the numbers, n,
spread and `VOID` share first, then each prediction held or not, then the rule's verdict. **Deliverable:** the
numbers in `docs/decode/README.md` beside §Code-blocks on threads, measured; the verdict in the queue.
**Branch:** `claude/av1-unified`.

### 109 REGIONDECODE

**Do:** `levers-protocol.md` §L2 as written — the container half only: exactness of every region and stripe, and
their speed in this container. OpenHTJ2K is pinned and its licence listed in [`licensing.md`](licensing.md) before
it is built. What a zoomed view shows first, and the ingest, encoding and layout choices region decode implies, are
the owner's and are not decided here: the row puts the data on the table. **Deliverable:** the numbers in
`docs/decode/README.md` beside §A frame at the level the screen needs; the verdict in the queue. **Branch:**
`claude/av1-unified`.

### 110 COARSEPOOL

**Do:** `levers-protocol.md` §L4 as written, on row HTJ2KMT's frame bench, the heap's high-water beside each time.
**Deliverable:** the numbers in `docs/decode/README.md` beside §Code-blocks on threads, measured; the verdict in the
queue. **Branch:** `claude/av1-unified`.

### 111 WEBGPUHT

**Do:** `levers-protocol.md` §L3 as written: the kernels built in `lab/` beside `lab/av1/decode/webgpu`, exact on
SwiftShader, one-frame and batched dispatches; no timing claim — the container has no GPU. The phone stage's rule is
stated in §L3 and waits for the owner's phones. **Deliverable:** the kernels, their exactness table in
`docs/decode/README.md` beside §A WebGPU block decoder, bounded; the verdict in the queue. **Branch:**
`claude/av1-unified`.

### 112 DECODEPACE

**Do:** `levers-protocol.md` §L5 as written: *follow the queue* behind a lab flag on the downloader, off by default,
both dispatch clauses kept; fill time, CPU busy time and wake-ups per fill. Energy is not measured here and the row
says so. **Deliverable:** the numbers in `docs/ARCHITECTURE.md` §How many; the verdict in the queue. **Branch:**
`claude/av1-unified`.

### 113 LEVERREVIEW

**Do:** per lever, the hypothesis and predictions of `levers-protocol.md` against rows 108–112's numbers: each
prediction held, refuted or untested; conclusive or not, and why; and the phone or GPU measurement each lever still
needs to decide, in plain words. **Deliverable:** a review section in `levers-protocol.md`; one line under §Blocked
for each choice left to the owner. **Branch:** `claude/av1`.

### 114 FMT

**Do:** on the tree that results once the owner merges `main`, adopt rustfmt's defaults — no `rustfmt.toml`, the
smallest diff (about 1 324 lines in 31 files on 2026-10-09) — and clippy's default lints: fix each of the 6 default
warnings, or `#[allow]` it with a one-line reason. One `cargo fmt --all` commit alone, its hash listed in a new
`.git-blame-ignore-revs`; then `cargo fmt --all -- --check` and
`cargo clippy --workspace --all-targets -- -D warnings` added to `scripts/gate.sh`, the vendored `patched/` excluded.
Pedantic lints are not adopted. **Deliverable:** the format commit, the lint fixes, the gate's two steps, gate green.
**Branch:** *open — the owner sets it at merge time.*

### 115 FFDIAL

**Do:** Firefox 157's WebTransport dial through the relay fails or does not settle within the downloader's 5 s on
fixed 5–20 Mbit/s links (row 80: every try at 5 Mbit/s; row 77: 49 of 60 at 5, 125 of 394 at 20; row 106: 143 of
192 at 10), while Chromium settles on the same links. Row 80 saw Firefox send the session's `CONNECT` and the server
start no connection driver. Find where the handshake stops — the server's debug log, a qlog or keylog on both sides,
packet captures on the relay — and whether it is the relay, the server, the QUIC stack or the browser. If it is ours,
fix it with a test that fails before the fix; if it is the browser's, a minimal reproduction and where it is filed or
fileable. **Deliverable:** the cause with its evidence; the fix or the reproduction; dial success per link before and
after, n ≥ 30 a link, interleaved; the finding in `docs/transport/transport-conclusions.md`. **Branch:**
`claude/av1-unified`.

### 116 TAGCITE

**Do:** row 102 found `archive/variants-2026-10-03` cited 15 times; the tag is `archive/arms-2026-10-03` (row 84's
arm → variant rename likely rewrote the name in prose). Point every citation at the tag that exists, on both branches
this queue pushes to; `git ls-remote --tags origin` proves each cited tag exists afterwards. Tag names are not renamed.
**Deliverable:** the citations fixed, 0 citations of a missing tag (a check in `scripts/gate.sh`'s link step if it
fits in a few lines, mutated to fail). **Branch:** `claude/av1` and `claude/av1-unified`.

### 117 DOCLABELS

**Do:** the documentation leftovers rows 84 and 85 list as not done that need no decision: queue-row labels in product
docs' prose and headings (`docs/av1/README.md`, `docs/decode/README.md`, `docs/transport/transport-conclusions.md`)
replaced by the measurement they name, with the row kept as a pointer; campaign labels in lab code comments, likewise;
product docs that point at the queues rather than their own §Open; READMEs for the eight lab folders without one; the
duplicates row 85 names (the race, BBR's 12–19×, `read_ahead_kb`, the two decoders in code) kept in their owning doc
and pointed at elsewhere. Not here: the several-names cases row 83 lists without a fix (the owner's), the formatter
(row 114). **Deliverable:** the edits, the link check at 0 unresolved, gate green. **Branch:** `claude/av1-unified`.

### 118 GUARDS

**Do:** the check leftovers row 86 lists as not done that need no decision: stale-build guards for the image and for
`cellcheck.sh` like the dav1d-WASM one (a build older than its sources refused, exit 2), and the lab's Go and h3
clients compiled by the gate (skipped and named when the toolchain is absent). Each new guard mutated to fail. Not
here: a formatter or linter (row 114). **Deliverable:** the guards, the gate's step list and timings, gate green.
**Branch:** `claude/av1-unified`.

## Blocked

* **2026-10-09 17:35 UTC: row 107 EVENREVIEW — whether `bbr-bound` stays in the product, opt-in, or is retired as BB2
  and BBF were;** it failed its rule and nothing recommends it to a user (`transport-conclusions.md` §1, reviewed).
* **2026-10-09 17:35 UTC: row 107 EVENREVIEW — whether a per-packet loss bound is worth pursuing** (proposed to quinn
  upstream, or v3 ported): the round-rate approximation cut after CoDel's drops, not before.
* **2026-10-09 17:35 UTC: row 107 EVENREVIEW — whether a series AV1 codes a fifth smaller (`dbts_b4`) is served as AV1**:
  13–22 % faster in Chromium and Firefox at 1×, 1.29 × slower in Firefox at 4× on LTE (`docs/av1/README.md` §Where
  AV1 fills first, reviewed).

* *Resolved, 2026-10-09 (the owner): §Protocol's rule for a host that cannot meet its `VOID` bar — strict and
  round-paired readings both, a verdict where they agree, "not conclusive on this host" where they do not.*
  **2026-10-09 11:05 UTC: row 106 CROSSMEASURE — its `VOID` < 20 % cannot be met in the container that took it;
  set back to `night` for one that can, or the owner relaxes the rule.** In that container, row 88's 800 visits
  through `total-time/run.mjs` the same day were `VOID` on 76–94 % of every link at or under 20 Mbit (r5000 147/160,
  r20000 129/160, lte-good 136/160, wifi-home 133/160; the relay's p99 a median 1.5–2.1 ms late) and on 15 % at
  r50000. Steal time read 0 % (`/proc/stat`, 3 × 10 s), and the relay ran `SCHED_FIFO` 50 alone on core 3 as
  `run.mjs` asks, so the protocol's wait-on-steal cannot help: the lateness is the relay's epoll loop on that host
  (`docs/rig-limits.md` already says that loop fails a 0.5 ms bar). n ≥ 10 kept a cell would take some 50–80 rounds
  on those links, far past the row's 5 hours. Nothing was fetched or measured for the row. The owner's options: run
  it where the guard passes (another session's container voided 30 % on r20000–wifi-home the same morning), or
  count round-paired `VOID` visits, both arms on the same link in the same round, as row 88's five-link table did.

* **2026-10-09 09:55 UTC: row 91 DECODERBUILD — whether to ship row HTJ2KMT's code-block pool for large series is the
  owner's.** Row 78 adopted it as the delivered build; through the downloader on 512² frames it tied fills and lost a
  cold ask at 4× (×1.078 against the package, 3/10 rounds; the single-threaded build ×0.732, 10/10), so the product
  ships the single-threaded build. Row 78's gains (×0.70–0.83) were warm asks on frames from 1914×2572 up. Shipping
  the pool for those series means a second OpenJPH build, chosen per series, and a cold-ask measurement on them
  (`lab/decode-bench/builds.mjs` with `SERIES`), which this row did not take.
* *Resolved, 2026-10-09 (the owner), the rule question: the naming rule concerns the private comparison stack only,
  so items 3 and 4 (the npm package's scope, vendor citations) are kept.*
  **2026-10-09 09:46 UTC: row 102 PUBLICAUDIT — what the public repository should stop carrying is the owner's.** No secret was found; one item asks for action outside the repository (the rig's public address, still in `claude/av1`'s tree, every tag and history: give the rig a new address or close its ports to all but the workstation), and nine are reword-or-keep calls — row 102's brief, *The audit*.
* *Resolved, 2026-10-08 23:45 UTC (the owner): product dependencies leave `lab/` first, every proposed rename is
  adopted (rows 56 and 84's briefs); what a public repository carries and which rule governs go to row 102 for analysis.*
  **2026-10-08 16:15 UTC: row 56 LAYOUT — the moves wait on two of row 83's decisions.** Every prerequisite row is done
  and the tree is proposed (`lab/av1/README.md` §The folders, `a6eb1c3` on `claude/av1-unified`), but applying it
  renames the queue-named `lab/av1/` folders, which row 83 lists as the owner's (below, *Renames*), and would move
  `dav1d-wasm/` and `item/` — the shipped AV1 decoder's build and the AV1 ingest — inside `lab/` while whether product
  code stays under `lab/` is also the owner's (*Where product code lives*). The owner decides: apply the proposed tree
  as is, or first move the product dependencies out of `lab/`. The row is set `after owner`; no session claims it.

* **2026-10-08 16:05 UTC: row 100 GOPMEASURE — no frame-group decision for breast ultrasound cine, ABUS or contrast
  angiography (predictions P8–P10).** No sound, licensed source is known. Each type needs ≥ 2 independent sources of
  ≥ 2 series each: native frames stored uncompressed or losslessly (no MPEG, no lossy JPEG; Lossy Image Compression
  absent or `00`), whole series in acquisition order, under a licence that allows commercial use (CC BY or alike, not
  CC BY-NC) — B-mode breast ultrasound cine with the probe slow or still, ABUS volumes, contrast angiography runs. The
  lab's breast cine are MPEG-4 Part 2 clips and enter no verdict. Until then these stay at G = 1 by default.

* **2026-10-08 15:20 UTC: row 77 TOTAL4 — whether to serve AV1 by link or client is the owner's.** By the brief's rule
  (AV1 only where it fills first in both engines on every cell) no series qualifies and ingest keeps HTJ2K. AV1 is the
  faster fill on MR, 10-bit DBT, fluoroscopy and CT wherever the wire is slower than the decoder (0.89–0.98) and loses
  where a slow CPU meets a fast link, Firefox by 1.33–2.53 at 4× on 50 Mbit. A rule that used that would need the
  server to know the link or the client; the mammogram and the projections are HTJ2K's either way
  ([`README.md`](README.md) §Every change of the round). *Also:* Firefox 157's dial through the relay failed on 49 of
  60 visits at 5 Mbit and 125 of 394 at 20 Mbit (row 80's finding, still open).

* **2026-10-08 12:50 UTC: row 75 LOSSCC — BBR or `cubic-restart` as the default is the owner's.** Through the
  product on lossy links BBR takes 0.04–0.76 of the fill's time and cuts an ask's p95 on bursty 5 % loss from about
  10 s to 0.7–1.9 s. Where nothing is lost it costs +2–3 % at 5 Mbit, +12–13 % at 50 Mbit with ±20 ms jitter, and
  +70 ms on a clean ask at 4×. It also carries the standing queue and the neighbour's share measured in CC1, FQC and
  PROF, which this row did not re-measure. By the round's rule it is not adopted. Whether the target's loss mix pays
  for that is a product decision ([`transport-conclusions.md`](../transport/transport-conclusions.md) §1, LOSSCC; §9
  item 2).

* **2026-10-08 05:19 UTC: row 94 DATAGUARD — no public sound source for breast ultrasound or angiography.** No public
  source found holds breast ultrasound stills or cine, an automated breast ultrasound volume, or a multi-frame
  angiography run as a scanner's native, losslessly stored DICOM under CC BY or CC0: every one found is an image or
  video export (the lab's three breast ultrasound sets: MPEG-4 clips and a PNG export) or carries no licence, and
  `us_liver`'s header says it was coded lossily at 12.4:1. Until one exists, every ultrasound number is provisional.
  The owner decides between a partner's native DICOM under a data use agreement and phantom scans on real scanners.
  Non-commercial (CC BY-NC) data is not usable for this work: its licence restricts purpose, not where the copy lives.

* **2026-10-08 03:55 UTC: row 83 TEAMAUDIT — the decisions rows 84–86 cannot take alone.** Each is structural or
  renames a public surface:
  * *Renames across the code and its readers:* "item" → "coded frame" (README §Names' proposal); "arm" → "variant" in
    the lab, its variables and `CLAUDE.md` §Measurement; the telemetry schema's `arm` → `client` and its row kinds
    `interaction`/`preload` → ask/fill (`client/record/types.ts:151`, `parse.ts:61,65`; always-null fields
    `report.ts:145-146,200` kept or dropped); the crate `exact-server` and "exact-tier"; "study" for one series
    (`--study`, `pack-study`, `study-bundle`); "conformance" for the transport contract suite; "early" in
    `patches/wtransport-0.7.2-settings-in-handshake.patch`; "Media-complete" kept and defined, or renamed; the queue-named
    `lab/av1/` folders (row 56). Whether the proposed Names rule goes into `CLAUDE.md`, and whether the glossary stays in
    README §Names or gets its own file.
  * *Where product code lives:* the shipped AV1 decoder's build (`lab/av1/dav1d-wasm/`), the AV1 ingest
    (`lab/av1/item/ingest.py`; the three moved by row 56, `7b97026`) and the HTJ2K decoder's fetch (`lab/decode-bench/fetch_decoder.sh`, served from
    `lab/decode-bench/vendor`) are product dependencies under `lab/`, against `lab/README.md:3`; lab crates in the
    product workspace and image (`Cargo.toml:10-12`, `deploy/Containerfile:16`); lab-only flags in the product binary
    (`server/src/main.rs:43-57`); `readMin` (`client/transport/downloader.js:374`), set only by the lab; the rejected
    read shapes kept compiled (`lab/disk-access-bench/src/rejected_access.rs`); the opt-in GSO patch (`gate.sh:37`);
    splitting `client/contract/dispatch-rig.ts` (2 192 lines).
  * *What a public repository carries:* README §Provenance (`README.md:186-193`); `docs/rig-limits.md` §9 (:531-611,
    a cloud host's ports, a long-lived server, SSH key roles); third-party names cited as sources in
    `docs/av1/series.md:175-180` and as the HTJ2K decoder package's npm scope (README.md:17, 16 lab files); 59
    `archive/*` tags on the remote, some named for third parties; the unfiled upstream drafts
    (`docs/transport/upstream-*.md`).
  * *Which rule governs:* the dated evolution log `CLAUDE.md:46` holds up as the model (`docs/adr/disk-access.md` §3)
    against "no history narrative"; the two ADRs still "proposed" (`docs/adr/exactness-in-production.md:3`,
    `docs/adr/transport-idle-sessions.md:3`).

* **2026-10-08 03:10 UTC: rows 75 LOSSCC and 77 TOTAL4 stale** — claimed 18:43 UTC on 10-07 (`c0a3d8`, `0e0b90`),
  last lane commits `c20e7b0` (75, 19:05) and `434104a` (77, 20:41) on `claude/av1-unified`, none in the six hours
  since; set back to `night`. Each continues from its lane's commits.

* **2026-10-07 22:45 UTC: row 80 GREY420 — whether to serve 8-bit grey as 4:2:0 is the owner's.** Measured, not
  adopted by the round's rule: it costs every Chromium fill its +0.2 % bytes and 3.4 % where Chromium's decode is the
  clock (the cine at 4× on LTE and 50 Mbit), and buys Firefox 13–26 % in the same cells
  ([`payload-format.md`](payload-format.md) §8-bit grey as 4:2:0). The readers already take either form, so serving it is
  `ingest.py --grey8 420` per series; whether Firefox on slow devices outweighs Chromium's cost is a product call.
  *Found on the way, for row 77 or a transport row (resolved 2026-10-09 by row 115: the server's, fixed):* Firefox 157 cannot dial the relay's fixed 5 Mbit link (every
  try fails) and sometimes fails at 10–30 Mbit — Firefox sends the session's `CONNECT`, the server never finishes the
  QUIC handshake (no connection driver starts in its debug log) and the downloader's 5 s dial deadline closes it; the
  trace links and 50 Mbit dial ([`lab/av1/delivery/grey-420`](../../lab/av1/delivery/grey-420/README.md) §Total time).

* **2026-10-07 20:15 UTC: row 79 COLDRTT — the warm-up costs a ≤ 10-bit series on links under 20 ms.** Fetching dav1d's WASM at the decoder's start (adopted, `21c5cd9`) is −1.0 round trips through WebCodecs and −3.0 through dav1d from 20 ms up, but a WebCodecs series whose probe passes never uses that 238 KB fallback, and it arrives beside the first frame: +26 ms at 10 ms (1/6 rounds), +67 on loopback (0/10), a tie at 20 ms. The brief asked nothing slower on a low-RTT link. The owner decides: keep it, skip dav1d's WASM for a series the page says is ≤ 10 bits (a depth hint in the decoder config, not built), or revert. [`lab/page-open/README.md`](../../lab/page-open/README.md) §Cold round trips by codec.

* **2026-10-07 18:40 UTC: row 74 XENGINE — Safari waits on a device run, the owner's phone decision.** From WebKit's
  source (`webkitgtk-2.52.6`), WebCodecs AV1 on Cocoa is the preview preference `WebCodecsAV1Enabled`, off by default,
  and decodes through libwebrtc's software dav1d, 8-bit 4:2:0 only, to `NV12`; no hardware decoder is on that path. A
  device run must say, per iOS and macOS Safari version: whether `VideoDecoder.isConfigSupported` is true for
  `av01.0.04M.08.0.110.02.02.02.1` with the preference as shipped, and if so whether `lab/av1/exact/engine-readback`'s `g8-420-full`,
  `g8-mono`, `rgb8-gbr` and `g10-420` units come back, in which format, and exact against the manifest's checksums
  (`run.mjs`'s page opened in Safari, results read from the page). Until then the client's per-layout probe decides there, as everywhere.

* **2026-10-07 17:35 UTC: row 70 HTJ2KENC claimed twice.** The night routine's claim `26cb6d9` (17:07) and another
  session's work `e125d38` on `claude/av1-unified` (17:18) both read the same `claimed 2026-10-07 (night)` as their own;
  the night routine stood down unpushed and took the next row, so row 70 is the session that pushed `e125d38`. Two
  sessions writing the same claim text cannot tell their claims apart: a claim could name its session.

* **2026-10-07 03:30 UTC: row 56 LAYOUT's moves wait for rows 44, 59, 60 and 65**, which are still writing in the `lab/av1/` folders it would move: moving them under those sessions would land their next commits in folders that no longer exist. Done and pushed (`f0cb5b8` on `claude/av1-unified`): the five-group tree, every folder's proposed path, in `lab/av1/README.md` §The folders, by what they measure; `lab/README.md` indexes `av1/`; `svcdec/` has a README; `docs/` already sits by subject, nothing to move there. The next session applies the moves with `git mv` once the four are done.

* *Resolved, 2026-10-07 (row 71): one aomenc run per frame, adopted — the bytes no longer depend on `--jobs`.*
  **2026-10-07 01:00 UTC: row 52 INGEST — lossless AV1 bytes depend on `--jobs`.** Ingest codes each worker's frames
  in one aomenc run of keyframes, and libaom carries state across keyframes: on the 10-bit tomosynthesis volume the
  frames after a chunk's start differ between 1, 2 and 4 workers, in the replaced ingest as in the new one (every frame
  exact either way; the fluoroscopy and ultrasound unaffected). One run per frame would make the bytes independent of
  the worker count and change today's bytes. The owner decides; [`lab/av1/exact/coded-frame/README.md`](../../lab/av1/exact/coded-frame/README.md) §One pipeline.

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
