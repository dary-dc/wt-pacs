# Which client results hold in which engine

**The question:** for every result the client stands on, decided or measured, does it hold in Chromium, Firefox,
Safari on macOS and Safari on iOS, and how is that known: the engine's own source or document, a run the cloud can
make, or only a device? This is the `engines` question's matrix (`claude/work-ledger:docs/queue-2026-11-14.md`
§Engines, row ENGINE-MATRIX); ENGINE-SMOKE runs its cloud cells, ENGINE-REVIEW checks it, ENGINES-PAGE decides.

*Written 2026-11-19. Nothing run for this file. Engine sources read at Chromium `fb1f1ab4ba16`, WebKit `4c0a9cbebc3d`,
Gecko (mozilla-firefox/firefox) `d5236b1340fb`, all `main` on 2026-11-19; browser-compat-data (BCD, MDN's record of
release notes, a secondary source) at `70a51a128b3f`. The decode rows lean on two files already sourced at their own
pins, [`../client/evidence/browser-decode-routes.md`](../client/evidence/browser-decode-routes.md) and
[`../client/evidence/browser-av1-profile-support.md`](../client/evidence/browser-av1-profile-support.md), and repeat
none of their reading. Every quote is in §Sources, numbered E1–E26.*

## The matrix

**S** the engine's own source or document says so (quoted, §Sources); **M** measured here, at the version named;
**C** the cloud can run it (command in §Cloud cells); **D** only a device decides it; (U) not found in a source. *Theory* and *derived* as in
`CLAUDE.md` §Measurement. Chromium includes Chrome for Android unless a cell says otherwise; Firefox is desktop, its
Android noted. Every iOS browser is WebKit outside the EU and Japan
([`browser-decode-routes.md`](../client/evidence/browser-decode-routes.md) §Engine by engine).

