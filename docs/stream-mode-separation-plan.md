# Plan: separate the two stream modes

**For:** wt-pacs implementer · 2026-08-27 · rev 4 ·
**Why:** [`adr-frame-framing-and-loop-shape.md`](adr-frame-framing-and-loop-shape.md)

Two removals:

1. The shared-vs-per-frame `bool`, currently threaded through CLI → config → session → send → wire
   format → a client `AtomicBool` static → two client loops → two metrics fields.
2. `handle_incoming → spawn_session → run_session` and the `R: Record` generic on every signature.

Net subtraction.

---

## 0 · Start here

Uncommitted telemetry work from another session is in the tree (`server/src/record/`, the `R: Record`
seam, `telemetry` feature, client `ask_join`). It is green — `cargo check` both feature configs,
`cargo test --workspace`, all pass.

**Commit it first. Do not stash** — both changes edit `run_session` and `send_one_frame`, so a stash
guarantees a conflict there. Work from the working tree, not `HEAD`. Navigate by symbol; line numbers
in older docs are stale.

First delete `lab/window-harness/src/client.rs:80` — `reset_ask_join()` duplicated with broken indent.

---

## 1 · `server/src/transport/sink.rs`

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum StreamMode { Shared, PerFrame }

pub enum FrameSink {
    Shared(SendStream),
    PerFrame { conn: Connection, tasks: JoinSet<()> },
}

impl FrameSink {
    pub async fn open(connection: &Connection, mode: StreamMode) -> Result<Self> {
        Ok(match mode {
            StreamMode::Shared => Self::Shared(connection.open_uni().await?.await?),
            StreamMode::PerFrame => Self::PerFrame {
                conn: connection.clone(),
                tasks: JoinSet::new(),
            },
        })
    }

    pub async fn send(&mut self, payload: &[u8]) -> Result<()> {
        let len = (payload.len() as u32).to_be_bytes();
        match self {
            Self::Shared(uni) => {
                uni.write_all(&len).await?;
                uni.write_all(payload).await?;
            }
            Self::PerFrame { conn, tasks } => {
                let mut uni = conn.open_uni().await?.await?;
                uni.write_all(&len).await?;
                uni.write_all(payload).await?;
                // MOVED off the session loop, not deleted: wtransport's `finish()` awaits the
                // peer's ack (~272 ms measured). Inline, it caps throughput at Tf/(Tf+RTT).
                tasks.spawn(async move { let _ = uni.finish().await; });
            }
        }
        Ok(())
    }

    /// Await outstanding acks so trailing frames survive session close.
    pub async fn drain(&mut self) {
        if let Self::PerFrame { tasks, .. } = self {
            while tasks.join_next().await.is_some() {}
        }
    }
}
```

In `server.rs`:

- `ServeConfig.shared_stream: bool` → `mode: StreamMode`, threaded as `StreamMode`
- `run_session`: `let mut sink = FrameSink::open(&connection, mode).await?;`
- `send_one_frame`: takes `sink: &mut FrameSink`; **delete `write_payload`**
- after the ask loop: `let _ = timeout(Duration::from_secs(2), sink.drain()).await;`
- `main.rs`: `--shared-stream` → `--stream-mode shared|per-frame`

> **Confirm the default.** Written `PerFrame`. One line to flip.

---

## 2 · Collapse the recording seam

`Tap::for_session()` already returns `Option<Self>`, gated at runtime on `WTPACS_TELEMETRY`. The
generic, `Noop`, and the `cfg` fork buy one avoided `Option` branch. Not worth it.

```rust
#[derive(Default)]
pub struct Recorder {
    #[cfg(feature = "telemetry")]
    tap: Option<tap::Tap>,
}
```

Same methods (`stamp`, `ask`, `located`, `wrote`, `refused`), inherent not trait. `Tap` unchanged.

Delete: `Record`, `Noop`, `spawn_session`, every `<R: Record>` bound, the `cfg` fork. Call sites in
`send_one_frame` stay put — only the receiver type changes. Result: `handle_incoming → run_session`,
opening with `let mut rec = Recorder::for_session();`.

Rename `noop_is_zero_sized` → `recorder_is_zero_sized`, still asserting `size_of == 0` in default
builds. That test is what replaces the type parameter as the zero-cost guarantee.

---

## 3 · One wire format, two stream lifetimes

Both arms above length-prefix. Today only the shared arm does. Unifying costs 4 bytes per frame and
reduces the difference between modes to one thing: how long the stream lives.

Same commit: `read_envelope` is no longer the per-frame reader; `WIRE.md` gains *every media envelope
is length-prefixed, in both modes*; per-frame fixtures are invalidated.

**Opt-out:** keep stream-end delimiting on the per-frame arm and skip this section.

---

## 4 · Harness client

`lab/window-harness/src/client.rs` — delete `SHARED_STREAM: AtomicBool` and its read at
`metrics.rs:224`. A global holding per-run state; the worst thing in the tree.

`shared_stream_loop` and `accept_uni_loop` share a ~20-line tail (`rtt_full`, `outstanding.remove`,
`in_flight`, `metrics.on_envelope`). Extract as `on_frame_arrived(...)`.

**Keep both loops** — one reads a stream in a loop, the other accepts per frame. Merging reintroduces
a branch. Select on `StreamMode` once, at the existing call site.

`main.rs`: `--shared-stream` → `--stream-mode`.

---

## 5 · Tests

Pure, in `sink.rs`:

```rust
pub fn length_prefixed(payload: &[u8]) -> Vec<u8>;
pub fn parse_length_prefixed(buf: &[u8]) -> Option<(&[u8], usize)>;
```

Round trip, zero length, truncated prefix, truncated body, over the 64 MiB guard. Plus
`recorder_is_zero_sized`. That is the whole scope — wtransport I/O gets the harness, not unit tests.

---

## 6 · Metrics

`RunConfig.shared_stream: bool` → `mode: StreamMode`; `HarnessMetrics.shared_stream: bool` →
`stream_mode: String`. Grep `lab/` for scripts reading the old key; same commit.

---

## 7 · Out of scope

- **Reader/sender task split** — precondition for `set_priority`/`reset` only, which nothing uses
- **Per-frame delivery timestamps** — one line inside the spawned closure, when the tap wants it
- **`set_priority`** — enabled by per-frame mode, not wired
- **Choosing shared vs per-frame** — needs a netem run with loss enabled, never yet run. ADR §6

---

## 8 · Order

1. Fix §0's duplicate line, commit the telemetry work
2. `sink.rs` + pure fns + tests
3. §2 collapse
4. Server: `StreamMode`, `FrameSink`, `finish()` into the task, delete `write_payload`, `drain()`
5. Client: kill the static, extract `on_frame_arrived`, switch on `StreamMode`
6. Metrics + CLI both sides + `lab/` scripts
7. `WIRE.md` if §3 taken

2 and 3 are independent.

**Checkpoint after 4:** per-frame mode, 250 KB frames, 60 ms RTT, 10 Mbit link — utilisation must land
clearly above **7.00 Mbps**, the old `Tf/(Tf+RTT)` ceiling. If not, `finish()` is still on the loop.

---

## 9 · Docs to correct

- `adr-client-window-depth.md` — the architecture comparison measured a misplaced `await`, not framing
- `cleanup-plan-2026-08.md` §4b — recommendation stands, cited justification does not
