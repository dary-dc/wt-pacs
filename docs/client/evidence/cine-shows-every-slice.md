# The cine shows every slice

**Question:** Does the viewer's cine show every slice of a series, once and in order, whatever the paint or the link
costs?

*Folded 2026-11-14 from `claude/cine-no-skip:client/README.md` §The viewer (*Cine* and the key checks) and
`claude/cine-no-skip:docs/ARCHITECTURE.md` §The viewer, *Its cine skipped slices, and no longer does* (c23f8f75,
942086d3, 440047ff; the key checks cb943122, f4543c8d, 92361637, 0a110b89). The fix and its check are on that branch,
not in this tree: this tree's viewer check still fails a cine only when it "did not move". Measured, headless Chromium
on SwiftShader, one container. Why a display may not skip slices, and the scroll rates readers use:
[`scroll-rate-and-skipping.md`](scroll-rate-and-skipping.md). The design these findings shape is
[`../design.md`](../design.md).*

## The rule

The cine runs at the series' `frameTimeMs` (or `cineRate`, else 10 a second), stepped on the page's animation frames,
each step only once the slice before it is held and painted: a slice not yet here or still painting is waited for,
never skipped (IHE RAD TF-2, DBT: "shall not skip slices during manual or automatic scrolling"). A late step restarts
the schedule rather than catching up.

## What was wrong, and since when

The viewer's cine was a 100 ms timer stepping `current`, the paint coalescing behind it, so a step that came while a
paint was in flight was never painted. The viewer spike found it (#214, `docs/viewer/architecture.md` at 4133958, never
merged): 18 of 50 DBT slices skipped at 100 ms, on SwiftShader, where those frames paint slower than a step.

## Measured, 2026-10-30

Headless Chromium on SwiftShader, a 50-frame HTJ2K series of the gate's 160² frames, which paint in a few ms. The page
check counts the slices shown off the painter's completed paints, of which only the last between two page frames
counts as shown (`client/viewer/check-page.js` `cineSweep` on `claude/cine-no-skip`, c23f8f75).

| arm | the old 100 ms timer | the fix |
| --- | --- | --- |
| filled, 60 frames a second | 47–48 of 50 shown: the timer's 16 ms against the page's 16.7 put two paints in one frame | 50 of 50, in order |
| filled, each paint's completion held 50 ms, 30 a second | 30 of 50 | 50 of 50, slower than the rate |
| on demand, each ask held 50 ms, 60 a second | 3 of 50 | 50 of 50, slower than the rate |
| filled, 100 ms a step | none skipped on these frames | — |

With nothing held back, the fixed cine steps 33.3 ms at 30 a second. Each of its three conditions (the slice held, the
slice painted, its time due), taken out, fails an arm.

**Where it saturates, and what is not claimed:** not measured on a GPU; past the page's frame rate, 60 here, nothing is
claimed.

## The check, as the branch has it

With `--cine`, the check fails a sweep from the last frame round to it again that did not show every slice once, in
order; or, with nothing held back, one that stepped faster than the series' rate or more than 1.25× slower than it (or
than the page's frames). Filled, it sweeps twice: as painted, and with each paint's completion held 50 ms; on demand,
once, with each ask held 50 ms. The gate's series grows from three frames to 50, run filled with `--cine` at 30 frames
a second (OT) and with `--fill 0 --cine` at 60 (DX).

The same branch's checks also fail: a manual step past the last or first frame that moved (the cine still loops);
`r`, `h` and `v` that turned or flipped other than a DX or CR series; `I` that did not act as `i` (shortcuts ignore
case); and the cine starts on the last frame, so a cine that stops there fails.

## Verdict

On the gate's 160² frames in Chromium on SwiftShader, the old cine skipped slices at 60 a second and whenever a paint
or an ask was slow; the fix shows every slice in order in every arm. It holds for this viewer's simple cine; the view
worker's cine is designed to the same rule ([`view-worker-design.md`](view-worker-design.md) §Target, *Cine*).
