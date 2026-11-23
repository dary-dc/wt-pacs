# Decision pages

One page per open question, each ending in the owner's yes or no. Opened 2026-11-19 by row DECISIONS-OPEN of the
program `claude/work-ledger:docs/queue-2026-11-14.md` (§Decision pages, §Index). A page is written by a session that
ran none of its question's rows, from pushed results only; it runs nothing. Every page row appends its file here and
updates its line of the index.

## The form (every page, in this order; the first four on one screen)

1. **The question**, in plain words, and why it is the owner's.
2. **The recommendation**, one sentence, and **the owner's yes or no**: what a yes changes (the PR to merge, the row
   to queue, the default to set), what a no leaves.
3. **The options**, a table: each with its numbers, every number labelled source, theory, derived or measured and
   linked to where it was produced.
4. **Where it holds**: the fixtures and their limits; then the population (devices, engines, links) the result is
   carried to, by which model, and that model's tested predictions, misses included.
5. **The mechanism**: why the numbers come out this way, in the fewest words that let the owner check the logic.
6. **What would change the recommendation**, and the one measurement that would show it (a device, a GPU, a reader).
7. **What it would reopen** among the decided approaches (the program's §Decided approaches), if anything.
8. **Rows and links**: every row, PR and file behind the page.

A page whose question's rows are not all done by its date is written from what is pushed, names what is missing,
and marks its recommendation **provisional**.

## Index

Inputs that are not pages: [`lab-list.md`](lab-list.md), what reads each `lab/` directory (UNIFIED-LAB-LIST, for
`unified-to-main`).

*Client queue* rows are in `claude/work-ledger:docs/queue-client-2026-11-14.md`, the others in
`claude/work-ledger:docs/queue-2026-11-14.md`. A page's date is the day its row is due.

| page | the question, in a line | rows (client queue in italics) | page due | state |
| --- | --- | --- | --- | --- |
| [`cache`](cache.md) | which store holds decoded frames, and may it be turned on | *CACHE-RUN, CACHE-VERDICT-REVIEW*; CACHE-PAGE | 11-22 | written 2026-11-22: cache off; §10.4's run narrowed, then P2 and P1 |
| [`transport-stack`](transport-stack.md) | WebTransport, or a fetch or WebSocket stack; the server's network defaults | *TRANSPORT-RUN, TRANSPORT-VERDICT-REVIEW*; TRANSPORT-PAGE | 11-22 (11-27 at the latest) | written 2026-11-22: WebTransport the one wire, no GET path; one run of WT's own flags against the fetch arms' ask; `bbr` not withdrawn |
| [`exact-frame-layout`](exact-frame-layout.md) | strips or a level picture for the exact frame | HTJ2K-A1-BUILD, -BUILD-REVIEW, HTJ2K-A1-RUN, -REVIEW; EXACT-LAYOUT-PAGE | 11-23 | written 2026-11-22: Layout 1 kept for D+T3 by A1's rule, not built; P1 and P2 on a phone decide the build; no level picture first for now; the PCS note drafted |
| [`engines`](engines.md) | which results hold in Firefox and Safari | ENGINE-MATRIX, ENGINE-SMOKE, ENGINE-REVIEW; ENGINES-PAGE | 11-23 | written 2026-11-22: Chromium and Firefox desktop measured (Firefox's view by dav1d), Safari unknown; no 4:2:0 view to Firefox's decoder until its G = 8 failure is traced; contradiction 6 by one Firefox 160 run; the Safari probe first |
| [`pacs-sync`](pacs-sync.md) | the receive path's protocol, schema and layout | SYNC-RECONCILE, RECEIVER-RANGE, STUDY-DB-TEST, their reviews; PACS-PAGE | 11-23 | written 2026-11-22: PRs 407, 417, 422 yes; one writer, so E + F; §14's defaults as one yes; one group reader queued; the PCS note drafted |
| [`ingest-optimal-quality`](ingest-optimal-quality.md) | who codes the view, with which Q and G, and the signed gap | INGEST-OQ-TESTS, NOISE-INGEST-PROTOCOL, -MEASURE, reviews; INGEST-PAGE | 11-23 | written 2026-11-22: R (#390) kept, S2, Q and G from the trigger with no default; PRs 413 and 421 yes; the id grammar and a decode-back guard queued; σ_min waits for the window; two PCS notes drafted |
| [`visually-lossless`](visually-lossless.md) | what the view may claim before any reader, and the bar | VL-CRITERION (Fable), -REVIEW, VL-READS; VL-PAGE | 11-24 | written 2026-11-22: claim nothing (A), the label states lossy AV1 and its ratio, Q 8 kept as an interim picture; 0.1, 0.3, 0.4 no, 0.2, 0.9 yes; D and the model observer not now |
| [`reports`](reports.md) | how the load and safety reports leave the page | *REPORT-RUN, REPORT-VERDICT-REVIEW*; REPORT-CELLS, -REVIEW, REPORT-RUN-2, REPORT-VERDICT-2; REPORTS-PAGE | 11-24 | written 2026-11-22: telemetry off; NGINX the receiver, nginx 1.31 at turn-on; Y over H and the safety report at once over HTTP (provisional); no carrier named until C and Lbusy rerun; SESSION not in the wire; PR 370 not merged as is |
| [`view-target`](view-target.md) | the page view or the worker view | *PHONE-ROUND, PHONE-READ, PHONE-READ-REVIEW*; VIEW-PAGE | 11-24 | written 2026-11-23: the view worker the default now, with the start's fix as its one order (P6); the page view kept as a lab arm, removed (P5) after PHONE-ROUND-2's cell 3 under one condition, the Safari probe and the phone's memory after worker loads; the open table blocks nothing |
| [`phone-decode-route`](phone-decode-route.md) | how a phone decodes a series, on which phones | *DEVICE-THEORY (Fable), PHONE-ROUND, PHONE-READ, MOBILE-DECODE-REJUDGE*; ROUTE-POLICY (Fable), -REVIEW; PHONE-ROUTE-PAGE | 11-25 | written 2026-11-22: the view first on every phone, no class table or probe; the fill reports the switch's rule; switch and split tested in the cloud first; B1 no for now, M17 first; cell 1 on a middle-band phone through a device cloud; the audit's checks released, five AV1 rows held |
| [`paused-lines`](paused-lines.md) | resume native or the viewer, and for what | PAUSED-LINES-PAGE | 11-25 | written 2026-11-22: both stay paused; native recorded as the 10-bit hardware route, resumed on a phone's codec list; one cleaning row for native's window before `main`; the viewer's branches stay out, B not carried, the slider kept |
| [`client-calls`](client-calls.md) | the client's smaller owed calls, one section each | DEMO-CHECK-MUTANTS, WORKER-FLAKE; CLIENT-CALLS-PAGE | 11-25 | written 2026-11-22: `readMin`'s fix found lost by merge `dd681539`, restore it, default off; P6 (c) after rule 3's re-read; PRs 418, 419 after one review; S5 yes, S4 done; `transfer` off, cell T queued; the wake, both painters stop at a phone or a GPU |
| [`unified-to-main`](unified-to-main.md) | what `claude/unified` still needs before `main` | the unified track (the program's §Rows); UNIFIED-PAGE | 11-25 | written 2026-11-23: the eleven reviewed track PRs merged by sync rows in a tested order, 433 and 410 after their rows; rule 1 covers removals (yes or no); M6 ported (368 provisional, 378) or left open; 47 `lab/` directories removed from history, no tag; four phase-2 rows before the PR into `main` (defaults table, ultrasound end to end, the gate in CI, the lab removal) |
| [`frame-integrity`](frame-integrity.md) | what the green mark proves, and what happens when a check fails | OQ-INTEGRITY-FIXES, -REVIEW, I2-RUN; INTEGRITY-MODEL (Fable), -REVIEW; INTEGRITY-PAGE | 11-26 | written 2026-11-22: five label states, a withheld frame cleared and not re-asked, every frame with a digest, the metadata hashed; the coded-bytes digest after the report (provisional); PR 368 yes after one fix row; one re-ask enough; a replaced decoder's group asked again once |
| [`repository`](repository.md) | housekeeping calls outside the product | REPOSITORY-PAGE | 11-26 | written 2026-11-22: `docs/agents/` with the git lines kept in `CLAUDE.md`, after one fix row; the tags are the archive index; the 21 "Requested by" lines stripped; release assets after a two-host digest check; the ledger never merges; LATER-PASS closed by pointer, PR-TIDY resumed after re-verifying |
| [`asking`](asking.md) | what a view asks for, and in what order | ASK-MODEL (Fable), -REVIEW; ASK-PAGE | 11-27 | written 2026-11-22: the rule yes as the design, its hold (behind first while moving) tested by P1 and P1b before any build; no slice skipped for DBT and US stacks, a thumb a jump; `waitAhead` off, `span` and `holdEveryOther` removed; PR 96 held for the shallow commitment's run; the budget not the owner's |
| [`non-cine-series`](non-cine-series.md) | what a series that is not cine-like gets | NON-CINE-OPTIONS (Fable), -REVIEW; NON-CINE-PAGE | 11-27 | written 2026-11-22: large single frames the exact frame alone, no AV1 view; level 1 of a level picture first run, nothing adopted; stills a stack of exact frames, the three ingest refusals to the PCS team; the painter refuses an oversized frame by name now; over 12 bits waits |
| [`delivery-per-link`](delivery-per-link.md) | the view, the exact series, or both, per link | DELIVERY-PROTOCOL, -BUILD, -BUILD-REVIEW, -RUN, -VERDICT-REVIEW; DELIVERY-PAGE | 11-27 | written 2026-11-23: A + C1 on every link and class; B not a default for now (the route page's switch test first); C2 no; the next run with C1's wire time, a lossy-link model, the relay off the decoding cores and DELIVERY-FIT-ARM |
| [`final-state`](final-state.md) | what the state `claude/unified` reaches before `main` is called, and its definition | FINAL-STATE (Fable), FINAL-STATE-REVIEW, FINAL-STATE-FIX, FINAL-STATE-FIX-REVIEW | 11-23 | written 2026-11-22: *bench-verified*, with its scope and a line saying what it is not; seven conditions for UNIFIED-PAGE; reviewed 2026-11-23, two blockers; fixed 2026-11-23: *evaluation release* kept as the release's name, *bench-verified* its state, the README line only once the seven conditions hold; re-reviewed 2026-11-23, no blocker open, three nits; the yes or no on both names due |
| `README` | the order to decide in, and what the two weeks left open | DECISIONS-OPEN, DECISION-PAGES-REVIEW, PROGRAM-CLOSE (Fable), BRIEF-1127 | 11-28 | this file, opened 2026-11-19; the order and §Review owed |

## Review

DECISION-PAGES-REVIEW, 2026-11-23, of the 19 pages and `final-state.md` at `c8ff9a96c`, by a session that wrote no
page. Read only: nothing run, no fixture touched, the gate not run (docs). Inputs read at `origin/claude/unified`
`4a2b4277f`, the branches and commits each page names, the status files on `claude/work-ledger`, and PR bodies.

**Method.** Each page against §The form and its row's brief (the program's §Briefs); ten numbers a page that bear on
its recommendation traced to where the page says they were produced, the value and its label checked and the
arithmetic recomputed (200 in all); each inventory row (the program's §The inventory, 1–23) found in its page or in
§Trimmed; each recommendation against the program's §Decided approaches and the owner's later words (amendments 27
and 28, among them 2026-11-23 ~02:00: "we will accept hardware decoding and not checking").

**Passes.**

* Every page has the eight sections in order, but `client-calls` (m9). §8 is followed by a PCS note in
  `exact-frame-layout`, `ingest-optimal-quality` and `pacs-sync`, an appendix the form allows.
* Every inventory row is in its page: rows 1–22 in the page the inventory names, row 23 in `phone-decode-route` §2
  item 10 and §Trimmed. The three pages written after VALUE-STATEMENT (`unified-to-main`, `delivery-per-link`,
  `view-target`) each say how they serve the statement.
* Of the 200 numbers, 188 match their source in value and label; the twelve that do not are m1–m8 and B3. None but
  B3's changes a recommendation.
* No page recommends against a decided approach of 2026-11-19 without saying so in §7; `delivery-per-link`,
  `view-target` and `unified-to-main` already read the 02:00 word.

**Blockers** (amendment 17: DECISION-PAGES-FIX and DECISION-PAGES-FIX-REVIEW appended to the program).

* **B1. Two pages rest a yes or no on "every frame checked" after the owner reopened it for the view.** The word of
  2026-11-23 ~02:00 (the program, amendment 28) shows view frames decoded in hardware unchecked and asks that
  INTEGRITY-PAGE and VL-PAGE be read again against it; both pages were written before it.
  `frame-integrity.md`: §1 opens on "Every frame is checked, in production too"; item 3's "the *unchecked* state
  disappears", item 6's "a no leaves … the view's frames unchecked, against amendment 1" and state 1 assume it; §7
  says "Nothing". `phone-decode-route.md`: item 6 (B1) is "no" so as to keep "every frame … checked", item 9 (4.7,
  hardware paints unchecked) is "no" because "amendment 1 stands", and §7 says nothing reopens. The fix: each item
  read again under the word (a view decoded in hardware shown unchecked, the exact HTJ2K frame checked bit for bit),
  kept or changed with its reason, the 4:2:0 form a hardware view needs named, the unchecked view recorded as a
  disadvantage against DELIVERY-FIT-ARM's HTJ2K-only arm, and §7 naming the reopen.
* **B2. `pacs-sync.md` asks a yes to "the three reviewed PRs"; PR 417 has no review.** Items 1 and 2 (PRs 407, 422)
  cite theirs; item 3 (PR 417, SYNC-RECONCILE, docs) cites none, and no review row or status file for it exists on
  `claude/work-ledger` (the program's table has none either). Amendment 28 rule 1 merges only after a review with no
  blocker. The fix: the recommendation says 417 is unreviewed, and a SYNC-RECONCILE-REVIEW row is appended before
  any sync row takes it.
* **B3. Condition 2 of the final state can be "met" by a status line, on a false premise.** `final-state.md` §5 (the
  three things met today) says the program's fixtures hold no breast ultrasound cine and offers "either an
  ultrasound clip is run end to end, or the status line says … ultrasound stacks carried by theory"; its own §2
  prints that line as the *unmet* form. `unified-to-main.md` §2 and §6 read the status line as closing the condition,
  so the README could say *bench-verified* with no ultrasound run. And `docs/FIXTURES.md` at `4a2b4277f` lists
  `usb_cine` ("breast ultrasound cine, B-mode, … 64 × 512², 8-bit") and `usb_cine_rgb`, both lossy-sourced. The fix:
  §5 says the status line leaves condition 2 unmet; both pages name `usb_cine` as the clip (its numbers provisional
  by FIXTURES.md's lossy-sourced rule); the same "no breast ultrasound cine" corrected where it is said of the
  fixtures rather than of a run (`final-state` §4, `asking` §4, `delivery-per-link` §4: "none in the run").

**Minors** (each one line, corrected in place by the fix row, or said why not).

* m1. `cache.md` §5: "0 of 66 `none` rounds errored"; the rows hold 36 an engine, 72, 0 errored; and only L's
  summaries carry `unjudged`.
* m2. `reports.md` item C: `off′` 0.989 is the ratio of medians where the column is the per-round median (1.013);
  KEEPALIVE-H's busy p99 "2–9 ms" is not in `REPORT-VERDICT-2/output.txt` (2.46, 3.25).
* m3. `phone-decode-route.md` §3: d_E 25.8 and d_V 68.6 "in a fill" are derived (1.29 ÷ 50, (3.68 − 0.25) ÷ 50),
  labelled measured; and its "Missing: PHONE-READ-CODE-CHECK" (also `delivery-per-link`'s preamble) is stale: done
  07:34, no load set apart.
* m4. `visually-lossless.md`: 0.07–0.24 is right from the 19 volumes' rows but linked to `codecs.md`, which holds
  0.07–0.22 for three.
* m5. `delivery-per-link.md` §3 and §5: "4.6–14.6× fewer than B over 19 volumes (**source**, `payload-format.md`)"
  is derived from three volumes' Q 8 ratios; relabel, and drop "over 19".
* m6. `pacs-sync.md` §4: "#223 timed one CT fix … on emulated links"; its source says "Nothing is timed on an emulated
  link": bytes measured, times derived.
* m7. `client-calls.md` §3.2: `readMin`'s numbers are the workstation's (RMD4, Chrome 148, `CLIENTS.md`), not "a
  cloud host"; §1's −0.24 to −0.64 MB is the source's assumption, unlabelled here.
* m8. `unified-to-main.md` §3: PRs 411 and 412's gate figures are the review's merge gates in a column for the
  branch's own (811 s, 477 s); its condition 4 counts the 47 `lab/` directories, which `final-state` §5's condition 4
  does not name; one of the two pages states it the other's way.
* m9. `client-calls.md` has no §5 or §6: the mechanism and what would change are given per item for 3.1–3.3 and 3.9
  only; one line each for 3.4–3.8, or the page says it is shortened.
* m10. `ingest-optimal-quality.md` item 8: the guard is called "cheap insurance" with no cost; I2-RUN measured the
  checks alone at 0.09–0.20 CPU s a megapixel and the full set at +48 to +60 % ingest time against a 10 % bar.
  Quote both; the budget at which it passes is phase 2's (amendment 28, "budgets are ranges").
* m11. Stale against the 02:00 word, beside B1, one clause each: `visually-lossless` §7 (the label states no check
  of the view now), `paused-lines` §2 item 2, §4, §5 ("checked" hardware route), `engines` item 2's "a no leaves",
  `reports` §2 ("every frame … checked" reaches the operator: exact frames only), `final-state` §7 and condition 2
  ("a checked frame on screen": the exact frame checked).
* m12. `non-cine-series.md` §7: written after amendment 28, it never names DELIVERY-FIT-ARM, whose "resolution level
  that fits the screen" is option L read as one codestream; say so.
* m13. Over one screen in §1–3: `frame-integrity` (~134 lines, no links at all), `unified-to-main` (~96),
  `final-state` (~86), `phone-decode-route` (~75), `ingest-optimal-quality` (~73), `transport-stack` (~72). Not
  fixed: moving tables is a rewrite with no claim changed; PROGRAM-CLOSE may.

**Nits** (not fixed): `cache` names P1 and P2, not P3; `transport-stack` §4 leaves out the WT-TS absolute misses its
§5 uses, and ~63 Mbit/s is unlabelled derived; `exact-frame-layout` §7 does not say why strips re-encoded from the
frame keep "the exact HTJ2K frame, bit for bit"; `ingest` does not carry `payload-format.md`'s 2026-11-14 correction
that G at Q 8 is not a property of G; `view-target` does not say the cloud memory arms ran in blocks; `repository`'s
"≈ 27 fetches" is 10 GB, not GiB; `final-state` §Re-review's n1–n3 still open.

**Verdict:** three blockers; DECISION-PAGES-FIX next, DECISION-PAGES-FIX-REVIEW after it (amendment 17).
