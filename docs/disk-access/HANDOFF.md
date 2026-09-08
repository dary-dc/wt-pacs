# Read path — handoff, 2026-09-08

Pick this up cold. Everything below is checkable; where a claim is not, it says so.

**Branch:** `claude/disk-access-adr-validation-saz6m8` · 63 commits ahead of `main`, 0 behind ·
working tree clean · 28 test suites green.

Read next: [`NEXT.md`](NEXT.md) for what is parked and in what order. This file is the
context around it — what shipped, what was decided, and the traps.

---

## 1 · What ships on this branch

**`hybrid_lazyring`**: `preadv2(RWF_NOWAIT)` inline on a page-cache hit, io_uring for the
miss, and no ring at all for a session that never misses.

| | |
| --- | --- |
| Where | `server/src/media/read_path.rs` (the logic), `uring_reader.rs` (the ring), `frame_out.rs` (the wire loop), `pipeline.rs` (the seam) |
| Flag | `WTPACS_READ_PATH` = `auto` (default) \| `pool` (kill switch) \| `uring` (lab lever). Unknown values warn and fall back to `auto` |
| Feature | `uring`, on by default. `--no-default-features` compiles to the pool path |
| Validated | as the **product**, not a model of it — `read_campaign --arms product` drives the real `ReadCtx` |

Also on the branch: `memmap2` is gone from `server/` entirely (the mmap arms keep their own
mapping in `lab/disk-access-bench/src/study_map.rs`), and `study-bundle` gained `read_layout`.

## 2 · Numbers that are safe to quote

Paired per cell, the campaign's rule: a difference counts only if |median| ≥ 28.5% **and**
signs agree on ≥ 0.8n. Everything else is a **tie**, which is a real answer.

| | |
| --- | --- |
| `product` vs `hybrid_lazyring` | tie everywhere — p50, p99 and CPU, every depth and reader count, on both hosts |
| `product` vs `pool`, 16 KiB misses | **−45.4%, RESOLVED** |
| `hybrid_lazyring` vs `pool`, misses | **−56 / −70 / −75%** at depth 1 / 4 / 16, RESOLVED |
| `uring` vs `hybrid_lazyring` | misses tie at every depth; hits lose harder with depth (p50 +106% at depth 2, +298% at depth 4, RESOLVED) |
| Threads | ring arms flat (5 sandbox / 9 workstation); `pool` reaches 125–135 at 64 readers, capping at 521 |
| Per session that misses | 2 fds, 8.7 KiB, 15.6 µs ring construction |

Raw: `v30_product.tsv` (product as an arm), `v31_gap250k.tsv`, `v32_depth.tsv`,
`v33_cross.tsv` (sandbox), `v34_scale.tsv` + `v34_scale_host.txt` (workstation).

## 3 · Claims that were retracted — do not re-quote them

Each was stated to the user and then measured to be wrong. They survive in git history and in
earlier prose; this is the correction of record.

| Retracted | What is true |
| --- | --- |
| "`uring` has the better p99 at depth 4" | Sandbox artefact — 4 vCPU running out of CPU. On the workstation, misses tie at every depth |
| "`uring` is 47–61% worse on latency" | A p50 result at **one reader**; does not survive crossing depth with readers |
| "throughput confirms the latency result" | Throughput is `depth / latency` to within 0.66–0.97 — quoting both counts one measurement twice |
| "`adr-reject-server-ordering.md` fixes the loop at depth 1" | It rejects **reordering**, not concurrency. Pipelining reads preserves FIFO delivery and is not forbidden |
| "ring construction costs 82 µs" | That is mass-creation (1 000+ at once). A single ring is **15.6 µs** |
| "this host's `read_ahead_kb` is 128" | 128 is the loop devices. `/dev/vda` is **8192** |

## 4 · Decisions taken — reopen only with new evidence

* **`hybrid_lazyring` is the arm.** Tied for cheapest in every regime; no arm is established
  better anywhere. `uring` is kept as a flag, not a mode.
* **No tuning toggle.** The arm chooses per session at runtime from what the session does; a
  static flag cannot know a miss rate in advance. The flag that exists is a kill switch.
* **mmap is out of the product**, and `O_DIRECT`, `sendfile`/`splice`, registered ring buffers
  and `SQPOLL` are all measured-and-rejected. [`IMPLEMENTATION.md`](IMPLEMENTATION.md)
  §Alternatives has the table and which rows are verified.
* **A miss reads the rest of the *frame*, not the rest of the window.** Windowing the
  escalation costs 2–3 round trips per 250 KB frame.
* **One index per study, never per session** — 12 B/frame, shared by `Arc`. Pinned by
  `sessions_share_one_store_rather_than_opening_their_own`.

