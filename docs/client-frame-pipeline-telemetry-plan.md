# Plan: client frame-pipeline telemetry for wt-pacs

**2026-08-30** · adapts the generic contract *client frame-pipeline telemetry* to this repo.
Executes [`client-runtime-experiment-plan.md`](client-runtime-experiment-plan.md) §3 **P3**.
Seam decision recorded separately in
[`adr-instrument-clients-from-outside.md`](adr-instrument-clients-from-outside.md).
**Status: planned, not started.**

Arms: **`client/transport-ts/` and `client/transport-wasm/` only.**

---

## 0 · The one-paragraph version

The generic contract wants seven stamps from *user intent* to *pixels drawn*. This repo's browser
clients stop at `Uint8Array` — no decoder, no cache, no canvas — so three of the seven have no site.
We implement the whole contract, wire the four boundaries that exist, export the rest as **`null`
(never 0)**, and add one project-specific stage, **`deliver`**, for the receive-side copy cost.

**The recorder attaches from outside the clients.** It patches the `WebTransport` global and proxies
the objects the session acquires from it. **No product file changes, and the default build contains
no telemetry code at all** — not even a null object. The same JS patch instruments both arms, so the
two arms cannot stamp at different points.

---

## 1 · Gap analysis — the spec's system shape against this tree

| Spec component | This repo | Verdict |
| --- | --- | --- |
| Control: ask by display index | FoD on bidi control (`RequestFrame` / `RequestFrames`) | **exists** |
| Media: compressed bytes | `[4B BE len][4B BE index][HTJ2K]` on server uni | **exists** |
| Decode pool, bounded concurrency | — | **absent** |
| RAM cache of decoded frames | — | **absent** |
| Viewport draw callback | — | **absent** (`client/harness/*.html` is two buttons and a log div) |
| Lab recorder (Tap) | absent client-side; `server/src/record/` is a complete implementation | **see ADR — do not copy its seam** |

### 1.1 What the clients stamp today, and why it is degenerate

Both clients build a `timing` object with `askMs`, `firstChunkMs`, `lastChunkMs`, `chunks: 1`,
`serveUs: null`. One `performance.now()` is taken when the *complete* envelope has been parsed and is
written to **both** chunk fields, so `transfer` is always exactly 0 and `chunks` is a literal.

- `client/transport-ts/session.ts:135` — `const receivedMs = performance.now()` after `readLengthPrefixed`
- `client/transport-wasm/src/session.rs:134` — `let now = perf_now_ms()` in the same position

> **This is an artifact, not a property of the wire.** The spec's rule 6 warns that media-complete
> delivery *often* yields zero transfer. Here both clients genuinely read in chunks —
> `readLengthPrefixed` / `read_exact` loop over `reader.read()` — they simply never stamp a chunk.
> **Stamping per read makes `transfer` non-degenerate for any frame larger than one stream chunk**
> (a 250 KB frame on a 10 Mbit link is ~200 ms of real transfer).

Also stale: `askMs` is taken **before** the waiter is armed and before the FoD write is attempted, and
`startExactFrames` fires the control write with `void this.sendFod(...)`. Today's `askMs` precedes
"the request left the client" by an unbounded amount.

---

## 2 · Adaptation register — kept identical vs changed

The spec §9.3 requires this note. It is the first thing a reviewer should read.

### Kept identical (non-negotiable)

| | |
| --- | --- |
| Boundary **meanings** | gesture / ask / firstByte / lastByte / decodeDispatch / decodeDone / painted |
| Stage formulas | `queue`, `serve_plus_path`, `transfer`, `decode_wait`, `decode`, `paint` |
| Recorder owns the artifact | app code never formats a report |
| **Null ≠ 0** | absent stamps export `null`; a stage that ran and took no measurable time exports `0` |
| Report spine | `summary → client_frames → run_end` |
| Compare within a cell only | on-demand ↔ on-demand, fill ↔ fill |
| First write wins; marks after close ignored | |
| Units | integers in **µs** |

### Adapted, with reasons

