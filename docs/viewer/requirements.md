# Viewer requirements

This document lists what the viewer must do and what is nice to have, on whose authority, and whether the client
does it today. Every sentence quoted below was read in its source, and each one is linked (§Sources).

## The required set, in plain words

Breast imaging, from IHE MAMMO and DBT and the ACR mammography parameter:

1. **Hanging protocols** that the user configures. They place images by laterality and view code, and current and
   prior images go side by side: four views each, and up to eight viewports for DBT. The breast is justified to the
   viewport edge.
2. **Size.** The viewer offers same size, true size, and one stored pixel to one display pixel with nothing applied
   but the grey transform. It shows a ruler and measures distance on the right pixel spacing.
3. **Grey.** It applies the VOI LUT Sequence, or the window with LINEAR and SIGMOID, whichever the user picks. It
   renders to the GSDF on a display whose luminance range is configured. Background air stays black through any
   window or invert. A window adjustment keeps the VOI function.
4. **Labels.** View labels such as `RCC` and `RCCID`. Patient and study identification is shown, and nothing covers
   the chest-wall edge. Synthesized 2D is labelled as synthesized. The viewer warns when no displayed study is recent.
5. **CAD.** The marks of a Mammography CAD SR are displayed, one SR at a time, with the newest as the default. The
   viewer says whether marks are on, and tells "CAD failed" apart from "no findings".
6. **DBT.** Manual scrolling and cine scroll in spatial order and never skip a slice. Cine has a speed control and
   loop, sweep or stop. Each view toggles between 2D, slices, slabs and synthesized 2D. The frame number, the slice
   thickness and the position in the stack are shown.
7. **Presentation states.** GSPS is applied, and the user saves and retrieves it.

All 2D, from IHE BIR, which is taken as the floor beyond breast imaging:

8. Layouts and thumbnails. Side-by-side comparison. Scrolling, zoom and pan linked across one Frame of Reference.
   Scrolling never wraps around. Zoom is continuous with interpolated display, never nearest-neighbour.
9. The first window in the image is the default. The current window is always shown. CT presets. Shutters. Invert.
   Colour, PALETTE COLOR included.
10. Orientation labels and laterality. Rotate and flip, only for DX and CR.
11. Distance and angle, and the pixel value under the cursor in modality units.
12. A cine with a rate control, whose default rate comes from the image.
13. A label that says whether the image was lossy-compressed at its source.
14. Annotations that can be turned off. Tooltips. Keyboard shortcuts that ignore case. Never two patients at once.

Everywhere, from ACR, AAPM and FDA:

15. **Lossless pixels for mammography.** A lossy mammogram is never offered for primary reading. Lossy priors may
    be used for comparison only.
16. **Mobile is not for mammograms.** A mobile or uncleared display is labelled as not for primary mammography
    reading.
17. **Security.** Access control, an audit trail, encryption in transit, and auto-logoff.

Of these, the client has today:

* windowing with LINEAR, LINEAR_EXACT and SIGMOID, which the adjustment keeps;
* invert and MONOCHROME1;
* interpolated zoom and pan;
* frame-number display, manual scrolling, and cine at the image's own rate;
* exact pixels, checked frame by frame.

The rest is not built, and five behaviours today contradict a requirement (§What the client contradicts today).

## Authority, and the rule for each verdict

| source | what it binds |
| --- | --- |
| IHE Radiology TF Rev 23.0 ([V1], [V2]) | an actor that claims a profile. The required set assumes the Image Display claims **MAMMO and DBT**, and takes **BIR** as the floor for all other 2D. BIR's own scope is "review of images for the purpose of clinical decision-making by ordering physicians" and excludes "primary interpretation of mammography" ([V1] §26), so for reading it is a floor, not a ceiling |
| DICOM 2026d ([P3], [P4]) | an implementation that claims a SOP class, for example a GSPS or Hanging Protocol SCP |
| ACR–AAPM–SIIM ([ACR-EP], [ACR-MG], [ACR-SEC], [ACR-DBT]) | guidance. Each one calls itself "an educational tool… not inflexible rules or requirements of practice". Its "must" is counted as required here, and labelled ACR |
| FDA ([CFR892], [FDA-DISP]), MQSA ([CFR900], [FR2023], [SECG]) | regulation. Software that displays images "for the purposes of interpretation" is Class II: "(b) Classification. Class II (special controls; voluntary standards—Digital Imaging and Communications in Medicine (DICOM) Std., …)" ([CFR892]). AAPM Report 260 reads this as "an app intended to display medical images for a radiologist to diagnose is a class II medical device that requires premarket notification" ([TG260] §7). Clearance is therefore a gate on diagnostic use, not a feature |
| AAPM TG-270, Report 260 ([TG270], [TG260]) | physics guidance for displays and handhelds |

