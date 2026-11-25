# Codecs and lab

Last verified 2026-11-25 (owed runs: the session cost); 2026-11-20 (PR state, branches, and the transport and HTJ2K rows of
`claude/work-ledger:docs/queue-2026-11-14.md` and `queue-client-2026-11-14.md`); the AV1 findings as of their dates.
The optimal-quality view's measured state, the study branches, the harvest of 2026-11-10, the owner's questions and
decisions: [`../av1/README.md`](../av1/README.md) §The optimal-quality view; HTJ2K at screen resolution:
[`../htj2k-tiles.md`](../htj2k-tiles.md) (§The work in short); the transport:
[`../transport/design.md`](../transport/design.md).

## Goal

HTJ2K and AV1, the server, the transport and the disk, investigated and measured to `CLAUDE.md` §Measurement. The PCS
encodes, so a codec finding is a recommendation to the PCS team and an input to the PACS line. Structural theory (what
follows from a format's definition or arithmetic) discards cheaply and names candidates; sizes and times are always
measured, and every result names its fixtures.

## In flight

* **HTJ2K A1**, the attribution run of D+T3's Lossless gain ([`../htj2k-tiles.md`](../htj2k-tiles.md) §Verdict):
  arm D+T1 built and reviewed 2026-11-19 (no blocker; PR 408); HTJ2K-A1-RUN running since 2026-11-20 08:00 on
  `claude/htj2k-a1`; then HTJ2K-A1-REVIEW and the `exact-frame-layout` decision page.
* **The transport comparison** (the subject's design: [`../transport/design.md`](../transport/design.md), #391):
  HTJ2K alone over WebTransport against HTTP/2 `fetch`, WebSocket and HTTP/3 `fetch` on the link profiles; theory,
  protocol and results in `claude/transport-design:docs/transport/evidence/stacks.md` (theory and a prediction per
  profile 2026-11-17; §5 pre-registered the same day: eight arms, fourteen cells through the TUN relay). Built, reviewed, fixed and run
  2026-11-18/19 on `claude/transport-arms` (PR 403; `claude/transport-arms:lab/transport-arms/`,
  `claude/transport-arms:docs/reviews/transport-arms.md`): every
  frame exact; fills tie on clean links; after a 5 s silence the TCP arms are ×1.35–1.70. Verdict-reviewed
  2026-11-19 (`stacks.md` §6.5): §6 reproduced from the rows, CR's H2-fill a miss, ENT unbalanced, AD's fill forms
  struck for a carrier defect, fixed and reviewed the same day. AD re-run 2026-11-19
  (`stacks.md` §6.6): H3-fill and H2-fill answer an ask during a fill faster than WT-TS (0.50–0.68), a miss below
  §5.3's ×1.0–2.0. Next: the `transport-stack` decision page (TRANSPORT-PAGE). One 4-core container, Chromium 157
  headless, the TUN relay ≤ 90 Mbit, `dbts_b1` HTJ2K, no radio.
* **The audits' corrections** ([`../av1/corrections.md`](../av1/corrections.md)): every entry applied in place
  2026-11-20 by row CORRECTIONS-APPLY (`claude/av1-corrections-apply`, PR 416), reviewed 2026-11-22; it merges after
  PR 415, after its re-review.
* **The noise rule at ingest**: its protocol written 2026-11-19 (NOISE-INGEST-PROTOCOL, `claude/noise-ingest`, draft
  PR 413); NOISE-INGEST-MEASURE next, ending in the `ingest-optimal-quality` page.
* **An 8-bit depth cut for hardware** ([`../av1/depth-cut-8.md`](../av1/depth-cut-8.md), theory 2026-11-14, measured
  2026-11-15 on all 19 volumes): the cut alone stays under the noise; coded, predicted at 0.82–2.44 times today's
  view's bytes, the 8-bit view meets the noise rule at Q 3–11 at 1.14–1.86 times; 4:2:0 adds +0.01–0.12 %; it buys a
  checked hardware path on desktop Chromium only (4:2:0 grey, `NV12`), whose exactness and speed on a desktop GPU
  are open.
* **The series server's network mode** ([`../transport/network-mode.md`](../transport/network-mode.md), theory
  2026-11-12): host networking for `server` and `exact` (rootless pasta's publish drops at the host what the
  controller reads as congestion, carries no ECN and splits every GSO send); unmeasured, its §6 check owed to a phone
  round, written by a session that will not run it.
* **One place for the coded sets** ([`../reviews/dataset-hub.md`](../reviews/dataset-hub.md), findings 2026-11-11): a
  recipe key and a pin file; release assets on this repository lead.

## PRs

| PR | what | state |
| --- | --- | --- |
| #398 | stage A1: this line's 34 branches into `claude/unified-codecs` (five by `-s ours`, call M1: [`../av1/README.md`](../av1/README.md) §Paths kept in history only); the gate green, the product the baseline but the two lines of a `stallMs` key; blind review in its body, no blocker | draft; in `claude/unified`; `av1-paint-depth` (#309) stays out (call M6) |
| #340, #350 | the two reviewed line-doc PRs of `claude/unified-codecs` | draft |
| #329, #331, #332, #334 | quality audit; encoder settings; noise ratio; decode audit | draft; their branches in `claude/unified` |
| #391 | the transport's design, an inventory | draft |
| #403, #408, #413 | the transport arms; HTJ2K A1; the noise rule at ingest | draft |
| #254, #317, #323, #325, #326 | the server's 13 results (congestion and disk designs, PGO, tail ping, GSO, others; no default changed); noise point; window and Q; VL metrics; groups | closed 2026-11-18, not merged; branches in `claude/unified` |
| #283, #288, #290, #305, #306, #312, #314–#316, #318 | the AV1 result chain into `av1-unified-mainbase` | closed 2026-11-18, not merged; branches in `claude/unified` |

## Owed runs

* **The cost of a reading session** ([`../server/session-cost.md`](../server/session-cost.md), pre-registered
  2026-11-24): server CPU, peak memory and wire bytes a session, arms A, A+C1, B, FIT on CLEAN and CR; its review,
  then SESSION-COST-RUN and -VERDICT (`claude/work-ledger:docs/queue-2026-11-24.md`).
  Reviewed 2026-11-24 (PR 441's body): four blockers, among them §3's ask counts against the product's own code and
  PR 446's reversal on `dbts_b1`. Fixed in place 2026-11-24 (§9): counts from the product's code, two tables (the
  tip's and PR 446's), FIT's *W* both ways, claims against the frame retrieve only. Re-reviewed 2026-11-24 (PR 441's §Re-review): no
  blocker open, the counts reproduced at both commits; r-m1 (CR's CPU multiplier per form) for the run. Run 2026-11-24
  (SESSION-COST-RUN, §9's amendment and §Results; rows on `claude/session-cost-rig`): 147 sessions; the view's
  asks on `dbts_b1` and `dbts_c1` a third to two thirds of T1's, so B is the dearest arm everywhere; lowest bytes A
  on `dbts_a1` and `dbts_c1`, FIT on `dbts_b1`; exact-frame CPU and every peak RSS above their bands. Verdict review 2026-11-25 (§Verdict review): the table and every lowest arm reproduced; B1, the CPU claim against the frame retrieve is CLEAN's only; m1, the bytes are delivered, not sent (CLEAN's FIFO overflowed). Verdict fix 2026-11-25 (§Verdict fix): CPU claim scoped to CLEAN, delivered bytes with the overflow as an upper bound per cell, CR's CPU read per form; no lowest arm moves; SESSION-COST-VERDICT-FIX-REVIEW next.
* **G at equal quality** (`claude/av1-groups`): shard 2 (`dbts_a1`, `dbts_c1`, TRUS; about 4.3 h on one 4-core host)
  and the collect without `--partial`; the settings shard S2 (A, C cut); a structure-only source with no coding error
  of its own; a finer ladder at Q 8–12. Decode time in order matters more than jumps. No G is decided for DBT.
* **The decode audit's three checks** (`claude/av1-audit-decode`): D1 at 4× with a core cap; one block with `back()`
  off the clock; the product's HTJ2K path beside each study's unit on one Chromium. Until then the view's decode is
  quoted at Q 8 only, with its stream, host and throttle.
* **The noise-ratio protocol** (κ measured, a model observer on calcifications), before any reader study.
* **Noise detection at ingest** (σ_min, its estimator's timing on the three volumes), then handed to the PCS team.
* **To a GPU machine or a phone**: hardware decoders' exactness, reduced-depth paint timing, group arms, the view's
  decode speed on a real slow device; HTJ2K's phone runs P1–P3 after A1; the network mode's §6 check.
* **The coded sets**: the same bundle digests on two hosts.

## Waits for the owner

The harvest's ten questions ([`../av1/README.md`](../av1/README.md) §The owner's questions of the harvest): one bar of
1.03; Q 8 hard-coded for the demo; quoting bytes at the rule's Q; a temporally denoised view; groups shard 2; the
zero-encode re-reads first; holding WebCodecs speed claims; the noise-ratio protocol first; "also for diagnosis"; the
study branches' corrections. Also: the anchor quoted as [Q_lo, Q_hi] with ν beside, and "keep at least half" (Q_ν) as
an option; a note to the PCS team on G for AV1 cine, and keeping or removing the client's G > 1 path; the held server
defaults in `line-server`'s index (#254); whether an 8-bit view is acceptable; a GET path in the product (`stacks.md` §5.5); who
uploads the coded sets; any merge, close or removal.

*Corrected 2026-11-22:* this list also held "the idea of 2026-11-09, undecided (optimal quality split into top and
low bits, the low on request)", whose target was "the optimal-quality image, not lossless"; the owner discarded it
on 2026-11-09 ([`../av1/README.md`](../av1/README.md) §The owner's decisions), so nothing waits on it.

*Dropped as superseded 2026-11-20* (recoverable from this file's history at `4a2b4277f`): Open 2, harvesting the AV1
chain into `av1-unified-mainbase` (its PRs closed 2026-11-18, their branches in `claude/unified`); Open 11's
"Next: stage B" (stage B ran 2026-11-15; its pointer to §Paths kept in history only is in the #398 row);
§The unified branch's "every other PR of the line's chain waits for a review row" (those PRs closed 2026-11-18).

## Pointers

`docs/av1/` (`README.md`, `payload-format.md`, `encoder-settings.md`, `audit-protocols.md`, `corrections.md`,
`MAINBASE.md`, `queue.md`), `docs/htj2k-tiles.md`, `docs/decode/README.md`, `docs/FIXTURES.md`, `docs/transport/`,
`docs/adr/disk-access.md`, `lab/`; the study branches, each in `claude/unified`: `claude/av1-unified-mainbase`,
`claude/av1-quality-metrics:lab/av1/metrics/README.md`, `claude/av1-quality-profiles:lab/av1/profiles/README.md`,
`claude/av1-noise-point:docs/av1/noise-point.md`, `claude/av1-window-q:docs/av1/window-q.md`,
`claude/av1-vl-metrics:docs/av1/vl-metrics.md`, `claude/av1-noise-ratio:docs/av1/noise-ratio.md`,
`claude/av1-encoder-settings:docs/av1/encoder-settings.md`, `claude/av1-audit-quality:docs/av1/audit-quality.md`,
`claude/av1-audit-decode:docs/av1/audit-decode.md`, `claude/av1-groups:docs/av1/groups.md`, `claude/av1-svc-preview`,
`claude/line-server`. The unified codecs branch: `claude/unified-codecs`, from `claude/av1-unified-mainbase`.
