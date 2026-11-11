# The view worker against the page view: README §Demo's 20 series

`client/viewer/demo-check.mjs DIR ID [--route av1-dav1d] --view page|worker` (README §Demo), every series of
`scripts/demo-series.sh` with a `-q` in its id, both views, the view run first alternating by series. Each run is
the check's whole claim set: every frame painted in order, Home, End, `l` and back, under the fill and under
`?fill=0`, the decode route (`av1-dav1d` for the two `-stored` forms), no console error, the label's order, whole
groups on demand, a wrong exact digest never labelled *Lossless*, and now the status line naming the view asked for.

Run 2026-11-11 on `claude/demo-view-worker` (from `claude/demo-fixes-0` 618e13c8, plus `--view`), headless Chromium
(Playwright 1.56), SwiftShader, Chrome's software AV1 decoder, loopback.

| series | first | page | worker |
| --- | --- | --- | --- |
| `dbts_a1-q24-g1-cut` | page | passed | passed |
| `dbts_a1-q24-g16-cut` | worker | passed | passed |
| `dbts_a1-q24-g8-cut` | page | passed | passed |
| `dbts_a1-q8-g1-cut` | worker | passed | passed |
| `dbts_a1-q8-g16-cut` | page | passed | passed |
| `dbts_a1-q8-g16-stored` | worker | passed | passed |
| `dbts_a1-q8-g8-cut` | page | passed | passed |
| `dbts_b1-q24-g1` | worker | passed | passed |
| `dbts_b1-q24-g16` | page | passed | passed |
| `dbts_b1-q24-g8` | worker | passed | passed |
| `dbts_b1-q8-g1` | page | passed | passed |
| `dbts_b1-q8-g16` | worker | passed | passed |
| `dbts_b1-q8-g8` | page | passed | passed |
| `dbts_c1-q24-g1-cut` | worker | passed | passed |
| `dbts_c1-q24-g16-cut` | page | passed | passed |
| `dbts_c1-q24-g8-cut` | worker | passed | passed |
| `dbts_c1-q8-g1-cut` | page | passed | passed |
| `dbts_c1-q8-g16-cut` | worker | passed | passed |
| `dbts_c1-q8-g16-stored` | page | passed | passed |
| `dbts_c1-q8-g8-cut` | worker | passed | passed |

**40 of 40 passed**: on this check, the view worker meets the page view's correctness bar on every
demo series. Correctness only: no latency or throughput is claimed from these runs (one 4-core cloud host, no GPU,
no real link). Which view the demo shows is the owner's.

Fixtures and their limits: `dbts_a1`, `dbts_b1`, `dbts_c1`, three DBT volumes from one dataset, at Q 8 and Q 24,
G 1, 8 and 16, the 12-bit two as depth cuts plus one stored form each; no breast ultrasound cine; a 4-core cloud
host without a GPU; no phone, no lossy link.
