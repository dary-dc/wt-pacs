# What a reading session costs the server and the network

*Pre-registered 2026-11-24 by SESSION-COST-PROTOCOL (`claude/work-ledger:docs/queue-2026-11-24.md`), a session that
will run none of it. Nothing here is measured by this file: every number is **source** (quoted from the file or
standard named), **theory**, or **derived** (arithmetic on rows named, with their fixtures). SESSION-COST-RUN follows it
as written; a departure the host forces is an amendment in §9, dated, before any counted row.*

**The question.** The value statement (`README.md`) promises "the lowest server and network cost per reading session".
No row stood behind it (amendment 28 item 3.6). This file defines a reading session, predicts its server CPU, the
server's peak memory and its bytes on the wire per arm, and names the reference it is compared with. "Lowest" is
claimed after the run only against what the run measured; against the reference only as theory (§5).

## 1 · A reading session

One reader, one series, one tab, from the page's load to the last dwell. The motions are `asking`'s
(`claude/reviews-2026-11-28:docs/decisions/asking.md` §4: open, scroll, dwell, jump; "a type of vigorous drilling
strategy", its S6). For a series of *n* frames, in order:

1. **Open** at frame 0; the view fills as the product does.
2. **Drill**: three strokes from frame 1 to ⌊*n*/3⌋ and back to 0, one frame a step.
3. **Pass**: frame 1 to *n* − 1, one frame a step.
4. **Dwell** 3 s at *n* − 1, then **jump** to ⌊*n*/2⌋ and dwell 3 s, then jump to ⌊*n*/4⌋ and dwell 3 s.

A step is the viewer's own `ArrowRight` or `ArrowLeft` (`client/viewer/viewer.js`), pressed when the frame shown is
painted and no sooner than 100 ms after the last press: a reader no faster than 10 frames a second, never skipping a
slice (`asking` item 2). A jump sets the slider to its frame through its own `input` event (`asking` item 2b, a jump).
Steps per session: 165 on `dbts_a1`, 147 on `dbts_b1`, 208 on `dbts_c1`, 191 on `usb_cine` (*derived*).

The trace is an *assumption*: no reader's scroll log exists (`asking` §6). It is chosen to exercise the window, not to
be typical; a reader who never drills asks less on every arm.

## 2 · Arms

The product's viewer, the page view, `cubic-restart`, `decoders=2`, as the delivery comparison's §1
(`claude/delivery:docs/client/evidence/delivery-comparison.md`), the 256 MiB view bound as built (VIEW-MEMORY-BOUND,
PR 435, merged into `claude/unified`).

| arm | what the session loads | at each dwell |
| --- | --- | --- |
| **A** | the view, `<stem>-q8-g8[-cut].sbnd` | nothing |
| **A+C1** | as A | `l`: the exact frame on screen (C1's press) |
| **B** | the exact series only | nothing |
| **FIT** | the exact series, each frame first at the level that fits (§A2.2 of the comparison) | a zoom past the fit |

FIT is B on `dbts_a1`, `dbts_c1` and `usb_cine` (the fit is level 0 there, §A2.2), so those cells are a control:
predicted ×1.00 of B. FIT exists only once FIT-ARM-BUILD has merged into `claude/delivery`; until then the run has
three arms and says so. `usb_cine` runs B only: the view is not coded for it by `claude/delivery:lab/delivery/series.sh`.

## 3 · What a session asks (theory)

`claude/work-ledger:docs/queue/SESSION-COST-PROTOCOL/model.py` (commit `143ed5756`) simulates the code at
`claude/unified` `b059388b6` (`client/view/controller.js` `wantFrom` and `memoryWindow`, `client/view/store.js`'s
farthest-first eviction, `client/transport/downloader.js`'s whole groups) over the trace of §1, with a pipeline that
holds every step's misses before the next step. Inputs: the frame bytes of `claude/delivery:lab/delivery/inputs.json`.
*W* is 256 MiB over one decoded frame (2 bytes a sample above 8 bits): 56 on `dbts_a1` (all), **15 on `dbts_b1`**, 54
on `dbts_c1`, 64 on `usb_cine` (all). Output (`model-output.txt` beside it):

| volume | *n* | *W* | A: frames asked, MB | A+C1, MB | B: frames, MB | FIT, MB | the series once: view, exact |
| --- | --: | --: | --- | --: | --- | --: | --- |
| `dbts_a1` | 56 | 56 | 56, 4.64 | 8.21 | 56, 67.81 | = B | 4.64, 67.81 |
| `dbts_b1` | 50 | 15 | **764, 355.69** | 362.12 | 132, 284.63 | 81.82 | 23.21, 107.41 |
| `dbts_c1` | 69 | 54 | 198, 17.17 | 20.17 | 99, 100.66 | = B | 6.24, 70.66 |
| `usb_cine` | 64 | 64 | — | — | 64, 4.99 | = B | —, 4.99 |

**The view thrashes on `dbts_b1`.** With *W* = 15 and groups of 8, a miss asks its whole group and the window lets go
of frames of groups it will ask again; A asks the series 15 times over and costs more bytes than B. IMPROVE-1's
`WINDOW-WHOLE-GROUPS` row targets exactly this (`claude/work-ledger:docs/queue/IMPROVE-1/candidates.md`). The run pins
its `claude/unified` commit; if that row has merged by then, `model.py` is rerun on the pinned commit and this table
amended (§9) before any counted row. `dbts_c1`'s A asks 3× its series for the same cause, milder (*W* = 54 of 69).

The pipeline is an *assumption*: a slower decode leaves misses pending when the window moves on. The run records every
ask, so the count is checked directly, apart from its bytes.

## 4 · The predictions (derived)

Three quantities a session, each from rows named; every cell's prediction is a range.

* **Bytes on the wire**, server → client, the series servers' UDP flows in the relay's tally: MB asked × **1.037** for
  exact frames, × **1.04** for the view (wire ÷ payload on the 2026-11-23 delivery rows, CLEAN and CR, every arm:
  1.037 for B, 1.038–1.041 for A, *derived*). The page's own assets over TCP are counted apart: 0.53 MB for B, 1.23 MB
  for a view arm, once a session with a fresh profile (*derived*, the same rows).
* **Server CPU**: MB asked × **5.0–6.5 ms a MB**, both series servers' threads summed (the 2026-11-23 delivery rows'
  `serverTicks`, CLEAN medians: B 4.9–5.2 ms a MB, A 5.6–6.5, *derived*; `transport-arms`' WT-TS on `dbts_b1`, 5.7,
  *derived*). The other host's 2.0–3.1 ms a MB (`docs/transport/transport-conclusions.md` §4, *Many fills at once*,
  native clients) is not this host's and is not used. CR is predicted at ×1.05–1.7 CLEAN's CPU for equal bytes (the
  same rows' CR ÷ CLEAN medians, B 1.05–1.20, A 1.38–1.75).
* **Server peak memory**, resident over the warmed server: **1–5 MB, whatever the arm and the volume**. *Theory*: what
  the server holds a session is bounded by quinn's 10 MB send window, not by the series; the measured single paced
  session is 1 MB over warm, a concurrently filling one 3.7–4.8 MB (`transport-conclusions.md` §4, the other host),
  an idle one ~75 KB (`docs/adr/transport-idle-sessions.md`). A peak that grows with a session's bytes is a miss.

| volume | arm | MB on the wire | server CPU, s, CLEAN |
| --- | --- | --: | --- |
| `dbts_a1` | A | 4.83 | 0.023–0.030 |
| | A+C1 | 8.53 | 0.041–0.053 |
| | B, FIT | 70.32 | 0.34–0.44 |
| `dbts_b1` | A | 369.9 | 1.78–2.31 |
| | A+C1 | 376.6 | 1.81–2.35 |
| | B | 295.2 | 1.42–1.85 |
| | FIT | 84.9 | 0.41–0.53 |
| `dbts_c1` | A | 17.86 | 0.086–0.112 |
| | A+C1 | 20.98 | 0.10–0.13 |
| | B, FIT | 104.4 | 0.50–0.65 |
| `usb_cine` | B | 5.17 | 0.025–0.032 |

Bytes are predicted within ±3 % (the ask count's model, §3); CPU within the range; `serverTicks` is 10 ms a tick, so
CPU below 0.1 s is read from `schedstat` (§6), not ticks. **What it says** (*derived*): A is cheapest on `dbts_a1` and
`dbts_c1` by 5.9–15× in bytes and CPU; **on `dbts_b1` FIT is cheapest and A the dearest**, by the thrash of §3;
`usb_cine` costs one series of bytes; peak memory sets no arm apart.

## 5 · The reference: a DICOMweb fetch of the same frames (theory)

The reference is the standard's frame retrieve, not a server we run. PS3.18 2026e, §10.4.1.1.6: "Frame Pixel Data
/studies/{study}/series/{series}/instances/{instance}/frames/{frames}", and §10.4.3.3.6: "The payload for a Pixel Data
Resource (see Section 10.4.1.1.6) shall contain all the Pixel Data of the resource. Pixel Data in a multipart response
shall have a Content-Location Header Field that corresponds to the URI contained in the corresponding Element in the
Metadata." Its framing, §8.6.1.2: "Each part in a multipart payload shall start with a boundary string, followed by a
Content-Type Header Field with a single part Media Type (see Section 8.7.3), followed by other fields as specified in
Table 8.6.1-1." The HTJ2K transfer syntax is in its media types, Table 8.7.3-5's row "image/jphc 1.2.840.10008.1.2.4.201
High-Throughput JPEG 2000 Image Compression (Lossless Only)".

*Theory*: a viewer asking B's frames this way, with the same window, asks B's bytes plus a part's headers a frame
(a boundary, `Content-Type`, `Content-Location` with three UIDs: some 300 B, *assumption*), over HTTP/2 on TLS: wire
÷ payload 1.039 (`claude/transport-arms` H2-frame on `dbts_b1`, CLEAN, *derived*). **Its bytes are B's within 1 %; it
does not have the view, so A's and FIT's savings are the whole difference in bytes.** Its server CPU, if it served as
the lab's HTTP/2 path does, is 0.84 ms a MB of process time (H2-frame, 90 ms for 107.4 MB, against WT-TS's 615 ms on
the same rows, *derived*): **by process CPU at equal bytes, HTTP/2 costs about a seventh of WebTransport here.** Part
of TCP's send work runs in softirq, which a process's ticks do not count, so the run records the host's softirq
(§6); the seventh is an upper bound on the gap's favour to HTTP/2 until it does. Hence the claim the run can make:
"lowest bytes a session" where A or FIT ask fewer bytes than the series; "lowest server CPU" only where the bytes saved
outweigh WebTransport's CPU a MB, which §4 predicts on `dbts_a1` and `dbts_c1` for A (×5.9–15 fewer MB) and on `dbts_b1`
for FIT (×3.5), not for B.

## 6 · Rig, records, order

* **Rig**: `claude/delivery:lab/delivery/run.mjs` as the comparison's §2 and §A2.6 (one 4-core container, the
  relay's TUN in `unshare -rn`, its guard, the relay on core 0, the two series servers on core 1, the browser on 2–3),
  with one lever added, `--session`: after the load, the trace of §1 is driven by key presses; at each dwell the arm's
  action. One fresh browser profile a session, one session at a time, 10 s idle between.
* **Records, per session**, beside the comparison's §5: each series server's CPU from the sum over
  `/proc/<pid>/task/*/schedstat`'s first field (ns) and `utime + stime` ticks, before the load and after the last
  dwell; its `VmRSS` sampled every 50 ms from `/proc/<pid>/status`, the peak less the value before the load; the
  host's softirq per core (`/proc/stat`); the relay's bytes by flow; every ask (frame, form, bytes) and every step's
  paint time from the page's records; the trace's step count.
* **Forms**: CLEAN and CR of the comparison's §3. Bytes are predicted equal on both (±2 %); the link binds a session's
  time, not its cost, and the time is not a result here.
* **Order**: a Williams square over the arms (`lab/order.mjs`; four arms, a period of 4 rounds), volumes rotated by one
  each round; **8 rounds on CLEAN, 4 on CR**; `usb_cine` B three times on CLEAN, after the square, as a function check.
  About 150 sessions at ≤ 60 s each: two jobs, rows pushed as they land.
* **`VOID`**, kept with its reason: the relay's guard p99 over 1 ms; a browser process allowed outside cores 2–3; the
  series servers' core over 95 % busy (the host saturating: said, and nothing claimed for that cell). A frame that
  fails its check stops the run and is reported, never voided.
* **Mutants**, each run once before the counted rows and failing as named: the sampler on the relay's pid (CPU zero
  flagged); a trace that skips one step (step count ≠ §1's); the relay's tally dropped (bytes zero flagged).

## 7 · The rule, stated before any data

Each cell (form × volume × arm) is held when its median lies in its range of §4 (bytes ±3 %, CPU in range, peak RSS
1–5 MB) and the median ask count is within 3 % of §3's; else it is a miss, named with its measured value. A miss in the
ask count is the model's (§3's pipeline assumption), reported before any byte or CPU cell is read. "Lowest" is
written only for the cells where an arm's median is below every other measured arm's in that form and volume, and
against the reference only as §5's theory. A/A: the comparison's 2026-11-23 A and A′ medians matched in ticks on
every cell; no A/A arm here, and the spread over rounds is reported per cell.

## 8 · What the run cannot decide

Many sessions at once (one at a time here; `transport-conclusions.md` §4 is the concurrent evidence, the other host);
the cost on a phone's link beyond CR (bytes are link-independent by §4, time is not measured); a reader's real trace
(§1); a DICOMweb server measured (§5 is theory); the page assets once cached. How it serves the value statement: it is
the first row behind "the lowest server and network cost per reading session", and it says where that holds.

## 9 · Amendments

None yet.

## Fixtures and limits

Three timed DBT volumes of one dataset (`dbts_a1`, `dbts_b1`, `dbts_c1`, as `claude/delivery:lab/delivery/series.sh` codes them);
`usb_cine`, 64 frames, **lossy-sourced** (`docs/FIXTURES.md`): a function check, its bytes and CPU not results. One
4-core cloud host without a GPU, headless Chromium, software WebCodecs; a userspace relay, not a radio; one session at a
time. Every input above is from those rows and fixtures, the `transport-conclusions.md` §4 figures from another host.
Limits found: the thrash on `dbts_b1` by this file's model (§3), not yet by a row; HTTP/2's CPU a MB by
`claude/transport-arms`' CLEAN rows, process time only.
