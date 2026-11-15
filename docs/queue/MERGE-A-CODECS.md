state: done
started: 2026-11-15T15:41Z
heartbeat: 2026-11-15T16:17Z
outputs: claude/merge-a-codecs a47b72bcd1, draft PR 398
## Resume
Done. Nothing owed by this row. Next: MERGE-A-REVIEW-CODECS, by a session whose commits are not on
claude/merge-a-codecs, reviewing draft PR 398.
## Result
claude/merge-a-codecs at a47b72bcd1, from unified-codecs 9c050c073b; draft PR 398 into claude/unified-codecs.
* Merged exactly the frozen list of MERGE-INVENTORY-2 §4 A1, every tip checked: 5 by -s ours (M1), 29 --no-ff,
  16 of them clean; every conflict resolved by the plan's §3 column and named in its merge commit. M1's record:
  docs/av1/README.md §Paths kept in history only (556 paths of 1348bc06b3, recovery command).
* Product: +2 lines, the stallMs decoder-config key in client/decode/av1-webcodecs.js (default unchanged, adopted
  by av1-profile-carriers' row); server, ingest, deploy, scripts unchanged; URL parameters, features, levers equal.
* After the last merge the gate failed twice, at check_links (6 links) and check_personal_paths (2 paths), all
  brought in by the merged branches; one commit each fixed them (3d116d83, 97d7c410). Then GATE OK, 37 steps, the
  baseline's skip; test counts, warnings, suite lines equal to the baseline; web image +43 B.
* For COMPLEXITY-AUDIT: total-time/run.mjs now has two unrated links, `none` and `plain`.
* A pushed merge message (av1-vl-metrics) names the wrong source of one bullet; corrected in PR 398's body.
Fixtures: the repository's for the gate; one 4-core cloud host, no GPU, headless Chromium (playwright 1.63.0), no
Firefox; the server image not buildable here (proxy refuses plain-HTTP apt).
