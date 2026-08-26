# Plan — port Kyber Viewer server timing to wt-pacs

**Date:** 2026-08-27 · **Status:** plan (not implemented)  
**Source of truth:** `fovia/kyber-viewer/server` `Record` / `Tap` under `feature = "telemetry"`  
**Guide:** `fovia/docs/kyber-fovia-pocs/Telemetry isolation — implementation guide.md` (I1/I2, R1–R10)

---

## 1. What Kyber actually does

Server timing is **not on the WebTransport wire**. It is a **write-only lab seam**:

| Piece | Role |
| ----- | ---- |
| `Record` + `Noop` | Always compiled. Product loop only talks to the trait. Methods return `()`. |
| `Tap` (`feature = "telemetry"`) | Clocks, per-session ask ordinals, bounded `try_send` ring, drain thread → JSON report |
| Stamp sites | `ask` → `stamp`/`located` (`frame_slice`) → `stamp`/`wrote` (envelope + send) |

**Metrics per ask:**

| Field | Span |
| ----- | ---- |
| `server_work_us` | locate (`frame_slice`) |
| `server_write_us` | wrap/send (includes QUIC flow-control wait) |
| `server_serve_us` | continuous `ask()` → emit |

Also: `frame_index`, `ask_ordinal`, `server_bytes_sent`, locate/write outcomes, `dropped_since_last`.

**How it reaches analysis:** process-local JSON (`KYBER_TELEMETRY=1`, optional path). Client join is **offline** on `(frame_index, ask_ordinal)`. Client `serveUs` stays `null` on purpose (R9 — wire unchanged).

**Invariants that matter:** production binary has **no** Tap/clocks/sink (I1); seam is write-only (I2); one `cfg` fork at session spawn (R10); hot path never blocks on telemetry (R6).

---

## 2. What wt-pacs has today

In `server/src/transport/server.rs` `send_one_frame`:

- Inline `Instant::now()` for **`work_us`** / **`write_us`**
- Emitted only as `tracing::debug!`
- **Boundary differs from Kyber:** `wrap()` is inside `work_us`; Kyber puts envelope work inside write
- No ordinals, no JSON report, no feature gate, no join key with the harness
- Clients already leave `serveUs: null` (same as Kyber Media-complete)

Harness owns **end-to-end** waits (`mean_wait_ms`, `wait_ms[]`). That stays; server Tap answers a different question (server CPU vs peer-blocked write under serial FoD).

---

## 3. Goal for wt-pacs

Bring the **same isolation model and metrics**, adapted to:

- `wtransport` + Media-complete uni (per-frame **or** `--shared-stream`)
- Lab harness correlation without putting timing on FoD
- E3 / E6 needs: cold locate cost, write-path cost under both stream layouts

**Non-goals (this port):**

- Putting `serve_us` on the wire
- Replacing harness `mean_wait_ms`
- Full OpenTelemetry / Prometheus stack
- Timing encode (we serve pre-baked bytes)

---

## 4. Design mapping

| Kyber | wt-pacs |
| ----- | ------- |
| `server/src/record/{mod,types,tap}.rs` | Same layout under `server/src/record/` |
| `feature = "telemetry"` | Same on `exact-server` crate |
| `KYBER_TELEMETRY` / `KYBER_TELEMETRY_PATH` | `WTPACS_TELEMETRY` / `WTPACS_TELEMETRY_PATH` (default `telemetry-server.json`) |
| `spawn_session` cfg fork | `handle_incoming` / session spawn in `transport/server.rs` |
| `send_selected` stamp sites | `send_one_frame` |
| Report JSON | Same shape: summary + `server_frames[]` + percentiles |
| Offline join | Harness already has per-step waits; add `ask_ordinal` on harness asks when correlating lab runs |

**Align locate vs write with Kyber (fix the current split):**

```
ask(idx)
t0 = stamp();  frame_slice → located(t0, …)     // work_us
t1 = stamp();  wrap + open/write/finish (or shared write) → wrote(t1, …)  // write_us
```

Tag each row with **stream architecture** (`per_frame` | `shared`) so E6 comparisons do not mix layouts.

---

## 5. Implementation phases

### Phase A — Seam only (no behaviour change)

