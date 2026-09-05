# Follow-ups (later — do not start now)

Parking lot after landed client C1–C4 and server S1–S5. As-built contract: [`README.md`](README.md).
Seams: [`adr-instrument-clients-from-outside.md`](adr-instrument-clients-from-outside.md) ·
[`adr-server-pipeline.md`](adr-server-pipeline.md).

**Pause:** understand the streaming attributor, report fields, and the
`attribution` / `clock` / `rows` / `report` / `tap` split before picking anything below.

---

## 1 · Client surface compression (was C5)

**Status:** parked — **low value / maybe never**.

Would only trim Proxy/entry boilerplate. Does not improve measurements or the product boundary;
a generic proxy factory can make *which* method is tapped harder to see. Revisit only if already
editing `proxy.ts` for a real bug or new stream shape.

---

## 2 · Product WASM receive buffer (`session.rs` RecvBuf)

Product copy reduction, not telemetry. Later: ask whether a simpler / less-code equivalent keeps
the same win. **Do not redesign now.**

---

## 3 · Product send path (P3 → P4 → measure P2 → maybe P1)

**Deferred.** Not telemetry. Order: small wire/ack wins first, then measure batch prefault, only
then consider overlapping prefault with send (the only item that changes the serial pipeline story
in the server ADR).

| # | Change | Risk |
| --- | --- | --- |
| **P3** | One 8-byte header write instead of two 4-byte awaits | Low |
| **P4** | Reap acks incrementally each send (`try_join_next`) | Low |
| **P2** | Batch prefault for one `RequestFrames` (one `spawn_blocking`) | Low — measure |
| **P1** | Overlap prefault(k+1) with send(k) | Medium — ADR story change |

P1 and P2 are alternatives, not a sequence. Full-frame `wrap()` copy is already gone.

---

## 4 · Build artifacts (reminder)

| Artifact | Source | In git? |
| --- | --- | --- |
| `dist/session.js` | `session.ts` | **No** — gitignored |
| `dist/session.telemetry.js` | `record/session-telemetry.ts` | **No** — gitignored |
| `record/dist/` | `install.ts`, etc. | **No** — gitignored |

Rebuild: `client/transport-ts/build.sh`.
