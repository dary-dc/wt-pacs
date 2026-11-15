# Work queue: the client's open foundations (2026-11-14 to 2026-11-22)

Started 2026-11-14 by the owner ("Use cloud work whenever possible. U may dispatch things that can already start").
Times are UTC. Beside `docs/queue-docs-2026-11-14.md` (the documentation restructure, PR 384 on
`claude/docs-client`); this file's rows touch none of that queue's files except where a row says so.

## Why these rows (the owner, 2026-11-14)

* **Hardware decode.** `docs/decode/hardware.md` (2026-10-13) concludes from Chromium 141's source, never from a
  device, that no browser hardware path serves our AV1: gate 2 refuses 4:0:0, gate 3 cannot read back `P010`, and
  Android wraps MediaCodec frames as RGB textures. The client asks WebCodecs for `prefer-software`, so every AV1 frame
  so far, on the phone included, was software. The owner: "this changes a lot of things. This needs to be
  investigated deeply, and researched with official resources, because otherwise we might start making catastrophic
  decisions on a false assumption"; and "a software or CPU based decoding isn't interesting at all with av1".
  Measured beside it (codecs line, containers): the WebCodecs view at Q 8 decodes in 1.24–1.74 HTJ2K frames at 1×,
  so AV1 saves bytes, not decode time.
* **The target link.** The owner: "I would like to know what our target link looks like"; Wi-Fi against 5G, their
  RTT and loss; studies are large (multi-GB) and the link will be a wireless one, so "that assumption here could
  cause all the downstream decisions to possibly be invalid". The only fitted link is a home Wi-Fi one (the phone on
  Wi-Fi, the server wired: ~2 ms, ≥ 600 Mbit/s, tail drop, no random loss): a best case of the target.
* **What a phone round must measure next**: OpenJPH's decode per frame on the phone; the delivery arms (A the
  optimal-quality view alone, B HTJ2K alone, C1 the approach with one exact frame on request, C2 the view then the
  whole exact series; `docs/client/design.md` §Decided, 2026-11-14 item 4); a view comparison that can conclude.
