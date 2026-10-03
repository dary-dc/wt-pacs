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
| 10 | **CONTENT** — the content the verdicts lack: tomosynthesis and a contrast angiography run | claimed 2026-10-03 |
| 11 | **FILL** — the fill's decode measured, not multiplied: three decoders, HTJ2K against AV1, through the downloader | claimed 2026-10-03 |
| 12 | **PREVIEW** — a lossy first picture, the exact frame after: what it buys a cine on a phone link | claimed 2026-10-03 |
| 13 | **SPLIT10** — the top10+low split through WebCodecs: exact, and how fast | ready |
| 14 | **ENC** — encode time, uncontended, per preset and content: ingest cost, and whether lossless can run live | ready |
| 15 | **SVC** — libaom's real-time scalable encoder in lossless mode at 10 and 12 bits: exact or not | ready |

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

## Blocked

Nothing yet.
