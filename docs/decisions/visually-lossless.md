# What the optimal-quality view may claim before any reader, and the bar

Written 2026-11-22 by row VL-PAGE (`claude/work-ledger:docs/queue-2026-11-14.md`), a session that ran none of this
question's rows, from pushed results only; nothing run but `git` over the branches and a read of PR 420. Inputs at:
`claude/vl-criterion` `4accfdb3` (`docs/av1/vl-criterion.md`, VL-CRITERION, with §5.1 the reads of VL-READS; PR 420's
body: VL-CRITERION-REVIEW, VL-CRITERION-FIX, the re-review, VL-READS), `claude/unified` ([`../lines/codecs.md`](../lines/codecs.md)
§Open 0, [`../av1/noise-ratio.md`](../av1/noise-ratio.md) §5, [`../glossary.md`](../glossary.md)). Every row of the
question is done, the re-review with no blocker open, so the recommendation is not provisional. `vl-criterion.md` is
on `claude/vl-criterion` only (PR 420, open): its sections are named, not linked.

## 1 · The question

The view every reader sees first is lossy AV1. The glossary calls it "a series' picture meant to be visually
lossless (not confirmed by readers…)", and the design adds "also for diagnosis". **With no reader study, what may the
view and its label claim, and does the noise rule's bar (1.00 or 1.03) still set its Q?** Five of the owner's open
calls hang on it (`codecs.md` §Open 0.1–0.4 and 0.9). They are the owner's because they set what the product says
to a radiologist about the picture on screen, and one of them extends a decided approach.

## 2 · The recommendation, and the owner's yes or no

**Claim nothing about visibility or diagnosis (option A): the label states the facts (lossy, AV1, about N : 1), the
view keeps Q 8 as an interim picture, the exact frame is the only picture with a quality promise, and "also for
diagnosis" goes.** It serves the value statement (program amendment 27) at both ends: "start reading sooner" — the
view's Q is no longer held up by a promise no measurement can make — and "every frame the reader asks to see exactly
is the original, bit for bit, and checked" — the one promise the product makes stays the exact frame's.

| # | the owner's yes or no | recommended | a yes changes | a no leaves |
| ---: | --- | --- | --- | --- |
| 1 | **A**: the view claims no visibility and no diagnostic quality; the glossary's *optimal quality* becomes "the interim lossy picture every viewer sees first" | **yes** | the glossary line and the design statement of 2026-11-09 reworded (one docs row) | "meant to be visually lossless", a promise §1.4 and §3 of `vl-criterion.md` show no measurement or study here can back |
| 2 | **The label's facts**: *Optimal quality · lossy AV1 · about N : 1*, N the series' measured packed ratio | **yes**; one build row on a yes (`labelOf` and the series' metadata) | the label states what ACR–AAPM–SIIM, IHE and DICOM name (method, ratio), **source**, §1.4 | today's label states none of the three facts those texts name |
| 3 | **The exact frame without a request** (on a dwell, a narrow window, or the whole series behind the view, arm C2) | **yes to the direction; which trigger is the `asking` and `delivery-per-link` pages'** | nothing built now; those two pages size it | the exact frame stays on an explicit Lossless request only, as decided |
| 4 | 0.1 *One bar of 1.03 for the noise anchor?* | **no**: no bar under A | the bar question closes; the rule stays a lab reading, not a default | a bar on a plateau: the anchor resolves to one Q on 4 of 19 volumes (**measured**) |
| 5 | 0.2 *Keep Q 8 hard-coded, labelled?* | **yes**, labelled lossy with its ratio, not "a candidate not confirmed by readers" | the demo stands; the Q is the PCS's trigger argument (`ingest-optimal-quality` item 3) | the rule's Q per series, a criterion that cannot confirm itself (§1.1) |
| 6 | 0.3 *Quote bytes at the rule's Q instead of Q 8?* | **no**: Q 8's as Q 8's, with the exact frames a reader fetches | 0.07–0.24 over 19 volumes, from their rows (`claude/unified:lab/av1/metrics/rows/shard-{1,2,3,4}.jsonl`: Q 8 G 1, stored form, against the `control` rows' HTJ2K bytes; named 2026-11-25, PAGES-PASS, `README.md` §Re-review r-n2); `codecs.md` and `optimal-quality-bytes.md` hold 0.07–0.22, the three timed only (corrected 2026-11-23, `README.md` §Review m4) | a headline at a Q nobody serves |
| 7 | 0.4 *May the view be temporally denoised?* | **no, for now** (A allows it later) | — | lag 0 and G 1 for DBT stay; the gain is −5 to −6 % at equal PSNR on one volume (**measured**, `codecs.md` §Open 0.4), and every G result was taken without alt-ref |
| 8 | 0.9 *Stop saying "also for diagnosis"?* | **yes** | the design statement and the demo's wording (with item 1's row) | a claim the US rule closes whatever a study shows (§1.4) |
| 9 | **D**, the task-bounded step (x ≤ 2 at the quietest frame), as the view's Q if a bounded promise is wanted | **no** | — | D costs 0.26–0.59 of HTJ2K's bytes (**measured**, R8) against Q 8's 0.07–0.24, for a bound on a model's quantizer, not on AV1 |
| 10 | The model observer (`noise-ratio.md` §5, held, about 460 encodes) | **not now**; queue it only if a promise beyond the facts is wanted | — | §1.1's removal worry stays a model's number |

