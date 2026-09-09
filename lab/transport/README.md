# Transport lab

Campaign drivers for the L1 / L4 / R6 / send-path work. **No product crate depends on these.**

This folder is this lane only. `lab/window-harness`, `lab/cold-page-bench`, and
`lab/telemetry-bench` stay where `main` already has them.

| Path | What |
| ---- | ---- |
| [`netsim/`](netsim/) | Userspace UDP delay / loss / rate / queue (crate `netsim`) |
| [`aead-bench/`](aead-bench/) | Per-packet AEAD, ring vs aws-lc-rs |
| [`scripts/`](scripts/) | Stall, R6, L4, quic-opt, mem, classify, cloud helpers |

Shared scripts that already lived on `main` (`gen_tf_fixtures.sh`, `cloud_common.sh`,
E1/E2 sweeps, …) remain in [`lab/scripts/`](../scripts/).

Write-up: [`docs/transport/`](../../docs/transport/).

This folder is self-contained for the campaigns that still run against the **product**
binary (`--stream-mode`, `--congestion`, `--prefault`, windows). Rejected send paths
(`copy` / `split`) and the old experiment knobs were not copied back into here — those
decisions are closed. Scripts that still pass `--send-path` or `--features lab` are
historical; they will not build or run against current `exact-server`.
