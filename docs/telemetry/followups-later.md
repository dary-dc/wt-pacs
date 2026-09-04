# Follow-ups (later — do not start now)

Parking lot for ideas that are useful but **not** the next work.
The active plan is [`plan-readability-and-performance.md`](plan-readability-and-performance.md)
(client streaming attribution first). Nothing here is scheduled until that plan’s
early phases land.

---

## 1 · Client recorder: compress the surface (after T1–T6)

Ideas that shrink lines without changing the outside-in seam
([`adr-instrument-clients-from-outside.md`](adr-instrument-clients-from-outside.md)):

- **Proxy factory** — `proxyReader` / `proxyWriter` / `proxyBidirectional` share the
  same “wrap stream, call Tap, re-expose” shape; one small factory may cut
  duplication in `record/proxy.ts`.
- **Entry files** — `session-telemetry.ts` is install + wrap only; whether product
  and lab entries can share more without pulling Tap into product remains open.
- Do **not** collapse this into T1. Streaming attribution is the validity fix;
  compression is readability after behaviour is correct.

---

## 2 · Product WASM receive buffer (`session.rs` RecvBuf / P4-style)

Keeping a custom receive buffer that reduces copies on the WASM client is still
interesting: it helps **product** efficiency, not only telemetry.

**Later ask (after the plan’s client/server telemetry phases):** is there a
simpler or less-code equivalent — fewer types, reuse of an existing buffer
abstraction, or a smaller API — that keeps the same copy reduction?

- Write that investigation down when we get there; **do not implement or redesign
  now.**
- Goal if revisited: same win, less surface — or confirm the custom buffer is
  already the minimal shape.

---

## 3 · Generated vs committed client bundles

| Artifact | Source | In git? | Notes |
| --- | --- | --- | --- |
| `dist/session.js` | `session.ts` via `build.sh` / `npm run build` | **Committed** | Convenience so the harness can load without a prior build. It is **generated**, not hand-edited. |
| `dist/session.telemetry.js` | `record/session-telemetry.ts` | **Gitignored** | Lab-only; rebuild with `client/transport-ts/build.sh`. |
| `record/dist/` | `install.ts`, etc. | **Gitignored** | Same. |

`session-telemetry.ts` only runs `install()` then wraps `TransportSession`. It is
**not** the attribution hot path (`tap.ts` / future streaming attributor).
If `session.telemetry.js` is missing on disk, run `build.sh` — that is expected,
not a missing source file.
