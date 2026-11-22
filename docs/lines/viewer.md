# 2D viewer

Last verified 2026-11-20 (PR state and branches; the findings as of 2026-11-12, against the demo tip
`claude/demo-fixes-2` `18d2d1ff`, `claude/line-viewer` `bbba29fd`, `claude/viewer-seam2` `f90fc336`). **Work state:
paused** by the owner on 2026-10-30; it stays paused. The product: [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The
product. The viewer's design, decisions and open questions: [`../viewer/README.md`](../viewer/README.md).

## Goal

A complete 2D DICOM viewer product, breast diagnostic reading first, built on the client (transport, decode, check,
cache, paint), which stays the client line's ([`client.md`](client.md)). Exactness reaches the screen.

## In flight

Nothing runs while the line is paused.

* **On `claude/unified`**: the design documents without their requirements (`docs/viewer/survey.md`,
  `integration.md`, `architecture.md`); no viewer product code (the page in `client/viewer/` is the client line's,
  the base a viewer sits on); from this line's work only #302's controller fix (a repaint before the current frame
  is held no longer stops all painting), merged as `67de3166`.
* **Parked, not in `claude/unified`**: `claude/line-viewer` (the requirements, #193 with #210's fixes; no unified
  branch, [`../reviews/lines-ready.md`](../reviews/lines-ready.md) §6, §7) and `claude/viewer-seam2` (the seam, #300).

## PRs

| PR | what | state |
| --- | --- | --- |
| #255 | the line, `claude/line-viewer` (carries #193, #210, #215) | open, paused |
| #297, #300 | the seam: our painter inside Cornerstone3D (option B) | open |
| #215 | the 1:1 mode, on the old page viewer; conflicts with the tip | open |
| #214 | the throwaway spike | open |
| #193 | the requirements | open |
| #210, #251, #302 | the requirements' fixes; the cine never skips a slice (old page viewer); the controller fix | closed 2026-11-18, not merged (#302's commit is in the tip) |

Merge onto the line or close: the owner's ([`../reviews/merge-plan.md`](../reviews/merge-plan.md) §4.2).

## Owed runs

* **The phone run of A against B**, pre-registered 2026-11-03 (`integration.md` §6 on `claude/viewer-seam2`); only a
  phone decides [`../viewer/README.md`](../viewer/README.md) §Open item 2. Then a DBT cell.
* **The bound question**: how far Cornerstone3D's standard paint is from `client/paint/reference.js`, by the page
  check's readback (§Open item 5); never run.
* **Touch for a reading viewer**: which gesture set a reader's viewer uses, on a phone (§Open item 7).

## What an agent may do while paused

Without the owner: review #251, #297, #300 and #215 against the tip as findings; carry `requirements.md` and the
seam's findings into one doc on a draft PR, with §Open item 2's renaming; amend the phone run's protocol for the phone
session's tooling, written by a session that will not run it.

## Waits for the owner

Resuming the line; any build of A or B; the phone run; whether to carry B beside A (§Open item 2); the requirements
read (§Open item 4); any merge; closing any PR; any change to the viewer's §Decided, above all the 2026-10-27 choice of
A.

## Pointers

[`../viewer/README.md`](../viewer/README.md) and `docs/viewer/` (`survey.md`, `integration.md`, `architecture.md`);
`claude/line-viewer:docs/viewer/requirements.md`; `claude/viewer-seam2:docs/viewer/integration.md` §§A seam for our
painter inside Cornerstone3D, 5–8, and `claude/viewer-seam2:lab/viewer-spike/seam-core/` (rows in `rows/proxy.txt`);
[`../reviews/slice-touch.md`](../reviews/slice-touch.md); `docs/ARCHITECTURE.md`, `docs/CLIENTS.md`, `client/README.md` §The
viewer; [`../reviews/lines-ready.md`](../reviews/lines-ready.md) §6. Metadata a viewer reads: [`metadata.md`](metadata.md).
