state: done
started: 2026-11-11 01:38
heartbeat: 2026-11-11 02:05
outputs: claude/demo-simplify d70ccb9f (from claude/demo-fixes-0 618e13c8; no PR: findings only, docs)
## Resume
Done. d70ccb9f: docs/lines/proposals.md §Simplify (new file; claude/proposals holds the optimizer's part) and a
pointer in docs/lines/optimal-quality.md §State now.
## Result
* Eight findings on the demo path, ranked by what each saves a presenter; nothing removed.
* S1 the lab harness out of viewer.js (~90 of 334 lines: lab hooks, ?check/?deadline/?mutate); after 11-13, with CLEAN-FIND.
* S2 one view: page and worker carry the same intents twice; retire the page view only if VIEW-WORKER-CHECK passes; after 11-13.
* S3 one starter for a pair: README's three terminals duplicate demo-check.mjs serve(); low risk.
* S4 the grey `unchecked` mark beside "Optimal quality" (REVIEW-BLIND C1): drop it for a paired series; no test pins it yet.
* S5 `client ts` and `view page` off the reader's status line, into the overlay; S6 ws/race bundles built into the
  image but unreachable from any product page; S7 lab levers spread into connect options down to the downloader;
  S8 the wasm client, kept (2026-10-16 decision).
* Evidence: controller, view, view-worker, pair and av1 unit tests pass at 618e13c8; browser checks named, not run.
* Fixtures: dbts_a1, dbts_b1, dbts_c1 of one dataset; no ultrasound cine; 4-core cloud host, no GPU.
* Owner decisions: which view the demo shows (S2); whether the mark goes (S4) and the status fields move (S5); when S1, S3, S6, S7 land.
