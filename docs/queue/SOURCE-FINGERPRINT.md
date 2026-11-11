state: done
started: 2026-11-11T14:42Z
heartbeat: 2026-11-11T17:05Z
outputs: claude/source-fingerprint c02b5f32 (from claude/demo-fixes-1 daee0d1d), draft PR #364 into claude/demo-fixes-1
## Resume
Done. Tests f93e6f2f, 1a24a0db, bb56c1dc; fixes 8e7027a5 (checkPair), 64a42e19 (the three ingests); docs 65ba6df3,
c02b5f32; depth-cut fixture 8c67a26d.
## Result
* Every ingest writes `sourceFingerprint`: XXH3-64 over the source's per-frame XXH3-64 digests, taken as an HTJ2K
  series takes them (no second pass for an exact HTJ2K series). Exact, optimal-quality, cut and stored form share it.
* `checkPair` requires the same 16 hex digits in both series instead of `framesSha256`, which stays the fetcher's
  download pin and is no longer copied into a series. One glossary row; payload-format §Source fingerprint.
* Threat: an accidental mispairing, not an adversary.
* Mutants: 11 killed, 1 equivalent. Full gate OK, 698 s (skipped: lavapipe, Xvfb, Firefox, nginx).
* demo-series.sh run again: 20 of 20 pairs accepted; each refused against the other sets' exact series by source.
  No browser run on these series. Fixtures: synthetic sets; dbts_a1/b1/c1 (one dataset). Nothing timed.
* Owner decision: whether #364 enters the demo (FIX-2 takes it only with the owner's word recorded in the queue).
  Every demo series must then be written again.
