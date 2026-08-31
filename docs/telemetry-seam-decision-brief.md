# Brief: telemetry seam decision (wt-pacs)

**Audience:** analyst / decision agent with no prior chat context.  
**Date:** 2026-08-30  
**Repo:** `wt-pacs` (WebTransport medical-frame delivery; Rust server + TS/WASM browser clients).  
**Status:** Decision B resolved earlier; **Decision C accepted 2026-08-31** (server
`FrameSink` decorator — see [`adr-server-frame-sink.md`](adr-server-frame-sink.md)).
Decision A (client stamp site) remains open.

---

## Problem in one paragraph

We need **latency telemetry** on the **receive path** (browser) and optionally a **aligned vocabulary** on the **send path** (server), without shipping measurement cost in production builds. A prior ADR chose to instrument the browser by **patching `WebTransport` and Proxy-wrapping I/O objects** so product `session.ts` / `session.rs` stay unchanged. That proxy sits **below** the framing loop: it sees **byte chunks**, not **frames**. Recovering per-frame `firstByte` / `lastByte` therefore needs extra logic (length-prefix / offset arithmetic). Separately, the **server** already has an inline `Recorder`/`Tap` with a **different schema**; replacing it is desired for readability and schema unity, but the browser Proxy pattern does **not** transfer cleanly to Rust/`wtransport`. A derived metric `path_estimate` (client ask→firstByte minus server serve time) was proposed via a join script; it is **rejected** as a product — keep independent `telemetry-client.json` and `telemetry-server.json` in a run folder.

---

## Constraints (hard)

1. **Production default build:** no telemetry code / symbols / report string literals (CI absence checks). Lab builds may enable via feature / separate entry.
2. **Both browser arms** (`transport-ts`, `transport-wasm`) must stamp at **identical** points or TS-vs-WASM comparison is void.
3. **Null ≠ 0:** absent stages export `null`, never fake zeros.
4. **Wire unchanged.** FoD control + length-prefixed media envelopes stay as today.
5. **Artifacts:** per run directory, two files — `telemetry-client.json`, `telemetry-server.json`. No merge/join pipeline.
6. **Decision A** still open for client stamp site; **Decision C implemented** (server FrameSink).

---

## System facts (minimal)

**Client:** app asks by display index over a bidi control stream; media returns on server uni streams as `[4B BE len][4B BE index][HTJ2K]`. Shared mode multiplexes many frames on one uni; per-frame mode uses one uni per frame. Product framing lives in private methods (`pumpFramedStream` / `readLengthPrefixed`). Public API: `connect`, `requestExactFrame`, `startExactFrames`, `waitExactFrame`, …

**Server:** `run_session` reads FoD; `send_one_frame` does
`ask → time_locate(frame_slice) → send_frame` (three `write_all`: len, index, mmap
codestream). Lab wraps the sink in `RecordedSink`. `RequestFrames` is one control message
then **N serial sends** — ask identity is per frame index via `sink.ask(idx)`.

**Already in tree (branch work):** external client install/Proxy; session wrap for gesture/delivered; §5.1-style byte attribution; harvest to run folders; draft server migration doc that **prematurely** picked “domain events” — treat that pick as **unapproved**.

---

## What we need to decide

### Decision A — Client: where to stamp frame-level boundaries

| Option | Mechanism | Edits product `session.*`? | Can split `transfer` vs `deliver`? | Notes |
| --- | --- | --- | --- | --- |
| **A1** | Proxy `reader.read()` only + reconstruct frames from bytes (current) | No | Yes (with attribution logic) | Works for both arms via one JS patch; arithmetic/partial parse cost |
| **A2** | Proxy/wrap **public session methods** only | No (wrap after `connect`) | **No** — totals / ask→done only | Already partly done (`wrapSession`); valuable for totals; insufficient alone for copy-vs-wire |
| **A3** | Instrument / wrap **framing helpers** inside session | **Yes** (helpers are private / in-module) | Yes, ideal | Cleanest stamps; breaks “zero product edits” ADR; must duplicate carefully in WASM arm or share one wrapping story |
| **A4** | Hybrid: A2 for totals + A1 for transfer, or A3 if ADR relaxed | Depends | Depends | State explicitly |

**Sub-question:** Is relaxing “no product file changes” acceptable if both arms stay schema-identical?

### Decision B — `path_estimate` / join

**Resolved direction from product owner:** do **not** ship join / `path_estimate` as a first-class output. Keep two independent JSON files. Any future derived path metric must be renamed for what it actually measures and stay optional offline analysis.

### Decision C — Server seam

| Option | Idea | Pros | Cons |
| --- | --- | --- | --- |
| **C1** | Keep current inline `rec.ask` / `located` / `wrote` | Known good; tested | Different schema; noisy product loop |
| **C2** | Wrap I/O (`SendStream::write_all`, FoD read) like client Proxy | Closest to browser ADR | No global to patch; `RequestFrames` needs explicit frame index at ask — wrap-only write cannot invent it |
| **C3** | Domain events at ask/locate/first/last byte, ZST subscriber | Readable loop; zero default cost | Not “Proxy”; was drafted without approval |
| **C4** | Other (analyst proposes) | — | Must meet hard constraints |

**Accepted (2026-08-31):** **C4 = planner Option B** — `FrameSink` + `LiveSink` /
`RecordedSink` decorator ([`adr-server-frame-sink.md`](adr-server-frame-sink.md)).
Product loop has no stamp/outcome lines; `ask(idx)` remains explicit on the trait; default
build never constructs `RecordedSink`. Report schema stays today’s Tap. Domain-events /
client-aligned vocabulary (draft server plan) remain a separate, unapproved migration.

---

## Evaluation criteria (use these)

1. **Stamp fidelity** — can we name stages without lying (especially transfer vs copy/`deliver`)?
2. **Arm parity** — TS and WASM identical stamp sites.
3. **Product invasiveness** — lines touched in shipped clients/server hot path.
4. **Default-build proof** — absence check still holds.
5. **Batch-ask correctness** — `RequestFrames` ordinals and per-frame server timing.
6. **Operability** — two-file harvest; no poorly named derived metrics required to “have telemetry.”
7. **Risk** — chance of regressing trusted server Tap numbers mid-lab.

---

## Deliverable from the analyst

1. Recommended **A** and **C** (B already directed).  
2. Short rationale against the criteria.  
3. What to **revoke or amend** in existing docs (`adr-instrument-clients-from-outside.md`, `client-frame-pipeline-telemetry-plan.md` §5.1/§10, draft `server-frame-pipeline-telemetry-plan.md`).  
4. Implementation order **only after** recommendation — do not code in the analysis pass.

---

## References in-repo

- `docs/adr-instrument-clients-from-outside.md` — client Proxy decision  
- `docs/client-frame-pipeline-telemetry-plan.md` — client contract, §5.1 arithmetic, §10 join (supersede join)  
- `docs/server-frame-pipeline-telemetry-plan.md` — **draft only**; “Chosen: domain events” is not an approved decision  
- `client/transport-ts/record/proxy.ts`, `wrap-session.ts`, `tap.ts`  
- `server/src/record/`, `server/src/transport/server.rs` (`send_one_frame`, `write_payload`)
