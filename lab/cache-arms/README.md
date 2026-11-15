# cache-arms

The rig for the cache's four survivors, as [`cache-plan.md`](../../docs/client/evidence/cache-plan.md) §8
pre-registers it (on `claude/cache-plan`): the shared input, the seam, the rules above it, the floor probe and the
cells. This directory holds the harness, the control arm `none` and a stand-in arm `stub`; each survivor's arm is
added under `arms/` by its own build row. Nothing here is a result: rows from `none` and `stub` are smoke.

## The pieces

* **The ring** (`ring.js`): M5's one `SharedArrayBuffer` carved into frame-sized slots (`claude/core-m5:lab/opfs-cache/arms-slots.js`),
  256 MiB by default, here with a count of holders a slot. A feeder claims a slot for two holders, the view and the store
  worker; it is free once both let go. The view lets a frame go at once unless it keeps it (the warm frames it paints),
  the store once the arm has written it, or earlier when the arm holds its own copy (§8.1). A read takes a free slot for
  the view alone. Beside the slots, a count of reads waiting, for an arm that writes in pieces and serves reads first (§7.1).
* **The feeders** (`feeder.js`): three, standing in for the decoders without their CPU: each copies its frame from one of
  four synthetic 16-bit fields (`fields.js`) into a slot and posts the slot number to the store worker and to the view,
  at 125 MB/s in all or on credit. A full ring stalls a feeder, timed apart: the delivered rate.
* **The view** (`view.js`): paints the warm frames from their slots at its `requestAnimationFrame` (WebGL2, as
  `lab/opfs-arms/view.js` at `c99ba492`), the shown frame changing every tick at S1 and every 6th at S2–S3; a miss is a
  read asked of the store worker and painted from the slot it answers in. It writes nothing.
* **The store worker** (`store-worker.js`): one arm behind the seam and the rules above it (`store.js`), writes in
  arrival order, a read served before the next write, the floor probe, and the test levers (damage a frame, list the
  series on disk).
* **The page** (`page.js`, `index.html`): makes the ring, starts and wires the workers, runs one cell's steps, and holds
  no frame. `run.mjs` drives it, per cell, in Williams order (`lab/order.mjs`).

## The seam

An arm is a module under `arms/` whose default export makes an object with:

| call | does |
| --- | --- |
| `open(series, meta, {create})` → `{present, meta}` | opens or (a writer only) creates the series; `meta` holds the digest list, `frameBytes`, the shape and `lastOpen`, and the stored one comes back; a series that does not fit throws `QuotaExceededError` |
| `write(i, bytes, {release, readsWaiting})` | frame `i` from its slot (`bytes` is a view of shared memory); `release()` once the arm holds its own copy; `readsWaiting()` for reads first |
| `read(i, into)` → `bool` | frame `i` into a slot; `false` when absent |
| `drop(i)` · `evict(series)` · `list()` → `[{series, lastOpen}]` · `close()` | |
| `damage(i)` | the test lever: one byte of a present frame changed through the arm's own API (cell K) |
| `floor(bytes, into, count)` → `{writeMs, readMs}` | the floor probe: `count` writes then reads by the raw API alone |

`drop`, `list`, `damage` and `floor` are the harness's additions to §3's seam, the same for all four: the re-check needs
to clear one frame, eviction needs to know what is there, cell K needs a lever, and §8.2 the floor.

**Above the seam, once** (`store.js`, tested in `store.test.mjs` on an arm kept in memory): every read re-checked
(XXH3), a damaged frame dropped and reported; a digest list that differs at open drops the series; a series that does
not fit evicts, least recently opened first, never one open in any tab (a shared Web Lock per open series), then
waits for `estimate()` to show the room, at most 5 s (§8.1); a write refused mid-fill evicts one and retries once,
else writing stops, and nothing escapes; a second tab on a series (the exclusive lock held) reads what is present,
writes nothing, and takes a failed re-check as a miss (§8.1); a miss on a frame still pending is copied from its slot.

