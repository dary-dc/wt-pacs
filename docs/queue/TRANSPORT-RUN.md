state: done
started: 2026-11-18T12:16Z
heartbeat: 2026-11-19T03:00Z
outputs: claude/transport-arms rows 9fb9eff6..70a70950 (lab/transport-arms/rows/), 7ab31404 4cd38e48 (the pilot's pooled relay check), 57bb45e0 (summary.py), 0bb23cfe (lines/codecs.md §Open 7); claude/transport-design 0de5b554 (§5.7 the pilot's amendment), fec263c3 2783ee2d (§6 Results); PR 403
## Resume
Claimed 12:2xZ. Host: Chromium 157.0.8103.78 (playwright's), neither of §1's tags, so §5.2's four window constants
were re-read at 157.0.8103.78 (chromium.googlesource.com, ?format=TEXT): net/quic/quic_context.cc
`kQuicSessionMaxRecvWindowSize = 15 * 1024 * 1024;  // 15 MB`, `kQuicStreamMaxRecvWindowSize = 6 * 1024 * 1024;    // 6 MB`;
net/http/http_network_session.cc `kSpdySessionMaxRecvWindowSize = 15 * 1024 * 1024;  // 15 MB`,
`kSpdyStreamMaxRecvWindowSize = 6 * 1024 * 1024;    //  6 MB`. Unchanged from 141 and 158: no amendment.
Host built 2026-11-18T12:27Z (TRANSPORT-BUILD-FIX's setup, plus ingest/tools.sh and dbts_b1 as HTJ2K per lab/transport-arms/README.md
§The run's series). Series: dbts_b1 HTJ2K at /home/user/series (50 frames, 107 407 602 B, every one exact at ingest; 2.15 MB a frame).
Smoke (not counted, not pushed): CLEAN 1 round of WT-TS, H3-fill, H2-frame, WS: 50/50 exact each, ~9.94 s, h3/h2, cubic.
Running since 2026-11-18T12:27Z: the pilot, AA AD CR FF LOSS LTE CLEAN PUB ENT FP (rows/<CELL>-pilot.jsonl), by
`bash $SCRATCH/pilot.sh` = for each cell `node lab/transport-arms/run.mjs --cell C --pilot --series /home/user/series
--server target/release/series-server --limit-ms 300000`; rows pushed every 15 min to claude/transport-arms. After it: (2 rounds of every cell, not counted), its choices amended into
stacks.md §5.7, then the counted cells in §5.4's order. Reading: the 12 h stop counts from the first counted row.
Worktrees: /home/user/arms (claude/transport-arms), /home/user/ledger (claude/work-ledger).
Pilot AA done 12:53Z: 96 visits, 0 VOID, every frame exact; AD next.
Pilot 13:35Z: AA, CR, FF, LOSS done (0 crashes; VOIDs: relay guard 5, one H2-frame LOSS visit 'spoke h2,, not h2', an empty nextHopProtocol entry, kept as VOID). AD-lte and LTE: PILOT REFUSES 'too few packets to check 0.1 % loss' (one visit ~27k packets); fixed on claude/transport-arms 7ab31404/4cd38e48 (judge.mjs pooledRelay: pooled over the form's pilot visits; judge.test.mjs, three mutants killed) — a driver change after the build's review, named for the verdict review. Refused rows kept as rows/{AD,LTE}-pilot.refused-per-visit.jsonl; AD and LTE pilots rerun after CLEAN PUB ENT FP (log pilot2.log).
14:35Z: the job running the pilot was stopped at this container's 2 h background limit inside ENT (13 of 16 visits, kept as rows/ENT-pilot.cut-at-2h.jsonl). ENT's fills take 146-201 s a visit, not ~9.6 s (a miss, all arms; 50/50 exact). Cells now run one job each by $SCRATCH/cell.sh (rows pushed every 15 min and at the end). Running: pilot FP, AD, LTE with --limit-ms 600000 (log pilot3.log). Next: pilot medians from wallMs → rows/pilot-medians.json, the amendment in stacks.md §5.7, then counted AA AD CR FF LOSS LTE CLEAN PUB ENT FP, each a job ≤ 2 h (AA split by --rounds is not possible: run forms whole).
15:05Z: pilot complete (rows 9fb9eff6 on claude/transport-arms), amendment stacks.md §5.7 (claude/transport-design 0de5b554). Counted run starts now, detached: `setsid nohup bash $SCRATCH/counted.sh` = for each of AA AD CR FF LOSS LTE CLEAN PUB ENT FP within 12 h of the start: `node lab/transport-arms/run.mjs --cell C --series /home/user/series --server target/release/series-server --limit-ms 600000 --pilot-medians lab/transport-arms/rows/pilot-medians.json` (rows/C.jsonl, pushed every 15 min). To resume in a fresh container: the setup above, the series (README §The run's series), then run only the cells whose rows/C.jsonl is absent or partial (a partial kept renamed, counted in no bar); the 12 h counts from the first counted row's `at`. After it: aa_rule.py per form, §Results in stacks.md.
18:30Z: AA counted complete (768 visits, 4 VOID by the relay guard, every frame exact; rows/AA.jsonl). AD running since 18:29Z. Summaries by `python3 lab/transport-arms/summary.py lab/transport-arms/rows <CELLS>` (57bb45e0).
20:21Z: AD counted complete (256 visits, 2 VOID, every frame exact). CR running.
21:58Z: CR counted complete (128 visits, 1 VOID). FF running. Found in AD's rows: H3-fill and H2-fill's ask had no effect (frames 0-49 strictly in order, frame 49 last at ~10 s): the fill shape's abort-and-reGET did not happen; a suspected carrier defect, for the verdict review.
22:46Z: FF counted complete (256 visits, 26 VOID by the relay guard). LOSS running; then LTE CLEAN PUB ENT FP to the 12 h stop at 02:58Z (ENT will be cut, FP not reached at the pilot's rates).
00:44Z: LOSS, LTE, CLEAN, PUB counted complete. ENT running until the 12 h stop (02:58Z); FP will not be reached.
00:52Z: the container restarted at ~00:50Z and stopped the detached run inside ENT's first period (1 visit, kept as rows/ENT.partial-0051.jsonl, no bar). Resumed 00:51Z by $SCRATCH/counted2.sh: ENT then FP until the 12 h stop at 02:58Z.
## Result
TRANSPORT-RUN done: stacks.md §5 as pre-registered, 14:58Z to the 12 h stop 02:58Z; 9 of 10 cells (FP not reached); results in
claude/transport-design stacks.md §6, each cell against its prediction. Every frame of 1 706 counted visits exact (XXH3).
* Fills tie on clean links (CLEAN, PUB: every arm ×0.999–1.003); BYTES within ±0.2 % of WT (WT 1.037 of the frames' bytes).
* AA: after 5 s idle the TCP arms are ×1.35–1.70, WT and H3 keep their window (the record's line); at 1 s they tie, since
  Linux's tcp_cwnd_restart halves once per RTO rather than resetting (sourced at v6.18).
* §4's retraction met once: H2 and WS first frames land within 1 RTT of WT (×1.00–1.016); §3's "one RTT more" retracted.
* WS faster for an ask during a fill (×0.718 PUB, ×0.448 LTE) and on ENT (×0.842); H3-frame faster on CR (×0.630).
* Server CPU over kernel TCP ×0.15 of WT; H3 fetch ×1.6 client CPU. ENT's fills ~18× the prediction (176 s).
* Suspected carrier defect: H3-fill/H2-fill's ask never took effect (frames strictly in order, ×11 on AD) — for the verdict review.
* A pilot check fixed test-first (pooled 0.1 % relay check; 3 mutants killed), amended in §5.7 with the pilot's choices.
Fixtures: dbts_b1 HTJ2K 50 frames, one 4-core container (busiest core ≤ 0.91), Chromium 157.0.8103.78 headless, TUN relay
≤ 90 Mbit, scaled and assumed profiles, no radio. A container restart at ~00:50Z cost one ENT visit (kept, no bar).
Owner decisions: none from the run (a GET path is structural and the owner's, after TRANSPORT-VERDICT-REVIEW).
