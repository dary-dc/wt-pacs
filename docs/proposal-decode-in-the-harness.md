# Proposal: real decode in the harness

**Superseded 2026-09-16** by [`proposal-downloader.md`](proposal-downloader.md): the pool it draws
on the main thread is one of the layers that proposal removes. Kept for its dispatch reasoning.

**For:** wt-pacs implementer · 2026-09-15 · **Status:** proposed, not built. The dispatch question
it was raised to settle **is** measured — `docs/decode/README.md` §Dispatch — and the answer changes
what the harness should be wired to do, which is why this is a proposal and not a patch.

## What the harness does now

`client/harness/shell.js` `touch()` reads one byte per 4 KiB and the last byte, so the copy is real
and the bytes are used. `index.html` says "not clinical decode". That is why the decode and pipeline
questions have had no home here.

## What the measurement changed

L11 was written to wire in a decode pool with **first-free dispatch**, on the belief that first-free
beats round-robin when decode times are uneven. Measured against real decoders on worker threads,
that belief does not survive as stated:

* uniform frames: a wash, as believed;
* uneven frames, 16 per decoder: also a wash — round-robin ties the best policy and needs no
  coordination at all;
* uneven frames, 3 per decoder: first-free **with one frame of lookahead** finishes a batch 20 %
  sooner, and plain first-free is *worse than round-robin* almost everywhere because it pays a
  main-thread hop per frame.

So the thing worth building is not "first-free". It is **never leave a decoder idle**: keep each
worker one frame ahead. Choosing the free decoder is the cheap part; the lookahead carries the win.
Wiring plain first-free, as the lane described, would have shipped the slower of the two.

## The shape

```
shell.js ──asks──> transport session
         <─frames── │
                    └──> DecodePool (main thread, no decoding of its own)
                           ├── worker 0 ── one decoder instance
                           ├── worker 1 ── one decoder instance
                           └── …
```

* **One pool, sized from `navigator.hardwareConcurrency`**, not a constant — and capped, because
  `docs/decode/README.md` §Heap says each instance is 50 MB of the shipped build and the pool is the
  largest memory decision the viewer makes. A phone reporting 8 would otherwise cost 400 MB of
  decoder before a pixel is drawn.
* **Dispatch: least-outstanding with a lookahead of one.** Two frames outstanding per worker, the
  next going to whichever has fewest. Round-robin stays as the comparison arm rather than the
  default, since on long queues it ties.
* **`touch()` stays**, as the no-decode arm. The point of the harness is comparison, and a decode
  arm with nothing to compare against is worth less than the pair.
* **Per-frame stamps**: available, decode-start, decode-end, taken. Those four give the
  wait/decode/take split, and they must sum to the total or the split is not one.

## What this costs, and the one thing to decide

The pool is the viewer's memory. At the shipped decoder's 50 MB per instance a pool of 4 is 200 MB;
with the build in `lab/decode-bench/wasm/` at a 4 MB floor it is 16 MB for the 512×512 profile
(`docs/decode/README.md` §A build of our own). **The pool size and the decoder build are one
decision**, and sizing the pool from `hardwareConcurrency` only makes sense once the per-instance
cost is the smaller number.

**To decide:** whether the harness's decode arm uses the published package or the build from source.
The source build is byte-identical across 609 frames and takes a floor a twelfth the size, but
adopting it means owning a WASM build in CI. That trade is stated in `docs/decode/README.md`; this
proposal does not settle it, and the pool cap depends on which way it goes.

## Not in this proposal

Cancellation, the cache seam and the paint sink from `docs/client-shape-plan.md` §1. They belong to
later milestones and none of them is what M2 was blocked on.
