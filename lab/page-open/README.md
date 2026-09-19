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
```

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
([`../../docs/proposal-session-open.md`](../../docs/proposal-session-open.md)). The WASM and
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

## Compression and cache headers

Landed in [`../../deploy/nginx/wt-pacs.conf.template`](../../deploy/nginx/wt-pacs.conf.template)
and asserted by `deploy/check_equivalence.sh`. **Neither is run here** — the container has no
nginx and no working container runtime — so this half is written and unverified until that check
runs on a built image.

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

## What this rig does not decide

The round trips are the container's userspace relay, not `netem` and not a real path; the
calibration `rig-limits.md` §3 still owes applies to every number here. The browser is headless
Chromium on loopback, so nothing here is a phone, and the fixed costs in the fit (47–160 ms) are
this box's CPU. A single frame is measured, so nothing here says anything about a fill.
