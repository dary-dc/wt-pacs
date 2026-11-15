# Profile carriers, amended shard 3

*2026-11-05, shard 3 of 4, run by a session given only the amended protocol; §F's command as written, on `fb6e522a`.
Numbers only; the collector pools the shards and applies §D.*

1. **Run:** `SHARD=3 ROUNDS_PER_SHARD=24 BUDGET_S=16200 run.sh tools amended-content amended-mutate amended-rounds`,
   01:17:43–05:16:12 UTC: rounds 48–71, every block whole, then nothing else.
2. **Shows:** the content equals the pin; every check fails under its own mutation and no other; 24 rounds of 12
   blocks, none `VOID`, every exact and lossy frame passing its check.
3. **Rests on:** `dbts_a1`, `dbts_b1`, `dbts_c1` only, on the host below, at 1×.
4. **Left:** pooling with shards 1, 2 and 4, and §D's rule, by the collector. n = 24 here is not the n §F sized.
5. **Not judged here:** nothing in this section, or in its `.md`, is a verdict.

Terms as in this protocol: a **block** is one fresh Chromium running one (volume, sweep point) in one round; an
**arm** is one configuration in it; **`VOID`** a block past 15 min; a **mutation** a deliberate break of one check,
which must turn that check, and only it, to failure.

