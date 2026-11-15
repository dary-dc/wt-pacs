# Where the client keeps frames: the cache's options

**The question:** where should the client keep frames across a session and across visits, on a phone over lossy
wireless? **Theory only**, written 2026-11-14 from the specs and the engines' sources listed in §Sources; nothing here
is built or timed for this question. Every number marked *measured* is quoted from the file it links, with that file's
fixtures; everything else is *theory* or arithmetic on those numbers.

The cache chosen 2026-10-10 is OPFS with decoded samples and no re-decoding. Its facts are already sourced in
[`../../adr/frame-path.md`](../../adr/frame-path.md) §4 *OPFS, from the specs and the engines' sources* (sync access
handles in dedicated workers, the exclusive lock, `AllowSharedBufferSource`, each engine's write path, quota and
eviction, WebKit's deletion of script-written storage), §6 *Memory on phones*, §Proposed: the client cache in OPFS
(built, then measured on a 4-vCPU container) and §The cache I/O in the view worker (the sync handle against
`createWritable`, measured on Chromium and Firefox). They are cited here, not repeated. This file adds the
alternatives, which no record had compared.

## 1 · The options

* **OPFS, a sync access handle in a dedicated worker** — the design as built: one packed file per series, written
  and read from the frame's `SharedArrayBuffer`.
* **OPFS, the async `createWritable`** — the same store from any context, by stream.
* **IndexedDB** — records in object stores, transactions.
* **Cache Storage** — `Request` → `Response` pairs, the service-worker cache.
* **Storage Buckets** — not a store but a partition: named buckets, each with its own IndexedDB, Cache Storage and
  OPFS, quota, expiry and persistence.
* **Memory only** — the baseline: frames in RAM for the session, nothing across visits.
* **The File System Access API's user-picked directory** — named only to say where it applies (§2.6).

## 2 · Each option, from its sources

### 2.1 Storing decoded samples held in a `SharedArrayBuffer`

The decoders write each frame into a `SharedArrayBuffer`. Whether a store takes that memory as it is decides whether
a frame costs a copy in script before the store's own copies.

* **OPFS sync handle: no copy in script** — `read()` and `write()` take `AllowSharedBufferSource` (frame-path §4).
* **OPFS `createWritable`: a copy in script, then the engine's** — the chunk is `BufferSource` and every engine
  refuses a shared view (frame-path §The cache I/O, *What the sources say* (a)).
* **IndexedDB: refused for storage; a copy in script, then serialization's copy.** HTML's serializer throws when a
  shared buffer is serialized for storage, which `put()` does, and an `ArrayBuffer` is copied into the record
  ("Let |dataCopy| be ? CreateByteDataBlock(|size|)", html `source` 10717). Chromium, Gecko and WebKit each implement
  the refusal. In Chromium the bytes then go through Snappy where that feature is on and, above 64 KiB, into a blob
  file; in Gecko, above 1 MiB, into a file beside the SQLite database; in WebKit the record is a SQLite column
  (whether a large value leaves the row was not traced).
* **Cache Storage: a copy in script, then the body's copy.** A `Response` body is `BodyInit`, whose buffer member is
  `BufferSource`; Web IDL refuses a shared view there with a `TypeError`, and Fetch copies the bytes it is given.
* **Storage Buckets:** whatever the store inside the bucket does.
* **Memory only: no copy** — the frame stays where the decoder wrote it.

### 2.2 Writing off the view's thread

* **OPFS sync handle:** dedicated workers only, `[Exposed=DedicatedWorker]` (fs `index.bs` 430–431, frame-path §4);
  shipped in Chrome for Android 109, Firefox 111, Safari 15.2 (browser-compat-data, §Sources).
* **OPFS async, IndexedDB, Cache Storage:** `[Exposed=(Window,Worker)]`, so any worker. Their results come back as
  tasks on the caller's event loop, so a write competes with the paint's tasks in the worker that issues it.
  Frame-path §The cache I/O *What this rules out* found that WebKit posts every async OPFS call a worker makes to
  the page's main thread; whether WebKit's IndexedDB or Cache Storage in a worker do the same was **not traced**.
* **Storage Buckets:** `[Exposed=(Window,Worker)]`; `persist()` on a bucket is `[Exposed=Window]`.

### 2.3 Read to paint

