# Plan: telemetry readability and performance — historical

**Status:** **historical evidence** (2026-09). Client C1–C4 and server S1–S5 from this backlog
are **done**. What remains open is parked in [`followups-later.md`](followups-later.md).

**Do not treat this file as an active plan.** As-built contract: [`README.md`](README.md).
Seams: [`adr-instrument-clients-from-outside.md`](adr-instrument-clients-from-outside.md) ·
[`adr-server-pipeline.md`](adr-server-pipeline.md).

---

## What this file was

A measured backlog: client recorder cost (quadratic per-read re-parse), server null≠0,
per-frame sink lock, contiguous stamps / `overhead_us`, report integrity, and a deferred
**product** send-path track (P3/P4/P2/P1).

## Outcome

| Track | Result |
| --- | --- |
| Client C1–C4 | Done — streaming attributor, clock/integrity/binding, module split |
| Client C5 | Parked — [`followups-later.md`](followups-later.md) §1 |
| Server S1–S5 | Done — null≠0, sender clone, contiguous stamps, integrity, split modules |
| Product P-track | Deferred — [`followups-later.md`](followups-later.md) §3 |

The original long-form measurements and design drafts are in git history for this path if needed
(`git log -p -- docs/telemetry/plan-readability-and-performance.md`).
