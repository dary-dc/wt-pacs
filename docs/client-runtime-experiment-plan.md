# Plan: WASM vs TypeScript client, same wire

**For:** wt-pacs implementer · 2026-08-29 · **Status:** planned — wire preconditions landed on this branch; still blocked on stream-mode remediation (§0) and shaped cells for N6

One question: **what does the WASM/JS boundary cost on the receive path?** Both clients in this repo
talk to the same server over the same wire, so the transport is held constant and the runtime is the
only variable.

This is the lab's own comparison. A later phase comparing against a different transport stack is
deliberately **not** in this repo and not in this plan.

---

## 0 · Where this sits

Current experiment state, so this plan is not read as jumping the queue.

| | status |
| --- | --- |
| **E1** saturation / `D_min` | **has data.** 6/6 on shared; per-mode `D_min` extended by X2 |
| **E2** cache-miss cost | **inconclusive** — `FAIL` rows in `E2_MISS_COST.tsv`, magnitude outside 20% |
| **E3** cold-page I/O | **has data** |
| **E4** does the formula pick the right `D`? | **void, not lost.** Ran in a dead cell — demand/supply ≈ 0.75, `frame_modulo: 3` gave 3 unique frames, so every wait was 0. Its own summary says *"FAIL in a dead cell is not evidence."* Needs a live cell |
| **E5** estimator error tolerance | **not started** — needs the harness to compute `D` itself |
| **X1** `finish()` gate | **PASS** |
| **X2** lossless mode comparison | **has data**, but the 18.2% gap at 150 ms RTT is **unexplained** |
| **X3** loss decider | **INVALID.** Unequal depths (shared `D_min` 2, per-frame 8, both run at `D=4`), a control that failed unnoticed (92% gap at **zero** loss), an overridden stop gate, p95 over ~4 tail samples, and an unexplained `mild_cell` timeout |
| Copy-cost knee sweep | **not started** (see [`WIRE.md`](WIRE.md) § Server send path) |
| **This plan (N6)** | preconditions P1–P3 landed on branch; still blocked on §0 remediation + shaped campaign |

**Do this first, before N6** — see [`stream-mode-remediation.md`](stream-mode-remediation.md):

1. **R1** correct the report — *done*, it now carries a retraction
2. **R2** explain the `mild_cell` timeout and X2's unexplained 150 ms gap. These are unexplained
   behaviours in our own code, and either may be worth more than the campaign was
3. **R3** wire `set_priority` — without it, per-frame is not the design worth testing
4. **R4** rerun X3, each arm at **its own** `D_min`
5. **R5** apply §0b's demand-÷-supply check before choosing any cell. Two of the three failed
   campaigns failed on **cell selection**, not execution

---

## 1 · Design — one shell, two adapters

The consuming code must be **identical** across arms. Only the module behind the interface changes.

```
        app shell  (one implementation)
   ask scheduling · decode step · paint · telemetry
                     │
              ┌──────┴──────┐
              ▼             ▼
     transport-ts     transport-wasm
     (JS, 8.4 KB)     (WASM, 248 KB)
              └──────┬──────┘
                     ▼
              exact-server  (same wire, same fixture)
```

Both already export the same six calls — `connect`, `requestExactFrame`, `startExactFrames`,
`waitExactFrame`, `stats`, `close` — so the shell selects by dynamic `import()` of a URL. **No arm
gets its own consumer code.** If a shell change is needed for one arm, it is needed for both.

The shell must actually *use* the bytes — hand them to the decode step and paint. A shell that only
counts bytes will not exercise the JS-heap copy, which is the thing under test.

---

## 2 · What is expected, stated before the run

Native JS gets a `Uint8Array` the browser already allocated. The WASM path receives into linear
memory and must then copy into the JS heap for the render stack. **So the WASM arm is predicted to
carry one extra full-frame copy per frame that the TS arm does not.**

State this now so a null result is informative and a large result is checked rather than believed.

---

## 3 · Preconditions

**P1–P3 are landed on this branch** (verified by local e2e: both arms, shared and per-frame).
**P4** is also fixed (WASM `RecvBuf` receive path). N6 is no longer blocked on client wire or
telemetry plumbing — it is blocked on §0 stream-mode remediation and a shaped link cell.

