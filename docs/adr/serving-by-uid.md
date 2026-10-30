# ADR: one server serves many series, each named by its UIDs

**Status:** proposed 2026-10-24, **theory only: nothing built or timed; not accepted.** The seven decisions in §9 are
the owner's and unanswered. Scope is the PACS side: the server and the files it reads; the PCS (the hospital side) is
another team's (the owner, 2026-10-24). *Corrected 2026-10-26* against
[`../ingest/pacs-receive-design.md`](../ingest/pacs-receive-design.md) §9: the PACS sees UIDs as the PCS codes them,
not as PS3.5 writes them, so §2's grammar is the coding's ([`../ingest/contract.md`](../ingest/contract.md) §The
layout); the digest is XXH3, as every hash the PACS checks. Where `<Study>/` sits under the root is open
([`pacs-disk-layout.md`](pacs-disk-layout.md)).
Sources are pinned in §10. *(I)* marks this record's own inference; a figure not marked *measured* is not one.

**Why an ADR and not a section of [`../disk-layout/target.md`](../disk-layout/target.md).** The target owns the file:
its name, its bytes, how it is published. This record owns what the server does with a tree of such files: how a
session names one, opens it, notices a replacement and refuses. It amends the invariant of
[`disk-access.md`](disk-access.md) §7, *one index per series, never per session*, from one store per process to one
store per open series, and it changes the session URL ([`../WIRE.md`](../WIRE.md)). The target's first table row points
here.

**Builds on, read-only:** PR #119's receiver design (`claude/pacs-receiver-design`, `docs/ingest/design.md` §12 there:
revisions, `CURRENT`, choice 7 *the series digest in the session URL*) and PR #118's metadata draft
(`claude/page-open-metadata`: carriers A1 and B, the codec hint `?codec=`). Neither is merged; where this record
depends on one, it says so.

## 1 · Today, and the question

`series-server --series x.sbnd` opens one file at start (`run_server`, `server/src/transport/server.rs`), wraps it in one
`Arc<FrameStore>` and hands that to every session. The session URL's path is ignored; its query is read only for
`?ask=` (`parse_opening_ask`). A deployment of many series is many processes, one port each.

The question: one process, many series, stored as `<root>/<Study>/<Series>.sbnd`, each name the PCS's coding of the
UID (`contract.md` §The layout; `<E>` and `<S>` there).

```text
 CONNECT https://host:4433/<Study>/<Series>?digest=<hex>&ask=fill:0-63
   │
   ├─ 1 parse: two PCS-coded UIDs by the coding's grammar, else refuse ── no file is touched
   ├─ 2 look up (Study, Series) in the open-series map
   │      hit:  stat(path) is the held file's (st_dev, st_ino)?  no → open again
   │      miss: open, read header and index, check them (§3)        ← blocking pool, not the executor
   ├─ 3 digest given and ≠ the store's → open again once → still ≠ → refuse "changed"
   ├─ 4 accept; serve the opening ask against this store's frame count
   └─ the session holds Arc<FrameStore>; the map holds a Weak; the last session out closes the file
```

## 2 · How the session URL names a series

| | (a) path `/<Study>/<Series>` (recommended) | (b) query `?study=…&series=…` | (c) an opaque handle the study index issues | (d) the digest alone |
| --- | --- | --- | --- | --- |
| maps to the disk | one-to-one, the target's name | the same, with parsing | needs the study index (#119 §5's catalog) | needs a digest → file index |
| per-series HTTP routing later | a path prefix | a query match | yes | no |
| switching later | a route | a route | a lookup service now | a new index |

