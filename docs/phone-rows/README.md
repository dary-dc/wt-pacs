# The phone run of 2026-11-11

`docs/devices.md` §7 with its Amendment, Second amendment and the Note to it (`claude/phone-protocol` `ecd31836`),
run once on run commit `962226e8`: one phone (Galaxy S23, Android 16, Chrome 157), one laptop (Fedora, no root), the
laptop wired to a home router, the phone on that router's Wi-Fi and on USB tethering at once. Series `dbts_b1-q8-g8`
(50 frames, 23,208,296 bytes) and its exact series. Raw rows in [`raw/`](raw/); the readings below come from
[`../../lab/phone/rows.py`](../../lab/phone/rows.py) and [`../../lab/phone/losses.py`](../../lab/phone/losses.py)
(Reproduce). *Not blind-read yet* (PHONE-BLIND-READ); the decisions are the owner's, after it.

## The result, by the pre-registered rules

| reading | tether | Wi-Fi (server wired, phone on Wi-Fi) |
| --- | --- | --- |
| correctness | 23 counted loads, all passed; 1 missing | 24 counted loads, 22 passed, **2 failed, both `bbr`** |
| worker / page | **depends on the controller** (medians 0.960 under `cubic-restart`, 1.016 under `bbr`) | no difference shown at n = 10 (median 1.036) |
| `bbr` / `cubic-restart` | no difference shown at n = 11 (3 below 1, median 1.049) | **`cubic-restart` faster**: 9 of 10 above 1, median 1.084 |

* **The failures.** Load 6 (Wi-Fi, `bbr`, worker): the fill took 9.7 s with 7 % of the server's packets lost, then
  *Lossless check failed*: the exact series' session carried its handshake only (10 packets) and no frame was ever
  asked of it. *Added (FILL-SPLIT, 2026-11-12):* the 9.7 s was the phone's decode (524 ms a frame, four times the
  run's median), not the loss: the server's wire time was 0.75 s, as in the fast loads. Load 13 (Wi-Fi, `bbr`, page): 29 of 50 frames, three keyframes decoded in about 18 s and the frames of
  their groups refused; the server lost nothing. The owner was in the phone's Settings at about that time, at this
  session's request, so the page was likely hidden; the beacon does not record visibility, so this is not shown.
  By §7's Amendment a failure in one controller's loads alone is that controller's, and withdraws it from the next
  runs: that reading, and whether load 13 is the controller's or the interruption's, is the owner's after the blind
  read.
* **What the speed verdicts can change** (the Amendment): `cubic-restart` faster on Wi-Fi is this link's evidence for
  the default; nothing changes from one run.

## The loss, read from the servers (decides nothing)

| link | controller | sessions with loss | packets lost | congestion events |
| --- | --- | --- | --- | --- |
| tether | `cubic-restart` | 3 of 11 | 0.47 % | 12, all congestive |
| tether | `bbr` | 0 of 12 | 0 | 0 |
| Wi-Fi | `cubic-restart` | 9 of 12 | 3.98 % | 89, all congestive |
| Wi-Fi | `bbr` | 10 of 12 | 1.91 % | 75, not classed (`bbr` keeps a queue) |

Every loss Cubic met had its round trip rise first (q ≥ max(4 ms, min_rtt/8)): on this Wi-Fi a packet is lost to a
filling queue, not to the radio. The tether, which carries no radio, lost too, under Cubic only: a queue on the USB
path. Counts, not rates (Amendment): one access point, one evening.

**Round trip and wire time** (path rows every 250 ms, reported, not deciding; the wire time counts the rows in which
the server sent, so it is coarse by 250 ms):

| link | controller | min RTT, median (*corrected below*) | RTT while filling, p50 / p90 | wire time, median |
| --- | --- | --- | --- | --- |
| tether | `cubic-restart` | 6.1 ms | 6.7 / 15.6 ms | 0.75 s |
| tether | `bbr` | 2.2 ms | 2.2 / 2.9 ms | 1.00 s |
| Wi-Fi | `cubic-restart` | 18.7 ms | 23.1 / 41.0 ms | 0.50 s |
| Wi-Fi | `bbr` | 5.4 ms | 18.8 / 33.4 ms | 0.75 s |

Two things this table raises and does not explain: the wire time is a fifth to a third of the fill (2.4–3.3 s), so
most of a fill is spent on the phone, not on the link; and the same link's minimum RTT differs by controller
(6.1 ms against 2.2 ms on the cable), which a minimum should not. *Corrected (LINK-CALIBRATION, 2026-11-12):* the
column is the smallest 250 ms sample of quinn's smoothed RTT, which freezes when the fill stops, so it reads each
controller's queue at the fill's end; the path's minimum, from the loss trace, is 0.61–0.78 ms on the cable and
1.5–2.5 ms on Wi-Fi (`docs/transport/transport-conclusions.md` §1 *A home Wi-Fi link, measured*). The wire time is
explained below (*What bounds a fill*): the fill is bound by the phone's decode.

## What bounds a fill (FILL-SPLIT, 2026-11-12; reported, decides nothing)

