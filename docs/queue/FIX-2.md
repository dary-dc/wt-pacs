state: started
started: 2026-11-11T17:50Z
heartbeat: 2026-11-11T17:50Z
outputs: claude/demo-fixes-2 (from 4ba95e1b, MAIN-REVIEW's S1 fix)
## Resume
Claimed. Plan, each step pushed to claude/demo-fixes-2 as it lands:
1. merge --no-ff claude/demo-ux (14605f41; carries #360, #362, #359, #356)
2. merge --no-ff claude/source-fingerprint (c02b5f32; the owner's word 16:20)
3. merge --no-ff claude/demo-clean (abbb441d; the owner's yes on items 1-9, 17:30)
4. REVIEW-2's findings: F1 (pocgap.py framesSha256), D1 (line file's Lossless 3-6 s); U1, U2 answered; C1 by step 6
5. gate (decoders + ingest/tools.sh built)
6. scripts/demo-series.sh again from the merged tip; demo-check.mjs on every series, both views
7. line file, draft PR into claude/core
Nothing "adopt" from REDTEAM-PROPOSALS; E2E-3 recorded no failure.
## Result
