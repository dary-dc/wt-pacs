# Plan: separate the two stream modes

**For:** wt-pacs implementer · **Date:** 2026-08-27 · **Rev 2** ·
**Basis:** [`adr-frame-framing-and-loop-shape.md`](adr-frame-framing-and-loop-shape.md)

Goal: the choice between **one persistent uni stream** and **one uni stream per frame** must live in
exactly one place. Today it is a `bool` threaded through CLI → config → session → send → wire format →
a client `AtomicBool` static → two client loops → two metrics fields.

Not a rewrite. One new file, one enum, and deletions.

---

## 0 · Sequencing — do not stash

The tree carries **uncommitted telemetry work from another session**: `server/src/record/` (577 lines),
the `run_session<R: Record>` seam, a `telemetry` cargo feature, `server/scripts/check_telemetry_absent.sh`,
and client-side `ask_join` capture. Verified 2026-08-27:

```
cargo check --workspace            ✅
cargo check -p exact-server --features telemetry  ✅
cargo test --workspace             ✅ all pass
```

**Commit that work first, as its own commit. Do not stash it.**

- it is green, coherent, and roughly complete — stashing means unstashing it an hour later
- both changes edit `run_session` and `send_one_frame` signatures, so a stash guarantees a
  hand-resolved conflict in exactly those functions
- it already extracted `write_payload(connection, shared, payload)` — the seam this plan builds on.
  Stashing removes that seam and then re-adds it, conflicting

Work on top of the working tree, not `HEAD`. Line numbers in older docs are stale — navigate by symbol.

### 0.1 · Fix before committing it

`lab/window-harness/src/client.rs:79-80`:

```rust
        reset_ask_join();
    reset_ask_join();      // duplicated, broken indent
```

Idempotent, so harmless at runtime. Still a botched edit — delete line 80.

---

## 1 · Server — the enum

New file `server/src/transport/sink.rs`.

```rust
/// How frames reach the client. Chosen once per session; nothing downstream branches on it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum StreamMode {
    /// One uni stream for the whole session. Frames strictly in ask order.
    Shared,
    /// One uni stream per frame. Independent delivery; allows `set_priority` and `reset`.
    PerFrame,
}

/// `S` is `R::Stamp` from the recording seam. It crosses into the delivery task and
/// comes back on the ack channel, so **no clock is read in product code** (record seam I2).
pub enum FrameSink<S: Copy + Send + 'static> {
    Shared(SendStream),
    PerFrame {
        conn: Connection,
        tasks: JoinSet<()>,
        acks: mpsc::UnboundedSender<Ack<S>>,
    },
}

pub struct Ack<S> {
    pub frame_index: u32,
    pub since: S,
    pub outcome: DeliverOutcome,
}
```

`send` takes the frame index and a stamp:

```rust
pub async fn send(&mut self, idx: u32, payload: &[u8], since: S) -> Result<()> {
    let len = (payload.len() as u32).to_be_bytes();
    match self {
        Self::Shared(uni) => {
            uni.write_all(&len).await?;
            uni.write_all(payload).await?;
        }
        Self::PerFrame { conn, tasks, acks } => {
            let mut uni = conn.open_uni().await?.await?;
            uni.write_all(&len).await?;
            uni.write_all(payload).await?;

            // Option C. `finish().await` is moved OFF the session loop, not deleted.
            // wtransport's `finish()` awaits the peer's acknowledgement (~272 ms measured);
            // awaiting it inline is the defect in adr-frame-framing-and-loop-shape.md §1.
            // Awaiting it in a task costs nothing and yields a real delivery timestamp.
            let acks = acks.clone();
            tasks.spawn(async move {
                let outcome = match uni.finish().await {
                    Ok(()) => DeliverOutcome::Acked,
                    Err(_) => DeliverOutcome::Failed,
                };
                let _ = acks.send(Ack { frame_index: idx, since, outcome });
            });
        }
    }
    Ok(())
}
```

### Why C and not "just drop the stream"

Rev 1 of this plan dropped the stream. That is option **B**, and the ADR concluded C dominates B. Two
concrete reasons, both live right now:

1. **Delivery timestamp.** `finish()` completing *is* the peer's acknowledgement of that frame. It is
   the only server-side signal that gives network time **without client clock sync** — and the
   telemetry system being built next is exactly what consumes it.
2. **Graceful close.** With a bare drop, frames still in flight when the session ends can be cut off by
   connection close. Awaiting the `JoinSet` at session end fixes that. Do this:

```rust
// after the ask loop breaks, before returning:
let _ = tokio::time::timeout(Duration::from_secs(2), sink.drain()).await;
```

**Spawn in every build, including production.** The alternative — drop in production, spawn under
`--features telemetry` — would make telemetry measure behaviour production does not have. A task per
frame at realistic ask rates is noise.

### Changes in `server.rs`

- `ServeConfig.shared_stream: bool` → `ServeConfig.mode: StreamMode`
- thread `StreamMode` (not `bool`) through `run_server` → `handle_incoming` → `spawn_session` →
  `run_session`
- `run_session`: replace `let mut shared: Option<SendStream> = if shared_stream {...}` with
  `let mut sink = FrameSink::open(&connection, mode).await?;`
- `send_one_frame`: takes `sink: &mut FrameSink<R::Stamp>` instead of `connection` + `shared`
- **delete `write_payload` entirely** — `FrameSink::send` replaces it
- keep every existing `Record` call (`rec.ask`, `rec.located`, `rec.wrote`) exactly where it is

`server/src/main.rs`: `--shared-stream` → `--stream-mode shared|per-frame`.

> **Confirm the default.** Written as `PerFrame` on the reading that per-frame is the chosen mode.
> One line to flip if that is backwards.

