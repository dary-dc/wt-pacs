# What each way of getting a series' viewer metadata costs

One row, for the owner's decision in [`docs/ingest/pacs-receive-design.md`](https://github.com/dary-dc/wt-pacs/blob/claude/pacs-design-state/docs/ingest/pacs-receive-design.md)
(`e699ed3d`) §6 (open): the owner prefers that a serving process read the series' metadata from the study DB when the series is
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

**The links** are #156's classes (`lab/metadata-store` on `claude/update-compression` at `cbc339d2`): the container has no netem,
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

## Run

As root, with nginx, `h2load` (nghttp2-client), `certutil` (libnss3-tools), `ip` (iproute2), Playwright's Chromium,
and a venv holding `numpy`, `pydicom` (the ingest's pins) and `xxhash`. Outside the workspace: nothing here enters the
gate's build.

```bash
python3 fixture/fetch.py DATA ct                        # #150's pinned TCIA series, checked file by file
python fixture/build.py DATA FIX                        # FIX/template.db, FIX/frame0.gz
cargo build --release
METADATA_DELIVERY_FIXTURE=FIX cargo test --release      # the document, the snapshot, the rename
python3 consistency_test.py && python3 summary_test.py
B=target/release/metadata-delivery
$B prepare FIX ROOT --studies 100                       # WAL; ROOT-delete with --journal delete
python3 links.py ROOT RUN > links.ndjson                # the user's path; summary.py links.ndjson --markdown
$B cost ROOT --rounds 300 > cost.ndjson                 # H1
python3 host_load.py h2 ROOT RUN2 > h2.ndjson           # H2, nothing else running
python3 host_load.py hold ROOT > hold.ndjson            # H3; again on ROOT-delete with --journal delete
python3 consistency.py run ROOT wal && python3 consistency.py run ROOT-delete delete
python3 consistency.py summary wal delete
```

## Measured, 2026-10-26

*Against the pre-registration above, committed before anything was built (`3e77cce`).* One host: 4 vCPU (Xeon @ 2.80
GHz), Linux 6.18, nginx 1.24.0 (HTTP/2, 2 workers), Chrome for Testing 153.0.8010.12 headless (Playwright), the
product's patched wtransport 0.7.2 (early SETTINGS), rusqlite 0.41.0 (bundled SQLite), h2load 1.59.0. **nginx** serves
B and C (not a stand-in). Raw rows in [`results/`](results/); every number below is a median unless it says p90/p99.

**The document.** ct (262 frames): 19 885 B of JSON, **2 220 B** gzipped; ct2000: 145 964 B, **12 838 B**. C's two
files: 2 075 + 160 B and 12 656 + 160 B. Frame 0: 183 307 B. The study DB: 5.4 MB (both series, every group).

**Deviation.** The floor link ran as its own block of 12 rounds before the others, not inside every round; the arms
were interleaved, rotated round by round, within every link (12 rounds floor and fiber, 16 on 4G/5G, 8 on GEO; 1 344
visits, 0 errors). The band above uses B′ against B per cell, so the floor's spread is in each cell's own band.

### The user's path

Milliseconds from the navigation's start, median (p90); **bold** is the difference from B where it is outside the
band. A warm B, A1 or C revalidates and gets a 304 (C's `no-store` study file is fetched whole); A2 resends the
document. Time to the **metadata**:

| link | arm | ct cold | ct warm | ct2000 cold | ct2000 warm |
| --- | --- | ---: | ---: | ---: | ---: |
| floor | a1-instances | 71 (80) | 67 (72) **+9** | 75 (81) **+6** | 67 (72) **+9** |
| floor | a1-ready | 68 (82) | 52 (72) | 82 (95) **+13** | 64 (75) **+6** |
| floor | a2-instances | 83 (90) **+20** | 69 (77) **+11** | 88 (93) **+19** | 68 (84) **+10** |
| floor | a2-ready | 78 (113) **+14** | 74 (81) **+16** | 84 (113) **+14** | 76 (88) **+18** |
| floor | b | 63 (68) | 58 (68) | 69 (85) | 58 (74) |
| floor | b-again | 73 (96) | 49 (67) | 69 (82) | 56 (71) |
| floor | c | 72 (86) | 63 (77) | 76 (91) **+7** | 68 (73) **+10** |
| fiber | a1-instances | 103 (111) **-7** | 99 (106) | 113 (117) **+7** | 102 (109) |
| fiber | a1-ready | 101 (119) **-9** | 95 (103) **-4** | 110 (123) | 97 (109) **-5** |
| fiber | a2-instances | 140 (147) **+30** | 134 (149) **+35** | 170 (184) **+64** | 152 (159) **+51** |
| fiber | a2-ready | 138 (155) **+28** | 131 (140) **+33** | 163 (170) **+57** | 152 (162) **+50** |
| fiber | b | 110 (119) | 99 (107) | 106 (115) | 102 (113) |
| fiber | b-again | 106 (111) | 98 (105) | 112 (119) | 101 (108) |
| fiber | c | 108 (123) | 96 (105) | 110 (129) | 101 (111) |
| 4g5g | a1-instances | 302 (374) | 289 (321) | 312 (369) **+12** | 304 (378) **+15** |
| 4g5g | a1-ready | 297 (437) | 288 (351) | 307 (550) | 296 (445) |
| 4g5g | a2-instances | 433 (682) **+135** | 427 (617) **+139** | 506 (672) **+205** | 501 (562) **+211** |
| 4g5g | a2-ready | 435 (816) **+138** | 424 (567) **+136** | 500 (624) **+200** | 488 (836) **+199** |
| 4g5g | b | 298 (382) | 288 (295) | 300 (382) | 289 (370) |
| 4g5g | b-again | 292 (388) | 291 (505) | 300 (474) | 292 (408) |
| 4g5g | c | 295 (306) | 292 (380) | 304 (699) | 292 (372) |
| geo | a1-instances | 2471 (2486) | 2465 (2470) | 2498 (2501) | 2476 (2487) |
| geo | a1-ready | 2474 (2485) | 2464 (2472) | 2489 (2491) | 2471 (2477) |
| geo | a2-instances | 3697 (3705) **+1227** | 3689 (3692) **+1228** | 4309 (4314) **+1825** | 4302 (4320) **+1838** |
| geo | a2-ready | 3698 (3699) **+1228** | 3691 (3701) **+1230** | 4309 (5045) **+1825** | 4295 (4298) **+1831** |
| geo | b | 2470 (2478) | 2461 (2465) | 2484 (2488) | 2464 (2468) |
| geo | b-again | 2466 (2469) | 2461 (2468) | 2487 (2490) | 2465 (2468) |
| geo | c | 2471 (2476) | 2464 (2465) | 2484 (2499) | 2464 (2465) |


To the **first painted frame** (the frame's bytes land 17–25 ms before it on every link: the decode and one
`requestAnimationFrame`):

| link | arm | ct cold | ct warm | ct2000 cold | ct2000 warm |
| --- | --- | ---: | ---: | ---: | ---: |
| floor | a1-instances | 112 (123) **+7** | 105 (111) **+6** | 111 (115) **+5** | 101 (108) |
| floor | a1-ready | 109 (124) **+3** | 93 (120) **-6** | 117 (128) **+11** | 102 (111) |
| floor | a2-instances | 110 (114) **+5** | 97 (105) | 111 (116) **+4** | 100 (107) |
| floor | a2-ready | 106 (131) | 99 (114) | 102 (130) **-4** | 97 (112) |
| floor | b | 106 (115) | 99 (104) | 106 (116) | 98 (107) |
| floor | b-again | 106 (123) | 103 (111) | 108 (119) | 93 (117) |
| floor | c | 113 (124) **+7** | 100 (112) | 112 (121) **+6** | 103 (115) **+5** |
| fiber | a1-instances | 204 (219) **-8** | 201 (209) | 216 (220) | 204 (218) |
| fiber | a1-ready | 200 (220) **-12** | 198 (203) | 214 (227) | 203 (215) |
| fiber | a2-instances | 209 (216) | 200 (213) | 228 (238) **+21** | 211 (216) |
| fiber | a2-ready | 205 (234) **-6** | 202 (210) | 217 (222) **+9** | 206 (218) |
| fiber | b | 212 (220) | 200 (211) | 208 (228) | 206 (219) |
| fiber | b-again | 208 (217) | 198 (214) | 216 (224) | 209 (219) |
| fiber | c | 209 (224) | 198 (210) | 213 (228) | 203 (219) |
| 4g5g | a1-instances | 828 (1174) **+44** | 814 (1426) | 825 (1533) | 787 (1193) |
| 4g5g | a1-ready | 764 (1104) | 726 (823) | 779 (1520) | 791 (1453) |
| 4g5g | a2-instances | 763 (983) | 812 (1286) | 784 (1830) | 756 (1096) **-42** |
| 4g5g | a2-ready | 1108 (1574) **+324** | 757 (1441) | 811 (1301) | 796 (1293) |
| 4g5g | b | 784 (1342) | 750 (1142) | 917 (1480) | 798 (1545) |
| 4g5g | b-again | 818 (1107) | 816 (1348) | 771 (1287) | 781 (1093) |
| 4g5g | c | 773 (1071) | 897 (1305) **+147** | 820 (1707) | 965 (1431) **+167** |
| geo | a1-instances | 6169 (7352) | 6161 (6185) | 6182 (6195) | 6165 (6183) |
| geo | a1-ready | 6162 (6287) | 6143 (6368) | 6181 (6214) | 6152 (6186) |
| geo | a2-instances | 6191 (6478) | 6178 (6557) | 6216 (6273) | 6223 (6227) |
| geo | a2-ready | 6176 (6184) | 6181 (6188) | 6505 (7094) **+338** | 6264 (6531) |
| geo | b | 6143 (6172) | 6144 (6170) | 6167 (6835) | 6154 (6172) |
| geo | b-again | 6165 (6227) | 6163 (6182) | 6270 (6759) | 6175 (6512) |
| geo | c | 6165 (6243) | 6144 (6159) | 6166 (6205) | 6156 (6164) |


* **A1 (the study DB read at the request, over HTTPS) ties B to the metadata and to the first painted frame on
  fiber, 4G/5G and GEO**, both sizes, cold and warm, but for a few cells: fiber cold ct 7–12 ms *faster* to paint;
  the instance read 12–15 ms later to the metadata at ct2000 on 4G/5G and 44 ms later to paint at ct cold on 4G/5G
  (its band there 34 ms). A1-ready is never outside the band on the slow side on those three links. The read at the
  request (1–12 ms) runs beside the transport file's fetch, so it is mostly off the path.
* **A2 (in the session) has the metadata 2–6.4 round trips later than B** (fiber +28 to +64 ms, 4G/5G +135 to +211,
  GEO +1.2 to +1.8 s): it waits for the dial. **To the first painted frame it ties B in 18 of 24 link cells**, since
  B also waits for the metadata before it dials; outside the band: +21 and +9 ms (fiber, ct2000, cold), +324 ms (4G/5G,
  ct, ready row, cold: losses), +338 ms (GEO, ct2000, ready row, cold), and −42 and −6 ms (faster).
* **C ties B** everywhere but 4G/5G warm, +147 and +167 ms, where B′ itself is 34–146 ms from B: loss.
* On 4G/5G at 1 % loss the band is 24–146 ms: the arms there decide nothing finer than that.

### The host

**H1, one open's metadata work in process** (`cost`, 300 rounds, every variant interleaved; µs of thread CPU,
median (p90); the study DB in the page cache):

| | ct, 262 frames | ct2000, 2 000 frames |
| --- | ---: | ---: |
| A-instances: open, read every instance row and the exam row, build, gzip | 1 749 (2 080) | 9 040 (10 327) |
| A-ready: open, read the ready row and the exam row, gzip | 823 (1 004) | 4 030 (4 537) |
| A-instances, the connection already open | 1 131 (1 336) | 7 621 (8 554) |
| A-ready, the connection already open | 422 (532) | 3 644 (4 161) |
| of which gzip at level 6 | 336 (410) | 3 253 (3 622) |
| the open alone | 93 (125) | 93 (125) |
| B: read the file | 17 (23) | 36 (44) |
| C: read the two files | 11 (15) | 15 (20) |

**Gzip is most of A-ready's cost** (81 % at ct2000): a ready row that stored the paint metadata already compressed
would cost about the open and one row read (*inference*, not measured: the study fields would then be a second gzip
member or a second message). A-instances spends 4.4 ms more at ct2000 on reading 2 000 rows and building the JSON.

**H2, through nginx over HTTPS** (h2load, one request outstanding per viewer, 1 000 opens per viewer count, 5 000 at
1 000 viewers; 3 rounds, the arms rotated; CPU from `/proc` at 100 Hz; descriptors and resident memory sampled every
5 ms, above the idle process):

| arm | series | CPU µs an open, serving process + nginx: 1 / 100 / 1 000 viewers | peak descriptors, serving process (nginx), 1 000 viewers, 1 / 100 studies | peak resident growth of the serving process, any cell |
| --- | --- | --- | --- | ---: |
| a1-instances | ct | 2620 + 350 / 4153 + 197 / 6076 + 328 | 2021 (2000) / 2424 (2000) | 91 MiB |
| a1-instances | ct2000 | 11500 + 470 / 12540 + 237 / 14454 + 360 | 2024 (2000) / 2572 (2000) | 803 MiB |
| a1-ready | ct | 1130 + 250 / 1717 + 180 / 2248 + 320 | 1972 (2000) / 1873 (2000) | 1 MiB |
| a1-ready | ct2000 | 4970 + 400 / 4600 + 200 / 4888 + 334 | 2017 (2000) / 2351 (2000) | 1 MiB |
| b | ct | 0 + 70 / 0 + 73 / 0 + 198 | 0 (1002) / 0 (1002) | 0 MiB |
| b | ct2000 | 0 + 90 / 0 + 77 / 0 + 202 | 0 (1002) / 0 (1002) | 0 MiB |
| c | ct | 0 + 150 / 0 + 110 / 0 + 228 | 0 (1002) / 0 (1002) | 0 MiB |
| c | ct2000 | 0 + 150 / 0 + 130 / 0 + 248 | 0 (1002) / 0 (1002) | 0 MiB |


* The serving process costs **0.3–2.6 ms more per open than H1** (the HTTP answer, `spawn_blocking`, tokio; nginx's
  proxy hop adds 0.2–0.4 ms of nginx's CPU over B's), and more again at 100–1 000 viewers (contention on 4 vCPU).
* **The host saturates** where the CPU per open meets 4 vCPU: ≈ 270 opens/s for A1-instances at ct2000 (14.5 ms each),
  ≈ 800/s for A1-ready at ct2000, ≈ 1 700/s for A1-ready at ct, ≈ 20 000/s for B, nginx's 0.2 ms (*inference* from CPU per open; no
  rate was measured). Nothing above is claimed past them; h2load shares the same 4 vCPU.
