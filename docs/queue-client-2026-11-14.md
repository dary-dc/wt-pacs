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
| HW-DECODE-DEEP | 11-14 19:00 | — | `claude/hw-decode` from `origin/claude/docs-client` → draft PR into `claude/docs-client` |
| LINK-TARGETS | 11-14 19:00 | — | `claude/link-targets` from `origin/claude/docs-client` → draft PR into `claude/docs-client` |
| BEACON-LINK | 11-14 19:00 | — | `claude/telemetry-client` (a proposal section in its ADR; no code) |
| CACHE-PLAN | 11-14 19:00 | — | `claude/cache-plan` from `origin/claude/docs-client` → draft PR into `claude/docs-client`; rows appended to this file |
| TRANSPORT-INVENTORY | 11-15 08:00 | DOCS-FOLD done (the other queue) | `claude/transport-design` from `origin/claude/docs-client` → draft PR into `claude/docs-client` |
| PHONE-NEXT-PROTOCOL | 11-15 10:00 | HW-DECODE-DEEP and LINK-TARGETS done, or 11-16 08:00 | `claude/phone-protocol` (docs; no PR unless the branch has one) |
| PHONE-NEXT-PROTOCOL-REVIEW | 11-16 08:00 | PHONE-NEXT-PROTOCOL done | findings in its file's "Review" section |
| *(CACHE-PLAN appends its rows here)* | | | |

A session never reviews a row it wrote. At most three rows of this file run at once.

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

### BEACON-LINK (a proposal; no code)

On `claude/telemetry-client`, in `docs/adr/telemetry-in-production.md`, a section *The link in the load report*:
the WebTransport `getStats()` fields (spec text quoted; which Chromium and other engines implement, with sources),
the server's QUIC statistics for the same session and how to join them without identifying anyone, the summary to
record (min and smoothed RTT, delivery rate, loss counts, bytes), its size; and a *save report* control in the
developer overlay that gives the same record as a file. Weigh it against keeping the link only server side; say
what the demo's transport file sets (sampled at 1 in a demo, the product's rate elsewhere). The safety report
(`docs/client/design.md` §Decided, 2026-11-14 item 2) is a separate kind of record: say how this fits beside it.

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

## Procedure, rules

Each firing follows `docs/queue-2026-11-14.md` §The worker's procedure, §No work lost and §Standing rules, applied to
**this file's rows only**, with these changes: step 3 counts this file's running rows (at most three); step 4
ignores the 22:00–06:00 restriction; the queue closes 2026-11-22 23:59. Status files are `docs/queue/<ROW>.md` on
`claude/work-ledger`. No merges; PRs are drafts into `claude/docs-client` as the table says, through
`mcp__github__create_pull_request`. Sources quoted verbatim, theory and measured labelled, fixtures and limits in
every result.
