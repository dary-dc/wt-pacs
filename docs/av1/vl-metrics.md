# Visually lossless: which metric may claim it, at which windows

*Row VLMETRICS-RESEARCH, written 2026-11-09. Research only; nothing here is measured, and nothing changes the product.*

The product is to show every viewer a lossy "optimal quality" AV1 view meant to be visually lossless (VL), with the
exact frame on request. A reader windows the image (width W, centre C), and a narrow window magnifies coding error.
The owner asks whether PSNR is the right metric to claim VL, and what experts and the industry use.

1. **Asked:** how VL and diagnostically acceptable lossy compression are established in radiology; which objective
   metrics the literature uses, how they fail and which were validated against readers; how studies treat windowing;
   what that implies for the quality study's VL claim.
2. **Answer:** no guideline read states a limit as a metric. Every number a guideline gives is a **compression ratio**,
   tested on 2D JPEG and JPEG 2000; DICOM and the ACR state none. VL itself is established only by **readers**: an
   alternating (flicker) comparison of exact and lossy on a calibrated display, per image. Against those readers,
   **PSNR** tracks VL on CT about as well as MS-SSIM, and the HDR visual difference predictor (HDR-VDP) does better;
   all of them were validated at a **fixed clinical window**, never at the narrow or worst case. **PSNR alone cannot
   claim VL**: its peak and pooling are global and it does not see the window. No metric has been validated against
   readers on DBT, on breast ultrasound cine, on 10–12-bit video or on AV1.
3. **The numbers that decide it** are readers' (§1); the metrics are screening tools that pick the rung a reader test
   then confirms (§4).
4. **It rests on** the guideline and standard texts and the papers listed in §Sources, each read on 2026-11-09; where
   only an abstract was reachable the entry says so.
5. **Left open:** the CAR standard's own text and the RCR's withdrawn guidance (not reachable); the full texts of the
   paywalled CT studies (abstracts only); any reader study of DBT, breast ultrasound cine, ABUS or AV1 (none found).

Quotes are verbatim from the source named. *Derived* marks this page's own reading; *unverified* marks what was not
read in its primary text; *abstract* marks a paper read from its own abstract only. Sections 1–3 report what the
sources say; §4 is the synthesis. The regulatory picture (MQSA, FDA labelling, Germany's §127, IHE) is
`docs/av1/visually-lossless.md` §1 on branch `claude/av1-visually-lossless`, read 2026-11-02 and not re-read here.

## 1. How VL and acceptable lossy compression are established

### Three kinds of claim, three kinds of test

The ESR position paper separates them: "irreversible compression may be used without producing perceptually visible
differences ("visually lossless"), and/or without producing differences that affect diagnostic performance
("diagnostically lossless")". It names the tests: "Objective methods to determine the best compression ratio are
studies based on comparing diagnostic performance (accuracy) using compressed and original images. The ability of a
human observer to detect the difference between compressed and original images can also be tested objectively"
[ESR]. And it warns that the two do not coincide: "There is evidence that despite obvious visual degradation from
irreversible compression, high performance equivalent to that on uncompressed images can be achieved for some
modalities, body parts and diagnostic tasks" [ESR].

* **Diagnostic accuracy** — ROC and its free-response and localization forms. FFDM at JPEG 2000 80:1, six readers,
  "Data were analyzed using the jackknife alternative free-response ROC (JAFROC) method" [Kovacs 2015, abstract];
  digitized mammograms, five readers, "free-response receiver operating characteristic (FROC) data acquisition
  paradigm" [Penedo 2005, abstract]; simulated lesions on FFDM, "six-point rating scale, and receiver operating
  characteristic (ROC) analysis" [Suryanarayanan 2005, abstract]. ESR asks such studies to state "whether a formal
  multi-reader multi-case (MRMC) analysis" was used and their power: "The failure to detect a statistical difference
  between uncompressed and compressed images does not necessarily mean that there is no clinically significant
  difference" [ESR].
* **Visibility (the VL threshold, VLT)** — the reader sees exact and lossy and answers "differ" or "same":
  * *Alternation without a blank* is the most sensitive presentation measured: of alternation without a blank,
    alternation with a blank and side by side, "AWOB yields lower fidelity grade and requires less fidelity grading
    time than AWB or SSD, indicating that AWOB is most sensitive to image differences among of them"
    [Kim B 2011, abstract]. Erickson's multicentre study used "a flicker mode paradigm in which observers rapidly
    toggled between two images, the original and a compressed version", and says "presentation of images using the
    "flicker" technique is probably the most sensitive method for human observers to detect differences" [Erickson 2010].
  * *Per image, by staircase*: "Five radiologists independently determined the VLT of each image for JPEG2000
    compression by using the QUEST algorithm" [Kim KJ 2013, abstract], and the threshold varies with content —
    "variation in HF energy and visual complexity were the most promising in predicting the VLTs" (same).
  * *Pooled to a psychometric function*: "A threshold CR for each image, at which 50% of radiologists would detect
    compression artifacts, was estimated by fitting a psychometric function" [Kim KJ 2010 SPIE].
  * *JND rating*: the Canadian study behind the CAR's ratios used "two recognized techniques: objective methods or
    diagnostic accuracy and subjective assessment based on Just Noticeable Difference" [Koff 2009, abstract].
* **The industry's standard for VL is the same test.** JPEG's AIC work items are "ISO/IEC 29170-2:2015 : Evaluation
  procedure for nearly lossless coding" with "Amendment 1: Evaluation procedure parameters for nearly lossless coding
  of high dynamic range media and image sequences", and "ISO/IEC 29170-3:2026 : Subjective quality assessment of
  high-fidelity images" [JPEG AIC]. The AIC-3 method "uses boosting techniques on visual stimuli to help observers
  detect compression artifacts more clearly", then "reconstructs quality scale values in just noticeable difference
  (JND) units" [Testolina 2024, abstract]. The text of ISO/IEC 29170-2 (the flicker procedure, its timing and pass
  rule) was not reachable (iso.org refused, 403): *unverified* beyond its title.

