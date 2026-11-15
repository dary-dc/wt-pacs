# Lossy viewing: what binds it, and what it may be measured against

The owner is weighing role-based quality profiles: most roles scroll a cine-like breast series (DBT slices, breast
ultrasound cine, ABUS, ≤ 12 bits) as a lossy, "visually lossless" AV1 stream, and some roles ask for the exact frame.
A profiles study (branch `claude/av1-quality-profiles`) is to report bytes against PSNR, max |Δ|, SSIM and windowed
error per quantizer. This page gathers what the owner's operating point may be measured against. It is theory only,
read 2026-11-02, and it sets **no threshold of its own**.

Every quote is verbatim from the source named, read on that date. *Derived* marks this page's own reading of a source;
*unverified* marks a claim whose primary text was not read (a dead link, a paywall, a search snippet, a secondary
quotation). The product's exact path is unchanged by anything here: the rule in [`README.md`](README.md) stays that
every frame ends bit-exact, and §Preview there is where a lossy picture was measured.

## 1. Who defines acceptable lossy compression, and whether it binds this viewer

The viewer in question shows lossy frames by default and the exact frame on request; the store keeps the exact frames.
For each source: what it says, and whether it binds that viewer (*derived* in each case, unless the source says it).

### DICOM — leaves acceptability to others, and marks a lossy image for good

PS3.5 2026d §8.2.4 (JPEG 2000), and the same sentence in §8.2.1 (JPEG), §8.2.3 (JPEG-LS), §8.2.5–8.2.8 (MPEG-2,
H.264), §8.2.14 (HTJ2K) and §8.2.15 (JPEG XL):

> "The context where the usage of lossy compression of medical images is clinically acceptable is beyond the scope of
> the DICOM Standard. The policies associated with the selection of appropriate compression parameters (e.g.,
> compression ratio) for JPEG 2000 lossy compression are also beyond the scope of this Standard."

For the video syntaxes it adds "MPEG2 compression is inherently lossy." / "MPEG-4 AVC/H.264 compression / High Profile
compression is inherently lossy." PS3.3 2026d C.7.6.1.1.5:

> "Once this Attribute has been set to a Value of "01" it shall not be reset."
>
> "If an image is a compressed version of another image, Lossy Image Compression (0028,2110) is set to "01", Value 1 of
> the Attribute Image Type (0008,0008) shall be set to DERIVED, and if the predecessor was a DICOM image, then the Image
> shall receive a new SOP Instance UID."

The attribute is Type 1 in the DX Image Module (C.8.11.3), which the Digital Mammography X-Ray Image IOD includes
(A.27.3), and in the X-Ray 3D Image Module (C.8.21.1), which the Breast Tomosynthesis Image IOD includes (A.55.3); Type
1C in the US Image Module (C.8.5.6), "Required if Lossy Compression has been performed on the Image." The defined terms
for Lossy Image Compression Method (0028,2114) list JPEG, JPEG-LS near-lossless, JPEG 2000, HTJ2K, JPEG XL, MPEG-2,
H.264 and HEVC; **no AV1** (and no AV1 transfer syntax, [`README.md`](README.md) §DICOM standing).

*Binds the viewer?* No threshold to bind. *Derived:* the lossy AV1 stream is not a DICOM object, so the marking rules
bind it only if a lossy frame is ever exported as DICOM — then as a new, DERIVED instance flagged "01".

### United States — FDA under MQSA: binding for mammography and DBT

The 2023 MQSA final rule, 88 FR 15126 (10 March 2023), Response 100:

> "Because lossless compression permits complete reconstruction of the image data, images undergoing such compression
> would be generally considered to be ''original'' mammograms for the purposes of § 900.12(c)(4). In contrast, images
> that have undergone lossy compression, which does not maintain all of the data related to the mammogram image files,
> would generally not be considered to be ''original'' mammograms for the purposes of § 900.12(c)(4)."
>
> "we do not believe there is consensus on what loss of information is acceptable while maintaining the standards to be
> able to review and/or transfer the original mammogram images as required in the regulations."

FDA, *MQSA … Small Entity Compliance Guide* (26 August 2024; it "Contains Nonbinding Recommendations", but restates the
regulation it cites):

