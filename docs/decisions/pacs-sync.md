# PACS receive: the protocol, the schema and the layout

Written 2026-11-22 by row PACS-PAGE (`claude/work-ledger:docs/queue-2026-11-14.md`), a session that ran none of this
question's rows, from pushed results only; nothing run but `git` over the branches. Inputs at: `claude/unified`
`4a2b4277` (`docs/ingest/`, `docs/lines/metadata.md`, `docs/lines/viewer.md`), `claude/sync-reconcile` `cafa8eca`
(PR 417), `claude/study-db-schema` `61aff565` (PR 407), `claude/receiver-range` `c37b5353` (PR 422),
`claude/work-ledger:docs/queue/COMPLEXITY-AUDIT-report.md` (item 5). "Design state" is
`docs/ingest/pacs-receive-design.md`; its D-numbers are its §14. No new investigation, by the owner's word of
2026-10-29 ("organize and evaluate from the research done, no new investigations", `metadata.md` §Decisions).

## 1 · The question

The receive path takes what the PCS delivers, checks it, keeps each study's store current and serves every series by
UID. Its code is built and tested on loopback; what it waits on is choices, not measurements: **how updates travel**
(the synchronization shape, which turns on whether anything but the PCS ever edits metadata), **how the PCS's tree
arrives** (a package or rsync; a cleared `incoming/` or a kept mirror), **one study-DB schema**, **the input layout**,
and eleven smaller defaults (design state §14). The fork is the owner's because it is product scope (who may edit a
study's metadata), and several parts turn on the PCS team's answers, which only the owner can ask for.

## 2 · The recommendation, and the owner's yes or no

**Take the two reviewed PRs (407, 422) and PR 417 once its review finds no blocker, declare one writer (the PCS) for now, which makes the shape E + F, and send the PCS team
one note; every other default stands as the design state prints it.** That serves the value statement's last line
("Its input is what the PCS delivers; the PCS itself is out of scope"): with one writer, the PACS never needs the PCS
to know about edits made on our side.

