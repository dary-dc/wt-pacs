state: started
started: 2026-11-23T01:17Z
heartbeat: 2026-11-23T01:20Z
outputs: claude/memory-on-navigation (from origin/claude/unified)
## Resume
Branch claude/memory-on-navigation created from origin/claude/unified (nothing pushed yet). Found: Playwright's
Chromium launch passes --disable-back-forward-cache by default, so a reproduction must drop it
(ignoreDefaultArgs) to match the phone's Chrome. Building: series-server/pack-series (cargo --release), TS client
(done), ingest/tools.sh, lab/av1/fetch_data.sh dbts_b1; then ingest dbts_b1 (exact) and dbts_b1-q8-g16 as
scripts/demo-series.sh does, serve with scripts/demo-pair.sh, and drive repeated same-origin navigations
(viewer -> another same-site origin -> 302 back, the round's /next pattern), reading each renderer's PSS from
/proc/<pid>/smaps_rollup and CDP Page.backForwardCacheNotUsed.
## Result
