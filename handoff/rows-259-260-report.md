# Rows 259 TILEWILLNEED and 260 FILLWINDOW — worker report (2026-10-16)

Both branches are committed and pushed. No PRs were opened. Both branches have `origin/claude/av1-unified-mainbase` at 68ad3264 merged in (rows 255, 256, 257 and 279 included).

| row | branch | head | diff vs unified |
| --- | --- | --- | --- |
| 259 | `claude/wip-259-TILEWILLNEED` | `6a1ab084` | 8 files, +837 / −33 (361 of the added lines are the jsonl rows) |
| 260 | `claude/wip-260-FILLWINDOW` | `b3736596` | 6 files, +747 / −28 (576 of the added lines are the jsonl rows) |

## Verdicts

- **259: not adopted.** The advice cuts misses, but the burst wall ties T0's.
- **260: not adopted.** Wf ties W0 on the cold fill.

Both controls tie, so both runs stand. The results are written up in `docs/adr/disk-access.md` §9, under *Measured (row 259)* and *Measured (row 260)*. Finding 7, finding 8 and the "rows drafted" table are corrected in place.

## Row 259: tile names past the slots (arm T1)

**What was built:**
- `TileReader::advising_past_slots()`. It sends one `WILLNEED` for each name past the slots, once per batch.
- The lab flag `series-server --advise-tile-names`. It is wired through `ServeConfig`, `Sessions` and `ProductPipeline`, and warns at start.
- `server_ab --disjoint` and `--burst N`. These are ported onto row 256's `Session` structure, and `server_ab` now closes its endpoints before exit (see "What is left").
- `lab/disk-access-bench/tile_advice_ab.py` with `make`, `calibrate`, `time` and `summary`.

**Tests, each mutated and seen to fail:**
- The depth-4 control, `at_depth_four_the_tile_advice_arm_is_today_s_reader`. It shows T1 ≡ T0: no advice, and equal stats.
- `at_depth_eight_each_tile_name_past_the_slots_is_advised_once`.
- The pipeline test `the_tile_advice_flag_reaches_the_tile_reader`.

**Mutations (run again after each merge):**
- M1, advice call removed: the depth-8 test and the pipeline test fail.
- M2, names inside the slots advised too: all three fail.
- M3, the once-per-batch check removed: the depth-8 test fails.
- M4, the flag dropped in the pipeline: the pipeline test fails.

The server suite passes: 133 tests on the final merge.

**Measurement:**
- Run under the heavy lock on unified with rows 255–257, 12 rounds.
- T0, T0′ and T1 interleaved by `order.py`.
- Every run on a fresh `writer_bench direct` copy, with 0 pages cached after any copy.
- Strides re-derived on the day: 8 at 16 KiB (97.7 % miss), 2 at 250 kB.
- 115 200 asks, all checked by XXH3, none inexact.

Results at depth 8 (T1 against T0):

| cell | burst wall | misses |
| --- | --- | --- |
| 16 KiB, 1 session | ×0.976 (resolution 48 %) | **×0.634** |
| 16 KiB, 16 sessions | ×1.050 (resolution 33 %) | **×0.713** |
| 250 kB, 1 session | ×0.994 (resolution 19 %) | **×0.910** |
| 250 kB, 16 sessions | ×0.858 (resolution 46 %) | **×0.803** |
| sweep, 1 session | ×1.114 | ×0.803, inside the resolution |
| sweep, 16 sessions | ×1.031 | **×0.861** |
| control (depth 4) | ×0.894–1.014 | ×1.000 |

Bold means beyond the resolution with every round agreeing. CPU per ask ties everywhere (×0.93–1.04).

