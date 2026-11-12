# The first phone run, read blind

*Row PHONE-BLIND-READ, 2026-11-12. A session that wrote none of the protocol and ran none of the loads. §1–§6 were
written from `docs/phone-rows/raw/` (at `538a7ad4`) and `docs/devices.md` §7 with its **Amendment**, **Second
amendment** and **Note** (`claude/phone-protocol` `ecd31836`) alone, before `docs/phone-rows/README.md` or
`lab/phone/*.py` were opened; §7 compares them. The decisions are the owner's.*

Fixtures and their limits: one phone, one Chrome, one home link at one hour; one timed series, `dbts_b1-q8-g8`
(50 frames, its exact pair `dbts_b1`), plus two eye-check loads of `dbts_a1-q8-g8-cut`; three DBT volumes of one
dataset exist and one is timed here; no ultrasound cine; software decode only; no cellular, no neighbour flow.

How it was read: loads are the beacon's records grouped by `load` id, `step` + 1 being the sheet's load number
(`blocks.log` says "load 6 … step 5"); the three ids in `excluded-ids.txt` are left out. Server sessions are matched
to loads by start time (session close − its path rows' span, against the beacon's `fillFrom`, within 0.3 s, and the
interrupted load 9's two within 0.7 s), and each loss-trace `conn` is its container's path `session_id` (the event counts agree session
by session). The counters' first column is read as transmit bytes (it grows by the series' size on the load's link).

## 1. What ran against what was registered

* **Schedule.** Four warm-ups (`view=page` at each of the four origins), then steps 4–51: every kept step is the arm
  and link the Second amendment's octets name (tether rows 1 2 3 4 1 2, Wi-Fi rows 3 4 1 2 3 4, tether first in odd
  octets). No step is out of order.
* **Missing:** load 7 (octet 1, tether, arm B), no beacon record kept; `blocks.log` says the tether's address
  changed. **Excluded by id:** a rerun of load 6, a rerun of load 8 and an interrupted load 9 (no `load` record),
  each before the kept load at its step. The interrupted load 9 still drew a full fill from `srv-4443` (16 270
  packets in 6 s) and a handshake from `srv-4444`.
* **The 15 s gap** held from load 14 on (15.2–15.7 s from the last *Optimal quality* to the next fill's start, which
  includes the navigation). It did not hold before load 9 (170 s), before load 11 (148 s) and before load 12
  (1 237 s). Load 10's page logged one more *Optimal quality* label at 22:31:27, two minutes after its verdict.
* **The runner's presses** fell after the fill's end mark in every load that has them; *Lossless* came 160–904 ms
  after the first press (median 227 ms), and *Optimal quality* within 10 s of the second. No timing rule was broken.
* **The 10-minute rule fired.** Octet 1 ran from 21:13:47 (load 5's fill) to 22:52:51 (load 12's verdict), 99
  minutes, most of it the stop after load 6 and the gaps above. The Second amendment: "If octet 1 takes more than 10
  minutes, the run stops after octet 4 … The time saved is not spent on more octets in this run." Octets 5 and 6
  (loads 37–52) ran. The rule names no exception for time spent stopped after a failure. Both readings are in §3;
  which one stands is the owner's call.
* **Servers:** all four `transport=congestion=` lines name their arm; all four read paths agree
  (`read_fast_path=preadv2`, `read_ring=refused`), as the Note predicted; all are `telemetry=compile-time`.
* **Not in the raw rows,** so not checked here: the run commit and each image's revision label (`blocks.log`'s
  first line ends at "run commit" with no hash), `ip route get`, the memlock limit used, and the eye's verdicts.
* **Links did not cross.** In the four warm-ups the other device sent 0.00–0.03 % of the load's bytes (the rule:
  under 1 %). In counted loads the wired device's transmit stayed under 1 % of a tether load's bytes except load 18
  (0.64 MB, 2.5 %). Its *receive* grew 0.5–5.2 MB during eight tether loads (loads 23–52): traffic into the laptop on
  the wired link, not the series', and not checked by any rule.

