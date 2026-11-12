# Codecs and lab

Last verified 2026-11-12 against the demo tip `claude/demo-fixes-2` `18d2d1ff` (PR 367), the queue's status files
(`claude/work-ledger:docs/queue/`), the AV1 harvest (#350), the audits' corrections (#357) and their measurement
(#373), and the open AV1 and HTJ2K PRs.

## 1. Goal

HTJ2K and AV1, the server, the transport and the disk, investigated and measured to `CLAUDE.md` §Measurement. The PCS
encodes, so a codec finding is a recommendation to the PCS team and an input to the PACS line. Structural theory
discards cheaply and names candidates; sizes and times are always measured, and every result names its fixtures.

## 2. On `main` after this week's merge

What PR 367 then PR 250 carry once the owner gives the two words; until then all of it is on `claude/demo-fixes-2`.
The studies behind it are not carried: they stay on their branches and PRs (§4, §6).

* **The AV1 payload** (`docs/av1/payload-format.md`): the format, the representations, §Decoder choice, §For the PCS
  team, §Optimal quality with §Depth cut and §Source fingerprint.
* **The optimal-quality pair, written by the lab tool** (`ingest/coded-frames/ingest.py`, `scripts/demo-series.sh`),
  not by the product ingest: an AV1 series at a given Q and G, the depth cut for D > 10, the exact HTJ2K series beside
  it, both carrying the XXH3 `sourceFingerprint`; Q 0 refused as lossless; `lossy_test.py`. Which ingest writes the
  pair in the product is row INGEST-OQ ([`optimal-quality.md`](optimal-quality.md) Open 6).
* **The decode route** (`client/decode/`, line [`client.md`](client.md)): WebCodecs first, dav1d-WASM only after a
  refusal or a failed decode (`av1-probe.js`); HTJ2K through OpenJPH-WASM; every exact frame checked with XXH3.
* **Server and transport** (`server/`, `docs/transport/`, `docs/adr/`): `--congestion cubic-restart` the default,
  `bbr` and `bbr-bound` as options (`server/src/transport/tuning.rs`); the server's lab flags behind the `lab-levers`
  feature; the disk paths of `docs/adr/disk-access.md`.
* **The lab harness** under `lab/` (`lab/av1/`, `lab/decode-bench/`, `lab/scripts/link_impair.py`, …), held off the
  product by `scripts/check_lab_absent.sh` in the gate.

## 3. Decided (never reopened by an agent)

| decision | date | recorded |
| --- | --- | --- |
| Frames of 12 bits or fewer are filled, deeper ones fit plus tiles; never a reduced-resolution preview | 2026-10-10 | this file |
| XXH3 replaces SHA-256; DBT in scope | 2026-10-12 | this file |
| GPU decoding not pursued for now | 2026-10-13 | this file |
| Tiles delayed, not closed; AV1 types without open data parked until a dataset exists | 2026-10-24 | this file |
| No end-to-end G > 1 build | 2026-10-26 | this file |
| AV1 scope: cine-like series (one consecutive dimension), breast first, ≤ 12 bits; late frames appended only | 2026-10-30 | this file |
| Hardware decode only through WebCodecs; VVC parked | 2026-11-02 | this file |
| No per-browser-version defaults; every decision states its fixtures' limits | 2026-11-04 | this file |
| Full depth on the client; one noise point per candidate; lossless AV1 and SVC kept outside the top | 2026-11-05 | this file |
| A preview, if any, is the small full-size stream only | 2026-11-06 | this file |
| Optimal quality plus the exact HTJ2K frame on request; the residual dropped. G fixed per modality by measurement (no adaptive detector); Q per series by the noise rule; the PCS chooses both, and our side handles any Q, G and depth. Splitting the view's samples into top and low streams discarded (a second encode; a lossy top cannot be completed by low bits) | 2026-11-09 | this file; [`optimal-quality.md`](optimal-quality.md) |
| WebCodecs decodes the optimal-quality view, dav1d only as the fallback; D ≤ 10 at its own depth, the depth cut for D > 10; no 8-bit preview. Every encoder setting used is known, sourced and backed by theory before its results count, and results are audited for confounds of that kind | 2026-11-10 | this file |
| The optimal-quality series is always ≤ 10 bits on the product path; the stored form is a lab option | 2026-11-11 13:30 | `claude/work-ledger:docs/queue-2026-11-10.md`, the owner's decisions |
| `cubic-restart` stays the default; `bbr` and `bbr-bound` stay options; real-world runs with both decide (P1's "adopt" holds only for its cells) | 2026-11-11 13:30 | same; `docs/transport/transport-conclusions.md` §1 |
| Tiles in the AV1 encode (P2) wait; the scroll is visually lossless AV1, the whole HTJ2K frame on request | 2026-11-11 13:30 | same |
| The pairing's same-source check lives in the ingest, computed with XXH3 | 2026-11-11 13:30 | same; `docs/av1/payload-format.md` §Source fingerprint |
| AV1 only for cine-like series; no low-resolution preview; mobile on lossy wireless is the target | 2026-11-11 | same, §Decided approaches |

## 4. Open, ranked

Fixtures for every result below unless it names fewer: timings on three EA1141 breast tomosynthesis volumes,
`dbts_a1`, `dbts_b1`, `dbts_c1`, all of one dataset (A and C 12-bit, B 10-bit; noise by Immerkær's estimator, the
noise rule's: A and C 10–18, B 3.4–5.7 by frame); quality on 19 DBT volumes of that dataset; no breast ultrasound
cine or ABUS ([`../FIXTURES.md`](../FIXTURES.md)); 4-core cloud hosts without a GPU, software WebCodecs, headless
Chromium; a userspace relay or netem, not a radio; one phone run on one home link. Each claim is labelled measured,
derived or theory.

**Where the line stands** (the inputs to the questions below):

* *Bytes* (measured, Q 8, G 1): the view is 0.07–0.22 of HTJ2K's bytes, view plus the whole exact frame 1.07–1.22×.
  At the noise rule's Q, 0.10–0.28 and 1.10–1.28× (*derived*, quality audit F7): Q 8 is the rule's Q at G 1 on
  `dbts_c1` only (`dbts_a1` Q 4; `dbts_b1` Q 12 at G 1, Q 8 at G 16; `dbts_c1` Q 4 at G 16).
* *Decode* (measured, MEASURE-1's C, #373): in the product's HTJ2K unit Hp (decode plus XXH3, 19.8–57.1 ms a frame at
  1×) the WebCodecs view at Q 8 takes 1.24–1.74 Hp at 1×; 0.68–1.12 at 4× on four or two slowed cores; 1.16–1.58 on
  one. The exact ask decodes in 1.01–1.03 HTJ2K frames; dav1d-WASM the view in 1.9–4.7. AV1 saves bytes, not decode
  time; "under one HTJ2K frame on a slow device" is not claimed.
* *Quality*: at the bar 1.00 the coding error reaches the noise at Q 8 (system A: Q 4); at the noise rule's 1.03
  every 12-bit volume reads Q 8 and the 10-bit ones Q 12–16; either bar passes a coding that deletes the fine-band
  noise (*derived*, F1, F4; A measures ν 0.286–0.495 at the rule's Q). No Q keeps every displayed level within 1. No
  metric is validated against readers on DBT, so "visually lossless" and "also for diagnosis" rest on a proxy.
* *Noise point* (#317): a candidate Q per series from σ_min; held out, the predicted Q on 10 of 10 cells, worst
  frame 0.89–0.97 of σ. x\* is 4.7584 at G 1 over all 19 volumes, 4.6359 pooled over G 1 and G 16, 4.8024 for 12-bit
  streams (B0, #373). σ costs 0.05–0.09 CPU s/Mpx at ingest and must be taken on every frame. DBT only, not TRUS or MR.
* *Window* (#323): coding error and noise scale alike under a window, so "within the noise" holds at every width once
  it holds. "Under one display level at the header windows" would need Q 1–2 on 12-bit DBT (0.64 of HTJ2K's bytes),
  Q 4 on 10-bit DBT and TRUS. The anchor is Q 12 on 3 of system B's 5 volumes (F11).
* *Depth cut*: "about 0.3 dB and 6–7 % fewer bytes at equal Q" is one all-sample PSNR row at Q 8; its in-window cost
  is unmeasured, and the cut stays justified by the decode route alone (harvest §1).
* *Out of the top, not discarded*: a two-layer SVC preview; lossless AV1 as the exact form. *Discarded*: a layered
  three-layer carrier; preview and view as quality layers of one stream; top-first; HTJ2K quality layers; lossless
  G > 1; a lossy top plus low stream; key parsing in place of WebCodecs' flush (tag `archive/av1-keyparse`); LCEVC.

**The questions, most consequential first:**

1. **Which reading of "visually lossless" sets the view's Q.** Matters: it sets every byte figure the design quotes
   and whether the view deletes noise a reader uses. Decides, in order: the owner's bar (1.00 or 1.03, or B's anchor
   as [Q_lo, Q_hi] with ν beside and "keep at least half" as Q_ν, MEASURE-1); the noise-ratio protocol (κ measured, a
   model observer on calcifications, `claude/av1-noise-ratio`, #332), which tests the removal worry before any reader
   study; then readers (a flicker test), which no agent runs. Inputs: #329, #357, #373, #317, #325, #332; the
   harvest's §Open 0, items 1–3, 8, 9.
2. **G at equal quality** (`claude/av1-groups`, #326; settings amendment #352). At equal Q, G 16 ÷ G 1 is 0.93–1.01 at
   Q 8 and 0.77–0.94 at Q 12 (F2); at equal quality B measures 0.954–0.986 on 12-bit and 0.855–0.907 on 10-bit.
   Shard 1 (`dbts_b1` slices 9–40) recommends no arm over G 1: alt-ref saves 4.9–6.3 % at equal PSNR, nothing at the
   noise anchor, and decodes unevenly (slowest frame 3.4–5.2× the median). Decides: shard 2 (`dbts_a1`, `dbts_c1`,
   TRUS; about 4.3 h on one 4-core host) and settings shard S2, collected without `--partial`, by #326's rule. Waits
   on the owner: whether a temporally denoised view still counts as the view (harvest decision 4). No G is decided
   for DBT; decode time in order matters more than jumps.
3. **The view's decode speed on a slow device.** C's bands were missed on a 4-core host; no phone's WebCodecs AV1 has
   been probed or timed. Decides: a phone row of C's protocol (`claude/audit-measure:docs/av1/audit-protocols.md`
   §C), the phone session's. Until then no speed claim beyond the cloud cells.
4. **HTJ2K at the screen's resolution** (`claude/htj2k-tiles`, #324). Derived: S costs 1.2–10× D's bytes to the first
   picture and the scroll, and pays only if a reader asks Lossless on most slices. Measured (HTJ2K-MEASURE, stages
   0–2): R0 exact on 175/175 frames at every level on OpenJPEG and OpenJPH; RPCL plus TLM +0.01 %; three strips decode
   a Lossless frame in ×0.43–0.48 at 4× (R2 holds). Running: stage 3 over links decides R3–R7; then HTJ2K-VERDICT by
   a session that wrote none of it. Waits on the owner: whether an exact level picture may be shown before the
   frame; asking the PCS team for its HTJ2K profile (progression order, decompositions, TLM).
5. **Tiles in the AV1 encode** (P2, R1 on `claude/proposals`): 2×2 met its rule at equal Q on 4 cores; at equal
   quality not ready (max |Δ| +5 source units on `dbts_a1-q8-g8-cut` against a 1-unit bar); the G 16 jump 0.37× on
   4 cores, 0.99× on two. Decided to wait (§3); a later round reads it again with I1's digest.
6. **Congestion control for the pair** (P1, R2): under BBR the fill takes 0.11–0.12× of Cubic's at 1 % iid loss and a
   jump during the fill 0.08–0.09×; clean and in bursts 0.86–0.96×. On the phone the view comparison changed with the
   controller on the tether. Decides: real-world runs with both controllers (§3), their protocol by a session that
   will not run them; LINK-CALIBRATION and HOSTNET-THEORY (rows of 11-12) give the link profile and the network
   mode. R4 (a 38 400 B initial window under BBR) is withdrawn.
7. **The audits' corrections, applied in place**: each study branch's entry of
   `claude/av1-corrections:docs/av1/corrections.md` (#357), one docs session per branch, and the harvest's table
   (#350 §2), including κ's two meanings in `docs/glossary.md`. The zero-encode re-reads (anchors under one bar, x\*
   pooled and per depth) are done by B0; their numbers go into those entries.
8. **Noise detection at the ingest** (σ_min, its estimator's timing on the three volumes), then a note to the PCS
   team with G for AV1 cine; keep or remove the client's G > 1 path.
9. **The AV1 result chain into `claude/unified-codecs`** (from `claude/av1-unified-mainbase`,
   `claude/lines-ready:docs/reviews/lines-ready.md` §7): #290 → #305 → #317, #312; #283 → #306 → #314 → #316; #288,
   #315, #318; #323, #325, #326, #332, #352; #329, #331, #334, #357, #373; the line docs #350, #335, #340, #347. Almost
   all are theory, protocols and audits; product files only in #309 (paint depth, behind a flag), #306, #314, #316.
   Row UNIFY-CODECS, then UNIFY-REVIEW.
10. **Owed to a GPU machine or a phone**: hardware decoders' exactness (on the client, I1's digest covers it: PR 368,
    the owner's), reduced-depth paint timing, group arms on a device.
11. **Server defaults held for a yes or no** in `claude/line-server`'s index (#254): its docs and rows go to
    `claude/unified-server`; rows 258–260's arms sit in product modules and stay in history (LINES-READY §3).
12. **A dataset hub** for coded series (`claude/dataset-hub:docs/reviews/dataset-hub.md`): release assets lead. Owed:
    whether the same recipe gives the same digests on another host. The owner's: adopt it, which host, a write token.

**A `server.md` line file** (LINES-READY §7 asks this file): yes, proposed. Server and transport have their own
unified branch (`claude/unified-server`), PR (#254) and questions (6, 11, HOSTNET-THEORY, LINK-CALIBRATION); this file
would then hold the codecs alone. The split is the owner's; until it is made they stay here.

## 5. Unsupervised

An agent may, without the owner: write theory and pre-registered protocols (a different session measures); run them
on cloud hosts within the fixtures above, interleaved, rows pushed as they land; apply an audit correction in place on
a study branch (7); run groups shard 2 and S2 (2), HTJ2K's stage 3 and its verdict (4), the noise-ratio protocol (1);
build a lab tool or a proposal as one branch and one draft PR per question, with a review row; assemble
`claude/unified-codecs` as UNIFY-CODECS says.

Waits for the owner: any merge; any removal; the bar and the reading of "visually lossless" (1); whether a temporally
denoised view counts (2); the default controller (6); a level picture before the frame and the PCS profile ask (4);
the hub (12); the `server.md` split; any note sent to the PCS team; any change to §3. Phone runs are the phone
session's; reader studies are no agent's.

## 6. Pointers

`docs/av1/payload-format.md`, `docs/av1/MAINBASE.md`, `docs/av1/queue.md`, `docs/decode/README.md`,
`docs/FIXTURES.md`, `docs/transport/transport-conclusions.md`, `docs/adr/disk-access.md`, `lab/`; branches
`claude/av1-unified-mainbase`, `claude/av1-corrections:docs/av1/corrections.md` (and its `audit-protocols.md`),
`claude/audit-measure`, `claude/docs-lines-3` (the harvest), `claude/av1-quality-metrics:lab/av1/metrics/README.md`,
`claude/av1-quality-profiles:lab/av1/profiles/README.md`, `claude/av1-noise-point:docs/av1/noise-point.md`,
`claude/av1-window-q`, `claude/av1-vl-metrics`, `claude/av1-noise-ratio`, `claude/av1-encoder-settings`,
`claude/av1-audit-quality`, `claude/av1-audit-decode`, `claude/av1-groups`, `claude/av1-groups-settings`,
`claude/av1-webcodecs-profiles`, `claude/av1-svc-preview`, `claude/htj2k-tiles`, `claude/htj2k-progressive`,
`claude/proposals:docs/lines/proposals.md` (P1, P2, R1, R2, R4), `claude/lines-ready`, `claude/dataset-hub`,
`claude/line-server`; PRs 367, 250, 324, 326, 332, 350, 352, 357, 358, 368, 373, 254.
