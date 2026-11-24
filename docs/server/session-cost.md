# What a reading session costs the server and the network

*Pre-registered 2026-11-24 by SESSION-COST-PROTOCOL (`claude/work-ledger:docs/queue-2026-11-24.md`), a session that
will run none of it. Nothing here is measured by this file: every number is **source** (quoted from the file or
standard named), **theory**, **derived** (arithmetic on rows named, with their fixtures), or, in §3, frames counted
on the product's code under a stand-in harness. SESSION-COST-RUN follows it
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

## 3 · What a session asks (measured on the product's code, frames only)

The counts come from the product's own `Controller` and `downloader.js`, driven over §1's trace by
`client/view/window.test.mjs`'s harness (a stand-in transport and decoders, each step's frame here before the next):
`claude/work-ledger:docs/queue/SESSION-COST-PROTOCOL-FIX/` (scripts, raw output, README), which reproduces
`SESSION-COST-PROTOCOL-REVIEW`'s counts. `model.py` (`143ed5756`) is retired: its eviction breaks ties toward the later
frame and evicts once a step, where `store.js` breaks them toward the earlier and evicts at each `put` (PR 441's review,
B1). Inputs: the frame bytes of `claude/delivery:lab/delivery/inputs.json`. *W* is 256 MiB over one decoded frame
(2 bytes a sample above 8 bits): 56 on `dbts_a1` (all), **15 on `dbts_b1`**, 54 on `dbts_c1`, 64 on `usb_cine` (all).

**Two tables, both pre-registered.** The run takes the table of the `claude/unified` commit it pins: **T1** for
`b059388b6` or any commit without PR 446 (`claude/window-whole-groups`), **T2** for one with it. If the pinned commit's
`client/view/` or `client/transport/` differs from both, the harness is run on it and its table written in §9 before
any counted row; that is a mechanical rerun, not a new prediction.

A+C1 is A plus the exact frame at each of the three dwells (three asks). FIT is B's asks on level-1 pictures (the
prefix share 0.271 of `dbts_b1`'s exact bytes, RESLEVEL, `delivery-comparison.md` §A2.7, *source*) plus the rest of
each dwell frame on its zoom (three asks). **FIT's *W*** is not set by §A2.2: `memoryWindow` reads the series' full-frame
metadata, which gives 15; a store that counts the level-1 pictures it holds gives 63 ≥ 50, so the series is asked once.
FIT-ARM-BUILD sets which; the run records the store's window each session and takes the FIT row of that *W*.

**T1, `b059388b6`** (frames asked, MB asked):

| volume | *n* | A | A+C1 | B | FIT | the series once: view, exact |
| --- | --: | --- | --- | --- | --- | --- |
| `dbts_a1` | 56 | 56, 4.64 | 59, 8.21 | 56, 67.81 | = B | 4.64, 67.81 |
| `dbts_b1` | 50 | **796, 370.54** | 799, 376.97 | 132, 284.63 | *W* 15: 135, 81.82 · *W* 63: 53, 33.79 | 23.21, 107.41 |
| `dbts_c1` | 69 | 177, 15.40 | 180, 18.41 | 84, 87.12 | = B | 6.24, 70.66 |
| `usb_cine` | 64 | — | — | 64, 4.99 | = B | —, 4.99 |

**T2, PR 446 at `e8a52cfe4`**: as T1 but `dbts_b1` A **130, 60.61**, A+C1 133, 67.04; `dbts_c1` A **85, 7.74**, A+C1
88, 10.75. B and FIT do not change (groups of one).

**What they say.** On T1 the view thrashes on `dbts_b1`: with *W* = 15 and groups of 8 a miss asks its whole group and
the window lets go of frames of groups it asks again; A asks each frame 16 times on average and more bytes than B. With PR 446
A asks each 2.6 times. `dbts_c1`'s A asks 2.6× its series on T1,
1.2× on T2. `usb_cine`'s count is *theory* (*W* ≥ *n*: the series once, as the harness gives `dbts_a1`).

The harness's pipeline is instant: a slower decode leaves misses pending when the window moves on. The run records
every ask, so the count is checked directly, apart from its bytes.

## 4 · The predictions (derived)

Three quantities a session, each from rows named; every cell's prediction is a range.

