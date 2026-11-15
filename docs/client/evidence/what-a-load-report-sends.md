# The load report: client telemetry in production, sampled

**The question:** what does the client send about a page load in production, when, how, to whom, and at what cost,
so that a sampled share of real loads can be read on the page's own clock without identifying a patient or a person?

*Folded 2026-11-14 from `claude/telemetry-client:docs/adr/telemetry-in-production.md` (`b097f5b9`; proposed
2026-10-24, §8 designed 2026-11-11), its client-side content carried here; the ADR itself, the module
`client/viewer/load-report.js` and its test are on that branch only (PR 370, a proposal, not for the demo), as is an
earlier form without §8 on `claude/telemetry-production-design` (`deb236a3`). Also `claude/direction:docs/lines/client.md`
§4 item 6. Marks as the ADR's: (S) a source, (R) read in this repository, (I) the ADR's inference. **Nothing here is
timed.***

## The owner's decisions

* **2026-10-23:** client telemetry is for production too, sampled. "The default build carries no telemetry"
  describes that day's build, not a rule. The comparison rule stands: **the page clock, measured by the client, is
  what counts.**
* **2026-11-11:** client telemetry is an essential part of the product, built now, sampled; **one implementation per
  job**: the phone run's beacon (`claude/phone-tools:lab/phone/beacon.js`) becomes a switch that turns the product module on, and its
  duplicate code goes. Telemetry is off by default (rate 0).
* **2026-11-14, which changes the ADR:** exactness failures are a **safety report, not telemetry**: always on, never
  sampled, not gated by the rate, on the load report's endpoint and record format ([`../design.md`](../design.md)
  *Decided*; [`where-a-frame-can-be-corrupted.md`](where-a-frame-can-be-corrupted.md)). The ADR's §2 ("not sampled, and an exactness failure … the
  failure at once") and its open question "are failures sent from unsampled sessions: yes, when the rate field is
  present at all" are superseded by it; the load report alone follows the rate.

## What exists to report (R, read at the ADR's date)

The page-clock milestones are already in the product, kept for the status line: `firstShownMs` and `fillMs`
(`viewer.js`), per-frame `stamps` (ask, last byte, dispatched, decode start and end; `downloader.js`, `decoder.js`),
frames by check outcome and decoder path (`consumer.js` `stats().exact`), resumes and recycles, errors as free text.
The dial is not stamped. So production telemetry is a **reporter over values the page already computes**, not the
lab's Tap shipped (the Tap patches `WebTransport`, writes a row per frame and stays lab-only).

## The design (§8, as built on that branch; where it differs from §1–§7 it holds)

* **What:** the *load report*, one JSON object per page load, assembled in memory and sent once by
  `claude/telemetry-client:client/viewer/load-report.js`. Nothing per frame on the wire, nothing before the load ends, so it never competes
  with the fill.
* **When: once, when the page turns hidden.** A viewer's load has no end the page can see before that (a reader may
  ask a frame at any time); every way of leaving passes through hidden (HTML: *unload a document* fires `pagehide`
  then sets visibility "hidden"). A load hidden before its fill ends sends with the fill `null`; returning sends
  nothing more; a page never hidden sends nothing.
* **How:** `navigator.sendBeacon`, a JSON string body (`text/plain`, safelisted, so no preflight), same origin. W3C
  Beacon (CR Draft 2022-08-03, §3.1): "The user agent MUST schedule immediate transmission of all beacon requests when
  the document visibilityState transitions to hidden"; a body over the user agent's limit returns `false`. Fetch §4.6:
  a keepalive request fails when "the sum of contentLength and inflightKeepaliveBytes is greater than 64 kibibytes".
  `fetch` with `keepalive` is **not** a fallback (the same 64 KiB). On `false` the report is sent once more without
  its per-frame rows (`frames: null`, `truncated: true`); a second `false` drops it. Nothing is retried later.
