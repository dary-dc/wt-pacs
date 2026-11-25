# The exact frame's layout: three strips, or a level picture first

Written 2026-11-22 by row EXACT-LAYOUT-PAGE (`claude/work-ledger:docs/queue-2026-11-14.md`), a session that ran none of
the layout's rows, from pushed results only; nothing run. Inputs at: `claude/htj2k-a1` `4189ef47`
(`docs/htj2k-tiles.md` §Verdict, §A1 measured, §A1 review; the rows under `lab/htj2k-tiles/improve/rows/`; PR 408),
`claude/mobile-decode` `6ae00ae9` (`docs/decode/mobile/htj2k-preview.md`; PR 397), and on `origin/claude/unified`
`docs/client/evidence/exact-frame-by-htj2k-layout.md`, `docs/disk-layout/target.md` §Layout 1 and
`docs/lines/codecs.md` §Decisions and §Open 7. *Names:* **D** is today (the optimal-quality AV1 scroll, the whole
exact HTJ2K frame on a Lossless request); **D+T1** D's codestream through the lab page's path; **D+T3** the exact frame
stored as three strips, each its own codestream, decoded on three decoders; **D+L★** D+T3 with an exact picture at the
screen's resolution level shown before the whole frame; **Layout 1** the store format both need
(`target.md` §Layout 1: tile-parts at resolutions, TLM, three strips, band-major entries).

## 1 · The question

When a reader asks for the exact frame (*Lossless*), it is the original HTJ2K frame, bit for bit, and today it arrives
whole. Two ways to shorten that wait were measured on the cloud host: split each stored frame into three strips that
three decoders decode at once (D+T3), and, where the screen shows the frame smaller than it is, paint an exact picture
of the frame's reduced resolution level first (D+L★). Both need a new store format, which means a re-encode of every
series it applies to at the PACS. The run's rule kept Layout 1 for D+T3 (A1, §4); whether to build it, and whether
a level picture may ever be shown before the original, are the owner's.

## 2 · The recommendation, and the owner's yes or no

**Keep Layout 1 proposed for D+T3 only, build nothing yet, and queue a phone's P1 and P2 to decide the build; do not
show a level picture before the exact frame for now; send the PCS team the note in §9.**

| # | the owner's yes or no | recommended | a yes changes | a no leaves |
| ---: | --- | --- | --- | --- |
| 1 | Layout 1 is carried by D+T3, by A1's rule as written (§4); D+L★ does not carry it alone | **yes** | `htj2k-tiles.md` §Verdict's "D+T3 is withdrawn, and D+L★ alone carries Layout 1" branch closes; codecs §Open 7 reads "proposed for D+T3" | the branch stays open, though the rule has already chosen |
| 2 | Build Layout 1 now, for DBT series that have a level to gain | **no** | a store format, a re-encode of each such series at the PACS, a strip binding in the client, a new label state per strip; for a measured ×0.923 of the wait on one link-bound cell of one volume, nothing measured on a phone | D, as today |
| 3 | Queue P1 (is a phone's fill decode-bound) and P2 (the Lossless request, D against D+T3, on P1's link-bound links) for the next phone round | **yes** | two cells in the next round's `next-round.md`; P2's rule (R3 as written) decides the build | the build waits on this host's one cell; a phone may gain more or less (§4) |
| 4 | Queue P3 (the store on a phone) | **no, until the cache is turned on** | a cell for a store that is off (`cache.md` §2 item 6) | P3 waits on the cache's own decision |
| 5 | An exact level picture, which failed the visually lossless proxy at display scale, may be painted before the original frame (D+L★), in the words of §5 | **no, for now** | reopens the decided "no low-resolution preview" (§7); a label state, a level binding, a per-tile level digest | the reader sees the view, then the original; nothing in between |
| 6 | The note to the PCS team (§9) is sent, by the owner | **yes** | the PACS learns whether the PCS's frames already follow DICOM's RPCL syntax | the profile stays ours, not known to be the PCS's |

