# Two serving cells, and which statistic to quote

Measured 2026-09-10 on the 8-core workstation (`intel_pstate`/`powersave`, NVMe, btrfs on
LUKS, Linux 7.1.13). The study is a bundle of **87 frames of ~41.3 KB**, 3.59 MB total, held
outside the repo. It is small enough to stay in page cache: `miss_rate=0.0` in all 240 runs
below, so nothing here exercises the read path — these are send-path and statistics results.

## The two cells

| cell | ask shape | server path |
| ---- | --------- | ----------- |
| on-demand | `RequestFrame` ×10, depth 1 | `TileReader` |
| fill | `StreamFrames` | `SeqReader`, the sequential reader |

Natural conditions: no eviction, no warm-up pass. The access pattern decides hits and misses,
which is why the miss rate reads 0.0 rather than being forced.

## Serve against session wall

`summary.totals.serve_us` is the sum of per-frame serve spans; the session wall is
`server_sessions[].t_close_us − t_open_us`. Both come from the server's own report — neither is
re-derived here. Same percentile in each row: reading one percentile of the total against
another of the wall means nothing.

| cell | statistic | serve total | session wall | serve / wall |
| ---- | --------- | ----------: | -----------: | -----------: |
| fill | p10 across runs | 13 129 | 14 032 | 0.94 |
| fill | median across runs | 24 149 | 25 375 | 0.95 |
| on-demand | p10 across runs | 322 | 2 982 | 0.11 |
| on-demand | median across runs | 605 | 7 140 | 0.08 |

At depth 1 the serve spans are a ninth of the session, because the wire is idle between asks and
the frame's transmission happens while the client waits — outside the span. In fill the pipe is
always full, so the wait lands inside it. `serve_total ≤ wall` held in 80/80 fill runs (ratio
0.82–0.98).

**This is why a fill frame's `serve_us` reads higher than an on-demand frame's while the work is
the same.** A depth ladder on one interleaved batch, `serve_us` p50 against wall per frame:

| depth | 1 | 2 | 4 | 8 | 87 | fill |
| ----- | -: | -: | -: | -: | -: | ---: |
| `serve_us` p50 (µs) | 15.0 | 23.8 | 48.5 | 43.0 | 156.5 | 139.5 |
| wall per frame (µs) | 276.6 | 229.7 | 223.1 | 226.9 | 221.1 | 196.3 |

`serve_us` climbs 10× while wall per frame falls. Fill lands on the depth-87 rung. The endpoints
hold 10/10 paired within-repeat; the intermediate rungs order correctly only 6/10 and are noise.

## Which statistic survives, and which does not

**The percentiles above are across runs, not inside a run.** Each run reports exactly one
`totals.serve_us`; a cell run 80 times yields 80 totals, and those have a distribution.

Contention only ever makes a run slower, so the low decile measures the server and the median
measures how busy the box was. Across four independent batches of the same cell and binary:

| statistic | spread across batches |
| --------- | --------------------: |
| min | 1.10× |
| **p10** | **1.05×** |
| p25 | 1.28× |
| median | 1.86× |

The same binary on the same cell measured 13 474 µs in one batch and 25 083 µs in another —
1.86× apart with no code change. **Quoting a median from one batch against a median from
another is the sequential-arms error**, and it produced a false 30 %-versus-43 % "improvement"
here before it was caught. Interleave the arms and quote p10, or quote the whole distribution.

`median / p10 = 1.84×` within a cell is run-to-run spread. It says nothing about a single run.

Small cells resist this. A 10-frame cell's `totals.serve_us` is ~300 µs, and its p10 read 270 µs
in one batch and 339 µs in another — 26 % apart. The p10 stability above was established on the
87-frame cell and does not carry to cells an eighth the size.

## `claude/serene-rubin-wakfg7` against `main`

Paired per repeat, arm order reversed each repeat, sign-tested against a fair coin:

| cell | paired median | signs | P(≥k \| null) | verdict |
| ---- | ------------: | ----: | ------------: | ------- |
| on-demand, 10 frames | +13.5 % | 46/80 worse | 0.109 | indistinguishable |
| fill, 87 frames | +9.9 % | 24/40 worse | 0.134 | indistinguishable |
| on-demand, 87 frames | −7.0 % | 15/40 worse | 0.077 | indistinguishable |
| on-demand, 87 frames, `serve_us` p50 | −15.8 % | 12/40 worse | 0.008 | **branch faster** |

**No regression on either cell.** The two short cells lean worse and the long one better; only
the 87-frame p50 clears a sign test, and it favours the branch — consistent with the release
profile, the one change on that branch reaching the on-demand reader. `advise_ahead` is called
from `SeqReader` alone; `TileReader` never calls it, so the fill fix cannot touch this cell.

Neither branch change can show here in any case: the study is fully page-cached, so the fadvise
has nothing to prefetch. Its measured worth is in the cold 250 kB regime — see
[`disk-access/EVIDENCE.md`](disk-access/EVIDENCE.md).

## Re-running

```bash
cargo build --release -p exact-server --bin exact-server --features telemetry
cargo build --release -p disk-access-bench --bin server_ab

# one server process per run, one session per run
WTPACS_TELEMETRY=1 WTPACS_TELEMETRY_PATH=<json> exact-server --stream-mode shared --bind 127.0.0.1 …
server_ab --mode fill --asks 87            # fill cell
server_ab --mode on-demand --depth 1 --asks 10   # on-demand cell
```

Read `summary.totals.serve_us` from each run's JSON and take the percentile **across runs**.
Alternate the arms every repeat; a batch of one arm followed by a batch of the other is not a
comparison.
