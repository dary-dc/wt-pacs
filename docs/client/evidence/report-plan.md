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

**Advocate's amendments** (row REPORT-ADVOCATE-BEACON, 2026-11-14; a session that wrote none of this plan). Sources as
pinned in §0 (Beacon `0c740e09487a`, Fetch `478609e29799`, HTML lifecycle `1d594237e8b4`) plus BCD `api/Document.json`
at `69fcf3608174` (sha256 `6ab679037c7c`). Each change below replaces what it names; the rest of the design stands.

* **What a beacon is for, used** (*advocate*). Fetch §Requests: keepalive "can be used to allow the request to outlive
  the environment settings object, e.g., `navigator.sendBeacon()` …", and a fetch group's termination ends only the
  requests whose "keepalive is false". So **once `sendBeacon` returns `true` the record no longer depends on the page**:
  a page frozen, discarded or killed after the call still lets the browser send it (I: the kill cell checks it per
  engine). Every send is therefore one synchronous call in the event's own task, nothing awaited before it.
* **The hybrid is BEACON's design, the hide-once build its A arm** (*advocate*). The first beacon at the fill's end
  carries the bulk (`frames`, `routes`, the fill), so a page killed while visible after its fill still reports; each
  later hide sends only what changed since the last send (presses, labels, errors, `received`) with the load id and a
  `seq`, so a page hidden, shown again (bfcache's `pageshow`, a tab switched back) and hidden again loses nothing.
  This departs from the owner's 2026-11-11 brief for PR 370 ("one report per load, sent **once**, at the first hide";
  `telemetry-in-production.md` §8, R): it is proposed as an arm beside the build, the owner's to adopt.
* **`pagehide` beside `visibilitychange`** (*advocate*). HTML *unload a document*: "Fire a page transition event named
  pagehide at oldDocument's relevant global object with oldDocument's salvageable state. Update the visibility state of
  oldDocument to "hidden"." — both fire in a conforming engine, and "page showing … is used to ensure that scripts
  receive pageshow and pagehide events in a consistent manner (e.g., that they never receive two pagehide events in a
  row without an intervening pageshow …)". BCD's Safari entry until 14.1: "Doesn't fire the `visibilitychange` event
  when navigating away from a document, so also include code to check for the `pagehide` event (which does fire for
  that case in all current browsers)." One handler on both, keyed by `seq`, sends once per hide. Never `unload`: Beacon
  §1, "Developers should avoid relying on unload event", and an `unload` listener is no part of this design.
