state: started
started: 2026-11-20T14:47Z
heartbeat: 2026-11-20T14:57Z
outputs: `claude/demo-check-mutants` `5914a1b6` (the new check; no PR yet)

## Resume

Static trace (on `origin/claude/unified` `4a2b4277`): under the default `--view page`, `Controller.show()` asks only
`this.current` and only on a miss; `wantFrom`'s on-demand branch is read only by the view worker's store and by
`firstWant` under the lab's `pageDials`. `received N` counts distinct frames (`FrameStore.put` drops a duplicate).
Pushed: `5914a1b6`, a check in `demo-check.mjs`: on demand, before each step and before Home, the frames received
may not exceed the frames of the groups the steps so far have reached (an upper bound: correct code cannot exceed it).

Mutants (`client/view/controller.js`; applied by `$SCRATCH/logs/mutate.py`, recreate from here if lost):
A `wantFrom` on demand returns `[c, c + 8]` (in range); B1 `show()`, on a miss, also asks `(want + 8) % n`;
B2 `show()`, on every page-view step, asks `(current + 8) % n` if not held.
Predictions, written before any run (`dbts_a1-q8-g8-cut`, G 8, 56 frames; old check = `4a2b4277`, new = `5914a1b6`):
* page view: A survives both (dead code there: equivalent in the page view); B1 survives the old (its extra asks land
  in group 1, asked at step 8 anyway, and at the jump in group 0, held) and is killed by the new (16 > 8 before
  step 8); B2 is killed by both (group 2 asked at steps 8-12: 32 received, not 24).
* worker view: A killed by both (group 2 wanted at steps 8-12).
Done: builds; dbts_a1 and dbts_a1-q8-g8-cut coded; unmutated, the new check passes in both views. Running: `$SCRATCH/logs/mutants.sh` (log mutants.log). Was: builds and the two series in background (`$SCRATCH/logs/build.sh`, `series.sh`; `$SCRATCH` is the session
scratchpad); then `NODE_PATH=... node client/viewer/demo-check.mjs demo-series dbts_a1-q8-g8-cut [--view worker]`
on the unmutated code (old and new check), then each mutant, 3 runs each.

## Result

(not yet)
