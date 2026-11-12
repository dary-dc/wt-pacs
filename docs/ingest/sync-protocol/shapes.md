# The synchronization protocol: which shape

**Status: proposed 2026-10-28, theory only — nothing built, nothing timed.** It compares the shapes that could keep the
PACS's store converged to what the PCS holds, through our sender at the PCS and our receiver at the PACS, against every
event listed in §2. It reopens nothing the owner decided (§1). Its inputs, cited by commit since none is on this branch:
the design state `docs/ingest/pacs-receive-design.md` at `f8b0bb2a` (#168: §2, §3, §5, §14 D3/D12/D13); the update flow
`docs/adr/metadata-updates.md` §13–14 at `3ec22f13` (#176); the sender as built, `docs/adr/pcs-transfer.md` §15 at
`3ea13d37` (#177); the receiver as built, `docs/adr/pacs-receiver.md` at `c66f0d06` (#163); and the measured update
packages of `lab/metadata-store/README.md` at `cbc339d2`. *Reasoning* marks our own inference; *estimate* marks
arithmetic on sizes nobody measured.

## On one screen

| shape | the package carries | the sender keeps | §4's 13 events: ✓ / Op / ✗ (with §6.1's rules) | extra cost of a correction, satellite (fiber) |
| --- | --- | --- | --- | --- |
| **A** delta + preconditions (the five points) | changed items, each with the hash it replaces | the sent list | 9 / 1 / 3 (10 / 0 / 3) | ≈ 0 (≈ 0) |
| **B** full manifest, partial payload | every item's hash; bytes the PACS lacks | the sent list (bytes only) | 7 / 0 / 6 (9 / 0 / 4) | 0 → +1.4 s at 2 000 instances (0 → +20 ms) |
| **C** negotiated, git-like | first the manifest; then what the PACS wants | nothing | 7 / 1 / 5 (9 / 1 / 3) | +1 exchange: +0.7–2.1 s plus scan and poll (+10–30 ms) |
| **D** per-unit revision log (as built) | (unit, revision), whole groups | the revision counter | 7 / 1 / 5 (8 / 1 / 4) | ≈ 0 (≈ 0) |
| **E** full snapshot | the unit's whole metadata; pixels by hash | "this series changed" | 7 / 0 / 6 (9 / 0 / 4) | +0.7 s (mr, 145 instances) → +4 s (2 000) (+15 → +100 ms) |
| **F** anti-entropy (repair layer) | per-study roots, then down the tree | its tree | detects what the others miss; repairs through them | 1 exchange a day, ≈ 4 KB |
| **G** A + declared result (new, §3.7) | A's package + the unit's root after apply | as A | 9 / 1 / 3 (10 / 0 / 3); drift seen at every touch | + 16 B |

✓ correct, Op an operator's, ✗ silently wrong; counted from §4's matrix with both open questions at their worst (a
second writer exists, the PCS keeps leftover files), a cell with two outcomes counted as the worse.

**Recommended (reasoning): A for every event, F on top, G's 16-byte root once F exists.** Three findings decide it:

1. **No event-driven shape sees a unit nobody touches again.** A PACS restored from a backup silently lacks every series
   stored after the backup, under A, B, C, D and E alike, until something changes that series. Only F finds it. F is
   needed whatever carries the events, and its one endpoint also rebuilds a lost sent list and repairs drift (§3.6).
2. **The second writer is the fork.** If client applications edit metadata at the PACS, every two-way shape (B, C, E, F
   repairing) silently overwrites their edits on the next PCS change: telling "the PACS was edited" from "the PACS is
   behind" needs a third hash, the one the PCS last sent. A carries it in the package; B/C/E need it kept at the PACS
   (§6). With no second writer, E + F is simpler than A + F and self-healing, and A's refusals become operator pages for
   drift E would repair.
3. **Two precondition-free requirements hold for every shape:** a withdrawn instance needs a **tombstone** kept as long
   as the PCS may send it again, or every repairing shape resurrects it (Demers et al.'s "death certificates", §5); and
   the PCS's **leftover group files** make a reverted correction (A → B → A) silently wrong in all seven shapes. The
   PCS fixing them (Q-U1) is a precondition, not a discriminator; without it only A, B, D, E work at all, for
   corrections that never revert (§6).

Go deeper: §1 what is fixed · §2 the events · §3 the shapes, each with its diagram, state, PCS needs and distance from
as built · §4 every event × every shape · §5 cost · §6 combinations, ranking and the open questions · §7 pre-registered
measurements · §8 sources.

## 1 · What is fixed

Decided by the owner and not reopened here: the PCS decides when a series is complete; one package per series, a pax
tar of a header, one metadata member and the `.sbnd`; small update packages, metadata only, down to the level that
changed; a late instance as an addition, merged into the one `.sbnd` by full rewrite and rename; the sender keeps each
package until `stored` and resends the same bytes on `refused`; replies and retries are required; XXH3; the receiver
stages, reads back from disk, renames, writes one transaction, then replies; an update replaces the row, no history,
an audit record (who, when, what); first version of updates: the sender compares the hash-named files with what it
last sent. Proposed and awaiting the owner: the five points of the design state §5 (shape A). #163 and #177 carry
(unit, revision) and no resend-identity logic, on purpose (shape D).

**The links** (labelled assumptions, from the lab's classes at `cbc339d2`): fiber 10 ms RTT, 100 Mbit/s up;
satellite ~700 ms RTT, 2 Mbit/s up (the lab's GEO class has 600 ms; its measured times are scaled by RTT where quoted).
**Sizes**, the owner's: a single correction 3–6 KB; a series resend's metadata 1.35 MB raw, 45 KB as one zstd stream
(that is mr, 145 instances, in the lab's table). *Estimates* added here: a manifest line per instance (coded UID, two
XXH3-64) ≈ 80 B raw, ≈ 25 B compressed, since 16 of its bytes are hash and do not compress; so a manifest is ≈ 3.6 KB
for mr, ≈ 6.5 KB for 262 instances, ≈ 50 KB for 2 000. TCP's first flight is 10 segments, "maximum 14600 B" (RFC 6928
§2), so anything ≤ ~14 KB costs no round trip beyond the request's.

**U**, the cost every shape pays for one package as built (fresh TCP + TLS 1.3 connection, the upload, the verdict):
measured for a correction at ≈ 3 RTT plus the verdict's poll — 30 ms on fiber, 1.83 s at 600 ms (lab, "estimated, a
correction"), so ≈ 2.1 s at 700 ms. Every cost below is **beyond U**.

## 2 · The events

| # | event | what the PACS must end with |
| --- | --- | --- |
| E1 | first send of a series | the series, its instances, its `.sbnd` |
| E2 | a late instance | the instance added, its frames merged |
| E3 | a correction at exam, series or instance level, arriving at the PCS as a whole re-sent object | the corrected group in place of the old, audited |
| E4 | a withdrawal (an IHE IOCM rejection note, a KOS) | the referenced instances hidden, never back |
| E5 | a duplicate after a lost reply | nothing new; `stored` |
| E6 | two changes to one series close together; or to the exam group through two series | the later one |
| E7 | the sender crashes | the same end as without the crash |
| E8 | the sender's sent list is lost (a PCS reinstall) | the same end; no operator, ideally no pixels re-sent |
| E9 | the receiver crashes at any step | the same end (#163's recovery from step 3) |
| E10 | the PACS restored from a backup, behind what the sender believes it sent | caught up |
| E11 | the PCS's parser leaves the old group file beside the corrected one (#176 §13.2) | the current one |
| E12 | a client application edits metadata at the PACS (a second writer; whether it exists is open) | the edit kept; a PCS change to the same item a conflict |
| E13 | both sides drifted apart (a bug, a lost file, a hand edit) | detected, then repaired |

## 3 · The shapes

Common to all: the carrier, the receiver's steps 1–12 and its recovery are #163's; an exchange is a package and its
verdict. *Reasoning:* because the receiver is "two programs joined by files" (#169) with no network of its own, any
answer that carries data back (B's `need`, C's wants, F's mismatches) travels as a **verdict with a body**, read by the
same poll as `stored`: no new channel, but each such exchange costs U plus the receiver's scan period plus the
sender's poll interval.

### 3.1 · A — delta with preconditions (the five points)

```text
sender                                          receiver
  │ scan tree; diff against the sent list         │
  │ package: --.<new>  replaces <prev>  ─────────▶│ current = prev → apply, audit
  │                                               │ current = new  → duplicate
  │◀──────────────────── stored | refused stale ──│ else           → refused stale
  │ sent list ← new (only after stored)           │
```

* **State.** Sender: the sent list (#177's per-revision records already are it, pcs-transfer §15.13). Receiver: the
  rows and their XXH3.
* **From the PCS.** A rule for "current" among the group files: with leftovers, "the one name never sent" works once,
  then fails on a revert (E11).
* **Distance from as built.** #177: a `manifest` member (`replaces`, `removes`), an update mode diffing the tree against
  the records, one package in flight (§6's exam rule), and `refused stale` treated as final, not resent — resending the
  same bytes can never succeed against a stale precondition, so the decided "resend the same bytes on refused" must
  exclude that class. #163: the item-by-item table its §5 already proposes; step 4's (unit, revision) check removed.
* **Weak spots.** E8: with no sent list there are no preconditions, so every series looks unsent and goes again **with
  its pixels** (500 MB at 2 Mbit/s is ≈ 33 min a series) unless the list is rebuilt from the PACS — F's endpoint. E10:
  a touched item is refused stale (an operator); an untouched one is silently absent. `removes` lines: the PCS never
  deletes a file, so the sender never produces one; withdrawals come as a KOS (#176 §13.4) and removals are the update
  API's (*reasoning*).

### 3.2 · B — full manifest, partial payload

```text
sender                                          receiver
  │ package: manifest (every item → hash)         │
  │          + bytes the sent list says missing ─▶│ listed, held  → nothing
  │                                               │ listed, given → apply
  │                                               │ listed, lacking, not given → need
  │◀──────────────────── stored | need <hashes> ──│ held, not listed → delete
  │ (on need) package of those bytes ────────────▶│
```

* **State.** Sender: the sent list, for bytes only (a wrong guess costs a `need`, not correctness). Receiver: rows.
* **From the PCS.** One current file per item: the manifest must name exactly one exam group. #177 refuses a tree with
  two at build (exit 5), so without Q-U1 a correction is an operator's.
* **Distance.** #177: the manifest of the whole unit, a second package on `need`. #163: delete-if-unlisted, the `need`
  verdict (a fourth word in D3's vocabulary). Instances must be listed per instance, not by the `.sbnd`'s hash: the
  PACS's merged `.sbnd` never hashes like any file the PCS holds.
* **Weak spots.** Absence means deletion, so a withdrawn instance still in the PCS's tree is listed again and comes
  back (E4, without a tombstone). Two-way: a PACS edit is overwritten (E12).

### 3.3 · C — negotiated, git-like

```text
sender                                          receiver
  │ manifest only ──────────────────────────────▶│ compare with the rows
  │◀──────────────────────── want <hashes> ──────│
  │ package of the wanted bytes ────────────────▶│ apply
  │◀──────────────────────────────── stored ─────│
```

Git's fetch is this: the client "will send a list of the obj-ids it has using *have* lines, so the server can make a
packfile that only contains the objects that the client needs" (gitprotocol-pack). Here the roles are mirrored: the
sender says what it has, the PACS what it wants.

* **State.** Sender: none for correctness (it still needs a trigger: the PCS's call, or a scan). Receiver: rows.
* **From the PCS.** As B; with no sent list there is no "never sent" heuristic, so C does not work at all with
  leftovers (E11: operator at every correction).
* **Distance.** The most: a query kind and a want list as a verdict body at #163, a two-phase send at #177, and the
  tree must still hold the wanted bytes when the second phase runs (once Q-U1 replaces files, a correction between the
  phases means "renegotiate").
* **Weak spots.** One more exchange on every event, the frequent small ones included (§5). Two-way, as B.

### 3.4 · D — per-unit revision log (#149, as built)

```text
sender                                          receiver
  │ <unit>.<n>.<h>.tar ─────────────────────────▶│ n = last + 1 → apply
  │                                               │ n ≤ last, same h → stored
  │◀───────────────── stored | refused gap ──────│ n > last + 1 → refused (gap)
  │                         | quarantined ───────│ (u, n) stored with another h → conflict
```

* **State.** Sender: the counter and the records. Receiver: (unit, revision) in the audit table.
* **From the PCS.** As A.
* **Distance.** None: built.
* **Weak spots.** Any loss of state breaks the count. E8: the counter restarts at 1, every (u, 1) is a conflict →
  quarantine. E10: the PACS's last revision is below the sender's, the next package is a gap, the packages between
  are deleted at the sender → stuck → operator. E6: a series package whose exam group differs replaces it (#163 §7
  question 6's default), so an older series package arriving after a study-level update reverts it silently. The
  counter orders; it never says what the PACS holds.

### 3.5 · E — full snapshot

```text
sender                                          receiver
  │ series changed → package: all its groups,     │
  │   pixels by digest, no .sbnd ────────────────▶│ replace the series' rows whole (as #163 does)
  │◀──────────────── stored | need <frames> ──────│ frames lacking → need
```

* **State.** Sender: only whether a series changed since its last `stored` (one hash of its file names would do).
  Receiver: rows.
* **From the PCS.** As B (one current file per item); the "never sent, else last sent" rule is available.
* **Distance.** The least after D: #163 already "replaces its series' rows whole" for a series package; E is a series
  package without the `.sbnd` for a stored unit. #177: a metadata-only build. `need` only when the PACS lacks frames
  (E8, E10).
* **Weak spots.** Bytes grow with the series (§5). Two-way (E12). Absence is deletion, as B (E4).

### 3.6 · F — periodic anti-entropy (a repair layer)

```text
sender                                          receiver
  │ roots of 256 buckets of studies (4 KB) ─────▶│ compare with its own (kept beside the study index)
  │◀──────────────────── buckets that differ ────│
  │ per study: series roots → item hashes ──────▶│ … down to the items
  │◀──────────────────── what differs ───────────│
  │ repair through A/B/E's own packages          │
```

Dynamo's mechanism, verbatim: "A Merkle tree is a hash tree where leaves are hashes of the values of individual keys.
Parent nodes higher in the tree are hashes of their respective children. The principal advantage of Merkle tree is
that each branch of the tree can be checked independently without requiring nodes to download the entire tree or the
entire data set" (DeCandia et al. 2007, §4.7). And why it is a layer, not a carrier: anti-entropy "is extremely
reliable but requires examining the contents of the database and so cannot be used too frequently", and "propagates
updates much more slowly than direct mail" (Demers et al. 1987/89, §0).

* **State.** Receiver: a root per study, recomputed at step 7 from the rows' XXH3 column (no blob read), and per
  bucket. Sender: the same from its tree's names (hash-named, so no file is read — once names are the hashes, Q-U2).
* **Direction.** One way only: F asks whether the PACS holds what the PCS holds. A study the PCS no longer has is not
  compared and never deleted (the PCS's retention is unknown; *not known*). Under a second writer F can only flag,
  never repair, a difference on an item the PACS edited (§6).
* **Distance.** New at both ends: an `audit` query kind and a verdict with a body (§3); a root column in the study
  index (#146, open).
* **What it uniquely covers.** E10's untouched series; E13 everywhere; E8, by letting the sender rebuild its sent list
  from the PACS's item hashes instead of resending pixels.

### 3.7 · G — A with a declared result (new)

A's package plus one line: the root of the unit's item hashes as the sender's tree has it **after** the change. The
receiver applies A's rules, recomputes its root, and answers `stored` if they agree, `diverged` if not (the change is
still applied: its preconditions held). A `diverged` starts F's descent for that one study at once. It is HTTP's
precondition idea on the result instead of the input: RFC 9110 §13.1.1 uses If-Match "to prevent accidental
overwrites when multiple user agents might be acting in parallel on the same resource (i.e., to prevent the "lost
update" problem)"; A is that per item, G adds the check that nothing else drifted. Cost: 16 bytes and the root
function F needs anyway. Under a second writer the root must be over the hashes **the PCS last sent** (§6), or every
edited study reads `diverged`.

## 4 · Every event × every shape

✓ correct · R refused, recovers by itself · Op needs an operator · ✗ silently wrong. "Exam rule": §6.1.

| | A | B | C | D | E | F (alone, as repair) | G |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E1 first send | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| E2 late instance | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| E3 correction | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| E4 withdrawal (KOS) | ✓ | ✗ resurrected without a tombstone | ✗ same | ✓ | ✗ same | ✗ resurrects without a tombstone | ✓ |
| E5 duplicate | ✓ (current = new) | ✓ | ✓ | ✓ (n ≤ last) | ✓ | — | ✓ |
| E6 two changes close | ✓ per series; exam via two series: Op (stale) without the exam rule | ✓; exam: ✗ revert without the rule | ✓; exam: ✗ | ✓; exam: ✗ (a series package replaces it) | ✓; exam: ✗ | — | as A |
| E7 sender crash | ✓ | ✓ | ✓ | ✓ (two faults at once: Op, pcs-transfer §15.7) | ✓ | — | ✓ |
| E8 sent list lost | ✓ but every pixel again; ✓ cheap with F | ✓ (`need`, one exchange a series) | ✓ | Op (conflicts) | ✓ (`need` for frames) | rebuilds the list | as A |
| E9 receiver crash | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| E10 restored backup | touched: Op (stale); untouched: ✗ | touched: ✓; untouched: ✗ | touched: ✓; untouched: ✗ | touched: Op (gap); untouched: ✗ | touched: ✓; untouched: ✗ | ✓ (finds both) | touched: ✓ (`diverged` → repair); untouched: ✗ |
| E11 leftover file | first correction ✓ ("never sent"); revert ✗ | Op (two files refused at build); revert ✗ | Op every time | as A | as B | cannot tell either | as A |
| E12 second writer | ✓ (a PCS change to an edited item: Op, rightly) | ✗ overwritten | ✗ | ✗ (overwritten, or conflicting counters) | ✗ | ✗ if it repairs, ✓ if it only flags | ✓ |
| E13 drift | ✗ until touched, then Op | touched ✓, rest ✗ | touched ✓, rest ✗ | ✗ | touched ✓, rest ✗ | ✓ | touched ✓, rest ✗ |

*Reasoning, E4.* The KOS reaches the PCS as an instance and travels as a document series (#176 §13.4); the PACS hides
what it references. The rejected instances' files stay in the PCS's tree (the parser never deletes, #176 §13.2), so any
shape where absence from the PCS's list means deletion — or where the PACS repairs toward the PCS's list — brings them
back on the next manifest, snapshot or audit. A, D and G never resend an instance already sent, so they are safe until
E8 makes them resend everything. Demers et al. met the same: "we cannot delete an item from the database simply by
removing a local copy of the item, expecting the absence of the item to spread to other sites. Just the opposite will
happen" (§2). The cure is theirs too, a **tombstone**: the PACS keeps (UID, withdrawn, when) after the purge and
answers a resend of that UID `withdrawn`, never `need`. Their trade-off — a tombstone kept a fixed time risks
resurrection after it — does not bind here: under IOCM corrected objects come back with new UIDs (#176 §13.1, RAD-74),
so a tombstone is ~60 B kept for good. With tombstones, every ✗ in the E4 row becomes ✓.

## 5 · Cost per event, beyond U

Bytes compressed (the limited-link profile); RTT counted from TCP's first flight of ~14 KB, then doubling; satellite
2 Mbit/s up is the limit past its 175 KB bandwidth-delay product. One exchange more = U again: +30 ms / +2.1 s on a
fresh connection, +10 ms / +0.7 s on an open one, plus the receiver's scan period and the sender's poll interval
(settings, not protocol).

| event | A / G | B | C | D | E | F |
| --- | --- | --- | --- | --- | --- | --- |
| E1 first send | — | — (the manifest is the metadata's list) | +1 exchange, + manifest (3.6–50 KB) | — | — | — |
| E2 late instance | — | + manifest: 0 RTT ≤ ~500 instances; +2 RTT (+1.4 s / +20 ms) at 2 000 | +1 exchange + manifest | — | + the whole series' metadata: 45 KB (mr) +1 RTT measured (+0.66 s at 600 ms / +15 ms) | — |
| E3 correction (3–6 KB) | + ~100 B a line | as E2 | +1 exchange + manifest | — | as E2; ≈ 620 KB at 2 000 instances like mr: +4 s / +0.1 s | — |
| E8 sent list lost | every series' pixels (hours on satellite) or, with F, one audit per study | +1 exchange a series | — | operator | +1 exchange a series for frames | 1 exchange + 3 a study |
| E10 / E13 found by F | — | — | — | — | — | 1 exchange a day (256 × 16 B); +3 exchanges a differing study |

Measured anchors (lab at `cbc339d2`, TCP, zstd-1): a correction 30 ms on fiber, 1 824–1 833 ms on GEO 600 ms; mr's
series resend 47 ms and 2 491 ms. Everything else in the table is arithmetic on §1's sizes. **Where it matters:** on
satellite the frequent event is the small correction, and only C adds a whole exchange to it; B and E add round trips
only on large series; A adds nothing. On fiber no shape costs more than ~0.1 s on any event, so fiber decides nothing.

## 6 · Combinations, ranking, and what depends on what

### 6.1 · Rules every shape needs

* **The exam rule.** The exam group is one item shared by every series of the study, so "one package per series in
  flight" (point 4) does not order it: two series packages built around one exam correction arrive in either order.
  Under A the later is refused stale (an operator); under B, D and E the older silently wins. *Proposed:* the exam
  group changes only through a study-level package, one in flight per study; a series package carries it only to
  create it when absent, never to replace it.
* **Tombstones** (§4, E4).
* **`refused stale` is final** for the sender: rebuilt from the tree after the sent list is refreshed, not resent.

### 6.2 · Which combine

| | + F | + G | + a PACS-held base (§6.3) |
| --- | --- | --- | --- |
| A | **yes**: F covers E8, E10, E13 | yes: G is A's package plus a line | no: A carries the base itself |
| B | yes | — | yes, makes it three-way |
| C | yes; C's manifest exchange *is* F's leaf level | — | yes |
| D | yes, but F's repairs collide with the counter (a repair is a revision the sender never made) | no | no |
| E | yes | — | yes |

C and F share machinery; so do G and F. D combines badly with anything that repairs.

### 6.3 · The open questions

**The second writer (E12).** If client applications edit at the PACS, the PACS's current row and the PCS's file can
differ legitimately, and only a third value — the hash the PCS last sent — tells "edited here" from "behind". A carries
it per item from the sender's sent list. B, C, E and F can carry it only if the PACS keeps it: a `pcs_xxh3` beside each
row's `xxh3`, a three-way merge per item (PCS changed only → apply; PACS edited only → keep; both → operator). That is
real cost for a writer that may not exist (CLAUDE.md: build the shape the measurement asks for). So:

* **a second writer exists →** A + F (+ G), or E + F with the PACS-held base — A is cheaper;
* **no second writer →** E + F is simpler and self-healing (no preconditions, a snapshot replaces the series' rows
  whole as #163 already does), at +0.7 s to +4 s a correction on satellite for MR-like series; A + F stays cheapest
  in bytes. M1 (§7) decides whether E's bytes matter.

**The PCS fixing its leftover files (Q-U1).** Not fixed: only shapes with the sender's history can pick a current file
("the name never sent"), and only for corrections that do not revert — A, D, G; B and E only if they borrow the same
rule; C never. Fixed: every shape works and F's sender side reads names, not bytes. A revert (A → B → A) is silently
wrong in **every** shape until it is fixed: the tree then shows nothing new.

### 6.4 · Ranking, with the deciding factor of each pair

*Reasoning*, both open questions at their worst (a second writer, leftovers):

1. **A + F (+ G)** 2. **E + F** 3. **B + F** 4. **C + F** 5. **D** (as built).

| pair | the winner | the deciding factor |
| --- | --- | --- |
| A vs E | A | the second writer (A detects, E overwrites); without one, E by simplicity, unless M1 shows its bytes cost > 1 RTT on satellite for common series |
| A vs B | A | the second writer; then bytes (B's manifest grows with the series) |
| E vs B | E | simplicity: no partial apply, no `need` for metadata; B only where a snapshot ≫ a manifest (M1) |
| B vs C | B | C adds an exchange to every event; B only on `need` |
| C vs D | C | recovery from state loss on either side (E8, E10): C self-heals, D gets stuck |
| A vs D | A | the same: D's counter cannot survive a lost sent list or a restored PACS; A refuses or, with F, repairs |
| any vs + F | + F | the only cover for untouched units after a restore (E10) and for drift (E13) |
| A + F vs G + F | G + F | drift on touched units seen at once, for 16 B; a tie if F runs often |
| F alone | never | anti-entropy "propagates updates much more slowly than direct mail" (Demers); a layer, not a carrier |

**What changes from as built for the recommendation (A + F):** #177 — the `manifest` member, the update mode, the
exam rule, `stale` as final, an `audit` command; #163 — §5's item-by-item table, step 4's revision check gone, a
`withdrawn` tombstone table, an `audit` kind answering with a body, a root per study at step 7. The revision stays a
label in the name (point 5).

## 7 · Pre-registered measurements (not run)

Theory leaves two numbers open. Interleave the variants; mutate every new test.

| | measures | prediction | contradicted if | decides |
| --- | --- | --- | --- | --- |
| **M1** | on the lab's five series (ct, pt, mr, mg, us) and synthetic 2 000-instance copies: a manifest and a snapshot (as #177 packs `metadata`), zstd-1; then both on the lab's GEO and fiber classes | manifest ≤ 0.5× snapshot for ct and pt, ≤ 0.15× for mr; a snapshot of ≤ 300 instances costs ≤ 1 RTT more than a correction on GEO | either is wrong | E vs B, and whether E's bytes matter (§6.3) |
| **M2** | the receiver's root per study from the rows' XXH3 column, and the sender's from names, on 10 000 studies | ≤ 1 ms a study at the receiver; listing-bound at the sender, ≤ 10 ms a study warm | slower | F's period: daily is the default; hourly if both hold |

## 8 · Sources

* RFC 9110, HTTP Semantics, §13.1.1 If-Match (quoted §3.7) and §15.5.13 412: the status "allows the client to place
  preconditions on the current resource state … and, thus, prevent the request method from being applied if the
  target resource is in an unexpected state" — the model of A's `stale`.
* RFC 6928, Increasing TCP's Initial Window, §2: "min (10*MSS, max (2*MSS, 14600))".
* Git, gitprotocol-pack, "Packfile negotiation" (quoted §3.3), git-scm.com/docs/gitprotocol-pack, read 2026-10-28.
* G. DeCandia et al., "Dynamo: Amazon's Highly Available Key-value Store", SOSP 2007, §4.7 (quoted §3.6).
* A. Demers et al., "Epidemic Algorithms for Replicated Database Maintenance", PODC 1987; Xerox PARC CSL-89-1 (1989),
  §0 (direct mail, anti-entropy) and §2 (death certificates), quoted §3.6 and §4.
* IHE RAD TF IOCM ([RAD-66], [RAD-74]) and DICOM PS3.4, as cited and read in #176 §13 at `3ec22f13`; not re-read here.
* This repository: the records named in the header, at the commits named there.

**Not known:** the PCS's retention of its tree after `stored` (bounds what F and E8's repair can recover); whether the
second writer exists; the receiver's scan period and the sender's poll interval in deployment (they add to every extra
exchange); a manifest's real compressed size (M1).
