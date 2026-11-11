state: started
started: 2026-11-11T16:28Z
heartbeat: 2026-11-11T16:46Z
outputs: claude/oq-integrity-build (from claude/source-fingerprint), draft PR pending
## Resume
Built and pushed on claude/oq-integrity-build (tests first, each mutated; log $SCRATCH/mutants.md): ingest
--integrity (I1 digests + I2 coding_error.py), av1.js decodeAgain, decoder.js asCoded, controller label/refusal,
screen.js integrityText + viewer label/overlay/status, docs (payload-format §Integrity, glossary, READMEs),
demo-series.sh INTEGRITY=1, lab/oq-integrity/run.mjs (I1 protocol harness).
In flight (lost if the container goes): INTEGRITY=1 VENV=.venv scripts/demo-series.sh $SCRATCH/demo-int; cargo build
-p series-server; client/transport/wasm/build.sh (the gate's prerequisite). Next: gate
(INGEST_BUILD=$PWD/ingest/.build PYTHON=$PWD/.venv/bin/python scripts/gate.sh); then I1 protocol:
node lab/oq-integrity/run.mjs DIR rows.jsonl (correctness: --rounds 1 --throttles 1 --arms on, default route and
--route dav1d; mutants by temporary patches of decoder.js checked() and a flipped inter unit; cost: --rounds 7
--throttles 1,4); rows to lab/oq-integrity/rows/, result in payload-format §Integrity; then draft PR into
claude/demo-fixes-2.
## Result
