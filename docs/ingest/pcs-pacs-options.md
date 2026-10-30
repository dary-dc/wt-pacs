# The PCS → PACS path as parts and options

*2026-10-28. **Proposed** throughout: a skeleton for the owner's review of its structure, before any part is filled in
by a row of its own. Theory only; nothing here is built or timed for it. **Decided** marks the owner's decisions, dated,
as the design state records them (#168, §7 below). A quoted claim is **source**; **inference** is this document's own
reasoning, read nowhere.*

**Why it exists.** The team meeting of 2026-10-28 proposed rsync for the PCS → PACS path, where we had chosen one
package per transfer (*corrected 2026-10-29:* this said a meeting of 2026-10-24 had agreed the package; the team never
did: it was our own search for good options, approved by the owner). Meetings change such choices, so the path is laid out as parts, each
with a few options, how each works, what it costs and a favoured default. Every option offered combines into a complete
configuration (§4), so a meeting can move between options and still leave with one that works. *Corrected 2026-10-28:*
not yet: the rsync profile is incomplete until the hash bridge (§1) is chosen.

## 0 · On one screen

```text
            a choice per part (§2)                       the seam                ours, invariant (design state §3)
                                                            │
 the PCS's exam tree ─ delivery ─ transport ─▶  incoming/<E>/<S>/…            ──▶  3   check every listed item's hash
 (hash-named groups,   tar ·       rsync ·      the unit as the PCS's tree     │    6   stage in incoming/<unit>.work/, fsync
  series.sbnd)         rsync ·     HTTPS ·          +                          │    6b  read back from disk
                       per-file    QUIC later   a completion record:           │    6c  place by rename
                                                the trigger, carrying the      │    7–8 one transaction, read back
                                                item list (coded path → hash)  │    11  status: stored | refused
                                                            │                  │
 the PCS keeps its copy  ◀──────────── reply: stored | refused (§2.4) ◀───────┘
 until "stored"
```

**The seam (Proposed).** The receiver's input is *a completed unit in `incoming/` as the PCS's directory tree, plus a
completion record*: the trigger, carrying the unit's item list. Everything after it is ours and does not change with
the options: check, stage, read back from disk, place by rename, one transaction, status (design state §3). Everything
before it is a choice per part. A package is one way to deliver the unit (extracted into staging); an rsync of the tree
is another (copied into `incoming/`).

| part | default: the *package* profile, as built | default if the team keeps rsync: the *pcs.pdf* profile |
| --- | --- | --- |
| delivery (§2.1) | tar package (#177) | rsync of the tree, `incoming/` cleared after "stored" |
| transport (§2.2) | HTTPS resumable, draft-14 (#164) | rsync over ssh |
| completion and trigger (§2.3) | the package's arrival by rename | a marker file sent last |
| reply (§2.4) | polled over HTTPS (#164, #170) | a status file pulled back by rsync |
| synchronization (§2.5) | proposed: the five points (design state D12); built: D (the revision log) until the owner decides; results: #220–#223 | the same |
| PCS copy (§2.6) | kept until "stored" (**Decided** 10-24) | the same; never `--remove-source-files` |
| compression (§2.7) | metadata as one zstd stream on the limited-link profile (**Decided** 10-26) | `-z` on the metadata call only |
| identity (§2.8) | mutual TLS pinned per site (#164) | an ssh key and a restricted login per PCS |

Why the package profile is the default until the team says otherwise (*inference*): it is built and tested on
loopback end to end (#163, #164, #177), it keeps one file to keep and resend whole, and it is the only profile that can
move to QUIC. Choosing rsync makes the right-hand column the complete configuration; §4.3 is a bridge between the two.

## 1 · The seam

**The unit** is what the PCS declares complete: a series, an addition (late instances, **Decided** 10-26), or an
update. **The PCS decides completeness** (**Decided** 10-26), so the trigger is its "complete" crossing the link.

**The item list** (Proposed; format open) names every file the unit delivers, by its path in the PCS's tree, with its
hash (*corrected 2026-10-28:* this said XXH3; which hash is open, the hash bridge below):

```text
study  <E>                        coded study UID
unit   <S>                        coded series UID
kind   series | addition | update
--.<h>               <h>
<S>/---.<h>          <h>
<S>/<I>/----.<h>     <h>
<S>/series.sbnd      <xxh3-64 of the file>
```

The group files are already named by their hashes, so the list's work is to say *which* files make the unit (a stray,
or an old group the parser leaves beside a corrected one, #176, does not slip in) and to carry the bundle's hash. In
the package profile the package is that record: its members' names, its header, and its own XXH3 in its name.

*Added 2026-10-29 (owner):* the receiver reads what is what from the tree itself (coded-UID folders, group names); it
must know the PCS's layout either way, so the list adds nothing there. Its remaining work comes from three PCS
behaviours, each changeable: (1) a corrected group beside the old one (#176 Q-U1), so the tree holds both; (2) rsync
copies file by file, so a tree changed during a sync arrives mixed; (3) frame files carry no hash. If the PCS fixes (1),
syncs a quiet or snapshotted tree, and names frames by hash, the list shrinks to the trigger's "ready" (§4.4).

**The hash bridge** (open, 2026-10-28; for the owner, none decided). rsync copies the PCS's tree as is, so group files
arrive named by BLAKE3 (64 hex), while our sender (`carrier/sender/src/tree.rs`, #177) and receiver (#163) check 16-hex
XXH3 names. Options: **(a)** the receiver verifies the PCS's BLAKE3 names, and the study DB keeps XXH3 as decided;
**(b)** our trigger script at the PCS computes each file's XXH3 and puts it in the item list; names stay BLAKE3 and the
receiver checks contents against the list; **(c)** our script makes an XXH3-named copy before rsync (extra disk at the
PCS). The rsync profile is incomplete until one is chosen (design state §2). *Recommended 2026-10-28 night, awaiting
the owner:* **(a)**. The PCS computes its BLAKE3 when the parser writes the file, so checking those names is the only
check that catches corruption at rest at the PCS as well as on the wire; (b) and (c) hash at send time, so they would
hash already-damaged bytes and approve them (*inference*). XXH3 stays wt-pacs's hash for what wt-pacs writes (study DB,
`.sbnd`). **Gap:** the PCS's frame files in its code (`<I>/G|P|R/%05d`, raw) carry no hash in their name, so a frame
damaged at rest at the PCS goes undetected; the PDF's target names frames by hash (§2.9, design state §15).

**What the receiver changes for a tree** (*inference*, against #163 as built): the trigger's arrival is step 1; step 3
checks each listed file instead of one package hash; step 4 reads a tree instead of a tar; step 6 copies the listed
files into `.work` (or hard-links them: one filesystem) instead of extracting (*corrected 2026-10-28 night:* or not
at all; the order proposed in §2.3 reads the files back in `incoming/` and renames them from there). A refusal also
deletes every listed file that failed its hash, so the next rsync's quick check ("checks if each file's size and time
of last modification match", rsync(1) `--checksum`) cannot skip a damaged copy of the same size and time. On a crash
every marker still in `incoming/` starts again at step 3, as every package does now. Steps 6b–12 do not change.

## 2 · The parts

### 2.1 Delivery: what crosses as one unit

| option | how it works | good at | costs | what decides | cost of switching |
| --- | --- | --- | --- | --- | --- |
| **tar package** (default; built, #177) | our sender packs the unit into one pax tar (header, `metadata`, bundle) named by its XXH3; the receiver checks it and extracts it into staging | one file to keep, check and resend whole; built and tested | a build and an outbox copy at the PCS; differs from pcs.pdf's wording | whether the team accepts a package of ours at the PCS | the receiver keeps steps 4–12; the sender's build goes unused |
| **rsync of the tree** (default if rsync) | rsync copies the unit's files from the exam directory into `incoming/<E>/`; a marker sent last completes it | stock tools; what pcs.pdf proposes; files pipelined; an interrupted file resumes | no single file to keep and resend; TCP only; a trigger and a reply to add (§3) | the team's preference | receiver steps 1–6 read a tree (§1); the sender's records reused, its build not |
| **per-file HTTPS** | each file sent to the PACS over HTTPS, then a completion call with the item list | one protocol for files, trigger and reply; QUIC possible | a request per file (thousands per series) unless pipelined; nothing built | only if HTTPS stays and a package is refused | a new endpoint in the carrier |

pcs.pdf, verbatim (design state §1): "we are thinking to use some kind of rsync which triggers server side a script
processing of the data for each file copied".

**Owner 2026-10-28 night, where rsync writes:** only into `incoming/`, never the serving tree ("it will pollute the
prod dir"); `incoming/` on the serving root's filesystem, so moving a file into place is a rename. rsync hides each file
under a temporary name until it is whole, and `--delay-updates` renames a run's files together at its end, "a little
closer to atomic" (rsync(1)).

**With rsync, what `incoming/` keeps after "stored"** (*inference*; an option inside this one):

| option | how it works | good at | costs |
| --- | --- | --- | --- |
| **cleared** (default if rsync) | the sender names the unit's files: `--files-from` reads "the exact list of files to transfer from FILE" (rsync(1)), from the records #177 keeps of what each revision carried | no second copy at the PACS | the sender keeps a sent list (it does already) |
| **a mirror** of the PCS's tree | rsync's quick check finds what changed by itself; with `--delete`, deletions too (§4.4) | the sender keeps nothing; no item list once the PCS's tree shows its current state | metadata twice at the PACS (≈ 3 % of coded frames, #234); frames twice unless hard-linked or excluded |

### 2.2 Transport

| option | how it works | good at | costs | what decides | cost of switching |
| --- | --- | --- | --- | --- | --- |
| **rsync over ssh** (default if rsync) | rsync starts its peer through ssh with the PCS's key; one TCP connection | the remote shell "authenticates the peer and encrypts the connection" (rsync(1) §SECURITY); `--partial-dir` resumes | TCP only; ssh's channel window caps one connection on a long fat path (#181 §3); a stall is seen only with `--timeout`: "The default is 0, which means no timeout" | the team's choice of rsync | sshd and a restricted login at the PACS |
| **rsync daemon** | `rsync --daemon` on port 873, a module per PCS | daemon hooks (`post-xfer exec`, §2.3); no ssh window | "not encrypted and its authentication is comparatively weak" (rsync(1) §SECURITY), unless spawned over ssh as "a single-use 'daemon' server" | whether a daemon hook is wanted | a config file; over ssh, the same login |
| **HTTPS resumable, draft-14** (default; built, #164) | `HEAD` for the offset, `PATCH` from it; one-shot on the same endpoint; mutual TLS | built, 17 tests; reply on the same channel; the seam to QUIC (#182) | our carrier runs at the PACS; carries one file, not a tree | delivery = package | the carrier and `send-package.sh` replaced |
| **QUIC, later** (#171, #182) | the same draft-14 on one quinn stream, chosen at build (#182's S1) | the sender picks its congestion controller | not built; #182: TCP with BBR first, quinn only if > 20 % ahead in a pre-registered run | that run, on a real site's link class | a build feature; owner 10-26: chosen at build is accepted |

### 2.3 Completion and trigger

| option | how it works | good at | costs | what decides | cost of switching |
| --- | --- | --- | --- | --- | --- |
| **marker file sent last** (default if rsync) | after the tree's rsync exits 0, a second rsync sends `<unit>.ready` holding the item list; rsync writes a temporary name and renames it whole; the receiver's scan loop (#169) takes it | trigger, item list and durable record in one; survives a crash at either end (it stays in `incoming/` until done); nothing on the PACS listens | a second call (a second ssh session); a scan interval of delay | — | a name pattern in the receiver's scan |
| **`post-xfer exec`** | the daemon runs a program after each transfer, `RSYNC_EXIT_STATUS` set | no second call | daemon only; runs after failed transfers too (`RSYNC_EXIT_STATUS` is "a positive value for an error that the server generated"); "an error that occurs on the client side does not currently get sent to the server side" and "The other programs cannot send any text to the user" (rsyncd.conf(5)); the hook must write a durable record anyway (*inference*: a marker by another name) | whether a daemon is run | a hook script |
| **ssh command `receive <unit>`** | a forced command that allows rsync and `receive`; it records the trigger, then waits for the verdict | can return the verdict when processing is quick | a wrapper of ours on the forced command; a slow verdict still needs §2.4 | how long a verdict takes | a script at each end |
| **HTTPS call** | `POST` the item list to the PACS | the same channel as an HTTPS reply | files over ssh, control over HTTPS: two channels, two identities | only with an HTTPS reply | an endpoint |
| **arrival by rename** (default; built) | the carrier renames `<f>.partial` to `<f>` when whole; the package's existence declares completeness (#149) | built; nothing to add | package delivery only | delivery = package | — |

**After the trigger, the rsync profile's order** (proposed 2026-10-28 night; it corrects the owner's sketch, which
deleted the metadata files before the checks): read the frame container back from disk in `incoming/` → rename it into
the serving tree → one transaction writing the metadata into the study DB → read the rows back from disk → "stored" →
study index (retried; never undoes) → clean `incoming/` last, so most failures retry locally. Frames before metadata,
so a viewer never sees metadata for pixels not in place (design state §3).

### 2.4 Reply

**Decided 10-26:** replies and retries are required; rsync's exit 0 means *received and checked*, not *stored*. The
words (`stored`/`refused`/`quarantined` in #163, `committed`/`refused` in #164) and where the status file lives are
open (design state §14, D3).

**What "checked" covers** (proposed reading 2026-10-28 night): "rsync normally verifies that each transferred file was
correctly reconstructed on the receiving side by checking a whole-file checksum that is generated as the file is
transferred" (rsync(1)); the algorithm is auto-negotiated (the xxHash variants lead its list; `--checksum-choice`). It
replaces our package hash for the wire. It does **not** prove the bytes on the PACS disk (checked during the write,
before the page cache is flushed; `--fsync` flushes but does not read back), so the read-back from disk (**Decided**
10-25) stays; nor the files the quick check (size + mtime) skips; nor corruption at rest at the PCS (§1, the bridge).

| option | how it works | good at | costs | what decides | cost of switching |
| --- | --- | --- | --- | --- | --- |
| **status file pulled back by rsync** (default if rsync) | the receiver writes `status/<unit>`; the PCS polls `rsync pacs:status/<unit>` until a final word | no new channel; the same login | each poll a session (*inference*) | transport = rsync | a script at the PCS |
| **polled over HTTPS** (default; built, #164, #170) | the PCS reads the status resource until a final word | built; works after any drop | a poll interval of delay | transport = HTTPS | — |
| **`Prefer: wait=20`** (RFC 7240) | the completing request waits up to 20 s for the verdict; polling after | a quick verdict without a poll | HTTPS only; not built | slow vs quick verdicts | a header in the carrier |

### 2.5 Synchronization semantics

What a unit means against what is stored. The shapes under study (theory, results from `claude/sync-prior-art`,
`claude/sync-shapes`, `claude/sync-second-writer`, `claude/sync-b-vs-e`; *corrected 2026-10-28:* this said pending; they
reported as #221, #222, #220 and #223):

* **A**, five points: only changes, each with the hash it replaces (design state §5); fewest bytes; breaks if the sender
  loses its sent list or the PACS is restored from backup.
* **B**, the full list plus changed bytes: absence from a complete list is a deletion.
* **C**, negotiated, git-like: the two ends compare before sending; the sender keeps nothing; one more round trip.
* **D**, the revision log, as built (#163, #177): `(unit, revision)` in order. *Corrected 2026-10-28:* the default is
  proposed: the five points (design state D12); built: D (the revision log) until the owner decides; results: #220–#223.
* **E**, a full snapshot: everything, applied item by item; the sender keeps nothing.
* **F**, a periodic per-study hash comparison: a repair layer under any of the others.

#223 (measured bytes, times estimated) compared B with E: B is 3.1–3.5× smaller for the median series, E at most 0.81 s
slower; by the pre-registered rule, the verdict is E. Reported, not decided.

The trigger's item list is B's and E's list: with it, the trigger and the shape become one message (*inference*). rsync
itself behaves like C: it exchanges a file list and compares, and `--delete` deletes by absence, "extraneous files from
the receiving side (those that don't exist on the sending side)" (rsync(1)). *Corrected 2026-10-29 (owner):* this said
that reaches only `incoming/`, so deletions must come from the item list. That holds only for a cleared `incoming/`;
into a kept mirror, rsync carries deletions itself and `-i` names each one, which the receiver applies to the study DB
and the serving tree (§4.4).

**Late instances and corrections under rsync** turn on what rsync compares against at the PACS: P1 our script sends
only what is new (a sent record at the PCS); P2 a mirror of the received metadata at the PACS and `--compare-dest` into
an empty `incoming/`; P3 negotiated (the item list over ssh, the PACS answers what it lacks, `--files-from`, then the
trigger); P4 the full metadata each time (E), frames only for instances the PACS lacks. Leaning P3 or P4, by reasoning;
row RSYNC-2 (`claude/rsync-updates`) works them through, crossed with §2.9.

### 2.6 The PCS's copy

**Decided 10-24:** the PCS keeps each unit until "stored" and resends on "refused". The sender deletes its copy after
reading "stored" (package profile: the outbox package). Never `--remove-source-files`, which removes "the files … that
are a part of the transfer and have been successfully duplicated on the receiving side" (rsync(1)): received, not
stored, so too early on corruption at rest, a full disk at staging or a receiver bug (#180). In the rsync profile the
PCS's tree is the copy; whether the PCS clears it after "stored" is the PCS team's.

**Resends under rsync** (owner 2026-10-28 night: no resend is needed for what rsync verifies; proposed): wire errors are
rsync's own, which retries a file that fails verification within the run (the manual does not state it plainly; row
RSYNC-1, `claude/rsync-options`, checks it). A resend from the kept copy remains a rare fallback, for bad bytes on the
PACS disk or a crash that loses `incoming/`; most processing failures retry locally if `incoming/` is cleaned last
(§2.3). The copy is still kept until "stored", as a safety net.

### 2.7 Compression

**Decided 10-26:** only metadata is compressed, as one stream, on the limited-link profile; frames never. The package
profile does it as built (one zstd frame in `metadata`, told by its magic). With rsync, `-z` "compresses the file data
as it is sent" and cannot spare the frames: `--skip-compress` notes "no compression method currently supports per-file
compression changes, so this option has no effect" (rsync(1)). So the bundle goes in a call without `-z` (*inference*).
Whether `-z`'s stream keeps its context across files, as "one stream" asks, is not read here; to check before claiming.

### 2.8 Identity and security

| option | how it works | good at | costs |
| --- | --- | --- | --- |
| **ssh key per PCS** (default if rsync) | one login per PCS, sshd's `ForceCommand` and `ChrootDirectory` (#181 §2) | stock; the login names the sender | an sshd account per PCS at the PACS |
| **mutual TLS pinned per site** (default; built, #164) | the carrier pins each site's certificate | built; the certificate names the sender | our carrier |
| rsync daemon `auth users` | a module password | — | "comparatively weak" (rsync(1) §SECURITY); only over ssh |

Either names the sender for the audit row's "who" (#163's ADR §7, question 7, open).

### 2.9 Who builds the `.sbnd` under rsync

Proposed 2026-10-28 night as a part; it ties delivery to the layout question (design state §14, D14).

| option | how it works | good at | costs | what decides |
| --- | --- | --- | --- | --- |
| **our script at the PCS, before the rsync** (as §4.1 draws it) | the bundle is built at the PCS and crosses as `<S>/series.sbnd` | the PACS only checks and places; one file per series to verify | our code runs at the PCS; on layout A it encodes the PCS's raw frames | whether our code may run at the PCS beyond the sender |
| **the PACS, from the PCS's frame files** | rsync copies the frame files; the receiver assembles the `.sbnd` | nothing of ours builds at the PCS | layout A (the code: raw `<I>/G\|P\|R/%05d`): the PACS would encode, against "the PCS encodes" (10-24); layout B (the PDF: HTJ2K codestreams in `c/`): it only assembles, and the frames' hash names (`00001.blake3` in the PDF's diagram) can be checked | D14, and the PCS team's answer on frame hashes |

## 3 · Corrected: completeness is not an argument against rsync

The records counted the completeness signal as a reason for one file (design state §2, "Why one file", 10-25). The
owner, 10-28: "we just need to let the pacs know that it can start processing now, and precisely that's what we can use
the trigger for." Agreed: the PCS decides completeness (**Decided** 10-26), the trigger carries it, nothing is processed
before it, and staging plus one rename already publish atomically. Completeness, atomic placement and "one thing to
process" do not favour the package. What rsync really costs (*inference*):

1. **No single file to keep and resend whole.** A resend is the files plus the trigger; a damaged file is resent only
   if the receiver deletes it on refusal (§1) or the PCS runs `--checksum`, which reads "all the data in the files" on
   both sides.
2. **TCP only.** #182 recommends TCP with BBR on limited links anyway, so this costs only the QUIC option, not built.
3. **A trigger and a reply to add** (§2.3, §2.4): small, and the reply is needed by every transport.

## 4 · Profiles

### 4.1 "As pcs.pdf writes it"

| part | option |
| --- | --- |
| delivery | rsync of the tree, `incoming/` cleared after "stored" |
| transport | rsync over ssh: `--files-from`, `--partial-dir`, `--timeout` |
| trigger | marker file with the item list, sent last |
| reply | status file pulled back by rsync |
| PCS copy | kept until "stored" |
| compression | `-z` on the metadata call; the bundle without |
| identity | ssh key, restricted login |

```text
PCS: our sender                                          PACS
 |-- rsync -z --files-from=<new groups> EXAM_DIR/ ------->| incoming/<E>/…   (temporary names, renamed whole)
 |-- rsync --partial-dir=… <S>/series.sbnd -------------->| incoming/<E>/<S>/series.sbnd
 |<-- exit 0: received and checked ----------------------|
 |-- rsync <unit>.ready (the item list) ----------------->| incoming/<unit>.ready
 |                                                        | scan loop: marker → steps 3–12
 |-- rsync pacs:status/<unit>  (poll) ------------------->|
 |<-- stored | refused -----------------------------------|
 stored: done · refused: resend files and marker
```

`--fsync` and `--delay-updates` ("a little closer to atomic", rsync(1)) are not needed: nothing is read before the
trigger, and the receiver flushes and reads every file back from disk itself (§2.3; *inference*).

**Each rsync option, the five triggers and what rsync verifies:** [`rsync-delivery.md`](rsync-delivery.md) (2026-10-29,
proposed: the marker written by an ssh forced command that also returns the verdict).

**Built code:** #177's sender keeps its allow list and refusals at build, the records of what each revision carried
(now the `--files-from` list and the item list), its idempotent call and exit codes; its tar build, zstd member and
`send-package.sh` go unused; the rsync calls and the poll are a new script. #163's receiver keeps steps 6b–12, R and
recovery and changes steps 1–6 (§1). #164's carrier is unused; the PACS runs sshd instead.

### 4.2 "Package", as built

| part | option |
| --- | --- |
| delivery | tar package, layout 2 (#177) |
| transport | HTTPS resumable, draft-14, TCP (#164) |
| trigger | the package's arrival by rename |
| reply | polled over HTTPS |
| PCS copy | the outbox package, kept until "stored" |
| compression | `metadata` as one zstd frame on the limited-link profile |
| identity | mutual TLS pinned per site |

```text
PCS: sender --profile P EXAM_DIR S           PACS: carrier                       receiver
 build the package, keep it in the outbox
 |-- create + upload (draft-14, mTLS) ------->| incoming/<f>.partial
 |<-- final response: received --------------| rename → incoming/<f>  ───────▶ scan: steps 3–12
 |-- GET status (poll) ---------------------->| ◀──── status file ─────────────┘
 |<-- committed | refused --------------------|
 committed: delete the outbox package · refused: resend the kept bytes
```

**Built code:** all of it. Owed before it fits (design state §14): one reply vocabulary and place (D3), the audit
row's "who", one study-DB schema (D1).

### 4.4 A kept mirror of the PCS's tree

*Proposed 2026-10-29, the owner's model; theory only.* rsync as it is meant: a directory kept in step with the PCS's
exam directory. Neither #233 nor #234 compared it: both send into a cleared `incoming/` (#234's P2 keeps a mirror but
sends changes into an empty `incoming/` with `--compare-dest`, so deletions do not travel).

| part | option |
| --- | --- |
| delivery | `rsync -a --delete --max-delete=N -ii EXAM_DIR/ pacs:mirror/<E>/`, the mirror kept between units |
| where | `mirror/` on the serving root's filesystem, outside the serving tree: rsync never writes where the server reads |
| trigger | still needed: "the tree is consistent now" (§3); a forced command or a marker (§2.3) |
| what changed | the receiver compares the mirror with what it applied, or reads the `-ii` lines the script forwards with the trigger |
| reply, PCS copy, compression, identity | as §4.1 |

```text
PCS: our script (exam quiet or snapshotted)              PACS
 |-- rsync -a --delete --max-delete=N -ii EXAM_DIR/ ---->| mirror/<E>/…   new, changed, deleted
 |-- receive <unit> ------------------------------------>| reconcile: the study DB and the serving tree made to
 |                                                        |   match mirror/<E>/ (steps 3–12, item by item)
 |<-- stored | refused | pending -------------------------|
```

rsync(1), 3.5.1: `--delete` removes "extraneous files from the receiving side (those that don't exist on the sending
side), but only for the directories that are being synchronized"; with `-i`, "the "%i" will output the string
"*deleting" for each item that is being removed"; `--max-delete=NUM`: past NUM "all further deletions are skipped
through the end of the transfer", exit code 25.

**What it removes** (*inference*): the sent list (P1), the negotiation call (P3), the full metadata resend (P4), and
most of the item list (§1): after a completed sync the mirror is the PCS's state. A crash, a lost sent list or a PACS
restored from backup heals by reconciling again or by the next sync, which sends only what differs, as long as the
mirror is restored with the study DB.

**What it needs from the PCS** (§6):

1. **Its exam tree stays the record** while updates can come. `--delete` turns "absent at the PCS" into "deleted at
   the PACS": a PCS that clears its tree after "stored" (§2.6 allows it) deletes the PACS's copy at the next sync.
   `--max-delete` limits the damage, not the risk.
2. **The tree shows the current state.** Today a corrected group stays beside the old one (#176 Q-U1), and a
   withdrawal arrives as an IOCM rejection note, a KOS, which adds files and removes none. Until that changes the
   mirror holds both versions and only a list (§1) says which is current.
3. **A consistent tree during the sync:** the PCS leaves the exam alone while it syncs, or syncs a snapshot; the
   trigger then says when. The receiver never applies a half-synced mirror.
4. **Hashes for frame files** (§1, the gap); without them frames rest on rsync's wire check and our read-back.

**What it costs at the PACS** (*estimate*, #234 P2): the metadata twice, ≈ 3 % of the coded frames in 4 KiB blocks,
plus an inode per file. Frames: a `.sbnd` that crosses as a file (§2.9, first row) can be hard-linked into the serving
tree (one filesystem, no blocks); if the PACS builds the `.sbnd` from frame files, the mirror holds them twice or
excludes them (`--exclude`, which also keeps them from `--delete`) and they travel by `--files-from` as in §4.1. The
mirror and the study DB are backed up and restored together. Comparing the mirror (BLAKE3 names) with the study DB
(XXH3) needs the PCS's name per row, or the bridge's option (a) (§1).

### 4.3 Package over rsync (a bridge)

The tar package delivered by rsync over ssh, the reply a status file pulled back. rsync writes a temporary name and
renames it when whole ("creating a new copy of the file and moving it into place when it is complete", rsync(1)
`--inplace`), so the arrival by rename still triggers; #163's scan already skips names starting with `.` (read in its
code), and a `--partial-dir` piece is a directory. It reuses the sender's build and the receiver unchanged, replaces
only the carrier and `send-package.sh`, and keeps one file to keep and resend whole. It costs QUIC (*inference*).

## 5 · What does not combine

* **A tree over draft-14**: one upload carries one file; a tree is per-file HTTPS.
* **`post-xfer exec`** needs the daemon (over ssh, or unencrypted).
* **A status file pulled by rsync** needs an ssh login; **`Prefer: wait`** needs HTTPS.
* **Arrival by rename** as the trigger needs a package; a tree needs a marker, a command or a call.
* **QUIC** is for HTTPS only; rsync is TCP only.
* **`--remove-source-files`** contradicts "kept until stored" (**Decided** 10-24).
* **`--delete`** in a cleared `incoming/` removes nothing useful (*corrected 2026-10-29:* this said it gives no
  deletion semantics at the serving tree; into a kept mirror it does, §4.4).
* **A kept mirror** (§4.4) with a PCS that clears its tree after "stored": the next sync deletes the PACS's copy.
* **`-z` on the bundle** compresses frames again, against **Decided** 10-26.
* **The PCS's tree under our checks** (*corrected 2026-10-28*): rsync delivers BLAKE3-named groups, while our sender and
  receiver check XXH3 names; the rsync profile does not combine until the hash bridge (§1) is chosen.

## 6 · Open with the team

1. **Delivery:** the package (our choice, approved by the owner on 10-24; *corrected 2026-10-29:* this said "agreed")
   or rsync of the tree (the team's proposal, 10-28)? §4.3 keeps both sides' built code.
2. **The trigger's form and the item list's format**; who writes the list (our sender, or the PCS's process 2).
3. **`incoming/` cleared or a kept mirror** (§2.1, §4.4): decided by the PCS's answers: is its exam tree kept as the
   record, does it show the current state (Q-U1, withdrawals), can it sync a quiet or snapshotted tree, will frames
   carry hashes.
4. **The reply's words and place** (D3) and the poll interval; who deletes the status file.
5. **ssh or a daemon**, and one login per PCS for the audit's "who".
6. **Compression restated for rsync** (§2.7): the 10-26 decision was written for the package.
7. **The synchronization shape**, once the four SYNC rows report (reported 2026-10-28: #220–#223, §2.5).
8. **The hash bridge** (§1): the receiver checks BLAKE3 names, the item list carries XXH3, or an XXH3-named copy;
   recommended (a), awaiting the owner.
9. **For the PCS team:** where an addition's bundle comes from (added frames only, or the series again); the corrected
   group written beside the old one (#176); whether frame files will carry their hash (§1, the gap).
10. **Who builds the `.sbnd`** (§2.9), with the layout A/B (D14); and late instances under rsync, P1–P4 (§2.5).

## 7 · Sources

* rsync(1) and rsyncd.conf(5), "current for version 3.5.1", fetched 2026-10-28 from
  [download.samba.org](https://download.samba.org/pub/rsync/rsync.1) and
  [its config page](https://download.samba.org/pub/rsync/rsyncd.conf.5) (sha256 of the pages `9160de49f8f5`,
  `52281a0b6b93`): §SECURITY, §USING RSYNC-DAEMON FEATURES VIA A REMOTE-SHELL CONNECTION, `--checksum`, `--delete`,
  `--remove-source-files`, `--files-from`, `--compress`, `--skip-compress`, `--timeout`, `--partial-dir`,
  `--delay-updates`, `--fsync`, `--checksum-choice`, `--compare-dest`; `early exec, pre-xfer exec, post-xfer exec`.
  Older quotes are #181's, at 3.4.4.
* The design state, `docs/ingest/pacs-receive-design.md` at `f8b0bb2a` (#168): §1, §2, §3, §5, §14.
* `docs/ingest/carriers-explained.md` at `ef480679` (#181): §2 rsync, §11's table.
* `docs/adr/pcs-transfer.md` §15 at `3ea13d37` (#177): the sender as built.
* `docs/adr/pacs-receiver.md` at `c66f0d06` (#163), and its `pending()` scan in `ingest/receiver/src/lib.rs` at
  `c66f0d06`.
* #164 (the carrier, `9bb1c534`), #169 (the process map), #170 (the verdict), #171 and #182 (QUIC and the seam), #180
  (a reply is needed): as the design state cites them.
* [`link.md`](link.md): why the link is TCP.
