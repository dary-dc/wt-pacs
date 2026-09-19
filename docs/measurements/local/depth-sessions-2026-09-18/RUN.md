# depth × sessions, this tree against `main` — 2026-09-18

`lab/scripts/depth_session_matrix.sh`, six interleaved repeats per cell, arm order reversed
every repeat. Server pinned to CPUs 0–1, driver to 2–3. Release builds, no PGO.
Base: `origin/main` at `495ccd6`. Conclusions in
[`../../../transport/why-these-changes.md` §9](../../../transport/why-these-changes.md).

- `matrix.tsv` — 24 cells: 32 KB and 250 KB × depth 1/2/4/8 × 1/4/16 sessions.
- CPU per ask falls in all 24, 6/6 in each. Throughput up in 22.
- The cell that is worse is 250 KB, depth 1, four sessions; the GSO cap alone reproduces it.

Host: 4 vCPU, kernel 6.18 without `sch_netem`, loopback only — no loss, no shaping, no RTT.
Nothing here speaks to the mobile target's link.
