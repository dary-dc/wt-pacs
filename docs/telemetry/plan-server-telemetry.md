# Plan: server telemetry — completed

**Status:** **S1–S5 done** (plus `RecordedPipeline` cleanup: live `Tap`, entry stamps, refuse finalize)  
**Seam:** [`adr-server-pipeline.md`](adr-server-pipeline.md) · **As-built:** [`README.md`](README.md)

| # | What | Status |
| --- | --- | --- |
| **S1** | Null ≠ 0 in distributions | **Done** |
| **S2** | Clone `SyncSender` into `Tap`; no per-frame global lock | **Done** |
| **S3** | Contiguous stamps + `overhead_us`; entry boundaries; refuse closes open stage | **Done** |
| **S4** | `summary.integrity` + honest dropped-records name | **Done** |
| **S5** | Split `tap` / `sink` / `report`; serialize `FrameRecord` directly | **Done** |
| **T1–T6** | Scale track (2026-09-06): batched emits, row file + histograms + timer summary, session rows, sampling, offline exact report, FoD cap, transport knobs. `ack_us` (T3) withdrawn | **Done** — [`analysis-scale-and-serving-path-2026-09-06.md`](analysis-scale-and-serving-path-2026-09-06.md); pending in [`followups-later.md`](followups-later.md) §6 |

**Not this track:** product send-path P3/P4/P2/P1 — [`followups-later.md`](followups-later.md) §3.

Historical design notes: [`plan-readability-and-performance.md`](plan-readability-and-performance.md).
