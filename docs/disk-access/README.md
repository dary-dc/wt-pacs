# Disk access

How the server brings SBND frame bytes in without freezing the Tokio executor.

| Doc | What |
| --- | --- |
| [`adr.md`](adr.md) | Accepted decision (mmap + always-touch; `pread` escape) |
| [`RERUN.md`](RERUN.md) | Fixed-instrument evidence (C1 / C2 / D3) + TSVs here |
| [`later.md`](later.md) | Optional follow-ups only |

## Restore the lab

Tip keeps product surface only. The campaign harness lives in git history.

**Preferred restore** (lab owns rejected helpers — mincore / WILLNEED — so it does not need product APIs that were removed):

```bash
git checkout a2a9c67 -- lab/disk-access-bench lab/scripts/run_disk_access_mempressure.sh
# add "lab/disk-access-bench" to Cargo.toml [workspace].members
cargo build -p disk-access-bench --release
```

`a2a9c67` is the last commit that has the lab **and** `rejected_access.rs`. Earlier tips (e.g. `ca94a87`) still have the harness but expect `FrameStore::{frame_pages_resident,advise_frame_willneed}`.

`lab/cold-page-bench` stays on main (E3 / one-pass cold). It is not the disk-access campaign harness.
