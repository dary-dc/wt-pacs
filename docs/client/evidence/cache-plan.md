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
verdict must weigh. *Traced 2026-11-14 in §7 (7.3, 7.4, 7.6), each from its engine's source; what is still not traced is listed there.*

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
| **write** during a fill, off the view's thread | the shown frame (missed ticks, paint delay p99) against `none`; the write rate against the fill's decoded rate; the backlog; the tree's PSS growth | L, W (`lab/opfs-arms/` at `c99ba492`), M2/M5 |
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

*Written by CACHE-DESIGN, 2026-11-14, before anything is built; each CACHE-ADVOCATE row amends its survivor's design in
place, each change with its source and* advocate *beside it.* **Theory only.** Sources are §7's table at the end, at
pinned commits, quoted verbatim; a number marked *measured* is from the file it names, with that file's fixtures.

### 7.0 · What every design takes as given (§3, not re-decided here)

The input is a checked frame in a slot of M5's ring, named by its slot number. The seam is §3's. Above it, once for all
four: the XXH3 re-check on every read, eviction least recently opened first and only to make room, never a series open
in a tab, and the failure table of 7.5. One rule the ring needs from every arm alike: **a slot under a frame not yet
written stays held** until its writer says written (as built: "A frame leaves the window only once the store worker
says it is written", cache-in-opfs §The mechanism proposed); a writer that falls behind therefore dries the ring and
slows the decoders, the same backpressure for all four. The writer is in each case a **store worker** the decoders post
slot numbers to on a port each: the view thread posts nothing for the cache, and no arm writes on a decoder's clock (D's
loss on Firefox, ~50 ms a frame at S1, *measured*, cache-io-thread §Arm D, Results). A read is served by the same store
worker into a free slot and answered by slot number; the re-check runs where §3's seam puts it.

The series' key is the session URL as built (`client/viewer/store.js`); one manifest per series holds the digest list
it was written for, `frameBytes`, the shape and the last open. A digest list that differs at open drops the series.

### 7.1 · OPFS-SYNC: one packed file, one sync handle, written from the slot

