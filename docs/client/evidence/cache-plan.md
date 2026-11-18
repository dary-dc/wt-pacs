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

## 5 · The protocol's frame (CACHE-PROTOCOL fills it: §8)

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

### 7.2 · OPFS-ASYNC: a file per group of frames by `createWritable`, a copy in its writer

*Amended 2026-11-14 by CACHE-ADVOCATE-OPFS-ASYNC; each change is marked* advocate *with its source. The design as
CACHE-DESIGN wrote it was a file per frame with one reused buffer; both are corrected below, the earlier text kept where
it still holds.*

| | design | from its sources |
| --- | --- | --- |
| writer | the store worker copies the slot into an `ArrayBuffer` of a pool of k, one per write in flight, then writes it into its group's writable (below); **a buffer is reused only after its `write()` has resolved** (*advocate*: the design reused one buffer with up to 3 writes in flight, which would write one frame's bytes under another's) | the chunk is `BufferSource` (fs 1103–1107), so the copy is forced and counted as the store's; the bytes are read in a queued task, not at the call: "Enqueue the following steps to the file system queue:" … "let dataBytes be a copy of data." (fs 1213, 1239); Chromium copies them when its sink runs, "STRING_MAY_BE_INVALIDATED_BEFORE_COMPLETION" (`file_system_underlying_sink.cc` 376–379) |
| layout | a directory per series; **a file per group of G consecutive frames**, G = max(1, ⌊8 MiB ÷ (frameBytes + 28)⌋), so one frame a file at S2 and S3 and 15 at S1; frame j of a group at j × (frameBytes + 28), its samples then `frame-file.js`'s 7-int trailer; the manifest beside (*advocate*: the design had a file per frame at every size) | each group file is written by one writable, once, without `keepExistingData`, so none of the packed file's n²/2 copies ("21 GB for `dbts_b1`'s 50 × 17 MB", cache-io-thread *What this rules out*); positioned writes: "If input is a dictionary and input["position"] exists, set writePosition to input["position"]." (fs 1234–1236). Why groups: a fixed cost per file; see *The cost a file*, below |
| copies | in script one (slot → buffer); then the engine's: Chromium a string and a data pipe in 32 KiB pieces, Gecko a vector then 1 MiB blocks, WebKit an IPC carrying the bytes and a file copy at close (cache-io-thread (a)) | — |
| transactions | each group commits at `close()` ("It is expected that this atomically updates the contents of the file on disk", fs 1179): a group is whole or absent; **its frames' slots stay held until that close resolves** (7.0's rule, unchanged), and a read of a frame in an open group is answered from its held slot | so a torn frame needs a crash inside the engine's swap; the re-check stays |
| does it fit | at open, a probe: `createWritable()` on a probe file, `truncate(n × (frameBytes + 28))`, then `abort()`; a refusal evicts and probes again. A check, not a reservation: a group can still be refused mid-fill (7.5). **Chromium refuses at the truncate, before close** (*advocate*, traced): the writable's truncate runs the sandbox's, "if (!AllocateQuota(context, growth))" / "return base::File::FILE_ERROR_NO_SPACE;", after "GetBucketSpaceRemainingAndRunTask(" (`obfuscated_file_util.cc` 568–569; `file_system_operation_impl.cc` 226), and an aborted writer removes its swap ("should_purge_swap_file_on_destruction_" … "= true;", `file_system_access_file_writer_impl.h` 148–149; "&FileSystemOperationRunner::RemoveFile,", `…_writer_impl.cc` 63) | the writable's truncate rejects "with a QuotaExceededError" (fs 1295–1296); Gecko and WebKit still **not traced**: the pilot checks them, and the probe is dropped for an engine that does not refuse before close |
| reads | the store worker, by the pilot's choice per engine: `getFile()`, `slice()` of the frame, `arrayBuffer()` into a new buffer, copied into a free slot; or `createSyncAccessHandle()` on the group's closed file and `read(slotView, {at})` | `getFile()` takes no lock (cache-io-thread (c)); the sync read is A's, ~2× faster on Chromium at S3 (40.1 against 83.4 ms a miss, *measured*), but it creates a handle a read: D's handle calls cost 26.9 ms on Firefox at S1 (*measured*, cache-io-thread §Arm D, Results) |
| present at open | list the series' directory: a group file present holds all its frames; **any other name is removed** (*advocate*: a stale swap, below) | — |
| eviction | `removeEntry(series, {recursive: true})` after the series' Web Lock is taken with `ifAvailable` | a file a group has no series-wide lock: `navigator.locks` as `client/view/cache.js` does |

**Reuses** the trailer of `client/view/frame-file.js` (its format; its code is a sync handle's) and the Web Lock of
`client/view/cache.js`; B's measured costs (cache-io-thread). **Changes**: B ran on the view thread; here every copy and
call is the store worker's, off the paint. **Per engine:** WebKit posts every async call a worker makes to the page's
main thread (`getFile`, `createWritable`, each `write`, `close`; cache-io-thread (a), corrected 2026-10-29), so under a
busy page each group waits; Gecko pumps a `getFile()` read on the main thread ((c)); Chromium moves the swap over the
target at close and skips the after-write check for OPFS ((a)). Gecko gives a writable without `keepExistingData` a new,
empty file ("aMode == FileMode::SHARED_FROM_EMPTY", `FileSystemDatabaseManagerVersion002.cpp` 571–572), so it copies
nothing of the old one either.

**The cost a file** (*advocate*; theory, a two-point fit to *measured* rates). B on arrival wrote one file a frame at
Firefox 29 MB/s at S1 and 316 MB/s at S2 (cache-io-thread §Arm D, Results): 18.1 ms for 0.52 MB, 53.9 ms for 17.0 MB.
A line through both is **~17 ms a file plus ~460 MB/s**: at S1 the file, not the bytes, is the cost, and a file a frame
predicts ~29 MB/s against the 125 MB/s a fill decodes, as D's file a frame measured 30 (§Arm D). Fifteen frames a file
predict ~2.3 ms a frame, ~230 MB/s. On Chromium the one point (139 MB/s at S1, 3.8 ms a frame) does not split. The
fixed part is each engine's directory work per file, by source: Chromium creates the file, its swap and the move in the
sandbox's directory database (`obfuscated_file_util.cc`); Gecko resolves the path and locks in SQLite on the parent at
every `createWritable` (`FileSystemManagerParent.cpp` 201–232). Both points include B's view-thread copy and the
paint's contention, so the fit is labelled theory, not a rate of the store worker.

**A kill's leftovers** (*advocate*, traced in Chromium). A page that dies without `close()` loses its writer through the
pipe's disconnect, which destroys it and removes its swap (`…_writer_impl.cc` 153–177, 59–63). Only a browser crash
leaves `<name>.crswap`, a sibling in the series' directory (`url().CreateSibling(*opt_swap_name)`,
`file_system_access_file_handle_impl.cc` 759, 762); the next writable of that name takes `<name>.1.crswap`, and after a
hundred, "Failed to create swap file." (`int max_swap_files_ = 100;`, `…_handle_impl.h` 209; `…_handle_impl.cc` 729–785).
Hence *present at open* removes every name that is not a group. Whether OPFS's listing shows the swap is not traced;
Gecko's and WebKit's leftovers are not traced.

