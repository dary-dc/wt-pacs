# HTJ2K only on a phone, the screen's level first, the exact frame after

*Queue row HTJ2K-PREVIEW-MOBILE, 2026-11-17 (`claude/work-ledger:docs/queue-client-2026-11-14.md`, amendment 23: "an
HTJ2K-only path with a reduced-resolution first picture for large matrices on phones is to be investigated"). Theory,
sources and existing rows; nothing run on a device, a GPU or a coder. Every choice stays the owner's.*

Labels, as [`README.md`](README.md): **(S)** a source quoted verbatim, listed in §9 with its revision; **(R)** a result
of this repository, by its file; **(D)** derived here, the arithmetic written out; **(T)** theory, not measured.

**The path.** Every frame of a series is the exact HTJ2K codestream the store already holds (RPCL, one tile, one
layer). The client asks first for each frame's smallest prefix that decodes to the resolution level covering the
screen's device pixels, decodes it at that level, checks it and paints it; then it asks for each frame's rest and
decodes the whole frame, bit for bit, as the *Lossless* path does today. No optimal-quality view, no AV1, no second
encode: the level picture and the exact frame are the same bytes in order.

## 1. What it shows

* **It reaches few series on a phone held upright with one view.** With the frame fitted whole into a 1080 × 2400
  portrait screen, only `dbts_b1` of the 19 DBT volumes has a level coarser than the frame that still covers what is
  shown; on a 1440 × 3120 screen none has (§3, D). Held sideways, 12 of 19 do; in a left–right pair of views, 8 do.
  The mammography matrices (2560 × 3328, 3328 × 4096, 2394 × 2850) reach level 1 on a 1080-wide phone (R, the ADR's
  table). Where the level is 0 the path is the whole exact frame: [`htj2k-software.md`](htj2k-software.md), at
  4.6–14.6× the view's bytes.
* **Where it reaches, the phone's decode falls to a sixth to a third of AV1's, for a picture of lower quality.**
  `dbts_b1` at level 1: 21–39 ms a frame predicted, against 133–135 ms measured for the AV1 view (§5, T on R). The
  phone's fill was decode-bound on AV1 (R), so the decode is where a phone gains. The two pictures are not equal: the
  level picture failed the visually lossless proxy at display scale, which the view is meant to meet (§2 item 3, R).
* **The bytes per scrolled frame are 1.21–1.32× the view's** on `dbts_b1` (§4, D on R). A fill is then quicker than the
  view's above about 103 Mbit/s of goodput, a tie at the world's mobile median, ×1.21–1.32 slower at its 10th
  percentile (§6, D on T), each at the lower quality. The exact series costs nothing more: it is the rest of the same
  codestreams.
* **Why it was set aside, and what differs** (§2): no recorded decision gives a reason. The measured verdicts it rests
  on compared the level picture with an AV1 *preview* that is gone, or ran on an x86 host whose software AV1 made the
  scroll decode-bound only at 4×. On a phone AV1 is software too, and no phone is promised a hardware AV1 decoder for
  `dbts_b1` (`av1-chips.md`). The level picture is exact at its level and, at device pixels, covers the shown size:
  nothing is upscaled. It is still the codestream's 5/3 low band, not the viewer's resampling of the frame, and so
  measured: on `dbts_b1` at display scale, 46.9 dB against the area-resampled exact frame, short of the visually
  lossless proxy (R, the ladder, `8a55ee8e`; §2 item 3). *Corrected 2026-11-17 (PR 397 §Review:
  HTJ2K-PREVIEW-MOBILE-REVIEW, blocker 1): the measured quality was left out, so the comparisons read as like for
  like.*
* **Nothing of it is built in the product** (§7): the decoder binding, the clamp, the SIZ reset, a digest per level,
  the store's level offsets and a render path that takes a smaller picture.

## 2. The record, and what is different here

The decisions, verbatim:

* `docs/lines/codecs.md` §Decisions: "2026-10-10: frames of 12 bits or fewer are filled, deeper ones fit plus tiles;
  never a reduced-resolution preview." The rule in the owner's words
  ([`../../adr/resolution-fitting-for-large-frames.md`](../../adr/resolution-fitting-for-large-frames.md) §8): "series
  at 12 bits or less are filled."
* The same ADR, §8.2: "**Decided (the owner, 2026-10-11): device pixels.** CSS pixels would be an upscaled preview on
  phones, which the rule rules out."
* `docs/lines/codecs.md` §Decisions: "2026-11-06: a preview, if any, is the small full-size stream only;
  reduced-resolution previews not considered now."
* `claude/work-ledger:docs/queue-2026-11-10.md` §Decided approaches: "No low-resolution preview; a preview is tiny and
  full size only." The same file's HTJ2K-tiles brief: "This is not a low-resolution preview (decided: none); it is one
  lossless codestream served at the screen's resolution, whose further levels complete it."

**No reason is recorded with the 2026-10-10, 2026-11-06 or 2026-11-10 lines** (grepped across `docs/`, the queues and
their commits). That is a documentation finding. The one reason on record is 2026-10-11's: an *upscaled* picture.

The measured verdicts that bore on it:

* **The resolution ladder against the AV1 preview** (2026-11-02/05,
  [`../../client/evidence/htj2k-progressive-delivery.md`](../../client/evidence/htj2k-progressive-delivery.md)): the
  level picture's first picture was ×1.9–7.8 the AV1 preview's, "because the fit prefix is 27 % of a frame against the
  preview's base of 0.02–0.04 %". That preview is superseded by the 2026-11-09 design (one view, the exact frame on
  request).
