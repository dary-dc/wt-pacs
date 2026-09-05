# Disk access

How the server brings SBND frame bytes in without freezing the Tokio executor.

| Doc | What |
| --- | --- |
| **[`READ-PATH-DECISION.md`](READ-PATH-DECISION.md)** | **Start here.** Which read path for which case, from a 3 600-cell campaign over three independent runs. Supersedes the io_uring verdicts in the docs below |
| [`adr.md`](adr.md) | Accepted decision (`RWF_NOWAIT` streaming; pool only on the miss) |
| [`RERUN.md`](RERUN.md) | Evidence: instrument, cells, TSVs here, and what the instrument cannot see |
| [`SEND-BUDGET.md`](SEND-BUDGET.md) | What the per-frame number is *made of*, per-op io_uring vs `preadv2`, the send path over real quinn, and the frame cache |
| [`PREFIX-READS.md`](PREFIX-READS.md) | **Rung delivery strides the file and the fast path misses 319 of 320. Storing rungs contiguously puts it back to 3** |
| [`DEPTH.md`](DEPTH.md) | First lift of the depth-1 assumption. Superseded by [`READ-PATH-DECISION.md`](READ-PATH-DECISION.md), which crosses depth with miss rate and adds the hybrid |
| [`later.md`](later.md) | Optional follow-ups only |

**Serving rungs rather than whole frames?** Read [`PREFIX-READS.md`](PREFIX-READS.md) first —
the ADR's hit rate is a property of reading frames whole and in order, and prefix delivery
takes it away.

**Reading a per-frame number for the first time?** Start with
[`SEND-BUDGET.md`](SEND-BUDGET.md) §1. `later_p50` is one 250 KB frame, prepared and copied
to the connection, on a page-cache hit — not a device I/O. Comparing it with a per-4 KiB
NVMe latency is a category error, and in the citation's own unit this path reads 4 KiB in
561 ns.

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

`io-uring`, `quinn`, `rcgen` and `rustls` are dependencies of **this crate only** — the
product links quinn through wtransport and does not link `io-uring` at all.

Four more binaries live in the same crate:

| Binary | What |
| --- | --- |
| `read_campaign` | The campaign behind [`READ-PATH-DECISION.md`](READ-PATH-DECISION.md): arm × prefetch × in-flight × readers × temperature × access shape × ask size. Driven by `lab/scripts/run_read_campaign.sh`, analysed by `lab/scripts/analyze_read_campaign.py` |
| `crossover_bench <study> [asks] [size] [stride] [repeats]` | Miss rate as a *controlled* variable — evict, then pre-warm a chosen fraction. `CROSSOVER_WARM` / `CROSSOVER_DEPTHS` narrow the sweep; `CROSSOVER_INLINE=1` reproduces the harness placement bug of §The harness disagreement |
| `frame_budget <study> [ops\|uring\|ladder\|all] [monitors]` | Splits a frame into syscall, kernel copy, user copy and scheduler; prices one read op from 1 B to 250 KB against io_uring and `O_DIRECT`. Used by [`SEND-BUDGET.md`](SEND-BUDGET.md) |
| `wire_send_bench <study> <mode> <frames> [repeats]` | The send path over real quinn on IPv4 loopback, client in its own process. Modes: `write_all` (product), `write_chunk`, `cache:<MB>` (product `FrameCache`), `preloaded` (ceiling). Used by [`SEND-BUDGET.md`](SEND-BUDGET.md) |

`wire_send_bench` binds IPv4, so it runs where the product's `with_bind_default` (IPv6)
cannot — which is how the campaign's "no live end-to-end run" gap got closed for the send
path.

Four flags decide whether a result means anything (see [`RERUN.md`](RERUN.md) §Precision):

| Flag | Why |
| --- | --- |
| `--selftest` | Prints the instrument's resolution and overhead. Run it before quoting a number in the hundreds of nanoseconds |
| `--samples <path>` | One row per ask, so percentiles pool across repeats and carry a bootstrap CI instead of resting on the 316th of 319 observations |
| `--monitors 0` | For CPU numbers. The gap monitor is a spin loop and changes the latency it is not measuring — the same warm arm reads 46.9 µs with one monitor and 84.7 µs with none |
| reversed `--arm` order | Before believing any cold ranking. Arms take turns creating their own cold copy, and that alone produced a 34% "win" that reversed with the order |

And one rule: re-running the same configuration moves a median, so a difference counts only
if it beats that drift **and** reproduces with the same sign. The 7% figure quoted here
before was measured on a handful of cells; across the 3 600-cell campaign the p50 drift is
11% and the p90 is **28.5%**, which is the threshold
[`READ-PATH-DECISION.md`](READ-PATH-DECISION.md) now applies.

`lab/cold-page-bench` is the older E3 / one-pass-cold tool; it owns its own copy of the
rejected pre-touch arm and is not part of this campaign.
