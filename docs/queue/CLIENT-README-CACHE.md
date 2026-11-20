state: done
started: 2026-11-20T09:17Z
heartbeat: 2026-11-20T09:18Z
outputs: none new. The correction is already on `claude/unified` (`4a2b4277`): `client/README.md` §The viewer, *Frames*, corrected in place by `61bce9e1` (2026-11-14, the fold). No branch `claude/client-readme-cache`, no PR: nothing left to change.
## Resume
Done. Nothing pushed but this file.
## Result
* The brief's claim ("a store worker writes every checked frame by default") is no longer in `client/README.md` on
  `claude/unified` `4a2b4277`: its *Frames* bullet reads "There is no cache by default. *Corrected 2026-11-14:* this bullet
  said each frame checked `true` is also written to OPFS by a store worker (`viewer/store.js`); no product module
  loads that worker (`viewer/viewer.js`: `writer = lab.writer`), so it is written only under the lab's `?writer=`",
  in place with the reason (the `docs/adr/disk-access.md` §2 form), by `61bce9e1`.
* Checked against the code at `4a2b4277`: `client/viewer/viewer.js:29` `const writer = lab.writer;`; `lab/viewer/levers.js:14`
  reads it only from `?writer=`; `client/view/view-worker.js:87` opens the cache only `if (writer && opts.digests)`;
  `client/view/cache.js:35` is the only place `viewer/store.js` is started. *Where the frames are* says the same
  ("With no writer, the default, there is no cache"). No other "by default" claim about the cache in the file.
* `docs/lines/client.md` carries no stale statement of it; not changed. The cache stays off.
* CLIENT-README-CACHE-REVIEW: no PR exists for its findings; it reviews `61bce9e1`'s `client/README.md` hunk and
  this check, findings in its own status file.
* Gate not run (no change); docs only.