*Derived:* in every case, VL is a property a reader test establishes per image; a metric enters only as a predictor
calibrated against such a test.

### How the guidelines express limits

| source (read) | binds? | form of the limit | metric named | breast: mammography / DBT / ultrasound |
| --- | --- | --- | --- | --- |
| DICOM PS3.5 2026d | — | **none** | none | none |
| ACR–AAPM–SIIM technical standard (rev. 2022) | advisory | **none**; a physician selects and reviews | PSNR, as what FDA asks manufacturers to submit | FDA bars lossy mammograms; priors allowed |
| CAR standard (2008, rev. 2011) | advisory | **compression ratio** per modality and region | none found | standard not reachable; its study tested mammography and breast US |
| RCR 2008 | withdrawn 2018 | compression ratio | — | 20:1 mammography, per RANZCR |
| ESR position paper (2011) | advisory | **ratios** collated from others; proposes a metric framework | PSNR after windowing, per resolution and ROI | mammography row in its ratio table |
| RANZCR v2 (2020) | advisory | ratios, "justifiable on the basis of prior published trial evidence" | "no consensus" | — |

* **DICOM** leaves both the decision and the parameters to others, codec by codec: "The context where the usage of
  lossy compression of medical images is clinically acceptable is beyond the scope of the DICOM Standard. The
  policies associated with the selection of appropriate compression parameters (e.g., compression ratio) for JPEG
  2000 lossy compression are also beyond the scope of this Standard." — the same for JPEG, JPEG-LS near-lossless,
  MPEG-2, H.264, HTJ2K and JPEG XL; "MPEG2 compression is inherently lossy." [PS3.5 §8.2]. PS3.5 has no AV1.
* **ACR–AAPM–SIIM**: "Irreversible compression may be used to reduce transmission time or storage space only if the
  quality of the result is sufficient to reliably perform the clinical task." DAIC "may be used under the direction of
  a qualified physician with no reduction in clinical diagnostic performance … From a practical perspective, this
  means that any artifacts generated by the compression scheme should not be perceptible by the human viewer or are
  at such a low level that they do not interfere with interpretation." "The ACR and this technical standard make no
  general statement on the type or amount of compression that is appropriate to any modality, disease, or clinical
  application", and the physician reviews it periodically, "always considering that it may be difficult to evaluate
  the impact on observer performance objectively and reliably". On FDA: "The FDA does not allow irreversible
  compression of digital mammograms for retention, transmission, or final interpretation, although irreversibly
  compressed images from prior studies may be used for comparison purposes"; "For other modalities, the FDA does not
  restrict the use of compression, but it does require manufacturers of devices that use irreversible compression to
  submit data on the impact of the compression on quantitative metrics of image quality (such as peak signal-to-noise
  ratio (PSNR)" [ACR]. It also requires "Preset window/level settings (eg, bone or lung windows using set lookup table
  (LUT) transformations)" in the viewer (same) — but ties no compression test to them.
* **CAR**: the standard's own text could not be fetched (car.ca lists no compression standard; the 2011 PDF path
  returns 404): *unverified*. Its study: "We provide a table of recommended compression ratios for each modality and
  anatomical area investigated, to be integrated in the Canadian Association of Radiologists standard"; "More
  evaluation is required to assess the effect of compression on thin slice CT" [Koff 2009, abstract]. The breast
  ratios themselves (US 8–12, MG 15–25) are as `visually-lossless.md` §1 read them from Koff 2013's table; not
  re-read here.
