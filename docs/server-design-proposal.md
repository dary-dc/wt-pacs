# Server design proposal — for the owner's approval

A design review of `server/`, `common/` and `ingest/` (written at `6d3a0e8`, before the RV7 batch)
re-checked line by line at `4a45122` (PR #33's head). Every file:line below is at `4a45122`. This file
is the design the server PR builds from; it goes when the PR lands, and what it decides moves into the
ADRs it names.

**What moved since the review.** RV7 fixed three of the review's findings: `b694ca4` (#4, the ring),
`a47e547` (#2, a client's close) and `ff5bfae` (#1's telemetry row). It also settled W1–W3
(`04823e0`, `88e4e40`, `6cca05f`), which unblocks #10, and W9 (`d87e5e1`, `frame_head` in
`frame-envelope`), which #9 builds on. RV6 moved the ADRs into `docs/adr/`. W4 (the `per-frame`
stream mode) and W16 (the lab stall, `--stall-after-bytes`) is decided: it stays (D2). W4 is
still open. It decides how big #3 is.

## Verdicts

| # | Proposal | Verdict |
| --- | --- | --- |
| 1 | The planner decides everything an ask needs; one refusal path | **CHANGED.** The wrong telemetry row is fixed. The structure (two range checks, two refusal paths, `Mode` + `upcoming`, fill-count plumbing) holds |
| 2 | A peer closing the session is not an error | **GONE**, with one leftover: a close during session setup still logs WARN |
| 3 | One writer per session (`Link`) | **HOLDS.** Its size depends on W4 and W16 |
| 4 | The ring's drop can free buffers in flight | **GONE** |
| 5 | Module layout follows the frame; `server.rs` split | **HOLDS** |
| 6 | Pipeline steps `read` / `write` instead of `prepare` / `locate` / `send` | **HOLDS.** The review named the wrong measurement tool, and `overhead_us` turns out to be rounding only |
| 7 | `t_ask_us` is stamped at serve start, not at arrival | **HOLDS** |
| 8 | Names that hide what things do | **HOLDS**, minus `Control`'s history; folded into 1, 3, 5, 6 |
| 9 | The 64 MiB frame limit is declared many times and checked by nobody upstream | **HOLDS.** The details changed (W9 landed; the list of declarations differs) |
| 10 | `TransportTuning` derives `clap::Args` | **HOLDS, now unblocked** (W1–W3 done) |

---

## 1 · The planner decides everything an ask needs — CHANGED

**In plain words.** The *planner* is the pure function that looks at the asks the session holds
and says what to do next: serve frame N, refuse it, wait, or end. The *pipeline* then serves the
frame. Today the two share the decisions. The planner checks a fill's range, and the pipeline
checks a single frame's range. Either one can refuse. The proposal moves every decision into the
planner, so the pipeline only executes.

