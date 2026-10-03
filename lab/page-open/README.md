# What a page open costs, in round trips

Navigation → the transport config → the session → the first frame, for the harness on both clients
and for the downloader, through [`../scripts/link_impair.py`](../scripts/link_impair.py), cold and
warm profile. Every figure is the **slope** of the milestone against the link's round trip, fitted
over the delays, so the relay's floor, the crypto and the decode fall out as an intercept rather
than inflating a ratio. What the harness itself cannot show is
[`../../docs/rig-limits.md`](../../docs/rig-limits.md) §3. What each lever is worth and whether it
is on is one table in [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §The session open;
this file runs the cells and keeps their tables.

```bash
NODE_PATH=$(npm root -g) node lab/page-open/run.mjs 3
HOST=h2 NODE_PATH=$(npm root -g) node lab/page-open/run.mjs 3   # nginx over TLS with HTTP/2; h1 without; dev is the default
# HOST=dns: every host behind a name, HTTP/2 against HTTP/3 — §The static plane
```

`run.mjs` takes `RTTS=` (default `0,40,80`), `STAGES=` (the first-byte ladder's rungs in place of
the three clients, cold only), `THROTTLE=N` (every browser thread N× slower,
[`../scripts/cpu_throttle.mjs`](../scripts/cpu_throttle.mjs)), `RELAY_ARGS=` (shapes each relay
beyond its delay), `ONLY=`, `SERVERS=`, `NETLOG=`, `ROWS=` and `PORT_BASE=`. `HOST=dns` runs as root.

A HOST run trusts its certificate through an NSS store of the browser's own (`certutil`, from
libnss3-tools), not `--ignore-certificate-errors`. Chrome caches nothing whose certificate had
an error, so ignoring it puts every worker script back on the wire and on the page's path —
two round trips of the dial, until 2026-09-24 (PO1).

Every file a visit fetches must be at least an hour old: one written seconds before gets no
heuristic freshness and revalidates on the wire (`rig-limits.md` §6). `run.mjs` and `host.mjs` age
what they write; three corrections below are this trap.

## The count, before and after

**R2, 2026-09-19, `852ae4f`.** Round trips of 0, 40 and 80 ms, three rounds. `config` is the
transport endpoint in hand, `session` the client connected, `frame` the first frame used by the page.

| arm | milestone | before | after | cut |
| --- | --- | ---: | ---: | ---: |
| TypeScript | config | 4.62 | 3.60 | −1.0 |
| | session | 9.69 | 6.64 | **−3.1** |
| | frame | 16.19 | 13.07 | −3.1 |
| WASM | config | 4.77 | 3.68 | −1.1 |
| | session | 11.86 | 6.72 | **−5.1** |
| | frame | 18.33 | 13.15 | −5.2 |
| downloader | config | 4.83 | 3.71 | −1.1 |
| | session | 12.53 | 6.37 | **−6.2** |
| | frame | 19.04 | 12.86 | −6.2 |

**Verdict: the preloads cut 3.1 / 5.1 / 6.2 round trips to the session, and the arms converge on
~6.5**, ~3.6 for the connection, the page and the config, and the 3.0 the dial cost then. A warm
profile spent none of this (`config` 0.0, `session` 2.6–3.1, the dial alone) before or after. The
6.4 from `session` to `frame` is the 428 KB frame's slow start out of a 12 KB window, not the page
(S7, `rig-limits.md` §3). *Corrected 2026-10-01 (DL0):* this table and the ladder below ran with a
config written seconds before the visit, so the page revalidated it; the cuts stand, the absolute
cold `config` and `session` counts are high by one to two round trips.

## The cuts, one at a time

| # | Change | Cold session, ts / wasm / downloader |
| --- | --- | --- |
| 0 | baseline | 9.69 / 11.86 / 12.53 |
| 1 | `preload` the transport config | 8.89 / 10.86 / 11.81 |
| 2 | `modulepreload` the shell and each arm's client | 6.70 / 6.70 / 11.84 |
| 3 | `preload` the worker, decoder and decoder WASM | 6.64 / 6.72 / **6.37** |

