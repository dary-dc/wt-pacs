state: started
started: 2026-11-11T16:24Z
heartbeat: 2026-11-11T16:30Z
outputs: claude/demo-fixes-2 (from the demo tip claude/demo-fixes-1 daee0d1d); one comment on PR 250 (pending)
## Resume
claude/demo-fixes-2: c210a26b (check_equivalence.sh gains the pair: failing first), b3419cbd (S1 fixed: compose
`exact` service under `--profile pair`, host 4434; nginx locations for EXACT_SERIES; CSP WT_ORIGINS; entrypoint
refuses a bad id or one the OQ metadata does not name; deploy/README). check_equivalence --local passes (nginx run
from mirror.gcr.io/library/nginx:1.29-alpine on the host network, a PATH shim in the scratchpad); 5 template mutants
killed; entrypoint checked in that image (single, pair, mismatch, two bad ids).
Next: gate (setup.sh still building decoders/ingest; then INGEST_BUILD=$PWD/ingest/.build PYTHON=$PWD/.venv/bin/python
scripts/gate.sh), docs/lines/optimal-quality.md Open 4, draft PR demo-fixes-2 -> claude/core, one comment on PR 250.
## Result