**R** marks a requirement: *shall*, *must* or *required* in a profile assumed above, in DICOM for a claimed class,
in ACR, or in regulation. **N** marks something nice to have: *should*, *may*, an IHE option, or *desirable*.
**O** marks something out of scope: outside a 2D viewer of lossless For Presentation images. A **should** taken as a
target anyway is marked N\*. "Today" points at the file that does it, or says no.

## Navigation and layout

| feature | | the source | today |
| --- | --- | --- | --- |
| hanging protocols by attributes | R | "The Image Display shall use the values of Image Laterality (0020,0062), View Code Sequence (0054,0220), View Modifier Code Sequence (0054,0222) and Patient Orientation (0020,0020) to display images according to the preferred hanging protocol of the current user, rather than depend on descriptive attributes such as Series Description" ([V2] §4.16.4.2.2.1.1.2) | no: one canvas, one series per server process (glossary *series*) |
| hanging protocols the user defines | R | "The Image Display shall allow the user to select or configure hanging protocols such that … the placement of images relative to one another, the required orientation of the images, the display of current and prior images, and the sequence of layouts displayed can be defined." (same §) | no |
| implant-displaced views kept apart | R | "The Image Display shall be able to distinguish and display separately images with one or more Items in a View Modifier Code Sequence (0054,0222) …" (same §) | no |
| current and prior, four views | R | "The Image Display shall be capable of displaying simultaneously a set of current and prior conventional four view screening mammogram images (left and right CC and MLO views), regardless of whether these images are in one or multiple DICOM Series." ([V2] §4.16.4.2.2.1.1); also ACR "must" ([ACR-MG] V.B.5.e) | no |
| breast justified to the viewport edge | R | "The Image Display shall be capable of horizontally justifying the image to the left or right side of the viewport rather than centering it" ([V2] §4.16.4.2.2.1.1.2) | no: the painter centres (`client/paint/README.md` §The contract, *Placement*) |
| DICOM Hanging Protocol objects | N | an SCP that applies them "shall apply all mandatory Hanging Protocol and presentation intent Attributes" ([P4] GG.6.1.2) — only for one that claims the class | no |
| layouts: 1 and 2 viewports; 1×1, 2 across, 2 down, 2×2 inside one | R | "A Layout Multiple Viewports tool shall be provided … At least two layouts shall be supported"; "A Layout Within Viewport tool shall be provided … At least four layouts shall be supported" ([V2] §4.16.4.2.2.6.2) | no |
| thumbnails ≥ 128 px | R | "The Image Display shall provide thumbnails for each FrameSet … no less than 128x128 pixels" ([V2] §4.16.4.2.2.6.3) | no |
| two series side by side | R | "The Image Display shall allow at least two FrameSets for the same or different studies to be compared side by side in separate viewports" (same §) | no |
| one patient at a time | R | "The Image Display shall not display FrameSets for multiple patients simultaneously." (same §) | holds trivially: one series |
| linked scrolling, zoom and pan in one Frame of Reference | R | "If the FrameSets share the same DICOM Frame of Reference UID, the viewports shall by default be synchronized with respect to scrolling …, be synchronized with respect to panning and zooming …, have cross-referencing active" ([V2] §4.16.4.2.2.6.2) | no |
| localizer lines, cross-hair | R | "A Localizer Lines tool shall be provided to turn the display of localizer lines on or off." ([V2] §4.16.4.2.2.6.7) | no |
| linked scrolling across DBT views | N | no IHE DBT sentence ("synchroni" does not occur in [V2] §4.16.4.2.2.1.3); DICOM can encode it: "Each Item of this Attribute identifies a group of Display Sets to which synchronized scrolling is to be applied." ([P3] Table C.23.3-1) | no |
| fast navigation between old and new studies | N\* | "Mammographic displays should allow fast and easy navigation between old and new studies. This is especially critical when there is a mix of FFDM and DBT images." ([ACR-MG] V.C.2) | no |

## Display