The paint uploads from any `ArrayBufferView`, shared or not (frame-path §4, WebGL2's `[AllowShared]`), so a store that
hands back an `ArrayBuffer` costs no copy to paint; it costs one only where a frame must go back into shared memory
(to be posted to another agent without a transfer).

* **OPFS sync handle:** one synchronous `read()` into a buffer the worker chose, shared or not, then the XXH3 re-check
  (*measured*, frame-path §Proposed: the client cache in OPFS, its reopen against a fetch: 22.3 ms a 3328×4096 frame,
  read + re-check, warm page cache, Chromium on the container; a cold read and a phone are not measured).
* **OPFS async:** `getFile()`, then `slice().arrayBuffer()`: a new buffer, an IPC and, in Gecko, a pump on the main
  thread (frame-path §The cache I/O (c)). *Measured* there, Chromium on the container: a miss 83.4 ms at 3328×4096
  against 40.1 ms for the sync handle.
* **IndexedDB:** `get()` in a read-only transaction; the value is deserialized into a new `ArrayBuffer`, after the
  engine reads its blob or file. One request, one task, one copy at least; **not measured** here.
* **Cache Storage:** `match()`, then `response.arrayBuffer()`: two promises, a new buffer; **not measured**.
* **Memory only:** none; the frame is in hand.

### 2.4 Quota, eviction granularity and `persist()`

* **One quota for all three stores.** IndexedDB and Cache Storage are storage endpoints of the same bucket
  (storage `storage.bs` 170–190), and OPFS is that bucket's file system (fs, *bucket file system*). Frame-path §4's
  limits (Chromium 60 % of disk per origin, WebKit 60 % in a browser and 15 % in a web view, Gecko 10 % below its
  10 GB cap) and its eviction rule (whole buckets, least recently used first, never single entries) apply to each
  alike. **No store gives more room than OPFS.** Chromium's quota code has no Android branch: the same ratios apply
  on a phone (`storage/browser/quota/quota_settings.cc`, read whole). Firefox for Android's quota was not traced
  (frame-path §Sources, 2026-10-22).
* **A Firefox private window has no OPFS** (`dom.fs.privateBrowsing.enabled` is `false`, §Sources): there the
  client runs memory only; whether IndexedDB keeps a private window's data on disk was not traced.
* **`persist()`** is the page's call (`[Exposed=Window]`) and covers the bucket, whichever store holds the frames.
* **Storage Buckets** is the one option that changes the unit: a bucket per series could be evicted by the browser
  alone, and carry its own `quota` and `expires`. It ships in Chromium 122 only; Firefox and Safari have none
  (browser-compat-data). Its draft leaves eviction undefined for each store inside a bucket ("Issue: [[IndexedDB-3]]
  needs to define how deletion occurs when data is evicted by quota", and the same for OPFS and Cache Storage). The
  store as built already evicts by series itself, least recently opened first, when a `truncate` is refused
  (frame-path §Proposed: the client cache in OPFS, *measured* on Chromium and Firefox): buckets would add nothing an
  engine without them can use.

### 2.5 Durability and torn writes

* **IndexedDB:** a transaction is atomic ("either all of the changes must be written, or … the implementation must
  not write any of the changes"), with a durability hint whose note recommends `"relaxed"` for caches and warns that
  flushing "can take significant time and consume battery life on portable devices".
* **Cache Storage:** a `put()` is one batch, rolled back on an exception.
* **OPFS:** no atomicity; a torn or flipped frame is caught by the XXH3 re-check on read and asked again
  (frame-path §5; *measured*, the tab killed mid-write: caught 4 of 4, every frame exact).
* So IndexedDB's and Cache Storage's atomicity buys nothing the product does not already have: the re-check stays
  for every store, because a disk can return wrong bytes under any of them (frame-path §5).

### 2.6 Several tabs, and locks

* **OPFS sync handle:** one writer per file, an exclusive lock (frame-path §4); the build lets a second tab on the
  same series run without the cache (frame-path §Proposed, *Built*).
* **IndexedDB:** read/write transactions on the same object store run one at a time, in creation order (IndexedDB
  §Transaction scheduling, `index.bs` 1148), so two tabs can share one series' records with no lock of ours.
* **Cache Storage:** no lock; the last `put()` of a key wins.
* **Web Locks** (`navigator.locks`, `[Exposed=(Window,Worker)]`, Chrome 69, Firefox 96, Safari 15.4) can coordinate
  any of them across tabs; the build does not need it.

### 2.7 The user-picked directory

`showDirectoryPicker()` is on `Window` only, needs transient activation, and ships in Chromium (desktop 86, Android
132) and in neither Firefox nor Safari (browser-compat-data). It is a folder the user owns, outside the origin's
quota and eviction. **It applies** where a reader wants a cache they manage themselves on a desktop Chromium
workstation; it is not a phone default (a prompt, no Safari) and is not weighed further.

## 3 · Decoded samples against coded bytes, on a phone

The phone run reopens this trade-off. Its numbers (*measured*, `claude/fill-split:docs/phone-rows/README.md`
§What bounds a fill, one phone, Chrome 157, one series, one evening): `dbts_b1-q8-g8`, 50 frames, 23 208 296 coded
bytes; a frame's decode 133–135 ms, software AV1 (the client asks WebCodecs for `prefer-software`,
`client/decode/av1-webcodecs.js`), three decoders at once, about 21 frames a second; the fill decode-bound, the decode
floor 0.89–0.91 of the fill.

Per frame of that series (2560 × 3328, 16 bits; arithmetic):

| | on flash | a reopen | the write the fill must keep up with |
| --- | --- | --- | --- |
| **decoded samples** | 17.0 MB (852 MB the series) | read 17.0 MB + XXH3, no decode | 21 frames/s × 17.0 MB ≈ **358 MB/s** at the phone's decode rate |
| **coded bytes** (the optimal-quality view) | ~0.46 MB (23.2 MB the series; the view is 0.07–0.22 of the exact series' bytes, [`../../lines/codecs.md`](../../lines/codecs.md)) | a decode: ~135 ms a frame, ~45 ms a frame across three decoders, ~2.4 s the series | ~10 MB/s |

**What theory predicts** (nothing here is measured on a phone):

* **A reopen.** Decoded beats coded only where one worker reads and checks a 17 MB frame in under ~45 ms: ≳ 0.4 GB/s
  read + XXH3 together. On the container the same path took 22.3 ms for 27.3 MB, warm (frame-path, *measured*); a
  phone's cold flash read and its XXH3 rate are unmeasured, so the sign of the difference on a phone is **not known**.
* **The fill.** Writing decoded samples at the decode rate asks ~358 MB/s of the phone's flash for the whole fill.
  If the flash writes slower, the fill is not slowed (the write is behind the paint, frame-path §6) but frames wait in
  memory until written, since a frame leaves the memory window only once on disk (frame-path §Proposed, *Write*): the
  window's 256 MiB holds 15 frames of this size (frame-path §Proposed, the window's budget). The phone's sustained
  write rate is not sourced here.
* **Flash and quota.** Each series first opened writes 852 MB decoded against 23 MB coded, 37 times more. At 60 % of
  disk (Chromium, WebKit in a browser) a 128 GB phone holds ~90 such series decoded, ~3 300 coded. Flash wear per
  byte written is not sourced here.
* **Coded bytes break the owner's rule** (no re-decoding, 2026-10-10) on every reopen; the phone run alone does not
  lift it. If a phone reads slower than ~0.4 GB/s, the rule and the reopen time pull apart, and that is the owner's.

## 4 · The options, side by side

| | SAB, copies in script | off the view's thread | read to paint | quota, eviction | durability | several tabs | engines |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **OPFS, sync handle** (built) | none | sync, a dedicated worker | one sync read + re-check (*measured*, container) | the origin's; evicted whole; by series by us | none; re-check catches | one writer a file | all three; Chrome Android 109 |
| OPFS, `createWritable` | one, then the engine's | async, any worker; WebKit via the page's thread | a new buffer, ~2× the sync read (*measured*, container) | the same | swap at close | one writable a file | Safari 26 |
| IndexedDB | one, then serialization's (+ Snappy, blob file) | async, any worker | a new buffer, async (*not measured*) | the same | atomic transactions | ordered by the engine | all three |
| Cache Storage | one, then the body's | async, any worker | two promises, a new buffer (*not measured*) | the same | a batch, rolled back | last write wins | all three |
| Storage Buckets | the store's | the store's | the store's | per bucket: quota, expiry, persist | the store's | the store's | Chromium only |
| Memory only | none | — | none | the tab's memory; nothing across visits | lost with the tab | per tab | all |
| User-picked directory | the API's | the API's | the API's | the user's folder | the API's | the API's | Chromium only, a prompt |

## 5 · What would decide it

1. **The phone's cold read + XXH3 of a 17 MB frame from OPFS**, on Chrome for Android, against ~45 ms (the measured
   decode across three decoders). Under it, decoded samples win on reopen as well as by rule; over it, the reopen
   trade-off goes to the owner.
2. **The phone's sustained write rate** while three decoders run, against ~358 MB/s, with memory read through the
   fill: whether the memory window holds under the write's backlog.
3. **IndexedDB's write and read of a 17 MB frame**, in a worker, on the same phone — only if (1) or (2) fail for OPFS,
   since IndexedDB shares OPFS's quota and eviction and adds copies (§2.1).

## 6 · Recommendation (a leaning, not a decision)

**OPFS stays, as built: a sync access handle in a dedicated worker, decoded samples, one packed file per series.**
It is the only option that writes a frame from shared memory with no copy in script, synchronously in a worker; every
other store shares its quota and eviction and adds a copy at least; their atomicity is redundant beside the re-check.
Storage Buckets is Chromium-only and the store already evicts by series; the user-picked directory applies to a
desktop Chromium workstation only. By the owner's decision of 2026-11-14 (survey first; if OPFS comes out best, its
design continues), the design continues. The leaning on decoded against coded holds until §5 (1) is measured on a
phone.

