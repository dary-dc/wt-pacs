# Test, lab and experiment code on the demo's product paths

CLEAN-FIND, 2026-11-11, on the demo tip `claude/demo-fixes-0` `618e13c8`. Findings only: nothing is moved here, and
every move waits for the owner's yes. Ranked by what each saves a reader who must explain the demo, essentials
first. Read from the code; nothing below was measured, and no check was run for it (the "what proves" column names
the checks a move must pass, not checks that passed).

**Where things belong**, as used below: *test file* (a `*.test.mjs`, `*_test.sh` or `mod tests` beside its
module), *check* (`client/viewer/check.mjs`, `demo-check.mjs` and their in-page halves), *the lab* (`lab/`, served
only by the dev host), *the line branch* (the measurement's own branch), *an archive tag* (`archive/*`, as
`archive/transport-lab-2026-09`).

## 1. `client/viewer/viewer.js`: a third of the page is check and lab hooks

The page is 334 lines. About 110 of them serve a check or a lab harness rather than the reader:

| lines | what | read by |
| --- | --- | --- |
| 18–30 | `lab` (levers, `pinned`, `refused`), `writer`, `booted` (`viewWorkerFirst`) | `lab/viewer/levers.js` |
| 55–61 | `?check=`'s stop hooks and `?deadline=` | `check.mjs`; **`?deadline=` is set by nothing in the repository** |
| 93–101 | `seen`, `carriesPixels`, `watch`: messages counted under `?check=&view=worker` | `check-page.js` |
| 106, 111–112 | `settle: lab.settle`, `watchWrites`, `glAfterDial` passed to Painter and ViewWorker | lab, check |
| 153, 158–159, 166, 171–172 | `lab.opts` spread over the connect options, `lab.started`, `pageDials`/`firstWant` | lab |
| 217–235 | `stepped`, `until`, `traced`: the lab's sawtooth trace | `lab/viewer/trace.js` |
| 298–333 | `report`, the fill-end poll, `check-page.js`'s run, the lab's steps, cine and `ledger`, `?mutate=sample` | check, lab |

* **Where it belongs.** One new module beside the page, viewer/hooks.js (proposed; name to be checked against
  `docs/glossary.md`), loaded only when `?check=` is set or `head.js` resolved `viewerLab` from `/lab/viewer/levers.js`.
  It would own `report`, the fill-end wait, the trace, the steps, the ledger and `?mutate=`. The page keeps one call:
  `if (hooks) await hooks.run({ view, controller, worker, progress, errors, … })`.
  `?mutate=sample` belongs with the lab's levers in `lab/viewer/levers.js` (it is set only by
  `lab/av1/delivery/fill/run.mjs:111` and `total-time/run.mjs:383`), not read by the page.
  `?deadline=`: drop it, or move it to the hooks; nothing sets it (`client/README.md:419` lists it as the page's own).
* **What proves the product unchanged.** `client/viewer/run_check.sh` (page and worker views), `demo-check.mjs` on
  README §Demo's series under both views (VIEW-WORKER-CHECK's run), `lab/viewer/levers.test.mjs` and
  `trace.test.mjs`, one `lab/viewer/view_run.sh` cell to show the ledger still reaches the harness, and the gate's
  `scripts/check_*absent*` steps. Mutant: delete the hooks' import — the page check must fail, the demo check pass.
* **Size.** ~110 lines moved, ~10 added; viewer.js to ~230. Two files touched besides the new one (`index.html`'s
  preload list, `deploy/web-files.sh`). Risk before 11-13: medium — the page is the demo; do it after FREEZE-E2E.
* **What it saves the reader.** The page then reads metadata → pair → connect → label → keys, top to bottom.

## 2. The view worker and the painter carry five lab settings through product signatures

`ViewWorker(canvas, { …, watch, settle, watchWrites, booted, glAfterDial })` (`client/view/view.js:91`),
`Painter(canvas, { onLost, settle })` (`client/paint/painter.js:12`), `view-worker.js`'s `start` (52–57) and
`connect` (`writer`, `holdEveryOther`, `waitAhead`, 79–112), `ledger` (149) and `check` (154);
`controller.ledger({ flip })` (`controller.js:250–262`), `controller.ascending` (`waitAhead`, 31).
In the demo none is set: `settle` is undefined, `watchWrites` false, `writer` none.

