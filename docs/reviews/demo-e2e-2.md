# Review of `claude/demo-e2e-2` (#354)

REVIEW-E2E2, 2026-11-11, by a session that wrote none of it. Reviewed: its three commits (README §Demo, the
certificate renewal in `client/viewer/demo-check.mjs`, the record in `client/README.md` and
`docs/lines/optimal-quality.md`), as merged in `claude/demo-fixes-0` at `36d286cd`.

## How it was checked

README §Demo followed word for word from a fresh clone of `claude/demo-fixes-0` on one 4-core x86-64 cloud host,
no GPU, Chromium headless on SwiftShader, loopback. Deviations, each by the host's rules, not the README's: meson
1.9.1 from pip (§Prerequisites' cloud note); the host's preinstalled Playwright 1.63.0 and its Chromium in place of
`npm i -g playwright@1.56.1 && npx playwright install chromium`, so `NODE_PATH` named that install; the optional
decoder rebuild not run. Fixtures: the three DBT volumes `dbts_a1`, `dbts_b1`, `dbts_c1`, all from one dataset; no
breast ultrasound cine.

* **Once block**: every command ran as written; `demo-series.sh` wrote the 23 series in 658 s; every byte count
  equal to the record's fractions (Q 8: 0.0685–0.0687 `dbts_a1` cut, 0.2159–0.2186 `dbts_b1`, 0.0882–0.0898
  `dbts_c1` cut; stored forms 0.0742 and 0.0947).
* **Before the demo, from any state**: the loop as written (with the `NODE_PATH` above); all 20 optimal-quality
  series printed `demo check: ID passed`. Each took 16–78 s, not "~1 min a series" in general: 17 s when the check
  did not stall, about 30 s more when it did (finding 2).
* **The record's claims, re-run**: every series routed as recorded (`av1-webcodecs`, the two stored forms
  `av1-dav1d` after WebCodecs' refusal); labels in order; a wrong digest never *Lossless*; no console error.
  Timings are not compared: one run each on a different host and Chromium (`CLAUDE.md` §Measurement).

## `demo-check.mjs`, mutated

Each mutant is a change to the product (or to the check) served by `dev-server.py` from the clone, run once on the
named series; "old" is the check as merged, "new" with the two fixes below.

| mutant | series | old | new |
| --- | --- | --- | --- |
| the certificate renewal removed from `serve()`, a certificate ending within a day | `dbts_a1-q24-g16-cut` | — | killed: *the fill completes*; with the renewal, passed |
| `route()` refuses WebCodecs at depth ≤ 10 | `dbts_a1-q8-g8-cut` | — | killed: *decoded by av1-dav1d* |
| dav1d's result drops the refusal | `dbts_a1-q8-g16-stored` | — | killed: *dav1d without WebCodecs' refusal named* |
| `showExact` takes a frame whose digest failed as exact | `dbts_a1-q8-g8-cut` | — | killed by the wrong-digest pass |
| the label never says *fetching lossless…* | `dbts_a1-q8-g8-cut` | — | killed: the label's order |
| `console.error` on *fetching lossless…* | `dbts_a1-q8-g8-cut` | — | killed: *console errors* |
| *Lossless* written with the optimal-quality frame, then the exact frame painted | `dbts_a1-q8-g8-cut` | **survived** | killed: *Lossless written with av1-webcodecs …* (finding 1) |
| the same with 300 ms between | `dbts_a1-q8-g8-cut` | killed only because `l` came within the gap | killed |
| `Home` shows frame 2 | `dbts_a1-q24-g16-cut` | **survived** | killed: *Home painted frame 1* (finding 2) |
| on demand, `wantFrom` adds `c + 1` | `dbts_a1-q8-g8-cut` | — | survived, equivalent: `c + 1` lies in a group the pass asks anyway |
| on demand, `wantFrom` adds `c + 8`; or `show()` also asks frame `want + 8` | `dbts_a1-q8-g8-cut` | — | **survived**, 24 frames received as unmutated (finding 6) |

## Findings

1. **`demo-check.mjs` did not check that *Lossless* is written with the exact frame's paint** (fixed,
   `0b2dc8a6`). README §Demo and the record say *Lossless* only after the exact frame was painted; the check
   passed if an exact frame was painted anywhere in the pass, so a page writing *Lossless* over the optimal-quality
   frame, then painting the exact one, passed. The record's "never before" came from an uncommitted copy of the
   check. Now the overlay written by the paint that wrote *Lossless* must name `htj2k`; the paint writes the label
   first, then the overlay (`client/viewer/viewer.js`, `showQuality`).
2. **`Home`'s paint was awaited from a clock read after the key** (fixed, `8c410843`). When the paint landed before
   the read, `shown()` waited its whole 30 s and the pass went on without checking it: 9 of the 14 `dbts_a1` and
   `dbts_c1` rehearsal runs took about 30 s more (46–50 s against 16–21 s; 78 s, two stalls), and a broken `Home` passed. Now the clock is read before the key and the paint is
   a `must`.
3. **The rehearsal loop prints only `tail -1`** (README §Demo, *Before the demo*). A failure reads `demo check: N
   failed` with the claim that failed cut off. Smallest fix: `| grep -E '^(FAIL|demo check)'`. Not applied: README
   wording is the owner's demo script.
4. **The loop's guard is the last file's existence** (`[ -f demo-series/dbts_c1-q8-g16-stored.sbnd ]`). A
   `demo-series.sh` stopped while packing that last series leaves the file partial and the guard satisfied; the
   rehearsal then fails on that series rather than saying why. Smallest fix: guard on its `.metadata.json`, which is
   moved in only after the bundle is written. Not applied, as 3.
5. **"~1 min a series"** is an upper bound: with the two fixes, the loop again passed all 20, in 16–19 s a series
   for `dbts_a1` and `dbts_c1` (22 s for `dbts_c1-q8-g16-stored`) and 26–32 s for `dbts_b1`; no run stalled. One run
   each, this host only.
6. **Two on-demand mutants that ask a group ahead survived**: the check's *asked the whole groups* count (24 at
   `dbts_a1-q8-g8-cut`) was unchanged. Cause not traced (time-boxed): either the ask never reached the wire (the
   store's want replaced on the next step, or the downloader dropping it) — then the mutants are equivalent — or the
   count misses frames asked and not taken. Owed to REDTEAM-DEMO or FIX-1: a mutant that provably sends one extra
   group, and whether `received N,` can see it.

Not checked: the phone block (no phone; PHONE-PAIR's and PHONE-NO-INSTALL's harnesses own it), Chrome itself, a
GPU, hardware decode, the decoders' docker rebuild.
