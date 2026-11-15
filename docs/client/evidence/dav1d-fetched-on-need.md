# dav1d fetched only where WebCodecs refuses

**The question:** every AV1 page fetches dav1d-WASM whether or not it decodes a frame with it. Can a page that
WebCodecs serves skip those bytes without making a refusing device slower to its first picture?

*Folded 2026-11-14 from `claude/dav1d-lazy:docs/lines/proposals.md` §P6 (`7cf46ef7`, theory and protocol, 2026-11-11),
`claude/proposals:docs/lines/proposals.md` (`5b4c3341`) §Red team *Corrections to §P6*, §R0, §R5 and §Consolidated,
`claude/direction:docs/lines/client.md` §4 item 7 and `claude/reviews-2026-11-13:docs/reviews-2026-11-13.md` §4. Not
built on this branch.*

## Theory (2026-11-11, by a session that measured none of it)

Today dav1d is fetched three ways: `client/viewer/head.js` preloads `av1-dav1d.js`, `dav1d.js` and `dav1d.wasm` once
the metadata says `codec: "av1"`; each decoder worker's `av1.js` `init` fetches the glue and WASM again; dav1d is
instantiated only on first use, so a page WebCodecs serves pays bytes, not compile or heap. The preload warms only the
HTTP cache for the workers (Fetch consumes a preloaded response only for a Window client; HTML keys the map to the
Document). Bytes: **636 484 B raw, 243 481 B gzipped** (level 6, the deploy template's); `dev-server.py` does not
compress. Per accepting page that is **−0.24 to −0.64 MB** (an assumption: which one a page pays depends on the host's
compression). Who needs it: a ≤ 10-bit unit goes to WebCodecs once its layouts' probe passes, to dav1d after a refusal
or a failure; Firefox 157 refused every grey payload and WebKit takes 8-bit 4:2:0 only (every AV1 frame on an iPhone
goes to dav1d); **no phone's WebCodecs AV1 has been probed here**.

The forms: **(a)** today; **(b)** on refusal: no preload or fetch at start, dav1d fetched at the first refusal or
failure, so a refusing device waits about 4 more round trips after its first payload (cold-open measurement: 11.93
against 7.96 round trips to the first frame); **(c)** probe at start: no preload; each worker's `init` probes the
layouts the metadata implies while the session dials and fetches dav1d at once on a refusal, when `VideoDecoder` is
absent or the series is over 10 bits. (c) is the form proposed. A failure inside a group costs the same in every form
(dav1d refuses a unit whose predecessor it did not decode).

**Correction before the run (red team, 2026-11-11):** the registered bars (first picture ≤ 10 ms above (a), fill
≤ 1.02×) sat under the measured spread of two builds that change nothing (+1 to +30 ms,
[`measurement-noise-floor.md`](measurement-noise-floor.md)); so an A/A arm (a′) joined the rotation and each
tolerance became the larger of the registered value and the A/A spread, read on the cells pooled.

## Measured (2026-11-12, by another session; amendments written before any counted run)

**Fixtures:** the demo commit `157b7109`; `dbts_a1-q8-g8-cut`, `dbts_b1-q8-g8`, `dbts_c1-q8-g16-cut`; one 4-core cloud
host without a GPU, headless Chromium; two static hosts (nginx with gzip 6, and `dev-server.py`), clean and 1 % loss
links, 20 Mbit/s. **Cut to 5 rounds of the registered 9** (the host ran 1.07 rows a minute; nine rounds were 14 h).
The static host's TCP is not on the sessions' UDP queue, so dav1d's bytes never competed with the fill: **this
understates any gain of (b) and (c)**. 507 rows.

* **Route taken (WebCodecs accepts):** no cold load of (b) or (c) asks for dav1d; (a) and (a′) ask three times
  (636 484 B raw, 243 779 B gzipped). First picture pooled against (a): (a′) +1.0 ms, (b) −104 ms, **(c) −128.5 ms**
  (tolerance 10 ms); fill 0.975× and 0.976× (tolerance 1.02×); one cell of 12 over the first-picture tolerance in each.
* **Route refused (lever on in every arm):** every load all on `av1-dav1d`. First picture pooled: (a′) −12 ms,
  **(b) +192.5 ms**, 11 of 12 cells over the 50 ms tolerance: **(b) fails**; **(c) −128 ms**, 0 of 12 over: holds.
* **Route failed mid-group** (3 rounds × 3 series × 3 arms, clean, dev host, cold): every arm received the same frame
  count with the same routes. The frames that fail differ between arms by one to five in 6 of 9 rounds, and (a) varies
  the same way between its own rounds (`dbts_a1` 28–32 then 28–31). By its letter ("the frames that fail … are those of
  (a)") rule (3) is **not met**; the variation is not shown to be the arm's.
* Warm loads asked for nothing on either host (no heuristic-cache question left).

## Verdict, scope

Form (c) meets rules (1) and (2) on the rig; rule (3) is open on its letter, since the reference arm itself varies.
Form (b) fails. Three DBT volumes, one host, 5 rounds, an understated gain; no phone. *Decides:* rule (3) re-read
against arm (a)'s own round-to-round spread (a registered reading of outcome sets and an A/A pair, 9 rounds), then the
owner's yes to build (c), about 13 lines of `av1.js`, `head.js` and `viewer.js`; and a phone's WebCodecs AV1 probe on
record.

Raw rows: `claude/proposals:lab/proposals/rows/` (`r5-summary.txt`).
