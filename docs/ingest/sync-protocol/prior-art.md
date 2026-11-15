# Keeping the PACS in step with the PCS: prior art

**Status: theory and sources, 2026-10-28.** Nothing built, nothing measured. It answers one question: how established
systems keep a receiver's copy of a tree of content-addressed or versioned items in step with a source, one way, with
acknowledgements, and which of their mechanisms answer which event of ours. It recommends no protocol (another row
compares protocol shapes); §4 names the mechanisms that fit, labelled as reasoning.

**Taken as given, not reopened.** The owner's decisions and the proposals awaiting the owner are those of the design
state (`docs/ingest/pacs-receive-design.md` §2, §3, §5, §14 D3/D12/D13, on `claude/pacs-design-state`, #168, commit
`f8b0bb2`), the item-by-item model (`docs/adr/metadata-updates.md` §13–14 on `claude/update-flow`, #176, `3ec22f1`),
the sender as built (`docs/adr/pcs-transfer.md` §15 on `claude/sender-package-build`, #177, `3ea13d3`) and the receiver
as built (`docs/adr/pacs-receiver.md` on `claude/pacs-receiver-impl`, #163, `c66f0d0`). "The five points" are the
design state's §5 proposal: (1) absence means unchanged, deletions listed; (2) idempotent apply, a resend answered
`stored`; (3) each changed item carries the hash it replaces; (4) one package per series in flight; (5) the revision
out of the correctness logic.

**Terms.** An *item* is the exam group, the series group, or one instance's groups, as the item-by-item model defines
it. The *sent list* is the sender's record of the item hashes last confirmed `stored` (metadata-updates §13.3 (c)).

## 1 · On one screen

```text
            the PCS                              the link                         the PACS
 ┌──────────────────────────┐                                         ┌──────────────────────────────┐
 │ tree of hash-named files │  (E11: old file beside new = objects    │ study DB: item → bytes, XXH3 │
 │ no "current" pointer     │   without a ref, git's distinction)     │ .sbnd per series; audit      │
 └────────────┬─────────────┘                                         └──────────────▲───────────────┘
        scan  │                                                                      │ apply per item:
 ┌────────────▼─────────────┐   package: items + replaces/removes     ┌──────────────┴───────────────┐
 │ sender + sent list       │ ──────────────────────────────────────▶ │ receiver: compare-and-swap   │
 │ (CouchDB checkpoint:     │   [A] git push old→new, If-Match        │ per item, all or nothing     │
 │  moves only after commit)│ ◀────────────────────────────────────── │ (E3 E5 E6 E12)               │
 │                          │   stored | refused (+ current hash) [B] │                              │
 │ store identity it saw [D]│ ◀────────────────────────────────────── │ store identity, changes on   │
 │                          │   digest study → series → item     [C]  │ restore (BEP index ID) (E10) │
 └──────────────────────────┘   (Merkle anti-entropy: E8 E10 E13)     └──────────────────────────────┘
   deletions: explicit, kept until no copy can lag [E] (BEP deleted, OAI-PMH persistent, IOCM KOS; E4)
```

**The three findings.**

1. **The five points are git's ref update and HTTP's `If-Match`, almost line for line, and both standards also cover
   the duplicate.** A git push sends `old-id new-id name` per ref, `zero-id` as old for a create and as new for a
   delete, and the server checks "the obj-id is still the same as the old-id" before updating; RFC 9110 §13.1.1 lets a
   server answer **2xx** when a conditional change "appears to have already been applied … perhaps because the prior
   response was lost". Points 1–3 are prior art, not invention (§3.2, §3.10).
2. **They do not cover a side that forgets: the sent list lost (E8) or the PACS restored from a backup (E10).** Under
   point 3 a restored PACS answers every later correction "stale, refused final", and a series stored after the backup
   and never touched again is lost silently. Every surveyed system that survives this has something the five points
   lack: an **identity of the store** that changes when its history is reset (Syncthing's index ID, CouchDB's session
   id in a log kept on *both* sides), plus **a read of the receiver's current state** to restart from (git's ref
   advertisement, CouchDB's `_revs_diff`, Dynamo's Merkle roots) (§3.8, §3.14, §4).
3. **"Stale" has three causes the reply cannot yet tell apart**: a second writer at the PACS (E12), the PACS behind
   (E10), or the sender wrong (E8, E11). git answers a failed update `ng` but has already advertised the current value;
   a refusal that names the receiver's current hash per item lets the sender decide: a hash it sent earlier means the
   PACS is behind, a hash it never sent means someone else wrote (§4, reasoning).

**Go deeper:** the table (§2), each mechanism with its defining text (§3), the shortlist (§4), what is not known and
one pre-registered measurement (§5), sources (§6).

## 2 · Mechanisms against events

Events: **E1** first send of a series · **E2** late instance · **E3** metadata correction (exam, series, instance) ·
**E4** withdrawal or deletion (IOCM) · **E5** duplicate after a lost reply · **E6** two changes to one series close
together · **E7** sender crash · **E8** sent list lost (PCS reinstall) · **E9** receiver crash at any step · **E10**
PACS restored from a backup · **E11** parser leaves the old group file beside the corrected one · **E12** a second
writer at the PACS · **E13** detecting and repairing drift.

Round trips at 700 ms (satellite) are arithmetic, not measured.

| mechanism | events it handles | state at the source | state at the receiver | round trips | what it costs |
| --- | --- | --- | --- | --- | --- |
| git fetch negotiation (v2) | E8, E13: which objects one side lacks | refs, objects | refs, objects | 1 `ls-refs` + ≥ 1 `fetch` rounds of `have` lines | `have` lists grow with history; the server walks reachability |
| git push, ref update as compare-and-swap (`atomic`) | E1 (create from `zero-id`), E3, E4 (update to `zero-id`), E6, E12; E5 by the next advertisement showing the ref already moved | the expected old id per ref | refs, objects; no per-push record | 2: ref advertisement, then commands + pack + report | the advertisement lists every ref; per-ref `ok`/`ng` |
| `--force-with-lease=<ref>:<expect>` | E12, E6: refuse if anyone else moved the ref | the explicit expected value | refs | as push | nothing beyond push; the implicit forms are "still experimental" |
| rsync (quick check + rolling-checksum delta) | E1–E3 by comparing content each run; E8, E10, E13 because it keeps no state | none | none | 1 per file, pipelined, after the file list | a full listing every run; **no commitment reply** (design state §2) |
| rsync `--delete` | E4 by absence | none | none | within the run | absence = delete: wrong for "absence means unchanged"; disabled on a sender I/O error |
| Syncthing BEP `Index` / `IndexUpdate`, `deleted`, version vector | E1–E4, E6 (only the latest state travels), E12 (receive-only: local changes flagged, revertable) | its index: name, version vector, block hashes, sequence, deleted flag | the peer's index | the index at connect, then per-block request/response | per-file metadata kept forever, tombstones included |
| BEP delta index: `{index ID, max sequence}` | E7, E8, E10: a reset index gets a new random ID, so the peer resends all | a sequence counter and a 64-bit index ID | the peer's ID and max sequence | 0 extra (in `Cluster Config`) | the index must be sent in sequence order |
| Dynamo Merkle anti-entropy | E10, E13 (and E8 if the sender rebuilds from it) | a hash tree per key range | the same | one per tree level until the differing leaves | hash trees kept or rebuilt; "recalculated" when ranges change |
| Cassandra repair (full, incremental) and tombstone grace | E13, E10; E4 without "zombies" | Merkle trees built at repair; tombstones kept `gc_grace_seconds` | the same | per level, then streaming | full repair reads all data; incremental is blind to "disk corruption, data loss by operator error, or bugs" |
| HTTP `If-Match` / `If-None-Match: *` / `412` / 2xx when already applied | E1 (create only if absent), E3, E5, E6, E12 | the entity tag last seen | the current tag per resource | 0 extra: the precondition rides the request | a strong compare; the server computes the current tag |
| `Idempotency-Key` (IETF draft-08) | E5, E7 (a retry with the same key); a retry while the first runs → `409` | a key per request, reused on retry | key (+ fingerprint) → outcome, until expiry | 0 extra | the receiver stores keys and publishes their expiry; `422` on a key reused with another payload |
| DICOM Storage Commitment (PS3.4 Annex J) | E9 (commitment only after safekeeping), E5 (the Transaction UID matches request and result "over the same or different Associations") | the instances until committed; the Transaction UID | the commitment, per instance | N-ACTION, then an N-EVENT-REPORT, possibly later | the SCU's delete and retry policy is left to its Conformance Statement |
| IHE IOCM (Rejection Note Stored, RAD-66) | E4; a wrong-patient fix as rejection + new UIDs | the rejection note (a KOS instance) | the note, the rejected instances hidden or deleted | as any store | the tombstone is itself a stored object, so it survives as long as the study |
| CouchDB replication | E7 (checkpoint after `_ensure_full_commit`), E8, E10 (logs on both sides compared; no common ancestry → full replication), E4 (`deleted` in the changes feed), E13 (`_revs_diff`) | a replication log | a replication log, revision trees | ~6 per batch (two log reads, changes, `_revs_diff`, `_bulk_docs`, commit, two checkpoint writes) | revision trees and tombstones kept; ≈ 4 s a batch at 700 ms |
| OAI-PMH incremental harvesting | E1–E3 by datestamp; E4 only if the repository keeps deletions `persistent`; E13 only by a full harvest | the last datestamp harvested | datestamps; deleted records (`no` / `transient` / `persistent`) | 1, plus a resumption page each | without persistent deletions, deletions "simply vanish" |

## 3 · Each mechanism and its defining text

Every quote was fetched 2026-10-28 from the location given in §6. Two lines of mechanism, then the text relied on.

### 3.1 git fetch negotiation (protocol v2)

The client lists refs (`ls-refs`), then sends `want` for tips it lacks and `have` for objects it holds; the server
acknowledges common objects and sends a pack of only the difference. v2 is stateless per request.

> "Protocol version 2 is stateless by default. This means that all commands must only last a single round and be
> stateless from the perspective of the server side […] Clients MUST NOT require state management on the server side
> in order to function correctly." — gitprotocol-v2, §Capabilities
>
> "`have <oid>` Indicates to the server an object which the client has locally. This allows the server to make a
> packfile which only contains the objects that the client needs." — gitprotocol-v2, §fetch

### 3.2 git push: the ref update as compare-and-swap

After the server advertises every ref and its current object id, the client sends `old-id new-id name` per ref and
a pack; the server checks each old id before moving the ref and reports `ok` or `ng` per ref; `atomic` makes it all
or none.

> "`create = zero-id SP new-id SP name` · `delete = old-id SP zero-id SP name` · `update = old-id SP new-id SP name`"
> […] "The server will receive the packfile, unpack it, then validate each reference that is being updated that it
> hasn't changed while the request was being processed (the obj-id is still the same as the old-id), and it will run
> any update hooks to make sure that the update is acceptable. If all of that is fine, the server will then update the
> references." — gitprotocol-pack, §Reference Update Request and Packfile Transfer
>
> "If the pushing client requests this capability, the server will update the refs in one atomic transaction. Either
> all refs are updated or none." — gitprotocol-capabilities, §atomic

Git keeps two things apart that the PCS tree merges: **objects**, named by hash and never overwritten, and **refs**,
names whose value says which object is current. The parser's tree has the objects and no refs, which is E11
(metadata-updates §13.2): the requested "one file per marker" turns the directory entry into the ref (reasoning).

### 3.3 `git push --force-with-lease`

A forced update that is applied only if the remote ref still has the value the client expects; the explicit form
names that value, the implicit forms take it from the remote-tracking ref.

> "This option overrides this restriction if the current value of the remote ref is the expected value. `git push`
> fails otherwise. […] It is like taking a "lease" on the ref without explicitly locking it, and the remote ref is
> updated only if the "lease" is still valid. […] If `<expect>` is the empty string, then the named ref must not
> already exist." — git-push(1), `--force-with-lease`
>
> "Note that all forms other than `--force-with-lease=<refname>:<expect>` that specifies the expected current value of
> the ref explicitly are still experimental" — ibid.

The explicit form is point 3 with the sent list as `<expect>`; git's own warning about the implicit form (an expected
value taken from a copy that may have moved) is the warning for E8: an expected value must come from a record of what
was confirmed, never from a guess (reasoning).

### 3.4 rsync: the algorithm and the quick check

Per file, the receiver sends block checksums of its copy, the sender finds matching blocks at any offset and sends
only literal data for the rest, in one round trip; which files to consider is decided by size and mtime, or by full
checksums with `-c`.

> "The end result is that β gets a copy of A, but only the pieces of A that are not found in B (plus a small amount of
> data for checksums and block indexes) are sent over the link. The algorithm also only requires one round trip,
> which minimises the impact of the link latency." — Tridgell and Mackerras, *The rsync algorithm*, §The rsync
> algorithm
>
> "Rsync finds files that need to be transferred using a "quick check" algorithm (by default) that looks for files
> that have changed in size or in last-modified time." — rsync(1), DESCRIPTION

