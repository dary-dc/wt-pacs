# Plan: client telemetry (brief)

**Status:** **C1–C4 done** on this branch · **C5 deferred** (see
[`followups-later.md`](followups-later.md)) · **Seam unchanged:** Proxy / install outside product
([`adr-instrument-clients-from-outside.md`](adr-instrument-clients-from-outside.md))  
**Detail & evidence:** [`plan-readability-and-performance.md`](plan-readability-and-performance.md)

---

## Goal

Lab client reports that are **valid and cheap**, then a recorder that is **easy to read**.
Product `session.ts` stays free of Tap. Further surface compression is optional later.

---

## Design (as built — C1)

**Before:** each media `read` → keep all bytes → concat → re-parse all frames → re-walk all chunks  
(quadratic; corrupted `transfer` / `serve_plus_path` on fill runs).

**Now:** a **streaming attributor** per stream — walk each chunk once, keep ≤ 8 header bytes +
one open frame, emit timing when the last byte of a frame arrives. Same outputs; old
`attributeFrames` stays as the **test oracle**.

```
read(chunk, t) → Proxy → Tap.onMediaRead → StreamAttributor → row first/last/chunks/bytes
```

Modules: `attribution.ts` · `clock.ts` · `rows.ts` · `report.ts` · `tap.ts` (coordinator).

---

## Phases

| # | What | Status |
| --- | --- | --- |
| **C1** | Streaming attributor; oracle cross-check; drop retained `streamBytes` | **Done** |
| **C2** | Clock probe at `finish()`; row `Map`; safe min/max | **Done** |
| **C3** | `integrity.valid` + reasons; binding rollup; `mean_frame_bytes` | **Done** |
| **C4** | Split `tap.ts` → clock / rows / attribution / report | **Done** |
| **C5** | Compress surface (proxy factory; tighten entries) | **Later** — [`followups-later.md`](followups-later.md) §1 |

Server items in the big plan (null ≠ 0, sender clone, `overhead_us`, `render_report.py`) stay on
their own track when we turn to the server.

---

## Build artifacts

`client/transport-ts/dist/` is **gitignored**. Source of truth: `session.ts`, `record/*.ts`.  
Rebuild with `client/transport-ts/build.sh` (harness / e2e / absence scripts do this when missing).
