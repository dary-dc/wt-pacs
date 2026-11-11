state: started
started: 2026-11-11T17:50Z
heartbeat: 2026-11-11T18:50Z
outputs: claude/demo-fixes-2 (from 4ba95e1b, MAIN-REVIEW's S1 fix)
## Resume
Done on claude/demo-fixes-2 (pushed): ee04ef57 merge demo-ux, 935c5374 merge source-fingerprint, 2d2af731 merge
demo-clean (items 1-9), 7d45b31f REVIEW-2 F1 + D1 (docs). U1 answered: EXPERIMENTS-OFF item 13 / CLEAN-PRODUCT; U2:
the phone run. check_links 0 unresolved.
Setup done. Full gate GATE OK in 650 s at 7d45b31f (skipped: lavapipe painter/window, cross-codec+Firefox, nginx).
nginx check: deploy/check_equivalence.sh --local passes in nginx 1.29-alpine on the host network (13 paths, 22 hidden).
Now (long, started 18:42): PYTHON=python3.12 scripts/demo-series.sh -> demo-series/ (not committed).
Then: scripts/demo-series.sh (all series, written again with sourceFingerprint) and demo-check.mjs on every series of
README §Demo under --view page and --view worker, interleaved by series (REVIEW-2 C1). Then line file, draft PR into
claude/core with the merge record and the finding map.
## Result