Stateless on both sides, so it recovers from every forgetting (E8, E10) by comparing again; it has no commitment
reply, which the owner ruled insufficient (design state §2). Its delta does not help us: an item is replaced whole,
and a late instance's frames are new bytes (reasoning).

### 3.5 rsync `--delete`

Deletion by absence: whatever the receiver holds in a synchronised directory that the sender's listing lacks is
removed, unless the sender saw an I/O error.

> "This tells rsync to delete extraneous files from the receiving side (those that don't exist on the sending side),
> but only for the directories that are being synchronized. […] If the sending side detects any I/O errors, then the
> deletion of any files at the destination will be automatically disabled. This is to prevent temporary filesystem
> failures (such as NFS errors) on the sending side from causing a massive deletion of files on the destination." —
> rsync(1), `--delete`

The guard is the case for point 1: when absence can mean "not read", absence must not mean "deleted" (reasoning).

### 3.6 Syncthing BEP: `Index`, `IndexUpdate`, the deleted flag, version vectors

Each device announces the full list of its files (`Index`) and then amendments (`IndexUpdate`); a deleted file stays
in the index with `deleted` set and no blocks; a version vector per file orders concurrent changes.

> "An Index message represents the full contents of the folder and thus supersedes any previous index. An Index Update
> amends an existing index with new information, not affecting any entries not included in the message." — BEP v1,
> §Index and Index Update
>
> "The **deleted** field is set when the file has been deleted. The block list SHALL be of length zero […] The
> **version** field is a version vector describing the updates performed to a file by all members in the cluster.
> […] The combination of Folder, Name and Version uniquely identifies the contents of a file at a given point in
> time." — BEP v1, §Fields (FileInfo Message)
>
> "Local changes are however not distributed to other devices. […] When local changes have been detected Syncthing
> will show a red "Revert Local Changes" button on the folder." — Syncthing docs, *Folder Types*, §Receive Only Folder

