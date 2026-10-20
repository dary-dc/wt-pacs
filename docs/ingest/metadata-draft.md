# Metadata from the study database: the purpose and the open points (draft)

*A draft for the owner's review, 2026-10-19. Nothing here is built and nothing is timed unless it says
**measured**. Once a design is agreed, its text moves into the file that owns it — [`design.md`](design.md) §5 for
the study database and the catalog, [`../disk-layout/target.md`](../disk-layout/target.md) for what sits on disk,
[`../CLIENTS.md`](../CLIENTS.md) for what the page fetches — and this file is removed.*

## Why

**The need.** A viewer has to know, before it paints a frame, how many frames there are, which codec they are in,
how to turn samples into grey levels (photometric, rescale, window), and how fast a cine plays. Today that arrives
as one JSON file. Two decisions already taken make that file go away:

* [`../disk-layout/target.md`](../disk-layout/target.md): no metadata in or beside the `.sbnd`; it lives only in the
  per-study database, one copy, where it is queried.
* [`design.md`](design.md) §5 (d): one database per study, built from the parser's groups at the PACS (confirmed 2026-10-20), so bad
  data in one study never forces a shared rebuild.

**The purpose of this work** is the path between those two: the page gets what it needs to paint from the study's
database, no slower than today, and the dev host, the fixtures and the gate stop depending on a JSON file.

## Today

```text
 build time                                     page open
 ──────────                                     ─────────
 ingest.py ──▶ metadata.json ──┬─▶ pack-series ──▶ x.sbnd  (JSON copied into the file; the server never reads it)
                               │
                               └─▶ <series>.metadata.json            browser
                                    │                                   │
                                    ▼                                   │ GET /series/metadata   (head.js:9)
              web host: nginx  /series/metadata ──alias──▶ that file ◀──┤ GET /wt/dev-transport.json
                        or dev-server.py --metadata                     │      (both in parallel, before the dial)
                                                                        │
                                                                        │ codec → preload that decoder only
              series-server --series x.sbnd   ◀──── WebTransport ───────┘ frames
              (one series per process)
```

**What the viewer reads out of the JSON** (`client/viewer/viewer.js`, `client/viewer/head.js`, every use):

| Key | Used for |
| --- | --- |
| `frameCount` | the frame range, the fill's end |
| `codec` | which decoder to preload and run (`htj2k` when absent) |
| `photometric` | MONOCHROME1/2 or RGB; guessed from components when absent |
| `rescale` {slope, intercept} | samples → values; per frame under `perFrame.rescale[i]` when it varies |
| `window` {center[], width[], function} | the default window; per frame under `perFrame.window[i]` |
| `frameTimeMs`, `cineRate` | cine speed; 100 ms a frame when both absent |
| `digests` {algorithm, frames[]} | the exactness check; **moves into the `.sbnd` entry** under the target |

The ingest also writes `width`, `height`, `channels`, `bitsAllocated`, `bitsStored`, `highBit`, `signed`,
`modality`, `min`, `max` and, for AV1, `representation` and `preset`; the viewer reads none of them. It writes no
patient or study identifier, on purpose (`ingest/from-dicom/dicom_series.py`, `display`).

**Measured** (`lab/page-open/README.md` §The order the page's files leave in, PORD `37d2af7`, synthetic 300-frame
metadata of ~120 KB gzipped): the transport file lands first in 112 of 112 visits whichever is asked first; the
metadata costs the dial +7 ms at 80 ms RTT and +29 ms at 160 ms. That is the bar a new path is held to.

**A prerequisite outside metadata:** today one server process serves one series named by path. The target's
`<StudyUID>/<SeriesUID>.sbnd` means a page names its study and series, and whatever serves frames or metadata
looks them up by those UIDs. Every option below assumes that step; it is shared, not a cost of one option.

## Decided, 2026-10-19 (the owner)

* **The metadata and the pixels live on the same host**, so no read of either crosses a network. That leaves the
  embedded engines (§3) and drops the libSQL server, Turso Cloud and libSQL's remote and replica modes.
