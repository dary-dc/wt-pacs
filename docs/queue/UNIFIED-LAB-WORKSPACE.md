state: done
started: 2026-11-21T11:46Z
heartbeat: 2026-11-21T12:14Z
outputs: claude/lab-workspace a791353f1, draft PR 424 into claude/unified
## Resume
Done. Next: UNIFIED-BUILDS-REVIEW (with UNIFIED-LEVERS and OPENJPH-BUMP), by a session that wrote none of them.
## Result
* lab/Cargo.toml: disk-access-bench, container-bench, window-harness, telemetry-bench, metadata-store in a workspace of
  their own, with a lock pruned from the root's (no version moved) and the root's patches and release profile;
  cc-classify and server-telemetry stay root members (series-server's lab features name them).
* The image stops copying the five; the gate tests them in lab/ with --locked; 39 lab scripts and READMEs split
  their builds; lab/.cargo/config.toml keeps binaries in the root's target/.
* Measured here (4-core cloud host, no GPU; no lab cell run): lab tests 39 passed in 25 suites, as at 4a2b4277f; the
  image's build stage as its COPY lines copy it resolves --locked and checks series-server.
* Mutants of the gate's lab step: broken test, dropped member, deleted lock, dropped locked crate killed; an unknown
  name in a lock entry's dependencies survives (cargo ignores it).
* scripts/gate.sh: OK in 754 s. Skipped: native painter and window (no lavapipe or Xvfb), the viewer's cross-codec arm
  and Firefox, the web host check (no nginx). check_links 0 unresolved; comment budget ok.
* Line doc: docs/lines/coordination.md §Open 6 on the branch.
* Owner: merging PR 424 is the yes to a second lock file for lab/ (structural).
