state: done
started: 2026-11-11 14:45 UTC
heartbeat: 2026-11-11 15:55 UTC
outputs: `claude/htj2k-tiles` 8517bdff (draft PR #324 into main, already open; the new commits land in it)
## Resume
Done. Commits: 420772b1 (main merged in, for `docs/lines/`), 9e05d0dc (corrections in place), 6e424cce + follow-ups
(§Screen resolution against the demo's approach), 8517bdff (`docs/lines/codecs.md`). Nothing left.
## Result
* `docs/htj2k-tiles.md` §Screen resolution (theory, nothing run): approaches D (demo), S (HTJ2K at the viewport's level,
  rest on zoom or request), S+R (rest by precinct or tile), D+L (demo scroll, Lossless level-first).
* Viewports assumed in device pixels: 1080×2100, 720×1400, 1440×2800, sideways 2400×950. Upright, only `dbts_b1` has a
  level to gain (L1, 27 % of a frame); `dbts_a1`, `dbts_c1` fit at L0, so S is today's exact fill there.
* Derived: S costs 1.2–10× D's bytes to the first picture and to the scroll; Lossless after the scroll is free under S
  on a1/c1 and 0.73 of a frame on b1; S's total ≤ D's only once a reader asks Lossless on 41/56 (a1), 32/50 or 10/50
  (b1, G 1/16), 62/69 or 49/69 (c1) slices. Store 1.00× against 1.10–1.28×; one PCS encode; no wire change.
* Lossless: D only on request; S at L0 on every picture (frame digest, full stored depth); S at L≥1 exact at its level,
  not Lossless, needs a per-level digest and the owner's wording.
* Protocol pre-registered (rule R0–R4 first, arms D/D′/S/D+L, 2 shards ~2.5–3 h). Corrected in place: §7's OQ bytes
  (0.07–0.22 → 0.10–0.28 at the rule's Q), P12 amended before any run, the lab's "fit" is not a viewport.
* Fixtures: three timed DBT volumes of one dataset; no breast US cine; 4-core host without GPU; no phone measured;
  decode on a phone stood in for by 4× throttling (assumption). Checks: check_links 0 unresolved, comment budget ok;
  full gate not run (docs only).
* Owner: whether a level picture may be read and its label wording; whether to run the protocol after the demo.
