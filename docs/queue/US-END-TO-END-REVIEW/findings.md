# US-END-TO-END-REVIEW: findings on PR 445


2026-11-24 20:50–21:40 UTC, by a session that wrote none of this PR (`by:` in `docs/queue/US-END-TO-END-REVIEW.md` on
`claude/work-ledger`). Read: the diff `b059388b6..f4d78465d` (base still `claude/unified`'s tip), `from_dicom.py`,
`dicom_series.py`, `client/viewer/check.mjs`, `.github/workflows/gate.yml` on `claude/unified` and on `claude/gate-ci`
(PR 442). Run (**measured**, this 4-core cloud host, no GPU, headless Chromium/SwiftShader, loopback): the three sets
fetched (`OUT=lab/av1/data lab/av1/fetch_data.sh usb_cine usb_cine_rgb dbts_a1`, pins held), `ingest/tools.sh`,
then `PYTHON=.venv/bin/python scripts/stacks_end_to_end.sh`: exit 0 in 18 s, usb_cine 64/64, usb_cine_rgb 64/64,
dbts_a1 56/56 exact in the page and the worker, as the PR states. M1 re-run: fails at the count guard, as stated.
The full gate was not run here (the step alone was).

The chain holds by reading: `from_dicom.py` packs the same `metadata.json` text it writes beside the bundle, so
`stack_fixture.py same` holds the served digests to the pin, and the page's "exact" is against those digests.

**Blocker.**

* **B1. The step never runs in CI, and its skip turns the gate job red.** The brief asks for "one gate step on a
  cached fixture"; no workflow fetches or caches `lab/av1/data`. `gate.yml`'s last step on `claude/unified` (and on
  PR 442) fails the job on any `SKIPPED` line not in `allowed=( "the viewer's cross-codec arm and Firefox" )`, and
  this PR adds the skip "the stacks end to end need the fetched usb_cine, …". So once merged, every run of the gate
  workflow (PR 442 extends it to PRs into `claude/unified` and `claude/eval-release`; on unified it already runs on
  PRs into `main`, i.e. EVAL-RELEASE-PR) fails, and condition 2 is shown only by hand. Fix: in `gate.yml` (unified's,
  and PR 442's part taken by whichever merges second), an `actions/cache` of `lab/av1/data` keyed on
  `hashFiles('lab/av1/data.json')` and, on a miss, the fetch command of `docs/FIXTURES.md` §Stacks end to end; or,
  if the 1.7 GB fetch cannot be borne, the skip added to `allowed` with its reason and the PR's "CI runs it with a
  cache" line corrected to say CI never runs it. The first meets the brief.

**Minor.**

* **m1. The served-count guard tells sets apart by frame count only (measured).** Mutant: `usb_cine`'s bundle served
  in place of `usb_cine_rgb`'s (both 64 frames) — the step **passes** (exit 0, "usb_cine_rgb 64"). The page's
  "exact" is against the served bundle's own digests, so a wrong series of the same length survives. Fix: hold the
  served series to the pin, e.g. compare the bundle `check.mjs` was handed (its metadata's `digests.frames`, or the
  series' uid) with the one `same` checked, or have `check.mjs` print a digest of the digests it verified and match it.
* **m2. The ultrasound object is the easiest the ingest reads; say so in the limits.** `stack_fixture.py dicom` writes
  explicit-little-endian, uncompressed, `PlanarConfiguration` 0. Ultrasound objects as a modality writes them are
  often JPEG baseline and `YBR_FULL_422`, which `dicom_series.py` refuses ("lossy, or not a syntax this ingest
  reads", l. 79; "MONOCHROME1, MONOCHROME2 or RGB only", l. 81), and planar 1 (l. 95) is not exercised. The PR's "the
  US path shown complete" should read: complete for an uncompressed 8-bit object; what a PCS's US objects are is
  `pcs-note`'s question.

**Nit.** `docs/lines/coordination.md` is renamed `release.md` by PR 443 (LINES-FOLD); whichever of 443 and 445 a
sync row merges second takes the entry to the new path.

**Verdict.** One blocker (B1): US-END-TO-END-FIX and US-END-TO-END-FIX-REVIEW appended to `docs/queue-2026-11-24.md`;
a sync row merges this PR only after the re-review with no blocker open. Fixtures and limits: usb_cine and
usb_cine_rgb lossy-sourced (a function check, no bytes or times), dbts_a1 sound; one cloud host, software decode,
loopback, HTJ2K and the ts client only.

## Fix

US-END-TO-END-FIX, 2026-11-24 23:30–, by a session that wrote neither PR 445 nor its review (`by:` in
`docs/queue/US-END-TO-END-FIX.md`). Commits on `claude/us-end-to-end`: `e1f6b817e`, `653ebb6d2`, `cf09b9d38`.

* **B1: fixed (the first way).** `.github/workflows/gate.yml` (unified's): an `actions/cache` of
  `lab/av1/data/{usb_cine,usb_cine_rgb,dbts_a1,dicom}` keyed on `hashFiles('lab/av1/data.json')`, and on a miss
  `OUT=lab/av1/data lab/av1/fetch_data.sh usb_cine usb_cine_rgb dbts_a1`, then the 1.5 GB zip removed, so the cache
  holds about 0.5 GB (**measured** here: 17 + 49 + 219 + 218 MB). `ffmpeg` joins the apt line: the clips are decoded by
  FFmpeg 6.1.1 (`docs/FIXTURES.md` §Provenance), which is Ubuntu 24.04's package (6.1.1-3ubuntu5 on this host, the
  runner's image is the same release; not run on a runner). No allowed skip is added. PR 442's `gate.yml` changes the
  triggers only, so whichever of 442 and 445 a sync row merges second takes both hunks. Not shown: a CI run (the
  workflow's triggers on unified do not include PRs into `claude/unified` until PR 442 lands).
* **m1: fixed.** `stack_fixture.py same` now reads the served `.sbnd`'s own metadata (the header of `docs/FIXTURES.md`
  §SBND series bundle), and the step hands it the same `$out` it serves. The review's mutant (`usb_cine`'s bundle
  copied over `usb_cine_rgb`'s after the ingest) now **fails** (**measured**: exit 1, "usb_cine_rgb.sbnd: 64 digests
  against usb_cine_rgb's 64 pinned frames, frames [0, 1, 2, 3, 4] differ"). A mutant of `check.mjs`'s argument alone
  is a different edit from the one served path; not guarded further.
* **m2: fixed.** `docs/FIXTURES.md` §Stacks end to end: complete for an uncompressed 8-bit US object only, explicit LE,
  planar 0; JPEG baseline and `YBR_FULL_422` refused (`dicom_series.py`, checked at l. 79 and 81), planar 1 not
  exercised; the PCS's US objects are `pcs-note`'s question. The PR body says the same.
* **Nit: argued, left to the sync row.** PR 443 is not yet merged into `claude/unified`; the entry stays in
  `coordination.md` and whichever of 443 and 445 merges second moves it to `release.md`.

Run (**measured**, 4-core cloud host, no GPU, headless Chromium/SwiftShader, loopback, HTJ2K, ts client): the step
alone, exit 0, usb_cine 64/64, usb_cine_rgb 64/64, dbts_a1 56/56 exact in page and worker.
