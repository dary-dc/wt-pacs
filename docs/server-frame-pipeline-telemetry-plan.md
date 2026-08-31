# Plan: migrate server telemetry to the frame-pipeline contract

**Status: DRAFT — seam option not approved.** Do not implement from this doc until
[`telemetry-seam-decision-brief.md`](telemetry-seam-decision-brief.md) Decision C is settled.
The “Chosen: domain events” section below is a **proposal only**, not a decision.

**2026-08-30** · companion to [`client-frame-pipeline-telemetry-plan.md`](client-frame-pipeline-telemetry-plan.md).

Goal: **one stamp vocabulary and report spine on both sides of the wire**, with server
session logic that reads as product code — not a forest of `rec.ask` / `rec.located` /
`rec.wrote` — while **default builds remain zero-cost** (no clocks, no sinks, absence check).

Arms in scope: `server/` (`exact-server`) only. Client seam stays external (ADR option G).

---

## 0 · Why change what already works

Today’s server Tap is correct for lab work and is feature-gated. It is also:

1. **A different schema** from the client frame-pipeline contract (`server_work_us` /
   `server_serve_us` vs `queue` / `serve_plus_path` / `transfer` / `deliver`).
2. **Inline in the hot loop** — `send_one_frame` is half product, half measurement.
3. **Hard to extend** when stages appear (queue between asks, write progress, refuse path)
   without adding more call sites.

The ADR deferred this rewrite because the Tap was the only trusted numbers in the tree.
That is no longer a reason to freeze the design: the client contract exists, and the cost of
two schemas (and a join script to subtract them) is exactly what we are refusing.

---

## 1 · Stamp contract on the server (normative)

Same boundary **meanings** as the client plan §4. Server has no gesture / decode / paint.
Map what exists; export `null` for the rest (null ≠ 0).

| Boundary | Server meaning | Phase 1 |
| --- | --- | --- |
| **gesture** | — | `null` |
| **ask** | FoD ask accepted for this `frame_index` (after parse, before locate) | **stamped** |
| **firstByte** | first `write_all` that places bytes for this frame on a send stream | **stamped** |
| **lastByte** | `write_all` completing the frame payload (len + envelope) | **stamped** |
| **delivered** | — (peer delivery is not observed here) | `null` |
| decode* / painted | — | `null` |

### 1.1 Stages (server view)

| Stage | Interval | Notes |
| --- | --- | --- |
| `queue` | gesture → ask | always `null` until a harness injects gesture |
| `locate` *(server-only, optional)* | ask → locate done | today’s `server_work_us`; keep as named stage or fold into serve |
| `serve` | ask → firstByte | server work before bytes hit the stream |
| `transfer_send` | firstByte → lastByte | send-buffer fill, **not** path RTT |
| `deliver` / decode* / paint | — | `null` |

Report field names must not silently reuse client names for different intervals.
Prefer:

- `serve_us` — ask → firstByte (replaces `server_serve_us` span that today includes write)
- `send_us` — firstByte → lastByte (replaces `server_write_us`)
- keep `ask_ordinal` / `frame_index` unchanged so offline pairing stays possible **without** a merge file

Headline / distributions follow the client spine where applicable:
`summary → server_frames → run_end`, nearest-rank percentiles, integrity block.

---

## 2 · Seam decision — what we are choosing

### Rejected for the server

| Option | Why not |
| --- | --- |
| **Patch `wtransport` types like the browser `WebTransport` global** | No single JS global. Streams are Rust values; there is nothing equivalent to “import install before client”. |
| **Keep today’s four call sites forever** | Readable product loop is the reason for this plan. |
| **Join script as the way to understand path** | Path is a derived quantity; raw artifacts stay two files (see §5). |

### Proposed (not approved): **domain events at natural boundaries, zero-sized subscriber**

> Supersede this pick via Decision C in `telemetry-seam-decision-brief.md` before any code.

```
product loop                          lab (feature = "telemetry")
────────────                          ───────────────────────────
read FoD ask  ──emit Ask(idx)──►      Tap / Noop
frame_slice   ──emit Located──►
write len     ──emit FirstByte─►
write body    ──emit LastByte──►
refuse/error  ──emit Refused───►
```

**Rules (non-negotiable):**

1. **One cfg fork at session start** — `let mut rec = Recorder::for_session();` remains the only
   place product code names the recorder type. Emit helpers are `#[inline(always)]` and
   compile to nothing without the feature (same discipline as today, fewer concepts).
2. **Product code never formats a report** — Tap owns clocks, ordinals, JSON.
3. **`ask(idx)` stays an explicit emit** carrying the frame index. Wrapping `frame_slice` /
   `write_all` alone cannot recover index under `RequestFrames` (one control message, N sends).
   That was the ADR’s real objection; this plan keeps ask as a typed event, not a positional guess.
4. **Default binary:** `size_of::<Recorder>() == 0`, absence script extended to new symbols /
   string literals (`serve_us`, `send_us`, `server_frames` if renamed).

### Readable loop shape (target)

```rust
// send_one_frame — product narrative
rec.on_ask(idx);
let bytes = match store.frame_slice(idx) {
    Ok(b) => { rec.on_located(b.len()); b }
    Err(e) => { rec.on_refused(...); /* write FrameError */ return Ok(()); }
};
let index = idx.to_be_bytes();
rec.on_first_byte();
write_payload(..., index, bytes).await?;
rec.on_last_byte(ENVELOPE_LEN + bytes.len());
```

Clocks live inside `rec` when the feature is on; product code does not call `Instant::now`.

