# The client's reports: the options, and the plan to choose between them

**The question:** how should the three records that leave the page — the **load report** (sampled), the **link** in it,
and the **safety report** (an exactness failure: always on, never sampled) — be delivered, timed, encoded and
received, and does the design PR 370 built win as the option or only as the first build? Written 2026-11-14 (row
REPORT-OPTIONS) by the method of [`cache-plan.md`](https://github.com/dary-dc/wt-pacs/blob/claude/cache-plan/docs/client/evidence/cache-plan.md)
§1–§5 (`claude/cache-plan`). **Theory and a plan only: nothing here is built or timed.** Marks: **(S)** a source quoted
verbatim below, **(R)** read in this repository, **(I)** this file's inference, to be checked by the protocol.

Inputs: PR 370's design and build (`claude/telemetry-client`: `docs/adr/telemetry-in-production.md` §1–§8,
`client/viewer/load-report.js`), the 2026-11-14 decision ([`../design.md`](../design.md) §Decided: "Exactness failures
are a safety report, not telemetry: always on, never sampled, no pixels or patient data, the load report's endpoint
and format; on a mismatch the second decode first, then the frame blocked, the reader told in that frame's view and
the report sent at once"), and [`../../adr/exactness-in-production.md`](../../adr/exactness-in-production.md) §2, §5, §8.

## 0 · Sources, pinned (fetched 2026-11-14)

| short name | URL | pin |
| --- | --- | --- |
| Beacon | https://w3c.github.io/beacon/ (Editor's Draft, 2 November 2026) | w3c/beacon `721999436e4d`; page sha256 `0c740e09487a` |
| Fetch | https://raw.githubusercontent.com/whatwg/fetch/2696300d95bb/fetch.bs | `478609e29799` |
| Reporting | https://raw.githubusercontent.com/w3c/reporting/fddb77695bef/index.bs | `116c741b6e1c` |
| WebTransport | https://raw.githubusercontent.com/w3c/webtransport/91b5a7316851/index.bs | `5287ff36f135` |
| HTML | https://html.spec.whatwg.org/multipage/ (document-lifecycle, system-state, workers, links; whatwg/html `0793d3d8544e`) | lifecycle page `1d594237e8b4` |
| Compression | https://raw.githubusercontent.com/whatwg/compression/94b42518d2c2/index.bs | `15ae346d1a95` |
| CBOR | https://www.rfc-editor.org/rfc/rfc8949.txt | `f1164a5b31a3` |
| BCD | https://github.com/mdn/browser-compat-data `69fcf3608174`: `api/Window.json`, `api/Navigator.json`, `api/WebTransport.json`, `api/Request.json`, `api/ReportingObserver.json`, `api/CompressionStream.json`, `html/elements/a.json` | sha256: Window `77aea8badb6e`, Navigator `d42efef410ab`, WebTransport `445777319f61`, Request `ae3147049c19`, ReportingObserver `a438864ccdd4`, CompressionStream `8362dd9a1998`, a `ab1ee4ed4a71` |
| nginx | https://nginx.org/en/docs/http/ngx_http_core_module.html, https://nginx.org/en/docs/http/ngx_http_log_module.html (Last-Modified 6 Nov 2026) | `7b9eb00d6842`, `65edd508b55a` |
| quinn | https://docs.rs/quinn-proto/0.11.18/quinn_proto/struct.PathStats.html (the version in `Cargo.lock`, R) | — |
| OpenTelemetry JS | https://github.com/open-telemetry/opentelemetry-js `5a78e6aef1fc` | `fetch-transport.ts` `13afa0fb774e`, `BatchSpanProcessor.ts` `d44f941c2df2` |
| A RUM SDK | https://github.com/DataDog/browser-sdk `e44f1d6aeece` (open source) | `httpRequest.ts` `69e51187cb2a`, `pageMayExitObservable.ts` `1f313e0565b7` |

## 1 · Step 1, the survey

### 1.1 Delivery

* **`navigator.sendBeacon`.** Beacon §2.1: "The user agent MUST initiate a fetch with keepalive flag set, which
  restricts the amount of data that can be queued by such requests to ensure that beacon requests are able to complete
  quickly and in a timely manner. The user agent MUST schedule immediate transmission of all beacon requests when the
  document visibilityState transitions to hidden, and must allow all such requests to run to completion without
  blocking other time-critical and high-priority work." §2.1.4: "If the amount of data to be queued exceeds the user
  agent limit (as defined in HTTP-network-or-cache fetch), this method returns false; a return value of true implies
  the browser has queued the data for transfer. However, since the actual data transfer happens asynchronously, this
  method does not provide any information whether the data transfer has succeeded or not." It is on `Navigator`, and
  HTML (system-state) declares "[Exposed=Window] interface Navigator {" while a worker has "[Exposed=Worker] interface
  WorkerNavigator {};" (workers): **a beacon is sent from the page's thread only.** Shipped everywhere: BCD
  `api.Navigator.sendBeacon` chrome "39", chrome_android "42", firefox "31", safari "11.1".
* **`fetch` with `keepalive`.** Fetch §HTTP-network-or-cache fetch: "If the sum of contentLength and
  inflightKeepaliveBytes is greater than 64 kibibytes, then return a network error." — the same budget a beacon draws
  on. Unlike the beacon it runs in a worker and returns a response. BCD `api.Request.keepalive`: chrome "66", firefox
  "133", safari "13". The RUM SDK keeps beacons on exit for Firefox: "Since fetch keepalive behaves like regular fetch
  on Firefox, keep using sendBeaconStrategy on exit" (`httpRequest.ts`, `sendOnExit`) — a vendor's claim, unverified
  here (I: the protocol's kill cell settles it).
* **`fetchLater()`.** Fetch §Deferred fetching: "Deferred fetching allows callers to request that a fetch is invoked at
  the latest possible moment, i.e., when a fetch group is terminated, or after a timeout." With `activateAfter`, the
  user agent may send early when it "has a reason to believe that it is about to lose the opportunity to execute
  scripts, e.g., when the browser is moved to the background". §Deferred fetching quota: "Out of the allocated quota
  for a document, only 64 kibibytes can be used …". BCD `api.Window.fetchLater`: chrome "135", firefox false, safari
  false.
* **The Reporting API.** Reporting §Guarantees: "This specification aims to provide a best-effort report delivery
  system that executes out-of-band with website activity. … The delivery is not, however, guaranteed in any way, and
  reporting is not intended to be used as a reliable communications channel." Reports are made by the user agent:
  "When the user agent is to generate and queue a report for a Document or WorkerGlobalScope object …"
  (§Report Generation), and the page's interface is only "interface ReportingObserver { constructor(…); undefined
  observe(); undefined disconnect(); ReportList takeRecords(); };" (§Interface ReportingObserver) — **a page cannot
  queue a report of its own** (the one other entry point is WebDriver's "Generate Test Report" extension command,
  §Automation).
* **A stream or a datagram on the WebTransport session.** The session is already open while a load runs. When the
  document goes, WebTransport §Context cleanup steps: "If transport.[[State]] is "connected", then: Set
  transport.[[State]] to "failed". In parallel, terminate transport.[[Session]]." Datagrams are the unreliable half: "reliable as well as
  unreliable transport" (§Introduction, non-normative); queued datagrams "can be discarded" (§Procedures, datagram
  writable). The ADR rejected this
  carrier as a wire change and for the closed-at-hidden risk (`telemetry-in-production.md` §4 (c), R) — a cost, not a
  sourced refusal, so it is surveyed and screened like the others.
