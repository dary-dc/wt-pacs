# Plan: WASM vs TypeScript client, same wire

**For:** wt-pacs implementer · 2026-08-29 · **Status:** planned, blocked on §3

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
| Copy-cost knee sweep | **not started** (`send-path-copy-costs.md`) |
| **This plan (N6)** | blocked on §3 |

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

## 3 · Preconditions — none of this runs until these are done

**Three of these four are product defects that need fixing regardless of this experiment.** Land them
on `main` on their own merits, not as experiment scaffolding. Only P3 is new capability, and it is
gated (see below).

| | product fix or scaffolding? |
| --- | --- |
| P1 clients behind the server wire | **product defect** — the shipped clients cannot read what the server writes |
| P2 no shared-stream reader | **product gap** — shared is the server's real-traffic mode |
| P3 client telemetry | **new capability — must be feature-gated, see P3** |
| P4 WASM triple copy | **product defect** |


**P1 · Both browser clients are behind the server wire.** The server writes
`[4B BE len][4B BE index][codestream]` in both stream modes. `transport-ts/session.ts:111-114` does
`readStreamToEnd(stream)` then `unwrapEnvelope(raw)`, which reads **the length prefix as the display
index**. `transport-wasm`'s `read_stream_to_end` has the same shape. Only `lab/window-harness` parses
the prefix correctly (`read_framed_paced` → `parse_length_prefixed`). Source-confirmed; not
reproduced in a browser.

**P2 · Neither browser client can read shared mode at all.** Both assume *one uni stream = one
frame*. Shared mode needs a framing loop over one long-lived stream. ~15–20 lines in TS, same in
Rust. Required, because shared is the mode the server defaults to for real traffic.

**P3 · There is no client telemetry in this repo.** Nothing named `record`, `tap`, or `telemetry`
exists under `client/`. The TS client has `timing.firstChunkMs` / `lastChunkMs`, but a single
`performance.now()` after `readStreamToEnd` makes them **always equal** — the transfer term is
degenerate today.

> **One schema, both arms, written once.** If the arms emit different fields or stamp at different
> points, the comparison is unmeasurable no matter how clean the shell is. This is the real gate.

> **Gate it like the server's.** The server compiles telemetry out by default — a `telemetry` cargo
> feature, a zero-sized `Recorder`, and `server/scripts/check_telemetry_absent.sh` proving absence in
> a default build. The client must follow the same discipline: **off by default, provably absent from
> a default build, with its own absence check.** Measurement capability is not a reason to ship
> measurement code.

Minimum fields per frame: `askMs`, `firstChunkMs`, `lastChunkMs`, `chunks`, `bytes`, `frameIndex`,
plus a per-session `connectMs` (module fetch → first ask on the wire).

**P4 · Fix the WASM client's own copy defect first.** `read_stream_to_end` allocates a `tmp` vec per
chunk, copies into it, copies again into `out`, then a third time into JS. Measuring that would
measure our bug, not the cost of WASM.

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

- `lastChunkMs − firstChunkMs` — the transfer term, non-degenerate once P3 lands
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