> "FFDM and DBT mammographic images must be retained in their original mammographic modality. (21 CFR 900.12(c)(4)(i))."
>
> "Can facilities store or transfer digital mammographic images using lossy compression as of the effective date of the
> regulations? No."

FDA, *Display Devices for Diagnostic Radiology* (28 September 2022), §VIII Labeling, recommended labeling for review
displays intended for mammography:

> "Mammographic images with lossy compression must not be reviewed for primary image interpretations."

Cleared PACS 510(k)s carry it, e.g. K222781: "Lossy compressed images and digitized film screens of mammographic images
must not be reviewed for primary image interpretations." 21 CFR 892.2050 itself carries no lossy text. FDA's
2000 premarket guidance for image management devices, cited by ACR (below) for a display label, was not read
(*unverified*); the MQSA Policy Guidance Help System was discontinued on 10 September 2024 and its lossy entries are
gone (*unverified*).

*Binds the viewer?* **Yes, for FFDM and DBT in the US.** *Derived:* storage is unaffected (the store is exact), but a
lossy DBT or mammography frame shown by default may not be the frame a radiologist interprets from; the interpreting
role must get the exact frame, and a device sold for mammography review carries the labeling above. Priors are the one
lossy use the ACR records as allowed (next). Breast ultrasound and ABUS are not mammography; MQSA's scope was not read
against 21 CFR 900.2 (*unverified*), and no FDA text read here limits lossy ultrasound.

### United States — ACR–AAPM–SIIM: advisory

*Technical Standard for Electronic Practice of Medical Imaging*, revised 2022 (it does "not establish a legal standard
of care"):

> "Irreversible compression may be used to reduce transmission time or storage space only if the quality of the result
> is sufficient to reliably perform the clinical task."
>
> "DAIC may be used under the direction of a qualified physician with no reduction in clinical diagnostic performance by
> either the primary image interpreter or decision makers reviewing the images."
>
> "The ACR and this technical standard make no general statement on the type or amount of compression that is
> appropriate to any modality, disease, or clinical application"
>
> "The FDA does not allow irreversible compression of digital mammograms for retention, transmission, or final
> interpretation, although irreversibly compressed images from prior studies may be used for comparison purposes, if
> deemed of acceptable quality by the interpreting physician"
>
> "The U.S. Food and Drug Administration (FDA) requires that when an image is displayed it be labeled with a message
> stating if irreversible compression has been applied and with approximately what compression ratio (and/or quality
> factor)"

It also says "only algorithms defined by the DICOM standard such as Joint Photographic Experts Group (JPEG), JPEG-LS,
JPEG-2000, or MPEG should be used"
and "In general, digital mammography is outside the scope of this technical standard". The *Practice Parameter for
Determinants of Image Quality in Mammography* (covers FFDM and DBT; revised 2022, amended 2023), §VI.E.5: "Use of lossy
compression for data storage, transmission, and retrieval is not allowed by the FDA." It has no DBT-specific lossy rule.

*Binds the viewer?* Advisory. *Derived:* for breast ultrasound the general rule applies — lossy at a physician's
direction, with "no reduction in clinical diagnostic performance", and a display label of lossy and its ratio. The
"only algorithms defined by the DICOM standard" sentence excludes AV1 today.

### Canada — CAR: advisory, ratios per modality

The CAR's *Standards for Irreversible Compression in Digital Diagnostic Imaging within Radiology* (2008, revised 2011)
could not be fetched (404 at car.ca; *unverified*). Its ratios, as the standard's authors reproduce them (Koff et al.,
J Digit Imaging 26(3), 2013, Table 1, "Recommended compression ratio by modality and specialty"): **breast — US 8–12,
MR 16–24, MG 15–25**; body US 8–12. The study behind them (Koff et al., J Digit Imaging 22(6):569–578, 2009,
doi:10.1007/s10278-008-9139-7), JPEG and JPEG 2000, three ratios per set, 100 readers:

> "There was no effect of compression level or type on diagnostic accuracy of mammography images."
>
> "There was no effect of compression level or type on US body, US breast, US pediatric, or US musculoskeletal images."
>
> "The compression ratios used in this experiment were intentionally conservative. We were not interested in
> determining the threshold at which images could be compressed."
>
> "The lossy JPEG codec does not accommodate images over 12-bits of data"