---

## 3 · Batch asks (`RequestFrames`) — the hard case

Today: `rec.ask(idx)` inside `send_one_frame`, once per frame in the batch loop.
`serve_start` is per frame. That correctly excludes queueing behind earlier frames in
`server_serve_us`.

Under the new contract:

- **ask** timestamp for frame *k* in a batch = time `on_ask(k)` runs (still inside the loop).
- Optional integrity field: `batch_position` / `batch_size` on the row so fill analysis does
  not confuse server-side serial queue with path delay.
- **Do not** stamp one shared ask T0 for the whole `RequestFrames` on the server. That T0
  belongs to the **client** fill cell. Server rows stay per-frame.

This preserves the quantity the old join tried to recover (batch queue vs path) **inside the
server report itself**, without subtracting two files.

---

## 4 · Production interference budget

| Build | Cost |
| --- | --- |
| default (no `telemetry` feature) | No Tap module; Recorder ZST; emits are empty `#[inline(always)]`; absence CI fails on symbols / report string literals in the binary |
| `--features telemetry`, `WTPACS_TELEMETRY` unset | Tap type linked but `for_session()` returns inert / `None` — no sink thread, no clocks on emit if gated inside `if let Some(tap)` |
| feature + env on | Bounded ring, drain thread, JSON on last session drop — lab only |

Same absence script twin as today (`server/scripts/check_telemetry_absent.sh`), updated for new
field names.

---

## 5 · Artifacts — independent pieces, no join file

Harvest layout (matches preferred lab shape):

```text
.local/measurements/<stamp>-<study>-<arm>-…/
  telemetry-client.json    # browser Tap
  telemetry-server.json    # server Tap
```

**No merge step in the pipeline.** Both files carry `frame_index` + `ask_ordinal` so a human
or a later notebook can align rows if needed. Derived quantities (below) are optional and
must not be required to “have telemetry.”

### 5.1 What `path_estimate` was (and why we drop it as a first-class output)

Plan §10 defined:

```text
path_estimate_us ≈ client.serve_plus_path_us − server.server_serve_us
```

Intent: client’s ask→firstByte includes path + server work; subtract server work to guess path.
Under fill, the same difference also absorbed **server batch queueing**.

Problems:

- Requires two schemas and a join tool
- Directionally biased (server `write_all` ends at send buffer, not wire)
- Easy to misquote as RTT

**Replacement:** report server `serve_us` / `send_us` and client `serve_plus_path` / `transfer`
as **separate facts** in the two files. If path isolation is needed later, do it in analysis
from the two raw files — not as a shipped join product.

---

## 6 · Work plan

| Phase | Work | Done when |
| --- | --- | --- |
| **S0** | Freeze schema: row JSON, stage names, null policy, integrity fields; document vs old Tap | Spec table in this doc reviewed |
| **S1** | Implement new `Recorder` emits + Tap behind `telemetry`; dual-write old fields **or** version field `schema: "server-pipeline-v1"` | Feature build emits new rows; old consumers broken until updated (lab only) |
| **S2** | Rewrite `send_one_frame` / `run_session` to the narrative in §2; delete stamp-from-product `Instant` usage | `server.rs` readable without knowing Tap internals |
| **S3** | Nearest-rank only; unit tests; absence check updated | `check_telemetry_absent.sh` green; percentile test green |
| **S4** | Harvest: run folder with `telemetry-server.json` beside client file; delete join script if present | Layout matches §5 |
| **S5** | ADR amendment: server seam is domain events + ZST recorder; browser stays Proxy | ADR updated, this plan linked |
| **S6** | One localhost smoke + one shaped cell when rig free | Raw artifacts only |

**Do not** change the wire, stream mode logic, or `write_payload` copy discipline
([`WIRE.md`](WIRE.md) § Server send path) except to place emit points around existing writes.

---

## 7 · Mapping from today’s Tap → new rows

| Today | New |
| --- | --- |
| `ask` + `serve_start` | `on_ask` → ask stamp |
| `located` / `server_work_us` | `on_located` → optional `locate_us` or folded into `serve_us` |
| `wrote` / `server_write_us` | split: `on_first_byte` before first `write_all`, `on_last_byte` after |
| `server_serve_us` (ask→emit) | replace with `serve_us` + `send_us` |
| `ask_ordinal` | unchanged rule (`take_ordinal`) |
| `telemetry-server.json` | same filename; new schema version key |

---

## 8 · Risks and stop conditions

| Risk | Mitigation |
| --- | --- |
| Regress trusted lab numbers mid-campaign | Land on a branch; do not force L1/L2 to rebuild mid-grid; schema version in JSON |
| Accidental cost in default build | Absence script + `recorder_is_zero_sized` |
| Batch ask ordinal / queue confusion | Per-frame `on_ask`; optional `batch_*` fields; never one server T0 for `RequestFrames` |
| Scope creep into client Proxy-on-server | Explicitly out of scope (§2) |

Stop if a default-build absence check fails or if `send_one_frame` gains clocks outside `Recorder`.

---

## 9 · Out of scope

- Changing browser seam (stays external Proxy)
- Requiring a join / `path_estimate` product
- Decoder / paint stages on the server
- Merging client and server reports into one file

---

## 10 · Open questions (answer before S1)

1. Keep a transitional dual-write of old field names for one lab week, or hard cut with `schema: "server-pipeline-v1"`?
2. Is `locate_us` worth a separate stage, or always fold into `serve_us`?
3. Should `telemetry-server.json` move under `.local/measurements/<run>/` only, never CWD default?
