# Plan: client telemetry (brief)

**Status:** C1–C4 implemented on this branch · **Seam unchanged:** Proxy / install outside product
([`adr-instrument-clients-from-outside.md`](adr-instrument-clients-from-outside.md))  
**Detail & evidence:** [`plan-readability-and-performance.md`](plan-readability-and-performance.md)  
**Parked later:** [`followups-later.md`](followups-later.md) (C5 compression, RecvBuf, etc.)

---

## Goal

Make lab client reports **valid and cheap**, then make the recorder **easier to read**, then
**compress** duplicated surface. Product `session.ts` stays free of Tap.

---

## Design change (the important part)

**Today:** each media `read` → keep all bytes → concat → re-parse all frames → re-walk all chunks.  
Quadratic; blocks the main thread; **corrupts `transfer` / `serve_plus_path`** on fill runs.

**Next:** a **streaming attributor** per stream — walk each chunk once, keep ≤ 8 header bytes +
one open frame, emit timing when the last byte of a frame arrives. Same outputs; old
`attributeFrames` stays as the **test oracle**.

```
read(chunk, t) → Proxy → Tap.onMediaRead → StreamAttributor → row first/last/chunks/bytes
```

---

## Phases (client only)

| # | What | Why |
| --- | --- | --- |
| **C1** | Streaming attributor behind Tap; randomized cross-check vs `attributeFrames`; drop retained `streamBytes` | Measurement validity + O(1) memory |
| **C2** | Clock probe out of Tap constructor (after run / explicit pre-install); row `Map` index; safe min/max | Stop inflating `connect_ms`; kill small quadratic lookups |
| **C3** | Report: `integrity.valid` + reasons; binding rollup; honest field names | One place to see if a run is void |
| **C4** | Split `tap.ts` → clock / rows / attribution / report (coordinator stays) | Readability; no behaviour change |
| **C5** | Compress surface: proxy factory; tighten lab entry files if safe | Less code; same outside-in seam |

**C1 first and alone.** Re-harvest fill cells only after it lands.  
**C5 after C4** — compression is not a substitute for the attributor.

Server/report items in the big plan (null ≠ 0, sender clone, `overhead_us`, `render_report.py`)
are **out of this client track**; do them on their own phases when we turn to the server.

---

## Done when (per phase)

- **C1:** ≥300 randomized cases match oracle; existing record tests green; recorder cost linear on a replay bench  
- **C2:** probe not inside `connect_ms`; probe cost in `integrity`  
- **C3:** void run shows `valid: false` + reasons; absence greps updated for new names  
- **C4:** same JSON on a replayed input as post-C3  
- **C5:** fewer lines in `proxy.ts` / entries; product still clean under `check_telemetry_absent.sh`

---

## Build artifacts

`client/transport-ts/dist/` is **gitignored**. Source of truth: `session.ts`, `record/*.ts`.  
Rebuild with `client/transport-ts/build.sh` (harness / e2e / absence scripts do this when missing).