* **Where it belongs.** `settle`, `glAfterDial`, `viewWorkerFirst`/`booted`, `holdEveryOther`, `pageDials`: the
  lab's frame-path experiments (`docs/adr/frame-path.md` §3, §7). Each either moves to its line branch and an
  archive tag with its result in the ADR (where the experiment has concluded), or stays as one `lab` object passed
  through unchanged rather than five named parameters. `ledger` and `flip`: the lab harness's, behind the same
  object. `watch`/`watchWrites`/`check`: the check's, loaded with item 1's hooks.
  Which experiments have concluded is a line decision (`docs/lines/client.md`), not made here.
* **What proves.** `client/view/view.test.mjs`, `view-worker.test.mjs`, `controller.test.mjs`, the page check under
  `view=worker`, `lab/viewer/levers.test.mjs` (its refusals of worker-only settings under `view=page`).
* **Size.** ~60 lines across four files if folded into one `lab` object; more if experiments are archived.
  Risk before 11-13: medium (the worker path is VIEW-WORKER-CHECK's subject); after the demo.
* **Saves.** The constructor a presenter opens shows what the product passes: meta, fill mode, size, emit.

## 3. The downloader's and decoders' lab flags

`downloader.js`: `startOnNeed` (55, 148), `waitAhead` (253–254), `shortRuns` (264–265), `pixels: "transfer"`
(501, and `decode/frame-buffer.js:1`, `decoder.js:22`), `heldAcks` (`consumer.js:34–43`, set by the view worker
itself: product). `decode/av1.js`: `mixed` (72, 81, the path `av1-mixed`), `onePass` (on by default, measured:
`docs/decode/README.md` §JS passes), `reuseCopyBuffer` (off, measured: §Merge-free).

* **Where it belongs.** `onePass`: product default, decided by its protocol — the flag can go and the off branch
  with it (`av1-webcodecs.js:152`, `av1.js:61`), the measurement kept on its line branch. `reuseCopyBuffer`: off by
  its measurement, `R stays off by default` — its branch (`av1-webcodecs.js:12, 19, 68`) can leave to the line branch.
  `mixed`, `startOnNeed`, `waitAhead`, `shortRuns`, `pixels`: lab settings with no decided default other than off;
  they stay until their lines conclude, but `av1-mixed` is a third route the overlay can name, which a presenter
  must explain only if it can appear — it cannot without `opts.mixed`.
* **What proves.** `client/decode/av1.test.mjs` (the `onePass` test at 176 becomes a test of the one path),
  `client/contract` (the dispatch rig), `depth-cut.browser.mjs`, the demo check's route (`--route av1-webcodecs`
  and `av1-dav1d`), TEST-MOBILE's route tests.
* **Size.** `onePass` and `reuseCopyBuffer`: ~20 lines and one test reworded. The rest: none now.
  Risk before 11-13: low for `reuseCopyBuffer`, medium for `onePass` (it is the default decode).
* **Saves.** One WebCodecs merge path to explain instead of two, and no flag a reader must check is off.

## 4. The web image ships the check's in-page halves

