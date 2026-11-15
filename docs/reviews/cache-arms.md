# Review: the cache arms (CACHE-BUILD-REVIEW, 2026-11-15)

Row CACHE-BUILD-REVIEW of `docs/queue-client-2026-11-14.md` (`claude/work-ledger`): the standing review of
`lab/cache-arms/` at `ac517958` (PR 394) against `claude/cache-plan:docs/client/evidence/cache-plan.md` §3, §7, §8, by a
session that wrote none of it, its design, its advocacy or its protocol. Five independent reads (each arm, the harness),
each reverting code and re-running the arm's test to see it fail; their reports follow, unabridged, after the verdict.

**Fixtures and limits.** A 4-vCPU cloud host, no GPU. Mutants: Node 22 on each test's in-memory engine (which models
no engine's timing). Browser probes, where named: headless Chromium 153 (Playwright), one run per variant, scratch pages
importing the arm unchanged; *observed* there, *theory* elsewhere. No Firefox, no WebKitGTK, no phone. Nothing here is a
CACHE-RUN row.

## Verdict

**Not ready for CACHE-RUN.** Seven blockers, each able to put a wrong row or a wrong verdict into the run; every other
design point of §7.1–7.4 and every §7.5 row has its code line. The six test files pass; `scripts/gate.sh --quick`:
passes at `ac517958` with the link check's two pre-existing paths (`docs/lines/devices.md` 57 and 60, untouched here) set aside locally, its by-name skips (no numpy, pydicom, ingest build, lavapipe, nginx; `--quick`'s absence checks) and the decoders' Docker rebuild not run (no daemon). `scripts/check_lab_absent.sh` passes. The branch touches nothing outside `lab/cache-arms/`, `scripts/gate.sh`
(+7) and `docs/lines/client.md`; the comment budget holds.

| # | where | blocker | evidence |
| --- | --- | --- | --- |
| 1 | `arms/opfs-sync.js:77`, `store-worker.js:37–39` | **reads first never runs**: the write loop's `await serveReads()` yields to microtasks only, so the view's read message is not dispatched mid-frame and a miss waits the whole frame whatever `piece` is; §8.4's piece pilot would compare two identical arms | *observed*, Chromium 153, 64 MiB frame, 2 MiB pieces: 31 calls found 0 reads queued, the read arrived at 208 ms after the 207 ms write; one `setTimeout(0)` before `serveReads` brought it to 6.4 ms. The test's fake `serveReads` always finds reads |
| 2 | `arms/opfs-async.js:50–57, 153, 175, 194–198` | **a refused `write()`/`close()` is lost**: raised only by a later `write`, dropped by `close()`; the frame stays readable from the arm's copy, so the fill's verify passes with it off disk; a refused final close is never raised | *observed* on the mock with the real `store.js`: written 0–3, verified 0–3 exact, on disk 0–2. Q's row passes anyway: `run.mjs:128` checks only the frames present |
| 3 | `arms/cachestorage.js:126` | **the arm holds a handle on the series it evicts**: `list()` `caches.open`s every series' Cache in the store worker, and the space `caches.delete` frees stays held while that handle lives. The smoke's E miss (C stopped at 5 of 20) fits this; the README's amendment to §8.1 "for all four alike" would hide a defect of this build, not of the engine | *observed*, Chromium 153, 100 MiB, no override, 1–2 runs a mode: no handle, usage 0 at once; after one dropped `caches.open("A")`, 100 MiB for the whole 6 s; manifests in a separate Cache, free at once. Same class as 2 at `inflight=3`: a refusal of the last puts is cleared by `close()` (`:130–133`) unreported (minor M1 there) |
| 4 | `page.js:110–114` | **`unwrittenAt5s` is not at +5 s**: the page waits up to the cell's timeout for every frame to be handled, then sleeps at most to last post + 5 s, so a writer 9 s behind reads 0 unwritten (L, Q, T) | read here (`await until(handled …)` precedes the sample); *observed* by the harness reader with a scratch arm whose last write lags 9 s: `unwrittenAt5s: 0`, `allWritten: true` |
| 5 | `run.mjs:119` | **K's `kept` bar is loose**: `present ≥ written − queued − 3`, but queued frames are not in `written` and 3 is fixed, not the arm's writes in flight; an arm can lose frames it reported written and pass | read here; in one smoke run the bar was 24 against 35 written |
| 6 | `cells.mjs`, `run.mjs` | **L's bars against `none` are not computed and `view-copy` cannot be caught**: no row check covers p99 paint delay, and `--mutant` mutates `none` too, so the comparison is mutated against mutated: §8.4 makes L VOID for every arm | *observed* (smoke): the mutant moves `none`'s p99 from ~8.5 to ~15 ms, and no check fails |
| 7 | `page.js:92`, `run.mjs:142`, `cells.mjs:16` | **the floor probe sits inside L's memory window** and only the arms run it, not `none`: IDB's 40 floor puts (~680 MB at S2) and Chromium's late clean-up of the deleted files count in its PSS growth. The build's 1 601 MiB smoke figure includes them | *theory*, from the code's order; fix: the baseline after the floor, or the floor in its own load |

**The seam changes the builders asked this row to judge** (PR 394's body):

* `serveReads` in the write's context (OPFS-SYNC's build): accepted for all four alike, opt-in, harmless to arms that
  never call it; as built it does not work (blocker 1), so the fix is in the store worker's `serveReads` (yield a task,
  then serve), not in the arm.
* A pilot setting to the arm's factory; the floor's median per series (IDB's `writeBufferMs`): accepted.
* *Written* means *handed to the arm* (OPFS-ASYNC, CACHESTORAGE at `inflight=3`): accepted only with blockers 2 and 3's
  class closed: a late refusal must reach the store (thrown by `close()` at the latest, with the store's retry or a
  stop), and the rows must count what is on disk at the end, not what the arm still holds in memory. Without it a
  row's *written* overstates the disk.
* A refused IDB frame keeps its value for the retry; OPFS-ASYNC probes only a new series: accepted (the second is
  OPFS-SYNC's rule).

**Minor** (fix before CACHE-RUN if cheap; else name them in its rows): OPFS-SYNC `piece=2MiB`, the plan's own spelling,
parses as NaN and falls back to whole frames; the README has no *OPFS-SYNC as built*. OPFS-ASYNC: no setting to drop the
probe on an engine that does not refuse before close (§7.2 asks for one); a refusal during the retry of a 15-frame group
commits a full-size file with frame 0 zeroed; its floor rewrites one file at G = 1, so the S1 gap at G = 15 comes out
negative. IDB: `value=buffer`'s extra `scratch.slice(0)` (`idb.js:64`, needed only by the mock, which stores by
reference) biases Gecko's pilot; the read's `readonly` is untested. CACHESTORAGE: the streamed test's pattern repeats
every 256 bytes, so an offset-0 read survives. Harness: R's read time is collected and dropped before the row; O's
reopen time includes the harness's start-up (the fields filled and hashed); `balanced()` is not reported per cell; L at
S2 1× runs 12 rounds only by hand; the delivered-rate bar is against 125 MB/s, not `none`'s; T passes without checking
if tab 2 opens as the writer; R-busy can ask the same frame twice; `no-recheck` is caught only in odd rounds;
the store's eviction looks the Web Lock up rather than taking it `ifAvailable` (a short race, every arm).

**Mutants**, in all (each section's table names them): OPFS-SYNC 25 (19 killed, 3 equivalent, 3 survivors of real
behaviour); OPFS-ASYNC 37 (30, 7 survivors, 2 of real behaviour); IDB 32 (29 behaviour mutants killed, 1 real
survivor); CACHESTORAGE 45 (39, 3 equivalent, 3 real survivors); harness 41 (32 killed; every `store.js` and `ring.js`
rule killed). The builders' own counts are consistent with these.

**Next.** Each blocker is fixed on `claude/cache-arms` by a later firing of its build's row, a failing test first:
1 and 4–7 are the harness's (CACHE-BUILD-HARNESS; 7 also IDB's numbers), 2 OPFS-ASYNC's, 3 CACHESTORAGE's (then E's
smoke again before any amendment to §8.1). CACHE-RUN waits for them.

## OPFS-SYNC

