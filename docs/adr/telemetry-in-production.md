# ADR: client telemetry in production, sampled

**Status:** proposed 2026-10-24; theory only, nothing built or timed · **Tags:** telemetry, client, deploy, privacy  
**Lab side, unchanged:** [`telemetry-instrument-clients-from-outside.md`](telemetry-instrument-clients-from-outside.md)
(the Tap) and [`telemetry-server-pipeline.md`](telemetry-server-pipeline.md). **Reporting of exactness failures:**
this record proposes the transport and the receiver that [`exactness-in-production.md`](exactness-in-production.md) §5
left open; its fields stay §5's.

The owner, 2026-10-23: client telemetry is for production too, sampled. "The default build carries no telemetry"
describes today's build, not a rule. The comparison rule stands: **the page clock, measured by the client, is what
counts**. Marks: **(S)** a source, **(R)** read in this repository, **(I)** this record's inference, to be checked.

Why an ADR, and a new one: `docs/adr/` holds one record per decision, and both telemetry records decide the lab's
instruments. This one puts code in the product page and a receiver in the deployment — structural, a new decision.

## 0 · What exists, read first

*Corrected from the row's brief.* `client/record` moved to [`lab/client-telemetry/`](../../lab/client-telemetry/) in
row 264 (R). That recorder, the Tap, does **not** hold dial, first exact frame, fill end or decode times: it patches
`WebTransport` and stamps each asked frame's wire stages (`queue`, `serve_plus_path`, `transfer`, `deliver`), with
`decode_us` and `paint_us` always `null` (R, `lab/client-telemetry/types.ts`). The page-clock milestones are already
**in the product**, kept for the status line and handed to a lab harness through `lab.finished` (R):

| milestone | where it is kept today |
| --- | --- |
| first exact frame painted | `firstShownMs`, `client/viewer/viewer.js` (from `issuedAt`) |
| fill end, every frame here | `fillMs`, same file |
| per frame: ask, last byte, dispatched, decode start and end | `stamps`, `client/transport/downloader.js` and `client/decode/decoder.js` |
| frames checked, by decoder path: exact, not, unchecked; the rescued (`mismatchOn`) | `stats().exact`, `client/transport/consumer.js`; `seen`, `viewer.js` |
| resumes, recycles | `stats().resumedAt`, `recycledAt` |
| errors | `errors`, `viewer.js`, as free text |
| the dial | **not stamped**: the downloader's `started` resolves the consumer's ready promise and no time is kept |