* **RCR**, through RANZCR: "The RCR has subsequently withdrawn, and not replaced, its guidance on image compression";
  RANZCR names "ratios of 20:1 and 15:1" for mammograms (RCR and the German society) [RANZCR].
* **ESR** collates "Medically acceptable compression ratios" and adds "There will be no new or modified
  recommendations based on this ESR initiative" [ESR]; what it adds is the metric framework of §2.
* **RANZCR**: "There remains considerable uncertainty as to the best metric for describing the quality of lossy
  compression. The compression ratio is widely used because it is readily available … However, it correlates poorly
  with measures of image quality. Other measures, such as 'Peak Signal to Noise Ratio' and 'Structural Similarity'
  have been tested, but there is no consensus on the most useful tool"; "Where higher compression ratios are used,
  these must be justifiable on the basis of prior published trial evidence"; on 3D, "lossy compression produces
  visible difference in 3D images at relatively low compression ratios, though it is as yet unclear whether these
  have adverse effects on diagnostic performance". It also describes this product's shape: the radiologist "may make
  judicious use of appropriate levels of lossy image compression to speed the initial arrival of the images … the
  practice should make the original images available for subsequent download as required" [RANZCR].

**So: guidelines state limits as compression ratios or as nothing; none as a metric.** The ESR proposes one (PSNR
after the viewing transform) and gives no threshold for it; the ACR names PSNR only as what FDA collects.

### Breast, by readers

* **FFDM**: JAFROC, "There was no difference in the JAFROC figure of merit between lossy-compressed and
  non-lossy-compressed images" at JPEG 2000 80:1 [Kovacs 2015, abstract]. Simulated lesions: "detection of
  microcalcifications was significantly reduced with a compression ratio of more than 15:1" (wavelet) [Suryanarayanan
  2005, abstract].
* **Digitized film**: FROC, "lossy compression of digital mammographic data at 80:1 with JPEG2000 or the object-based
  SPIHT algorithm can be performed without decreasing the rate of detection" [Penedo 2005, abstract]; metric-based,
  "a visually lossless CR threshold, estimated to be between 25:1 and 40:1 for the dataset analyzed" [Georgiev 2013,
  abstract].
* **3D whole-breast ultrasound** (JPEG 2000, JPEG 3D, HEVC): "At 5:1 compression, radiologists could not distinguish
  compressed images from originals, and diagnostic performance was unaffected (AUC > 0.85 for all readers). Even at
  an average 20:1 compression ratio, no significant degradation in diagnostic accuracy was observed"; quality
  "assessed using PSNR and SSIM" [Huang 2026, abstract].
* **Ultrasound video**, HEVC: "a diagnostically reliable compressed ultrasound video can be obtained for compression
  with values of the quantization parameter up to 35"; "the visual information fidelity, structural similarity index,
  and universal quality index metrics show good correlation with the subjective scores provided by medical experts"
  [Razaak 2014, abstract]. Netflix's VMAF does not carry over: "VMAF outperforms other state-of-the-art VQMs in the
  context of WCE videos, but this is not the case for medical ultrasound videos" [Usman 2019, abstract].
