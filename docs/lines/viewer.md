# 2D viewer

Last verified 2026-11-12 against the demo tip `claude/demo-fixes-2` `18d2d1ff` (PR 367), `claude/line-viewer`
`bbba29fd` (#255), `claude/viewer-seam2` `f90fc336` (#300), `claude/lines-ready`, `claude/merge-plan`,
`claude/slice-touch` and the open PRs. **Paused by the owner on 2026-10-30; it stays paused.**

## 1. Goal

A complete 2D DICOM viewer product, breast diagnostic reading first, built on the client (transport, decode, check,
cache, paint), which stays the client line's ([`client.md`](client.md)). Exactness reaches the screen.

## 2. On `main` after this week's merge

What PR 367 then PR 250 carry, once the owner gives the two words; none of it is on `main` yet. The line has no
unified branch: `claude/line-viewer` stays parked (`claude/lines-ready:docs/reviews/lines-ready.md` §6, §7).

* **The design documents, without their requirements**: `docs/viewer/survey.md` (existing viewers),
  `integration.md` (how our base plugs into each, as of 2026-10-27) and `architecture.md` (options A, B, C and a
  pre-registered spike, never run). `requirements.md` is not on the tip: it is on `claude/line-viewer` (#193, with
  #210's fixes), and `architecture.md` names it by branch.
* **No viewer product code.** The page the demo ships (`client/viewer/`, both views, the slice slider, the label and
  the Lossless button) is the client line's; it is the base a viewer sits on, not the viewer.
* **From this line's work, in the tip**: #302, the controller fix found by the seam (a repaint before the current
  frame is held no longer stops all painting), merged as `67de3166`. Nothing else.

## 3. Decided (never reopened by an agent)

| decision | date | recorded |
| --- | --- | --- |
| The viewer is designed separately, after the client improves | 2026-10-24 | this file since that date |
| A line of its own, apart from the client line | 2026-10-26 | same |
| Exactness must reach the screen, so option A: our own viewer on today's client | 2026-10-27 | same |
| Paused; resume only on the owner's word | 2026-10-30 | same; #255's title |
| `claude/line-viewer` stays parked, with no unified branch | 2026-11-11 21:40 | `claude/work-ledger:docs/queue-2026-11-10.md` (UNIFY rows) |
| Breast imaging first; mobile on lossy wireless; the exact frame bit exact | standing | [`README.md`](README.md), the queue file §Decided approaches |

## 4. Open, ranked

Fixtures for every result below: the seam's synthetic 24 slices of 128×96, 16-bit HTJ2K; headless Chromium on
SwiftShader in 4-core cloud containers without a GPU, CPU throttled 4× and 6× as a phone proxy. No viewer run on a
phone, a GPU, Firefox or DPR 2 exists, and none on a DBT volume.

1. **Resume, or stay paused.** The owner's word only. Everything below waits on it except item 6's reviews.
2. **Carry B with our painter beside A, or not.** The seam (#297, #300) found that a Cornerstone3D viewport type of
   our own (`registerViewportType`, `useCustomRenderingPipeline`) lets the view worker paint inside Cornerstone3D:
   the 1:1 proof, zero copies and the paint off the page kept, its tools and annotations taken. Its costs are listed
   and verified by test or source (`claude/viewer-seam2:docs/viewer/integration.md` §What option B costs): our cine
   and linked window, an annotation a frame apart from its image, methods Cornerstone3D says it will remove, the
   OHIF glue not built. It does not reopen the 2026-10-27 decision on its own: whether to carry it is the owner's.
   **Names**: that section's §6 calls Cornerstone3D's standard path "option A" and our viewport "option B", against
   `architecture.md`'s letters (A ours, B Cornerstone3D). Any doc that carries §6 forward renames them first.
3. **The phone run of A against B** (`integration.md` §6, pre-registered 2026-11-03 before any data; its rule:
   medians over 10 interleaved rounds, five metrics with fixed margins, void below 8 kept rounds). The desktop proxy
   gave a tie at 4× and "B pays for its costs" at 6×, indicative only: every long task fell in the open, none in
   scroll or cine; B's scroll time is one thread hop later than A's; memory is the page heap only, which favours B.
   Matters: only a phone decides item 2. Inputs: the phone session's tooling (RUNNER-AUTO), `proxy.mjs` on
   `claude/viewer-seam2`. Then a DBT cell.
4. **The requirements read by the owner** (`claude/line-viewer:docs/viewer/requirements.md`), then survey,
   integration and architecture; then A's next steps on the client's view worker: the 1:1 mode (#215) and a 2×2
   layout held by one paint worker (`architecture.md` §The spike, *A*). The 1:1 mode targets the old page viewer
   and conflicts with the tip (`client/viewer/{viewer.js,check.mjs,run_check.sh}`, `lab/viewer/check-page.js`).
5. **The bound question** (`integration.md` §Open): if exactness stops at the decoded frame, Cornerstone3D's
   standard paint needs a bound (one code, say) and a check that holds it; neither exists. How far its paint is from
   `client/paint/reference.js` is measurable with the page check's readback, never run.
6. **Stale drafts**: #251 (the cine never skips a slice, on the old page viewer: re-base onto the core's controller
   or close), #214 (the throwaway spike), #193, #210, #215 (carried by #255), #297, #300 (the seam). Merge onto the
   line or close: the owner's (`claude/merge-plan:docs/reviews/merge-plan.md` §4.2). A review row can state what each
   still holds against the tip.
7. **Touch for a reading viewer**: SLICE-TOUCH (`claude/slice-touch:docs/reviews/slice-touch.md`) surveyed slice
   stepping on phones (OHIF three fingers and a slider, RadiAnt and CaseStacks one finger in a mode; only two-finger
   pinch zoom and pan is common to all); the demo took the slider. Which gesture set a reader's viewer uses is not
   measured on any phone.
8. **Metadata a viewer reads**: the ingest carries no pixel spacing, frame of reference or instance UIDs, which
   Cornerstone3D's tools and OHIF's measurement panel need (`integration.md` §What option B costs, 6). It belongs to
   [`metadata.md`](metadata.md) (#153's viewer-metadata ADR).

## 5. Unsupervised

While paused, an agent may, without the owner: review #251, #297, #300 and #215 against the tip as findings; carry
`requirements.md` and the seam's findings into one doc on a draft PR, with item 2's renaming; amend item 3's protocol
for the phone session's tooling, written by a session that will not run it.

Waits for the owner: resuming the line; any build of A or B; the phone run; any merge; closing any PR; any change to
§3, above all the 2026-10-27 choice of A.

## 6. Pointers

`docs/viewer/` on the tip (`survey.md`, `integration.md`, `architecture.md`); `claude/line-viewer:docs/viewer/requirements.md`;
`claude/viewer-seam2:docs/viewer/integration.md` §§A seam for our painter inside Cornerstone3D, 5–8, and
`claude/viewer-seam2:lab/viewer-spike/seam-core/` (rows in `rows/proxy.txt`); `claude/slice-touch:docs/reviews/slice-touch.md`;
`docs/ARCHITECTURE.md`, `docs/CLIENTS.md`, `client/README.md` §The viewer; `claude/lines-ready:docs/reviews/lines-ready.md` §6;
PRs 255, 297, 300, 251, 215, 214, 210, 193.
