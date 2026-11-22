state: done
started: 2026-11-22T15:17Z
heartbeat: 2026-11-22T15:44Z
outputs: PR 423, 424, 425 bodies §UNIFIED-BUILDS-REVIEW (branches unchanged: claude/lab-levers-one-field 78215e1c1, claude/lab-workspace a791353f1, claude/openjph-0-33 304316750)
## Resume
Done. Nothing pushed to the three branches; findings in their PR bodies. Next: UNIFIED-PAGE reads the verdicts.
## Result
* Verdict: no blocker in any of the three; no fix rows appended.
* 423: tests 153/160 reproduced; mutants M1-M6 as claimed; M5 (--advise-tile-names) and a new M7 (send window's
  margin halved) survive, both on the base too; M8 (flag ignored) killed; --help identical, check_telemetry_absent OK.
* 424: locks' (name, version, source) sets checked, nothing added or moved; every lab/ manifest resolves to the
  workspace it should; lab step 39 tests/25 suites reproduced, member-dropped mutant killed; the image's COPY set checks
  series-server --locked. m1: nothing checks that the two locks (and lab/Cargo.toml's copied tables) stay equal.
* 425: tag 0.33.0 = 345a8bcd; commit quotes match upstream (release note not re-fetched: API scope); built/ matches the
  manifest; 80 frames from upstream's 0.33.0 encoder (odd heights, 8-16 bits) decode identically under both builds and
  equal their input; node decode-time ratio new/old 0.80-1.24, median ~0.99, unresolved.
* Together: test merge 423, 424, 425 into claude/unified clean; gate.sh --quick GATE OK 590 s; check_lab_absent OK.
  Skips: ingest steps, decoders' rebuild, native painter/window, numpy checks, cross-codec arm and Firefox, nginx.
* Fixtures: tracked small fixtures, synthetic HTJ2K frames, no DBT volume; one 4-core cloud host, no GPU, node.
* Line docs left as the PRs write them (no claim changed by the review).
* Owner: merge each or not; for 424, whether the gate should check the two locks agree; for 423, test or remove
  --advise-tile-names.