* **Bytes on the wire**, server → client, the series servers' UDP flows in the relay's tally: MB asked × **1.037** for
  exact frames, × **1.04** for the view (wire ÷ payload on the 2026-11-23 delivery rows, CLEAN and CR, every arm:
  1.037 for B, 1.038–1.041 for A, *derived*). The page's own assets over TCP are counted apart: 0.53 MB for B, 1.23 MB
  for a view arm, once a session with a fresh profile (*derived*, the same rows). Client → server bytes (asks, ACKs,
  C1's presses) are recorded per flow and reported beside, not predicted.
* **Server CPU**, both series servers' threads summed: MB asked × the arm's rate, plus a per-session intercept and the
  hold. Rates from the 2026-11-23 delivery rows' `serverTicks`, CLEAN medians (*derived*): **exact frames 4.8–5.3 ms a
  MB** (B's 4.87–5.17), **view 5.5–6.6** (A's 5.60–6.46); A+C1 and FIT at those rates by form. The intercept: **0–10 ms**
  a session (A's rate falling from 6.46 on 4.64 MB to 5.60 on 23.2 MB is about 5 ms a fill, *derived*) plus the two
  held sessions at **0.05 ms a second each** (`docs/adr/transport-idle-sessions.md`, *source* there) over the session's
  length below. The other host's 2.0–3.1 ms a MB (`docs/transport/transport-conclusions.md` §4, native clients) is not
  this host's and is not used. CR is predicted at ×1.05–1.7 CLEAN's CPU (CR ÷ CLEAN medians, B 1.06–1.20, A 1.39–1.75).
* **Server peak memory**, `VmRSS`'s peak less its value before the load: **0–5 MB, whatever the arm and the volume**.
  *Theory*: what the server holds a session is bounded by quinn's 10 MB send window, not by the series; the measured
  single paced session is 1 MB over warm, a concurrently filling one 3.7–4.8 MB (`transport-conclusions.md` §4, the
  other host), an idle one ~75 KB (`transport-idle-sessions.md`). The floor is 0, not 1: one server pair serves the
  whole run (§6), so pages its allocator kept from an earlier session can absorb a later one. A peak that grows with
  a session's bytes is a miss.
* **A session's length** (*derived*, for the rig's budget, not a result): steps × 0.1 s + 9 s of dwell + wire bytes at
  the form's WT-TS goodput (CLEAN 86.8, CR 26.4 Mbit/s, `stacks.md` §6.1), up to one round trip (CLEAN 2 ms, CR 0.8 s)
  per ask round on top.

**T1** (`b059388b6`):

| volume | arm | MB on the wire | server CPU, s, CLEAN | length, s: CLEAN · CR |
| --- | --- | --: | --- | --- |
| `dbts_a1` | A | 4.83 | 0.028–0.043 | 26–28 · 27–33 |
| | A+C1 | 8.53 | 0.045–0.062 | 26–28 · 28–36 |
| | B, FIT | 70.32 | 0.33–0.37 | 32–34 · 47–92 |
| `dbts_b1` | A | 385.4 | 2.04–2.46 | 59–61 · 140–220 |
| | A+C1 | 392.0 | 2.08–2.50 | 60–62 · 142–225 |
| | B | 295.2 | 1.37–1.52 | 51–53 · 113–219 |
| | FIT, *W* 15 | 84.85 | 0.40–0.45 | 32–34 · 49–157 |
| | FIT, *W* 63 | 35.04 | 0.17–0.19 | 27–29 · 34–77 |
| `dbts_c1` | A | 16.02 | 0.088–0.115 | 31–33 · 35–53 |
| | A+C1 | 19.14 | 0.10–0.13 | 32–34 · 36–56 |
| | B, FIT | 90.34 | 0.42–0.48 | 38–40 · 57–124 |
| `usb_cine` | B | 5.17 | 0.027–0.040 | 29–31 · 30–32 |

**T2** (PR 446), the cells that differ:

| volume | arm | MB on the wire | server CPU, s, CLEAN | length, s: CLEAN · CR |
| --- | --- | --: | --- | --- |
| `dbts_b1` | A | 63.03 | 0.34–0.41 | 30–32 · 43–56 |
| | A+C1 | 69.70 | 0.37–0.45 | 30–32 · 45–61 |
| `dbts_c1` | A | 8.05 | 0.046–0.064 | 31–33 · 32–41 |
| | A+C1 | 11.17 | 0.060–0.080 | 31–33 · 33–44 |

Bytes are predicted within ±3 % of the table; CPU within the range; `serverTicks` is 10 ms a tick, so CPU below 0.1 s
is read from `schedstat` (§6), not ticks. **What each table says** (*derived*):

* **T1**: A is cheapest on `dbts_a1` (×14.6 fewer bytes than B) and `dbts_c1` (×5.6); on `dbts_b1` **FIT is cheapest
  at either *W*** (×3.5 at 15, ×8.4 at 63) and A and A+C1 the dearest, above B, by the thrash of §3.
* **T2**: A is cheapest on `dbts_a1` and `dbts_c1` (×11.2); on `dbts_b1` **FIT at *W* 63 is cheapest (35.0 MB), then A
  (63.0, ×4.7 under B); FIT at *W* 15 (84.9) comes after A**, so the `dbts_b1` order turns on FIT's *W*.
* On both, `usb_cine` costs one series of bytes; peak memory sets no arm apart.

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
does not have the view, so against it A's and FIT's savings are the whole difference in bytes.** Its server CPU, if it served as
the lab's HTTP/2 path does, is 0.84 ms a MB of process time (H2-frame, 90 ms for 107.4 MB, against WT-TS's 615 ms on
the same rows, *derived*): **by process CPU at equal bytes, HTTP/2 costs about a seventh of WebTransport here.** Part
of TCP's send work runs in softirq, which a process's ticks do not count, so the run records the host's softirq
(§6); the seventh is an upper bound on the gap's favour to HTTP/2 until it does. **Rendered frames, the standard's screen-sized retrieve.** PS3.18 2026e, Table 10.4.1-3: "Rendered Frames
/studies/{study}/series/{series}/instances/{instance}/frames/{frames}/rendered"; §10.4.1.1.3: "Its primary use case is
to provide user agents with a simple means to display medical images and related documents, without requiring deep
knowledge of DICOM data structures and encodings."; §8.3.5.1.3: "The "viewport" parameter specifies a rectangular region
of the source image(s) or video to be cropped, and a rectangular region corresponding to the size of the user agent's
viewport to which the cropped image or video should be scaled."; §8.3.5.1.4: "The "window" parameter controls the
windowing of the images or video"; Table 8.7.4-1 lists `image/jpeg` as the Single Frame Image default, and "When an
image/jpeg Media Type is returned, the image shall be encoded using the JPEG baseline lossy 8-bit Huffman encoded
non-hierarchical non-sequential process". *Theory*: a viewer asking each frame once at the fitted size (`dbts_a1` level 0,
`dbts_b1` level 1, `dbts_c1` level 0: 2.0–2.5 Mpx) as baseline JPEG at 0.5–1.5 bits a pixel (*assumption*, no row)
asks about 7–21 MB on `dbts_a1`, 7–20 on `dbts_b1`, 11–32 on `dbts_c1`: of the order of A's and FIT's bytes: above A's on
`dbts_a1`, overlapping it on `dbts_c1`, below every arm on `dbts_b1`. **It is not the view**: it is windowed on the server to 8 bits, so every window or level change is a
new ask, the client holds neither the full bit depth nor the exact frame, and the server decodes, scales and encodes
each frame, which no arm here does; its server CPU is not predicted (no row). So the run claims nothing against it.

