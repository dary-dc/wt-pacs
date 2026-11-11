# Stepping slices by touch (SLICE-TOUCH, 2026-11-11)

Findings only; nothing is built here. Queue row SLICE-TOUCH: how established viewers let a reader step through
slices on a phone without a wheel or keys, a far jump included, and the smallest pattern for the demo tip
(`claude/demo-fixes-1` at `daee0d1d`). DEMO-UX builds what §3 recommends.

Sources were read on 2026-11-11. Code is quoted at the commit named; manuals as served that day. Nothing here was
tried on a phone: what a phone's Chrome does with each pattern is not measured.

## 1. What established viewers do

| # | who documents it | slice stepping on touch | window/level, pan, zoom beside it | discovery |
| --- | --- | --- | --- | --- |
| P1 | OHIF (default tool group) on Cornerstone3D | three-finger vertical drag | one finger W/L; two fingers pinch zoom and pan | none shown; the scrollbar (P4) is |
| P2 | RadiAnt DICOM Viewer (Windows touch screens) | one-finger drag, "browsing series by default" | two fingers pinch zoom and pan; three fingers brightness and contrast | the toolbar's selected tool |
| P3 | CaseStacks mobile app | one-finger drag in a *Scroll* mode, chosen first | the same finger in *W/L* or *Zoom* mode; two fingers pinch zoom and pan in every mode | the mode buttons |
| P4 | OHIF `ImageScrollbar` | a slider along the viewport's right edge: drag the thumb, or set it anywhere (the far jump) | no gesture taken: its own element | always visible |

**P1, OHIF and Cornerstone3D.** OHIF's basic mode, `modes/basic/src/initToolGroups.ts` at OHIF/Viewers
`240bea1f`, binds:

```ts
toolName: toolNames.WindowLevel,
bindings: [{ mouseButton: Enums.MouseBindings.Primary }],
...
toolName: toolNames.Zoom,
bindings: [{ mouseButton: Enums.MouseBindings.Secondary }, { numTouchPoints: 2 }],
...
toolName: toolNames.StackScroll,
bindings: [{ mouseButton: Enums.MouseBindings.Wheel }, { numTouchPoints: 3 }],
```

Cornerstone3D's documentation, `packages/docs/docs/concepts/cornerstone-tools/touch.md` at cornerstone3D `c0fb7309`:
"Touch tools have bindings depending on the number of pointers that are placed down." and "The
`MouseBindings.Primary` is a special binding type which will automatically bind single finger touch." Its example
binds `ZoomTool` to `numTouchPoints: 2` and `StackScrollTool` to `numTouchPoints: 3`. `ZoomTool`'s defaults are
`pinchToZoom: true, pan: true`, so two fingers zoom and pan together. `StackScrollTool` steps one slice per
`_getPixelPerImage`: `Math.max(2, element.offsetHeight / Math.max(numberOfSlices, 8))`. A drag the viewport's full
height crosses the whole stack, so the same drag gives single steps and a far jump.

**P2, RadiAnt**, the manual's *Multi-touch operations* page, 2D Viewer window: "Drag one finger over image | Tool
chosen in the toolbar (browsing series by default)."; "Two fingers over image | Pinch to zoom, drag to pan image.";
"Three fingers over image | Drag up/down to change brightness, drag left/right to change contrast."; "Double tap on
image | Maximize/restore panel." This is a desktop viewer on a touch screen, not a phone.

**P3, CaseStacks**, help page *How to Use the DICOM Viewer*: "The mobile app uses touch instead of a mouse. Pick a
mode first: Scroll, W/L, Zoom, or Measure. One finger then does whatever the selected mode says."; "Scroll — drag
to move through the image stack"; "Pinch to zoom and two-finger drag to pan work in every mode. Two fingers is always
pan, never window/level, and there is no double-tap gesture."

