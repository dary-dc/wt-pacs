# Amended shard 1, measured

*The copy of shard 1's section of [`docs/av1/profile-carriers.md`](../../../../../docs/av1/profile-carriers.md); § references are to that file.*

*2026-11-05, shard 1 of 4, run by a session given only the amended protocol; §F's command as written, on `fb6e522a`.
Numbers only; the collector pools the shards and applies §D.*

1. **Run:** `SHARD=1 ROUNDS_PER_SHARD=24 BUDGET_S=16200 run.sh tools amended-content amended-mutate amended-rounds`,
   from 01:17:27 to 04:54:40 UTC (3 h 37 min, under `BUDGET_S`). All 24 rounds assigned (0–23) ran, every block whole.
2. **Shows:** the content equals the pin. `amended_test.py` passes 31/31, and `mutate_amended.py`'s 12 breaks are each
   caught. Each of the six browser mutations fails its own check on all three volumes and leaves the others whole. In
   the rounds, 17 424 rows: every exact frame (43 968) and every lossy frame (80 784) passed its check. No `VOID`, no
   error. All 12 blocks pass the A/A gate.
3. **Rests on:** `dbts_a1`, `dbts_b1` and `dbts_c1` only, on the host below, at 1×.
4. **Left:** nothing in shard 1. The collector pools all four shards.
5. **Not here:** a verdict. Twenty-four rounds is not the n that §F sized.

Terms are those of §Terms, for this section. A **check** compares a decoded frame with its truth. An exact frame's
truth is the fetch's SHA-256 of its samples; a lossy frame's is native dav1d's hash, written by `sweep.py code`. A
**mutation** breaks one input on purpose, for one round of block k 8, to show that a check sees it.

#### Host and saturation

4 cores of an Intel Xeon Processor @ 2.10 GHz, one thread a core (`lscpu`), 15 GB. Headless Chrome for Testing
153.0.8010.12, playwright 1.63.0, node 22. It is the pilot's host model.

A 60 s sample of `/proc/stat` was taken in round 0, its only addition to the run. At 10 s steps the whole host was
26–33 % busy, about one core of four, with load average 1.1–1.3. The host does not saturate in any arm. Nothing is
claimed past one decode in flight at 1×.

#### Steps, wall

| step | wall | what it printed |
| --- | --: | --- |
| `tools` | about 1.5 min | built in this session's earlier `tools` (below), reused |
| `amended-content` | 20.0 min | make_frames 1 s (reused, below); `shapes.py` 106 s, k = 8 stream equal to `svc-shapes.tsv` (the `diff` printed nothing); `sweep.py code` 1 092 s, no unit differing from the pin, the native chain checks passed (it did not stop) |
| `amended-mutate` | 10.4 min | below |
| `amended-rounds` | 185.7 min | 24 rounds of 12 blocks, 7.2–8.2 min a round; no budget stop |

#### Mutations (round 0, block k 8, every volume)

`amended_test.py`: 31/31. `mutate_amended.py`: each of 12 breaks caught. Browser, passed/total per (arm, op, check).
`lay-k8` is the layered arm and `sep-g8` the separate one; `ctrl` and `ctrl-aa` each check every frame.

| mutation | expected (*derived* from `amended.js`, `ask.js`) | `dbts_a1` | `dbts_b1` (10 bits) | `dbts_c1` |
| --- | --- | --- | --- | --- |
| `sample` | every check fails | 0 passed, in every row | 0 passed, in every row | 0 passed, in every row |
| `truth` | every check fails | 0 passed, in every row | 0 passed, in every row | 0 passed, in every row |
| `offset` | `sep-g8` residual and next fail; all else whole | residual 0/8, next 0/8; all else all passed | the same | the same |
| `skip` | asks starting one unit late fail, on both carriers | `lay-k8` and `sep-g8` arms end `Error: dav1d: -28`, so no value; `ctrl` 56/56, `ctrl-aa` 56/56 | the same; 50/50 | the same; 69/69 |
| `low` | `lay-k8` exact and next fail on 12 bits only | `lay-k8` exact 0/8, next 0/8; all else all passed | everything passed (no low bits) | as `dbts_a1` |
| `dwell` | next fails, on both carriers | `lay-k8` next 0/8, `sep-g8` next 0/8; all else all passed | the same | the same |