* **The body: a string, under budget by construction** (*advocate*). A string body extracts as "`text/plain;charset=UTF-8`"
  (Fetch §BodyInit extract), a CORS-safelisted type, so `no-cors` (Beacon §3) and no preflight; same origin, so
  `credentials mode include` sends only the viewer's own cookies (I: the viewer sets none; the bytes cell counts the
  headers). The budget is per fetch group and counts every keepalive body in flight ("If the sum of contentLength and
  inflightKeepaliveBytes is greater than 64 kibibytes, then return a network error", Fetch §HTTP-network-or-cache
  fetch); the viewer sends no other keepalive request (R: `git grep keepalive` on `claude/unified-client`'s `client/`
  is empty), so the reports are the whole budget. A `ReadableStream` body is refused ("If keepalive is true, then throw
  a TypeError", Fetch §BodyInit extract): any compression the pilot tries is done into a `Blob` before the send, at the
  fill's end, never in a hide handler.
* **A safety report never dropped while the page lives** (*advocate*). The plan's "at once" stands; added: failures
  found in one task go in one beacon (a decoder that breaks fails every frame, and N beacons of a few hundred bytes
  each would spend the budget the load report needs); it is sent before any load-report beacon of the same task; a
  `false` keeps it pending and resends on a 1 s timer and at the next hide, never truncated (I: the record is small, so
  a `false` means the budget is held by beacons still in flight, which drain).
* **The worker view's hop, made small** (*advocate*). `sendBeacon` is on `Navigator`, not `WorkerNavigator` (§1.1), so
  the view worker and the decoder workers post the record already serialized; the page's part is one `sendBeacon` call
  (I: its cost is the page-thread cell's floor).
* **Timings run**: the load report *at hidden* (PR 370's build, the A arm) and *the hybrid* (this design); the safety
  report *at once* in both. *At once* alone for the load report is not run: it is the hybrid without its hide sends,
  and loses every press after the fill.

**Disadvantages BEACON still carries** (*advocate*, for the protocol to price, not to fix):

* **Page thread only.** A safety report found in a worker waits for the page's next task; with long tasks on the page
  it waits for them (the latency cell with long tasks prices it).
* **No outcome.** Beacon §2.1.4: "this method does not provide any information whether the data transfer has
  succeeded or not." A record lost on the wire after `true` is invisible to the page; only the sink's counters see it.
* **The user agent may hold it.** Beacon §2.1: "The user agent MAY delay transmission of provided data to optimize
  network and energy efficiency … However, the user agent SHOULD NOT delay transmission indefinitely." "At once" is
  the page's call, not the send's; the latency cell measures what each engine does.
* **No headers.** "The sendBeacon() method does not provide ability to customize the request method, provide custom
  request headers" (Beacon §1): a compressed body cannot say `Content-Encoding`, so NGINX's log line cannot read it and
  compression with BEACON implies RECEIVER (or a marker in the URL the receiver reads).
* **Killed while visible before the fill's end** sends nothing in either timing, as for every carrier.

**What the shared parts cost BEACON** (*advocate*; proposed for every carrier alike):

* **Serialize where the record is found.** §3's "assembled where the values are" leaves open where it is serialized;
  for the worker view and the safety report, serializing in the worker and handing the carrier a string costs the page
  least under every carrier. Proposed as the seam's contract for all three.
* **The format pilot runs at the fill's end**, not at hide, for every carrier: a hide handler that awaits a
  `CompressionStream` may never resume in a frozen page (I), which would charge the format to whichever carrier sends
  at hide.

### 3.2 KEEPALIVE

* Same record and timings as BEACON, sent with `fetch(url, {method: "POST", keepalive: true, body})`.
* **Its own advantage, used**: it runs in a worker, so the safety report leaves **from the decoder worker that found
  the mismatch**, never waiting on the page's thread, and the response says it arrived (`204`), so a failed send can
  be retried once while the page lives (I). It keeps OpenTelemetry's accounting of the pending keepalive bytes and
  count (`fetch-transport.ts`) so the load report never starves a safety report of the 64 KiB.
* **Its own risk, named**: the RUM SDK's Firefox claim (§1.1) — the kill cell decides it.

**Advocate's amendments** (row REPORT-ADVOCATE-KEEPALIVE, 2026-11-14; a session that wrote none of this plan). Sources:
Fetch as pinned in §0 (`478609e29799`); HTML whatwg/html `0793d3d8544e` (`source`, sha256 `7fde2f1fad51`); Chromium
`319b309ea895` (`loader_factory_for_worker.cc` `9a150c80524a`, `loader_factory_for_frame.cc` `46917d60402a`,
`platform/loader/child_url_loader_factory_bundle.cc` `6ebf9c5c3e22`, `keep_alive_url_loader_service.h` `047a6405c879`,
`blink/common/features.cc` `e098b5147f94`, `dedicated_worker_host.cc` `fe550ea2a01b`); Gecko mozilla-firefox/firefox
`c72617c01649` (`dom/fetch/Fetch.cpp` `d50a4005025c`, `dom/fetch/FetchService.cpp` `47a2826abcc7`,
`StaticPrefList.yaml` `3f511c2677dd`); WebKit `6e6e3c0776f0` (`WorkerThreadableLoader.cpp` `623f6940bb57`). Each
change replaces what it names; the rest stands.

* **Where a keepalive outlives its sender, by engine** (*advocate*; this corrects "it runs in a worker" above as a
  delivery claim). The spec allows it: a request with keepalive set "can be used to allow the request to outlive the
  environment settings object" (Fetch §Requests), and a terminated fetch group ends only records whose "keepalive is
  false" (Fetch §Fetch groups); a dedicated worker is its own environment settings object. The engines differ:
  * *Chromium*, worker: "KeepAlive is not yet supported in web workers." (`loader_factory_for_worker.cc`, which passes
    `mojo::NullRemote()` as the handle). The path that outlives a renderer is the frame's: "Use
    |keep_alive_loader_factory_| to send the keepalive requests to the KeepAliveURLLoaderService in the browser
    process" (`child_url_loader_factory_bundle.cc`), whose factory "binds RenderFrameHostImpl-specific context with
    every receiver" and which "allows a request to continue even if a renderer unloads before completion"
    (`keep_alive_url_loader_service.h`), on by default (`BASE_FEATURE(kKeepAliveInBrowserMigration,
    base::FEATURE_ENABLED_BY_DEFAULT)`, `features.cc`); `dedicated_worker_host.cc` binds no keepalive factory (R: no
    `keepalive` in the file). **So on Chromium a worker's keepalive fetch is an ordinary fetch: it completes while the
    worker lives, and nothing says it outlives the worker** (I: the kill cell decides).
  * *Gecko*, page and worker: page "keepalive is set to true, route the request through PFetch" (`Fetch.cpp`), and a
    worker's goes to the parent the same way (`FetchChild::CreateForWorker`, with `dom.workers.pFetch.enabled: true`);
    on the worker's end "if keepalive is active and it is NOT user initiated Abort, then do not cancel the request"
    (`FetchService.cpp`). This contradicts, at today's Gecko, the RUM SDK's "fetch keepalive behaves like regular fetch
    on Firefox" (§1.1); the kill cell still decides it. Before Firefox 133 there is no keepalive (BCD
    `api.Request.keepalive` firefox "133").
  * *WebKit*, worker: the request is made on the document's loader through `WorkerThreadableLoader::MainThreadBridge`;
    whether it outlives the worker is not traced (I: the kill cell).
* **The safety report, from the worker at once and from the page at hide** (*advocate*). The decoder worker that
  finds the mismatch sends it at once with `keepalive` (the page is alive, so the worker is, on every engine) and posts
  the same serialized record to the page, which it must tell anyway (the frame blocked, the reader told). The page
  holds it as pending until the worker posts the `204`; at each hide it sends every pending safety report itself, by
  the page's keepalive, which on Chromium is the browser-held path above. A `reportId` (`crypto.randomUUID`) per
  record lets the receiver drop the second copy. A network error or a status other than `204` retries once after 1 s
  while the page lives (the response is what BEACON lacks: "this method does not provide any information whether the
  data transfer has succeeded", Beacon §2.1.4).
* **The load report, from the page only** (*advocate*). Its sends at hide go from the page's thread for the reason
  above; with BEACON's amendments adopted alike (the hybrid with `seq` deltas, `pagehide` beside `visibilitychange`,
  one synchronous call per send, nothing awaited before it). A hybrid's first send at the fill's end may retry on its
  response; a hide send never waits for one.
* **The budget is per sender** (*advocate*). Fetch counts "fetch records in group" of "httpRequest's client's fetch
  group" against "64 kibibytes", so a worker's safety reports do not draw on the page's budget; Gecko does not count
  a worker's at all past each request ("We do not limit the keepalive size per loadgroup(but instead per request)",
  `Fetch.cpp`) and caps keepalive requests at `dom.fetchKeepalive.request_limit_per_origin: 256` and
  `total_request_limit: 2048`. OpenTelemetry's byte and count accounting stays, on the page, where a pending safety
  report and the load report share one budget; the safety report goes first in a task, as in §3.1.
* **The body** (*advocate*). Same origin, so `application/json` needs no preflight (I: CORS applies to cross-origin
  requests only); a `ReadableStream` is refused ("If keepalive is true, then throw a TypeError", Fetch §BodyInit
  extract), so a compressed body is made into a `Blob` at the fill's end, as §3.1's shared proposal says. Unlike a
  beacon it can carry `Content-Encoding`, so compression with KEEPALIVE does not force RECEIVER by itself.
* **Timings run**: the load report *at hidden* (the A arm) and *the hybrid*; the safety report *at once from the
  worker, with the page's send at hide for any not confirmed*. *At once* alone for the load report is not run (§3.1's
  reason).