**The grammar decides safety, not the filesystem.** A DICOM UID is at most 64 characters of digits and `.` (PS3.5
§9.1), but the PACS never sees it so: the PCS names each level by a reversible coding of it, three characters to two
of the alphabet `0-9 A-Z _ a-z ~` (`0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~`), a remainder of
one or two characters to two more, the UID's NUL pad coded with it ([`../ingest/contract.md`](../ingest/contract.md)
§The layout). So a coded UID is an even number of alphabet characters, at most 44 (64 characters: 21 triples and one
left over). The server accepts a segment only if it matches `^([0-9A-Z_a-z~]{2}){1,22}$`. Every traversal spelling
fails it: `.` and `..` (the alphabet has no `.`), `/`, `%2e` and any percent escape (no `%`), NUL, non-ASCII
characters. The path is joined only after both segments pass, so no file outside `<root>` is named *(I: holds because
the alphabet has no separator and no `.`; it does not defend against a symlink placed inside `<root>`, which only the
receiver writes)*. The alphabet's characters are all RFC 3986 unreserved (ALPHA, DIGIT, `_`, `~`), so a correct client
never escapes them and the server never unescapes. Decoding a segment and checking PS3.5's grammar on the result
(digits and `.`, no leading zero, at most 64) is stricter, and catches a well-formed name that is no UID; it adds no
safety the alphabet does not already give *(I)*. `openat2`'s `RESOLVE_BENEATH` would add a kernel check (openat2(2), Linux 5.6); not
recommended now, since the grammar already closes it, and adding it later is one call.

**The digest is #119's choice 7, over the bundle's coded-frame hashes, in entry order, in `?digest=` as hex.**
*Corrected 2026-10-26:* #119 chose BLAKE3-256 (64 hex characters); the PACS's hashes are XXH3 (decided 2026-10-24/25),
so the digest is XXH3 over the same input; its width, 64 or 128 bits, is not decided. It pairs the page's metadata with the bundle it was built from. Optional on the wire: a
session without it is served whatever the name holds now. A revision number does not belong in the URL: a revision is
the study DB's (#119's `CURRENT` file is dropped: design state §11), and the server serves the bundle, whose identity is the digest. `?codec=` is the
page's address (#118's hint), not the session's; the server ignores every query key but `ask` and `digest`, as it
ignores every key but `ask` today. `--series` stays, path ignored, for the lab, the tests and the smoke deploy; `--root`
is its alternative and the two are exclusive.

## 3 · Lookup and opening

| | (a) open per session | (b) a map of `Weak<FrameStore>` (recommended) | (c) (b) plus an LRU of closed stores | (d) open the whole tree at start |
| --- | --- | --- | --- | --- |
| index memory | per session: what §7 of `disk-access.md` refuses, 512 MB at a thousand readers of 32 000 frames | per open series | (b) + the LRU's | every series |
| fds | per session | per open series | + the LRU's | per series stored: 10⁵ and more |
| a replaced file | seen at once | stat at lookup (§4) | the same | a rescan |
| code | none | a map, a lock, a stat | + eviction | + a watcher |

**Recommended (b).** The store lives exactly as long as a session uses it: the map holds a `Weak`, each session an
`Arc`. Look up under the lock; on a miss release it, open on the blocking pool, lock again and keep whichever store
is already there (two opens of one series race rarely and cost one extra open). The index stays 16 B a frame in
memory (`disk-access.md` §7); v2's entry adds two hashes on disk, but the read path needs only offset and length, so
only the digest, at most 32 B a series, is kept *(I)*. (c) is for a measured open cost (§8); switching to it is the eviction
policy alone.

**Descriptors.** One per open series, plus what sessions hold today: a ring each once a tile read misses
(`disk-access.md` §1) and a TCP socket each over WebSocket. Distinct open series never exceed open sessions, so (b)
at most doubles today's per-session count and never adds a per-stored-series cost *(I)*. `open` fails `EMFILE` at
the process's `RLIMIT_NOFILE` (open(2), getrlimit(2)); the session is then refused as busy (§6), and the deployment
sets the limit. Raising the soft limit to the hard one at start is a later one-liner, not part of this.