* **The link in the load report**, and a report a developer can save from the page.
* **Transport** as its own session (prepared here, run by the owner's local session).
* **The cache**: the owner, "proceed with a complete plan for it. Theoretical, backed on official resources, and
  empirical, optimizing and reviewing each one to rule out disadvantages in impl we make"; and improve the candidate
  analysis method further.

## Rows

| row | not before | needs | output → PR base |
| --- | --- | --- | --- |
| HW-DECODE-DEEP | 11-14 21:00 | — | `claude/hw-decode` from `origin/claude/docs-client` → draft PR into `claude/docs-client` |
| LINK-TARGETS | 11-14 21:00 | — | `claude/link-targets` from `origin/claude/docs-client` → draft PR into `claude/docs-client` |
| REPORT-OPTIONS | 11-14 21:00 | — | `claude/report-plan` from `origin/claude/docs-client` → draft PR into `claude/docs-client`; rows appended to this file |
| CANDIDATE-METHOD | 11-14 21:00 | — | `claude/docs-client` (`CLAUDE.md` §Measurement; a docs commit on PR 384) |
| OQ-INGEST | 11-14 21:00 | — | `claude/oq-ingest` from `origin/claude/unified-client` → draft PR into `claude/unified-client` |
| OQ-INGEST-REVIEW | 11-14 21:00 | OQ-INGEST done | `claude/oq-ingest` (findings in its PR body) |
| CACHE-PLAN | 11-14 21:00 | — | `claude/cache-plan` from `origin/claude/docs-client` → draft PR into `claude/docs-client`; rows appended to this file |
| TRANSPORT-INVENTORY | 11-14 21:00 | DOCS-FOLD done (the other queue) | `claude/transport-design` from `origin/claude/docs-client` → draft PR into `claude/docs-client` |
| PHONE-NEXT-PROTOCOL | 11-14 21:00 | HW-DECODE-DEEP-REVIEW done, or 11-16 08:00 | `claude/phone-protocol` (docs; no PR unless the branch has one) |
| PHONE-NEXT-PROTOCOL-REVIEW | 11-14 21:00 | PHONE-NEXT-PROTOCOL done | findings in its file's "Review" section |
| HW-DECODE-DEEP-REVIEW | 11-14 21:00 | HW-DECODE-DEEP done | `claude/hw-decode` (its PR; findings, then the amendment applied) |
| MERGE-ALL-PLAN | 11-14 21:00 | DOCS-FOLD done (the other queue) | `claude/work-ledger:docs/queue/MERGE-ALL-PLAN-report.md`; nothing else pushed |
| HW-PROBE-PAGE | — | — | **delegated to the owner's local session `phone-tests`; no cloud worker takes it** (`claude/hw-probe`) |
| HW-PROBE-PAGE-REVIEW | 11-14 21:00 | `docs/queue/HW-PROBE-PAGE.md` says done | `claude/hw-probe`: opens its draft PR first if none exists (body from `docs/queue/HW-PROBE-PAGE-pr-body.md`), then findings in the PR body |
| DEPTH8-THEORY | 11-14 21:00 | — | `claude/depth8` from `origin/claude/docs-client` → draft PR into `claude/docs-client` |
| DEPTH8-MEASURE | 11-14 21:00 | DEPTH8-THEORY done | `claude/depth8` (rows and results; a session that wrote none of DEPTH8-THEORY) |
| HW10-ROUTES | 11-14 21:00 | — | `claude/hw10-routes` from `origin/claude/docs-client` → draft PR into `claude/docs-client` |
| HW10-ROUTES-REVIEW | 11-14 21:00 | HW10-ROUTES done | `claude/hw10-routes` (findings in its PR body; a session that wrote none of it) |
| NATIVE-NOTES | 11-14 21:00 | — | `claude/native-notes` from `origin/claude/docs-client` → draft PR into `claude/docs-client` (docs only) |
| CACHE-DESIGN | 11-14 21:00 | CACHE-PLAN done | `claude/cache-plan` (`docs/client/evidence/cache-plan.md` §7; PR of CACHE-PLAN) |
| CACHE-ADVOCATE-OPFS-SYNC | 11-14 21:00 | CACHE-DESIGN done | `claude/cache-plan` (its design in §7) |
| CACHE-ADVOCATE-OPFS-ASYNC | 11-14 21:00 | CACHE-DESIGN done | `claude/cache-plan` (its design in §7) |
| CACHE-ADVOCATE-IDB | 11-14 21:00 | CACHE-DESIGN done | `claude/cache-plan` (its design in §7) |
| CACHE-ADVOCATE-CACHESTORAGE | 11-14 21:00 | CACHE-DESIGN done | `claude/cache-plan` (its design in §7) |
| CACHE-PROTOCOL | 11-14 21:00 | every CACHE-ADVOCATE done | `claude/cache-plan` (§Protocol of the same file) |
| CACHE-BUILD-HARNESS | 11-14 21:00 | CACHE-PROTOCOL done | `claude/cache-arms` from `origin/claude/docs-client` → draft PR into `claude/docs-client` |
| CACHE-BUILD-OPFS-SYNC | 11-14 21:00 | CACHE-BUILD-HARNESS done | `claude/cache-arms` (its PR) |
| CACHE-BUILD-OPFS-ASYNC | 11-14 21:00 | CACHE-BUILD-HARNESS done | `claude/cache-arms` (its PR) |
| CACHE-BUILD-IDB | 11-14 21:00 | CACHE-BUILD-HARNESS done | `claude/cache-arms` (its PR) |
| CACHE-BUILD-CACHESTORAGE | 11-14 21:00 | CACHE-BUILD-HARNESS done | `claude/cache-arms` (its PR) |
| CACHE-BUILD-REVIEW | 11-14 21:00 | every CACHE-BUILD done | `claude/cache-arms` (`docs/reviews/cache-arms.md`) |
| CACHE-FIX | 11-14 21:00 | CACHE-BUILD-REVIEW done | `claude/cache-arms` (its PR): the seven blockers of `docs/reviews/cache-arms.md` §Verdict fixed |
| CACHE-FIX-REVIEW | 11-14 21:00 | CACHE-FIX done | `claude/cache-arms` (`docs/reviews/cache-arms.md` §Re-review) |
| CACHE-RUN | 11-14 21:00 | CACHE-FIX-REVIEW done with no blocker open | rows on `claude/cache-arms`; results in `cache-plan.md` §Results on `claude/cache-plan` |
| CACHE-VERDICT-REVIEW | 11-14 21:00 | CACHE-RUN done, or 11-21 20:00 | `claude/cache-plan` (§Verdict review) |
| REPORT-ADVOCATE-BEACON | 11-14 21:00 | — | `claude/report-plan` (`docs/client/evidence/report-plan.md` §3.1; PR of REPORT-OPTIONS) |
| REPORT-ADVOCATE-KEEPALIVE | 11-14 21:00 | — | `claude/report-plan` (§3.2) |
| REPORT-ADVOCATE-SESSION | 11-14 21:00 | — | `claude/report-plan` (§3.3) |
| REPORT-ADVOCATE-NGINX | 11-14 21:00 | — | `claude/report-plan` (§3.5) |
| REPORT-ADVOCATE-RECEIVER | 11-14 21:00 | — | `claude/report-plan` (§3.5) |
| REPORT-PROTOCOL | 11-14 21:00 | every REPORT-ADVOCATE done | `claude/report-plan` (§Protocol of the same file) |
| REPORT-BUILD-HARNESS | 11-14 21:00 | REPORT-PROTOCOL done | `claude/report-arms` from `origin/claude/docs-client` → draft PR into `claude/docs-client` |
| REPORT-BUILD-BEACON | 11-14 21:00 | REPORT-BUILD-HARNESS done | `claude/report-arms` (its PR) |
| REPORT-BUILD-KEEPALIVE | 11-14 21:00 | REPORT-BUILD-HARNESS done | `claude/report-arms` (its PR) |
| REPORT-BUILD-SESSION | 11-14 21:00 | REPORT-BUILD-HARNESS done | `claude/report-arms` (its PR) |
| REPORT-BUILD-RECEIVERS | 11-14 21:00 | REPORT-BUILD-HARNESS done | `claude/report-arms` (its PR) |
| REPORT-BUILD-REVIEW | 11-14 21:00 | every REPORT-BUILD done | `claude/report-arms` (`docs/reviews/report-arms.md`) |
| REPORT-RUN | 11-14 21:00 | REPORT-BUILD-REVIEW done | rows on `claude/report-arms`; results in `report-plan.md` §Results on `claude/report-plan` |
| REPORT-VERDICT-REVIEW | 11-14 21:00 | REPORT-RUN done, or 11-22 08:00 | `claude/report-plan` (§Verdict review) |

A session never reviews a row it wrote. At most twelve rows of this file run at once.

### HW-DECODE-DEEP (theory and sources; nothing run on a device)

Question: **which hardware decode paths can serve the optimal-quality view, in which browsers and engines, and what
would each need?** Re-do `docs/decode/hardware.md`'s reading against today's sources and the optimal-quality view's
needs, and correct that file in place (its 2026-10-13 text corrected, not dropped; `docs/adr/disk-access.md` §2 is
the model). Quote every official source verbatim with its pinned revision: the AV1 spec, the WebCodecs spec, WebGL
and WebGPU specs, Chromium at the phone's version (Chrome 157) and at today's stable, Android's MediaCodec and Codec2
documentation, Apple's VideoToolbox, WebKit, Gecko.

* **Re-verify each gate** at Chrome 157: whether Android's MediaCodec path runs Chromium's `AV1Decoder` front end
  (gate 2) at all; whether `WebCodecsHBDFormatsEnabled` shipped; whether `P010` reached the WebCodecs spec or
  Chromium; whether Android still wraps every MediaCodec frame as `ABGR`.
* **The view need not be read back to be painted.** Today it is copied (`copyTo`) because the paint, the frame
  check, `valueAt` and a decoded cache read samples. For each of these, what a frame that stays on the GPU allows:
  `texImage2D(VideoFrame)` in WebGL2 and `importExternalTexture` in WebGPU, the precision a 10-bit frame keeps
  through each (can a 10-bit grey value reach a shader as more than 8 bits?), and what the window table (VOI) needs.
  The reconstruction digest (`docs/av1/payload-format.md` §Integrity) and `valueAt` without a read-back: what is
  possible.
* **Coded forms that reach hardware**: 4:2:0 with neutral chroma at 8 and 10 bits (the GREY420 form, built, not
  adopted: `docs/av1/payload-format.md` §8-bit grey as 4:2:0), its byte cost from the existing rows, and which
  decoders take 4:0:0 (per vendor documentation; NVDEC is the only one the old file shows).
* **Phones**: which Android SoCs list a hardware AV1 decoder, by the vendors' own documents (include the Galaxy S23's
  SoC); 4:0:0 and 10-bit support in their Codec2/MediaCodec components where documented; iOS (Safari's
  `<video>`-only hardware AV1; WebCodecs).
