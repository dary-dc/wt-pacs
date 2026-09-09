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

To restore this folder after a later lean (tag first, then drop from the tip):

```bash
git checkout archive/transport-lab-2026-09 -- lab/transport
# and put the two workspace members back in Cargo.toml
```