"All else all passed" means every other row passed: the cines 56/56 (50, 69), the jumps 8/8 and the controls 56/56
(50, 69). Under `skip` an error ends the whole arm, so its cines leave no row: the break is seen, but whether the
cines stayed whole is not. The pilot's `skip` on `dbts_a1` ended the same way
([`amended-pilot.mutations.jsonl`](amended-pilot.mutations.jsonl)). The
error code is printed as it came; what −28 means in dav1d is *unverified*. No mutation missed its own check or broke
another's, so the shard went on to rounds. Rows:
[`amended-shard-1.mutations.jsonl`](amended-shard-1.mutations.jsonl).

#### What differed from §F (environment, not protocol)

* `meson` was absent. It was installed with pip (1.12.1), as in the first run.
* `gen_htj2k_fixtures.sh` printed `ModuleNotFoundError: numpy` under `run.sh`'s `|| true`. `ojph_compress` was built
  all the same: the `test -x` that follows passed.
* Before §F's table existed, this session ran `tools` on `a731ca81` and began `amended-content` there. It stopped
  after `shapes.py`, and §F's command was then run from its start on `fb6e522a`. So `tools` and make_frames found
  their outputs present: both are deterministic, and the stream `diff` and `sweep.py code`'s pin check ran in full.
* The run's working tree stayed at `fb6e522a`, plus this section. Rows are committed from a second worktree, so no
  pull changed the harness under the rounds (finding 16).

#### Rounds (0–23)

These are [`amended-shard-1.jsonl`](amended-shard-1.jsonl): 17 424 rows over
288 blocks (24 rounds × 3 volumes × 4 points), 54 rows a four-arm block and 80 at p = 16.

* Each exact frame's check, against its fetch checksum: 43 968 of 43 968 passed.
* Each lossy frame's check, against native dav1d's hash: 80 784 of 80 784 passed.
* No row is `VOID` or carries an error.
* The indexes the checks read are
  [`amended-shard-1.index.dbts_{a1,b1,c1}.json`](./), as `sweep.py code` wrote
  them.

`amended.py` on this shard's rows alone is in
[`amended-shard-1.md`](amended-shard-1.md). It is printed as a check and
**not read**: n = 24 is not §F's n. Facts of this shard from it:

* **A/A** — the median of log(`ctrl-aa` ÷ `ctrl`) and its 95 % interval, n = 24 in every block. The interval contains 0
  in all 12 blocks, so 0 of 12 fail. Medians run from −0.0136 to +0.0121; the widest interval is `dbts_a1` k 4,
  (−0.0111, 0.0503).
* **Order, flagged** at p < 0.05 ÷ 4 — only in `dbts_b1` block k 8: `lay-k8` (p printed 0.0125) and `sep-g8`
  (0.0085). No other (block, arm) is flagged.

## `amended.py` on shard 1's rows (a check, not read)

```
python3 lab/av1/delivery/carriers/amended.py lab/av1/delivery/carriers/results/amended-shard-1.index. lab/av1/delivery/carriers/results/amended-shard-1.jsonl
```

rounds 24; VOID blocks 0

| volume · block | A/A: median log (interval), n | A/A | arms flagged by order (p) |
| --- | --- | --- | --- |
| dbts_a1 · k 1 | -0.0126 (-0.0231, 0.0153), 24 | passes | — |
| dbts_a1 · k 4 | +0.0021 (-0.0111, 0.0503), 24 | passes | — |
| dbts_a1 · k 8 | -0.0014 (-0.0158, 0.013), 24 | passes | — |
| dbts_a1 · k 16 | -0.0136 (-0.0282, 0.0386), 24 | passes | — |
| dbts_b1 · k 1 | -0.0040 (-0.0294, 0.0082), 24 | passes | — |
| dbts_b1 · k 4 | -0.0005 (-0.0247, 0.0104), 24 | passes | — |
| dbts_b1 · k 8 | -0.0046 (-0.0143, 0.0042), 24 | passes | lay-k8 (0.0125), sep-g8 (0.0085) |
| dbts_b1 · k 16 | -0.0033 (-0.0145, 0.0085), 24 | passes | — |
| dbts_c1 · k 1 | -0.0034 (-0.0203, 0.0289), 24 | passes | — |
| dbts_c1 · k 4 | -0.0003 (-0.0198, 0.0238), 24 | passes | — |
| dbts_c1 · k 8 | -0.0023 (-0.0349, 0.0238), 24 | passes | — |
| dbts_c1 · k 16 | +0.0121 (-0.0128, 0.0424), 24 | passes | — |