* **Descriptors**: open-read-close holds none after a burst (0 in every cell). At 1 000 viewers the serving process
  peaked at 1 872–2 572: 1 000 of them are nginx's upstream sockets, the rest study DB descriptors in flight (2 each in
  WAL, under the blocking pool's 512 threads). nginx holds 2 per viewer for A1 (client and upstream), 1 for B and C.
* **Memory**: the serving process grew by **803 MiB** in the first 1 000-viewer cell of A1-instances at ct2000 and did
  not give it back (glibc keeps freed memory in per-thread arenas; up to 512 blocking threads: *inference*); 91 MiB at
  ct. Because the growth is kept, the cells after the first show none, so this column does not separate the arms:
  H3's fresh process per cell does.

**H3, connections held open after one read** (`hold`, a fresh process per cell; growth over the process before
opening):

| | descriptors a connection | memory a connection | 1 000 viewers, one each | 1 000 viewers over 100 studies, one a study |
| --- | --- | ---: | --- | --- |
| WAL, instance read, ct | 2, + 1 a study file (`-shm`) | 0.68 MiB | 2 100 fds, 680 MiB | 300 fds, 73 MiB |
| WAL, instance read, ct2000 | 2, + 1 a study file | **2.1 MiB** | 2 100 fds, **2.1 GiB** | 300 fds, 215 MiB |
| WAL, ready read, either | 2, + 1 a study file | 0.15 MiB | 2 100 fds, 155 MiB | 300 fds, 20 MiB |
| rollback, the same reads | 1 | the same | 1 000 fds, the same | 100 fds, the same |

