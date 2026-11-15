# Amended shard 2, measured

*2026-11-05, shard 2 of 4, run by a session given only the amended protocol; §F's command as written, on `fb6e522a`.
Its protocol: [`profile-carriers.md`](../../../../../docs/av1/profile-carriers.md) §Profile carriers protocol, amended. Numbers only; the collector pools the shards and applies §D.*

1. **Run:** `SHARD=2 ROUNDS_PER_SHARD=24 BUDGET_S=16200 run.sh tools amended-content amended-mutate amended-rounds`,
   01:17:30–04:36:15 UTC: rounds 24–47, every block whole, then nothing else.
2. **Shows:** the content equals the pin; `amended_test.py` 31/31; `mutate_amended.py`'s 12 breaks each caught; each
   browser mutation fails its own check and leaves the others whole; 24 rounds × 12 blocks, no `VOID`, every check
   passed (43 968 exact frames, 80 784 lossy frames).
3. **Rests on:** `dbts_a1`, `dbts_b1` and `dbts_c1` only, on the host below, at 1×.
4. **Left:** the pooling of the four shards and §D, by the collector.
5. **Not here:** a verdict. The `amended.py` output in the shard's `.md` is a check on 24 rounds, not read.

Terms are those of §Terms, for this section. A **check** compares a decoded frame with its truth: an exact frame's
truth is the SHA-256 of its source samples, a lossy frame's native dav1d's hash, both written by `sweep.py code`. A
**mutation** breaks one input on purpose, for one round of block k 8 of `dbts_a1`, to show that a check sees it.
**`VOID`** is a block past 15 min, or one whose browser failed; **n** is the rounds a block holds.

## Host and saturation

4 cores of an Intel Xeon Processor @ 2.10 GHz, one thread a core (`lscpu`), 15.7 GiB (`free`). Headless Chrome for
Testing 153.0.8010.12, playwright 1.63.0, node 22.23.4. It is the pilot's host model.

`vmstat 30` ran beside the shard, its only addition. Over the rounds (336 samples) the whole host was 28 % busy at
the median (95th percentile 30 %, max 31 %), about one core of four, run queue 1.2 on average. The host does not
saturate in any arm; `sweep.py code`, before the rounds, reached 70–99 %. Nothing is claimed past one decode in
flight at 1×.

## Steps, wall

| step | wall | what it printed |
| --- | --: | --- |
| `tools` | about 1 min | built by this session's earlier `tools` (below), reused |
| `amended-content` | 26.7 min | make_frames 252 s; `shapes.py` 90 s, the k = 8 stream equal to `svc-shapes.tsv` (the `diff` printed nothing); `sweep.py code` 1 256 s, no unit differing from the pin, the native chain checks passed (it did not stop) |
| `amended-mutate` | 2.1 min | below |
| `amended-rounds` | 168.7 min | 24 rounds of 6.6–7.5 min; no budget stop |

The three indexes `sweep.py code` wrote are byte-identical to
[`amended-shard-1.index.*.json`](./). Every exact truth in them (56 + 50 + 69)
equals the SHA-256 of its frame's `lab/av1/data/<volume>/NNN.raw` and that frame's `.sha256`, recomputed after the run.

## n and VOID

| volume | k 1 | k 4 | k 8 | k 16 |
| --- | --: | --: | --: | --: |
| `dbts_a1` | 24 | 24 | 24 | 24 |
| `dbts_b1` | 24 | 24 | 24 | 24 |
| `dbts_c1` | 24 | 24 | 24 | 24 |

`VOID` 0, `error` 0, a failed check 0, over 17 424 rows:
[`amended-shard-2.jsonl`](amended-shard-2.jsonl). Every block's A/A
interval contains 0 and no arm is flagged by order, on this shard's rows alone
([`amended-shard-2.md`](amended-shard-2.md); not read).

## Mutations (round 0, block k 8, `dbts_a1`)

`amended_test.py`: 31/31. `mutate_amended.py`: each of 12 breaks caught. Browser, passed/total per (arm, op, check);
the cines hold 56 frames, the jumps, exacts, residuals and nexts 8, each control 56.

