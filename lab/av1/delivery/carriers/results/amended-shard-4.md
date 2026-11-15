# Amended shard 4, measured

*The copy of shard 4's section of [`docs/av1/profile-carriers.md`](../../../../../docs/av1/profile-carriers.md); § references are to that file. Below it, `amended.py` on this shard's rows alone, printed as a check, **not read** for any verdict.*

*2026-11-05, shard 4 of 4, run by a session given only the amended protocol; §F's command as written, on `fb6e522a`.
Numbers only; the collector pools the shards and applies §D.*

1. **Run:** `SHARD=4 ROUNDS_PER_SHARD=24 BUDGET_S=16200 run.sh tools amended-content amended-mutate amended-rounds`,
   from 01:27:20 to 05:48:21 UTC (4 h 21 min). Rounds 72–93 ran, every block whole; `run.sh` printed `stopped after
   round 93: budget`, so 94 and 95 did not run: **n = 22**.
2. **Shows:** the content equals the pin. `amended_test.py` passes 31/31, and `mutate_amended.py`'s 12 breaks are each
   caught. Each of the six browser mutations fails its own check on `dbts_a1` and leaves the others whole. In the
   rounds, 15 972 rows: every exact frame (40 304) and every lossy frame (74 052) passed its check. No `VOID`, no
   error. All 12 blocks pass the A/A gate.
3. **Rests on:** `dbts_a1`, `dbts_b1` and `dbts_c1` only, on the host below, at 1×.
4. **Left:** nothing in shard 4. Rounds 94–95 are missing from the pool; the collector pools what came.
5. **Not here:** a verdict. Twenty-two rounds is not the n that §F sized.

Terms are those of §Terms, for this section. A **check** compares a decoded frame with its truth. An exact frame's
truth is the fetch's SHA-256 of its samples; a lossy frame's is native dav1d's hash, written by `sweep.py code`. A
**mutation** breaks one input on purpose, for one round of block k 8, to show that a check sees it.

#### Host and saturation

4 cores of an Intel Xeon Processor @ 2.80 GHz, one thread a core (`lscpu`), 15 GB. Headless Chromium 153.0.8010.12,
playwright 1.63.0, node 22.23.4. The model string differs from the pilot's (@ 2.10 GHz).

A 70 s sample of `/proc/stat` was taken in round 72, the run's only addition. At 10 s steps the whole host was 26–33 %
busy, about one core of four, with load average 1.0–1.2. The host does not saturate in any arm. Nothing is claimed
past one decode in flight at 1×.

#### Steps, wall

| step | wall | what it printed |
| --- | --: | --- |
| `tools` | about 1.5 min | outputs of this session's earlier `tools` reused (below) |
| `amended-content` | 30.9 min | make_frames 325 s; `shapes.py` 107 s, k = 8 stream equal to `svc-shapes.tsv` (the `diff` printed nothing); `sweep.py code` 1 422 s, no unit differing from the pin, the native chain checks passed (it did not stop) |
| `amended-mutate` | about 4 min | below |
| `amended-rounds` | 3 h 46 min | 22 rounds of 9.6–11.2 min (pilot: 7.1–8.1); blocks 0.4–2.6 min; 264 blocks, 0 failing a check, 0 `VOID` |

#### Exact frames, against their source

Every exact frame of a round is checked in the browser against `truth` in `sweep.py code`'s index. For each volume
that `truth` was compared, after the run, with the SHA-256 of the fetched frame (`lab/av1/data/<volume>/NNN.raw`) and
with the fetch's own `NNN.sha256`: equal for 56/56 (`dbts_a1`), 50/50 (`dbts_b1`), 69/69 (`dbts_c1`). This shard's
three indexes are byte-for-byte shard 1's (`amended-shard-1.index.*.json`).

#### Mutations (round 0, block k 8, `dbts_a1`)

`amended_test.py`: 31/31. `mutate_amended.py`: each of 12 breaks caught. Browser, passed/total per (arm, op, check);
the cines hold 56 frames, the jumps, exacts, residuals and nexts 8, each control 56.

