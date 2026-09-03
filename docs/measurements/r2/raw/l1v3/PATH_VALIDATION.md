# L1 v3 path validation (S4a / S4b / S5)

**Result: PASSED** (2026-09-03)

## Topology
- Rig-local veth pair: `veth-srv` (10.77.0.1) ↔ `wt-cli`/`veth-cli` (10.77.0.2), MTU 1500
- Netem on both directions; loss on forward path only
- Servers in root ns on UDP 4435 (S/shared) and 4437 (Q/per-frame)
- Harness in `wt-cli` netns; `--read-bps 0` (wire cap is netem)

## Gates
| Gate | Result | Notes |
|------|--------|-------|
| S4a ping ±5% (+2 ms slack) | PASS | 60 → 60.28 ms; 150 → 150.30 ms |
| S5 D from measured RTT | PASS | 60 → D=4; 150 → D=7 |
| S4b D=1 miss_p95 band | PASS | see calibration below |

## S4b band calibration
Ideal `RTT + Tf` (Tf=25.6 ms) under-predicts measured waits. Observed medians:
- RTT 60: **109.2 ms** (ideal 85.6)
- RTT 150: **248.1 ms** (ideal 175.6)

These match **≈ 1.5·RTT + Tf** (ask on return path + body on forward path). Gate accepts ±15% around that:
- RTT 60: [98.3, 132.9]
- RTT 150: [213.0, 288.2]

## Also required on the rig
- `iputils-ping` installed
- iptables ACCEPT for UDP 4435–4437 (before the OCI REJECT rule)

Artifacts: `l1_s_vs_q_loss_v3.path.tsv`, `raw/l1v3/path/*.json`