**Predicted floor** (theory; anchor: B on arrival's *measured* rates on the view thread, which include B's view-thread
copy): write ~3.7 / ~120 / ~200 ms a frame on Chromium at S1 / S2 / S3 (S2, S3 not measured: the S1 rate scaled, an
upper bound; groups would lower S1 by an amount the one point cannot give), and on Firefox ~2.3 ms at S1 with groups
(~18 without), ~54 / ~86 ms at S2 / S3; read by `getFile()` ~23 / ~43 ms more than OPFS-SYNC's at S2 / S3 on Chromium
(52.0 − 28.8, 83.4 − 40.1, *measured* miss p50s). **Pilot**, per engine, one setting at a time in this order, each
frozen before the next; a tie within 10 % keeps the first value (*advocate*: the design judged all three by the write at
S2, where the group setting does not exist and the read setting does not act): **G**, 1 or the 8 MiB group, by the
median write cost a frame at S1; **writes in flight**, 1 or 3, by the median write cost a frame at S2; **the read**,
`getFile()` or a sync handle, by the miss p50 at S2.

**Disadvantages the design still carries** (*advocate*), each the option's or its build's as marked:

1. **Two copies of every frame in the renderer** before the engine's own: the forced one in script and the engine's
   (Chromium's string, Gecko's vector), against OPFS-SYNC's none. The option's (fs 1103–1107).
2. **k frames of memory outside the ring**: the buffer pool, 3 × 27.3 MB = 82 MB at S3 with 3 in flight, beside the held
   slots. The build's, by the shared rule below.
3. **WebKit writes every frame twice** (the file copy at close) **and waits on the page's main thread for every call**:
   under a busy page a WebKit fill's writes queue behind its long tasks (cache-io-thread (a), corrected 2026-10-29). The
   option's on WebKit; a busy-page cell on WebKit is owed before adoption there (§5).
4. **Safari from 26 only**: `createWritable` is `"version_added": "26"` (`api/FileSystemFileHandle.json`), and off in
   Lockdown Mode (cache-io-thread (b)); OPFS-SYNC has Safari 15.2. Older Safari has no writer for this arm. The option's.
5. **Nothing reserves space**: the probe checks and releases; a group is refused mid-fill when another write took the
   room. The option's (no reservation in fs).
6. **A frame is not on disk until its group closes**: up to G − 1 more frames than a file a frame lost by a kill, and a
   group's slots held longer (15 × 0.52 MB at S1). The design's, traded for the cost a file.
