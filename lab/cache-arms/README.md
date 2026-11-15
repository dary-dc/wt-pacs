# cache-arms

The rig for the cache's four survivors, as `docs/client/evidence/cache-plan.md` §8 (`claude/cache-plan` at `f26a78f0`)
pre-registers it: the shared input, the seam, the rules above it, the floor probe and the
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

## OPFS-ASYNC as built

`arms/opfs-async.js` is §7.2 as amended, with what a sequential store worker forces on it:

* `write` returns once its `write()` is issued. The store worker writes one frame at a time and W's feeders hold 9
  credits, under S1's G = 15, so a `write` that waited for its group's close would never return. A frame is on disk
  when its group's `close()` resolves; until then the arm answers its reads from its own copy (§8.1).
* A copy goes back to the pool when its group commits, not when its `write()` resolves, since a frame in an open
  group's swap cannot be read back: the copies are an open group's frames (≤ 8 MiB) and the writes in flight.
* `inflight` bounds the calls at once: a frame's `write()`, or for the frame that makes its group whole, that and the
  group's `close()`.
* Only a new series is probed (as OPFS-SYNC sizes only a new one): a reopen reads what is present, its rest left to
  the mid-fill rule.
* A `write()` or `close()` refused after its call returned is thrown by the next `write`; the store's retry writes
  the group again from its copies. A group still short of frames at `close` is aborted.
* For CACHE-RUN: a row's *written* is *handed to the arm*. At G = 15 a kill loses up to an open group besides the
  writes in flight, more than K's `kept` check allows; K runs at S3, where G = 1.

Pilot: `--pilot 'group=8MiB&inflight=3&read=sync'`; the defaults are `group=1`, `inflight=1`, `read=file`.

## IDB as built

`arms/idb.js` is §7.3 as amended: one database, `frames` keyed `[series, i]` holding a `Blob` of the samples, `series`
holding the manifest; each frame copied out of its slot into one reused scratch, a `Blob` made of it, the slot let go
(§8.1), then one `readwrite` transaction `{durability: "relaxed"}` with one `put` and `commit()`. With the seam's
sequential store worker:

* `write` resolves at the transaction's `complete`, so one write transaction is in flight and the next is made after
  it; a read waiting meanwhile is served before the next write, but behind the write in flight (IndexedDB 1130–1133).
* A refused frame keeps its value, since its slot was let go: the store's retry of the same frame writes that value.
* `estimate()` at the open of a series not present only; a reopen reads what is present, its rest left to the mid-fill
  rule. On Chromium 153 `estimate()` does not show the quota override (above), so under E's and Q's override the check
  at open never refuses there and the refusal comes mid-fill: CACHE-RUN's amendment to §8.3 E's "refusal at the
  design's point" for IDB on Chromium, before any row.
* Eviction is one transaction over both stores, `delete(IDBKeyRange.bound([s, 0], [s, Infinity]))` and the record;
  §7.3's Web Lock is the store's (`store.js`), not the arm's.
* The floor probe adds `writeBufferMs`, a `put` of an `ArrayBuffer` beside the `Blob` (§8.2); the store worker reports
  the median of every series an arm times.

* Chromium's backend (§7.3 asks a run to record it): list the profile's `Default/IndexedDB/` after the run. Chromium
  153's fresh profile has `<origin>.indexeddb.leveldb` (LevelDB) beside `<origin>.indexeddb.blob`, a Blob's file
  (*run once*, 2026-11-15); any other layout is recorded as found.
* For CACHE-RUN: L's memory bar. At S2 a fill grew the tree's PSS by 1 601 MiB with Blobs and 553 MiB with
  `value=buffer`, against `none`'s 263 and a bar of `none` + one frame + 64 MiB (*smoke*, one round each, Chromium 153).
  Where the Blobs' bytes stay (the blob registry, §7.3's untraced item, or the worker's uncollected Blobs) is not
  traced.

Pilot: `--pilot value=buffer` (Gecko only), the value an `ArrayBuffer`; the default is `value=blob`.

## CACHESTORAGE as built