**Fixtures and their limits.** No timing was taken for this file. The *measured* numbers it quotes come from: one
phone, Chrome 157, one series (`dbts_b1-q8-g8`), one evening, software AV1 decode; and a 4-vCPU cloud container
without a GPU, Chromium and Firefox, warm page cache, synthetic 16-bit series. WebKit is read from source only, as
are all the IndexedDB and Cache Storage paths. No breast ultrasound cine exists among the fixtures.

## Sources

Fetched 2026-11-14 at the commits below; nothing fetched is committed. Quotes are verbatim, markup stripped.

| source | commit | sha256 (first 12) |
| --- | --- | --- |
| w3c/IndexedDB `index.bs` | `f9f83f196f85` | `98ca68a462e3` |
| w3c/ServiceWorker `index.bs` | `57dfd24943fe` | `36d1f2c746fa` |
| whatwg/fetch `fetch.bs` | `2696300d95bb` | `478609e29799` |
| whatwg/html `source` | `0793d3d8544e` | `7fde2f1fad51` |
| whatwg/webidl `index.bs` | `54a5f2de6a34` | `509e0a51d566` |
| whatwg/fs `index.bs` | `d76d3455d5af` | `e99666c5d561` |
| whatwg/storage `storage.bs` | `115691c51583` | `2617969b9b9f` |
| WICG/storage-buckets `index.bs` (a CG draft) | `d87656ba1b29` | `9556669d8f2b` |
| WICG/file-system-access `index.bs` | `93119927fa7a` | `f242d11c7fe7` |
| w3c/web-locks `index.bs` | `6dfe272f7b89` | `9aa2b5e625a7` |
| mdn/browser-compat-data | `69fcf3608174` | — |
| chromium/chromium, mozilla-firefox/firefox, WebKit/WebKit | `b124f80df73f`, `c72617c01649`, `782d2a977efb` | — |

