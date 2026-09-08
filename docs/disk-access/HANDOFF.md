# Read path — handoff, 2026-09-08 (second pass)

Pick this up cold. Everything below is checkable; where a claim is not, it says so.

**Branch:** `claude/disk-access-adr-validation-saz6m8` · `git rev-list --count origin/main..HEAD`
= 50, 0 behind · working tree clean · tests green on default, `telemetry` and
`--no-default-features`.

Read next: [`NEXT.md`](NEXT.md) for what is parked and in what order — its ordering was set
**with the owners** on 2026-09-08 and outranks any ordering derived from measurement alone.
This file is the context around it: what shipped, what was decided, and the traps.

Two sessions worked this branch on 2026-09-08 and their work is merged, not layered: one
built read-ahead-by-one and the miss-rate reporting, the other verified the I/O backends
against current releases and the 6.18 kernel and measured the `x14` / `x15` arms.

---

## 1 · What ships on this branch

**`hybrid_lazyring`**: `preadv2(RWF_NOWAIT)` inline on a page-cache hit, io_uring for the
miss, and no ring at all for a session that never misses. **Plus read-ahead by one**: a
`RequestFrames` batch serves at depth 2.

| | |
| --- | --- |
| Where | `server/src/media/read_path.rs` (the logic), `uring_reader.rs` (the ring, two slots), `frame_out.rs` (the wire loop), `pipeline.rs` (the seam) |
| Flag | `WTPACS_READ_PATH` = `auto` (default) \| `pool` (kill switch) \| `uring` (lab lever). Unknown values warn and fall back to `auto` |
| Feature | `uring`, on by default. `--no-default-features` compiles to the pool path |
| Reports | `read_fast_path=` in the startup banner; `session reads hits=… misses=… miss_rate=… ring=…` per session |
| Validated | as the **product**, not a model of it — `read_campaign --arms product,product_ahead` drives the real `ReadCtx` |

Also on the branch: `memmap2` is gone from `server/` entirely, `study-bundle` gained
`read_layout`, and `CLAUDE.md` + `scripts/comment_budget.sh` make the comment rule checkable.

## 2 · Numbers that are safe to quote

Paired per cell, the campaign's rule: a difference counts only if |median| ≥ 28.5% **and**
signs agree on ≥ 0.8n. Everything else is a **tie**, which is a real answer.

| | |
| --- | --- |
| `product` vs `hybrid_lazyring` | tie everywhere — p50, p99 and CPU, every depth and reader count, on both hosts |
| `product` vs `pool`, 16 KiB misses | **−45.4%, RESOLVED** |
| `hybrid_lazyring` vs `pool`, misses | **−56 / −70 / −75%** at depth 1 / 4 / 16, RESOLVED |
| `uring` vs `hybrid_lazyring` | misses tie at every depth; hits lose harder with depth (p50 +106% at depth 2, +298% at depth 4, RESOLVED) |
| **Read ahead by one, missing tiles** | **+73.8% asks/s, 12/12, RESOLVED**; p50 −53.4%; 16 tiles 1.14 → 0.62 ms |
| **Read ahead by one, warm** | **tie** (−3.8%, 5/12) — a hit-only session pays nothing |
| Serving depth, the arm | 1 → 2 is +67.4% paired; from the medians 2 → 4 adds +37% and 4 → 16 +28% |
| Threads | ring arms flat (5 sandbox / 9 workstation); `pool` reaches 125–135 at 64 readers, capping at 521 |
| Per session that misses | 2 fds, 8.7 KiB, 15.6 µs ring construction — **unchanged by the second slot** |

