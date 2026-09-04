# Disk access

How the server brings SBND frame bytes in without freezing the Tokio executor.

| Doc | What |
| --- | --- |
| [`adr.md`](adr.md) | Accepted decision (`RWF_NOWAIT` streaming; pool only on the miss) |
| [`RERUN.md`](RERUN.md) | Evidence: instrument, cells, TSVs here, and what the instrument cannot see |
| [`later.md`](later.md) | Optional follow-ups only |

## The lab stays on the tip

`lab/disk-access-bench` is a workspace member, not a git-history artifact. The 2026-08-31
decision was wrong partly because re-running its harness meant restoring a crate from a
named commit, and three defects in that harness went unnoticed for a campaign (see
[`RERUN.md`](RERUN.md) §Instrument). Keeping it buildable is what let the 2026-09-04
re-run find them.

It also earns its place as a regression check: every arm reads through the product
`FrameStore`, so the nowait arms time `read_at_nowait` / `read_at_blocking` as shipped
rather than a lab copy of them.

```bash
./lab/scripts/gen_live_cell_fixture.sh          # 320 × 250 KB (~80 MB) primary fixture
cargo build -p disk-access-bench --release
./target/release/disk-access-bench --help
```

`io-uring` is a dependency of **this crate only** — the product does not link it.

Four flags decide whether a result means anything (see [`RERUN.md`](RERUN.md) §Precision):

| Flag | Why |
| --- | --- |
| `--selftest` | Prints the instrument's resolution and overhead. Run it before quoting a number in the hundreds of nanoseconds |
| `--samples <path>` | One row per ask, so percentiles pool across repeats and carry a bootstrap CI instead of resting on the 316th of 319 observations |
| `--monitors 0` | For CPU numbers. The gap monitor is a spin loop and changes the latency it is not measuring — the same warm arm reads 46.9 µs with one monitor and 84.7 µs with none |
| reversed `--arm` order | Before believing any cold ranking. Arms take turns creating their own cold copy, and that alone produced a 34% "win" that reversed with the order |

And one rule: re-running the same configuration moves a median by up to 7%, so a difference
counts only if it beats that **and** reproduces with the same sign.

`lab/cold-page-bench` is the older E3 / one-pass-cold tool; it owns its own copy of the
rejected pre-touch arm and is not part of this campaign.
