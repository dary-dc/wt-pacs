Engine chromium; arms' pilots {"opfs-sync": "", "opfs-async": "group=8MiB&inflight=3&read=sync", "idb": "", "cachestorage": "inflight=3"}

none's median missed share in L: L-512-1x 0.0 %, L-2560-1x 0.0 %, L-3328-1x 0.0 %, L-512-4x 0.2 %, L-2560-4x-none 1.3 %, L-3328-4x-none 6.5 %

| cell | A/A | opfs-sync | opfs-async | idb | cachestorage |
| --- | --- | --- | --- | --- | --- |
| L-2560-1x | ok, A/A median |Δmissed| 0.11 %, |Δp99| 0.4 ms | fail: pss 0/12 | pass | fail: pss 0/12 | fail: pss 7/12 |
| L-512-1x | ok, A/A median |Δmissed| 0.00 %, |Δp99| 0.2 ms | fail: pss 1/6 | fail: pss 0/6 | fail: pss 0/6 | fail: pss 0/6 |
| L-3328-1x | ok, A/A median |Δmissed| 0.00 %, |Δp99| 0.8 ms | fail: pss 2/6 | pass | fail: pss 0/6 | pass |
| L-512-4x | ok, A/A median |Δmissed| 0.28 %, |Δp99| 2.0 ms | fail: pss 0/6 | fail: pss 0/6 | fail: delivered 0/6, pss 0/6 | fail: pss 0/6 |
| W-2560-1x | ok, A/A median ratio 0.959 | pass: 2422 MB/s, 6/6 | pass: 493 MB/s, 6/6 | pass: 254 MB/s, 6/6 | pass: 565 MB/s, 6/6 |
| W-512-1x | VOID, A/A median ratio 0.890 | pass: 2259 MB/s, 6/6 | pass: 287 MB/s, 6/6 | pass: 137 MB/s, 6/6 | pass: 250 MB/s, 6/6 |
| W-3328-1x | ok, A/A median ratio 1.003 | pass: 2535 MB/s, 6/6 | pass: 480 MB/s, 6/6 | pass: 270 MB/s, 6/6 | pass: 554 MB/s, 6/6 |
| R-idle-2560-1x | ok, A/A median ratio 1.001 | pass: p50 33.1 ms, 10/10 rounds within (bar 63.7 / 127.4) | pass: p50 33.1 ms, 10/10 rounds within (bar 63.7 / 127.4) | pass: p50 49.4 ms, 10/10 rounds within (bar 63.7 / 127.4) | fail: p50 58.3 ms, 5/10 rounds within (bar 63.7 / 127.4) |
| R-idle-512-1x | ok, A/A median ratio 0.999 | pass: p50 16.4 ms, 10/10 rounds within (bar 19.7 / 39.4) | pass: p50 16.4 ms, 10/10 rounds within (bar 19.7 / 39.4) | pass: p50 16.4 ms, 10/10 rounds within (bar 19.7 / 39.4) | pass: p50 16.4 ms, 10/10 rounds within (bar 19.7 / 39.4) |
| R-idle-3328-1x | ok, A/A median ratio 0.991 | pass: p50 33.1 ms, 10/10 rounds within (bar 85.7 / 171.4) | pass: p50 33.3 ms, 10/10 rounds within (bar 85.7 / 171.4) | pass: p50 62.4 ms, 10/10 rounds within (bar 85.7 / 171.4) | pass: p50 82.5 ms, 10/10 rounds within (bar 85.7 / 171.4) |
| R-idle-512-4x | ok, A/A median ratio 1.002 | pass: p50 16.5 ms, 10/10 rounds within (bar 19.7 / 39.4) | pass: p50 16.5 ms, 10/10 rounds within (bar 19.7 / 39.4) | pass: p50 16.5 ms, 10/10 rounds within (bar 19.7 / 39.4) | pass: p50 16.5 ms, 10/10 rounds within (bar 19.7 / 39.4) |
| R-busy-2560-1x | ok, A/A median ratio 1.009 | pass: p50 33.0 ms, 10/10 rounds within (bar 63.7 / 127.4) | pass: p50 33.0 ms, 9/10 rounds within (bar 63.7 / 127.4) | fail: p50 50.3 ms, 7/10 rounds within (bar 63.7 / 127.4) | fail: p50 74.0 ms, 0/10 rounds within (bar 63.7 / 127.4) |
| R-busy-3328-1x | ok, A/A median ratio 1.008 | pass: p50 33.5 ms, 10/10 rounds within (bar 85.7 / 171.4) | pass: p50 49.7 ms, 10/10 rounds within (bar 85.7 / 171.4) | fail: p50 79.9 ms, 5/10 rounds within (bar 85.7 / 171.4) | fail: p50 105.3 ms, 0/10 rounds within (bar 85.7 / 171.4) |
| B-2560-1x | ok, A/A median |Δmissed| 0.00 %, |Δp99| 0.1 ms | fail: L fail pss 0/6; R p50 30.0 ms, 6/6 rounds within (bar 63.7 / 127.4) | fail: L fail pss 3/6; R p50 29.4 ms, 6/6 rounds within (bar 63.7 / 127.4) | fail: L fail pss 0/6; R p50 41.4 ms, 6/6 rounds within (bar 63.7 / 127.4) | fail: L fail pss 0/6; R p50 50.7 ms, 6/6 rounds within (bar 63.7 / 127.4) |
| O-3328-1x | ok, A/A median ratio 0.967 | pass: warm 648 ms 10/10, cold 653 ms 10/10 | pass: warm 749 ms 10/10, cold 743 ms 10/10 | pass: warm 1462 ms 10/10, cold 1332 ms 10/10 | fail: warm 2128 ms 7/10, cold 2069 ms 9/10 |
| O-512-1x | ok, A/A median ratio 1.094 | pass: warm 93 ms 10/10, cold 78 ms 10/10 | pass: warm 475 ms 10/10, cold 373 ms 10/10 | pass: warm 488 ms 10/10, cold 405 ms 10/10 | pass: warm 695 ms 10/10, cold 617 ms 10/10 |
| E-3328-1x | — | pass: 4/4 | pass: 4/4 | pass: 4/4 | pass: 4/4 |
| K-3328-1x | — | pass: 4/4 | pass: 4/4 | pass: 4/4 | pass: 4/4 |
| Q-2560-1x | — | fail: 0/4 | pass: 4/4 | pass: 4/4 | pass: 4/4 |
| T-2560-1x | — | fail: 2/4 | pass: 4/4 | pass: 4/4 | pass: 4/4 |
| P-2560-1x | — | exact: 4/4 | exact: 4/4 | exact: 4/4 | exact: 4/4 |
