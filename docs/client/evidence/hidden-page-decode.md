# A fill on a page that goes hidden: does the client keep its decoders

**The question:** when the page is hidden (and the browser freezes it) during a fill, does the client lose the AV1
groups it was decoding, and why? Phones hide pages often: a notification, the settings, the screen locking.

*Folded 2026-11-14 from `claude/hidden-page-decode:docs/reviews/hidden-page-decode.md` (`22c68824`, 2026-11-12,
with its review by a session that wrote neither fix), the beacon change on `claude/hidden-page-decode-beacon`
(`5137f449`), `claude/direction:docs/lines/client.md` §4 item 2 and `claude/reviews-2026-11-13:docs/reviews-2026-11-13.md`
§5. The fix (PR 376, into the demo's branch) and the beacon change (PR 377, into the phone tools' branch) are **not on
this branch** (`frozenMs` is absent from `client/` here).*

## What the phone showed (measured, one load)

Load 13 of the first phone run ([`phone-run-method.md`](phone-run-method.md)): Wi-Fi with the server wired, `bbr`,
page view, `dbts_b1-q8-g8` (50 frames, G 8, 10 bits). The page's visibility was not recorded, so **"the page was
hidden" is the run session's note** (the owner was in the phone's Settings at about that time), not a measurement.

* Frames 0, 8 and 16, the keyframes of the first three groups, reached the page through `av1-webcodecs`, each with a
  decode time of 17.6–18.1 s, stamped inside the decoder worker: 18 s passed inside one decode call.
* Every other frame of those three groups (1–7, 9–15, 17–23) failed with `frame N−1 of its group did not decode`,
  written only by `downloader.js` `pump()` for an orphaned frame.
* Groups 24–47 and frames 48–49 decoded normally (110–220 ms each). The server lost no packets. 29 of 50 received.

## Reading (sources quoted, code read)

1. **Not codec reclamation.** WebCodecs (W3C Editor's Draft, §11 *Resource Reclamation*) lets a user agent reclaim an
   *inactive* codec (no progress in 10 s) or a *background* one (its document hidden). Chromium reclaims less (read
   2026-11-12 on `main`, `third_party/blink/renderer/modules/webcodecs/`): only when `is_applying_pressure_ &&
   global_pressure_exceeded_ && is_backgrounded_` (`reclaimable_codec.cc`), after 90 s of inactivity and two ticks
   (`reclaimable_codec.h`), and **only a platform (hardware) decoder applies pressure** (`decoder_template.cc`;
   Android's threshold is 4 such codecs). The client configures every AV1 decoder `prefer-software`
   (`av1-webcodecs.js:80`), so by that code Chromium does not reclaim it, and 18 s is short of 90 s; a reclaimed
   keyframe would also have failed as `closed`, not reached the page.
2. **The downloader replaced decoders that had done nothing wrong.** It gives a decoder that owes a frame `decodeMs`
   (10 s), then terminates it, starts another and asks again for what it held. A decode of 18 s on a running page
   would have been cut at 10 s; the keyframes *were* delivered, so the timer did not fire on time: the downloader's
   own thread was stopped too, as a frozen hidden page is (WICG Page Lifecycle: "Normally HIDDEN pages will be frozen
   to conserve resources"). When the page ran again each overdue deadline fired and replaced a decoder that had just
   delivered its keyframe; the new one holds no group state, the keyframe's record was gone, and `pump()` failed the
   rest of each group. Three groups in flight on three decoders, three groups lost.
3. **A decoder lost mid-group, as the client is today** (pinned by the contract rig's group checks in
   `client/contract/dispatch-rig.ts`): every later frame of the group fails by name and is not asked again; the next
   group decodes from its keyframe. A WebCodecs decoder closed between groups is reopened only after the next keyframe
   failed on it, so that keyframe goes to dav1d, named by its `refusal`.

## The fix: a late deadline is given again (built, tested in node)

`arm()` notes when the deadline is due; a deadline that fires more than `frozenMs` (1 000 ms) late is taken as proof
the thread was stopped, and the decoder is given a full deadline again instead of being replaced. **That a timer in a
running worker is never a second late is assumed, not measured.** A decoder still silent through one deadline of
running time is replaced as before.

Test `aFrozenPageKeepsItsDecoder` (`client/transport/downloader.test.mjs` on that branch) fails on the code before the
fix (2 failures); the author's 7 mutants and the reviewer's 5 are killed. **Review finding (not a defect):** any thread
stop longer than `frozenMs` (a long GC, a busy worker) re-arms the deadline, so a truly hung decoder is replaced one
deadline later than before; bounded.

**The beacon records visibility** (PR 377): a `visibility` record per `start`, `visibilitychange`, `freeze`, `resume`
and `pagehide` with `document.visibilityState`, flushed on hidden. Two tests, 9 mutants killed; the call in
`install()` needs a DOM and is untested in node.

**Proposed, not built:** a decoder replaced mid-group for a real loss could have its group asked again from the
keyframe instead of failing the rest. It changes what the contract rig pins, so it is the owner's.

## Verdict, scope

One load on one phone; the cause is read from the trace and Chromium's code, consistent with a frozen page and with
nothing else that fits both a 10 s deadline and an 18 s decode completing. The fix is proposed, tested in node, checked
by `demo-check.mjs` in both views on one series in the cloud; not run on a phone. *Decides it:* the next phone round
with the `visibility` records: a load hidden mid-fill should complete, with long decode times across the hidden span
and no `did not decode` errors.
