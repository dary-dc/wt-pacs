state: done
started: 2026-11-11T16:24Z
heartbeat: 2026-11-11T17:13Z
outputs: claude/demo-fixes-2 4ba95e1b (from the demo tip claude/demo-fixes-1 daee0d1d), draft PR #367 into claude/core; comment on PR 250 (issuecomment-6801733265)
## Resume
Done. Commits on claude/demo-fixes-2: c210a26b (check first), b3419cbd (S1 fix), 959c3547 (line file; it also dropped
client/decode/wasm/built by mistake, `commit -a` during a rebuild), 4ba95e1b (built/ restored byte for byte).
CI on #367 (4ba95e1b): deploy built the image and check_equivalence.sh passed on it with the pair; then both jobs
failed at apt (the runner could not resolve the Ubuntu mirror), gate before any test. Re-run once (run 43059711188),
explained in a #367 comment; the re-run is green (gate and deploy, 17:13 UTC). Nothing left for this row.
## Result
* Verdict on PR 250: ready for main once #367 is in the demo tip; one blocker, S1, fixed in #367.
* S1: compose `exact` service (`--profile pair`, host 4434), nginx locations for EXACT_SERIES, connect-src naming
  both origins (WT_ORIGINS), entrypoint refuses a bad id or one the OQ metadata does not name; deploy/README.
  check_equivalence.sh gains the pair (failing first); 5 template mutants killed; entrypoint checked in nginx alpine.
* No new blocker in 36d286cd..daee0d1d (FIX-1). Clinical invariant re-checked by hand. Pre-main should-fixes
  T1-T3, V2-V4, V6 still stand (none paints a wrong frame as Lossless); listed in the PR 250 comment.
* Full gate OK in 697 s on 4ba95e1b, nginx check included (nginx 1.29-alpine on the host network: the host's
  apt mirror answered 503). Skipped: native painter and window (no lavapipe/Xvfb), cross-codec arm and Firefox.
* CI's deploy job ran check_equivalence.sh on the built image with the pair: passed. Not run: a browser on an image-served pair, demo-check.mjs.
* Fixtures: the smoke series as a synthetic pair; 4-core cloud host, no GPU; nothing timed.
* Owner decisions: section 4 of pre-main.md (client/native, ~5 100 lab lines, committed decoders); FIX-2 takes #367
  with the rest. The PR 250 comment carries the harness's attribution footer, which this session could not omit.