Cut 3 is the downloader's alone: its chain is page → consumer → downloader worker → decoder worker →
decoder glue → decoder WASM, each link found only once the previous one ran. A module worker has its
own module map, so a `modulepreload` there does nothing; the worker and decoder are `preload`ed as
scripts, which warms the HTTP cache the worker reads. `client/harness/downloader.html` carries none
of the three cuts; the lab's [`downloader.html`](downloader.html) does.

## The first byte on a fill

**R1/R3/R4, 2026-09-20, `d65f959`.** The first frame of a 12-frame fill, with
[`first-byte.html`](first-byte.html), one rung per `?stage=`, cold only, seven rounds a delay, the
arms interleaved in every round against one server. `today` sets `openAsk: false`: it is the page as
served before 2026-10-02, when the opening ask became the default.

```bash
RTTS=40,80,160 STAGES=today,no-r4,r3,r1,all NODE_PATH=$(npm root -g) node lab/page-open/run.mjs 7
```

| arm | what it is | `frame` | ms at 40 / 80 / 160 | `session` | `config` |
| --- | --- | ---: | --- | ---: | ---: |
| `today` | the load path, no opening ask | 14.57 | 718 / 1303 / 2467 | 8.36 | 4.35 |
| `no-r4` | minus the `preload` of `dist/session.js` | 15.73 | 792 / 1432 / 2681 | 9.54 | 4.36 |
| `r3` | `connect()` handed promises: the worker graph stops waiting for the config | 14.51 | 725 / 1295 / 2463 | 8.30 | 4.40 |
| `r1` | the opening fill rides the session URL (`?ask=fill:0-11`) | **13.44** | **677 / 1213 / 2289** | 8.28 | 4.42 |
| `all` | `r3` and `r1` together | 13.34 | 720 / 1219 / 2314 | 8.44 | 4.46 |

No arm moves `config` and only `no-r4` moves `session`, so their spread, **±0.2 round trips**, is the
fit's arm-to-arm noise; `run.mjs` kept no per-round range for this ladder. **Verdict: R1 −1.13 round
trips to the first frame, all of it between `session` and `frame`; R4 (already in cut 3) +1.16 when
removed; R3 −0.06, inside the noise** — cut 3 already preloads what un-gating would start early. A
device whose worker boot is slower than its dial would decide R3; this box is not one. Comparable
down the column only: a fill, a 40/80/160 fit and a loaded box make `today` unlike R2's downloader row.

## The dial before the config

**DL0, 2026-10-01, `5896c08`.** `inline` is `r1` with the transport URL written into the page
(`?wt=&hash=`) and no config fetch or preload. `dial0` opens a `WebTransport` in a head script and is
timed to `ready` only: **Chromium 141 neither clones nor transfers a `WebTransport`
(`DataCloneError`), so a session dialled in the page cannot reach the downloader's worker** — `dial0`
is a ceiling, not a shape the page can ship. A missing URL fails either rung.

```bash
RELAY_ARGS="--rate-kbit 100000 --queue-pkts 1000" RTTS=40,80,160 STAGES=today,r1,inline,dial0 \
  THROTTLE=4 NODE_PATH=$(npm root -g) node lab/page-open/run.mjs 9
```

Nine rounds in Williams order, a self-timed relay per visit, `VOID` visits dropped (31 and 21 of 108),
so a cell holds 3–9 rounds. 100 Mbit, because unshaped the relay was `VOID` in most visits
(`rig-limits.md` §6); comparable down these columns only.

| rung | `session` 1× | `frame` 1× | `session` 4× | `frame` 4× |
| --- | ---: | ---: | ---: | ---: |
| `today` | 6.93 | 13.39 | 6.13 | 12.41 |
| `r1` | 6.94 | 12.28 | 6.29 | 11.60 |
| `inline` | 5.99 | **11.04** | 5.67 | **10.87** |
| `dial0` | **3.92** | — | **3.96** | — |