| mutation | expected (*derived* from `amended.js`, `ask.js`) | `dbts_a1` |
| --- | --- | --- |
| `sample` | every check fails | 0 passed, in every row (54) |
| `truth` | every check fails | 0 passed, in every row (54) |
| `offset` | `sep-g8` residual and next fail; all else whole | residual 0/8, next 0/8; all else all passed |
| `skip` | asks starting one unit late fail, on both carriers | `lay-k8` and `sep-g8` arms end `Error: dav1d: -28`, so no value; `ctrl` 56/56, `ctrl-aa` 56/56 |
| `low` | `lay-k8` exact and next fail (12 bits) | `lay-k8` exact 0/8, next 0/8; all else all passed |
| `dwell` | next fails, on both carriers | `lay-k8` next 0/8, `sep-g8` next 0/8; all else all passed |

Under `skip` an error ends the whole arm, so its cines leave no row: the break is seen, whether the cines stayed whole
is not. What −28 means in dav1d is *unverified*. No mutation missed its own check or broke another's, so the shard
went on to rounds. Rows:
[`amended-shard-4.mutations.jsonl`](../../lab/av1/delivery/carriers/results/amended-shard-4.mutations.jsonl); the
rounds' [`amended-shard-4.jsonl`](../../lab/av1/delivery/carriers/results/amended-shard-4.jsonl); `amended.py` on
them alone, a check and **not read**:
[`amended-shard-4.md`](../../lab/av1/delivery/carriers/results/amended-shard-4.md).

#### What differed from §F (environment, not protocol)

* **n = 22, not 24:** each round took 9.6–11.2 min against the pilot's 7.1–8.1, so `BUDGET_S` stopped the shard
  after round 93.
* `meson` was absent; installed with pip (1.9.1, README's version). `gen_htj2k_fixtures.sh` printed
  `ModuleNotFoundError: numpy` under `run.sh`'s `|| true`; `ojph_compress` was built all the same (the `test -x`
  passed).
* Before §F's table existed, this session ran `tools` on `a731ca81` and began `amended-content` there; §F's command
  was then begun on `fb6e522a` and stopped in `sweep.py code` on a stream the earlier, killed run had left truncated
  (`sweep.py` keeps existing outputs). `lab/.av1-work` was deleted and the command run again from its start; that run
  is the one above. `tools` found its outputs present.
* Until 02:03 UTC the rows were committed from the run's own tree, with `git pull --rebase`; from then on,
  from a second worktree. The harness under the run (everything but `results/` and `docs/`) stayed equal to
  `fb6e522a` (finding 16; `git diff fb6e522a HEAD -- lab server client`, results excluded, empty).
* One commit is misnamed: `2f070844` says "rows through round 72" but holds only mutation rows.

## `amended.py` on shard 4's rows alone (a check; not read)

`python3 lab/av1/delivery/carriers/amended.py lab/.av1-work/amended/ lab/av1/delivery/carriers/results/amended-shard-4.jsonl`, the indexes being byte-for-byte `amended-shard-1.index.*.json`:

rounds 22; VOID blocks 0

| volume · block | A/A: median log (interval), n | A/A | arms flagged by order (p) |
| --- | --- | --- | --- |
| dbts_a1 · k 1 | +0.0016 (-0.0052, 0.0122), 22 | passes | — |
| dbts_a1 · k 4 | -0.0008 (-0.0109, 0.0045), 22 | passes | — |
| dbts_a1 · k 8 | -0.0056 (-0.0128, 0.01), 22 | passes | — |
| dbts_a1 · k 16 | -0.0017 (-0.0166, 0.0052), 22 | passes | — |
| dbts_b1 · k 1 | -0.0030 (-0.008, 0.0075), 22 | passes | — |
| dbts_b1 · k 4 | +0.0017 (-0.0051, 0.0083), 22 | passes | — |
| dbts_b1 · k 8 | +0.0029 (-0.0018, 0.0138), 22 | passes | — |
| dbts_b1 · k 16 | +0.0054 (-0.0016, 0.0092), 22 | passes | — |
| dbts_c1 · k 1 | -0.0034 (-0.0125, 0.0043), 22 | passes | — |
| dbts_c1 · k 4 | +0.0026 (-0.0032, 0.0115), 22 | passes | — |
| dbts_c1 · k 8 | +0.0035 (-0.0051, 0.0175), 22 | passes | — |
| dbts_c1 · k 16 | +0.0012 (-0.0064, 0.0133), 22 | passes | — |