## 2. Correctness, per load (§7's rule, from the beacon)

| link | arm | registered | passed | failed | missing |
| --- | --- | --- | --- | --- | --- |
| tether | A page·cubic-restart | 6 | 6 | | |
| tether | B worker·cubic-restart | 6 | 5 | | load 7 |
| tether | C worker·bbr | 6 | 6 | | |
| tether | D page·bbr | 6 | 6 | | |
| Wi-Fi | A page·cubic-restart | 6 | 6 | | |
| Wi-Fi | B worker·cubic-restart | 6 | 6 | | |
| Wi-Fi | C worker·bbr | 6 | 5 | load 6 | |
| Wi-Fi | D page·bbr | 6 | 5 | load 13 | |

Every passing load received 50 of 50 frames, all `av1-webcodecs`, no error, labels *Optimal quality* → *fetching
lossless…* → *Lossless* → *Optimal quality*.

* **Load 6** (Wi-Fi, C): 50 of 50 received in 9.7 s, no error, but no press and no verdict follow, and the label
  never left *Optimal quality*: a fail by the label rule. `srv-4443`: 17 549 sent, 1 255 lost (7.2 %), 12 events, all
  in the session's first second; `srv-4444` (its exact server): 10 packets, a handshake only. The beacon cannot
  say whether the press was made; `blocks.log` says the page showed *Lossless check failed*.
