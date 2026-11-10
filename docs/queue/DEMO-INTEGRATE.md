state: started
started: 2026-11-10 21:23
heartbeat: 2026-11-10 21:40
outputs: claude/demo-fixes-0 2d566c67 (no PR yet)
## Resume
Demo tip was claude/core-next-fixes 9eee7181. Already in it: oq-ingest-fixes, oq-depth-cut (6f61ff0b, unmoved since
04:08), oq-depth-cut-fixes, phone-setup-fixes, phone-pair. Merged --no-ff on claude/demo-fixes-0:
f224e45e gate-cloud (conflicts README §Prerequisites, coordination.md: both kept; the deploy bullet marked fixed),
afd2e18b double-decode-check (conflicts downloader.js: the tip's #299 check kept, the same check; test file: the
tip's tests kept, aFrameAskedDuringAFillIsDecodedOnce added; mutant `if (!rec) return;` killed by it),
2d566c67 demo-e2e-2 (DEMO-E2E-2's own fix of its one failure, the certificate renewal; no conflicts).
gate.yml already runs on PRs into claude/core (O1). DEMO-E2E-2 recorded no other failure.
Next: gate setup (dockerd, pip install meson==1.9.1, client/decode/wasm/build/build.sh, ingest/tools.sh), then
scripts/gate.sh on claude/demo-fixes-0; then draft PR into claude/core with the merge record; then CI.
## Result