Reviewed `claude/cache-arms` at `ac517958` (the arm's commits `83190ac6`, `a9006373`), against
`claude/cache-plan:docs/client/evidence/cache-plan.md` §3, §7.0, §7.1 as the advocate amended it, §7.5, §8.1–8.4.
The reviewer wrote none of it. Files: `lab/cache-arms/arms/opfs-sync.js` (cited as `arm:N`), `arms/opfs-sync.test.mjs`,
`store.js`, `store-worker.js`, `ring.js`, `view.js`.

**Fixtures.** Mutants: Node 22 on the test's in-memory OPFS, this 4-vCPU cloud host. The one browser run:
Chrome for Testing 153.0.8010.12 (Playwright, headless), a scratch page and worker that import the arm unchanged and
stand in for `store-worker.js`'s `reads` queue and `serveReads`, one 64 MiB frame, `piece=2097152` and whole-frame, one
run per variant. Nothing was run on Firefox, and nothing here is a CACHE-RUN row.

### 1 · Design points against the code

| design point (§7.1 / §7.0 / §7.5) | code | verdict |
| --- | --- | --- |
| writer: the store worker, one `FileSystemSyncAccessHandle` per open series for the session | arm:55 (one handle at open, closed at arm:105) | matches |
| writes "from the ring's slot itself: `write(slotView, {at: i × frameBytes})`" | arm:78–81, `bytes` = `ring.bytes(slot)` (store.js:54) | matches (test line 151 checks the buffer is the slot's own) |
| "in pieces of the pilot's size" | arm:23, arm:75 | matches; pilot `piece` in bytes, default 0 = whole frame |
| layout: "frame i at i × frameBytes, then a 3-int record per frame (min, max, present), one file; the manifest beside it" | arm:28, arm:39, arm:8–19 (`meta.json`) | matches the offsets; min and max are always written as 0 (arm:39), not the frame's min/max. Nothing in the rig reads them (note N1) |
| copies: "one, the engine's into the page cache; none in script" | arm:81 writer, arm:32 reader | matches in the writing tab; the reading tab copies in script (arm:34–35), which §8.1's read-only second tab allows |
| transactions: "none; the record written after its frame, never flushed" | arm:87 after the loop; no `flush` anywhere | matches |
| does it fit: "`truncate(n × (frameBytes + 12))` at `open` of a series not present" | arm:56–58 | matches |
| "a refusal (`QuotaExceededError`, or Gecko's `NS_ERROR_FILE_NO_DEVICE_SPACE`) evicts and retries" | arm:7, arm:59–63 (close, remove, rethrow as QuotaExceededError); retry in store.js:34 | matches |
| reads: "`read(slotView, {at})` into a free slot: no copy in script, no new buffer" | arm:32, arm:90–93 | matches in the writing tab |
| **reads first**: "the writer checks it (`Atomics.load`) after each piece and, if it is not zero, **returns to its event loop**, serves the reads, and resumes the frame at the next piece. A miss then waits at most one piece." | arm:77 → `serveReads` (store-worker.js:37–39) | **differs**: the count is checked, but the write never returns to the event loop. `await serveReads()` yields only to microtasks, so the view's read message is never dispatched mid-frame. Observed, blocker B1 |
| "A frame's record is still written only after its last piece" | arm:87 | matches |
| eviction: "close the handle, then `removeEntry(series, {recursive: true})`; another tab's handle on the victim refuses, so it is skipped" | arm:96; the skipping is done by the store's Web Lock filter (store.js:88–89) | matches what it needs to. `evict` does not close a handle itself, but the store never names the open series as a victim, and on the digest path it closes first (store.js:27–28) |
| 7.0: a slot under a frame not yet written stays held until written | the arm never calls `release`; store.js:61–63 lets go after `arm.write` returns | matches |
| 7.0: the view posts nothing for the cache; the view worker raises the count with `Atomics.add` | view.js:73 (`ring.readAsked`) before the post | matches |
| 7.5 no store: "`getDirectory()` rejects: no cache" | arm:5, arm:44; store.js:35 | matches |
| 7.5 does not fit (amended to "at open") | arm:56–64 | matches |
| 7.5 disk fills mid-fill: "a write throws: evict one, retry once, else stop writing" | arm:80–84 rethrows as quota; store.js:57–58 | matches |
| 7.5 Chromium private window: "caches what fits" | no arm code; mid-fill rule | matches (by the rule) |
| 7.5 origin emptied: "no manifest: a fresh fill" | arm:53, arm:56 | matches |
| 7.5 store vanishes: "a read throws: a miss" | arm:32 throws; store.js:73–77 | matches |
| 7.5 two tabs, as §8.1 amends it ("a second tab reads what is present and writes nothing", by `getFile()`) | arm:31–36, arm:67, arm:95 | matches |
| 7.5 damaged frame: "the re-check fails: clear its record, ask again, report" | arm:95 (`drop` = record not present); store.js:82 | matches |
| §8.4 pilot: "the write piece, the whole frame or 2 MiB"; the default is the whole frame | arm:23 | matches; but `piece=2MiB` parses as NaN and silently falls back to the whole frame (minor M2) |
| §8.2 floor: "20 writes then 20 reads of the cell's frame from a ring slot by the raw API only (OPFS-SYNC `write`/`read`)" | arm:116–138; slots from store-worker.js:101–105 | matches (§3 below) |

**Files touched.** `83190ac6` adds the arm and its test. It also changes shared harness files: `page.js` and `run.mjs`
(the `--pilot` passthrough), `store-worker.js` (`serveReads`), `store.js` (passes `serveReads` on), `store.test.mjs`
(+1 check), `scripts/gate.sh` and `README.md`. The status file declares these as "Seam changes, opt-in, for all arms
alike", and they do not change any other arm's behaviour. `a9006373` touches only `docs/lines/client.md`. The README
has no "OPFS-SYNC as built" section, although the other three arms each have one (minor M3).

### 2 · Mutants (each reverted after; `git status` clean at the end)

| # | file:line | change | result |
| --- | --- | --- | --- |
| M1 | arm:58 | truncate at open deleted | killed ("sized at open") |
| M2 | arm:56 | truncate on every writer open, not only a new series | survived. Equivalent: same size, no growth |
| M3 | arm:81 | piece offset `+ off` dropped | killed |
| M4 | arm:77 | `serveReads` between pieces deleted | killed |
| M5 | arm:77 | `off > 0` → `off >= 0` (reads let in before the first piece) | killed |
| M6 | arm:87 | record written before the frame | killed |
| M7 | arm:85 | short-write check deleted | killed |
| M8 | arm:7 | Gecko's refusal not renamed | killed |
| M9 | arm:83 | write's refusal rethrown raw | killed |
| M10 | arm:62 | a refused series left on disk | killed |
| M11 | arm:60 | handle not closed after a refused truncate | killed |
| M12 | arm:92 | present flag not checked on read | killed |
| M13 | arm:93 | short read accepted (`>= 0`) | survived. Near-equivalent: the truncate keeps the file whole and the re-check above the seam catches the rest |
| M14 | arm:32 | the writing tab reads by `getFile()` instead of its handle | **survived, a real behaviour**: R-idle, R-busy and O would time `getFile()` + `arrayBuffer()` + a copy in script, not §7.1's read (minor M1) |
| M15 | arm:95 | the reading tab's `drop` not guarded | killed |
| M16 | arm:66 | `lastOpen` not stored | killed |
| M17 | arm:105 | `close` leaves the handle open | killed |
| M18 | arm:125 | the floor writes `bytes.slice()`, not the slot | **survived**: the floor test checks length only, not the buffer (minor M1) |
| M19 | arm:125 | an extra `getSize()` call in the floor's timed loop | killed only because the mock has no `getSize` (it crashed). No assertion guards the timed region, so count this as survived |
| M20 | arm:135 | floor file not removed | killed |
| M21 | arm:28 | record offset off by one frame | killed |
| M22 | arm:112 | `damage` changes nothing | killed |
| M23 | arm:67 | a reading tab on a series with no meta not short-circuited | survived. Equivalent: `present` is empty either way |
| M24 | arm:48 | `NotFoundError` rethrown | killed |
| M25 | arm:39 | a dropped record still says present | killed |

Totals: 19 killed by an assertion; M2, M13 and M23 are equivalent or near-equivalent; M14, M18 and M19 are real
survivors. The status file's "21 code mutants killed" cannot be reproduced one for one (it does not list them). The
kills above are consistent with it, apart from the gaps below.

**Test gap that matters most.** The reads-first test (test:158–176) gives the arm a `serveReads` that always finds
its reads. It cannot see B1, because the real `serveReads` finds an empty queue: the message has not been dispatched.
`store.test.mjs`'s added check (line 287–297) only asserts that the function is passed through.

### 3 · The floor probe (§8.2)

`floor(bytes, into, count)` (arm:116–138) sets up outside the timed region: the directory, the file,
`createSyncAccessHandle` and `truncate(bytes.length)`. Inside it is only `h.write(bytes, {at: 0})`, then only
`h.read(into, {at: 0})`, with `bytes` and `into` as ring slots (store-worker.js:101–105). That is §8.2's "raw API only".
There are no seam or store calls, no re-check and no copy, and writes are whole-frame whatever `piece` says.
**Matches.** One note (N2): every write after the first overwrites the same, already-allocated page-cache pages at
offset 0, while the fill writes new offsets of a sparse, truncated file. The median of 20 is therefore a rewrite, which
is probably cheaper than a fill's write, so the L/W gap may hold allocation cost as well as layout cost. This is
theory, not measured; the same caveat applies to any arm whose floor rewrites one key.

### 4 · Findings

#### Blocker

**B1. Reads first does not happen: a read posted during a write waits for the whole frame, whatever `piece` is.**
*Observed* (fixtures above). arm:77 checks `readsWaiting()` (the shared count the view raises at view.js:73) and
awaits `serveReads()` (store-worker.js:37–39). That function serves `reads`, a queue filled only by the worker's
`onmessage` (store-worker.js:144). An `await` on an already-resolved promise runs microtasks only. Between pieces the
write never returns to the task queue, so the view's message is not dispatched until the frame ends. `serveReads`
sees an empty queue at every piece and returns.

Run on Chrome 153, a 64 MiB frame in 2 MiB pieces, a read posted just before the write: `serveReads` was called 31
times, each time with `reads queued=0`, and the read message was dispatched at 208 ms, after the write (207 ms). The
whole-frame run gave the same result (202 ms). With one `await new Promise(r => setTimeout(r, 0))` added when the
count is non-zero but the queue is empty, the message was dispatched at 6.4 ms, after the first piece, and was served
mid-frame.

The design asks for the write to "return to its event loop" ("returns to its event loop, serves the reads, and
resumes the frame at the next piece. A miss then waits at most one piece."). The code does not do this.

*Consequence in CACHE-RUN*:
* The §8.4 pilot ("2 MiB wins if its miss p99 at S2 during a fill is lower …") compares two configurations that behave
  identically for a miss. It will pick the whole frame for a reason that is the harness, not OPFS.
* R-busy will show "+21 / +33 ms whole-frame" against the prediction "within ~5 ms of R-idle with 2 MiB pieces".
  §8.3 would record the design's reads-first claim as refuted when it was never run.
* The same holds on Firefox (HTML event-loop semantics), in theory; not run.

*Fix*: in `serveReads`, or in the arm, wait for a task when `readsWaiting() > reads.length`. A `MessageChannel` ping
or a `setTimeout(0)` would do, looping until the queue holds the counted reads or a short bound passes. Add a test
whose `serveReads` sees only what a real `onmessage` delivered: in a Node `worker_threads` port, a message posted
during the write must be served before the last piece. Also note that once this is fixed, `doWrite`'s busy time
(store-worker.js:63–66) includes the reads served inside a write. The pilot's "write cost a frame within 10 %" and L/R
gap figures should subtract them.

#### Minor

* **M1. Test gaps on the arm's two hot paths** (M14, M18, M19 survived). Nothing asserts that the writing tab reads
  through its handle into the slot (arm:32), so moving reads to `getFile()` would silently change R and O.
  Nothing asserts that the floor writes the slot's own buffer or that its timed loop holds only `write`/`read` (arm:122–131).
  The fake `read` could log its view as the fake `write` does, and the floor test could check
  `disk.log.every(w => w.buffer === f.buffer)`.
* **M2. A mistyped pilot setting gives the default with no warning** (arm:23). `piece=2MiB`, the spelling the plan
  uses ("the whole frame or 2 MiB") and the spelling OPFS-ASYNC's own pilot takes (`group=8MiB`), gives `Number` →
  NaN, so `piece > 0` is false and the frame is written whole. The pilot's 2 MiB variant would then be a second
  whole-frame run, a tie, and "a tie within 10 % keeping the first value" makes it the whole frame. Fix: accept
  `2MiB`, or throw on a value that is not a positive integer and not absent.
* **M3. No "OPFS-SYNC as built" section in `lab/cache-arms/README.md`.** The other three arms have one. The pilot's
  spelling (`--pilot piece=BYTES`) was in the README usage line in `83190ac6` and is now only in run.mjs:4 and
  arm:21. CACHE-RUN reads the README for the pilot strings.
* **M4. A meta write refused after the truncate leaks the handle** (*theory*, arm:55–66). If `writeMeta` throws
  `QuotaExceededError`, the frames handle stays open and `handle` is non-null. For example, when the truncate took the
  last room and `meta.json` (digests list, several KB at 256 frames) does not fit. The store evicts and calls
  `arm.open` again, whose `createSyncAccessHandle` on the same file throws `NoModificationAllowedError` against this
  tab's own lock: no cache, where one eviction would have made room. The sized file with no meta then lists with
  `lastOpen` 0 and is evicted first next time. Unlikely in E (quota 1 300 MiB, 520 MiB series); possible near Q's
  edge. Fix: close the handle and remove the series on any error between arm:55 and arm:66.

#### Notes

* **N1.** The record's min/max are 0 (arm:39). The product's layout carries them, and nothing in the rig reads them.
  This is harmless here, but an O/K row is not a test of the product's records.
* **N2.** The floor's overwrite-in-place, §3 above (theory).
* **N3.** The writer's `open` writes the new meta (arm:66) before the store compares digests (store.js:25). A store
  whose evict then failed would leave old frames under a new digest list. The re-check would catch each one as
  damaged, never as a wrong frame. Today the store closes and evicts right after, so this is theory only.
* **N4.** An unreadable `meta.json` (`readMeta(...).catch(() => null)`, arm:53) is treated as a new series. The truncate
  is then a no-op, the old records are kept but `present` is reported as empty, and the fill rewrites everything. This
  is correct, but a torn meta from a kill during `open` would show as a full refill, not as a K failure. Theory.
* **N5.** `NS_ERROR_FILE_NO_DEVICE_SPACE` as the name Gecko throws from `truncate`/`write` is taken from the design.
  This review did not check it on Firefox. If Gecko throws a `QuotaExceededError` DOMException, arm:7 is simply unused.

## OPFS-ASYNC

The reviewer wrote none of this build. Reviewed at `origin/claude/cache-arms` `ac517958`, in a detached scratch worktree.
The arm's commits are e1b8cefb, 1ab1ddac, 856dadc8 and a781f7ee. I read the plan's §3, §7.0, §7.2 (with the
advocate's amendments), §7.5 and §8.1–8.4 at `claude/cache-plan`. I also read the README (§The seam, §OPFS-ASYNC as
built), `store.js`, `store-worker.js`, `page.js`, `cells.mjs` and the `run.mjs` checks.

**Fixtures and limits.** Everything below was checked in node 22 against the test's in-memory OPFS (`Disk` in
`arms/opfs-async.test.mjs`) and the real `store.js`. No browser was run. In that mock, a write's bytes are taken a
`setTimeout` tick after the call, a stream does not refuse writes after `abort()`, and `removeEntry` ignores
`recursive`. Each finding is labelled *observed (mock)* or *theory*.

### 1 · Design points (§7.2 as amended, §7.5, §8.1, §8.4)

| point | design (quoted) | code | verdict |
| --- | --- | --- | --- |
| writer: the copy | "the store worker copies the slot into an `ArrayBuffer` of a pool of k" | `opfs-async.js:164–166` (`spare.pop() ?? new Uint8Array`, `copy.set(bytes)`, trailer) | matches |
| writer: buffer reuse | "a buffer is reused only after its `write()` has resolved" | `:59–63` `commit` gives copies back to the pool only after the group's `close()` resolves | differs, stricter, and documented (README "A copy goes back to the pool when its group commits"). The pool is not k but grows to an open group plus the writes in flight (≤ 8 MiB + k frames) |
| slot release (§8.1, which overrides 7.2's "slots stay held until that close resolves") | "a slot is freed once the store holds its own copy" | `:167` `release()` after the copy | matches §8.1 |
| layout: directory per series, G | "G = max(1, ⌊8 MiB ÷ (frameBytes + 28)⌋)" | `:4`, `:121`, `:128` | matches (G is 15 at S1 and 1 at S2/S3 under `group=8MiB`) |
| layout: frame offset and trailer | "frame j of a group at j × (frameBytes + 28), its samples then `frame-file.js`'s 7-int trailer" | `:72` position; `:129` `Int32Array.of(0,0,w,h,16,1,0)` (frame-file.js order: min, max, width, height, bits, components, signed) | matches |
| one writable a group, no `keepExistingData` | "written by one writable, once, without `keepExistingData`" | `:69` `createWritable()` | matches |
| copies | "in script one (slot → buffer)" | `:165` | matches |
| transactions | "each group commits at `close()` … a group is whole or absent" | `:73` close on the whole frame after the earlier writes; `:196` a short group is aborted | matches |
| read of a frame in an open group | "answered from its held slot" (§8.1: from the store's copy) | `:175` from `copies` | matches §8.1 |
| does it fit | "at open, a probe: `createWritable()` on a probe file, `truncate(n × (frameBytes + 28))`, then `abort()`; a refusal evicts and probes again" | `:103–114`, called only `if (!before)` at `:144`; the eviction and the next probe are the store's (`store.js:33–36`) | differs: only a new series is probed. Documented (README, 856dadc8) |
| probe dropped where an engine does not refuse before close | "the probe is dropped for an engine that does not refuse before close" | no setting | missing; see minor m5 |
| reads | "`getFile()`, `slice()` of the frame, `arrayBuffer()` … copied into a free slot; or `createSyncAccessHandle()` … `read(slotView, {at})`" | `:85–100` | matches |
| present at open | "a group file present holds all its frames; any other name is removed" | `:136–142` (size check; removal only in the writer) | matches |
| manifest | "the manifest beside" | `:8`, `:11–15`, `:145` `meta.json`, `lastOpen` on every writer open | matches |
| eviction | "`removeEntry(series, {recursive: true})` after the series' Web Lock is taken with `ifAvailable`" | `:185`. The lock is the store's (`store.js:88`, held names, not an `ifAvailable` take) | arm matches; the lock is store-wide |
| pilot settings and defaults | "G, 1 or the 8 MiB group … writes in flight, 1 or 3 … the read, `getFile()` or a sync handle"; "a tie within 10 % keeps the first value" | `:20–22`; defaults `group=1`, `inflight=1`, `read=file` | matches (the defaults are the first values) |
| 7.5: no store | "`getDirectory()` rejects: no cache" | `:5`; the rejection reaches `store.open`'s catch | matches |
| 7.5: does not fit | "the probe refused at open: the rule" | `:107–111` removes the new series' directory and throws `QuotaExceededError` (Gecko's name mapped, `:7`) | matches |
| 7.5: disk fills mid-fill | "`close()` rejects: the same" (evict one, retry once, else stop writing) | `:50–57`, `:153`, `:162`, the retry at `:154–160` | differs: a refusal is thrown only by a later `write`, so a refusal of the last ops is never thrown. A refused frame also stays readable from its copy. See blocker B1 |
| 7.5: Chromium private window | "the same" | nothing in the arm | n/a |
| 7.5: origin emptied | "no manifest: a fresh fill" | `:121`, `:131` | matches. A directory with group files but no `meta.json` still counts them present in the writer (`:132` guards only the reader); see note n3 |
| 7.5: store vanishes while open | "a read throws: a miss" | `:177–182` rethrows anything but `NotFoundError`; `store.js:75` makes it a miss | matches |
| 7.5: two tabs | "the Web Lock is held: no cache"; §8.1: the second tab reads and writes nothing | `:152`, `:184`, `:132`, no removal in a reader `:141` | matches §8.1 |
| 7.5: a damaged frame | "delete its group's file, up to G frames" | `:184` | matches |
| test lever (cell K) | "one byte of a present frame changed through the arm's own API" | `:199–208` writable with `keepExistingData` | matches |
| floor (§8.2) | "OPFS-ASYNC `createWritable`…`close` and its read" | `:211–241` | matches §8.2's words; see §3 below |

**Files the build touched** (`git log --stat origin/claude/docs-client..origin/claude/cache-arms`):

* `arms/opfs-async.js` and `arms/opfs-async.test.mjs`
* `lab/cache-arms/README.md`: its own §OPFS-ASYNC section and the test command line
* `scripts/gate.sh`: one `run` line for the test
* `docs/lines/client.md`: its own clause

The build touched nothing else, so it **matches** the "touches nothing else" rule.

### 2 · Mutants

Each mutant was applied to `arms/opfs-async.js` alone, one at a time, then `node lab/cache-arms/arms/opfs-async.test.mjs`
was run and the file restored. **37 mutants: 30 killed, 7 survived.**

| # | file:line | change | result |
| --- | --- | --- | --- |
| 1 | :167 | `release()` after `put` and a 5 ms wait | killed ("the slot let go once copied, before the write runs") |
| 2 | :164 | one buffer for every frame | killed ("an open group's frames read exact from the arm's copies") |
| 3 | :67 | copy pushed back to the pool when its write is issued | killed (same) |
| 4 | :128 | G always 1 | killed ("an open group: nothing committed") |
| 5 | :72 | position 0 | killed ("the group commits whole …") |
| 6 | :166 | no trailer | killed ("the trailer is frame-file.js's 7 ints") |
| 7 | :41 | `>=` → `>` in `room` | killed ("inflight=1 … saw 2") |
| 8 | :41 | `room` never waits | killed ("saw 12") |
| 9 | :73 | close without `Promise.all(before)` | **survived** (equivalent in the real API: a stream's close is queued after its writes) |
| 10 | :73 | close without the `g.writable === w` guard | **survived** (untested: no test closes a group after a sibling's refusal; the mock's aborted stream still accepts writes) |
| 11 | :139 | present without the size check | killed |
| 12 | :141 | other names kept | killed ("the stale swap and the short group removed") |
| 13 | :144 | no probe | killed ("does not fit") |
| 14 | :144 | probe at every open (as before 856dadc8) | killed (uncaught `QuotaExceededError`) |
| 15 | :109 | refused probe leaves the series directory | killed ("nothing left") |
| 16 | :112 | probe not aborted | killed ("the probe leaves nothing behind") |
| 17 | :113 | probe file kept | killed (same) |
| 18 | :7 | Gecko's `NS_ERROR_FILE_NO_DEVICE_SPACE` not mapped | killed |
| 19 | :56 | refusal swallowed | killed ("the next write throws") |
| 20 | :159 | retry loop removed | killed ("the retry lands both frames") |
| 21 | :158 | retry never closes the group | killed (same) |
| 22 | :162 | second `throwRefused()` removed | **survived**: a real behaviour (minor m1) |
| 23 | :152 | reader may write | killed |
| 24 | :184 | reader may drop | killed |
| 25 | :196 | `close()` commits short groups | killed ("a group with a gap is aborted") |
| 26 | :195 | `close()` does not drain | killed |
| 27 | :90 | `getFile` size check removed | killed ("the reading tab: a frame of an open group is a miss") |
| 28 | :96 | sync read's size check removed | **survived** (the reading-tab test runs `read=file` only; nearly equivalent, since `read()` returning fewer bytes still fails) |
| 29 | :175 | copies not read | killed |
| 30 | :61 | `commit` keeps `copies` | killed ("a committed group's frames read exact from its file") |
| 31 | :185 | evict without `recursive` | **survived**: a mock limitation hides a real behaviour (minor m4) |
| 32 | :214 | floor writes the shared view | killed (the mock refuses shared memory) |
| 33 | :231 | floor's sync read reads nothing | killed |
| 34 | :238 | floor directory kept | killed |
| 35 | :201 | `damage` always at offset 7 of the file | killed ("damaged: one byte off") |
| 36 | :132 | reader on a directory without meta | **survived** (untested; note n3) |
| 37 | :170 | group whole by count of writes, not distinct frames | killed ("a repeated frame does not complete the group") |

### 3 · The floor probe (§8.2)

`floor` (`:211–241`) times, per write, `createWritable()`, `write(own)` and `close()`. Per read it times `getFile()`,
`arrayBuffer()` and `into.set` (pilot `file`), or `createSyncAccessHandle()`, `read` and `close` (pilot `sync`).

* The copy out of shared memory is made once, before the timed region (`:214`).
* No seam or store work is inside the timed region: no re-check, no size check, no `copies` bookkeeping.

This is §8.2's raw API alone, so it **matches**. Two departures from what the integrated write does, both minor (m3):

* The floor rewrites one existing file `f` 20 times, and its `getFileHandle(…, {create: true})` is outside the timing.
  The arm creates a new file for every group (`:69`). The design names that per-file directory work as the fixed cost:
  "Chromium creates the file, its swap and the move in the sandbox's directory database".
* The floor writes one frame a file whatever G is. Under the pilot's `group=8MiB` at S1, the arm pays one file per
  15 frames while the floor pays one per frame. By the design's own fit ("~17 ms a file plus ~460 MB/s" on Firefox),
  the floor would be ~18 ms a frame against an integrated ~2.3 ms. §8.5(3)'s gap would then be negative.

### 4 · Findings

#### Blocker

**B1. A refused frame is reported written, verified exact from memory, and is not on disk; a refusal of the last ops is
never raised** (`opfs-async.js:50–57`, `:153`, `:162`, `:175`, `:194–198`; `page.js:124`). *Observed (mock).*

How it happens:

1. A refused `write()` or `close()` is held in `refused` until the next `write` throws it.
2. The frame keeps its copy in `copies`, and `read` answers from `copies` (`:175`).
3. `close()` drains the ops, aborts, and drops `refused` without raising it.

Observed with the real `store.js` over the mock, 6 × 0.52 MB frames, the quota cut at frame 3 (scratch `probe4.mjs`):

* The store recorded `written: 0,1,2,3` and `stopped: true`.
* The fill's verify read back 0, 1, 2 and 3, all exact (frame 3 from its copy).
* After close, the series on disk held `0,1,2`.

With no later write, the refusal is lost entirely (scratch `probe2.mjs`): the last frame's `close()` was refused, read
back exact before close, `close()` resolved without error, and the reopen showed only frame 0.

Scenario in CACHE-RUN: **Q** (S2, G = 1). When the ballast takes the room, the refused frame (up to k in flight, and
an open group at G > 1) is reported written and the fill's `verify` reads it back exact. If no victim is found, the
store stops; Q has no other series to evict.

* §8.3 Q's bar is "each written frame exact on reopen". With *written* meaning *handed*, that bar fails every round
  that sees a refusal. Yet `run.mjs:128` checks `reopenExact` only over the frames present, and `checks("Q", fill).exact`
  counts the copy-served read, so the row passes.
* The same mask hides a refusal of the tail in L, W and O (their verify is before `close`).

Fix options (the arm's or the harness's call):

* the arm reports refused indices back, so the store marks them unwritten;
* or `verify` runs after a drain, and reads skip copies of refused groups;
* and `close()` rethrows `refused`.

#### Minor

**m1. A refusal during the store's retry of a group (G > 1) commits a full-size group file with zeroed frames**
(`:154–160`, `:67–74`; the second `throwRefused` at `:162` is untested, mutant 22). *Observed (mock)*, scratch
`probe1.mjs`, `group=8MiB`, `inflight=1`, n = G + 1:

1. Frame G − 1's write was refused.
2. The store's retry re-put frame 0, and that write was refused again: `fail` set `g.writable = null`.
3. The loop went on, `put` opened a new writable for frames 1…G − 1, and the whole frame closed it and `commit`ted.
4. The result was file `0` at its full size `G × SLOT` with frame 0 all zeros, its copies returned to the pool, and
   `groups` without it.

On reopen all 15 frames counted present, and frame 0 read back wrong. The re-check catches it as *damaged*, drops the
group and loses 15 frames the row counted written.

The same path opens if a sibling's refusal lands between `:162` and `:69` (narrow in practice: `fail` runs before its
op settles). Only S1 with the 8 MiB group can reach it, and Q runs at S2, so no counted cell hits it now; a pilot
picking G = 15 for an S1 disk-full cell would.

Fix: in `put`, stop when `g.retry` is set after `room()` (or check `refused`), and never create a second writable for
a group mid-retry.

**m2. W's MB/s for this arm ends at the last frame handed, not the last on disk** (`page.js:84–86`; `write` returns
once issued, `:150`). *Theory.*

* At `inflight=3`, the last ≤ 3 writes and their closes fall outside the window. That is ~5 % of W at S2 (59 frames)
  and ~8 % at S3 (37 frames) against OPFS-SYNC, which writes before returning.
* §8.5 ranks on W at S2 with "a lead counts only at ≥ 10 %", so the bias is under one lead but not negligible for a
  marginal case.
* README states *written* = *handed* but not its effect on W.
* Fix: end W at the arm's drain (`close()` timed).

**m3. The floor understates the per-file cost and ignores G** (§3 above). *Theory.* §8.5(3)'s gap report for this arm
would be inflated at G = 1 (file creation not in the floor) and negative at S1 with G = 15. Fix: create a fresh file
per timed write, inside the timing, and write G frames a file under the pilot's G.

**m4. Eviction's `recursive: true` is untested** (mutant 31 survived because the mock's `removeEntry` ignores it).
*Theory:* without `recursive`, a real OPFS refuses to remove a non-empty directory, and E's sets would fail. The code is
right today. The test cannot catch a regression: the mock should refuse a non-empty directory without `recursive`.

**m5. No way to drop the probe on an engine that does not refuse before close.** The design: "Gecko and WebKit still
**not traced**: the pilot checks them, and the probe is dropped for an engine that does not refuse before close".

* There is no pilot setting for it, and `cells`/`run.mjs` record no such check.
* If Gecko's writable `truncate` succeeds past the quota, E on Firefox records "the refusal at the design's point" as
  failed with no design-sanctioned alternative.
* *Theory* (Gecko not traced; the Firefox smoke was not run, per the status file).

#### Note

* **n1.** A frame given again after its group committed or was dropped (G > 1) opens a new group that can never be
  whole (`:43–46`). Its copy is served from memory for the session, then aborted at close. K runs at G = 1, so it is
  not reached now. *Theory.*
* **n2.** G is not stored in `meta.json`. A series written at G = 15 and reopened at G = 1 is mostly removed by the
  size check, but a last group of one frame (file `k` holding frame 15k) passes the check as frame k. The re-check
  catches it (damaged, not wrong). It only matters for a kept profile across a pilot change. *Theory.*
* **n3.** A writer that finds group files but no `meta.json` (a meta write lost) counts them present with
  `meta: null`, so the store skips its digest check (`store.js:25`). The re-check still guards each read. Untested
  (mutant 36 is the reader-side guard). *Theory.*
* **n4.** On Chromium, `abort()` removes the probe's swap through a posted `RemoveFile`
  (`file_system_access_file_writer_impl.cc` 63, as §7.2 quotes it). Whether its quota is free before the first group's
  writes is not traced. In E (1 300 MiB, 520 MiB a series) a late release could refuse C's first writes, and so could
  the late space after `removeEntry` that README §CACHESTORAGE found for Cache Storage. That one is the harness's, for
  all arms. *Theory.*
* **n5.** `inflight` is parsed with `Number(...)`, so `inflight=0` or a typo gives an unbounded `room` (`:21`, `:41`).
  The pilot JSON is hand-written.
* **n6.** With `read=sync` in two tabs, one tab's sync handle on a committed group makes the other's
  `createSyncAccessHandle` throw `NoModificationAllowedError`, which the store records as a miss with a reason. A
  reader's sync handle on a group the writer is about to open would make the writer's `createWritable` (`:69`) throw a
  non-quota error, which stops the fill (`store.js:58`). The window is narrow: a file exists between
  `getFileHandle(create)` and `createWritable`. *Theory.*

## IDB

Reviewed `origin/claude/cache-arms` at `ac517958` in a detached worktree (since removed), against
`claude/cache-plan:docs/client/evidence/cache-plan.md` §3, §7.0, §7.3 (as amended by the advocate), §7.5, §8.1–8.4.
Files: `lab/cache-arms/arms/idb.js` (160 lines), `arms/idb.test.mjs` (370), plus `store.js`, `store-worker.js`, `page.js`,
`run.mjs`, `cells.mjs` for how the arm is called. Fixtures: node only, run against the test's in-memory IndexedDB fake.
No browser was run, so everything about engine behaviour below is **theory** unless it is marked *observed* (a node run
here) or *build's smoke* (a figure from the README or the ledger, not reproduced).

Baseline: `node lab/cache-arms/arms/idb.test.mjs` passes (*observed*). `scripts/comment_budget.sh` on idb.js: ok.

### 1 · Design points

| point (§7.3 / §7.5 / §8) | code | verdict |
| --- | --- | --- |
| writer: copy the slot into "**one non-shared `ArrayBuffer` it reuses**" | idb.js:62–63 (`scratch` reallocated only when the size changes) | matches |
| `new Blob([scratch])` | idb.js:64 | matches |
| `put` in a `readwrite` transaction `{durability: "relaxed"}` | idb.js:31 (on every transaction, readonly ones too, which is harmless), :46–47 | matches |
| "then calls `commit()`" | idb.js:49 | matches |
| layout: one database, store `frames`, key `[series, i]`, value a Blob | idb.js:3–5, :36–39, :92 | matches |
| store `series`, key `series`, value the manifest (digests, `frameBytes`, shape, last open: §7.0) | idb.js:80 (`{...meta, series, lastOpen}`) | matches. `lastOpen` is written only by a writer's open, which is fine because a series held open cannot be evicted anyway |
| copies: "in script one (slot → scratch); then the Blob's (scratch → Blob), then the engine's" | Blob: idb.js:63–64 | matches for Blob. **Differs for `value=buffer`**: idb.js:64 `scratch.slice(0)` adds a third copy in script, see minor m1 |
| transactions: "one write transaction in flight: the store worker creates the next only at the previous one's `complete`" | idb.js:48–50 (`write` waits for `complete`); store-worker.js:140–151 is sequential | matches |
| "a read posted meanwhile is served first" | store-worker.js:145 (reads come before the next write when a slot is free) | matches. The read still waits behind the one write in flight, which the README states |
| does it fit: "`navigator.storage.estimate()` in the store worker at `open` of a series not present: `quota − usage` below n × frameBytes takes the rule" | idb.js:76–79 throws `QuotaExceededError`; store.js:33–35 evicts and re-opens | matches. On Chromium 153, `estimate()` does not see the quota override, so E and Q get their refusal mid-fill instead (README, *build's smoke*). That amendment is declared for CACHE-RUN |
| reads: "`get([series, i])` in a `readonly` transaction; a `Blob`, then `arrayBuffer()`: a new buffer, copied into a free slot" | idb.js:53–56, :58, :99–106 | matches (readonly is untested: mutant M26 survives) |
| eviction: "one `readwrite` transaction: `delete(IDBKeyRange.bound([s, 0], [s, n]))` on `frames` and `delete(s)` on `series`" | idb.js:30, :114–119 (the upper bound is `Infinity`, not `n`) | matches, and the wider bound is safe |
| eviction: "after the series' Web Lock is taken with `ifAvailable`" | store.js:88 only *queries* the held lock names, then evicts at :92. No lock is taken | **differs** (store-level, all arms): note n1 |
| eviction retry "waits for `estimate()` to show the room, at most 5 s" | store.js:94–97 | matches. Under Chromium's override the wait ends at once (README) |
| present at open: "`getAllKeys(IDBKeyRange.bound([s, 0], [s, n]))`" | idb.js:74 (`n − 1`) | matches |
| 7.5 no store | if `indexedDB` is missing or `open` fails, store.js:33–35 gives no cache | matches |
| 7.5 does not fit | the estimate row above | matches |
| 7.5 "the transaction aborts: the same" (evict one, retry once, else stop) | idb.js:13 rejects with `tx.error`; :93–95 keeps the value; store.js:56–58 | matches. If an engine aborts with `tx.error` null, the fallback `AbortError` makes the store stop writing rather than evict (not traced) |
| 7.5 Chromium private | nothing to build (README records the backend) | n/a |
| 7.5 "no `series` record: the same" (a fresh fill) | idb.js:76–81 | matches |
| 7.5 "a request errors: a miss" | idb.js:99–100 rejects; store.js:73–77 | matches. A closed connection is never reopened: later writes throw `InvalidStateError` and the store stops, which is acceptable |
| 7.5 two tabs, "the same" (the Web Lock) | store.js:19–21; idb.js:87, :108 guard the reading tab | matches |
| 7.5 damaged frame, "delete its record" | idb.js:107–112 (`drop`) | matches |
| §8.1 "a slot is freed once the store holds its own copy" | idb.js:88–89 (`release()` after the Blob is made) | matches |
| §8.1 miss on a frame not yet written, from the store worker's copy | store.js:70–71 (pending slot) | n/a in practice for IDB: no read is served during an IDB write (note n2) |
| §8.2 floor: "a one-`put` transaction and a `get`, plus a `put` of an `ArrayBuffer` beside the `Blob`" | idb.js:136–156 | matches. See §3 below and blocker b1 |
| pilot: "on Gecko only, the value, `Blob` or `ArrayBuffer`; nothing else"; default Blob | idb.js:20 (`value=buffer`, default Blob) | matches. Nothing enforces "Gecko only": run.mjs passes `--pilot` through on any engine (note n4) |
| commits touch only the arm's files | b8da9dc6 idb.js plus store-worker.js:106 (the floor reports the median of every key, a generalisation that leaves other arms unchanged); 248ba66f the test plus one line in `scripts/gate.sh`; 75472e8d / 929bebc4 the README's own section and `docs/lines/client.md`; 04cd9854 the test | matches, with one shared-harness line (store-worker.js) declared in the ledger. Harmless |

### 2 · Mutants (node `idb.test.mjs`, one at a time, restored with `git checkout -- .`)

| # | file:line | change | result |
| --- | --- | --- | --- |
| M1 | idb.js:31 | durability `relaxed` → `default` | killed |
| M2 | idb.js:49 | `t.commit()` deleted | killed |
| M3 | idb.js:50 | `await c` deleted (write resolves before commit) | killed |
| M4 | idb.js:64 | the Blob replaced by `scratch` itself | killed |
| M5 | idb.js:64 | buffer: `scratch.slice(0)` → `scratch` | killed, **but only because the fake keeps values by reference** (m1) |
| M6 | idb.js:88–89 | `release()` moved before the copy | killed |
| M7 | idb.js:88 | the retry ignores the kept value | killed |
| M8 | idb.js:76 | no estimate at open | killed |
| M9 | idb.js:76 | estimate at every open, reopens included | killed |
| M10 | idb.js:78 | `<` → `<=` | killed |
| M11 | idb.js:78 | need one frame, not n | killed |
| M12 | idb.js:74 | `getAllKeys()` with no range | killed |
| M13 | idb.js:30 | evict range `[s,0]..[s,1]` | killed |
| M14 | idb.js:117 | evict keeps the series record | killed |
| M15 | idb.js:108 | a reader's `drop` deletes | killed |
| M16 | idb.js:87 | a reader may write | killed |
| M17 | idb.js:80 | a reader writes the manifest | killed |
| M18 | idb.js:103 | no size check on read | killed (RangeError) |
| M19 | idb.js:131 | damage flips nothing | killed |
| M20 | idb.js:132 | damage always writes a Blob | killed |
| M21 | idb.js:13 | the abort reason is replaced by `AbortError` | killed |
| M22 | idb.js:80 | `lastOpen: 0` | killed |
| M23 | idb.js:145 | the floor's buffer put becomes a Blob | killed |
| M24 | idb.js:153 | the floor leaves its records | killed |
| M25 | idb.js:149 | the floor's read does not fill `into` | killed |
| M26 | idb.js:54 | `get` in a `readwrite` transaction | **survived**: real behaviour (minor m2) |
| M27 | idb.js:71 | open's transaction is `readwrite` | killed (indirectly, through the write counters) |
| M28 | idb.js:62 | a fresh scratch every frame (no reuse) | **survived**: a design point ("one … it reuses"), costing memory and allocation only (note n3) |
| M29 | idb.js:90 | `refused = null` deleted | survived. Equivalent under the store's sequencing |
| M31 | idb.js:125 | `close` keeps `refused` | survived. Equivalent, because `open` resets it (:70) |
| M32 | idb.js:70 | `open` does not reset `refused` | survived. Equivalent, because `close` resets it. Only M31 and M32 together would leak a refused frame into the next series, and the re-check would then catch it |
| M30 | idb.js:144 | slot copy moved inside the floor's timing | survived. Timing is not observable in node; this was a control |

29 of 32 behavioural mutants were killed (M30 is excluded as a control). M26 is the one real gap. The ledger claims "31 code mutants killed", and these results are consistent with that claim.

### 3 · Floor probe (§8.2)

idb.js:136–156 times, in this order: `count` × (one transaction: `new Blob([own])` + `put` + `commit` until `complete`);
then `count` × the same with the `ArrayBuffer` `own`; then `count` × (readonly transaction, `get`, `arrayBuffer()`,
`into.set`). The copy out of shared memory (`bytes.slice()`, :137) happens once, outside the timing. That is the same
convention as `cachestorage.js:142` and `opfs-async.js:214`, so the floors are comparable across arms. There is no
seam or store work and no re-check inside the timed regions. Inside the timed write are the Blob's own copy (part of
the API being priced) and, for the first write only, `connect()` if the database is not yet open (the median hides
it). Two departures, both notes:

* The advocate wrote "the copies are counted in IDB's floor, not hidden" (§7.3, *What the shared input costs it*). The
  write's forced slot → scratch copy is excluded, while the read's forced copy into the slot (`into.set`) is included.
  The gap (integrated − floor) therefore carries one 17 MB copy per write that the floor does not. This is consistent
  across arms, so it is a note, not a difference in kind.
* The floor's effect on the run that follows it: blocker b1.

### 4 · Findings

#### Blocker

**b1 · The floor runs inside L's PSS window and immediately before the timed fill, and only the arms run it**
(page.js:91–92, run.mjs:142–147, cells.mjs:16). *Theory, with a supporting smoke figure.*
`run.mjs` takes `baseline = treePss(pid)` before `load()`, and samples `peak` every 500 ms through the whole page run.
`page.js:fill()` runs `open` and then the floor (`count` = 20) before the feeders start. `cells.mjs:16` sets
`floor: arm === "none" ? 0 : FLOOR`. For IDB at S2, the floor puts 20 Blobs and 20 `ArrayBuffer`s of 17 MB (≈ 680 MB;
≈ 1.09 GB at S3) under distinct keys (idb.js:144–145), all held until `evict("floor")` at the end (:153).

* PSS: on Chromium, each Blob passes through the browser-process blob registry (§7.3's untraced item), and the worker's
  Blob objects live until GC. The floor's transient peak therefore lands in IDB's `pssGrowthMiB`, while `none`'s growth
  contains no floor. L's bar is "≤ `none`'s + its writes in flight × frame + 64 MiB", so a floor peak above about one
  frame + 64 MiB fails IDB's L memory bar on the floor's account, not the fill's. The build's smoke figure (1 601 MiB at
  S2 with Blobs) is reported as "a fill grew", but that figure includes the floor. The 1 601 vs 553 contrast still
  stands, because both pilot values run the same floor.
* Timing: §7.3 traces Chromium's removal of a deleted value's files as a journal cleaned 2–5 s later
  (`kInitialJournalCleaningWindowTime = base::Seconds(2)` … `kMaxJournalCleaningWindowTime = base::Seconds(5)`). The
  floor's eviction of 40 frames' files is therefore cleaned during the first seconds of L's 10 s fill or of W, on the
  same backend, which slows IDB's measured write and inflates its gap. No other arm pays this the same way (CACHESTORAGE
  may, by the README's own late-space note).
* Failure scenario: CACHE-RUN L at S2 1× on Chromium gives an IDB row that fails PSS, and possibly the delivered rate,
  partly because of the probe. That is a wrong verdict.
* Fix, for the harness and alike for all arms: take the PSS baseline after the floor, or run the floor in its own load.
  For IDB, also wait for the floor's space to come back (or use one reused key) before the feeders start.

#### Minor

**m1 · `value=buffer` pays an extra 17 MB copy and allocation per frame** (idb.js:64 `scratch.slice(0)`; also :88/:94).
*Theory, from the IndexedDB spec.* `put` clones its value synchronously, during the call ("Let *clone* be a clone of
*value* … Rethrow any exceptions" in the `put()` steps, via StructuredSerializeForStorage), so the record never aliases
`scratch`. The kept `refused.value` would also stay valid, because nothing writes `scratch` between a refusal and the
store's retry of the same frame (store.js:57: `evictOne` touches only `list`/`evict`). The test's fake stores values by
reference (idb.test.mjs:133), which is why M5 is "killed": the fake demands a copy the real API does not. Design
§7.3 counts "in script one (slot → scratch)" and then the serialization. Scenario: the Gecko pilot (§8.4, a tie within
10 % keeps the first value) compares a Blob against an ArrayBuffer that carries an extra 17 MB memcpy plus a 17 MB
allocation per frame, a few ms at S2 against a write floor of ≥ ~50 ms. That can tip a near-tie toward Blob, and it
inflates the smoke's 553 MiB PSS figure for `value=buffer`. Fix: put `scratch` itself, and make the fake clone on `put`.

**m2 · A read's transaction mode is untested** (mutant M26, idb.js:54). The design's "`get` in a `readonly`
transaction" is what lets a miss start without waiting behind every write already created (IndexedDB 1130–1133, quoted
in §7.3). If `get` regressed to `readwrite`, every test would still pass, and R-busy would queue misses behind writes
across tabs (the T cell). Fix: assert `o.log` modes for a read.

#### Note

**n1 · Eviction does not take the series' Web Lock** (store.js:88–92, all arms). §7.3 says "after the series' Web Lock
is taken with `ifAvailable`". The store queries the held names and then evicts, which leaves a window: a tab that opens
series B between `locks.names()` and `arm.evict(B)` loses its frames while it holds B open (it reads misses, not damage,
since the record goes atomically). E holds B open long before C and D open, so E does not hit this window. The
"two tabs both see the same room" case the advocate names could.

**n2 · §8.1's "a miss on a frame not yet written is answered from what the store worker holds" never fires for IDB.**
`s.pending` holds only the frame being written (store.js:51), and IDB's `write` does not call `serveReads`, so no read
is served while a frame is pending. A miss on a queued frame waits for the write in flight (≤ one), then for IDB, then
misses. That is consistent with §7.3's prediction "up to one frame's write" and is store-level. If a future arm calls
`serveReads` after `release()`, store.js:71 would copy from a slot already given back to the ring and reused, so the
copy would be wrong and fail its re-check as damaged. This is not reachable with IDB today.

**n3 · Scratch reuse untested** (M28). It is a design point the advocate made explicit ("no 17 MB allocation a frame
for the collector"), and it is visible only in memory and GC timing.

**n4 · "Gecko only" for the pilot is a convention**: run.mjs:62 forwards `--pilot value=buffer` on Chromium as well.
The README says so. CACHE-RUN must not commit a Chromium pick.

**n5 · Blob copy and scratch reuse are safe per spec.** File API §3.1, *process blob parts*: "If element is a
BufferSource, get a copy of the bytes held by the buffer source, and append those bytes to bytes." The Blob owns its
bytes once the constructor returns, so reusing `scratch` and calling `release()` at idb.js:89 are both safe. This
matches the design's citation (FileAPI 429–430). It is theory and was not checked against an engine here. The test
(idb.test.mjs:176–188) checks the safety property against node's Blob (*observed*).

**n6 · A writer's open overwrites the manifest before the store compares digests** (idb.js:80, store.js:25–29). If the
browser is killed between that put and `evict`, the next open finds new digests over old frames. The re-check then
reports those frames as damaged and drops them, rather than giving a clean fresh fill. The data stays correct and the
case is rare. No cell exercises it.

**n7 · `damage(i)` on an absent frame throws a TypeError** (idb.js:130, `bytesOf(undefined)`) rather than a named
error. K damages "the first present frame", so this does not arise in practice.

## CACHESTORAGE

Reviewed `origin/claude/cache-arms` at `ac517958`, against
`claude/cache-plan:docs/client/evidence/cache-plan.md` §3, §7.0, §7.4 (as amended by its advocate), §7.5, §8.1–8.4,
`lab/cache-arms/README.md`, `store.js` and `store-worker.js`. The baseline `node lab/cache-arms/arms/cachestorage.test.mjs`
passes; `scripts/comment_budget.sh` passes on the arm.

Fixtures for everything labelled *observed*: Node 22.23 against the test's in-memory Cache Storage (mutants, the
tail-refusal script), and Playwright's headless Chromium 153.0.8010.12 on this cloud container, no quota override,
100 MiB in one `Cache`, 6 s watched after `caches.delete`, two runs per mode (the late-space probe). The cell E link
is *theory*: E itself was not run.

### 1 · Design points

| point (§7.4 / §7.5 / §8) | code (`lab/cache-arms/arms/cachestorage.js`) | verdict |
| --- | --- | --- |
| writer: `cache.put(base + i, new Response(body))`, key a string, no `Request` | L34, L57 (`putOwn`), L91 (streamed) | matches |
| base: a same-origin path never fetched, `/frame-cache/<series>/` | L3, L35 (series URI-encoded) | matches |
| buffered body: "one `ArrayBuffer` per put in flight, reused, the slot copied into it" | L94–95 (pool), L58 (back to the pool when the put resolves) | matches |
| streamed body: "a `ReadableStream` enqueuing the slot's own 1 MiB views" | L5, L9–17; offsets right (`subarray(at, at += PIECE)` takes the old `at` first) | matches |
| slot let go once the arm holds a copy (§8.1); streamed holds until written (§7.0) | L96 `release()` after L95's copy; streamed never calls `release` (store.js's `finally` does) | matches |
| inflight 1 or 3 (pilot), buffered only | L23, L99; streamed L91 awaits its put (one in flight) | matches; `inflight=0` would hang at L99 (not a pilot value) |
| layout: `caches.open("frames " + series)`, a record a frame, the manifest one more JSON record, no header on a frame | L4, L80, L83; `new Response(ArrayBuffer)` sets no `Content-Type` | matches |
| copies: buffered one in script, then the body's at construction | L95, L57 | matches |
| does it fit: "at `open` of a series not present, `navigator.storage.estimate()`: if `quota − usage` is under the series' bytes, evict by the rule and estimate again; else no cache" | L74–78 throws `QuotaExceededError` before `caches.open`; the evict-and-again loop is store.js `open` | matches |
| reads: `match`, buffered `arrayBuffer()` copied into the slot; streamed "each chunk copied into the slot at its offset" | L114–115, L39–43, L45–52 | matches (a short or long body refused) |
| eviction: `caches.delete(name)`, then the estimate again | L120; the wait is store.js `evictOne` | matches the words; **differs in effect**, finding B1: the space is held by the arm's own `Cache` handles |
| present at open: `cache.keys()` | L82, numeric keys only, sorted L84 | matches |
| 7.5 no store / Gecko private | a missing or rejecting `caches` throws at L72; store.js gives no cache | matches |
| 7.5 does not fit | L74–78 | matches |
| 7.5 disk fills mid-fill: "the `put` rejects: the same" (evict one, retry once, else stop) | inflight=1: thrown by its own write (L100–103), retried from its kept buffer (L65, L92–93); inflight=3: thrown by a later write | matches, except the last puts of a fill at inflight=3 (finding M1) |
| 7.5 Chromium private | nothing to build | — |
| 7.5 origin emptied: "no `manifest` record" → a fresh fill | L73 (a reader makes nothing), L81 `before` null | matches |
| 7.5 store vanishes: "`match` rejects or is `undefined`: a miss" | L114–115; store.js `read` catches | matches |
| 7.5 two tabs (§8.1: a reader reads, writes nothing) | L73 (`caches.has` first), L83, L90, L118 | matches |
| 7.5 damaged frame: "`delete` its request" | L118 | matches |
| damage lever through the arm's own API | L134–138 | matches |
| floor (§8.2): "`put` and `match` + read", raw API | L141–156 | matches (§3 below) |
| pilot settings and defaults: "`put`s in flight, 1 or 3; the pair, buffered or streamed" | L22–23: `inflight=1`, `body=buffered` defaults; README §as built says the same | matches |

**Commits** (`git log --stat origin/claude/docs-client..origin/claude/cache-arms`): 2d38383f touches only
`arms/cachestorage.js`; 192a72ea that, `arms/cachestorage.test.mjs` and one line of `scripts/gate.sh` (the test in the
gate); ac517958 `lab/cache-arms/README.md` (its own section) and `docs/lines/client.md` (the line's entry). Nothing of
another arm, the harness or the store. Author `dary-dc`, no trailer or session link in the messages.

### 2 · Mutants

Each applied alone to `arms/cachestorage.js`, the test run with node, the file restored (`git status` clean after).
"crash" = the test threw before its tally, still a non-zero exit.

| # | line · change | result |
| --- | --- | --- |
| M1 | L34 key without the series' prefix | killed |
| M2 | L35 series not URI-encoded | killed |
| M3 | L57 a `Request` as key | killed |
| M4 | L95–97 put the shared slot itself | killed (crash: TypeError) |
| M5 | L94 a fresh buffer each put | killed |
| M6 | L95/96 release before the copy | killed |
| M7 | L96 no release | killed |
| M8 | L99 never wait (inflight ignored) | killed |
| M9 | L99 `>` for `>=` | killed |
| M10 | L100 refusal never thrown | killed |
| M11 | L92 refused frames not retried | killed (crash) |
| M12 | L93 `alreadyTaken` ignored (the slot copied twice) | killed |
| M13 | L59 a refused buffer also returned to the pool | **survived** (see N3) |
| M14 | L107 a read does not wait for its put | killed (crash) |
| M15 | L108 a read ignores a refused frame's buffer | killed (crash) |
| M16 | L5 2 MiB chunks | killed |
| M17 | L14 every chunk from offset 0 | killed (crash) |
| M18 | L14 `slice` (a copy) for `subarray` | killed |
| M19 | L49 streamed read writes every chunk at offset 0 | **survived** (see M2) |
| M20 | L52 no completeness check | killed |
| M21 | L41 a body shorter than the slot accepted | **survived** (see N4) |
| M22 | L76 no estimate check | killed |
| M23 | L76 `<=` for `<` | killed |
| M24 | L74 estimate at a reopen too | killed |
| M25 | L73 a reader makes a `Cache` | killed |
| M26 | L83 a reader writes the manifest | killed |
| M27 | L82 the manifest counted present | killed |
| M28 | L84 present unsorted strings | killed |
| M29 | L81 the new manifest returned as the stored one | killed |
| M30 | L90 a reader's write does not throw | killed |
| M31 | L118 a reader's drop deletes | killed |
| M32 | L118 drop a no-op | killed |
| M33 | L120 evict a no-op | killed |
| M34 | L124 non-series caches listed | killed |
| M35 | L126 `lastOpen` read as 0 | killed |
| M36 | L131 close does not wait for puts | killed (crash) |
| M37 | L136 damage changes no byte | killed |
| M38 | L153 floor's `Cache` not deleted | killed |
| M39 | L150 floor's read not copied into `into` | killed |
| M40 | L142 floor puts the shared view | killed (crash) |
| M41 | L148 an extra copy inside the floor's timed put | survived: equivalent for a test (timing only); checked by reading, §3 |
| M42 | L91 streamed put not awaited | killed |
| M43 | L132 close keeps `refused` | survived: equivalent (open resets it, L70) |
| M44 | L23 inflight default 3 | killed |
| M45 | L70 open keeps `refused` | survived: equivalent (close resets it, L132) |

45 mutants: 39 killed, 3 equivalent (M41, M43, M45), 3 survivors that are real behaviour without a test (M13, M19,
M21). The status file's "33 killed, 2 equivalent" is consistent with M43/M45 as its two.

### 3 · The floor probe (§8.2)

L141–156 times `c.put(key, new Response(own))` and `match` → `arrayBuffer()` → `into.set` alone. The one copy out of
shared memory (`bytes.slice()`, L142) is outside the timing; no seam, store, re-check or pool work is inside it. The
body's copy at `new Response` and the copy into the slot are inside, as they are the raw API's own (the design's
"copies" row). Matches. Two notes, not faults: the floor is buffered only, so if the pilot picks `body=streamed` the
gap includes the buffered/streamed difference (N1); and the floor's own `Cache` handle `c` is live at
`caches.delete("floor")` (L143, L153), so by B1 its 20 frames (546 MB at S3) stay on disk until GC — harmless in the
timing cells, which set no quota.

### 4 · Findings

#### Blocker

**B1 · The arm holds a `Cache` handle on the series it evicts, so the space comes back late: E's row would fail on
this build, not on Cache Storage.** `list()` (L121–128) calls `caches.open(name)` for **every** series to read its
manifest (L126); store.js `evictOne` calls `arm.list()` and then `arm.evict(victim)` in the same worker. The design
says the space "may lag while any `Cache` object for it lives" (§7.4 eviction, ServiceWorker 2353) — and the arm has
just made one.
*Observed* (Chromium 153, fixtures above): with no `Cache` object for A in the deleting worker, usage fell from 100 MiB
to 0 at the first estimate after `caches.delete("A")` (2 runs); after one `await caches.open("A")` whose result was
dropped, usage stayed at 100 MiB for the full 6 s (2 runs), and the same after `caches.match(k, {cacheName: "A"})`
(2 runs) and after opening A and reading a JSON record from it (1 run). With the manifest held in a different
`Cache` (`index`), the space was free at once (2 runs).
*Theory, matching the smoke the README reports*: in E's step C, the put refused at the sixth frame → `evictOne` →
`list()` opens A, B and C → `caches.delete(A)` → A's 520 MiB still counted → the retry refused → writing stops (5 of
20, as observed in smoke); step D's fresh worker holds no handle on A, so "by D the space was back". The README and
the status file put this on the engine and propose an amendment to §8.1's wait "for all four alike"; that amendment
would mask a defect of this arm. A wait that probes the room would also hide it only until GC runs.
*Fix within the design*: never open a frame `Cache` to list — e.g. the manifests in one `Cache` of their own
(`frames-index`, a record per series), so `list()` and `open`'s manifest read touch no series' `Cache`; then rerun
E's smoke before anyone amends §8.1. (The same holds, smaller, for store.js `open`'s digests-differ path: `arm.open`
has opened the series' `Cache` before `arm.evict` deletes it.)

#### Minor

**M1 · At inflight=3 the last puts' refusals are swallowed, and their frames read back exact from memory.**
`close()` (L130–133) settles the puts in flight and then clears `refused` without throwing; a refusal is only ever
surfaced by a later `write` (L100–103). *Observed* (Node, a mock that refuses past one frame): three writes at
inflight=3, none threw; all three `read`s before close returned `true` (from the kept buffers, L108–112); `close`
resolved; one frame was stored. *Scenario*: Q at `inflight=3` with the refusal landing on one of the last two frames:
the store counts them written, never takes 7.5's mid-fill rule for them, `verify` (run before close, page.js) passes
them, and the reopen checks only present frames — the row passes while two refused frames were silently lost. Same
for W/L's *written*. Only the pilot's `inflight=3`, only a fill's tail. Fix: `close` throws (or reports) a non-empty
`refused`; or store.js drains with a final call.

**M2 · The streamed read's chunk offset is untested (M19 survived), and so is a 1 MiB-aligned reordering of write
chunks.** The fixture `pattern(i)` is `(i*31 + k) & 0xff`, period 256, which divides `PIECE` (2^20): every 1 MiB chunk
of a frame is byte-identical, so a chunk written or read at the wrong 1 MiB offset reads back "exact". The mock's
`match` also returns the body as one chunk. The code itself is right (L47–51, L14). Fix the test: a pattern with no
period dividing 2^20 (e.g. `k * 2654435761 >>> 24` mixed with `i`), and a mock `match` that streams in chunks not
aligned to 1 MiB.

#### Note

**N1 · Floor is buffered only.** If CACHE-RUN's pilot picks `body=streamed`, §8.2's gap (integrated − floor) mixes
the API's cost with the body form. README states it; worth naming in CACHE-RUN's gap rows.

**N2 · At inflight=3 a row's write end is when the frame was handed over, not stored** (README says so): W's "last
write" excludes up to two puts in flight, a bias of ~2 frames in ~59 at S2 1 000 MB (~3 %, theory) in favour of
inflight=3 in the pilot — under its 10 % tie rule, but in one direction.

**N3 · M13 survived**: a refused buffer also pushed to the pool is not caught. The code does not do this, and the
current sequencing (retry before any pop) makes the mutant harmless except when a put is refused during
`retryRefused`'s await; a test of "a refusal during the retry" would pin it.

**N4 · M21 survived**: a stored body shorter than the slot is never presented to `read`; the code refuses it (L41)
and the re-check would catch it anyway.

**N5 · A reading tab on a series not present** gets `{present: [], meta: null}` with `cache` still `null` (L73); the
store marks `cache: true` and each read then throws a TypeError at L114, taken as a miss — correct result, a
misleading `why`. **N6** `bodyInto` returns early without `reader.cancel()` (L48), leaving the stream locked until GC.

## The harness

Reviewer: a session that wrote none of it. Scope: ring.js, feeder.js, fields.js, view.js, store.js, store-worker.js,
page.js, run.mjs, cells.mjs, quota-probe.js, ballast.js, arms/none.js, arms/stub.js, store.test.mjs, cells.test.mjs,
the `scripts/gate.sh` lines. Against `cache-plan.md` §3, §7.0, §7.5, §8 (pre-registered).
Fixtures for everything run here: 4-vCPU cloud container, no GPU (SwiftShader), Playwright Chromium 153.0.8010.12,
synthetic 16-bit S1/S2 frames, feeders not decoders, `none`/`stub` (and a scratch `slowtail` arm, below) only,
one round each, sequential: **smoke, not results**. Firefox not run.

### 1 · Departures from §8 as pre-registered

| §8 says | harness does | declared in README? |
| --- | --- | --- |
| 8.3 L: "frames unwritten 5 s after the last arrival" | measured only after `until(handled)` (page.js:110) has waited up to 240 s for every frame to be handled; the +5 s sleep (113) is then 0. *Observed*: a frame written 9 s after its post, `unwrittenAt5s: 0`, `allWritten: true` (blocker B1) | no |
| 8.3 K: "present on reopen ≥ written at the kill − the arm's writes in flight" | `present ≥ written − queued − 3` (run.mjs:119): queued frames are not in `written`, and 3 is fixed, not the arm's in-flight count (blocker B2) | no |
| 8.4 view-copy: "L's delay p99 bar must fail at S2 1× on Chromium" | no row check names it (cells.mjs:215–225) and nothing computes the bars against `none`; `--mutant` applies to every arm in the run, `none` included (run.mjs:62), so the bar against that run's `none` cannot move (blocker B3) | partly: "the bars against `none` are over a round", with no tool that computes them |
| 8.3 L: "delivered rate ≥ 0.95 × `none`'s" | row check is ≥ 0.95 × the configured 125 MB/s (cells.mjs:221) | partly (same sentence) |
| 8.2: "**The gap** = … its miss's read + re-check in R" | the store worker times `readMs` per read (store-worker.js:59) but the row drops `r.reads` (page.js:80–88, 122); only intent→paint and the slot wait reach the row | no |
| 8.3 O: "each arm's reopen: store worker start → last frame read and re-checked" | `fromStartMs` (store-worker.js:97) counts from the worker's time origin, so it includes the harness's own init: the XXH3 module, filling 4 fields and SHA-256 of all 4 (store-worker.js:134–137), ~0.1–0.5 GB of work at S3 that is no arm's | no |
| 8.2: "`balanced()` is reported per cell" | rows carry round/unit/prev; nothing calls `balanced()` | no |
| 8.2: "L at S2 1× runs two periods (12)" | `--rounds` defaults to one period (run.mjs:167); 12 must be passed by hand | no |
| 8.3 E: "the refusal at the design's point (… all at open)" | not checked; only `evicted` per step is recorded | yes for IDB and CACHESTORAGE on Chromium (amendment owed) |
| 8.3 Q, T: "L's shown-frame bar" | state cells run without `none` (8.2's four arms), so the bar's reference is not in the cell; must come from L's `none` | no (follows from §8 itself) |
| 8.3 O: F, the fresh fill over `link_impair.py` | not built | yes |
| 8.6: `estimate()` must report the overridden quota | refusal probe (`quota-probe.js`) instead; §8.1's bounded wait ends at once on Chromium | yes |
| 8.2 OPFS-SYNC′ | the `-aa` suffix | yes |

Matching §8 (read and, where marked, run): sizes S1/S2/S3 and frame bytes; 4 fields; ring 256 MiB; three feeders;
`cineEvery` 1 at S1, 6 at S2–S3; L 125 MB/s × 10 s (S1 n = 4 + 2385, S2 4 + 74); W 1 000 MB on credit; R-idle
16 misses after 32; R-busy and B as L + 16 misses, B's 50/100 ms task on the page thread; O 256 × S1 / 32 × S3, warm a
new tab, cold a new browser on the kept profile; E quota 1 300 MiB, 20 frames, B held in tab 2 then closed, the five
expected sets; K 64 frames, kill at ≥ 32 written, odd rounds damage (*run*: damage reported, 64/64 exact); Q quota =
series + 64 MiB, ballast 1 MiB / 10 ms after the open; T 50 × S2, tab 2 at 20 written (*run*: tab 2 a reader); P 32
frames; Williams order with round, unit and predecessor per row; period 6 / 10 (mirrored) / 4 by arm count; PSS of the
tree, sampled every 500 ms against a pre-load baseline. **The floor probe**: in the same page load, after `open` and
before the held frames and the fill, in that arm's store worker, `count` = 20 writes then 20 reads by `arm.floor`,
median each way, recorded as `row.floor`; none for `none`, O, E, K, Q, T, P.

### 2 · Mutants

**Code mutants**, each applied alone in the scratch worktree, the test run, the file restored. 41 run: 32 killed, 9 survived.

| file: rule broken | test | result |
| --- | --- | --- |
| store.js: re-check skipped on every read | store.test | killed |
| store.js: damaged frame not dropped | store.test | killed |
| store.js: damaged frame not reported | store.test | killed |
| store.js: digest mismatch ignored / not evicted | store.test | killed / killed |
| store.js: evict most recently opened | store.test | killed |
| store.js: evict a series open in a tab | store.test | killed |
| store.js: evict own series allowed | store.test | **survived** (equivalent: own series is also in the open-lock set) |
| store.js: no wait for `estimate()` | store.test | killed |
| store.js: unbounded `estimate()` wait (5 s bound removed) | store.test | **survived** |
| store.js: mid-fill: no evict-and-retry / retry forever / not stopped / exception escapes | store.test | killed ×4 |
| store.js: open's quota refusal not evicting | store.test | killed |
| store.js: second tab writes / second tab takes the write lock | store.test | killed / killed |
| store.js: reader's failed re-check reported damaged | store.test | killed |
| store.js: pending frame not copied from its slot | store.test | killed |
| store.js: slot released twice / never released | store.test | killed / killed |
| ring.js: freed at 2 holders / claim ignores holders / free not counted / reads count not decremented | store.test | killed ×4 |
| ring.js: double release no longer throws | store.test | **survived** (guard untested) |
| cells.mjs: exact ignores notOk / delivered at 0.4× / unwritten < 5 tolerated / damage always reported / reader's `rest` writes uncounted / reader with no count passes | cells.test | killed ×6 |
| cells.mjs: `exact` without `ok > 0` | cells.test | **survived** (it is what fails drop-writes at O and Q's fill, untested) |
| cells.mjs: L 5 s instead of 10 | cells.test | killed |
| cells.mjs: E's set after D `{C, D}`; E's tab 2 never closed | cells.test | **survived** ×2 |
| cells.mjs: S2 `cineEvery` 1; floor count 10; R-idle fill 16; Q 40 frames; K 32 frames | cells.test | **survived** ×5 |

**Rig mutants** (`--mutant`), by code path, and where marked, run (smoke, Chromium 153, one round unless said):

| mutant | caught by | verdict |
| --- | --- | --- |
| drop-writes | W `exact` (verify reads misses); O `exact` needs `read.hits === n`, present is empty | caught (path) |
| no-recheck | K `damageReported` false and `exact` false (SHA-256) — **odd rounds only** | *run*, K S1 stub, 2 rounds: round 0 all pass, round 1 `exact:false, damageReported:false`; unmutated both rounds pass |
| slot-held | L `delivered` (absolute 0.95 × 125) and `exact` (verify gets no free slot) | caught (path); not run (≥ 240 s a row) |
| evict-newest | E only at step 5 (steps 3–4 have one candidate each, so the mutant picks the same) | caught (path) |
| tab-writes | T `tab2.readerWroteNothing` | *run*, T S2 stub: false with the mutant (6 writes), true without |
| view-copy | **no row check**; the bar against `none` is computed nowhere, and the mutant also runs in `none` | *run*, L S2 `none` only, interleaved 2 + 2: p99 delay 8.5/8.9 → 15.3/14.1 ms, missed share 1.7/2.1 → 6.1/6.8 %; every row check still passes (B3) |

### 3 · Findings

#### Blocker

**B1 · `unwrittenAt5s` is not measured at +5 s.** page.js:110–114. `await until(handled, timeoutS·1000)` waits until the
store has handled every frame (up to 240 s), and only then sleeps `min(lastPost + 5000 − now, 5000)`, which is 0 once
the writer was more than 5 s behind. So `unwrittenAt5s` is 0 whenever the writer finishes within 240 s, and
`allWritten` and L's/Q's/T's "nothing unwritten at +5 s" bar pass. *Observed*: a scratch arm `slowtail` (stub, the
last frame's write delayed 9 s), L S1, one round: `unwrittenAt5s: 0`, `checks.allWritten: true`, `writeMBps` 65.8.
Ring backpressure bounds a *sustained* lag (≤ 512 × write time at S1), but a single late stall breaks it: Q's
mid-fill eviction with §8.1's 5 s `estimate()` wait (Firefox, where `estimate()` may see the override), an IDB commit
or `close()` that stalls, an eviction's late space (README §CACHESTORAGE). Fix: sample `progress` at
`lastPost + 5000` before waiting for the rest.

**B2 · K's `kept` check is loose by `queued + 3` frames.** run.mjs:119:
`present >= at.written - (at.queued ?? 0) - 3`. `queued` is frames still waiting in the store worker, not part of
`written`, so subtracting them is a units error; the 3 is fixed, not the arm's writes in flight (§8.3). *Observed* K S1
stub: `written` 35, `queued` 8 → bar 24; the arm could lose 11 frames it reported written and pass. K is the cell that
tests "a killed process keeps committed `relaxed` writes" (IDB, 8.3 predictions): exactly the loss this lets through.
Fix: `present ≥ written − inflight(arm)`, inflight from the arm's pilot settings (1 by default).

**B3 · view-copy cannot be caught as built.** cells.mjs:215–225 has no delay-p99 check; nothing in the rig computes
§8.3's bars against `none`; run.mjs:62 passes `--mutant` to every arm, so in a mutant run `none` copies too and the bar
"≤ `none` + 4 ms" compares mutated with mutated. Per §8.4 "a mutant not caught makes its cell VOID": as built, L is
VOID for every arm. *Observed*: the copy itself is visible (+6 ms p99 on `none`, smoke), so the mutant is sound; the
check is missing. Fix: a summary over a round that computes L's bars against an unmutated `none` (or run the mutant on
the arm only, `none` clean), and name view-copy there. The same summary is owed for "≥ 0.95 × `none`'s" delivered rate
and PSS "≤ `none`'s + …", which no code computes either.

#### Minor

* **R's gap input is not in the row** (page.js:80–88, 122): `served[].readMs` is collected (store-worker.js:59) and
  dropped. §8.5.3 needs "every arm's gap over its floor" for R. Add `r.reads` (or its median) to the row.
* **O's R includes harness init** (store-worker.js:97, 134–137): `fromStartMs` is from the worker's time origin, so
  4 × field fill + XXH3 + SHA-256 of the fields (S3: 109 MB filled, hashed twice, copied once by `.slice()`) are in
  every arm's reopen. Against R/n ≤ 69 ms at S3 (2.2 s for 32) this can move a marginal arm (IDB, CACHESTORAGE are
  "passes if a read ≤ ~0.4 s"). Record a timestamp at the end of init and measure from it (theory: size of the
  overhead not measured; T's S2 tab-2 reopen of 50 frames took 0.65–0.69 s from worker start with `stub`).
* **T passes vacuously if tab 2 opens as a writer** (cells.mjs:223): `readerWroteNothing` is only set when
  `opened.writer === false`; if tab 1 had closed before tab 2 opened, tab 2 is the writer and `tab2` checks all pass,
  and tab-writes goes uncaught. Assert `second.opened.writer === false` in T. (Run: tab 2 was a reader both times.)
* **no-recheck is caught in odd rounds only** (run.mjs:116); a mutant check run with `--rounds 1` passes. Say in the
  README that a mutant run of K needs ≥ 2 rounds, or damage in every mutant round.
* **Test gaps** (§2 survivors): the 5 s bound of the `estimate()` wait; the double-release guard; `exact` needing
  `ok > 0`; E's expected sets and tab-2 close; S2's `cineEvery`, the floor count, R-idle's 32, Q's 50, K's 64 — §8's
  pre-registered parameters are only partly pinned.
* **No `balanced()` per cell and no automatic 12 rounds for L S2 1×** (run.mjs:167): both are §8.2's; undeclared.
* **A pending frame read from a slot already let go** (store.js:79–82, 87, 107, latent): `release()` frees the store's
  hold while `pending` still maps `i → slot`. An arm that both releases early (§8.1) and lets reads in mid-write
  (`serveReads`) would serve a read from a slot a feeder may have reclaimed: a wrong frame, re-check fails, the writer
  reports it damaged and `drop`s a frame being written. No arm does both today (opfs-sync calls `serveReads` but
  writes from the slot; idb/cachestorage/opfs-async release but never call `serveReads`). Fix: `pending.delete(i)` in
  `release`, or copy from the arm's own copy.
* **R-busy's picks may repeat** (page.js:77, 108): `(k · 2654435761) mod span` is a bijection only for span a power of
  two; for `written − held` = e.g. 20, some frames are asked twice and the second is no longer cold in any cache the
  engine keeps. Mild; record the picks.

#### Note

* `floor()` claims two slots without checking −1 (store-worker.js:102–103). Safe now (runs before any frame is fed).
* Feeder stall: `waitFreed(freed(), 50)` reads `freed` after the failed claim (feeder.js:164); a release in between
  costs up to 50 ms counted as stall. Bounded; inflates `stallMs` slightly.
* Floor timed region at the harness level: `arm.floor(slotA, slotB, 20)` alone; the store worker only claims and
  fills slot A before and takes medians after (store-worker.js:100–110). The view worker's rAF keeps running (painting
  nothing) during it: "nothing else running" holds up to that. What is inside each arm's `floor` is the arm reviewers'.
* The two-holder ring is sound as used: claim by CAS, free on the last release, the store's release guarded by
  `held`, the view's by `kept`; a read is served into a slot claimed for the view alone. No double free found
  (mutants above kill both directions).
* `unwrittenAt5s` counts *handled* (written or refused), and for async arms *handed to the arm* (README declares
  the latter).

### 4 · Touches nothing else

`git diff --stat origin/claude/docs-client...origin/claude/cache-arms`: 29 files, all under `lab/cache-arms/`, plus
`scripts/gate.sh` (+7, one step running store/cells/four arm tests; no blank line before the next step) and
`docs/lines/client.md` (+11 −1). Nothing else. `bash scripts/check_lab_absent.sh`: OK (`sh` fails on `pipefail`; the
script needs bash). `scripts/comment_budget.sh`: ok; worst cache-arms file fields.js 0.29 (2 of 7, under the floor of
10), ring.js 0.17, the rest ≤ 0.13. store.test.mjs and cells.test.mjs pass on the tip.


## Fixes (CACHE-FIX, 2026-11-15)

Row CACHE-FIX of `docs/queue-client-2026-11-14.md`, by a session that wrote none of the builds or this review. Each
blocker's test was run against the code before its fix and failed there, then each fix was mutated (each mutant
applied alone, the test run, the file restored). Commits on `claude/cache-arms`: `822b33a9` (harness), `ebee4cbe`
(OPFS-ASYNC), `db671123` (CACHESTORAGE), `208f6ff9` (one-line minors), `21e59ce9` (README).

