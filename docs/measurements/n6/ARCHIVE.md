# Archive — N6 WASM vs TypeScript (PR #13)

**Status: archived · `deliver_us` numbers are pre–W1/W2; do not use them for a ship decision.**

PR #13 (`claude/wasm-vs-typescript-perf-7ld2dg`) ran the client-runtime comparison on
2026-09-06. Lab and docs only; no product crate changed. The full tree is on tag
`archive/n6-wasm-vs-ts-2026-09` (tip `55bc79e`), not on this tip.

The plan that commissioned the run is still on `main`:
[`../../client-runtime-experiment-plan.md`](../../client-runtime-experiment-plan.md).

## Still citable

These findings do not depend on the post-run WASM receive-path change (#14 W1/W2):

| Finding | Where on the tag |
| --- | --- |
| The plan’s “extra full-frame copy” mechanism is **not confirmed** — the `deliver` penalty is a fixed per-frame boundary cost, not byte-proportional | report §1 |
| Batch timeout: WASM delivers 80/80; TS loses 29/80 (same constant, different arming point) | report §6 |
| First load: WASM ≈ 30× the bytes of TS | report §1 / §7 |
| User-space `link_shim` (this kernel has no netem) | `lab/scripts/link_shim.py` |

## Stale — do not quote as current

`deliver_us` **+25 to +58 µs per frame** (WASM vs TS) was measured on the pre–W1/W2 receive
path. #14 landed typed reads, cached JS keys, and a right-sized `RecvBuf` after this campaign.
A new N6 on today’s clients is a new campaign, not a re-quote of these cells.

## Recover the full tree

```bash
# report
git show archive/n6-wasm-vs-ts-2026-09:docs/client-runtime-comparison-2026-09-06.md

# cells, TSVs, shim + campaign scripts (scratch tree; do not commit back to main)
git checkout archive/n6-wasm-vs-ts-2026-09 -- \
  docs/client-runtime-comparison-2026-09-06.md \
  docs/measurements/n6 \
  lab/scripts/n6_analyze.py \
  lab/scripts/n6_campaign.py \
  lab/scripts/n6_run_all.sh \
  lab/scripts/link_shim.py \
  lab/scripts/link_shim_check.py
```

Fetch the tag if this clone does not have it: `git fetch origin tag archive/n6-wasm-vs-ts-2026-09`.

| What | Commit |
| --- | --- |
| Branch tip — side-by-side table | `55bc79e` |
| Results and interpretation | `d153b1c` |
| Fill cells sized to the 15 s timeout; void cell kept | `fb080cc` |
| Link drop counts in the controls | `d085263` |
| Reads per frame + transfer filter | `fd5c15f` |
| Harness: shim, campaign driver, analyzer | `25381e8` |

```bash
git show 55bc79e:docs/measurements/n6/n6_summary.tsv
git show 55bc79e:lab/scripts/n6_run_all.sh
```