A/A decided (interval excludes 0) in 0 of 12 readable blocks

## dbts_a1

### high view, cine playback

| configuration | bytes | cine-high total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 999598 | 118 | 22 |
| lay-k4 | 561444 | 101 | 22 |
| lay-k8 | 505513 | 101 | 22 |
| lay-k16 | 480587 | 102 | 22 |
| sep-g1 | 593980 | 109 | 22 |
| sep-g4 | 374618 | 98.2 | 22 |
| sep-g8 | 350976 | 102 | 22 |
| sep-g16 | 340578 | 105 | 22 |
| sep-g32 | 334779 | 106 | 22 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

### high view, scroll to the next slice

| configuration | bytes | cine-high frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 999598 | 2.06 | 22 |
| lay-k4 | 561444 | 1.78 | 22 |
| lay-k8 | 505513 | 1.78 | 22 |
| lay-k16 | 480587 | 1.77 | 22 |
| sep-g1 | 593980 | 1.89 | 22 |
| sep-g4 | 374618 | 1.79 | 22 |
| sep-g8 | 350976 | 1.82 | 22 |
| sep-g16 | 340578 | 1.84 | 22 |
| sep-g32 | 334779 | 1.89 | 22 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: on the frontier; sep-g32: on the frontier

### high view, jump to a random slice

| configuration | bytes | jump ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 999598 | 2.29 | 22 |
| lay-k4 | 561444 | 5.15 | 22 |
| lay-k8 | 505513 | 8.1 | 22 |
| lay-k16 | 480587 | 15.4 | 22 |
| sep-g1 | 593980 | 2.06 | 22 |
| sep-g4 | 374618 | 4.92 | 22 |
| sep-g8 | 350976 | 7.65 | 22 |
| sep-g16 | 340578 | 15.6 | 22 |
| sep-g32 | 334779 | 30.4 | 22 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: on the frontier; sep-g8: on the frontier; sep-g16: on the frontier; sep-g32: on the frontier

### exact on request, after a jump

| configuration | bytes | exact cold ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1148067 | 11.2 | 22 |
| lay-k4 | 2301819 | 21.8 | 22 |
| lay-k8 | 3844438 | 30.7 | 22 |
| lay-k16 | 6632562 | 56.8 | 22 |
| sep-g1 | 1209191 | 3.45 | 22 |
| sep-g4 | 1211395 | 6.32 | 22 |
| sep-g8 | 1212492 | 9.03 | 22 |
| sep-g16 | 1213667 | 16.9 | 22 |
| sep-g32 | 1212396 | 31.7 | 22 |
| whole | 1213665 | 1 | 22 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

### exact on request, dweller, frame i

| configuration | bytes | dwell first ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1148067 | 11.2 | 22 |
| lay-k4 | 2301819 | 21.8 | 22 |
| lay-k8 | 3844438 | 30.7 | 22 |
| lay-k16 | 6632562 | 56.8 | 22 |
| sep-g1 | 1209191 | 1.37 | 22 |
| sep-g4 | 1211395 | 1.35 | 22 |
| sep-g8 | 1212492 | 1.39 | 22 |
| sep-g16 | 1213667 | 1.31 | 22 |
| sep-g32 | 1212396 | 1.32 | 22 |
| whole | 1213665 | 1 | 22 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

### exact on request, dweller, then i + 1

| configuration | bytes | dwell next ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1148067 | 10.4 | 22 |
| lay-k4 | 2301819 | 9.99 | 22 |
| lay-k8 | 3844438 | 9.88 | 22 |
| lay-k16 | 6632562 | 9.85 | 22 |
| sep-g1 | 1209191 | 3.39 | 22 |
| sep-g4 | 1211395 | 3.24 | 22 |
| sep-g8 | 1212492 | 3.21 | 22 |
| sep-g16 | 1213667 | 3.24 | 22 |
| sep-g32 | 1212396 | 3.26 | 22 |
| whole | 1213665 | 1.02 | 22 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: on the frontier; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

### cheap view, cine playback