Raw: `v30_product.tsv`, `v31_gap250k.tsv`, `v32_depth.tsv`, `v33_cross.tsv` (sandbox),
`v34_scale.tsv` + `v34_scale_host.txt` (workstation), `v35_depth2.tsv` +
`v35_depth2_host.txt`, `v36_readahead.tsv`, `x14_ringfd*` (eventfd against ring fd),
`x15_sequential*` (the streaming readers).

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
| "this host's `read_ahead_kb` is 128" | 128 is the loop devices. `/dev/vda` is **8192** — it caught a second host on 2026-09-08 too |
| "the depth-4 and depth-16 numbers differ by far less than 1 and 4" | Not in throughput. In [`v32_depth.tsv`](v32_depth.tsv), the file that claim cited, 1→4 is ×1.90 and 4→16 ×1.52. The case for stopping at two is [`v35_depth2.tsv`](v35_depth2.tsv), where 2 alone collects 62% |
| "the 250 KB cold cell measures misses" | At `--stride 250000` against 8 MiB of read-ahead it reached 4.7% misses. `v36`'s 250 KB row shows no regression, not no win |

## 4 · Decisions taken — reopen only with new evidence

* **`hybrid_lazyring` is the arm.** Tied for cheapest in every regime; no arm is established
  better anywhere. `uring` is kept as a flag, not a mode.
* **No tuning toggle.** The arm chooses per session at runtime from what the session does; a
  static flag cannot know a miss rate in advance. The flag that exists is a kill switch.
* **Read ahead by one *first*, not *n* at once.** Two windows and two ring slots ship; depth 2
  collects 62% of what depth 16 offers, and the rest costs a slot table and a completion
  demultiplexer. This is a first step, not a ceiling — the owners asked for depth ≥ 4.
* **A read ahead probes the page cache first**, exactly as an on-demand read does. Sending it
  straight to the ring would rebuild the `uring` arm's +131% on hits.
* **mmap is out of the product**, and `O_DIRECT`, `sendfile`/`splice`, registered ring buffers
  and `SQPOLL` are all measured-and-rejected — `SQPOLL` with its own record and its one
  reopening condition in [`RERUN.md`](RERUN.md) §SQPOLL. **Keep the direct `io-uring`
  binding** —
  [`RESEARCH-io-backends-RESULT.md`](RESEARCH-io-backends-RESULT.md) checked the alternatives
  with network access on 2026-09-08.
* **A miss reads the rest of the *frame*, not the rest of the window.**
* **One index per study, never per session** — 12 B/frame, shared by `Arc`.

## 5 · How the user wants this code and these docs

Now written down in [`../../CLAUDE.md`](../../CLAUDE.md) rather than only here:

* **Essentialist and self-documenting.** At equal functionality, simplicity wins.
* **Comments carry only what a reader needs at that line** — a `SAFETY` contract, an invariant
  the types do not enforce, a unit, a one-line pointer. `scripts/comment_budget.sh` enforces
  **0.18** per file, counting neither `SAFETY` blocks nor test modules, and runs in
  `scripts/gate.sh`. Test doc comments are the exception and are not cut.
* **Do not build for a future that may not arrive.**
* **Docs lean, and placed where they belong** — extend the file that owns the subject.
* **Propose before implementing** when the change is structural. The user reviews designs.

## 6 · Method rules learned the hard way

Breaking any of these has already produced a wrong answer in this project. Short version in
`CLAUDE.md`; the evidence is here.

1. **Interleave the arms.** Sequential before/after measured **+8.1% with 8/8 sign
   agreement** on code that was actually **−1.8%, a tie**.
2. **A cold cell measures what read-ahead leaves it.** Stride past the window or measure a
   hit cell by accident — which is exactly what `v36`'s 250 KB row did.
3. **Page-cache eviction is not a test lever.** Tests force misses through `force_pool_reads`
   / `force_short_reads`.
4. **Mutate every new test.** Four of the original tests only started failing once the code
   was broken on purpose — and of the five added since, one passed against a broken
   implementation until it was strengthened.
5. **Pair, then read the rule.** `lab/scripts/pair_arms.py`, and it needs a `pool` arm in the
   cell to classify the regime.
