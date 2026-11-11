state: started
started: 2026-11-11T17:50Z
heartbeat: 2026-11-11T18:55Z
outputs: claude/demo-fixes-2 (from 4ba95e1b, MAIN-REVIEW's S1 fix)
## Resume
Done on claude/demo-fixes-2 (pushed): ee04ef57 merge demo-ux, 935c5374 merge source-fingerprint, 2d2af731 merge
demo-clean (items 1-9), 7d45b31f REVIEW-2 F1 + D1 (docs). U1 answered: EXPERIMENTS-OFF item 13 / CLEAN-PRODUCT; U2:
the phone run. check_links 0 unresolved.
Setup done. Full gate GATE OK in 650 s at 7d45b31f (skipped: lavapipe painter/window, cross-codec+Firefox, nginx).
nginx check: deploy/check_equivalence.sh --local passes in nginx 1.29-alpine on the host network (13 paths, 22 hidden).
demo-series.sh done at 7d45b31f: 21 series in 527 s, three fingerprints (7 series each), no framesSha256; exact
bundles 43 B smaller than E2E-3's, each OQ bundle the same size. Now (long, from 18:53): demo-check.mjs, 20 runs x
{page, worker} interleaved by series (scratchpad checks.sh: the README loop with --view). If cut off, re-run that loop.
Then line file, draft PR into
claude/core with the merge record and the finding map.
## Result