* **DBT: no reader study of lossy compression was found** (PubMed "tomosynthesis AND (lossy OR irreversible) AND
  compression": no records, 2026-11-09; a web search found lossless DBT work only). **None of AV1 on any medical
  image either.**

## 2. Objective metrics, their failure modes, and which were validated against readers

### Validated against readers, on medical images

| metric | images, codec | readers' task | what the paper says | source |
| --- | --- | --- | --- | --- |
| CR, PSNR, HDR-VDP | 250 body CT, JPEG 2000 | distinguishable or not, alternating | AUC 0.87, 0.93, 0.97; "the CR is less suitable than the PSNR or HDR-VDP … The HDR-VDP is more promising than the PSNR" | Kim KJ 2009, abstract |
| PSNR, HDR-VDP, MS-SSIM | 300 abdomen CT, JPEG 2000 | same | Spearman 0.86, 0.94, 0.86; "the HDR-VDP outperforms the PSNR and MS-SSIM, and the MS-SSIM and PSNR are comparable" | Kim KJ 2010 TMI, abstract |
| PSNR, HDR-VDP | 100 chest CT | same | VLT predicted for "69% and 72% of the 100 images (p = 0.68)" | Kim B 2008 AJR, abstract |
| PSNR, HDR-VDP | 120 thin + 120 thick abdomen CT | same | VLT predicted for "124 (51.7%) and 183 (76.3%) images" when thin and thick are pooled | Kim B 2008 Acad Radiol, abstract |
| HDR-VDP calibrated on CT | 240 CT, JPEG 2000 | same, psychometric fit | "calibrated for the CT image data gave much better predictions than the HDR-VDP calibrated to the basic psychophysical data" | Kim KJ 2010 SPIE |
| PSNR, HDR-VDP, image-feature model | 206 body CT, QUEST VLT | per-image VLT | ICC 0.85, 0.84, 0.88 | Nam 2018, abstract |
| MSE, MAE, PSNR, SSIM (8 metrics) | digitized mammogram ROIs, JPEG 2000 | 5-point rating | r 0.825, 0.823, −0.825, −0.826 | Georgiev 2013, abstract |
| SSIM, MSE/PSNR, CR, JPEG Q | CT windowed to 8 bits, JPEG and JPEG 2000 | radiologists' acceptability | "SSIM demonstrates the best performance"; "compression ratio is not always a good indicator" | Kowalik-Urbaniak 2014 |
| visual discrimination model (JND), PSNR, SSIM | breast-biopsy virtual slides, JPEG 2000 | VLT by observers | at the VLT, JND metrics "nearly constant … and were significantly less variable than" PSNR and SSIM | Johnson 2011, abstract |
| VIF, SSIM, UQI and four more | ultrasound video, HEVC | experts' scores | VIF, SSIM, UQI "show good correlation" | Razaak 2014, abstract |
| VMAF | ultrasound video, HEVC | experts' scores | not the best on ultrasound | Usman 2019, abstract |

**Not found validated against readers on medical images:** ColorVideoVDP and its JOD; HDR-VDP-3; any metric on DBT,
on 10–12-bit video, on inter-coded stacks or on AV1. A web search for ColorVideoVDP or HDR-VDP with radiology
readers after 2010 found none (2026-11-09).

### Compression ratio

"compressed file size, compressed bit rate, and the reciprocal of the compression ratio are all measures of quality
that clearly satisfy the first property [monotone in file size], but they clearly do not satisfy the other three
properties" [ESR]. On CT: "exposure, slice thickness, and reconstruction filters have a significant impact on image
compressibility due to an increased high frequency content and a lower acquisition signal-to-noise ratio. We also
show that compression ratio is not a good fidelity measure. Therefore, guidelines based on compression ratio should
ideally be replaced with other compression measures better correlated with image fidelity" [Pambrun 2015, abstract].
Its failure mode is content and noise: thin (noisier) CT sections are "less tolerant of compression" [Woo 2007,
abstract].

### PSNR

* **Definition and peak.** "PSNR is equivalent to the MSE between the original and compressed images, normalized with
  respect to the largest dynamic range that can be represented within the sample data bit-depth and converted to the
  log domain. There is nothing special about PSNR and it may not correlate well with visual quality" [ESR]. The peak
  is the representable range (for N bits, "R = 2^N − 1" [Kowalik-Urbaniak 2014]), not the range used: ESR notes that
  where "the maximum pixel grey value in the image effectively is not in the bit layer defined through the DICOM bits
  stored", the input has "empty bit layers" [ESR]. *Derived:* at 12 bits the peak is 4 095; a series that occupies a
  fraction of it reads a PSNR higher by 20 log10 of the inverse of that fraction, for the same error.
* **Global pooling.** "a single measure of quality inevitably pools evidence from across the image. This pooling
  process may allow the entire image to pass an acceptability test even though a specific ROI might not pass the
  test" [ESR].
* **Blind to masking, and so to noise and to the window.** On low-dose chest CT, "The results of PSNR indicated greater
  artifacts in the lungs (p < 0.001), whereas HDR-VDP results indicated fewer artifacts in the lungs"; "radiologists'
  artifact perceptions are the opposite, which can be successfully reproduced by HDR-VDP" [Kim KJ 2008, abstract].
  Pooled over thin and thick sections, PSNR's VLT prediction fell to 51.7 % against HDR-VDP's 76.3 % [Kim B 2008 Acad
  Radiol, abstract]: one PSNR cut-off does not hold across noise levels.
* **Its standing.** ESR: PSNR and MSE "have been shown to be not well correlated with visual or diagnostic
  performance", yet "Despite its short-comings, PSNR is superior to compression ratio as an image quality metric. PSNR
  can be made to satisfy all of the properties identified in the previous section" [ESR]. A 2025 review: "PSNR and
  SSIM have neither been targeted nor properly tested for medical images" [Breger 2025].

### PSNR, or error, in display units after windowing

ESR's required property: "The metric should have the ability to be evaluated on the decompressed image after it has
been subjected to one or more diagnostic viewing transformations. These transformations would typically be windowing
functions that are commonly used with the radiological investigation in question … viewing transformations should be
expressed with respect to a notional display device in which the transformed data are rendered as black when 0 and
maximally bright when 1, with a prescribed display gamma function—for that, a gamma value of one-third would seem
appropriate". Its workflow, per resolution R, viewing transformation X and ROI G: "Apply viewing transformation X to
each image—note that this leaves the image samples with floating-point values with a nominal range from 0 to 1";
"Evaluate the MSE between the transformed compressed and uncompressed images over each ROI G and also over the whole
image"; "Compute the PSNR from 10 × log10(1/MSE)"; "Compare each calculated PSNR at resolution R against the
acceptability threshold T R established for that resolution" — thresholds to come from trial data, none given [ESR].
Lundström's vPSNR is built on the same need: "The visualization transform has a significant impact on diagnostic
quality, and the vPSNR is capable of representing this effect" [Lundström 2013, abstract].

### Maximum absolute error, near-lossless bounds

DICOM's JPEG-LS near-lossless transfer syntax: "In this mode, the absolute error between the source and reconstructed
images will be constrained to a finite value that is conveyed in the compressed bit stream" [PS3.5 §A]. ESR: its
"near-lossless" mode "(intended to be used to achieve a "visually lossless" result) has not been well studied"
[ESR]. Mean absolute error, not maximum, is the one tested against readers above [Georgiev 2013]. **No source read
gives a maximum error a reader cannot see.**

### SSIM and MS-SSIM

SSIM's constants scale with "L is the dynamic range of the pixel values (255 for 8-bit grayscale images)" [Wang
2004], so the same peak question as PSNR's applies. MS-SSIM exists because "the right scale depends on viewing
conditions (e.g., display resolution and viewing distance)", and was calibrated at "32 pixels per degree of visual
angle" [Wang 2003]. A CT study of SSIM's limits for diagnostic imaging (Pambrun and Noumeir, ICIP 2015) was not read: *unverified*.
Kowalik-Urbaniak's SSIM win was on images "first windowed according to their default viewing parameters
(window width and window centre) in order to reduce their bit-depth from 16 to 8 bits" [Kowalik-Urbaniak 2014].

