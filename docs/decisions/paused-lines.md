# Paused lines: resume native or the viewer, and for what

Written 2026-11-22 by row PAUSED-LINES-PAGE (`claude/work-ledger:docs/queue-2026-11-14.md`), a session that ran none
of the native or viewer rows, from pushed results only; nothing run. Inputs at: `origin/claude/unified` `4a2b4277`
([`../native/README.md`](../native/README.md) §Status and §7, [`../lines/native.md`](../lines/native.md),
[`../lines/viewer.md`](../lines/viewer.md) §3–§5, [`../decode/hardware-10bit.md`](../decode/hardware-10bit.md) §8–§9,
`docs/decode/mobile/device-model.md` §3.3–§5 at `055f152b`, DEVICE-THEORY and its re-review, PR 414);
`claude/mobile-decode:docs/decode/mobile/av1-chips.md` (PR 397); `claude/work-ledger:docs/queue/MERGE-ALL-PLAN-report.md`
§7 (M5); `claude/reviews-2026-11-18:docs/reviews-2026-11-18.md` §3 (B3); `claude/slice-touch:docs/reviews/slice-touch.md`.
Missing: the phone round of 2026-11-22 is running (`docs/queue/PHONE-ROUND.md`, started 17:34), so no phone has
yet answered whether it lists a hardware AV1 Main 10 decoder; nothing below waits on it.

## 1 · The question

Two lines are paused by the owner's word: **native** (2026-11-15: "for now, we are pausing the native path. we will
merge it, and in the future keep experimenting with it"; client queue amendments 18, 19) and **the 2D viewer**
(2026-10-30; `viewer.md` §3). Each pause can be lifted only by the owner. The calls: whether to resume either, and if
so for what; whether native is recorded as *the* 10-bit hardware route (B3); whether the viewer's option B is carried
beside A; where the viewer's branches go (M5); and which touch gestures a reader's viewer uses.

## 2 · The recommendation, and the owner's yes or no

**Keep both lines paused. Record native as the only 10-bit hardware route the sources leave, to be resumed only when a
phone shows that route exists; let one cleaning row take native's lab settings out of its product window before
`main`; keep the viewer's branches out of `claude/unified`, B not carried, the demo's slider kept.**

| # | the owner's yes or no | recommended | a yes changes | a no leaves |
| ---: | --- | --- | --- | --- |
| 1 | Native stays paused through phase 2 | **yes** | nothing | a resume: its first rows are §6's three, in that order |
| 2 | B3: native is recorded as the 10-bit hardware route, conditional on a device (§4); since the owner's word of 2026-11-23 ~02:00 a browser's hardware view may run unchecked, so what native adds is a *checked* view at 10 bits on hardware, not hardware itself | **yes** | one dated line in `docs/client/design.md` §Decided; resume is triggered by the phone's codec list (§6), not by a date | the route stays an open question on PR 392's page |
| 3 | One cloud row moves native's lab settings out of `window.rs` and `count.rs` (an inventory first, then a draft PR) before `claude/unified` goes to `main` | **yes** | one Opus row in phase 2; the owner's merge is the removal's yes | `client/native` reaches `main` carrying lab code in a product module, against the cleaning rule; or the crate stays off `main` (§7) |
| 4 | The viewer stays paused | **yes** | nothing | a resume: `viewer.md` §4 items 3, 4 first |
| 5 | Option B (our painter inside Cornerstone3D) is not carried beside A while paused | **yes** | `viewer.md` §4 item 2 closes as "not carried while paused", reopened only with item 1 | B stays an open call; its phone run (§4 item 3) stays the only thing that decides it |
| 6 | M5: `line-viewer` (PR 255), `viewer-spike` (PR 214), `viewer-seam2` (PR 300) stay out of `claude/unified`, not even as lab | **yes** | nothing merged; the PRs stay open drafts (closing them is the owner's, PR-TIDY) | they come in as lab, which `scripts/check_lab_absent.sh` keeps off `main` anyway, adding lines the evaluation release does not use |
| 7 | The page's slice slider (SLICE-TOUCH's P4) stays the one touch control for stepping; the gesture set is decided on the viewer's resume | **yes** | nothing | a gesture build on the client page, unmeasured on any phone |

