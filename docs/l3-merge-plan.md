# L3 / disk-access — essentialist merge plan

**Status:** tip reshaped for merge · **Full research tip (harness):** `ca94a87`  
**Branch:** `cursor/l3-executor-stall-bc88` → `main`  
**Rule:** product + ADR + decision measurements on `main`; thick lab recoverable from git history (no eternal research branch).

---

## On this tip (IN for `main`)

| Path | Why |
| --- | --- |
| `server/src/media/frame_store.rs` | touch / mincore helpers / `sysconf` page size / `pread` |
| `server/src/transport/server.rs` | always-touch `send_one_frame` |
| `server/Cargo.toml` | `libc` |
| `docs/adr-frame-disk-access.md` | **Accepted** decision |
| `docs/measurements/r2/DISK_ACCESS_RERUN.md` | Metric glossary + C1/C2/D3 explained |
| `docs/measurements/r2/disk_access_{mempressure,multisession*,pread_pooled*}.tsv` | Decision TSVs |
| `docs/measurements/r2/REVIEW_2026-08-31_RAW.txt` | First-review probes |
| `docs/l3-disk-access-evidence-review.md` | Defect/fix audit trail |
| `docs/disk-access-later.md` | Short follow-ups |
| `docs/lanes/L3-executor-stall.md` | Lane closed → ADR |
| `lab/cold-page-bench/` | Fixed one-pass / gap instrument (already a workspace member) |

## Pruned from tip (OUT — in history at `ca94a87`)

| Path | Why |
| --- | --- |
| `lab/disk-access-bench/` | Thick campaign harness |
| `lab/scripts/run_disk_access_mempressure.sh` | Goes with harness |
| `docs/disk-access-{campaign,team-brief,prior-art}.md` | Campaign prose |
| `docs/measurements/r2/DISK_ACCESS_{CAMPAIGN,FOLLOWUP,REALISTIC}*` · `L3_EXECUTOR_STALL*` | Flawed-instrument raw history |

Restore harness:

```bash
git checkout ca94a87 -- lab/disk-access-bench lab/scripts/run_disk_access_mempressure.sh
# re-add to Cargo.toml workspace members, then cargo build -p disk-access-bench --release
```

## Verification

- [x] Always-touch product path
- [x] No `lab/disk-access-bench` on tip
- [x] ADR Accepted + `DISK_ACCESS_RERUN` with glossary
- [x] D3 pooled pread recorded; default unchanged
- [ ] `cargo test` green on tip (run before merge)
