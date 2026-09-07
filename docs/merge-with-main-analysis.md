# Merging this branch with `main` — what actually collides, and what to do

**2026-09-07.** `HANDOFF.md` §1 used to claim `main` was a direct ancestor and the merge was
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
| `server/src/main.rs` | 3 | 151 | CLI: this branch's transport flags against `main`'s new ones |
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

### The acceptance gate already exists

`all_send_paths_are_the_same_wire` is a committed test asserting the three send paths
produce byte-identical output. **If it passes after the port, the port did not change the
wire** — which is the property the whole send-path result rests on. Do not declare step 6
done without it, and do not weaken it to make the port pass.

Beyond that: `cargo build --release --workspace` clean, 12 server tests (15 with
`--features telemetry`), 8 harness tests.

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