| # | fix | test (file: claim) | mutants killed |
| --- | --- | --- | --- |
| 1 | `store.js` `readsFirst`: a write that finds the reads count above its queue yields a task (a `MessageChannel` ping, ≤ 20 ms) before serving; the store worker uses it, and the reads served inside a write leave its busy time (`readsMs`) | `store.test.mjs`: a read counted and posted before a write is served between its pieces, through a real `MessageChannel` | no task yield; a microtask instead of a task (2/2) |
| 2 | `settle()` added to the seam (optional; README §The seam): OPFS-ASYNC names a refused group's frames lost and drops their copies; `close()` throws a refusal it finds; the store marks them unwritten and stops; the page settles before its verify, so *written* is what is on disk | `opfs-async.test.mjs`: the last write or close refused, then settle, read, next write, close; `store.test.mjs`: settle and a refused close reach the rows | lost not named; its copy still served; close does not rethrow; close does not settle; a settled refusal thrown again; settle does not stop; close's lost or refusal dropped; settle ignores the arm (9/9) |
| 3 | CACHESTORAGE's manifests in a `Cache` of their own (`frames-index`): `list`, `open`'s manifest read and `evict` open no series' `Cache`; `settle`/`close` as 2 for `inflight=3` (minor M1) | `cachestorage.test.mjs`: list and evict open no series' `Cache`; a refused tail named lost, a miss after, close throws | list opens a series' `Cache`; evict leaves the index record; settle misses one; refused buffers still read; close does not rethrow (5/5) |
| 4 | `cells.mjs` `backlogAt5s`, started beside the fill: waits for the feeders' last post, samples at + 5 s, before waiting for the rest | `cells.test.mjs`: a writer 9 s behind leaves frames unwritten at last post + 5 s | wait for handled first; sampled at the last post (2/2) |
| 5 | `keptOnReopen`: present ≥ written − the arm's writes in flight (`inflight`, 1 by default) | `cells.test.mjs`: 11 lost of 35 fails whatever is queued; 1 and 3 in flight | old bar; default 3 (2/2) |
| 6 | `pageQuery`: the mutant runs in the arm only, `none` clean; `lBars` computes L's §8.3 bars against the same round's `none`, ≥ 75 % of rounds, exact every round, `balanced` per arm, written as the run's `summary` row | `cells.test.mjs`: view-copy's +6 ms fails delay p99; PSS, missed, delivered, backlog and exact each fail alone | mutant into `none`; each bar loosened (delay, missed, delivered, backlog, PSS); exact at 75 %; 75 % → 50 %; 75 % → 100 % (10/10) |
| 7 | `pssGrowth`: the PSS baseline is taken once the page sets `floorDone` (after the floor, before the held frames), for every arm and `none` alike | `cells.test.mjs`: the floor's memory is not in the growth | baseline before the floor (1/1) |

