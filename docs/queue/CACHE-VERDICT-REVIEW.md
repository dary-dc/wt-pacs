state: done
started: 2026-11-19T08:46Z
heartbeat: 2026-11-19T08:53Z
outputs: claude/cache-plan 16b3f32d (cache-plan.md §10 Verdict review; §9's saturation line corrected in place), 70aba834 (docs/lines/client.md); claude/docs-client 6120da78 (design.md §Open, the cache item, one line); no PR (branches have theirs)
## Resume
Done. Read only, plus one probe (scratch, not committed). Every bar recomputed from claude/cache-arms e988f9c6's rows by a
script of this review's own, not results.py. check_links: cache-plan 1 unresolved before and after (pre-existing, §8.8's
lab/ path); docs-client 0. Docs-only: the gate not run. Nothing owed by this row; §10.4's run is owed to a later queue.
## Result
Fixtures: one 4-vCPU container, Chromium 153 headless, Firefox 159 on Xvfb, synthetic frames, feeders not decoders, warm
page cache, O's F from M1; no phone, no Safari, WebKitGTK not run.
* §9 recomputes cell for cell; one error corrected in place: Firefox none saturated at S2 4x (18.0 %) and S3 4x (34.0 %).
* By §8.5 rule 3, no arm passes on Chromium or Firefox. OPFS-SYNC on Firefox fails only L's PSS bar at 512^2, by 7 MiB
  in a cell where its own A/A copy differs by up to 23 MiB: the PSS failures sit within the rig's resolution.
* The option's: IDB's and Cache Storage's read and reopen losses (their API floors at or over the bar on Firefox).
  The build's: OPFS-ASYNC's Firefox O S1 (a sync handle opened per frame); Chromium IDB's ~1.2 GiB PSS = the fill's
  bytes (theory: a Blob held per frame). Open: OPFS's ~100 MiB on Chromium; Cache Storage's Firefox K and T errors.
* T (Chromium OPFS-SYNC): the empty re-check is by design (a reading tab's failed check is a miss); verify() lumps a
  failed re-read with a SHA mismatch, so no row shows a wrong frame painted. A probe (Chromium 157, one tab) did not
  reproduce it (343/343 exact). Cause open.
* Owed (§10.4, pre-registered for the next run): PSS by process with an A/A PSS VOID rule; IDB value=buffer on
  Chromium; T with per-index reasons; OPFS-ASYNC one handle a group; Cache Storage's Firefox errors with stacks.
Owner, last: no store is recommended; the cache stays off. Whether to queue §10.4's run is the owner's call (CACHE-PAGE carries it).