## 3 · The options

From `vl-criterion.md` §3, bytes of HTJ2K's, G 1, stored form, the 19 DBT volumes; R-numbers are §5.1's reads.

| | criterion | the label may say | bytes | state |
| --- | --- | --- | --- | --- |
| **A** | none; the exact frame arrives unasked | *Optimal quality · lossy AV1 · about N : 1*, then *✓ Lossless* | Q 8: 0.07–0.24 (**measured**); with the whole exact series behind it 1.07–1.24×; one exact frame = 4.2–14 view frames, so 1.4–2.4× the view if a reader dwells on a tenth of the slices (**derived**) | buildable; the trigger is the owner's |
| **B** | the noise rule (r ≤ bar on the worst frame), today | "removes 0.78–0.93 of the fine-band noise's amplitude and adds 0.28–0.45 σ" (**measured**, R2), for the tiles' mix, not the quiet band (R5) | 0.10–0.28 (**derived**, audit F7) | built; threshold on a plateau (R1: r resolves 4 of 19) |
| **C** | added error only, x ≤ 1 | "costs under 4 % of any finding's detectability (model)" | 0.48–0.77 (**measured**, R8) | derivable; error white there (R3, 175 cells) |
| **D** | task-bounded step, x ≤ 2 | "no finding loses more than 14 % of its detectability to the quantizer (model; not AV1; no reader)" | 0.26–0.59 (**measured**, R8; predicted 0.22–0.55, refuted on `dbts_b2`) | derivable; AV1's own T unmeasured |
| **E** | only noise removed (no structure in exact − decoded) | "differs from the exact frame only by noise" | unknown | needs decoded samples (§6) |
| **F** | noise kept, ν ≥ ½ | "keeps at least half of the noise texture" | 1.16–1.92× B's (**measured**, A4) | ν resolves one Q on 15 of 19, two adjacent Qs on 4 (**measured**, R1) |
| **G** | a model observer's d′ on the smallest finding | "a model observer finds a 0.1 mm calcification as well as on the exact frame" | unknown | protocol pre-registered, held |

The label's N at Q 8 is 20.7–37.5 : 1 on 12-bit volumes and 11.9–29.4 : 1 on 10-bit ones (**measured**, R9; it does
not split by depth as predicted).

## 4 · Where it holds

**Fixtures:** 19 DBT volumes of one dataset (EA1141; three systems, 12-bit A and C, 10-bit B), three timed; stored
form, lag 0, libaom 3.15.1 at speed 6; one 4-core cloud host. Every limit of these is in the list below.

**The population.** A's recommendation needs no fitted constant: it claims a fact measured per series (the ratio)
and the exact frame's availability, so it carries to any modality, vendor or link by construction (**theory**). The
noise criteria (B, D, F) do not carry that far: their form carries over dose and gain on one detector and one
filtered-back-projection-like reconstruction (**theory**, `vl-criterion.md` §1.2), and R6 refuted even that within a
volume at the rows' resolution (r and ν are not a function of x alone). Their constants are per system of this
dataset. Two of the five DBT systems a national QC protocol lists reconstruct iteratively (**source**, NHSBSP 1407),
where a noise-relative criterion has nothing to stand on.

**US and DBT stacks.** DBT: as above. Breast ultrasound cine: **not yet known** for B–G (the list below says why).
A holds for it as for DBT.

**The theory's tested predictions** (§5.1): R2 and R3 held (the rule's Q removes noise; error white where x ≤ 2, so C
and D stand as derived bounds); R1, R4 and R7 missed without refutation; R5, R6, R8 on `dbts_b2` and R9 were
refuted. Each miss is in the list below, with what it showed.

