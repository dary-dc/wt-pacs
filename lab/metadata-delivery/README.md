# What each way of getting a series' viewer metadata costs

One row, for the owner's decision in [`docs/ingest/pacs-receive-design.md`](https://github.com/dary-dc/wt-pacs/blob/claude/pacs-design-state/docs/ingest/pacs-receive-design.md)
§6 (open): the owner prefers that a serving process read the series' metadata from the study DB when the series is
opened; #145 and #153 ([`docs/adr/viewer-metadata.md`](../../docs/adr/viewer-metadata.md)) recommend derived files.
This directory builds each way minimally and measures it on the user's path and on the host. It ranks nothing: the
ADR's ranking is unchanged, and the decision is the owner's.

## The arms

Every arm delivers the same document, byte for byte before compression: the series' **paint metadata** (the shared
values and one entry per frame: number, position, window, rescale; no identifier) and the study's **study fields**
(the overlay's patient and study text). Every arm gzips it at level 6 and the page decompresses it; every arm gets its
frames over the same WebTransport session from the same serving process.

| arm | where the document comes from | delivered |
| --- | --- | --- |
| **A1-instances** | the serving process opens the study DB at the request (rusqlite in `spawn_blocking`), reads the paint values from every instance row of the series and the study fields from the exam row, in one read transaction, and builds the document | HTTPS: an endpoint of the serving process behind nginx, same origin as the page |
| **A1-ready** | the same, but the paint metadata from a **ready per-series row** the receiver writes in the same transaction as the instances | HTTPS, the same endpoint |
| **A2-instances**, **A2-ready** | as A1's two, read when the session is accepted | the session's **first message**, on the server's first stream, ahead of frame 0 |
| **B** | one file per series derived by the receiver after its commit (`.partial` → `fsync` → `rename`) | nginx, `gzip_static`, `no-cache` + `ETag` (#145's option 1) |
| **B′** | B again: the A/A arm, whose spread against B is the noise band | as B |
| **C** | #153's split: a paint file per series (no identifier) and a study file per study, both derived as B's | nginx, two requests on one connection; paint `no-cache` + `ETag`, study `no-store` |

**The study DB** (design state §4, T1): one SQLite file per study; a table per level (`exam`, `series`, `instance`,
`private`), one row per group, the group's bytes, its XXH3-64, keyed by UID. The paint values A reads per instance are
**copied columns** of the instance row, as in the PCS team's 2026-04-28 sample database (design state §4: "instance
ones are display metadata"); the study fields are copied columns of the exam row. The ready row is a fifth table,
`series_paint`. Groups are real: the `ct` series of #150's manifest (TCIA, ACRIN-NSCLC-FDG-PET, 262 instances, CC BY
3.0) split by the parser's level table as #150 splits it. A second series, `ct2000`, repeats ct's instance groups to
2 000 instances with positions continued (*synthetic*, to reach the design state's 2 000-instance figure).

**The page** (`page.html`) is one HTML file with its script inline. Arms A1, B, B′ and C fetch the transport file
and the metadata together, then dial with the metadata's digest, as #145 §2 has the viewer do. A2 fetches the transport
file and dials. Every arm's server sends frame 0 behind the accept. **Frame 0** is the ct series' first slice, its
samples gzip-coded as a stand-in for HTJ2K (the page's decode is `DecompressionStream`, not the product's decoder). The
page paints it through the metadata's window and rescale onto a canvas: **first painted frame** is the
`requestAnimationFrame` after `putImageData`. Times are `performance.now()`, whose origin is the navigation's start.

**The links** are #156's classes (`lab/metadata-store` on `claude/update-compression`): the container has no netem,
so two network namespaces are joined by two TUN devices and a forwarder that delays, rate-limits (a 100-packet FIFO)
and drops packets, both ways. The browser (Playwright's Chromium) runs in one namespace; nginx and the serving process
in the other.

| link | RTT | up / down | loss each way |
| --- | ---: | --- | ---: |
| floor | 0 | — | 0 |
| fiber | 10 ms | 100 / 100 Mbit/s | 0 |
| 4G/5G | 60 ms | 19 / 100 Mbit/s | 1 % |
| GEO | 600 ms | 2 / 10 Mbit/s | 0.1 % |

**Cold** is a fresh browser profile; **warm** is the same profile relaunched after one visit (the HTTP cache full,
every connection new). A round visits every arm and series cold then warm, in an order rotated round by round.

**On the host**, without the link: (H1) the CPU and wall time of one open's metadata work, in process, every arm
interleaved; (H2) the server's CPU per request and its peak descriptors and memory with `h2load` holding 1, 100 and
1 000 concurrent viewers over HTTPS across 1, 10 and 100 studies; (H3) descriptors and memory of study DB connections
held open, one per viewer and one per study, at the same counts. SQLite's journal is WAL unless a row says rollback.

**Consistency.** A receiver process applies updates to one study in a loop (alternately a study-field correction and
a window correction to every instance, each stamping a revision) and derives B's and C's files after each commit;
reader threads read as each arm reads. A read is **torn** if its document mixes revisions; C's pair is **never
committed** if its two files' revisions were never committed together; **staleness** is how long before the read
began a newer revision had committed.

## Pre-registered, 2026-10-26, before anything here was built or run

| # | Prediction | Contradicted if |
| --- | --- | --- |
| U1 | To the metadata, A1-instances, A1-ready, B and C tie (within the band below) on every link, cold and warm, at 262 instances | one is outside the band |
| U2 | At 2 000 instances, A1-instances holds the metadata 2–8 ms later than B on every link (its query, build and gzip); outside the band on fiber only | otherwise |
| U3 | C ties B to the metadata and to the first painted frame on every link, cold and warm | otherwise |
| U4 | A2 holds the metadata ≥ 1.5 RTT later than B, cold, on every link with a delay (it waits for the dial) | less |
| U5 | To the first painted frame, cold, A2 ties B at 262 instances, and ties or beats B at 2 000 | A2 slower outside the band |
| U6 | Warm, A2 ties B to the first painted frame at 262 instances and is slower by ≤ 1 RTT at 2 000 (B answers 304; A2 resends the document ahead of frame 0) | otherwise |
| U7 | Every arm's first painted frame lies within 0.5 RTT of max(metadata, frame bytes) + the decode: no arm adds a round trip of its own after both are in hand | otherwise |
| H1 | In process, connection opened per read: A-instances 0.6–2 ms of CPU at 262 instances, 3–8 ms at 2 000; A-ready ≤ 2 ms at either (the open dominates, 0.9–1.4 ms in #151); a file read for B or C ≤ 50 µs | outside |
| H2 | Server CPU per request at concurrency 1: B and C ≤ 0.3 ms (nginx's TLS and HTTP/2 work); A1 adds H1's figure ± 0.5 ms | otherwise |
| H3 | Open-read-close (A1): peak descriptors ≤ 3 × min(viewers, 512) above idle, none held after the burst; peak memory ≤ 1 MiB per concurrent open; nginx serving B or C holds no file descriptor after a request | otherwise |
| H4 | A connection held after one read: 3 descriptors in WAL (the file, `-wal`, `-shm`), 1 in rollback; memory ≤ 300 KiB after a ready-row read and ≈ 2 MiB after an instance read of ct2000 (SQLite's default cache cap): ≈ 2 GiB at 1 000 viewers held one per viewer | otherwise |
| C1 | No torn read in any arm (A in one read transaction, B and C by `rename`) | one torn read |
| C2 | C pairs files from states never committed together in some reads when updates fall between its two fetches; A and B never | C never, or A or B ever |
| C3 | Staleness: A-instances and A-ready 0 beyond the commit; B and C up to the derive, ≤ 20 ms at p99; in rollback mode A's reads wait during a commit (p99 read time ≥ the commit's) and never fail with a busy timeout set | otherwise |

**The band.** In a cell (link × cold/warm × series), two arms tie if their medians differ by less than
max(|B − B′|, 2 ms, 3 % of B). Latency only: milliseconds, median and p90, never a rate.

**The decision rule, fixed now.** The owner's option is **not contradicted on the user's path** if, on every link,
cold and warm, at both sizes, its better delivery (A1 or A2) ties or beats B to the first painted frame. It is **not
contradicted on the host** if its better sub-arm costs ≤ 2 ms of CPU an open at 2 000 instances, and 1 000 viewers
cost ≤ 3 000 descriptors and ≤ 1 GiB in the policy the serving process would use. It is **not contradicted on
consistency** if no read tears and it is never staler than B. Each failure is named with its cell; what follows from
it is the owner's.

**Where the host saturates.** The browser, the forwarder, nginx and the serving process share four vCPUs. The floor
link (no delay, rate or loss) is run in every round; no difference below its spread is claimed, and H2's rates are
reported only up to the concurrency at which requests a second stop growing.
