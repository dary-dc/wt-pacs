state: started
started: 2026-11-11T18:57Z
heartbeat: 2026-11-11T18:58Z
outputs: claude/oq-integrity-build (findings in docs/reviews/oq-integrity.md)
## Resume
Read: PR #368 body, theory (claude/oq-integrity 39a7bdd3 §Integrity), client diff. Worktree on claude/oq-integrity-build 08bf659e.
Next: (1) revert each source change with its test kept (client: node client/decode/av1.test.mjs, decoder.test.mjs,
client/view/controller.test.mjs, client/viewer/screen.test.mjs; ingest: coding_error_test.py, lossy_test.py);
(2) trace every path to quality "asCoded" (preview, view worker, refused frame's label); (3) rows in
lab/oq-integrity/rows/ against I1's protocol (cells, rounds, first picture, mutants); (4) write docs/reviews/oq-integrity.md.
## Result
