state: started
started: 2026-11-18T12:16Z
heartbeat: 2026-11-18T16:28Z
outputs: claude/transport-arms (rows), claude/transport-design (stacks.md §Results)
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
## Result
