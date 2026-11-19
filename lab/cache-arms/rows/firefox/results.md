Engine firefox; arms' pilots {"opfs-sync": "", "opfs-async": "group=8MiB&inflight=3&read=sync", "idb": "", "cachestorage": "inflight=3"}

none's median missed share in L: L-512-1x 0.0 %, L-2560-1x 0.0 %, L-3328-1x 0.2 %, L-512-4x 0.1 %, L-2560-4x-none 18.0 %, L-3328-4x-none 34.0 %

| cell | A/A | opfs-sync | opfs-async | idb | cachestorage |
| --- | --- | --- | --- | --- | --- |
| L-2560-1x | ok, A/A median |Δmissed| 0.06 %, |Δp99| 0.3 ms | pass | pass | pass | pass |
| L-512-1x | ok, A/A median |Δmissed| 0.00 %, |Δp99| 0.2 ms | fail: pss 1/6 | fail: pss 3/6 | fail: pss 0/6 | fail: pss 0/6 |
| L-3328-1x | ok, A/A median |Δmissed| 0.11 %, |Δp99| 0.9 ms | pass | pass | pass | pass |
| L-512-4x | ok, A/A median |Δmissed| 0.23 %, |Δp99| 0.4 ms | fail: pss 1/6 | fail: pss 0/6 | fail: pss 0/6 | fail: pss 0/6 |
| W-2560-1x | ok, A/A median ratio 1.012 | pass: 1844 MB/s, 6/6 | pass: 704 MB/s, 6/6 | pass: 234 MB/s, 6/6 | pass: 331 MB/s, 6/6 |
| W-512-1x | ok, A/A median ratio 1.010 | pass: 871 MB/s, 6/6 | pass: 448 MB/s, 6/6 | pass: 136 MB/s, 6/6 | pass: 201 MB/s, 6/6 |
| W-3328-1x | ok, A/A median ratio 0.954 | pass: 1635 MB/s, 6/6 | pass: 813 MB/s, 6/6 | pass: 238 MB/s, 6/6 | pass: 319 MB/s, 6/6 |
| R-idle-2560-1x | ok, A/A median ratio 0.992 | pass: p50 33.6 ms, 10/10 rounds within (bar 63.7 / 127.4) | pass: p50 33.6 ms, 10/10 rounds within (bar 63.7 / 127.4) | fail: p50 89.4 ms, 0/10 rounds within (bar 63.7 / 127.4) | fail: p50 101.4 ms, 0/10 rounds within (bar 63.7 / 127.4) |
| R-idle-512-1x | ok, A/A median ratio 1.000 | pass: p50 16.7 ms, 10/10 rounds within (bar 19.7 / 39.4) | pass: p50 16.8 ms, 10/10 rounds within (bar 19.7 / 39.4) | pass: p50 16.8 ms, 10/10 rounds within (bar 19.7 / 39.4) | pass: p50 16.8 ms, 10/10 rounds within (bar 19.7 / 39.4) |
| R-idle-3328-1x | ok, A/A median ratio 0.992 | pass: p50 65.1 ms, 10/10 rounds within (bar 85.7 / 171.4) | pass: p50 67.5 ms, 10/10 rounds within (bar 85.7 / 171.4) | fail: p50 152.0 ms, 0/10 rounds within (bar 85.7 / 171.4) | fail: p50 169.1 ms, 0/10 rounds within (bar 85.7 / 171.4) |
| R-idle-512-4x | ok, A/A median ratio 1.000 | pass: p50 16.8 ms, 10/10 rounds within (bar 19.7 / 39.4) | pass: p50 16.8 ms, 10/10 rounds within (bar 19.7 / 39.4) | pass: p50 16.8 ms, 10/10 rounds within (bar 19.7 / 39.4) | pass: p50 16.8 ms, 10/10 rounds within (bar 19.7 / 39.4) |
| R-busy-2560-1x | ok, A/A median ratio 1.008 | pass: p50 33.9 ms, 10/10 rounds within (bar 63.7 / 127.4) | pass: p50 34.4 ms, 10/10 rounds within (bar 63.7 / 127.4) | fail: p50 151.4 ms, 0/10 rounds within (bar 63.7 / 127.4) | fail: p50 114.7 ms, 0/10 rounds within (bar 63.7 / 127.4) |
| R-busy-3328-1x | ok, A/A median ratio 0.992 | pass: p50 66.6 ms, 10/10 rounds within (bar 85.7 / 171.4) | pass: p50 68.3 ms, 10/10 rounds within (bar 85.7 / 171.4) | fail: p50 222.4 ms, 0/10 rounds within (bar 85.7 / 171.4) | fail: p50 179.1 ms, 0/10 rounds within (bar 85.7 / 171.4) |
| B-2560-1x | ok, A/A median |Δmissed| 0.11 %, |Δp99| 0.6 ms | pass: L pass ; R p50 34.6 ms, 6/6 rounds within (bar 63.7 / 127.4) | pass: L pass ; R p50 37.9 ms, 6/6 rounds within (bar 63.7 / 127.4) | fail: L fail pss 0/6; R p50 202.5 ms, 0/6 rounds within (bar 63.7 / 127.4) | fail: L pass ; R p50 130.0 ms, 0/6 rounds within (bar 63.7 / 127.4) |
| O-3328-1x | ok, A/A median ratio 0.996 | pass: warm 697 ms 10/10, cold 748 ms 10/10 | pass: warm 916 ms 10/10, cold 1036 ms 10/10 | fail: warm 3697 ms 0/10, cold 3731 ms 0/10 | fail: warm 4158 ms 0/10, cold 4287 ms 0/10 |
| O-512-1x | ok, A/A median ratio 1.001 | pass: warm 142 ms 10/10, cold 315 ms 10/10 | fail: warm 1173 ms 0/10, cold 1314 ms 0/10 | fail: warm 707 ms 10/10, cold 924 ms 1/10 | fail: warm 870 ms 0/10, cold 1080 ms 0/10 |
| E-3328-1x | — | fail: 0/4; errors: the quota lever does not hold: E not run | fail: 0/4; errors: the quota lever does not hold: E not run | fail: 0/4; errors: the quota lever does not hold: E not run | fail: 0/4; errors: the quota lever does not hold: E not run |
| K-3328-1x | — | pass: 4/4 | pass: 4/4 | pass: 4/4 | fail: 2/4; errors: Cannot read properties of null (reading 'written') |
| Q-2560-1x | — | fail: 0/4; errors: the quota lever does not hold: Q not run | fail: 0/4; errors: the quota lever does not hold: Q not run | fail: 0/4; errors: the quota lever does not hold: Q not run | fail: 0/4; errors: the quota lever does not hold: Q not run |
| T-2560-1x | — | pass: 4/4 | pass: 4/4 | pass: 4/4 | fail: 0/4; errors: WebDriver:Navigate: no answer in 60000 ms |
| P-2560-1x | — | not exact: 0/4 | not exact: 0/4 | exact: 4/4 | exact: 4/4 |