| configuration | bytes | cine-cheap total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 55361 | 12.3 | 22 |
| lay-k4 | 21030 | 6.4 | 22 |
| lay-k8 | 14985 | 5.37 | 22 |
| lay-k16 | 12525 | 5.12 | 22 |
| sep-g1 | 33700 | 131 | 22 |
| sep-g4 | 11713 | 51 | 22 |
| sep-g8 | 8069 | 39.7 | 22 |
| sep-g16 | 6964 | 34.5 | 22 |
| sep-g32 | 6560 | 30.7 | 22 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

### cheap view, scroll to the next slice

| configuration | bytes | cine-cheap frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 55361 | 0.215 | 22 |
| lay-k4 | 21030 | 0.0848 | 22 |
| lay-k8 | 14985 | 0.0803 | 22 |
| lay-k16 | 12525 | 0.081 | 22 |
| sep-g1 | 33700 | 2.29 | 22 |
| sep-g4 | 11713 | 0.483 | 22 |
| sep-g8 | 8069 | 0.433 | 22 |
| sep-g16 | 6964 | 0.446 | 22 |
| sep-g32 | 6560 | 0.457 | 22 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: on the frontier; sep-g32: on the frontier

**dbts_a1: the layered stream stays a candidate** — on the frontier: lay-k1 (exact on request, after a jump); lay-k1 (exact on request, dweller, frame i); lay-k1 (exact on request, dweller, then i + 1); not read: none

## dbts_b1

### high view, cine playback

| configuration | bytes | cine-high total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 5260859 | 105 | 22 |
| lay-k4 | 3733448 | 87.6 | 22 |
| lay-k8 | 3540776 | 86.9 | 22 |
| lay-k16 | 3444154 | 84.4 | 22 |
| sep-g1 | 3933823 | 75.2 | 22 |
| sep-g4 | 2988282 | 96.7 | 22 |
| sep-g8 | 2873243 | 100 | 22 |
| sep-g16 | 2815195 | 102 | 22 |
| sep-g32 | 2783727 | 102 | 22 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: on the frontier; sep-g4: on the frontier; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

### high view, scroll to the next slice

| configuration | bytes | cine-high frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 5260859 | 2.07 | 22 |
| lay-k4 | 3733448 | 1.63 | 22 |
| lay-k8 | 3540776 | 1.65 | 22 |
| lay-k16 | 3444154 | 1.62 | 22 |
| sep-g1 | 3933823 | 1.47 | 22 |
| sep-g4 | 2988282 | 1.97 | 22 |
| sep-g8 | 2873243 | 2.03 | 22 |
| sep-g16 | 2815195 | 2.03 | 22 |
| sep-g32 | 2783727 | 2.02 | 22 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: on the frontier; sep-g4: on the frontier; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

### high view, jump to a random slice

| configuration | bytes | jump ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 5260859 | 2.26 | 22 |
| lay-k4 | 3733448 | 4.59 | 22 |
| lay-k8 | 3540776 | 8.68 | 22 |
| lay-k16 | 3444154 | 14.9 | 22 |
| sep-g1 | 3933823 | 1.58 | 22 |
| sep-g4 | 2988282 | 4.58 | 22 |
| sep-g8 | 2873243 | 9.75 | 22 |
| sep-g16 | 2815195 | 16.9 | 22 |
| sep-g32 | 2783727 | 29.8 | 22 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: on the frontier; sep-g8: on the frontier; sep-g16: on the frontier; sep-g32: on the frontier

### exact on request, after a jump

| configuration | bytes | exact cold ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1979502 | 6.8 | 22 |
| lay-k4 | 4864780 | 14.5 | 22 |
| lay-k8 | 8712266 | 27.8 | 22 |
| lay-k16 | 16407909 | 46.5 | 22 |
| sep-g1 | 2086410 | 3.05 | 22 |
| sep-g4 | 2086775 | 6.14 | 22 |
| sep-g8 | 2088401 | 11.2 | 22 |
| sep-g16 | 2085900 | 18.7 | 22 |
| sep-g32 | 2084952 | 31.4 | 22 |
| whole | 2149534 | 1.03 | 22 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

### exact on request, dweller, frame i

