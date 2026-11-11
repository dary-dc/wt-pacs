state: done
started: 2026-11-11T17:48Z
heartbeat: 2026-11-11T18:28Z
outputs: claude/phone-tools c6da7275, draft PR #369 into claude/demo-fixes-2 (not for the demo)
run commit: c6da7275
## Resume
Done. Nothing pending.
## Result
Branch from claude/demo-ux, + --no-ff claude/demo-fixes-2 (twice: 07b42c09, abc4d0b5).
1 40b797db image revision label (REVISION); 4 mutants killed.
2 d7c409d9, c6da7275 FEATURES build argument for a test-only telemetry server image; 4 killed; both images built
  with docker and inspected (labels right; telemetry strings only in the telemetry binary).
3 2369a515 README step 8: which read path (banner read_fast_path/read_ring, session ring=); docs only, unmeasured.
4 6f449808 lab/phone/beacon.js (?beacon=), ledger gains wireBytes/decodeMs; dev-server.py --beacon-log (off by
  default); 12 mutants killed.
5 9b7109b4 lab/phone/ runner + start page (§7's amended 56 loads), run_test.sh headless on a synthetic pair
  across 2 controllers x 2 links: plan runs whole; a killed exact server stops it at load 1; 7 node + 3 headless
  mutants killed.
Full gate OK (583 s; skipped: native painter/window, cross-codec+Firefox, nginx).
Fixtures: synthetic 10-bit 64x48x20 pair, loopback, headless Chromium/SwiftShader, 4-core cloud host. No phone.
Owner: the PR overlaps CLEAN-PRODUCT (viewer.js lab hooks; the telemetry image needs lab/server-telemetry in the
image's copy). The phone session uses run commit c6da7275, not the demo commit.
