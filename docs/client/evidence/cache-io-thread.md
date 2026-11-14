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
