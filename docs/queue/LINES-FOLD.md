state: done
started: 
heartbeat: 2026-11-24T11:25Z
by: GDmbzXYT
outputs: claude/lines-fold 763691844, draft PR 443 into claude/unified
## Resume
Done. Next row on it: LINES-FOLD-REVIEW (not before 11-24 18:00), by a session that is not GDmbzXYT.
## Result
- docs/lines/optimal-quality.md folded whole into codecs.md §Optimal quality; devices.md into client.md §Devices (the device kit's kept-and-maintained line at its top); coordination.md renamed release.md (# Release).
- docs/lines/README.md: 8 rows -> 6 rows; the client row's last-verified date corrected to 2026-11-23, the date its file states.
- 23 broken links/paths across 18 files repointed; paths beside a commit or a branch and bare names in dated reviews left as written (records).
- Nothing dropped: each line of the three old files found verbatim at its new home except 12 intended changes (titles, re-levelled headings, self-links, release.md's last-verified line).
- check_links.py 0 unresolved (0 new); comment budget passes; scripts/gate.sh --quick passed, 10m31s, 4-core cloud container. Skipped steps named in PR 443 (none reads docs/lines/).
- Fixtures: none; nothing measured (a docs move).
- For the owner: nothing. Ledger rows that name docs/lines/coordination.md keep their wording as records; after the merge, workers write release.md.