| Change | Reason |
| --- | --- |
| **Seam is external** — global patch + proxies, not a `Recorder` handed into the session | See the ADR. The server's inline seam is right for the server and wrong here |
| **`decodeDispatch` / `decodeDone` / `painted` export `null`** | No decoder, cache or canvas exists. Zeros would be a lie the spec forbids |
| **New stage `deliver`** = lastByte → bytes handed to the app | Occupies the receive-side slot decode would occupy, and carries the WASM copy question. Permitted by §6 *Adapt* |
| **`interaction` rows close at `delivered`, not `painted`** | Paint has no site. Every row carries `closed_at` and `total_spans` so a total can never be read as gesture→paint |
| **Fill headlines `ask_to_first_paint` / `ask_to_last_paint` export `null`** | Analogues ship under **deliberately different names** — `ask_to_first_frame_complete`, `ask_to_last_frame_complete` — so a weaker metric is never silently substituted |
| **`transfer` excluded from `binding_term` when `chunks == 1`** | Never name transfer when it is structurally zero |
| **Nearest-rank percentiles** | `server/src/record/tap.rs:353` interpolates linearly. Reconciled in §10 |
| **Sink is a page-global getter** | A browser cannot write a file. Playwright harvests it |
| **`connect_ms` in `summary`** | Required by P3: module fetch → first ask on the wire |
| **`integrity` block in `summary`** | This repo's own lesson, not the spec's — §13 |
| **Byte counts, not timing, decide the copy question** | §5.3. A per-frame memcpy is below the clock floor |

---

## 3 · The seam — how the recorder attaches

Every boundary except `gesture` lives on an object the session obtains from `WebTransport`. Patch the
global before the client module loads, and proxy what it hands back.

```js
// record/install.js — telemetry entry point only; imported BEFORE the client module
const Real = globalThis.WebTransport;
globalThis.WebTransport = function (url, opts) {
  return new Proxy(new Real(url, opts), transportHandler);
};
```

| Boundary | Object proxied | Where it is stamped |
| --- | --- | --- |
| **ask** | control **writer** | `write()` called (plus `ask_flush` when its promise resolves) |
| **firstByte** / **lastByte** / **chunks** | media **reader** | each `read()` resolution — see §5.1 |
| **delivered** | the **session** | public method returns to the caller |
| **gesture** | — | supplied by the harness shell; `null` if absent (§12) |

**Both arms, one implementation.** `transport-wasm` calls `web_sys::WebTransport`, which is bindings
to the same JS global, so this patch instruments the WASM arm identically. The plan's hardest gate —
*"if the arms stamp at different points the comparison is unmeasurable"* — is dissolved rather than
enforced: it is the same code.

> **Use `Proxy` around the real object. Never a hand-rolled look-alike.** `transport-wasm` does
> `dyn_into::<ReadableStreamDefaultReader>()`, an `instanceof` check. A substitute object fails it and
> the WASM arm breaks. A `Proxy` forwards `getPrototypeOf`, so `instanceof` passes, and it forwards
> every property you forgot to think about.

Load order is the only requirement: `record/install.js` must be imported before `session.js`. ESM
evaluates imports in order, so this is deterministic — not a race.

---

## 4 · The stamp contract, as it applies here

Clock: `performance.now()` → `Math.round(ms * 1000)` µs. Both arms read the same clock.

| Boundary | Phase 1 |
| --- | --- |
| **gesture** — harness intent to show a frame, or bulk-ask T0 | shell, else `null` |
| **ask** — request leaves the client | **stamped** |
| **firstByte** — first read delivering bytes for this frame | **stamped** |
| **lastByte** — read completing `4 + len`, **before any copy** | **stamped** |
| **delivered** — app has the value *(new)* | **stamped** |
| decodeDispatch · decodeDone · painted | `null` |

### 4.1 Stage formulas

