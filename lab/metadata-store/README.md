# metadata-store

What a page open reads, from four stores of the parser's metadata groups
([`docs/ingest/metadata-draft.md`](../../docs/ingest/metadata-draft.md) §2): **A** the parser's group files, **B** each
group whole in SQLite plus a column per page value, **C** one SQLite row per attribute under DECK's ordered key, **D** a
sorted key file searched by binary search with the values apart. Every store is built from the same groups, every
read must hand back the same page values before it is timed, and C must give back each group byte for byte.

```bash
cargo run -p metadata-store --release -- --instances 4,200,2000 --rounds 200 > rows.jsonl
```

**The series.** One real instance group and its series group, from the parser's `doc/PACS/db/deck.db` at `f36230b`
(a public CT sample, 45 attributes), in [`fixtures/`](fixtures) with DECK's prefix taken off as the directory output
writes them. A series of N instances repeats that group with its own SOP instance UID, instance number and slice
position. **The page's read** is, per instance, the instance number, photometric interpretation, window centre and
width, and rescale intercept and slope (`client/viewer/viewer.js`); this sample has no window, so those two come back
empty.

**The reads.** *Scan* reads every row of the series and keeps the page's tags; *seek* reads only each instance's key
range from (0020,0013) to (0028,1053), then jumps to the next instance. *Opened* opens the store for each read, as a
server holding no study open would; *held* reuses one open handle. A always opens.

**What it does not say.** One thread on one host, every file in the page cache (written just before, never evicted):
no claim about a cold disk or about many sessions at once. D's fixed 16-byte keys hold top-level attributes only; a
group with a sequence makes the build refuse.

**`--mode pair`** times the recommended pair and its runner-up, each one SQLite file in WAL at `synchronous=FULL`: T1, the
truth as a row per received group, and T2, a row per attribute, each with V1, one page row per series holding the
page's document. Pre-registered and recorded in the draft's §2: the page open (held and opened, D's held scan as the
reference), one update (a new revision of one instance's rescale intercept, the page row rebuilt, one commit), the
rebuild alone, every received group's BLAKE3, a reader in a second process during updates (`--reader`, started by the
run), and size.

```bash
cargo run -p metadata-store --release -- --mode pair --instances 4,200,2000 --rounds 300 --updates 60 > pair.jsonl
```

**`--mode pair-followup`** measures the pair's two open items, pre-registered in the draft's §2: an update that patches
only the changed instance's entry in the page row against one that rebuilds it (each patched row checked against a
full rebuild), and a reader's tail alone, beside commits on another core, and on the same core (`sched_setaffinity`;
each read's interval on `CLOCK_MONOTONIC`, classified against the writer's commit windows).

**`--mode update-cost`** asks what one update of metadata already stored costs under the two proposed update models,
at 200, 2 000 and 10 000 instances: **patched in place**, #126's patch arm unchanged (T1 + V1 in one SQLite file in WAL
at `synchronous=FULL`, a new revision row and the page row's one entry rewritten, one commit), against **a new revision
directory** (the receiver draft's `design.md` §12.5 (a)): the correction kept as a new input file (`fsync` it and
`inputs/`), the whole study's T1 + V1 file rebuilt from every kept input into `store/N.partial/`, `fsync` the file and
the directory, rename to `store/N`, `fsync` `store/`, then `CURRENT.lock` written, `fsync`ed and renamed to `CURRENT`,
`fsync` `store/`; revisions older than N − 1 removed after, untimed. Its reader reads `CURRENT` and opens the file with
`immutable=1`.

*Pre-registered, 2026-10-24, before any timing.* Arms, interleaved round by round with the order rotated: patched,
patched′ (the A/A arm), revision, revision′ (its A/A arm), each on its own store, 100 updates each per cell; two
runs. The writer is pinned to core 0, the reader to core 2. Per update: **latency to visible**, from the update's start
until a reader opened after it has read the new page row (checked byte for byte); bytes written (`/proc/self/io`
wchar); the writer thread's CPU time; and `fsync`s per update, counted apart by `strace` over 20 updates per model
(untimed). Then a **reader in a second process**, six arms interleaved over 6 repetitions of 30 updates: each store
read by a reader opened per read, alone and beside its updates, and each read by a reader holding one open handle
beside its updates. Every read must be the document before or after an update; the held readers report which
documents they saw. A 16 MB write and `fsync` is timed 10 times per cell as the disk's reference.

**The rule.** A model is cheaper in a cell when its median latency is below the other's by more than the larger A/A
gap (|patched − patched′|, |revision − revision′|) in both runs; otherwise the cell is a tie. Latency only.

| Prediction | Contradicted if |
| --- | --- |
| patched is cheaper in every cell: revision ≥ 3× patched at 200, ≥ 8× at 2 000 and at 10 000 | a tie, revision cheaper, or a smaller ratio |
| revision writes at least its study file per update (≈ 0.3, 2.9, 14 MB); patched a median ≤ 64 KB | otherwise |
| `fsync`s per update: revision 7; patched a median of 1 | otherwise |
| no reader of either model ever reads a document that is neither before nor after | one does |
| a held revision reader reads only the revision it opened, also after that revision is removed; a held patched reader sees the updates | otherwise |
| a reader opened per read, on another core than the writer: p99.9 beside updates within 2× its p99.9 alone, both models | over 2× |
| the opened revision reader's median no more than 20 % above the opened patched reader's | further above |

The host: whether the writer saturates its core is its CPU time against its latency; whether it saturates the disk is
the revision arm's bytes over its latency against the 16 MB reference. Nothing is claimed past either.
