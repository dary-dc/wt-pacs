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

## 7 · Protocol

*Pre-registered 2026-11-15 by REPORT-PROTOCOL, a session that wrote, advocated and built nothing here, before any arm
is built. REPORT-RUN runs it as written; an amendment before any counted row if the host forces one, never after.*
Every prediction below is **theory** (I), from §1–§3's sources and the *measured* numbers they cite; none is a result.
The levers of §7.6 were **checked on the host** this protocol was written on (*checked*), each one once, by a scratch
probe that sent a beacon on `load`, `visibilitychange`, `pagehide`, `pageshow` and `freeze` to a local sink: lever
checks, not results.

### 7.1 · What enters from the advocates' proposals (for every arm alike)

| proposal | enters? | why |
| --- | --- | --- |
| serialize where the record is found; the carrier gets a string (§3.1) | **yes** | the same seam for all three carriers; the page-thread cell then prices the carrier, not the serializer's place |
| the format pilot at the fill's end, never in a hide handler (§3.1) | **yes** | a hide handler that awaits would charge the format to the carriers that send at hide |
| the hybrid with `seq` deltas, `pagehide` beside `visibilitychange`, one synchronous send per event (§3.1) | **yes**, for BEACON and KEEPALIVE (KEEPALIVE's advocate adopted it, §3.2) | SESSION's hide delta follows the same pair and `seq` (§3.3) |
| the workers' init carries the sink URL, load id, session id, decoder build, off switch (§3.2) | **yes** | needed by KEEPALIVE's worker send and SESSION's downloader alike |
| `reportId` and `v` in every record; one `report-fields.json` read by the page's test, RECEIVER and the server (§3.2, §3.3, §3.5) | **yes** | one list for the field mutant (§7.4) against every receiver |
| one sink contract, *one record in, one acknowledgement after the append*, HTTP and stream bindings, one set of counters (§3.3) | **yes** | the harness reads received, appended, acknowledged, refused and duplicate counts alike |
| **delivery is counted at the sink**, never by answers (§3.5) | **yes** | NGINX's `204` precedes its line; a beacon has no answer |
| the kind in the path, `<base>/load` and `<base>/safety` (§3.5) | **yes** | both HTTP receivers file by kind without parsing |
| the server as a third receiver row (§3.3) | **yes** | SESSION's receiver is the frame server; the receiver cell runs it while serving |
| the join and the dedup at read, by one tool, for every receiver (§3.5) | **yes** | no receiver gets a join the others lack |
| files by UTC day, retention by deleting (§3.5) | **yes** | same for both HTTP receivers; the server's report file the same |
| a delivery row for a session that never opens (§3.3) | **yes** | row D8 below |
| the page-thread cell counts the worker's report time beside it (§3.2) | **yes** | cell C below |
| RECEIVER's cap per day | **not a cell** | no lever fills a disk on this host without risk to the run; named for the verdict |
| NGINX's hop form on nginx 1.29 | **not run** unless the owner keeps 1.29 (§3.5): the early-read form on 1.31 is NGINX's arm |

### 7.2 · Rig, arms, order

* **Rig**: `lab/report-arms/` on `claude/report-arms` (REPORT-BUILD-HARNESS): the viewer at the round's commit with
  the lab gate loading one carrier arm; the fault bench's forced mismatch ([`../../adr/exactness-in-production.md`](../../adr/exactness-in-production.md)
  §The fault bench) at a fixed frame; the sink behind each receiver with the §7.1 counters; the server's link record
  (§3.4) on in every arm. The browser and the sink run inside the relay's `--tun` namespace (`lab/scripts/link_impair.py`,
  `unshare -rn`), so QUIC and the HTTP carriers' kernel TCP cross one queue: delay 10 ms one way, 50 Mbit, 200-packet
  queue, no loss (the home Wi-Fi fit's order, `docs/transport/transport-conclusions.md` §1; assumed for this cell, not a
  profile of `link-profiles.md`). One browser at a time; a fresh profile per load unless a row keeps one.
* **Series**: `dbts_c1`'s view (the shortest demo fill on this host), the mismatch forced at frame 10 of the fill.
* **Carrier arms** (§3's timings run): `off`, **BEACON-H** (at hidden: PR 370's build), **BEACON-Y** (the hybrid),
  **KEEPALIVE-H**, **KEEPALIVE-Y**, **SESSION-1** (at once, batched per second), **SESSION-Y**, **SESSION-H**, and
  `off′` (the A/A arm: `off` again). The safety report is *at once* in every carrier arm (KEEPALIVE: from the worker,
  and from the page at hide for any not acknowledged; §3.2); `off` sends no load report but **sends the safety
  report** by BEACON at once, as the decision requires it ignore the rate; `off′` the same.