| | design | from its sources |
| --- | --- | --- |
| writer | the store worker holds one `FileSystemSyncAccessHandle` per open series for the session and writes **from the ring's slot itself**: `write(slotView, {at: i × frameBytes})`, in pieces of the pilot's size (*advocate*: below, *reads first*) | "unsigned long long write(AllowSharedBufferSource buffer," (fs 1425): a shared view is taken, so **no copy in script**; nor in the engine, *advocate*, traced: Chromium writes the view with one `backing_file_.Write(offset, data)` in the renderer (`file_system_access_regular_file_delegate.cc` 84), Gecko streams it "`NS_ASSIGNMENT_DEPEND`" (`FileSystemSyncAccessHandle.cpp` 593–595) |
| layout | as built: frame i at i × frameBytes, then a 3-int record per frame (min, max, present), one file; the manifest beside it | cache-in-opfs choice 3 |
| copies | one, the engine's into the page cache; none in script | — |
| transactions | none; the record written after its frame, never flushed | the re-check guards a torn frame (choice 6; M4 caught 4 of 4, *measured*) |
| does it fit | `truncate(n × (frameBytes + 12))` at `open` of a series not present (*advocate*: was at its first frame; at open the answer comes before any byte is fetched, and WebKit's one main-thread wait (below) and Chromium's one capacity request leave the fill); a refusal (`QuotaExceededError`, or Gecko's `NS_ERROR_FILE_NO_DEVICE_SPACE`) evicts and retries | fs 1587–1588: "If newSize − oldSize exceeds the available storage quota, throw a QuotaExceededError." |
| reads | the store worker `read(slotView, {at})` into a free slot: no copy in script, no new buffer. **Reads first** (*advocate*): a pending read is served before the next write piece (below) | fs 1423; "offers synchronous methods" (fs 611): a read posted during a write waits for it, so the order is the design's to choose |
| eviction | close the handle, then `removeEntry(series, {recursive: true})`; another tab's handle on the victim refuses, so it is skipped | as built (`evictOne`); Chromium refuses removal under any handle, *run once* (choice 5) |

**Reuses** `client/viewer/store.js` whole (open, `create`, `evictOne`, the records) and the packed file's measured
rules (M1 reopen ≤ 0.028 × a fetch, M3 eviction on both engines after the Gecko fix, M4). **Changes** two things. (1)
The store worker writes from the ring's slot, not from a copy: C's view-thread copy, 9.1–14.4 ms on Chromium and
32.6–47.6 ms on Firefox at S2–S3 (*measured*), was there only because a fresh `SharedArrayBuffer` per frame was never
collected in the store worker (cache-in-opfs choice 2, corrected 2026-10-28); the ring is one buffer, allocated once.
(2) The decoders post the slot number to the store worker directly ("one writer the decoders post to", cache-io-thread
§Arm D (1)), so the view thread neither copies nor posts.

**Per engine, from source.** Chromium: within the granted capacity a write sends one note and does not wait; the first
`truncate` asks for the capacity once (cache-io-thread (h)). Gecko: every 1 MiB block of a write is a synchronous quota
IPC, growing or not (h): 17 a frame at S2, 26 at S3; nothing in its sources avoids it. WebKit: a handle's capacity is the
file's size when it is created, and growing past it waits on the page's main thread (h); the handle is created on an
existing, already-truncated file at reopen, and on a new file grows once, at the first `truncate`: one main-thread wait
a series, not a frame. `createSyncAccessHandle` itself also passes the main thread (h): once a series.

**Reads first** (*advocate*, 2026-11-14). The handle's methods block the store worker, so in the design as written a miss
posted during a frame's write waited for the whole write, ~21–33 ms at S2–S3 (the floor below), on top of its own read:
the miss would pay for the writer's layout, not for OPFS. The view worker raises a count in shared memory beside the
ring with every read it posts (`Atomics.add`); the writer checks it (`Atomics.load`) after each piece and, if it is not
zero, returns to its event loop, serves the reads, and resumes the frame at the next piece. A miss then waits at most one
piece. A frame's record is still written only after its last piece. Nothing in the engines prices a piece apart from
its bytes: Chromium asks no capacity for a write inside the file's length ("if (write_end_offset > file_size_before)",
`file_system_access_regular_file_delegate.cc` 77–80, true for every write after the `truncate`), and Gecko already cuts
any write into 1 MiB blocks, each with its quota IPC ("aSource, aSink, aIOTarget, aMode, kStreamCopyBlockSize,",
`FileSystemAsyncCopy.cpp` 44–45), so a 2 MiB piece adds no IPC. Theory; the pilot decides whether the pieces pay.

**Gecko's quota IPC, re-traced** (*advocate*): every block's `Write` calls
"`FileQuotaStreamWithWrite::mQuotaObject->MaybeUpdateSize(`" (`dom/quota/FileStreams.cpp` 92–94), and the content side
sends it whatever the size: "if (!mActor->SendMaybeUpdateSize(aSize, aTruncate, &result)) {" (`RemoteQuotaObject.cpp`
56). The design's "nothing in its sources avoids it" holds: neither a `truncate` first nor a piece size removes it
(17 a frame at S2, 26 at S3). A **read** sends none: it copies into "FixedBufferOutputStream::Create(AsWritableChars(aData));"
(`FileSystemSyncAccessHandle.cpp` 587–588), straight into the slot.

