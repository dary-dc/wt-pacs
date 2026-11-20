# CLEAN-REVIEW: `claude/demo-fixes-2...claude/clean-product`

2026-11-11, work queue row CLEAN-REVIEW (`claude/work-ledger:docs/queue-2026-11-10.md`), by a session that wrote none
of CLEAN-PRODUCT. Range: `d46811c6..c7c799e9`, nine commits (`63140f29` to `c7c799e9`, with the merge `0eee2ad1`).
FREEZE-E2E had already merged `c7c799e9` into `claude/demo-fixes-2` as `157b7109` when this review started (21:25 UTC),
so the review is of what is now in the demo commit.

**Fixtures and limits.** One 4-core cloud host, no GPU, headless Chromium on SwiftShader. Node unit tests, `cargo
test -p series-server` (default and `lab-levers`), `client/viewer/crafted.mjs`, the two absence checks. Not run here:
the full gate, `demo-series.sh` and `demo-check.mjs` (CLEAN-PRODUCT and FREEZE-E2E ran them on these trees: 39/40
and 40/40), the nginx web-host check, Firefox. Nothing timed.

## Verdict

**No blocker.** Every change keeps the product's default behaviour: the product's tests pass on both trees, and each
change, reverted, is caught by a test or check that CLEAN-PRODUCT added. The absence check fails on the old tree and
passes on the new. Nothing a line still uses was removed: the frame clock's removal is applied and reverted (tree
equal), and item 12 stays. The 11-04 rule is corrected in place once, in §Decisions. Four findings for the owner
below, none on the product path.

## Each change reverted

| change | commits | reverted on the new tree | caught by |
| --- | --- | --- | --- |
| the three server lab flags behind `lab-levers` | `f866da46` | the old tree's default binary | `server/scripts/check_telemetry_absent.sh` (see §Absence check); `the_default_build_refuses_every_lab_lever` |
| `onePass`, `reuseCopyBuffer` retired | `c2034cb3` | `client/decode/av1-webcodecs.js`, `av1.js` from `d46811c6` | `av1.test.mjs`: 6 of 723 fail (four split-frame "read alike under every config", chroma under `onePass: false`, reuse under `reuseCopyBuffer: true`) |
| the page hooks and the check's modules out of the web image | `1ab25a58` | `viewer.js`, `head.js`, `view.js`, `view-worker.js`, `painter.js`, `web-files.sh`, the two check modules from `d46811c6` | `crafted.mjs`: `?check was not refused` on the product's host; the web image ships `client/view/check.js` and `client/viewer/check-page.js`, the absence check's web half |
| the frame clock's experiment removed, then restored | `dd2c3902`, `24b80bcd` | — | nothing to catch: `24b80bcd`'s tree equals `c2034cb3`'s |
| the absence check | `63140f29`, `05247e22` | — | §Absence check |

**Product behaviour unchanged.** On both `d46811c6` and `c7c799e9`: `decoder`, `av1`, `controller`, `view`,
`view-worker`, `screen`, `pair` node tests all pass. On `c7c799e9`: `cargo test -p series-server` 127 + 6 + 1 pass,
and 132 + 6 + 1 with `--features lab-levers`. The default decode config (`onePass` unset, `reuseCopyBuffer` unset) took
the decided path before and takes the only path now: `av1.test.mjs` checks that an unset config reads alike. A page
with no lab parameter loads no lab module before or after. CI on #367's tip `b196f009` (which holds `157b7109`):
the deploy job, with `check.mjs --url` against the image, passed at 21:18 UTC. CLEAN-PRODUCT's status had it
unverified.

## Absence check

`c7c799e9`'s `scripts/check_lab_absent.sh` and `server/scripts/check_telemetry_absent.sh`, run on each tree, each
tree with its own `CARGO_TARGET_DIR`:

| tree | `check_lab_absent.sh` | `check_telemetry_absent.sh` |
| --- | --- | --- |
| `d46811c6` (old) | FAIL: the web image ships `client/view/check.js`, `client/viewer/check-page.js` | FAIL: `per-frame-asks-first`, `reply-repeated-initial`, `send-window-follows-cwnd` in the default build |
| `c7c799e9` (new) | OK | OK |

On the old tree the deploy-image and lab-source halves pass: `05247e22` narrowed the image check to the shipped
stages, and the old default build compiled no lab source either. A first run here shared one `CARGO_TARGET_DIR`
across the two worktrees and passed the old tree's server check wrongly: cargo judged the new tree's binary fresh
for the old sources (one hash, older mtimes). Compare trees with a target directory each.

## Findings for the owner

* **F1 (devices line): the device kit's `asksfirst` arm will not start on an image built after this merge.**
  `lab/devices/arms.json` passes `--stream-mode per-frame-asks-first` to the deploy image `wt-pacs-server`, a default
  build, which now refuses the flag; `docs/devices.md` D2 (on `claude/phone-protocol`) runs that arm, "the same
  binary". The phone run today uses an earlier commit, so nothing is broken yet. Options: a `FEATURES` build argument
  in `deploy/Containerfile` for a lab image the kit builds, or D2 without that arm. A structural choice, so not made
  here. `lab/ask-ahead` and `lab/irtt` already say `--features lab-levers` in their READMEs.
* **F2 (lab tool): under `?check=`, a refused transport now gives no result.** When `globalThis.viewerTransport`
  rejects, `viewer.js` makes `lab = { refused }`, so `hooks` is undefined and `hooks?.report` writes nothing: the
  check waits its 300 s and reports "no result" where it reported the refusal before. From the code, not run; the
  product page is unaffected (it shows the same status line).
* **F3 (lab tool): `check.mjs --url` is Chromium only.** The `lab/` route is a Playwright route on the Chromium
  context; Firefox under `--url` was possible before. No script or CI job uses it; the README says so.
* **F4 (docs): two echoes of the old 11-04 rule remain** in `docs/lines/coordination.md`: §Unification step 1 ("an
  `archive/<name>` tag plus one index line") and §Open 4 (where the archive index lives). The owner's 11-11 wording
  says no archive tags. The rule itself in §Decisions is corrected once, in place.
* **F5 (history): `dd2c3902`'s message reads "Revert the frame clock's removal"** but the commit is the removal; it is
  now in `claude/demo-fixes-2`'s history and will be in `main`'s. CLEAN-PRODUCT says so in `coordination.md` §Open 7.
  The owner's yes for item 11 is still `git revert 24b80bcd`.

Owed by the owner, unchanged: item 11 (the frame clock, yes or no) and item 16 (the lab crates' own workspace).
