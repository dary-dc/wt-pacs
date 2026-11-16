# PR-TRIAGE: every open PR against `claude/unified`, for the owner's yes

Row PR-TRIAGE of `docs/queue-merge-2026-11-15.md` (read only; closes nothing). Read 2026-11-16 05:45 UTC:
**269 open PRs** (the brief's 264 was 2026-11-15's count), `claude/unified` at `9749ac85` (PR 402, after
MERGE-B-FIX-REVIEW and UNIFIED-CLEAN-REVIEW, both no blocker).

Method: every PR's head (`refs/pull/<n>/head`) tested with `git merge-base --is-ancestor <head> claude/unified`, and
for the rest the commits ahead and the patch-unique ones (`git cherry`); then the plan's §2 verdicts, its §7 calls as
decided in the queue file (M1–M9), `MERGE-INVENTORY-2-report.md` and the status files of the rows that own each branch.
Raw table and the script: `docs/queue/PR-TRIAGE/prs.tsv`, `triage.sh`. Limits: ancestry says the history is joined,
not that every hunk is in the tree. Twelve merges on `claude/unified` are `-s ours` (M1, history only); grafting them
away, **only PR 37** loses its ancestry, so it is listed as superseded, not carried. The M2/M4 branches were merged with
their code resolved to the tip (MERGE-A-CLIENT's merge messages name each file); their PRs count as carried because
the decision is to carry them that way.

## Summary

| group | PRs | owner's action proposed |
| --- | --- | --- |
| carried | 241 (237 + the 4 staging PRs) | close the 237, saying they landed in `claude/unified` (PR 402); the 4 staging PRs with M8's swap |
| carried to the frozen tip, later pass owed | 5 | merge the newer docs commits on `claude/unified` in a later-pass row, then close |
| needs a fix first | 4 | the fix (or the owner's call to stop the loop), then a later pass |
| proposal waiting on a named decision | 12 | the decision below |
| superseded | 7 | close, naming what supersedes each |

### Proposals, each with its decision

| PR | branch | decision that settles it | owned by | an open client-queue question decides it? |
| --- | --- | --- | --- | --- |
| 370 | `telemetry-client` | adopt the load report in the product (M6) | report study: `report-plan`, REPORT-RUN | **yes, the report study** (REPORT-RUN waits on REPORT-BUILD-FIX-REVIEW) |
| 378 | `lossless-under-loss` | adopt the re-ask (M6); PHONE-FIX-378-REVIEW: no blocker, two owner calls (a dial-failed ask counts as lost? one re-ask enough?) | client line, `docs/lines/client.md` | no |
| 372 | `demo-network` | adopt `scripts/demo-network.py` (M6) | `docs/lines/optimal-quality.md` (DEMO-NETWORK) | no |
| 309 | `av1-paint-depth` | adopt the reduced-depth paint behind its flag (M6); 25 of its 31 commits already ride in with PR 307 | codecs line | no |
| 265 | `core-exp2` | adopt experiment 2's wait-ahead rows (M6; k = 8 already adopted) | client line | no |
| 96 | `wip-276-ONEQUEUEPRODUCT` | the one-queue product build (M3): a question to the transport session | transport line | no |
| 193, 214, 215, 255, 297, 300 | `viewer-requirements`, `viewer-spike`, `viewer-a-step1`, `line-viewer`, `viewer-seam`, `viewer-seam2` | unpark the viewer line, or bring it in as lab only (M5) | `docs/lines/viewer.md` | no |

The cache run (CACHE-RUN) decides no open PR here; it waits on PR 394's fix below.

## Carried: close, saying they landed in `claude/unified`

37 excluded (below). 237 PRs:
41 88 102 103 112–127 129–140 142–182 185 187–190 197 198 200–204 206–213 216 218–254 256 258–264 266 267 273 275–278
283 285 288–292 294–296 298 299 301 302 304–308 310–318 320 321 323–332 334–341 343–358 360–367 369 373–377 379–383
385–391 393.

Ranges are of open PR numbers only (a number missing inside a range is closed or merged already); `prs.tsv` is the list.
Among them: 376 and 390 (M6, merged), 393 (`hw-probe`, M9).

**Staging PRs, carried, not to close yet**: 398 (`merge-a-codecs` into `unified-codecs`), 399 (`merge-a-server`), 401
(`merge-a-client`) close when the owner swaps the four `claude/unified-*` (M8); 402 is `claude/unified` itself, the
review vehicle into `main`.

## Carried to the frozen tip; the later pass is owed

Stage A merged these at `MERGE-INVENTORY-2` §4's tips; their newer commits are docs only, every row behind them done.
No row of the merge queue merges them yet: **a LATER-PASS row is the owner's to append** (the inventory's §3 list).

| PR | branch | ahead (patch-unique) | what is newer | its row |
| --- | --- | --- | --- | --- |
| 384 | `docs-client` | 4 | DOCS-FIX: `design.md` shortened, the 11-11 decisions, `docs/lines/client.md`, `devices.md` | DOCS-FIX done |
| 392 | `hw10-routes` | 2 | `docs/lines/devices.md` | HW10-ROUTES-REVIEW done |
| 359 | `phone-protocol` | 6 | `docs/phone-rows/next-round.md`: the review's fixes, decode-option asks M4–M22 | PHONE-NEXT-PROTOCOL-FIX-REVIEW done |
| 396 | `native-notes` | 4 (1 its own, 3 of 384's) | `docs/native/README.md`: paused, status screen | NATIVE-NOTES done |
| 397 | `mobile-decode` | 55 | `docs/decode/mobile/`: the decode options and their comparison | MOBILE-DECODE-COMPARE-FIX-REVIEW: no blocker |

## Needs a fix first

| PR | branch | which review asks | state |
| --- | --- | --- | --- |
| 368 | `oq-integrity-build` | OQ-INTEGRITY-REVIEW: six findings open (M6) | no fix row |
| 394 | `cache-arms` | CACHE-FIX-REVIEW: one blocker (N1, `lBars` drops an arm's errored rounds) | second round; owner: a third round before CACHE-RUN? |
| 395 | `report-arms` | REPORT-BUILD-REVIEW (2026-11-16): five blockers B1–B5 | REPORT-BUILD-FIX appended, first round |
| 400 | `phone-round` | RUNNER-AUTO-FIX-REVIEW: blocker 2 (`readyS` does not bound `wait_line`) | second round; owner: a third round before PHONE-LEVERS? |

## Superseded: close, naming what supersedes each

| PR | branch | superseded by |
| --- | --- | --- |
| 37 | `ccr-10b47d42-tr6zpv` | row 181 IWDEEP's results on the tip; history joined only (`-s ours`, M1) |
| 39 | `project-thread-9jumbi` | row 211: asks first under a 6 MiB window measured, not adopted |
| 40 | `project-thread-9jumbi-212` | row 212: `cubic-classify` not adopted (`cubic-restart` stays) |
| 303 | `core-onepass` | `av1-unified-mainbase`, merged in its place (coordination), on the tip |
| 205 | `day-summary-2026-10-27` | an empty commit, "not to merge" |
| 217 | `merge-order-2026-10-28` | `merge-plan`, MERGE-ALL-PLAN and this queue |
| 257 | `merge-order-2026-10-29` | the same |

## For the owner

1. Close the 237 carried PRs (one comment each: "landed in `claude/unified`, PR 402") and the 7 superseded.
2. Append a LATER-PASS row for 384, 392, 359, 396, 397 (docs only).
3. Third fix rounds for 394 and 400, or stop there; 395 runs its first.
4. M6 for 370 (after the report study), 378, 372, 309, 265; M3 for 96; M5 for the six viewer PRs.