6. **Quote latency or throughput, not both.**
7. **Say where the host saturates and claim nothing past it.** Both hosts stop separating the
   arms at ~64 reads in flight — the sandbox on CPU, the workstation on device.

## 7 · The open items that block the most

**P0: the backend has not been decided on the production target.** One campaign run on the
real instance type, volume class and container image decides whether ~800 lines of ring stay
or the pool ships — with the decision rule fixed in advance, a tie deleting the ring.
[`RESEARCH-io-backends-RESULT.md`](RESEARCH-io-backends-RESULT.md) §Decision, and it is
[`NEXT.md`](NEXT.md)'s item 4. Nothing in the read path should be touched before it.

**`RequestFrame` is still depth 1**, and the owners want depth ≥ 4. The read path carries depth 2 and a batch feeds it; a
stream of single asks does not, because `run_session` will not read the next ask until the
current frame is on the wire. Designed, not built, with the options and the invariants
written out: [`../adr-frame-framing-and-loop-shape.md`](../adr-frame-framing-and-loop-shape.md)
§6d. **Start with the investigation, not the code** — the win is already available to any
client that sends `RequestFrames`.

The other item that blocked this list — the server not being able to report its own miss
rate — is closed: it reports one per session, in the default build. Depth 2 is built for
`RequestFrames`; **the owners' requirement is depth 4 or more**, and
[`v35_depth2.tsv`](v35_depth2.tsv) prices the step from 2 to 4 at a further +37% on the
medians, so "stop at two" is where the *evidence* stopped, not where the requirement does.

## 8 · Where things are

| | |
| --- | --- |
| [`../../CLAUDE.md`](../../CLAUDE.md) | the working rules, and the comment budget that checks one of them |
| [`NEXT.md`](NEXT.md) | parked work, priority order |
| [`IMPLEMENTATION.md`](IMPLEMENTATION.md) | how the read path works, read-ahead, reporting, alternatives, what is left before rollout |
| [`adr.md`](adr.md) | **the decision as one current document** — what ships, what shaped it, how it evolved, every alternative, deployment, the levers outside it. Rewritten 2026-09-08 to be presentable on its own |
| [`EVIDENCE.md`](EVIDENCE.md) | every number, and what is *not* established anywhere |
| [`RERUN.md`](RERUN.md) | the instrument and its precision rules |
| [`SCALE-RUN.md`](SCALE-RUN.md) | running the campaign on a real machine; run once, traps recorded |
| [`RESEARCH-io-backends-RESULT.md`](RESEARCH-io-backends-RESULT.md) | **the backend answer (2026-09-08):** keep `io-uring` direct; every candidate verified at its pinned version; **P0** decides ring-vs-pool on the production target, **P1** parks on the ring fd and drops the eventfd (`x14`) |
| [`SEQUENTIAL-READER.md`](SEQUENTIAL-READER.md) | which reader server-driven streaming should use — settled on the shipped one reading forward; tokio's `fs::File` measured and rejected (`x15`) |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | the fast path, and the two ulimits that decide whether a ring is built |
| [`../adr-frame-framing-and-loop-shape.md`](../adr-frame-framing-and-loop-shape.md) | framing, serving depth §6b, streaming §6c, the loop change §6d |

## 9 · Not done

* **Not merged to `main`.** 50 commits ahead, 0 behind, tests green.
* **No PR opened** — none was asked for.
* Two ring cells at `readers=256 depth 2/4` were refused by `RLIMIT_MEMLOCK` on the
  workstation and are absent from `v34_scale.tsv`.
* The bench copies `stream_codestream`'s loop rather than calling it. The real loop now has an
  end-to-end test, so a drift would at least not go unnoticed in the product — but only the
  copy is measured.
* `serve_batch`'s one-line look-ahead (`frames.get(i + 1)`) has no test of its own: the read
  path's use of it is covered, the wiring is not.
