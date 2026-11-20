# FREEZE-E2E: the demo end to end on `claude/demo-fixes-2`

2026-11-11 20:22–21:30 UTC, work queue row FREEZE-E2E (`claude/work-ledger:docs/queue-2026-11-10.md`): E2E-3's run
([`e2e-3.md`](e2e-3.md)) again, on the frozen tip.

**Demo commit: `157b7109`** (`claude/demo-fixes-2`, PR #367). The commits after it on the branch are this record and
the line file, docs only; PRE-DEMO checks that nothing else moved.

**What went in first.** `claude/clean-product` (CLEAN-PRODUCT, PR #371, `c7c799e9`): its status is done with the full
gate green, so it is merged `--no-ff` as `157b7109`. The merge was clean; against `c7c799e9` the merged tree differs
only in `docs/lines/coordination.md` and `docs/lines/optimal-quality.md` (FIX-2's two later line-file commits).

**Fixtures and limits.** Three breast tomosynthesis volumes from one dataset, `dbts_a1` (56 frames, 12-bit, cut),
`dbts_b1` (50, 10-bit), `dbts_c1` (69, 12-bit, cut); no ultrasound cine. One 4-core cloud host (Xeon 2.30 GHz), no
GPU: headless Chromium on SwiftShader (the global Playwright's build, not README's 1.56.1), WebCodecs' software AV1,
loopback, no phone, no lossy link, no reader's eye. One run per cell. Correctness only: nothing here is a latency
claim.

## What ran

1. README §Prerequisites' cloud lines (dockerd, `meson==1.9.1`, the venv from `ingest/requirements.txt`,
   `fetch_openjph.sh`, `fetch_xxh3.sh`, `wasm-pack` 0.15.0), the transport client's two builds,
   `cargo build --release -p series-server`, `gen_dev_cert.sh --if-needed`. The page's decoders are the committed ones;
   the gate rebuilds them and compares.
2. `PYTHON=.venv/bin/python scripts/demo-series.sh`: `ingest/tools.sh` and 21 series in 542 s. Bytes as FIX-2 recorded:
   Q 8 at 0.0685–0.0687 of the exact series for `dbts_a1`'s cut, 0.2159–0.2186 for `dbts_b1`, 0.0882–0.0898 for
   `dbts_c1`'s cut; Q 24 at 0.0030–0.0246. Three `sourceFingerprint` values, seven series each.
3. README §Demo's check loop ("Before the demo, from any state": 18 series and two `--refuse-webcodecs` runs), each
   run under `--view page` and `--view worker`, interleaved by series. Each `demo-check.mjs` run checks, filled and with
   `fill=0`: every frame painted, the overlay's route (`av1-webcodecs`; `av1-dav1d` with the refusal named under
   `--refuse-webcodecs`), the label's states in order (*Optimal quality* → *fetching lossless…* → *Lossless* → *Optimal
   quality*, and *Lossless check failed* for a digest made wrong), `l`, the exact frame's digest match, whole-group asks
   on demand, no console error.
4. `scripts/gate.sh` in full on `157b7109`.

## Result

**40 of 40 passed** (20 runs × page, worker), 36–53 s a run; no failure, so no blocker and nothing to fix.

**Full gate: `GATE OK in 588 s`** on `157b7109`. Skipped by name: the native painter and window checks (no lavapipe
or Xvfb), the viewer's cross-codec arm and Firefox, and the web host's check (no nginx; FIX-2 ran it apart at
`7d45b31f`, and CLEAN-PRODUCT's web-image change since is not covered by it).

**CI on #367 at `157b7109`: not run yet.** Run 766 was still queued at 21:16 UTC, 55 minutes after the push; this
record's push replaces it with a run on the record's commit. CLEAN-PRODUCT left its CI deploy job (`check.mjs
--url`) unverified, so a green CI on the tip is still owed before the owner's first merge word.

No E2E-3 failure is open (E2E-3 recorded none; FIX-2 merged #362's stricter check, which this loop ran).

## Rehearsal list for the owner, on `157b7109`

Each step is complete from any state; the commands are README §Demo's on this commit.

1. **The laptop.** README §Demo, "Before the demo, from any state": expect 20 lines "demo check: ID passed". Then "One
   series", three terminals, `ID=dbts_a1-q8-g8-cut`, Chrome at `http://127.0.0.1:8765/?overlay=1`, and "What to show,
   in order", 1 to 6. Read the overlay's route (`av1-webcodecs`) and the status line's renderer.
2. **The phone, tethered.** With adb: README §Demo "On a phone" (after §The viewer on an Android phone, steps "Once", 1
   and 2), four terminals. Without installs: README §Demo "On a phone, from a laptop without installs" ("Once per
   laptop", then "Each time, from any state"), with Chrome's flag on the printed origin. "What to show" 1, 3 and 5;
   note the route the phone's Chrome takes, and that the slice slider steps and jumps.
3. **The phone on Wi-Fi.** The same, with the laptop's Wi-Fi address; netem (§The viewer on an Android phone, step 7)
   needs root, which the laptop without installs does not have. Record `157b7109`, the route and *Lossless* on `l` on
   each device.

Not in this commit: DEMO-NETWORK's on-arrival check (PR #372, into this branch, not merged; it reaches the demo only
as a blocker or by the owner's word).
