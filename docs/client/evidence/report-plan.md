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
