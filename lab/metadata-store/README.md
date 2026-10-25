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

```bash
cargo run -p metadata-store --release -- --mode update-cost --instances 200,2000,10000 --updates 100 > update-cost.jsonl
```

*Measured, 2026-10-24, two runs* (a range is the two runs' medians, both A/A arms included; p10–p90 of one run in
brackets). A 4-vCPU Xeon at 2.80 GHz, not the 2.10 GHz host of the rows above, so only this run's numbers compare;
ext4 on the VM's virtual disk, files in the page cache. Latency to visible includes the new reader's open and read.

| Per update | 200 instances | 2 000 | 10 000 |
| --- | ---: | ---: | ---: |
| patched, latency to visible | 1.08–1.59 ms [0.9–1.5] | 2.30–2.86 ms [2.2–3.9] | 7.6–8.2 ms [7.4–12.1] |
| revision, latency to visible | 7.8–9.3 ms [6.4–10.6] | 34.6–38.4 ms [32–45] | 141–143 ms [126–167] |
| largest A/A gap, either model | 0.35 ms | 1.4 ms | 2.0 ms |
| revision ÷ patched | 5.7–6.5× | 13.1–13.5× | 17.3–17.4× |
| bytes written, patched (median; p90) | 16 480; 24 720 | 16 480; 28 840 | 16 480; 28 840 |
| bytes written, revision (its file: 299 008; 2 875 392; 14 311 424 B) | 319 501 | 2 895 885 | 14 331 917 |
| `fsync`s, patched; revision | 1.2; 7.0 | 1.2; 7.0 | 1.2; 7.0 |
| writer CPU ÷ latency, patched; revision | 0.56–0.57; 0.55–0.60 | 0.74–0.77; 0.67–0.70 | 0.89–0.90; 0.76–0.77 |

| Reader, µs, p50 \| p99.9 (max), run 1; run 2 | 200 | 2 000 | 10 000 |
| --- | ---: | ---: | ---: |
| patched, opened per read, alone | 138 \| 649; 129 \| 684 | 294 \| 1 128; 262 \| 1 147 | 685 \| 2 994; 653 \| 2 540 |
| patched, opened per read, beside updates | 136 \| 494; 134 \| 520 | 322 \| 796; 259 \| 907 | 703 \| 1 668; 678 \| 2 373 |
| revision, opened per read, alone | 83 \| 475; 80 \| 352 | 182 \| 783; 175 \| 973 | 584 \| 2 276; 595 \| 2 818 |
| revision, opened per read, beside updates | 85 \| 501; 83 \| 500 (28 032) | 182 \| 796; 177 \| 1 266 (16 853) | 601 \| 2 354 (21 448); 601 \| 2 826 (33 652) |
| patched, held, beside updates | 3.5 \| 75; 3.5 \| 55 | 18 \| 256; 13 \| 234 | 76 \| 1 517; 99 \| 1 807 |
| revision, held, beside updates | 2.3 \| 51; 2.3 \| 45 | 47 \| 282; 46 \| 207 | 428 \| 1 712; 417 \| 1 932 |

* **Holds: patched is cheaper in every cell**, by 5.7–6.5× at 200, 13× at 2 000 and 17× at 10 000, each far past the
  A/A gap in both runs. The revision's cost grows with the study (it rebuilds all of it); the patch's with the page
  document it parses and rewrites.
* **Holds: bytes and `fsync`s.** A revision writes its whole file and about 20 KB more; a patch writes four to seven
  4 KiB pages. The patch's 1.2 `fsync`s is a mean over 20 updates, each with at least the commit's one,
  so at most 4 in 20 took more (a checkpoint); the median is 1.
* **Holds: correctness.** No read of 2 010 769 over both runs was neither before nor after; no revision reader had to
  read `CURRENT` again. A held revision reader read only the revision it opened in all 36 repetitions, also after
  `tidy` removed it; a held patched reader saw both documents in every repetition.