* **Size** (stated by `load-report.test.mjs`, a worst case: every frame with the longest route, a refusal, a
  seven-digit byte count, an unrounded decode time, four label changes, two presses):

  | series | frames | report bytes, worst case |
  | --- | --- | --- |
  | `dbts_a1` and its optimal-quality series | 56 | 5 447 |
  | `dbts_b1` | 50 | 4 938 |
  | `dbts_c1` | 69 | 6 554 |

  About a tenth of 64 KiB; the test fails over 16 KiB. **Not measured:** the bytes a real load sends.
* **Fields:** `load` (a `crypto.randomUUID` per page load, in memory only); `view`, `client`, `codec`; `source` (the
  series' source fingerprint, an opaque XXH3-64 of the source's frame digests, never a DICOM UID or the bundle's name);
  `lossy` (`{q, g, depth}` or `null`); `frameCount`, `received`, `routes`; `frames` (per frame stored: `i`, `route`,
  `refusal`, `kb`, `decodeMs`); `fillFrom`, `fillTo`, `fillMs` (the fill as `devices.md` §7's Second amendment defines
  it, [`phone-run-method.md`](phone-run-method.md)); `statusFillMs` (beside it, deciding nothing); `labels`; `presses`;
  `errors` (`at`, `source`, `message` with every URL replaced by `<url>`); `rate`, `truncated`. The lab adds its own
  fields through the switch; the product sends none of them.
* **Never in it:** a DICOM UID, a patient or user name, the page's URL or query, the transport URL or certificate
  hash, pixels, the client IP (the receiver's log format omits it); no cookie, no stored identifier, so two loads
  never link.
* **Off by default.** The transport file carries `{"telemetry": {"rate": p, "url": "<endpoint>"}}`; absent or `rate`
  0, nothing is drawn, recorded or sent and the module's listeners are never added. The draw is once per load,
  `Math.random() < rate`. Rates and percentiles are read from sampled records only (unbiased at known p).
* **The test sink:** `?beacon=<controller>` through `head.js`'s lab gate loads the lab's switch (rate 1, endpoint
  `/lab/beacon`), which `server/dev-server.py --beacon FILE` (off by default) appends as JSON lines.
* **The receiver** (ADR §4, recommended): nginx on the web host, `location = /telemetry` writing one JSON line per
  record with no `$remote_addr`, bodies over the limit refused, on a volume of its own (I, to verify in §5). A
  receiver process is the way out if records need validation.
* **The build** (ADR §6): one build, the reporter imported only when sampled; `check_telemetry_absent.sh` becomes the
  Tap's absence check plus a browser check that no `rate` means no import and no request, and `rate: 1` sends one
  record whose fields match the list exactly.
* **Privacy** (ADR §7): consent is the deployment's legal call (I, not legal advice); Global Privacy Control proposed
  as never sampled.

*Changed from §1 by §8:* per-frame rows are in (the phone protocol reads them); error messages are sent with URLs
removed rather than as codes (§1's codes stay the better privacy bound, the owner's call).

## What it costs: owed, pre-registered (ADR §5)

No number is claimed. Variants interleaved and order-balanced: `off`, `off` again (the null control), `on` at p = 1.
Primary: first exact frame and fill end on the page clock; "costs nothing measurable" holds if `on − off` sits inside
the null control's spread. Secondary: the reporter's main-thread time, the import's bytes and timing, bytes per record,
requests per session. **Delivery:** the fraction of sampled loads whose record reaches the log, by how the page ends
(tab closed, navigated, hidden then killed, bfcache, screen lock) in Chromium, Firefox and WebKit, which says whether
the rates are biased. The network and the receiver's CPU at a burst rate, saturation stated. Unthrottled and 4×; a
phone when the rig has one.

## Open: the owner's

The sample rate for a deployment that turns it on (default if unanswered 0.01); the product sink (nginx log, a
receiver process, or an outside collector; default the nginx log); retention (default 30 days, rotated daily); Global
Privacy Control (default: honoured); error messages with URLs removed or codes only (default messages); a per-frame
stamp sample (default no). **Owed before any of it:** a review of PR 370 by a session that did not write it, then §5's
cost and delivery runs.

## Verdict, scope

A designed and built proposal (on `claude/telemetry-client`), off by default, nothing timed; its worst-case size is
stated by a test on the three DBT fixtures. Not on this branch.