* **S★, HTJ2K at the screen's level for the scroll** (2026-11-12,
  [`../../client/evidence/exact-frame-by-htj2k-layout.md`](../../client/evidence/exact-frame-by-htj2k-layout.md)):
  withdrawn because "Only `dbts_b1` (fit level 1) meets its rule"; on `dbts_b1` at 5 Mbit/s and 4× its first picture
  was ×0.665 of D's and every slice ×1.227. The verdict adds: "Its better showing in decode-bound cells comes from this
  host's software AV1, which a phone with hardware AV1 may not share."

**What is different here:**

1. **The phone decodes AV1 in software.** The one phone measured filled `dbts_b1` decode-bound at 133–135 ms a frame
   (R, [`../../client/evidence/fill-bound-on-phone.md`](../../client/evidence/fill-bound-on-phone.md)). Android asks a
   hardware AV1 decoder of no phone at `dbts_b1`'s size (`av1-chips.md` §3, S there). The 11-12 caveat runs the other
   way: the decode-bound cell is the phone's normal one.
2. **The comparison is the view, not a preview.** The 11-02 rule judged a first picture against a 0.02–0.04 % base;
   the view today is 21.6 % of `dbts_b1`'s exact bytes (§4).
3. **Nothing is upscaled, but the picture is not visually lossless.** At device pixels a level that covers the shown
   size is downsampled for display, as the whole frame would be; the ADR's §7 item 4 render path, "scaled up until the
   whole arrives", is not this path's (D). What remains different is the filter, and the ladder measured it on
   `dbts_b1` itself (R, `8a55ee8e`, stage 1): "No prefix of any level met the visually lossless proxy on any frame, at
   full size or at display scale. … At display scale the level-fit picture is the 5/3 low band, not an area average:
   against the area-resampled exact frame, `dbts_b1` 46.9 dB and `dbts_c1` 44.5 dB, 81–83 % of codes differing,
   51–54 % by more than one." The view it is set against is "a series' picture meant to be visually lossless"
   (`docs/glossary.md`, *optimal quality*). So every ratio below compares a picture that failed the proxy with one
   chosen to meet it. *Corrected 2026-11-17 (PR 397 §Review: HTJ2K-PREVIEW-MOBILE-REVIEW, blocker 1; minor 7): this
   quoted only the ladder file's last clause, "exact against the codestream's own reduced resolution, not against a
   viewer's resampling of the exact frame", and left the measurement out.*

   **The owner's question is already open twice**: the ADR's §8.6, "Whether the 12-bit large frames keep the plain
   fill, as the rule says, or take §7's level first (no tiles) is the owner's", and
   [`exact-frame-by-htj2k-layout.md`](../../client/evidence/exact-frame-by-htj2k-layout.md), D+L★, "Whether an exact
   level picture may be shown before the frame, and in what words, is the owner's". This path asks the same one, on
   phones and with the measurement above: may an exact level picture that failed the visually lossless proxy at
   display scale be shown before the frame, and in what words. *Corrected 2026-11-17 (minor 4): this asked a third
   question, "Whether that is a "reduced-resolution preview" in the owner's sense is the owner's call."*
