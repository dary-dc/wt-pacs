# What the green mark proves, and what happens when a check fails

Written 2026-11-22 by row INTEGRITY-PAGE (`claude/work-ledger:docs/queue-2026-11-14.md`), a session that ran none
of the rows behind it, from pushed results only; nothing run but `git` reads. Inputs: the fault model
`claude/integrity-model:docs/client/evidence/integrity-model.md` (PR 429 at `aa0e6b909`, reviewed, fixed and
re-reviewed with no blocker open), PR 368 (`claude/oq-integrity-build` `a59aa4310`) with its body's *Choices left
open* and its review `docs/reviews/oq-integrity.md`, the status file I2-RUN, and on `origin/claude/unified`
`4a2b4277`: `docs/adr/exactness-in-production.md`, `docs/client/evidence/hidden-page-decode.md`,
`lossless-after-a-failed-ask.md`, `docs/transport/link-profiles.md`, `client/transport/downloader.js`; PR 378's
controller at `claude/lossless-under-loss` `60635db78`. *The model* below means `integrity-model.md`.

## 1 · The question

Every frame is checked, in production too (amendment 1, decided): the decoded samples are hashed with XXH3-64 and
compared with the digest the ingest wrote. What is open is **what that check is allowed to claim on screen, what the
client does when it fails, and which further checks are worth their cost.** Each answer changes a label the reader
reads, a stored format, or a PR to merge, so each is the owner's.

## 2 · The recommendations, and the owner's yes or no

| # | call | recommended | a yes changes | a no leaves |
| ---: | --- | --- | --- | --- |
| 1 | the label's states (§3.1) | **yes: five states**, no ✓ on *Optimal quality*, *Lossless unavailable* split from *Lossless check failed* | one client row: three wordings, one `demo-check.mjs` check per state, mutated | a ✓ that means integrity on one line and fidelity on the other; a fetch that never came read as a failed check |
| 2 | a withheld frame (§3.2) | **yes: it clears the canvas and stays withheld; no reveal** | the *block* decision of 2026-11-14 built; the store keeps a refused frame out of later wants (a defect today) | the previous slice shown under the new index; a refused frame re-asked after every failure, without bound |
| 3 | no frame stored without a digest (§3.3) | **yes** | an ingest and receive-path rule; the *unchecked* state disappears | a series that can show unchecked frames next to checked ones |
| 4 | a digest over `metadata.json` (§3.3) | **yes**, compared when a series opens | one hash a series; a change to the stored format (structural) | a damaged slope or window paints the right samples wrongly under a green label |
| 5 | the coded-bytes digest and the server's re-check (§3.4) | **yes to the design, built after the safety report's carrier is chosen** (REPORTS-PAGE); **provisional** | a hash a frame at the ingest, hashed on the client only after a mismatch; the server re-checks a reported frame with one hash | a failure the client cannot place (bytes or decoder), and a server that can only record it |
| 6 | PR 368 (§3.5) | **yes, after one fix row on `claude/unified`**: the clear canvas, no ✓, F1, the bounded re-decode; the coding error moved off the ingest's path | the reconstruction digest on the view's frames, merged by a sync row after its review (amendment 28 rule 1) | the view's frames unchecked, against amendment 1 |
| 7 | one re-ask of a lost exact ask (B4, §3.6) | **yes: once is enough** for every outage a source publishes | PR 378 as it stands | — |
| 8 | a replaced decoder's group (§3.6) | **yes: asked again once, from its keyframe**; a build row with its contract-rig case | the rest of a group no longer fails for a decoder that hung once | a hung decoder costs up to G − 1 frames, failed by name |

**How they serve the value statement** (amendment 27 item 7): "Every frame the reader asks to see exactly is the
original, bit for bit, and checked." Items 1–4 make that sentence true of what is on the screen and say exactly
where it stops: the samples handed to the painter, not the glass (§4.2 of the model). Items 5 and 8 keep the cost
of a failure to one frame's bytes; item 6 extends "checked" to the view.

## 3 · The options, one call at a time

### 3.1 The label's states

The model reads ten situations in code (its §5) and finds three untrue: *Lossless check failed* shown when the
exact frame **never came** (no check ran), when the exact series **has no digest** (no check exists), and the view's
failed frame showing **the previous frame's picture**. Its smallest true set:

| state | words | when |
| --- | --- | --- |
| 1 | *Optimal quality* | the view's frame, checked as coded wherever a digest exists |
| 2 | *Optimal quality · fetching lossless…* | the exact frame asked |
| 3 | *✓ Lossless* | the exact frame's digest matched, painted |
| 4 | *Lossless unavailable · optimal quality shown* / *Lossless check failed · optimal quality shown* | the exact frame did not come or cannot be checked / it came and failed twice |
| 5 | *Withheld* | a frame failed its check twice: a placeholder naming the check, no pixels |

Options: (a) these five; (b) today's words, with a ✓ on *Optimal quality* (PR 368); (c) (a) with a ✓ kept on the
view. A ✓ on a check every frame passes unless withheld carries no information (**theory**), and next to *✓ Lossless*
it reads as fidelity. **Recommended (a).** The words are the owner's; the states are not.

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
(×2.8–3.0 of a decode for AV1, **measured**, ADR §9) every step, for the session.

### 3.3 Two cheap rules: every frame with a digest, and the metadata hashed

* **No frame without a digest.** The lab ingest already refuses a frame that does not decode back to the samples its
  checksum was written from (`ingest/coded-frames/ingest.py`). For bytes the PCS codes itself, the receiver's own
  decode gives the digest: it then proves the frame unchanged since receipt, not that the PCS coded it rightly. Cost
  at run time: none. It removes *unchecked* instead of wording it.
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
| hashed before every decode | under the frame check's 4.0–4.7 ms on the largest frame (**derived** from **measured**, ADR §10) | the above, and the decoder never sees damaged bytes |
| none | — | today |

**Recommended: after a mismatch**, built once the report's carrier is chosen (REPORTS-PAGE, not written:
**provisional**). Before every decode waits for the fault bench's cell 2: a deadline already bounds a hang.

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

### 3.6 Re-asks: a lost exact ask, and a replaced decoder's group

**One re-ask of a lost ask (B4).** PR 378 asks a lost exact ask again once, 1 s later (`EXACT_RETRY_MS`), and
counts an ask whose own re-dial failed as lost (FIX-378-DIAL, reviewed, no blocker). Before an ask is declared lost
the downloader has already waited: a 3 s stall watch (doubling) or the frame's 15 s waiter, then up to five dials of
at most 5 s, 1 s apart (`downloader.js` `deadlines`); in the 45 s blackout rig the ask failed 28.2 s after the press
(**measured**, three rounds). So one ask and its re-ask ride out a silence of roughly 57 s (**derived**: 28 + 1 + 28).
Against the published outages (**source**, `link-profiles.md` §2): LTE handover interruptions 24–29 ms on average,
sometimes over 100 ms, about 40 ms median; 5G mmWave 30+ handoffs in 8 minutes walking, modelled as a drop to
167 Mbit/s for 2 s, not a silence; the 5G target 0 ms. Every one is two orders of magnitude inside the downloader's
own resume, before the re-ask is reached. The one long silence on record is the phone's 30 s with no UDP
(**measured**, one load, cause not shown), inside the 57 s. **Recommended: once is enough.** No source gives an
outage distribution in seconds on a real wireless link; that is what would change it.

**A replaced decoder's group.** A decoder silent through one deadline of running time is replaced; the frozen-page
fix (late deadlines given again, on `claude/unified`) removed the case that met the phone. For a real hang, the new
decoder holds no group state, so every later frame of the group fails by name and is not asked again
(`hidden-page-decode.md` §3, pinned by the contract rig). Options: (a) as today, up to G − 1 frames lost (7 or 15 at
G 8 or 16); (b) the group asked again once from its keyframe on the new decoder, each frame checked again. A frame
lost with its decoder is a loss, not a refusal or a failed check, so (b) is inside amendment 22. A decoder that hangs
again on the same bytes fails the group by name the second time. **Recommended (b)**, a build row; it changes what
the contract rig pins, which is why it is the owner's.

## 4 · Where it holds