Hence the claims the run can make, each **against the frame retrieve only**, never against rendered frames (§7):
"lowest bytes a session" where an arm asks fewer bytes than B's (the frame retrieve's within 1 %); "lowest server CPU"
only where the bytes saved outweigh WebTransport's CPU a MB, ×5.7–6.3 HTTP/2's for exact frames and ×6.5–7.9 for the
view (§4's rates over 0.84). By §4 that is `dbts_a1`'s A (×14.6) on both tables, `dbts_c1`'s A on T2 (×11.2, not T1's
×5.6), and `dbts_b1`'s FIT at *W* 63 (×8.4, not *W* 15's ×3.5); never B, nor `dbts_b1`'s A.

## 6 · Rig, records, order

* **Rig**: `claude/delivery:lab/delivery/run.mjs` as the comparison's §2 and §A2.6 (one 4-core container, the
  relay's TUN in `unshare -rn`, its guard, the relay on core 0, the two series servers on core 1, the browser on 2–3),
  with one lever added, `--session`: after the load, the trace of §1 is driven by key presses; at each dwell the arm's
  action; a session over **300 s** (the rig's `--fill-s` default) is `VOID`, named. One fresh browser profile a
  session, one session at a time, 10 s idle between.
* **Server lifetime**: one series-server pair for the whole run of a form, started before it and warmed by one
  uncounted session, `dbts_b1` B (the largest exact cell); every counted session's CPU and memory are deltas over its
  own before-the-load values.
* **Records, per session**, beside the comparison's §5: each series server's CPU from the sum over
  `/proc/<pid>/task/*/schedstat`'s first field (ns) and `utime + stime` ticks, before the load and after the last
  dwell; its `VmRSS` sampled every 50 ms from `/proc/<pid>/status`, the peak less the value before the load; the
  host's softirq per core (`/proc/stat`); the relay's bytes by flow; every ask (frame, form, bytes) and every step's
  paint time from the page's records; the trace's step count (§1's counts include its two jumps); the store's window *W*.
* **Forms**: CLEAN and CR of the comparison's §3. Bytes are predicted equal on both (±2 %); the link binds a session's
  time, not its cost, and the time is not a result here.
* **Order**: a Williams square over the arms (`lab/order.mjs` `order`), volumes rotated by one each round. With FIT,
  four arms, a period of 4 rounds: **8 rounds on CLEAN, 4 on CR**, 144 sessions. Without it (A, A+C1, B), three arms:
  `williams(3)` is its 3 rows and their mirrors, a period of **6 rounds**: **6 on CLEAN, 6 on CR**, 108 sessions.
  Then `usb_cine` B three times on CLEAN, as a function check. By §4's lengths (+10 s idle each): four arms about 75 min
  on CLEAN and 70–140 min on CR, three arms about 45 and 75–150 min; two jobs (CLEAN, CR), rows pushed as they land.
* **`VOID`**, kept with its reason: the relay's guard p99 over 1 ms; a browser process allowed outside cores 2–3; the
  series servers' core over 95 % busy (the host saturating: said, and nothing claimed for that cell). A frame that
  fails its check stops the run and is reported, never voided.
* **Mutants**, each run once before the counted rows and failing as named: the sampler on the relay's pid (CPU zero
  flagged); a trace that skips one step (step count ≠ §1's); the relay's tally dropped (bytes zero flagged).

## 7 · The rule, stated before any data

The table is T1 or T2 by the pinned commit (§3), and FIT's row is that of the *W* recorded. Each cell (form × volume
× arm) is held when its median lies in its range of §4 (bytes ±3 %, CPU in range, peak RSS 0–5 MB) and the median ask
count (frames asked, §3's table, A+C1 and FIT with their three dwell asks) is within 3 % of §3's; else it is a miss,
named with its measured value. A miss in the
ask count is the model's (§3's pipeline assumption), reported before any byte or CPU cell is read. "Lowest" is
written only for the cells where an arm's median is below every other measured arm's in that form and volume, and
against the reference only as §5's theory and only against the frame retrieve: no claim is made against rendered
frames. A/A: the comparison's 2026-11-23 A and A′ medians matched in ticks on
every cell; no A/A arm here, and the spread over rounds is reported per cell.

## 8 · What the run cannot decide

Many sessions at once (one at a time here; `transport-conclusions.md` §4 is the concurrent evidence, the other host);
the cost on a phone's link beyond CR (bytes are link-independent by §4, time is not measured); a reader's real trace
(§1); a DICOMweb server measured (§5 is theory); the page assets once cached. How it serves the value statement: it is
the first row behind "the lowest server and network cost per reading session", and it says where that holds.

## 9 · Amendments

**2026-11-24, SESSION-COST-PROTOCOL-FIX** (before any row; PR 441's §SESSION-COST-PROTOCOL-REVIEW). §3's counts
from the product's code, not `model.py` (B1); T1 and T2 both pre-registered with what each concludes (B2); FIT's *W*
stated as FIT-ARM-BUILD's and both rows predicted (B3); §5 names rendered frames with `viewport` and restricts every
claim to the frame retrieve (B4); per-arm CPU rates (m1), an intercept and the hold (m2), each cell's length, the
300 s limit and the job count (m3), one warmed server pair a form and the memory floor at 0 (m4), the three-arm
order (m5), ask counts for A+C1 and FIT and the jumps in §1's counts (m6), client → server bytes recorded (nit).
Corrected in place: §5's former "lowest server CPU … on `dbts_b1` for FIT (×3.5)", which fell under HTTP/2's ×6–8.

**2026-11-24, SESSION-COST-RUN** (before any counted row; departures the rig forces, none changing a prediction).

* **The run's tree.** `claude/session-cost-rig`: this branch at `b059388b6` + the protocol, with as files, no merge,
  `claude/delivery`'s `lab/delivery/` (at `854372707`, FIT-ARM-BUILD's), `claude/phone-run-2`'s `lab/devices/`,
  `lab/viewer/`, `client/viewer/head.js` and `server/dev-server.py` (the round page and its beacon, built on this tip),
  and `claude/delivery`'s window read-back in `client/paint/` (FIT's check, lab-only). `client/view/` and
  `client/transport/` are `b059388b6`'s byte for byte, so **T1** is the table (§3) and the harness is not rerun.