4. **The standard names this use.** DICOM's RPCL syntax "allows for progressive display of images, as well as
   retrieval of thumbnail images" and "sequences the resolution blocks so that lower resolutions can be read first"
   (S1).

## 3. Which series it reaches

The level is the coarsest one whose size covers the frame fitted whole into the screen's device pixels (the ADR's
§8.2 rule); a frame W × H on a screen w × h shows at s = min(w ÷ W, h ÷ H, 1), and level L covers it while 2^−L ≥ s
(D). The whole screen is taken as the viewport; a browser's bars only lower s (T). Two views split its width: each
540 device pixels wide on 1080 × 2400 (T).

| volumes (`docs/FIXTURES.md`) | 1080 × 2400 upright | 1440 × 3120 upright | 2400 × 1080 sideways | two views on 1080 × 2400 |
| --- | --- | --- | --- | --- |
| `dbts_b1` 2560 × 3328 | **L1** (s 0.422) | L0 (0.562) | L1 (0.325) | L2 (0.211) |
| `dbts_b2`…`b5` 1890–1996 × 2457 | L0 (0.541–0.571) | L0 | L1 (0.440) | L1 (0.271–0.286) |
| `dbts_a4`, `a5`, `c2`, `c3`, `c4`, `dbt10_d` | L0 | L0 | L1 (0.418–0.486) | L1 for `a4`, `c3`; else L0 |
| `dbts_a1`, `c1` | L0 | L0 | L0 · L1 | L1 · L0 |
| the other six | L0 | L0 | L0 | L0 |
| **reaching a level ≥ 1** | **1 of 19** | **0 of 19** | **12 of 19** | **8 of 19** |

So on a phone the path is a mammography and a sideways-or-paired DBT path. For FFDM and the synthesized 2D, which are
not cine-like and so have no AV1 view, it is the exact path they already take with a level first; RESLEVEL measured
level 1's first exact picture at ×0.26–0.49 of today's on 2560 × 3328 FFDM and 2394 × 2850 synthesized 2D (R,
`docs/decode/README.md` §A frame at the level the screen needs). 3328 × 4096 reaches level 1 on a 1080-wide phone
(s 0.325, D), and level 1 there is unmeasured: RESLEVEL decoded it at level 2. *Corrected 2026-11-17 (PR 397 §Review:
HTJ2K-PREVIEW-MOBILE-REVIEW, blocker 2): this read "RESLEVEL measured that at ×0.09–0.27 of today's first exact
picture on 3328 × 4096", which is level 2's column.*

## 4. Bytes

Measured shares of the smallest exact prefix (R): level 1 26.2–28.5 % of a frame and level 2 6.65–7.66 % over 15 DBT
volumes (the ladder file); 25.8–29.0 % and 7.0–7.5 % on the breast series (RESLEVEL). On `dbts_b1` (D):

