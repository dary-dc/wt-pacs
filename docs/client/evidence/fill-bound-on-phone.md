# What bounds a fill on the phone

**The question:** on a phone, is the optimal-quality fill bound by the link or by the decode, and where does the
phone saturate? It sets which lever moves a phone's fill (the wire, the controller, or the decode: tiles, the
decoder count) and is an input to the delivery comparison's theory (`design.md` *Open*).

*Folded 2026-11-14 from `claude/fill-split:docs/phone-rows/README.md` §What bounds a fill (`28810f62`, written
2026-11-12; split by `lab/phone/fill.py` on that branch, with `fill_test.py`), `claude/fill-split:docs/reviews/phone-blind-read.md`
§3 and `claude/direction:docs/lines/client.md` §4 item 4. Reported there as deciding nothing; nothing was
pre-registered for it.* The run's method: [`phone-run-method.md`](phone-run-method.md).

## How the fill was split

Each counted load's fill (the dial to the last frame stored, the Second amendment's definition) split into the
server's **wire time** (its path rows every 250 ms, from the session's start; coarse by 250 ms) and the **decode
floor**: the beacon's per-frame decode times (`decodeStart` to `decodeEnd` in the decoder worker, after its queue)
summed and shared over the run commit's three decoders (`min(3, hardwareConcurrency)` in
`client/transport/downloader.js`; the beacon records no core count, but every load's frames arrive in three
interleaved groups 0, 8, 16, …). Each decoder takes one frame at a time, so the busiest spent at least the floor
decoding, inside the fill.

## Results (measured)

**Fixtures:** one Android 16 phone (Chrome 157), one home link at one evening, `dbts_b1-q8-g8` (50 frames of
~460 KB, 10 bits, G 8), run commit `962226e8`, not the demo commit; three decoders.

| link | controller | loads | fill | wire time | decode floor | rest (fill − floor) | floor ÷ fill | a frame's decode |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tether | `cubic-restart` | 11 | 2.87 s | 0.75 s | 2.45 s | 0.25 s | 0.91 | 135 ms |
| tether | `bbr` | 12 | 2.79 s | 1.00 s | 2.42 s | 0.32 s | 0.89 | 135 ms |
| Wi-Fi | `cubic-restart` | 12 | 2.62 s | 0.50 s | 2.35 s | 0.22 s | 0.91 | 133 ms |
| Wi-Fi | `bbr` | 11 | 2.73 s | 0.75 s | 2.38 s | 0.35 s | 0.89 | 134 ms |

Medians over the loads with a fill (load 13 has none). Per load the floor is 0.76–0.94 of the fill.

* **The fill is bound by the phone's decode.** At least 76 % of every fill, about 90 % of the typical one, is the
  busiest decoder decoding; the server is done sending within the first second and the decode goes on 1.5 s or more
  after. A frame's decode is 133–135 ms on both links and under both controllers: about 21 frames a second at three
  decoders. A faster link cannot shorten this fill by more than the rest.
* **The rest**, 0.2–0.35 s: the dial, the first frame's arrival, decoders idle while others finish, the last paint
  and store. The beacon has no per-frame arrival times to split it further.
* **The slow loads are slow decodes.** Load 6 (9.7 s, 524 ms a frame) and load 10 (16.5 s, 872 ms a frame, passed)
  had wire times of 0.75 and 1.5 s; load 13's first keyframe took 17.9 s (a frozen page,
  [`hidden-page-decode.md`](hidden-page-decode.md)). What slowed loads 6 and 10 is not in the rows.
* *Not pre-registered:* the rest is larger under `bbr` on both links (0.32 against 0.25 s; 0.35 against 0.22 s), as is
  its wire time; the decode floor is not. If it holds, the controller's effect on the fill is in the start.

**The route the decode took.** *Corrected 2026-11-14:* the README's bullet *Where the phone saturates is not shown*
says the decode is "WebCodecs asked for `prefer-software`, a hint the user agent may ignore", and that which decoder
Chrome ran is not recorded. It omitted that **the product itself asks for software**:
`client/decode/av1-webcodecs.js:80` configures every AV1 decoder `hardwareAcceleration: "prefer-software"`, and
Chromium's decoder broker never offers a hardware decoder under `prefer-software`
([`../../decode/hardware.md`](../../decode/hardware.md), the gate citing `video_decoder_broker.cc:208–225`). So every
phone AV1 decode in that run was a software request, and the 133–135 ms a frame is a software decode on this phone,
not a hardware one; the protocol had said as much ([`../../devices.md`](../../devices.md) §7, *Where a phone run shows
nothing*). Which software decoder Chrome for Android ran (dav1d or another) is still not recorded.

## Where the phone saturates: not shown

The per-frame times were taken with three decoders running at once, so they hold their contention: whether one
decoder alone is faster, or a fourth would decode more, the run cannot say (it varied neither), and the core count was
not recorded. Nothing past three software decoders on this phone is claimed.

## Verdict, scope

On one phone, one series, one evening, at the run commit, with three software decoders: the fill is decode-bound
(floor 0.76–0.94 of it), the wire 0.5–1.0 s of a 2.4–3.3 s fill. The lever on a phone's fill is the decode (tiles in
the encode, [`decode-speed-of-the-optimal-quality-picture.md`](decode-speed-of-the-optimal-quality-picture.md) §AV1 tiles; the decoder count; a hardware route, which `hardware.md` §1 rules
out today: Chromium's hardware front end refuses 4:0:0 and a 10-bit hardware frame cannot be read back), not the wire. *Decides the saturation:* a round that records the route and per-frame arrivals and
varies the decoder count.

Raw rows: `claude/fill-split:docs/phone-rows/raw/`; `python3 lab/phone/fill.py docs/phone-rows/raw dbts_b1-q8-g8
--exclude $(cat docs/phone-rows/raw/excluded-ids.txt) --orphan 4443:10` on that branch.