**Rule:**
- The prediction (×0.75–0.9 of T0's wall at strided depth 8) failed.
- Nothing is worse beyond the resolution, the sweep included.
- The rig's wall resolution of 19–48 % could not have seen the low end of the prediction.

**Saturation:** not swept. 16 sessions at 250 kB move about 0.55 GB/s against about 0.33 GB/s for one session, so those cells are taken as device-bound.

**Earlier runs:**
- A first full 12-round run before the 255–257 merge gave the same verdict. It is in the doc but not used for the numbers.
- A post-257 re-run was slowed by the exit issue below and abandoned after 3 rounds.

## Row 260: the fill window (arm Wf)

**What was built:**
- `FillReader::windowing_two_frames()`, which sets the window to `max(4 MiB, 2 × named frame)`.
- An arm `Wf` in `readahead_bench`.
- A `ROW=260` grid in `lab/container-bench/readahead.py`. It covers `ffdm_d` 4.8 MB, a synthetic 20 × 16 MB set and the `ct_lidc` 164 kB control, with 1 and 4 fills.

**Tests:**
- `at_164_kb_the_two_frame_window_is_today_s_window`, the control: Wf's advice equals W0's.
- `past_2_mib_the_fill_window_is_two_named_frames`. It also pins that W0 restarts a 4 MiB window at every 4.5 MiB frame.

**Mutations:**
- N1, Wf made equal to W0: the large-frame test fails.
- N2, the 4 MiB floor dropped: the control fails.
- N3, the builder sets nothing: the large-frame test fails.

The server suite passes: 132 tests. The rig's `--mutate shift` and `--mutate short` failed every arm.

**Measurement:**
- Run under the heavy lock on unified with rows 256–257, 16 rounds.
- W0, W0aa and Wf interleaved, each measure on a fresh direct copy.
- 702 336 frames checked by XXH3, none inexact.

Results (Wf against W0):
- Cold fill frames/s: ×0.89–1.11.
- Misses: equal. The 16 MB fill misses every frame in both arms.
- First frame: ×0.80–1.12.
- CPU per GB: ×0.94–1.02.
- None of these is beyond the resolution in any cell, and nothing is worse beyond it.
- The control ties on everything.
- Not a rule metric: Wf leaves ×0.74–0.94 the folios per frame at 16 MB, beyond the resolution in three of four cells.

**Saturation:** not swept, and nothing is claimed past these cells.

**Deviation:** the protocol's loop XFS was not run. `mkfs.xfs` is not installed, and the rules forbid installing packages. A loop ext4 (`read_ahead_kb` 2560) stood in, and XFS stays unmeasured.

**Earlier and later runs:**
- A first run before the 256–257 merge was cut at round 13 by a container restart. It showed the same ties and is not used.
- Row 255 merged after the run. It touches how `FillReader` holds its buffers, not `advise` or the window.

## Previous worker's diff (row 259)

Everything was kept:
- The arm and its builder.
- The flag plumbing.
- The three tests.
- `server_ab`'s `--disjoint`, `--burst` and the numeric sort of coded frames, which was needed past frame 999.
- The `tile_advice_ab.py` rig.

What was changed:
- `--burst` became an `Option` all the way through, so walls are reported whenever it is given.
- The wait for session lines went from 10 s to 60 s.
- `server_ab` was ported onto row 256's `Session` refactor at merge.

Nothing was corrupt.

## Gate

`scripts/gate.sh` was run on both final heads (about 485 s each). Every step passed up to `deploy/check_equivalence.sh --local`, which failed with the known nginx 403 environment caveat. Because the gate stops there, the two absence checks were run separately on both branches, and all four passed.

The comment budget is OK on both branches.

## What is left

- **The lab code stays on the branches.** This is `--advise-tile-names` (259) and `windowing_two_frames` (260), with their tests. The owner decides whether to drop it at merge or keep it for a re-run on a quieter host (P0's).
- **XFS is unmeasured for row 260.**
- **A server_ab bug on unified.** Since row 256's `Session` refactor, `server_ab` exits without closing its connections, so the server only writes its session lines at its idle timeout. Branch 259 fixes this by closing its endpoints and `wait_idle` before exit. Other rigs that read session lines on unified would want the same fix.
- **The queue rows still need updating.** `docs/av1/queue.md` rows 259 and 260 were not updated, as the orchestrator does that.
