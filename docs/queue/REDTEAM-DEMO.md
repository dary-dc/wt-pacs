state: done
started: 2026-11-11 01:23
heartbeat: 2026-11-11 01:30
outputs: claude/demo-redteam fcb60833 (from claude/demo-fixes-0 618e13c8; no PR: tests and findings)
## Resume
Done. Commits: 0ff50f5f, 7e67b898, 10a3b255 client/viewer/pair-source.test.mjs; 78454ebc, 7e67b898
client/view/depth-cut.test.mjs; ad82e1f3 docs/reviews/demo-redteam.md; fcb60833 docs/lines/optimal-quality.md.
The two test files fail on purpose and are not in scripts/gate.sh; FIX-1 adds them once they pass.
## Result
* Five failing tests (node, no browser), each passing under a sketched fix kept out of the branch:
  1. Another source accepted as exact: checkPair compares framesSha256 only when both carry it; no ingest writes it.
  2. Exact frame read through the OQ series' photometric/rescale/perFrame rescale; checkPair compares none.
  3. Wrong depth after the cut: Controller.take shifts a frame of any bits (the stored form under the cut's
     metadata, both in the demo set, painted x4 as Optimal quality).
  4. checkPair takes an exact series whose digests.frames is empty, short or not 16-hex: the button can only fail.
  5. pairOf admits the ids "." and ".." (other paths; refused later as AV1 today).
* Without a test: the overlay gives the exact (HTJ2K) frame the series' Q, G and depth cut (viewer.js, no node seam).
* Held: Lossless only from the checked exact slot; digests always passed; nothing stale (exact never stored);
  every WebCodecs refusal to dav1d (in-group excepted, the owner's call); index-keyed asks; l/step/paint races.
* Withdrawn before pushing: "lossy.depth must equal bitsStored" (wrong: the ingest codes the used bits' container).
* Not attacked: wire loss and reordering (TEST-MOBILE), GPU, phone. No fixture run: claims are about code paths.
* Owner decision: what names an exact series' source (finding 1 contradicts pair.test.mjs and client/README.md,
  which accept a pair without framesSha256 on purpose): framesSha256 written by the ingest into both, or another key.
