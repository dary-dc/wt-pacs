state: done
started: 2026-11-20T14:47Z
heartbeat: 2026-11-20T15:22Z
outputs: `claude/demo-check-mutants` at `7567248b`, draft PR #418 into `claude/unified`

## Resume

Done. Next: a review row for #418 (none is queued; the standing rule asks one per build).

## Result

* Traced on `claude/unified` `4a2b4277`. `wantFrom` asking `c + 8` on demand is dead code under `--view page`, so
  equivalent there; it is killed under `--view worker`. `show()` asking `want + 8` on a miss lands in groups the
  pass asks anyway (group 1 at the open, group 0 at the jump), so the final 24-frame count misses it.
* A check was missing. #418 adds it: on demand, before each step, the frames received may not exceed the groups the
  steps have reached.
* Mutants, measured, 3 runs each: old check 2 of 4 cells killed, new check 3 of 4. B1 is now killed 3 of 3; A in
  the page view survives, being equivalent there. Every cell matched its pre-registered prediction.
* Fixtures and limits: `dbts_a1-q8-g8-cut` only, one dataset; one 4-core cloud container, headless Chromium on
  SwiftShader, loopback; not the other 19 series, `--link`, Firefox, a GPU or a phone.
* Gate `--quick` OK (484 s), skips named in #418. Line doc `docs/lines/client.md` §Owed runs updated.
* Owner: merging #418 is the yes.
