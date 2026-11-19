state: done
started: 2026-11-19T08:16Z
heartbeat: 2026-11-19T10:25Z
outputs: claude/transport-arms 174538ad..66e04fca (lab/transport-arms/rows/AD-rerun.jsonl, its aa_rule inputs), 4b2abcb6 (docs/lines/codecs.md §Open 7); claude/transport-design dd754894 (stacks.md §6.6); no PR of its own (PR 403 carries the arms)
## Resume
Done. Run 08:31Z–10:24Z at claude/transport-arms 3c47ab63, one detached job (1 h 53 min), exit 0. TRANSPORT-PAGE
reads stacks.md §6.6.
## Result
TRANSPORT-AD-RERUN done: cell AD whole as §5 pre-registers it, both forms, eight arms, 16 rounds, Williams order.
* 256 visits, every frame exact (XXH3); 3 VOID (1 relay guard, 2 empty nextHopProtocol), none UNBALANCED; TCP read cubic.
* The fix took effect: in all 64 fill-shape visits the asked frame lands before the fill's rest (first run: 0 of 64).
* H3-fill 0.548, H2-fill 0.682 of WT-TS on ad-pub; 0.525, 0.501 on ad-lte (15/15, 15/15, 15/16, 13/16 rounds better):
  faster, a miss below §5.3's ×1.0–2.0. WS 0.738 / 0.468 faster; H3-frame 1.81 / 1.68, H2-frame 1.97 / 1.93 slower.
* A/A ties on both forms (ad-lte was not conclusive in the first run); other arms within 0.06 of the first run.
* WT-TS 743 ms (pub, ~0.8 s holds), 5 287 ms (lte, ~1.4 s misses, as in the first run).
* Busiest core median/max: pub 0.49/0.82, lte 0.15/0.44; no saturation.
Fixtures: dbts_b1 HTJ2K 50 frames (LTE form 16), one 4-core container, Chromium 157.0.8103.78 headless, TUN relay
≤ 90 Mbit, assumed and scaled profiles, no radio.
Owner decisions: whether the fill-shape fetch arms' faster ask during a fill (with §6.5's list) justifies a GET path in
the product: a second wire, structural, the owner's (§5.5).
