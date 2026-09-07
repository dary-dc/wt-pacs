# Plan: client telemetry — completed

**Status:** **C1–C4 done** · **C5 parked** ([`followups-later.md`](followups-later.md) §1)  
**Seam:** unchanged — [`adr-instrument-clients-from-outside.md`](adr-instrument-clients-from-outside.md)  
**As-built:** [`README.md`](README.md)

| # | What | Status |
| --- | --- | --- |
| **C1** | Streaming attributor; oracle cross-check; drop retained `streamBytes` | **Done** |
| **C2** | Clock probe at `finish()`; row `Map`; safe min/max | **Done** |
| **C3** | `integrity.valid` + reasons; binding rollup; `mean_frame_bytes` | **Done** |
| **C4** | Split `tap.ts` → clock / rows / attribution / report | **Done** |
| **C5** | Compress Proxy/entry surface | **Later / maybe never** |

Evidence that motivated C1–C4 (quadratic recorder cost, etc.) lives in
[`plan-readability-and-performance.md`](plan-readability-and-performance.md) — historical.
