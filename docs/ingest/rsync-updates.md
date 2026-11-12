# Late instances, corrections and withdrawals over rsync

*2026-10-29. **Proposed**, theory only: nothing here is built or timed. It answers one question for the profile
[`pcs-pacs-options.md`](pcs-pacs-options.md) calls "rsync of the tree": how a late instance, a metadata correction
(exam, series or instance level) and a withdrawal reach the PACS, and which pattern should carry them. **Source** marks
a quote; **inference** this file's own reasoning; **estimate** arithmetic on a size or a round-trip count nobody
measured. What the records below settle is cited, not repeated.*

Read with (unmerged drafts, by branch and commit): the design state `docs/ingest/pacs-receive-design.md` at `abf645ab`
(#168: §1 the PCS's layout, §2 the hash bridge, §3 the receiver and the merge, §5 the update model and the sync
results); `docs/ingest/sync-protocol/shapes.md` at `c2a14608` (#222: shapes A–G, events E1–E13, tombstones, the exam
rule); `prior-art.md` at `795f0ff7` (#221); `second-writer.md` at `1fee7e66` (#220); and `lab/metadata-store/README.md`
§Synchronization at `2c1f31f9` (#223: shape E's full resend is 35 KB on the median series, ct, and wins the
pre-registered rule against B).

## 0 · On one screen

```text
 PCS: exam tree (BLAKE3-named groups,           PACS
      frames per instance or per series)
      + our trigger script
 │                                                │
 │ P1  rsync --files-from=<new since sent list> ─▶│ incoming/<unit>/ (empty)          state: sent list at the PCS
 │ P2  rsync <series>/ --compare-dest=mirror/ ───▶│ incoming/<unit>/ ← only what the  state: a mirror of every
 │                                                │   mirror lacks or differs from      metadata file at the PACS
 │ P3  ssh: the unit's item list ────────────────▶│ answers from study DB + .sbnd      state: none beyond what
 │     ◀─────────────────────── the files I lack ─│   index                             the PACS already holds
 │     rsync --files-from=<that answer> ─────────▶│
 │ P4  rsync the unit's whole metadata ──────────▶│ item by item: same → nothing       state: none
 │     + frames of the event's instances          │   (frames lacking → need)
 │                                                │
 │ ─── every pattern: then the marker, the poll, "stored" (K, §2) ───────────────────────────────────────
```

| | late instance, beyond K: satellite (fiber), ct · 2 000 instances | survives a lost sent list | survives a PACS restored from backup (touched series) | PACS disk beyond the serving tree | needs from the PACS |
| --- | --- | --- | --- | --- | --- |
| **P1** new only, sent list | 0 · 0 | no: every pixel again | no: silently missing | `incoming/`, one unit | nothing new |
| **P2** mirror + `--compare-dest` | +1.6 s (25 ms) · +3.5 s (60 ms) | yes | only if the mirror is restored with the study DB | + a mirror: ≈ 3 % of the coded frames in 4 KiB blocks | the mirror, kept in step with the study DB |
| **P3** negotiated, then `--files-from` | +1.4 s (20 ms) · +2.2 s (32 ms) | yes | yes | `incoming/`, one unit | an answer command |
| **P4** full metadata resend | +1.7 s (27 ms) · +4.0 s (70 ms) | yes | yes, frames by `need` | `incoming/`, one unit | `need` for frames |

**K**, the commit every pattern pays (ssh, the metadata call, the frames call, the marker, one poll), is ≈ 26 round
trips on one shared ssh connection: **≈ 18 s on satellite**, 0.26 s on fiber (*estimate*, §2). Every pattern's extra is
under a tenth of it on satellite, so bytes and round trips do not rank the patterns; recovery from a side that forgets
does.

**Ranking (inference): P3, P4, P1, P2**; the frame container built **at the PACS from HTJ2K codestreams** if the PCS
ships its document's `c/` layout, **at the PCS by our script** (rsync's delta against a hard-linked basis) if it ships
raw frames, since that keeps "the PCS encodes". Every pattern needs the PACS's tombstones for withdrawn instances (#222)
and the PCS's fix for its leftover group files (#176 Q-U1) before a reverted correction is right.

Go deeper: §1 what is fixed · §2 the link and K · §3 the patterns, each with its events · §4 the frame container ·
§5 every pattern × every concern · §6 ranking · §7 pre-registered measurements · §8 questions · §9 sources.

## 1 · What is fixed