A/A decided (interval excludes 0) in 0 of 12 readable blocks

## dbts_a1

### high view, cine playback

| configuration | bytes | cine-high total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 999598 | 116 | 24 |
| lay-k4 | 561444 | 103 | 24 |
| lay-k8 | 505513 | 102 | 24 |
| lay-k16 | 480587 | 100 | 24 |
| sep-g1 | 593980 | 104 | 24 |
| sep-g4 | 374618 | 96 | 24 |
| sep-g8 | 350976 | 99.9 | 24 |
| sep-g16 | 340578 | 102 | 24 |
| sep-g32 | 334779 | 105 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

### high view, scroll to the next slice

| configuration | bytes | cine-high frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 999598 | 2 | 24 |
| lay-k4 | 561444 | 1.78 | 24 |
| lay-k8 | 505513 | 1.77 | 24 |
| lay-k16 | 480587 | 1.76 | 24 |
| sep-g1 | 593980 | 1.79 | 24 |
| sep-g4 | 374618 | 1.75 | 24 |
| sep-g8 | 350976 | 1.77 | 24 |
| sep-g16 | 340578 | 1.82 | 24 |
| sep-g32 | 334779 | 1.84 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

### high view, jump to a random slice

| configuration | bytes | jump ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 999598 | 2.16 | 24 |
| lay-k4 | 561444 | 4.87 | 24 |
| lay-k8 | 505513 | 8.53 | 24 |
| lay-k16 | 480587 | 14.3 | 24 |
| sep-g1 | 593980 | 2 | 24 |
| sep-g4 | 374618 | 4.6 | 24 |
| sep-g8 | 350976 | 8.2 | 24 |
| sep-g16 | 340578 | 14.7 | 24 |
| sep-g32 | 334779 | 26.1 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: on the frontier; sep-g8: on the frontier; sep-g16: on the frontier; sep-g32: on the frontier

### exact on request, after a jump

| configuration | bytes | exact cold ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1148067 | 12 | 24 |
| lay-k4 | 2301819 | 21.8 | 24 |
| lay-k8 | 3844438 | 35.8 | 24 |
| lay-k16 | 6632562 | 57.8 | 24 |
| sep-g1 | 1209191 | 3.42 | 24 |
| sep-g4 | 1211395 | 6.03 | 24 |
| sep-g8 | 1212492 | 9.69 | 24 |
| sep-g16 | 1213667 | 16.1 | 24 |
| sep-g32 | 1212396 | 27.5 | 24 |
| whole | 1213665 | 1.01 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

### exact on request, dweller, frame i

| configuration | bytes | dwell first ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1148067 | 12 | 24 |
| lay-k4 | 2301819 | 21.8 | 24 |
| lay-k8 | 3844438 | 35.8 | 24 |
| lay-k16 | 6632562 | 57.8 | 24 |
| sep-g1 | 1209191 | 1.4 | 24 |
| sep-g4 | 1211395 | 1.45 | 24 |
| sep-g8 | 1212492 | 1.45 | 24 |
| sep-g16 | 1213667 | 1.38 | 24 |
| sep-g32 | 1212396 | 1.37 | 24 |
| whole | 1213665 | 1.01 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

### exact on request, dweller, then i + 1

| configuration | bytes | dwell next ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1148067 | 11.1 | 24 |
| lay-k4 | 2301819 | 10.8 | 24 |
| lay-k8 | 3844438 | 11 | 24 |
| lay-k16 | 6632562 | 10.7 | 24 |
| sep-g1 | 1209191 | 3.29 | 24 |
| sep-g4 | 1211395 | 3.19 | 24 |
| sep-g8 | 1212492 | 3.22 | 24 |
| sep-g16 | 1213667 | 3.19 | 24 |
| sep-g32 | 1212396 | 3.3 | 24 |
| whole | 1213665 | 1.01 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

### cheap view, cine playback

| configuration | bytes | cine-cheap total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 55361 | 11.3 | 24 |
| lay-k4 | 21030 | 6.04 | 24 |
| lay-k8 | 14985 | 5.1 | 24 |
| lay-k16 | 12525 | 4.87 | 24 |
| sep-g1 | 33700 | 121 | 24 |
| sep-g4 | 11713 | 49.3 | 24 |
| sep-g8 | 8069 | 39.4 | 24 |
| sep-g16 | 6964 | 34.8 | 24 |
| sep-g32 | 6560 | 32.4 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