**Predicted floor** (theory, from the *measured* rates of A on arrival, which wrote from the frame's own buffer on a
sync handle, cache-io-thread §Arm D, Results: Chromium 816 MB/s at S1; Firefox 360 MB/s at S1 and 1 178 MB/s at S2; and
read + re-check 0.10 / 2.3 / 6.3 ms for 0.52 / 9.85 / 27.3 MB, choice 1, warm): write ~0.6 / ~21 / ~33 ms (Chromium) and
~1.4 / ~14 / ~23 ms (Firefox) at S1 / S2 / S3; read under 0.1 / ~4 / ~6 ms, warm. **Pilot** (*advocate*; was "nothing
to tune"): the write piece, the whole frame or 2 MiB; rule, stated before the pilot: 2 MiB wins if its miss p99 at S2 during
a fill is lower and its write cost a frame is within 10 % of the whole frame's; else the whole frame.

**Advocate's list, 2026-11-14** (CACHE-ADVOCATE-OPFS-SYNC; a session that wrote no design). Sources at 7.6.

* *Changes made above*: reads first, with the write in pieces; `truncate` at open; the engine-side copies traced (none
  beyond the page cache in Chromium and Gecko); Gecko's quota IPC re-traced and confirmed unavoidable.
* *Disadvantages it still carries*: **one writer a series.** The exclusive lock ("Creating a FileSystemSyncAccessHandle
  takes an exclusive lock", fs 605) admits one handle, so the three decoders' frames are written in turn by one worker;
  whether one writer keeps up with a phone's ~358 MB/s is P2's (§6), and the cloud floor (~470 MB/s at S2 on Chromium,
  ~700 on Firefox, from the floor above) is not a phone's. **Gecko's 17–26 synchronous IPCs a frame** at S2–S3, above.
  **WebKit's main-thread waits** at `createSyncAccessHandle`, at growth and at `close()` (h): once a series each, but a
  busy page delays a series' first write and its eviction. **No flush**: a frame and its record may reach the disk in
  either order after an OS crash; the re-check catches it (choice 6) at the cost of a re-fetch, not a wrong frame.
  **Sparse space**: the `truncate` at open counts the whole series against the quota before it is filled, so a series
  opened and left early holds quota until eviction, as built.
* *Not adopted, named*: Chromium's `createSyncAccessHandle({mode})` ("readwrite-unsafe" would let a second worker or tab
  hold a handle beside the writer) is Chromium-only and off the standard track ("chrome": { "version_added": "121" } ·
  "firefox": { "version_added": false } · "safari": { "version_added": false } · "standard_track": false,
  browser-compat-data `api/FileSystemFileHandle.json` 143–165); a design for one engine is not this arm's.
* *Proposed for all four alike (a change to 7.5, the rule above the seam; the protocol's author decides whether it
  enters)*: **a second tab reads what is present and writes nothing**, instead of "no cache". For OPFS-SYNC its read is
  `getFile()`, which takes no lock beside the first tab's handle (cache-io-thread (c), *run once* on Chromium 153 and
  Firefox 159), slower than the handle (Gecko pumps it on the main thread, (c)); IDB and CACHESTORAGE read in a
  read-only transaction or by `match`; OPFS-ASYNC by `getFile()` as its own reads. In that tab a re-check failure is a
  miss, never a damaged frame: the first tab may be writing it.
* *What the shared input costs it*: a read needs a **free slot**, so when a slow writer has dried the ring (7.0's
  backpressure) a miss waits for a slot as well as for its read. The same for all four; the protocol's read-to-paint
  cell should run with the ring full as well as idle.

### 7.2 · OPFS-ASYNC: a file per frame by `createWritable`, a copy in its writer

