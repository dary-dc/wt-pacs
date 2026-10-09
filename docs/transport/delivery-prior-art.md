# How other systems deliver medical images, and what they do better

*Queue row 61, TRANSFER.*

The transport was built by measurement against one baseline ([`transport-conclusions.md`](transport-conclusions.md)).
This file reads how others deliver: DICOMweb, progressive HTJ2K in an open-source web viewer and in cloud imaging
services, JPIP, plain HTTP/3, QUIC datagrams with forward error correction, and Media over QUIC. Web research only,
2026-10-07, no measurement. Each claim cites its source and the source's date; **unconfirmed** marks what rests on a
search summary or secondary text. Products, viewers and services are not named (the repository is public, `CLAUDE.md`);
their documentation was read and is described, not linked.

## 1. DICOMweb: WADO-RS

PS3.18 2026d (read 2026-10-07, <https://dicom.nema.org/medical/dicom/current/output/html/part18.html>):

* **What it sends.** A frame is a resource, `…/instances/{i}/frames/{list}`, returned as `multipart/related`, one part
  per frame with its own `Content-Location` (§8.6.1.2, §10.4.1.1). The transfer syntax is negotiated per part from
  `Accept` and its q-values; a compressed frame is never `application/octet-stream`, and HTJ2K is `image/jphc`
  (§8.7.3.3, §8.7.8). One frame, one request, over whatever HTTP the browser picks.
* **A lossy picture the server makes.** `…/rendered` and `…/thumbnail` return a server-rendered image: JPEG by
  default, `quality` 1–100, `viewport` crops and scales (§8.3.5.1, §8.7.4). A server that supports any thumbnail
  resource supports all of them (§10.4.1.1.4).
* **Part of a frame: only generic HTTP Range.** "Single part payloads may be requested with an HTTP Range request. If
  supported by the server…"; on a multipart payload the range covers the whole response, multipart markers included
  (§8.6.1.1–2, from CP-2204, 2022-10-28). Optional for the server; nothing frame- or codestream-aware.
* **Loss.** No frame-level loss handling: HTTP semantics, the transport's retransmission.

## 2. Progressive HTJ2K

**The standard's half.** Sup 235 (final text 2023-11-14, <https://www.dicomstandard.org/News-dir/ftsup/docs/sups/sup235.pdf>)
added three HTJ2K syntaxes; `.202` (RPCL, lossless) "allows for progressive display of images, as well as retrieval of
thumbnail images": RPCL order, enough decompositions that the smallest level is ≤ 64 on a side, **TLM markers
required** "to support smart streaming", 64×64 code blocks and one tile suggested (PS3.5 2026d §10.18.1, read
2026-10-07). The standard's own way to ask for a lower resolution is **JPIP** (`.204`/`.205`, `fsiz=w,h` on the
provider URL), not Range. The committee's slides (2023-11-16, informative, not peer-reviewed,
<https://www.dicomstandard.org/news-dir/progress/docs/sups/sup235-slides.pdf>): a 140 KB lossless CT frame gives 128²
from ~10 KB, 256² from ~30 KB, 512² from ~90 KB; over 4G a 128 KB Range prefix rendered first in 45 ms against 66 ms
for the whole frame.

**An open-source web viewer's image loader** (its progressive-loading docs and source, main branch, read 2026-10-07):

* **Two stages a frame.** Stage 1 asks every frame with `Range: bytes=0-<n>` and decodes at a reduced level; stage 2
  asks `Range: bytes=<held>-` and appends — no byte fetched twice. A third stage drops Range for servers without it.
  The source defaults the first chunk to 128 KiB (the docs still say 64 KB, 1/16–1/10 of the image); a frame is
  re-decoded at most every 500 ms as bytes arrive. An alternative mode decodes the growing prefix of one ordinary
  fetch, which needs only RPCL, not Range.
* **Order across a volume.** Middle, first and last frames whole; then every 4th frame from offset 3 as a prefix,
  neighbours replicated into the gaps; then offset 1; then every frame whole in the same strides; then a retry pass.
* **Loss and cancellation** are the browser's HTTP stack's.

## 3. Cloud imaging services

Read from three services' conformance statements and developer guides (2026-08-11 to 2026-10-07):