[`../../lab/phone/fill.py`](../../lab/phone/fill.py) splits each counted load's fill (the dial to the last frame stored,
§7's Second amendment) into the server's wire time (path rows, from the session's start) and the **decode floor**: the
beacon's per-frame decode times (`decodeStart` to `decodeEnd` in the decoder worker, after its queue) summed and
shared over the run commit's three decoders (`client/transport/downloader.js`, `min(3, hardwareConcurrency)`; the
beacon does not record the core count, but every load's frames arrive in three interleaved groups, 0, 8, 16, …). Each
decoder takes its frames one at a time, so the busiest of the three spent at least the floor decoding, inside the fill.

| link | controller | loads | fill | wire time | decode floor | rest (fill − floor) | floor / fill | a frame's decode |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tether | `cubic-restart` | 11 | 2.87 s | 0.75 s | 2.45 s | 0.25 s | 0.91 | 135 ms |
| tether | `bbr` | 12 | 2.79 s | 1.00 s | 2.42 s | 0.32 s | 0.89 | 135 ms |
| Wi-Fi | `cubic-restart` | 12 | 2.62 s | 0.50 s | 2.35 s | 0.22 s | 0.91 | 133 ms |
| Wi-Fi | `bbr` | 11 | 2.73 s | 0.75 s | 2.38 s | 0.35 s | 0.89 | 134 ms |

Medians over the loads with a fill (load 13 has none). Per load the floor is 0.76–0.94 of the fill.

* **The fill is bound by the phone's decode.** At least 76 % of every fill, and about 90 % of the typical one, is the
  busiest decoder decoding; the server is done sending within the first second, and the decode goes on for 1.5 s
  or more after. A frame's decode is 133–135 ms on both links and under both controllers, as a phone-side cost should be.
* **The rest**, 0.2–0.35 s, holds the dial, the first frame's arrival, decoders left idle while the others finish, and
  the last frame's paint and store; the beacon has no per-frame arrival times to split it further.
* **The slow loads are slow decodes.** Load 6 (9.7 s, 524 ms a frame) and load 10 (16.5 s, 872 ms a frame, passed) had
  wire times of 0.75 and 1.5 s; load 13's first keyframe took 17.9 s, the hidden page (HIDDEN-PAGE-DECODE).
* **Not pre-registered:** the rest is larger under `bbr` on both links (0.32 against 0.25 s; 0.35 against 0.22 s), as
  is its wire time; the decode floor is not. If it holds, the controller's effect on the fill is in the start, not
  the bulk. One run; it decides nothing.
* **Where the phone saturates is not shown.** The decode is WebCodecs asked for `prefer-software`, a hint the user
  agent may ignore (`../av1/payload-format.md`, WebCodecs §7.9); which decoder Chrome ran is not recorded. The per-frame
  times were taken with three decoders running at once, so they hold their contention: whether one decoder alone is
  faster, or a fourth would decode more, the run cannot say (it varied neither). What it shows: at three decoders the
  phone decodes this series at about 21 frames a second, and a faster link cannot shorten its fill by more than the
  rest.

Fixtures and limits: one phone (Chrome 157), one series (`dbts_b1-q8-g8`, 50 frames of ~460 KB), one evening;
the run commit `962226e8`, not the demo commit.

## The run's checks

* **Each load on its own link.** Around each of the four warm-ups the other device's counter grew by under 0.01 % of
  the series' bytes (`raw/counters.log`, every 0.5 s on the laptop).
* **One build.** The image's revision label named the run commit; `lab/phone/read-path.sh` gave all four servers
  `read_fast_path=preadv2`, `read_ring=refused` (SELinux Enforcing), as README step 8 predicts.
* **Eye check** at the run commit (runner, tether, `cubic-restart`, not counted): page and worker each 56 of 56 frames
  through `av1-webcodecs`, *Lossless* in 0.10 and 0.08 s; the owner: no difference seen, a brief look. The owner did
  not watch the first octet.

## Where the run departed from the protocol

* **Load 7 is missing**: the phone's USB re-enumerated when USB debugging was toggled (at this session's request), the
  tether came back on another address, and the plan's origins named the old one.
* **Loads 6 and 8 ran a second time** (a reload of the failed page; a restart at load 8), and **load 9 has an
  interrupted first attempt**: all three left out by load id (`raw/excluded-ids.txt`); the first, failed, load 6
  stands. The `bbr` server has one session no load opened (630 s, part of a fill, after load 13): left out
  (`--orphan 4443:10`).
* **The gap was not always 15 s**: the page's timer stops while the screen sleeps; load 12 began about 20 minutes
  after load 11.
* **The owner touched the phone during counted loads** (Settings, around load 13; restarts). Chrome had 53 tabs
  open. adb stopped for every counted load.
* **The prod-like check was not run**: which network mode production uses is open, and host networking is proposed
  (HOSTNET-THEORY).

## What the product showed

1. A **lossless** press that fails is not retried: on a lossy link the reader is left on *Lossless check failed*
   (load 6).
2. A fill whose page goes to the background loses its decoder and does not recover the groups it was decoding
   (load 13).
3. The runner is not hands-off: it needs a start tap and three pauses' taps, and a sleeping screen stops it.

## Reproduce

```bash
X=$(cat docs/phone-rows/raw/excluded-ids.txt)
python3 lab/phone/rows.py docs/phone-rows/raw dbts_b1-q8-g8 --exclude $X
python3 lab/phone/losses.py docs/phone-rows/raw dbts_b1-q8-g8 --exclude $X --orphan 4443:10
python3 lab/phone/link.py docs/phone-rows/raw dbts_b1-q8-g8 --exclude $X --orphan 4443:10
python3 lab/phone/fill.py docs/phone-rows/raw dbts_b1-q8-g8 --exclude $X --orphan 4443:10
```

All four are read-only over `raw/`; `link.py` and `fill.py` have tests (`link_test.py`, `fill_test.py`), the other two none yet. [`run-env.sh`](run-env.sh) is the shell
functions the run was served with (the Second amendment's, memlock 8 MiB per its Note, `--beacon`), sourced with
`RUN=target/phone-run` in both terminals.
