# The cache I/O: sync, async, or another thread

**Question:** On which thread, and with which OPFS API, does the cache write and read?

*Moved 2026-11-14 from `docs/adr/frame-path.md` at `e5b20cba` (§The cache I/O in the view worker: sync, async, or a
store worker), word for word but for queue-row names. A bare §N or §Name is a section of that ADR: [its
map](../../adr/frame-path.md) names the file each now lives in. Choices 1–8 are [the
cache's](cache-in-opfs.md#the-choices-and-what-decides-each). The design these findings shape is
[`../design.md`](../design.md).*

## The cache I/O in the view worker: sync, async, or a store worker (2026-10-28)

**Status:** theory and a pre-registered protocol; the harness is built (`lab/opfs-arms/` (at `0920153d`)) and smoke-run once per arm,
**no cell is run**: nothing below is measured unless it says *run once*, and the smoke's numbers are not results.
*Corrected 2026-10-30:* the protocol as amended is run on Chromium and Firefox; **no arm passes on either engine**, so
the result goes to the owner as measured (§Arm D, Results). The predictions above stand as written, judged there.

**The shape** (the owner, 2026-10-28): the page holds no frame and sends intents only. One **view worker**, started by
the page, owns the frame store, the cache I/O, the asking (its own port to the downloader) and the paint (WebGL2 on the
transferred canvas); the decoders post each checked frame to it, as B′ in §1–§3. §7's rule still decides adoption
against today's path. Paint first: it is the latency-critical path; the cache write comes after it.

**The question:** which arm keeps the shown frame on time while a fill writes, sustains the fill's write rate, and
reads a memory miss fastest, per engine. **A** a sync access handle in the view worker; **B** the async API in the view
worker (`createWritable` to write; `getFile()`, then `slice().arrayBuffer()` to read); **C** a store worker with a sync
handle, `client/viewer/store.js` as built. A and B each in two orders: **write on arrival**, and **paint first**, the
write drained after the paint. Frames: **S1** 512² (0.52 MB), **S2** 2560×3328 (17.0 MB), **S3** 3328×4096 (27.3 MB),
16-bit. §4 already holds the sync handle's facts (dedicated workers only, the exclusive lock,
`AllowSharedBufferSource`, the write path per engine); they are not repeated.

### What the sources say

Sources at §9's pinned commits, fetched 2026-10-28 and listed in [`frame-path-sources.txt`](sources.txt);
MDN's browser-compat-data at `09b6855`. Quotes are verbatim, cut with "…"; HTML's markup is stripped.

| | claim | source | quoted |
| --- | --- | --- | --- |
| (a) | an async write goes to a temporary file, swapped in at close; `keepExistingData` copies the file first | fs `index.bs` 532–538 | "This is typically implemented by writing data to a temporary file, and only replacing the [=file entry=] … when the writable filestream is closed." … "otherwise the existing file is first copied to this temporary file." |
| (a) | the chunk is `BufferSource`, not `AllowSharedBufferSource`, and is copied | fs `index.bs` 1110, 1239 | "`typedef (BufferSource or Blob or USVString or WriteParams) FileSystemWriteChunkType;`" · "let \|dataBytes\| be … a copy of … \|data\|" |
| (a) | close runs the engine's scans, then commits | fs `index.bs` 1171, 1179 | "Run [=implementation-defined=] malware scans and safe browsing checks." · "It is expected that this atomically updates the contents of the file on disk" |
| (a) Chromium | the swap is `<name>.crswap`; with `keepExistingData` the target is copied into it | `content/browser/file_system_access/file_system_access_file_handle_impl.cc` 714, 803–813, 861–867 | "`AddExtensionASCII(".crswap")`" · "Create an empty file." · "`FileSystemOperationRunner::Copy`, … `/*keep_existing_data=*/true`" |
| (a) Chromium | each `write()` is copied into a string, sent over a new data pipe, and written by the browser in 32 KiB pieces | `…/file_system_access/file_system_underlying_sink.cc` 386–389, 408–410; `mojo/public/cpp/system/string_data_source.cc` 16–17; `storage/browser/file_system/file_writer_delegate.cc` 28 | "`std::make_unique<mojo::StringDataSource>(`" · "`data_ = std::string(data.data(), data.size());`" · "`kReadBufSize = 32768;`" |
| (a) Chromium | close moves the swap over the target; OPFS skips the after-write check and quarantine; quota at each write's start and at the move; no flush by default | `…/file_system_access_safe_move_helper.cc` 222–224, 236–237, 314–316; `storage/browser/file_system/sandbox_file_stream_writer.cc` 173–175; `…/file_system_operation_impl.cc` 371–373; `storage/common/file_system/file_system_mount_option.h` 32 | "`if (dest_url().type() == storage::kFileSystemTypeTemporary)` / `return false;`" · "`&storage::FileSystemOperationRunner::Move`" · "`GetBucketSpaceRemaining(`" · "`flush_policy_(FlushPolicy::NO_FLUSH_ON_COMPLETION)`" |
| (a) Gecko | `keepExistingData` copies the main file into a new file id; the content process writes to a descriptor through 1 MiB copies, a sync quota IPC on each stream write; close swaps the file id in SQLite | `dom/fs/parent/datamodel/FileSystemDatabaseManagerVersion002.cpp` 470–474, 772–775; `…/FileSystemFileManager.cpp` 312; `dom/fs/include/fs/FileSystemConstants.h` 16; `dom/quota/RemoteQuotaObject.cpp` 55–56 | "`if (aMode == FileMode::SHARED_FROM_COPY) {`" · "`original->CopyTo(destParent, leafName)`" · "`kStreamCopyBlockSize = 1024 * 1024;`" · "`mActor->SendMaybeUpdateSize(aSize, aTruncate, &result)`" · "`DO UPDATE SET fileId = excluded.fileId`" |
| (a) Gecko | the chunk is copied once into a vector on the calling thread | `dom/fs/api/FileSystemWritableFileStream.cpp` 805 | "`CreateFromTypedArrayData<Vector<uint8_t>>(aData);`" |
| (a) WebKit | the temporary file is copied from the target with `keepExistingData`, and **copied over the target at close**; each write is an IPC carrying the bytes, with quota asked per write | `Source/WebKit/NetworkProcess/storage/FileSystemStorageHandle.cpp` 280–282, 315–316, 423; `WebCore/Modules/filesystem/WorkerFileSystemStorageConnection.cpp` 397–399 | "`FileSystem::createTemporaryFile("FileSystemWritableStream"_s);`" / "`if (keepExistingData)`" / "`FileSystem::copyFile(path, m_path);`" · "`if (!FileSystem::copyFile(m_path, activeWritableFile.path))`" · "`manager->requestSpace(*spaceRequired, …`" · "`bytes.append(dataBytes);`" |
| (a) all | a shared-memory view is refused | `…/file_system_writable_file_stream.idl` 16 (Chromium); `dom/webidl/FileSystemWritableFileStream.webidl` 19 (Gecko); `WebCore/bindings/js/JSDOMConvertBufferSource.h` 159–161 (WebKit) | "`(BufferSource or Blob or USVString or WriteParams) data`" · "`(BufferSource or Blob or UTF8String or WriteParams)`" · "`"SharedArrayBuffer is not allowed"_s`". *Run once:* `TypeError` in Chromium 153 and in Firefox 159 |
| (b) | `createWritable` and `getFile` are `[Exposed=(Window,Worker)]`, the sync handle `[Exposed=DedicatedWorker]` | fs `index.bs` 426–431 | "`[Exposed=(Window,Worker), SecureContext, Serializable]`" … "`[Exposed=DedicatedWorker]`" |
| (b) WebKit | `createWritable` behind a setting stable and on by default on Apple platforms, off in Lockdown Mode | `WebCore/Modules/filesystem/FileSystemFileHandle.idl` 41; `Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml` 2395–2406 | "`[EnabledBySetting=AccessHandleEnabled&FileSystemWritableStreamEnabled]`" · "`status: stable`" … "`"PLATFORM(COCOA)" : true`" … "`disableInLockdownMode: true`" |
| (b) | versions: `createWritable` Chrome 86, Firefox 111, **Safari 26**; `getFile` and the sync handle Safari 15.2 (sync 102 / 111); worker `requestAnimationFrame` 69 / 99 / 16.4, Chrome's "Not supported in nested Web Workers" | browser-compat-data `api/FileSystemFileHandle.json` 48–64, 116–132, 186–202; `api/DedicatedWorkerGlobalScope.json` 364–379 | `"version_added": "26"` (Safari, createWritable) |
| (c) | `getFile()` takes no lock; each engine lets it run beside an open sync handle | fs `index.bs` 485–507; Gecko `dom/fs/parent/FileSystemManagerParent.cpp` 294; WebKit `NetworkStorageManager.cpp` 1200–1209; Chromium `file_system_access_file_handle_impl.cc` 180, 211–212 | "You can create a File with getFile() even if the file is locked" (Gecko). *Run once:* read beside a sync handle in Chromium 153 and Firefox 159 |
| (c) | a read lands in a new `ArrayBuffer`: Chromium fills a pipe in the browser and copies it in the renderer; **Gecko pumps a worker's read on the main thread**; WebKit copies each loaded chunk | Chromium `…/core/fileapi/file_reader_client.cc` 34–36; Gecko `dom/base/BodyConsumer.cpp` 206, 506–509; WebKit `WebCore/fileapi/FileReaderLoader.cpp` 253 | "`.copy_prefix_from(data);`" · "`MOZ_ASSERT(NS_IsMainThread());`" … "`NS_NewInputStreamPump(…, mMainThreadEventTarget);`" · "`memcpySpan(protect(m_rawData)->mutableSpan()…`" |
| (e) | a worker runs one task, then its microtasks, then, at a rendering opportunity, its animation frame callbacks | html `source` 123368–123406, 123527–123546 | "Perform \|oldestTask\|'s steps." … "Perform a microtask checkpoint." · "Run the animation frame callbacks for that `DedicatedWorkerGlobalScope`" |
| (e) | every async OPFS result comes back as a storage task; which task queue runs next is the engine's | fs `index.bs` 103–105; storage `storage.bs` 486–492; html `source` 123376–123377 | "the caller is expected to [=queue a storage task=] to [=/reject=]" · "chosen in an implementation-defined manner" |
| (f) | a worker started by a worker gets OPFS: no engine checks who started it | Chromium `…/storage_manager_file_system_access.cc` 111, `content/browser/worker_host/dedicated_worker_host.cc` 1041–1042; Gecko `dom/workers/WorkerPrivate.cpp` 3464, 3468; WebKit `WebCore/workers/WorkerMessagingProxy.cpp` 550–557 | "`context->IsWindow() \|\| context->IsWorkerGlobalScope()`" · "`loadInfo.mStorageAccess = aParent->StorageAccess();`" · "`document = Document::allDocumentsMap().get(m_loaderContextIdentifier);`". *Run once:* a sync handle in a nested worker in Chromium 153 and Firefox 159; WebKit not run |