* **Load 13** (Wi-Fi, D): 29 of 50 received, 21 errors "frame k: frame j of its group did not decode", frame 0
  decoded in 18.1 s. Server side, no loss: `srv-4443` closed the session after 1.0 s (11 492 sent, "write frame:
  connection lost: closed") and `srv-4444` after 0.75 s (10 packets). A further `srv-4443` session started about
  22:53:26 (load 13's first label is at 22:53:26.2), sent 6 150 packets, lost none and timed out at 23:03:56; no
  beacon record matches it. Why the client dropped both sessions after a second is not in the raw rows.

**Verdicts by §7 as amended.** Tether: no failure, one load missing. Wi-Fi: two failures, both `bbr`, one in each
view. The worker meets the page's bar on both links (each view failed once, both under `bbr`). The `bbr` arm failed
twice on Wi-Fi where `cubic-restart` failed none: by the Amendment, "a `bbr` load failing where `cubic-restart` does
not withdraws `bbr` from what the next runs try." That rule fires on these rows; whether a failure caused by the
client (load 13) or with its cause unread (load 6) is "a `bbr` load failing" in the rule's sense is the owner's
reading, since the rule does not say.

## 3. The fill (Part B: the beacon's `fillMs`, ratios within each quad)

Ratios out: load 7 (tether B/A, C/B), load 6 (Wi-Fi C/D, C/B) and load 13 (Wi-Fi C/D, D/A).

**All six octets, as run:**

| link | comparison | n | below 1 | median | range | under the other factor (medians) | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| tether | worker / page | 11 | 6 | 0.967 | 0.840–1.231 | cubic-restart 0.960 (5), bbr 1.016 (6) | **depends on the controller** |
| tether | bbr / cubic-restart | 11 | 3 | 1.049 | 0.842–1.229 | worker 1.049 (5), page 1.050 (6) | no difference shown at n = 11 |
| Wi-Fi | worker / page | 10 | 3 | 1.036 | 0.808–5.642 | cubic-restart 1.030 (6), bbr 1.087 (4) | no difference shown at n = 10 |
| Wi-Fi | bbr / cubic-restart | 10 | 1 | 1.084 | 0.939–1.364 | worker 1.081 (5), page 1.086 (5) | **cubic-restart faster** (9 of 10 above 1) |

The Wi-Fi controller verdict meets the mirror rule whether its median bound is read as 1/0.95 = 1.053 or as 1.05.
The "depends on" rule is written for six ratios per level; it was applied here to five and six.

**Octets 1–4 only, as the 10-minute rule reads:** tether 7 ratios each, Wi-Fi 6: under 8 left, so **not decided**
for every comparison. Tether worker / page still has medians on opposite sides of 1 (0.938 cubic-restart, 1.065
bbr).

**Reported, not deciding.** Arm medians (ms, six octets): tether A 2 843, B 2 872, C 2 910, D 2 680; Wi-Fi A 2 587,
B 2 618, C 2 750, D 2 683. The status line's `fill` read 23–300 ms above the beacon's in every load, as the Second
amendment predicts. Frame 1's decode: 148–437 ms in passing loads, 1 335 ms in load 10.

**Load 10 is the one outlier and enters one ratio** (Wi-Fi B/A, 5.642): a 16.5 s fill whose wire took about 1.5 s
(path rows) while its frames' median decode was 872 ms against 124–179 ms in the other passing loads. Load 6 is the
same shape: wire done in about 1 s, median decode 524 ms, fill 9.7 s. Both are worker loads on Wi-Fi in octet 1; the
raw rows do not say what slowed the phone's decoding. Neither changes a verdict: without load 10, Wi-Fi worker /
page is 9 ratios, 3 below 1.

## 4. The loss reading (decides nothing)

Per link and controller, counted optimal-quality sessions (failed loads in, excluded ids out):

| link | controller | sessions | with loss | sent | lost | events | classed (cubic-restart only) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| tether | cubic-restart | 11 | 3 (loads 5, 18, 50) | 179 898 | 844 (0.47 %) | 12 | 12 congestive, 0 random |
| tether | bbr | 12 | 0 | 195 513 | 0 | 0 | counted, not classed |
| Wi-Fi | cubic-restart | 12 | 9 | 203 580 | 8 100 (3.98 %) | 89 | 89 congestive, 0 random |
| Wi-Fi | bbr | 12 | 10 | 194 509 | 3 686 (1.90 %) | 75 | counted, not classed |

Exact sessions lost nothing except one Wi-Fi `bbr` session (load 31, 12 packets, 3 events). The tether, the run's
control, lost packets under `cubic-restart` in 3 of 11 sessions, all with a queue first; under `bbr`, none in 12 (by
the rule of three, under 25 % a session at 95 %). The q* rule is the Amendment's (`q = rtt_latest − min_rtt` against
`max(4 ms, min_rtt/8)`); Wi-Fi's jitter can read a random loss as congestive, so 0 random of 89 bounds the random
share from above only as far as that bias allows.

The sessions' last `min_rtt` on the tether: median 6.1 ms in `cubic-restart`'s fills, 2.2 ms in `bbr`'s, 1.7 ms and
1.4 ms in the two exact servers' sessions on the same cable.

**Wire time, the stand-in** (first to last 250 ms path row in which `sent_packets` grew by more than 50, plus one
row; labelled, never deciding): median 0.75 s tether and 0.50 s Wi-Fi under `cubic-restart`, 1.00 s and 0.75 s under
`bbr`, against beacon fills of 2.6–2.9 s. Most of a fill on this phone is not the wire.

## 5. What the controller verdict can change (the Amendment's rule)

`cubic-restart` faster on Wi-Fi, with losses read in the `cubic-restart` sessions all congestive: "this link's
evidence for the default". No difference on the tether. And the `bbr` failures above, if the owner reads them as the
rule's.

## 6. What these rows cannot show

The prod-like check (rootless publish) was not run: no row exists. Nothing about the demo commit beyond the run
commit, which the raw rows do not name. No eye verdict is in the raw rows. One phone and one home link at one hour;
the Wi-Fi arm is one radio hop to a server one switch away.

## 7. Against the run session's reading (`docs/phone-rows/README.md`)

*Written after §1–§6 were pushed.*
