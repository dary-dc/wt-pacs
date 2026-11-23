state: done
started: 2026-11-23T04:17Z
heartbeat: 2026-11-23T05:02Z
outputs: claude/beacon-loss 97633c38..05b9c66b, draft PR 436 into claude/phone-run
## Resume
Done. Nothing left; BEACON-LOSS-REVIEW is next (a session that wrote none of PR 436).
## Result
* Quota: the Fetch standard (snapshot d7fc0fdb) refuses a keepalive body past 64 KiB in flight; Chromium main
  412608bf `kKeepaliveInflightBytesQuota = 64 * 1024`; headless Chromium 157 measured: 65 536 B taken, 65 537 refused.
* Reproduced in the cloud: with the pre-fix flush, round_headless's cell-3 load (10 s cine) lost its 80.8 KB end
  batch, verdict included; the reviewed drain (f5252051/86a8a350, kept) delivers it whole.
* Fixed (PR 436, draft into claude/phone-run, 97633c38..05b9c66b): the fallback sends the drain record with the batch's
  count first, then 16 KiB beacons newest first until one is refused (forced on Chromium: every verdict kept, 118/231
  records of the big batch); a timed-out post's duplicate is field-for-field, read once per (load, kind, at);
  round_headless asserts every drain posted and the big batch whole; resources.sh into lab/devices.
* Product: nothing sends at unload on claude/unified; the report arms already handle a refused beacon.
* Tests: beacon 11/11, nine unit mutants and two headless mutants killed; gate --quick OK (skips named in PR 436);
  one earlier gate run hit a pre-existing 0 ms step flake in round_headless (worker view), passed in 5 other runs.
* Fixtures: synthetic 64x48 pair, 20 frames (cell 3 at 9 steps), one container, headless Chromium, no phone.
