# Review, round 2 (REVIEW-2, 2026-11-11)

By a session that wrote none of FIX-1, OPT-SIMPLIFY, DEMO-UX, SOURCE-FINGERPRINT or EXPERIMENTS-OFF. It checks
two things. First, does each fix fix its finding? Each fix is reverted on its own and its test must fail. Second,
do the docs' claims match the recorded rows? It changes no product code.

Base: `claude/demo-fixes-1` at `daee0d1d` (the demo tip). Host: a 4-core cloud container without a GPU, Node 22.
No demo series was coded or run in this review, and nothing was timed.

## 1. FIX-1 (#363): each fix reverted

Only the fix commit's source change was reverted (`git show <fix> -- <source> | git apply -R`), at the tip. Where
later commits block that, the hunk was taken out by hand. The tests were `pair.test.mjs`, `pair-source.test.mjs`,
`screen.test.mjs`, `depth-cut.test.mjs`, `controller.test.mjs`, `view.test.mjs` and `view-worker.test.mjs`. All
pass at the tip.

| finding | fix | reverted, what fails |
| --- | --- | --- |
| Red team 1, another source accepted | fdbf8f89 | `pair-source`: "a pair that names no shared source is refused"; `pair.test` too |
| Red team 2, read through another photometric/rescale/perFrame | c9bfa15b (by hand: the `readOtherwise` arm out) | `pair-source`: "an exact series read otherwise than this series is refused" |
| Red team 3, a cut frame of any bits shifted | c6d13a48 | `depth-cut`: "a frame not decoded at 10 bits was painted as the cut" |
| Red team 4, empty or short digest list | 671bdd6f (by hand: the `wholeDigests` arm out) | `pair-source`: "an exact series without a digest for every frame is refused"; `pair.test` still passes |
| Red team 5, `exactSeries` "." and ".." | 15c0235f | `pair-source`: "an exactSeries of dot segments is not a series id" |
| Blind C3 / red team 6, Q/G on the exact frame | 1a038e04 | `screen.test.mjs:20` (its C3 assertion) |
| Blind C1, `unchecked` beside the label | 7d93e030 | `screen.test.mjs:14` (its C1 assertion) |
| Blind C2, failure left after a passing retry | 54ecfe31 | `screen.test.mjs:25` (its C2 assertion) |
| Blind C5, `--codec lossy` accepted | c11a2536 | At the tip, the test's command exits 2 with "invalid choice". Reverted, it gets past argparse and exits 1 at the missing input, so `lossy_test.py`'s check fails. Only that one subprocess ran here: the rest of `lossy_test.py` needs `ingest/tools.sh` built |
| Blind S1, av1.js's config line | c9dc75ae | a comment only; no test, none needed |

**Verdict:** every FIX-1 fix is load-bearing for its own test. Each revert fails the assertion that names its
finding, and nothing else fails. No finding.
