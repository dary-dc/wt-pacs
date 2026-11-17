state: done
started: 2026-11-17T23:16Z
heartbeat: 2026-11-17T23:19Z
outputs: claude/docs-client 5e67565f (docs/client/design.md, docs/lines/client.md, devices.md, native.md); on draft PR 384
## Resume
Done in one commit. Brief and amendments unchanged since the claim (re-read at finish).
## Result
* design.md §Decided: seven dated rows, each linked to its amendment and evidence: 10 bits on hardware the goal, 8 the
  fallback (16); native paused (18); the web first, mobile options before native (19); only a lost ask re-asked once,
  re-dial included (22, 23); no second picture over 8 bits; the content crop doubtful, no build; hardware painting
  first with the check after acceptable, not ideal (23).
* design.md §Open: new items, decode on a phone and hardware (#397, #392, #389, the 220-level view to explore) and the
  HTJ2K-only reduced first picture (to investigate, against *no low-resolution preview*; #397's level picture failed
  the visually lossless proxy); the cache's arms (#394), the phone round (#359, #400), #378, the report run (#395) linked.
* lines: client.md in flight and owner list; devices.md's 10-bit row corrected in place (done, #392), the runner's third
  round, the 220-level view; native.md's resume wait (amendments 18, 19, #392). PR 396's lines left untouched.
* Not folded (process, not design): amendments 17, 20, 21. Contradiction 3 in §Open predates amendment 11 (six octets
  of record, 2026-11-14), outside this row's 16-23: left for the owner or a later fold.
* scripts/check_links.py green (0 unresolved); docs only, the rest of the gate not run.
* Owner: whether one re-ask is enough (#378); cell 3's guard form (#359); the 8-bit view at 1.14-1.86x bytes (#389).