`arms/cachestorage.js` is §7.4 as amended: a `Cache` named `frames <series>`, a response per frame keyed by the string
`/frame-cache/<series, URI-encoded>/<i>` (no `Request` built), the manifest as one more record (`…/manifest`, JSON),
no header on a frame's response. With the seam's sequential store worker:

* **buffered** (the default): the slot copied into an `ArrayBuffer` of the arm's own, the slot let go (§8.1), then
  `put(key, new Response(buffer))`; the buffer goes back to a pool once its put resolves. `inflight` bounds the puts at
  once: at 1 `write` resolves when its put does; at 3 it returns once fewer than 3 are in flight, so a refusal is
  thrown by a later `write`, whose retry puts the refused frames again from their kept buffers first. As OPFS-ASYNC,
  a row's *written* is then *handed to the arm*; a read of a frame in flight waits for its put, a refused one is
  answered from its buffer.
* **streamed** (`body=streamed`): a `ReadableStream` of the slot's own 1 MiB views; the slot stays held until the put
  resolves (the store's hold, §7.0), so one put is in flight whatever `inflight` asks; a read is the body's reader,
  each chunk copied into the slot at its offset.
* `estimate()` at the open of a series not present only, as IDB; on Chromium 153 it does not show the override, so the
  refusal comes mid-fill (IDB's amendment holds for this arm too). A reading tab opens nothing it does not find
  (`caches.has` first), so it makes no `Cache`.
* Eviction is `caches.delete(name)`; the Web Lock is the store's. The floor probe puts and matches in a `Cache` named
  `floor`, deleted after, buffered only.

* For CACHE-RUN, E on Chromium (*smoke*, two runs, Chromium 153): the space `caches.delete` frees comes back late. In C,
  a put refused at the sixth frame evicted A, the retry was refused again and writing stopped (5 of 20 written); by D
  the space was back and D was written whole beside B and C, so the sets after D and after A again miss §8.3's.
  §8.1's bounded wait cannot see the room under the override (above), so it ends at once: the same late removal §8.1
  names for Chromium's IndexedDB, here for its Cache Storage. CACHE-RUN's amendment before any E row (a wait that
  probes the room rather than `estimate()`, for all four alike), not this arm's.
* `body=streamed` on Chromium 153: a body of shared views was taken and read back exact in L at S2 (*smoke*, one
  round), so §8.4's first check passes there; Firefox not run.

Pilot: `--pilot 'inflight=3&body=streamed'`; the defaults are `inflight=1`, `body=buffered`.

**Not built: O's F**, the fresh fill over `link_impair.py` the reopen is judged against. Synthetic frames have no
coded form, so a fetch of their bytes would not be a fill; F is M1's (`lab/opfs-cache/run.mjs --cell m1` at
`c99ba492`, the product's viewer and a packed series), owed to CACHE-RUN or taken from M1's *measured* F.

**Mutants** (`--mutant`): `drop-writes`, `no-recheck`, `slot-held`, `evict-newest` and `tab-writes` in `store.js`,
`view-copy` in `view.js`. Each row carries `checks`, what its mutant must break (`cells.mjs`); the bars against
`none` are over a round.

```bash
node lab/cache-arms/store.test.mjs && node lab/cache-arms/cells.test.mjs
node lab/cache-arms/arms/opfs-sync.test.mjs && node lab/cache-arms/arms/opfs-async.test.mjs && node lab/cache-arms/arms/idb.test.mjs
node lab/cache-arms/arms/cachestorage.test.mjs
NODE_PATH=$(npm root -g) node lab/cache-arms/run.mjs --cell L --size 2560 [--engine chromium|firefox] [--throttle 4] \
  [--rounds N] [--arms none,stub,stub-aa] [--mutant NAME] [--pilot SETTINGS] [--out rows.jsonl]
```

Needs the decoder builds (`client/decode/wasm/built`, for XXH3), Playwright's Chromium, and for Firefox an Xvfb display
and `FIREFOX_PATH` (`lab/opfs-cache/browser.mjs`). `--rounds` defaults to one Williams period of the arms; `-aa` names
an A/A twin. Rows go to `work/`, not tracked; a run takes a fresh profile, removed after, unless the cell keeps one.