### Visibility models: HDR-VDP, ColorVideoVDP (JOD)

HDR-VDP is the one metric that beat PSNR against radiologists, on JPEG 2000 CT (table above), and did best once
"calibrated for the CT image data" [Kim KJ 2010 SPIE]; there the display was "calibrated according to the Digital
Imaging and Communications in Medicine part 14 (Grayscale Standard Display Function)", "Luminance 0.42- 398.3
cd/m2", and the metric saw the same window as the readers: "The same window setting values were applied to convert
the images to 8-bit images in calculating the HDR-VDP to reproduce the display in the human visual analysis" (same).
Its successor HDR-VDP-3 can predict "visual differences between a pair of images" [Mantiuk 2023, abstract].

ColorVideoVDP "models spatial and temporal aspects of vision"; "It was trained to predict common video streaming
distortions (e.g. video compression, rescaling, and transmission errors)" and AR/VR display artefacts [Mantiuk 2024,
abstract]. Its unit is not a detection threshold: "The highest quality (no difference) is reported as 10"; "if method
A produces a video with the quality score of 8 JOD and method B gives the quality score of 9 JOD, it means that 75% of
the population will choose method B over A" [cvvdp README]. *Derived:* a JOD is a preference step on natural video,
not the JND of a flicker test, and no medical validation of it was found.

### Noise-relative criteria

* **Readers.** Noise drives tolerance: "Several groups have previously reported that thin-slice CT is less compressible
  than thick slice, primarily due to noise" and "other factors (e.g., image noise) had a more significant impact on
  compressibility" [Erickson 2010]. And compression's smoothing can help: "the smoothing of the noise in irreversibly
  compressed images can improve performance (and ideally should be factored out as a separate processing step from
  compression …)" [ESR]; "at these lower compression ratios, the primary effect is to reduce noise" [Erickson 2010].
* **A stated bound, outside radiology.** The "virtually lossless" protocol of remote sensing: "any compression-induced
  distortion should appear as a negligible additional amount of noise that is statistically independent of the
  intrinsic noise of the data"; the error PDF should be "peaked and narrow … without tails … whenever the user-defined
  MAD is sufficiently smaller than the standard deviation σn of the background noise"; and "MSE has to be lower by one
  order of magnitude (i.e., it has to be less than 0.1 times, or more than 10 dB lower) with respect to the variance
  of background noise σn²" [Aiazzi 2012]. Not validated against human readers.

## 3. How studies treat windowing

