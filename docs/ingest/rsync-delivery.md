# rsync delivery: which options, which trigger, what rsync verifies

*2026-10-29. **Proposed**, for the owner and the team; theory and sources only, nothing here is built or timed. A
quoted claim is **source**; **inference** and **reasoning** are this document's own. It fills the rsync row of the PCS →
PACS path ([`pcs-pacs-options.md`](pcs-pacs-options.md), #230) and does not repeat what that file, the design state
(#168, §2, §3, §20) or carriers-explained §2 (#181) settle.*

## 0 · On one screen

```text
 PCS: our script                                                  PACS (one filesystem: incoming/ and the serving root)
  │                                                                 sshd ─ forced command (ours, ~1 page)
  │ 1 data   rsync -t --files-from … EXAM_DIR/ ─ ssh ──────────────▶  ├─ "rsync --server …" → rrsync -wo -no-del incoming
  │          exit 0 = every listed file whole, its after-transfer     │      incoming/<E>/…  (dot-temp, renamed whole)
  │          checksum matched (§1); not "on disk", not "stored"       │
  │ 2 trigger ssh pacs receive <unit> < item list ─────────────────▶  ├─ "receive <unit>": write incoming/<unit>.ready
  │                                                                   │      (fsync, rename, fsync dir); wait ≤ 60 s
  │                                                                   │      for status/<unit>                ▲
  │                                                                   │   scan loop (#169) ── takes the marker ┘
  │                                                                   │      verify from disk, pack metadata into the
  │                                                                   │      study DB, move the .sbnd, read both back,
  │◀─ stdout + exit: stored 0 · refused 1 · pending 75 ───────────────┤      status/<unit>, study index, clean incoming/
  │ 3 poll   ssh pacs status <unit>   (only after "pending" or a drop) └─ "status <unit>": print status/<unit>
  stored: the PCS may drop its copy · refused: resend 1 and 2 · any other exit: retry 1 then 2, later
```

**Recommended (reasoning, §6):** two calls per unit, the trigger an ssh forced command that writes the marker and
returns the verdict, polling only as the fallback.

| option | here | use |
| --- | --- | --- |
| quick check (default) vs `--checksum` | `incoming/` starts empty; on a resend the receiver has deleted every file that failed (#230 §1) | quick check; `-t` so it works |
| after-transfer checksum | proves the copy matches what the sender read; not disk, not skipped files, not rot at the PCS (§1) | always on; pin `--cc=xxh128` |
| `--fsync` | the receiver flushes before its read-back anyway | no |
| `--delay-updates` | nothing reads before the trigger | no |
| `--partial-dir=.rsync-partial` | an interrupted `.sbnd` resumes; nothing under the real name until whole | **yes** |
| `--temp-dir` | the default temp is already on the same filesystem | no |
| `--timeout=120`; ssh `ConnectTimeout` | a stall becomes an exit; `--contimeout` is for daemons only | **yes** |
| `--compare-/--copy-/--link-dest` | the serving tree holds no group files and is not the login's to read | no |
| `--files-from` | the unit's exact files | **yes** |
| `--delete*`, `--remove-source-files` | deletes nothing useful; removes the PCS's copy before "stored" | no; refused at the PACS |
| `-z --zc=zstd --zl=1` | metadata call, limited-link profile only; zstd keeps its context across files (§2.7) | metadata only |
| `-ii` | one line per listed file, sent or unchanged | **yes** |

Go deeper: §1 what rsync verifies · §2 each option · §3 exit codes · §4 ssh or daemon · §5 the triggers compared ·
§6 the recommendation · §7 what to measure · §8 sources.

## 1 · What rsync verifies, and what it does not

**Two checks, often confused.** Before a transfer, rsync decides *whether* to send a file: "Without this option, rsync
uses a "quick check" that (by default) checks if each file's size and time of last modification match between the
sender and receiver" (rsync(1) `--checksum`). After it, rsync checks *what* it wrote: "rsync normally verifies that each
transferred file was correctly reconstructed on the receiving side by checking a whole-file checksum that is generated
as the file is transferred, but that automatic after-the-transfer verification has nothing to do with this option's
before-the-transfer "Does this file need to be updated?" check" (same).

**The algorithm is negotiated.** "When both sides of the transfer are at least 3.2.0 (released June 2020), each side
chooses its own most-preferred algorithm that also appears in the peer's list. Both sides order their lists
strongest-first, so they converge on the strongest mutual choice. … If the remote rsync is too old to support checksum
negotiation, a value is chosen based on the protocol version (which chooses between MD5 and various flavors of MD4
based on protocol age)" (`--checksum-choice`). The 3.5.1 list is `xxh128 xxh3 xxh64 md5 md4 sha1 none`, "which may
differ" per build. Pinning `--cc=xxh128` turns a silent fallback into an error: "If no common checksum choice is
found, rsync exits with an error." `none` would switch the check off: "no checksum verification is performed on the
transferred data" (same).

**What exit 0 does not prove** (*inference*, from the quotes above):

| not proved | why | who covers it |
| --- | --- | --- |
| the bytes are on disk | the checksum "is generated as the file is transferred": over the data rsync writes, not a re-read; without `--fsync` the file may still be dirty pages | the receiver: flush, drop cached pages, read back (design state §3, steps 6b and 8) |
| a file the quick check skipped is right | a skipped file is not transferred, so not verified | the receiver's per-file hash on every listed file (step 3) |
| the PCS's file was right | the sender reads a file corrupted at rest and both ends checksum the same wrong bytes | only a hash computed when the PCS wrote the file: the BLAKE3 in its name, option (a) of the hash bridge (#230 §1); (b) and (c) hash at send time and inherit the rot |
| the right files arrived | rsync copies what it is told | the item list (#230 §1) |
| an adversary did not change them | xxh128 is not a cryptographic hash | ssh's integrity on the wire |

## 2 · The options, one by one

### 2.1 `--checksum` against the quick check

"Generating the checksums means that both sides will expend a lot of disk I/O reading all the data in the files in the
transfer" (`--checksum`); the sender checksums every file during its scan, the receiver "will checksum any file that
has the same size as the corresponding sender's file". Into an empty `incoming/<E>/` nothing matches, so `-c` costs a
full read at the PCS and gains nothing. On a resend the quick check skips files that are still there: the receiver
keeps those that passed and deletes those that failed (#230 §1), and re-hashes every listed file on the next trigger,
so a skipped file is still checked. **Use the quick check, with `-t`**: without preserved times every file's
modification time differs and every file is resent (*inference*). `--ignore-times` would resend everything: it "turns
off this "quick check" behavior" (`--ignore-times`).

### 2.2 `--fsync`

"Cause the receiving side to fsync each finished file. This may slow down the transfer, but can help to provide peace
of mind when updating critical files" (`--fsync`). Here (*inference*): the receiver must flush each file before its
read-back anyway (cached pages that are dirty cannot be dropped; the verify tool does `fdatasync` then
`posix_fadvise(DONTNEED)`, design state §3), the PCS keeps its copy until "stored", and a file lost to a PACS power
cut fails the receiver's hash and is resent. `--fsync` would add one flush per group file (thousands per series) for
nothing the protocol relies on. **No.**

### 2.3 `--delay-updates`

It "puts the temporary file from each updated file into a holding directory until the end of the transfer … This
attempts to make the updating of the files a little closer to atomic"; it "implies --no-inc-recursive" and "requires
enough free disk space on the receiving side to hold an additional copy of all the updated files"
(`--delay-updates`). Atomicity comes from the trigger: nothing reads `incoming/` before it. **No.**

### 2.4 `--partial-dir` and resumption

"By default, rsync will delete any partially transferred file if the transfer is interrupted" (`--partial`).
`--partial-dir` "puts any partially transferred files into the specified DIR instead of writing the partial file out
to the destination file. On the next transfer, rsync will use a file found in this directory as data to speed up the
resumption of the transfer and then delete it"; with a relative DIR rsync "will add an exclude rule", and "the
partial-dir directory should not be writable by other users" (`--partial-dir`). From 3.2.0 on both ends the piece "is
now updated in-place instead of creating yet another tmp-file copy". **Yes, `--partial-dir=.rsync-partial`**: the
receiver's scan skips dot names (#230 §4.3). Never with `--whole-file`, which removes the piece (#181 §2). The resume's
cost (a new ssh session, a read of the piece on both sides) is §7's M1.

### 2.5 `--temp-dir`

"The default behavior is to create each temporary file in the same directory as the associated destination file" —
already the root's filesystem. On another partition rsync "must copy it into place … the destination file will contain
truncated data during this copy" (`--temp-dir`). **No.**

### 2.6 `--timeout` and `--contimeout`

"If no data is transferred for the specified time then rsync will exit. The default is 0, which means no timeout"
(`--timeout`); exit 30. `--contimeout` is "the amount of time that rsync will wait for its connection to an rsync
daemon to succeed" (`--contimeout`), so over ssh the connect timeout is ssh's (`-o ConnectTimeout=30`, with
`ServerAliveInterval` for a dead peer). **Yes, `--timeout=120`** (a stall longer than two minutes on any link class is
a failure; *reasoning*, to tune per profile). The daemon's own `timeout` "ensure[s] that rsync won't wait on a dead
client forever" (rsyncd.conf(5)).

### 2.7 `--compare-dest`, `--copy-dest`, `--link-dest`

Each makes a second tree the comparison basis: "If a file is found in DIR that is identical to the sender's file, the
file will NOT be transferred to the destination directory … typically used to copy into an empty (or newly created)
directory" (`--compare-dest`); `--copy-dest` also copies unchanged files in, `--link-dest` hard-links them. As a basis
so only new or changed files land in an empty `incoming/` (*inference*): the serving tree is the only candidate, and it
does not fit. Group files are packed into the study DB, not kept as files; the `.sbnd` sits under a different path; the
rsync login would need to read the serving tree; and a skipped file is absent from `incoming/`, so the receiver could
not tell *already stored* from *lost*. `--files-from` (below) already sends only the unit's new files. **No**, and
refused at the PACS (§4): a client-supplied `--link-dest` inside `incoming/` would let one login hard-link files there.

### 2.8 `--files-from`

It reads "the exact list of files to transfer from FILE"; `--relative` and `--dirs` are implied, `-r` is not; entries
are relative to the source directory, whose ".." components "are resolved away so an entry cannot rise above the source
directory";
"sorting the list of files in the --files-from input helps rsync to be more efficient" (`--files-from`). **Yes**, the
item list's paths, sorted, with `--from0`. "Listing individual files with --files-from does not make unlisted siblings
eligible for deletion" (same).

### 2.9 `--delete` and its variants

`--delete` deletes "extraneous files from the receiving side (those that don't exist on the sending side), but only for
the directories that are being synchronized"; `-before`, `-during` (the default), `-delay`, `-after` only change when;
`--delete-missing-args` turns a missing source argument into "a deletion request of the corresponding destination
file"; `--max-delete=0` warns without deleting (rsync(1)). In a cleared `incoming/` none has anything to delete, and
deletions in the serving tree come from the item list, never from rsync (#230 §2.5). **No**; refused at the PACS:
rrsync `-no-del` "Disable[s] rsync's --delete* and --remove* options" (rrsync(1)); a daemon module: "you probably
want to specify "refuse options = delete" for a write-only module" (rsyncd.conf(5) `write only`).

### 2.10 `-z`, `--compress-choice`, `--compress-level`, `--skip-compress`

`-z` "compresses the file data as it is sent"; the algorithm is negotiated like the checksum (`--compress`);
`--zc=zstd` pins it; for zstd "the valid values are from -131072 to 22 with 3 being the default" (`--compress-level`).
`--skip-compress` cannot keep the bundle out: "no compression method currently supports per-file compression changes,
so this option has no effect" (`--skip-compress`). So on the limited-link profile the metadata goes in one call with
`-z --zc=zstd --zl=1`, the bundle in a second without (#230 §2.7); level 1 because one zstd stream at level 1 was "as
good as any" on the parser's output (design state §2), measured outside rsync (§7, M2).

**One stream, read in the source** (rsync's `token.c`, §8): `send_zstd_token` creates its compression context once
(`if (!comp_init_done) { zstd_cctx = ZSTD_createCCtx(); …`) and, at each file's end, flushes it ("File ended, flush":
`flush = ZSTD_e_flush`) without ending or resetting it, so the context carries across the files of one call: the "one
stream" #230 §2.7 left open, for zstd. zlib does not: `send_deflated_token` calls `deflateReset(&tx_strm)` at each
file's start. **Use zstd, never zlib, for the metadata** (*inference* from the code; the ratio is M2).

### 2.11 `--remove-source-files`

It removes "the files … that are a part of the transfer and have been successfully duplicated on the receiving side"
(rsync(1)): received, not stored. **No**, for #230 §2.6's reasons; also, the PCS's tree is the PCS team's, not ours to
delete. Refused at the PACS with the `--delete*` family (rrsync `-no-del`).

### 2.12 `--itemize-changes` and `--out-format`

`-i` "is exactly the same as specifying --out-format='%i %n%L'. If you repeat the option, unchanged files will also be
output"; in a push the type letter is `<`, "a file is being transferred to the remote host (sent)", `.` "the item is
not being updated", and `+` "the file is newly created" (`--itemize-changes`). **Yes, `-ii`**: the script checks that
every path of its list appears once, as `<f` or `.f`, before it sends the trigger. `%C` ("the full-file checksum if it
is known", rsyncd.conf(5) `log format`) would add rsync's own checksum per file; whether `-ii` with a custom
`--out-format` still prints unchanged files is not stated, so it is a check at install (§7, C2), not part of the line.

## 3 · Exit codes: what the PCS's script does

rsync(1) §EXIT VALUES lists 0, 1–5, 10–16, 19–25, 30 and 35. The script's action is *reasoning*:

| exit | meaning (rsync(1)) | action |
| --- | --- | --- |
| 0 | "Success" | check the `-ii` lines, then the trigger |
| 10, 12, 30, 35 | "Error in socket I/O", "Error in rsync protocol data stream", "Timeout in data send/receive", "Timeout waiting for daemon connection" | retry with backoff; `--partial-dir` resumes |
| 11, 23 | "Error in file I/O", "Partial transfer due to error" | retry; alert after N (a full disk at the PACS lands here) |
| 24 | "Partial transfer due to vanished source files" | the tree changed after the PCS called it complete: no trigger, alert the PCS team |
| 1–5 | usage, "Protocol incompatibility", file selection, "Requested action not supported", "Error starting client-server protocol" | configuration: alert, no blind retry |
| any other (ssh's own 255) | not in the table | retry, as a drop |

No exit but 0 is followed by a trigger, so a trigger never follows a failed data call (§5).

## 4 · ssh or a daemon

| | ssh with a forced command (recommended) | daemon over ssh | plain daemon on 873 |
| --- | --- | --- | --- |
| how | `command="…"` in `authorized_keys`; ours dispatches `rsync --server` to `rrsync -wo -no-del incoming` | `command="rsync --server --daemon --config=…"` (rrsync(1)); modules | `rsync --daemon` |
| security | ssh "authenticates the peer and encrypts the connection" (rsync(1) §SECURITY) | the same | "not encrypted and its authentication is comparatively weak" (same) |
| write here, read status there | rrsync: "just one restricted dir per authorized key", so the status read is our `status` command | two modules: `incoming` with `write only = yes`, `read only = no`; `status` read only ("The default is for all modules to be read only") | the same, unencrypted |
| hooks | none: the forced command is the hook | `post-xfer exec` (§5) | the same |
| limits | — | "you may not be able to use features which require root privilege, such as chroot" (§USING RSYNC-DAEMON FEATURES VIA A REMOTE-SHELL CONNECTION) | a port to open at the hospital's edge |

rrsync `-wo` is "Allow only writing to the DIR" (rrsync(1)). rrsync passes `--confine-root` so paths "selected from a
--files-from list" cannot resolve outside its directory (rsync(1) `--confine-root`). Owed at the PACS whichever is
chosen (*inference*): the receiver accepts only regular files (an `lstat`, no symlinks) with one link, so nothing the
login left in `incoming/` keeps a path to a file moved into the serving tree; and the moved `.sbnd` still belongs to
the rsync login (rename keeps the inode), so either the receiver takes ownership or the owner accepts that (§6, open 3).

## 5 · The trigger: five mechanisms

Common ground (*inference*): the receiver hashes every listed file before doing anything (step 3), and a file exists
under its real name only when whole (dot temp names, `--partial-dir`), so **a trigger before the files are complete
can only cause a refusal, never a wrong store**. A duplicate is answered from the status or the audit row (#169).

| mechanism | crash at the PCS | crash at the PACS | duplicate trigger | trigger before complete | how the reply gets back |
| --- | --- | --- | --- | --- | --- |
| **marker file by a second rsync**, the scan loop takes it | before the marker: files wait in `incoming/`; the rerun skips them by the quick check | rsync writes temp and renames, without a directory flush: a power cut can lose the marker; the poll finds nothing and the PCS resends it | the same name rewritten; the receiver answers from the status | refused by step 3; resend | a second login or module to read `status/` (rrsync is one directory per key) |
| **`post-xfer exec`** (daemon) | the hook runs anyway: it "is still run even if one of the other scripts returns an error code"; `RSYNC_EXIT_STATUS` is "the server side's exit value … an error that occurs on the client side does not currently get sent to the server side" | the hook dies with the daemon: it must write a durable record first, a marker by another name | fires after *every* call, the data calls too: it cannot know which call completes the unit without a marker | it cannot tell | none: "The other programs cannot send any text to the user" (rsyncd.conf(5)) |
| **ssh forced command `receive <unit>`** (recommended) | the marker is written (fsync, rename, fsync directory) before the wait; a drop loses only the wait; the rerun is idempotent | ssh drops; the PCS reruns `receive`, which finds the marker or the status | idempotent by unit and revision | refused by step 3 | the command's stdout and exit; `status <unit>` after "pending" or a drop |
| **inotify on the marker** | — | events are not queued while the receiver is down | — | — | none of its own |
| **HTTPS call** | idempotent `POST` by unit | the same as the command | the same | the same | in the response, or polled |

inotify is a wake-up, not a trigger: "the event queue can overflow. In this case, events are lost", and "Inotify
monitoring of directories is not recursive" (inotify(7)). It can shorten the scan delay on `IN_MOVED_TO` (rsync and the
command both rename); the scan stays the record. Worth adding only if the scan interval matters next to the verify's
own seconds (design state §3: ~1 s per 500 MB read back, estimated). The HTTPS call needs a second channel and a second
identity for an rsync profile (#230 §2.3); only if HTTPS stays for something else.

## 6 · Recommended (reasoning)

```text
# 1 data. Limited-link profile: run twice, the groups with "-z --zc=zstd --zl=1", the bundle without.
rsync -t --files-from=UNIT.list --from0 --partial-dir=.rsync-partial --timeout=120 --cc=xxh128 -ii \
      -e 'ssh -i KEY -o BatchMode=yes -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=4' \
      EXAM_DIR/ pacs:<E>/

# 2 trigger, only after exit 0 and every listed path seen in the -ii lines
ssh -i KEY -o BatchMode=yes -o ConnectTimeout=30 pacs receive <E> <S> <revision> < UNIT.items
#   stdout "stored" exit 0: drop the copy · "refused <why>" exit 1: resend 1 and 2 · "pending" exit 75 or a drop:
#   ssh … pacs status <E> <S> <revision>, with backoff
```

Why the forced command (*reasoning*): it is the marker option with the reply folded in. The marker stays the durable
record and the scan loop stays the only processor (#169's two programs joined by files are kept: the command writes one
file and reads one); the PCS learns a quick verdict without a poll; one key and one login give write-only data and the
status, which rrsync alone cannot (one directory per key). Its cost: a page of shell at the PACS that parses
`SSH_ORIGINAL_COMMAND` and refuses all else, so it needs tests and mutations. If the team wants nothing of ours at
the PACS but rrsync: the marker by a second rsync and a status pulled by rsync (#230's default), at the price of two
keys.

**Open for the owner:** (1) the 60 s wait and the exit codes; (2) the hash bridge, which also decides whether rot at
rest at the PCS is caught (§1); (3) whether the receiver takes ownership of the moved `.sbnd` (`fchown`, a privilege)
or copies it instead of moving it; (4) cleaning `incoming/`: a file another pending marker lists stays (two units of one
study share the exam group).

## 7 · To measure (pre-registered, not run)

Rules (CLAUDE.md): variants interleaved; latency quoted, not throughput; where the host saturates said; the read-back
forced through the store's test levers, never by page-cache eviction.

| | question | setup | prediction | decides |
| --- | --- | --- | --- | --- |
| M1 | a resumed `.sbnd`: bytes and time | the median and largest series; cut at 50 % on emulated links (fiber, ADSL, satellite RTT); `--partial-dir` against none, interleaved | resent ≈ the rest plus block checksums; one extra handshake | keep `--partial-dir` if resent ≤ 0.6 × size |
| M2 | `-z --zc=zstd` across files | the groups of #154's series: bytes on the wire at `--zl=1` and `3` against one standalone zstd stream | within 10 % of the one stream (§2.10) | the level; if far off, pack the metadata first |
| M3 | per-file cost of thousands of groups | `--files-from` with N files at RTT 50 and 600 ms | near-flat in RTT (pipelined, design state §2) | whether the item list should carry fewer, larger files |
| M4 | verdict latency | trigger to "stored", median and largest series, receiver as built | under 60 s for the median | the wait in `receive` |

Checks at install, not measurements: **C1** `--debug=nstr` between the PCS's and the PACS's actual rsync shows the
checksum and compression negotiated; **C2** whether `-ii` with `--out-format='%i %l %C %n'` still lists unchanged files
and prints `%C`; **C3** rrsync refuses `-H`, `--link-dest` and `-l` from the client, else the forced command does.

## 8 · Sources

* rsync(1), rsyncd.conf(5) and rrsync(1), "current for version 3.5.1", fetched 2026-10-29 from
  [download.samba.org](https://download.samba.org/pub/rsync/rsync.1),
  [rsyncd.conf.5](https://download.samba.org/pub/rsync/rsyncd.conf.5) and
  [rrsync.1](https://download.samba.org/pub/rsync/rrsync.1) (sha256 `9160de49f8f5`, `52281a0b6b93`, `95c8d722aa79`; the
  first two the same pages #230 read).
* rsync's `token.c`, [master](https://github.com/RsyncProject/rsync/blob/master/token.c), fetched 2026-10-29 (sha256
  `818b767b4451`): `send_zstd_token`, `send_deflated_token`.
* inotify(7), [man7.org](https://man7.org/linux/man-pages/man7/inotify.7.html), fetched 2026-10-29.
* [`pcs-pacs-options.md`](pcs-pacs-options.md) at `e5a7c78` (#230): §1, §2.3–§2.7, §4.3.
* The design state, `pacs-receive-design.md` on `claude/pacs-design-state` at `abf645a` (#168): §2, §3, §20.
* carriers-explained §2 on `claude/carriers-explained` at `0f71b1b` (#181).
