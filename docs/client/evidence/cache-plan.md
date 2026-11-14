# The cache: the plan, theory then empirical

**The question:** which store keeps a reader's frames across a session and across visits, on a phone over lossy
wireless, and does it win as the option or only as the implementation we happened to build? Written 2026-11-14 from
[`cache-options.md`](cache-options.md) (the survey: OPFS leads), [`cache-in-opfs.md`](cache-in-opfs.md) (the store as
built, M1–M4), [`cache-io-thread.md`](cache-io-thread.md) (the writer arms, run: no arm passed) and
[`frame-memory-ownership.md`](frame-memory-ownership.md) (M5, the ring of slots). **Theory and a plan only: nothing
here is built or timed.** Every quote is from those files' pinned sources, verbatim; every number marked *measured* is
theirs, with their fixtures.

## 1 · Why a method, not only a run

The last round compared implementations, and every one lost (cache-io-thread §Arm D, Results). Several losses were the
build's, not the store's:

* **C**, the store worker, failed the shown frame on Chromium at S2 and S3 at 1× because the view thread copied each
  frame out of shared memory before posting it: 9.1–14.4 ms on Chromium, 32.6–47.6 ms on Firefox, *measured*, against
  2–6.8 predicted. The sync handle takes a shared view (`AllowSharedBufferSource`): the copy was the build's.
* **D**, the decoders writing, failed on Firefox at ~50 ms a frame at S1, *measured*: a handle created and closed per
  frame, because one packed file admits one writer. That is D's layout, not OPFS's write.
* **A paint first** wrote on the view thread, which the 2026-10-28 shape now rules out ([`../design.md`](../design.md)
  §Rules: "no write runs on the view worker's thread").
* **The window bounds nothing** with a fresh `SharedArrayBuffer` per frame (M2), whichever store sits behind it: a
  store blamed for that memory is blamed for the decoders' allocation.

So the plan separates **the store** (where bytes live: the option) from **its design** (writer, layout, frame memory,
copies), screens only stores, and gives each survivor its best design before any run.

## 2 · Step 1, the screen: sourced hard constraints only

