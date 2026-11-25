# What the green mark proves, and what happens when a check fails

Written 2026-11-22 by row INTEGRITY-PAGE (`claude/work-ledger:docs/queue-2026-11-14.md`), a session that ran none
of the rows behind it, from pushed results only; nothing run but `git` reads. Inputs: the fault model
`claude/integrity-model:docs/client/evidence/integrity-model.md` (PR 429 at `aa0e6b909`, reviewed, fixed and
re-reviewed with no blocker open), PR 368 (`claude/oq-integrity-build` `a59aa4310`) with its body's *Choices left
open* and its review `docs/reviews/oq-integrity.md`, the status file I2-RUN, and on `origin/claude/unified`
`4a2b4277`: [`docs/adr/exactness-in-production.md`](../adr/exactness-in-production.md), [`docs/client/evidence/hidden-page-decode.md`](../client/evidence/hidden-page-decode.md),
[`lossless-after-a-failed-ask.md`](../client/evidence/lossless-after-a-failed-ask.md), [`docs/transport/link-profiles.md`](../transport/link-profiles.md), [`client/transport/downloader.js`](../../client/transport/downloader.js); PR 378's
controller at `claude/lossless-under-loss` `60635db78`. *The model* below means `integrity-model.md`.
Read again 2026-11-23 by row DECISION-PAGES-FIX under the owner's word of 2026-11-23 ~02:00 (the program, amendment
28: "for the next demo, we will accept hardware decoding and not checking. So the OQ badge or symbol that we will show
will be about the view, not the checking anymore"); `docs/decisions/README.md` §Review B1. Items 1, 3, 5 and 6
changed, 2, 4, 7 and 8 kept, each with its reason in §2; §7 names the reopen.

## 1 · The question

Every frame was checked, in production too (amendment 1): the decoded samples hashed with XXH3-64 and compared with
the digest the ingest wrote. The owner's word of 2026-11-23 ~02:00 reopens that for the view: a view frame decoded in
hardware is shown unchecked, because no browser hands such a frame back at full precision
([`claude/reviews-2026-11-28:docs/reviews/results-2026-11-22.md`](../reviews/results-2026-11-22.md) §3.1, **source**), and the optimal-quality mark
describes the view (lossy AV1, about N:1, [`visually-lossless.md`](visually-lossless.md)), not a check. The exact
HTJ2K frame stays checked, bit for bit. What is open is **what the check is allowed to claim on screen, what the
client does when it fails, and which further checks are worth their cost.** Each answer changes a label the reader
reads, a stored format, or a PR to merge, so each is the owner's.

## 2 · The recommendations, and the owner's yes or no

| # | call | recommended | a yes changes | a no leaves |
| ---: | --- | --- | --- | --- |
| 1 | the label's states (§3.1) | **yes: five states**, no ✓ on *Optimal quality*, *Lossless unavailable* split from *Lossless check failed*; state 1 describes the view, not a check (**changed** by the word: it read "checked as coded") | one client row: three wordings, one `demo-check.mjs` check per state, mutated | a ✓ that means integrity on one line and fidelity on the other; a fetch that never came read as a failed check |
| 2 | a withheld frame (§3.2) | **yes: it clears the canvas and stays withheld; no reveal** (kept: it applies to every frame whose check ran, the exact frame and a view frame decoded in software) | the *block* decision of 2026-11-14 built; the store keeps a refused frame out of later wants (a defect today) | the previous slice shown under the new index; a refused frame re-asked after every failure, without bound |
| 3 | no frame stored without a digest (§3.3) | **yes** (kept; its reason **changed**: the exact frame always has a check to run, and a view decoded in software too) | an ingest and receive-path rule; *unchecked* disappears from the exact series, not from a view decoded in hardware | an exact series that can show unchecked frames next to checked ones |
| 4 | a digest over `metadata.json` (§3.3) | **yes**, compared when a series opens (kept: the window and slope paint a hardware view too) | one hash a series; a change to the stored format (structural) | a damaged slope or window paints the right samples wrongly under a green label |
| 5 | the coded-bytes digest and the server's re-check (§3.4) | **yes to the design, built after the safety report's carrier is chosen** (REPORTS-PAGE); **provisional**; under the word it is also the one check a view frame decoded in hardware can have (§3.4) | a hash a frame at the ingest, hashed on the client only after a mismatch; the server re-checks a reported frame with one hash | a failure the client cannot place (bytes or decoder), and a server that can only record it |
| 6 | PR 368 (§3.5) | **yes, after one fix row on `claude/unified`**, scoped (**changed** by the word): the reconstruction digest on view frames decoded in software only, the label not claiming it; the clear canvas, no ✓, F1, the bounded re-decode; the coding error moved off the ingest's path | the reconstruction digest on the view's software-decoded frames, merged by a sync row after its review (amendment 28 rule 1) | the view's frames unchecked on every route, which the word now allows; the fill's +1.9–3.7 % and the first picture's +3.5–7.8 % saved (**measured**, I1) |
| 7 | one re-ask of a lost exact ask (B4, §3.6) | **yes: once is enough** for every outage a source publishes (kept: the exact frame, untouched by the word) | PR 378 as it stands | — |
| 8 | a replaced decoder's group (§3.6) | **yes: asked again once, from its keyframe**; a build row with its contract-rig case (kept: a lost decoder is a loss on any route) | the rest of a group no longer fails for a decoder that hung once | a hung decoder costs up to G − 1 frames, failed by name |

