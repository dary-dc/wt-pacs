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