*Binds the viewer?* Advisory. *Derived:* the ratios are a floor of tested safety, not a threshold, and were tested on
2D JPEG and JPEG 2000 frames read one at a time with windowing; no DBT, no cine, no inter coding. A secondary account
by the standard's lead author says the standard "specifies that images stored must be the same as images read"
(Koff, HealthManagement 7(2), 2012; *unverified* against the standard) — *derived:* a viewer interpreting from lossy
frames while storing exact ones would sit outside that, the reverse of the US position.

### Europe — ESR: advisory, defers to national law; no EU rule found

ESR position paper, *Insights Imaging* 2(2), 2011, doi:10.1007/s13244-011-0071-x:

> "In medical applications, it is possible that irreversible compression may be used without producing perceptually
> visible differences ("visually lossless"), and/or without producing differences that affect diagnostic performance
> ("diagnostically lossless")."
>
> "In principal, legal issues are out of the scope of these guidelines, because these are generally based on national
> law"
>
> "At the moment there are limited data on the effects of irreversible compression in specialized imaging, like 3D,
> measurement or CAD."

Its Table 1, "Medically acceptable compression ratios" (UK, Canada JPEG, Canada JPEG 2000, Germany), row "Radiography -
mammo | 20 | 25 | 25 | 15"; its US row has three values (10, 12, 12) whose columns the extracted table does not fix
(*unverified*). It names the practice "diagnostically acceptable irreversible compression (DAIC)", and on workflow:
"using compressed images already for primary reading up to do the compression for 'old images' in the PACS only, or a
mix between… each of these concepts is acceptable in principle."

**EU law and EU-endorsed breast guidance: nothing found.** The *European guidelines for quality assurance in breast
cancer screening and diagnosis*, 4th ed. (2006), has no occurrence of "lossy", "lossless", "irreversib" or "compression
ratio"; the EUREF digital mammography protocol copy read has no compression text; the EUREF DBT protocol, the ECIBC
manuals and Directive 2013/59/Euratom could not be read (*unverified*).

### Germany — binding for X-ray, with no number

Strahlenschutzverordnung (2018, as amended 23 October 2024) §127:

> "Daten können komprimiert werden, wenn sichergestellt ist, dass die diagnostische Aussagekraft erhalten bleibt."

("Data may be compressed if it is ensured that the diagnostic value is preserved.") The DRG consensus (Loose et al.,
RöFo 2009, PMID 19115165; English abstract only): "CR/DR (mammography) 1:15 … The recommended compression ratios are
valid for JPEG and JPEG 2000 /Wavelet compressions", "The results may be understood as recommendations"; no
ultrasound or tomosynthesis ratio. DIN 6868 was not read (*unverified*).

*Binds the viewer?* §127 binds the storage of X-ray data used for diagnosis (mammography, DBT). *Derived:* the exact
store meets it; whether a lossy display stream counts as "Daten" used for diagnosis is a legal reading no source here
settles. Ultrasound lies outside radiation-protection law.

### United Kingdom, Australia and New Zealand

The RCR's 2008 guidance (*The adoption of lossy image data compression for the purpose of clinical interpretation*)
could not be read; RANZCR's *Guideline for the Use of Image Compression in Diagnostic Imaging* (v2, 2020) records that
"The RCR has subsequently withdrawn, and not replaced, its guidance on image compression" (May 2018), and that the RCR
had published 20:1 for mammograms. RANZCR (advisory) is the one guideline read that describes this viewer's shape:

> "the radiologist may make judicious use of appropriate levels of lossy image compression to speed the initial arrival
> of the images, with the patient's interests foremost in their consideration. If this approach is required, the
> practice should make the original images available for subsequent download as required"
>
> "It has also been shown that lossy compression produces visible difference in 3D images at relatively low compression
> ratios, though it is as yet unclear whether these have adverse effects on diagnostic performance"

### IHE — display quality on request, and a lossy label