| | design | from its sources |
| --- | --- | --- |
| writer | the store worker copies the slot into an `ArrayBuffer` it reuses, then per frame `createWritable()` (no `keepExistingData`), `write(buffer)`, `close()` | the chunk is `BufferSource` (fs 1110), so the copy is forced and counted as the store's; `keepExistingData` "is first copied to this temporary file" (fs 532–538) and is never set |
| layout | a directory per series, a file per frame named by its index, holding the samples then a 7-int trailer (as `client/view/frame-file.js`); the manifest beside | a packed file is ruled out by its own cost ("21 GB for `dbts_b1`'s 50 × 17 MB", cache-io-thread *What this rules out*) |
| copies | in script one (slot → buffer); then the engine's: Chromium a string and a data pipe in 32 KiB pieces, Gecko a vector then 1 MiB blocks, WebKit an IPC carrying the bytes and a file copy at close (cache-io-thread (a)) | — |
| transactions | each frame commits at `close()` ("It is expected that this atomically updates the contents of the file on disk", fs 1179): a file is whole or absent | so a torn frame needs a crash inside the engine's swap; the re-check stays |
| does it fit | at open, a probe: `createWritable()` on a probe file, `truncate(n × frameBytes)`, then `abort()`; a refusal evicts and probes again. It is a check, not a reservation: a frame can still be refused mid-fill (7.5) | the writable's truncate rejects "with a QuotaExceededError" (fs 1295–1296); whether each engine refuses at the truncate or only at close is **not traced**; the pilot checks it per engine and, if no engine refuses before close, the probe is dropped |
| reads | the store worker, by the pilot's choice: `getFile()` then `arrayBuffer()` into a new buffer, copied into a free slot; or `createSyncAccessHandle()` on the frame's closed file and `read(slotView)` | `getFile()` takes no lock (cache-io-thread (c)); the sync read is A's, ~2× faster on Chromium at S3 (40.1 against 83.4 ms a miss, *measured*) |
| eviction | `removeEntry(series, {recursive: true})` after the series' Web Lock is taken with `ifAvailable` | a file per frame has no series-wide lock: `navigator.locks` as `client/view/cache.js` does |

**Reuses** `client/view/frame-file.js` (the file per frame and its trailer) and the Web Lock of `client/view/cache.js`;
B's measured costs (cache-io-thread). **Changes**: B ran on the view thread; here every copy and call is the store
worker's, off the paint. **Per engine:** WebKit posts every async call a worker makes to the page's main thread
(`getFile`, `createWritable`, each `write`, `close`; cache-io-thread (a), corrected 2026-10-29), so under a busy page
each frame waits; Gecko pumps a `getFile()` read on the main thread ((c)); Chromium moves the swap over the target at
close and skips the after-write check for OPFS ((a)).

**Predicted floor** (theory; anchor: B on arrival's *measured* write rates on the view thread, Chromium 139 MB/s and
Firefox 29 MB/s at S1, Firefox 316 MB/s at S2, which include B's view-thread copy): write ~3.7 / ~120 / ~200 ms on
Chromium (S2, S3 not measured: the S1 rate scaled, an upper bound) and ~18 / ~54 / ~86 ms on Firefox at S1 / S2 / S3;
read by `getFile()` ~23 / ~43 ms more than OPFS-SYNC's at S2 / S3 on Chromium (52.0 − 28.8, 83.4 − 40.1, *measured* miss
p50s). **Pilot** (rule: the setting with the lower median write cost a frame at S2 wins; a tie within 10 % keeps the
first): writes in flight, 1 or 3; the read, `getFile()` or a sync handle.

### 7.3 · IDB: a record per frame, one transaction a frame, `relaxed`

| | design | from its sources |
| --- | --- | --- |
| writer | the store worker copies the slot into a fresh `ArrayBuffer` (a shared buffer is refused for storage) and `put`s it in a `readwrite` transaction opened with `{durability: "relaxed"}` | "Web applications are encouraged to use "relaxed" for ephemeral data such as caches" (IndexedDB 942); the refusal: html `source` 11025–11026 (§2) |
| layout | one database; object store `frames`, key `[series, i]`, value the samples (the pilot: an `ArrayBuffer` or a `Blob` of them); object store `series`, key `series`, value the manifest | each engine moves a large value out of the row by its own rule (below), so the value's type is the one setting that changes the disk path |
| copies | in script one (slot → buffer), then serialization's ("Let \|dataCopy\| be ? CreateByteDataBlock(\|size\|)", html `source` 10717, cache-options §2.1), then the engine's: Chromium Snappy where its feature is on and a blob file above 64 KiB, Gecko a file above 1 MiB, WebKit a SQLite column (below) | — |
| transactions | one frame a transaction, the manifest's `opened` in its own at open; the pilot may batch 3 | "either all of the changes must be written, or … the implementation must not write any of the changes" (IndexedDB 1072–1076); writers on one store run in turn, the first created first (1148) |
| does it fit | **no answer before a byte is written**: IndexedDB has no `truncate`, and a probe would write the series' bytes. A refused transaction (`QuotaExceededError` on its abort) at any frame takes 7.5's mid-fill row | an implementation disadvantage of the option, left for its advocate |
| reads | `get([series, i])` in a `readonly` transaction; a new `ArrayBuffer` (or a `Blob`, then `arrayBuffer()`), copied into a free slot | — |
| eviction | one `readwrite` transaction: `delete(IDBKeyRange.bound([s, 0], [s, n]))` on `frames` and `delete(s)` on `series`, after the series' Web Lock is taken with `ifAvailable` | atomic: a series is gone whole or not at all |
| present at open | `getAllKeys(IDBKeyRange.bound([s, 0], [s, n]))` | IndexedDB 2787–2788 |