**Host.** `lscpu`: Intel(R) Xeon(R) Processor @ 2.10GHz, 4 CPUs, 1 thread per core, 1 socket; 15 GiB memory;
Chromium 153.0.8010.12 (Playwright 1.63.0's, headless). **Saturation:** one decode in flight on one thread; load
average 1.24 at one sample in round 49, so one core of four busy. The host did not saturate in any arm, and
nothing is claimed past 1× or for any other host.

**Walls.**

| step | wall |
| --- | --: |
| `tools` + `amended-content` + `amended-mutate` | 28.7 min (01:17:43–01:46:23) |
| of which `sweep.py code` | 22.6 min (1356 s) |
| of which the shipped payload / the k = 8 stream | 1 s (reused, below) / 122 s |
| `amended-rounds`, 24 rounds | 209.8 min; a round 8.0–9.5 min, median 8.7 |
| **total** | **238.5 min**, under the 270 of `BUDGET_S`; no round stopped by the budget |

**n and `VOID`.** 24 rounds (48–71), 288 blocks, 17 424 rows; `VOID` 0, errors 0. Checks: 43 968 exact frames,
each against the SHA-256 the index holds, 43 968 passed; 80 784 lossy frames against native dav1d's hash, 80 784
passed. Apart from the harness, the index's 175 truth hashes (56 + 50 + 69) were checked here against SHA-256 of
each source `.raw` and against its `.sha256` file: 175 of 175 equal. The three indexes `sweep.py code` wrote are
byte-identical to `results/amended-shard-1.index.dbts_{a1,b1,c1}.json`.

**Mutations.** `amended_test.py` 31/31; `mutate_amended.py` 12 breaks, each caught (30/31 or fewer each). The six
browser mutations, block k 8 of `dbts_a1`, round 0 (`.mutations.jsonl`): the failing (arm, op, check) set of each
is the same as the pilot's, row for row.

| mutation | rows failing | which (arm · op · check) |
| --- | --: | --- |
| `sample` | 54 of 54 | every op of `lay-k8` and `sep-g8`, and `ctrl`, `ctrl-aa` cine-exact |
| `truth` | 54 of 54 | the same as `sample` |
| `offset` | 16 of 54 | `sep-g8` residual · exact (8), next · exact (8) |
| `skip` | 2 of 4 | `lay-k8`, `sep-g8`: decode error `dav1d: -28`, the block stops there |
| `low` | 16 of 54 | `lay-k8` exact · exact (8), next · exact (8) |
| `dwell` | 16 of 54 | `lay-k8` next · exact (8), `sep-g8` next · exact (8) |

**The check on its own rows** (below,
not read): A/A passes in 12 of 12 blocks, its median log ratio −0.0097 … +0.0051; one arm flagged by order,
`ctrl` in `dbts_b1` · k 16 (p 0.0085).

**Differed from this section.**

* Before §F was pushed, this session ran `tools` and part of `amended-content` on `589f1c11`, then stopped them and
  ran §F's command from the start on `fb6e522a`. `make_frames.py` (unchanged between the two) found its payload
  already coded and took 1 s; the k = 8 stream was recoded and diffed against `svc-shapes.tsv`, and `sweep.py code`
  recoded and checked every unit.
* meson 1.9.1 (the README's version) was installed with pip; the host had none. Playwright is 1.63.0, not the
  README's 1.56.1.
* `gen_htj2k_fixtures.sh` printed a numpy `ModuleNotFoundError` under `tools`; `run.sh` runs it `|| true` only to
  build `ojph_compress`, whose presence the next line checks.
* Commit `ff801278` (the mutations) has committer `Claude <noreply@anthropic.com>`, set by a `pull --rebase`; it is
  pushed and the branch is not force-pushed. Every later commit's author and committer is `dary-dc`.

## `amended.py` on shard 3's rows alone — a check, not read for any verdict

`python3 lab/av1/delivery/carriers/amended.py lab/.av1-work/amended/ lab/av1/delivery/carriers/results/amended-shard-3.jsonl`, the indexes byte-identical to shard 1's. n = 24 is not the n §F sized.

rounds 24; VOID blocks 0
rounds 24; VOID blocks 0

| volume · block | A/A: median log (interval), n | A/A | arms flagged by order (p) |
| --- | --- | --- | --- |
| dbts_a1 · k 1 | -0.0077 (-0.0221, 0.0063), 24 | passes | — |
| dbts_a1 · k 4 | -0.0097 (-0.0219, 0.0039), 24 | passes | — |
| dbts_a1 · k 8 | -0.0095 (-0.0281, 0.0044), 24 | passes | — |
| dbts_a1 · k 16 | -0.0018 (-0.0294, 0.0124), 24 | passes | — |
| dbts_b1 · k 1 | -0.0071 (-0.0182, 0.0142), 24 | passes | — |
| dbts_b1 · k 4 | +0.0014 (-0.0138, 0.0136), 24 | passes | — |
| dbts_b1 · k 8 | -0.0005 (-0.013, 0.0129), 24 | passes | — |
| dbts_b1 · k 16 | +0.0015 (-0.0169, 0.0159), 24 | passes | ctrl (0.0085) |
| dbts_c1 · k 1 | +0.0027 (-0.009, 0.01), 24 | passes | — |
| dbts_c1 · k 4 | +0.0026 (-0.021, 0.0151), 24 | passes | — |
| dbts_c1 · k 8 | -0.0037 (-0.0142, 0.0103), 24 | passes | — |
| dbts_c1 · k 16 | +0.0051 (-0.0052, 0.017), 24 | passes | — |

A/A decided (interval excludes 0) in 0 of 12 readable blocks

### dbts_a1

#### high view, cine playback

| configuration | bytes | cine-high total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 999598 | 117 | 24 |
| lay-k4 | 561444 | 102 | 24 |
| lay-k8 | 505513 | 98.8 | 24 |
| lay-k16 | 480587 | 98.3 | 24 |
| sep-g1 | 593980 | 104 | 24 |
| sep-g4 | 374618 | 95.2 | 24 |
| sep-g8 | 350976 | 99.5 | 24 |
| sep-g16 | 340578 | 101 | 24 |
| sep-g32 | 334779 | 105 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

#### high view, scroll to the next slice

| configuration | bytes | cine-high frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 999598 | 2.03 | 24 |
| lay-k4 | 561444 | 1.75 | 24 |
| lay-k8 | 505513 | 1.74 | 24 |
| lay-k16 | 480587 | 1.73 | 24 |
| sep-g1 | 593980 | 1.82 | 24 |
| sep-g4 | 374618 | 1.73 | 24 |
| sep-g8 | 350976 | 1.79 | 24 |
| sep-g16 | 340578 | 1.78 | 24 |
| sep-g32 | 334779 | 1.85 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: dominated; sep-g4: on the frontier; sep-g8: dominated; sep-g16: on the frontier; sep-g32: on the frontier

#### high view, jump to a random slice

| configuration | bytes | jump ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 999598 | 2.22 | 24 |
| lay-k4 | 561444 | 4.67 | 24 |
| lay-k8 | 505513 | 7.97 | 24 |
| lay-k16 | 480587 | 14.8 | 24 |
| sep-g1 | 593980 | 2.19 | 24 |
| sep-g4 | 374618 | 4.3 | 24 |
| sep-g8 | 350976 | 7.92 | 24 |
| sep-g16 | 340578 | 15.2 | 24 |
| sep-g32 | 334779 | 28.5 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: on the frontier; sep-g8: on the frontier; sep-g16: on the frontier; sep-g32: on the frontier

#### exact on request, after a jump

| configuration | bytes | exact cold ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1148067 | 12.4 | 24 |
| lay-k4 | 2301819 | 21.2 | 24 |
| lay-k8 | 3844438 | 34.1 | 24 |
| lay-k16 | 6632562 | 61.7 | 24 |
| sep-g1 | 1209191 | 3.65 | 24 |
| sep-g4 | 1211395 | 5.74 | 24 |
| sep-g8 | 1212492 | 9.35 | 24 |
| sep-g16 | 1213667 | 16.6 | 24 |
| sep-g32 | 1212396 | 29.9 | 24 |
| whole | 1213665 | 1.01 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

#### exact on request, dweller, frame i

| configuration | bytes | dwell first ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1148067 | 12.4 | 24 |
| lay-k4 | 2301819 | 21.2 | 24 |
| lay-k8 | 3844438 | 34.1 | 24 |
| lay-k16 | 6632562 | 61.7 | 24 |
| sep-g1 | 1209191 | 1.45 | 24 |
| sep-g4 | 1211395 | 1.41 | 24 |
| sep-g8 | 1212492 | 1.42 | 24 |
| sep-g16 | 1213667 | 1.38 | 24 |
| sep-g32 | 1212396 | 1.38 | 24 |
| whole | 1213665 | 1.01 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

#### exact on request, dweller, then i + 1

| configuration | bytes | dwell next ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1148067 | 11.4 | 24 |
| lay-k4 | 2301819 | 10.8 | 24 |
| lay-k8 | 3844438 | 10.7 | 24 |
| lay-k16 | 6632562 | 10.6 | 24 |
| sep-g1 | 1209191 | 3.4 | 24 |
| sep-g4 | 1211395 | 3.16 | 24 |
| sep-g8 | 1212492 | 3.14 | 24 |
| sep-g16 | 1213667 | 3.19 | 24 |
| sep-g32 | 1212396 | 3.19 | 24 |
| whole | 1213665 | 1 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: on the frontier; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

#### cheap view, cine playback

| configuration | bytes | cine-cheap total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 55361 | 11.3 | 24 |
| lay-k4 | 21030 | 6.28 | 24 |
| lay-k8 | 14985 | 5.23 | 24 |
| lay-k16 | 12525 | 4.86 | 24 |
| sep-g1 | 33700 | 122 | 24 |
| sep-g4 | 11713 | 49 | 24 |
| sep-g8 | 8069 | 38.8 | 24 |
| sep-g16 | 6964 | 33.2 | 24 |
| sep-g32 | 6560 | 29.9 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

#### cheap view, scroll to the next slice

| configuration | bytes | cine-cheap frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 55361 | 0.201 | 24 |
| lay-k4 | 21030 | 0.0846 | 24 |
| lay-k8 | 14985 | 0.0789 | 24 |
| lay-k16 | 12525 | 0.0779 | 24 |
| sep-g1 | 33700 | 2.12 | 24 |
| sep-g4 | 11713 | 0.481 | 24 |
| sep-g8 | 8069 | 0.447 | 24 |
| sep-g16 | 6964 | 0.445 | 24 |
| sep-g32 | 6560 | 0.46 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

**dbts_a1: the layered stream stays a candidate** — on the frontier: lay-k1 (exact on request, after a jump); lay-k1 (exact on request, dweller, frame i); lay-k1 (exact on request, dweller, then i + 1); not read: none

### dbts_b1

#### high view, cine playback

| configuration | bytes | cine-high total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 5260859 | 98 | 24 |
| lay-k4 | 3733448 | 81.7 | 24 |
| lay-k8 | 3540776 | 77.9 | 24 |
| lay-k16 | 3444154 | 78 | 24 |
| sep-g1 | 3933823 | 71.1 | 24 |
| sep-g4 | 2988282 | 87.9 | 24 |
| sep-g8 | 2873243 | 90.6 | 24 |
| sep-g16 | 2815195 | 91.5 | 24 |
| sep-g32 | 2783727 | 93.5 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: not read; lay-k16: not read; sep-g1: not read; sep-g4: not read; sep-g8: not read; sep-g16: not read; sep-g32: on the frontier

#### high view, scroll to the next slice

| configuration | bytes | cine-high frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 5260859 | 1.92 | 24 |
| lay-k4 | 3733448 | 1.51 | 24 |
| lay-k8 | 3540776 | 1.48 | 24 |
| lay-k16 | 3444154 | 1.48 | 24 |
| sep-g1 | 3933823 | 1.36 | 24 |
| sep-g4 | 2988282 | 1.79 | 24 |
| sep-g8 | 2873243 | 1.82 | 24 |
| sep-g16 | 2815195 | 1.83 | 24 |
| sep-g32 | 2783727 | 1.83 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: not read; lay-k16: not read; sep-g1: not read; sep-g4: dominated; sep-g8: not read; sep-g16: not read; sep-g32: on the frontier

#### high view, jump to a random slice

| configuration | bytes | jump ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 5260859 | 2.09 | 24 |
| lay-k4 | 3733448 | 4.39 | 24 |
| lay-k8 | 3540776 | 7.06 | 24 |
| lay-k16 | 3444154 | 13.5 | 24 |
| sep-g1 | 3933823 | 1.52 | 24 |
| sep-g4 | 2988282 | 4.44 | 24 |
| sep-g8 | 2873243 | 8.05 | 24 |
| sep-g16 | 2815195 | 15.8 | 24 |
| sep-g32 | 2783727 | 27.6 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: not read; sep-g1: not read; sep-g4: not read; sep-g8: not read; sep-g16: not read; sep-g32: on the frontier

#### exact on request, after a jump

| configuration | bytes | exact cold ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1979502 | 6.57 | 24 |
| lay-k4 | 4864780 | 14 | 24 |
| lay-k8 | 8712266 | 23.3 | 24 |
| lay-k16 | 16407909 | 44.1 | 24 |
| sep-g1 | 2086410 | 2.99 | 24 |
| sep-g4 | 2086775 | 5.95 | 24 |
| sep-g8 | 2088401 | 9.53 | 24 |
| sep-g16 | 2085900 | 17.3 | 24 |
| sep-g32 | 2084952 | 29 | 24 |
| whole | 2149534 | 1.02 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: not read; sep-g1: not read; sep-g4: dominated; sep-g8: dominated; sep-g16: not read; sep-g32: not read; whole: not read

#### exact on request, dweller, frame i

| configuration | bytes | dwell first ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1979502 | 6.57 | 24 |
| lay-k4 | 4864780 | 14 | 24 |
| lay-k8 | 8712266 | 23.3 | 24 |
| lay-k16 | 16407909 | 44.1 | 24 |
| sep-g1 | 2086410 | 1.43 | 24 |
| sep-g4 | 2086775 | 1.47 | 24 |
| sep-g8 | 2088401 | 1.41 | 24 |
| sep-g16 | 2085900 | 1.42 | 24 |
| sep-g32 | 2084952 | 1.5 | 24 |
| whole | 2149534 | 1.02 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: not read; sep-g1: not read; sep-g4: dominated; sep-g8: dominated; sep-g16: not read; sep-g32: not read; whole: not read

#### exact on request, dweller, then i + 1

| configuration | bytes | dwell next ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1979502 | 6.33 | 24 |
| lay-k4 | 4864780 | 5.56 | 24 |
| lay-k8 | 8712266 | 5.52 | 24 |
| lay-k16 | 16407909 | 5.38 | 24 |
| sep-g1 | 2086410 | 2.97 | 24 |
| sep-g4 | 2086775 | 3.53 | 24 |
| sep-g8 | 2088401 | 3.44 | 24 |
| sep-g16 | 2085900 | 3.32 | 24 |
| sep-g32 | 2084952 | 3.35 | 24 |
| whole | 2149534 | 1.02 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: not read; sep-g1: not read; sep-g4: dominated; sep-g8: dominated; sep-g16: not read; sep-g32: not read; whole: not read

#### cheap view, cine playback

| configuration | bytes | cine-cheap total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 153756 | 5.93 | 24 |
| lay-k4 | 56269 | 3.76 | 24 |
| lay-k8 | 41497 | 3.51 | 24 |
| lay-k16 | 34285 | 3.57 | 24 |
| sep-g1 | 124659 | 141 | 24 |
| sep-g4 | 46071 | 56.4 | 24 |
| sep-g8 | 37661 | 48.3 | 24 |
| sep-g16 | 34423 | 43.4 | 24 |
| sep-g32 | 32072 | 41.1 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: not read; lay-k16: not read; sep-g1: dominated; sep-g4: dominated; sep-g8: not read; sep-g16: not read; sep-g32: on the frontier

#### cheap view, scroll to the next slice

| configuration | bytes | cine-cheap frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 153756 | 0.116 | 24 |
| lay-k4 | 56269 | 0.0616 | 24 |
| lay-k8 | 41497 | 0.0653 | 24 |
| lay-k16 | 34285 | 0.0674 | 24 |
| sep-g1 | 124659 | 2.73 | 24 |
| sep-g4 | 46071 | 0.572 | 24 |
| sep-g8 | 37661 | 0.693 | 24 |
| sep-g16 | 34423 | 0.719 | 24 |
| sep-g32 | 32072 | 0.737 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: not read; lay-k16: not read; sep-g1: dominated; sep-g4: dominated; sep-g8: not read; sep-g16: not read; sep-g32: on the frontier

**dbts_b1: the layered stream stays a candidate** — on the frontier: lay-k1 (exact on request, after a jump); lay-k1 (exact on request, dweller, frame i); lay-k1 (exact on request, dweller, then i + 1); not read: lay-k8 (high view, cine playback); lay-k16 (high view, cine playback); lay-k8 (high view, scroll to the next slice); lay-k16 (high view, scroll to the next slice); lay-k16 (high view, jump to a random slice); lay-k16 (exact on request, after a jump); lay-k16 (exact on request, dweller, frame i); lay-k16 (exact on request, dweller, then i + 1)

### dbts_c1

#### high view, cine playback

| configuration | bytes | cine-high total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1408340 | 153 | 24 |
| lay-k4 | 805763 | 116 | 24 |
| lay-k8 | 718273 | 110 | 24 |
| lay-k16 | 678736 | 106 | 24 |
| sep-g1 | 855349 | 141 | 24 |
| sep-g4 | 560159 | 117 | 24 |
| sep-g8 | 524674 | 113 | 24 |
| sep-g16 | 508311 | 113 | 24 |
| sep-g32 | 502089 | 114 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

#### high view, scroll to the next slice

| configuration | bytes | cine-high frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1408340 | 2.13 | 24 |
| lay-k4 | 805763 | 1.51 | 24 |
| lay-k8 | 718273 | 1.48 | 24 |
| lay-k16 | 678736 | 1.49 | 24 |
| sep-g1 | 855349 | 1.99 | 24 |
| sep-g4 | 560159 | 1.66 | 24 |
| sep-g8 | 524674 | 1.63 | 24 |
| sep-g16 | 508311 | 1.61 | 24 |
| sep-g32 | 502089 | 1.63 | 23 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

#### high view, jump to a random slice

| configuration | bytes | jump ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1408340 | 2.31 | 24 |
| lay-k4 | 805763 | 4.84 | 24 |
| lay-k8 | 718273 | 8.47 | 24 |
| lay-k16 | 678736 | 15.2 | 24 |
| sep-g1 | 855349 | 2.33 | 24 |
| sep-g4 | 560159 | 4.79 | 24 |
| sep-g8 | 524674 | 8.34 | 24 |
| sep-g16 | 508311 | 15.1 | 24 |
| sep-g32 | 502089 | 27.1 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: on the frontier; sep-g8: on the frontier; sep-g16: on the frontier; sep-g32: on the frontier

#### exact on request, after a jump

| configuration | bytes | exact cold ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 968826 | 11.1 | 24 |
| lay-k4 | 1965659 | 20 | 24 |
| lay-k8 | 3231693 | 32.9 | 24 |
| lay-k16 | 5780837 | 57.5 | 24 |
| sep-g1 | 1018954 | 3.79 | 24 |
| sep-g4 | 1019171 | 6.24 | 24 |
| sep-g8 | 1019914 | 9.77 | 24 |
| sep-g16 | 1020647 | 16.5 | 24 |
| sep-g32 | 1021025 | 28.6 | 24 |
| whole | 1026553 | 1.01 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

#### exact on request, dweller, frame i

| configuration | bytes | dwell first ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 968826 | 11.1 | 24 |
| lay-k4 | 1965659 | 20 | 24 |
| lay-k8 | 3231693 | 32.9 | 24 |
| lay-k16 | 5780837 | 57.5 | 24 |
| sep-g1 | 1018954 | 1.5 | 24 |
| sep-g4 | 1019171 | 1.46 | 24 |
| sep-g8 | 1019914 | 1.46 | 24 |
| sep-g16 | 1020647 | 1.45 | 24 |
| sep-g32 | 1021025 | 1.44 | 24 |
| whole | 1026553 | 1.01 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

#### exact on request, dweller, then i + 1

| configuration | bytes | dwell next ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 968826 | 10.1 | 24 |
| lay-k4 | 1965659 | 9.41 | 24 |
| lay-k8 | 3231693 | 9.23 | 24 |
| lay-k16 | 5780837 | 9.31 | 24 |
| sep-g1 | 1018954 | 3.62 | 24 |
| sep-g4 | 1019171 | 3.22 | 24 |
| sep-g8 | 1019914 | 3.2 | 24 |
| sep-g16 | 1020647 | 3.06 | 24 |
| sep-g32 | 1021025 | 3.08 | 24 |
| whole | 1026553 | 1.01 | 24 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: on the frontier; sep-g8: dominated; sep-g16: on the frontier; sep-g32: dominated; whole: on the frontier

#### cheap view, cine playback

| configuration | bytes | cine-cheap total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 81063 | 14.6 | 24 |
| lay-k4 | 32542 | 7.5 | 24 |
| lay-k8 | 23613 | 6.16 | 24 |
| lay-k16 | 19505 | 5.67 | 24 |
| sep-g1 | 45945 | 163 | 24 |
| sep-g4 | 16689 | 66.7 | 24 |
| sep-g8 | 11614 | 48.1 | 24 |
| sep-g16 | 9591 | 40.5 | 24 |
| sep-g32 | 8740 | 40.2 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

#### cheap view, scroll to the next slice

| configuration | bytes | cine-cheap frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 81063 | 0.208 | 24 |
| lay-k4 | 32542 | 0.077 | 24 |
| lay-k8 | 23613 | 0.0721 | 24 |
| lay-k16 | 19505 | 0.0722 | 24 |
| sep-g1 | 45945 | 2.31 | 24 |
| sep-g4 | 16689 | 0.477 | 24 |
| sep-g8 | 11614 | 0.437 | 24 |
| sep-g16 | 9591 | 0.436 | 24 |
| sep-g32 | 8740 | 0.474 | 24 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: on the frontier; sep-g32: on the frontier

**dbts_c1: the layered stream stays a candidate** — on the frontier: lay-k16 (high view, cine playback); lay-k16 (high view, scroll to the next slice); lay-k1 (exact on request, after a jump); lay-k1 (exact on request, dweller, frame i); lay-k1 (exact on request, dweller, then i + 1); not read: none
