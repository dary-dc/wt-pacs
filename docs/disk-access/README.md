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

`lab/cold-page-bench` is the older E3 / one-pass-cold tool; it owns its own copy of the
rejected pre-touch arm and is not part of this campaign.
