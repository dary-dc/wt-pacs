# What a page open costs, in round trips

**R2, 2026-09-19.** Navigation → the transport config → the session → the first frame, for the
harness on both clients and for the downloader, through
[`../scripts/link_impair.py`](../scripts/link_impair.py) at round trips of 0, 40 and 80 ms, cold
and warm profile, three rounds each. Every figure below is the **slope** of the milestone against
the link's round trip, fitted over the three delays, so the relay's floor, the crypto and the
decode fall out as an intercept rather than inflating a ratio. What the harness itself cannot
show is [`../../docs/rig-limits.md`](../../docs/rig-limits.md) §3.

```bash
NODE_PATH=$(npm root -g) node lab/page-open/run.mjs 3
HOST=h2 NODE_PATH=$(npm root -g) node lab/page-open/run.mjs 3   # nginx over TLS with HTTP/2; h1 without; dev is the default
# HOST=dns: every host behind a name, HTTP/2 against HTTP/3 — §The static plane
```

A HOST run trusts its certificate through an NSS store of the browser's own (`certutil`, from
libnss3-tools), not `--ignore-certificate-errors`. Chrome caches nothing whose certificate had
an error, so ignoring it puts every worker script back on the wire and on the page's path —
two round trips of the dial, until 2026-09-24 (PO1).

## The count, before and after

Serial round trips on a cold profile. `config` is the transport endpoint in hand, `session` the
client connected, `frame` the first frame used by the page.

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

A warm profile already spent none of this: `config` reads 0.0 round trips (the HTTP cache
answers it) and `session` 2.6–3.1 both before and after, which is the dial and nothing else. The
cuts cost a warm visit nothing and are invisible in it.

