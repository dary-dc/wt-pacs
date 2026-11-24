# One note to the PCS team

Written 2026-11-24 by row PCS-NOTE (`claude/work-ledger:docs/queue-2026-11-24.md`; PROGRAM-CLOSE's order 8 and
premise 2 in [`README.md`](README.md)), a session that wrote none of the pages it folds; **nothing run** but `git`
reads. Inputs, on this branch at `2413ed211`: [`pacs-sync`](pacs-sync.md) §2 item 10 and §9;
[`ingest-optimal-quality`](ingest-optimal-quality.md) §2 item 11 and §9; [`exact-frame-layout`](exact-frame-layout.md)
§2 item 6 and §9; [`non-cine-series`](non-cine-series.md) §2 item 3 and §6; [`us-dbt-carry`](us-dbt-carry.md) §2
item 2 (its review owed); and `claude/noise-ingest` `83f73e2bc:docs/av1/noise-point.md` §Note to the PCS team (PR 413,
NOISE-INGEST-REVIEW: no blocker open, the note unchanged), `origin/claude/unified:docs/FIXTURES.md` §Refused. No new
claim: every number in the note is a page's, with the page named in §3.

## 1 · The question

Four pages each ask the owner to send the PCS team something (PROGRAM-CLOSE's order 8: `pacs-sync` item 10,
`ingest-optimal-quality` item 11 with two notes, `exact-frame-layout` item 6, `non-cine-series` item 3), and
`us-dbt-carry`, written after it, adds four questions and a clip. Sent apart, the team gets overlapping asks from one
project; sent never, every item §3 names stays open on what the PCS delivers (premise 6: "no note is sent").
Only the owner can send it.

## 2 · The recommendation, and the owner's yes or no

**Send the note of §9, once, as it stands.** It serves the value statement's last line ("Its input is what the PCS
delivers; the PCS itself is out of scope"): the note asks what the input is and changes nothing at the PCS that the
PCS has not offered.

| # | the owner's yes or no | recommended | a yes changes | a no leaves |
| ---: | --- | --- | --- | --- |
| 1 | **Send it**: §9 to the PCS team, by the owner, in place of the five pages' drafts | **yes** | one yes answers `pacs-sync` item 10, `ingest-optimal-quality` item 11 (both notes), `exact-frame-layout` item 6, `non-cine-series` item 3's three questions and `us-dbt-carry` item 2's four; each answer moves the items §3 names; a row then carries the answers into those pages | the items of §3 stay open "until the PCS team answers"; no lossless-sourced ultrasound clip, so no ultrasound number (premise 2) |

## 3 · The options, and what each question moves

