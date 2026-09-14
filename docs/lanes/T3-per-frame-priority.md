# T3 — Per-frame streams with ask-order priority under loss (arm Q)

**Status:** built, unmeasured at 250 KB · **Needs:** the cloud rig · **Size:** one rig day

## Question

One stream for everything holds every later frame behind one lost packet; per-frame streams
with FIFO scheduling lost 5.76× at 250 KB because quinn re-queues a retransmit behind every
stream already pending at the same priority. `--stream-mode per-frame` now sets each frame's
priority to descend with its ask, so a lost frame's retransmit goes ahead of newer frames'
data and frames recover in parallel. At 32 KB this arm read inside noise at 0.5 % loss,
+1.5 % pooled at 2 %, and +28 % on the reader clock at 2 % (`L1_V3_PHASE_C_REVIEW.md` on the
archive tag). It has never run at 250 KB, the frame size where the shared stream's cost was
measured.

## Decision rule

L1's, unchanged: Q must beat shared by more than 15 % on miss-only p95 wait at 0.5 % loss,
each arm at its own `D_min`, with the null cell (0 % loss) inside a 15 % confidence interval,
at least five samples at or above the p95, and reader-clock lateness reported beside it. Then
per-frame becomes the default and `shared` stays the flag. Otherwise close it and record that
per-frame streams lost on a fair comparison; the priority stays in the flag regardless.

## Steps

1. `lab/scripts/rig_cells.sh q` at 250 KB, RTT 60 ms, 10 Mbit, loss 0 / 0.5 / 2 % iid and
   0.5 % Gilbert–Elliott, six repeats: arms `shared` and `--stream-mode per-frame`, the driver
   at each arm's `D_min` (2 for shared at 250 KB; per-frame's from the same formula).
2. The browser arm of the same cell: `browser_cell.py` with `stream_mode=per-frame` — the TS
   client reads per-frame unis already, waiters are keyed by index, and out-of-order arrival
   is handled. Note whether Chromium's uni-stream credit ever blocks `open_uni` on the server
   (`anticipatedConcurrentIncomingUnidirectionalStreams` is the client's answer if it does).
3. If it applies: default flip, `transport-conclusions.md` §2 rewritten with the corrected
   reason, and the WASM client checked for out-of-order delivery.

## Report

Per cell: arm, `D`, miss p95, mean, tail samples at p95, reader lateness. TSV under
`docs/measurements/r2/`.

## Stop conditions

The null cell's arms differing by more than 15 % (an instrumentation gap, not a loss effect);
fewer than 20 misses in a loss cell (dead cell).