* **Holds: the opened reader's tail.** p99.9 beside updates is 0.56–0.93× its alone arm for patched, 1.00–1.42×
  for revision; and an opened revision reader (`immutable=1`) is 9–40 % *faster* than an opened WAL reader at the
  median. The maxima
  say nothing either way: 17–34 ms beside the revision writer, but up to 40 ms alone too.
* A held revision reader is 3–5× slower at the median than a held WAL reader at 2 000 and 10 000 (47 against
  13–18 µs; 420 against 76–99 µs); not explained here.
* **Where the host saturates.** Both writers are mostly CPU on their pinned core: the patch at 10 000 is 89 % CPU, the
  revision 76–77 %. The revision at 10 000 writes 14.3 MB in 141 ms, about 100 MB/s, against 550–620 MB/s for the
  16 MB write and `fsync` reference (medians 27–31 ms), so the disk is not saturated and the revision's cost is its
  rebuild.
  One update at a time on one study: nothing is claimed for concurrent updates, many studies, or a cold disk. The
  revision's inputs grow by one correction file per update (up to 101 here), and the patched file by one group row.

## Repetition: how big the metadata is next to the pixels, and how much of it a series repeats

[`repetition/`](repetition) asks, on real series: how many bytes each level's groups weigh against the pixels, what
zstd makes of them, and how much of an instance group is the same in every instance of its series. It feeds two
later decisions and makes neither: whether the PCS-to-PACS package should compress the metadata
([`docs/ingest/design.md`](../../docs/ingest/design.md) §7), and how the per-study database keeps instance metadata —
a row per instance group, one blob per series, or the shared values once plus each instance's differences (DICOM's
Shared and Per-frame Functional Groups, PS3.3 C.7.6.16, which the Legacy Converted Enhanced classes of PS3.3 A.70ff
carry for CT, MR and PET).

```bash
python3 -m venv .venv && .venv/bin/pip install --require-hashes -r lab/metadata-store/repetition/requirements.txt
.venv/bin/python -I lab/metadata-store/repetition/measure_test.py
.venv/bin/python -I lab/metadata-store/repetition/fetch.py DATA            # 1.1 GB, every file checked
.venv/bin/python -I lab/metadata-store/repetition/measure.py DATA --ojph BUILD/openjph > repetition.jsonl
```

**The series**, from The Cancer Imaging Archive, each file's SHA-256 pinned in
[`repetition/series.json`](repetition/series.json) with its collection, licence and DOI; the data is not committed.

| Name | Modality | Collection, licence | Instances | Frame |
| --- | --- | --- | ---: | --- |
| ct | CT, "CT Spiral 5.0 B40s" | ACRIN-NSCLC-FDG-PET, CC BY 3.0, doi:10.7937/tcia.2019.30ilqfcl | 262 | 512 × 512, 12 in 16 bits |
| pt | PT, "PET WB", the same study as ct | the same | 262 | 256 × 256, 16 bits signed |
| mr | MR, "Breast NCI-dyn HR" | ACRIN-Contralateral-Breast-MR, CC BY 4.0, doi:10.7937/Q1EE-J082 | 145 | 512 × 512, 12 in 16 bits |
| mg | MG | CMMD, CC BY 4.0, doi:10.7937/tcia.eqde-4b16 | 4 | 2294 × 1914, 8 bits |
| us | US | B-mode-and-CEUS-Liver, CC BY 4.0, doi:10.7937/TCIA.2021.v4z7-tc39 | 12 | 720 × 960 RGB, 8 bits |

Every pixel set is stored uncompressed. No DBT and no XA: none was fetched.

