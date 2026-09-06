# Disk access — how the server reads SBND frame bytes

**Decided.** The read path is settled; what remains is implementing it.

| Doc | What |
| --- | --- |
| [`adr.md`](adr.md) | **The decision.** `RWF_NOWAIT` inline, `spawn_blocking` on the miss — and where it now stands against the campaign that followed |
| [`EVIDENCE.md`](EVIDENCE.md) | **Every number the decision rests on**, in one file: candidates, hosts, risks, what was rejected and why |
| [`IMPLEMENTATION.md`](IMPLEMENTATION.md) | How it becomes product code — the lazy ring, the container trap, why there is no tuning toggle |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | **Read before shipping.** The fast path does not exist on overlayfs, i.e. inside a container, and the server degrades silently. `check-fastpath` answers it in one command |
| [`RERUN.md`](RERUN.md) | The instrument: what it can separate, and the precision rules every number obeys |

The open question is **not** here — it is the disk layout, worth 17.6× against this path's
2–4×: [`../disk-layout/`](../disk-layout/).

## The lab stays on the tip

`lab/disk-access-bench` is a workspace member, not a git-history artifact, and
`lab/scripts/{s5_split,compare_hosts,loop_shape_control}.py` re-derive the tables in
[`EVIDENCE.md`](EVIDENCE.md). The 2026-08-31 decision was wrong partly because re-running its
harness meant restoring a crate from a named commit, and three defects went unnoticed for a
whole campaign as a result.

```bash
NAME=frames_16k_big BYTES=16384 FRAMES=5120 ./lab/scripts/gen_live_cell_fixture.sh
cargo build -p disk-access-bench -p check-fastpath --release
./target/release/read_campaign --help
./target/release/check-fastpath /path/to/studies
```

The raw artifacts kept here are the ones tooling depends on — `compare_hosts.py`'s baseline,
the CI workflow's comparison, and the S5 split. The rest of the campaign's sixty-nine files
are in git; [`EVIDENCE.md`](EVIDENCE.md) says where.