```
exact frame (R, htj2k-software.md §2)           2 148 203 B
level-1 prefix   0.262 × … = 562 829 B   ·   0.285 × … = 612 238 B
the view a frame (R, 185.7 Mbit ÷ 50 ÷ 8)         464 250 B
prefix ÷ view                              1.21 · 1.32
rest of the frame, sent after          1 585 374 B · 1 535 965 B
```

The whole series is the exact series, 4.63× the view's bytes (R); today's view plus every exact frame is 1.22× the
exact series (D: 1 + 0.216). So a session that ends up asking every exact frame sends ×0.82 of today's bytes; one that
never asks sends 1.21–1.32× the view for the scroll.

## 5. Decode on a phone (theory)

No HTJ2K frame has been timed on a phone (`htj2k-software.md` §3). Carried, labelled so:

```
whole dbts_b1 frame on the phone, predicted (T, htj2k-software.md §3)      77.6–127.4 ms
level 1 from its prefix ÷ the whole, breast series, Chromium 141 (R, RESLEVEL) 0.27–0.31
level 1 on the phone = 77.6 × 0.27 … 127.4 × 0.31                          21.0–39.5 ms   (T)
a fill of 50 frames, three decoders: 50 × 21.0 ÷ 3 … 50 × 39.5 ÷ 3         0.35–0.66 s    (T)
the AV1 view on the phone, three decoders (R)                               133–135 ms a frame; 2.25 s a fill
level then the whole from scratch, × the whole alone (R, the ladder)        1.10–1.45
```

The ratio 0.27–0.31 is RESLEVEL's, on the breast series (its worked examples FFDM), not DBT slices, at 1× and 4×, on
x86 in a container. OpenJPH has no ARM SIMD natively, but "in the browser a phone gets OpenJPH's SIMD" through its WASM
kernels (R, `docs/decode/README.md` §What the code says); whether the ratio carries to an Arm core is P1's (T).
*Corrected 2026-11-17 (minor 5): this read "measured on x86 in a container; an Arm core's WASM SIMD is not an x86
core's".* The level picture and the view are not of equal quality (§2 item 3): the decode times compare a picture that
failed the visually lossless proxy with one chosen to meet it.

## 6. A fill and an ask over the link profiles (D on T)

Goodput *G* from `claude/link-targets:docs/transport/link-profiles.md` (Ookla tile means, capacity, not one session),
as `htj2k-software.md` §4 uses them. A `dbts_b1` fill at level 1 is 225.1–244.9 Mbit (50 × the prefix × 8); its time
is the wire or the decode (§5), whichever is longer; the view's is 185.7 Mbit ÷ *G* with its 2.25 s decode floor.
Every ratio compares unequal quality: the level picture failed the visually lossless proxy at display scale, the view
is meant to meet it (§2 item 3).

| link (*G*, Mbit/s) | level 1 on screen | the view on screen | ratio |
| --- | --- | --- | --- |
| home Wi-Fi, measured (≥ 600) | wire 0.38–0.41 s, decode 0.35–0.66 s | 2.25 s (decode) | ×0.17–0.29 |
| fixed, world median (218) | 1.03–1.12 s | 2.25 s | ×0.46–0.50 |
| mobile, world median (103) | 2.19–2.38 s | 2.25 s | ×0.97–1.06 |
| mobile, world 10th percentile (18) | 12.5–13.6 s | 10.3 s | ×1.21–1.32 |