**Reuses** nothing built; the rules above the seam and the Web Lock of `client/view/cache.js`. **Per engine, traced
here** (the §3 *Not traced* items): **WebKit posts every IndexedDB call a worker makes to the page's main thread**:
`putOrAdd`, `getRecord`, `getAllRecords` each go through `callConnectionOnMainThread`, which runs the call at once on the
main thread and otherwise "postMainThreadTask" (`IDBConnectionProxy.cpp` 220, 228, 236; `IDBConnectionProxy.h`
149–155). So a WebKit IDB write or read waits for a busy page, as OPFS-ASYNC's does. **WebKit keeps a large
`ArrayBuffer` in the row**: the value is bound whole into the `Records` table ("statement->bindBlob(3,
*value.data().data())", `SQLiteIDBBackingStore.cpp` 2005, into "INSERT INTO Records VALUES (?, CAST(? AS TEXT), ?,
NULL);", 2000); only a `Blob` leaves it, as a file listed in `BlobRecords` and `BlobFiles` (82–83, 2030–2045). **Gecko keeps IndexedDB
in a private window**, where OPFS is off: "# Enable indexedDB in private browsing mode with encryption" ·
"dom.indexedDB.privateBrowsing.enabled … value: true" (`StaticPrefList.yaml` 3563–3566), "private browsing databases,
which are only temporary" (`ActorsParent.cpp` 13500–13501); a file it writes may be Snappy-compressed and, with a key,
encrypted (`ActorsParent.cpp` 21810–21819). **Chromium**: a value still "large" after compression "is converted into a
Blob" (`idb_value_wrapping.h` 61–64), and no compression on its SQLite backend ("if (backend_uses_sqlite_) { return
false;", `idb_value_wrapping.cc` 155–157); which backend a profile runs was not traced.

**Predicted floor** (theory; **no measured anchor**): each engine moves the bytes through an IPC to a file or a row
after two copies in the renderer, so no faster than OPFS-ASYNC's floor at S2–S3, plus Snappy where it runs: write
≥ ~50 ms at S2 on Firefox, read ≥ OPFS-ASYNC's; the floor probe gives the first number. **Pilot** (the same rule as
7.2): the value, `ArrayBuffer` or `Blob`; frames a transaction, 1 or 3.

### 7.4 · CACHESTORAGE: a `Cache` per series, a response per frame

| | design | from its sources |
| --- | --- | --- |
| writer | the store worker copies the slot into a fresh `ArrayBuffer` and `cache.put(new Request(base + i), new Response(buffer))`, base a same-origin `https:` path never fetched (`/frame-cache/<series>/`) | a body's buffer is `BufferSource`, copied ("Set source to a copy of the bytes held by object.", fetch 8256–8257, §2); a key must be `http(s)` and `GET`, a `206` refused (ServiceWorker 2167, 2169) |
| layout | `caches.open("frames " + series)`; one record a frame; the manifest as one more record (`…/manifest`, JSON). The digest stays in the manifest, not in a header: one place, as the other three | — |
| copies | in script one (slot → buffer), then the body's, then the engine's (below) | — |
| transactions | each `put` is a batch whose changes the implementation "does undo (roll back)" on an exception (ServiceWorker 4149); WebKit's disk store does not revert a failed batch (below) | the re-check stays |
| does it fit | as IDB: no answer before a byte is written; a refused `put` takes 7.5's mid-fill row | an implementation disadvantage of the option |
| reads | `cache.match(req)` then `arrayBuffer()`: a new buffer, copied into a free slot | `match` and `put`: ServiceWorker 2010, 2014 |
| eviction | `caches.delete(name)` after the series' Web Lock is taken with `ifAvailable`: one call, the series whole | ServiceWorker 2272 |
| present at open | `cache.keys()` | 2016 |

