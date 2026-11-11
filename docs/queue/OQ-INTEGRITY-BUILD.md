state: started
started: 2026-11-11T16:28Z
heartbeat: 2026-11-11T16:31Z
outputs: claude/oq-integrity-build (from claude/source-fingerprint), draft PR pending
## Resume
Branch claude/oq-integrity-build = origin/claude/source-fingerprint (c02b5f32), nothing on it yet.
Design (one switch, off by default): ingest_coded.py --integrity writes lossy.reconstruction {algorithm xxh3-64,
frames} (I1) and lossy.codingError {rms, max, noiseBandRatio} (I2) per frame; the client checks a reconstruction
digest whenever the metadata carries one (decoder.js checked(), outcome info.asCoded true/false), re-decodes a
mismatched inter frame's group from its keyframe on dav1d-WASM (I1's gap), label/overlay per I3.
Order: (1) ingest + lossy_test.py claims, mutated; (2) decoder.js/av1.js + node tests, mutated; (3) controller/screen
label+overlay + tests; (4) docs (glossary, payload-format §Optimal quality, client README, line); (5) gate;
(6) I1 cost protocol (proposals.md §I1) on the 18 demo series ingested with --integrity; (7) draft PR into
claude/demo-fixes-2 (the demo tip), marked a proposal.
Setup: bash $SCRATCH/setup.sh (dockerd, .venv py3.11, meson, wasm-pack, playwright, fetch_openjph/xxh3, build.sh,
ingest/tools.sh); gate: INGEST_BUILD=$PWD/ingest/.build PYTHON=$PWD/.venv/bin/python scripts/gate.sh
## Result