### cheap view, scroll to the next slice

| configuration | bytes | cine-cheap frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 55361 | 0.196 | 24 |
| lay-k4 | 21030 | 0.0828 | 24 |
| lay-k8 | 14985 | 0.0761 | 24 |
| lay-k16 | 12525 | 0.0774 | 24 |
| sep-g1 | 33700 | 2.08 | 24 |
| sep-g4 | 11713 | 0.499 | 24 |
| sep-g8 | 8069 | 0.468 | 24 |
| sep-g16 | 6964 | 0.472 | 24 |
| sep-g32 | 6560 | 0.493 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: on the frontier; sep-g32: on the frontier

**dbts_a1: the layered stream stays a candidate** — on the frontier: lay-k1 (exact on request, after a jump); lay-k1 (exact on request, dweller, frame i); lay-k1 (exact on request, dweller, then i + 1); not read: none

## dbts_b1

### high view, cine playback

| configuration | bytes | cine-high total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 5260859 | 97.6 | 24 |
| lay-k4 | 3733448 | 82.5 | 24 |
| lay-k8 | 3540776 | 79.1 | 24 |
| lay-k16 | 3444154 | 79.6 | 24 |
| sep-g1 | 3933823 | 70.4 | 24 |
| sep-g4 | 2988282 | 88.2 | 24 |
| sep-g8 | 2873243 | 91.9 | 24 |
| sep-g16 | 2815195 | 92 | 24 |
| sep-g32 | 2783727 | 92.8 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: not read; lay-k16: not read; sep-g1: not read; sep-g4: not read; sep-g8: not read; sep-g16: dominated; sep-g32: on the frontier

### high view, scroll to the next slice

| configuration | bytes | cine-high frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 5260859 | 1.9 | 24 |
| lay-k4 | 3733448 | 1.54 | 24 |
| lay-k8 | 3540776 | 1.5 | 24 |
| lay-k16 | 3444154 | 1.51 | 24 |
| sep-g1 | 3933823 | 1.36 | 24 |
| sep-g4 | 2988282 | 1.79 | 24 |
| sep-g8 | 2873243 | 1.84 | 24 |
| sep-g16 | 2815195 | 1.81 | 24 |
| sep-g32 | 2783727 | 1.83 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: not read; lay-k16: not read; sep-g1: not read; sep-g4: dominated; sep-g8: not read; sep-g16: dominated; sep-g32: on the frontier

### high view, jump to a random slice

| configuration | bytes | jump ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 5260859 | 2.06 | 24 |
| lay-k4 | 3733448 | 3.91 | 24 |
| lay-k8 | 3540776 | 7.01 | 24 |
| lay-k16 | 3444154 | 12.6 | 24 |
| sep-g1 | 3933823 | 1.51 | 24 |
| sep-g4 | 2988282 | 3.87 | 24 |
| sep-g8 | 2873243 | 7.75 | 24 |
| sep-g16 | 2815195 | 14.6 | 24 |
| sep-g32 | 2783727 | 25.4 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: not read; lay-k16: dominated; sep-g1: not read; sep-g4: not read; sep-g8: not read; sep-g16: on the frontier; sep-g32: on the frontier

### exact on request, after a jump

| configuration | bytes | exact cold ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1979502 | 6.49 | 24 |
| lay-k4 | 4864780 | 12.5 | 24 |
| lay-k8 | 8712266 | 22.6 | 24 |
| lay-k16 | 16407909 | 42.1 | 24 |
| sep-g1 | 2086410 | 2.97 | 24 |
| sep-g4 | 2086775 | 5.33 | 24 |
| sep-g8 | 2088401 | 9.16 | 24 |
| sep-g16 | 2085900 | 16.4 | 24 |
| sep-g32 | 2084952 | 27.2 | 24 |
| whole | 2149534 | 1.03 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: not read; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: not read; sep-g16: dominated; sep-g32: dominated; whole: not read

### exact on request, dweller, frame i