| feature | | the source | today |
| --- | --- | --- | --- |
| the image's first window by default | R | "The default when grayscale images are displayed in a viewport shall be to use the first set of VOI LUT or window values supplied in the DICOM attributes." ([V2] §4.16.4.2.2.6.4) | yes, for the window: `client/viewer/viewer.js` `display` takes `center[0]`, `width[0]` |
| VOI LUT Sequence and window, chosen by the user | R | "the Image Display … shall have both the capability to apply all the transformations specified by the VOI LUT Sequence (0028,3010) and the capability to apply all the transformations specified by the Window Width … as selected by the user from the choices available" ([V2] §4.16.4.2.2.1); "allow the user to select which transformation to apply when multiple transformations are present" ([P3] C.11.2.1.2.2) | partly: no VOI LUT Sequence (`docs/display.md` §Grey, today), and no choice among several windows |
| LINEAR and SIGMOID | R | "VOI LUT Function (0028,1056) values of "SIGMOID" and "LINEAR" shall be supported." ([V2] §4.16.4.2.2.1) | yes: `client/paint/voi.js` |
| adjustment keeps the function | R | "the Image Display shall allow the user to adjust the contrast without reverting to a purely linear transformation" ([V2] §4.16.4.2.2.1.1.4) | yes: the drag keeps `function` (`viewer.js` pointer handlers) |
| current window always shown | R | "The currently applied window center and width for each viewport shall be displayed at all times" ([V2] §4.16.4.2.2.6.4) | no: the status line omits it |
| CT presets | R | "user-selectable window presets shall be provided which shall include presets for soft tissue, brain, lung and bone" (same §); ACR "recommended" ([ACR-EP] III.D.1.e.4) | no |
| GSDF, luminance range configurable | R | "An Image Display that supports the Mammography Image Profile shall support calibration as described in the DICOM Grayscale Standard Display Function (GSDF). The minimum and maximum luminance of the display shall be configurable by the site" ([V2] §4.16.4.2.2.1.1); CPI: "it is required that both the Grayscale Standard Display Function and the Grayscale Softcopy Presentation State are supported" ([V1] §5) | no: 8 bits tagged sRGB, no presentation LUT (`docs/display.md`) |
| background air not windowed | R | "Image Displays shall be capable of recognizing pixels that have the value specified in Pixel Padding Value (0028,0120) … and setting them to a minimum display value that is not affected by image contrast adjustments, including inversion" ([V2] §4.16.4.2.2.1.1.1) | no |
| GSPS applied, saved and retrieved | R (ACR), N (IHE) | "Support for DICOM presentation states for displaying images with the ability to save and retrieve various presentation states as specified by the user is required." ([ACR-MG] VI.B.4); for MAMMO alone "it is optional for the Image Display … to actually retrieve and display/apply these objects" ([V2] §4.16.4.2.2.1); a GSPS SCP "shall apply all the transformations stored in the state" ([P4] N.1.1); for DBT, saving user annotations is the User Annotation Option ([V1] §37.2.5) | no |
| shutters | R | "Display shutters encoded in the image shall be applied." ([V2] §4.16.4.2.2.6.4) | no |
| invert | R | "An invert grayscale tool shall be provided." (same §) | yes: `viewer.js` key `i`; MONOCHROME1 in `voi.js` |
| colour, PALETTE COLOR included | R | "the Image Display shall be able to display color images (those with a Photometric Interpretation of RGB or PALETTE COLOR)" (same §) | RGB yes; PALETTE COLOR declined (`client/paint/README.md` §The contract) |
| 1:1 pixels, no processing | R | "each encoded pixel occupies one display pixel in the viewport" ([V2] §4.16.4.2.2.1.1.3.3); "there shall be a mode in which actual pixels … are displayed … with no further processing or interpolation other than application of point grayscale transformations" (§…1.9); ACR "essential" ([ACR-EP] III.D.1.e.5) | the painter can, exact to the code at zoom 1 (`client/paint/README.md` §What is proved); the viewer has no such mode (`view()` is always `fit: true`) |
| same size, true size | R | "all images are at the same relative physical size"; "all images are true size, regardless of whether they have the same values of Imager Pixel Spacing" ([V2] §4.16.4.2.2.1.1.3.1–2); ACR "must" ([ACR-MG] V.B.5.b–c) | no: the ingest keeps no pixel spacing (`ingest/from-dicom/dicom_series.py` `display`) |
| continuous zoom and pan, interpolated | R | "The Image Display shall provide continuous (not stepped) zooming and panning"; "Interpolation for display shall be continuous (e.g., linear or bicubic) and not by nearest neighbor replication." ([V2] §4.16.4.2.2.6.6); ACR: "Workstation software tools must include window/level and zoom/pan" ([ACR-MG] V.C.4) | bilinear yes; zoom stepped ×1.25 and ×1.1 (`viewer.js` `zoom`); no pinch |
| magnifier (loupe) | N | no source found that requires one | no |
| orientation labels, laterality | R | "The Image Display shall display the laterality … in the overlaid annotations"; orientation labels "shall be annotated on the right and bottom sides of the viewport" ([V2] §4.16.4.2.2.6.7); "Rotating or flipping the images must preserve the correct patient orientation labels." ([ACR-EP] III.D.1.e.6) | no |
| orientation from attributes, not the pixels' order | R | "Image Displays shall not assume that the pixel data is encoded with an orientation that is suitable for direct display" ([V2] §4.16.4.2.2.1.1.2) | no: shown as stored |
| rotate and flip, only for DX and CR | R | "The Image Display shall provide tools to rotate images with a Modality (0008,0060) of DX or CR … by 90 degree increments, and to flip them horizontally. These tools shall be inactive for other modalities, for safety reasons." ([V2] §4.16.4.2.2.6.2) | contradicted: `r`, `h`, `v` act on every modality |
| view labels | R | "annotating the viewport with abbreviations derived from the value of Image Laterality …, View Code Sequence … and any values of View Modifier Code Sequence"; "a right CC view shall be displayed as "RCC""; "a right implant displaced CC view would be annotated as "RCCID"" ([V2] §4.16.4.2.2.1.1.5.3) | no |
| identification and technique shown | R | "The Image Display shall be capable of displaying the information contained in the attributes listed in" the identification and the technique tables, the investigative set on request ([V2] §4.16.4.2.2.1.1.5.1–2); "Displays must be capable of showing image information, including patient identification, image information, and acquisition technique" ([ACR-MG] V.B.5.d); "essential" ([ACR-EP] III.D.1.e.3) | no: the ingest drops patient and study identifiers by design (`dicom_series.py` `display`) |
| chest-wall edge left clear | R | "the Image Display shall not annotate the edge that contains the chest wall, as determined from (0020,0020) Patient Orientation" ([V2] §4.16.4.2.2.1.1.5) | no annotations |
| annotations can be turned off | R | "The Image Display shall provide a tool to suppress the display of the annotations" ([V2] §4.16.4.2.2.6.8); "It shall be possible to turn on or off either set of annotations" ([V2] §4.16.4.2.2.1.1.5.1) | no |
| lossy at source labelled | R | annotations include "whether or not lossy compression has been applied, derived from Lossy Image Compression (0028,2110)" ([V2] §4.16.4.2.2.6.8); "The FDA requires that when an image is displayed it be labeled with a message stating if irreversible compression has been applied and with approximately what compression ratio" ([ACR-EP] III.B) | no: the ingest does not carry (0028,2110). The on-screen mark is about our own exactness (`viewer.js` `repaint`) |
| a study that is not recent, warned | R | "it is required that an Image Display explicitly warn the user if none of the studies being displayed are within a user configurable period from the current real time, as determined by Acquisition Date" ([V2] §4.16.4.2.2.1.1.10) | no |
| partial view annotated | N | the Partial View Option ([V2] §4.16.4.2.2.1.1.7) | no |
| the panel's luminance | O | the display's, not the viewer's: for mammography "L'min ≥ 1.2 cd/m2 / LR = 350 [250 - 450] / L'max = 420 cd/m2 [≥ 350 cd/m2 ]" ([TG270] Table VI) | — |
| more than 8 bits to the panel | N | "no evidence has been found to date that diagnostic interpretations are affected by the use of higher than 8-bit systems" ([ACR-EP] III.D.1.a) | no (`docs/display.md` §More than 8 bits) |