1. Add `server/src/record/mod.rs` + `types.rs` (`LocateOutcome`, `WriteOutcome`, `Refusal`) mirroring Kyber.
2. Thread `R: Record` through `run_session` / `send_one_frame`.
3. Replace inline `Instant` with `rec.stamp()` / `ask` / `located` / `wrote`.
4. Default `Noop`; keep `debug!` optional later or drop once Tap exists.
5. Unit test: `Noop` is ZST; session still builds without `telemetry`.

**Exit:** production path identical; clocks only via seam.

### Phase B — Tap + JSON report

1. Port `tap.rs`: session id (counter, not time-based), ask ordinals, `FrameRecord`, `try_send`, drain thread, pretty JSON on last Drop.
2. Env gate: `WTPACS_TELEMETRY=1`.
3. Record `stream_mode` on each row.
4. Script: `server/scripts/verify_server_telemetry.py` (smoke: ask N frames → file has N rows, percentiles present).
5. Script: `server/scripts/check_telemetry_absent.sh` (default release binary has no Tap symbols / string).

**Exit:** lab can enable Tap and get `telemetry-server.json` without wire changes.

### Phase C — Lab join (optional but high value)

1. Document join key: `(frame_index, ask_ordinal)` — harness assigns ordinals the same way (per-session counter on each `RequestFrame`).
2. Small tool or notebook: join Tap rows to harness `wait_ms` samples for the same trace.
3. Do **not** change FoD / `WIRE.md`.

**Exit:** one offline table: server work/write/serve vs client wait for the same asks.

### Phase D — Use in experiments

| Experiment | How Tap helps |
| ---------- | ------------- |
| **E3** | `server_work_us` p99 under cold vs warm (alongside cold-page-bench) |
| **E6** | Compare `server_write_us` / `server_serve_us` on per-frame vs shared under loss (expect finish()-dominated write on per-frame) |
| **E1** | Confirm util ceilings are peer-blocked write, not locate |

Keep handoff rule: never quote local numbers for decisions; Tap files from cloud runs only when campaign runs on E2.

---

## 6. Risks and adaptations

| Risk | Mitigation |
| ---- | ---------- |
| `write_us` includes peer ACK / flow control (esp. `finish()` on per-frame) | Document; split later only if needed (`open_uni` / `write` / `finish` sub-stamps behind Tap, still R3) |
| Shared stream: no per-frame `finish` — write_us shrinks | Always label `stream_mode` |
| Serial loop coordinated omission (queue wait before `recv` not timed) | Same as Kyber; do not invent `queue_us` |
| Copying Kyber verbatim pulls forbidden names into MIT tree | Reimplement under wt-pacs names; no `kyber`/`fovia` in code or commit messages |
| Feature + prod-hardened mutual exclusion | Optional later; for now `telemetry` off by default is enough |

---

## 7. Suggested file checklist

```
server/Cargo.toml                          # feature telemetry
server/src/lib.rs                          # mod record
server/src/record/mod.rs                   # Record, Noop
server/src/record/types.rs
server/src/record/tap.rs                   # cfg(feature = "telemetry")
server/src/transport/server.rs             # generic R, one cfg fork
server/scripts/verify_server_telemetry.py
server/scripts/check_telemetry_absent.sh
docs/server-timing.md                      # short user-facing how-to (after Phase B)
```

Clients: **no change** required for Phase A–B (`serveUs` stays null).

---

## 8. Acceptance criteria

1. Default `cargo build -p exact-server --release` passes absence check (I1).
2. `--features telemetry` + `WTPACS_TELEMETRY=1` produces JSON with work/write/serve per ask.
3. Product loop has **zero** direct `Instant::now()` for telemetry (R3).
4. Wire / `WIRE.md` / FoD messages unchanged (R9).
5. Shared and per-frame paths both stamp; rows include `stream_mode`.
6. Verify script green on smoke fixture.

---

## 9. Effort order (do this, not more)

1. Phase A (½–1 day)  
2. Phase B (1–2 days)  
3. Wire into one cloud E6 or E3 run (Phase D light)  
4. Phase C only when correlating client wait to server write for a specific claim  

**Stop condition:** if absence check or write-only seam is hard to keep, do not ship a half-open telemetry path — keep debug logs until the seam is clean.
