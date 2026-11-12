state: started
started: 2026-11-12T09:32Z
heartbeat: 2026-11-12T09:34Z
outputs: claude/fill-split (not yet pushed)
## Resume
Branch claude/fill-split from claude/link-calibration 1f7a2f2c (worktree ../wt-fill). Found from raw/ (explore script, not
yet committed): per counted load, sum(decodeMs)/3 (the run commit's 3 decoders, downloader.js cfg.decoders) is
88-95 % of the fill; wire time (path rows) 0.25-0.75 s, all within the first ~1 s of the session; loads 6 and 10
are slow decodes (median 524 / 872 ms per frame), not slow wire. Next: lab/phone/fill.py + fill_test.py (gate line,
mutants), reuse link.sessions (return the load as first element); then docs/phone-rows/README.md wire-time "open"
closed in place + a FILL-SPLIT section; docs/lines/optimal-quality.md; status done.
## Result