## The cells

`run.mjs --cell` with `--size 512|2560|3328` (S1 512², S2 2560 × 3328, S3 3328 × 4096); parameters in `cells.mjs`.

| cell | steps |
| --- | --- |
| L | a fill at 125 MB/s for 10 s; the shown frame (missed ticks, paint delay p99), the delivered rate, frames unwritten 5 s after the last post, the tree's PSS growth, every frame read back |
| W | 1 000 MB on credit (three a feeder, returned when written); MB/s first arrival to last write |
| R-idle · R-busy | 16 misses after a fill of 32, or during L's fill; intent → read → re-check → painted, the free-slot wait apart |
| B | R-busy with a 50 ms long task every 100 ms on the page's thread |
| O | a fill, then a reopen in a new tab (warm) and in a new browser on the kept profile (process-cold) |
| E | M3's sequence, quota 1 300 MiB, B held open in a second tab; the sets on disk after each open |
| K | 64 frames; `SIGKILL` of the browser's tree at ≥ 32 written; odd rounds damage the first present frame; a reopen, the rest fetched |
| Q | quota = the series + 64 MiB, a ballast file growing 1 MiB every 10 ms (`ballast.js`); then a reopen |
| T | tab 1 fills 50 × S2; at 20 written, tab 2 reads every frame and fetches the rest |
| P | 32 frames in a private window (Chromium's incognito context; Firefox `browser.privatebrowsing.autostart`) |

A quota cell first checks that the override holds (Chromium `Storage.overrideQuotaForOrigin`, Gecko
`dom.quotaManager.temporaryStorage.fixedLimit` at five times the site's limit, as M3 set it), and does not run where it
does not. The check is a refusal (`quota-probe.js`: half the quota taken, 16 MiB over refused), not
`estimate()`, which on Chromium 153 still reports 10 GiB under the override (*run once*, 2026-11-15) — so §8.6's
`estimate()` check cannot pass there, and §8.1's bounded wait for `estimate()` to show the room ends at once. Nor is
the override's whole room usable by one sync handle: under 877 MiB a `truncate` to 660 MiB was taken and to 800 MiB
refused; under 1 300 MiB, 860 taken and 1 284 refused (*run once*, Chromium 153, a fresh profile each). Q's quota of
the series + 64 MiB may refuse OPFS-SYNC's `truncate` at open for that alone: CACHE-RUN's amendment, before any row.

**Not built: O's F**, the fresh fill over `link_impair.py` the reopen is judged against. Synthetic frames have no
coded form, so a fetch of their bytes would not be a fill; F is M1's (`lab/opfs-cache/run.mjs --cell m1` at
`c99ba492`, the product's viewer and a packed series), owed to CACHE-RUN or taken from M1's *measured* F.

**Mutants** (`--mutant`): `drop-writes`, `no-recheck`, `slot-held`, `evict-newest` and `tab-writes` in `store.js`,
`view-copy` in `view.js`. Each row carries `checks`, what its mutant must break (`cells.mjs`); the bars against
`none` are over a round.

```bash
node lab/cache-arms/store.test.mjs && node lab/cache-arms/cells.test.mjs
NODE_PATH=$(npm root -g) node lab/cache-arms/run.mjs --cell L --size 2560 [--engine chromium|firefox] [--throttle 4] \
  [--rounds N] [--arms none,stub,stub-aa] [--mutant NAME] [--out rows.jsonl]
```

Needs the decoder builds (`client/decode/wasm/built`, for XXH3), Playwright's Chromium, and for Firefox an Xvfb display
and `FIREFOX_PATH` (`lab/opfs-cache/browser.mjs`). `--rounds` defaults to one Williams period of the arms; `-aa` names
an A/A twin. Rows go to `work/`, not tracked; a run takes a fresh profile, removed after, unless the cell keeps one.
