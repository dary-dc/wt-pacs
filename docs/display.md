# What reaches the screen

Row 169, theory only: the frames are proved exact up to the painter; this is what happens after it, and what the
product loses between the exact frame and the radiologist's display. Nothing here was measured on a display. A claim
derived here is marked (D); sources are listed at the end, each with the date it was read.

```text
 stored code (≤ 16 bit) ─► table: rescale, VOI, MONOCHROME1 ─► 8-bit code ─► RGBA8 picture ─► bilinear ─► RGB8 drawing buffer
                           (float64, voi.js)                    (256 levels)                 (8-bit)     tagged sRGB
 ─► browser compositor (colour-managed to the monitor's profile) ─► OS compositor (8 bit/channel on Windows without Advanced Color)
 ─► link (8 or 10 bit) ─► the panel's own LUT (GSDF on a calibrated medical display) ─► luminance
```

## Grey, today

**8 bits after the window.** The window table maps each stored code to a byte (`client/paint/voi.js` `toCode`), the
picture is `RGBA8`, and the canvas is a WebGL2 context with `alpha: false` (`paint-worker.js` `start`), whose drawing
buffer is `RGB8` and tagged `srgb` by default (the WebGL specification's `drawingBufferFormat` and `drawingBufferColorSpace`). A window
W modality units wide therefore shows W/256 units per displayed code (D): CT soft tissue (W 400) 1.6 HU a code, lung
(W 1500) 5.9, the whole 13-bit CT range of row 7 (5 795) 22.6, a 12-bit mammogram's full range (4 096) 16. Values closer
than that inside the window can share a code; narrowing the window separates them, which is how an 8-bit reader works.
The bilinear step runs on those bytes and adds at most 1–5 codes against a float64 reference on fractional zooms and
pans, measured ([`client/paint/README.md`](../client/paint/README.md) §What is proved).

**No presentation LUT in software.** DICOM's display model sends P-values to a display that maps them to luminance
through the Grayscale Standard Display Function, which spans 1 023 just-noticeable differences over 0.05–4 000 cd/m²
(PS3.14 ch. 7). The painter sends its code as an sRGB value, which is a P-value only if the panel applies the GSDF
itself, as a calibrated medical display does. On a consumer sRGB panel the same code goes through the sRGB tone curve
instead; correcting that in software needs the panel's luminance range, which only a photometer gives. The ingest
reads Window Center/Width and the VOI LUT Function (`ingest/from-dicom/dicom_series.py` `frame_display`) but neither a
VOI LUT Sequence (0028,3010) nor Presentation LUT Shape (2050,0020); a series that windows by an explicit LUT is shown
through its decoded range instead. *Corrected by row 214:* none of our sets reaches that fallback — every object that
carries a VOI LUT also carries the window pair it tabulates, and its Presentation LUT Shape only restates its photometric
interpretation (§Which series carry them).

**What can be seen.** Kimpe and Tuytschaever (2007) put a medical display of 0.8–600 cd/m² at about 720 JNDs and
conclude that more than 10 bits (1 024 shades) shown at once is of no use, and that GSDF calibration needs about 11
bits inside the panel. 256 codes over ~720 JNDs is ~2.8 JNDs a step (D): on a calibrated panel a smooth gradient
spread across the whole window can show contours; 1 024 codes is ~0.7 a step. Chrzan and Urbanik (2018) found 10-bit
grey working end to end on 3 of 14 hospital workstations at the hardware and OS level and through the DICOM viewer on
1, and recommend it as desirable, not required.

**The browser's colour management.** Chromium colour-manages a canvas from its colour space to the monitor's profile;
a switch exists to treat every monitor as sRGB (`--force-color-profile=srgb`, `ui/display/display_switches.cc:23–26`
at 141.0.7390.0). On a GSDF-calibrated panel whose OS profile's tone curve is not sRGB's, that conversion would bend
the grey ramp before the panel's GSDF. Whether it does on a given medical display is a device question.

**More than 8 bits, in a browser.**

| path | what it gives | where | cost to the painter |
| --- | --- | --- | --- |
| WebGL2 `drawingBufferStorage(gl.RGBA16F, w, h)` | a half-float drawing buffer: ≥ 11 bits of precision across [0.5, 1], more below (D) | Chrome and Edge 122+; not Firefox, not Safari (caniuse, read 2026-10-13) | `alpha: true` (with `alpha: false` the call is `INVALID_OPERATION`, per the specification), a 16-bit table, an `RGBA16F` picture: 8 B a pixel against 4 |
| WebGPU canvas, `format: "rgba16float"`, `toneMapping: { mode: "extended" }` | the same precision, and HDR range | Chrome 129+ | a second renderer |
| `drawingBufferColorSpace = "display-p3"` | gamut, not precision | WebGL spec | colour only (below) |

Neither reaches the panel unless the OS carries it: on Windows, the desktop compositor limits windowed applications to
8 bits a channel unless Advanced Color is on (an HDR display, or from Windows 11 22H2 an SDR display provisioned with
an MHC ICC profile and auto colour management), when it composes in FP16 and drives 10 bits or more (Microsoft,
*Use DirectX with Advanced Color*). For macOS no primary source was read here (Apple's page returned no body). No web
API found in these sources tells a page how many bits reach the panel.

**A native client** owns that path: on Windows a flip-model swap chain in `R16G16B16A16_FLOAT` (any Advanced Color
display) or `R10G10B10A2_UNORM` (HDR only) (same Microsoft page); Metal and Vulkan were not read.

## Colour, today

RGB is painted as stored, through an identity table, into the same sRGB-tagged buffer. The ingest refuses any
photometric interpretation but MONOCHROME1, MONOCHROME2 and RGB, so no YBR conversion happens anywhere. It reads
neither ICC Profile (0028,2000) nor Color Space (0028,2002). PS3.3 C.11.15 defines the profile as the transformation
of the stored values into the profile connection space, and Color Space as a label naming a well-known space (sRGB, Display-P3, …) consistent
with it. A series whose profile is not sRGB is therefore shown with sRGB's meaning: wrong saturation and hue on that
series, by an amount set by its profile. None of our colour sets carries either, the six sound RGB ultrasound sets
included (§Which series carry them).

## The gaps, each change, and whether it is net

| gap | change | cost | net? |
| --- | --- | --- | --- |
| G1 · 8 bits after the window | 16-bit table, `RGBA16F` picture and drawing buffer, `alpha: true` | picture memory ×2 (100 against 50 MB for 4096×3072, (D)); paint time unmeasured; reaches the panel only on Chrome/Edge with an OS path of > 8 bits; on an 8-bit path the compositor, not the painter, rounds to the byte, so the proof "equal to the reference to the code" would no longer hold for what is shown | **trade-off**: memory, and the 8-bit proof, against up to 4× finer steps where a 10-bit path exists |
| G2 · no GSDF in software | none without a photometer: the panel's luminance range is the input | — | not decidable here |
| G3 · colour management before a GSDF panel | deployment: `--force-color-profile=srgb` on reading stations, if a device shows the ramp bent | none in code | device question |
| G4 · ICC Profile and Color Space ignored | ingest records Color Space (and the profile); the painter sets `drawingBufferColorSpace` for Display-P3, or converts in the window pass | small, and only where a series carries one | ~~net where present~~ — *none present* on our sets (row 214): nothing built |
| G5 · bilinear on bytes | part of G1: filtering the `RGBA16F` picture | as G1 | with G1 |
| G6 · VOI LUT Sequence and Presentation LUT Shape dropped | ingest records them; the table is already per stored code, so an explicit LUT fills it directly | small | ~~net where present~~ — *present but redundant* on our sets (row 214): each LUT is its window pair to 1 code, and the shape restates the photometric interpretation the painter already applies; nothing built |

## Protocol (*proposed*)

**In a container** (Chromium 141, SwiftShader, the painter's own check): a painter variant with
`drawingBufferStorage(RGBA16F)`, `alpha: true`, a 16-bit table and an `RGBA16F` picture, read back as `RGBA/FLOAT`
against `reference.js` extended to a code depth parameter. Cells: today's 50 exact and the fractional ones, DPR 1 and
2. Bench: `check.mjs bench`'s four variants for both painters, interleaved by `lab/order.mjs`, 10 rounds.

* *Predictions:* every exact cell equal to the reference at 10 bits; fractional cells at most today's |Δ| in 8-bit
  units; picture memory ×2; paint time on SwiftShader up by at most the picture's extra bytes (D: ≤ 2× pass 1).
* *Mutations:* the 8-bit table under the float buffer must fail the 10-bit exact cells; a dropped `alpha: true` must
  fail at context set-up.
* *Decision rule:* none of G1 is adopted by this alone (its memory cost makes it a trade-off); the result goes to the
  owner with the numbers. Today's 8-bit check stays the gate's either way.

**On a device** (the owner's): a medical display with a 10-bit path (Windows Advanced Color), its GSDF calibration
checked with a photometer (AAPM TG270 method), a TG18-MP-like 10-bit ramp painted through both painters, with and
without `--force-color-profile=srgb`: contours counted by eye, luminance per step measured against the GSDF. That
decides G1's worth and G3.

**Proposed rows** (theory first, one question each): *DISPLAY10* — does a half-float painter equal the reference at
10 bits, and at what paint time? *COLORTAGS* — do any of our sound colour series carry an ICC Profile or a Color Space
other than sRGB? *VOILUT* — do any of our series carry a VOI LUT Sequence or a Presentation LUT Shape the ingest
drops? (Both answered by row 214, below.)

## Which series carry them

Row 214, 2026-10-14: every DICOM file pinned in `lab/av1/data.json` — 1 044 in the 83 sound sets, and the two that are
not — streamed, checked against its SHA-256 and read by `lab/av1/display_tags.py`; the attributes are searched
anywhere in the object, nested functional groups included; a transfer this container's proxy corrupted (9 of them) was
fetched again until it matched. Two runs gave the same output. Counts are of the sound sets.

| attribute | sets | files | what they hold |
| --- | --- | --- | --- |
| ICC Profile (0028,2000), Color Space (0028,2002) | 0 | 0 | the 6 sound RGB ultrasound sets (48 files) carry neither |
| Modality LUT Sequence (0028,3000), Presentation LUT Sequence (2050,0010) | 0 | 0 | |
| Presentation LUT Shape (2050,0020) | 70 | 222 | every mammography and tomosynthesis set, and `rf_fluoro`: `IDENTITY` on all 52 MONOCHROME2 sets, `INVERSE` on all 18 MONOCHROME1 sets (79 files), none the other way round |
| VOI LUT Sequence (0028,3010) | 12 | 46 | `ffdm_b`, `ffdm_c`, `ffdms_a1`–`a5`, `ffdms_c1`–`c5`: three items an object, `NORMAL`, `HARDER`, `SOFTER`, 12-bit; every one of the 46 also carries three window pairs of the same names, SIGMOID |

**The Presentation LUT Shape adds nothing to paint.** In the DX Image Module, which the digital mammography images
include, it is defined to account for the photometric interpretation, not to apply after it: `IDENTITY` *shall be
used* with MONOCHROME2 and `INVERSE` with MONOCHROME1 (PS3.3 C.8.11.3 and its C.8.11.3.1.2). Inverting on `INVERSE` as
well as on MONOCHROME1 would show every raw mammogram and tomosynthesis projection the wrong way round. On our sets the
two always agree, so the painter's MONOCHROME1 inversion already is the shape. 17 of the 18 MONOCHROME1 sets are
digital mammography *for processing*; the 18th (`dbtproj_holo`) is a Breast Projection X-Ray image, whose module was
not read here.

**Each VOI LUT is its window pair, tabulated.** Every sample of the 46 objects through each LUT item (output scaled
from 0–4095 to the byte, rounded as `voi.js` rounds) against through the window pair of the same explanation
(the SIGMOID of `voi.js`): **at most 1 code apart, on at most 1.5 % of samples** (0.17–1.5 % per object and item; each of
the 138 items differs by 1 somewhere). Pairing each LUT with the next pair instead moves it to 21–43 codes on 36 % of `ffdm_b`'s samples: the
comparison's own mutation. The viewer shows the first pair, `NORMAL`, so these series already look as their LUT `NORMAL` would, to
one code — less than the painter's own bilinear difference on a fractional zoom (1–5 codes, `client/paint/README.md`).

**So nothing is built.** Reading the LUTs would add an ingest field (2 352–4 020 entries an item, three items a
frame, in the metadata), a table path in the painter and a choice in the viewer, to move 1.5 % of samples by one code.
What the sets do show is that `HARDER` and `SOFTER` — alternatives the standard expects a viewer to offer
(PS3.3 C.11.2.1.2.2) — are reachable today only by dragging the window, whether they come as pairs or LUTs; offering
the series' own window pairs is a viewer change, proposed as row *VOIPRESETS*. A series that carries a VOI LUT and no
window pair, or a colour profile other than sRGB, would reopen G6 or G4; none of ours does.

```bash
python3.11 -m venv lab/av1/.venv && lab/av1/.venv/bin/pip install --require-hashes -r lab/av1/requirements.txt
lab/av1/.venv/bin/python lab/av1/display_tags.py lab/av1/data.json [SET ...]   # 7 min 20 s for all 85 sets here
```

## Sources

* DICOM PS3.14, ch. 7 (Grayscale Standard Display Function), and PS3.3 2026d C.11.15 (ICC Profile Module),
  dicom.nema.org, read 2026-10-13; PS3.3 2026d C.11.2.1 (VOI LUT Module), C.11.6.1 (Softcopy Presentation LUT) and
  C.8.11.3 (DX Image Module), read 2026-10-14.
* WebGL 1.0 specification (shared by 2.0 for these members), `KhronosGroup/WebGL` `main` at `714857a2`:
  `drawingBufferStorage`, `drawingBufferFormat`, `drawingBufferColorSpace`.
* caniuse, `mdn-api_webgl2renderingcontext_drawingbufferstorage`, read 2026-10-13; Chrome 122 release notes.
* Chrome for Developers, *What's New in WebGPU (Chrome 129)*: canvas tone mapping mode.
* Microsoft Learn, *Use DirectX with Advanced Color on high/standard dynamic range displays* (page commit `f18cd183`).
* Chromium `ui/display/display_switches.cc` at tag 141.0.7390.0.
* T. Kimpe, T. Tuytschaever, *Increasing the number of gray shades in medical display systems — how much is enough?*,
  J Digit Imaging 20(4), 2007, doi:10.1007/s10278-006-1052-3 (PMC3043920).
* R. Chrzan, A. Urbanik, *The assessment of diagnostic medical images using 10-bit grayscale — fact or myth?*, Pol J
  Radiol 83:127–132, 2018, doi:10.5114/pjr.2018.75877.