So production telemetry is a **reporter over values the page already computes**, not the Tap shipped. The Tap stays
lab-only: it patches a global, sees only WebTransport, writes a row per frame and costs tens of µs a frame
([client ADR §What installing it costs](telemetry-instrument-clients-from-outside.md#what-installing-it-costs)).

```text
 page (viewer.js, product)                                  web (nginx, the deployment)
 ┌──────────────────────────────────────────────┐          ┌───────────────────────────────┐
 │ transport file ─ telemetry.rate absent? ─▶ off, nothing loaded                          │
 │      │ rate p                                │          │                               │
 │ sampled = random() < p, once per page load   │          │                               │
 │ milestones, counts, histograms (kept today)  │          │                               │
 │      │ sampled, or a failure seen            │          │                               │
 │ import report.js after the first exact paint │          │                               │
 │ visibilitychange → hidden: sendBeacon ───────┼─ POST ──▶│ /telemetry → one JSON line in │
 │ an exactness failure: sendBeacon at once ────┼─ POST ──▶│ telemetry.log (no IP), 204    │
 └──────────────────────────────────────────────┘          └───────────────────────────────┘
        the WebTransport session to series-server is not used (§4)
```

## 1 · What is recorded, and what never is

**Options.** (a) the Tap's per-frame rows; (b) one **session report** per page load: the milestones, counts and
fixed-bucket histograms above; (c) (b) plus a capped sample of per-frame stamps. **What decides it:** the comparison
rule (page clock), the bytes a record may take (§3), and that nothing in it identifies a patient or a person.

**Recommendation: (b).** One record per page load, integers in ms on the page clock, **null ≠ 0** as in the lab:

* milestones from `performance.timeOrigin`: transport file read, dial settled (one new stamp, at `started`), first exact
  frame painted, fill end; `issuedAt` so both origins can be read;
* counts: frames asked and received, by decoder path exact / not / unchecked / rescued, resumes, recycles, beacons that
  `sendBeacon` refused since the last record;
* histograms, log buckets (not rows): decode time (`decodeEnd − decodeStart`), ask → last byte;
* errors as **codes** from a fixed list (`dial`, `lost`, `paint`, `decode`, `refused:<reason>`…), counted; never the
  free text, which can carry a URL (I);
* context: client (`ts` / `wasm`), codec, engine and major version, `hardwareConcurrency`, renderer class (hardware or
  software; never the WebGL renderer string, a fingerprinting surface (I)), `sampled`, a schema version;
* an exactness failure, at once, with [`exactness-in-production.md`](exactness-in-production.md) §5's fields.

**Never recorded:** pixels; any DICOM UID (Study, Series, SOP Instance), which PS3.15's Basic Application Level
Confidentiality Profile replaces (Table E.1-1, as `exactness-in-production.md` §Reporting cites); patient or user
names; the page URL or its query; the transport URL and certificate hash; the client IP (§4's log format omits it).
**What identifies a session:** a random 64-bit id from `crypto.getRandomValues` per page load, held in memory only (no
cookie, no storage), so two page loads never link. The series is not named while one server serves one series; once
studies are served by name, an opaque key the server issues, which only it maps back (`exactness-in-production.md`
§Reporting). A frame digest is a 64-bit hash of samples, not invertible; §5 already sends it.

**Switching later:** cheap to add a field (the schema version moves), expensive to take one back from logs already
kept; (c) can be added under its own rate.

## 2 · The sampling rule

**Options.** (a) per session, probability p; (b) per frame or per event; (c) per user or device (needs a stored id);
(d) everything. **What decides it:** a rate needs a known denominator; per-frame sampling breaks the session's
milestones apart; (c) needs storage §1 refuses.

**Recommendation: (a), decided once at page load, p from the deployment, default off.** Failures are always sent:

* sampled (`random() < p`): the session report at hidden;
* not sampled, and an exactness failure or an error seen: the failure at once and the report at hidden, flagged
  `sampled: false`;
* not sampled and clean: nothing, not even the reporter's code (§6).

Rates and percentiles are read from `sampled: true` records only, which are unbiased at known p; the always-sent
records are for diagnosis (which engine, which path) and are never mixed into a rate (I). **Not covered:** a page
killed before `visibilitychange` fires sends nothing; §5 measures how often.

**Switching later:** p is configuration; a per-cohort rate (by engine, say) is a later field in the same place.

## 3 · How the page sends it

**Options.** (a) `navigator.sendBeacon`; (b) `fetch(…, { keepalive: true })`; (c) `fetchLater()`; (d) on the
WebTransport session (§4). **What decides it:** delivery when the page is hidden or discarded, and the size limit.

* **Beacon** (S, W3C Beacon, editor's draft read 2026-10-24): the user agent starts a fetch with **keepalive** set
  (§2.1, §3 step 7.1) and returns `false` when the data exceeds the keepalive limit, sending nothing (§2.1.4, §3 step
  6.2); a non-safelisted `Content-Type` makes it a CORS request (§3 step 6.3; §4); credentials are `include` (§3 step
  7.1). §1 names `visibilitychange` the only event guaranteed on mobile when a page goes to the background and advises
  against `unload`; §4 says a user agent should not skip, throttle or disable beacons, private browsing included.
* **Fetch** (S, WHATWG Fetch Living Standard, read 2026-10-24): `keepalive` is a request's boolean (§2.2.5 Requests).
  In **§4.6 HTTP-network-or-cache fetch**, a keepalive request whose body, added to the bodies of the fetch group's
  keepalive requests still in flight, exceeds **64 kibibytes** is a network error. Beacons share that budget.
* **`fetchLater()`** (S, Fetch §4.12 Deferred fetching; quota §4.12.1, non-normative): 640 KiB a top-level page, 64 KiB
  at once per reporting origin, sent by the browser when the document goes away. Shipped in Chromium only, to this
  record's knowledge (I): not a base the three engines share.

**Recommendation: (a), a JSON string body (`text/plain`, safelisted, so no preflight), same origin, one record ≤ 4 KiB**
(I: §1's record is a few hundred bytes); sent on `visibilitychange` to hidden, a later hide sending only what changed
(a sequence number joins them); an exactness failure sent at once. `pagehide` as a second trigger only where
`visibilitychange` is not fired (I: older WebKit). A `false` return is counted, not retried. No batching across page
loads, since nothing is stored. (b) is the fallback where `sendBeacon` is absent: the same budget, a response the page
can ignore. The viewer's CSP already allows it: `connect-src 'self'` covers both (R, `deploy/nginx/wt-pacs.conf.template`).

**Switching later:** one call site; (c) can replace the hide handler where it ships without changing the receiver.

## 4 · Who receives it, and where it is kept

**Options.** (a) nginx on the web host, a `location = /telemetry` writing one log line per record; (b) a small
receiver process behind nginx; (c) the WebTransport session, a new FoD message the server logs; (d) a database.

* (c) is a wire change, and at hidden the session may already be closed or frozen; the exactness ADR refused it for the
  same reason (§5) (R). Rejected.
* (d): no network database is decided — the catalog's engine is the owner's open call
  ([`../ingest/design.md`](../ingest/design.md) §10, 4) (R). Telemetry should neither wait on that nor become the first
  network database; an append-only file of JSON lines is enough for a rate and a histogram, and loads into any engine
  later (I).
* (a) needs no new process. Stock nginx logs `$request_body` only where the body is read, which `return 204` does not
  do (I); a `proxy_pass` to a `location` of its own answering 204 reads it, `client_body_buffer_size` keeps it in
  memory, and `log_format … escape=json` with `$time_iso8601 $request_body` and **no `$remote_addr`** writes it (I,
  to verify in §5). Bodies over 4 KiB are refused (`client_max_body_size`). The log goes to a volume of its own.
* (b) is the way out if records need validation, or a body larger than nginx will buffer.

**Recommendation: (a)**, the file on a `telemetry` volume rotated by the deployment, retention its call (default
asked below). **Switching later:** (a) → (b) is one `proxy_pass` target; the page does not change.

## 5 · What it costs: the measurement owed, pre-registered

No number is claimed. The protocol, fixed before any run (`CLAUDE.md` §Measurement):

* **Variants, interleaved and order-balanced** (`lab/order.mjs`): `off` (no `telemetry` in the transport file), `off`
  again (the null control), `on` at p = 1 (reporter loaded, record sent). Same series, same cell, page reloaded per run.
* **Primary outcome, the page clock:** first exact frame and fill end, each per run. The claim "costs nothing
  measurable" holds if `on − off` sits inside the null control's spread and `on` is better or worse in no more rounds
  than chance; otherwise the difference is the cost, quoted as a latency (not also as a throughput).
* **Secondary:** main-thread time of the reporter (serialize + send, timed around the call, and the Chromium profiler at
  200 µs as the client ADR did); the import's bytes and its timing relative to the first exact paint; bytes per record
  (the log line's length, and `Content-Length`); requests per session.
* **Delivery:** fraction of sampled sessions whose record reaches the log, by how the page ends — tab closed, navigated,
  hidden then process killed, bfcache, phone screen lock — in Chromium, Firefox and WebKit. This is the number that
  says whether §2's rates are biased.
* **The network:** bytes per record × sessions a day × p, from the delivery runs; and the receiver's CPU at a burst
  rate, with the host's saturation stated and nothing claimed past it.
* **Cells:** unthrottled and 4× CPU throttle; a phone when the rig has one (`docs/devices.md`), else said.

## 6 · How the build changes

**Options.** (a) one build: the reporter ships, inert unless the transport file sets a rate and the draw hits; (b) a
separate telemetry build served to a sampled share. **What decides it:** what a sampled session measures must be the
product others run, and one artefact to deploy.

**Recommendation: (a).** A module, `client/viewer/report.js` (name to the glossary when built), imported by the viewer
only when sampled or on the first failure, and after the first exact paint, so it is never on the path it measures.
(b) would measure a different artefact and double the deploy. The rate rides the transport file, already read by the
page and written at server start (R, `deploy/server-start.sh`): `{"telemetry": {"rate": p, "url": "/telemetry"}}`
from a `TELEMETRY_RATE` variable, absent by default. No extra round trip, which every page-open lever is counted in
(R, [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The session open).

**`client/scripts/check_telemetry_absent.sh` becomes two checks.** Its present job, the Tap absent from the default
bundles and WASM package, stays word for word, renamed `check_tap_absent.sh` so "telemetry" no longer means only the
lab. New, in the viewer's browser check: with no `telemetry` field, and with `rate: 0`, the page imports no
`report.js` and sends no request to the endpoint; at `rate: 1` it sends one record whose fields match §1's list
exactly, so a field added without this record's table fails the gate. **Switching later:** (a) → (b) is a build step;
the reverse would need a migration of every deployment.

## 7 · Privacy, consent, and turning it off

* **Off is the default and the absence of a field.** A deployment that never sets `TELEMETRY_RATE` serves a page that
  loads no reporter and sends nothing; `rate: 0` is the same. A deployment can also answer `/telemetry` with 404.
* **No personal data by construction** (§1): no UIDs, no names, no IP in the telemetry log, no stored identifier, no
  cookie (the deployment sets none today; beacons carry credentials, so one set later would ride along (I)).
* **Consent is the deployment's legal call, not this repository's** (I, not legal advice): operational records with no
  personal data and no stored identifier are the case most regimes treat lightly, but a hospital's policy decides. The
  repository's part is a page that can be told off, and this list of what is sent.
* **Global Privacy Control:** proposed that a page with `navigator.globalPrivacyControl === true` is never sampled
  (failures included); the owner's call below.
* The records are telemetry about the software, never evidence about a patient's care; a log line names no study.

## Open: the owner's

| question | default if not answered |
| --- | --- |
| p for a deployment that turns it on | 0.01, set per deployment |
| are failures sent from unsampled sessions | yes, when the rate field is present at all |
| retention of `telemetry.log` | 30 days, rotated daily |
| honour Global Privacy Control | yes, nothing sent |
| a per-frame stamp sample (§1 (c)) | no |
| the receiver: nginx log or a receiver process | nginx log |