**How it serves the value statement** (`README.md`'s opening, amendment 27 of the program): D+T3 serves "low latency on
every jump" to an exact frame, with "the original, bit for bit, and checked" kept (the three strips stacked hash to the
frame's digest, `target.md` §Layout 1). D+L★ shortens a wait by showing something that is not the original and failed
the view's own quality proxy, so it does not serve the statement's promise for an exact ask.

## 3 · The options

`dbts_b1` (50 slices of 2560 × 3328, 10 bits), the one link-bound cell `r5000` (5 Mbit/s), 4× CPU cap, medians of
round-paired ratios over 4–6 rounds, s the A/A noise; **measured** unless labelled.

| option | Lossless request ÷ D's | first exact pixels on screen ÷ D's | bytes | where it applies | what it costs |
| --- | --- | --- | --- | --- | --- |
| **D**, today | ×1 (D 4 033 ms; D′ 4 025 ms) | ×1 | the whole frame | every series | nothing |
| **D+T3** | **×0.923** [s 0.014] (A1, and stage 3: ×0.923 [0.016]); other volumes at `r5000` 4×: ×0.930–0.954 (A1), ×0.908–0.936 (stage 3); at 1×: ×0.977–0.984 | as its Lossless | +0.11–0.14 %; `dbts_b1` −0.20–0.24 % | every large exact frame, whatever the screen | Layout 1; a re-encode at the PACS; three decoders free for one ask |
| of which the strips (D+T3 ÷ D+T1) | **×0.943** [0.014], n 4, pairs 0.937–0.950; predicted ×0.96–0.99, **missed** | | | | |
| of which the lab page's path (D+T1 ÷ D) | ×0.979 [0.014], n 5: under a quarter of the gain, no product-path finding (rule ×0.95) | | | | |
| **D+L★** | ×1.010 of D+T3's (stage 3) | **×0.264** (4×), ×0.279 (1×) (stage 3) | as D+T3; a kept level picture +213–215 MB a `dbts_b1` volume (**derived**) | only where the screen's level is ≥ 1: 1 of 19 DBT volumes upright on a 1080 × 2400 phone, 0 on 1440 × 3120, 12 sideways, 8 in two views (**derived**) | Layout 1; a picture 46.9 dB from the original resampled to the screen, 81–83 % of codes differing and 51–54 % by more than one over `dbts_b1` and `dbts_c1` (measured, the ladder); a label state |

Decode alone (stage 2, **measured**): three strips on three workers decode a frame in ×0.43–0.48 of the whole frame's
time at 4× (×0.45–0.52 at 1×), and in ×0.98–1.04 on one worker: the strips spread the decode, they add none.

## 4 · Where it holds

**Fixtures and limits.** Three timed DBT volumes of one dataset (EA1141: `dbts_a1`, `dbts_b1`, `dbts_c1`) on one
cloud host; every limit, and where the host saturates, is in the list at the end of this section.

**A1's rule, as registered and applied** (`htj2k-tiles.md` §A1, recomputed in §A1 review, all 36 medians to the third
decimal): Layout 1 stays proposed for D+T3 when the strips' effect is ≤ ×0.95 × (1 + s) = ×0.963 at 4× on `dbts_b1`
`r5000`. It is ×0.943, so it stays. §Verdict's "R3's pass rests on a part that is not the strips" is corrected there to:
mostly the strips, about a quarter the lab page's path.

**Phones.** Nothing is measured (the list below). The one phone measured filled `dbts_b1` decode-bound on AV1 at
133–135 ms a frame (`htj2k-preview.md` §5). **Theory:** where the Lossless wait is the decode, not the link, the strips' ×0.43–0.48 decode applies more fully,
so a decode-bound phone would gain more than this cell's ×0.923, if three decoders are idle when the reader asks (an
*assumption*: on a phone they may be busy with the fill). P1 says which a phone is; P2 measures it.

