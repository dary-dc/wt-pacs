# Follow-ups (later — do not start now)

Parking lot outside the active **client** track
([`plan-client-telemetry.md`](plan-client-telemetry.md)).
Evidence dump: [`plan-readability-and-performance.md`](plan-readability-and-performance.md).

---

## 1 · Client surface compression

Tracked as **phase C5** in the client plan (after C1–C4). Ideas:

- **Proxy factory** — fold shared wrap logic in `record/proxy.ts`
- **Entry files** — share more between product and lab entries only if Tap stays out of product

Do not pull this forward ahead of streaming attribution.

---

## 2 · Product WASM receive buffer (`session.rs` RecvBuf)

Interesting for **product** copy reduction, not telemetry. After client/server telemetry
phases: ask whether a simpler / less-code equivalent keeps the same win. **Do not redesign now.**

---

## 3 · Generated client bundles

| Artifact | Source | In git? |
| --- | --- | --- |
| `dist/session.js` | `session.ts` | **No** — gitignored |
| `dist/session.telemetry.js` | `record/session-telemetry.ts` | **No** — gitignored |
| `record/dist/` | `install.ts`, etc. | **No** — gitignored |

Rebuild: `client/transport-ts/build.sh`. `session-telemetry.ts` is install + wrap only, not the
attribution hot path.
