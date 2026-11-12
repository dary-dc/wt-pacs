state: done
started: 2026-11-12T14:01Z
heartbeat: 2026-11-12T15:23Z
outputs: claude/unified-client e3bf1a10 (code tip 95dc4733), draft PR #382 into claude/core
## Resume
Done; nothing left for this row. UNIFY-REVIEW reviews claude/unified-client (#382).
## Result
* From the demo tip claude/demo-fixes-2 18d2d1ff (demo commit 157b7109 + docs), --no-ff: 2b531f6c claude/clean-product
  (CLEAN-REVIEW's docs, 56bfc38f); a96520f4 CLEAN-2 #375 (18f96938); 95dc4733 NAMES-1 #374 (311af9c7), last; e3bf1a10 line file.
* No conflicts. Old-name residues also on names-1 (not merge-made), for UNIFY-REVIEW: client/README.md:268,271;
  lab/faultbench/index.html:28 reads info.path (now info.route); docs/lines/optimal-quality.md:261-262.
* Left out: #376, #378 (await PHONE-FIX-REVIEW); #368-#370, #377 (separate); #372 (outside the line's product work);
  the rest of LINES-READY §7 (runs, harnesses, unreviewed designs; native #277/#278 unreviewed).
* demo-series.sh 21 series (745 s); full gate GATE OK 850 s (skipped: native painter/window, cross-codec + Firefox,
  nginx); comment budget ok; demo-check 20 runs x {page, worker}, interleaved by series: 40/40 passed.
* Fixtures: dbts_a1/b1/c1, one dataset; no ultrasound cine; one 4-core cloud host, no GPU, headless Chromium on
  SwiftShader, loopback; one run per cell; correctness only, nothing timed; no phone. CI on #382 (gate, deploy) at e3bf1a10: suite completed, none failed.
* Owner: whether the branch carries CLEAN-2 and NAMES-1 (merged on the brief's word, neither reviewed yet).
