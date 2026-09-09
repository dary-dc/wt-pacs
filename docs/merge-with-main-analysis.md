# Merging this branch with `main` — what actually collides, and what to do

**2026-09-07, updated 2026-09-08, port applied 2026-09-09** on
`cursor/port-onto-main-d27c` (PR #20), **merged into this branch the same day**.
The analysis below is what the port followed. This branch is now 0 behind `main`.

**What landed.** `origin/main` (`07a070f`) merged in. `locate`/`send` carry `Bytes`.
`TransportKnobs` is gone; `TransportTuning` is the one knob struct. CLI keeps `main`'s
shipped names (`--send-window-bytes`, `--stream-receive-window-bytes`, `--max-idle-timeout-ms`)
and aliases the lab-script names (`--send-window`, `--stream-receive-window`). Idle timeout
is applied on the wtransport builder. `StreamMode` is `main`'s module, default `shared`.
Per-frame ack tasks are reaped as they complete (proposal §7). The loss-regime sampler is
re-attached beside `main`'s record split.

**Still owed.** `lab/scripts/stall_client_campaign.sh` — the only instrument that can see a
reintroduced copy. Unit tests: 8 / 8 / 36 / 36 across the four `lab`×`telemetry` combos;
`all_send_paths_are_the_same_wire` and `frame_bytes_is_a_view_of_the_mapping` pass.

`HANDOFF.md` §1 used to claim `main` was a direct ancestor and the merge was
conflict-free. That went stale: the fork point is `be78860` (4 September) and **72 commits
have landed on `main` since**, including the client-frame-pipeline-telemetry PR.

This document is the analysis, not the alarm. It was produced by running the merge in a
throwaway worktree, reading every conflict hunk, and discarding the result — the working
tree was never touched.

```bash
git worktree add --detach /tmp/mergetest HEAD
cd /tmp/mergetest && git merge origin/main --no-commit --no-ff   # inspect, then:
git worktree remove --force /tmp/mergetest
```

---

## The headline: this is a refactor meeting features, not two rewrites of the same thing

**`main` did not rewrite the serving logic. It extracted it.** The conflict hunks in
`server/src/transport/server.rs` have a shape that says so directly:

| hunk | this branch | `main` |
| --- | --- | --- |
| 4 | 22 lines of endpoint setup | `build_endpoint(&config).await?` |
| 7 | 26 lines | 1 line |
| 8 | 32 lines of `send_one_frame(...)` | `pipeline.serve_one(frame, &mut control_send)` |
| 9 | **181 lines** | `pipeline.drain_acks().await` |

`main` moved that code into new modules — `pipeline.rs`, `frame_out.rs`, `stream_mode.rs`,
`record/{sink,rows,report}.rs` — which is why its diff is *+2 804 / −772* across `server/`
while its behaviour is meant to be unchanged.

**And `main`'s replacement has a seam exactly where this branch's work belongs.** Its
`serve_one` is three steps:

```rust
self.prepare(frame)      // …then
self.locate(&store, frame)  // …then
self.send(frame, bytes)
```

This branch's entire send-path contribution — `copy` / `split` / `chunked` — *is* an
implementation of that third step.

Confirmed by grep: `pipeline.rs`, `frame_out.rs` and `stream_mode.rs` on `main` contain
**zero** references to `send_path`, `SendPath`, `chunked`, `prefault` or `TransportTuning`.
`server/src/transport/tuning.rs` **does not exist on `main` at all**.

So the two sides are not making contradictory claims about the same code. One changed the
structure; the other added behaviour that structure does not yet have. **The work is to
re-apply this branch's behaviour onto `main`'s structure** — a port with a known target, not
an adjudication.

---

## What actually conflicts, by size

823 conflicted lines, very unevenly distributed. Only one file is real work.

| file | hunks | lines | what it is |
| --- | --- | --- | --- |
| `server/src/transport/server.rs` | 9 | **477** | **The port.** Extraction vs features, as above |
| `server/src/main.rs` | 3 | 151 | CLI: this branch's transport flags against `main`'s new ones. **Smaller since 2026-09-08** — a product build now exposes 6 transport flags rather than 13, the rest being behind `--features lab` ([`branch-source-audit.md`](branch-source-audit.md)) |
| `server/src/record/mod.rs` | 1 | 93 | `main` split the recorder into sink/rows/report; this branch added `path.rs` beside it |
| `lab/window-harness/src/metrics.rs` | 2 | 49 | Both added fields |
| `lab/window-harness/src/client.rs` | 1 | 14 | Both added imports/config |
| `lab/window-harness/src/main.rs` | 1 | 12 | Both added CLI flags |
| `.gitignore`, `Cargo.toml`, `lab/README.md`, `server/src/transport/mod.rs` | 1 each | 27 total | Both-added lines. Take both sides |
| `docs/send-path-copy-costs.md` | — | — | modify/delete — see below |

**What merges clean, and matters:**

- `server/src/transport/tuning.rs` and `server/src/record/path.rs` are **new on this
  branch**, so no conflict is possible. Every transport knob and the whole loss-regime
  sampler cross untouched.
- `server/src/media/frame_store.rs` — the `Mmap` → `Bytes` change `HANDOFF.md` calls *"the
  one change worth reading carefully"* — **merges clean**. `main` did not touch it.

That last point matters more than it looks: the riskiest single change on this branch is not
in contention at all.

---

## The one item that is a decision, and it decides itself

`docs/send-path-copy-costs.md`: **`main` deleted it, this branch modified it.**

Its own header reads *"Superseded in part, 2026-09-05 — see
[`quic-transport-optimization.md`](quic-transport-optimization.md)"*, and this branch carries
that successor. `main` also deleted `client-frame-pipeline-telemetry-plan.md` and added a
`docs/telemetry/` tree in its place, so the deletion is part of a deliberate reorganisation
rather than a stray.

**Accept `main`'s deletion.** The document says it has been superseded and the successor is
present. Nothing is lost.

---

## Recommended order

Split the reconciliation so the mechanical part cannot hide the interesting part. Each step
below leaves the tree building.

1. **The 27 trivial lines** — `.gitignore`, `Cargo.toml`, `lab/README.md`,
   `server/src/transport/mod.rs`. Both sides added lines; take both.
2. **Accept `main`'s deletion** of `docs/send-path-copy-costs.md`.
3. **The three `window-harness` files** (75 lines). Both sides added fields and flags to the
   same structs. Mechanical, and `cargo test -p window-harness` (8 tests) is the check.
4. **`server/src/record/mod.rs`** — take `main`'s split, then re-attach this branch's
   `path` module beside it.
5. **`server/src/main.rs`** — take `main`'s CLI, then re-add this branch's transport flags.
   They are additive; `main` has none of them.
6. **`server/src/transport/server.rs` — the port.** Take `main`'s extracted structure
   wholesale, then implement this branch's send paths inside `Pipeline::send`, and thread
   `TransportTuning` through `build_endpoint`.

### The acceptance gate

**1 · The wire must not move.** `all_send_paths_are_the_same_wire` asserts the three send
paths produce byte-identical output. If it passes after the port, the port did not change
the wire — the property the whole send-path result rests on. Do not weaken it to make the
port pass.

**2 · The chunked path must still not copy.** This one is new, and it is the gate that
matters most, because *nothing else can see this failure.* `main`'s seam passes `&[u8]`;
`chunked` exists to hand quinn an owned refcounted slice so no full-frame copy happens. Push
it through a `&[u8]` and the copy comes back — CPU per byte regresses 6–14 %, a stalled
connection goes from 198 kB to ~7 MB, **and every test still passes**, the wire test
included. The wire is identical either way; that is the point of the copy.

Gate on the instrument that already measured it:

```bash
lab/scripts/stall_client_campaign.sh      # chunked arm; expect ~200 kB/connection
```

If it reads in megabytes, the copy is back. It does not care *where* the copy returned —
allocator, seam, store — which is why it is the gate and not the tripwire below.

`frame_bytes_is_a_view_of_the_mapping` (`frame_store.rs`) is the cheap fast-fail beside it:
it asserts the frame body's pointer lies inside the study mapping, so `Bytes::copy_from_slice`
in `frame_bytes` fails immediately rather than at gate time. It **cannot** see a copy
reintroduced further down the send path, which is why it does not replace the campaign.

**3 · Everything else builds and passes**, in all four feature combinations, because the
experiment arms are behind `--features lab` now:

```bash
cargo build --release --workspace
cargo test -p exact-server                          # 13
cargo test -p exact-server --features lab           # 13
cargo test -p exact-server --features telemetry     # 16
cargo test -p exact-server --features lab,telemetry # 16
cargo test -p window-harness                        # 7
cargo clippy --workspace --all-targets              # 3, none in files this branch touched
```

---

## What this does not decide

**Whether the merge happens at all, and in which direction.** A branch this far from `main`
could also be landed as a series of smaller PRs against the new structure, which may be
easier to review than one reconciliation. That is a process choice, and this document does
not make it.

**Whether `main`'s pipeline refactor is correct.** It is assumed sound and taken wholesale.
Nothing here reviews it — this branch's measurements were all taken against the *old*
structure, so after the port every performance number should be treated as pending
re-confirmation until at least one campaign is re-run on the merged tree. The send-path CPU
figures are the ones most exposed, since they are precisely what step 6 rewires.


---

## What changed on 2026-09-08, and what it does to this plan

The source-policy pass and the comment lean both landed after this document was written.
Neither changes the shape of the merge; both make step 6 smaller.

**Step 5 (`main.rs`) shrinks.** A product build now carries `--stream-mode`, `--bind`,
`--receive-window`, `--send-window`, `--congestion` and `--prefault`. Everything else is
behind `--features lab`. So the CLI reconciliation is six additive flags against `main`'s
three, not thirteen.

**Step 6 (`server.rs`) shrinks too.** `send_one_frame` lost three arguments to a `Serving`
struct carrying the per-session choices — which is the shape `main`'s `Pipeline` already
holds, so the port inherits it rather than undoing it. The `Payload` enum is gone: both
paths locate through `frame_bytes`, and `Bytes` derefs to `&[u8]` for the two that want one.

**Three collisions this document did not name**, found by diffing the CLIs directly. All
three are silent — no compile error, no failing test:

| | |
| --- | --- |
| **Duplicate flags** | `main` has `--send-window-bytes` and `--stream-receive-window-bytes`; this branch has `--send-window` and `--stream-receive-window`. A naive merge ships both, and the last one applied wins. Merge `TransportKnobs` into `TransportTuning` and keep `main`'s names — they are the shipped ones |
| **`--max-idle-timeout-ms` stops working** | `main` has it and this branch does not, and it is applied to the *builder* (`server.rs:157`), outside the `TransportConfig` our `to_transport_config()` builds from scratch. Route everything through `TransportTuning` and the flag parses, logs, and does nothing. **This is a regression to `main`.** Add the field, apply it at the builder |
| **`StreamMode` forks** | Both sides define it; `main` exports it from `exact_server` (`lib.rs:5`) and has `stream_mode.rs`. Two enums means the `shared` default can land on the one nothing reads. Delete ours, keep `main`'s, flip there |