`IndexUpdate` "not affecting any entries not included" is point 1's "absence means unchanged". The receive-only folder
is one answer to E12: the receiver keeps a local edit, marks itself out of step, and offers a revert to the source's
state. One-way flow needs no version vector: one writer per item gives a total order (reasoning).

### 3.7 BEP delta index: `{index ID, max sequence}`

Every index change takes the next value of a local counter; the pair (random index ID, highest sequence) names a point
in an index's history; a reset index takes a new ID, so the peer that remembers the old pair resends everything.

> "Given the above, we know that the tuple {index ID, maximum sequence number} uniquely identifies a point in time of a
> given index. […] Should the index be reset or removed (i.e., the sequence number reset to zero), a new index ID must
> be generated." — BEP v1, §Delta Index Exchange
>
> "For this mechanism to be reliable it is essential that outgoing index information is ordered by increasing
> sequence number." — ibid.

This is the mechanism for E8 and E10: a counter alone cannot tell "nothing new" from "I forgot"; a counter under an
identity that changes on reset can. The counter is a resume cursor, not a correctness check, which fits point 5
(reasoning).

### 3.8 Merkle-tree anti-entropy (Dynamo)

Each replica keeps a hash tree over a key range; two replicas compare roots and descend only into differing branches
until they find the out-of-sync keys.

