# AV1 queue

The AV1 phase's work, handed to cloud agents: order and state here, findings in the doc that owns
the subject ([`README.md`](README.md) for the phase's decisions, `decode/README.md`, `FIXTURES.md`,
`WIRE.md` for theirs). Separate from [`../cloud-queue.md`](../cloud-queue.md) on purpose: that queue
and its branch belong to other work.

## Protocol

**This queue lives on `claude/av1-mainbase`, and the work on `claude/av1-unified-mainbase`** ([`ORCHESTRATE.md`](ORCHESTRATE.md) for the session that dispatches it; since row 150,
2026-10-12): wherever a row names `claude/av1` or `claude/av1-unified`, read these; the old branches are unused.
**Push only to `claude/av1-mainbase`** — never to
`claude/unified-2026-09-23`, `main` or any other branch, and never edit `docs/cloud-queue.md`.

1. `git fetch origin && git checkout claude/av1-mainbase && git rebase origin/claude/av1-mainbase`.
2. Read `CLAUDE.md`, then [`README.md`](README.md) (this phase), then the table below.
3. Take the **topmost `ready` row**. Set it to `claimed` with the date and a 6-hex id you draw once per session (`openssl rand -hex 3`), e.g. `claimed 2026-10-07 (night, a3f91c)`, commit that alone, push; a row whose claim does not carry your id is not yours. The
   push is the lock: if it is rejected, rebase and take the next `ready` row.
4. Do the lane on its own branch, `claude/wip-<row>-<NAME>` (e.g. `claude/wip-209-READMEASURE`), made from
   `claude/av1-unified-mainbase`; push there early and often. When the row is finished — every check passed, the gate
   green — rebase the branch onto `claude/av1-unified-mainbase` and push it there as a fast-forward. A row cut short
   leaves its branch and a provisional line naming it; the next session continues from that branch.
5. Set the row to `done` with the commit hash after the rebase that pushed it, a one-line verdict
   with its numbers, and where the finding lives. Flip any `after …` row whose prerequisites are now
   all done to `ready` in the same commit. Push.
6. Back to 1. Stop when no row is `ready` and say so; do not invent work.

**The work branch holds finished work only (the owner, 2026-10-14).** `claude/av1-unified-mainbase` is the branch
that will merge into `main`: clean, optimized, completely functional. Work in progress lives on `claude/wip-*`
branches and reaches the work branch only finished, through step 4. **A change that removes or alters what exists does
not land on its own** (the owner, 2026-10-14: review first): a simplification, a removal, a rename or move, a refactor,
a changed default or behaviour, a format, wire or store change, a deleted or weakened test. Such a row finishes on its
wip branch, gate green, and its cell reads `review — claude/wip-<row>-<NAME> <hash>: <what changed, what it removes,
the capability kept>`; the orchestrator opens a draft pull request for it, and it lands only when the owner says so.
Additive work — a new lab harness, a doc section, a lever behind a flag off by default, a fix with its failing test —
lands as step 4 says.

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
`date -u` is at or past that time, and leaves it before. An `after …` clause on the same row still applies. When a row is both `held until` and `after`, clearing its `after` makes it `held until <the same time>`,
not `ready`.

**`local` rows** are for a session on the owner's machine; a cloud session never claims one.

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
* **Arms differ in the lever alone (the owner, 2026-10-10).** A timing prints each arm's full settings — congestion
  controller and its initial window, transport options, codec build, decoder path — and the cell names any difference
  besides the lever. A comparison with another difference decides nothing (row 119 found a 20× initial window between
  row 75's BBR and Cubic arms; row 121 lists what that left open).
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
| 1 | **TOOL** — the encoders and a native decoder, pinned, and a lossless round trip at every depth and layout | done `80f1619` — libaom 3.8.2 and 3.15.1 (pinned), SVT-AV1 v4.2.0, dav1d 1.5.4 built from pinned sources; lossless intra exact in every cell (grey 8/10/12 4:0:0, RGB 8/12 4:4:4, odd size, 2 presets, 16/16 frames, each unit decodes alone); **inter at 10/12 bits inexact on both libaom versions** (1–8 of 16 frames, ≤ 61 669 samples, \|Δ\| ≤ 11; dav1d and aomdec agree, so the encoder) and **exact with `--auto-alt-ref=0`**; 3.15.1's aomenc cannot encode 12-bit 4:4:4; SVT-AV1 4:2:0 8/10-bit only, its 10-bit inter inexact under every setting tried; rav1e 0.7.1 has no lossless mode (1 674 of 196 608 samples wrong at qp 0); 4 mutations caught 4/4 — [`lab/av1`](../../lab/av1/README.md), [`README.md`](README.md) §Measured here |
| 2 | **DATA** — public, freely licensed multi-frame series, fetched and checksummed | done `be384e6` — 5 CC BY series, 310 frames, ~205 MB from the NCI Imaging Data Commons public bucket (TCIA's API, Zenodo, PhysioNet refused by the container's network policy): CT 100 × 512² signed (LIDC-IDRI), MR 58 × 512² (ISPY1), RGB ultrasound cine 70 × 760×421, 12-bit fluoroscopy 18 × 768², 16-bit cone-beam 64 × 512²; every file and set SHA-256-pinned, frames identical to `PixelData` 310/310, 5 mutations caught 5/5; CT spans −2048..3746 and cone-beam 0..7364, both 13 bits after any offset; no open angiography run — [`FIXTURES.md`](../FIXTURES.md) §AV1 data |
| 3 | **WCAP** — what WebCodecs' AV1 decoder supports in headless Chromium, and whether it returns samples exactly | done `58bcd24` — Chromium 141 (headless, no GPU): every 8- and 10-bit cell exact, 16/16 (4:0:0, 4:2:0, 4:2:2, 4:4:4 GBR × intra and G = 8, 8/8 frames each, per plane against the encoder input); **12-bit refused, 8/8** — `decode()` rejects its keyframe while `isConfigSupported` says true (it also says true to profile-illegal strings); `prefer-hardware` unsupported; 4:0:0 returns `I420` with mid-grey chroma; the decoder holds 2 frames until `flush()`, so 1 unflushed chunk gives 0 frames (*corrected:* not the earlier empty probe's cause — it flushed; that stays unexplained) — [`decode/README.md`](../decode/README.md) §AV1, [`README.md`](README.md) §A2, [`lab/av1/exact/webcodecs`](../../lab/av1/exact/webcodecs/README.md) |
| 4 | **WASM** — dav1d built to WASM, exact against native dav1d | done `a82d142` — exact: dav1d 1.5.4 / emscripten 3.1.74, scalar, `-msimd128` and `-pthread` arms match native dav1d and a native build with assembly on every frame of 12 lossless streams (8/10/12-bit 4:0:0 and 4:4:4, intra and G = 8), one picture per temporal unit at frame delay 1; 546 / 623 / 635 KB `.wasm` (219 / 238 / 244 KB gzip); libaom 3.8.2 inter 10/12-bit inexact reproduced (≤ 15 904 of 1 M samples, \|Δ\| ≤ 11) — [`client/decode/wasm/dav1d`](../../client/decode/wasm/dav1d/README.md), [`README.md`](README.md) §A2 |
| 5 | **SEAM** — the codec seam and, if inter coding pays, the group as the transport's unit: a proposal | done `71da41a` — proposed, not measured: `codec` in the bundle's metadata (absent = htj2k, unknown = refused before the dial), one decoder module per codec behind `decoder.js`; G > 1 as the client's unit (`request_frames [k … N]`, a group to one decoder) with 0 wire, store or server changes, 7 invariants named as broken; needs SIZE and SPEED before a G — [`adr-unit.md`](adr-unit.md) |
| 6 | **SIZE** — lossless bytes: AV1 intra, AV1 inter by group length, HTJ2K | done `f4a2655` — **AV1 lossless coded whole is larger than HTJ2K on every real series** (*corrected by DEPTH: split, it is below HTJ2K on every series over 10 bits*)**, and inter collects nothing**: bytes over HTJ2K's at libaom 3.15.1 cpu0, intra → whole series, fluoroscopy 1.024 → 1.027, MR 1.034 → 1.062, ultrasound RGB 1.117 → 1.534 (cpu6 1.04–1.75); smallest G with most of the gain is G = 1; JPEG XL 0.83–0.93 (reference); CT and cone-beam need 13 bits (DEPTH); 122/122 codings exact, each group decoded alone; cjxl 0.7.0 found inexact on 12-bit PGM; 5 mutations caught — [`lab/av1`](../../lab/av1/README.md) §SIZE, [`README.md`](README.md) §A1 *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 7 | **DEPTH** — 12-bit, signed and 16-bit samples in AV1 | done `2ee7a23` — CT (−2048..3746) and cone-beam (0..7364) need 13 bits after any offset, MR and fluoroscopy fit 12; best split **top11+low** (v ≫ 2 at 12 bits, v & 3 at 8): bytes over HTJ2K at libaom cpu0 CT **0.918**, cone-beam 0.997, MR 0.990 (direct 1.034), fluoroscopy 0.946 (direct 1.024); hi/lo bytes worst, 1.20–1.37; top10+low keeps every stream ≤ 10 bits (WebCodecs-decodable) at 0.994–1.071; two streams decode in the time of one (native dav1d, n = 15 interleaved; merge 0.05 ms/512²); 12-bit needs dav1d, WebCodecs refuses it; 44/44 splits exact, 3 mutations caught — [`lab/av1`](../../lab/av1/README.md) §DEPTH, [`README.md`](README.md) §A3 |
| 8 | **DEC** — an AV1 decoder behind `decoder.js`'s contract, chosen by the series' codec | done `cf00cc7` — built at G = 1: `decoder.codec: "av1"` loads `av1-dav1d.js` (dav1d-WASM `simd`, 623 KB, flushed before every frame) behind the unchanged contract; all 6 shapes (8/10/12-bit grey and RGB) exact through the downloader against the generator's checksums, a frame of a group, an empty unit and a non-AV1 file refused, an unknown codec refused before the dial; dispatch 105 → 123/123, every new check mutated to fail; no wire or store change needed — [`client/README.md`](../../client/README.md), [`adr-unit.md`](adr-unit.md) §2 |
| 9 | **SPEED** — decode time per frame and per group: dav1d-WASM, WebCodecs, OpenJPH; the ask and fill it implies | done `b08eeab` — **AV1 decodes 5–10× slower than HTJ2K and wins on nothing here**: product worker, first 18 frames of fluoroscopy, MR and ultrasound, 16 interleaved rounds, Node and Chromium 141 at 1× and 4×, 7 488/7 488 frames exact, 2 mutations caught 13/13 cells; dav1d-WASM 5.4–9.7× OpenJPH (fluoroscopy 70 vs 9.8 ms, MR 26 vs 4.9, ultrasound 48 vs 7.9 in Chromium at 1×), slower in 224/224 paired rounds, dav1d itself ~90 % of it; WebCodecs 4.1–4.2× (ultrasound only: it refuses 12 bits); at G = 1 an ask pays 20–260 ms more decoding, and at 4× on a 50 Mbit link AV1 becomes the fill's clock on every series where HTJ2K never is (arithmetic) — [`decode/README.md`](../decode/README.md) §Decode time against HTJ2K, [`README.md`](README.md) §A1–A2, [`lab/av1/decode/per-frame`](../../lab/av1/decode/per-frame/README.md) *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 10 | **CONTENT** — the content the verdicts lack: tomosynthesis and a contrast angiography run | done `7dd4d9f` — **inter does not pay on tomosynthesis either**: two CC BY 4.0 breast tomosynthesis volumes (EA1141, 1 mm; 29 × 614×1359 12-bit, 24 × 678×1727 10-bit cropped to the breast, crop drops only zeros), libaom 3.15.1 cpu0: best group against intra +1.2 % (12-bit, G = 2) and −0.6 % (10-bit, whole; −1.8 % at cpu6), far from `adr-unit.md` §4's fifth; AV1 over HTJ2K intra 1.043 and **0.977 — the first series where AV1 coded whole is smaller**; top11+low 0.943 and 0.946; JPEG XL 0.917, 0.851; 54/54 codings exact, each group decoded alone; the new crop and its pin mutated, 2/2 caught; **no open angiography run**: every IDC XA series is single frames (Blocked) — [`lab/av1`](../../lab/av1/README.md) §SIZE, §DEPTH, [`FIXTURES.md`](../FIXTURES.md) §AV1 data, [`README.md`](README.md) §A1, §A3 *Confirmed at scale (row DBTSCALE): coded whole 1.054–1.083 of HTJ2K on ten 12-bit volumes, 0.776–0.975 on five 10-bit ones.* |
| 11 | **FILL** — the fill's decode measured, not multiplied: three decoders, HTJ2K against AV1, through the downloader | done `a878dd9` — **at 1× AV1 fills at the wire's pace; at 4× on 50 Mbit it is the fill's clock on every series, HTJ2K on none**: whole series through the downloader, three decoders, real server behind the relay (40 ms), Chromium 141, 20 and 50 Mbit, 40/16 rounds Williams-ordered, 230/784 `VOID` dropped, n = 12–30; 40 544/40 544 frames exact, 2 mutations caught 7/7; AV1 slower in 174/174 pairs — at 1× +86 to +895 ms (+4–12 %, its bytes; decoding ends 24–72 ms after the last byte), at 4×/50 Mbit 0.50–1.85 s of decoding after the last byte against HTJ2K's 20–38 ms, the fill +27 % MR, +35 % fluoroscopy, +68 % ultrasound (5.34 vs 3.17 s); 94–274 ms behind at 4×/20 Mbit; WebCodecs keeps up on the 8-bit ultrasound (116 ms behind at 4×); the arithmetic's verdict holds, its sizes were optimistic — [`README.md`](README.md) §A1, [`lab/av1/delivery/fill`](../../lab/av1/delivery/fill/README.md) *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 12 | **PREVIEW** — a lossy first picture, the exact frame after: what it buys a cine on a phone link | done `f05c8f4` — **a lossy AV1 preview at 0.78 % (fluoroscopy, CRF 20, 43.9 dB, max \|Δ\| 433 of 4095) and 7.0 % (ultrasound, CRF 32, 34.2 dB) of the exact HTJ2K bytes makes the cine playable 74–124× and 14× sooner on 5 Mbit/s** (0.12–0.20 s against 14.8 s; 2.0 s against 28.8 s) and 4–32× sooner than HTJ2K's half-size prefix (26–32 % of the bytes, 27 dB); every frame exact later by that share, +0.8 % and +7 %; dav1d-WASM decodes a preview frame 1.1–3.3× slower than OpenJPH the exact one, so at 50 Mbit/s and 4× it loses to HTJ2K's prefix (1.21 against 0.93 s), WebCodecs 2.4–13× faster than dav1d-WASM (0.24 s); G = 8, not the whole series, keeps decoders parallel; timeline arithmetic over measured bytes and decode times (15 interleaved rounds, Chromium 141, 1× and 4×, 68 640/68 640 frames matching), no angiography run available, whether a lossy first picture is acceptable is the owner's — [`README.md`](README.md) §A5, [`lab/av1/delivery/preview`](../../lab/av1/delivery/preview/README.md) *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 13 | **SPLIT10** — the top10+low split through WebCodecs: exact, and how fast | done `92596c4` — **exact, and 2–3× faster than dav1d-WASM, still 2–4× slower than HTJ2K**: Chromium 141 headless, CT, cone-beam, MR and fluoroscopy, first 18 frames, 16 interleaved rounds at 1× and 4×, 9 216/9 216 frames exact; WebCodecs top10+low (two `VideoDecoder`s, merged) 0.44–0.50 of dav1d-WASM top11+low's time at 1× and 0.32–0.40 at 4× (faster in 128/128 paired rounds; CT 13.5 against 29.2 ms, fluoroscopy 36.3 against 83.4), 2.6–3.9× OpenJPH at 1×, 2.1–3.7× at 4×; the decoder, not the split, is the gain (dav1d-WASM on top10+low 0.89–0.97 of top11+low); bytes top10+low 0.973–1.064 of HTJ2K, top11+low 0.904–0.998; WebCodecs' thread count not measured; 5 mutations caught — [`README.md`](README.md) §A3, [`lab/av1/decode/split-webcodecs`](../../lab/av1/decode/split-webcodecs/README.md) |
| 14 | **ENC** — encode time, uncontended, per preset and content: ingest cost, and whether lossless can run live | done `91bd48d`, `ab44e49` — **lossless AV1 cannot be encoded live except at its fastest intra preset, and then larger than HTJ2K**: libaom 3.15.1, one uncontended core, 8 frames a set × 26 presets × 3 interleaved rounds, 546/546 runs exact; slowest preset 3.0–11.1 s a frame; fastest intra within 2 % of its bytes 0.35–1.6 s (0.6–2.9 frames/s: MR good6, CT allintra6, cone-beam good6, fluoroscopy allintra7, tomosynthesis good6 / allintra5), the RGB ultrasound only at the slowest (7.2 s); 30 frames/s of 512² only at allintra9 on MR (36.7) and CT (33.3), 1.05–1.19 of the slowest's bytes and above HTJ2K's; real-time inter exact at 10–13 bits and the smallest AV1 coding on 10-bit tomosynthesis (0.94 of HTJ2K, 5.5–9.6 frames/s); `ojph_compress` 58–136 frames/s into fewer bytes; 5 mutations caught — [`lab/av1`](../../lab/av1/README.md) §ENC, [`README.md`](README.md) §Measured here *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 15 | **SVC** — libaom's real-time scalable encoder in lossless mode at 10 and 12 bits: exact or not | done `769c5e2` — **exact in every cell it encodes**: libaom 3.15.1 `svc_encoder_rtc` at `--min-q=0 --max-q=0` (no hook), grey 4:0:0 and RGB 4:4:4 at 8/10/12 bits, L1T1/L1T3/L2T1/L3T3 scaled and full-size, speeds 7 and 10, synthetic and the fluoroscopy, MR and ultrasound series: 418 layers, 10 436/10 436 frames, each operating point decoded alone; the stock example encodes 8/10-bit 4:2:0 only — 12-bit, 4:4:4 and 4:0:0 need a patch to its CLI, kept in the lab; scaled layers have no truth and are not compared; 1.07–1.58 of HTJ2K's bytes at L1T1; 5 mutations caught — [`lab/av1/delivery/scalable/encoder`](../../lab/av1/delivery/scalable/encoder/README.md), [`README.md`](README.md) §Measured here |
| 16 | **GOP** — the group as the item: whole groups asked and sent in order, a group to one decoder, fill start to end | done `9cd929f` — **built, no wire, store or server change**: `groupLength` + `frameCount` beside `decoder`; an ask for any frame asks its whole group k … k+G−1 (cut at the series' end), a fill asks whole groups and a fill cut by an ask resumes mid-group on the decoder still holding it; a group goes to one decoder in index order — a split across decoders impossible by construction (a non-keyframe goes only to the decoder that took its predecessor) and refused by `av1-dav1d.js` if it happens; a failure fails the rest of its group by name; groups decode through dav1d-WASM only (WebCodecs is flushed per frame), a split series stays G = 1; a G = 8 set (20 frames, short last group) and a one-group set (12 × 12-bit) exact frame by frame against the generator's checksums, frames landing last to first still decode in order; 191/191 dispatch checks, 11 mutations caught 11/11, gate green; nothing timed — [`adr-unit.md`](adr-unit.md) §3 *Built*, [`client/README.md`](../../client/README.md) |
| 17 | **RESID** — a lossy AV1 preview plus a lossless residual: does the exact frame cost more than HTJ2K alone? | done `688db3f` — **the preview is free in bytes, not in decode**: the exact frame as a lossy AV1 preview (libaom 3.15.1 cpu6, G = 8, CRF 8–44, grey 4:0:0 10-bit, colour BT.601 4:2:0 converted back in integer arithmetic) plus source − preview coded losslessly; all seven series: preview + HTJ2K residual **0.947–1.002 of HTJ2K alone** at each series' best CRF (−5.3 % ultrasound, −5.0 % CT, +0.2 % 12-bit tomosynthesis; 0.947–1.021 over all 28 cells) against preview-then-HTJ2K's 1.001–1.222; the residual in AV1 better only on 10-bit tomosynthesis (0.930), colour 1.13–1.61; decode of preview + residual + add **1.31–1.89× HTJ2K alone through WebCodecs** at 1× (1.23–1.74× at 4×; slower in 207/210 paired rounds), 2.1–3.1× through dav1d-WASM, 4.9–11× with the residual in AV1; lossy output bit-identical across native dav1d, dav1d-WASM and WebCodecs 13 440/13 440 (8-bit 4:2:0, 10-bit 4:0:0), every frame exact 16 800/16 800 (headless Chromium 141, first 16 frames, 15 interleaved rounds at 1× and 4×); 5 of 6 mutations caught, a 1/65 536 nudge of a colour constant changed no sample — [`README.md`](README.md) §A5, [`lab/av1/delivery/residual`](../../lab/av1/delivery/residual/README.md) *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 18 | **SVCQ** — one scalable AV1 payload, a lossy base layer and a lossless top: the overhead of the layers | done `945f989` — **exact, and scalability nearly free, but it carries lossless AV1's size**: libaom 3.15.1 `svc_encoder_rtc` (lab patch `--layer-q`), two spatial layers, base half or full size at q 20–55, top lossless; every top frame exact on fluoroscopy, MR, ultrasound and two synthetic sets; total 0.95–1.04 of single-layer lossless AV1, so **1.04–1.64 of HTJ2K** against PREVIEW's 1.008–1.07 and RESID's 0.947–1.002; a half-size base is 0.03–2.4 % of HTJ2K at q 40–55 and decodes in 2–13 % of a lossless frame's time; the exact frame 3–30 % slower than single-layer (dav1d-WASM, Chromium 141 and Node, 1× and 4×, n = 15 interleaved, 270/270 a cell); `av1-dav1d.js`'s `all_layers` 1 returns the base then fails on such a payload; WebCodecs returns the top exactly and cannot choose an operating point; 5 mutations caught — [`lab/av1/delivery/scalable/two-layer`](../../lab/av1/delivery/scalable/two-layer/README.md), [`README.md`](README.md) §A5 *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 19 | **LCEVC** — the enhancement-layer standard: licence, whether it can end lossless, a browser decoder, a trial | done `7af0a66` — **no trial possible, and not exact at 14 bits**: no open LCEVC encoder exists; LCEVCdec 4.2.2 and LCEVCdecJS 1.3.0 are BSD-3-Clause-Clear and grant no patents (commercial terms unconfirmed); the web decoder draws 8-bit RGBA through WebGL, no samples back, and the decoder's own WASM port is "not complete"; no lossless mode, but from the source at step width 1 the dequantisation is the identity and residuals land at 2^−f of a sample (f = 7/5/3/1 at 8/10/12/14 bits, nothing deeper), so an exact frame is reachable at 8–10 bits, at 12 with the 2×2 transform (256/256 classes; 4×4 36/36 patterns, not proven), and **not at 14: 128/256 offset classes of a 2×2 block unreachable**, so the 13-bit CT and cone-beam cannot end exact; a model of the decoder (the container refused to build it), 6 of 7 mutations caught — [`README.md`](README.md) §A5, [`licensing.md`](licensing.md), [`lab/av1/bytes/lcevc`](../../lab/av1/bytes/lcevc/README.md) |
| 20 | **WCDEC** — a WebCodecs AV1 decoder module beside dav1d-WASM, chosen per series where exact | done `5810acc` (`7996c01`) — built at G = 1: `av1-webcodecs.js` taken when the series says `depth` ≤ 10 and `VideoDecoder` exists, dav1d-WASM otherwise (absent depth included); the top10+low split (`[u32le top length][top][low]`, `split`) and a signed `offset` undone by both through a shared `av1-frame.js`; headless Chromium 141 dispatch arm 123 → 167/167: 8/10-bit grey and RGB exact through WebCodecs (4/4 units seen reaching it), the same with `VideoDecoder` removed and 12-bit with it present exact through dav1d (0 units), 13-bit, 13-bit signed and 16-bit signed splits exact through both, 7 bad units refused by both and the next frame exact, frames one at a time; 17/17 mutations caught, 1 equivalent (`codedWidth` = `visibleRect` on Chromium); YUV 4:4:4 with an unspecified matrix would pass WebCodecs' check where dav1d refuses it; **G > 1 not built** — waits on row 16's group path; not timed — [`decode/README.md`](../decode/README.md) §WebCodecs, the decoder the client runs, [`adr-unit.md`](adr-unit.md) §2 |
| 21 | **TAXO** — the cine-like taxonomy's content: breast ultrasound cine, automated breast ultrasound, tomosynthesis projections, angiography | done `296a0f4` — **inter does not pay on tomosynthesis projections either, and split they are under HTJ2K**: two CC BY 4.0 EA1141 series of raw views from two vendors' systems (9 × 1914×2572 cropped to the breast, 15 × 1280×2048), 14 bits as stored (one saturated value, 16383, above data ending at 3648 and 1794); top11+low by group, libaom 3.15.1: best group 0.29 % under intra (G = 8) on one, 0.2–1.0 % over on the other; **top12+low — the two low bits apart, the rule DEPTH found at 13 bits — 0.952 and 0.923 of HTJ2K**, top11+low 0.998 and 1.002, hi8+lo8 1.08–1.34; JPEG XL 0.937, 0.929; 32/32 split codings exact, each group decoded alone, 387/387 frames identical to `PixelData`; 3 pin and 3 group mutations caught 6/6; **no breast ultrasound cine, ABUS or multi-frame angiography reachable** — IDC has none, the other hosts are refused (Blocked) — [`lab/av1`](../../lab/av1/README.md) §SIZE, §DEPTH, [`FIXTURES.md`](../FIXTURES.md) §AV1 data, [`README.md`](README.md) §A1, §A3 |
| 22 | **EMBED** — embedded lossy-to-lossless intra codecs for contrast: JPEG 2000 quality layers, progressive lossless JPEG XL | done `12d86fe` — **an embedded preview is free in bytes and dear in decode**: JPEG 2000 Part 1 with three quality layers (OpenJPEG 2.5.4, 5/3, LRCP) costs 0.09–0.19 % over one layer and is 0.93–0.96 of HTJ2K's bytes whole; its first layer is 0.4–0.9 % of them at 37–43 dB on grey (25 dB RGB ultrasound) and decodes in 1.0–1.4× OpenJPH's exact time, but **the exact frame decodes 6–12× slower than OpenJPH** (210/210 paired rounds); about twice AV1's preview bytes for the same PSNR, though inside the exact frame; progressive lossless JPEG XL (libjxl 0.12.0, `-p`) draws its first picture only after 6–48 % of the bytes (28–47 dB; libjxl pauses at no step in a lossless frame), first picture 1.3–2.9× and whole 4.0–6.2× OpenJPH, 0.91–0.95 of its bytes; all seven sets, headless Chromium 141, 15 interleaved rounds at 1× and 4×, 22 680/22 680 frames exact, 4 mutations caught — [`README.md`](README.md) §A5, [`lab/av1/bytes/embedded`](../../lab/av1/bytes/embedded/README.md), [`licensing.md`](licensing.md) *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 23 | **TOTAL** — total time on phone-like links, the measure that decided against AV1 before: HTJ2K against every AV1 form, per taxonomy series | done `2cf4a5c`, `06c106b` — **top11+low wins where the wire is the clock, HTJ2K where a slow CPU meets a fast link**: 14 rounds, then 10 replicated in a second container, 121 222/121 222 frames exact; on the 12-bit series top11+low fills at 0.93–0.98 of HTJ2K's time at 1× on every link; at 4× on 50 Mbit dav1d-WASM intra takes 1.40–2.22× and WebCodecs 1.17–1.38×; the RGB ultrasound loses 10–19 % wherever the wire is the clock; HTJ2K has the first frame on every cell; the fluoroscopy's preview is playable in 0.34–0.45 s at 1× and 0.83–1.2 s at 4×, against 1.7–15 s for every exact frame; the decode-bound cells move 15–25 % between containers, so only the ranking is claimed — [`README.md`](README.md) §Total time *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 24 | **SVCDEC** — a scalable payload in the client: the base operating point first, the exact frame from the same bytes | done `68775d5` — **built: the base reaches the page as a preview, then the exact frame, from the same bytes, through dav1d-WASM**; the cause of row 18's failure was the wrapper keeping one picture a unit (dav1d at `all_layers` 1 outputs the base while the top is still queued), so it now drains the unit (`av1_next`, `av1_layer`, `av1_top_layer`; 623 146 B); a picture below operating point 0's top goes to `onPreview` as a frame marked `preview: true` at its own size, never to an ask or `onFrame`; one port, so a preview always lands before its frame and never after; 10-bit G = 1 (asked) and 12-bit G = 8 (20 filled), two spatial layers, half-size base at q 40: every exact frame its source's at 64×48, one preview a frame, 32×24, identical to native dav1d at operating point 1; a unit without its top shows its preview, still marked, and fails by name (`spatial layer 0 of 1 is the unit's last`); single-layer series send none; WebCodecs (≤ 10 bits) exact, no preview (row 31); a base fed alone at operating point 0 is a preview and then a failure, so §5's base entry needs the decoder told; dispatch 181 → 199/199, 8 mutations caught 8/8, gate green; not timed — [`adr-unit.md`](adr-unit.md) §6, [`client/README.md`](../../client/README.md) |
| 25 | **SVCSHAPE** — the scalable shape with the least overhead: layers, scale, base quality, per content | done `258e42b` — **a quarter-size base at q 40 has the least overhead on every series**: libaom 3.15.1 `svc_encoder_rtc` (SVCQ's patch), 20 shapes × 9 series of rows 2, 10, 21 (spatial ½ and ¼, a full-size lossy base, three layers, L1T2/L1T3, L2T3, base q 20/40/60, keyframe every 1, 8 or one), over 12 bits the two low bits apart; 180/180 codings exact, 387 frames each; quarter total 0.968–1.003 of single-layer lossless AV1, its exact frame 0.97–1.06× single's decode at 1× and 0.97–1.10× at 4× (dav1d-WASM, Chromium 141, n = 10 interleaved, 8 640/8 640 frames exact), base 0.01–0.36 % of HTJ2K's bytes at 30 dB (ultrasound) and 34–47 dB (grey), so a series' bases are playable in 0.01–0.11 s at 1× and 0.06–0.5 s at 4× on 5, 20 and 50 Mbit/s alike (arithmetic, decode-bound) against 16–60 s for the exact series at 5 Mbit/s; a full-size q 20 base is 1–5 % smaller on CT, MR, fluoroscopy and ultrasound but decodes 5–32 % slower; a third layer, temporal layers (−3 to +4 %, an exact base at 16–44 % of HTJ2K), L2T3 (+3–6 %) and shorter keyframe intervals buy nothing; every shape keeps lossless AV1's size, 0.94–1.59 of HTJ2K's; 7 mutations caught — [`lab/av1/delivery/scalable/shape`](../../lab/av1/delivery/scalable/shape/README.md), [`README.md`](README.md) §A5 *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 26 | **SVCORDER** — delivering bases first: what the store and the group-as-item model need (a proposal) | done `3234f88` — **proposed: each frame as two entries, layer-major — the base alone (entry i), then the whole temporal unit (entry F + i)** — so a fill over the bundle is every base and then every exact frame, with the wire, the store's format, the planner and the server unchanged and an ask for exact N one entry and one decode at G = 1; costs the base's bytes twice (0.07–2.4 % of HTJ2K's at a half-size base, q 40, row 18) and a second decode of each base (2–13 % of a lossless frame's); a top-only entry (no duplicate) breaks the exact frame's independence, a per-layer byte range changes the wire and the server; WebCodecs picks the layer by what it is fed; 5 invariants named broken; the arm: single-layer AV1 against bases-first on row 11's harness after rows 24–25; nothing measured — [`adr-unit.md`](adr-unit.md) §5 |
| 27 | **DECSPEED** — the decode is what loses on a phone: encoder settings and decoder threads that cut it, lossless kept | done `1b24aac` (`ed04f9a`, `85255b6`, `6fdba6b`) — **tiles and threads cut a frame's decode, not a fill's**: a lossless frame is 66–84 % entropy decoding; no encoder setting cuts it more than 10 % (presets, 64² superblocks, intra tools off, at +6–72 % bytes); dav1d-WASM threads do nothing untiled, and with 4 tile columns (+0.1–0.4 % bytes) × 3 threads a frame takes 0.37–0.44 of its time (fluoroscopy 29 against 76 ms at 1×, 116 against 314 at 4×), still 2.6–2.9× HTJ2K; through the fill at 50 Mbit, 4× as three slowed cores, 12 rounds, 24 528/24 528 frames exact, every threads × decoders arm is within −3 to +4 % of today's three decoders (+11–15 % oversubscribed on MR): best, 1 decoder × 3 threads on 4-tile frames, 1.81–2.39× HTJ2K's fill at 4× against today's 1.82–2.32× — [`README.md`](README.md) §A1, [`lab/av1/decode/settings`](../../lab/av1/decode/settings/README.md) |
| 28 | **LLSIZE** — closing lossless AV1's byte gap to HTJ2K with AV1 alone | done `ee49f8d` — **AV1 alone is under HTJ2K on every series at G = 1, 0.902–0.987, once its samples are represented for it**: libaom 3.15.1 cpu0 intra, first 2–8 frames of all nine series, every coding exact; the two low bits apart on grey at every depth over 8 (fluoroscopy 1.027 → 0.942, 12-bit tomosynthesis 1.040 → 0.941, MR 1.013 → 0.977, 10-bit tomosynthesis 0.977 → 0.942) and JPEG 2000's reversible colour transform on RGB (ultrasound 1.117 → 0.962), plus `--tune-content=screen --sb-size=64` for 0–1 %; CT 0.902, cone-beam 0.987, projections 0.953 and 0.923; libaom's other controls (superblock size, all-intra, palette/intra block copy alone) 0–1 %, every optional intra tool off +6–64 %, SVT-AV1 0.98–1.08 and never smaller, YCoCg-R 1.2 % behind the RCT, one or three low bits worse than two; no libaom release after 3.15.1; decode (dav1d-WASM, Node, n = 15 interleaved) the colour transform 0.89–0.95× row SIZE's coding, the split +1–5 % on large frames and +16–23 % on 512² MR and 10-bit tomosynthesis; **inter pays on the colour-transformed ultrasound: one keyframe in 8, 0.850 of HTJ2K** (GBR inter 1.355), decoding 0.81–0.83× GBR intra; on grey inter is level or worse; 7 mutations caught — [`lab/av1/bytes/represented`](../../lab/av1/bytes/represented/README.md), [`README.md`](README.md) §A1 *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 29 | **SWEEP** — AV1-only options nobody has listed yet: a read-only identification sweep | done `2b60e32` — **three options worth a row, four not, phones blocked**, read from primary sources (AV1 spec `5e04f3f`, dav1d 1.5.4, libaom 3.15.1, Chromium `d84e3b8`, WebKit `10740b3`, Android framework `1cdfff5`, AVM `v1.0.0`), nothing run: WebCodecs' `optimizeForLatency` is dav1d's `max_frame_delay = 1` in Chromium — the cause of WCAP's two frames held until `flush()` and of the flush per unit that keeps WebCodecs at G = 1 (row 30); the base layer through WebCodecs by dropping OBUs with `spatial_id` > 0, since Chromium's dav1d at `all_layers = 0` outputs the highest layer it holds (row 31); AV2's AVM v1.0.0 (2026-05-27) has lossless, monochrome and 10/12 bits, its lossless gain claimed, unconfirmed (row 32); S-frames cannot switch exactly (other references), super-resolution breaks `AllLossless` (libaom disables it under `--lossless`), large-scale tile is camera-array only and dav1d lacks it, reference scaling is already the spatial layers; Android names AV1 Main 8/10 only and guarantees level 4.1 (2 359 296 samples, under the 4.9 and 2.6 M-sample projections), WebKit's in-process WebCodecs AV1 takes 8-bit 4:2:0 only (Blocked) — [`README.md`](README.md) §Options to try |
| 30 | **WCLAT** — WebCodecs with `optimizeForLatency`: a frame out per unit without a flush, groups through WebCodecs, and tiles | done `5e693b6` (`687ebc7`, `7bf43c5`, `1742210`) — **yes: with `optimizeForLatency` every unit gives its frame without a flush, exact, and a group now goes through WebCodecs**: headless Chromium 141, libaom 3.15.1, 28 streams (8/10-bit 4:0:0, 4:2:0, 4:2:2, 4:4:4 identity, intra and G = 8; fluoroscopy top10 and ultrasound at 1/2/4 tile columns), 784/784 frames out per unit and exact, 0/784 with neither option; skipping the flush 7–20 % faster a frame at 1×, 3–28 % at 4× (10 interleaved rounds), but a keyframe needs one (else a non-keyframe labelled key decodes against the last frame), and flushing before each costs as much — so `av1-webcodecs.js` flushes at a group's end (G = 1 unchanged) and before a keyframe only while a cut group is held, a stalled unit after 2 s; 4 tile columns 33 → 15 ms (1×), 118–135 → 66–70 ms (4×) at −0.6 to +0.4 % bytes; dispatch 209 → 219/219, each guard mutated to fail — [`decode/README.md`](../decode/README.md) §WebCodecs without a flush, [`lab/av1/decode/latency`](../../lab/av1/decode/latency/README.md) |
| 31 | **WCBASE** — the base operating point of a scalable payload through WebCodecs, by dropping the top's OBUs | done `b3c4f83` (`cb19199`) — **exact, and faster than dav1d-WASM's preview except on small grey bases at 1×**: row SVCQ's two-layer payloads (q 40 base, half and full size, one keyframe and G = 1) on the ultrasound, the fluoroscopy and MR as their top 10 bits and synthetic grey 10 / RGB 8; the unit with the OBUs of `spatial_id` > 0 dropped — its prefix, byte for byte the encoder's base-only stream, 762/762 — gives through WebCodecs the base identical to native dav1d's at operating point 1, 534/534, and the whole unit the exact frame, 534/534; 12 bits refused (row 3); a flush per unit needs G = 1 (a key chunk after every flush: −1 to +1 % bytes on grey, +7–13 % on the ultrasound), past G = 1 `optimizeForLatency` gives each base from its own unit, 0/178 late; unit to picture in the contract, headless Chromium 141, 15 interleaved rounds: 0.65–0.66× dav1d-WASM's preview on the ultrasound at 1× (5.5 against 8.4 ms), 0.36–0.76× on every series at 4× (faster in 87/90 paired rounds; 12.6 against 36.5 ms), 1.10–1.31× on the 2–4 ms grey bases at 1×; the base 7–36 % of WebCodecs' exact frame; 19 440/19 440 timed pictures matched; 3 mutations caught (top OBUs kept, base OBUs dropped, a sample flipped); the scalable encoder's lab patch gains `--rgb` (sRGB tags, identity matrix), which WebCodecs needs; not built into the product — [`README.md`](README.md) §A5, [`lab/av1/delivery/scalable/webcodecs-base`](../../lab/av1/delivery/scalable/webcodecs-base/README.md) *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 32 | **AV2** — AVM v1.0.0 lossless: bytes and decode against libaom 3.15.1 and HTJ2K | done `eea24ce` — **AV2 is the smallest lossless coding on grey up to 13 bits but CT, at 50–110× libaom's encode time**: AVM v1.0.0 has no profile over 10 bits, so 11–14-bit samples are coded split (v ≫ k at 10 bits + the k low bits); one middle frame a series, 68/68 cells exact through `avmdec`; at `cpu-used` 0 it is 0.937–0.964 of HTJ2K on fluoroscopy, MR, cone-beam and both tomosynthesis volumes, 0.4–4.7 % under libaom on the same planes; libaom's 12-bit split stays 3–8 % smaller on CT and the 14-bit projections; the RGB ultrasound is 1.648 against libaom's 1.117; four tomosynthesis slices as one group 0.922 against libaom's 0.978; 450–11 900 s to encode a frame, native decode 3.1–6.5× dav1d's; no browser decoder exists — [`lab/av1`](../../lab/av1/README.md) §AV2 *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 33 | **REP14** — the layout of 13- and 14-bit samples: two low bits apart (12-bit top, dav1d only) against streams of ≤ 10 bits (WebCodecs), by total time | done `1b237dd` (`a401972`, `3335fe2`) — **at 13 bits top10+low through WebCodecs, at 14 bits the two low bits apart where the wire is the clock and HTJ2K where it is not**: libaom 3.15.1 `--tune-content=screen --sb-size=64` cpu0, every frame of the two 14-bit projection series and the CT; bytes over HTJ2K d12 (v ≫ 2 at 12 bits + 2 low) 0.953/0.923/0.917, w10 (top 10 + 4 or 3 low) 0.999/1.046/0.931, the fastest preset within 2 % (`--allintra` 7/9, cpu6 on the CT) +0.0–1.3 %; decode in Chromium through `decoder.js` w10 by WebCodecs 0.37–0.51 of d12's, still 2.6–2.8× OpenJPH; total time, 12 rounds on row TOTAL's links, n = 10–12: CT w10 0.87–0.96 of HTJ2K on every cell (d12 1.52 at 4× on 50 Mbit), projections d12 0.93–0.99 at 1× and at 5 Mbit, 1.01–1.63 at 4× on 20 Mbit and faster, w10 0.98–1.13; 9 920 + 44 640 frames exact — [`README.md`](README.md) §A3 |
| 34 | **TOTAL2** — row 23 again with row 28's representations, and the colour-transformed ultrasound at G = 8 through WebCodecs | done `1ece9a3` (`e0de2b6`) — **through WebCodecs row LLSIZE's codings fill first on 22 of 24 cells, losing only at 4× on 50 Mbit**: fluoroscopy, both tomosynthesis volumes and the ultrasound, 5/20/50 Mbit at 1× and 4×, 932 of 1 022 visits kept, n = 10–15, 38 744/38 744 frames exact; the two low bits apart (top ≤ 10 bits, 0.942–0.944 of HTJ2K's bytes) through WebCodecs 0.94–0.97 of HTJ2K's fill time but 0.99–1.02 at 4× on 50 Mbit, through dav1d-WASM 1.43–1.62 there; the ultrasound, HTJ2K's on every cell in row 23, is AV1's with the colour transform (0.958 intra, 0.948 at G = 8 over all 70 frames, not row 28's 0.850 on 8), 0.95–0.97 but 1.06 (intra) and 1.16 (G = 8) at 4× on 50 Mbit; first frame through WebCodecs −38 to +88 ms of HTJ2K's; `rct` built into the client (dispatch 227/227, 3 mutations caught) — [`README.md`](README.md) §Total time, [`lab/av1/delivery/total-time`](../../lab/av1/delivery/total-time/README.md) *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 35 | **DATA2** — breast ultrasound cine and contrast angiography, if their hosts are now reachable: bytes, decode and total time | done `f5e2411` — **stopped at its first step: the hosts are still refused** — `zenodo.org` and `www.cancerimagingarchive.net` (and `services.cancerimagingarchive.net`, `figshare.com`, `data.mendeley.com`, `huggingface.co`, `physionet.org`, `www.kaggle.com`, `osf.io`) answer CONNECT 403 from the container's egress policy, 2026-10-04 20:43 UTC; nothing fetched or measured, no verdict on breast ultrasound cine or angiography — [`## Blocked`](#blocked) |
| 36 | **ENCX** — where lossless bytes and decode can still be cut: the low stream, the split per series, temporal noise, and whether HTJ2K gains from the same representations | done `f243825` (`1227eaf`, `7e65532`, `1aa25db`, `d9745cc`) — **HTJ2K gains 0.9–1.6 % from the same split, only with its low bits deflated, so row 28's gain is AV1's (0.916–0.997 of HTJ2K on the same split); the low bits deflated cost AV1's bytes ±0.5 points and decode 0.64–0.83× of row 28's coding**: all nine series, libaom 3.15.1 cpu0, 358/358 codings exact; three low bits beat two on the four series with noise σ ≥ 17 (0.5–3.9 %, cone-beam 0.987 → 0.948; row 28 tried three at libaom's defaults only, corrected in place), decoding 0.59–0.78×; the top through WebCodecs (≤ 10 bits, k = 3 brings CT and cone-beam there) with the low deflated 0.34–0.56× of row 28's decode, 2.1–3.4× HTJ2K's (headless Chromium 141, 1× and 4×, 10 interleaved rounds, 7 100/7 100 frames exact); k̂ = ⌊log2 σ⌋ wrong on four series, ⌊log2 σ⌋ − 1 right on all nine but fitted to them; inter finds nothing in the noise (low stream inter 0–3.6 % larger); libaom's tools: palette worth 4.5–9.2 % and already on, the rest ±1 %; total time arithmetic only (row 34); 9 byte and 4 browser mutations caught — [`lab/av1/bytes/low-stream`](../../lab/av1/bytes/low-stream/README.md), [`README.md`](README.md) §A1 |
| 37 | **XBROWSER** — the AV1 decode path (dav1d-WASM, the WebCodecs probe and its fallback) in WebKit and Firefox engines: exact, chosen right, how fast | done `653f6d7` (`bcf123f`, `de1df45`) — **dav1d-WASM and OpenJPH exact in Chromium 141, Firefox 157 and WebKitGTK 2.52; the client's WebCodecs choice exact in Chromium only**: first 4 frames of all nine series and an 8-bit grey set in every row-28 layout, stock engines (Playwright's builds refused), 6 interleaved rounds at 1× and 4×; dav1d-WASM 408/408 and HTJ2K 240/240 a cell in every engine, 4.1–9.6× OpenJPH at 1× and 3.9–10.0× at 4× (slower in 732/732 paired rounds), each engine 0.85–1.22× Chromium's time on the same arm; the SIMD build loads in all three, and OpenJPH needs SIMD as well; WebCodecs (chosen at `depth` ≤ 10) 240/240 in Chromium at 2.6–5.0× OpenJPH, **0/240 a cell in Firefox** (monochrome refused, 4:4:4 returned as 8-bit `BGRX`) **and WebKitGTK** (GStreamer's `av1dec` takes no AV1 here, 4:2:0 controls included), with no fallback to dav1d; WebKitGTK as shipped has no `SharedArrayBuffer`, so HTJ2K fails too (0/148); a decode probe with fallback proposed, not built; desktop engines in a container, not phones; 5 mutations caught — [`decode/README.md`](../decode/README.md) §AV1 in WebKit and Firefox, [`lab/av1/exact/engines`](../../lab/av1/exact/engines/README.md) |
| 38 | **FOOTPRINT** — the AV1 path's memory and first-use cost: dav1d-WASM heap per worker at the largest frames, and the first item's import and compile at 1× and 4× | done `98e4117` — **a dav1d-WASM worker costs 31.6 MB resident [31.2–32.2] on the 4.9 M-sample projections against HTJ2K's 24.6 (adopted wrapper; 26.1 the package), 7.6 against 7.1 on the RGB ultrasound; first use is HTJ2K's**: headless Chromium 141, product worker, renderer RSS slope over 1/2/4 workers, 6 rounds; its WebAssembly heap 19.7 MB after one projection, 34.8 by the series' end (16.4 ultrasound), flat over a second pass, never returned; WebCodecs 5–10 MB settled, peaks 32–58 MB a worker outside its heap; a fresh AV1 worker ready in 28–39 ms at 1×, 84–93 at 4× (HTJ2K 30–41, 96–115), first-frame surcharge 65–97 / 200–280 ms against 45–82 / 164–225, 12 rounds cold and cached, the cache 5–11 ms off init; 13 440/13 440 frames exact, 4 mutations caught — [`README.md`](README.md) §A2, [`lab/av1/decode/memory`](../../lab/av1/decode/memory/README.md) |
| 39 | **UNIFY** — one AV1 branch on the cleaned `main`: this branch's AV1 work merged onto it, and the item format of [`payload-format.md`](payload-format.md) (plain and optimized) built end to end | done `20c3674` (`b79127d`, `cbdd781`, `24683d6`) — **built on `claude/av1-unified`, cut from `origin/main`: the merge conflicted in 8 files (the downloader's `decoder.js`, `consumer.js`, `downloader.js` and README, the dispatch rig, the root README, and the two AV1 warm-up frames in a directory `main` renamed), each resolved on `main`'s code — the warm-up dropped with `main`'s, `connect`'s option pass-through and decoder-loss handling kept, the codec check, groups, preview port and decoder seam re-applied; the item format end to end: `ingest.py` writes nothing unless every item decodes back through native dav1d (3 mutations caught), `pack-study` bundles `NNN.av1`, the reader refuses 14 header and 6 decoded-stream cases by name, WebCodecs per item behind 16×16 per-layout probes with dav1d-WASM as fallback, a failed import retried, a late frame never taken; 14 golden items (7 shapes × plain, optimized) exact in Node and headless Chromium through both decoders; 96 real items (fluoroscopy, CT, MR, ultrasound, 8 frames, both representations) exact, optimized over plain 0.918/0.990/0.964/0.861, row 28's ratios; `av1.test.mjs` 60/60, dispatch 327/327, downloader 56/56, gate green; 18 product mutations caught** (RGB needs the sRGB tag for WebCodecs to report no matrix) — on `claude/av1-unified`: `ingest/coded-frames/README.md`, `payload-format.md` §Built *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 40 | **SVC** — scalable payloads end to end in the lab: bases first, then the exact frames (row 26's proposal), measured as time to first picture and to exact | done `40f91bd` (`6176225`, `00b3cf3`) — **every frame is on screen as its base 10–101× sooner than HTJ2K's exact series at 1× (3–45× at 4×), and the exact fill costs 0–8 % over the same encoder's single layer**: row SVCORDER's layer-major layout built in the lab (entry i the base, F + i the whole unit; a lab decoder worker through the downloader's `decoderWorker` seam, downloader, server and store unchanged), row SVCSHAPE's quarter-size q 40 base, one keyframe, fluoroscopy and ultrasound, 5/20/50 Mbit at 1× and 4×, 13 interleaved rounds, n = 4–13; every frame shown in 0.13–0.15 / 0.33 s at 1× and 0.33–0.36 / 1.0–1.1 s at 4× against HTJ2K's 1.7–15.2 / 3.2–29.4 s; bases 0.06 / 0.35 % of HTJ2K's bytes again; the shape's one group on one decoder and lossless SVC's 1.07 / 1.59 × HTJ2K's bytes leave its exact series 1.07–7.4× HTJ2K's time (4.5× / 7.4× at 4× on 50 Mbit, intra AV1 1.8× / 2.3×); 27 456/27 456 frames exact, 6 864/6 864 bases as native dav1d at op 1, none late; 5 mutations caught — [`README.md`](README.md) §A5, [`lab/av1/delivery/bases-first`](../../lab/av1/delivery/bases-first/README.md) *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 41 | **FASTHTJ2K** — faster HTJ2K decode in the browser: where OpenJPH-WASM's time goes, what GPU decoders move to the GPU, whether WebGPU can, and the CPU levers not yet tried | done `7f806ae` — **the HT block decoder is the clock, and only threads inside a frame move it**: OpenJPH 0.31.0 profiled in headless Chromium 141 on 8 frames of seven real series at 1× and 4× (560/560 exact): HT block decode 55–70 % of a frame (cleanup passes only, already WASM SIMD), code-block to line 6–7 %, inverse wavelet 5–10 %, colour 2 % on RGB, wrapper pack 4–10 %, copy out 7–15 %; **a WebGPU wavelet bounded out** — ≤ 6–12 % to save against three times the bytes the copy out already moves (projections 2.8 ms saved, 29.5 MB to and from the GPU a frame); no WebGPU/WebGL JPEG 2000 decoder exists; WebGPU on Chrome Android 121+ and iOS 26; the container has no GPU (SwiftShader only); **code-blocks decoded in parallel (lab patch) 0.69–0.91 of a frame at 2 threads, 0.59–0.61 at 4 on the 1914×2572 projections only** (6 rounds interleaved, 1× and 4×, 2 688/2 688 exact, 2 mutations caught 56/56), an ask's lever, not a fill's; copy out and pack bounded at ≤ 15 %, OpenJPH 0.32.0 changes one mask in the WASM decoder — [`decode/README.md`](../decode/README.md) §Faster HTJ2K in the browser, [`lab/av1/decode/htj2k-profile`](../../lab/av1/decode/htj2k-profile/README.md) |
| 42 | **TOTAL3** — total time with row 36's encoding findings (low bits deflated, k per series, the top through WebCodecs) against HTJ2K and the plain AV1 control | done `6f7d2f8` (`f4aceec`, `29434f2`) — **row ENCX's changes buy 3 % where a slow CPU meets a fast link and ±0.6 % elsewhere**: fluoroscopy, both tomosynthesis volumes and the ultrasound, 5/20/50 Mbit at 1× and 4×, 13 rounds, 1 026 of 1 170 visits kept, n = 5–13, 38 532/38 532 frames exact; x36 (low bits raw-deflated, k = 3 where σ ≥ 17, top through WebCodecs, a lab worker) over the adopted representation 0.969–0.972 at 4× on 50 Mbit, 0.990–0.997 elsewhere on the k = 3 series (bytes −0.2 to −0.5 %), 1.003–1.006 on the 10-bit volume (deflate alone, +0.4 % bytes); over HTJ2K x36 0.94–0.97, and 0.98–1.00 at 4× on 50 Mbit where the adopted one is 1.00–1.02; the plain control 1.03–1.13 of HTJ2K where the wire is the clock and 1.27–1.65 at 4× on 50 Mbit (the 10-bit volume 0.98–1.01, 1.19) — [`README.md`](README.md) §Total time *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 43 | **SPLITOK** — the bit split exact at every depth 8–16 and every layout k a rule could pick, unsigned and signed, through every decoder and engine, before any per-depth rule is adopted: correctness only, nothing timed | done `95b80dc` on `claude/av1-unified` (`7084940`, `ca8987b`, `38acace`, `494d958`) — **exact at every b = 8–16 and every k = max(0, b − 12) … max(b − 8, 4), unsigned and signed, through every decoder in every engine; nothing refused**: the item format widened (bits ≤ 16, split ≤ 8, depth the smallest container of the top) and the reader's signed mask corrected (the old one reports a wrong range at 9 of 162 widened cells); every value split and merged back in writer (142/142, 20 tops over 12 bits refused by name) and reader (162/162); synthetic 8 280 frames (1 260 cells, 1-pixel to 256², cpu0 and allintra 7) and 540 of 1914×2572 and 4096×5120 (180 cells), and all nine real series at every k, cpu0 and shipped preset (82 cells, 3 310 frames), each exact natively, in Node and in Chromium, Firefox 157 and WebKitGTK 2.52 with every stream as planned and the decoder as expected (Chromium WebCodecs wherever every stream ≤ 10 bits: 6 256 + 408 + 2 254 frames); 90 golden matrix items exact in Node and Chromium; 20/20 mutations caught — `lab/av1/exact/split` §Checked, `payload-format.md` §Built, README §A3 |
| 44 | **SPLITTIME** — the per-depth layout rule by bytes, decode and total time: HTJ2K against d12, k = 2, k = 3 and w10 at 13–16 bits, the 9–12-bit series as controls | done `6e80fba` on `claude/av1-unified` (`19ade60`, `8924a2b`, `a8f2e22`, `04a0d08`, `68362f2`, `d489441`) — **k = 0 at 9 bits, 2 at 10–12 and 14, 3 at 13, HTJ2K at 15–16**: eleven real series of 9–16 bits at every arm k, cpu0 items, every frame exact (decode 59 280/59 280, fill 246 760/246 760); decode a frame through `decoder.js`, 12 rounds at 1× and 4×: WebCodecs' arm fastest on every series, 1.59–4.12× HTJ2K, dav1d-WASM's 12-bit top 5.6–11.6×; total time, round-paired over HTJ2K, 13–16 bits on five links (12 rounds, n = 10–12 but one cell 9), 9–12 bits on the fixed links (10 rounds, n = 8–10): 9 bits k = 0 0.93–1.01 (k = 2 1.03–1.07), 10 bits k = 2 0.95–0.99, 11 bits k = 1–3 tie 0.99–1.02, 12 bits k = 3 or 2 within 0.02 (0.94–1.02), 13 bits k = 3 = w10 0.91–0.98 on every cell (k = 2 1.66–1.68 at 4× on 50 Mbit), 14 bits k = 2 or 3 0.92–0.99 where the wire is the clock and HTJ2K where a slow CPU meets ≥ 20 Mbit (1.02–1.69), 15–16 bits every AV1 arm 1.02–3.11; the port reproduces row 33's cells (CT w10 at 50 Mbit 4× 0.95 against 0.94); mutations 2/2 caught in each harness; bytes per arm at the shipped preset from `09605fc`; gate: the link check fails on this queue's row 69 brief (`docs/av1/MERGE.md` not yet written), not this row's — `lab/av1/delivery/split-rule/README.md`, README §A3 and §Total time, `payload-format.md` §Proposed: the split per depth *Corrected at scale (row DBTSCALE): bytes hold (k = 2 smallest on 15/15 whole DBT volumes at the shipped preset), but at 4× on 50 Mbit/s the DBT arms lose 25–39 % to HTJ2K, not 0.97–0.99.* |
| 45 | **DATA3** — the taxonomy's missing content and depths: breast ultrasound cine, ABUS, angiography, FFDM and synthesized 2D, real 9-, 15- and 16-bit and more signed series; exact and bytes per layout, or the hosts to allow | done `c8b4d39` on `claude/av1-unified` (data `e4636c8`, `feebd5b` here) — **every frame of the nine series exact at every k of its depth, natively (45/45 cells, 2 825 frames), in Node (2 825/2 825) and in Chromium, Firefox and WebKitGTK at k = 2, 3, b − 10 (1 358/1 358 each, decoders as expected); no one k wins**: best arm over HTJ2K at cpu0 — MR 9-bit 0.910 (k = 0), synthesized 2D 0.938/0.951, FFDM 0.986/0.989 (one vendor's a stretched range, plain 1.29), signed CTs 0.899/0.939, PET 15-bit 0.996 and film 16-bit 1.001 (w10); plain and optimized refuse 15–16 bits and k = 3 the film, by name; breast US cine and ABUS per row 46 — `lab/av1/bytes/breast/README.md` §Row DATA3's series, README §A3, `FIXTURES.md` §AV1 data |
| 46 | **BREAST** — the breast family's missing content (breast ultrasound cine and stills, ABUS, more DBT, FFDM and synthesized 2D), measured as the targets: exact per decoder path, bytes per layout against HTJ2K, intra against inter at G = 8 and 16 in real slice and frame order | done `1c5e435` on `claude/av1-unified` (`9b8b8ae`, `eb111a7`; data `4b7c851` here) — **ten breast series added, all CC BY; inter does not pay on DBT and pays on the grey cine only because that clip is a lossy recording**: three more DBT systems' volumes/projections, two FFDM, two synthesized 2D (IDC), breast US cine grey and RGB and stills (Zenodo), 297/297 frames identical to an independent read; nothing presented or reconstructed exceeds 12 bits (projections 14, a film 16); every item exact natively, in Node (64/64 cells, 405/405 frames) and Chromium (WebCodecs 289, dav1d-WASM 116, each as expected); optimized item 0.873–0.962 of HTJ2K on 8 of 10 at cpu0 (stretched-range FFDM 1.006, stills 1.002); inter G = 8/16 on four DBT slice series 0.963–1.054 of intra at cpu0, 0.998–1.050 at good 6, RGB cine 0.98–1.00, grey cine 0.53–0.56 (0.47 of HTJ2K, decode 0.56×); 42/42 inter cells and 4/4 mutations; ABUS has no open licence, no third DBT vendor is open (§Blocked); gate not run (no `wasm-pack` here; no client or server code changed) — `lab/av1/bytes/breast/README.md`, README §A1 §A3, `FIXTURES.md` §AV1 data *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* *Intra confirmed at scale (row DBTSCALE): k = 2 0.939–0.956 of HTJ2K on 13 of 15 whole volumes, 0.760–0.797 on two.* |
| 47 | **MIXDEC** — each stream of a split item through its own decoder: a top over 10 bits through dav1d-WASM, the 8-bit low through WebCodecs, against both through dav1d and against w10 | done `f434b72` on `claude/av1-unified` (`7d76125`, `054ceea`, `882d808`, `31f82a2`, `c0bbded`) — **the low stream is 17–38 % of a 13-bit frame's dav1d-WASM decode and 34–54 % of a 14-bit one's, and mixed takes all of it off, but w10 stays faster**: built behind decoder config `mixed` (off by default; the low to WebCodecs before the top's dav1d-WASM decode, dav1d-WASM wherever the `g8` probe fails); exact on every frame of the six 13- and 14-bit series at every k (1 113/1 113 an engine) and row 43's synthetic set (8 280/8 280 an engine) in Chromium 141, Firefox 157 and WebKitGTK 2.52, each stream from the decoder expected (Chromium mixed, the other two dav1d-WASM); 11/11 mutations caught; decode (n = 10 interleaved, 1× and 4×) 0.46–0.87 of today's, faster 120/120, 1.04–2.16× w10's; fill at 4× on 50 Mbit (n = 10–12, 35 616/35 616 exact) 0.77–0.90 of today's (131/131), 0.91–1.14 of w10's (ahead on the 14-bit projections, where w10's bytes are 1.007–1.059 of HTJ2K's), 0.93–1.18 of HTJ2K's (winning on two CTs, where today loses 18–23 %); 20 Mbit not claimed (88 of 144 visits `VOID`); whether the flag becomes the client's choice is the owner's — `lab/av1/decode/mixed`, README §A3, `decode/README.md` §AV1 |
| 48 | **SPLITLIT** — is splitting samples into top and low streams a recognised, recommended way to code high-bit-depth images losslessly with codecs limited to ≤ 12 bits, and what are the alternatives? | done `98c0cfc` — **known, not recommended: the split is published (2011–2024: aerospace video, infrared, depth, CT) and patented (2006 priority on), and no standard or DICOM text recommends it**; the low part is noise in every source (CT's low byte 5.0–6.8 of 8 bits); the noise-floor rules (log2 σ + 1.79, Rice k ≈ log2 σ − 0.3) put k at 4–6 on the four σ ≥ 17 series, where row 36's oracle searched only k ≤ 3 and hit 3 on all four; histogram packing is the offset's published alternative (−42 % CT, −51 % MR bits a pixel on sparse histograms, JPEG-LS); over 12 bits no browser path is exact but WASM (HTJ2K, JPEG-LS, JPEG XL) — [`split-prior-art.md`](split-prior-art.md) |
| 49 | **DECODE** — the HTJ2K and AV1 decoder workers rethought: zero-copy hand-off, fewer allocations, one decode interface for both codecs | done `3927234` on `claude/av1-unified` (`fca7d59`, `93f3e8f`, `b6f1e39`, `a48400c`, `b5ef3f4`) — **one codec-module interface, and HTJ2K 12–21 % off a grey frame; no zero-copy hand-off, and AV1's one allocation saved costs more memory than it pays**: `decoder.js` loads `htj2k.js` or `av1.js` behind one `init`/`decodeFrame` and has no codec in it; the HTJ2K range pass in two loops (V8 does not hoist the per-sample branch) took decode through the product's worker ×0.79–0.88 on every 10–14-bit grey series at 1× and 4× (7/8–8/8 rounds; mammogram 91.5 → 75.7 ms, 389 → 313 at 4×), the RGB control a tie; headless Chromium 141, the first 4 frames of 7 breast series and the fluoroscopy, 8 rounds interleaved, 1 024/1 024 frames exact a throttle; WebCodecs copying into a reused buffer measured ×0.91–0.96 and **reverted**: it held 37 MB a worker on a mammogram (settled RSS slope 7.3 → 44.4 MB) for a gain the fill hides; the fill (row 23's harness, 20/50 Mbit, 1×/4×, 6 rounds, 20 544/20 544 exact) moves 0.5 % pooled, 1.5–3 % on the 2560×3328 frames at 4×; HTJ2K's memory unchanged; a hand-off with no copy needs the frame's storage in the decoder's heap and a release from the page — a contract change, proposed only if a phone shows the copy is the clock; 5 mutations caught — [`decode/README.md`](../decode/README.md) §The decoder worker's hand-off, `lab/av1/decode/worker` |
| 50 | **CLIENT** — the downloader, worker and consumer state machines: the two re-dial defects fixed, the untested decisions tested, the states simplified | done `29aa31b` on `claude/av1-unified` (`92bb341`, `65b1d4b`, `8fc44e8`) — **both re-dial defects fixed and every decision held by a test; four dead checks removed, the fill's time unchanged**: (1) a cancel during a resume could not take back the run its dial's URL carried — `connect()` now ends that stream; (2) `close()` during a re-dial let `resume()` adopt the new session — a dial opening after close is closed; each a clause that failed before. A sweep of 76 mutants over `downloader.js` and `consumer.js` left 32 alive: the 21 untested decisions (least-busy dispatch, a fill skipping recorded frames, a lost decoder before the dial, recycling at ¾ of the budget and its owed asks, an ask alone on a closed or silent session, a resume with nothing owed, spent re-dials naming asks and being given back, `undefined` options, a refused first dial, a command during a resume, a cancel releasing a group's decoder, failures of a cancelled request from a dial or a decoder, a duplicate ask, `resumedAt`/`recycledAt`, `groupLength` and isolation refusals) each now killed by its test (17 dispatch clauses, `consumer.test.mjs`), 4 dead (promote's guard and pump, the record's generation, `lastChunkMs`'s fallback) removed, 7 left with reasons; `epoch`/`generation`, `resuming`/`dialling` and the three record states kept, each read; dispatch 695 → 719/719; fill after/before 0.99–1.00 in all 8 cells (fluoroscopy and 10-bit DBT, 20/50 Mbit, 1×/4×, 10 rounds interleaved, 3 360/3 360 frames exact); the gate's link check is red on that branch from row 61's `delivery-prior-art.md` (4 links), not this row — [`ARCHITECTURE.md`](../ARCHITECTURE.md) §The downloader, `client/README.md` |
| 51 | **SERVER** — the send path rethought: the per-send copy, mmap against pread, what each layer does that it need not | done `eabb30b` on `claude/av1-unified` (`1d9a0f4`, `9b0ccb7`) — **nothing adopted: the send path has no per-frame cost left that large frames expose, and the memory they leave is the allocator's**: loopback, 2 server cores, n = 6 interleaved, no PMU (rusage); CPU per byte flat 250 kB → 16 MB (1.5–1.7 µs/kB at 16 sessions, 2.3–2.6 at one); after 16 sessions of 16 MB frames ~800 MB stays resident; a 16 MiB byte-capped pool cut it 32 % (6/6) for +8.4 % CPU (0/6 lower), `MALLOC_MMAP_THRESHOLD_` 1 MiB cut it 46–57 % (6/6) at a CPU tie to +5 % (2/6) — the owner's deployment call; 50 Mbit fill time not run, nothing changed; `docs/adr/disk-access.md` §11 *Frames past 250 kB* |
| 52 | **INGEST** — the HTJ2K and AV1 ingest tools as one pipeline: fewer passes, the round-trip check's cost, parallel encode, bytes identical | done `8586973` on `claude/av1-unified` (`0f1da56`, `542bb5a`, `9574327`, `65b1de9`) — **one ingest for both codecs, every byte as before, HTJ2K's cheaper and AV1's a tie**: `ingest.py --codec htj2k` beside AV1, the check in-process (dav1d, OpenJPH); 69/69 cells byte-identical (23 sets × HTJ2K, AV1 plain, optimized, 2 088 files a side); the check 0.63–0.84 of the subprocess's time a frame on AV1, 0.37–0.46 on HTJ2K (n = 3, disjoint); a study's HTJ2K CPU −21 to −27 % and now parallel, AV1 within ±4 % (the encode is 94–99 %; *"~99 %" corrected by row 136*), four workers 3.5–3.9×; 3 mutations caught; AV1 bytes depend on `--jobs` in both revisions (§Blocked); `ingest/coded-frames/README.md` §One pipeline |
| 53 | **SEAM** — the seams between transport, downloader, decoders and page: duplicated logic, dead paths, codec dispatch | done `112eda0` on `claude/av1-unified` (`f0020e8`) — **two duplicates merged, no dead path found, the fill's time unchanged**: traced transport → `downloader.js` → `decoder.js` → `htj2k.js`/`av1.js` → `consumer.js`; the Emscripten glue loading (written out in `htj2k.js` and `av1-dav1d.js`) is `wasm-glue.js`, the unit-continuity refusal (written out in both AV1 decoder modules) is `continues()` in `av1-payload.js` — one place each, not fewer lines (+26, −16); its mutant fails 3 dispatch checks; the codec is decided once (`consumer.js` refuses, `decoder.js` routes, `av1.js` picks the AV1 decoder); kept with reasons: owed frames held by both transport and records (one owner is a transport API change, structural), `groupLength` beside `decoder` in `init` (four lab workers speak it), groups, the preview port, `mixed`, `recycleAtBytes`, `openAsk: false`, `decode: false` (built, each reached by a clause); dispatch 719/719, conformance 56/56; fill after/before 1.00 in all 8 cells (fluoroscopy and 10-bit DBT, 20/50 Mbit, 1×/4×, 10 rounds interleaved, 3 360/3 360 exact) — [`ARCHITECTURE.md`](../ARCHITECTURE.md) §The seams, traced |
| 54 | **GATE** — the gate's run time, redundant tests and the gaps mutation finds | done `b62a19c` on `claude/av1-unified` (`9a3dd55`, `7f1ddb5`, `82ddc4f`) — **the gate 161 → 106 s, and 140 of 151 viable mutants killed against 108 before**: n = 3 interleaved a cell, `--quick` 161.4 [159.8–161.7] → 105.9 [104.9–106.1] s, full 160.7 → 107.0; two timer-bound steps now wait side by side — transport conformance one process an implementation (54.4 → 18.2 s, one clause trickles 16 s on each), the two browser rigs in parallel pages (57.0 → 38.3 s), every check as before, each runner mutated (a failing implementation, a child with no result, a failing rig) and caught; 156 hand-made mutants at each decision: client 44 → 65 of 72 (row 50), decoder modules 45/45, send path 16 → 20 of 24, study bundle 3 → 10/10 — 13 new tests (planner's asks held and look-ahead past an end_stream, per-frame stream rank, a byte budget's cut, the bundle's short file, magic, version, metadata bound, one-byte overrun, a mis-sized frame, a short finish), 5 dead branches removed, 11 left alive with reasons (log lines, timers only a frozen page shows, lab-only stall bytes); no test cut (overlaps are checks within one clause, or too few mutants); the dispatch rig skips its 591 AV1 checks without dav1d-WASM built, now said; the branch's 4 broken ADR links fixed (`82ddc4f`) — [`README.md`](../../README.md) §What the gate costs and what it catches |
| 55 | **NAMING** — every name audited against the round's principles; the clear renames applied with every reference | done `7cdee44` on `claude/av1-unified` (`7a0cf20`, `c723292`) — **five things under three *lever* numbers renamed, the conformance suite's *arms* are clients and rigs, five renames proposed**: ARCHITECTURE's *Lever 1–3* and transport-conclusions' *Lever 1–2* are now the opening ask, early SETTINGS, hints in the session URL, the bytes pushed at session open and a 32-packet initial window, *S4* the container campaign — 21 files, every reference, 0 left by grep; `run.ts` `CLIENTS`, the wire pages' `?client=`, `consumer.js` `#arm` → `#waitFor`; gate green, links 0 unresolved; proposed, not applied: *item* → **coded frame** (DICOM's Item; the item format is structural), telemetry rows' `arm` → `client` (a row schema), the lab's *arm* → **variant** (≈1 900 lines; `CLAUDE.md`'s word), queue-row folder names (row 56 moves folders), campaign labels; principles and a 15-term glossary — [`README.md`](../../README.md) §Names; `CLAUDE.md` wording at the end of the brief |
| 56 | **LAYOUT** — folders by responsibility, each doc where the repository's rules place it | done `19de3e0` (the queue's paths `d16acf1`, merged `8b367a5`) — **lab/av1 by subject in five groups, the product's three dependencies out of lab/, behaviour unchanged**: 274 files moved, 1 148 → 1 149 (the ingest's README split: product beside the code, measurements in the lab), 880 byte-identical, 232 differing only in paths, 36 with checked edits; dav1d-WASM build → `client/decode/wasm/dav1d/`, OpenJPH fetch → `client/decode/wasm/fetch_openjph.sh` (its `vendor/` beside it), ingest → `ingest/coded-frames/` (its bench → `lab/av1/exact/coded-frame/`); `size.py`, `depth.py`, `roundtrip.py` stay at the top, imported across groups; the golden coded frames regenerated through the moved ingest byte-identical (a mutant changes 99), dav1d-WASM rebuilt from its new place at 623 146 B as before, the tools from theirs; gate green with no step skipped (dispatch 750/750 with every AV1 check, 0 links unresolved) — [`lab/av1/README.md`](../../lab/av1/README.md) §The folders |
| 57 | **VERSIONS** — newer libaom, SVT-AV1, dav1d, OpenJPH 0.32.0, Emscripten SIMD and threads, Chromium's WebCodecs: what each gains or breaks, the promising ones measured | done `cae1909` on `claude/av1-unified` (`2029cff`, `e16fb66`, `bcdce24`, `f5d9a2f`, `eb385ff`, `bae6b00`; `8c69bf0` before) — **nothing adopted, no pin changed: no libaom, SVT-AV1 or dav1d release followed the pins, libaom's head writes the same bytes, and no decode lever clears the harness's spread**: libaom head `4cea455c` byte-identical to 3.15.1 on 11 series × cpu0 and shipped (80/80 items, all exact; 3.8.2 differs, the lever checked); dav1d head `7f12cf23` and emscripten 6.0.11 tie on dav1d-WASM (pooled 0.98–1.01); OpenJPH under emscripten 6.0.11 0.94–0.96 of 3.1.74 pooled, inside a 2–7 % spread at 6 rounds — the one lever worth a longer run; OpenJPH 0.32.0's WASM mask fix (24-bit code-blocks) unreachable at ≤ 16 bits, deep-bit-plane frames 12/12 exact, mutation 12/12 caught; 0.32.0's codestreams identical to 0.31.0's but the COM version (38/38); Chromium 154 ties on dav1d-WASM, item path 1.06 pooled, and still refuses 12-bit WebCodecs — libgav1's key-frame parse is built for 10 bits (141, 154, 155); headless Chromium 141 and 154, 1× and 4×, 6 interleaved rounds, 8 640/8 640 frames exact; gate green — `lab/av1/tools/newer/README.md`, README §Measured here, `decode/README.md` §WebCodecs |
| 58 | **LITERATURE** — lossless medical image coding 2023–2026, and what of it runs in a browser today: research, rows proposed | done `44482f6` — **JPEG XL lossless is still the codec to beat; nothing published since 2023 that beats it runs exact in a browser but one unreviewed codec**: standard codecs on 16-bit CT/MR put JPEG XL at 0.85–0.95 of JPEG-LS and 0.82–0.91 of JPEG 2000 (BD-LVIC, TIP 2024), 0.78–0.95 of HTJ2K on four 16-bit CT and mammography frames (an industry white paper, 2024); learned and context-tree coders gain 3–20 % under JPEG XL on CT/MR volumes, but only integer or table-driven ones can be exact in a browser (WGSL float is not bit-reproducible): TCT (TIP 2026, 0.88–0.97 of JPEG XL, 0.05 s a slice on CPU, no code) and Tomoz (Apache-2.0, WASM, self-reported 0.73–0.85 of HTJ2K, unreviewed); no paper measures modern lossless codecs on breast imaging — rows 45–46 hold more; three measurements proposed (JPEG-LS in WASM, Tomoz, TCT when released); [`lossless-literature.md`](lossless-literature.md) |
| 59 | **RESLEVEL** — HTJ2K decoded at the resolution level a phone screen needs, exact, then full resolution on zoom | done `13aaefd` on `claude/av1-unified` (`f612572`, `1292c51`, `1672bf2`) — **a level picture first: the first view on screen at ×0.09–0.69 of today's fill, a four-view study at ×0.06–0.50, every whole frame at a tie (×0.98–1.04); exact only once clamped**: the breast series at the level whose long side holds 1 000 px (level 1, level 2 on 3328×4096), today's RPCL codestreams cut at the smallest exact prefix — 25.8–29.0 % of a frame at level 1, 7.0–7.5 % at level 2; the package's `decodeSubResolution` leaves the 5/3 low band unclamped above 2^B − 1 (15 of 35 frames, up to 1 439 on 10 bits), clamped it matches OpenJPEG 2.5.4 `-r` and a 5/3 analysis of the source on 35/35; decode at the level ×0.27–0.31 of the whole (×0.08 at level 2), Chromium 141, n = 10, 2 100/2 100 exact; on row 23's five links at 1× and 4×, 13 rounds, paired n = 5–13 (under 10 in 9 of 50 cells), 5 200/5 200 frames and 2 600/2 600 level pictures exact, sooner in every paired round — 3328×4096 at 5 Mbit on screen in 2.6 s, not 31.6; §6's 2× rule holds at 5 and 20 Mbit on every series, at 50 Mbit on the mammograms only; prefix ask, level offsets in the store, the clamp and a smaller picture in the render path proposed, not built; 4 mutations caught — [`decode/README.md`](../decode/README.md) §A frame at the level the screen needs, [`adr/resolution-fitting-for-large-frames.md`](../adr/resolution-fitting-for-large-frames.md) §7, `lab/av1/decode/resolution-level` |
| 60 | **LOSSLINK** — fill and on-demand time over links with 1–5 % packet loss and jitter, HTJ2K against AV1 | done `d782f14` on `claude/av1-unified` (`c3b6833`) — **under loss the controller is the clock and AV1 is its bytes**: the 10-bit volume, 4 frames filled then 4 asked one at a time, 5/20/50 Mbit and `lte-good` × none, 1/2/5 % loss, ±5/±20 ms ordered jitter (userspace relay; no `tc` here) × 1×/4×; 1 % turns a 0.62 s fill at 50 Mbit into 4.0 s and an ask's 153 ms into 1.5 s, 5 % into 12.4 s and 3.3 s (20–22×), whatever the rate (5 % at 5/20/50 Mbit: 14.1/12.8/12.4 s), the same for both codecs; the optimized item is 0.89–0.99 of HTJ2K's fill on 20 of 24 loss cells and its 4× penalty on fast clean links (1.07–1.26) is gone under loss (0.93–0.97); bursty 5 % puts an ask's p95 at 8–15 s on both; ±20 ms jitter adds 0.05–0.22 s a fill; Williams order, n = 8–15 a cell, 143 of 1 344 visits `VOID`, 10 752/10 752 frames exact, both mutations caught; `--congestion bbr` on the loss cells proposed, not built — [`README.md`](README.md) §Under loss and jitter, `lab/av1/delivery/total-time/README.md` |
| 61 | **TRANSFER** — how other systems deliver medical images, and what they do better than us: research, rows proposed | done `1c03ba0` — **others deliver a frame's prefix first and the rest after; nothing they do survives loss better**: DICOMweb has no partial-frame retrieval but generic, optional HTTP Range (CP-2204); DICOM's HTJ2K RPCL syntax (Sup 235, TLM required) exists for prefix delivery, and an open-source viewer fetches a 128 KiB Range prefix of every frame, then `bytes=<held>-`, in strides of 4 (the committee's slides: 45 against 66 ms to first render over 4G, not reviewed); three cloud services document no partial retrieval; HTTP/3's streams buy little over one ordered stream under random loss (3 papers, 2021–22), as the shared stream found; QUIC FEC pays only on a transfer's tail (FlEC: 247 against 272 ms median, 50 kB with a loss) and no draft survives; `RESET_STREAM_AT` is in the RFC Editor queue (2026-09-06); four rows proposed, a plain HTTP/3 `fetch()` baseline first — [`delivery-prior-art.md`](../transport/delivery-prior-art.md) |
| 62 | **GPU** — GPU HTJ2K decoders' methods and whether WebGPU can take more than the wavelet: research and a feasibility bound | done `a88db02` (`16dc903`) — **a ported HT block decoder bounds at 42–67 % of a breast frame from 931×2124 up at 1×, loses on 512²; unmeasurable here**: the ICIP 2019 GPU decoder read in full (MEL+VLC one thread a code-block, MagSgn a warp a block, wavelet 40–50 % of GPU time; lossless 4K 62–402 frames/s), nvJPEG2000 refinement since v0.10.0, no WebGPU/WebGL decoder anywhere; WebGPU's way back measured in Chromium 141 on SwiftShader at 2.0–2.1× the heap's copy out on every frame over 4 MB, +3 ms on small ones (8 rounds interleaved, 1×/4×, 1 344/1 344 exact, mutation caught 12/12 cells); bound = 81–86 % movable − GPU time scaled from the paper's lossless kernels (throughput or a KCUPS1 latency floor) − that transfer: tomosynthesis 23 % / −44 %, MR 512² −14 %; no GPU in the container, so the WGSL port and a phone are what would settle it; row FASTHTJ2K's two misreadings corrected in place; gate's wasm steps not run (no wasm-pack), no client code changed — [`decode/README.md`](../decode/README.md) §A WebGPU block decoder, bounded, [`lab/av1/decode/webgpu`](../../lab/av1/decode/webgpu/README.md) |
| 63 | **JXL** — JPEG XL at fast efforts in WASM, and native browser decoding: which engines, exact at which depths, through which API, how fast | done `0af8457` on `claude/av1-unified` (`34db45f`, `35a3137`, `61e9f6b`, `d20ae8e`) — **no setting is both smaller and as fast as HTJ2K, and the browsers return 8 bits**: libjxl 0.12.0 exact at every effort 1–7 × `--faster_decoding` 0–4, 8–16 bits (35 × 37 frames); e1 0.94–1.03 of HTJ2K's bytes at 1.03–1.91× OpenJPH's WASM decode, e7 f3 0.91–0.98 at 1.56–2.45×, the default 0.81–0.96 at 5.35–10.0× (0.53 on the 16-bit scan), 8 interleaved rounds, Chromium 154 and Firefox 157, 1× and 4×, 7 040/7 040 frames exact; native JPEG XL in Chromium 154 (jxl-rs, `JXLImageFormat`, off; none in 141) and Firefox 157.0.1 (`image.jxl.enabled`, off), none in WebKitGTK 2.52.6 — every path (`<img>`, `createImageBitmap`, `ImageDecoder` `BGRX`, float16 canvas) 8-bit: exact on 8-bit grey and RGB, display pixels above; native under libjxl-WASM only at the default effort (2.2–6.1×); mutations caught 3/3 — [`decode/README.md`](../decode/README.md) §JPEG XL, [`README.md`](README.md) §Measured here |
| 64 | **REMAP** — rare values above 12 bits mapped out with a small exception map, and a palette for high bits: exact, bytes, decode | done `6fbb753` on `claude/av1-unified` (`6132bbd`, `11689b5`, `8dd5aba`) — **the map buys the decoder, not bytes**: two of three projection systems are 12-bit data plus one saturated level (16383, 11 % and 0.6 % of samples), the CTs and cone-beam 12-bit data plus 0.0003–0.02 % rare levels, the third projection system, the PET and the film dense or sparse above 12 bits; clamped into a 12-bit window with a deflated per-frame map (1–10 KB a series), one 12-bit stream is 2.6–13 % larger than the k = 2 split on all six series it fits, but split at k = 2 after the map it is the split's bytes (−0.1…+0.05 %) with every stream ≤ 10 bits, so WebCodecs decodes it in **0.46–0.71 of the split's dav1d-WASM time** (60/60 paired rounds; Chromium 141 in the container, 10 rounds Williams-ordered at 1× and 4×, 1 920/1 920 frames a throttle exact against the source) and 1.05–1.34× w10's for 5–12 % fewer bytes on the projections, 1.5 % on two CTs, 4.4–4.8 % more on a CT and the cone-beam; a high-bit palette ties the map; at L = 0 (histogram packing) it halves the 16-bit film for HTJ2K as for AV1 (0.576, 0.571); every AV1 arm still 2.6–7.3× HTJ2K's decode; 5 + 3 mutations caught; proposed, not built — [`payload-format.md`](payload-format.md) §Proposed: a remapped plane, [`README.md`](README.md) §A3, `lab/av1/bytes/remap/README.md` on `claude/av1-unified` |
| 65 | **ORDER** — the order frames are sent in: DBT centre-out, mammography view priority; time to the first useful image and to the full fill | done `cc4ca00` on `claude/av1-unified` (`3aedecf`, `289397f`, `512624b`) — **the useful frames asked before the fill reach the screen in 0.30–0.52 of the sequential fill's time on tomosynthesis (centre slice ±2) and 0.47–0.77 on a four-view mammogram's MLO pair, for two round trips on the whole fill (+72–113 ms, +0.4–4 %), HTJ2K and AV1 alike; nothing adopted, no product change needed**: both DBT volumes and two FFDM, HTJ2K and the optimized item, 5/20/50 Mbit at 1× and 4×, 13 Williams rounds, 1 191 of 1 248 visits kept, n = 10–13 (one cell 9), 19 032/19 032 frames exact; IHE's display test hangs all four views at once, so no order shortens a full hanging — [`README.md`](README.md) §The order frames are asked in, [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The first fill |
| 66 | **POCGAP** — an earlier private proof of concept's 31 % lossless AV1 gain on 10-bit data: two more 10-bit DBT series, paired medians, and the method notes recorded | done `00b99ec` (`7f46304`) — **not reproduced: paired, plain AV1 is 0.973–0.976 of HTJ2K on 10-bit DBT, optimized 0.940–0.943, not 31 % below**: the first 4 frames of `dbt10_ea1141` and `dbt10_d`, 20/20 codings exact (80/80 frames); one setting at a time, an 8-bit copy (v ≫ 2) favours AV1 by 3.1–3.5 points, keeping the background by 0.5–0.8, libaom 3.8.2 against 3.15.1 at cpu6 by 0.5–0.7, `--threads=4` changes bytes 0.02–0.06 % a frame (so `--threads=1` is pinned); the two series the brief named are not CC BY or CC0 (UPMC states no licence, BCS-DBT is CC BY-NC 4.0: Blocked); 4 mutations caught 4/4 — [`README.md`](README.md) §Prior evidence, [`lab/av1/bytes/prior-gap`](../../lab/av1/bytes/prior-gap/README.md), [`FIXTURES.md`](../FIXTURES.md) §AV1 data |
| 67 | **CODECSTR** — the WebCodecs codec string derived from each stream's own sequence header, not one fixed `av01.0.04M.10` | done `a2e89bb` on `claude/av1-unified` (`1cc1c88`) — **the string is each stream's own, the frames and the decoder unchanged**: each keyframe's sequence header gives `av01.P.LLT.DD.M.CCC.cp.tc.mc.F`, reconfigured only when it changes; 91 distinct headers (419 units: every fixture, the probes, 59 items of all 28 taxonomy series, 8 full headers with timing, decoder model, frame ids, High tier, nine operating points) derive the string ffmpeg 6.1.1 reads; libaom writes levels 2.0–6.0 by picture size, never 31, and 31 changes no engine's answer; `isConfigSupported` true for every string in Chromium 141, every full string in Firefox 157.0, Main only in WebKitGTK 2.52.6; 115/115 frames exact in all three, Chromium's decoder per item the same as before (61 WebCodecs, 54 dav1d-WASM), none falling back; Chromium echoes the string's colour on the frame, so the 4:4:4 identity check now reads the header's matrix as dav1d's does — an untagged identity stream now decodes exact through WebCodecs; 13/13 derivation and 3/3 decoder mutations caught; gate green — `lab/av1/exact/codec-string`, `payload-format.md` §Decoder choice, `decode/README.md` §AV1 |
| 68 | **AV1DOCS** — the AV1 docs made the complete, essential source of truth: one place per subject, the round's findings in, the terms fixed | done `946dedd`, `5706734`, `593a037` (the queue's paths `1c43fce`) — **the AV1 item is the AV1 payload everywhere, and the phase doc reads by subject**: defined once in README §Names; `payload-format.md`, `parsePayload`, the error text `av1 payload:`, the 214 golden payloads (regenerated byte-identical at their new path, `av1-probe.js` unchanged), every doc and lab script (478 lines, DICOM's Item, AVIF's items and DICOM's work items left alone); no DICOM frame called an AV1 frame (7 places); `docs/av1/README.md` opens with where the phase stands and what is decided, then one section a subject (bytes, frame groups, exactness and the decoders with a diagram of the decode path, decode time and memory, samples over 12 bits, content, preview, encoding, total time, options, prior evidence) — every old paragraph moved verbatim but its lead or cross-reference, the one dropped list a duplicate of §Preview; `lab/av1/README.md` 459 → 338 lines, its encode-cost and AV2 cells beside `enc.py` and `av2.py` in `bytes/README.md`; 33 references to the old section names follow; gate green (dispatch 750/750, payload reader 356/356, its renamed refusal mutated to fail); *not condensed:* `adr-unit.md`, `payload-format.md` and the lab READMEs beyond their terms and references — [`README.md`](README.md) |
| 69 | **MERGEPREP** — `claude/av1` folded into `claude/av1-unified`, the gate green, the merge into `main` described for the owner | done `e2a69bf` (the merge), `f64897c`, `c50de90` on `claude/av1-unified` — **ready to merge but for `main`'s 24 conflicts since PR #34; the gate green in full at `c50de90` (210 s, one skip by name)**: `claude/av1` folded in, its four lab scripts already removed on both branches kept removed; against `main` from PR #33's merge, 1 257 files, +61 397 / −5 369, no fetched data, built binary, secret or public address (480 kB of synthetic AV1 golden payloads and lab raw rows ship); HTJ2K codestreams byte-identical, the HTJ2K path changed by the delivered OpenJPH build (cold ask ×0.715–0.732), the range pass (×0.79–0.88), frame digests, the ask resume, the ClientHello fix (Firefox 30/30), two opt-in levers, and renames that break old callers (`--study`, `/study/metadata`, `exact-server`); a trial merge of `origin/main` stops on 24 files, mostly this branch's renames against PR #34's server refactor (§Blocked); the decoder build's Debian base came from `mirror.gcr.io` by digest (Docker Hub 429) — `docs/av1/MERGE.md` |
| 70 | **HTJ2KENC** — HTJ2K encoder settings (block size, decompositions, progression) by bytes and decode time, exact | done `cad330e` on `claude/av1-unified` (`6fe1ac5`, `e7ac731`, `0fcb37d`) — **the served profile kept: no setting wins**: 35 settings on nine series, the best per series 0.990–1.000 of the served bytes (−0.9 % only on 256² PET); decode within the round spread everywhere (every paired range spans 1; 0.95–1.10 where decode is the clock); 6 decompositions, the fewest bytes overall, ties on total time ×0.99–1.02 on 5/20/50 Mbit at 1× and 4×; `imagecodecs`' defaults differ only in SIZ depth (container bits, 1.000–1.002 of the bytes); 315 × 35 codings and 12 400 + 339 visits' frames exact — [`docs/decode/README.md`](../decode/README.md) §Encoder settings | |
| 71 | **INGEST1** — the AV1 ingest coded one encoder run per frame, so its bytes no longer depend on the worker count | done `d654553` on `claude/av1-unified` (`4c429c9`, `2caae72`, `35c3148`, `dc97ab2`) — **adopted: one aomenc run per frame makes every item byte-identical at 1, 2 and 4 workers, for +12–13 % encode CPU and no byte cost**: libaom 3.15.1 `good:6`, the first 16 frames of all 23 sets of rows 2, 45 and 46 (252 items), every set identical across worker counts (`ffdm_d` at 1 and 2: four exceed memory, as before), bytes 0.99987–1.00015 of the chunked ingest's, 0.999998 in total — a one-frame run writes the reduced still-picture header every golden item already carried (forcing video mode would rewrite 106 golden items, not taken; row 80's `grey420/g8`, written while it was on the branch, regenerated, exact through the gate); whole series, n = 5 interleaved, wall at 1 worker 54.1 → 61.0 s fluoroscopy, 92.2 → 103.4 s 10-bit volume, 147.8 → 165.7 s ultrasound, every range disjoint, +6–13 % at 4 workers; the chunked ingest gave three totals for the 10-bit volume at 1/2/4 workers, the new one the same every round; mutation (the chunked loop as the new arm) caught on both tomosynthesis volumes, the regenerated golden broken caught by the gate; gate green — [`ingest/coded-frames/README.md`](../../ingest/coded-frames/README.md) §One pipeline *Provisional (row DATAGUARD): its ultrasound numbers rest on lossy-sourced sets (`us_liver` flagged lossy at 12.4:1, the breast cine MPEG-4 clips) and enter no verdict.* |
| 72 | **SPLITRULE** — row 44's per-depth split rule adopted: the payload format and ingest widened to every depth it picks | done `ab798b3` on `claude/av1-unified` — **adopted: ingest's optimized split is k = 0 up to 9 bits, 3 at 13, 2 at 10–12 and 14; 15–16 bits refused by name, served as HTJ2K**: the format did not change (row 43 already carries every k), only `ingest.py`'s `optimized_split`; its per-depth test held against three mutants (each caught), the writer's 142/142 split-and-merge cells still exact; a 9-bit golden item (`g9`, plain and optimized) and `optimized/s13` remade at k = 3 (10-bit top, WebCodecs), every other golden and matrix item and the probes byte-identical; the real 9- and 13-bit series (MR 9-bit, CT, cone-beam) ingested by the rule, 198/198 frames exact natively, in Node (dav1d-WASM) and in Chromium 141 (WebCodecs 198/198, as chosen); Firefox and WebKitGTK not installed here — row 43 ran these layouts there; gate green on every step but the link check, which fails only on row 69's brief (`docs/av1/MERGE.md` not yet written) — `payload-format.md` §Representation at ingest and §The split per depth, README §A3 |
| 73 | **EXACTPROD** — exactness in production: how a client proves every shown frame bit-exact, acts on a mismatch and reports it; a measured design proposal | done `b1a6b5c` on `claude/av1-unified` (`824a05e`) — **check every frame with XXH3-64 before paint: 1–10 % of a decode, SHA-256 up to 1.44×**: headless Chromium 141, a decoder worker (OpenJPH package, samples in shared memory), 10 rounds Williams-ordered at 1× and 4×, 2 220/2 220 hashes and 5 760/5 760 pool checks exact against independent hashers over the encoder's input, `--mutate` failed every cell; at 1× SHA-256 ≈ 250 MB/s through WebCrypto and WASM alike (WebCrypto refuses shared memory and pays a copy; the host has SHA instructions), BLAKE3 ≈ 570, XXH3 ≈ 4 000; a decode-bound fill checked before paint ×1.00–1.15 with XXH3, ×1.15–1.51 BLAKE3, ×1.24–2.23 SHA-256; the brief's "today" corrected — this repository stores and checks no hash in production, so no SHA-256 fallback defect exists; proposed, not built, in [`docs/adr/exactness-in-production.md`](../adr/exactness-in-production.md) on that branch |
| 74 | **XENGINE** — why WebCodecs AV1 is not exact outside Chromium, and what would make it exact | done `aeb038e` on `claude/av1-unified` (`4fc3a3f`, `44ca30f`) — **Firefox 157 can be exact only at 8 bits, WebKitGTK 2.52.6 not without engine changes; the client now reads 8-bit GBR returned as RGB**: from the engines' sources and 13 layouts × 6 engine variants, every plane against the encoder's input: Firefox refuses monochrome (its FFmpeg path knows no grey format) and returns everything else as 8-bit `BGRX` through a compositor texture, so 10-bit is cut to 8 bits, but 8-bit GBR and 8-bit grey coded 4:2:0 at full range come back exact (all 256 values; limited range is off by ≤ 20); WebKitGTK takes only `av01.0`, hands the decoder frame alignment that libaom's `av1dec` refuses, maps no grey or 10-bit format, and with `dav1ddec` installed copies an even-width `I420` at the wrong stride (exact at 768 wide, wrong at 760); Safari's WebCodecs AV1 is a preview preference, off, software dav1d at 8-bit 4:2:0 only (device run under `## Blocked`); built: GBR from `BGRX`/`RGBX`, exact 40/40 per cell, 0.77× dav1d-WASM's decode at 1× and 0.62× at 4× in Firefox (10 rounds), Chromium unchanged, 3 mutations caught, gate green; proposed: 8-bit grey as full-range 4:2:0 (+0.07 % bytes) — [`docs/decode/README.md`](../decode/README.md) §Why, and what would make it exact |
| 75 | **LOSSCC** — the congestion controller under loss: today's against BBR and a Cubic that restarts after silence, on row 60's lossy cells | done `40f8309` on `claude/av1-unified` (`1fbf26b`, `3fe414f`) — **BBR is the larger lever under loss on both codecs, but costs some clean cells, so it is not adopted: the owner's call**: the 10-bit volume, 4 frames filled then 4 asked, 5/20/50 Mbit and `lte-good` × none, 1/2/5 % loss, ±20 ms × 1×/4×, HTJ2K and the optimized item each under `cubic-restart` and `bbr`; 28 Williams-ordered rounds, 3 416 visits, 1 281 `VOID` (the host's steal time rose), n = 8–19, 27 328/27 328 frames exact; under loss BBR fills in 0.04–0.76 of `cubic-restart`'s time (5 % at 50 Mbit 12.5 s → 0.55 s) and an ask's median falls from 1.4–3.6 s to 0.21–1.1 s, `lte-good`'s 5 % p95 from 10.2–10.7 s to 0.7–1.9 s; with nothing lost +2–3 % at 5 Mbit (8/8, 11/11 pairs), +12–13 % at 50 Mbit with ±20 ms jitter, ask p50 +70 ms on clean 20 and 50 Mbit at 4×; `cubic-restart` reproduces row 60 — `transport-conclusions.md` §1 (LOSSCC), `lab/av1/delivery/total-time` §Row LOSSCC |
| 76 | **ASKDEADLINE** — the client's own per-ask deadline under loss: does it fail asks the transport is still delivering; bytes as the only judge | done `555cc94` on `claude/av1-unified` (`ba8f394`, `7c342a1`) — **no client timer failed an ask under loss, before or after; one could, and now resumes instead**: the timers that can end a frame are the downloader's 3 s stall (doubling), `dialMs` and each transport's 15 s per-ask waiter (no byte for 15 s, restarted by every byte); the waiter failed an open session's ask outright once three silences had doubled the stall past 15 s — now `FrameTimeoutError` in both WebTransport clients, taken as silence and resumed until `tries` runs out (a node test that failed first, a conformance clause, 3 mutations caught); row 60's harness, 10-bit volume as HTJ2K, 4 filled + 8 asked, 20 Mbit and `lte-good` × clean/2 %/5 %, 1×, before/after/`stallMs` 15 s, 10 rounds interleaved, 155 of 180 visits kept, 2 160/2 160 frames exact, 0 asks failed in every arm; clean and iid loss: no silence over 1 s, fill ×0.98–1.03; `lte-good` bursts: sessions live through silences of up to 9.3–12.4 s, 3 s re-dials 2–12 a cell, ask p95 12.8–13.8 s at 5 % either way; a 15 s stall not adopted (p95 19.5 s, max 54 s; Chromium drops sessions at 6.6 s itself) — [`client/README.md`](../../client/README.md) §A session that dies is resumed, on that branch |
| 77 | **TOTAL4** — total time with every change adopted this round, per taxonomy series, HTJ2K against AV1, in Chromium and Firefox; the per-series codec rule | done `87c929b` on `claude/av1-unified` (`a79da56`) — **no series fills first in both engines on every cell, so ingest keeps HTJ2K**: 7 series, 5 links, 1× and 4×, Chromium 141 and Firefox 157.0.1, 3 746 visits, 90 949/90 949 frames exact; AV1 0.89–0.98 of HTJ2K's time wherever the wire is the clock on MR, 10-bit DBT, fluoroscopy, CT and ultrasound, but Firefox at 4× on 50 Mbit loses on every series (1.33–2.53, n = 8–13) and the mammogram and 14-bit projections lose even at 1× on 50 Mbit in both engines (1.05–1.18); 46 % of visits `VOID`, so the wire-bound cells are n = 1–9; ultrasound provisional (lossy-sourced); `docs/av1/README.md` §Every change of the round |
| 78 | **HTJ2KMT** — one HTJ2K frame decoded on several threads in the browser (code blocks in parallel): exact, and what it buys a phone-like CPU | done `6238b3a` on `claude/av1-unified` (`eb7acd9`) — **adopted: two threads, one helper, as the delivered OpenJPH build; an ask's lever, not a fill's**: OpenJPH 0.31.0 with row 41's code-block pool, headless Chromium 141 on 4 cores, 10 rounds interleaved; a frame ×0.70–0.83 at 2 threads on every frame from 1914×2572 up at 4× (10/10 rounds; 4 threads ×0.62–0.87), ×0.81–0.98 under it; a fill through the product's three decoders on 50 Mbit and LTE ×0.975–1.001 (largest frames at 4× only, slower nowhere; n = 10); +2.2–2.5 MB RSS a worker at 2 threads, +6–7 at 4 (n = 1–2); 2 560 + 9 600 + 250 frames exact, a flipped byte, a block left undecoded and the helper's glue URL removed each caught; the package the product loads is 0.5–8 % slower than the same OpenJPH built here — [`decode/README.md`](../decode/README.md) §Code-blocks on threads, measured, [`lab/av1/decode/htj2k-threads`](../../lab/av1/decode/htj2k-threads/README.md) |
| 79 | **COLDRTT** — round trips before the first exact frame on high-RTT links, cold and warm, HTJ2K and AV1 pages; preload or bundle what is serial | done `b1682eb` on `claude/av1-unified` (`151c1d9`, `cc47988`) — **the AV1 decoder's load was 2.0 serial round trips through WebCodecs and 3.9 through dav1d after the first item; fetched at the decoder's start −1.0 and −3.0, adopted; with the page's preloads AV1 reaches HTJ2K's 8.0**: cold, slope over 100/200/300 ms, HTJ2K 7.99, WebCodecs 10.02 → 8.98 (page preloads 7.98), dav1d 11.93 → 8.96 (7.96), every paired round won (29–38 a cell), 2 856 against 3 777 ms at 300 ms; warm 5.9–6.0 in every arm; session unmoved, +27 to +41 ms with the preloads; under 20 ms a ≤ 10-bit series pays +26 ms at 10 ms and +67 on loopback for the fallback's WASM, dav1d wins from 10 ms (−25, 3/4); 24 rounds Williams-ordered, 15–22 visits a cell, every frame exact against its source's checksum, the check and the two new tests mutated — [`lab/page-open/README.md`](../../lab/page-open/README.md) §Cold round trips by codec, `client/README.md` |
| 80 | **GREY420** — 8-bit grey coded as full-range 4:2:0 so Firefox's WebCodecs returns it exact (row 74's proposal): bytes, decode, total time per engine | done `84d848b` on `claude/av1-unified` (`d10656b`, `8f6d2b7`, `13ba840`) — **not adopted: 4:2:0 makes every 8-bit grey frame exact through Firefox's WebCodecs, but slows every Chromium fill**: `usb_cine` and `usb_still`, +0.20–0.23 % bytes; a frame 1.06–1.11× in Chromium, 0.63–0.66× in Firefox at 4× (1.03–1.04× at 1×), 10 rounds, 18 600/18 600 exact; whole fills, 17 rounds, n = 7–17, 75 760 frames exact (two Firefox visits got none): Chromium +0.2–0.5 % where the wire is the clock and +3.4 % on the cine at 4× on LTE and 50 Mbit (24/26 rounds slower), Firefox 0.74–0.87 at 4× on LTE and 50 Mbit, ±3 % elsewhere. The readers take 4:2:0 grey (`g8f` probe), the ingest keeps 4:0:0 (`--grey8 420` opts in); Firefox cannot dial the relay's fixed 5 Mbit link (§Blocked). [`payload-format.md`](payload-format.md) §8-bit grey as 4:2:0, [`lab/av1/delivery/grey-420`](../../lab/av1/delivery/grey-420/README.md) *Provisional (row DATAGUARD): its verdict rests wholly on `usb_cine` (lossy-sourced, an MPEG-4 clip) and `usb_still` (unknown, a PNG export); no sound 8-bit grey series was measured.* |
| 81 | **SERVERLOAD** — the server under many concurrent fills: where it saturates, and what each client's fill time does before and after | done `e1eb825` on `claude/av1-unified` (`be5a817`, `17f6ff8`, `3f05681`) — **one server core delivers about 400 MB/s of fills; a fill holds its single-session time until the sessions' rates sum past that**: server on one core of a 4-vCPU container, N native sessions (`fill_load`) on the other three, each asking the whole 10-bit DBT volume (13.6 MB HTJ2K, 13.0 MB optimized AV1) at once, unpaced or read-paced at 20 and 50 Mbit; 10 Williams rounds of 54 cells plus 10 of 10 around the knee, 640 runs, 1 012 320/1 012 320 frames byte-identical to ingest's checked items (a flipped reference byte failed every run); at 50 Mbit ×1.00 at 64 sessions (0.98–0.99 cores), ×1.25 at 80, ×2.12–2.19 at 128; at 20 Mbit ×1.00 to 128 (0.84–0.89 cores, 0.7 % of a core a fill), ×1.03 at 160; unpaced the server is the clock from 2 sessions; 2.0–3.1 ms CPU a MB, the same for both codecs; 3.7–4.8 MB resident a filling session (1.1 GB at 256); the server's core saturates, the host 58–60 % busy; from 192 sessions the rig's client sockets drop enough datagrams to back the server off, so nothing is claimed past 160 or beyond one core; gate green — [`docs/transport/transport-conclusions.md`](../transport/transport-conclusions.md) §4 *Many fills at once*, [`lab/server-load`](../../lab/server-load/README.md) on that branch |
| 82 | **CLIENTLAYOUT** — the client's folders by worker: `client/decode/` (the decode worker, its codec modules and their WASM builds) and `client/transport/` (the page side, the download worker, its transports) | done `0ceb8bd`, `bbda489` (the queue's paths `969a5e0`) — **the client by worker, behaviour unchanged**: `client/transport/` holds `consumer.js`, `downloader.js`, their tests, `ts/` and `wasm/` (the WASM transport's crate); `client/decode/` the decode worker, `wasm-glue.js`, `htj2k.js`, the AV1 modules by role (`av1.js`, `av1-payload.js`, `av1-dav1d.js`, `av1-webcodecs.js`, `av1-frame.js`, `av1-probe.js`) and `wasm/`; 34 files moved, 987 of 1 149 byte-identical, 135 differing only in paths; the golden coded frames and `av1-probe.js` regenerated into the new tree byte-identical; the gate green (dispatch 750/750, conformance 199/199 and 57/57, 0 links unresolved); the lab's before/after rigs keep archiving `client/downloader` from the commits that had it; `docs/cloud-queue.md`, not this queue's to edit, is exempt from the path check (`PATHS_AS_WRITTEN`, its mutant leaves 2 unresolved) — [`client/README.md`](../../client/README.md) |
| 83 | **TEAMAUDIT** — the repository against the team-readiness principles below: every gap, partitioned for rows 84–86 | done `4c44819` — **about 170 gaps at their lines, in three lists for rows 84–86 and four groups of owner decisions under Blocked**: one concept carrying 2–4 names in 17 places, queue and campaign labels in ~250 doc and code lines, no toolchain pin and 9 unlisted prerequisites, a gate that prints OK over 128 of 719 skipped checks with one stale-build guard; findings under this row |
| 84 | **NAMES** — names, the one glossary, environment variables and folder leftovers, per the principles | done `1457ed8`, `d10c8af`, `f747f95`, `c1ebc18`, `90f3a08`, `54704fd`, `8df7c96`, `3efa6aa`, `61b7b65`, `551b7a3` (the queue's paths `63e8db3` and after) — **every rename the owner adopted, the one glossary, the Names rule; gate green after each step** (dispatch 750/750, contract 199/199 and 57/57): "study" is the series it serves (`--series`, `/series/metadata`, `pack-series`, `series-bundle` moved to `common/`), `exact-server` is `series-server`, the conformance suite is the contract suite (`client/contract/`; DICOM's conformance statements keep theirs), an A/B arm is a variant (≈2 780 lines, `VARIANTS`, six lab files; arming a waiter or fill keeps its verb, ARM the CPU), the telemetry schema's `arm` is `client` and its row kinds ask/fill, the always-null paint and preload fields dropped (their mutant fails the record test), the patch `settings-in-handshake`, `Ask` enum → `Command`, `SeqReader` → `FillReader`, `--open-ask`/`openAsk` → the opening ask's name, `ENVELOPE_LEN` → `INDEX_LEN`, `session-telemetry.js`, the download worker; `docs/glossary.md` (32 terms) linked from the README, the Names rule in `CLAUDE.md`; no personal path as a default (the pinned emsdk, its absence refused by name; the rig's key and checkout required; traces in `lab/.traces/`); leftovers: five unread warm-up fixtures removed, the unapplied quinn patch beside its draft, two unreferenced lab files named where their numbers are, the campaign-named lab files and `lab/downloader-cost/` named by what they measure; `git grep` finds none of the old names outside the queues; *kept and defined instead:* "tile" (the server's read of an asked frame, the read-path ADR's vocabulary) and Media-complete; *not done:* queue-row labels in product docs' prose and headings (`docs/av1/README.md`, `docs/decode/README.md`, `transport-conclusions.md`) and campaign labels in lab code comments, which need each measurement named, and the several-names cases row 83 lists without a fix (`stallMs`/`quietMs`, the last byte's three names, the TCP client's four, `wt_port`) — [`docs/glossary.md`](../glossary.md) |
| 85 | **ONBOARD** — clone to green from the README alone, the docs essential and current, diagrams, each subject stated once | done `0d293c8`, `4bbaf19` — **a fresh clone, the README followed literally, reaches a running page and a green gate with nothing skipped**: two clones of `claude/av1-unified` in this container (Rust 1.97, Node 22.22, Python 3.11, Chromium of playwright 1.56.1); the first, on the old README, stopped at step 1 — wasm-pack's own fetch of binaryen 117 fails behind a TLS-intercepting proxy, though curl gets it — and its gate skipped 598 of 750 dispatch checks and the painter, which the README never named; fixed: `build.sh` fetches binaryen 117 with curl, SHA-256-pinned (a wrong checksum refused, exit 2), and wasm-pack runs it from PATH; the second, on the new README, ran every step to exit 0 — the AV1 build and the numpy venv included — a cell delivering 3/3 frames on both clients, and `scripts/gate.sh` GATE OK in 3 m 44 s cold, dispatch 750/750; the README now states Linux x86-64, Rust ≥ 1.88, Node 22 (`.nvmrc`, `engines`), Python ≥ 3.11 and every tool on PATH, pins wasm-pack 0.15.0 and playwright 1.56.1, numbers the steps through the gate (about 100 s warm, `--quick`, measured once), says the smoke bundle repacks byte-identical and what the dev certificate is; `CLAUDE.md` gains `--no-browser`; corrected: `rig-limits.md` seven limits, the framing ADR built, `adr-unit.md` in the ADR index, `server-load/` in the lab index, the client folders in `CLIENTS.md`, the AV1 test payloads and their generators in `FIXTURES.md`, nine fixture READMEs' dangling §0b and one-rate line and their generator, the nginx template's garbled line, a comment pointing at "the proposal"; a diagram of an ask during a fill in `WIRE.md`; *not done:* product docs pointing at the queues rather than their own §Open, the history narrative, the duplicates (the race, BBR's 12–19×, `read_ahead_kb`, FoD's two decoders in code), the other diagrams, READMEs for eight lab folders, the lab's copied helpers — [`README.md`](../../README.md) §Prerequisites |
| 86 | **CHECKS** — the gate runs every suite and says what it skipped, a stale-build guard, formatting, hygiene, dead code | done `58dceba`, `5624fa6`, `35eb0f4`, `1bcdb43`, `1d7d5df`, `46311dd` — **the gate says what it ran, what it skipped and how long each step took, and catches four things it let through**: each step timed, a failing step printed whole (not its `tail`), `GATE OK in N s; skipped:` with every SKIPPED line — the AV1 build, numpy, `--quick`, `--no-browser`, and now the io_uring tests that could not run (`SKIPPED:` from the server, `--nocapture`); refused before anything runs: a dav1d-WASM build older than `build.sh` or `dav1d_wrap.c` (exit 2), missing `nm`/`strings`; new steps: no personal path in any tracked file (`scripts/check_personal_paths.sh`), the split's merge test, `pack-series` and `check-fastpath` built and tested, the recorder's tests type-checked; the client absence check fails on a missing WASM build instead of passing, the server's drops two patterns that matched nothing; hygiene: 94 files with a shebang made executable, a sourced one not, `.gitignore` and `.cargo/config.toml` each thing once, the link check over every top folder; the comment budget reads shell and Python (four scripts trimmed) and skips tests as it says; dead code: one unused read-path helper removed, nine recorder exports made private; product comments: numbers, narratives, history and quinn's doubled defaults out; mutants, each caught: a touched `dav1d_wrap.c` (stale, exit 2), no numpy and `--quick` (three SKIPPED in the recap), `TMPDIR=/dev/shm` (three io_uring tests reported skipped), a `$HOME/.ssh` default (personal path), a broken link (the failing step printed whole), `proces.exit` in a recorder test (type error), eight comment lines in a script (over budget); gate green in 113–180 s; *not done:* a Rust, TypeScript or shell formatter and linter (the workspace is unformatted: 171 `cargo fmt` hunks — a style decision first), stale guards for the image and `cellcheck.sh`, the lab's Go and h3 clients compiled |
| 87 | **PAINTER** — a GPU painter in a worker for the client's decoded frames: the DICOM grayscale pipeline (rescale, VOI LUT function, MONOCHROME1), bilinear placement, fit, zoom, pan, quarter turns, flips, invert; proved against an independent CPU reference | done `e37b25a` on `claude/av1-unified` — **built as the paint sink, and equal to an independent CPU reference to the code in every 1:1 cell on SwiftShader**: `client/paint/` (page half, WebGL2 worker half, the PS3.3 window table, a float64 reference); 50 exact cells × DPR 1 and 2 (4 frames: 8-bit grey and RGB, 16-bit, signed 12-bit CT; every window, VOI function, MONOCHROME1, invert, rescale, quarter turn, flip, whole-pixel pan) at |Δ| 0; fractional cells reported, |Δ| ≤ 1–5 on 0–4 % of samples; mutants: the signed offset caught by 15 exact cells, the 4 formula mutants by 12 hand-worked VOI tests, NEAREST and the window after the filter only by fractional cells (|Δ| 1 → 26, 1 → 8), the 1/512 px quad by nothing here — a GPU run owed; SwiftShader paint 8.5 ms at 512², 211 ms new and 97 ms on a window change at 4096×3072, the page thread 0.1 ms; the 1:1 check in the gate, 2.4 s — `client/paint/README.md`, `ARCHITECTURE.md` §Paint |
| 88 | **EXACT** — row 73's proposal built: a per-frame XXH3-64 written at ingest and checked in the decoder worker before a frame is handed on; a mismatch decoded again and never shown as exact | done `a185910` on `claude/av1-unified` (`3113ac4`, `5da1260`; built twice — `8e287fc` by a session whose claim this one overwrote, kept as the product code) — **the check costs the fill nothing measurable, and is on wherever the metadata carries digests**: XXH3-64 per frame at ingest (`digests` in `metadata.json`), hashed in the decoder worker before a frame is posted, a mismatch decoded again on the other path (`exact` true/false/`"unchecked"`, `path`, `stats().exact` per path); fill check on ÷ off through the downloader, MR, fluoroscopy, projections and mammogram as served HTJ2K, r20000/r50000/wifi-home at 1× and 4×, 14 rounds interleaved, headless Chromium 141: ×0.945–1.013 medians, every cell's paired range covering 1 (largest ×1.011 mammogram r50000 1×, 8/10 slower, ~24 ms of 2.2 s); first picture ×0.945–1.097; 13 528/13 528 frames exact, 6 764/6 764 checked `true`; 184/608 visits `VOID`, kept n 5–12 a variant (n ≥ 10 not met on every cell); r5000 and LTE not run (wire-bound, could only hide it); rig 766/766 in Chromium, 13/13 in Firefox 157.0.1 (OpenJPH and dav1d-WASM `true`; its WebCodecs took none of the payloads, unverified there); 90 matrix payloads and every golden shape `true` against Python's xxhash; 7 mutants caught (verify always true, no digest true, no second decode, HTJ2K again on the reused object, AV1 again through WebCodecs, digest big-endian at ingest 80/90 `false`, zero-extended 40/90 `false`), `--mutate digest` 4/4 `false` — [`docs/adr/exactness-in-production.md`](../adr/exactness-in-production.md) §Built *All five links since (`3cbea6d` on `claude/av1-unified`): n = 10 a cell, r5000 and LTE included, fill on ÷ off ×0.98–1.04 at 1× and ×0.98–1.09 at 4× (the mammogram 2–3 % slower at 4× on r20000 and r50000), 8 900/8 900 `true`; every path `true` in Chromium (htj2k, WebCodecs, dav1d, mixed) and Firefox 157 (htj2k, dav1d) — ADR §Built.* |
| 89 | **INGEST** — one product command from a DICOM file or folder to a served bundle: the display attributes in the metadata, the per-frame digest, the codec chosen per series, exact at ingest | done `78357ea` on `claude/av1-unified` (merged `cb58b10`) — **adopted: one command from DICOM to a served bundle, as exact as the two steps and no slower but on single-frame series run one after another**: `ingest/from-dicom/from_dicom.py` (pydicom 3.0.1, NumPy, xxhash pinned) reads one object or a folder of one series by InstanceNumber, native pixel data parsed by hand (RLE through pydicom), refuses by name mixed series or sizes, ties, lossy and unpinned-lossless syntaxes; writes `.sbnd` and its metadata — bits, photometric, modality, frame time, rescale, every window (functional groups, per-frame over shared), `perFrame` where they vary, digests, no identifier; `auto` = HTJ2K (row 77 adopted none), AV1 presets by content from row 14; the core in `ingest/coded-frames` imports nothing from the lab, refuses aomenc, OpenJPH or the in-process decoders unless pinned, and the lab imports it; on `ct_nlst` (76 signed single-frame files), `us_liver` (RGB), `dbt12_ea1141` (enhanced) and `ffdm_a` (4 views, 4 series — refused as one folder, by name): samples 180/180 = `fetch_data.py`'s `NNN.raw`, attributes = DCMTK 3.6.9's `dcmdump` 180/180, bundles identical at `--jobs` 1/2/4, `check.mjs` 180/180 HTJ2K and 180/180 AV1, fill 180 + 180 `exact: true`; ingest time a frame ÷ the two steps, 6 rounds interleaved: CT ×0.81 [0.66–0.91], cine ×0.71 [0.65–0.86], tomosynthesis ×1.30 [0.81–1.56] (within the spread), mammogram ×2.52 one view after another but ×0.65 [0.49–0.97] with the four series run at once; 5/5 named mutants fail their test (sort reversed, PlanarConfiguration ignored, sign not extended, shared window over per-frame, lossy accepted); several series a study proposed in `docs/FIXTURES.md`, not built — [`docs/FIXTURES.md`](../FIXTURES.md) §From DICOM, `lab/av1/exact/from-dicom` |
| 90 | **VIEWER** — the product's page on its own downloader: metadata → fill → exactness → paint; step, cine, window/level, a status line; a page check that fails anything short of a complete, exact, drawn page | done `43b2bfb` on `claude/av1-unified` (merged `7c0812f`) — **adopted: the viewer is the product's page, and it adds nothing to the fill**: `client/viewer/` at `/` (dev-server.py and nginx), the whole series as the opening fill, the codec's code alone preloaded, painted through the painter, a frame not exact marked and counted, step, cine (FrameTime/CineRate), window and level, zoom, pan, turn, flips, invert, `?fill=0`; `dev-server.py` makes the dev certificate when missing or ending within a day (`gen_dev_cert.sh --if-needed`); `client/viewer/check.mjs` (Chromium, stock Firefox, `--url`) green in Chromium 141 and Firefox 157.0.1 (Xvfb, Mesa llvmpipe) on row 89's CT (76), RGB cine (70, cine run) and tomosynthesis (29), each as HTJ2K and AV1: every frame exact, the protocol after the fill, first/middle/last readback = CPU reference byte for byte, HTJ2K and AV1 readbacks identical; 5/5 mutants fail it by name (frame dropped, sample altered, WebCodecs taken away, AV1 code on an HTJ2K page, paint a row off); the gate runs it on a 3-frame series and names the cross-codec arm and Firefox skipped; fill against total-time's page (same downloader and decoders, no paint), from navigation, CT, row 23's five links at 1× and 4×, 12 rounds interleaved: ×0.994–1.004 on the fixed links and LTE in both codecs (wifi-home ×0.86–1.53, n = 2–7), first exact frame on screen +55–148 ms at 1×, +212–331 ms at 4× (the first paint, on SwiftShader); 36 480/36 480 frames exact and checked; 177/480 `VOID`, 1–12 pairs a cell (n ≥ 10 on r50000 only) — [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) §The viewer, `client/README.md` §The viewer |
| 91 | **DECODERBUILD** — the client's decoder builds made by the product, reproducible from pinned sources: OpenJPH at a 4 MB heap with the range in the pack, dav1d-WASM, the third-party notices | done `041c833`, `80a7b8a`, `3187b22` on `claude/av1-unified` — **adopted: the product builds its decoders, OpenJPH single-threaded at a 4 MB heap, faster than the package in every cell**: through the downloader on `g512` (three decoders, 10 rounds Williams-ordered, every frame exact) fill ×0.927 at 1× and ×0.941 at 4×, cold ask ×0.715 and ×0.732 (10/10), JS+WASM 157 → 22 MB; row HTJ2KMT's pool tied fills and lost the 4× cold ask (×1.078, 3/10), so it is not shipped; parity 783/783 frames on nine sets, signed included; the 107 AV1 payloads exact through dav1d in Chromium, Firefox and WebKitGTK (with SAB); two clones at different paths build identical bytes; the page and the gate load only what the manifest pins; mutants caught — `docs/decode/README.md` §The build, as delivered |
| 92 | **DEPLOY** — the two images and compose made fit to run unattended: ten fixes, TLS for the page off loopback, the viewer, decoder builds and notices in the web image, verified by the page check against the deployment | done `b1920de` on `claude/av1-unified` (merged `188aa67`) — **adopted: the deployment runs the viewer, the decoder builds and the server unattended, from this tree**: the ten fixes (`:z` kept; stop 0.45–0.49 s server, 0.51–0.54 s web, so no `init`; a new ECDSA certificate (10 days) and transport file, written whole, at every start, the server under `timeout 9d`; gzip on modules, WASM and metadata; crates copied alone with cargo cache mounts, `npm ci`; `restart: unless-stopped`; healthchecks and `service_healthy`; uid 10001 owning `/certs` 0700 and the transport volume (web's mount point too: a fresh volume took root from it on the first run); every base pinned by digest, `REGISTRY` for a mirror; `--locked`, `server_tokens off`, unused routes gone), `PUBLISH_ADDR` (127.0.0.1), `TLS_DIR` (443, HTTP/2), `WT_URL`, `STUDIES`/`SERIES` mounted, only `/`, `/client/**`, the metadata and the transport file served; docker 29.8.2 (rootless podman not installed here, unchecked; Docker Hub 429, built through `mirror.gcr.io`, with `BUILD_CA` for this host's proxy): cold build 114 s, after a doc edit 1 s with 23/23 steps cached; images 132 MB server, 95.8 MB web; row 90's page check `--url` on row 89's CT (76 frames) passes on loopback with no certificate flag and off loopback over TLS from the host's second address (CA in Chromium's NSS store); `restart server` rotates the certificate and the next open passes; `check_equivalence.sh` green on 10 paths, 8 hidden, gzip and the Server header, its 4 new assertions each mutated to fail; the gate is green but for `lab/bb3/cell3-w4b-summary.txt`'s personal path, row 104's file — [`deploy/README.md`](../../deploy/README.md) |
| 93 | **CODECDOCS** — the codec docs as the one source of truth: a comparison of every codec measured, one doc per codec under the same headings, the target series' bit depths with their sources | done `7d91bd5` on `claude/av1-unified` — **the codecs side by side in one place, every number keyed to the doc that states it**: docs/codecs/README.md (the rule; AV1's series, breast family first, CT and MR HTJ2K, none qualifying by row TOTAL4's rule; the choice per series and depth as built; 13 target series' depths with sources; at-a-glance and side-by-side tables, 10 columns × 5 codecs, every cell's numbers found in its keyed source by script, the four derived ranges restated exactly; why HTJ2K is the default and four things that would reopen it; 9 specifications with edition, URL and date read 2026-10-09 — AV1 1.0.0 Errata 1, AV1-ISOBMFF v1.3.0 §5, WebCodecs WD 2026-10-07, its AV1 registration, DICOM PS3.3/3.5/3.6 2026d (no AV1 UID in Table A-1), Sup 232, T.814 (06/19) — and the sold or unread ones); `htj2k.md`, `jpeg-xl.md`, `jpeg2000.md`, `av2.md` under the 17 headings, `docs/av1/README.md` nested under them with every section name kept and a new §The bit split, explained (worked example 2731 → 682 + 3 at k = 2, CT −997 → 131 + 3 at k = 3); six passages moved, listed in the commit; glossary + `representation`; link check 0 unresolved (a broken link in the new docs mutated to fail), gate green (`--quick`) — docs/codecs/README.md on `claude/av1-unified` |
| 94 | **DATAGUARD** — every set's pixel provenance recorded and enforced: a provenance column, the fetch refusing lossy or video sources unless marked, the ultrasound claims corrected in place | done `526ab5d` on `claude/av1-unified` (`201b702`) — **one DICOM set is flagged lossy, `us_liver` (Lossy Image Compression 01 at 12.4:1); every other IDC set uncompressed and never flagged (25 sets, 827 files read)**: a provenance class per set in `data.json` (23 sound, `mg16_cbis` lossless-but-unrepresentative, `us_liver` and the two MPEG-4 breast cine lossy-sourced, `usb_still` unknown); `fetch_data.py` records transfer syntax, Lossy Image Compression, Image Type and Presentation Intent and refuses a source its class does not admit — 17/17 guard cases in the gate, 4 mutations each caught, on the real files `us_liver` and `usb_still` marked sound refused and five sets accepted with their digests unchanged (the 1.5 GB cine zip not fetched; its path is the unit test's); the sound-data rule in §Protocol; the ultrasound claims of `README.md` and 20 rows' verdicts marked provisional in place; the missing sound sources under §Blocked. Finding: `docs/FIXTURES.md` §Provenance. |
| 95 | **DBTSCALE** — DBT slices at scale on sound data: whole uncropped volumes, every system of the large CC BY collection, bytes, inter and total time | done `3c2dda6` on `claude/av1-unified` (`74fc505`, `96018fb`, `1d5c155`, `bb6d2bb`) — **the per-depth rule holds on bytes at scale; the time verdict narrows: HTJ2K's at 4× on 50 Mbit/s**: fifteen whole, uncropped DBT volumes, five exams from each of the three systems, all sound, 994 slices, every frame exact in every arm; k = 2 the smallest arm on 15/15 at `allintra` 7 — 0.948–0.956 of HTJ2K at 12 bits, 0.939–0.956 at 10 bits and 0.760/0.797 on two 10-bit volumes (unexplained); cpu0 on the middle slices puts k = 3 ahead at 12 bits by 0.3–0.8 %; decode (every 8th slice, 8 rounds, 8 320/8 320 exact) never as fast as HTJ2K, fastest 2.9–3.7× at 12 bits and 2.0–2.6× at 10; total time on one exam a system (every 8th slice, 6 rounds, 3 024/3 024 exact, 119 of 324 visits `VOID` and counted, within 0.04 of the kept) k = 2 0.96–0.97 at 5 Mbit, ties at 50 Mbit 1×, 1.30–1.39 at 4× on 50 Mbit — whole volumes in every cell were ~100 h here, not run. Finding: `README.md` §The split per depth, `lab/av1/bytes/dbt-at-scale`. |
| 96 | **FFDMSCALE** — full-field and synthesized 2D mammography at scale on sound data, FOR PRESENTATION and the 14-bit FOR PROCESSING raw images | done `c295749` on `claude/av1-unified` (`e111f72`, `7386ade`, `4389264`) — **HTJ2K for mammograms; where AV1 is used, k = 2 at 10 and 12 bits, and at 14 bits k = 2 at 1× and w10 at 4×**: 39 four-view exams of EA1141, all sound — five per system of FFDM for presentation and of its 14-bit raw on all three systems, five of one vendor's synthesized 2D and four of the other's (all it holds; CMB-BRCA's one, `syn2d_c`, the fifth), 159 images exact in every arm; bytes at `allintra` 7: for presentation AV1's best 0.945–0.992 of HTJ2K on system C, 0.956–1.017 on A, only 0.990–1.003 on B (k = 3; k = 2 1.030–1.043), synthesized k = 2 0.940–0.971, raw k = 2 or 3 0.935–0.975; decode (one median exam a kind and system, 6 rounds, 1 536/1 536 exact) never as fast as HTJ2K — 3.1–3.7× at 12 bits, 1.7× at 10, at 14 w10 1.9–3.9× and the 12-bit top 6.9–8.3×; total time on the same exams (4 rounds, 2 304/2 304 exact over 576 visits) as fast or faster for HTJ2K on every cell but 5 Mbit/s at 1×, where AV1's best is 0.95–1.01, elsewhere 0.99–1.23 at 20 Mbit/s and 1.04–1.61 at 50; cpu0 not run (some 17 hours here); [`lab/av1/bytes/mammography-at-scale`](../../lab/av1/bytes/mammography-at-scale/README.md), `README.md` §The split per depth |
| 97 | **RGBNATIVE** — the colour transform (RCT) against GBR on natively stored, uncompressed colour ultrasound stills | done `e6d0ca4` on `claude/av1-unified` (`867045b`) — **the RGB rule holds on sound data, by more than it was sized: RCT is 0.54–0.66 of GBR's bytes and 0.65–0.94 of HTJ2K's**: 48 colour ultrasound stills stored natively, uncompressed, flag `00` (six sets, six CC BY collections, 42 with colour flow), cpu0, every item exact natively and 2 304/2 304 frames in Chromium (dav1d-WASM; `--mutate sample`/`truth` 0 exact); GBR 1.05–1.53 of HTJ2K; RCT decodes in 0.65–0.90 of GBR's time (faster in 96/96 set-rounds) but 2.1–2.9× HTJ2K's at 1× and 1.4–2.3× at 4× (8 rounds); stills, not a cine; why AV1 gains a third over HTJ2K here (4 % on `us_liver`) not measured. Finding: `lab/av1/bytes/colour-transform`, `README.md` §A1 (LLSIZE). |
| 98 | **GOPSCOPE** — the frame-group evidence re-scoped to the AV1 taxonomy and its wording corrected in place; closed rows resting on off-taxonomy content or thin sampling listed for the owner | done `e8077ea` on `claude/av1-unified` — **the group evidence that bears on AV1 is four DBT volumes, libaom only, alt-ref off, two presets, G = 8 and 16 alone on three of them**: a Scope paragraph in `README.md` §A1 marks rows 6 and 21 and any CT or MR outside the target series and the ultrasound lossy-sourced; "inter does not pay" narrowed in place in 9 statements over 6 files (`README.md`, `lossless-literature.md`, `lab/av1`, `breast`, `llsize`, `encx`); 17 closed rows listed under the brief for the owner; `check_links.py` green |
| 99 | **GOPTHEORY** — frame groups, phase 1: why inter should or should not help lossless coding of each target type, from primary sources; predictions, protocol and decision rule pre-registered | done `e9d247a` — **inter can beat intra on noise only where the next frame's noise correlates above ½; on DBT that is predicted not to happen (ρ 0.2–0.5, gain < 5 %), on native ultrasound cine it is (≥ 20 %)**: AV1 lossless keeps every inter tool and changes only the residual (spec §5.9.2, §7.13.3); libaom 3.15.1 still filters its hidden alt-ref in lossless, SVT-AV1 4.2.0 does not; ten predictions P1–P10, ρ measurable before any encode; adopt G > 1 for a type only at ≥ 20 % under intra and ≤ 0.80 of HTJ2K on every sound series, with the mid-group ask inside one HTJ2K decode plus the wire time saved — `gop-theory.md`, the protocol alone in `gop-protocol.md` |
| 100 | **GOPMEASURE** — frame groups, phase 2: row 99's protocol run on the target content available, by a session given only the protocol and the decision rule | done `cbbdf06` on `claude/av1-unified` (`7129f62`, `61016ce`) — **DBT: G = 1, conclusive by the pre-stated rule**: run in a separate session given only `gop-protocol.md`; ρ on every adjacent slice pair of the 15 sound DBT volumes (top stream, best offset: system medians A 0.112, B 0.215, C 0.117; low stream at the noise floor 0.058–0.061); codings on each volume's middle 16 slices (cpu0 needs ~1 h a 16-slice group here; whole volumes and G ∈ {24, 32, whole} not run, not claimed): libaom `good` 6 alt-ref off, every G > 1 larger than intra on 14/15 (best +1.51 %, `b3` G16), cpu0 best +0.13 %; alt-ref on and SVT-AV1 inter not lossless on the 10-bit tops of systems A and C (aomdec and dav1d agree: the streams are wrong), exact on B, where alt-ref adds 1.2–6.8 points (best +3.19 %) and SVT preset 0 +2.43 %; libaom alt-ref off 159/159 cells exact; decode at 4× every G > 1 4.6–24.6× over the rule's bound (WebCodecs, n = 10, 5 760/5 760 exact). Predictions: P2 and P5 held, P1 not refuted, P3 did not hold, P4 not refuted (its 80 % clause failed), P6 and P7 refuted on system B, P8–P10 not testable (no sound data, §Blocked). Found: dav1d-WASM fails every split group at G > 1 (the low unit decoded on the top's instance with `key: true` flushes its references) — reported, not fixed. Finding: `lab/av1/bytes/frame-groups/README.md`, `README.md` §A1. |
| 101 | **GOPREVIEW** — frame groups, the review: row 99's predictions against row 100's numbers, conclusive or not, and why | done `3518d2a` (`4030965` on `claude/av1-unified`) — **conclusive for DBT: G = 1; open for cine, ABUS and angiography for want of sound data**: the mechanism held where it decides (median ρ 0.11–0.22 on every system, far under the ½ inter needs; P2 held, best gain +1.51 %; P5 held, the low stream is independent noise), P1 missed its 0.2–0.5 band on two systems (0.11–0.12) without being refuted, P3 near untestable (14 of 15 gains ≤ 0), P4's 80 % clause failed on gains of 0.1–1.5 %, P6 and P7 refuted on system B (alt-ref on and SVT-AV1 find up to 3.2 % of structure, lossless only on its 8-bit tops), P8–P10 untested; the rule's clause 2 met by three systems of five series. Finding: `gop-theory.md` §4a, `README.md` §A1. |
| 102 | **PUBLICAUDIT** — what a public repository should not carry, analysed for the owner: each item's risk, what depends on it, keep, reword or cut; nothing cut | done `d7f7f63` — **no secret anywhere; one item asks for action outside the repository, nine are reword-or-keep calls**: six branches' trees, 37 tags and 1 990 commits swept for keys, tokens, passwords, addresses, hosts, accounts, personal paths, third-party names, drafts to other projects and archive tags; the rig's public address is still in `claude/av1`'s tree (10 lines, 9 scripts), all 37 tags' trees and 19 commits — re-address the rig or close its ports to the workstation rather than rewrite history; `docs/rig-limits.md` §9's port and root-account detail and the npm scope naming another viewer's SDK (17 files, 20 lines) to reword; vendor citations, identities, 37 tags (23 named for a coding tool), drafts and paths to keep; found on the way: `archive/variants-2026-10-03`, cited 15 times, does not exist (the tag is `archive/arms-2026-10-03`) — the brief's *The audit*, one line under §Blocked |
| 103 | **BB3** — v3's loss bound over BBR built opt-in, and its pre-registered protocol written apart | done `45326d3` on `claude/av1-unified` (`39a495f` the codec docs' follow-up) — **built opt-in, unmeasured, its protocol fixed before data**: `--congestion bbr-bound` (`server/src/transport/loss_bound.rs`, a cap over quinn's BBR through the public trait: a round losing > 2 % sets `inflight_hi` := max(in-flight, 0.7 × BDP), the window ≤ 0.85 × `inflight_hi`, regrown 1, 2, 4… packets a clean round), the default still `cubic-restart`; 5 unit tests (4 rules, 1 wiring), 9 mutations each caught; gate green (full, absence checks included); `docs/transport/bb3-protocol.md` (4 cells, 3 arms, the brief's rule); predictions per cost in §1 under BB3 — passes PROF's CoDel cell, ASKL's 4 % and W4b's overrun (≲ 2 600 lost, derived), but not the default: on `l2`/`l5` its cap sits near 0.6 BDP, up to ~1.7 × `bbr`'s fill where the wire is the clock — [`transport-conclusions.md`](../transport/transport-conclusions.md) §1 BB3 |
| 104 | **BB3MEASURE** — row 103's protocol run by a session given only the protocol and the decision rule | done `bf199fb`, `396d7c9` on `claude/av1-unified` (raw `lab/bb3/`) — **the bound fails its rule; `cubic-restart` stays the default, `bbr-bound` opt-in**: cell 1 (7 rounds) 2.27–3.23 % of its packets meet CoDel against 2 % (queue 49.9 ms, fill ×0.933 of `bbr`, both inside), but every `bbr` and `bbr-bound` visit there `VOID`; cell 2 (9 rounds) +375 ms over `bbr` on the 4 % ask p50 against +73, 0/5 rounds lower; cell 3 (7) passes, 927 lost against 3 300; cell 4 6 of 10 rounds (the 5 h budget), 603/1 440 `VOID`, 34 of 44 lossy cells over 1.10 × `bbr` — `docs/transport/transport-conclusions.md` §1, The bound, measured |
| 105 | **CROSSOVER** — where AV1 fills first: a model from the measured bytes and decode times predicting the link speed at which each codec wins, per target series and engine; protocol pre-registered | done `b19aa26` on `claude/av1-unified` — **a pipeline model predicts the fill within 0.05 on 44 of rows 95–96's 48 cells (one parameter fitted); AV1 fills first below 45–56 Mbit/s on DBT at 1× and 11–14 at 4× in Chromium, 4–7 and ≤ 2 on FFDM, 15–36 and 4–10 on synthesized 2D, about half that in Firefox; a per-link rule gains < 5 % on phone links except on the two volumes AV1 codes a fifth smaller (13–22 %, a per-series choice)**; misses all at 4× on 50 Mbit (saturation); protocol pre-registered — `docs/av1/README.md` §Where AV1 fills first, a model; `docs/av1/crossover-protocol.md` |
| 106 | **CROSSMEASURE** — row 105's protocol run by a session given only the protocol and the decision rule | done `4204225` on `claude/av1-unified` (`591b033`; rounds `ca818fd`…`d23f45d`) — **strict and round-paired agree (§Protocol's rule for a host over its bar): 8 762/8 762 frames exact over 1 422 visits, but 44 % `VOID` (35 % fixed, 56 % `lte-good`) and 143 of 192 Firefox 10 Mbit/s dials unsettled leave n ≥ 10 kept pairs on 5 of 60 cells; paired every visit (n = 12 on 48), 50 of 54 cells fall on the predicted side, the misses all `lte-good` (Firefox 1× DBT 1.01–1.03 against 0.99, `syn2ds_b3` Chromium 1× 1.016 against 0.97, `dbts_b4` Firefox 4× 1.29 against 0.87); Firefox 4× runs 0.29–0.77 over prediction on `lte-good`; no series gains ≥ 5 % on a phone link in both engines at both CPUs (`dbts_b4` 13–22 % on all but Firefox 4×), so no per-link rule and no per-series one; `syn2ds_a3` Chromium 1× alone not conclusive on this host (1.010 strict, 1.028 paired)** — `docs/av1/README.md` §Where AV1 fills first, measured |
| 107 | **EVENREVIEW** — rows 103–106 reviewed: predictions against numbers, conclusive or not, and why | done `97fc087` on `claude/av1-unified` — **BB3: conclusive for the decision on cell 2 alone (+375 ms against +73, 8 kept runs), so `cubic-restart` stays the default; refuted the CoDel share (2.3–3.2 %, all-`VOID` visits) and the ask slope, held the fill (×0.933) and the overrun (927 lost). CROSSOVER: both readings agree no per-link rule and no per-series one; sides held on 28/30 Chromium and 17/20 Firefox kept cells, the misses `lte-good`; refuted Firefox's assumed AV1 decode (fitted 2.1–3.3 × WebCodecs', not 1.6–2.2) and the LTE trace as its mean (every 4× cell above prediction); `syn2ds_a3` Chromium 1× and Firefox 10 Mbit/s not conclusive** — `docs/transport/transport-conclusions.md` §1 The bound, reviewed; `docs/av1/README.md` §Where AV1 fills first, reviewed |
| 108 | **HELPERSTART** — the HTJ2K pool's helper started after the decoder answers ready: the cold ask against the single-threaded build, exact | done `f8db4cf` on `claude/av1-unified` (`c0636c5`, `1d3c22d`, `50bfbd3`, raw `9f5b478`…) — **L1 does not hold**: the helper started after ready (`-sPTHREAD_POOL_DELAY_LOAD=1`) cuts the pool's ready-path cost (three decoders ×1.36 → ×1.14 of the delivered build at 4×) but its cold ask on `g512` is ×1.06 at 1× and ×1.19 at 4× (≤ ×1.03 in 4 and 2 of 10 rounds, 8 needed) and its warm ask on the projections ×0.81–0.84 (≤ ×0.85 in 6 and 7 of 10) where the pool keeps ×0.72–0.76; fills ×0.987–1.004 every arm; 17 400/17 400 frames and 30/30 LTE asks exact, strict and round-paired agree; docs/decode/README.md §Code-blocks on threads, measured |
| 109 | **REGIONDECODE** — region decode, the container half: a 1:1 viewport decoded alone, one asked frame in stripes across the idle decoders; exact and container speed | done `d2aeae7` on `claude/av1-unified` (`6618b0e` the harness, `34e7ff9` the licence) — **not worth a design by §L2's rule; stripes beat today's pool**: OpenHTJ2K v0.19.0 to WASM, 10 rounds, 2 800/2 800 regions, stripes and frames exact; a 1080×2400 viewport costs its rows, not its area (it decodes every block of each row it reaches, 72–84 % of a 3328×4096 frame's block bytes), ×0.82–0.97 of OpenJPH's whole frame there against ≤ 0.40 and ×1.06–1.25 under it; 3 stripes on 3 workers ×0.60–0.68 of OpenJPH at 4× on the large series against ≤ 0.60 (×0.70–0.74 at 1×), ×0.77–0.85 of the pool (10/10); OpenHTJ2K whole ×1.13–1.41 of OpenJPH; L2-P1, P2 refuted, P3 held at 4× only; `docs/decode/README.md` §Region decode, measured |
| 110 | **COARSEPOOL** — the pool's hand-off unit a subband or a resolution instead of a row of code-blocks | done `3d399cb`, `b9178fa` on `claude/av1-unified` — **the row unit stays**: §L4's rule fails for both coarser units; frame bench, first 4 frames of `g512` and five breast sets, 10 rounds × 3 passes, 1× and 4×, 1 920/1 920 frames exact, 3 mutants caught on all six sets; × single-threaded: 512² subband ×0.70–0.71, resolution ×0.68–0.70 against the row's ×0.80–0.86 (≤ ×0.80 in 7/10 rounds, resolution 10/10 at 4×); 0.03 under the row on every large series in only 2–7/10 rounds (projections at 1× tie: row ×0.68, subband ×0.69, resolution ×0.70); heap +20–22 MB at 1914×2572 (not ~15) and +54–61 MB at 3328×4096, the subband as costly as the resolution, since OpenJPH pulls every band at once; P1 coarse held, row faster than predicted; P2 row 4/6 held; P3 refuted — `docs/decode/README.md` §A coarser hand-off unit, measured. *The unified branch's gate is red on one path of row 108 to `levers-protocol.md` (not on that branch; row 109 fixed its own) and, in this container, on the viewer check for want of the docker-built decoder (Docker Hub 429).* |
| 111 | **WEBGPUHT** — a WebGPU HT block decoder, built and proved exact on a software WebGPU; no timing | done `6b0fb86` on `claude/av1-unified` (`4430969`) — **L3-P1 and L3-P2 held; the container stage passes: 4 768 of 4 768 frames exact on SwiftShader**, the cleanup pass as two WGSL kernels (MEL/VLC a thread a block, MagSgn a workgroup a block), the 5/3 synthesis and the pack; the 12 synthetic sets and every frame of the 5 breast series, one frame a dispatch (13 dispatches, 1 read-back a frame) and batched (0.15–3.25 and 0.01–0.25 a frame), workgroup scan and `subgroups`, plus 136 frames in mixed batches of all 17 sets; 4 mutants each 0 / 580, the lane check's inverted counts faults; refinement passes not built — no frame here has one; no timing (SwiftShader is the CPU). `docs/decode/README.md` §A WebGPU block decoder, built |
| 112 | **DECODEPACE** — decode paced to the wire during a fill: fill time unchanged, CPU busy time and wake-ups | done `0014bf6` on `claude/av1-unified` (`9610331`, `c82b757`) — **the fill holds, the decoders' CPU and wake-ups fall, but the container stage misses its rule on one cell**: `followQueue` on the downloader (off by default, both dispatch clauses tested), the delivered OpenJPH build, whole tomosynthesis 29 × 614×1359 and full-field 4 × 3328×4096, 20/50 Mbit and `lte-good`, 1× and 4×, 16 rounds Williams-ordered, 6 336/6 336 frames exact, 41/384 `VOID`; pace ÷ today paired by round, fill ×0.998–1.002 median a cell (L5-P1 held; P2, full-field 50M 4×, ×1.001, 15/16), decoders' CPU ×0.85–0.98 (P3's ×0.97–1.03 refuted low in 7 of 12 cells: today starts two decoders it never uses), wake-ups ×0.18–0.47 (P4 held); tomosynthesis on LTE at 4× is ≤ ×1.01 in 12 of 16 rounds (strict 8 of 11; the readings agree), its overshoot mostly in the last byte's arrival. Energy not measured; the phone stage waits on phones. `docs/ARCHITECTURE.md` §How many |
| 113 | **LEVERREVIEW** — rows 108–112 reviewed: each lever's predictions against its numbers, conclusive or not, and the phone or GPU measurement each still needs | done `470e42d` — **L3 passes its container stage; L1, L2, L4 fail their rules, conclusively for L1, L4 and L2's viewport; L5 misses on one cell (12/16 rounds, median ×1.002), weak evidence against it**: L1 P1 refuted both arms (pool ×1.16, *late* ×1.19 at 4×), P2–P4 held for the pool and refuted for *late* (warm ×0.81–0.84 against ×0.70–0.80), P5 held; L2 P1, P2 refuted (viewport 0.60–1.04 of OpenHTJ2K whole: its column range decodes every block of each row), P3 held at 4× only (0.47–0.49), stripes ×0.77–0.85 of the pool; L3 P1, P2 held, refinement passes and every time untested; L4 P1 held for coarse, P3 refuted (+20–22 MB, not ~15); L5 P1, P4 held, P3 refuted low (CPU ×0.85–0.98: today starts two decoders it never uses); the pool decision now has its cold ask on large frames (×0.89–0.94); phones decide L3's time and L5's energy; three choices under §Blocked — `docs/decode/levers-protocol.md` §Review |
| 114 | **FMT** — rustfmt and clippy defaults adopted, checked by the gate | after the owner merges main |
| 115 | **FFDIAL** — Firefox's dial through the relay that does not settle on 5–20 Mbit/s links: the cause, and a fix if it is ours | done `1012f95`, `0198d24` on `claude/av1-unified` — **ours, fixed: the server's early SETTINGS never left for a ClientHello split across two datagrams; Firefox's dial now settles 30/30 on every fixed link, against 0, 4, 12 and 21 of 30 at 5, 10, 20 and 50 Mbit/s before**: Firefox 157's ClientHello is 1 841 B in two Initial datagrams (Chromium 141's fits one); the 0.5-RTT patch started the HTTP/3 driver on the first, its `open_uni` found a stream budget of 0, and quinn-proto 0.11.18 raises the budget from the transport parameters without waking it — the QUIC handshake completes, SETTINGS never go, Firefox holds its CONNECT (RFC 9220 §3) until the 5 s deadline; a slower link spaces the two datagrams further. Fix: the driver starts once the ClientHello is whole (`handshake_data`, one line in the wtransport patch); `a_client_hello_in_two_datagrams_still_gets_its_session` fails without it (no session in 3 s), passes with it. Bare dial, 20 ms each way, 30 rounds Williams-ordered, settled medians 183–200 ms after; SETTINGS now ride the flight's second datagram (217 → 245 B), Chromium's dial ties (87.6 → 87.4 ms, 20/20 each). Gate here: all green but the viewer check (no Docker-built decoder) and row 108's dangling path, both before this row; the missing wake not reported upstream — `docs/transport/transport-conclusions.md` §3 Firefox's dial on a slow link |
| 116 | **TAGCITE** — the 15 citations of `archive/variants-2026-10-03`, a tag that does not exist, point at the one that does | done `9e1edb6` on `claude/av1-unified` — **15 of 15 citations now name `archive/arms-2026-10-03`, 0 cite a missing tag**: 8 files; four cited paths had moved since the tag and now read as they were at it (`client/transport-ts/`, `client/downloader/decoder.js`, `tools/pack-study/`), all 11 `tag:path` citations `git cat-file -e` clean; `claude/av1` cites it only in the queue's record of the finding; `scripts/check_links.py` now fails on a backticked or `git show` archive tag `git ls-remote --tags origin` lacks (outside the two queues), SKIPPED offline, mutated twice to fail. The link step stays at 1 unresolved from row 108's lane (`lab/decode-bench/helper-start/README.md` names `docs/decode/levers-protocol.md`, which is on `claude/av1` only) |
| 117 | **DOCLABELS** — rows 84 and 85's documentation leftovers that need no decision | done `f4c12e8`, `cfc776c`, `364e026`, `6dbe66f`, `2ea840b` — **the three product docs and the lab's code comments name the measurement, the label kept as a pointer; eight lab READMEs; each doc's open items in its own §Open**: queue and campaign labels named in `docs/av1/` (10 files), `docs/decode/README.md` (61 → 47 matches, all pointers), `transport-conclusions.md` (~133 bare labels → 0; 18 headings' labels and dates moved to a pointer line), `rig-limits.md`, `disk-access.md`, the codec docs, `FIXTURES.md`, `ARCHITECTURE.md`; 98 lab code files (109 → 23 `row X` hits, the rest pointers, output strings or CLI help); `docs/av1/README.md`, `decode/README.md`, `transport-conclusions.md` §9, `ARCHITECTURE.md`, `CLIENTS.md`, `FIXTURES.md`, `client-window-depth.md` point at their own §Open instead of a queue; READMEs for `clock-resolution`, `decode-tail`, `disk-access-bench`, `early-messages`, `idle-sessions`, `telemetry-bench`, `window-harness`, `worker-leak`; BBR's 12–19× kept in `transport-conclusions.md` §1, `read_ahead_kb` in `disk-access.md` §6, the race's measurement in `ARCHITECTURE.md` and its behaviour in `CLIENTS.md`, each pointed at elsewhere; FoD's two decoders (`parse.ts`, `wire.ts`) are duplicated code, not comments — each now points at `WIRE.md` and the other, not merged (a refactor); no anchor with an inbound link changed; link check 0 unresolved from this row (1 left: row 108's `lab/decode-bench/helper-start/README.md` names `docs/decode/levers-protocol.md`, which reaches this branch with the merge); `scripts/gate.sh --no-browser` OK in 123 s, the contract and downloader browser steps pass, the viewer check fails here only for want of the docker decoder builds (pinned-build refusal, environmental); *left:* labels used as a lab folder's own name (~150, lab READMEs' `§Row …` headings), a few undefined short labels (S14, C4, R1, L19) |
| 118 | **GUARDS** — row 86's check leftovers that need no decision | done `ed1e3e8`, `0b1e52c` on `claude/av1-unified` — **two stale-build guards and the lab's Go and h3 clients compiled, each mutant caught; gate green in 345 s**: `cellcheck.sh` refuses a transport WASM build older than its sources (exit 2), one `require_transport_wasm` shared with the gate; `deploy/check_equivalence.sh` refuses a web image whose page or nginx files differ from the tree's, by content not time (an mtime guard was built first and failed: a cached rebuild keeps the image's creation time, so a touched file was refused after every rebuild), tested on a real `wt-pacs-web` build: equivalent on 10 paths fresh, refused (exit 2, each file named) on a changed module, template and decoder build, a file added, one removed and no image, passed on a touched file and changed `*.md`/`*.test.mjs`; new gate step `lab: the Go and h3 clients compile` (`go build` in `lab/other-clients/go` and `lab/page-open/h3-host`, `cargo check --locked` in `lab/other-clients/h3`): 2 s warm, about 75 s cold, a syntax error in each of the three caught, `SKIPPED` by name without `go`; cellcheck ALL OK on a fresh build. Gate steps: client unit tests 8 s, contract 19 s, downloader in Chromium 44 s, viewer page 78 s, server tests 77 + 30 + 22 s, the rest ≤ 22 s each. Note: the gate on `claude/av1-unified` fails its link check today on row 108's `lab/decode-bench/helper-start/README.md:5` → `docs/decode/levers-protocol.md`, which is on `claude/av1` only; green with that doc present. Finding: `deploy/README.md` §The checks, `README.md` §Prerequisites. |
| 119 | **CCTHEORY** — congestion control for lossy mobile links without the clean-link cost: what others do and what exists, ranked for the target, measurement rows proposed with their rules; theory only | done `b8bb340` on `claude/av1-unified` — **nothing changes in the product; the earlier BBR-against-Cubic clean cells also compare a 20× initial window**: from 24 sources pinned by sha256 and quinn-proto 0.11.18's source, BBR's clean cost is no loss (row 104's cell 4: 0 relay drops on every fixed-rate clean and ±20 ms cell for every controller, BBR ≤ +1 % datagrams) but three departures missed before — a 240 000-byte initial window (Cubic's 12 000; derived ×0.99/0.92/0.78 of the clean fills at 5/20/50 Mbit against 1.01–1.04/0.90–0.95/0.82–0.94 measured), ProbeRtt at the first unlimited ACK (≈ +1.6 % derived at 5 Mbit against +2–3 %), and an all-time maximum of per-ACK bandwidth with the all-time minimum RTT (the ±20 ms condition); the clean ask's +70 ms not derived; ranked: 1 a Cubic that skips the cut on loss classed random (no clean cost by construction, ~150 lines), 2 a switch after the first round trips (per-peer choice at accept needs a wtransport patch and sees only an address; the state a switch must carry tabled), 3 quinn's BBR without the departures, 4 BBRv3 (gives up loss above ~1–2 % by design), 5 delay-based, 6 FEC (no browser decodes it); classifier accuracy read only from a 2002 simulation; the downlink's loss mix is read best by the server's own RTT samples in a field pilot (the owner's). Proposed, not queued: R1 CCATTRIB (the confound and ProbeRtt, arms with swapped initial windows), R2 LOSSCLASS (classifier errors on the relay's known causes: ≤ 5 % / ≤ 30 % to go on), R3 LOSSIGNORE (default if clean ≤ 1.01, fixed-rate 1–2 % ≤ 0.75, neighbour within 5 points), R4 CCSWITCH (only if R3 misses), R5 FIELD — `docs/transport/transport-conclusions.md` §1 *The way out, surveyed*, §9 item 2 |
| 120 | **ORDERNEED** — whether readers need some frames first: reading behaviour per target series from primary sources, the expected gain of a reordered fill on row 65's numbers, a pre-registered verdict; theory only | done `ef1880b` on `claude/av1-unified` (the rule alone first, `82f6760`) — **dropped on every target type; no measurement row**: rule E = p·g − (1−p)·c ≥ 0.2 × T at the lower end of p; from IHE's DBT supplement, DICOM PS3.3 §C.23 and three eye-tracking studies (Drew 2013, Aizenman 2017, Wolfe 2022), no source supports a first view inside the series — DBT stacks are swept from an end and back (3.8 slices a fixation), the four-view mammogram is hung at once, cine plays from frame 1, ABUS is read in whole coronal passes; at 20 Mbit the centre-first fill would need p ≈ 0.4 (DBT) and ≈ 0.66 (an MLO-first hanging) against ≈ 0 supported; the order across series (2D before the DBT stacks) noted, not estimated; `docs/ARCHITECTURE.md` unchanged — `docs/av1/README.md` §The order frames are asked in |
| 121 | **DATAAUDIT** — every closed row's verdict against the provenance and sampling of the data it used; the critical ones, the sound data each needs and the rows to re-run; nothing queued | done `e9f1339` on `claude/av1-unified` — **76 of the 116 closed rows depend on nothing weak; three critical questions stay open**: every result cell of rows 1–118 read against `data.json`'s classes and `series.md`'s targets (rows 69, 114 not closed); exactness, build, docs and content-free transport verdicts stand; the early frame-group, depth and decode verdicts on off-target or lossy data are settled since on sound target data (rows 45, 77, 95–97, 100); **open:** (1) lossless cine — frame groups for breast US, ABUS and angiography (46, 28), grey 4:2:0 for Firefox (80, wholly on `usb_cine`/`usb_still`) and 8-bit WebCodecs (9, 11, `us_liver` alone): no open sound source (CADICA CC BY 4.0 but frames, one source; Breast-Lesions-USG PNG stills; TDSC-ABUS on request), the owner's options under row 94's line; (2) the codec choice's time cells (95: 3 exams, 37 % `VOID`; 105–107: 44 % `VOID`, strict n ≥ 10 on 5 of 60 cells, Firefox 10 Mbit cells before row 115's dial fix); (3) the transport default's clean cells (75: 37 % `VOID`, and a 20× initial window between arms, row 119). Proposed, not queued: row 106's protocol re-run on a host within its bar with whole volumes and Firefox after row 115; row 119's R1 then row 75's clean cells; on sound cine, row 99's P8–P10, row 80, row 46's cine half, rows 9 and 11's 8-bit cells. Row 98's list kept but 15, with 7, 13, 17, 27, 31, 33, 40, 44, 47, 64, 80, 106 and 107 added — `docs/FIXTURES.md` §Provenance, *Every closed verdict against its data* |
| 122 | **HASHWHY** — why the frame digest is XXH3-64 and not a cryptographic hash, backed by outside sources, with an abstract the owner can hand to a team; theory only | done `9ff8838` on `claude/av1-unified` — **XXH3-64 stands; the one rule added is that the digests are checks, never keys**: from 27 sources pinned by sha256 or commit, QUIC's per-packet AEAD (RFC 9001 §5) covers the wire and nothing before encryption or after decryption, where field faults are measured (Meta: hundreds of silently wrong CPUs; Google: a few mercurial cores per several thousand machines; consumer PCs without ECC); a damaged frame passes its own digest at 2⁻⁶⁴ with no birthday bound, so at a ceiling of 10¹⁴ frames a year worldwide (UNSCEAR: 4.2 × 10⁹ exams; 10⁴ frames each assumed) one miss in ~184 000 years even if every frame were damaged, against ~23 000 a year at 32 bits; XXH3-64's suite failures (SMHasher3 27 of 250) have full 64-bit collisions only with the seed varied and bias only on 3–38-byte keys, neither our use; Btrfs, ZFS, RocksDB (`kXXH3` default since 7.8.0), zstd and LZ4 use a fast checksum for damage and keep a cryptographic hash or a byte compare for dedup; CRC-32C, CRC-64, XXH3-128, BLAKE3, SHA-256 and rapidhash each lose on speed in WASM, bits or a build of our own; a hostile server needs signed digests and BLAKE3 (×1.15–1.51 a decode-bound fill), sketched only; [`../adr/exactness-in-production.md`](../adr/exactness-in-production.md) §7. Proposed, not queued: XXH3-128 and CRC-64 timed in hash-wasm, only if a digest is ever wanted as an identity |
| 123 | **MISMATCH** — the response to a digest mismatch, what row 73's ADR and row 88's build leave open: block or mark, a client cache, frame groups, reporting; theory only | done `a4c2227` on `claude/av1-unified` — **the ladder holds where a second path exists; four gaps, three choices for the owner**: from 13 sources pinned by sha256 or commit and the code as built, the viewer *marks* a `false` frame (pixels under a red banner) where §2.3 recommended *block*, and the three open viewers read (Cornerstone3D v5.11.7, OHIF v3.13.12, Orthanc 1.12.9) all block a failed decode (none checks samples, so a silent wrong decode is drawn there); the ACR's technical standard (2022) carries the FDA's rule that a lossy image is labelled on display and that lossy mammograms are not read, so the sources lean to block for diagnosis; without a cache re-fetching never helps, and a coded-bytes digest (hashed only after a mismatch: no client cost on the common path, 16 hex a frame) would name store against decoder, as Orthanc's MD5 and dcm4chee's `OBJECT_CHECKSUM` do on the server; a cache stores only `true` frames as coded bytes with their digest and the metadata version, keyed never by digest, and there re-fetching does help; G > 1 needs its group re-decoded (none ships, G = 1), and AV1 on WebKit or 12-bit has no second path (a fresh instance proposed, not measured); §5's series key, if a DICOM UID, is one PS3.15 Table E.1-1 replaces, so reports carry an opaque session key; [`../adr/exactness-in-production.md`](../adr/exactness-in-production.md) §8. Proposed, not queued: a fault-injection bench per path and engine, the server's coded-bytes check on read timed, the report endpoint |
| 124 | **QUICSURVEY** — the native version's transport: every QUIC implementation that could run in a desktop and a phone client, in any language, read against the target; every finding listed, every decision left to the owner; theory only | done `27ab544` on `claude/av1-unified` — **quinn alone runs on every target, speaks to the server unchanged and is already ours; no stack publishes receive CPU per byte, so that is the first measurement**: fifteen stacks read from pinned sources (tags, commits, sha256) — for the fill the server sends, so the client's controller does not matter (row 119's options stay in quinn's `Controller`, which `bbr-bound` implements) and the client's stack decides receive cost, windows, migration and resumption; Chromium v102 spent 8.5 s per GB in packet processing, 2.97 s of it ACKs (≈ 8.4 ms/MB against this repo's 9.8), its `recvmmsg`/GRO code now in `main` but off by default; Firefox on quinn-udp < 1 → 4 Gbit/s (≈ 2 ms/MB derived); Apple has no GSO/GRO and msquic and quic-go read one datagram per call there; public controller hooks: quinn, Google QUICHE, picoquic (richest), mvfst, xquic, s2n-quic (unstable); Network.framework raw QUIC with our ALPN but no CC knob and no WebTransport, Cronet/HttpEngine HTTP only and Android only; multipath released only in noq 1.3.0 (draft-21, 0x3e) and picoquic (draft-20); native WT clients that should reach our draft-02 server: wtransport, web-transport-quinn, neqo, picowt, QUICHE's (read, not tested); wtransport 0.7.2 can take a session from a quinn connection, so one port could serve a raw-QUIC ALPN beside it (read from the API); interop-runner goodput 9 096–9 390 kbps on its 10 Mbit/s link ranks nothing and no run had a quinn server; five decisions under §Blocked; proposed, none queued: N1 RECVCOST, N2 NATIVEWT, N3 APPLERECV, N4 REBINDNEW, each with predictions and a rule — [`native/quic.md`](../native/quic.md) |
| 125 | **DECODEOPT** — faster decoding with today's codecs, what rows 9–11 and 108–113 did not try: HTJ2K's decode time from the stored layout, SIMD and hardware in the browser and natively, decode matched to arrival; other codecs listed, not explored; theory only | done `6ae0ae0` on `claude/av1-unified` — **ten levers left, one structural: tiles stored as independent codestreams for large-frame asks; and OpenJPH has no ARM SIMD, so natively a phone runs its scalar decoder where the browser runs its WASM SIMD**: theory only, nothing built or timed; read from OpenJPH 0.31.0 and head (empty `OJPH_ARCH_ARM` dispatch in block decoder, wavelet and colour; PLT/TLM skipped on read; no threads), dav1d 1.5.4 (NEON/x86 assembly for msac and the 4×4 WHT, none for WASM), SIMDe 0.8.2 (WASM SIMD128 in C with NEON paths), WebAssembly's feature table (relaxed SIMD Chrome 114, Firefox 145, Safari flag; wider vectors phase 1); ranked: tiles ×0.45–0.60 of today's ask at 4× on large frames predicted (+0.2–1.5 % bytes), emscripten 6.0.11 ×0.94–0.97, the ARM SIMD port (native 1.3–2.0× the browser without it, predicted), copy and pack ×0.82–0.95, decoders started on first need, the reader pause (memory), wgpu running row 111's WGSL natively, hand-written relaxed SIMD ≤ 3 %, dav1d msac in WASM SIMD and phone AV1 hardware not proposed; JPEG-LS, TCT listed, Tomoz not found; the ~570 MB coded-queue figure has no source in any branch; proposed, none queued: P-TILE, P-EMSDK, P-ARM, P-COPY, P-START, each with predictions and a rule — [`decode/README.md`](../decode/README.md) §Not yet tried |
| 126 | **INGESTPLAN** — the product's ingest at the site: language (Rust against C++), the C parser's integration in stages, the exactness check, the Python reference, the link to the server; a design for the owner; theory only | done `fe56074` on `claude/av1-unified` — **a plan, Rust recommended; and for HTJ2K the encoder is about a third of ingest CPU, not 99 %**: theory only; the parser not read (named only in this brief; licence unknown); row 52's numbers give AV1 3.3 s encode against a 30–40 ms check (~99 %) but HTJ2K ~39 ms of CPU a 768² frame with a 4.2 ms check and a 7–14 ms `ojph_compress`, so a compiled HTJ2K ingest is predicted at 0.4–0.6 of today's CPU; Rust keeps one bundle definition (`common/series-bundle`) and one QUIC stack (quinn) with the server, C++ only inside OpenJPH behind a shim like `decode.cpp`; the parser in three stages (files, a pipe if their share is over 5 %, a library), its explicit-LE-only coverage refusing DICOM's default implicit LE by name; the three checks ported, the Python ingest the reference until bundles are byte-identical at `--jobs` 1/2/4; link: a file copy, an upload ALPN beside WebTransport (structural), or Thruflux (C++, MIT, beta, lsquic, P2P; ideas, not code); proposed, none queued: P-PROFILE, P-STAGE, P-PARITY; five decisions under §Blocked — [`FIXTURES.md`](../FIXTURES.md) §A compiled ingest at the site — the plan |
| 127 | **NATIVEPLAN** — the native version's plan beyond transport and decode: platforms (desktop first, phones the goal), paint and cache, app shape, costs, and the desktop-first measurement plan run in cloud containers; theory only | done `ba4821e` on `claude/av1-unified` — **one Rust core with a thin interface per platform; paint carries over as it is; the cache is the app's clearest gain and its new liability; speed is not yet a reason**: from pinned sources (wgpu 30.0.1, Vulkan-Docs 1.4.365, Apple, Android, freedesktop, FDA, EU, AAPM, the stores) — `R16Uint` needs no wgpu feature and no API filters integer textures, so the in-shader bilinear and the 1:1 proof port; 4096×3072 fits the default 8192 limit; GLES 3.0 has no compute for the WGSL decoder; ten grey bits to a panel unproven anywhere; cache places and eviction per OS (Android's cache dir is for small data, iOS class A closes it ~10 s after lock); only a Rust core with native UIs or a pure-Rust GUI keeps the wgpu painter on all five targets (Tauri's wgpu path has no Wayland, iOS or Android; Flutter has five texture paths; MAUI and React Native no Linux); UniFFI has no async cancellation; WebTransport is in every engine since Safari 26.4; FDA and MDR are platform-independent, the stores' medical rules (Apple 1.4.1, 5.1.1(ix), 5.1.3, 2.5.2; Play's declaration) apply to the app alone; five decisions under §Blocked; proposed, none queued: M1 PAINTPROOF, M2 NATIVEFILL (P2: fills tie at 20 and 50 Mbit), M3 CACHE, M4 PHONEFIRST, ordered containers → GPU desktop → phones after quic.md's N1, N2 and decode's P-ARM — [`native/README.md`](../native/README.md) |
| 128 | **H3FETCH** — plain HTTP/3 `fetch()` as the simplest alternative to WebTransport for the fill and the ask: mechanism, what the browser does differently, predictions and a protocol; theory only | done `be46620` on `claude/av1-unified` — **the same QUIC stack and receive bound, a different connection: fetch rides the page's pooled HTTP/3 connection, which WebTransport never does**: theory only, Chromium 141.0.7390.37's source read; both paths build their config with `InitializeQuicConfig` (15 MB connection, 6 MB stream receive windows), so the receive bound is shared; pooled HTTP/3 brings what WebTransport lacks — no dial on a warm origin (today's 3.03 round trips to a ready session), TLS resumption and 0-RTT GETs, and Chromium's connection migration — and loses the opening ask's push and the server's own ordering (Chromium's RFC 9218 urgency is advisory); caching (a privacy question on shared devices), CORS and an HTTP/2 fallback come with it; the server would need a GET path beside wtransport (structural); predicted ×0.97–1.05 on warm asks and fills, ×1.0–2.0 on an ask behind a fill, ×0.5–0.7 on a cold first frame with the origin up; a protocol and rule proposed, not queued; Firefox's and Safari's stacks not read — [`delivery-prior-art.md`](../transport/delivery-prior-art.md) §8 |
| 129 | **WTCOMPAT** — the browsers' WebTransport draft and `reset_stream_at` against the server: what each engine's stable, beta and nightly speak, what breaks when one moves, and a check that warns before a release does | done `3add8a9` on `claude/av1-unified` — **no browser update in view breaks the server: Chrome for Testing 155 (stable), 156 (beta), 157 (canary) and Firefox 157.0.1 and 160.0a1 (nightly) each negotiate draft-02 and get frame 0 exact, and Chromium's draft-07 path (`EnableWebTransportDraft07`, off by default in all three) negotiates draft-07 exact, 3/3 by net log**: read from each channel's quiche, `net/` and neqo at the shipped commits, then dialled through a recording relay and decrypted from the browser's key log; the server offers draft-02 and draft-07 and no `reset_stream_at` (quinn has none); Firefox offers `reset_stream_at` (`0x1d`) without requiring it, since neqo 0.31.0's requirement was backed out of Firefox (Bugzilla 2065405); neqo's unmerged draft-15 branch drops draft-02 and would fall back to the draft-07 the server already sends; Safari's draft is in closed Network.framework, unread and unmeasured. `scripts/wtcompat.py --fetch DIR` (about 3 min) fails on a failed dial or inexact frame, an undecryptable dial, or any change in either side's drafts, SETTINGS or `reset_stream_at`; four mutations each fail it. Draft-15 needs `reset_stream_at` in quinn-proto and the codepoint and `webtransport-h3` in wtransport, proposed. Gate green (numpy arms skipped by name). `docs/transport/transport-conclusions.md` §3 *Will a browser update break the server?* |
| 130 | **INITRTT** — a 100 ms initial RTT on the server: the first open's tail under loss against spurious resends on slow links; theory only | done `c55f832` on `claude/av1-unified` — **the assumption sets one clock: the server's PTO on its first flight, 999 → 300 ms, the only recovery when that flight is lost since quinn ignores the client's repeated Initial (RFC 9002 §6.2.3 not implemented)**: from 15 sources pinned by sha256 or commit; the lab reading is S10 of `lab/scripts/controller_cells.sh` (`edd006f`, 200 connects an arm, arms in sequence, the client at quinn's 333 ms, so the server alone moved); Chromium's WebTransport client and neqo already assume 100 ms (a 300 ms PTO), quinn, ngtcp2, msquic, Cloudflare quiche, s2n-quic and lsquic 333, picoquic 250; Chromium's RTT hint (`0x3127`) is not sent on WebTransport and quinn ignores it; past ~300 ms a spurious probe costs at most one flight (1.3–2.8 KB) and, derived, no congestion event; 10 % of Google's 2017 connections had a minimum RTT over 300 ms; S10's p95 gap is not explained; row IRTTMEASURE proposed with three cells, predictions and a rule (adopt 100 ms if a lost flight is 699 ± 50 ms sooner and slow clean links cost ≤ 10 ms and no congestion event) — [`../transport/transport-conclusions.md`](../transport/transport-conclusions.md) §3 *A 100 ms initial RTT* on `claude/av1-unified` |
| 131 | **TAILDUP** — a frame's last packets sent twice: where tail loss bites (the ask, a burst's end), how often on the target, its cost elsewhere; theory only | done `85ee9bde` on `claude/av1-unified` — **dropped for now: only a lost last packet waits a PTO, on p to 2p of asks (1–10 % at 1–5 % loss), worth one PTO (~85–145 ms, derived), 2–8 % of row LOSSLINK's Cubic ask p95 and inside its spread; a back-to-back copy dies with the original 71 % of the time on the relay's bursts, and a lost copy halves Cubic unless kept out of the loss signal (a quinn + quinn-proto patch); fails the owner's first criterion (the target's loss mix is unknown)**. Reopens when the field pilot shows ≥ 1 % random loss and the default controller is not loss's clock (under BBR a PTO is 25–75 % of a lossy ask); the protocol and rule, a PING neighbour (~40 B, saves 20–80 ms) and a detection gate are written; nothing queued — [`docs/transport/transport-conclusions.md`](../transport/transport-conclusions.md) §5 *A frame's tail sent twice* |
| 132 | **CCATTRIB** — row 119's R1 run by a session given only its protocol and rule: BBR's clean-link cost with the initial windows swapped between arms, ProbeRtt apart | done `7db19138` on `claude/av1-unified` (`5e2d46a6`) — **by R1's rule option 3 is dropped and the clean cells need no restatement: P1 fails on one cell, P2 on its second half, P3 holds, in both readings**: HTJ2K, 4 filled then 4 asked, 12 Williams-ordered rounds, 384 visits, 106 `VOID`, 3 072/3 072 frames exact; the fill ÷ `cubic-restart`'s with Cubic at BBR's 240 kB is 0.72–0.91 on clean 20 and 50 Mbit (≤ 0.95 holds); BBR at Cubic's 12 kB is 1.02–1.16 there but 0.937 on r50000 1× (< 0.97); quinn's BBR enters ProbeRtt at its first acknowledgements in 96/96 visits, but its window stays ≤ 0.8 × needed for ≥ 150 ms in only 61/96; on r50000 ±20 ms BBR's window is short for 0.68 of the fill; r5000's cost (+3.3 % at 1×) is about ProbeRtt's idle share (3.7 %), and Cubic at 240 kB beats BBR on every clean 20/50 Mbit cell — for the review row — `transport-conclusions.md` §1 R1, `lab/av1/delivery/total-time` §Row CCATTRIB |
| 133 | **TILEMEASURE** — row 125's P-TILE run by a session given only its protocol and rule: tiles stored as independent codestreams for large-frame asks, bytes and the ask, exact | done `82471151` on `claude/av1-unified` (`c2368705` the harness) — **P-TILE's rule passes: 2 640/2 640 asks exact, tiles +0.01–0.59 % bytes (bar +1.0 %), three tiles on three workers ×0.388–0.448 of the whole frame at 4× on the three large series in 10/10 rounds each, and under three stripes' ratio in every round (×0.63–0.68 of it)**; predictions: bytes lower than the +0.2–1.5 % predicted, k = 3 faster than ×0.45–0.60 (×0.300–0.476), k = 2 held on 5 of 6, one worker ×0.97–1.24 against ×1.00–1.03 (not held); container times, nothing past k = 3; the store-format proposal is the owner's (§Blocked) — [`docs/decode/README.md`](../decode/README.md) §Not yet tried |
| 134 | **EMSDKMEASURE** — row 125's P-EMSDK and P-COPY run by a session given only their protocols and rules | done `44f4836` on `claude/av1-unified` (`2481bb1`, `645b4f1`, `3fc7306`, `b156aad`, `1645756`, `c969f91`) — **neither adopted**: headless Chromium 141 in the container, 10 rounds Williams-ordered, every frame exact (8 040 a frame, 480 cold asks, 16 080 filled; P-COPY 17 280), both mutations caught; **P-EMSDK** (the delivered recipe under emscripten 6.0.11): a frame ×0.89–0.93 on the projections in 9–10 of 10 rounds but ×0.96–1.06 on the other five sets, a cold ask ×0.96–1.02 (no cell ≤ ×0.97 in 8 of 10), a fill ×0.995–1.003 (the wire is the clock), strict and round-paired agreeing; 6.0.2 dropped `wasmBinary` from the default module API, so under 6.0.11 the recipe's glue would fetch an unchecked `.wasm` — one flag restores it, same `.wasm`; **P-COPY** (frames packed into buffers the page keeps in a shared heap, a shuffle for 8-bit RGB): grey ×0.95–1.05 (prediction ×0.88–0.95 refuted), RGB `c512` ×0.87 at 4× in 8 of 10 and ×0.95 at 1×, `-pthread` alone ties, peak memory no higher (−5 to −25 MB on large frames) — [`../decode/README.md`](../decode/README.md) §Not yet tried, `lab/decode-bench/emsdk` and `lab/decode-bench/copy` on `claude/av1-unified` |
| 135 | **RECVCOST** — row 124's first measurement (receive CPU per byte per client stack, desktop, in a container) run by a session given only its protocol and rule | done `7881c0b` on `claude/av1-unified` (`96687db` the harness) — **P1 and P2 hold, P3 holds clean and fails under loss**: 7 rounds, five arms Williams-ordered, 210 fills, 168 000/168 000 frames exact by SHA-256; loopback client CPU per MB, wtransport and web-transport-quinn with GRO 2.05–2.16, without 3.07–3.14, Chromium 141 6.4 (32 KB frames) and 12.4 (250 KB) whole, 4.0–4.3 for its network service alone; at 20 and 50 Mbit/s clean every arm fills within 0.6 %; under 2 % loss Chromium takes 1.089 and 1.054 of the quinn arms' time, 7/7 rounds, at ≤ 0.05 cores, so not by CPU. The raw-QUIC arm not run (it needs a raw-QUIC server). Loopback saturates the server's one core (~0.9 at ~670 MB/s), so loopback fill times are not compared. Nothing changes in the product. `docs/native/quic.md` §6 N1 |
| 136 | **INGESTPROFILE** — row 126's P-PROFILE run by a session given only its protocol and rule: where today's ingest CPU goes, per codec | done `6b7b2c5e` on `claude/av1-unified` (`45e56106` the profiler, rounds `7e70bec0`…`95840262`) — **the rule fires: 57–85 % of HTJ2K's ingest CPU is not the encoder (bar 30 %), so CPU is a reason for the compiled ingest**: the encoder 15–43 % by set, hashing 16–41 % (the SHA-256 check and the digests, each after a NumPy conversion), temporary files 11–24 %, the check 10–12 %, and the CLI adds 0.3–0.6 s a run; AV1's encoder 93.6–98.8 %. Predictions: HTJ2K encoder 25–45 % held on 3 of 4 (the mammogram 15.2 %), AV1 ≥ 98 % on 2 of 4 (fluoroscopy `allintra:7` 93.6 %, mammogram 97.3 %); 5 rounds Williams-ordered, one container; "~99 %" corrected in place (FIXTURES, coded-frame README, row 52) — [`docs/FIXTURES.md`](../FIXTURES.md) §A compiled ingest at the site |
| 137 | **NETPROBE** — which data hosts the cloud environment reaches today, and what refuses the rest: rows 2 and 35's refusals are a week old | done `b892f99` on `claude/av1-unified` — **every refused host is reached now (12 of 12, CONNECT 200, 2026-10-11 02:33 UTC); no reachable source meets row 100's bar: CADICA (668 angiography runs, CC BY 4.0, PNG with its DICOM history unrecorded, so `unknown`) is the nearest and alone; ARCADE and the stenosis set are single frames, CoronaryDominance is resampled to float, TDSC-ABUS bars redistribution, the breast ultrasound sets are stills** — `docs/FIXTURES.md` §Provenance, The data hosts and the candidates |
| 138 | **CROSSRERUN** — row 106's protocol re-run as row 121 proposes: whole volumes, Firefox after row 115's dial fix, both readings where the host voids | done `c4de1f97` on `claude/av1-unified` (rounds `91b72ac0`…`3246b119`) — **row 107's verdict stands on the per-link rule and falls on `dbts_b4`: whole, it is AV1's on every phone link in both engines at both CPUs, so a per-series choice**: 12 rounds, 1 416 visits, 60 140/60 140 delivered frames exact, all 192 Firefox 10 Mbit/s visits dialled; 23 % `VOID` (15 % fixed, 34 % `lte-good`) so strict and round-paired both, and they agree on every group and both decisions; `dbts_b4` 0.755–0.778 on 10–20 Mbit/s and `lte-good`, AV1 faster in all 12 paired visits of each (row 106's Firefox 4× 1.24–1.29 was 11 slices), its price 1.71–1.97 × at 4× on 50–100 Mbit/s where this host's AV1 decode is the clock; the model holds on 15 of 24 groups and fails on all 8 of `dbts_a5`/`dbts_b2` — whole, they are AV1-faster on their HTJ2K-side cells, 0.947–0.985 on 30–100 Mbit/s and 4× `lte-good` (1.02–1.10 predicted; HTJ2K wire-bound, 94 Mbit/s at 100) — and on `syn2ds_b3` Chromium 1× `lte-good` (0.999, a tie, as before); `syn2ds_a3` now holds (1.027, 1.024); whether ingest serves `dbts_b4`-like series as AV1 is the owner's (§Where AV1 fills first, reviewed) — `docs/av1/README.md` §Where AV1 fills first, whole volumes |
| 139 | **IRTTMEASURE** — row 130's protocol run by a session given only its protocol and rule: the server's initial RTT at 100 ms against 333 | done `5415e903` on `claude/av1-unified` (`73bc5db0` the harness) — **the adoption rule does not pass**: 10 000 visits, 843 `VOID`, both readings agree; P1 held for Chromium (+698–701 ms on both certificates), `cold_open` on the dev certificate and Firefox but one cell, refuted for `cold_open` on the ECDSA chain (+739/+780/+850 at 40/80/150 ms, ≈ 699 + 1 RTT) and Firefox dev at 150 ms (+625 · +641); B held (medians ±0.1 ms; 0.8 % of `cold_open` opens waited for a server probe, 1 245–1 409 → 548–629 ms; none of Chromium's; `cold_open` p99 1 165 → 792–796); C held on 300–1 000 ms (±1 ms, 0 congestion events) and failed on LTE-loaded (events in both arms, 9 and 11 of 80 visits); default unchanged — `docs/transport/transport-conclusions.md` §3 *Measured: IRTTMEASURE* |
| 140 | **CCREVIEW** — row 132's numbers against row 119's predictions: conclusive or not, and what it leaves for the default | done `7bf17db` on `claude/av1-unified` — **R1 conclusive for its rule in both readings (28 % `VOID`, strict n 3–12, every deciding number agreeing): option 3 dropped, `cubic-restart` stays the default**: P1's miss is one clear cell (`bbr` 12 kB r50000 1× 0.937 \| 0.937, 11/12 pairs), P2 fails by count (61/96), and the swap left BBR +3.3 % at r5000 (≤ 1 % needed); the confound itself is real (Cubic at 240 kB 0.68–0.91 on every 20/50 Mbit cell, 12/12 pairs), which leaves the initial window the owner's open §3 call, untested on shallow or lossy queues; a ProbeRtt-only patch not refuted, no row needs it; R3's `bbr` arm carries a 20× window to be named — `transport-conclusions.md` §1 R1, *Reviewed* |
| 141 | **LOSSCLASS** — row 119's R2 run by a session given only its protocol and rule: how often a loss classifier is wrong on the relay's known causes | done `0fa17d90` on `claude/av1-unified` (harness `fc3d230f`) — **by the rule no q* passes, in both readings (252 visits, 8 `VOID`): options 1 and 2 close as written, and every miss is BBR's**: RFC 9406's q* misses on `bbr`'s shallow random cells (radio classed congestion 30–41 %, bar 30 %), 10 ms on `bbr`'s 20-packet overflow cell (congestion classed radio 25 %), 20 ms on both controllers' (100 %); under `cubic-restart` RFC 9406's q* meets both bars (0 % on `of-q20`, n 36; 1–2 % on the six shallow random cells, n 116–364). Prediction 2 held (0–2 %), 1 held at RFC 9406's q* only, 3 failed under Cubic (0–14 %, its window stays under any queue at 2.9 Mbit) and held under BBR (58–93 %); the 500-packet overflow cell never dropped (the fill's 512 KB in flight cannot fill it), so option 1's worst case is untested; drop logs matched the relay's tally in 252/252, lag p99 0.25 ms — `lab/loss-class/README.md`, [`transport-conclusions.md`](../transport/transport-conclusions.md) §1 R2 (on `claude/av1-unified`), [`## Blocked`](#blocked) |
| 142 | **STARTMEASURE** — row 125's P-START run by a session given only its protocol and rule: decoders started on first need | done `8259b23` on `claude/av1-unified` (harness `ff836e9`, `25dcb6f`; rounds `6d0218d`, `ac66796`, `f399291`) — **the container stage fails its rule in both readings, narrowly: CPU passes everywhere, two fill cells and one cold ask miss**: `startOnNeed` (lab flag, off by default) against today on row DECODEPACE's cells plus a cold ask, 18 Williams-ordered rounds, 864 visits, 120 `VOID` (fills 9 %, asks 19 %), 7 560/7 560 frames exact; fills ×0.994–1.004 median a cell, decoder CPU ×0.86–0.96, wake-ups ×0.18–0.44 (all three predictions held); full-field 4× at 20 and 50 Mbit ≤ ×1.01 in only 11/15 and 12/17 strict rounds (13/18, 12/18 paired; spread ×0.92–1.06, no A/A arm to say whose); cold ask unchanged on 11 of 12 cells, tomosynthesis `lte-good` 4× ×1.026 \| ×1.028 — `docs/decode/README.md` §Not yet tried, P-START |
| 143 | **TILEDESIGN** — the owner's rule for large frames written into the design, and the tiled store and decode it implies: a proposal; theory only | done `165047b5` on `claude/av1-unified` — **a proposal, theory only: tiles as independent codestreams cut into level bands, laid out band-major, asked on today's wire**: the rule reaches only For Processing images in the breast family (raw FFDM 13–14 bits, raw projections 14; row 121's open question) and CR/DX over 12 bits outside it; on a phone device pixels need L1 where CSS pixels need L2–L3 (4–13× the bytes), on a 5 MP display both L0; same OpenJPH build on k idle workers (row 133 ×0.39–0.45 at 4×), a digest per tile and level; five decisions under §Blocked, three rows proposed, none queued — [`docs/adr/resolution-fitting-for-large-frames.md`](../adr/resolution-fitting-for-large-frames.md) §8 |
| 144 | **FFPORTGC** — Firefox loses decoded frames when the downloader drops its copy of each decoder's transferred `MessagePort`: fixed by holding it, a test that fails without, and a Firefox fill large enough to hit it | done `2cc8e53` on `claude/av1-unified` — **fixed: each decoder's `port1` is held on its record; Firefox 157.0.1 lost a frame silently in 2 of 17 fills before (`followQueue`, frames 24 and 28 of 240 and 1 200), 0 of 14 after**; with the whole pool spawned at start 0 of 11 before and 0 of 8 after, its ports collected before any frame is in flight; every delivered frame exact; the Node test finds 0 of 3 ports alive after a collection without the line, 3 of 3 with it. **Silent losses still open, not fixed:** (1) a `messageerror` — the page's pixel port has no `onmessageerror`, the event carries no index, and the downloader has already deleted the record on `done`: lost silently; (2) a decoder worker crash — no `onerror` on decoder workers, its frames stay `decoding` and its slots taken for good; (3) a decode that never returns — no decode or fill deadline, the stall watch reads the wire alone: the frame waits for ever. `docs/ARCHITECTURE.md` §The downloader |
| 145 | **FAULTBENCH** — row 123's fault-injection bench: a wrong sample injected per decoder path and engine, the check and the second decode observed; measures today's code, changes nothing | done `4437f93` on `claude/av1-unified` — **the ladder holds where a second path exists and nowhere else, and a hung decode is invisible**: 30 visits, Chromium 141 and Firefox 157.0.1 × HTJ2K, dav1d-WASM, WebCodecs × five faults on frame 2, the product's `decoder.js` unchanged; control 6/6 exact everywhere. A transient wrong sample: HTJ2K rescued by a fresh object, WebCodecs by dav1d-WASM, dav1d-WASM not at all (no second AV1 path, so every AV1 frame in Firefox): shown marked *NOT EXACT*; a persistent one marked on every path; half the coded bytes: OpenJPH decodes it without error and the digest marks it, the AV1 payload is refused by name; a decode that never returns: no failure, and the frame queued behind it on that decoder never arrives either. WebKit not run. `docs/adr/exactness-in-production.md` §8 *The fault bench* |
| 146 | **LOSSIGNORE** — row 119's R3 run by a session given only its protocol and rule, if R2's result (row 141) lets it go on | done — **closed unrun, as its brief says: row 141's R2 met no q* bar** (nothing measured; whether option 1 is reopened is under [`## Blocked`](#blocked)) |
| 147 | **FRAMELOSS** — no frame lost silently: a decoder crash, a delivery the page cannot read and a decode that never returns each end in a re-decode or a loud failure, a test per path that fails without | done `2ab670c` on `claude/av1-unified` (`dc1524d`, `a1ad5fd`) — **no frame is lost silently now: a crashed, hung or unreadable decoder is replaced and its unacknowledged frames asked again; lost twice, a frame fails by name**. Records are forgotten on the page's ack, not on `done`; `decodeMs` 10 s (~28× the slowest decode measured, 355 ms). Tests per path in Node and three dispatch-rig clauses through real workers, 3/3 in Chromium 141 and Firefox 157.0.1; every mutant caught. Row 145's bench re-run, 30 visits: every *hang* cell now fails by name after two deadlines and frame 5 behind it arrives exact (both were silent); the other 24 cells as before. Cost: a tie — last frame of 240 at 2 671 against 2 605 ms in Chromium (paired 0.985 [0.898–1.159]) and 3 555 against 3 488 ms in Firefox (1.022 [0.958–1.080]), 10 rounds interleaved, 9 600/9 600 frames exact; decode-bound on 4 cores. `docs/ARCHITECTURE.md` §The downloader |
| 148 | **FRAMEPATH** — where a decoded frame should go now that the client has a paint worker and will get an OPFS cache: the page in or out of the pixel path, who owns the frame store, what OPFS costs; theory only | done `050d4c64` on `claude/av1-unified` — theory only, nothing timed: **recommended B′**, decoder → paint worker (which owns the memory store and every viewport) → a store worker writing checked, decoded frames to OPFS (sync handles are dedicated-worker-only, exclusive per file, take shared memory); the page's measured 0.07–1.15 ms a frame is not the reason — a busy page is (predicted: < 1 ms on a quiet page, up to a long task's length per waited frame and cine kept under one); decoded samples kept (CT series 40 MB, mammogram 17 MB a frame; reopen = read + one XXH3, no decode), re-checked on every read; WebKit's OPFS deletion is 30 operating days in its source's default, not 7 (qualified in place); protocol and rule proposed, not queued ([`../adr/frame-path.md`](../adr/frame-path.md)); five decisions under [`## Blocked`](#blocked) |
| 149 | **NATIVECINE** — a wider search for native, losslessly stored breast ultrasound cine, ABUS volumes and contrast angiography runs than row 137's hosts; search only, metadata alone fetched | done `36f15dd` on `claude/av1-unified` — **still nothing meets row 100's bar for any of the three types; one open set of native angiography runs exists, without a licence**: `MesserMMP/coronary-angiography-syntax` (Hugging Face, 87 626 XA files, 980 GB, Philips and Siemens, 14/14 headers read multi-frame, uncompressed, Lossy `00`) states no licence; IDC v25 and TCIA add nothing (39/39 XA single frames, multi-frame US cine flagged lossy 26–100:1); no breast ultrasound cine in DICOM and no ABUS volume in DICOM at any of ~25 hosts; nearest ABUS analogue IDC's prostate 3D TRUS (1 762 volumes, 280 frames, native, CC BY 4.0); DSCA's DSA runs are cut, MIDRC's fluoroscopy is not angiography and non-commercial — `docs/FIXTURES.md` §Provenance, The wider search |
| 150 | **MAINBASE** — `claude/av1-unified` rebuilt on current `main` (PR #34's server refactor kept), every replayed commit re-authored to the developer, every hash reference following; no other row is fired until it is done, and all new work starts from its result | done — published as `claude/av1-unified-mainbase` `7cd9e97e` and `claude/av1-mainbase` (the replay's tip `77bafbe5`, this record on top); all work continues on these two, the old branches unused (the owner, 2026-10-12) — **992 commits re-authored** (the first run's 1 557 is not reproduced, [`mainbase/`](mainbase/README.md)), 423 replayed onto `c7230a9`, 92 108 hash tokens carried, `rehash_check.py` silent on both tips and catching an old hash planted in a tree and in a message; (a) 16 paths outside PR #34 differ, each by hash replacements alone; gate green in 359 s (page check 3/3 exact in Chromium, Firefox skipped by name); a fast-forward of `main`, +77 621 −5 411 over 1 335 files; report `docs/av1/MAINBASE.md` on the unified branch; map `rehash-map.tsv` and `rehash_check.py` here |
| 151 | **CHECKCOST** — what the exactness checks cost a frame in today's client: the XXH3-64 check after decode by path, the second decode on a mismatch, and a cache read's re-check; cost only, the checks stay on | done `da32bd6c` on `claude/av1-unified-mainbase` — **XXH3 costs ~3.3 GB/s in both engines: 0.15 ms a 512² frame, 2.8 ms at 1914×2572, 8 ms at 3328×4096, so 4–12 % of an HTJ2K decode and 0.5–2 % of an AV1 one; a cache re-check (a copy) 0.75–0.8 of that; a failed check costs its second path** — HTJ2K's fresh object ×2.1–2.3, WebCodecs→dav1d-WASM ×2.8–3.0 (774 ms on the mammogram), dav1d→WebCodecs ×1.5, and ≈ 0 where no second path exists (a 12-bit top; all of Firefox), the frame then marked false; Chromium 141 and Firefox 157.0.1, 6 rounds interleaved, 1 344/1 344 frames exact, mutation failed every cell; 1×, a container's times — [`../adr/exactness-in-production.md`](../adr/exactness-in-production.md) §9 on `claude/av1-unified-mainbase` |
| 152 | **QUICTUNED** — row 124's candidates at their best configuration for the target, not their defaults: what each lets be tuned or patched, each lever's mechanism and its effect on throughput and on latency, every published result on one table, the server's stack read as a candidate too; theory only || done `6626fbed`: at their best no candidate is flow-control-bound at 5–50 Mbit/s (quinn's fixed 1.25 MB covers 50 Mbit/s to 200 ms; msquic's 64 KiB doubles to 16 MiB, so 5.24 Mbit/s at 100 ms holds only for a fresh stream's first quarter-window); no published study compares tuned stacks at the target's rates with loss (one at 40 Mbit/s 40 ms, no quinn or msquic); the owner's paper confirmed as CPU efficiency at 4–5 Gbit/s with settings unstated; a server-stack change buys ~1.3× sessions per core on the one comparable reading against the WebTransport layer, 927 lines of controller work and the gate — [`../native/quic.md`](../native/quic.md) §7 on `claude/av1-unified` |
| 153 | **INGESTDESIGN** — the best design of the pipeline from the owner's C parser to the PACS, compared against alternatives on every axis: where frames are encoded, how the parser hands over, what travels, where the layout, the per-study SQLite and the catalog are built, the integrity chain, metadata compression, recovery, prior art; theory only | done `0de61363` on `claude/av1-unified` — **the proposal holds on most axes; the gap is when a series is complete** (DICOM marks no last instance): theory only, ~60 sources pinned; (a) code at the site — raw + zstd costs 1.0–1.8× HTJ2K's bytes on the link (≈ 1.4×, seven images, one source; JPEG 2000 1.17–1.72× gzip over Clunie's 3 679), the parser's HTJ2K is grok, AGPL v3, not OpenJPH's bytes; (b) keep the directory: a checkpoint and a process boundary for C on untrusted files, an instance-complete marker owed; (c) one archive a series (`.sbnd` + its groups); (d) study database first, catalog derived by a generation upsert, PostgreSQL recommended (ATTACH caps cross-database SQL at 125); (e) a 10 KB group hashes in ≈ 1.5 µs, so compressed-byte hashes save ~1 µs — the parser's BLAKE3 after decompression proves parser → PACS, once 3 of its 4 group hashes cover the bytes written; SHA-256 without SHA-NI (53–91 ms a 27 MB frame) costs more than OpenJPH's encode (29 ms), XXH3 0.5–0.9 ms; (f) one zstd stream a series, a dictionary only per group (×1.5–4.7 on 300 B–6 KB); (g) idempotent by UID + digest, resumable by offset, published by rename + fsync; no prior art codes and checks at the edge (AWS checks in the cloud with CRC32); nine decisions under §Blocked — [`docs/ingest/design.md`](../ingest/design.md) on `claude/av1-unified` |
| 154 | **LINKTCP** — the hospital→PACS link is TCP (decided): the reasons written with pinned sources, what QUIC would gain or cost there in numbers from research, the resumable-upload options over HTTPS, and what would have to be true for QUIC to win; theory only | done `ee9522df` on `claude/av1-unified` — **TCP's reasons hold on every axis read; QUIC's wins belong to other links**: QUIC in user space costs ~2–3× TCP's CPU per byte (3.5× → ~2× at Google; ~3× against TSO on 10G; 2.5× on a receiver, 744 K datagrams against 58 K a GB), noise at a few GB a day (100 GB ≈ 130–400 core-s) but on the server's receive side; 4.4 % of clients could not use QUIC in 2016, "commonly … corporate networks", and Palo Alto, Zscaler, Cisco, SonicWall and Defender advise blocking it — no hospital rate published, so a QUIC link needs the TCP path anyway (RFC 9308 §2); Linux's 4 MiB `tcp_wmem[2]` caps an upload at ~671/224 Mbit/s at 50/150 ms, the receiver's 6 MiB before 6.16 at ~503/168 — fine to 100 Mbit/s, a few sysctls for 1 Gbit/s; 0-RTT unusable for uploads (RFC 8470), migration worth nothing wired, one RTT a kept connection; no published comparison measured an upload, and those nearest the link (Kempf 40 Mbit/s 40 ms, Shreedhar > 20 MB, Yu–Benson ≥ 1 MB) show TCP equal or ahead; S3 multipart, tus, the IETF draft -13 (no integrity) and rsync compared; QUIC returns only if UDP/443 is open at the sites and quinn's receive cost does not cap the server, plus loss, multiplexing or short connections; five decisions listed — [`ingest/link.md`](../ingest/link.md) on `claude/av1-unified` |
| 155 | **INGESTRS1** — the Rust ingest, phase 1: a Python mirror of the owner's C parser's directory output for frames, and a Rust ingest that reads it, hashes, codes with the pinned OpenJPH, checks, digests and writes the `.sbnd` byte-identical to the Python ingest's | done `800651d3` on `claude/av1-unified-mainbase` (`a7502b67`, `883c9934`, `7ac80584`) — **the Rust ingest writes `.sbnd` files byte-identical to the Python ingest's on all 88 lab sets at `--jobs` 1, 2 and 4**: `ingest/from-parser` reads the parser's directory output (`mirror.py` the stand-in: one multi-frame instance a set, UIDs made from the name, date `PbPb`), XXH3-64 of the samples as read, HTJ2K in-process through OpenJPH 0.31.0 with `ojph_compress`'s calls (`encode.cpp`), decode-back through `decode.cpp`, `common/series-bundle`; 528 bundles, 2 447 frames, 8–16 bits, 8 colour, 3 signed, 2.42 GB a side, none refused by either (no lab set is refused by HTJ2K; refusal checked by injected faults); the metadata compared is `from_dicom.py`'s frame-attribute keys, the rest phase 2's; 11 mutants, each caught (a perturbed encoder sample refused by the Rust check; digest width, signed SIZ, metadata, frame order in bundle and mirror, both new `ingest.py` checks, two group-file reader cases); the check removed alone is no fault, removed with the perturbed encoder the comparison catches it; `ingest.py` and `from_dicom` check by XXH3-64 now — SHA-256 left: `exact()` (the lab's check against the fetch's checksums, no longer called by the ingest), the copied `NNN.sha256`, the summary line's 12-hex fingerprint, `make_golden.py`'s `.sha256` (the client tests' truth), the fetch's pins; gate green with a step keeping the two equal (`same_test.py`, six synthetic layouts); *not done:* AV1, several instances a series, the from-DICOM cases (phase 2) — `docs/ingest/contract.md` on that branch, `FIXTURES.md` §A compiled ingest |
| 156 | **QUICCOMPARE** — the QUIC implementations compared one by one, for learning: what each is, its design, how it handles every lever, its throughput ceiling as a function of bandwidth and RTT at defaults and at its best, and what it would mean as our client and as our server; theory and writing, from rows 124 and 152's sources | done `b9b23abc`, `dcb8c5be` on `claude/av1-unified-mainbase` — **every stack obeys one ceiling, min(link, window ÷ RTT, the sender's controller under loss, CPU); at defaults three bind at ordinary rates, at their best only neqo's constant 10 MiB binds in the grid, and under loss the controller binds first**: theory and writing, eleven stacks deep and four brief, every claim labelled source, derived or measured; window ÷ RTT at 80 ms: Google QUICHE's bare 16 KB 1.6 Mbit/s, mvfst's 65 KiB 6.55, msquic's 64 KiB start 6.55 then 1 678, quinn's 1.25 MB 125 (33 at 300 ms), neqo 280 at 300 ms at its best; CUBIC's own response function (RFC 9438 §5) gives 1.74 Mbit/s at 1 % loss and 80 ms for every stack; CPU binds nowhere in the grid on server CPUs (quinn 11.8–12.4, msquic 14.8–16.4 Gbit/s one connection), phones unknown; on raw QUIC every stack but Cronet can be our client once the server takes our ALPN, so quinn's lead narrows to the shared crate, the measured 2.1 ms/MB receive and ACK_FREQUENCY (also msquic, picoquic); as a server only quinn has a released WebTransport server and a public controller hook (Google QUICHE and picoquic unreleased); `quic_grid.py` checked against RFC 9438's tables (5 mutations caught); gate `--quick --no-browser` green, the page check not run here (decoder build refused by Docker Hub, 429) — [`../native/quic-compared.md`](../native/quic-compared.md) on `claude/av1-unified-mainbase` |
| 157 | **QUICREWRITE** — row 156's comparison rewritten with each stack at its best configuration as the reading, defaults only as what must be changed, every number traceable to its exact source or derivation; theory and writing | done `26c5c1dd` on `claude/av1-unified-mainbase` — **at their best the window stops separating the stacks: every client window is a setting reaching the grid's 37.5 MB BDP except neqo's 10 MiB constant (binds above 280 Mbit/s at 300 ms) and Google QUICHE's 16 MiB limit (447), each one constant to patch; under loss the server's controller binds first (CUBIC 1.74 Mbit/s at 1 % and 80 ms, RFC 9438 §5.1) and four stacks take our own controller without a fork (quinn, picoquic, Google QUICHE, mvfst); what still separates them is ACK_FREQUENCY (quinn, msquic, picoquic at the current codepoint), Cubic pacing (all but Cloudflare quiche), probed migration, 0-RTT, multipath and the server's WebTransport**: theory and writing, every number at its point of use with file:line at the re-fetched pins (hashes matched) or RFC/paper section, table or figure; re-reading corrected row 156 — the window that matters is the client's for the server's uni streams (lsquic client 32 KiB, picoquic 65 535 B), Google QUICHE's client never auto-tunes, msquic sends ACK_FREQUENCY, Google QUICHE never does, mvfst's codepoint matches no other, quiche's caps are settings, quic-go defaults to Reno; `quic_grid.py` 6/6 mutations caught; gate `--quick --no-browser` green — [`../native/quic-compared.md`](../native/quic-compared.md) on `claude/av1-unified-mainbase` |
| 158 | **QUICLATENCY** — what each QUIC stack, at its best, does to latency: time to the first frame, an ask on a clean and a lossy link, head-of-line blocking, receive CPU per frame, migration; theory, formulas over RTT and loss | done `956a310b` on `claude/av1-unified-mainbase` — **the server's stack sets nearly every latency term; the client's sets four**: theory only, each term a formula over RTT, loss and rate with its RFC section and each stack's file:line; a 0.5 MB frame on a fresh connection takes 2.1 s at 300 ms above 50 Mbit/s (slow start from quinn's 12 000 B initial window, not the link); 0-RTT saves its RTT only with an address token (RFC 9000 §8.1; quinn's server sends none by default); a lost first flight waits 3 × the client's initial RTT, 150 ms (mvfst) to 999 ms (six stacks at 333 ms); a lost last packet waits PTO = RTT + 1 ms + the client's max_ack_delay, 24 ms less where the client obeys ACK_FREQUENCY (quinn, msquic, picoquic), p × 24 ms on average; expected loss delay of an ask 87–88 ms at 1 %, 80 ms and ≥ 50 Mbit/s, and behind a CUBIC sender the ask takes 2.6 s there; a client window far above the BDP lengthens an ask during a fill (quinn's 10 MB send window: 1.68 s at 50 Mbit/s); out-of-order reads only in quinn and picoquic, of no use on the shared stream; migration costs about one new RTT plus slow start either way, one RTT less than a plain re-dial and about none less than a 0-RTT re-dial with a token; receive CPU (row 135) adds ≈ 3 µs per frame; `quic_latency.py` 8/8 mutations caught; gate `--quick --no-browser` green — [`../native/quic-compared.md`](../native/quic-compared.md) §8 on `claude/av1-unified-mainbase` |
| 159 | **CONTAINERS** — the standard containers characterized against the `.sbnd`: what each is, how it indexes frames, its codec mappings, what maximizes throughput or minimizes latency in it, its tooling, playback and browser support; theory, with row 160's protocol and decision rule | done `d3da182a` on `claude/av1-unified-mainbase` — **the read path does not care which container; the open and the payload do, and no standard container carries our AV1 payload as a standard track**: theory only, nothing timed, ~40 sources pinned (FFmpeg n7.1 `b08d796` by file:line, RFC 9559/8794, AV1-ISOBMFF v1.3.0, DICOM 2026d, SMPTE ST 377-1/422/379-1/390); every candidate stores an intra frame as one contiguous range, so after an open that builds the same (offset, length) table each is one lookup and one `pread`: read latency, fill throughput and CPU per GB predicted to tie; bytes a frame (framing + index, D, `containers_overhead.py`, 15/15 mutations caught): `.sbnd` 12 (draft 28), MP4 one sample a chunk 12 (FFmpeg's chunks 4–12), DICOM Extended Offset Table 24, MXF minimal 31, Matroska by FFmpeg 44–48, fragmented MP4 one frame a fragment 183, FFmpeg's MXF OP1a 847–1 039 — all ≤ 0.3 % of a 16 KiB frame but FFmpeg's MXF (6.3 %); the open separates them: `.sbnd` 2 reads ≈ progressive MP4 < DICOM EOT (+ its per-frame metadata) < Matroska, MXF, fMP4 at one frame a fragment (no length in the index: N header reads) < IVF/raw AV1 (no index, N chained reads); AV1 stops at 12 bits and the 10–14-bit payload is two streams plus a header no mapping, player or decoder knows; HTJ2K is standard only in DICOM (.201, one fragment a frame) and MXF (ST 422:2022), a CELLAR draft in Matroska, unverified in MP4 (15444-16:2025); per-frame hashes and the band-major layout have no standard field anywhere, UIDs only in DICOM; prediction: the `.sbnd` stays, DICOM with an EOT is the candidate export (HTJ2K); row 160's arms, metrics and decision rule *proposed* — [`../disk-layout/containers.md`](../disk-layout/containers.md) §9 on `claude/av1-unified-mainbase` |
| 160 | **CONTAINERBENCH** — row 159's containers measured against the `.sbnd` on the same frames and the same read path: open, bytes, per-frame read latency, fill throughput, server CPU per GB, ingest packing time | done `4d5b6b54`, `d2d5929b` on `claude/av1-unified-mainbase` — **the `.sbnd` stays (proposed): every container ties it on per-frame reads, fill and CPU per GB, and they part only on the open; none passes the round trip**: measured blind to §1–§8 (the session saw row 159's queue cell through a `grep` before any number, and says so); 13 arms (`.sbnd` v1, its A/A copy, v2; MP4 ours and FFmpeg 6.1.1 faststart; fMP4 F = 1, 30; Matroska ours and FFmpeg; DICOM EOT with and without per-frame groups via pydicom 3.0.1; MXF ours at KAG 1 and FFmpeg; IVF), each opened into the server's table (`FrameStore::with_index`) and read by the shipped readers; 5 sound series at median 32 kB–2.8 MB (none near 16 KiB), 26 interleaved rounds, 3 120 cells, 25.3 M frames XXH3-checked against the encoder's codestream and every arm's 12 000 frames decoded against the input digests: 0 inexact; (a) ratios to `sbnd1` 0.88–1.16 against an A/A resolution of 14–30 %: all ties; (b) cold open on `pt15_cptac` (335 frames) ~160–310 µs for `.sbnd` v1/v2, MP4, DICOM, 0.68 ms fMP4 F = 30, 13–26 ms fMP4 F = 1, Matroska, MXF, IVF — those fail; (c) FFmpeg's MXF +2.6 %, DICOM with per-frame groups +1.2 % fail; (d) fails everywhere: FFmpeg cannot pack the AV1 payload (its input must name a codec), pydicom's `encapsulate_extended` pads Extended Offset Table lengths to even against PS3.3 C.7.6.3.1.8 (241/500 HTJ2K frames back one byte long), hashes have no standard field, UIDs only in DICOM; nearest: DICOM EOT without per-frame groups, then progressive MP4 (pass (a)–(c)); side finding: `pack-series`' 8 KiB `BufWriter` makes the `.sbnd` it writes read 24–31 % slower on warm hits and fill 24–32 % slower than the same bytes written in 1 MiB writes (32–41 kB frames, 16 rounds, 81–100 % signs), mechanism not measured (under [`## Blocked`](#blocked)); one session on 4 vCPU, never saturated, nothing claimed for concurrency or a device-bound miss; mutations: `--mutate shift|short` 238/238 on 13 arm kinds, 17 source mutants, a flipped byte; gate `--quick --no-browser` green — [`../disk-layout/containers.md`](../disk-layout/containers.md) §Measured on `claude/av1-unified-mainbase` |
| 161 | **HWDECODE** — every hardware decode path, browser and native: codecs and bit depths in hardware, lossless, whether the exact samples come back, and which radiology functions survive; theory | done `b13560cd` on `claude/av1-unified-mainbase` — **no hardware path changes a verdict today; no browser path can serve the viewer as the product codes AV1**: theory from pinned sources (Chromium 141.0.7390.37, FFmpeg n8.0, libva, Intel media-driver, Mesa, NVDEC 13.0, DirectX- and Vulkan-Headers, AV1 and H.265 specs, WebCodecs WD); Chromium's shared hardware AV1 front end refuses 4:0:0 and 4:2:2 (`av1_decoder.cc:304–307`), VA-API and VideoToolbox advertise Main only, and WebCodecs reads back no hardware 10-bit frame (`P010` has no `VideoPixelFormat`, `video_frame.cc:205–233`), Android frames only as RGB; native APIs return the decoder's planes exactly by construction but take AV1 Main 4:2:0 8/10-bit everywhere, 4:0:0 shown only on NVDEC, 4:4:4 and 12-bit only via D3D12/Vulkan per driver; lossless is in every profile, its hardware correctness unpublished; coverage 9.76 % of smartphone use (ScientiaMobile 2024 Q2), 69.6 % / 17.2 % / 13.2 % of Steam desktop GPUs yes / no / unknown (September 2026, derived); GREY420's 4:2:0 grey is the one layout every hardware decoder takes — worth revisiting for a native viewer; a three-machine native device run proposed — [`decode/hardware.md`](../decode/hardware.md), [`decode/README.md`](../decode/README.md) §Hardware decode |
| 162 | **LINKREAL** — real link conditions from published measurements: mobile 4G/5G, hospital Wi-Fi, home broadband, hospital uplinks — rates, RTT, loss and their spread; research | done `d00e53fa` on `claude/av1-unified-mainbase`: **the 5–50 Mbit/s band is the slow tail, replaced** — a phone reaches a near server at 103 Mbit/s median on cellular (p10 18, p90 309; Ookla open tiles 2026 Q3) and 218 on Wi-Fi, one stream to an off-net server 27–85 by country (M-Lab NDT 2024); idle RTT 16–55 ms (p10–p90) but 0.7–0.8 s median under load on cellular, 0.2–0.3 s on Wi-Fi; loss mostly ≤ 0.1 % (5G p99 1.2 %), handovers 24–50 ms; eight verdicts that rest on the band listed, not re-run; a hospital's uplink and Wi-Fi have no measurement found — [`../transport/link-conditions.md`](../transport/link-conditions.md), The target corrected in place |
| 163 | **STREAMPACK** — sending a series while it is still being parsed and coded: the formats and protocols that allow it, what overlap saves, and what it costs in safety and checks; theory | done `561d341d`, `2c488b53` on `claude/av1-unified-mainbase` — **overlap saves at most min(coding, sending), ≤ half of code-then-send; for HTJ2K it pays only under a quiet-period completeness rule**: 300 frames on 4 cores at 10 Mbit/s–1 Gbit/s (assumed band, ojph 174–335 Mbit/s of coded output a core, row ENC), streaming HTJ2K saves 0.3–0.9 s if the association's end is the signal, AV1 (4.9–12.3 Mbit/s a core) 0.3–25.9 s; under a 30 s quiet period it hides the send in the wait, 3.9–30 s; proposed: code on arrival first (no format, wire or store change, saves min(Q, coding)), frames as records with a final "series complete" only under a quiet period, no index at the end (a format change that leaves arrival order); costs: late-failing series' frames discarded at the PACS, partials held until expiry, crash resume relies on re-coding the same bytes (HTJ2K shown, AV1 not); AV1's series-wide offset must become fixed to stream — arithmetic, nothing timed — [`../ingest/design.md`](../ingest/design.md) §11 on `claude/av1-unified-mainbase` |
| 164 | **DISKLAYOUTDOCS** — `docs/disk-layout/`: the current `.sbnd` layout exactly, and the draft target agreed 2026-10-12; writing | done `2b59df27`, `a8f23aa7` — **written: today's `.sbnd` exactly, from the code with line references, and the draft target**: 16 B header, 12 B fixed-stride index, metadata embedded and in a sidecar (the server reads neither — `FrameStore::open` keeps the index only; the page reads the sidecar; `ingest/from-parser` writes no sidecar), frames back to back in display order and unaligned, the writer lengths-first to the final name with a flush and no fsync or rename, the fill's 4 MiB advice valid only because of display order; target 148 B header and 28/36 B entries checked against the field sizes; payload-format.md's codec field fixed; the brief's tag `read-path-evidence-2026-09-09` does not exist and the study is cited as `git show b55b68db:docs/disk-layout/ACCESS-PATTERNS.md` with its 17.6× / 1.50× conditionality; link check mutated (a broken link caught 1/1); gate green — [`docs/disk-layout/README.md`](../disk-layout/README.md), [`target.md`](../disk-layout/target.md) |
| 165 | **AUDITCODEC** — is every codec lever tried or closed? HTJ2K, AV1, JPEG XL, JPEG-LS, AV2, LCEVC, SVC, colour transforms and the bit split: closed by evidence, closed by a premise since changed, never tried, or waiting on the owner; ranked by net gain; audit | done `a75a6107` on `claude/av1-unified-mainbase` — **two measured levers reopen under the net reading, four were never tried, one release reopens a lever; the rest are closed by evidence or wait on the owner**: 34 levers in three tables (HTJ2K 16, AV1 12, other codecs 6), each with its rows and class; reopened by the net reading: OpenJPH under emscripten 6.0.x (projections ×0.886–0.931 a frame in 9–10/10, the rest within spread; row 134) and the shared-heap copy on RGB (×0.866 at 4×, memory 5–25 MB lower; synthetic only); never tried: HTJ2K histogram packing (the 16-bit film 0.576, row 64), JPEG-LS (CharLS-WASM 1.2.7), JPEG XL through jxl-rs in WASM (0.7.0 rewrote its 16-bit lossless path), Tomoz (`@zeroxshot/tomoz` 0.2.0), OpenJPH ARM SIMD natively; releases: only libaom 3.15.2 (fixes), jxl-rs 0.7.4, CharLS 2.4.5, emscripten 6.0.12 and dav2d 0.0.1 followed the pins; still no open LCEVC encoder, no Firefox high-bit WebCodecs, no 12-bit in Chromium's; the band moved against serving AV1; seven theory rows proposed (EMSDKNET, COPYRGB, HTJ2KPACK, JPEGLS, JXLRS, TOMOZ, ARMSIMD) and eight trade-offs listed for the owner; row 125's 'Tomoz not found' corrected in place — `docs/codecs/README.md` §Tried and open |
| 166 | **AUDITPATH** — the same audit outside the codecs: disk reads and the writer, the server's send path, transport, the client's downloader, decoders, paint and memory, ingest, the gate; audit | done `6c9a8ee3`, `c0a33f95`, `5d473890`, `168c8a94` on `claude/av1-unified-mainbase` — **audit: most of the path is closed by measurement that still holds; what is left is reopened by row 162's links or the net ruling, or never tried**: 140 lines of levers outside the codecs classed held, premise, never, owner or queued, each with the row that measured it (disk 29, send path 13, transport 31, client 45, ingest 14, gate 8); reopened by the band: PGO (−13 to −20 % server CPU, ~31 fills a core at 103 Mbit/s), server-side ask ordering (its ADR flips above ~100 ms RTT; loaded 0.2–0.8 s), the warm-up; reopened by the net ruling: P-COPY (row 134: −5 to −25 MB, RGB ×0.866) and `startOnNeed` (row 142: decoder CPU −4 to −14 %), both refused by a fixed bar, not a loss; 20 theory rows proposed, ranked — HASHFAST (the check is 4–12 % of an HTJ2K frame), COPYNET, PGOSHIP, STARTAA, ASKBEHIND, READERPAUSE, INITIALREPLY (+700 ms on a lost first flight, row 139), ASKORDER, TAILPING, INLINECAP, DEPLOYLIMITS, MTU1472, RELEASEBUMP, SCALECORE and six smaller — behind row 167's ASKAHEAD and row 168's measuring row; 26 trade-offs for the owner; found on the way: dangling owners (rows 49, 54, 86), docs not corrected for the band (`rig-limits.md`, `native/quic.md` §7), four owner calls missing from §Blocked, P0 with no row — `docs/levers.md`, linked from `README.md` |
| 167 | **BANDRECHECK** — row 162's eight verdicts that rest on the old 5–50 Mbit/s band, each re-derived at the measured link profiles: holds, flips or open, and the measurement that would decide; theory | done `0a67a42c` on `claude/av1-unified-mainbase` — **2 flip, 2 open or split, 4 hold, and a ninth**: the framing flips (a core carries ~31 fills at 103 Mbit/s, not ~160; AV1's 4× decode is the clock below the median link), `dbts_b4` as AV1 flips from a win on every phone link to a trade-off (1.97× at 4× on 100 Mbit/s, the cellular median), the 32-packet window is open (its losing cell is a 10-packet queue), flow control holds for Chromium (6 MiB) and flips for a quinn client (1.25 MB binds at far-region RTTs); controller, 768 KB window, GSO cap and asks first hold; **an ask during a fill waits behind 6 MiB of written-ahead fill in Chromium, 0.49 s at 103 Mbit/s and 2.8 s at 18 (D)**, which a send window tracking cwnd + 2 frames would cut to ~0.1 s on short queues at no fill cost in theory; protocols ASKAHEAD, IWDEEP, FASTCLOCK, B4FAST proposed — `docs/transport/link-conditions.md` §Verdicts that rest on the band, §Re-measured, proposed |
| 168 | **PACKWRITE** — why a `.sbnd` written through an 8 KiB `BufWriter` reads 24–31 % slower than the same bytes written in 1 MiB writes (row 160): the mechanism, whether production would see it, and the protocol for the fix; theory | done `3e3b49ca` on `claude/av1-unified-mainbase` — **theory: the writer sizes the page-cache folios a hit walks, and a 1 MiB buffer is the one-line fix, worth ~1 µs of server CPU a small frame**: `pack-series`' 8 KiB `BufWriter` already writes every frame ≥ 8 KiB in one `write` (Rust 1.97 `bufwriter.rs:420–429`), but Linux v6.18.44 sizes a new folio by the write's remaining length and its page index's alignment (`mm/filemap.c:2006–2010`, ext4 large folios since v6.16, XFS since v6.6); a model of those rules (`folio_model.py`, (D)) gives 5.1 folios per 32–41 kB frame for `pack-series`, 5.4 for `dd bs=8K`, 1.3 for a 1 MiB `BufWriter`, 1.0 for `dd bs=1M`, 9.9 for 4 KiB folios — fitting row 160's three readings (~150–300 ns a folio, (D)); fragmentation, delayed allocation and `fallocate` touch no hit; production sees it only from pack to reclaim on ext4 ≥ 6.16 or XFS ≥ 6.6, and after reclaim the fill's own `WILLNEED` builds 4 KiB folios (`mm/readahead.c:275–276`), about twice `pack-series`' count; fixes F1–F5 ranked; protocol of 8 arms (A/A, `O_DIRECT`-written arms for after reclaim, a `data=journal` control that turns large folios off), 4 frame sizes, 16 interleaved rounds, folios counted through `kpageflags`, and a decision rule (a)–(e) for a separate measuring row, not queued — `docs/disk-layout/README.md` §The writer (on `claude/av1-unified-mainbase`) |
| 169 | **DISPLAY** — what reaches the radiologist's screen: bits per sample after the window, the grayscale standard display function, colour management for RGB, in the browser and natively; theory | done `6238171a` on `claude/av1-unified-mainbase` — **theory: the exact frame reaches the screen as 8 bits after the window, sRGB-tagged, with no presentation LUT and no ICC handling; going past 8 bits is a trade-off, reading the colour and LUT tags is net where present**: a window W wide shows W/256 units a code (CT soft tissue 1.6 HU, lung 5.9, full 13-bit 22.6, (D)); 256 codes over the ~720 JNDs of a 0.8–600 cd/m² medical display is ~2.8 JNDs a step against 10 bits' ~0.7 (Kimpe and Tuytschaever 2007; 10 bits enough); Windows composes windowed apps at 8 bits a channel unless Advanced Color is on, WebGL's `drawingBufferStorage(RGBA16F)` is Chrome/Edge 122+ only and needs `alpha: true`; Chromium colour-manages the canvas to the monitor's profile unless `--force-color-profile=srgb`, a device question for GSDF panels; the ingest drops ICC Profile, Color Space, VOI LUT Sequence and Presentation LUT Shape; gaps G1–G6 (G1 half-float painter: picture memory ×2 and the 8-bit proof lost — trade-off, owner's; G4, G6 net where present), a container protocol with predictions, mutations and decision rule, a device protocol for the owner, rows DISPLAY10, COLORTAGS, VOILUT proposed — `docs/display.md`, `client/paint/README.md` §What reaches the screen (on `claude/av1-unified-mainbase`) |
| 170 | **FETCHPIN** — `lab/av1/fetch_data.sh` runs as written: the hash-pinned `typing-extensions` that `blake3` needs (row 160's side finding) | done `e117cd1f`, `07f17f85` on `claude/av1-unified-mainbase` — **`typing-extensions==4.16.0` pinned with its wheel's hash; from a clean 3.11 venv the script installs under `--require-hashes` and 88 of 91 sets fetch and match their pinned digests**; the three breast-ultrasound sets' Zenodo archive was refused (TLS resets, 0–130 kB/s, stalled at 50 MB of 1.49 GB). A flipped hash failed the install. Also: the venv is now built with `python3.11` (`PYTHON` overrides), since a host whose `python3` is 3.13 failed on xxhash's 3.11-only hash. Every other line was already pinned with `==` and hashes. Side findings: the proxy cut 5 large IDC files short (0.1–0.6 % missing), which the script refuses and a retry fetched, and `urlretrieve` has no timeout, so a stalled fetch hangs — `lab/av1/requirements.txt`, `lab/av1/fetch_data.sh` |
| 171 | **ASKAHEAD** — row 167's protocol: a send window that follows the congestion window, so an ask during a fill stops waiting behind 6 MiB written ahead | done `1c13d35f` on `claude/av1-unified-mainbase` (the flag and rig `aad95192`) — **a trade-off, not adopted**: the ask −59 to −67 % at 18 Mbit/s and −39 to −59 % at 103 behind 20 ms and CoDel (e.g. 537 → 223 ms, 3.12 → 1.03 s), unchanged behind 360/800 ms at 103 (the credit binds), but the fill +0.7–1.4 % at 18 and +5–11 % at 103 beyond its spread in 8 of 16 cells (the remainder re-asked a round trip after the ask, D); server RSS 9.1–9.8 → 4.6–7.9 MB; 320 runs exact, 174 `VOID`, strict and round-paired agree but on one cell's ask (103/92/20 ms, not conclusive); 309 Mbit/s past the host's ~140; HyStart's arm not run (retired, no flag); ASKTHENFILL proposed — [`../transport/link-conditions.md`](../transport/link-conditions.md) §Re-measured, proposed |
| 172 | **WRITERMEASURE** — row 168's protocol: `.sbnd` files written in 8 KiB against 1 MiB writes, folios counted, hit and fill timed | done `fd1a483d`, `9c3163f1`, `b7d991ef` on `claude/av1-unified-mainbase` — **folios confirmed on ext4, F1 not adopted under the rule's resolution, the writer closed (e); (d) fires: the fill's `WILLNEED` is the larger lever**: run blind to row 168's §Why; 8 arms, SHA-256-equal (none void), on host ext4, loop ext4, ext4 `data=journal` and XFS (xfsprogs 6.6.0), 5 cells, 16 interleaved rounds, 47.3 M reads XXH3-checked and all 160 arms' 26 656 frames decoded against ingest's digests: 0 inexact; the lab writer's `write(2)`s equal `pack-series`' under `strace`; folios per 32–41 kB frame A0 4.86–5.26, A1 1.27–1.38, A2 1.04–1.15, A4 4.79–5.91, A6 8.58–10.79, the 160/500 kB model within 3 %, A5 missed on `mr9_ispy2` (2.53–4.15), every `data=journal` arm 4 KiB folios, unchanged after the last round; hit p50 A1/A0 at 32–41 kB 0.62–0.77 host, 0.70–0.83 loop ext4 (75–100 % of rounds), 0.86–0.93 XFS, ranking as predicted on ext4, not on XFS (all tie), but no cell beyond the A/A resolution 0.25–0.68, so (b) ties; A6 beyond it on host `ct_lidc`/`dbt12_ea1141` (hit ×2.02/×1.99, fill hit ×0.68/×0.64, CPU/GB ×1.49/×1.56); pack time has no A/A arm. Proposed: WILLNEEDFOLIO, WRITERAA (owner's: a median-based bar), XFSFOLIO — `docs/disk-layout/README.md` §The writer, §Measured; `lab/container-bench/writer.py` (on `claude/av1-unified-mainbase`) |
| 173 | **NETRULES** — rows 134 and 142's three refused levers (OpenJPH under emscripten 6.0.x, the shared-heap copy, decoders started on first need) given protocols judged by an A/A arm's spread under the net reading; theory | done `0b3c1898` on `claude/av1-unified-mainbase` — **yes, all three have a fair protocol under one A/A rule** (a second copy of today's arm each round; worse or better only by a one-sided Mann–Whitney on round-paired ratios, p < 0.05, confirmed in a second run; not conclusive when the loss it would catch in 80 % of campaigns exceeds 5 %): by its simulation, false *worse* ≤ 0.05 % a cell, a loss caught at +1.7 / +3.2 / +4.8 / +8.2 % for a 1 / 2 / 3 / 5 % arm spread at n = 12, ~1.8× finer than the p90 resolution bar. Cells at 100 and 300 Mbit/s, 46 ms idle and a 650 ms FIFO (~0.7 s loaded), relay ceiling probed first. Predicted: P-EMSDK net (projections ×0.89–0.93, row 134's ×1.061 cell inside A/A); P-COPY net on the six sound `usrgb_*` sets (RGB ×0.85–0.95 at 4×, grey a tie, memory lower), in Chromium and Firefox; `startOnNeed` **worse ×1.03–1.08 on decode-bound fills at 300 Mbit/s 4×** (late starts on the critical path), so a trade-off; STARTAHEAD and AARULE proposed — `docs/decode/README.md` §Not yet tried, *Net protocols*; `lab/scripts/aa_rule.py` |
| 174 | **QUICSTREAMS** — how each QUIC stack handles many streams (scheduling, priority, flow control, limits, retransmission order) and which stream design serves a fill and an ask best at the measured links; theory | done `8c50b902` on `claude/av1-unified-mainbase` — **one stream is enough for throughput; the ask during a fill decides, and today's `per-frame` flag is the worst design for it**: eleven stacks and two browsers read at their pins (scheduler, lost-data order, write bound, uni MAX_STREAMS; quic-go and lsquic contradict earlier readings: quic-go has RFC 9218 priorities, lsquic opens no application uni stream and its HTTP iterator collapses other priorities); `sendOrder`/`sendGroup` reach QUICHE in Chromium and neqo in Firefox but order only the browser's own sends; Chromium grants 100 uni streams, 6 MiB each, 15 MiB a connection, never auto-tuned. A self-induced queue never binds one stream's 6 MiB (it binds above 547 Mbit/s at 92 ms); another flow's 0.4–0.8 s queue binds it at 63–126 Mbit/s. An ask during a fill at 46 ms (D): shared today 3 087 / 577 / 223 ms at 18 / 103 / 309 Mbit/s; per-frame today 4 735 / 865 / 319 (10 MB ahead, not 6 MiB); send window = cwnd + M (row 171) 845 / 240 / 155 behind 20 ms and never worse; per-frame with the ask above the fill 356 / 155 / 126 behind 20 ms but 865 against 577 ms at 103 Mbit/s behind 800 ms, so a trade-off. The 4-arm protocol and rule are for row 180; `quic_streams.py` prints every table, 5 mutations caught 5/5. Finding: [`../native/quic-compared.md`](../native/quic-compared.md) §9 on `claude/av1-unified-mainbase` |
| 175 | **TILESTORE** — tiles for large frames: the store-format proposal rows 133 and 143 left for the owner; writing, nothing built | done `6a6c9750` on `claude/av1-unified-mainbase` — **a proposal, nothing built: three horizontal strips, each its own HTJ2K codestream, cut into three level bands (L2 ~7 %, L1 ~20 %, L0 ~72 %), band-major, the entry map arithmetic (e = b·N·T + f·T + t) in a 36 B v2 entry whose samples hash is the tile's level picture from the encoder's input; no wire or server change (a fitted fill at L is one `stream_frames` run, an ask 6 `request_frame`s at L1)**; every frame of ≥ 1 MP under the owner's rule, k = 3 (row 133: ×0.39–0.45 at 4×, +0.12 % bytes; k = 3 beat k = 2 at every size); strip heights on 32-row multiples so level pictures stack seamless; per viewport in device pixels; 12-bit large frames keep layout 0 until a level-first fill is shown net (×0.98–1.04 today); a zoom at 1:1 on a phone fetches 3.3–5.3× the visible area with strips, 1.1–3.5× with 3 × 3 (D), so TILEGRID decides the grid; migration re-encodes from samples checked against the frame digest; still to measure: BANDS, TILEGRID, signed and colour level pictures, k on a phone — [`../disk-layout/target.md`](../disk-layout/target.md) §Layout 1, [`../adr/resolution-fitting-for-large-frames.md`](../adr/resolution-fitting-for-large-frames.md) §8.8 |
| 176 | **HASHFAST** — the frame check's XXH3-64 in the decoder worker: where its ~3.3 GB/s goes, and whether a SIMD128 build over the decoder's own heap is faster with the digest unchanged; theory | done `f4f1e360` on `claude/av1-unified-mainbase` — **the shipped hasher is scalar, and only an upstream SIMD128 build is a candidate, ≤ 4.2 ms (≤ 6 %) of a 69 ms mammogram decode**: hash-wasm 4.12.0's XXH3 is its own scalar port (`-msimd128` commented out), copies every byte into a 128 KiB heap 16 KiB a call (1 666 calls on 27.3 MB) and reads the frame's SAB; by elimination (row 151's unshared copy 6.3 against 8.1 ms, hash-wasm's XXH64 ~16 GB/s through the same path) shared reads cost ~1.8 ms and the scalar core ~4.6–6.3 ms; xxHash v0.8.4's SIMD128 path (its NEON code via SIMDe, "x2/x3" by its changelog) predicts ×0.48–0.72 with the digest fixed by spec; hashing before the copy (×0.75–0.80) leaves the copy unchecked, a trade-off; a hasher-owned frame memory (×0.19–0.39) only grows, not proposed; ARM may gain nothing (one aarch64 report); protocol and rule for row 179 (arms A, C, C0, B) — [`../adr/exactness-in-production.md`](../adr/exactness-in-production.md) §10 |
| 177 | **DOCFIX** — row 166's found-on-the-way list: docs not corrected for row 162's band, dangling owners, stale lines, owner calls missing from §Blocked | done `3e995599` on `claude/av1-unified-mainbase` (§Blocked on this branch, `8e9f4c20`) — **row 166's list corrected in place, no new claim; 7 docs, 6 owner calls added to §Blocked**: `rig-limits.md` §1's 768 KB "never binds" and `native/quic.md` §1 and §7's 5–50 Mbit/s, flow-control and "0.4–0.7 % of a core" (now 2.6–4.0 % at 103 Mbit/s) each corrected to `transport/link-conditions.md`; the gate's cost (161 → 106 s) back in `README.md` under the name rows 54 and 86 cite; row 49's hand-off restored in short to `decode/README.md` (dropped by `3187b224`); `ARCHITECTURE.md` §Open's "not built" pool and unrun shared store corrected; the coded-bytes digest marked agreed in `ingest/README.md`; `stream-shape.md`'s row 78 named as cq 78; `CLAUDE.md`'s path was already right on the work branch and is right for its own tree here. §Blocked: GSO cap, 32-packet window, `MALLOC_MMAP_THRESHOLD_`, keep-alive ADR, P0, row 139's review call. Gate green |
| 178 | **NETMEASURE** — row 173's protocols run by a session given only them | done `4c42d598` on `claude/av1-unified-mainbase` (harness `4ed0f9a5`, rounds `c1101ffa`…`2634a951`) — **no lever adopted on this host**: 3 024 relay visits and 6 624 frame rows, n = 12 confirmed on 12 fresh rounds, not-conclusive cells read at n = 24, 124 560 + 20 952 frames exact, mutations caught in every harness; 300 Mbit/s voided 30–50 % (the host delivers ~170), dropped. **EMSDKNET:** nothing worse; a frame ×0.850 (1×) and ×0.903–0.929 (4×) on the projections, the fill there ×0.987–0.997, cold asks a tie (predicted ×0.91–0.96: not held); six frame cells not conclusive (A/A sd 2.7–10 %) — the cells, for the owner. **COPYRGB:** an RGB frame ×0.80–0.93 in both engines, cold ask ×0.92–0.93, `usrgb_mel` fill ×0.88, Chromium memory −1.4 to −26 MB; Firefox's grey cells not conclusive (7) and `dbtproj_ge` 4× flagged worse once, its peak bimodal — not adopted here. **STARTAA:** a trade-off — wake-ups ×0.20–0.43, decoder CPU ×0.89–0.96 at 4×, the decode-bound fill ×1.042–1.051 in the first run, ×1.010 in the confirming one, ×1.023 pooled (×1.08–1.19 at the dropped 300) — [`../decode/README.md`](../decode/README.md) §Not yet tried, *Net protocols*, Measured; QUIETHOST and FFPEAK proposed |
| 179 | **HASHMEASURE** — row 176's protocol run by a session given only it | done `ab0fc196` on `claude/av1-unified-mainbase` — **C adopted, built as the default hasher**: xxHash v0.8.4's XXH3 with SIMD128 is ×0.65 (Chromium) and ×0.66–0.72 (Firefox) of hash-wasm's on the two large frames (mammogram 6.0–6.3 → 4.0–4.7 ms), no round slower, every one of 5 760 digests the ingest's, 12 rounds; C0 (scalar) ×0.80–0.86, against ±10 % predicted; B (before the copy) ×1.00–1.04, against ×0.75–0.80 — `docs/adr/exactness-in-production.md` §10, *Measured*; `lab/av1/exact/hashfast` |
| 180 | **STREAMSMEASURE** — row 174's protocol run by a session given only it | done `f639a233` on `claude/av1-unified-mainbase` (`f223e5b7`, rows `a8bcbc01`) — **a trade-off for the owner; `shared` stays**: `--stream-mode per-frame-asks-first` built beside today's path (lab only, its rank test failed under 3 of 3 mutations, a pipeline that never marks an ask put it behind all 11 written-ahead frames); run given only §9.5's protocol: 4 arms × 16 cells × 10 Williams rounds, Chromium 141, the 10-bit DBT volume, 640/640 exact, 111 `VOID`; 309 Mbit/s clean cells `VOID` in 10–18 of 40 visits, so not claimed; asks first's ask ×0.28–0.43 of the better of `shared` and row 171's window in every claimed 20 ms-queue and 1 % loss cell (18 Mbit/s FIFO 20: 314 ms against 1 025 and 3 118), but ×1.97 of window at 18 Mbit/s behind 800 ms (1 818 against 925) and ×1.05 of `shared` at 103 behind 360 ms, worse beyond the spread, and its fill +1.7–2.5 % outside `shared`'s spread in three deep cells; strict and round-paired agree; predictions: the fastest short-queue ask and the RSS above window's held, the other four did not (`per-frame` ties `shared`, ×0.96–1.03, so it neither confirms nor refutes §9.4 on claimed cells; arm 4's loss gap 3.2–6.1 s against `shared`'s 2.4–4.7) — [`docs/native/quic-compared.md`](../native/quic-compared.md) §9.5 *Measured* on that branch |
| 181 | **IWDEEP** — row 167's protocol: the 32-packet initial window behind the buffers phones have | done `52b902c6` on `claude/av1-unified-mainbase` (rig `b54cb37a`) — **adopted: the server starts at 38 400 bytes by default**: a fresh ask −26 to −38 % in every cell outside the 10-packet queue (250 KB 287 → 210 ms at 18/46, 523 → 373 at 103/92; 50 KB −34 to −38 %), the push-opened control −5.6 to +1.0 %; behind 10 packets the 250 KB ask +12 to +25 % (a tie at 103/92), the disclosed price; 960 runs exact, 242 `VOID`, strict and round-paired within 5 points; 309 Mbit/s past the relay's ceiling (181.6 delivered), not run — [`../transport/link-conditions.md`](../transport/link-conditions.md) §Re-measured, proposed (IWDEEP) |
| 182 | **FASTCLOCK** — row 167's protocol: where each codec's fill turns decode-bound at the measured rates, and the GSO cap of 24 as the build default | done `83cbf63e` on `claude/av1-unified-mainbase` (rigs `138b845d`, rows `c4166380`) — **HTJ2K's fill is the wire's through 218 Mbit/s even at 4×; AV1's is the decoders' from 50 at 4× and from 218 at 1×; the GSO cap of 24 meets its rule and waits on the owner's yes**: 10 interleaved rounds, 480 visits, 6 720/6 720 frames exact (63 `VOID`, both readings agree but one clock), `dbt10_ea1141` and `ffdms_c1`, HTJ2K against the k2 AV1 payload, Chromium 141 and Firefox 157.0.1, 1×/4×, 50/103/218 Mbit/s at 46 ms (the relay delivers 177–182 asked 218, 455–480 unshaped); HTJ2K's tail 13–80 ms at 1× and 52–389 ms at 4× with the fill still tracking the wire (prediction "decode-bound at 4× from ≤ 103" failed), AV1 at 4× flat at 2.84–2.87 s (Chromium DBT) across all three rates; AV1 ÷ HTJ2K 0.98 only at Chromium DBT 1× 50, else 1.02–4.72. GSO: server CPU a MB ×0.791 (AV1) and ×0.864 (HTJ2K) at 32 sessions × 103 Mbit/s, 10/10 rounds lower, fills a tie, a Chromium ask during a fill ×0.998–1.002 behind 20 and 360 ms FIFOs; not flipped (it replaces today's build; owner call (1) in §Blocked). Side finding: Firefox stalled ~6 s before the last byte in 9 of 240 visits. Proposed: FFSTALL, HTJ2KTURN — `docs/transport/link-conditions.md` §Re-measured, *FASTCLOCK*, Measured |
| 183 | **ASKBEHIND** — an ask behind a decoder's queue at the measured rates, and whether ask-aware dispatch cuts it with the fill unchanged; theory | done `cac8539c` (claims `43a12256`) on `claude/av1-unified-mainbase` — theory: with every decoder full an ask waits R_min + 2T today (one fill frame's decode extra, 34–139 ms on `dbt12` at 4×, 395 on a mammogram); **jump** (the ask ahead of the queued frame on the decoder that ends first) is predicted **net**: a tie where the wire is the clock (every 1× cell), ×0.57–0.88 at the median where decode is (4× at 300 Mbit/s, AV1), fill unchanged; **hold** (a slot kept free) a trade-off, fill +1–6 %. A protocol for a measuring session (flag `askJump`, NETRULES' A/A rule) — `docs/decode/README.md` §An ask behind the decoders; `lab/ask-behind/sim.py` |
| 184 | **READERPAUSE** — the coded queue's growth on large series at 100–300 Mbit/s, and whether a reader pause bounds it with fill and ask unchanged; theory | done `91366d65` on `claude/av1-unified-mainbase` — theory: the coded queue peaks at S(1 − D/W), **under 11 MB on every series measured** (`dbt12` AV1 at 4×: 2.0–10.4 MB; HTJ2K and every 1× cell: none), and never lifts the fill's peak past the retained pixels (≤ 1/r of it, garbage included); a pause bounds the device at H + Chromium's 6.25 MiB window, so it saves ≤ 4 MB on those cells — **net only on a long decode-bound series behind its own queue** (resume needs L + 6.25 MiB ≥ D × RTT: 1.7 MB at 46 ms), **a trade-off behind another flow's 0.7 s queue** (7.6–26 MB); worth queuing only if FASTCLOCK finds Q > ~20 MB. Protocol for a measuring session — `docs/decode/README.md` §A reader pause |
| 185 | **HTJ2KPACK** — sparse histograms in target series, and a value map before HTJ2K that cuts their bytes with decode unchanged beyond a lookup; theory | done `8a9713ea` on `claude/av1-unified-mainbase` — theory: by row 64's counts only the film (unrepresentative; 0.576 measured) and, mildly, one projection system (0.41 of 12 bits used; predicted 0.90–0.99) are sparse; CT, cone-beam, PET dense (0.97–1.00); the breast family's processed images are uncounted and the likeliest combs (g = 4 → ~0.7–0.8 predicted). **Net only where bytes fall to ≤ ~0.8** (the block decoder's saving pays for a +5–15 % lookup); a trade-off at 0.9–0.99; a store-format change for the owner if adopted. Density-first protocol and rule — `docs/codecs/htj2k.md` §A value map for sparse series |
| 186 | **JXLRS** — jxl-rs in WASM with a sample API: is any JPEG XL setting as fast as OpenJPH and smaller; theory | done `1365b749` on `claude/av1-unified-mainbase` — theory, jxl-rs read at v0.7.4: its 16-bit modular buffers apply only at ≤ 12 bits (libjxl's encoder clears the flag above), the per-pixel tree, predictor and entropy loop stays scalar in both decoders, its u16 output is exact through f32 (D); predicted ×0.8–1.2 of libjxl-WASM, so e1 at 0.85–2.3× OpenJPH for 1–5 % fewer bytes — **no setting predicted both smaller and as fast; a trade-off at best**. Protocol (a `wasm-bindgen` crate over `jxl` 0.7.4, three arms by row JXL's timing) and rule — `docs/codecs/jpeg-xl.md` §jxl-rs in WASM |
| 187 | **INITIALREPLY** — answering a repeated Initial with the unacknowledged server flight: a lost first flight's 700 ms cut, nothing sent on clean links; theory | done `77dfcfe7` on `claude/av1-unified-mainbase` — theory: quinn-proto 0.11.18 only ACKs a repeated client Initial (`process_early_payload`) and waits for its 999 ms PTO; a once-per-connection reply is predicted **net against today** — the browsers' lost first flight **+699 ± 50 ms** (the repeat at +300 ms lifts the amplification budget, so the ECDSA chain fits), `cold_open` ±0, nothing sent under ~400 ms, one spurious 1.3–2.8 KB flight at 600–1 000 ms where Chromium already repeats — and **equal to the 100 ms initial-RTT arm for browsers**, so the owner's fallback if that arm is declined. Four-arm protocol (today, A′, reply, 100 ms) and rule — `docs/transport/transport-conclusions.md` §Answering a repeated Initial |
| 188 | **JPEGLS** — CharLS in WASM on the target series: bytes and decode against OpenJPH, exact; theory | done `f2b591d6` on `claude/av1-unified-mainbase` — theory, CharLS read at 2.4.5: its decode loop is serial by construction (each pixel's context and prediction need the one before, `src/scan.h:360–381`), so no SIMD; by the sources JPEG-LS is **0.80–1.03 of HTJ2K's bytes** (0.92–0.95 on tomosynthesis) at **×2.7–3.4 OpenJPH's decode** — JPEG XL e2's corner, **a trade-off at best, never net**. Protocol (CharLS 2.4.5 to WASM under the pinned emscripten, a T1–T3 and reset grid for each set's best, row JXL's timing) and rule — `docs/decode/README.md` §Not yet tried, JPEG-LS through CharLS |
| 189 | **INITIALMEASURE** — row 187's protocol: answering a client's repeated Initial with the unacknowledged server flight, against today, A′ and the 100 ms initial RTT | done `ba408823` on `claude/av1-unified-mainbase` (build `5b5d68c3`, rig `d11f0260`) — **the rule does not pass; the flag stays off by default**: the reply puts Chromium's lost first flight +699.5 to +701.0 ms sooner (both certificates, both readings) and Firefox's +639 to +699.5, its chain at 80 ms +639 · +641.5, 8–10 ms under 699 ± 50, where the 100 ms arm reads +651.5 · +635 (a trace: on the wire Firefox gains 697 ms too; its own time to `ready` varies after it); B (1 000 rounds) and C hold — medians ±0.1 ms, no congestion event or server datagram beyond today's without a repeat; R ties H on the browsers in A, loses `cold_open` by 0.7–0.85 s, and in B is ready at 248–252 ms where H is at 467–471 on the 0.8 % of Chromium opens that lose part of the flight; Chromium repeats on every slow link, 300 and 400 ms too (row 139's count corrected). `docs/transport/transport-conclusions.md` §3 *Measured: INITIALMEASURE*. |
| 190 | **DEVICEPLAN** — the plan for testing on real devices: the owner's phone, local machine and Oracle cloud machine — what each test settles, the rig, the links, the order; writing | done `8f3981f8` on `claude/av1-unified-mainbase` — **six runs, the first three in one evening**: D0 the phone browsers' capabilities (decides the decoder each gets and whether WebKit needs a CA certificate), D1 decode and paint on the phone with frames in memory (whether the 4× stand-in of rows 9, 44, 182 predicts it), D2 rows 180 and 181's arms on the phone's own Wi-Fi and cellular against the Oracle server, with a desktop control on the same link; then D3 row 193's grid under `netem` on the local machine, D4 row 189's arms through the relay and in the field, D5 memory and (Android) energy. Each a `local` row, run by a session given only its protocol; nothing run. `docs/devices.md` |
| 191 | **IWOPTIN** — the 38 400-byte initial window back to opt-in (a flag, default 12 000), kept as an experimental proposal | done `f57700d3` on `claude/av1-unified-mainbase` — **the default is quinn's 12 000 again; 38 400 is opt-in** (`--initial-window-bytes 38400`, no new flag: the existing one lost its default). The test (`tuning.rs`, `the_wider_initial_window_is_opt_in`) checks the default starts at 12 000 and the flag reaches all four controllers; it failed on both mutants (default 38 400; `cubic-restart` dropping the flag). Row 181's verdict marked *proposed, opt-in* in place in `docs/transport/link-conditions.md` (items 3, IWDEEP) and `transport-conclusions.md` §9 item 3, with the window of commits whose bare lab arm ran 38 400 (`52b902c6`–`f57700d3`). Gate green, 112/112 server tests after the rebase. A run still on `52b902c6`–`f57700d3` with no flag (rows 178, 189 if rebuilt) changes its window: the `transport=` banner shows it. The draft pull request flipping the default is the orchestrator's |
| 192 | **GSODEFAULT** — the GSO cap of 24 in the default server build (row 182) | done `b8c780c0` on `claude/av1-unified-mainbase` (and `7667bda2`) — **the default build carries quinn's GSO cap of 24**: `quinn = { path = "patched/quinn" }` under `[patch.crates-io]`, the patch's ceiling 64 → 24; `server/tests/gso_cap.rs` reads the widest batch quinn hands a socket offering 64 segments: 24, and fails at 10 (stock quinn), 45 (ceiling 64) and 23 (ceiling 23). The deploy image builds it (it could not before: two workspace members were not copied in, `7667bda2`). Gate green, nothing skipped but the two optional ingest/viewer arms. Still carried by the patch: quinn-rs/quinn#2189. `docs/transport/transport-conclusions.md` §4, §9 item 6 |
| 193 | **STREAMSWIDE** — one stream against several under head-of-line blocking across a wide range of rates and losses, random and bursty: where several must win in theory, and why the measurements so far did not show it; theory | done `e6de9663` on `claude/av1-unified-mainbase` — **under CUBIC several streams cannot beat one by more than a few ms a frame anywhere in 1–1 000 Mbit/s, 5–300 ms, 0.01–10 %: the cut keeps the window at ~1.2 ÷ √p packets, so a loss holds 17 kB at 1 % and 55 kB at 0.1 %, under one frame, and one stream a frame gains 0 ms; they win only under a loss-blind controller** (25–39 ms a frame at 103 Mbit/s, 92 ms, 0.1 %; a fill ×2.3 at 309/92 where one stream's 6 MiB runs out during repairs), and **several connections** win under random loss by their number (1 %, 103 Mbit/s: 35.9 → 18 → 9.0 → 4.5 s for 1–8). Row 180's loss cells are the controller: the model's ask 18.1/4.4/1.54 s against 20.1–21.0/5.2–5.3/1.71–1.79 measured. No published Gilbert–Elliott fit for phones found. Predictions and a rule for row 190's D3. `docs/native/quic-compared.md` §9.6, `quic_streams_wide.py` |
| 194 | **COMPLEMENT** — complementary approaches to lossless bytes and decode beside the codec: the bit split for HTJ2K and JPEG XL, inter-slice decorrelation, value maps, the noise floor that bounds every codec; theory | done `cfa93e20` on `claude/av1-unified-mainbase` — **little is left beside the codec, and JPEG XL already takes most of it**: the sensor noise's entropy, estimated on seven sound series (`lab/av1/floor`, every check mutated), is 0.80–0.91 of HTJ2K's bytes by the high estimate (0.59–0.85 by the low), so no coder can save more than 9–20 % over HTJ2K (15–41 % at the most generous), and JPEG XL e7 saves 7–17 %; the projections have the least room (≤ 9 %). Inter-slice is the only candidate above 3 % — a linear term cuts a predictor's bits ×0.943 on rotational XA and ×0.962 on 10-bit DBT, ×0.988–0.998 elsewhere — at the cost of an ask needing two frames; a reversible slice difference loses (+0.41–0.46 bits a sample); the split stays row 36's 1–2 %, JPEG XL's split not worth a row; value maps only on sparse series (row 185); masks and per-region coding have nothing lossless to remove; none cuts decode. INTERSLICE protocol written, not queued. `docs/codecs/README.md` §Beside the codec |
| 195 | **DOCKERREAD** — the server's file reading inside a Docker container, the likely deployment: storage driver and mounts, the page cache and folios, `WILLNEED`, `RWF_NOWAIT`, io_uring under the default seccomp profile; measured on the owner's machine | done `c21149a6` on `claude/av1-unified-mainbase` — theory, rig and protocol, measured by row 208 in a cloud container (its cell); row 216 measures it on the Oracle rig |
| 196 | **WILLNEEDFOLIO** — the fill's `POSIX_FADV_WILLNEED` rebuilds frames in 4 KiB folios after reclaim (row 172: hits ×2.0, fill ×0.64–0.68, CPU per GB ×1.5 on 160–500 kB frames): a read-ahead that keeps large folios, with the fill's wait unchanged; theory | done `75b21671` on `claude/av1-unified-mainbase` — theory, Linux v6.18.44 and mainline v7.3-rc7: **`WILLNEED`, `readahead(2)` (the same call, `mm/readahead.c:730`), `MADV_WILLNEED`, larger ranges and `read_ahead_kb` all build 4 KiB folios** (`page_cache_ra_unbounded` allocates at the minimum order, unchanged upstream); a fill's own `pread` resets the order to 0 and ramps +2 a window to 128 KiB on a shared `f_ra`. **P — a second descriptor mapped `MADV_HUGEPAGE` + `MADV_RANDOM`, `MADV_POPULATE_READ` one aligned 2 MiB block a call, two in flight — builds one 2 MiB folio a block** (`mm/filemap.c:3266–3279`), falling back to today's on a cached page or a failed order-9 allocation; predicted folios 1.1–1.6 (160 kB) and 1.2–2.2 (500 kB) against 41 and 123, hit p50 0.40–0.55 of today's and fill-hit CPU ×0.6–0.75 on ext4, a tie on XFS and at 32 kB, the cold fill a tie; B (a scratch `pread`, a copy a byte) second; `MADV_COLLAPSE` rejected; XFS 64 KiB blocks a deployment option. Protocol and rule for row 197: `docs/adr/disk-access.md` §6 *Read-ahead and folios*, *Protocol for row 197* |
| 197 | **WILLNEEDMEASURE** — row 196's protocol run by a session given only it | done `00b8981b` on `claude/av1-unified-mainbase` — measured blind to row 196's reasoning: **neither read-ahead adopted, W0 stays** (rule (e)). W1 (`MADV_POPULATE_READ` in 2 MiB blocks) cut folios a frame to 2.3–12.5 at 164–499 kB against 41–113 (predicted 1.1–2.2) and hits to ×0.62–0.77 (predicted 0.40–0.55), beyond the resolution on the host's ext4 only, worse beyond it on XFS's cold-fill CPU at 4.8 MB (×1.15); W2's preads cost ×1.1–1.9 cold-fill CPU; unpredicted, no advice builds the fewest folios (×0.02–0.16) and hits as fast, but misses +7 to +71 on the host (`read_ahead_kb` 128); `data=journal` serves `O_DIRECT` through the cache, so nothing cold is claimed there; 16 rounds, 2 048 rows, 5 238 656 frames exact; `docs/adr/disk-access.md` §Measured (row 197) |
| 198 | **READFASTER** — anything faster than today's read path for hits and misses: io_uring's registered buffers, fixed files, polling modes, `O_DIRECT`, NVMe passthrough, huge pages, `mmap`; where each frame's µs go today; theory | done `3e13aac0` — **nothing is faster on a miss, and a hit is at its floor but for two levers** (theory, Linux v6.18.44, quinn-proto 0.11.18): a hit is 4.1–52 µs at 32–503 kB (row 172), 4–9 % of a frame's server CPU (1.5–2.6 µs a kB), 8–14 % at 3 MB on 4 KiB folios; a miss is the device's, so every lever moves CPU, not wait, and each gives up the shared page cache; large folios after reclaim (row 196, ×0.5 hit at 160 kB–3 MB) and a user-space frame cache (structural, predicted −4 to −14 % of frame CPU where frames repeat, RAM the cost) reach into it; `O_DIRECT`, `IOPOLL` (needs `O_DIRECT` and poll queues no container sets), NVMe passthrough, registered buffers, `SQPOLL`, multishot (`-EBADFD` on a regular file), links, a fill ring, `mmap` and `RWF_DONTCACHE` rejected or closed; QUIC copies and seals in user space and v6.18 has no in-kernel QUIC, so no zero-copy send; THP buffers a predicted tie; protocol and rule for a measuring row written, no such row queued (the owner's) — [`docs/adr/disk-access.md`](../adr/disk-access.md) §13 on `claude/av1-unified-mainbase` |
| 199 | **DOCKERTUNE** — what a Docker deployment must set to keep the full read path (io_uring under seccomp, `memlock`, `nofile`, storage), what each costs in security, and what to do where it cannot; theory | done `f3689796`, `cdcee07f` on `claude/av1-unified-mainbase` — **Docker ≥ 25 (moby #46762), Podman (`containers/common` v0.40.1) and containerd ≥ 2.0 refuse io_uring under their default seccomp profiles (EPERM, ENOSYS, EPERM); `deploy/seccomp-uring.json` restores the three calls alone, at the cost of the kernel's whole io_uring surface (kCTF: 60 % of exploit submissions), so adopting it is the owner's call after row 195**. Verified in Docker 29.8.2: 1 024 four-entry rings at 8 MiB memlock, 512 at 4 MiB; the counter is per uid host-wide (a second uid-10001 container got ENOMEM on its first ring); `--cap-add IPC_LOCK` does nothing for `USER 10001`; bind mounts and named volumes honour `RWF_NOWAIT`, the layer and tmpfs refuse it. Under the default profile the gate's read-path tests skipped 10 of 29 and one failed (fixed). A `read_ring=` startup probe and `check-fastpath` in the image are proposed. Findings in `deploy/README.md` §Container settings |
| 200 | **CCNEXT** — congestion control beyond Cubic against BBR: what else exists and fits a loss-prone phone link with a deep queue, at row 193's wide range; theory | done `90a42a16` on `claude/av1-unified-mainbase` (`f1db0608` the model, `ed50fcb7`) — theory, nothing built or timed: **the target asks two things, no cut on random loss and no deep standing queue, and neither Cubic nor BBR gives both; a Cubic that skips the cut on loss met by under RFC 9406's q\* of queue has both where anything is lost**: on row 162's links (D, `docs/native/cc_next.py`, `check()` failing under 12/12 mutations) it fills 99.0–101.1 of 103 Mbit/s at 0.01–1 % with 2–3 ms of queue against Cubic's 5.7–50.7, and is Cubic when nothing is lost (379 ms of queue, Chromium's 6 MiB credit binding before the 725 ms buffer); a delay cut over it (Linux `tcp_cdg`'s shape) holds 2 ms clean for −1.5 to −4 % of the fill, an asked-first ask 474 → 98 ms at the cellular median, 936 → 360 at p10, but yields in a shared FIFO — on cellular only to the phone's own flows (per-user queues, Sprout); BBRv3 tolerates ≤ ~1 % (a probe round over its 2 % bound with probability 0.000–0.003 at 0.1 %, 0.03–0.19 at 1 %) but needs a rate-reading pacer and ~2 000 lines; Copa unknown on phone link noise; Vegas/LEDBAT keep Reno's loss bound (17.0 Mbit/s at 0.1 %); HyStart++, pacing, FEC (a lone ask's tail 0.7 ms mean at 0.1 %) and several connections dominated; L4S: Chromium 141 reads ECN on every QUIC socket (source), quinn sends ECT(0) only, carriers unknown — a classifier input, not a controller; five device measurements named; CLASSIFY (row 212's protocol) and DELAYCUT proposed — [`transport-conclusions.md`](../transport/transport-conclusions.md) §1 *Beyond Cubic and BBR* |
| 201 | **DEVICEKIT** — row 190's runner page, collector and Oracle deploy script built, with a quick round that reads a provisional answer in ~15 minutes, so the owner's device evenings give fast feedback | done `dd35094e` on `claude/av1-unified-mainbase` (and `ad3fead3`) — **the kit is built and ran whole against the container as host**: runner page (D0–D2, Williams order, IndexedDB, a post per round, save), quick mode (3 rounds, D1 on `dbt10_ea1141`, D2's `shared`/`asksfirst`/`iw38400`), token-gated collector, `deploy.sh up/fetch/down`, `make_bundles.sh`, `dry_run.mjs`, the evening's checklist; `server-start.sh` takes a supplied certificate and the session dials unpinned on an empty hash. Loopback, not a measurement: the quick evening in 16 s, D1 9/9 and D2 9/9 visits exact, 22/22 rows posted; `?mutate` voids 9/9 D1 visits and stops D2 at its proof, a flipped byte in the served bundle voids 9/9 D2 visits; three new tests in the gate, each failing under its mutations; the CA-verified arms reach the handshake only (Chromium 141 refuses a local CA for WebTransport). Not tested: a phone, Firefox, WebKit, the Oracle machine (`docs/devices.md` §6, `lab/devices/README.md`) |
| 202 | **ASKTHENFILL** — row 171's proposal: the ask first, then the fill re-asked at once, so the cap on bytes ahead costs the fill nothing; theory | done `b66027fa` — theory: the window's fill cost is one idle round trip before the re-asked remainder (+32 to +97 ms at 18 Mbit/s against 46 and 92 ms; 24–116 ms more at 103, unexplained), which today pays too whenever a remainder is left (5.4 MB at 10 % of the volume); re-issuing with the ask duplicates 185–2 073 ms, rejected; on the asked frame's head the gap left is max(0, RTT − S ÷ rate): 0 at 18 and 103/46 for 0.57 MB, 46 ms at 103/92; six predictions, a ~1 000-run protocol and a rule in `docs/transport/link-conditions.md` §Re-measured, *ASKTHENFILL*; no measuring row is queued |
| 203 | **FFSTALL** — Firefox stalled ~6 s before the last byte in 9 of 240 visits (row 182): the cause, and a fix if it is ours | done `e7b6509b` — **ours, and fixed**: the server's half-RTT flight (NEW_CONNECTION_IDs, then the HTTP/3 control stream written in four pieces by the early-SETTINGS patch) sometimes left as five datagrams; Firefox 157 (neqo v0.31.1) keeps four it cannot yet decrypt (`SavedDatagrams::CAPACITY`) and drops the fifth, quinn declares it lost ~95 ms in, Cubic cuts the 12 000 B initial window and leaves slow start, and the 13.6 MB fill crawls (8.4 s against 1.4 at 103 Mbit/s); 3 of 23 traced visits split five ways and all 3 stalled, none of the other 20; fix: the patch writes the control stream's header and SETTINGS in one write (≤ 2 datagrams); Firefox stalls unfixed 6 of 80 visits, fixed 0 of 80 (an interleaved A/B: 1 of 40 against 0 of 40, last-byte medians a tie, 1 920/1 920 frames exact); `the_half_rtt_flight_fits_what_a_client_keeps_undecrypted` fails on the unfixed patch 5/5 and a split write 3/3; not Firefox's bug, no upstream report — [`docs/transport/transport-conclusions.md`](../transport/transport-conclusions.md) §3, *Firefox's 6 s stall*, on `claude/av1-unified-mainbase` |
| 204 | **DEVICE1** — row 190's D0, D1 and D2 on the owner's phone, in one evening, through row 201's kit | local |
| 205 | **DEVICE2** — row 190's D3 (the controlled grid under `netem`, one stream against several) | local, after 204 |
| 206 | **DEVICE3** — row 190's D4 and D5 (the repeated Initial; memory and energy) | local, after 204 |
| 207 | **ASKFIRSTCAP** — asks-first with the bytes in flight still capped (row 171's send window, or 6 MiB across all streams): an ask that jumps the server's queue without a deeper network queue behind it; theory | done `b2e5b3a4` on `claude/av1-unified-mainbase` — theory, quinn-proto 0.11.18: **a fixed 6 MiB send window caps what Cubic keeps in flight** (a writer stopped by the send window leaves the connection app-limited, `connection/mod.rs:950`, and Cubic stops growing, `cubic.rs:102–109`), **so asks-first behind it is never behind `shared` and ties it where the controller would hold more than 6 MiB**: across row 193's range uncapped asks-first is ×1.20–1.52 of `shared` on fast deep paths, capped ×1.00, and ×0.08–0.95 elsewhere as before; row 180's ×1.05 at 103/360 is the 0.5 MB its cwnd held above the credit. **Row 171's cwnd + M is no cap** (M keeps the sender busy, Cubic grows into the queue). Not removable by any cap: the fill's +2.5 % at 18/800 (per-frame's too) and row 180's `window` arm beating asks-first there with equal cwnd, which the model does not explain. BBR (2 × BDP) meets the cap only on fast long paths. Protocol (5 arms, existing flags, the ask at a quarter) and rule: `docs/native/quic-compared.md` §9.7 |
| 208 | **DOCKERCLOUD** — row 195 run in a cloud container where it can be: Docker 29 starts there (`sudo dockerd`, overlayfs, default seccomp), so the read path inside a container on overlay, a bind mount and a volume, io_uring under the default and row 199's profile, folios after `WILLNEED`; a cloud VM's numbers, not the owner's machine | done `c21149a6` on `claude/av1-unified-mainbase` — **placement and folios hold, O sits at H's forced miss, and B+UL restores the ring: the profile is recommended for the owner** (row 195's protocol on rootful Docker 29.8.2 in this cloud VM, no SELinux so B+U = B+UL; 784 visits, 28 rounds, 2 VOID, 0 frames inexact): B and V tie H on every metric where reader and copy are the same; the two cells that part them part H from every container and were taken apart — pt15's fill ×2.1 is the host's glibc 2.39 against the image's 2.36 (H chrooted on the image's glibc ×2.10, 12/12 rounds), the WILLNEED cell is each arm's copy (read from the host: B's 32.7 µs, H's 66.8, identical folios); O's hit ×10.1 / ×4.6 / ×2.7 of B at 32 / 163 / 503 kB; B and V refuse the ring with `EPERM` (predicted `ENOSYS`), B+UL `ring=true` on 84/84 cold passes and ties H, buying 28.8 → 19.1 µs and ×0.67 CPU at 32 kB, a tie above; folios 28/28 ×1.00 of H before and after; O's cold pass ×0.27–0.56 of H, unexplained. Gate: green to the browser dispatch rig, which fails its 7 `exact:` checks without `client/decode/wasm/built` (Blocked, row 209), as on the base; the decoder build's apt needs plain HTTP, which this container's proxy refuses — [`../adr/disk-access.md`](../adr/disk-access.md) §6 *Measured in a cloud container* on `claude/av1-unified-mainbase` |
| 209 | **READMEASURE** — row 198's protocol: large folios after reclaim and a user-space frame cache, against today | done `33a47a54` — **the frame cache is a trade-off for the owner; glibc's hugetlb is closed** (row 198's protocol, 16 rounds, 832 runs, every frame XXH3-64-checked and one fill per arm decoded exact, the stale-entry mutation caught in 20 of 24 passes): B1 (`--features lab-frame-cache`, off by default) at 16 sessions ×0.78–0.83 CPU a frame on its second fill (16/16 rounds lower at 499 kB and 3 MB, beyond the 18 % and 9 % A/A resolution; 31 kB and 164 kB inside it) and half the peak RSS (106 against 191 MiB at 3 MB); at one session its second fill is the admitting pass, ×1.25–1.36 CPU and the series' size in RAM; first fills 0.97–1.05 alone, 0.79–0.93 shared; B2 ×1.01–1.09, never better; the hit model (4–14 % of a frame) corrected in place — a shared entry saves 17–22 %; a container's numbers, A/A resolution 9–41 % — [`docs/adr/disk-access.md`](../adr/disk-access.md) §13 *Measured (row 209)* on `claude/av1-unified-mainbase`; the owner, 2026-10-14: the frame cache stays off by default for now |
| 210 | **ASKTHENFILLMEASURE** — row 202's protocol | review — `claude/wip-210-ASKTHENFILLMEASURE` `c09ecf54`: **the window not adopted (both readings); the head re-issue B not conclusive on this host**. What changed: the downloader's lab flag `refill` (`head`, `ask`; off by default) and the envelope readers reporting a frame's 8-byte head before its body — today's default reader restructured to read the head first, the downloader's `ask` taking the session rather than a promise (behaviour unchanged, gate green); removes nothing; capability kept: today's re-issue when the ask lands. Measured blind to row 202's reasoning (its queue verdict seen first): 10 Williams rounds, 30 cells, 1 100 runs, every frame SHA-256-exact, 105 `VOID`; the last frame asked (560 018 B, as row 171), not the largest, which a deep queue writes ahead at 50 %. W + B's ask ×0.32–0.42 of T's at 18 Mbit/s, ×0.41–0.88 at 103 short queues, ×1.00 behind 360/800 ms at 103; its fill +79 to +101 ms worse at 103/46 CoDel and 103/92 at 50 %, more than RTT − S ÷ rate (3, 49 ms), and the window alone costs +15 to +46 ms with no ask (prediction 5 failed: the excess is the window's own). T + B: the ask a tie everywhere, the 10 % fill −33 to −273 ms in six cells beyond the spread; round-paired adopts it, strict does not over one 50 % cell (+4 ms, ×1.003) where B never fires — so it returns for a host that passes, T and T + B cells only. W + A +723 / +111 ms of fill. Predictions: 1 failed at 103/46 CoDel, 2 and 3 held (3 of 26 and 1 of 18 cells outside), 4 held at 18/46 and failed at 103/46, 5 failed, 6 held but for W + B under `cubic` behind CoDel (69 ms better). Gate `--quick` green — [`docs/transport/link-conditions.md`](../transport/link-conditions.md) §Re-measured, *ASKTHENFILL*, *Measured* on that branch |
| 211 | **ASKFIRSTCAPMEASURE** — row 207's protocol | done `626cd6a1` on `claude/av1-unified-mainbase` — **a trade-off for the owner; `shared` stays**: asks first + a 6 MiB send window keeps its ask at ×0.18–0.31 of `shared`'s behind 20 ms and under 1 % loss (×0.36–0.98 behind deep FIFOs, never worse beyond the spread) but **costs its fill +2 to +44 % in all nine cells, though the cap bound in none** (asks first's cwnd at the ask ≤ 4.1 MB): +41 % at 18/20, +40–44 % under loss; outside the protocol, `shared` under the same 6 MiB loses nothing (6 462 against 6 556 ms) while asks first + 6 MiB sends 13 724 packets to the others' 9 713–9 840 with equal losses and stalls 2.9 s between frames — the model has no term for it. Asks first + cwnd + M a trade-off too (ask ×0.11–0.75, fill +0.4 to +19 % in five cells). Predictions: (3) failed everywhere, (1) 5/9, (2) 7/9, (4) held, (5) BBR 6/8. 690/690 exact, 92 `VOID`, ask at a quarter, 10 rounds; strict and round-paired agree. Proposed: where asks first's extra packets under a send window come from, and a cell with cwnd above 6 MiB to test the cap — [`../native/quic-compared.md`](../native/quic-compared.md) §9.7 *Measured* on `claude/av1-unified-mainbase` |
| 212 | **CCMEASURE** — row 200's protocol, the arms a container and the relay can run | done `ba6609ad` on `claude/av1-unified-mainbase` (lever `f5fc049d`, rig `e4ad885b`) — **`cubic-classify` not default, in both readings; it stays a lab flag and DELAYCUT does not start**: 10 rounds, 6 720 of 6 720 frames exact. Fill ÷ `cubic-restart`, round-paired n = 10: 1–2 % loss at 50 Mbit 0.08–0.15 and at 20 Mbit 0.17–0.30 (651 against 7 908 ms at 2 %, the clean fill back), but 0.68–0.86 at 5 Mbit, three of four over the rule's 0.75 — a 0.4–0.5 s FIFO that Cubic fills makes every random loss meet a queue; clean and ±20 ms 0.98–1.03, two of sixteen over 1.01 within each cell's own spread; the neighbour's share 77 against 76 % shallow, 18 against 16 deep, 43 against 51 LTE-loaded (out by 7). Deep overflow at 2 MiB in flight: 30 of 30 congestion events met a queue at RFC 9406's q\*. 72 % of visits `VOID` on this host: strict n 0–7 a cell, judging the same failures where it judges. `docs/transport/transport-conclusions.md` §1 *Measured: CLASSIFY*. |
| 213 | **INTERSLICE** — row 194's protocol: a slice predicted from its neighbour, JPEG 2000 Part 2 across slices, on the volumes | done `d3d3e521` on `claude/av1-unified-mainbase` — **a trade-off on rotational angiography and CT, net on none**: a reversible 5/3 step across each slice pair, its low and high band each a served HTJ2K frame, bytes over the two served frames ×0.965 `xa_dynact16`, ×0.960 CT (the control, predicted 0.99–1.01: missed), ×0.978 `dbt10_ea1141`, ×0.994 `dbt12_ea1141`, every pair exact; decode a pair through the product's OpenJPH-WASM in Chromium 141, inverse in JS, 12 interleaved rounds at 1× and 4×, 1 728/1 728 pairs exact: ×1.19–1.39 at 1×, ×1.29–1.34 at 4× (predicted +5–15 %: missed), slower in 89/96 paired rounds; 8 mutations caught; by the rule a trade-off at ≤ 0.97 on two sets, an ask then costing a pair; building it is the owner's — `docs/codecs/README.md` §Beside the codec, `lab/av1/decode/inter-slice` |
| 214 | **DISPLAYTAGS** — row 169's net gaps built: the ingest keeps the ICC Profile, VOI LUT Sequence and Presentation LUT Shape, and the painter applies them where a series carries them (COLORTAGS, VOILUT) | done `5e5fa60b` on `claude/av1-unified-mainbase` — counted, then **nothing built: on our sets each tag is absent or redundant**. All 1 044 files of the 83 sound sets streamed, checked against their pins and searched (nested groups included, two identical runs): **ICC Profile and Color Space on none** (the 6 sound RGB sets, 48 files, included); **Presentation LUT Shape on 70 sets (222 files), always `IDENTITY` with MONOCHROME2 and `INVERSE` with MONOCHROME1** — in the DX Image Module it accounts for the photometric interpretation (PS3.3 C.8.11.3.1.2), so the painter's MONOCHROME1 inversion already is it, and applying it again would invert 18 sets; **VOI LUT Sequence on 12 mammography sets (46 objects, 138 items `NORMAL`/`HARDER`/`SOFTER`)**, each object also carrying the same-named SIGMOID window pairs, and each LUT equal to its pair **to 1 code on 0.17–1.5 % of samples** (mispaired: 21–43 codes on 36 %) — below the painter's own fractional-zoom bilinear difference; row 169's "net where present" for G4 and G6 corrected in place. Proposed: *VOIPRESETS*, the viewer offering a series' own window pairs (`HARDER`/`SOFTER` are reachable today only by dragging). Seen on the way: without `client/decode/wasm/built` the dispatch rig's seven `exact:` checks fail instead of skipping (the default hasher is the built `xxh3`); with it, the gate green in 469 s — [`docs/display.md`](../display.md) §Which series carry them, `lab/av1/display_tags.py` |
| 215 | **CLEANAUDIT** — `claude/av1-unified-mainbase` against merge readiness: what is unfinished, untested, broken, dead, duplicated or lab-only in the product, each with keep, finish, simplify, move or remove and the capability it would cost (none allowed); and the simplification rules, drafted for the owner; audit | done `abff875c` on `claude/av1-unified-mainbase` (`0e78cb29`, `7f820b8d`) — audit, nothing changed but its document: **the branch fast-forwards `main` (997 commits) and is functional, but one hole blocks any deployment: the product viewer honours `?opts=`, `?wt=` and `?metadata=` from any link (a module imported, decoder glue run through `new Function` with its pin optional, frames shown exact from another server), and no CSP is sent**. Run here: the gate green (352 s, then 118 s with every prerequisite, one named skip), but a WebSocket test failed 1 run in 12 (a TCP port never checked free, suspected); the decoder builds match their manifest; the deploy images build and serve, and the viewer fills, asks and draws 3/3 exact through them in Chromium 141 and Firefox 157.0.1, `check_equivalence.sh` passing; the viewer check's `--fill 0` fails in both engines (the check, not the page); `lab/av1/requirements.txt` refuses CPython 3.13 and `meson` is an unlisted prerequisite. About 70 items with file:line, a verdict and its cost, none losing a capability: two broken options (`hasher`, a repeated ask), row 189's build in every binary with its arms all at a 38 400-byte window (its build predates `f57700d3`), lab traces in the default binary past the absence check, a rejected read-ahead hook, product steps that need `lab/`, stale docs; the simplification rules drafted for `CLAUDE.md`; 12 rows ranked, VIEWERLOCK first — [`docs/merge-readiness.md`](../merge-readiness.md) |
| 216 | **DOCKERORACLE** — row 195's protocol on the Oracle cloud rig, which only the owner's machine reaches | local |
| 217 | **VIEWERLOCK** — B1: the product page honours only `/wt/dev-transport.json` and `/series/metadata`, the lab levers (`?opts=`, `?wt=`, `?hash=`, `?metadata=`) on the dev host or a lab build alone, and the image sends a CSP; a test shows a crafted link refused | done — merged into `claude/av1-unified-mainbase` as #47 (`48e8ba0e`), 2026-10-14; the review: `claude/wip-217-VIEWERLOCK` `1c6010d9`: **what changed:** the viewer's lab parameters (`?opts=`, `?wt=`/`?hash=`, `?metadata=`, `?post=`, `?origin=`) load from `lab/viewer/levers.js`, which only the dev host serves, so on the web image a link carrying any is refused on the status line before the page fetches, imports or dials anything; `client/viewer/crafted.mjs`, in the gate, refuses 6/6 on a host shaped like the image, honours `?wt=` and `?metadata=` where `lab/` is served, and a plain link dials the transport file's URL — 6/6 fail on today's page, 1/1 with `post` dropped from the guard; nginx sends a CSP on every response (scripts from the origin, `'unsafe-eval'` for the decoders' glue, `connect-src` the origin and `WT_URL`'s, which web now takes), `dev-server.py` the same on the viewer's page with `connect-src` on loopback (its test mutated 2/2); the head's inline script is `client/viewer/head.js`, `/series/metadata` preloaded; `check.mjs` passes no lab parameter and reads the result off the page (Chromium) or Firefox's stdout, its POST collector gone. **Removes:** the levers on any host but the dev host, and the page's inline script. **Capability kept:** every lab harness on the dev host; `check.mjs --url` through the image built from the branch passes in Chromium 141 and Firefox 157.0.1, 3/3 exact, readbacks equal; `check_equivalence.sh` passes, 9 paths hidden and the CSP checked (2 mutations caught); an image whose `connect-src` omits the transport refuses the dial. Gate green, full, its 2 skips not new; +258/−70 over 16 files. Not measured: page open with the head's script a file. `--fill 0` through the image delivers 1/3, as F4 says (row 219) — [`deploy/README.md`](../../deploy/README.md) §Verified, [`client/README.md`](../../client/README.md) §The viewer |
| 218 | **DEADHASHER** — B2: the `hasher` option that never reaches the decoder, and the image's hash-wasm `test -f`, removed; the docs corrected in place | done — merged into `claude/av1-unified-mainbase` as #49 (`8943aca5`), 2026-10-14; the review: `claude/wip-218-DEADHASHER` `55e22272` (one docs-only commit behind the base; rebases clean, gated as rebased): **the `hasher` option and the image's hash-wasm requirement removed, the docs corrected in place**. What changed: `client/decode/xxh3.js`'s `hasher()` takes no argument and its hash-wasm loader is gone (−7 lines), `decoder.js` calls it bare; `deploy/Containerfile` drops `test -f ../vendor/hash-wasm/…`, and `deploy/README.md` the `fetch_xxh3.sh` step; `xxh3.test.mjs` loads hash-wasm itself as its reference; the dispatch rig's AV1 frame check skips on the built `xxh3/xxh3.wasm` the decoder loads, not on the vendor file; `README.md`, `client/README.md`, `deploy/README.md`, `docs/adr/exactness-in-production.md` §10 (*Corrected 2026-10-14*) and `docs/av1/licensing.md` corrected. Removes: `hasher: "hash-wasm"`, which the downloader never forwarded, so it never worked; the image's build-time need for a file no page loads. Capability kept: every frame checked by xxHash's SIMD128 XXH3, held to hash-wasm's digests on 36 lengths and offsets by `xxh3.test.mjs`. Gate green (265 s; two skips, both unrelated: the two ingests compared, the viewer's cross-codec arm and Firefox), with `client/decode/wasm/built/` built and the manifest checked: dispatch 769/769, the viewer check exact, the hasher test ok. Mutated: a chunk stride off by one (6 fail), `vector` 0 (1 fails), a reference the vendor build lacks (the test dies), the rig's predicate on a missing file (the AV1 frame check skips, 769 → 762). §Blocked's 2026-10-14 entry on the gate's browser frame checks proposes the opposite (forward `hasher`); the owner picks one — this row leaves its other half, the viewer check without `built/`, as it was. Not changed: `client/decode/wasm/build/inside.sh` still calls hash-wasm's notice "the frame check's other hasher" (its text is in the manifest; row 223's allow-list decides whether the image carries `vendor/`) |
| 219 | **VIEWERASKS** — B3, B4, B7, F4: no repeated ask, the newest on-demand ask kept, a `--fill 0` check that judges what was asked (run by the gate with `--cine`), and the WebSocket test's port; each fix with a failing test | done `5f556846` on `claude/av1-unified-mainbase` (`390f683b`) — **all four fixed, each test failing without its fix, and a fifth bug found and fixed**: the viewer asks a frame once while its ask is pending (B3), and a step superseded during its cancel asks nothing (B4); the on-demand check, first run, showed the downloader refusing a frame asked again after a cancel ("frame 1 unavailable: frame 1 already requested": the session still owes the cancelled ask), so the downloader now takes that ask over, with a unit test (`anAskAgainAfterACancelIsServed`, 2 failures with the fix reverted); F4: with `--fill 0` the check steps the page itself, judges the frames it asked (3/3 exact, readbacks |Δ| 0) and counts what a repeated step sends, and the gate runs `--cine` and `--fill 0`; mutants caught: the pending-ask guard removed ("sent 2, cancel, 2"), the superseded-step return removed ("held 0, 1, 2"), the old viewer whole (3 failures); B7: the three WebSocket tests take a port free for UDP and TCP and race the server, so a held TCP port fails in 0.16 s with the server's own bind error, and a new test fails if the race ignores the server (5.2 s, "outlived"). Gate green, 267 s, its sources touched in the lock. Seen, not fixed: `check.mjs` picks its server's port at random, unchecked — [`docs/merge-readiness.md`](../merge-readiness.md) B3, B4, B7, F4; [`client/README.md`](../../client/README.md) §The viewer; [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) §The downloader |
| 220 | **INITIALPATCH** — H1: row 189 measured every arm at a 38 400-byte initial window, not today's 12 000; that stated in its cell, and the reply's flag, 117-line quinn-proto patch and tests removed if the owner does not adopt the reply | review — draft PR #41, `claude/project-thread-9jumbi-189` `3054d01b`: **the owner chose the 100 ms initial RTT over the reply, kept as a PR, not merged (2026-10-14)**. What changed: `--initial-rtt-ms` defaults to 100; removes the reply's flag, its 117-line quinn-proto patch and its two tests; capability kept: a lost first flight resent at ~300 ms, by the server's own probe; the new test (a swallowed flight, handshake < 700 ms) failed at 333; the 38 400-byte confound stated in §3 *Measured: INITIALMEASURE* |
| 221 | **LABTRACES** — L1, X1, X2, X3: the congestion traces behind `telemetry`, the absence check widened to them, `crypto-ring` a plain dependency feature, the transport modules `pub(crate)`, `FrameStore::file` behind its `cfg` | done — merged into `claude/av1-unified-mainbase` as #52 (`474068ab`), 2026-10-14; the review: `claude/wip-221-LABTRACES` `702c24b9`: **the congestion traces leave the default binary, and the absence check now sees them**. What changed: `cc_trace` (the `WTPACS_CC_TRACE` / `WTPACS_LOSS_TRACE` wrapper around every controller) compiles only with `telemetry`, so the default server no longer wraps its controller or panics on an unopenable trace path; `check_telemetry_absent.sh` also refuses `transport::cc_trace` and `record::path` symbols and the `WTPACS_CC_TRACE`, `WTPACS_LOSS_TRACE` and `WTPACS_PATH_TELEMETRY` literals (mutated: with the traces put back it fails on 17 `cc_trace` symbol lines, without them it passes); its two lab users build with `--features series-server/telemetry` and refuse a server that opened no trace file (default build: neither file opened, telemetry build: both); `crypto-ring` removed, ring a plain feature of `rustls` and `wtransport`, so `--no-default-features` alone builds the pool path (mutated: ring dropped from both, it fails); the twelve transport modules `pub(crate)` (rustc then flags nothing new); `FrameStore::file` behind `uring` (mutated: the cfg inverted, the default build fails). Removes: 11 `cc_trace` symbols and 2 literals from the default binary, one feature; +43/−34 lines in 14 files, docs corrected in place (`server/README.md` §Lab only, `disk-access.md` §2 and its pool-path note, `transport-conclusions.md`). Capability kept: both traces, unchanged, in a telemetry build. Gate green in full on `702c24b9` (235 s; four skips, each a missing prerequisite: pydicom, lab/.av1-build twice, a GL display), run as one locked unit with this worktree's sources touched first. Seen on the way: the audit's X3 warning does not appear at this tip (`media` is `pub`, so `file()` is never dead); `client/viewer/run_check.sh` runs `target/release/pack-series` whatever `CARGO_TARGET_DIR` says; the gate runs `merge_test.py` when numpy imports, but it also needs xxhash |
| 222 | **INGESTTOOLS** — B6, P1–P5: `default-members`, `ingest/tools.sh` and `ingest/requirements.txt` (3.11–3.13), README's DICOM path working from a fresh clone, `aomenc` for AV1 only, the product tests moved out of `lab/` | done — merged into `claude/av1-unified-mainbase` as #46 (`79b26632`), 2026-10-14; the review: `claude/wip-222-INGESTTOOLS` `2102e1cf`: **the product's steps no longer need `lab/`; a fresh clone builds, ingests a DICOM series and draws it exact**. What changed: `default-members` (the six product crates), so a bare `cargo build` builds on a fresh clone (15.6 s; without it, fails on from-parser's `build.rs`); `ingest/tools.sh` builds libaom 3.15.1 (tarball sha256), dav1d 1.5.4 and OpenJPH 0.31.0 (tag + commit `c68064d`) and `libdecode.so` into `ingest/.build` (4 min 12 s on 4 cores; README lists cmake, ninja, meson 1.9.1, nasm), `lab/av1/tools/tools.sh` calls it into `lab/.av1-build`; the ingest takes OpenJPH from `BUILD/openjph`, `INGEST_BUILD` alone moves from-parser's libraries (`OPENJPH` gone); `ingest/requirements.txt` hash-pinned for CPython 3.11–3.13 (xxhash and blake3 cp312/cp313 wheels added), installed on 3.11.17, 3.12.3 and 3.13.16, the old file refused on 3.13; `lab/av1/requirements.txt` includes it; aomenc checked for AV1 only, and a missing one refused by name rather than a `FileNotFoundError`; `merge_test.py` to `ingest/coded-frames/`, `server_start_test.sh` to `deploy/`, `splits()` inlined; `from_dicom.py` honours `CARGO_TARGET_DIR`. New test (`same_test.py`): a build without libaom codes HTJ2K and refuses AV1 by name, failing under both mutants (aomenc for every codec; never); the moved tests fail under a mutation each. README §The viewer on a DICOM series run from a fresh clone of the branch: a synthetic 6-frame 12-bit CT object to HTJ2K (59 772 B) and AV1 (68 823 B), every frame exact; the viewer check 6/6 exact and drawn for each in Chromium 141. Removes: the lab paths of the two tests, lab's own dav1d and libaom 3.15.1 build (now ingest's), `OPENJPH`; the ingest no longer reads `lab/.openjph-build`. Capability kept: every lab recipe (`lab/.av1-build` gains `openjph/`; 19 lab READMEs drop or point their `build.sh` step). Gate green in 149 s on 3.13 with the ingest's build, one named skip. Pushed with `--force-with-lease` once after a rebase, against the protocol |
| 223 | **IMAGESLIM** — L4, L5, F1: the image serves the page's allow-list only, copies lab crates' `Cargo.toml` and `src/` only, and `check_equivalence.sh --local` runs in the gate | done — merged into `claude/av1-unified-mainbase` as #45 (`c3443d1f`), 2026-10-14; the review: `claude/wip-223-IMAGESLIM` `fd558ae7`: **the web image carries the 34 files of `client/` the viewer loads (1.3 MB), not the 85 it carried; the build copies each lab crate's `Cargo.toml` and `src/`; `check_equivalence.sh --local` runs in the gate**. What changed: `deploy/web-files.sh` lists and copies the page, its modules, the `?check=` pair (`check-page.js`, `paint/reference.js`), the decoder builds with their manifest and hash-wasm (row 218 decides that one), and the Containerfile, `--local`'s root and the stale-image hash all read it; 17 hidden paths, 9 of them `client/` files the page never loads (harness, check pages, a test, `.ts`, `.rs`, `build.sh`, a README); `--local` fixed to run as root (a 0755 root, nginx's `default_type` as in the image); the dead `!lab/telemetry-cost` gone; a gate step, SKIPPED without nginx or the decoder builds. Removes: the harness pages, tests, sources and build scripts from the image (`wt-pacs-web` 95.8 → 94.4 MB). Capability kept: every path the viewer loads equal to `dev-server.py`'s. Verified: both images built; on the gate's grey series `check.mjs --url` through them 3/3 exact in Chromium 141, readbacks equal to the CPU reference; `check_equivalence.sh` passes on the image and with `--local` (nginx 1.24.0); mutated: a root of all of `client/` (9 `OPEN`), `viewer.js` off the list (`DIFF`, no gzip), a changed module, a file put on and one taken off the list (stale, exit 2) each fail; a changed `*.test.mjs` passes. Gate green, 140 s. Seen: `run_check.sh` and `check.mjs` use `target/release` and ignore `CARGO_TARGET_DIR`; the gate's split test needs `xxhash`, not only numpy; the smoke series' frames do not decode (0/3 through the image, as C7 says) — [`deploy/README.md`](../../deploy/README.md) §Verified on that branch |
| 224 | **REJECTEDPATHS** — L2, L3: row 197's rejected read-ahead hook and `followQueue` removed; row 209's `FrameCache` (L8) stays, off by default | done — merged into `claude/av1-unified-mainbase` as #50 (`84de4f07`), 2026-10-14; the review: `claude/wip-224-REJECTEDPATHS` `158a92e5`: what changed — L2: `FillReader::with_read_ahead`, its `ReadAhead` type and test removed from `read_path.rs` (−47 lines), the read-ahead bench reduced to W0/W0aa on the shipped reader (W1–W3, their `Tally`/mmap/`Cursor` code and W1's block test, −225 lines; `readahead.py` and the summary in step, the summary still reads row 197's five-arm rows byte-identically); L3: `followQueue` (retire, park, take back) removed from the downloader (−21 lines) and its test (−43 net), its ask-first clause moved into the `startOnNeed` test (mutated: asks after fill fails it), the total-time harness's flag line gone and `lab/ffportgc`'s `FOLLOW=1` now sets `startOnNeed` (not re-run); docs corrected in place (`ARCHITECTURE.md`, `disk-access.md`, `decode/README.md`, `levers.md`, `MERGE.md`, two lab READMEs). Removes 410 lines, adds 74, and two concepts (a lab hook in the product reader; a pool that retires decoders). Capability kept: the product's fill advice and decoder pool unchanged, `startOnNeed` and row 209's `FrameCache` untouched; both removed paths are at `ba408823` (no tag pushed: the session may push no tag). Checks: gate green, same skips as the base (touched sources, one locked unit), downloader test and the trimmed bench's smoke run exact (360/360 frames, both `--mutate` arms fail, dump 40/40 byte-identical) |
| 225 | **DOCSTRUE** — C1–C10 and H2: every contradiction the audit found corrected in place, `MERGE.md`, `handoff-2026-10-04.md` and `server-design-proposal.md` removed, the final queue brought in at merge | done — merged into `claude/av1-unified-mainbase` as #44 (`445fb167`), 2026-10-14; the review: `claude/wip-225-DOCSTRUE` `591483a3` (on `ba408823`, gate green in 229 s, its skips the host's RWF_NOWAIT, the two ingests' comparison and the viewer's cross-codec arm and Firefox): **C1–C10 corrected in place across 27 files, three docs removed (−797 lines)**. What changed: `docs/av1/MERGE.md`, `docs/handoff-2026-10-04.md` and `docs/server-design-proposal.md` removed — what still holds folded into `docs/merge-readiness.md` §What the branch changes for `main`, R4 one line in ARCHITECTURE §Open (the file at `git show ba408823:`), the handoff's container tips that still hold in README (`check_equivalence.sh --local`'s needs, `server_ab.sh` and `CARGO_TARGET_DIR`); C1 server/README's `Sessions` fields, `LossBound`/`LossClassify`/`Traced` and the full lab lever list, the traces stated as in every build today; C2 both Open sections own their decisions; C5 disk-access §5's `uring` cell; C6 `--initial-rtt-ms 100` not a default, its rule did not pass; C7 deploy/README's container measurement (row 208, on the branch now), the 151-byte smoke bundle that does not decode, TCP 4433 answered only with `--websocket`; C8 client/README's clients, decode table and dav1d notices; C9 `frame_out.rs`, `run.ts`, WIRE's codec-neutral envelope; C10 16 comment lines in 10 product files and the labels in 6 product READMEs named by their measurement. `scripts/check_links.py` now lets another queue's record (`cloud-queue.md`) link a file git history holds, since that file is not ours to edit and links both removed docs; mutated both ways (a never-existing link fails, the history rule off fails on the two links). Removes no capability; kept: every doc's still-true content, every check. **Left for their rows** (corrected only once they land): the viewer's parameter list (217), the hasher lines in client/README and `xxh3.js:5`'s label (218), the traces' telemetry sentence (221), deploy/README's image-contents paragraph (223), `read_path.rs:112`'s label (224). **H2 not done, a merge-time step**: the queue copy it brings must come with `ORCHESTRATE.md` and `mainbase/README.md`, and the link check treat `docs/av1/queue.md` as a record (16 unresolved on a trial copy). Found: the history rule needs full history, so a CI checkout must not be shallow (row 230); `client/viewer/run_check.sh` runs `target/release/pack-series` and ignores `CARGO_TARGET_DIR` |
| 226 | **GATEGAPS** — F2, F3, F5, F6, F7: `cert-compression` checked, the four lab crates compiled and tested, the rigs on the product's decoder, the other session bundles in the absence check, DICOM to `.sbnd` end to end | done `6056e33a` on `claude/av1-unified-mainbase` (`0ae9ab7a`) — additive: **the gate now runs all five, each new step mutated and failing**, green in 289 s with one named skip (the viewer's cross-codec arm and Firefox, as before). F2 `cargo check --features cert-compression` (mutant: a `compile_error!` behind the feature fails it). F3 the four lab crates' tests, 29 in all, `container-bench` compiled for the first time (mutants: its `compile_error!`; `FrameCache::enabled` true at budget 0 fails `zero_budget_caches_nothing`). F5 the undecodable, wire-bytes and frame-check clauses run on the product's build as well as npm's OpenJPH, 11 more checks, the rig 780/780 with `built/` (mutants in `htj2k.js` that touch only a decoder taking its range as it packs: 7 of the build's checks fail, the package's all pass). F6 the absence check reads `ws-session.js` and `race-session.js` too (mutants: a telemetry string in one, a WebTransport patch in the other). F7 `ingest/from-dicom/end_to_end_test.py`: a signed 12-bit CT (3 frames, split k = 2) and an 8-bit RGB (2) through `from_dicom.py` to `.sbnd`, every frame read back out of the bundle and decoded equal to the samples the object was written from, HTJ2K and AV1, 4/4 in 2 s (mutant: frames packed in reverse, 1/3 and 0/2); it found `from_dicom.py` looking for `pack-series` under `target/` alone, now under `CARGO_TARGET_DIR`; and the smoke bundle re-packed and `cmp`ed (mutant: metadata re-serialized, differs at byte 9) — [`docs/merge-readiness.md`](../merge-readiness.md) §7 |
| 227 | **DEDUP** — D1–D8: the duplicated logic the audit lists, each kept in one place | merged 2026-10-16 as #48 (`82bb763a`), refreshed onto unified after #67: all eight kept, −82 lines, one `unsafe` block fewer |
| 228 | **WASMTOLAB** — D9 and P6: the WASM transport and `client/decode/wasm/dav1d/` tooling moved to `lab/`, `dav1d_wrap.c` kept; structural, proposed first | done `34f3f568` — the proposal only, nothing moved: [`CLIENTS.md`](../CLIENTS.md) §Proposed: the WASM client and the dav1d tooling to `lab/`. 832 lines of WASM client to lab/other-clients/wasm/ (own workspace) and 556 of dav1d tooling to lab/av1/dav1d-wasm/, `dav1d_wrap.c` kept; the gate stops needing wasm-pack, the wasm32 target and binaryen, and `Cargo.lock` drops 10 of 240 packages (measured); the cost: it reverses the 2026-09-18 "WASM client required" decision, so the gate no longer holds a second, independent WebTransport client to the clauses. The move awaits the owner's yes (§Blocked). Gate green, 130 s |
| 229 | **REFILLMEASURE** — row 210's head re-issue (`refill=head`, B) on today's path, re-run for a verdict: its two readings split over one 50 % cell (+4 ms, ×1.003) where B never fires, so the split is noise judged as harm. Row 210's T and T + B cells only, from `claude/wip-210-ASKTHENFILLMEASURE` (rig and flag as built), plus **T′, today again**, so "worse" means beyond the A/A spread (row 173's rule) and a cell where B never fires reads as A/A; ≥ 20 Williams rounds, both readings. Rule, set before the data: B becomes the downloader's default if no cell's fill or ask under T + B is worse than T's beyond the T/T′ spread in either reading, and at least one 10 % cell's fill is better beyond it; the 18/300 cell (−273 ms in row 210) is where its gain is largest, so a phone link (row 190's D2) is where it matters | done — merged into `claude/av1-unified-mainbase` as #67 (`1d6cb6dc`), 2026-10-16, the owner's review; draft #66 (`b6d4187c`) — the rule adopts B in both readings (no cell worse, 10 % fill better in 6/7 cells); `refill: "head"` is the default, `"landed"` the old trigger; 24 Williams rounds, resumed at round 13 after a host restart |
| 230 | **CIGATE** — a GitHub Actions workflow that runs every check `scripts/gate.sh` runs, with no skip but those that need a device, plus the deploy image's build and `check_equivalence.sh`, on pull requests into `claude/av1-unified-mainbase` and `main` | done — merged into `claude/av1-unified-mainbase` as #43 (`05eb28cf`), 2026-10-14; the review: `claude/wip-230-CIGATE` `2334d9fc`: **the gate runs green in CI with one skip, and a broken test turns it red**. What changed: `.github/workflows/gate.yml` (new) and README's step 5 naming it; nothing removed, no product file touched (the branch's broken test, `0c9d90e2`, is reverted in `0c458f3d`). Three jobs on `pull_request` into and `push` to `claude/av1-unified-mainbase` and `main`, `permissions: contents: read`, five actions pinned by commit SHA: `decoders` (`build.sh` in Docker, cached on the gate's staleness inputs; it matched `manifest.sha256` on the runner, 2 m 49 s cold); `gate` (`scripts/gate.sh` in full with Rust 1.97.0, Node 22.22.0, CPython 3.11.17 with `lab/av1/requirements.txt`, Go 1.26.0, wasm-pack 0.15.0, Playwright 1.56.1's Chromium and Firefox, `tools.sh aom dav1d` and OpenJPH cached on their scripts, nasm and meson from Ubuntu 24.04's apt — not version-pinned; `GATE OK in 296 s` cold, job 12 m 21 s cold and 4 m 14 s – 4 m 50 s warm; io_uring and `RWF_NOWAIT` ran, nothing skipped for them); the one skip left is listed in the workflow — the viewer's cross-codec arm and Firefox (row INGEST's fetched studies, a GL display) — and any other `SKIPPED` line fails the job (mutated on a log with an extra skip: exit 1); `deploy` (`docker compose build`, `check_equivalence.sh` 10 paths equal, 8 refused, gzip, `Server` with no version; the viewer's page check through the deployment on the gate's grey series: 3/3 exact, drawn; 3 m 06 s – 3 m 33 s). Proof: run 38602429774 at `0c9d90e2` red (`fod`'s `stream_frames_empty_is_the_whole_series`, `GATE FAILED`), run 38603228161 at `0c458f3d` green. Found on the runner: compose's bake asks leave to read the build secret's file (`COMPOSE_BAKE=false`), and the runner's podman, which `check_equivalence.sh` prefers, cannot see docker's images (`RUNTIME=docker`). For whoever lands rows 218, 223 and 226: a gate step that needs a new tool (223's `--local` needs nginx) shows up here as an unlisted skip and turns the job red until the workflow installs it. Capability kept: everything; the gate itself unchanged |
| 231 | **SECCOMPURING** — row 208's rule (c) adopted: the deploy's server runs under `deploy/seccomp-uring.json`, with `memlock` and `nofile` sized as deploy/README's table says, so a container keeps io_uring on a tile miss | done — merged into `claude/av1-unified-mainbase` as #51 (`8bee0300`), 2026-10-14; the review: claude/wip-231-SECCOMPURING 75b0c47d: `deploy/compose.yml` runs the server under `seccomp-uring.json` with `memlock` 64 MiB and `nofile` 65 535 (`MEMLOCK`, `NOFILE` lower them where the daemon cannot raise its limits, as here: the defaults are refused at start); the banner gains `read_ring=available | refused (<why>)`; `seccomp-uring.sh --check` is a gate step (jq a prerequisite); deploy/README corrected in place where it called the profile optional. Removes Docker's default filter for the server; keeps every path (pool fallback unchanged, SELinux half still the owner's). Through the image: `read_ring=available` under the profile, `refused (… Operation not permitted …)` without it (mutation); the 30 `media::` tests 30 of 30 run under it, 7 skip under Docker's default; gate green, run locked with sources touched. Found: the build stage's shared `target` cache mount can ship another checkout's binary (deploy/README §Open) |
| 232 | **PERFCOUNTS** — performance regressions caught by counts, not clocks, on every pull request: disk reads per frame, bytes on the wire per series, asks per frame, each against a committed baseline | done — merged into `claude/av1-unified-mainbase` as #67 (`1d6cb6dc`), 2026-10-16, the owner's review; draft #63 (`2591eb43`) — counts asks, reads and wire bytes in three scenarios against a committed baseline; gate.yml gains `strace` (the owner's OK) |
| 233 | **PERFNIGHTLY** — a scheduled CI job timing the base against the head, interleaved, on the total-time harness; it flags only a difference that repeats, and claims no number beyond that runner | done — merged into `claude/av1-unified-mainbase` as #67 (`1d6cb6dc`), 2026-10-16, the owner's review; draft #68 (`e6a548ca`) — `scripts/perf_nightly.mjs` and `.github/workflows/perf-nightly.yml`, judged by row 173's A/A rule (catches ~1 % here); a schedule fires only from `main` (the owner's call: new CI configuration) |
| 234 | **TARGETDIR** — `client/viewer/run_check.sh`, `client/viewer/check.mjs` and `scripts/wtcompat.py` honour `CARGO_TARGET_DIR`, and `check.mjs` takes a port it knows is free | done — merged into `claude/av1-unified-mainbase` as #67 (`1d6cb6dc`), 2026-10-16, the owner's review; draft #54 (`d328dc0a`) |
| 235 | **BUILDCACHE** — the deploy image's build stage shares one cargo `target` cache across checkouts and shipped a stale server twice (row 231); one checkout's image always carries that checkout's binary | done — merged into `claude/av1-unified-mainbase` as #67 (`1d6cb6dc`), 2026-10-16, the owner's review; draft #64 (`91c0655e`) — each image carries its own checkout's binary; a source edit rebuilds ~5 s slower |
| 236 | **NOWAITPROBE** — a test of what the `RWF_NOWAIT` probe answers: today a probe that always says unsupported passes every test (row 227) | done — merged into `claude/av1-unified-mainbase` as #67 (`1d6cb6dc`), 2026-10-16, the owner's review; draft #58 (`c6aa6ca3`) |
| 238 | **SIMPLIFYAUDIT** — `main` after the merge, read for simplification and improvement: code and docs that can be shorter, plainer or gone without losing a capability, files past the comment budget, duplicated or dead paths, and improvements the measurements already back; each with file:line, a verdict and its cost, then rows 239 on for the non-structural ones and proposals for the structural ones; audit | done — merged into `claude/av1-unified-mainbase` as #67 (`1d6cb6dc`), 2026-10-16, the owner's review; done `21873964` on `claude/wip-238-SIMPLIFYAUDIT` — audit, its document only: 22 findings, none costing a capability; rows 239–246 drafted, ranked by lines saved per risk; CLAUDE.md names `docs/disk-access/adr.md`, which is `docs/adr/disk-access.md` (folded into 243) — [`docs/merge-readiness.md`](../merge-readiness.md) §Second round, draft PR |
| 239 | **SERVERTESTKIT** — `server.rs`'s and `uring_reader.rs`'s tests on one fixture, runtime and `dial`; the missing `--send-window-follows-cwnd` test (S11, S7); ~−200 test lines; brief in [`docs/merge-readiness.md`](../merge-readiness.md) §Second round | done — merged into `claude/av1-unified-mainbase` as #67 (`1d6cb6dc`), 2026-10-16, the owner's review; draft #62 (`3822a030`) — one test fixture, `server.rs` 2277 → 2020 lines; S7 now has a test |
| 240 | **CLASSIFYOUT** — `--congestion cubic-classify` removed and `lab/cc-classify` retired (S18); ~−185; brief in [`docs/merge-readiness.md`](../merge-readiness.md) §Second round | for the owner |
| 241 | **SERVERSTART** — `ServeConfig` derives `clap::Args`, `run_server` and `build_endpoint` simplified, the banner's URLs follow `--bind` (S8–S10, S1); ~−50; brief in [`docs/merge-readiness.md`](../merge-readiness.md) §Second round | done — merged into `claude/av1-unified-mainbase` as #67 (`1d6cb6dc`), 2026-10-16, the owner's review; draft #61 (`29dbe697`) — flags declared once, `run_server` 93 → 44 lines, banner URLs follow `--bind` (B5) |
| 242 | **CLIENTDEDUP** — logic written twice in the downloader, consumer, `FrameSession` and `session.ts` merged (S12–S16); ~−23; brief in [`docs/merge-readiness.md`](../merge-readiness.md) §Second round | done — merged into `claude/av1-unified-mainbase` as #67 (`1d6cb6dc`), 2026-10-16, the owner's review; draft #60 (`4641a7f0`) — net −9 lines, every merged helper mutation-checked |
| 243 | **LEFTOVERS** — dead exports, `dev-transport.json.example`, a lab artifact out of `build.sh`, its esbuild lines, a stale gate skip (S2–S6), and `CLAUDE.md`'s pointer to `docs/adr/disk-access.md`; ~−15; brief in [`docs/merge-readiness.md`](../merge-readiness.md) §Second round | done — merged into `claude/av1-unified-mainbase` as #67 (`1d6cb6dc`), 2026-10-16, the owner's review; draft #59 (`a506dffb`) |
| 244 | **RINGPARK** — the tile reader's ring parks on its own fd, the eventfd gone (S19, S20); structural, the proposal first; brief in [`docs/merge-readiness.md`](../merge-readiness.md) §Second round | done — merged into `claude/av1-unified-mainbase` as #67 (`1d6cb6dc`), 2026-10-16, the owner's review; proposal, draft #56 (`7961ce6f`) |
| 245 | **VIEWERLABOUT** — the total-time harness's hello and result code out of `viewer.js` into `lab/viewer/levers.js` (S17); ~−14 product lines; brief in [`docs/merge-readiness.md`](../merge-readiness.md) §Second round | done — merged into `claude/av1-unified-mainbase` as #67 (`1d6cb6dc`), 2026-10-16, the owner's review; draft #65 (`35ab0d68`) — the product page 12 lines shorter; the harness result fields unchanged |
| 246 | **HARNESSTOLAB** — `client/harness/` to `lab/` (S21); structural, the proposal first; brief in [`docs/merge-readiness.md`](../merge-readiness.md) §Second round | done — merged into `claude/av1-unified-mainbase` as #67 (`1d6cb6dc`), 2026-10-16, the owner's review; proposal, draft #57 (`4214a411`) |

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
  as `1727fb8` on `claude/av1-unified` — all three controllers (`cubic-restart`, BBR, plain Cubic) × both codecs on
  row 60's cells with ±5 ms too, 2 879 of 3 312 visits kept, n = 5–13 an arm and cell, 26 496/26 496 frames exact:
  BBR fills in 0.04–0.74 of Cubic's time under 1–5 % loss and is 1.01–1.04 of it on clean 5 Mbit, so not adopted by
  the round's rule; the restart ties plain Cubic. [`../transport/transport-conclusions.md`](../transport/transport-conclusions.md)
  §1 (LOSSCC, first run). Row 75 is claimed again (`ae32e0`), so this session leaves it as it stands; the claim's
  holder, or the owner, decides whether `1727fb8` closes it or replicates it.

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
queue; it merged without conflict at `71ba8ee`), and push that branch. Findings land on `claude/av1-unified`; only a
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
(`client/decode/wasm/`, created here if row 82 has not; all three moved by `19de3e0`), the AV1 ingest (`lab/av1/item/ingest.py` and what only it
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

**Question.** `client/downloader/` (split by `0ceb8bd`) holds three things — the page side (`consumer.js`), the download worker
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

**Findings (2026-10-08, read at `claude/av1-unified` `afb2402`; paths as of that read).** Grouped by pattern; a count
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
`7d91bd5` as the fullest, 1 281 files), the 37 tags on the remote (row 83 counted 59), and the whole history reachable
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

## The research rows (119–121), 2026-10-10

The owner, 2026-10-10: three questions read before anything is built. Each row is **theory first** (§Protocol): from
primary sources (specifications, peer-reviewed papers, maintainers' source and documentation, operators' published
reports) and this repository's own measurements, it writes the mechanism, predictions and a measurement protocol with
its decision rule, and **builds and times nothing**. A measurement it proposes is listed in its result cell, not
queued; queued later, it is run by a different session given only the protocol and the rule. The outputs are in plain
words, every number keyed to its source (a paper, a standard's clause, a row and its commit), every claim not
measured here marked so. A source the container cannot reach is listed as not read, never cited from memory as read.
**Docs only, so each runs beside row 69:** what is pushed before row 69 describes the merge into `main` goes into that
merge; what lands later goes into the next one. The owning docs are current only on `claude/av1-unified`, so the rows
write there; the queue's cells stay on `claude/av1`.

### 119 CCTHEORY

**Question.** How does the product get BBR's gain on a lossy link without BBR's cost on a clean one? **Why it
matters:** under loss the controller is the clock — 1 % turns a 0.62 s fill at 50 Mbit into 4.0 s and an ask's 153 ms
into 1.5 s, the same for both codecs (row 60). BBR fills in 0.04–0.76 of `cubic-restart`'s time under 1–5 % loss and
cuts `lte-good`'s 5 % ask p95 from ~10 s to 0.7–1.9 s, but costs +2–3 % at 5 Mbit clean, +12–13 % at 50 Mbit with
±20 ms jitter and +70 ms on a clean ask's p50 at 4× (row 75), and its standing queue and neighbour share are measured
(`docs/transport/transport-conclusions.md` §1). Bounding BBR failed: BB2 and BBF retired, v3's loss bound failed its
rule (rows 103, 104, 107; §1 *The bound, measured* and *reviewed*). The default stays `cubic-restart` until the loss mix
is known (§1, §9 item 2). **Do:** survey, from sources, each way out and what it would cost here:
* *Telling radio loss from congestion loss* — loss with and without RTT growth, ECN marks, delay-gradient signals;
  how accurate published classifiers are on cellular and Wi-Fi traces, and what a wrong call costs each way (§1's 63 %
  against 48 %).
* *Choosing the controller per connection* from a characterization of the link — at connection start from the
  client's history, or after the first round trips — and *switching mid-connection*: in quinn (the version the server
  pins, read from its source) a wrapper `Controller` that delegates, what state must carry across a switch (window,
  slow-start threshold, min RTT, bandwidth estimate, recovery epoch, pacing rate) and what breaks if it does not.
* *Where BBR's clean-link cost comes from* — startup and drain, PROBE_RTT, the pacing gain's cycle, the standing
  queue — attributed to row 75's three cost cells where the data allows, and whether a variant removes it: BBRv3 as
  deployed (the IETF CCWG draft and its deployment notes), Copa, PCC Vivace, cellular designs (Sprout, Verus and their
  successors), CUBIC with HyStart++ (RFC 9406; quinn's Cubic has none, §1) and loss-tolerant variants.
* *Forward error correction for QUIC* as an alternative to reacting to loss — the IETF drafts (coding for QUIC,
  FlEC and others), their measured results, the overhead on a clean link, and what it does to an ask's tail.
* *What large deployments report on mobile* — Google and YouTube's BBR, Meta, Akamai, Cloudflare, academic
  measurement studies — read for the regime each measured, since §1's lesson is that a result read outside its loss
  regime flips.
Rank the options by expected gain on the target (mobile, lossy wireless; the lossless fill and the on-demand ask both
count), each with its mechanism, sources, cost on a clean link, implementation size in quinn, risks (the neighbour's
share included) and the measurement that decides it. The real loss mix of the target links is unmeasured and is the
deciding fact (§1, §9 item 2): propose how to get it (client telemetry of the RTT trend before each loss, public
cellular traces and their licences, a field pilot) and what each source can and cannot tell. Then, for the top
options, proposed measurement rows with predictions per cell and a decision rule each, stated before any data.
**Deliverable:** a section in `docs/transport/transport-conclusions.md` §1 (extended, not a new file) and its §9
item 2 pointing at it; the proposed rows and their rules in the result cell, none queued. **Branch:**
`claude/av1-unified`.

### 120 ORDERNEED

**Question.** Do readers need some frames first, and is a reordered fill worth a deeper look? **Why it matters:**
row 65 measured that asking the "useful" frames first — a DBT volume's centre slice ±2, a four-view mammogram's MLO
pair — puts them on screen in 0.30–0.52 and 0.47–0.77 of the in-order fill's time, for +72–113 ms on the whole fill
(`docs/av1/README.md` §The order frames are asked in). Nothing was adopted, and "useful" was our choice: the slice a
reader starts on is that measurement's premise, not a measured reading pattern. It is a real trade: readers often
scroll from the first frame through the stack to place themselves in space or time, which the in-order fill already
serves, and a reordered fill delays that first frame by the frames asked before it. **Do:** a small, bounded reading
of primary sources: reading-behaviour and eye-tracking studies of DBT, mammography, CT stack and ultrasound cine
reading (for example the "scanners and drillers" CT study, Drew et al. 2013, and DBT against FFDM eye tracking,
Aizenman et al. 2017 — leads to verify, not conclusions), hanging protocols (DICOM PS3.3 Hanging Protocols), IHE's
Mammography Image and Digital Breast Tomosynthesis profiles: where readers start, how they navigate, how soon they
jump. First, before the estimate, commit the decision rule alone: below what expected gain in time to the reader's
first useful view the idea is dropped, above what it earns a measurement row, and how the cost to a reader who starts
at the first frame counts. Then, per target series type ([`series.md`](series.md): DBT slices, FFDM and synthesized
2D, breast ultrasound cine, ABUS; other cine secondary), estimate the probability that the first view is in a
reordered set, the gain from row 65's ratios and the cost to the reader who starts at frame 1, and apply the rule.
**Deliverable:** a short section in `docs/av1/README.md` §The order frames are asked in (extended, not a new file),
`docs/ARCHITECTURE.md` §The first fill corrected in place if the verdict changes what it says; the verdict in the
result cell: drop, or a proposed measurement row with its predictions and rule, not queued. **Branch:**
`claude/av1-unified`.

### 121 DATAAUDIT

**Question.** Which verdicts rest on data that cannot be trusted, and which must be re-run? **Why it matters:** row
94 classed every set's provenance (sound, lossless-but-unrepresentative, lossy-sourced, unknown;
[`../FIXTURES.md`](../FIXTURES.md) §Provenance) and made sound data the only kind that decides; row 98 re-scoped the
frame-group evidence and listed 17 closed rows resting on off-taxonomy content or thin sampling (its brief, above). No
one has yet read every verdict against both. **Do:** for every closed row 1–118: the data sets its verdict used, their
provenance class (`lab/av1/data.json`), and whether the verdict depends on lossy-sourced, unknown, off-taxonomy or
thinly sampled data — n, the `VOID` share, host noise, one encoder or preset, a few frames. Class each affected
verdict by how critical the decision it feeds is (a product default, the codec choice, frame groups for AV1,
ultrasound handling, a transport default, a lab-only reading). For the critical ones: the sound data that would
settle it (modality, bit depth, vendor, series size, licence — CC BY or alike; CC BY-NC is not usable, §Blocked row
94), where it could come from (CC BY public sets not yet fetched, named; or the owner's options under §Blocked: a
partner's native DICOM under a data use agreement, phantom scans on real scanners), and which rows' methodology
would be re-run on it. Name as its own case **frame groups for AV1 on truly lossless cine — breast ultrasound, ABUS,
angiography**, which the owner wants settled on sound data (rows 99–101; row 100's §Blocked line gives the minimum: two
independent sources of two series each). **Deliverable:** the verdict table in `docs/FIXTURES.md` §Provenance
(extended, not a new file), a pointer from `docs/av1/README.md` §Content; the result cell lists the re-run rows
proposed, nothing queued. **Branch:** `claude/av1-unified`.

## The owner's design rows (122–128), 2026-10-10

The owner, 2026-10-10. Every row here is **theory first** and builds and times nothing, under the same rules as
rows 119–121 (their preamble above): primary sources, every number keyed to its source, a source the container cannot
reach listed as not read, measurements proposed in the result cell and not queued. **Read before writing:** what this
repository already did on the subject (the rows each brief names, and `git log` / `git grep` on `claude/av1-unified`),
so nothing measured or designed is proposed again; a brief that turns out to repeat closed work says so in its cell and
narrows to what is left. Two of the owner's criteria apply to every proposal these rows make: an idea that helps only
under some link conditions must show that the condition is common on the target, that it works there, and that it
costs little elsewhere, or be switched on only where the condition is detected; and nothing is measured without its
theory written first. Docs only, on `claude/av1-unified`; cells on `claude/av1`.

### 122 HASHWHY

**Question.** Is a 64-bit non-cryptographic hash enough to prove a shown frame exact, and is XXH3-64 the right one?
**Why it matters:** the owner wants the decision formalized with outside evidence so a team understands it, not taken
on this repository's word. [`../adr/exactness-in-production.md`](../adr/exactness-in-production.md) §2 already gives
the argument (a random fault is missed one time in 2⁶⁴; a hostile server sends a matching digest over the same
authenticated session, so a cryptographic hash buys nothing there) and §3 the cost (row 73: XXH3 ≈ 4 000 MB/s, BLAKE3
≈ 570, SHA-256 ≈ 250 in a browser worker; a checked fill ×1.00–1.15 with XXH3, ×1.15–1.51 with BLAKE3). **Do:** back
or correct each step from sources:
* *The threat model.* What the check guards against (decoder, build, engine and memory faults; storage and cache
  damage) against what it cannot (a hostile server; that needs signatures over the digests from a key the client
  trusts, a different design, sketched in a paragraph with its cost, not proposed). QUIC's per-packet AEAD (RFC 9001)
  and what it already covers on the wire.
* *The probability.* The chance a random change passes a 64-bit digest, assuming the hash's output behaves as random
  for such inputs; why the birthday bound does not apply (each frame is compared with its own expected digest, not
  with every other frame); the expected number of misses at a realistic national volume of frames per year, with the
  volume's source.
* *The hash's quality.* XXH3's results in SMHasher and its successors, its specification and maintainers' notes;
  known weaknesses (seed-independent collisions, crafted inputs) and why they need an adversary.
* *Precedent.* Systems that chose a fast non-cryptographic checksum for integrity and kept cryptographic hashes for
  deduplication or tamper evidence: file systems (Btrfs's `xxhash`, ZFS's `fletcher4` beside `sha256`/`blake3`),
  storage engines (RocksDB's checksum types), compression formats (zstd's and LZ4's frame checksums); each read from
  its documentation, with what it says about the choice.
* *Alternatives*, one line each with speed and guarantee: CRC-32C and CRC-64 (burst guarantees; no hardware CRC in
  WASM), XXH3-128, BLAKE3, SHA-256 through WebCrypto (hardware SHA on the host, and the copy row 73 measured),
  rapidhash/wyhash. Whether any beats XXH3-64 for this job, and what a 128-bit digest would cost in metadata.
**Deliverable:** a section in the ADR, *Why XXH3-64: the sources* (extended, not a new file), opening with an
abstract of at most ten lines in plain words that the owner can share with a team as it stands; §2's paragraph points
at it. **Branch:** `claude/av1-unified`.

### 123 MISMATCH

**Question.** What exactly happens after a mismatch, and is it enough? **Why it matters:** row 73's ADR (§2.3, §4,
§5) and row 88's build already decode a mismatch once more on the other path and deliver the frame marked `false`;
the owner, 2026-10-10, wants the response checked as a whole. Left open by them: block against mark (§6, the owner's),
the page's display of a failed frame, reporting (§5, not built), phones, and a frame inside a group (G > 1) that has no
recovery. A client cache adds a case the ADR does not weigh: stored coded bytes damaged on the device, where asking the
server again *does* help (§2.3's "asking again does not help" holds for the wire only). **Do:** from sources and the
code:
* *Locating the fault.* Whether a second digest over each frame's coded bytes (written at ingest beside the samples')
  separates storage or cache damage (fetch again) from a decoder's fault (decode on the other path), what it costs at
  ingest and in the client, and whether QUIC's AEAD and the server's own reads make it redundant without a cache.
* *Never cache an unverified frame*, and what a cache must store to be re-checked on read.
* *Block or mark.* What the practice parameters and standards say about showing an image whose integrity is not
  verified: DICOM's Lossy Image Compression attribute and its display requirement, the ACR–AAPM–SIIM practice
  parameters for electronic practice and display, IEC 62304 / IEC 82304-1 and ISO 14971 hazard framing, FDA guidance on
  device software functions; what open viewers and PACS do on a decode failure (OHIF/Cornerstone3D, dcm4chee, Orthanc,
  from their code or docs). The options for the owner with what each means for a reader.
* *Reporting.* §5's design against privacy (no patient data), the denominator, and how a field failure rate turns a
  decoder path off per engine.
* *G > 1.* What a group's frame needs to recover (the group decoded again on the other path) and its cost.
**Deliverable:** a section in the ADR, *After a mismatch* (extended), its open choices listed for the owner under
§Blocked; proposed measurement or build rows in the result cell, none queued. **Branch:** `claude/av1-unified`.

### 124 QUICSURVEY

**Question.** Which QUIC implementation should a native client use, on desktop first and phones in the end? **Why it
matters:** the owner, 2026-10-10, wants a native version of the viewer, not a web page and not WebTransport; the
browser's QUIC stack bounds today's receive rate and its choices (row 104's receiver-bound cells,
`docs/transport/transport-conclusions.md`), and a native client picks its own. The owner wants **every finding and to
take every decision**: the row reports and compares, it does not choose. The same choice may serve the link from a
site's ingest to the server (row 126), so read each candidate for that use too. **Do:** for every implementation that
could run in a desktop client (Linux, macOS, Windows) and a phone client (Android, iOS), in any language — at least
quinn, s2n-quic, Cloudflare quiche, Google's QUICHE (and Cronet as Android's packaged form), msquic, ngtcp2, lsquic,
picoquic, mvfst, quic-go, neqo, tquic, xquic, Apple's Network.framework — record from sources:
* *Speed:* published throughput and CPU per byte at the target's rates, receive-side cost (the papers measuring QUIC
  stacks against each other and against TCP — for example Yu & Benson 2021, Jaeger et al. 2023, Zhang et al. 2024;
  leads to verify), GSO/GRO, pacing, ECN, the interop runner's goodput and loss cases.
* *Control:* congestion controllers shipped and whether one can be plugged in (row 119's options need a controller
  of our own), loss recovery's knobs (initial RTT, PTO), flow-control windows, stream priorities, datagrams.
* *Mobility:* connection migration, multipath QUIC (the IETF draft) and who ships it, 0-RTT, behaviour on network
  change and in the background on each phone OS.
* *Building and shipping:* language and FFI cost from Rust, Swift and Kotlin, threading model, binary size on a
  phone, build on each platform, maturity (deployments, release cadence, security record), licence against this
  repository's MIT.
* *Talking to our server:* WebTransport over HTTP/3 from a native client, or raw QUIC with our own framing beside the
  WebTransport endpoint (an ALPN of its own), and what each means for the server.
A table of candidates by these columns, every cell sourced or marked unknown; the findings in plain words; the
decisions the owner faces, each with its options and what decides it; for the owner's picks, proposed desktop
measurement rows (cloud containers first, so they run unattended) with predictions and rules. **Deliverable:** a new
`docs/native/quic.md` (the subject is new), the owner's decisions under §Blocked. **Branch:** `claude/av1-unified`.

### 125 DECODEOPT

**Question.** How much faster can today's codecs decode, in the browser and natively, before anything new is tried?
**Why it matters:** decode is the client's other clock beside the wire; the owner, 2026-10-10, wants the codecs we
have optimized before any new one is explored. Much is done — read first `docs/decode/README.md`,
`docs/decode/levers-protocol.md` (L1–L5: the code-block pool, region decode and stripes, the coarse pool, the WebGPU
HT block decoder, paced decode; rows 108–113 and row 113's review), rows 9, 11 and 78 — and propose none of it again.
**Do:** from sources and the decoders' code, what is left:
* *HTJ2K decode time from the stored layout:* what the encoder's choices cost the decoder — decomposition levels,
  code-block size and shape, precincts and tiles (row 113's re-encode question), HT-only coding, markers that let a
  decoder skip (PLT, TLM) — each with the bytes it costs.
* *SIMD and hardware in the browser:* whether the shipped OpenJPH and dav1d WASM builds use SIMD128, what relaxed SIMD
  and wider vectors would add, how much of each decoder's native SIMD path a WASM build can reuse; what hardware a page
  can reach (WebGPU, row 111's decoder; WebCodecs' hardware AV1 and whether it is ever exact for our streams, rows 29
  and 80).
* *Natively:* the same decoders with their native SIMD and threads, the gap to WASM from published numbers, GPU
  HTJ2K decoders (vendors' libraries, papers), phone AV1 hardware and exactness (row 29) — input to row 127.
* *Decode matched to arrival, and arrival to decode:* after L5 (decode paced to the wire; its saving was the start of
  two unused decoders), what is left — decoders started on first need and stopped when idle, and backpressure when the
  coded queue grows (it reached ~570 MB on tomosynthesis in the lab's notes; find the source) so a slow decoder slows
  the wire instead of filling memory.
* *Other lossless codecs as options only*, one line each with the claim and its source, not explored: JPEG-LS in
  WASM, Tomoz, TCT.
Rank what is left by expected gain on the target (phones; the fill and the ask both count), each with its mechanism,
sources and the measurement that decides it. **Deliverable:** a section in `docs/decode/README.md`, *Not yet tried*
(extended, not a new file); proposed rows with predictions and rules in the result cell, none queued. **Branch:**
`claude/av1-unified`.

### 126 INGESTPLAN

**Question.** How should the product's ingest be built? **Why it matters:** the owner, 2026-10-07 and 10-10: ingest
runs at the site, not beside the server; it parses the DICOM with the C parser `DICMele2deck`
(a public C repository; read it only if its name is in this repository already, else list it as not read; Part 10, explicit little endian only), encodes the frames itself exactly and
checked, and sends the bundles to the server. The reasons for a compiled ingest are integration, one deployable
binary, one definition of the store's format shared with the server, and streaming memory — not CPU: the encoders
take ~99 % of ingest time. Today: read `ingest/` and the docs that own it on `claude/av1-unified`. **Do:**
* *Language, weighed both ways:* Rust against C++ — calling the C parser, OpenJPH (C++: a C shim from Rust), libaom
  and SVT-AV1 (C), the bundle format's single definition (Rust today, shared with the server), the link to the server
  (quinn, the server's QUIC, against a C++ stack), the team's languages; the owner leans neither way yet.
* *The parser's integration in stages:* first encode the files the parser writes (its extra write and read measured
  against encode time, on tmpfs), then — only if that share matters — a pipe or the parser linked as a library; what
  each needs from the parser's code and its licence (none shown in the repository: a blocker to settle).
* *Exactness:* the check ported (digests over the encoder's input samples, as `ingest/coded-frames/ingest.py`
  writes them), and the Python ingest kept as the reference until the new one reproduces its bundles byte for byte and
  is stable, correct and optimized.
* *The link from the site to the server:* bulk upload over QUIC (row 124's findings when they land; Thruflux,
  github.com/samsungplay/Thruflux, C++ MIT, parallel QUIC streams, read for its ideas and whether its code is reusable),
  against what the server already speaks.
* *Deployment:* one binary at the site, what it needs there, updates.
**Deliverable:** the plan in the doc that owns ingest on `claude/av1-unified` (a new `docs/ingest.md` only if none
does), the owner's decisions under §Blocked. **Branch:** `claude/av1-unified`.

### 127 NATIVEPLAN

**Question.** What else does a native version need, and how is it measured? **Why it matters:** the owner,
2026-10-10: desktop is the first target because it is easier to start there; phones are the goal. Rows 124 and 125
cover transport and decode. **Do:** from sources:
* *Paint and cache:* native GPU (Metal, Vulkan, Direct3D; wgpu across them) for 16-bit grey with window/level, and the
  file system in place of the browser's storage.
* *App shape:* one shared core (transport, decode, cache, exactness) with a thin interface per platform, or a
  cross-platform framework; what each costs to build and to keep.
* *Costs:* app stores and updates, the team's skills, medical-device rules where an app differs from a page.
* *The measurement plan:* native against the browser on the same machine, for fill time and the ask's latency;
  desktop first, in cloud containers first so the investigation runs unattended, then a desktop with a GPU, then
  phones; predictions and rules for the first rows.
**Deliverable:** `docs/native/README.md` (the plan, pointing at `quic.md`), decisions under §Blocked. **Branch:**
`claude/av1-unified`.

### 128 H3FETCH

**Question.** How would plain HTTP/3 `fetch()` do against WebTransport for the fill and the ask? **Why it matters:**
it is the simplest alternative and was never measured or reasoned through here. **Do:** read
`docs/transport/delivery-prior-art.md` and `transport-conclusions.md` first. Then, from the browsers' network stacks
and the specifications: what changes when frames come as HTTP/3 responses (one request per frame or a range of frames,
the browser's connection and stream limits, priorities, flow-control windows, HTTP caching, cancellation of an ask
that is no longer needed, CORS and preflight, Firefox and Safari), what stays the same (the same QUIC stack and its
receive bound), and what the server would need. Predictions per link and series, and a protocol with its rule.
**Deliverable:** a section in `docs/transport/delivery-prior-art.md` (extended); the proposed row in the result cell,
not queued. **Branch:** `claude/av1-unified`.

## The next rows (129–136), 2026-10-10 evening

The owner, 2026-10-10: usage is plentiful, so the cloud keeps working. Rows 129–131 are **theory first** under the
preamble of rows 119–121 and the criteria of rows 122–128 (an idea that helps only under some link conditions shows
the condition is common on the target, that it works there and that it costs little elsewhere, or is switched on only
where detected). Rows 132–136 are **measurements** of protocols already written: the session reads only the named
protocol and its rule (not the reasoning around it), runs it with arms interleaved and differing in the lever alone
(§Protocol), reports the numbers and whether each prediction held, and leaves the verdict's review to a later row.
Nothing here changes a product default. Docs on `claude/av1-unified`, cells on `claude/av1`.

### 129 WTCOMPAT

**Question.** Will a browser update break the server? WebTransport over HTTP/3 is an IETF draft; each engine speaks
one draft version and the server another (`docs/transport/upstream-wtransport-settings.md`; row 124 read the server as
draft-02). Newer drafts lean on QUIC's `reset_stream_at` (draft-ietf-quic-reliable-stream-reset) so a cancelled
stream still delivers its header. **Do:** from each engine's source and release notes: which draft and SETTINGS
Chromium (stable, beta, canary), Firefox (release, nightly) and Safari speak, when each plans to move, whether
`reset_stream_at` is negotiated or required, and what the server does with each today. Then build a check that dials
the server from the newest available Chromium and Firefox builds in a container and fails loudly on a draft or
`reset_stream_at` mismatch (mutated to prove it fails), runnable by hand or on a schedule. **Deliverable:** a section
in `docs/transport/transport-conclusions.md` (extended), the check under `scripts/` with a line in its README; what
the server would need to follow a newer draft, proposed, not built. **Branch:** `claude/av1-unified`.

### 130 INITRTT

**Question.** Should the server assume a 100 ms round trip before it has measured one? quinn's default initial RTT is
333 ms (RFC 9002 §6.2.2), so a lost first flight waits ~1 s; Chromium's own QUIC assumes 100 ms. A lab reading puts
the slowest 1 % of first opens from 1 335 to 638 ms at 1 % loss (find its source in the repository and cite it, or say
it has none). **Do:** the mechanism (PTO before any sample, the server's Initial and Handshake flights, amplification
limit), the cost on links slower than 100 ms (spurious resends of the first flight: bytes, and whether they disturb
the controller), how often target links exceed 100 ms, what deployed stacks choose and why; predictions per link and
a protocol with its rule. **Deliverable:** a section in `docs/transport/transport-conclusions.md` (extended); the
proposed row in the result cell. **Branch:** `claude/av1-unified`.

### 131 TAILDUP

**Question.** Is sending a frame's last packets twice worth it? A lost tail packet can be detected only by a timer
(PTO) unless later packets follow; during a fill the next frames' packets detect it within a packet threshold, so the
tail matters most for an ask on an idle connection and for a burst's last frames. **Do:** from QUIC's loss detection
(RFC 9002), quinn's code and the literature on tail loss (TCP's TLP and RACK, QUIC tail-loss studies, FEC on tails):
the share of frames whose loss falls where only a timer recovers it, per loss rate and frame size; the gain on an ask's
p95/p99 at the target links (row 60's loss numbers); the cost on a clean link (bytes, the controller seeing
duplicates); a version switched on only where loss is detected. Apply the owner's criteria explicitly. **Deliverable:**
a section in `docs/transport/transport-conclusions.md` (extended); drop or a proposed row with predictions and a rule.
**Branch:** `claude/av1-unified`.

### 132 CCATTRIB

Row 119's R1, as written in `docs/transport/transport-conclusions.md` §1 *The way out, surveyed*. Read that protocol
and rule only. **Deliverable:** the numbers and each prediction's outcome beside the protocol; whether row 75's clean
cells must be re-read. **Branch:** `claude/av1-unified`.

### 133 TILEMEASURE

Row 125's P-TILE, as written in `docs/decode/README.md` §Not yet tried. Read that protocol and rule only; exactness
against the encoder's input for every frame. **Deliverable:** numbers and predictions' outcomes beside the protocol.
**Branch:** `claude/av1-unified`.

### 134 EMSDKMEASURE

Row 125's P-EMSDK and P-COPY, as written in `docs/decode/README.md` §Not yet tried; the delivered decoder build is not
replaced. **Deliverable:** as row 133. **Branch:** `claude/av1-unified`.

### 135 RECVCOST

Row 124's first measurement (receive CPU per byte per client stack), as written in `docs/native/quic.md`; desktop, in
this container; the host's saturation point stated and nothing claimed past it. **Deliverable:** as row 133.
**Branch:** `claude/av1-unified`.

### 136 INGESTPROFILE

Row 126's P-PROFILE, as written in `docs/FIXTURES.md` §A compiled ingest at the site. **Deliverable:** as row 133; the
"~99 % encode" claim corrected in place wherever it stands. **Branch:** `claude/av1-unified`.

## The overnight rows (137–143), 2026-10-11

The owner, 2026-10-10 night: schedule every row that needs no decision of theirs. Same rules as rows 129–136: theory
rows build and time nothing; measurement rows read only the named protocol and its rule; one question per row; nothing
changes a product default. Docs on `claude/av1-unified`, cells on `claude/av1`.

### 137 NETPROBE

**Question.** Are the data hosts still refused, and by what? Rows 2 and 35 (2026-10-03/04) found `zenodo.org`,
`www.cancerimagingarchive.net`, `physionet.org`, `data.mendeley.com`, `grand-challenge.org` and others refused with
CONNECT 403 ("organization policy"); the owner reports the environment now has full network access. **Do:** from this
container, for every host listed under §Blocked rows 10, 21, 35 and 100 plus `figshare.com`, `huggingface.co`,
`www.kaggle.com`, `osf.io`: DNS, a HEAD over HTTPS through whatever proxy the container uses, the status and the
proxy's own message (verbatim), UTC time; the proxy's identity and environment variables (names only, no secrets).
Then read, without downloading data, each candidate lossless dataset's landing page and licence (CADICA, ARCADE,
TDSC-ABUS 2023, Breast-Lesions-USG, and any multi-frame breast ultrasound or XA set found): format, whether native
frames are stored uncompressed or losslessly, size, licence verbatim, access terms (open, on request, data use
agreement). Fetch nothing. **Deliverable:** a table in `docs/FIXTURES.md` §Provenance (extended); §Blocked rows 10,
21, 35 and 100 updated in place with what is now reachable; the licence question is the owner's. **Branch:**
`claude/av1-unified`.

### 138 CROSSRERUN

Row 106's protocol (row 105's model; `docs/av1/README.md` §Where AV1 fills first) re-run as row 121 proposed: whole
volumes, Firefox included now that row 115 fixed its dial, strict and round-paired readings both where the host voids
past its bar (§Protocol). Read the protocol and its rule only. **Deliverable:** numbers and each prediction's outcome
beside the protocol; whether row 107's verdict stands. **Branch:** `claude/av1-unified`.

### 139 IRTTMEASURE

Row 130's IRTTMEASURE, as written in `docs/transport/transport-conclusions.md`. **Deliverable:** numbers and
predictions' outcomes beside the protocol, and whether its adoption rule passes; the default is not changed by this
row. **Branch:** `claude/av1-unified`.

### 140 CCREVIEW

The short review closing R1: row 132's numbers against row 119's predictions and R1's rule, conclusive or not, why,
and what follows for the default (`cubic-restart`) and for R3's cells. **Deliverable:** a paragraph in
`docs/transport/transport-conclusions.md` §1 R1. **Branch:** `claude/av1-unified`.

### 141 LOSSCLASS

Row 119's R2, as written in `docs/transport/transport-conclusions.md` §1 *The way out, surveyed*. **Deliverable:**
numbers and predictions' outcomes beside the protocol. **Branch:** `claude/av1-unified`.

### 142 STARTMEASURE

Row 125's P-START, as written in `docs/decode/README.md` §Not yet tried. **Deliverable:** numbers and predictions'
outcomes beside the protocol. **Branch:** `claude/av1-unified`.

### 143 TILEDESIGN

**The owner's rule (2026-10-10):** every series over 12 bits that is not a volume or 3D view — breast or not; the
product serves whatever a radiologist reads, breast is only the next phase — is served at the resolution that fits the
client's screen, plus tiles for zoomed regions; volumes and 3D views keep their own path, HTJ2K only for now; series
at 12 bits or less are filled. **Question.** What store, wire and client does that rule need? Row 133 measured tiles
stored as independent codestreams: +0.01–0.59 % bytes, three tiles on three idle workers ×0.388–0.448 of the whole
frame's ask at 4×. **Do:** write the rule into `docs/adr/resolution-fitting-for-large-frames.md` (extended, the rule
quoted with its date); then propose, without building: the store's layout for a tiled series (tiles as independent
codestreams against precincts with PLT inside one codestream, which needs a decoder that decodes by region — OpenJPH
does not, rows 109 and 113), how the fitting level and the tiles are asked on the wire, whether the client needs a
different decoder build or the same one with more workers, how idle decoders are used (row 113's L2 and row 133), how
"fits the screen" is counted (device or CSS pixels: the owner's choice, both costed), and the 12-bit-and-under series
whose frames are still large (12-bit mammograms: fill time per link from rows 95–96) as a case for the owner. List the
series types outside the breast family it covers (CT, MR, CR/DX, XA, from `docs/av1/series.md` and DICOM).
**Deliverable:** the ADR extended; the owner's decisions under §Blocked; proposed rows, none queued. **Branch:**
`claude/av1-unified`.

### 144 FFPORTGC

**A defect, found 2026-10-11 in the reference implementation's client, which shares this design.** Firefox does not
copy a message that carries a `SharedArrayBuffer`: it stores it in a process-wide table under the *sending* port's
uuid, a transferred port keeps that uuid, and when any `MessagePort` object with that uuid is destroyed Firefox deletes
every message stored under it (`dom/ipc/RefMessageBodyService.cpp`, `dom/messagechannel/SharedMessageBody.cpp`,
`dom/messagechannel/MessagePort.cpp`: `~MessagePort → CloseForced → ForgetPort(uuid)`). Here `spawn()` in
`client/transport/downloader.js` creates a `MessageChannel`, transfers `ch.port1` to the decoder and keeps no reference
to the neutered copy; when the downloader's garbage collector reclaims it during a fill, frames still in flight to the
page are deleted and the page gets `messageerror` (no index), while the decoder has already posted `done` — the frame
is lost silently. There it took 237-frame fills to 206–232 frames in Firefox 157 in 7/7 runs, and 237/237 in 9/9 once
the downloader held `port1`. `followQueue`, which spawns and retires decoders, leaves more such ports. **Do:** hold each
decoder's `port1` on its record for the decoder's life (one line and a pointer to the owning doc); a Node test that
drops the stub decoders' copies, runs `gc()` and asserts the ports are still alive (fails without the fix, mutated);
then a Firefox run through `client/contract/drive_firefox.mjs` on a fill large enough to hit it (a 200+ frame series),
before and after. Also report, without fixing, whether this client can still lose a frame silently the other ways the
reference found: a `messageerror` with no index and no handler, a decoder worker crash with no `onerror`, a decode that
never returns (no fill deadline). **Deliverable:** the fix, the test, the Firefox before/after in the client doc that
owns the downloader; the three silent-loss answers in the result cell. **Branch:** `claude/av1-unified`.

### 145 FAULTBENCH

Row 123's proposed fault-injection bench, as written in `docs/adr/exactness-in-production.md` §8: for each decoder path
(HTJ2K, dav1d-WASM, WebCodecs) and engine available in the container (Chromium, Firefox), inject a wrong sample, a
truncated frame and a decoder that never answers, and record what the check, the second decode and the page do — the
evidence the owner's block-or-mark choice needs. Changes no product code; the injection lives in the test harness.
**Deliverable:** the table beside §8. **Branch:** `claude/av1-unified`.

### 146 LOSSIGNORE

Row 119's R3, as written in `docs/transport/transport-conclusions.md` §1 *The way out, surveyed*, run only if row
141's R2 result meets R2's go-on bar (≤ 5 % / ≤ 30 %); otherwise the row closes saying so. **Deliverable:** numbers
and predictions' outcomes beside the protocol. **Branch:** `claude/av1-unified`.

### 147 FRAMELOSS

**The three silent losses rows 144 and 145 left open, closed (the owner, 2026-10-11).** Row 144 fixed the transferred
port; its cell and row 145's bench found three more ways a frame vanishes with no error and no retry: (1) a decoder
worker that crashes — no `onerror` on decoder workers, its frames stay `decoding` and its slots are taken for good;
(2) a delivery the page cannot read — the pixel port has no `onmessageerror`, the event carries no index, and the
downloader has already forgotten the frame on `done`; (3) a decode that never returns — no decode deadline, the stall
watch reads the wire alone, so the frame waits for ever and so does every frame queued behind it on that decoder.
**Do**, in `client/transport/downloader.js` and the page's consumer:

* *Crash:* `onerror` and `onmessageerror` on every decoder worker; the worker is terminated, a fresh decoder spawned in
  its place, and its in-flight frames re-queued with an attempt count.
* *Delivery:* the downloader forgets a frame only when the page acknowledges its index (the ack rides the existing
  control channel; it carries the index and generation). A `messageerror` on the pixel port, or a frame still
  unacknowledged when its decoder is retired, re-decodes the unacknowledged frames.
* *Hang:* a per-decode deadline, one named constant whose value and reason live in `docs/ARCHITECTURE.md`
  §The downloader; on expiry the worker is terminated and replaced and its frames re-queued.
* After **2 failed attempts** a frame fails loudly through the existing `failed` path (an asked frame's waiter rejects,
  a fill frame reaches `onError`). No path waits for ever.

**Checks:** one test per path that fails without its fix (mutate each and record the mutant and what caught it); the
gate green; Chromium and Firefox fills exact (`client/contract/drive_firefox.mjs` for Firefox); row 145's fault bench
re-run, showing the hung decode recovered or failed loudly where it was invisible. **Cost:** clean fills unchanged —
the ack must not cost a fill: a few interleaved rounds (`lab/order.mjs`) with and without, on row 144's 200+ frame
series, both arms' full settings printed. **Docs:** `docs/ARCHITECTURE.md` §The downloader's "silent losses still
open" corrected in place. The reference implementation's client gets the same design locally, outside this queue.
**Deliverable:** the fix, the tests, the bench re-run and the cost numbers in the doc that owns the downloader.
**Branch:** `claude/av1-unified`.

### 148 FRAMEPATH

**One question: the best path for a decoded frame in this client.** It now has a paint worker (`client/paint/`:
OffscreenCanvas, WebGL2, samples uploaded straight from shared memory) and will get an OPFS client cache (decided, the
owner, 2026-10-10: OPFS for both web clients; no re-decoding; whether it stores decoded samples or coded bytes is open).
Today: decoder → pixel port → the page's consumer (`client/transport/consumer.js`, a `SharedArrayBuffer` handle,
~0.1 ms of page thread, `client/paint/README.md` §What it costs) → the painter → the paint worker, which shares the
buffer. **The owner's idea, to evaluate against today:** decoder → paint worker directly, the frame also written to
OPFS efficiently, the page out of the pixel path. Theory only: nothing built or timed. **Cover:**

* what the page thread costs per frame today at fill rates, and what a busy page thread (layout, a long task) does to
  delivery and paint in each design;
* who owns the frame store — memory and OPFS — and its eviction, and how the paint worker gets a frame it does not hold
  (scrolling back, a second viewport);
* OPFS mechanics from the specs and engines' sources: sync access handles in dedicated workers only, quota and
  eviction per engine, write cost per MB, decoded 16-bit samples against coded bytes, and what each costs on reopen
  (read, re-check, upload; coded bytes mean a decode, against the no-re-decoding rule);
* which worker writes, and whether the write sits on the fill's critical path;
* the exactness digest's place (`docs/adr/exactness-in-production.md`): checked before paint today; whether a frame
  read back from OPFS must be checked again, and against what;
* memory on phones (decoded frames held in shared memory, the cache's working set);
* what the reference implementation's client — decoded frames in a memory cache, painted from the page — could take
  from the design chosen.

Sources pinned (spec sections, engine source at a commit, sha256 of anything fetched). **Deliverable:** a design note
beside `docs/ARCHITECTURE.md` §The consumer with the mechanism, predictions per design, a measurement protocol with a
pre-stated rule (proposed, not queued), and the decisions listed for the owner under `## Blocked`. A change to the
store's format or the wire is structural: proposed, not built. **Branch:** `claude/av1-unified`.

**Owner input, 2026-10-11 (after dispatch; the result above reads against it):**

* Taking the page out of the pixel path is likely unnecessary (today ~0.1 ms of page thread a frame, no copy): settled
  as it is unless a measured cost says otherwise.
* The owner leans to decoded frames in OPFS; weighed against coded bytes on quota, write cost and phones.
* Eviction possibly link-dependent: to be weighed against plain LRU per study or series, noting that the link at reopen
  may differ from the link now.
* A cached frame is re-checked on read; the owner proposes checks off by default, switched on when needed, so they cost
  the product nothing. What each default costs (check time a frame against decode and read, by size) and what it leaves
  uncovered is a decision for the owner; the production ADR (rows 73, 88) has the decode check on today.

### 149 NATIVECINE

**A wider search for sound data, the three types row 100 could not decide.** Row 137 reached every host rows 2 and 35
named and found nothing that meets row 100's bar (`docs/FIXTURES.md` §Provenance, The data hosts and the candidates).
This row searches wider, for breast ultrasound cine (B-mode, probe slow or still), ABUS volumes and contrast angiography
runs as **native DICOM stored uncompressed or losslessly**, whole series in acquisition order. Search only: fetch
metadata (landing pages, APIs, DICOM headers where a host serves them alone), no pixel data. **Where:** TCIA's whole
collection list filtered by modality (US, XA, RF) and its multi-frame series; Imaging Data Commons (Google Cloud's
DICOM stores and BigQuery index); MIDRC; RSNA, AAPM and MICCAI challenge data; Stanford AIMI; PhysioNet; dataset
registries and repositories (Zenodo, Figshare, OSF, Mendeley searched by modality, not by name); the DICOM sample and
conformance image libraries vendors and toolkits publish; scanner QA and phantom datasets; papers' supplementary data.
**For each candidate:** content, series and frames per series, transfer syntax and Lossy Image Compression
(0028,2110) read from metadata where reachable, licence verbatim, access (open, registration, agreement, on request).
Licences are reported, not filtered: the owner decides on licence (2026-10-11). **Deliverable:** the candidates table
extended in `docs/FIXTURES.md` §Provenance, The data hosts and the candidates: what meets row 100's bar, what comes
closest and why it falls short. **Branch:** `claude/av1-unified`.

### 150 MAINBASE

*Amended 2026-10-11 (the owner): also after rows 152–154, so that tonight's theory rows land on the branch before
the rebuild replays it; the owner takes the native transport decision tonight.*

**The goal: the final PR to `main` merges with no conflict, and the owner can see that PR #34's work survived.**
`claude/av1-unified` was cut before `main` took PR #34 (the server refactor, 48 files); a trial merge stops on 24 of
them. This row rebuilds the branch on current `origin/main` and re-authors every replayed commit to
`dary-dc <crespoydelgado@gmail.com>` (the owner, 2026-10-07). No other row is fired until it is done; all new work
starts from its result (the owner, 2026-10-11).

**Steps.**

* Replay every commit of `claude/av1-unified` not on `origin/main`, in order, onto `origin/main`, author and committer
  `dary-dc <crespoydelgado@gmail.com>`. Resolve each conflict in the commit that causes it: keep PR #34's structure and
  re-apply the branch's change on top of it (the ClientHello fix, `bbr-bound`, the renames, …). 23 of the ~870 commits
  touch the 24 conflicting files.
* The same author rewrite for `claude/av1`'s commits not on `main`.
* **Every hash reference follows.** Build the old→new map for both branches; every reference to a replaced commit — in
  both branches' files (docs, queue, READMEs) and in the commit messages — names the new commit. A check script lists
  every 7–40-hex token in both trees and in all replayed messages that resolves to an old commit and not a new one: it
  must print none. Mutate it: plant one old hash and watch it caught. The map is committed as
  `docs/av1/rehash-map.tsv` on `claude/av1` for the local follow-ups (the reference implementation's `SOURCE.txt`, the
  owner's notes) and deleted after them.

**Verification (the owner must be able to see that PR #34's work survived).**

* (a) `git diff <old tip> <new tip>` outside the 48 files PR #34 changed is empty but for the hash replacements — shown
  by the diff filtered through the map.
* (b) `docs/av1/MAINBASE.md` on the new branch: each of PR #34's 48 files, kept as `main` has it or changed by the
  branch, each changed hunk with its branch commit and why; and each of the 24 conflicts with how it was resolved.
* (c) The full gate green on the new tip; Chromium and Firefox fills exact (the client's page check).
* (d) The final PR diff (`origin/main...<new tip>`), summarized by area.

**Publishing.** First push the old tips as `claude/av1-unified-pre-main` and `claude/av1-pre-main` (temporary, deleted
after the owner's look); then force-push the new histories under the same names, `claude/av1-unified` and
`claude/av1`, with `--force-with-lease` against the old tips. Never touch `main` or any other branch. Mark the row done
with the new hashes and the report's path. **Stop** and leave it under `## Blocked` if a conflict cannot be resolved
without choosing between PR #34's behaviour and the branch's.

### 151 CHECKCOST

**What the exactness checks cost, measured; their adoption is not the question.** The owner decided 2026-10-11 that the
checks stay on by default — the decode check, and the re-check of a frame read from the OPFS cache (row 148) — and wants
their time known. Measure, in today's client, ms a frame and its share of the frame's decode time: (1) the XXH3-64
check after decode on each path — HTJ2K WASM, dav1d-WASM, WebCodecs; (2) the second decode a failed check triggers
(row 145's injected fault reused); (3) the cache read's re-check, predicted as XXH3-64 over the decoded samples, timed
on the same buffers. **Sets:** a small (512²), a medium (1914×2572) and a large (3328×4096) frame, 8- to 16-bit where
the path takes them. **Engines:** Chromium and Firefox. Interleaved (`lab/order.mjs`), n ≥ 5 rounds, every frame exact;
quote time a frame, not throughput. **Deliverable:** the table in `docs/adr/exactness-in-production.md` (a section of its
own). **Branch:** `claude/av1-unified-mainbase`.

### 152 QUICTUNED

*Amended 2026-10-11 (the owner): this round gathers everything published before anything is measured, and reads
the server's stack as a candidate too.*

**The candidates at their best, not their defaults.** Row 124 read each QUIC stack at its default configuration. A
default is not a limit when the setting can be changed or patched (the owner, 2026-10-11: msquic's 64 KiB default
stream window caps one stream near 5 Mbit/s at 100 ms, but it is a setting). Throughput and latency are the product's
purpose, and the owner is learning: **explain, don't list.** Theory only; nothing built or timed.

* **Everything published, first, on one table.** Every published result per candidate and per lever, each with its
  setup (link rate, RTT, loss, hardware, stacks' versions and settings): papers, the implementers' own benchmarks and
  performance dashboards, the interop runner, issue trackers and talks. For every comparison, say whether its stacks
  were tuned or ran at defaults.
* **Per candidate, read from its source:** what can be tuned, to what, by a setting or by a small patch — stream and
  connection flow-control windows and whether they auto-tune; ACK frequency and ACK delay
  (draft-ietf-quic-ack-frequency); receive batching (`recvmmsg`, GRO, Windows URO, Apple's paths); socket buffer sizes;
  pacing; 0-RTT; migration — and what cannot change without a fork.
* **Each lever's mechanism and its effect on throughput and on latency,** in plain words with worked numbers (a window
  must be at least bandwidth × RTT: 50 Mbit/s × 150 ms ≈ 0.94 MB, so a smaller one caps the link whatever the
  controller does).
* **The server's stack is a candidate too, not fixed at quinn.** The server is the sender: its controller, pacing, GSO
  and send cost per byte decide throughput and latency on the link. Read every candidate as a server as well as a
  client. A change of server stack has to be worth it: state what it would cost — the WebTransport layer (wtransport
  today), `bbr-bound` and the controller work, [`../WIRE.md`](../WIRE.md)'s contract, and the gate.
* **The owner's paper, read critically:** Bünstorf and Jaeger, "MsQuic – A High-speed QUIC Implementation", TUM seminar
  IITM SS 23, doi 10.2313/NET-2023-11-1_01,
  <https://www.net.in.tum.de/fileadmin/TUM/NET/NET-2023-11-1/NET-2023-11-1_01.pdf>. Read already, to be confirmed: a
  student seminar paper on Jaeger et al.'s testbed — one 1 073 MB download over 10GBase-T back to back, no added RTT or
  loss, 10 runs; four stacks (picoquic, Cloudflare quiche, LSQUIC, msquic), no quinn, settings not stated. msquic's
  goodput is the highest on all three host pairs (5 443 Mbit/s on a Xeon E5-1650 v3, 4 845 on a Xeon Gold 6312U, 3 898
  on an EPYC 7543). Its text calls 3 898 "the lowest" on the AMD pair while its figure shows it highest, and its
  conclusion's "double the goodput of LSQUIC" holds on the older pair only (×1.09–1.10 on the newer two, from the
  figures). It measures CPU-bound bulk goodput at 4–5 Gbit/s — CPU efficiency, which bears on a phone's CPU and
  battery and on the server's cost, not on throughput or latency at the target's 5–50 Mbit/s with RTT and loss. Read
  its source [13] (Jaeger et al., "QUIC on the Highway", IFIP Networking 2023) for the stacks' settings.
* **The row ends with what theory settles,** and the specific gaps it cannot settle and why. No measurement protocol is
  proposed: a gap that needs one is described in one line, for the owner to decide later.
* The owner's decisions are listed, not taken.

**Deliverable:** `docs/native/quic.md` (a section of its own, §1 kept consistent). **Branch:** `claude/av1-unified`.

### 153 INGESTDESIGN

**The question: the best design of the pipeline from the owner's C parser to the PACS.** Today's proposal (parser →
directory → Rust ingest that hashes, codes exactly, checks and compresses → outbox → TCP → the PACS checks, writes the
image layout and builds one SQLite per study, a catalog server indexing them) is the natural progression of what exists,
not a design compared against alternatives. Theory only: sources pinned (sha256 or commit), nothing built or timed.
Compare the options on each axis, with what each costs and gains:

* **(a) Where frames are coded.** In the hospital by the Rust ingest; inside the parser in C before anything is written
  (it already has an HTJ2K output, on the grok encoder); or in the cloud — raw frames sent zstd-compressed and coded
  there, as AWS HealthImaging converts to HTJ2K on import. Weigh hospital CPU (free) against cloud CPU (money), the
  bytes on the link (HTJ2K lossless against zstd on raw samples, from published ratios), and where the exactness check
  runs and what it then proves.
* **(b) How the parser hands over.** A directory (the start, decided), a stream (its key-value stream output), or a
  library call; what each costs per frame and what it changes in failure handling.
* **(c) What travels.** Frame files plus metadata groups as written, prebuilt series bundles, or one archive per study.
* **(d) Where the image layout, each study's SQLite and the catalog are built.** The catalog server: Postgres, MySQL,
  or a libSQL/Turso server keeping one SQL dialect with the study databases. Its schema scope (what a cross-study
  search and a worklist need), and how it stays consistent with the study databases (who writes first, how a study
  database rebuilt from its groups re-registers).
* **(e) The integrity chain, and what each hash costs.** The raw frame (end to end, proved by the decode-back compare);
  the coded frame (lets the PACS check without decoding); the metadata, original or compressed; reuse of the parser's
  BLAKE3 group hashes, which it already writes in each group's file name; the client's XXH3-64. Check the owner's point
  with numbers: a hash over compressed metadata saves only if the PACS keeps the metadata compressed, and it decompresses
  to build the study database.
* **(f) Metadata compression.** Plain zstd against zstd with a trained dictionary on small DICOM groups (published
  ratios; the groups repeat across instances of a series).
* **(g) Recovery.** Resumability and idempotence; dedupe (the parser's group hash lets a receiver skip a group it
  already holds); a bad instance, series or study isolated without touching the rest.
* **(h) Prior art.** DICOMweb STOW-RS; AWS HealthImaging, Google Cloud Healthcare API, Azure's DICOM service; Orthanc
  and dcm4chee; edge gateways in front of cloud archives — what each does on each axis above.

**The row ends with the options side by side and the owner's decisions listed, not taken.** **Deliverable:**
`docs/ingest/design.md`. **Branch:** `claude/av1-unified`.

### 154 LINKTCP

**The hospital→PACS link is TCP — the owner's decision of 2026-10-11.** Write the reasons with pinned sources, and what
QUIC would gain or cost there in numbers from research; the owner dropped a QUIC shipper for now and wants its gains
proven before it returns. Theory only.

* **CPU per byte:** QUIC in user space against kernel TCP with TSO/GSO/GRO and NIC offloads (Zhang et al., WWW '24;
  Yang et al. on QUIC's CPU cycles against TCP+TLS; Jaeger et al.; others found).
* **UDP on the way out:** how often outbound UDP is blocked or throttled in enterprise and hospital networks
  (published fallback rates, operators' reports), and what a QUIC link would need as a fallback.
* **Long fat paths:** BBR and window autotuning on Linux TCP, and what tuning a site host needs.
* **What QUIC's advantages are worth here:** migration, 0-RTT and stream independence on a wired bulk upload.
* **Published bulk-transfer comparisons** of QUIC and TCP over WAN at realistic RTT and loss, with their setups.
* **Resumable upload over HTTPS:** tus, S3-style multipart, plain range PUT, rsync over SSH — each one's integrity and
  resume semantics.

**The row ends with what would have to be true for QUIC to win.** No measurement protocol. **Deliverable:**
`docs/ingest/link.md`. **Branch:** `claude/av1-unified`.

### 155 INGESTRS1

*Amended 2026-10-12 (the owner): SHA-256 is replaced, and the raw-frame check is XXH3-64.* The Rust ingest hashes the
raw samples with XXH3-64 and compares the decode-back's XXH3-64 — the digest it writes for the client anyway, so one
hash family per frame. `ingest.py`'s raw-frame check moves from SHA-256 to XXH3-64 in this row, so both ingests check
alike and stay byte-identical; any other SHA-256 left in the ingest is listed in the report with what it does.

*Amended 2026-10-11 (the owner): no effort on what the parser accepts. The mirror is a simple first step that writes the
parser's directory output shape — the contract — from the frames `ingest.py` already reads, so the parser can be swapped
in later; no input-acceptance logic beyond `ingest.py`'s own. The parser's open points are notes for its author in
`docs/ingest/README.md` §5, not this row's work. The contract goes to `docs/ingest/contract.md`.*

**Phase 1 of the Rust ingest (the owner, 2026-10-11): production-shaped, with a Python stand-in for the parser's frame
output only.** Phase 2 swaps the stand-in for the owner's C parser and passes its metadata through untouched; no other
metadata logic is ever written in Python.

* **The Python mirror** writes exactly what the parser's directory output writes for frames, per instance: the same
  directory layout, frame file names and raw bytes, and the instance group holding only the attributes a frame needs
  to be read — (0028,0002) samples per pixel, (0028,0004) photometric interpretation, (0028,0006) planar configuration,
  (0028,0008) number of frames, (0028,0010) rows, (0028,0011) columns, (0028,0100) bits allocated, (0028,0101) bits
  stored, (0028,0102) high bit, (0028,0103) pixel representation — plus the UIDs and study date the path needs. It
  reads every set `ingest.py` takes today. It is a stand-in, deleted in phase 2.
* **The Rust ingest** (a workspace crate) reads that directory as it will read the parser's: per instance, the frame
  description from the instance group, then per frame: hash the raw
  samples, code with the pinned OpenJPH exactly as `ingest.py` does today (byte identity), decode back in-process and
  compare, write the XXH3-64 digests, and write the `.sbnd` with `common/series-bundle`.
* **Done when** its `.sbnd` files are byte-identical to the Python ingest's for every lab set at `--jobs` 1, 2 and 4;
  it refuses the same series by name; every new test is mutated and fails; the gate is green, with a gate step keeping
  the two ingests equal while both exist.
* **Not in this row:** AV1 (a later row); the outbox and the transport (after row 153).

**The input contract, read from the parser's public source (2026-10-11).** Write it to `docs/ingest/contract.md`,
linked from `docs/ingest/README.md`.

* **One parser run per SOP instance**, writing under its working directory. Paths, with `/` separators:
  * study date: `<D>/` — the study date (0008,0020) as `YYMMDD` (century dropped) coded as below, 4 characters; `PbPb`
    when the date is not 8 characters long;
  * exam: `<D>/<E>/`, E = the study instance UID (0020,000D) coded;
  * series: `<D>/<E>/<S>/`, S = the series instance UID (0020,000E) coded;
  * instance: `<D>/<E>/<S>/<I>/`, I = the SOP instance UID (0008,0018) coded.
* **The UID coding.** Each character maps to a nibble: NUL (the UI padding) 0, `\` 1, `^` 2, `-` 3, `+` 4, `.` 5, `0`–`9`
  6–15. Each three characters (12 bits) become two characters of the alphabet
  `0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~`, the first from the top 6 bits. A remainder of one
  character becomes `alphabet[n0 << 2]` then `0`; of two, `alphabet[(n0 << 2) + (n1 >> 2)]` then `alphabet[(n1 & 3) << 4]`.
  The UID's trailing NUL pad, when present, is coded with it.
* **Group files**, named `<marker>.<64 lowercase hex of the group's BLAKE3-256>`: exam group `<D>/<E>/--.<h>`, series
  group `<D>/<E>/<S>/---.<h>`, instance group `<D>/<E>/<S>/<I>/----.<h>`, private group `<D>/<E>/<S>/<I>/priv.<h>`
  (only when the instance has private attributes, or group 0002). An existing exam or series group file is not
  rewritten.
* **A group file** is a sequence of records, no bytes between them: 1 byte key length KL (8 at the dataset's top level,
  8 more per sequence item level), KL key bytes, 4 bytes value length VL little endian, VL value bytes. A top-level key
  is the tag as big-endian group and element (4 bytes), the VR as two ASCII characters, and 2 bytes of the parser's
  charset index (0 for anything not text in a specific character set). A value whose charset index is non-zero is
  written converted to UTF-8, VL its converted length; any other value is written exactly as in the DICOM file. Group
  lengths (gggg,0000) and (0008,0005) are dropped; sequence and item delimiters are not written.
* **Frame files**, in the instance directory: `%05d` (1-based) plus `.OPC` for MONOCHROME1 and MONOCHROME2, `.RGB` for
  RGB, `.PLT` for PALETTE COLOR; a frame's file is `rows × columns × samples per pixel × bits allocated / 8` bytes
  copied from the pixel data (7FE0,0010) at offset `frame × that size`, so a 12-bit-in-16 frame is its 16-bit words as
  stored, little endian. Number of frames absent or 0 writes one frame. YBR_FULL, YBR_FULL_422, YBR_PARTIAL_420,
  YBR_ICT, YBR_RCT and XYB write no frame (the parser prints "not handled").
* **Not this row's work:** what the parser accepts (explicit VR little endian only) and its open points (planar
  configuration, three group hashes over a pre-conversion length, five-digit frame names). The mirror writes frames
  as `ingest.py` holds them, and the ingest checks no group hash.

**Deliverable:** the crate, the mirror, `docs/ingest/contract.md`, the gate step. **Branch:** `claude/av1-unified-mainbase`.

### 156 QUICCOMPARE

*Amended 2026-10-12 (the owner): the native version does not use WebTransport (2026-10-10).* "As our client" means a
native client on raw QUIC with our own ALPN; WebTransport counts only for the server's browser side. Rows 124 and 127's
conclusions that assume a WebTransport native client, the assumed band or quinn on the server are inputs to examine,
not verdicts to repeat.

**The QUIC implementations actually compared, for learning (the owner, 2026-10-11).** Rows 124 and 152 hold the facts,
but they read as tables and verdicts; the owner wants to learn how each implementation works and what that means for
throughput and latency. Theory and writing; nothing built or timed. One question: how do the candidates compare, lever
by lever, and why.

* **A short glossary first**, each term with its mechanism in plain words: receive windows (fixed, auto-tuned),
  bandwidth-delay product, ACK policy and ACK frequency, socket buffer, batched I/O (`recvmmsg`, GRO, GSO), pacing,
  congestion controller and its hook, migration, 0-RTT, multipath, WebTransport over HTTP/3.
* **One section per implementation.** Deep on quinn, msquic, Cloudflare quiche, ngtcp2, picoquic, Google QUICHE, neqo,
  s2n-quic, quic-go, lsquic and mvfst; brief on the rest of row 124's fifteen. Each section:
  * what it is, who builds it and for what;
  * its design: I/O model, threads, TLS;
  * how it handles each lever — windows (fixed or auto-tuned, and the rule), ACK policy and ACK frequency, socket
    buffer and batched I/O, pacing and GSO, controllers and hooks, migration, 0-RTT, multipath, WebTransport;
  * **its throughput ceiling as a function of bandwidth and RTT**, at its defaults and at its best: the formula
    (window ÷ RTT, and what else bounds it), plus a grid from 1 Mbit/s to 1 Gbit/s and from 10 to 300 ms;
  * platforms, build, security record and licence;
  * what it would mean as our client and as our server.
* **A side-by-side summary** at the end.

**Rules.** Label every claim **source** (pinned), **derived** (arithmetic on a source) or **measured** (this
repository, with the row); theory first, measured results kept apart and named as such. **No claim restricted to a
"target band"**: the repository's 5–50 Mbit/s and 30–150 ms are an assumption, not field data — wherever they are
used, say so. Reuse rows 124 and 152's pinned sources (`docs/native/quic.md` §2, §7, §8); read new ones only to fill a
gap, pinned the same way.

**Deliverable:** `docs/native/quic-compared.md`, linked from `docs/native/quic.md` §1. **Branch:** `claude/av1-unified-mainbase`.

### 157 QUICREWRITE

**The owner, 2026-10-12, on row 156:** a reading led by defaults made one stack look like the winner for a reason the
owner had ruled out (defaults are settings, not limits), and a theory round carried many numbers without visible
backing. One question: **how do the stacks compare when each is at its best?**

* **Rewrite [`../native/quic-compared.md`](../native/quic-compared.md) in place** (a retracted reading is corrected
  in place, as CLAUDE.md §Docs says: say what changed and why, once, at the top).
* **Each stack at its best is the reading.** For every lever (windows, ACK policy and ACK frequency, socket buffer and
  batched I/O, pacing, controller and its hook, migration, 0-RTT, multipath), state the best setting the stack
  allows or a small patch would allow, and the ceiling that results. Where a term stops separating the stacks once
  tuned, say so plainly, and say what does separate them. Defaults shrink to one table: "what you would change, and
  how" (setting, patch or fork).
* **Every number traceable.** Each number carries its own source at the point of use: the file and line at the pinned
  tag (for code), or the paper or RFC and its table, figure or section; or its derivation written out (the formula
  and its inputs, each sourced). A section-level "(S)" is not enough. A number not needed to understand a point is
  cut. Measured results (this repository) stay apart and named with their row.
* **Keep:** theory only; the native client on raw QUIC with our own ALPN, WebTransport only for the server's browser
  side; no claim restricted to the assumed 5–50 Mbit/s, 30–150 ms band; the 1 Mbit/s–1 Gbit/s × 10–300 ms grid where
  a grid helps. Reuse rows 124, 152 and 156's pins; fetch new sources only to pin a number, pinned the same way.
* **Not in this row:** latency (row 158).

**Deliverable:** the rewritten `docs/native/quic-compared.md`, `quic.md` §1's pointer still true. **Branch:**
`claude/av1-unified-mainbase`.

### 158 QUICLATENCY

**The owner, 2026-10-12:** row 156 has no latency investigation, and latency is half the product's purpose. One
question: **what does each QUIC stack, at its best, do to the latency of a frame?** Theory only.

* **The terms, each as a formula over RTT and loss, and each with its mechanism in plain words:**
  * time to the first frame: handshake round trips, 0-RTT resumption (and what it needs on our raw-QUIC ALPN), the
    initial window and initial RTT, pacing of the first flight;
  * an ask's latency (one frame requested during or outside a fill) on a clean link and under loss: how fast a lost
    packet is detected and repaired — ACK policy, `max_ack_delay` and ACK frequency, the probe timeout
    (`PTO = srtt + max(4·rttvar, 1 ms) + max_ack_delay`), packet- and time-threshold loss detection, tail-loss probes;
  * head-of-line blocking between streams, and within one stream (today's fill shares one stream, `docs/WIRE.md`);
  * receive CPU per frame on the client, and when it reaches the latency at all;
  * migration: how long a network change costs, probe-then-switch against rebind.
* **Per stack, at its best** (row 157's settings): which of these each controls, what it allows, and the resulting
  number on the grid (1 Mbit/s–1 Gbit/s × 10–300 ms × loss 0–1e-2). Where the server's stack sets the term (the sender's
  loss recovery and pacing), say so: the client's stack cannot change it.
* **Rules:** row 157's — every number at its point of use with its exact source or its derivation; measured results
  (this repository's, e.g. row 135's receive CPU) apart and named; no claim restricted to the assumed band; the
  native client on raw QUIC.

**Deliverable:** a §Latency in `docs/native/quic-compared.md` (after row 157's rewrite), summarised in its §1.
**Branch:** `claude/av1-unified-mainbase`.

### 159 CONTAINERS

**The owner, 2026-10-12:** the team proposed standard video containers (Matroska, MP4 and others, with ffmpeg) as
packing alternatives: standardized, battle-tested, nothing to implement. The owner doubts any matches the custom
layout plus this server's read path on throughput and latency, especially in the cloud where every resource is
money, and wants the comparison fair. One question: **what is each container, and what can it do for us?** Theory
only; the measurement is row 160.

* **Candidates:** MP4 / ISO BMFF (progressive and fragmented, CMAF), Matroska / WebM, DICOM multi-frame encapsulated
  (Basic and Extended Offset Table; the HTJ2K transfer syntaxes), MXF (JPEG 2000 in MXF), Motion JPEG 2000
  (ISO/IEC 15444-3), raw AV1 streams (OBU / Annex B / IVF), and any other a source shows in use for frame sequences.
  The reference is the `.sbnd`, today's and row 164's draft target.
* **Each, characterized simply first:** its structure (a diagram), how it indexes frames (granularity, where the
  index sits, what loading it costs), where metadata goes, which codecs have a standard mapping (AV1, JPEG 2000 /
  HTJ2K, 16-bit grey, 12-bit), its per-frame overhead.
* **What maximizes throughput or minimizes latency in it:** index placement (e.g. MP4 `moov` first), fragment size,
  Matroska Cues placement, alignment, interleaving; what a server must parse at open and per request, and whether the
  read path can stay one lookup and one `pread` per frame (`docs/adr/disk-access.md`).
* **Everything else that counts:** tooling (ffprobe, MediaInfo, MP4Box, mkvtoolnix, dcmtk), hardware playback in
  players (a property of the codec, which the container only feeds — say so where it applies), browser support (MSE
  takes fragmented MP4 and WebM; WebCodecs takes no container, so a demuxer is needed), how the draft target's
  features would be carried (Study/Series UIDs, a coded and a samples hash per frame, the tiled band-major layout) and
  what that costs in standardness, licences and patents, maturity.
* **Close with row 160's protocol:** predictions per arm, the arms worth measuring, the metrics, interleaving, and a
  decision rule (what result adopts a standard container, what keeps the `.sbnd`), marked *proposed* for the owner
  and the team.
* **Rules:** every number at its point of use with its exact source (spec section, file:line at a pin) or its
  derivation; (S) / (D) / (M) labels as row 156; no claim restricted to the assumed link band.

**Deliverable:** `docs/disk-layout/containers.md`. **Branch:** `claude/av1-unified-mainbase`.

### 160 CONTAINERBENCH

**Measurement, in a session given only row 159's §Protocol** (theory first, measured apart). Read nothing else of row
159 before the numbers are in.

* **Arms:** the `.sbnd` and the containers row 159 names, each implemented with equal care: one index loaded at open,
  then the same read path (`pread`, `RWF_NOWAIT`, the pool) — a fair arm, not a strawman. Packing by the standard
  tools where they exist (ffmpeg, MP4Box, mkvmerge, dcmtk) and by ours.
* **Data:** sound sets only (`lab/av1/data.json` provenance `sound`); others only labelled, deciding nothing.
* **Metrics:** time to open, bytes on disk, per-frame read latency (hit and forced miss through the store's levers),
  fill throughput, server CPU per GB served, ingest packing time. CLAUDE.md §Measurement: interleaved arms, mutate
  every new check, latency or throughput not both, say where the host saturates.
* **Verdict** by row 159's rule, stated as proposed until the owner and the team accept it.

**Deliverable:** `docs/disk-layout/containers.md` §Measured. **Branch:** `claude/av1-unified-mainbase`.

### 161 HWDECODE

**The owner, 2026-10-12:** hardware playback is a strength the team sees in video containers; it belongs to the
codec, and could serve our own frame sequence — a native video viewer for the native version, video decode in the
browser — if it keeps what a radiologist needs. One question: **which hardware decode paths can serve the diagnostic
viewer?** Theory only.

* **Paths:** the browser's `<video>` / MSE, WebCodecs (Chromium, Firefox, Safari), VideoToolbox, MediaCodec, VA-API,
  NVDEC, Media Foundation / D3D12 Video, Vulkan Video.
* **For each:** codecs and profiles in hardware (AV1 Main / High / Professional, HEVC RExt, VVC, any JPEG 2000 / HTJ2K),
  bit depths, whether AV1's lossless mode decodes, whether the exact samples come back to the application (and how:
  `VideoFrame.copyTo`, `CVPixelBuffer`, `Image`) or only a colour-converted picture, published per-frame latency and
  throughput, device coverage (the share of phones and desktops with each), and which radiology functions survive:
  window/level on > 8 bits, zoom, measurement, the exactness check, cine.
* **Relate it to the AV1 design:** the bit split into 8/10-bit planes (`docs/codecs/`), the measured WebCodecs and
  dav1d results (rows 8, 37, 49), Chromium's 12-bit refusal.
* **Rules:** row 159's.

**Deliverable:** a §Hardware decode in `docs/decode/README.md`, or `docs/decode/hardware.md` linked from it if it
outgrows a section. **Branch:** `claude/av1-unified-mainbase`.

### 162 LINKREAL

**The owner, 2026-10-11/12:** the repository's 5–50 Mbit/s and 30–150 ms
([`../transport/transport-conclusions.md`](../transport/transport-conclusions.md), The target) were set as an
assumption and must not be treated as fact. One question: **what do real links measure?** Research only.

* **Links:** mobile 4G and 5G (down and up), hospital and enterprise Wi-Fi, home broadband, and a hospital site's
  internet uplink to a cloud PACS.
* **Per source:** who measured, where, when, how, and the distribution (median, p10, p90 where given) of rate, RTT,
  loss and their variation over time (bursts, handovers, delay spikes, bufferbloat); pinned like every other source.
  Prefer large independent datasets (regulators, M-Lab, peer-reviewed measurement studies) over vendor claims; name
  each source's bias.
* **Output:** a table of link profiles with ranges and sources; then what it means for the assumed band — confirmed,
  widened or replaced — corrected in place in `transport-conclusions.md` The target, with a pointer here; and which
  earlier verdicts rest on the band (list them, do not re-run them).

**Deliverable:** `docs/transport/link-conditions.md`. **Branch:** `claude/av1-unified-mainbase`.

### 163 STREAMPACK

**The owner, 2026-10-12:** the hospital packs a series into one file and publishes it by `.partial` → fsync → rename;
can it start sending while it is still parsing and coding, and with what protocol? One question: **what would
streaming the pack take, and what would it save?** Theory only.

* **Why it does not stream today:** the index sits at the front and needs every frame's length first
  (`common/series-bundle/src/writer.rs`).
* **Options:** an index at the end (a trailer); frames as independent records with a final "series complete"
  message, the PACS assembling and publishing; chunked resumable upload (draft-ietf-httpbis-resumable-upload, tus, S3
  multipart) — each with its framing, how a crash or a cut link resumes, when and how each frame's coded hash is
  checked on arrival, and how the PACS publishes only a complete series.
* **What overlap saves,** as a formula over coding rate, link rate and series size, at the hospital uplink rates row
  162 finds (or a stated range until then); and its interplay with the open "when is a series complete" decision
  (`docs/ingest/design.md`).

**Deliverable:** a section in `docs/ingest/design.md`. **Branch:** `claude/av1-unified-mainbase`.

### 164 DISKLAYOUTDOCS

**The owner, 2026-10-12:** wt-pacs needs a document for the current disk layout and one for the target. Writing only;
diagram first, essential, for humans.

* **`docs/disk-layout/README.md` — the current layout, exactly,** from the code with line references: the `.sbnd`
  header (16 B: "SBND", version, metadata length, frame count), the index (12 B a frame: offset u64, length u32, fixed
  stride, read once at open), the embedded metadata JSON and the sidecar (two copies; the server reads neither; the
  page reads the sidecar), frames back to back in display order, unaligned; the writer (lengths up front, no
  temporary name, no fsync, no rename); one series per server process; the read path's dependence on display order
  (`FILL_WINDOW`). Fix `docs/av1/payload-format.md`'s "the bundle's codec field" (there is none; the codec is in the
  metadata).
* **`docs/disk-layout/target.md` — the draft target agreed with the owner 2026-10-12**, marked draft until rows 159–160
  report:
  * one file per series, `<StudyUID>/<SeriesUID>.sbnd`; metadata only in the per-study database (Turso), none in or
    beside the file;
  * header 148 B: "SBND" | version u32 = 2 | codec 4 ASCII ("HTJ2", "AV01") | layout u32 (0 sequential, 1 tiled) |
    entry count u32 | Study Instance UID 64 B | Series Instance UID 64 B (NUL-padded) — the file says what it is;
  * layout 0, sequential (the one built now): entry 28 B = offset u64 | length u32 | XXH3-64 of the coded bytes |
    XXH3-64 of the samples; the frame number is the entry's position;
  * layout 1, tiled (later, its own format): entry 36 B, adding frame u32 | tile u16 | band u8 | spare u8, stored
    band-major so a screen-fitted read is one contiguous range (the 17.6× of the 2026-09-06 study, tag
    `read-path-evidence-2026-09-09` `docs/disk-layout/ACCESS-PATTERNS.md`);
  * the coded hash is kept for life: checked on receipt, by scrub and optionally on read; the samples hash is the
    client's exactness check;
  * packed at the hospital; published by `.partial` → fsync → rename → fsync of the directory, at both ends;
  * a version the reader does not know is refused;
  * open: streaming the pack (row 163), standard containers (rows 159–160), series completeness.
* Link both from `docs/FIXTURES.md` §SBND series bundle and `docs/adr/disk-access.md`; keep the gate's link check
  green.

**Deliverable:** the two files and the fixes. **Branch:** `claude/av1-unified-mainbase`.

## The net-improvement round (rows 165–170), 2026-10-13

**The owner, 2026-10-13:** every earlier investigation is finished; use the time and the unused usage windows while
the owner is away. First find out whether what we have is all tried or analysed — HTJ2K and AV1 decoding
optimizations or enhancements, complementary approaches such as LCEVC and SVC, colours, and areas outside the codecs,
from general improvements to settled ones such as disk reading. Focus on almost completely net improvements; for
instance, a longer fill time is not interesting for now. Spread the work over several usage windows.

**Net, as this round reads it** (the orchestrator's reading of the owner's words, for the owner to correct): a change
is net when it makes something measurably better and nothing on the target worse beyond its measured spread — fill,
ask, exactness, bytes, a phone's memory, a server's CPU — at the cost of code alone. A change that trades one of these
for another is a trade-off: it is listed and goes to the owner, not adopted. The target's links are row 162's
measured profiles ([`../transport/link-conditions.md`](../transport/link-conditions.md)), not the old 5–50 Mbit/s
band.

Rows 165–167 are audits and theory, read-only but for their deliverable; they **propose** rows (a name and one question
each, theory first) and the orchestrator queues them in the next usage window ([`ORCHESTRATE.md`](ORCHESTRATE.md) §2).

### 165 AUDITCODEC

**One question: is every codec lever tried, and what is left that would be net?** Audit, nothing built or timed.

* **Scope:** HTJ2K (OpenJPH encode and decode, block size, progression, resolution levels, tiles, the code-block pool,
  WebGPU), AV1 (libaom, SVT-AV1, dav1d-WASM, WebCodecs, groups, the bit split, REMAP, `cpu-used`, threads), JPEG XL,
  JPEG-LS (listed in `docs/decode/README.md` §Not yet tried, never explored), AV2, LCEVC (row 19), scalable AV1 (rows
  15, 18, 24–26, 31, 40), embedded lossy-to-lossless (rows 17, 22), colour transforms (rows 80, 97), the learned
  coders of row 58.
* **Each lever, one line:** the rows that touched it with their verdict; then one class — *closed by evidence that
  still holds*; *closed by a premise since changed* (the link band, row 162; a newer release than the pin; data
  provenance, row 121; a rule the owner has since changed); *never tried*; *waiting on the owner* (§Blocked).
* **Releases since the pins:** OpenJPH, dav1d, libaom, SVT-AV1, libjxl and jxl-rs, CharLS, emscripten, Chromium's and
  Firefox's WebCodecs, and whether an open LCEVC encoder now exists — each with its tag, date and what its changelog
  says that bears on a lever.
* **Close with a ranked list** of the *reopened* and *never tried* levers by expected net gain on the target, each a
  proposed theory row (a name and one question), and the trade-offs apart, for the owner.

**Deliverable:** `docs/codecs/README.md` §Tried and open (a table, each line pointing to the doc that owns the lever).
**Branch:** `claude/av1-unified-mainbase`.

### 166 AUDITPATH

**One question: outside the codecs, is every lever tried, and what is left that would be net?** Row 165's audit,
same classes and same close, for everything else.

* **Scope:** the disk read path and the writer (`docs/adr/disk-access.md`, `docs/disk-layout/`, row 160's `BufWriter`
  finding, which row 168 takes); the server's send path (rows 51, 81; per-frame cost, which row 162 says weighs ~5×
  more at the measured rates); the transport (congestion control, initial, flow-control and send windows, GSO,
  pacing, tail copies, 0-RTT; rows 75, 103–107, 119, 130–132, 139–141, 146, 152, 158); the client (downloader, decoder
  workers and their start, zero-copy hand-off, frame loss, the exactness checks, the frame path and the OPFS cache,
  paint, memory; rows 49, 50, 108–113, 142, 144, 147, 148, 151); the ingest (rows 52, 71, 89, 126, 136, 153, 163); the
  gate and the tooling (rows 54, 86, 118).
* **Name a lever as tried only with the row that measured it;** a lever argued but never measured is *never tried*.

**Deliverable:** `docs/levers.md` — one index of every lever outside the codecs, linking to row 165's §Tried and open
and to each owning doc; linked from `README.md`. **Branch:** `claude/av1-unified-mainbase`.

### 167 BANDRECHECK

**One question: which of the verdicts that rest on the old band change at the measured links?** Theory only.

* **The eight verdicts** are [`../transport/link-conditions.md`](../transport/link-conditions.md) §Verdicts that rest
  on the band. For each: re-derive it at row 162's profiles (cellular p10, median and p90; Wi-Fi; loaded RTT), with
  the formula, every input sourced and the derivation labelled (D); then one of *holds*, *flips* or *open*.
* **For each that flips or is open:** the change that would follow and whether it would be net or a trade-off, and
  the measurement that would decide — its arms, cells (rates, RTTs, loss and loaded queues from row 162), predictions
  and a decision rule — written as a protocol for a separate session.
* **An ask behind the session's own fill:** row 162 found a loaded RTT of 0.7–0.8 s median on cellular. Derive what an
  ask waits behind the fill's own queue under today's controller, and what in the product (priorities, a cap on bytes
  in flight during an ask, pacing) would cut it with no cost to the fill — a ninth item.

**Deliverable:** `docs/transport/link-conditions.md` §Verdicts that rest on the band, each item extended in place, and
the protocols in a §Re-measured, proposed. **Branch:** `claude/av1-unified-mainbase`.

### 168 PACKWRITE

**One question: why does a `.sbnd` written in 8 KiB writes read slower than the same bytes written in 1 MiB writes, and
would production see it?** Theory first; the measurement is a later row given only this row's protocol.

* **The finding:** row 160, `docs/disk-layout/containers.md` §Measured — warm hits 24–31 % slower and fill 24–32 %
  slower on 32–41 kB frames, 16 rounds; rewriting v2 in 8 KiB writes undoes it, so it is the writer, not the layout;
  mechanism unmeasured. `pack-series` writes through an 8 KiB `BufWriter`
  (`common/series-bundle/src/writer.rs`).
* **Candidate mechanisms,** each with the evidence that would tell it apart and its source (kernel file:line at a pinned
  version, filesystem documentation): extent fragmentation (`filefrag -v`), the page cache's folio sizes and readahead
  on a file built by small appends, the container's overlay or the backing filesystem, delayed allocation; and which
  of them the production store's filesystem (ext4 or XFS on a cloud volume) shares.
* **The fixes,** each as small as possible: a larger buffer, one `write` per frame, `fallocate` to the final size
  before writing, a copy at publish; whether row 164's draft target (`.partial` → fsync → rename) changes any of them.
* **Close with the protocol:** arms that differ in the writer alone, the read path unchanged, interleaved, hit and
  forced miss through the store's levers (not page-cache eviction), on the container's filesystem and on a plain
  ext4 or XFS image; predictions per mechanism and a decision rule (what adopts which fix).

**Deliverable:** `docs/disk-layout/README.md` §The writer. **Branch:** `claude/av1-unified-mainbase`.

### 169 DISPLAY

**One question: what reaches the radiologist's screen, and does the product lose anything between the exact frame and
the display?** Theory only. No row has asked it: the frames are proved exact, and `client/paint` windows them to an
8-bit WebGL2 drawing buffer.

* **Grey:** bits per sample after the window today (`client/paint/paint-worker.js`, `voi.js`); what DICOM asks
  (PS3.14 grayscale standard display function, PS3.3 presentation LUT); what diagnostic displays offer (10- and 12-bit
  grey panels, their calibration) and what the browser can send them — WebGL2 and WebGPU canvases with a float16 or
  10-bit buffer, `colorSpace`, `toneMapping`, `dynamic-range` media query — per engine and OS, with sources; and the
  same for a native client (Metal, Vulkan, DXGI 10-bit output).
* **Colour:** RGB ultrasound and other colour series: ICC profiles in the DICOM header, the canvas's colour space, sRGB
  against Display P3; what is lost today, if anything.
* **Net or not:** for each gap, the change, its cost (a frame's paint time, memory) and whether it is net; what cannot
  be known without a calibrated display, stated as such.
* **Close with a protocol** for whatever a container can measure (e.g. a float16 canvas's read-back against the
  reference painter), and what needs a device, for the owner.

**Deliverable:** `client/paint/README.md` §What reaches the screen, or `docs/display.md` linked from it if it outgrows a
section. **Branch:** `claude/av1-unified-mainbase`.

### 170 FETCHPIN

`lab/av1/fetch_data.sh` fails as written: `lab/av1/requirements.txt` lacks a hash-pinned `typing-extensions`, which
`blake3` needs (row 160 installed with `--no-deps`). Pin it with its hash, run the script from a clean virtual
environment to its end (or to the first fetch the network refuses, said so), and check nothing else in the file is
unpinned.

**Deliverable:** `lab/av1/requirements.txt`. **Branch:** `claude/av1-unified-mainbase`.

## The net-improvement round, windows 1 and 2 (rows 171–188), 2026-10-13

**The owner, 2026-10-13:** theoretical investigation can lead to empirical testing outside the ideas the owner
proposed — those are simply proposals. The orchestrator may plan up to two usage windows. Tiles for large frames are
interesting (row 175). Several streams should be investigated for the QUIC implementation research (row 174).

Rows 171–177 run in the usage window that opened 2026-10-13 ~13:20 UTC; rows 178–188 are held for the next. Each row's
proposals for further measurement are welcome beyond its brief: name them (a name and one question) in the
deliverable for the orchestrator to queue. The round's reading of *net* is row 165's round brief.

### 171 ASKAHEAD

**Measurement, by row 167's protocol** ([`../transport/link-conditions.md`](../transport/link-conditions.md)
§Re-measured, proposed, *ASKAHEAD*): read that item and its decision rule, nothing else of row 167, before the numbers
are in. The arm is lab-only (a server flag, off by default). Also run the arm `levers.md` adds to it (HyStart's queue
cut, cq W4b) if the server can take it as a flag; otherwise say so. **Deliverable:** that item's §Measured, in place.
**Branch:** `claude/av1-unified-mainbase`.

### 172 WRITERMEASURE

**Measurement, by row 168's protocol** ([`../disk-layout/README.md`](../disk-layout/README.md) §The writer, *Protocol
for the measuring row*): read the protocol and its rule (a)–(e) only, not §Why its files read slower, before the
numbers are in. Hit and forced miss through the store's levers, never page-cache eviction. If the rule adopts a fix,
make it in `pack-series` (and `from-parser` if it shares the writer) with a test that fails without it.
**Deliverable:** that section's §Measured. **Branch:** `claude/av1-unified-mainbase`.

### 173 NETRULES

**One question: judged by an A/A arm's spread instead of a fixed bar, do rows 134 and 142's three refused levers have
a fair protocol?** Theory. The levers: P-EMSDK (OpenJPH under emscripten 6.0.x with `wasmBinary` restored; row 134's
×0.886–0.931 on projections and its ×1.061 cell), P-COPY (the shared-heap copy; RGB ×0.866 on a synthetic set only,
memory −5 to −25 MB; add a sound RGB set), and `startOnNeed` (row 142: decoder CPU −4 to −14 %, wake-ups −56 to −82 %,
misses against a fixed bar). Sources: `docs/codecs/README.md` §Tried and open (EMSDKNET, COPYRGB), `docs/levers.md`
(COPYNET, STARTAA), `docs/decode/README.md` §Not yet tried. For each: the A/A arm, cells at row 162's rates (100 and
300 Mbit/s, a 0.7 s loaded RTT), predictions and a rule that adopts it only if no cell is worse beyond the A/A spread.
**Deliverable:** `docs/decode/README.md` §Not yet tried, a *Net protocols* part. **Branch:**
`claude/av1-unified-mainbase`.

### 174 QUICSTREAMS

**The owner, 2026-10-13:** several streams should be investigated for the QUIC implementation research. Read here as
QUIC streams: how many, how scheduled, and what each stack does with them (the owner corrects this reading if it meant
something else). **One question: how does each QUIC stack treat many streams, and which stream design serves a fill and
an ask best at the measured links?** Theory, at each stack's best configuration (row 157's rule).

* **The product today:** `docs/WIRE.md` §Stream modes (`shared` default, `per-frame` with ask-order priority, `pool:k`
  retired), [`../adr/stream-shape.md`](../adr/stream-shape.md),
  [`../adr/frame-framing-and-loop-shape.md`](../adr/frame-framing-and-loop-shape.md) (`set_priority`), row 167's
  ask behind the written-ahead fill, row 171's arm.
* **Each stack of `docs/native/quic-compared.md`, and the browsers' clients:** the send scheduler (round robin,
  priority, incremental; RFC 9218), retransmission order across streams, per-stream and connection flow control and
  their auto-tuning, `MAX_STREAMS` and a stream's open cost, head-of-line blocking under loss, how much the
  application can bound what is written ahead per stream; WebTransport's `sendOrder` / `sendGroup` and what each
  engine implements. File:line at a pinned tag.
* **Several streams against one**, and several connections: what each buys at 18, 103 and 309 Mbit/s and 0.2–0.8 s
  loaded RTT (row 162), with the derivation; net or a trade-off.
* **Close with a protocol** for a separate session (the arms a container can run through the product), predictions and
  a decision rule, and further rows if the theory points elsewhere.

**Deliverable:** `docs/native/quic-compared.md` §Streams. **Branch:** `claude/av1-unified-mainbase`.

### 175 TILESTORE

**The owner, 2026-10-13:** tiles for large frames are interesting. **One question: what exactly would the store, the
wire and the client carry for tiles?** A proposal, nothing built (a store-format change is structural). Start from row
133's measurement (`docs/decode/README.md` §Not yet tried, P-TILE: ask ×0.388–0.448 at 4× on the three large series,
bytes +0.01–0.59 %), row 143's ADR ([`../adr/resolution-fitting-for-large-frames.md`](../adr/resolution-fitting-for-large-frames.md)
§8, its five choices and the owner's ruling on device pixels), and the draft target's layout 1
([`../disk-layout/target.md`](../disk-layout/target.md)). Give each open choice a recommendation and its reason; the
frame sizes from which tiles are used and k by size (nothing past k = 3 is measured); the per-tile digests; how a fill
and an ask ask for tiles; what HTJ2K-unchanged means for series below the threshold; the migration of stored series.
Close with the measurement the proposal still needs. **Deliverable:** `docs/disk-layout/target.md` §Layout 1, tiled,
and the ADR's §8 updated. **Branch:** `claude/av1-unified-mainbase`.

### 176 HASHFAST

**One question: can the frame check's XXH3-64 run faster in the decoder worker, digest unchanged?** Theory. Row 151:
~3.3 GB/s in both engines, 4–12 % of an HTJ2K frame (8 ms on a 69 ms mammogram). Read the shipped hasher (which
library, which build, whether it copies the samples into its own heap), XXH3's SIMD128 paths and what a WASM build
reaches in published or derivable numbers, and hashing in the decoder's heap before the hand-off. Predictions and a
protocol with a rule (net only if the digest is bit-identical on every frame and no cell is slower). **Deliverable:**
`docs/adr/exactness-in-production.md`, a section on the check's speed, or the doc that owns row 151's numbers.
**Branch:** `claude/av1-unified-mainbase`.

### 177 DOCFIX

Row 166's *Found on the way* (`docs/levers.md`), each corrected in place in the doc that owns it, no new claim: the
docs still stating the old band (`docs/rig-limits.md` §1's 768 KB "never binds", `docs/native/quic.md` §7's
5–50 Mbit/s and "0.4–0.7 % of a core"), pointing to `docs/transport/link-conditions.md`; the dangling owners (rows 49,
54, 86; `CLAUDE.md`'s `docs/disk-access/adr.md` → `docs/adr/disk-access.md`); `docs/ARCHITECTURE.md` §Open's stale
lines; the coded-bytes digest open in one doc and agreed in another; and the owner calls row 166 found missing from
§Blocked, added there. Gate green. **Deliverable:** the corrected docs. **Branch:** `claude/av1-unified-mainbase`.

### 178 NETMEASURE, 179 HASHMEASURE, 180 STREAMSMEASURE

**Measurement, each by its theory row's protocol** (173, 176, 174), in a session given only the protocol and its rule.
If the theory row proposed no protocol a container can run, the row is done with that line. A lever adopted by its rule
is built beside today's path, off by default where it changes behaviour, with a test that fails without it.
**Deliverable:** the protocol's §Measured, in place. **Branch:** `claude/av1-unified-mainbase`.

### 181 IWDEEP, 182 FASTCLOCK

**Measurement, each by row 167's protocol** of that name ([`../transport/link-conditions.md`](../transport/link-conditions.md)
§Re-measured, proposed); read only that item and its rule before the numbers. **Deliverable:** that item's §Measured.
**Branch:** `claude/av1-unified-mainbase`.

### 183 ASKBEHIND, 184 READERPAUSE, 185 HTJ2KPACK, 186 JXLRS, 187 INITIALREPLY, 188 JPEGLS

**Theory, each by its one question** as row 165 (`docs/codecs/README.md` §Left, ranked: HTJ2KPACK, JXLRS, JPEGLS) or
row 166 (`docs/levers.md` §Proposed rows: ASKBEHIND, READERPAUSE, INITIALREPLY) states it, with its basis there. Each
writes the mechanism, predictions, a protocol and a decision rule for a separate measuring session, and says whether
the lever can be net at all or is a trade-off for the owner. JPEGLS and JXLRS at each codec's tuned best, never its
defaults. **Deliverable:** the doc that owns the lever (the codec's doc under `docs/codecs/`, `docs/decode/README.md`,
`docs/transport/transport-conclusions.md`). **Branch:** `claude/av1-unified-mainbase`.

### 189 INITIALMEASURE

**The owner, 2026-10-13:** investigate row 187. **Measurement, by row 187's protocol**
([`../transport/transport-conclusions.md`](../transport/transport-conclusions.md) §3, *Answering a repeated Initial*):
read its four arms (today, A′, reply, the 100 ms initial RTT), predictions and rule, nothing else of row 187, before the
numbers are in. The reply is built beside today's path, a server flag off by default, with a test that fails without it.
**Deliverable:** that section's *Measured*. **Branch:** `claude/av1-unified-mainbase`.

## The owner's evening rows (190–195), 2026-10-13

**The owner, 2026-10-13 (night):** stop speculating and test with a phone — the owner's phone, local machine and the
Oracle cloud machine are available, and it is time to plan that. Row 174's link analysis is too narrow; a wider range
of bandwidth and loss is needed, and in theory several streams should beat one under head-of-line blocking — the
phone tests will settle it, or give a first view. Row 181 is promising: kept as an experimental proposal (a pull
request), not merged. Row 182's GSO cap: yes. Complementary approaches to the codecs should be researched, especially in
theory (the bit split, as AV1 has). The target conditions should decide trades such as row 180's. File reading in
Docker, the likely deployment, is for a local agent.

### 190 DEVICEPLAN

**One question: what is the smallest set of real-device runs that settles the questions the lab cannot?** A plan, nothing
run. Devices: the owner's phone (model, OS and browsers asked of the owner and written in), the owner's local machine,
the owner's Oracle cloud machine as the server on the public internet. Start from what the container could not settle:
one stream against several under real loss (rows 174, 180, 193), the initial window (181), the ask during a fill (171,
180), the repeated Initial (187, 189), decode and paint time on a phone for HTJ2K, dav1d-WASM and WebCodecs (rows 9,
44, 161), the phone's memory, energy if measurable. For each: the arms, the links (the phone on cellular and Wi-Fi as
they come, and the local machine's `netem` for controlled rate, RTT, loss — random and bursty — across a wide range),
how a run is driven and recorded on a phone (a page that runs the arms and posts its results), interleaving, n, what
decides. Also the server side: deploying the image on the Oracle machine (`deploy/`), TLS, the ports to open, the
rig-limits that apply (`docs/rig-limits.md`), what the public repository must not carry (an address, a key). Order the
runs so the first gives a view in one evening. **Deliverable:** `docs/devices.md`. **Branch:** `claude/av1-unified-mainbase`.

### 191 IWOPTIN

Row 181 made 38 400 bytes the server's default initial window. The owner keeps it as an experimental, promising
proposal, not merged: put the default back to quinn's 12 000, keep 38 400 behind a server flag (off by default), its
test failing without the flag's effect, and mark row 181's verdict in `docs/transport/link-conditions.md` and
`transport-conclusions.md` as *proposed, opt-in*. The orchestrator opens the proposal as a draft pull request that flips
the default. Gate green. **Deliverable:** the server change and the docs. **Branch:** `claude/av1-unified-mainbase`.

### 192 GSODEFAULT

The owner, 2026-10-13: yes to row 182. The default server build applies `patches/quinn-0.11.11-mtu-gso.patch` with the
segments per `sendmsg` capped at 24 (today the patch is opt-in and caps at 45): the build, the deploy image, the gate's
`--check`, and `transport-conclusions.md` §4 and its §9 call updated in place. A test that fails if the cap is not 24 in
the default build. Name what still carries the patch (quinn-rs/quinn#2189). Gate green. **Deliverable:** the build change
and the docs. **Branch:** `claude/av1-unified-mainbase`.

### 193 STREAMSWIDE

**One question: under head-of-line blocking, where must several streams beat one, and why have the measurements not
shown it?** Theory. The owner, 2026-10-13: it does not make sense that several streams do not beat one under
head-of-line blocking; row 174's analysis is too narrow in link conditions. Range: 1–1 000 Mbit/s, idle RTT 5–300 ms,
queues 10 packets to 1 s, loss 0.01–10 %, random and bursty (Gilbert–Elliott, with published parameters for cellular and
Wi-Fi where they exist). Separate the costs a loss imposes: the held bytes behind a gap (head-of-line, per stream), the
controller's cut (per connection, shared by every stream), the repair's place in the send queue (quinn's retransmit
order, `adr/stream-shape.md`), the receive credit. Derive, per cell, one stream, k streams (k = 2–8 and one a frame),
and k connections: time to each frame, a fill's end, an ask's wait. Reconcile with every measurement so far (rows 75,
171, 174, 180, the stream-shape campaigns): where the model says several streams win and the data did not, say which
cost hid it. Predictions and a protocol for row 190's device runs. **Deliverable:** `docs/native/quic-compared.md`
§Streams, a *Wide range* part. **Branch:** `claude/av1-unified-mainbase`.

### 194 COMPLEMENT

**One question: beside the codec, what could cut lossless bytes or decode time, and how much can any lossless coder
gain at all?** Theory. The owner, 2026-10-13: JPEG XL's small gain was a surprise; complementary approaches should be
researched, especially in theory — the bit split as AV1 has. Candidates: the bit split for HTJ2K (row 36: 0.9–1.6 %
with the low bits deflated) and for JPEG XL (never tried); inter-slice decorrelation for volumes (JPEG 2000 Part 2 across
slices, +3 % by Clunie 2012 in `lossless-literature.md`; a reversible slice difference before HTJ2K); value maps (row
185); background and collimation masks; per-region coding. **The bound first:** estimate each target series' noise
entropy (from the sensor's noise model or flat regions) to bound what any lossless coder can save over HTJ2K, so a
candidate's ceiling is known before it is tried. Each candidate: mechanism, predicted bytes and decode against HTJ2K,
net or a trade-off, a protocol. **Deliverable:** `docs/codecs/README.md`, a *Beside the codec* section. **Branch:**
`claude/av1-unified-mainbase`.

### 195 DOCKERREAD

**For a local session on the owner's machine** (`local`: no cloud session claims it). **One question: does the server's
read path keep its measured costs inside a Docker container, the likely deployment?** Measure, after a short theory
section with predictions and a rule. Arms: the store on the container's overlay filesystem, on a bind mount, on a named
volume; the host without Docker as the reference. Per arm: hit and forced-miss latency through the store's levers (never
page-cache eviction), fill throughput, CPU per GB; folios per frame (row 172's `kpageflags` method) after a pack and after
the fill's `WILLNEED` (row 172's (d): 41–123 folios a 160–500 kB frame against 7–9, hits ×2.0, fill ×0.64–0.68, CPU per
GB ×1.5); whether `RWF_NOWAIT` and io_uring work under Docker's default seccomp profile, and the fall to the pool if not
(`adr/disk-access.md`: 132.5 against 48.4 µs a frame); `memlock` and `nofile` limits (row 166's DEPLOYLIMITS). The
deploy image as `deploy/` builds it. Measure row 199's settings as arms and row 198's candidates that a container changes. **Deliverable:** `docs/adr/disk-access.md`, a *In a container* section.
**Branch:** `claude/av1-unified-mainbase`.

## The owner's night rows (196–206), 2026-10-14

**The owner, 2026-10-14:** row 172's read-ahead finding is approved for investigation. Look for something faster
than today's io_uring path; if Docker's defaults do not allow it, find how to tune the container to — very worth it.
Row 190's device plan needs more aggressive, fast feedback rounds: it is late, and quick rounds to adjust are more
efficient. The phone: a Samsung, Android 16, Chrome and Firefox (or whatever is needed). The congestion controller
needs attention: Cubic does not fit loss, BBR does with a trade — what else should be considered?

### 196 WILLNEEDFOLIO, 197 WILLNEEDMEASURE

**One question: can the fill's read-ahead build large folios, with the fill's wait unchanged?** Theory (196), then
measurement by its protocol in a session given only it (197). Row 172 (`docs/disk-layout/README.md` §The writer, (d)):
after reclaim the fill's `POSIX_FADV_WILLNEED` builds 4 KiB folios (`mm/readahead.c:275–276`), 41–123 a 160–500 kB
frame against `pack-series`' 7–9: hits ×2.02 and ×1.99, fill ×0.68 and ×0.64, fill CPU per GB ×1.49 and ×1.56 on the
host's ext4. Candidates: a blocking `readahead(2)`, `MADV_POPULATE_READ` on a mapping, larger `WILLNEED` ranges,
`read_ahead_kb`, reading ahead through the ring; each with its kernel source at v6.18, its effect on the fill's wait
and on concurrent sessions, and the filesystems that differ (XFS tied in row 172). **Deliverable:** `docs/adr/disk-access.md`,
a *Read-ahead and folios* section. **Branch:** `claude/av1-unified-mainbase`.

### 198 READFASTER

**One question: is anything faster than today's read path, on a hit and on a miss?** Theory. Start from
`docs/adr/disk-access.md` (the shipped reader: `RWF_NOWAIT` inline, io_uring on a miss; its measured µs a frame, and what
was rejected and why). Candidates, each at its tuned best: io_uring with registered buffers and fixed files, `SQPOLL`,
`IOPOLL` with `O_DIRECT`, multishot and linked reads, NVMe passthrough (`uring_cmd`), huge pages, `mmap` with
`MAP_POPULATE` or `MADV_POPULATE_READ`, a frame cache in user space, and where QUIC's encryption forces a copy anyway
(so `sendfile`/`splice` cannot help). Per candidate: the mechanism, where today's µs go and which it removes, predicted
µs a frame on a hit and a miss at 32 kB–3 MB, what it needs from the kernel and a container (row 199), net or a trade-off,
a protocol. **Deliverable:** `docs/adr/disk-access.md`, a *Faster than today* section. **Branch:** `claude/av1-unified-mainbase`.

### 199 DOCKERTUNE

**One question: what must a Docker deployment set so the server keeps its full read path, and at what security cost?**
Theory, for row 195 to measure on the owner's machine. Docker's default seccomp profile and io_uring (which syscalls,
since which Docker and moby versions, and why: the io_uring CVE record, the platforms that disable it); a custom seccomp
profile that allows `io_uring_setup`, `io_uring_enter`, `io_uring_register` and nothing more; `--ulimit memlock` and
`nofile` (row 166's DEPLOYLIMITS: ~940 rings at the 8 MB default); the storage choices (overlay, bind mount, volume) for
the page cache and folios; `--security-opt`, capabilities, user namespaces, rootless Docker, Podman, and Kubernetes'
equivalents; what the server must do where io_uring stays off (the pool's 132.5 against 48.4 µs a frame), and a health
check that says which path is live. **Deliverable:** `deploy/README.md`, a *Container settings* section, with the
seccomp profile as a file beside it. **Branch:** `claude/av1-unified-mainbase`.

### 200 CCNEXT

**One question: beyond Cubic and BBR, what congestion control fits the target, and what else must be considered?**
Theory. Row 193: under Cubic several streams cannot help, since the cut keeps the window at ~1.2 ÷ √p packets; they win
only under a loss-blind controller, and several connections win by their number. Row 180: asks-first loses behind a deep
queue because a loss-based controller fills it. Read rows 75, 103–107, 119, 132, 140, 141, 146 and
`transport/transport-conclusions.md` §1 first; do not redo them. Candidates: BBRv3 (and what quinn's BBR lacks of it),
Cubic with a loss classifier (row 141's option 1, reopened Cubic-only), Copa, Vegas- and LEDBAT-like delay control,
HyStart++, L4S and ECN on cellular and Wi-Fi today, pacing, forward error correction for tail loss, choosing the
controller per session from what the session measures, several connections and their fairness. Each against row 162's
links and row 193's range: the fill, an ask's wait (with asks-first), the standing queue, the share left to a neighbour;
net or a trade-off; what a phone run (row 190) must measure to decide. **Deliverable:**
`docs/transport/transport-conclusions.md` §1, a *Beyond Cubic and BBR* part. **Branch:** `claude/av1-unified-mainbase`.

### 201 DEVICEKIT

**Build what row 190 (`docs/devices.md`) needs so a device evening is setup-free and fast.** The owner wants quick
feedback rounds. The phone is a **Samsung, Android 16, Chrome and Firefox** (write it into §1; model and versions read
by D0). Build, tested in the container as far as it can be:
* the **runner page** (§3): the arms and Williams order for D0, D1 and D2, results kept in IndexedDB, posted after every
  round, a save button; a **quick mode** — n = 3 rounds, the arms that answer the evening's questions first — that
  prints a provisional reading on the phone's screen in about 15 minutes, before the full n ≥ 10;
* the **collector** on the server's host (behind a token from the environment);
* the **deploy script** for the Oracle machine (§4): copy the image built on the local machine, the four D2 arms on four
  ports, `server-start.sh` taking a supplied certificate, the ports checked first; nothing identifying in the repository;
* a **one-page checklist** for the evening, the owner's taps in order, with the commands for the local machine.
**Deliverable:** the kit under `lab/devices/`, `docs/devices.md` updated. **Branch:** `claude/av1-unified-mainbase`.

### 202 ASKTHENFILL

**One question: if the fill is re-asked at once after an ask, does row 171's cap on bytes ahead keep its faster ask with
the fill unchanged?** Theory, from row 171's measurement and its proposal (`docs/transport/link-conditions.md`
§Re-measured, *ASKAHEAD*, Measured): row 171 found the ask −39 to −67 % and the fill +5–11 % at 103 Mbit/s, the remainder
re-asked a round trip after the ask. Mechanism, predictions across row 193's range, and a protocol and rule.
**Deliverable:** that section, an *ASKTHENFILL* part. **Branch:** `claude/av1-unified-mainbase`.

### 203 FFSTALL

Row 182 saw Firefox 157 stall ~6 s before the last byte in 9 of 240 visits (`docs/transport/link-conditions.md`
§Re-measured, *FASTCLOCK*, Measured). **One question: what stalls, and is it ours?** Reproduce it, find the cause from
logs and the server's and Firefox's (neqo's) source at their pins, and fix it if it is the server's or the client's,
with a test that fails without the fix; if it is Firefox's, write the report upstream would need. **Deliverable:**
`docs/transport/transport-conclusions.md`, a section of its own. **Branch:** `claude/av1-unified-mainbase`.

### 204 DEVICE1, 205 DEVICE2, 206 DEVICE3

**For a local session with the owner** (`local`), each by its run's protocol in `docs/devices.md` and row 201's kit:
204 is D0, D1 and D2 in one evening, quick mode first; 205 is D3; 206 is D4 and D5. Raw rows stripped of anything
identifying (§4), the reading in the doc that owns the subject. **Branch:** `claude/av1-unified-mainbase`.

### 207 ASKFIRSTCAP

**One question: does asks-first stop losing behind a deep queue if the bytes in flight stay capped?** Theory. Row 180's
asks-first (`docs/native/quic-compared.md` §9.5, Measured) cut an ask ×0.28–0.43 behind short queues but was ×1.97 behind
800 ms at 18 Mbit/s: one stream a frame lifts the shared stream's 6 MiB receive credit as the cap on bytes in flight, so
Cubic fills the deep queue further, and no priority reaches bytes already in the network. Derive asks-first with a cap —
row 171's send window (cwnd + M), and a fixed cap of 6 MiB across all streams — across row 193's range; with each
controller row 200 ranks; predictions, a protocol and a rule (net only if never worse than `shared` in any cell).
**Deliverable:** `docs/native/quic-compared.md` §9, an *Asks first, capped* part. **Branch:** `claude/av1-unified-mainbase`.

## The night of 2026-10-14 (rows 208–214)

**The owner, 2026-10-14:** going to bed; the local machine and the Wi-Fi are off for the night, and the night should be
used. The Oracle machine is §9's cloud rig; a domain for its certificate is possibly a good idea. These rows need
neither the owner's machine nor the phone; held for the usage window that opens at 03:00 UTC.

### 208 DOCKERCLOUD

**Measurement, by row 195's protocol only:** `docs/adr/disk-access.md` §6 *In a container* on `claude/wip-dockerread`,
from the heading *Protocol for the measuring row (row 195)* down — read nothing of that section above it before the
numbers are in. Run it as `lab/container-bench/README.md` §*In a container (row 195)* says (`dockerread.py` data →
place → check → folios before → time, 28 rounds → folios after → `dockerread_summary.py`), with every setup the
protocol names, in this cloud container: `sudo dockerd` starts here (Docker 29.8.2, rootful, overlayfs, default
seccomp; root for `/proc/kpageflags`). Say what differs from the rig the protocol was written on: the runtime, whether
SELinux enforces (if not, B+UL equals B+U), the filesystem (ratios to H transfer, absolute µs do not), the cores free
for pinning, and that this is a cloud VM. Work on `claude/wip-208-DOCKERCLOUD` made from `claude/wip-dockerread`; write
the measured part into the same section, check each prediction, apply its rule (c). Adopting the io_uring profile, and
`label=disable` against a narrow SELinux module, stay the owner's. The whole lands on `claude/av1-unified-mainbase` when
finished (it is additive: a lab rig and a doc section); then set rows 195 and 208 done. If an image cannot be pulled,
say which and stop. **Branch:** `claude/wip-208-DOCKERCLOUD`, then `claude/av1-unified-mainbase`.

### 216 DOCKERORACLE

**For a local session** (`local`): row 195's protocol on the Oracle cloud rig (`docs/rig-limits.md` §9), which the
owner's machine reaches and cloud sessions do not, by the same how-to, after row 208 has landed the rig. Same reporting
of what differs; the reading beside row 208's. **Branch:** `claude/wip-216-DOCKERORACLE`, then `claude/av1-unified-mainbase`.

### 209 READMEASURE, 210 ASKTHENFILLMEASURE, 211 ASKFIRSTCAPMEASURE, 212 CCMEASURE, 213 INTERSLICE

**Measurement, each by its theory row's protocol** (198 in `docs/adr/disk-access.md` §13; 202 in
`docs/transport/link-conditions.md` §Re-measured, *ASKTHENFILL*; 207 and 200 in their deliverables; 194's INTERSLICE in
`docs/codecs/README.md` §Beside the codec), in a session given only the protocol and its rule. A lever its rule adopts
is built beside today's path, off by default where it changes behaviour, with a test that fails without it. Where a
protocol needs a phone or the owner's machine, run what the container can, say what is left for row 204–206's device
runs, and do not claim it. **Deliverable:** each protocol's *Measured*. **Branch:** `claude/av1-unified-mainbase`.

### 214 DISPLAYTAGS

Row 169 (`docs/display.md` §The gaps): the ingest drops ICC Profile, VOI LUT Sequence and Presentation LUT Shape;
reading them is net where a series carries them. First count which sound series carry each (COLORTAGS, VOILUT). Then,
for what exists: the ingest keeps them in the series' metadata, and the painter applies a VOI LUT Sequence and the
Presentation LUT Shape per PS3.3 (and an ICC profile's colour space where the canvas allows), with the reference painter
(`client/paint/reference.js`) checking each and a test per tag that fails without it. Nothing changes for a series
without the tags. **Deliverable:** the ingest and paint changes, `docs/display.md` updated. **Branch:**
`claude/av1-unified-mainbase`.

### 215 CLEANAUDIT

**The owner, 2026-10-14:** the work branch, the main branch of work for merging, must be clean, optimized, completely
functional and improved, simplifications included — with rules for them, such as not losing capabilities and the
benefits of a simpler system. **One question: what stands between `claude/av1-unified-mainbase` and that?** An audit;
nothing removed or changed but its deliverable.

* **Every item on the branch that is not finished product:** half-finished rows' code, provisional numbers, lab-only
  flags and code paths compiled into the product (row 83's list: `server/src/main.rs` lab flags, `readMin`, the
  rejected read shapes, product dependencies under `lab/`), dead code, duplicated logic, tests that do not run in the
  gate, docs that contradict the code. Each with its evidence (file:line), and one of *keep*, *finish*, *simplify*,
  *move to lab*, *remove*, with the capability it would cost — a change that loses a capability the product has is not
  proposed — and its size.
* **What "completely functional" means here:** the gate green with nothing skipped that could run, the deploy image
  building and serving, the viewer filling and asking end to end in Chromium and Firefox; each checked, and what fails.
* **The simplification rules, drafted** for the owner to put in `CLAUDE.md`: what a simplification may remove (code
  with no caller, a flag whose measurement is recorded in `docs/`, a path a measurement rejected) and what it may not (a
  capability, a measured gain, a check), how the benefit is stated (lines, dependencies, concepts a reader must hold),
  and how one is proved (the gate, the same measurement before and after).
* **Close with rows** for the orchestrator to queue, ranked by what merging needs first.

**Deliverable:** `docs/merge-readiness.md`. **Branch:** `claude/wip-215-CLEANAUDIT`, then `claude/av1-unified-mainbase`.

## The merge cleanup (rows 217–228), 2026-10-14

**The owner, 2026-10-14:** decision 2, the cleanup, approved: "I think we should do it". The rows are row 215's
[`docs/merge-readiness.md`](../merge-readiness.md) §Rows to queue, in its order; each item's evidence (file:line), verdict, cost and size are there, and a row reads
its items before anything else. No row loses a capability the product has. A row marked *review* below removes or
alters what exists, so it finishes on its wip branch with the gate green and stops at a draft pull request for the
owner (§The work branch holds finished work only); it never lands itself. The draft simplification rules in that
document's §The simplification rules are **not adopted** (the owner has not ruled on them); until then a row proves
itself as `CLAUDE.md` and §Protocol already ask: the gate green with the same skips or fewer, every test it touches
mutated once, and its benefit stated as counts (lines, dependencies, concepts). Rows 219, 223 and 227 touch files an
earlier row of this round changes (`client/viewer/viewer.js`; the Containerfile and nginx; `tuning.rs`, `read_path.rs`):
while that row waits in review, the later one starts from its wip branch and says so in its cell.

### 217 VIEWERLOCK

*Review.* B1, which blocks any deployment: `?opts=` is spread into `connect` unchecked (a `transport` module imported,
`decoder.glue` run through `new Function` with its pin optional), `?wt=`, `?hash=` and `?metadata=` replace the server
and the digests with frames still shown exact, and no Content-Security-Policy is sent. The product page reads only
`/wt/dev-transport.json` and `/series/metadata`; the levers stay, honoured on the dev host or by a lab build alone, so
the total-time and check harnesses keep them; nginx and the dev host send a CSP limiting scripts and connections to
the page's origin and the transport. A test loads the page with each crafted parameter and shows it refused, and fails
on today's page. **Deliverable:** the change, `client/README.md` and `deploy/README.md` updated. **Branch:**
`claude/wip-217-VIEWERLOCK`, then a draft PR into `claude/av1-unified-mainbase`.

### 218 DEADHASHER

*Review.* B2: `hasher: "hash-wasm"` never reaches the decoder (the downloader's init message carries none), yet the
docs call it "one init flag away" and the web image refuses to build without the vendor file it never loads. Remove the
option and the image's `test -f`; hash-wasm stays as `xxh3.test.mjs`'s reference; correct `client/README.md` and
`docs/adr/exactness-in-production.md` in place. §Blocked's 2026-10-14 entry on the gate's browser frame
checks proposes the opposite (forward `hasher`); the pull request names that entry, and the owner picks one.
**Deliverable:** the change and the docs. **Branch:** `claude/wip-218-DEADHASHER`, then a draft PR into
`claude/av1-unified-mainbase`.

### 219 VIEWERASKS

Fixes, each with a test that fails without it: B3 (a frame whose ask is pending is not asked again, so no false
"already requested" error), B4 (two quick on-demand steps keep the newest ask alone), B7 (the WebSocket test takes a
port free for UDP and TCP and reports the server's own error; mutate by holding the TCP port), F4 (in on-demand mode
the viewer check judges what was asked; the gate runs `--fill 0` and `--cine`). **Deliverable:** the fixes and their
tests. **Branch:** `claude/wip-219-VIEWERASKS`, then `claude/av1-unified-mainbase`.

### 220 INITIALPATCH

*Review; held for the owner.* H1: row 189's build (`5b5d68c3`) predates `f57700d3`, so cells A and C ran every arm at a
38 400-byte initial window, and its "today" arm is not today's 12 000 default; row 189 is done (the rule does not pass,
the flag stays off) and its cell does not name this. The owner asked on 2026-10-14 whether row 189 is a net win to
adopt; that ruling decides this row. If the reply is not adopted: state the confound in row 189's cell and in
`docs/transport/transport-conclusions.md` §3 *Measured: INITIALMEASURE*, then remove the flag, the patch
(`patches/quinn-proto-0.11.18-reply-repeated-initial.patch`) and its tests (~−270 lines). If it is adopted, this row
re-runs cells A and C at 12 000 first. **Deliverable:** the change, or the re-run. **Branch:**
`claude/wip-220-INITIALPATCH`, then a draft PR into `claude/av1-unified-mainbase`.

### 221 LABTRACES

*Review.* L1: `cc_trace` wraps every controller in the default binary and an unopenable `WTPACS_CC_TRACE` panics the
server; put it behind `telemetry`, build its two lab users with that feature, and widen
`server/scripts/check_telemetry_absent.sh` to its variables and `record::path` (mutate: the check fails on today's
binary). X1: `crypto-ring` as plain dependency features. X2: the seven transport modules `pub(crate)`. X3:
`FrameStore::file` behind `#[cfg]`. **Deliverable:** the change, `server/README.md`'s lab list in step. **Branch:**
`claude/wip-221-LABTRACES`, then a draft PR into `claude/av1-unified-mainbase`.

### 222 INGESTTOOLS

*Review.* The product's steps stop needing `lab/`: B6 (`default-members`, so a bare `cargo build` works on a fresh
clone), P1 (`ingest/tools.sh` builds aom 3.15.1, dav1d and OpenJPH 0.31.0 at their pins into a product directory;
`lab/av1/tools/tools.sh` calls it; README lists `meson`), P2 (`ingest/requirements.txt`, which lab's includes, pinned
for CPython 3.11–3.13, or the README says 3.11), P3 (README §The viewer on a DICOM series works from a fresh clone,
run once to show it), P4 (`aomenc` checked for AV1 only), P5 (the split's merge test and `server_start_test.sh` beside
what they test, `splits()` inlined). **Deliverable:** the change and README. **Branch:** `claude/wip-222-INGESTTOOLS`,
then a draft PR into `claude/av1-unified-mainbase`.

### 223 IMAGESLIM

*Review.* L4: the web image copies the page's allow-list only (the audit lists it), not all of `client/`. L5: the build
copies each lab crate's `Cargo.toml` and `src/`, not 2.5 MB of results, and the dead `!lab/telemetry-cost` line goes.
F1: `deploy/check_equivalence.sh --local` is a gate step where nginx is on PATH, named as skipped otherwise, and it
checks that the harness pages answer 404. The image built and the viewer check passed through it, as row 215 did.
**Deliverable:** the change, `deploy/README.md` in step. **Branch:** `claude/wip-223-IMAGESLIM`, then a draft PR into
`claude/av1-unified-mainbase`.

### 224 REJECTEDPATHS

*Review.* L2: the read-ahead hook row 197 rejected (`read_path.rs`), its test and the bench's hook arms removed. L3:
`followQueue` ("neither adopted"), its tests and its lines in `docs/ARCHITECTURE.md` removed; a tag keeps both. L8, row
209's `FrameCache`, **stays as it is, off by default** (the owner, 2026-10-14: "off by default for now"); it is not
this row's. **Deliverable:** the change. **Branch:** `claude/wip-224-REJECTEDPATHS`, then a draft PR into
`claude/av1-unified-mainbase`.

### 225 DOCSTRUE

*Review* (it removes documents). C1–C10 corrected in place as the audit lists them, the queue and campaign labels in
product code named by their measurement (anchors renamed with their headings); C3 `docs/av1/MERGE.md` and C4
`docs/handoff-2026-10-04.md` and `docs/server-design-proposal.md` removed, what is still true folded in (R4 one line in
ARCHITECTURE §Open). H2: the branch's queue copy replaced by this one when the branch merges. `docs/cloud-queue.md`
is not edited. Corrects what rows 217–224 have changed only once they have landed. **Deliverable:** the docs.
**Branch:** `claude/wip-225-DOCSTRUE`, then a draft PR into `claude/av1-unified-mainbase`.

### 226 GATEGAPS

Additive. The gate also runs: F2 `cargo check --features cert-compression`; F3 all four lab crates compiled and their
tests run; F5 the real-decode rigs on `builtDecoder` as well as npm's OpenJPH; F6 the telemetry-absence check over
`ws-session.js` and `race-session.js`; F7 a synthetic DICOM object through `from_dicom.py` to `.sbnd`, and pack-series'
re-pack `cmp`ed. Each new step mutated once. **Deliverable:** `scripts/gate.sh` and the steps. **Branch:**
`claude/wip-226-GATEGAPS`, then `claude/av1-unified-mainbase`.

### 227 DEDUP

*Review.* D1–D8 as the audit lists them: the controller config built once in `Congestion::factory`, one
`preadv2(RWF_NOWAIT)` helper, hit/miss counting once, tests using `series_bundle::write_bundle` (not
`frame_store.rs:277`), `StreamMode` deriving `ValueEnum`, `record` importing the FoD union, one SHA-256-to-hex, one
`metadata()`. **Deliverable:** the change. **Branch:** `claude/wip-227-DEDUP`, then a draft PR into
`claude/av1-unified-mainbase`.

### 228 WASMTOLAB

*Review; structural, so proposed first.* D9: the WASM transport (`client/transport/wasm/`, ~780 lines) is a second
client the product never loads, and the gate needs wasm-pack for it; P6: `client/decode/wasm/dav1d/` is lab tooling
apart from `dav1d_wrap.c`. Write the proposal in `docs/CLIENTS.md` (what moves where, what the gate stops needing,
what stays); the move is made only on the owner's yes. **Deliverable:** the proposal. **Branch:**
`claude/wip-228-WASMTOLAB`, then `claude/av1-unified-mainbase` for the proposal.

### 230 CIGATE

*Review.* The repository has no CI (no `.github/workflows/`), so pull request #36 and every row's draft PR report no
checks; the owner, 2026-10-14: "create a CI with all the checks and tests". Add `.github/workflows/gate.yml`, on
`pull_request` into `claude/av1-unified-mainbase` and `main` and on push to both, that runs `scripts/gate.sh` in full
with every prerequisite README §Prerequisites names present, so that its recap shows no `SKIPPED` line but those
that need a device, a display the runner lacks, or the network beyond pinned fetches; list the skips that remain,
each with why, and fail the job on any skip not on that list. Among them: CPython 3.11 with
`lab/av1/requirements.txt`, Chromium and Firefox pinned, Go, wasm-pack, meson, the lab's coders
(`lab/av1/tools/tools.sh`) cached by their pins, and `client/decode/wasm/build/build.sh` (Docker) so that
`client/decode/wasm/built/` exists (§Blocked, 2026-10-14, the gate's browser frame checks). A second job builds the
deploy image (`deploy/compose.yml`) and runs the viewer check and `deploy/check_equivalence.sh` through it. Actions
pinned by commit SHA; least `permissions:`; caches keyed on lockfiles and tool pins. No timed measurement runs in CI:
shared runners are not a measurement host (`CLAUDE.md` §Measurement). Prove it: one push on the wip branch with a
test broken on purpose turns the job red, and the next restores it. **Deliverable:** the workflow, and README
§Before pushing naming it beside the gate. **Branch:** `claude/wip-230-CIGATE`, then a draft PR into
`claude/av1-unified-mainbase`.

### 231 SECCOMPURING

*Review.* The owner, 2026-10-14: "yes to docker decision" (row 208's rule (c), §Blocked). Give `deploy/compose.yml`'s
`server` `security_opt: ["seccomp=./seccomp-uring.json"]` and the `memlock` and `nofile` limits deploy/README's
settings table sizes for the rings (one uid per server). Prove it through the image: the server's startup line names
the ring, and the read-path tests run 29 of 29 under the profile where Docker's default skips 6; mutate by starting
without the profile and watching the ring line go. `seccomp=unconfined` stays forbidden. On an SELinux-enforcing host
the profile is not enough (`EACCES`); that stays a deploy/README note, and neither `label=disable` nor a policy module
is shipped by default (the owner's, if wanted). Add `deploy/seccomp-uring.sh --check` beside row 230's checks, and
correct deploy/README in place where it calls the profile optional. **Deliverable:** the change. **Branch:**
`claude/wip-231-SECCOMPURING`, then a draft PR into `claude/av1-unified-mainbase`.

## After the merge (rows 232–236), 2026-10-14

The owner, 2026-10-14, asked about performance tests ("shouldn't we have performance tests?") and, on the
answer, "proceed to queue then … queue also the other pending rows": 232 and 233 are that answer; 234–236 are what
the merge cleanup's workers found and did not fix.

### 232 PERFCOUNTS

*Additive.* Shared runners swing too much to time (`CLAUDE.md` §Measurement), so the gate guards performance by
counts that do not depend on the machine: for the gate's synthetic series, the server's disk reads per frame on a
fill and on an ask, the bytes on the wire per series, and the client's asks per frame on a fill, a cine and on
demand. Each count is read from what the product or its existing rigs already report, compared with a baseline
committed beside the check, and fails on any change; changing the baseline is a reviewed line in the diff. Mutate:
a doubled read, an extra ask, a padded frame each turn the check red. **Deliverable:** the check in `scripts/gate.sh`
and its baseline. **Branch:** `claude/wip-232-PERFCOUNTS`.

### 233 PERFNIGHTLY

*Additive.* A scheduled workflow (nightly, and on a `perf` label) builds the base and the head and times them on
`lab/av1/delivery/total-time` with a synthetic series, the arms interleaved by `lab/order.mjs`. It reports each
arm's median and spread and flags a difference only when every round agrees in sign and the medians differ by more
than the base's own round-to-round spread; it never fails a pull request and claims nothing past that runner (say
where it saturates). Prove it: a deliberate 20 % slowdown is flagged, and the base against itself is not.
**Deliverable:** the workflow and a README line. **Branch:** `claude/wip-233-PERFNIGHTLY`.

### 234 TARGETDIR

*Fix.* `client/viewer/run_check.sh:22`, `client/viewer/check.mjs:55` and `scripts/wtcompat.py` run
`target/release/…` directly, so with `CARGO_TARGET_DIR` set the gate fails at the viewer check (rows 218, 219, 221,
226, 227 each worked around it). Resolve the directory from `CARGO_TARGET_DIR` as `from_dicom.py` does (row 226).
`check.mjs` draws its server's port at random without checking it is free, the fault row 219 fixed for the WebSocket
tests (B7): take a free port the same way. **Branch:** `claude/wip-234-TARGETDIR`.

### 235 BUILDCACHE

*Fix.* `deploy/Containerfile`'s build stage mounts one cargo `target` cache shared by every build on a daemon;
row 231 shipped another checkout's stale `series-server` twice, and only `--no-cache-filter build,server` after
touching the sources fixed it (deploy/README §Open). Make the image's binary always the checkout's own: key the cache
to the checkout or build the release outside it. Prove it with two checkouts that differ in one string, built one
after the other on one daemon. **Branch:** `claude/wip-235-BUILDCACHE`.

### 236 NOWAITPROBE

*Additive.* No test checks what `frame_store.rs`'s `RWF_NOWAIT` probe answers: a probe that always says unsupported
passes every test (row 227). Add one that runs where the kernel supports it and fails when the probe is forced to
answer no. **Branch:** `claude/wip-236-NOWAITPROBE`.

## The day of 2026-10-15 (00:00–17:00, rows 238 on)

The owner, 2026-10-15 00:00: "we need also a simplification and improvement round and to plan the work for the
tomorrow, from 00 to 17 (school day and we need to take advantage of the time)". The owner is away until 17:00, so
**every row today ends as a draft pull request into `claude/av1-unified-mainbase`, gate and CI green, and nothing
merges until the owner reviews it at 17:00** (the owner, 2026-10-14: review before a row reaches the work branch).
`claude/av1-unified-mainbase` stays the merge candidate for `main` (merged as #36, `27df9dca`); no push to `main`.
The host has 4 cores: builds, tests and gates run one at a time under `flock /tmp/wt-pacs-heavy.lock`, so at most
three rows run at once, and the measurement window runs alone.

| window | rows | why then |
| --- | --- | --- |
| 00–02 | 238 SIMPLIFYAUDIT (reads only), 234 TARGETDIR, 236 NOWAITPROBE | the audit needs the most time; 234 removes the workaround every later row needs |
| 02–06 | 235 BUILDCACHE, 232 PERFCOUNTS; the audit's rows queued as 239 on | 235 needs the docker daemon to itself; 232 is the largest additive row |
| 06–12 | rows 239 on, three at a time, the non-structural ones only | structural findings stay proposals (`CLAUDE.md`: propose first) |
| 12–14 | 229 REFILLMEASURE alone; 233 PERFNIGHTLY written | a measurement needs a quiet host; 233 is CI configuration, a pull request only |
| 14–16:30 | every pull request driven green and merged into the others where they conflict | the owner reviews a green set |
| 16:30–17 | one list for the owner: each pull request, what to look at, the decisions open | |

**Open for the owner** (none blocks the day): #48 (row 227) into the work branch or not; row 228's proposal; the
SELinux choice (deploy/README §Open); the drafts #37–#41 kept or closed.

### 254–261, drafted by row 251

Each brief and protocol is in row 251's subsection of `docs/adr/disk-access.md` §9 (draft #72). **254 TILECANCEL** (a latent panic after a cancelled pool-path tile read, and the ring-refusal warning once a process) merged 2026-10-16 as #74 (`b51c0e4c`): the next read waits on the same pooled read, the refusal WARNs once a process; reproducing test plus two mutations caught. Measurement rows run one at a time after 253, so no two campaigns share the host: 255 IDLEBUFFERS, 256 CACHESHARED, 258 EXECGAP, 259 TILEWILLNEED, 260 FILLWINDOW, 261 RINGCOOP (after 250). 257 READERTIDY follows 250 and 254. *2026-10-16 02:15, on the owner's "parallelize":* the build halves of 255, 256, 259, 260 and 261, and 257 stacked on #74, started beside 253's campaign; builds pinned to CPU 3 at nice 19 under their own lock, nothing timed until the host is free. 258's arms built beside them, measured on the owner's machine through row 262; #48 (row 227) refreshed onto unified. *05:45:* 258's build half is draft #88 (`fa8c3d01`): G1 (advice on the pool) and G2 (a ring with reads in flight drained on the pool through a `Draining` guard that leaks rather than frees) as arms on the branch head, `lab/scripts/exec_gap.sh` with the row's rule, eight mutations, nothing timed; it runs on the owner's machine from that branch, which carries row 262's kit, and a closed arm is reverted before merge. The build halves of 255, 256, 257, 259, 260 and 261, and 253's analysis, were stopped part-way (the harness records them as stopped by the owner); their worktrees keep the work; restarting waits for the owner. 253's campaign itself finished 05:17:18, EXIT 0, 2 802 rows in `rows253.jsonl`.

### 250 RINGPARKBUILD

Row 244's proposal built, on the owner's yes (2026-10-16): `UringReader` parks on the ring's own fd, the eventfd gone, proven as `docs/adr/disk-access.md` §9 #7 says. The owner also lifted the wait on P0: the production target will not be tested soon, so what was ordered after it goes ahead, built for the best case. **Done — merged into `claude/av1-unified-mainbase` as #73 (`a03016b6`), 2026-10-16:** a tie in `read_path_ab.sh` (12 interleaved rounds; `cold16_d1` p50 −5.7 %, CPU −8.8 %, inside the verdict's tie), one fd per missing session instead of two (counted at 16 and 64 sessions), 27 lines and three `unsafe` blocks fewer; the park test rewritten to catch a missing `clear_ready` (79 829 wakes when mutated).

### 251 READERNEXT

*Theory and audit, the owner's ask (2026-10-16).* The disk readers read again for performance, resources, simplicity, robustness and readability, with P0 no longer a gate: each finding with file:line, a verdict, its cost and, where it needs one, a protocol with its rule; follow-up rows drafted from 254; merged 2026-10-16 as #72 (`13ac3c7c`), nine findings, rows 254–261. **Deliverable:** `docs/adr/disk-access.md` §9, *Next round for the readers*. **Branch:** `claude/wip-251-READERNEXT`.

### 263 WASMPRODUCT

The owner's decision (2026-10-16): row 228 (the WASM client to `lab/`) is rejected, "We want two product clients." A proposal for what the WASM transport client needs to become a product client beside the TypeScript one, with the rows to get there; row 228's proposal in `docs/CLIENTS.md` corrected in place. Draft #76 (`8c165d0b`): selection by a `client` field in `/wt/dev-transport.json`, TS the default; gaps W1–W14, three of them defects on today's WASM path (W4 `refill:"head"` never fires, W5 no dial deadline, W6 `endStream` not a promise); rows WASMSURFACE, WASMRIGS, WASMSELECT and WASMIMAGE (structural), WASMLOAD, by hand. The dav1d tooling half of 228 (P6) rejected too, the same day: the client, its decoders and build tools are a product path. **Branch:** `claude/wip-263-WASMPRODUCT`.

### 274 WASMRIGS

Row 263's second row, on #80: the downloader and dispatch rigs, the ask-during-fill page and the viewer's page check run per client (W13); reverting #80's `endStream` fix fails *cancel during a resume* on WASM through the downloader; and `wrap-session.ts` passes `onHead` through under telemetry. Started 2026-10-16. **Branch:** `claude/wip-274-WASMRIGS`.

### 266 THIRDAUDIT

The owner's ask (2026-10-16): use the night for improvements. Rows 215 and 238's method on the product as merged after #67 and #73, the disk readers (251), the WASM client (263) and lab-only placement (264) excluded; findings ranked, rows drafted from 267. **Deliverable:** `docs/merge-readiness.md` §Third round. **Branch:** `claude/wip-266-THIRDAUDIT`. Merged 2026-10-16 as #77 (`a1333bce`): eleven findings T1–T11, none reached by a test; three stale docs corrected in place; rows 267 PAGESTART, 268 WIREEDGES, 269 PACKATOMIC, 270 SERVERSTOP, 272 WSLIVENESS started 2026-10-16 in parallel; 271 RESTARTPIN (proposal, after 270) and 273 VIEWERCEILING (needs a free host) wait. 269 PACKATOMIC: merged as #81 (`eda3ba83`, head `9720073d`), the bundle written to `NAME.partial` and renamed by `finish`, the sidecar after the pack; four mutations, gate clean up to the local 403; no `fsync` yet (`docs/ingest/design.md` §11). 270 SERVERSTOP: draft #82 (`de7daf19`), close with 0x100 and `wait_idle` ≤ 500 ms, both mutations fail the test; its timed stop protocol (`lab/scripts/stop_timing.sh`) waits for a free host, and a browser may not see the code (wtransport 0.7 sends no close capsule). 272 WSLIVENESS: draft #83 (`fccf8083`), keep-alive 20 s / 5 s × 4 and a 100 ms accept retry, both mutated; the `prlimit --nofile=64` demonstration waits for a free host. 271 RESTARTPIN: proposal written, draft #84 (`2082effb`, docs only), the downloader re-reads a `transportFile` before each re-dial; waits for the owner. 267 PAGESTART: merged as #86 (`0bdef4e2`, re-tested on unified after #87), a worker `error` ends the client by name, the viewer's poll only under `?check=` or a lab hook; mutated. 268 WIREEDGES: merged as #87 (`5cf75041`, head `dea82d40`), `MAX_FOD_LEN` 64 KiB and the WebSocket's `max_frame_size` with it (the audit's 4 MiB WebSocket claim was 16 MiB, corrected in place), the `frame_error` rule tested, T9's stats read only when enabled; four mutations. Found: `lab/ask-ahead/cells.py` lacks `NO_COLOR=1`. Not ours to fix: `CLAUDE.md` still points at `docs/disk-access/adr.md`.

### 265 WASMSURFACE

Row 263's first row: the TS-only surface tests into `clauses.ts`, then W4–W9 fixed in the WASM client; no product path added. Merged into `claude/av1-unified-mainbase` as #80 (`46384ab5`, 2026-10-16, carrying #76's proposal docs): 227/227 on both clients, W6's TypeError reproduced first, every fix mutated on both clients. Found: `client/record/wrap-session.ts` drops `onHead` under telemetry. **Branch:** `claude/wip-265-WASMSURFACE`.

### 264 LABONLY

The owner's rule (2026-10-16): "things only for lab should live in lab/"; a product candidate is kept or not on its measured result. An audit of every lab-only thing in product directories with one pattern for moving it, and its first instance built: `cubic-classify` (row 212: not default) out of `server/` behind a lab feature. #78 merged 2026-10-16 (`3393228d`; docs: O1–O8 lab-only, C1–C10 candidates each naming its decision, one pattern: a lab crate behind `lab-<name>`) and #79 (`cubic-classify` moved to `lab/cc-classify` behind `lab-classify`, `server/src` +30 −179, 12 mutations caught; structural, waits for the owner; #40 would bring it back as the default). **Branches:** `claude/wip-264-LABONLY`, `claude/wip-264b-CLASSIFYTOLAB`. Replaces row 240 CLASSIFYOUT (remove).

### 262 WORKSTATIONRUN

The owner's ask (2026-10-16): real-world testing of the tile reader on his machine, since the production host is not coming soon. One script he runs that records the host, checks the ring natively and in the repo's container (SELinux: the policy module and `label=disable` from `deploy/README.md` §Open, root steps printed, never run), re-runs `read_path_ab.sh` and `server_ab.sh` as `docs/adr/disk-access.md` §9 item 10 asks, hooks row 258's arms, and writes one report to send back. Started 2026-10-16. **Branch:** `claude/wip-262-WORKSTATIONRUN`. Merged as #85 (`88c52b3f`, head `7e515e1d`), 2026-10-16: `lab/scripts/workstation_run.sh` (`--plan`, `--quick`, 12 rounds by default); cold cells read a fresh `O_DIRECT` copy checked by `mincore` (`read_campaign --fresh`), so no eviction and no root; three mutations caught; smoke runs only here, nothing timed. Estimated, not measured: a full run about 53 min and about 450 GB written to the SSD, `--quick` about 38 GB.

### 252 ONEQUEUEBUILD

Row 249's candidate 1 built for measuring, on the owner's yes (2026-10-16): a server lab flag under which an ask no longer ends the fill (served next, the fill resuming behind it), a downloader option that never re-issues, tests for both, and the ask-ahead rig able to run every arm of row 249's protocol. Built 2026-10-16, draft #75 (`ade39ff5`): `--fill-resumes-after-asks` and `refill: "none"`, eight new tests each caught by its mutations, one smoke round of all five arms exact. **Branch:** `claude/wip-252-ONEQUEUEBUILD`.

### 253 ONEQUEUEMEASURE

Row 249's protocol (`docs/WIRE.md` §An ask during a fill, *Proposed: one queue*) on row 252's build, run by a session given only the protocol and its rule. Started 2026-10-16 on #75, branch `claude/wip-253-ONEQUEUEMEASURE`.

### 249 ONEQUEUE

Proposal, merged with #67 (`1d6cb6dc`, 2026-10-16), the owner's idea (2026-10-15): the server holds what the client wants as one ordered queue, a fill appends its run and an ask moves its frame to the front, so an ask never ends the fill and the client re-asks nothing. Row 229's head re-issue is kept as the improvement it measured and marked a patch on the protocol (#66, `310a2a0e`). The candidates, what each removes and the protocol that decides: [`docs/WIRE.md`](../WIRE.md) §An ask during a fill, *Proposed: one queue*, once #71 lands. Nothing is built before the owner's yes.

### 247 TOGETHER

Every draft of the day merged onto `claude/av1-unified-mainbase` in one branch, `claude/wip-247-TOGETHER` (#67), to show they compose: three fixes beyond the merges (#60 × #66 in `downloader.js`, #59 × #62 and #55 × #59 in `docs/merge-readiness.md`), CI green. Merging it is the same as merging every draft; merging some instead needs only those fixes (five, once 248 joined).

### 248 HARNESSTIDY

Draft #69 (`2fcc46b7`): `total-time/run.mjs` waits for its static server to answer instead of a fixed 1 s (the refused visit row 233 met), and refuses a viewer variant that names no codec at parse time; `docs/merge-readiness.md` B5 marked fixed by row 241.

### 239–246

Drafted by row 238; each brief is in [`docs/merge-readiness.md`](../merge-readiness.md) §Second round, each ends as a draft pull request. 243 also corrects
`CLAUDE.md`'s pointer (`docs/disk-access/adr.md` → `docs/adr/disk-access.md`).

### 238 SIMPLIFYAUDIT

*Audit; nothing changes but its document.* Row 215's method on `main` as merged (`27df9dca`): every product file
(`server/`, `client/`, `ingest/`, `common/`, `deploy/`, `scripts/`) and the docs that describe them, read for what can
be removed, simplified, merged or made plainer without losing a capability, and for improvements a measurement in
`docs/` already backs but the code does not use. Run `scripts/comment_budget.sh` and list every file near or past
the budget; list the longest functions and files with what would split them. Each finding: file:line, the verdict
(remove, simplify, merge, move, keep), the capability it costs (none allowed), the lines it saves, and whether it is
structural (`CLAUDE.md`: a structural change is proposed, not built). Rank them by lines saved per risk. Rows already
queued (232–236) and the owner's open decisions are out of scope. **Deliverable:** `docs/merge-readiness.md`
§Second round, with rows 239 on drafted for the orchestrator. **Branch:** `claude/wip-238-SIMPLIFYAUDIT`.

## Blocked

* **2026-10-14, row 228 WASMTOLAB (for the owner):** move the WASM client and the dav1d-WASM tooling to `lab/`, or not ([`CLIENTS.md`](../CLIENTS.md) §Proposed: the WASM client and the dav1d tooling to `lab/`). Moved: README's prerequisites and the gate lose
  wasm-pack, the wasm32 target and binaryen, and the root lockfile 10 packages; the WASM client still runs every clause through
  `WTPACS_WASM_PKG`, but only when the lab runs it. Not moved: nothing changes, and the gate keeps a second, independent client.

* **2026-10-14, row 220 INITIALPATCH (for the owner):** adopt row 189's reply or not. Its rule did not pass on one
  Firefox cell (8–10 ms under the band); against today it is never slower (cell A: browsers 639–701 ms sooner,
  `cold_open` +0 to +81 ms; the 0.7–0.85 s it loses on `cold_open` is against the 100 ms initial-RTT arm); every arm of A and C ran at a
  38 400-byte initial window, not today's 12 000. Not adopted: the flag, patch and tests go for review. Adopted: A
  and C re-run at 12 000 first.
  *Answered 2026-10-14:* neither as asked — the 100 ms initial RTT instead, with the reply removed; kept as draft PR #41.

* *Owner rulings, 2026-10-14:* every cleanup row starts now ("all fixes should start", 16:04 UTC), and a CI with all the checks and tests is row 230. Before the merge into `main` (the owner, 16:15 UTC): every cleanup row but 220, 227 and 228, and row 230; the owner may add more; row 231 joins them (16:33 UTC: "yes to docker decision").

* *Owner rulings, 2026-10-14:* decision 2, the cleanup, approved (rows 217–228). Row 209's frame cache stays **off by
  default** for now (`lab-frame-cache`); row 224 leaves it alone.

* *Answered 2026-10-14, 16:33 UTC:* rule (c) adopted, row 231 ("yes to docker decision. It seems like something we should try to achieve our goals."); the SELinux half stays open.
* **2026-10-14, row 208 DOCKERCLOUD (for the owner):** rule (c) recommends `deploy/seccomp-uring.json` for the container: on Docker it restores the ring (84/84 cold passes) at no cost the row could attribute to it, and buys 28.8 → 19.1 µs and ×0.67 CPU a cold 32 kB tile, a tie at 163–503 kB; its cost is io_uring's kernel surface, which seccomp cannot judge, and on SELinux-enforcing hosts `label=disable` or an untried `io_uring { allowed }` module (`docs/adr/disk-access.md` §6 *Measured in a cloud container*). Adopt or not; P0 still decides whether the ring earns its keep on the target.

* **2026-10-14 UTC: the gate's browser frame checks need the Docker-built `xxh3.wasm` (found by row 209).** On `claude/av1-unified-mainbase` (`d3d3e521` and since), in a container without `client/decode/wasm/built/`, the dispatch rig fails 7 `exact:` checks and the viewer check 8: the frame check's default hasher is the product build (`client/decode/xxh3.js:6`), which 404s there, so the decode worker never starts; `require_vendor` gates on the vendor hasher, and the downloader does not forward a `hasher` option to its decoder worker (`client/transport/downloader.js:418`), so the rig cannot ask for it. With `client/decode/wasm/build/build.sh` run it likely passes (not tried). A fix — forward `hasher`, the rig asks for `hash-wasm` (162/162 in a scratch copy) — changes product behaviour, so it is the owner's: fix that way, or make the two checks skip by name without `built/`.

* **2026-10-14, row 213 INTERSLICE (for the owner):** a 5/3 step across slice pairs before HTJ2K saves 3.5 % on
  rotational angiography and 4.0 % on CT, decoding 19–39 % slower a pair and making every ask cost two frames — a
  trade-off by row 194's rule (`docs/codecs/README.md` §Beside the codec). Whether to build it (a store and wire change,
  structural) is yours.

* **2026-10-14 UTC: row 178 NETMEASURE — a quieter host.** EMSDKNET's and COPYRGB's rules adopt nothing while a cell is not conclusive, and this container's A/A frame spread (sd 2.4–11 %) leaves six and seven such cells at n = 24; its relay voids 30–50 % at 300 Mbit/s. Re-running on the same container repeats that, so the row is done rather than set back to `night`: whether a host with a dedicated core is provided (row QUIETHOST, proposed), or the cells are decided as they stand (`em6`: nothing worse, the projections better; `copy`: RGB better in both engines, Firefox's grey cells unresolved), is the owner's. `startOnNeed` is a trade-off for the owner.

* *Owner rulings, 2026-10-14 (night):* `claude/av1-unified-mainbase` holds finished work only, clean and completely
  functional, for merging into `main`; work in progress lives on `claude/wip-*` branches (§Protocol, step 4). Row 215
  audits the branch and drafts the simplification rules. The stored routine's prompt still names only the two branches:
  the owner updates it, or the orchestrator does with the owner's yes ([`ORCHESTRATE.md`](ORCHESTRATE.md) §3).

* *Owner rulings, 2026-10-14:* row 172's read-ahead finding is investigated (rows 196–197); faster reads and a tuned
  container are worth it (rows 198, 199, 195); device runs in fast rounds (rows 201, 204–206); the phone is a Samsung on
  Android 16 with Chrome and Firefox; the congestion controller is studied beyond Cubic and BBR (row 200); row 181 is
  draft pull request #37, experimental, not merged.

* **2026-10-14, row 190 DEVICEPLAN (for the owner):** `docs/devices.md` §1 needs, before its first run: the phone's model,
  SoC, RAM, OS and browsers with versions, carrier and data cap; whether the Oracle machine is `rig-limits.md` §9's cloud
  rig; a domain name for a Let's Encrypt certificate (kept out of the repository); and opening TCP 443 and three UDP
  ports beside 4435 in the cloud security list. Its six runs (D0–D5) are not queued: each wants a `local` row.

* *Owner rulings, 2026-10-13 (late):* real-device tests on the owner's phone, local machine and Oracle cloud machine
  are planned (row 190); row 181's window is an experimental proposal, not the default (row 191); row 182's GSO cap of
  24 is adopted (row 192); trades between link conditions are decided by the target conditions, measured on devices.

* *Owner rulings, 2026-10-13 (night):* row 183's ask-aware dispatch **needs a design first and is not pursued now**;
  row 187 is **measured** (row 189). Rows 181 (the 38 400-byte initial window, adopted by its rule) and 182 (the GSO
  cap of 24) wait on the owner's answer to the orchestrator's explanation.

* **2026-10-13, row 182 FASTCLOCK (for the owner):** the GSO cap of 24 meets its pre-stated rule — server CPU a MB
  ×0.79–0.86 at 32 sessions × 103 Mbit/s, fills and asks a tie (`docs/transport/link-conditions.md` §Re-measured,
  *FASTCLOCK*, on `claude/av1-unified-mainbase`). Making it the build default replaces today's build (the patch's
  ceiling 64 → 24 and `quinn = { path = "patched/quinn" }` under `[patch.crates-io]`), so it waits on your yes to call
  (1) below. *Built since, row 192 (2026-10-14).* Also for whoever runs the gate in a fresh container: since row 179's `ab0fc196` the contract's frame
  check needs `client/decode/wasm/built` (`client/decode/wasm/build/build.sh`, docker) and `lab/av1/exact/split/merge_test.py`
  needs Python's `xxhash` (the `lab/av1/.venv` on PATH); with both the gate is green.

* *Owner rulings, 2026-10-13 (evening):* **tiles for large frames are shelved** — they make one frame's ask faster
  (×0.39–0.45 at 4×) but not the series' total decode or a fill, and the owner finds the trade not interesting; row
  175's proposal stays as the record, nothing is built on it. **GPU decoding is not pursued for now**: no device run of
  row 111's WebGPU decoder is queued (row 113's L3 phone stage stays open, unscheduled).

* **2026-10-13: owner calls named only in their docs (row 166's audit, added by row DOCFIX)**, each on
  `claude/av1-unified-mainbase`: (1) the **GSO segment cap**, 24 or 45 behind the product's buffer
  (`docs/transport/transport-conclusions.md` §9 item 6; FASTCLOCK prices it); (2) the **32-packet initial window**
  (same, §9 item 3; IWDEEP decides it); (3) **`MALLOC_MMAP_THRESHOLD_=1048576`** in the unit, rest RSS −46 to −57 %
  against CPU a tie to +5 % (`docs/adr/disk-access.md` §8); (4) the **keep-alive ADR**, proposed and off until accepted
  (`docs/adr/transport-idle-sessions.md`); (5) **P0**, ring against pool on the production host, with no row
  (`docs/adr/disk-access.md` §9 #1); (6) row 139's 100 ms initial-RTT arm left to "the review's call" with no review row
  (`docs/transport/transport-conclusions.md` §Measured: IRTTMEASURE). And on row 123 (2) below: the coded-bytes digest
  is agreed in the draft target (`docs/disk-layout/target.md` §The two hashes, 2026-10-12, not built); whether the server
  checks it on every read stays open.

* **2026-10-13 UTC: row 175 TILESTORE — row 143's five choices, now each with a recommendation** ([`../adr/resolution-fitting-for-large-frames.md`](../adr/resolution-fitting-for-large-frames.md) §8.8 on `claude/av1-unified-mainbase`): (1) tiles as independent codestreams, banded and band-major, the map arithmetic in a v2 entry; (2) no wire change; (3) per viewport; (4) 12-bit large frames keep the plain fill until a level-first fill is shown net; (5) k = 3 strips for frames ≥ 1 MP, a 2D grid after TILEGRID. Whether to accept them, and whether to queue BANDS and TILEGRID, is the owner's.

* *Owner rulings, 2026-10-13 (later):* theory may lead to empirical tests beyond the owner's proposals, which are
  simply proposals; the orchestrator plans up to two usage windows; tiles for large frames are of interest (row 175).

* *Owner rulings, 2026-10-13:* the next work aims at **net improvements** (rows 165–170, the round's brief); a longer
  fill time is not of interest for now. The orchestrator's reading of "net" is in the round's brief, for the owner to
  correct.

* **2026-10-13, row 160 (for the owner):** (1) `pack-series` writes through an 8 KiB `BufWriter`, and a `.sbnd` so written read 24–31 % slower on warm hits and filled 24–32 % slower than the same bytes rewritten in 1 MiB writes; rewriting v2 in 8 KiB writes undoes it, so it is the writer, not the layout (`containers.md` §Measured, mechanism unmeasured). Whether to queue a row for it is the owner's call. (2) `lab/av1/fetch_data.sh` fails as written: `lab/av1/requirements.txt` lacks a hash-pinned `typing-extensions`, which `blake3` needs (row 160 installed with `--no-deps`); the pin is left to the owner. (3) DICOM export through pydicom 3.0.1's `encapsulate_extended` is not exact for odd-length frames (padded EOT lengths).

* *Resolved, 2026-10-12 (the owner): no swap.* Row 150 is done as two new branches, `claude/av1-unified-mainbase` (work)
  and `claude/av1-mainbase` (this queue); all work continues there and the old `claude/av1`, `claude/av1-unified` and
  `-pre-main` branches are unused until the owner deletes them. Rows 151, 155 and 156 are `ready`.

* *Owner rulings, 2026-10-12:* **DBT slice stacks are cine-like and in AV1's immediate scope** (row 138's `dbts_b4`
  per-series choice stands as an AV1 candidate); **SHA-256 is replaced by XXH3-64** as the raw-frame check (row 153's
  choice 5; row 155 amended).

* **2026-10-12 (the owner): row 150 is published under new names, with no force-push.** The session that takes it:
  1. claims row 150 on `claude/av1` and pushes, then makes **no other commit to `claude/av1` or `claude/av1-unified`**
     (anything committed there after the replay is lost when the branches are swapped);
  2. runs [`mainbase/README.md`](mainbase/README.md) §To publish on the current tips (`U` must be `claude/av1-unified-pre-main`'s tip; `A` is
     `claude/av1`'s tip after the claim), the gate and `rehash_check.py` included, **except its last `git push`**;
  3. pushes the two results as **new** branches, plain pushes only: `git push origin HEAD:refs/heads/claude/av1-unified-mainbase`
     and `git push origin <the av1 tip>:refs/heads/claude/av1-mainbase`; if either branch already exists, it stops
     and says so under `## Blocked`;
  4. on `claude/av1-mainbase`: commits `/tmp/mainbase/map.tsv` as `docs/av1/rehash-map.tsv` with `rehash_check.py`
     beside it, sets row 150 to `built — published as claude/av1-unified-mainbase <hash> and claude/av1-mainbase
     <hash>; the swap is the owner's`, and pushes `claude/av1-mainbase`;
  5. stops: rows 151, 155 and 156 stay `after 150` until the owner has moved `claude/av1-unified` and `claude/av1`
     onto the new branches.
  It never force-pushes and never deletes a branch.

* **2026-10-12 UTC: row 150 MAINBASE — publishing needs the owner.** The rebuild is done and verified, but the night routine's force-push of `claude/av1-unified` and `claude/av1` was refused by the session's permission policy (a history rewrite of a pushed branch). The backups are pushed; [`mainbase/README.md`](mainbase/README.md) reproduces the result exactly (same map, tips `7cb02d3f` and `cf04350b` from the backups) and lists the push. The owner's choice: run that push from a day session, or allow the force-push in the night routine's permissions and set row 150 back to `night`. Rows 151, 155 and 156 wait on it.

* *Resolved, 2026-10-11 (the owner): the night routine's prompt now allows row 150's two backup branches; the owner
  authorized pushing any wt-pacs branch except `main`. Row 150 is `ready` again.*
  **2026-10-11 UTC: row 150 MAINBASE — not for the night routine.** Its publishing step pushes the old tips as
  `claude/av1-unified-pre-main` and `claude/av1-pre-main` before the force-push; the night routine may push only
  `claude/av1` and `claude/av1-unified`, so it cannot take the row's own safety step. The owner's choice: allow those two
  backup branches in the night routine's prompt, name another backup it may push, or run the row from a day session.
  Rows 151 and 155 wait on it.

* **2026-10-11 UTC: row 152 QUICTUNED — the stacks at their best** ([`../native/quic.md`](../native/quic.md) §7.7 on
  `claude/av1-unified`): (1) the native client's receive window and socket buffer at quinn's defaults (above the target)
  or set explicitly; (2) restore the server's ACK-frequency request toward native quinn clients (up to 20 ms off a lost
  tail's PTO, derived); (3) 0-RTT through a wtransport patch on both ends, only on a raw-QUIC ALPN, or not at all;
  (4) quinn stays as the server's stack, or sessions per core and loss under pacing are measured first (§7.6).

* *Resolved in part, 2026-10-11 (the owner): choice (4), the catalog's engine, is deferred — a far-away decision, no
  energy on it yet. The others stay open; their status is in `docs/ingest/README.md` §4 on `claude/av1-unified`.*
  **2026-10-11 UTC: row 153 INGESTDESIGN — nine choices for the pipeline** (`docs/ingest/design.md` §10 on
  `claude/av1-unified`): (1) when a series is complete — the association's end, a quiet period, or another signal — and
  whether a late instance makes a new generation; (2) the unit on the link: one archive a series (recommended), the
  parser's files, or one a study; (3) where frames are coded: at the site (recommended), in the parser on grok (AGPL v3),
  or in the cloud; (4) the catalog: PostgreSQL (recommended), MySQL or libSQL's server, and its schema scope; (5) the
  raw-frame check's hash: SHA-256, BLAKE3 or the XXH3-64 already written; (6) a changed duplicate: replace, keep both
  generations, or hold; (7) a bad instance: refuse its series (today) or store the rest marked incomplete; (8) whether
  the parser hashes the bytes it writes, so every group can be checked; (9) metadata compressed a series at a time
  (recommended) or a group at a time with a shipped dictionary.

* **2026-10-11 UTC: row 149 NATIVECINE — whether to ask for a licence** (`docs/FIXTURES.md` §Provenance, The wider search,
  on `claude/av1-unified`): the one open set of native, unflagged angiography runs (Hugging Face
  `MesserMMP/coronary-angiography-syntax`, two vendors, one uploader) states no licence, so nothing grants its use. Whether
  to ask its uploader for one, and whether one source of two vendors counts toward row 100's two sources. Breast
  ultrasound cine and ABUS have no native candidate at all; whether to request data from a site is also the owner's.

* *Resolved in part, 2026-10-11 (the owner): the exactness checks stay **on by default** — the decode check and the
  re-check of a frame read from the OPFS cache; their time is measured by row 151 CHECKCOST. Choices (1)–(5) stay open.*
  **2026-10-11 UTC: row 148 FRAMEPATH — where a decoded frame goes** ([`../adr/frame-path.md`](../adr/frame-path.md) §8 on
  `claude/av1-unified`): (1) the page out of the pixel path (B′: decoder → paint worker, a store worker behind it) or
  today's path with a store worker (A), decided by the note's §7 rule if its protocol is queued; (2) decoded samples in
  OPFS (recommended, from the no-re-decoding rule) against coded bytes; (3) a file per frame or a packed file per series;
  (4) the memory window's budget on a phone, `deviceMemory` being absent on WebKit; (5) whether the page asks `persist()`.

* **2026-10-11 UTC: row 141 LOSSCLASS — whether option 1 (Cubic that skips the cut on a loss classed random) is reopened** ([`../transport/transport-conclusions.md`](../transport/transport-conclusions.md) §1 R2, on `claude/av1-unified`): R2's rule closed options 1 and 2 by its conjunction over controllers, but every miss was BBR's; under `cubic-restart` RFC 9406's q* met both bars on every judged cell. Reopening it would take a Cubic-only rule fixed before data, and the 500-packet overflow cell rerun with ≥ 1 MB in flight (it never overflowed at 512 KB). Option 2 stays closed on evidence.

* *Resolved in part, 2026-10-11 (the owner): choice (3) — **device pixels** decide "fits the screen"; CSS pixels would
  be an upscaled preview on phones, which the owner's rule rules out. Per viewport or per screen, and choices (1), (2),
  (4) and (5), stay open.*
  **2026-10-11 UTC: row 143 TILEDESIGN — the owner's rule for large frames, five choices** ([`../adr/resolution-fitting-for-large-frames.md`](../adr/resolution-fitting-for-large-frames.md) §8 on `claude/av1-unified`): (1) the store — tiles as independent codestreams in level bands, band-major (proposed), or precincts with PLT in one codestream, which needs a region decoder and a JPIP-like server; and the map from (frame, tile, band) to entry in the metadata or a version 2 SBND table, with a digest per tile and level; (2) the wire — entries asked as frames today (proposed first) or a region ask; (3) "fits the screen" in device or CSS pixels, and per viewport or per screen (a phone at 3328×4096: L1 ~27 % against L3 ~2 % of the bytes); (4) whether 12-bit large frames keep the plain fill or take §7's level first (four-view FFDM 10.9–20.0 s at 5 Mbit filled, ×0.06–0.50 level first); (5) the strip count and grid (k = 3 strips measured, a 2D grid not).

* *Resolved in part, 2026-10-11 (the owner): a set that is not native lossless — CADICA (`unknown`), CoronaryDominance
  (resampled), the MPEG cine — may be used only labelled as such; it enters no verdict and no decision rests on it. The
  frame-group question for these types stays at G = 1 until sound data exists; row 149 searches wider. (2) and (3) stay
  open.*
  **2026-10-11 UTC: row 137 NETPROBE — which source, if any, for angiography and breast ultrasound cine** (`docs/FIXTURES.md` §Provenance,
  The data hosts and the candidates, on `claude/av1-unified`): every host is reached now, and none of what they hold meets row 100's bar.
  (1) whether CADICA (CC BY 4.0, whole runs as PNG, one source) is fetched as an `unknown` set for provisional numbers; (2) whether to ask
  CADICA's or CoronaryDominance's authors for the runs' DICOM; (3) whether TDSC-ABUS's agreement (no redistribution, a challenge submission
  owed) is acceptable for an internal measurement.

* **2026-10-11 UTC: row 133 TILEMEASURE — tiles as independent codestreams** ([`../decode/README.md`](../decode/README.md) §Not yet
  tried, P-TILE, on `claude/av1-unified`): P-TILE passed its rule (k = 3 ×0.39–0.45 of today's ask at 4× on large frames,
  +0.12 % bytes). Its next step is a change to the store's format, which is structural: whether a store-format proposal for
  large frames is written, and for which sizes.

* **2026-10-11 UTC: row 127 NATIVEPLAN — the native client** ([`../native/README.md`](../native/README.md) §7 on
  `claude/av1-unified`): (1) whether to build one before its fill and ask are measured against the browser (M2); (2) the
  shape — Rust core + native UI per platform, a pure-Rust GUI (Slint the only one on all five), Qt, or Flutter; (3) the
  cache — persistent on the device or none (AAPM 260), its budget, iOS protection class C or A; (4) the intended use,
  diagnostic (21 CFR 892.2050, MDR Rule 11) or display only, for a regulatory specialist; (5) distribution — public
  stores or hospital channels, and a desktop update channel per OS.

* **2026-10-11 UTC: row 124 QUICSURVEY — the native client's transport** ([`../native/quic.md`](../native/quic.md) §5 on
  `claude/av1-unified`): (1) one Rust core on quinn everywhere, the platform stacks on phones (Network.framework,
  Cronet/HttpEngine: no CC knob, no WebTransport, Cronet HTTP only), or a C core (ngtcp2, picoquic); (2) WebTransport
  from the native client (server unchanged) or raw QUIC with an ALPN of our own beside it (a wire change); (3) multipath
  now through noq, a quinn fork at the final codepoint, or after an RFC lands in quinn; (4) quinn for the ingest link
  too, or a second stack for the site host; (5) what security record a medical client accepts — every candidate had 2026
  advisories. Rows N1–N4 there inform (1)–(3).

* **2026-10-10 UTC: row 123 MISMATCH — three choices after a mismatch** ([`../adr/exactness-in-production.md`](../adr/exactness-in-production.md)
  §8 on `claude/av1-unified`): (1) *block, mark, or block with an explicit reveal* for a frame that stays `false` — the
  viewer marks today; the sources lean to block for diagnostic reading; (2) whether the ingest writes a second digest over
  each frame's coded bytes (a store-content change, structural), and whether the server checks its store on read;
  (3) the reporting rule — an opaque session key in place of the series key, and how many rescued mismatches turn a
  decoder path off for an engine version.

* *Amended 2026-10-11 (the owner): (4) the hospital→PACS link is **TCP**; the QUIC shipper is dropped for now, and the
  gains it would bring are to be proven with numbers, from research first (row 154 LINKTCP). The parser's **directory
  output** is the start: one directory per instance — exam, series and instance groups, one file per frame. Metadata
  goes into **one SQLite per study**, built in the PACS, so that bad localized data never forces rebuilding a shared
  database; a separate catalog server (MySQL or Postgres, not embedded) indexes every study database — row 153
  INGESTDESIGN compares the options.*
  *Resolved in part, 2026-10-11 (the owner): (1) the compiled ingest is **Rust**. (2) The parser is the owner's own, so
  its licence is no concern; how it ships stays open, pending where its source lives. (4) The link from the site to the
  server is a **QUIC experiment from the start**, behind an outbox seam — the ingest writes checked bundles to an
  outbox, a shipper sends them, the server publishes a bundle when its hash matches — for learning and experimenting;
  which QUIC stack follows row 124's decision (4). (3) and (5) stay open.*
  **2026-10-10 UTC: row 126 INGESTPLAN — the compiled ingest's five decisions** (`docs/FIXTURES.md` §A compiled ingest at the site on `claude/av1-unified`): (1) Rust (recommended: the server's bundle crate and QUIC stack) or C++; (2) the C parser's licence and how it ships with the ingest — none is shown in this repository, and it was not read; (3) the transfer syntaxes it does not read (implicit VR little endian, DICOM's default, big endian, deflate, RLE, encapsulated lossless): refused, converted before it, or added to it; (4) the link to the server: a file copy, an upload endpoint beside WebTransport, or a third-party tool; (5) the site platforms and how updates reach them.

* **2026-10-10 UTC: row 121 DATAAUDIT — whether raw `FOR PROCESSING` images (the DBT projections, raw mammograms, 14 bits)
  are AV1 targets.** Row 98 scoped the projections out; `series.md` lists both in the breast family. The 13–16-bit rules (rows 33,
  44, 47, 96's 14-bit clause) rest on them and on off-target content, and matter only if they are targets.

* **2026-10-10 22:15 UTC: row 69 MERGEPREP — how `main`'s PR #34 meets this branch before the merge**: a trial merge of `origin/main` into
  `claude/av1-unified` stops on 24 files (server transport, read path, tap, `main.rs`, the two common crates, the WASM
  session, `WIRE.md` and four ADRs, three lab files, `Cargo.lock`), mostly this branch's renames meeting PR #34's
  refactor of the same lines. Merge `main` into the branch first in a row of its own (PR #34's structure kept, this
  branch's server changes re-applied: the ClientHello fix, `bbr-bound`, the renames), or merge as is and resolve in
  the merge; and whether that waits on R4 (`docs/av1/MERGE.md` on `claude/av1-unified`).

* **2026-10-10 20:50 UTC: row 113 LEVERREVIEW — whether to ship today's code-block pool for series from 1914×2572 up**, as a second OpenJPH build
  chosen per series: row 91's missing cold ask is now measured (row 108: projections ×0.89–0.94 cold, ×0.72–0.76 warm,
  ×1.31–1.36 on the ready path, fills ±1.3 %; +2.2–2.5 MB a worker). The helper-after-ready variant and the coarser
  hand-off units failed their rules (`levers-protocol.md` §Review, L1 and L4).
* **2026-10-10 20:50 UTC: row 113 LEVERREVIEW — whether three stripes on idle workers are pursued as an ask's lever**: ×0.60–0.68 of the
  reference at 4× on large frames and ×0.77–0.85 of the pool, but through OpenHTJ2K, a second decoder ×1.13–1.41
  slower whole; and whether precincts in the stored layout are worth a re-encode, the only way a viewport would decode
  or fetch by its area (§Review, L2).
* **2026-10-10 20:50 UTC: row 113 LEVERREVIEW — the phone stages of L3 and L5**: which phones (Chrome Android 121+ and Safari 26 for the
  WebGPU decoder's time; little cores and an iPhone for paced decode's energy) and when; and whether L5's one-cell
  miss (12 of 16 rounds against 8 of 10, median ×1.002) stands, or a decoder started on first need is measured first,
  since the saving found is the start of two unused decoders (§Review, L3 and L5).

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
  and the tree is proposed (`lab/av1/README.md` §The folders, `5f99627` on `claude/av1-unified`), but applying it
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
  *Updated 2026-10-11 (row 137):* every host is reached now; still no source meets this bar (`docs/FIXTURES.md` §Provenance, The data hosts and the candidates, on `claude/av1-unified`): CADICA (CC BY 4.0, 668 angiography runs as PNG, source compression unrecorded: `unknown`) is the nearest, one source; no open lossless breast cine; TDSC-ABUS bars redistribution.

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
    (`lab/av1/item/ingest.py`; the three moved by row 56, `19de3e0`) and the HTJ2K decoder's fetch (`lab/decode-bench/fetch_decoder.sh`, served from
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
  last lane commits `3fe414f` (75, 19:05) and `6e88883` (77, 20:41) on `claude/av1-unified`, none in the six hours
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

* **2026-10-07 20:15 UTC: row 79 COLDRTT — the warm-up costs a ≤ 10-bit series on links under 20 ms.** Fetching dav1d's WASM at the decoder's start (adopted, `cc47988`) is −1.0 round trips through WebCodecs and −3.0 through dav1d from 20 ms up, but a WebCodecs series whose probe passes never uses that 238 KB fallback, and it arrives beside the first frame: +26 ms at 10 ms (1/6 rounds), +67 on loopback (0/10), a tie at 20 ms. The brief asked nothing slower on a low-RTT link. The owner decides: keep it, skip dav1d's WASM for a series the page says is ≤ 10 bits (a depth hint in the decoder config, not built), or revert. [`lab/page-open/README.md`](../../lab/page-open/README.md) §Cold round trips by codec.

* **2026-10-07 18:40 UTC: row 74 XENGINE — Safari waits on a device run, the owner's phone decision.** From WebKit's
  source (`webkitgtk-2.52.6`), WebCodecs AV1 on Cocoa is the preview preference `WebCodecsAV1Enabled`, off by default,
  and decodes through libwebrtc's software dav1d, 8-bit 4:2:0 only, to `NV12`; no hardware decoder is on that path. A
  device run must say, per iOS and macOS Safari version: whether `VideoDecoder.isConfigSupported` is true for
  `av01.0.04M.08.0.110.02.02.02.1` with the preference as shipped, and if so whether `lab/av1/exact/engine-readback`'s `g8-420-full`,
  `g8-mono`, `rgb8-gbr` and `g10-420` units come back, in which format, and exact against the manifest's checksums
  (`run.mjs`'s page opened in Safari, results read from the page). Until then the client's per-layout probe decides there, as everywhere.

* **2026-10-07 17:35 UTC: row 70 HTJ2KENC claimed twice.** The night routine's claim `d090183` (17:07) and another
  session's work `6fe1ac5` on `claude/av1-unified` (17:18) both read the same `claimed 2026-10-07 (night)` as their own;
  the night routine stood down unpushed and took the next row, so row 70 is the session that pushed `6fe1ac5`. Two
  sessions writing the same claim text cannot tell their claims apart: a claim could name its session.

* **2026-10-07 03:30 UTC: row 56 LAYOUT's moves wait for rows 44, 59, 60 and 65**, which are still writing in the `lab/av1/` folders it would move: moving them under those sessions would land their next commits in folders that no longer exist. Done and pushed (`b5ff807` on `claude/av1-unified`): the five-group tree, every folder's proposed path, in `lab/av1/README.md` §The folders, by what they measure; `lab/README.md` indexes `av1/`; `svcdec/` has a README; `docs/` already sits by subject, nothing to move there. The next session applies the moves with `git mv` once the four are done.

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
  from their lanes in the six hours since but 57's `8c69bf0` (01:27); set back to `night`. 57 continues from `8c69bf0`.

* **2026-10-06 22:15 UTC: the night sessions of 10-06 hit the account's usage limit at about 01:30 UTC mid-row** —
  rows 44, 49, 50, 52 and 59 were set back to `ready`. Pushed partial work to continue from, not redo: all on `claude/av1-unified`:
  44 SPLITTIME `09605fc` (bytes per arm k), 50 CLIENT `8fc44e8` (both re-dial defects), 52 INGEST `0f1da56`,
  `542bb5a` (the one ingest, its bench); 49 and 59 have none and start fresh. Rows 47, 51
  and 57 (57 has `8c69bf0` on `claude/av1-unified`) stay claimed; the stale rule applies to them.

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
  *Updated 2026-10-11 (row 137):* `zenodo.org` and `www.cancerimagingarchive.net` are reached now (CONNECT 200); the data that would have unblocked this is still missing (`docs/FIXTURES.md` §Provenance, The data hosts and the candidates, on `claude/av1-unified`).

* **2026-10-04 07:10 UTC: row 23 TOTAL is measured twice over, or about to be.** The session that claimed it at
  `a5ca00c` was mid-run when its claim was set stale (14 rounds × 160 visits take ~10 h, with no commit until the
  end); it finished and pushed the reading as `2cf4a5c` — 2 257 visits, n = 10–16 a cell, 70 022/70 022 frames
  exact, [`README.md`](README.md) §Total time. Row 23 was claimed again by another session meanwhile, so this one
  leaves the row as it stands. The owner, or the claim's holder, decides whether `2cf4a5c` closes it. A stale
  rule that counts commits misses a timed lane; a long lane could push its partial rows.
  *Resolved, 2026-10-04:* the claim's holder ran the harness again (10 rounds) as a replication and closed the row on both.

* **2026-10-04 05:20 UTC: row 23 TOTAL's claim (2026-10-03 22:54 UTC) went stale** — over six hours with no commit from its lane; set back to `night`.

* **2026-10-03 19:43 UTC: every session hit the account's five-hour usage limit mid-row** — rows 23, 24, 25, 27, 28 and 30 were set back to `ready`; nothing of theirs had been pushed, so a session taking one starts it fresh.

* **A contrast angiography run (row 10).** No open one is reachable: every XA series in the NCI
  Imaging Data Commons (v24) is single frames, and TCIA's API, Zenodo and PhysioNet are refused by
  the container's network policy. The owner decides whether one is worth sourcing elsewhere (a host
  to allow, or a licence other than CC BY/CC0); until then no verdict covers angiography. A
  CC BY-NC 4.0 tomosynthesis collection exists in IDC and was not needed: two CC BY 4.0 volumes were.
  *Updated 2026-10-11 (row 137):* TCIA, Zenodo and PhysioNet are reached now. Open angiography found: CADICA (whole runs, CC BY 4.0, PNG, `unknown`), CoronaryDominance (whole runs resampled to float, CC0), ARCADE and the stenosis set (single frames) (`docs/FIXTURES.md` §Provenance, The data hosts and the candidates, on `claude/av1-unified`).
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
  *Updated 2026-10-11 (row 137):* all eleven hosts are reached now (CONNECT 200). No open lossless breast cine found; TDSC-ABUS (200 ABUS volumes, NRRD) has no licence and its agreement bars redistribution; Breast-Lesions-USG and Jefferson's TCIA set are stills (`docs/FIXTURES.md` §Provenance, The data hosts and the candidates, on `claude/av1-unified`).
* **Phone hardware decoders (row 29).** Whether a phone's AV1 decoder takes lossless frames and
  returns them exactly needs phones; a container has none. From source only: Android's public API
  names AV1 Main 8/10-bit only, and its performance class guarantees a hardware Main 10 decoder at
  level 4.1, under the tomosynthesis projections' picture size; WebKit's in-process WebCodecs AV1
  path refuses all but 8-bit 4:2:0 (README §Options to try). The owner decides whether to source
  devices — which phones, and whether through a hosted device service — and the row follows.
