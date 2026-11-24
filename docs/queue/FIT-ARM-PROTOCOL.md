state: done
started: 2026-11-24T08:17Z
heartbeat: 2026-11-24T08:26Z
by: rxMMo3aq
outputs: claude/delivery b380126a0, d0c91ff67 (docs/client/evidence/delivery-comparison.md §Amendment 2; docs/lines/client.md); PR 406 (no new PR)
## Resume
Done. Next rows: FIT-ARM-PROTOCOL-REVIEW (a session that wrote none of it), then FIT-ARM-BUILD.
## Result
Docs only: scripts/check_links.py green (0 unresolved); the gate not run; nothing measured.
* FIT: HTJ2K at the level that fits a 1080 x 2100 viewport (DPR 1), the rest on zoom; level 1 on dbts_b1, level 0 on
  dbts_a1 and dbts_c1, so FIT is B there (a control). It is htj2k-tiles.md's S, not S★ (no re-encode, strips, Layout 1
  or OPFS records). Window/level on a fitted picture needs no exact frame (theory); a zoom past the fit does; the AV1
  view needs the exact frame for an exact window.
* Arms A, A', B, C1, FIT, SPLIT (C2 dropped), Williams over 6 arms, 12 rounds, 216 loads a cell.
* LTE and LOSS: a wire curve from arm B's calibration loads (K3'), by the arms' own client; retrodiction on the 23rd's
  rows puts A at x1.01-1.06 on LTE and x0.87-0.93 on LOSS but x0.56 on dbts_a1 (under the curve's first point).
* C1's ask -> last byte recorded; its short-trip excess predicted to lie there.
* The switch cannot fire here (G★ 166-368 Mbit/s against the TUN's 90): only its reading is recorded. SPLIT predicted
  x0.80-0.89 of A on CLEAN and PUB, A elsewhere.
* The relay: the guard kept; browser affinity checked per load; two escalations registered for the pilot.
* For scale (derived): FIT on dbts_b1 x0.47 of A on CLEAN and PUB, x0.93-1.08 on wire-bound forms, at x1.25-1.29 A's bytes.
Fixtures: three DBT volumes of one dataset, no US; one 4-core container, software decode; TUN relay at <= 90 Mbit/s.