**What this rules out.**

* **B on a packed file.** Every engine copies the whole file into the temporary file when `keepExistingData` is set,
  and a frame written without it erases the rest. One writable per frame on one series file copies n²/2 frames: 21 GB
  for `dbts_b1`'s 50 × 17 MB. One writable held for the fill shows none of its frames to a read until it closes (fs
  526–530), and a crash loses all of them. **B is weighed with a file per frame**, which reopens choice 3 for B only,
  at the costs choice 3's table gives that layout (a handle per access, a quota failure mid-fill).
* **B costs copies on the view thread, not fewer than A.** The chunk is not `AllowShared`, so the frame is copied out of
  its `SharedArrayBuffer` first; then the engine copies it again on the calling thread (Chromium's string, Gecko's
  vector, WebKit's vector). A's sync write is one copy into the page cache (§4). WebKit writes each frame twice, its
  commit being a file copy; Chromium's (a move) and Gecko's (a file-id swap) copy nothing.
* **B's read in Gecko runs through the content process's main thread**, the page's: under a page held by long tasks
  (§2), a Gecko B miss waits for the task. That is the stall the shape exists to remove; *by source, not run*.
  **Corrected 2026-10-29 (independent review):** this said Gecko alone. WebKit posts every async call a worker makes
  (`getFile`, `createWritable`, each `write`, `close`) to the page's main thread (`WorkerFileSystemStorageConnection.cpp`
  239, 353, 376, 399: "`callOnMainThread(`"), so a WebKit B write waits for a held page too; and a WebKit sync handle
  that outgrows its capacity blocks on a semaphore for the main thread (same file, 489–501), which the rig's A, its
  file truncated to the cell's size at open, does not exercise. Gecko's link from `slice().arrayBuffer()` to
  `BodyConsumer` is `dom/file/Blob.cpp` 274, 289–305, at the same commit and not in the sources list.

### Predicted, before any run

From §4's write path (≥ 1 GB/s on Chromium and WebKit, at most ~4 GB/s, a memory copy), XXH3 at ~4 GB/s (§5), M1's
22.3 ms read + re-check of an S3 frame through the store worker, and a 16.7 ms display period. Arrivals at the fill's
ceiling, 125 MB/s decoded (§Where it saturates): 238 frames/s at S1, 7.3 at S2, 4.6 at S3.