| # | result the client stands on | Chromium | Firefox | Safari, macOS | Safari, iOS |
| --- | --- | --- | --- | --- | --- |
| 1 | The view's AV1 decoded by WebCodecs, exact samples at ≤ 10 bits, chosen by a per-layout probe | **M** exact, 141 headless, software; **S** dav1d on every platform, 4:0:0 as `I420` with mid-grey chroma (E24); Android hardware frames RGB (E24); **C** 1 | **S** `VideoDecoder` on desktop, not on Android release (E19); **M** 0/240 on 157 (monochrome refused, `BGRX`); **S** `I420P10` from 160 on the CPU-plane path, 4:0:0 dropped (E24); **C** 2; *added 2026-11-21:* **M** 159.0.1, 160.0.1: the rig's 8-bit G = 8 groups, which `VideoDecoder` takes, inexact on frames 1–7 of each group on the WebCodecs route only, every `dav1d:` variant of the same clauses exact (§Measured 2); the grey view is refused at configure, so not exposed; a 4:2:0 8-bit form would be (*derived*, PR 410 §ENGINE-REVIEW) | **S** AV1 Main only, and only where hardware exists (E9, E10, E11, E26); 10-bit `format` `null` by one report (E25); **D** | as macOS (same source); **D** |
| 2 | dav1d-WASM after a refusal or a failed decode, exact | **M** 408/408, 141; **C** 1 (`--refuse-webcodecs`) | **M** 408/408, 157; **C** 2 | **S** WASM SIMD shipped (E23); **D** | as macOS; **D** |
| 3 | The exact frame: HTJ2K by OpenJPH-WASM with SIMD, exact | **M** 240/240, 141; **C** 1 | **M** 240/240, 157; **C** 2 | **S** (E23); **D** | as macOS; **D** |
| 4 | The frame check: XXH3-64 in WASM SIMD128, its digest a `BigInt` | **M** 141 (the check's timing run) | **M** 157.0.1 | **S** (E23); **D** | as macOS; **D** |
| 5 | Frames in a `SharedArrayBuffer`, the page cross-origin isolated; `Atomics.wait` in the clock's worker | **M** every browser run here; **S** (E22) | **M** 157, 159; **S** (E16, E22) | **S** BCD 15.2 (E22), the embedder decides per global (E12); WebKitGTK **M** off as shipped; **D** | as macOS; **D** |
| 6 | The decoders as nested workers of the downloader | **M** `run_browser.sh dispatch`; **S** (E21) | **M** 157.0.1; *corrected 2026-11-21, was "`run_firefox.sh dispatch` 3/3":* **M** `run_firefox.sh dispatch` 764/781 on 160.0.1 (twice), 763/781 on 159.0.1, the failures the refused grey payloads, the scalable clauses and row 1's G = 8 groups (§Measured 2); **S** (E21) | **S** BCD 16.4 (E21); **D** | as macOS; **D** |
| 7 | WebTransport over HTTP/3, streams, `serverCertificateHashes`; the server's drafts negotiated | **S** (E2, E3, E4); *corrected 2026-11-21, was "**M** draft-02 and -07, Chrome for Testing stable to canary":* **M** draft-02 by default, 153 to 160 (§Measured 3); -07 only with `--enable-features=EnableWebTransportDraft07` ([`transport-conclusions.md`](../transport/transport-conclusions.md) §9) | **S** (E15); **M** draft-02, release and nightly; **C** 3 | *corrected 2026-11-21, was "only with macOS 26 or later's Network.framework":* **S** on macOS 26 where Network.framework's WebTransport functions load at runtime, unconditionally from 27 (E5, E6, E7); which 26.x (U); BCD 26.4 (E20); never measured; **D** | *corrected 2026-11-21, was "only from iOS 26":* **S** on iOS 26 where those functions load, unconditionally from 27 (E6, E7); by report a session stalls after 16 MB ([`../transport/design.md`](../transport/design.md) §Open); **D** |
| 8 | Paint in a worker: `transferControlToOffscreen`, WebGL2 on an `OffscreenCanvas`, integer `R16UI` textures | **M** 153 (both views); **S** (E8); **C** 1, 4 | **M** 155, under Xvfb (headless Firefox has no WebGL); **S** (E21); **C** 2, 4 | **S** WebGL2 on `OffscreenCanvas` BCD 17 (E21), setting on for Cocoa (E13); **D** | as macOS; **D** |
| 9 | The view worker's results: worker wins a busy page, its start ties | **M** 153 | **M** 155 | **D** (never run) | **D** |
| 10 | The cache's four stores: OPFS sync handle, OPFS async, IndexedDB, Cache Storage (no arm passes; the cache off) | **M** 153; **S** (E14); **C** 5 | **M** 159 (E and Q not run: the quota lever fails); **S** (E17); **C** 5 | **S** OPFS sync handle on Cocoa (E13), `createWritable` BCD 26 (E20), gated on `AccessHandleEnabled&FileSystemWritableStreamEnabled`, both on for Cocoa (E13; *added 2026-11-21*); limits and ITP deletion ([`cache-in-opfs.md`](../client/evidence/cache-in-opfs.md)); WebKitGTK 2.52.6 **M** no OPFS; **D** | as macOS; **D** |
| 11 | The reports' carriers: `sendBeacon`, `fetch` `keepalive`, a stream on the session | **M** cell D only (BEACON and KEEPALIVE pass); **S** (E4); **C** 6 | **S** `keepalive` on (E18), BCD 133 (E20); *corrected 2026-11-21, was "not run; **C** 6 once REPORT-CELLS adds Firefox":* **M** 160.0.1 at D1, one round, not counted: the four arms deliver (§Measured 6) | **S** BCD `sendBeacon` 11.1, `keepalive` 13 (E20); SESSION needs row 7; **D** | as macOS; **D** |
| 12 | The link from the client's `WebTransport.getStats()` | **S** behind `WebTransportStats`, `stable` at `main` (E4); BCD: not shipped (E20); *corrected 2026-11-21, was "absent on 153; **C** 3":* **M** absent on 153, 158 and 159, present on 160.0.8173.0, a pre-release Chrome for Testing build, without byte or packet counts (§Measured 3); stable 160 not measured | **S** BCD partial, 114, "Method is defined but throws a not-implemented error." (E20); *corrected 2026-11-21, was "**C** 3":* **M** 160.0.1 and 163.0a1 resolve it with bytes, packets, loss and RTT (§Measured 3): BCD's record is stale | **S** BCD 26.4 (E20); **D** | as macOS; **D** |

**So (derived):** in Chromium every row is measured or runnable here; in Firefox every row is measured or runnable
(*corrected 2026-11-21*, was "every row but 11"), and row 1 is known to fail (the client falls to dav1d, row 2), and
fails inside the 8-bit G = 8 groups `VideoDecoder` takes, a precondition on any 4:2:0 form in Firefox; in Safari, macOS or iOS, **no row is
measured**, and three rows are conditional on the device or its OS: the view's WebCodecs route (AV1 hardware present),
the transport (OS 26 or later), and shared memory (an embedder's choice per global). Nothing measured on WebKitGTK is
carried to Safari.

## Notes by row

1. **WebCodecs.** Chromium exposes `VideoDecoder` with no runtime flag (E1); Firefox behind `Func="nsRFPService::ExposeWebCodecsAPI"`, beside a pref
   true on desktop and Nightly-only on Android (E19; that the function reads the pref is *derived*); WebKit behind `WebCodecsVideoEnabled` (E9), whose `av01.0` branch needs
   `webCodecsAV1Enabled` (E10), off by default on Cocoa and turned on for every page once an AV1 hardware decoder is
   found (E11). So a Safari without AV1 hardware refuses the view's AV1 and the client takes dav1d; one with it
   decodes in VideoToolbox, whose 10-bit frames had `format` `null` in the one report found (E25): the probe should
   fail them and the client take dav1d. Which Apple devices have AV1 hardware is not sourced here (U).
2. **dav1d-WASM** is the client's fallback everywhere; Firefox's 0/240 on 157 was with no fallback then
   (`docs/av1/queue.md` row 37); the client now falls back after a refusal or a failed decode
   ([`../client/design.md`](../client/design.md) §Decided, 2026-11-11), so row 1's failure in Firefox should end in
   row 2: C 2 predicts the route `av1-dav1d` with the refusal named.
5. **Shared memory.** WebKit's JavaScriptCore at `main` exposes `SharedArrayBuffer` per global at the embedder's call
   (E12). WebKitGTK 2.52.6 left it off under cross-origin isolation, measured twice (`lab/av1/exact/engines` README,
   `webkit+sab`; `claude/cache-plan:docs/client/evidence/cache-plan.md` §9), so the client cannot run there as
   shipped. Whether Safari exposes it on a cross-origin isolated page is BCD's claim (15.2), not WebKit's source read
   here: a device decides.
7. **WebTransport in WebKit** is a Cocoa feature over Network.framework: the setting's default is
   `defaultWebTransportEnabled()` (E5), true only with `HAVE(WEBTRANSPORT)` and every Network.framework function it
   names (E6), which `PlatformHave.h` sets from macOS 26 and iOS 26 (E7); from 27 `HAVE(WEBTRANSPORT_WITHOUT_SOFT_LINKING)` returns `true` with no runtime check (E6, E7; *added 2026-11-21*). WebKitGTK has none, so the transport cannot
   be tried on WebKit in the cloud. Drafts: WebKit's offer is unread
   ([`../transport/transport-conclusions.md`](../transport/transport-conclusions.md) §9 item 1, a release blocker).
10. **The cache.** OPFS's sync handle is a dedicated worker's in all three engines (E14, E17; E13 for WebKit's
    setting). Firefox's private window has no OPFS (E17; [`cache-in-opfs.md`](../client/evidence/cache-in-opfs.md)).
    WebKitGTK 2.52.6 threw on `getDirectory` though `main` turns `AccessHandleEnabled` on for GTK (E13): a version
    difference, not traced.
12. **`getStats()`.** Chromium's IDL gates it behind `WebTransportStats` (E4), `status: "stable"` at `main` (E4),
    where BCD records it as not shipped (E20); the report plan measured it absent on 153
    ([`../client/evidence/report-plan.md`](../client/evidence/report-plan.md) §2). A version difference is likely;
    C 3 on today's Chrome for Testing settles it (*2026-11-21:* it did, from 160.0.8173.0, §Measured 3).

## Cloud cells (ENGINE-SMOKE)

Hosts: the 4-vCPU container without a GPU; Playwright's Chromium (153 at this writing); Firefox's current release
from `archive.mozilla.org`, its `SHA256SUMS` checked, under `xvfb-run` where WebGL is needed (`client/viewer/check.mjs`
`open()`); WebKitGTK 2.52.6 from Ubuntu 24.04 only as itself. Each prediction is *theory* from the rows above.

| # | command | rows | prediction |
| ---: | --- | --- | --- |
| 1 | `node client/viewer/demo-check.mjs DIR LOSSY_ID --view page` and `--view worker`, then each with `--refuse-webcodecs` (`DIR` from `scripts/demo-series.sh`; Chromium only: the script launches Playwright's Chromium) | 1, 2, 3, 8 | every claim passes in both views; the route `av1-webcodecs`, and `av1-dav1d` with the refusal named under the lever |
| 2 | `FIREFOX_PATH=… xvfb-run node client/viewer/check.mjs --engine firefox --series LOSSY.sbnd --decoder av1 --pair EXACT.sbnd --pair-decoder htj2k --view page`, then `--view worker`; `client/contract/run_firefox.sh dispatch` | 1, 2, 3, 5, 6, 8 | the view's frames all reach dav1d, the WebCodecs refusal named (row 1 fails by design); the exact frame checked `true`; `dispatch` 3/3 |
| 3 | `scripts/wtcompat.py --fetch DIR`, then `scripts/wtcompat.py chrome=… firefox=…`; a page calling `getStats()` on the open session in each | 7, 12 | both dial and fetch a frame exact on draft-02 (07 on Chromium); `getStats()` resolves on Firefox, partial; on Chromium decided by the run |
| 4 | `node client/paint/check.mjs` (SwiftShader); the same page opened in Firefox under Xvfb | 8 | the painter matches its CPU reference on Chromium; Firefox not built into the script: a run needs its driver, said so |
| 5 | `node lab/cache-arms/run.mjs --cell R --engine firefox` and `--engine chromium` (`claude/cache-arms`) | 10 | as `cache-plan.md` §9 on 159 and 153; a newer Firefox may move T and the quota lever |
| 6 | `node lab/report-arms/run.mjs` (`claude/report-arms`, PR 395) | 11 | Chromium only today (the driver writes `engine: "chromium"`); Firefox after REPORT-CELLS |
| 7 | WebKitGTK 2.52.6: `claude/cache-arms:lab/cache-arms/webkit-probe.mjs` and the engines probe, `node lab/av1/exact/engines/run.mjs --probe --engines webkit` | 5, 10 | as measured: no `SharedArrayBuffer`, no OPFS, no WebTransport (E5); says nothing about Safari |

## Measured (ENGINE-SMOKE, 2026-11-20)

*Measured* by a session that wrote none of the above, each cell against its prediction; raw logs and rows in
[`engines-smoke/`](engines-smoke/), named `c<cell>-…`. Firefox 160.0.1 and 159.0.1 from `archive.mozilla.org`, each
tarball checked against its release's `SHA256SUMS`; Chromium is Playwright's Chrome for Testing 153.0.8010.12;
`wtcompat.py --fetch` added Chrome for Testing 158.0.8127.36, 159.0.8154.13, 160.0.8173.0 and Firefox 163.0a1;
WebKitGTK 2.52.6 (`2.52.6-0ubuntu0.24.04.2`). Series: `dbts_a1` exact (HTJ2K) with `dbts_a1-q8-g16-cut` and
`-q8-g1-cut`, made by `scripts/demo-series.sh`'s own `ingest` for that one set.

| # | measured | against the prediction |
| ---: | --- | --- |
| 1 | `demo-check.mjs` passes, page and worker, with and without `--refuse-webcodecs` (G = 16); every frame `av1-webcodecs`, under the lever every frame `av1-dav1d` with the lab's refusal named | held |
| 2 | **The command as written cannot run**: `check.mjs` hosts one series per server, so an optimal-quality series fails on its exact series' metadata (`/series/dbts_a1/metadata answered 404`), in Chromium too. Run instead: the page's own `?check=1` against `scripts/demo-pair.sh`, Firefox 160 under Xvfb (WebGL on llvmpipe) and Chromium beside it, G = 16 and G = 1, both views: 56/56 received, none inexact, every readback 0 off, every frame `av1-dav1d` in Firefox (`av1-webcodecs` in Chromium). The exact series alone through `check.mjs` in Firefox: 56/56 exact, both views. **`run_firefox.sh dispatch` fails 17 of 781** on 160.0.1 (twice) and 18 on 159.0.1, where Chromium passes 789/789. The failures: clauses that expect `VideoDecoder` to take every ≤ 10-bit payload (Firefox refuses the grey ones, row 1); the scalable clauses (no unit reached WebCodecs); and **the 8-bit G = 8 group clauses**: frames 1–7 of each group off their keyframe's decoder and inexact, asks failing `frame N was not decoded before it here` | the pair held; dispatch **missed** (predicted 3/3) |
| 3 | `wtcompat.py`: Chromium 153, 158, 159, 160 and Firefox 160.0.1, 163.0a1 all dial, fetch a frame exact, and negotiate draft-02; every Chromium offers draft-02 alone; Firefox also offers `reset_stream_at` (`0x1d`). `getStats()` ([`engines-smoke/getstats-probe.html`](engines-smoke/getstats-probe.html)): absent on Chromium 153, 158, 159; present on 160.0.8173.0 (`smoothedRtt`, `minRtt`, `rttVariation`, `estimatedSendRate`, `datagrams`; no byte or packet counts); Firefox 160.0.1 and 163.0a1 resolve it with bytes, packets, loss and RTT | draft-02 held; "07 on Chromium" **missed** (the prediction mis-stated row 7: -07 was measured only behind a flag); `getStats()` decided: Chromium from 160.0.8173.0, a pre-release build, stable 160 unclaimed (*2026-11-21*) |
| 4 | `client/paint/check.mjs` on SwiftShader: every 1:1 whole-pixel cell equals the reference; fractional cells reported (max \|Δ\| ≤ 2) | held; Firefox not wired, as predicted |
| 5 | `cache-arms` R-idle at 512², one round, the four arms: every arm `exact`, `allWritten`, on Chromium 153 and Firefox 160 (Firefox's first run lost three arms to a dropped static host and the stubs to Marionette without Xvfb; the retry under Xvfb ran all four) | held; one round, no bar judged |
| 6 | `report-arms` D1, one round, not counted, `claude/report-arms` `fb3f15e5`: `off`, BEACON-Y, KEEPALIVE-Y and SESSION-Y each deliver a fill record to the sink on Chromium 153 and Firefox 160 | Firefox now runs (REPORT-CELLS); its review's two blockers are open |
| 7 | WebKitGTK: `webkit-probe.mjs`: cross-origin isolated, no `SharedArrayBuffer` on the page or in a worker, `getDirectory`, `createSyncAccessHandle` and `createWritable` a `TypeError`, IndexedDB and Cache Storage present. `run.mjs --caps`: `VideoDecoder` present, no AV1 configuration supported (`webkit` and `webkit+sab`). WebTransport not probed | held; nothing carried to Safari |

`--caps` beside these: Firefox 160's `isConfigSupported` answers yes for `av01.0.04M.08`, `.10` and
`av01.2.04M.12`, no for the High profile; Chromium 153 yes for all five asked.

**So (derived):** the Firefox view holds through dav1d, as rows 1 and 2 say, because Firefox refuses the view's grey
frames at configure. A series Firefox's `VideoDecoder` does take, in groups (the rig's 8-bit G = 8), fails its inter
frames there, on 159 and 160; not traced here whether the engine's output or the client's routing of a group around
it is the cause. Row 12 is now a version, not a source, question.

**Limits.** One 4-vCPU container without a GPU; Firefox's WebGL is llvmpipe under Xvfb, Chromium's SwiftShader;
software decode only; one round per cell, no timing claimed; 1 of the 19 DBT volumes (`dbts_a1`); no Safari, no phone.

## Only on a device

* **Safari, macOS and iOS, every row.** First, in this order, one page each: the engine probe (`VideoDecoder` per
  layout with its output `format`, `crossOriginIsolated` and `SharedArrayBuffer`, `getDirectory`, WebGL2 on an
  `OffscreenCanvas` in a worker, `WebTransport` present); then one WebTransport session and one frame, capturing its
  SETTINGS (`transport-conclusions.md` §9 item 1); then `check.mjs`'s page by hand. A device with AV1 hardware and one
  without, since row 1 differs between them.
* **Chrome for Android.** Rows 1–3 and 8 are the next phone round's
  (`claude/phone-protocol:docs/phone-rows/next-round.md`); the hardware route's samples are RGB there (E24).
* **Firefox for Android.** No WebCodecs on release (E19): the view is dav1d's; not planned.

## Sources

Chromium `https://raw.githubusercontent.com/chromium/chromium/fb1f1ab4ba16023d45798386b52797ceff1088e5/<path>`;
WebKit `…/WebKit/WebKit/4c0a9cbebc3dc44207052fc256b022a8dc99c03c/<path>`; Gecko
`…/mozilla-firefox/firefox/d5236b1340fb94c6b859ebb56c94e85e8e8015c4/<path>`; BCD
`…/mdn/browser-compat-data/70a51a128b3f173758dd4fa77f3373e478b22781/<path>`. Read 2026-11-19; the additions to E6, E7, E13 and E20 read 2026-11-21 at the same pins (ENGINE-REVIEW-FIX).

| # | file, lines | verbatim |
| --- | --- | --- |
| E1 | Chromium `third_party/blink/renderer/modules/webcodecs/video_decoder.idl` 10–14 | `Exposed=(Window,DedicatedWorker),` `SecureContext,` … `] interface VideoDecoder : EventTarget {` (no `RuntimeEnabled`) |
| E2 | Chromium `…/modules/webtransport/web_transport.idl` 8–10 | `Exposed=(Window,Worker),` `SecureContext` `] interface WebTransport {` |
| E3 | Chromium `…/modules/webtransport/web_transport_options.idl` 8; `third_party/blink/renderer/platform/runtime_enabled_features.json5` 8086–8088 | `[RuntimeEnabled=WebTransportCustomCertificates] sequence<WebTransportHash> serverCertificateHashes;` — `name: "WebTransportCustomCertificates",` … `status: "stable",` |
| E4 | Chromium `web_transport.idl` 41; `runtime_enabled_features.json5` 8133–8134; `…/modules/beacon/navigator_beacon.idl` 12; `…/core/fetch/request_init.idl` 23 | `[CallWith=ScriptState, RuntimeEnabled=WebTransportStats]` — `name: "WebTransportStats",` `status: "stable",` — `boolean sendBeacon(USVString url, …` — `boolean keepalive;` |
| E5 | WebKit `Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml` 7844–7852 | `WebTransportEnabled:` … `status: developer` … `defaultValue:` `default: false` `WebKit: WebKit::defaultWebTransportEnabled()` |
| E6 | WebKit `Source/WebKit/Shared/WebPreferencesDefaultValues.cpp` 568–576, 603–605 | `#if HAVE(WEBTRANSPORT_WITHOUT_SOFT_LINKING)` `return true;` `#elif HAVE(WEBTRANSPORT)` `// WebTransport implementations before the availability of all these` `// functions were experimental and so incomplete that we shouldn't expose` `// them to the web. This makes it so TahoeE+ has WebTransport, even if a` `// TahoeA SDK was used to build WebKit.` `static bool hasEverythingNeeded =` `canLoad_Network_nw_parameters_create_webtransport_http()` … `#else` `return false;` |
| E7 | WebKit `Source/WTF/wtf/PlatformHave.h` 2025–2028, 2031–2034 | `#if (PLATFORM(MAC) && __MAC_OS_X_VERSION_MIN_REQUIRED >= 260000) \` `|| ((PLATFORM(IOS) || PLATFORM(MACCATALYST)) && __IPHONE_OS_VERSION_MIN_REQUIRED >= 260000) \` … `#define HAVE_WEBTRANSPORT 1` — `#if (PLATFORM(MAC) && __MAC_OS_X_VERSION_MIN_REQUIRED >= 270000) \` `|| ((PLATFORM(IOS) || PLATFORM(MACCATALYST)) && __IPHONE_OS_VERSION_MIN_REQUIRED >= 270000) \` … `#define HAVE_WEBTRANSPORT_WITHOUT_SOFT_LINKING 1` |
| E8 | Chromium `…/core/offscreencanvas/offscreen_canvas.idl` 8 | `Exposed=(Window,Worker),` |
| E9 | WebKit `Source/WebCore/Modules/webcodecs/WebCodecsVideoDecoder.idl` 29–32; `UnifiedWebPreferences.yaml` 7414–7424 | `Conditional=WEB_CODECS,` `EnabledBySetting=WebCodecsVideoEnabled,` … `Exposed=(Window,DedicatedWorker),` — `WebCodecsVideoEnabled:` … `status: mature` … `defaultValue:` `"USE(LIBWEBRTC) && PLATFORM(COCOA)": WebKit::defaultPeerConnectionEnabledAvailable()` `"USE(GSTREAMER)": true` `default: false` |
| E10 | WebKit `Source/WebCore/Modules/webcodecs/WebCodecsVideoDecoder.cpp` 106; `UnifiedWebPreferences.yaml` 7357–7366 | `|| (codec.startsWith("av01.0"_s) && settings.webCodecsAV1Enabled);` — `WebCodecsAV1Enabled:` … `status: preview` … `defaultValue:` `"USE(GSTREAMER)": true` `default: false` |
| E11 | WebKit `Source/WebKit/WebProcess/GPU/webrtc/LibWebRTCCodecs.cpp` 129–141 | `void LibWebRTCCodecs::setHasAV1HardwareDecoder(bool hasAV1HardwareDecoder)` … `if (!hasAV1HardwareDecoder)` `return;` `Page::forEachPage(` … `settings.setWebCodecsAV1Enabled(true);` |
| E12 | WebKit `Source/JavaScriptCore/runtime/OptionsList.h` 693–696 | `/* Not sourced from UnifiedWebPreferences.yaml: unconditionally expose SharedArrayBuffer to every global object. */` `v(Bool, alwaysUseSharedArrayBuffer, false, Normal, nullptr)` `/* Not sourced from UnifiedWebPreferences.yaml: allows an embedder to conditionally expose SharedArrayBuffer per global, see callers of JSGlobalObject::exposeSharedArrayBuffer(). */` `v(Bool, allowSharedArrayBuffer, true, Normal, nullptr)` |
| E13 | WebKit `UnifiedWebPreferences.yaml` 199–208, 4757–4765, 4771–4779, 2573–2582; `Source/WebCore/Modules/filesystem/FileSystemFileHandle.idl` 40–42; `Source/WebCore/html/OffscreenCanvas.idl` 57–62 | `AccessHandleEnabled:` … `"PLATFORM(COCOA)" : true` `"PLATFORM(GTK) \|\| PLATFORM(WPE)" : true` `default: false` — `OffscreenCanvasEnabled:` / `OffscreenCanvasInWorkersEnabled:` each `"PLATFORM(COCOA) \|\| PLATFORM(GTK) \|\| PLATFORM(WPE)": true` — `[EnabledBySetting=AccessHandleEnabled, Exposed=Worker] Promise<FileSystemSyncAccessHandle> createSyncAccessHandle();` `[EnabledBySetting=AccessHandleEnabled&FileSystemWritableStreamEnabled] Promise<FileSystemWritableFileStream> createWritable(…);` — `FileSystemWritableStreamEnabled:` … `status: stable` … `"PLATFORM(COCOA)" : true` `"PLATFORM(GTK) \|\| PLATFORM(WPE)": true` `default: false` — `EnabledBySetting=OffscreenCanvasEnabled,` `Conditional=OFFSCREEN_CANVAS,` `ConditionalForWorker=OFFSCREEN_CANVAS_IN_WORKERS,` … `Exposed=(Window,Worker),` |
| E14 | Chromium `…/modules/file_system_access/storage_manager_file_system_access.idl` 7–12; `runtime_enabled_features.json5` 3324–3326; `…/file_system_sync_access_handle.idl` 7 | `RuntimeEnabled=FileSystemAccessOriginPrivate,` … `Promise<FileSystemDirectoryHandle> getDirectory();` — `// OPFS File System Access API.` `name: "FileSystemAccessOriginPrivate",` `status: "stable",` — `Exposed=DedicatedWorker,` |
| E15 | Gecko `dom/webidl/WebTransport.webidl` 17, 81; `modules/libpref/init/StaticPrefList.yaml` 17850–17853 | `sequence<WebTransportHash> serverCertificateHashes;` — `[Exposed=(Window,Worker), SecureContext, Pref="network.webtransport.enabled"]` — `- name: network.webtransport.enabled` `type: RelaxedAtomicBool` `value: true` |
| E16 | Gecko `StaticPrefList.yaml` 4353–4356 | `- name: dom.postMessage.sharedArrayBuffer.withCOOP_COEP` `type: bool` `value: true` |
| E17 | Gecko `dom/webidl/FileSystemSyncAccessHandle.webidl` 9; `dom/webidl/StorageManager.webidl` 29–30; `StaticPrefList.yaml` 5574–5577, 5595–5597 | `[Exposed=(DedicatedWorker), SecureContext, Pref="dom.fs.enabled"]` — `[Pref="dom.fs.enabled", NewObject]` `Promise<FileSystemDirectoryHandle> getDirectory();` — `- name: dom.fs.enabled` … `value: true` — `- name: dom.fs.privateBrowsing.enabled` `type: RelaxedAtomicBool` `value: false` |
| E18 | Gecko `dom/webidl/Request.webidl` 86–87; `StaticPrefList.yaml` 3243–3246 | `[Pref="dom.fetchKeepalive.enabled"]` `boolean keepalive;` — `- name: dom.fetchKeepalive.enabled` `type: RelaxedAtomicBool` `value: true` |
| E19 | Gecko `dom/webidl/VideoDecoder.webidl` 9; `StaticPrefList.yaml` 4040–4045 | `[Exposed=(Window,DedicatedWorker), SecureContext, Func="nsRFPService::ExposeWebCodecsAPI"]` — `- name: dom.media.webcodecs.enabled` `type: RelaxedAtomicBool` `#if defined(MOZ_WIDGET_ANDROID)` `value: @IS_NIGHTLY_BUILD@` `#else` `value: true` |
| E20 | BCD `api/WebTransport.json`, `api/FileSystemFileHandle.json`, `api/Request.json`, `api/Navigator.json`, `api/VideoDecoder.json` | `WebTransport` chrome 97, firefox 114, safari 26.4; `serverCertificateHashes` 100, 125, 26.4; `getStats` chrome `false`, firefox 114 `partial_implementation`, `"notes": "Method is defined but throws a not-implemented error."`, safari 26.4; `createWritable` 86, 111, 26; `keepalive` 66, 133, 13; `sendBeacon` 39, 31, 11.1; `VideoDecoder` firefox_android `false` |
| E21 | BCD `api/OffscreenCanvas.json`, `api/Worker.json` | `getContext.webgl2_context` chrome 69, firefox 105, safari 17; `Worker.worker_support` chrome 69, firefox 34, safari 16.4, "Not available in Shared Workers" |
| E22 | BCD `javascript/builtins/SharedArrayBuffer.json` | chrome 68, firefox 79, safari 15.2 |
| E23 | BCD `webassembly/fixed-width-SIMD.json` | chrome 91, firefox 89, safari 16.4 |
| E24 | [`browser-av1-profile-support.md`](../client/evidence/browser-av1-profile-support.md) §Verdict (Chromium `db89eb15`, Gecko `FIREFOX_157_0_RELEASE`); [`browser-decode-routes.md`](../client/evidence/browser-decode-routes.md) §Engine by engine | "Grey 4:0:0 comes back as `I420` with mid-grey chroma"; "Chrome for Android's MediaCodec maps only Main 8 and 10"; Gecko "`I420P10` when the frame comes back as CPU planes (from 160)", 4:0:0 "dropped (no grey case in Gecko's mapping)"; Chromium Android hardware: "RGB on Android hardware" |
| E25 | the same §Verdict, WebKit `dab1a6d7` | "One third-party report (bug 329735, Safari 27.0 on an M3) decodes a 10-bit Main keyframe with `frame.format=null`" |
| E26 | the same, WebKit | "`isSupportedDecoderCodec` takes `av01.0` only (Main)" |

The measured cells cite: `docs/av1/queue.md` row 37 (XBROWSER:
Chromium 141, Firefox 157, WebKitGTK 2.52.6), `lab/av1/exact/hashfast/README.md` (Chromium 141, Firefox 157.0.1),
`docs/ARCHITECTURE.md` and `docs/adr/exactness-in-production.md` (`run_firefox.sh`, 157.0.1),
[`../client/evidence/view-worker-under-a-busy-page.md`](../client/evidence/view-worker-under-a-busy-page.md) (153,
155), `claude/cache-plan:docs/client/evidence/cache-plan.md` §9–§10 (153, 159, WebKitGTK 2.52.6),
[`../client/evidence/report-plan.md`](../client/evidence/report-plan.md) §Verdict review (Chromium cell D),
[`../transport/transport-conclusions.md`](../transport/transport-conclusions.md) §9 item 1 (Chrome for Testing,
Firefox release and nightly, 2026-10-11).

**Scope.** Sources at `main` of 2026-11-19, not at the releases the measurements ran on; BCD is a secondary record.
Measurements: desktop engines in containers, headless or under Xvfb, no GPU, software decode; no Safari, no phone in
any cell; 19 DBT volumes of one dataset where a row decodes.
