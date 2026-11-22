# What the green mark proves: a fault model for a frame's path

**The question:** which faults can put a wrong picture on the screen, which check catches each, and what is the
smallest set of checks for which every state of the label is true?

*2026-11-22, theory and sources; nothing built, run or timed. Every number is labelled **source** (quoted, §10),
**measured** (by an earlier row of this repository, linked), **derived** (arithmetic on those) or **theory**; a rate
nobody published is written **unknown**. The measured numbers quoted here come from 4-core x86 cloud hosts without a
GPU, headless Chromium and Firefox, SwiftShader for the paint, the lab's four HTJ2K series and three DBT volumes of one
dataset; no phone, no hardware decoder, no breast ultrasound cine. Read on `origin/claude/unified` `4a2b4277f` and, for
PR 368, `origin/claude/oq-integrity-build` `a59aa4310`. It decides nothing: the owner's calls are §9.*

## 1 · In short

1. **The frame check is the right check, in the right place, and nothing replaces it.** A digest over the decoded
   samples is the only check that stands after the decoder, so it is the only one that can catch a decoder, an engine
   or a processor returning wrong samples. Every fault a coded-bytes digest would catch, it catches too.
2. **What it proves is narrower than the label's words.** A match proves that the samples handed to the painter, at
   the moment they were hashed, were the ones the ingest recorded for that frame index. It does not prove the ingest
   read the source rightly, that the display parameters in the metadata are the ingest's, that the samples are still
   the same a minute later, that the texture on the GPU is that frame, or that the label on screen belongs to the
   picture under it.
