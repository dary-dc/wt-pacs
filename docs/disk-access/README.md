# Disk access — how the server reads SBND frame bytes

**Decided and implemented.** A page-cache hit is `preadv2(RWF_NOWAIT)` on the executor. A
miss goes to a per-session io_uring built on the first miss. A session that never misses
never builds a ring. Tiles keep four windows; a fill names one frame ahead.

| Doc | What |
| --- | --- |
| [`adr.md`](adr.md) | **The decision.** What ships, what is rejected, numbers that are safe to quote |
| [`EVIDENCE.md`](EVIDENCE.md) | **The numbers** the ADR may quote, including the 2026-09-09 re-measurement |
| [`IMPLEMENTATION.md`](IMPLEMENTATION.md) | **How the code works** — windows, ring, planner, what the server reports |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | **Before shipping.** overlayfs refuses the fast path; `check-fastpath` answers it |
| [`NEXT.md`](NEXT.md) | **What is still open** — P0 on the target, workstation A/B, transport levers |

Campaign tables, the design diary, and the layout study are not in this tree. They live at
tag [`read-path-evidence-2026-09-09`](https://github.com/dary-dc/wt-pacs/tree/read-path-evidence-2026-09-09):

```bash
git show read-path-evidence-2026-09-09:docs/disk-access/READ-PATH-DESIGN.md
git show read-path-evidence-2026-09-09:docs/disk-access/   # TSVs
```

## The lab stays on the tip

`lab/disk-access-bench` is a workspace member. A 2026-08-31 decision went wrong partly
because re-running its harness meant restoring a crate from a named commit.

```bash
NAME=frames_16k_big BYTES=16384 FRAMES=5120 ./lab/scripts/gen_live_cell_fixture.sh
NAME=frames_250k_big BYTES=250000 FRAMES=2048 ./lab/scripts/gen_live_cell_fixture.sh
BYTES=250000 FRAMES=32000 NAME=frames_250k_deep ./lab/scripts/gen_live_cell_fixture.sh
cargo build -p disk-access-bench -p check-fastpath --release
./target/release/check-fastpath /path/to/studies
lab/scripts/server_ab.sh <base-commit>     # product server A/B
lab/scripts/read_path_ab.sh <base-commit>  # ReadCtx only
```

`server/` does not link `memmap2`. mmap arms live in the lab crate so they stay reproducible
without a mapping in the product.

**Use a fixture larger than the host cache for anything about misses.** An 80 MB study fits
in the hypervisor; a “miss” there is ~12 µs and hides every miss-path effect. The 8 GB
`frames_250k_deep` is the miss fixture. Consecutive asks must stride past `read_ahead_kb` or
a cold cell is a hit cell wearing a cold label.
