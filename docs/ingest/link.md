# Ingest — the link from the site to the PACS

*Queue row 154, LINKTCP, 2026-10-11. Theory only: read from sources, nothing built, nothing timed. The decision is the
owner's of 2026-10-11 — **the hospital→PACS link is TCP** (HTTPS) — and this document writes down its reasons and what
QUIC would have to show before it returns. Every choice left open is the owner's (§8).*

*Corrected 2026-10-26* ([`pacs-receive-design.md`](pacs-receive-design.md) §1–§2): the sender is the **PCS** (the
hospital-side component, another team's), and what it sends is a **submission package**, one file per series; this
file's "site" is the PCS's host. The package's proof is its **XXH3** (in its name), not a bundle SHA-256. The owner
accepts different transports per link (10-25/26): one application handler, a TCP or a QUIC listener chosen by config
(§11, proposed).

**The link in question.** The site's ingest uploads coded bundles and their metadata, files of ~0.1–50 MB, a few to a
hundred GB a day, from a wired host in a hospital network to the server, over a WAN of ~10 Mbit/s–1 Gbit/s at 10–150 ms
RTT. It is the reverse of the viewer's fill: **the site sends, the server receives**, and nothing on it is interactive.
The viewer's own transport (WebTransport over QUIC, [`../ARCHITECTURE.md`](../ARCHITECTURE.md)) is not in question
here.

## Contents

1. [The answer in plain words](#1-the-answer-in-plain-words)
2. [CPU per byte](#2-cpu-per-byte)
3. [UDP on the way out](#3-udp-on-the-way-out)
4. [Long fat paths: what a TCP host needs](#4-long-fat-paths-what-a-tcp-host-needs)
5. [What QUIC's advantages are worth here](#5-what-quics-advantages-are-worth-here)
6. [Published bulk-transfer comparisons](#6-published-bulk-transfer-comparisons)
7. [Resumable upload over HTTPS](#7-resumable-upload-over-https)
8. [What would have to be true for QUIC to win](#8-what-would-have-to-be-true-for-quic-to-win)
9. [The owner's decisions](#9-the-owners-decisions)
10. [Sources](#10-sources)
11. [The carrier for the PCS's packages](#11-the-carrier-for-the-pcss-packages)

## 1. The answer in plain words

* **QUIC's wins are for a different link.** They come from a faster handshake and 0-RTT on short connections,
  loss recovery without head-of-line blocking when many streams share a lossy path, and migration when a phone
  changes networks. An upload from a wired host over one long-lived connection has one handshake a day, little
  loss, nothing to multiplex that parallel TCP connections cannot carry, and an address that does not move (§5).
* **QUIC's costs fall on this link.** QUIC in user space spends **~2–3× the CPU per byte** of kernel TCP with
  segmentation offload — 3.5× before Google optimised it, ~2× after (Langley et al. 2017; de Bruijn and Dumazet 2018),
  ~3× against TCP with TSO on one 10G testbed (Ploch 2022) — and the expensive side is the **receiver**, which here is
  our server (Zhang et al. 2024: 2.5× on the receiving client, 744 K datagrams against TCP's 58 K per GB) (§2).
  **At a few GB a day this is noise** (100 GB at 4 ms/MB is ~7 core-minutes a day); it decides only the peak rate one
  connection can reach, and both stay far above 100 Mbit/s on a server core.
* **The decisive cost is reachability.** Google found **4.4 % of clients could not use QUIC** in 2016, "commonly found
  in corporate networks … behind enterprise firewalls" (Langley et al. §7.2), and today's firewall vendors — Palo
  Alto, Zscaler, Cisco, SonicWall, Microsoft Defender — **recommend blocking QUIC** so that TLS inspection works. HHS's
  HICP asks hospitals for default-deny egress through web proxies. **No published rate exists for hospitals** — the
  inference is that UDP/443 is shut more often there than on average, not a measurement (§3). A QUIC uploader
  therefore needs a TCP fallback anyway (RFC 9308 §2), which is the link the owner chose.
* **TCP needs tuning on a long fat path, not a new protocol.** Linux's defaults cap one upload's in-flight data at
  `tcp_wmem[2]` = 4 MiB, ~670 Mbit/s at 50 ms and ~220 at 150 ms; a receiver before kernel 6.16 caps it lower still
  (6 MiB of receive buffer, ~500 / 170 Mbit/s). Up to 100 Mbit/s the defaults suffice; for 1 Gbit/s a site host
  raises a few sysctls (§4). A QUIC stack needs the same: its flow-control windows have the same bandwidth × RTT floor.
* **Published comparisons favour QUIC on short web loads and lossy access links, and TCP on bulk at high rate.**
  None measured an upload, none at our RTT with CPU, and several found the **congestion controller**, not the protocol,
  decided the result (Yu and Benson 2021; Wolsing et al. 2019) (§6).
* **Resume and integrity are the application's, on either transport.** S3-style multipart (client-chosen parts,
  per-part checksum, idempotent part retry), tus (server-held offset, per-chunk checksum), the IETF resumable-upload
  draft (server-held offset, **no** integrity in -13) and rsync (whole-file checksum, partial files) each give a
  different mix (§7). The package's own XXH3 (this said the bundle's SHA-256) and per-frame digests are the end-to-end proof whichever is chosen.

## 2. CPU per byte

What the sender and the receiver spend on the CPU per MB moved. Every number below comes from a LAN or loopback
testbed with RTT under 1 ms: **nobody published CPU per byte at 10–150 ms RTT**, and de Bruijn notes the GSO/GRO gains
on WAN-facing servers "are less clear". Derived figures assume one saturated core, 1 MB = 10⁶ B.

| stack and side | source, setup | measured | ms of CPU per MB (derived) | core share at 1 Gbit/s · 100 Mbit/s |
| --- | --- | --- | --- | --- |
| TCP + TLS, no offload, server sends | Ploch 2022: Xeon E5-1650 v3, 10G, nginx 1.18, OpenSSL 1.1.1n | ~4 000 Mbit/s, server core saturated | ~2.0 | 0.25 · 0.025 |
| TCP + TLS with TSO, server sends | Ploch 2022, same | 4 424 Mbit/s at ~72 % of a core | ~1.3 | 0.16 · 0.016 |
| TCP + TLS, client receives (wget) | Jaeger et al. 2023: EPYC 7543, 10G, kernel 5.10, defaults | 8 010 Mbit/s, client CPU the limit | ≤ 1.0 | ≤ 0.13 · — |
| TCP + TLS (HTTP/2), Chrome receives | Zhang et al. 2024: i7-6700, 1G, 0.23 ms | 1 GB in 9.32 s at 77.5 % | 7.2 | 0.9 · 0.09 |
| QUIC, Chrome receives (no GRO) | Zhang et al. 2024, same | 1 GB in 18.60 s at 96.9 % | 18.0 | 2.25 · 0.23 |
| QUIC, quiche server, GSO | Ploch 2022 | 2 054 Mbit/s, server core saturated | ~3.9 | 0.5 · 0.05 |
| QUIC, LSQUIC / quiche server | Jaeger et al. 2023 | 3 250 / 2 530 Mbit/s (16× receive buffer) | ~2.5 / ~3.2 | 0.3–0.4 · 0.03–0.04 |
| QUIC, ngtcp2 sender, GSO | König et al. 2025: Xeon W-2145, 10G, kernel 5.15 | 4.94 Gbit/s, one sender core | ~1.6 | 0.2 · 0.02 |
| QUIC, quicly, GSO + GRO | Mukherjee et al. 2025: 25G, Linux 5.4 | 7.2 Gbit/s | ~1.1 | 0.14 · 0.014 |

**Why the gap.** Three costs, all per packet rather than per byte:

* **System calls and packets.** Kernel TCP hands the NIC 64 KB and lets it cut 1 500-byte packets (TSO), and the
  receiver merges arriving packets back into large buffers (GRO): Zhang's TCP receiver saw ~17 KB per packet reaching
  the transport, QUIC's ~1.34 KB. On transmit, de Bruijn and Dumazet measured TCP with TSO at 0.49 cycles a byte
  against UDP with GSO at 1.38 — **2.8×** — before any QUIC logic or encryption.
* **Acknowledgements in user space.** QUIC builds and parses its ACKs itself: 2.97 s of Chrome's 8.5 s packet thread
  per GB (Zhang, Table 4). ACK frequency (draft-ietf-quic-ack-frequency) cuts this; Fastly took quicly from 196 to
  466 Mbit/s on one 400 MHz core with fewer ACKs, GSO and 1 460-byte packets — **parity with TLS over TCP, but a TCP
  without TSO** (Oku and Iyengar 2020).
* **Encryption per packet.** AES-GCM over 9 000 B costs 5 100 ns in 1 500-byte packets and 2 578 ns as one unit
  (Mukherjee et al.): ~0.57 against ~0.29 ms per MB. TCP can move TLS into the kernel (kTLS) and onto the NIC: NVIDIA
  measured 25–51 % less CPU with TX offload; Netflix serves 380 Gbit/s with NIC kTLS from one host.

**What it means here.** The **server receives** the upload, and receive is QUIC's weak side (Zhang: no GRO, ACKs in
user space). quinn has GRO on Linux ([`../native/quic.md`](../native/quic.md) §1), which closes much of Zhang's gap;
how much is not measured. At this link's volumes the totals are small either way — 100 GB a day costs ~130 core-seconds
at 1.3 ms/MB and ~400 at 4 ms/MB — so CPU per byte matters for **one connection's peak** (2–5 Gbit/s for QUIC on a
server core, far above this link) and for a server taking many sites at once, not for one site.

*Not read:* Yang et al., "Making QUIC Quicker with NIC Offload", EPIQ '20 (ACM 403, no open copy) — the "up to 3.5×
the CPU cycles of optimized TCP and TLS" attributed to it reaches us second-hand only.

## 3. UDP on the way out

**Measured rates — all from 2015–2016, none for hospitals.**

| source | population | result |
| --- | --- | --- |
| Langley et al., SIGCOMM '17 §7.2 | YouTube clients reaching Google, Nov 2016 | 95.3 % used QUIC; **4.4 % could not** ("QUIC or UDP is blocked or the path's MTU is too small"), "commonly found in corporate networks"; 0.3 % rate-limited; "We have not seen an entire ISP blocking QUIC or UDP" |
| Swett, IETF 96 slides, Jul 2016 | Google properties | QUIC works 93 %; UDP blocked for the user 4.5 %; for the AS 0.2 %; rate-limited 0.3 %; Chrome loses the race to TCP 2 % |
| Edeline et al., arXiv 1612.07816 | RIPE Atlas, 2015–16 (UDP, not port 443) | 3.66 % (82 of 2 240) and 3.20 % (296 of 9 262) of probes block UDP; "especially concentrated in enterprise networks" — a claim cited from Reddy et al., not measured |

RFC 9308 (2022) §2 quotes "between 3 % and 5 % of networks" from the two 2016 sources. Later work (Rüth et al. 2018;
Zirngibl et al. 2021; Cloudflare's HTTP/3 share, 21 % of requests in 2025) measures servers and adoption, not client
blocking. *No published Chrome telemetry on blocked rates after 2017 was found.*

**Vendor guidance — recommends blocking.** The reason is the same everywhere: TLS inspection, URL filtering and DLP do
not see into QUIC, and blocking it makes browsers fall back to TCP, which they can decrypt.

* **Palo Alto Networks**, PAN-OS admin guide: "block … QUIC protocol unless for business reasons … Create a Security
  policy rule to block QUIC on its UDP service ports (80 and 443)".
* **Zscaler** (2024): "Zscaler currently recommends that enterprise customers block QUIC as a best practice".
* **Cisco Secure Firewall**: "As a best practice, we recommend you to block QUIC traffic".
* **SonicWall** (2026): "firewalls often block QUIC, forcing the browser to fall back to standard HTTPS over TCP".
* **Microsoft Defender for Endpoint**: QUIC is "not supported with network protection … block QUIC traffic via the
  Windows Firewall". Against it, Microsoft 365's connectivity principles list blocking QUIC among things "known to
  cause connectivity issues".
* **Fortinet** FortiOS 7.4.2+ defaults QUIC to *inspect*, not block.

**Healthcare.** HHS 405(d) HICP (Technical Volume 2, 2022) asks for perimeter rules "configured with a default-deny
ruleset", egress limiting for sensitive zones and outbound web proxies; NHS HSCN's perimeter guidance says an allow
list "should be applied that only allows authorised protocols, ports and applications". Neither names QUIC. A cloud
imaging gateway's datasheet (Philips' DICOM gateway for AWS HealthImaging) asks for **outbound 443/TCP only**, and AWS
HealthImaging, Google Cloud Healthcare and Azure's DICOM service document HTTPS uploads, none HTTP/3. **That UDP/443 is
shut at hospitals more often than the 4–5 % average is an inference from this guidance, not a number.**

**What a QUIC link would need as a fallback** (RFC 9308 §2, RFC 9312 §4.5–4.6, draft-ietf-happy-happyeyeballs-v3-04,
Chromium `main`):

1. A TLS 1.3 over TCP path, with its own multiplexing — RFC 9308: applications "must either be prepared to accept
   connectivity failure … or be engineered to fall back". That path is the TCP link, whole.
2. A race, or TCP delayed by 250–300 ms (Happy Eyeballs v3 recommends 250 ms; Chromium uses 1.5 × SRTT, 300 ms when
   unknown), counted as won only when TLS completes, because of TCP-terminating proxies.
3. Detection of failure after the handshake, not only of it: a firewall in 2016 let QUIC's first packets through and
   dropped the rest, a "packet black-hole" that defeated Chrome's fallback (Langley §7.5).
4. Memory of a broken network with backoff (Chromium: 5 minutes, doubling).

So QUIC on this link is **QUIC plus TCP**: two transports to build, test and support at every site, where TCP alone
reaches all of them.

## 4. Long fat paths: what a TCP host needs

**The floor.** A sender can have at most one window in flight per round trip, so the window must be at least
bandwidth × RTT (the BDP): 100 Mbit/s × 50 ms = 625 KB; × 150 ms = 1.9 MB; 1 Gbit/s × 50 ms = 6.25 MB; × 150 ms = 18.75
MB. A smaller window caps the link whatever the congestion controller does: rate ≤ window × 8 / RTT.

**Linux's defaults** (read from `net/ipv4/tcp.c` at v6.12, v6.15, v6.16 and v7.2):

| limit | default | effect at 50 ms · 150 ms |
| --- | --- | --- |
| `tcp_wmem[2]`, the sender's buffer (the site) | 4 MiB, every kernel to 7.2 | in-flight ≤ 4 MiB → ≤ 671 · 224 Mbit/s (a code reading, not measured: unsent and unacknowledged data share the buffer) |
| `tcp_rmem[2]`, the receiver's buffer (the server), to 6.15 | 6 MiB | window ≈ half of it (`scaling_ratio` starts at 128/256) → ~503 · 168 Mbit/s |
| `tcp_rmem[2]` from 6.16 (commit 572be9bf9d0d: "TCP performance on WAN is mostly limited by tcp_rmem[2] for receivers") | 32 MiB | ~2 684 · 895 Mbit/s |
| `net.core.wmem_max` / `rmem_max` | 212 992 B (×2 in the kernel) | caps only an application that sets `SO_SNDBUF`/`SO_RCVBUF` itself — which also turns autotuning off: ~68 · 23 Mbit/s |

Both buffers grow on their own (autotuning, `tcp_moderate_rcvbuf` = 1) up to these maxima. **Up to 100 Mbit/s the
defaults suffice at 150 ms; 1 Gbit/s does not fit at either RTT** without raising them.

**The site host's tuning**, for a 1 Gbit/s path (ESnet fasterdata's host-tuning pages; the kernel's `ip-sysctl.rst`):

1. `net.ipv4.tcp_wmem` maximum to at least 2 × BDP: 16 MB for 50 ms, 32–64 MB for 150 ms (ESnet's 10G profile uses
   33 554 432). The server's `tcp_rmem` likewise, or a kernel ≥ 6.16.
2. **Never set `SO_SNDBUF` or `SO_RCVBUF` in the uploader**: it switches autotuning off and caps at the core maximum.
3. `net.core.default_qdisc = fq`: pacing (ESnet reports 2–4× on 50–80 ms paths from pacing alone).
4. `net.ipv4.tcp_slow_start_after_idle = 0` on both ends: by default an idle connection's window halves every
   retransmission timeout down to the initial window, which an intermittent upload on a kept connection pays each burst.
5. The controller: Cubic is Linux's default and ESnet's advice. Mainline's BBR is still v1 at 7.2; v3 is out of tree
   (google/bbr) and specified in draft-ietf-ccwg-bbr-06. Google's WAN probes found BBR "2-20x faster than Cubic" on its
   lowest QoS class, with fq pacing required (IETF 97 ICCRG). BBR matters under random loss; a wired hospital uplink
   with a shallow buffer is where it would show.
6. **Windows hosts:** receive-window autotuning at Normal (the default) and a current build — Cubic is the default
   since Windows 10 1709, and Dropbox found Windows uploads capped at "a few hundred megabits per host" by reordering,
   fixed by RACK-TLP from build 21332.

Below 100 Mbit/s none of this is needed. **A QUIC stack has the same floor**: its stream and connection flow-control
windows must reach the BDP too (msquic's 64 KiB stream default caps one stream near 5 Mbit/s at 100 ms; Jaeger et al.
found the default 208 KiB UDP receive buffer dropped packets at 10G), so tuning is not a reason to prefer either.

## 5. What QUIC's advantages are worth here

* **Handshake.** TLS 1.3 over TCP takes 2 round trips before the first byte, QUIC 1 (RFC 8446 Fig. 1, RFC 9000). With
  one connection kept open, that is **one RTT per connection, ~150 ms at worst, once**. Only a connection per file
  makes it scale: 20 000 files a day at 20 ms is ~400 s of serial wait a day, which keeping the connection open
  removes on either transport.
* **0-RTT: worth nothing for an upload.** 0-RTT data is "not forward secret" and has "no guarantees of non-replay
  between connections" (RFC 8446 §2.3); clients "MUST NOT send unsafe methods" in early data (RFC 8470 §4), and POST,
  PUT and PATCH are unsafe. "Disabling 0-RTT entirely is the most effective defense against replay attack" (RFC 9001
  §9.2). Google's handshake gains were mostly 0-RTT on search (~88 % of desktop connections, Langley et al.) — that
  does not transfer.
* **Migration: worth nothing on a wired host,** whose address does not change. It cuts the other way: UDP mappings in
  NATs "can expire after just thirty seconds" against at least 124 minutes for TCP (RFC 9308 §3.2, after RFC 5382), so
  an idle QUIC connection needs keep-alives every ~30 s (RFC 9000 §10.1.2) where TCP needs none.
* **Stream independence: worth something only under loss, with streams multiplexed.** A lost packet blocks only the
  streams with data in it (RFC 9000 §13), where HTTP/2 over one TCP connection stalls them all (RFC 9113 §1). A
  sequential upload has nothing to block across, and **several TCP connections** give independence at the price of
  unshared congestion control (RFC 9114 §1.1). A wired WAN's loss is low (not measured here).
* **A controller of our own choosing.** In user space the uploader can run BBRv3 or the server's `bbr-bound` without a
  kernel; on Linux TCP BBR is a sysctl (v1 in mainline), so this is worth something only where v3's loss bound matters
  and the site's kernel cannot be chosen.

## 6. Published bulk-transfer comparisons

**No published comparison measured the upload direction.** All are downloads, server to client; the setups decide.

| source | setup | tuned? | result | the authors' cause |
| --- | --- | --- | --- | --- |
| Kakhki et al., IMC '17 | EC2, gQUIC v34 against Apache HTTP/2 on kernel 4.4; 5–100 Mbit/s, +0–100 ms, 0.1–1 % loss; to 210 MB | QUIC tuned to Google's servers, TCP defaults | QUIC ahead in every desktop case but many small objects; 79 Mbit/s against 46 under 50–150 Mbit/s varying | loss recovery, no HOL blocking; QUIC took ~2× its share against TCP |
| Shreedhar et al., IEEE TNSM 2022 | Raspberry Pi 3, 100 Mbit/s residential, Google Drive downloads 1 KB–2 GB, 2018–21 | production | **TCP's mean higher above 20 MB**, QUIC's at or under 20 MB; QUIC ≈ 90 % CPU against ≈ 50 % "to achieve similar throughput" | handshake on small files; `recvmsg` cost on large ones |
| Wolsing et al., ANRW 2019 | web page loads, DSL 25 Mbit/s 24 ms, LTE 10.5 Mbit/s 74 ms | TCP tuned (IW32, pacing, no slow start after idle) | tuned TCP gains 5–8 % on stock; QUIC 9–14 % more | handshake; "choice of the congestion control algorithm has a much larger impact than the protocol itself" under loss |
| Yu and Benson, WWW '21 | production endpoints, 10 Mbit/s, +50/100 ms, 0–1 % loss, 100 KB–5 MB | production | H3 ahead at 100 KB, "essentially equivalent" from 1 MB | "largely determined by the server's choice of congestion-control algorithm" |
| Kempf et al., CoNEXT 2025 | 40 Mbit/s, 40 ms, kernel 6.1, 100 MiB | OS defaults | TCP 37.37 Mbit/s (16.5 drops); picoquic 37.09 (861); quiche 34.67 (687); ngtcp2 15.93 (503) | user-space pacing and GSO bursts |
| Jaeger et al., IFIP Networking 2023 | 10G LAN, 8 GB | defaults, then tuned | TCP 8 010 Mbit/s; QUIC 52–3 004, ≤ 4 900 tuned | user-space packet I/O; small UDP buffers |
| Zhang et al., WWW '24 | 1G LAN, 50 MB–1 GB | buffers > 10 × BDP | equal below ~500–600 Mbit/s; QUIC up to 45.2 % slower at 1 Gbit/s | receiver: no GRO, ACKs in user space |
| König et al., IFIP Networking 2025 | 10G, +0–300 ms, 0–2.5 % loss | raised buffers | best QUIC pair 4 172 Mbit/s; quiche 4.16 → 0.15 Gbit/s at +5 ms | one sender core; packet processing |

**Read together.** At the link's rates (≤ 1 Gbit/s), with low loss and a long connection, the comparisons that match
it best — Kempf at 40 Mbit/s and 40 ms, Shreedhar's large cloud-storage files, Yu and Benson from 1 MB — show **TCP
equal or ahead**, and QUIC's wins elsewhere come from handshakes, lossy access links and congestion controllers. ESnet,
whose job is bulk transfer on long paths, calls HTTP/3 "Not a good match for high performance data transfers" (2025).
Microsoft says SMB over QUIC "is slower than" encrypted SMB over TCP, citing encryption (SNIA SDC 2021).

## 7. Resumable upload over HTTPS

Who holds the offset, what proves the bytes, and what a retry does. The package's XXH3 (this said the bundle's SHA-256) and the per-frame
digests inside the bundle remain the end-to-end proof in every case; what follows is what the transfer itself adds.

| option | resume: who holds what | integrity | a retried request | an abandoned upload | Rust |
| --- | --- | --- | --- | --- | --- |
| **S3-style multipart** (also GCS, Azure blocks) | the client holds the upload id and its parts (ListParts recovers them); parts 5 MiB–5 GiB, ≤ 10 000 | per part: Content-MD5 or a declared checksum (CRC32C, CRC64NVME, SHA-256, …), `BadDigest` on mismatch; whole object: full-object CRC or a checksum of checksums | re-sending a part number overwrites it: idempotent; a lost Complete is ambiguous (`NoSuchUpload` means aborted *or* completed) | parts billed until aborted; a lifecycle rule cleans them | aws-sdk-s3 1.152.0, object_store 0.14.2 |
| **tus 1.0** | the server holds the offset; HEAD returns it, PATCH must match it or gets 409 with nothing changed | per chunk: `Upload-Checksum` (sha1 required), 460 on mismatch, the chunk discarded; **no whole-file checksum** | a repeated PATCH gets 409; a repeated POST creates a second upload | kept until `Upload-Expires` or DELETE | thin: tus_async_client 0.2.1 (2022), others 0.x |
| **IETF resumable upload**, draft-ietf-httpbis-resumable-upload-13 (2026-10-06, a working-group draft, not an RFC) | the server holds the offset; it "MUST NOT decrease"; a lost state deactivates the upload | **none**: -13 removed its integrity section; RFC 9530 digests can be added by hand, and a recipient "MAY ignore" them | 409 with the correct offset; a completed upload may replay its final response | `max-age` in `Upload-Limit` | none; by hand on reqwest |
| **Plain range PUT** (RFC 9110 §14.5) | nobody: no way to ask the offset | none of its own (RFC 9530 optional) | PUT is idempotent | unspecified | by hand |
| **rsync over SSH**, 3.5.1 | the receiver holds a partial file (`--partial-dir`) | a whole-file checksum always (xxh128 between peers ≥ 3.2), written to a temp file and renamed | a re-run skips files already whole | partial files left in the partial directory | none (spawn the binary) |

**For this link:** files are 0.1–50 MB, so a multipart part (≥ 5 MiB) splits a file into at most ~10 pieces and
most files go in one request; resume matters less than **an idempotent publish per file** — write, verify the
hash (XXH3 since 2026-10-24/25), then rename — which the server already does for a bundle in the plan ([`../FIXTURES.md`](../FIXTURES.md)
§A compiled ingest at the site). A designed upload endpoint is row 153's subject (INGESTDESIGN).

## 8. What would have to be true for QUIC to win

QUIC returns to this link only if **all** of the first two hold and at least one of the rest:

1. **It is reachable at the sites.** UDP/443 outbound open at the hospitals the product serves — a share nobody has
   published (§3). Otherwise TCP must be built anyway, and QUIC is a second path on top of it.
2. **Its receive cost on the server does not cap the link.** quinn with GRO receiving within ~2× of kernel TCP per
   byte, at the server's real site count — unmeasured; quinn's receive cost was never published (row 124, N1).
3. **The path is lossy enough that loss recovery decides,** and the site's kernel cannot run BBR — a controller in
   user space (BBRv3, `bbr-bound`) is QUIC's one lever TCP lacks without a kernel change.
4. **Many independent uploads share one connection under loss,** so stream independence beats several TCP
   connections.
5. **Connections are short and frequent,** so a round trip per connection adds up — which a kept connection already
   removes on TCP.

*Gaps theory cannot close, each a one-line description for the owner, no protocol:* the UDP/443 reachability of real
hospital networks; quinn's receive CPU per byte against kernel TCP on the server; the loss and RTT of real site
uplinks; and the upload-direction bulk comparison no paper has run.

## 9. The owner's decisions

Listed, not taken.

1. **The resumable upload's shape** (compared in §11): S3-style multipart against an object store, tus, the IETF
   draft, a plain per-file PUT with publish-by-rename, or rsync — with row 153's design.
2. **The site host's tuning:** whether the ingest's installer sets the §4 sysctls, documents them, or leaves them.
3. **The server's kernel:** ≥ 6.16 for the 32 MiB receive default, or `tcp_rmem` set by deployment.
4. **The controller on the site host:** Cubic (default), BBRv1 (mainline), or v3 (out of tree).
5. **Whether to measure any §8 gap**, and which first.

## 10. Sources

Fetched 2026-10-11, pinned by version, tag or date and the first 12 hex of the fetched file's sha256. Raw copies are not
committed.

* **Papers:** Langley et al., "The QUIC Transport Protocol", SIGCOMM '17, Google's copy (`e0e622044a20`); Zhang et al.,
  arXiv 2310.09423v2 (`c000afca3e29`); Jaeger et al., arXiv 2309.16395v1 (`ac596357096a`); Kempf et al., "QUIC Steps",
  arXiv 2505.09222v1 (`a776a96ec961`); Kakhki et al., IMC '17, the authors' copy (`00c5e3116b3e`); Shreedhar et al.,
  IEEE TNSM 2022, accepted manuscript (`b64754b24c67`); Wolsing et al., arXiv 1906.07415v1 (`92151af50273`); Yu and
  Benson, WWW '21, the authors' PDF (`3123699f19d2`); König et al., IFIP Networking 2025 (`7e30bca7244a`); Mukherjee
  et al., ANRW '25 (`a18deed56ca3`); Ploch, "QUIC Performance on 10G Links", TUM thesis 2022 (`5798f0de7c63`); de Bruijn
  and Dumazet, "Optimizing UDP for content delivery: GSO, pacing and zerocopy", LPC 2018 draft (`46d3c424defa`); Edeline
  et al., arXiv 1612.07816v1 (`6a2929c85b1b`); Rüth et al., arXiv 1801.05168 (`38cd19925a2a`); Zirngibl et al., IMC '21
  (`41584e18684d`).
* **Talks and posts:** Swett, IETF 96 QUIC BoF slides (`d9398083d0b5`); Trammell and Kühlewind, RIPE 72
  (`29bc7d7887b6`); Oku and Iyengar, Fastly, 2020-04-30 (`da15235b5dce`); Ghedini, Cloudflare, 2020-01-08
  (`47f5497601ab`); Cloudflare, HTTP/3 one year on, 2023-06-06 (`fa9275545644`), and Radar 2025 review
  (`7a9b2d34a068`); Meta, 2020-10-21 (`e8905553e30c`); Watson, kTLS, netdev 1.2 (`20a11fb96e59`); Pismenny et al.,
  netdev 1.2 (`e0a55e6c53b9`); Tuaf et al., netdev 0x14 (`d098c715569c`); Gallatin, EuroBSDCon 2021 (`29af1bf3cda3`);
  Google, IETF 97 ICCRG BBR slides (`e14a7c45700c`); Microsoft, IETF 100 TCPM "Updates on Windows TCP"
  (`174d2aae812f`); Dropbox, 2021-05-03 (`defd6db63887`); SNIA SDC 2021, SMB over QUIC (`853a9a566d88`).
* **ESnet fasterdata:** Linux host tuning, 2025-03-06 (`ce58bd64b73a`); pacing (`132f3f19f1ed`); recent TCP
  (`2c1d8e76c759`); QUIC (`a759cd98ca53`); Windows (`d5b3cabf37dd`).
* **Linux** (torvalds/linux): `Documentation/networking/ip-sysctl.rst` at v6.12 (`7417433f163b`) and v7.2
  (`9b1d4cb5ed29`); `net/ipv4/tcp.c` at v6.12 (`a323a8aa41a1`), v6.15 (`318d47982057`), v6.16 (`5d61c7d972e5`), v7.2
  (`03b5d3d2f6ee`); `include/net/tcp.h` v6.12 (`cdf696125e94`); `net/ipv4/tcp_input.c` v6.12 (`8007c66e4cf2`);
  `net/ipv4/tcp_output.c` v6.12 (`81a3e778a6b6`); `include/net/sock.h` v6.12 (`5b0422aad3a0`); `net/ipv4/tcp_bbr.c`
  v7.2 (`a67fb17544c4`); commits dfa2f0483360 (`89e5498a341f`) and 572be9bf9d0d (`4ca8f7b8468f`); google/bbr v3
  README (`95330bb2ca66`).
* **Vendors:** Palo Alto Networks, PAN-OS 10.0 "Define Traffic to Decrypt" (`7bc67808f0fe`) and KB 464330
  (`ee865a61ee1f`); Zscaler, 2024-10-08 (`01160183f508`); Cisco cdFMC "How to Block QUIC Traffic" (`f01157c10fec`);
  Fortinet tips (`f884d8c3341e`, `14e04cbb568a`); SonicWall KB (`6c4c79c91bf7`); Microsoft Defender network protection
  (`b5be0b4e679c`) and Microsoft 365 connectivity principles (`6876512d5aea`); Microsoft Set-NetTCPSetting
  (`fa5dc31e10fd`); Philips DICOM gateway datasheet (`bd6c7c6fef18`); AWS HealthImaging endpoints (`ec3239e5262e`);
  Google Cloud Healthcare DICOMweb (`75e4673e4507`).
* **Healthcare:** HHS 405(d) HICP Technical Volume 2, 2022 (`66aa23164fc5`); NHS HSCN perimeter guidance
  (`cc067fe67c77`) and internet access guidance (`80b8c414d01a`), through a public mirror.
* **IETF:** RFC 9000 (`f88aae47f8b1`), 9001 (`3bbaecdf5afd`), 8446 (`47871bc8820a`), 8470 (`483c316c2b5d`), 9110
  (`21c1cdce6ab0`), 9113 (`a00ef91b64e1`), 9114 (`6b84555c88ee`), 9308 (`ebe07ab0c29b`), 9312 (`032e6c950933`), 9530
  (`544dbb7d9afc`), 7413 (`ea094553d58f`); draft-ietf-httpbis-resumable-upload-13 (`3053c6e3fbdc`);
  draft-ietf-happy-happyeyeballs-v3-04 (`722b0e1cb262`); draft-ietf-ccwg-bbr-06 (`ba4f90e93d83`). Chromium `main` at
  56787e5f: `broken_alternative_services.cc` (`3fb64b279d91`), `quic_session_pool.cc` (`9cbc7a3330c1`).
* **Uploads:** tus protocol 1.0.0 (`dfc82027d295`, the repository's `main`, commit not pinned: the API refused); AWS
  S3 multipart (`69c3cbba7a97`), limits (`387c24248a3e`), upload integrity (`120bba4c5fff`), conditional writes
  (`8333d943dbbd`), ListParts (`0487b570d09f`), CompleteMultipartUpload (`1f308a018c06`); GCS resumable uploads
  (`cc6517cae191`) and hashes (`471e3158de58`); Azure Put Block (`7eb86bf50fbf`) and Put Block List (`1bad78937574`);
  rsync 3.5.1 man page (`9160de49f8f5`); crates.io records for aws-sdk-s3, object_store, tus_async_client and reqwest.

**Not read**, so not cited as read: Yang et al., EPIQ '20 (ACM 403, no open copy); Cardwell et al., "BBR", ACM Queue
2016 (403) — its 2–25× B4 figure is not verified here; Kempf et al., Computer Communications 2024; CHEP 2018 "QUIC and
TCP-BBR in long-haul science data transfers" (403); "Beyond the Handshake: Eliminating Fallback Latency from
QUIC-to-TCP Transitions", ACM 2025 (403); Cisco Umbrella's and Check Point's QUIC articles (403, title only); Sophos'
first-party text.

## 11. The carrier for the PCS's packages

*2026-10-25. Proposed, not accepted; theory only: read from sources and from the crates' code, nothing built, nothing timed. It stacks on
[`../adr/pcs-transfer.md`](../adr/pcs-transfer.md) (the ADR below), which fixed the unit (one package per series, or a
small update package), the reply (received, committed, refused: its §7) and recommended a resumable HTTPS upload (its
§3); this section compares the carriers for that package and says what the comparison changes there (§11.4). Labels as
in the ADR: **source** (read, pinned in §11.8), **estimated** (arithmetic from stated assumptions), **inference**. No
proof of concept: every doubt below is settled by reading a crate or a draft, or is a measurement on real links (§11.5)
that loopback cannot stand in for ([`../rig-limits.md`](../rig-limits.md) §3).*

**What the carrier must do.** Move one file of a few KB (an update) to ~1 GB (a long series); ~107 MB for the ADR's
CT. Carry the PACS's three replies back to the PCS on connections the PCS opens. Survive a drop, a stall, and a site
whose address changes. Reach every site over 443/TCP (§3) and some over QUIC, with as few mechanisms to build as
possible, since the owner weighs development and maintenance heavily. The PCS side is C and shell today
([DECK_WebTransport](https://github.com/opendicom/DECK_WebTransport) at `a65abe282b6d`: a parser in C, vendored
openjpeg and sqlite, no network code yet).

### 11.1 On one screen

| | option | the reply | after a drop | TCP and QUIC | the PCS builds | we build and maintain | fits |
| --- | --- | --- | --- | --- | --- | --- | --- |
| a | **IETF resumable upload**, draft-14, the "careful" mode (§11.3a), HTTP/1.1 | the final response is *received*; `GET` on the package is *committed* or *refused* | `HEAD` gives the offset, `PATCH` sends the rest: ~3 RTT plus the stall timeout | **one handler**; QUIC is a second listener (h3 0.0.8) | a script around stock curl, ~60–100 lines (*estimated*) | ~300–450 lines on hyper 1.12 (*estimated*), 3 crates | **yes: recommended** |
| b | tus 1.0 | the last `PATCH`'s 204, then the same `GET` | the same as (a) | the same as (a) | the same | the same, by hand; the crates are 0.x and months old | yes, equal to (a); a header rename apart |
| c | plain `POST`, whole package retried | the response, then the same `GET` | from byte 0 | the same as (a) | ~20 lines | (a) without `HEAD`/`PATCH`, ~100 lines fewer (*estimated*) | where a package's send time is under a tenth of the time between drops (§11.2): fiber yes, a CT on a dropping 1–2 Mbit/s link no |
| d | rsync over ssh, status files pulled back over ssh | a status file per package | `--partial-dir`: ssh handshake, then checksums of the partial | TCP only: no QUIC path | ~30 lines | sshd with a restricted key per PCS, a watcher, a status writer, ~150 lines (*estimated*) | fiber sites with 22/TCP out; not proxy-only sites, never QUIC |
| e | an upload protocol on our WebTransport server | a bidirectional stream | ours to design | QUIC, plus the WebSocket mapping for TCP: one protocol of ours on two transports | a WebTransport client in C (none known mature, *inference*) and a WebSocket one | the protocol, its fallback, on the viewer's patched crates | no |
| f | S3-compatible multipart, an event hook | none: a status object the PCS polls | `ListParts`, re-send parts ≥ 5 MiB | TCP; QUIC only if the store speaks HTTP/3 | SigV4 and multipart XML in shell, ~100–150 lines (*estimated*), or a CLI | a store to run (or s3s 0.17, an S3 subset of ours) and an event consumer | only if the PACS keeps packages in an object store anyway |
| g | anything simpler | — | — | — | — | — | none found that covers the dropping links; (c) *is* (a)'s endpoint used without resume (§11.3c) |

**Recommendation: (a), as the ADR says, made smaller.** One HTTPS endpoint on 443/TCP, HTTP/1.1 only, on hyper; the
draft's careful creation (§17.2): an empty `POST` creates the upload, `HEAD` returns the offset, `PATCH` appends,
`DELETE` cancels; the final `PATCH` answers *received* and `GET` on the package answers *committed* or *refused*. The
same endpoint takes a one-shot upload (`Upload-Complete: ?1` on the `POST`), so a fiber site's script may skip resume.
Pinned to interop version 10, since we own both ends. **HTTP/3 is not built**; when §11.5 and the ADR's M5 call for it,
it is the same handler behind a second listener on its own UDP port.

**The deciding reason.** In HTTP the reply and the resume are the application's, not the transport's: written once,
they work the same over TCP and QUIC (RFC 9110 defines the semantics "shared by all versions"; tus 1.0 "does not depend
on specific versions of HTTP"). So TCP-or-QUIC stops being a design and becomes a listener chosen per site, and the PCS
needs nothing beyond curl.

**What would change it.** (1) The PACS keeps packages in an object store: then (f) costs us no endpoint. (2) Every site
opens 22/TCP and QUIC is dropped for good: then (d) is the least code on both sides. (3) §11.5 shows HTTP/3 ahead by
more than 20 % on a link class a real site has, with UDP open there: build the second listener, on a crate that is
still 0.0.x today. (4) The draft breaks compatibility before it is an RFC and a third-party client must interoperate:
follow it, or switch to tus 1.0, frozen since 2016 (a header rename on both ends).

### 11.2 When retrying the whole package is enough

Drops arrive at random, on average one every M; a package takes T to send. Restarting from byte 0 costs an
expected M (e^(T/M) − 1); resuming costs T plus, per drop, the stall timeout and a reconnect (*estimated*: the
standard result for restart under Poisson failures, applied here). The ratio of the first to T, with the ADR's §5 packages and link rates:

| package, link | T | M = 5 min | M = 15 min | M = 60 min |
| --- | --- | --- | --- | --- |
| CT 500 (107 MB), 10 Mbit/s | 86 s | 1.16× | 1.05× | 1.01× |
| CT 500, 2 Mbit/s | 428 s | 2.22× | 1.28× | 1.06× |
| CT 500, 1 Mbit/s | 855 s | 5.72× | 1.67× | 1.13× |
| MR 200 (11.7 MB), 1 Mbit/s | 94 s | 1.17× | 1.05× | 1.01× |
| DX 1 (9 MB), 1 Mbit/s | 72 s | 1.13× | 1.04× | 1.01× |
| the ADR's packages, 100 Mbit/s | ≤ 9 s | ≤ 1.02× | ≤ 1.01× | 1.00× |

(*Estimated*; nobody has measured M at a site.) **Whole retry costs ≤ 5 % while T ≤ M / 10.** Fiber sites and small
packages stay under it; a large series on a slow link that drops, the very site QUIC is meant for, does not, and a
1 GB series fails it at 10 Mbit/s with M = 15 min (1.6×). Resume is ~100 lines on top of (c) (*estimated*), so the
endpoint has it and each site's script chooses.

**A drop is mostly detection.** A TCP connection whose path changes or dies does not fail at once: the PCS notices
only through a stall timeout (curl's `--speed-limit`/`--speed-time`), tens of seconds, against a reconnect of ~3 RTT
(TCP, TLS 1.3, `HEAD`) (*inference*). QUIC's migration would save the reconnect, not the detection, and only if the
client's QUIC stack migrates (not read for curl's).

### 11.3 Each option

**(a) The IETF resumable upload, draft-ietf-httpbis-resumable-upload-14.** A working-group document
(datatracker: "WG Document", IESG state "I-D Exists"; expires 2027-04-21), interop version **10**, "bumped for
breaking changes" (App. B).

* *Reply.* The final response to the completing request "comes from the target resource" (§6.1), so it carries
  *received* (202 and the status address, ADR §7); *committed* and *refused* are a `GET` on the package's resource. A
  refusal is a 4xx with `Upload-Complete: ?1`, which "resuming the upload would not resolve" (§6.1): the draft's own
  split between resend and resume matches the ADR's.
* *Resume.* The server holds the offset (§4.1); 409 carries the right one (§11). The **careful** creation (§17.2): an
  empty `POST` first, then `PATCH`es — chosen because the optimistic mode needs a 104 interim response to learn the
  upload's address, and **hyper's HTTP/1 server cannot send one** (`role.rs`: "response with 1xx status code not
  supported"), nor can a shell script read one easily. The draft allows it: 104 is sent "unless the server is not
  capable of sending interim responses" (§6.2).
* *Concurrency.* A resumed `PATCH` may meet a stale one still open from the server's side; the server "MUST take
  measures" and should end the earlier request (§10): a lock per upload, the newer request winning (*inference*:
  ~20 lines).
* *Both transports, one handler.* The handler is written against `http::Request` parts and a stream of body chunks.
  hyper 1.12.0 (2026-10-06; a release every one to two months) hands it an `Incoming` body over TCP; HTTP/2 adds
  nothing to one sequential upload, so HTTP/1.1 alone (no h2 crate). Over QUIC, h3 0.0.8 and h3-quinn 0.0.10 (both
  2025-05-06, the latest; h3-quinn needs quinn ^0.11.7, which our patched 0.11.11 meets) hand it `recv_data()` chunks;
  each front end is ~30 lines of adapter, the h3 listener ~100–150 with its accept loop (*estimated*). h3's README:
  "still very experimental … the API could change"; the lab already builds its client against our server
  (`lab/other-clients/h3/`). **The viewer's QUIC endpoint cannot carry it:** wtransport 0.7.2
  stops any request stream whose method is not CONNECT (`driver/mod.rs`, `MethodNotConnect` → `RequestRejected`),
  so HTTP/3 needs its own endpoint, or a fifth patch.
* *Lossy and high-RTT links.* On TCP, the kernel's controller (BBR by sysctl, §4) and any satellite TCP-splitting
  proxy act on it; on HTTP/3 neither the proxy (ADR §3, RFC 3135, RFC 9065) nor the kernel does, and quinn's controller
  decides. So a satellite site that splits TCP stays on TCP even if UDP is open (*inference*, §11.5 tests it).
* *The PCS builds:* with curl, `POST` (`Upload-Draft-Interop-Version: 10`, `Upload-Complete: ?0`, `Upload-Length`), read
  `Location`; on each attempt `HEAD` for `Upload-Offset`, then stream the file's tail from it (`tail -c +N` into
  `curl -X PATCH -T -`, since `curl -C` refuses: "HTTP uploads using POST or PUT cannot be resumed"); `--cert`/`--key`
  for mutual TLS; a stall timeout; then poll `GET` until committed or refused (*estimated* 60–100 lines; libcurl in C
  is the same calls). Ubuntu 24.04's curl 8.5.0 has no HTTP/3 (its Features line, read in this container); HTTP/3 at
  a site needs a curl built on ngtcp2, the one backend curl does not call experimental.
* *We build:* the five verbs, partial files with expiry, the length and package-hash checks, `Upload-Limit`, per-PCS
  limits, the status store, mutual TLS through rustls' client verifier (rustls and tokio-rustls are already in the
  server). New crates: hyper, hyper-util, http-body-util (*inference*: no router, four routes). Security surface:
  hyper's HTTP/1 parser and rustls.
* *Operations.* 443/TCP inbound on its own address: the viewer's WebSocket mapping already listens on TCP at the
  viewer's port number ([`../WIRE.md`](../WIRE.md) §The WebSocket mapping). Hospitals: 443/TCP out and a proxy bypass
  for mutual TLS (ADR §10). Monitoring: response codes, the age of the oldest uncommitted package (ADR §7). HTTP/3,
  later: one UDP port inbound, UDP out per site.

**(b) tus 1.0.** The same model: the server holds the offset, `HEAD` returns it, `PATCH` appends and gets 409 on a
mismatch (Core Protocol). It differs in names (`Tus-Resumable: 1.0.0`, `application/offset+octet-stream`), in a
successful `PATCH` that "MUST" answer 204 No Content (so *received* is the 204 of the last one and every status is a
`GET`), and in a per-chunk checksum extension the package hash makes redundant. Stable since 2016, where the draft
still moves. Rust: fileloft-axum 0.3.0 (2026-04-27), tus-protocol and tus-axum 0.1.0 (2026-07-14), salvo-tus 1.0.1
for another framework — young, and each pulls a framework; by hand it is (a)'s code with other header names. **Equal
to (a) on merits**; (a) keeps the ADR's choice and lets the final response carry the reply. §11.6 asks.

**(c) A plain `POST`, retried whole.** The reply is the response and the `GET`; no resume, so its cost follows
§11.2. It is not a separate mechanism: the draft lets a server answer a `POST` with `Upload-Complete: ?1` as a one-shot
upload (§17.1.1: "falls back to a non-resumable upload without additional cost"), so (a)'s endpoint serves (c) and
a site's script can start there and add resume later.

**(d) rsync over ssh, with the reply over ssh.** The ADR's §3 found no reply channel in rsync; one exists without
HTTPS if the PACS writes a status file per package into the PCS's directory and the PCS fetches it with the same ssh
key (*inference*). Resume: `--partial-dir`, at the cost of an ssh handshake and checksums of the partial (ADR §3).
Received is rsync's exit status after its whole-file checksum. QUIC: none, ever. The PACS runs sshd for every
hospital, each key restricted to one directory (rsync's `rrsync`, not read), plus a watcher that ignores rsync's
temporary names. The least code on both sides (*estimated*), and the wrong reachability: 22/TCP out is opened per
site, if at all, and a proxy-only site cannot use it (ADR §3, *inference*).

**(e) An upload protocol on our WebTransport server.** QUIC is the viewer's transport, so the server is there; the
upload is not: offsets, completion, the reply and limits are ours to specify. TCP needs the WebSocket mapping, as for
viewers: one protocol, two transports, both ours. The PCS would need a WebTransport client in C (draft-ietf-webtrans-
http3, not an RFC) and a WebSocket one. It inherits the viewer's four patches to three crates (`patches/`). The largest
cost here and the least reachable (§3). Rejected.

**(f) An S3-compatible object store, multipart, with an event hook.** Resume by parts (≥ 5 MiB, `ListParts`), per-part
checksums (§7). No reply: the store says "stored", never "committed"; the PACS's consumer of the store's events would
write a status object the PCS polls (*inference*). The PCS signs every request (curl's `--aws-sigv4`, not read) and
drives initiate, parts and the XML of Complete in shell, or installs a vendor CLI. We would run and patch a store, or
implement an S3 subset on s3s 0.17.0 (2026-09-24; 0.15, 0.16, 0.17 in five weeks), plus the consumer. Per-PCS
identity is an access key, not a certificate. It fits only if the PACS keeps packages in an object store for its own
reasons; then the store's endpoint replaces ours.

**(g) Simpler.** A hand-made chunked `PUT` (fixed chunks, each idempotent, then "complete") resumes without offsets
but is (f)'s multipart without a standard, and no shorter than (a)'s `HEAD` and `PATCH` (*inference*). SFTP is (d)
with less checking. DICOMweb's STOW-RS carries instances, not a package, and resumes nothing
([`design.md`](design.md) §9). Nothing simpler covers a dropping slow link.

### 11.4 What this confirms or changes in the ADR

* **Confirms** §3's recommendation: the draft's offset model on HTTPS over 443/TCP, the commitment polled by `GET`
  (§7), HTTP/3 off until link.md §8's conditions hold (§12 owner question 5), tus as the alternative, rsync without a
  reply channel of its own.
* **Changes** "HTTP/3 on the same endpoint costs no protocol work": true of the protocol, not of the code. The viewer's
  QUIC endpoint rejects non-CONNECT requests, so HTTP/3 is a second QUIC listener on h3/h3-quinn 0.0.x ("very
  experimental", no release since 2025-05-06), on its own UDP port.
* **Narrows** the subset: careful creation only, no 104 interim responses (hyper cannot send them), HTTP/1.1 only,
  interop version 10 pinned. The one-shot `POST` on the same endpoint is plain upload (c), for sites that need no
  resume.
* **Adds** what the PCS builds: a curl script, not a Rust or C HTTP stack, and an HTTP/3-capable curl only where QUIC
  is enabled; and a stall timeout, since detection, not reconnection, is most of a drop's cost.
* **Adds** a bound for "resume is needed": T ≤ M / 10 (§11.2), and a fair reading of rsync: a reply over ssh is
  possible; reachability and the absent QUIC path are what rule it out.
* The ADR's §3 and M3 cite draft -14; this file's §7 read -13. -14's change log removed integrity digests; the
  package hash in the name covers it either way (ADR §6).

### 11.5 Pre-registered: does resume or HTTP/3 pay on a real link class

Extends the ADR's M3 (the carrier on emulated links) and M5 (reachability) rather than repeating them; the same rules
apply: variants interleaved each round, each new test mutated, **seconds from the first byte to "committed" seen by
the PCS** (latency per package, not throughput), the testbed's ceiling reported first.

* **D1 — the drop rate.** At each pilot site, the PCS logs every failed transfer and stall for ≥ 2 weeks: M per
  link class. *Decides:* which rows of §11.2 are real.
* **C1 — drops.** Variants: (c) one-shot, (a) over HTTP/1.1, (a) over HTTP/3. Links: the ADR's §5 classes by `netem`.
  Drops: Poisson at M = 5, 15, 60 min, of two kinds, a 20 s black hole and an address change (the client's namespace
  moved to a new address). A GEO class with an open-source TCP-splitting proxy in the path. Packages: the CT and MR of
  ADR §5 and a 1 GB series; 20 a variant. *Mutation:* a server that always answers offset 0 must turn (a) into (c)'s
  numbers. *Decides:* the HTTP/3 listener is built only if (a) over HTTP/3 beats (a) over HTTP/1.1 by > 20 % in median
  on a class where D1 and M5 place a real site with UDP open; otherwise not, and this section's recommendation stands.

### 11.6 Questions only the owner can answer, each with a default

1. The draft, pinned to interop version 10, or tus 1.0? *Default: the draft* (the ADR's choice; the final response
   carries the reply).
2. Where the endpoint runs: its own process on its own address, or inside `series-server`? *Default: its own
   process* — it unpacks untrusted input, and the viewer's server and its patched QUIC stack stay as they are.
3. The HTTP/3 listener: *default: not built* until C1, D1 and M5 call for it.
4. Will the PACS keep packages in an object store? *Default: no* (local disk, as [`../adr/disk-access.md`](../adr/disk-access.md)
   assumes), so (f) stays out.
5. The largest package a PCS may send (`Upload-Limit` max-size): *default: 8 GiB*, a placeholder until sites report
   their largest series.

### 11.7 What the PCS team builds

The sender of (a): create, then loop {`HEAD`, `PATCH` from the offset, with a stall timeout and backoff} until the final
response, then poll `GET` until committed or refused, acting on refusals as the ADR's §7 says. Stock curl with a
client certificate; libcurl if they prefer C. An HTTP/3 build of curl only at a site where QUIC is enabled. Nothing
else changes in DECK.

### 11.8 Sources

Fetched or read 2026-10-25; the first 12 hex of the fetched file's sha256. Raw copies are not committed.

* **IETF:** draft-ietf-httpbis-resumable-upload-14, 2026-10-18 (`6bfbf01573b9`, the file the ADR read): §4.1, §6.1,
  §6.2, §8.1, §10, §11, §12, §17.1, §17.1.1, §17.2, App. B; its datatracker record ("WG Document", "I-D
  Exists", expires 2027-04-21). RFC 9110 (`21c1cdce6ab0`) abstract; RFC 3135 and RFC 9065 through the ADR §3.
* **tus** 1.0.0 (`dfc82027d295`, the file §7 read): Abstract, Core Protocol (`PATCH`).
* **curl** at `master`: `docs/HTTP3.md` (`8b17925ac5c8`) §Experimental; `docs/cmdline-opts/continue-at.md`
  (`a97239d69b9f`); curl 8.5.0's `--version` in this container (Ubuntu 8.5.0-2ubuntu10.16).
* **Crates**, source read from the crates.io archives: hyper 1.12.0 (`2c3e324da4c9`) `src/proto/h1/role.rs`
  (`ee27600c6d7a`); h3 0.0.8 (`10872b55cfb0`) `README.md` (`ffd5e71698c9`) §Status; wtransport 0.7.2 (`b4273ce3157a`)
  `src/driver/mod.rs` (`8a91e8e1a449`). crates.io records (versions, dates, dependencies): hyper 1.12.0, h3 0.0.8,
  h3-quinn 0.0.10, quinn 0.11.12, axum 0.8.9, tokio-rustls 0.26.6, s3s 0.17.0, fileloft-axum 0.3.0, tus-protocol
  0.1.0, tus-axum 0.1.0, salvo-tus 1.0.1, tus_async_client 0.2.1.
* **The PCS:** opendicom/DECK_WebTransport at `a65abe282b6d` (2026-10-22), `README.md` (`4fce01b625c8`) and its tree.
* **This repository:** the ADR §3, §5, §6, §7, §10–§12; this file §3, §4, §7, §8; [`../WIRE.md`](../WIRE.md) §The
  WebSocket mapping; `patches/`.

**Not read**, so not cited as read: rsync's `rrsync`; curl's `--aws-sigv4` and `--speed-time` pages; whether curl's
ngtcp2 backend migrates a connection; the tus reference server; draft-ietf-webtrans-http3's current version.