7. **A miss allocates a new buffer** (the `getFile()` read: an `ArrayBuffer` the frame's size, then a copy into the slot),
   and on Gecko is pumped on the main thread ((c)); the sync read instead creates and closes a handle a read, ~27 ms on
   Firefox at S1 by D's numbers. The pilot picks per engine; neither is free.
8. **A stale swap holds quota** until its series is opened or evicted (Chromium, after a browser crash). The option's
   in Chromium.

**The shared seam and input, as they handicap this arm**, proposed for all four alike, not applied (7.0 and 7.5 are
one rule for all; adopting either is the protocol's author's or the owner's):

* **A slot held until written** (7.0) costs an arm that copies (OPFS-ASYNC, IDB, CACHESTORAGE) the frame twice in
  memory while it is in flight: the slot and the store's own copy. Proposal: a slot is freed once the store holds its
  own copy, the store's buffers bounded by its writes in flight and counted in the memory cell; a read of a frame in
  flight is answered from that copy. OPFS-SYNC, which writes from the slot, is unchanged by it.
* **Two tabs on one series: no cache in the second** (7.5). A group commits whole, a writable takes a shared lock
  ("Creating a FileSystemWritableFileStream takes a shared lock", fs 540; Chromium's default "mode = "siloed"",
  `file_system_create_writable_options.idl`), and `getFile()` takes none, so two tabs writing the same frame each commit
  the same checked bytes and neither can tear the other's. Proposal: the series' Web Lock taken `"shared"` by every tab
  that has it open, and `"exclusive"` with `ifAvailable` by eviction alone ("If a "shared" lock is held, other "shared"
  locks with that name can be granted — but not any "exclusive" locks.", web-locks `index.bs` 200). It extends 7.1's
  proposal (a second tab reads and writes nothing): the second tab may also write in OPFS-ASYNC, IDB and CACHESTORAGE,
  and stays a reader in OPFS-SYNC, whose handle is exclusive.

### 7.3 · IDB: a record per frame as a `Blob`, one transaction a frame, `relaxed`, one in flight

| | design | from its sources |
| --- | --- | --- |
| writer | the store worker copies the slot into **one non-shared `ArrayBuffer` it reuses** (*advocate*: was a fresh one a frame), makes `new Blob([scratch])`, `put`s the Blob in a `readwrite` transaction opened with `{durability: "relaxed"}`, then calls `commit()` (*advocate*) | the copy is forced: a shared buffer is refused for storage (html `source` 11025–11026, §2) and a Blob part is `BufferSource` (FileAPI 314). The Blob takes its own copy ("get a copy of the bytes held by the buffer source", FileAPI 429–430), so the scratch is free when the constructor returns: no 17 MB allocation a frame for the collector. "relaxed" for "ephemeral data such as caches" (IndexedDB 942); `commit()` "can be used to force a transaction to quickly finish, without waiting for pending requests to fire success events" (4912–4914); shipped: commit Chrome 76, Firefox 74, Safari 15; durability Chrome 83, Firefox 126, Safari 15 (browser-compat-data `api/IDBTransaction.json`) |
| layout | one database; object store `frames`, key `[series, i]`, value **a `Blob` of the samples** (*advocate*: was the pilot's choice; an `ArrayBuffer` stays a pilot alternative on Gecko only); object store `series`, key `series`, value the manifest | every engine sends a Blob to a file of its own and skips its value compression (*advocate*, traced): **Chromium** Snappy-compresses a large value in the renderer, at `put`, with a feature on by default ("BASE_FEATURE(kIndexedDBCompressValuesWithSnappy, base::FEATURE_ENABLED_BY_DEFAULT);", `features.cc` 862–863; "snappy::RawCompress(", `idb_value_wrapping.cc` 191), drops the result "if (compressed_length > uncompressed_length * 0.9)" (81) and then copies the bytes back (201–209): a Snappy pass over 17 MB on the store worker's thread, kept or not; a Blob is serialized as a reference. **Gecko** writes a structured clone above "kDefaultDataThresholdBytes = 1024 * 1024" (`IndexedDatabaseManager.cpp` 117) to a file through "MakeRefPtr<SnappyCompressOutputStream>(" (`ActorsParent.cpp` 21819), but "Compression is only necessary for eStructuredClone" (3880): a Blob is copied uncompressed. **WebKit** keeps an `ArrayBuffer` whole in its SQLite row and a Blob in a file (below). Gecko's compression runs in its parent process, not the page's, so there alone the pilot compares |
| copies | in script one (slot → scratch); then the Blob's (scratch → Blob), then the engine's to its file (*advocate*: the serialization copy and Chromium's Snappy buffer leave with the `ArrayBuffer`) | — |
| transactions | one frame a transaction, **one write transaction in flight**: the store worker creates the next only at the previous one's `complete`, and a read posted meanwhile is served first (*advocate*: was "the pilot may batch 3"; the batch is dropped) | "A read-only transactions tx can start when there are no read/write transactions which: Were created before tx; and have overlapping scopes with tx; and are not finished" (IndexedDB 1130–1133): every write transaction already created on `frames` stands before a miss's read, so a queue of them held by the engine delays a miss by all of them, held by the worker by one at most; a batch of 3 puts three frames' writes before it. Atomicity per transaction: IndexedDB 1072–1076 |
| does it fit | **`navigator.storage.estimate()` in the store worker at `open`** of a series not present: `quota − usage` below n × frameBytes takes the rule (evict, estimate again; else no cache) before any byte is fetched (*advocate*: was "no answer before a byte is written"). A check, not a reservation, as OPFS-ASYNC's probe: a refused transaction (`QuotaExceededError` on its abort) still takes 7.5's mid-fill row | "The estimate() method can be used to determine whether there is enough space left to store content for an application" (storage 72–73); in workers ("WorkerNavigator includes NavigatorStorage;", 609; "Exposed=(Window,Worker)", 619). Usage is "an implementation-defined rough estimate" (536–537), and quota "must not be a function of the available storage space on the device" (545–546): a full disk is still found mid-fill |
| reads | `get([series, i])` in a `readonly` transaction; a `Blob`, then `arrayBuffer()`: a new buffer, copied into a free slot | — |
| eviction | one `readwrite` transaction: `delete(IDBKeyRange.bound([s, 0], [s, n]))` on `frames` and `delete(s)` on `series`, after the series' Web Lock is taken with `ifAvailable`. On Chromium the files leave later (*advocate*, traced): the rule's retry waits for `estimate()` to show the room, at most 5 s | atomic: a series is gone whole or not at all. Chromium's LevelDB store removes a deleted value's files by a journal cleaned on a timer: "kMaxJournalCleanRequests = 50", "kMaxJournalCleaningWindowTime = base::Seconds(5)", "kInitialJournalCleaningWindowTime = base::Seconds(2)" (`leveldb/backing_store.h` 422–429). Whether `usage` drops at the commit or at the cleaning is **not traced**; the build's eviction test finds it |
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
false;", `idb_value_wrapping.cc` 155–157). **Which backend, traced** (*advocate*; was not traced): on disk, LevelDB
unless a field trial says otherwise ("BASE_FEATURE(kIdbSqliteOnDiskRollout, base::FEATURE_DISABLED_BY_DEFAULT);",
`content_features.cc` 555; the stage's default "SqliteRolloutStage::kUseLevelDbForNewStores" (`bucket_context.cc` 101),
which uses SQLite "only if it already exists and LevelDB does not exist" (277)); **in memory, a private window, always
SQLite** ("if (in_memory) {" · "return SqliteRolloutStage::kUseSqliteOnly;", 240–241). So a Chromium private window has
an IndexedDB store, held in memory; its size limit there is not traced. A run records the profile's stage (field trials
can move it): the build row says how.

**Predicted floor** (theory; **no measured anchor**): each engine moves the bytes through an IPC to a file after one copy
in script and the Blob's, so no faster than OPFS-ASYNC's floor at S2–S3: write ≥ ~50 ms at S2 on Firefox, read ≥
OPFS-ASYNC's; the floor probe gives the first number. *Advocate*: with a `Blob`, Chromium's Snappy pass leaves the
floor; a `put` of an `ArrayBuffer` beside it in the floor probe prices what that pass cost. **Pilot** (the rule of 7.2):
on Gecko only, the value, `Blob` or `ArrayBuffer`; nothing else (*advocate*: frames a transaction is fixed at 1, above).

**Advocate's list, 2026-11-14** (CACHE-ADVOCATE-IDB; a session that wrote no design). Sources at 7.6.

* *Changes made above*: the value a `Blob` on every engine (no Snappy pass on Chromium's or Gecko's write, no 17 MB row
  in WebKit's SQLite); one reused scratch buffer instead of a fresh one a frame; `commit()` after the `put`; one write
  transaction in flight, reads served first, the batch dropped; `estimate()` at open answers "does it fit" before the
  fetch; the eviction's retry waits for Chromium's deferred file removal; Chromium's backend traced (LevelDB on disk,
  SQLite in a private window).
* *Disadvantages it still carries*: **a copy in script each way.** A write copies the slot (the store refuses shared
  memory) and the Blob copies again; a read gets a new buffer from `arrayBuffer()` and copies it into the slot: two
  17 MB copies a write and one a read at S2 that OPFS-SYNC does not make, plus a 17 MB allocation a read. **WebKit's
  main thread on every call** (`put`, `get`, `getAllKeys`; above): a busy page delays each write and each miss, and
  nothing in IndexedDB avoids it. **A miss waits for the write in flight**, up to one frame's write (the scheduling
  rule above), where OPFS-SYNC's miss waits one piece. **No reservation**: `estimate()` is quota, not disk, and a
  rough usage; a series can still be refused mid-fill, and two tabs filling two series both see the same room.
  **Eviction frees space late on Chromium** (up to 5 s, above), so a fill that evicts to make room may stall at the
  retry. **A transaction a frame**: an IPC round to commit each, unpriced; with the batch dropped, nothing amortizes
  it. **Chromium's Blob crosses its blob registry** before the IndexedDB file (where it lives meanwhile, memory or
  disk, is not traced). **Gecko's private window encrypts** each file ("EncryptingOutputStream", `ActorsParent.cpp`
  21812–21814), a cost no other survivor pays there because none other runs there. **A frame is read whole**: no
  partial read, irrelevant while a read is a whole frame.
* *Proposed for all four alike (the protocol's author decides whether it enters)*: **a miss on a frame not yet
  written is served from what the store worker holds**: its slot under 7.0 as written, or its own copy under 7.2's
  first proposal (which already answers a read in flight so); either skips the store and its queue. It helps IDB
  most, whose miss queues behind a write transaction, but it is a store-worker rule, the same for all. Under 7.2's
  proposal IDB's own copy is the Blob, bounded by one write in flight. **The rule's retry after an eviction** waits for
  the room to show (`estimate()`, a bounded wait) rather than retrying at once, for all four: only Chromium's IndexedDB
  is traced to free space late, but the others' removal is not traced either.
* *What the shared input costs it*: the ring is shared memory, which IndexedDB refuses to store, so the input alone
  forces the write's first copy; reading into a slot forces the read's. Both are kept: the ring's bound on memory is
  the shared input's purpose (§3), and the copies are counted in IDB's floor, not hidden. OPFS-SYNC's free-slot wait
  under a dried ring (its list) applies here as well.

### 7.4 · CACHESTORAGE: a `Cache` per series, a response per frame

| | design | from its sources |
| --- | --- | --- |
| writer | the store worker builds the body from the ring's slot and `cache.put(base + i, new Response(body))`, base a same-origin `https:` path never fetched (`/frame-cache/<series>/`), the key a string (no `Request` built in script). The body, by the pilot (*advocate*; was a fresh `ArrayBuffer` a frame): **buffered**, one `ArrayBuffer` per put in flight, reused, the slot copied into it; or **streamed**, a `ReadableStream` enqueuing the slot's own 1 MiB views, kept only where the pilot's first check finds the engine accepts a shared chunk | a body's buffer is `BufferSource`, copied ("Set source to a copy of the bytes held by object.", fetch 8256–8257, §2): the copy is made at `new Response`, so the buffer is free to reuse once it returns (*advocate*); `put` reads a stream body by "reading all bytes" (ServiceWorker 2180), whose chunk is checked only as "If chunk is not a Uint8Array object, call failureSteps with a TypeError" and then "Append the bytes represented by chunk to bytes." (streams 7158–7160): whether an engine takes a view of shared memory there is **not traced**; a key must be `http(s)` and `GET`, a `206` refused (ServiceWorker 2167, 2169) |
| layout | `caches.open("frames " + series)`; one record a frame; the manifest as one more record (`…/manifest`, JSON). The digest stays in the manifest, not in a header: one place, as the other three. No header on a frame's response (no `Vary`, no `Content-Type`) | a `Vary: *` is refused (ServiceWorker 2170–2173); nothing else in `put` reads the headers |
| copies | buffered: in script one (slot → reused buffer), then the body's at construction, then the engine's (below). Streamed: none in script; the engine's copy of each chunk, then the engine's (below) | — |
| transactions | each `put` is a batch whose changes the implementation "does undo (roll back)" on an exception (ServiceWorker 4149); WebKit's disk store does not revert a failed batch (below) | the re-check stays |
| does it fit | (*advocate*; was "no answer before a byte is written") at `open` of a series not present, `navigator.storage.estimate()`: if `quota − usage` is under the series' bytes, evict by the rule and estimate again; else no cache. It is an estimate, not a reservation: a refused `put` mid-fill takes 7.5's row. On Chromium a refusal comes **before** the body is written: every batch's bytes are checked against the bucket's remaining space first (`cache_storage_cache.cc` 944, 1011–1013) | "The estimate() method can be used to determine whether there is enough space left to store content for an application" (storage 72–73); but usage is a "rough estimate" (537) and the quota "must not be a function of the available storage space on the device" (545–546): a full disk is not foreseen |
| reads | `cache.match(base + i)`, then, by the pilot's pair: **buffered** `arrayBuffer()`, a new buffer, copied into a free slot; **streamed** (*advocate*) the body's reader, each chunk copied into the slot at its offset as it arrives: no frame-sized buffer allocated a read, and the copy overlaps the read | `match` and `put`: ServiceWorker 2010, 2014 |
| eviction | `caches.delete(name)` after the series' Web Lock is taken with `ifAvailable`: one call, the series whole; then the estimate again (*advocate*), since the space may not be free at once ("the existing DOM objects … should remain functional", ServiceWorker 2353) | ServiceWorker 2272 |
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
2625, 2639). *Advocate, traced:* no entry-size limit binds a frame: a cache's backend is created with
"`std::numeric_limits<int64_t>::max()`" bytes (2630–2631), "Ultimately, cache size is controlled per storage key by the
QuotaManager." (2628–2629), and an entry may be an eighth of that ("index_->max_size() / file_size_ratio",
`simple_backend_impl.cc` 291). A cache with no path is in memory, "`memory_only_(path.empty())`" (1167), capped at
"`std::numeric_limits<int>::max()`" bytes a cache (2630), ~2 GiB a series; which profiles have no path is not traced.
**Gecko** writes each body to a file under `morgue` through a Snappy stream
("MakeRefPtr<SnappyCompressOutputStream>(fileStream);", `dom/cache/FileUtils.cpp` 74, 177), and keeps Cache Storage
in a private window ("# Enable CacheAPI in private browsing mode with encryption" · "value: true",
`StaticPrefList.yaml` 2736–2739). *Advocate, traced:* every block is compressed, never stored raw
("WriteChunkType(aDest, CompressedData);", `xpcom/io/SnappyFrameUtils.cpp` 110; "snappy::RawCompress(", 124), and
carries a CRC32C of its bytes computed at write (117–118) and checked at read ("if (NS_WARN_IF(readCrc != maskedCrc)) {",
226): a third pass over every frame beside the Snappy pass and our XXH3, and a damaged body fails its read
(`NS_ERROR_CORRUPTED_CONTENT`), a miss before our re-check sees it. The same compression **may shrink a frame on disk**
where its background repeats; not measured on our frames.