* **At one clinical window, the common case.** HDR-VDP's calibration: "the window center and width were set as 20 and
  400 HU which were the default values in our clinical practice" [Kim KJ 2010 SPIE]; Kowalik-Urbaniak at "their
  default viewing parameters" [2014]; a 3D JPEG 2000 study "fixed the minimum window width at 350 and focused on
  diagnosis" (as Erickson 2010 describes it).
* **At the clinical presets, reader's choice — and readers choose the narrowest.** Erickson offered "lung (1500/−700),
  abdomen (350/40), bone (1500, 400), and liver (70/30)"; "Observers also quickly found that liver settings were most
  sensitive to compression-related changes and, thus, reviewed most images with that setting. … if we allowed complete
  control of window width, the observers could set the width to 1 and make detection of changes quite easy. Fixing the
  width to a typical abdomen setting like 400 will make the changes much less obvious. We decided to permit a narrow
  "liver" width for this study because it is occasionally used in the clinical realm" [Erickson 2010]. Result: "77.46%
  of observers detecting differences at 8:1" (same).
* **Window widening masks.** "We have studied the effect of value-of-interest transformation and found significant
  masking of artifacts when window is widened" [Pambrun 2015, abstract].
* **At the worst-case window: no study found.** Erickson names width 1 and declines it; no study read evaluates at
  the narrowest window a viewer allows. Mammography and ultrasound abstracts above do not state the window.

## 4. What it implies here (synthesis)

Everything in this section is *derived* from §1–3 and from `lab/av1/metrics/README.md`.

### Is PSNR the right metric to claim VL?

No, not alone, for three reasons the sources give: its peak is the representable range, so at 12 bits it rises with
headroom the series does not use (ESR's empty bit layers); it pools the frame, so a region can fail while the frame
passes (ESR); and it is blind to masking by noise and to the window, which readers are not (Kim KJ 2008; Pambrun
2015). It stays worth reporting: it tracked readers about as well as MS-SSIM on CT, ESR calls it "superior to
compression ratio", and FDA collects it (ACR). Its windowed form — ESR's PSNR after the viewing transform on a 0…1
display scale — is the variant the sources ask for.

Why the window matters, in this repo's units: a linear window maps W stored units to 256 displayed levels, so one
level is W ÷ 256 units and an error of e units moves the picture by about 256 e ÷ W levels. Before ESR's display gamma, its
windowed PSNR is therefore the in-window PSNR plus 20 log10(peak ÷ W). The **ratio e_N ÷ σ is the same under every linear window**
(both scale by 256 ÷ W), except where the window clips; what a window changes is *which* samples are in view, and
how many displayed levels the noise itself spans. At σ 10–18 (DBT systems A and C), any window narrower than about
256 σ (2 600–4 600 units) already spreads the frame's own noise over more than one displayed level — which is
consistent with the quality study's finding that no rung, not even Q 1, keeps every displayed level within 1.

### What the quality study already measures, and against what

| measure in `lab/av1/metrics` (§4) | what the sources say of it |
| --- | --- |
| e_N ÷ σ, the coding error against the frame's own noise, fine band | noise sets tolerance (Erickson, Woo); the only stated bound is remote sensing's MSE < 0.1 σ², i.e. e < 0.32 σ, about 10 dB tighter than the study's anchor e_N ≤ σ; no reader validation in medicine |
| PSNR at peak 2^b − 1, and MSE over in-window samples | the sources' baseline; validated on CT at one window; fails across noise levels and regions |
| displayed-level moves, per header window (`NORMAL`, `HARDER`, `SOFTER`) | ESR's "diagnostic viewing transformations", at the presets |
| max \|Δ\| | the near-lossless bound DICOM defines; no visibility threshold exists for it |
| SSIM, MS-SSIM at L = peak | validated on CT (MS-SSIM ≈ PSNR) and digitized mammograms; scale-dependent |
| ColorVideoVDP JOD, first window, GSDF luminance, 15 slices/s | the model family that beat PSNR (HDR-VDP), but this model and its unit are not validated on medical images |
| §6 flicker test (described, not run) | the method the literature and ISO/IEC 29170 use to establish VL |

### What it lacks, against the sources

1. **A narrow and a worst-case window.** Every measure is at the header presets. Readers choose the narrowest preset
   (Erickson), widening masks (Pambrun), and the product lets a reader narrow further. Report the displayed-level
   moves, the windowed PSNR and the JOD also at the narrowest window the viewer allows, centred where the frame's
   in-window error is largest.
2. **Windowed PSNR in ESR's form**, per window, beside the in-window PSNR, so the numbers line up with the one metric
   framework a society proposed.
3. **Local pooling.** ESR asks for ROIs; the study pools a frame. A tile-wise worst (say the worst 64 × 64 tile's e_N
   ÷ σ and PSNR) catches the region that fails while the frame passes.
4. **e_N ÷ σ by intensity band.** A narrow window shows one intensity band; σ and the coding error both vary with
   intensity on DBT. Reporting e_N ÷ σ within each window's in-window samples (not only the first window's) ties the
   noise anchor to what a narrowly windowed reader sees.