| configuration | bytes | dwell first ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1979502 | 6.8 | 22 |
| lay-k4 | 4864780 | 14.5 | 22 |
| lay-k8 | 8712266 | 27.8 | 22 |
| lay-k16 | 16407909 | 46.5 | 22 |
| sep-g1 | 2086410 | 1.45 | 22 |
| sep-g4 | 2086775 | 1.48 | 22 |
| sep-g8 | 2088401 | 1.47 | 22 |
| sep-g16 | 2085900 | 1.61 | 22 |
| sep-g32 | 2084952 | 1.58 | 22 |
| whole | 2149534 | 1.03 | 22 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier; whole: on the frontier

### exact on request, dweller, then i + 1

| configuration | bytes | dwell next ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1979502 | 6.65 | 22 |
| lay-k4 | 4864780 | 5.78 | 22 |
| lay-k8 | 8712266 | 5.64 | 22 |
| lay-k16 | 16407909 | 5.61 | 22 |
| sep-g1 | 2086410 | 3.12 | 22 |
| sep-g4 | 2086775 | 3.62 | 22 |
| sep-g8 | 2088401 | 3.67 | 22 |
| sep-g16 | 2085900 | 3.55 | 22 |
| sep-g32 | 2084952 | 3.53 | 22 |
| whole | 2149534 | 1.01 | 22 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier; whole: on the frontier

### cheap view, cine playback

| configuration | bytes | cine-cheap total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 153756 | 7.02 | 22 |
| lay-k4 | 56269 | 4.39 | 22 |
| lay-k8 | 41497 | 4.17 | 22 |
| lay-k16 | 34285 | 4.16 | 22 |
| sep-g1 | 124659 | 163 | 22 |
| sep-g4 | 46071 | 63.9 | 22 |
| sep-g8 | 37661 | 54.6 | 22 |
| sep-g16 | 34423 | 48.5 | 22 |
| sep-g32 | 32072 | 44.6 | 22 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

### cheap view, scroll to the next slice

| configuration | bytes | cine-cheap frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 153756 | 0.138 | 22 |
| lay-k4 | 56269 | 0.0708 | 22 |
| lay-k8 | 41497 | 0.0757 | 22 |
| lay-k16 | 34285 | 0.0779 | 22 |
| sep-g1 | 124659 | 3.18 | 22 |
| sep-g4 | 46071 | 0.627 | 22 |
| sep-g8 | 37661 | 0.749 | 22 |
| sep-g16 | 34423 | 0.788 | 22 |
| sep-g32 | 32072 | 0.802 | 22 |

lay-k1: dominated; lay-k4: on the frontier; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

**dbts_b1: the layered stream stays a candidate** — on the frontier: lay-k16 (high view, cine playback); lay-k16 (high view, scroll to the next slice); lay-k1 (exact on request, after a jump); lay-k1 (exact on request, dweller, frame i); lay-k1 (exact on request, dweller, then i + 1); not read: none

## dbts_c1

### high view, cine playback

| configuration | bytes | cine-high total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1408340 | 153 | 22 |
| lay-k4 | 805763 | 117 | 22 |
| lay-k8 | 718273 | 113 | 22 |
| lay-k16 | 678736 | 109 | 22 |
| sep-g1 | 855349 | 146 | 22 |
| sep-g4 | 560159 | 117 | 22 |
| sep-g8 | 524674 | 116 | 22 |
| sep-g16 | 508311 | 116 | 22 |
| sep-g32 | 502089 | 114 | 22 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

### high view, scroll to the next slice

| configuration | bytes | cine-high frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1408340 | 2.16 | 22 |
| lay-k4 | 805763 | 1.51 | 22 |
| lay-k8 | 718273 | 1.53 | 22 |
| lay-k16 | 678736 | 1.51 | 22 |
| sep-g1 | 855349 | 2.08 | 22 |
| sep-g4 | 560159 | 1.66 | 22 |
| sep-g8 | 524674 | 1.67 | 22 |
| sep-g16 | 508311 | 1.65 | 22 |
| sep-g32 | 502089 | 1.63 | 22 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

### high view, jump to a random slice

