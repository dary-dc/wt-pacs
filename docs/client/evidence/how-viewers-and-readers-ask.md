# How viewers and readers ask for a stack

**Question:** What do existing viewers ask for next while a reader looks at a stack, what do published sources say a
reader does and needs by modality, and which asking patterns follow for this client's wire?

*Folded 2026-11-14 from `claude/ask-patterns-map:docs/ARCHITECTURE.md` §Asking for a stack: what viewers do and §the
patterns on our wire (`8ffe4674`; the survey also on `claude/ask-patterns-survey`, `07e85830`), moved with its links
re-pointed and its campaign names reworded. Until this file, the tip cited that branch by an abbreviation, without its text. Theory
and source reading only: nothing here was measured in this lab. What the client asks for today is
[`../design.md`](../design.md); the scroll rate and the no-skip rule are weighed in
[`scroll-rate-and-skipping.md`](scroll-rate-and-skipping.md).*

## What viewers do

*A survey, 2026-10-28: read from source, standards and papers, **nothing here measured in this lab**.* The fill and
the ask are the two extremes; a reading viewer sits between them. Below is what existing viewers ask next, and
what published sources say a reader does and needs. Source pins: Cornerstone3D `37d135dd`, OHIF Viewers `b9edaed5`,
Weasis `32fef333`, all as cloned on 2026-10-28; DICOM 2026d; IHE RAD TF-2 Rev 23.0 (2025-08-08).

**What viewers ask next**