**Verdict: the URL in the page is −1.24 round trips to the first frame at 1×, −0.73 at 4×, over
`r1`** (paired at 80 ms −51 ms, 4/4, and −31, 5/6; a tie at 40), less than the config's own ~2
because the preloaded worker graph lands about when the config did. **A head dial is ~2 more to the
session** (−167 ms at 80, every paired round) on this HTTP/1.1 page — the worker graph's boot,
which §The worker graph's boot prices on HTTP/2 and HTTP/3.

## The worker graph's boot

**BOOT, 2026-10-02, `89c8184`.** Four rungs on `inline`, built by [`boot.mjs`](boot.mjs), which
`run.mjs` calls; none moves a chunk through the page thread:

* `bundle` — the downloader worker and its transport as one esbuild file, preloaded where the worker was;
* `blob` — the worker's script carried in the page and started from a blob URL;
* `both` — the bundle carried in the page as a blob;
* `page` — `both` plus the consumer module inlined, so nothing is fetched between the HTML and the dial.

Every visit is held to two checks, each watched to fail on a mutant: the rung fetched none of what it
carries, and all 12 frames hash as the first `inline` visit's (359/359 bit-exact).

```bash
HOST=h2 RELAY_ARGS="--rate-kbit 100000 --queue-pkts 1000" RTTS=40,80,160 \
  STAGES=inline,dial0,bundle,blob,both,page THROTTLE=4 NODE_PATH=$(npm root -g) node lab/page-open/run.mjs 12
sudo HOST=dns RELAY_ARGS="--rate-kbit 100000 --queue-pkts 1000" RTTS=40,80,160 \
  STAGES=inline,dial0,bundle,both,page NODE_PATH=$(npm root -g) node lab/page-open/run.mjs 12
```

nginx on the deploy template over TLS and HTTP/2, 12 rounds Williams-ordered, 26 and 36 of 216
visits `VOID` (8–12 rounds a cell); the lab's HTTP/3 host (`HOST=dns`, `h3.test`, full Chromium),
55 and 44 of 180 `VOID` (3–11 paired rounds). The HTTP/3 host gzips HTML as nginx does; a run before
it did put the bundle pages 0.5–0.9 round trips late and was dropped.

| rung | HTTP/2 `session` 1× / 4× | HTTP/2 `frame` 1× / 4× | HTTP/3 `session` 1× / 4× | HTTP/3 `frame` 1× / 4× |
| --- | --- | --- | --- | --- |
| `inline` | 5.86 / 5.42 | 11.22 / 10.69 | 7.96 / 7.65 | 13.20 / 12.10 |
| `bundle` | 5.88 / 5.26 | 11.22 / 10.39 | 7.09 / 6.67 | 12.27 / 11.00 |
| `blob` | 5.99 / 5.25 | 11.08 / 10.32 | — | — |
| `both` | 5.89 / 5.15 | 11.10 / 10.36 | 5.83 / 5.31 | 11.00 / 9.91 |
| `page` | **4.84 / 4.58** | **10.08 / 9.60** | **4.73 / 4.48** | **9.94 / 8.67** |
| `dial0` | 4.98 / 4.93 | — | 4.97 / 4.67 | — |

**Verdict: on HTTP/2 only `page` moves round trips, −1.02 to the session and −1.14 to the first frame
at 1×, −0.84 and −1.09 at 4×** (at 80 ms −58 ms, 10/10, at 1×; a tie at 40 ms and 4×, where its
145 ms fixed cost eats the round trip). Over one connection the worker's script and its transport
land in the flight that brings `consumer.js`, so `bundle`, `blob` and `both` are within 0.13 of
`inline` at 1×; `bundle` and `both` save 32–70 ms of CPU at 4×, a constant, not a slope. **On the
HTTP/3 host every rung pays: `bundle` −0.9 to −1.1, `both` −2.1 to −2.3, `page` −3.2 to −3.4**, and
`page` reaches `dial0`'s slope — a reading of that host's interleaved slow start, not isolated, and
today's nginx serves no HTTP/3. No default changed; `consumer.js` takes `opts.worker`, the seam the
rungs need.