**What the server checks at open, before the first frame.** v1 and v2 alike: magic, version, the index inside the file,
every frame under `MAX_CODESTREAM_LEN` (`common/series-bundle/src/format.rs`, as today). v2 adds, each refused
whole: a codec and a layout this server serves (layout 1 refused until it is built); both header UIDs equal to the
URL's, which catches a file under the wrong name; and the digest, computed from the index's coded hashes,
microseconds for N × 8 B (#119 §12.5, *(D)* there). The coded bytes are not hashed at open (that reads the whole
file) nor on read (a scrub's job, as the target says): the client checks every frame it shows against the samples
hash ([`exactness-in-production.md`](exactness-in-production.md)).

The open runs before the accept, so the opening ask can be checked against the frame count as today. On a hit it
costs a lock and a `stat`; on a miss, an `open` and two `pread`s (`read_layout`); neither is measured (§8).

## 4 · A series published or replaced while sessions are open

The receiver publishes by `.partial` → `fsync` → `rename` → `fsync` of the directory (target §Packing and publishing).
`rename` replaces the name atomically: "a link named *new* shall remain visible to other threads throughout the
renaming operation and refer either to the file referred to by *new* or *old*" (POSIX rename()), and on Linux "there
is no point at which another process attempting to access newpath will find it missing" (rename(2)). The old file
lives while a descriptor is open: its space is freed only when its link count is 0 "and no process has the file open"
(POSIX unlink()).

So an open session keeps serving the bundle it opened, whole; this is today's behaviour and the right one: its
frames match the metadata its page holds. A **new** session must not be handed the old store just because an old
session still holds it. That is the one failure (b) adds, and the recommended lookup closes it:

| | (i) `stat` at each lookup, compare `(st_dev, st_ino)` with the held file's (recommended) | (ii) the digest alone | (iii) inotify on each study directory |
| --- | --- | --- | --- |
| a page with no digest (v1, an old link) | the new file | the old file, for as long as any session holds it | the new file |
| cost | one `stat` a session | none | a watch per open study; "does not catch remote events that occur on network filesystems" (inotify(7)) |

Recommended (i) always, and (ii) on top when the URL carries a digest: (i) makes a new session see the current name,
(ii) makes it see the bundle its metadata describes. #119 §12.5 orders the receiver's steps so a bundle is renamed in
before the revision naming it is published, so a page holding the new revision's digest always finds the new bundle.
A page that fetched the old revision just before is refused "changed" and refetches; until the builder publishes
(milliseconds, #119 §12.5, *(D)* there) it can fetch the old revision again. The client's bound on that loop is
the owner's §12.10 item 8 in #119, not this record's.

**In place is never.** A published name is never written: a `FrameStore`'s index is read once and immutable, so an
in-place write would serve a frame from one version through the other's offsets. The server cannot enforce this;
it is the receiver's invariant, and v2's coded hash is what a scrub would catch it with. **A withdrawn series**
(an unlink) leaves open sessions serving and refuses new ones "not found". **The cost of an old file** is its disk
until its last session ends, an idle session held open by keep-alives included
([`transport-idle-sessions.md`](transport-idle-sessions.md)).

The bundles are on the PACS host's local disk (decided; #119 §12.8). On NFS, `stat` can answer from the attribute
cache for `acregmin`–`acdirmax` seconds (nfs(5)), so (i) would see a rename late; not designed for.

## 5 · v1 now, v2 later

The tree's naming does not depend on the file's version, so everything above but the UID and digest checks can be
built on v1 bundles now: the URL grammar, `--root`, the map and its `stat`, the refusals, their tests. A v1 file
carries no UIDs and no hashes, so under v1 a misplaced file is served and no digest exists.

* **Reading both.** `read_layout` dispatches on the version field, which both versions put at bytes 4–8. A v1 store
  has no digest; a URL with a digest against it is treated as a mismatch (§6): a digest exists only in metadata
  built from a v2 bundle, so the pair cannot belong together *(I)*.
* **Migration, one series at a time, while serving.** Read v1; hash each coded frame; take each samples hash from the
  v1 metadata's per-frame digests ([`../FIXTURES.md`](../FIXTURES.md) §Frame digests); write v2 to `.partial`, `fsync`,
  `rename` over, `fsync` the directory. Open sessions keep v1 (§4); new ones get v2. The coded bytes are unchanged, so
  the frames are too. The tool is the receiver team's packer reused, not the server's.
* **Switching cost.** Building on v1 first costs the version dispatch, which v2 needs anyway. Waiting for v2 costs
  nothing but time.

## 6 · Failure cases, and what the client is told

A refusal by HTTP status (`SessionRequest::not_found`, `forbidden`, `too_many_requests` in wtransport 0.7) is not
readable by a page: a non-2xx answer to the CONNECT rejects `ready` with a `WebTransportError`, no status
(WebTransport §6.5). An accepted session closed by the server reaches the page as `closed`'s
`WebTransportCloseInfo { closeCode, reason }` (WebTransport §6.3, §6.6, §6.10), which both clients already read
(`closedReasonOf`, `client/transport/ts/frame-session.ts`; `client/transport/wasm/src/session.rs`). So: **accept, then
close with a code**. Over a WebSocket the same refusal is a Close with 4000 + the code, the private range
(RFC 6455 §7.4.2), as `ws-session.ts` already reads. The codes are new, defined in `WIRE.md` when built:

| case | code | reason | the client should | logged |
| --- | ---: | --- | --- | --- |
| a segment fails the UID grammar | 1 | `bad series name` | not retry | INFO |
| no file at the name; only a `.partial` there; the study directory missing | 2 | `series not found` | not retry; tell the user | INFO |
| the digest differs after one reopen; a digest against a v1 file | 3 | `series changed` | refetch metadata, dial again | INFO |
| bad magic, unknown version, codec or layout; index past the end; a frame over the cap; a header UID not the URL's | 4 | `series unreadable` | not retry; tell the user | WARN: an operator's problem |
| `EMFILE` / `ENFILE`; out of memory reading the index | 5 | `server busy` | retry with backoff | WARN |
| `EACCES`, `EIO` at open | 4 | `series unreadable` | as 4 | WARN |

A `.partial` is never opened because its name is never formed: the server joins `<Series>.sbnd` and nothing
else. A read error after the session started stays what it is today, the session's own failure
([`../WIRE.md`](../WIRE.md) §FoD messages). **Not designed here:** who may open which series. A UID is not a secret
*(I)*; authorization is the owner's (§9).

## 7 · What the tests would prove

Each test is mutated before it counts (`CLAUDE.md` §Measurement): the named break is applied, the test fails, the
break is reverted.

| claim | test | mutation that must fail it |
| --- | --- | --- |
| the grammar accepts PCS-coded UIDs and nothing else | a table: `TOMG` (`1.2.3` padded, `contract.md`), the coding of a 64-char UID (44 characters), every alphabet character; refused `..`, `.`, `1.2`, an odd length, 46 characters, `%2e%2e`, `a/b`, `a-b`, `٠١`, empty | drop the even-length rule; drop the length check; admit `.` |
| no name outside `<root>` is opened | a counting open hook; `<root>/../x.sbnd` exists; every refused URL above → zero opens | join before validating |
| sessions on one series share a store | extend `sessions_share_one_store_rather_than_opening_their_own` (`server/src/transport/pipeline.rs`): two sessions, `Arc::ptr_eq`; two series, not | open per session |
| the last session out closes the file | after both close, the `Weak` does not upgrade; the process's fd count is back | the map holds an `Arc` |
| a rename publishes to new sessions only | session A open on pattern A; rename pattern B over; A still reads A, a new B reads B | remove the `stat` comparison |
| a digest pairs metadata and bundle | wrong digest → code 3 after exactly one reopen; right digest → served | skip the reopen; compare the wrong bytes |
| a misplaced v2 file is refused | a v2 file whose header names another series → code 4 | drop the UID comparison |
| a `.partial` is never served | only `<S>.sbnd.partial` present → code 2 | accept a `.partial` suffix |
| running out of descriptors refuses, never stops | `prlimit --nofile` low, more distinct series than fit → code 5; a series already open still serves | `?` the error out of the accept loop |
| racing opens of one series converge | 32 concurrent sessions, one cold series → one store left in the map, all served | insert without re-checking |
| both clients surface the codes | a contract-suite clause on every implementation (TS over WebTransport and WebSocket, WASM) | map every close to code 0 |

## 8 · Performance, a protocol and no number

Nothing here is measured. What a measurement must settle, each pre-registered before it runs:

1. **The warm lookup against today.** Arms: `--series` (today), `--root` with the series already open, `--root`
   with it opened by this session but its file in the page cache; plus an A/A arm of today against itself, whose
   spread is the noise. Interleaved in every round, at least 8 paired rounds, release builds. Quoted: **latency**,
   the server's CONNECT-arrival-to-first-envelope-byte, p50 and p95. Decision, fixed now: an arm within the A/A spread
   of today is no cost; an open-on-miss arm outside it argues for (c) of §3.
2. **A cold open.** Page-cache eviction is not a lever (`CLAUDE.md` §Measurement), and `FrameStore`'s miss levers
   reach frame reads, not `read_layout`. So a cold open is claimed only once a lever forces `read_layout`'s reads down
   the blocking path with a measured miss's delay; until then, nothing is claimed for it.
3. **Many series against one.** S sessions spread over K = 1, 10, 100 series, interleaved, the same frames each.
   Quoted: first-frame latency at each S. The host's saturation point (a core at 100 %, or the link) is found first
   and named, and nothing is claimed past it ([`../rig-limits.md`](../rig-limits.md)).

## 9 · The owner's decisions

1. **The URL** (§2): the path `/<Study>/<Series>`, PCS-coded (recommended), or the query.
2. **The digest** (§2, §4): optional on the wire (recommended), or required under `--root` once v2 is built.
3. **The open-series map** (§3): `Weak` only (recommended), or an LRU now.
4. **Build on v1 first** (§5): yes, behind `--root`, the UID checks arriving with v2 (recommended); or wait for v2.
5. **Refusals** (§6): accept-then-close with the codes above (recommended), or HTTP statuses a page cannot read.
6. **Authorization:** who may open a series. Not designed; default: none, as today, on a host only the hospital's
   network reaches.
7. **A withdrawn or replaced series under an open session** (§4): it keeps serving (recommended), or its sessions
   are closed. A clinical question as much as a technical one.

## 10 · Sources

* DICOM PS3.5, §9.1 *UID Encoding Rules*: dicom.nema.org/medical/dicom/current/output/html/part05.html#sect_9.1
* The PCS's UID coding, as read from its public source: [`../ingest/contract.md`](../ingest/contract.md) §The layout
* POSIX.1-2024 (The Open Group Base Specifications Issue 8), `rename()` and `unlink()`:
  pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html, …/unlink.html
* Linux man-pages: rename(2), open(2) (`EMFILE`, `ENFILE`), openat2(2) (`RESOLVE_BENEATH`), getrlimit(2)
  (`RLIMIT_NOFILE`), inotify(7) §Limitations and caveats, nfs(5) (`acregmin`, `acdirmax`): man7.org/linux/man-pages/
* W3C WebTransport, §6.3 the `WebTransport` interface (`ready`, `closed`), §6.5 processing the fetch response,
  §6.6 session termination not initiated by the client, §6.10 `WebTransportCloseInfo`: www.w3.org/TR/webtransport/
* RFC 3986 §2.3 unreserved characters; RFC 6455 §7.4.2 reserved status code ranges.
* wtransport 0.7.2, `endpoint::SessionRequest`: docs.rs/wtransport/0.7.2