**US and DBT stacks** (amendment 27, item 6). The result carries by frame size, not modality: a frame gains from strips
by its decode time, and from a level picture only where it is at least twice the screen's side
(`htj2k-tiles.md` §Theory 3, **derived**). DBT systems A and C (up to 1147 × 2585) and breast ultrasound frames are
smaller than that on every screen in the table there, so D+L★ gives them nothing; whether three strips pay for frames
that small is in the list below.

**Where the link, not the decode, binds** (2026-11-25, PAGES-PASS). For a Lossless ask, the link, on every link:
"C1's exact frame on every link (round trips and slow start on an idle session)" (**derived**,
[`delivery-per-link.md`](delivery-per-link.md) §4). An exact HTJ2K series is wire-bound on a phone on every profile but
mmWave and the measured home Wi-Fi, a crossover of ~470–660 Mbit/s, "if its phone decode keeps the cloud's ratio to
the view's, which is **unmeasured**" (**derived**, [`../transport/link-profiles.md`](../transport/link-profiles.md)).
On this host `r5000` is link-bound (**measured**, the list below), `r20000` decode-bound only under the 4× cap. So the
strips, which shorten the decode, gain least where the link binds most, and a level picture, which shortens the bytes,
acts on every link (**theory**, §5). On the one phone measured the exact series filled faster than the view in 15 of
15 rounds, median 0.705 (`README.md` §Premises item 1; the premise itself untested); no transport row is lowered by
that decode-bound phone.

**Each limitation, and what found it** (2026-11-25, PAGES-PASS):

* The deciding reading is one cell (`dbts_b1` `r5000` 4×) of one volume of one dataset, from 4 and 5 paired rounds.
  Found by HTJ2K-A1-RUN (`htj2k-tiles.md` §A1, measured), restated in HTJ2K-A1-REVIEW's fixtures line.
* The readings outside that cell rest on fewer than six pairs (down to 1, `dbts_a1` `r20000` 4×) and decide nothing.
  Found by HTJ2K-A1-REVIEW m3.
* One 4-core cloud host, no GPU, headless Chromium 157 (A1; stage 3 ran 153), software WebCodecs, a userspace relay, a
  4× cgroup cap standing in for a phone (*assumption*). Found by HTJ2K-A1-RUN's run line and HTJ2K-A1-REVIEW.
