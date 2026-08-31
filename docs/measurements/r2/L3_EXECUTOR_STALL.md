# L3 — executor stall: raw before/after

> ⚠️ **Evidence under review — see [`docs/l3-disk-access-evidence-review.md`](../../l3-disk-access-evidence-review.md). The `cold p50` figures below are ~84% warm re-reads (`idx = i % n` over 500 iterations of an 80-frame study); one honest pass measures 22 us, not 349 ns.**

**Branch:** `cursor/l3-executor-stall-bc88` · **Host:** cloud agent container (not the Oracle SP rig)  
**Tool:** `cold-page-bench` · **Study:** `lab/fixtures/frames_250k/frames_250k.sbnd` (80 × 250000 B)  
**Method:** `posix_fadvise(DONTNEED)` cold copy · `iterations=500` · heartbeat 500 µs  
**Stall:** `current_thread` tokio runtime — heartbeat `sleep` vs worker page touches

E3 floor (from the lane brief, prior host):

| frames_250k | p50 | p99 | runtime stall |
| --- | --- | --- | --- |
| warm | 0.86 µs | 1.4 µs | 0 |
| cold | 28 µs | 19 ms | mean 73 µs, max 190 µs |

## This run

| arm | warm p50 | warm p99 | warm hop p50 | cold p50 | cold p99 | cold stall mean | cold stall max | cold stall samples |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **naive** | 260 ns | 324 ns | — | 349 ns | 156 µs | 9570 µs | 9570 µs | 1 |
| **blocking_pretouch** | 119 ns | 185 ns | 9.0 µs | 9.0 µs | 201 µs | 524 µs | 939 µs | 18 |

Raw stdout: see commit / agent artifact `l3-cold-page-bench.txt`.

```
arm=naive
warm_p50_ns=260 warm_p99_ns=324
cold_p50_ns=349 cold_p99_ns=155719
warm_stall_mean_ns=683335 warm_stall_max_ns=683335 warm_stall_samples=1
cold_stall_mean_ns=9570496 cold_stall_max_ns=9570496 cold_stall_samples=1

arm=blocking_pretouch
warm_p50_ns=119 warm_p99_ns=185
warm_hop_p50_ns=9005 warm_hop_p99_ns=255903
cold_p50_ns=8995 cold_p99_ns=200819
warm_stall_mean_ns=536110 warm_stall_max_ns=724882 warm_stall_samples=6
cold_stall_mean_ns=524190 cold_stall_max_ns=939261 cold_stall_samples=18
```

## Diff (naive → blocking_pretouch)

| metric | delta |
| --- | --- |
| cold stall max | 9570 µs → 939 µs |
| cold stall samples during work | 1 → 18 (heartbeat kept firing) |
| warm p50 (`frame_slice` on executor after touch) | 260 ns → 119 ns |
| warm hop p50 (`spawn_blocking` + touch) | n/a → 9.0 µs |

## Notes (raw, not conclusions)

- Naive cold stall produced a single multi-millisecond late wake — the runtime did not service the heartbeat while touching cold pages on the executor thread.
- Blocking arm kept the heartbeat alive (18 samples); cold fault cost remains on the pool (`cold_p50` / `cold_p99` are hop+touch).
- Warm executor `frame_slice` after pre-touch stays sub-µs. End-to-end warm path now also pays `warm_hop` (~9 µs p50 here).
- Absolute µs are not matched to the E3 floor table (different host / stall harness now uses `current_thread` tokio). Compare arms within this run.
