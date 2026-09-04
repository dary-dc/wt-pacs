# Follow-ups (later — do not start now)

Parking lot for telemetry (and adjacent) improvements **after** the landed client work
(C1–C4 in [`plan-client-telemetry.md`](plan-client-telemetry.md)). Evidence dump:
[`plan-readability-and-performance.md`](plan-readability-and-performance.md).

**Pause:** take time to understand the streaming attributor, report fields, and the
`attribution` / `clock` / `rows` / `report` / `tap` split before picking anything below.

---

## 1 · Client surface compression (was plan C5)

**Status:** parked as **low value / maybe never** — not a planned next step.

It would only trim Proxy/entry boilerplate. It does **not** improve measurements or the
product boundary, and a generic “proxy factory” can make *which* method is tapped *harder* to
see. Only revisit if you are already editing `proxy.ts` for a real bug or new stream shape.

Ideas (if ever): fold shared wrap shell in `record/proxy.ts`; tighten lab entry files without
pulling Tap into product.


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
