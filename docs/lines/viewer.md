# 2D viewer

Last verified 2026-10-27 (the design state); branches and PRs 2026-11-09. **Paused by the owner on 2026-10-30.**

## Goal

A complete 2D DICOM viewer product, breast diagnostic reading first: required and nice-to-have features, existing
viewers, architecture options, integration or build. The client (transport, decode, verify, cache, paint) is its
base and stays the client line's ([`client.md`](client.md)).

## State now

* **Architecture chosen (2026-10-27): option A**, our own viewer on today's client, because exactness must reach the
  screen.
* **Written:** requirements on their sources, a survey of existing viewers, integration at code level, the
  architecture and a spike protocol (`claude/av1-unified-mainbase:docs/viewer/`).
* **On `claude/line-viewer` (#255, parked, not for merge):** the requirements and three contradictions fixed (no
  wrap; DX and CR rotate), A's first step (a 1:1 mode); `claude/viewer-seam` and `claude/viewer-seam2` (#297, #300)
  put our painter inside Cornerstone3D and cost option B, with a phone protocol.
* The spike (`claude/viewer-spike`, #214) was a throwaway glue check.

## Open (ordered)

1. Resume only on the owner's word.
2. Then: the owner reads the requirements, survey, integration and architecture docs; A's next steps on the client's
   view worker.
3. `claude/cine-no-skip` (#251, cine never skips a slice, on the old page viewer): re-base onto the core's controller
   or archive.

## Decisions (the owner's)

* 2026-10-24: the viewer is designed separately, after the client improves.
* 2026-10-26: a line of its own, kept apart from the client line.
* 2026-10-27: exactness must reach the screen, so option A.
* 2026-10-30: paused.

## Pointers

`claude/av1-unified-mainbase:docs/viewer/` (also on `claude/core`), `docs/ARCHITECTURE.md`, `docs/CLIENTS.md`;
branches `claude/line-viewer`, `claude/viewer-seam`, `claude/viewer-seam2`.
