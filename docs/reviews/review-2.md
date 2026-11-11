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

## 3. SOURCE-FINGERPRINT (#364, `claude/source-fingerprint` at `c02b5f32`)

* **`checkPair`, fix 8e7027a5 reverted** (back to `framesSha256`). Both pair tests fail. `pair.test.mjs` fails on its
  accepted pair, which carries only `sourceFingerprint`. `pair-source.test.mjs` fails on "an exact series without
  a digest for every frame is refused": its fixtures fall at the old `framesSha256` arm instead, with the wrong
  message. The refusal tests ("names no shared source", "differs") pass reverted, because the old rule also refuses
  a pair without `framesSha256` with a message holding "source". Only the accepting assertions kill the revert.
  That is enough, but it is worth knowing.
* **Three more mutants of the new rule**, all killed. The 16-hex test was dropped (both tests), weakened to a
  truthy test (`pair.test.mjs`), and the comparison was dropped (both).
* **The ingest's fingerprint** (`ingest.py` `source_fingerprint`). It hashes the source samples' frame digests,
  taken as the HTJ2K series takes them: two bytes a sample over 8 bits, whatever the representation or split. So an
  exact series' own `digests` and an AV1 series' second pass reach the same string, as the PR argues. The reverts
  against `lossy_test.py` and `end_to_end_test.py` are in §3.1.
* **`framesSha256`.** No series writer keeps it any more: `ingest_coded.py:57` drops it, and `lossy_test.py`
  checks that. `fetch_data.py` still writes it as the download pin. `lab/av1/bytes/prior-gap/pocgap.py:45` still
  writes a `framesSha256` into its own lab sets. That is harmless, since it is not on the pairing path, but it is a
  third writer that the PR body does not name. **Finding F1 (docs, minor):** name it, or say it is the lab's own.
* **Glossary.** One row, `source fingerprint`, as the brief asks.

## 4. DEMO-UX (#365, `claude/demo-ux` at `14605f41`)

Each change's test and fix are one commit. The history cannot show "failing test first", so here each fix's source
was reverted at the tip and the tests were run again. All node tests pass at the tip.

| change | reverted | result |
| --- | --- | --- |
| 1 the label in colour (1952131f) | `labelOf` is new in this commit, so it was mutated in place: its class set to "", then the ✓ dropped | `screen.test.mjs:32` and `:34` fail. The colour itself is CSS in `index.html` and no node test covers it (DEMO-UX cites a Chromium check) |
| 2 a tap unfolds the status line (4222d27b) | `screen.js` reverted | `screen.test.mjs` fails (the `unfoldOnTap` import is gone). Mutant "ignore `pointerType`": killed by the mouse-click assertion |
| 3 the stored form off the show list (faf03c2f) | `av1.js` and `viewer.js` reverted | `av1.test.mjs`: "refuseWebCodecs true: webcodecs; av1-webcodecs" |
| 4 the slice slider (93293abb) | `slider.js` reverted | `slider.test.mjs` fails. With only the module's import, that proves little, so its assertions were read too: the span, the far jump to the last slice, pause before show, follow, and the keys a focused range takes |
| 5 the `exact` sentence (bc5d2f54) | docs only | the corrected sentence matches `screen.js`: an optimal-quality frame has no digest |

* **The decoders' restore (8e572058).** `client/decode/wasm/built/` at `14605f41` is identical to the demo tip's.
  `git diff --stat` against `daee0d1d` is empty, so 93293abb's accidental removal is fully undone.
* **The colours** are in `index.html`: green `#1a5e2a` for *Optimal quality* and *fetching lossless…*, blue `#1f4fa0`
  for *✓ Lossless*, red `#b00` for a failed check. The words always sit beside the colour (`labelOf`). That matches
  the brief.
* **Finding U1 (low; the brief asked for it).** `refuseWebCodecs` is a new lab lever in a product module
  (`client/decode/av1.js:39`). It is reachable from any page's URL through `?opts=`, so anyone with a link can force
  the dav1d route. The overlay names it ("refused by the lab's refuseWebCodecs"), so nothing is mislabelled. But it
  adds to EXPERIMENTS-OFF item 13, lab levers in product modules. Record it there, so the levers refactor after the
  demo takes it too.
* **Finding U2 (owner, unverified).** The tap rule reads `pointerType` on a `click`. That works where `click` is a
  `PointerEvent`, which is Chrome's case. It was checked only through Playwright's touch emulation on a Pixel 7
  profile, not on a phone. DEMO-UX says so too.
* **Docs claims.** README's "laptop without installs" bytes were checked against `payload-format.md`:
  4 642 336 / 67 815 186 = 0.0685, 23 208 339 / 107 410 134 = 0.2161 and 212 383 / 67 815 186 = 0.0031. The five
  bundles total 203 MB, 175 MB of it the two exact series. All hold. "40 of 40" is 18 series plus 2
  `--refuse-webcodecs` runs, under 2 views. Not re-run here.

## 5. `claude/demo-clean`'s removals (EXPERIMENTS-OFF, at `abbb441d`)

* **Byte for byte.** Each removed folder's git tree hash at the demo tip `daee0d1d` was compared with the commit
  the list names:
  * `lab/target-review` at 7f335cc0;
  * `lab/recv-loop` at cf38708b;
  * `lab/opfs-arms`, `lab/native-fill`, `lab/paint-read`, `lab/viewer` and `lab/opfs-cache` at 0920153d;
  * `lab/scripts/native_cache_cells.sh` at 0920153d and at a237cf3e;
  * `lab/av1/decode/{breakdown,merge-free,passes}` at 696c15d6.

  Every hash is equal. Each named commit is on an origin branch: the line branches named, and the fold or demo
  branches. `lab/native-fill` is not at a237cf3e, but the list names a237cf3e only for the script.
* **Each commit removes only its item.** It also touches its doc pointers and, where it says so, `scripts/gate.sh`
  (items 5, 7 and 8). Item 6 is 38 files: 11 `breakdown`, 15 `merge-free`, 12 `passes`. `lab/av1/decode/tile` and
  the other 15 folders stay, as on `main`.
* **No reference left.** Outside `docs/` and `*.md`, nothing at `abbb441d` names a removed path (`git grep`, 11
  patterns). `scripts/check_links.py` at `abbb441d`: 206 files, 2 307 links, 0 unresolved.
* **Not re-run:** the full gate (the list claims GATE OK in 395 s on `1ef93a6e`) and `demo-check.mjs`, which the
  list itself says was not run. **Finding C1 (before FIX-2 merges any yes):** a removal reaches the demo tip without
  any browser check of the demo. Run `demo-check.mjs` on the merged tip, as FREEZE-E2E will.
