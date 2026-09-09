# Transport

What this lane decided, and where the evidence lives. Product source is unchanged;
this folder is the write-up.

**Start here:** [`transport-conclusions.md`](transport-conclusions.md).

| Decision | What shipped |
| -------- | ------------ |
| **One shared stream** | `--stream-mode` defaults to `shared` |
| **Chunked send** | `Bytes` view of the study mapping + `write_all_chunks` — no full-frame copy |
| **Prefault** | Fault frame pages off the executor (`--prefault true`) |
| **Cubic default** | Congestive loss → Cubic; radio loss → BBR. Default Cubic until the mix is measured |
| **Windows** | Left at quinn defaults. Memory is bounded by the send path, not `send_window` |
| **Lab arms** | `copy` / `split`, `--ask-priority`, MTU / GSO / socket knobs: `--features lab` only |

GSO 10 → 32 and a larger initial window were **measured, not applied**. GSO is a density
win on loopback and a no-op on the real path; initial window moved nothing.

## Read next

| Doc | What |
| --- | ---- |
| [`why-these-changes.md`](why-these-changes.md) | Why each decision exists |
| [`HANDOFF.md`](HANDOFF.md) | State of play, traps |
| [`adr-quic-stream-receive-window-defaults.md`](../adr-quic-stream-receive-window-defaults.md) | Product ADR (stays in `docs/`) |
| [`proposals/product-code-changes.md`](proposals/product-code-changes.md) | Proposed leftovers — none required to ship |

## Evidence (not the face of `main`)

| Folder | What |
| ------ | ---- |
| [`measurements/`](measurements/) | This lane's TSVs and write-ups (R6, L4, mem, quic-opt, L1 v3, regime) |
| [`lanes/`](lanes/) | This lane's pre-registrations and L1-v3 / L4 / R6 plans |
| [`lab/transport/`](../../lab/transport/) | Drivers for those campaigns |

`docs/lanes/L1-loss-run.md`, `docs/lanes/L2-ask-policy.md`, and `docs/measurements/r2/`
(CAMPAIGN / TASK / ARCHIVE) stay on `main`'s paths.

Restore the lab later from git history; see [`../../lab/transport/README.md`](../../lab/transport/README.md).