**The telemetry bug is fixed.** `Tap::emit_refused` now opens its own row when none is open
(`server/src/record/tap.rs:338-341`, "A refusal no frame opened, the planner's, opens its own row
first"). The test `a_refused_range_records_a_row_of_its_own` (`transport/pipeline.rs:409-440`)
asserts rows `[(1,0),(6,2),(99,2)]` and `rows_opened == rows_closed == 3`. RV7 ran both mutants.
So the correctness argument for #1 is gone, and #1 is now a simplification.

**What still holds (evidence at `4a45122`).**
* **Three range checks.** The planner checks a fill (`planner.rs:118-129`, through `fill_range`
  `:150-161`). The pipeline checks a frame in `locate` → `store.frame_span`, and an `Err` there
  refuses (`pipeline.rs:30-33`, `46-48`; `media/frame_store.rs:72-78`). `parse_open_ask` checks
  both again (`server.rs:352-356`). The wire text comes from two places: `format!` in
  `planner.rs:157`, and the `anyhow` context in `frame_store.rs:77`. `WIRE.md:39` documents both
  texts.
* **Two refusal paths.** One goes `steps` → `pipeline.refuse` for `Step::Refuse`
  (`server.rs:396-398`). The other is `serve` → `refuse` when `locate` fails (`pipeline.rs:32`).
* **`mode` and `upcoming`, read two ways.** `Mode` (`planner.rs:32-35`) says which reader serves.
  The fill reader takes `ahead.first()` (`pipeline.rs:137`). The tile reader takes `slots − 1`
  (`media/read_path.rs:319`). `.take(ASKS_AHEAD)` (`planner.rs:137`) cuts nothing: `in_hand` is
  filled to at most 8 and has just lost one.
* **Fill counting for one log field.** Two bools (`planner.rs:57-58`), set at `:97-100`, `:108`
  and `:121`. Then `take_noted_fill` (`:77-79`), a call in `steps` (`server.rs:387-389`), a trait
  method (`pipeline.rs:63`), and two implementations (`:180-182`, `:281-283`). It all feeds
  `fills=` in the `session reads` line (`docs/adr/disk-access.md:393`). Nothing in `lab/` or
  `scripts/` parses that field.
* **A doc claim still wrong.** `docs/adr/frame-framing-and-loop-shape.md:324` (invariant 4) says
  "Capacity `ASKS_AHEAD`, shared with `in_hand`". The code holds up to 8 in the channel
  (`server.rs:171`) **and** 8 in `in_hand` (`planner.rs:88`). Correct the doc, not the code.

**New finding: a refusal of the opening ask cannot happen.** `parse_open_ask` drops an
out-of-range `?ask=` before the session starts (`server.rs:352-356`), so the opening ask is never
refused. `WIRE.md:152-153` ("A refusal of an opening ask waits for the control stream") describes
a case that cannot occur. Every other refusal follows an ask read from the control stream, and
the reader hands over the stream's send half before it reads (`server.rs:294-296`). So
`late_control`'s wait never actually blocks. Correct that WIRE.md sentence in this commit.

**Shape (review's sketch, corrected).** Make the range check two small functions instead of one
`admit`. A fill check already exists. `parse_open_ask` calls them with `.ok()`, which keeps its
"ignored" rule.
```rust
pub enum Step {
    Serve { frame: u32, next: Next },        // frame and every name already in range
    Refuse { frame: u32, reason: String },   // the only source of refusal text
    Wait,
    End,
}
pub enum Next {
    Fill { after: Option<u32>, first: bool }, // SeqReader; `first` counts `fills=`
    Tiles(Vec<u32>),                          // in-range names, ask order; the reader takes what fits
}
pub fn frame_in_range(frame: u32, frames: u32) -> Result<(), String>; // "frame index N out of range (count)"
pub fn fill_range(from: Option<u32>, to: Option<u32>, frames: u32) -> Result<(u32, u32), String>;
```
* An out-of-range name behind the served frame is **skipped, not a stop**. That is what
  `an_upcoming_frame_out_of_range_is_dropped_not_refused` (`pipeline.rs:387`) pins today, and the
  reads must stay identical.
* `FrameStore::frame_span` becomes an infallible lookup, with one invariant line ("the planner
  refuses out of range"). A bug that broke the invariant would panic one session task, not the
  process.
* `Mode`, `note_fill`, `count_this_fill`, `take_noted_fill` and `FramePipeline::note_fill` go.
  `ProductPipeline` adds one to `fills` when it sees `Next::Fill { first: true }`.
* With one refusal path, `emit_refused` never finds a row already open. Its "close prepare or
  locate" branches (`tap.rs:343-347`) go in #6.

**Tests and mutants.**
* `a_frame_out_of_range_is_refused_by_the_planner`: Frame(99) of 4 gives `Refuse{99, "frame index
  99 out of range (4)"}`. Mutant: `frame_in_range` always `Ok`.
* `an_out_of_range_name_is_skipped_not_a_stop`: in hand [1, 99, 2] gives `Tiles([2])`. Mutant:
  `take_while` in place of `filter`.
* `a_fill_counts_once_and_a_cancelled_fill_not_at_all` replaces the two counting tests. Mutant:
  `first` always true.
* Extend `a_refused_range_records_a_row_of_its_own` to assert the Frame(99) row is its own too.
  Mutant: no `begin_frame` in `emit_refused`.
* One test pins both reason strings to `WIRE.md:39`'s text. Mutant: change either `format!`.
* These carry over: the planner tests, `an_opening_ask_is_taken_only_whole_and_in_range`,
  `request_frame_during_fill_switches_to_on_demand` and the gate's wire ask-during-fill.

**Measurement: yes, a tie to confirm.** The same names should reach the same readers.
`lab/scripts/server_ab.sh <commit before #1>` is the interleaved before/after harness built for
this read path. Each round runs both arms on cold d1/d2/d4, warm d1/d4 and fill. Its `named ≥ 2`
guard fails if the tile reader stops receiving names, which is this change's exact risk. Quote its
p50 per-ask verdict (latency), not asks/s. Run it on the workstation under the rig lock, with its
own `CARGO_TARGET_DIR`. It runs on loopback, so claim nothing beyond "tie on this host". This
replaces the review's bare `window-harness --mode saturate --depth 4`, which is one cell of the
same thing.

**Effort.** ~1 day.

## 2 · A peer closing the session is not an error — GONE (one leftover)

**In plain words.** Every session ends with the client closing the connection. That used to log
a WARN and skip the per-frame grace period. RV7 made a client's close an ordinary end.

**Evidence it is fixed.**
* `read_fod_msg` returns `Ok(None)` on a clean FIN (`transport/wire.rs:23-36`).
* `forward` stops the reader on `None` without an error ask (`server.rs:424`).
* `drive` drains however the loop ends (`server.rs:377-381`; test
  `the_loop_drains_its_finishes_however_the_asks_end`, `:558`). So `WIRE.md:85`'s "waits up to
  2 s … however it ends" is true.
* `closed_by_peer` (`server.rs:320-334`) classifies named error variants plus quinn's close
  reason, and the result is `info!("session closed by peer")` (`:308-311`).
* On the WebSocket, `Close` and EOF give `Ok(None)` (`websocket.rs:163`), plus a `closed` flag
  (`:133-138`, `:148`).
* Tests: `a_client_that_closes_after_its_frames_…`, `…finishes_its_control_stream…`,
  `a_websocket_close_…` (`:641-691`), with guards for the malformed-ask and timeout cases.

**Leftover, a small correctness item (log level only).** The classification covers only the result
of `sessions.serve` (`server.rs:308`). Setup steps still take an early `?`: `accept` (`:282`),
`FrameOut::open` in the opening-ask path (`:290`, the default path), and `accept_bi` /
`FrameOut::open` (`:301-302`). Each of these errors reaches `warn!(%err, "session ended")`
(`:137`). A client that dials and goes away before its first frame (an abandoned dial, a
re-dial) therefore still logs a WARN. Fix: run the post-accept body as one `async` block and
classify its result once.

**Test and mutant.** `a_client_that_closes_right_after_the_accept_ends_cleanly`: close before
opening control on the non-opening path; `handle_incoming` returns `Ok`. Mutant: classify only
`serve`'s result.

**Measurement: none** (logging). **Effort.** 1 h.

`forward`'s `Result<(), ()>` (`server.rs:414`) survives as a naming item (#8).

## 3 · One writer per session — HOLDS, size set by W4 and W16

**In plain words.** A session writes two kinds of things to the client: frames, and refusals
(`frame_error`). Today four objects share that job. The proposal gives each session one *link*
object that owns everything it writes, per transport.

**Evidence.**
* `FrameOut` writes frames (`transport/frame_out.rs:13-29`). `Control` writes refusals
  (`wire.rs:44-57`).
* `late_control` holds a control stream that has not arrived yet (`pipeline.rs:75-76`,
  `107-110`, `160-164`).
* `stall_left` is lab state inside the product pipeline (`pipeline.rs:78-79`, `97-100`,
  `146-154`).
* `ProductPipeline` has 9 fields and 3 builders (`:66-110`).
* On the WebSocket, `FrameOut::WebSocket` and `Control::WebSocket` both hold one
  `WsSink(Arc<Mutex<SplitSink>>)` (`websocket.rs:39-58`, `130-132`), which is then closed through
  the lock (`:146`). Every write happens on the one session task (`drive` is awaited inside
  `serve`, `server.rs:177-182`; the spawned reader holds only the read half), so the mutex guards
  nothing.
* `stall_within`'s non-QUIC arm is dead (`frame_out.rs:68`): `websocket::session` never calls
  `with_stall_after` (`websocket.rs:130-132`). If it were reached, it would hang forever.

**Shape depends on two open owner decisions.**
* *If W4 (per-frame mode) and W16 (the stall) are both kept*, use the review's shape:
  ```rust
  pub(crate) enum Link {
      Quic { media: Media, control: ControlStream, connection: Connection, stall_left: Option<u64> },
      WebSocket(WsWriter),                        // SplitSink owned outright: no Arc, no Mutex
  }
  enum Media { Shared(SendStream), PerFrame { acks: JoinSet<()>, seq: u32 } }
  enum ControlStream { Open(SendStream), Coming(oneshot::Receiver<SendStream>) } // Err on await = gone
  impl Link {
      async fn send_frame(&mut self, idx: u32, body: Bytes) -> Result<()>;
      async fn refuse(&mut self, frame: u32, reason: String) -> Result<()>;
      async fn finish(&mut self);                 // per-frame grace, WebSocket close
  }
  ```
* *If both are stripped* (each in its own commit first, with an `archive/` tag as RV7 did),
  `Media` and `stall_left` go, and `finish` only closes the WebSocket. `Link::Quic` becomes
  `{ uni, control, _connection }`, and `drain_acks` goes from the trait and from `drive`.

Either way `ProductPipeline` holds `{ store, link, seq, tile, fills }`. `Control`, `with_control`,
`with_late_control`, the WebSocket mutex and the explicit close in `websocket.rs` all go. `drive`
calls `finish`. `FrameOut::Detached` (`frame_out.rs:26-28`) becomes `Link::Detached` under
`#[cfg(test)]`.

**Tests and mutants.** These carry over: `a_websocket_carries_the_same_envelopes_and_refusals`,
`a_refusal_with_no_control_stream_returns_once_the_session_closes` (`pipeline.rs:445`),
`an_opening_ask_is_served_behind_the_accept`, and `a_stalled_session_sends_its_budget_and_then_nothing`
(`server.rs:1266`, if W16 is kept). New: `a_websocket_session_ends_with_a_close_frame`. Mutant:
`finish` skips the close.

**Measurement.** QUIC bytes are identical, so none. The WebSocket loses one uncontended lock per
frame. That is not required; if doubted, run one interleaved fill in `lab/tcp-fallback`.
**Effort.** ~1 day with both kept, ~½ day with both stripped.

## 4 · The ring's drop can free buffers in flight — GONE

**In plain words.** On a cache miss, the tile reader asks the kernel (io_uring) to read into its
buffers. If the reader is dropped while a read is running, it must wait for the kernel before
freeing the memory, or the kernel writes into freed heap.

**Evidence it is fixed (`b694ca4`).**
* `drain_in_flight` loops until every read lands, retrying `EINTR`/`EBUSY`
  (`media/uring_reader.rs:111-131`). On any other error it returns `false` (`#[must_use]`).
* `TileReader::drop` then leaks every slot buffer with `mem::forget` and a WARN, never freeing
  them (`read_path.rs:487-503`).
* A read is counted in flight once queued (`uring_reader.rs:69-70`), so an entry whose `submit`
  failed is still drained.
* The SAFETY contract on `submit` (`:59-61`) now names both outcomes.
* Tests: `an_interrupted_drain_still_waits_for_the_kernel`,
  `a_failed_drain_reports_the_read_still_in_flight` (errno injected through `FAILED_WAITS`, `:18`),
  and `a_tile_reader_whose_ring_fails_mid_read_leaks_its_slots` (`read_path.rs:1031`). RV7 ran the
  mutants. Fill reads go through the pool and own their buffer, so they never had this hazard.

Nothing left to build. The leak shows as a WARN line rather than a session-line count, which is
fine for a path that should never run.

## 5 · Module layout that follows the frame — HOLDS

**In plain words.** Files are grouped as transport / media / record. The session loop and the
planner sit in `transport/` although they do no transport. The proposal adds a `session/` module,
so the file tree reads like the path of a frame.

**Evidence.**
* `server.rs` has 435 product lines and ~1 400 test lines (tests from `:436` to `:1838`). It mixes
  endpoint/handshake tests (`settings_ride_the_handshake_flight` `:1336`,
  `a_lost_first_flight_is_repeated_whole` `:1451`), session wire tests, and WebSocket tests
  (`:691`, `:1014`, `:1095`, `:1745`).
* `websocket.rs:6` reaches sideways into `server::{forward, parse_open_ask, Sessions}`.
* Study fixtures are written four ways: hand-written SBND bytes (`pipeline.rs:291-304`), and three
  `write_bundle` wrappers (`pipeline.rs:307`, `server.rs:781`, `read_path.rs:514`).
* `process::id()` temp paths appear 23 times.

**Shape.** As in the review:
* `transport/`: `endpoint.rs` (identity, cert hash, `build_endpoint`, banner), `websocket.rs`,
  `link.rs`, `wire.rs`, `tuning.rs`, `restart.rs`, `stream_mode.rs`.
* `session/`: `mod.rs` (config, serve, the loop, the FoD → Ask reader, the opening ask),
  `planner.rs`, `pipeline.rs`.
* `media/`: unchanged.
* A `#[cfg(test)] testkit.rs` holding `study(frames)`, `dev_cert()`, `free_port()`,
  `connect_session()` and a `TempDir`.

Each test moves next to what it tests. Move only, in its own commit, **after** #1, #3 and #6, so
their diffs stay readable. The #8 renames that are noisy anyway go here.

**Verify.** `scripts/gate.sh`; `cargo test` default and `--features telemetry`; `cargo check
--no-default-features --features crypto-ring --all-targets` (the no-`uring` build) with no
warnings. **Measurement: none.** **Effort.** ½–1 day.

## 6 · Pipeline steps that match the read path — HOLDS (owner decides the row format)

**In plain words.** In a telemetry build, every frame writes one *row* that times its stages. Today
the stages are `prepare`, `locate` and `send`. The first two do nothing on this build (~0 µs), and
`send` hides the one split that matters: was a slow frame slow on disk or on the wire? The
proposal makes the stages `read` (until the bytes are in hand) and `write` (until quinn accepts
the frame).

**Evidence.**
* The trait is `prepare → locate → send` with 8 methods (`pipeline.rs:23-64`). Two of them are
  session-level (`drain_acks`, `note_fill`).
* A test overrides `serve` (`server.rs:470`), which the trait doc forbids (`pipeline.rs:22`).
* The ADR's row table says `prepare_us` and `locate_us` are "~0" and that `send_us` "is not
  separable into disk and wire time" (`docs/adr/telemetry-server-pipeline.md:104-117`).
* Both readers take the store on every call (`read_path.rs:144-149`, `313-318`).

**New finding: `overhead_us` measures only rounding.** `begin_frame` sets `serve_start` and
`stage_mark` to the same instant (`tap.rs:288-292`). Each stage closes against the mark
(`:299-311`), and `try_emit` closes the last one against the same `now` that ends `serve_us`
(`:355-369`). So `overhead_us = serve − prepare − locate − send` (`:370-374`) is only each
stage's truncation to µs, 0–2 µs. With `read` and `write` contiguous the same way, `serve_us ==
read_us + write_us` up to rounding, and `overhead_us` can go.

**Shape.** Decision C stays as it is: the lab wraps steps, and the story is a trait default.
```rust
pub(crate) trait FramePipeline: Send {
    async fn serve(&mut self, frame: u32, next: &Next) -> Result<()> {
        let body = self.read(frame, next).await?;
        self.write(frame, body).await
    }
    async fn read(&mut self, frame: u32, next: &Next) -> Result<Bytes>;  // includes starting next's read
    async fn write(&mut self, frame: u32, body: Bytes) -> Result<()>;    // Link::send_frame (+ stall if kept)
    async fn refuse(&mut self, frame: u32, reason: String) -> Result<()>;
    async fn finish(&mut self);
}
```
* The readers own an `Arc<FrameStore>`.
* `RecordedPipeline` stamps three times: `begin_frame` at `read` entry, the read boundary at
  `read` exit, and the emit after `write`.
* The rows file and the report move to **v3**: `read_us` and `write_us` replace `prepare_us`,
  `locate_us` and `send_us`, and `overhead_us` goes. `locate_outcome` repeats what
  `write_outcome = Refused` already says, so it can go too. The record stays 56 B, because the
  session record fills it (`rows.rs:17`, `:117-125`); the frame record gains spare bytes.
  **Trap:** `read_records` checks the magic and the record size but **not the version**
  (`rows.rs:189-203`; v1 was refused only because it was 64 B). A same-size v3 must add the
  version check, or a v2 file decodes as v3 garbage.
* `t_ask_us` is renamed `t_serve_us` (#7) in the same bump, so the format changes once.
* The ADR is amended in place, §2 style: the old fields and why they went.
* Consumers: `server/src/record/{rows,report,sink}.rs`, and `lab/scripts/telemetry_e2e_baseline.sh:121-123`
  (reads `send_us`). `lab/telemetry-bench` keeps its own mirrored layout and does not read product
  rows.

**Tests and mutants.**
* Rewrite the rows round trip and `contiguous_emit_partition_holds` for the new fields.
* New: `a_slow_write_lands_in_write_us_not_read_us` (a test pipeline whose `write` sleeps 20 ms).
  Mutant: swap the boundaries.
* New: `a_rows_file_of_another_version_is_refused` (a v2 header at 56 B). Mutant: drop the
  version check.
* `check_telemetry_absent.sh` in the gate shows the product build is untouched.

**Measurement: none required.** The product build does not change, and server telemetry stays out
of comparisons. The review's `lab/telemetry-cost` is the **wrong instrument**: it measures the
client's `client/record/` on a fake transport in Node. If a "not worse" claim is wanted, it needs
`telemetry_e2e_baseline.sh` with telemetry on in both arms, and that script sets it on only one
(`:29`, `:120-121`). Otherwise claim only "one fewer `Instant::now` per row", with no cost number.

**Effort.** ~1 day, after #1 (and after #3, so that `write` is just `link.send_frame`).

## 7 · `t_ask_us` is stamped when serving starts — HOLDS

**In plain words.** Each row carries a timestamp the ADR calls "ask accepted"
(`telemetry-server-pipeline.md:126`). The code stamps it when the server *starts serving* the
frame (`tap.rs:288-289`, in `begin_frame`). The time the ask spent waiting (up to 8 in the channel
and up to 8 in `in_hand`) appears nowhere, so "inter-ask spacing" read from this field is really
inter-serve spacing.

**Options.**
* **Rename** (recommended): `t_serve_us`, with the ADR corrected in place. Do it in #6's v3 bump.
  Test: the `rows.rs` round trip. ~1 h.
* **Arrival stamp** (only if a cell needs the server's queue time): the reader stamps
  `Ask::Frame { frame, #[cfg(feature = "telemetry")] at: Instant }`, and the row gains
  `queued_us`. This puts a telemetry token in product code, the cost the ADR refused for `ack_us`
  (`:54`). Test: two pipelined asks; the second's `queued_us` ≥ the first's `serve_us`. ~½ day.
  The comparison's queue time is already the client's `serve_plus_rtt`.

## 8 · Names — HOLDS, folded into the commits

| Now (at `4a45122`) | Instead | Lands in |
| --- | --- | --- |
| `FramePipeline::send` `pipeline.rs:51` (a disk read and a write) | `read` + `write` | #6 |
| `Mode::OnDemand` `planner.rs:34` / `TileReader` / "tile" | `Next::Tiles`; "tiles" everywhere | #1 |
| `forward → Result<(), ()>` `server.rs:414` | `ControlFlow<()>` | #1 |
| `Control` `wire.rs:45` (only the refusal writer) | gone into `Link` | #3 |
| `ProductPipeline` `pipeline.rs:66` | `SessionPipeline` | #5 |
| `drive` `server.rs:377` (*the* session loop) | `run_session` | #5 |
| `Sessions` `server.rs:145` (config plus the serve loop) | `SessionConfig` + `session::serve` | #5 |
| `Ask` holding `EndSession`, `Failed` `planner.rs:13-19` | keep `Ask`; correct its doc line ("one item per frame" is not true of those two) | #1 |

**Verify.** Compiler only.

## 9 · The frame size limit — HOLDS (details changed)

**In plain words.** Clients refuse a frame over 64 MiB, but nothing upstream (the packer, the
bundle, the server) checks that limit. A study with one oversized frame would make every client
drop the stream, with an error that names neither the study nor the frame.

**Evidence.**
* The limit is declared in `client/transport-ts/wire.ts:33`,
  `client/transport-wasm/src/session.rs:176`, `lab/window-harness/src/wire.rs:11`,
  `bin/cold_open.rs:20` and `bin/rebind_probe.rs:17`, and as prose in `WIRE.md:73`.
* The checks disagree on the low bound. The WASM client and the TS client refuse `< 4`
  (`session.rs:197`, `frame-session.ts:315,348`); the harness refuses only `== 0` (`wire.rs:92`,
  `frames.rs:38`, `cold_open.rs:75`, `rebind_probe.rs:131`).
* The bundle layout checks each entry against the file's length only
  (`ingest/study-bundle/src/format.rs:46-56`). `BundleWriter::create`
  (`ingest/study-bundle/src/writer.rs:16-46`) and `FrameStore::open` (`frame_store.rs:40-56`)
  check no maximum.
* W9 is done: `frame-envelope` already owns `frame_head` and `unwrap`
  (`common/frame-envelope/src/lib.rs`).

**Shape.**
* `frame_envelope::MAX_FRAME_LEN`, plus `check_len(envelope_len) -> Result<(), String>` that
  refuses `< ENVELOPE_LEN` and `> MAX`. The Rust clients and the harness use them.
* TypeScript keeps its own constant, with `WIRE.md:73` as the definition both cite.
* The bundle layout parser refuses an oversized entry, naming the frame index, so
  `FrameStore::open` fails at startup and `pack-study` fails at write.

**Tests and mutants.**
* A layout test with an oversized entry gives `Err` naming the frame. Use a **sparse** file
  (`set_len`), because the entry must also lie inside the file. Mutant: drop the check.
* A `check_len` test for both bounds. Mutant: `<` → `<=`.

**Measurement: none.** **Effort.** 2–3 h. It touches client and harness crates, so it is an
independent commit (or its own PR, see decisions).

## 10 · `TransportTuning` derives `clap::Args` — HOLDS, unblocked

**In plain words.** Each QUIC knob is written four times: the struct field, a CLI field in `Args`,
a line copying one into the other, and a `describe()` line. Deriving the CLI from the struct
removes two of those.

**Evidence.**
* `Args` fields: `server/src/main.rs:25-46`. Hand mapping: `:85-93`.
* `TransportTuning` (`transport/tuning.rs:29-47`) has its own `Default` (`:49-61`).
* `Congestion` already derives `clap::ValueEnum` (`:10`).
* W1–W3 are decided and done (RV7), so the set of knobs is final: send window, idle timeout,
  keep-alive, congestion, initial window, initial RTT, segmentation offload.

**Shape.**
* `#[derive(clap::Args)]` on `TransportTuning`, and `#[command(flatten)]` in `Args`.
* `#[arg(long = "send-window-bytes")]` and `#[arg(long = "initial-window-bytes")]` keep the flag
  names.
* `segmentation_offload` keeps `default_value_t = true, action = Set`.
* One doc comment per knob, merging today's two (they say different things today).
* `Default` must agree with clap's defaults. A test asserts `TransportTuning::default()` ==
  parsing no flags.

**Tests and mutants.** The `main.rs` CLI tests. One new test parses every transport flag the lab
passes (`git grep -- '--send-window-bytes\|--initial-window-bytes\|--initial-rtt-ms\|--keep-alive-interval-ms\|--max-idle-timeout-ms\|--segmentation-offload' lab`).
Mutant: drop one `long =`. **Measurement: none.** **Effort.** 1 h.

---

## Build plan

New branch off `main` after PR #33 merges (per the handoff). One worktree, its own
`CARGO_TARGET_DIR`. `scripts/gate.sh` passes at every commit; `comment_budget.sh` passes per file.

**Correctness and small fixes first.** Each is independent, small and reviewable alone.

| Commit | What | Needs | Measure |
| --- | --- | --- | --- |
| C1 | #2 leftover: a close during session setup is a goodbye too | — | none — **done `ffb05b1`**; `session_request.accept()` itself stays unclassified, since no connection exists yet to ask for a close reason |
| C2 | Doc corrections with no code: `frame-framing-and-loop-shape.md:324` (capacity is 8 + 8), `WIRE.md:152-153` (an opening ask is never refused) | — | none — **done `8db4e64`** |
| C3 | #9: one frame limit, refused at bundle load naming the frame | decision D6 | none — **done `8dc4b05`**: the crate's check is `envelope_len(prefix)`, a function on the 4-byte prefix every reader already holds, not a `Head` type |
| C4 | #10: `TransportTuning` derives `clap::Args` | — | none — **done `d649fe8`** |

**Refactors.**

| Commit | What | Needs | Measure |
| --- | --- | --- | --- |
| R0a / R0b | Strip per-frame mode (W4) / strip the stall (W16), each tagged `archive/…` first, **only if decided** | D1, D2 | none (removals; the per-frame half of conformance goes with W4) |
| R1 | #1: planner owns range and refusal text; `Next`; fill plumbing gone; #8's `Mode` / `forward` / `Ask` doc | — | **`server_ab.sh <R1^>`, interleaved; expect tie on every cell; p50 verdict only** |
| R2 | #3: `Link`, one writer per session; `Control` and the WebSocket mutex gone | R1; shape from D1, D2 | none (QUIC bytes identical) |
| R3 | #6 + #7 rename: `read` / `write` steps; row v3 (`read_us`, `write_us`, `t_serve_us`; `overhead_us` gone); ADR amended in place | R1, R2; D3 | none required |
| R4 | #5: `session/` module, `endpoint.rs`, `testkit.rs`, tests beside their code; #8's renames | R1–R3 | none |

**Dependencies, checked.** The review's "5 after 1–3" still holds, plus after #6. "6 after 1"
holds; also put 6 after 3, so that `write` is the link's `send_frame`. "10 after W1–W3": they are
decided and done, so #10 is free. #3 waits only on D1 and D2. If the owner wants to start before
deciding, build R2 for the keep-both shape; a later strip then shrinks it.

**Not in this PR.** The arrival stamp (#7 full fix) unless D4 says yes, and the AV1 notes (a
"contiguous run" `Next` variant is a measurement for the AV1 phase, not a given).

## Decisions for the owner

**Decided 2026-10-03** (queue rows 116–120 build from these): **D1 keep `per-frame`**, on purpose —
`shared` is not proven best either (head-of-line blocking; [`adr/stream-shape.md`](adr/stream-shape.md)
§Decision), so R2 takes the keep-both shape; **D2** the stall stays; **D3** row v3, yes; **D4** no arrival
stamp, the `t_serve_us` rename only; **D5** keep `fills=` via `Next::Fill { first }`; **D6** #9 in this PR,
the study refused at load naming the frame; **D7 not yet approved** — the owner reviews the layout in
detail first, so R4 is written out for review (row 120) and not built. The list below is the question as
it was put.

1. **D1 — keep the `per-frame` stream mode (W4)?** It opens one QUIC stream per frame instead of
   one shared stream. `adr/stream-shape.md` measured it level with `shared`, not better, and kept
   it for progressive delivery, which is unbuilt. Keeping it means #3 carries `Media` and the 2 s
   finish grace. Stripping it removes ~150 lines plus conformance's per-frame halves and ~15 lab
   drivers. Clients need no change.
2. **D2 — DECIDED 2026-10-03: the lab stall (`--stall-after-bytes`, W16) stays.** The owner kept the
   client's `recycleAtBytes` as an opt-in, and the stall is the only lever that tests it. So #3's
   `Link::Quic` carries the stall as one `Option<u64>`, out of the read path.
3. **D3 — telemetry row format v3 (#6 with #7's rename).** This is the lab's per-frame record, not
   the product. The change: `prepare_us`, `locate_us` and `send_us` become `read_us` + `write_us`;
   `overhead_us` goes (it only ever held rounding); `t_ask_us` becomes `t_serve_us`. Old `.rows`
   files are then refused by a new version check, not converted. Alternative: keep v2 and only fix the ADR
   wording.
4. **D4 — server queue time (#7 full fix)?** It would add a telemetry-only field to the product's
   `Ask`, the cost the ADR refused for `ack_us`. Recommended: no. The rename is enough, and the
   client already measures queueing.
5. **D5 — `fills=` in the `session reads` line.** Keep it via `Next::Fill { first }` (one bool, no
   plumbing; recommended), or drop the field: nothing in `lab/` or `scripts/` parses it, and only
   `disk-access.md:393` documents it.
6. **D6 — #9's scope.** In this PR as its own commit (recommended), or a separate PR, since it
   touches the WASM client and harness crates. Also: refuse the whole study at load (recommended:
   fails fast at startup, names the frame) versus refusing only that frame per ask.
7. **D7 — approve the layout and names** (#5, #8): `session/`, `SessionPipeline`, `run_session`,
   `SessionConfig`.

