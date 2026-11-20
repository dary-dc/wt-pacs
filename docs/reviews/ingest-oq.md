# The product ingest writes the optimal-quality pair: a design

Queue row INGEST-OQ, 2026-11-12. This is a proposal for the owner. It is a structural change, so nothing is built.
Read from the code of the demo tip (`claude/demo-fixes-2` at `18d2d1ff`) and from `claude/line-pacs:docs/ingest/`.
**Nothing was run or measured for this file.** Every number below is quoted from the document that measured it.

It answers [`../lines/optimal-quality.md`](../lines/optimal-quality.md) Open 6. Today only the lab tool writes an
optimal-quality series, and the product ingest writes none.

## 1. What exists

| part | writes | reads | optimal quality |
| --- | --- | --- | --- |
| `ingest/coded-frames/ingest.py` | coded frames, `digests`, `sourceFingerprint` | any object with `frame(i)`, `n`, `stored`, `signed`, `lo`, `hi`, `offset` | **built**: `lossy`, `lossy_header`, `depth_cut`, `keyframe`, the group runs, the decode-back from the keyframe |
| `lab/av1/tools/ingest_coded.py` (lab) | a set's payloads and `metadata.json` | a set as `lab/av1/fetch_data.py` writes it | the only caller of `coded(..., lossy=)`; writes `lossy`, `exactSeries`, `sourceFingerprint` |
| `scripts/demo-series.sh` (lab) | 21 demo bundles | the three DBT sets | the exact series first, then six optimal-quality series beside it |
| `ingest/from-dicom/from_dicom.py` (the product's ingest today) | one `.sbnd` and its metadata | DICOM Part 10 files, through pydicom | none: `--codec htj2k\|av1\|auto` only |
| `ingest/from-parser` (Rust, phase 1) | one HTJ2K `.sbnd` | the parser's directory output, one instance a series | none. It already links `libdecode.so`, which has `av1_decode` (`ingest/coded-frames/decode.cpp:45`) |

The contract the client enforces is in `client/viewer/pair.js`:

* `pairOf` takes `codec` `av1`, a whole `q`, `g` ≥ 1 and `depth` ≥ 8. A cut must have `depth` 10 and `bitsStored`
  equal to the series' own, over 10. `exactSeries` must match `/^[\w.-]+$/`.
* `checkPair` requires the exact series to be HTJ2K with the same frame count, size, `bitsStored`, `signed`,
  `photometric`, `rescale` and `perFrame`. Both series must carry the same 16-hex `sourceFingerprint`, and the exact
  series must carry one 16-hex XXH3-64 digest per frame.

The ingest's half of the contract is [`../av1/payload-format.md`](../av1/payload-format.md) §Optimal quality, §Depth
cut and §Source fingerprint.

## 2. What the PCS hands us

The PCS's directory layout is our input contract ([`../lines/metadata.md`](../lines/metadata.md)). Which layout
applies is still open: D14 in `claude/line-pacs:docs/ingest/pacs-receive-design.md` §1, A (the parser's code) or B
(pcs.pdf). Depending on that answer, and on whether the PCS codes AV1 itself, the optimal-quality step can receive
three kinds of input:

| input | when | where the source samples come from | what the optimal-quality step does |
| --- | --- | --- | --- |
| **I1. Raw frames** | layout A: `<I>/G\|P\|R/%05d`, raw, no hash | the files themselves | codes both series from one read |
| **I2. The PCS's HTJ2K codestreams** | layout B: series-level `c/` | each codestream decoded once | assembles the exact series from the PCS's codestreams, after checking that each decodes to its digest, then codes the optimal-quality series from the decoded samples |
| **I3. The PCS's AV1** (`mf.mp4`) | if the PCS codes the optimal-quality view itself | not needed | remuxes the units into payloads ([`../av1/frame-groups.md`](../av1/frame-groups.md) §5d, as payload-format §For the PCS team cites it) and decodes each frame from its keyframe |

**Recommended: build for I1 and I2, and leave I3 out for now.**

* Once the source samples are in hand, I1 and I2 run the same step. Only the reader differs.
* I3 moves the encoder settings out of our control. A decode-back proves that a frame decodes, not that it was coded
  with `lossy_args`. *Visually lossless* is a claim about those settings at a given Q.
* What would reopen I3: the PCS team asking to code it, with a way to show the settings, such as the encoder's own
  record in the stream. This would be a question for the PCS team (`pacs-receive-design.md` §15).

**How Q, G and the cut reach the ingest.** The owner decided on 2026-11-09 that the PCS chooses them, G per modality
and Q per series by the noise rule ([`../lines/codecs.md`](../lines/codecs.md) §Decisions (the owner's)). The options:

* **P1. Arguments from the PCS's trigger**, the completeness signal that starts the ingest. Nothing changes in the
  layout.
* **P2. A per-series parameter file in the PCS's tree.** This changes the PCS's layout, which is the PCS team's to
  change.
* **P3. A site configuration** with G per modality. Q cannot live there, because it is per series.

**Recommended: P1** while the ingest runs where the trigger fires. Q and G then travel inside the optimal-quality
series' own metadata (`lossy.q`, `lossy.g`), so nothing downstream needs them from elsewhere. Where the ingest runs
decides between P1 and P2. If the PCS host runs it, P1 works. If the PACS runs it after delivery, P2 or the package
must carry Q and G. That is the open question in `metadata.md` Open 1: who builds the `.sbnd`.

## 3. Which ingest writes the pair

**R. The Rust ingest, phase 2** (`ingest/from-parser`):

* For: the owner decided on 2026-10-11 that the ingest is written in Rust ([`../ingest/README.md`](../ingest/README.md)
  §4). It reads the PCS's directory output, so it is the ingest that reads the input contract.
* It already links the decoder that the optimal-quality check needs.
* The encode can run the pinned `aomenc` as a subprocess, as `ingest.py` does. Its bytes are then the Python ingest's
  by construction. This is stage 1 of [`../FIXTURES.md`](../FIXTURES.md) §A compiled ingest at the site.
* Linking libaom as a library comes later, behind the same parity test.
* Cost: phase 2's owed parts come first or alongside: several instances a series, and the display keys that
  `Metadata` leaves to phase 2 (`main.rs:34`). `checkPair` compares `photometric`, `rescale` and `perFrame`, so the
  pair needs those keys.
* What has to be ported: `lossy_header`'s rules, the Y4M writer, the group runs, `depth_cut` and the keyframe
  decode-back, about 120 lines of Python today.
* Time: for AV1, the encoder is 94–99 % of the ingest (FIXTURES §A compiled ingest), so compiling the rest does not
  change the time.

**P. The Python DICOM ingest** (`from_dicom.py --lossy Q G [--depth-cut]`):

* For: it is small. `ingest.coded(..., lossy=)` exists, so this is about 40 lines: a second `coded` call, the
  metadata `ingest_coded.py` writes, and a second bundle.
* Against: it reads DICOM Part 10 through pydicom, not the PCS's directory output. So it is the product's ingest of
  today, not the ingest that reads the contract.

**Recommended: R for the product.** `ingest.py`'s `lossy` stays the reference implementation, and R is held
byte-identical to it, as phase 1 was held for HTJ2K (`same_test.py`, all 88 lab sets).

P only if the owner wants the pair from DICOM files before phase 2. What decides it is whether any site hands DICOM
files rather than the parser's tree.

**The pair is written in this order, whichever ingest writes it:**

1. Read the source once, then write and publish the exact series. Its frame digests give `sourceFingerprint` with no
   second pass ([`../av1/payload-format.md`](../av1/payload-format.md) §Source fingerprint).
2. Code the optimal-quality series from the same samples. Copy the same display keys, the same fingerprint and
   `exactSeries`, then publish it.
3. If the optimal-quality step is refused (§5), the exact series stays and is served alone. A series without `lossy`
   is an ordinary series to the client (`pairOf` returns null).
4. The optimal-quality series is never published before its exact series. If it were, a reader would get a pairing
   refusal in the meantime.

## 4. The metadata contract

No change is proposed. Here is what the pair carries, from payload-format §Optimal quality and the two ingests:

| key | exact series | optimal-quality series |
| --- | --- | --- |
| `frameCount`, `width`, `height`, `channels`, `bitsAllocated`, `bitsStored`, `highBit`, `signed`, `photometric`, `min`, `max` | the source's | the same values |
| display keys (`modality`, `rescale`, `window`, `perFrame`, `frameTimeMs`, `cineRate`) | the source's | the same dictionary, written once and copied |
| `codec` | `htj2k` | `av1` |
| `digests` | `xxh3-64`, one per frame | none: its frames arrive `unchecked` |
| `lossy` | none | `{"q", "g", "depth"}`, plus `bitsStored` for a cut |
| `exactSeries` | none | the exact series' id (§6) |
| `sourceFingerprint` | XXH3-64 over its frame digests | the same value |

To make the "same values" true by construction, the ingest builds the display dictionary once and writes both
metadata files from it.

## 5. Q, G and depth for any value

Each row says what `ingest.py`'s `lossy_header` and `coded` do today, and what the product ingest should do. "Today"
was read from code, not run.

| value | today | proposed |
| --- | --- | --- |
| Q 1–63 | coded | as today |
| Q 0, or Q over 63 | refused by name (Q 0 is lossless, `LosslessArray`) | as today |
| G 1 | `--kf-max-dist=0` | as today |
| G over 1, n mod G ≠ 0 | the last group is shorter; whole groups go to each worker (`per += -per % g`) | as today. Parallelism is at most ⌈n/G⌉ workers: for G ≥ n, one encoder run for the whole series. Not timed |
| unsigned D ≤ 8, D 9–10 | coded at 8 or 10 bits (`container`) | as today |
| unsigned D 11–16 | the depth cut to 10 bits; the 12-bit stored form only without `--depth-cut` | **always the cut** (the owner, 2026-11-11). The product ingest has no stored-form option. Today's lab default (uncut unless `--depth-cut`) is the wrong default for the product |
| signed, ≤ 10 bits after the offset | coded with the offset in the payload | as today |
| **signed, over 10 bits after the offset** (for instance signed 12-bit CT) | the cut is refused for signed sources; uncut it is the stored form at 12 bits, which is lab only; over 12 bits it is refused | **a gap**: no form on the product path, see below |
| RGB | refused ("optimal quality is grey only") | exact series only, by name |
| several instances a series (CT, MR) | Python: yes, through `dicom_series`; Rust: phase 2 | with phase 2 |

**The signed gap, options for the owner:**

* **S1. Cut after the offset.** Code c = cut(v + offset), and keep the offset in the payload as for an uncut signed
  series. The client's window table then needs entry c at c · 2^(D′−10) − offset. This extends the cut's definition,
  a decided approach, so it is the owner's call. What decides it: a `voi.test.mjs` case equal to shift-then-window on
  every code at a signed D. That is a test, not a measurement.
* **S2. No optimal-quality series** for a signed source over 10 bits after the offset: the exact series only. Nothing
  decided changes, and that series shows no optimal-quality view.

Unsigned 12-bit CT with a rescale intercept is cut as any unsigned series. How many of a site's series are signed
over 10 bits is not known here.

## 6. Names and placement, open on the PACS line

* **F1. `pairOf` refuses a PCS-coded id that contains `~`.** The parser codes UIDs in the alphabet
  `0-9A-Z_a-z~` ([`../ingest/contract.md`](../ingest/contract.md) §The layout), and serving by UID takes those coded
  UIDs as the series' name (`pacs-receive-design.md` §9). `pairOf`'s `/^[\w.-]+$/` admits neither `~` nor a `/`
  between study and series.
  * `~` is the coding of the value 63, so three source characters such as `9`, `9`, `9` come out as `~`.
  * The client's regex has to follow the serving grammar before any product pair is served by UID. This was read from
    the code and not run against a coded UID.
* **F2. The optimal-quality series' own id.** The serving grammar has no `.` and an even length of at most 44, so the
  id cannot be "the exact's UID plus a suffix" without changing that grammar.
  * Options: a role in the URL beside the series (`/<Study>/<Series>/oq`), or a second grammar for derived series.
  * What decides it: the owner's D10 serving choices and the store layout, `pacs-receive-design.md` §8, still open.
  * Related: the 10-26/27 decision "several bundle files per series are rejected" (§2 there) was taken for late
    instances. The pair is two bundles per DICOM series by design (the owner, 2026-11-09). Whether that decision
    covers the pair is the owner's to say.
* **F3. A late instance.** An addition is merged into the exact `.sbnd` by a full rewrite (`pacs-receive-design.md`
  §3). That changes the frame digests, and so the fingerprint, and it can shift every group after the insertion. The
  rule proposed: an addition writes both series again, the optimal-quality series coded whole. A partial re-code from
  the first changed group on is possible, but not worth it until additions prove frequent, as for the rewrite itself.
  * Whichever is published first, the client refuses the pair until both are written: the fingerprints differ. That
    refusal is the check working, not a bug.

## 7. What is tested, and how

Every test gets a failing run first and is mutated. The mutants each test must kill are in brackets.

* **T1. Parity.** The Rust optimal-quality bundle is byte-identical to `ingest.py`'s at `--jobs` 1, 2 and 4.
  * It runs on `lossy_test.py`'s synthetic sets in the gate, and on the three DBT sets outside it.
  * [a keyframe off by one; one encoder run per frame at G > 1; the cut truncating instead of rounding]
* **T2. The value matrix** on synthetic sets.
  * Q 1, 8 and 63; G 1, 7, n and n + 1; unsigned D 8, 9, 10, 11, 12 and 16; signed 8 and 10 bits.
  * Every frame decodes from its keyframe at the stated depth.
  * Refused by name: Q 0, RGB, signed over 10, and no form at all over 16.
  * [Q 0 admitted; a D 11 series not cut; the depth recorded as `bitsStored` instead of 10]
* **T3. The pair's invariants.** Both metadata files are written from one display dictionary, and the fingerprints
  are equal. A node script runs `checkPair` over the written pair: it accepts the pair and refuses another set's
  exact series by source.
  * [`rescale` dropped from one of the two; the fingerprint taken over the coded frames' digests]
* **T4. Publishing.**
  * A refused optimal-quality step leaves the exact series written and nothing of the optimal-quality one.
  * The exact series is published before the optimal-quality one.
  * [publish order swapped; a partial optimal-quality bundle left on a refusal]
* **T5. The browser.** `demo-check.mjs` runs on one pair written by the product ingest, in both views. This is the
  check that the client's half and the ingest's half meet. It is headless and does not cover a phone.

The gate's cost: aomenc on 20 frames of 64 × 48 at G 1, 8 and 16 is already in the gate through `lossy_test.py`,
and T1 to T4 add a few such runs. The DBT parity run is outside the gate. The demo set's 21 series took 527 s on a
4-core cloud host (FIX-2, [`../lines/optimal-quality.md`](../lines/optimal-quality.md)).

## 8. For the owner

Ranked by what blocks the rest:

1. **Which ingest writes the pair:** R (Rust phase 2, recommended) or P first (Python, from DICOM files) (§3).
2. **The signed gap:** S1 (cut after the offset, extends a decided approach) or S2 (exact series only) (§5).
3. **Where Q and G come from:** P1 (the trigger's arguments) while the ingest runs at the PCS host (§2). This
   follows from who builds the `.sbnd` (`metadata.md` Open 1).
4. **I3:** whether the PCS may code the optimal-quality view itself (recommended: not now) (§2).
5. **For the PACS line** (§6): F1 (the client's id grammar, a small fix once serving by UID is chosen), F2 (the
   optimal-quality series' id and whether two bundles a series is allowed), F3 (a late instance writes both series
   again).

Fixtures and limits: none were run. The code was read at `18d2d1ff`. The PCS's layout is quoted from
`claude/line-pacs` (parser `e105214`) and was not re-read upstream.