5. **The tail of the error.** Remote sensing's criterion asks for an error without tails (small MAD ÷ RMSE); the study
   reports max |Δ| and percentiles, not the ratio.
6. **A visibility model calibrated on readers.** JOD is a preference unit on natural video; HDR-VDP was calibrated on
   CT readers. Neither has been calibrated on DBT.
7. **Readers.** Nothing above makes a rung VL; only the flicker test does. Run §6 at the header presets *and* at the
   narrow window, with catch trials, alternation without a blank, on a GSDF-calibrated display at 1:1 pixels, per
   image (the VLT varies with content, Kim KJ 2013), and for DBT, which no published reader study covers.

### What a VL claim here could honestly say

At most: "at Q, on these series, the coding error stays within the frame's own noise and under the stated windows the
metrics a reader study has validated on CT read as indistinguishable; readers have / have not confirmed it at these
windows". Until §6 runs, the claim is a metric's, not a reader's. For mammography and DBT in the US the lossy view is
in any case not the frame interpreted from (`visually-lossless.md` §1).

## Sources

All read 2026-11-09 unless marked. *Abstract*: the paper's own abstract, from PubMed, full text not reachable
(publisher or PMC page refused automated reading).

**Standards and guidelines**

* [PS3.5] DICOM PS3.5 2026d, §8.2 and Annex A. https://dicom.nema.org/medical/dicom/current/output/html/part05.html
* [PS3.14] DICOM PS3.14 2026d, ch. 3 (JND: "The Luminance difference of a given target under given viewing conditions
  that the average human observer can just perceive"). https://dicom.nema.org/medical/dicom/current/output/html/part14.html
* [ACR] ACR–AAPM–SIIM Technical Standard for Electronic Practice of Medical Imaging, revised 2022 (Resolution 41f),
  §B Compression. https://gravitas.acr.org/PPTS/DownloadPreviewDocument?DocId=136
* [ESR] European Society of Radiology, Usability of irreversible image compression in radiological imaging, Insights
  Imaging 2(2), 2011. doi:10.1007/s13244-011-0071-x (full text, Europe PMC PMC3259360).
* [RANZCR] Guideline for the Use of Image Compression in Diagnostic Imaging, Version 2, 13 August 2020.
  https://www.ranzcr.com/college/document-library/a-guideline-for-the-use-of-image-compression-in-diagnostic-imaging
* [JPEG AIC] JPEG AIC workplan. https://jpeg.org/aic/workplan.html. ISO/IEC 29170-2:2015 itself: not reachable
  (iso.org 403), *unverified*.
* CAR, Standards for Irreversible Compression in Digital Diagnostic Imaging within Radiology (2008, rev. 2011): not
  reachable (car.ca, 404 and absent from its guideline list), *unverified*. RCR 2008: withdrawn; read through RANZCR.

**Reader studies and metric validation**

* [Koff 2009] Koff D et al., J Digit Imaging 22(6):569–578, 2009. doi:10.1007/s10278-008-9139-7. Abstract.
* [Erickson 2010] Erickson BJ, Krupinski E, Andriole KP, J Digit Imaging 23(5):639–643, 2010.
  doi:10.1007/s10278-009-9221-9 (full text, Europe PMC PMC2950269).
* [Kim B 2011] Kim B et al., Med Phys 38(2):836–844, 2011. doi:10.1118/1.3538925. Abstract.
* [Kim KJ 2013] Kim KJ et al., Radiology 268(3):710–718, 2013. doi:10.1148/radiol.13122015. Abstract.
* [Kim KJ 2010 SPIE] Kim KJ, Mantiuk R, Lee KH, Heidrich W, Calibration of the visual difference predictor for
  estimating visibility of JPEG2000 compression artifacts in CT images, Proc SPIE 7527, 2010. doi:10.1117/12.845292
  (author PDF, https://www.cl.cam.ac.uk/~rkm38/pdfs/kim10chdrvdp.pdf).
* [Kim KJ 2009] Kim KJ et al., Med Phys 36(7):3218–3226, 2009. doi:10.1118/1.3129159. Abstract.
* [Kim KJ 2010 TMI] Kim KJ et al., IEEE Trans Med Imaging 29(8):1496–1503, 2010. doi:10.1109/TMI.2010.2049655. Abstract.
* [Kim B 2008 AJR] Kim B et al., AJR 190(2):328–334, 2008. doi:10.2214/AJR.07.2502. Abstract.
* [Kim B 2008 Acad Radiol] Kim B et al., Acad Radiol 15(3):314–325, 2008. doi:10.1016/j.acra.2007.10.018. Abstract.
* [Kim KJ 2008] Kim KJ et al., AJR 191(2):W30–W37, 2008. doi:10.2214/AJR.07.3462. Abstract.
* [Woo 2007] Woo HS et al., AJR 189(3):535–541, 2007. doi:10.2214/AJR.07.2304. Abstract.
* [Nam 2018] Nam CM et al., BMC Med Imaging 18(1):53, 2018. doi:10.1186/s12880-017-0244-2. Abstract.
* [Pambrun 2015] Pambrun JF, Noumeir R, J Digit Imaging 28(6):636–645, 2015. doi:10.1007/s10278-015-9791-7. Abstract.
* [Lundström 2013] Lundström C, Int J CARS 8(3):437–450, 2013. doi:10.1007/s11548-012-0792-4. Abstract.
* [Kowalik-Urbaniak 2014] Kowalik-Urbaniak I et al., Proc SPIE 9037, 2014 (author PDF,
  https://ece.uwaterloo.ca/~z70wang/publications/spie14.pdf).
* [Johnson 2011] Johnson JP et al., IEEE Trans Med Imaging 30(2):306–314, 2011. doi:10.1109/TMI.2010.2077308. Abstract.
* [Georgiev 2013] Georgiev VT et al., J Digit Imaging 26(3):427–439, 2013. doi:10.1007/s10278-012-9538-7. Abstract.
* [Kovacs 2015] Kovacs MD et al., AJR 204(3):570–575, 2015. doi:10.2214/AJR.14.12912. Abstract.
* [Suryanarayanan 2005] Suryanarayanan S et al., Radiology 236(1):31–36, 2005. doi:10.1148/radiol.2361040741. Abstract.
* [Penedo 2005] Penedo M et al., Radiology 237(2):450–457, 2005. doi:10.1148/radiol.2372040996. Abstract.
* [Huang 2026] Huang Z et al., J Imaging Inform Med, online 27 February 2026. doi:10.1007/s10278-025-01735-9. Abstract.
* [Razaak 2014] Razaak M, Martini MG, Savino K, IEEE JBHI 18(5):1552–1559, 2014. doi:10.1109/JBHI.2014.2326891. Abstract.
* [Usman 2019] Usman MA, Martini MG, Comput Biol Med 113:103383, 2019. doi:10.1016/j.compbiomed.2019.103383. Abstract.
* [Breger 2025] Breger A et al., J Imaging Inform Med 38(6):3444–3469, 2025. doi:10.1007/s10278-025-01462-1 (preprint
  full text, arXiv:2405.19097v4).
* Pambrun JF, Noumeir R, Limitations of the SSIM quality metric in the context of diagnostic imaging, ICIP 2015,
  2960–2963. doi:10.1109/ICIP.2015.7351345. Not read; *unverified*.

**Metrics and models**

* [Wang 2004] Wang Z et al., IEEE TIP 13(4):600–612, 2004. doi:10.1109/TIP.2003.819861 (author PDF,
  https://ece.uwaterloo.ca/~z70wang/publications/ssim.pdf).
* [Wang 2003] Wang Z, Simoncelli EP, Bovik AC, Multi-scale structural similarity for image quality assessment,
  Asilomar 2003. doi:10.1109/ACSSC.2003.1292216 (author PDF, https://ece.uwaterloo.ca/~z70wang/publications/msssim.pdf).
* [Mantiuk 2023] Mantiuk RK, Hammou D, Hanji P, HDR-VDP-3, arXiv:2304.13625. Abstract.
* [Mantiuk 2024] Mantiuk RK et al., ColorVideoVDP: A visual difference predictor for image, video and display distortions, arXiv:2401.11485v2. Abstract.
* [cvvdp README] https://github.com/gfxdisp/ColorVideoVDP, README, main branch.
* [Testolina 2024] Fine-grained subjective visual quality assessment for high-fidelity compressed images,
  arXiv:2410.09501. Abstract.
* [Aiazzi 2012] Aiazzi B, Alparone L, Baronti S, Lastri C, Selva M, Spectral distortion in lossy compression of
  hyperspectral data, J Electr Comput Eng 2012:850637. doi:10.1155/2012/850637 (full text,
  https://flore.unifi.it/retrieve/e398c37a-5a39-179a-e053-3705fe0a4cff/850637.pdf).
