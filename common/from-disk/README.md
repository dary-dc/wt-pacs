# from-disk

One way to read a file from the device rather than from the page cache, shared by the PACS receiver's read-backs
(steps 6b and 8 of its ADR, pacs-receiver) and the verify tool's checks (pacs-verify), so the two cannot drift apart.

`open_uncached` writes the file's dirty pages back (`fdatasync`), then drops its cached pages
(`posix_fadvise(POSIX_FADV_DONTNEED)`), then opens it for the caller's reads; `read` does that and reads the whole file.
The write-back comes first because `DONTNEED` leaves dirty pages in the cache: a file just written and not yet synced
would otherwise be read from memory. A read-only mount has no dirty pages, and `fdatasync`'s `EROFS` or `EINVAL` there is
not an error.

What it proves is that the bytes came from the device, not that the device holds them durably: a kill keeps the page
cache, only a power cut loses it. On tmpfs the pages are the storage, so nothing is dropped.

`cargo test -p from-disk` observes both claims rather than assuming them: `mincore` sees no page of a just-written file
resident after `open_uncached`, and `/proc/thread-self/io`'s `read_bytes` sees `read` served by the device. Both need a
real filesystem under the build directory.

## Mutations

Each was made on purpose and the suite run (2026-10-26); every one failed a test.

| broken | failed |
| --- | --- |
| no `fdatasync` before the drop | both tests |
| no `posix_fadvise` | both tests |
| `read` opens the file cached | `a_read_is_served_by_the_device` |
