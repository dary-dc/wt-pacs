state: done
started: 2026-11-15T12:46Z
heartbeat: 2026-11-15T13:23Z
outputs: claude/cache-arms 822b33a9..ec1b3212 (lab/cache-arms, docs/reviews/cache-arms.md §Fixes, docs/lines/client.md), PR 394 (body: §CACHE-FIX)
## Resume
Done. Nothing owed by this row; CACHE-FIX-REVIEW is next (a session that wrote neither the builds nor the fixes).
## Result
All seven blockers of docs/reviews/cache-arms.md §Verdict fixed, each with a test failing on the code before its fix,
then mutated (31 mutants on the fixes, all killed; table in the review's §Fixes):
1 reads first yields a task (store.js readsFirst); 2 settle() in the seam, close() throws a late refusal, the store
unwrites lost frames; 3 CACHESTORAGE's manifests in an index Cache (a design change by §7.4's own source, said in the
PR body); 4 backlog at last post + 5 s; 5 K's bar against writes in flight; 6 mutant in the arm only, lBars against a
clean none; 7 PSS baseline after the floor. One-line minors fixed (piece=2MiB, a let-go pending slot, OPFS-ASYNC m1,
CACHESTORAGE's test pattern, R/O/T/Q row fields); the rest listed in §Fixes.
Smoke (Chromium 153, one run each, not results): reads served mid-write with 2 MiB pieces; E's five sets hold with
CACHESTORAGE and IDB, so the README's late-space amendment is withdrawn (corrected in place); Q names a late refusal.
Gate --quick passes with the two pre-existing devices.md link paths set aside locally and its by-name skips;
check_lab_absent passes. Fixtures: 4-vCPU cloud host, no GPU, Node mocks, headless Chromium 153; no Firefox/WebKit/phone.