| rung | bytes (gzip) | asks of a deployment |
| --- | --- | --- |
| `bundle` | worker + transport 33 130 (9 300) in one file | a build step; away from `decoder.js` the page names `decoderWorker` |
| `blob` | page 5 985 → 20 484 (2 379 → 7 087) | `worker-src blob:`; `transport` and `decoderWorker` as absolute URLs; the worker re-sent with every HTML |
| `both` | page → 39 092 (11 300) | the two above |
| `page` | page → 46 684 (13 469) | the two above, a CSP hash or nonce for the page's module, and a page templated from each client build |

The HTML lands at 2.94–3.01 round trips in every rung on both hosts.

## The push in a browser, at 4×

**PUSH, 2026-10-02, `fa694ee`.** Row 93's rungs with enough rounds that every cell keeps nine or so
after the drops: `today` (no opening ask), `r1` (the push at session open, `openAsk`), `inline` (the
push plus the URL in the page).

```bash
RELAY_ARGS="--rate-kbit 100000 --queue-pkts 1000" RTTS=40,80,160 STAGES=today,r1,inline \
  THROTTLE=4 NODE_PATH=$(npm root -g) node lab/page-open/run.mjs 14
```

14 rounds Williams-ordered, 24 and 31 of 126 visits `VOID` (7–13 rounds a cell). The first frame
against `today` at 80 ms is the median difference and the rounds won.

| rung | `frame` 1× | `frame` 4× | `session` 1× | `session` 4× | at 80 ms, 1× / 4× |
| --- | ---: | ---: | ---: | ---: | --- |
| `today` | 13.18 | 12.41 | 6.91 | 6.05 | |
| `r1`, the push | 12.12 | **10.89** | 6.92 | 5.84 | −84, 9/13 · −77, 8/12 |
| `inline`, the push + the URL | **11.25** | **10.61** | 5.97 | 5.32 | −137, 9/13 · −130, 8/11 |

**Verdict: the push is −1.06 round trips to the first frame at 1× and −1.52 at 4×, the session
untouched; −1.9 and −1.8 with the URL inlined.** At 40 ms and 4× it wins 3 of 9 rounds. The leads by
predecessor agree in sign at 80 and 160 ms though most cells are `UNBALANCED` after the drops. On by
default since 2026-10-02 (`8f09e2c`). What a rebind re-applies is native:
`../../docs/transport/transport-conclusions.md` §3 (PUSH).

## Two servers, and the dial alone