---

## 2 · Recording the delivery

One method on the existing trait in `server/src/record/mod.rs`:

```rust
/// Peer acknowledged the frame. Only fires in `PerFrame` mode.
fn delivered(&mut self, since: Self::Stamp, outcome: DeliverOutcome, frame_index: u32);
```

`Noop` gets the usual `#[inline(always)]` empty body, so default builds stay zero-sized — keep the
`noop_is_zero_sized` test passing.

The session loop drains the ack channel opportunistically, so the task never touches `R`:

```rust
loop {
    while let Ok(ack) = sink.try_recv_ack() {
        rec.delivered(ack.since, ack.outcome, ack.frame_index);
    }
    let msg = read_fod_msg(&mut control_recv).await;
    ...
}
// and once more after the loop, after drain()
```

Acks land one ask late. The *timestamp* is captured at acknowledgement time inside the task, so the
measurement is correct; only its recording is deferred. Say so in the tap schema, or someone will read
`delivered` as the drain time.

Channel is unbounded. At realistic ask depth (`D` ≈ 2–5) the queue never exceeds single digits. If that
assumption ever breaks, bound it and count drops — do not let it grow silently.

---

## 3 · One wire format, two stream lifetimes

Both arms above write `[4B BE len][envelope]`. Today only the shared arm does; the per-frame arm relies
on stream end to delimit.

Unifying costs 4 redundant bytes per frame on the per-frame path and buys **one parse path on the
client**, so the difference between the two modes collapses to exactly one thing: how long the stream
lives. That is the cleanest possible statement of the separation.

Consequences, all in the same commit:
- `read_envelope` (read-to-end) in `server/src/transport/wire.rs` is no longer the per-frame reader
- `WIRE.md` gains the rule: *every media envelope is length-prefixed, in both stream modes*
- any recorded fixture of the per-frame path is invalidated

**Opt-out:** for the minimum diff, keep stream-end delimiting on the per-frame arm and skip this
section. Then §5's shared parse helper applies to the shared mode only.

---

## 4 · Harness client — the worse half

`lab/window-harness/src/client.rs`.

Delete `SHARED_STREAM: AtomicBool` (~line 22, stored ~line 136) and its read in `metrics.rs:224`. It is
a global holding per-run state, and it is the single ugliest thing in the tree.

`shared_stream_loop` and `accept_uni_loop` share an identical ~20-line tail — `rtt_full`,
`outstanding.remove`, `in_flight` decrement, `metrics.on_envelope`. Extract it once:

```rust
async fn on_frame_arrived(
    index: u32, wire_len: u64, metrics: &SharedMetrics,
    outstanding: &Arc<Mutex<HashSet<u32>>>, in_flight: &Arc<Mutex<u32>>, rtt_ms: u64,
)
```

Both loops become thin readers. **Keep both loops** — one reads a stream in a loop, the other accepts
per frame with a task each. They are genuinely different; merging them reintroduces a branch. Select
between them once, on `StreamMode`, at the existing call site.

`lab/window-harness/src/main.rs`: `--shared-stream` → `--stream-mode`.

---

## 5 · Tests — the bytes, not the socket

Pure functions in `sink.rs`, unit-tested. No async, no network:

```rust
pub fn length_prefixed(payload: &[u8]) -> Vec<u8>;
pub fn parse_length_prefixed(buf: &[u8]) -> Option<(&[u8], usize)>;
```

Cover: round trip, zero length, truncated prefix, truncated body, length exceeding the 64 MiB guard
already present in `shared_stream_loop`.

That is the whole test scope. The wtransport I/O does not get a unit test — it gets the harness, which
exists. `frame_store.rs` and `record::tests` remain the other tested units.

---

## 6 · Metrics

- `RunConfig.shared_stream: bool` → `mode: StreamMode`
- `HarnessMetrics.shared_stream: bool` → `stream_mode: String`

Existing result JSON carrying `shared_stream` becomes unreadable by the new parser. Grep `lab/` for
scripts reading that key and update them in the same commit.

---

## 7 · Explicitly out of scope

**The reader/sender task split.** Buys nothing under the shared mode on a healthy link; a precondition
only for `set_priority` / `reset`, which nothing uses yet. Ranked below the framing decision in the ADR.

**`set_priority`.** Enabled by per-frame mode; not wired up. Separate change.

**Choosing shared vs per-frame.** This plan makes both first-class and cheap to switch. The decision
needs a netem run with **loss enabled**, which has never been run. See ADR §6.

---

## 8 · Order

1. Fix §0.1, then **commit the telemetry work as-is**
2. `sink.rs` + pure framing fns + their tests — compiles standalone
3. `Record::delivered` + `Noop` impl; confirm `noop_is_zero_sized` still passes
4. Server: thread `StreamMode`, adopt `FrameSink`, move `finish()` into the task, delete
   `write_payload`, add the ack drain and `drain()` at session end
5. Harness client: kill the static, extract `on_frame_arrived`, switch on `StreamMode`
6. Metrics + CLI on both sides, and the `lab/` scripts reading the old key
7. `WIRE.md` if §3 was taken

**Checkpoint after step 4, falsifiable:** run the harness in per-frame mode at 250 KB frames / 60 ms
RTT on a 10 Mbit link. Link utilisation must land **clearly above 7.00 Mbps** — the old
`Tf / (Tf + RTT)` ceiling. If it does not, `finish()` is still being awaited on the session loop.

---

## 9 · Docs to correct while here

- `adr-client-window-depth.md` — label the architecture comparison as measuring a misplaced `await`
- `cleanup-plan-2026-08.md` §4b — the recommendation stands; its cited justification does not
