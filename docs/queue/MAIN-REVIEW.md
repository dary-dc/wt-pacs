state: started
started: 2026-11-11T16:24Z
heartbeat: 2026-11-11T16:27Z
outputs: claude/demo-fixes-2 (from the demo tip claude/demo-fixes-1 daee0d1d); one comment on PR 250 (pending)
## Resume
Branch claude/demo-fixes-2 pushed at daee0d1d (= the demo tip claude/demo-fixes-1). Reviewed so far: PRE-MAIN-REVIEW's
pre-main.md (main...36d286cd) and the product delta 36d286cd..daee0d1d (FIX-1: pair.js, screen.js, controller.take's
cut check, viewer.js): no blocker in it. Blocker S1 (the owner's word): the web image serves no exact pair.
Fix in progress: deploy/check_equivalence.sh gains a pair arm (failing first), then compose `exact` service
(host 4434 -> container 4433), entrypoint/template EXACT_SERIES locations, CSP naming both origins, deploy/README.
Gate setup: bash $SCRATCH/setup.sh (README §Prerequisites cloud paragraph: dockerd, wasm-pack, playwright,
fetch_openjph/xxh3, .venv on python3.12, meson, transport wasm, decoders, ingest/tools.sh), then
INGEST_BUILD=$PWD/ingest/.build PYTHON=$PWD/.venv/bin/python scripts/gate.sh. No host nginx (apt mirror 503).
Then: one comment on PR 250 (verdict, blockers and where fixed, off the default path = pre-main.md §4).
## Result