| configuration | bytes | dwell first ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1979502 | 6.49 | 24 |
| lay-k4 | 4864780 | 12.5 | 24 |
| lay-k8 | 8712266 | 22.6 | 24 |
| lay-k16 | 16407909 | 42.1 | 24 |
| sep-g1 | 2086410 | 1.44 | 24 |
| sep-g4 | 2086775 | 1.45 | 24 |
| sep-g8 | 2088401 | 1.41 | 24 |
| sep-g16 | 2085900 | 1.43 | 24 |
| sep-g32 | 2084952 | 1.48 | 24 |
| whole | 2149534 | 1.03 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: not read; lay-k16: dominated; sep-g1: dominated; sep-g4: dominated; sep-g8: not read; sep-g16: dominated; sep-g32: on the frontier; whole: not read

### exact on request, dweller, then i + 1

| configuration | bytes | dwell next ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1979502 | 6.27 | 24 |
| lay-k4 | 4864780 | 5.47 | 24 |
| lay-k8 | 8712266 | 5.44 | 24 |
| lay-k16 | 16407909 | 5.31 | 24 |
| sep-g1 | 2086410 | 2.94 | 24 |
| sep-g4 | 2086775 | 3.71 | 24 |
| sep-g8 | 2088401 | 3.4 | 24 |
| sep-g16 | 2085900 | 3.36 | 24 |
| sep-g32 | 2084952 | 3.32 | 24 |
| whole | 2149534 | 1.02 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: not read; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: not read; sep-g16: dominated; sep-g32: on the frontier; whole: not read

### cheap view, cine playback

| configuration | bytes | cine-cheap total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 153756 | 5.84 | 24 |
| lay-k4 | 56269 | 3.74 | 24 |
| lay-k8 | 41497 | 3.55 | 24 |
| lay-k16 | 34285 | 3.67 | 24 |
| sep-g1 | 124659 | 139 | 24 |
| sep-g4 | 46071 | 58.2 | 24 |
| sep-g8 | 37661 | 49 | 24 |
| sep-g16 | 34423 | 44.2 | 24 |
| sep-g32 | 32072 | 41.4 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: not read; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: not read; sep-g16: dominated; sep-g32: on the frontier

### cheap view, scroll to the next slice

| configuration | bytes | cine-cheap frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 153756 | 0.114 | 24 |
| lay-k4 | 56269 | 0.0612 | 24 |
| lay-k8 | 41497 | 0.0647 | 24 |
| lay-k16 | 34285 | 0.0681 | 24 |
| sep-g1 | 124659 | 2.69 | 24 |
| sep-g4 | 46071 | 0.621 | 24 |
| sep-g8 | 37661 | 0.707 | 24 |
| sep-g16 | 34423 | 0.736 | 24 |
| sep-g32 | 32072 | 0.759 | 24 |

lay-k1: dominated; lay-k4: not read; lay-k8: not read; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: not read; sep-g16: dominated; sep-g32: on the frontier

**dbts_b1: the layered stream stays a candidate** — on the frontier: lay-k1 (exact on request, after a jump); lay-k1 (exact on request, dweller, frame i); lay-k1 (exact on request, dweller, then i + 1); not read: lay-k8 (high view, cine playback); lay-k16 (high view, cine playback); lay-k8 (high view, scroll to the next slice); lay-k16 (high view, scroll to the next slice); lay-k8 (high view, jump to a random slice); lay-k8 (exact on request, after a jump); lay-k8 (exact on request, dweller, frame i); lay-k8 (exact on request, dweller, then i + 1)

## dbts_c1

### high view, cine playback

| configuration | bytes | cine-high total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1408340 | 150 | 24 |
| lay-k4 | 805763 | 116 | 24 |
| lay-k8 | 718273 | 110 | 24 |
| lay-k16 | 678736 | 112 | 24 |
| sep-g1 | 855349 | 140 | 24 |
| sep-g4 | 560159 | 118 | 24 |
| sep-g8 | 524674 | 115 | 24 |
| sep-g16 | 508311 | 113 | 24 |
| sep-g32 | 502089 | 114 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

### high view, scroll to the next slice

| configuration | bytes | cine-high frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1408340 | 2.13 | 24 |
| lay-k4 | 805763 | 1.5 | 24 |
| lay-k8 | 718273 | 1.5 | 24 |
| lay-k16 | 678736 | 1.53 | 23 |
| sep-g1 | 855349 | 2 | 24 |
| sep-g4 | 560159 | 1.67 | 24 |
| sep-g8 | 524674 | 1.64 | 23 |
| sep-g16 | 508311 | 1.62 | 24 |
| sep-g32 | 502089 | 1.62 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