**P4, OHIF's slider**, `platform/ui-next/src/components/Viewport/ImageScrollbar.tsx` at `240bea1f`: an
`<input type="range" min="0" max={max} step="1" ...>` with `aria-label="Image navigation scrollbar"`, turned upright
by CSS (`transform: rotate(90deg)`) and set at the viewport's right edge (`ImageScrollbar.module.css`:
`position: absolute; right: 0; top: 0; height: 100%`). `extensions/cornerstone/src/Viewport/Overlays/ViewportImageScrollbar.tsx`
stops a playing cine when the slider moves ("on image scrollbar change, stop the CINE if it is playing") and then
calls `csUtils.jumpToSlice(viewport.element, { imageIndex, ... })`.

Of the four, the viewers agree on one thing only: **two fingers pinch to zoom and pan** (P1, P2, P3). Which gesture
steps slices is split: one finger with a mode (P2, P3), three fingers (P1), or a slider that takes no gesture (P4).
One finger is window/level in P1, as on our page.

## 2. The demo tip's input today

All input is in `client/viewer/viewer.js` and goes through `View`, so the page view and the view worker
(`?view=worker`) get the same handling; nothing in `client/view/` reads an input event.

| input | does | where |
| --- | --- | --- |
| arrows, PageUp/PageDown | one slice | `viewer.js:250-251` |
| Home, End | first and last slice (End is the mid-group jump at G 8 and 16) | `viewer.js:252` |
| wheel | one slice per event; with Ctrl, zoom | `viewer.js:266-270` |
| primary pointer drag | window (x) and level (y) | `viewer.js:274-289` |
| secondary button or Shift drag | pan | `viewer.js:277` |
| `#cine` button | play or pause cine | `viewer.js:239` |
| `#lossless` button, `l` | the exact frame | `viewer.js:207`, `:257` |

`#view` has `touch-action: none` (`index.html:25`), so the browser takes no pan or zoom of its own on the canvas.
The Pointer Events specification: "When a user interacts with an element using a direct manipulation pointer (such
as touch or stylus on a touchscreen), the effect of that input is determined by the value of the touch-action
property".

What a finger can do on the canvas today follows from that:

* **One finger**: window/level, as P1. That gesture is taken.
* **Pan**: unreachable. A touch has `button === 0` and no Shift, so `drag.pan` is never true.
* **Zoom**: unreachable. Only Ctrl+wheel and `+`/`-` zoom.
* **Two or more fingers**: not handled as such. Each `pointerdown` replaces `drag` (`viewer.js:277`) and every
  pointer's `pointermove` is measured from the last finger's start, so a second finger makes window/level jump. A
  finding for DEMO-UX's tests, not a request to fix it here.
* **Slices**: only cine. A reader cannot step one slice or jump to the end.

`View.show` wraps (`(i + n) % n`, `client/view/view.js:18`). A control that sets an index in `[0, n−1]` never meets
that wrap. A relative drag that runs past the end would wrap around to slice 0, unlike P1's `loop: false`.

## 3. Recommendation: a slice slider (P4)

The pattern has to take no gesture the viewer already uses, give single steps and a far jump, and work in both
views. A slider beside the canvas does that with the least added:

* **What:** one `<input type="range" min="0" max="n−1" step="1">`, upright along the canvas's right edge as OHIF's
  (P4), labelled for assistive technology (`aria-label`, as OHIF's).
* **Behaviour:** its `input` event calls `show(value)`, which every view already serves. Every `show` sets
  `slider.value = view.current`, so keys, wheel and cine keep it current. Moving it pauses cine, as OHIF's does.
* **Single steps:** move the thumb by one slice. Upright along a phone's height (about 600–700 CSS px in portrait,
  an assumption), the three DBT fixtures' 50–69 frames leave about 9–14 px a slice. A focused slider also answers
  the arrow keys natively; `viewer.js`'s global `keydown` handler must skip the slider as it skips `#cine` and
  `#lossless`, or each arrow would step twice.