3. **Three faults pass every check today with a green label** (§3, rows 5, 11 and 12): a damaged display parameter
   in `metadata.json` (slope, window, photometric interpretation, the depth cut's shift); a held frame damaged in memory
   after its check; the painter drawing another frame's texture. None has a published rate. The first costs one hash
   a series to close, and that is the one recommended.
4. **One state shows the wrong slice.** A frame withheld after two failed decodes relabels the view and paints
   nothing, so the canvas keeps the previous frame's picture under the new frame's index (§5, read in code, not run).
   "Blocked" has to remove the picture.
5. **Three different failures share one label.** *Lossless check failed* is shown when the exact frame never came,
   when it came and failed its check, and when its series has no digest. Only the second is a failed check (§5).
6. **A coded-bytes digest detects nothing new; it buys location.** Location is what decides the repair: only then
   is one re-ask justified (the bytes were wrong on arrival) or pointless (the decoder is wrong), and only with it can
   the server re-check its store with one hash and no decoder. Hashed only after a mismatch, it costs the common path
   nothing (§4.1, §7).
7. **The smallest set** for which every label state is true (§7): the frame check on every frame of both series
   (decided, measured); an ingest that never stores a frame without a digest; one digest over the metadata; the label
   and the picture changed by one event, with a check per state; the picture removed when a frame is withheld. Location
   (the coded-bytes digest, the server's re-check) and a read-back of the paint are the next tier, each with its cell
   in §8.

## 2 · The path of a frame, and where the checks stand

```
 1 source          the pixel data as the PCS delivers it
 2 ingest read     the source decoded to samples S in the ingest's memory
 3 ingest code     S hashed (the frame digest); S coded; the coded frame decoded back and compared with S
                   the view: S coded lossy, decoded by dav1d to R, R hashed (the reconstruction digest, PR 368)
 4 store           coded bytes in the bundle; digests and display parameters in metadata.json
 5 server          the bytes read and framed onto the session; the metadata served over HTTP
 6 wire            QUIC's AEAD
 7 receive         the browser's QUIC and WebTransport, the consumer's framing, the hand to a decoder worker
 8 decode          coded bytes to samples in shared memory
 ── the frame check: XXH3-64 of those samples against metadata.json's digest for that index ──
 9 hold            the samples stay in shared memory, by index, for as long as the series is open
10 paint           the window table from the metadata (CPU); upload to an integer texture; pass 1 windows it;
                   pass 2 filters and places it on the canvas
11 label           the quality label and the mark, DOM text beside the canvas
12 screen          the compositor, the panel, its calibration
```

The check sits between 8 and 9. Steps 4 to 8 are in front of it for the coded bytes; the digest itself travels by
another road (4, 5, HTTP, the page's memory). Steps 9 to 12 are behind it. Step 3 is in front of it in time and
behind it in logic: the check compares against what step 3 wrote.

## 3 · Faults by step, and which check catches each

*Catches* means the reader does not see the wrong picture as if it were right. **Today** is the frame check with its
second decode, as built (`../../adr/exactness-in-production.md` §Built), and for the view PR 368's reconstruction
digest. **Coded** is a digest of the coded bytes written at the ingest and compared on the client. **Server** is the
server hashing its stored frame when a safety report names it. **Read-back** is reading painted values back from the
GPU and comparing them with the CPU reference (`client/paint/reference.js`).

| # | step | fault | rate | today | coded | server | read-back |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | source | the PCS or the modality delivers wrong pixel data | unknown | no | no | no | no |
| 2 | ingest read | the source decoded wrongly (byte order, sign, a transfer syntax) | unknown; a build's defect, the same on every frame of a kind | **no: the digest is taken from the wrong samples, so the client confirms them** | no | no | no |
| 3 | ingest code | the encoder or the ingest's memory corrupts the coded frame | unknown | yes, earlier: the ingest refuses a frame that does not decode back | — | — | — |
| 4 | store | coded bytes change at rest | **source:** 0.86 % of nearline and 0.065 % of enterprise disks developed a checksum mismatch in 41 months, clustered in place and time (§10, FAST'08) | yes: the frame decodes wrong or not at all; never mended | yes, before decoding; names the bytes | **yes, and confirms the store** | — |
| 5 | store | `metadata.json` changes at rest: a digest's digit | as row 4 | yes, falsely: a right frame is withheld (safe) | — | — | — |
| 5 | store | `metadata.json` changes at rest: `rescale`, `window`, `photometric`, `bitsStored`, the depth cut | as row 4 | **no: right samples, wrong picture, green label** | no | no | no (the reference reads the same parameters) |
| 6 | server | a transient flip while the bytes are read or framed | unknown (servers: **source**, "a few mercurial cores per several thousand machines", [`where-a-frame-can-be-corrupted.md`](where-a-frame-can-be-corrupted.md)) | yes; withheld, though a second copy would be right | yes; names the bytes, so a re-ask is known to be worth one try | says the store is clean | — |
| 7 | wire | bytes change in flight | excluded: a changed packet fails its 16-byte tag and is sent again (**source**, RFC 9001 §5.3, §5.5, quoted in the same file) | — | — | — | — |
| 8 | receive | a frame's bytes shifted, cut short or filed under another index, above the AEAD | unknown | yes: the digest is per index | yes | says the store is clean | — |
| 9 | decode | the decoder, the engine or the processor returns wrong samples | unknown for browsers and phones; this repository met one (libaom 3.8.2, lossless inter frames, on some content) | **yes: the only check that can**; mended by the other route where one exists | no; a good coded digest with a bad sample digest names the decoder | says the store is clean | — |
| 10 | decode | the decoder never returns, or fails, on damaged bytes | **measured** (the fault bench, [`../../adr/exactness-in-production.md`](../../adr/exactness-in-production.md) §8): a hang fails by name after two 10 s deadlines; OpenJPH decodes a truncated codestream without error | yes, late for a hang | yes, before the decoder sees the bytes, if hashed first | — | — |
| 11 | hold | a sample flips in memory after the check | unknown for phones; **source**, consumer PCs: 1 in 1 700 crashed from a one-bit flip in kernel code pages, 1.5 % of memory, in 8 months (§10, EuroSys'11) | **no** | no | no | only inside the texels read |
| 12 | paint | the texture drawn is not this frame's (a skipped upload, a stale texture), or the upload or pass 1 is wrong on this GPU | unknown; **measured** only on SwiftShader: every 1:1 cell equals the reference to the code (`client/paint/README.md`) | **no** at run time; the gate's paint check on one software renderer | no | no | **yes, exactly**, for the texels read (§4.2) |
| 13 | paint | pass 2 misplaces, flips or filters wrongly on this GPU | unknown; **source:** "The OpenGL ES specification is not pixel exact" (§10) | no at run time | no | no | within a tolerance only; exactly at 1:1 |
| 14 | hold, paint | the held frame of index *j* is painted for index *i* | unknown; a defect of our code | **no**: both were checked, each for its own index | no | no | no |
| 15 | label | the label or the mark on screen belongs to another frame or another state | **measured** once: PR 368's review found the previous frame's ✓ left on a refused frame, since fixed there | by tests only (`demo-check.mjs`, two states) | no | no | no |
| 16 | screen | the compositor, the panel or its calibration alters the picture | unknown | no | no | no | no |
| 17 | any | a hostile server sends a wrong frame with its matching digest | outside the model (`../../adr/exactness-in-production.md` §7, *What it does not cover*) | no | no | no | no |

Reading the table by column:

* **Today's check** covers rows 4, 6, 8, 9 and 10: everything between the ingest's hash and the client's, which is
  what it was built for. A miss is one in 2⁶⁴ per damaged frame (**derived**, the same ADR §7).
* **The coded-bytes digest** covers a subset of those rows (4, 6, 8, 10) and no row of its own.
* **Nothing** covers rows 1, 2, the second row 5, 11, 12, 13, 14 and 16 at run time. Rows 1 and 16 are outside the
  software (the value statement: "Its input is what the PCS delivers"). Row 2 belongs to the ingest's own tests: its
  two digest mutants (big-endian, zero-extended) were of exactly this kind, and the check that caught them was a
  digest written by an independent reader, in the lab only. The others are §4.2.

**Faults come in clusters, not one frame in a million.** Each published study says so: checksum mismatches "within
the same disk are not independent events and they show high spatial and temporal locality" (FAST'08, abstract); "a
machine that crashes from a fault in hardware is up to two orders of magnitude more likely to crash a second time"
(EuroSys'11, abstract); memory errors "are dominated by hard errors" (SIGMETRICS'09, abstract). So the model is not
"every frame carries a small chance": it is "most devices and stores never fail, and one that fails once fails
again". Two things follow (**theory**): a failure is evidence about the device or the store, not only about its
frame, so the safety report and its per-route counts matter as much as the block; and an average rate per frame,
were one published, would describe no real device.

## 4 · Three premises, questioned

### 4.1 That a digest over decoded samples is the one check

It cannot tell wrong bytes from a wrong decoder. Whether that matters depends on what a decoder is allowed to do
with right bytes, so the specifications first.

**AV1** fixes the output: "When film_grain_params_present is equal to 0, decoders shall produce output frames that
are identical in all respects and have the same output order as those produced by the decoding process specified
herein." (**source**, §7.2). The ingest codes without film grain, so for given bytes there is one right array of
samples, whichever decoder runs, hardware included; the reconstruction digest is therefore well defined, and a
mismatch on right bytes is a decoder that does not conform. Which decoder ran is not the page's to know: the
`hardwareAcceleration` values "are hints. While User Agents SHOULD respect these values when possible, User Agents may
ignore these values in some or all circumstances for any reason." (**source**, WebCodecs §7.9).

**HTJ2K** fixes it by definition and not by a conformance clause. T.800 defines **lossless** as "the output of the
decoding process is identical to the input to the encoding process", and **reversible** as a process "that does not
suffer a systemic or quantization error and therefore, allows lossless signal recovery" (**source**, §3.61, §3.82);
T.814 says the decoding algorithm "processes an HTJ2K codestream as specified in Rec. ITU-T T.800 | ISO/IEC 15444-1"
with the HT code-blocks by its clause 7 (§6.2). But T.800 itself "does not include a definition of compliance or
conformance" (§7.1): that is T.803 | ISO/IEC 15444-4, which could not be fetched and is not quoted. So an exact
frame's right samples are the encoder's input, and the ingest holds that input.

Both codecs therefore have exactly one right answer per frame, and the ingest knows it. From that:

* **For detection the sample digest is sufficient and cannot be replaced.** A coded-bytes digest alone would trust
  the decoder on the specification's word, and this repository has already met a lossless path that was not exact on
  some content. A known-answer decode at the start of a session (the WebCodecs probe is one) catches a decoder that is
  always wrong, not one that is wrong on some content or once.
* **The coded-bytes digest adds location, and location is worth four things** (**theory**):
  1. *The repair.* The second decode mends a fault in the decoder or its output memory. Nothing today mends wrong
     bytes. Bytes wrong on arrival with a clean store (rows 6, 8) are the one case a second copy would mend.
  2. *The server's part.* The server has no decoder and should not grow one; with a coded-bytes digest its re-check
     of a reported frame is one hash of bytes it already holds, as the archives do (Orthanc, dcm4chee: the same ADR
     §8). Without it the server can only record.
  3. *The decoder's diet.* Hashed before decoding, the decoder only ever sees bytes the ingest wrote, so its
     behaviour on damaged input (row 10) leaves the model.
  4. *The report.* "Bytes" or "decoder", per failure, is what tells an operator to restore a bundle or to turn a
     route off on an engine.
* **Its cost.** XXH3 runs at 5.8–6.8 GB/s in the product's build (**derived** from the **measured** 4.0–4.7 ms on a
  27.3 MB frame, x86, the same ADR §10), and a coded frame is smaller than its samples, so hashing every frame's
  coded bytes costs less than the frame check's 4.0–4.7 ms on the largest frame. Hashed only after a mismatch it
  costs the common path nothing, the wire bytes being still in the worker (the same ADR §8), and gives 1, 2 and 4
  but not 3. At the ingest it is one more hash a frame and 16 hex digits in the metadata: a change to the store's
  content, so structural.

### 4.2 That checking ends at the decoded frame

After the check a frame is held, windowed, uploaded, filtered, placed and labelled. What each of those can be held
to follows from what is specified exactly.

* **The metadata is unchecked, and it is half of the picture.** The window table is computed from `rescale`,
  `window` and `photometric`; the depth cut's frames are scaled by a shift read from the metadata. A damaged digit
  in a digest withholds a good frame, which is safe. A damaged digit in a slope or a window centre paints the right
  samples wrongly under a green label. One digest over the metadata's bytes, written by the ingest beside it and
  compared once when the series opens, closes this against the same random damage the frame check is for. Its cost
  is one hash of a few kilobytes a series (**theory**; not built).
* **Pass 1 can be checked exactly; pass 2 cannot.** Pass 1 reads integer texels and looks each up in the table: no
  filtering, no interpolation. Its output for a sample is a function of that sample and the table, the same on any
  correct GPU, and `reference.js` computes it on the CPU. So a handful of pass-1 texels read back and compared catch
  a stale texture, a wrong upload, a wrong table and a GPU fault under those texels, to the code. That the 1:1 cells
  equal the reference to the code is **measured** on SwiftShader only; on a GPU it is unproved
  (`client/paint/README.md`, *The GPU proof is a later local step*). Pass 2 is bilinear filtering and placement,
  where "The OpenGL ES specification is not pixel exact. It therefore does not guarantee an exact match between images
  produced by different GL implementations." (**source**, 3.0.6 Appendix A); the fractional cells already differ from
  the reference by 1–5 codes on SwiftShader (**measured**, the same README). A read-back of the canvas is exact at 1:1
  and a tolerance elsewhere.
* **"Bit for bit" is a property of the samples, never of a fitted picture.** At any zoom but 1:1 every screen pixel
  is a weighted mean of samples. A 2560-wide frame fitted to a phone's screen is not the original bit for bit on the
  glass, whatever was verified. The label's ✓ is true of what the painter was given, through the reader's window and
  zoom; the words should not promise more.
* **A read-back need not stall the paint.** WebGL 2's own text: `getBufferSubData` "is a blocking operation, as WebGL
  must completely finish all previous writes into the source buffer in order to return a result … The user may be
  able to avoid these costs by signalling intent to read back from the buffer: Insert a fenceSync after writing to the
  source buffer, and wait for it to pass before performing the getBufferSubData operation." (**source**, §10). So the
  shape is: once per upload, not per paint, copy a few pass-1 texels to a buffer, fence, compare when the fence has
  passed, and withdraw the picture on a mismatch. It can only come after the paint. Its cost on a phone's GPU is
  **unknown** (§8, cell 9).
* **A held frame can be hashed again.** The samples stay in shared memory, so any worker can repeat the frame check
  at the measured cost of the first. The exact frame a reader asks for is decoded, checked and painted within
  moments, so its exposure is short; a filled series is held for the whole session. Whether hashing a frame again
  when the reader dwells on it is worth 4–8 ms on the largest frame depends on a phone's memory fault rate, which
  nobody has published. The safety report is the instrument that would measure it.
* **Index and label are our own code, so they are a matter of invariants and tests, not of digests.** A frame is
  checked for the index it arrived under; after that, the store, the controller and the painter each pass it on by
  index or by object. Two invariants cost nothing at run time: the frame carries the index it was checked for and
  the paint refuses a frame whose index is not the one being shown (row 14); and the label and the mark change only
  with the event that reports the paint of that frame, and are cleared when the reader steps to a frame not yet
  painted (row 15). Each state then has one `demo-check.mjs` check, mutated, as PR 368 began.

### 4.3 That every frame must be checked at full cost

The premise assumes the full check is dear. It is measured, and it is not (all **measured**, x86, software decode):

| what | cost | where |
| --- | --- | --- |
| the frame check, a frame | 0.15 ms at 512², 2.8 ms at 1914×2572, 8 ms at 3328×4096; 4–12 % of an HTJ2K decode, 0.5–2 % of an AV1 one | ADR §9 |
| the same after the SIMD build | 4.0–4.7 ms at 3328×4096 | ADR §10 |
| an exact series' fill, wire-bound links, on ÷ off | ×0.94–1.02, every cell's range covering 1 | ADR §Built |
| the same, decode-bound | ×1.00–1.15 | ADR §3 |
| the view's fill with the reconstruction check | +3.7 % at 1×, +1.9 % at 4× (medians of 18 series) | [`optimal-quality-reconstruction-digest.md`](optimal-quality-reconstruction-digest.md) |
| the view's first picture with it | +7.8 % at 1×, +3.5 % at 4× | the same |
| a failed check's second decode | ×2.1–2.3 of a decode (HTJ2K), ×2.8–3.0 (WebCodecs, then dav1d) | ADR §9 |
| writing the reconstruction digest and the coding error at the ingest | +48 to +60 % of the ingest's time, against a bar of 10 % | `claude/work-ledger:docs/queue/I2-RUN.md` |

A sampled check would save at most those few per cent and loses exactly the case that matters: the single frame the
reader is looking at. Inside a group a wrong frame also poisons every later one. And since faults cluster (§3),
checking every frame is what turns the first failure into a fact about the device. **Every frame, both series,
stands** (amendment 1), and the measurements are the argument, not the cost of reasoning about a sample.

The one dear line is the last, and it is at the ingest, once: I2-RUN did not adopt it by its own rule. The
reconstruction digest alone needs the decode the ingest already makes to verify its coding; the coding error's
statistics are the rest. Splitting the two is PR 368's call, not this model's.

A phone's share is unmeasured everywhere above (**theory**: 1–10 % of a decode, the same evidence file).

## 5 · The label's states, derived

A state is true when its words claim no more than what was verified for the picture on the canvas. The evidence a
view can hold for frame *i*: which series the painted samples came from; whether they matched a digest, and which;
and whether anything is painted at all.

| # | what is on the canvas | what was verified | today's words | true? |
| ---: | --- | --- | --- | --- |
| 1 | the view's frame *i*, no reconstruction digest | nothing beyond the wire's AEAD and a decode without error | *Optimal quality* | yes: it claims nothing |
| 2 | the view's frame *i*, reconstruction digest matched | the painter was given the samples dav1d produced at the ingest | *Optimal quality ✓* (PR 368) | yes, of integrity; the same ✓ as *Lossless* invites reading it as fidelity |
| 3 | the view's frame *i*, the exact frame asked | as 1 or 2 | *Optimal quality · fetching lossless…* | yes |
| 4 | the exact frame *i*, frame digest matched | the painter was given the samples the ingest recorded as the source's | *✓ Lossless* | yes, with §4.2's limits: samples, not glass |
| 5 | the view's frame *i*; the exact frame never came | as 1 or 2; of the exact frame, nothing | *Lossless check failed · optimal quality shown* | **no: no check ran** |
| 6 | the view's frame *i*; the exact frame came and failed twice | the exact samples are not the recorded ones | the same words | yes |
| 7 | the view's frame *i*; the exact series has no digest for *i* | nothing of the exact frame can be verified | the same words | **no: no check exists** |
| 8 | **the previous frame's picture**; the view's frame *i* failed its reconstruction digest twice | frame *i* is not as coded | *Optimal quality — not as coded* (PR 368) | the words yes; **the picture is another slice's** |
| 9 | an exact-only series' frame *i*, digest failed twice | the samples are not the recorded ones | the mark *NOT EXACT — reason*, **the pixels painted** | the mark yes; the decision of 2026-11-14 (block) is not built |
| 10 | an exact-only series' frame *i*, no digest | nothing | the mark *unchecked* | yes |

Row 8 is read in the controller on `claude/oq-integrity-build` (`#labelNotAsCoded`: "nothing of it is painted, so no
paint relabels it"); it was not run here. The same holds on `claude/unified` for any refused frame.

**The smallest true set** has five states for a pair and needs three changes of wording and one of picture:

1. *Optimal quality*: the view's frame, checked as coded whenever a reconstruction digest exists. If every view
   frame is checked (amendment 1 names the view's frames too), a ✓ on success carries no information: it is always
   there unless the frame is withheld. Dropping it removes row 2's ambiguity and leaves one ✓ on the page, on
   *Lossless*. The owner's wording.
2. *Optimal quality · fetching lossless…*
3. *✓ Lossless*
4. *Lossless unavailable · optimal quality shown* for rows 5 and 7 (the frame did not come, or cannot be verified),
   and *Lossless check failed · optimal quality shown* for row 6 alone. The split by cause was already owed
   ([`lossless-after-a-failed-ask.md`](lossless-after-a-failed-ask.md), *Not done*); the model adds that row 7 belongs
   with 5, not 6.
5. *Withheld*, for rows 8 and 9: the canvas cleared to a placeholder that names the failed check, never the previous
   frame's picture and never the failed frame's pixels.

## 6 · A series without digests, a withheld frame, a re-ask

**A series without digests.** State 10 and row 7 exist only because a frame can reach the store without a digest.
Three options: show it marked *unchecked* (today); refuse to serve it; or **make it impossible**: the ingest and the
receive path write a digest for every frame they store, computed from the samples they hold, and refuse a frame they
cannot decode back. The lab's ingest already works so ("nothing at all unless every frame decodes back, in-process, to
the samples its checksum was written from", `ingest/coded-frames/ingest.py`). For bytes the PCS codes itself, the
digest would be of the receiver's own decode: it then proves the frame unchanged since receipt, not that the PCS coded
it rightly (row 1 stays outside). The third option removes a label state instead of wording it, and is the one
recommended; whether the PCS sends digests of its own is a question for its team, not a blocker.

**A withheld frame's reveal.** The reveal was asked for a frame with no other way to be seen. On a pair there is
one: the two series are different bytes through different decoders, so each is the other's second path. The exact
frame withheld leaves the view shown (today). The view's frame withheld could bring the exact frame for that index
without being asked (**new, not built**): a few megabytes in place of a few hundred kilobytes, for that frame and, in
a group, for the later frames of its group. Only a frame both series fail is left without a picture, and two
independent failures on one index say the device or the store is not to be trusted with a reveal. For an exact-only
series there is no second series; the sources lean to block without reveal (the same ADR §8, *Block or mark*: every
open viewer read blocks). **Recommended: no reveal.** A withheld frame's pixels are the most dangerous thing the
client holds: wrong by an unknown amount, and plausible.

**What a re-ask can and cannot repair** (amendment 22 stands: only a lost ask is asked again, once).

| the fault | a second decode | a re-ask | known to the client today? |
| --- | --- | --- | --- |
| decoder, engine, processor (row 9), transient | mends | cannot (the same bytes) | no |
| the same, deterministic | mends only on another decoder | cannot | no |
| bytes wrong at rest (row 4) | cannot | cannot, until the store is restored | no |
| bytes wrong on arrival, the store clean (rows 6, 8), transient | cannot | **mends** | no |
| the same, a deterministic defect of the receive code | cannot | cannot; and a race that does not repeat is hidden unless reported | no |
| the ask lost (the session gone, nothing received) | — | mends (amendment 22) | yes |

Without location the client cannot tell the one row a re-ask mends from the rows it cannot, so "never a failed
check" is the right rule today. With a coded-bytes digest that row is known: the coded digest failed. One re-ask
there would mend rows 6 and 8, and a second copy failing with the same computed digest would prove the store wrong
without the server's help. That would widen amendment 22 by one case; it is named in §9 and built nowhere.

## 7 · The checks worth their cost, and those not

| check | catches (rows of §3) | cost | verdict |
| --- | --- | --- | --- |
| the frame check, every frame, both series | 4, 6, 8, 9, 10 | measured, §4.3 | **keep** (decided); the view's half is PR 368 |
| no frame stored without a digest | removes state 10 and row 7 of §5 | none at run time | **worth it**; an ingest rule |
| a digest over `metadata.json`, compared when the series opens | the second row 5 | one hash a series (theory) | **worth it**; a small change to the store's content, the owner's |
| the index checked at paint; the label bound to the paint's event; a check per state | 14, 15 | none at run time; tests | **worth it** |
| a withheld frame clears the canvas | row 8 of §5 | none | **worth it**; part of building *block* |
| the coded-bytes digest, hashed after a mismatch | none new; locates 4, 6, 8, 9 | nothing on the common path; one hash a frame at the ingest | **worth it once the report exists**: it is what makes a report actionable; structural, the owner's |
| the server's re-check of a reported frame | confirms row 4 | one hash a report | **worth it with the line above**; useless without it |
| the pair as its own second path | a picture for a withheld view frame | the exact frame's bytes, on failure only | a candidate; it extends when an exact frame is fetched, the owner's |
| the coded-bytes digest before every decode | 10, earlier | under the frame check's cost (derived) | **not yet**: a deadline already bounds a hang; cell 2 first |
| pass-1 read-back, once an upload | 12 | unknown on a GPU | **not yet**: cell 9 first, and the GPU proof of the paint is owed before it |
| a canvas read-back | 13 at 1:1 only | unknown | **no**: a tolerance elsewhere, and placement is the gate's to prove |
| a held frame hashed again on dwell | 11 | 4–8 ms on the largest frame, in idle time (measured, x86) | **not yet**: no rate; the safety report's counts would give one |
| a sampled frame check | fewer | saves a few per cent | **no** (§4.3) |
| signed digests, a cryptographic hash | 17 | ×7 the hash, and keys | **no**: another design (the same ADR §7) |

## 8 · Cells the fault bench could run (for the next queue)

Each on `lab/faultbench/` as it stands (one fault on one frame, the real server, the product's downloader and
decoder), on the cloud's hosts unless said. A prediction is this model's, written before any run.

1. **A coded byte flipped that still decodes**, HTJ2K and AV1, at the store. Predicted: caught by the frame check,
   the second decode fails, the frame withheld; with a coded-bytes digest, named *bytes* before the second decode.
2. **Truncation and a hang, with the coded bytes hashed before the decode.** Predicted: failed by name within one
   hash, against two 10 s deadlines today.
3. **`metadata.json` damaged**, one digit each of a slope, a window centre, `bitsStored`, the photometric
   interpretation and a digest. Predicted: the digest's digit withholds the frame; every other paints a wrong picture
   with every mark green; with a digest over the metadata, the series refuses to open.
4. **A stale texture**: the painter's skipped upload forced for a new frame. Predicted: nothing catches it today.
5. **Frame *j* handed on as *i* after the check.** Predicted: nothing catches it today; the index check at paint does.
6. **Each label state of §5 reached and read**, in both views, each mutated. Predicted: rows 5 and 7 read as a
   failed check; row 8 shows the previous frame's picture.
7. **A sample flipped in shared memory after the check.** Predicted: painted, green.
8. **A re-ask after a coded-digest mismatch**: a flip in the server's buffer once, and a flip at the store.
   Predicted: the first mended by one re-ask, the second failing twice with the same computed digest.
9. **The read-back's cost**: a few pass-1 texels, blocking against fenced, once an upload, at 512² and 4096×3328,
   on SwiftShader. A phone's or a GPU's number is a device's, not the cloud's.
10. **The pair as second path**: the view's frame withheld, the exact frame fetched unasked, at G 1 and G 16.
11. Not the cloud's: a hardware AV1 decoder that differs by a sample (no host has one); Safari.

## 9 · For the owner, and what it would reopen

Each is a yes or a no; INTEGRITY-PAGE carries them.

1. The five states of §5, with *unavailable* apart from *check failed*, and no ✓ on *Optimal quality*.
2. A withheld frame clears the canvas (part of *block*, decided 2026-11-14, not built); no reveal.
3. No frame is stored without a digest.
4. A digest over the metadata (a change to the store's content).
5. The coded-bytes digest at the ingest, hashed on the client after a mismatch, and the server's re-check on a
   report (structural).
6. PR 368 as it stands covers states 1 and 8's words; state 8's picture is a finding against it.

**It would reopen**, each only if taken: amendment 22 by one case (a re-ask after a coded-digest mismatch, with 5);
"the exact HTJ2K frame on an explicit Lossless request" by one case (the exact frame fetched unasked for a withheld
view frame). Nothing here is built on either.

## 10 · Sources

Fetched 2026-11-22; each pinned by the first 12 hex digits of its sha256. Quoted above verbatim (PDFs through
`pdftotext`, so a line break may be joined).

* **AV1 Bitstream & Decoding Process Specification**, version 1.0.0 with Errata 1, last modified 2019-01-08, §7.2
  *General decoding process*: https://aomediacodec.github.io/av1-spec/av1-spec.pdf (`ec44e9fc42c4`).
* **Rec. ITU-T T.800 (06/2019) | ISO/IEC 15444-1**, §3.61, §3.82, §7.1:
  https://www.itu.int/rec/T-REC-T.800-201906-S (`9932e967462c`); no later edition was read.
* **Rec. ITU-T T.814 (06/2019) | ISO/IEC 15444-15:2019**, §6.2: https://www.itu.int/rec/T-REC-T.814-201906-I
  (`3480bb5f636d`).
* **OpenGL ES 3.0.6** (November 1, 2019), Appendix A *Invariance*: the Khronos registry's
  `specs/es/3.0/es_spec_3.0.pdf`, fetched from its repository,
  https://github.com/KhronosGroup/OpenGL-Registry (`7e831831595d`); registry.khronos.org answered 403.
* **WebGL 2.0 Specification**, Editor's Draft (undated), *The WebGL context*, *Buffer objects*,
  `getBufferSubData`: the registry's `specs/latest/2.0/index.html`, fetched from
  https://github.com/KhronosGroup/WebGL (`05da9e8c2110`).
* **WebCodecs**, W3C Working Draft, 19 November 2026, §7.9 *Hardware Acceleration*: https://www.w3.org/TR/webcodecs/
  (`dd7bbacd4b1e`).
* **Bairavasundaram et al., "An Analysis of Data Corruption in the Storage Stack"**, USENIX FAST 2008, §4.1: "Of the
  total sample of 1.53 million disks, 3855 disks developed checksum mismatches – 3088 of the 358, 000 nearline disks
  (0.86%) and 767 of the 1.17 million enterprise class disks (0.065%)."
  https://www.usenix.org/legacy/events/fast08/tech/full_papers/bairavasundaram/bairavasundaram.pdf (`9d20b444842f`).
* **Nightingale, Douceur, Orgovan, "Cycles, Cells and Platters"**, EuroSys 2011, Figure 2 (*Memory (DRAM one-bit
  flip)*, 30 days, *1 in 1700*) and §3: "A consequence of confining our analysis to kernel code pages is that we will
  miss DRAM failures in the vast majority of memory. On a typical machine kernel code pages occupy roughly 30 MB of
  memory, which is 1.5% of the memory on the average system in our study."
  https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/eurosys84-nightingale.pdf (`5c06312a0992`).
* **Schroeder, Pinheiro, Weber, "DRAM Errors in the Wild"**, SIGMETRICS 2009, abstract:
  https://www.cs.toronto.edu/~bianca/papers/sigmetrics09.pdf (`f66c2edcb704`).
* RFC 9001, Hochschild et al. and the other transport and processor sources are quoted in
  [`where-a-frame-can-be-corrupted.md`](where-a-frame-can-be-corrupted.md) and not repeated.

**Not read**, so not quoted: Rec. ITU-T T.803 | ISO/IEC 15444-4 (JPEG 2000 conformance; the download returned a login
page); any published memory or storage fault rate for phones (none found); DICOM PS3.14 on display calibration
(row 16 is outside the software and is not argued).

**Limits.** Sources and reasoning only. The rates are servers' and desktop PCs', from 2008 to 2011; none is a
phone's or a browser's, and the table says *unknown* wherever that is all there is. The code was read, not run: §5's
row 8 and §3's rows 11, 12 and 14 are predictions (§8, cells 4 to 7).
