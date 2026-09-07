# Disk access — how the server reads SBND frame bytes

**Decided.** The read path is settled; what remains is implementing it.

| Doc | What |
| --- | --- |
| [`adr.md`](adr.md) | **The decision.** `RWF_NOWAIT` inline, `spawn_blocking` on the miss — and where it now stands against the campaigns that followed |
| [`EVIDENCE.md`](EVIDENCE.md) | **Every number the decision rests on**, in one file: candidates, hosts, risks, what was rejected and why |
| [`RERUN-miss.md`](RERUN-miss.md) | **How much a miss reads**, measured on a fixture where a miss is a real device read. Independent of who submits it, and the reason `stream_codestream` now escalates. Also why the 80 MB fixture cannot see any of this |
| [`IMPLEMENTATION.md`](IMPLEMENTATION.md) | How it becomes product code — the lazy ring, the container trap, why there is no tuning toggle |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | **Read before shipping.** The fast path does not exist on overlayfs, i.e. inside a container, and the server degrades silently. `check-fastpath` answers it in one command |
| [`RERUN.md`](RERUN.md) | The instrument: what it can separate, and the precision rules every number obeys |
| [`PLAN.md`](PLAN.md) | **What to do next, in order** — validate, close the one open question, implement. Start here if you are picking this up cold |

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
BYTES=250000 FRAMES=32000 NAME=frames_250k_deep ./lab/scripts/gen_live_cell_fixture.sh
cargo build -p disk-access-bench -p check-fastpath --release
./target/release/read_campaign --help
./target/release/check-fastpath /path/to/studies
```

The raw artifacts kept here are the ones tooling depends on — `compare_hosts.py`'s baseline,
the CI workflow's comparison, and the S5 split. The rest of the campaign's sixty-nine files
are in git; [`EVIDENCE.md`](EVIDENCE.md) says where.

## Fixture size is not a detail

**Use the 8 GB `frames_250k_deep` for anything about misses.** An 80 MB fixture fits in the
hypervisor's cache: a guest-cold pass over it runs 442.7 ms once and 31–45 ms every time
after, so a "miss" there costs ~12 µs. Every miss-path effect smaller than that is invisible,
and the 2026-09-04 campaign concluded the accepted path "degrades to the escape hatch, never
below it" on exactly that evidence — on the deep fixture the same comparison is 3.2×
([`RERUN-miss.md`](RERUN-miss.md)).

Two `disk-access-bench` flags exist for the miss cells (see
[`RERUN-miss.md`](RERUN-miss.md) §Instrument), and `lab/scripts/mix_pool.py` pools their
`--mix-samples` into percentiles with bootstrap CIs:

| Flag | Why |
| --- | --- |
| `--mix <f>` | The fraction of frames that must miss, set with `fadvise` and then **verified with `mincore`** — a cell that did not get the residency it asked for aborts instead of reporting under the wrong label |
| `--region-stride <n>` | Frames between the frames a cell asks for. `read_ahead_kb` is 8192 on the lab host, so without a stride past it an evicted region is a read-ahead prefix and not a miss-dominated workload: a fully evicted 256-frame region costs **4** pool round trips, not 256 |

`io-uring` is a dependency of **the lab crate only** — the product does not link it.

`lab/cold-page-bench` is the older E3 / one-pass-cold tool; it owns its own copy of the
rejected pre-touch arm and is not part of this campaign.