## DBT

| feature | | the source | today |
| --- | --- | --- | --- |
| everything in MAMMO | R | "Image Displays participating in the Digital Breast Tomosynthesis Profile shall fulfill all requirements listed in Section 4.16.4.2.2.1.1" ([V2] §4.16.4.2.2.1.3) | as above |
| slices, slabs, conventional 2D and generated 2D, current against prior, in eight viewports | R | "the Image Display shall be capable of displaying combinations of screening views … from a current and prior set of a pair of any of the following types of acquisition: Tomosynthesis slices; Tomosynthesis slabs; Conventional 2D mammography images; Generated 2D images" (same §) | no |
| toggle the type in place | R | "the user shall be provided with a means to toggle between the available conventional 2D mammography images, tomosynthesis slices, … and generated 2D image for the views currently displayed without affecting the display layout" (same §) | no |
| manual scrolling and cine | R | "Two modes of scrolling, manual and automatic (cine), shall be provided. For the automatic mode, the user shall be provided with control over the cine speed (frame rate) and the initial speed shall be configurable." (§…3.9) | manual yes (`viewer.js` keys, wheel); cine at the image's rate, with no control over it |
| loop, sweep, stop | R | "they may choose looping, sweeping or stopping" (same §) | loop only, and it wraps on manual steps too |
| no slice skipped | R | "The Image Display shall not skip slices during manual or automatic scrolling." (same §) | not proved: the cine timer advances the index whether or not that frame was painted (`viewer.js` `toggleCine`, `repaint`) |
| spatial order | R | "Scrolling shall be in spatial sequence according to Image Position (Patient) (0020,0032) for a given volume within a viewport." (same §) | no: the ingest orders by Instance Number, or by the object's own frame order (`dicom_series.py` `objects`) |
| mouse up scrolls toward the paddle | R | "Vertical movement of a conventional pointing device (such as a mouse) upward shall scroll toward the paddle"; touch "should scroll in the opposite direction" (same §) | not checked |
| frame number, slice thickness, position | R | "For each frame the annotation shall show the current frame number and the number of frames"; slice thickness "shall be displayed"; "the position within the stack of frames shall be displayed" (§…3.5.4); ACR DBT "should" ([ACR-DBT] IV.F) | frame number only (`viewer.js` `status`) |
| pixel spacing for DBT | R | "shall be approximated by using the values of Pixel Spacing (0028,0030)" (§…3.3), unlike MG's Imager Pixel Spacing | no |
| synthesized 2D labelled | R | "If SM is used, it must be labeled as such to distinguish it from a separately acquired 2-D DM" ([ACR-DBT] IV.F) | no |
| 25 frames/s on a 5 MP display | N\* | "a maximum scrolling rate of at least 25 frames per second for an entire 5 MP display is desirable" (a note, §…3.9); "Displays for DBT should incorporate technology to compensate for image blur during scrolling via optimized frame rates." ([ACR-MG] V.B) | not measured on a GPU; on SwiftShader one 4096×3072 frame paints in 211 ms (`client/paint/README.md` §What it costs) |
| slabs made by the viewer | N | "The Image Display can be grouped with an Evidence Creator in order to generate derived tomosynthesis reconstructions (e.g., slabs)." ([V1] §37.1.1.3); thick slab read 11.2 % faster ([Chumsaengsri 2025]) | no |
| projection images | N | an option: "manual scrolling … automatic scrolling (cine) is not required" (§…3.10) | no |
| CAD on DBT | N | "The support for CAD is out of the scope for this profile." ([V1] §37) | no |
| For Processing images | O | "Image Displays are not required to support "For Processing" images." ([V2] §4.16.4.1.3.2) | — |

