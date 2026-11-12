# A hidden page's fill: load 13 of the first phone run

Row HIDDEN-PAGE-DECODE, 2026-11-12. Fixtures and limits: one load (load 13, Wi-Fi with the server wired, `bbr`,
page view, `dbts_b1-q8-g8`: 50 frames, G = 8, 10-bit depth cut) on one phone, one evening; raw rows on
`claude/phone-rows` `4e492c92`. The page's visibility was not recorded in that run, so "the page was hidden" is the
run session's note (the owner was in the phone's Settings at about that time), not a measurement. Nothing here was
run on a phone; the fix's evidence is the node test below.

## What the trace shows

`docs/phone-rows/raw/beacon-wifi-8766.jsonl`, load `2ed36cb0`:

* Frames 0, 8 and 16, the keyframes of the first three groups, all reached the page through `av1-webcodecs`, each
  with a decode time of 17.6–18.1 s. The decode time is `decodeEnd − decodeStart`, both stamped inside the decoder
  worker (`client/view/controller.js` `about`), so 18 s passed inside one decode call.
* Every other frame of those three groups (1–7, 9–15, 17–23) failed with `frame N−1 of its group did not decode`.
  That reason is written in one place only: `downloader.js` `pump()`, for a frame it finds *orphaned* (not a
  keyframe, its predecessor's record gone, and no decoder whose `next` is this frame).
* Groups 24–47 and frames 48–49 decoded normally, in 110–220 ms each. The server lost no packets.

## Reading

1. **Not codec reclamation.** The WebCodecs specification lets a user agent reclaim a codec. W3C WebCodecs, Editor's
   Draft, §11 *Resource Reclamation*: "To reclaim a codec, a User Agent MUST run the appropriate close algorithm …
   with a QuotaExceededError", and "A User Agent MUST only reclaim a codec that is either an inactive codec, a
   background codec, or both", where "An active codec is a codec that has made progress on the [[codec work queue]]
   in the past 10 seconds" and "A background codec is a codec whose ownerDocument (or owner set's Document, for codecs
   in workers) has a hidden attribute equal to true". Chromium reclaims less than the specification allows (read
   2026-11-12 on `main`, `third_party/blink/renderer/modules/webcodecs/`):
   * `reclaimable_codec.cc` `AreReclamationPreconditionsMet()`: `is_applying_pressure_ && global_pressure_exceeded_
     && is_backgrounded_`;
   * `reclaimable_codec.h`: `kInactivityReclamationThreshold = base::Seconds(90)`, and the timer reclaims only after
     two inactive ticks ("Otherwise, tabs that were suspended could see their codecs reclaimed immediately after
     being resumed");
   * `decoder_template.cc`: `if (decoder()->IsPlatformDecoder()) ApplyCodecPressure(); else ReleaseCodecPressure();`.
     Only a platform (hardware) decoder applies pressure; `codec_pressure_gauge.cc` puts Android's shared threshold
     at 4 such codecs.

   The client configures every AV1 decoder `hardwareAcceleration: "prefer-software"` (`av1-webcodecs.js`), so by
   that code Chromium does not reclaim it, and load 13's 18 s is well short of 90 s. A reclaimed keyframe would also
   have failed as `undecodable: … closed`, not reached the page. Load 13 is something else.
2. **The downloader replaced decoders that had done nothing wrong.** `downloader.js` gives a decoder that owes a frame
   `decodeMs` (10 s) to answer, then terminates it, starts another and asks the wire again for what it held
   (`arm`, `replace`, `again`). A decode that takes 18 s on a page that keeps running would have been cut at 10 s and
   could not have delivered its frame. The keyframes *were* delivered, so the 10 s timer cannot have fired on time:
   the downloader's own thread was not running either. That is what a hidden page that the browser freezes or stops
   looks like (Page Lifecycle, WICG: "Frozen: lifecycle state for CPU suspension … Normally HIDDEN pages will be
   frozen to conserve resources"). When the page ran again, each overdue deadline fired and replaced a decoder that
   had just delivered its keyframe. The new decoder holds no group state, the keyframe's record was gone (the page had acknowledged it,
   or it had been asked of the wire again), and `pump()` failed the rest of each group as orphaned. Three groups were in flight, on the
   three decoders, so three groups were lost; the groups dispatched after the page ran again were not.
3. **What the client does when a decoder is lost mid-group** (unchanged, and pinned by the contract rig's *group*
   checks in `client/contract/dispatch-rig.ts`): every later frame of that group fails by name, and is not asked
   again; the next group decodes from its keyframe. A real loss (a crash, a hang) still ends this way. A WebCodecs
   decoder closed between groups (reclaimed, where a browser does) is reopened by `av1-webcodecs.js` only after the
   next keyframe has failed on it, so that one keyframe goes to dav1d, named by its `refusal`; not changed here.

## The fix: a late deadline is given again

`claude/hidden-page-decode` (draft, into `claude/demo-fixes-2`): `arm()` notes when the deadline is due, and a
deadline that fires more than `frozenMs` (1 000 ms) late is taken as proof that this thread was stopped, so the
decoder is given a full deadline again instead of being replaced. That a timer in a running worker is never a second late is
assumed, not measured; a decoder still silent through one deadline of running time is replaced as before.

Test `aFrozenPageKeepsItsDecoder` (`client/transport/downloader.test.mjs`) blocks the downloader's thread past the
deadline: the decoder is kept and takes the next frame of its group; one still silent a deadline later is replaced;
the default bound keeps a decoder held up 1.2 s past its deadline. It fails on the code before the fix (2 failures).
Mutants killed: no lateness check; a late deadline neither given again nor replaced; the bound ignored; lateness
measured from arming rather than from the due time; always given again; no default bound; a 5 s default.

Not fixed, proposed: a decoder replaced mid-group, for a real loss, could have its group asked again from the
keyframe on the new decoder instead of failing the rest. That changes what the contract rig pins, so it is a
proposal for the owner, not part of this fix.

## The beacon records visibility

`claude/hidden-page-decode-beacon` (draft, into `claude/phone-tools`, where the beacon lives): a `visibility` record
per `start`, `visibilitychange`, `freeze`, `resume` and `pagehide`, each with `document.visibilityState`, sent with
the queue as before (turning hidden flushes it). Two tests in `lab/phone/beacon.test.mjs`; nine mutants killed (each
record dropped, the flush on hidden or pagehide dropped or made unconditional, the state fixed). Survived: removing
the call in `install()`, which needs a DOM (node cannot see it); the next phone run's first load shows it.

## What would decide it

The next phone round, with the beacon's `visibility` records: a load hidden mid-fill should now complete, with long
decode times on the frames in flight across the hidden span and no `did not decode` errors. A load that fails with
the page visible throughout is a failure, not interference.