**Where the link, not the decode, binds** (2026-11-25, PAGES-PASS): no link enters what the view may claim; the
label's facts and option A hold on every link (**theory**). A's safety argument leans on the exact frame arriving
after a dwell (§6), and the exact frame is link-bound on every link: C1's exact frame on every link, from round trips
and slow start on an idle session (**derived**, [`delivery-per-link.md`](delivery-per-link.md) §4). The view itself,
A, is link-bound on LTE, a far stream, LOSS-like links and public Wi-Fi below ~83 Mbit/s for `dbts_b1` on the round's
phone, decode-bound on clean links above that crossover (**derived**, the same §4, from `link-profiles.md` §2). That
the wire binds is untested: on the one phone measured, the exact series filled faster than the view in 15 of 15
rounds, median 0.705 (**measured**, [`README.md`](README.md) §Premises item 1). No transport row is lowered by the
decode-bound phone.

**Each limitation, and what found it** (2026-11-25, PAGES-PASS). Fixtures and setup:

* One dataset, EA1141, 19 DBT volumes of three systems; three of them timed. Found by VL-CRITERION's and VL-READS'
  fixtures lines (`claude/work-ledger:docs/queue/VL-CRITERION.md`, `VL-READS.md`).
* Stored form only; S's `top10` and `window` cells not read (x is defined on the stored form's σ). Found by VL-READS
  (`vl-criterion.md` §5.1).
* Lag 0, libaom 3.15.1 at speed 6, one 4-core cloud host. Found by VL-READS' fixtures line.
* Nothing encoded or decoded for this question: every read is a re-read of committed rows, and the streams are not
  committed, so E (only noise removed) cannot be tested. Found by VL-READS (§5.1) and `vl-criterion.md` §6.
* Δ, the quantizer step, is in no row: it is taken from the AV1 specification fetched the same day, and
  `b-summary.json`'s x is the median frame's, not the quietest's. Found by VL-CRITERION-REVIEW's B1.
* Bytes over all 19 volumes, time on three only (0.07–0.22 on those three). Found by VL-CRITERION-REVIEW's
  arithmetic check; the page's link for it by DECISION-PAGES-REVIEW m4, its rows' file by r-n2.

Population:

* No second vendor and no denoising (iterative or learned) reconstruction; two of five DBT systems a national QC
  protocol lists reconstruct iteratively. Found by VL-CRITERION §1.2 and §6 (audit F8) and NHSBSP 1407 (**source**).
* The noise criteria's form carries only over dose and gain on one detector and one filtered-back-projection-like
  reconstruction, and that reconstructed slices keep a contrast fixed while σ scales is assumed, unverified. Found by
  VL-CRITERION §1.2 (theory).
* Their constants are per system of this dataset: ν at equal x differs across systems by 0.11–0.13. Found by
  VL-CRITERION §1.2 (its A3, refuted).
* A's carry to any modality, vendor or link is **theory** by construction; no row tests it. What found it is not
  recorded beyond VL-PAGE's own label.
* Breast ultrasound cine: no clip was read, and whether its fine band is noise in the sense σ assumes is unexamined.
  Found by VL-CRITERION's fixtures line ("no second vendor, ultrasound cine, phone, display or reader"); the
  unexamined premise by VL-PAGE.
* No phone, no calibrated display, no reader. Found by VL-CRITERION's fixtures line; that readers are the only route
  to *visually lossless* by `vl-criterion.md` §1.4.

The theory's misses (all VL-READS, `vl-criterion.md` §5.1, unless named):

* R1 missed: ν resolves the anchor to one Q on 15 of 19 (predicted ≥ 17), r on 4; the bar sits on a plateau. Found by
  VL-READS' R1; the plateau by VL-CRITERION §1.1.
* R4 missed on 2: L 0.781 on `dbts_b3` and `dbts_b4`, over 0.75. Found by VL-READS' R4.
* R5 refuted on `dbts_c1` G 1: the window matters on every cell read, the quietest decile's ratio 3–52 % above the
  frame's, so B's sentence holds for the tiles' mix, not the quiet band. Found by VL-READS' R5.
* R6 refuted: within a volume neither r nor ν is a function of x alone, which confines even the form to the volume it
  was read on. Found by VL-READS' R6, computable on 12 volumes only.