Fixtures: the measured numbers come from the 18 demo series and three DBT volumes of one dataset (`dbts_a1`,
`dbts_b1`, `dbts_c1`), 4-core x86 cloud hosts without a GPU, headless Chromium (and Firefox for the ADR's cells),
SwiftShader for the paint, loopback or a userspace relay, never a radio. No phone, no hardware decoder, no WebKit,
no breast ultrasound cine in any cell. Rates of memory and storage faults are from published studies of servers,
disks and consumer PCs; for phones **unknown**.

Carried by **theory**, untested: to **US clips** the check carries unchanged: it hashes samples whatever their depth
or colour, and a clip is cine-like, so the view's reconstruction digest applies; their frames are small (often under
1 Mpx), so the check costs about what 512² costs, 0.15 ms (**measured**, x86). To **DBT stacks** the numbers above
apply directly. To **phones**: the check's share is 1–10 % of a decode (**theory**, the model's §4.3); a phone's
memory fault rate, which decides whether a held frame is worth hashing again, is published nowhere. To **hardware
AV1 decoders**: the AV1 spec requires identical output without film grain (**source**, §7.2), so the digest stays
well defined; WebCodecs' `prefer-hardware` is a hint the agent may ignore (**source**, §7.9), so the page cannot know
which decoder ran. Faults cluster in place and time (FAST'08, EuroSys'11, SIGMETRICS'09, **source**): a failure is
evidence about a device or a store, which is why the safety report and item 5 matter.

## 5 · The mechanism

The check stands between the decoder and the hold. Everything in front of it (store, server, wire, receive code,
decoder) it catches; everything behind it (the held frame, the texture, the window table's parameters, the index,
the label) it cannot. Items 1–4 close what is behind it at no run-time cost: the metadata by its own digest, the
index and the label by invariants and a test per state, the withheld frame by clearing the canvas. Item 5 does not
widen detection; it splits the front half in two so the repair can be chosen.

## 6 · What would change the recommendation

* **Item 5's form**: the fault bench's cell 2 (a hang and a truncation with the bytes hashed first) showing a
  deadline too slow for a reader.
* **Item 6's ingest cost**: the reconstruction digest alone over 10 % of the ingest's time; then off the path too.
* **A pass-1 read-back of the paint** (not recommended now): its cost on a phone's GPU (cell 9 on a device), after
  the paint's own GPU proof.
* **Hashing a held frame again on dwell** (not now): a phone memory fault rate, which the safety report's counts
  would give.
* **Item 7**: an outage distribution on a real wireless link with silences past ~57 s.

The model's §8 lists twelve fault-bench cells for the next queue; cells 3, 5, 6 and 12 test items 4, 1, 1 and 2.

## 7 · What it would reopen

Nothing, as recommended. Taken, two options would: the exact frame fetched unasked for a withheld view frame
(§3.2 (c)) reopens "the exact HTJ2K frame on an explicit Lossless request" by one case; one re-ask after a
coded-digest mismatch (with item 5) widens amendment 22 by one case. Neither is recommended now.

## 8 · Rows and links

INTEGRITY-MODEL (Fable), -REVIEW, -FIX, -FIX-REVIEW: PR 429, `claude/integrity-model`. OQ-INTEGRITY-FIXES and its
review, I2-RUN: PR 368, `claude/oq-integrity-build` (`docs/reviews/oq-integrity.md`, `lab/oq-integrity/rows/`).
PHONE-FIX-378, FIX-378-DIAL and their reviews: PR 378, `claude/lossless-under-loss`. HIDDEN-PAGE-DECODE: PRs 376,
377. On `claude/unified`: `docs/adr/exactness-in-production.md`, `docs/client/evidence/where-a-frame-can-be-corrupted.md`,
`optimal-quality-reconstruction-digest.md`, `lossless-after-a-failed-ask.md`, `hidden-page-decode.md`,
`docs/transport/link-profiles.md`.

**Rows this page asks for in phase 2** (for PHASE2-PLAN): LABEL-STATES (item 1) and WITHHELD-FRAME (item 2, with the
store's re-ask defect, the model's cell 12 as its test), one review for both; INGEST-DIGEST-RULES (items 3 and 4,
structural: a draft PR); OQ-INTEGRITY-ONTO-UNIFIED (item 6's fix row) and its review, then the reconstruction
digest's ingest cost alone (cloud, amendment 28 rule 2); GROUP-REASK (item 8) and its review; item 5 after
REPORTS-PAGE. Fault-bench cells 2, 3, 5, 6, 12 as cloud rows.
