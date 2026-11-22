# The ingest of the optimal-quality view: who codes it, with which Q and G, and the signed gap

Written 2026-11-22 by row INGEST-PAGE (`claude/work-ledger:docs/queue-2026-11-14.md`), a session that ran none of this
question's rows, from pushed results only; nothing run but `git` over the branches and reads of the PRs. Inputs at:
`claude/unified` `4a2b4277` (`ingest/`, [`../reviews/ingest-oq.md`](../reviews/ingest-oq.md) (INGEST-OQ),
[`../lines/optimal-quality.md`](../lines/optimal-quality.md), `docs/lines/codecs.md` §Open and §Decisions,
[`../av1/payload-format.md`](../av1/payload-format.md)), `claude/ingest-oq-tests` `ff49feb3` (PR 421),
`claude/noise-ingest` `060f71f2` (PR 413, `docs/av1/noise-point.md` §σ_min in the Rust ingest), PR 390's body and
review, PR 321 and its closing comment, `claude/work-ledger:docs/queue/INGEST-REVIEW.md`. `claude/unified` carries
every commit of PR 390's branch `claude/oq-ingest` (`git rev-list --count` 0, **measured**, 2026-11-22).

## 1 · The question

The product ingest can now write the optimal-quality series beside the exact HTJ2K series (PR 390, a flag, off by
default). Before that flag means anything in the product, seven choices are owed: **which ingest** writes the pair;
**what a signed source over 10 bits gets**; **where Q and G come from** and whether the PCS may code the view itself;
**the id grammar** the pair is named in; **what the ingest's decode-back must check**; **σ_min** at the ingest; and
**G for AV1 cine** (the PCS note, and the client's G > 1 path). They are the owner's because they set the product's
input contract with the PCS and extend or keep decided approaches (the depth cut, "the PCS chooses Q and G").

## 2 · The recommendation, and the owner's yes or no

**Keep the Rust ingest's flag as the one writer of the pair (R, as built), give signed sources over 10 bits the exact
series only (S2, as built), take Q and G from the PCS's trigger with no product default, merge PRs 413 and 421, queue
two small rows (the id grammar, a decode-back guard), and send the two PCS notes.** It serves the value statement's
promise that "every frame the reader asks to see exactly is the original, bit for bit": the exact series is always
written first and stands alone whenever the view is refused; and its last line, "its input is what the PCS delivers":
nothing here asks the PCS to change its layout.

| # | the owner's yes or no | recommended | a yes changes | a no leaves |
| ---: | --- | --- | --- | --- |
| 1 | **R**: the Rust ingest (`ingest/from-parser --optimal-quality`) writes the pair; `ingest.py`'s `lossy` stays the reference, held byte-identical (M6's #390) | **yes** | #390's commits stay in `claude/unified` for `main`, off by default; three owed tests (aomenc pin, flag off needs no aomenc, exit 1 on a refusal) queued as one row | P: `from_dicom.py --lossy` (~40 lines, **source**: INGEST-OQ §3), or a revert of #390 from `claude/unified` before `main` |
| 2 | **S2**: a signed source over 10 bits after its offset gets the exact series only | **yes** | nothing to build (both ingests refuse it by name, the exact series written, exit 1; **measured** in #390's tests) | S1, the cut after the offset: extends the depth cut's definition (a decided approach), and needs a `voi.test.mjs` case first |
| 3 | **Q and G from the PCS's trigger** (P1), carried after in `lossy.q`, `lossy.g`; no product default per modality until one is measured | **yes** | the bare flag's Q 8 and G 8 are labelled placeholders in `ingest/from-parser/README.md`; which Q (Q 8 or the rule's) is the `visually-lossless` page's | P2 (a parameter file in the PCS's tree: the PCS's layout changes) or P3 (a site file: Q cannot live there, it is per series) |
| 4 | The PCS does **not** code the view itself for now (I3) | **yes** | nothing; I3 reopens if the PCS can show its encoder settings in the stream | the view's settings leave our control; a decode-back proves a frame decodes, not how it was coded |
| 5 | The pair's id grammar (F1): `pairOf` follows the serving grammar (`0-9 A-Z _ a-z ~`, even length ≤ 44, `<Study>/<Series>`) | **yes, once `pacs-sync`'s item 7 (D10) is yes** | one row: the fix, which flips PR 421's two F1 marks to "gap closed" | `pairOf` refuses every PCS-coded id containing `~` (**measured**, PR 421's F1) |
| 6 | F2, the view's own id: a role in the URL (`/<Study>/<Series>/oq`) or a second grammar for derived series | **open; decide with the store layout** (design state §8) | — | stays open; the pair cannot be served by UID until it is answered |
| 7 | F3: a late instance writes both series again, the view coded whole | **yes** | the rule is written into `docs/ingest/`; the client's fingerprint refusal between the two writes is the check working | a partial re-code, not worth it until additions prove frequent (INGEST-OQ §6) |
| 8 | A decode-back **guard**: the ingest refuses a view frame whose error against the source exceeds a bound set above the worst Q 63 frame of the committed rows | **yes, queued** (a re-read of `lab/av1/` rows sets the number; nothing encoded) | a decoder showing the wrong picture is refused at the ingest, not only by `lossy_test.py` | both ingests check the decoded **shape** only (`ingest.py`, `optimal.rs:137`, **measured** by reading; INGEST-REVIEW's owner line) |
| 9 | Merge PR 413: σ_min's Rust port (`lab/noise-ingest`, not a default member) and its measured section | **yes** | the port and its rows stay for phase 2; σ_min enters `code()` only when phase 2's parser carries the window | the port lives on a branch only |
| 10 | Merge PR 421: the pair contract as tests, known gaps marked (T2, T3, F1) | **yes**, its m1 (a known gap accepts any failure, not the stated one) fixed in one line first | the gaps are in the gate and turn red when fixed unmarked | the contract is prose only |
| 11 | Send the σ_min note (`noise-point.md` §Note to the PCS team, four questions) and the G note in §9 here | **yes** | the window, which side encodes, the lossy-source flag and the G for cine can be decided | σ_min and G stay open |

No longer the owner's: **PR 321** ("keep, retarget or close", BRIEF-WED item 12) was closed 2026-11-18 by the owner's
word of that day, its comment reading "Landed in claude/unified (draft PR 402 into main) at 71c4a720". PR 390 is open,
based on `claude/unified-client`; its content is on `claude/unified`, so item 1's yes is to keep it there.

## 3 · The options

**Which ingest** (INGEST-OQ §3; numbers **source** unless labelled).

| | reads | the view's encode | state | parity with the reference |
| --- | --- | --- | --- | --- |
| **R** Rust phase 2 | the PCS's directory output (the input contract) | aomenc 3.15.1 as a subprocess, `lossy_args` | built (#390), off by default | byte-identical on 6 synthetic sets at `--jobs` 1, 2, 4, and on `dbts_a1` Q 8 G 8 cut: 56 payloads, 4 640 828 B, fingerprint `e07bb02c751a271d` (**measured**, #390) |
| **P** Python DICOM | DICOM Part 10 through pydicom | `ingest.coded(lossy=)` | not built, ~40 lines | by construction |

The encoder is 94–99 % of an AV1 ingest's time (`docs/FIXTURES.md` §A compiled ingest, **measured** there), so R's
language costs nothing in time; what it owes is phase 2 (display keys, several instances a series), which the exact
series owes too.

**The signed gap** (INGEST-OQ §5): S1 codes c = cut(v + offset) and the client's window table maps c to
c · 2^(D′−10) − offset; S2 writes the exact series alone. No count of a site's signed series over 10 bits exists.

**Where Q and G come from** (INGEST-OQ §2): P1 the trigger's arguments, P2 a per-series file in the PCS's tree, P3 a
site file (G only). P1 holds while the ingest runs where the trigger fires; if the PACS ingests after delivery, the
package must carry them (`metadata.md` §Open 1, who builds the `.sbnd`).

**σ_min at the ingest** (`noise-point.md` §Measured, NOISE-INGEST-MEASURE, all **measured** on `dbts_a1` · `b1` · `c1`):

| | value | prediction | |
| --- | --- | --- | --- |
| the port equals `quality.sigma` | 875 / 875 frames bit for bit | all | held |
| cost, CPU s/Mpx | 0.0033 · 0.0022 · 0.0025 | 0.004–0.012 | missed, low (safe side) |
| share of the exact path a frame | 20.0 · 11.9 · 14.6 % (6.5 · 16.7 · 6.0 ms of 32.6 · 140.8 · 40.7) | 7–42 · 17–99 · 10–60 % | held · missed low · held |
| all-samples σ_min against in-window | 6.593 · 1.402 · 4.519, all lower; rule Q at G 8 4→4 · 8→2 · 4→2 | lower or equal | held: so σ_min waits for the window |

**The decode-back check**: shape only (today), a closeness bound (item 8), or the reconstruction digest (#368's,
the `frame-integrity` page's), which lets the client check the decoded samples; the bound and the digest are not
exclusive.

**G**: at Q 8 a group barely pays on DBT: G 1 → G 8 moves the view from 0.0740 · 0.2186 · 0.0959 to
0.0742 · 0.2161 · 0.0948 of HTJ2K's bytes; at Q 24 it halves them, 0.0057 → 0.0026 on `dbts_a1` (**measured**, PR 321,
one run). On `dbts_b1` an O G 8–32 arm saves 4.2–4.4 % and decodes about 20 % slower in WebCodecs (**measured**,
`docs/av1/groups.md` §Settings shard 1). No G is decided for DBT (codecs §Open 1); groups shard 2 is held.

## 4 · Where it holds

**Fixtures and limits.** #390 and PR 421: synthetic sets (3 frames at 40 × 24; 9 frames at 64 × 48), and one DBT volume
(`dbts_a1`) for parity; nothing timed; no browser run on a pair the product ingest wrote (INGEST-OQ's T5 not run);
one instance a series (phase 1). σ_min: three of the 19 DBT volumes of one dataset (EA1141, systems A–C), one 4-core
cloud Xeon, one thread, five rounds not balanced; nothing claimed for `--jobs` over 1 or another CPU. No real PCS
package or trigger anywhere; no breast ultrasound cine.

**DBT stacks** carry by property: unsigned 10- or 12-bit grey, so the cut applies (D > 10) or the series is coded at
its depth, and S2 never fires (**theory**, from the form rules in `optimal.rs`, which the tests hold). σ_min's rule
is calibrated for systems A–C only; another vendor's DBT needs its own x\* (`noise-point.md` §4).

**Breast ultrasound clips**: not yet known. If a clip is grey at 8 bits, it is coded at 8 (the D ≤ 8 row,
**theory** from the code); if stored as colour, both ingests refuse the view by name (RGB is refused)
and the exact series is served alone (**measured** by #390's RGB test, on synthetic frames). No US fixture tests
either, and the σ rule has no US calibration.

## 5 · The mechanism

The exact series is written first and its frame digests give the fingerprint both series carry, so the client can
refuse any pair not from one source; the view is a second product of the same read, and any refusal on its side
costs the reader the view, never the exact frame. Who codes it decides whether its settings are known: only our
encoder run (`lossy_args`, pinned aomenc) makes "optimal quality at Q" a statement about settings. Q and G must travel
with the series because Q is per series; the trigger is the only carrier that needs no change from the PCS. The
decode-back proves a frame decodes from its keyframe at the right size, not that it is the right picture, which is
why a closeness bound is cheap insurance. σ_min is a few milliseconds a frame beside the exact path, but over all
samples it reads the flat or noisy region outside the breast and lowers the rule's Q, so it must wait for the window.

## 6 · What would change the recommendation

* A site that hands DICOM files rather than the parser's tree → P before phase 2 (item 1).
* Signed sources over 10 bits entering scope (CT) → S1, decided by a `voi.test.mjs` case equal to shift-then-window on
  every code (item 2).
* The PCS asking to code the view, with its settings recorded in the stream → I3 (item 4).
* The PACS, not the PCS host, running the ingest → P2 or the package carries Q and G (item 3).
* The one measurement: **a breast ultrasound clip through `from-parser --optimal-quality`** (its photometric, depth,
  and the view's bytes against the exact series), which turns §4's "not yet known" into a result for half the scope.

## 7 · What it would reopen

Nothing recommended. S1 would extend the depth cut (2026-11-10: "the depth cut only for D > 10"). Item 3 keeps
2026-11-09 ("the PCS chooses both, and our side handles any Q, G and depth"); the flag's G 8 default was chosen by no
measurement, against "G fixed per modality by measurement", hence item 3's label.

## 8 · Rows and links

INGEST-OQ (design, `claude/ingest-oq`, [`../reviews/ingest-oq.md`](../reviews/ingest-oq.md)); INGEST-REVIEW (#342,
Q 0 refused, the decode-back's owner line); OQ-INGEST and OQ-INGEST-REVIEW (#390); INGEST-OQ-TESTS and its review
(#421, `claude/ingest-oq-tests`); NOISE-INGEST-PROTOCOL and NOISE-INGEST-MEASURE (#413, `claude/noise-ingest`,
`docs/av1/noise-point.md` §σ_min in the Rust ingest); #321 (closed, carried); `docs/lines/optimal-quality.md` §In
flight and §Waits for the owner; `docs/lines/codecs.md` §Open 1, 3, 5; `docs/lines/metadata.md` §Open 1, 7;
[`pacs-sync.md`](pacs-sync.md) items 6, 7 and its PCS note.

## 9 · Note to the PCS team on G for AV1 cine (draft, not sent)

> **Subject: the group length of the optimal-quality view for cine-like series**
>
> Our ingest codes the view with any Q from 1 to 63 and any group length G ≥ 1, and the viewer decodes any G. G is
> meant to be fixed per modality by measurement. On DBT at Q 8, a group of 8 saved at most 1.2 % of the view's bytes
> against G 1 on three volumes (nothing on one), and on one volume longer groups saved 4–5 % but decoded about 20 % slower; we have no
> measurement on ultrasound clips.
>
> 1. Which modalities will you send as cine-like series (DBT slices, ultrasound clips), and at what frame rates?
> 2. Do you intend to choose G yourselves, and pass it with Q in the trigger, or leave G to us?
> 3. Can you share one anonymised breast ultrasound clip in your output layout, so G and the view's bytes are measured
>    on it before a default is set?