The reading-time literature explains why the scroll and the hanging protocol matter. Interpretation was "0.9 minute
longer (47% longer)" with DBT added ([Dang 2014]), and 77 s against 33 s ([Bernardi 2012]). One study found that
"Cine loops at slow frame rates were ruled out as inefficient" ([Timberg 2013]).

## Tools

| feature | | the source | today |
| --- | --- | --- | --- |
| distance, in the right units | R | "The Image Display shall provide a tool to measure distance in a straight line between two points"; "reported in pixels rather than physical units if there is no spacing or calibration information" ([V2] §4.16.4.2.2.6.10); for MG, "Imager Pixel Spacing (0018,1164) divided by Estimated Radiographic Magnification Factor (0018,1114)", and "Pixel Spacing (0028,0030) shall not be used" ([V2] §4.16.4.2.2.1.1.3) | no |
| angle | R | "a tool to measure the angle between two straight line segments, which do not necessarily share a common vertex" ([V2] §4.16.4.2.2.6.10) | no |
| pixel value at the cursor | R | "At all times (except during cine), the scaled pixel value (physical unit) corresponding to the current cursor location shall be reported to the user" (same §); ACR "necessary" ([ACR-EP] III.D.1.e.7) | no |
| ruler, magnification shown | R | "The Image Display shall be capable of displaying a ruler or caliper … It shall be possible to turn on or off the ruler"; annotate "Pixel Size Magnification … True Size Magnification" ([V2] §4.16.4.2.2.1.1.6) | no |
| tooltips, case-insensitive keys | R | "All tool icons shall supply a tool tip"; "Keyboard short cuts shall be case insensitive." ([V2] §4.16.4.2.2.6.13) | contradicted: `viewer.js` `KEYS` maps `r`, `h`, `v`, `i` and not their capitals; there are no tool icons |
| advanced tools hidden by default | R | "Additional features may be present, but in order to reduce confusion these shall not be displayed to the user, unless the user specifically selects a tool to trigger advanced functionality." ([V2] §4.16.4.2.2.6.1) | — |
| ROI statistics (area, mean, SD) | N | no source found that requires them | no |

## CAD and SR

