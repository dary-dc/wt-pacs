# Running the scale campaign on a real machine

> **Run once, 2026-09-08**, on an 8-thread i5-8250U / btrfs-on-LUKS/NVMe:
> [`v34_scale.tsv`](v34_scale.tsv), [`v34_scale_host.txt`](v34_scale_host.txt). It settled the
> arm question and did **not** lift the concurrency ceiling — that host is device-bound from
> ~64 reads in flight (~840 MB/s, CPU at 0.42 of 8 cores). A rerun needs **faster storage**,
> not more cores. Two traps it found, fixed in step 2 below.


Everything measured so far ran on a 4 vCPU sandbox. Past ~64 reads in flight that host is the
bottleneck, not the read path, so the high-concurrency rows are directional at best. This is
how to close that on a machine with more cores.

## What the host needs

| | |
| --- | --- |
| Cores | 8+ (16 preferred — the point is to outrun the sandbox) |
| Filesystem | **ext4 or XFS on a real block device.** Not overlayfs, not tmpfs: they refuse `RWF_NOWAIT` and every read reports a miss. Verify with `check-fastpath` first |
| Free disk | ~9 GB for the fixture |
| `ulimit -n` | ≥ 8192 — the ring arms use 2 fds per session |
| Kernel | 5.6+ for `RWF_NOWAIT`; io_uring not disabled (`sysctl kernel.io_uring_disabled` = 0) |

## Setup

```bash
git clone <repo> && cd wt-pacs
git checkout claude/disk-access-adr-validation-saz6m8
cargo build --release -p disk-access-bench -p check-fastpath

# 1. The fast path must exist here, or every number is the fallback path's.
./target/release/check-fastpath .          # expect: PASS

# 2. Read-ahead decides what a "cold" cell measures. MEASURE it, do not read one number.
#    The block device is not always the operative value: on btrfs the filesystem installs its
#    own bdi (4096 KB measured, against 128 KB on the block device underneath). Sweep the
#    stride and watch miss_pct instead of trusting either:
for st in 1048576 4194304 16777216; do
  ./target/release/read_campaign --study <fixture> --arms pool --depths 1 --temps cold \
    --repeats 2 --asks 256 --size 16384 --stride $st --monitors 0 --label ra | \
    awk -F'\t' -v s=$st 'NR>1{print "stride="s" miss_pct="$22}'
done
#    Pick the smallest stride that reaches ~99% and use it below.

# 3. Build the 8 GB fixture (~10 min).
BYTES=250000 FRAMES=32000 NAME=frames_250k_deep ./lab/scripts/gen_live_cell_fixture.sh
```

## The run

```bash
./target/release/read_campaign \
  --study lab/fixtures/frames_250k_deep/frames_250k_deep.sbnd \
  --label scale --arms pool,hybrid_lazyring,uring,product \
  --depths 1,2,4 --readers 1,16,64,256 --temps cold,warm \
  --size 16384 --stride 4194304 --asks 256 --repeats 6 --monitors 0 \
  > v34_scale.tsv
```

**`--stride 4194304` is load-bearing.** It must exceed the host's read-ahead window, or a
"cold" cell is a hit cell wearing a cold label: at the campaign's usual 250 KB stride on an
8 MB read-ahead host, one miss warms the next ~33 asks and a fully evicted 8 GB fixture
measures **1.8% misses instead of 99.8%**. Scale the stride to the `read_ahead_kb` recorded
above.

Then:

```bash
lab/scripts/pair_arms.py --by readers --pairs uring:hybrid_lazyring,product:hybrid_lazyring v34_scale.tsv
lab/scripts/pair_arms.py --by depth   --pairs uring:hybrid_lazyring v34_scale.tsv
```

### Two traps this kind of host sets

* **Filesystem read-ahead can differ from the block device's.** See step 2. Reading
  `/sys/block/*/queue/read_ahead_kb` alone gave 128 KB where the operative value was 4096 KB.
* **Transparent compression makes a constant-byte fixture unreal.** `compress=zstd:1` turned
  the generated fixture into 32:1 compressible data while `du` and `stat` both reported full
  size — so the device was reading a fraction of what the numbers implied. Generate the
  fixture with incompressible content, or mount the fixture directory with compression off,
  and check `compsize` if it is available.
* **`RLIMIT_MEMLOCK` is a real ceiling.** io_uring rings are accounted against it: an 8 MB
  default refused the two largest ring cells outright (~940 rings at 8.7 KiB each). Raise
  `ulimit -l` before the run, or those cells silently vanish from the campaign.

## What to read out of it

1. **Where does each arm's curve bend?** `pool` grows OS threads (98 at 256 in flight on the
   sandbox); the ring arms hold 5 and grow file descriptors instead. Report `threads` and p99
   next to CPU — the sandbox run showed the arms separating on the *tail* long before the
   median.
2. **Does `product` still track `hybrid_lazyring`?** It did on the sandbox (+0.7% on misses,
   sign at chance). If it diverges at scale, the shipped path is not the arm any more.
3. **Does `uring` cross `hybrid_lazyring` at depth 2–4?** On the sandbox `uring` held the
   better p99 at depth 4 and the worse median. That is the decision this run exists to make,
   and it only matters once serving depth > 1 is built.
4. **Say where the host saturates and claim nothing past it.** That is the failure this run is
   correcting, so do not repeat it.

## Method rules that are not optional

* **Interleave the arms.** `read_campaign` rotates them per repeat already. Do not compare a
  run of one arm against a later run of another: on the sandbox the same code read **+8.1%
  with 8/8 sign agreement** run sequentially and **−1.8%, a tie**, interleaved.
* **A difference counts** only if |median| ≥ 28.5% **and** signs agree on ≥ 0.8n. Everything
  else is a tie — which is a real answer, not a failure.
* **Quote latency or throughput, not both.** Throughput is depth/latency to within 0.66–0.97
  here; citing both counts one measurement twice.