> "A Merkle tree is a hash tree where leaves are hashes of the values of individual keys. Parent nodes higher in the
> tree are hashes of their respective children. The principal advantage of Merkle tree is that each branch of the tree
> can be checked independently without requiring nodes to download the entire tree or the entire data set. […] if the
> hash values of the root of two trees are equal, then the values of the leaf nodes in the tree are equal and the
> nodes require no synchronization." — DeCandia et al., *Dynamo*, SOSP 2007, §4.7 Handling permanent failures:
> Replica synchronization

Our data is a tree already: study → series → item, each item with its XXH3. A digest per series and per study over
the sorted item hashes is the Merkle tree at three levels: equal roots cost one round trip, a difference costs three
(2.1 s at 700 ms, arithmetic) (reasoning).

### 3.9 Cassandra repair and tombstones

Repair builds Merkle trees per token range and streams the differences; incremental repair skips data already marked
repaired; a deletion is a tombstone kept for a grace period so a replica that missed it cannot bring the data back.

> "Incremental repairs only repair data that's been written since the previous incremental repair. […] This is fine
> for syncing up missed writes, but it doesn't protect against things like disk corruption, data loss by operator
> error, or bugs in Cassandra. For this reason, full repairs should still be run occasionally." — Cassandra docs,
> *Repair*, §Incremental and Full Repairs
>
> "If the rest of the cluster purges the tombstoned data before the offline node comes back online, Cassandra may
> mistakenly treat the data on the recovered node as live and repair may replicate it across the cluster again. This
> scenario, where deleted data reappears, is known as a zombie." — Cassandra docs, *Tombstones*, §Preventing Data
> Resurrection