**Reuses** nothing built; the rules above the seam and the Web Lock. **Per engine, traced here** (the §3 *Not traced*
items). **WebKit's worker reaches the network process without the main thread after the first call**: creating the
worker's connection waits on the main thread once (`callOnMainThreadAndWait(`, `WorkerGlobalScope.cpp` 587;
`callOnMainRunLoopAndWait(`, `WebCacheStorageConnection.cpp` 53), then each call is a message sent from the worker
("connection()->sendWithPromisedReply<PromiseConverter>(Messages::NetworkStorageManager::CacheStoragePutRecords {", 98).
So under a busy page WebKit's Cache Storage, unlike its IndexedDB and async OPFS, is predicted not to wait. On disk, a
body over a page is a file of its own beside the record ("return bodyData.size() > WTF::pageSize();",
`CacheStorageDiskStore.cpp` 97–99), read back by `mmap` (86), and **hashed with SHA-1 at write and checked on read**
("if (storedInfo->metaData.bodyHash != computeSHA1(sharedBuffer->span(), m_salt))", 383): a second hash of every frame
beside our XXH3; and "// FIXME: we should probably stop writing and revert changes when result becomes false." (586).
**Chromium** loads the response's body "as a blob" in the renderer (`cache.cc` 337) and writes it into a disk-cache
entry of the simple backend, "Use APP_CACHE as opposed to DISK_CACHE to prevent cache eviction." (`cache_storage_cache.cc`
2625, 2639). **Gecko** writes each body to a file under `morgue` through a Snappy stream
("MakeRefPtr<SnappyCompressOutputStream>(fileStream);", `dom/cache/FileUtils.cpp` 74, 177), and keeps Cache Storage
in a private window ("# Enable CacheAPI in private browsing mode with encryption" · "value: true",
`StaticPrefList.yaml` 2736–2739).

**Predicted floor** (theory; **no measured anchor**): as IDB's, plus Gecko's Snappy on write and read and WebKit's SHA-1
on write and read (SHA-1 is not timed in the repo; at an assumed 0.5–1 GB/s, 17–34 ms at S2, labelled assumed).
**Pilot** (the rule of 7.2): `put`s in flight, 1 or 3.

### 7.5 · The failures of cache-in-opfs choice 7, per survivor

What the store sees, and what it does (above the seam, the same rule for all, where a cell says "the rule").

| failure | OPFS-SYNC | OPFS-ASYNC | IDB | CACHESTORAGE |
| --- | --- | --- | --- | --- |
| no store (Firefox private; Safari private by source) | `getDirectory()` rejects: no cache | the same | **a store**: Gecko keeps it in a private window, encrypted, temporary (7.3); Safari private not traced | **a store** in Gecko's private window (7.4); Safari not traced |
| the series does not fit | `truncate` refused at the first frame: the rule (evict, retry; else no cache) | the probe refused at open: the rule; else as the mid-fill row | known only mid-fill | known only mid-fill |
| the disk fills mid-fill | a write throws: evict one, retry once, else stop writing | `close()` rejects: the same | the transaction aborts: the same | the `put` rejects: the same |
| Chromium private window | OPFS in RAM, 5–6.7 % of it (choice 5): caches what fits | the same | not traced | not traced |
| the origin emptied between opens | no manifest: a fresh fill | the same | no `series` record: the same | no `manifest` record: the same |
| the store vanishes while open | a read throws: a miss | the same | a request errors: a miss | `match` rejects or is `undefined`: a miss |
| two tabs, one series | the second's `createSyncAccessHandle` throws: that tab, no cache (*advocate* proposes reads for all four, 7.1's list) | the Web Lock is held: no cache | the same (the engine would order the writes, 1148; one rule for all) | the same |
| a damaged frame | the re-check fails: clear its record, ask again, report | delete its file: the same | delete its record: the same | `delete` its request: the same |

