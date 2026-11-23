# What to call the state `claude/unified` reaches before `main`

Row FINAL-STATE of the program (`claude/work-ledger:docs/queue-2026-11-14.md`, amendment 27), written 2026-11-22;
corrected in place 2026-11-23 by FINAL-STATE-FIX (§Fix).
Sources and reasoning only: nothing was built, run or timed, and the gate was not run. Every quotation is a
**source**, fetched 2026-11-22 and listed in §8 with its URL, section and revision; every judgement of a term is
**theory** (this page's reasoning); what is said of `claude/unified` was read at `4a2b4277`, not executed.

## 1. The question

The branch that goes into `main` needs a name for the state it is brought to, and a definition that can be checked.
The owner, 2026-11-22: "production ready is not the right word or phrase or term for this. Because there are so many
concerns and points that actual production requires to even function properly ... that we are not considering now.
And don't want to. ... it cannot be something like demo ready, because that might sound like an unoptimized,
vibe-coded project". It is the owner's because the word goes in the README of a public repository and tells every
reader what the project claims.

## 2. The recommendation

**Keep the owner's provisional *evaluation release* as the name of the release, call the state it is brought to
*bench-verified*, always with its scope, and print one line beside them that says what neither is.**

> **Evaluation release, bench-verified** for breast DBT and ultrasound stacks: complete for that scope, every default
> chosen by measurement on the fixtures [`docs/FIXTURES.md`](../FIXTURES.md) names, reviewed, gate green. For
> technical evaluation: not run in production and not validated in a clinic; not a medical device.

They are two names because they name two things (**theory**): *release* names an artifact, the tree that goes into
`main`, and *evaluation* says what a reader may do with it, §5's third axis; *bench-verified* names the state of its
claims, §5's first two axes. Each passes a test the other fails (§3): *evaluation release* has no official definition
and says nothing of its evidence (T3, T4), and *bench-verified* says what was shown but not what the artifact is for.
Kept, the provisional term renames nothing (§7). "For technical evaluation" is there because medical-device law uses
*evaluation* for the clinical assessment of a device (S18), which this release has not had.

*Verified* is the quality vocabulary's word for exactly what was done: "objective evidence that the design outputs
... meet all of the specified requirements" (S13), and its official counterpart, *validated* ("conform to user needs
and intended uses", S13), is exactly what was not. *Bench* says where the evidence comes from, fixtures and
instruments and not the field (S14), which is the limit `CLAUDE.md` §Measurement makes every result name. The
definition is §5: seven conditions, each with its check, and the list of what is outside.

It serves the value statement (amendment 27, item 7) by saying how far each of its promises has been shown: on the
bench, for the stated scope, and no further.

**The owner's yes or no.**

* **Yes**: *evaluation release* and *bench-verified* get one line each in `docs/glossary.md`;
  `docs/lines/coordination.md` §Goal's "keep `main` deployment-ready" becomes "keep `main` bench-verified";
  UNIFIED-PAGE uses §5's seven conditions as its checklist for `claude/unified`. `README.md` carries the status line
  above, under the value statement, **only once UNIFIED-PAGE finds all seven conditions met at the tip**; until then it
  carries the same line with each unmet condition stated in place of its claim, for example "**Evaluation release**,
  toward bench-verified: DBT stacks measured, ultrasound stacks carried by theory; defaults not yet each traced to a
  measurement. For technical evaluation: ..." (the unmet conditions at the tip: §5's last list). One docs-only row
  does the edits (not queued here: it waits for the yes).
* **No**: UNIFIED-PAGE still uses §5's conditions, as "the state of `final-state.md` §5", with no name; "production
  ready" and "demo ready" stay unused; the owner names another row of §3, or a word of their own, for either name,
  and §5 stands under it unchanged (§7 lists what a new release name renames). The status line's second sentence is
  recommended whatever the names (§6).

## 3. The options

What the owner's words ask of a term, as five tests (**theory**):

* **T1** it does not claim production: a reader does not assume access control, operations or a real PCS feed;
* **T2** it does not read as unfinished or unoptimized;
* **T3** it has a definition that can be checked against the branch, condition by condition;
* **T4** it names the limit of the evidence (fixtures, cloud hosts, one phone), as `CLAUDE.md` §Measurement requires;
* **T5** it obeys `CLAUDE.md` §Names: the domain's words, no word from the project's history, none that a standard
  the code touches uses for something else.

The terms in use, each from its official source (quotations in §8), then the terms this page generated.

| term | what its source says it means (**source**) | T1 | T2 | T3 | T4 | T5 | verdict (**theory**) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| alpha, beta | Kubernetes: alpha "Might be buggy"; beta "well tested ... Recommended for only non-business-critical uses" (S5). PyPI: "3 - Alpha", "4 - Beta", then "5 - Production/Stable" (S4) | yes | **no** | no | no | yes | a step on a ladder whose next step is production; says how far, not what was shown |
| preview, technology preview | "not necessarily feature-complete ... intended for use in test environments only" (S7); "still under development ... cannot guarantee their stability" (S8) | yes | **no** | no | no | yes | a vendor's support promise; this project sells no support |
| experimental; release candidate | Node.js: "Use of the feature is not recommended in production environments"; its stage 1.2, "Release candidate ... hopefully ready to become stable" (S6) | yes; **no** | **no**; yes | no | no | yes | "experimental" undersells; a release candidate is a candidate *for* production |
| `0.y.z` | "Major version zero (0.y.z) is for initial development. Anything MAY change at any time."; "If your software is being used in production, it should probably already be 1.0.0." (S3) | yes | weak | no | no | yes | **keep beside the name**: `series-server` is already `0.1.0`; a number, not a word |
| TRL 5 or 6 | TRL 5: "End-to-end software system tested in relevant environment, meeting predicted performance." TRL 6: "Prototype implementations of the software demonstrated on full-scale, realistic problems." TRL 7: "Well integrated with operational hardware/software systems" (S1); EU: TRL 5 "validated in a relevant environment", TRL 6 "demonstrated in a relevant environment" (S2) | yes | **no** ("prototype") | partly | yes | yes | the closest official scale; the branch reads at 5 to 6 and below 7 (**theory**), and the number invites that argument instead of ending it |
| Candidate Recommendation | "considered complete and fit for purpose, and that no further refinement to the text is expected without additional implementation experience and testing" (S9) | yes | yes | no | yes | **no** | the right idea (complete, awaiting the field), but it is a specification's stage and W3C's own word |
| repostatus "Active" or "WIP" | Active: "has reached a stable, usable state and is being actively developed"; WIP: "there has not yet been a stable, usable release suitable for the public"; Concept: "a limited example, demo, or proof-of-concept" (S10) | **no**; yes | yes; **no** | no | no | yes | two bins, and the branch is in neither |
| research use only | "For a product in the laboratory research phase of development, and not represented as an effective in vitro diagnostic product ... 'For Research Use Only. Not for use in diagnostic procedures.'" (S11) | yes | weak | no | no | **no** | a label the regulation defines for in vitro diagnostic products, which this is not; it says who may use it, not what state it is in (§6) |
| investigational use only | "'For Investigational Use Only. The performance characteristics of this product have not been established.'" (S11) | yes | **no** | no | no | **no** | as above, and false here: the performance is what was established |
| verified, not validated | verification: "objective evidence that the design outputs of a particular phase ... meet all of the specified requirements"; validation: "software specifications conform to user needs and intended uses" (S13) | yes | yes | **yes** | no | see §6 | the right pair; alone it does not say where the evidence came from |
| *reference implementation* | no official definition found | yes | yes | no | no | weak | implies a specification it implements, and clarity before speed |
| *measured baseline* (generated) | — | yes | yes | yes | weak | **no** | DICOM: "JPEG Baseline Compression (coding Process 1)" (S15); the repo's `scripts/perf_counts.baseline` |
| *verified core* (generated) | — | yes | yes | yes | no | **no** | "core" is history here (`claude/core`) and a glossary word (the native core, the `core` paint thread) |
| *scope-complete* (generated) | — | yes | yes | partly | no | yes | says the first condition of §5 and none of the others |
| **evaluation release** (the owner's provisional term, amendment 27 item 7) | no official definition found (searched 2026-11-23). Vendor practice: "Fully functional time-limited evaluation versions of Windows Server 2012" (S17). Medical-device law: "‘clinical evaluation’ means a systematic and planned process to ... assess the clinical data pertaining to a device in order to verify the safety and performance" (S18, MDR); "‘performance evaluation’ means an assessment and analysis of data to establish or verify the scientific validity, the analytical and, where applicable, the clinical performance of a device" (S18, IVDR) | yes | yes | no | no | weak | **kept, as the release's name**: it says what a reader may do with it, not what was shown; the regulations' *evaluation* is clinical, so the status line says "technical evaluation"; DICOM's *release* is "The graceful release of an association" (S15, PS3.8 §7.2), a protocol primitive spelled A-RELEASE, not a version, judged harmless |
| **bench-verified** (generated) | bench: "performance testing, performed by either a device manufacturer or a third party testing facility" (S14); verified as above (S13) | yes | yes | **yes** | **yes** | see §6 | **recommended, as the state** |
| *bench-measured* (generated) | "measured" is this repository's own label for a number (`CLAUDE.md` §Docs: "A claim that is not measured says so") | yes | yes | yes | yes | yes | the fallback if "verified" is refused (§6): weaker, a measurement proves nothing by itself |

How two open-source medical imaging projects word the same thing (practice, not a definition): "The OHIF Viewer is
NOT F.D.A. cleared or CE Marked. It is the users' responsibility to ensure compliance with applicable rules and
regulations." (S16); "Slicer is NOT approved for clinical use and the distributed application is intended for
research use." (S16). Both state what the software is not, in one sentence, and neither uses a maturity word.

## 4. Where it holds

* **Nothing measured.** The verdicts of §3 are reasoning over quoted definitions. No reader outside the project was
  asked what a term makes them assume; §6 names that test.
* **Sources not read**: ISO 9000:2015 (its terms 3.8.12 and 3.8.13, the origin of verification and validation; the
  online browsing platform answered 403), ISO 16290 (TRL), ISO/IEC/IEEE 24765 (the software vocabulary) and
  IEC 62304 are sold, not published. S13 is used in their place and says which standard it follows. The eCFR API
  answered 406, so S11 is the annual edition, not today's text.
* **The branch was read, not run**: `README.md`, `docs/glossary.md`, `docs/FIXTURES.md`, `docs/lines/coordination.md`,
  `docs/merge-readiness.md`, `scripts/gate.sh` and `server/Cargo.toml` on `origin/claude/unified` at `4a2b4277`.
  Whether the branch meets §5 today is UNIFIED-PAGE's question, not this page's.
* **The program's fixtures**, which "bench" stands for: 19 DBT volumes of one dataset, three of them timed; no breast
  ultrasound cine; 4-core cloud hosts without a GPU, software WebCodecs, headless Chromium; a userspace relay or
  netem, not a radio; one phone on one home link.
* **Not a regulatory opinion.** Whether software like this is a medical device in a given country is decided by
  that country's rules and the use its maker states, and by no word on this page.

## 5. The mechanism: why a ladder word fails, and the definition

"Production ready" and "demo ready" are steps on one ladder, and so are alpha, beta, preview, release candidate and a
TRL number. A ladder has one axis. The state has three, and they are independent (**theory**):

1. **scope**: what it is for, and whether that is all there (here: complete, for a narrow scope);
2. **evidence**: how each claim was shown (here: by measurement, on named fixtures, reviewed);
3. **use**: whether anyone may rely on it where it matters (here: no; nothing was done for it, on purpose).

A ladder word must put high marks on axes 1 and 2 and a low one on axis 3 at a single height, so it either
overclaims the third ("production ready") or undersells the first two ("demo", "beta", "prototype"). That is the
owner's objection, restated. The quality vocabulary already splits the axes: verification is axes 1 and 2 against a
written scope, validation is axis 3 (S13). So the name takes the first word, the status line says the second was
not done, and "bench" carries the fixtures' limit into the name itself.

A second premise does not hold either: "production's concerns" is not one list. The branch already carries
`deploy/` and the gate checks it (the seccomp profile, the notices, the web image's files), while the largest thing
outside it is not operational at all: no reader has judged a picture. So the line is drawn by enumeration below, not
by the word "production".

**bench-verified**, for a stated scope, means all seven; each has a check a reviewer can make on the branch.

| # | condition | the check |
| ---: | --- | --- |
| 1 | **The scope is written**, in one place: what it serves (breast DBT and ultrasound stacks, a series of frames along one dimension), from what input (what the PCS delivers), to what client (a browser) | `README.md` opens with it (row VALUE-STATEMENT: README §Purpose on PR 432, until it merges into `claude/unified`) |
| 2 | **Complete for that scope**: every step from a delivered series to a checked frame on screen is in the default build and run end to end by the gate, for a DBT stack and for an ultrasound clip | the gate's end-to-end steps, one per modality, on real coded frames |
| 3 | **Every default chosen by measurement**: each default (a server flag, a client option, a codec setting) points to the document whose measurement chose it, or says "not measured" | one table of defaults, every row with a pointer or those two words; `docs/reviews/understand/defaults.md` its starting point |
| 4 | **Lean**: nothing in the default build that no product path uses; no test lever outside `lab/`; the comment budget held | `scripts/check_lab_absent.sh`, `scripts/comment_budget.sh`; the unified track's removal PRs each merged or refused by name |
| 5 | **Gate green**: the full gate at the tip, from a clean clone by `README.md` §Prerequisites, with no skip but those the CI workflow allows | `scripts/gate.sh` with neither `--quick` nor `--no-browser`, its log free of `SKIPPED` but the lines `.github/workflows/gate.yml` lists in `allowed` ("the viewer's cross-codec arm and Firefox": row INGEST's fetched studies and a GL display, which no runner has) |
| 6 | **Reviewed**: every change arrived by a pull request reviewed by a session or person that did not write it; no blocker open | the unified track's review rows, all done |
| 7 | **Every number names its bench**: a figure in `README.md` or `docs/` is labelled measured, derived, theory or source, with its fixtures and their limits | `CLAUDE.md` §Docs and §Measurement, as the decision pages already do |

**Outside it, by name**, each printed in `README.md` so no reader has to infer it:

* **who may open a study**: access control, sessions, audit;
* **the PCS's real output**: the input was fixtures, until the PCS team's answers (`docs/lines/metadata.md` §Open);
* **operations**: monitoring, capacity, upgrade, backup, a second site;
* **failure behaviour beyond a frame**: a failed frame check is inside (it is decided and tested); a crashed
  server, a full disk, an overloaded host are outside;
* **clinical validation**: no reader study, so the optimal-quality view claims nothing about diagnosis;
* **regulatory status**: none sought;
* **devices, engines and links not measured**: carried by theory only, and labelled so (the `engines` and
  `phone-decode-route` pages).

Three things the definition would meet on the branch today (read, not run; UNIFIED-PAGE decides each):

* condition 2, ultrasound: the tracked ultrasound fixture is "3 frames, 19-byte placeholders ... not HTJ2K"
  (`docs/FIXTURES.md`, the `fixtures/us_cine_smoke/` row), and the program's fixtures hold no breast ultrasound cine.
  Either an ultrasound clip is run end to end, or the status line says "DBT stacks measured; ultrasound stacks
  carried by theory";
* condition 3: no table of defaults with a pointer per default was found; `docs/levers.md` lists levers, not
  defaults, and `docs/reviews/understand/defaults.md` (DEFAULTS-FIND, 2026-11-11, read at the demo tip `618e13c8`)
  lists what the page, `series-server` and `dev-server.py` run with nothing set, with no measurement per default: the
  table's starting point, not the table;
* `docs/merge-readiness.md` (2026-10-14) names one hole "between it and a deployment: the product page takes code
  and pixels from any address a link names". Whether it stands at the tip was not checked; if it does, it is inside
  condition 2 (a correct product path), not outside under access control.

## 6. What would change the recommendation

* **"Verified" has a homonym in DICOM**: "The Verification Service Class defines a service that verifies application
  level communication between peer DICOM AEs" (S15). It is a service's name, the code does not implement it, and
  the glossary's word for a frame is *checked*, so this page judges the clash harmless; `CLAUDE.md` §Names is the
  owner's rule, and if it is read strictly the name is *bench-measured*, with §5 unchanged.
* **"Bench" is a project word too**: `lab/decode-bench/`, `lab/container-bench/`, `lab/disk-access-bench/`, "row
  145's fault bench" (`docs/ARCHITECTURE.md`). Each means a lab rig, not the field, the sense S14 gives it, so T5's
  objection (a project word meaning something else, as *core* does) does not apply; this page judges it harmless.
* **A regulatory path.** If the owner ever intends a clearance, "verification" becomes a term with duties under a
  quality system, and a self-given "verified" beside it is unwise: *bench-measured* again.
* **A site pilot planned.** Then a scale that says how far from operation the system is serves better than a state:
  TRL 6 by S1's wording, with §5 as its evidence.
* **The one test that would show it**: the status line of §2 read by two people outside the project, a PACS
  engineer and a radiologist, each asked what they would assume it can do and what it cannot. If either assumes
  clinical use, or assumes a toy, the line failed. No agent can run it.
* **The second sentence stands in every case.** The value statement says the product "lets a radiologist ... start
  reading". Beside that sentence a public README needs "not validated in a clinic; not a medical device", whatever
  the first word is. "Research use only" is not the way to say it: FDA holds such labelling "false or misleading"
  where the intended use is diagnostic (S12), and the label belongs to another product class (S11).

## 7. What it would reopen

Nothing among the program's §Decided approaches. Keeping *evaluation release* renames nothing; replacing it renames
what amendment 28 has built on it: phase 2's heading ("toward the evaluation release"), the branch
`claude/eval-release`, its PR title "evaluation release candidate: the owner's review", and the rows of phase
2's queue file that name them. Amendment 1's "every frame checked, in production too" uses
"production" for the default build against the lab's, and stands. `docs/lines/coordination.md` §Goal's
"deployment-ready" is a line's wording, not a decision; a yes replaces it.

## 8. Rows and links

Rows: FINAL-STATE (this page); FINAL-STATE-REVIEW (findings in §Review below); FINAL-STATE-FIX (§Fix); UNIFIED-PAGE (needs this page);
VALUE-STATEMENT (the scope sentence of condition 1). Status: `claude/work-ledger:docs/queue/FINAL-STATE.md`.

Sources S1–S16 fetched 2026-11-22, S17–S18 and S15's PS3.8 2026-11-23. A page with no revision of its own is cited
by its fetch date.

| | source | section, revision | URL |
| --- | --- | --- | --- |
| S1 | NASA Procedural Requirements NPR 7123.1D, *NASA Systems Engineering Processes and Requirements* | Appendix E, Technology Readiness Levels, the software description column; effective 2023-07-05, "Updated w/Change 2" | `https://nodis3.gsfc.nasa.gov/displayDir.cfm?Internal_ID=N_PR_7123_001D_&page_name=AppendixE` |
| S2 | European Commission, Horizon Europe Work Programme 2023-2025, 13. General Annexes | Annex B, "Technology Readiness Levels"; Decision C(2025) 2779 of 14 May 2025 | `https://ec.europa.eu/info/funding-tenders/opportunities/docs/2021-2027/horizon/wp-call/2023-2024/wp-13-general-annexes_horizon-2023-2024_en.pdf` |
| S3 | Semantic Versioning | 2.0.0, item 4; FAQ "How do I know when to release 1.0.0?" | `https://semver.org/spec/v2.0.0.html` |
| S4 | Python Package Index, the trove classifiers | "Development Status" | `https://pypi.org/pypi?%3Aaction=list_classifiers` |
| S5 | Kubernetes documentation, *Feature Gates* | "Feature stages"; the page of v1.37 | `https://kubernetes.io/docs/reference/command-line-tools-reference/feature-gates/` |
| S6 | Node.js v26.13.1 documentation, *About this documentation* | "Stability index" | `https://nodejs.org/api/documentation.html` |
| S7 | Google Cloud, *Products* | "Product launch stages", Preview | `https://cloud.google.com/products` |
| S8 | Red Hat, *Technology Preview Features - Scope of Support* | first two paragraphs | `https://access.redhat.com/support/offerings/techpreview` |
| S9 | W3C Process Document | 18 August 2025, §6.3.1 Maturity Stages on the Recommendation Track, Candidate Recommendation, the note | `https://www.w3.org/policies/process/` |
| S10 | repostatus.org | "Project Statuses"; no revision on the page, cited by its fetch date | `https://www.repostatus.org/` |
| S11 | 21 CFR 809.10, *Labeling for in vitro diagnostic products* | (c)(2)(i) and (ii); annual edition revised as of 2025-04-01, title 21 volume 8 | `https://www.govinfo.gov/content/pkg/CFR-2025-title21-vol8/xml/CFR-2025-title21-vol8-sec809-10.xml` |
| S12 | FDA, *Distribution of In Vitro Diagnostic Products Labeled for Research Use Only or Investigational Use Only* | §IV.A.1, Research Use Only Labeling; issued 2013-11-25 | `https://www.fda.gov/media/87374/download` |
| S13 | FDA, *General Principles of Software Validation; Final Guidance for Industry and FDA Staff* | §3.1.2 Verification and Validation; issued 2002-01-11 (its cover notes the Quality Management System Regulation, effective 2026-02-02, came after it) | `https://www.fda.gov/media/73141/download` |
| S14 | FDA, *Recommended Content and Format of Non-Clinical Bench Performance Testing Information in Premarket Submissions* | §I Introduction and Scope; issued 2019-12-20 | `https://www.fda.gov/media/113230/download` |
| S15 | DICOM PS3.4 2026e, Annex A Verification Service Class; DICOM PS3.5 2026e, §8.2.1 JPEG Image Compression; DICOM PS3.8 2026e, §7.2 A-RELEASE Service | 2026e | `https://dicom.nema.org/medical/dicom/current/output/chtml/part04/chapter_A.html`, `https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_8.2.html`, `https://dicom.nema.org/medical/dicom/current/output/chtml/part08/sect_7.2.html` |
| S16 | OHIF, *General FAQ*; 3D Slicer, *About 3D Slicer* (practice, not definitions) | "Does The OHIF Viewer have 510(k) Clearance ..."; "What is 3D Slicer?", the note | `https://docs.ohif.org/faq/general/`, `https://slicer.readthedocs.io/en/latest/user_guide/about.html` |
| S17 | Microsoft Learn, *Evaluation Versions and Upgrade Options for Windows Server 2012* (practice, not a definition) | "Evaluation versions of Windows Server 2012"; a previous-versions page, cited by its fetch date | `https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-server-2012-r2-and-2012/jj574204(v=ws.11)` |
| S18 | Regulation (EU) 2017/745 (MDR) and Regulation (EU) 2017/746 (IVDR) | Article 2, points 44; the text as adopted, 5 April 2017 | `https://www.legislation.gov.uk/eur/2017/745/article/2/adopted`, `https://www.legislation.gov.uk/eur/2017/746/article/2/adopted` |

The quotations of §3 in full, where the table shortened them:

* S1, TRL 5, software: "End-to-end software elements implemented and interfaced with existing systems/simulations
  conforming to target environment. End-to-end software system tested in relevant environment, meeting predicted
  performance. Operational environment performance predicted. Implementations."
* S1, TRL 6, software: "Prototype implementations of the software demonstrated on full-scale, realistic problems.
  Partially integrated with existing hardware/software systems. Limited documentation available. Engineering
  feasibility fully demonstrated."
* S1, TRL 7, software: "Prototype software exists having all key functionality available for demonstration and
  test. Well integrated with operational hardware/software systems demonstrating operational feasibility. Most
  software bugs removed. Limited documentation available."
* S5: "An Alpha feature means: Disabled by default. Might be buggy. Enabling the feature may expose bugs."; "A Beta
  feature means: ... The feature is well tested. Enabling the feature is considered safe. ... Recommended for only
  non-business-critical uses because of potential for incompatible changes in subsequent releases."
* S6: "Stability: 1 - Experimental. The feature is not subject to semantic versioning rules. Non-backward compatible
  changes or removal may occur in any future release. Use of the feature is not recommended in production
  environments."; "1.2 - Release candidate. Experimental features at this stage are hopefully ready to become
  stable."
* S7: "At Preview, products or features are ready for testing by customers. Preview offerings are often publicly
  announced, but are not necessarily feature-complete, and no SLAs or technical support commitments are provided
  for these. Unless stated otherwise by Google, Preview offerings are intended for use in test environments only."
* S8: "Because Technology Preview features are still under development, Red Hat cannot guarantee their stability."
* S9: "Note: Advancing to Candidate Recommendation indicates that the document is considered complete and fit for
  purpose, and that no further refinement to the text is expected without additional implementation experience and
  testing; however, additional features might be expected in a later revision."
* S10: "Concept – Minimal or no implementation has been done yet, or the repository is only intended to be a limited
  example, demo, or proof-of-concept."; "WIP – Initial development is in progress, but there has not yet been a
  stable, usable release suitable for the public."; "Active – The project has reached a stable, usable state and is
  being actively developed."
* S12: "An IVD product should not be labeled RUO if it is intended for use in a clinical investigation subject to
  21 CFR part 812 or for clinical diagnostic use outside an investigation (for example, in clinical diagnosis for
  standard medical practice). FDA would consider such an IVD product to be misbranded under section 502(a) of the
  Act, 21 U.S.C. 352(a), if it were labeled “For Research Use Only” or otherwise labeled solely for research use,
  because such labeling would be false or misleading."
* S13: "Software verification provides objective evidence that the design outputs of a particular phase of the
  software development life cycle meet all of the specified requirements for that phase."; "For purposes of this
  guidance, FDA considers software validation to be “confirmation by examination and provision of objective
  evidence that software specifications conform to user needs and intended uses, and that the particular
  requirements implemented through software can be consistently fulfilled.”"
* S14: "For the purpose of this document, non-clinical bench performance testing is defined as performance testing,
  performed by either a device manufacturer or a third party testing facility (e.g., test laboratory), which
  encompasses all bench testing and will be dependent upon the specifics of the actual device or device type."
* S15, PS3.5 §8.2.1: "Any implementation that conforms to the DICOM Standard and has elected to support any one of
  the Transfer Syntaxes for 8-bit Lossy JPEG Image Compression, shall support the JPEG Baseline Compression (coding
  Process 1)."; PS3.8 §7.2: "The graceful release of an association between two AEs shall be performed through ACSE
  A-RELEASE request, indication, response, and confirmation primitives."
* S17: "Fully functional time-limited evaluation versions of Windows Server 2012 are available for the following
  editions"; "you have 10 days to complete online activation, at which point the evaluation period begins and runs
  for 180 days."
* S18, MDR Article 2(44): "‘clinical evaluation’ means a systematic and planned process to continuously generate,
  collect, analyse and assess the clinical data pertaining to a device in order to verify the safety and
  performance, including clinical benefits, of the device when used as intended by the manufacturer"; IVDR Article
  2(44): "‘performance evaluation’ means an assessment and analysis of data to establish or verify the scientific
  validity, the analytical and, where applicable, the clinical performance of a device".

## Review

**FINAL-STATE-REVIEW**, 2026-11-23, a session that wrote none of this page. Read at `9406e30d`; the branch read at
`origin/claude/unified` `4a2b4277` (still its tip). Every source of §8 fetched again on 2026-11-23: the 38
quoted passages of §3 and §8 are verbatim in their sources (W3C answered 403 to one client and 200 to another), and the
revisions of S1–S9 and S11–S15 are the ones the fetched pages carry. The check, its script and output:
`claude/work-ledger:docs/queue/FINAL-STATE-REVIEW/`. No arithmetic on the page. The repository claims hold:
`series-server` 0.1.0, `docs/FIXTURES.md`'s `us_cine_smoke` row, `coordination.md` §Goal's "deployment-ready",
`docs/merge-readiness.md`'s hole, `claude/core` and the glossary's two uses of *core*. **Two blockers.**

* **B1. The owner's provisional term is not tested.** The owner, 2026-11-22 16:00 (amendment 27, item 7):
  "'evaluation release' I think it is interesting that we have a provisional term, and this one might fit, at least
  for now"; the brief: "the page tests it against the others and recommends keeping or replacing it". The page
  was written at 15:42, before that word (16:00), and never names it, while amendment 28 has since built on it
  (phase 2 "toward the evaluation release", the branch `claude/eval-release`, its PR title "evaluation release
  candidate"). Fix: a row of §3 for *evaluation release*, with its source where one defines it (or "no official
  definition found"), judged on T1–T5; §2 says keep it or replace it, and how it relates to *bench-verified*
  (reviewer's reading, **theory**: *evaluation* speaks to §5's third axis, what a reader may do with it, and
  *release* names an artifact, not a state, so the two may be one name for the release and one for its state
  rather than rivals; the page decides); §7 names what a replacement renames (amendment 28's branch and PR title).
* **B2. A yes would print a claim the page shows is not yet true.** The yes puts the §2 status line in `README.md`
  ("complete for that scope, every default chosen by measurement ..., gate green"), done by one docs-only row, while
  §5's last list finds conditions 2 and 3 unmet at the tip (the ultrasound fixture is placeholders; no table of
  defaults). `CLAUDE.md` §Docs: "A claim that is not measured says so." Fix: the yes prints the line only once
  UNIFIED-PAGE finds all seven conditions met; until then the README line names the conditions not met (e.g.
  "DBT stacks measured; ultrasound stacks carried by theory", which §5 already offers).

Minors, each a line where it stands:

* **m1.** §5 condition 5 ("its log free of `SKIPPED`") is stricter than the repository's own CI, whose gate allows
  one skip no runner can open (`.github/workflows/gate.yml`, `allowed`: "the viewer's cross-codec arm and Firefox";
  row INGEST's fetched studies and a GL display). As written no host of the program meets it; say "no skip but those
  the workflow allows", or name the host on which nothing is skipped.
* **m2.** §5 condition 3 and its finding ("no single table of defaults was found") miss
  `docs/reviews/understand/defaults.md` (DEFAULTS-FIND, 2026-11-11, at the demo tip `618e13c8`), which lists what
  the page, `series-server` and `dev-server.py` run with nothing set. It has no pointer to a measurement per
  default, so the condition is still unmet; name it as the table's starting point.
* **m3.** T5 is not applied to *bench*. *Verified core* is refused because *core* is a project word; *bench* is one
  too (`lab/decode-bench/`, `lab/container-bench/`, `lab/disk-access-bench/`; "row 145's fault bench",
  `docs/ARCHITECTURE.md`). Its uses agree with the page's sense (a lab rig, not the field), so likely harmless;
  §6 should say so beside *verified*'s homonym.
* **m4.** S10's revision, "specification 2.1.0 (2020-11-28)", is not on the cited page (its only "2.1." string is a
  script's version); cite where it comes from or cite S10 by its fetch date, as §8 does for pages with none.
* **m5.** §3's TRL row, "my reading puts the branch at 5 to 6": the page's voice elsewhere is impersonal, and the
  placement is **theory**; label it so.
* **m6.** Condition 1's check names `README.md`'s opening, which VALUE-STATEMENT (2026-11-23, PR 432, README
  §Purpose) has written since on its branch, not yet on `claude/unified`; point the check at PR 432 until it merges.

**Verdict: two blockers.** FINAL-STATE-FIX and FINAL-STATE-FIX-REVIEW are appended to the program
(`claude/work-ledger:docs/queue-2026-11-14.md`, amendment 17), and UNIFIED-PAGE now waits on the re-review.

## Fix

**FINAL-STATE-FIX**, 2026-11-23, a session that wrote neither the page nor its review. Docs only; nothing run.
Each finding of §Review corrected in place:

* **B1**: *evaluation release* is a row of §3 ("no official definition found"; S17's vendor practice and S18's
  regulatory *evaluation* quoted), judged on T1–T5; §2 keeps it as the release's name, with *bench-verified* as its
  state, and adds "for technical evaluation" to the status line; §7 names what a replacement renames.
* **B2**: §2's yes prints the status line only once UNIFIED-PAGE finds all seven conditions met; until then the README
  line states each unmet condition.
* **m1** condition 5 allows the workflow's listed skip; **m2** `docs/reviews/understand/defaults.md` named in
  condition 3 and its finding; **m3** *bench* judged under T5 in §6; **m4** S10 cited by its fetch date; **m5** the
  TRL placement labelled theory, impersonal; **m6** condition 1's check points at PR 432.

S15's PS3.8 §7.2, S17 and S18 fetched 2026-11-23; their quotations in §8 are verbatim from the fetched text.

## Re-review

**FINAL-STATE-FIX-REVIEW**, 2026-11-23, a session that wrote none of the page, its review or its fix. Read at
`164864df8` against `0cfd3017d`; `origin/claude/unified` still at `4a2b4277`. Docs only; nothing run, the gate not
run; `scripts/check_links.py` the same 13 unresolved, none in this page; the comment budget ok. Fetched again
2026-11-23: S15's PS3.8 §7.2 (its page says "DICOM PS3.8 2026e"), S17 and S18; each quotation of §3 and §8 from
them is verbatim, and S18's two point-44 definitions are verbatim in the Official Journal's text on EUR-Lex too
(CELEX 32017R0745 and 32017R0746). The check's script and output: `claude/work-ledger:docs/queue/FINAL-STATE-FIX-REVIEW/`.

* **B1 closed.** §3 has the row, "no official definition found", S17 and S18 quoted, T1–T5 judged; §2 keeps the
  term as the release's name and says how it relates to *bench-verified*; §7 names what a replacement renames.
* **B2 closed.** §2's yes prints the status line only once UNIFIED-PAGE finds §5's seven conditions met, and gives
  the line with the unmet conditions stated until then.
* **m1 closed**: condition 5 quotes `.github/workflows/gate.yml`'s `allowed` entry as it stands at `4a2b4277`.
  **m2 closed**: `docs/reviews/understand/defaults.md` is on `claude/unified` and named as the starting point.
  **m3 closed**: §6's second item. **m4 closed**: S10 by its fetch date. **m5 closed**: "(**theory**)", impersonal.
  **m6 closed**: `claude/value-statement` (PR 432) opens `README.md` with §Purpose, the statement verbatim.

New, none a blocker:

* **n1.** §2, "Each passes a test the other fails (§3)": by §3's table *bench-verified* passes T1–T4 and *evaluation
  release* fails T3 and T4, so no test of T1–T5 is passed by the release's name alone; what it adds (what a reader
  may do with it) is §5's third axis, not a test. Say "each says what the other does not". Its T5 "weak" beside a
  clash judged harmless wants its reason in a clause (the regulations' clinical *evaluation*, presumably).
* **n2.** The preamble says every quotation was "fetched 2026-11-22"; §8 says S17, S18 and S15's PS3.8 were fetched
  2026-11-23. Point the preamble at §8.
* **n3.** S18 is cited from legislation.gov.uk, the UK's copy; the EU's official publication is EUR-Lex (the text
  is the same, checked above). Cite EUR-Lex.

**Verdict: no blocker open.** The loop closes in round one: UNIFIED-PAGE's need on this page is met, and the owner's
yes or no on both names (§2) is due.