| | blocks the view thread, a frame | the shown frame at 125 MB/s | write rate, credit-bound | a miss, intent → painted |
| --- | --- | --- | --- | --- |
| **A**, on arrival | one write: S1 0.13–0.5 ms, S2 4–17, S3 7–27 at 1×; ×4 at 4× | **late** at S2 and S3, at 1× by ~block/period of the arrivals (3–8 % of ticks; *corrected 2026-10-29 (independent review):* arrivals × block is 3–12 %), at 4× in most | ≥ 1 GB/s Chromium; Gecko lower by its quota round trips, unknown | S3: read 7–27 + check ~7 + up to a period: **the fastest** |
| **A**, paint first | ≤ 8 ms a tick, 1 MiB at a time | **on time**: paint + 8 ms + one chunk < 16.7 ms, at 4× too | ≤ 8/16.7 of the write speed: ≥ 480 MB/s at 1×; **120–480 MB/s at 4×**, under the fill's 125 at the low end | as A |
| **B**, on arrival | two copies of the frame: S3 6–12 ms at 1×, 22–44 at 4× | **late** at S2 and S3 | a file and a commit per frame; WebKit writes twice; ≥ 125 MB/s at 1× on Chromium and Gecko, not traced past that | A + an IPC round trip + one more copy: **the slowest**, by ≥ 10 % at S2 and S3 (*corrected 2026-10-29 (independent review):* does not follow at the slow end: one more copy, 2–6 ms, on A's 38–51 ms is 5–12 %, the IPC not quantified) |
| **B**, paint first | our copy budgeted; the engine's copy (S3 3–6 ms at 1×, 11–22 at 4×) in a later task, not | on time at 1×; **late at 4×** at S2 and S3, ~5–8 % of ticks | as B on arrival | as B |
| **C** | a post, ~0.1 ms; *corrected 2026-10-29:* a copy out of shared memory first, as `viewer.js` hands it, at 4–8 GB/s S2 2–4 ms, S3 3–6 at 1× (*corrected 2026-10-29, independent review:* 3.4–6.8), ×4 at 4× | **on time**; *corrected:* late at S3, 4×, by the copy (*corrected 2026-10-29, independent review:* and at S2, 4×: its 8–17 ms copy is A on arrival's S2 block at 1×, predicted late) | as A on arrival, in the store worker | A + two posts, ~0.5 ms; off the view thread |

B's copies (6–12 ms for two of S3) take a memory copy at ~4.5–9 GB/s, a rate none of the inputs above gives
(*added 2026-10-29, independent review*).

**Predicted verdict:** A-on-arrival and B-on-arrival fail the shown frame at S2–S3; B-paint-first fails it at 4×; A
paint-first and C keep it (*C corrected 2026-10-29: its copy makes it late at S3, 4×, and by the independent review at S2, 4×; the amended verdict is under
§Arm D, below*). The rule below then picks **A paint-first if it holds 125 MB/s at S3, 4×, else C**; A over B
on the miss in every engine. Where the host saturates: the paint alone uploads an S3 frame through SwiftShader on this
container, so the `none` arm may miss ticks at S3, 4×; nothing is claimed for a cell where it does.

### Protocol, pre-registered 2026-10-28

Rig: `lab/opfs-arms/` (at `0920153d`) (README there), on the 4-vCPU agent container; Chromium 153 and Firefox 159 on Xvfb; **WebKit not
run: no WebKit build in the container.** A feeder worker stands in for the decoders: it posts checked frames as
`SharedArrayBuffer`s, 4 distinct fields cycled, at 125 MB/s or on credit (*three feeders since 2026-10-29*, §Arm D). The view worker paints from memory at its own
`requestAnimationFrame`, the shown frame changing every tick at S1 and every 6th at S2–S3 (an upload from memory),
and runs one arm. Every frame recorded written is read back and hashed after the cell. Per cell: Chromium and
Firefox × S1, S2, S3 × 1× and 4× (`lab/scripts/cpu_throttle.mjs`, every thread); **12 rounds**, the arms ordered per
round by `lab/order.mjs`; a fresh profile per run; every arm's settings printed in the rows' first line.

| cell | arms | measured | settings |
| --- | --- | --- | --- |
| **L** the shown frame | `none` (no cache), A and B in both orders, C, C′ | missed ticks (a gap between callbacks of k periods misses k − 1), as a share of ticks; the paint task's delay (callback start − its frame time) p50 / p99; the backlog (frames arrived, not written) each tick; peak PSS growth | 125 MB/s for 10 s; 4 frames held for the show; paint first drains ≤ 8 ms a tick in 1 MiB pieces, after the paint (*corrected 2026-10-29 (independent review):* the rig counted the 8 ms from the tick's start, paint included) |
| **W** the write rate | A and B in both orders, C, C′ | MB/s from the first arrival to the last write, the feeder kept 8 frames ahead; every frame read back exact | 1 000 MB of frames |
| **R** a miss | A, B, C, C′ | 16 intents a run, each a frame not in memory: intent → read → re-check → painted, p50 / p99; the page cache is warm (choice 1's M1 says so too) | after a fill of 32 |

**A/A and VOID.** C′ is C again. A cell is **VOID** when, over its rounds, the median of |C′ − C| in missed share exceeds
1 % of ticks (L), or the median C′ / C lies outside 0.90–1.10 for MB/s (W) or the miss p50 (R).

**Saturation.** A cell (engine × size × throttle) in which `none` misses more than 5 % of ticks in its median round is
**saturated**: nothing is claimed there for any arm. (*Corrected 2026-10-29 (independent review):* `summary.mjs`
excluded only L there, not W and R at the same engine, size and throttle; it now excludes all three. L's 7 arms balance
their order over 14 rounds (`lab/order.mjs`), so 12 leave it slightly unbalanced.)

**The rule, stated before any data.** Per engine, over the non-VOID, unsaturated cells:

1. An arm **keeps the shown frame on time** if its missed share exceeds `none`'s by ≤ 1 % of ticks and its paint delay
   p99 by ≤ 4 ms, in ≥ 9 of 12 rounds, at every size and both throttles.
2. Its **backlog is bounded** if every write reads back exact and the largest backlog in the last third of L is no more
   than 2 frames over the first third's, in ≥ 9 of 12 rounds; and W sustains ≥ 125 MB/s in ≥ 9 of 12.
3. **The fewest threads that pass both win**: A or B (no thread more) before C (one more). If A and B both pass, B wins
   only if its median in every R cell is ≤ 0.9 × A's and its median in every W cell ≥ 0.9 × A's; else A. Within
   an arm, paint first wins unless only on-arrival passes. If no arm passes, the result goes to the owner as measured.

`lab/opfs-arms/summary.mjs` (at `0920153d`) applies this rule to the rows.

**Mutants, each run before its cell is believed.** *write-before-paint*: the paint-first arm draining its whole queue
before the paint. At S3, 4×, it must miss ticks, and at least Σ ⌊block / period⌋ of its own measured blocks; a
harness that cannot see that lateness fails. *Corrected 2026-10-29 (independent review):* that check alone also passes
the arm unmutated (run once: A and B paint-first, unmutated, at S3, 4×, Chromium), so it does not tell the
mutant from the code; `summary.mjs` now counts it caught only if it also misses more than 1 % of ticks over the same
arm unmutated. Re-run once, the A mutant missed 527 ticks against 532 predicted, so the check failed it (B's passed):
⌊block / period⌋ per 1 MiB piece and the tick count's rounding do not bound each other, and the bar is marginal.
*drop-writes*: every arm recording writes it never made; W must fail its read-back. Both are `--mutant` in the rig.

**Smoke, 2026-10-28** (one round per arm, Chromium 153 and Firefox 159; not results): every arm ran its L, W and R
runs to the end in Chromium, L and R in Firefox, each writing and reading back exact, except one Firefox B-on-arrival
L run that hit the cell's deadline (4 × its 10 s) with frames unwritten, which the rule counts as an unbounded
backlog. *write-before-paint* was caught at S3, 4×, on both paint-first arms (by the check corrected
above, which the unmutated arm also passes; Chromium only: the smoke did not throttle Firefox); *drop-writes* was caught on A, B and C in both engines. The saturation check fired at S3, 4×, in Chromium's
one round: whether that cell is saturated is for the full run. The probe's facts are in the table above (*run once*).
The full runs are a separate row.

### Arm D: the decoders write; a window drag (amended 2026-10-29, before any data)

**Why.** The Target (§Target: the view worker, on `claude/view-worker-target-rev`) rules the cache writes off the view
worker's thread (the red team's finding 4) and leaves who writes open between **C**, **D** and **A paint-first**. **D**
is the independent design's: each decoder writes its decoded frame to OPFS from its own heap before posting it, so the
paint thread never writes. Nothing here is measured; *smoke* lines are not results.

**What the sources say.** At §9's pinned commits, quoted file:line; new files and the ones not already listed are in
[`frame-path-sources.txt`](sources.txt) under 2026-10-29.

| | claim | source | quoted |
| --- | --- | --- | --- |
| (g) | the spec's sync handle takes no options and an exclusive lock: one writer per file | fs `index.bs` 431, 605, 647–648 | "`Promise<FileSystemSyncAccessHandle> createSyncAccessHandle();`" · "takes an exclusive lock" · "with "`exclusive`" on \|entry\|" |
| (g) Chromium | ships a `mode` option; `"readwrite-unsafe"` handles share one lock type, so N of them open one file | `…/file_system_access/file_system_create_sync_access_handle_options.idl` 7–16; `file_system_file_handle.idl` 39–41; `runtime_enabled_features.json5` 3142–3143; `content/browser/file_system_access/file_system_access_file_handle_impl.cc` 322–323; `file_system_access_manager_impl.h` 769–771; `file_system_access_lock_manager.cc` 90 | "`"readwrite-unsafe",`" · "`RuntimeEnabled=FileSystemAccessLockingScheme`" · "`status: "stable",`" · "`GetSAHReadwriteUnsafeLockType();`" · "`lock_manager_->CreateSharedLockType();`" · "`return type != type_ \|\| IsExclusive();`" |
| (g) Gecko, WebKit | no options: exclusive only | Gecko `dom/webidl/FileSystemFileHandle.webidl` 17–18; WebKit `FileSystemFileHandle.idl` 40, `NetworkProcess/storage/FileSystemStorageHandle.cpp` 220 | "`Promise<FileSystemSyncAccessHandle> createSyncAccessHandle();`" · "`acquireLockForFile(m_path, FileSystemStorageManager::LockType::Exclusive)`" |
| (g) | versions of `mode`: Chrome 121, Firefox none, Safari none; experimental | browser-compat-data `api/FileSystemFileHandle.json` 75–100 | `"version_added": "121"` · `"version_added": false` |
| (h) Chromium | a write past the granted capacity asks for more synchronously; a new file has none; within it, a write sends one note and does not wait | `…/file_system_access_regular_file_delegate.cc` 77–80, 84, 91; `…/file_system_access_capacity_tracker.cc` 116 | "`if (!capacity_tracker_->RequestFileCapacityChangeSync(write_end_offset))`" · "`file_modification_host_->OnContentsModified();`" |
| (h) Gecko | the worker spins a sync loop while its IO queue copies the chunk in 1 MiB blocks; each block's write is a synchronous quota IPC, growing or not | `dom/fs/api/FileSystemSyncAccessHandle.cpp` 551, 563–564, 604, 627; `dom/fs/child/FileSystemAsyncCopy.cpp` 44–45; `dom/quota/FileStreams.cpp` 92–93; `dom/quota/RemoteQuotaObject.cpp` 56 | "`AutoSyncLoopHolder syncLoop(`" · "`kStreamCopyBlockSize,`" · "`mQuotaObject->MaybeUpdateSize(`" · "`SendMaybeUpdateSize(aSize, aTruncate, &result)`" |
| (h) WebKit | a handle starts with the file's size as capacity; growing past it, and `close()`, each **wait on the page's main thread** and the network process; `createSyncAccessHandle` goes through the main thread too | `WebCore/Modules/filesystem/FileSystemSyncAccessHandle.cpp` 162, 185–188, 125; `WorkerFileSystemStorageConnection.cpp` 284, 303–310, 491–500; `NetworkProcess/storage/FileSystemStorageHandle.cpp` 242, 540–541 | "`uint64_t initialCapacity = valueOrDefault(FileSystem::fileSize(m_path));`" · "`callOnMainThread([mainThreadConnection = m_mainThreadConnection, identifier, accessHandleIdentifier, newCapacity, &grantedCapacity, &semaphore]() {`" · "`semaphore.wait();`" |

**(1) N decoders and one packed file.** The packed file's exclusive lock (g) admits one writer, so D takes one of three
shapes:

* **A file per frame** (the independent design's layout): every engine; per frame, two async handle calls, a capacity
  request at the first write (h: a new file has none), a close, and the quota answered per frame where the packed file
  answers it at open with `truncate`. WebKit puts three waits on the page's main thread on each frame: create, capacity,
  close (h). **This is arm D.**
* **One writer the decoders post to**: C's store worker on a port to each decoder instead of the view worker. The copy
  out of the heap moves to the decoder's clock and the view thread does nothing for the cache; the packed file stays.
  Not an arm: it is C with the post moved, and **the arm to add if D fails only on the decoders' clock and C only on
  its copy** (below).
* **A shared handle** on the packed file: Chromium's `mode: "readwrite-unsafe"` alone ships it (g); Gecko and WebKit
  have no `mode`, and the spec none. It would be a second path for two engines in three. Not an arm.

**(2) Copies of the samples and messages, per fill frame.** The Target's four messages are decode, frame, `done`, ack.

| | copies in script | on the view thread | messages |
| --- | --- | --- | --- |
| **A paint first** | 2: heap → shared buffer (decoder); buffer → file (view) | the write, ≤ 1 MiB a piece after the paint | 4 |
| **C** as built | 3: heap → shared buffer; buffer → a transferable copy (view, `client/viewer/viewer.js:167`); copy → file (store worker) | the copy and a post | 6: + write, + its reply |
| **D** | 2: heap → file and heap → shared buffer, both on the decoder; 1 if the frame is not held in memory, as in the independent design | nothing but the frame's arrival | 4; the frame says it is written, so the ack is at once; the series' directory handle once per decoder |
| one writer the decoders post to | 3: heap → shared buffer; heap → a copy (decoder); copy → file | nothing | 6 |

**(3) A write on a decoder's clock.** D adds to each decoder, per frame: Chromium, the two handle calls (~1.3 ms on this
container, `lab/target-review/opfs/` at `7f335cc0` on the Target's branch, indicative; they can run while the decoder decodes), a synchronous capacity
request, the write (a copy into the page cache) and the close; Gecko, a create and a handle from the parent, and one
synchronous quota round trip per MiB (1 at S1, 17 at S2, 26 at S3) that A and C pay too, but on the view or store
thread; WebKit, three main-thread waits (h). **Whether D slows a fill** turns on whether the fill is decode-bound: three
decoders × the frame / its decode (exactness §3: 3.1 / 14.6 ms at S1, 47 / 210 at S2, 1× / 4×) against the fill's
125 MB/s. On this host that is S1 at 4× alone (108 MB/s of decode). There the probe's write and close, ~0.74 ms at 1×,
predict ~3 ms at 4×, ~20 % of the decode: **D predicted to slow a decode-bound 512² fill by ~17 % on Chromium.** S2 is
not decode-bound (243 MB/s at 4×): there the same cost is ~10 % of the decode and slows nothing. S3 has no measured
decode.

**(4) A miss under D** is read in the view worker as A reads, from the frame's own file: `getFileHandle`,
`createSyncAccessHandle`, `getSize`, one `read()` into a new shared buffer, `close`, XXH3 against the digest. It never
meets a writer's lock: the decoder closed the file before posting. Over A it costs the two handle calls and a close
(~1.0–1.4 ms on Chromium, the probe); on WebKit two main-thread waits. `getFile()` takes no lock but Gecko pumps its read
on the main thread ((c) above), so the sync handle.

**Predicted, D per cell.**

| | blocks the view thread, a frame | the shown frame (L) | write rate (W) | a miss (R) | a drag (G) |
| --- | --- | --- | --- | --- | --- |
| **D** | nothing: the frame arrives written | **on time**, as `none` | three writers: Chromium ≥ 125 MB/s at every size and throttle, nearest at S1, 4× (~190 MB/s; *corrected 2026-10-29, independent review:* that is one writer's probe ×3; the probe's three-writer table gives ~160); Gecko unknown | A + ~1–1.4 ms: within a period of A everywhere; ~5 % over A at S3 | **as `none`** |

The drag cell's other arms: **A paint first** as `none` (still frame, no upload; the drain stays inside its 8 ms);
**C** as `none` at 1× and **late at 4×**, an input landing behind a 8–16 ms copy at S2.

**Amended verdict, predicted.** Chromium: D passes L, G, W and fails the decoders' clock at S1, 4×; C is late at S3,
4× (*corrected 2026-10-29, independent review:* and S2, 4×) and in G at 4×; **A paint first is picked if it holds 125 MB/s at 4×**, which #227 predicted at 120–480 MB/s;
otherwise no arm passes, and the result goes to the owner with *one writer the decoders post to* as the arm to add.
Firefox: as Chromium except D's clock, unknown; if it passes there, D is picked. WebKit: not run, no build here; by
source D's three main-thread waits a frame stall every decoder behind the page's long tasks, which the rig's idle page
cannot show: **a WebKit cell with a busy page is owed before D is adopted on WebKit.**

**Amended protocol** (2026-10-29, before any data):

* **D** joins L, W and R. In the rig the feeders write as the decoders would, a file per frame through a sync handle
  from a non-shared heap copy, then post; each row carries the handle and write-and-close times on the feeder's clock.
* **The feeder runs as three workers**, the client's decoder count (`client/README.md`, *How many decoders*), each
  posting every third frame at a third of the rate, or on its three of the credits. Every arm, so the arms stay
  interleaved on one rig.
* **C is handed what `viewer.js` hands the store worker**, a copy out of shared memory, transferred (`bd39d089`). The
  rig had sent the shared buffer itself, so C's L would not have seen the copy.
* **G, a window drag during a mammogram fill** (the red team's cell): S2 at 125 MB/s for 10 s, the shown frame still;
  the harness holds the pointer down on the canvas and moves it every 16 ms; the page posts each move to the view worker
  as a window intent stamped with the event's time; the view worker draws the newest at its next tick. Measured: input →
  painted (the draw issued; presentation is not read) p50 / p99, and the inputs superseded before a draw. Arms `none`,
  A paint first, C, C′, D; Chromium and Firefox × 1× and 4× × 12 rounds. **VOID** when the median |C′ − C| of p99 exceeds
  4 ms; **saturated** when `none` misses more than 5 % of ticks.
* **Mutants.** *drop-writes* now drops D's writes in the feeders; W must fail its read-back. *late-input*: each window
  intent taken 34 ms late; G's input → painted p50 must be ≥ 34 ms.

**The rule, amended.** Per engine, over the non-VOID, unsaturated cells, among **A paint first, C and D** (A on arrival
and B stay in the cells, reported, not chosen):

1. **On time:** rule 1 as written, and in G an input → painted p99 no more than `none`'s + 4 ms in ≥ 9 of 12 rounds,
   at both throttles.
2. **Bounded:** rule 2 as written.
3. **D's clock**, D alone: in every W cell where the fill is decode-bound as (3) defines it, D's median write and close
   a frame, plus what its handle calls take beyond the decode, is ≤ 0.10 × the decode.
4. **D, then A paint first, then C**: D wins if it passes 1–3, unless A paint first passes too and D's miss paints a
   display period or more after A's in some R cell; then A paint first; then C. If none passes, the result goes to the
   owner as measured.

`lab/opfs-arms/summary.mjs` (at `0920153d`) applies it. *Corrected 2026-10-29, independent review:* it failed rule 3 for D in any W cell
with no measured decode (S3), so D could not be picked once S3 ran; a cell rule 3 does not judge now passes it.

**Smoke, 2026-10-29** (one round per arm, Chromium 153 and Firefox 159; not results): L, W and R at S1 and G at S2 ran
every arm to the end in both engines, each write read back exact, except two Firefox L runs, C′ and B on arrival, that
hit the cell's deadline with frames unwritten, which the rule counts as an unbounded backlog. *drop-writes* was caught on
D and *late-input* on `none` and D, in both engines; one Chromium W run at S1, 4× exercised the decoders'-clock test.
The full runs are a separate row. *Independent review's smoke, 2026-10-29* (Chromium 153 only, no Firefox in its
container; XXH3 stood in by a JS hash, the decoder builds absent; not results): D's W at S1, 1× was 102, 133 and 199
MB/s in three rounds, write and close 1.6–5.7 ms on the feeder against the probe's 0.74, so W's ≥ 125 is the cell to
watch; in one G round at S2, 1×, `none` missed 9.7 % of ticks, over the 5 % saturation line.

**Amended before any data, 2026-10-29 (the independent review's open points).** *Rounds:* each cell runs one whole
Williams period of its arms (`lab/order.mjs`), so every arm follows every other equally often: **L 8 rounds** (8 arms;
8 and 16 are equally near 12, 8 taken for the host's time), **W 14** (7 arms), **R 10** and **G 10** (5 arms). The
rule's "≥ 9 of 12" reads as ≥ 75 % of a cell's rounds, as `summary.mjs` counts it: ≥ 6 of 8, 11 of 14, 8 of 10.
*Credits:* three feeders take ⌈8 / 3⌉ = 3 credits each, so W keeps 9 frames ahead in total, not 8.

### Arm D, Results (run 2026-10-29 to 2026-10-30)

**What ran.** The amended protocol as written, on the 4-vCPU, 15.7 GiB agent container: Chrome for Testing
153.0.8010.12 (Playwright's) and Firefox 159.0 (WebDriver BiDi, Xvfb), decoder builds from `claude/decoders-committed`
checked against `manifest.sha256`. Every cell L, W, R at S1, S2, S3 × 1×, 4×, and G at S2 × 1×, 4×, one Williams period
each (L 8 rounds, W 14, R and G 10), the three mutants once each; a fresh profile per run. Raw rows, at `claude/opfs-arms-run@c99ba492`, not in this tree:
[`lab/opfs-arms/rows/`](https://github.com/dary-dc/wt-pacs/tree/c99ba4929227ab3d17365ca69dc2c9cf8a211cc1/lab/opfs-arms/rows) `{chromium,firefox}/`, one file per cell. **WebKit not run** (no build here), so the WebKit cell with
a busy page stays owed. Twice the container restarted mid-cell; the cell's partial rows were discarded and the cell run
whole again. The harness was fixed during the Firefox run, each fix checked by a mutation and the cut-short cells
rerun whole: a run's 300 s deadline now covers the navigation and the drag, and a browser that does not start is killed
at 60 s; Node 22's built-in `WebSocket` closed Firefox's BiDi socket abnormally (1006) once in 5–8 drag runs, with
Firefox still alive, so `lab/opfs-cache/browser.mjs` uses Playwright's bundled `ws` (44 of 44 runs then completed).

**The mutants.** *drop-writes* caught on A on arrival, B on arrival, C and D, and *late-input* on `none` and D, in both
engines. *write-before-paint* caught on B paint first in both and on A paint first in Firefox; **not caught on A paint
first in Chromium**: it missed 94.9 % of ticks against ~55 % unmutated, but 761 ticks under the Σ ⌊block / period⌋
bar's 868, the marginal bar the Protocol's correction names. Its cell, S3 4×, is saturated in both engines, so no
claim leans on it.

**Where the host saturates** (`none` misses > 5 % of ticks in L's median round; nothing is claimed for any cell at that
engine, size and throttle): Chromium S2 4× (7.8 %) and S3 4× (13.1 %); Firefox S2 4× (28.3 %), S3 1× (6.9 %) and S3 4×
(44.8 %). **VOID** (A/A): Chromium L S1 4× (|C′ − C| 8.9 % of ticks), W S2 1× (C′ / C 1.11) and W S3 1× (1.19);
Firefox L S1 4× (1.2 %), L S2 1× (4.4 %), R S2 1× (0.89) and G S2 4× (56 ms). Counted: Chromium 10 cells of 20, Firefox
7 of 20.

**Counted cells.** L: median missed share of ticks, then (rounds on time, rounds bounded) of 8; W: median MB/s (rounds
≥ 125) of 14; R: miss p50 ms, every arm on every counted cell 10 of 10; G: input → painted p99 ms (rounds on time) of 10.

| | none | A on arrival | A paint first | B on arrival | B paint first | C | C′ | D |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Chromium L S1 1× | 0.0 | 0.0 (6, 8) | 0.0 (8, 7) | 0.3 (3, 0) | 0.5 (4, 0) | 0.2 (8, 7) | 0.3 (7, 6) | 0.0 (8, 8) |
| Chromium L S2 1× | 0.7 | 36.3 (0, 8) | 1.0 (6, 8) | 3.6 (0, 8) | 3.9 (1, 8) | 2.0 (3, 8) | 2.5 (0, 8) | 0.5 (8, 8) |
| Chromium L S3 1× | 0.3 | 45.8 (0, 8) | **17.0 (0, 0)** | 8.9 (0, 8) | 10.2 (0, 8) | 6.1 (0, 8) | 6.2 (0, 8) | 0.5 (6, 8) |
| Firefox L S1 1× | 0.0 | 0.3 (7, 8) | 0.2 (8, **3**) | 6.5 (0, 0) | 7.0 (0, 0) | 0.8 (2, 6) | 0.7 (1, 5) | 0.1 (8, **4**) |
| Chromium W S1 1× | | 816 (14) | 238 (14) | 139 (14) | 123 (6) | 505 (14) | 521 (14) | 264 (14) |
| Chromium W S1 4× | | 194 (14) | 175 (13) | 43 (0) | 44 (0) | 110 (3) | 111 (3) | 190 (14) |
| Firefox W S1 1× (C, C′: 3 runs past the deadline) | | 360 (14) | 223 (14) | 29 (0) | 29 (0) | 158 (12) | 160 (13) | **30 (0)** |
| Firefox W S1 4× | | 352 (14) | 194 (14) | 17 (0) | 17 (0) | 98 (0) | 97 (0) | **21 (0)** |
| Firefox W S2 1× | | 1178 (14) | 569 (14) | 316 (14) | 303 (14) | 306 (14) | 304 (14) | 314 (14) |
| Chromium R S1 1×, 4× | | 16.4, 16.4 | | 16.4, 31.9 | | 16.4, 16.4 | 16.4, 16.4 | 16.4, 16.5 |
| Chromium R S2 1× | | 28.8 | | 52.0 | | 33.1 | 33.1 | 35.3 |
| Chromium R S3 1× | | 40.1 | | 83.4 | | 49.7 | 49.6 | 47.6 |
| Firefox R S1 1×, 4× | | 15.6, 15.7 | | 16.1, 15.8 | | 15.9, 15.9 | 15.8, 16.0 | 16.1, 16.0 |
| Chromium G S2 1× | 33.8 | | 33.9 (10) | | | 36.5 (6) | 38.1 (4) | 33.7 (10) |
| Firefox G S2 1× | 17.7 | | 17.6 (10) | | | **47.4 (0)** | 49.1 (0) | 17.8 (10) |

The view thread's block a frame in L at 1×, median of the rounds' p50 (Chromium / Firefox): C's copy S2 9.1 / 32.6 ms,
S3 14.4 / 47.6, against the 2–4 and 3.4–6.8 ms predicted; A paint first S3 4.6 / 6.3; A on arrival S2 70.6 / 11.8, S3
128.5 / 162.9, against 4–17 and 7–27 predicted. D's write on a decoder (the rows' feeder clock, median of the rounds'
p50): Chromium S1 4× the handle calls 4.1 ms and write and close 2.2 ms; Firefox S1 1× 26.9 and 22.6 ms, S2 1× 26.7
and 145 ms.

**The verdict, per rule, per engine.**

| | Chromium 153 | Firefox 159 |
| --- | --- | --- |
| **D** | rules 1 and 2 pass on every counted cell; **rule 3 fails**: 2.12 ms against S1 4×'s 14.6 ms decode, 0.145 > 0.10 | **rule 2 fails**: W at S1 30 and 21 MB/s, L at S1 1× bounded 4 of 8 (the decoders fall behind, the cell ends unwritten); **rule 3 fails**: 58.3 ms against 14.6 |
| **A paint first** | **rules 1 and 2 fail** at L S3 1×: 17 % of ticks missed, the drain behind the fill in every round | rule 1 passes; **rule 2 fails** at L S1 1×: bounded 3 of 8 |
| **C** | **rule 1 fails** at L S2 1× (3 of 8) and S3 1× (0 of 8); W S1 4× 110 MB/s (3 of 14) fails rule 2 | **rule 1 fails** at L S1 1× (2 of 8) and G S2 1× (0 of 10); W S1 4× 98 MB/s (0 of 14) fails rule 2 |
| **rule 4** | no arm passes: **to the owner as measured** | no arm passes: **to the owner as measured** |

**Against the prediction.** Chromium's D fails only its decoders' clock at S1, 4×, as predicted (2.12 ms where ~3 was
predicted; the ratio 0.145 where ~0.20), so by (1) **one writer the decoders post to** is the arm to add there. C's copy
blocks the view thread 2–4× longer than predicted on Chromium and ~8× on Firefox and makes C late already at 1×, at S2 and S3 in Chromium and at S1 in
Firefox, not only at 4×. A paint first was predicted on time everywhere and is not on Chromium at S3 1×: its blocks are
inside the 8 ms, but its drain falls behind a 125 MB/s fill of S3 frames. On Firefox a file per frame costs the decoder
~50 ms a frame at S1 (handle and write), so D falls short of 125 MB/s at S1 whatever the throttle; the source's
per-frame quota round trips ((3) above) predicted a cost, not its size. A on arrival and B are late where predicted, and B on
Firefox at S1 too. Nothing past the saturated cells is claimed, so the 4× parts of rule 1 are judged at S1
alone, and Chromium's S1 4× L is VOID.

## Each arm's parameters, and the amended arms C-shared and A-left (2026-11-03 to 2026-11-04)

*Folded 2026-11-14 from `claude/opfs-theory:docs/adr/frame-path.md` §Each arm's parameters (c01750b7) and
`claude/opfs-c-shared:docs/adr/frame-path.md` §Each arm's parameters, §Arm D amended, §Arm D amended: Results
(2a2510bd, a6a27015), word for word but for queue-row names; the bare §N and §Name rules above apply. Chromium only, by
the owner's 2026-10-31 stance (Chromium first, Firefox a later goal). The first part is **theory**, nothing run for it;
the last is **measured**. Fixture: Chrome for Testing 153, one 4-vCPU container, every 4× cell saturated.*

### Each arm's parameters (theory, 2026-11-03)

**Status:** theory, for the owner to read before deciding; **nothing was run for it**. Every number is from the run's
rows (`claude/opfs-arms-run:lab/opfs-arms/rows/chromium/`, Chromium 153, medians over a cell's rounds of each round's value), from the
documents it names, or marked *not measured*. Target: Chromium (the owner, 2026-10-31); Firefox has one paragraph
at the end.

**In plain words.** No arm passed, but the run tested each arm at one setting of values the protocol or the rig chose:
a budget of 8 ms and 1 MiB pieces, 125 MB/s for 10 s, 60 Hz, three frame sizes, an upload every 6th tick at S2–S3,
a 0.10 bar for D, a file per frame for B and D, and a copy before C's post. Most failures follow from those values by
arithmetic, with inputs the rows already hold, which means they say more about the values than about the API. The
part below writes each arm's region as inequalities, so the owner can see which value to move and what moving it
costs; it then questions the rule that failed A paint first; it ends with the one measurement per arm that would most
change the decision.

**The inputs.** One symbol each; *rig* means the implementation fixed it, *protocol* the pre-registered text.

| symbol | what | value in the run | fixed by | in the Chromium rows? |
| --- | --- | --- | --- | --- |
| R | arrival, decoded bytes a second | 125 MB/s for 10 s (§Where it saturates: 100 Mbit/s × a ratio ≤ 10) | protocol | yes, `writeMBps` of `none`: 125–128 |
| s | a frame's bytes | S1 0.52, S2 17.0, S3 27.3 MB | protocol | — |
| f, T | display rate, period | 60 Hz, 16.7 ms (Xvfb) | the host | yes, `periodMs`: 16.7 |
| k | an upload every k-th tick | 1 at S1, 6 at S2–S3 (`cineEvery`) | protocol | — |
| P₀ | the paint, no upload | 0.02 ms (S2, S3), 0.12 (S1) | — | yes, `paintMsP50` |
| Pᵤ | the paint with an upload | **not measured**: the median hides the 1-in-6 tick. *Indicative:* 7.5 ms at S2, 12.6 at S3 (1×), 23.6 at S2 4×, from W's A on arrival rows, whose 2 ticks a round include one upload | — | no |
| v | the sync handle's write on the writing thread | **varies 15× by cell, cause not isolated**: S3 1 MiB pieces 4.5 ms (0.23 GB/s) in L, S2's 0.32 ms (3.3 GB/s); a whole frame 69 ms at S2, 128 at S3 in L (0.21–0.25 GB/s), 8.0 ms at S3 in R's fill (3.4 GB/s) | — | indirectly, `blockMsP50` of A |
| b | A paint first's budget | 8 ms a tick, counted from the paint's end; a piece starts while < b has passed, so a tick may run one piece over | rig (`view.js` `drain`) | — |
| q, t_q | A's piece, its time q / v | 1 MiB; t_q at S3 1×: 4.5 ms median, 14.6 ms the median round's worst | rig | yes, `blockMsP50`, `blockMsMax` |
| c | the copy out of a `SharedArrayBuffer` (`slice()`) | ~1.9 GB/s: 9.1 ms at S2, 14.4 at S3, 1× | rig and product (`view.js:102`, `client/view/cache.js:53`) | yes, C's `blockMsP50` |
| N, d | decoders, a frame's decode | 3; d = 3.1 / 14.6 ms at S1, 47 / 210 at S2 (1× / 4×), **S3 not measured** | `client/README.md`; exactness §3 | no: the feeders do not decode |
| h, w | D's handle calls, its write and close, on a decoder | h 2.1–2.8 ms; w 1.0–1.5 at S1, 49–80 at S2, 20–127 at S3 (1×), varying by cell as v does | — | yes, `decoderHandleMsP50`, `decoderWriteMsP50` |
| H | the memory window | 256 MiB a tab in the product (choice 2); the rig holds every queued frame | product | — |

Measured nowhere in these rows: Pᵤ apart, v on an idle thread, the store worker's write on its own thread, the cost of
posting a `SharedArrayBuffer` to it, and S3's decode.

**A view-thread block that lands when a frame arrives** falls at any phase of the tick. Rule 1 counts a tick missed
when a gap rounds to two periods, and also asks the paint delay's p99 to stay within 4 ms of `none`'s. Frames arrive
at R / s a second, 7.3 at S2 against 60 ticks, so a block x at arrival touches ~12 % of ticks and sets the p99:
**a block at arrival is on time only if x ≲ 4 ms**, at S1–S3 alike. A block placed right after the paint delays
nothing until it runs past the period: **P + x ≤ T**. That difference is the whole case for paint first.

**A on arrival.** The view thread writes each whole frame when it arrives. It is A paint first with b = ∞ and q = s;
nothing else is fixed. On time iff `s / v ≲ 4 ms`: v ≥ 4.3 GB/s at S2, ≥ 6.8 at S3. The fastest v in any row is 3.4,
and in L 0.21–0.25, where the thread is blocked R / v ≈ 50–59 % of the time (missed 36 and 46 %). **No measurement
moves it**; its only change is to become A paint first.

**A paint first.** After each paint, the view thread writes pieces of the queue for up to b. Fixed: b = 8 ms, q =
1 MiB, the drain inside the `requestAnimationFrame` tick only, the queue unbounded, k = 6 at S2–S3, T = 16.7 ms.

* **Keeps up** iff `f · (1 − m) · ⌈b / t_q⌉ · q ≥ R` (m the missed share), close to `b · f · v ≥ R` when t_q ≪ b.
  S3 1×: ⌈8 / 4.5⌉ = 2 pieces, 2.1 MB a tick, × 60 × (1 − 0.17) = 104 MB/s; **measured 104**. S2 1×: 25 pieces a
  tick, far above R.
* **On time** iff `Pᵤ + b + t_q ≤ T` on an upload tick and `P₀ + b + t_q ≤ T` on the others, t_q at its tail. S3 1×:
  12.6 + 8 + 4.5 = 25 > 16.7 on every upload tick, 1 in 6: **16.7 % predicted, 17.0 % measured**. S2 1×: 7.5 + 8 +
  0.3 = 15.8 ≤ 16.7, on time (1.0 % against `none`'s 0.7).

So both of its Chromium failures are the 8 ms on the upload tick, and an S3 piece slower than S2's; neither is the
API. **A fixed budget is one point on a spectrum.** The other end writes what is left of each tick: before each piece,
start it only if `elapsed + t_q ≤ T − g` (g a margin for the engine's own work after the callback), so b_i = T − P_i
− g varies by tick, and the upload tick may write nothing. Then:

* on time by construction, except where a piece's tail t_q exceeds its median: the S3 worst piece of 14.6 ms misses
  a tick whatever the policy, so **q is the lever for the tail** (smaller pieces, more calls; Gecko pays a quota round
  trip per 1 MiB block anyway, §4, so below 1 MiB costs Firefox more);
* keeps up iff `(f · q / k) · [(k − 1) · ⌊(T − P₀ − g) / t_q⌋ + ⌊(T − Pᵤ − g) / t_q⌋] ≥ R`. S3 1×, g = 2 ms: (5 × 3 +
  0) / 6 × 1.05 MB × 60 = **157 MB/s ≥ 125**, on paper, with Pᵤ indicative.

Between the two ends sit policies: skip the upload tick; defer writes while the queue is inside the window (below);
drain in a task after the tick as well as in it. The last matters on its own: a hidden tab's worker gets no animation
frames, so a drain tied to them stops. **At 120 Hz** (T = 8.3 ms) the fixed 8 ms is late on every tick, and what is
left of the tick still writes. With k = 2, the 30 frames/s of DBT cine §Where it saturates names, half the ticks
upload, and the S3 line becomes (f · q / 2) · [3 + 0] = 94 MB/s < 125: cine of S3 frames while filling at 125 MB/s is
outside A paint first's region at this v.

**B, on arrival and paint first.** The async API in the view thread. Fixed by the API: a copy out of shared memory
(the chunk is not `AllowShared`), the engine's own copy inside `write()`, a file per frame (on a packed file each
writable copies the file, *What this rules out*), a commit per frame; by the rig, no cap on writes in flight.

* On time on arrival iff `s / c + s / c_e ≲ 4 ms` (c_e the engine's copy); measured blocks 9.3 ms at S2, 14.4 at S3.
  Paint first budgets our copy only: `P + b + t_q + s / c_e ≤ T`.
* Keeps up iff `j · s / (o_B + s / v_B) ≥ R`, j writes in flight and o_B the per-file overhead (create, close, the
  swap's move). At S1 4×, 74–80 MB/s against 125: at least 6.5 ms a frame.

The amended rule reports B and does not choose it; no single measurement brings B back for Chromium.

**C as built.** A store worker owns the packed file and its sync handle; the view thread copies each frame out of
shared memory and transfers the copy. Fixed: the copy, one store worker, the packed file. On time iff `s / c ≲ 4 ms`:
c ≥ 4.3 GB/s at S2, 6.8 at S3, against 1.9 measured, so **C as built is outside its region by its copy**; the rows say
so (S2 1×: paint delay p99 10.5 ms against `none`'s 5.7). Keeps up iff the store worker's `v_s ≥ R` and the round
trip keeps j frames moving: W 505 MB/s at S1 1×, 110 at S1 4× (the copy and the round trip included; v_s alone not
measured).

**C with shared memory.** The view thread posts the `SharedArrayBuffer` itself; the store worker writes from it (the
sync handle's `write` takes `AllowSharedBufferSource`, §4). A frame is written once and never changed after its post,
so the shared bytes need no lock. Script copies a frame: 2, as A paint first. Its region:

* on time iff the post `x_post ≲ 4 ms`: ~0.1 ms predicted (§Predicted), **not measured**; as `none` if it holds;
* keeps up iff `v_s ≥ R` on the store worker's thread, sharing the CPU with the decoders and the paint;
* **memory**: a frame posted to the store worker stays resident until that worker's isolate collects it, which M2
  measured not within 30 s ([who owns a frame's memory](frame-memory-ownership.md): 2.4 GB resident after a 2 GiB fill). That, not the API, is why
  the copy is there (`client/view/cache.js:52`). "Written once" does not answer it. Its fixes are a fixed ring of slots
  the decoders write into (`docs/ARCHITECTURE.md` §Open, *one preallocated shared store per fill*), which is structural,
  or a measurement that the store worker does collect when it drops each buffer after the write.

**D.** Each decoder writes its frame to its own file, then posts it. Fixed: a file per frame (the packed file's lock
admits one writer); write before post; N = 3; the handle calls in series with the decode; the bar of rule 3.

* **On time** as `none`: the view thread does nothing for the cache (measured: as `none` in every counted L and G cell).
* **Keeps up** iff `N · s / (d + h + w) ≥ R`, that is `h + w ≤ N · s / R − d`, the decoder's slack. With h overlapped
  with the decode, `w ≤ N · s / R − d`.

  | | N · s / R | − d | slack | h + w (L) | |
  | --- | --- | --- | --- | --- | --- |
  | S1 1× | 12.6 ms | 3.1 | 9.5 | 3.1 | inside |
  | S1 4× | 12.6 | 14.6 | −2.0 | 4.0 | decode-bound already: the fill slows from 108 to 84 MB/s |
  | S2 1× | 409 | 47 | 362 | 83 | inside |
  | S2 4× | 409 | 210 | 199 | 305 | **outside**: 3 × 17.0 MB / 515 ms = 99 MB/s (a saturated cell: no claim) |
  | S3 | 654 | not measured | — | 130 at 1× | unknown |

* **Rule 3's bar**, `w + max(0, h − d) ≤ 0.10 · d`, judged only where `N · s / d < R` (S1 4× alone here), accepts a
  fill up to ~10 % slower where it is already decode-bound, and looks nowhere else. The slack inequality is the
  quantity the bar stands for: it judges every cell, and finds S2 4× outside, which the bar does not see. The 0.10
  itself is a choice of how much fill time a cache may cost, and is the owner's.
* **Write before post** puts h + w ahead of every frame's arrival, the first one included: 3–4 ms at S1, 50–80 at S2
  on this host. No rule times it. Posting first and writing after costs the decoder the same clock and one message more
  (the frame no longer arrives written).
* **A file per frame against one packed file:** a file per frame admits N writers and makes B possible, and pays per
  frame a handle pair, a capacity request (a new file has none) and a close, and per miss a handle opened (R: D 35.3
  ms against A's 28.8 at S2, 47.6 against 40.1 at S3). A packed file pays its handle and its capacity once (`truncate`
  at open) and admits one writer. Chromium alone ships `mode: "readwrite-unsafe"` (§Arm D, (g)): N decoders on one
  packed file, the handle and capacity paid once per decoder. Ruled out before as a second path for two engines of
  three; **with Chromium first, it is admissible as Chromium's path**, not measured.

**The rule itself.** Rule 2 asked that the queue of unwritten frames not grow across the fill: the largest backlog in
the last third of L's ticks no more than 2 frames over the first third's. What a queue costs:

* **Memory, only past the window.** A queued frame is a frame the store holds anyway. It costs memory only if the
  store would have evicted it; the product's store keeps such a frame until its write settles (`client/view/store.js`
  `put`). The rig, holding every queued frame, does not tell the two apart.
* **No wrong frame and no miss.** A queued frame is in memory; one unwritten when the tab closes is fetched again
  next time, and every read is re-checked (§5). A cost in network, not correctness.
* **Frames, not bytes.** "2 frames" is 1 MB at S1 and 55 MB at S3.

Writes can continue after the fill, and in the rig they already do: the cell waits up to 40 s for the queue to drain,
and those ticks are in its last third. After a fill the view thread mostly paints without upload, so the drain runs
faster than during it. The requirement the costs ask for is in bytes: with W the write rate during the fill, Z the
series' bytes and M the memory a tab may spend past its window,

* the queue's peak is `(1 − W / R) · Z`, and must satisfy `(1 − W / R) · Z ≤ M`, that is **`W ≥ R · (1 − M / Z)`**;
* it drains after the fill in `(1 − W / R) · Z / W_idle`, with W_idle the rate of a tick without upload.

S3 1× Chromium, A paint first: W = 104, a 1.25 GB fill: a peak of 210 MB, 8 frames (**measured 8**), drained in
~1.1 s at the 189 MB/s of three 1 MiB pieces a tick. Over the 13 GiB series of §Writing a multi-GB series, the same
W gives a 2.3 GB peak. So **"bounded across the fill" is right for a series larger than M and stricter than needed
below it**; the bound that decides is `W ≥ R · (1 − M / Z)`, which needs M, an owner's number not yet set.

**The measurement per arm that would most change the decision, cheapest first.**

1. **A paint first:** per tick, the paint's time and each piece's, recorded apart, in one L cell at S3 1× (`none` and
   A paint first). It fixes Pᵤ and t_q's tail, the two inputs of both its inequalities, and says whether "what is left
   of the tick" is inside its region. A few fields in `view.js`; minutes of run.
2. **C with shared memory:** the store worker's resident memory across and after a 1 GB fill when it is posted the
   shared buffers, with the post's cost on the view thread. If it collects, C keeps the packed file at no view-thread
   cost; if not, it needs the slot ring. A new arm of ~10 lines; one L cell.
3. **D:** the product's fill time with `?writer=decoders` against `none` at S1 4× and S2 4×, in the real decoders. It
   measures the slack inequality's two sides at once, where the run's feeders, which do not decode, could not.
4. **B:** its per-file overhead o_B against the writes in flight, at S1. It is last: the rule does not choose B.
5. **A on arrival, C as built:** none. Each is outside its region by arithmetic on measured inputs; each has a
   variant above that is not.

**Firefox, in one paragraph** (a separate, later goal). The inequalities are the engine's; the inputs differ
(`claude/opfs-arms-run:lab/opfs-arms/rows/firefox/`, Firefox 159, period 17.1 ms). A file per frame costs Gecko h ≈ 26 ms and w ≈ 22 ms at
S1, so D's slack, 12.6 − 3.1 = 9.5 ms at S1 1× (d from exactness §3, not Firefox's own), is exceeded five times over: 3 × 0.52 MB / 48 ms = 33 MB/s, measured 30.
The copy out of shared memory is ~3.5× slower than Chromium's (C: 31.5 ms at S2), so C as built is further outside, and
C with shared memory would gain more. A paint first's pieces are 0.54 ms at S1 and 0.7 ms at S2, so the packed file's
sync handle is inside its region at both; its one failure, at S1 1×, is 4 rounds of 8 that left frames unwritten at
the cell's 40 s deadline and one whose queue reached 88 frames, a stall the inequalities do not model (not traced).
Gecko's own block is 1 MiB with a quota round trip each (§4), which is why q = 1 MiB suits it.

### Arm D, amended: C with shared memory, and A on what is left of the tick (2026-11-03, before any data)

**Why.** C lost largely to a copy it did not need: the view thread copies each frame out of its `SharedArrayBuffer`
and transfers the copy (`lab/opfs-arms/view.js`, as `client/view/cache.js:53`), 9.1 ms at S2 and 14.4 at S3 (§Arm D,
Results), outside its region by that copy alone (§Each arm's parameters, *C as built*). The owner approved testing C
without it (C-shared below, the store worker writing straight from the shared buffer). The same section names a cheap variant of A paint first, a budget of what is left of the tick; it is an
arm here too. Chromium only (the owner, 2026-10-31). Nothing below is measured.

**The two arms.**

* **C-shared.** The view worker posts the frame's `SharedArrayBuffer` itself, no transfer list, to the store worker on
  the port the page hands both (a `MessageChannel`, worker to worker); the store writes it with its sync handle from
  shared memory (`client/viewer/store.js` unchanged: `write` takes `AllowSharedBufferSource`, §4). C as built stays,
  C′ its A/A. Copies in script a frame: 2, as A paint first.
* **A-left.** A paint first, with the fixed 8 ms replaced by what is left of the tick: after the paint, a 1 MiB piece
  starts only if *now + the last piece's time* is before *the tick's start + T − g*, with T the period the cell
  measures at its start and **g = 2 ms** (the theory's margin); a tick that writes nothing while frames wait halves the
  guess, so a slow piece cannot stall the queue. Every other value as A paint first.

**A frame's memory does not change before it is written.** No lock guards the shared bytes because nothing writes a
frame's buffer after its post: the decoder takes a new buffer per frame (`client/decode/htj2k.js`, `frameBuffer` per
call; AV1's `av1-frame.js` likewise, by reading, not tested), and neither the view worker nor the store writes into a
frame. *Test:* `client/decode/decoder.test.mjs`, two frames decoded in a row land in two buffers and the first's
samples are unchanged after the second; mutated (one buffer kept across calls), it fails. *Mutant in the rig,*
`overwrite-after-post`: each feeder writes the next field into a fill frame's buffer right after posting it; W's
read-back must then fail on C-shared.

**The theory's parameters, recorded.** Each row now carries P₀ and Pᵤ apart (`paintNoUploadMsP50`,
`paintUploadMsP50` / `P99`), each piece's time under paint first or the post's under the C arms (`blockMsP50` / `P99`
/ `Max`), the store's own time a write, v_s (`storeWriteMsP50` / `P99`, timed in `store-port.js` from the later of the
message's arrival and the previous reply), and the browser tree's PSS growth at its peak and at the cell's end
(`peakGrowthMiB`, `endGrowthMiB`). The store worker's memory alone, which the theory's measurement 2 asks, is not
separable here: the tree is.

**Predicted** (the theory's inequalities; §Predicted's ~0.1 ms post). **C-shared**: the post ≲ 0.1 ms, so L and G as
`none`; W holds 125 MB/s iff v_s ≥ R; memory unknown: M2 saw a posted `SharedArrayBuffer` not collected within 30 s,
which would put C-shared's peak a fill's bytes over C's. **A-left**: on time except where a piece's tail exceeds its
median (S3's worst piece, 14.6 ms); keeps up at S3 1× at ~157 MB/s on paper, with Pᵤ indicative.

**Cells and rounds.** Chromium; L, W, R at S1, S2, S3 × 1×, 4×, and G at S2 × 1×, 4×, one Williams period each
(`lab/order.mjs`): **L** `none`, A paint first, A-left, C, C′, C-shared, D (7 arms, 14 rounds); **W** and **R** the
same less `none` (6 arms, 6 rounds); **G** as L (14 rounds). A on arrival and B are not run: the rule could not choose
them. VOID, saturation and the "≥ 75 % of a cell's rounds" reading as the protocol says. Mutants, each once before its
cell is believed: *overwrite-after-post* and *drop-writes* at W S1 1× on C-shared and C (and A-left, *drop-writes*);
*write-before-paint* at L S3 4× on A paint first and A-left; *late-input* at G S2 1× on `none`, A-left and C-shared.
Rows: `claude/opfs-c-shared:lab/opfs-arms/rows/chromium-c-shared/`.

**The rule, amended again.** Among **A paint first, A-left, C, C-shared and D**: rules 1–3 as amended above, and

5. **C-shared's memory:** in every counted L cell, the median over rounds of its peak PSS growth less C's in the same
   round is ≤ 256 MiB, choice 2's window.

and rule 4 becomes: **D**, if it passes 1–3, unless an A arm passes too and D's miss paints a display period or more
after A paint first's in some R cell; then **A paint first**, then **A-left** (no thread more, and the fixed budget
first, as built); then **C-shared** (one copy fewer than C), then **C**. If none passes, the result goes to the owner as
measured. `lab/opfs-arms/summary.mjs` applies it, and still gives the run before this one its verdict.

**Smoke, 2026-11-03** (one round, L S2 1×, `none`, C, C-shared, A paint first and A-left; not results): every arm ran
to the end, every write read back exact; C-shared's post 0.06 ms a frame.

### Arm D, amended: Results (run 2026-11-03 to 2026-11-04)

**What ran.** The amendment as pre-registered, on the 4-vCPU agent container, Chrome for Testing 153.0.8010.12, decoder
builds checked against `manifest.sha256`: every cell L, W, R at S1, S2, S3 × 1×, 4× and G at S2 × 1×, 4×, one Williams
period each (L and G 14 rounds, W and R 6), and the four mutants once each. Rows: `claude/opfs-c-shared:lab/opfs-arms/rows/chromium-c-shared/`.
The container restarted once, during L S2 4×; that cell's partial rows were discarded and the cell run whole again.

**The mutants.** *overwrite-after-post* caught on C-shared and C, *drop-writes* on C-shared, C and A-left, and
*late-input* on `none`, A-left and C-shared. *write-before-paint* **not caught**: it missed 69 % (A paint first) and 71 %
(A-left) of ticks against 45 % and 38 % unmutated, but under the Σ ⌊block / period⌋ bar (467 of 649, 516 of 602), the
marginal bar the Protocol names, as in the run before. Its cell, S3 4×, is saturated, so no claim leans on it.

**Where the host saturates:** every 4× cell. `none` misses more than 5 % of ticks in L's median round at S1, S2 and S3,
4× (S1 4× was not saturated in the run before). **VOID** (A/A): W S1 1× (C′ / C 0.86). Counted: L, R at S1–S3 1×; W at
S2, S3 1×; G S2 1×: 9 cells of 20. Rule 1's "both throttles" is judged at 1× alone; **nothing is claimed at 4×.**

**Counted cells.** L: median missed share of ticks, % (rounds on time, rounds bounded) of 14; G: input → painted p99 ms
(rounds on time) of 14; W: median MB/s, every arm ≥ 125 in 6 of 6; R: miss p50 ms, every arm 6 of 6.

| | `none` | A paint first | A-left | C | C′ | C-shared | D |
| --- | --- | --- | --- | --- | --- | --- | --- |
| L S1 1× | 0.17 | 0.17 (14, 12) | 0.17 (14, **8**) | 0.50 (7, 8) | 0.33 (10, 8) | 0.17 (14, 12) | 0.17 (13, 14) |
| L S2 1× | 1.34 | 2.67 (**7**, 14) | 2.83 (**7**, 14) | 4.89 (**0**, 14) | 4.54 (1, 14) | 1.82 (**9**, 14) | 1.48 (**10**, 14) |
| L S3 1× | 1.02 | 6.69 (**0**, 11) | 6.00 (**0**, 12) | 7.35 (**0**, 14) | 7.35 (0, 14) | 0.83 (12, 14) | 1.34 (12, 14) |
| G S2 1× | 33.7 | 33.8 (14) | 33.8 (14) | 39.4 (**4**) | 38.6 (5) | 33.8 (14) | 33.7 (14) |
| W S2 1× | | 1158 | 1361 | 433 | 410 | 395 | 639 |
| W S3 1× | | 433 | 404 | 374 | 362 | 426 | 697 |
| R S1, S2, S3 1× | | 16.4, 31.5, 44.9 | 16.4, 32.0, 45.3 | 16.4, 33.0, 49.8 | 16.5, 32.9, 49.8 | 16.4, 33.2, 49.7 | 16.4, 37.1, 48.6 |

**The theory's parameters, measured** (L at 1×, medians over rounds). The post of a shared buffer blocks the view
thread **0.03 ms at S1, 0.06 at S2, 0.05 at S3** (p99 0.08–0.14); C's copy 0.31, 9.2 and 15.2 ms. Pᵤ, the paint with an
upload, **7.9 ms at S2 and 8.8 at S3, p99 15.7 and 16.4**, in every arm alike (`none` included); P₀ 0.01–0.02. A's 1 MiB
pieces 0.32–0.34 ms at S2–S3, p99 0.75 and 4.9–5.6. The store's own time a frame, v_s, **82 ms at S2 (0.21 GB/s) and
10 ms at S3 (2.7 GB/s), p99 118 and 154**, the same in C and C-shared: the store's write varies by cell as the view
thread's did (§Each arm's parameters, *v*), cause still not isolated. **Memory:** the browser tree's peak PSS growth in
L is C-shared's within −26 to +3 MiB of C's in every counted cell (rule 5 passes), and is ~1.25 GB over `none`'s for
every cache arm alike; at the cell's end it has not fallen in any arm. A posted shared buffer held no more than C's
transferred copy here; neither was collected within a cell.

**The verdict, by the amended rule.**

| | Chromium 153 |
| --- | --- |
| **D** | rules 2, 3 pass on every counted cell (rule 3 judges no counted cell: S1 4× is saturated); **rule 1 fails** at L S2 1×: 10 of 14 |
| **A paint first** | **rule 1 fails** at L S2 1× (7 of 14) and S3 1× (0 of 14) |
| **A-left** | **rule 1 fails** as A paint first; **rule 2 fails** at L S1 1×: bounded 8 of 14 |
| **C-shared** | rules 2 and 5 pass, and G, W, R; **rule 1 fails** at L S2 1× alone: 9 of 14 against 11 |
| **C** | **rule 1 fails** at L S2 1× and S3 1× (0 of 14) and G S2 1× (4 of 14) |
| **rule 4** | no arm passes: **to the owner as measured** |

**Against the prediction.** C-shared's post is the ~0.1 ms predicted, and removing the copy moves C from the worst
arm in L to the best with D: at S3 1× 0.83 % of ticks missed against C's 7.35 % and `none`'s 1.02 %, and in G as
`none`. Its one failure is L S2 1×, 0.48 points over `none` at the median, in 5 rounds of 14 past the 1 % bar; D fails
the same cell at 10 of 14, which it passed 8 of 8 in the run before, so **that cell's margin is within this
host's round-to-round spread**, which the rule does not model. The store kept up (W ≥ 395 MB/s; L's backlog bounded).
A-left was predicted on time but for a piece's tail; it misses 6.0 % at S3 1× against A paint first's 6.7 %, though its
measured pieces (p99 5.6 ms) and Pᵤ (p50 8.8) fit inside the 14.7 ms it leaves itself: **its misses are not the view
thread's own blocks**, and what they are (the upload's work after the callback, in the GPU process sharing 4 vCPUs, is
the candidate) is not traced. Memory, predicted possibly a fill's bytes over C, is not: C's copies stay resident as
long as the shared buffers do, so M2's finding holds for C as built too, and the copy does not buy memory back.