Minors fixed (one line each, a test where one was cheap): OPFS-SYNC `piece=2MiB` is 2 MiB and a misspelt piece
refuses to start (test, failing first); a pending frame whose slot the arm let go is read through the arm (test,
failing first); OPFS-ASYNC m1, a refusal during a group's retry leaves the group to the next retry (test, failing
first, mutated); CACHESTORAGE M2, a test pattern with no period dividing 1 MiB (kills a chunk-offset mutant that
survived the old one); R's read time (`readMsP50`) and O's reopen from the end of the worker's start-up
(`fromReadyMs`) in the rows; T checks that tab 2 opened as a reader (`tab2Reads`); Q checks every written frame present
on reopen (`reopenKept`); README: K's `no-recheck` needs ≥ 2 rounds.

Listed, not fixed (each wants more than a line, or a design call): OPFS-SYNC M1's test gaps (the writing tab's read
path, the floor's buffer) and its missing *as built* section; OPFS-ASYNC m2 (W ends at the last frame handed), m3 (the
floor rewrites one file, ignores G), m4 (the mock ignores `recursive`), m5 (no setting to drop the probe), n1–n6;
IDB's `value=buffer` extra `slice` and the untested `readonly` read; CACHESTORAGE N1–N6 and the digests-differ path,
whose `Cache` object for the series lives on in the arm until collected; the harness's `estimate()` bound, the
double-release guard, E's sets and tab-2 close, §8's pre-registered parameters still partly pinned, L at S2 1× twelve
rounds by hand, R-busy's repeated picks, the store's eviction looking the Web Lock up rather than taking it.

