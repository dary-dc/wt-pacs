# PACS receive and metadata

Last verified 2026-11-12 against the demo tip `claude/demo-fixes-2` `18d2d1ff` (PR 367), `claude/line-pacs` (#258),
the queue's status files (`claude/work-ledger:docs/queue/`) and the open PRs. The design records on `claude/line-pacs`
were not re-read past their 2026-10-29 state; nothing for this file was run or measured.

## 1. Goal

The PACS side of wt-pacs: receive what the PCS produces, check it, build and **update** each study's store, and serve
every series by UID. The PCS receives, parses and encodes (HTJ2K `mf.mxf`, AV1 `mf.mp4`, `sf.jxl`); its directory
layout is our input contract. Depth over breadth; theory and a pre-registered measurement first.

## 2. On `main` after this week's merge

What PR 367 then PR 250 carry for this line, once the owner gives the two words (until then on `claude/demo-fixes-2`
only): the ingest and the store the server reads. **None of the receive side is there.**

* **The ingests** (`docs/ingest/README.md` §7): `ingest/coded-frames/ingest.py` codes HTJ2K or AV1 and refuses any
  frame not equal to its source; `ingest/from-dicom/from_dicom.py` is the product's ingest today (DICOM Part 10 to one
  `.sbnd`); `ingest/from-parser` is the Rust ingest's phase 1, HTJ2K only, byte-identical to the Python one on all 88
  lab sets (the gate keeps them equal).
* **The store**: `common/series-bundle` (`.sbnd`), `docs/disk-layout/target.md`; the raw-frame check is XXH3-64.
* **The pair's metadata**: every ingest writes `sourceFingerprint`, XXH3-64 over the source's frame digests, shared by
  the exact and optimal-quality series (`docs/av1/payload-format.md` §Source fingerprint; `docs/glossary.md`).
* **P4 fixed**: a signed source whose values leave a byte after the offset is read and hashed as 16-bit, in
  `av1-frame.js` and `ingest.py` (`docs/av1/payload-format.md` P4, corrected 2026-11-10). *Corrected 2026-11-12:* this
  file's 10-29 text (§Open 5) said the fix was not yet on the core path; it is on the demo tip.
* **The pipeline's design and decisions**: `docs/ingest/README.md` (§1 flow, §4 decisions), `design.md`, `link.md`,
  `contract.md`.

