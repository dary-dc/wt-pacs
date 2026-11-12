state: done
started: 2026-11-12 15:01
heartbeat: 2026-11-12 15:10
outputs: claude/fable-design 9edcb3e7 (from origin/main 017a3ca6), draft PR #383 into main (docs only)
## Resume
Done. 9edcb3e7: docs/proposals/design-fable.md and a pointer in docs/lines/client.md. Read first, alone:
docs/lines/client.md, docs/lines/optimal-quality.md, docs/adr/frame-path.md (§1–§6, §8, §Target, §The core,
assembled) and client/ on claude/demo-fixes-2 18d2d1ff; then claude/proposals:docs/lines/proposals.md (b6e4b47d) and
claude/fable-simplify:docs/proposals/simplify-fable.md, to drop what they hold. Nothing implemented or measured;
scripts/check_links.py 0 unresolved; the gate not run (no code changed).
## Result
* P1 A Lossless frame, once fetched, is held: the controller's one slot is emptied by a step, a second press while
  fetching, or a late arrival, so a return pays 1.0–2.2 MB again (0.7–6.7 s on the measured links). A frame store
  for the exact series, the same class. How often readers return is not known: that count decides its worth.
* P2 The dial waits for nothing it does not need: the pair's fetches and the decoder manifest are awaited before
  the dial; one to two round trips off the first picture (60–120 ms at 30 ms each way, an assumption).
* P3 The decided OPFS cache admits no optimal-quality frame (no digests, nothing checked true), so the product's
  default series is never cached and memory has no working bound; PR 368's reconstruction digest is the dependency.
* P4 The last pass over a 10-bit frame as a row copy; only if FILL-SPLIT finds the script passes over 5 % of a frame.
* Where two decisions cost, not reopened: Lossless is the whole exact frame; a cache of decoded samples is 37–55x
  the coded bytes of an optimal-quality series (228, 852, 338 MB against 4.7, 23.2, 6.2 MB).
* Dropped as already answered here: late exact dial, WASM code cache, hardware decode, key-only groups, the scrub.
* Limits: three DBT volumes of one dataset; read only; the server less deeply; the phone rows not read.
* Owner decisions: yes or no on P1 and P2 as build rows; whether P3's dependency changes PR 368's weight; whether
  Lossless staying on across steps (optimal-quality.md Open 8) is wanted once P1's store exists.
