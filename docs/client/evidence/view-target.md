# Which view is the target: the page or the view worker, on a phone

**The question:** does the view worker (frames held and painted off the page's thread) fill faster than the page
view on a phone, and does it meet the page's correctness bar? The design and the cloud results are in
[`view-worker-design.md`](view-worker-design.md), [`page-out-of-pixel-path.md`](page-out-of-pixel-path.md) and
[`view-worker-start.md`](view-worker-start.md); this file holds the phone's answer.

*Folded 2026-11-14 from `claude/fill-split:docs/phone-rows/README.md` §The result (`28810f62`; also `claude/phone-rows`
`5c54f446`), `claude/fill-split:docs/reviews/phone-blind-read.md` §2, §3, §7 and
`claude/direction:docs/lines/client.md` §4 item 3. The method: [`phone-run-method.md`](phone-run-method.md).*

## Protocol

`devices.md` §7 with its Amendment and Second amendment (pre-registered 2026-11-11 by a session that ran none of it):
per link, six quads of arms A page·`cubic-restart`, B worker·`cubic-restart`, C worker·`bbr`, D page·`bbr`; the
worker / page ratio taken within each quad. *Worker faster*: at least ten of twelve ratios below 1 (the threshold
follows the ratios left) and the median ≤ 0.95; *page faster* the mirror; otherwise *no difference shown*. *Depends on
the controller*: the medians under each controller on opposite sides of 1. **Theory** (§7): both arms run the same
downloader, decoders and WebCodecs route; on a phone the page's thread is also input and layout, so the worker should
not be slower; whether it is faster nothing measured said (*assumption, no band*).

## Results

**Fixtures:** one Galaxy S23 (Chrome 157), one home link at one hour, `dbts_b1-q8-g8` (50 frames, 23.2 MB), run
commit `962226e8`, which differs from the demo commit `157b7109` in 20 files on the fill's path; software decode
(the product asks `prefer-software`). Where the phone saturates is not shown ([`fill-bound-on-phone.md`](fill-bound-on-phone.md)).

**Correctness.** Each view failed once, both under `bbr` on Wi-Fi (load 6 worker, load 13 page); none on the tether.
The worker meets the page's bar on both links. In the cloud both views pass every correctness check (40 of 40 demo
checks, page and worker interleaved, on the demo commit).

**Fill, worker / page** (the beacon's fill, ratios within each quad):

| link | n | below 1 | median | range | by controller (medians) | all six octets | octets 1–4 (the 10-minute rule) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| tether | 11 | 6 | 0.967 | 0.840–1.231 | `cubic-restart` 0.960 (5), `bbr` 1.016 (6) | depends on the controller | **not decided** (7 ratios; medians still 0.938 and 1.065) |
| Wi-Fi | 10 | 3 | 1.036 | 0.808–5.642 | `cubic-restart` 1.030 (6), `bbr` 1.087 (4) | no difference shown at n = 10 | **not decided** (6 ratios) |

Load 10 (worker, Wi-Fi, a 16.5 s fill whose decode ran 872 ms a frame) enters one ratio, 5.642; without it Wi-Fi is 9
ratios, 3 below 1, and no verdict changes. The "depends on" rule is written for six ratios per level and was applied
to five and six. Arm medians (ms): tether A 2 843, B 2 872, C 2 910, D 2 680; Wi-Fi A 2 587, B 2 618, C 2 750, D 2 683.

*Corrected 2026-11-14:* the Wi-Fi reading was carried into the client line doc
(`claude/direction:docs/lines/client.md` §4 item 3) and the phone README's result table as "no difference shown on
Wi-Fi (n = 10)", which reads as a tie or as a cell not run. **The phone did measure it, and the result is
*inconclusive by its pre-registered rule*:** by the Second amendment's 10-minute rule the run stops after octet 4,
which leaves 6 Wi-Fi ratios (under the 8 the sign rule needs), so every fill comparison is *not decided*
(`claude/fill-split:docs/reviews/phone-blind-read.md` §3, `claude/reviews-2026-11-13:docs/reviews-2026-11-13.md` §5).
The six-octet reading above is reported beside it; which reading stands is the owner's.

**Not explained:** one worker run of `dbts_a1-q8-g16-cut` failed once in 40 in the cloud (the demo commit's cleaning
check) and passed 6 of 6 reruns (`claude/direction:docs/lines/client.md` §4 item 3).

## Verdict, scope

No measurement, cloud or phone, shows the worker faster; both views are correct. On this phone the fill is bound by
its decode, which both views share, so a view that moves the page's thread has little of the fill to move. Every speed
comparison is *not decided* by the run's own rule, and none carries to the demo commit. **Which view is the target
stays the owner's** (2026-11-11: the page view stays; decided after the phone runs). *Decides:* the next phone round,
its amendment written by a session that will not run it, with a hands-off runner.

Raw rows: `claude/fill-split:docs/phone-rows/raw/`, read by `claude/fill-split:lab/phone/rows.py` (reproduce in that README).
