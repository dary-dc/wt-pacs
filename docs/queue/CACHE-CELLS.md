state: blocked
started: 2026-11-25T12:07Z
heartbeat: 2026-11-25T13:27Z
by: Nbp96Zk8
outputs: claude/cache-arms 5766cfc53, dbccc29d3, 8f2110c83 (builds), b82e1c2c4 (script), rows/chromium-1125/ to e4a032947; claude/page-runs 7962e2551 (§5 Amendment), e70ab1ca4 + eec7352e4 (§Cache: results, docs/lines/client.md)
## Resume
Chromium done and pushed: the four builds, the mutants (4 of 4 caught), L S1 and S2, T, O S1 and S3, 12/12/12/6/6 rounds, results in
page-runs.md §Cache: results. Blocked: every Firefox cell. Fetching firefox-159.0.1.tar.xz from archive.mozilla.org was refused in this
container ("Permission for this action was denied" by the session's tool permission check, 2026-11-25 12:12 UTC). Commands for a host that
can fetch it are in page-runs.md §5 Amendment (cells-1125.sh firefox mutants, L-512, L-2560, O-512, O-3328). Nothing else is owed.
## Result
Chromium 158 (headless shell), measured; provisional on the store question (CACHE-DESIGN-1124 never ran).
L: OPFS-SYNC's growth over none is ~87-90 MiB, all in the renderer, at S1 (112.1 MiB) and at S2 (115.8): one process, does
not scale with the frame. Prediction held. The A/A median |dPSS| is 9.8 / 9.7 MiB, so the PSS bar is not VOID. OPFS-ASYNC
passes every L bar at S2; both stores fail PSS alone at S1. No none round errored. No storage process on this build.
T: 13 of 349 tab-2 re-reads not exact. Every one is hit false, NotReadableError. 0 SHA-256 mismatches after a passing XXH3.
Prediction held: no correctness defect (the cause is theory, a stale getFile() snapshot).
O: OPFS-ASYNC's S1 cold reopen took 0.53 ms a frame (1.46 before), held under 1 ms. Warm is VOID (A/A 0.892).
O: S3 refuted, x1.51 warm and x1.19 cold against CACHE-RUN; OPFS-SYNC moved x1.13 on the same cell (build or host), the rest unexplained.
Firefox: unrun, item 4's pre-registered cell among them (blocked, above).
Fixtures: the rig's synthetic 16-bit fields only, no DBT or US pixels; one 4-vCPU cloud container without a GPU; 1x only.
For the owner (BRIEF-WEEKEND): none new. Run the Firefox cells on a host that can fetch 159.0.1, by the commands named above.