* **Native**: confirm or correct §5 (VideoToolbox, MediaCodec, VA-API, NVDEC planes back by API) for the view.
* **Beyond AV1, named only**: GPU or WebGPU decoders for HTJ2K (vendor documents, published implementations),
  since decode is the phone's bound; a paragraph, no evaluation.
* End with: a table (path × stream form → decodes in hardware? painted without read-back at full precision? sample
  read-back?), what is decided by the sources alone, and a **device probe** for the phone protocol: the exact
  `VideoDecoder.isConfigSupported` configs (`prefer-hardware`, each form), one tiny unit each, what to record
  (`chrome://media-internals` decoder name, `copyTo` format or error, a WebGL/WebGPU upload's precision check).
  Update `docs/client/design.md` §Open's decode item by one line.

### LINK-TARGETS (theory and sources; nothing run)

Question: **what links does a reader on a phone actually have, and where on them does a fill bind on the wire, on
the decode or on the round trip?** Write `docs/transport/link-profiles.md` (new; the transport subject's evidence).

* Profiles at least: home Wi-Fi, hospital or enterprise Wi-Fi, public Wi-Fi, 4G/LTE, 5G sub-6 GHz, 5G mmWave. For
  each, from official and measured sources only (Ookla and Opensignal reports, regulators' measurement programmes such
  as the FCC's and Ofcom's, 3GPP and IEEE targets marked as targets, peer-reviewed measurement studies), quoted with
  their date, region and method: downlink goodput (median, p10, p90), RTT idle and under load (bufferbloat), loss
  (random against congestive), jitter, variability and handovers. Say what is a target, what is a median of whom.
* One measured row: the home Wi-Fi fit (`docs/transport/transport-conclusions.md` §1 *A home Wi-Fi link, measured*;
  note it is wireless at the phone and a best case of the target, not wired).
* **The regime per profile, derived**: a fill is bound by max(wire, decode) per frame, and the crossover goodput,
  bits a frame ÷ effective decode time a frame, does not depend on the series' length (length scales both). With the
  measured numbers (phone: ~464 KB and ~45 ms effective a frame for `dbts_b1-q8-g8` in software; the exact series'
  bytes a frame; HTJ2K's phone decode **unmeasured**, mark it) say for each profile and arm which side binds and what
  is unknown. Goodput is not nominal bandwidth: state how RTT and loss turn into a fill's goodput under the
  default controller (`cubic-restart`) with sources, and that an on-demand ask is bound by the round trip.
* What a study's size changes and what it does not (how much is fetched, memory and the cache; not the regime).
* `netem` (or the relay) settings that emulate each profile, labelled assumed with their source, for later
  simulation rows; which profiles a phone must be used for because the decode, not the wire, decides.
* Update `docs/client/design.md` §Open's delivery-comparison item by one line pointing here.

### BEACON-LINK (superseded the same evening by REPORT-OPTIONS; not run)

### REPORT-OPTIONS (the candidate method, applied to the client's reports)

The owner, 2026-11-14: "we would prefer from the beginning to give it a production shape and have it well
optimized. So research on what are the best options … and some testing and evaluation and empirical testing between
the best candidates … basically the same framework that we use for discovering and then try to choose between
different candidates." Three records leave the page: the **load report** (sampled; PR 370's design on
`claude/telemetry-client`), the **link** in it (`getStats()` and the server's QUIC statistics for the session), and
the **safety report** (an exactness failure: always on, never sampled; `docs/client/design.md` §Decided, 2026-11-14
item 2). A developer can also save a record from the page (the developer overlay).

Write `docs/client/evidence/report-plan.md`: (1) **survey**, sources quoted: delivery (`sendBeacon`, `fetch` with
`keepalive`, the Reporting API, a stream or datagram on the WebTransport session, a server-side record from the QUIC
connection), when to send (at once, at `visibilitychange` to hidden, a hybrid of the first at once and the rest
counted), format and size (JSON, CBOR, compression; `keepalive`'s 64 KiB), the receiver (an nginx log line, a small
receiver, an outside collector), sampling, retention, what may identify a person or a patient and what an operator
needs to find the frame; existing production practice (the OpenTelemetry browser SDK, RUM vendors' documented
designs), cited, not adopted by default. (2) **screen** only on sourced hard constraints; (3) **a best-effort design
per survivor**; then append to this file's table, as CACHE-PLAN did, the rows the method needs:
REPORT-ADVOCATE-<option> per survivor, REPORT-PROTOCOL (cells at least: delivery rate when the page is backgrounded,
killed or the link drops; bytes and requests per load; cost on the page's thread; the receiver's cost), REPORT-BUILD
per survivor as lab arms on `claude/report-arms`, REPORT-RUN, REPORT-VERDICT-REVIEW; never earlier than 11-15 08:00,
closing by 11-22. PR 370's built design is one candidate, not the default. The owner's question for the safety report
is answered here with evidence: at once, at the end, or a hybrid, and whether the server should react to it (re-check
its stored bytes; see `docs/adr/exactness-in-production.md` §2 and §8 on why a re-ask returns the same bytes).

### CANDIDATE-METHOD (docs only)

The method CACHE-PLAN wrote (`claude/cache-plan:docs/client/evidence/cache-plan.md`) and REPORT-OPTIONS reuses is the
project's way to choose between candidates; a rule lives once. Add it to `CLAUDE.md` §Measurement on
`claude/docs-client` in that file's style, five lines at most: survey with sources; eliminate only on a sourced hard
constraint; a best-effort design per survivor, written before building; an advocate review per survivor by a session
that wrote none of them, its fixes in before any run; a protocol pre-registered by a session that builds nothing;
run, verdict with scope, and a loser re-checked once for losing to its implementation. Point to `cache-plan.md` as the
worked example. Within the comment budget's spirit: no narrative.

### OQ-INGEST (design, then build; a draft PR)

The owner, 2026-11-14: the optimal-quality coding "could join the unified branch in the ingest module. Under some type
of experimental flag, because we know that it might evolve into something that will be in the product, and it is not
… lab quick testing." Today only the lab tool codes it (`ingest/coded-frames/ingest.py`, `scripts/demo-series.sh`).

* Read first: `claude/ingest-oq:docs/reviews/ingest-oq.md` (INGEST-OQ's design: the Rust ingest recommended, the
  `exactSeries` grammar finding, two bundles per DICOM series), `docs/av1/payload-format.md` §Optimal quality, §Depth
  cut, §Source fingerprint, `docs/ingest/`, and the scope: in production the PCS codes; this ingest is ours for
  development, fixtures and the reference the PCS team can read.
* **A product feature behind a flag, not a lab lever**: off by default, named in the ingest's help and docs, tested
  like product code, no `lab/` import (`scripts/check_lab_absent.sh` stays green). State the distinction in the PR
  body in one paragraph.
* **Q 8 by default** (the owner, 2026-11-14: "a good number for simplicity"), any Q accepted by the flag's value; G
  per modality as decided; the depth cut for D > 10; `sourceFingerprint`; the reconstruction digest only if PR 368's
  design is the one the docs carry (otherwise name it as the next step). The noise-rule research stays documented and
  is not deleted (`docs/av1/`, the codecs line); the PR links it.
* Which ingest: the one INGEST-OQ recommends, or say why not. A failing test first for each behaviour, every new test
  mutated; the gate; byte-for-byte equality with the lab tool's output on one fixture where both can run, or the
  difference explained.

### OQ-INGEST-REVIEW

A session that wrote none of OQ-INGEST: each test fails without its change, the flag off changes nothing (same bytes,
same metadata), the absence check green, the PR body's distinction holds. Findings in the PR body.

### CACHE-PLAN

Input: `claude/docs-client:docs/client/evidence/cache-options.md` (CACHE-OPTIONS, theory, done: OPFS leads; decoded
against coded turns on a phone's cold read speed, ~0.4 GB/s, unmeasured). Write `docs/client/evidence/cache-plan.md`:
the complete plan, theory then empirical, and **a candidate method that does not let an option lose to its
implementation**:

1. **Screen** only on sourced hard constraints (an engine refuses it, the owner's rules: no re-decoding, bit-exact,
   off the paint's thread), each elimination quoting its source; everything else survives.
2. **Best effort per survivor**: one design per survivor, each tuned by what its own sources say (e.g. OPFS's sync
   handle vs `createWritable`; packed vs a file per frame; decoded vs coded; for IndexedDB, value size and
   transactions), written down before building.
3. **An advocate review per survivor** by a session that wrote neither that design nor another's: its job is to make
   that option as good as it can be and list every implementation disadvantage the design carries; fixes go in
   before any run.
4. **A pre-registered protocol** written by a session that builds nothing: the cells (write cost off the view's
   thread during a fill; read to paint; a series' reopen, warm and cold; eviction over the byte budget; a kill and a
   torn write; quota near full; two tabs), interleaved arms, the prediction per cell, where the host saturates. Cloud
   cells first (Chromium, Firefox, WebKitGTK); the phone cells (cold read speed above all) go into the phone
   protocol.
5. **Run and verdict** with scope; a loser's review asks once more whether its loss is its implementation.

Append the rows this needs to this file's table (CACHE-DESIGN, one CACHE-ADVOCATE-<option> per survivor,
CACHE-PROTOCOL, CACHE-BUILD-<option>, CACHE-RUN, CACHE-VERDICT-REVIEW), each with its brief, not-before, needs and
output, never earlier than 2026-11-15 08:00, and closing by 2026-11-22. Builds are lab arms on `claude/cache-arms`
(from `origin/claude/docs-client`), never in product modules (`scripts/check_lab_absent.sh`). Read
`docs/client/evidence/` (the old OPFS arms, the M5 memory runs) first: reuse what was built and measured, and say
what of it a best-effort design changes.

### The cache rows (appended by CACHE-PLAN, 2026-11-14)

All follow `claude/cache-plan:docs/client/evidence/cache-plan.md` (the plan): its four survivors **OPFS-SYNC,
OPFS-ASYNC, IDB, CACHESTORAGE** (§2), the shared input and seam (§3), the method (§4) and the protocol's frame (§5).
No session reviews, advocates for or runs what it wrote: the designer advocates for nothing, an advocate writes no
protocol, the protocol's author builds nothing, a builder neither reviews builds nor runs. Builds are lab arms under
`lab/cache-arms/<survivor>/` on `claude/cache-arms`, never in product modules (`scripts/check_lab_absent.sh`); each
build row works in its own directory so the builds rebase cleanly. The rows close by 2026-11-22.

* **CACHE-DESIGN.** One design per survivor in the plan's §7, before anything is built, each tuned only by its own
  sources (quoted, pinned) and answering the plan's §3 table for it: writer, layout, copies, transactions, the "does it
  fit" answer, reads, eviction, every failure of `cache-in-opfs.md` choice 7. Each design names what of the earlier
  builds it reuses (`client/view/cache.js`, `lab/opfs-arms/`, `lab/opfs-cache/`, M5's ring) and what it changes, its
  predicted floor (the raw API's cost a frame at S1–S3), and at most the settings its pilot may tune. The §3 *Not
  traced* items are traced here, each from its engine's source.
* **CACHE-ADVOCATE-<survivor>.** A session that wrote no design: make that option as good as its sources allow.
  Amend its design in place, each change with its source and *advocate* beside it; list every implementation
  disadvantage it still carries and every way the shared seam or input handicaps it (a seam change is proposed for
  all four alike, not for one). No fix after the protocol is written.
* **CACHE-PROTOCOL.** A session that built and designed nothing writes the plan's §Protocol: §5's cells, per survivor
  and `none`, with an A/A arm, each cell's prediction, bar and VOID rule, the floor probe beside each arm, the pilot's
  rule, saturation, the mutants (the plan's §4), round counts sized to the cloud host's time (one Williams period per
  cell at least), and whether WebKitGTK can run on the host (a cell not run says so). The phone cells P1–P3 stay in
  PHONE-NEXT-PROTOCOL; this row checks they are there and says so.
* **CACHE-BUILD-HARNESS.** The seam, the slot input (M5's ring, reused from `claude/core-m5:lab/opfs-cache/arms-*.js`),
  the floor probe and the cells, reusing `lab/opfs-arms/` and `lab/opfs-cache/` from history (`claude/opfs-arms-run`
  at `c99ba492`); `none` and a stub arm only. A failing test first per rule, mutated; the gate; the draft PR.
* **CACHE-BUILD-<survivor>.** Its design as written, behind the seam, nothing else; a test per failure row, mutated
  (which mutants each killed); the gate; smoke one round per cell (not results).
* **CACHE-BUILD-REVIEW.** Per standing rule: each test fails without its change (revert and see); each arm matches its
  design and touches nothing else; the floor probe measures the API alone. Blockers fixed on the branch by a later
  firing of the build's row, failing test first.
* **CACHE-RUN.** The protocol as written, pilot then counted cells, interleaved; rows pushed as they land; every cell
  against its prediction, misses included; where the host saturates; the fixtures and their limits.
* **CACHE-VERDICT-REVIEW.** The verdict by the rule, per engine, with scope; then the plan's §5 *loser's question* for
  every arm that failed a bar: its gap over its floor, and the change its sources allow that would close it, written
  as an amendment for one more interleaved run (owed, not run here). If CACHE-RUN is not done by 11-21 20:00, judge
  the cells pushed and name the rest. Update `docs/client/design.md` §Open's cache item by one line; the cache stays
  off, turning it on is the owner's.

### The report rows (appended by REPORT-OPTIONS, 2026-11-14)

All follow `claude/report-plan:docs/client/evidence/report-plan.md` (the plan): its survivors, the carriers **BEACON,
KEEPALIVE, SESSION** and the receivers **NGINX, RECEIVER** (§2), the shared parts (§3), the method (§4, the cache
plan's) and the protocol's frame (§4). The same separation as the cache rows: the plan's author advocates for nothing,
an advocate writes no protocol, the protocol's author builds nothing, a builder neither reviews builds nor runs. Builds
are lab arms under `lab/report-arms/<survivor>/` on `claude/report-arms`, never in product modules
(`scripts/check_lab_absent.sh`), each in its own directory. PR 370's build is BEACON's starting point, not the default.
Rows close by 2026-11-22.

* **REPORT-ADVOCATE-<survivor>.** A session that wrote none of the plan: make that option as good as its sources
  allow; amend its §3 design in place, each change with its source and *advocate* beside it; list every implementation
  disadvantage left and every way the shared parts handicap it (a change to them proposed for all alike). For the
  carriers, which timings (at once, at hidden, the hybrid) the design runs. No fix after the protocol is written.
* **REPORT-PROTOCOL.** A session that designed and built nothing writes §Protocol: §4's cells per carrier × timing
  and per receiver, with `off` and an A/A `off`; each cell's prediction, bar and VOID rule; the floor probe beside each
  arm; the pilot's rule (format, the hybrid's first send); each kill and drop lever sourced and checked to work on the
  host per engine (a cell an engine cannot run says so); saturation; the mutants (a record never sent, a safety report
  sampled, a field outside the list); round counts sized to the host. Writes the phone cells (§4) as asks into the
  phone protocol's file and says so.
* **REPORT-BUILD-HARNESS.** The sink with its counters, the relay's drop, the kill levers, the fault bench's forced
  mismatch wired to a safety report, the server's link record (§3.4) as a lab arm, `off` and a stub carrier. A failing
  test first per rule, mutated; the gate; the draft PR.
* **REPORT-BUILD-<survivor>** (RECEIVERS builds NGINX and RECEIVER). Its design as written, behind the harness's seam;
  a test per failure the design names, mutated (which mutants each killed); the gate; one smoke round per cell.
* **REPORT-BUILD-REVIEW.** Per standing rule: each test fails without its change; each arm matches its design and
  touches nothing else; each floor measures the raw call alone. Blockers fixed by a later firing of the build's row.
* **REPORT-RUN.** The protocol as written, pilot then counted cells, interleaved; rows pushed as they land; every cell
  against its prediction; where the host saturates; fixtures and limits.
* **REPORT-VERDICT-REVIEW.** The verdict by the rule, per engine, with scope; the loser's question for every arm that
  failed a bar; the safety report's timing and the server's reaction (§5) re-judged against the run. If REPORT-RUN is
  not done by 11-22 08:00, judge the cells pushed and name the rest. Update `docs/client/design.md` §Open by one line;
  telemetry stays off (rate 0), turning it on is the owner's.

### TRANSPORT-INVENTORY (docs only)

Prepares the transport session (`docs/transport-session-2026-11-14.md` on this branch). Write
`docs/transport/design.md` in the structure of `CLAUDE.md` §Docs (on `claude/docs-client`): what the transport is
(one diagram: the downloader worker, the WebTransport session, the server's endpoint, the raw-QUIC mapping), its
rules, *Decided* (BBR against `cubic-restart`, initial window, host networking, the fill and ask on the wire, each
with its date and evidence), *Open* (each with what decides it). Sources: `docs/transport/`, `docs/WIRE.md`, the
transport rows on `claude/work-ledger`, and the branches the DOCS-SWEEP inventory lists (read its parts, and sweep
for transport the same way for branches it skipped as not client side). Evidence files stay where they are this
round; link them. Add to *Open*: **HTJ2K alone over WebTransport against TCP-based stacks (HTTP/2 fetch, WebSocket)
and HTTP/3 fetch**, on the profiles of LINK-TARGETS, with its theory and what decides it.

### PHONE-NEXT-PROTOCOL (protocol only; written by a session that will not run it)

Write `docs/phone-rows/next-round.md` on `claude/phone-protocol`: the next phone round, pre-registered, for the
owner's phone session to run with its runner (read `claude/work-ledger:docs/queue/PHONE-RUN.md` for RUNNER-AUTO's
state; do not change the phone tooling).

* **Read the Amendments below first (5, 6, 7 bind this row).**
* **The commit**: the tip of the branch under review (`claude/unified-client` or what then carries it), pinned and
  checked equal before the first load, so a verdict carries to it.
* **Links**: Wi-Fi counted (the phone on Wi-Fi, the server wired); the tether only for decode-only cells. Say how
  far from the access point and on which band.
* **Cells**: (1) decode per frame on the phone for HTJ2K (OpenJPH-WASM) and the view (WebCodecs, software today) on
  the same source, frames timed in the decoder worker; (2) the delivery arms A, B, C1, C2 as
  `docs/client/design.md` §Decided 2026-11-14 item 4 defines them, recording wire time, decode floor, rest, the
  decoder route taken, bytes, `getStats()` where available, and CPU per process through adb; (3) HW-DECODE-DEEP's
  device probe, exploratory, deciding nothing; (4) the cache cells CACHE-PLAN names (the cold read speed first), if
  pushed by then.
* **A view comparison that can conclude**: the last run left every fill comparison undecided because its
  10-minute rule cut it to four octets, and the 2 × 2 design (view × controller) split ten ratios four ways.
  Drop the controller factor (`cubic-restart` is the decided default); measure what theory says the views differ
  on — a step's and a Lossless ask's latency with the page busy (fixed long tasks), not only the fill; enough rounds
  for the rule with the runner's automation; a stopping rule that counts time loads ran, not time stopped after a
  failure; the fixes for the two phone failures (PRs 376 and 378, or their successors) in the commit, or the
  failure mode excluded by name.
* Predictions per cell before any data; interleaving; where the phone saturates; what each cell can and cannot
  decide; the fixtures (one phone, one link, few series) stated.
* This supersedes `docs/queue-2026-11-14.md`'s PHONE-AMEND-3 (not started); say so in that file's row by one line.

### PHONE-NEXT-PROTOCOL-REVIEW

A session that wrote none of it: every cell's prediction is written before data, every arm is defined as
`design.md` defines it, the view comparison can reach its rule's n in one evening at the runner's pace, nothing the
phone tooling cannot do is asked. Findings in the file's "Review" section; the author's fixes follow on the same
branch by a later firing of this file's worker only if the review marks them as not the owner's.

## Amendments (the owner, 2026-11-14 evening; they bind every row that has not finished, and its review)

1. **Every frame is checked, in production too.** The owner: "for OQ AV1 frames and for the lossless frames [we] will
   need to use xxh3 for verifying the hashes. And this will likely be a requirement even in production. So our
   painting approach or our general architecture will need to support that." So HW-DECODE-DEEP's "the view need not
   be read back" is answered only together with the check: for each hardware path, how the decoder's exact output
   samples reach an XXH3 (a read-back, a format that maps, a hash computed where the planes are), or why they cannot.
   A path that paints but cannot be checked does not serve the view. HW-DECODE-DEEP-REVIEW applies this to what
   HW-DECODE-DEEP pushed and corrects it in place.
2. **Why `prefer-software`.** The owner: "I don't even get the point of this parameter being used when av1 is mainly
   interested for us with hardware decoding." HW-DECODE-DEEP (or its review) traces when and why it was set
   (`git log -S prefer-software --all`, the rows and docs of that date), states the reason as recorded, and whether
   it still holds now that the view is lossy and checked by its reconstruction digest. If no reason is recorded, it
   says so: that is a documentation finding.
3. **4:2:0 grey for hardware.** The 4:2:0 form with constant mid-grey chroma was measured at +0.20–0.23 % bytes and
   rejected (`docs/av1/payload-format.md` §8-bit grey as 4:2:0) on Chromium's *software* decode cost alone; no
   hardware decoder was ever in a cell. Re-judge it for hardware at 8 and 10 bits, sources first.
4. **Claims are sourced as they are written.** Every statement about an engine, a spec or a chip in the docs is
   written with its official source quoted, as the docs will carry it.
5. **The phone round is fully automated.** The owner: "complete automation. With zero need of [me] during the
   entire comparison … only open the browser and at most click a start button, but a single one, and at the very
   beginning." PHONE-NEXT-PROTOCOL designs the round so: one press starts it; the runner page drives every load,
   press and wait; the server arms switch from the laptop's script; the screen is kept on (the Screen Wake Lock
   API, sourced) and the page visible; counted cells only where no hand is needed (Wi-Fi; a tether cell only if its
   switch is scripted). It lists what the runner (RUNNER-AUTO, the phone session's) must add for this, as asks for
   the phone session, without changing its tooling. A run's stopping rule counts its wall-clock time.
6. **What the two views differ on, from theory**, for the view comparison's cells (each a prediction, labelled
   theory, then measured): where the controller, the store and the paint run (the page's thread or the view
   worker's), so (a) input to painted latency for a step, a cine frame's pacing and dropped frames, and a Lossless
   ask, each with the page's thread idle and with fixed long tasks on it; (b) the first picture (the view worker's
   start); (c) the fill (predicted equal: the decode runs in the decoder workers in both, unless a busy thread delays
   the acks and the credits pause the wire); (d) memory, page and workers; (e) messages and hops per frame
   (`docs/client/design.md`). The protocol says which of these decides the view and why.
7. **The last phone run's six octets.** The owner asks why octets 5 and 6 would be discarded. Until the owner says
   otherwise, the six-octet reading is the one reported, labelled a departure from the Second amendment (whose
   10-minute rule bounded an evening's length, planned with no margin over its eight ratios), with the four-octet
   reading beside it. PHONE-NEXT-PROTOCOL gives its own rule a margin over its minimum n.
8. **Unification preserves history.** The owner: unify "by merging all the branches that have relevant work instead
   of creating a branch for main to where we port the thing that we are only interested in. Or squashing … I would
   like the history to be preserved, even if it's a bit messy and very long." So merges are `--no-ff` merges of the
   branches themselves, conflicts resolved in the merge commit, cleaning done by commits after (the 11-11 rule:
   nothing reaches `main` uncleaned; a removal is a commit, recoverable from history). Copy-by-edit stays only for
   the documentation rows of this round, whose source branches are merged later. The two-week rule still holds:
   no merge without the owner's word.

### HW-DECODE-DEEP-REVIEW

A session that did not write HW-DECODE-DEEP: check every quoted source against its pinned revision (pick 15 at
random and fetch each), apply amendments 1–4 to what was pushed, correct `docs/decode/hardware.md` and the PR in
place, and list for the owner what the sources settle and what only a device run can (the probe).

### MERGE-ALL-PLAN (findings only; test merges in a scratch clone, nothing pushed but the report)

Amendment 8's plan for the client side: every remote branch with client-side work not carried by
`origin/claude/unified-client` (start from DOCS-SWEEP's inventory, `claude/work-ledger:docs/queue/DOCS-SWEEP-inventory.md`,
and `claude/merge-plan:docs/reviews/merge-plan.md` §5's ancestry method). For each: relevant or not (and why, in one
line; "superseded by" names what), carried in part by patch, its PR. Then a merge order into
`claude/unified-client` (oldest base first, dependents after their bases), and for each step a **test merge** in a
local clone (`git merge --no-ff`, never pushed): conflicting files, what each conflict is, and the resolution the
later decisions imply. End with the expected tree differences against today's tip, the cleaning commits that would
follow, and the owner's calls (one per branch whose relevance is a judgment). Read only; no PR.

9. **Frame integrity, sourced** (`claude/docs-client:docs/client/evidence/frame-integrity.md`, 2026-11-14): QUIC's
   AEAD discards a corrupted packet and its data is resent, so the wire cannot deliver wrong bytes; corruption can
   still arise at the server's storage or memory, in the client's own receive code above QUIC, or in the decoder. A
   re-ask fixes only a transient client-side fault, and hides the bug unless the first failure is reported. Today's
   digest is over decoded samples, so it cannot tell received bytes from decoder; **a second ingest-time digest over
   the coded bytes, checked before decoding, would** (a candidate, the owner's to adopt). REPORT-OPTIONS and every
   REPORT row read it; the report carries a random opaque series key (never a UID or a hash of one), the frame index,
   which check failed, what followed, the decoder build and a random session id.

10. **Claims to re-verify before they bind** (the owner, 2026-11-14: "important claim. Needs to be reverified"):
    HW-DECODE-DEEP-REVIEW verifies or refutes, sources quoted: (a) that no browser path lets the frame check hash a
    hardware decoder's output, including a hash on the GPU of a converted texture against a digest predicted at
    ingest (is the YUV to RGB conversion of `importExternalTexture`, `texImage2D(VideoFrame)` or `copyTo` with an
    RGB format specified exactly, or implementation-defined?); (b) the owner's question "how can the only mechanism
    to take out a frame from webcodecs not support its output format": the spec's `format` "will be null whenever
    the underlying format does not map" (§9.4.1); a frame still leaves as a picture (drawn, uploaded, or `copyTo`
    with an RGB format, converted, 8-bit) but not as its samples; and whether `copyTo({format: "I420P10"})` from a
    `P010` frame (a re-layout, lossless) is specified or implemented in Chromium, which would give the samples back.
11. **No probably-valid data is discarded** (the owner, 2026-11-14). The 11-11 phone run's six octets are the reading
    of record; the four-octet reading stays beside it as what the Second amendment's rule gives. Correct
    `claude/phone-rows:docs/reviews/phone-blind-read.md` §3 and the line docs that quote it in place (DOCS-FIX or
    PHONE-NEXT-PROTOCOL, whichever runs first). A future rule may stop a run early; it never excludes loads that
    ran under the protocol's conditions.
12. **Names of the view comparison's measures, provisional.** "A step" and "a Lossless ask" were the orchestrator's
    words, never accepted. The glossary has *ask* (a request for one frame, served next) and *exact frame*. Until the
    owner picks: **frame-change latency** (a reader's input to another frame, to that frame painted) and
    **exact-frame latency** (the Lossless control pressed, to the exact frame painted with *✓ Lossless*). The protocol
    uses these and proposes them, or better ones, as glossary rows for the owner.
13. **One unified branch** (the owner, 2026-11-14: "once they arrive in a single unified (because that will be more
    convenient for working with integrations) the cleaning, optimization, simplification, improvements and other
    preparation work should be done to get to main"). MERGE-ALL-PLAN covers every line, not the client's alone: the
    branches with relevant work merged `--no-ff` into their line's unified branch where one exists, then the line
    branches into **one** unified branch (name proposed), in an order; then the preparation for `main` as rows of
    their own. Its report opens with a one-screen summary for the owner's approval: the order as a list of merges,
    each with its conflict count, and the calls that are the owner's.
14. **8 bits for hardware, investigated first** (the owner, 2026-11-14: "we could even consider using only images up
    to 8 bits of depth in order to be able to use the hardware capabilities of the browser. But … we won't give up
    until we have no other choice. So first is to investigate and test"). DEPTH8-THEORY: the depth cut to 8 bits for
    the optimal-quality view, from the noise numbers already measured (σ by frame on the 19 DBT volumes; a cut of
    2^k adds rounding of RMS 2^k/√12 in source units), against the noise rule's bar and at the windows readers use;
    8-bit 4:2:0 grey (constant chroma) as the form hardware takes; what Firefox and Safari's 8-bit paths gain; a
    prediction per volume and a pre-registered protocol for DEPTH8-MEASURE (`lab/av1/metrics`, cloud). No
    decision: it informs the codec question.

### HW-PROBE-PAGE (a lab tool; built by the owner's local session `phone-tests` and run by it on the phone)

The owner, 2026-11-14: "we might need to build something independent from the app to test the browser in the phone
and get more specific feedback than 'this didn't work' or 'this fallback means this wasn't or couldn't be used'."
Inside the device kit `lab/devices/` (amendment 15; no product import; `scripts/check_lab_absent.sh` green), one press to start, that
runs a matrix and writes one JSON report (shown, saved with a download link, and posted to the dev server if one
answers). For each AV1 stream form (4:0:0 and 4:2:0 constant-chroma grey at 8 and 10 bits; tiny bundled units from
`lab/av1`'s existing fixtures or made by the ingest) × `hardwareAcceleration` (`no-preference`, `prefer-hardware`,
`prefer-software`): `isConfigSupported`'s answer, `configure`'s outcome, each `decode`'s output or the exact error
name and message, the frame's `format`, `codedWidth`, `colorSpace`, `copyTo` with no format and with each format the
spec lists (outcome, and the samples' XXH3 against the unit's expected planes), time per frame. Then the paint paths
(WebGL2 `texImage2D(VideoFrame)`, WebGPU `importExternalTexture`) with a precision check (a 10-bit ramp: how many
distinct levels survive). Then the environment: the browser's version and platform, `hardwareConcurrency`, the GPU
adapter's info. Reuse the WebCodecs capability probe and fixtures that exist (search `lab/` and `docs/decode/`); the
expected values come from the ingest's digests. Its README gives the phone session's steps (one press) and what to
read from `chrome://media-internals` by hand, the one thing a page cannot see. Test it headless in Chromium in the
container (software paths only; say so), each check's failure mode mutated.

### HW-PROBE-PAGE-REVIEW

The local session that builds the probe has no PR tool: if `claude/hw-probe` has no open PR, open it as a draft into
`claude/docs-client` through `mcp__github__create_pull_request`, its title and body from
`claude/work-ledger:docs/queue/HW-PROBE-PAGE-pr-body.md`, then review. A session that wrote none of it: every cell's outcome is recorded, never swallowed; the expected planes are right
(mutate one); one press runs the whole matrix; nothing from `lab/` leaks into a product path.

### DEPTH8-MEASURE

A session that wrote none of DEPTH8-THEORY runs its protocol as written (an amendment before any run if the host
forces one), every cell against its prediction, misses included; fixtures and limits stated.

15. **The device tooling has one home, `lab/devices/`** (the owner, 2026-11-14: the probe and the automated runner "could
    evolve into something that we use recurrently … maybe not formalize it now too much"). `lab/devices/` is already
    the device kit (`caps.js`, the D0 capability probe; `runner.js`; `collector.py`; `docs/devices.md` owns its
    readings). HW-PROBE-PAGE extends `caps.js` and the kit's runner page rather than adding a page of its own, and
    the one-press runner grows from the kit's runner; `claude/phone-rows:lab/phone/` (the 11-11 run's runner and
    beacon) is folded into the kit by a later merge and a cleaning commit, so one runner remains. It is measurement
    harness, so it may live on `main` under `lab/` (`scripts/check_lab_absent.sh`: never in a product path or
    image). No design document yet: the kit's README and `docs/devices.md` only.

16. **10 bits on hardware is the goal; 8 bits the fallback** (the owner, 2026-11-14: "not cut resources on 10 bits
    yet. This might be a critical phase, so increasing them even could be justified"). HW10-ROUTES gets its own row.
    Every not-before in this file is now 11-14 21:00: rows wait only on their needs (the owner, 2026-11-14: "dispatch
    all the pending cloud work. Plenty of usage").

### HW10-ROUTES (theory and sources; nothing run on a device)

Question: **every route by which a hardware-decoded 10-bit AV1 frame can be painted at full precision and checked
against its digest (amendment 1), in a browser and natively, ranked.** Read first: `docs/decode/hardware.md` as
HW-DECODE-DEEP and its review left it (PR 387), and `claude/work-ledger:docs/queue/HW-PROBE-PAGE.md` (the probe's
finding: in headless Chromium 141, `copyTo({format: "I420P10"})` of a 10-bit software frame blocks its thread; trace
why in Chromium's source and whether 157 does the same). Routes at least, each with its official sources quoted at a
pinned revision, what it needs from the browser, which engines and platforms ship it, and how the check is done:

* WebCodecs `copyTo` into a 10-bit planar format from a hardware frame (a lossless re-layout of `P010`), and the
  `WebCodecsHBDFormatsEnabled` formats;
* WebGPU: importing a `VideoFrame` as a multi-planar texture (Dawn's biplanar 4:2:0 formats, 8- and 10-bit, and the
  WebGPU features or Chromium flags that expose them), `importExternalTexture`'s precision, `copyExternalImageToTexture`
  into a 16-bit or float format; then a compute shader that reads the luma plane at full precision and computes
  XXH3-64 on the GPU against the ingest digest (feasibility of a 64-bit-multiply hash in WGSL; cost per frame);
* WebGL2: any extension or upload path that keeps more than 8 bits of a `VideoFrame`;
* Android: whether Chromium can hand WebCodecs a MediaCodec frame as YUV planes (ByteBuffer mode, `Image` readers),
  and under which flags or versions;
* Native (`client/native`): MediaCodec, VideoToolbox, VA-API, NVDEC, Vulkan Video and D3D12 giving `P010` planes, and
  whether each takes 4:0:0 or needs 4:2:0 with constant chroma.

End with a ranked table (route × platform → decodes in hardware, painted at full precision, checkable, ships today or
behind a flag, cost), the cells the device probe must add for the top routes (append them to the probe's README as
asks for the device session, without changing its code), and what would be needed upstream (a spec issue or a
Chromium bug) where a route is blocked only by a missing format. Theory labelled; no claim from memory.

### HW10-ROUTES-REVIEW

A session that wrote none of it: fetch 15 of its quoted sources at their pinned revisions and check each quote; check
the ranking follows from the table; say which top route is decided by sources alone and which needs the device.

17. **A review that finds blockers starts the fix loop by itself** (the owner, 2026-11-15: the cache builds stopped at
    their review's seven blockers because no row existed to fix them; "we'll need to design better loops"). From now
    on, in every queue: a review row that finds blockers appends to its queue file a **<ROW>-FIX** row (the fixes,
    each with a failing regression test first, mutated) and a **<ROW>-FIX-REVIEW** row (a session that wrote neither:
    each blocker closed, its test failing without its fix, nothing else changed), and makes the next row's needs wait
    on the re-review. Two rounds at most; after a second review with blockers open, the row is `blocked` for the owner.
    Applied now: CACHE-FIX and CACHE-FIX-REVIEW before CACHE-RUN; the same holds for REPORT-BUILD-REVIEW.
18. **Native is paused** (the owner, 2026-11-15: "for now, we are pausing the native path. we will merge it, and in the
    future keep experimenting with it … write down what we found related to it so that it can be continued"). It
    rides the merges as an experimental crate (off the served path, as today); no row builds or measures it.
    NATIVE-NOTES writes the record.

### CACHE-FIX

Fix every blocker in `claude/cache-arms:docs/reviews/cache-arms.md` §Verdict (three in the arms, four in the
harness), each with a regression test that fails without its fix (mutated), the arm's design unchanged unless the
blocker is the design's (then say so in the PR body). The survivors and minors the review listed: fix those that are
one-line, list the rest. Gate, `scripts/check_lab_absent.sh`.

### CACHE-FIX-REVIEW

A session that wrote neither the builds nor the fixes: each blocker closed (revert its fix, see its test fail); no
other behaviour changed; the harness's bars computed against the arms they claim. If a blocker remains, amendment 17.

### NATIVE-NOTES (docs only)

`docs/native/README.md` (and, if the structure of `CLAUDE.md` §Docs applies, `docs/native/design.md` in its form): a
status line "paused 2026-11-15, the owner's", what is built and measured (M1–M3, the window, NATIVERUN's design, the
lab settings still in `window.rs`), what was found since about native as **the 10-bit hardware route**
(`docs/decode/hardware-10bit.md`: MediaCodec ByteBuffer `P010` ranked first for phones, Vulkan with a GPU hash, 4:2:0
constant chroma except on NVDEC), and **how to resume**: the first three rows a future session would run, each with
what decides it. One screen first, detail after. Update `docs/lines/native.md` to work state "paused".

## Procedure, rules

Each firing follows `docs/queue-2026-11-14.md` §The worker's procedure, §No work lost and §Standing rules, applied to
**this file's rows only**, with these changes: step 3 counts this file's running rows (at most twelve); step 4
ignores the 22:00–06:00 restriction; the queue closes 2026-11-22 23:59. Status files are `docs/queue/<ROW>.md` on
`claude/work-ledger`. No merges; PRs are drafts into `claude/docs-client` as the table says, through
`mcp__github__create_pull_request`. Sources quoted verbatim, theory and measured labelled, fixtures and limits in
every result.
