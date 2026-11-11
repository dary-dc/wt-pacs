# Proposals

Proposals for the optimal-quality demo path, each with what decides it. This branch (`claude/demo-simplify`) holds only
§Simplify; the optimizer's proposals are on `claude/proposals`, and the two meet when the owner takes them.

## Simplify

Findings only, written 2026-11-11 against the demo tip `claude/demo-fixes-0` at `618e13c8`; nothing is removed here.
The owner decides what goes in, and when. Each item: what it removes, the evidence that no capability is lost, what it
saves a presenter who must explain the demo, and the risk of doing it before 11-13. Ranked by that saving.

**The demo path**, as README §Demo runs it: `index.html` → `head.js` (metadata, transport file, preloads; `lab/viewer/
levers.js` only when a lab parameter is named) → `viewer.js` with `view=page` (the default) and the `ts` client (the
default transport file names none) → `consumer.js` → `downloader.js` → `decoder.js` → `av1.js` (WebCodecs, dav1d after
a refusal) → `controller.js` / `view/store.js` → `painter.js` → `paint-worker.js`; the exact series on a second
downloader, `pairOf`/`checkPair` (`pair.js`), XXH3 in `decoder.js`. Off that path by default: the view worker, the OPFS
cache, the `wasm` client, the WebSocket and race sessions, every lab lever.

**Evidence base.** Unit tests at `618e13c8`, all passing in this session: `client/view/controller.test.mjs`,
`view.test.mjs`, `view-worker.test.mjs`, `client/viewer/pair.test.mjs`, `client/decode/av1.test.mjs`. Browser checks
named below, not run here: `client/viewer/run_check.sh` (HTJ2K `grey.sbnd`, page and worker × ts and wasm, cine and
`fill 0`, the cache under each writer), `client/viewer/demo-check.mjs` (the 20 optimal-quality series, page view, ts
only; DEMO-E2E-2 passed all 20 on 2026-11-10). Fixtures behind them: `dbts_a1`, `dbts_b1`, `dbts_c1`, three
tomosynthesis volumes of one dataset; no ultrasound cine; 4-core cloud hosts without a GPU, headless Chromium.

| # | what | saving to a presenter | risk before 11-13 | needs the owner |
| --- | --- | --- | --- | --- |
| S1 | the lab harness out of `viewer.js` | high | medium–high | when |
| S2 | one view on the demo path | high | high (if the default flips) | yes: which view |
| S3 | one place a pair is started | medium | low | when |
| S4 | the `unchecked` mark under the quality label | medium | low | yes: what the reader sees |
| S5 | the status line names only what the demo varies | low–medium | low | yes |
| S6 | the WebSocket and race sessions out of the product build | low (one question less) | low | when |
| S7 | lab levers out of the connect options | low on the screen, medium in the code | medium | when |
| S8 | the `wasm` client on the demo path | low | none if left | yes (2026-10-16 decision) |

**S1. The lab harness out of `viewer.js`.** About 90 of its 334 lines serve a check or a lab rig, not the reader:
`lab.started`, `filled`, `finished`, `trace`, `steps`, `cine`, `ledger`, `pinned`, `settle` and `lab.opts` spread into
the connect options (lines 18–19, 153–174, 219–234, 324–333); `?check`, `?deadline`, `?mutate` and `check-page.js`
(55–61, 299–322); the worker variant's message count `seen`/`watch` (93–101); the boot stamps for the ledger (32–33).
*Removes* those lines from the product page into a lab entry (for instance `lab/viewer/page.js` that starts the same
modules with hooks), and `check-page.js`, `view/check.js` and `paint/reference.js`'s check use from the web image
(`deploy/web-files.sh` copies them today). *No capability lost*: `run_check.sh` and `lab/viewer/levers.test.mjs` must
pass unchanged through the new entry; `demo-check.mjs` opens the page as a reader (`?overlay=1`, no `?check`) and must
still pass on the 20 series; the lab rigs that read `lab.finished` (`lab/av1/delivery/total-time/run.mjs`) must still
record. *Saves*: the page a presenter reads becomes metadata → pair → connect → label, about 240 lines with no branch
the demo never takes. *Risk*: the gate's browser checks hang on `?check`; a slip blinds the rehearsal checks two days
before the demo. Overlaps CLEAN-FIND (`claude/demo-understand`), which owns where each item belongs; this item is only
its saving. Recommended after 11-13.

**S2. One view on the demo path.** `?view=page` (default, every demo check so far) and `?view=worker` (the client
target, 2026-10-28) carry the same intents twice: `viewer.js` branches on `where` in nine places (21–22, 30, 94,
103–113, 175, 204–205, 319, 322, 331); `View` drives either a page `Controller` or `ViewWorker` (`view.js` 66–228); the
worker half adds `view-worker.js` (168), `clock.js` (85), `cache.js` (77), `frame-file.js` (38), `viewer/store.js`
(142). *What can go*: not the worker, which holds the decided OPFS cache and is the target; the page path (`painter.js`
62, the page branches of `viewer.js`, half of `run_check.sh`'s matrix) once the worker meets the page's bar. *No
capability lost*: VIEW-WORKER-CHECK (`claude/demo-view-worker`, running) is the deciding check: `demo-check.mjs --view
worker` on all 20 series, interleaved with `--view page`; plus `run_check.sh`'s worker rows, which already pass. *Saves*:
"where are the frames held" has one answer instead of a flag; for 11-13 the presenter can say "on the page; the view
worker is the target, off by default" without removing anything. *Risk*: flipping the default before 11-13 puts an
arm no demo check has passed on an OQ pair, and no phone run of either, in front of readers. Which view the demo shows
is the owner's (VIEW-WORKER-CHECK's brief). Recommended: decide after VIEW-WORKER-CHECK; retire the page view after
11-13 if the worker passes.