| | status |
| --- | --- |
| P1 wire framing | **landed** — length-prefixed envelope on both arms |
| P2 shared-mode reader | **landed** — framing loop over one long-lived uni |
| P3 client telemetry | **landed** — see [`telemetry/README.md`](telemetry/README.md) |
| P4 WASM receive copies | **landed** — `RecvBuf` cursor buffer; one JS-heap copy per frame |


**P1 · Wire framing — landed.** Both clients read `[4B BE len][4B BE index][codestream]` per frame.
TS: `readLengthPrefixed` → `unwrapEnvelope` in `pumpFramedStream`
(`client/transport-ts/session.ts`). WASM: `read_length_prefixed_frame` → `unwrap_envelope`
(`client/transport-wasm/src/session.rs`).

**P2 · Shared-mode reader — landed.** Both arms accept incoming uni streams and drain
length-prefixed envelopes until EOF — one uni carries many frames in shared mode. Per-frame mode
reuses the same parser on a uni that ends after one frame.

**P3 · Client telemetry — landed.** See [`telemetry/README.md`](telemetry/README.md). External
Proxy on `WebTransport` (ADR option G) instruments both arms from one implementation; default builds
contain no telemetry code (`client/scripts/check_telemetry_absent.sh`). Harvest:
`server/scripts/verify_e2e.py --telemetry`.

> **One schema, both arms, written once.** The Proxy seam enforces identical stamping; if the arms
> diverged, the comparison would be unmeasurable.

> **Open:** Decision A (byte attribution vs session totals) in
> [`telemetry/adr-instrument-clients-from-outside.md`](telemetry/adr-instrument-clients-from-outside.md).

Per-frame fields include `ask`, chunk stamps, `chunks`, `bytes`, `frameIndex`; per-session
`connectMs`. Transfer is non-degenerate when frames arrive in multiple reads.

**P4 · WASM receive copies — landed.** `RecvBuf` holds stream chunks with a cursor; one copy into
the JS heap via `js_buffer_from` per delivered frame. The old per-chunk `tmp` vec + triple-copy path
is gone.

---

## 4 · Method

| | |
| --- | --- |
| Arms | `transport-ts`, `transport-wasm` |
| Wire | identical — same server, same fixture, same `--stream-mode` |
| Link | **netem in a user netns.** RTT 20 / 60 / 150 ms, 10 Mbit |
| Depth | each arm at the **same** `D`, taken from E1/X2 `D_min` for the cell |
| Ordering | **interleaved** arms, not one after the other, so drift and thermal state cancel |
| Repeats | enough that p95 has more than a handful of tail samples — an 80-step trace does not |

**Do not run this on localhost.** Every term that could differ is RTT-proportional or
bandwidth-proportional, and at ~0 RTT the answer will be "no difference" for reasons that have
nothing to do with the question. X3 already produced one unusable result this way.

**Exclude frame 0 from all means**, or report it in its own row — WASM module fetch, compile and
instantiate land entirely on it.

---

## 5 · Metrics

Goal metric: **p95 time-to-displayable per frame.** Secondary, all per frame:

- `lastChunkMs − firstChunkMs` — the transfer term (non-degenerate with P3 telemetry)
- bytes copied into the JS heap, and count of copies
- transient allocation per frame (JS heap growth between frames)
- `connectMs`, reported separately, never folded into the per-frame mean

---

## 6 · Traps

- **`--read-bps 0`** whenever `tc` is shaping, or `LinkPacer` fights netem
- **Same `D` in both arms.** The last campaign's decisive flaw was unequal depth
- **A control that fails is a stop, not a footnote.** If the arms differ where they should not — same
  wire, no loss, low RTT — stop and explain it before running the rest
- **Nothing here goes above T2.** Synthetic netem, one machine

---

## 7 · Out of scope

- Comparison against any other transport stack — different repo, different server, different
  fixtures. Two codebases drifting independently cannot isolate one variable. **Second phase**
- Changing the wire. Both arms read what the server already writes
- `set_priority`, stream-mode decisions, and the X3 rerun — separate work