| Stage | Interval | Phase 1 |
| --- | --- | --- |
| `queue` | gesture → ask | yes, if gesture exists |
| `serve_plus_path` | ask → firstByte | yes — **path-level, not RTT** |
| `transfer` | firstByte → lastByte | yes |
| **`deliver`** | lastByte → delivered | **yes — new** |
| `decode_wait` / `decode` / `paint` | — | `null` |
| row `total` | preload: gesture→lastByte · interaction: gesture→delivered | yes, with `total_spans` |

**`binding_term`** = largest non-null among `queue`, `serve_plus_path`, `transfer`, `deliver` —
**excluding `transfer` when `chunks == 1`**.

---

## 5 · The three things that are actually hard

### 5.1 Attributing chunks to frames — arithmetic, not state

The reader proxy sees bytes, not frames. It records one log per stream: `(timestamp, cumulative
bytes)`. It never parses. Frames are recovered at flush from byte offsets, because each frame's wire
footprint is `4` (length prefix) `+ 4` (index) `+ codestream`:

```text
chunks      = [(10.0, 64), (10.4, 190), (11.1, 400), (11.9, 474)]
codestreams = [100, 200, 150]        ->  footprints [108, 208, 158]

frame 0: bytes[  0,108)   firstByte=10.0  lastByte=10.4  chunks=2
frame 1: bytes[108,316)   firstByte=10.4  lastByte=11.1  chunks=2
frame 2: bytes[316,474)   firstByte=11.1  lastByte=11.9  chunks=2

integrity: sum(footprints) == final cumulative  ->  474 == 474
```

`firstByte(k)` = first read whose cumulative passes frame *k*'s start; `lastByte(k)` = first read
reaching its end. Note frame 1's `firstByte` equals frame 0's `lastByte` — the shared-stream
carry-forward case falls out of the arithmetic instead of needing hand-maintained state in a read
loop.

**The last line is a free integrity check.** If footprints do not sum to the byte count, the report
declares itself invalid rather than publishing plausible numbers.

The footprint lengths come from a five-line length-prefix peek in the tap, reusing
`wire.ts`'s exported `parseLengthPrefixed` — **which today has no callers at all.** It is a partial
parser, not a duplicate one; adopting it is the nudge to make `session.ts` use the same function.

### 5.2 `read()` timestamps are not wire-arrival times — unavoidable

A `read()` resolves on the event loop. If the main thread is busy when bytes arrive, the browser
finishes what it is doing first, then reports. The stamp is late, and it is the browser being busy,
not the network being slow.

**No in-page approach avoids this**, so it is not a reason to change the seam. It matters in
proportion to what is being timed: 1 ms of jitter against a 200 ms transfer is irrelevant; against a
0.03 ms copy it is fatal. See §12.

*Optional one-off:* run the harness once under Chrome's `--log-net-log` in whatever environment has
it, and compare true wire arrival against `read()` stamps to quantify the offset. **Record the number
and move on — NetLog is never a dependency of the rig.**

### 5.3 The copy question is decided by byte counts, not by `deliver`

`client-runtime-experiment-plan.md` §2 predicts, before the run, that **the WASM arm carries one extra
full-frame copy per frame that the TS arm does not.** The current WASM receive path is worse:
`read_exact` copies chunk→`buf`, then `buf[4..4+len].to_vec()`, then `js_buffer_from` allocates and
`copy_from`, then `buf.drain(..)` memmoves the remainder — **three full-frame copies and a memmove**
(this is P4).

Stamping `lastByte` before any copy and `delivered` after puts that cost in `deliver` rather than
inflating `transfer`. **But a 250 KB copy is ~10–50 µs — at or below the clock floor and inside
event-loop jitter.**

> **So `deliver` timing is corroboration, not evidence.** The primary evidence is the **count**:
> bytes copied into the JS heap and number of copies per frame, which
> `client-runtime-experiment-plan.md` §5 already asks for. *"The WASM arm copies the frame three
> times, the TS arm once"* is a structural fact — no clock, no noise floor, nothing to argue with.

---

## 6 · The two cells map onto FoD ask granularity

| Spec cell | This wire | Row kind | Closed at |
| --- | --- | --- | --- |
| **on-demand** | `RequestFrame`, one per navigation step | `interaction` | `delivered` |
| **fill** | `RequestFrames`, one shared bulk ask (`startExactFrames` returns T0) | `preload` | `lastByte` |