| configuration | bytes | jump ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1408340 | 2.37 | 22 |
| lay-k4 | 805763 | 4.56 | 22 |
| lay-k8 | 718273 | 7.3 | 22 |
| lay-k16 | 678736 | 13.3 | 22 |
| sep-g1 | 855349 | 2.23 | 22 |
| sep-g4 | 560159 | 4.52 | 22 |
| sep-g8 | 524674 | 7.59 | 22 |
| sep-g16 | 508311 | 13.9 | 22 |
| sep-g32 | 502089 | 25.5 | 22 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: on the frontier; sep-g8: on the frontier; sep-g16: on the frontier; sep-g32: on the frontier

### exact on request, after a jump

| configuration | bytes | exact cold ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 968826 | 10 | 22 |
| lay-k4 | 1965659 | 18 | 22 |
| lay-k8 | 3231693 | 27.4 | 22 |
| lay-k16 | 5780837 | 48.7 | 22 |
| sep-g1 | 1018954 | 3.72 | 22 |
| sep-g4 | 1019171 | 5.95 | 22 |
| sep-g8 | 1019914 | 9.02 | 22 |
| sep-g16 | 1020647 | 15.3 | 22 |
| sep-g32 | 1021025 | 26.9 | 22 |
| whole | 1026553 | 1.01 | 22 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

### exact on request, dweller, frame i

| configuration | bytes | dwell first ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 968826 | 10 | 22 |
| lay-k4 | 1965659 | 18 | 22 |
| lay-k8 | 3231693 | 27.4 | 22 |
| lay-k16 | 5780837 | 48.7 | 22 |
| sep-g1 | 1018954 | 1.44 | 22 |
| sep-g4 | 1019171 | 1.42 | 22 |
| sep-g8 | 1019914 | 1.45 | 22 |
| sep-g16 | 1020647 | 1.43 | 22 |
| sep-g32 | 1021025 | 1.37 | 22 |
| whole | 1026553 | 1.01 | 22 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

### exact on request, dweller, then i + 1

| configuration | bytes | dwell next ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 968826 | 9.38 | 22 |
| lay-k4 | 1965659 | 8.47 | 22 |
| lay-k8 | 3231693 | 8.27 | 22 |
| lay-k16 | 5780837 | 8.42 | 22 |
| sep-g1 | 1018954 | 3.59 | 22 |
| sep-g4 | 1019171 | 3.12 | 22 |
| sep-g8 | 1019914 | 3.13 | 22 |
| sep-g16 | 1020647 | 3.05 | 22 |
| sep-g32 | 1021025 | 2.97 | 22 |
| whole | 1026553 | 0.998 | 22 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: on the frontier; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier; whole: on the frontier

### cheap view, cine playback

| configuration | bytes | cine-cheap total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 81063 | 15.5 | 22 |
| lay-k4 | 32542 | 7.86 | 22 |
| lay-k8 | 23613 | 6.59 | 22 |
| lay-k16 | 19505 | 5.92 | 22 |
| sep-g1 | 45945 | 176 | 22 |
| sep-g4 | 16689 | 68.3 | 22 |
| sep-g8 | 11614 | 50.5 | 22 |
| sep-g16 | 9591 | 42 | 22 |
| sep-g32 | 8740 | 40.5 | 22 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

### cheap view, scroll to the next slice

| configuration | bytes | cine-cheap frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 81063 | 0.22 | 22 |
| lay-k4 | 32542 | 0.0776 | 21 |
| lay-k8 | 23613 | 0.0751 | 22 |
| lay-k16 | 19505 | 0.075 | 22 |
| sep-g1 | 45945 | 2.49 | 22 |
| sep-g4 | 16689 | 0.468 | 22 |
| sep-g8 | 11614 | 0.438 | 22 |
| sep-g16 | 9591 | 0.438 | 22 |
| sep-g32 | 8740 | 0.478 | 22 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: on the frontier; sep-g32: on the frontier

**dbts_c1: the layered stream stays a candidate** — on the frontier: lay-k16 (high view, cine playback); lay-k16 (high view, scroll to the next slice); lay-k1 (exact on request, after a jump); lay-k1 (exact on request, dweller, frame i); lay-k1 (exact on request, dweller, then i + 1); not read: none