`SERVERS=a=BIN,b=BIN` runs every arm against each server binary, interleaved inside each round,
each behind its own relay, and prints median [min–max] and the rounds each beat the first in;
`NETLOG=DIR` keeps Chrome's net log per visit for
[`../scripts/netlog_dial.py`](../scripts/netlog_dial.py). [`dial-blink.mjs`](dial-blink.mjs) is a
bare `new WebTransport` dial with a relay blackout at a chosen offset into it, or, at the offset
`swallow`, with exactly the server's first flight dropped (row 61). Both were built for
lever 2, the server's SETTINGS at 0.5 RTT, and its numbers are
[`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §Lever 2 — the dial
this file counts as 3.0 round trips is 2.1 with it.

```bash
SERVERS=unpatched=/path/a,patched=/path/b ONLY=ts NODE_PATH=$(npm root -g) node lab/page-open/run.mjs 8
SERVERS=unpatched=/path/a,patched=/path/b NODE_PATH=$(npm root -g) node lab/page-open/dial-blink.mjs 5
```

## Compression and cache headers

Landed in [`../../deploy/nginx/wt-pacs.conf.template`](../../deploy/nginx/wt-pacs.conf.template)
and asserted by `deploy/check_equivalence.sh`, **verified 2026-09-19 on a host nginx** with `--local`:
the eight harness paths answer as `dev-server.py` does, a module comes back gzipped, a hashed name
carries the immutable rule and the three isolation headers, each assertion watched to fail on a
mutated template. The built image is still unrun in a container.

| asset | bytes | gzip | flights of 12 KB |
| --- | ---: | ---: | --- |
| `transport_wasm_bg.wasm` | 342 573 | 130 813 | 5 → 4 |
| `openjphjs.wasm` | 299 948 | 95 754 | 5 → 4 |
| `openjphjs.js` | 58 074 | 14 788 | 3 → 2 |
| `transport_wasm.js` | 31 412 | 6 537 | 2 → 1 |
| `dist/session.js` | 15 342 | 4 698 | 2 → 1 |
| everything else (6 files) | 31 408 | 12 255 | 1 → 1 each |
| **total** | **778 757** | **264 845** | |

**Verdict: 2.9× fewer bytes and no round trip** — after the cuts the bundles are fetched beside the
dial, off the critical path. The immutable rule matches nothing yet (no build emits a hashed name);
the check probes it on a 404, because an `add_header` inside a `location` replaces the server's and
would silently drop cross-origin isolation.

### What an encoding costs on loopback

**ENC, 2026-09-27, `badcf76`, corrected `2426b8f`.** The downloader page (`?transport=wasm`, a
synthetic 300-frame study's metadata by `?meta=`) from nginx 1.24 over TLS and HTTP/2, each file
precompressed once (gzip `-6`, brotli `-q 11`, zstd `-19`) and served by its own server block only to
a client that lists the token. Before a run a request without the token must get the file, and every
visit must receive that arm's bytes; both checks were watched to fail. Headless Chromium 141 on
loopback, a fresh context a visit, the four arms rotated in every round, at 1× and 4×.

```bash
TRACE=0 NODE_PATH=$(npm root -g) node lab/page-open/enc.mjs 20   # the headline; without TRACE=0 the trace's milestones
```

Bytes: identity 814 393, gzip 259 850 (−68 %), br 213 000 (−74 %), zstd 228 665 (−72 %). Median ms
from navigation [range] and the rounds the arm beat identity in, n = 20:

| | identity | gzip | br | zstd |
| --- | ---: | ---: | ---: | ---: |
| first frame, 1× | 177 [163–214] | 181 [148–206] 11/20 | 185 [157–219] 7/20 | 175 [155–226] 10/20 |
| first frame, 4× | 530 [451–587] | 537 [442–614] 8/20 | 554 [479–690] 6/20 | 529 [454–644] 8/20 |
| decoder WASM's response end, 1× | 56 [44–63] | 59 [45–69] 7/20 | 67 [52–85] **3/20** | 60 [46–80] 6/20 |
| decoder WASM's response end, 4× | 127 [99–158] | 153 [107–189] **1/20** | 175 [113–192] **1/20** | 158 [102–204] 5/20 |
| network-service CPU a visit, 4× (10 ms ticks) | 80 | 80, more in 11/20 | 90, more in 16/20 | 80, more in 11/20 |

**Verdict: no encoding is resolvably later to the first frame on loopback, at 1× or 4×; one mode,
always on, is right on any link under ~200 Mbit/s, and gzip is enough** — within noise, 92 % of
brotli's saving; brotli leans latest and costs the network service the most CPU; zstd ties gzip but
Safari decodes it only from 26.3. At face value gzip breaks even at 700 Mbit/s and brotli at 206 at
4×. The cost that shows is the decoder WASM's arrival (+26 to +48 ms at 4×, cause not isolated) and
the network service's CPU; streaming compile still overlaps in every arm (n = 10, with the trace).
The template still gzips per request, whose server CPU is not measured; a deploy serving br or zstd
picks by `Accept-Encoding`, falling back to gzip and then the file. *Corrected 2026-09-27, before any
decision rested on it:* the first two batches served copies written seconds before the run, so every
decoder worker's fetch revalidated in the compressed arms only (brotli +44 / +35 ms, zstd +42 / +14 at
4×); an earlier version read that as nginx's behaviour. Each copy now carries its source's time.

## The first frame on a real host, with lever 2

**PO1, 2026-09-24, `e7211d6`.** The downloader arm from nginx over TLS: `HOST=h1` and `HOST=h2`
invocations alternated round by round, and inside each, lever 2 on and off (`SERVERS=on=…,off=…`, the
second this tree without `[patch.crates-io]`). 7 rounds at `RTTS=40,80`, cold and warm. Each stage is
timed from the previous one; round trips are the slope from 40 to 80 ms, cold, HTTP/2:

| stage | lever on | lever off |
| --- | --: | --: |
| TCP + TLS + HTML | 3.0 | 3.0 |
| scripts | 0.45 | 0.9 |
| config | 0.9 | 1.05 |
| **dial** | **1.85** | **3.0** |
| frame | 6.5 | 6.2 |
| **first frame on screen** | **12.65** (720 ms at 40, 1 226 at 80) | **14.35** (738, 1 312) |

**Verdict: lever 2 takes a round trip off the dial in all eight cells** (−77 to −86 ms at 80, 7/7) and
the first frame keeps it (−63 to −83 ms, 6/7 or 7/7). **HTTP/2 takes the config's round trip**: on
HTTP/1.1 the config is 2.15 cold against 0.9, the first frame 1 325 ms at 80 against 1 226; warm they
tie (alternated, not interleaved). *Corrected 2026-09-27 (H2):* the config's second request, read
first as the page's `fetch()` missing the preload, was the harness's freshly written file; aged an
hour it is answered from cache in 0–8 ms, 8/8. *Corrected before it was published:* a first run left
`--ignore-certificate-errors` in place and put the dial at 3.95 round trips with the lever.

## The worker graph over HTTP/1.1 and HTTP/2

**H2, 2026-09-27, `bde3e52`.** [`h2.mjs`](h2.mjs) serves the downloader page from nginx on the deploy
template (gzip on) over each protocol, three pages each: `bare` (no hints), `today` (cuts 1–3), and
`module` (`bare` plus a `modulepreload` of the worker graph). Six arms rotated, n = 10, cold, each
visit checked against its protocol. The page's TCP crosses `link_impair.py` at 40 ms each way,
20 Mbit/s, `--tcp-rate shared`, not DevTools emulation, which reached neither the decoder workers'
`fetch()` nor connection setup. The WebTransport session is not shaped.

```bash
NODE_PATH=$(npm root -g) node lab/page-open/h2.mjs 10    # LINK=20,80 (Mbit/s, round trip ms)
```

ms from navigation, median [range], and the rounds each arm beat HTTP/1.1 `bare` in:

| | h1 bare | h2 bare | h1 today | h2 today | h1 module | h2 module |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| config | 453 | 451, 6/10 | 454 | **367** | 609, 0/10 | 455 |
| downloader worker's script asked | 454 | 454 | 270 | 268 | 267 | 266 |
| its transport import: queued for a socket | **89** [1–91] | **1**, 10/10 | 1 | 2 | 0 | 0 |
| its transport import ends | 729 | 640, 10/10 | 530 | 368 | 524 | 361 |
| decoder WASM asked | 815 | 747, 10/10 | 274 | 270 | 731 | 578 |
| decoder WASM ends | 942 | 873, 10/10 | 573 | 412 | 857 | 703 |
| **first frame** | **994** [970–1027] | **930** [919–947], 10/10 | 632 | **481** [459–492] | 905 | 763 |

**Verdict: the serving change needs the page change — HTTP/2 alone −64 ms (the socket wait), the hints
alone −362, both −513; frame 0 at 481 ms against 632 with the hints on HTTP/1.1**, where each preload
opens its own connection and pays 163 ms of TCP and TLS. A `modulepreload` of the graph recovers the
module hops but not the decoder's glue or WASM. Not recorded: request priorities; the graph here is
smaller than a viewer's.

## The static plane

**S40, 2026-09-26, `c367f5e`.** `HOST=dns` puts every host behind a name: [`stub_dns.py`](stub_dns.py)
is the browser's resolver, answering one round trip after each query, and [`h3-host/`](h3-host/) is
the deploy template's static host (paths, isolation headers, gzip) on quic-go, HTTP/2 and HTTP/3 on
one port, **no Alt-Svc** — a cold browser finds HTTP/3 only through an HTTPS record. Downloader page,
cold, five arms interleaved, 7 rounds.

```bash
sudo HOST=dns RTTS=40,80,160 NODE_PATH=$(npm root -g) node lab/page-open/run.mjs 7
```

| arm | page | transport | config | dial | session | frame |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `h2` — today's shape | `static.test`, HTTP/2 | same host, its own port | 6.03 | 5.01 | 11.04 | 17.39 |
| `h2+wt-ip` | same | an IP literal: no lookup | 6.00 | **4.04** | 10.04 | 16.33 |
| `h2+wt-host` | same | a second hostname | 6.01 | 5.03 | 11.04 | 17.34 |
| `h2+wt-hint` | same, `<link rel=dns-prefetch>` to the transport's origin | the second hostname | 6.05 | **4.02** | 10.07 | 16.40 |
| `h3` | `h3.test`, HTTPS record `alpn=h3` | same host, its own port | **5.00** | 5.05 | 10.05 | 16.33 |

Round trips, cumulative from navigation except `dial` (config → session).

**Verdict: an HTTPS record takes a round trip off every milestone** (TLS 7/7 at every delay, −1.06 to
the first frame); **the transport at the page's host on its own port pays a lookup after the config,
as a second hostname does, and a `dns-prefetch` naming its origin, port included, removes it** (the
dial −41 to −160 ms, 7/7). Chromium's host cache is keyed by port and a dial asks for
`_port._https.host`. Two traps, each run broken: only full Chromium, unproxied (`no_proxy` for
`.test`), asks for HTTPS records; and QUIC from an unknown root needs
`--origin-to-force-quic-on=h3.test:9`, a port nobody visits. *Corrected 2026-10-02 (BOOT):* `h3-host`
gzipped scripts but not HTML; these ~3.5 KB pages fit the first flight either way. **Not measured:**
the record with the hint together; the transport on UDP 443; a real resolver; nginx's own HTTP/3.

### The order the page's files leave in

**PORD, 2026-10-01, `37d2af7`.** Does a config asked after a large file land with its last byte? The
`+meta` arms add a synthetic study's metadata of ~120 KB gzipped ([`metadata.mjs`](metadata.mjs)):
`+meta` through the page's own `?meta=` preload, `+meta-first` through `meta-first.html`, which parses
a static preload one line ahead of the config's. `h2` crosses the relay's TCP plane, `h3` its UDP
plane with the host's own QUIC congestion control. 12 rounds, 61 of 180 visits `VOID`.

```bash
sudo HOST=dns RTTS=40,80,160 ONLY=h3,h2+meta,h2+meta-first,h3+meta,h3+meta-first NODE_PATH=$(npm root -g) node lab/page-open/run.mjs 12
```

| arm | config ms at 40 / 80 / 160 | metadata ms at 80 | `config` slope | `session` slope |
| --- | --- | --- | ---: | ---: |
| `h3` (no metadata) | 230 / 375 / 689 | — | 3.84 | 8.97 |
| `h3+meta` | 199 / 355 / 679 | 570 | 3.91 | 9.27 |
| `h3+meta-first` | 212 / 364 / 676 | 581 | 3.85 | 9.18 |
| `h2+meta` | 238 / 437 / 833 | 467 | 4.92 | 9.96 |
| `h2+meta-first` | 242 / 436 / 839 | 458 | 4.90 | 9.97 |

**Verdict: zero round trips — the config lands first in every visit on both protocols (112/112),
whichever was asked first.** A script-made preload leaves after every parsed one (the metadata asked
3–33 ms after the config, 63/63); the HTTP/3 host interleaves its streams. The metadata costs the dial
instead (+7 / +29 ms to `h3`'s session at 80 / 160). A server that sends in request order is where
order would matter.

## What this rig does not decide

The round trips are the container's userspace relay, not `netem` and not a real path; the
calibration `rig-limits.md` §3 still owes applies to every number here. The browser is headless
Chromium on loopback, so nothing here is a phone, and the fixed costs in the fit (47–160 ms) are
this box's CPU. The first table measures a single frame; the ladder measures the first frame of a
12-frame fill and stops there, so nothing here says what a fill costs to *finish*.