The one option is the note; the alternative is the five drafts sent apart, which ask the clip twice (the G note's
question 3 and `us-dbt-carry` item 2) and the lossy flag twice (σ_min's question 3 and `us-dbt-carry` item 2).
Each question of §9, traced:

| §9 | from (verbatim unless said) | its answer moves |
| --- | --- | --- |
| A1–A9, A10 | `pacs-sync` §9 items 1–9 and 10 | `pacs-sync` item 4 (A9 sizes the second writer), item 5 (A5, the hash bridge's gap), item 6 (A6, layout A or B), item 7's D14 (A6); the receive path's profile (A2), `incoming/` or a kept mirror (A1), the seam (A3), every shape's precondition (A4), completeness (A7) |
| B1–B5 | `exact-frame-layout` §9 items 1–5, its DICOM PS3.5 quote kept | `exact-frame-layout` item 2 (whether the PCS's frames already follow RPCL, so Layout 1 costs no re-encode) and item 1's D+T3 (B5) |
| C1–C4 | `noise-point.md` §Note, questions 1–4 (its computing and cost lines shortened to one sentence and a pointer) | `ingest-optimal-quality` item 9 (σ_min enters `code()` only if C1 is yes), item 4 (C2, who encodes), item 3 (C3, the lossy-source flag), §4's calibration (C4) |
| C5–C6 | `ingest-optimal-quality` §9 questions 1–2 | `ingest-optimal-quality` item 3 (G from the trigger, or ours), the G for cine |
| D1–D3 | written here from `non-cine-series` item 3 ("the ingest's three refusals (sizes that differ in one series, a clip among stills, a lossy source) go to the PCS team as questions") and `FIXTURES.md` §Refused | `non-cine-series` item 3; by its §6, "if its output never mixes geometries in a series or holds lossy stills, two refusals are moot" |
| E1–E4 | `us-dbt-carry` §2 item 2's four questions, made into sentences | `us-dbt-carry` items 2, 3 (the label of a lossy-sourced exact frame) and 6 (colour clips), and U3 of its §3 (asked, not built) |
| F | the G note's question 3, PROGRAM-CLOSE's premise 2, `us-dbt-carry` item 2's "one clip *as delivered* beside the lossless one", merged into one request | the ultrasound row of README's *Not answered* table; `ingest-optimal-quality` item 3's G default for cine; `us-dbt-carry` items 1 and 7; `us-dbt-carry` §6's first point |

Merged, not dropped: C3 and E1 both ask about the lossy flag and stay two questions, since C3 asks whether the flag
*reaches the ingest* and E1 how many clips *carry* it. A10 ("not needed from you") is kept as the note's last line.

## 4 · Where it holds

* The note's facts about our side are the pages' as of their dates: DBT numbers on `dbts_a1`, `dbts_b1`, `dbts_c1`
  (3 of 19 volumes of one dataset), the σ_min costs on one 4-core cloud host (PR 413), the archive counts on headers
  of 1 000 public ultrasound instances (`us-dbt-carry` §3, **measured** on headers only). The PCS's code is read at
  `e105214` and not run (`pacs-sync` §4, A8).
* The D questions are this row's wording of a page's line, not a page's text: the one place the note says what no
  page drafted. Found by: this row, reading `non-cine-series` item 3, which names the three refusals but drafts no
  question.
* E1–E4 come from a page whose review (US-DBT-CARRY-REVIEW) is owed; if that review changes item 2, E changes with it
  before the note is sent.
* No private name, address or deployment appears in the note; it names the team by its role only.

## 5 · The mechanism

Every open item §3 names waits on one fact about what the PCS writes. One note asks them all once, and each question
says what its answer decides, so the team can answer in any order and the answers land on the pages without a second
round.

## 6 · What would change the recommendation

* US-DBT-CARRY-REVIEW changing item 2: E is edited, the rest stands.
* An answer arriving before the note is sent (for example, the PCS's next commit showing the hash in the frame names):
  that question is struck, the note stands.
* The owner choosing to send the parts at different times: §9's parts are independent, each with its own lead line.

## 7 · What it would reopen

Nothing; asking reopens no decided approach. Two answers could: B5 yes (strips from the PCS) would move
`exact-frame-layout` item 2's build cost, and an offer of the scanner's coded stream in E4 would bring `us-dbt-carry`'s
U3 to the owner, which reopens *the exact HTJ2K frame* for lossy-sourced clips (that page's §7).

## 8 · Rows and links

PCS-NOTE (this page), PCS-NOTE-REVIEW (owed: every question traced to its page, none lost). The drafts: `pacs-sync`
§9 (PACS-PAGE), `ingest-optimal-quality` §9 (INGEST-PAGE), `exact-frame-layout` §9 (EXACT-LAYOUT-PAGE),
`claude/noise-ingest:docs/av1/noise-point.md` §Note to the PCS team (NOISE-INGEST-PROTOCOL, PR 413),
`non-cine-series` item 3 (NON-CINE-PAGE), `us-dbt-carry` item 2 (US-DBT-CARRY). The refusals:
`origin/claude/unified:docs/FIXTURES.md` §Refused.

## 9 · The note (draft, not sent)

> **Subject: what your output holds — one list of questions from the PACS team**
>
> We receive, store and serve what your parser delivers, for breast tomosynthesis (DBT) stacks and breast ultrasound
> clips and stills. Several of our defaults wait on how your output is shaped. Each question says what its answer
> decides on our side; the parts are independent and can be answered in any order.
>
> **A. The tree and its delivery**
>
> 1. **Your exam tree:** is it kept as the record while updates can still come, does it always show the current
>    state, and can it be synced quiet or from a snapshot? (decides `incoming/` cleared or a kept mirror)
> 2. **Delivery:** a package built by our sender at your side, or rsync of your tree? (the profile)
> 3. **The trigger and the item list:** their form, and who writes the list, our sender or your process. (the seam)
> 4. **Corrections:** your parser writes a corrected group beside the old file and never deletes it; please replace
>    the file, or mark the current one. How is a withdrawal sent? (a precondition of every shape)
> 5. **Frame hashes:** your code writes raw frames as `<I>/G|P|R/%05d` with no hash in the name, so a frame damaged at
>    rest on your disk reaches us undetected; your PDF names them `00001.blake3`. Will frame files carry their hash,
>    and when? (the hash bridge's gap)
> 6. **The layout below the series:** your code and your PDF differ; which will you ship, and are frames numbered
>    with 4 or 5 digits? (D14, and who builds the `.sbnd`)
> 7. **Completeness and late instances:** which heuristic decides a series is complete, and can you call our sender
>    again for a late instance; does an addition carry the added frames only or the series again?
> 8. **Your parser:** group 0002 still lands in the instance group at `e105214` (read, not run); converted enhanced
>    objects, when?
> 9. **Patient updates:** does any site feed patient updates (HL7 A08, A40) to you, and how often does the hospital
>    re-send a corrected object? (#220's two unknowns; they size the second-writer question)
>
> **B. The HTJ2K frames you deliver.** For the largest frames we are weighing a layout that decodes faster on a
> reader's device. Could you tell us:
>
> 1. The transfer syntax UID: 1.2.840.10008.1.2.4.201 (HTJ2K Lossless), .202 (HTJ2K Lossless RPCL) or .203?
> 2. The progression order, the number of decomposition levels, and whether TLM markers and tile-parts per
>    resolution are written.
> 3. The number of tiles and the code-block size.
> 4. The number of quality layers.
> 5. Whether your encoder could write a large frame as three horizontal strips, each its own codestream, for a
>    second delivery beside the DICOM one, or whether we should re-encode on our side.
>
> For reference, DICOM PS3.5 §10.18.1 asks of the RPCL syntax: "The progression order shall be RPCL (Resolution
> Position Component Layer). This sequences the resolution blocks so that lower resolutions can be read first. The
> number of decompositions shall be sufficient for the width or height of the base resolution to be <= 64. … The
> Tile Length Markers (TLM) shall be present. This allows finding the resolution breakpoints to support smart
> streaming." (DICOM PS3.5 2026e, §10.18.1, <https://dicom.nema.org/medical/dicom/current/output/html/part05.html>,
> fetched 2026-11-22.)
>
> **C. The view: a per-series noise figure and the group length.** The optimal-quality view may take its quantizer
> from each series' noise, σ_min, the lowest per-frame noise estimate over the series' frames (Immerkær's Laplacian
> estimator, the steepest 10 % of samples left out, the integer-rounding share removed, only samples inside the
> series' first window; measured at 0.002–0.003 CPU s a megapixel in Rust, seconds a series against minutes of AV1
> encoding). Separately, our ingest codes the view with any Q from 1 to 63 and any group length G ≥ 1; on DBT at Q 8
> a group of 8 saved at most 1.2 % of the view's bytes against G 1 on three volumes, and we have no measurement on
> ultrasound clips.
>
> 1. Will the parser's output carry the per-frame window? For enhanced multi-frame objects, it sits inside
>    (5200,9229) or (5200,9230) → Frame VOI LUT Sequence (0028,9132). The ingest reads top-level keys today.
> 2. Which side encodes the view, so that σ_min is computed there, on the source samples?
> 3. Will Lossy Image Compression (0028,2110) and the received transfer syntax reach the ingest? A lossy source
>    must not use this rule.
> 4. Are the sources only the DBT systems we calibrated (A, B, C)? The rule has no calibration for other modalities
>    or systems yet.
> 5. Which modalities will you send as cine-like series (DBT slices, ultrasound clips), and at what frame rates?
> 6. Do you intend to choose G yourselves, and pass it with Q in the trigger, or leave G to us?
>
> **D. Ultrasound stills.** We store stills as a stack of exact frames in acquisition order. Our ingest refuses three
> things by name, and we would rather know than meet them at a site:
>
> 1. Can one series hold images of different sizes (Rows, Columns) or photometric interpretations?
> 2. Can a multi-frame object (a clip) arrive in the same series as single-frame stills?
> 3. Do stills ever reach us in a lossy transfer syntax, or flagged Lossy Image Compression `01`?
>
> **E. Ultrasound clips as you deliver them.** In a public archive we read, 997 of 1 000 multi-frame ultrasound
> objects were flagged lossy and 979 were colour-typed.
>
> 1. Of the clips you deliver, how many are flagged lossy?
> 2. In which photometric interpretation do their frames reach us (for example `MONOCHROME2`, `RGB`, `YBR_FULL_422`)?
> 3. Is Ultrasound Color Data Present (0028,0014) kept?
> 4. Is the scanner's coded stream kept, and could it be delivered as it is?
>
> **F. One request.** Could you share two anonymised breast ultrasound clips in your output layout: one exactly as
> you deliver it, and one from a lossless source, if any of your sites keeps one? Every ultrasound figure we have is
> from lossy-sourced public clips, so none is yet a measurement of what you will send.
>
> **Not needed from you:** a decoded-samples hash per frame (we check coded hashes; the client checks samples).