`report_mode = "fill"` if any `preload` row exists, else `"ondemand"`.

> **A hazard the generic spec cannot know about.** `docs/WIRE.md`: `RequestFrames` is served as a
> **batch** — every frame is sent before the next control message is read — so it produces an
> effective outstanding depth of `N` regardless of the depth the client computed, and
> `adr-client-window-depth.md` **does not apply to it**. The fill cell is not merely a different
> workload; it is a **different server scheduling regime**. The report records `ask_granularity`, and
> fill numbers are never compared to interactive ones.

### 6.1 Shared-ask inflation, and the better estimate available here

Mid-burst `ask → firstByte` is inflated because many rows share one T0, so the **maximum** is the fill
wire span (spec §3.2). Kept. But because the server serves the batch strictly serially, the
**minimum** over the burst — the first frame — is the closest available estimate of true path latency.
Export the distribution, designate `max` as the fill wire-span headline, and carry `min` as
`first_of_burst_serve_plus_path`, with **frame 0 excluded** (WASM fetch, compile and instantiate land
entirely on it).

---

## 7 · Report shape (normative for this repo)

Order `summary → client_frames → run_end`, mirroring the server's `TelemetryReport`.

```jsonc
{
  "summary": {
    "report_mode": "fill",                  // or "ondemand"
    "arm": "transport-ts",                  // or "transport-wasm"
    "stream_mode": "shared",                // results NOT comparable across this
    "ask_granularity": "request_frames_batch",
    "stages_present": ["queue", "serve_plus_path", "transfer", "deliver"],
    "stages_absent":  ["decode_wait", "decode", "paint"],
    "connect_ms": 412.3,                    // never folded into per-frame means
    "headline": {
      "ask_to_first_paint": null,           // spec field, honestly null
      "ask_to_last_paint":  null,
      "ask_to_first_frame_complete_us": 118432,   // analogue, deliberately renamed
      "ask_to_last_frame_complete_us":  982104,
      "max_serve_plus_path_us": 780221,           // fill wire span
      "first_of_burst_serve_plus_path_us": 61140  // closest path estimate
    },
    "distributions": { "queue": {…}, "serve_plus_path": {…}, "transfer": {…},
                       "deliver": {…}, "total": {…}, "bytes": {…} },
    "copies": { "js_heap_bytes_per_frame": 768384, "copies_per_frame": 3 },  // §5.3 primary evidence
    "preload_to_decode": null,
    "cold_start": { "max_queue_us": 14210 },
    "integrity": {
      "rows_opened": 320, "rows_closed": 320, "rows_dropped": 0,
      "marks_after_close": 0, "first_write_conflicts": 0,
      "byte_closure_ok": true,              // §5.1
      "long_tasks": 3,
      "clock_resolution_us": 5, "cross_origin_isolated": true
    }
  },
  "client_frames": [
    {
      "kind": "preload",
      "frame_index": 42,
      "ask_ordinal": 0,                     // same rule as server Tap -> enables the join
      "source": "network",
      "queue_us": 120, "serve_plus_path_us": 61140, "transfer_us": 203885,
      "deliver_us": 1840,
      "decode_wait_us": null, "decode_us": null, "paint_us": null,
      "total_us": 266985,
      "total_spans": "gesture_to_last_byte",
      "closed_at": "last_byte",
      "bytes": 256128, "chunks": 14, "stall": null,
      "binding_term": "transfer"
    }
  ],
  "run_end": { "event": "run_end", "written_records": 320,
               "dropped_records": 0, "ring_capacity": 4096 }
}
```

**Distributions** carry `count, mean, median, min, max, total, p50, p75, p90, p95, p99` — the same
field set as the server's `DistributionStats`, **nearest-rank**, all µs.

**Headline gating is a recorder responsibility.** The recorder does not synthesise
`ask_to_last_paint` from a weaker signal; it emits `null` and names the analogue differently.

---

## 8 · Absence discipline