* No breast ultrasound in any run: the sets are `dbts_*/phone` only. Found by HTJ2K-A1-RUN's readings of the registration.
* **The host saturates**: at `r20000` every volume is decode-bound (D's fill at 4× is ×1.38–1.56 its 1×), so those
  cells (D+T3 ÷ D ×0.805–0.951) decide nothing; `r5000` is link-bound on every volume (×1.008–1.012). Found by
  HTJ2K-A1-RUN by stage 3's test, reproduced by HTJ2K-A1-REVIEW.
* The strips' prediction ×0.96–0.99 **missed** (×0.943). Found by HTJ2K-A1-RUN, reading 1.
* R3 held on this host only with s (×0.923 against 0.92 × 1.016). Found by HTJ2K-VERDICT (`htj2k-tiles.md` §Verdict).
* §Verdict's "R3's pass rests on a part that is not the strips" was wrong (mostly the strips). Found by HTJ2K-A1-RUN,
  checked by HTJ2K-A1-REVIEW.
* No HTJ2K frame has been timed on a phone; the round of 2026-11-22 carries an HTJ2K decode per frame (cell 1) but no
  Lossless-request arm and none of P1–P3. Found by this page's reading of `claude/phone-run:docs/phone-rows/SATURDAY.md`.
* Three decoders idle when a phone's reader asks is an *assumption* (they may be busy with the fill). Found by this
  page (§4's theory); P2 tests it.
* Whether three strips pay for frames smaller than `dbts_*`'s (systems A and C, breast ultrasound) is not measured.
  Found by this page: the stage-2 rows are on `dbts_*` only (`htj2k-tiles.md` §Improve, measured: stages 0–2).
* A level picture is 46.9 dB from the original resampled to the screen and failed the visually lossless proxy.
  Found by the resolution ladder (`htj2k-progressive-delivery.md`, `8a55ee8e`), as `htj2k-preview.md` quotes it.
* "Never a reduced-resolution preview" has no reason written beside it. Found by HTJ2K-PREVIEW-MOBILE's documentation
  finding (`htj2k-preview.md` §2).
* The kept level picture's +213–215 MB and D+L★'s reach (1 of 19 volumes upright on a 1080 × 2400 phone) are
  **derived**, not measured (§3's labels); what found it is not recorded beyond those labels.
* Whether a reader reads anything from a level picture before the original lands: no reader, and no agent runs a
  reader study. Found by this page (§6); `README.md` §Premises item 5.
* `target.md` names Layout 1's series "over 12 bits"; `dbts_b1` is 10. Found by this page (§7).
* Whether the PCS's planned HTJ2K already follows the RPCL syntax is not known. Found by PCS-NOTE-FIX (`pcs-note.md`
  §Review B1, §9's lead).

## 5 · The mechanism

**Strips.** A Lossless ask waits for the bytes, then for one decoder to decode the whole frame. Cut into three strips,
each its own codestream, the frame is decoded on three decoders at once: the bytes stay the same, the decode falls to
under half. On a link-bound cell the decode is a small part of the wait, so the gain is small (×0.943 from the strips);
on a decode-bound one it is larger.

**A level picture.** HTJ2K in RPCL order holds each lower resolution as a prefix of the codestream: level 1 is
26–29 % of a frame's bytes, so it arrives and decodes in about a quarter of the time. It is exact against the
codestream (the 5/3 wavelet's low band), but it is not the original frame resampled to the screen: on `dbts_b1` it
is 46.9 dB from that picture, and it failed the visually lossless proxy the view is held to. The record's "never a
reduced-resolution preview" has no reason written beside it (`htj2k-preview.md` §2, a documentation finding).
**Words, if item 5 were a yes** (a proposal, not used anywhere): "Exact at half resolution · not the original yet",
replaced by the exact label when the whole frame lands.

**Why a re-encode.** A strip cannot be cut out of a whole-frame codestream; each must be encoded on its own, and a
DICOM frame is one codestream, so a series stored as strips is reassembled (decoded and encoded again) on any export
(`target.md` §Layout 1 Migration; `htj2k-tiles.md` §How each fits the PCS's input).

## 6 · What would change the recommendation

* **P2 on a phone:** R3 as written, on P1's link-bound phone links: D+T3's Lossless request ≤ ×0.92 of D's at
  `dbts_b1` in two thirds of them, and ≤ ×1.02 everywhere. On this host it held only with s (×0.923 against
  0.92 × 1.016, §Verdict). A clear pass on a phone makes item 2 a yes; a miss withdraws D+T3 and with it Layout 1.
* **The PCS's answer (§9):** if the PCS can deliver each large frame already as three strips, or as RPCL with TLM, the
  re-encode at the PACS shrinks or goes; it does not change the ratios.
* **For item 5**, a reader study, which no agent runs: whether a reader reads anything from a level picture in the
  time before the original lands.

## 7 · What it would reopen

* **D+L★ reopens "no low-resolution preview"** (the program's §Decided approaches; `docs/lines/codecs.md` §Decisions,
  2026-10-10: "never a reduced-resolution preview"). Nothing here is built on it.
* **D+T3 reopens nothing** in our reading: the owner's rule of 2026-10-10 ("frames of 12 bits or fewer are filled")
  is about the fill, and D+T3 changes only how the exact frame is stored. But `target.md` §Layout 1 names its series
  as "over 12 bits", and `dbts_b1` is 10 bits; R3 itself proposes "Layout 1 for DBT". So a build widens that line,
  the owner's to confirm with item 2.
* **Why the strips keep "the exact HTJ2K frame, bit for bit"** (2026-11-25, PAGES-PASS; `README.md` §Review's nit):
  in its samples, not its codestream. Each strip is encoded losslessly from the decoded frame, and "the three level-0
  tiles together are the frame exactly: their samples, stacked, hash to the frame's digest of today …, which the
  packer checks before it publishes" (`target.md` §Layout 1); a frame that does not match stops the series
  (§Migration step 1). Today's whole-frame codestream is not kept, and an export re-encodes one (§5).

## 8 · Rows and links

* HTJ2K-TILES, -REVIEW, -IMPROVE, -MEASURE, -VERDICT (2026-11-09 to 11-12): `claude/htj2k-a1:docs/htj2k-tiles.md`;
  folded to `docs/client/evidence/exact-frame-by-htj2k-layout.md` (PR 324).
* HTJ2K-A1-BUILD, -BUILD-REVIEW, HTJ2K-A1-RUN, HTJ2K-A1-REVIEW (2026-11-19 to 11-21): PR 408 on `claude/htj2k-a1`;
  rows `lab/htj2k-tiles/improve/rows/a1-run-1.jsonl`, `a1-run-2.jsonl`; status files `claude/work-ledger:docs/queue/HTJ2K-A1-*.md`.
* HTJ2K-PREVIEW-MOBILE, -REVIEW, -FIX, -FIX-REVIEW (2026-11-17): `claude/mobile-decode:docs/decode/mobile/htj2k-preview.md`, PR 397.
* The store format: `docs/disk-layout/target.md` §Layout 1 (row TILESTORE, 2026-10-13, a proposal).
* The line: [`../lines/codecs.md`](../lines/codecs.md) §Open 7.

## 9 · The note to the PCS team (drafted, not sent)

*Corrected 2026-11-24 (PCS-NOTE-FIX; `pcs-note.md` §Review B1):* the lead said "We store and serve your HTJ2K frames"
and "the HTJ2K you deliver"; the PCS's code writes raw frames, which our ingest codes in HTJ2K
([`../ingest/contract.md`](../ingest/contract.md) §What each name means and §What the ingest reads, on
`origin/claude/unified`), and its README's `c/` and `mf.mxf` are planned. The note sent is `pcs-note.md` §9 part B.

> Your parser's code writes raw frames, which our ingest codes in HTJ2K on your side; your README plans per-frame HTJ2K
> under `<S>/c/`, gathered into `mf.mxf`. For the largest frames we are weighing a layout that decodes faster on a
> reader's device, and whether it costs a re-encode depends on that planned HTJ2K, and on any HTJ2K object that
> reaches you from a modality. For each, could you tell us:
>
> 1. The transfer syntax UID: 1.2.840.10008.1.2.4.201 (HTJ2K Lossless), .202 (HTJ2K Lossless RPCL) or .203?
> 2. The progression order, the number of decomposition levels, and whether TLM markers and tile-parts per
>    resolution are written.
> 3. The number of tiles and the code-block size.
> 4. The number of quality layers.
> 5. Whether your planned encoder could write a large frame as three horizontal strips, each its own codestream, for
>    a second delivery beside the DICOM one, or whether our ingest should code them.
>
> For reference, DICOM PS3.5 §10.18.1 asks of the RPCL syntax: "The progression order shall be RPCL (Resolution
> Position Component Layer). This sequences the resolution blocks so that lower resolutions can be read first. The
> number of decompositions shall be sufficient for the width or height of the base resolution to be <= 64. … The
> Tile Length Markers (TLM) shall be present. This allows finding the resolution breakpoints to support smart
> streaming." (**source**: DICOM PS3.5 2026e, §10.18.1,
> <https://dicom.nema.org/medical/dicom/current/output/html/part05.html>, fetched 2026-11-22.)

## Review

*Owed: DECISION-PAGES-REVIEW.*
