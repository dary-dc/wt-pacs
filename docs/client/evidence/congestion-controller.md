# Which congestion controller serves the client's fill and asks: BBR or `cubic-restart`

**The question:** for the optimal-quality pair's two series servers, does BBR make the client's fill and its asks
faster than the default `cubic-restart`, on the lab's lossy links and on a phone's real link? The controller is the
server's (transport, [`../../transport/transport-conclusions.md`](../../transport/transport-conclusions.md) §1); this
file holds what the client's own clocks read under each. **The owner keeps `cubic-restart` the default (2026-11-11
13:30)**; nothing here changes it.

*Folded 2026-11-14 from `claude/proposals:docs/lines/proposals.md` (`5b4c3341`) §P1, §Red team, §R2, §R4,
§Consolidated, and `claude/fill-split:docs/phone-rows/README.md` §The result with
`claude/fill-split:docs/reviews/phone-blind-read.md` §3, §5. Each protocol was pre-registered by one session and run by
another, with its amendment written before any run.*

## 1 · On the lab's links (measured, 2026-11-11)

**Fixtures:** `dbts_a1-q8-g8-cut`, `dbts_b1-q8-g8`, `dbts_c1-q8-g16-cut` and their exact series (three DBT volumes of
one dataset); one 4-core cloud host without a GPU, SwiftShader, headless Chromium, page view, TS client; the userspace
relay `lab/scripts/link_impair.py` (no `sch_netem` on the host), 30 ms each way, 20 Mbit/s, a 1 000-packet queue, in
three cells: clean, 1 % iid loss each direction, Gilbert–Elliott bursts (`--ge-p 0.07 --ge-r 14`); loss at the IP
layer, independent of the sender's rate; no neighbour, no congestive loss. No fill reached the host's ceiling; nothing
past 20 Mbit is claimed.

**Both servers on BBR against both on `cubic-restart`** (5 rounds; medians of 5; the fill's last frame, and `l` to
*Lossless* on frame 0 after 10 s of quiet):

| cell | fill, BBR ÷ Cubic | `l`, BBR ÷ Cubic |
| --- | --- | --- |
| clean | 0.84–0.99 | 0.89–0.91 |
| 1 % iid | **0.11–0.12** (e.g. `dbts_b1` 94.7 s → 10.0 s) | **0.16–0.29**; on `dbts_a1` 0.37–0.55 against an identical Cubic arm measured with the initial-window runs (corrected by the red team: five heavy-tailed runs a side carry about ±0.2) |
| bursts | 0.64–0.89 | 0.76–0.91 |

The pre-registered rule (≤ 0.7× fill and `l` at 1 %, ≤ 1.05× fill clean) was met. Clean, Cubic's slow start
overflowed the 1 000-packet queue (10–24 % of the optimal-quality server's datagrams); BBR's overflowed none. BBR held
a standing queue of 85–260 ms during the fill in every cell (Cubic ~1 ms under 1 % loss, 250–480 ms clean), and
overflowed 12 % of its datagrams on `dbts_c1` at 1 %.

**A jump 500 ms into the fill** (7 runs an arm, an A/A arm moving ≤ 2 %): BBR ÷ Cubic **0.08–0.09** at 1 % iid,
0.86–0.92 clean, 0.89–0.96 in bursts; no cell decode-bound. Under 1 % loss Cubic's queue is near empty and the asked
group waits behind the fill's slow transfer, not a queue; the predicted cost of BBR's queue appeared in no cell.

**A 32-packet (38 400 B) initial window on the exact server, under BBR**: `l` **1.09–1.26× slower** in all six cells
(21 runs a cell, A/A 2–3 %), against 0.85–0.95× clean predicted; the queue rose only 0.7–18 ms. *Withdrawn; the
cause is not explained* (quinn's BBR pacing of a larger first flight is the next thing to read, in code).

## 2 · On the phone's link (measured, 2026-11-11 evening)

**Fixtures:** one phone, one home link, `dbts_b1-q8-g8`, run commit `962226e8` ([`phone-run-method.md`](phone-run-method.md)).

| link | `bbr` ÷ `cubic-restart`, six octets | octets 1–4 (the 10-minute rule) |
| --- | --- | --- |
| tether | no difference shown at n = 11 (3 below 1, median 1.049) | not decided |
| Wi-Fi, server wired | **`cubic-restart` faster**: 9 of 10 above 1, median 1.084 (range 0.939–1.364) | not decided |

Every Wi-Fi loss Cubic met was congestive (89 of 89 events), and the link has no random loss
([`which-links-a-phone-meets.md`](which-links-a-phone-meets.md)): the 1 % iid cell above, where BBR's gain lives, is not this link. Both of
the run's correctness failures were under `bbr` (loads 6 and 13, the latter a frozen page,
[`hidden-page-decode.md`](hidden-page-decode.md)). By the Amendment, "a `bbr` load failing where `cubic-restart` does
not withdraws `bbr` from what the next runs try"; whether these two are "a `bbr` load failing" in the rule's sense is
the owner's reading. *Not pre-registered:* the fill's rest (outside the decode) is larger under `bbr` on both links.

## Verdict, scope

BBR's claim stands **for random loss only**, on a userspace relay with loss both ways, three DBT volumes, one host:
fill 0.11–0.12×, a jump in the fill 0.08–0.09×, `l` 0.16–0.55× of Cubic's at 1 % iid. On the one real link measured
(home Wi-Fi, congestive loss only) `cubic-restart` was faster by the six-octet reading and nothing is decided by the
10-minute reading. The default stays `cubic-restart` (the owner). *Decides:* a congestive-loss cell in the lab, a
cellular link read as `which-links-a-phone-meets.md` reads Wi-Fi, and the next phone round's controller arm; and the owner's
reading of the two `bbr` failures.

Raw rows: `claude/proposals:lab/proposals/rows/` (`p1.jsonl`, `r2.jsonl`, `r4.jsonl`); the phone's
`claude/fill-split:docs/phone-rows/raw/`.
