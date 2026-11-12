# Native

Last verified 2026-11-12 against the demo tip `claude/demo-fixes-2` `18d2d1ff` (PR 367), the queue's status files
(`claude/work-ledger:docs/queue/`), `claude/merge-plan`, `claude/lines-ready` and the open PRs.

## 1. Goal

A native client without the browser's limits, for HTJ2K and AV1: computers first, phones the end. Lossless and bit
exact; mobile on lossy wireless. It earns its place only where it beats the browser on a measurement.

## 2. On `main` after this week's merge

What PR 367 then PR 250 carry, once the owner gives the two words; until then it is on `claude/demo-fixes-2`, none
on `main`. The line has no unified branch of its own: it rides `claude/unified-client`
(`claude/lines-ready:docs/reviews/lines-ready.md` §7).

* **`client/native/`** (crate `native-client`, about 3 300 lines): a raw-QUIC client (quinn) on its own ALPN
  `wt-pacs/1`, which the server accepts beside h3 on its one endpoint (`docs/WIRE.md` §The raw QUIC mapping,
  `docs/native/README.md` §8); native OpenJPH and dav1d behind feature `decode`; the XXH3 frame check; a file cache
  (`cache.rs`); a wgpu painter (`paint`, `R16Uint` with in-shader bilinear, §2); a winit window (`window`) with the
  view-worker design on threads (`--paint-thread ui|view|core`, §The view-worker design, native).
* **The image builds**: the crate is a root workspace member and `deploy/Containerfile` copies it
  (`core-ci-deploy`, [`coordination.md`](coordination.md)). It is not served by the image nor used by the page.
