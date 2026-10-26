# pacs-verify — the store checked from disk

Given a path — one `.sbnd`, one study directory, or a host's root — `pacs-verify` walks it and checks every series
bundle and every study DB under it, reading from the disk rather than the page cache, and writes a report. It is the
verify tool of the PACS receive design (`docs/ingest/pacs-receive-design.md` §3, decided 2026-10-25, on branch
`claude/pacs-design-state` at `e699ed3d`), and the receiver's read-backs (steps 6b and 8) are to run the same code,
`pacs_verify::verify`, over the staged path.

```bash
cargo build --release -p pacs-verify
target/release/pacs-verify /srv/pacs --json /var/log/pacs-verify.jsonl
```

## What it checks

| file | check | fails when |
| --- | --- | --- |
| `*.sbnd` | `open` | the file cannot be opened, or its cached pages dropped |
| | `layout` | through `common/series-bundle`: the file is shorter than a header, the magic is not `SBND`, the version is not 1, an index entry lies outside the data region (a truncated file), or a frame is over the cap a client reads |
| | `frames` | a frame cannot be read back from the device |
| `study.db` | `open` | the file, or its `-wal`, cannot be opened or dropped from the cache; SQLite refuses it |
| | `integrity` | `PRAGMA integrity_check` says anything but `ok`, or cannot run |
| | `groups` | a level's table is missing, or a metadata group's bytes do not hash to the XXH3-64 stored beside them — one failure per group, naming its level and UID |
| the path | `walk` | it does not exist, a directory cannot be read, or it holds no `.sbnd` and no study DB |

Below the given path, `incoming/` (the receiver's packages in flight and staged files) and `*.partial` files are not
stored data and are skipped; given as the path itself, `incoming/` is checked. Symbolic links are not followed.

**The study DB** is the schema in `common/study-db`, the one place the receiver and this tool share: a file named
`study.db` in its study directory, a table per level (`exam`, `series`, `instance`, `private`), each row a metadata
group's `bytes` and its `xxh3` keyed by `uid` (the design state's §4, proposed T1). No receiver exists yet; it writes
through `study_db::create` and `study_db::put`.

## What it does not check yet

* **A frame's bytes.** A version-1 bundle carries no hash of its coded bytes, so a frame whose bytes changed in place
  passes; only its index entry and its readability are checked. The coded XXH3-64 per frame is in version 2, the draft
  target ([`../../docs/disk-layout/target.md`](../../docs/disk-layout/target.md)), which `series-bundle` cannot read
  yet: a version-2 file fails `layout`, and the report says it has no reader. Once a reader exists, `frames` compares
  each frame's XXH3-64 with its entry.
* **Metadata inside a version-1 bundle**, which the target removes.

## The report

Text on standard output: one line per failure, `FAIL <path> <check>: <details>`, then
`<n> checks on <m> paths, <k> failed`. With `--json FILE`, every finding, passing or not, as one JSON object per line:

```json
{"path":"/srv/pacs/2A/1A.sbnd","check":"layout","result":"fail","details":"invalid magic (expected SBND)"}
```

Exit code: **0** every check passed, **1** any check failed, **2** the report could not be written.

## From disk

Before a file is read, its dirty pages are written back (`fdatasync`) and its cached ones dropped
(`posix_fadvise(POSIX_FADV_DONTNEED)`): a check that read the page cache would prove what the kernel holds, not what
the device will hand back after a restart, and media errors would stay hidden behind a warm cache. Its limits:

* **It is advice.** Pages another process has mapped, or is reading at that moment, stay or come straight back; a
  page cached by a concurrent read is read from memory. On tmpfs the pages are the storage and nothing is dropped.
* **The device's own cache is below it.** A read can still be served by the drive's or the controller's cache.
* **It costs the server.** A series being served loses its cached pages and is read again from disk at the next ask.
  Run the scrub when the host is quiet, and at idle I/O priority (the cron line below).
* `O_DIRECT` was not used: SQLite cannot read through it, and it needs aligned buffers and a filesystem that supports
  it; one mechanism serves both kinds of file.

`tests/from_disk.rs` checks that a file just written has no page cached once opened for checking (`mincore`).

## From cron

A weekly scrub, Sunday 03:17, at idle I/O priority; cron mails the text when the exit code is non-zero
(`chronic`, from moreutils, prints only on failure). In a crontab `%` must be escaped as `\%`.

```text
17 3 * * 0  ionice -c3 nice chronic /usr/local/bin/pacs-verify /srv/pacs --json /var/log/pacs-verify/$(date +\%F).jsonl
```

## Tests

`cargo test -p pacs-verify -p study-db`. Each check has a test that breaks a file the way the check is for — a wrong
magic, an unknown version and version 2, a frame outside the file, a frame over the cap, a truncated bundle, a group's
bytes, a stored hash, a missing table, an index that disagrees with its table, a garbled page, a garbled DB header —
and each test was mutation-checked: the code it guards was broken on purpose and the test failed. Three lines have no
test that fails without them, because the condition needs a faulty device or is not reachable from a file: a frame
read error, SQLite refusing to open a file it was given, and the `-wal` file's pages being dropped.