**The split** follows the parser at `f36230b` (`DICMele2deck/src/capi/uapi.c`, `val`), not the stand-in
`ingest/from-parser/mirror.py`, which writes ten attributes. Group 0002, odd (private) groups and any attribute of VR
UN go to the private group; a top-level attribute in the parser's patient or study list goes to the exam group, in its
series lists to the series group, every other to the instance group, and a sequence with its root. The parser's walk
stops at index 234 of its 239-entry list, so its last four series tags (0054,1210), (0054,1220), (0080,0013) and
(300A,0700) land in the instance group; kept so. Group lengths, (0008,0005), sequence and item delimiters and the pixel
data are not written; a record is the contract's (§Group files), a sequence's attribute carrying 8 key bytes more per
level (its sequence's tag and item number, DECK's design). **Approximations:** the charset index is written 0 and no
text is converted to UTF-8 (the values as stored); the exam and series groups are weighed once per series, as the
parser keeps the first it writes, and how many different ones the series' instances would have written is counted.

**What is measured, per series.** Bytes per level; metadata against pixel bytes as stored, and against the frames
coded HTJ2K-lossless by OpenJPH 0.31.0 with the ingest's arguments (`ingest/coded-frames/ingest.py`, each frame decoded
back and compared); zstd (python-zstandard 0.25.0, libzstd 1.5.7) at levels 1, 3, 9 and 19 on the metadata alone,
each group file compressed alone and every group in one tar stream, its ratio and its compress and decompress time;
the package (metadata plus pixels, the pixels stored uncompressed by zstd) with and without its metadata compressed;
per attribute of the instance and private groups, whether it is in every instance with one value (*constant*), in
every instance with more than one (*varying*), or in some (*partial*), and the bytes each class weighs; and three
layouts' raw bytes: a row per instance group (the groups as written), one blob per series (the same records in one
value, raw and zstd-3), and shared + per-instance (each constant record once, then every instance's other records).

*Pre-registered, 2026-10-25, before the metadata was read.* Times are medians of 15 rounds, levels and the two
streams interleaved round by round with the order rotated, two runs; ratios and bytes are deterministic.

| Prediction | Contradicted if |
| --- | --- |
| the metadata is under 2 % of the stored pixel bytes for ct, mr, mg and us; pt between 2 and 15 % | otherwise |
| one stream at level 3 compresses ≥ 5× for ct, pt and mr; group files alone ≤ 2.5× | otherwise |
| level 19's one stream is at most 30 % smaller than level 3's, and ≥ 10× slower to compress | otherwise |
| one stream at level 3 compresses at ≥ 100 MB/s on one core | slower |
| compressing the metadata saves under 2 % of the package with HTJ2K-coded pixels for ct, mr, mg and us; under 10 % for pt | more |
| ≥ 70 % of the instance group's attributes are constant across the series, and constant records ≥ 50 % of its bytes, for ct, pt and mr | otherwise |
| at most 15 of ct's instance-group attributes vary | more |
| shared + per-instance weighs ≤ 40 % of a row per instance group for ct, pt and mr | more |
| one blob per series at zstd-3 weighs less than shared + per-instance raw, every series | more |
| every instance of a series would write the same exam group and the same series group | a series with two of either |
| every instance has a private group, at least its group 0002 (≥ 150 B) | an instance without |

The host: one thread, the files in the page cache; whether zstd saturates its core is its rate, nothing is claimed
for parallel compression or any other host.

*Measured, 2026-10-25, two runs* (bytes and ratios identical in both; a time is the two runs' medians, which agree
within 15 %). A 4-vCPU Xeon at 2.80 GHz, one thread, every file in memory. *Metadata* is every group file the parser
would write for the series (exam and series group once); *HTJ2K* is the frames coded and decoded back here, every frame
exact. A level's bytes are the sum over the series.

| Series | ct | pt | mr | mg | us |
| --- | ---: | ---: | ---: | ---: | ---: |
| instances | 262 | 262 | 145 | 4 | 12 |
| exam group, once | 1 431 | 1 431 | 1 348 | 1 181 | 1 820 |
| series group, once | 497 | 1 075 | 462 | 208 | 306 |
| instance groups (per instance, median) | 314 684 (1 201) | 227 700 (869) | 223 657 (1 541) | 4 176 (1 044) | 10 996 (849) |
| private groups (per instance) | 87 770 (335) | 88 294 (337) | 537 225 (3 705) | 1 176 (294) | 3 720 (310) |
| metadata | 404 382 | 318 500 | 762 692 | 6 741 | 16 842 |
| pixels as stored | 137 363 456 | 34 340 864 | 76 021 760 | 17 562 864 | 314 036 760 |
| pixels in HTJ2K (ratio) | 41 184 983 (3.34×) | 7 707 320 (4.46×) | 25 959 791 (2.93×) | 3 480 592 (5.05×) | 78 499 765 (4.00×) |
| metadata ÷ pixels as stored | 0.29 % | 0.93 % | 1.00 % | 0.038 % | 0.005 % |
| metadata ÷ pixels in HTJ2K | 0.98 % | 4.1 % | 2.9 % | 0.19 % | 0.021 % |

| zstd on the metadata: ratio, compress ms (decompress) | ct | pt | mr | mg | us |
| --- | ---: | ---: | ---: | ---: | ---: |
| each group file alone, level 1 | 1.81×, 3.2 (1.3) | 1.60×, 3.2 (1.3) | 2.85×, 3.6 (1.7) | 1.76×, 0.08 | 2.02×, 0.22 |
| each group file alone, level 19 | 1.97×, 59 | 1.73×, 42 | 3.22×, 151 | 1.86×, 1.0 | 2.14×, 3.1 |
| one stream, level 1 | 9.57×, 0.80 (0.30) | 7.70×, 0.78 (0.33) | 26.9×, 0.72 (0.33) | 3.02×, 0.036 | 4.59×, 0.055 |
| one stream, level 3 | 9.18×, 1.31 | 7.37×, 1.20 | 26.1×, 1.06 | 3.03×, 0.09 | 4.63×, 0.14 |
| one stream, level 9 (the best ratio but us's and mg's) | 9.70×, 6.0 | 7.87×, 6.0 | 27.8×, 5.4 | 3.18×, 0.17 | 4.69×, 0.32 |
| one stream, level 19 | 9.52×, 99 | 7.75×, 120 | 27.2×, 100 | 3.23×, 3.0 | 4.81×, 8.3 |
| the package saved by compressing its metadata (stream, level 1), HTJ2K pixels | 0.87 % | 3.45 % | 2.75 % | 0.13 % | 0.017 % |
| the same, pixels as stored | 0.26 % | 0.80 % | 0.96 % | 0.026 % | 0.004 % |

| Repetition across the series | ct | pt | mr | mg | us |
| --- | ---: | ---: | ---: | ---: | ---: |
| instance-group attributes constant / varying / partial | 37 / 6 / 0 | 26 / 9 / 0 | 51 / 10 / 0 | 37 / 7 / 0 | 13 / 8 / 44 |
| instance-group bytes that are constant records | 82.7 % | 70.0 % | 83.4 % | 79.6 % | 23.0 % |
| private-group bytes that are constant records | 77.0 % | 77.2 % | 94.8 % | 73.8 % | 61.9 % |
| a row per instance group (instance + private, raw) | 402 454 | 315 994 | 760 882 | 5 352 | 14 716 |
| shared + per-instance (raw; of the rows) | 75 943 (18.9 %) | 89 446 (28.3 %) | 69 970 (9.2 %) | 2 208 (41.3 %) | 10 283 (69.9 %) |
| one blob per series, zstd-3 (of the rows) | 12 564 (3.1 %) | 11 902 (3.8 %) | 11 353 (1.5 %) | 835 (15.6 %) | 1 260 (8.6 %) |
| exam groups / series groups the instances would write | 1 / 1 | 1 / 1 | 1 / 1 | 1 / 1 | 1 / 1 |

**What varies** in the instance group: ct, the SOP instance UID, instance number, image position, slice location,
acquisition and content time; pt the same plus acquisition number, decay factor and image index; mr the UID, number,
position, content and instance creation time, temporal position, window centre and width, and zoom centre and factor;
mg the UID, number, laterality, orientation, view code and creation time. In every series the private group's one
varying record is (0002,0003), which repeats the SOP instance UID; mr's private group holds 163 records, 155 of them
constant, and 7 vendor records vary besides. us is two SOP classes in one series, 8 single-frame images and 4 cines of 70–88 frames, every instance marked
Lossy Image Compression 01, so 44 of its 65 instance-group attributes are in some instances only, the cine's and
the ultrasound regions' among them.

Against the pre-registration:

| Prediction | Outcome |
| --- | --- |
| metadata under 2 % of the stored pixels for ct, mr, mg, us; pt 2–15 % | **contradicted for pt** (0.93 %); holds for the rest (0.005–1.00 %) |
| one stream at level 3 ≥ 5× for ct, pt, mr; files alone ≤ 2.5× | stream holds (7.4–26×); **files alone contradicted for mr** (2.94×) |
| level 19 at most 30 % smaller than level 3, and ≥ 10× slower | holds: 3.6–6.6 % smaller, 33–100× slower; level 1 is within 1 % of level 3, and smaller for ct, pt and mr |
| level 3 one stream ≥ 100 MB/s | holds on the stream zstd reads (300–1 300 MB/s of tar); counted on the group bytes alone, mg's 6.7 KB is 84 MB/s |
| the package saved < 2 % with HTJ2K pixels for ct, mr, mg, us; pt < 10 % | **contradicted for mr** (2.75 %); holds for the rest |
| ≥ 70 % of instance attributes constant and ≥ 50 % of its bytes, ct, pt, mr | holds (74–86 %; 70–83 %) |
| ≤ 15 of ct's instance attributes vary | holds (6) |
| shared + per-instance ≤ 40 % of a row per instance group, ct, pt, mr | holds (17.6, 30.3 and 17.1 % of the instance groups; 9–28 % with the private) |
| a series blob at zstd-3 below shared + per-instance raw | holds in every series |
| one exam group and one series group per series | holds |
| every instance has a private group ≥ 150 B | holds (294–3 705 B) |

* **The metadata is 0.005–1 % of the pixels as stored and 0.02–4 % of them in HTJ2K.** PET is the largest share
  (256 × 256 frames), then MR (whose vendor private group is 70 % of its metadata).
* **A series compresses 3–27× as one stream and 1.6–3.2× file by file.** The repetition is across instances, not
  inside one, which is what the stream's window sees and a lone group cannot. Level 1 is as good as any: the best of levels 9 and
  19 is at most 7 % smaller, for 80–150× level 1's time at 19. Decompression is ≈ 0.3 ms for the biggest series at any level.
* **Consequence for (a), the package:** compressing the metadata saves at most 3.5 % of a package with HTJ2K pixels
  (pt), 0.9 % for ct and under 0.2 % for mg and us, for about 1 ms of one core per series at level 1, one stream.
* **Consequence for (b), the database:** in ct, pt, mr and mg 70–83 % of a row per instance group is the same bytes in
  every row. Keeping them once weighs 9–28 % of the rows (ct, pt, mr) and leaves per instance the set that Legacy
  Converted Enhanced puts per-frame (position, number, times, UID; window in this MR; decay factor in this PET). A
  zstd blob per series weighs 1.5–3.8 % of the rows but is no longer read one instance at a time. us shows the limit:
  two SOP classes in one series leave the shared part a quarter of its bytes.
* **Method notes.** The level of a listed tag is the parser's `PCStype`, which puts (0008,0080) Institution Name in
  the exam group (its comment: "is S in the standard but we put it in C"). The per-file times include the Python
  binding's call per file (≈ 6 µs × 526 files for ct); the stream's do not. The package ignores tar headers.
* **What it does not say.** These are de-identified research series: TCIA's de-identification replaces UIDs, blanks or
  removes attributes and most private ones, and adds its own (13 de-identification codes, 39 records of the exam group);
  a hospital's headers, and a vendor's private groups, may weigh more. One series per modality, one host, one thread;
  no SQLite page or index overhead is in the layouts' bytes. No DBT, XA or cine of hundreds of frames was measured; us's pixels are lossy-sourced, so its HTJ2K is
  exact to what is stored, not to an acquisition.

## Updates on the link: whether a metadata-only package is worth compressing

[`update-link/`](update-link) asks one question: a package that carries only metadata (a correction from the
hospital-side PCS or from a client application, [`docs/adr/metadata-updates.md`](../../docs/adr/metadata-updates.md)
on #148; [`docs/adr/pcs-transfer.md`](../../docs/adr/pcs-transfer.md) §5 and §8 on #149) is small, so zstd changes its
size a lot in relative terms; does that shorten its transfer, or do round trips decide it either way? And if it is a
gain, is compressing the metadata always, whatever the package, simpler and harmless? For series packages §Repetition
above already answered: compressing saves at most 3.5 % of the package, so the owner's choice there is none.

```bash
.venv/bin/python -I lab/metadata-store/update-link/packages.py DATA OUT > packages.jsonl     # sizes and CPU
.venv/bin/python -I lab/metadata-store/update-link/wire.py packages.jsonl                    # the arithmetic
cargo build --release --locked --manifest-path lab/metadata-store/update-link/Cargo.toml
sudo .venv/bin/python -I lab/metadata-store/update-link/link.py OUT > link.jsonl             # the emulated links
```

**The packages**, built from §Repetition's five series split as the parser splits them, in #149's container: a pax tar
with a header member of about 100 bytes first, then the members, deterministic headers, the two end records. A
*correction* is one of #149 §8's kinds or its #148 form as differences (`set` and `remove` by DECK key, one operations
member with the group's level, the UID naming it and an 8-byte base hash per changed group):

| Kind | Content |
| --- | --- |
| exam-diff | a patient correction as differences: `set` of patient name and birth date |
| exam-group | the exam group replaced whole |
| series-diff, series-group | `set` of the series description; the series group whole |
| instance-diff, instance-group | `set` of one record in one instance; that instance's group whole (the median-sized one) |
| fanout-diff, fanout-groups | one record set in every instance of the series; every instance group whole |
| series-resend | every group file of the series: exam, series, every instance and private group |

**The variants**: *raw*, every group file (or the operations) its own member; *zstd-1, 3, 9*, #149 §5's form, the
metadata as one zstd stream in one member (a tar of the group files, compressed); and, sized only, the whole package
compressed at level 1.

**The wire** (*estimated*, [`update-link/wire.py`](update-link/wire.py)): the package as the body of #149 §3's
creation request (a `POST` carrying `Upload-Complete`, draft-ietf-httpbis-resumable-upload-14 §6) on a fresh
connection, mutual TLS 1.3 with a 1.5 KB client certificate flight. TCP: MSS 1 448, initial window 10 segments
(RFC 6928 §2), slow start doubling each round trip (RFC 5681 §3.1), one round trip for TCP's handshake and one for
TLS 1.3's (RFC 8446 §2), the request in the client's flight after its `Finished`. QUIC: 1 200-byte datagrams, the
initial window min(10 × 1 200, max(14 720, 2 × 1 200)) = 12 000 bytes (RFC 9002 §7.2), one round trip for the combined
handshake (RFC 9000 §7), no 0-RTT (#149 §3). A round's time is max(RTT, its flight's serialisation), plus a final RTT
for the response; a lost packet costs 1.5 RTT on average, once per package with probability 1 − (1 − p)^packets.

**The link classes**, assumptions labelled, the uplink being the PCS's or the client's:

| Class | RTT | up / down | loss each way | from |
| --- | ---: | --- | ---: | --- |
| fiber | 10 ms | 100 / 100 Mbit/s | 0 | FCC MBA fiber idle RTT 7–14 ms ([link-conditions](../../docs/transport/link-conditions.md) §Link profiles) |
| 4G/5G | 60 ms | 19 / 100 Mbit/s | 1 % | Ookla's world median uplink 19 Mbit/s; the owner's 40–80 ms; 1 % is 5G's p99 (same table) |
| GEO satellite | 600 ms | 2 / 10 Mbit/s | 0.1 % | #149 §5's GEO uplink; the loss is an assumption |
| rural ADSL | 50 ms | 1 / 8 Mbit/s | 0.1 % | DSL idle RTT 23–34 ms, more under load; #149 §5's 1 Mbit/s |

**The measurement** (*measured*, [`update-link/link.py`](update-link/link.py)): the container has no `netem`
(`CONFIG_NET_SCH_NETEM` is not set), so two network namespaces, the PCS's and the PACS's, are joined by two TUN
devices and a forwarder that delays, rate-limits (a 100-packet FIFO) and drops each packet as the class says, both ways.
The kernel's own TCP (Cubic, set in both namespaces; the host default is BBR) carries HTTP/1.1 over TLS 1.3 (rustls);
quinn carries HTTP/3 (h3), its default Cubic. Both ends of both stacks present certificates. Every transfer is a fresh
connection, timed from the client's first packet to the server's `201`; the PACS reads the whole body before replying.
Per class, the variants raw and zstd-1, both protocols and the kinds exam-diff, exam-group, series-group,
instance-group and fanout-diff of ct and series-resend of ct and mr are interleaved in each round, the order rotated
round by round: 12 rounds, 8 on GEO. The forwarder's own cost is measured first with no delay, rate or loss, and nothing
is claimed below ten times it.

*Pre-registered, 2026-10-25, before any package was built or any transfer run.*

| Prediction | Contradicted if |
| --- | --- |
| S1: every correction package (exam, series, instance; whole group or differences) weighs ≤ 8 KB raw, in every series | heavier |
| S2: for those, zstd-1 saves at most 2 TCP segments (2 896 B) | more |
| S3: a differences package of one or two records weighs ≤ 4 KB raw, and zstd saves it ≤ 512 B | otherwise |
| S4: a series-resend weighs ≥ 2× its group bytes raw for ct and pt (tar's 512-byte headers and padding), and zstd-1 takes it to ≤ 1/10 of raw for ct, pt and mr | otherwise |
| W1: no correction package (S1's) crosses a round-trip boundary when compressed, on TCP or QUIC | one does |
| W2: compressing a series-resend saves ≥ 3 round trips for ct and mr, TCP and QUIC | fewer |
| W3: compressing a fanout-diff saves at most one round trip | more |
| T1: compressing a correction saves < 5 ms on every class but rural ADSL, < 30 ms there, and < 2 % of its time everywhere | more |
| T2: compressing a series-resend saves ≥ 1.5 s on GEO, ≥ 5 s on rural ADSL, ≥ 150 ms on 4G/5G and < 60 ms on fiber | otherwise |
| C1: zstd-1 compresses a correction's metadata in ≤ 50 µs and decompresses it in ≤ 20 µs; a series-resend in ≤ 2 ms | slower |
| E1: measured, the corrections' compressed and raw medians tie, within max(3 %, 2 ms), every class and protocol | a gap outside it |
| E2: measured, a compressed series-resend is faster by ≥ 2 RTT on 4G/5G and GEO, and by ≥ 5 s on rural ADSL, both protocols | otherwise |
| E3: on the lossless or near-lossless classes (fiber, GEO, rural ADSL) the measured medians are within 25 % of the arithmetic | outside |
| E4: a fresh QUIC transfer of a correction is faster than TCP's by 0.7–1.3 RTT (one handshake round trip fewer) | otherwise |

**The decision rule, fixed now.** Compressing a kind is *worth it* on a class if it is faster there by ≥ 1 RTT or
≥ 10 % (measured where measured, else estimated). It is *harmless* if on no kind and no class the compressed variant is
slower outside E1's tie band, and its CPU is ≤ 1 ms a correction at either end. **Always on** is recommended if it is
harmless everywhere and worth it for at least one kind a PCS sends; otherwise it is decided per kind.
