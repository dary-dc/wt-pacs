state: done
started: 2026-11-17T12:22Z
heartbeat: 2026-11-17T12:45Z
outputs: claude/mobile-decode ca99a468 (blocker 1), ee55cc02 (blocker 2, minors 3-6), b81d6302 (docs/lines/client.md); PR 397 (body unchanged)
## Resume
Done. Nothing owed by this row; AV1-HW-CHIPS-FIX-REVIEW is next (a session that wrote neither the file, its review nor this fix).
## Result
docs/decode/mobile/av1-chips.md, each fix in place with a *Corrected* note quoting the earlier text:
* Blocker 1: 11 of 19 volumes fit level 4.x, 8 need 5.x (§1 twice, §3's summary, §4.3's arms and fixtures, §5 item 1,
  docs/lines/client.md); the table and the list of 5.x volumes were already right.
* Blocker 2: the Android 16 CDD's [5.1/H-1-22] re-fetched today ("Last updated: December 2, 2025") and quoted verbatim
  in §3; §5 item 2 now says a portrait frame is asked of class V up to 1080p, which 17 of 19 volumes exceed
  (only dbt12_ea1141 and dbt10_ea1141 fit 1080 x 1920). Not promised by size, not by orientation.
* Minors: 3, the level compared is the codec string's (§1; Blink's video_decoder.cc added to S8, as the review read it);
  4, S3 pinned by the page's date (its hash changed again: dc53e1820d4f); 5, Android's 4.x height bound 6144 (§3, no
  volume affected); 6, FIXTURES.md states no order, width x height read as lab/frame-clock/page.js sets 2560 x 3328.
Checks: check_links 9 unresolved, none in av1-chips.md (same 9 as before); check_personal_paths clean. Gate not run: no code.
Fixtures and limits: a documents fix on the 19 DBT volumes' sizes (EA1141); nothing run, no device; one source re-fetched (CDD).