**Predicted floor** (theory; **no measured anchor**): as IDB's, plus Gecko's Snappy and CRC32C on write and read and
WebKit's SHA-1 on write and read (SHA-1 is not timed in the repo; at an assumed 0.5–1 GB/s, 17–34 ms at S2, labelled
assumed). **Pilot** (the rule of 7.2, each setting judged alone): `put`s in flight, 1 or 3; the pair, **buffered** or
**streamed** (*advocate*), streamed only where its first check passes (a frame put from shared views reads back equal on
that engine), judged by write plus read cost a frame at S2.

**Advocate's list, 2026-11-14** (CACHE-ADVOCATE-CACHESTORAGE; a session that wrote no design). Sources at 7.6.

* *Changes made above*: the body's buffer reused (the spec copies at construction), or streamed from the slot where an
  engine takes shared chunks; reads streamed into the slot; a string key; `estimate()` at open and after eviction;
  Chromium's quota check before the write, its entry size and its memory-only cap traced; Gecko's Snappy stream traced
  (always compressed, CRC32C both ways).
* *Disadvantages it still carries*:
  **Copies.** A body refuses a shared view ("If the conversion is not to an IDL type associated with the [AllowShared]
  extended attribute, and IsSharedArrayBuffer(V.[[ViewedArrayBuffer]]) is true, then throw a TypeError.", webidl
  9237–9240), so buffered costs two copies in the store worker before the engine's own, and a read always lands in a
  new buffer or new chunks before the slot; streamed removes the write's two only if an engine takes shared chunks.
  **No reservation.** `estimate()` is rough and blind to the disk (storage 537, 545–546); only OPFS's `truncate`
  reserves. On Gecko and WebKit, whether a refused `put` has written part of its body first is not traced.
  **Hashes and compression it cannot turn off**: WebKit's salted SHA-1 of every body at write and read
  (`CacheStorageDiskStore.cpp` 383), Gecko's Snappy and CRC32C of every block both ways (`SnappyFrameUtils.cpp` 110–124,
  226). The put spec itself buffers: "we have a full buffered copy of the body in clonedResponse. An implementation
  could optimize by streaming directly to disk rather than memory." (ServiceWorker 2182); Chromium's body passes
  through a blob first (`cache.cc` 337), and whether a 17–27 MB blob is held in memory or paged to disk before the
  entry is written is not traced.
  **WebKit does not roll back** a failed batch (`CacheStorageDiskStore.cpp` 586): a frame half-written there is the
  re-check's to catch. **Space after `caches.delete`** may lag while any `Cache` object for it lives (ServiceWorker
  2353); the estimate after eviction sees it, at the cost of a second round of eviction. **Chromium's memory-only
  cache** holds ~2 GiB a series (2630): a larger series is not cached whole there. **Keys are URLs**: a same-origin
  path the server never serves, or a future service worker's own `fetch` handling could answer it.