| mutation | expected (*derived* from `amended.js`, `ask.js`) | `dbts_a1` |
| --- | --- | --- |
| `sample` | every check fails | 0 passed, in every row |
| `truth` | every check fails | 0 passed, in every row |
| `offset` | `sep-g8` residual and next fail; all else whole | residual 0/8, next 0/8; all else all passed |
| `skip` | asks starting one unit late fail, on both carriers | `lay-k8` and `sep-g8` arms end `Error: dav1d: -28`, so no value; `ctrl` 56/56, `ctrl-aa` 56/56 |
| `low` | `lay-k8` exact and next fail (12 bits) | `lay-k8` exact 0/8, next 0/8; all else all passed |
| `dwell` | next fails, on both carriers | `lay-k8` next 0/8, `sep-g8` next 0/8; all else all passed |

Under `skip` an error ends the whole arm, so its cines leave no row: the break is seen, whether the cines stayed whole
is not. The outcome equals the pilot's on `dbts_a1`, (arm, op, check) for (arm, op, check)
([`amended-pilot.mutations.jsonl`](amended-pilot.mutations.jsonl)). What −28 means in dav1d is *unverified*. No mutation missed its own check or broke another's, so the shard went
on to rounds. Rows:
[`amended-shard-2.mutations.jsonl`](amended-shard-2.mutations.jsonl).

## What differed from §F (environment, not protocol)

