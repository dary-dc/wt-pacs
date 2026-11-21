state: started
started: 2026-11-21T09:17Z
heartbeat: 2026-11-21T09:20Z
outputs: findings in PR 410's body (claude/engines)
## Resume
Done: E1-E26 verbatim at their pins, all hold (one omission: BCD's Firefox getStats note); raw rows of cells 1-3
match §Measured. Found: Firefox dispatch log lines 2-3, 7 say WebCodecs took none of the payloads, so the G = 8
failure ran on dav1d, not Firefox's VideoDecoder as §Measured's "So" says. Now: building the decoders
(client/decode/wasm/build/build.sh, docker) on a worktree of origin/claude/engines to run the dispatch rig in
Chromium with WebCodecs refused, to tell engine from client. If that cannot finish, write findings without it.
Next: findings into PR 410's body §ENGINE-REVIEW; amendment 17 rows if blockers.
## Result