**How it serves the value statement** (amendment 27 item 7): the statement promises a study opened "in a web
browser"; native is outside it, so resuming native would change the statement, not serve it. Items 2 and 3 keep the
one place where native would go past it — a view checked on phone hardware at 10 bits, which the statement's "every
frame … checked" (said of the exact frame) does not ask and the owner's word of 2026-11-23 ~02:00 no longer asks of the view — recorded,
without spending phase 2 on it. Items 4–7 keep "one small … server" and its client lean.

## 3 · The options

**Native**

| option | what it gives | what it costs | numbers |
| --- | --- | --- | --- |
| stay paused (rec.) | nothing new | nothing | — |
| resume as the 10-bit hardware route | the only checked 10-bit hardware view (`hardware-10bit.md` §9 rank 1, Android MediaCodec `P010`) | a 10-bit 4:2:0 constant-chroma ingest form (not built), a device probe, an Android app | rank 1's decode time **unknown** (no device run); browser ranks 5–7 **blocked** (**source**) |
| resume for desktop | M2's ~4 % faster fill under 2 % loss at 20 Mbit; first frame 161–206 ms earlier | the design run (never run) and a GPU desktop | **measured**, lavapipe, no GPU (`native-client-milestones.md`, `native-window-against-browser.md`); on a clean link "buys nothing on desktop" |
| drop native | a smaller tree | the workspace, lockfile, image, `wt-pacs/1` ALPN and the gate change | not counted |

**Native as the 10-bit hardware route, per device class** (DEVICE-THEORY §4, its labels):