* **The lever.** `--session` drives §1's trace in the page (`lab/delivery/session-page.js`): each step a `keydown` of
  `ArrowRight` or `ArrowLeft` on the viewer's window, the next no sooner than 100 ms after it and only once `shown`
  names its frame; a jump sets `#slice` and fires its `input`; A+C1's dwell is the viewer's `l`; FIT's is A2.5's zoom
  (×2, the rest asked on the fill's session), the pose reset before the next jump. The trace starts at the fill's end
  (the round page's `finished`: the window filled). Asks are counted as the controller's `received` (every arrival,
  evicted or not) plus the exact asks at the dwells.
* **Server lifetime: one pair a session, not one a form** (§6). The rig starts the relay, both series servers and the
  page servers per load, in the relay's namespace, and each server serves one series; one pair for a form's three
  volumes and four series would need a server serving many series and a relay counting by session, neither of which
  the rig has. The 2026-11-23 rows that gave §4's rates and intercept ran the same way, a fresh pair a load, so the
  predictions stand. The warm-up session (`dbts_b1` B, uncounted) is kept, to warm the page cache. Each session's CPU
  and memory are taken from its pair's values before the page's load, after both servers have printed their banner.
* **The relay's guard VOIDs no session here** (§6's first `VOID` reason, *measured* on the smoke below). Every
  session that asks after an idle gap tripped it: A+C1 on `dbts_a1` (8 840 packets, p99 2.58 ms), B on `dbts_c1`
  (p99 1.64 ms), every `dbts_b1` arm (p99 1.98–4.02 ms); sessions that ask nothing after the fill did not (A and B on
  `dbts_a1`, p99 0.25–0.34 ms), and plain delivery loads on this host stayed under it (`dbts_b1` A and B, 0.44 and
  0.35 ms). *Hypothesis, not checked*: the userspace relay wakes late from idle, which a fill never meets and a
  session meets at every step. The guard protects a load's *time*, which is no result here (§6 *Forms*); the cost
  cells are bytes, CPU and memory. So a tripped guard is recorded (`guardLate`) and counted per cell beside its
  medians, and a byte cell outside ±3 % would show any retransmission it caused. The other `VOID` reasons stand.
* **FIT's *W* is 15** on `dbts_b1` (the store reads the series' full-frame metadata, `memoryWindow`; recorded each
  session), so FIT's row is §3's and §4's *W* 15.
