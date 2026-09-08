# What this branch put in `server/`, and what belongs there

**The question this answers:** *the branch is a measurement campaign; the merge ships product
code. Which of the two is each thing we added?*

A measurement needs a knob for every variable it sweeps. A product needs a knob only where a
decision is genuinely open. The branch built the first and is about to merge into the second,
so every addition is classified below against one test: **does a shipped server need this?**

Evidence is usage counts across the repository at `6d56b33`, not judgement.

---

## The finding

**Thirteen transport flags and three send paths reach a shipped server; six flags and one
send path have a reason to.** Everything else sweeps a variable whose answer is written
down. The arm must stay reproducible; the binary a hospital runs does not need the knob.

> ### A correction, and it is the interesting part
>
> The first version of this audit counted usage with `grep` over `lab/scripts/` and
> `server/src/`, and concluded that **five flags were used by nothing** and that
> `SendPath::Split` was **dead — one occurrence repo-wide**. On that basis they were
> deleted.
>
> **Both conclusions were wrong, for the same reason.** Arms are not invoked from inside the
> scripts; they are passed in from the command line through `SRV_FLAGS`, and those command
> lines live in the *documents*. `quic-transport-optimization.md` §5 — titled *"Measured and
> rejected"* — runs every one of those five flags and reports its result. `split` has three
> committed TSVs (`sendpath_interleaved_{shaped,unshaped}.tsv`, `sendpath_multiclient.tsv`),
> is the baseline the chunked path's knee is measured against, and supplies two rows of
> `stall-client.md`'s memory table. Grepping for `SendPath::Split` found the symbol, which is
> constructed in exactly one place; it never had a chance to find `--send-path split`.
>
> Deleting them would have made a committed results section irreproducible. **Every one is
> now behind `--features lab` instead**, which is what the rest of this document already
> said to do with an arm.
>
> The lesson generalises past this branch: *a usage count is only as wide as the places you
> looked, and this repository deliberately keeps its invocations in prose.*

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
| `--stream-receive-window` | §5 arm | **lab** — measured nil; `main` ships `--stream-receive-window-bytes` |
| `--socket-send-buffer` | §5 arm | **lab** — measured nil (−2.1 % / +1.5 %) |
| `--socket-recv-buffer` | §5 arm | **lab** — same arm |
| `--initial-mtu` | §5 arm | **lab** — measured nil |
| `--mtu-discovery` | §5 arm | **lab** — same arm |
| `--ack-frequency` | §5 arm | **lab** — measured **+2.7 %** at 250 KB, called marginal |

"§5 arm" means `quic-transport-optimization.md` §5 runs it through `SRV_FLAGS` and reports a
number. `--ack-frequency` is the one to watch: it is the only "rejected" arm with a non-nil
result, so it is the most likely of these to come back.

`--prefault` reads as dead by the count and is not: it defaults to `true` and no script
overrides it, which is what a decided default looks like. It stays until the merge is green,
because it is the safety half of a change that also alters serving behaviour.

Deleting the socket buffers closes open proposal 5 (dual-stack `set_only_v6`) by making it
moot. If socket sizing is ever wanted, it returns with a campaign behind it.

## Send paths

| path | evidence | verdict |
| --- | --- | --- |
| `chunked` | the default; every published number | **product** |
| `copy` | `HANDOFF.md` §66 — `--send-path copy --prefault true` reproduces `main` exactly | **lab** — the rollback hatch, and one third of the wire-equality test |
| `split` | three committed TSVs; the baseline chunked's knee is measured against; two rows of `stall-client.md` §5 | **lab** |

All three now locate through `frame_bytes`, which is a refcount bump rather than an
allocation: `copy` wraps out of it and `split` derefs it to `&[u8]`, each making exactly the
copies it made when it started from `frame_slice`. That retired the `Payload` enum, which
existed only to carry two shapes through one function.

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

Every arm moves behind `--features lab`, following the convention the repository already
uses for `telemetry`. **Nothing is deleted** — see the correction above for why that matters.

```bash
cargo build --release                 # product: 10 flags, 6 transport, each backed by a conclusion
cargo build --release --features lab  # 20 flags; every arm this branch ever ran, byte for byte
```

**Nothing becomes unreproducible.** A campaign that swept an arm still sweeps it; it asks for
the lab binary, and every lab script now builds with the feature.

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
| flags on a product build (`--help`) | 20 | **10** |
| of those, transport knobs | 13 | **6** |
| send paths a product build can select | 3 | **1** |
| clippy warnings, workspace | 21 | **3** |
| `socket2` | unconditional | **`lab`-only** (`dep:socket2`) |

**Nothing was deleted.** Every arm this branch ever ran is still reachable with
`--features lab`, and the lab scripts build with it.

The three remaining clippy warnings are in `client/flight-registry`, `client/transport-wasm`
and `server/src/transport/wire.rs`. **None is ours** — this branch never touched those files,
and `main` has already rewritten `read_fod_msg`, which is the one the server warning is
about. Fixing them here would manufacture a merge conflict to silence a style lint.

Two things also fell out, both open proposals:

- **P2** (`WT_SERVE_TIMING` read per frame) — the env read is now a `OnceLock`, and absent
  entirely from a product build.
- **P3** (hand-built socket not dual-stack) — **fixed**, not moot. The socket survives behind
  `lab`, so the fix had to be made rather than deleted around: `set_only_v6(false)` now
  matches what wtransport's own bind does, and the buffer arms no longer differ from their
  control in two variables.