* *What the shared seam or input costs it*: 7.0 holds a slot **until its writer says written**; buffered copies the
  slot in under a few milliseconds and then holds it through the IPC, the engine's copies, the hashes and the disk.
  *Proposed for all four alike (a change to 7.0; the protocol's author decides whether it enters)*: a writer that holds
  its own copy of a frame (CACHESTORAGE and IDB buffered, OPFS-ASYNC's reused buffer) frees the slot when its copy is
  made, its copies bounded by its writes in flight and counted in the tab's memory; OPFS-SYNC and a streamed body
  keep the slot until written, as now. It is OPFS-ASYNC's advocate's first proposal (7.2), reached apart. And the read's free slot (OPFS-SYNC's list above) costs it a copy the others
  pay as well: a store that answers in a new buffer could post that buffer to the view worker as a transfer instead,
  for IDB, OPFS-ASYNC and CACHESTORAGE alike; not proposed, since a buffer outside the ring is memory the ring no
  longer bounds, named so the protocol's author can weigh it.

### 7.5 · The failures of cache-in-opfs choice 7, per survivor

What the store sees, and what it does (above the seam, the same rule for all, where a cell says "the rule").

| failure | OPFS-SYNC | OPFS-ASYNC | IDB | CACHESTORAGE |
| --- | --- | --- | --- | --- |
| no store (Firefox private; Safari private by source) | `getDirectory()` rejects: no cache | the same | **a store**: Gecko keeps it in a private window, encrypted, temporary (7.3); Safari private not traced | **a store** in Gecko's private window (7.4); Safari not traced |
| the series does not fit | `truncate` refused at the first frame: the rule (evict, retry; else no cache) | the probe refused at open: the rule; else as the mid-fill row | `estimate()` short at open: the rule; else as the mid-fill row (*advocate*, 7.3) | `estimate()` short at open: the rule; else as the mid-fill row (*advocate*, 7.4) |
| the disk fills mid-fill | a write throws: evict one, retry once, else stop writing | `close()` rejects: the same | the transaction aborts: the same | the `put` rejects: the same |
| Chromium private window | OPFS in RAM, 5–6.7 % of it (choice 5): caches what fits | the same | **a store**, in memory on the SQLite backend (*advocate*, 7.3); its limit not traced | in memory if its path is empty, ~2 GiB a series (7.4); not traced that it is |
| the origin emptied between opens | no manifest: a fresh fill | the same | no `series` record: the same | no `manifest` record: the same |
| the store vanishes while open | a read throws: a miss | the same | a request errors: a miss | `match` rejects or is `undefined`: a miss |
| two tabs, one series | the second's `createSyncAccessHandle` throws: that tab, no cache (*advocate* proposes reads for all four, 7.1's list) | the Web Lock is held: no cache | the same (the engine would order the writes, 1148; one rule for all) | the same |
| a damaged frame | the re-check fails: clear its record, ask again, report | delete its group's file, up to G frames (7.2, *advocate*): the same | delete its record: the same | `delete` its request: the same |

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
| Chromium `content/browser/file_system_access/file_system_access_file_handle_impl.cc`, `.h`; `…/file_system_access_file_writer_impl.cc`, `.h`; `storage/browser/file_system/obfuscated_file_util.cc`; `…/file_system_operation_impl.cc`; `third_party/blink/renderer/modules/file_system_access/file_system_underlying_sink.cc`; `…/file_system_create_writable_options.idl` (7.2, advocate) | `b124f80df73f` | `0801ddcfcf25`, `20d2b9258e37`; `573c92a6dcdc`, `dd589a524648`; `7a7a95b10cb1`; `d74a44713ded`; `9968ec1eec21`; `f0e987c55b1f` |
| Gecko `dom/fs/parent/FileSystemManagerParent.cpp`; `dom/fs/parent/datamodel/FileSystemDatabaseManagerVersion002.cpp` (7.2, advocate) | `c72617c01649` | `6bfe52fb8672`; `f23a77fc31b9` |
| w3c/web-locks `index.bs` (7.2, advocate) | `6dfe272f7b89` | `9aa2b5e625a7` |
| whatwg/storage `storage.bs` · w3c/FileAPI `index.bs` · mdn/browser-compat-data `api/IDBTransaction.json` (IDB's advocate; IndexedDB at the commit above) | `115691c51583` · `528c64a385e0` · `69fcf3608174` | `2617969b9b9f` · `176cb48a5514` · `bcef947da71c` |
| Chromium `third_party/blink/common/features.cc`; `content/public/common/content_features.cc`; `content/browser/indexed_db/instance/bucket_context.cc`; `content/browser/indexed_db/instance/leveldb/backing_store.h` (IDB's advocate) | `b124f80df73f` | `e098b5147f94`; `ed6ed8fd1079`; `034772c30825`; `0ccff8a628d3` |
| Gecko `dom/indexedDB/IndexedDatabaseManager.cpp` (IDB's advocate) | `c72617c01649` | `19572f39e492` |
| Chromium `third_party/blink/renderer/modules/indexeddb/idb_value_wrapping.h`, `.cc`; `…/modules/cache_storage/cache.cc`; `content/browser/cache_storage/cache_storage_cache.cc` | `b124f80df73f` | `18ad474f6be6`, `bc9aa5d9bfe1`; `7a2125968f57`; `d05f03985fbe` |
| whatwg/storage `storage.bs` · whatwg/streams `index.bs` (7.4, advocate) | `115691c51583` · `312b67e396a8` | `2617969b9b9f` · `4dc5a24c9d39` |
| Chromium `net/disk_cache/simple/simple_backend_impl.cc` (7.4, advocate) | `b124f80df73f` | `d02270d0dab1` |
| Gecko `xpcom/io/SnappyFrameUtils.cpp` (7.4, advocate) | `c72617c01649` | `d244627ccf43` |

**Still not traced:** whether a writable's `truncate` is refused before `close()` in Gecko and WebKit (Chromium's is,
7.2; the pilot checks the others); what a browser crash leaves of a writable in Gecko and WebKit, and whether OPFS's
listing shows Chromium's swap; which IndexedDB backend a Chromium profile runs (traced by IDB's advocate: LevelDB on disk unless a field trial
moves it, SQLite in memory); Cache Storage in a Chromium private window, and IndexedDB's limit there; both in Safari's;
whether Chromium's IndexedDB `usage` drops at a delete's commit or at its journal cleaning; SHA-1's rate on a phone; whether an engine takes a view of shared memory as a body's stream chunk (7.4's pilot checks
it); whether Chromium holds a large put's blob in memory or pages it to disk; whether Gecko or WebKit refuses a `put`
before writing any of its body; which Chromium profiles keep Cache Storage without a path (in memory, 7.4).

**Fixtures and their limits.** Nothing was run for this file. The *measured* numbers it quotes come from a 4-vCPU
cloud container without a GPU, Chromium 153 and Firefox 159, synthetic 16-bit series at 512², 2560×3328 and
3328×4096, a warm page cache; and one phone, Chrome 157, one series (`dbts_b1-q8-g8`), one evening, software AV1.
WebKit is read from source only, as are every IndexedDB and Cache Storage path. No breast ultrasound cine.

## 8 · Protocol

*Pre-registered 2026-11-15 by CACHE-PROTOCOL, a session that designed, advocated and built nothing here, before any arm
is built. CACHE-RUN runs it as written; an amendment before any counted row if the host forces one, never after.* Every
prediction below is **theory**, from §7's floors and the *measured* numbers they cite (with their fixtures); none is a
result.

### 8.1 · What enters from the advocates' proposals (for all four alike)

| proposal | enters? | why |
| --- | --- | --- |
| a second tab reads what is present and writes nothing (7.1; 7.5's two-tabs row) | **yes** | the same rule for all four; a re-check failure there is a miss, never a damaged frame |
| the second tab also writes, under a shared Web Lock (7.2) | no | OPFS-SYNC's exclusive handle cannot (fs 605), so the rule would differ by arm; named for the verdict |
| a slot is freed once the store holds its own copy (7.2, 7.4) | **yes** | removes a handicap only from the arms that copy; their copies are bounded by their writes in flight and counted in the memory measure (8.3, cell L) |
| a miss on a frame not yet written is answered from what the store worker holds (7.3) | **yes** | a store-worker rule, the same for all |
| the retry after an eviction waits for `estimate()` to show the room, at most 5 s (7.3) | **yes** | only Chromium's IndexedDB is traced to free space late; the others are not traced, so all wait alike |
| a read answered in a new buffer is transferred to the view worker, not copied into a slot (7.4) | no | memory outside the ring is what the ring exists to bound (§3) |

### 8.2 · Rig, arms, order

* **Rig**: `lab/cache-arms/` on `claude/cache-arms` (CACHE-BUILD-HARNESS), reusing `lab/opfs-arms/` and
  `lab/opfs-cache/` from `c99ba492`. Three feeder workers stand in for the decoders and write checked frames into M5's
  ring (256 MiB, slots carved per series, `claude/core-m5:lab/opfs-cache/arms-*.js`), posting slot numbers to the store
  worker; the view worker paints at its `requestAnimationFrame` from memory, the shown frame changing every tick at S1
  and every 6th at S2–S3. One run at a time on the host; a fresh profile per run unless a cell keeps one.
* **Sizes**: S1 512² (0.52 MB), S2 2560 × 3328 (17.0 MB), S3 3328 × 4096 (27.3 MB), 16-bit synthetic, 4 distinct fields
  cycled. **Throttle**: 1× everywhere; 4× (`lab/scripts/cpu_throttle.mjs`) at S1 only, since S2 and S3 at 4× saturated
  on both engines last round (cache-io-thread, *Where the host saturates*); `none` alone runs one period at S2 4× and S3
  4× to say whether that still holds.
* **Arms**: `none`, **OPFS-SYNC**, **OPFS-ASYNC**, **IDB**, **CACHESTORAGE**, and **OPFS-SYNC′** (the A/A arm: OPFS-SYNC
  again, the arm with the most measured history). Cells without `none` (a read needs a store) run five arms.
* **Order**: Williams order per round (`lab/order.mjs`); each row carries its round, arm and predecessor, and
  `balanced()` is reported per cell. A cell's rounds are **one whole period**: 6 rounds for six arms, 10 for five
  (odd: the mirrored rows), 4 for the four-arm state cells; **L at S2 1× runs two periods (12)**, the mammogram cell the
  phone's P2 extends. "≥ 75 % of rounds" is ≥ 5 of 6, 9 of 12, 8 of 10, and every round for state cells.
* **The floor probe** runs beside every integrated run of a timing cell: in the same round, just before the arm's run,
  in that arm's store worker with nothing else running, 20 writes then 20 reads of the cell's frame from a ring slot by
  the raw API only (OPFS-SYNC `write`/`read`; OPFS-ASYNC `createWritable`…`close` and its read; IDB a one-`put`
  transaction and a `get`, plus a `put` of an `ArrayBuffer` beside the `Blob` (7.3); CACHESTORAGE `put` and `match` +
  read). Recorded: median ms a frame each way. **The gap** = the arm's integrated cost a frame (its writer's busy time a
  frame in L and W; its miss's read + re-check in R) − its floor.

### 8.3 · Cells, predictions, bars

Bars are the product's needs, judged per engine × size × throttle; a ranking among passers follows (8.5).

| cell | measured | bar (an arm passes) |
| --- | --- | --- |
| **L** the write during a fill: 125 MB/s for 10 s | missed ticks (share), paint delay p99, the feeders' delivered rate (ring stalls), frames unwritten 5 s after the last arrival, PSS growth of the browser's process tree, every frame read back exact after the run | missed share ≤ `none` + 1 % of ticks and delay p99 ≤ `none` + 4 ms; delivered rate ≥ 0.95 × `none`'s; nothing unwritten at +5 s; PSS growth ≤ `none`'s + its writes in flight × frame + 64 MiB; in ≥ 75 % of rounds; every frame exact in every round |
| **W** throughput, feeders credit-bound, 1 000 MB, 1× | MB/s from first arrival to last write; exact read-back | ≥ 125 MB/s (this host's fill, cache-io-thread) in ≥ 75 % of rounds; then ranked |
| **R-idle** a miss after a fill of 32 | 16 intents a run, each a frame not in memory: intent → read → re-check → painted, p50 / p99; the free-slot wait apart | p50 ≤ the frame's decode on this host + one display period (S1 3.0 + 16.7 ms; S2 47 + 16.7; S3 69 + 16.7: the exactness ADR's §3 and §9 as cache-io-thread (3) and cache-in-opfs M1 quote them) and p99 ≤ twice that, in ≥ 75 % of rounds |
| **R-busy** a miss during L's fill, S2 and S3 1× | as R-idle, the writer active and the ring as the fill leaves it | as R-idle |
| **B** a busy page: L and R-busy at S2 1× with a 50 ms long task every 100 ms on the page's main thread | as L and R | as L and R. Owed on WebKit before any arm is adopted there (§5); one period on Chromium and Firefox |
| **O** reopen, warm and process-cold: 256 × 512² and 32 × 3328 × 4096, clean link | **F** a fresh fill over `link_impair.py` (20 ms one way, 20 Mbit, 500-packet queue: M1's), as the unit `none`; each arm's reopen: store worker start → last frame read and re-checked | R ≤ 0.5 × F in every round (M1's rule), and R / n ≤ the frame's decode (§7's rule, cache-in-opfs). *Cold* is a new browser process on the kept profile, page cache as it is: labelled so, not a flash-cold read (that is P1) |
| **E** eviction, M3's sequence | four series A–D of 20 × S3 (520 MiB each), quota 1 300 MiB, B held open in a second tab from its open, then closed and A again | after A {A}; B {A, B}; C {B, C}; D {B, D}, B skipped as held; A again {A, D}; the refusal at the design's point (OPFS-SYNC `truncate`, OPFS-ASYNC the probe, IDB and CACHESTORAGE `estimate()`, all at open); every frame exact; every round |
| **K** a kill and a torn write, M4's | 64 × S3 on loopback, kept profile; `SIGKILL` of the process group once the store reports ≥ 32 written; half the rounds damage one present frame through the seam's test lever (the same lever for all four, through each arm's own API) before reopening | present on reopen ≥ written at the kill − the arm's writes in flight; the fill asks exactly the rest; the damaged frame fails its re-check, is reported and asked again; 64 / 64 exact; every round |
| **Q** quota near full | S2, 50 frames; the quota set to the series + 64 MiB; after the open, a ballast file in the same origin grows by 1 MiB every 10 ms until refused | no exception escapes the store; the fill and the paint go on (L's shown-frame bar); each written frame exact on reopen; the store's action is 7.5's mid-fill rule; every round |
| **T** two tabs | tab 1 fills S2, 50 frames; at 20 written, tab 2 opens the same series and asks every frame | tab 2 reads only present frames, each exact, its other frames misses fetched; tab 2 writes nothing (the store's write counter); tab 1 passes L's shown-frame bar; every round |
| **P** private window (Chromium incognito context; Firefox `browser.privatebrowsing.autostart`) | open, write and read back 32 × S2 in one tab | records which arms have a store and whether 32 / 32 read back exact; no bar: weighed by the verdict (§3) |

**Predictions** (*theory*; Chromium / Firefox, 1×; WebKit after them):

| cell | OPFS-SYNC | OPFS-ASYNC | IDB | CACHESTORAGE |
| --- | --- | --- | --- | --- |
| L shown frame | on time everywhere: nothing on the view thread | on time | on time | on time |
| L delivered rate | passes: floor ~21 / ~14 ms a frame at S2 (~810 / ~1 200 MB/s) | Chromium **marginal** at S1–S3 (~140 MB/s by its upper-bound floor, 7.2); Firefox passes with groups at S1 (~230 MB/s), S2–S3 (~310 MB/s) | Firefox S2–S3 ≤ ~340 MB/s, passes; **at risk at S1** (238 transactions/s, one in flight, each a commit round, unpriced); Chromium unknown | as IDB at S2–S3; Firefox adds Snappy and CRC32C in the parent: passes, unpriced; **at risk at S1** |
| W | the highest: ≥ 500 MB/s at S2 on both | ≥ 125 at S2–S3; Chromium S1 marginal | unknown; ≤ OPFS-ASYNC | unknown; ≤ IDB on Firefox (Snappy) |
| R-idle p50, Chromium S2 / S3 | ~29 / ~40 ms (A's *measured* 28.8 / 40.1): passes | ~52 / ~83 ms by `getFile()` (B's 52.0 / 83.4), ~30 / ~42 if the pilot picks the sync read: passes S2, **marginal at S3** (bar 85.7) by `getFile()` | ≥ OPFS-ASYNC's: **at risk at S3** | as IDB, streamed reads lower; **at risk at S3** |
| R-busy | within ~5 ms of R-idle with 2 MiB pieces; up to +21 / +33 ms whole-frame | up to one write in flight | up to one frame's write (7.3) | up to one put |
| B on WebKit | one main-thread wait a series: passes | **fails**: every call waits on the page's main thread (7.2) | **fails**, the same (7.3) | **passes**: no main-thread hop after the first call (7.4) |
| B on Chromium / Firefox | as L and R | as L and R | as L and R | as L and R |
| O warm | R ~0.2 / ~0.7 s against F ~7.5 / ~31 s (M1's *measured*): passes | passes (32 × ~83 ms ≈ 2.7 s at S3) | passes if a read ≤ ~0.4 s | passes as IDB |
| O cold | within 1.2 × warm: a cloud host keeps its page cache | the same | the same | the same |
| E | holds (M3 *measured* on both, after the Gecko fix) | holds if the probe refuses before close (Chromium traced; Gecko the pilot's check) | holds; Chromium's late removal absorbed by the bounded wait | holds |
| K | holds (M4 *measured*) | holds at S3 (G = 1) | holds: a killed process keeps committed `relaxed` writes in the OS's cache | holds; WebKit's unreverted batch caught by the re-check |
| Q | **no mid-fill refusal**: `truncate` at open reserved the series; the ballast is refused instead | a group refused mid-fill: the rule | a transaction aborted mid-fill: the rule | a `put` refused mid-fill: the rule |
| T | tab 2 reads by `getFile()`, slower than the handle | reads, as its own reads | a read-only transaction | `match` |
| P | Firefox: no store; Chromium: in RAM | the same | **a store on both** | **a store on both** (Chromium in memory if its path is empty, not traced) |

### 8.4 · A/A, VOID, saturation, mutants, pilot

* **VOID** (OPFS-SYNC′ against OPFS-SYNC, over a cell's rounds): L when the median |Δ missed share| exceeds 1 % of ticks
  or |Δ delay p99| 4 ms; W, R and O when the median ratio lies outside 0.90–1.10. A VOID cell claims nothing for any
  arm. State cells (E, K, Q, T, P) have no A/A; they are VOID for an arm whose mutant (below) was not caught.
* **Saturation**: an engine × size × throttle where `none` misses more than 5 % of ticks in L's median round claims
  nothing, in every cell at that point. The feeders stand in for three decoders without their CPU, so the host is less
  loaded than a real fill: a pass here is an upper bound on a phone, said in the result.
* **Mutants**, each once per engine and arm before its cell's rows are believed (`--mutant` in the rig):
  *drop-writes* (the store says written, writes nothing): W's read-back and O's present count must fail;
  *no-recheck* (a read skips its XXH3): K's damaged frame must be painted unreported, caught by the harness's own
  SHA-256; *slot-held* (a slot never freed): L's delivered rate must fall under its bar; *view-copy* (the view worker
  copies each frame before the post, C's old copy): L's delay p99 bar must fail at S2 1× on Chromium; *evict-newest*:
  E must fail; *tab-writes* (tab 2 writes): T's counter must fail. A mutant not caught makes its cell VOID for that
  arm until the harness is fixed and the cell rerun whole.
* **Pilot**, not counted, per engine, before its counted rows: only the settings each design names (7.1 the write
  piece; 7.2 G, writes in flight, the read, in that order; 7.3 the value on Gecko only; 7.4 puts in flight, then
  buffered or streamed, streamed only where a frame put from shared views reads back equal), by each design's own rule,
  a tie within 10 % keeping the first value. Each alternative runs 3 rounds alternated (a b b a a b). The picks are
  committed as `lab/cache-arms/pilot-<engine>.json` before the first counted row on that engine, then frozen.

### 8.5 · The rule, stated before any data

Per engine, over the non-VOID, unsaturated cells:

1. **An arm passes** when it meets every bar of 8.3 in every counted cell it ran. A cell an engine cannot run (an API
   absent, a lever missing) is named and judges nothing.
2. **Among passers**, rank by R-busy miss p99 at S2, then O's warm R at S3, then W at S2; a lead counts only at ≥ 10 %.
   All three within 10 %: the arm with fewer copies in script a frame (7.x tables) leads.
3. **No passer**: the result goes to the owner as measured, with every arm's gap over its floor (8.2) beside its failed
   cells, for CACHE-VERDICT-REVIEW's loser's question (§5).
4. **P** is reported beside the verdict: an arm that keeps a private window's frames where the leader cannot is named
   with the cells it passed; the verdict does not rank on it.

### 8.6 · Engines and the host

* **Chromium**: Playwright's bundled build (`/opt/pw-browsers/chromium-1243` on the host this was written on), its
  version printed in every row's first line. **Firefox 159** from Mozilla's release archive (reachable from the host,
  HTTP 200 at `ftp.mozilla.org/pub/firefox/releases/159.0/linux-x86_64/`, checked 2026-11-15), over WebDriver BiDi on
  Xvfb, as the last round ran it. Neither engine's quota lever is assumed: the run's first step on each engine checks
  that `navigator.storage.estimate()` reports the overridden quota (Chromium `Storage.overrideQuotaForOrigin`; Gecko
  `dom.quotaManager.temporaryStorage.fixedLimit`), and E and Q do not run where it does not.
* **WebKitGTK can run on this kind of host**: Ubuntu 24.04's archive offers `libwebkit2gtk-4.1-0` and
  `webkit2gtk-driver` (WebKitWebDriver) 2.52.6 (`apt-cache policy`, checked 2026-11-15); **not installed or run here**.
  CACHE-RUN installs them, then runs an API probe first (cross-origin isolation and `SharedArrayBuffer`;
  `createSyncAccessHandle`, `createWritable`, IndexedDB and `caches` in a dedicated worker); a cell whose API is absent
  is "not run: <API>". No quota lever for WebKitGTK is traced: E and Q are not run there unless one is found and checked
  as above. B is WebKit's first cell.
* **Order of work**, so a cut-short run leaves the most decided: Chromium (pilot, L, W, R, O, B, then E, K, Q, T, P),
  Firefox the same, then WebKitGTK (probe, B, L, R, O, W, K, T, P). Rows are pushed per cell as they land.
* **Host time**, from the last round's run lengths: ~10–12 host-hours an engine (L ~2.5, R ~2, B ~1.5, O ~1.4, state
  cells ~2.2, W ~0.9, pilot and mutants ~1.5), one run at a time. If CACHE-RUN is not done by 11-21 20:00,
  CACHE-VERDICT-REVIEW judges what is pushed (its brief).

### 8.7 · The phone cells

Checked 2026-11-15: P1–P3 (§6) are in `claude/phone-protocol:docs/phone-rows/next-round.md` §4, cell 5, quoted there
verbatim: P2 then P1, run only if CACHE-BUILD-OPFS-SYNC and its review are in the round's commit; P1 after a reboot (a
second sitting, named there as a departure from amendment 5); P3 only for arms that pass the cloud cells here. Nothing
is added to that file by this row.

**Fixtures and their limits.** Nothing has run for this section. It plans: a 4-vCPU cloud container without a GPU
(SwiftShader paint), Chromium and Firefox 159, WebKitGTK if its probe passes; synthetic 16-bit frames at three sizes;
feeders, not decoders; a userspace relay, not a radio; a warm page cache (cold here is a new process, not the disk).
No phone, no Safari, no breast ultrasound cine.

### 8.8 · CACHE-RUN's amendment, 2026-11-18, before any counted row

Forced by the host or by the build as `claude/cache-arms` `03777b30` left it (its README, *run once* and *smoke* notes
of 2026-11-15); written before the pilot's picks are read and before any counted row. Nothing here moves a bar.

1. **Chromium is 153.0.8010.12** (Playwright's bundled build on this host), printed in every row's settings line.
2. **The quota lever's check is a refusal, not `estimate()`.** On Chromium 153 `estimate()` still reports 10 GiB under
   `Storage.overrideQuotaForOrigin` (README, *run once*): §8.6's check is `quota-probe.js` (half the quota taken, 16 MiB
   over it refused), and §8.1's bounded wait for `estimate()` ends at once there.
3. **E on Chromium, IDB and CACHESTORAGE**: their check at open reads `estimate()`, which does not see the override, so
   their refusal comes mid-fill. E's "the refusal at the design's point" is read for those two arms on Chromium as
   *mid-fill, the lever's limit*, named in the result; the five sets and every frame exact still bind.
4. **Q and OPFS-SYNC**: one sync handle cannot use the override's whole room (under 877 MiB a `truncate` to 800 MiB was
   refused, README *run once*), so Q's quota of the series + 64 MiB may refuse OPFS-SYNC's `truncate` at open. Such a
   round is reported as *refused at open, nothing written*: it meets no mid-fill rule and counts as no pass of Q for
   that arm; the cell is not changed to fit.
5. **O's F is not built** (README: synthetic frames have no coded form to fetch). F is M1's *measured* fill, ~7.5 s for
   256 × 512² and ~31 s for 32 × 3328 × 4096 (§8.3's predictions quote it), labelled so in the result; R ≤ 0.5 × F
   judges against it, and R / n ≤ the frame's decode as written.
6. **The pilot's measures**, each design's rule (§7.1–7.4) read on the rig's rows: a write's cost a frame is the store
   worker's busy time p50 (`store.busyMsP50`) on a credit-bound run, W for OPFS-ASYNC's G (S1) and writes in flight
   (S2), and IDB's value (Gecko only); a miss is the intent-to-painted time of R's misses (`misses[].ms`), p99 in
   R-busy at S2 for OPFS-SYNC's piece (its write cost within 10 % as §7.1 says), p50 in R-idle at S2 for OPFS-ASYNC's
   read; CACHESTORAGE's write plus read is `busyMsP50 + readMsP50` in R-idle at S2, streamed only where its three
   rounds read back exact. The driver and the rule are `lab/cache-arms/rows/pilot.sh` and `pilot_pick.py`.
7. **Each arm carries its own picks** (`lab/cache-arms/pilot-<engine>.json`): the rig applied one `--pilot` string to
   every arm, and OPFS-ASYNC and CACHESTORAGE both read `inflight`. A harness change after the build's review
   (`claude/cache-arms` `5b86cbb9`, test first, two mutants killed), named for CACHE-VERDICT-REVIEW; L's PSS slack and
   K's writes in flight follow each arm's own picks.
8. **One job at a time, each under two hours**: the container stops a background job at its two-hour limit, so a cell
   (one engine × size × throttle) is one job, its rows kept whole or renamed `.partial` and counted in no bar.