* `meson` was absent; installed with pip (1.9.1, README's version). `numpy` was absent from the default `python3`
  (3.11); installed (2.4.6, `lab/av1/README.md`'s version) after `tools`' `gen_htj2k_fixtures.sh` printed
  `ModuleNotFoundError` under `|| true`; `ojph_compress` was built all the same (the `test -x` passed).
* Before §F's table existed, this session ran `tools` on `a731ca81` (twice: the first stopped on `meson`). §F's
  command was then run from its start on `fb6e522a`, so `tools` found its outputs present.
* The run's working tree stayed at `fb6e522a`. Rows were committed every 4 min from a second worktree, so no pull
  changed the harness under the rounds (finding 16).

## `amended.py` on this shard's rows alone — a check, not read for any verdict

```bash
python3 lab/av1/delivery/carriers/amended.py lab/av1/delivery/carriers/results/amended-shard-1.index. \
  lab/av1/delivery/carriers/results/amended-shard-2.jsonl
```

rounds 24; VOID blocks 0

| volume · block | A/A: median log (interval), n | A/A | arms flagged by order (p) |
| --- | --- | --- | --- |
| dbts_a1 · k 1 | -0.0098 (-0.0421, 0.0255), 24 | passes | — |
| dbts_a1 · k 4 | +0.0007 (-0.059, 0.087), 24 | passes | — |
| dbts_a1 · k 8 | -0.0022 (-0.0482, 0.0404), 24 | passes | — |
| dbts_a1 · k 16 | +0.0227 (-0.0424, 0.0575), 24 | passes | — |
| dbts_b1 · k 1 | -0.0214 (-0.0341, 0.0037), 24 | passes | — |
| dbts_b1 · k 4 | -0.0052 (-0.0287, 0.0251), 24 | passes | — |
| dbts_b1 · k 8 | +0.0133 (-0.0409, 0.0345), 24 | passes | — |
| dbts_b1 · k 16 | +0.0106 (-0.029, 0.0705), 24 | passes | — |
| dbts_c1 · k 1 | +0.0191 (-0.0229, 0.0406), 24 | passes | — |
| dbts_c1 · k 4 | +0.0064 (-0.0605, 0.0422), 24 | passes | — |
| dbts_c1 · k 8 | -0.0058 (-0.0305, 0.01), 24 | passes | — |
| dbts_c1 · k 16 | -0.0022 (-0.0708, 0.0368), 24 | passes | — |

A/A decided (interval excludes 0) in 0 of 12 readable blocks

### dbts_a1

#### high view, cine playback

| configuration | bytes | cine-high total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 999598 | 113 | 24 |
| lay-k4 | 561444 | 93.1 | 24 |
| lay-k8 | 505513 | 94.7 | 24 |
| lay-k16 | 480587 | 92.7 | 24 |
| sep-g1 | 593980 | 104 | 24 |
| sep-g4 | 374618 | 96.8 | 24 |
| sep-g8 | 350976 | 96 | 24 |
| sep-g16 | 340578 | 99 | 24 |
| sep-g32 | 334779 | 103 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

#### high view, scroll to the next slice

| configuration | bytes | cine-high frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 999598 | 2 | 24 |
| lay-k4 | 561444 | 1.63 | 24 |
| lay-k8 | 505513 | 1.67 | 24 |
| lay-k16 | 480587 | 1.65 | 24 |
| sep-g1 | 593980 | 1.82 | 24 |
| sep-g4 | 374618 | 1.73 | 24 |
| sep-g8 | 350976 | 1.73 | 24 |
| sep-g16 | 340578 | 1.79 | 24 |
| sep-g32 | 334779 | 1.81 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

#### high view, jump to a random slice

| configuration | bytes | jump ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 999598 | 2.21 | 24 |
| lay-k4 | 561444 | 4.85 | 24 |
| lay-k8 | 505513 | 8.45 | 24 |
| lay-k16 | 480587 | 14.8 | 24 |
| sep-g1 | 593980 | 2.09 | 24 |
| sep-g4 | 374618 | 4.63 | 24 |
| sep-g8 | 350976 | 8.32 | 24 |
| sep-g16 | 340578 | 14.8 | 24 |
| sep-g32 | 334779 | 29.4 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: on the frontier; sep-g8: on the frontier; sep-g16: on the frontier; sep-g32: on the frontier

#### exact on request, after a jump

| configuration | bytes | exact cold ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1148067 | 12.3 | 24 |
| lay-k4 | 2301819 | 22 | 24 |
| lay-k8 | 3844438 | 35.6 | 24 |
| lay-k16 | 6632562 | 63.2 | 24 |
| sep-g1 | 1209191 | 3.55 | 24 |
| sep-g4 | 1211395 | 6 | 24 |
| sep-g8 | 1212492 | 9.72 | 24 |
| sep-g16 | 1213667 | 16.6 | 24 |
| sep-g32 | 1212396 | 30.9 | 24 |
| whole | 1213665 | 1.01 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

#### exact on request, dweller, frame i

| configuration | bytes | dwell first ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1148067 | 12.3 | 24 |
| lay-k4 | 2301819 | 22 | 24 |
| lay-k8 | 3844438 | 35.6 | 24 |
| lay-k16 | 6632562 | 63.2 | 24 |
| sep-g1 | 1209191 | 1.42 | 24 |
| sep-g4 | 1211395 | 1.42 | 24 |
| sep-g8 | 1212492 | 1.41 | 24 |
| sep-g16 | 1213667 | 1.36 | 24 |
| sep-g32 | 1212396 | 1.39 | 24 |
| whole | 1213665 | 1.01 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

#### exact on request, dweller, then i + 1

| configuration | bytes | dwell next ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1148067 | 11.4 | 24 |
| lay-k4 | 2301819 | 10.1 | 24 |
| lay-k8 | 3844438 | 10.2 | 24 |
| lay-k16 | 6632562 | 10.1 | 24 |
| sep-g1 | 1209191 | 3.43 | 24 |
| sep-g4 | 1211395 | 3.15 | 24 |
| sep-g8 | 1212492 | 3.17 | 24 |
| sep-g16 | 1213667 | 3.09 | 24 |
| sep-g32 | 1212396 | 3.21 | 24 |
| whole | 1213665 | 1.01 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

#### cheap view, cine playback

| configuration | bytes | cine-cheap total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 55361 | 11.4 | 24 |
| lay-k4 | 21030 | 6.07 | 24 |
| lay-k8 | 14985 | 5.27 | 24 |
| lay-k16 | 12525 | 4.61 | 24 |
| sep-g1 | 33700 | 123 | 24 |
| sep-g4 | 11713 | 50.3 | 24 |
| sep-g8 | 8069 | 39.5 | 24 |
| sep-g16 | 6964 | 35.2 | 24 |
| sep-g32 | 6560 | 31.6 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

#### cheap view, scroll to the next slice

| configuration | bytes | cine-cheap frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 55361 | 0.206 | 24 |
| lay-k4 | 21030 | 0.0834 | 24 |
| lay-k8 | 14985 | 0.0783 | 24 |
| lay-k16 | 12525 | 0.0752 | 24 |
| sep-g1 | 33700 | 2.17 | 24 |
| sep-g4 | 11713 | 0.498 | 24 |
| sep-g8 | 8069 | 0.476 | 24 |
| sep-g16 | 6964 | 0.475 | 24 |
| sep-g32 | 6560 | 0.478 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

**dbts_a1: the layered stream stays a candidate** — on the frontier: lay-k1 (exact on request, after a jump); lay-k1 (exact on request, dweller, frame i); lay-k1 (exact on request, dweller, then i + 1); not read: none

### dbts_b1

#### high view, cine playback

| configuration | bytes | cine-high total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 5260859 | 95.4 | 24 |
| lay-k4 | 3733448 | 80 | 24 |
| lay-k8 | 3540776 | 78.8 | 24 |
| lay-k16 | 3444154 | 77.3 | 24 |
| sep-g1 | 3933823 | 70.5 | 24 |
| sep-g4 | 2988282 | 88.1 | 24 |
| sep-g8 | 2873243 | 94.4 | 24 |
| sep-g16 | 2815195 | 94.1 | 24 |
| sep-g32 | 2783727 | 93.8 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

#### high view, scroll to the next slice

| configuration | bytes | cine-high frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 5260859 | 1.89 | 24 |
| lay-k4 | 3733448 | 1.52 | 24 |
| lay-k8 | 3540776 | 1.52 | 24 |
| lay-k16 | 3444154 | 1.51 | 24 |
| sep-g1 | 3933823 | 1.38 | 24 |
| sep-g4 | 2988282 | 1.78 | 24 |
| sep-g8 | 2873243 | 1.87 | 24 |
| sep-g16 | 2815195 | 1.9 | 24 |
| sep-g32 | 2783727 | 1.86 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

#### high view, jump to a random slice

| configuration | bytes | jump ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 5260859 | 2.02 | 24 |
| lay-k4 | 3733448 | 3.81 | 24 |
| lay-k8 | 3540776 | 7.13 | 24 |
| lay-k16 | 3444154 | 12.4 | 24 |
| sep-g1 | 3933823 | 1.49 | 24 |
| sep-g4 | 2988282 | 4.01 | 24 |
| sep-g8 | 2873243 | 7.88 | 24 |
| sep-g16 | 2815195 | 14.5 | 24 |
| sep-g32 | 2783727 | 25.8 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: on the frontier; sep-g8: on the frontier; sep-g16: on the frontier; sep-g32: on the frontier

#### exact on request, after a jump

| configuration | bytes | exact cold ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1979502 | 6.41 | 24 |
| lay-k4 | 4864780 | 12.5 | 24 |
| lay-k8 | 8712266 | 23.1 | 24 |
| lay-k16 | 16407909 | 39.6 | 24 |
| sep-g1 | 2086410 | 2.92 | 24 |
| sep-g4 | 2086775 | 5.46 | 24 |
| sep-g8 | 2088401 | 9.35 | 24 |
| sep-g16 | 2085900 | 16.1 | 24 |
| sep-g32 | 2084952 | 27.6 | 24 |
| whole | 2149534 | 1.02 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

#### exact on request, dweller, frame i

| configuration | bytes | dwell first ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1979502 | 6.41 | 24 |
| lay-k4 | 4864780 | 12.5 | 24 |
| lay-k8 | 8712266 | 23.1 | 24 |
| lay-k16 | 16407909 | 39.6 | 24 |
| sep-g1 | 2086410 | 1.43 | 24 |
| sep-g4 | 2086775 | 1.48 | 24 |
| sep-g8 | 2088401 | 1.49 | 24 |
| sep-g16 | 2085900 | 1.6 | 24 |
| sep-g32 | 2084952 | 1.7 | 24 |
| whole | 2149534 | 1.02 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier; whole: on the frontier

#### exact on request, dweller, then i + 1

| configuration | bytes | dwell next ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1979502 | 6.15 | 24 |
| lay-k4 | 4864780 | 5.34 | 24 |
| lay-k8 | 8712266 | 5.41 | 24 |
| lay-k16 | 16407909 | 5.33 | 24 |
| sep-g1 | 2086410 | 2.98 | 24 |
| sep-g4 | 2086775 | 3.48 | 24 |
| sep-g8 | 2088401 | 3.56 | 24 |
| sep-g16 | 2085900 | 3.45 | 24 |
| sep-g32 | 2084952 | 3.44 | 24 |
| whole | 2149534 | 1.02 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier; whole: on the frontier

#### cheap view, cine playback

| configuration | bytes | cine-cheap total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 153756 | 5.97 | 24 |
| lay-k4 | 56269 | 3.91 | 24 |
| lay-k8 | 41497 | 3.86 | 24 |
| lay-k16 | 34285 | 3.65 | 24 |
| sep-g1 | 124659 | 137 | 24 |
| sep-g4 | 46071 | 59.5 | 24 |
| sep-g8 | 37661 | 52.1 | 24 |
| sep-g16 | 34423 | 46.5 | 24 |
| sep-g32 | 32072 | 43.9 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

#### cheap view, scroll to the next slice

| configuration | bytes | cine-cheap frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 153756 | 0.116 | 24 |
| lay-k4 | 56269 | 0.063 | 24 |
| lay-k8 | 41497 | 0.0717 | 24 |
| lay-k16 | 34285 | 0.07 | 24 |
| sep-g1 | 124659 | 2.75 | 24 |
| sep-g4 | 46071 | 0.656 | 24 |
| sep-g8 | 37661 | 0.785 | 24 |
| sep-g16 | 34423 | 0.787 | 24 |
| sep-g32 | 32072 | 0.788 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

**dbts_b1: the layered stream stays a candidate** — on the frontier: lay-k16 (high view, cine playback); lay-k16 (high view, scroll to the next slice); lay-k1 (exact on request, after a jump); lay-k1 (exact on request, dweller, frame i); lay-k1 (exact on request, dweller, then i + 1); not read: none

### dbts_c1

#### high view, cine playback

| configuration | bytes | cine-high total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1408340 | 145 | 24 |
| lay-k4 | 805763 | 108 | 24 |
| lay-k8 | 718273 | 99.5 | 24 |
| lay-k16 | 678736 | 105 | 24 |
| sep-g1 | 855349 | 142 | 24 |
| sep-g4 | 560159 | 112 | 24 |
| sep-g8 | 524674 | 112 | 24 |
| sep-g16 | 508311 | 112 | 24 |
| sep-g32 | 502089 | 113 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

#### high view, scroll to the next slice

| configuration | bytes | cine-high frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1408340 | 2.08 | 24 |
| lay-k4 | 805763 | 1.43 | 24 |
| lay-k8 | 718273 | 1.39 | 24 |
| lay-k16 | 678736 | 1.45 | 23 |
| sep-g1 | 855349 | 2 | 24 |
| sep-g4 | 560159 | 1.59 | 24 |
| sep-g8 | 524674 | 1.62 | 24 |
| sep-g16 | 508311 | 1.55 | 24 |
| sep-g32 | 502089 | 1.57 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

#### high view, jump to a random slice

| configuration | bytes | jump ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1408340 | 2.33 | 24 |
| lay-k4 | 805763 | 4.62 | 24 |
| lay-k8 | 718273 | 6.92 | 24 |
| lay-k16 | 678736 | 12.8 | 24 |
| sep-g1 | 855349 | 2.26 | 24 |
| sep-g4 | 560159 | 4.34 | 24 |
| sep-g8 | 524674 | 7.22 | 24 |
| sep-g16 | 508311 | 13.9 | 24 |
| sep-g32 | 502089 | 26.8 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: on the frontier; sep-g8: on the frontier; sep-g16: on the frontier; sep-g32: on the frontier

#### exact on request, after a jump

| configuration | bytes | exact cold ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 968826 | 10.8 | 24 |
| lay-k4 | 1965659 | 18.3 | 24 |
| lay-k8 | 3231693 | 28.1 | 24 |
| lay-k16 | 5780837 | 50.4 | 24 |
| sep-g1 | 1018954 | 3.63 | 24 |
| sep-g4 | 1019171 | 5.87 | 24 |
| sep-g8 | 1019914 | 8.67 | 24 |
| sep-g16 | 1020647 | 15.3 | 24 |
| sep-g32 | 1021025 | 28.3 | 24 |
| whole | 1026553 | 1.02 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

#### exact on request, dweller, frame i

| configuration | bytes | dwell first ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 968826 | 10.8 | 24 |
| lay-k4 | 1965659 | 18.3 | 24 |
| lay-k8 | 3231693 | 28.1 | 24 |
| lay-k16 | 5780837 | 50.4 | 24 |
| sep-g1 | 1018954 | 1.46 | 24 |
| sep-g4 | 1019171 | 1.43 | 24 |
| sep-g8 | 1019914 | 1.45 | 24 |
| sep-g16 | 1020647 | 1.43 | 24 |
| sep-g32 | 1021025 | 1.46 | 24 |
| whole | 1026553 | 1.02 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

#### exact on request, dweller, then i + 1

| configuration | bytes | dwell next ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 968826 | 9.79 | 24 |
| lay-k4 | 1965659 | 9 | 24 |
| lay-k8 | 3231693 | 8.86 | 24 |
| lay-k16 | 5780837 | 8.65 | 24 |
| sep-g1 | 1018954 | 3.56 | 24 |
| sep-g4 | 1019171 | 3.11 | 24 |
| sep-g8 | 1019914 | 3.03 | 24 |
| sep-g16 | 1020647 | 3.07 | 24 |
| sep-g32 | 1021025 | 3.12 | 24 |
| whole | 1026553 | 1.02 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: on the frontier; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

#### cheap view, cine playback

| configuration | bytes | cine-cheap total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 81063 | 15.3 | 24 |
| lay-k4 | 32542 | 7.44 | 24 |
| lay-k8 | 23613 | 6.14 | 24 |
| lay-k16 | 19505 | 5.83 | 24 |
| sep-g1 | 45945 | 159 | 24 |
| sep-g4 | 16689 | 65.8 | 24 |
| sep-g8 | 11614 | 48.6 | 24 |
| sep-g16 | 9591 | 41.7 | 24 |
| sep-g32 | 8740 | 40.8 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

#### cheap view, scroll to the next slice

| configuration | bytes | cine-cheap frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 81063 | 0.206 | 24 |
| lay-k4 | 32542 | 0.0732 | 24 |
| lay-k8 | 23613 | 0.0726 | 24 |
| lay-k16 | 19505 | 0.0741 | 24 |
| sep-g1 | 45945 | 2.28 | 24 |
| sep-g4 | 16689 | 0.491 | 24 |
| sep-g8 | 11614 | 0.449 | 24 |
| sep-g16 | 9591 | 0.461 | 24 |
| sep-g32 | 8740 | 0.506 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: on the frontier; sep-g32: on the frontier

**dbts_c1: the layered stream stays a candidate** — on the frontier: lay-k16 (high view, scroll to the next slice); lay-k1 (exact on request, after a jump); lay-k1 (exact on request, dweller, frame i); lay-k1 (exact on request, dweller, then i + 1); not read: none