**How they serve the value statement** (amendment 27 item 7): "Every frame the reader asks to see exactly is the
original, bit for bit, and checked." Items 1–4 make that sentence true of what is on the screen and say exactly
where it stops: the samples handed to the painter, not the glass (§4.2 of the model). Items 5 and 8 keep the cost
of a failure to one frame's bytes; item 6 checks the view where its decoder hands back samples, and claims nothing
on screen for it. The sentence is about the exact frame, which the word leaves checked; a view decoded in hardware
is unchecked, a recorded disadvantage against DELIVERY-FIT-ARM, the HTJ2K-only control of phase 2 (amendment 28),
whose every frame is exact and checked ([`delivery-per-link.md`](delivery-per-link.md) §3).

## 3 · The options, one call at a time

Each call's options, its numbers and their sources are in [§3 in full](#appendix-3-in-full), after §8 (moved there
2026-11-25 by PAGES-PASS, nothing changed). In short:

| § | call | options | recommended |
| --- | --- | --- | --- |
| [3.1](#31-the-labels-states) | the label's states | (a) five states; (b) today's words, with a ✓ on *Optimal quality* (PR 368); (c) (a) with a ✓ kept on the view | **(a)**; the words are the owner's, the states are not |
| [3.2](#32-a-withheld-frame) | a withheld frame | (a) clear the canvas, keep the frame out of later wants, no reveal; (b) paint it under a red mark; (c) (a) with the exact frame fetched unasked | **(a)**; (c) named in §7, not recommended now |
| [3.3](#33-two-cheap-rules-every-frame-with-a-digest-and-the-metadata-hashed) | every frame with a digest; the metadata hashed | no frame without a digest; a digest over `metadata.json` | **yes** to both (items 3 and 4) |
| [3.4](#34-the-coded-bytes-digest) | the coded-bytes digest | hashed only after a sample mismatch; before every decode; none | **after a mismatch** (**provisional**) |
| [3.5](#35-pr-368-the-views-reconstruction-digest) | PR 368 | its eight open choices; (d) no view check on any route | **yes**, through one fix row on `claude/unified`; (d) the owner's call, not recommended |
| [3.6](#36-re-asks-a-lost-exact-ask-and-a-replaced-decoders-group) | re-asks | one re-ask of a lost ask; a replaced decoder's group (a) as today, (b) asked again once from its keyframe | **once is enough**; **(b)** |

## 4 · Where it holds

**Each limitation, and what found it** (2026-11-25, PAGES-PASS):

* Fixtures: the measured numbers come from the 18 demo series and three DBT volumes of one dataset (`dbts_a1`,
  `dbts_b1`, `dbts_c1`). Found by the rows' own fixture lines (I1 in §3.5, I2-RUN); INTEGRITY-MODEL's own are four HTJ2K series and
  three DBT volumes.
* 4-core x86 cloud hosts without a GPU, headless Chromium (and Firefox for the ADR's cells), SwiftShader for the
  paint, loopback or a userspace relay, never a radio. Found by the same lines and the [ADR](../adr/exactness-in-production.md)'s cells.
* No phone, no hardware decoder, no WebKit, no breast ultrasound cine in any cell. Found by INTEGRITY-PAGE's status
  file ("no phone, no hardware decoder, no US cine") and INTEGRITY-MODEL's.
* Rates of memory and storage faults are from published studies of servers, disks and consumer PCs (2008–2011); for
  phones **unknown**, published nowhere. Found by the model's §10 sources (INTEGRITY-MODEL: "a phone's is unknown").
* A hardware-decoded view frame is shown unchecked: no browser hands it back at full precision. Found by
  [`results-2026-11-22.md`](../reviews/results-2026-11-22.md) §3.1 (**source**), read under the owner's word (§Review B1).
* The page cannot know which decoder ran: `prefer-hardware` is a hint the agent may ignore. Found by WebCodecs §7.9
  (**source**).
* The check ends at the samples handed to the painter, not the glass; the held frame, the texture, the window
  table's parameters, the index and the label are behind it. Found by the model's §4.2 and §5 (theory, not run).
* Three untrue label states and a withheld frame that keeps the previous picture, re-asked without bound (§3.1,
  §3.2). Found by the model's §5 and §6: read in code, not run, and a scratch run of `FrameStore`.
* The reconstruction digest's ingest cost alone is **not measured** (I2-RUN timed it with the coding error). Found
  by I2-RUN's cost cell, which measured the two together.
* The metadata digest and the coded-bytes digest are **theory**, not built; the coded-bytes digest's cost on a view
  frame not measured. Found by the model's §3 row 5 and §4.1; the view case by DECISION-PAGES-FIX (§Review B1).
* Item 5 is **provisional**: REPORTS-PAGE was not written when this page was. Found by this page's date (INTEGRITY-PAGE).
* PR 368's base is the old demo tip and GitHub reports it unmergeable. Found by GitHub's merge state, as §3.5 says.
* The 4:0:0 view failed at flush on the round's phone, at 256 × 256 only. Found by the phone round's measurement,
  [`phone-decode-route.md`](phone-decode-route.md) §3 4.7.
* No source gives an outage distribution in seconds on a real wireless link. Found by [`link-profiles.md`](../transport/link-profiles.md) §1's survey (LINK-TARGETS).
* The phone's 30 s with no UDP is one load, its cause not shown; the 45 s blackout rig ran three rounds. Found by
  [`lossless-after-a-failed-ask.md`](../client/evidence/lossless-after-a-failed-ask.md) (its server logs and its rig).
* The fault bench's cells (2, 3, 5, 6, 12 among them) are not run; item 5's "before every decode" waits on cell 2.
  Found by the model's §8, which lists them as predictions for the next queue.

Carried by **theory**, untested: to **US clips** the check carries unchanged: it hashes samples whatever their depth
or colour, and a clip is cine-like, so the view's reconstruction digest applies; their frames are small (often under
1 Mpx), so the check costs about what 512² costs, 0.15 ms (**measured**, x86). To **DBT stacks** the numbers above
apply directly. To **phones**: the check's share is 1–10 % of a decode (**theory**, the model's §4.3); a phone's
memory fault rate, which decides whether a held frame is worth hashing again, is published nowhere. To **hardware
AV1 decoders**: the AV1 spec requires identical output without film grain (**source**, §7.2), so the digest stays
well defined, but no browser hands the decoded frame back at full precision ([results](../reviews/results-2026-11-22.md) §3.1, **source**), so under the
word it is shown unchecked; WebCodecs' `prefer-hardware` is a hint the agent may ignore (**source**, §7.9), so the
page cannot know which decoder ran, and a frame the agent decoded in hardware without being asked is unchecked too. Faults cluster in place and time (FAST'08, EuroSys'11, SIGMETRICS'09, **source**): a failure is
evidence about a device or a store, which is why the safety report and item 5 matter.

**Where the link, not the decode, binds** (2026-11-25, PAGES-PASS). The check binds on no link: it runs after the
decoder, on the client, whatever the wire (**theory**, §5). The link enters this page twice. Item 7: a lost exact ask
is a link's outage, and every published one is inside the downloader's own resume (**source**, `link-profiles.md`
§1; §3.6). And §6's DELIVERY-FIT-ARM, which asks whether a view is needed at all: by
[`delivery-per-link.md`](delivery-per-link.md) §4 (**derived**), the link binds B on every link below its class's
*G*★, A on LTE, a far stream, LOSS-like links and public Wi-Fi below ~83 Mbit/s for `dbts_b1` on the round's phone,
and C1's exact frame on every link; the decode binds A on clean links above that crossover. That the wire binds on
the links we target is untested (README §Premises item 1): on the one phone measured, the exact series filled faster
than the view in 15 of 15 rounds, median 0.705 (**measured**, [`phone-decode-route.md`](phone-decode-route.md) §4).
No transport row is lowered by the decode-bound phone.

## 5 · The mechanism

The check stands between the decoder and the hold. Everything in front of it (store, server, wire, receive code,
decoder) it catches; everything behind it (the held frame, the texture, the window table's parameters, the index,
the label) it cannot. Items 1–4 close what is behind it at no run-time cost: the metadata by its own digest, the
index and the label by invariants and a test per state, the withheld frame by clearing the canvas. Item 5 does not
widen detection; it splits the front half in two so the repair can be chosen. A hardware decoder hands the browser
an image, not samples, so for a hardware view there is nothing behind the decoder to hash: the check stands in front
of the exact frame and a software view only.

## 6 · What would change the recommendation

* **Item 5's form**: the fault bench's cell 2 (a hang and a truncation with the bytes hashed first) showing a
  deadline too slow for a reader.
* **Item 6's ingest cost**: the reconstruction digest alone over 10 % of the ingest's time; then off the path too.
* **A pass-1 read-back of the paint** (not recommended now): its cost on a phone's GPU (cell 9 on a device), after
  the paint's own GPU proof.
* **Hashing a held frame again on dwell** (not now): a phone memory fault rate, which the safety report's counts
  would give.
* **Item 7**: an outage distribution on a real wireless link with silences past ~57 s.
* **Items 1 and 6 under the word**: a browser shipping plane access to a hardware frame (WebCodecs `P010`, results
  §3.1) makes a hardware view checkable again; then the owner's word is asked again, and item 6 covers every route.
* **DELIVERY-FIT-ARM** filling as fast as the view on wire-bound links: then no view is needed, unchecked or not
  ([`delivery-per-link.md`](delivery-per-link.md) §6).

The model's §8 lists twelve fault-bench cells for the next queue; cells 3, 5, 6 and 12 test items 4, 1, 1 and 2.

## 7 · What it would reopen

**Amendment 1's "every frame checked, in production too", for the view.** The owner's word of 2026-11-23 ~02:00
reopened it: a view frame decoded in hardware is shown unchecked, the mark describes the view, the exact HTJ2K frame
stays checked bit for bit. This page reads items 1, 3, 5 and 6 under it and reopens nothing further: XXH3 stays the
frame check wherever a check runs. Taken, two options would reopen more: the exact frame fetched unasked for a
withheld view frame (§3.2 (c)) reopens "the exact HTJ2K frame on an explicit Lossless request" by one case; one
re-ask after a coded-digest mismatch (with item 5) widens amendment 22 by one case. Neither is recommended now.

## 8 · Rows and links

INTEGRITY-MODEL (Fable), -REVIEW, -FIX, -FIX-REVIEW: PR 429, `claude/integrity-model`. OQ-INTEGRITY-FIXES and its
review, I2-RUN: PR 368, `claude/oq-integrity-build:docs/reviews/oq-integrity.md` and `claude/oq-integrity-build:lab/oq-integrity/rows/`.
PHONE-FIX-378, FIX-378-DIAL and their reviews: PR 378, `claude/lossless-under-loss`. HIDDEN-PAGE-DECODE: PRs 376,
377. On `claude/unified`: [`docs/adr/exactness-in-production.md`](../adr/exactness-in-production.md), [`docs/client/evidence/where-a-frame-can-be-corrupted.md`](../client/evidence/where-a-frame-can-be-corrupted.md),
[`optimal-quality-reconstruction-digest.md`](../client/evidence/optimal-quality-reconstruction-digest.md), [`lossless-after-a-failed-ask.md`](../client/evidence/lossless-after-a-failed-ask.md), [`hidden-page-decode.md`](../client/evidence/hidden-page-decode.md),
[`docs/transport/link-profiles.md`](../transport/link-profiles.md).

**Rows this page asks for in phase 2** (for PHASE2-PLAN): LABEL-STATES (item 1) and WITHHELD-FRAME (item 2, with the
store's re-ask defect, the model's cell 12 as its test), one review for both; INGEST-DIGEST-RULES (items 3 and 4,
structural: a draft PR); OQ-INTEGRITY-ONTO-UNIFIED (item 6's fix row) and its review, then the reconstruction
digest's ingest cost alone (cloud, amendment 28 rule 2); GROUP-REASK (item 8) and its review; item 5 after
REPORTS-PAGE. Fault-bench cells 2, 3, 5, 6, 12 as cloud rows.

## Appendix: §3 in full

Moved here from §3 on 2026-11-25 (PAGES-PASS, §Review m13); nine lines differ from §3 as it stood: eight citations
made links and one source added ([`lossless-after-a-failed-ask.md`](../client/evidence/lossless-after-a-failed-ask.md)),
each checked right (README §Pass review m5).

### 3.1 The label's states

The model reads ten situations in code (its §5) and finds three untrue: *Lossless check failed* shown when the
exact frame **never came** (no check ran), when the exact series **has no digest** (no check exists), and the view's
failed frame showing **the previous frame's picture**. Its smallest true set:

| state | words | when |
| --- | --- | --- |
| 1 | *Optimal quality* (lossy AV1, its ratio: the words are [`visually-lossless.md`](visually-lossless.md)'s) | the view's frame; checked as coded where it was decoded in software and a digest exists, unchecked when decoded in hardware; the mark says neither |
| 2 | *Optimal quality · fetching lossless…* | the exact frame asked |
| 3 | *✓ Lossless* | the exact frame's digest matched, painted |
| 4 | *Lossless unavailable · optimal quality shown* / *Lossless check failed · optimal quality shown* | the exact frame did not come or cannot be checked / it came and failed twice |
| 5 | *Withheld* | a frame failed its check twice: a placeholder naming the check, no pixels |

Options: (a) these five; (b) today's words, with a ✓ on *Optimal quality* (PR 368); (c) (a) with a ✓ kept on the
view. A ✓ on a check every frame passes unless withheld carries no information (**theory**), and next to *✓ Lossless*
it reads as fidelity; under the word it would also claim a check that a hardware-decoded view never ran. A mark that
says which decoder ran (software, checked; hardware, unchecked) is not offered: `prefer-hardware` is a hint the agent
may ignore (**source**, WebCodecs §7.9), so the page cannot know. **Recommended (a).** The words are the owner's; the
states are not.

### 3.2 A withheld frame

Today on `claude/unified` a refused frame emits nothing, so the canvas keeps the previous frame's picture **and**
its label (`controller.js:141–149`, read, not run); on PR 368 the label is right, the picture still the previous
slice's. And the store re-asks it: `store.failed(i)` drops it from the owed list, the next want sends it again, once
per failure, without bound (`store.js:61–69, 85`; a scratch run of `FrameStore` in the model's §6). That contradicts
amendment 22 ("never a refusal by the server … nor a failed check") and is a defect whichever way the rest goes.

Options: (a) clear the canvas, keep the frame out of later wants, no reveal; (b) paint it under a red mark, as an
exact frame with `exact: false` is painted today; (c) (a) with the exact frame fetched unasked for a withheld view
frame (the pair as its own second path, **new, not built**). A withheld frame's pixels are wrong by an unknown amount
and plausible. **Recommended (a)**; (c) widens "the exact frame on an explicit request" by one case, so it is named
in §7, not recommended now. The cost of a deterministic fault under today's re-ask: a fetch and up to two decodes
(×2.8–3.0 of a decode for AV1, **measured**, [ADR](../adr/exactness-in-production.md) §9) every step, for the session.

### 3.3 Two cheap rules: every frame with a digest, and the metadata hashed

* **No frame without a digest.** The lab ingest already refuses a frame that does not decode back to the samples its
  checksum was written from ([`ingest/coded-frames/ingest.py`](../../ingest/coded-frames/ingest.py)). For bytes the PCS codes itself, the receiver's own
  decode gives the digest: it then proves the frame unchanged since receipt, not that the PCS coded it rightly. Cost
  at run time: none. It removes *unchecked* from the exact series instead of wording it; a view frame decoded in
  hardware stays unchecked whatever the store holds (§1).
* **A digest over `metadata.json`.** The window table, the slope and the depth cut's shift come from it. A damaged
  digest's digit withholds a good frame (safe); a damaged slope or window centre paints right samples wrongly under
  every green mark (the model's §3, row 5). One hash of a few kilobytes a series (**theory**, not built). The store's
  rate of damage at rest: 0.86 % of nearline and 0.065 % of enterprise disks developed a checksum mismatch in
  41 months (**source**, FAST'08, quoted in the model's §10).

### 3.4 The coded-bytes digest

It detects nothing today's check misses (the model's §4.1: AV1 without film grain and lossless HTJ2K each have one
right output, so the sample digest is sufficient and is the only check after the decoder). What it buys is
**location**: bytes or decoder. That decides the repair (one re-ask mends bytes wrong on arrival with a clean store,
never a decoder or a store), lets the server re-check a reported frame with one hash and no decoder, and makes a
safety report actionable (restore a bundle, or turn a route off on an engine).

| form | cost | gives |
| --- | --- | --- |
| hashed only after a sample mismatch | nothing on the common path; one hash a frame at the ingest, 16 hex digits in the metadata | location, the server's re-check, the report's cause |
| hashed before every decode | under the frame check's 4.0–4.7 ms on the largest frame (**derived** from **measured**, [ADR](../adr/exactness-in-production.md) §10) | the above, and the decoder never sees damaged bytes |
| none | — | today |

**Recommended: after a mismatch**, built once the report's carrier is chosen (REPORTS-PAGE, not written:
**provisional**). Before every decode waits for the fault bench's cell 2: a deadline already bounds a hang.

Under the word, a view frame decoded in hardware has no sample digest to compare, so hashing its coded bytes before
the decoder is the only check it can have: it proves the bytes arrived as stored, not that the decoder painted them
rightly (**theory**, not built, its cost on a view frame not measured). Named for the hardware view's row, not
recommended now: the owner's word accepts that view unchecked.

### 3.5 PR 368: the view's reconstruction digest

**Measured** (I1, 18 demo series, three DBT volumes, one 4-core host, SwiftShader): every frame as coded on both
routes; the mutants refused or mended; the fill +3.7 % at 1×, +1.9 % at 4×; the first picture +7.8 % at 1×, +3.5 % at
4×. **Measured** (I2-RUN, 12 cells, three volumes): writing the digest *and* the coding error at the ingest costs
+48 to +60 % of its time, against a bar of 10 %; the noise-band ratio differs from the study's by +27 to +122 %, the
whole difference the study's in-window mask. Its open choices, each with a recommendation:

| PR 368's choice | built | recommended |
| --- | --- | --- |
| 1 a frame without a digest | *Optimal quality*, no mark | moot under §3.3; until then as built |
| 2 a frame not as coded | blocked, the canvas keeps the last frame | blocked **and the canvas cleared** (§3.2) |
| 3 group re-decode on dav1d only | yes | keep; a phone with a hardware decoder shows whether a dav1d-first frame needs a second route |
| 4 the noise-band ratio's mask | whole frame | the study's in-window mask (the ingest's formula with it matches within 0.6–1.3 %, **measured**) |
| 5 repeated re-decodes, up to O(G²) | not bounded | bounded: one re-decode a group |
| I2's cost | both on the ingest's path | the digest on the path, the coding error off it |
| the ✓ on *Optimal quality* | shown | dropped (§3.1) |
| F1, a window drag on a refused frame throws | open (minor) | fixed with a drag step in the check |

**Recommended: yes**, through one fix row on a branch from `claude/unified` (PR 368's base is the old demo tip and
GitHub reports it unmergeable), then its review, then a sync row's merge. The reconstruction digest's ingest cost
alone is **not measured**: that is the cell that confirms "on the path".

**Read again under the word.** The digest now covers the view only where it is decoded in software (dav1d, or
WebCodecs without hardware: every cloud cell and the round's phone, which decoded the view in software,
[`phone-decode-route.md`](phone-decode-route.md) §4); a hardware route skips it. Kept because there it costs the
measured +1.9–3.7 % of the fill and turns a damaged view frame into a withheld one instead of a plausible wrong
picture; the label claims none of it (item 1). The other option the word opens: (d) no view check on any route,
PR 368's view half not ported. It saves that cost and gives up detection on the routes that can check; it is the
owner's call, not recommended. A hardware view needs a 4:2:0 form of the stream (+0.20–0.23 % bytes against 4:0:0,
**source**; 4:0:0 failed at flush on the round's phone, **measured**, 256 × 256 only;
[`phone-decode-route.md`](phone-decode-route.md) §3 4.7).

### 3.6 Re-asks: a lost exact ask, and a replaced decoder's group

**One re-ask of a lost ask (B4).** PR 378 asks a lost exact ask again once, 1 s later (`EXACT_RETRY_MS`), and
counts an ask whose own re-dial failed as lost (FIX-378-DIAL, reviewed, no blocker). Before an ask is declared lost
the downloader has already waited: a 3 s stall watch (doubling) or the frame's 15 s waiter, then up to five dials of
at most 5 s, 1 s apart ([`downloader.js`](../../client/transport/downloader.js) `deadlines`); in the 45 s blackout rig the ask failed 28.2 s after the press
(**measured**, three rounds, [`lossless-after-a-failed-ask.md`](../client/evidence/lossless-after-a-failed-ask.md)). So one ask and its re-ask ride out a silence of roughly 57 s (**derived**: 28 + 1 + 28).
Against the published outages (**source**, [`link-profiles.md`](../transport/link-profiles.md) §1): LTE handover interruptions 24–29 ms on average,
sometimes over 100 ms, about 40 ms median; 5G mmWave 30+ handoffs in 8 minutes walking, modelled as a drop to
167 Mbit/s for 2 s, not a silence; the 5G target 0 ms. Every one is two orders of magnitude inside the downloader's
own resume, before the re-ask is reached. The one long silence on record is the phone's 30 s with no UDP
(**measured**, one load, cause not shown, [`lossless-after-a-failed-ask.md`](../client/evidence/lossless-after-a-failed-ask.md)), inside the 57 s. **Recommended: once is enough.** No source gives an
outage distribution in seconds on a real wireless link; that is what would change it.

**A replaced decoder's group.** A decoder silent through one deadline of running time is replaced; the frozen-page
fix (late deadlines given again, on `claude/unified`) removed the case that met the phone. For a real hang, the new
decoder holds no group state, so every later frame of the group fails by name and is not asked again
([`hidden-page-decode.md`](../client/evidence/hidden-page-decode.md) §3, pinned by the contract rig). Options: (a) as today, up to G − 1 frames lost (7 or 15 at
G 8 or 16); (b) the group asked again once from its keyframe on the new decoder, each frame checked again. A frame
lost with its decoder is a loss, not a refusal or a failed check, so (b) is inside amendment 22. A decoder that hangs
again on the same bytes fails the group by name the second time. **Recommended (b)**, a build row; it changes what
the contract rig pins, which is why it is the owner's.