* One **transcodes lossless input to HTJ2K RPCL (`.202`) at import** by default and serves frames as stored only on
  `transfer-syntax=*` (default: uncompressed); a second transcodes to HTJ2K on retrieve; the third offers JPEG 2000,
  not HTJ2K. All three render JPEG/PNG; **none documents Range or any partial-frame retrieval** (an absence,
  **unconfirmed**). An open-source DICOMweb server plugin is reported not to support Range on bulk data
  (**unconfirmed**, search snippet only).
* What they share: the frame is an HTTP resource, so any HTTP cache or CDN in the path can hold it.

## 4. JPIP

ITU-T T.808 | ISO/IEC 15444-9 V2 (12/2022, <https://www.itu.int/rec/T-REC-T.808>; a 06/2026 edition is listed, not
read): a **stateful server keeps a model of the client's cache** and sends only what it lacks; a stateless request
carries the client's cache contents instead, so any host can answer it. The unit is the precinct data-bin, a
contiguous run in an RPCL codestream. Transports: http, https, http-tcp, http-udp. No peer-reviewed 2020+ measurement
of JPIP or JPEG 2000 streaming of medical images in a browser was found (**unconfirmed** absence).

## 5. Plain HTTP/3

* **Range** (RFC 9110 §14, 2022-06, <https://www.rfc-editor.org/rfc/rfc9110.html>): a server may ignore it or
  coalesce ranges. A 206 may be cached as an incomplete 200 and joined under one strong validator (RFC 9111 §3.3–3.4);
  whether browser caches and CDNs do is **unconfirmed**. In a browser `Range` is CORS-safelisted only as one range
  with a start, `bytes=a-` or `bytes=a-b`; a multi-range ask is preflighted, and `Content-Range` must be exposed to be
  read cross-origin (Fetch Standard, 2026-10-06, <https://fetch.spec.whatwg.org/>).
* **Priorities** (RFC 9218, 2022-06): urgency 0–7 and an incremental flag; same-urgency non-incremental responses go
  in stream order, incremental ones share; `PRIORITY_UPDATE` reorders in flight; all advisory. Fetch's
  `priority: "high" | "low" | "auto"` feeds an implementation-defined priority; what a browser sends for it is
  **unconfirmed**.
* **Head-of-line blocking matters less than expected.** Under random loss HTTP/3 was not better than HTTP/2 on Speed
  Index, and the congestion controller decided more (Yu and Benson, WWW 2021, <https://cs.brown.edu/~tab/papers/QUIC_WWW21.pdf>);
  parallel streams help as random loss rises (0–5 %), sequential wins under bursty loss, higher bandwidth or lower
  round trip (Sander et al., TMA 2022, <https://www.comsys.rwth-aachen.de/fileadmin/papers/2022/2022-sander-h3-prio-hol.pdf>);
  across 14 707 sites, under loss no general trend (Trevisan et al., MedComNet 2021, DOI 10.1109/MedComNet52149.2021.9501274).
  This agrees with the shared stream's campaigns ([`../adr/stream-shape.md`](../adr/stream-shape.md)).
* **Cancellation** (RFC 9114, RFC 9000 §3.5, 2021–2022): an abort resets both directions; bytes in flight are spent
  and still count against connection flow control. How a browser maps `AbortController` to frames is **unconfirmed**.

## 6. QUIC datagrams and forward error correction

* **Datagrams** (RFC 9221, 2022-03): never retransmitted, congestion-controlled, one per packet. WebTransport exposes
  them with `maxDatagramSize` tied to the path MTU, age limits and send groups (W3C CR snapshot, 2026-07-30,
  <https://www.w3.org/TR/webtransport/>). No primary source uses them for bulk or lossless transfer: exact delivery
  over them means the application's own retransmission or FEC.
* **FEC.** QUIC-FEC (Michel et al., IFIP Networking 2019, arXiv 1904.11326): on long transfers or low loss and delay
  "the FEC overhead negatively impacts the download completion time"; it helps small files and high loss by avoiding
  retransmission timeouts. FlEC (IEEE/ACM ToN 31(2), 2023-04, arXiv 2208.07741): repair symbols for the **last flight
  only**, retransmission for the rest; on a real satellite access link 50 kB uploads that saw a loss finished in a median
  247 ms against 272 (mean 340 against 393); repair every round trip "consumes too much bandwidth for the bulk
  use-case"; a few 40–100 kB transfers got slower; a plugin prototype halved loopback throughput. RFC 9265 (IRTF,
  2022-07): FEC must not hide congestion; it pays for tail losses and non-congestive loss. Every QUIC FEC draft has
  expired, the IRTF group has concluded, and no browser carries one (**unconfirmed** for browsers).

## 7. Media over QUIC, and a reset that keeps a prefix

* **MoQ transport** (draft-ietf-moq-transport-22, 2026-10-01): track → group → subgroup → object, **one stream per
  subgroup**, priorities by subscriber, then publisher, then group order; a delivery timeout makes the publisher reset
  a stale stream. Like the product: independent units, a priority order, cancel by reset. Unlike it: built for media
  that goes stale and may be dropped; a lossless frame cannot be. Its per-subgroup stream is the shape the product
  measured as `per-frame` and rejected for the shared stream ([`../adr/stream-shape.md`](../adr/stream-shape.md)).
  A one-stream-per-frame media draft (draft-kpugin-rush-03, 2025-04) has expired.
* **`RESET_STREAM_AT`** (draft-ietf-quic-reliable-stream-reset-11, 2026-09-06) is **approved, in the RFC Editor
  queue**; WebTransport over HTTP/3 (-16, 2026-07-06) requires it, and the W3C API's `committedOffset` maps to it.
  It is what abandoning a frame's tail after its prefix needs
  ([`../adr/resolution-fitting-for-large-frames.md`](../adr/resolution-fitting-for-large-frames.md) §6), still not
  in quinn or wtransport.

## What they do better, and the measurement that would test it

| what others do | what the product does | the measurement here |
| --- | --- | --- |
| **A frame's prefix first, the rest after**, no byte twice (the viewer's two stages over RPCL + Range; DICOM's RPCL syntax exists for it) | whole frames; the decoder can draw a prefix (L19) and the wire piece is unbuilt | the cell already fixed in [`../adr/resolution-fitting-for-large-frames.md`](../adr/resolution-fitting-for-large-frames.md) §6 (25 % prefix, 20 Mbit / 50 ms, adopt at ≥ 2× to first viewable), with the rest on the same stream |
| **Coarse-to-fine order across a series**, prefixes in strides then the whole frames | the fill is sequential; the coarse-to-fine fill (queue row O1) measured every 8th frame 5.5× sooner and the fill unchanged, not adopted ([`transport-conclusions.md`](transport-conclusions.md) §The fill's order) | that order combined with prefixes, time to a scrubbable series, on phone profiles |
| **A frame is a cacheable HTTP resource** — a CDN or the browser's cache can serve a repeat | every byte comes from the server over a session | not a lab cell; a deployment property. What a repeat view costs the server is the measurable half |
| **Survives where UDP does not**, over any HTTP | WebSocket fallback built, off ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The TCP fallback) | field failure rate (open item 10 there) |
| **Tail protection by FEC** (FlEC: the last flight only) | a lost tail waits for recovery; the depth-1 tail is open ([`transport-conclusions.md`](transport-conclusions.md) §9 item 7) | in the relay: a 64 KB ask at 1–3 % loss, 30–80 ms, depth 1, with the frame's last packets sent twice against once; p50 and p95, interleaved |
| **A server-rendered lossy picture** (`/rendered`, `/thumbnail`) | none; lossy previews measured as client decodes: the lossy first picture, the lossy preview plus residual, the embedded codecs and the scalable payload (queue rows 12, 17, 22, 24 in [`../av1/queue.md`](../av1/queue.md)) | already measured there; nothing new |

**Not better here.** Range on multipart frames covers the multipart markers, so a prefix needs the response's shape
held fixed; a multi-range ask is preflighted; no service documents partial retrieval; under random loss HTTP/3's
streams buy little over one ordered stream, which is what the product chose; MoQ's deadlines and datagrams do not fit
exact frames.

## Proposed rows (not queued)

1. **FETCH — the same frames over plain HTTP/3 `fetch()`.** One GET a frame, then the viewer's two stages (a Range
   prefix, then the rest), against the product, through the relay on the phone profiles ([`transport-conclusions.md`](transport-conclusions.md) §1 *Link profiles close to a phone*), interleaved: ask
   latency, fill, time to every 8th frame. The lab has never measured the product against the way everyone else
   delivers, and the transport's choices rest on that comparison being won.
2. **PREFIX — the §6 cell above**, prefix then rest on the shared stream, combined with the coarse-to-fine order.
3. **TAIL — a duplicated tail** in the relay, the cell in the table; a server change only if it pays at the target.
4. **One Chromium session's transport parameters** — whether it advertises `reset_stream_at` — added to the draft
   compatibility check that is already open item 1 in [`transport-conclusions.md`](transport-conclusions.md) §9.