**Smoke after the fixes** (not results; headless Chromium 153, this 4-vCPU host, one run each, sequential): a scratch
page importing OPFS-SYNC and `readsFirst` unchanged, one 64 MiB frame, the read posted before the write: with
`piece=2MiB` served 2.0–2.5 ms into a 30–34 ms write (two runs), whole-frame after the write (two runs). E at S3 with
CACHESTORAGE and IDB: §8.3's five sets on disk and every frame exact, A, B and C evicted at C, D and A again. Q at S2
with OPFS-ASYNC `inflight=3`: frame 30 refused after its write returned, named lost by `settle`, unwritten in the
row, the fill stopped; 30 present on reopen, all exact. L at S1 with `none` and `stub`: the summary row written. No
Firefox, no WebKitGTK, no phone.

The arms' designs are unchanged except CACHESTORAGE's layout (the manifests out of the series' `Cache`), by the
design's own eviction source; the seam gains `settle`, for the two arms whose write returns early.

**Gate after the fixes.** `scripts/gate.sh --quick` passes at `4983fc60` with the link check's two pre-existing paths
(`docs/lines/devices.md` 57 and 60, untouched here) set aside locally, not committed, and its by-name skips (no numpy,
pydicom, ingest build for the Python paths, lavapipe, Xvfb, nginx; `--quick`'s rebuild and absence checks); the six
cache-arms tests run in it. `scripts/check_lab_absent.sh` alone passes. Before it: `client/decode/wasm/build/build.sh`,
`ingest/tools.sh`, wasm-pack and `client/transport/wasm/build.sh`, `fetch_openjph.sh`, `fetch_xxh3.sh`.

## Re-review (CACHE-FIX-REVIEW, 2026-11-15)

Row CACHE-FIX-REVIEW of `docs/queue-client-2026-11-14.md`, by a session that wrote none of the builds, the review or
the fixes: `822b33a9..ec1b3212` against §Verdict. Each fix was undone in the working tree with its test kept, the
test run, the file restored (`git status` clean after each).

**Fixtures and limits.** A 4-vCPU cloud host, no GPU; Node 22 on each test's in-memory engine (no engine's timing).
No browser was run here: blocker 1's mechanism is checked on Node's real `MessageChannel`, blockers 2–3 on the mocks;
the Chromium 153 smoke in §Fixes is CACHE-FIX's, not re-run. No Firefox, no WebKitGTK, no phone.

**Verdict: the seven blockers are closed; one new blocker, in blocker 6's fix (N1 below). Not ready for CACHE-RUN.**

| # | fix undone (test kept) | its test |
| --- | --- | --- |
| 1 | `readsFirst` without its task loop; the task replaced by a microtask | `store.test.mjs` fails both ("the read served mid-write, at piece undefined") |
| 2 | the store's `settle` returns `[]`; the store's `close` swallows the arm's refusal; OPFS-ASYNC's `settle` names nothing, keeps the copy, `close` does not settle or does not throw | `store.test.mjs` fails the first two; `opfs-async.test.mjs` fails all four (miss/hit, close throws, the group files) |
| 2 (m1) | OPFS-ASYNC's `if (g.retry) return` removed | fails ("group 0 never committed with frame 0 missing") |
| 3 | `list()` opens each series' `Cache`; `evict` leaves the index record; `settle` reads a refused buffer; `close` silent | `cachestorage.test.mjs` fails each. `open` reading its own series' `Cache` survives: equivalent (`open` holds that `Cache` anyway) |
| 4 | `backlogAt5s` waits for every frame handled; the sample capped at the last post | `cells.test.mjs` fails both (sampled at 10 001 ms and 1 001 ms, not 6 000) |
| 5 | K's old bar (`− queued − 3`); no slack | fails both |
| 6 | the mutant into `none`; the delay p99 bar dropped; the PSS bar absolute; `exact` at 75 % | fails each. Two survivors: `none`'s row taken from round 0 for every round (the test's `none` rows are identical), and `balanced` forced `true` (not checked by any test) |
| 7 | the PSS baseline before the floor | fails (700 MiB, not 60) |