| feature | | the source | today |
| --- | --- | --- | --- |
| Mammography CAD SR marks | R | "Image Displays shall be able to apply marks on the displayed image corresponding to all findings encoded in Mammography CAD SR objects with a (111056, DCM, "Rendering Intent") value of (111150, DCM, "Presentation Required")." ([V2] §4.16.4.2.2.1.1.8); ACR "must" ([ACR-MG] V.B.5.a); "there is no such thing as a "low-grade" rendering for Mammography CAD SR" ([V2] §4.45.4.2.3.1) | no |
| marks on/off shown; one SR, newest first | R | "The Image Display shall make the user aware that CAD marks are available for display, and indicate whether or not CAD marks are currently activated"; "Only a single CAD SR object at a time shall be applied to a displayed image." ([V2] §4.16.4.2.2.1.1.8) | no |
| marks mapped onto For Presentation images | R | marks apply to "For Presentation" images whose Source Image Sequence references the For Processing ones (same §) | no |
| failed CAD told apart | R | "The Image Display shall indicate when CAD was not attempted or has failed … as distinct from when CAD has succeeded but there are no findings." (same §) | no |
| Presentation Optional findings | N | "They may be able to display additional findings that have a … value of (111151, DCM, "Presentation Optional")." (same §) | no |
| Evidence Documents shown | R | "Evidence Documents shall be displayed to the user of the Image Display" ([V2] §4.45.4.2.2) | no |
| Segmentation | N | no profile above requires it ([P3] A.51) | no |
| the reading without marks | O | the facility's duty: "The facility must retain images that are capable of being displayed without the CAD marks" ([SECG] I.4) | — |

## Key images and reporting

| feature | | the source | today |
| --- | --- | --- | --- |
| key images flagged | N (R under KIN) | "IHE requires Image Display Actors receiving Key Image Notes to display the fact that images referenced by the Key Object Selection Document belonging to the same study are flagged." ([V1] §8.3). For DBT it is an option ([V1] §37.2.1) | no |
| rejected instances suppressed | N (R under IOCM) | "it shall suppress the KOS and its referenced rejected instances from presentation" ([V2] §4.31.4.2.3.2) | no |
| show the report | N | BIR requires a Show Report tool only "When used as the Basic Viewer Option on PDI Media" ([V2] §4.16.4.2.2.6.12); the "R" beside it in Table 4.16.4.2.2.6.13-1 is its shortcut key | no |
| writing the report (Breast Imaging Report, TID 4200) | O | a reporting system's job ([P16] TID 4200) | — |

## Integration

| feature | | the source | today |
| --- | --- | --- | --- |
| launch by URL (IID) | N (R once claimed) | "The Image Display shall support all required parameters", which are `requestType=STUDY` with `studyUID` and `accessionNumber`, and `PATIENT` with `patientID`, `diagnosticQuality` and `keyImagesOnly` ([V2] §4.106.4.1.2); "The Image Display shall support the HTTPS protocol"; on error "any previously displayed images of a different Patient or Study shall be closed" (§4.106.4.1.3) | no: the URL carries only the page's own and the lab's parameters (`client/README.md` §The viewer) |
| prior studies retrieved in time | R | "Current and prior examinations must be retrievable in a time frame appropriate to the clinical needs" ([ACR-EP] III.E.4) | no: one series per server process |
| DICOMweb, raw frames | N | WIA's consumer "shall support" WADO-RS and QIDO-RS ([V1] Table 42.1-1). Lossless needs the Frames or Instances resource: it "shall contain all the Pixel Data" ([P18] 10.4.3.3.6) | no: the store's own wire ([`../WIRE.md`](../WIRE.md)); the archive side is not designed |
| DICOMweb rendered | O | a rendered JPEG "shall be encoded using the JPEG baseline lossy 8-bit" process ([P18] 8.7.4), which is not lossless | — |
| worklist | O | no source above puts it in the viewer; IID has the worklist invoke it | — |

## Performance

| feature | | the source | today |
| --- | --- | --- | --- |
| an image in 3 s from local storage | N\* | "It should not take more than 3 seconds to retrieve an image from online local storage and display it on a workstation." ([ACR-MG] V.C.1) | the CT series' first exact frame is on screen 576–847 ms from navigation at 1×, and 974–1 195 ms at 4×, on a software renderer ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The viewer); a mammogram and a phone are not measured |
| scroll rate | N\* | 25 frames/s on 5 MP, desirable (§DBT) | not measured |
| varying bandwidth | N | "The system should handle varying bandwidth between the handheld device and the server" ([TG260] §6) | the session survives a lossy link, measured ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Session survival) |

## Mobile, security, audit and privacy

