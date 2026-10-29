# The PCS → PACS path as parts and options

*2026-10-28. **Proposed** throughout: a skeleton for the owner's review of its structure, before any part is filled in
by a row of its own. Theory only; nothing here is built or timed for it. **Decided** marks the owner's decisions, dated,
as the design state records them (#168, §7 below). A quoted claim is **source**; **inference** is this document's own
reasoning, read nowhere.*

**Why it exists.** The team meeting of 2026-10-28 reopened rsync for the PCS → PACS path, after the meeting of
2026-10-24 had agreed one package per transfer. Meetings change such choices, so the path is laid out as parts, each
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

**The hash bridge** (open, 2026-10-28; for the owner, none decided). rsync copies the PCS's tree as is, so group files
arrive named by BLAKE3 (64 hex), while our sender (`carrier/sender/src/tree.rs`, #177) and receiver (#163) check 16-hex
XXH3 names. Options: **(a)** the receiver verifies the PCS's BLAKE3 names, and the study DB keeps XXH3 as decided;
**(b)** our trigger script at the PCS computes each file's XXH3 and puts it in the item list; names stay BLAKE3 and the
receiver checks contents against the list; **(c)** our script makes an XXH3-named copy before rsync (extra disk at the
PCS). The rsync profile is incomplete until one is chosen (design state §2).

**What the receiver changes for a tree** (*inference*, against #163 as built): the trigger's arrival is step 1; step 3
checks each listed file instead of one package hash; step 4 reads a tree instead of a tar; step 6 copies the listed
files into `.work` (or hard-links them: one filesystem) instead of extracting. A refusal also deletes every listed file
that failed its hash, so the next rsync's quick check ("checks if each file's size and time of last modification
match", rsync(1) `--checksum`) cannot skip a damaged copy of the same size and time. On a crash every marker still in
`incoming/` starts again at step 3, as every package does now. Steps 6b–12 do not change.

## 2 · The parts

### 2.1 Delivery: what crosses as one unit

| option | how it works | good at | costs | what decides | cost of switching |
| --- | --- | --- | --- | --- | --- |
| **tar package** (default; built, #177) | our sender packs the unit into one pax tar (header, `metadata`, bundle) named by its XXH3; the receiver checks it and extracts it into staging | one file to keep, check and resend whole; built and tested | a build and an outbox copy at the PCS; differs from pcs.pdf's wording | whether the team accepts a package of ours at the PCS | the receiver keeps steps 4–12; the sender's build goes unused |
| **rsync of the tree** (default if rsync) | rsync copies the unit's files from the exam directory into `incoming/<E>/`; a marker sent last completes it | stock tools; what pcs.pdf proposes; files pipelined; an interrupted file resumes | no single file to keep and resend; TCP only; a trigger and a reply to add (§3) | the team's preference | receiver steps 1–6 read a tree (§1); the sender's records reused, its build not |
| **per-file HTTPS** | each file sent to the PACS over HTTPS, then a completion call with the item list | one protocol for files, trigger and reply; QUIC possible | a request per file (thousands per series) unless pipelined; nothing built | only if HTTPS stays and a package is refused | a new endpoint in the carrier |

pcs.pdf, verbatim (design state §1): "we are thinking to use some kind of rsync which triggers server side a script
processing of the data for each file copied".

**With rsync, what `incoming/` keeps after "stored"** (*inference*; an option inside this one):

| option | how it works | good at | costs |
| --- | --- | --- | --- |
| **cleared** (default if rsync) | the sender names the unit's files: `--files-from` reads "the exact list of files to transfer from FILE" (rsync(1)), from the records #177 keeps of what each revision carried | no second copy at the PACS | the sender keeps a sent list (it does already) |
| **a mirror** of the PCS's tree | rsync's quick check finds what changed by itself | the sender keeps nothing | the PACS holds every group and bundle twice |

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

### 2.4 Reply

**Decided 10-26:** replies and retries are required; rsync's exit 0 means *received and checked*, not *stored*. The
words (`stored`/`refused`/`quarantined` in #163, `committed`/`refused` in #164) and where the status file lives are
open (design state §14, D3).

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
the receiving side (those that don't exist on the sending side)" (rsync(1)). But that reaches only `incoming/`: the
serving tree's deletions come from the item list, never from rsync (*inference*).

How a late instance, a correction and a withdrawal travel over rsync, four patterns ranked: [`rsync-updates.md`](rsync-updates.md).

### 2.6 The PCS's copy

**Decided 10-24:** the PCS keeps each unit until "stored" and resends on "refused". The sender deletes its copy after
reading "stored" (package profile: the outbox package). Never `--remove-source-files`, which removes "the files … that
are a part of the transfer and have been successfully duplicated on the receiving side" (rsync(1)): received, not
stored, so too early on corruption at rest, a full disk at staging or a receiver bug (#180). In the rsync profile the
PCS's tree is the copy; whether the PCS clears it after "stored" is the PCS team's.

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
trigger, and the receiver hashes every file and `fsync`s its own staging (*inference*).

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
* **`--delete`** gives no deletion semantics at the serving tree (§2.5); in a cleared `incoming/` it removes nothing
  useful.
* **`-z` on the bundle** compresses frames again, against **Decided** 10-26.
* **The PCS's tree under our checks** (*corrected 2026-10-28*): rsync delivers BLAKE3-named groups, while our sender and
  receiver check XXH3 names; the rsync profile does not combine until the hash bridge (§1) is chosen.

## 6 · Open with the team

1. **Delivery:** the package (agreed 10-24) or rsync of the tree (10-28)? §4.3 keeps both sides' built code.
2. **The trigger's form and the item list's format**; who writes the list (our sender, or the PCS's process 2).
3. **`incoming/` cleared or a mirror** (§2.1): bytes on the link against disk at the PACS.
4. **The reply's words and place** (D3) and the poll interval; who deletes the status file.
5. **ssh or a daemon**, and one login per PCS for the audit's "who".
6. **Compression restated for rsync** (§2.7): the 10-26 decision was written for the package.
7. **The synchronization shape**, once the four SYNC rows report (reported 2026-10-28: #220–#223, §2.5).
8. **The hash bridge** (§1): the receiver checks BLAKE3 names, the item list carries XXH3, or an XXH3-named copy.
9. **For the PCS team:** where an addition's bundle comes from (added frames only, or the series again); the corrected
   group written beside the old one (#176).

## 7 · Sources

* rsync(1) and rsyncd.conf(5), "current for version 3.5.1", fetched 2026-10-28 from
  [download.samba.org](https://download.samba.org/pub/rsync/rsync.1) and
  [its config page](https://download.samba.org/pub/rsync/rsyncd.conf.5) (sha256 of the pages `9160de49f8f5`,
  `52281a0b6b93`): §SECURITY, §USING RSYNC-DAEMON FEATURES VIA A REMOTE-SHELL CONNECTION, `--checksum`, `--delete`,
  `--remove-source-files`, `--files-from`, `--compress`, `--skip-compress`, `--timeout`, `--partial-dir`,
  `--delay-updates`, `--fsync`; `early exec, pre-xfer exec, post-xfer exec`. Older quotes are #181's, at 3.4.4.
* The design state, `docs/ingest/pacs-receive-design.md` at `f8b0bb2a` (#168): §1, §2, §3, §5, §14.
* `docs/ingest/carriers-explained.md` at `ef480679` (#181): §2 rsync, §11's table.
* `docs/adr/pcs-transfer.md` §15 at `3ea13d37` (#177): the sender as built.
* `docs/adr/pacs-receiver.md` at `c66f0d06` (#163), and its `pending()` scan in `ingest/receiver/src/lib.rs` at
  `c66f0d06`.
* #164 (the carrier, `9bb1c534`), #169 (the process map), #170 (the verdict), #171 and #182 (QUIC and the seam), #180
  (a reply is needed): as the design state cites them.
* [`link.md`](link.md): why the link is TCP.
