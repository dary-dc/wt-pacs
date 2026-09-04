# Follow-ups (later — do not start now)

Parking lot for telemetry (and adjacent) improvements **after** the landed client work
(C1–C4 in [`plan-client-telemetry.md`](plan-client-telemetry.md)). Evidence dump:
[`plan-readability-and-performance.md`](plan-readability-and-performance.md).

**Pause:** take time to understand the streaming attributor, report fields, and the
`attribution` / `clock` / `rows` / `report` / `tap` split before picking anything below.

---

## 1 · Client surface compression (was plan C5)

**Why later:** behaviour and measurement validity are already fixed; this only shrinks code.
Worth doing once the as-built recorder is familiar — not as a substitute for understanding it.

Ideas (same outside-in seam; Tap stays out of product):

- **Proxy factory** — fold shared wrap logic in `record/proxy.ts`
- **Entry files** — share more between product and lab entries only if Tap stays out of product

Done when: fewer lines in `proxy.ts` / entries; product still clean under
`check_telemetry_absent.sh`.

---

## 2 · Product WASM receive buffer (`session.rs` RecvBuf)

Interesting for **product** copy reduction, not telemetry. Later: ask whether a simpler /
less-code equivalent keeps the same win. **Do not redesign now.**

---

## 3 · Generated client bundles

| Artifact | Source | In git? |
| --- | --- | --- |
| `dist/session.js` | `session.ts` | **No** — gitignored |
| `dist/session.telemetry.js` | `record/session-telemetry.ts` | **No** — gitignored |
| `record/dist/` | `install.ts`, etc. | **No** — gitignored |

Rebuild: `client/transport-ts/build.sh`. `session-telemetry.ts` is install + wrap only, not the
attribution hot path.