| feature | | the source | today |
| --- | --- | --- | --- |
| no lossy mammogram for primary reading | R | "Mammographic images with lossy compression must not be reviewed for primary image interpretations." ([FDA-DISP] VIII); lossy images "would generally not be considered to be "original" mammograms" ([FR2023] Response 100); priors "may be used for comparison purposes" ([ACR-EP] III.B) | yes: every frame is lossless and checked (`client/README.md` *A frame says whether it is exact*) |
| mobile not for mammograms | R | "Mammographic images may only be interpreted using an FDA cleared display" ([FDA-DISP] VIII); "these devices do not have the spatial resolution required for viewing mammograms" ([ACR-MG] V); "it is hard to argue that handheld devices are appropriate for anything other than "wet reads"" ([TG260] §3); the FDA guidance "does not apply to displays in handheld or mobile devices" ([FDA-DISP] III) | no label |
| calibration shown on a handheld | N | "An indication of such a calibration to the user should be good practice." ([TG260] §3.5) | no |
| encryption in transit | R (ACR) | "all health data in motion must be encrypted" ([ACR-SEC] IV.F.3) | the transport is TLS; the page is TLS only when `TLS_DIR` is set ([`../../deploy/README.md`](../../deploy/README.md)) |
| access control, mobile included | R (ACR) | "Propagation of access controls to mobile devices … must also have methods for restricted database and system access via device identification, encryption, passwords, and auto-logoff" ([ACR-SEC] IV.C) | no |
| audit trail | R (ACR) | "Secure, computer-generated, time-stamped audit trails that record activity must be maintained" ([ACR-SEC] IV.D); "Communications to/from the server to the client have to be logged, auditable, and encrypted." ([TG260] §6) | no |
| DICOM audit message format | N | "DICOM Instances Accessed" (110103) in the PS3.15 format, for a claimant: "not required to send a message each time the activity … occurs" ([P15] A.5.3) | no |
| auto-logoff | N\* | "this should generally be 30 minutes" ([ACR-SEC] IV.C.2) | no |
| nothing left on the device | N | "the client software should leave no persistent data on the mobile device after either a normal or abnormal program termination" ([TG260] §6) | holds today, because frames are in memory only; the proposed OPFS cache would break it (§Open) |

## Accessibility

| feature | | the source | today |
| --- | --- | --- | --- |
| tooltips, keyboard control | R | BIR as above; DBT: "Scrolling shall be controllable using both a pointing device and the keyboard." ([V2] §4.16.4.2.2.1.3.9) | keyboard yes (`viewer.js` `KEYS`) |
| anything beyond that | — | not sourced: no accessibility standard was read for this row | — |

## Offline and cache

| feature | | the source | today |
| --- | --- | --- | --- |
| a study too large for the device | N | "Handheld devices may not have enough resources to hold all the slices in a large medical imaging study in memory." ([TG260] §3.6); "Ideally, the images should be full fidelity and brought over only in a just-in-time basis and later purged" (§6) | everything is kept in memory; the cache seam is open ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Open) |
| a viewer on media, with no network | O | PDI: "without requiring the presence of a network connection" ([V1] §15.5.1) | — |

## What the client contradicts today

* Scrolling wraps from the last frame to the first, which BIR forbids: "Scrolling shall not loop around to the first
  slice at the end of the FrameSet" ([V2] §4.16.4.2.2.6.5). See `viewer.js` `show`, `(i + n) % n`.
* Rotate and flip act on every modality. BIR allows them for DX and CR only.
* Keyboard shortcuts depend on case.
* DBT frames are ordered by Instance Number, not by Image Position (Patient).
* The ingest drops the patient's identity, which a mammography reading must show.

## Open

The owner decides each of these:

* **Mobile mammography.** Every source above keeps primary mammography reading off handhelds. Is the mobile target
  review only for breast imaging, with a label, or a per-device clearance?
* **Which profiles to claim.** MAMMO, DBT and BIR are assumed here. CPI, KIN, IID and WIA each add the rows marked
  "R once claimed".
* **GSDF in a browser.** The viewer cannot know the panel's luminance range ([`../display.md`](../display.md)).
  Either it requires a calibrated medical display and says so, or it applies a presentation LUT from a configured
  range.
* **The proposed OPFS cache against AAPM 260's "no persistent data"** ([`../adr/frame-path.md`](../adr/frame-path.md)
  §4).