* **Far jump:** move the thumb to its end (End) or anywhere along the track (the mid-group jump). This is the
  on-demand group decode `End` already causes.
* **Both views:** input stays in `viewer.js` and reaches `View.show`, so `?view=page` and `?view=worker` are the
  same code.
* **No gesture taken:** the canvas keeps one finger for window/level. Two fingers stay free for the pinch zoom and
  pan all three gesture viewers agree on (P1–P3), which the page lacks on touch today and may want later.
* **Discovery:** it is visible, and the status line's `frame i of n` already names the slice.
* **Desktop:** unchanged. The wheel, keys and drags are untouched, and the slider is one more way.

**Its limit.** The HTML standard says the Range state "represents a control for setting the element's value to a
string representing a number, but with the caveat that the exact value is not important, letting UAs provide a
simpler interface than they do for the Number state." So whether a phone's Chrome lands every integer under a finger
is the browser's choice and is not verified here. DEMO-UX's check on the phone decides it. If single steps cannot be
reached, use the same absolute mapping on a plain element of its own (`pointerdown`/`pointermove`, slice =
`round(y / height × (n − 1))`). That is the same pattern, not a canvas gesture. Stacks much longer than 69 frames, at
under ~4 px a slice, would need a relative drag instead (P1's `StackScrollTool` mapping). None of the demo's series
is that long.

**Not recommended, with why:**

* *One-finger vertical drag steps slices* (P2, P3, and DEMO-UX's fallback in its brief). This takes window/level's
  vertical axis, the gesture the demo's step 2 uses ("A narrow window (drag left on the image)", README §Demo, which
  needs both axes), or adds P3's mode buttons. Since this row is done, DEMO-UX's fallback is not needed.
* *Three-finger drag* (P1). It is free today, but cramped on a phone's width and nothing on screen reveals it. Some
  Android builds may also take a three-finger swipe themselves; that is not checked here.
* *Two-finger vertical drag.* It is free today, but it is the zoom-and-pan gesture every gesture viewer above uses.
  Spending it on slices would block the convention later.
* *Swipe or tap zones.* Cornerstone3D has `TOUCH_SWIPE`, but none of the four sources binds it to slices. A tap
  already starts a window/level drag here.

**What DEMO-UX's tests should state** (mutate each):

* The slider sets the shown slice in both views.
* `End`, the wheel and cine move the slider.
* An arrow on the focused slider steps once, not twice.
* Moving the slider pauses cine.
* Window/level by drag is unchanged.
* `demo-check.mjs` reaches the last slice through the slider under `?fill=0` (the mid-group jump).

## Sources

* OHIF/Viewers `240bea1f01247b5bd826688abae9c76b09a8fc0a`: `modes/basic/src/initToolGroups.ts`,
  `platform/ui-next/src/components/Viewport/ImageScrollbar.tsx` and `.module.css`,
  `extensions/cornerstone/src/Viewport/Overlays/ViewportImageScrollbar.tsx`.
* cornerstonejs/cornerstone3D `c0fb73095512456d8b5bcfbe840537a32b12e5be`:
  `packages/docs/docs/concepts/cornerstone-tools/touch.md`, `packages/tools/src/tools/StackScrollTool.ts`,
  `packages/tools/src/tools/ZoomTool.ts`.
* RadiAnt DICOM Viewer manual, *Multi-touch operations*:
  <https://www.radiantviewer.com/dicom-viewer-manual/multi-touch_operations.html>.
* CaseStacks help, *How to Use the DICOM Viewer*: <https://casestacks.com/help/how-to-use-dicom-viewer>.
* HTML Living Standard, §4.10.5.1.13 Range state: <https://html.spec.whatwg.org/multipage/input.html#range-state-(type=range)>.
* W3C Pointer Events Level 3, §touch-action: <https://www.w3.org/TR/pointerevents3/>.
