# ADR: how updates to a study's metadata are received and applied at the PACS

**Status:** proposed 2026-10-25, **theory only: nothing built, nothing timed; not accepted.** Every choice in §10 is
the owner's; whether client-application updates go through the receiver's queue or a standard update endpoint
coordinated with it is **open**, for the team and the product owner
([`../ingest/pacs-receive-design.md`](../ingest/pacs-receive-design.md) §5).
Scope is the PACS side; the PCS is another team's. *(S)* a primary source in §12, *(M)* a number measured in this
repository, with where, *(E)* an estimate with its arithmetic, *(I)* this record's own inference.

**Builds on, read-only and unmerged:** #119 (`claude/pacs-receiver-design`, `docs/ingest/design.md` §12: the checks,
the series digest pairing, the owner's items 8 and 11), #142
([`serving-by-uid.md`](serving-by-uid.md):
`?digest=` and the refusal codes), #144 (`claude/metadata-update-cost` at `ebc1207`, `lab/metadata-store` README: one update
patched in place, measured), #145
([`display-metadata.md`](display-metadata.md):
the display metadata exported per series after the commit), #146
([`study-index.md`](study-index.md): the
outbox that publishes a study to the index).

**Decided by the owner, taken as given (2026-10-24/25).** Per study one SQLite-format **study DB**: one row per DICOM
metadata **group** (exam = patient + study, series, instance, private), each the group's key-value records under DECK
keys ([`../ingest/contract.md`](../ingest/contract.md) §Group files) and its XXH3; one `.sbnd` per series beside it.
One **receiver** process per host is the only writer. It ingests **submission packages** through numbered steps:
check, place pixels, one transaction into the study DB, verify, derive, confirm "stored" to the sender, delete the
package; on failure it refuses, and the sender resends. An update replaces the current row, keeps no history, and
leaves an audit record (who, when, what changed). An update carries metadata only, down to the level that changed.

**Named here** (glossary entries on acceptance): an **update package** is a submission package that carries
metadata only; its **base hash** is the XXH3 of the group row it was written against; a **withdrawal** is a package
that hides a series or a study.

**Against the design state (2026-10-26).** *Corrected in place:* "display document" is now *display metadata*.
**Conflicts left open, not resolved here** (§13, for the team meeting, proposes how the PCS's updates travel and
would settle the first):

