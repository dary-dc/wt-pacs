state: done
started: 2026-11-22T18:21Z
heartbeat: 2026-11-22T18:36Z
outputs: `claude/non-cine` `b3f095a2f` (`docs/client/evidence/non-cine-series.md`; `docs/client/design.md` §Open; `docs/lines/client.md`); draft PR 431 into `claude/unified`
## Resume
Done. Nothing to continue. Sources fetched 2026-11-22 and pinned in the file's §10 (seventeen, each with URL, section,
revision and sha256); the client and docs read at `origin/claude/unified` `4a2b4277f`, not run. Docs only:
`scripts/check_links.py` 0 unresolved, comment budget ok, the gate not run. Next: NON-CINE-REVIEW (findings in PR
431's body), then NON-CINE-PAGE. No row appended; nothing scheduled.
## Result
Theory and sources; nothing built, run or timed. No fixture used; the measured numbers quoted are earlier rows' (`ffdm_d`,
four views of one earlier 70 µm detector; nine level-1 series; six sets of eight colour US stills, not breast; three DBT
volumes for the view's ratios; 4-core cloud hosts, no GPU, headless Chromium). Phone numbers are the device model's
ranges, its round not read. Not found: a published share of single-frame series; stills an exam; phones' texture limits.
* "Not cine-like" is three classes. Large single frames at 12 bits or under (synthesized 2D, 2D mammograms) are half
  the pictures of a DBT exam and under 3 % of its bytes (derived); IHE requires a DBT display to show and toggle them.
  US stills are a stack of exact frames in the reader's order. Over 12 bits is the 2026-10-10 rule's, and waits.
* One frame: first picture ≈ wire + decode, not max; the wire binds on every phone class below ~150 Mbit/s (derived).
* Read in code, not run: the painter makes no test against `MAX_TEXTURE_SIZE`; over it nothing paints, nothing is
  said. 3328 x 4096 fits a 4096 limit exactly; a 50 µm frame (4728 x 5928) does not. GLES 3.0 promises 2048.
* Read in `FIXTURES.md`, not run: the ingest refuses a real US series three ways (mixed sizes, a clip among stills,
  a lossy source).
* Five options with ranges; an AV1 view of a mammogram needs level 6, is software on any phone, wins only on slow links.
* A cloud run outlined with predictions (§7): exact whole vs an exact level first vs the view, on `ffdm_d`.
Owner, last (§8): the exact frame alone for large single frames, no AV1 view; queue the level-first run or not; the
three ingest refusals to the PCS team; the painter refuses an oversized frame by name; over 12 bits waits. Would
reopen, only if taken: no low-resolution preview; AV1 only for cine-like; XXH3 for lossy-source stills; "12 bits or fewer are filled".