* **The gate** (`scripts/gate.sh`): the core over raw QUIC against the server and a WebTransport client; the native
  decode of every committed frame digest and the view module (with `ingest/tools.sh`'s build); the painter's 1:1
  cells against the browser suite's CPU reference (Mesa lavapipe, numpy); the window under Xvfb with every paint
  thread. Fresh cloud sessions skip the last two by name (no lavapipe or Xvfb), as every gate record of 11-11 says.
* **Results that stand** (`docs/native/README.md` §6; cloud containers, 4 vCPU, no GPU, software rendering):
  M1 PAINTPROOF passes (54 exact cells × DPR 1 and 2, |Δ| = 0 on lavapipe; not yet on any GPU). M2 NATIVEFILL: on a
  clean link a native client buys nothing on fill or ask on desktop; under 2 % random loss at 20 Mbit its fill is
  about 4 % faster in one decidable cell; its clear gain is where client CPU binds (0.43–0.48 of the fill on
  loopback). M3 CACHE: the design stands (warm reopen 373 ms against 25 s from the relay; 100 of 100 kills clean;
  7 of 7 flipped bytes refused); a cold reopen and a power loss are not measured.
* **Off the tip**: `lab/native-fill` and `lab/scripts/native_cache_cells.sh` were removed (EXPERIMENTS-OFF, `3a4a5922`);
  M2's and M3's runs are pinned at `0920153d` and `a237cf3e`, and come back with `git log --diff-filter=D --
  lab/native-fill` when a row needs them.

## 3. Decided (never reopened by an agent)

| decision | date | recorded |
| --- | --- | --- |
| Native is a next goal, computers first, phones the end; the owner takes every transport choice | 2026-10-10 | `docs/native/README.md` §7 |
| Build now, headless first: a Rust core on raw QUIC with its own ALPN beside WebTransport, native OpenJPH and dav1d, the check, a file cache, then M1 and M2 | 2026-10-26 | same, §7 decision 1 |
| After M2, a minimal window on a computer (winit and wgpu) to make the shape concrete | 2026-10-27 | this file since that date |
| The shape is "basic": the surface-only window, no toolkit; native arms stay inside it | 2026-10-29 | `docs/native/README.md` §7 decision 2 |
| The core design is closed with what it has and reaches `main` this week (PR 367, PR 250); `client/native` rides it | 2026-11-11 21:15 | `claude/work-ledger:docs/queue-2026-11-10.md`, the owner's decisions |
| Nothing reaches `main` uncleaned; lab code never inside product modules | 2026-11-11 17:30 | [`coordination.md`](coordination.md) §Decisions |
| Target: mobile on lossy wireless; resilience is phase 2, parked | 2026-11-11 | the queue file, §Decided approaches |

## 4. Open, ranked

Fixtures for every result above and below: synthetic and committed series, the three DBT volumes (`dbts_a1`,
`dbts_b1`, `dbts_c1`) of one dataset, no breast ultrasound cine; 4-core cloud containers without a GPU (lavapipe,
SwiftShader), loopback or a userspace relay, never a radio. No native run on a phone or a GPU exists.

1. **The lab settings inside the product window.** `window.rs` carries `--cine-hz`, `--busy-ui-ms`, `--steps`,
   `--steps-via`, `--stamp-painted` (NATIVERUN's, off by default), and `count.rs` stamps every hop always. The
   cleaning rule says no lab code inside product modules; EXPERIMENTS-OFF item 10 rated `client/native` product
   without checking these. Matters: the crate reaches `main` this week. Decides: an inventory of each setting, still
   used by a queued row or not, and the move (a lab example or a `lab` feature) as a draft PR, the gate's window
   step green. The owner's yes before any removal.
2. **Keep on `main`, or off until the shape is decided** (EXPERIMENTS-OFF item 10, keep / off, not answered on its
   own; the 21:15 decision carries it). Removing it touches the workspace, the lockfile, the image, the server's
   `wt-pacs/1` ALPN and the gate. The owner's.
3. **NATIVERUN, never run**: the view-worker design natively (N0 today, N1 target, N2 single core, B the browser),
   pre-registered in `docs/native/README.md` §The comparison; the window side is built (§Built for NATIVERUN). Owed:
   the runner (Williams square with A/A, the relay cells, 1-core pinning, the `/proc` saturation guard, `VmHWM`),
   the visit's end, dial-to-last-exact and inter-arrival p99 printed, the synthetic 3328 × 4096 series. Its rule
   turns on metrics 4 and 5. A build row, then the run by a session that wrote neither.
4. **M4 PHONEFIRST** on one Android phone, after P-ARM (`docs/decode/README.md` §Not yet tried): M2's cells over the
   phone's Wi-Fi against Chrome on the same phone; predictions the fill within ±3 % at 20 Mbit, the large-frame ask
   ≤ 0.9 × only with P-ARM's port. Matters: the CPU-bound regime is where M2 found the gain. Inputs: the phone
   session's tooling (RUNNER-AUTO), the phone run's link profile (row LINK-CALIBRATION). Rule: the iOS stage
   (`docs/native/quic.md` N3) runs only if M4 shows a gain the browser lacks.
5. **M1 and M2 on a GPU desktop** (the owner's machine): the first numbers that are not software rendering; the
   painter's exactness on a GPU (Vulkan says the unorm conversion *should* round to nearest).
6. **PRs #277 (parity: browser display controls, product cine) and #278 (the window timed against the browser, an
   interim run)**, on `claude/core-fold-2026-10-30`, not folded, unreviewed as product; **#211** (step 1's lab check
   behind the relay, on `claude/native-core-2`). Merge onto the line or close: the owner's
   (`claude/merge-plan:docs/reviews/merge-plan.md` §4.2; the inventory's *unsure*). A review row could state what
   each still holds against the tip.
7. **`docs/native/README.md` §7's open decisions**: the cache's policy (persistent or none; budget; iOS protection
   class), the intended use (diagnostic display or display only), distribution (stores or hospital channels). The
   owner's, with a regulatory specialist for intended use.
8. **Seen, not traced**: in a `view` cine run with `--check` each frame was decoded twice (a want sent while a frame is
   between decoder and view); a failed cache write still marks the frame written. Theory first, then a failing test.
9. **Transport rows** in `docs/native/quic.md` §6: N2 NATIVEWT (which native clients reach the server) and N3
   APPLERECV (macOS receive path; no Apple hardware here). N1 RECVCOST is measured.

## 5. Unsupervised

An agent may, without the owner: write theory and pre-registered protocols (item 3's runner, item 4's amendment for
the phone, item 8's trace); build as one branch and one draft PR per question, from `main` once it holds the core
design, a failing test first and mutated, the gate green with its native steps run where lavapipe and Xvfb install
(say so when skipped); run NATIVERUN in cloud containers within the fixtures above, the protocol written by another
session; inventory item 1 and prepare its move as a draft PR; review #277, #278 and #211 against the tip as findings.

Waits for the owner: any merge; any removal (item 1's settings, item 2, #277/#278/#211 closed); §7's decisions;
any change to §3 (a toolkit, a transport choice); anything structural (the crate's workspace membership, the lab
workspace split of [`coordination.md`](coordination.md) §Open 6). Phone and GPU runs are on the owner's devices.

## 6. Pointers

`docs/native/` (`README.md` §§2–8, the view-worker design, §Built for NATIVERUN; `quic.md`; `quic-compared.md`),
`docs/WIRE.md` §The raw QUIC mapping, `docs/glossary.md` (native cache, paint thread, credit, hop, `wt-pacs/1`),
`lab/window-harness`, `scripts/gate.sh`'s native steps, `README.md` §Prerequisites (lavapipe, Xvfb);
`claude/demo-clean:docs/reviews/experiments-off.md` item 10, `claude/demo-pre-main-review:docs/reviews/pre-main.md` §4,
`claude/merge-plan:docs/reviews/merge-plan.md` §4, `claude/lines-ready:docs/reviews/lines-ready.md` §7;
PRs 367, 250, 277, 278, 211.
