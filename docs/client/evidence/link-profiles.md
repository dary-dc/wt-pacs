# The links the client is measured on: profiles, measured or assumed

**The question:** what do the links a reader's phone actually uses look like (base round trip, bottleneck, queue,
loss and its kind), so that a lab link can stand in for them and each profile is labelled *measured* or *assumed*?
This file holds the first measured profile; the delivery comparison (`design.md` *Open*) sweeps from it toward
cellular and congested Wi-Fi.

*Folded 2026-11-14 from `claude/link-calibration:docs/transport/transport-conclusions.md` §1 *A home Wi-Fi link,
measured: the first phone run's servers* (`1f7a2f2c`, 2026-11-12, read from the servers' rows only, no cell run;
also on `claude/fill-split`, `claude/phone-rows`) and `claude/fill-split:docs/phone-rows/README.md` §The loss, read
from the servers and §Round trip and wire time (`28810f62`). The lab's assumed profiles are in
[`../../transport/transport-conclusions.md`](../../transport/transport-conclusions.md) §1 *Link profiles close to a phone*, on this branch.*

## Fixtures

The phone run of 2026-11-11 ([`phone-run-method.md`](phone-run-method.md)): one phone, one access point, one
evening, one series (`dbts_b1-q8-g8`, 23.2 MB), 11–12 counted fills per link and controller; each optimal-quality
server sampled its path every 250 ms and traced each congestion event (`claude/fill-split:lab/phone/link.py`, `losses.py` on that
branch). The rows are the server's view only. Cellular is not in it.

## The loss, read from the servers (measured; decides nothing)

| link | controller | sessions with loss | packets lost | congestion events |
| --- | --- | --- | --- | --- |
| tether | `cubic-restart` | 3 of 11 | 0.47 % (844 of 179 898) | 12, all congestive |
| tether | `bbr` | 0 of 12 | 0 | 0 |
| Wi-Fi | `cubic-restart` | 9 of 12 | 3.98 % (8 100 of 203 580) | 89, all congestive |
| Wi-Fi | `bbr` | 10 of 12 | 1.90–1.91 % (3 686 of 194 509) | 75, not classed (`bbr` keeps a queue) |

Every loss Cubic met had its round trip rise first (q = `rtt_latest − min_rtt` ≥ max(4 ms, min_rtt/8), the
Amendment's rule): on this Wi-Fi a packet is lost to a filling queue, not to the radio. The tether, which carries no
radio, lost too, under Cubic only: a queue on the USB path. Wi-Fi's jitter can read a random loss as congestive, so 0
random of 89 bounds the random share from above only as far as that bias allows. Exact sessions lost nothing but one
Wi-Fi `bbr` session (12 packets). Counts, not rates.

## The profile "home Wi-Fi, server wired" (measured, one link fitted once)

| link | controller | minimum RTT (the loss trace's), median [range] | smoothed RTT while sending, p50 / p90 | queue at a congestion event, p10 / p50 / p90 [max] | fastest 250 ms sent, median [range] |
| --- | --- | --- | --- | --- | --- |
| tether | `cubic-restart` | 0.72 ms [0.61–0.78], 3 sessions | 6.7 / 13.7 ms | 14 / 18 / 26 ms [26], 12 events | 267 Mbit/s [263–275] |
| tether | `bbr` | no event to read it from | 2.7 / 8.4 ms | no event | 262 Mbit/s [245–276] |
| Wi-Fi | `cubic-restart` | 2.0 ms [1.8–2.5], 9 sessions | 23.1 / 41.9 ms | 22 / 40 / 96 ms [151], 89 events | 179 Mbit/s [103–361] |
| Wi-Fi | `bbr` | 1.6 ms [1.5–2.0], 10 sessions | 16.2 / 32.3 ms | 11 / 21 / 36 ms [50], 75 events | 599 Mbit/s [136–636] |

* **Home Wi-Fi, server wired:** a base round trip of **~2 ms** (1.5–2.5 ms); a bottleneck of **at least ~600 Mbit/s**
  (`bbr`'s fastest 250 ms, a lower bound that includes the phone's receive path); a **tail-drop queue losing at
  22–96 ms** of standing delay (median 40), about 20 bandwidth-delay products; **no random loss**. In the relay's
  terms `--delay-ms 1 --rate-kbit 600000 --queue-ms 40`, no `--loss`. Jitter and the uplink are not in the rows.
* **The tether, the control:** ~0.7 ms (0.61–0.78 ms on the cable), ~265 Mbit/s for both controllers (the USB path's
  ceiling), a queue that loses at 14–26 ms, under Cubic only.
* **Against the lab's assumed *Wi-Fi home*** (30 ms, 15–40 Mbit/s, 0.5 % Gilbert–Elliott loss, a 300 ms FIFO): this
  link is 15× shorter, 15–40× faster, loses nothing at random and drops at an eighth of that queue. *Wi-Fi home*'s
  2.12× for BBR rests on the random loss it picked; this link has none.

**A retraction, corrected in place on its branch.** The phone README's first table gave a "min RTT by controller"
(tether 6.1 ms under Cubic against 2.2 ms under BBR; Wi-Fi 18.7 and 5.4 ms), which a minimum should not show. That
column is the smallest 250 ms sample of quinn's *smoothed* RTT, which stops moving when the fill stops, so it read each
controller's queue at the fill's end (Cubic's standing queue ~6 ms over a 0.7 ms path, BBR's paced one ~1.5 ms). The
path's minimum, from the loss trace, is the table above. The difference is the controllers' queues, which is real;
calling it the minimum was the error (`claude/link-calibration`, 2026-11-12).

## What can run the profile

The userspace relay was checked to 100 Mbit (`--tun`) and guarded at ~20 Mbit on its UDP plane
([`../../rig-limits.md`](../../rig-limits.md) §3); 600 Mbit/s is ~52 000 datagrams a second through one Python
thread, unverified, and a 2 ms base round trip sits on its 0.4 ms floor. **The relay cannot run it; `netem` can**
(`delay 1ms rate 600mbit`, a limit of ~2 000 packets for 40 ms) on a host with the cores; the cloud rig's 2 vCPUs were
never taken past ~58 Mbit. A scaled form (2 ms and 40 ms at 60 Mbit) keeps the queue's depth and loss mix but makes the
fill wire-bound, which on this phone it was not ([`fill-bound-on-phone.md`](fill-bound-on-phone.md)): it may decide a
controller's queue, never a fill time.

## Verdict, scope

One measured profile, labelled *measured*: home Wi-Fi with the server one switch away, from one phone, one access
point, one evening, the server's rows only. Every other profile the lab uses (cellular, congested Wi-Fi, random loss)
is *assumed* until a link like it is read the same way.

Raw rows: `claude/fill-split:docs/phone-rows/raw/` (path rows and loss traces per server).