The zombie is E4 meeting E10: a backup taken before a withdrawal holds the withdrawn instance; restored, it serves it
again unless the withdrawal is replayed. With IOCM the withdrawal is a stored KOS, so the replay exists if the KOS's
series is re-sent (reasoning; whether the PCS still holds it is §5).

### 3.10 HTTP conditional requests (RFC 9110)

The client sends the entity tag it last saw; the server applies the change only if the current tag matches
(`If-Match`), or only if nothing exists (`If-None-Match: *`), else `412`; a change that appears already applied may
be answered 2xx.

> "An origin server that evaluates an If-Match condition MUST NOT perform the requested method if the condition
> evaluates to false. Instead, the origin server MAY indicate that the conditional request failed by responding with a
> 412 (Precondition Failed) status code. Alternatively, if the request is a state-changing operation that appears to
> have already been applied to the selected representation, the origin server MAY respond with a 2xx (Successful)
> status code (i.e., the change requested by the user agent has already succeeded, but the user agent might not be
> aware of it, perhaps because the prior response was lost or an equivalent change was made by some other user
> agent)." — RFC 9110, §13.1.1 If-Match
>
> "If-None-Match can also be used with a value of "*" to prevent an unsafe request method (e.g., PUT) from
> inadvertently modifying an existing representation of the target resource when the client believes that the
> resource does not have a current representation" — RFC 9110, §13.1.2 If-None-Match

The second half of the first quote is point 3's "current = new is a duplicate, answered `stored`", in the standard's
words. The update API proposed for client applications already uses `If-Match`/`412`/`428` (metadata-updates §5).