**Three things the after-column says.** All three arms now converge on ~6.5 round trips to a
session, because what is left is the same for all of them: ~3.6 for the connection, the page and
the config, and the 3.0 the dial costs
([`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md)). The WASM and
downloader arms were 2 and 6 round trips worse than the TypeScript one and are no longer. And the
remaining gap from `session` to `frame`, 6.4 round trips, is **not** the page: the fixture is a
428 KB frame and slow start out of a 12 KB initial window needs six flights for it — S7's
finding, measured at 5.59 for the ask alone in `rig-limits.md` §3.

## The cuts, one at a time

Each was measured before the next was made.

| # | Change | Cold session, ts / wasm / downloader |
| --- | --- | --- |
| 0 | baseline | 9.69 / 11.86 / 12.53 |
| 1 | `preload` the transport config | 8.89 / 10.86 / 11.81 |
| 2 | `modulepreload` the shell and each arm's client | 6.70 / 6.70 / 11.84 |
| 3 | `preload` the worker, decoder and decoder WASM | 6.64 / 6.72 / **6.37** |

Cut 1 is worth about one round trip everywhere: the config is fetched by `shell.js`, so without
a hint it cannot start until the shell has been fetched and evaluated. Cut 2 is worth 2 to 4:
the client bundle is a dynamic `import()` inside `loadSession`, three discoveries deep. Cut 3 is
the downloader's alone and is worth 5.5 — its chain is page → consumer → downloader worker →
decoder worker → decoder glue → decoder WASM, and each link was discovered only once the
previous one ran. A `modulepreload` on the consumer alone did nothing, because a module worker
has its own module map; what warms a worker's script is the HTTP cache, so the worker and
decoder are `preload`ed as scripts rather than modulepreloaded.

**What is left to cut, and not cut here.** The 3.6 before the dial is one connection setup, the
HTML, and the config. Inlining the config into the page would remove the last one; it changes
how `dev-transport.json` reaches the browser, so it is a separate change with its own reason.

## The first byte on a fill

**R1/R3/R4, 2026-09-20.** The table above times a single *ask*. This one times the first frame of a
**fill** — the first byte on the target of a study open — with
[`first-byte.html`](first-byte.html), whose `?stage=` selects one rung per arm. Same relay, cold
profile only (a warm visit spends none of what these cut), round trips of 40, 80 and 160 ms,
**seven rounds a delay**, the five arms interleaved inside every round, all of them against one
server binary started with `--open-ask`:

```bash
RTTS=40,80,160 STAGES=today,no-r4,r3,r1,all NODE_PATH=$(npm root -g) node lab/page-open/run.mjs 7
```

| arm | what it is | `frame` round trips | fixed ms | 40 ms | 80 ms | 160 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `today` | the committed load path | 14.57 | 136 | 718 | 1303 | 2467 |
| `no-r4` | minus the `preload` of `dist/session.js` | 15.73 | 167 | 792 | 1432 | 2681 |
| `r3` | `connect()` handed promises: the worker graph stops waiting for the config | 14.51 | 140 | 725 | 1295 | 2463 |
| `r1` | the opening fill rides the session URL (`?ask=fill:0-11`) | **13.44** | 139 | **677** | **1213** | **2289** |
| `all` | `r3` and `r1` together | 13.34 | 172 | 720 | 1219 | 2314 |

`session` and `config` on the same runs, which is how the noise is read:

| arm | `session` round trips | `config` round trips |
| --- | ---: | ---: |
| `today` | 8.36 | 4.35 |
| `no-r4` | 9.54 | 4.36 |
| `r3` | 8.30 | 4.40 |
| `r1` | 8.28 | 4.42 |
| `all` | 8.44 | 4.46 |

**How far apart two arms have to be to mean anything.** No arm changes what `config` measures, and
only `no-r4` changes what `session` measures: across the five arms `config` spans 0.11 round trips,
and across the four that keep the preload `session` spans 0.16. **±0.2 round trips is this fit's
arm-to-arm spread**, and it is the only spread these runs kept — see the last paragraph.

**R1 is the rung that pays: −1.13 round trips** (13.44 against 14.57), five to seven times the
spread above, worth 41 ms at 40, 90 ms at 80 and 178 ms at 160 — one round trip, which is exactly
what putting the ask in the URL removes
([`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §Lever 1). It is
spent between `session` and `frame` and nowhere else: `r1` reaches `session` when `today` does
(8.28 against 8.36) and `frame` a round trip sooner. The same push buys a second thing this page
cannot see — the window it opens for the *next* ask, measured natively in
[`../../docs/transport/transport-conclusions.md`](../../docs/transport/transport-conclusions.md)
§3 lever 1.

**R4 is worth 1.16 round trips, and is already landed** — cut 3 above preloads `dist/session.js`,
so this ladder prices it by *removal*: `no-r4` is the slowest arm at every delay (+129 ms at 80),
and its cost falls on `session` (9.54 against 8.36), which is where a late `import()` of the
transport would.

**R3/W1 buys nothing here: −0.06 round trips**, inside the spread. The premise it was drawn from —
the page awaits its config, so the worker, the decoder fetches and the transport import all start a
round trip late — is true of the code and does not reach the first frame, because cut 3 already
preloads every one of those into the HTTP cache: un-gating the graph starts them earlier inside a
window that was not the critical path. The dial still cannot start before the URL, and the dial is
what the round trip would have been. The `all` arm is the table's highest intercept (172 ms against
`today`'s 136) and is no faster than `r1` alone at any of the three delays — a hint that the earlier
boot competes for the same core, not a finding, since the intercepts wander 136–172 ms across arms
regardless. **What would decide it is a device where the worker boot and the decoder fetches are
slower than the dial** — the target's phone, which this box is not; on this one the split may be
reverted at no measured cost.

**Comparable down the column, not across to the tables above.** These arms differ from the
`downloader` row there — a 12-frame fill rather than one ask, a fit over 40/80/160 rather than
0/40/80, and a box carrying other lanes throughout — so `today`'s 14.57 is not that table's 12.86
gone bad. Only within-run comparisons count.

**What these runs do not carry.** `run.mjs` keeps the median of its seven rounds per cell and the
fit, and prints nothing else, so there is **no per-round range and no wins-out-of-n for this
ladder**; the two control milestones above are the whole of its spread. A ladder that decides
something on a margin narrower than half a round trip needs the runner to record them first.

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
and asserted by `deploy/check_equivalence.sh`. **Verified 2026-09-19 on a host nginx** with
`check_equivalence.sh --local`: the eight harness paths answer as `dev-server.py` does, a module
comes back gzipped, a hashed name carries the immutable rule and the three isolation headers, and
each assertion was watched to fail on a mutated template. The built image itself is still unrun in
a container without a runtime.

Compression is worth 2.9× over everything a cold open fetches:

| asset | bytes | gzip | flights of 12 KB |
| --- | ---: | ---: | --- |
| `transport_wasm_bg.wasm` | 342 573 | 130 813 | 5 → 4 |
| `openjphjs.wasm` | 299 948 | 95 754 | 5 → 4 |
| `openjphjs.js` | 58 074 | 14 788 | 3 → 2 |
| `transport_wasm.js` | 31 412 | 6 537 | 2 → 1 |
| `dist/session.js` | 15 342 | 4 698 | 2 → 1 |
| everything else (6 files) | 31 408 | 12 255 | 1 → 1 each |
| **total** | **778 757** | **264 845** | |

**It does not shorten this open, and the table says why.** After the cuts the bundles are
fetched in parallel with the dial, so they are off the critical path and their flights no longer
add to the count. Compression buys bytes, which is what a rate-limited link and a metered device
care about; it is not a round-trip lever here. The immutable rule has nothing to match yet — no
build emits a content-hashed name — so it is the deployment contract for when one does, and the
check probes it on a 404 to catch the one thing it can get wrong: an `add_header` inside a
`location` replaces the server's, which would silently drop cross-origin isolation.

### What an encoding costs on loopback

**ENC, 2026-09-27.** On the workstation gzip saved ~2.2 MB before the first image at 20 Mbit / 80 ms
but made it +34 / +55 ms later on loopback. [`enc.mjs`](enc.mjs) asks where that cost goes, and whether
another encoding removes it. The downloader page (with the WASM transport, `?transport=wasm`, and a
study's metadata, `?meta=`) is served by nginx 1.24 over TLS and HTTP/2. Each file is precompressed
once: gzip 1.12 `-6`, brotli 1.1.0 `-q 11`, zstd 1.5.5 `-19`. Each encoding has its own server block,
which serves the copy only to a client that lists the token and the file itself otherwise. Two checks
guard it, and each was watched to fail on a mutated config. Before a run, a request without the token
must get the file. On every visit, every asset must arrive as that arm's bytes. The browser is headless
Chromium 141 on loopback, with a fresh context per visit. The four arms rotate inside every round, at
1× and under a 4× cap on every browser thread ([`../scripts/cpu_throttle.mjs`](../scripts/cpu_throttle.mjs)).
The cap stands in for a slow CPU. It is not a phone.

```bash
TRACE=0 NODE_PATH=$(npm root -g) node lab/page-open/enc.mjs 20   # the headline; without TRACE=0 the trace's milestones
```

| bytes | identity | gzip | br | zstd |
| --- | ---: | ---: | ---: | ---: |
| scripts: the page's modules, the transport's glue, the decoder's glue | 133 640 | 36 649 | 32 301 | 35 268 |
| transport WASM | 260 209 | 110 175 | 90 772 | 96 885 |
| decoder WASM | 299 948 | 95 524 | 77 159 | 82 693 |
| metadata JSON — synthetic, 300 frames of tags and UIDs, not a real series | 120 596 | 17 502 | 12 768 | 13 819 |
| **total** | **814 393** | **259 850** (−68 %) | **213 000** (−74 %) | **228 665** (−72 %) |

Two batches without the trace, n = 20 each. Each cell is the median in ms from navigation [range],
and the rounds the arm beat identity in:

| | batch | identity | gzip | br | zstd |
| --- | --- | ---: | ---: | ---: | ---: |
| first frame, 1× | A | 189 [153–222] | 198 [169–234] 7/20 | 199 [173–231] 6/20 | 202 [159–223] 6/20 |
| | B | 192 [166–221] | 200 [166–233] 7/20 | 198 [163–236] 10/20 | 191 [178–229] 10/20 |
| first frame, 4× | A | 549 [461–879] | 556 [492–720] 11/20 | 593 [475–754] 5/20 | 591 [515–653] 5/20 |
| | B | 555 [455–1426] | 575 [524–661] 8/20 | 589 [483–659] 5/20 | 569 [499–666] 9/20 |
| decoder WASM's response end, 4× | A | 138 | 165, 5/20 | 180, **1/20** | 187, **1/20** |
| | B | 147 | 174, **1/20** | 192, **2/20** | 164, 5/20 |

**No encoding is resolvably later than identity to the first frame on loopback, at 1× or at 4×.**
Every cell is 5/20 to 11/20. Brotli at 4× is the nearest to a result: 5/20 in both batches, +44 and
+35 ms. The order between the codecs did not survive the second batch: zstd went from +42 to +14 ms at
4×, and gzip from +7 to +20. So nothing here ranks one encoding over another on time. The workstation's
+34 / +55 ms is the size of this box's spread, and was not reproduced as a resolved loss.

**Where a cost does show, it is the decoder WASM's arrival.** Its preload ends later under every
encoding. At 4× the delay is +17 to +49 ms, and in each batch at least two of the three encodings beat
identity in only 1 or 2 rounds of 20. At 1× it is +3 to +11 ms. Decompression itself is cheap: ~1 ms per
300 KB WASM for any of the three, in Node at 1×. What the rows show is the network service spending
more CPU under an encoding. Per visit at 4× (batch B) it used 80 → 90 ms (10 ms ticks), more in 10–13 of 20
rounds and less in only 0–4. Under the cap, the network service's thread gets a quarter of a core, so
its extra decoding stretches into wall time. The same WASM of the transport, 260 KB, does not show it
cleanly (7/20 to 10/20). Why the decoder's copy is the one delayed is not isolated here.

**Streaming compile still overlaps under every encoding.** In a third batch, with the trace
(n = 10), the transport WASM's streamed compile resolved 3–7 ms after its last byte reached the worker,
in every arm. At 1× that was 5.1 / 3.0 / 2.7 / 7.2 ms, and at 4× 4.0 / 5.0 / 5.0 / 5.0, for
identity / gzip / br / zstd. The network service decodes before V8 sees the bytes, and V8 compiles the
decoded bytes as they stream. On loopback that worker fetch comes from the cache the page's preload
filled. So this shows the encoding does not break streaming. It does not show overlap with a slow
download. The decoder's compile does not stream (`decoder.js` hands its glue a buffer), so for the
decoder there is nothing to overlap.

**Break-even.** Take each encoding's worse batch at 4× at face value: +20 ms for gzip, +44 ms for
brotli, +42 ms for zstd. Against the 555–601 KB each saves, that breaks even at **220, 108 and
113 Mbit/s**. At 1× every encoding breaks even above 380 Mbit/s. Below those rates the saved bytes cost
more time on the link than the encoding costs on loopback, provided the bytes are on the path. At
20 Mbit/s they are ~220–240 ms of transfer.

**Deciding: one mode, always on, is right on any link slower than ~100 Mbit/s even at this rig's worst
case, and gzip is enough.** Gzip is within noise of identity on loopback at both throttles, and keeps
92 % of brotli's saving (554 543 of 601 393 bytes). Brotli saves 47 KB more and leans the latest at 4×.
Zstd sits between the two in bytes and is no faster here. No default changed. The template still
compresses per request (`gzip on`, level 6). These rows measure precompressed files, and the server's
CPU for compressing per request is not measured.

**Support**, from MDN's browser-compat-data 8.1.3 (2026-09-24):
* gzip is supported everywhere.
* br: Chrome 50, Edge 15, Firefox 44, Safari 11 (macOS 10.13 or later), iOS 11, Samsung Internet 5.0.
* zstd: Chrome, Edge and Chrome Android 123, Firefox 126, Safari and iOS 26.3, Samsung Internet 27.0.
  Safari before macOS 26.3 cannot decode it.

A deploy that serves zstd or br therefore has to pick by `Accept-Encoding`, falling back
zstd → br → gzip → the file. Each arm above falls back straight to the file, which is enough for a
measurement.

**Seen in the traces, not measured:** the decoder workers do not take the glue and the WASM from the
preload. Their `fetch()` revalidates on the wire (a 304 of 223 B) in every arm. nginx sends
`Last-Modified` and no `Cache-Control`, and a file minutes old gets almost no heuristic freshness. On a
real link that is a round trip per decoder worker, on the path to its compile.

## The first frame on a real host, with lever 2

**PO1, 2026-09-24.** The downloader arm served by nginx over TLS: HTTP/1.1 and HTTP/2
invocations alternated round by round, and inside each, lever 2 on and off
(`SERVERS=on=…,off=…`, the second being this tree with `[patch.crates-io]` removed). 7 rounds at
40 and 80 ms, cold and warm profile. Each stage is timed from the previous one. `tls` is the
document's TLS handshake, which includes the TCP setup, because the relay charges that to the
first bytes. `page` is the HTML's last byte, `scripts` until the module runs, `config` the
transport config, `dial` config → session ready, and `frame` session → frame 0 decoded. Round
trips are the slope from 40 to 80 ms; the cold profile over HTTP/2 is the product's first visit:

| stage | lever on | lever off |
| --- | --: | --: |
| TCP + TLS + HTML | 3.0 | 3.0 |
| scripts | 0.45 | 0.9 |
| config | 0.9 | 1.05 |
| **dial** | **1.85** | **3.0** |
| frame | 6.5 | 6.2 |
| **first frame on screen** | **12.65** (720 ms at 40, 1 226 at 80) | **14.35** (738, 1 312) |

The lever cannot touch the stages before the dial or the frame after it. Their spread between
the arms (scripts 0.45 against 0.9) is how the table's noise reads.

**The dial is on the path, and lever 2 takes a round trip off it everywhere.** Paired by round,
the dial with the lever is −39 to −44 ms at 40 and −77 to −86 at 80, 7/7 in all eight cells
(HTTP/1.1 and HTTP/2, cold and warm). The first frame keeps it: −18 to −54 ms at 40 and −63 to
−83 at 80, 6/7 or 7/7. That leaves the dial at two round trips of the page's ~12.7. The largest
share is the frame's own slow start (S7, above), then the page's TCP, TLS and HTML.

**What HTTP/2 buys is the config's round trip.** On HTTP/1.1 the config stage is 2.15 round trips
cold against 0.9, and the first frame 1 325 ms at 80 against 1 226. Warm, they tie. These
invocations were alternated rather than interleaved, so that comparison carries more drift than
the lever's.

**Where the round trip before the dial goes: the config is fetched twice.** In Chrome's net log
the page's `fetch("/wt/dev-transport.json")` does not take the `<link rel=preload as=fetch>`
response. It revalidates on the wire (a 304) one round trip later, and a warm visit does it twice.
Everything else the page preloads is taken from cache, and the QUIC dial starts ~26 ms after
`config`. Unmeasured: a preload the fetch matches would take that round trip off the first frame.

*Corrected before it was published:* the first full run left `run.mjs`'s
`--ignore-certificate-errors` in place, and every worker's scripts came off the wire. That put the
dial at 3.95 round trips with the lever, not 1.85. The note under the commands at the top says why.

## The static plane

**H1/S40, 2026-09-26.** `HOST=dns` puts every host behind a name. [`stub_dns.py`](stub_dns.py) is the
browser's resolver, answering one round trip after each query (a resolver as far away as the server;
a closer one scales the lookup down, not away). [`h3-host/`](h3-host/) is the deploy template's static
host — its paths, isolation headers and gzip — on quic-go, serving HTTP/2 and, on the same port,
HTTP/3, with **no Alt-Svc**: a cold browser finds the HTTP/3 plane only through an HTTPS DNS record.
Today's nginx 1.24 has no HTTP/3, so both protocols come from one server and the arms differ only in
what the name says. Downloader page, cold profile, five arms interleaved in every round, 7 rounds at
40, 80 and 160 ms:

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

Round trips, cumulative from navigation except `dial` (config → session). Paired by round against
`h2`: the `h3` arm's TLS is 47 / 88 / 165 ms against 87 / 165 / 324, **7/7 at every delay**, and its
session 6/7, 7/7, 7/7; the dial of `h2+wt-ip` and of `h2+wt-hint` is −41 to −42 / −82 to −83 / −159 to −160
ms, 7/7 at every delay; `h2+wt-host` against `h2` is 3/7, 4/7, 3/7 — a tie. The document's own lookup reads
1.00 round trip in every arm, which is the stub doing what it was told.

**An HTTPS record takes a round trip off every milestone of the first visit.** The document arrives
over HTTP/3 (21/21 visits; the other arms 21/21 over HTTP/2), its handshake is one round trip where
TCP and TLS are two, and the round trip stays saved to the first frame (−1.06).

**The transport's port is not free.** Chromium keys its host cache by scheme, host and port, and a
dial to `https://host:port` asks for an A record and for `_port._https.host`'s HTTPS record, so a
transport on the page's own host at another port pays a whole lookup after the config, exactly as a
second hostname does. **A `dns-prefetch` hint naming the transport's origin, port included, starts
that lookup with the page and takes it off the dial** — the dial ties the IP literal's. The hint has
to know the origin before the config does, so it is a deploy-time string in the page.

**Two traps, both built around.** The browser uses its own DNS client, which asks for HTTPS records,
only in full Chromium — the headless shell resolves through the system and never asks — and only
when nothing proxies it, so the run sets `no_proxy` for `.test`. And Chromium takes QUIC only from a
certificate issued by a known root; `--origin-to-force-quic-on=h3.test:9` names a port nobody visits,
which lifts that check for `h3.test` without forcing QUIC on it. Each check was run broken: without the
record, or without the flag, the `h3` arm's document came over HTTP/2.

**Not measured:** the HTTPS record together with the hint (the two act on different stages and should
add, −2 round trips); the transport on UDP 443 beside the page's TCP 443, which would share the
page's cache entry (the relay binds one address); a real resolver, whose A answer for a known host is
likely cached where an HTTPS query for `_4433._https` is not; nginx's own HTTP/3, which needs 1.25.

## What this rig does not decide

The round trips are the container's userspace relay, not `netem` and not a real path; the
calibration `rig-limits.md` §3 still owes applies to every number here. The browser is headless
Chromium on loopback, so nothing here is a phone, and the fixed costs in the fit (47–160 ms) are
this box's CPU. The first table measures a single frame; the ladder measures the first frame of a
12-frame fill and stops there, so nothing here says what a fill costs to *finish*.
