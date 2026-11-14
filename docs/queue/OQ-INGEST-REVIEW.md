state: done
started: 2026-11-14T23:09Z
heartbeat: 2026-11-14T23:19Z
outputs: claude/oq-ingest 8ea8aba6 (docs/lines/optimal-quality.md item 6); findings in PR #390's body (Review)
## Resume
Done. Findings in PR #390's body, section "Review (OQ-INGEST-REVIEW …)".
## Result
No blocker. Flag off: same bundle bytes, files, stdout and exit code as e5b20cba's from-parser on same_test.py's six
synthetic sets (--jobs 2); with the flag the exact bundle unchanged. check_lab_absent.sh green; the Rust change
imports nothing from lab/ (same.py's lab/av1 import predates it). cargo test -p from-parser 11 ok, same_test.py 4 ok.
Mutants: 4 of the PR's re-run, all killed; 6 of mine, 1 killed, 5 survive: the aomenc pin dropped, pinned() with the
flag off (aomenc then needed with the flag off), exit 0 on a refusal, and the two checks the PR declares untested.
Wording: "both ingests refuse s12" is same.py's own refusal; ingest.py's lossy_header does not refuse it.
Not run: full scripts/gate.sh (no transport WASM package, wasm32 target or wasm-pack on this host; the author's full
gate at 7a459b23 stands), dbts_a1, demo-check.mjs. Fixtures: synthetic sets, 3 frames at 40 × 24; 4-core host.
Owner: none new; tests for the three survivors are a small follow-up on the branch if wanted.