**Disadvantages KEEPALIVE still carries** (*advocate*, for the protocol to price):

* **On Chromium the worker's send dies with the worker** (source above): a page killed between the mismatch and the
  worker's `204` loses the report unless it reaches a hide; the delivery cell's *killed while visible* row prices it.
* **The hide send is on the page's thread**, as BEACON's is.
* **Two copies** of a safety report whenever the `204` is late; the receiver dedups by `reportId` (its cost is in the
  receiver cell).
* **Firefox before 133** sends an ordinary fetch, lost at unload (BCD).
* **A promise and a `Response` per send**, where a beacon returns a boolean (I: the page-thread cell's floor beside
  the arm prices it).
* **Chromium's nine-request cap** is second-hand (§1.4); not read in source here.

**What the shared parts cost KEEPALIVE** (*advocate*; proposed for every carrier alike):

* **The workers need the report's constants at start**: the sink URL, the load id, the session id, the decoder build,
  the off switch. Proposed: the decoder workers' init message carries them for all carriers (§3.1's serialize-in-worker
  proposal needs them too).
* **`reportId` in the field list** for every record, so the receivers dedup alike and the protocol's "a field outside
  the list" mutant is checked against a list that has it.
* **A `204` that means written**: the shared contract's `204` proves arrival only if the sink answers after the record
  is appended. RECEIVER can; NGINX logs at the request's end, after its `204` (I: the receiver cell checks it). Stated
  for both receivers alike.
* **The page-thread cell counts the worker's report time too**, beside it, so moving the send off the page is priced,
  not free.

### 3.3 SESSION

* A unidirectional stream opened on the series' WebTransport session for each record, one JSON object, then FIN; the
  server writes it beside its own link record and needs no second endpoint, no CORS, no nginx location.
* **Its own advantage, used**: the server can join the page's record with its `PathStats` without any key, since both
  are on one connection; the safety report can reach the code that could re-check the stored bytes (§5) directly.
* **Its own risk, named**: at hide the session may still be up (hidden is not unload), but at unload §Context cleanup
  terminates it, so the hide-time record races the end of the document; and a page frozen while hidden may not run
  the stream's write (I). The hybrid is its natural timing: the fill's record at once, a hide record best effort.
* A wire change (`docs/WIRE.md`, R): proposed as a lab arm only, the product wire unchanged until a verdict.

**Advocate's amendments** (row REPORT-ADVOCATE-SESSION, 2026-11-14; a session that wrote none of this plan). Sources:
WebTransport as pinned in §0 (`5287ff36f135`); WebTransport over HTTP/3,
https://www.ietf.org/archive/id/draft-ietf-webtrans-http3-17.txt (2 November 2026, sha256 `795eee1c2805`); HTML
whatwg/html `0793d3d8544e` (`source` `7fde2f1fad51`); Chromium `319b309ea895`
(`third_party/blink/renderer/modules/webtransport/web_transport.cc` `3301caefc9f2`,
`services/network/web_transport.cc` `48b6b2736a00`); Gecko mozilla-firefox/firefox `c72617c01649`
(`dom/webtransport/api/WebTransport.cpp` `5df654c2edc2`, `dom/webtransport/parent/WebTransportParent.cpp`
`7e910f793681`); WebKit `6e6e3c0776f0` (`Source/WebCore/Modules/webtransport/WebTransport.cpp` `41eb903c53a2`); BCD
`69fcf3608174` (`api/WebTransport.json` `445777319f61`, `api/WebTransportSendStream.json` `70673dc8232e`,
`api/SharedWorker.json` `4201fa655f63`). Code read on `claude/unified-client`. Each change replaces what it names; the
rest stands.