### 3.11 The `Idempotency-Key` header (IETF draft)

The client names each non-idempotent request with a unique key and reuses it on retry; the server remembers key and
outcome until an expiry it publishes, replays the outcome to a retry, and refuses a reused key with another payload.

> "Retry: The request was retried after the original request completed. The resource SHOULD respond with a response
> consistent with the request being completed according to the user's intent. Concurrent Request: The request was
> retried before the original request completed. The resource SHOULD respond with a resource conflict error." —
> draft-ietf-httpapi-idempotency-key-header-08, §2.6
>
> "If there is an attempt to reuse an idempotency key with a different request payload, the resource SHOULD reply with
> an HTTP 422 status code" — ibid., §2.7

Point 2 makes a key unnecessary for correctness (the apply is idempotent by content); the package's XXH3 name is
already a natural key and fingerprint in one. The draft's "concurrent" case is real for us: a resend can arrive while
the first copy is between steps 6 and 11 (reasoning).

### 3.12 DICOM Storage Commitment (PS3.4 Annex J)

After sending instances by any means, the SCU asks the SCP to commit to their safekeeping, naming them and a
Transaction UID; the SCP later reports, per instance, which it committed and which failed.

> "Once the SCP has committed to store the SOP Instances, the SCU may decide that it is appropriate to delete its
> copies of the SOP Instances. These types of behaviors are outside the scope of this Standard, however, the SCU is
> required to document these behaviors in its Conformance Statement." — PS3.4 2026d, §J.1.1 Scope
>
> "Use of the Transaction UID Attribute allows the SCU to match requests and results that may occur over the same or
> different Associations." — PS3.4 2026d, §J.3.2
>
> "In the case where the SCP indicates that it cannot achieve Storage Commitment for some SOP Instances, the SCU
> might, for example, re-send the failed SOP Instances to the SCP (via the Storage Service Class) and then re-transmit
> the N-ACTION request." — PS3.4 2026d, §J.3.3, Note

Already the decided model for `stored` (design state §3, step 11). What it adds: the result is **per instance**, and the
standard leaves retry and deletion policy to the SCU, so ours must be written down as a conformance statement would.

### 3.13 IHE Imaging Object Change Management

A change at one system (rejection for quality or patient safety, a wrong worklist entry, retention expiry) travels to
every copy as a Key Object Selection document, the rejection note; the receiver hides or deletes what it lists.

> "The Imaging Object Change Management Integration Profile (IOCM) specifies how one actor communicates local changes
> applied on existing imaging objects to other actors that manage copies of the modified imaging objects in their own
> local systems. The supported changes include (1) object rejection due to quality or patient safety reasons, (2)
> correction of incorrect modality worklist entry selection, and (3) expiration of objects due to data retention
> requirements." — IHE RAD TF-1 Rev 23.0, §28

The rejection note is a tombstone that is itself an object, so it is synchronised like any series (metadata-updates
§13.4) and is as durable as the study.

### 3.14 CouchDB replication protocol

The replicator keeps a replication log on both source and target, resumes from the latest checkpoint both agree on,
asks the target which revisions it lacks (`_revs_diff`), uploads them, forces a commit, then records the checkpoint.

> "Compare session_id values for the chronological last session - if they match both Source and Target have a common
> Replication history and it seems to be valid. Use source_last_seq value for the startup Checkpoint" · "In case of
> mismatch, iterate over the history collection to search for the latest (chronologically) common session_id for Source
> and Target. Use value of recorded_seq field as startup Checkpoint" · "If Source and Target has no common ancestry, the
> Replicator MUST run Full Replication." — CouchDB docs, *Replication Protocol*, §2.4.2.3.3 Compare Replication Logs
>
> "Since batches of changes were uploaded and committed successfully, the Replicator updates the Replication Log both
> on Source and Target recording the current Replication state." — ibid., §Record Replication Checkpoint

The log on **both** sides is what makes a restored target visible: its log is older than the source's, so the two
fall back to their latest common point rather than assume the target has everything (reasoning, for E10).

