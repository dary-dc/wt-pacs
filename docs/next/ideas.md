# Next ideas

*2026-10-17.* What is still open when the review project closes, one entry per idea, each with a first step. Nothing
here is measured unless it links the measurement. The project that reviews PRs and prepares unified for `main` keeps
#75, #92, #96, #82, #84, #98, #99 and #79; their decisions are not repeated here.

Sources: the handoff of 2026-10-16, the review of PR #104 (unified into `main`), rows 259 and 260, and the audits
merged as #72 ([`adr/disk-access.md`](../adr/disk-access.md) §9 *Next round for the readers*), #77 and #78
([`merge-readiness.md`](../merge-readiness.md) §Third round, §Lab-only code in product directories).

## Disk

### 1. The executor gap on a series larger than RAM

* **What:** do the fill's inline `WILLNEED` and the tile drain stall a co-tenant on a device-bound volume? (row 251's
  finding 6, row 258.)
* **Why:** both waits run on the executor; on a cached file they cost nothing, on a real miss nobody knows.
* **Known:** arms G1 and G2 are built in [#88](https://github.com/dary-dc/wt-pacs/pull/88); the protocol is
  *258 EXECGAP* in §9. It needs a file larger than the host's RAM, so it cannot run in a cloud container.
  `lab/scripts/workstation_run.sh` (row 262, §12) is built and never run.
* **First step:** on Darian's machine, `lab/scripts/workstation_run.sh --plan`, then `--quick`; then #88's arms with
  the same host.

### 2. The fill window on XFS

* **What:** does a window of `max(4 MiB, 2 × frame)` beat 4 MiB for frames past 1 MiB on XFS?
* **Known:** on ext4 it ties (cold fill frames/s ×0.89–1.11, §9 *Measured (row 260)*); it leaves ×0.74–0.94 the
  folios per frame at 16 MB. XFS was not run because `mkfs.xfs` was missing. Branch `claude/wip-260-FILLWINDOW`.
* **First step:** the row 260 grid (`lab/container-bench/readahead.py`, `ROW=260`) on a loop XFS on a host that has
  `xfsprogs`, interleaved as before. If it ties, drop `windowing_two_frames`.

### 3. Tile advice past the slots, on a finer rig

* **What:** advising tile names past the slots cut depth-8 misses to ×0.63–0.91, but the burst wall tied.
* **Known:** the rig's wall resolution was 19–48 %, too coarse to see the prediction's low end (§9 *Measured (row
  259)*). Branch `claude/wip-259-TILEWILLNEED`, flag `--advise-tile-names`.
* **First step:** cut the A/A spread (more rounds, or the device-bound host of idea 1) before running it again;
  otherwise drop the flag.

### 4. Latent read-path faults

* **What:** three faults no test reaches, because a session ends on its first read error (#104 review 3, 4, 7):
  a failed pooled tile read leaves its slot keyed with an empty buffer (`server/src/media/read_path.rs:424`);
  `ring.reap()?` drops completions already taken when a later one errors (`:438`); an abandoned read-ahead frees its
  buffer instead of returning it (`:189`).
* **Why:** the day a read error stops ending the session, the first two become a panic and a hang.
* **First step:** a test that fails one read with the store's test levers and reads the span again; mutate it.

## Clients and transport

### 5. Client edge cases

* **What:** from #104's review, none verified by running:
  `refill: "ask"` on the WASM client can put `requestExactFrame` after `fillFrames` (`client/transport/downloader.js:234`);
  the WASM opening fill asks nothing against `--opening-ask false` (`client/transport/wasm/src/session.rs:554`);
  a throwing `onHead` silently stops the TS stream, while WASM ignores it (`client/transport/ts/frame-session.ts:186`).
* **First step:** one client test per case that shows it, before any fix.

### 6. Transport tuning on real links

* **What:** the old drafts: a larger initial window ([#37](https://github.com/dary-dc/wt-pacs/pull/37)), the refill
  flag #66 replaced ([#38](https://github.com/dary-dc/wt-pacs/pull/38)), asks first under a 6 MiB send window
  ([#39](https://github.com/dary-dc/wt-pacs/pull/39)), `cubic-classify` as default
  ([#40](https://github.com/dary-dc/wt-pacs/pull/40)), a 100 ms initial RTT without the repeated-Initial reply
  ([#41](https://github.com/dary-dc/wt-pacs/pull/41), Darian: "not yet").
* **Known:** #39 and #40 measured as trade-offs; `cubic-classify` fills 3–12× faster under 1–2 % loss but takes share
  on a loaded LTE link ([`transport/transport-conclusions.md`](../transport/transport-conclusions.md),
  [`transport/link-conditions.md`](../transport/link-conditions.md)). Row 237's patch
  (`wt-237-QUINNOUT.patch` in the old project) repeats #41's removal.
* **First step:** decide #41 alone; close #37–#40 as superseded; reopen any of them only with a real link to measure on.

### 7. Where the viewer runs out of memory

* **What:** the page keeps every decoded frame (`merge-readiness.md` T11).
* **Known:** row 273 found no failure up to 8 GiB decoded, which is the dev host's limit, not the page's; the largest
  fixture is 812.5 MiB decoded, so nothing was built.
* **First step:** only when a fixture past 8 GiB decoded is named, run `lab/viewer-ceiling/run.mjs` on a larger host.

## Server and deploy

### 8. WebSocket accept and pack robustness

* **What:** a socket-option failure on one accepted socket sleeps the whole accept loop 100 ms
  (`server/src/transport/websocket.rs:124`, #104 review 2); two packs of the same output share `NAME.partial`
  (`common/series-bundle/src/writer.rs:33`, review 9).
* **First step:** for the first, log and drop that socket instead of sleeping, with a test under `prlimit`; the second
  only if parallel packs of one file become a real use.

### 9. io_uring under SELinux

* **What:** an SELinux-enforcing host refuses io_uring inside the container; the server falls back to the pool
  (`deploy/README.md` §Open).
* **First step:** none until a deploy host is known to enforce SELinux; then try a policy module granting only
  `io_uring { allowed }` before `label=disable`.

### 10. Video containers

* **What:** the theory in [#42](https://github.com/dary-dc/wt-pacs/pull/42), into `main`, not from the review project.
* **First step:** read it against [`av1/`](../av1/README.md) and decide whether it is still a question.

## Belongs to the review project, not here

#104 review 8: comments that name project history (`read_path.rs:85`, `server/Cargo.toml:22`,
`lab_frame_cache.rs:3`), which `CLAUDE.md` forbids. A cleanup before unified goes to `main`.

Lab-only code out of product directories: items O2–O8 in `merge-readiness.md` §Lab-only code, after
[#79](https://github.com/dary-dc/wt-pacs/pull/79)'s move of O1. Under way in the review project.