| | entry, < $200 | middle, $200–799 | premium, ≥ $800 |
| --- | --- | --- | --- |
| share of 2025 shipments | 40.6 % (**source**) | 38.3 % (**derived**) | 21.1 % (**source**) |
| hardware AV1 at `dbts_b1`'s size | not promised (**source**, CDD 16) | not promised | not promised; the vendor's |
| what class V promises | — | Main 10, Level 4.1, "only required to support 1080p" (**source**, CDD 16 §2.2.7.1) | the same |
| the software view it would replace, effective, three decoders | 90–200 ms (**theory**) | 41–132 ms (**theory**) | 33–48 ms (**theory**; the round's phone: 133–135 ms a frame at three decoders, **measured**, so 45 ms effective) |
| HTJ2K, effective, three decoders (the exact frame, checked today) | 33–61 ms (**derived**) | 15–40 ms (**derived**) | 14–23 ms (**derived**) |

Eight of 19 DBT volumes need AV1 level 5.x; 17 of 19 exceed the portrait 1080p Android asks of class V (**derived**,
`av1-chips.md` §5, items 1 and 2). So on no class do the sources promise a hardware decoder that takes a DBT frame whole.

**The viewer**

| option | what it gives | what it costs | numbers |
| --- | --- | --- | --- |
| stay paused (rec.) | — | — | — |
| resume A (our viewer on the client) | exactness to the screen (decided 2026-10-27) | the requirements read, the 1:1 mode (#215), a 2×2 layout | none run on a DBT volume |
| carry B beside A | Cornerstone3D's tools and annotations, our paint kept | our cine and linked window, an annotation a frame apart, methods Cornerstone3D says it will remove, OHIF glue unbuilt | desktop proxy: a tie at 4×, "B pays for its costs" at 6× (**measured**, indicative only, `viewer.md` §4 item 3) |
| M5 as lab | history on the unified branch | lines nothing reads | not counted |

## 4 · Where it holds

**Fixtures and limits.** Native: containers on lavapipe, no GPU, no phone; the M2 rows on loopback and a userspace
relay. The viewer: the seam's synthetic 24 slices of 128 × 96, 16-bit HTJ2K, headless Chromium on SwiftShader, 4-core
cloud hosts without a GPU, CPU throttled 4× and 6× as a phone proxy; no viewer run on a phone, a GPU, Firefox or a DBT
volume. The device model: 19 DBT volumes of one dataset, three timed (`dbts_a1`, `dbts_b1`, `dbts_c1`); one Android 16
phone (Chrome 157) on one home link; one benchmark's single-thread rating standing for a decoder's speed; price bands
of shipments standing for readers' phones. No breast ultrasound cine.

**The population.** B3 is carried by the platforms' own documents (**source**, `hardware-10bit.md` §8): every native
API returns 10-bit planes; no shipped browser path does. It holds for every engine and phone as of the sources' dates,
and is refuted by one browser shipping a `P010` `VideoPixelFormat` or plane access in WebGPU (§9's upstream list).
Whether a given phone has the decoder at the frame's size is a device fact on every class (§3).

**US and DBT stacks** (amendment 27 item 6). DBT: the view is at most 10 bits, so the 10-bit route is the one that
matters, and its frames are the large ones level 4.1 does not take whole (**derived**, above). Breast ultrasound
clips are 8-bit and often colour (**theory**: the property, not measured here; no US clip run): the 10-bit question
does not arise, a frame within 1080p falls inside what class V promises (**source**), but a hardware frame on Android
Chrome still reaches the page as RGB with no samples to check (`hardware-10bit.md` §7, **source**), so native would be
the only *checked* hardware route for US on a phone as well, at 8 bits; under the owner's word of 2026-11-23 ~02:00 a browser's hardware
route may show it unchecked. Whether a US clip's software decode is fast enough that no hardware route is needed is
not yet known (no US clip run).

## 5 · The mechanism

A route serves the checked view only if it gives the page the decoded samples. Browsers hand a hardware frame over as
an image (8-bit RGB, or opaque on Android), never as its planes, so the check cannot hash it; native APIs hand over the
planes. That is why native is the only 10-bit hardware route, and why it costs an app. But a hardware decoder helps a
DBT frame only if it takes the frame's size and level, which no Android class promises, so the route's value is a
device fact. The viewer is a different question: it adds tools on top of a client that already shows the frame exactly;
nothing in phase 2's aim (the evaluation release) needs a viewer product. Since the owner's word of 2026-11-23 ~02:00 the view need not
be checked on hardware, so a browser's hardware route can serve the view, unchecked; native stays the only route that
is both checked and 10-bit on hardware.

## 6 · What would change the recommendation

* **Native resumes** if one phone lists an AV1 Main 10 decoder with `COLOR_FormatYUVP010` at level 5.x and takes a
  2560 × 3328 frame (the codec list is a device read, `hardware-10bit.md` §9's probe cell, appended to
  `lab/devices/README.md` on `claude/hw-probe`). Then, by `docs/native/README.md` §Status, in order: (1) the lab
  settings out of the window (cloud; item 3 does it early); (2) the `P010` route: the 4:2:0 constant-chroma 10-bit
  form in the ingest, then a MediaCodec ByteBuffer probe on the phone, bit-exact against the digest, timed against
  software; (3) M1 and M2 on a GPU desktop with Vulkan Video and the GPU hash.
* **Native's case weakens** if a browser ships plane access (WebCodecs `P010`, WebGPU's `gpuweb/gpuweb#5281`) or if
  cell 1 on a middle-band phone with two fast cores (DEVICE-THEORY §6's one measurement) puts the software view near
  the premium band, which would leave hardware decode little to win.
* **The viewer resumes** on the owner's word only; the measurement that would then decide item 5 is the pre-registered
  phone run of A against B (`claude/viewer-seam2:docs/viewer/integration.md` §6: medians over 10 interleaved rounds,
  void below 8 kept rounds), then a DBT cell.

## 7 · What it would reopen

Item 3 reopens amendment 18 ("no row builds or measures it") for one cleaning row, to keep two other decided
approaches together: `client/native` rides to `main` (2026-11-11) and nothing reaches `main` uncleaned. Its no is the
other way to keep them together: the crate off `main` until native resumes, which reopens 2026-11-11 instead. Nothing
else here reopens a decided approach.

## 8 · Rows and links

NATIVE-NOTES (client queue; `claude/native-notes` `ce4b9d6c`, PR 396), HW10-ROUTES and its review (PR 392),
HW-DECODE-DEEP (PR 387), DEVICE-THEORY, -REVIEW, -FIX, -FIX-REVIEW (PR 414), AV1-HW-CHIPS and its fix (PR 397),
SLICE-TOUCH, the viewer seam (PRs 297, 300), MERGE-ALL-PLAN (§7, M5), BRIEF-WED (§3, B3); PRs 255, 214, 193, 210,
215, 251, 211, 277, 278; [`../lines/native.md`](../lines/native.md), [`../lines/viewer.md`](../lines/viewer.md).
