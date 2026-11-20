# What binds showing a lossy picture of a breast series?

**Question:** the client shows an optimal-quality (lossy AV1) picture by default and the exact frame on request.
Which rules bind that for mammography, DBT and breast ultrasound, and what do they require of the screen?

*Folded 2026-11-14 from `claude/av1-visually-lossless:docs/av1/visually-lossless.md` §1 and §Summary for the breast
family (theory, sources read 2026-11-02, `95357d83`). Quotes are verbatim from the sources named there; *derived*
marks that file's own reading; *unverified* a claim whose primary text was not read. The display label and the
ACR's mammography sentence are already quoted in [`../../adr/exactness-in-production.md`](../../adr/exactness-in-production.md)
§Block or mark; what follows adds the rule's source text and the other jurisdictions. Nothing here is measured, and it
sets no threshold.*

## The sources

* **United States, FDA under MQSA: binding for FFDM and DBT.** The 2023 final rule, 88 FR 15126 (10 March 2023),
  Response 100: images "that have undergone lossy compression … would generally not be considered to be ''original''
  mammograms for the purposes of § 900.12(c)(4)", and "we do not believe there is consensus on what loss of
  information is acceptable". The Small Entity Compliance Guide (26 August 2024, nonbinding, restating the
  regulation): "FFDM and DBT mammographic images must be retained in their original mammographic modality", and lossy
  storage or transfer: "No." *Display Devices for Diagnostic Radiology* (28 September 2022), §VIII, labelling for
  mammography review displays: "Mammographic images with lossy compression must not be reviewed for primary image
  interpretations." Cleared PACS 510(k)s carry it (e.g. K222781).
* **United States, ACR–AAPM–SIIM: advisory.** Irreversible compression "only if the quality of the result is
  sufficient to reliably perform the clinical task"; FDA "requires that when an image is displayed it be labeled with
  a message stating if irreversible compression has been applied and with approximately what compression ratio"; and
  "only algorithms defined by the DICOM standard such as … JPEG-2000, or MPEG should be used", which excludes AV1
  today (*derived*). Priors may be lossy for comparison.
* **DICOM: no threshold.** "The context where the usage of lossy compression of medical images is clinically
  acceptable is beyond the scope of the DICOM Standard" (PS3.5 2026d §8.2). The defined terms for Lossy Image
  Compression Method (0028,2114) list JPEG, JPEG-LS near-lossless, JPEG 2000, HTJ2K, JPEG XL, MPEG-2, H.264 and HEVC:
  **no AV1**. The lossy stream is not a DICOM object, so the marking rules (Lossy Image Compression "01", DERIVED, a
  new SOP Instance UID) bind only if a lossy frame is ever exported as DICOM (*derived*).
* **Germany: binding for X-ray, no number.** StrlSchV §127: "Daten können komprimiert werden, wenn sichergestellt
  ist, dass die diagnostische Aussagekraft erhalten bleibt." It binds storage of X-ray data used for diagnosis; the
  exact store meets it; whether a lossy display stream counts as such data no source settles (*derived*). Ultrasound
  is outside radiation-protection law.
* **Elsewhere:** Canada's CAR gives advisory ratios (15–25:1 mammography, 8–12:1 ultrasound, 2D JPEG and JPEG 2000);
  the RCR's 20:1 for mammograms was withdrawn in 2018; no EU rule was found. RANZCR (advisory) describes this viewer's
  shape: lossy "to speed the initial arrival of the images … the practice should make the original images available
  for subsequent download as required". IHE's Invoke Image Display allows "a lower quality display" when diagnostic
  quality is not requested; Basic Image Review annotates lossy compression with its ratio and method.

## What it requires of the client (*derived* by the source file)

| | FFDM / synthesized 2D | DBT | breast ultrasound cine, ABUS |
| --- | --- | --- | --- |
| US (FDA, MQSA) | binding: no lossy for primary interpretation, storage or transfer | binding: the same | no FDA limit found |
| US (ACR) | priors may be lossy | no DBT rule | lossy at a physician's direction; label lossy and its ratio |
| Germany | §127, no number | §127, no number | outside StrlSchV |

So in the US a lossy DBT or mammography frame shown by default may not be the frame a radiologist interprets from:
**the interpreting role must get the exact frame**, and a device sold for mammography review carries the labelling
above. The store is exact, so storage is unaffected. Whether MQSA's scope reaches breast ultrasound was not read
against 21 CFR 900.2 (*unverified*).

## Verdict, with its scope

Theory from sources read 2026-11-02. The label *Lossless* only after the exact frame's check, and the exact frame on
request ([`../design.md`](../design.md) §Rules), are what the US rule needs at least; whether the interpreting role
must get the exact frame without a request is a product decision the sources do not make.
