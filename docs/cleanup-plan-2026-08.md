# Cleanup after the queue rejection

**Date:** 2026-08-26 · **Driver:** [`adr-reject-server-ordering.md`](adr-reject-server-ordering.md)

Server-side cancel and server-side ordering are both rejected. This removes what was built for them.
**Essentialist rule: a mechanism that carries no measured benefit does not stay in a product repo.**
Git history preserves everything deleted here.

---

## 1 · Product server — the main item

`server/src/transport/queue.rs` is **209 of the product server's 562 lines** — 37% of the server, for a
mechanism with no measured benefit.

| Step | File | Action |
| ---- | ---- | ------ |
| 1.1 | `server/src/transport/queue.rs` | delete |
| 1.2 | `server/src/transport/mod.rs` | drop `mod queue;` |
| 1.3 | `server/src/transport/server.rs` | replace `queue::run_session` with the serial loop: read one ask, send it to completion, read the next |
| 1.4 | tests | `cargo test -p wt-pacs-server` green before and after |

**The cap question is answered by the serial loop itself.** Unread asks are bounded by QUIC stream flow
control, and each is served to completion before the next is read, so there is no amplification and no
unbounded queue. `INBOX_CAP` was solving a problem the serial loop does not have.

**`queue_us` disappears with it.** That is correct — a duration that is structurally zero must not be
emitted. `work_us` and `write_us` are unaffected and remain worth having.

---

## 2 · Wire

| Step | File | Action |
| ---- | ---- | ------ |
| 2.1 | `common/fod/src/lib.rs` | remove `FodMsg::CancelFrames` and `roundtrip_cancel_frames` |
| 2.2 | `docs/WIRE.md` | remove the message |

An ignored message is worse than an absent one: it advertises a capability that does not exist.

### Decided 2026-08-26

`client/transport-wasm` and `client/transport-ts` expose a **client-local** `cancelFrame` that rejects
the pending promise and counts it. It never reaches the wire. **It has no callers anywhere in the
repo** — dead API surface in both clients.

**Remove it.** The window design never cancels: the server sends the frame regardless, so cancelling
locally discards bytes already paid for.

### Idea, explicitly not for implementation

> **Cache whatever arrives; never discard a frame.**

Repeated depth passes mean an unwanted frame is usually wanted again shortly, so discarding throws away
bytes that were already spent. Plausible, and more attractive once frames are tiled, because units are
smaller and reusable across positions.

**Untested. Not a phase-1 item, and not to be implemented on the strength of the argument alone.**
Recorded so it is not lost, not so it is built.

---

## 2b · Wire surface left behind (added 2026-08-26) — **executed**

### 2b.1 · Remove `generation` — done

`generation` removed from `RequestFrame` / `RequestFrames` in `common/fod`, both clients, and
`window-harness`. It advertised ask-ordering that was rejected.

### 2b.2 · `RequestPath` — removed

Removed with stride paused at the design level. Not reserved-on-the-wire: absent is clearer than
silent-ignore.

### 2b.3 · Ask granularity — documented in `WIRE.md`

`RequestFrames` stays for bulk/test. Real-time path is one `RequestFrame` per message.
---

## 3 · Lab

`lab/README.md` states no product crate depends on these, so deletions here are contained.

| Crate / file | Action | Why |
| ------------ | ------ | --- |
| `lab/window-server/` (470 lines) | **delete** | gen-order + stream-cap arms. Both rejected |
| `lab/queue-sim/` | **delete** | predicted curves for a rejected mechanism. Its one durable finding — the 10× overprediction — is already recorded in the cancel ADR |
| `lab/queue-harness/` | **keep, rename `window-harness`** | the headless client with `--depth`. This is exactly what E1 and E2 need |
| `lab/cold-page-bench/` | **keep, extend** | E3. Add the runtime-stall metric |
| `lab/fixtures/queue_large` | keep, add ~32 KB and ~250 KB fixtures | E1 needs `Tf` as an axis |
| `lab/traces/*.json` | keep all | `reversal_storm.json` becomes E2's primary trace |
| `lab/scripts/window_depth_sweep.sh` | **rewrite** | drives `window-server` today |
| `lab/scripts/harness_sweep_mbps.sh` | keep, repurpose for E1 | |
| `lab/scripts/netem_q2.sh` | keep | head-of-line (Q2) is still open |
| `Cargo.toml` workspace members | drop `lab/queue-sim`, `lab/window-server`; rename harness | |
| `lab/queue-harness --server-cancel` | remove the flag | already label-only |

---

## 4 · Docs

Repo convention is **retract in writing** — banner, do not silently edit.

| File | Action |
| ---- | ------ |
| `adr-reject-server-cancel.md` | banner: §4 and §5 superseded by the ordering ADR. Leave the body intact — the measurement is still the evidence |
| `queue-and-hol-harness.md` | §1 (the queue shape) obsolete → banner. **§2 (head-of-line) is still live** and must survive the trim |
| `stride-and-queue-experiment.md` | banner: stride paused at design level. **§2 (the RTT-recovery derivation) stays** — the ordering ADR cites it |
| `lab/README.md` | rewrite the crate table and the Q1 section |

---

## 5 · Order of work

Sequenced so nothing is deleted before what depends on it:

1. **Docs banners** — zero code risk, and they stop anyone acting on the stale plans mid-cleanup
2. **Lab deletions** — no product crate depends on `lab/`
3. **Product server revert** (§1) — the only step with real risk. Tests green before and after
4. **Wire removal** (§2) — touches `common/fod` and its consumers
5. **Rename + script rewrite** — cosmetic, last

Steps 1–2 can land in one commit. Step 3 should be its own.

---

## 6 · Net effect

| | |
| - | - |
| Product server | 562 → **433 lines** (executed) |
| Lab crates | 4 → **2** (executed) |
| Wire messages | `CancelFrames`, `generation`, `RequestPath` removed; ask granularity in `WIRE.md` (executed) |
| Docs | 8 files, 3 with supersession banners, 1 deleted, 1 added |
