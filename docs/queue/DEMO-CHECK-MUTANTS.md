state: started
started: 2026-11-20T14:47Z
heartbeat: 2026-11-20T14:49Z
outputs: `claude/demo-check-mutants` (not yet pushed)

## Resume

Read so far (static, on `origin/claude/unified` `4a2b4277`): REVIEW-E2E2's two survivors are in
`claude/demo-e2e-2-fixes:docs/reviews/demo-e2e-2.md` table rows 42-43 and finding 6. Under the default `--view page`,
`Controller.show()` asks only `this.current` and only on a miss; `wantFrom`'s on-demand branch is read only by the
view worker's store (`store.downloader`) and by `firstWant` under the lab's `pageDials`. Hypothesis: mutant A
(`wantFrom` adds `c + 8`) is dead code in the page view; mutant B (`show()` asks `want + 8`) only fires on misses,
whose `+ 8` lands in groups the pass asks anyway; and `received N` counts distinct frames (`FrameStore.put` drops a
duplicate), so a re-ask is invisible.
Next: build (ingest/tools.sh, client bundles, server), code dbts_a1 and dbts_a1-q8-g8-cut only, run
`demo-check.mjs` both views with each mutant applied. Work tree: branch `claude/demo-check-mutants` from
`origin/claude/unified`.

## Result

(not yet)