### high view, jump to a random slice

| configuration | bytes | jump ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1408340 | 2.39 | 24 |
| lay-k4 | 805763 | 4.61 | 24 |
| lay-k8 | 718273 | 8.39 | 24 |
| lay-k16 | 678736 | 13.1 | 24 |
| sep-g1 | 855349 | 2.2 | 24 |
| sep-g4 | 560159 | 4.48 | 24 |
| sep-g8 | 524674 | 8.47 | 24 |
| sep-g16 | 508311 | 13.6 | 24 |
| sep-g32 | 502089 | 27.9 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: on the frontier; sep-g8: on the frontier; sep-g16: on the frontier; sep-g32: on the frontier

### exact on request, after a jump

| configuration | bytes | exact cold ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 968826 | 11.2 | 24 |
| lay-k4 | 1965659 | 18.8 | 24 |
| lay-k8 | 3231693 | 31.2 | 24 |
| lay-k16 | 5780837 | 49.5 | 24 |
| sep-g1 | 1018954 | 3.62 | 24 |
| sep-g4 | 1019171 | 6.01 | 24 |
| sep-g8 | 1019914 | 9.92 | 24 |
| sep-g16 | 1020647 | 15.2 | 24 |
| sep-g32 | 1021025 | 29.5 | 24 |
| whole | 1026553 | 1.05 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

### exact on request, dweller, frame i

| configuration | bytes | dwell first ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 968826 | 11.2 | 24 |
| lay-k4 | 1965659 | 18.8 | 24 |
| lay-k8 | 3231693 | 31.2 | 24 |
| lay-k16 | 5780837 | 49.5 | 24 |
| sep-g1 | 1018954 | 1.46 | 24 |
| sep-g4 | 1019171 | 1.5 | 24 |
| sep-g8 | 1019914 | 1.46 | 24 |
| sep-g16 | 1020647 | 1.5 | 24 |
| sep-g32 | 1021025 | 1.48 | 24 |
| whole | 1026553 | 1.05 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

### exact on request, dweller, then i + 1

| configuration | bytes | dwell next ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 968826 | 10.1 | 24 |
| lay-k4 | 1965659 | 9.37 | 24 |
| lay-k8 | 3231693 | 9.21 | 24 |
| lay-k16 | 5780837 | 9.22 | 24 |
| sep-g1 | 1018954 | 3.66 | 24 |
| sep-g4 | 1019171 | 3.25 | 24 |
| sep-g8 | 1019914 | 3.12 | 24 |
| sep-g16 | 1020647 | 3.2 | 24 |
| sep-g32 | 1021025 | 3.14 | 24 |
| whole | 1026553 | 1.04 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: on the frontier; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

### cheap view, cine playback

| configuration | bytes | cine-cheap total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 81063 | 15.1 | 24 |
| lay-k4 | 32542 | 7.52 | 24 |
| lay-k8 | 23613 | 6.26 | 24 |
| lay-k16 | 19505 | 5.73 | 24 |
| sep-g1 | 45945 | 163 | 24 |
| sep-g4 | 16689 | 66.7 | 24 |
| sep-g8 | 11614 | 49 | 24 |
| sep-g16 | 9591 | 42.7 | 24 |
| sep-g32 | 8740 | 40.6 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

### cheap view, scroll to the next slice

| configuration | bytes | cine-cheap frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 81063 | 0.21 | 24 |
| lay-k4 | 32542 | 0.0751 | 24 |
| lay-k8 | 23613 | 0.0722 | 24 |
| lay-k16 | 19505 | 0.0712 | 24 |
| sep-g1 | 45945 | 2.29 | 24 |
| sep-g4 | 16689 | 0.496 | 24 |
| sep-g8 | 11614 | 0.452 | 24 |
| sep-g16 | 9591 | 0.471 | 24 |
| sep-g32 | 8740 | 0.486 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: on the frontier; sep-g32: on the frontier

**dbts_c1: the layered stream stays a candidate** — on the frontier: lay-k16 (high view, scroll to the next slice); lay-k1 (exact on request, after a jump); lay-k1 (exact on request, dweller, frame i); lay-k1 (exact on request, dweller, then i + 1); not read: none
