# Engines: which client results hold in Firefox and Safari

Written 2026-11-22 by row ENGINES-PAGE (`claude/work-ledger:docs/queue-2026-11-14.md`), a session that ran none of
the engines' rows, from pushed results only; nothing run. Inputs at: `claude/engines` `222817b1`
(`docs/decode/engines.md`, its matrix, §Measured and §Only on a device; the raw rows in `docs/decode/engines-smoke/`;
PR 410's body §ENGINE-REVIEW, §ENGINE-REVIEW-FIX, §Re-review), and on `origin/claude/unified` `4a2b4277`
`docs/client/design.md` §Open (contradiction 6) and `docs/client/evidence/frame-memory-ownership.md` (*Firefox, run
again*; *M5 under the amended bar*). "Row n" is a row of `engines.md`'s matrix; "cell n" a row of its §Measured.

## 1 · The question

The client was built and measured on Chromium. Which of the twelve results it stands on (the decode route, the
exact frame, the check, shared memory, nested workers, the transport, paint in a worker, the view worker, the cache's
stores, the reports' carriers, `getStats()`) also hold in Firefox and in Safari on macOS and iOS, and how each is
known: the engine's own source, a cloud run, or only a device. Three calls are the owner's: what the client promises
per engine, whether a coded form that Firefox's decoder mishandles may ever reach it, and contradiction 6 of
`design.md` §Open (the ring's Firefox result ran on Firefox 155.0, not the 159.0 its bar was set on).

## 2 · The recommendation, and the owner's yes or no

**State the client as measured on Chromium and Firefox desktop (Firefox's view through dav1d), unknown on Safari;
keep any 4:2:0 view form away from Firefox's `VideoDecoder` until its G = 8 failure is traced; close contradiction 6
by one Firefox 160 run of the ring's amended bar; queue the Safari probe page first when a Mac or iPhone session
exists.**

| # | the owner's yes or no | recommended | a yes changes | a no leaves |
| ---: | --- | --- | --- | --- |
| 1 | The client's engine statement reads: Chromium and Firefox desktop measured for every row (Firefox's AV1 view decoded by dav1d, row 2), Safari macOS and iOS not measured, three Safari rows conditional on the device or OS (§4) | **yes** | one paragraph in `docs/client/design.md` §Decided and `README.md`, pointing at `engines.md` | `design.md` §Open's *Elsewhere* line ("Firefox and WebKit") stays open |
| 2 | Until it is traced, no 4:2:0 view form (GREY420, `docs/av1/payload-format.md` §8-bit grey as 4:2:0) is decoded by Firefox's `VideoDecoder`: the client routes it to dav1d there | **yes** | one engine condition beside the per-layout probe (a build row, its test first) if GREY420 is ever adopted; today nothing, since GREY420 is built and not adopted | a 4:2:0 view on Firefox passes its probe and then fails frames 1–7 of every group of 8, and a frame inside a group cannot fall back (`av1.js` `decodeFrame`; PR 410 §ENGINE-REVIEW), so the failure reaches the reader as a failed check where the view is checked, and as wrong frames on screen where it is decoded in hardware and shown unchecked (the owner's word of 2026-11-23 ~02:00) |
| 3 | Queue one cloud row that traces the G = 8 failure (Firefox 159.0.1 and 160.0.1: the engine's output, or `av1-webcodecs.js` under it) | **yes** | one Opus row in the next queue; the cloud can run it (cell 2 ran there) | the cause stays open; item 2's condition stays indefinite |
| 4 | Contradiction 6 closes by one cloud run of *M5 under the amended bar* on Firefox 160.0.1, the `ring` and `disk` arms with the A/A pair, 7 rounds; `ring` on Firefox stands as measured on 155.0 until then | **yes** | one run row, pre-registered by a session that will not run it; the contradiction closes on its result | the ring's Firefox verdict stays on 155.0, labelled so; §5 says why the margin is not expected to move (**theory**) |
| 5 | The first Safari device session runs `engines.md` §Only on a device in its order: the engine probe page, then one WebTransport session and one frame with its SETTINGS captured, then `check.mjs`'s page by hand; on one Apple device with AV1 hardware and one without | **yes** | the order of the first Safari session, whenever a device session exists; the protocol is a row, the run is the owner's device's | Safari's rows stay unmeasured, every one |
| 6 | Firefox for Android stays out of scope (no WebCodecs on release, E19) | **yes** | nothing | the same |

**How it serves the value statement** (amendment 27 item 7): "in a web browser — on a phone … as well as on a
workstation" names no engine. Items 1 and 5 make that claim checkable per engine; item 2 keeps "every frame the reader
asks to see exactly is the original, bit for bit, and checked" from failing on one engine's decoder.

## 3 · The options

What holds where, from `engines.md`'s matrix as corrected 2026-11-21. **M** measured (version named), **S** the
engine's source or document (E1–E26 there), **D** only a device. Every Firefox and Chromium cell is one 4-vCPU
container, one round, no timing claimed.

| result (row) | Chromium | Firefox desktop | Safari macOS / iOS |
| --- | --- | --- | --- |
| The view's AV1 by WebCodecs, exact (1) | **M** 141, 153: every frame `av1-webcodecs` (cell 1) | **M** refused at configure for the grey view, so every frame `av1-dav1d`, 56/56 exact on 160.0.1 (cell 2); **M** 8-bit G = 8 groups inexact on frames 1–7, WebCodecs route only, 159.0.1 and 160.0.1 | **S** AV1 Main only and only with an AV1 hardware decoder (E9–E11, E26); 10-bit `format` `null` by one report (E25); **D** |
| dav1d after a refusal, exact (2) | **M** 408/408 | **M** 408/408 (157) | **S** WASM SIMD (E23); **D** |
| The exact frame, HTJ2K (3) | **M** 240/240 | **M** 240/240; 56/56 on 160.0.1 | **S**; **D** |
| XXH3 check (4) | **M** | **M** 157.0.1 | **S**; **D** |
| `SharedArrayBuffer`, isolation (5) | **M** | **M** | **S** BCD 15.2; the embedder decides per global (E12); WebKitGTK **M** off; **D** |
| Nested decoder workers (6) | **M** 789/789 dispatch | **M** 764/781 (160.0.1, twice), 763/781 (159.0.1): grey payloads refused, scalable clauses, the G = 8 groups | **S** BCD 16.4; **D** |
| WebTransport, draft (7) | **M** draft-02 alone, 153–160; -07 only behind a flag | **M** draft-02, 160.0.1 and 163.0a1 | **S** macOS / iOS 26 where Network.framework's functions load, unconditionally from 27 (E5–E7); which 26.x (U); **D** |
| Paint in a worker (8) | **M** 153 | **M** 155, under Xvfb | **S** BCD 17; **D** |
| The view worker's results (9) | **M** 153 | **M** 155 | **D**, never run |
| The cache's four stores (10) | **M** 153 | **M** 159; all four `exact` at R-idle 512² on 160 (cell 5) | **S** OPFS settings on for Cocoa (E13); WebKitGTK **M** no OPFS; **D** |
| The reports' carriers (11) | **M** BEACON, KEEPALIVE, SESSION deliver at D1 in one of two interleaved runs; in the other SESSION and KEEPALIVE failed to open (Re-review n3) | **M** 160.0.1, D1, one round: three carriers deliver a fill record (`off` its safety record only, n1) | **S** BCD; SESSION needs row 7; **D** |
| `getStats()` (12) | **M** absent on 153, 158, 159; present on 160.0.8173.0, a pre-release build, without byte counts; stable 160 not measured | **M** 160.0.1, 163.0a1: bytes, packets, loss, RTT (BCD's "throws a not-implemented error" is stale) | **S** BCD 26.4; **D** |

Contradiction 6, **measured** (`frame-memory-ownership.md`), growth in MiB, median [range]:

| Firefox | bar | `ring` | `disk` (the floor) | `ring` − floor | room under the bar, largest round | the fill bar |
| --- | --- | --- | --- | --- | --- | --- |
| 159.0, rerun, struck bar (2026-10-30) | `disk` + 320 = 862 | 828 [790–850] | 542 [528–584] | 286 (**derived**) | 12 | missed, 1.30 × `today` |
| 155.0, amended bar (2026-11-02/03) | `disk` + 320 = 760 | 702 [673–710] | 440 [429–450] | 262 (**derived**) | 50 | met, 0.85 |

## 4 · Where it holds

**Fixtures.** One 4-vCPU cloud container; Firefox 159.0.1 and 160.0.1 from `archive.mozilla.org` (each checked
against `SHA256SUMS`), 163.0a1 for the transport; Chrome for Testing 153.0.8010.12 and, for the transport, 158, 159,
160.0.8173.0; `dbts_a1`. Sources at `main` of 2026-11-19 (Chromium `fb1f1ab4`, WebKit `4c0a9cbe`, Gecko `d5236b13`);
BCD `70a51a12`. The ring's rows: the same host class, 80 frames of one series, 7 rounds per arm, Firefox 155.0
(Playwright 1.63's) and 159.0. Every limit of these is in the list below.

**The population.** Desktop Chromium and Firefox: carried only to the versions named; nothing past them. Chrome for
Android: rows 1–3 and 8 are the phone round's (`next-round.md`), not this page's; its hardware route returns RGB
(E24), so the page claims nothing for it. Safari: **no row is measured**, and three rows turn on the device or the
OS, by WebKit's source (**source**, E5–E12): the view's WebCodecs route needs AV1 hardware (else dav1d, row 2), the
transport needs OS 26 with Network.framework's functions or 27, and shared memory is the embedder's call per global.
Nothing measured on WebKitGTK 2.52.6 is carried to Safari.

**US and DBT stacks** (amendment 27 item 6). Every engine row turns on the coded form and the frame's size, not the
modality, so a DBT result carries to an ultrasound clip of the same form (**theory**). One difference matters: an
ultrasound clip in colour would be an 8-bit 4:2:0 form, which Firefox's `VideoDecoder` takes, and that is exactly the
form whose groups failed (item 2; **derived**, not measured on any ultrasound frame). How an ultrasound clip's view is
coded is not yet decided, so whether item 2 binds it is not yet known.

**Predictions against the runs** (cells 1–7). Held: cells 1, 4, 5, 7, and cell 2's pair. Missed: cell 2's `dispatch`
(predicted 3/3, measured 764/781), and cell 3's "-07 on Chromium", a mis-stated prediction (-07 was only ever measured
behind a flag). Decided by the run: `getStats()` on Chromium.

**Where the link, not the decode, binds** (2026-11-25, PAGES-PASS). Most of this page's rows are not a link's: the
decode route, the exact frame, the check, shared memory, workers, paint and the stores (rows 1–6, 8–10) were measured
with no link timed. A link enters at row 7, the transport (which engines negotiate WebTransport at all: **source** and
**measured**, by version), and row 12, `getStats()` (whether the client can see the link). Where the link binds the
view and the exact frame is not an engine's: B on every link below its class's *G*★, A on LTE, a far stream,
LOSS-like links and public Wi-Fi below ~83 Mbit/s for `dbts_b1` on the round's phone, C1's exact frame on every link,
the decode binding A on clean links above that crossover (**derived**, [`delivery-per-link.md`](delivery-per-link.md)
§4); per link profile, WebTransport where any stack serves and the WebSocket fallback on a UDP-hostile network
(**derived**, [`transport-stack.md`](transport-stack.md) §4). That the wire binds at all is untested: on the one phone
measured, the exact series filled faster than the view in 15 of 15 rounds, median 0.705 (**measured**,
[`README.md`](README.md) §Premises item 1). No transport row is lowered by the decode-bound phone, nor by Firefox's
view decoding by dav1d, which is untimed here.

**Each limitation, and what found it** (2026-11-25, PAGES-PASS):

* One 4-vCPU container, no GPU, software decode only; Firefox's WebGL on llvmpipe under Xvfb, Chromium's on
  SwiftShader. Found by ENGINE-SMOKE (`engines.md` §Measured; its fixtures line in ENGINE-REVIEW-FIX-REVIEW).
* One round per cell, no timing claimed. Found by ENGINE-SMOKE ("one round each").
* `dbts_a1` only, 1 of 19 DBT volumes of one dataset; no breast ultrasound cine. Found by ENGINE-SMOKE's fixtures,
  as ENGINE-REVIEW and its fix review restate them.
* No Safari and no phone: no Safari row is measured. Found by ENGINE-MATRIX (Safari's rows source or device only).
* Sources read at `main` of 2026-11-19, not at the releases run; BCD a secondary record. Found by ENGINE-MATRIX's
  pins; ENGINE-REVIEW fetched E1–E26 at them, all verbatim.
* Results carried only to the versions named, nothing past them. Found by ENGINE-PAGE (§4's population).
* Chrome for Android's hardware route returns RGB, so the page claims nothing for it. Found by ENGINE-MATRIX's E24.
* Safari's view needs AV1 hardware, its transport OS 26 with Network.framework's functions (unconditional from 27),
  its shared memory the embedder's call per global; which 26.x is unknown. Found by ENGINE-MATRIX (E5–E12); 26 as
  runtime-gated by ENGINE-REVIEW's m3.
* Safari 10-bit `format` `null` rests on one report. Found by ENGINE-MATRIX's E25.
* Nothing measured on WebKitGTK 2.52.6 (no `SharedArrayBuffer`, no OPFS, no AV1) carries to Safari. Found by
  ENGINE-SMOKE's cell 7.
* Firefox's 8-bit G = 8 groups come back inexact on frames 1–7, the WebCodecs route only, cause not traced here.
  Found by ENGINE-SMOKE (dispatch 17 of 781 failing on 160, 18 on 159); the route by ENGINE-REVIEW (the dav1d variant
  passes). Traced since by ENGINE-CELLS (§6).
* A US colour clip coded as 8-bit 4:2:0 would meet that failure: **derived**, no ultrasound frame run. Found by
  ENGINE-PAGE.
* Cell 2's `dispatch` missed its prediction (3/3 predicted, 764/781 measured), and cell 2's command cannot serve a
  pair, so it ran through `demo-pair.sh`. Found by ENGINE-SMOKE.
* Cell 3's "-07 on Chromium" was a mis-stated prediction: -07 only ever behind a flag. Found by ENGINE-SMOKE;
  the matrix left uncorrected by ENGINE-REVIEW's B1, fixed by ENGINE-REVIEW-FIX.
* Chromium's reports carriers deliver in one of two interleaved D1 runs; in the other SESSION and KEEPALIVE failed to
  open. Found by ENGINE-REVIEW-FIX-REVIEW's n3.
* Firefox's `off` carrier delivers its safety record only. Found by ENGINE-REVIEW-FIX-REVIEW's n1.
* `getStats()` is present on Chromium 160.0.8173.0, a pre-release build, without byte counts; stable 160 not
  measured. Found by ENGINE-SMOKE's cell 3; pre-release by ENGINE-REVIEW's m2.
* BCD's "throws a not-implemented error" for Firefox's `getStats()` is stale. Found by ENGINE-REVIEW's m1.
* Safari's view worker (row 9) never run. Found by ENGINE-MATRIX.
* Contradiction 6: the ring's Firefox verdict rests on 155.0, not the 159.0 its bar was set on; the fill bar under
  its amendment is not measured on 159 or later; §5's "not expected to move" is **theory**. Found by `design.md`
  §Open, contradiction 6, from `frame-memory-ownership.md`. Measured since by ENGINE-CELLS on 160.0.1 (§6).

## 5 · The mechanism

**Firefox's view.** Firefox refuses the grey 4:0:0 AV1 the view sends at configure, so the per-layout probe fails and
every frame goes to dav1d, which is exact; the view holds by its fallback, not by WebCodecs. An 8-bit 4:2:0 form is
accepted and probes fine, but in groups of 8 its inter frames come back wrong on the WebCodecs route only (every
`dav1d:` variant of the same clauses is exact), and inside a group there is no per-frame fallback. Whether the engine
or the client's WebCodecs module under it is at fault is not traced (item 3).

**Safari.** WebKit turns AV1 in WebCodecs on only once a hardware decoder is found (E11), and builds WebTransport
only against Network.framework from OS 26 (E6, E7). So Safari's two central rows are a property of the device, which
no cloud host can stand for.

**Contradiction 6.** The ring's memory is fixed by its design (slots carved once), so what an engine version moves is
its floor, and the bar is the floor plus 320 MiB on each version. The ring sat 286 MiB over its floor on 159.0 and
262 on 155.0 (**derived**), both under 320; so the memory bar is not expected to turn on the version (**theory**).
What is not measured is the fill bar under its amendment on 159 or later: the amendment alone turned 155.0's reading
from 1.23 to 0.85 × `today`, and 159.0 was read only by the struck bar (1.30). Item 4 measures it.

## 6 · What would change the recommendation

* **Item 2:** a trace (item 3) that puts the fault in `av1-webcodecs.js`: then a client fix, not an engine condition.
  One cloud run shows it.
* **Item 4:** `ring` missing the amended fill bar on Firefox 160: choice 2 of `frame-memory-ownership.md` returns to
  the owner for Firefox. One cloud run shows it.
* **Item 1, Safari:** the probe page on one device (item 5) showing `SharedArrayBuffer` absent on a cross-origin
  isolated page: then the client does not run on Safari as built, whatever the other rows say.
* **Named for the owner (PAGES-PASS, 2026-11-25):** ENGINE-CELLS (done 2026-11-24, `claude/engines` `7048b6534`,
  `cc2b4c22d`, `9881d90dd`; its verdict row, which reads `page-runs.md` §3, has not run) reports for item 3 that "the
  G = 8 inter frames never reach a VideoDecoder. av1-payload.js layouts() reads a delta unit's layout from a sequence
  header it lacks", "the client's" fault, and for item 4 that "ring does not qualify on Firefox 160.0.1" (fill ÷
  `today` 1.24, predicted 0.80–0.95), both on synthetic sets. Once verdicted, item 2 would read as a client fix, item 3 as done, and item 4 as
  choice 2 returning to the owner for Firefox. Not changed here.
* **Row 12:** stable Chromium 160 without `getStats()`: the link from the client stays Firefox's only. A run on a stable
  build shows it; the `reports` page reads this row.

## 7 · What it would reopen

Nothing. Item 2 constrains an option (GREY420) that is built and not adopted; WebCodecs first with dav1d as the
fallback (§Decided approaches) is what Firefox's view already does.

## 8 · Rows and links

* ENGINE-MATRIX (2026-11-19), ENGINE-SMOKE (2026-11-20), ENGINE-REVIEW, ENGINE-REVIEW-FIX, ENGINE-REVIEW-FIX-REVIEW
  (2026-11-21): status files `claude/work-ledger:docs/queue/ENGINE-*.md`; PR 410 (`claude/engines`, draft into
  `claude/unified`), `claude/engines:docs/decode/engines.md` and its `engines-smoke/` directory.
* Contradiction 6: `claude/unified:docs/client/design.md` §Open;
  `claude/unified:docs/client/evidence/frame-memory-ownership.md` (*Firefox, run again*, rows at
  `claude/core-m5@91069eb3`; *M5 under the amended bar*, rows at `claude/core-m5b@2f8f63eb`).
* Line doc: `docs/lines/client.md` (on `claude/engines`).