### 7.6 · Sources for §7

Fetched 2026-11-14 at `cache-options.md`'s commits; nothing fetched is committed. Quotes are verbatim, markup stripped.

| source | commit | sha256 (first 12) |
| --- | --- | --- |
| whatwg/fs `index.bs` · w3c/IndexedDB `index.bs` · w3c/ServiceWorker `index.bs` · whatwg/fetch `fetch.bs` | `d76d3455d5af` · `f9f83f196f85` · `57dfd24943fe` · `2696300d95bb` | `e99666c5d561` · `98ca68a462e3` · `36d1f2c746fa` · `478609e29799` |
| WebKit `Source/WebCore/Modules/indexeddb/client/IDBConnectionProxy.cpp`, `.h` | `782d2a977efb` | `583d890554c2`, `210614aeed1d` |
| WebKit `Source/WebCore/Modules/indexeddb/server/SQLiteIDBBackingStore.cpp` | `782d2a977efb` | `6ded8c2e4c1c` |
| WebKit `Source/WebCore/workers/WorkerGlobalScope.cpp`; `Source/WebKit/WebProcess/Cache/WebCacheStorageConnection.cpp` | `782d2a977efb` | `6b13c8bd7f23`; `e214afd35864` |
| WebKit `Source/WebKit/NetworkProcess/storage/CacheStorageDiskStore.cpp` | `782d2a977efb` | `0f49fe0b52e6` |
| Gecko `modules/libpref/init/StaticPrefList.yaml`; `dom/indexedDB/ActorsParent.cpp`; `dom/cache/FileUtils.cpp` | `c72617c01649` | `3f511c2677dd`; `1410d6e13763`; `556e80fdc323` |
| Gecko `dom/quota/FileStreams.cpp`, `dom/quota/RemoteQuotaObject.cpp`, `dom/fs/api/FileSystemSyncAccessHandle.cpp`, `dom/fs/child/FileSystemAsyncCopy.cpp` (OPFS-SYNC's advocate) | `c72617c01649` | `1a157b5d061e`, `f6d4aa60b96a`, `dfb9fe3aeb1b`, `f6aa217fc6e1` |
| Chromium `third_party/blink/renderer/modules/file_system_access/file_system_access_regular_file_delegate.cc` (OPFS-SYNC's advocate) | `b124f80df73f` | `aae56d34329c` |
| mdn/browser-compat-data `api/FileSystemFileHandle.json` (OPFS-SYNC's advocate) | `69fcf3608174` | `86765e16b864` |
| Chromium `third_party/blink/renderer/modules/indexeddb/idb_value_wrapping.h`, `.cc`; `…/modules/cache_storage/cache.cc`; `content/browser/cache_storage/cache_storage_cache.cc` | `b124f80df73f` | `18ad474f6be6`, `bc9aa5d9bfe1`; `7a2125968f57`; `d05f03985fbe` |

**Still not traced:** whether a writable's `truncate` is refused before `close()` in each engine (7.2's probe; the
pilot checks it); which IndexedDB backend a Chromium profile runs; IndexedDB and Cache Storage in a Chromium private
window and in Safari's; SHA-1's rate on a phone.

**Fixtures and their limits.** Nothing was run for this file. The *measured* numbers it quotes come from a 4-vCPU
cloud container without a GPU, Chromium 153 and Firefox 159, synthetic 16-bit series at 512², 2560×3328 and
3328×4096, a warm page cache; and one phone, Chrome 157, one series (`dbts_b1-q8-g8`), one evening, software AV1.
WebKit is read from source only, as are every IndexedDB and Cache Storage path. No breast ultrasound cine.