* **A server-side record from the QUIC connection.** The server holds per-path statistics whatever the page does:
  quinn-proto 0.11.18 `PathStats` has `rtt` ("Current best estimate of this connection's latency (round-trip-time)"),
  `min_rtt` ("Minimum RTT seen on this path, ignoring ack delay"), `cwnd` ("Current congestion window of the
  connection"), `congestion_events`, `lost_packets`, `lost_bytes`, `sent_packets`. It cannot see the page's clock: the
  fill's end, the decode, the check.

### 1.2 The link in the load report

* **The client's `getStats()`**: WebTransport §WebTransportConnectionStats lists `bytesSent`, `bytesLost`,
  `packetsLost`, `bytesReceived`, `smoothedRtt`, `rttVariation`, `minRtt`, `estimatedSendRate`, `atSendCapacity`.
  BCD `api.WebTransport.getStats`: chrome false, firefox "114", safari "26.4". Measured here: "Chromium has no
  `getStats` on WebTransport (headless 141 and Chrome alike)" ([`../../adr/client-window-depth.md`](../../adr/client-window-depth.md), R).
  **The phone (Chrome 157) has no client-side link statistics**: on Chromium the server's record is the only source.
* **Joining the two** needs a key both ends hold. `exportKeyingMaterial()` would derive one from TLS ("Exports keying
  material from a TLS Keying Material Exporter that is derived from the TLS connection and uniquely associated with
  this WebTransport session", WebTransport §Methods) but BCD's `api.WebTransport.exportKeyingMaterial`
  gives chrome false. What remains: the page's random load id in the session's URL (the server logs it at open; I), or
  an opaque key the server issues, as `exactness-in-production.md` §Reporting proposes for the series (R).

### 1.3 When to send

* **At once** (on the event): the record leaves while the page is surely alive. One request per event.
* **At `visibilitychange` to hidden.** Beacon §1: "This event is the only event that is guaranteed to fire on mobile
  devices when the page transitions to background state (e.g. when user switches to a different application, goes to
  homescreen, etc), or is being unloaded. Developers should avoid relying on unload event because it will not fire
  whenever a page is in a background state (i.e. visibilityState equal to hidden) and the process is terminated by the
  mobile OS." HTML's *unload a document* runs "Update the visibility state of oldDocument to "hidden"" (document-lifecycle).
  A page killed while visible sends nothing.
* **A hybrid**: the first record at once (the fill's end; a failure), what follows counted and sent at hidden.
  Production practice does this: the OpenTelemetry browser `BatchSpanProcessor` flushes on hidden
  (`if (document.visibilityState === 'hidden') { this.forceFlush()…`), "Browser only: disable flush when a user
  navigates to a new page, closes the tab or the browser, or, on mobile, switches to a different app. Auto flush is
  enabled by default." (`types.ts`, `disableAutoFlushOnDocumentHide`), and batches between; the RUM SDK flushes on
  `visibility_hidden`, `before_unload`, `page_terminated` and Chromium's `freeze` (`pageMayExitObservable.ts`) and by
  size and count between (`MESSAGES_LIMIT = 50`, `RECOMMENDED_REQUEST_BYTES_LIMIT = 16 * ONE_KIBI_BYTE`).

### 1.4 Format and size

* **JSON**, PR 370's: 4 938–6 554 bytes a load, worst case, on the demo series (its test, R), about a tenth of the 64 KiB.
* **CBOR**: RFC 8949 Abstract: "a data format whose design goals include the possibility of extremely small code size,
  fairly small message size, and extensibility without the need for version negotiation." No browser API encodes it
  (I: none in the specs read): an encoder ships in the page.
* **Compression**: Compression §Interface: "enum CompressionFormat { "brotli", "deflate", "deflate-raw", "gzip", };";
  BCD `api.CompressionStream`: chrome "80", firefox "113", safari "16.4" (per-format support not read). It is a
  stream, so asynchronous (I: whether it completes in a hidden page's last task is unknown and a protocol cell).
* Practice: OpenTelemetry keeps a keepalive request under "60KB to leave headroom for headers" and counts the pending
  keepalive bytes because "the 64KiB limit is cumulative, not per-request"; it also caps keepalive requests at nine,
  citing a Chromium engineer in whatwg/fetch#679 ("If the renderer process is processing more than 9 requests with
  keepalive set, we reject a new request") — second-hand, not read in Chromium (`fetch-transport.ts`).

### 1.5 The receiver

* **An nginx log line** (the ADR's (a)). nginx core: "$request_body … The variable's value is made available in
  locations processed by the proxy_pass, fastcgi_pass, uwsgi_pass, and scgi_pass directives when the request body was
  read to a memory buffer." Log module: "The escape parameter (1.11.8) allows setting json or default characters
  escaping in variables". `client_max_body_size`: "If the size in a request exceeds the configured value, the 413
  (Request Entity Too Large) error is returned to the client." So a log line needs a `proxy_pass` to a location that
  answers, and a body small enough to stay in memory (I: the ADR's §5 owes the check).
* **A small receiver** behind nginx (the ADR's (b)): validation, joins with the server's record, a schema check.
* **An outside collector** (e.g. an OpenTelemetry Collector over OTLP/HTTP): the deployment's operator runs it; the
  viewer's CSP allows `connect-src 'self'` only (R, `deploy/nginx/wt-pacs.conf.template`), so a collector sits behind
  the same origin or the CSP changes.

### 1.6 Sampling, retention, identity

* Sampling per page load, decided once (PR 370, R); the safety report never sampled (the 2026-11-14 decision).
* Retention: no source sets it; the owner's (the ADR's table, R).
* **What may identify a patient or a person**, and what an operator needs: DICOM UIDs are replaced by PS3.15's Basic
  Application Level Confidentiality Profile (Table E.1-1, as `exactness-in-production.md` §Reporting cites, R); the
  report carries `sourceFingerprint` (an XXH3-64 over frame digests, R), the frame index, the route, both digests, the
  engine and version. **To find the frame** an operator needs the series behind the fingerprint, which only the server
  maps (I: the server's catalog), and the index. The client IP is not logged (ADR §4, R); Reporting §Capability URLs
  strips "the username, password, and fragment" from report URLs, which is the floor, not ours: PR 370 sends no URL.

### 1.7 Saving a record from the page (the developer overlay)

HTML (links): "The download attribute, if present, indicates that the author intends the hyperlink to be used for
downloading a resource." A `Blob` URL with `download` ships everywhere: BCD `html.elements.a.download` chrome "14",
firefox "20", safari "10.1", safari_ios "13". `showSaveFilePicker`: chrome "86", chrome_android "132", firefox false,
safari false. `navigator.share` with a file: chrome_android "61", safari "12.1" (BCD's first entry; flags and partial
notes not read). **One survivor, no arms**: a `download` link over the same JSON the report sends (§3.6).

## 2 · Step 2, the screen: sourced hard constraints only

Constraints: **an engine refuses it** (Chromium, Gecko or WebKit has no such API for a page); **the safety report is
always sent** and **the load report never on the fill's path** (the owner's decisions above and PR 370 §8, R); **no
patient data** (PS3.15 above).

| candidate | verdict | why, quoted |
| --- | --- | --- |
| **BEACON**, `sendBeacon` from the page | **survives** | shipped in all three (BCD above); the page thread only, which a design must answer, not a refusal |
| **KEEPALIVE**, `fetch(…, {keepalive: true})`, page or worker | **survives** | all three (BCD `api.Request.keepalive`); same 64 KiB budget |
| **SESSION**, a reliable stream on the open WebTransport session | **survives** | shipped in all three (BCD `api.WebTransport`: chrome "97", firefox "114", safari "26.4"); a wire change and the cleanup step are costs to design and measure |
| a datagram on the session | **out for the safety report**: may be dropped | "they can be discarded" (WebTransport §Procedures, datagram writable); it cannot carry an always-sent record. Not weighed for the load report either: SESSION's stream covers that carrier |
| `fetchLater()` | **out: engines refuse** | firefox false, safari false (BCD). Named for later as a Chromium-only replacement of the hide handler |
| the Reporting API | **out: a page cannot queue a report** | the page interface is `observe`, `disconnect`, `takeRecords` only (Reporting §Interface ReportingObserver) |
| the server's QUIC record as a carrier of the reports | **out as a carrier**: it does not see the page clock or the check | it holds `PathStats` only (quinn-proto, above). **Survives as the link's source**, the only one on Chromium |
| the client's `getStats()` as the link's only source | **out on Chromium** | BCD chrome false; measured absent here (R). Kept where present (Gecko, WebKit), beside the server's record |
| **NGINX**, a log line | **survives** | the body is logged under `proxy_pass` and a memory buffer (nginx core, above): a design condition |
| **RECEIVER**, a process behind nginx (own, or an OpenTelemetry Collector) | **survives** | no refusal; its cost is a cell |
| an outside collector off the origin | **not screened, folded into RECEIVER** | the CSP is this repository's setting, not a hard constraint; off-site delivery of hospital records is the operator's call (I) |
| JSON, CBOR, compressed JSON | **all survive as settings**, not arms | no refusal; a design's pilot picks by §4's rule |

**Five survivors in two families**: the carriers **BEACON, KEEPALIVE, SESSION**, and the receivers **NGINX,
RECEIVER**. **When** (at once, at hidden, the hybrid) is not an option to screen but the protocol's factor: every
carrier runs each timing its design allows (§4).

## 3 · Step 3, a best-effort design per survivor

**Shared by every arm**, so no option pays for another's: the record (PR 370 §8's fields, plus the safety report's
from `exactness-in-production.md` §5 with the series as `sourceFingerprint`, never a UID); one in-memory record per
load assembled where the values are (PR 370's `loadReport`), the load id from `crypto.randomUUID`; the off switch (no
`telemetry` field or `rate` 0: no listener, no import, nothing sent; the safety report alone ignores the rate, per the
2026-11-14 decision); the server's link record (§3.4) beside every arm; one sink contract, `POST <url>` with one
JSON object, `204`.

### 3.1 BEACON (PR 370's build, the incumbent)

* **Load report**: `sendBeacon(url, JSON string)` once at the first hidden; a `false` resends once without `frames`
  (as built, R). `text/plain` body, so Beacon §3's `no-cors` path: "If contentType value is a CORS-safelisted
  request-header value for the Content-Type header, set corsMode to "no-cors"." Its best effort adds what the build
  lacks: the **hybrid** variant, a first beacon at the fill's end (the load's main result, sent while the page is
  surely alive) and a second at hidden with only what changed (presses, labels, errors) keyed by the load id, so a
  page killed while visible after its fill still reports its fill (I).
* **Safety report**: at once, from the page: the decoder worker posts the failure to the page, which beacons it. Cost:
  one message hop; a page whose thread is busy delays it (I: a cell with long tasks).
* **Settles in a pilot**: the hybrid's first send at fill end or at first exact paint.

### 3.2 KEEPALIVE

* Same record and timings as BEACON, sent with `fetch(url, {method: "POST", keepalive: true, body})`.
* **Its own advantage, used**: it runs in a worker, so the safety report leaves **from the decoder worker that found
  the mismatch**, never waiting on the page's thread, and the response says it arrived (`204`), so a failed send can
  be retried once while the page lives (I). It keeps OpenTelemetry's accounting of the pending keepalive bytes and
  count (`fetch-transport.ts`) so the load report never starves a safety report of the 64 KiB.
* **Its own risk, named**: the RUM SDK's Firefox claim (§1.1) — the kill cell decides it.

### 3.3 SESSION

* A unidirectional stream opened on the series' WebTransport session for each record, one JSON object, then FIN; the
  server writes it beside its own link record and needs no second endpoint, no CORS, no nginx location.
* **Its own advantage, used**: the server can join the page's record with its `PathStats` without any key, since both
  are on one connection; the safety report can reach the code that could re-check the stored bytes (§5) directly.
* **Its own risk, named**: at hide the session may still be up (hidden is not unload), but at unload §Context cleanup
  terminates it, so the hide-time record races the end of the document; and a page frozen while hidden may not run
  the stream's write (I). The hybrid is its natural timing: the fill's record at once, a hide record best effort.
* A wire change (`docs/WIRE.md`, R): proposed as a lab arm only, the product wire unchanged until a verdict.

### 3.4 The link, every arm

* **Server side, always**: at session end (and at the fill's last frame) the server writes one line: `rtt`,
  `min_rtt`, `cwnd`, `congestion_events`, `lost_packets`, `lost_bytes`, `sent_packets` from quinn-proto's `PathStats`,
  the bytes sent, the session's duration, and the page's load id taken from the session URL (I: a query parameter the
  server reads at open; the transport URL itself is never in the report).
* **Client side where it exists**: `getStats()`'s `smoothedRtt`, `minRtt`, `rttVariation`, `packetsLost`,
  `bytesReceived` at the fill's end, `null` where absent (Chromium). **null ≠ 0**, as PR 370 does.

### 3.5 NGINX and RECEIVER

* **NGINX**: `location = /report` → `proxy_pass` to a local `location` answering `204`; `client_body_buffer_size` ≥
  `client_max_body_size` = 16 KiB so the body stays in memory; `log_format report escape=json '{"t":"$time_iso8601",
  "r":$request_body}'` with no `$remote_addr`; a volume of its own. Unvalidated: a malformed body is a malformed line.
* **RECEIVER**: the dev sink's shape grown up (PR 370's `dev-server.py --beacon`, R): parse, check the schema
  version and the field list, refuse a body over 16 KiB, append a JSON line, join the server's link record by load
  id, and for a safety report raise it at once (a log at error level the operator watches; I). The advocate may make
  it an OpenTelemetry Collector instead, if that is cheaper to run and keeps the fields.

### 3.6 Saving from the page

The overlay's **save** writes the same JSON object the report would send to a `Blob` and clicks an `<a download>`;
nothing is sent, the rate is not drawn, and the safety reports of the load are included. One design, built with the
winner; no arm.

## 4 · Steps 4 to 6, and what keeps an option from losing to its build

Taken from the cache plan's §4 unchanged: an **advocate per survivor** by a session that wrote none of these designs,
amending its design in place with sources; a **protocol** by a session that builds nothing; builds as lab arms on
`claude/report-arms`, never in product modules (`scripts/check_lab_absent.sh`); a build review; the run interleaved;
the verdict, with **the loser's question** asked once (its gap over its floor, and the change its sources allow).
**Each arm's floor beside it**: the raw call alone (a `sendBeacon` of the same bytes, a bare keepalive fetch, a bare
stream write) interleaved with the integrated arm.

**The protocol's frame** (REPORT-PROTOCOL fills it; predictions and bars before any build):

| cell | what it shows | how, in the cloud |
| --- | --- | --- |
| **delivery**, by how the load ends: navigated, tab closed, hidden then renderer killed, killed while visible, link dropped before hide, bfcache | fraction of loads whose report (and, separately, whose safety report) reaches the sink, per carrier × timing, per engine | Chromium, Firefox, WebKitGTK headless; kill by the browser's process (I: the protocol sources each lever: CDP's lifecycle commands, a signal, the relay's drop) |
| **bytes and requests per load** | request count, body bytes, wire bytes (with headers and TLS), per carrier × timing × format | the sink and the relay's counters |
| **cost on the page's thread** | main-thread time of assemble + serialize (+ compress) + send; any long task it adds; the fill and first exact paint against `off` and an A/A `off` | the profiler and the page clock, PR 370 §5's design reused |
| **the safety report's latency** | mismatch found → record at the sink, page idle and with fixed long tasks | the fault bench's forced mismatch ([`../../adr/exactness-in-production.md`](../../adr/exactness-in-production.md) §The fault bench) |
| **the receiver's cost** | CPU and memory per 1 000 reports at a burst rate, NGINX against RECEIVER; where the host saturates | a load generator on the host, nothing claimed past saturation |

**The phone cells** go into the phone protocol (PHONE-NEXT-PROTOCOL or its successor): delivery when the screen locks,
the app is switched, Chrome is swiped away, Wi-Fi drops; it is there that Beacon §1's "only event that is guaranteed to
fire on mobile" is tested.

## 5 · The safety report: the owner's question

**At once, at the end, or a hybrid?** *Theory, sourced:* the 2026-11-14 decision already says "the report sent at
once", and the sources support it: a record held for the end is lost whenever the end is not reached, and Beacon §1
guarantees only `visibilitychange`, which a page killed while visible never fires. At once costs one request per
failure; a correct decoder fails no frame (`exactness-in-production.md` §Reporting, R), so the count is near zero and
the cost is nil. **Recommended: at once, plus the per-route counts (the denominator) in the load report at hidden** —
a hybrid in the counts, never in the failure. *Measured owed:* the delivery and latency cells above, per carrier; the
carrier is the verdict's, not assumed (KEEPALIVE from the worker is the design that does not wait on the page).

**Should the server react?** *Theory:* asking again cannot help — "QUIC authenticates every byte, so the same bytes
come back" (`exactness-in-production.md` §2, R) — so the server's useful reaction is about **its store**: re-read the
frame and compare it with a digest of the coded bytes written at ingest. That digest is proposed, not built (§8,
*Locating the fault*: "if the coded bytes match, the decoder is at fault; if they don't, the store is"), and the
archives do the same on their side (Orthanc's `StoreMD5ForAttachments` and `/attachments/{name}/verify-md5`;
dcm4chee's `OBJECT_CHECKSUM`, as §8 quotes them). **Recommended, a proposal:** the receiver records and raises every
safety report; the server's re-check of the stored frame waits on the coded-bytes digest, a structural ingest change
for the owner; turning a route off per engine stays §Reporting's proposed rule, its thresholds the owner's. Nothing
here is measured.

## 6 · What this plan does not settle

The verdict between carriers and receivers (the run's); whether CBOR or compression pays at 5–7 KB (theory says not:
a tenth of the budget; the bytes cell decides); whether Gecko's keepalive survives a kill (§1.1); WebKit's `pagehide`
need (the ADR's (I), R); retention and the sink's host (the owner's). Fixtures, when run: the three demo DBT volumes,
4-core cloud hosts, headless engines, a userspace relay, not a radio; the phone cells on one phone.