Also: the six test files pass at `ec1b3212`; `scripts/check_lab_absent.sh` and `scripts/comment_budget.sh` pass; the
diff touches `lab/cache-arms/`, its README, this file and `docs/lines/client.md` only. The gate was not run here
(CACHE-FIX's `--quick` result stands for `4983fc60`; `ec1b3212` adds docs only). `lBars` carries §8.3's L bars as
written (missed + 1 %, delay p99 + 4 ms, ≥ 0.95 × delivered, nothing unwritten at + 5 s, PSS + in flight × frame +
64 MiB, ≥ 75 % of rounds, exact every round), read per bar, each bar's own 75 %; §8.3 also reads as all bars in the
same round. Said here; the protocol's author settles it.

**Blocker**

* **N1 · `lBars` drops an arm's errored rounds** (`cells.mjs`, `rows.filter(… && !r.error)`): `rounds` and every
  share count only the rounds that returned, so an arm that errors (`once`'s catch: a throw, a timeout) in 3 rounds of
  4 and meets every bar in the fourth is `pass: true`. *Observed* on `lBars` itself: four rounds, the arm errored in
  rounds 1–3 → `{"rounds":1, …, "pass":true, "balanced":false}`. §8.5: an arm passes when it meets every bar in every
  counted cell; an errored round meets none. The fix: an errored arm round counts as a round with no bar met (and
  never as exact); a round whose `none` errored judges no arm and is named.

**Minor** (not a wrong verdict by themselves)

* The two survivors above: no test feeds `none` rows that differ by round, or checks `balanced`.
* The PSS baseline is taken when `floorDone` is set; memory the floor leaves behind and the engine frees later in the
  fill (IDB's 40 puts, then `evict("floor")`) lowers the arm's growth below what the fill alone grew, and `none` runs no
  floor. *Theory*, direction only, unmeasured; review §Verdict's other remedy (the floor in its own load) has no such
  term.
* OPFS-ASYNC with `group=8MiB` at S1: a group still short of frames at `close` is aborted (§7.2) but its frames stay
  *written* in the row and readable from the arm's copies until then; only a fill that stops early leaves one (Q runs at
  S2, where G = 1). Count them lost at `close` as `settle` does.

**Next.** By amendment 17 this is the second review with a blocker open: the fix loop stops, CACHE-RUN waits, and the
owner decides whether a third fix round (N1, one line and its test) runs.