### 3.15 OAI-PMH incremental harvesting

A harvester asks a repository for records created, modified or deleted since a datestamp; deletions are visible only
if the repository declares it keeps them.

> "If a repository does not keep track of deletions then such records will simply vanish from responses and there will
> be no way for a harvester to discover deletions through continued incremental harvesting." — OAI-PMH 2.0, §2.5.1
> Deleted records

Pull-shaped where ours is push, but it states the general rule: an incremental feed carries deletions only if the
source keeps deletion records at least as long as any receiver may lag.

## 4 · The mechanisms that fit here (reasoning)

Reasoning, not a recommendation of a protocol. Each names the events it answers and how it bears on the five points.

1. **Per-item compare-and-swap with the duplicate clause** (git push §3.2, `--force-with-lease` §3.3, RFC 9110
   §3.10). Answers E1, E3, E4, E5, E6, E12. **Confirms points 1–3**: create as `If-None-Match: *` (git's `zero-id`
   old), delete as an explicit `old → zero-id`, a duplicate answered 2xx. git's `atomic` is the whole package refused.
2. **The sent list moves only after the commitment** (CouchDB's checkpoint after `_ensure_full_commit` §3.14, Storage
   Commitment §3.12). Answers E7, E9. Already proposed (metadata-updates §13.3); prior art adds that retry and delete
   policy be written down as a conformance statement is.
3. **An identity for each side's history** (BEP index ID §3.7, CouchDB session ids in logs on both sides §3.14).
   Answers E8 and E10, which the five points do not: the receiver gives its store an identity that a restore or a
   rebuild changes, the sender records the identity beside its sent list, and a mismatch means "resynchronise", never
   "stale". How a restore changes the identity is open (§5).
4. **A read of the receiver's current hashes, by level** (git's ref advertisement §3.2, CouchDB `_revs_diff` §3.14,
   Dynamo §3.8). Answers E8 (rebuild the sent list from what is stored), E10, E13, and makes a refusal diagnosable
   when `refused` carries the current hash per item: a hash the sender sent before means the PACS is behind (resend
   forward), one it never sent means a second writer or E11 (an operator). Hashed per series and per study it is the
   Merkle comparison: one round trip when nothing drifted.
5. **Deletion records kept as long as any copy can lag** (BEP `deleted` §3.6, OAI-PMH `persistent` §3.15, Cassandra
   §3.9, IOCM §3.13; rsync `--delete` §3.5 as the counter-example). Answers E4, and E4 with E10 (the zombie). Confirms
   point 1. Adds a rule: the receiver's purge of withdrawn instances after the grace period (metadata-updates §8) must
   not precede the oldest backup that still holds them, or a restore must replay the rejection notes.
6. **The counter as a cursor, not a check** (BEP sequence §3.7, CouchDB `seq` §3.14, OAI-PMH datestamps §3.15). Agrees
   with point 5: no surveyed system decides correctness by a per-unit counter; content ids (git) or tags (HTTP) do.
   Counters appear only to resume a scan, and then always under an identity (item 3 above).

Where the five points stand after this survey: points 1, 2, 4 and 5 match established practice; point 3 matches it
for E3/E5/E6/E12, but its "anything else is stale, refused final" is where git and CouchDB do something more
(a read of the current state, an identity of history), and without it E8 and E10 reach an operator or are lost.

## 5 · What is not known

* **Whether the PCS keeps a series' tree (its frames) after `stored`.** Repairing E10 by re-sending needs it; the
  design state says the hospital keeps originals (§3), not that the PCS tree stays. A question for the PCS team.
* **How the PACS is backed up and restored** (per study DB and `.sbnd` together or not, how often, by whom), so whether
  a restore can be made to change the store's identity (§4, item 3) or the receiver must detect it (an identity stored
  outside what is backed up). Open with the owner.
* **Whether a second writer exists at the PACS** (E12): open (design state §5); §4 item 4 lets the sender tell it apart
  either way.
