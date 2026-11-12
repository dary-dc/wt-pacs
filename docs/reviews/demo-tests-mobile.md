# The demo's tests for a phone on lossy wireless (TEST-MOBILE, 2026-11-11)

On `claude/demo-tests-mobile`, from the demo tip `claude/demo-fixes-0` (`618e13c8`). Tests added, mutated, run; nothing
in the product changed.

**Fixtures and their limits.** `dbts_a1` (56 frames, 12-bit, its depth cut `dbts_a1-q8-g8-cut`) and `dbts_b1` (50 frames,
10-bit, `dbts_b1-q8-g8`, coded at its own depth), each with its exact HTJ2K series, written by `scripts/demo-series.sh`'s
own ingest step. Both come from one tomosynthesis dataset; no breast ultrasound cine. One 4-core x86-64 cloud host,
no GPU: headless Chromium (Playwright 1.56.1) on SwiftShader, the ts client, the page view. One run per cell.

## What each test claims, and the mutants it killed

| test | claim | mutants killed |
| --- | --- | --- |
| `controller.test.mjs` *the label runs every state…* | optimal → asking → failed (a rejected ask, its reason sent as a frame failure) → asking on `l` → lossless → optimal; the retry asks again | failed shown as asking; no retry after failed; a rejected ask left asking; the failure not sent |
| *an unchecked exact frame is labelled failed…* | `unchecked` is *failed*, never *lossless*, reason names the missing digest | unchecked taken as checked; the reason dropped |
| *lossless before the exact series is connected…* | `l` with no exact series asks nothing, label stays optimal | the `exactSource` guard removed |
| *a frame asked exact is asked once…* | `l`, `l`, cancel, `l` during one ask: one ask, ends lossless | the ask not shared |
| *a window change keeps the exact frame…* | a window change repaints the exact frame, label stays lossless | the window change drops the exact frame; the store's frame painted first |
| `av1.test.mjs` §lossy, three checks | ≤ 10 bits: after a WebCodecs failure the next frame tries WebCodecs again; > 10 bits: dav1d stays after the refusal; a frame inside a group that WebCodecs decodes never reaches dav1d | the ≤ 10-bit refusal kept like the > 10-bit one; in-group frames sent to dav1d. One mutant lives: the refusal recorded at every depth, which no ≤ 10-bit route reads (equivalent) |
| `demo-check.mjs`, the wrong digest | `l` then `l` again: *Optimal quality → fetching → Lossless check failed → fetching → Lossless check failed*, in order | no retry after failed (the browser ran three labels, not five) |

`demo-check.mjs --link "OPTIONS"` sends both sessions through one `lab/scripts/link_impair.py` (one phone, one queue).
netem was asked for; this kernel has no `sch_netem` (`tc qdisc add dev lo root netem` → *Specified qdisc kind is
unknown*), so the repository's userspace relay stands in: delay one way each direction, uniform jitter that reorders,
iid loss, a 50-packet queue. The page's HTTP stays on loopback. A fill that does not end now says how far it got,
and the second `l` waits up to 60 s for its answer, not 10 s.

The existing coverage already held the depth cut and D ≤ 10 (`pair.test.mjs`, `ingest/coded-frames/lossy_test.py`,
`depth-cut.browser.mjs`); REDTEAM-DEMO's finding 3 covers a cut applied to frames of any depth. Nothing added there.

## Over the relay ([round-1](demo-tests-mobile/round-1.txt), [round-2](demo-tests-mobile/round-2.txt), [round-3](demo-tests-mobile/round-3.txt))

Within a round the cells ran interleaved per series; rounds 1 and 2 ran none, 40 ± 10 ms 2 %, 80 ± 20 ms 5 %;
round 3 none and 40 ms 2 %. Times are ms from navigation: the last frame of the fill, the exact frame after
`l` (filling / on demand), and `End` on demand (a whole group of 8 asked).

| series | link | result | fill | Lossless | jump |
| --- | --- | --- | --: | --: | --: |
| `dbts_a1-q8-g8-cut` | none | passed (×3) | 1662–1803 | 58–71 / 62–86 | 311–350 |
| `dbts_a1-q8-g8-cut` | 40 ms, 2 % | passed | 36 189 | 5 884 / 2 757 | 9 824 |
| `dbts_a1-q8-g8-cut` | 40 ± 10 ms, 2 % | passed (round 2); round 1 failed only the retry, the check's old 10 s wait | 73 058 | 16 435 / 17 321 | 9 321 |
| `dbts_a1-q8-g8-cut` | 80 ± 20 ms, 5 % | **failed** both rounds: 39 of 56 frames in 120 s | — | — | — |
| `dbts_b1-q8-g8` | none | passed (×3) | 5428–5759 | 173–215 / 186–212 | 625–684 |
| `dbts_b1-q8-g8` | 40 ms, 2 % | **failed**: 33 of 50 frames in 120 s | — | — | — |
| `dbts_b1-q8-g8` | 40 ± 10 ms, 2 % | **failed** both rounds: 16 of 50 in 120 s | — | — | — |
| `dbts_b1-q8-g8` | 80 ± 20 ms, 5 % | **failed** both rounds: 7 of 50 in 120 s | — | — | — |

Wherever a pass got through, every claim held: every frame on `av1-webcodecs`, the label in order, the wrong digest's
label never *Lossless*, no console error. The failures are of time, not of correctness: each fill was still landing
frames, each checked, when the 120 s ran out.

* **The link, not the page, is the limit.** Without jitter, `dbts_a1`'s fill at 40 ms and 2 % takes 36 s; the
  classic loss-limited rate at that round trip and loss (1452-byte datagrams) would take ~30 s
  ([`docs/rig-limits.md`](../rig-limits.md) §3 found Cubic at that bound on a real lossy path). The relay carried
  ~5 000 datagrams a run, far below anything it was asked to carry elsewhere; its own ceiling was not measured here.
* **Reordering, likely, doubles it.** With 10 ms of jitter, which reorders, the fill took 73 s and Lossless 16–17 s.
  The two cells ran in different rounds, not interleaved, one run each: a direction, not a measured ratio. Not separated: how much is the relay's uniform jitter, which reorders more than Wi-Fi would.
* **Lossless costs a whole exact frame.** ~1.2 MB of HTJ2K per `dbts_a1` frame: 2.8–5.9 s at 40 ms and 2 %, the
  higher while the fill shares the link.
* **A jump on demand costs its group.** `End` asks the 8 frames of its group: ~10 s at 40 ms and 2 %.
* Not run: a phone, its Chrome, real Wi-Fi, netem itself, a GPU, `dbts_c1`, G 1 and 16, the stored forms, Q 24,
  the view worker, BBR (rig-limits §3's lever on a lossy link, priced and not taken).

## Failures recorded, fixed nowhere

1. At 80 ± 20 ms and 5 %, and for `dbts_b1` at 40 ms and 2 % with or without jitter, the fill does not end within
   120 s. Whether that is a failure is the owner's: it names the link the demo can promise, not a defect in the page.
2. Lossless at 2 % loss takes 3–17 s for one frame: the label says *fetching lossless…* throughout, correctly, but a
   presenter on Wi-Fi with loss should expect it.