* **Receivers**: BEACON and KEEPALIVE arms send to **RECEIVER** in the delivery cells (it counts and refuses; its
  fallback line is NGINX's); NGINX and RECEIVER are compared in cell R, and the server in cells R and D for SESSION.
* **Order**: Williams order per round (`lab/order.mjs`, `williams(9)`: odd, so 18 rows with the mirrors); each row
  carries its round, arm and predecessor, and `balanced()` is reported per cell. A cell's rounds are **one whole
  period, 18 rounds** for nine arms (cells D, L, C); cell R its own (§7.3).
* **The floor probe** runs beside every integrated run of cells L and C, in the same round, just before the arm: the
  raw call alone with the arm's bytes — a `sendBeacon` of the record string; a bare `fetch(…, {keepalive: true})` from
  the page and from a decoder worker; a bare `createBidirectionalStream()`, write, FIN and the server's one-byte ack.
  Recorded: median ms from call to the sink's append, and the page thread's time in the call. **The gap** = the arm's
  integrated cost − its floor.

### 7.3 · Cells, predictions, bars

**D · delivery, by how the load ends.** A load: open, fill, the forced mismatch at frame 10, three frame changes and
one *Lossless* press after the fill (the deltas), then the row's ending at fill end + 6 s, then 60 s of wait before
the sink is read. Recorded per load: the fill record, each delta (`seq`) and the safety report at the sink, or not;
duplicates by `reportId`.

| row | ending | lever (§7.6) |
| --- | --- | --- |
| D1 | navigated to another origin page | CDP `Page.navigate`; BiDi `browsingContext.navigate`; WebDriver Navigate To |
| D2 | tab closed, another tab open | CDP `Target.closeTarget`; BiDi `browsingContext.close`; WebDriver Close Window |
| D3 | hidden, then the renderer killed 1 s later | hide (§7.6), then CDP `Page.crash`; Firefox and WebKit: the tab's content process killed (unchecked) |
| D4 | hidden, then the browser killed 1 s later | hide, then `SIGKILL` of the browser process the rig spawned |
| D5 | killed while visible, 50 ms (D5a) and 500 ms (D5b) after the mismatch is found | as D3 without the hide |
| D6 | link dropped before hide: blackout from fill end + 4 s for 30 s, hidden at + 5 s, navigated at + 6 s | relay `blackout 30000`, `--blackout-mode drop`, both planes under `--tun` |
| D7 | bfcache: navigated away, back (restored from bfcache), one more frame change, then navigated | history back (§7.6) |
| D8 | the session never opens (the server's QUIC listener not started; nginx answers) | the harness's server flag (checked by its first smoke) |
| D9 | hidden and left: minimized, page kept 60 s (Chromium also frozen after 5 s) | hide; CDP `Page.setWebLifecycleState` `frozen` |

*Bars* (per engine × arm; an arm that cannot run a row on an engine is named and judged nowhere on it):
* **Safety report**: reaches the sink in **every** load of D1, D2, D4, D5b, D6 (sent before the blackout or held until
  acked on a live page: D6's mismatch is during the fill), D7, D8 (HTTP carriers; SESSION is *expected to fail D8*,
  and fails the bar), D9; D3 and D5a recorded, no bar. In `off` and `off′` too.
* **Load report**: the fill record reaches the sink in every load of D1, D2, D7, D9; D3–D6 and D8 have no bar and
  are **ranked**: the share of loads whose fill record arrives, then the share of deltas. No arm may deliver a record
  twice uncounted (the read tool's dedup counts it).
* `off` and `off′` deliver no load record in any row (one does: the harness is broken; every D row VOID).

*Predictions* (I; Chromium / Firefox; WebKit after them; "✓" every load, "✗" none):

| row | BEACON-H | BEACON-Y | KEEPALIVE-H | KEEPALIVE-Y | SESSION-1 | SESSION-Y | SESSION-H |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D1, D2 | ✓ (`pagehide` and hidden fire before the unload, *checked* on all three) | ✓ | ✓ | ✓ | fill ✓, last second's delta at risk | fill ✓, hide delta at risk | **at risk**: the hide record races the session's end (§3.3) |
| D3 | ✓ (sent at hide, held by the browser: Fetch §Requests) | ✓ | ✓ | ✓ | fill ✓; deltas sent ✓ | fill ✓; hide delta at risk | hide record at risk |
| D4 | ✓ if the send precedes the kill by the 1 s (I) | ✓ | ✓ | ✓ | as D3 | as D3 | as D3 |
| D5 | ✗ load report | fill ✓, deltas ✗ | ✗ | fill ✓, deltas ✗ | fill ✓, deltas up to the last second | fill ✓, deltas ✗ | ✗ |
| D5a safety | page hop: at risk | at risk | worker: Chromium **at risk** (the worker's request dies with it, §3.2), Firefox ✓ | as -H | decoder → downloader → stream: at risk | at risk | at risk |
| D6 | ✗ (a beacon failing on a dead link is not retried; I) | fill ✓, deltas ✗ | ✗ | fill ✓, deltas ✗ | fill ✓, deltas held, lost at navigation | fill ✓ | ✗ |
| D7 | ✓ on Firefox and Chromium; WebKit: ✓ (HTTP) | ✓, `seq` loses nothing | ✓ | ✓ | WebKit: the session ends at bfcache entry (§3.3), deltas wait a re-dial: at risk | as -1 | as -1 |
| D8 | ✓ | ✓ | ✓ | ✓ | **✗** | **✗** | **✗** |
| D9 | ✓ | ✓ | ✓ | ✓ | ✓ (session alive while hidden) | ✓ | ✓ unless frozen before the write (Chromium) |

**L · the safety report's latency.** Mismatch found (the decoder's timestamp, the host's monotonic clock) → record
appended at the sink. Page idle, and with a 50 ms long task every 100 ms on the page's main thread; for SESSION also
mid-fill (the mismatch at frame 10 of 32). 20 mismatches a load, 1 s apart, after the fill (and the mid-fill one).
*Bar*: p50 ≤ 250 ms and p99 ≤ 1 s idle in every round; busy is ranked (p99). *Predictions*: BEACON idle a few ms over
its floor (loopback plus the relay's 20 ms round trip), busy up to +50 ms (the page's long task); KEEPALIVE from the
worker unaffected by the busy page; SESSION unaffected by the page, mid-fill within a few ms of idle (I: a few hundred
bytes share the window, §3.3). Beacon §2.1's "MAY delay" is what this cell measures per engine.

**C · cost on the page's thread.** PR 370 §5's design: main-thread time of assemble + serialize + send per load, any
long task the arm adds (Long Tasks observer), the fill's time and the first exact paint, against `off` and `off′`; the
workers' report time beside it (§7.1). *Bar*: fill time and first exact paint median ratio to `off` within
0.98–1.02, and no long task ≥ 50 ms the arm adds, in ≥ 15 of 18 rounds. *Predictions*: every arm passes: a 5–7 KB
`JSON.stringify` and one call is well under a millisecond (I); KEEPALIVE adds a promise and a `Response` per send
(§3.2), within the bar.

**Y · bytes and requests per load.** From D1's loads (no extra loads): request or stream count, body bytes and wire
bytes per load at the relay (the TUN plane's per-flow tally), per arm and format; `sendBeacon` returning `false` and
keepalive network errors counted. *Bar*: no record refused by the 64 KiB budget, no body over 16 KiB; then ranked by
wire bytes. *Predictions*: JSON 4.9–6.6 KB a load (PR 370's test, R); the hybrids 2–4 requests a load; SESSION-1 the
most records and the fewest wire bytes per record (no request line or headers, §3.3); gzip saves under a fifth of the
wire bytes at these sizes (I) and so loses the pilot (§7.4).

**R · the receivers' cost.** A load generator on the host posts recorded D1 bodies at 10, 100 and 1 000 reports a
second for 60 s each, load reports and safety reports in separate bursts (only the latter pays `sync_data`), to
**NGINX** (early read, nginx 1.31.8 built from nginx.org's release tarball, reachable, checked), **RECEIVER** behind
the same nginx, and **the server** over report streams while it serves one `dbts_c1` fill. Recorded: CPU seconds and
peak RSS per 1 000 reports, refusals, lines written; for the server, the fill's time against the same fill with no
reports. Order: NGINX, RECEIVER, server, rotated over 6 rounds. *Bar*: at 100 a second, ≤ 5 % of one core and every
report written (counted refusals excepted); the server's fill time within 1.02 of its no-report fill. *Predictions*:
NGINX cheapest; RECEIVER about NGINX plus one local hop; the server passes at 100/s. Where the generator alone
reaches 3 cores, the rate is saturated and claims nothing.

### 7.4 · A/A, VOID, saturation, mutants, pilot

* **VOID**: cells C and L, when `off′` against `off` (C) or BEACON-H's floor against itself in alternate rounds (L)
  lies outside 0.95–1.05 in median over the cell's rounds. D's A/A is `off`/`off′` delivering identically (the safety
  report in every load, no load report).
* **Saturation**: a round whose host CPU (all cores, `/proc/stat`) exceeds 90 % during the fill is marked saturated
  and counted in no bar. The relay's own ceiling is 100 Mbit under `--tun` on a 4-core host (`docs/rig-limits.md` §3);
  this rig runs at 50.
* **Mutants**, each once per engine and arm before its cell's rows are believed (`--mutant` in the rig): *record never
  sent* (the carrier returns success and sends nothing): D1's fill record must fail; *safety report sampled* (the rate
  applied to it, rate 0.1): D's safety bar must fail; *a field outside the list*: RECEIVER and the server must drop it
  and warn, NGINX's read tool must flag it; *ack before write* (RECEIVER answers `204`, then drops the write): the
  sink's appended count must fall below its acknowledged count; *no `reportId`*: the read tool's dedup must report
  the duplicates KEEPALIVE's two copies make. A mutant not caught makes its cell VOID for that arm until the harness
  is fixed and the cell rerun whole.
* **Pilot**, not counted, Chromium then each engine before its counted rows: (1) the hybrid's first send at the fill's
  end or at the first exact paint — the one whose D5 fill-record share is higher over 3 rounds alternated (a b b a a
  b), a tie keeping the fill's end; (2) the format, JSON or gzip JSON (KEEPALIVE, SESSION, RECEIVER only; BEACON and
  NGINX take JSON, §3.1, §3.5): gzip only if it saves ≥ 25 % of wire bytes a load and C still passes; (3) SESSION's
  batching interval stays 1 s (§3.3; no alternative). Picks are committed as `lab/report-arms/pilot-<engine>.json`
  before the first counted row on that engine, then frozen. CBOR is sized offline from the same records by the
  harness, not run: no browser encodes it (§1.4).

### 7.5 · The rule, stated before any data

Per engine, over the non-VOID, unsaturated cells:

1. **A carrier arm passes** when it meets every bar of §7.3 in every counted row it ran. A row an engine cannot run (a
   lever or an API missing) is named and judges nothing.
2. **Among passers**, rank by D3–D6's fill-record share (summed over the rows), then L's busy p99, then Y's wire bytes;
   a lead counts at ≥ 5 points of share, ≥ 10 % of latency or bytes. All within: the arm with fewer hops on the page's
   thread leads.
3. **The safety report's carrier** is judged on its own: the arm with the most D5a deliveries among those passing the
   safety bar; this answers §5's "at once" with a carrier, and may differ from the load report's.
4. **Receivers**: NGINX and RECEIVER both passing R's bar, the verdict is RECEIVER's validation against NGINX's cost,
   for the owner (§3.5's trade); the server is judged only with SESSION.
5. **No passer**: the result goes to the owner as measured, every arm's gap over its floor beside its failed rows, for
   REPORT-VERDICT-REVIEW's loser's question (§4).

### 7.6 · Engines, levers and the host

Levers *checked* 2026-11-15 on a 4-vCPU cloud container, each once, against a local sink (not results):

* **Chromium 153.0.8010.12** (Playwright's `chromium-1243`), **driven by raw CDP**, not by a Playwright page: a
  Playwright page stayed *visible* when its window was minimized or another page brought to front, and history back
  never restored from bfcache (`pagehide` with `persisted` false), with `--disable-back-forward-cache` and the
  backgrounding flags removed and focus emulation off. Launched itself (`chrome --headless=new`) and driven over CDP:
  `Browser.setWindowBounds` `minimized` ("Set position and/or size of the browser window.") and `Target.activateTarget`
  of a second tab ("Activates (focuses) the target.") each fired `visibilitychange` to hidden; `Page.navigate` then
  `Page.navigateToHistoryEntry` gave `pagehide` persisted, `freeze`, hidden, visible and `pageshow` persisted;
  `Target.closeTarget` ("Closes the target.") fired `pagehide` and hidden; `Page.crash` ("Crashes renderer on the IO
  thread, generates minidumps.") ended the page visible or hidden; `Page.setWebLifecycleState` `frozen` fired `freeze`;
  `SIGKILL` of the spawned browser ended it. CDP pinned at ChromeDevTools/devtools-protocol `browser_protocol.json`
  sha256 `84092045efd5`.
* **Firefox 159.0** (Mozilla's release tarball), headless, **raw WebDriver BiDi** (`--remote-debugging-port`):
  `browsingContext.navigate` fired `pagehide` (persisted) and hidden; `browsingContext.traverseHistory` −1 restored
  from bfcache; a second tab by `browsingContext.create` and `browsingContext.activate` hid the first; a new *window*
  did not. `browsingContext.close` ("? promptUnload: bool .default false", BiDi sha256 `cf1ac60777bb`) of the **last**
  tab sent nothing at all, of a tab with another open fired `pagehide` and hidden: **D2 runs with a second tab open on
  every engine**. `about:crashcontent` navigated from BiDi did not crash the content process (the page still
  evaluated): **Firefox's renderer kill is not checked**; REPORT-BUILD-HARNESS checks a `SIGKILL` of the tab's content
  process, found in the spawned browser's own process tree, and D3, D5 do not run on Firefox until it works.
  `SIGKILL` of the spawned browser ended it.
* **WebKitGTK 2.52.6** (Ubuntu 24.04's `libwebkit2gtk-4.1-0` and `webkit2gtk-driver`, installed), `MiniBrowser
  --automation` under `xvfb-run` through WebKitWebDriver (with `--headless` the session never opened: 40 s, no
  answer): Navigate To fired `pagehide` (persisted) and hidden; Back restored from bfcache; Minimize Window hid the
  page (WebDriver: "invokes the window manager-specific “minimize” operation, if any", sha256 `ebfff0faac54`); New
  Window `type: tab` opened a window, so switching does not hide; Close Window with another open fired `pagehide` and
  hidden. **The WebProcess kill and the browser kill are not checked**: as Firefox's, REPORT-BUILD-HARNESS checks them
  first; D3–D5 do not run on WebKit until then. WebTransport in WebKitGTK is not probed: the run's first step on
  WebKit is an API probe (`WebTransport`, `sendBeacon`, `Request.keepalive`, `CompressionStream`); SESSION is "not run:
  <API>" where absent.
* **The link drop**: `link_impair.py --tun` inside `unshare -rn` (iproute2 installed for it), `blackout 3000` on the
  control port: a kernel-TCP `curl` through the TUN answered 200, then timed out during the blackout, then 200 again;
  Chromium ran inside the namespace and loaded a page over the TUN. Without `--tun` the TCP plane has no blackout
  (the relay's own docstring: "this plane shapes only: no loss, no blackout"), so D6 runs only under `--tun`. Firefox
  and WebKitGTK inside the namespace are not checked: the harness's first smoke. `Network.emulateNetworkConditions`
  offline (CDP) is Chromium-only and does not reach WebTransport's socket (I), so it is not the lever.
* **Order of work**, so a cut-short run leaves the most decided: Chromium (pilot, mutants, D, L, C with Y), Firefox
  the same, WebKitGTK (probe, D, L, C), then R once. Rows are pushed per cell as they land.
* **Host time** (*derived*): a D load ~75 s with its wait (D9 ~130 s); 9 arms × 18 rounds × 9 rows ≈ 3.5 host-hours an
  engine, L and C ~1.5, pilot and mutants ~1: ~6 host-hours an engine, ~1 for R, ~19 in all, one browser at a time.
  If REPORT-RUN is not done by 11-22 08:00, REPORT-VERDICT-REVIEW judges what is pushed (its brief).

### 7.7 · The phone cells

Written as asks into `claude/phone-protocol:docs/phone-rows/next-round.md` §4 *Report cells* (2026-11-15): delivery
when the screen locks, the app is switched, Chrome is force-stopped, and Wi-Fi drops, for the carrier arms that pass
D here, each ending scripted from the laptop over adb so the round stays one press (amendment 5). Only `am
force-stop` is sourced ("Force-stop everything associated with package.", developer.android.com/tools/adb, sha256
`c7f904f1100b`), and it is not the same as a swipe from recents (I); the other three levers are the phone session's
to source and check.

**Fixtures and their limits.** Nothing has run for this section but the lever checks above. It plans: a 4-vCPU cloud
container without a GPU; Chromium 153 (not the phone's 157), Firefox 159, WebKitGTK 2.52.6 under Xvfb (not Safari);
one DBT volume's view; a forced mismatch, not a real decoder fault; a userspace relay on loopback, not a radio; no
phone.

### 7.8 · Amendment before any counted row (REPORT-RUN, 2026-11-16)

Written by REPORT-RUN before its first row, at the rig `claude/report-arms` `bd1ac438` (re-review: no blocker open).
The rig, as built and reviewed, cannot run all of §7.2–§7.6; nothing below changes a bar, a prediction or the rule,
only what is run. Every gap is the build's (`lab/report-arms/README.md` §What is built), not the host's, so it is
named here and left for a build row, never patched by the run.

| §7 asks | run here | why |
| --- | --- | --- |
| Chromium, Firefox, WebKitGTK | **Chromium 153 only** | `run.mjs` drives Chromium by CDP alone; no BiDi or WebDriver driver is built, and neither engine's kill lever is checked |
| cells D, L, C, Y, R | **D only** | L, C, Y and R are not built (no latency or page-thread reading, no relay tally, no load generator) |
| D1–D9 | **D1, D2, D3, D4, D5a, D5b, D7, D8, D9**; D6 not run | the browser, sink and server inside `unshare -rn` behind `link_impair.py --tun` is not wired; the host has no iproute2 |
| the relay, 10 ms each way, 50 Mbit, 200 packets | **loopback, no relay** | as D6. Delivery (D) is the only cell run; the races a 20 ms round trip would widen (SESSION's hide record against the session's end, §3.3) are narrower here, so a SESSION delivery here is an upper bound on the relay's |
| `dbts_c1`'s view, the mismatch at frame 10 | **the contract's grey-16 frame ×32**, the mismatch at frame 10 (`fault=sample`) | the rig's own series; the demo volumes are not on the host. D's endings start from the fill's end, so a shorter fill moves nothing a D bar reads |
| pilot (1), the hybrid's first send | **the fill's end**, the protocol's tie | the first exact paint is not a timing the rig offers (`timing.js`) |
| pilot (2), JSON or gzip | **JSON for every arm** | gzip is not built (the review, §2) |
| pilot (3) | 1 s, as written | — |
| the receivers in D | BEACON and KEEPALIVE (and `off`'s safety beacon) to **RECEIVER behind nginx 1.31.8**; SESSION to the server | as §7.2 |
| the mutants, once per engine and arm | once per arm on D1, before the counted rows: *never sent*, *safety sampled*, *a field outside the list*, *no `reportId`*, *ack before write* (RECEIVER's `--mutant`; the server's `WTPACS_SESSION_REPORT_MUTANT`) | as §7.4 |
| host time, ~3.5 h for D an engine (§7.6) | **~3.2 h an ending, ~30 h for Chromium's nine** (`off` to `off′`: 9 units × 18 rounds = 162 loads an ending at ~70 s each, D9 ~130 s) | §7.6's figure is 9 × 18 × 9 = 1 458 loads at ~75 s ≈ 30 h, not 3.5 |

**Order of the endings**, so a run cut short leaves the most bars decided: D1, D2, D7, D9 (bars on both reports),
then D4, D5b, D8 (the safety bar), then D3, D5a (recorded, no bar). Each ending is one whole period, 18 rounds in
Williams order, `--wait 60`, rows pushed as they land. An ending cut short is rerun whole; its partial rows are kept,
marked, and counted in no bar.

## Results (REPORT-RUN, Chromium 153, from 2026-11-16)

Rows: `claude/report-arms:lab/report-arms/rows/` (`chromium-mutants.jsonl`, `chromium-<ending>.jsonl`, `cpu.log`
the host's all-core busy share every 5 s). Run as §7.8 amends; each ending is filled in here as it completes.

### The mutants (§7.4), once per arm on D1, before any counted row

| mutant | expected | seen | caught |
| --- | --- | --- | --- |
| *never sent* | D1's fill record fails | no fill record in 7/7 carrier arms; the safety report still arrived in each | yes, 7/7 |
| *safety sampled* (rate 0.1) | the safety bar fails | no safety report in 7/7 carrier arms; `off` delivered its one | yes, 7/7 carriers; `off` not (one load: the 1-in-10 draw, or the mutant not applied to `off`'s send; not told apart) |
| *a field outside the list* | RECEIVER and the server drop and warn | RECEIVER's `outside` counted every record of the 4 HTTP arms (10 of 10); the server's every record of the 3 SESSION arms (6 of 6); none reached a file | yes |
| *no `reportId`* | the read tool reports KEEPALIVE's duplicates | every record of the 7 arms read as `unkeyed` (1–3 a load); **no duplicate in KEEPALIVE's D1 loads to find**: the worker's copy was acknowledged, so the page sent none | partly: flagged, but D1 makes no second copy to dedup |
| *ack before write* | appended < acknowledged | RECEIVER 0 appended of 11 acknowledged (5 HTTP units); the server 0 of 3, 5, 6 (`WTPACS_SESSION_REPORT_MUTANT`) | yes |

No mutant left a cell VOID. Seen beside them, not a result: SESSION-H's D1 hide record missed in all 3
loads whose carrier was not mutated (*field outside*, *no `reportId`*, *safety sampled* rows), as §7.3 predicts ("at risk").

### D1 · navigated to another origin page (18 rounds, 162 loads, 2026-11-16 09:15–12:16 UTC)

Williams-balanced for every unit. Host CPU at most 18 % (5 s samples): no round saturated. Every load reached its fill.

| unit | fill record | hide delta | safety report | dup. | load bar | safety bar | against §7.3's prediction |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `off`, `off′` | 0/18, 0/18 | — | 18/18, 18/18 | 0 | (none sent: not VOID) | pass | as predicted; A/A identical |
| BEACON-H | 18/18 | — | 18/18 | 0 | pass | pass | ✓ as predicted |
| BEACON-Y | 18/18 | 18/18 | 18/18 | 0 | pass | pass | ✓ |
| KEEPALIVE-H | 18/18 | — | 18/18 | 0 | pass | pass | ✓ |
| KEEPALIVE-Y | 18/18 | 18/18 | 18/18 | 0 | pass | pass | ✓ |
| SESSION-1 | 18/18 | 18/18 | 18/18 | 0 | pass | pass | fill ✓; the last second's delta, "at risk", arrived every time |
| SESSION-Y | 18/18 | **0/18** | 18/18 | 0 | pass | pass | fill ✓; the hide delta, "at risk", lost every time |
| SESSION-H | **0/18** | — | 18/18 | 0 | **FAIL** | pass | "at risk": the hide record lost to the session's end in every load |

"Hide delta" counts records with `seq` ≥ 1. Measured on loopback (§7.8): SESSION's losses here would be no smaller
behind the relay's 20 ms round trip.

### D2 · tab closed, another tab open (18 rounds, 162 loads, 2026-11-17 05:21–08:21 UTC)

Run whole by a resumed session on a rebuilt host of the same make (4 vCPU, Chromium 153.0.8010.12, nginx 1.31.8); the
first session's 99 rows (11 rounds, 2026-11-16) are kept as `chromium-D2.partial-0521.jsonl`, counted in no bar, and
agree with every count below. Williams-balanced for every unit. Host CPU at most 14 % (5 s samples): no round
saturated. Every load reached its fill; no row errored.

| unit | fill record | hide delta | safety report | dup. | load bar | safety bar | against §7.3's prediction |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `off`, `off′` | 0/18, 0/18 | — | 18/18, 18/18 | 0 | (none sent: not VOID) | pass | as predicted; A/A identical |
| BEACON-H | 18/18 | — | 18/18 | 0 | pass | pass | ✓ |
| BEACON-Y | 18/18 | 18/18 | 18/18 | 0 | pass | pass | ✓ |
| KEEPALIVE-H | 18/18 | — | 18/18 | 0 | pass | pass | ✓ |
| KEEPALIVE-Y | 18/18 | 18/18 | 18/18 | 0 | pass | pass | ✓ |
| SESSION-1 | 18/18 | 18/18 | 18/18 | 0 | pass | pass | fill ✓; the last second's delta, "at risk", arrived every time |
| SESSION-Y | 18/18 | 18/18 | 18/18 | 0 | pass | pass | fill ✓; the hide delta, "at risk", arrived every time |
| SESSION-H | 18/18 | — | 18/18 | 0 | pass | pass | "at risk": the hide record arrived every time |

SESSION's hide records, lost in every D1 load (navigation), arrived in every D2 load (close). Why the two endings
differ is not measured here; it is not claimed. Loopback, as D1 (§7.8).

### D7 · bfcache: away, back, one more frame change, away (18 rounds, 162 loads, 2026-11-17 08:21–11:30 UTC)

Williams-balanced for every unit. Host CPU at most 16 % (5 s samples): no round saturated. Every load reached its
fill; no row errored.

| unit | fill record | deltas seen | safety report | dup. | load bar | safety bar | against §7.3's prediction |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `off`, `off′` | 0/18, 0/18 | — | 18/18, 18/18 | 0 | (none sent: not VOID) | pass | as predicted; A/A identical |
| BEACON-H | 18/18 | — | 18/18 | 0 | pass | pass | ✓ |
| BEACON-Y | 18/18 | `seq` 1 in 18/18; no `seq` 2 | 18/18 | 0 | pass | pass | fill ✓; "`seq` loses nothing" not shown (below) |
| KEEPALIVE-H | 18/18 | — | 18/18 | 0 | pass | pass | ✓ |
| KEEPALIVE-Y | 18/18 | `seq` 1 in 18/18; no `seq` 2 | 18/18 | 0 | pass | pass | as BEACON-Y |
| SESSION-1 | 18/18 | `seq` 1 in 18/18; no `seq` 2 | 18/18 | 0 | pass | pass | Chromium keeps the session (the risk was WebKit's) |
| SESSION-Y | 18/18 | **0/18** | 18/18 | 0 | pass | pass | as D1: the hide delta lost every time |
| SESSION-H | **1/18** | — | 18/18 | 0 | **FAIL** | pass | as D1: the hide record lost in 17 of 18 |

Every arm that delivered a delta delivered exactly `seq` 0 and 1, never a `seq` 2 from the second navigation. The
rows cannot tell a lost second delta from no delta to send: whether the frame press after the restore changes what
`load.delta()` returns is not recorded (`timing.js` sends a delta only when it is not empty). Not a bar; named for
REPORT-VERDICT-REVIEW. Loopback, as D1 (§7.8).

### D9 · hidden and left: minimized, frozen after 5 s, kept 60 s (18 rounds, 162 loads, 2026-11-17 11:30–17:12 UTC)

Williams-balanced for every unit. Host CPU at most 19 % (5 s samples): no round saturated. Every load reached its
fill; no row errored.

| unit | fill record | hide delta | safety report | dup. | load bar | safety bar | against §7.3's prediction |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `off`, `off′` | 0/18, 0/18 | — | 18/18, 18/18 | 0 | (none sent: not VOID) | pass | as predicted; A/A identical |
| BEACON-H | 18/18 | — | 18/18 | 0 | pass | pass | ✓ |
| BEACON-Y | 18/18 | 18/18 | 18/18 | 0 | pass | pass | ✓ |
| KEEPALIVE-H | 18/18 | — | 18/18 | 0 | pass | pass | ✓ |
| KEEPALIVE-Y | 18/18 | 18/18 | 18/18 | 0 | pass | pass | ✓ |
| SESSION-1 | 18/18 | 18/18 | 18/18 | 0 | pass | pass | ✓ (the session alive while hidden) |
| SESSION-Y | 18/18 | 18/18 | 18/18 | 0 | pass | pass | ✓ |
| SESSION-H | 18/18 | — | 18/18 | 0 | pass | pass | ✓: the hide record written before the freeze 5 s later, every time |

**The four bar-carrying endings done** (D1, D2, D7, D9; §7.8's order): every HTTP arm passes both bars in all of
them; SESSION-1 and SESSION-Y pass the load bar but SESSION-Y loses its hide delta whenever the page navigates (D1,
D7); SESSION-H fails the load bar on D1 and D7 (0/18, 1/18). Every unit, `off` and `off′` included, delivered the safety
report in all 72 of its loads over the four. Loopback, as D1 (§7.8).

### D4 · hidden, then the browser killed 1 s later (18 rounds, 162 loads, 2026-11-17 17:12–20:15 UTC)

Williams-balanced for every unit. Host CPU at most 15 % (5 s samples): no round saturated. Every load reached its
fill; no row errored. The container restarted once during this ending (about 18:00); the run's processes survived it
and no row was lost or repeated. D4 carries the safety bar; the load report is ranked, not barred (§7.3).

| unit | fill record | hide delta | safety report | dup. | safety bar | against §7.3's prediction |
| --- | --- | --- | --- | --- | --- | --- |
| `off`, `off′` | 0/18, 0/18 | — | 18/18, 18/18 | 0 | pass | as predicted; A/A identical |
| BEACON-H | 18/18 | — | 18/18 | 0 | pass | ✓: the send preceded the kill |
| BEACON-Y | 18/18 | 18/18 | 18/18 | 0 | pass | ✓ |
| KEEPALIVE-H | 18/18 | — | 18/18 | 0 | pass | ✓ |
| KEEPALIVE-Y | 18/18 | 18/18 | 18/18 | 0 | pass | ✓ |
| SESSION-1 | 18/18 | 18/18 | 18/18 | 0 | pass | ✓ |
| SESSION-Y | 18/18 | 18/18 | 18/18 | 0 | pass | ✓: the hide delta arrived every time |
| SESSION-H | 18/18 | — | 18/18 | 0 | pass | ✓: the hide record arrived every time |

Rank on D4 alone: every arm 18/18 fill records; the Y arms and SESSION-1 18/18 deltas. Nothing separates them here.
Loopback, as D1 (§7.8).

### D5b · renderer killed while visible, 500 ms after the mismatch is found (18 rounds, 162 loads, 2026-11-17 20:15–23:00 UTC)

Williams-balanced for every unit. Host CPU at most 14 % (5 s samples): no round saturated. Every load reached its
mismatch; no row errored. D5b carries the safety bar; the load report is ranked (§7.3). No frame was pressed in D5
(the kill comes from the mismatch, `run.mjs`), so no arm had a delta to send.

| unit | fill record | safety report | dup. | safety bar | against §7.3's prediction |
| --- | --- | --- | --- | --- | --- |
| `off`, `off′` | 0/18, 0/18 | 18/18, 18/18 | 0 | pass | as predicted; A/A identical |
| BEACON-H | 0/18 | 18/18 | 0 | pass | ✓ "✗ load report": no hide before the kill |
| BEACON-Y | 18/18 | 18/18 | 0 | pass | ✓ fill ✓ |
| KEEPALIVE-H | 0/18 | 18/18 | 0 | pass | ✓ ✗ |
| KEEPALIVE-Y | 18/18 | 18/18 | 0 | pass | ✓ fill ✓ |
| SESSION-1 | 18/18 | 18/18 | 0 | pass | ✓ fill ✓ |
| SESSION-Y | 18/18 | 18/18 | 0 | pass | ✓ fill ✓ |
| SESSION-H | 0/18 | 18/18 | 0 | pass | ✓ ✗ |

The fill record reached the sink in 18/18 for every at-once or hybrid arm, so the fill ended inside the 500 ms (the
rig's 32-frame grey series, §7.8; a `dbts_c1` fill would not). Rank on D5b: the four Y/1 arms 18/18, the H arms 0/18.
Loopback, as D1 (§7.8).

### D8 · the session never opens (18 rounds, 162 loads, 2026-11-18 05:21–08:37 UTC)

Run whole by a resumed session on a rebuilt host of the same make (4 vCPU, Chromium 153.0.8010.12, nginx 1.31.8); the
previous session's 111 rows (12–13 rounds, 2026-11-18) are kept as `chromium-D8.partial-0521.jsonl`, counted in no
bar, and agree with every count below. Williams-balanced for every unit. Host CPU at most 13 % (5 s samples): no round
saturated. No row errored. As the rig builds D8 (`run.mjs`), no series server is started and the page dials a closed
port; every load's state 6 s in was `error`, and the mismatch is the page's own (`forced=page`), so no fill record or
delta exists to send in any arm. D8 carries the safety bar (§7.3).

| unit | fill record | safety report | dup. | link line | safety bar | against §7.3's prediction |
| --- | --- | --- | --- | --- | --- | --- |
| `off`, `off′` | 0/18, 0/18 | 18/18, 18/18 | 0 | 0/18 | pass | as predicted; A/A identical |
| BEACON-H | 0/18 | 18/18 | 0 | 0/18 | pass | ✓ |
| BEACON-Y | 0/18 | 18/18 | 0 | 0/18 | pass | ✓ |
| KEEPALIVE-H | 0/18 | 18/18 | 0 | 0/18 | pass | ✓ |
| KEEPALIVE-Y | 0/18 | 18/18 | 0 | 0/18 | pass | ✓ |
| SESSION-1 | 0/18 | **0/18** | 0 | 0/18 | **FAIL** | ✓ "✗": expected to fail D8 |
| SESSION-Y | 0/18 | **0/18** | 0 | 0/18 | **FAIL** | ✓ "✗" |
| SESSION-H | 0/18 | **0/18** | 0 | 0/18 | **FAIL** | ✓ "✗" |

Every HTTP arm reached RECEIVER with the safety report while the session could not open; the SESSION arms, whose only
route is the session, delivered none, as §7.3 predicts. Loopback, as D1 (§7.8).

### D3 · hidden, then the renderer killed 1 s later (18 rounds, 162 loads, 2026-11-18 08:37–11:39 UTC)

Williams-balanced for every unit. Host CPU at most 14 % (5 s samples): no round saturated. Every load reached its
fill; no row errored. D3 is recorded with no bar; the load report is ranked (§7.3).

| unit | fill record | hide delta | safety report | dup. | against §7.3's prediction |
| --- | --- | --- | --- | --- | --- |
| `off`, `off′` | 0/18, 0/18 | — | 18/18, 18/18 | 0 | as predicted; A/A identical |
| BEACON-H | 18/18 | — | 18/18 | 0 | ✓ (sent at hide, before the kill) |
| BEACON-Y | 18/18 | 18/18 | 18/18 | 0 | ✓ |
| KEEPALIVE-H | 18/18 | — | 18/18 | 0 | ✓ |
| KEEPALIVE-Y | 18/18 | 18/18 | 18/18 | 0 | ✓ |
| SESSION-1 | 18/18 | 18/18 | 18/18 | 0 | ✓ fill ✓; deltas ✓ |
| SESSION-Y | 18/18 | 18/18 | 18/18 | 0 | fill ✓; the hide delta, "at risk", arrived every time |
| SESSION-H | 18/18 | — | 18/18 | 0 | the hide record, "at risk", arrived every time |

Rank on D3 alone: every arm 18/18 fill records; the Y arms and SESSION-1 18/18 deltas. Nothing separates them here.
As in D4, a hide followed 1 s later by the end leaves SESSION's hide record time to be written, unlike D1 and D7's
navigation. Loopback, as D1 (§7.8).
