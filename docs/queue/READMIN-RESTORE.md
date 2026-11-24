state: done
started: 2026-11-23T11:07Z
heartbeat: 2026-11-24T04:50Z
outputs: claude/readmin-restore (PR 439, draft → claude/unified)
## Resume
2026-11-24T04:50Z: done. Next: READMIN-RESTORE-REVIEW (a session that wrote none of it).
2026-11-24T04:36Z: found the committed dist/session.js was the "catch rethrows" mutant (pin was right); rebuilt and pushed 9f03d1940. Gate running again (PYTHON=.venv/bin/python scripts/gate.sh in /home/user/rr); then the draft PR → claude/unified.
2026-11-24T04:31Z: built (ingest/tools.sh 1m49s, wasm build 2m30s, tree clean). Running: cd /home/user/rr && PYTHON=.venv/bin/python scripts/gate.sh; then the draft PR → claude/unified.
2026-11-24T04:27Z: branch at 0ac78175e, nothing new to push. Running: dockerd, meson 1.9.1, .venv (ingest/requirements.txt), ingest/tools.sh, client/decode/wasm/build/build.sh; then PYTHON=.venv/bin/python scripts/gate.sh; then the draft PR → claude/unified.
2026-11-24T04:26Z: resumed by a phase 2 worker (stalled since 11-23 11:22). Next: rebuild, gate, draft PR.
Lost at dd681539 (stage B2). Pushed on claude/readmin-restore: 7ecf830d (clause, fails on unified: 792/793), f157a8c2 (fix,
dist/session.js rebuilt + repinned; 793/793, all four rigs green), 0ac78175 (docs in place). Mutants: catch claims full (killed),
catch rethrows (killed), head parsed before 8 bytes (survives: no clause cuts inside the head). Running: ingest/tools.sh, client/decode/wasm/build/build.sh, then PYTHON=.venv/bin/python scripts/gate.sh (logs in the session scratch); then draft PR (body drafted).
## Result
* PR 439 (draft → claude/unified): readMin names a cut frame again; fix 4019518a (merged at 82db21c4, PR 136) was
  undone by dd681539 (stage B2), restored; readMin stays off by default.
* Found on the resume: the committed dist/session.js at f157a8c23 was the "catch rethrows" mutant left built by the
  mutation run (its pin was right); rebuilt to the pin at 9f03d1940.
* Gate at 9f03d1940: GATE OK in 808 s; dispatch ts 793/793 (792/793 on claude/unified), wasm 102/102. Skipped by
  name: native painter, native window, viewer cross-codec arm and Firefox, web host check.
* Mutants (11-23, not re-run): two killed; "head parsed before 8 bytes" survives (no clause cuts inside the head).
* Fixtures and limits: the dispatch rig's synthetic frames and stand-in transport; headless Chromium, 4-core cloud
  host, no GPU; no timing claimed.