* **The update's format.** This record recommends differences by DECK key (§1, row 2); [`pcs-transfer.md`](pcs-transfer.md)
  (#149) §1 row 7 recommends whole changed group files. The owner decided updates carry metadata only, down to the
  level that changed, *likely* as differences; the format is not decided (design state §2, §5).
* **Propagation** (§1 row 5, §7) assumes #145's derived per-series display metadata file; where viewer metadata lives
  is the design state's §6 Open item, and under the owner's current view (read from the study DB at open) there is no
  derived file to rewrite.

## 1 · On one screen

| question | recommendation | what decides it | cost of switching later |
| --- | --- | --- | --- |
| **1 Write paths** | **One path.** Client applications reach a small **update API** that authenticates, authorizes, stamps the author and submits an update package to the receiver like any sender. The receiver serves each study's packages in arrival order, with a worker set aside for metadata-only packages, and a sender may wait for "stored" | whether any requirement holds a bound the receiver cannot meet when idle, ≈ 10 ms (E, §3) | direct → one path later: undo a second writer. One path → direct later: add one, with its locks, audit and derive code twice: high |
| **Priority** | by **what a package is** (metadata only), never by **who sent it** | — | a scheduling rule inside the receiver: low |
| **2 Format** | **differences**: `set` / `remove` by DECK key, **a sequence replaced whole**; a whole group accepted and turned into differences on arrival. UIDs and the frame description refused | the audit's "what changed"; sequence item indices that shift | for every sender once they exist: medium |
| **3 Lost updates** | **every group touched names its base hash**; stale → refused, permanently. Over HTTP, `If-Match` required, `412` stale, `428` absent | a viewer and the PCS correcting the same group | required from day one costs nothing; added later breaks every client that omits it |
| **4 Audit** | one row per package, **applied or refused**, holding the operations **and the prior values**, in the study DB, **in the same transaction**; DICOM's Original Attributes fields as its vocabulary; kept past the study's deletion | atomicity with the change; the retention law that applies (the owner's) | forwarding to a central audit repository later is additive |
| **5 Propagation** | derived copies written **before "stored"** (display metadata; the index's outbox intent). Open pages **revalidate** their display metadata; no push | a metadata-only update leaves the bundle, so #142's digest does not change | revalidation → push: a wire message, medium |
| **6 Withdrawal** | a withdrawal package: series or study, a reason from CID 7010's four rejection titles, an author. **Hide, then purge later**; refuse the same UIDs again until reinstated | IOCM's expected actions for patient safety and worklist errors | hide → delete is a purge job; delete → hide is impossible for what is gone |
| **7 Authorization** | **now**: two authenticated sender kinds, and `sender` and `on_behalf_of` in every package and audit row. **Later**: users, roles, per-key rules | what the format must carry, not who may do what | in the format now: cheap; added later: a format change and an audit history without authors |

**The owner's doubt, answered.** "Apply immediately" does not need a second path. On the one path, an update to a
study with no package in progress is confirmed in **≈ 5–15 ms at 2 000 instances (E, §3)**, under any human's
notice. What a separate path would gain is the wait behind *that study's own* pixel package, ≈ 0.3–1 s (E), and to
gain it, it would have to write a study DB the receiver is writing, which the one-writer rule forbids. A requirement
worded "immediately" is not sane as stated: the PCS's corrections (a wrong patient name from the RIS) are at least
as urgent as a viewer's. The honest requirement is a **bound, the same for every sender's metadata-only package**:
*confirmed within 1 s p99 when the receiver is healthy*, checked by §11 before it is promised.

## 2 · Write paths

**The options.**

| | (a) one path: the API submits a package (recommended) | (b) the API writes the study DB directly | (c) a fast entry inside the receiver, past its queue |
| --- | --- | --- | --- |
| writers of a study DB | the receiver | the receiver and the API | the receiver |
| order between a PCS update and a viewer's | the receiver's arrival order, per study | whichever commits first; the queue's packages may then be applied on a newer row than they were written for | as (a), if (c) shares the study's order; otherwise as (b) |
| audit, derive, validation | once | twice, kept equal by hand | once, if it calls the same steps |
| engine | any (#145's reason: Turso's single-process limit fits) | multi-process SQLite (WAL, one host), not Turso today (#145 §3) | any |
| survives a receiver restart | the package is a file in the queue | — | lost unless written first, which is (a) |
| latency when idle | (a)'s own work, ≈ 5–15 ms (E, §3) | the transaction alone, ≈ 1–8 ms (M, #144) | as (a) less the queue file's `fsync` |

(b) is the only one that is faster in a way anyone could notice, and only when the receiver is busy with the same
study. It is the one that breaks a decided rule. (c) is (a) with the package not made durable before it is applied;
the queue file's `fsync` is a few milliseconds (I, not measured here) and buys crash recovery and one order, so (c)
saves nothing worth its second entry.

**The shape of (a).**

```text
 viewer ── HTTPS, If-Match ──▶ update API ─ authenticate, authorize, validate shape, stamp author ─┐
 PCS ───── HTTPS (link.md) ───────────────────────────────────────────────────────────────────────┤
                                                                                                    ▼
                                   receiver: intake → queue file, fsync → per-study order → worker
                                   check → (no pixels) → transaction: rows + audit → verify → derive → "stored"
```

The API is a sender like the PCS: it submits through the receiver's own intake and relays the answer. It never opens
a study DB. What it adds is authentication of a person and the author it stamps into the package (§9).

**Scheduling, the part that answers priority.** The receiver may run several workers; each study DB has one writer
because a worker holds a study while it works on it (I: SQLite allows one writer per file, and the files are per
study).

| | one FIFO queue, one worker | per-study order, a worker pool | per-study order, a pool, one worker that takes only metadata-only packages (recommended) |
| --- | --- | --- | --- |
| an update behind another study's pixel package | waits for it | waits only if every worker is busy | never waits for another study |
| an update behind its own study's pixel package | waits | waits | waits: same study, same order |
| a backlog of 100 series after a PCS outage | an update waits for all of it: ≈ 30–100 s (E) | as above, divided by the pool | ≈ 5–15 ms (E) |
| what it costs | — | a map of busy studies | the same, and one more worker |

**An update never overtakes an earlier package of its own study.** Allowing it would be correct only when the two
touch different groups, and it would make the audit's order differ from arrival; the base hash (§5) already refuses
the case where the order matters. Preempting a package in progress is not offered: its transaction would have to be
rolled back and the pixels placed again (I).

**A sender that waits.** The update API holds the request until the receiver answers or a timeout *T* passes
(default 2 s, the owner's):

* **`200`** with the new base hashes as `ETag`s: stored, its derived copies written (§7).
* **`412 Precondition Failed`**: a base hash is stale (§5). **`422`** with the failed check: invalid (§4).
* **`202 Accepted`** with a status URL (RFC 9110 §15.3.3) after *T*: it is queued, will be applied, and resending
  it is harmless (the package's identity below). A client that asked `Prefer: respond-async` (RFC 7240 §4.1) gets the
  `202` at once.

**Refusals: resend or not.** Today a refusal means "send again". An update adds refusals that sending again cannot
cure: stale, invalid, forbidden. So the receiver's answer carries a class, **`retry`** (a disk fault, a shutdown) or
**`final`** (stale, invalid, forbidden, withdrawn), and the PCS stops resending on `final` and raises it to a person.
Each package carries an identity the sender chooses (a UUID); the same identity again is answered with the first
outcome and does no work, which is #119 §12.6's rule for series.

**What can honestly be guaranteed.**

| | guaranteed | limitation, to state |
| --- | --- | --- |
| order | per study: packages are applied in the order the intake made them durable | none across studies; none between senders beyond that, so concurrent writers are refused (§5), not ordered |
| read your writes | after `200`, a fetch of that series' display metadata on that host returns the new values (§7) | the study index is published after "stored" (#146's outbox); a list may lag by its publish (milliseconds, more if the index is down) |
| delay | none as a hard bound: a disk stall, a restart or a pixel package of the same study delays it | the target is a measured p99 (§11), not a promise; `202` is the honest answer past *T* |
| durability | `200` and `202` mean the package is on disk at the PACS | a lost disk loses it, as any package |
| one patient across studies | each study's update is its own package | no atomicity across studies: a name changed in three studies can be seen changed in two (#146 §7) |

## 3 · Queue latency, estimated

Nothing here is measured as a whole; the arithmetic is shown so that §11 can check it.

* **The update's own work at 2 000 instances (E).** The queue file written and `fsync`ed: ≈ 1–3 ms (I: one small
  write and a directory `fsync` on an SSD, not measured here). The transaction, rows and page row: **2.30–2.86 ms**
  (M: #144 at `ebc1207`, `lab/metadata-store --mode update-cost`, "patched, latency to visible", one update at a time on one
  study; 1.08–1.59 ms at 200 instances, 7.6–8.2 ms at 10 000). The display metadata exported, written, `fsync`ed and
  renamed: ≈ 1–5 ms (I, ≈ 96 KB, #145 §3). The outbox intent: one small commit, ≈ 1 ms (I). **Total ≈ 5–15 ms.**
* **Behind its own study's pixel package (E).** Placing a 152 MB series at the 550–620 MB/s that #144 measured for a
  16 MB write and `fsync` is ≈ 0.25–0.28 s; check 3 adds ≈ 5 ms (#119 §12.3); the transaction inserting 2 000 instance
  rows is not measured. **≈ 0.3–1 s**, less if placing is a rename on the same filesystem.
* **Behind other studies.** Zero with the recommended worker; with one FIFO worker, the sum of what is ahead: 100
  series at 0.3–1 s is 30–100 s (E).

**Where the host saturates** is not known: #144 ran one update at a time on one study, and claims nothing for
concurrent updates or many studies. Nothing above is claimed past that.

## 4 · The update format

**Whole group or differences.**

| | whole group | differences: `set` and `remove` by key (recommended) |
| --- | --- | --- |
| bytes | the group: ≈ 1.1 KB an instance (2.15 MB / 2 000, #119 §12.4) | the changed records |
| the audit's "what changed" | computed by diffing old and new | the operations themselves, plus the prior values the receiver reads |
| a fan-out (one attribute in 2 000 instances) | 2 000 groups, ≈ 2.2 MB | 2 000 `set`s of one record |
| the sender must hold | the current group | the keys it changes and the base hashes |

**Recommended: differences as the one form the receiver applies; a whole group accepted from the PCS** (which
re-runs the parser and has groups, not differences) and turned into differences against the current row on arrival.
Everything after intake (validation, audit, derive) sees only differences (I).

```text
update package (one per study):
  identity, sender, on_behalf_of, reason (CORRECT | COERCE, and text), study UID
  per group: level, UIDs naming it, base hash,
             operations: set <key> <value> | remove <key> | replace-sequence <key> <items>   (or: group <records>)
```

**Addressing by DECK key.** At the top level a key is the tag, the VR and the parser's charset index, 8 bytes
([`../ingest/contract.md`](../ingest/contract.md) §Group files); a nested record's key is 8 bytes longer per sequence
item level. What those 8 bytes hold (the sequence's tag, the item's index) is the parser's, and the contract does not
say; it must, before nested keys are addressable (§10, Q4). The charset index is part of the key, so a client that
sends UTF-8 text must be told which index to use; default: the one the group's records already use.

**Nested sequences.** An item addressed by its index shifts when an earlier one is removed, so:

* `set` and `remove` of a record inside an existing sequence item, by its full key;
* adding, removing or reordering items is **`replace-sequence`**, the sequence given whole. DICOM does the same for
  N-SET of a procedure step: "When modifying a sequence, the SCU shall include in the N-SET request all Items in the
  sequence, not just the Items to be modified" (PS3.4 §CC.2.6.2) (S).

The base hash makes index addressing safe: an update written against another state of the group is refused.

**Validation, in order, all before the transaction.**

1. **Structure:** key lengths a multiple of 8, a known VR, value lengths within the package.
2. **The value against its VR**: character repertoire, length, format (a DA is `YYYYMMDD`, a UI follows PS3.5 §9.1),
   value multiplicity (PS3.5 §6.2) (S). A failure is `final`.
3. **Keys never updated:** the three UIDs (0020,000D), (0020,000E), (0008,0018), which name the object (a changed UID
   is a different object: IOCM rejects and replaces, §8); the frame description #119 §12.3 checks against the
   `.sbnd` (rows, columns, bits, photometric, samples, number of frames); group 0002.
4. **The level:** a key goes in the group of its level (patient and study attributes in the exam group).
5. **Applied, then checked:** the new group re-read and its XXH3 computed, inside the transaction (the owner's
   "verify" step).

## 5 · Lost updates

Two senders read a group, both change it, the second's write erases the first's. The options:

| | last writer wins | base hash per group (recommended) | per-key check: refused only if a touched key changed | a lock taken before editing |
| --- | --- | --- | --- | --- |
| lost update | yes, silently | refused | refused for the same key; two edits to different keys both apply | no, while the lock holds |
| code | none | compare one hash per group | a key-level history, which updates do not keep | a lock service, its timeout, its holder's crash |
| precedent | — | HTTP `If-Match` (RFC 9110 §13.1.1) (S) | — | the UPS Transaction UID (PS3.4 §CC.2.6.3: the SCP "shall refuse set requests on an IN PROGRESS UPS … if the set request does not include the Transaction UID") (S) |

**Recommended: the base hash, per group the update touches, all checked in the transaction; any stale one refuses
the whole package, `final`.** Over the update API it is HTTP's own: the group's `ETag` is its hash, the client sends
`If-Match`, a stale one is `412 Precondition Failed` (RFC 9110 §15.5.13), a missing one `428 Precondition Required`
(RFC 6585 §3) (S). A refused client fetches the group again, shows the user what changed, and resubmits.

* **XXH3 is enough here** (I): the hash compares a sender's own copy with the current row; a sender gains nothing by
  forging it, and a 64-bit accidental match is not a concern at these volumes.
* **A → B → A** compares equal: an update written against the first A applies to the restored A, whose content is
  the same, which is the intended meaning.
* **The PCS's updates** name base hashes too: it knows the hashes of the groups it sent. A viewer's correction in
  between makes the PCS's update stale, and a person decides (§10, Q3). The alternative, the PCS always wins, is
  last writer wins for one sender.

## 6 · The audit record

**What it holds**, one row per package, refused ones included (I: a refused attempt by an unauthorized sender is what
an audit is for):

| field | from |
| --- | --- |
| the package's identity; received at; applied at; outcome (stored, or the refusal and its class) | the receiver |
| sender (the PCS site, the update API) and `on_behalf_of` (the person) | the authenticated intake (§9) |
| the study, series and instance UIDs and the groups touched; each group's base hash and new hash | the package and the transaction |
| the operations, **and the prior value of every record set, removed or replaced** | the receiver reads them in the transaction |
| the reason: `CORRECT` or `COERCE`, and free text | the sender |

DICOM already names these fields for a changed object: the Original Attributes Sequence (0400,0561), with the prior
values in Modified Attributes Sequence (0400,0550), Attribute Modification DateTime (0400,0562), Modifying System
(0400,0563), Source of Previous Values (0400,0564) and Reason for the Attribute Modification (0400,0565), whose
defined terms include `COERCE` and `CORRECT` (PS3.3 §C.12.1, Table C.12.1.1.9-1) (S). Using its vocabulary costs
nothing and lets an export to DICOM later write the sequence from the audit (I). The prior values are why "no kept
history" still loses nothing that an audit must show: they are the history of each change, not of the group.

**Where it lives.**

| | a table in the study DB, same transaction (recommended) | a per-host audit log | a central audit repository (IHE ATNA) |
| --- | --- | --- | --- |
| atomic with the change | yes | no: a crash between them loses one or the other | no |
| travels with the study | yes | no | — |
| survives the study's deletion | **no, unless copied out first** | yes | yes |
| what it adds now | a table | a file and its recovery | a network service, its outage |

**Recommended: the study DB, as #146 §7 already says ("the audit record lives with the source"); before a study is
purged (§8), its audit rows copied to a per-host archive of purged studies.** A central repository, if the owner's
sites run one, is fed later through the same kind of outbox as the index, in PS3.15's audit message format: "DICOM
Instances Accessed" with EventActionCode `U` (Update) (PS3.15 §A.5.3.6) (S). Its rows carry identifiers and prior
values, so the audit table gets the study's own access rules (I).

**How long.** The law that applies is the owner's; this record knows of no single rule. HIPAA requires audit
controls (45 CFR §164.312(b)) and keeps required documentation six years (§164.316(b)(2)(i)); whether the audit
rows count as that documentation is a legal reading, not made here (I). **Default: at least as long as the study,
then the archive's period after a purge.** The size is not a limit: hundreds of bytes per update (I).

## 7 · Propagation to derived copies and open sessions

**Derived copies, written before "stored".** The owner's steps put derive before confirm, so a `200` means:

| copy | how it follows | when it shows the update |
| --- | --- | --- |
| the series' display metadata (#145, option 1) | re-exported for every series whose groups the update touched: the file written, `fsync`ed and renamed | before the `200`: read your writes holds for it on this host |
| the study index's rows (#146) | the outbox intent written; the publisher replaces the study's rows | after the `200`, by the publish: eventual |

Re-exporting every touched series, rather than only when a display attribute changed, keeps one rule and costs
milliseconds (§3).

**Open sessions.** A metadata-only update does not change the `.sbnd`, so #142's `?digest=` still matches and an open
page keeps the display values it fetched. Most such changes are harmless while a page is open (a description); some
are not: a corrected laterality or patient name on a screen being read is the case #119's item 8 names. The options:

| | (a) nothing; seen at the next open | (b) the page revalidates its display metadata (recommended) | (c) the server tells the session |
| --- | --- | --- | --- |
| how | — | `If-None-Match` with the document's `ETag`, at focus and every *P* seconds; `304` when unchanged (RFC 9110 §13.1.2, §15.4.5) (S) | a new FoD message; the server must learn of the change, so a signal from the receiver or a `stat` per open series |
| stale for | the page's life, hours with keep-alives | at most *P* | milliseconds |
| what changes | — | the page's fetch loop; nginx already answers `304` (#145 §3) | the wire, both clients, the contract suite, a receiver → server signal (#119 §12.7's (b)) |

**Recommended (b)**, *P* = 60 s by default (the owner's, Q6). On a change the page takes the new document; whether
it tells the user, and for which attributes, is a clinical choice (Q6). A **withdrawn** series' document is gone, so
revalidation gets `404` and the page shows it withdrawn (§8). (c) is worth building when (b)'s *P* is shown too long
for a real case; its cost is a wire change, so not now.

## 8 · Withdrawal: a series or a study sent to the wrong patient

**What established practice does.** IHE's Imaging Object Change Management profile (IOCM) "specifies how one actor
communicates local changes applied on existing imaging objects", covering rejection for quality or patient safety,
correction of an incorrect worklist entry, and data retention expiry (RAD TF-1 §28) (S). The change is a DICOM Key
Object Selection document (PS3.3 §A.35.4) stored by Rejection Note Stored [RAD-66], whose title is one of CID 7010's:
113001 "Rejected for Quality Reasons", 113037 "Rejected for Patient Safety Reasons", 113038 "Incorrect Modality
Worklist Entry", 113039 "Data Retention Policy Expired", and 131360 "Rejection Withdrawn" (PS3.16 CID 7010, 2026d)
(S). The archive's expected actions (RAD TF-2 §4.66.4) (S):

| reason | the archive |
| --- | --- |
| quality (113001) | stores the note; exposes or hides the instances, configurable |
| patient safety (113037) | "shall hide the referenced instances", and "shall not accept subsequent occurrence of instances that have been hidden" (§4.66.4.2.3, §4.66.4.2.3.1) |
| incorrect worklist entry (113038) | hides them, and refuses them again, the same words (§4.66.4.3.3) |
| retention expired (113039) | decides by its own policy; "may delete" (§4.66.4.4.3) |

Corrected objects come back as new instances with new UIDs (Replacement Instances Stored [RAD-74], RAD TF-1
§28.4.3) (S). IOCM "shall not be used as an alternative mechanism for handling patient information reconciliation"
(RAD TF-1 Table 28.3-1) (S): a patient's demographics corrected is an update (Patient Information Reconciliation,
RAD TF-1 §4; the Image Manager ensures "the patient information … has been updated … when they are retrieved", RAD
TF-2 §4.12.4.1.3) (S).

**So "wrong patient" is two cases** (I):

* **The study is right, its patient attributes are wrong** (a misspelt name, a wrong ID): an **update** of the exam
  group, by a sender allowed to change patient identity (§9). No withdrawal.
* **The images belong to another patient's study** (a wrong worklist entry): a **withdrawal** of the series or the
  study here, and the PCS sends the corrected images as new series under the right study, new UIDs.

**The minimum we need.** A withdrawal package: the study UID, optionally one series UID, a reason code from the four
titles above, the sender and author. Its effect, through the same steps and the same audit:

1. the series' (or each series') row marked withdrawn with the reason, in the study DB's transaction;
2. its display metadata removed, and the index's rows removed or flagged by the publish;
3. new sessions refused "not found" (the server does what #142 §4 says for an unlinked series, once the bundle is
   moved aside); open pages learn by §7's revalidation;
4. a later package with the same series UID refused `final` "withdrawn", as RAD TF-2 §4.66.4.2.3.1 requires, until a
   **reinstatement** (131360's meaning) by an allowed sender;
5. **purged** (bundle and rows deleted, the audit kept, §6) after a grace period (Q8), or by the retention policy.

**Not needed now:** storing the Key Object Selection document itself, the "expose rejected" view and its second
query endpoint (§4.66.4.1.3), instance-level withdrawal, a modality's procedure step. An instance withdrawn inside a
series would change the series' frames, so it is a new series package from the PCS, not a withdrawal.

## 9 · Authorization of senders

**What must be designed now** is what the package and the audit carry, because adding fields later changes the
format and leaves an audit history without them:

* **Two sender kinds, both authenticated at the intake:** the PCS (one TLS client certificate per site, which #146
  §10 Q5's default makes the study's access key) and the update API (a local credential). Nothing else may submit.
* **`sender` and `on_behalf_of` stamped by the intake**, never taken from the client's body.
* **The receiver's rule now is per sender kind and package kind:** the PCS may submit series, updates and withdrawals
  for studies its site sent; the API may submit updates and withdrawals on behalf of a person it has authenticated.
* **Patient identity keys** (the exam group's patient attributes) and withdrawals are marked as needing a privilege
  in the receiver's rule now, even if every API user holds it at first (I): the line is then drawn once.

**What can wait:** how a person signs in to the API (an identity provider), roles, a per-key allowlist per role, a
second person confirming a withdrawal, IHE's authorization profiles. Each is a check inside the API or the rule
above, with no change to the package.

## 10 · Questions only the owner can answer

Each with the default this record assumes.

1. **The latency promised to client applications.** Default: "confirmed within 1 s p99 when the receiver is healthy,
   the same for every sender's metadata-only package", once §11 shows it.
2. **The update API's wait *T*.** Default: 2 s, then `202`.
3. **The PCS's update against a group a viewer has changed:** refused and shown to a person, or the PCS always wins?
   Default: refused, `final`.
4. **The nested key's extra 8 bytes and the charset index of new text** (§4): the parser's definition, written into
   the contract. Default: none addressable until it is; `replace-sequence` on top-level sequences only.
5. **Refused attempts in the audit.** Default: yes, every one.
6. **Open pages:** the revalidation period *P*, and which changes the user is told of. Default: 60 s; told for patient
   identity, laterality and withdrawal, silent otherwise.
7. **Audit retention** and the law that sets it. Default: as long as the study, then the purged-study archive's
   period.
8. **A withdrawal's grace before purge.** Default: 30 days, the bundle and rows kept and hidden.
9. **Who may change patient identity and withdraw.** Default: the PCS, and API users with a privilege that is at
   first everyone's.

## 11 · Performance: a protocol, no number

**Claims under test:** §3's estimates, and the bound Q1 would promise.

* **Arms, interleaved in every round, order rotated** ([`../../CLAUDE.md`](../../CLAUDE.md) §Measurement): (i) idle;
  (ii) an update submitted while the receiver places a pixel package of the same study; (iii) while it places
  packages of 1, 10 and 100 other studies; (iv) as (iii) without the metadata-only worker. An A/A arm: (i) twice.
  Studies of 200, 2 000 and 10 000 instances; 100 updates per cell; two runs.
* **Metric:** latency from the API's request to its `200`, and from intake to "stored" inside the receiver; the
  receiver's steps timed separately. Latency only, no throughput (one is the other divided by depth). Cold reads
  forced through the store's test levers, never by page-cache eviction.
* **Saturation:** updates at increasing rates until p99 doubles; that rate stated, nothing claimed past it.
* **Correctness, each test mutated to fail first:** two updates with the same base hash, the second refused `412`
  (mutate: skip the compare); an update never applied before an earlier package of its study (mutate: pick by
  priority alone); the same identity twice does one transaction (mutate: drop the lookup); a crash between each
  step, then restart, ends with the update applied once and audited once; a withdrawn series' UID refused again.
* **Decision rule, before any data:** Q1's bound is offered if (i) and (iii) meet p99 ≤ 1 s at 2 000 instances,
  beyond the A/A spread; (ii) is reported, not promised. If (iv) meets it too, the extra worker is dropped. If (i)
  misses it, §2 is reopened.

## 12 · Sources

Fetched 2026-10-25. DICOM 2026d from `dicom.nema.org/medical/dicom/current/output/chtml/`; IHE RAD TF Rev 23.0
(2025-08-08) from `ihe.net/uploadedFiles/Documents/Radiology/IHE_RAD_TF_Vol1.pdf` and `…Vol2.pdf`. Nothing fetched is
committed.

| claim | source |
| --- | --- |
| Original Attributes Sequence and its fields; `COERCE`, `CORRECT` | DICOM PS3.3 2026d §C.12.1, §C.12.1.1.9, Table C.12.1.1.9-1 |
| Key Object Selection Document | PS3.3 2026d §A.35.4 |
| the rejection titles, 131360 "Rejection Withdrawn" | PS3.16 2026d CID 7010 (version 20260603) |
| a sequence set whole in N-SET | PS3.4 2026d §CC.2.6.2 |
| the Transaction UID refuses sets without it | PS3.4 2026d §CC.2.6.3 |
| UID grammar; VR rules | PS3.5 2026d §9.1, §6.2 |
| "DICOM Instances Accessed", EventActionCode `U` | PS3.15 2026d §A.5.3.6 |
| IOCM: scope, actors, use cases, not instead of PIR | IHE RAD TF-1 Rev 23.0 §28, §28.4.2–28.4.4, Table 28.3-1 |
| Patient Information Reconciliation | RAD TF-1 Rev 23.0 §4 |
| Rejection Note Stored, expected actions | IHE RAD TF-2 Rev 23.0 §4.66.4.1.3, §4.66.4.2.3, §4.66.4.2.3.1, §4.66.4.3.3, §4.66.4.4.3 |
| the Image Manager updates patient information | RAD TF-2 Rev 23.0 §4.12.4.1.3 |
| `If-Match`; `412`; `If-None-Match` and `304`; `202` | RFC 9110 §13.1.1, §15.5.13, §13.1.2, §15.4.5, §15.3.3 |
| `428 Precondition Required` | RFC 6585 §3 |
| `Prefer: respond-async` | RFC 7240 §4.1 |
| audit controls; six-year retention of documentation | 45 CFR §164.312(b), §164.316(b)(2)(i) |

**Not verified:** IHE ITI's audit trail profile (ATNA) and its authorization profiles, named and not read; a change
proposal to RAD-66 listed on IHE's 2026-01-08 radiology minutes (CP-RAD-556), not read, which may change §8's
wording; the time of a small `fsync` and of placing a series on the PACS's disk (§3), both estimated; whether a PCS
re-run of the parser can name the base hashes it needs (§5; §13.3 proposes the sender's sent list as their source).

## 13 · How a change travels from its origin to the study DB — for the team meeting

**Status: Proposed, not decided; written for the team meeting of the PCS team, the team and the owner.** Theory only:
nothing built, nothing timed. It answers the owner's open question of 2026-10-26 (below) and leaves §1–§11 as they
are, except where a line says *(changes §n)*.

**Decided by the owner, 2026-10-26, taken as given.** Our PCS-side **sender** builds each package and sends it (the
PCS document's process (3), "forwarding to cloud"); it takes the study's **exam directory** as the package root;
updates carry metadata only, down to the level that changed. Left open by the owner: how the parser (processes (1)
and (2)) and the sender interact on a change, what the package carries, and how the receiver reads it.

### 13.1 · Where corrections come from, and which reach the PCS

| origin | how it travels in established practice | reaches the PCS? | reaches the study DB through |
| --- | --- | --- | --- |
| **a modality or workstation re-sends an instance**, same SOP Instance UID, changed attributes (a corrected description, a patient name fixed at the console, a QC step at the hospital's own archive) | C-STORE again; the standard leaves what a Storage SCP does with a UID it already holds to the SCP and its conformance statement (S: PS3.4 §B.4 lets an SCP coerce attributes, "implementation dependent"; nothing read in PS3.4 prescribes the duplicate case) | **yes**: the PCS is a Storage SCP; the parser runs again on the instance | the sender, as an update package |
| **a patient update or merge** at the RIS/HIS: HL7 v2 ADT A08 (update patient information), A40 (merge patient identifier list) | IHE Patient Information Reconciliation: the Image Manager receives Patient Update [RAD-12] and must return the corrected values when objects are retrieved (S: RAD TF-1 §4; RAD TF-2 §4.12.4.1.3); the images are **not** re-sent | **no**: the PCS has no HL7 interface (README and `DICMele2deck/README.md` at `a65abe2`: a Store SCP only) | only if the hospital's archive re-sends the objects (row 1), or a feed reaches our update API (§2); neither exists — question for the product owner (Q-U5) |
| **a rejection** (wrong patient, wrong worklist entry, quality, retention) | IHE IOCM: a Key Object Selection document with a CID 7010 title, stored by [RAD-66]; corrected objects come back with **new** UIDs [RAD-74] (S: RAD TF-1 §28, RAD TF-2 §4.66; §8 above) | **yes, as an instance**: a KOS is a C-STORE like any other, of a non-image SOP class | a document series package; the receiver reads its title (§13.4) |
| **manual QC at the PACS** (a person corrects a value in our viewer) | — (this is our product) | no: it starts at the PACS | the update API, §2: differences with a base hash |
| **MPPS** (Modality Performed Procedure Step, [RAD-6]/[RAD-7]): what the modality made, or that a step was discontinued | N-CREATE/N-SET to an MPPS SCP; it lists instances, it does not correct them (S: PS3.4 Annex F; `pcs-transfer.md` §2 cites it for completeness) | **no**: the PCS is not an MPPS SCP | nothing; at most a fourth completeness test for process (2) (`pcs-transfer.md` §2) |

**What this says about the unit (I).** Everything that reaches the PCS arrives as **a whole object again**: DICOM has no
"change these attributes" message over C-STORE, and IOCM replaces rather than edits. So at the PCS the natural unit
of a change is **the whole group** the parser writes from that object; attribute-level differences originate only
where a person edits a value, at the PACS. Two forms, each where it is natural, and the receiver turns the first into
the second (§4 already says so). This settles §17 A8 of the design state *(changes the "update's format" conflict in
this record's header)*: **whole changed groups on the PCS's wire, differences on the update API's, differences in the
audit.**

### 13.2 · What the parser does today on a re-sent instance

Read in `DICMele2deck/src/capi/ESIPFfiled/capi.c` at `a65abe2` (S); not run for this section.

* **One run per instance.** Each group file is named by the hash of its bytes and written **only if no file of that
  name exists** (`access(…, F_OK)`, lines 201, 260, 339, 383), with `fopen`/`fwrite`/`fclose`: no temporary name, no
  rename, no `fsync`. Nothing is ever deleted (no `unlink` in the file).
* **So a correction adds a name beside the old one.** A re-sent instance with a corrected patient name leaves
  `<E>/--.<old>` and `<E>/--.<new>` in the exam directory, and two `----.<h>` in the instance directory. Frame files
  are not rewritten (they exist), which is right: changed pixels mean a new SOP Instance UID (I).
* **A reverted correction is invisible.** A → B → A: the third run finds `--.<A>` present and writes nothing. No name
  appears, nothing in the tree says A is current again.
* **A corrected study date moves the study.** The tree starts at `<D>/`, the coded study date (line 153); a corrected
  (0008,0020) writes a second whole tree under another `<D>/`, frames included.
* **Already owed (§10 of the design state, §15 there):** nested keys carry memory-address bytes, so parsing the same
  instance twice can give a different name; series, instance and private groups are hashed before UTF-8 conversion, so
  a name with a non-ASCII value is not its hash. **Both make every option below report changes that did not happen**,
  so both are preconditions, not options. *Corrected 2026-10-28:* both are fixed upstream at `e105214` (`348aa99`,
  `e21160f`), so neither is a precondition now ([`../ingest/pacs-receive-design.md`](../ingest/pacs-receive-design.md)).

### 13.3 · The options

Common to all: the receiver applies per study in arrival order, checks each touched group's **base hash** (§5),
writes rows and the audit in one transaction (§6), answers `stored` or a refusal with its class (§2). Package
identity is its name, its XXH3 (design state §2), so a resend of the same bytes is answered with the first outcome.

| | **(a)** the parser rewrites groups and **notifies** the sender | **(b)** the parser writes a separate **difference file** | **(c)** the sender **diffs the tree's names** against what it last sent | **(d)** the sender sends the study's **name list**; the receiver asks for what it lacks |
| --- | --- | --- | --- | --- |
| the parser must | write the new group, then send a message (a queue file, a socket) naming it | read the previous group, compute `set`/`remove` (and `replace-sequence`, §4) and write an update file beside the tree; and still update the tree | keep **one name per marker** per directory: write a temporary file, rename it to its hash name, delete the other names of that marker | as (c) |
| the sender does | reads the queue; builds and sends | collects difference files in order; sends; deletes them after `stored` | scans the exam directory, compares with its **sent list**, builds a package of the groups whose names are new, each with its old name as base hash; records the list after `stored` | sends a manifest (all names), receives the missing ones' list, sends those |
| the package carries | whole changed groups | attribute differences | whole changed groups | whole changed groups |
| the receiver | whole group → differences (§4), base hash, audit | applies differences; but their base is the **parser's** previous file, which may not be what the PACS holds | as (a) | as (a), plus a manifest endpoint and a second request |
| ordering | the notification order; a lost one is a lost update | a chain: one lost or reordered file breaks every later one | the base hash is the order: an update applies only on the group it names; one package in flight per study | the receiver's own rows are the base: no ordering by the sender |
| crash between writing and telling | the change is in the tree, the notice lost: **needs (c)'s scan to recover** | the difference file and the tree can disagree | nothing to lose: the tree is the state, the sent list moves only after `stored` | nothing to lose, no state at the sender |
| A → B → A | sent if the parser notifies on every write | a difference B → A, if the parser computed it | the A file is written again (the B one was deleted), so its name differs from the sent list's B: sent | sent |
| new protocol between parser and sender | **yes** | **yes** (a file format) | **no** | no |
| new code at the PCS team | a notifier | a differ for nested sequences, a format, a lifecycle | a rename and an unlink per group written | as (c) |
| cost on the link | one request | one request | one request | **two round trips**: ≈ 1.2 s more on a 600 ms GEO link (E) |
| verdict | (c) plus a channel that can lose messages, still needing (c) to recover | the most code on the side with the least domain bandwidth; duplicates what the receiver already does | **simplest that is robust**: the tree is the only state, content names are the change signal | robust and stateless, but a round trip and an endpoint for a sender state of a few KB a study |

**(c) in detail, the recommendation.**

* **The sent list.** Per study, one small file at the sender: the exam group's name, and per series the names of its
  series, instance and private groups, as last confirmed `stored` (≈ 70 bytes a name, ≈ 140 KB at 2 000 instances,
  E). Written by temporary file and rename after each `stored`; never before.
* **The scan.** For each study the sender has sent (they grow "until the report is authenticated", design state §1),
  list the exam directory's group names and compare. A name in the tree and not the list is a change; its marker's
  name in the list is the base hash. A level whose name did not change is not sent: **down to the level that changed**
  falls out of the comparison. Listing 2 000 instance directories is milliseconds to tens of milliseconds warm (E, not
  measured); when it runs (every *N* seconds, or on filesystem events) is a sender setting, not a protocol.
* **Before a group is sent, its bytes are hashed and compared with its name.** A mismatch is a file still being
  written (or the hash bug above): skipped until the next scan. The temporary-name rename makes it rare; the check
  makes it harmless.
* **One update package per study in flight**; the next waits for `stored`. With §2's per-study order this makes the
  receiver's order the tree's order.
* **Crash safety.** Crash before `stored`: the list is unchanged, the scan builds the same package, same bytes, same
  name, and the receiver answers the first outcome. One rule to add at the receiver *(adds to §5)*: **an update whose
  new hash already equals the current row is answered `stored`, with no audit row**, so a package rebuilt after a
  crash with other bytes (another compression level) is not refused as stale.
* **Stale.** A viewer corrected the same group since: the receiver refuses `final`, the sender stops on that study and
  raises it to an operator (§5, Q3).
* **A series not yet sent** has no list entry: a re-sent instance just changes the tree, and the series package, when
  built, carries the current state. Updates exist only after a series is `stored`.
* **A study date corrected:** the sender keys the list by the coded **study UID**, not the path, so a second `<D>/`
  holding the same `<E>/` is the same study and only its changed names are sent. The duplicated frames on the PCS's
  disk are the PCS's to clean (Q-U3).
* **Two instances that disagree on the exam group** (an old instance of the study parsed after the corrected one): the
  rename keeps the last parsed, which may be the old value. The receiver's audit shows it; whether such a change is
  applied or held for review is §17 A7 of the design state, not settled here.

**What it asks of the parser, in full:** one name per marker per directory (write, rename, delete the others), plus
the two fixes already owed. No new file, no message, no knowledge of the sender.

### 13.4 · Withdrawal through the same path

A KOS rejection note reaches the PCS as an instance, so the parser writes it as a series (a document series, no
`.sbnd`), and the sender sends it as any **series package**: no withdrawal logic at the PCS. The **receiver** reads
its concept name: a CID 7010 title makes it a withdrawal of the instances it references (§8's steps), 131360 a
reinstatement. This keeps the domain rule in one place, ours, and needs from the parser only that a KOS is written
(its nested references deterministic, the owed fix). §8's "withdrawal package" remains for the update API.

### 13.5 · Recommendation

**(c)**, with whole changed groups on the PCS's wire and differences everywhere after intake. It is the only option in
which the PCS writes no new kind of file and sends no message, the tree stays the one source of truth, and a crash at
any point is recovered by scanning again. (d) is the fallback if the sender must hold no state. Not decided: the
owner's, after the team meeting.

### 13.6 · Questions for the PCS team

* **Q-U1:** Can the parser keep **one group file per marker** per directory (temporary name, rename, delete the
  others)? Without it a reverted correction is invisible and "current" is ambiguous.
* **Q-U2:** When are nested keys deterministic and every name the hash of the bytes written (design state §15)? Until
  then every option reports false changes. *Corrected 2026-10-28:* answered: fixed upstream at `e105214`.
* **Q-U3:** A corrected study date writes a second tree under another `<D>/`: is `<D>/` needed on your side, and who
  removes the old tree?
* **Q-U4:** What does your Store SCP do with a SOP Instance UID it already holds: overwrite the file and run the parser
  again (assumed here), or keep the first?
* **Q-U5:** Do patient updates and merges (A08, A40) reach any system you run, or only the hospital's archive? If the
  archive does not re-send the objects, the corrections never reach us (for the product owner too).
* **Q-U6:** Does your Store SCP accept Key Object Selection documents, and does the parser write them as a series?
* **Q-U7:** Does any instance arrive with exam attributes that differ from its study's other instances in normal work
  (an old instance after a correction)? It decides how often A7 fires.

**Sources added for this section.** DICOM PS3.4 2026d §B.4 (coercion, "implementation dependent"), §B.2.3 (C-STORE
statuses: no "duplicate" status), Annex F (MPPS), fetched 2026-10-26; IHE RAD TF-1 §4 (PIR), RAD-12 Patient Update and
HL7 v2 ADT A08/A40 (**named, not re-read** for this section); the PCS repository at `a65abe2`: `README.md`,
`DICMele2deck/README.md`, `DICMele2deck/src/capi/ESIPFfiled/capi.c` lines 140–390. Not verified: what PS3.4 says, if
anything, about a duplicate SOP Instance UID at a Storage SCP; the scan's time, estimated.

## 14 · Applying a package item by item

**Status: Proposed, awaiting the owner's confirmation; not decided.** Theory only: nothing built, nothing timed. The
rule is the owner's (2026-10-26, night); points (1)–(5) are a proposed completion of it. The sender's side is
[`pcs-transfer.md`](pcs-transfer.md) §15.13 on `claude/sender-package-build` (#177); the receiver's is
`docs/adr/pacs-receiver.md` §5, commit `5d0ae2c` on `claude/pacs-receiver-impl` (#163).

**The rule.** A package carries only what changed, down to the level that changed. The receiver applies it item by
item, an item being the exam group, the series group or one instance's group (its private group with it):

| the item at the PACS | the receiver |
| --- | --- |
| absent (no study, series or instance) | creates it |
| present, hash differs | replaces it, with an audit line (§6) |
| present, hash equal | does nothing |

New instances' frames are merged into the series' `.sbnd` by rewrite (decided, 10-26). Items not in the package are
untouched.

**The proposed completion.**

1. **Absence means unchanged.** A deletion (a withdrawn instance) is listed explicitly, as a removal.
2. **Idempotent.** Applied item by item, a resend changes nothing and is answered `stored`, so duplicates need no
   counter (§13.3's crash rule, generalised).
3. **Each changed item carries the hash it replaces**, taken from the sender's sent list (§13.3 (c)). Current equal
   to that hash: applied. Current equal to the new hash: a duplicate. Anything else: stale, the whole package refused
   `final` (§5).
4. **One package per series at a time**, in order: the sender waits for `stored` before the next, so a stale package
   cannot arrive later. *(Narrows §13.3's "one per study in flight" to one per series.)*
5. **The revision counter leaves the correctness logic**; it may stay as a label in the name.

**Consequence.** The package needs a small **manifest** beside the header: the removals and the previous hashes. The
owner's 10-25 rule, "no manifest until something needs one", is met: this needs one.

| case | what the package carries |
| --- | --- |
| first send of a series | everything: exam, series and instance groups, the bundle; no previous hashes |
| late images (an addition) | only the new instances' groups and their frames |
| a patient-name fix | only the exam group, with the hash it replaces |
| a series-description fix | only the series group, with the hash it replaces |
| a withdrawn instance | a removal in the manifest, nothing else |

**Open, for the PCS team** (Q-U1 restated): the parser writes a corrected group beside the old file and never deletes
the old one (§13.2), so the sender cannot tell which is current. The parser should replace the file, or mark the
current one.
