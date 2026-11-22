State: done
started: 2026-11-22T20:38Z
heartbeat: 2026-11-22T21:50Z
outputs: claude/phone-run f5252051 (the beacon fix), f96e38a9 (docs/phone-rows/raw/2026-11-22-cell3d/, 669 files through raw_rows.py)
## Resume
Cell 3 alone with the beacon fix, at the owner's ask. RUN_CODE moved for cell 3 only, by the lab-only commit
f5252051 (lab/devices beacon.js, round-page.js, beacon.test.mjs, README.md): the load's last batch is POSTed and
awaited (5 s timeout, then sendBeacon; a drain record names the path). The plan was regenerated at f5252051:
target/round3d/plan.json equals tonight's target/round/plan.json in every load (all 144), gapS, fillS, afterS,
budgetsS and servers (paths aside); only the commit differs. loads [92:140], a fresh Chrome per load gated on the
verdict, smoke = the first 2 loads.
Done. PHONE-READ reads round3d/: beacon-cell3.jsonl (steps 0-15 = round loads 92-107) and beacon-cell3-rest.jsonl
(steps 0-31 = loads 108-139), resources-cell3*.jsonl, relaunch-cell3*.jsonl.
## Result
* Cell 3 complete: 48 of 48 loads (24 page, 24 worker, the round's ABBA pairs) delivered verdict ok, frameChange,
  cine x2, busy x6, exactFrame x2, lossless x4, labels and a drain record, every one by path "post" (no fallback),
  one load id each. A fresh Chrome before every load (48 relaunches, none skipped), each renderer new at ~1.5 GB;
  thermal 0 throughout; battery 96 -> 100 %.
* The loss explained: load 0's end batch, seen over DevTools, was 88,438 bytes, over sendBeacon's keepalive quota
  (64 KiB, from memory); labels grow with the frames shown (240-250 a load). The dry run's --quick cell 3 (3 steps,
  2 s cine) made ~24 KB, under it.
* Deviations and incidents: (1) RUN_CODE moved for cell 3 only, by the lab-only f5252051; the plan regenerated
  there equals tonight's in every load, gapS, fillS, afterS, budgetsS and servers (paths aside). (2) Three aborted
  starts, kept in round3d/aborted-start*/: twice a restored tab at /next?after=1 hit the new runner ("load ended 1",
  host failed), fixed by closing the round's tabs over DevTools; once the page ran Chrome's CACHED old beacon.js (no
  drain; DevTools Runtime.evaluate showed it), fixed by Network.clearBrowserCache (cached copies only, all sites).
  aborted-start-3's beacon also holds 500 records with load "TEST-curl", step -1: my check that the dev server
  takes a 132 KB POST (204). (3) adb dropped after step 15 (round.py's before-read hung 20:59-21:08Z, then "read
  failed"); restarted at K=16 with section 3's recipe, so the cell budget restarted from zero. adb logged "timeout
  expired while flushing socket" once per relaunch, before and after the relaunch blanked the tab first (about:blank
  1.5 s before the force-stop, from K=16): the cause of the drop is not established. (4) The phone was held awake
  with stay_on 7 between runs (round.py read 7 and restored 7); set back to 0 at the end. (5) DevTools was attached
  to one smoke load (step 1 of the stale-cache start, discarded) and to load 0 of the counted run, to check the code.
* n1 (coordinator): no load took the fallback, so no duplicate copies. n2: no drain record is missing. n3: round.py's
  clock (load opened to /next) only feeds the cell budget, the stopping rule; every counted figure is the page's own
  records (frameChange, cine, exactFrame), and the drain's POST time falls after the verdict.
* For every round: Chrome's HTTP cache can serve older client/lab code than the served tree, and round.py's HEAD
  check does not reach the page. Tonight's main round should be checked for it; a cache-buster or no-store is owed.
