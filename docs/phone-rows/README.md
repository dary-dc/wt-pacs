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
  asked of it. Load 13 (Wi-Fi, `bbr`, page): 29 of 50 frames, three keyframes decoded in about 18 s and the frames of
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

| link | controller | min RTT, median | RTT while filling, p50 / p90 | wire time, median |
| --- | --- | --- | --- | --- |
| tether | `cubic-restart` | 6.1 ms | 6.7 / 15.6 ms | 0.75 s |
| tether | `bbr` | 2.2 ms | 2.2 / 2.9 ms | 1.00 s |
| Wi-Fi | `cubic-restart` | 18.7 ms | 23.1 / 41.0 ms | 0.50 s |
| Wi-Fi | `bbr` | 5.4 ms | 18.8 / 33.4 ms | 0.75 s |

Two things this table raises and does not explain: the wire time is a fifth to a third of the fill (2.4–3.3 s), so
most of a fill is spent on the phone, not on the link; and the same link's minimum RTT differs by controller
(6.1 ms against 2.2 ms on the cable), which a minimum should not. Both are open (FILL-SPLIT, LINK-CALIBRATION).

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
```

Both scripts are read-only over `raw/` and have no test of their own yet.