Decided by the owner and not reopened (design state §2–§5): the PCS decides completeness and sends a trigger; replies
and retries are required, and the PCS keeps its copy until "stored"; a late instance is merged into the series' single
`.sbnd` at the PACS by full rewrite and rename, frames contiguous in display order; metadata is applied item by item
(absent → create; hash differs → replace and audit; same → nothing). From `pcs-pacs-options.md` §2: `incoming/` holds
the PCS's tree; the receiver's steps 3–12 are unchanged; the marker file sent last is the trigger and carries the item
list; `--delete` gives no deletion at the serving tree; `-z` only on the metadata call.

The PCS's side, as read at upstream `e105214` (design state §1): its parser writes a corrected group under a new hash
name beside the old one and never deletes the old one (#176 Q-U1); its frames are raw per instance,
`<I>/G|P|R/%05d`; its document's target is per-frame HTJ2K at series level in `c/` (and TIFF bitmaps in `b/` for an AV1
stream). Which one wt-pacs follows is open (design state §1, D14). A withdrawal reaches the PCS as an IHE IOCM rejection
note, a KOS instance, and travels as a document series (#176 §13.4).

## 2 · The link and K

Links as #222 §1 assumes them: **fiber** 10 ms, 100 Mbit/s up; **satellite** 700 ms, 2 Mbit/s up (250 KB/s, a
bandwidth-delay product of 175 KB). TCP's first flight is ~14.6 KB (RFC 6928) and doubles per round trip; Linux
restarts it after idle, so a call on an idle connection pays that ramp again (*inference*).

