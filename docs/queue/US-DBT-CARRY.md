state: done
started: 2026-11-24T06:21Z
heartbeat: 2026-11-24T06:30Z
by: kjkkMVh3
outputs: `claude/reviews-2026-11-28` `2413ed211` (`docs/decisions/us-dbt-carry.md`; the index line of `docs/decisions/README.md`; `docs/lines/coordination.md`); draft PR 405 ("do not merge: decision pages"), no new PR
## Resume
Done. Nothing to continue. Read at `origin/claude/unified` `b7cc007f7` and the pages at `8f396eb74`; nothing run.
Sources fetched 2026-11-24 and pinned in the page's §8 (four, each with URL, section, revision and sha256; a fifth
quoted as the repository recorded it, said so). Docs only: `scripts/check_links.py` 17 unresolved before and after
(none in this page), comment budget ok, the gate not run. Next: US-DBT-CARRY-REVIEW (findings in the page's §Review).
## Result
Fixtures: 19 DBT volumes of one dataset, three timed; ultrasound: two sound prostate sweeps, six sets of sound colour
stills, three lossy-sourced clips (provisional by the provenance rule), three sound liver clips no row has used; no
sound breast clip, no ABUS, no ultrasound frame on a phone or in any transport, delivery or cache run.
* DBT stacks: every page stands as written.
* Premise 2 (ultrasound behaves as DBT) is refuted where the fixtures allow, **measured** by earlier rows: the Q 8
  view is 0.34 of the exact bytes on the sweeps (DBT 0.07–0.22); G 16 gains +23 % (DBT −0.2 to +1.2 %); the noise
  rule "does not hold for TRUS"; the fine band is as much structure as noise.
* It fails first at the door: 997 of 1 000 multi-frame ultrasound instances read in IDC v25 are flagged lossy, 979
  colour-typed (**derived** from `docs/FIXTURES.md`'s table); the product ingest reads MONOCHROME and RGB only and
  codes a view for grey only. One archive, not the PCS: the PCS note asks.
* A clip's decode never binds if pixel scaling holds (**derived on theory**), so its switch is goodput ≥ bytes a
  frame × rate (15.6 and 44.3 Mbit/s on the two breast clips, provisional), with no device table.
* `uscine_crc1`…`3`, the one sound ultrasound cine, appear in no row, rig or result.
* Reopens nothing. One option named and not recommended (the scanner's stream passed through) would.
Owner: eight yes or no lines in the page's §2, for BRIEF-WEEKEND's table; all recommended yes.
