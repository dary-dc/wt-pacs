# L2 ask-policy v4 local — loss=0 summary

**Date:** 2026-09-07 · **Branch:** `cursor/l2-harness-fix-plan-c999`  
**What this is:** a fair bake-off on the *reworked* harness. Not a reading of the void v1–v3 rankings.  
**Landing:** lab only (`lab/window-harness`, `lab/scripts/`). Product ask paths were not changed.

Raw TSV and JSON: `.local/l2/v4-local/` (gitignored). Script: `lab/scripts/l2_ask_policy_v4_local.sh`.

## Phase 0 (same tip)

| Check | Result |
| - | - |
| `l2_policy_sim.py --validate` | worst error 1.21 % (pass rule 2 %) |
| `l2_harness_smoke.sh` | 10/10 (G7n negative control fails as designed) |
| `l2_local_crosscheck.sh` | saturated cells within ~1–2 %; jump ordering matches (bulk worst) |

Release `window-harness` was rebuilt on this tip before the runs (the 2026-09-04 binary lacked `--ipv4` / `--prefetch`).

## Grid

| | |
| - | - |
| Where | loopback, LinkPacer 10 Mbps, harness `--rtt-ms` (both halves) |
| Traces | scroll, jump · 40 ms steps (the regime where policy can differ) |
| RTT | 20 / 60 / 150 ms |
| Arms | control · window · adr · bulk · bounded · dynpath · dynclean |
| n | 3, shuffled within each cell |
| Integrity | 126/126 `run_rc=0`, no empty waits, no drain fail, no oscillation, `duplicate_asks=0` |

`adr` = formula `D` + prefetch `D−1`. `window` = same prefetch, unbounded depth. `bounded` = formula `D` + prefetch everything. `dynpath` / `dynclean` = honest estimator inputs (no silent override).

## Median `p95_lateness_ms` (and stranded KB)

### Scroll (nothing abandoned)

| RTT | control | window | adr | bulk | bounded | dynpath | dynclean |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 20 | 47 (0) | 0 (0) | 7 (0) | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 60 | 66 (0) | 0 (0) | 0 (0) | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| 150 | 156 (0) | 86 (0) | 87 (0) | 86 (0) | 86 (0) | 87 (0) | 87 (0) |

Any prefetch that covers `RTT + Tf` removes lateness after warm-up (medians 0 except control). Control pays about one path delay per step. At 150 ms the ~86 ms p95 on the prefetch arms is the warm-up; their medians are 0. Bulk is as good as `adr` here — nothing is thrown away.

### Jump (work is abandoned)

| RTT | control | window | adr | bulk | bounded | dynpath | dynclean |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 20 | 34 (0) | **11** (32) | **10** (32) | 292 (768) | 48 (480) | 10 (32) | 10 (32) |
| 60 | 73 (0) | **51** (96) | **51** (96) | 332 (768) | 90 (480) | 50 (96) | 51 (96) |
| 150 | 178 (0) | **141** (192) | **141** (192) | 423 (768) | 183 (480) | 141 (192) | 140 (192) |

Bulk is the worst policy on every jump cell, by 4–6× on p95, and strands 768 KB. `window` ≈ `adr` ≈ both dynamic arms. `bounded` (cap + look at everything) is worse than `adr` on the jump: the extra lookahead fills the pipe with frames the reader will not want (480 KB stranded) and the landing wait grows with `D`.

Dynamic never beat `adr`. `dynpath` tracked the formula (`D` in `[formula−2, formula]`). `dynclean` held the warm-up value.

## What this decides (lab)

These rows are from the fixed harness. They back the loss-free policy the lab should implement and measure:

1. **On-screen frame at once, forward prefetch `K`, fixed in-flight cap `D`.** `K = D − 1` with `D` from the ADR formula at the cell RTT (the `adr` arm), or simply `D = K` sized to `ceil((RTT + Tf) / step)`. Never wrap.
2. **Not bulk** for any trace that can abandon work. Bulk stays a preload / end-to-end arm only.
3. **Not “cap + prefetch everything.”** That is the `bounded` arm; it loses to `adr` on the jump.
4. **Not dynamic.** Honest `path` and `clean` inputs do not beat `adr`. There is nothing to adapt to at loss 0.

This is **not** an ADR lock and **not** a product diff. Loss is still unpaid — `l2_ask_policy_v4_cloud.sh` (reduced grid at RTT 60 first). Until that runs, `D` under loss is unknown.

## What we will not do on this branch

- Edit `client/transport-ts` or `client/transport-wasm` ask paths.
- Quote v1–v3 arm rankings.
- Run `l2_ask_policy_v3_loss_cloud.sh` as written.