**Round trips of one rsync call** (*estimate*, from the protocol's phases, not counted on a wire): over ssh, a fresh
connection costs ≈ 6 before rsync starts (TCP, version and key exchange, public-key authentication, a channel), then
rsync ≈ 4–5 (the exec and version exchange, the file list answered by the receiver's requests, the data, the end of
phase and goodbye). OpenSSH's connection sharing (`ControlMaster`, `ControlPersist` in ssh_config(5); not quoted here)
pays the 6 once per unit, so:

| | round trips | satellite | fiber |
| --- | ---: | ---: | ---: |
| **K**, one shared ssh connection: 6 + 4 calls × 5 | ≈ 26 | ≈ 18 s | ≈ 0.26 s |
| K, a fresh ssh per call: 4 × 11 | ≈ 44 | ≈ 31 s | ≈ 0.44 s |
| one more ssh exchange (a command and its answer) on the shared connection | ≈ 2 | 1.4 s | 20 ms |
| the package profile's U, for comparison (#222 §1) | ≈ 3 + poll | ≈ 2.1 s | 30 ms |

Plus the receiver's scan period and the sender's poll interval, settings, not protocol. K is the rsync profile's cost,
not a pattern's; M-R1 (§7) measures it. *Inference:* if it holds, it weighs on the rsync profile against the package on
satellite more than any choice in this file, and one forced ssh command that writes the marker and waits for the verdict
(`pcs-pacs-options.md` §2.3) would take two calls out of it.

**Sizes**: the median series is ct, 263 instances, 526 group files, 618 KB of metadata raw; E's snapshot 35 KB and B's
list 7 KB at zstd-1; the synthetic 2 000-instance series 116 KB and 25 KB (#223). A coded frame ≈ 264 KB, from #179's
2 000-frame `.sbnd` of 527.5 MB; a raw 512 × 512 16-bit frame is 512 KiB. **rsync's own file list** (*estimate*): an
entry per file and directory, ≈ 60 B (the 64-hex name and its attributes; the shared directory prefix is not resent),
so ≈ 790 entries and ≈ 47 KB for ct's series directory, ≈ 6 000 entries and ≈ 360 KB at 2 000 instances. Whether `-z`
compresses the file list and keeps its context across files is not read (M-R2, M-R3).

## 3 · The patterns

Every diagram ends in K's tail: `marker` (the item list, sent last), `poll`, `stored | refused`. The receiver's steps
are #163's as amended by `pcs-pacs-options.md` §1. Events: **late** (one instance after "stored", unit = an addition),
**fix** (one group corrected; unit = the exam's top level for an exam-level fix, the series otherwise, the owner's
"down to the level that changed"), **withdraw** (a KOS series referencing an instance).

### 3.1 · P1 — `incoming/` cleared, the script sends only what is new

```text
late      PCS script: sent list → new = <I>/----.<h>, <I>/priv.<h>, <I>/G/00001
          rsync -z --files-from=<new metadata>  ──▶ incoming/<unit>/
          rsync --files-from=<new frames>        ──▶                     (i) the PACS merges; (ii) see §4
          marker, poll ◀── stored → sent list += new
fix       new = --.<h'> (the name the sent list lacks) ──▶ marker ──▶ replace + audit ◀── stored
withdraw  new = the KOS series' files ──▶ marker ──▶ hide the referenced instance, write its tombstone ◀── stored
```

* **State.** PCS: the sent list (#177's per-revision records already are it). PACS: the study DB, the `.sbnd` index.
* **Bytes, round trips.** Only the new files; nothing beyond K on any event.
* **Crash.** Sender: the sent list moves only after "stored", so a crash resends; item-by-item makes it a no-op. PACS:
  the marker stays in `incoming/`, recovery restarts at step 3 (#163).
* **Weak spots** (#222 §3.1, shape A without preconditions): a lost sent list resends every series with its pixels
  (527.5 MB is 35 min on satellite); a PACS restored from backup silently lacks what the sender believes it sent; a PACS
  edit is overwritten unless the files carry the hash they replace (shape A's point 3).

### 3.2 · P2 — a mirror at the PACS, rsync into an empty `incoming/` with `--compare-dest`

rsync(1), **source**: `--compare-dest=DIR` "instructs rsync to use DIR on the destination machine as an additional
hierarchy to compare destination files against doing transfers (if the files are missing in the destination
directory). If a file is found in DIR that is identical to the sender's file, the file will NOT be transferred to the
destination directory. […] This option is typically used to copy into an empty (or newly created) directory." And:
"If a match is not found, a basis file from one of the DIRs will be selected to try to speed up the transfer."
`--copy-dest=DIR` "behaves like --compare-dest, but rsync will also copy unchanged files found in DIR to the
destination directory using a local copy"; `--link-dest=DIR` hard-links them instead. "Identical" is the quick check
unless `-c`: whether "each file's size and time of last modification match" (`--checksum`).

```text
late      rsync -z -rt <E>/<S>/ --exclude=<frames> --compare-dest=/pacs/mirror/<E>/<S>/ ──▶ incoming/<unit>/
            (the whole series' listing crosses; only <I>/----.<h>, <I>/priv.<h> land)
          frames: the mirror holds none, so the script names the event's instances (as P4)
          marker, poll ◀── stored ── then the landed files move into the mirror
fix       only --.<h'> lands (--.<h> is in the mirror, identical) ──▶ "the landed one replaces"
withdraw  the KOS series lands whole; the withdrawn instance's files stay in the mirror and are never sent again
```

* **`--compare-dest`, not `--copy-dest` or `--link-dest`**: the receiver must see only what changed; copying or linking
  the unchanged files back into `incoming/` hides the change among them and costs a copy (*inference*).
* **State.** PCS: nothing. PACS: the mirror, in the PCS's names, beside the study DB; the mirror is the hash the PCS last
  sent per item, the third value #220 and #222 §6.3 need to tell "edited here" from "behind".
* **Invariant** (*inference*): the mirror moves only after step 8. Moved before, and a crash leaves it saying "have" for
  rows the study DB lacks: never sent again, silently. Backed up with the study DB, or it lies after a restore.
* **Bytes, round trips.** The series' whole listing on every event (≈ 47 KB, ct; ≈ 360 KB at 2 000), then the changed
  files: +1.6 s / +3.5 s on satellite (two and three slow-start rounds), 25 / 60 ms on fiber. An exam-level fix lists
  the exam's top level only: ≈ 0.
* **Disk.** A 4 KiB block per group file at least: ct 526 × 4 KiB ≈ 2.2 MB against ≈ 69 MB of coded frames at #179's frame size; 2 000
  instances ≈ 16.4 MB against 527.5 MB: ≈ 3 % (*estimate*), plus an inode per file (#113: files cost 7.6× their bytes).
* **Crash.** Sender: stateless. PACS: as P1; a lost mirror resends metadata once, never frames.
* **Weak spots.** The quick check trusts mtimes: a PCS tree copied or restored with new mtimes resends every metadata
  file (correct, costly) unless `-c`, which reads "all the data in the files" on both sides. Frames cannot be found by
  the mirror.

### 3.3 · P3 — negotiated first, then `--files-from` (shape C over rsync)

```text
late      ssh pacs want <unit> < item list (every group, every instance's frames, by path → hash)
            PACS: compares with the study DB's rows and the .sbnd index; tombstoned UIDs are never wanted
          ◀── <I>/----.<h>, <I>/priv.<h>, <I>/G/00001
          rsync --files-from=<answer> (metadata -z, frames without) ──▶ incoming/<unit>/
          marker, poll ◀── stored
fix       item list ──▶ ◀── --.<h'> (the one hash the audit rows never held) ──▶ rsync ──▶ marker ◀── stored
withdraw  the KOS series: item list ──▶ ◀── all of it ──▶ rsync ──▶ marker ◀── stored; tombstone written
```

* **State.** PCS: nothing. PACS: nothing new; the answer is computed from what step 7 already writes (rows, the
  `.sbnd` index, audit rows, and a tombstone table every pattern needs).
* **Bytes, round trips.** One more ssh exchange on every event, 2 round trips, plus the list: ct 7 KB, +1.4 s on
  satellite, 20 ms on fiber; 2 000 instances 25 KB, +2.2 s, 32 ms.
* **Crash.** The answer is recomputed at every attempt, so a crash anywhere, at either end, restarts at the question.
  A file changed at the PCS between answer and rsync fails its listed hash and is refused; the resend asks again.
* **Lost sent list, restored PACS.** Nothing to lose at the PCS; a restored PACS answers with what it lacks, frames
  included, for every series the PCS triggers again (#222 §3.3's C). Untouched series need F (#222 §3.6).
* **Second writer.** The answer compares with the row's current hash, so a PACS edit reads "lacking" and the PCS's file
  overwrites it, unless the rows keep the hash the PCS last sent (#222 §6.3's `pcs_xxh3`); with it the answer is a
  three-way merge per item (*inference*).
* **Leftover group files.** #222's table gives C "Op every time" for want of a sent list; here the PACS's audit rows
  hold every hash it ever stored for an item, so "the one never stored" is the sent-list rule kept at the PACS
  (*inference*): the first correction is right; a revert is not, in every pattern.

### 3.4 · P4 — the unit's whole metadata every time (shape E), frames only for what the PACS lacks

```text
late      rsync -z <E>/<S>/ metadata (every group) + the exam group ──▶ incoming/<unit>/  (cleared)
          rsync the event's instances' frames ──▶                    (the addition names them)
          marker, poll ◀── stored | need <frames> → rsync those, marker again
fix       the same metadata call; only --.<h'> differs from its row → replace + audit
withdraw  the KOS series as a first send; every later snapshot still carries the withdrawn instance's groups,
          which its tombstone answers "nothing"
```

* **State.** PCS: which series an event touched, which the PCS's own trigger is. PACS: rows; tombstones.
* **Bytes, round trips.** #223's snapshot plus rsync's listing: ct 35 + 47 KB, +1.7 s on satellite, 27 ms on fiber;
  2 000 instances 116 + 360 KB, +4.0 s, 70 ms. Over rsync E is not #223's E: the listing is rsync's, and the snapshot
  is #223's 35 KB only if `-z` keeps its context across files (M-R3); a file alone compresses 1.6–3.2× (design state §2),
  which would make ct's metadata ≈ 190–390 KB (*estimate*). Each group is hashed at the receiver on every event (618 KB, ct).
* **Crash, lost sent list, restored PACS.** As P3, with the frames' answer arriving after the metadata, as `need`.
* **Leftover group files.** Both exam groups cross on every event; the PACS picks by the audit rule above, or the tree
  is refused (#177 refuses two at build).

## 4 · Where the series' frame container is built

| | late instance at 2 000 frames: link | PACS work | PCS work | against the decisions |
| --- | --- | --- | --- | --- |
| **(i) raw** per instance (the code at `e105214`) | 512 KiB a frame: 2.1 s satellite, 42 ms fiber | encode, then the full rewrite | none | the PACS encodes, against "the PCS encodes" |
| **(i) HTJ2K** codestreams in `c/` (the PDF) | ≈ 264 KB: 1.06 s, 21 ms | assemble: the full rewrite, 527.5 MB written and read back, 0.57–1.02 s on #179's host | none | none |
| **(i) AV1** from `b/` TIFF bitmaps | the bitmaps, uncompressed | encode; a middle insertion re-encodes a GOP, ~9–11.5 s (#179) | none | the PACS encodes |
| **(ii) built at the PCS** by our script | ≈ 264 KB + block signatures down (§4.1); without a basis, 527.5 MB: 35 min, 42 s | rsync rebuilds the file from basis + delta (a full write), then our read-back | encode if raw; the full rewrite; ×2 disk until "stored" | the merge moves to the PCS |

### 4.1 · (ii): rsync's delta needs a basis at the PACS

`incoming/` is empty, so the delta has nothing to work from unless rsync is given a basis (*inference*). The served
`.sbnd` is one, by a hard link under the PCS's relative path in a basis directory named with `--compare-dest` (P2's
mirror is that directory): "a basis file from one of the DIRs will be selected" (rsync(1)). A hard link costs no blocks,
and since publication is by rename the link keeps the old inode, so the basis is stable while the PACS serves the new
one; it costs one series' size from the merge until it is relinked at step 12 (*inference*).

* **Bytes** (*estimate*, rsync's block-size and strong-sum rules recalled from its code, not read): blocks ≈ √(file
  size), ≈ 23 KB at 527.5 MB, ≈ 23 000 of them, each a 4-byte rolling sum and a 2–16-byte strong sum: 140–460 KB
  **from the PACS to the PCS** before any data; then the new frame and the rewritten index, plus a token per matched
  block. The delta finds a middle insertion's shifted blocks "at any offset" (Tridgell and Mackerras, via #221 §3.4).
* **Disk reads**: the PACS reads the whole basis, the PCS the whole new file: 527.5 MB each per late instance.
* **The file must match.** The basis helps only as far as the served `.sbnd` matches what the PCS builds. After a
  purge of withdrawn frames, the PACS's file differs from the PCS's rebuild, and placing the PCS's file as is would bring
  the frames back: the script must leave tombstoned instances out, or the PACS keeps merging itself (*inference*).
* **AV1.** The PCS re-encodes the GOP (the PCS encodes, as decided); the delta carries the GOP's new bytes.
* **It matches the item list.** `pcs-pacs-options.md` §1's list already carries `<S>/series.sbnd` with its XXH3,
  which only (ii) produces at the PCS.

**What decides (i) against (ii)** (*inference*): the layout the PCS ships (D14). With HTJ2K in `c/`, (i): the link
carries the same frame bytes, the PACS assembles without encoding, no basis to keep, the decided merge stays at the
PACS. With raw frames, (ii): it keeps the encoding at the PCS, at the cost of a full read at both ends, the signatures
on the downlink, and the merge's logic at the PCS.

## 5 · Every pattern × every concern

| | P1 | P2 | P3 | P4 |
| --- | --- | --- | --- | --- |
| **PCS keeps** | the sent list | nothing | nothing | the events it triggered |
| **PACS keeps** | rows, `.sbnd` index | + the mirror | rows, index, audit | rows, index |
| **sender crash** | resend, no-op | rerun, no-op | ask again | rerun, no-op |
| **receiver crash** | marker in `incoming/`: from step 3 (#163), every pattern | | | |
| **lost sent list** (E8) | every series' pixels again | ✓ | ✓ | ✓ |
| **PACS restored, touched** (E10) | ✗ silently missing | ✓ if the mirror was restored with it, else ✗ | ✓ | ✓ (`need`) |
| **PACS restored, untouched** | ✗ in every pattern: only F sees it (#222 §3.6) | | | |
| **leftover group file**, first correction | ✓ "never sent" | ✓ "the one that landed" | ✓ "never stored" (audit) | ✓ "never stored" |
| **a revert** A → B → A | ✗ in every pattern until Q-U1 is fixed (#222 §6.3) | | | |
| **withdrawal**, later events | never resent: safe until E8 | never resent while the mirror holds it | listed; the tombstone says "not wanted" | resent; the tombstone says "nothing" |
| **without a tombstone** | resurrected after E8 | resurrected after a lost mirror | resurrected | resurrected |
| **second writer** (#220) | overwrites, unless the hash it replaces travels (A) | detects: the mirror is the PCS's last hash | needs `pcs_xxh3` per row | needs `pcs_xxh3` per row |
| **hash bridge** (#168 §2) | (b): the sent list keeps each file's XXH3, computed once | (a) or (b); the mirror maps BLAKE3 name → row | (b) cheapest: the PACS compares XXH3 with its rows; (a) needs a BLAKE3 column | (a) or (b), every file hashed every event |
| **`--delete`** | useless: `incoming/` is empty (`pcs-pacs-options.md` §5) | | | |
| **distance from as built** | #177's records reused | the mirror and its invariant | an answer command at the PACS | `need` in the verdict |

## 6 · Ranking (inference)

**1. P3 · 2. P4 · 3. P1 · 4. P2**, with K (§2) the same for all.

| pair | the winner | the deciding factor |
| --- | --- | --- |
| P3 vs P4 | P3 | over rsync P4 pays rsync's own listing on top of #223's snapshot, and its frames' `need` arrives a round later; P3's list is the compressed item list. A tie if M-R2 and M-R3 show the listing compressed and `-z` keeping context; then P4 by simplicity, as #223 chose E |
| P3 vs P1 | P3 | recovery from a side that forgets: P1 resends every pixel after a lost sent list and misses what a restored PACS lacks; P3's extra 1.4 s is under a tenth of K |
| P4 vs P1 | P4 | the same, at a few KB more per event |
| P1 vs P2 | P1 | P2 adds a second copy of the metadata at the PACS that must move in step with the study DB, the silent drift F exists to catch, to replace state #177 already keeps; P2 would win if a second writer exists, its mirror being the PCS's last hash for free |
| P3 vs P2 | P3 | P3 reads the PACS's real state; P2 reads a copy of it |
| P4 vs P2 | P4 | the same; both pay the listing, P2 also the mirror |
| (i) vs (ii) | the PCS's layout | `c/` HTJ2K → (i); raw → (ii), to keep "the PCS encodes" |
| any vs + F | + F | no pattern sees a series nobody triggers again (#222) |

## 7 · Pre-registered measurements (not run)

Interleave the variants; mutate every new test. Emulated links: the lab's fiber and GEO classes.

| | measures | prediction | contradicted if | decides |
| --- | --- | --- | --- | --- |
| **M-R1** | round trips and time of K: four rsync calls and a poll over ssh, shared connection and fresh, ct's series | 22–30 round trips shared, 40–48 fresh | outside either range | whether K dwarfs the patterns' extras (§2) |
| **M-R2** | bytes of rsync's file list for ct's series directory and the 2 000-instance one, with and without `-z` | 40–60 KB and 300–420 KB raw; `-z` ≤ 0.6× | outside | P2's and P4's per-event cost |
| **M-R3** | bytes of P4's metadata call with `-z` against #223's zstd-1 snapshot | ≤ 1.3× #223's 35 KB (one stream) | > 2× (per-file) | P3 vs P4 |
| **M-R4** | a late instance in the middle of a 2 000-frame `.sbnd`: bytes each way and bytes read at each end, with a hard-linked basis | ≤ 0.5 MB down, ≤ 0.3 MB up beyond the frame | either exceeded | (ii)'s cost |

## 8 · Questions (inference: this file's reasoning, for decision)

**For the owner.**

1. **P3, P4 or P1** for the rsync profile, and whether F (#222) runs under it.
2. **Where the container is built** (§4), tied to D14; (ii) moves the decided merge to our script at the PCS.
3. **The hash bridge**: P3 favours (b), the item list carrying XXH3, compared with the rows directly.
4. **A tombstone table** at the PACS: needed by P2, P3 and P4 now, by P1 after a lost sent list.
5. **`pcs_xxh3` per row**, only if a second writer exists (#220).
6. **K**: one ssh connection per unit, and a forced command that writes the marker and waits for the verdict.

**For the PCS team.**

1. Which frames ship: raw per instance, HTJ2K in `c/`, or TIFF in `b/` for AV1 (design state §1).
2. Replace or mark a corrected group file (#176 Q-U1): until then a revert is wrong in every pattern.
3. Does process (2) name an addition's instances (P4's frames; P1 without a sent list)?
4. How long the tree stays after "stored": P3's answer and P4's `need` can only ask for files still there.
5. Do the group files' mtimes survive a copy or restore of the tree (P2's quick check)?
6. May our script hold one ssh connection open per unit and call a command on it (P3, K)?

## 9 · Sources

* rsync(1), "current for version 3.5.1", fetched 2026-10-29 from
  [download.samba.org](https://download.samba.org/pub/rsync/rsync.1), the same page `pcs-pacs-options.md` §7 hashed
  (sha256 `9160de49f8f5`): `--compare-dest`, `--copy-dest`, `--link-dest`, `--checksum`, `--files-from`.
* Tridgell and Mackerras, *The rsync algorithm*, as quoted in #221 §3.4.
* RFC 6928 §2, TCP's initial window, as quoted in #222 §8.
* This repository's drafts at the commits named in the header; #113, #163, #176, #177 and #179 as the design state
  cites them.
* **Not read**: ssh_config(5) on connection sharing; rsync's code for its block size, strong-sum length, file-list
  encoding and `-z`'s context across files (M-R2–M-R4 measure what depends on them).