* **Identity, and where it comes from.** The bundle carries none by design. The viewer needs it from somewhere.
* **Not found:** a primary source for ABUS or breast-ultrasound display beyond "proprietary software tools that
  localize and correlate findings on each view" ([ACR-ABUS] V.B.3); a sentence requiring linked scrolling across DBT
  views; a latency target other than the ACR's 3 s; the ACR Digital Mammography QC Manual, which is sold and was not
  read; the FDA's September 2022 display guidance, of which only the 2017 version was read; PS3.17's informative
  Hanging Protocol annex.

## Sources

All were read on 2026-10-27. Section numbers are each source's own.

* [V1] IHE RAD TF-1, Rev 23.0, Final Text, 2025-08-08
* [V2] IHE RAD TF-2, Rev 23.0, Final Text, 2025-08-08. Every display rule cited is under RAD-16 §4.16.4.2.2
* [P3], [P4], [P15], [P16], [P18] DICOM PS3.3, 3.4, 3.15, 3.16 and 3.18, 2026d
* [ACR-EP] ACR–AAPM–SIIM Technical Standard for Electronic Practice of Medical Imaging, rev. 2022, am. 2023
* [ACR-SEC] ACR–AAPM–SIIM Practice Parameter for Electronic Medical Information Privacy and Security, rev. 2019,
  am. 2023
* [ACR-MG] ACR–AAPM–SIIM Practice Parameter for Determinants of Image Quality in Mammography, rev. 2022, am. 2023
* [ACR-DBT] ACR Practice Parameter for the Performance of Digital Breast Tomosynthesis, rev. 2023
* [ACR-ABUS] ACR Practice Parameter for Whole-Breast Ultrasound, rev. 2024
* [CFR892] 21 CFR 892.2050
* [CFR900] 21 CFR 900.12
* [FR2023] the MQSA final rule, 88 FR 15126, 2023-03-10
* [SECG] FDA MQSA Small Entity Compliance Guide, 2024-08-26
* [FDA-DISP] FDA, Display Devices for Diagnostic Radiology, 2017-10-02
* [TG270] AAPM Report 270, Display Quality Assurance, 2019
* [TG260] AAPM Report 260, Considerations for the Use of Handheld Image Viewers, 2018
* [Dang 2014] Radiology 270:49
* [Bernardi 2012] Br J Radiol 85:e1174
* [Timberg 2013] Eur Radiol 23:997
* [Chumsaengsri 2025] Quant Imaging Med Surg

The papers were read as abstracts.

[V1]: https://www.ihe.net/uploadedFiles/Documents/Radiology/IHE_RAD_TF_Vol1.pdf
[V2]: https://www.ihe.net/uploadedFiles/Documents/Radiology/IHE_RAD_TF_Vol2.pdf
[P3]: https://dicom.nema.org/medical/dicom/current/output/html/part03.html
[P4]: https://dicom.nema.org/medical/dicom/current/output/html/part04.html
[P15]: https://dicom.nema.org/medical/dicom/current/output/html/part15.html
[P16]: https://dicom.nema.org/medical/dicom/current/output/chtml/part16/sect_BreastImagingReportTemplates.html
[P18]: https://dicom.nema.org/medical/dicom/current/output/html/part18.html
[ACR-EP]: https://gravitas.acr.org/PPTS/DownloadPreviewDocument?DocId=136
[ACR-SEC]: https://gravitas.acr.org/PPTS/DownloadPreviewDocument?DocId=104
[ACR-MG]: https://gravitas.acr.org/PPTS/DownloadPreviewDocument?DocId=140
[ACR-DBT]: https://gravitas.acr.org/PPTS/DownloadPreviewDocument?DocId=7
[ACR-ABUS]: https://gravitas.acr.org/PPTS/DownloadPreviewDocument?DocId=61
[CFR892]: https://www.ecfr.gov/current/title-21/chapter-I/subchapter-H/part-892/subpart-B/section-892.2050
[CFR900]: https://www.ecfr.gov/current/title-21/chapter-I/subchapter-I/part-900/subpart-B/section-900.12
[FR2023]: https://www.govinfo.gov/content/pkg/FR-2023-03-10/pdf/2023-04550.pdf
[SECG]: https://www.fda.gov/media/181152/download
[FDA-DISP]: https://digirepo.nlm.nih.gov/pdfdownload/nlm:nlmuid-101719840-pdf
[TG270]: https://www.aapm.org/pubs/reports/RPT_270.pdf
[TG260]: https://www.aapm.org/pubs/reports/RPT_260.pdf
[Dang 2014]: https://doi.org/10.1148/radiol.13130765
[Bernardi 2012]: https://doi.org/10.1259/bjr/19385909
[Timberg 2013]: https://doi.org/10.1007/s00330-012-2675-z
[Chumsaengsri 2025]: https://doi.org/10.21037/qims-2024-2828
