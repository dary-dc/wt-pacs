state: done
started: 2026-11-24T09:17Z
heartbeat: 2026-11-24T09:24Z
by: 8WjiR5Mw
outputs: claude/page-runs f85b2b5e4 (docs/reviews/page-runs.md; docs/lines/coordination.md); no PR (findings-only row)
## Resume
Done. PAGE-RUNS-PROTOCOL-REVIEW reads docs/reviews/page-runs.md on claude/page-runs and writes its §Review.
## Result
docs/reviews/page-runs.md pre-registers seven sections; nothing run, gate not run (docs only: check_links and the
comment budget OK).
1 Transport: WT-TW (--send-window-follows-cwnd) and WT-PF (--stream-mode per-frame) against WT-TS, A/A, H3-fill,
  H3-frame on AD-PUB, AD-LTE, CR, 12 rounds. The rig cannot pass per-arm server flags and builds without lab-levers:
  the run row adds both first. TW predicted x0.80-1.02 on AD (two 2.15 MB frames make the window near 6 MiB), PF
  x0.60-1.00 on CR. The page's "one queue" is --fill-resumes-after-asks in ask-during-a-fill.md: QW is not an arm.
2 Reports: the Firefox BiDi driver's hang, timeout and profile leak fixed first; (a) C with KEEPALIVE-Y on off's
  decoder (predicted x0.97-1.03); (b) Lbusy and busy D5a with a us sink clock (BEACON predicted 4-14 of 18 delivered).
3 Engines: the G=8 trace (prediction: our dispatch, low confidence); M5 on Firefox 160.0.1 under the amended bar,
  all six arms (the rig cannot run a subset), ring - disk predicted 250-310 MiB.
4 Asking: P1, P1b, P1c, P2 (a tie) with A/A and bands; five lab builds needed first (no rig runs legs or a hold key).
5 Cache: only if CACHE-DESIGN-1124 keeps it (not started at writing), else provisional at 11-25 12:00; IDB left out.
6 As time allows: M-R2, cell T, dav1d rule (3), the fault bench's twelve cells, non-cine §7 (not built).
7 repository item 4's two-host check: blocked in one container; local commands given.
Fixtures: 19 DBT volumes of one dataset (three timed), lossy-sourced US only; 4-core cloud, no GPU; a relay, not a radio.