`deploy/web-files.sh:10–14` copies `viewer/check-page.js` and `view/check.js` into the web image ("load on
`?check=` alone"), so a production page honours `?check=1`: it loads them, runs the check protocol
against the live server and logs `viewer-result`. Nothing in `deploy/`, `scripts/` or `.github/` opens the image's
page with `?check=` (grep, 2026-11-11). `viewer/store.js` is listed twice (lines 10 and 14).

* **Where it belongs.** The check's halves are served by the dev host only, as `lab/` is: the page asks for them
  only under `?check=`, so leaving them out makes `?check=` refuse on the image, as `head.js` refuses lab
  parameters. `paint/reference.js` stays: the product's `valueAt` imports it (`controller.js:238`). The duplicate `viewer/store.js`: drop one.
* **What proves.** `deploy/check_equivalence.sh` and `web-files_test.sh` (the image's file list), the page check on
  the dev host, and a new test that the image's page under `?check=1` reports a refusal, mutated by putting the
  files back.
* **Size.** 2–3 entries and one test. Risk before 11-13: low (the demo runs on the dev host).
* **Saves.** "Does the product run its own test?" gets the answer no.

## 5. L1: mainbase's lab paths under `lab/av1/decode/` on the demo tip

The evening brief's L1 counts 40 paths and 3 337 lines on `core-next`. Counted here: **38 paths, 3 132 lines**,
added over `claude/core` (`git diff --shortstat origin/claude/core 618e13c8 -- lab/av1/decode`), in three folders:
`breakdown/` (11), `merge-free/` (15, with `rows.json.gz` 575 KB and a WASM SIMD kernel under `s/`), `passes/`
(12). All 38 are byte-identical on `claude/av1-unified-mainbase` `696c15d6`. Nothing in `client/` or `server/`
imports them; `docs/decode/README.md` links them 8 times (lines 2069, 2101, 2150, 2237, 2293, 2304, 2323, 2328).

* **Where it belongs.** The line branch, `claude/av1-unified-mainbase`, with the 8 links pinned to
  `…/blob/696c15d6/lab/av1/decode/…` (or an archive tag on that commit, if the owner prefers a name that cannot
  move). The brief's other reading stands: `claude/core` itself carries 105 files under `lab/av1/decode`, so L1
  takes the demo back to core's lab, not to none.
* **What proves.** `scripts/check_links.py` (the pinned links resolve), `git diff --stat` showing only `lab/` and
  `docs/decode/README.md` changed, the full gate (no product path imports them).
* **Size.** One commit: 38 deletions, 8 link edits. Risk before 11-13: none to the product; it is the decision L1
  asks.
* **Saves.** Little for a presenter (no demo path touches it); it saves a reviewer of `core…demo` 3 132 lines.

## 6. The server: lab features compiled behind Cargo features, but the lab is in the workspace

Behind features, none on by default (`server/Cargo.toml:15–28`): `telemetry` (21 `cfg` sites, from
`lab/server-telemetry`), `lab-levers` (16, `transport/lab_levers.rs`), `lab-frame-cache` (4, `media/lab_frame_cache.rs`
`#[path]`-includes `lab/disk-access-bench/src/frame_cache.rs`), `lab-classify` (5, from `lab/cc-classify`). The
default build refuses each lab flag (`main.rs:126`), and the gate checks the telemetry is absent
(`server/scripts/check_telemetry_absent.sh`). Six `lab/` crates are workspace members (`Cargo.toml:11–16`), so
`deploy/Containerfile:21–32` copies their sources into the server image's build stage.

* **Where it belongs.** The gating is sound and the demo build has none of it; nothing must move for the demo. For
  a reader: `lab-frame-cache` reaching into a lab crate by `#[path]` is the one product file that compiles lab
  source — if the frame cache's line has concluded (`docs/adr/disk-access.md` §13), it goes to its line branch and an
  archive tag. The four lab-only crates without a server dependency (`container-bench`, `window-harness`,
  `telemetry-bench`, `disk-access-bench` once the cache leaves) can leave the workspace (`exclude`, each its own
  lockfile or a workspace of their own under lab/), and the Containerfile's 8 lab `COPY` lines with them.
* **What proves.** `cargo test -p series-server` default and per feature as `scripts/gate.sh:221–262` runs them,
  `check_telemetry_absent.sh`, the image's build, `deploy/check_equivalence.sh`.
* **Size.** Workspace: ~10 manifest lines, 8 Containerfile lines, the gate's line 251. Frame cache: ~80 lines and a
  feature. Risk before 11-13: low but it rebuilds the image; after the demo.
* **Saves.** `server/src` holds no file named `lab_*` and the image build names no lab folder.

## 7. Smaller: lab pointers in product comments

`decode/av1-webcodecs.js:55, 131`, `av1-payload.js:171`, `av1-frame.js:112`, `htj2k.js:1`, `av1.js:13, 17`,
`consumer.js:44` point to folders under lab/ for their reason. `CLAUDE.md` §Comments asks for a one-line pointer to the
document that explains why; these point at the experiment rather than the doc that owns the result. Where
`docs/decode/README.md` or an ADR holds it, point there. Size: ~8 one-line edits; no proof beyond
`scripts/comment_budget.sh` and `check_links.py`. Risk: none. Saves: a reader follows one link to a conclusion,
not to a harness.

## Swept and clean

`server/dev-server.py` (its `/harness` route serves `lab/harness/`; a dev host only — DEFAULTS-FIND owns its
options), `client/viewer/head.js` (lab parameters refused unless `/lab/viewer/levers.js` is served — sound),
`client/view/store.js`, `cache.js`, `frame-file.js`, `client/viewer/pair.js`, `client/paint/voi.js`, `settle.js`
(product: a fence for the paint's settle, needed by the lab's `settle` only — moves with item 2 if that does),
`deploy/` beyond items 4 and 6. Not swept: `client/native/` (not on the demo path), `client/contract/` (a test
suite by name).

**Fixtures and limits.** Read from the code of one commit; no browser, server or measurement was run for these
findings. The demo's series are README §Demo's (`dbts_a1`, `dbts_b1`, `dbts_c1`, one dataset; no ultrasound cine).