The memory is SQLite's page cache filling with what the read touched, capped by its default 2 000 KiB: an instance
read pages every instance row, whose group blob shares the page with the copied columns.

### Consistency

The receiver applied 1 336 revisions in 20 s (WAL) and 1 045 (rollback), every 5 ms, each a study-field or a window
correction to all 262 instances (and the ready row), then derived B's and C's files; one reader thread per arm:

| journal | arm | reads | torn | never committed | stale reads | stale p99 / max | read p50 / p99 / max |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| WAL | A-instances | 6 947 | 0 | 0 | 0 | 0 / 0 ms | 2.4 / 8.3 / 23 ms |
| WAL | A-ready | 21 377 | 0 | 0 | 0 | 0 / 0 ms | 0.55 / 5.0 / 17 ms |
| WAL | B | 23 686 | 0 | 0 | 3 837 | 4.0 / 19.5 ms | 0.68 / 2.7 / 18 ms |
| WAL | C | 23 944 | 0 | 0 | 8 071 | 8.3 / 22.5 ms | 0.69 / 2.1 / 20 ms |
| rollback | A-instances | 4 478 | 0 | 0 | 0 | 0 / 0 ms | 2.5 / **21** / **60** ms |
| rollback | A-ready | 14 469 | 0 | 0 | 0 | 0 / 0 ms | 0.46 / **12** / **60** ms |
| rollback | B | 25 734 | 0 | 0 | 3 210 | 3.3 / 8.2 ms | 0.66 / 1.6 / 14 ms |
| rollback | C | 24 225 | 0 | 0 | 6 337 | 7.6 / 36 ms | 0.68 / 1.8 / 13 ms |

