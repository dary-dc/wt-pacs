state: done
started: 2026-11-19T04:46Z
heartbeat: 2026-11-19T04:53Z
outputs: `claude/transport-design` 823c76c1, 26f5d52b, b2f30e33d (`stacks.md` §6.5 Verdict review; `docs/lines/codecs.md`); `claude/work-ledger`: amendment 17's three rows in `docs/queue-client-2026-11-14.md`, TRANSPORT-PAGE's needs in `docs/queue-2026-11-14.md` (no PR: findings only)
## Resume
Done. Rows read at `claude/transport-arms` 70a70950 (= 0bb23cfe for rows and code). Next: TRANSPORT-VERDICT-REVIEW-FIX
(client queue), by a session that wrote none of the build, run or this review.
## Result
* Nothing re-run: the nine counted cells' metrics re-derived from each visit's stamps (0 of 1 024 differ from `v`/`hol`),
  fresh per-round tables judged by `aa_rule.py --bar 0.05`: every number §6.1 quotes reproduced. Kernel quote checked at v6.12, v6.18.
* A/A: WT-TS′ ties wherever the rule resolves 5 %; not conclusive on ad-lte, LOSS, HOL, LTE, CPU.
* Corrections: CR's H2-fill (1.052) a miss, not a hold; ENT not balanced (36 of 56 Williams pairs, n = 5); HOL's
  WT-WASM and CPU's H3-fill misses, and five slower-in-band flags, named.
* Blocker (AD only): the fill shape's `connect()` awaits the whole opening GET, so the session is adopted after the
  fill and an ask never jumps; rows confirm (`sessionOpen` absent in every H3-fill/H2-fill visit, present in every
  other arm's). AD's H3-fill and H2-fill struck; other cells stand (derived). Amendment 17: -FIX, -FIX-REVIEW,
  TRANSPORT-AD-RERUN appended; TRANSPORT-PAGE waits on the rerun or 11-24 08:00.
* Fixtures: `dbts_b1` HTJ2K alone; one 4-core container, Chromium 157 headless; TUN relay ≤ 90 Mbit, scaled/assumed profiles.
* Owner: whether a fetch arm's wins (H3-frame on CR; H2-* on CPU, lossy links) justify a GET path (structural); whether
  WS's ask and loss results earn it a place beside WebTransport.