* **The study database is built and updated at the PACS** (2026-10-20, correcting 2026-10-19's move to the PCS): the
  metadata will be updated after it arrives, so its creation, its updates, its table design and its files are ours.
  The PCS sends the parser's groups and decides when a series or a study is complete; the PACS checks everything
  that arrives ([`design.md`](design.md) §5).
* **The client loads only what it needs**: the metadata the page uses now, and only the decoder of the series' codec.
  More is sent as more client features need it.
* **The parser's contract of 2026-10-11 stays** until a stable version is published
  ([`contract.md`](contract.md) §The parser at `f36230b`).
* **Whether SQLite is the store at all is open.** The parser's output comes first: [`contract.md`](contract.md)
  §The parser at `f36230b` records it.
* **Parked:** the catalog (deferred on 2026-10-11). How a study database is changed while it is read is no longer
  parked: updates are certain, so it returns with the storage shape (§2).

## The open points

### 1. How the page gets the metadata, and the codec before the decoder

*Extended 2026-10-20. Every number here is from [`../../lab/page-open/README.md`](../../lab/page-open/README.md) and
named by its run; everything else says **not measured**. Round trips (rt) are the slope against the link's round trip,
so 1 rt is 10 ms on the best link the owner names and 200 ms on the worst. Nothing in `lab/page-open` ran with loss,
on a phone, or past 300 ms; nothing below is claimed there.*

#### What the page needs, and by when

Three things, each needed at a different moment:

| what | needed before | today's source |
| --- | --- | --- |
| the codec | the decoder's files can be fetched, and the downloader started (`connect` takes the decoder) | `codec` in the metadata |
| the frame count | the fill is asked (`fill: all`, and the opening ask's `fill:0-N`) | `frameCount` |
| photometric, rescale, window, cine speed | the first frame is painted | the rest of the metadata |

**Today's viewer waits for the whole metadata before it dials** (`client/viewer/viewer.js` lines 19 and 125): the
dial needs the decoder and the fill's end. So the metadata's arrival is on the dial's path, not beside it.

**Today's cold open, measured** (headless Chromium, nginx over TLS and HTTP/2, a first frame of one flight):

```text
round trips   0        1        2        3        4        5        6        7        8
              ├────────┴────────┴────────┤        │                          │        │
              TCP + TLS + the HTML (3.0) │        │                          │        │
                                    the transport file (3.6–4.9)             │        │
                                    the metadata, same flight when small     │        │
                                             └── the dial: QUIC + CONNECT ───┘        │
                                                                    session (7.0)     │
                                                                  first exact frame (8.0)
```

HTML 2.94–3.01 (BOOT); transport file 3.60 (R2) to 4.92 (PORD, behind a resolver); session 7.00 and first exact
frame 7.99 for HTJ2K (COLDRTT, `htj2k`). A large first frame adds its slow start: 6.4 rt from session to a 428 KB
frame out of a 12 KB window (R2).

#### The four paths for the metadata

```text
 A0 today    browser ──HTTPS──▶ nginx ──alias──▶ <series>.metadata.json     (the ingest wrote it)
 A1 a file   browser ──HTTPS──▶ nginx ──alias──▶ the page view, a file      (the PACS builder wrote it)
 A2 a reader browser ──HTTPS──▶ a reader process on its own origin ──▶ the study store
 B  session  browser ══WebTransport══▶ series-server ──▶ the study store, beside the .sbnd
```

nginx and the server already run on one host and both mount the studies read-only
([`../../deploy/README.md`](../../deploy/README.md)), so A1 keeps the decided rule (metadata and pixels on the PACS
host) with nothing proxied. **A1 is new here**: the draft's A was a reader (A2). A1 is the owner's *page view*
direction (the handoff, 2026-10-20) served as a file: the builder derives it from the truth and publishes it by
rename beside the `.sbnd`, and nginx answers it as it answers today's JSON.

**A0 and A1, the web host before the connection.** The page asks for the metadata as it asks for the transport file,
from `client/viewer/head.js`, on the HTTPS connection the HTML came on.

* **Round trips: none of its own, measured.** PORD: the transport file landed first in 112 of 112 visits whichever was
  asked first, and ~120 KB of gzipped metadata cost the session +7 / +29 ms at 80 / 160 ms on HTTP/3, a constant.
* **What that hides for the viewer.** PORD's page dialled without waiting for the metadata, which landed after the
  transport file by +22 to +30 ms at 80 ms on HTTP/2 and +215 to +217 ms on HTTP/3. The viewer waits for it, so at
  120 KB its dial would start that much later: inferred from those arrival times, **not measured** on the viewer.
* **A page view of a few hundred bytes** (§4: no per-frame display, digests in the `.sbnd`) is one packet beside the
  transport file and costs nothing visible: **not measured**, below one flight.
* **Bytes:** the request's headers (a few hundred bytes) and the page view, gzipped by the template's `gzip_types`.
* **Under loss:** the page view rides TCP. One lost segment holds it, and the dial behind it, for a retransmit:
  **not measured**, and the relay's `--loss` reaches TCP only through `--tun` (`lab/scripts/link_impair.py`).
* **A1 against A0:** the same bytes on the same path, from a different file: PORD's numbers carry over. The address
  changes from `/series/metadata` to one naming the study and series (the shared prerequisite above).
* **Caching for free:** nginx already sends `ETag` and `Last-Modified` with `no-cache`, so a reopened page
  revalidates in one round trip and gets a 304 (§4's open caching point, without a generation number).

**A2, a reader on its own origin.** Everything A1 costs, plus a second HTTPS connection: TCP and TLS cost each
HTTP/1.1 preload 163 ms at 80 ms (H2), about 2 rt, before the first byte of the metadata. It runs beside the
transport file's fetch, but the viewer's dial waits for it: up to ~2 rt more to the session, **not measured**. It
also costs a process to deploy, a certificate, CORS headers, `Cross-Origin-Resource-Policy`, and the reader's origin
in the page's `connect-src`. Kept only for completeness: A1 does its job without the process.

**B, the server inside the session.** The page dials first and the series arrives with the frames.

What the wire would carry (a sketch, not a proposal yet): the server opens its media stream behind the accept, as it
does for the opening ask ([`../WIRE.md`](../WIRE.md) §The opening ask), and writes the series first, as an envelope
whose index is a reserved value:

```text
media stream:  [len][FF FF FF FF][codec 4 B · frame count u32 · the page view]  [len][0][frame 0]  [len][1][frame 1] …
               └─ the series, once a session ─────────────────────────────────┘  └─ as today ──────────────────────
```

* Why the media stream and not the control stream: the client opens the control stream, and with the opening ask it
  writes nothing on it until a later ask, so the server has nowhere to answer before then. A server-opened stream
  exists from the accept. Both clients already read every uni stream as envelopes, in every stream mode, and the
  WebSocket mapping carries the same bytes, so one reserved index covers all of them.
* **Round trips to the metadata: none after the session, inferred.** It leaves behind the accept in the opening ask's
  flight, so it lands with frame 0, at ~7.0 rt (COLDRTT's session) instead of ~4 (A0's). **Not measured.**
* **The first frame painted: ~8.0 rt, as today, if the codec is already known** (b, below) and the page view is a few
  hundred bytes: the decoder is preloaded from the HTML and the display values arrive just ahead of the frame.
  Inferred from COLDRTT `-pre`, **not measured**.
* **A large page view delays frame 0 behind it**: on one stream, PORD's 120 KB is about three slow-start flights out
  of a 12 KB window ahead of the frame, estimated, **not measured**. A1 sends the same bytes on the other connection,
  beside the dial. A B page view would have to stay small, or send its per-frame part after frame 0.
* **The fill's end:** the page no longer knows the frame count when it dials, and `parse_opening_ask` takes only a
  closed range, both ends numbers (`parse_opening_ask`, `server/src/transport/server.rs`). B needs an open-ended opening ask, a
  server and two-client change, or the count in the page's address.
* **A re-dial** (a restart, [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §An open page follows a server restart) brings
  the series again; the client must refuse a codec or count that changed under an open page.
* **Under loss:** the series rides QUIC with frame 0, so a lost packet costs a QUIC retransmit on that stream, not a
  TCP one in front of the dial. **Not measured.**
* **Bytes:** 8 B of codec and count, the page view, and the 8 B envelope head; no HTTP request.
* **The server's read** at each session accept: §2's page read, 0.65 ms (D) to 2.6 ms (B) for 2 000 instances,
  warm, one thread: about 1 % of a 200 ms round trip, and at the larger figure a quarter of a 10 ms one.

#### The codec, so that only its decoder loads

| | when the page knows it | cost to the first frame, cold | where the codec is written |
| --- | --- | --- | --- |
| a. in the metadata, by A0 or A1 | with the transport file, ~3.6–4.9 rt | today's: the preloads start one fetch after the HTML; **not measured** against b | the `.sbnd` header and the page view, which the builder copies from it |
| b. in the page's address, `?codec=` beside the UIDs | at the HTML, ~3.0 rt | **measured, none:** COLDRTT `-pre` (`codec.html` reads `?codec=`) put AV1 at 7.96–7.98 rt, HTJ2K's 7.99 | wherever the linker reads it from (a worklist), plus the header |
| c. in the metadata, by B | at the session, ~7.0 rt | as e | the header and the page view |
| d. load every decoder | — | refused: the client loads only what it needs | — |
| e. the series envelope, first in the session | at the session, ~7.0 rt | between 1 and 4 rt, **not measured**; bounded by COLDRTT `-before`, AV1's files found one after another from the first payload: +2.0 rt through WebCodecs, +3.9 through dav1d | the `.sbnd` header alone |
| f. the first frame's own bytes | at frame 0, ≥ 8.0 rt | COLDRTT `-before`: +2.0 / +3.9 rt for AV1, measured; HTJ2K's, **not measured** | nowhere: the page guesses from the bytes (an HTJ2K codestream starts `FF 4F`; an AV1 payload's first byte is its version, 1), which [`../WIRE.md`](../WIRE.md) §The envelope says the envelope does not name |

* **e can be cheaper than `-before`.** The series arrives ahead of frame 0, and the page can preload every file of the
  codec at once, as `head.js` does now, instead of one after another. One round trip and the decoder's bytes on the
  open HTTPS connection is the floor; dav1d's WASM is 238 KB gzipped. With a large first frame the load overlaps the
  frame's own slow start and may cost nothing. All **not measured**.
* **f** needs no wire change but the downloader must start without a decoder, and a guess from bytes is not a
  contract: a third codec could share a first byte.
* **b is a hint, not a source.** A page that preloads from `?codec=` still checks the codec against its source (the
  page view, or the series envelope) and fetches the right decoder on a mismatch, so a wrong or stale link costs
  round trips, never a wrong decode. Adding b later is the head script's preload; dropping it is links that stop
  writing it.

#### What each costs both clients and the contract suite

| | A1 a file | A2 a reader | B the series in the session | e the codec in the session, the rest by A1 | f the first frame | b the address hint |
| --- | --- | --- | --- | --- | --- | --- |
| [`../WIRE.md`](../WIRE.md) | nothing | nothing | the reserved index; an open-ended opening ask | the reserved index, 8 B | nothing | nothing |
| TS client (`client/transport/ts/`) | nothing | nothing | read the series envelope, hand it up | the same | nothing | nothing |
| WASM client (`client/transport/wasm/src/session.rs`) | nothing | nothing | the same, in Rust | the same | nothing | nothing |
| downloader and consumer | nothing | nothing | a message carrying the series to the page; start without a decoder | start without a decoder | the same | nothing |
| `client/viewer/` | the address by UIDs | the address and the origin | dial first, the metadata after | the decoder after the session | the decoder after frame 0 | preload from the address, check it |
| contract suite (`client/contract/`) | nothing | nothing | a clause on every implementation (TS over WebTransport and WebSocket, WASM), both fakes pushing the series, a re-dial clause, `run_wire.sh` against the server | the same | dispatch-rig clauses for a late decoder | a page-check case for a wrong hint |
| server | nothing | nothing | read the store at the accept; send the series | send the header's fields | nothing | nothing |
| deploy, dev host | an nginx location and the `dev-server.py` path, by UIDs | a new service, certificate, CORS, CSP | `/series/metadata` goes | as A1 | as A1 | nothing |

#### The measurements that would settle what is not measured

Each in `lab/page-open`, the arms interleaved in Williams order inside every round (`CLAUDE.md` §Measurement), cold
and warm profile, at 1× and 4× CPU, at 10, 40, 100 and 200 ms; the ±0.2 rt spread of §The first byte on a fill as
the noise, and nothing claimed for a cell left with fewer than 8 paired rounds after the relay's `VOID`s.

1. **B against A1, to the first painted frame.** The viewer with the page view served by nginx (A1) against a server
   that sends the series envelope behind the accept (B), each at a page view of 0.5 KB and of PORD's 120 KB, the
   codec from `?codec=` in both so the decoder is out of the comparison. Quoted: first exact frame, in rt. Settles
   whether B's later metadata costs anything, and what a large page view costs on one stream.
2. **e, the decoder loaded from the session.** COLDRTT's `-pre` against a variant that preloads the codec's files on
   the series envelope, on HTJ2K, WebCodecs and dav1d, with COLDRTT's one-flight frame and a 428 KB one. Settles e's
   1–4 rt and whether a large frame hides it.
3. **a against b on today's viewer.** The viewer's head-script preload after the metadata against the same preload
   from `?codec=` at the HTML. Settles whether a worklist knowing the codec is worth anything with A1.
4. **Loss.** Arms 1 and 3 at 1 % and 5 % iid loss on both planes (`--loss` with `--tun`, so TCP loses too), and the
   Gilbert–Elliott model for a mobile link. Settles whether A1's TCP fetch in front of the dial costs more under loss
   than B's QUIC.
5. **A2's second connection**, only if A1 is refused: the viewer with the page view from a second origin against A1.

A real phone is outside this rig ([`../rig-limits.md`](../rig-limits.md)); 4× CPU is the nearest it reaches.

#### Switching later

| from → to | what changes | what is lost |
| --- | --- | --- |
| A1 → B | the wire change, both clients, the suite and the server's read: the same work as B now | nothing; the page view is the same document on another carrier |
| B → A1 | an nginx location and the page's fetch; the wire's reserved index retires | nothing |
| a → e (the codec read only from the file) | the page view stops carrying it; the series envelope does | 1–4 rt to the first frame unless b is also taken (measurement 2) |
| adding or dropping b | the head script's preload, and whoever writes links | nothing: it is a hint the page checks |

**Keeping switches cheap:** the page view's format is the same whatever carries it, and the viewer takes it from one
function that returns it, so a carrier change is that function and nothing above it.

#### Recommended: A1 with a, the page view as a file, the codec in it

The PACS builder writes each series' page view, with its codec and frame count, as a file beside its `.sbnd`;
nginx serves it as a static file under the study and series UIDs; the head script fetches it beside the transport
file and preloads that codec's decoder alone, as `head.js` does today.

* **It is the only path whose cost is measured:** PORD's, no round trip of its own and a constant +7 / +29 ms at
  120 KB; with the codec known before the dial, AV1 reaches HTJ2K's first frame (COLDRTT).
* **It changes neither client, nor the wire, nor the contract suite**; the work is the builder's file, an nginx
  location and the address. It keeps every decided rule: no proxy, the metadata on the PACS host, one decoder.
* **It is the page-view direction as a file**: derived from the truth, rebuilt with it, published by rename.
* **It costs:** a second program (nginx) reading a file the builder derived; the codec copied into it from the
  header, which is the owner's open question; and a TCP fetch in front of the dial, whose cost under loss is
  measurement 4.

**Runner-up: B with b,** the series in the session and the codec in the address. One program reads the study's
files, the metadata rides QUIC, and with the codec at the HTML the first frame is inferred to land as today. It
costs the wire change in both clients and the suite, an open-ended opening ask, and a worklist that knows the codec;
and its timing is inferred, not measured (measurement 1). If measurement 4 shows A1's fetch costing round trips
under loss, B is the path, and switching to it then costs what it costs now.

**The owner's decisions, not taken here:**

1. A1 (a file nginx serves) or B (the server, in the session) for the metadata. A2 needs a reason A1 cannot meet.
2. Whether a worklist should know the codec (b). Under A1 it is optional; under B it is what keeps the decoder off
   the first frame's path.
3. Whether the codec is written twice (the header, and the page view the builder copies it into) or read only from
   the file (e), at 1–4 rt until measurement 2 says otherwise.
4. Which of the five measurements to run first, if any; 1 and 4 decide between A1 and B.

### 2. How the parser's groups are stored

The parser writes each group (exam, series, instance, private) as one run of records, `[1 B key length][key][4 B
value length][value]` ([`contract.md`](contract.md) §Group files). A study's groups are kilobytes
([`contract.md`](contract.md) §Sizes). The question is the shape the PACS reads them from.

**One example through every option:** the CT instance in the parser's `doc/PACS/db/deck.db`, whose instance group
holds 45 attributes, among them (0020,0013) instance number `1 `, (0028,0004) `MONOCHROME2 ` and (0028,1052) rescale
intercept `-1024 `. In that database the keys carry DECK's 8-byte prefix; here is the intercept's record as stored:

```text
10 | 20 80 01 00 80 01 00 00 | 00 28 10 52 | 44 53 | 00 00 | 06 00 00 00 | 2D 31 30 32 34 20
KL   prefix sSSiIIFF          tag 0028,1052  "DS"    charset  VL = 6        "-1024 "
```

The page needs, per instance of the series: photometric, rescale and window, and the instance number for the order.

**A. The group files as written.** The parser's directory, untouched:

```text
<D>/<E>/--.024fdf3e…                     the exam group, 15 records
<D>/<E>/<S>/---.3b25bd8a…                the series group, 19 records, 599 B
<D>/<E>/<S>/<I1>/----.0f2469da…          instance 1, 45 records
<D>/<E>/<S>/<I2>/----.…                  instance 2, …
```

The read: open the series file and every instance file, walk each one's records, keep the tags the page needs. A
2 000-instance CT is 2 001 files opened per page open.

**B. Groups whole in SQLite, plus columns copied out of them.** The parser's `deck.db` shape, trimmed:

```sql
CREATE TABLE instance (iuid TEXT PRIMARY KEY, suid TEXT, number INTEGER, photometric TEXT,
                       slope REAL, intercept REAL, grp BLOB, blake3 BLOB);
-- one row:  'HB494Az5…', 'HB494Az5H3…', 1, 'MONOCHROME2', 1.0, -1024.0, <the 1 427 B group>, 0f2469da…
SELECT number, photometric, slope, intercept FROM instance WHERE suid = ? ORDER BY number;
```

The columns hold values that are also inside `grp`, copied out at build time so the read needs no parsing. They are
derived, like a book's index: the blob stays the truth, and the columns can be thrown away and rebuilt from it. A new
client need is a new column, filled again from the blobs of every study.

**C. One row per attribute.** DECK's key-value table (`doc/DECK/databases/README.md`):

```sql
CREATE TABLE kv (key BLOB PRIMARY KEY, value BLOB) WITHOUT ROWID;
-- one row per record:  x'2080010080010000 0028105244530000', '-1024 '
SELECT key, value FROM kv WHERE key >= :instance || x'00280000' AND key < :instance || x'00290000';
```

Keys sort by series, instance, then tag, so the page's tags of one instance (all in group 0028) are one contiguous
range, read in one step through the table's B-tree; a series is one such range per instance. Every attribute is
addressable, so a new client need is a new key list, with nothing rebuilt.

**D. A key file searched directly, with the values apart.** No database engine: the PACS writes two files per study,
the keys sorted with each value's offset and length, and the values back to back.

```text
keys.bin    [key 16 B][offset u32][length u32] …  sorted, fixed width
values.bin  "1 " "MONOCHROME2 " "-1024 " …
```

The read: a binary search in `keys.bin` (memory-mapped) finds the instance's first key, the following entries are its
attributes in tag order, and only the matching values are read from `values.bin`. The keys never mix with values or
lengths, so a search touches keys alone. Because instance numbers and tags increase, the position of a key can even be
estimated before searching (interpolation search). It is what C does inside SQLite — a sorted structure searched by
key — without SQL, without the B-tree's pages, and without the engine.

| | A | B | C | D |
| --- | --- | --- | --- | --- |
| a page open of a 2 000-instance series | 2 001 file opens and parses | one indexed query | 2 000 key ranges in one B-tree | 2 000 ranges by binary search |
| a new client need | parse more | a new column, rebuilt everywhere | nothing | nothing |
| what the PACS writes and maintains | nothing | SQL schema | SQL schema | the format, its writer, its reader, its checks |
| inspect with standard tools | yes, files | `sqlite3` | `sqlite3` | our own tool |
| the parser's own shape | its directory output | `deck.db` | `memorysqlite`, the databases README | none |

* **What decides it:** whether a custom format's speed is worth owning its writer, reader, checks and tools (D), against
  SQLite doing that (C); and whether every attribute must be addressable (C, D) or only the page's (B).

**Measured, 2026-10-19** ([`../../lab/metadata-store`](../../lab/metadata-store)): the page's read from each store, built
from the same groups, every read checked to hand back the same values first and C checked to give back every group
byte for byte. A series of N instances repeats the parser's CT instance group (45 attributes, 1 067 B) with its own UID,
number and position. Median µs over 300 rounds, the variants interleaved; a second run agreed within 5 %. One thread on
a 4-vCPU Xeon at 2.80 GHz, every file in the page cache: nothing here says what a cold disk or many sessions at once
cost.

| store, read | 4 instances | 200 | 2 000 |
| --- | ---: | ---: | ---: |
| A files (opens every file) | 53 | 2 895 | 29 806 |
| B columns, opened per read | 93 | 513 | 3 113 |
| B columns, held open | 7.4 | 150 | 2 602 |
| C rows, scan of the series, held | 24 | 1 208 | 12 550 |
| C rows, SQLite filtering the tags, held | 36 | 1 650 | 17 005 |
| C rows, seek per instance, held | 54 | 2 783 | 29 668 |
| D keys, scan, opened per read | 25 | 176 | 899 |
| D keys, scan, held | 0.9 | 51 | 646 |
| D keys, seek per instance, held | 3.0 | 184 | 1 949 |

| on disk | 4 instances | 2 000 |
| --- | ---: | ---: |
| A | 4 723 B in 5 files, 36 864 allocated | 2 151 799 B in 2 001 files, 16 388 096 allocated |
| B | 24 576 | 2 912 256 |
| C | 16 384 | 3 395 584 |
| D | 6 912 | 3 142 008 |

* **D's scan is the fastest read at every size:** 0.65 ms for 2 000 instances held, 4.0× B, 19× C, 46× A.
* **Its speed comes from the layout, not from skipping.** Seeking to each instance's page tags lost to scanning in both
  C (2.4×) and D (3.0×): a group is 45 attributes, so walking them costs less than three binary searches (D) or two
  SQLite statements, about 15 µs per instance (C). Keys apart from values, fixed width and no engine is what wins. A
  group much larger than 45 attributes (the 6 799 B private group of the same CT) could move that balance; not measured.
* **Letting SQLite filter the tags was slower than handing every row to the reader** (17.0 against 12.6 ms at 2 000).
* **Against the network:** at 2 000 instances A's 30 ms and C's 12.6 ms are a visible part of a 10–200 ms round trip;
  B's 2.6 ms and D's 0.65 ms are not.
* **Size:** B, C and D are within 17 % of each other. A's 2 001 small files take 7.6× their bytes on disk in 4 KB blocks.
* **Not measured:** any read but the page's (one attribute across a study, the whole study for an AI pipeline); the
  build or an update at the PACS; a cold disk; CPU at many sessions.

* **Switching later:** every shape is rebuilt from the groups, so a switch is a rebuild at the PACS, not lost data.

**Integrity under C and D.** The parser's BLAKE3 covers a whole group. C and D keep it checkable: the group's bytes are
its records in key order, so the PACS writes them back to back and hashes them on arrival — the same bytes, the same
BLAKE3 — then stores the rows. That proves the content equals what the parser wrote. A hash of the whole database
file is cheap (BLAKE3 runs at gigabytes a second; design.md §6 puts a 10 KB group at ≈ 1.5 µs) but proves only that the
file arrived as it was sent: the same rows can be stored as different file bytes (page layout, free pages, the
SQLite version), so it cannot be compared with anything the parser computed. Both have a use: the file's hash for the
transfer, the groups' for the content, and SQLite's `PRAGMA integrity_check` for the file's structure.

### 3. Which embedded engine

*Primary sources below (§Sources). All read the same file format, so a database built by one is read by the
others. Only the embedded columns apply now (Decided, above).*

| | rusqlite (plain SQLite) | libSQL embedded (`libsql`) | libSQL server (sqld) | Turso, the Rust rewrite (`turso`) |
| --- | --- | --- | --- | --- |
| what it is | the C library, bundled | a fork of SQLite's C library, in process | a server holding many databases (namespaces) behind an HTTP API | SQLite rewritten in Rust, in process |
| latest | 0.40.2, 2026-08-08; bundles SQLite 3.53.2 | 0.10.0, 2026-10-13; bundles SQLite 3.47.0 | `libsql-server-v0.24.33`, 2025-12-19; since then one doc fix (2026-05-14) | 0.8.3 stable 2026-10-12, 0.9.0-pre.1 2026-10-15; tracks SQLite 3.50.4 |
| licence | MIT | MIT | MIT | MIT |
| state | SQLite's own | "actively maintained, but new features are being developed in Turso" (its README) | no release in 10 months: maintenance **not confirmed** | pre-1.0, "currently in beta"; "keep independent backups" (its README) |
| open read-only | `mode=ro`, `immutable=1` (SQLite's URI flags) | the same C library | — | `Builder::read_only`, from the source only, not tried |
| JSON functions | SQLite's, JSONB since 3.45 | SQLite 3.47's | the same | all but `json_tree` (partial) |
| concurrent writers | one | one | one per database | `BEGIN CONCURRENT` on MVCC; its two documents disagree on whether it is experimental |
| reach over the network | no | remote mode and embedded replicas (features `remote`, `replication`) | yes | no SQLite-protocol server; an experimental PostgreSQL-wire one |

The owner's word in target.md is "Turso". Turso also names a hosted service, Turso Cloud, which hosts both libSQL and
Turso databases (Turso's there in "early preview"); whether it can be self-hosted is **not confirmed**. A PACS's own
disk holds the study databases under the target, so the hosted service is not on this path.

* **What decides it:** how much a pre-1.0 engine may cost in a medical archive (Turso), against one that is SQLite's
  own C (rusqlite) or a fork of it (libSQL).
* **Switching later:** cheap while two rules hold — the file stays plain SQLite format, and the SQL stays in the
  dialect all of them share. The reads sit behind one function that takes UIDs and returns the viewer's document;
  switching is that function and the dependency.

### 4. What the client fetches

The principle is decided: only what the page needs now. What remains open:

* **The unit:** one series (today) or the whole study. It follows what the viewer opens; it opens one series today.
* **Its size across the band:** with `digests` moved into the `.sbnd` entry ([`../disk-layout/target.md`](../disk-layout/target.md)
  §The two hashes), a series whose display does not vary per frame is a few hundred bytes at any frame count; per-frame
  rescale or window grows with frames. **Measured:** PORD's ~120 KB cost the connection +7 / +29 ms at 80 / 160 ms.
* **Caching:** today it is `no-cache`; a generation number in the study database lets a reopened page check its copy
  in one round trip.

### 5. Moving fixtures, the dev host and the gate off the JSON file

* **Fixtures.** Keep the committed JSON (text, reviewable in a diff) as the *input* the study database is built from,
  and build the database in the gate and at the dev host's start; or commit the built `.db` (binary, no build step).
  What decides it: whether a reviewer must read a fixture's metadata in a diff.
* **The dev host.** Under 1A1 it serves the builder's page-view file as nginx does; under 1B it serves no metadata.
  `--metadata` goes either way.
* **The gate.** The `pack-series` same-bytes check (`scripts/gate.sh:180`) packs `metadata.json` into the `.sbnd`;
  under the target it packs none, so that check changes with the target's format, not with this work.
  `deploy/check_equivalence.sh` lists `/series/metadata` among what the image answers; it goes with the JSON.
* **The lab.** `lab/container-bench` and `lab/viewer-ceiling` read the ingest's `metadata.json` as their input. It
  stays the ingest's output, so the lab keeps it.

## What the owner decides, in order

1. How the page gets the metadata and the codec (§1).
2. The groups' storage shape (§2), after its measurement if wanted; the codec's place (§1) is open with it.
3. The engine (§3).
4. The unit the page fetches (§4).
5. Fixtures as JSON input or a committed `.db` (§5).

## Sources

Fetched 2026-10-19, first 12 hex of the fetched file's sha256.

* **SQLite**: "35% Faster Than The Filesystem" (`2cba6be472d2`, the same as design.md §12); "How To Corrupt An SQLite Database File" (`e00709e3f37e`), §1.3 and §2.5; URI filenames, `immutable`
  and `mode=ro` (`9fba2ee18bc6`); WAL (`f3467b530b88`, the same as design.md §12).
* **The parser**: `github.com/opendicom/DECK_WebTransport` at `f36230b3f46c` (2026-10-16), read and run as
  [`contract.md`](contract.md) §The parser at `f36230b` records.
* **rusqlite** 0.40.2 on crates.io (`43b0cec6bd46`), its bundled `sqlite3.h` (`9e69a1353a42`), LICENSE
  (`c10c1f273375`).
* **libSQL** at `d8bc862d20be` (2026-10-13): README (`5a7d05bd5b34`, the same as design.md §12), `libsql/Cargo.toml`
  (`c9393a164fca`), `docs/ADMIN_API.md` (`a45a5003fa4a`); `libsql` on crates.io (`2c4b345f6b82`); Turso's docs,
  `libsql.md` (`ea0bd1401325`). sqld's last tag and commit from the repository's git history.
* **Turso** at `f9c3d9045c71` (2026-10-19): README (`fe932831cf8d`, the same as design.md §12), COMPAT.md
  (`28a771b01162`), `docs/manual.md`, `bindings/rust/src/lib.rs` lines 284–342; `turso` (`99f8bf2b2551`),
  `turso_core` (`cc08a07a0f95`) and `limbo` (`b365420bb9c7`) on crates.io. Turso Cloud: `turso-cloud.md`
  (`6f75c718aecf`), usage and billing (`b975c2fcfd32`); the pricing page could not be fetched.