**S3. One place a pair is started.** A pair takes three terminals, a `sed` of `client/dev-transport.json` into
`target/exact-transport.json` and an order to start them in (README §Demo); the phone variant adds a fourth and two
transport files. `demo-check.mjs`'s `serve()` (lines 47–61) already does exactly this, certificate first. *Removes* the
three-terminal block from README §Demo, replaced by one command that keeps those servers up (a `--serve` mode of
`demo-check.mjs`, or a short `scripts/demo-pair.sh ID` that `demo-check.mjs` calls). This adds no capability and
removes a duplicate: the README's commands and the check's copy of them can drift today. *No capability lost*:
`demo-check.mjs` on the 20 series, now through the same starter; the phone block through PHONE-PAIR's network-namespace
harness. *Saves*: the presenter's setup is one line, and "why port 4434" is answered in one file. *Risk*: low; it changes
how servers start, not what they serve. Coordinate with PHONE-NO-INSTALL, which also edits the phone block.

**S4. The `unchecked` mark under the quality label.** On every optimal-quality frame the page shows two signals for
one fact: the grey *unchecked* mark top left and *Optimal quality* top right (`viewer.js` 83–84; REVIEW-BLIND C1).
*Removes* the mark when the series is paired (the label then says what is painted); the mark stays for a series with
neither digests nor a pair, where it is the only signal. *No capability lost*: *NOT EXACT* (a failed digest) keeps its
red mark; *Lossless check failed* keeps its red label. No test pins the mark today (`demo-check.mjs` reads the label,
overlay and status line, not `#mark`), so the change needs a failing test first. *Saves*: the presenter no longer
explains why an optimal-quality frame is "unchecked" while the label calls it optimal. *Risk*: low in code, but it is
what the reader sees: the owner's.

**S5. The status line names only what the demo varies.** It shows `client ts` and `view page` on every demo frame
(`viewer.js` 142–143), choices no demo step varies and a reader cannot act on. *Removes* those two fields from the
reader's line (they move to `?overlay=1`). *No capability lost*: `check.mjs` 229–230 asserts both on the status line
and would read them from the overlay instead; `demo-check.mjs` parses only `frame N` from the status line. *Saves*: two
terms (client, view) the presenter would otherwise define. *Risk*: low; `check.mjs`'s two asserts move with them.

**S6. The WebSocket and race sessions out of the product build.** `ts/build.sh --product` (run by
`deploy/Containerfile` line 80) bundles `ws-session.js` and `race-session.js` into the image, but no product page can
load them: `head.js`'s `CLIENTS` names only `ts` (`session.js`) and `wasm`. Their users are `client/contract/
adapters.ts`, `lab/harness/shell.js` and `scripts/perf_counts.mjs`, all outside the image. *Removes* two bundles from
`--product` (the full build keeps them for the contract and the lab), and with them the question "is there a TCP path"
for the demo: there is none, as decided ("no TCP for the fill unless proven"). *No capability lost*: the contract's
`transport-ws` and `transport-race` adapters (`client/contract/adapters.ts`) load the full build's bundles;
`check_telemetry_absent.sh` and `check_worker_safe.sh` list the three bundles and would list one for the image;
`deploy/check_equivalence.sh` in CI. *Saves*: little on screen, one honest answer in the image. *Risk*: low (build only).

**S7. Lab levers out of the connect options.** `viewer.js` spreads `lab.opts` into the connect options (line 169), so
the product modules carry lab settings through to the wire: `waitAhead` (controller, view worker, downloader),
`holdEveryOther`, `pageDials`, `viewWorkerFirst`, `glAfterDial` (view, view worker), `shortRuns` (downloader),
`pixels: "transfer"` (decoder, frame buffer), `writer` (decoder, cache, view worker). Each is refused unless named
(`lab/viewer/levers.js`), so the default path is unchanged by them. *Removes* the levers that no open question needs
any more, each named by the line that measured it; the ones still deciding something stay. *No capability lost*:
`run_check.sh`'s `--opts` rows name the levers in use (`fix`, lines 35–39); a lever no check or rig names is the
candidate. *Saves*: a reader of `downloader.js` (696 lines) and `view-worker.js` stops meeting experiment arms beside
the product's. *Risk*: medium; it touches the downloader two days before the demo. Recommended after 11-13, per lever,
with CLEAN-FIND's list.

**S8. The `wasm` client on the demo path.** Reached only by a transport file naming `"client": "wasm"`; the demo's
files never do. Two product clients are the owner's decision (2026-10-16), so nothing is proposed for removal; for the
demo it costs only S5's status field. Listed so a presenter asked "which client" has the answer: `ts`, the default.

**Kept, not candidates** (decided approaches): dav1d-WASM after a WebCodecs refusal and the `…-stored` series that
shows it; the depth cut; the exact frame on a second downloader from its own server (no server or wire change); the
OPFS cache; `?fill=0` (demo step 6). REVIEW-BLIND's D1 (dav1d preloaded on every AV1 page) is a default to measure,
not a simplification.