* R7 missed: the quantizer model describes AV1 from x 4 only and over-predicts r below. Found by VL-READS' R7.
* R8 refuted on `dbts_b2` (D's x ≤ 2 at 0.594, over 0.55); and its Q is the highest rung read, not the highest Q
  with x ≤ 2. Found by VL-READS' R8; the rung by VL-READS' §5.1 limits (VL-CRITERION-FIX-REVIEW's n1 found it on `dbts_b3`, `dbts_b4` only).
* R9 refuted: the label's N does not split by depth. Found by VL-READS' R9.
* The quantizer model is not AV1: the 0.35 against 0.86 detectability is a model's, AV1's own unmeasured (D's "AV1's
  own T unmeasured"). Found by VL-CRITERION (its "Unverified" line).
* Temporal denoising: −5 to −6 % at equal PSNR on one volume, and every G result taken without alt-ref. Found by
  `codecs.md` §Open 0.4.

Not measured, and what each needs (all `vl-criterion.md` §6):

* E's and G's bytes are unknown; G, the model observer, is held (about 460 encodes). Found by VL-CRITERION §6.
* The narrowest window the viewer allows, in the lowest signal decile, is unread. Found by `vl-metrics.md` §4 items
  1 and 4, carried in `vl-criterion.md` §6.
* Alternation needs a reader study, no agent's, and at the rule's Q is not expected to pass. Found by
  `noise-ratio.md` §5.7 and `vl-criterion.md` §1.4.
* A's time from a dwell to *✓ Lossless* on a phone, and what counts as a dwell, are unmeasured. Found by
  `vl-criterion.md` §6.
* No measurement opens lossy primary interpretation of a mammogram in the United States. Found by VL-CRITERION's
  sources (FDA 2022, §VIII, **source**), each quote fetched again by VL-CRITERION-REVIEW.

## 5 · The mechanism

The rule puts its threshold on r = coding error ÷ noise at 1, the value r approaches once the noise is gone; near
there r is flat (between x 4 and 6 it moves 0.065 while ν moves 0.54, **theory**), so the anchor cannot be resolved,
and ν, steep there, can. At the rule's step (about 4.8σ) the error *is* the removed noise (k² ÷ r² 76–92 %), and a
faint finding spread over several coefficients goes with it: a quantizer model keeps 0.35 of its detectability there
against 0.86 at x 2 (**theory**; AV1 may do better, unmeasured). And no measurement opens what matters most: in the
United States a lossy mammogram "must not be reviewed for primary image interpretations" (**source**, FDA 2022,
§VIII), and the ESR warns that visually lossless need not mean diagnostically lossless for low-contrast,
high-frequency tasks. What every source leaves the product free to say is a description and the original's
availability, which is A.

## 6 · What would change the recommendation

* **The model observer** (`noise-ratio.md` §5, about 460 encodes of 16 frames): if its P3 is refuted (calcification
  detectability held at the rule's Q on every system), B's or D's sentence could be offered as a measured, not a
  modelled, bound. One cloud row, the owner's to queue.
* **A reader study** (no agent's; `noise-ratio.md` §5.7 lists what it must confirm: search, flicker against static,
  real lesions, a calibrated display, multi-reader multi-case). It is the only route to *visually lossless*, and at
  the rule's Q alternation is not expected to pass (the removed noise itself alternates).
* **A phone's time from a dwell to *✓ Lossless*** (§6): if it is long on the target links, A's safety argument
  weakens and the view's Q matters again; the `delivery-per-link` page measures the cloud side.
* No measurement changes the US rule on primary interpretation.

## 7 · What it would reopen

Item 3's yes extends "the exact HTJ2K frame on an explicit Lossless request" (program §Decided approaches) to a
fetch without a request; it is not built here and is sized by the `asking` and `delivery-per-link` pages. Item 1
rewords the design of 2026-11-09 ("optimal quality plus the exact HTJ2K frame on request"): the approach stands,
only "meant to be visually lossless" goes. Item 7's no keeps lag 0; nothing else is reopened. Under the owner's word of 2026-11-23 ~02:00
(a view decoded in hardware shown unchecked; [`frame-integrity.md`](frame-integrity.md) §7) the label states no check
of the view at all, which item 1's wording already does: it describes the view, lossy AV1 and its ratio.

## 8 · Rows and links

* VL-CRITERION (Fable, 2026-11-21), VL-CRITERION-REVIEW (B1 and m1–m10), VL-CRITERION-FIX, VL-CRITERION-FIX-REVIEW
  (no blocker open), VL-READS (2026-11-22): `claude/vl-criterion` `4accfdb3`, PR 420 (draft into `claude/unified`; it
  carries `lab/av1/metrics/vl_reads.py` and `rows/vl-reads.json`, so it is no longer docs-only and comes to the owner
  as a PR); status files `claude/work-ledger:docs/queue/VL-*.md`.
* `vl-criterion.md` §1.4 (the regulatory table), §3 (options), §4 (0.1–0.4, 0.9 mapped), §5–§5.1 (reads), §6 (what
  the rows cannot decide).
* [`../lines/codecs.md`](../lines/codecs.md) §Open 0; [`../av1/noise-ratio.md`](../av1/noise-ratio.md) §5 (held);
  [`../client/evidence/which-quality-is-visually-lossless.md`](../client/evidence/which-quality-is-visually-lossless.md);
  [`ingest-optimal-quality.md`](ingest-optimal-quality.md) item 3 (where Q comes from).
