# Where a decoded frame goes: moved to `docs/client/`

This ADR (proposed 2026-10-11, last changed 2026-11-02) was split on 2026-11-14 into one evidence file per question
under [`../client/evidence/`](../client/evidence/), word for word but for queue-row names; its sources are
[`../client/evidence/sources.txt`](../client/evidence/sources.txt). The design they shape is
[`../client/design.md`](../client/design.md). The full text as it stood is `git show e5b20cba:docs/adr/frame-path.md`.

A reference to a section of this file, in code or docs, resolves here:

| section | now in |
| --- | --- |
| §1 · Today, and the question | [`page-out-of-pixel-path.md`](../client/evidence/page-out-of-pixel-path.md) |
| §2 · What the page thread costs, and what a busy one does | [`page-out-of-pixel-path.md`](../client/evidence/page-out-of-pixel-path.md) |
| §3 · Who owns the frame store | [`frame-store-owner.md`](../client/evidence/frame-store-owner.md) |
| §Experiment 2: the want ascending, and no ask across the running fill (2026-10-29) | [`ask-order-during-fill.md`](../client/evidence/ask-order-during-fill.md) |
| §Experiment 3: a transferred `ArrayBuffer` per frame (2026-10-29) | [`transferred-buffer-per-frame.md`](../client/evidence/transferred-buffer-per-frame.md) |
| §4 · OPFS, from the specs and the engines' sources | [`cache-in-opfs.md`](../client/evidence/cache-in-opfs.md) |
| §5 · The exactness digest | [`cache-in-opfs.md`](../client/evidence/cache-in-opfs.md) |
| §6 · Memory on phones, and where the write goes | [`cache-in-opfs.md`](../client/evidence/cache-in-opfs.md) |
| §7 · Protocol (proposed 2026-10-11; run 2026-10-30 on the core, amended before data) | [`page-out-of-pixel-path.md`](../client/evidence/page-out-of-pixel-path.md) |
| §The view worker's start, timed (pre-registered 2026-10-30, before any data) | [`view-worker-start.md`](../client/evidence/view-worker-start.md) |
| §The pixel read under a busy page (2026-10-30) | [`pixel-read-under-busy-page.md`](../client/evidence/pixel-read-under-busy-page.md) |
| §A frame clock in the view worker (2026-10-28) | [`frame-clock-in-a-worker.md`](../client/evidence/frame-clock-in-a-worker.md) |
| §8 · Decisions for the owner | [`page-out-of-pixel-path.md`](../client/evidence/page-out-of-pixel-path.md) |
| §9 · Sources | [`page-out-of-pixel-path.md`](../client/evidence/page-out-of-pixel-path.md) |
| §Proposed: the client cache in OPFS · 2026-10-20 | [`cache-in-opfs.md`](../client/evidence/cache-in-opfs.md) |
| §Background: why the page has a ceiling | [`cache-in-opfs.md`](../client/evidence/cache-in-opfs.md) |
| §The mechanism proposed | [`cache-in-opfs.md`](../client/evidence/cache-in-opfs.md) |
| §The levers, and what decides each | [`cache-in-opfs.md`](../client/evidence/cache-in-opfs.md) |
| §Where it saturates, predicted | [`cache-in-opfs.md`](../client/evidence/cache-in-opfs.md) |
| §Measurement owed (proposed, not queued) | [`cache-in-opfs.md`](../client/evidence/cache-in-opfs.md) |
| §Who owns a frame's memory (2026-10-28) | [`frame-memory-ownership.md`](../client/evidence/frame-memory-ownership.md) |
| §Options, and what each costs | [`frame-memory-ownership.md`](../client/evidence/frame-memory-ownership.md) |
| §Questions for the owner | [`frame-memory-ownership.md`](../client/evidence/frame-memory-ownership.md) |
| §Sources, 2026-10-22 | [`frame-memory-ownership.md`](../client/evidence/frame-memory-ownership.md) |
| §Sources, 2026-10-27 | [`frame-memory-ownership.md`](../client/evidence/frame-memory-ownership.md) |
| §The cache I/O in the view worker: sync, async, or a store worker (2026-10-28) | [`cache-io-thread.md`](../client/evidence/cache-io-thread.md) |
| §Target: the view worker · 2026-10-28 | [`view-worker-design.md`](../client/evidence/view-worker-design.md) |
| §Review: the red team (2026-10-28) | [`view-worker-design.md`](../client/evidence/view-worker-design.md) |
| §An independent design (2026-10-28) | [`view-worker-design.md`](../client/evidence/view-worker-design.md) |
| §The independent design against the target (2026-10-28) | [`view-worker-design.md`](../client/evidence/view-worker-design.md) |
| §Experiments beside the target (2026-10-29) | [`view-worker-experiments.md`](../client/evidence/view-worker-experiments.md) |
| §The receive loop beside the paint (2026-10-29) | [`receive-loop-beside-paint.md`](../client/evidence/receive-loop-beside-paint.md) |
| §The core, assembled (2026-10-30) | [`core-against-main.md`](../client/evidence/core-against-main.md) |
| §Independent review of the assembled core (2026-10-30) | [`core-against-main.md`](../client/evidence/core-against-main.md) |
| §A second independent review of the core (2026-11-02) | [`core-against-main.md`](../client/evidence/core-against-main.md) |
| §The core against main, timed (2026-10-30) | [`core-against-main.md`](../client/evidence/core-against-main.md) |