An ask for a frame not yet stored, at 103 Mbit/s (one round trip and the controller's start left out): the level
picture 43.7–47.6 ms on the wire + 21.0–39.5 ms = 65–87 ms, against the view's 171 ms (`htj2k-software.md` §4). The
exact frame after it: the rest, 119–123 ms on the wire, and the whole decode, 77.6–127.4 ms (T). *Corrected
2026-11-17 (minor 3): home Wi-Fi's low end, max(0.375 s, 0.35 s) ÷ 2.25 s, read ×0.18.*

## 7. Its disadvantages and what it needs

* **Below the view's quality until the exact frame arrives**: the level picture failed the visually lossless proxy at
  display scale, `dbts_b1` 46.9 dB against the area-resampled exact frame, 81–83 % of codes differing over `dbts_b1`
  and `dbts_c1` (R, the ladder, `8a55ee8e`; §2 item 3). *Corrected 2026-11-17 (blocker 1): not listed before.*
* **Narrow reach** (§3): upright with one view, one volume of 19 on a 1080-wide phone, none on a 1440-wide one.
* **Slower on a poor link**: ×1.21–1.32 the view's fill at 18 Mbit/s (§6).
* **Two decodes a frame** where the exact frame is wanted: ×1.10–1.45 the whole alone (R).
* **The store** holds decoded samples and never re-decodes (decided): a level-1 `dbts_b1` picture is
  1280 × 1664 × 2 B = 4.26 MB, 213 MB a volume (D; the tiles row derived ~215 MB). Kept beside the exact frame or
  replaced by it is a choice not made here.
* **Not built**, each from a measured finding: the product's decoder binds no level decode (`docs/decode/README.md`
  §A prefix draws a smaller image; OpenJPH offers it as `restrict_input_resolution`, S2); the clamp to 2^B − 1,
  without which 15 of 35 frames were not exact (R); the SIZ reset after a level, without which a reused decoder reads
  the next frame small (R, the ladder file); a digest per level from ingest; the level's byte offset in the store
  and a prefix ask (the ADR §7, items 1–2); the render path taking a smaller picture, the ADR's §4 blocker.

## 8. Phone cells, as asks

Exploratory, deciding nothing, for `claude/phone-protocol:docs/phone-rows/next-round.md` §Decode-option cells:

| ask | settles |
| --- | --- |
| P1 · `dbts_b1` level 1 from its prefix, against the whole frame, OpenJPH-WASM, three decoders | §5's 21.0–39.5 ms and the 0.27–0.31 ratio on an Arm core (beside cell 1) |
| P2 · a `dbts_b1` fill at level 1 against the AV1 view, interleaved, on the round's link | §6's row for that link |
| P3 · the viewport's device pixels, upright and sideways, as the page measures them | §3's reach on a real browser |
| P4 · the exact frame after its level picture, the rest asked and the whole decoded | the second decode's cost (×1.10–1.45 on x86) |

## 9. Sources

Fetched by this row on 2026-11-17.

* **S1** DICOM PS3.5 2026d, *Data Structures and Encoding*, §10.18.1 *HTJ2K Lossless RPCL*,
  <https://dicom.nema.org/medical/dicom/current/output/html/part05.html>: "The HTJ2K Lossless RPCL Transfer Syntax
  allows for progressive display of images, as well as retrieval of thumbnail images. The progression order shall be
  RPCL (Resolution Position Component Layer). This sequences the resolution blocks so that lower resolutions can be
  read first." and "The Tile Length Markers (TLM) shall be present. This allows finding the resolution breakpoints to
  support smart streaming."
* **S2** OpenJPH 0.31.0 at `c68064d0e4cad8e96bab9a068f6cc4e7799744fc` (the client's pin,
  `client/decode/wasm/build/pins.sh`), `src/core/openjph/ojph_codestream.h`: `restrict_input_resolution`,
  "skipped_res_for_recon specifies for how many fine resolutions reconstruction is skipped; the resulting image is
  smaller than the original."

## 10. Fixtures and limits

19 DBT volumes for sizes and the reach; 15 DBT volumes and the breast series for the prefix shares; three timed DBT
volumes of one dataset (`dbts_a1`, `dbts_b1`, `dbts_c1`) for every time carried; no breast ultrasound cine. 4-core
cloud hosts without a GPU, headless Chromium, software decode, for every ratio. One Android 16 phone (Chrome 157),
one home Wi-Fi link, one evening, for the only phone number (133–135 ms). Screen sizes are assumed, not measured.
Nothing was run by this row.
