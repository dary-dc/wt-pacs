# A second writer: metadata changed at the PACS while the PCS keeps sending

**Status: theory, 2026-10-28. Nothing decided, built or timed.** It answers one question for the owner and the
product owner: if client applications may change metadata at the PACS (through the update API proposed in #148 and
#176) while the PCS keeps sending its own corrections for the same study, what happens, and which conflict policies
exist. Whether client-application updates exist at all, and through which path, is **open** with the team and the
product owner (design state §5); this file does not settle it and recommends nothing beyond §6's deciding questions.

Read with, all unmerged drafts, cited by branch and commit: the design state `docs/ingest/pacs-receive-design.md`
§2, §3, §5, §14 D3/D12/D13 (`claude/pacs-design-state`, #168, `f8b0bb2`); `docs/adr/metadata-updates.md` §5, §6, §8,
§13, §14 (`claude/update-flow`, #176, `3ec22f1`); `docs/adr/pcs-transfer.md` §7, §15 (`claude/sender-package-build`,
#177, `3ea13d3`); `docs/adr/pacs-receiver.md` §4, §5 (`claude/pacs-receiver-impl`, #163, `c66f0d0`). What they settle
is not repeated. Labels: **(S)** a quoted source (§7), **(I)** this file's reasoning, **(U)** not known.

## 1 · On one screen

```text
 hospital side                                   PACS side
 modality / hospital archive / RIS               client application (viewer, QC tool)
        │ C-STORE again (whole object)                   │ HTTPS, If-Match <current hash>
        ▼                                                ▼
 PCS: parser → hash-named groups                  update API: authenticate, stamp author
        │                                                │
 our sender: diff against its SENT LIST                  │
   package: item + "replaces <hash the sender last sent>"│  update package: item + base hash
        └──────────────────────────┐   ┌─────────────────┘
                                   ▼   ▼
                 receiver: one worker per study, arrival order    ◄── the only place both writers meet
                 per item: current == previous → apply │ current == new → duplicate │ else → STALE
                                   │
                 study DB row (bytes + XXH3) + audit row
```

**The conflict in one line (I).** Point 3 of the five points assumes the sender's sent list *is* the PACS's current
state. A PACS edit breaks that assumption: the row's hash is no longer one the PCS ever sent, so every later PCS
package touching that item reads **stale**, whatever it carries.

**What the standards say about authority (S, §2).** Neither the PCS nor the PACS is authoritative for patient
demographics: the system that registers the patient is (HL7 v2 ADT; IHE PAM's Patient Demographics Supplier), and an
image archive is a receiver that must apply its updates (IHE PIR). For an image's own attributes the creator corrects
by **replacing** the object with new UIDs (IHE IOCM), and an archive **may** correct in place (PS3.4 B.4.1.3) and
record it (PS3.3 C.12.1.1.9). Nothing read names which of two holders of a copy wins. Storage Commitment transfers
safekeeping, not authority over values.

| policy | name fixed at the PACS, then a new series of the study arrives | both sides fix the same field differently | instance withdrawn at the PACS, then the PCS sends it again | asks of the PCS team |
| --- | --- | --- | --- | --- |
| **P1** the PCS always wins | the PACS fix is overwritten by the exam group the series carries | the PCS value stands; the PACS edit is lost except in the audit | reinstated, against IOCM's "shall not accept" | nothing |
| **P2** PACS edits win; the PCS's later version refused or kept aside | as written: the series package is **stale**, refused, pixels blocked; with §4's two hashes: stored, fix kept | refused (blocks that series, point 4) or kept aside for a person | refused, as IOCM requires | stop on `final`; an operator's queue |
| **P3** per-attribute ownership | the owner's value stands; the rest of the package applies | the owner's value stands; the other's is dropped, audited | depends on who owns "visible" | agree to the ownership table; nothing on the wire |
| **P4** PACS edits sent back | the sender knows the new hash and omits or rebases | the later arrival wins, knowingly, or a person decides | the PCS learns the withdrawal | a feed into the sender (minimal) or a store path into the hospital (full) |
| **P5** single writer: the PACS never edits | cannot happen | cannot happen | withdrawal made at the hospital, arrives as a KOS series | nothing new; the hospital must re-send corrections |
| **P6** last writer wins by time | the later timestamp wins; the series' exam group carries no new time | the later timestamp wins, if the clocks agree | the later timestamp wins | a trustworthy change time per item, synchronized clocks |

**Three findings that hold under every policy except P5 (I, §4):**

1. **A PACS edit to the exam group makes every later first-send series package of that study stale** under the five
   points as written: a first send carries the exam group with no `replaces` line, and the receiver's table refuses a
   present, differing item. Late series, reports and KOS documents of the study stop at the PACS.
2. **Two equal fixes conflict unless both writers produce the same bytes.** "Current = new is a duplicate" compares
   hashes; the update API must serialize a group exactly as the parser does (key order, charset index, padding), or
   identical corrections read as a conflict.
3. **A stale refusal under the owner's resend rule is a loop.** "Refused" means "resend the same bytes" (decided);
   a stale package fails again, so it lands in quarantine (design state §3, R) and its series' queue waits behind it
   (point 4). The second writer turns quarantine from "a bug" into a routine path, unless D3 adds a final refusal.

## 2 · Who is authoritative for what, from the standards

**DICOM PS3.7 §10.1.3, N-SET** (S): "The N-SET service is used by a DIMSE Service User to request the modification of
Attribute Values from a peer DIMSE Service User." N-SET acts on *normalized* instances the SCP manages (a procedure
step, a commitment), never on a stored image. Where PS3.4 uses it, the **owner of the step** writes and the SCP
guards: "The SCP shall refuse set requests on an IN PROGRESS UPS … if the set request does not include the
Transaction UID (0008,1195) Attribute with the same value as currently recorded" and "shall refuse set requests on a
COMPLETED or CANCELED UPS" (PS3.4 §CC.2.6.3); for MPPS, "Once the Modality Performed Procedure Step Status (0040,0252)
has been set to "COMPLETED" or "DISCONTINUED" the SCU shall no longer modify" it (PS3.4 §F.7.2.2.2). *(I)* DICOM's
own concurrency rule is a token held by one writer and checked by the holder of the state: the base hash is the
same shape. DICOM has no message that edits a stored image's attributes; a change travels as a whole object.

**DICOM PS3.4 §B.4.1.3, coercion** (S): the Storage SCP "may modify the Values of certain Attributes in order to coerce
the SOP Instance into the Query Model of the SCP" (Patient ID, Issuer, Other Patient IDs, Study and Series Instance
UID, Table B.4-1), and "Other Attributes may be modified/corrected by an SCP of a Storage SOP Class"; changing UIDs
"is strongly discouraged". *(I)* An archive correcting values in place is conformant; the standard does not say the
correction outranks the sender's next copy.

**DICOM PS3.4 Annex J, Storage Commitment** (S): the SCP commits "for the safekeeping of the SOP Instances (i.e., that
the SOP Instances will be kept for an implementation specific period of time and can be retrieved)" (§J.1.1); "Once
the SCP has committed to store the SOP Instances, the SCU may decide that it is appropriate to delete its copies"
(§J.1.1); "The SCU shall specify the behavior and actions performed when a success status is received" (§J.3.6).
*(I)* Commitment is about custody of an instance by its UID, not about whose attribute values are right. Our
`stored` (design state §3, step 11) inherits that: it promises the package is kept, not that it stays unedited.

**DICOM PS3.3 §C.12.1.1.9, Original Attributes** (S): "When performing coercion, correction or conversion, the
application may set Instance Coercion DateTime (0008,0015) … may add an Item to the Original Attributes Sequence
(0400,0561) describing the change and the prior values of replaced or removed Attributes. Any existing Items … shall
be preserved." Its Note: attributes "may also be coerced, corrected or converted outside the context of transfer
(e.g., while being managed in a storage system). For example, see the IHE Patient Information Reconciliation". Each
item holds Source of Previous Values, Attribute Modification DateTime, Modifying System, Reason (`COERCE`, `CORRECT`,
`CONVERT`) and the Modified Attributes Sequence "with their prior values" (Table C.12.1.1.9-1, §C.12.1.1.9.1).
Instance Creation Date/Time "does not change during subsequent coercion" (Table C.12-1). *(I)* The vocabulary
assumes **any** holder may change values and keeps the chain of prior values; it never ranks holders.

**IHE RAD PIR and RAD-12** (S): PIR "allows the Image Manager and Report Manager to receive patient update messages to
maintain consistency of the patient information" (RAD TF-1 §4). The update "shall be generated by the system that
performs the update whenever an error is resolved or a change occurs in patient demographics" (RAD TF-2 §4.12.4.3.1);
"An A08 message is the only method that may be used to update patient demographic and visit information. However
Patient ID cannot be updated with an A08 message. An A40 message shall be used" (§4.12.4.3.2); "It is the
responsibility of the Image Manager … to ensure that the patient information has been updated in the … images … they
manage when they are retrieved" (§4.12.4.3.3, §4.12.4.4.3). *(I)* In IHE the image archive is a **consumer** of
demographics; a correction made at the archive is outside PIR, and PIR's next update overrides it.

**IHE ITI PAM, ITI-30** (S): roles: the Patient Demographics Supplier "Adds and modifies patient demographics"; the
Consumer "Receives patient demographics" (ITI TF-2 §3.30.2). On an update, "The receiver shall update the patient
record in its database" (§3.30.6.3.4); on a merge, "The receiver shall merge the two patients in its database"
(§3.30.6.4.4). HL7 v2.5 §3.3.8: A08 "is used when any patient information has changed but when no other trigger event
has occurred … a change of address or a name change"; §3.3.40: after an A40 merge "The incorrect source identifier
would then logically never be referenced in future transactions." *(I)* HL7 v2 and PAM are one-way: one supplier, many
consumers. A consumer's local edit has no message back.

**IHE RAD IOCM** (S): it "specifies how one actor communicates local changes applied on existing imaging objects to
other actors that manage copies of the modified imaging objects" (RAD TF-1 §28). "Instances may be corrected (deleted
and replaced) for patient safety reasons. The Change Requester may be grouped with an Acquisition Modality, an
Evidence Creator, or an Image Manager/Archive" (§28.4.3), and "IOCM shall not be used as an alternative mechanism for
handling patient information reconciliation" (Table 28.3-1). For patient safety and worklist errors, the receiver
"shall hide the referenced instances" and "shall not accept subsequent occurrence of instances that have been hidden"
(RAD TF-2 §4.66.4.2.3, §4.66.4.2.3.1, §4.66.4.3.3); for quality, expose or hide is "configurable" (§4.66.4.1.3).
*(I)* A withdrawal **at the PACS** is standard (the archive as Change Requester), its effect is final for the same
UIDs, and IOCM's purpose is to tell the **other** holders of copies: the standard's answer to a second writer is to
propagate, as new objects, not to edit copies in two places.

**So, who owns what (I):**

| data | authoritative in the standards | reaches our wire through | the PACS's standing to edit |
| --- | --- | --- | --- |
| patient demographics, Patient ID | the ADT / Patient Demographics Supplier | only a re-sent object, if the hospital archive re-sends (#176 §13.1, Q-U5) | a consumer; a local `CORRECT` is conformant but outranked by the next ADT update |
| study and series descriptive values | the creator (modality, RIS via the worklist) | a re-sent object | conformant (B.4.1.3), recorded (C.12.1.1.9) |
| pixel-describing and technical values | the creator; a change means new UIDs (IOCM, B.4.1.3) | a new object | none in practice (#148 refuses them) |
| an instance's existence (withdrawal) | any Change Requester, the archive included | a KOS series (#176 §13.4) | full, and final for the same UIDs |

## 3 · The cases, made concrete

Exam group `E0` stored from the PCS; the sender's sent list holds `E0`. **(I)** throughout.

* **C1, a name fixed at the PACS, then the PCS resends.** The API writes `E1`. (a) The modality re-sends the
  instance **unchanged**: the parser writes no new name, the sender's diff finds nothing, **no package is sent**
  (#176 §13.3 (c)); no policy is reached. (b) **A new series** of the study is sent: its first package carries `E0`
  with no `replaces` line (metadata-updates §14 table). (c) A re-sent instance whose exam group differs in any byte
  (another archive's coercion): an update `E0 → E0′` with `replaces E0`.
* **C2, both sides fix the same field.** The PACS writes `E1` ("SMITH^JON"), the hospital corrects to `E2`
  ("SMITH^JOHN"): the PCS sends `E2` with `replaces E0`. If both wrote "SMITH^JOHN", `E1 = E2` only if the bytes are
  equal (finding 2).
* **C3, an instance withdrawn at the PACS, then sent again.** (a) Re-sent unchanged: no package, as C1 (a). (b) The
  hospital corrects that instance: `I0 → I1`, `replaces I0`, against a hidden row. (c) The sender's records of the
  series are lost (its outbox wiped): its next call finds no earlier revision and builds a first send again, the
  instance included (pcs-transfer §15.2 at `3ea13d3`).

## 4 · The policies

Common to all: the receiver serializes per study, so **arrival order is free and exact** at the PACS (I); what
differs is what the receiver does when an item's current hash is not the one the package names.

**A mechanism several policies share, two hashes per row (I).** The row keeps `current` and `from_pcs`, the hash the
PCS last sent for it. The PCS's previous-hash check is made against `from_pcs`, not `current`; the API's `If-Match`
against `current`. Then an item the PCS sends **unchanged** (`new = from_pcs`) is a duplicate even after a PACS edit
(C1 (b) stored, the fix kept), and a real PCS change is told apart from a resend. It costs one column per level table
and the audit's two hashes; it changes points 2–3's wording, not their shape.

### P1 · The PCS always wins

The receiver applies every PCS item whose previous hash is `from_pcs` (or skips the check for the PCS), over any PACS
edit. C1 (b): the fix is overwritten by `E0`, unless `from_pcs` makes it a duplicate (then only a real PCS change
overwrites it). C2: `E2` stands. C3: (b) and (c) bring the instance back; contrary to RAD TF-2 §4.66.4.2.3.1, unless
withdrawals are kept out of P1. **Audit:** each overwrite of a PACS edit, with the PACS's prior **values** (decided:
no history, so the audit is the only place a person's correction survives) and its author. **Previous hash:** kept
only against `from_pcs`. **Fits** PIR's model (the archive a consumer), if the PCS's values come from the hospital's
current records, which C1 (c) shows they may not.

### P2 · PACS edits win; the PCS's later version refused or kept aside

The five points as written. C1 (b): **stale**; the series package, pixels included, is refused (finding 1); with
`from_pcs` it is stored and the fix kept. C2: `E2` is stale: (i) **refused** `final`: the sender stops that series
(point 4), an operator decides; under today's resend rule it loops into quarantine (finding 3); (ii) **kept aside**:
the receiver stores `E2` in a pending table, answers `stored`, a person accepts or drops it; the queue never blocks,
but `stored` then means "kept", not "applied". C3: refused, as IOCM requires. **Audit:** refused and kept-aside
packages too (#163 writes no row for a refusal today, pacs-receiver §4 at `c66f0d0`), the value set aside, and who
resolved it. **Asks of the PCS:** stop on `final` and show it (#164's `refused final`, D3); nothing more.

### P3 · Per-attribute ownership

A table says which side owns each attribute: e.g. patient demographics to one side, technical and descriptive values
to the PCS. The receiver turns the PCS's whole groups into differences (#176 §13.1 already proposes it), applies only
the keys the PCS owns, and refuses API edits to keys it does not own. C1 (b): if the PACS owns the name, `E0`'s name
is ignored and the rest applies; C2: the owner's value stands, the other's is dropped with an audit line; C3: if the
PACS owns visibility, a resend updates content and stays hidden. **Previous hash:** per owned projection of a group,
not per group, since the group's hash now mixes two owners' values; the duplicate test needs the same projection.
**Cost:** attribute addressing by DECK key, whose nested keys are not yet defined (#176 Q4, design state §15).
**Standards:** B.4.1.3 already names Patient ID and Issuer as the archive's to coerce, which is a precedent for an
ownership line at identifiers (I). **Asks of the PCS:** agreement on the table; nothing on the wire.

### P4 · PACS edits sent back (two-way)

**Minimal, ours only:** the sender's sent list learns the PACS's current hash per item (from the status it already
polls, D13, or a read of the study's hashes), so its next package names the right previous hash, and omits an
unchanged exam group. C1 (b): stored; C2: if the sender learnt `E1` first, `E2` replaces it knowingly (the PCS wins,
in arrival order); in a race, stale, then rebased and resent. C3: the sender learns the withdrawal and stops sending
that instance. **Full:** the PACS sends its edits into the hospital (a KOS and replacement instances for IOCM, an ADT
message for demographics), so the hospital's copy converges too. It needs a path into the hospital, which
pcs-transfer §7 rules out for reachability, and hospital systems that accept it; demographics would make the PACS a
Patient Demographics Supplier, which PAM does not foresee for an archive (U). **Asks of the PCS team:** none
(minimal); a store path back and acceptance of PACS-made objects (full).

### P5 · A single writer: every correction through the PCS

The update API does not exist, or it forwards to the hospital (its RIS or QC) rather than to the receiver. C1, C2
cannot happen; C3's withdrawal is made at the hospital and arrives as a KOS series (#176 §13.4). The five points work
as designed: the sent list is the PACS's state. **Audit:** the sender is the PCS site; the person is known only if the
hospital system wrote an Original Attributes item (0400,0561) and the parser keeps it (U). **Limits:** a correction
seen at the PACS waits on the hospital's workflow; a PIR feed (A08, A40) at the PACS would itself be a second writer,
so a site with one must route it to the PCS instead (U whether any site has one, Q-U5).

### P6 · Last writer wins by time

Each change carries the time it was made; the receiver keeps the later. **Why clocks make it hard (I):** the PCS's
change time is when the parser ran on a re-sent object, not when a person corrected it; Instance Creation Date/Time
"does not change during subsequent coercion" (PS3.3 Table C.12-1) and Instance Coercion DateTime and Attribute
Modification DateTime are "may" (§C.12.1.1.9), so the object rarely dates its own correction; a package resent after
a three-day outage carries a time older than a PACS edit made meanwhile, and wins or loses by that; the hospital's and
the PACS's clocks are different machines, and physical clocks give only a partial order of events across them
(Lamport 1978: happening-before "is shown to define a partial ordering of the events"). Ties and skew silently drop one
edit, the "lost update" metadata-updates §5 rejects. *Last by arrival* at the receiver needs no clock and is P1 or P4.
**Asks of the PCS:** a change time per item in the manifest and synchronized clocks, neither of which we can verify.

## 5 · What every policy owes the audit and the five points

**The audit row (I),** beyond the decided who, when, what: the **origin** (the PCS site or the API, and the person
on whose behalf); the **outcome** per item (applied, duplicate, stale-refused, kept aside, overridden); **both
hashes** (previous and new, and `from_pcs` where §4's mechanism is used); and, under P1, P3 and P6, the **prior
values** of what was overwritten, in Original Attributes terms (Reason `CORRECT` for a person, `COERCE` for a
reconciliation, Modifying System, Source of Previous Values). This conflicts with the receiver as built, which keeps
hashes, not bytes, and no row for a refusal (pacs-receiver §4 at `c66f0d0`); metadata-updates §6 at `3ec22f1`
proposes prior values and refused rows. With a second writer the owner's "no history kept" leaves the audit as the
only record of an overwritten correction.

| five-point | holds with a second writer? (I) |
| --- | --- |
| 1 absence = unchanged | yes, and it is the fix for finding 1 if the sender omits an unchanged exam group (needs the receiver to accept a first-send series package without one when the study exists) |
| 2 idempotent apply | only if both writers' group bytes are canonical (finding 2) |
| 3 previous hash | becomes the policy itself: against `current` it is P2-strict; against `from_pcs` it is P1 or P2 by what is done on a mismatch |
| 4 one package per series in flight | turns a stale refusal into head-of-line blocking for that series (finding 3) |
| 5 revision a label | unaffected |

## 6 · Deciding questions, for the product owner

1. **Do client-application edits exist at all?** No: P5, and the five points stand as they are.
2. **If yes, when both sides change the same item, whose value stands, and may either be overwritten without a person
   seeing it?** Silent and the PCS's: P1. Silent and the PACS's, with the PCS's next real change applied: P1 with
   `from_pcs`. A person decides: P2 (refused or kept aside). Per attribute: P3.
3. **Must a correction made at the PACS reach the hospital's copy?** Yes: P4 full, and the hospital's systems decide
   it. Only our sender needs to know: P4 minimal.

Two facts would narrow them, both **(U)**: whether any site feeds patient updates (A08, A40) to the PACS or the PCS
(#176 Q-U5), and how often the hospital re-sends a corrected object at all (Q-U4, Q-U7). Neither is measured.

## 7 · Sources

Fetched 2026-10-28; nothing fetched is committed. DICOM 2026d from `dicom.nema.org/medical/dicom/current/output/chtml/`;
IHE RAD TF Rev 23.0 (2025-08-08) Vol 1 and 2 from `ihe.net/uploadedFiles/Documents/Radiology/`; IHE ITI TF Rev 20.0
(2023-08-04) from `profiles.ihe.net/ITI/TF/`; HL7 v2.5 chapter 3 from HL7 Europe's copy at `hl7.eu/HL7v2x/v25/std25/`
(not HL7 International's licensed text); Lamport, "Time, Clocks, and the Ordering of Events in a Distributed System",
CACM 21(7), 1978, from `lamport.azurewebsites.net`.

| claim | source |
| --- | --- |
| N-SET's meaning | PS3.7 §10.1.3 |
| UPS: the Transaction UID; no sets once completed | PS3.4 §CC.2.6.3 |
| MPPS: no modification once completed | PS3.4 §F.7.2.2.2 |
| an SCP may coerce and correct; UIDs discouraged | PS3.4 §B.4.1.3, Table B.4-1 |
| commitment means safekeeping; the SCU may delete | PS3.4 §J.1.1, §J.3.6 |
| Original Attributes, its fields and reasons | PS3.3 §C.12.1.1.9, §C.12.1.1.9.1, Table C.12.1.1.9-1 |
| creation date/time unchanged by coercion | PS3.3 Table C.12-1 |
| PIR: the Image Manager receives updates | IHE RAD TF-1 §4 |
| A08 the only update, A40 for IDs; the Image Manager's responsibility | IHE RAD TF-2 §4.12.4.3.1–3, §4.12.4.4.3 |
| PAM roles; the receiver updates, merges | IHE ITI TF-2 §3.30.2, §3.30.6.3.4, §3.30.6.4.4 |
| A08, A40 trigger events | HL7 v2.5 §3.3.8, §3.3.40 |
| IOCM scope; the archive as Change Requester; not for PIR | IHE RAD TF-1 §28, §28.4.3, Table 28.3-1 |
| hide; refuse subsequent occurrence | IHE RAD TF-2 §4.66.4.1.3, §4.66.4.2.3, §4.66.4.2.3.1, §4.66.4.3.3 |
| happening-before is a partial order | Lamport 1978, abstract |

**Not verified (U):** CP-RAD-556 (#176 §12), which may change RAD-66's wording; whether IHE has a profile in which an
archive supplies demographics back to ADT; HL7 v2's own text on receiver-side edits (none found in chapter 3); whether
the parser keeps an incoming Original Attributes Sequence in its groups.