| source | what is asked next, in what order | how far ahead | against the frame on screen |
| --- | --- | --- | --- |
| Cornerstone3D `stackPrefetch` (`packages/tools/src/utilities/stackPrefetch/stackPrefetch.ts`) | the whole stack, alternating below and above the current frame: `// Prefetch images around the current image (before and after)` (:150), then `lowerIndex--` and `higherIndex++` in turn (:175–185); rebuilt 10 ms after each new frame (:42, :224–238) | `maxImagesToPrefetch: Infinity` (:31) | `RequestType.Prefetch`, priority 0 (`stackPrefetchUtils.ts`:5–6); the frame shown is asked as `RequestType.Interaction`, priority −5 (`packages/core/src/RenderingEngine/StackViewport.ts`:2311–2312) |
| Cornerstone3D `stackContextPrefetch` (`…/stackPrefetch/stackContextPrefetch.ts`), what OHIF enables on every stack (`extensions/cornerstone/src/services/ViewportService/CornerstoneViewportService.ts`:994) | after a jump: `Fetch the next/previous 2 images` (:54); while stepping by one: `Prefetch additional images in the direction of navigation, up to 100` (:56), the next frames before the previous (:358–363); a step larger than 2 resets it (:328–331) | `minBefore: 2, maxAfter: 2, directionExtraImages: 10` (:31–34), growing by 10 a step to 100 (:324–326); once that completes, `Fetch up to 1/4 of the cache size images near the current image` (:59), split by position in the stack (:334–336) | as above; asks not yet sent are dropped on each move (`preserveExistingPool: false`, :35, :183–185) |
| Cornerstone3D request pool (`packages/core/src/requestPool/requestPoolManager.ts`, `packages/core/src/enums/RequestType.ts`) | four classes, `Interaction` (`Highest priority for loading`), `Thumbnail`, `Prefetch`, `Compute` (RequestType.ts:6–14); within a class, lower number first (:174–175) | in flight per class `Interaction: 6, Thumbnail: 6, Prefetch: 5` (:120–122); raised to 1000 each for image loads (`imageLoadPoolManager.ts`:36–38) and 200 each for retrieval (`imageRetrievalPoolManager.ts`:14–22) | each class is sent up to its own cap on every pass (:286–297): an interaction goes first in the client's queue but does not stop a prefetch already sent |
| Cornerstone3D interleaved volume load (`packages/core/src/loaders/configuration/interleavedRetrieve.ts`) | `Retrieve middle image, first, last` (:22), then every 4th frame at four offsets (:23–27, :40–90) | the whole volume | `RequestType.Thumbnail` at priorities 5–11 (:36–37 …); its neighbour copies shown in place of missing frames (:5–15) are a preview, out of scope here |
| Cornerstone3D cine (`packages/tools/src/utilities/cine/playClip.ts`) | the next frame at the clip's rate: `defaults to 30 if not specified` (:36), or the Frame Time Vector (:120–126) | no look-ahead of its own; the stack prefetch above runs beside it | `A CINE frame is attempted every 1 / fps seconds`; `The default is 30 tries, or 1.25 seconds at 24 fps` (`packages/tools/src/types/CINETypes.ts`:15–16) of waiting for a frame not yet rendered, then it moves on (playClip.ts:406–415) |
| OHIF v3 study prefetcher (`platform/core/src/services/StudyPrefetcherService/StudyPrefetcherService.ts`) | other series of the study, `closest`, `downward` or `upward` from the active one in the series list (:386–390) | `displaySetsCount: 1`, `maxNumPrefetchRequests: 10`, `order: downward`, `enabled: false` in the code (:112–131); the docs say 2 and `closest` (`platform/docs/docs/configuration/configurationFiles.md`:272–290) | starts only when the series on screen are loaded (`_areActiveDisplaySetsLoaded`, :589–592); `RequestType.Prefetch` (`extensions/cornerstone/src/initStudyPrefetcherService.ts`:6) |
| Weasis (`weasis-dicom/weasis-dicom-explorer/…/wado/SeriesDownloadManager.java`) | in a series: `// Download endpoints and middle first`, then a `// Binary search pattern for remaining positions` (:256–266) | the whole series, `download.concurrent.series.images` 4 at a time (`ManifestModelBuilder.java`:335); 3 series at a time (`DownloadManager.java`:82–83) | series, not frames: focusing a series' thumbnail moves it to the front of the queue (`SeriesThumbnail.java`:324) and cancels a running series to make room (`LoadSeries.java`:573–590) |
| Weasis cine (`weasis-dicom/weasis-dicom-viewer2d/…/EventManager.java`) | the speed is the series' Cine Rate when it has a Frame Time Vector (:349–354) | — | — |
| dcm4chee-arc-light | no stack viewer of its own found: display is handed to "an image-aware system like an Image Display (PACS)" by IHE Invoke Image Display, Weasis in the example ([wiki](https://github.com/dcm4che/dcm4chee-arc-light/wiki/Invoke-Image-Display/Integration-with-3rd-Party-Softwares)) | — | — |
| DICOMweb, [PS3.18 2026d §10.1.1](https://dicom.nema.org/medical/dicom/current/output/html/part18.html) | a frame retrieve names `{frames}`, "a comma-separated list of Frame numbers, in ascending order" | one request names any set of frames | the standard states no priority and no order other than ascending: a client that wants an order sends separate requests |

No viewer surveyed uses scroll velocity. The nearest is `stackContextPrefetch`, which counts consecutive single
steps in one direction.

**What readers do and need, by modality**

| modality | source | what it states |
| --- | --- | --- |
| CT/MR stack | Diaz et al., Med Phys 2015;42(6):2925, lung CT, 3 radiologists ([abstract only](https://pubmed.ncbi.nlm.nih.gov/26127046/)) | "The scrolling speed … at the moment the signal was detected was measured at 25-30 fps"; the radiologists had "a subjective estimate of 5 frames per second (fps)". The only measured slices/s found |
| CT/MR stack | Drew et al., J Vision 2013;13(10):3 ([full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC3736761)) | "Drillers restrict eye movements to a small region of the lung while quickly scrolling through depth"; scanners "search an entire level of the lung before moving on to the next level in depth". No slices/s, no count of passes |
| CT/MR stack | Beard et al., J Digit Imaging 1994;7(4):189 ([abstract only](https://pubmed.ncbi.nlm.nih.gov/7858015/)) | "Adjacent eye movements (+/- 1 image in sequence) averaged 0.54 seconds" |
| cine MR | SCMR standardized protocols 2020 ([full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC7038611/)) | "Temporal resolution ≤45 ms between phases to optimize evaluation of wall motion" |
| DBT | Aizenman et al., J Med Imaging 2017;4(4):045501 ([full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC5658515)) | readers "scrolled through 3.8 image slices during a single fixation"; "sawtooth plots as the observer moves back and forth through the stack multiple times". No slices/s |
| DBT | [IHE RAD TF-2 Rev 23.0](https://www.ihe.net/uploadedFiles/Documents/Radiology/IHE_RAD_TF_Vol2.pdf) §4.16.4.2.2.1.3.9 | "The Image Display shall not skip slices during manual or automatic scrolling"; its note: "if the Image Display is unable to keep up …, then the display will show all slices rather than scrolling faster". A note: "a maximum scrolling rate of at least 25 frames per second for an entire 5 MP display is desirable" |
| DBT, mammography | [ACR–AAPM–SIIM practice parameter, image quality in mammography](https://gravitas.acr.org/PPTS/DownloadPreviewDocument?DocId=140) (2022, amended 2023) | §V.C.1: "It should not take more than 3 seconds to retrieve an image from online local storage and display it on a workstation" — the only latency number found. §V.B: DBT displays "should incorporate technology to compensate for image blur during scrolling via optimized frame rates", no number |
| mammography | same, §V.B; IHE RAD TF-2 §4.16.4.2.2.1.1 | displays show "a set of current and prior 4-view mammograms (left and right CC and MLO views) simultaneously"; hanging protocols "tailored to user preferences". No view order is prescribed by either |
| US, XA cine | [DICOM PS3.3 §C.7.6.5](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.7.6.5.html); IHE RAD TF-2 §4.16.4.2.2.6.9 | Recommended Display Frame Rate (0008,2144) and Cine Rate (0018,0040) in frames/s, Frame Time (0018,1063) in ms; IHE: "The default shall be the frame rate specified in the DICOM attributes, if present", no timing requirement |
| echo | [ASE 2019 comprehensive TTE](https://www.asecho.org/wp-content/uploads/2019/01/2019_Comprehensive-TTE.pdf) §I.A.10 | "higher frame rates are desirable", no number |
| XA | Badawy et al., Cardiol Res Pract 2018, one centre ([full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC5925206)) | 15 fps cine as the baseline; "10 fps/low" recommended, which "did not impact on the diagnostic utility of the images" |

The [ACR–AAPM–SIIM technical standard for electronic practice](https://gravitas.acr.org/PPTS/DownloadPreviewDocument?DocId=136)
states no latency or frame rate: "retrievable in a time frame appropriate to the clinical needs" (§III.E.4). No
published figure was found for non-cardiac ultrasound cine rates, for CC- or MLO-first, or from RSNA or SIIM on
scroll latency. Two consequences for what is already written here: the 9 slices/s that
[`adr/stride-is-bandwidth-conservation.md`](../../adr/stride-is-bandwidth-conservation.md) works with is not a source's,
and a measured 25–30 fps is three times it; and IHE's DBT rule forbids the skipping that ADR chooses, during
scrolling.

**Candidate asking patterns.** Each with where it comes from, what it assumes, and the one lab measurement that
would decide it. A **scroll trace** below is a scripted sequence of on-screen frames, played into the viewer; none is
built.

1. **Outward from the frame on screen**, alternating below and above, to the whole series. *From* Cornerstone3D
   `stackPrefetch`. *Assumes* the next frame is as likely below as above, and memory holds the series. *Decides:* the
   share of frames shown exact when the trace reaches them, against today's index-order fill, on a drilling trace
   (a sawtooth over a third of the stack) at 25 slices/s, on the five total-time links (`lab/av1/delivery/total-time`).
2. **Direction-aware run-ahead**: two either side after a jump, then the frames ahead growing with each single step,
   to a cap. *From* Cornerstone3D `stackContextPrefetch`, OHIF's default. *Assumes* scrolling is runs of single steps
   and a jump means a fresh look. *Decides:* the same share on the same trace against pattern 1; it wins only where
   the link cannot fill the series before the reader turns.
3. **Coverage first**: ends and middle, then bisection or every k-th frame. *From* Weasis's series order and
   Cornerstone3D's interleaved volume load. *Assumes* the first move is a jump to anywhere, and a frame near the target
   helps until the target lands. *Decides:* the time until every frame is within k of one delivered, against the
   index-order fill, with the fill's total time beside it — the asked-first measurement paid two round trips
   ([`av1/README.md`](../../av1/README.md) §The order frames are asked in).
4. **Velocity-aware look-ahead**: frames ahead spaced by scroll speed. *From* no viewer surveyed; the stride ADR.
   *Assumes* the reader may scroll faster than the link delivers, and that skipping is allowed — IHE's DBT rule above
   says it is not. *Decides:* frames/s delivered exact against the trace's 25 slices/s on each link; if every link
   that matters keeps up, the pattern is not needed.
5. **Cine look-ahead by frame rate**: play once the frames buffered cover the rest of the run at the clip's rate.
   *From* cine playback at the DICOM rate (IHE, Weasis, Cornerstone3D's 30 fps default and its wait-then-move-on).
   *Assumes* Cine Rate or Frame Time is present and the link's frame rate may be below it. *Decides:* frames/s
   delivered exact against Cine Rate on `us_liver` and `usb_cine` on the five links; where it is above, playing at the
   first frame does not stall.
6. **The series on screen first, then the next series**, and in a multi-view study the views of the first hanging
   before priors. *From* OHIF's study prefetcher (waits for the series on screen), Weasis's thumbnail priority, the
   ACR and IHE current-and-prior four-view hanging. *Assumes* the hanging is known when the session opens. *Decides:*
   time to the whole first hanging with current views asked before priors against one fill of both; for four views
   alone no order shortens it (the av1 measurement cited above).
7. **The frame on screen above everything, without stopping what is in flight.** *From* Cornerstone3D's request
   pool (interaction at −5, prefetch at 0, each class sent to its own cap). *Assumes* in-flight prefetch is cheap to
   finish. *Decides:* already written as the one-queue protocol, [`WIRE.md`](../../WIRE.md) §Proposed: one queue.

Mapped onto the wire in the next section. The client's later reading of patterns 1 and 2 against the `current + 1`
rule is [`ask-order-during-fill.md`](ask-order-during-fill.md) and [`view-worker-design.md`](view-worker-design.md).

## The patterns on our wire

*Theory, 2026-10-28: **nothing here is measured**; each row names the measurement that would decide it.* The target
client (the owner's, 2026-10-28): a **view worker** owns the frame store, the cache and the paint, knows the frame on
screen, and posts the downloader its **want** over a `MessagePort`; the downloader turns wants into FoD messages and
keeps its records, the attempts and the ack rule ([`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) §The downloader). Fixed by ADR and not reopened here: priority is
the client's ask order through a FIFO server ([`adr/reject-server-ordering.md`](../../adr/reject-server-ordering.md)), no
wire cancel ([`adr/reject-server-cancel.md`](../../adr/reject-server-cancel.md)), a shallow client window
([`adr/client-window-depth.md`](../../adr/client-window-depth.md)), stride as bandwidth conservation
([`adr/stride-is-bandwidth-conservation.md`](../../adr/stride-is-bandwidth-conservation.md)). Out of scope: previews, lossy
delivery, the encoding. The use cases and levers are [`ask-during-a-fill.md`](ask-during-a-fill.md)'s; the three scroll policies, measured,
are [`what-a-scroll-ahead-asks.md`](what-a-scroll-ahead-asks.md). *Draft n*
marks an idea from an earlier internal draft; none is adopted without its measurement.

**A want** is an ordered list of frames the view worker does not hold, as ascending runs and single frames; it
replaces the one before. Leaving out what is held (draft 8) means holdings never cross the port. **The wire today**
([`WIRE.md`](../../WIRE.md) §FoD messages): `request_frame`, served in ask order; `stream_frames {from?, to?}`, one
ascending run; `end_stream`. An ask ends a running fill and the downloader re-issues the rest ([`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) §The downloader). So
any order that is not ascending rides only as asks. Fill and on-demand are the two ends:

| pattern | the want | on the wire today | gap | where | deciding measurement |
| --- | --- | --- | --- | --- | --- |
| **fill**, one end | the whole series, one run | `stream_frames {}`; the downloader's `fill` is a set, issued as runs from its lowest index still wanted | none | — | built: the total-time links (`lab/av1/delivery/total-time`) |
| **on-demand**, the other end | the frame on screen alone, replaced each step | one `request_frame` a step; the viewer's on-demand mode cancels one still pending (`end_stream`), and an ask already sent stays owed | none | — | built: the cursor's-frame-only policy of [`what-a-scroll-ahead-asks.md`](what-a-scroll-ahead-asks.md) |
| **1 outward**, alternating | c, c+1, c−1, c+2, c−2 … to the series | asks only: no run goes downward or alternates. The downloader sends every ask at once, so the order is fixed on the wire before the first move | G1 | client-only | the survey's (share shown exact on a sawtooth trace at 25 slices/s, against the index-order fill), after G1's |
| **2 run-ahead by direction**, with the reader model (drafts 1, 5, 7) | after a jump c ± 2, then the window around the new frame, not the path skipped; while stepping, frames ahead growing to a cap with a tail behind (≈ 70/30), sized from reader speed × frame bytes against the measured link; a small warm window after frame 0; a direction change replaces the want | ahead: `stream_frames {from: c+1, to: c+k}`; behind: asks; each ends the run before it | G1, G2, G3 | client-only | as 1, against 1, with draft 11's share painted before the reader leaves; draft 12's blind control on the split and the cap |
| **3 coverage first** | ends, middle, then bisection or every k-th, then the rest ascending | asks in that order, then a fill: carried today ([`av1/README.md`](../../av1/README.md) §The order frames are asked in) | G1, for the order to survive a move; G5, for coverage to show | client-only | the survey's (time until every frame is within k of one delivered) |
| **4 by scroll speed**: stride, settle, gap-fill (drafts 6, 9, 10) | frames ahead spaced by speed; after a dwell (≈ 200 ms) the frame first, then its neighbours; on deceleration the holes nearest the cursor first, the stride ADR's undesigned gap-fill | asks; a settled frame already sent cannot move up, only one not yet sent can | G1, G4 | client-only; IHE's no-skip rule for DBT is the owner's, not the wire's | the survey's (frames/s exact against 25 slices/s; if every link that matters keeps up, nothing to build); a fixed stride and dwell as the blind control |
| **5 cine by frame rate** | an ascending run from c, the wrap a second run to c − 1; play when what is held covers the rest at the clip's rate | `stream_frames {from: c}`, then `{to: c − 1}`: carried today | a play gate, held frames against the delivered rate | client-only | the survey's (frames/s exact against Cine Rate on `us_liver` and `usb_cine`) |
| **6 the series on screen first**, then the hanging | wants across series | one process serves one series: another series is another session, competing at the bottleneck (the second-series use case) | G6 | **wire** | what two sessions cost each other, then the survey's (the whole first hanging, current before priors, against one fill of both) |
| **7 the frame on screen above all**, in flight kept | that frame first in the want | an ask ends the running fill; with no fill running, it waits behind what is in flight and at most the window's asks | G7, or none if the want rides as windowed asks (G1) | **wire** for G7; client-only for G1 | G1's decides whether G7 is needed; the ask-stream measurement's design B against today if it is |

**A hybrid is a want between the ends**, chosen by modality, study size and link, none of it measured: cine (US, XA)
is 5; a stack the link fills before the reader's first pass is the fill with the frame on screen asked (today); a
larger stack or a slower link is 2 or 1 behind a window. Where the series' bytes ÷ the link's rate cross the reader's
pass is the boundary, and no reader's pass is measured here.

**G1, the ordered want behind a window (client-only).** The downloader takes `fill` as a set and `ask` as one index,
and since 2026-10-03 sends every ask at once (the client window removed, [`adr/client-window-depth.md`](../../adr/client-window-depth.md)).
A FIFO server serves an order sent whole as it was sent, and nothing takes it back. The downloader would keep the
want and send only `D_min` of it ahead, re-reading it at each new want: what is not yet sent reorders for nothing. Reader speed sets how far the want
reaches and its split (draft 5), never `D_min`, which stays the link's (that ADR's correction of 2026-08-26).
`D_min` saturated the link six of six on the native harness (that ADR, E1); in the browser it was never measured.
**The deciding measurement, and the cheapest here:** the same frames as `request_frame`s held at `D_min` against one
`stream_frames` run, last frame and bytes, on the five total-time links, interleaved — a lab page and no server change.
A tie means patterns 1–4 and 7 need nothing from the wire; a loss means ascending stretches go as runs, which an ask
ends (G7).

**G2, the want's generation (client-only, draft 1).** Today's generation moves only on `cancel`, which also ends the
stream, fails the asks and clears the records ([`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) §Messages), and drops every frame that lands under an older one.
Draft 1 wants less: drop at once every want not yet sent. A want that replaces the one before does that, and the
port is ordered, so no counter is needed; the request's generation keeps its meaning. Its worth is G1's: with
every ask already sent there is nothing unsent to drop.

**G3, orphans (client-only, draft 3).** A frame on the wire when its want is replaced still arrives: the server
serves what it was asked. The downloader can drop it, decode it behind the want, or decode it and let the view
worker's cache keep it; today's records cannot tell it from a fill frame and nothing counts it. Behind a window an
orphan count per reversal is at most what is in flight plus `D_min` (D). Dropping is not free: the scroll measurement's
re-aimed fill, which drops an earlier run's frames, sent 29–37 % more packets than every step on today's server,
consistent with that drop and not isolated.
**Decides:** wasted bytes and decodes per reversal on the sawtooth trace, decoded behind the want against dropped.

**G4, the decoders and the gesture (client-only, drafts 4, 10).** The wire may run ahead of the decoders ([`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) §The
downloader) and the reader pause is proposed, not built. Draft 4, no new ask while every decoder holds `perDecoder`,
is G1's window counted at the decoders instead of the link; the smaller bound holds. Today one wheel event is one
step and one step one ask (`client/viewer/viewer.js` `show`); draft 10 puts the gesture-to-index layer in the view
worker above the want, so touch rate is never ask rate. **Decides:** gesture to paint and compressed bytes queued,
the window at the link against the smaller of link and decoders, on a 4× CPU cell, where decode binds ([`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) §Under a
throttled CPU).

**G5, the screen before its frame lands (client-only, drafts 2, 9).** The viewer holds the last frame painted while
its status names the new index (read from `show`). The rule is to choose: hold the previous, blank, block the gesture,
or paint the held frame nearest the cursor (draft 2). The last shows another frame than the one named, the survey's
neighbour copy, out of scope unless the screen names the frame it shows: the owner's call. Gap-fill on deceleration
(draft 9) is pattern 4's want, not a paint rule. **Decides,** with draft 11's metrics: the share of visited frames
painted exact before the reader leaves them (not built: a trace's on-screen frames against each frame's paint stamp),
gesture to paint (the scroll measurement's stale and rest, for a scripted cursor), and wasted prefetch bytes (counted nowhere).

**G6, several series in a session (wire).** The second-series use case: one process serves one series ([`glossary.md`](../../glossary.md)), so a
hanging's second series is a second session. Carrying it in one is an FoD field naming the series and a server that
serves more than one; two sessions need no wire change and compete at the bottleneck, which is not measured. That
cost decides first.

**G7, a fill that survives an ask (wire).** Today an ask ends the fill; one queue (#96, design B of
[`ask-during-a-fill.md`](ask-during-a-fill.md)) keeps it, and `request_frame` no longer ends a fill. The ask-stream
measurement read it ahead of design D on the ask round-paired, the strict reading undecided; the owner's question is
open. It is needed only where a want mixes runs and asks, which G1 decides. The
ordering ADR holds either way: the server still serves the client's order.

**Draft 12, the blind control, applies to every estimator above** — the window, the 70/30 split, the cap, the stride,
the dwell: a constant that matches the estimator ships, the rule [`adr/client-window-depth.md`](../../adr/client-window-depth.md)
§Which depth ships already fixes for depth.


## Read against the tip (2026-11-14)

The view worker's design takes up G1 (the want windowed by the downloader, its deciding measurement still owed) and G3
(orphans, undecided), and says "the seven patterns map onto it" ([`view-worker-design.md`](view-worker-design.md) §8,
asking); the ascending want and the wait for a head within k are measured in
[`ask-order-during-fill.md`](ask-order-during-fill.md). G2 and G4–G7 and the blind-control rule are on no other page.
The asking policy that builds on this survey is [`what-a-view-asks-for.md`](what-a-view-asks-for.md). None of the
seven patterns is measured.
