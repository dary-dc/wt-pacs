state: started
started: 2026-11-11T14:42Z
heartbeat: 2026-11-11T16:05Z
outputs: claude/source-fingerprint (from claude/demo-fixes-1 daee0d1d)
## Resume
Pushed on claude/source-fingerprint: f93e6f2f (pair tests) + 8e7027a5 (checkPair on sourceFingerprint; mutants 3 of 4
killed, 1 equivalent); ingest tests + 64a42e19 (ingest.py source_fingerprint, ingest_coded.py drops framesSha256,
from-parser main.rs); 8-bit signed e2e test. lossy_test, end_to_end_test, same_test pass with ingest/.build built.
Mutants killed: AV1 over own digests, separator (py, rs), dropped frame, framesSha256 carried, none on OQ, rs field gone.
Docs pushed (payload-format §Source fingerprint, glossary, FIXTURES, READMEs, the line); depth-cut fixture regenerated.
Running: scripts/demo-series.sh into the scratchpad (VENV=.venv) to check a real pair's fingerprints and checkPair.
Next: that check, scripts/gate.sh, draft PR into claude/demo-fixes-1, status done.
Commands: cd wt-pacs; git checkout claude/source-fingerprint; .venv (ingest/requirements.txt); ingest/tools.sh.
## Result
(pending)
