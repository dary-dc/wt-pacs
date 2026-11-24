state: done
started: 2026-11-24T19:27Z
heartbeat: 2026-11-24T20:23Z
by: Zz3Kihvk
outputs: claude/engines 7048b6534 (trace), cc2b4c22d (3a rows), 9881d90dd (3b rows); claude/page-runs 13a0c5eca (page-runs.md §3 Results, docs/lines/coordination.md)
## Resume
Done. Nothing owed by this row. PAGE-RUNS-VERDICT (a session that ran none of the runs) reads page-runs.md §3 Results.
## Result
3a (measured, 6 of 6 traces complete, Firefox 159.0.1 and 160.0.1 alternating): the G = 8 inter frames never reach
a VideoDecoder. av1-payload.js layouts() reads a delta unit's layout from a sequence header it lacks, so it probes
g8, which Firefox refuses at configure. The frame goes to dav1d-WASM, which never had the keyframe. Every frame was
routed to its keyframe's decoder; "elsewhere" counts missing frames. The prediction held on whose fault (the client's)
and missed on the mechanism (not callback timing). The engine's inter decode is not shown, right or wrong.
3b (measured, 12 rounds, 72 rows, every frame exact): disk 526 and ring 764 MiB held; ring - disk 237 missed (below
250-310); 12 of 12 under the 846 MiB bar held; A/A 47 MiB, 0.98 (not VOID); ring fill / today 1.24 [1.13-1.43]
missed 0.80-0.95. The bar flips: ring does not qualify on Firefox 160.0.1. CPU 0.71 busy, near the host's ceiling.
Gate: scripts/gate.sh --quick on claude/engines at 9881d90dd, OK in 666 s (absence checks skipped by --quick).
Fixtures and limits: 3a the rig's synthetic 8-bit 4:4:4 g8x20 set; 3b one synthetic 80-frame 3328x4096 series on
loopback; neither DBT pixel data nor ultrasound. One 4-vCPU cloud container without a GPU, software decode.
For BRIEF-WEEKEND's list: the layout bug (an inter frame takes its group's layout from its keyframe), a bug with no
trade-off, not built here. No new owner decision; lever 2 stays with the owner, as before.