| # | the owner's yes or no | recommended | a yes changes | a no leaves |
| ---: | --- | --- | --- | --- |
| 1 | Merge PR 407: one study-DB schema, `xxh3 TEXT` (16 lowercase hex) (D1) | **yes** | `pacs-verify` reads what the receiver writes; the defect it fixes is measured ("Invalid column type Text"); review: no blocker | the verify tool fails on every stored study; `INTEGER` instead is PR 407's §The other choice (one hash in two forms in one DB, 8 bytes a group saved, **derived**) |
| 2 | Merge PR 422: the receiver's signed-source tests, no range check of its own (metadata §Open 5) | **yes** | 51 tests, 5 mutants killed, two of which the old suite let live (**measured**); review: no blocker | §Open 5 stays open on paper although answered |
| 3 | Merge PR 417: the hash bridge and P3 against E reconciled (metadata §Open 2) | **yes, after its review** (corrected 2026-11-23, `README.md` §Review B2; condition met 2026-11-25, PAGES-PASS-FIX: SYNC-RECONCILE-REVIEW and its re-review are done, "No blocker open" (`claude/work-ledger:docs/queue/SYNC-RECONCILE-REVIEW-FIX-REVIEW.md`), and UNIFIED-SYNC-1124 merged PR 417 into `claude/unified` at `e82b3c17f`) | the records agree: bridge (a) in every pattern; P4 (E) over rsync only with zstd on the metadata call and rsync's listing ≤ 34 KB (ct), ≤ 221 KB (2 000) | two records that contradict each other |
| 4 | **One writer for now**: no client-application edits of metadata at the PACS; every correction comes through the PCS (#220's policy P5) | **yes** | the shape is **E + F** (#222 §6.4: "without one, E by simplicity"); a row to build E + F in sender and receiver, by a session that wrote none of #220–#223 | the fork stays open and A + F (+ G) is the ranking's first: a `manifest` member, the update mode, `stale` as final, a tombstone table (#222 §6.4) |
| 5 | The hash bridge (a): the receiver checks the PCS's BLAKE3 names; our DB keeps XXH3 (D15) | **yes** | the default `pcs-pacs-options.md` §1 already prints | (b) or (c), which miss rot at rest at the PCS (`rsync-delivery.md` §1) |
| 6 | Layout A: follow the PCS's code at `e105214`, the PDF's B recorded as its target (D14) | **yes, until the PCS team answers note item 6** | the default as built | a choice without the PCS's word on which layout it will ship |
| 7 | The remaining defaults as §14 prints them: D3 #169's (a) (the receiver's words `stored`/`refused`/`quarantined` at `<root>/status/<name>`); D5 T1 (a row per group); D6 the ready per-series row stored compressed, read open-read-close; D7 rusqlite 0.41; D9 an outbox directory, a file per owed study; D10 #142's seven choices as built; D13 polling | **yes, as one** | each default becomes a decision; nothing new built | each stays "open with the owner" |
| 8 | One reader of the parser's group file (audit item 5), queued as a proposal row: one crate, both callers, a key written twice **refused**, tested | **yes, queued; not built now** | one format, one reader; the two readers today disagree on a duplicate key (from-parser keeps the last, the receiver the first; read, not run) | two readers of one format |
| 9 | The metadata a viewer reads (viewer §4 item 8): pixel spacing, frame of reference, instance UIDs | **no, not now** | — | recorded; the viewer line is paused (viewer §header); D6's ready row is where they would go |
| 10 | Send the note in §9 to the PCS team | **yes** | the parts that wait on the PCS (delivery, `incoming/` or mirror, layout, frame hashes) can be decided | they stay open |

Not the owner's any more: metadata §Open 6 ("one or two commits each on `pacs-design-state` … not yet in
`line-pacs`") is closed: `git rev-list --count origin/claude/unified..origin/claude/<b>` is 0 for `pacs-design-state`,
`pacs-disk-layout-measure`, `pcs-pacs-options`, `rsync-options`, `rsync-updates` and `line-pacs` (**measured**, `git`,
2026-11-22). `claude/unified` carries them all; PR #258 is closed. The line doc owes the correction.

## 3 · The options

**The synchronization shape** (#222's table, **theory** unless labelled; its 13 events counted with both open questions
at their worst: a second writer exists, the PCS keeps leftover files).

| shape | the package carries | the sender keeps | events ✓ / Op / ✗ (with §6.1's rules) | a correction's extra cost, satellite (fiber) |
| --- | --- | --- | --- | --- |
| **A** delta + preconditions | changed items, each with the hash it replaces | the sent list | 9 / 1 / 3 (10 / 0 / 3) | ≈ 0 (≈ 0) |
| **E** full snapshot | the unit's whole metadata; pixels by hash | "this series changed" | 7 / 0 / 6 (9 / 0 / 4) | +0.7 s (mr, 145 instances) → +4 s (2 000) (+15 → +100 ms) |
| **B** full manifest, partial payload | every item's hash; bytes the PACS lacks | the sent list | 7 / 0 / 6 (9 / 0 / 4) | 0 → +1.4 s at 2 000 (0 → +20 ms) |
| **D** revision log (as built) | (unit, revision), whole groups | a counter | 7 / 1 / 5 (8 / 1 / 4) | ≈ 0 |
| **F** anti-entropy, a layer | per-study roots, then down the tree | its tree | finds what every other shape misses | 1 exchange a day, ≈ 4 KB |

Measured beside it (#223, one CT fix): E 35 KB, B 10–11 KB, a gap of one round trip; #223's pre-registered verdict is
E. Over rsync (PR 417, **derived** from #234's estimates by #223's rule, as its review corrected it: `rsync-updates.md`
§6.1, PR 417 §SYNC-RECONCILE-REVIEW B1): E (P4) "only if the metadata call uses zstd (`--zc=zstd`) and rsync's file
list compresses to ≤ 34 KB for ct and ≤ 221 KB at 2 000 instances" on rural ADSL at 0.5 Mbit/s; else P3. With zlib
per file, P3 on satellite too (P4 − P3 0.9–1.7 s for ct at 2 Mbit/s). M-R2 and M-R3, not run, decide.

**The second writer** (#220 §1, **theory**). With a PACS edit, A refuses what E would overwrite: "every two-way shape
… silently overwrites their edits on the next PCS change" (#222 §On one screen). P5 (no PACS edits) asks nothing new
of the PCS; the hospital must re-send corrections. P1 (the PCS always wins) asks nothing either, but loses a PACS edit
except in the audit. P2–P4 and P6 each add a refusal path, an ownership table, a feed back to the PCS, or trusted
clocks.

**The delivery** (`pcs-pacs-options.md` §0). The package profile (tar, HTTPS resumable, mutual TLS, polled reply) is
built and tested on loopback (#163, #164, #177) and the only one that can move to QUIC; the rsync profile is the PCS
team's proposal of 10-28, and under it `incoming/` cleared or a kept mirror turns on the PCS's answers (§9 items 1–3).

**The schema** (PR 407): `TEXT`, 16 hex, built; `INTEGER`, two's-complement, about half the hashes negative in the
`sqlite3` shell, 8 bytes a group smaller (**derived**).

## 4 · Where it holds

**Fixtures and limits.** The receiver's synthetic test packages (PR 407, PR 422), #223's packages built from #154's
five TCIA series and a synthetic 2 000-instance series, and one 4-core cloud host; every limit is in the list below.

**US and DBT stacks.** The receive path never reads a pixel: it carries coded bytes and checks hashes (PR 422: "the
receiver never types a sample"), so modality enters only through the instance and group counts, which set E's
snapshot size and every per-instance cost. Our fixtures' series are CT and MR (#154) and a synthetic 2 000. How many
instances a DBT or ultrasound series has in the PCS's layout is **not known here** (no DBT or US study has been parsed
by the PCS's parser in any row). If a stack is one multi-frame instance, E's cost sits at the small end of the table
above (**theory**, untested); if it is one instance per frame, a long clip approaches the 2 000-instance cells.

**The predictions against the runs.** #223's pre-registered rule held E for its CT event (**measured**: its bytes
counted). PR 422's prediction ("passes: say so, no fix") held. M-R1 to M-R3 and #222's §7 are in the list below.

**Where the link, not the decode, binds** (2026-11-25, PAGES-PASS). No decode enters this question: the receive path
never reads a pixel (PR 422, above). The link that enters is the PCS's to the PACS, not a reader's, and only through a
correction's extra cost: satellite, fiber and rural ADSL in §3, every figure **theory** or **derived** by #156's
arithmetic, none timed on a link (#223's body, below). On satellite E costs +0.7 s to +4 s a correction; on rural
ADSL at 0.5 Mbit/s P3 against E turns on M-R2, not run. No transport row of a reader's link is touched, and none is
lowered by the decode-bound phone (`README.md` §Premises item 1).

**Each limitation, and what found it** (2026-11-25, PAGES-PASS):

* No real PCS package and no deployed store anywhere: PR 407 and PR 422 ran the receiver's synthetic test packages
  (one study, one or two series, 100-byte frames; stand-in AV1 units, nothing decoded). Found by this page's reading
  of PR 407's and PR 422's tests.
* #223 counted one CT fix's bytes in the packages it built and derived its times: "Times come only from #156's
  arithmetic (`wire.transfer()`); nothing is timed on a link" (PR #223's body, fetched 2026-11-25). Found by
  DECISION-PAGES-REVIEW m6, its quote and "bytes on loopback" named by DECISION-PAGES-FIX-REVIEW r-n1, corrected by PAGES-PASS.
* #234's and PR 417's times are estimates from #154's five TCIA series and a synthetic 2 000-instance series. Found by
  PR 417's own label (**derived** from #234's estimates by #223's rule, §3).
* #166 measured cold and warm; #173 warm, one host, saturating at 100 viewers. Found by #166 and #173.
* One 4-core cloud host for every gate. Found by this page's reading of the PRs' gates.
* No DBT volume and no breast ultrasound cine went through the receive path, and no DBT or US study has been parsed by
  the PCS's parser in any row, so a stack's instance count is not known. Found by this page (the rows' fixtures);
  US-DBT-CARRY §4.3 says the same ("instance and object counts **not known**").
* The synchronization shapes' scores and the second-writer policies are **theory**. Found by #222 and #220, which
  label them so.
* M-R1 to M-R3 and #222's §7 measurements are pre-registered and not run. Found by `rsync-updates.md` §7 and #222 §7.
* The two readers of the parser's group file disagree on a duplicate key: read, not run. Found by COMPLEXITY-AUDIT
  item 5.
* The PCS's frame files carry no hash, so (b) and (c) miss rot at rest at the PCS. Found by the PCS's code at
  `e105214` (§9 item 5: "no hash in the name").
* Group 0002 still lands in the instance group at `e105214`: read, not run (§9 item 8). Found by
  `pacs-receive-design.md` §15 ("*Checked 2026-10-28 at `e105214`:* group 0002 still lands in the instance group").

## 5 · The mechanism

Every event-driven shape needs a third hash, the one the PCS last sent, to tell "the PACS was edited" from "the PACS
is behind". A carries it in each package; E does not, so E overwrites. With one writer there is nothing to protect:
E sends the whole unit's metadata and the PACS replaces it, with no `need` reply, no sent list to lose and no stale
refusal looping into quarantine (#220 §1 finding 3). F is needed whatever carries the events, because no event-driven
shape sees a unit nobody touches again (a PACS restored from a backup; #222 §On one screen, finding 1). Two
preconditions bind every shape: a tombstone for a withdrawn instance, and the PCS no longer leaving a corrected group
beside the old one (Q-U1; §9 item 4). The schema is a bug, not a trade: two crates read one table in two types.

## 6 · What would change the recommendation

* **Client-application edits wanted** (a QC tool, a correction at the reading room): item 4 flips to A + F (+ G). The
  deciding fact is product scope, not a measurement; #220 §6's three questions are the ones to answer.
* **M-R2** (rsync's file list under `-z`) **and M-R3** (the zstd call's metadata bytes): a listing above 34 KB (ct)
  or 221 KB (2 000), or a metadata call without zstd, and P3 beats E by #223's own rule (`rsync-updates.md` §6.1).
  Cloud runs, pre-registered in `rsync-updates.md` §7.
* **A real DBT or US series through the PCS's parser**: its instance count decides whether E's snapshot cost is the
  table's small or large end.
* **The PCS team's answers** (§9): a kept, current, snapshot-able tree makes the kept mirror possible; frame files
  without hashes keep a gap in every pattern.

## 7 · What it would reopen

Nothing in the program's §Decided approaches. Item 4 narrows D12's default ("the §5 model as proposed", shape A): a
yes replaces it with E + F. The owner's 10-24 decisions ("display metadata is updated in place, no kept history") and
10-26 ("the PCS decides when a series is complete") stand under every shape.

## 8 · Rows and links

* Rows: SYNC-RECONCILE (PR 417; SYNC-RECONCILE-REVIEW and its fix loop done 2026-11-23, no blocker open; merged into `claude/unified` 2026-11-24), STUDY-DB-TEST and STUDY-DB-TEST-REVIEW (PR 407), RECEIVER-RANGE and
  RECEIVER-RANGE-REVIEW (PR 422); status files under `claude/work-ledger:docs/queue/`.
* `docs/lines/metadata.md` §Open 1–7; `docs/ingest/pacs-receive-design.md` §6, §14, §15, §16;
  `docs/ingest/sync-protocol/shapes.md` §6.4; `docs/ingest/sync-protocol/second-writer.md` §1, §6;
  `docs/ingest/pcs-pacs-options.md` §0, §6; `docs/ingest/rsync-updates.md` §6.1 (on `claude/sync-reconcile`);
  `docs/lines/viewer.md` §4 item 8; COMPLEXITY-AUDIT item 5.
* PRs: 407, 417, 422 (open drafts into `claude/unified`); #220–#223, #230, #233, #234 (carried by `claude/unified`).

## 9 · The note to the PCS team (drafted, not sent)

From the design state §15, `pcs-pacs-options.md` §6 and metadata §Open 4, merged into one list; each question says
what its answer decides.

1. **Your exam tree:** is it kept as the record while updates can still come, does it always show the current state,
   and can it be synced quiet or from a snapshot? (decides `incoming/` cleared or a kept mirror)
2. **Delivery:** a package built by our sender at your side, or rsync of your tree? (the profile)
3. **The trigger and the item list:** their form, and who writes the list, our sender or your process. (the seam)
4. **Corrections:** your parser writes a corrected group beside the old file and never deletes it; please replace the
   file, or mark the current one. How is a withdrawal sent? (a precondition of every shape)
5. **Frame hashes:** your code writes raw frames as `<I>/G|P|R/%05d` with no hash in the name, so a frame damaged at
   rest on your disk reaches us undetected; your PDF names them `00001.blake3`. Will frame files carry their hash, and
   when? (the hash bridge's gap)
6. **The layout below the series:** your code and your PDF differ; which will you ship, and are frames numbered with 4
   or 5 digits? (D14, and who builds the `.sbnd`)
7. **Completeness and late instances:** which heuristic decides a series is complete, and can you call our sender
   again for a late instance; does an addition carry the added frames only or the series again?
8. **Your parser:** group 0002 still lands in the instance group at `e105214` (read, not run); converted enhanced
   objects, when?
9. **Patient updates:** does any site feed patient updates (HL7 A08, A40) to you, and how often does the hospital
   re-send a corrected object? (#220's two unknowns; they size the second-writer question)
10. **Not needed from you:** a decoded-samples hash per frame (we check coded hashes; the client checks samples).