* **Where the session is, used** (*advocate*). The downloader, a dedicated worker, "owns the session"
  (`client/transport/downloader.js`, R), and it spawns the decoder workers itself (`new Worker(… "../decode/decoder.js"
  …)`, R), where a frame's XXH3 is compared (`client/decode/decoder.js`, R). **So the safety report goes decoder →
  its parent → a stream on the open session: no page thread on any engine**, and no dependence on a worker's keepalive,
  which Chromium does not hold past the worker (§3.2). The load report, assembled on the page (PR 370's `loadReport`,
  R), reaches the downloader by one `postMessage` of the serialized record (§3.1's shared proposal).
* **A bidirectional stream per record, acknowledged after the write** (*advocate*; this replaces "a unidirectional
  stream … then FIN"). WebTransport §WebTransportSendStream write: "The fulfillment of the promise returned from this
  algorithm … does **NOT** necessarily mean that the chunk is acked by the server [QUIC]. It may just mean that the
  chunk is appended to the buffer. To make sure that the chunk arrives at the server, the server needs to send an
  application-level acknowledgment message." So each record is one `createBidirectionalStream()`, the record, FIN; the
  server reads to FIN, appends it, then writes one byte and FIN. The ack is SESSION's outcome, where a beacon has none
  (Beacon §2.1.4), and it means *written*, which the shared `204` means only if the sink answers after the append
  (§3.2's shared proposal). Bidirectional, not unidirectional plus an ack on the control stream, so the record and its
  ack are one object and the control stream's framing (`docs/WIRE.md`, R) is untouched.
* **Held until acknowledged, across sessions** (*advocate*). The downloader keeps every record whose ack has not come
  and resends it on the session that replaces a dead or recycled one (its `resume` and `recycle`, R); the `reportId`
  of §3.2 lets the server drop a second copy. A record never waits on a re-dial it would not otherwise make: pending
  records ride the next session the load opens.
* **At once is SESSION's timing, not the hybrid** (*advocate*; this replaces "the hybrid is its natural timing"). A
  record here costs a stream on a warm connection, no request line, headers, CORS or second connection (I: the bytes
  cell counts it), so the reason the HTTP carriers batch — a request per event — does not hold. The load report goes
  as its first record at the fill's end and then as deltas (`seq`, §3.1) at most once a second while anything
  changed (presses, labels, errors, `received`); the hide send carries only the last second's delta. Every record
  sent at once and acknowledged is out of reach of what happens at hide; the hide delta is the only best-effort part.
  **Timings run**: *at once, batched per second* (this design), *the hybrid* (§3.1's, for comparison across carriers)
  and *at hidden* alone (the A arm the other carriers run); the safety report *at once* in all three.
* **The hide send, as short as it can be** (*advocate*). The page forwards visibility, `pageshow` and freeze to the
  downloader already (`downloader.js`: "The page's own triggers — visibility, pageshow, freeze/resume — are forwarded
  by consumer.js", R); on `visibilitychange` to hidden and on `pagehide` (§3.1's pair, keyed by `seq`) the page posts
  the delta first, before any other work of that task, and the downloader writes it in the message's own task, nothing
  awaited before the write. Not run: a `SharedWorker` with `extendedLifetime`, which HTML gives "extra time to perform
  its operations even after all of its owners have disappeared … for performing asynchronous work after page unload"
  (HTML, SharedWorkerOptions), to hold a report session past the page: BCD `options_extendedLifetime_parameter` chrome
  "148", firefox false, safari false, and Gecko's WebTransport says "TODO: Fix the shared and service worker use
  cases" (`WebTransport.cpp`). Named for later, Chromium-only, as `fetchLater()` is (§2).
* **The server stamps the link at receipt** (*advocate*). The record arrives on the connection whose `PathStats` the
  server holds (the lab sampler already takes that handle: `server.rs`, `crate::record::path::run(connection.quic_connection()…)`
  under the `telemetry` feature, R), so the appended line carries the path's `rtt`, `min_rtt`, `cwnd`, `lost_packets`
  at the record's arrival, with no join. Across a recycled or resumed session a load spans connections, so the load
  id of §3.4 is still the key between them: the joinless join holds per session, not per load.
* **The server's reaction, local** (*advocate*). The server knows which series a session serves (its asks, R), so a
  safety report can be appended with the server's own name for the series beside `sourceFingerprint` — no catalog
  lookup for the operator — and §5's re-check of the stored frame, once the coded-bytes digest exists, runs where the
  bytes are. Nothing of the series leaves the server.
* **Bounded on the server** (*advocate*). A record over 16 KiB resets the stream (as RECEIVER's cap, §3.5); at most
  one open report stream per session and a cap on records per session (the protocol sets it) so a client cannot spend
  the frame server's time; the report streams are read by a task apart from the frame pipeline, so a burst never
  waits in the fill's path.

**Disadvantages SESSION still carries** (*advocate*, for the protocol to price):

* **Nothing it sends outlives the document.** WebTransport-over-HTTP/3 §6: "Upon learning that the session has been
  terminated, the endpoint MUST reset the send side and abort reading on the receive side of all unidirectional and
  bidirectional streams associated with the session". Every engine terminates at the end: Chromium's network service
  on the renderer's disconnect, "For tab close scenario: Send explicit connection close frame to ensure proper
  termination before cleanup" (`services/network/web_transport.cc`, `Dispose`); Gecko on the actor's end,
  `CloseSessionForDestroyedActor()` (`WebTransportParent.cpp`, `ActorDestroy`); WebKit at bfcache entry, `if (why ==
  ReasonForSuspension::BackForwardCache) cleanupContext();` (`WebTransport.cpp`). There is no browser-held path like
  BEACON's keepalive: **a record not acknowledged when the page goes is lost**, so the delivery cell's *tab closed*,
  *navigated* and *killed while visible* rows decide SESSION, and its hide delta is best effort on every engine.
* **The spec does not yet define the end in a worker**, where our session is. WebTransport §Context cleanup steps:
  "Issue: This needs to be done in workers too. See #127 and whatwg/html#6731." A dedicated worker lives while its
  owner set is not empty (HTML §permissible worker); when the document goes, how long the downloader runs to write
  the hide delta is the engine's (I: the delivery cell, per engine).
* **Two hops at hide**: page → downloader → stream, against BEACON's one call. A busy downloader (dispatch, records)
  delays the write by its current task (I: the latency cell with a loaded downloader).
* **A load whose session never opens sends nothing**: a failed dial, a refused certificate, a blocked UDP path — the
  loads whose report says most. Its reports wait for a session that does not come. No fix inside the carrier; see the
  shared parts below.
* **The link and the report fail together.** A dropped link kills the session; records wait for the downloader's
  re-dial (`live()`, R), so a load ended during a drop loses them, where an HTTP carrier on another path (TCP to
  nginx) might not (I: the *link dropped before hide* row).
* **WebKit's bfcache ends the session** (above): after a `pageshow` with `persisted`, a hide delta waits for a
  re-dial. **Gecko keeps such a page out of bfcache** ("Don't let this document go into BFCache",
  `RemoveFromBFCacheSync()`, `WebTransport.cpp`) and Chromium only for a `no-store` page ("`kWebTransportSticky`: a
  sticky feature that will only disable BFCache for the page containing "Cache-Control: no-store" header",
  `web_transport.cc`). These are the session's costs, which the product pays anyway; SESSION makes the reports
  depend on them.
* **No send order on Chromium**: BCD `createUnidirectionalStream.options_sendOrder_parameter` and
  `WebTransportSendStream.sendOrder` chrome false (firefox "119"/"121", safari "26.4"). A record sent during a fill
  shares the window with the media streams, which "SHOULD divide bandwidth fairly" (§WebTransportSendStream write); a
  few hundred bytes, but a cost on the fill's path the HTTP carriers do not have on QUIC (I: the cost cell with a
  safety report mid-fill).
* **A wire change and a receiver in the frame server.** The server accepts a second kind of client bidi stream
  (today it accepts the control stream only, `server.rs`, R), so `docs/WIRE.md` gains a stream type; it parses JSON
  and checks the field list in Rust, a second implementation beside RECEIVER's; its log is a file the operator must
  keep apart from the server's own; and its CPU is the frame server's (the receiver cell runs it while serving).
* **Per-session stream limits not traced**: WebTransport-over-HTTP/3 §5.5.2: "The default value for the
  SETTINGS_WT_INITIAL_MAX_STREAMS_BIDI setting is "0", indicating that the endpoint needs to send WT_MAX_STREAMS
  capsules on each individual WebTransport session before its peer is allowed to create any bidirectional streams";
  whether the patched `wtransport` 0.7 and Chromium negotiate that draft's flow control is not read (I: the build's
  first smoke round).

**What the shared parts cost SESSION** (*advocate*; proposed for every carrier alike):

* **The sink contract is HTTP's.** "`POST <url>` with one JSON object, `204`" does not fit a stream. Proposed: the
  contract is *one record in, one acknowledgement after the append*, with two bindings, HTTP's `204` and the stream's
  byte, and one set of counters (received, appended, acknowledged, duplicates by `reportId`) the harness reads alike.
* **The receivers are a family SESSION is outside.** Its receiver is the frame server. Proposed: the receiver cell
  gains a third row, *the server*, measured while it serves a fill, beside NGINX and RECEIVER.
* **The field list, once.** One file both the JavaScript side and the Rust server read (the shared record's schema),
  so "a field outside the list" is one mutant against one list for every receiver.
* **A delivery row for a session that never opens** (a failed dial), for every carrier, so SESSION's blind spot is
  priced and the HTTP carriers' answer to it is counted, not assumed.

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

**NGINX's advocate's amendments** (row REPORT-ADVOCATE-NGINX, 2026-11-14; a session that wrote none of this plan).
Sources: nginx.org docs (Last-Modified 6 Nov 2026), sha256: `ngx_http_core_module` `7b9eb00d6842` and
`ngx_http_log_module` `65edd508b55a` (§0's pins), `ngx_http_proxy_module` `4cc11bb141ae`, `ngx_http_upstream_module`
`a3484807ee1d`, `ngx_http_limit_req_module` `d8443a6d94ed`, `ngx_core_module` `539e8520f03b`, `control` `327a6c437c3b`;
nginx source at `release-1.29.8` `5eaf45f11e85` (the product image's line, `nginx:1.29-alpine`, R) and `release-1.31.8`
`140aa9427118`; nginx/docker-nginx `d99174e2cecf` (`mainline/alpine/Dockerfile` `66cae13710da`); nginx/pkg-oss `743c6b8d8e16`. **Checked here** on
a local nginx 1.24.0 (Ubuntu's package, not the image's 1.29; one host, loopback, curl): marked *(checked)*. Each change
replaces what it names; the rest stands.

* **The body is logged as a JSON string, not spliced in** (*advocate*; corrects the design's
  `'{"t":"$time_iso8601","r":$request_body}'`). Log module: "For json escaping, all characters not allowed in JSON
  strings will be escaped: characters “"” and “\” are escaped as “\"” and “\\”" — so the spliced body's own quotes
  are escaped and the line is not JSON *(checked: `{"t":…,"r":{\"v\":1,…}}`, a parser refuses it)*. The line is
  `log_format report escape=json '{"t":"$time_iso8601","s":"$status","n":"$content_length","r":"$request_body"}';`
  *(checked: parses, and `r` parses again to the record)*. `n` beside `r` makes a body nginx did not keep visible: the
  variable is `not_found` when "r->request_body->temp_file" (`ngx_http_variables.c`), and json escaping then writes
  nothing (`ngx_http_log_json_variable`: "return buf;"), so the line reads `"n":"12011","r":""` *(checked)*. Never
  `escape=none` (1.13.10, "disables escaping"): a body with a newline would forge a second line.
* **The body read with no second request, where nginx allows it** (*advocate*). Core, `client_body_early_read`: "This
  directive appeared in version 1.31.5. Enables reading of the client request body immediately after the request
  headers are received, using the request body read settings from the server block", whose example is
  `return 200 $request_body;`. Every protocol reaches it: HTTP/2 and HTTP/3 call `ngx_http_process_request`
  (`v2/ngx_http_v2.c`, `v3/ngx_http_v3_request.c`, 1.31.8), which calls `ngx_http_read_early_body`. So the arm is
  `map "$request_method $uri" $report_early { "POST /report/load" 1; "POST /report/safety" 1; }`,
  `client_body_early_read $report_early;` in the server, and `location = /report/load { return 204; access_log …; }`.
  It needs **nginx ≥ 1.31.5**: the arm runs on `nginx:1.31-alpine` (docker-nginx: "FROM nginx:1.31.8-alpine-slim"), the
  product image stays on 1.29 until a verdict (the owner's). **On 1.29, the hop**, made cheap: without early read a
  `return` discards the body (`ngx_http_send_response` calls `ngx_http_discard_request_body`, 1.29.8 *(checked:
  `"r":""`)*); `proxy_pass` reads it whatever is passed on — `ngx_http_proxy_handler` calls
  `ngx_http_read_client_request_body` unconditionally, `proxy_pass_request_body` only decides whether "the original
  request body is passed to the proxied server" — so `proxy_pass_request_body off; proxy_set_header Content-Length "";`
  to an `upstream` with one local `server` answering `return 204` with `access_log off`; "Since 1.29.7, keepalive
  connections are enabled by default" (upstream module), so the hop reuses its connection (I: the image's patch level
  is fixed by its digest and not read here) *(checked on 1.24: `204`, the body logged)*. The protocol runs the
  early-read form as NGINX; the hop is a second arm only if the owner keeps 1.29.
* **The body in one memory buffer, by construction** (*advocate*). Core: `client_body_buffer_size` "In case the request
  body is larger than the buffer, the whole body or only its part is written to a temporary file", and
  `client_body_in_single_buffer`: "The directive is recommended when using the $request_body variable, to save the
  number of copy operations involved." So `client_max_body_size 16k; client_body_buffer_size 16k;
  client_body_in_single_buffer on;` in the server block (early read uses the server's settings; the viewer's other
  locations take no body, R). A body over 16 KiB is refused before it is read: "client intended to send too large
  body" and `413` (1.31.8 `ngx_http_read_early_body`; *(checked: `413`)*).
* **One file per kind, one line per request, written at once** (*advocate*). `/report/load` and `/report/safety` each
  with their own `access_log`, so an empty safety file means no safety report and an operator can watch that one file
  (proposed for every receiver below). No `buffer=`: "If either the buffer or gzip parameter is used, writes to log
  will be buffered", flushed only when full, after `flush=`, or on reopen; unbuffered, each line is one `write` on a
  file opened `NGX_FILE_APPEND` (`ngx_cycle.c`). A day per file without a rotation signal: `access_log
  /var/log/report/load-$report_day.jsonl report;` with `$report_day` mapped from `$time_iso8601`, which the docs allow
  at a cost ("the file is opened and closed for each log write"; `open_log_file_cache` keeps the descriptor), against
  one file renamed and `USR1` ("re-opening log files", control) from outside the container. The pilot picks one; both
  leave retention to deleting old files, the owner's.
* **No address in the access line, and only the report's location logs** (*advocate*). An `access_log` in the location
  replaces the inherited one *(checked: no line in the default log)*; nginx's packaged `nginx.conf` logs `main`, which starts
  `'$remote_addr - $remote_user …'` (nginx/pkg-oss `743c6b8d8e16` `rpm/SOURCES/nginx.conf` `4dee6b0c7c82`; the Alpine
  package's own not read, I), so a report location without its own `access_log` would log
  the address to stdout.
* **POST only, and a limit on load reports, not on safety reports** (*advocate*). `limit_except POST { deny all; }`;
  `limit_req_zone $binary_remote_addr zone=report:1m rate=10r/s;` with `limit_req zone=report burst=20 nodelay;
  limit_req_status 429;` on `/report/load` only ("Excessive requests are delayed until their number exceeds the
  maximum burst size in which case the request is terminated with an error"). A page's own sends are bounded by the
  64 KiB keepalive budget (Fetch, §1.1), so the limit stops other clients, not the viewer (I: the bytes cell checks no
  counted load is refused). The key lives in shared memory, not in the log (I). The safety location takes only the
  size limit: a flood there is a false alarm, a limit there is a lost report.
* **JSON text only** (*advocate*). nginx cannot decode a compressed request body (no module in the docs read does),
  and json escaping passes bytes above 0x7f through (`ngx_escape_json` escapes only `\`, `"` and bytes ≤ 0x1f), so a
  non-UTF-8 body writes a line strict parsers refuse *(checked: `UnicodeDecodeError`)*. Every carrier's string body is
  UTF-8 by Fetch's extract (§3.1), so NGINX runs the format pilot's JSON only; compression stays RECEIVER's setting.
* **Validation stays out of nginx.** The stock image ships njs ("nginx-module-njs", docker-nginx `mainline/alpine`), and
  `js_content` could parse the body in the worker; that is a receiver in nginx's process, left to RECEIVER's advocate,
  not taken here.

**Disadvantages NGINX still carries** (*advocate*, for the protocol to price):

* **Unvalidated and unauthenticated.** A malformed or forged record is a line; anyone who can reach the origin can
  write one (a forged safety report included). The reader validates, dedups by `reportId` and joins the link record by
  load id offline (I: a script, its cost outside the receiver cell).
* **The `204` precedes the line.** `ngx_http_free_request` calls `ngx_http_log_request` after the response
  (`ngx_http_request.c`, 1.29.8); a failed write is only an error-log line (`ngx_write_fd_n " to \"%s\" failed"`,
  `ngx_http_log_module.c`) and a short one an "incomplete" line. The sink counts lines, never `204`s.
* **The error log names the client.** Rejections are logged with "client: <address>" *(checked, `413`)*; the error
  log has no format to drop it (core `error_log`: a file, a level, `json`). Shared with RECEIVER, which sits behind
  the same nginx.
* **No raising at once**: a safety report is a line in a file; an alert needs a watcher outside nginx (I).
* **The reader parses twice** (`r` is a string), and a line can be up to six bytes per body byte (`\u00XX`).
* **The early read needs mainline ≥ 1.31.5**; on the product's 1.29 the hop costs a second, local request per report.
* **16 KiB a record**, refused above: a coalesced safety report must stay under it (§3.1's coalescing; I: its fields
  are a few hundred bytes a frame).

**What the shared parts cost NGINX** (*advocate*; proposed for every receiver alike):

* **The kind in the path**, `POST <base>/load` and `POST <base>/safety`, so either receiver routes and files by kind
  without parsing; the carriers' URL is one constant per kind.
* **A `204` is judged by what reaches the sink, for both receivers.** NGINX's `204` precedes its line (above); RECEIVER's
  follows its write (RECEIVER's amendments below). So the delivery cell counts records at the sink, never answers, and
  KEEPALIVE's retry on a missing `204` (§3.2) is priced per receiver, worth more behind RECEIVER: neither arm is judged
  by its answer.
* **Files by UTC day for both, no rotation signal**: RECEIVER's `<kind>-<date>.jsonl`; NGINX's the variable path above
  (which answers RECEIVER's "nginx's log needs the deployment's `USR1`"), so retention is deleting old files for both.
* **A cap per day is RECEIVER's alone**: NGINX caps a body and, with `limit_req`, a client's rate, not a day's bytes;
  the protocol's disk-full row (if any) says so.
* **A schema version `v` and `reportId` inside every record**, checked by RECEIVER at once and by NGINX's reader later,
  so the "field outside the list" mutant is caught by both, at different times; the protocol says when it counts.
* **The receiver-cost cell runs both receivers at the same body bytes and kinds**, nginx's JSON escaping and its line
  writes priced against RECEIVER's parse and append, and names where the host saturates.

* **RECEIVER**: the dev sink's shape grown up (PR 370's `dev-server.py --beacon`, R): parse, check the schema
  version and the field list, refuse a body over 16 KiB, append a JSON line, join the server's link record by load
  id, and for a safety report raise it at once (a log at error level the operator watches; I). The advocate may make
  it an OpenTelemetry Collector instead, if that is cheaper to run and keeps the fields.

**RECEIVER, the advocate's amendments** (row REPORT-ADVOCATE-RECEIVER, 2026-11-14; a session that wrote none of this
plan and none of NGINX's amendments). Sources fetched 2026-11-14, sha256 of the file as fetched: nginx
`ngx_http_proxy_module.html` `4cc11bb141ae`, `ngx_http_log_module.html` `65edd508b55a` and `ngx_http_core_module.html`
`7b9eb00d6842` (§0's pins); OpenTelemetry Collector contrib `e0e1cb6463e1` (`receiver/webhookeventreceiver/README.md`
`6cc2a1c8e49b`, `exporter/fileexporter/README.md` `f9c508865bab`), Collector core `71b5f8c06cae`
(`receiver/otlpreceiver/README.md` `1d036c6d7a2d`, `docs/component-stability.md` `bdc4b4a526f0`), opentelemetry-proto
`94f2f2d5f39c` (`docs/specification.md` `59a8e654a120`); CPython `42155a0feaca` (3.13, `Doc/library/http.server.rst`
`c93d2a653768`); Rust 1.97 `std::fs::File` (`a0344655479c`); `httparse` 1.10.1 (docs.rs); DICOM PS3.5 2026d chapter 9
(`b37ac51a547b`). Each change replaces what it names; the rest stands.

* **Its own process, not the Collector** (*advocate*; this settles the plan's "may make it an OpenTelemetry Collector
  instead"). The Collector takes our object only through the webhook receiver, which "does not attempt to marshal the
  body into a structured format as it is received" and makes "a single log record with the entire request body as the
  "body" of that record" (`webhookeventreceiver`, stability "beta: logs"); its OTLP receiver wants another body, "the
  serialization format needs to be OTLP JSON" (`otlpreceiver`), whose "keys of JSON objects are field names converted
  to lowerCamelCase" (OTLP specification), which the page would have to build. Its file exporter is "alpha: traces,
  metrics, logs" and buffers ("`flush_interval`[default: 1s]", `fileexporter`), so its `204` does not mean written.
  The field check, the join and the raise would be OTTL in a transform processor: configuration to keep true where
  RECEIVER is code with tests. **The Collector stays a forward target** an operator may put after RECEIVER's file,
  not RECEIVER.
* **In Rust, in the workspace, from crates already in `Cargo.lock`** (*advocate*). `tokio` (workspace), `serde_json`
  1.0.151 and `httparse` 1.10.1 ("A push library for parsing HTTP/1.", already pulled in by the WebSocket path) are
  locked (R: `Cargo.lock` on this branch): no new crate, no new base image — it runs in the server's
  `debian:bookworm-slim` image as a third compose service on the internal network, never published. Python's
  `http.server`, the dev sink's base, is refused for this by its own documentation: "`http.server` is not recommended
  for production. It only implements basic security checks." and no Python is in either deployed image (R:
  `deploy/Containerfile`, `server` from `debian:bookworm-slim`, `web` from `nginx:1.29-alpine`).
* **nginx in front does the HTTP a parser should not** (*advocate*). `location = /report { proxy_pass
  http://report:<port>; }` beside the viewer, so same origin and the CSP unchanged (§1.5). With the default
  `proxy_request_buffering on`, "the entire request body is read from the client before sending the request to a
  proxied server" (nginx proxy), and `client_max_body_size` 16 KiB answers 413 before RECEIVER sees a byte (§1.5): a
  slow or oversize client is nginx's, RECEIVER reads one whole, bounded request from one trusted peer, one per
  connection (nginx keeps no upstream connection open without an `upstream` block's `keepalive`; I). `proxy_http_version`
  is set to 1.1 explicitly ("Since 1.29.7, version 1.1 is used by default. Before 1.29.7, version 1.0 was used by
  default.", nginx proxy) so the image's patch release changes nothing.
* **A record it cannot keep is still kept** (*advocate*). RECEIVER down is a 502 at nginx, and a beacon never sees it
  (Beacon §2.1.4, §3.1). The same location logs the body, by NGINX's own line, **only when the answer is not 2xx**:
  "The if parameter (1.7.0) enables conditional logging. A request will not be logged if the condition evaluates to
  "0" or an empty string." with the log module's own `map $status $loggable { ~^[23] 0; default 1; }`. Up, it costs
  nothing; down, the records land unvalidated in `report-fallback.log`, which the read-time tool below reads too. This
  makes NGINX RECEIVER's fallback; both arms are built and measured as the plan has them.
* **The check, defined once** (*advocate*). The field list is PR 370 §8's table plus the safety report's
  (`exactness-in-production.md` §5) and `reportId`, `seq` (§3.1–§3.2), as one file, `report-fields.json`, read by
  the page's test and by RECEIVER alike. A field outside it is **dropped before the write**, the record kept, and one
  warning names the field (never its value): the protocol's mutant is detected and the value never reaches the disk.
  A body that is not one JSON object is a 400 and a counted refusal, never a line. Every string is capped at 512
  bytes, and in `errors[].message` a run shaped like a UID is replaced by `<uid>`: "Each component of a UID is a
  number and shall consist of one or more digits. The first digit of each component shall not be zero unless the
  component is a single digit." and a UID "shall not exceed 64 total characters" (PS3.5 §9.1), so
  `[0-2](\.(0|[1-9][0-9]*)){3,}` up to 64 characters (I: four or more components; a version string like `1.2.3`
  stays). This is the one field that is free text (§8: "`message` with every URL replaced by `<url>`"), and the only
  place a receiver can stand behind the "no patient data" constraint of §2 rather than trust the page.
* **`204` means written, and for a safety report written to the disk** (*advocate*; the shared proposal of §3.2,
  "A `204` that means written", answered for RECEIVER). One task owns the files; a record is appended as one line by
  one `write` and only then is `204` sent. A safety report is also `sync_data`'d first, "intended for use cases that
  must synchronize content, but don't need the metadata on disk" (Rust `File`); a load report is not (I: the page
  cache's loss on a host crash is accepted for a sampled record, not for an always-on one).
* **The join at read, not at write** (*advocate*; this replaces "join the server's link record by load id"). The
  server writes its link line at session end (§3.4), which may come after the page's hide record and is in another
  process; a write-time join would hold records in memory waiting for their partner and lose them at a restart.
  Instead the server's line goes to `link-<UTC date>.jsonl` on the same `reports` volume, and one read-time tool
  joins by `load` and drops second copies by `reportId` (§3.2's duplicates) exactly, across restarts. **Proposed for
  NGINX alike**: the same tool reads its log, so the join and the dedup are no arm's advantage.
* **Files by UTC day, kept by deleting** (*advocate*). `reports-<date>.jsonl`, `safety-<date>.jsonl`: retention (30
  days, the ADR's default, the owner's call) is deleting old files; no signal, no reopen, no rotation tool, where
  nginx's log needs the deployment's `USR1` (I). The safety file is apart so its retention and its readers can differ.
* **The raise** (*advocate*). A safety report is written to its file first, then one error-level line on stderr (the
  container's log, which the operator's own alerting reads; I) with `reportId`, `source`, the frame index, the route
  and the engine — no digest, no message. Nothing else is done with it here: the server's re-check of its stored
  bytes is §5's proposal and waits on the coded-bytes digest.
* **A disk that cannot be filled by load reports** (*advocate*). The endpoint is open to anyone who can load the
  page. RECEIVER keeps a byte count per UTC day and past a cap (the deployment's; default 1 GiB, I) stops writing
  load reports, answering `204` and counting what it dropped; **safety reports are never capped**. NGINX can only
  cap the body, not the day.
* **What RECEIVER is, in size** (*I*, for the build row): one `main.rs`, an accept loop, `httparse` on the head,
  `Content-Length` bytes of body, `serde_json::Value`, the check, the write, the answer — about 150 lines and a test
  per refusal (oversize, not JSON, a field outside the list, a UID in a message, the cap, the fallback log on 502).
  In the arms it is `lab/report-arms/receiver/`, never `server/` (§4).

**Disadvantages RECEIVER still carries** (*advocate*, for the protocol to price, not to fix):

* **A process to run.** A service in `deploy/compose.yml`, its health check, its restarts and its upgrades; NGINX
  adds a `location` to a process that already runs. The receiver cell's memory and CPU per 1 000 reports price it
  (I: idle RSS of a tokio binary is small, but not zero, and is measured, not assumed).
* **A second hop.** nginx → RECEIVER over the container network per record: a connect, a request, a response, where
  NGINX writes in-process. Its latency is in the safety report's latency cell, its CPU in the receiver cell.
* **A safety report's `sync_data`** on every one: one disk flush per failure (near zero in count, §5, but its latency
  is on the path of the `204` that KEEPALIVE's retry waits for).
* **The field list is a third thing to keep true**, beside the page's code and the ADR's table: `report-fields.json`
  makes it one file, but a field added to the page without it is dropped at the receiver until the file is updated
  (a test on the page side checks the file; I).
* **Dropping a field, not the record**, means a lab field reaching production is lost silently but for the warning
  (the warning is the only signal; the protocol's mutant checks it is emitted).
* **The UID scrub is a heuristic**: it catches UID-shaped runs, not a name or an accession number in a message. The
  page's URL scrub (§8) and §2's field list remain the bound; RECEIVER's is a second line, not a proof.
* **The fallback log is unvalidated**: while RECEIVER is down, a field outside the list does reach the disk, in
  `report-fallback.log`. Removing the fallback removes the exposure and loses the records instead; the owner's
  trade, stated.
* **The read-time join is a tool to run** before any answer; an operator reading the raw files sees duplicates and
  unjoined link lines.
* **Cross-origin is out**: RECEIVER behind the same nginx keeps `connect-src 'self'`; a receiver anywhere else (an
  outside collector, §2) needs the CSP changed and CORS, and is not this design.
* **No compression gain of its own at these sizes.** RECEIVER is what can take a gzip body (BEACON cannot say
  `Content-Encoding`, §3.1; a URL marker would be needed), and it must cap the inflated size too (I); at 5–7 KB a
  load (§1.4) theory says it does not pay, so this advantage is likely unused.

**What the shared parts cost RECEIVER** (*advocate*; proposed for both receivers alike):

* **The join and the dedup at read** for both (above), so the comparison is not RECEIVER's write-time join against
  NGINX's none.
* **The fallback line on non-2xx** is NGINX's design reused; if NGINX's advocate changes its `log_format`, the
  fallback takes it unchanged.
* **The receiver cell runs both behind the same nginx**, so RECEIVER's cost is its hop and its process, not nginx
  counted twice; and it runs a burst of safety reports apart from one of load reports, since only the first pays
  `sync_data`.
* **The sink's counters count refusals** (400, 413, the cap's drops, the dropped fields) as well as lines, for both,
  so a receiver that refuses more does not look as if it delivered less.

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