The derive took 6.3 ms (p99 15 ms) after each commit. **A is never stale**: it reads the commit. B and C are stale
for one derive after each commit, and indefinitely after a crash between the commit and the derive until the receiver
re-derives at start (not run here: by construction). In rollback mode A's reads **wait** while a commit holds the file
(p99 2.5–8×, max 60 ms), never fail (`busy_timeout` 5 s); in WAL they do not wait. Here an update every 5 ms is a
stress: image-level corrections are "very rare" (design state §6). C's pairs were always committed states, because in
this receiver two adjacent revisions differ in one file only, so a pair one revision apart is still a state that
existed; a mismatched pair needs two updates between C's two fetches.

### Against the pre-registration

| # | Outcome |
| --- | --- |
| U1 | **contradicted on fiber, in A1's favour**: A1 had the metadata 4–9 ms *before* B (ct, cold and warm); ties on 4G/5G and GEO; on the floor A1-instances +9 ms warm |
| U2 | **contradicted**: A1-instances at ct2000 was +7 ms on fiber cold, +12 and +15 ms on 4G/5G (outside its 9 ms band), and tied on fiber warm and GEO |
| U3 | holds to the metadata on every link; **contradicted to the paint on 4G/5G warm** (+147, +167 ms, where B and B′ differ by up to 146 ms) |
| U4 | holds: 2.0–6.4 round trips later on every link with a delay |
| U5 | **contradicted in four cold cells**: +21 and +9 ms (fiber ct2000), +324 ms (4G/5G ct, ready row), +338 ms (GEO ct2000, ready row); ties elsewhere |
| U6 | holds: warm A2 ties B everywhere but 4G/5G ct2000 instances, 42 ms *faster* |
| U7 | holds: paint is 17–25 ms after the frame's last byte in every arm and link |
| H1 | holds at 262 instances (1.75 and 0.82 ms; files 11–36 µs); **contradicted at 2 000**: A-instances 9.0 ms (> 8), A-ready 4.0 ms (> 2), gzip 3.3 ms of it |
| H2 | B and C hold (≤ 0.15 ms at 1 viewer); **contradicted for A1**: the serving process costs 0.3–2.6 ms more than H1, not ± 0.5 |
| H3 | none held after a burst, and nginx holds no file for B or C: hold; **peak descriptors over 3 × 512** as counted (up to 2 572), of which 1 000 are nginx's upstream sockets; peak memory 0.8 MiB an open in flight, under 1 MiB, but **kept** by the process |
| H4 | **contradicted for WAL**: 2 descriptors a connection plus 1 a study file, not 3; rollback 1, ready ≤ 300 KiB (0.15 MiB) and ct2000 ≈ 2 MiB (2.1 MiB, 2.1 GiB at 1 000) hold |
| C1 | holds: no torn read in 144 860 |
| C2 | **contradicted**: C never paired files from states never committed together (the reason above); A and B never did |
| C3 | holds: A 0 ms; B and C p99 3–8 ms, max 36 ms; rollback A waits (p99 21 ms against WAL's 8), no error |

### By the decision rule fixed above

* **On the user's path, the owner's option is not contradicted.** Its better delivery, A1-ready, ties or beats B to
  the first painted frame on fiber, 4G/5G and GEO, cold and warm, at both sizes (on the floor link, the rig's own
  noise, +3 and +11 ms in two cells). A1-instances was 44 ms behind once (4G/5G, ct, cold). A2 ties in 18 of 24 cells
  but has the metadata 2–6.4 round trips later and lost 0.3 s in two cold cells.
* **On the host, it is contradicted at 2 000 instances by the rule's own threshold**: the better sub-arm, A-ready,
  costs 4.0 ms of CPU an open in process and 4.6–5.0 ms in the serving process, against 2 ms; 3.3 ms of it is gzip.
  At 262 instances it is 0.8 ms (1.1–2.4 ms served). 1 000 viewers open-read-close stay under 3 000 descriptors; held
  one connection a viewer, instance reads of a 2 000-frame series cost 2.1 GiB (over 1 GiB), ready reads 155 MiB; one
  connection a study, 20–215 MiB.
* **On consistency, it is not contradicted**: no read tore, and A was never stale where B and C were for up to 20–36
  ms; with a rollback journal its reads wait up to 60 ms behind a commit, which WAL removes.
* **What the rule does not weigh**: B and C cost 15–36 µs of disk reads an open and nothing held, against A's
  milliseconds and a serving process that keeps hundreds of MiB after a burst; A has no derived copy to keep current
  and nothing to re-derive after a crash. The weighing is the owner's.

### What it does not say

One host and an emulated link (a FIFO with Bernoulli loss, no burst loss, no radio scheduling); the browser,
nginx, the serving process and the forwarder share 4 vCPU, and on the floor link two runs of the same file differ by
up to 10 ms. The study DB is in the page cache: a cold disk adds its latency to A's read, and to B's and C's file
reads alike. One series a study DB of two series; a hospital's study holds more, and its instance groups may weigh
more, which moves A-instances' read time with them. Frame 0 is the real slice's samples gzip-coded and decoded by
`DecompressionStream`: a stand-in for HTJ2K and the product's decoder, the same in every arm. ct2000 repeats ct's
groups (*synthetic*). The serving process here is minimal: no authorization, no cache of connections, no
`prepare_cached` across opens beyond SQLite's own; A2 sends the whole document ahead of frame 0 (#153 §12 would put
the per-frame part after it).