IHE RAD TF Rev. 23.0 (2025-08-08), Invoke Image Display: "When diagnostic quality is not requested, a lower quality
display may be provided, sufficient for review, for the purpose of providing sufficient quality but faster, if it is
necessary to sacrifice quality for adequate interactive performance." and "Factors that affect quality include the
capabilities of the viewer, and whether or not irreversible compression, spatial or contrast down-sampling or other
forms of image processing have been applied." Basic Image Review annotates "whether or not lossy compression has been
applied" from (0028,2110) with its ratio and method. The MAMMO and DBT profiles carry no lossy rule.

### Summary for the breast family

| | FFDM / synthesized 2D | DBT | breast ultrasound cine, ABUS |
| --- | --- | --- | --- |
| US (FDA, MQSA) | **binding: no lossy for primary interpretation, storage or transfer** | **binding: same** ("FFDM and DBT") | no FDA limit found |
| US (ACR) | priors may be lossy | no DBT-specific rule | DAIC at a physician's direction; label lossy and ratio |
| Canada (CAR) | 15–25:1, 2D JPEG/J2K | no ratio | 8–12:1, 2D |
| Germany | §127 binding, no number; DRG 1:15 | §127, no number | outside StrlSchV |
| EU | nothing found | nothing found | nothing found |
| UK | RCR 20:1, withdrawn 2018 | — | — |

*Derived:* in the US the profiles proposal is open only for roles that do not interpret mammography or DBT, and for
ultrasound; everywhere else the sources are advisory ratios measured on 2D JPEG and JPEG 2000.

## 2. The measures the sources use, and how they were validated

**Compression ratio.** Every guideline's number is a ratio. ACR's glossary: "the ratio of the number of bits in an
original image to that in a compressed version of that image"; ESR: "the bit ratio calculation has to be done on the
bits stored setting"; DICOM C.7.6.1.1.5.2: "The value may be an estimate (e.g., the nominal value that is supplied to
the compressor), or it may be a measured value". ESR: "Despite its short-comings, PSNR is superior to compression ratio
as an image quality metric." Kim KJ et al., Med Phys 36(7), 2009 (JPEG 2000, body CT): "the CR is less suitable than
the PSNR or HDR-VDP as an objective index". Kowalik-Urbaniak et al., Proc SPIE 9037, 2014: "compression ratio is not
always a good indicator of visual quality". *Derived:* a ratio validated on one codec does not transfer to another;
CAR's CT neuro ratio already differs between JPEG (8–12) and JPEG 2000 (8).

**Visually lossless threshold (VLT), by observers.** Lee KH et al., Eur Radiol 17(6), 2007: "By alternately displaying
the original and the compressed image on the same monitor, six radiologists independently determined if the
compressed image was distinguishable from the original image." Kim B et al., Med Phys 38(2), 2011, compared three
displays: "AWOB is most sensitive to image differences among of them" (alternation without a blank). Erickson et al.,
J Digit Imaging 23(5), 2010 (3D JPEG 2000, thin CT, 12 bits, four window presets): "Overall, 77.46% of observers
detected differences at 8:1 … The ability to detect differences does not equate to diagnostic differences". Kim KJ et
al., Radiology 268(3), 2013, found each image's VLT with the QUEST staircase and that it varies by image content.

**PSNR, SSIM, MS-SSIM, HDR-VDP against observers.** SSIM (Wang et al., IEEE TIP 13(4), 2004) defines its constants on
"L … the dynamic range of the pixel values (255 for 8-bit grayscale images)". HDR-VDP-2 (Mantiuk et al., ACM TOG 30(4),
2011) is "based on a new visual model for all luminance conditions" and needs input that describes "the light falling
onto the retina" in cd/m². On JPEG 2000 abdomen CT (Kim KJ et al., IEEE TMI 29(8), 2010): "The Spearman rank
correlation coefficients of the PSNR, HDR-VDP, and MS-SSIM values with the number of readers responding as
indistinguishable were 0.86, 0.94, and 0.86, respectively." On chest CT (Kim B et al., AJR 190(2), 2008): "The PSNR and
HDR-VDP accurately predicted the visually lossless threshold for 69% and 72% of the 100 images (p = 0.68)". On digitized
mammograms (Georgiev et al., J Digit Imaging 26(3), 2013): MSE, MAE, PSNR and SSIM "demonstrated strong correlation with
pooled radiologists' ratings (r, 0.825, 0.823, -0.825, and -0.826, respectively)". ESR: PSNR and MSE "have been shown to
be not well correlated with visual or diagnostic performance".

