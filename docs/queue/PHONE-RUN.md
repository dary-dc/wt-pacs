state: done (raw rows complete; analysis and decisions wait for the blind read)
started: 2026-11-11T15:20Z
heartbeat: 2026-11-12T01:05Z
outputs: claude/phone-rows 4e492c92 (docs/phone-rows/: raw rows, server traces, README with the result; lab/phone/rows.py, losses.py); claude/phone-devtools eb028344 (request 4b)
## Resume
The run is closed (2026-11-11, 20:53-00:30Z); servers stopped. RAW ROWS COMPLETE: PHONE-BLIND-READ may start on
claude/phone-rows (docs/phone-rows/raw/, README's Reproduce; the README's readings are this session's, so give the
blind reader raw/ and docs/devices.md section 7 first). The owner stopped for other topics: no further phone loads
until the next round, not today.

Next round, theory first (the owner, 2026-11-12: "theory should guide us"). Rows asked of the coordinator, one
question each; use this run's traces as calibration data wherever they apply:
1. HOSTNET-THEORY: production's network mode for series-server, host networking vs published ports (rootless
   podman's pasta relay, rootful NAT): per-packet cost, what each does to the congestion controller's view and the
   per-session telemetry, the isolation given up, sourced; a proposal for deploy/. The prod-like check was not run.
2. LOSSLESS-UNDER-LOSS: why load 6's Lossless was never fetched (exact session: handshake only, 10 packets, after a
   fill with 7 % loss): the exact session's lifecycle and errors in the client, theory first, then a reproduction
   through lab/scripts/link_impair.py labelled simulated, then a fix proposal (retry, reconnect).
3. HIDDEN-PAGE-DECODE: Chrome's WebCodecs codec reclamation for hidden pages (official sources), what the client does
   when a decoder is lost mid-group (load 13: keyframes at ~18 s, then the group refused), a fix proposal; and the
   beacon recording visibility so a run can tell interference from failure.
4. LINK-CALIBRATION: a "home Wi-Fi, server wired" profile for link_impair.py/netem from this run's path rows and loss
   traces (base RTT, queue growth in ms, losses all congestive, a bottleneck-rate estimate), compared with the lab's
   profiles; and why the same link's min RTT differs by controller (cable: 6.1 ms Cubic, 2.2 ms BBR).
5. FILL-SPLIT: what bounds a fill on the phone: wire time (path rows) is 0.5-1.0 s of a 2.4-3.3 s fill; split the
   rest from the beacon's per-frame decode times; say where the phone saturates.
This session's own (phone tooling, before the next round): RUNNER-AUTO, a runner needing no hands (auto-start from
the launched URL, no counter pauses when the laptop records the counters, Screen Wake Lock so the timers do not stop,
visibility and interruptions in the beacon, robust to a tether address change); the DevTools socket that does not
answer (Chrome 157); adb authorisation that does not persist.
The next round's protocol (an amendment by a session that will not run it) waits for 1-5 and RUNNER-AUTO, and should
cover: the show list's first series (dbts_a1-q8-g8-cut, where the start weighs most) beside dbts_b1-q8-g8; a fresh
Chrome profile or closed tabs; the phone untouched; a cellular arm only if a server the phone reaches over the
Internet is in scope.
Local state on the owner's laptop, for the next phone session (none of it in git):
~/Desktop/projects/wt-pacs-data/ holds the coded demo series (demo-series/c6da7275-aom3.15.1-ojph0.31.0-dav1d1.5.4,
valid for 962226e8: no change under ingest/, lab/av1/, scripts/demo-series.sh, common/; BUILT.txt), the IDC source
volumes (sources/idc-dbts) and the container-built coders and venv (tools/); rebuild only when the coders change, in a
throwaway container from the local `rust` image with `--cpus=2` and taskset inside. Podman image
wt-pacs-server-telemetry is 962226e8's (label checked). adb in ~/opt/platform-tools. Worktrees: wt-pacs-phone-962
(claude/phone-rows, `demo-series` linked to the set above, target/phone-run/ the unstripped logs) and wt-pacs-ledger.
The laptop's Wi-Fi radio was left off for the run (`nmcli radio wifi on` restores it); the tether's never-default is
runtime only. The command functions as run: docs/phone-rows/run-env.sh. Lessons for the runs: docs/phone-rows/README.md
"Where the run departed from the protocol".
## Result
docs/phone-rows/README.md on claude/phone-rows (4e492c92). By the pre-registered rules, before the blind read:
tether 23 passed, 1 missing (load 7: the tether's address changed); worker/page depends on the controller;
bbr/cubic-restart no difference shown (n = 11). Wi-Fi (server wired): 22 passed, 2 failed, both bbr (load 6:
Lossless never fetched after a fill with 7 % loss; load 13: decode lost, page likely hidden by the owner in Settings
at this session's request, server lost 0); worker/page no difference shown (n = 10); cubic-restart faster (9 of 10,
median 1.084). Loss: all of Cubic's Wi-Fi losses congestive (89 events, 0 random); the tether lost under Cubic only.
Deviations: reruns of loads 6 and 8 and an interrupted load 9 left out by id; a gap of 20 minutes before load 12
(screen asleep); the owner touched the phone during counted loads; prod-like check not run. Product findings: a failed
Lossless is not retried; a hidden page's fill does not recover its decoder; the runner is not hands-off.
Decisions: none yet (the owner's, after PHONE-BLIND-READ).
