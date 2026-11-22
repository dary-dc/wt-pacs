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
| `visually-lossless` | what the view may claim before any reader, and the bar | VL-CRITERION (Fable), -REVIEW, VL-READS; VL-PAGE | 11-24 | not written |
| `reports` | how the load and safety reports leave the page | *REPORT-RUN, REPORT-VERDICT-REVIEW*; REPORT-CELLS, -REVIEW, REPORT-RUN-2, REPORT-VERDICT-2; REPORTS-PAGE | 11-24 | not written |
| `view-target` | the page view or the worker view | *PHONE-ROUND, PHONE-READ, PHONE-READ-REVIEW*; VIEW-PAGE | 11-24 | not written |
| `phone-decode-route` | how a phone decodes a series, on which phones | *DEVICE-THEORY (Fable), PHONE-ROUND, PHONE-READ, MOBILE-DECODE-REJUDGE*; ROUTE-POLICY (Fable), -REVIEW; PHONE-ROUTE-PAGE | 11-25 | not written |
| `paused-lines` | resume native or the viewer, and for what | PAUSED-LINES-PAGE | 11-25 | not written |
| `client-calls` | the client's smaller owed calls, one section each | DEMO-CHECK-MUTANTS, WORKER-FLAKE; CLIENT-CALLS-PAGE | 11-25 | not written |
| `unified-to-main` | what `claude/unified` still needs before `main` | the unified track (the program's §Rows); UNIFIED-PAGE | 11-25 | not written |
| `frame-integrity` | what the green mark proves, and what happens when a check fails | OQ-INTEGRITY-FIXES, -REVIEW, I2-RUN; INTEGRITY-MODEL (Fable), -REVIEW; INTEGRITY-PAGE | 11-26 | not written |
| `repository` | housekeeping calls outside the product | REPOSITORY-PAGE | 11-26 | not written |
| `asking` | what a view asks for, and in what order | ASK-MODEL (Fable), -REVIEW; ASK-PAGE | 11-27 | not written |
| `non-cine-series` | what a series that is not cine-like gets | NON-CINE-OPTIONS (Fable), -REVIEW; NON-CINE-PAGE | 11-27 | not written |
| `delivery-per-link` | the view, the exact series, or both, per link | DELIVERY-PROTOCOL, -BUILD, -BUILD-REVIEW, -RUN, -VERDICT-REVIEW; DELIVERY-PAGE | 11-27 | not written |
| [`final-state`](final-state.md) | what the state `claude/unified` reaches before `main` is called, and its definition | FINAL-STATE (Fable), FINAL-STATE-REVIEW | 11-23 | written 2026-11-22: *bench-verified*, with its scope and a line saying what it is not; seven conditions for UNIFIED-PAGE; review owed |
| `README` | the order to decide in, and what the two weeks left open | DECISIONS-OPEN, DECISION-PAGES-REVIEW, PROGRAM-CLOSE (Fable), BRIEF-1127 | 11-28 | this file, opened 2026-11-19; the order and §Review owed |
