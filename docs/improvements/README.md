# Improvements lab

Work **outside** the two owned lanes — transport (`cursor/l1-loss-run-dbae`) and disk access
(`claude/disk-access-adr-validation-saz6m8`). Branch
[`claude/project-improvements-lab-pmohec`](https://github.com/dary-dc/wt-pacs/tree/claude/project-improvements-lab-pmohec)
· [PR #14](https://github.com/dary-dc/wt-pacs/pull/14).

This folder is the front door. The dated files are evidence, not the queue.

| File | What it is |
| ---- | ---------- |
| **this page** | ranked open work, then what already landed on the branch |
| [`2026-09-08.md`](2026-09-08.md) | second pass: every open item below, reproduced or measured, **no product code** |
| [`2026-09-06.md`](2026-09-06.md) | first pass: the commits already on the branch, plus withdrawn / null / parked. 2026-09-10 addendum: CPU before disk (FoD / header / alloc) is 160 ns, not shipped |
| [`ledger.md`](ledger.md) | one inventory of both passes |

Lab measurement drivers are **not on this tip** (they must not land on `main`). Restore:
[`#restore-the-lab-drivers`](#restore-the-lab-drivers).

Nothing here is merged to `main`. First-pass commits are on the branch, one per item, waiting
take-or-drop. Second-pass items exist only as findings.

---

## Open — found, evidenced, not coded

From the 2026-09-08 pass unless noted. Size is the proposed change, not the write-up.

### High value

| # | Kind | What | Size | Evidence |
| - | ---- | ---- | ---- | -------- |
| **D4** | defect, dev | `dev-server.py` serves `dev-cert/key.pem` and `.git/` | ~5 lines deny-list | [§D4](2026-09-08.md#d4--the-dev-static-host-serves-the-private-key-and-the-git-directory) |
| **D1** | defect, telemetry | second sequential session in one process truncates `telemetry-server.rows`; session 1 gone from disk and the report | ~15 lines in `sink.rs` / `tap.rs` | [§D1](2026-09-08.md#d1--telemetry-the-second-sequential-session-truncates-the-row-file) |
| **D2** | defect, clients | failed **single** ask leaves a 15 s waiter and an unhandled rejection (bulk was fixed in C7) | four lines per arm, same shape as C7 | [§D2](2026-09-08.md#d2--ts-client-a-failed-single-ask-leaves-its-waiter-armed-and-an-orphaned-rejection) |
| **D3** | defect, clients | duplicate indices in a bulk ask: TS orphans a waiter and asks twice; WASM sticks on “previous bulk still pending” | ~6 lines each arm, validate before arming | [§D3](2026-09-08.md#d3--duplicate-indices-in-a-bulk-ask) |
| **Tests** | gap | product TypeScript client has no tests; a stub `WebTransport` already drives it in Node | `client/transport-ts/test/` from `lab/improvements/bench/ts_session_stub.mjs` (after restore) | [Tests](2026-09-08.md#tests--gaps) |
| **T1 / T2** | tooling | no CI; `gate.sh` skips four crates, clippy, and fmt | one workflow + `cargo test --workspace` | [§T](2026-09-08.md#t--tooling) |
| **P1** | perf, build | `lto = "fat"` + `codegen-units = 1`: server CPU/frame −5–8 %, `send_us` p50 −8–20 %, binary −26 %, rebuild 3 s → 37 s | workspace `[profile.release]` | [§P1](2026-09-08.md#p1--server-release-profile-lto--fat-codegen-units--1) |
| **P2** | perf, WASM | `opt-level = "s"` + LTO: package −12 % gzip, no speed or `init()` change | per-crate or workspace profile | [§P2](2026-09-08.md#p2--wasm-package-release-profile-variants-all-through-wasm-opt) |

D4 is first because it is the README quick-start host serving a private key. D1 is data loss in
the telemetry contract. D2/D3 are product waiter bugs; the TS test gap is what would pin them.

P1/P2 are real, measured, and need the lanes to agree (they change every binary's build).

### Smaller, still open

| # | What | Evidence |
| - | ---- | -------- |
| **D5** | normal close and each refused frame log at WARN; send `EndSession` before `close()`, drop those levels | [§D5](2026-09-08.md#d5--log-hygiene-normal-closes-and-refusals-are-warn-lines) |
| **D6 / D7** | `refusals_e2e.mjs` passes `wt=undefined`; dead Chromium path in `verify_e2e.py` | [§D6](2026-09-08.md#d6--d7--lab-driver-nits) |
| **T3–T7** | one `fmt --check` miss; editor `tsconfig` TS5097; global `rustflags`; undocumented wasm-opt; two TS build recipes | [§T](2026-09-08.md#t--tooling) |
| **Docs** | stale review G2 row; v1 comment; no `docs/` index (this folder is the improvements slice) | [Docs](2026-09-08.md#docs--drift) |
| **P3** | recorder costs 25–30 µs main-thread per frame in the interactive cell (~5× `tap_read_cost_us`); observation, no code proposed | [§P3](2026-09-08.md#p3--the-recorders-own-main-thread-cost) |

### Parked — first pass, still a product call

Not coded on purpose. Numbers in [`2026-09-06.md`](2026-09-06.md) and [`ledger.md`](ledger.md) §4.

| # | Proposal |
| - | -------- |
| **M1** | product `timing` object: reduce to `{ askMs, receivedMs }`, drop it, or document the placeholders |
| **BYOB** | `getReader({ mode: "byob" })` deletes the accumulator copy; bounded, rewrites both frame loops |
| **F1b** | WASM: arm the 15 s timeout at ask time (as TS does), not at `waitExactFrame` |
| **C2b** | load the TLS identity once; touches `build_endpoint`, which L1 is editing |

---

## On the branch — coded, awaiting take-or-drop

First pass, 2026-09-06. One commit per row. Evidence: [`2026-09-06.md`](2026-09-06.md).

| # | Commit | What |
| - | ------ | ---- |
| F1 | `c75f64c` | WASM control loop keeps bytes across FoD messages (coalesced refusals no longer drop) |
| F2 | `8036eed` | corrupt frame-table entries refused at bundle open (policy: refuse the store, not serve good frames) |
| P4 | `9d3dd8e` | per-frame ack tasks reaped as frames are sent (RSS no longer grows ~0.55 KB/frame) |
| C1 | `f9182a5` | delete unused `client/flight-registry` |
| C2 | `48a4d60` | delete `tls.rs`; banner hash from `wtransport::Identity` |
| C3 | `4817acb` | FoD body decoded without re-framing (server) |
| C6/C7 | `e872bd7` | one settle path per arm; TS refusal map cleared; failed bulk write fails waiters at once |
| W1/W2 | `1bd9d7c` | WASM: typed read results, cached JS keys, right-sized receive buffer |
| H1 | `95b8fa0` | harness samples JS-heap peak on a timer, not per frame |
| T1 | `1e1495f` | TS FoD codec parity with C3; `TextEncoder` reuse measured as a null |

Withdrawn (do not re-derive): zero-copy send **P0** and coalesced header write **P3** already live
on L1 as the chunked send path (the only send path there now). L2 harness/ask-policy work moved to
`cursor/l2-harness-fix-plan-c999`.

---

## Decisions still requested

From [`ledger.md`](ledger.md) §6–7 and [`2026-09-08.md`](2026-09-08.md) close:

1. Take or drop each first-pass commit; F2's refuse-vs-serve policy; T1 as tidiness or drop.
2. Land D1 (process-lived sink vs per-run files), D2+D3 in both arms, D4, D5?
3. CI workflow — yes/no; clippy `-D warnings` once lane warnings are gone.
4. Adopt P1 / P2 release profiles?
5. M1 timing shape; whether BYOB is worth a round later.

---

## Restore the lab drivers

The tip keeps product fixes and this evidence folder. The campaign drivers that produced the
tables live in git history, same shape as [`docs/disk-access/`](../disk-access/README.md)
(`git checkout <sha> -- lab/…`). They are not on `main` and not on this tip.

**Preferred restore** (one directory, ROOT paths already adjusted):

```bash
git checkout b61c839 -- lab/improvements
```

Same tree as tag `archive/improvements-lab-2026-09` (fetch the tag if that commit is not in
this clone). After restore, drivers are:

| Path | Pass |
| ---- | ---- |
| `lab/improvements/scripts/sendpath_ab_bench.sh` | 2026-09-06 server A/B |
| `lab/improvements/scripts/rss_timeline.sh` | P4 RSS |
| `lab/improvements/scripts/callgrind_run.sh` | server instruction profile |
| `lab/improvements/scripts/client_profile.mjs` · `client_ab_profile.sh` · `client_ab_summarize.py` | client CPU A/B |
| `lab/improvements/scripts/refusals_e2e.mjs` · `frame0_e2e.mjs` | F1 / frame0 browser e2e |
| `lab/improvements/bench/textencoder.html` · `byob_probe.html` · `run_page.mjs` | T1 / BYOB probes |
| `lab/improvements/bench/ts_session_stub.mjs` | D2 / D3 |
| `lab/improvements/bench/wasm_variants.sh` · `wasm_init_time.mjs` | P2 |
| `lab/improvements/scripts/client_profile_groups.mjs` | P3 |

Re-run commands: [`2026-09-06.md` How to re-run](2026-09-06.md#how-to-re-run),
[`2026-09-08.md` How to re-run](2026-09-08.md#how-to-re-run). Drop the directory again before
any merge to `main`.