## 5 · How the user wants this code and these docs

Stated directly, and worth honouring without being re-asked:

* **Essentialist and self-documenting.** Audience runs junior to senior. At equal
  functionality and no other trade-off, **simplicity wins**.
* **Comments carry only what a reader needs at that line to avoid writing a bug** — safety
  contracts, non-obvious invariants. Numbers, rationale and measurement narrative go in
  `docs/`, with a one-line pointer where a reader would ask why. Target ratio ~0.25 comment
  lines per code line; the repo's own files sit there.
* **Do not build for a future that may not arrive.** A speculative abstraction is a cost.
* **Docs lean, and placed where they belong** — not a new file per finding.
* **Propose before implementing** when the change is structural. The user reviews designs.

## 6 · Method rules learned the hard way

Breaking any of these has already produced a wrong answer in this project.

1. **Interleave the arms.** Sequential before/after measured **+8.1% with 8/8 sign
   agreement** on code that was actually **−1.8%, a tie**. Build the old binary in a
   `git worktree`, alternate within each round.
2. **A cold cell measures what read-ahead leaves it.** `RWF_NOWAIT` never populates the cache;
   the blocking read an arm escalates to does, pulling a whole read-ahead window. Stride past
   it or a fully evicted 8 GB fixture measures **1.8% misses instead of 99.8%**. And measure
   the window — on btrfs the filesystem's bdi (4096 KB) differs from the block device (128 KB).
3. **Page-cache eviction is not a test lever.** `fadvise(DONTNEED)` will not evict a mapped
   page and on some hosts evicts nothing. Tests force misses through `force_pool_reads` /
   `force_short_reads` instead. A test that silently ran warm passed against a deliberately
   broken implementation here.
4. **Mutate every new test.** Four of them only started failing after the code was broken on
   purpose.
5. **Pair, then read the rule.** The candidate table's pooled medians and the rule's paired
   deltas disagree by ~2× on the comparison people most want to make. `lab/scripts/pair_arms.py`.
6. **Quote latency or throughput, not both.**
7. **Say where the host saturates and claim nothing past it.** Both hosts so far stop
   separating the arms at ~64 reads in flight — the sandbox on CPU, the workstation on device.

## 7 · The two open items that block the most

**Serving is depth 1, and the protocol says otherwise.** `run_session` reads one ask, serves
it to completion, then reads the next; `serve_batch` is a `for` loop with an `.await`. So
`RequestFrame`'s documented "depth = outstanding asks" is the *client's* depth — the server
flattens it to one. Worth 1.2 ms → 0.4 ms on 16 missing tiles. The shape to build is **read
ahead by one — a double buffer**, not a general N-deep design.
`../adr-frame-framing-and-loop-shape.md` §6b.

**The server cannot report its own miss rate.** Every threshold in this investigation is a
miss rate, and it is invisible in production. Blocks any check of the arm choice against a
real workload.

## 8 · Where things are

| | |
| --- | --- |
| [`NEXT.md`](NEXT.md) | parked work, priority order |
| [`IMPLEMENTATION.md`](IMPLEMENTATION.md) | how the read path works, alternatives, what is validated, what is left before rollout |
| [`adr.md`](adr.md) | the decision, the invariants, the levers outside it (incl. `max_udp_payload_size`, −35% CPU, unspent) |
| [`EVIDENCE.md`](EVIDENCE.md) | every number, and what is *not* established anywhere |
| [`RERUN.md`](RERUN.md) | the instrument and its precision rules |
| [`SCALE-RUN.md`](SCALE-RUN.md) | running the campaign on a real machine; run once, traps recorded |
| [`RESEARCH-io-backends.md`](RESEARCH-io-backends.md) | brief for an agent with web access |
| [`RESEARCH-io-backends-RESULT.md`](RESEARCH-io-backends-RESULT.md) | **its answer (2026-09-08):** keep `io-uring` direct; every candidate verified; one change proposed — park on the ring fd, drop the eventfd (`x14`) — and the implementation proposals ranked |
| [`SEQUENTIAL-READER.md`](SEQUENTIAL-READER.md) | the sequential (streaming) use case: candidates, incl. tokio's `fs::File` on its io_uring driver, measured as `x15` |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | the fast path does not exist on overlayfs, and the server degrades silently |

## 9 · Not done

* **Not merged to `main`.** The branch is 63 commits ahead, 0 behind, tests green.
* **No PR opened** — none was asked for.
* Two ring cells at `readers=256 depth 2/4` were refused by `RLIMIT_MEMLOCK` on the
  workstation and are absent from `v34_scale.tsv`.
* The bench copies `stream_codestream`'s 5-line loop rather than calling it, because the real
  one needs a live QUIC stream. Low risk, flagged, user's call whether to close it.
