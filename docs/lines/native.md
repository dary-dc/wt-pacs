# Native

Last verified 2026-10-27 (the design state); branches and PRs 2026-11-09.

## Goal

A native client without the browser's limits, for HTJ2K and AV1: computers first, phones the end. Lossless and
bit-exact; mobile on lossy wireless.

## State now

* **Theory:** `docs/native/` — `quic.md`, `quic-compared.md`, `README.md` (paint, cache, app shape, costs; the
  milestones M1 paint proof, M2 native fill against the browser, M3 cache, M4 phone first; open decisions in §7).
* **Built, carried by `claude/core` (#250):** `claude/core:client/native/`, about 3 000 lines: a raw-QUIC client
  (quinn) on its own ALPN `wt-pacs/1`, which the server accepts beside h3 on its one endpoint; native OpenJPH and
  dav1d; verify; a file cache; a wgpu painter and a window; the view-worker design on threads
  (`--paint-thread ui|view|core`).
* Its workspace membership breaks `core`'s image build: `deploy/Containerfile` does not copy
  `claude/core:client/native` ([`coordination.md`](coordination.md)).
* `claude/native-parity` (#277: browser display controls, product cine) and `claude/native-metrics` (#278: the
  window timed against the browser, an interim run) are not in the second fold (#289); merge or archive is open.
  #289's description records the native shape as decided "basic"; not re-checked here.

## Open (ordered)

1. Fix the image build (copy the manifest, or exclude the member from the image's workspace).
2. `docs/native/README.md` §7's open decisions: shape, cache policy, intended use, distribution.
3. M4 on a phone.

## Decisions (the owner's)

* 2026-10-10: native is a next goal, computers first, phones the end; the owner takes every transport choice.
* 2026-10-26: build now: a headless Rust core on raw QUIC with its own ALPN beside WebTransport, native OpenJPH and
  dav1d, verify, a file cache, then M1 and M2; the UI shape stays open.
* 2026-10-27: after M2, a minimal window on a computer (winit and wgpu) to make the shape question concrete.

## Pointers

`docs/native/`, `docs/WIRE.md`, `lab/window-harness`; `claude/core:client/native/`,
`claude/core:server/src/transport/`, `docs/adr/frame-path.md` §The core, assembled (on `claude/core`).