**Maximum error.** JPEG-LS's near-lossless mode guarantees every sample "differ[s] from the corresponding value in the
original image by up to a preset (small) amount", whose "initial goal … was to guarantee a bounded error for applications
with legal implications (e.g., medical images)" (Weinberger et al., IEEE TIP 9(8), 2000). ESR: the "near-lossless" mode
"has not been well studied". No source read gives a max |Δ| a reader cannot see.

**After window and level.** ESR: a metric "should have the ability to be evaluated on the decompressed image after it
has been subjected to one or more diagnostic viewing transformations. These transformations would typically be
windowing functions that are commonly used with the radiological investigation in question." Lundström, Int J CARS 8(3),
2013 (vPSNR): "The visualization transform has a significant impact on diagnostic quality". Kowalik-Urbaniak et al.
windowed 16-bit images to 8 bits by their default window before scoring. Koff et al. 2009 refused 8-bit pre-windowed
images, "in which the reader would have no ability to manipulate the window-level".
DICOM's JND is "The Luminance difference of a given target under given viewing conditions that the average human
observer can just perceive" (PS3.14 ch. 3), 1 023 of them over 0.05–4 000 cd/m²; this viewer shows 8 bits after the
window ([`../display.md`](../display.md) §Grey, today).

**Breast, by observers.** All JPEG 2000 or wavelet, 2D, intra:

* FFDM: Kang et al., Clin Radiol 66(7), 2011, four readers on distinguishability: "The lossy 60:1 compression ratio for
  FFDM is visually identical to the control image and, therefore, potentially acceptable for primary interpretation."
  Kovacs et al., AJR 204(3), 2015, six readers, JAFROC: "primary interpretation of JPEG 2000 80:1 lossy-compressed FFDM
  images may be viable without degradation of clinical quality." Suryanarayanan et al., Radiology 236(1), 2005, ROC:
  "detection of microcalcifications was significantly reduced with a compression ratio of more than 15:1."
* Digitized film: Good et al., J Digit Imaging 7(3), 1994: "at compression ratios of 15:1 and below, image-processing
  experts are unable to detect a difference"; Kocsis et al., Eur Radiol 13(10), 2003: ROC "threshold at compression
  ratio 40:1… Observers' grading of mammogram quality lowers this threshold at 25:1"; Georgiev et al. 2013: "a visually
  lossless CR threshold, estimated to be between 25:1 and 40:1 for the dataset analyzed."
* 3D whole-breast ultrasound: Huang et al., J Imaging Inform Med 2026, doi:10.1007/s10278-025-01735-9, JPEG 2000, JPEG
  3D and HEVC, four readers: "At 5:1 compression, radiologists could not distinguish compressed images from originals,
  and diagnostic performance was unaffected (AUC > 0.85 for all readers)". Bit depth not stated in the abstract.
* **DBT: no peer-reviewed observer or VLT study of lossy compression was found. Handheld breast ultrasound cine and
  synthesized 2D: none either.**

**Video codecs.** Razaak et al., IEEE JBHI 18(5), 2014, HEVC on ultrasound video: "a diagnostically reliable compressed
ultrasound video can be obtained for compression with values of the quantization parameter up to 35", with VIF, SSIM
and UQI correlating "with the subjective scores provided by medical experts". Usman and Martini, Comput Biol Med 113,
2019: "VMAF outperforms other state-of-the-art VQMs in the context of WCE videos, but this is not the case for medical
ultrasound videos." Parikh et al., IEEE JBHI 22(2), 2018, high bit-depth HEVC: "Based on an established medically
acceptable compression range for JPEG 2000, this paper establishes acceptable HEVC compression range" — a mapping, not
an observer study. Blöcker, Biomed Phys Eng Express 12(3), 2026, cine MRI: "compression at PSNR>45 dB maintained
segmentation quality" — an AI task, not readers. **No peer-reviewed observer study of AV1 on medical images, of 10–12-bit
video with readers, or of inter-slice coding of DBT was found**; two AV1 conference papers were seen only as search
snippets (*unverified*).

