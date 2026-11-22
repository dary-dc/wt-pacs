state: done
started: 2026-11-22T14:47Z
heartbeat: 2026-11-22T14:49Z
outputs: `claude/client-readme-cache-fix` `13d8365a`, draft PR 428 into `claude/unified`
## Resume
Done. Next: CLIENT-README-CACHE-FIX-REVIEW (not before 11-22 16:00), by a session that wrote none of this.
## Result
* B1 closed in place: `client/README.md` *Frames* now says no frame leaves memory, writer or not, with the old
  sentence quoted under *Corrected 2026-11-22*. The reason: `client/view/store.js:29-32` `budget` is in frames and
  defaults to `Infinity`, and `client/viewer/viewer.js:102` and `client/view/view-worker.js:55` pass none through
  `client/view/controller.js:63`. The 256 MiB window is a proposal (`cache-in-opfs.md` §Proposed).
* m1: no change. CLIENT-README-CACHE's Result never names `core-against-main.md` (`git log -S` finds it only in the
  review's text).
* `docs/lines/client.md`: one dated bullet. The cache stays off.
* Checks: `check_links.py` 0 unresolved; the comment budget is ok; the gate was not run (docs only). Fixtures: none;
  a docs claim checked against the code.