* **The mutants** (§6), each run once on CLEAN `dbts_a1` A and flagged as named (`lab/delivery/rows/session-mutant-*.jsonl`
  on `claude/session-cost-rig`): the sampler on the relay's pid, "sampler: not a series server, or CPU zero"; a trace
  one step short (the pass's last step dropped), "trace: 164 steps, §1 says 165"; the relay's tally dropped, "tally:
  no bytes". A flag on a counted session stops the run.
* **The smoke** (`session-smoke.jsonl`, not counted): CLEAN `dbts_a1` A 56 asks, 4.83 MB, 0.036 s; `dbts_b1` A and A+C1
  *W* 15, FIT 132 + 3 asks, B 131.
* **`usb_cine`** is coded by `lab/av1/tools/ingest_coded.py --codec htj2k` beside `series.sh`'s output, which does not
  code it; B only, three sessions on CLEAN, as §6.

## Fixtures and limits

Three timed DBT volumes of one dataset (`dbts_a1`, `dbts_b1`, `dbts_c1`, as `claude/delivery:lab/delivery/series.sh` codes them);
`usb_cine`, 64 frames, **lossy-sourced** (`docs/FIXTURES.md`): a function check, its bytes and CPU not results. One
4-core cloud host without a GPU, headless Chromium, software WebCodecs; a userspace relay, not a radio; one session at a
time. Every input above is from those rows and fixtures, the `transport-conclusions.md` §4 figures from another host.
Limits found: the thrash on `dbts_b1` by the product's code under the stand-in harness (§3, PR 441's review), not yet
by a row; T2's cure by the same harness on PR 446; HTTP/2's CPU a MB by
`claude/transport-arms`' CLEAN rows, process time only.