| claim | source | quoted |
| --- | --- | --- |
| a shared buffer is not stored | html `source` 10682–10684, 11025–11026 | "If the current settings object's cross-origin isolated capability is false, then throw a "DataCloneError" DOMException." · "If forStorage is true and serialized.[[AgentCluster]] is not null, then throw a "DataCloneError" DOMException." |
| IndexedDB serializes for storage | IndexedDB `index.bs` 5620 | "Let \|serialized\| be ? StructuredSerializeForStorage(\|value\|)." |
| Chromium refuses it | `third_party/blink/renderer/bindings/core/v8/serialization/v8_script_value_serializer.cc` 1008–1011 | "A SharedArrayBuffer can not be serialized for storage." |
| WebKit refuses it | `Source/WebCore/bindings/js/SerializedScriptValue.cpp` 1139–1141 | "return m_forStorage == SerializationForStorage::No && (isCrossOriginIsolatedContext(…" |
| Chromium: Snappy, then a blob above 64 KiB | `third_party/blink/renderer/modules/indexeddb/idb_value_wrapping.h` 61–62, 71–72; `third_party/blink/public/mojom/indexeddb/indexeddb.mojom` 30; `idb_value_wrapping.cc` 157–159 | "Values that are still "large" after compression are converted into a Blob" · "const int32 kIDBWrapThreshold = 65536;" · "if (backend_uses_sqlite_) { return false;" (no compression on its SQLite backend) |
| Gecko: a file above 1 MiB | `dom/indexedDB/ActorsParent.cpp` 19156–19158; `dom/indexedDB/IndexedDatabaseManager.cpp` 117 | "snappy::MaxCompressedLength(…) > IndexedDatabaseManager::DataThreshold();" · "const int32_t kDefaultDataThresholdBytes = 1024 * 1024;  // 1MB" |
| WebKit: the value is a SQLite column | `Source/WebCore/Modules/indexeddb/server/SQLiteIDBBackingStore.cpp` 79 | "key TEXT COLLATE IDBKEY NOT NULL ON CONFLICT FAIL, value NOT NULL ON CONFLICT FAIL" |
| atomic transactions | IndexedDB `index.bs` 1072–1076 | "The implementation must atomically write any changes … either all of the changes must be written, or if an error occurs, such as a disk write error, the implementation must not write any of the changes" |
| the durability hint | IndexedDB `index.bs` 940–942 | "flushing buffers can take significant time and consume battery life on portable devices." · "Web applications are encouraged to use "relaxed" for ephemeral data such as caches" |
| writers on one store run in turn | IndexedDB `index.bs` 1148 | "the transaction that was created first is the transaction which gets access to the object store first, and it is the only transaction which has access to the object store until the transaction is finished." |
| a body's buffer is `BufferSource`, copied | fetch `fetch.bs` 8188, 8190, 8256–8257 | "typedef (Blob or BufferSource or FormData or URLSearchParams or USVString) XMLHttpRequestBodyInit;" · "Set source to a copy of the bytes held by object." |
| `BufferSource` refuses a shared view | webidl `index.bs` 9237–9240, 15105 | "If the conversion is not to an IDL type associated with the [AllowShared] extended attribute, and IsSharedArrayBuffer(V.[[ViewedArrayBuffer]]) is true, then throw a TypeError." |
| Cache Storage in workers; a put is rolled back | ServiceWorker `index.bs` 1992–1993, 2008–2009, 4149 | "[SecureContext, Exposed=(Window,Worker)] interface Cache {" · "the implementation does undo (roll back) any changes made to the cache storage during the batch operation job." |
| one bucket holds IndexedDB and Cache Storage | storage `storage.bs` 170–186 | "The registered storage endpoints are a set of storage endpoints" … ""caches"" … ""indexedDB"" |
| buckets: exposure, contents, eviction undefined | storage-buckets `index.bs` 58–60, 262–279, 223 | "[Exposed=(Window,Worker), SecureContext] interface StorageBucketManager {" · "[Exposed=Window] Promise<boolean> persist();" · "Promise<FileSystemDirectoryHandle> getDirectory();" · "Issue: [[IndexedDB-3]] needs to define how deletion occurs when data is evicted by quota." |
| buckets ship in Chromium only | browser-compat-data `api/StorageBucketManager.json` 10–25 | "chrome": { "version_added": "122" } · "firefox": { "version_added": false … } · "safari": { "version_added": false } |
| the sync handle on Android and iOS | browser-compat-data `api/FileSystemSyncAccessHandle.json` 11–27 | "chrome_android": { "version_added": "109" } · "firefox": { "version_added": "111" } · "safari": { "version_added": "15.2" } |
| the picker: Window, activation, Chromium | file-system-access `index.bs` 146–149, 330–334; browser-compat-data `api/Window.json` 7217–7218 | "If \|global\| is not a Window, then throw a "SecurityError" DOMException." · "If \|global\| does not have transient activation, then throw" · "chrome_android": { "version_added": "132" } |
| Web Locks in workers | web-locks `index.bs` 357; browser-compat-data `api/LockManager.json` | "[SecureContext, Exposed=(Window,Worker)]" · Chrome 69, Firefox 96, Safari 15.4 |
| OPFS off in Firefox private windows | `modules/libpref/init/StaticPrefList.yaml` 5600–5602 | "name: dom.fs.privateBrowsing.enabled … value: false" |

**Not traced:** what Chromium's and Gecko's IndexedDB `"default"` durability does at the OS; whether WebKit's
IndexedDB or Cache Storage in a worker pass through the page's main thread; WebKit's handling of a large IndexedDB
value; each engine's Cache Storage disk path; Firefox for Android's quota; a phone's flash read, write and wear rates.
