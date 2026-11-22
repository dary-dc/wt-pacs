state: started
started: 2026-11-22T09:47Z
heartbeat: 2026-11-22T09:58Z
outputs: `claude/simplify-unified` at bb9a5b1b (pushed; no PR yet)
## Resume
Re-derived against `origin/claude/unified` 4a2b4277: P11 and S6 already landed (the default build refuses the lab
flags, main.rs:133; `ts/build.sh --product` bundles session.js only). P3/S1 mostly landed (lab/viewer/hooks.js);
its ledger residue and every S7 lever wait on pages (view-target, asking, cache, client-calls). Doing P9, one commit
each on `claude/simplify-unified` (local, from 4a2b4277): (1) CUT_DEPTH/cutShift into client/decode/depth-cut.js;
(2) one `now` for view/ and viewer/; (3) the store worker to client/view/store-worker.js. Builds running
(ingest/tools.sh, wasm, ts). Then gate, demo-check both views, push, draft PR into claude/unified.
## Result
