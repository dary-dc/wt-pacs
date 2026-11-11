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

## 2. Docs claims against the recorded rows (FIX-1, E2E-3, TEST-MOBILE)

* **Byte fractions.** Checked: `docs/lines/optimal-quality.md` §State now, `docs/reviews/e2e-3.md` step 2, and
  `docs/av1/payload-format.md`'s two byte tables. Each was computed again from E2E-3's per-series KB (KiB) and the
  exact series' bytes in `payload-format.md` (67 815 186, 107 410 134 and 70 668 114 B). All 20 series agree with
  the tables to within the last digit's rounding (at most 0.0001). The line file's ranges hold: 0.0685–0.0687,
  0.216–0.219, 0.088–0.090, and Q 24 at 0.003–0.025.
* **E2E-3's counts.** 60 = 20 series × 3 arms. The 28 runs that could stall are `dbts_a1`'s and `dbts_c1`'s 14
  series × page and worker. The 14 stricter runs are those series once. The arithmetic holds.
* **TEST-MOBILE in the line file.** The line file says "36 s, Lossless 3–6 s, `dbts_b1` did not fill in 120 s".
  That is the no-jitter 40 ms 2 % cells of `docs/reviews/demo-tests-mobile.md`: 36 189 ms, 5 884 / 2 757 ms, and 33
  of 50 frames. With jitter, *Lossless* took up to 17 s (its §2). The line file omits that, so a reader takes 3–6 s
  as the cost at 2 % loss. **Finding D1 (docs, minor):** say "3–6 s without jitter, up to 17 s with ±10 ms".
* **FIX-1's `framesSha256` claim.** The claim is "the demo set carries it: `fetch_data.py` writes it,
  `ingest_coded.py` copies it into both". It is true at `daee0d1d`. `fetch_data.py:164` writes it, and
  `ingest_coded.py` loads the set's `metadata.json`, changes it and writes it out. E2E-3's 60 passes ran on a tip
  with fdbf8f89, which bears it out. SOURCE-FINGERPRINT (#364) retires it (§3).
* **FIX-1's README text** (fdbf8f89, 7d93e030) states the rule the code enforces: the `checkPair` arms in order, and
  the mark rule in `screen.js`.
* **FIX-1's mutant counts.** Not re-run. The three reverts of `screen.js` above each fail a different
  `screen.test.mjs` assertion, which is consistent with "six killed" but does not prove it.