The external seam makes this short. **The default build of either client contains no telemetry code
at all** — no `Recorder`, no null object, no gated call sites. There is nothing to deactivate because
nothing was added.

| | Default artifact | Telemetry artifact |
| --- | --- | --- |
| TS | `dist/session.js` — product only | `dist/session.telemetry.js` — imports `record/install.js` first. **gitignored** |
| WASM | `pkg/` — product only | `pkg-telemetry/`, built with `--features telemetry` behind `WTPACS_TELEMETRY_BUILD=1`. **gitignored** |

`client/scripts/check_telemetry_absent.sh` (new, twin of the server's) fails if:

1. `dist/session.js` reaches `record/install.js`, or contains `__wtpacsTelemetry`, `binding_term`,
   `serve_plus_path`, `client_frames` or `preload_to_decode`.
2. `pkg/transport_wasm.js` exports anything matching `telemetry|Tap|report`.
3. **`pkg/transport_wasm_bg.wasm` contains the report's field-name string literals.** Release builds
   strip the name section, but `"serve_plus_path"` and `"binding_term"` live in the data section as
   serializer literals and survive — `grep -a` finds them. *This is the check that actually bites.*
4. `globalThis.WebTransport` is patched after loading the default bundle in a headless page.

Wire it into `.local/gate.sh` alongside the server's.

---

## 9 · Harvest — the report reaches `.local/measurements/`

Under the telemetry build only, the recorder installs one page global:

```js
window.__wtpacsTelemetry = () => report   // finished object, recorder-formatted
```

`server/scripts/verify_e2e.py` already drives Chromium via Playwright for both harnesses. It gains a
post-run step per arm:

```python
report = page.evaluate("() => window.__wtpacsTelemetry?.() ?? null")
if report is None:
    raise SystemExit(f"{label}: telemetry build expected but __wtpacsTelemetry absent")
out = ROOT / ".local/measurements" / f"telemetry-client-{label}-{stream_mode}-{cell}.json"
out.write_text(json.dumps(report, indent=2) + "\n")
```

New flags: `--telemetry`, `--cell {ondemand,fill}`, `--repeats N`, `--interleave` — alternating arms
rather than running one then the other, so drift and thermal state cancel.

---

## 10 · The server join, and the percentile reconciliation

**The join already exists in half.** The server Tap emits `ask_ordinal` per `frame_index` via
`take_ordinal`, and `lab/window-harness/src/client.rs:48` mirrors that rule exactly in `record_ask`.
The browser clients do not. Adding the same 0-based counter completes it:

```text
path_estimate_us(frame, ordinal) ≈ client.serve_plus_path_us − server.server_serve_us
```

Durations only — **no cross-machine absolute clock math** (spec §8).

**What it buys that neither side has alone.** Under a batch ask the server sets `serve_start` per
frame *inside* the batch loop (`server.rs:215`), so `server_serve_us` excludes queueing behind its
predecessors, while the client's `serve_plus_path` from the shared T0 includes it. The difference
**decomposes fill inflation into path versus server-side batch queueing** — the quantity the spec
warns about but cannot measure from one side. Ship `lab/scripts/join_client_server.py`.

Caveat: `server_serve_us` ends at `write_all` into the send buffer, not at bytes on the wire, so the
estimate is path *minus a little*, with a known and constant direction.

**Percentiles — fix the server, do not fork the rule.** The spec requires nearest-rank;
`server/src/record/tap.rs:353` interpolates linearly, and two reports computing p95 differently cannot
be joined. **No published document quotes a server-Tap percentile** (checked across `docs/` and
`.local/measurements/`), and every summary is recomputable from raw rows, so reconciling costs
nothing. Change the server to nearest-rank and pin it with a unit test over a vector where the two
rules disagree.

---

## 11 · Clock resolution — one change that decides whether µs are real

Chrome rounds `performance.now()` to **100 µs** by default, and to **5 µs** when the page is
**cross-origin isolated**. `server/dev-server.py:40` has an `end_headers` that does nothing, with the
comment *"Allow SharedArrayBuffer later; COOP/COEP optional for now."*

A stopwatch that displays whole seconds times a sprint fine and a blink not at all. At 100 µs
granularity a 30 µs stage reads as `0` or `100`, never `30` — and `deliver` and `queue` are routinely
that small. Everything the harness loads is same-origin, so:

```python
def end_headers(self):
    self.send_header("Cross-Origin-Opener-Policy", "same-origin")
    self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
    self.send_header("Cross-Origin-Resource-Policy", "same-origin")
    super().end_headers()
```

**Verify on the rig's actual Chrome before trusting it** — measure the minimum non-zero delta across a
tight `performance.now()` loop and record it as `integrity.clock_resolution_us` alongside
`cross_origin_isolated`.

---

## 12 · What you may quote

Clean instrumentation does not make a number trustworthy. This section is the licence; nothing
outside it is reportable.

| Stage | Typical magnitude | Quotable when |
| --- | --- | --- |
| `serve_plus_path` | RTT — tens of ms | **Shaped link only.** On localhost the true value is ~0 and jitter dominates |
| `transfer` | 250 KB @ 10 Mbit ≈ 200 ms | Yes. Jitter is a small fraction |
| `queue` | often < 100 µs | Only with cross-origin isolation, and only if `gesture` exists |
| `deliver` | 250 KB copy ≈ 10–50 µs | **Never on its own.** Corroboration for §5.3's byte counts, never the claim |
| `copies` / `js_heap_bytes_per_frame` | structural | **Always** — no clock involved |

Also binding on every run:

- **Exclude frame 0** from all means, or give it its own row.
- **Never compare across `stream_mode`, across cells, or against the native harness.**
- **Nothing goes above T2.** One machine, synthetic netem. Cleaner instrumentation does not raise the
  evidence tier.
- A run whose `integrity` block shows `rows_opened != rows_closed`, `byte_closure_ok: false`, or a
  materially different `long_tasks` count between arms is **void, not a footnote.**

---

## 13 · Traps

Spec §7 applies unchanged. These are this project's own; three are already scar tissue in the tree.

| Trap | Wrong conclusion | Guard |
| --- | --- | --- |
| **Rows opened ≠ rows closed** | Every number from the run is void, silently | `integrity`. `PEAK_OUTSTANDING` (`lab/window-harness/src/client.rs:19`) exists because *"two bugs violated exactly this and went undetected across three campaigns"* |
| Hand-rolled reader instead of `Proxy` | WASM arm breaks on `dyn_into` | §3 |
| `install.js` imported after the client | Patch misses; report is silently empty | Absence check item 4 inverted as a presence check |
| 100 µs clock rounding | Sub-100 µs stages read as 0 | §11 |
| Timing the copy | A 20 µs difference that is really jitter | §5.3 — count bytes |
| Fill numbers compared to interactive | Depth-*N* batch vs computed-*D* pipeline | `ask_granularity` |
| Compared across `stream_mode` | Arm gap that is really an architecture gap | `stream_mode` in every report |
| Frame 0 in the mean | WASM fetch + compile charged to the transport | Exclude |
| Running on localhost | "No difference", for unrelated reasons | netem in a user netns. X3 already produced one unusable result this way |
| `transfer` named as binding on a single-chunk frame | Blaming the wire for a structural zero | `chunks == 1` exclusion |
| Client and server percentiles by different rules | A join comparing unlike numbers | §10 |

---

## 14 · Work plan

**The recorder lands before P4 is fixed, so the fix is proven rather than assumed.**

| Phase | Work | Files | Done when |
| --- | --- | --- | --- |
| **0** | Clock resolution + isolation | `server/dev-server.py` | `crossOriginIsolated === true`; measured resolution recorded |
| **1** | **The seam.** Global patch + transport/writer/reader/session proxies; no report yet | `client/transport-ts/record/`, `client/transport-wasm/` telemetry build | Both arms run unmodified against the patched global; absence checks pass |
| **2** | **Stamps + offset arithmetic** (§5.1); row kinds; first-write-wins | `record/tap.ts` | Stage-math tests pass; `byte_closure_ok` true on a clean run |
| **3** | **Report.** Spine, nearest-rank distributions, binding term, integrity block, headline gating, `copies` | `record/tap.ts` | Validates against §7; headline nulls present, not omitted |
| **4** | **Harvest** | `server/scripts/verify_e2e.py` | `.local/measurements/telemetry-client-*.json` for both arms, both cells |
| **5** | **Cells.** on-demand trace + fill batch, interleaved arms, repeats | `verify_e2e.py`, `client/harness/*.html` | Both cells produce §7 headlines; frame 0 separated |
| **6** | **Server join + percentile fix** | `lab/scripts/join_client_server.py`, `server/src/record/tap.rs` | Path estimate and batch-queue decomposition produced |
| **7** | **P4 — fix the WASM copy path, re-measure** | `client/transport-wasm/src/session.rs` | `copies_per_frame` before vs after, both reported |
| **8** | Trap checklist signed off (§13), adaptation note written (§2) | `docs/measurements/` | Results reportable; nothing above T2 |

### 14.1 Tests

- Stage math from synthetic marks; the §5.1 offset arithmetic against a known chunk log.
- **Null ≠ 0**: no `decodeDone` ⇒ `decode: null`; `transfer` with `chunks == 1` ⇒ `0`, excluded from
  `binding_term`.
- First write wins; a mark after close is ignored **and increments `marks_after_close`**.
- `preload` rows close without a paint; `interaction` rows close at `delivered`.
- **Adapted form of the spec's required fill test:** the report emits `ask_to_last_paint: null` and
  `ask_to_last_frame_complete_us == T0 → max(lastByte)`. A report that fills `ask_to_last_paint` with
  the analogue **fails**.
- `byte_closure_ok` false when a chunk log is truncated.
- Nearest-rank percentile over a vector where interpolation disagrees, on client and server.
- **`instanceof` survives the proxy** — `dyn_into::<ReadableStreamDefaultReader>()` succeeds in the
  WASM arm under the patched global.
- Absence: default TS bundle and default WASM binary, per §8.

---

## 15 · When a stage binds — what to change

| Binding | Levers in this repo |
| --- | --- |
| `serve_plus_path` | Stream mode (**S vs Q is still open**), ask depth `D` (`adr-client-window-depth.md`), `set_priority`, server serve — measurable via the §10 join |
| `transfer` | Link-bound. Send fewer bytes: `adr-resolution-fitting-for-large-frames.md`, `adr-stride-is-bandwidth-conservation.md` |
| `deliver` / `copies` | **P4** — the WASM receive path's three full-frame copies and a memmove |
| `queue` | Shell scheduling; in fill mode, batch queueing behind earlier frames — isolated by the §10 join |
| `decode_wait` / `decode` / `paint` | Nothing yet. When a decoder lands, these are the first sites |

**Do not "win" a metric by moving stamps**, closing `interaction` rows early, or promoting
`ask_to_last_frame_complete` into the paint headline.

---

## 16 · Out of scope

- Any decoder, decode pool, RAM cache or canvas. When they land, this contract already has their slots
  and their `null`s become numbers — **no report-shape change is needed**.
- `lab/window-harness` and `lab/cold-page-bench`. §10's percentile fix is the only place the two worlds
  are made to agree.
- NetLog as a rig dependency (§5.2). One-off calibration only.
- Comparison against any other transport stack.
- Any change to the wire.

## 17 · Open questions

1. **Does `crossOriginIsolated` deliver 5 µs on the rig's Chrome?** Phase 0 answers it. If not,
   `queue` is reportable only as a distribution over many frames, never per-row.
2. **Does the byte count separate the arms cleanly** once P4 is fixed? If the fixed WASM path copies
   the same number of bytes as TS, the N6 question is answered structurally and no timing is needed.
3. **Where does `gesture` come from outside a harness?** In an environment with no shell, `queue`
   exports `null` and the contract still holds. Whether a synthesised gesture is close enough to a
   human one is worth stating before the run, not after.