On `claude/line-pacs` only (#258, "not for merge yet"; `claude/lines-ready:docs/reviews/lines-ready.md` §4): the
receiver (`claude/line-pacs:ingest/receiver`, #163), the carrier and its sender (#164, #177), `claude/line-pacs:common/from-disk`, `claude/line-pacs:common/study-db`,
`claude/line-pacs:tools/pacs-verify` (#160), serve-by-UID (#162, `claude/line-pacs:server/src/media/series_tree.rs`); the labs
`lab/{metadata-store,study-index,metadata-delivery,late-frame,disk-tree,tail-rewrite,sqlite-engine}` with their rows,
none in use; the design state `docs/ingest/pacs-receive-design.md`. No resend-identity logic anywhere, on purpose. The
branch is 412 commits behind the tip, a trial merge conflicts in six files, and its 10-30 `deploy` CI is red (log not
read). One or two commits each of #167, #168, #230, #233 and #234 are missing from it (by patch: `254edc68`,
`bddb09a8`, `fd09d307`, `9c6d378a`, `1617855c`, `d4a7f500`).

## 3. Decided (never reopened by an agent)

| decision | date | recorded |
| --- | --- | --- |
| The ingest is in Rust; the parser's directory output is the hand-over; one SQLite database per study, built in the PACS; a catalog server indexes them; the client's exactness checks on by default | 2026-10-11 | `docs/ingest/README.md` §4 |
| The raw-frame check is the XXH3-64 already written for the client | 2026-10-12 | same |
| Our scope starts at the PACS; the PCS encodes; the server stays on `.sbnd` (no MXF or MP4 reading); file-name hashes here are XXH3; display metadata updated in place, no kept history | 2026-10-24 | this file; `claude/line-pacs:docs/ingest/pacs-receive-design.md` |
| Final checks read from disk, not memory; extraction stages in `incoming/`, the serving tree changes only by rename | 2026-10-25 | same |
| The PCS decides when a series is complete; replies and retries required; frames contiguous in display order; metadata compression per site, the receiver accepting both by zstd magic; one disk-read helper; nothing unfinished merged; QUIC chosen at build time | 2026-10-26 | same |
| A late instance is merged by a full `.sbnd` rewrite with a rename; a tail rewrite only if merges prove frequent | 2026-10-26/27 | same, §3 |
| XXH3 here and BLAKE3 at the PCS by design; the layout contract follows the PCS's code and design document; the trigger is the completeness signal; design generic, options per part | 2026-10-28 | same, §20 |
| The tar package is one profile of our choosing, not an agreement with the PCS team; the kept mirror is an option, not decided; organize and evaluate from the research done, no new investigations | 2026-10-29 | same |
| The PCS chooses G (per modality) and Q (per series, by the noise rule); our side handles any Q, G and depth; the pair is two bundles per DICOM series | 2026-11-09 | [`codecs.md`](codecs.md) §3; [`optimal-quality.md`](optimal-quality.md) |
| D > 10 is always the depth cut on the product path; the stored form is a lab option | 2026-11-11 13:30 | `claude/work-ledger:docs/queue-2026-11-10.md`, the owner's decisions |
| The pairing's same-source check belongs in the ingest, computed with XXH3 | 2026-11-11 13:30 | same |
| Nothing reaches `main` uncleaned; lab code never inside product modules | 2026-11-11 17:30 | [`coordination.md`](coordination.md) §Decisions |
| One unified proposal branch per line, reviewed, for the owner on Friday: this line's is `claude/unified-pacs`, from `claude/line-pacs`; it only assembles, and its crates stay proposals | 2026-11-11 21:30 | the queue file; `claude/lines-ready:docs/reviews/lines-ready.md` §7, §8 |

The 2026-10-28 night items in the logs are leanings, not decisions.

## 4. Open, ranked

Fixtures for every result below: the five TCIA series and the parser's packages of them (`claude/line-pacs:lab/metadata-store`), the
three DBT volumes `dbts_a1`, `dbts_b1`, `dbts_c1` of one dataset; 4-core cloud hosts without a GPU; loopback, not a
site's link or disk. No result here comes from a PCS host or a hospital network.

1. **Delivery under rsync** (`claude/line-pacs:docs/ingest/pcs-pacs-options.md`, #230; `rsync-delivery.md`, #233;
   `rsync-updates.md`, #234; quotes not re-verified). rsync's whole-file checksum covers the wire, not a read-back,
   quick-check skips or corruption at rest at the PCS. Evaluate in order: (a) a cleared `incoming/` or a **kept
   mirror** (`rsync -a --delete` into `mirror/<exam>/` outside the serving tree), which turns on the PCS team's
   answers (item 4); (b) the **hash bridge**: the PACS verifies the PCS's BLAKE3 names and our DB keeps XXH3
   (recommended: only the parser's write-time hash catches corruption at rest), or our trigger lists XXH3 per file,
   or an XXH3-named copy before rsync (the PCS's raw frame files carry no hash); (c) for a cleared `incoming/`, update
   pattern P3 (#234) or E (#223); (d) layout A (the PCS's code, recommended now) or B (its design document's target),
   and **who builds the `.sbnd`**. Proposed order on receipt: read back the frame container in `incoming/` → rename →
   one DB transaction → read rows back → "stored" → study index → clean `incoming/` last. Decides: the PCS team's
   answers, then the owner; no record compared the kept mirror.
2. **The synchronization protocol**: A + F (#222, recommended) or E + F. #223 measured B against E on a one-group CT
   fix (E 35 KB, B 10–11 KB, a gap of one round trip; the pre-registered verdict is E). The fork is the second
   writer (#220's questions for the owner); then the sender and receiver implement it. Two records conflict and are
   to be reconciled: the hash bridge ((a) in #233, (b) in #234) and P3 (#234) against E (#223).
3. **The owner's decisions the crates wait on** (`pacs-receive-design.md` §14): hash column type, reply file and
   words, carrier, study-DB layout, viewer metadata (§6), DB engine, study index (engine and placement), serving
   defaults (D10, §9), verdict travel. Until then #258's crates are proposals and UNIFY-PACS only assembles.
4. **Questions for the PCS team** (§15): is each exam's tree kept as the record while updates can come; does it show
   the current state; can it sync a quiet or snapshotted tree; frame-file hashes; layout details; and, from
   INGEST-OQ, whether it would code the optimal-quality view itself (recommended: not now). Sending any note is the
   owner's.
5. **The product ingest writes the optimal-quality pair** (`claude/ingest-oq:docs/reviews/ingest-oq.md`, design only,
   nothing run). Recommended: the Rust ingest's phase 2 writes it (R), with `aomenc` as a subprocess so its bytes equal
   `ingest.py`'s `lossy` by construction, held there by a parity test; the Python `from_dicom.py --lossy` (P) only if
   a site hands DICOM files before phase 2. Inputs: raw frames (layout A) and the PCS's HTJ2K codestreams (layout B)
   alike; Q and G from the trigger's arguments while the ingest runs where the trigger fires (P1), which follows from
   item 1(d). The exact series is published first; a refused optimal-quality step leaves it served alone. The owner's:
   R or P; the **signed gap** (a signed source over 10 bits after the offset has no product form: S1, cut after the
   offset, extends a decided approach; S2, exact only); P1; I3. Tests T1–T5 and the mutants each must kill are written
   there; phase 2's own parts (several instances a series, the display keys `checkPair` compares) come first.
6. **The pair's names under serving by UID** (INGEST-OQ §6, read from code, not run): F1, `pairOf`'s `/^[\w.-]+$/`
   refuses PCS-coded UIDs (their alphabet has `~`) and a `/` between study and series; F2, the optimal-quality series'
   own id does not fit the serving grammar (no `.`, even length ≤ 44): a role in the URL (`/<Study>/<Series>/oq`) or a
   second grammar, decided with D10 and the store layout (§8), and whether the 10-26/27 rule against several bundles a
   series covers the pair; F3, a late instance writes both series again (the fingerprint changes, and the client
   refuses the pair until both are written: the check working).
7. **A bad instance and a changed duplicate** (`docs/ingest/README.md` §4, open): refuse the series or store the rest
   marked incomplete; replace, keep both or hold. Beside them, the parser's findings for its author (§5 there: planar
   configuration never read, three group hashes over a pre-conversion length, five-digit frame names).
8. **Whether the receive path needs its own range check** for signed sources, now that P4 is fixed in the reader and
   the digest (§2). A test of the receiver against P4's cases (`payload-format.md` §5, case 1) answers it.
9. **A hosted copy of the coded sets** (DATASET-HUB, `claude/dataset-hub`): a recipe key and a pin file, release
   assets as the lead host; not measured whether one recipe gives the same digests on another host. The owner's:
   adopt, which host, a write token.

## 5. Unsupervised

An agent may, without the owner: write theory and pre-registered protocols (another session measures); reconcile
item 2's two conflicting records in place, as a draft PR; carry the six missing commits of §2 in UNIFY-PACS's
assembly; write item 5's failing tests (T2's value matrix, T3's pair invariants) against today's `ingest.py`, item 8's
against the receiver, and F1's against `pairOf`, each as a draft PR with a review row. One branch and one draft PR per
question, from `main` once it holds the core design, or from `claude/unified-pacs` where the receive crates are needed.

Waits for the owner: any merge; any removal; every decision of item 3; R or P, S1 or S2, P1 and I3 (item 5); F2; the
delivery profile, the hash bridge and the layout (item 1); the second writer (item 2); any note to the PCS team; the
hub; anything structural (a crate as a default workspace member, serve-by-UID on the serving path); any change to §3.
"No new investigations" (2026-10-29) stands: evaluate from the research done.

## 6. Pointers

`docs/ingest/` (`README.md`, `design.md`, `link.md`, `contract.md`), `docs/disk-layout/target.md`, `ingest/`,
`common/series-bundle`, `docs/av1/payload-format.md` (§Optimal quality, §Source fingerprint, P4);
`claude/line-pacs:docs/ingest/` (`pacs-receive-design.md` §1–§20, `pcs-pacs-options.md`, `rsync-delivery.md`,
`rsync-updates.md`, `sync-protocol/`); `claude/ingest-oq:docs/reviews/ingest-oq.md`;
`claude/lines-ready:docs/reviews/lines-ready.md` §4, §7; `claude/dataset-hub`; PRs #258, #113, #118–#120, #126,
#142–#182, #220–#223, #230, #233, #234.