The constraints, and only these: **an engine refuses it** (one of Chromium, Gecko, WebKit has no such API for a page);
**no re-decoding** (the owner, 2026-10-10: [`../design.md`](../design.md) §Decided, "An OPFS cache for both web
clients, no re-decoding"); **bit-exact** (every frame shown as exact is checked: "The cache stores only frames checked
`true` and re-checks each on read", §Rules); **off the paint's thread** ("Paint first: the frame on screen is painted
before its cache write, and no write runs on the view worker's thread", §Rules).

| candidate | verdict | why, quoted |
| --- | --- | --- |
| **OPFS, sync access handle** | **survives** | in dedicated workers ("`[Exposed=DedicatedWorker]`", fs `index.bs` 426–431), so writable off the view worker; shipped everywhere: "chrome_android": { "version_added": "109" } · "firefox": { "version_added": "111" } · "safari": { "version_added": "15.2" } (browser-compat-data `api/FileSystemSyncAccessHandle.json` 11–27) |
| **OPFS, `createWritable`** | **survives** | "`[Exposed=(Window,Worker), SecureContext, Serializable]`" (fs `index.bs` 426–431); Safari `"version_added": "26"` (`api/FileSystemFileHandle.json`). Its cost on a packed file (below) is a design matter, not a refusal |
| **IndexedDB** | **survives** | in workers, all three engines; it refuses a shared buffer ("If forStorage is true and serialized.[[AgentCluster]] is not null, then throw a "DataCloneError" DOMException.", html `source` 11025–11026), which costs a copy, not the option |
| **Cache Storage** | **survives** | "[SecureContext, Exposed=(Window,Worker)] interface Cache {" (ServiceWorker `index.bs` 1992–1993); its body refuses a shared view ("If the conversion is not to an IDL type associated with the [AllowShared] extended attribute, and IsSharedArrayBuffer(V.[[ViewedArrayBuffer]]) is true, then throw a TypeError.", webidl `index.bs` 9237–9240): a copy, not a refusal |
| Storage Buckets | **out**: engines refuse | "chrome": { "version_added": "122" } · "firefox": { "version_added": false … } · "safari": { "version_added": false } (`api/StorageBucketManager.json` 10–25). Not a store but a partition around one; it could wrap the winner on Chromium later, unweighed |
| The user-picked directory | **out**: engines refuse, and the page's thread | "If \|global\| is not a Window, then throw a "SecurityError" DOMException." · "If \|global\| does not have transient activation, then throw" (file-system-access `index.bs` 146–149, 330–334); Chromium only (`api/Window.json` 7217–7218) |
| Memory only | **out as a cache: re-decodes** | nothing survives the tab, so every reopen fetches and decodes every frame again. **Kept as the control arm** (`none`) in every cell |
| Coded bytes, in any store | **out: re-decodes** | a decode on every reopen ([`cache-options.md`](cache-options.md) §3: "Coded bytes break the owner's rule (no re-decoding, 2026-10-10) on every reopen"). Its deciding number, a phone's cold read + XXH3 of a 17 MB frame against ~45 ms, is still measured (§6, P1): it is what the owner would need to lift the rule |
| A write on the view worker's thread (arm A, either API) | **out: the paint's thread** | §Rules above. A *read* there stays allowed: a miss is painted after its read in every design |

**Four survivors: OPFS-SYNC, OPFS-ASYNC, IDB, CACHESTORAGE**, every one storing decoded samples and re-checking on
read. Nothing else is eliminated here: copies, IPC, WebKit's main-thread hops, quota behaviour are costs to be
designed against and measured, not grounds to drop an option.

## 3 · Step 2, a best-effort design per survivor

CACHE-DESIGN writes one design per survivor in §7 of this file, each from that option's own sources, before anything
is built. **What every design shares**, so that no option pays for another's infrastructure:

* **The same input.** A checked frame in a slot of M5's ring (frame-memory-ownership §How the ring works: one
  `SharedArrayBuffer` carved into budget-sized slots, freed only by the store), handed to the writer by slot number,
  never copied on the view thread. A store that needs non-shared bytes pays that copy itself, in its writer, and it is
  counted as the store's. *M5 measured the ring qualifying on Chromium and missing only its fill bar on Firefox (1.41 ×
  `today`)*: the ring is shared input here, not a candidate; if the protocol finds it binds a cell, it says so for
  every arm alike.
* **The same seam**: `open(series, digests) → present`, `write(i, slot)`, `read(i) → frame or miss`, `evict(series)`,
  `close`. Each arm differs only behind it. The XXH3 re-check, the eviction order (least recently opened first, only
  to make room; never a series open in a tab: cache-in-opfs choice 5) and the failure table (choice 7) sit above the
  seam, once.
