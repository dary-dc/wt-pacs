# How each carrier works — one package from the PCS to the PACS over TCP

*2026-10-26. A learning document: theory only, read from the official sources listed in §12, nothing built or timed
for it. It answers the owner's request of 2026-10-26 — "the options will need to be characterized a bit better so I
can get to understand how they work" — for a TCP carrier that is **resumable, fast, simple, and has a reply channel**.
It explains; it does not choose. The comparison and the current recommendation are [`link.md`](link.md) §11, and the
built carrier is §12 there. Labels as there: a claim with a quote or a section number is **source**; **estimated** is
arithmetic from stated assumptions; **inference** is reasoning, not read anywhere.*

## Contents

0. [The words, and the four questions](#0-the-words-and-the-four-questions)
1. [What TCP gives every option, and what it does not](#1-what-tcp-gives-every-option-and-what-it-does-not)
2. [rsync, over ssh and as a daemon](#2-rsync-over-ssh-and-as-a-daemon)
3. [SFTP and SCP](#3-sftp-and-scp)
4. [A plain HTTPS PUT or POST, retried whole](#4-a-plain-https-put-or-post-retried-whole)
5. [HTTP byte ranges on PUT](#5-http-byte-ranges-on-put)
6. [The IETF resumable upload, draft-14](#6-the-ietf-resumable-upload-draft-14)
7. [tus 1.0](#7-tus-10)
8. [S3-style multipart upload](#8-s3-style-multipart-upload)
9. [DICOM C-STORE with Storage Commitment](#9-dicom-c-store-with-storage-commitment)
10. [DICOMweb STOW-RS, and its Storage Commitment Service](#10-dicomweb-stow-rs-and-its-storage-commitment-service)
11. [Against the owner's four requirements](#11-against-the-owners-four-requirements)
12. [Sources](#12-sources)

## 0. The words, and the four questions

* **Package**: the one file the PCS sends for a series or a study, tens of MB to a few GB
  ([`../glossary.md`](../glossary.md); ADR [`../adr/pcs-transfer.md`](../adr/pcs-transfer.md) §4).
* **Sender** is the PCS, in the hospital; **receiver** is the PACS. The sender always opens the connection: a hospital
  lets connections out far more readily than in ([`link.md`](link.md) §3).
* **A drop**: the connection dies or stalls mid-package — a cable, a router restart, a mobile or radio link fading.
* **Resume**: after a drop, send only what the receiver lacks. The alternative is **retry whole**: send it all again.
* **The reply**: what the PACS tells the PCS about the package. The ADR's §7 names three: *received* (the bytes are
  in), *committed* (the PACS has made it its own; the PCS may delete its copy), *refused* (with a reason). A **reply
  channel** is any way for these to reach the PCS on connections the PCS opens.

Each option below is told in the same order: **how it works** (a sequence diagram, time running downwards), **on a
drop**, **the reply**, **what the PCS installs**, **what we build and run**, **standard and maturity**, **on a long fat
or lossy path**, **authentication and encryption**.

## 1. What TCP gives every option, and what it does not

Every option here rides on TCP, so three facts hold for all of them.

**TCP's acknowledgement is not the application's.** TCP confirms bytes reached the receiver's kernel, not that a
program read them, wrote them to disk or accepted them. The IETF draft says it outright: "Data might have been
delivered and acknowledged at the transport layer without yet being reflected in the offset" (draft-14 §4.1). So
every option needs its own answer at the application level, and the options differ mainly in how much answer they
give.

**One TCP connection is limited by its window.** A sender may have at most one window of unacknowledged data in
flight per round trip, so

```
rate  ≤  window / RTT
```

Without the window-scale option the window is at most 64 KiB: "For LFN paths where the bandwidth * delay product
exceeds 64 KiB, the receive window limits the" rate (RFC 7323 §1.1; "LFN" is a long fat network); with it, up to
"2^30 = 1 GiB" (RFC 7323 §2.3). Linux's defaults and what a site host raises are [`link.md`](link.md) §4. **A
protocol on top can add a second, smaller window**: SSH does (§3), and then that one decides.

**Loss caps one connection, and parallel connections lift the cap.** Mathis et al. model a long-running
loss-based TCP connection as

```
rate  ≈  (MSS / RTT) × C / √p          C = √(3/2) ≈ 1.22, p = the packet-loss rate
```

"The model predicts the bandwidth of a sustained TCP connection subjected to light to moderate packet losses"
(Mathis et al. 1997, Abstract and Eq. 3). With 1 460-byte segments (*estimated*, Reno-style loss response; Cubic and
BBR, [`link.md`](link.md) §4, respond to loss differently):

| RTT | p = 0.01 % | p = 0.1 % |
| --- | --- | --- |
| 50 ms | ~29 Mbit/s | ~9 Mbit/s |
| 150 ms | ~10 Mbit/s | ~3 Mbit/s |

N connections each get their own window and their own share, so on a lossy path that is not full, N streams move
about N times one (*inference* from the same model). **Whether an option can split one package across several
connections** is therefore what "fast on a lossy long path" mostly comes down to, together with the congestion
controller ([`link.md`](link.md) §4–§6). Each section below says whether it can.

## 2. rsync, over ssh and as a daemon

rsync was written to bring a file up to date over a slow link by sending only what differs (Tridgell and Mackerras,
the rsync technical report). Over ssh it runs as `rsync file pacs:dir/` and starts its peer through ssh; as a daemon
the PACS runs `rsync --daemon`, which "typically use[s] TCP port 873" (rsync(1) §CONNECTING TO AN RSYNC DAEMON).

### The delta algorithm, in plain words

The receiver has an old file B, the sender a new file A. In the report's five steps (§The rsync algorithm):

1. The receiver "splits the file B into a series of non-overlapping fixed-sized blocks of size S bytes".
2. For each block it computes "a weak 'rolling' 32-bit checksum … and a strong 128-bit MD4 checksum" (today's rsync
   negotiates stronger ones: rsync(1) §SECURITY, "Use strong checksums").
3. It sends these checksums to the sender.
4. The sender slides a window over A, byte by byte, looking for blocks with the same two checksums — cheap because the
   weak checksum "rolls": the next position's value comes from the previous one plus one byte in, one byte out
   (§Rolling checksum).
5. The sender returns "a sequence of instructions for constructing a copy of A. Each instruction is either a
   reference to a block of B, or literal data."

**For a new package there is no B**, so every byte goes as literal data; the algorithm pays only after a drop, when
the piece already received serves as B (below). `--whole-file` turns it off: "This option disables rsync's
delta-transfer algorithm" (rsync(1) `--whole-file`).

### How it works

```
PCS (sender)                                        PACS (receiver)
 |-- TCP + ssh handshake, key login ------------------>|  (daemon: TCP to 873, a module password)
 |-- start the peer: "rsync --server …" -------------->|
 |<========= exchange: file list, protocol version ====>|
 |<-- block checksums of any basis file (none: new) ---|
 |-- literal data ------------------------------------>|  written to .pkg.tar.XXXXXX
 |-- whole-file checksum ----------------------------->|  receiver compares
 |                                                     |  rename .pkg.tar.XXXXXX -> pkg.tar
 |<-- end of run ---------------------------------------|
exit status 0 on the PCS: the file is there and checked
```

**What the receiver sees, and when.** By default rsync is "creating a new copy of the file and moving it into place
when it is complete" (rsync(1) `--inplace`), and the copy has a hidden name: with `--temp-dir` "temp-file names …
will not be prefixed with an extra dot, though they will still have a random suffix added" (`--temp-dir`), so
without it they are a dot, the name and a random suffix, in the destination directory. A program watching that
directory sees the real name only once the file is whole and checked: "rsync normally verifies that each transferred
file was correctly reconstructed on the receiving side by checking a whole-file checksum" (rsync(1) `--checksum`). Not on disk for sure, though: that needs `--fsync`.

### On a drop

By default "rsync will delete any partially transferred file if the transfer is interrupted" (`--partial`). Three
ways to keep it, each with a different picture at the receiver:

| option | where the piece waits | the next run | what a watcher sees |
| --- | --- | --- | --- |
| `--partial` | under the **final name**: the daemon's `refuse options` exist "to disallow the overwriting of destination files with a partial transfer" (`--partial-dir`) | uses it as basis B: the delta algorithm finds its blocks, so only the rest is sent | an incomplete file under the real name — a watcher must not trust names |
| `--partial-dir=DIR` | in DIR, "instead of writing the partial file out to the destination file"; rsync "will use a file found in this directory as data to speed up the resumption of the transfer and then delete it" (`--partial-dir`) | the same, and from 3.2.0 on both ends the piece "is now updated in-place instead of creating yet another tmp-file copy" | nothing under the real name until complete — "the safer idiom" (`--partial-dir`) |
| `--append-verify` | the file under its final name, shorter than the sender's | sends only the tail, "except that all the data in the file is included in the checksum verification"; "can be dangerous if you aren't 100% sure that all the files in the transfer are shared, growing files" (`--append`, `--append-verify`) | as `--partial` |

Two costs of a resume (*inference* from the steps above): a new TCP and ssh handshake, and, with `--partial` or
`--partial-dir`, reading the whole piece on both sides to compute and match block checksums. `--whole-file` must not
be combined with them: "any partial-dir files … will simply be removed" (`--partial-dir`). **A stall is not a drop**:
rsync notices one only with `--timeout`, whose "default is 0, which means no timeout" (`--timeout`).

### The reply

**rsync has none beyond its exit status.** Exit 0 means *received and checked*; nothing in rsync can say
*committed* or *refused*, which happen later. The daemon can run a program after each transfer, `post-xfer exec`,
with `RSYNC_EXIT_STATUS` set — but "The other programs cannot send any text to the user" (rsyncd.conf(5) `pre-xfer
exec`, `post-xfer exec`); only `pre-xfer exec`, before the transfer, can refuse it with a message. So the commitment
needs a second channel: the PCS fetching a status file back over the same ssh, or an HTTPS status endpoint the PCS
polls (ADR §3; [`link.md`](link.md) §11.3d) (*inference* that either works).

### What the PCS installs, what we build and run

* **PCS:** rsync and an ssh client (or rsync alone, for the daemon), a key, a script around them, and the second
  channel's client.
* **PACS:** sshd with one restricted login per PCS — sshd's `ForceCommand` runs a fixed command "ignoring any command
  supplied by the client", and `ChrootDirectory` confines it (sshd_config(5)); or the daemon with one module and
  `auth users` per PCS. Then a watcher on the landing directory that ignores rsync's temporary names, and the second
  channel (*inference*: the ADR §3 counts this as two mechanisms where an HTTP upload is one).

### Standard and maturity

No IETF standard: rsync's own protocol, defined by its code, negotiated between versions ("The client and server
automatically negotiate the newest protocol they both support", rsync(1) §Protocol version). Decades of use; 3.4.x
current.

### On a long fat or lossy path

One file, one TCP connection: rsync has no way to split a file across connections (*inference*: no such option in
rsync(1)). Over ssh it inherits ssh's channel window as well (§3). The checksums of a resume add a round trip and a
read of the piece; on a fresh package with `--whole-file` none of that happens.

### Authentication and encryption

Over ssh, the remote shell "authenticates the peer and encrypts the connection"; a daemon connection "is not
encrypted and its authentication is comparatively weak" — its password check is a challenge–response whose "digest
negotiation is itself unauthenticated" (rsync(1) §SECURITY; rsyncd.conf(5) §AUTHENTICATION STRENGTH). The daemon
can be wrapped in TLS (`rsync-ssl`) or reached through ssh (rsync(1) §USING RSYNC-DAEMON FEATURES VIA A REMOTE-SHELL
CONNECTION).

## 3. SFTP and SCP

SFTP is a file-access protocol that runs inside an ssh connection: open a remote file, write bytes at an offset,
close, rename. OpenSSH implements "revision 3 of the SSH filexfer protocol described in"
draft-ietf-secsh-filexfer-02, and "Newer versions of the draft will not be supported" (OpenSSH `PROTOCOL`). **SCP
today is SFTP**: "Since OpenSSH 9.0, scp has used the SFTP protocol for transfers by default" (scp(1)); the legacy
SCP protocol, selected by `-O`, has no resume.

### How it works

```
PCS (sftp client)                                   PACS (sshd + sftp-server)
 |-- TCP + ssh handshake, key login ------------------>|
 |-- open the "sftp" subsystem ------------------------>|
 |-- SSH_FXP_OPEN pkg.tar.part (create, write) ------->|
 |<-- SSH_FXP_HANDLE -----------------------------------|
 |-- SSH_FXP_WRITE id=1 offset=0      32 KiB ---------->|
 |-- SSH_FXP_WRITE id=2 offset=32768  32 KiB ---------->|   up to 64 requests in flight
 |<-- SSH_FXP_STATUS id=1 OK ---------------------------|
 |               …                                     |
 |-- SSH_FXP_CLOSE ----------------------------------->|
 |-- rename pkg.tar.part -> pkg.tar ------------------->|   (a separate request, if the script asks)
```

Each write names its offset ("`offset` is the offset (in bytes) from the beginning of the file where to start
writing") and "The server responds to a write request with a SSH_FXP_STATUS message" (filexfer-02 §6.4). `sftp`
keeps "64 outstanding requests" of a "default … 32768 bytes" buffer (sftp(1) `-R`, `-B`).

**What the receiver sees, and when:** the file grows under whatever name the client opened, byte by byte. There is
no temporary name unless the sender's script uploads to one and renames it at the end (*inference*; OpenSSH adds a
`posix-rename@openssh.com` extension for an atomic rename, `PROTOCOL` §4.3).

### On a drop

`reput` — "Resume upload of local-path. Equivalent to put with the -a flag set" — and `-a`: "Attempt to continue
interrupted transfers rather than overwriting existing partial or complete copies of files. If the partial contents
differ from those being transferred, then the resultant file is likely to be corrupt" (sftp(1)). The client learns
the remote size and writes from there (*inference* from the protocol: filexfer-02 has no other way than a stat).
Nothing checks the bytes already there; the package's own hash in its name (ADR §4, §6) would have to.

### The reply

Per write, `SSH_FXP_STATUS`: the bytes were written. Nothing about the package as a whole. *committed* and
*refused* need a second channel, as for rsync: a status file the PCS reads back with `get` on the same login, or an
HTTPS poll (*inference*).

### What the PCS installs, what we build and run

* **PCS:** an OpenSSH client (`sftp` in batch mode, `-b`), a key, a script.
* **PACS:** sshd with `internal-sftp`, a chrooted login per PCS (sshd_config(5) `ChrootDirectory`, `ForceCommand`), a
  watcher that waits for the final name, and the reply channel (*inference*).

### Standard and maturity

The SSH transport is standard (RFC 4251–4254); SFTP is not: draft-02 expired in 2002 and the IETF never finished it
(filexfer-02 header, "Expires: April 1, 2002"). It is universal in practice (*inference*).

### On a long fat or lossy path

One TCP connection, plus **SSH's own window**: "The window size specifies how many bytes the other party can send
before it must wait for the window to be adjusted" (RFC 4254 §5.2). OpenSSH's default session window is 64 × 32 KiB =
2 MiB (`channels.h`, `CHAN_SES_WINDOW_DEFAULT`), and sftp's 64 × 32 KiB of requests is the same 2 MiB, so one upload
reaches at most ~335 Mbit/s at 50 ms and ~112 Mbit/s at 150 ms whatever TCP allows (*estimated* from rate ≤
window / RTT, §1). Several sftp sessions, each writing its own part of the file at its own offsets, are possible
(*inference*: writes carry offsets); `sftp` itself does not do it.

### Authentication and encryption

SSH's: the server's host key, the client's key, the connection encrypted (RFC 4251; scp(1): "uses the same
authentication and provides the same security as a login session").

## 4. A plain HTTPS PUT or POST, retried whole

The simplest web upload: one request carries the whole package; the response says what happened.

### How it works

```
PCS (curl)                                          PACS (an HTTPS endpoint)
 |-- TCP + TLS handshake (client certificate) ------->|
 |-- PUT /packages/<name>                             |
 |   Content-Length: 107 000 000                      |
 |   [the whole package] ----------------------------->|  written to a temporary file
 |                                                    |  hash checked, fsync, rename
 |<-- 201 Created  (or 202 Accepted) -----------------|
 |-- GET /packages/<name>   (repeated) -------------->|
 |<-- 200 "committed" / "refused …" ------------------|
```

**What the receiver sees, and when:** whatever its handler does. If it writes to a temporary name and renames on the
last byte, nothing appears until the package is whole (*inference*; that is what [`link.md`](link.md) §12.1 builds).

### On a drop

Start again from byte 0. PUT is safe to repeat: "Idempotent methods are distinguished because the request can be
repeated automatically if a communication failure occurs before the client is able to read the server's response"
(RFC 9110 §9.2.2). POST is not idempotent by definition; the package's name, which carries its hash, makes a repeat
harmless if the server treats a second identical name as the same package (ADR §4) (*inference*). The cost of
starting again grows with the package and with how often the link drops: under 5 % extra while a package's send
time stays under a tenth of the mean time between drops ([`link.md`](link.md) §11.2, *estimated*).

### The reply

**Yes, the response itself.** 202 fits *received*: "the request has been accepted for processing, but the
processing has not been completed" — and since "There is no facility in HTTP for re-sending a status code from an
asynchronous operation" (RFC 9110 §15.3.3), *committed* or *refused* come from a `GET` on the package that the PCS
repeats until it has an answer (*inference*: the ADR §7 model).

### What the PCS installs, what we build and run

* **PCS:** curl (or libcurl), a client certificate, ~20 lines of script ([`link.md`](link.md) §11.1, *estimated*).
* **PACS:** an HTTPS endpoint with one route for the upload and one for the status; the TLS listener.

### Standard and maturity

HTTP semantics, RFC 9110 (an Internet Standard); TLS 1.3, RFC 8446. Universal.

### On a long fat or lossy path

One request, one TCP connection; §1's limits apply as they stand. Nothing splits the package (*inference*).

### Authentication and encryption

TLS: the server's certificate, and either a client certificate (mutual TLS, [`link.md`](link.md) §12.3) or a token
in a header.

## 5. HTTP byte ranges on PUT

HTTP has byte ranges for **downloads**: `Range` on a `GET` asks for part of a file. For uploads the obvious mirror —
`PUT` with `Content-Range: bytes 50000000-106999999/107000000` — exists only half-way.

### What RFC 9110 says

* `Range` is for reading: "For this specification, GET is the only method for which range handling is defined", and
  a server "MUST ignore a Range header field received with a request method that is unrecognized or for which range
  handling is not defined" (RFC 9110 §14.2).
* **Partial PUT** (§14.5): "Some origin servers support PUT of a partial representation when the user agent sends a
  Content-Range header field … though such support is inconsistent and depends on private agreements with user
  agents." A server that does not support it "SHOULD respond with a 400 (Bad Request)". And the danger: "Partial PUT
  is not backwards compatible with the original definition of PUT. It may result in the content being written as a
  complete replacement for the current representation" — an old server could silently replace the package with its
  tail.
* The RFC's own advice: target "a separately identified resource" or use "a different method that has been
  specifically defined for partial updates (for example, the PATCH method defined in [RFC5789])" (§14.5). That is
  exactly the road §6 and §7 take; the IETF draft opens by citing these caveats (draft-14 §1).

### How it would work, and what is missing

```
PCS                                                 PACS (a server that agreed to this)
 |-- PUT /packages/<name>  [bytes 0 …] -------------->|   … drop at ~50 MB
 |-- ??? how much do you have? ---------------------->|   no standard question
 |-- PUT /packages/<name>                             |
 |   Content-Range: bytes 50000000-106999999/107000000|
 |   [the rest] -------------------------------------->|
 |<-- 200 / 204 ---------------------------------------|
```

**On a drop:** the sender must learn how much arrived, and **no standard request asks it** (*inference*: RFC 9110
defines none for an upload in progress). A `HEAD` returning the partial file's length would be a private agreement,
which is what §6 and §7 standardise. **The reply:** the response, as in §4. **PCS:** curl can send any header. **We
build:** §4's endpoint plus the private offset convention. **Standard:** the header is standard; its use on PUT is,
in RFC 9110's word, "inconsistent". **Long fat or lossy:** as §4; several range PUTs in parallel would be possible
only by private agreement (*inference*). **Authentication and encryption:** as §4.

## 6. The IETF resumable upload, draft-14

*draft-ietf-httpbis-resumable-upload-14, October 2026: an HTTP working-group draft, not yet an RFC. The carrier on
this branch builds it ([`link.md`](link.md) §12).*

The idea: the server keeps an **upload resource** — a separate address for "the upload in progress" — that knows its
**offset**, "the number of bytes from the representation data that have been processed" (§4.1). Five steps, each one
HTTP request: create, ask the offset, append, complete, cancel.

### Message by message

**1. Creation (§6).** "A client can start a resumable upload from any request that can carry content by including
the Upload-Complete header field … Any method that allows content can be used, such as POST, PUT, and PATCH" (§6.1).
Two ways:

* *optimistic*: send the whole package at once with `Upload-Complete: ?1`; the server may answer early with an
  interim `104 Upload Resumption Supported` carrying the upload's `Location` (§17.1). If the server cannot send 104s,
  the upload works but cannot resume.
* *careful*: an empty request with `Upload-Complete: ?0` first, to learn the address "at the cost of an additional
  round trip" (§6.1); "best suited if the client cannot receive interim responses … or if large representations are
  transferred" (§17.2). This is what [`link.md`](link.md) §12 builds.

```
PCS                                                  PACS
 |-- POST /packages/<name>                            |
 |   Upload-Draft-Interop-Version: 10                 |
 |   Upload-Complete: ?0                              |
 |   Upload-Length: 107000000      (no content) ----->|
 |<-- 201 Created                                     |
 |    Location: /uploads/<name>/<token>               |
 |    Upload-Limit: max-size=…  ----------------------|
```

**2. Append (§8).** `PATCH` with the media type `application/partial-upload`, the offset the client believes, and
whether this is the last piece:

```
 |-- PATCH /uploads/<name>/<token>                    |
 |   Upload-Offset: 0                                 |
 |   Upload-Complete: ?1                              |
 |   Content-Type: application/partial-upload         |
 |   [the package from byte 0] ---------------------->|  … drop at ~50 MB
```

When the connection breaks the server "SHOULD append as much of the patch document as possible", and keeps it: the
offset "MUST NOT decrease" (§8.2, §4.1).

**3. Offset retrieval (§7).** On the next attempt the client asks:

```
 |-- HEAD /uploads/<name>/<token> ------------------->|
 |<-- 204 No Content                                  |
 |    Upload-Offset: 50003968                         |
 |    Cache-Control: no-store ------------------------|
 |-- PATCH …  Upload-Offset: 50003968                 |
 |   Upload-Complete: ?1                              |
 |   [bytes 50003968 … end] ------------------------->|
```

"Using HEAD is RECOMMENDED"; the response "MUST include the offset" and "SHOULD include … no-store" (§7.1, §7.2).

**4. Completion (§8.2).** The last `PATCH` carries `Upload-Complete: ?1`. Once it is all in, "the server SHOULD
generate the response that matches what the target resource of the initial upload creation request … would have
generated" — that is, the **package's** answer, not the upload's — and it "MUST include the Upload-Complete header
field set to true".

```
 |<-- 202 Accepted   Upload-Complete: ?1   "received" |
 |-- GET /packages/<name>   (repeated) -------------->|
 |<-- 200 "committed" / "refused retry …" ------------|
```

**5. Cancellation (§9).** `DELETE` on the upload: "an indication that the client is no longer interested in
continuing the upload".

### On a drop

`HEAD`, then `PATCH` from the offset: a reconnect plus about one round trip (*inference*). The rules are written out:
409 "with the correct offset"; 5xx "can be retried"; "If no final response was received at all due to connectivity
issues, the client MAY automatically attempt upload resumption by retrieving the current offset" (§11). A server
that has not yet noticed the dead connection would see two requests at once; the draft's recommended answer is to
end the older one, since "the server can assume that the previous attempt has already failed" (§10). If the final
response itself is lost, "The server can choose to replay the final response" (§8.2).

### The reply

**Yes, in the protocol.** The completing response comes from the package's resource, and the draft separates "the
resumable upload itself" from "the processing of the uploaded representation": a 4xx or 5xx with `Upload-Complete:
?1` means "resuming the upload would not resolve this error" (§6.1, §8.2) — the same split as the ADR's *refused,
retry* and *resend*. *committed* comes later, by `GET` (as §4).

### What the PCS installs, what we build and run

* **PCS:** stock curl and a script of ~100 lines ([`link.md`](link.md) §12.5: `carrier/pcs/send-package.sh`). curl
  itself does not resume uploads: "HTTP uploads using POST or PUT cannot be resumed" with `-C` ([`link.md`](link.md)
  §11.3a), so the script asks the offset and sends the tail.
* **PACS:** the five requests, partial files, the concurrency rule, limits, status — built on this branch in ~1 300
  lines of Rust, ~600 of them the upload itself ([`link.md`](link.md) §12).

### Standard and maturity

A working-group draft, "bumped for breaking changes" through an interop version (App. B); October 2026's -14 is
interop version 10. Not an RFC; its predecessor and model is tus (§7), one of whose authors is the draft's first author.

### On a long fat or lossy path

**One stream at a time, by rule**: "Resumable uploads, as defined in this document, do not permit uploading
representation data in parallel requests for the same upload" (§10). So one package moves at one connection's rate
(§1). The same requests run over HTTP/3 unchanged, which is where a lossy path could differ ([`link.md`](link.md) §5,
§11.5).

### Authentication and encryption

HTTPS's (§4). The upload's address must be "hard to guess" (§20.1), since whoever knows it can append.

## 7. tus 1.0

tus is the open protocol the IETF draft grew from, frozen as 1.0.0 on 2016-03-25. "The protocol provides a mechanism
for resumable file uploads via HTTP … The protocol does not depend on specific versions of HTTP" (Abstract). A small
core plus named extensions (Creation, Expiration, Checksum, Termination, Concatenation).

### How it works

```
PCS                                                 PACS
 |-- POST /files   Tus-Resumable: 1.0.0               |   (Creation extension)
 |   Upload-Length: 107000000 ----------------------->|
 |<-- 201 Created   Location: /files/24e5… -----------|
 |-- PATCH /files/24e5…   Tus-Resumable: 1.0.0        |
 |   Upload-Offset: 0                                 |
 |   Content-Type: application/offset+octet-stream    |
 |   [bytes] ---------------------------------------->|   … drop
 |-- HEAD /files/24e5… ------------------------------>|
 |<-- 204   Upload-Offset: 50003968 ------------------|
 |-- PATCH …  Upload-Offset: 50003968  [rest] ------->|
 |<-- 204 No Content   Upload-Offset: 107000000 ------|
```

* `HEAD`: "The Server MUST always include the Upload-Offset header in the response … even if the offset is 0, or
  the upload is already considered completed"; caching forbidden with `no-store` (Core Protocol, HEAD).
* `PATCH`: the offset "MUST be equal to the current offset of the resource … If the offsets do not match, the Server
  MUST respond with the 409 Conflict status without modifying the upload resource"; success "MUST" be "204 No
  Content" with the new offset (Core Protocol, PATCH).
* Checksum extension: `Upload-Checksum` per `PATCH`, "460 Checksum Mismatch" and the chunk "MUST be discarded";
  "The Server MUST support at least the SHA1 checksum algorithm" (Checksum).

### On a drop

The same as §6: `HEAD`, then `PATCH` from the offset.

### The reply

The last `PATCH`'s 204 means the bytes are in; tus defines no answer about what the server then does with the file,
so *committed* and *refused* need a `GET` route of our own (*inference*; [`link.md`](link.md) §11.3b). That is the
practical difference from §6, whose final response may carry the package's answer.

### What the PCS installs, what we build and run

As §6: curl and a script (the headers differ), or one of tus's client libraries; on our side the same five requests
by hand, or a young Rust crate ([`link.md`](link.md) §11.3b).

### Standard and maturity

A community specification, not IETF; stable since 2016, with many implementations (*inference* from the protocol
repository; none counted here).

### On a long fat or lossy path

One `PATCH` at a time per upload, but the **Concatenation** extension allows "Clients to perform parallel uploads
and to upload non-contiguous chunks": several partial uploads, then one `Upload-Concat: final;…` that joins them
(Concatenation). So tus can spread one package over N connections, at the cost of an extension on both sides.

### Authentication and encryption

"the implementation of authentication and authorization is left for the Server to decide" (Core Protocol): HTTPS's,
as §4.

## 8. S3-style multipart upload

An object store's way: the client cuts the file into numbered **parts**, sends each as its own request, then asks the
store to join them. Described here from Amazon's S3 documentation; other stores copy the API.

### How it works

```
PCS                                                 object store
 |-- POST /bucket/pkg.tar?uploads ------------------->|   initiate
 |<-- UploadId=abc -----------------------------------|
 |-- PUT ?partNumber=1&uploadId=abc  [16 MiB] ------->|   parts may go in parallel,
 |-- PUT ?partNumber=2&uploadId=abc  [16 MiB] ------->|   on separate connections
 |<-- ETag "p1" (+ checksum) -------------------------|
 |<-- ETag "p2" --------------------------------------|
 |               …                                    |
 |-- POST ?uploadId=abc  <CompleteMultipartUpload>    |
 |     part 1 "p1", part 2 "p2", … ------------------->|   joins the parts in order
 |<-- 200  ETag of the object ------------------------|
```

"You initiate the upload, upload the object parts, and—after you've uploaded all the parts—complete the multipart
upload"; part numbers 1–10 000, and "if you upload a new part using the same part number as a previously uploaded
part, the previously uploaded part gets overwritten" (S3 User Guide, Multipart upload overview). Parts are 5 MiB to
5 GiB, the last one any size (S3 limits).

**What the receiver sees, and when:** nothing named until Complete: "Amazon S3 constructs the object from the uploaded
parts" on that request (overview).

### On a drop

"you only need to retry uploading the parts that are interrupted during the upload" (overview). The **client** holds
the state — the upload id and which parts it has — and can ask the store with ListParts ([`link.md`](link.md) §7).
Granularity is a part, so at least 5 MiB is resent (*inference*).

### The reply

Per part, an ETag and checksum; on Complete, the object's ETag, and `BadDigest` if a declared whole-object checksum
does not match (overview). That is *received*. A store has no notion of *committed* or *refused*: something of ours
must read the store's events and write a status the PCS polls ([`link.md`](link.md) §11.3f, *inference*).

### What the PCS installs, what we build and run

* **PCS:** a request-signing client (an SDK, a CLI, or curl with signing), and the multipart logic.
* **PACS:** an S3-compatible store to run and keep patched, or an S3 subset of our own, plus the event consumer and
  the status (*inference*, [`link.md`](link.md) §11.3f).

### Standard and maturity

A vendor API, not a standard, copied by many stores; mature and heavily used (*inference*).

### On a long fat or lossy path

**Built for parallel streams**: "You can upload parts in parallel to improve throughput", and for a "spotty network,
use multipart upload to increase resiliency against network errors by avoiding upload restarts" (overview). Of the
options here it is the one whose standard way of working is N connections per file.

### Authentication and encryption

HTTPS for encryption; every request signed with an access key (Signature Version 4; not read here), not a client certificate.

## 9. DICOM C-STORE with Storage Commitment

DICOM's own network way: an **association** (a DICOM session on one TCP connection, PS3.8) over which the sender
pushes **instances** — one image, or one multi-frame object — each with **C-STORE**; then, separately, it asks the
receiver to take responsibility with **Storage Commitment** (PS3.4 Annex J).

### How it works

```
PCS (Storage SCU, Commitment SCU)                   PACS (Storage SCP, Commitment SCP)
 |-- TCP to 104 or 11112 (2762 with TLS) ----------->|
 |-- A-ASSOCIATE-RQ (SOP classes, max PDU) ---------->|
 |<-- A-ASSOCIATE-AC ---------------------------------|
 |-- C-STORE-RQ  instance 1 ------------------------->|
 |<-- C-STORE-RSP  status 0000 Success ---------------|   per instance
 |-- C-STORE-RQ  instance 2 … n  -------------------->|
 |-- N-ACTION-RQ  Storage Commitment                  |
 |   Transaction UID, list of instance UIDs --------->|
 |<-- N-ACTION-RSP  "received the request" -----------|
 |-- A-RELEASE --------------------------------------->|
                  … later, minutes or hours …
 |<-- the PACS opens an association TO the PCS -------|
 |<-- N-EVENT-REPORT  committed / failures + reasons -|
 |-- N-EVENT-REPORT-RSP ----------------------------->|
```

* C-STORE: "By performing this service successfully, the SCP indicates that the SOP Instance has been successfully
  stored" (PS3.4 B.2.2); statuses 0000 success, B0xx warnings, A7xx "Refused: Out of resources", A9xx and Cxxx errors
  (Table B.2-1).
* But storage is not commitment: "there is no commitment that the SCP will do more than accept the transmitted SOP
  Instances" (PS3.4 J.1.1). Commitment is asked with N-ACTION, whose success means only that "the SCP has received the
  N-ACTION request" (J.3.2.1.2); the answer is an N-EVENT-REPORT, "Storage Commitment Request Successful" or
  "failure exists" with a reason per failed instance (J.3.3.1.2). "Once the SCP has committed to store the SOP
  Instances, the SCU may decide that it is appropriate to delete its copies" (J.1.1).

### On a drop

Instances already answered with Success are stored; the instance in flight is sent again from its start, on a new
association (*inference*: PS3.7 defines no offset within a C-STORE). So the resume unit is **one instance**: a slice
of a classic CT (well under a MB), or a whole series when it is one enhanced multi-frame instance (*inference*).

### The reply

**Two, and the second goes the wrong way for a hospital.** C-STORE-RSP per instance is *received* on the same
connection. The commitment, though, "An SCP shall be capable of issuing the N-EVENT-REPORT on a different association
than the one on which the N-ACTION operation was performed", and the SCU must accept it: "the SCU accepts an
association where the SCP role is proposed by the Storage Commitment SCP acting as an association requestor"
(J.3.3.1.2, J.3.3.1.3). The SCP "may attempt to issue the N-EVENT-REPORT on the same Association, but this operation
may fail because the SCU is free to release at any time" (J.3.3.1.2). So in general **the PACS connects into the
hospital** to deliver *committed* — an inbound port at every site, the direction §0 avoids (*inference*). The PCS can
keep its association open to receive it there, which works only while it stays up (*inference* from the same note).

### What the PCS installs, what we build and run

* **PCS:** a DICOM network toolkit acting as Storage SCU and Storage Commitment SCU, and — for the commitment — a
  listening SCP reachable from the PACS (*inference*; no toolkit read here).
* **PACS:** a Storage SCP and a Storage Commitment SCP, with their AE titles and per-site configuration. And a
  mismatch with this project: C-STORE carries **DICOM instances**, while the PCS's output is a **package** of coded
  bundles (ADR §4); carrying DICOM would move the PCS's conversion to our side, or wrap the package in an instance
  (*inference*).

### Standard and maturity

The DICOM standard (PS3.4 Annexes B and J, PS3.7, PS3.8), the domain's oldest and most widely implemented path; the
Push Model is the only one left ("A Pull Model was defined in earlier versions, but has been retired", J.1.2).

### On a long fat or lossy path

One association is one TCP connection with one request outstanding at a time unless both sides negotiate
asynchronous operations (PS3.7, not read here); senders often open several associations in parallel (*inference*:
common practice, not a standard rule). Each C-STORE waits for its response before the next, so many small instances
pay a round trip each on a long path (*inference*).

### Authentication and encryption

Plain DICOM is unencrypted and identifies peers by AE title only (*inference*; PS3.8 leaves secure connections to PS3.15's profiles). PS3.15
Annex B adds TLS profiles: "It is recommended that systems supporting this Profile use the registered port number
'2762 dicom-tls'" (PS3.15 B.12, B.13), with certificates on both sides.

## 10. DICOMweb STOW-RS, and its Storage Commitment Service

The web form of DICOM storage. **STOW-RS** is the Store Transaction: "This Transaction uses the POST method to Store
representations of Studies, Series, and Instances contained in the request payload" (PS3.18 §10.5), as a
`multipart/related` body of instances (Table 10.5.4-1). PS3.18 also defines a **Storage Commitment Service** over HTTP
that "corresponds to the DIMSE Storage Commitment Service Class … and has the same semantics" (PS3.18 §13.1) — and,
unlike DIMSE, the reply is fetched by the client.

### How it works

```
PCS (user agent)                                    PACS (origin server)
 |-- TCP + TLS ------------------------------------->|
 |-- POST /studies                                   |
 |   Content-Type: multipart/related;                |
 |     type="application/dicom"                      |
 |   [instance 1][instance 2]…[instance n] --------->|
 |<-- 200 all stored | 202 some failed | 409 none ---|  + a Store Instances Response
 |-- POST /commitment-requests/<TransactionUID>      |
 |   [the instance UIDs] --------------------------->|
 |<-- "Done" (the result) or "Working" --------------|
 |-- GET /commitment-requests/<TransactionUID> ----->|  repeated while "Working"
 |<-- "Done": committed / failed, per instance ------|
```

* Status codes: 200 "The origin server successfully stored all Instances"; 202 "stored some of the Instances but
  warnings or failures exist for others"; 409 "unable to store any Instances due to a conflict in the request"
  (Table 10.5.3-1).
* Commitment: "As committing to storage of Instances is often a long-running operation on the origin server, the use
  of this service may be split into two Transactions … 1) requesting the commitment, and … 2) checking for the
  result"; on "Working … the user agent needs to perform a Check Commit Result after some time" (§13.1). Commit is a
  `POST`, Check Commit Result a `GET`, on `/commitment-requests/{TransactionUID}` (Table 13.3-1).

### On a drop

STOW-RS defines no resume: one `POST` is all or nothing at the transport level, so a drop sends the request again
whole (*inference*: PS3.18 §10.5 has no offset, range or partial request). Splitting a series into several `POST`s
makes the unit smaller, as C-STORE's instance is (*inference*).

### The reply

**Yes, on connections the PCS opens.** The response of the `POST` is *received* per instance, and the Storage
Commitment Service's `GET` polling is a standard *committed* / *refused* channel with the PCS always the client —
the same shape as the ADR §7's `GET` on the package, defined by DICOM.

### What the PCS installs, what we build and run

* **PCS:** an HTTP client that builds `multipart/related` bodies (curl can), or a DICOMweb client library.
* **PACS:** a STOW-RS endpoint and the Commitment Service's two transactions, with PS3.18's conformance rules
  (Retrieve Capabilities, media types, §13.2). The same mismatch as §9: it carries **instances**, not our package
  (*inference*).

### Standard and maturity

DICOM PS3.18. STOW-RS is widely implemented (*inference*); the Storage Commitment Service in PS3.18 §13 is recent in
the standard (not dated here: the 2026d edition read has it) and its support in products is not known here.

### On a long fat or lossy path

One `POST` is one stream; several `POST`s of different instances may run in parallel (*inference*: nothing in §10.5
forbids it).

### Authentication and encryption

HTTPS's (§4), as any HTTP service.

## 11. Against the owner's four requirements

**Resumable**: a drop costs only what was not yet received. **Fast**: one package's rate on a long fat or lossy path
— chiefly, whether it can use several TCP connections (§1). **Simple**: what both sides must add and run. **A reply
channel**: *received*, *committed* and *refused* reach the PCS on connections the PCS opens. Each cell gives its
basis: *S* is a source (the section above quotes it), *E* estimated, *I* inference.

| option | resumable | fast on a long fat or lossy path | simple | a reply channel |
| --- | --- | --- | --- | --- |
| rsync over ssh | yes: `--partial-dir` keeps the piece and the delta reuses it; costs a handshake and a checksum pass (*S* rsync(1); *I* for the cost) | one connection, under ssh's 2 MiB window (*S* `channels.h`; *E* rate) | two stock tools, but sshd per site, a watcher and a second channel (*S* ADR §3; *I*) | exit status = received; no committed: "cannot send any text" (*S* rsyncd.conf(5)) |
| rsync daemon | the same (*S*) | one connection, no ssh window (*I*) | the same, and unencrypted unless wrapped (*S* rsync(1)) | the same (*S*) |
| SFTP / SCP (SFTP mode) | `reput` / `-a`: from the remote size, unchecked (*S* sftp(1)) | one connection, 2 MiB in flight (*S* sftp(1), `channels.h`; *E* rate) | stock OpenSSH both ends; watcher and second channel ours (*I*) | per write only; no committed (*S* filexfer-02 §6.4; *I*) |
| plain PUT/POST, whole | no: from byte 0 (*S* RFC 9110 §9.2.2) | one connection (*I*) | the least: curl and one route (*E* link.md §11.1) | yes: the response, then `GET` (*S* RFC 9110 §15.3.3; *I* for `GET`) |
| range PUT | only by private agreement; no standard way to ask the offset (*S* RFC 9110 §14.5; *I*) | one connection (*I*) | simple, but non-standard and risky on servers that ignore it (*S* RFC 9110 §14.5) | the response (*I*) |
| IETF draft-14 | yes: `HEAD` then `PATCH` from the server's offset, ~1 round trip (*S* §7, §8, §11; *I* for the cost) | one connection per upload, by rule (*S* §10) | curl and a ~100-line script; ~1 300 lines on our side, built (*S* link.md §12) | yes: the final response is the package's, then `GET` (*S* §6.1, §8.2) |
| tus 1.0 | yes, as draft-14 (*S* Core Protocol) | one connection, or N with Concatenation (*S* Concatenation) | as draft-14; plus Concatenation on both sides for N (*I*) | 204 = received; committed by our own `GET` (*S* Core; *I*) |
| S3-style multipart | yes: resend the cut parts, ≥ 5 MiB each (*S* overview, limits) | N parts in parallel, by design (*S* overview) | a store or an S3 subset to run, signing at the PCS, an event consumer (*I* link.md §11.3f) | stored = received; committed only through a status of ours (*I*) |
| C-STORE + Storage Commitment | per instance: done ones stay, the cut one goes again (*I* from PS3.4 B.2.2) | one connection per association, a round trip per instance; several associations possible (*I*) | a DICOM toolkit both ends; carries instances, not our package (*I*) | received per instance; committed by an N-EVENT-REPORT that may need the PACS to connect into the hospital (*S* PS3.4 J.3.3.1.2–3) |
| STOW-RS + PS3.18 §13 | no resume within a request; resend per request (*I* from PS3.18 §10.5) | one per `POST`; several `POST`s possible (*I*) | an HTTP client; a DICOMweb endpoint; carries instances (*I*) | yes: the response, then Commit / Check Commit Result by `GET` (*S* PS3.18 §10.5.3, §13.1) |

## 12. Sources

Fetched 2026-10-26; the first 12 hex of the fetched file's sha256, or the repository commit read. Raw copies are not
committed.

* **rsync** at [`fd96bc7e8a9c`](https://github.com/RsyncProject/rsync/tree/fd96bc7e8a9c320b40fa30a40fe6c36b516ae2e0)
  (3.4.4 is the latest tag): [rsync(1)](https://download.samba.org/pub/rsync/rsync.1) from `rsync.1.md`
  (`0a3987472136`) — §CONNECTING TO AN RSYNC DAEMON, §USING RSYNC-DAEMON FEATURES VIA A REMOTE-SHELL CONNECTION,
  §SECURITY, `--inplace`, `--append`, `--append-verify`, `--whole-file`, `--temp-dir`, `--timeout`, `--partial`,
  `--partial-dir`; [rsyncd.conf(5)](https://download.samba.org/pub/rsync/rsyncd.conf.5) from `rsyncd.conf.5.md`
  (`85fc22cbc932`) — `early exec`, `pre-xfer exec`, `post-xfer exec`, `auth users`, §AUTHENTICATION STRENGTH.
  A. Tridgell and P. Mackerras, [The rsync algorithm](https://rsync.samba.org/tech_report/), ANU TR-CS-96-05:
  §The rsync algorithm (`node2.html`), §Rolling checksum (`node3.html`), §Checksum searching (`node4.html`).
* **OpenSSH** at [`976483171996`](https://github.com/openssh/openssh-portable/tree/97648317199613d06247bf4cc4d44a95f250c532)
  (OpenSSH 10.6): [sftp(1)](https://man.openbsd.org/sftp) (`9099280c7a8a`) `-a`, `-B`, `-R`, `reput`, `reget`;
  [scp(1)](https://man.openbsd.org/scp) (`94285cd82889`) §DESCRIPTION, §HISTORY, §CAVEATS;
  [sshd_config(5)](https://man.openbsd.org/sshd_config) (`ef5194cf6568`) `ChrootDirectory`, `ForceCommand`;
  `PROTOCOL` §1 and §4.3; `channels.h` `CHAN_SES_WINDOW_DEFAULT`, `CHAN_SES_PACKET_DEFAULT`.
  [draft-ietf-secsh-filexfer-02](https://www.openssh.com/txt/draft-ietf-secsh-filexfer-02.txt) (`3f69664d8050`) §6.4.
  [RFC 4254](https://www.rfc-editor.org/rfc/rfc4254) (`bfc727e93500`) §5.2; RFC 4251 by reference.
* **HTTP:** [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110) (`21c1cdce6ab0`) §9.2.2, §14.2, §14.5, §15.3.3.
  [draft-ietf-httpbis-resumable-upload-14](https://datatracker.ietf.org/doc/draft-ietf-httpbis-resumable-upload/14/)
  (`6bfbf01573b9`, the file [`link.md`](link.md) §11.8 pins) §1, §4.1, §6.1, §6.2, §7, §8.2, §9, §10, §11, §17.1,
  §17.2, §20.1, App. B. [tus 1.0.0](https://tus.io/protocols/resumable-upload) from `protocol.md` at
  [`b72e8fa02a76`](https://github.com/tus/tus-resumable-upload-protocol/blob/b72e8fa02a76b98b0fb1d5ee256b7095b39a8132/protocol.md)
  (`dfc82027d295`, the file [`link.md`](link.md) §7 read): Abstract, Core Protocol (HEAD, PATCH), Creation,
  Checksum, Concatenation.
* **S3:** Amazon S3 User Guide, [Uploading and copying objects using multipart upload](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html)
  (`25fdb615d161`) and [Amazon S3 multipart upload limits](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html).
* **DICOM**, edition 2026d: [PS3.4](https://dicom.nema.org/medical/dicom/current/output/html/part04.html)
  (`bc3a6b3eda74`) B.1.2, B.2.1–B.2.3 and Table B.2-1, J.1.1, J.1.2, J.3, J.3.2.1.2, J.3.2.1.3, J.3.3.1.2,
  J.3.3.1.3; [PS3.18](https://dicom.nema.org/medical/dicom/current/output/html/part18.html) (`2a7e405198f8`)
  §10.5 (Tables 10.5.3-1, 10.5.4-1), §13.1, §13.2, Table 13.3-1;
  [PS3.15](https://dicom.nema.org/medical/dicom/current/output/html/part15.html) B.12, B.13 (port 2762);
  [PS3.8](https://dicom.nema.org/medical/dicom/current/output/html/part08.html) (ports 104 and 11112, secure connections by PS3.15).
* **TCP:** [RFC 7323](https://www.rfc-editor.org/rfc/rfc7323) (`29e07732ea23`) §1.1, §2.3. M. Mathis, J. Semke,
  J. Mahdavi, T. Ott, "The Macroscopic Behavior of the TCP Congestion Avoidance Algorithm", ACM SIGCOMM CCR 27(3),
  1997, [a course copy](https://courses.cs.duke.edu/fall24/compsci514/readings/mathis-tcpmodel-ccr97.pdf)
  (`cf91bf72b808`): Abstract, §2 Eq. 3.
* **This repository:** ADR [`../adr/pcs-transfer.md`](../adr/pcs-transfer.md) §3, §4, §6, §7; [`link.md`](link.md)
  §3, §4, §5, §7, §11, §12.

**Not read**, so not cited as read: PS3.7's asynchronous operations and C-STORE service definition; the dates at which
PS3.18 §13 entered the standard; any DICOM toolkit; curl's signing option; whether `sftp`'s `-a` asks the size by
stat or another request; rsync's behaviour when `--append-verify`'s final check fails.
