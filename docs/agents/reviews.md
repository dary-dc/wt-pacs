# Reviews and the fix loop

## Who does what

* A session never reviews work it wrote.
* A review row follows every build, by a session that wrote none of it: each test fails without its change (revert
  and see), and the change touches nothing else (the gate; `demo-check.mjs` in both views where the client is
  touched).
* A measurement's protocol is pre-registered by a session that will not run it, with a prediction per cell; an
  amendment before any run if the host forces one. The run reports every cell against its prediction, misses
  included; the verdict is reviewed by a session that ran none of it.
* Every new test is mutated: say which mutants it killed. Each fix has a failing test first.

## The fix loop

A review that finds blockers starts the fix loop itself: it appends to its queue a **<ROW>-FIX** row (each blocker
fixed, a failing regression test first, mutated) and a **<ROW>-FIX-REVIEW** row (a session that wrote neither: each
blocker closed, its test failing without its fix, nothing else changed), and makes the next row's needs wait on the
re-review. Two rounds at most: after a second review with blockers open, the row is `blocked` for the owner.