* **Its own writer, chosen by its sources**: a store worker, the decoders, or a worker the decoders post to ("one
  writer the decoders post to", named as the arm to add and never run, cache-io-thread §Arm D (1)).

**What each design must answer from its own sources**, and what the earlier work already gives it:

| survivor | must decide | already known (reuse) | changed by a best effort |
| --- | --- | --- | --- |
| **OPFS-SYNC** | writer: store worker posted a slot, or the decoders posting to it; packed file per series (one writer, `truncate` at open) or a file per frame; reads in the view worker or the writer | the store and its rules as built (`client/view/cache.js`, `frame-file.js`; `client/viewer/store.js`); M1 reopen ≤ 0.028 × a fetch, M3 eviction holds on Chromium and Firefox, M4 a torn frame caught 4 of 4 (*measured*); sync read 40.1 ms against async 83.4 at S3 (R, Chromium) | C wrote a copy, not the slot: by source no copy is needed ("Read and write take a view of shared memory", cache-in-opfs §4). D opened a handle per frame: a packed file with one writer avoids it |
| **OPFS-ASYNC** | file per frame (a packed file is ruled out by its own cost: "One writable per frame on one series file copies n²/2 frames: 21 GB for `dbts_b1`'s 50 × 17 MB", cache-io-thread *What this rules out*); `keepExistingData` off; who writes; reading by `getFile()` or by a sync handle | B's two copies on the calling thread; Chromium's `.crswap` and move; WebKit's copy at close and "`callOnMainThread(`" for every call (cache-io-thread (a), (b)) | B ran on the view thread on a packed-file-free rig; off it, its copies cost the writer, not the paint |
| **IDB** | value per frame or chunked; `ArrayBuffer` or `Blob`; one transaction per frame or a batch; `durability: "relaxed"` ("Web applications are encouraged to use "relaxed" for ephemeral data such as caches", IndexedDB `index.bs` 940–942); keys (series, index, version); how it answers "does it fit" with no `truncate` | Chromium's Snappy and blob file above 64 KiB, Gecko's file above 1 MiB, WebKit's SQLite column (cache-options §2.1); writers on one store run in turn (`index.bs` 1148) | never built: everything |
| **CACHESTORAGE** | a `Cache` per series (eviction by `caches.delete`), keys as synthetic URLs per frame, the digest in a header; `put` batch; read by `match` then `arrayBuffer()` | a body is `BufferSource`, copied ("Set source to a copy of the bytes held by object.", fetch `fetch.bs` 8256–8257); a batch rolled back on an exception | never built: everything |

Not traced and owed by the design rows, each from its option's sources: whether WebKit's IndexedDB or Cache Storage in
a worker pass through the page's main thread; WebKit's handling of a large IndexedDB value; each engine's Cache
Storage disk path; whether IndexedDB keeps a Firefox private window's data (where OPFS is off:
"`dom.fs.privateBrowsing.enabled` … value: false"). A survivor that works where OPFS does not has an advantage the
verdict must weigh.

## 4 · Steps 3 to 5, and what keeps an option from losing to its build

3. **An advocate per survivor** (CACHE-ADVOCATE-<survivor>), a session that wrote none of the designs: it makes that
   option as good as its sources allow, amends its design in place with each change and its source, and lists every
   implementation disadvantage left. Its fixes go in before the protocol is written.
4. **A protocol written by a session that builds nothing** (CACHE-PROTOCOL), pre-registered, §5's cells.
5. **Builds, a review, the run, the verdict**: one lab arm per survivor on `claude/cache-arms`, a build review by a
   session that wrote none, the run interleaved, and a verdict review that asks each loser once more whether its loss
   is its implementation (§5, *The loser's question*).

What the method adds over the last round, each against a way an option lost to its build:

* **Absolute bars from the product, then a ranking.** An arm passes on the product's needs (the shown frame on time
  against `none`, the write keeping up with the fill, a miss painted in time, a reopen faster than a fetch); among
  passers the protocol ranks. Bars are written before any arm is built.
* **Each arm's floor beside it.** A raw probe of the store's own API (one write and one read of the cell's frame, in
  the arm's own worker, nothing else) runs interleaved with the integrated arm. The integrated cost minus its floor is
  the implementation's; the floor is the option's. A loss whose gap over its floor is most of it is a build's loss.
* **One tuning budget, the same for all.** Each arm may run a pilot (not counted) over at most the settings its design
  names (e.g. IDB's batch size, OPFS-ASYNC's writer); the setting picked by a rule stated before the pilot, then
  frozen for the counted run.
* **Shared parts identical**: the seam, the input slot, the re-check, the eviction rule, the harness, the arm order.
* **The harness's own mutants** for every cell (a write that never happens, a read without its re-check, a slot never
  freed), and the write-before-paint bar fixed: it passed the unmutated arm (cache-io-thread, *Mutants*).

## 5 · The protocol's frame (CACHE-PROTOCOL fills it)

**Cells**, each with its prediction written before data, per survivor and `none`:

| cell | what it shows | from the earlier rig |
| --- | --- | --- |
| **write** during a fill, off the view's thread | the shown frame (missed ticks, paint delay p99) against `none`; the write rate against the fill's decoded rate; the backlog; the tree's PSS growth | L, W (`lab/opfs-arms/`), M2/M5 |
| **read to paint** | a miss: intent → read → re-check → painted, p50 / p99 | R |
| **reopen**, warm and process-cold | the series whole and exact in hand from the store, against a fresh fill over the relay | M1 (`lab/opfs-cache/`) |
| **eviction** over the store's limit | the sets on disk after each open; none open evicted; every frame exact | M3, the engine's quota made small (DevTools' `Storage.overrideQuotaForOrigin`; Gecko's `fixedLimit`) |
| **a kill and a torn write** | present on reopen ≥ shown at the kill; a damaged frame caught and asked again | M4; damage injected through the seam's test lever, the same for every arm |
| **quota near full** | a write refused mid-fill: what the arm does, every frame exact | (9), never run |
| **two tabs** | the second tab on an open series: what it reads and writes, both exact | choice 7's row, never run |

**Rules carried** (`CLAUDE.md` §Measurement): arms interleaved in Williams order (`lab/order.mjs`), an A/A arm per
cell and VOID by it; one of latency or throughput per cell; **saturation**: a cell where `none` misses more than 5 %
of ticks claims nothing for any arm (the 4-vCPU host saturated at S2 and S3 at 4× on Chromium, and at S3 1× on
Firefox: cache-io-thread, *Where the host saturates*). **Cold** on a cloud host is a new browser process on a kept
profile with the page cache as it is, and is labelled so: page-cache eviction is not a lever (`CLAUDE.md`); a
flash-cold read is the phone's (§6).

**Engines**: Chromium and Firefox in the cloud first; WebKitGTK where the protocol finds a build the host can run
(the last rounds had none), else its cells say not run. WebKit's main-thread hops (cache-io-thread (a), (h)) want a
busy-page cell there before any survivor is adopted on WebKit.

**The loser's question** (CACHE-VERDICT-REVIEW): for each arm that fails a bar, its gap over its own floor, the cell
that failed, and whether a change its sources allow would close it. If the reviewer names one, it is written down as
an amendment for one more interleaved run against the leader, owed, not run in this queue: the verdict says which
losses are the option's and which are open.

## 6 · The phone cells (for the phone protocol)

Pushed for PHONE-NEXT-PROTOCOL's cell (4), in this order; one phone, Chrome for Android, `dbts_b1` frames (17.0 MB):

* **P1, the cold read.** In a new browser process, a series written in an earlier one and not read since: the first
  read + XXH3 of each frame by OPFS-SYNC's sync handle in a dedicated worker, then a second read of the same frames
  beside it. Against ~45 ms a frame (the measured decode across three decoders): under it, decoded samples win on
  reopen as well as by rule (cache-options §5 (1)). How "cold" is reached and checked (the first read against the
  second) is the phone protocol's, never a page-cache eviction.
* **P2, the sustained write.** A fill of `dbts_b1-q8-g8` with three decoders writing through OPFS-SYNC's design,
  against the ~358 MB/s the decode rate asks; the store's backlog and the tab's memory through the fill.
* **P3, the other survivors**, only those that pass the cloud cells: their P1 and P2.

## 7 · Designs

*Written by CACHE-DESIGN, amended by each CACHE-ADVOCATE row; empty until then.*

**Fixtures and their limits.** Nothing was run for this file. The *measured* numbers it quotes come from a 4-vCPU
cloud container without a GPU, Chromium 153 and Firefox 159, synthetic 16-bit series at 512², 2560×3328 and
3328×4096, a warm page cache; and one phone, Chrome 157, one series (`dbts_b1-q8-g8`), one evening, software AV1.
WebKit is read from source only, as are every IndexedDB and Cache Storage path. No breast ultrasound cine.
