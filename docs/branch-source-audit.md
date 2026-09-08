# What this branch put in `server/`, and what belongs there

**The question this answers:** *the branch is a measurement campaign; the merge ships product
code. Which of the two is each thing we added?*

A measurement needs a knob for every variable it sweeps. A product needs a knob only where a
decision is genuinely open. The branch built the first and is about to merge into the second,
so every addition is classified below against one test: **does a shipped server need this?**

Evidence is usage counts across the repository at `e61d858`, not judgement.

---

## The finding

**Five flags are used by nothing.** Not by a lab script, not by a test, not by a document.
They were built for sweeps that were never run.

**One enum variant appears once in the whole repository** — in the match arm that constructs
it. `SendPath::Split` has no caller, no campaign and no result.

**Three flags are lab arms**: they sweep a variable whose answer is now written down. The arm
must stay reproducible; the shipped binary does not need the knob.

---

## Transport flags

| flag | scripts using it | verdict |
| --- | ---: | --- |
| `--send-window` | 3 | **product** — the memory bound (`measurements/mem/`) |
| `--receive-window` | 3 | **product** — same |
| `--congestion` | 2 | **product** — Cubic vs BBR is regime-dependent and unresolved |
| `--bind` | 14 | **product** — `main` ships it too |
| `--send-path` | 2 | **lab** — with `copy` gated, a product build has one value |
| `--prefault` | 0 | **product** — a decided default, priced in `quic-transport-optimization.md` §6 |
| `--send-fairness` | 3 | **lab** — R6 arm; moot under `shared`, which has one stream |
| `--segmentation-offload` | 2 | **lab** — R6/GSO arm |
| `--ask-priority` | 3 | **lab** — L1 arm Q, never adopted |
| `--stream-receive-window` | 0 | **delete** — `main` ships `--stream-receive-window-bytes` |
| `--socket-send-buffer` | 0 | **delete** — never used by anything |
| `--socket-recv-buffer` | 0 | **delete** — never used by anything |
| `--initial-mtu` | 0 | **delete** — never used by anything |
| `--mtu-discovery` | 0 | **delete** — never used by anything |
| `--ack-frequency` | 0 | **delete** — never used by anything |

`--prefault` reads as dead by the count and is not: it defaults to `true` and no script
overrides it, which is what a decided default looks like. It stays until the merge is green,
because it is the safety half of a change that also alters serving behaviour.

Deleting the socket buffers closes open proposal 5 (dual-stack `set_only_v6`) by making it
moot. If socket sizing is ever wanted, it returns with a campaign behind it.

## Send paths

| path | evidence | verdict |
| --- | --- | --- |
| `chunked` | the default; every published number | **product** |
| `copy` | `HANDOFF.md` §66 — `--send-path copy --prefault true` reproduces `main` exactly | **lab** — the rollback hatch, and the other half of the wire-equality test |

Both paths now locate through `frame_bytes`, which is a refcount bump rather than an
allocation, so the copy path wraps out of it making exactly the copies it made when it
wrapped out of `frame_slice`. That removed the `Payload` enum, which existed only to carry
two shapes.
| `split` | **one occurrence repo-wide**, its own match arm | **delete** |

`split` costs a `Payload` variant, `write_payload_split`, `envelope_header` and a third of
`all_send_paths_are_the_same_wire`, and has never produced a measurement.

## Instruments

| item | verdict |
| --- | --- |
| `record/path.rs` — loss-regime sampler, `#[cfg(feature = "telemetry")]` | **product** — already gated, one row per second, the thing you leave on |
| `WT_SERVE_TIMING` — env read per frame, one script | **lab** — and it is open proposal 4 |
| `frame_store`: `Bytes::from_owner`, `frame_bytes` | **product** — the chunked path's whole basis |
| `touch_frame_pages` off the executor | **product** — pairs with `--prefault` |
| `all_send_paths_are_the_same_wire` | **product** — the acceptance gate for the port |

---

## What we do about it

Dead code is deleted. Lab arms move behind `--features lab`, following the convention the
repository already uses for `telemetry`:

```bash
cargo build --release                 # product: 7 flags, each attached to a written conclusion
cargo build --release --features lab  # every past campaign, byte for byte
```

**Nothing becomes unreproducible.** A campaign that swept an arm still sweeps it; it asks for
the lab binary, which the scripts already build via `l1_build_bins.sh`.

The shipped surface after this pass:

```
--stream-mode --send-window --receive-window --congestion --bind --prefault
```

Six transport flags, from thirteen. Each one points at a section of
`transport-conclusions.md`. A product build always sends `chunked`.

## What this deliberately does not do

**Constant-fold the decided knobs.** `--prefault` is a decision, not a variable, and so is
`--send-path` once `copy` is behind `lab`. Both could be code rather than flags. Not in this
pass: they are the rollback hatch for a merge that changes serving behaviour, and removing the
hatch and changing the behaviour in one step is how a bad afternoon starts. Revisit once the
port is green.

## What the pass actually removed

| | before | after |
| --- | ---: | ---: |
| transport flags on a product build | 13 | **6** |
| send paths in product source | 3 | **1** |
| clippy warnings, workspace | 21 | **3** |
| `server/src` dependencies | — | `socket2` dropped, unused once `bind_socket` went |

The three remaining clippy warnings are in `client/flight-registry`, `client/transport-wasm`
and `server/src/transport/wire.rs`. **None is ours** — this branch never touched those files,
and `main` has already rewritten `read_fod_msg`, which is the one the server warning is
about. Fixing them here would manufacture a merge conflict to silence a style lint.

Two things also fell out, both open proposals:

- **P2** (`WT_SERVE_TIMING` read per frame) — the env read is now a `OnceLock`, and absent
  entirely from a product build.
- **P3** (hand-built socket not dual-stack) — moot. The socket was built only for the buffer
  flags nothing used; with those gone, wtransport binds its own socket and sets `only_v6`
  itself.