**Lossy first, exact on request.** No study of its clinical acceptance was found. RANZCR and IHE (§1) describe it; ESR
describes JPEG 2000 and JPIP "incrementally retrieving content (even up to reversible)".

## 3. What the profiles study should report

*Derived* from §1–2; the owner chooses, and no number below is a proposed threshold.

* **Per series and per quantizer, per frame and not only the mean**: the VLT is per image (Kim KJ 2013), so report the
  worst frame and a high percentile beside the median.
* **Compression ratio as the guidelines define it**: bits stored × samples ÷ coded bytes (ESR, ACR), so a point can be
  set beside CAR's breast US 8–12 and MG 15–25, DRG's 1:15 and the RCR's 20 — read as *tested on 2D JPEG and JPEG 2000*,
  since nothing validates them for AV1 or for inter coding.
* **PSNR with its peak stated** (2^bits stored − 1, not 255), **max |Δ|**, and **SSIM and MS-SSIM with L set to that
  peak** — SSIM's own L is "the dynamic range of the pixel values"; computed on 8-bit data its constants are wrong for 12.
* **Windowed error**: the difference in displayed 8-bit codes after each series' own window pairs (a mammogram's
  `NORMAL`/`HARDER`/`SOFTER`, [`../display.md`](../display.md) §Which series carry them) and one narrow window; one code is
  W/256 stored units. ESR asks for exactly this, and Lundström shows the window moves the answer.
* **A perceptual metric on luminance** where a display model is assumed: HDR-VDP on the GSDF luminance of the windowed
  codes is the one metric that beat PSNR against readers on CT (TMI 2010), and it needs cd/m² in, not codes.
* **Intra (G = 1) and inter separately**, and frames at both ends of a group: every observer study above is intra, and an
  inter-coded frame's error depends on its place in the group.
* **The breast series apart from the others**: FFDM and DBT carry the US prohibition on lossy primary interpretation;
  breast ultrasound and ABUS do not.
* **What the owner would need an observer study for**: whether a frame is visually lossless on this viewer. The method
  the literature uses is alternation of exact and lossy without a blank (Kim B 2011) on a calibrated display at the
  window presets, or a staircase per image (QUEST).

**What no source settles:** a threshold for AV1 or any video codec on DBT or breast ultrasound at 10–12 bits; whether
inter-frame coding changes visibility in a stack; whether a frame seen while scrolling or in cine (rather than held
still) has a different threshold; whether a lossy display stream with the exact store behind it satisfies Germany's
§127 or CAR's "images stored must be the same as images read"; and whether a lossy profile may be the default for a
role that interprets mammography or DBT anywhere outside the US — inside it, FDA's labeling says it may not.

## Sources

DICOM PS3.3, PS3.5, PS3.14 2026d (dicom.nema.org, current). FDA: 88 FR 15126 (2023-03-10, govinfo.gov); *MQSA Small
Entity Compliance Guide* (2024-08-26, fda.gov/media/181152); *Display Devices for Diagnostic Radiology* (2022-09-28,
fda.gov/media/95527); 510(k) K222781. ACR: *Technical Standard for Electronic Practice of Medical Imaging* (2022) and
*Practice Parameter for Determinants of Image Quality in Mammography* (2022, amended 2023), gravitas.acr.org. ESR 2011,
PMC3259360. Koff et al. 2009, PMC3043739; Koff et al. 2013, PMC3649051. RANZCR v2 (2020), ranzcr.com. StrlSchV,
gesetze-im-internet.de. Loose et al. 2009, PMID 19115165 (abstract). IHE RAD TF Rev. 23.0 Vols 1–4, ihe.net.
*European guidelines … breast cancer screening*, 4th ed. Literature: PubMed abstracts by PMID — 17119972, 21452721,
23630311, 20529734, 19673221, 18212217, 23065144, 21450282, 25714287, 15983071, 7948171, 14534807, 41760971, 24893370,
31437625, 28141538, 42173129, 23070834; Erickson 2010, PMC2950269; Wang et al. 2004 and Kowalik-Urbaniak et al. 2014
(ece.uwaterloo.ca/~z70wang); Mantiuk et al. 2011 (cl.cam.ac.uk/~rkm38); Weinberger et al. 2000.