* **The cost of a series digest at the PACS**: theory cannot decide whether it is kept (one more row written in step
  7's transaction) or computed on demand. Pre-registered below; not run.

**Pre-registered measurement: a series digest, kept or computed.** *Hypothesis:* computing a series digest on demand
(read every item hash of the series from its study DB, hash them in UID order) costs under 5 ms at 2 000 instances, so
no stored digest is needed. *Variants, interleaved per round:* (a) on demand, (b) one stored digest row read. *Sizes:*
1, 262, 2 000 instances, the parser's five packages as fixtures. *Cache:* warm, and cold forced through the study DB's
own uncached open (the from-disk helper D2 chose, on `claude/pacs-receiver-impl` at `c66f0d0`), not by page-cache
eviction. *Measure:* latency per digest, p50 and p99 over 30 rounds, one core; the host's saturation point stated and
nothing claimed past it. *Decision:* (a) if its p99 at 2 000 instances is < 5 ms cold; else (b). *Mutation:* corrupt one
stored item hash; both variants must report the series as different.

## 6 · Sources

Fetched 2026-10-28; nothing fetched is committed.

| source | location used | from |
| --- | --- | --- |
| gitprotocol-v2 | §Capabilities; §fetch | git/git `Documentation/gitprotocol-v2.adoc`, master |
| gitprotocol-pack | §Reference Update Request and Packfile Transfer; §Report Status | git/git `Documentation/gitprotocol-pack.adoc`, master |
| gitprotocol-capabilities | §atomic | git/git `Documentation/gitprotocol-capabilities.adoc`, master |
| git-push(1) | `--force-with-lease` | git/git `Documentation/git-push.adoc`, master |
| A. Tridgell, P. Mackerras, *The rsync algorithm* (TR-CS-96-05) | §The rsync algorithm | rsync.samba.org/tech_report/ |
| rsync(1) | DESCRIPTION; `--delete`; `--remove-source-files` | download.samba.org/pub/rsync/rsync.1 |
| Syncthing Block Exchange Protocol v1 | §Index and Index Update; §Fields (FileInfo Message); §Delta Index Exchange | syncthing/docs `specs/bep-v1.rst`, main |
| Syncthing, *Folder Types* | §Receive Only Folder | syncthing/docs `users/foldertypes.rst`, main |
| G. DeCandia et al., *Dynamo: Amazon's Highly Available Key-value Store*, SOSP 2007 | §4.7 | allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf |
| Apache Cassandra docs, *Repair*; *Tombstones* | §Incremental and Full Repairs; §Preventing Data Resurrection, §Grace period | apache/cassandra `doc/modules/cassandra/pages/managing/operating/`, trunk |
| RFC 9110, *HTTP Semantics* | §13.1.1, §13.1.2 | rfc-editor.org |
| draft-ietf-httpapi-idempotency-key-header-08 (2026-10-22, a draft, not an RFC) | §2.2, §2.6, §2.7 | ietf.org/archive/id/ |
| DICOM PS3.4 2026d | §J.1.1, §J.3.2, §J.3.3, §J.3.6 | dicom.nema.org, `part04/chapter_J.html` and its sections |
| IHE RAD TF-1 Rev 23.0 (2025-08-08) | §28 | ihe.net, `IHE_RAD_TF_Vol1.pdf` |
| CouchDB, *Replication Protocol* | §Compare Replication Logs; §Calculate Revision Difference; §Record Replication Checkpoint | docs.couchdb.org/en/stable/replication/protocol.html |
| OAI-PMH 2.0 (document version 2015-01-08) | §2.5.1, §2.7.1 | openarchives.org/OAI/openarchivesprotocol.html |

**Named, not read for this row:** IHE RAD TF-2 §4.66 (RAD-66's expected actions; metadata-updates §12 cites them);
Merkle's original paper (Dynamo's reference [13]); version vectors' original papers. Round-trip costs in §2 and §3.8
are arithmetic on the 700 ms figure, not measured.

