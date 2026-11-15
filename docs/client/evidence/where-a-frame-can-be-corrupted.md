# Where a frame can be corrupted, when a failure is reported, and what the report may carry: sources

*2026-11-14, theory and sources only. It backs `docs/adr/exactness-in-production.md` §2.3 ("asking the server again does not help: QUIC authenticates every byte") and §8 (a coded-bytes digest; the identifier) and the 2026-11-14 decision on the safety report (`../design.md` §Decided).*
Fetched 2026-11-14. Every block marked **Quoted** is copied from the document fetched at the URL given
(plain-text RFCs; HTML converted to text; PDFs by `pdftotext`, so a hyphenated line break may be joined).
Everything under **Inference** is reasoning on those sources; nothing is measured.

Could not fetch: HHS's de-identification guidance
(https://www.hhs.gov/hipaa/for-professionals/special-topics/de-identification/index.html, HTTP 403).
It is not quoted from memory.

---

## Q1. Transport integrity

### Quoted

**RFC 9001 (Using TLS to Secure QUIC)**, https://www.rfc-editor.org/rfc/rfc9001.txt

§5 Packet Protection:
> As with TLS over TCP, QUIC protects packets with keys derived from the TLS handshake, using the AEAD
> algorithm [AEAD] negotiated by TLS.

> All other packets have strong cryptographic protections for confidentiality and integrity, using keys and
> algorithms negotiated by TLS.

("All other" means every packet type except Version Negotiation, Retry and Initial. Application data
travels in 1-RTT packets.)

§5.3 AEAD Usage:
> These cipher suites have a 16-byte authentication tag and produce an output 16 bytes larger than their input.

§5.5 Receiving Protected Packets:
> Once an endpoint successfully receives a packet with a given packet number, it MUST discard all packets in
> the same packet number space with higher packet numbers if they cannot be successfully unprotected with
> either the same key, or -- if there is a key update -- a subsequent packet protection key; see Section 6.
> Similarly, a packet that appears to trigger a key update but cannot be unprotected successfully MUST be
> discarded.

§6.6 Limits on AEAD Usage:
> In addition to counting packets sent, endpoints MUST count the number of received packets that fail
> authentication during the lifetime of a connection. If the total number of received packets that fail
> authentication within the connection, across all keys, exceeds the integrity limit for the selected AEAD,
> the endpoint MUST immediately close the connection with a connection error of type AEAD_LIMIT_REACHED and
> not process any more packets.

> For AEAD_AES_128_GCM and AEAD_AES_256_GCM, the integrity limit is 2^52 invalid packets; see Appendix B.1.
> For AEAD_CHACHA20_POLY1305, the integrity limit is 2^36 invalid packets; see [AEBounds]. [...] Applying
> this limit reduces the probability that an attacker can successfully forge a packet

**RFC 9000 (QUIC)**, https://www.rfc-editor.org/rfc/rfc9000.txt

§1 Overview:
> QUIC authenticates the entirety of each packet and encrypts as much of each packet as is practical.

§12.1 Protected Packets:
> Packets protected with 0-RTT and 1-RTT keys have strong confidentiality and integrity protection.

§12.2 Coalescing Packets:
> For example, if decryption fails (because the keys are not available or for any other reason), the receiver
> MAY either discard or buffer the packet for later processing and MUST attempt to process the remaining
> packets.

§21.1.2 Protected Packets:
> Packet protection ensures that the packet payloads can only be processed by the endpoints that completed
> the handshake, and invalid packets are ignored by those endpoints.

§2.2 Sending and Receiving Data:
> Endpoints MUST be able to deliver stream data to an application as an ordered byte stream.

> The data at a given offset MUST NOT change if it is sent multiple times; an endpoint MAY treat receipt of
> different data at the same offset within a stream as a connection error of type PROTOCOL_VIOLATION.

§13.3 Retransmission of Information:
> QUIC packets that are determined to be lost are not retransmitted whole. The same applies to the frames
> that are contained within lost packets. Instead, the information that might be carried in frames is sent
> again in new frames as needed.

> Application data sent in STREAM frames is retransmitted in new STREAM frames unless the endpoint has sent
> a RESET_STREAM for that stream.

**WebTransport over HTTP/3**, draft-ietf-webtrans-http3-17, 2 November 2026,
https://www.ietf.org/archive/id/draft-ietf-webtrans-http3-17.txt

§2.1 QUIC, WebTransport, and HTTP/3:
> QUIC supports application data exchange via streams: reliable and ordered byte streams that can be
> multiplexed.

§4.1 Transport Properties:
> Unreliable Delivery: WebTransport over HTTP/3 supports unreliable delivery. Resetting a stream results in
> lost stream data no longer being retransmitted. WebTransport over HTTP/3 also supports datagrams, which are
> not retransmitted.

§5.4 (flow control):
> Because WebTransport over HTTP/3 uses a native QUIC stream for each WebTransport stream, [...]

§8 Security Considerations:
> WebTransport over HTTP/3 satisfies all of the security requirements imposed by [OVERVIEW] on WebTransport
> protocols, thus providing a secure framework for client-server communication in cases when the application
> is potentially untrusted.

**W3C WebTransport**, Candidate Recommendation Snapshot, 30 July 2026, https://www.w3.org/TR/webtransport/

§3.2 WebTransport stream:
> A WebTransport stream is a concept for a reliable in-order stream of bytes on a WebTransport session, as
> described in [WEB-TRANSPORT-OVERVIEW] Section 4.3.

> Data sent on a stream is delivered as an undifferentiated sequence of bytes. The number of bytes in a single
> write operation on the sending side might not match the number of bytes read in single operation at the
> receiving side.

**RFC 9293 (TCP)**, https://www.rfc-editor.org/rfc/rfc9293.txt

§3.1 Header Format, Checksum:
> Checksum: 16 bits
>
> The checksum field is the 16-bit ones' complement of the ones' complement sum of all 16-bit words in the
> header and text.

§2.2 Key TCP Concepts:
> TCP reliability consists of detecting packet losses (via sequence numbers) and errors (via per-segment
> checksums), as well as correction via retransmission.

(RFC 9293 says nothing about how weak the checksum is.)

**Stone and Partridge, "When The CRC and TCP Checksum Disagree", ACM SIGCOMM 2000**,
author PDF on the conference site: https://conferences.sigcomm.org/sigcomm/2000/conf/paper/sigcomm2000-9-1.pdf
(DOI 10.1145/347059.347561)

Abstract:
> Traces of Internet packets from the past two years show that between 1 packet in 1,100 and 1 packet in
> 32,000 fails the TCP checksum, even on links where link-level CRCs should catch all but 1 in 4 billion
> errors. For certain situations, the rate of checksum failures can be even higher: in one hour-long test we
> observed a checksum failure of 1 packet in 400. We investigate why so many errors are observed, when
> link-level CRCs should catch nearly all of them.
> We have collected nearly 500,000 packets which failed the TCP or UDP or IP checksum. This dataset shows the
> Internet has a wide variety of error sources which can not be detected by link-level checks. We describe
> analysis tools that have identified nearly 100 different error patterns. Categorizing packet errors, we can
> infer likely causes which explain roughly half the observed errors. The causes span the entire spectrum of
> a network stack, from memory errors to bugs in TCP.
> After an analysis we conclude that the checksum will fail to detect errors for roughly 1 in 16 million to
> 10 billion packets. From our analysis of the cause of errors, we propose simple changes to several
> protocols which will decrease the rate of undetected error. Even so, the highly non-random distribution of
> errors strongly suggests some applications should employ application-level checksums or equivalents.

Body text:
> Errors fall into four broad groups: errors in end-host hardware, errors in end-host software, errors in
> router memory; and errors at the link level or in network-interface hardware.

> In such a situation, the safest thing to do is checksum the data as early as possible in the transmission
> path: before the data can suffer DMA errors or data path errors in the network interface.

> Rather the application must add the checksum before handing its data to TCP (ala SSL).

(The conference's own abstracts page, http://conferences.sigcomm.org/sigcomm/2000/conf/abstract.htm, has an
older version with other numbers. The text above is from the paper.)

**Storage: Bairavasundaram et al., "An Analysis of Data Corruption in the Storage Stack", USENIX FAST 2008**,
https://www.usenix.org/legacy/events/fast08/tech/full_papers/bairavasundaram/bairavasundaram.pdf

Abstract:
> An important threat to reliable storage of data is silent data corruption. In order to develop suitable
> protection mechanisms against data corruption, it is essential to understand its characteristics. In this
> paper, we present the first large-scale study of data corruption. We analyze corruption instances recorded
> in production storage systems containing a total of 1.53 million disk drives, over a period of 41 months.
> We study three classes of corruption: checksum mismatches, identity discrepancies, and parity
> inconsistencies. We focus on checksum mismatches since they occur the most.
> We find more than 400,000 instances of checksum mismatches over the 41-month period. We find many
> interesting trends among these instances including: (i) nearline disks (and their adapters) develop
> checksum mismatches an order of magnitude more often than enterprise class disk drives, (ii) checksum
> mismatches within the same disk are not independent events and they show high spatial and temporal
> locality, and (iii) checksum mismatches across different disks in the same storage system are not
> independent. We use our observations to derive lessons for corruption-proof system design.

**CPU: Hochschild et al. (Google), "Cores that don't count", HotOS 2021**,
https://sigops.org/s/conferences/hotos/2021/papers/hotos21-s01-hochschild.pdf

Abstract:
> We are accustomed to thinking of computers as fail-stop, especially the cores that execute instructions,
> and most system software implicitly relies on that assumption. During most of the VLSI era, processors that
> passed manufacturing tests and were operated within specifications have insulated us from this fiction. As
> fabrication pushes towards smaller feature sizes and more elaborate computational structures, and as
> increasingly specialized instruction-silicon pairings are introduced to improve performance, we have
> observed ephemeral computational errors that were not detected during manufacturing tests. These defects
> cannot always be mitigated by techniques such as microcode updates, and may be correlated to specific
> components within the processor, allowing small code changes to effect large shifts in reliability. Worse,
> these failures are often "silent" – the only symptom is an erroneous computation.
> We refer to a core that develops such behavior as "mercurial." Mercurial cores are extremely rare, but in a
> large fleet of servers we can observe the disruption they cause, often enough to see them as a distinct
> problem – one that will require collaboration between hardware designers, processor vendors, and systems
> software architects.
> This paper is a call-to-action for a new focus in systems research; we speculate about several
> software-based approaches to mercurial cores, ranging from better detection and isolating mechanisms, to
> methods for tolerating the silent data corruption they cause.

§1:
> we observe on the order of a few mercurial cores per several thousand machines – similar to the rate
> reported by Facebook [8].

**CPU: Dixit et al. (Facebook), "Silent Data Corruptions at Scale", arXiv:2102.11245, 22 Feb 2021**,
https://arxiv.org/abs/2102.11245

Abstract:
> Silent Data Corruption (SDC) can have negative impact on large-scale infrastructure services. SDCs are not
> captured by error reporting mechanisms within a Central Processing Unit (CPU) and hence are not traceable
> at the hardware level. However, the data corruptions propagate across the stack and manifest as
> application-level problems. These types of errors can result in data loss and can require months of debug
> engineering time. In this paper, we describe common defect types observed in silicon manufacturing that
> leads to SDCs. We discuss a real-world example of silent data corruption within a datacenter application.
> We provide the debug flow followed to root-cause and triage faulty instructions within a CPU using a case
> study, as an illustration on how to debug this class of errors. We provide a high-level overview of the
> mitigations to reduce the risk of silent data corruptions within a large production fleet. In our
> large-scale infrastructure, we have run a vast library of silent error test scenarios across hundreds of
> thousands of machines in our fleet. This has resulted in hundreds of CPUs detected for these errors,
> showing that SDCs are a systemic issue across generations. We have monitored SDCs for a period longer than
> 18 months. Based on this experience, we determine that reducing silent data corruptions requires not only
> hardware resiliency and production detection mechanisms, but also robust fault-tolerant software
> architectures.

**Memory (added for client and server RAM): Schroeder, Pinheiro, Weber, "DRAM Errors in the Wild",
SIGMETRICS 2009**, https://www.cs.toronto.edu/~bianca/papers/sigmetrics09.pdf. From the abstract:
> we observe DRAM error rates that are orders of magnitude higher than previously reported, with 25,000 to
> 70,000 errors per billion device hours per Mbit and more than 8% of DIMMs affected by errors per year. We
> provide strong evidence that memory errors are dominated by hard errors, rather than soft errors, which
> previous work suspects to be the dominant error mode.

(Server fleets with ECC. A phone's memory is a different population; the paper says nothing about it.)

### Inference

**What AEAD rules out.** A 1-RTT packet that changes on the wire fails its 16-byte tag. The receiver drops
it, the sender sees a loss, and QUIC sends the data again (RFC 9000 §13.3). For an accidental change to get
through, it would have to forge a valid tag. The integrity limits (2^52 invalid packets for AES-GCM) show how
unlikely that is: millions of times less likely than a TCP checksum miss, which Stone and Partridge put at
1 in 16 million to 10 billion packets. So between the server's encryption and the browser's decryption,
corruption can be treated as excluded. AEAD protects nothing outside that span. Before encryption on the
server, and after decryption in the browser (the QUIC stack's reassembly, the WebTransport stream reader,
our own framing and buffers, the copy into the worker), corruption gets through unseen. That is the "end
host" share that Stone and Partridge found to be large. One more point: RFC 9000 §2.2 makes changed data at
the same offset an error, so a correct peer cannot "re-send different bytes" on the same stream.

**Can a re-request fix it? Fault by fault:**

| where the fault is | does a re-request fix it? | why |
|---|---|---|
| on the wire | does not arise | AEAD drops the packet; QUIC retransmits |
| server storage (silent corruption) | no | the bundle bytes are wrong at rest; a re-read returns the same bytes, and a bad page in the page cache stays until it is evicted. The fix is to re-ingest or restore. FAST'08 finds these corruptions clustered in space and time, so nearby frames are suspect too. |
| server RAM or CPU while serving | sometimes | a transient flip in a buffer is gone on the next read, unless it sits in a cached page. A mercurial core repeats if the same core runs the same code again. The server mostly copies bytes it has stored, so this exposure is small. |
| client RAM | probably yes, if transient | the next try uses a fresh buffer. A hard fault (the DRAM paper's dominant mode) may come back. |
| client receive/reassembly code above QUIC (ours or the browser's) | yes for a race, no for a deterministic bug | a race may not repeat, and then the re-request **hides** a real bug. A deterministic bug fails the same way again. |
| decoder | no | the bytes were right. The second decoder already covers this case. |

So a re-request is cheap (one frame) and can recover from client-side transient faults and races. It cannot
fix stored corruption, and it would hide bugs unless the first failure is still reported.

**What a coded-bytes digest adds.** Today the frame digest is taken over the decoded *samples*
(`docs/FIXTURES.md` §Frame digests: "the canonical (big-endian) XXH3-64 of the frame's samples as
`decodeFrame` hands them on"). So a mismatch cannot tell "the bytes arrived wrong" from "the decoder got it
wrong". Add a second digest over the coded payload, written at ingest next to the bundle's frame entry, and
check it on the client before decoding:

* coded digest bad → the received bytes are wrong: storage, the server, or the client's receive path.
  Re-request once. If the second copy also fails, and with the same computed digest, the stored bytes are
  wrong. The server can confirm by checking its own copy against the same digest.
* coded digest good, sample digest bad → the decoder (or client memory during decode) is wrong. Do not
  re-request; use the second decoder, then block the frame.

The cost is one XXH3 pass over the coded bytes, not measured here. Where this digest would live in the
`.sbnd` frame table is a layout decision.

---

## Q2. When to send the failure report

### Quoted

**W3C Beacon**, Candidate Recommendation Draft, 03 August 2022, https://www.w3.org/TR/beacon/

§1 Introduction:
> Developers opt for immediate delivery of each beacon, instead of coalescing and deferring their delivery
> because this provides improved delivery rates. Deferring delivery may mean that the beacon request may not
> have sufficient time to complete successfully, which leads to loss of important application data.

> Beacon requests are guaranteed to be initiated before page is unloaded and are allowed to run to
> completion without requiring blocking requests or other techniques that block processing of user
> interactive events.

§1, Note after Example 1:
> This event is the only event that is guaranteed to fire on mobile devices when the page transitions to
> background state (e.g. when user switches to a different application, goes to homescreen, etc), or is
> being unloaded. Developers should avoid relying on unload event because it will not fire whenever a page
> is in a background state (i.e. visibilityState equal to hidden and the process is terminated by the
> mobile OS.

("This event" is `visibilitychange`.)

> The sendBeacon() method does not provide special handling for offline storage or delivery.

§3.1 sendBeacon() Method (the IDL is `partial interface Navigator { boolean sendBeacon(USVString url,
optional BodyInit? data = null); };`):
> The user agent MUST initiate a fetch with keepalive flag set, which restricts the amount of data that can
> be queued by such requests to ensure that beacon requests are able to complete quickly and in a timely
> manner.

> The user agent MUST schedule immediate transmission of all beacon requests when the document
> visibilityState transitions to hidden, and must allow all such requests to run to completion without
> blocking other time-critical and high-priority work.

> The user agent MAY delay transmission of provided data to optimize network and energy efficiency [...]
> However, the user agent SHOULD NOT delay transmission indefinitely

Return Value:
> The sendBeacon() method returns true if the user agent is able to successfully queue the data for
> transfer. Otherwise it returns false.

> However, since the actual data transfer happens asynchronously, this method does not provide any
> information whether the data transfer has succeeded or not.

§3.2 Note:
> All requests with this flag set share the same in-flight quota restrictions that is enforced within the
> Fetch API.

**WHATWG Fetch**, Living Standard, last updated 14 November 2026, https://fetch.spec.whatwg.org/

§2.2.5 Requests:
> A request has an associated boolean keepalive. Unless stated otherwise it is false.
> This can be used to allow the request to outlive the environment settings object, e.g.,
> navigator.sendBeacon() and the HTML img element use this.

§4.6 HTTP-network-or-cache fetch:
> If the sum of contentLength and inflightKeepaliveBytes is greater than 64 kibibytes, then return a
> network error.
> The above limit ensures that requests that are allowed to outlive the environment settings object and
> contain a body, have a bounded size and are not allowed to stay alive indefinitely.

§4.12 Deferred fetching (`fetchLater()`):
> Deferred fetching allows callers to request that a fetch is invoked at the latest possible moment, i.e.,
> when a fetch group is terminated, or after a timeout.

§4.12.1 (non-normative):
> Out of the allocated quota for a document, only 64 kibibytes can be used concurrently for the same
> reporting origin

**Chrome for Developers, "Page Lifecycle API"** (last updated 2026-10-16),
https://developer.chrome.com/docs/web-platform/page-lifecycle-api

§Developer recommendations for each state, Hidden:
> The transition to hidden is also often the last state change that's reliably observable by developers
> (this is especially true on mobile, as users can close tabs or the browser app itself, and the
> beforeunload, pagehide, and unload events are not fired in those cases).
> This means you should treat the hidden state as the likely end to the user's session. In other words,
> persist any unsaved application state and send any unsent analytics data.

§Legacy lifecycle APIs to avoid, The unload event:
> The unload event does not fire in many typical unload situations, including closing a tab from the tab
> switcher on mobile or closing the browser app from the app switcher.
> For this reason, it's always better to rely on the visibilitychange event to determine when a session
> ends, and consider the hidden state the last reliable time to save app and user data.

**MDN, Navigator.sendBeacon()**, https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon

> The total size of queued data is limited to 64 KiB (65,536 bytes).

§Sending analytics at the end of a session:
> The pagehide event is not as problematic as unload, because it is compatible with the bfcache. However, it
> suffers from the same reliability problems. Developers should use visibilitychange instead.

**MDN, Document: visibilitychange event**,
https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event
> Transitioning to hidden is the last event that's reliably observable by the page, so developers should
> treat it as the likely end of the user's session (for example, for sending analytics data).

**W3C Reporting API**, Working Draft, 11 June 2025, https://www.w3.org/TR/reporting-1/

§1.1 Guarantees:
> The delivery is not, however, guaranteed in any way, and reporting is not intended to be used as a
> reliable communications channel. Network conditions may prevent reports from reaching their destination at
> all, and user agents are permitted to reject and not deliver a report for any reason.

§3.4.1 opens with "When the user agent is to generate and queue a report for a Document or
WorkerGlobalScope object", and the only JavaScript interface, `ReportingObserver`, has just `observe()`,
`disconnect()` and `takeRecords()`.

### Inference

* **The Reporting API does not apply.** Only the user agent generates its reports (when another spec
  defines a report type). A page has no call to queue a report of its own, and delivery is best-effort by
  design.
* **`sendBeacon` is on `Navigator`, the window's object.** The decode worker has `WorkerNavigator`, which
  does not have it. So the worker either posts the failure to the page, or calls `fetch(..., {keepalive:
  true})` itself. How browsers handle keepalive when a dedicated worker is terminated is not checked.
  `visibilitychange` fires on the document, so the end-of-session flush has to run on the page.
* **Send each failure at once:** most reliable, and the server can act while the viewer is still open: check
  its stored bytes against the digest, mark the bundle, re-serve. Failures are rare, so the request count
  hardly matters. The cost shows only in a storm, for example a broken bundle failing every frame: one
  request per frame, and every keepalive request shares one 64 KiB in-flight quota, so later ones fail.
* **Send only at the end of the session:** one request, fewest bytes. But it is lost whenever `hidden`
  never comes, which happens on a tab crash or an out-of-memory kill. Both are plausible for a heavy image
  viewer on a phone. The server also cannot react during the session.
* **Hybrid, the leaning:** send the first failure of each kind (coded vs decoded, per series) at once,
  with `sendBeacon` from the page, or `fetch` keepalive. Count later failures. Flush the counts on *every*
  `visibilitychange` to `hidden`, not once, because a hidden page can come back and fail again. Optionally,
  keep the unsent counts in the OPFS cache and send them at the next start, to cover a crash before `hidden`.
  This bounds requests per failure kind, keeps the early signal, and stays well under the 64 KiB quota (a
  report is well under 1 KiB).
* **Over the WebTransport session itself:** the report would cost no new request and the server would see it
  at once. But the session is the very path under suspicion, and nothing guarantees a stream write finishes
  once the page is hidden or frozen. Keepalive HTTP is the channel the specs make promises about.

---

## Q3. Identifiers

### Quoted

**DICOM PS3.5 2026d, §9 Unique Identifiers (UIDs)**,
https://dicom.nema.org/medical/dicom/current/output/chtml/part05/chapter_9.html
> Unique Identifiers (UIDs) provide the capability to uniquely identify a wide variety of items. They
> guarantee uniqueness across multiple countries, sites, vendors and equipment.

> All Unique Identifiers, used within the context of the DICOM Standard, are registered values as defined by
> [ISO/IEC 9834-1] to ensure global uniqueness.

> Although a specific implementation may choose some particular structure for its generated UIDs, it should
> never assume that a UID carries any semantics.

**DICOM PS3.3 2026d**
§C.7.2.1 General Study Module, Table C.7-3,
https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.7.2.html:
> Study Instance UID (0020,000D) 1 — Unique identifier for the Study.

§C.7.3.1 General Series Module, Table C.7-5a,
https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.7.3.html:
> Series Instance UID (0020,000E) 1 — Unique identifier of the Series.

(The "1" is the attribute Type. The row is reassembled from table cells.)

**DICOM PS3.15 2026d, Annex E**,
https://dicom.nema.org/medical/dicom/current/output/chtml/part15/chapter_E.html

Table E.1-1a, De-identification Action Codes:
> U — replace with a non-zero length UID that is internally consistent within a set of Instances

Table E.1-1 (columns: Basic Prof. / Rtn. UIDs Opt.):
> Series Instance UID (0020,000E) — U / K
> SOP Instance UID (0008,0018) — U / K
> Study Instance UID (0020,000D) — U / K

§E.1.1:
> Implementations claiming conformance to the Basic Application Level Confidentiality Profile as a
> de-identifier shall always protect (e.g., encrypt and replace) the SOP Instance UID (0008,0018) Attribute as
> well as all references to other SOP Instances [...] that could potentially be used by unauthorized entities
> to identify the patient.

§E.3.9 Retain UIDs Option,
https://dicom.nema.org/medical/dicom/current/output/chtml/part15/sect_E.3.9.html:
> Though individuals do not have unique identifiers themselves, studies, series, instances and other
> entities in the DICOM model are assigned globally unique UIDs. Whilst these UIDs cannot be mapped directly
> to an individual out of context, given access to the original images, or to a database of the original
> images containing the UIDs, it would be possible to recover the individual's identity.

Note:
> Specifically, the pixel data of the de-identified image can be matched against the pixel data of the
> original image. Such matching can be greatly accelerated by comparing pre-computed hash values of the pixel
> data.

**HIPAA, 45 CFR 164.514** (eCFR, current, title 45 up to date as of 2026-11-12),
https://www.ecfr.gov/current/title-45/section-164.514

(b)(2)(i):
> The following identifiers of the individual or of relatives, employers, or household members of the
> individual, are removed:

> (N) Web Universal Resource Locators (URLs);
> (O) Internet Protocol (IP) address numbers;

> (R) Any other unique identifying number, characteristic, or code, except as permitted by paragraph (c) of
> this section; and

(c):
> Implementation specifications: Re-identification. A covered entity may assign a code or other means of
> record identification to allow information de-identified under this section to be re-identified by the
> covered entity, provided that:
> (1) Derivation. The code or other means of record identification is not derived from or related to
> information about the individual and is not otherwise capable of being translated so as to identify the
> individual; and
> (2) Security. The covered entity does not use or disclose the code or other means of record identification
> for any other purpose, and does not disclose the mechanism for re-identification.

### Inference

* **What a UID is.** It is globally unique, and PS3.15's Basic Profile replaces Study, Series and SOP
  Instance UIDs (U). E.3.9 says a UID leads back to the person for anyone holding the originals or the PACS
  database. So a report that carries a UID carries what de-identification removes. Under Safe Harbor it is
  an item (R) identifier.
* **What the report carries:** the server's own opaque series key, the frame index, which check failed
  (coded or decoded), what happened next (re-request passed or failed; second decoder matched, or the frame
  was blocked), the decoder build, and a random session id (`crypto.randomUUID()` per session; not stored
  across sessions, not a device id). Only the server maps the key to a UID, and the map stays private,
  which is 164.514(c)(2).
* **The key must be random, not computed from the UID.** A hash of the Series Instance UID is "derived from
  or related to" it: anyone with the UID list can recompute it. That fails (c)(1). (HHS's guidance on this
  could not be fetched; this reading is from the regulation's text alone.) `docs/FIXTURES.md` says "The
  bundle is known by its file name"; that file name qualifies only if it is not made from the UID.
* **Digests in the report.** E.3.9 names "pre-computed hash values of the pixel data" as a way to match
  images. The expected digest adds nothing (the server already has it), so leave it out. The digest the
  client *computed* is a hash of wrong bytes, so it is a weak link to the image. It is useful: the same wrong
  coded digest from two sessions points at the stored bytes. The leaning: include the computed coded digest only.
* **What the request carries anyway.** The report travels as an HTTP request, so it carries the client's
  IP address (item O) and a URL (item N). Keep the UID and anything built from it out of the report URL, and
  treat the server's report log as it treats its access log: inside the covered entity, not as
  de-identified data.
* **Scope.** Safe Harbor is a test for releasing a de-identified data set. These reports stay inside the
  operator's own systems. The aim here is narrower: a report store that holds no patient identifier, so it
  can be read, shipped or attached to a bug without special handling.
