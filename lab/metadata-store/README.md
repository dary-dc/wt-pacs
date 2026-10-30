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

**`--mode pair`** times the recommended pair and its runner-up, each one SQLite file in WAL at `synchronous=FULL`: T1, a
row per received group, and T2, a row per attribute, each with V1, one display metadata row per series (table `page`
in the code) holding the series' display metadata. *Renamed 2026-10-26:* this README called that row the "page row"
and its bytes the "page document" or "page view"; the term is display metadata
([`docs/ingest/metadata-draft.md`](../../docs/ingest/metadata-draft.md) §2). Pre-registered and recorded in the draft's §2: the page open (held and opened, D's held scan as the
reference), one update (a new revision of one instance's rescale intercept, the display metadata row rebuilt, one commit), the
rebuild alone, every received group's BLAKE3, a reader in a second process during updates (`--reader`, started by the
run), and size.

```bash
cargo run -p metadata-store --release -- --mode pair --instances 4,200,2000 --rounds 300 --updates 60 > pair.jsonl
```

**`--mode pair-followup`** measures the pair's two open items, pre-registered in the draft's §2: an update that patches
only the changed instance's entry in the display metadata row against one that rebuilds it (each patched row checked against a
full rebuild), and a reader's tail alone, beside commits on another core, and on the same core (`sched_setaffinity`;
each read's interval on `CLOCK_MONOTONIC`, classified against the writer's commit windows).

**`--mode update-cost`** asks what one update of metadata already stored costs under the two proposed update models,
at 200, 2 000 and 10 000 instances: **patched in place**, #126's patch arm unchanged (T1 + V1 in one SQLite file in WAL
at `synchronous=FULL`, a new revision row and the display metadata row's one entry rewritten, one commit), against **a new revision
directory** (the receiver draft's `design.md` §12.5 (a)): the correction kept as a new input file (`fsync` it and
`inputs/`), the whole study's T1 + V1 file rebuilt from every kept input into `store/N.partial/`, `fsync` the file and
the directory, rename to `store/N`, `fsync` `store/`, then `CURRENT.lock` written, `fsync`ed and renamed to `CURRENT`,
`fsync` `store/`; revisions older than N − 1 removed after, untimed. Its reader reads `CURRENT` and opens the file with
`immutable=1`.

*Pre-registered, 2026-10-24, before any timing.* Arms, interleaved round by round with the order rotated: patched,
patched′ (the A/A arm), revision, revision′ (its A/A arm), each on its own store, 100 updates each per cell; two
runs. The writer is pinned to core 0, the reader to core 2. Per update: **latency to visible**, from the update's start
until a reader opened after it has read the new display metadata row (checked byte for byte); bytes written (`/proc/self/io`
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
  A/A gap in both runs. The revision's cost grows with the study (it rebuilds all of it); the patch's with the display
  metadata it parses and rewrites.
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

## The parser's own output: what it writes for the same series

[`parser-output/`](parser-output) asks the question of §Repetition again with the PCS team's parser itself, not an
approximation of its split: what `ESIPFfiled` (its directory output) writes for the same five series, how big it is
next to the pixels, how repetitive, and what a Legacy Converted Enhanced instance made of it would weigh.

```bash
lab/metadata-store/parser-output/build.sh BUILD                    # prints BUILD/build/ESIPFfiled
.venv/bin/pip install --require-hashes -r lab/metadata-store/repetition/requirements.txt
.venv/bin/python -I lab/metadata-store/parser-output/measure_parser_test.py
.venv/bin/python -I lab/metadata-store/repetition/fetch.py DATA    # the series of §Repetition, every file checked
.venv/bin/python -I lab/metadata-store/parser-output/measure_parser.py DATA BUILD/build/ESIPFfiled OUT > parser.jsonl
```

**The parser** is `github.com/opendicom/DECK_WebTransport` at `a65abe2` (2026-10-22, the newest commit on 2026-10-25;
`DICMele2deck/` last changed at `76b119b`, 2026-10-20). `build.sh` clones it, installs CMake 4.4.4 from PyPI (its
`CMakeLists.txt` asks for 4.2; the host has 3.28), configures `DICMele2deck/` with `-DCMAKE_BUILD_TYPE=Release` (gcc
13.3, `-O3`) and builds the target `ESIPFfiled`, which builds with four warnings. `ESIPFserialized` and `ESIPbasetags`
do not link (`iconAttribute` undefined) and `dicm2decksqlite` does not compile (`eblake3stmt` undeclared, in
`src/deck_sqlite3.c`); none of the three is needed here. The parser runs once per instance in one working directory per series, as
the PCS document describes its first process, so a series' tree accumulates. It reads only Explicit VR Little Endian
with the file meta laid out from offset 0x84; ct, pt, mr and mg are; us is Implicit VR Little Endian, so its twelve
files are rewritten Explicit by pydicom 3.0.1 first (a private attribute pydicom has no VR for becomes UN), the one step
not the parser's.

**What is measured, per series**, from the tree the parser wrote: files and directories by kind, their bytes and their
allocation on disk (`st_blocks`, ext4 here, 4 KiB blocks); bytes per level (every exam and series group file written,
each instance and private group); whether each group file's name is the BLAKE3 of its bytes; the frame files' bytes
against the pixel data's (rows × columns × samples × bits allocated / 8 × frames); metadata against the stored pixels and
against §Repetition's HTJ2K bytes (the same pixels); zstd at levels 1, 3, 9 and 19 on the group files alone and as one
tar stream, with §Repetition's code, rounds and rotation; per attribute of the instance and private groups, constant,
varying or partial across the series, both on the keys as written and with the bytes the parser overwrites in a nested
key zeroed (*masked*, below); a row per instance group, one blob per series raw and at zstd-3, and §Repetition's
shared + per-instance; and for ct, pt and mr the converted-enhanced instance below, raw and at zstd-3.

**Converted enhanced is not implemented in the parser** (its source at `a65abe2`, below), so it is **simulated** on the
parser's groups, following PS3.3 2026d: the Legacy Converted Enhanced CT, MR and PET Image IODs (A.70, A.71, A.72) and
their Functional Group tables (A.70-2, A.71-2, A.72-2), the Multi-frame Functional Groups Module (C.7.6.16), and the
Unassigned Shared and Per-Frame Converted Attributes and Image Frame Conversion Source macros (C.7.6.16.2.25.1–3).
One instance holds the series: at its top level once, group 0002, the Image Pixel attributes, Image Type, SOP Common
and content date and time, from the first instance, with the SOP class made the legacy converted one and Number of
Frames added. Pixel Measures, Plane Position, Plane Orientation, Frame VOI LUT, Pixel Value Transformation, Irradiation
Event Identification, Referenced Image, Derivation Image and the modality's Frame Type each go once in the Shared
Functional Groups Sequence (5200,9229) when their records are the same in every instance, else whole in every frame's
item of the Per-Frame Functional Groups Sequence (5200,9230). Frame Content (acquisition date-time and number) and
Conversion Source (each source's SOP class and instance UID) are per frame, as the standard requires. Every other
attribute, the private group's included as C.7.6.16.2.25.1 says, goes once in Unassigned Shared when present in every
instance with the same value, else per frame in Unassigned Per-Frame; a top-level attribute that varies keeps the
first value at the top and every source's value per frame. Keys are DECK's: 8 bytes more per enclosing sequence, so a
macro's attribute has a 24-byte key; a sequence the parser wrote moves whole under its macro. No Frame Anatomy codes,
dimension index or stack position are invented.

**Known before the pre-registration** (the parser was built and run once on the five series to check that it runs, and
its source read; no size, ratio or repetition was computed):

* every run from a shell exits 0 (not every run from Python: Method notes, below); the frame files are full size, RGB
  included;
* **group 0002 is written in the instance group, not the private one**: `val` sends to the private group only
  (0002,0000), already dropped, and odd groups (`src/capi/uapi.c` line 1110), so (0002,0001)–(0002,0016) fall before
  the first listed tag and go to the instance group (§Repetition's split put them in the private group);
* **a sequence of the exam or series list keeps only its first attribute at that level**: the list index moves past
  the sequence's tag on its first attribute (line 1121), so its later attributes go to the instance group;
* **a nested attribute's key is overwritten**: the key is copied over the `struct KV` from its pointer field on
  (`src/capi/ESIPFfiled/capi.c` lines 529, 542, 617, 629), so in a 16-byte key the inner tag's last byte, its VR and
  charset become the value length and the last byte the low byte of the value's address. *Masked* zeroes the bytes
  taken from the address, from the key's 16th on (*corrected after the first run*: it first zeroed the length bytes
  too, which merged different attributes of one item into one key and made them look varying; and two records of one
  item whose values have the same length still mask to one key, 25 per instance in mr's private group and 13 in us's
  instance group, so a repeat within a group is numbered in the key's last byte);
* pt writes five series group files for its one series, and us two exam group files.

*Pre-registered, 2026-10-25, before the measurement ran.* Times are medians of 15 rounds, interleaved and rotated as in
§Repetition; one run of the parser, two of the measurement; bytes and ratios are deterministic. The host is a 4-vCPU
Xeon at 2.10 GHz, not §Repetition's 2.80 GHz, so only ratios and bytes compare with it.

| Prediction | Contradicted if |
| --- | --- |
| the metadata is ≥ 1.5× §Repetition's for ct, pt, mg and us, ≥ 1.15× for mr (the de-identification sequence's later records in every instance group) | smaller |
| the metadata is under 2 % of the stored pixels in every series | otherwise |
| every group file's name is the BLAKE3 of its bytes | one is not |
| the group files' allocation on disk is ≥ 3× their bytes for ct, pt, mg and us, ≥ 2× for mr | less |
| one stream at level 3 compresses at least as well as §Repetition's for ct, pt and mr; each group file alone ≤ 2.5× but mr | otherwise |
| level 19's stream at most 30 % smaller than level 3's; level 1's within 5 % of level 3's | otherwise |
| level 3's stream at ≥ 100 MB/s of tar on one core | slower |
| as written, ≥ 50 % of the instance groups' bytes are constant records for ct, pt and mr | less |
| the converted-enhanced instance weighs ≤ 40 % of a row per instance group (instance + private) for ct, pt and mr | more |
| it weighs more than §Repetition's shared + per-instance for ct, pt and mr (macro keys and a source reference per frame) | not more |
| one blob per series at zstd-3 weighs less than the converted-enhanced instance raw, for ct, pt and mr | more |

The host: one thread, every file in the page cache; nothing is claimed for parallel compression, a cold disk or
another host.

*Measured, 2026-10-25, two runs*, each parsing every series again into an emptied tree and measuring it. Bytes, files and ratios are identical in both runs except pt's, whose contents change from run to run
(below); a range is the two runs. Times are the two runs' medians, which agree within 10 %. *Metadata* is every group
file the parser wrote for the series; *HTJ2K* is §Repetition's coded size of the same pixels.

| Series | ct | pt | mr | mg | us |
| --- | ---: | ---: | ---: | ---: | ---: |
| instances | 262 | 262 | 145 | 4 | 12 |
| exam group files (bytes each) | 1 (596) | 1 (596) | 1 (513) | 1 (346) | 2 (424) |
| series group files (bytes each) | 1 (497) | 5 (750) | 1 (462) | 1 (208) | 1 (306) |
| instance groups (per instance, median) | 587 688 (2 243) | 586 378 (2 238) | 376 922 (2 598) | 8 412 (2 103) | 30 436 (2 469) |
| private groups (per instance, median) | 29 606 (113) | 29 606 (113) | 502 860 (3 468) | 220 (55) | 876 (73) |
| metadata | 618 387 | 620 330 | 880 757 | 9 186 | 32 466 |
| §Repetition's metadata (this ÷ that) | 404 382 (1.53×) | 318 500 (1.95×) | 762 692 (1.15×) | 6 741 (1.36×) | 16 842 (1.93×) |
| group files on disk (÷ their bytes) | 2 154 496 (3.48×) | 2 170 880 (3.50×) | 1 196 032 (1.36×) | 40 960 (4.46×) | 110 592 (3.41×) |
| frame files (= the pixel data's bytes) | 262 | 262 | 145 | 4 | 315 |
| directories (on disk) | 528 (2.2 MB) | 528 (2.2 MB) | 294 (1.2 MB) | 12 (49 KB) | 28 (115 KB) |
| pixels as written | 137 363 456 | 34 340 864 | 76 021 760 | 17 562 864 | 314 036 760 |
| metadata ÷ pixels as written | 0.45 % | 1.81 % | 1.16 % | 0.052 % | 0.010 % |
| metadata ÷ pixels in HTJ2K | 1.50 % | 8.0 % | 3.39 % | 0.26 % | 0.041 % |

The tree also holds one empty `serialized.bin` per working directory. Every group file's name is the BLAKE3 of its
bytes (1 385 files).

| zstd on the metadata: ratio, compress ms | ct | pt | mr | mg | us |
| --- | ---: | ---: | ---: | ---: | ---: |
| each group file alone, level 1 | 2.02×, 3.8 | 1.95×, 4.2 | 2.73×, 3.8 | 1.96×, 0.08 | 2.52×, 0.23 |
| each group file alone, level 3 | 2.09×, 4.2 | 2.01×, 4.7 | 2.83×, 4.1 | 2.02×, 0.08 | 2.58×, 0.27 |
| each group file alone, level 19 | 2.21×, 86 | 2.11×, 90 | 3.08×, 156 | 2.13×, 1.5 | 2.73×, 6.3 |
| one stream, level 1 | 18.50×, 0.75 | 16.37–16.41×, 0.81 | 27.15×, 0.68 | 4.20×, 0.03 | 8.43×, 0.06 |
| one stream, level 3 | 17.96×, 0.99 | 15.59–15.65×, 0.99 | 27.30×, 0.84 | 4.24×, 0.04 | 8.68×, 0.10 |
| one stream, level 9 | **19.11×**, 4.8 | **17.16–17.19×**, 5.4 | **31.28×**, 4.5 | 4.42×, 0.14 | 9.07×, 0.32 |
| one stream, level 19 | 18.86×, 114 | 17.11–17.19×, 147 | 31.16×, 88 | **4.52×**, 2.8 | **9.17×**, 10.6 |
| §Repetition's best stream | 9.70× | 7.87× | 27.8× | 3.23× | 4.81× |

Decompression is under 0.45 ms for any series' stream at any level.

| Repetition across the series | ct | pt | mr | mg | us |
| --- | ---: | ---: | ---: | ---: | ---: |
| instance-group attributes constant / varying / partial, as written | 64 / 7 / 0 | 53 / 10 / 826 | 79 / 11 / 0 | 65 / 7 / 2 | 17 / 10 / 199 |
| the same, masked | 64 / 7 / 0 | 64 / 10 / 0 | 79 / 11 / 0 | 65 / 7 / 2 | 55 / 10 / 44 |
| instance-group bytes that are constant records, as written (masked) | 87.3 % | 70.4 % (84.9 %) | 87.2 % | 86.2 % | 12.5 % (67.5 %) |
| private-group bytes that are constant records, as written (masked) | 100 % | 100 % | 63.8 % (96.6 %) | 100 % | 100 % |
| §Repetition: constant / varying / partial; constant bytes | 37 / 6 / 0; 82.7 % | 26 / 9 / 0; 70.0 % | 51 / 10 / 0; 83.4 % | 37 / 7 / 0; 79.6 % | 13 / 8 / 44; 23.0 % |
| a row per instance group (instance + private) | 617 294 | 615 984 | 879 782 | 8 632 | 31 312 |
| shared + per-instance, §Repetition's rule (of the rows) | 76 763 (12.4 %) | 175 416 (28.5 %) | 234 950 (26.7 %) | 3 028 (35.1 %) | 27 022 (86.3 %) |
| one blob per series, zstd-3 (of the rows) | 13 227 (2.1 %) | 18 040–18 122 (2.9 %) | 12 367 (1.4 %) | 1 162 (13.5 %) | 2 023 (6.5 %) |
| converted enhanced, simulated, raw (of the rows) | 107 429 (17.4 %) | 257 023 (41.7 %) | 376 031 (42.7 %) | — | — |
| the same at zstd-3 | 16 123 | 26 941–26 978 | 25 740 | — | — |
| converted enhanced, simulated, masked, raw (zstd-3) | 107 429 (16 064) | 126 262 (15 847) | 115 103 (15 088) | — | — |

**What varies**, masked, in the instance group: ct the SOP instance UID (and its copy in (0002,0003)), instance number,
image position, slice location, acquisition and content time; pt the same plus acquisition number, decay factor and
image index; mr the UIDs, number, position, content and instance creation time, temporal position, window centre and
width, zoom centre and factor; mg the UIDs, number, laterality, patient orientation, creation time and three records
of the view code sequence; us, two SOP classes, also its frame geometry and cine attributes. As written, every nested
record whose value sits at a different offset in its file has a different key: pt's 826 partial keys, us's 199, mr's
113 partial private keys.

Against the pre-registration:

| Prediction | Outcome |
| --- | --- |
| metadata ≥ 1.5× §Repetition's for ct, pt, mg, us; ≥ 1.15× for mr | **contradicted for mg** (1.36×); holds for ct, pt, us (1.53–1.95×) and mr (1.155×) |
| metadata under 2 % of the stored pixels, every series | holds (0.010–1.81 %) |
| every group file's name is its BLAKE3 | holds (1 385 of 1 385) |
| allocation ≥ 3× the bytes for ct, pt, mg, us; ≥ 2× for mr | **contradicted for mr** (1.36×: its private groups are 3.5 KB); holds for the rest (3.4–4.5×) |
| stream at level 3 at least §Repetition's for ct, pt, mr; files alone ≤ 2.5× but mr | stream holds (18.0, 15.6, 27.3× against 9.2, 7.4, 26.1×); **files alone contradicted for us** (2.58×) |
| level 19 at most 30 % smaller than level 3; level 1 within 5 % of level 3 | 19 holds (4.8–12.4 % smaller); **level 1 contradicted for pt in one run of two**, 5.05 % *smaller* than level 3 (4.4 % in the other); 0.6–3 % for the rest, smaller for ct |
| level 3 stream ≥ 100 MB/s of tar | holds (820–1 770 MB/s) |
| as written, ≥ 50 % of the instance groups' bytes constant for ct, pt, mr | holds (87.3, 70.4, 87.2 %) |
| converted enhanced ≤ 40 % of the rows for ct, pt, mr | **contradicted for pt and mr** (41.7, 42.7 %); holds for ct (17.4 %). Masked, 13–21 % |
| converted enhanced above §Repetition's shared + per-instance | holds (1.41×, 2.87×, 5.37×; masked 1.41×, 1.41×, 1.65×) |
| a blob per series at zstd-3 below converted enhanced raw | holds (8–30× below) |

* **The parser writes 1.15–1.95× the metadata §Repetition estimated**, for two reasons read in its source and seen in
  the bytes: the exam list's de-identification sequence (0012,0064) keeps only its first attribute in the exam group
  (596 B, against 1 431) and repeats its other 23 records (38 in us) in every instance group (2 243 B per CT instance,
  against 1 201); and group 0002 is in the instance group, so the private group is the odd groups alone (113 B, against 335).
  mr, whose vendor private group is most of its metadata, moves least.
* **It is 0.01–1.8 % of the pixels as written and 0.04–8 % of them in HTJ2K**, PET the largest (small frames, the
  repeated sequence in every instance).
* **The repetition is larger, so one stream compresses about twice as well as §Repetition's** (16–31× against 8–28×),
  while each file alone stays 2–3×. Level 1 is within about 5 % of level 3; the best of levels 9 and 19 is 3–13 %
  smaller than level 1, for 6–200× its time. A series' stream compresses in under 1.1 ms at level 1 or 3 on one core.
* **On disk, small files cost blocks**: the group files allocate 3.4–4.5× their bytes (one 4 KiB block for a 0.1–2.5 KB
  file), mr 1.4×; and each instance adds two directories (its own and `G/` or `R/`), 4 KiB each.
* **The key defect decides the shared share.** Where every instance's nested values sit at the same offsets (ct, mg),
  the keys repeat; where they do not (pt, mr's private group, us), the same attribute has a different key per instance,
  so a store keyed by the parser's key sees it as per-instance: converted enhanced is 42 % of the rows as written for pt
  and mr, 13–21 % masked. pt's tree also differs between two parses of the same files: it alone has attributes two
  sequences deep (3 per instance, in (0054,0410) Patient Orientation Code), whose key holds the value's whole address,
  which address-space randomisation changes per run (with it off, `setarch -R`, three parses gave the same bytes). Its
  BLAKE3 names then change on a re-parse, and the parser's skip of an existing group file does not apply.
* **Consequence for the database (b):** a constant record kept once leaves per instance what Legacy Converted
  Enhanced puts per frame, and the converted instance (shared once, per frame where it varies, a source reference per
  frame) weighs 13–21 % of the rows once the keys are deterministic, 1.4–1.7× §Repetition's shared + per-instance
  because DECK's macro keys are 24 bytes and every frame names its source. A zstd-3 blob per series is 1.4–2.9 % of the
  rows for ct, pt and mr, 8–30× smaller than converted enhanced raw (7–9× masked), but is not read one instance at a
  time.
* **Method notes.** The parser is run with `MALLOC_PERTURB_=255`, which makes glibc zero-fill every `malloc`: its first
  `mkdir` names the date directory from a buffer not yet terminated (`capi.c` lines 148–153), so without it the result
  depends on the heap's leftover bytes. Run from Python, the first CT instance exited 12 (`exitMkdirFailure`, "Failed to
  create directory mbTx/…_NO.ISO-8859-1"); from a shell it created a stray `mbTx~` beside `mbTx`. Found after the
  pre-registration, at the first run. Text keys under ISO_IR 100 carry charset index 1 (`01 00`); every value here is
  ASCII, so the UTF-8 conversion changes no length. Per-file times include the Python binding's call per file.
* **What it does not say.** The same TCIA de-identified series as §Repetition, with its limits; one parser run per
  measurement run, one host, one thread. The converted-enhanced instance is simulated, not written by the parser, and
  not validated by a DICOM validator; its top-level set and macro mapping are listed above, and it adds no Frame Anatomy
  code, dimension index or stack position. No SQLite page or index overhead is in the layouts' bytes.

### Converted enhanced in the parser at `a65abe2`: planned, not implemented

The PCS document asks for CT, MR and PT that the images be gathered into one multi-frame container and the metadata
replaced by a synthesis of all the instances' in the Legacy Converted Enhanced classes. (The sentence quoted to us for
this, from the owner's `pcs.pdf`, is not in the `pcs.pdf` committed upstream at `0b1169e`, whose closest text is
"transform CT, MR, PT series into converted enhanced ones (one multiframes instead of many monoframe)" and "(2)
consolidation of series frames … + eventual consolidation of CT, MR, PT into converted enhanced".) The parser does not
do it yet:

* the plan is written down in
  [`codec.md` lines 8–15](https://github.com/opendicom/DECK_WebTransport/blob/a65abe282b6d75210be0430da2e804991445f28f/DICMele2deck/src/capi/ESIPFfiled/codec.md#L8-L15)
  ("When possible, the PCS shall transform (a) into (b), identified by SOP Class (c)", with the CT, MR and PET
  Legacy Converted Enhanced classes) and as a later per-frame layout in
  [`ESIPFserialized/README.md` lines 57–62](https://github.com/opendicom/DECK_WebTransport/blob/a65abe282b6d75210be0430da2e804991445f28f/DICMele2deck/src/capi/ESIPFserialized/README.md#L57-L62);
* the code is one run per SOP instance that writes that instance's groups and frames and exits:
  [`ctrail`, `capi.c` lines 294–352](https://github.com/opendicom/DECK_WebTransport/blob/a65abe282b6d75210be0430da2e804991445f28f/DICMele2deck/src/capi/ESIPFfiled/capi.c#L294-L352)
  writes the instance group under the instance's own directory and
  [lines 407–512](https://github.com/opendicom/DECK_WebTransport/blob/a65abe282b6d75210be0430da2e804991445f28f/DICMele2deck/src/capi/ESIPFfiled/capi.c#L407-L512)
  its frames under it; nothing reads another instance, and no program in `DICMele2deck/` gathers a series;
* neither the Shared (5200,9229) nor the Per-Frame (5200,9230) Functional Groups Sequence, nor any functional group
  macro's tag, appears anywhere in `DICMele2deck/src` or `inc` (searched for the tags in both byte orders).

### Differences from `docs/ingest/contract.md` at `a65abe2`

`contract.md` describes the parser at `f36230b`; `DICMele2deck/` changed since only in `76b119b` (`src/main.c`: the
file buffer typed `u8`, which fixes the columns read as a signed byte) and `0b1169e` (adds `pcs.pdf`); the repository's
`README.md` now says the PCS "parses DICM SOP files into DECK file system" where it said "converts DICM to DECK sqlite".
What the contract says and the parser does not, found here (contract.md is not edited in this change):

* **Group 0002 is in the instance group**, not the private one (§Group files, and the f36230b names table): `val`
  sends only (0002,0000) and odd groups to the private group
  ([`uapi.c` line 1110](https://github.com/opendicom/DECK_WebTransport/blob/a65abe282b6d75210be0430da2e804991445f28f/DICMele2deck/src/capi/uapi.c#L1110)).
  The private group exists only when the instance has odd-group attributes.
* **A nested attribute's key is not the contract's**: its inner tag's last byte, VR and charset index are the value
  length, its last byte the low byte of the value's address; a key two deep holds the whole address and the next
  record's key length
  ([`capi.c` lines 529, 542, 617, 629](https://github.com/opendicom/DECK_WebTransport/blob/a65abe282b6d75210be0430da2e804991445f28f/DICMele2deck/src/capi/ESIPFfiled/capi.c#L617)
  copy `CKEYidx + 8` bytes over the `struct KV` from its pointer field; lines 56–62). The record framing (key length,
  value length, value) is intact.
* **A group's bytes are not a function of the file alone**: a key two sequences deep holds a whole address, so two
  parses of one pt file write different instance groups and BLAKE3 names; and as a one-deep key holds the address's
  low byte, instances that place a value at different offsets write several exam or series group files for one study
  or series (pt five series groups, us two exam groups), each "not rewritten".
* **A sequence of the exam or series list keeps only its first attribute at that level**; the rest go to the instance
  group ([`uapi.c` line 1121](https://github.com/opendicom/DECK_WebTransport/blob/a65abe282b6d75210be0430da2e804991445f28f/DICMele2deck/src/capi/uapi.c#L1121)).
* **RGB frame files are full size** (us: 2 073 600, 2 764 800 and 959 880 B, each rows × columns × 3); the finding
  "RGB frame files are short" no longer holds.
* **The date directory is made from an unterminated name** before its `/` is written
  ([`capi.c` lines 148–160](https://github.com/opendicom/DECK_WebTransport/blob/a65abe282b6d75210be0430da2e804991445f28f/DICMele2deck/src/capi/ESIPFfiled/capi.c#L148-L160)):
  a stray directory, or exit 12, depending on the heap.
* **Exit codes**: the enum after `exitNoArg1FilePath = -6` counts on from −5, so `exitMkdirFailure` is 12 (commented
  20) and `exitNotDICM` is 0, the success code
  ([`datatypes.h` lines 62–87](https://github.com/opendicom/DECK_WebTransport/blob/a65abe282b6d75210be0430da2e804991445f28f/DICMele2deck/inc/datatypes.h#L62-L87)).
* **The series, instance and private groups are hashed over the length summed before UTF-8 conversion**, the exam
  group over the bytes written (`capi.c` lines 195, 253, 333, 377): a text value whose UTF-8 is longer would leave the
  file's name not its BLAKE3. Read, not exercised: every value here is ASCII.
* **The build**: CMake 4.4.4 builds `ESIPFfiled` from the parser's own `CMakeLists.txt` (the contract built it by
  hand); `ESIPbasetags` does not link either (`iconAttribute`); `dicm2decksqlite` now stops first at compiling
  `src/deck_sqlite3.c` (`eblake3stmt` undeclared).
* **Fixed-size attribute tables** (`eKVs[100]`, `sKVs[150]`, `iKVs[350]`, `pKVs[20000]`, `capi.c` lines 67–70) are
  filled with no bound check. Read, not exercised.

## Updates on the link: whether a metadata-only package is worth compressing

[`update-link/`](update-link) asks one question: a package that carries only metadata (a correction from the
hospital-side PCS or from a client application, `docs/adr/metadata-updates.md` at `e6a8683`, #148;
`docs/adr/pcs-transfer.md` §5 and §8 at `a197b23`, #149) is small, so zstd changes its
size a lot in relative terms; does that shorten its transfer, or do round trips decide it either way? And if it is a
gain, is compressing the metadata always, whatever the package, simpler and harmless? For series packages §Repetition
above already answered: compressing saves at most 3.5 % of the package, so the owner's choice there is none.

```bash
.venv/bin/python -I lab/metadata-store/update-link/packages.py DATA OUT > packages.jsonl     # sizes and CPU
.venv/bin/python -I lab/metadata-store/update-link/wire.py packages.jsonl                    # the arithmetic
cargo build --release --locked --manifest-path lab/metadata-store/update-link/Cargo.toml
sudo .venv/bin/python -I lab/metadata-store/update-link/link.py OUT > link.jsonl             # the emulated links
python3 -I lab/metadata-store/update-link/summary.py packages.jsonl link.jsonl                 # medians, beside wire.py's
for t in packages wire link; do .venv/bin/python -B -I lab/metadata-store/update-link/${t}_test.py; done
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

*Measured and estimated, 2026-10-25.* Sizes and CPU: the five series, python-zstandard 0.25.0 (libzstd 1.5.7), one
thread of a 4-vCPU Xeon at 2.10 GHz, medians of 31 rounds, levels interleaved; sizes are deterministic. The links:
the same host, kernel 6.18, rustls 0.23.45, quinn 0.11.12 with h3 0.0.8, 12 rounds (GEO 8), every cell's variants
interleaved, 2 016 transfers, every one a `201` that read every byte.

| Kind (five series) | content B | raw package | in 10 240-B records | zstd-1 | zstd-3 | zstd-9 | whole package, zstd-1 | zstd-1 µs (decompress) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| exam-diff | 128 | 3 072 | 10 240 | 3 072 | 3 072 | 3 072 | 326–332 | 5–9 (3–5) |
| exam-group | 1 181–1 820 | 5 120–5 632 | 10 240 | 3 584 | 3 584 | 3 584 | 856–1 002 | 8–13 (4–6) |
| series-diff | 113 | 3 072 | 10 240 | 3 072 | 3 072 | 3 072 | 331–337 | 6–7 (3–4) |
| series-group | 208–1 075 | 4 096–5 120 | 10 240 | 3 072–3 584 | 3 072–3 584 | 3 072–3 584 | 501–949 | 6–9 (3–5) |
| instance-diff | 101 | 3 072 | 10 240 | 3 072 | 3 072 | 3 072 | 313–323 | 4–7 (3–4) |
| instance-group | 849–1 541 | 4 608–5 632 | 10 240 | 3 584 | 3 584 | 3 584 | 780–1 067 | 8–10 (3–6) |
| fanout-diff | 404–26 462 | 3 072–29 184 | 10 240–30 720 | 3 072–9 728 | 3 072–9 728 | 3 072–10 240 | 411–6 920 | 6–41 (3–17) |
| fanout-groups | 4 176–314 684 | 14 336–806 912 | 20 480–808 960 | 4 096–31 232 | 4 096–32 256 | 4 096–30 208 | 1 313–28 738 | 14–504 (6–111) |
| series-resend | 6 741–762 692 | 27 648–1 348 608 | 30 720–1 351 680 | 5 120–45 056 | 5 120–47 104 | 5 120–44 544 | 2 324–42 406 | 21–804 (9–220) |

The wire (*estimated*, `wire.py`; packets and round trips of ct, the other series alike unless named):

| ct package | TCP packets, round trips raw → zstd-1 | QUIC packets, round trips |
| --- | --- | --- |
| exam-diff, series-diff, instance-diff | 4, 3 → 4, 3 | 5, 2 → 5, 2 |
| exam-group, series-group, instance-group | 5, 3 → 4, 3 | 5–6, 2 → 5, 2 |
| fanout-diff | 22, 4 → 8, 3 | 27, 3 → 10, 2 |
| fanout-groups | 560, 8 → 23, 4 | 695, 8 → 29, 3 |
| series-resend (mr) | 934, 9 → 33, 5 (9 → 4) | 1 160, 8 → 41, 4 (8 → 3) |

The links (*measured*, median ms raw → zstd-1, and the gain in round trips of the class; *estimated* beside it):

| ct package | protocol | fiber, 10 ms | 4G/5G, 60 ms, 1 % | GEO, 600 ms | rural ADSL, 50 ms, 1 Mbit/s |
| --- | --- | --- | --- | --- | --- |
| exam-diff | TCP | 33 → 33 (0) | 186 → 187 (0) | 1 824 → 1 825 (0) | 192 → 192 (0) |
| | QUIC | 26 → 26 (0) | 129 → 128 (0) | 1 236 → 1 236 (0) | 166 → 166 (0) |
| exam-group | TCP | 34 → 34 (0.06) | 187 → 186 (0.01) | 1 833 → 1 826 (0.01) | 209 → 197 (0.24) |
| | QUIC | 26 → 26 (0.01) | 130 → 129 (0.02) | 1 244 → 1 238 (0.01) | 183 → 171 (0.25) |
| series-group | TCP | 34 → 33 (0.06) | 187 → 186 (0.01) | 1 828 → 1 826 (0) | 201 → 196 (0.09) |
| | QUIC | 26 → 25 (0.04) | 129 → 128 (0.01) | 1 240 → 1 238 (0) | 175 → 170 (0.08) |
| instance-group | TCP | 34 → 33 (0.09) | 188 → 186 (0.02) | 1 832 → 1 826 (0.01) | 209 → 197 (0.25) |
| | QUIC | 26 → 26 (0.01) | 130 → 129 (0.02) | 1 244 → 1 238 (0.01) | 183 → 171 (0.25) |
| fanout-diff | TCP | 46 → 34 (1.2) | 254 → 189 (1.1) | 2 481 → 1 853 (1.0) | 409 → 247 (3.2) |
| | QUIC | 48 → 37 (1.1) | 252 → 190 (1.0) | 2 440 → 1 827 (1.0) | 398 → 224 (3.5) |
| series-resend | TCP | 177 → 55 (12) | 1 925 → 315 (27) | 8 951 → 3 035 (9.9) | 11 359 → 540 (216) |
| | QUIC | 175 → 51 (12) | 3 391 → 276 (52) | 8 928 → 2 667 (10) | 11 433 → 542 (218) |
| mr series-resend | TCP | 176 → 47 (13) | 2 105 → 254 (31) | 8 929 → 2 491 (11) | 11 317 → 425 (218) |
| | QUIC | 175 → 48 (13) | 2 481 → 257 (37) | 8 687 → 2 448 (10) | 11 391 → 415 (220) |
| estimated, a correction | TCP · QUIC | 30 · 20 | 186 · 127 | 1 824–1 833 · 1 225–1 234 | 191–212 · 140–162 |
| estimated, ct series-resend | TCP · QUIC | 164 → 50 · 159 → 41 | 1 005 → 327 · 972 → 276 | 9 450 → 3 047 · 9 179 → 2 489 | 11 402 → 541 · 11 547 → 497 |

The forwarder's floor, no delay, rate or loss: 1.6–2.8 ms a correction and 16–20 ms a raw series-resend (1.35 MB,
≈ 600 Mbit/s): the fiber class's 100 Mbit/s is a sixth of it, and fiber's correction cells (25–34 ms) are within ten
times the floor, so **nothing is claimed for fiber's corrections** but the tie. A lost handshake packet costs TCP its
1 s initial RTO (RFC 6298 §2.1): on 4G/5G a few corrections of either variant took 1.1–1.2 s; the medians are
untouched.

Against the pre-registration:

| Prediction | Outcome |
| --- | --- |
| S1: corrections ≤ 8 KB raw | holds (3 072–5 632 B); **contradicted as tar is written by default**: Python's `tarfile` (and, by default, GNU tar and bsdtar) pad every archive to a 10 240-byte record, so every correction weighs 10 240 B, compressed or not |
| S2: zstd-1 saves a correction ≤ 2 896 B | holds (0–2 048 B) |
| S3: one or two records ≤ 4 KB raw, zstd saves ≤ 512 B | holds (3 072 B; zstd saves 0: the member's 512-byte padding swallows it) |
| S4: series-resend ≥ 2× its groups raw (ct, pt); zstd-1 ≤ 1/10 of raw (ct, pt, mr) | holds: 3.3× and 3.8×; 1/30, 1/28, 1/43 |
| W1: no correction crosses a round-trip boundary | holds, every series, TCP and QUIC |
| W2: series-resend saves ≥ 3 round trips (ct, mr) | holds: 4–5 (TCP), 4–5 (QUIC) |
| W3: fanout-diff saves ≤ 1 round trip | holds (1, or 0 for mg and us) |
| T1: a correction saves < 5 ms but on ADSL, < 30 ms there, < 2 % everywhere | **contradicted on GEO** (≤ 10.5 ms, the 2 Mbit/s serialisation of 2 KB) **and in % on ADSL** (≤ 17.6 ms, 10.8 %) |
| T2: series-resend saves ≥ 1.5 s GEO, ≥ 5 s ADSL, ≥ 150 ms 4G/5G, < 60 ms fiber | **contradicted for fiber** (103–127 ms); holds for the rest (5.8–7.2 s, 9.8–11.1 s, 0.62–0.76 s) |
| C1: a correction ≤ 50 µs to compress, ≤ 20 µs to decompress; a series-resend ≤ 2 ms | holds: ≤ 13 µs and ≤ 7 µs; ≤ 0.80 ms and ≤ 0.22 ms |
| E1: corrections tie within max(3 %, 2 ms) | **contradicted on ADSL for whole groups**, by the compressed variant winning: exam- and instance-group 12–13 ms (0.25 RTT) against a 5–6 ms band; ties everywhere else, never slower outside the band |
| E2: compressed series-resend ≥ 2 RTT faster on 4G/5G and GEO, ≥ 5 s on ADSL | holds: 27–52 and 10–11 RTT; 10.8–11.0 s |
| E3: measured within 25 % of the arithmetic on fiber, GEO, ADSL | **contradicted for QUIC in 12 of 42 cells**: fiber's corrections 25–26 % over, 5–6 ms, the forwarder's floor about half of it; flights of 9.7–31 KB took one round trip more than the arithmetic (fiber, GEO), so quinn's first flight held less than RFC 9002's 12 000 bytes after the handshake, not explained here; TCP within 25 % everywhere |
| E4: QUIC beats TCP on a correction by 0.7–1.3 RTT | holds on fiber, 4G/5G and GEO (0.74–0.98); **contradicted on ADSL** (0.51–0.54; *inference*: QUIC's Initial datagrams are padded to 1 200 bytes, RFC 9000 §14.1, 9.6 ms each at 1 Mbit/s) |

* **A single correction does not move.** Exam, series and instance corrections, whole or as differences, are 3–5.6 KB
  raw and 3–3.6 KB compressed: one flight either way, on every link and both protocols. The package is mostly tar's
  framing, which a compressed member keeps (two 512-byte headers, the end blocks). What compression saves is the
  serialisation of ≤ 2 KB: 12–13 ms on a 1 Mbit/s uplink, ≤ 10 ms estimated on GEO, nothing visible elsewhere. The
  owner's reading holds for these: round trips decide them (3 RTT on TCP with TLS, 2 on QUIC).
* **A re-send of a series' metadata, or a correction fanned out to every instance, does move.** A resend is 0.03–1.35 MB
  raw, of which tar's per-member headers are most (ct: 404 KB of groups in 1.35 MB, ≈ 1.8 KB a member with pax names
  past 100 bytes), and 5–45 KB compressed: 4–5 round trips fewer. Measured: 0.12 s saved on fiber, 1.6–3.1 s on
  4G/5G at 1 % loss (the raw transfer's ~1 000 packets expect ~10 losses, the compressed ~35 expect 0.35), 5.9–6.4 s on
  GEO and 10.8–11.0 s at 1 Mbit/s. A fan-out of one record over 262 instances (26 KB of differences) saves one round
  trip, 3.2–3.5 on ADSL.
* **Compressing is never slower.** In 56 measured pairs the compressed variant is never slower outside the tie band;
  its CPU is ≤ 13 µs a correction and ≤ 0.8 ms a resend to compress, ≤ 0.22 ms to decompress, on this host.
* **By the rule fixed above, always on.** Harmless everywhere, and worth it for series-resend and ct's fan-out on
  every class (≥ 1 RTT or ≥ 10 %); not for single corrections (6–7 % on ADSL, below the bar). Compressing every
  package's metadata, series packages included, is one path at both ends: the PCS compresses the group files' tar
  always, the PACS decompresses always, and #149's header flag "metadata zstd|none" is no longer needed. Its cost is a
  zstd library at each end (libzstd at the PCS; at the PACS the `zstd` crate, a libzstd binding, or `ruzstd`, a
  decoder in Rust, not compared here) and about ten lines each. Not compressing series packages while compressing
  updates is two paths and a rule; not compressing at all costs a 1 Mbit/s or GEO site seconds on every resend.
* **Two findings for #149's §4–§5** (`docs/adr/pcs-transfer.md` at `a197b23`, on its branch, not edited here): (1) §5 point (3), "Updates are latency-bound: compressing them saves nothing visible", holds for one
  correction and not for a resend or a fan-out, which save 1–5 round trips; its recommendation (the metadata as one
  zstd stream) is unchanged and is the form measured here. (2) §4's tar overhead, "~768 B" a member, is ≈ 1.8 KB
  with pax headers for the group files' long names (contract.md's coded UIDs and 64-hex names pass ustar's
  100-byte name field), and a package must end at its two zero blocks: Python's `tarfile` pads every archive to a
  10 240-byte record (measured here), and GNU tar and bsdtar do by default unless their record size is set to 512
  bytes (*not tested here*).
* **What it does not say.** One host and an emulated link: the forwarder is a FIFO with Bernoulli loss, no
  burst loss, no radio scheduling, no TCP-splitting proxy (GEO in practice often has one; #149 §3); the 4G/5G class
  is its loss tail, not its median. A fresh connection per package: a kept-open connection saves TCP's 2 and QUIC's 1
  handshake round trips for both variants and starts from whatever window is left (Linux restarts it after an idle
  RTO, RFC 5681 §4.1). Client certificates are one ECDSA P-256 leaf each (~0.5 KB); a hospital's RSA chain of 3–4 KB
  takes 2 segments of TCP's first flight from both variants alike. TCIA's de-identified headers; a hospital's may
  weigh more, which moves resends further toward compression and leaves corrections in one flight up to ~8 KB of
  group bytes (*estimated*). The PCS's own CPU is not measured.

## The study DB: a row per group, shared + per-frame, or a blob per series

[`src/study_db/`](src/study_db) asks, inside the study DB
([`docs/ingest/metadata-draft.md`](../../docs/ingest/metadata-draft.md) §2), how three layouts of a series' instance
metadata compare on the parser's real output for the five series above: **a row per group** (T1, the proposed one),
**shared + per-frame** (the series as one Legacy Converted Enhanced instance, DICOM's Shared and Per-frame Functional
Groups, PS3.3 C.7.6.16, kept as its shared row and a row per frame), and **a blob per series** (every instance's groups
in one zstd value). It is a cargo feature, out of the gate's build.

```bash
.venv/bin/python -I lab/metadata-store/study-db/package.py DATA BUILD/build/ESIPFfiled PKG   # the parser, then packages
cargo test -p metadata-store --features study-db --release
cargo run -p metadata-store --features study-db --release -- --mode study-db --packages PKG \
  --builds 30 --rounds 200 --updates 60 > study-db.jsonl
```

**The packages.** `package.py` runs the parser as §The parser's own output does (the same build, `MALLOC_PERTURB_`,
us rewritten Explicit first) and writes, per series, a deterministic pax tar of every group file at its path in the
tree, `<D>/<exam>/<series>/<instance>/<kind>.<hash>`: the package the PCS sends (#149, one per series). Two inputs:
**as written**, and **masked**, the instance and private groups with that section's key mask (a repeat numbered),
standing for the parser once its nested keys are deterministic. A package with several series or exam group files (pt,
us) keeps the first by path. The directory names are the UIDs.

**The layouts**, each one SQLite file in WAL at `synchronous=FULL` (rusqlite 0.40, bundled SQLite), every row with
the XXH3-64 of its bytes. All three keep the exam group and the series group a row each (`exam`, `series`) and an
`audit` table (who, when, the scope, the tag, the prior value, the new one: the record decided on 10-24/25).

* **Row per group:** `instance (uid PRIMARY KEY, series, bytes, xxh3)` indexed on `(series, uid)`, and `private
  (uid PRIMARY KEY, bytes, xxh3)` where the instance has one. The bytes are the group files as received.
* **Shared + per-frame:** the records of §The parser's own output's simulated converted-enhanced instance, ported to
  Rust (`shared.rs`) and checked byte for byte against that Python on every package before anything is timed; its
  top level and Shared Functional Groups item in `shared (series PRIMARY KEY, bytes, xxh3)`, each Per-Frame item in
  `frame (uid PRIMARY KEY, series, number, bytes, xxh3)` indexed on `(series, number)`. Only CT, MR and PET have a
  Legacy Converted class, so **mg and us have no shared + per-frame store**, and no correction is measured on them.
  The conversion keeps group 0002 and the top-level image attributes of the first instance only and re-encodes the
  SOP class, SOP instance UID, acquisition date, time and number; the received groups cannot be given back byte for
  byte.
* **Blob per series:** `blob (series PRIMARY KEY, bytes, xxh3)`, per instance its UID, its instance group and its
  private group, length-prefixed, compressed by zstd 0.13 (libzstd) at level 3.

**What is timed**, per series and input, each a median of its rounds, ms of wall and of the thread's CPU:

* **build:** read the package file, unpack it, create the file, insert, commit;
* **size:** the file after its last connection closes (WAL checkpointed and removed), and the bytes of every row;
* **paint:** open the file read-only and read every instance's paint values (`group::PAGE_TAGS`, top level; in shared
  + per-frame the frame's value over the shared one over the top level);
* **full:** open and parse every stored record of the series (exam, series, every row);
* **integrity:** open and check every row's bytes against its XXH3;
* **corrections**, ct, pt and mr, each in one transaction with its audit row, on a held read-write connection: **exam**,
  the patient name (the exam group, the same code in every layout); **instance, varying**, the middle instance's image
  position (per frame already); **instance, shared**, the middle instance's slice thickness (in every instance with
  one value, so in the shared row: the correction splits its Pixel Measures group into every frame, the others
  keeping the old value); **series, shared**, the slice thickness of every instance (in shared + per-frame it stays
  in the shared row). Each correction is undone untimed (instance, shared by a series correction back, which joins
  the shared row again), and the store must then hold exactly the bytes it was built with. A correction's rows
  written, whether the attribute ends shared, and the bytes after it are reported once.
* **owned lines:** the code lines (not blank, not `//`) of `mod.rs` (the package, the exam and audit, the checks,
  shared by all three) and of each layout's file.

**Arms**, interleaved round by round with the order rotated: each layout and its A/A twin on its own file (six arms,
four for mg and us); 30 builds, 200 rounds of each read and of the check, 60 of each correction; two runs. Before any
timing every store must give the same paint values as the row per group, the blob every received record, and shared +
per-frame every received record in its frame's view (but group 0002 and the re-encoded five).

*Known before the pre-registration:* the code above, its six tests (each mutated: the placement made always shared,
the split ignoring its frame, the join never taken, the frame's value not read, the check skipped, the blob's private
group dropped, a series correction made to touch one row, the audit dropped; each failed a test) and one pass of the
run with one round of everything and its output discarded, to see the checks hold; nothing timed or sized was read.
The owned lines are fixed by the code: 228 common, 67 row per group, 341 shared + per-frame, 69 blob per series.
The masked references differ from §The parser's own output's masked conversion only in numbering a repeated key
(mr, 115 103 B either way).

*Pre-registered, 2026-10-26, before any timing.*

| Prediction | Contradicted if |
| --- | --- |
| shared + per-frame's file is ≤ 0.35× the row per group's for ct, pt and mr masked, ≤ 0.6× as written | larger |
| the blob's file is ≤ 0.1× the row per group's, every series | larger |
| every layout builds within 2× the row per group's median, every series; shared + per-frame the slowest for ct, pt, mr | otherwise |
| paint: shared + per-frame below the row per group by more than the larger A/A gap and by ≥ 25 %, ct, pt, mr, both inputs | otherwise |
| paint: the blob within ± 25 % of the row per group, every series | outside |
| full: shared + per-frame ≥ 2× faster than the row per group for ct, pt and mr masked; the blob within ± 25 % | otherwise |
| exam: the three layouts tie (within the larger A/A gap) | one does not |
| instance, varying: the row per group and shared + per-frame tie, one row each; the blob ≥ 1.5× the row per group | otherwise |
| instance, shared: shared + per-frame writes N + 1 rows, ends per-frame, and takes ≥ 3× the row per group | otherwise |
| series, shared: shared + per-frame writes one row, stays shared, and takes ≤ 0.5× the row per group (N rows) | otherwise |
| every correction's median ≤ 50 ms, every layout | over |
| integrity: blob < shared + per-frame < row per group at the median, ct, pt, mr | another order |
| every correction undone leaves the store as built; every check above holds | one does not |

**The rule.** A layout is faster or slower than another in a cell when their medians differ by more than the larger
of their A/A gaps (|X − X′|) in both runs; otherwise the cell is a tie. Shared + per-frame or the blob replaces the
row per group only if, for each of ct, pt and mr, in both runs: (1) its paint read is faster and at least 25 % below;
(2) its file is ≤ 0.5× the row per group's; (3) its build median ≤ 2× the row per group's; (4) every correction's
median ≤ 50 ms. If both qualify, the one with fewer owned lines; if neither, the row per group, which owns the fewest
(at equal function the simpler code wins). The rule is applied to each input; if they disagree, the masked input's
choice holds once the parser's keys are deterministic and the as-written one's until then. Full, integrity and the
lines are reported, not decided on.

The host: one thread, every file in the page cache; a commit's `fsync` goes to the VM's virtual disk. Whether a
correction or a build saturates its core is its CPU time against its wall time; nothing is claimed for many studies,
concurrent writers, a cold disk or another host.

*Measured, 2026-10-26, two runs* of the packages below (pt's change from parse to parse, §The parser's own output),
the 2.10 GHz host of §The parser's own output. A range is the two runs' medians, both A/A arms included. The largest
A/A gap of a cell: 0.10 ms in paint, 0.09 ms in integrity, 0.77 ms in full, 2.0 ms in a build, 0.3–0.5 ms in a
correction (up to 0.6× its median: a commit waits on `fsync`). Every check
held in both runs: the Rust conversion equalled the Python one on all six references, every store painted the same
values, the row and blob layouts gave back every received record (19 912 for ct), shared + per-frame every one in its
frame's view (17 292 for ct), and every correction undone left its store as built (8 640 times per run).

| masked: rows \| shared + per-frame \| blob | ct | pt | mr |
| --- | ---: | ---: | ---: |
| file, KiB | 1200 \| 212 \| 48 | 1200 \| 228 \| 48 | 1236 \| 216 \| 44 |
| row bytes, KB | 618 \| 109 \| 20 | 617 \| 128 \| 20 | 881 \| 116 \| 15 |
| build, ms | 22.7–23.9 \| 22.8–25.4 \| 11.7–12.3 | 22.2–24.2 \| 20.8–22.6 \| 10.5–12.0 | 20.7–23.8 \| 26.5–29.0 \| 9.7–11.0 |
| paint, ms | 2.13–3.20 \| 0.60–0.93 \| 1.63–2.52 | 2.09–2.17 \| 0.64–0.74 \| 1.60–1.68 | 1.65–1.75 \| 0.66–0.71 \| 1.76–1.82 |
| full, ms | 3.02–3.62 \| 0.63–0.68 \| 2.66–3.06 | 2.87–3.14 \| 0.73–1.22 \| 2.66–3.09 | 3.95–4.66 \| 0.67–0.71 \| 3.77–4.46 |
| integrity, ms | 0.55–0.63 \| 0.23–0.29 \| 0.13–0.15 | 0.64–0.71 \| 0.28–0.34 \| 0.16–0.18 | 0.55–0.72 \| 0.22–0.33 \| 0.12–0.16 |
| exam, ms | 0.39–0.70 \| 0.44–0.75 \| 0.40–0.61 | 0.42–0.60 \| 0.52–0.61 \| 0.42–0.51 | 0.41–0.65 \| 0.46–0.86 \| 0.39–0.51 |
| instance, varying, ms | 0.60–0.71 \| 0.53–0.70 \| 1.80–2.06 | 0.61–0.75 \| 0.56–0.72 \| 1.82–1.96 | 0.50–0.63 \| 0.54–0.93 \| 1.75–1.94 |
| instance, shared, ms | 0.70–0.77 \| 2.50–2.65 \| 1.78–2.08 | 0.65–1.00 \| 2.47–3.05 \| 1.78–2.28 | 0.61–0.76 \| 1.79–2.11 \| 1.50–2.95 |
| series, shared, ms | 8.23–8.69 \| 0.49–0.82 \| 3.11–3.88 | 8.18–9.50 \| 0.47–0.85 \| 3.30–4.25 | 3.82–4.02 \| 0.51–0.76 \| 2.90–4.57 |
| instance, varying: rows written; ends shared | 1 \| 1; no \| 1 | 1 \| 1; no \| 1 | 1 \| 1; no \| 1 |
| instance, shared: rows written; ends shared | 1 \| 263; no \| 1 | 1 \| 263; no \| 1 | 1 \| 146; no \| 1 |
| series, shared: rows written; ends shared | 262 \| 1; yes \| 1 | 262 \| 1; yes \| 1 | 145 \| 1; yes \| 1 |

| as written: rows \| shared + per-frame \| blob | ct | pt | mr |
| --- | ---: | ---: | ---: |
| file, KiB | 1200 \| 212 \| 48 | 1200 \| 428 \| 52 | 1236 \| 644 \| 44 |
| row bytes, KB | 618 \| 109 \| 20 | 617 \| 258 \| 25 | 881 \| 377 \| 16 |
| build, ms | 21.0–22.4 \| 19.2–21.7 \| 9.8–10.4 | 20.2–25.0 \| 21.1–25.4 \| 10.7–14.4 | 18.9–22.0 \| 30.3–34.4 \| 8.7–11.4 |
| paint, ms | 1.99–2.05 \| 0.55–0.61 \| 1.52–1.63 | 2.10–2.20 \| 1.06–1.11 \| 1.68–1.80 | 1.65–1.74 \| 1.30–1.46 \| 1.76–1.87 |
| full, ms | 2.81–3.36 \| 0.62–0.76 \| 2.50–2.88 | 2.92–3.23 \| 1.09–1.63 \| 2.62–3.27 | 3.95–4.72 \| 1.24–1.44 \| 4.07–4.50 |
| integrity, ms | 0.61–0.73 \| 0.25–0.36 \| 0.14–0.20 | 0.60–0.70 \| 0.35–0.40 \| 0.15–0.20 | 0.55–0.62 \| 0.37–0.43 \| 0.13–0.19 |
| exam, ms | 0.36–0.63 \| 0.42–0.69 \| 0.35–0.54 | 0.40–0.70 \| 0.53–0.70 \| 0.42–0.64 | 0.39–0.64 \| 0.51–0.67 \| 0.40–0.62 |
| instance, varying, ms | 0.58–0.61 \| 0.53–0.62 \| 1.69–1.83 | 0.63–0.74 \| 0.63–0.77 \| 1.63–1.92 | 0.56–0.82 \| 0.66–0.85 \| 2.60–3.45 |
| instance, shared, ms | 0.74–0.89 \| 2.41–2.70 \| 2.43–2.88 | 0.80–0.86 \| 3.30–3.58 \| 1.75–2.18 | 0.79–0.88 \| 4.14–4.75 \| 2.86–3.31 |
| series, shared, ms | 8.22–8.89 \| 0.44–0.75 \| 3.68–4.40 | 8.09–8.56 \| 0.54–0.76 \| 3.90–4.31 | 3.96–4.51 \| 0.60–0.85 \| 3.72–4.46 |
| instance, varying: rows written; ends shared | 1 \| 1; no \| 1 | 1 \| 1; no \| 1 | 1 \| 1; no \| 1 |
| instance, shared: rows written; ends shared | 1 \| 263; no \| 1 | 1 \| 263; no \| 1 | 1 \| 146; no \| 1 |
| series, shared: rows written; ends shared | 262 \| 1; yes \| 1 | 262 \| 1; yes \| 1 | 145 \| 1; yes \| 1 |

| mg, us: rows \| blob | mg | us |
| --- | ---: | ---: |
| file, KiB | 60 \| 32 | 92 \| 32 |
| build, ms | 6.65–7.88 \| 5.88–6.22 | 7.71–8.71 \| 5.78–6.97 |
| paint, ms | 0.17–0.23 \| 0.19–0.24 | 0.26–0.35 \| 0.27–0.36 |
| full, ms | 0.24–0.32 \| 0.27–0.38 | 0.29–0.34 \| 0.36–0.41 |
| integrity, ms | 0.13–0.15 \| 0.11–0.13 | 0.14–0.15 \| 0.12 |

Owned lines: 228 common, and 67 row per group, 341 shared + per-frame, 69 blob per series (with zstd, a C library).

Against the pre-registration:

| Prediction | Outcome |
| --- | --- |
| shared + per-frame's file ≤ 0.35× the rows' masked, ≤ 0.6× as written | holds: 0.18–0.19× masked; 0.18, 0.36 and 0.52× as written |
| the blob's file ≤ 0.1× the rows', every series | **contradicted for mg and us** (0.53×, 0.35×: SQLite's eight pages are most of their file); holds for ct, pt, mr (0.04×) |
| every layout builds within 2× the rows'; shared + per-frame the slowest for ct, pt, mr | 2× holds (≤ 1.64×); **slowest contradicted for ct and pt** (a tie with the rows, 0.93–1.08×); mr holds (1.22–1.64×). The blob builds in half the time |
| paint: shared + per-frame faster and ≥ 25 % below, ct, pt, mr, both inputs | **contradicted for mr as written** (0.78–0.84×); holds for the rest (0.29–0.50×) |
| paint: the blob within ± 25 % | **contradicted for ct masked in run 2** (0.746×); holds for the rest (0.75–1.10×) |
| full: shared + per-frame ≥ 2× faster masked; the blob within ± 25 % | 2× holds (0.15–0.40×); **the blob contradicted for ct** (0.744–0.745× in one run of each input); holds for the rest |
| exam: the three tie | **contradicted**: shared + per-frame is 1.4–1.6× the rows beyond the A/A gap for ct and pt, both inputs, and mr as written; the same code on the same tables, not explained here. The blob ties |
| instance, varying: rows and shared + per-frame tie; the blob ≥ 1.5× | **tie contradicted for mr masked** (1.29–1.53×); holds for the rest; the blob holds (2.6–4.6×) |
| instance, shared: N + 1 rows, ends per-frame, ≥ 3× the rows | rows and ending hold; **3× contradicted for ct as written in run 1 (2.94×) and mr masked (2.81–2.82×)**; holds for the rest (3.0–5.4×) |
| series, shared: one row, stays shared, ≤ 0.5× the rows | holds: 0.08–0.20×, against the rows' N rows in 3.8–9.5 ms |
| every correction ≤ 50 ms | holds: at most 9.5 ms |
| integrity: blob < shared + per-frame < rows | holds in every cell |
| every undo leaves the store as built; every check holds | holds |

**By the rule:** as written, **neither qualifies**: shared + per-frame fails (1) and (2) on mr (paint 0.78–0.84×,
file 0.52×) and the blob fails (1) everywhere (0.75–1.10×). Masked, **shared + per-frame qualifies** on ct, pt and mr
in both runs (paint 0.29–0.41×, file 0.18–0.19×, build ≤ 1.30×, corrections ≤ 3.1 ms); the blob does not. The inputs
disagree, so: **a row per group while the parser's nested keys hold address bytes; shared + per-frame once they are
deterministic.**

* **What decides it is the key defect.** Where the keys repeat (ct, and pt and mr masked) the converted instance's
  rows weigh 109–128 KB against the groups' 617–881 KB, and reading a series' paint values parses that instead of
  every group: 0.55–0.93 ms against 1.65–3.2 ms opened. As written, mr's vendor private records carry a different key
  in every instance, so they are per frame (377 KB) and the gain shrinks to 16–22 %.
* **Corrections go as the standard's structure says.** An attribute shared by the series, corrected in every
  instance, stays shared: one row, 0.4–0.9 ms, against 262 rewritten rows and 8–9.5 ms (3.8–4.5 ms for mr's 145). The
  same attribute corrected in one instance splits its functional group into every frame: 263 rows, 1.8–4.8 ms against
  0.6–1.0 ms, and the rows' bytes grow by 17–23 KB until it is corrected back. An attribute already per frame costs one
  row in both. Every correction is under 10 ms in every layout; a commit is mostly `fsync` (CPU 0.25–0.45 of the wall
  for a one-row correction).
* **The blob** is the smallest (15–25 KB of rows, 44–52 KiB of file), builds in half the time and checks fastest, but
  every instance correction decompresses and recompresses the series (1.5–3.5 ms, 2.3–4.6× the rows) and its reads
  parse every group as the rows do (0.75–1.10×).
* **Integrity** checks only what each layout stores: shared + per-frame's rows are its own, so a received group's hash
  cannot be checked after the conversion; the rows and the blob keep the received bytes.
* **Where the host saturates:** reads are one core's CPU (CPU ÷ wall 0.98–1.00); builds and corrections wait on the
  commit's `fsync` (0.25–0.88). Nothing is claimed for many studies at once, concurrent writers or a cold disk. The
  converted instance is simulated (§The parser's own output), and mg and us, which have no Legacy Converted class,
  were measured for the rows and the blob only.

The packages, SHA-256:

```text
84fca6de60bd1f82189dff09878f3554e82dd7c9a55cfb5bc52d9fe08a3dfc06  ct.masked.tar
726696b01200fb1781a4686e17875082623058646fe30ca7a54061a1f9f2dfb6  ct.tar
b38dd53c32c6e7e98d82ae3a290c30c36dc49a9f1dec6249c7220d2d65e18fa2  mg.masked.tar
a49cc1493f00a0ea2921e452c7e23bc7f08fcb94c9c7de262a635e28806357a5  mg.tar
1510503a4cb777313920ef3d1c24d50da8fb9c9ca0a23b6f3827ddd3ef05e52e  mr.masked.tar
87404b3fc08712f9dc26742e8f143ef53ba689590b115ef29180bb61fb9831be  mr.tar
dc06e4f82bc2eb4ba34b25b431b74b50ae61180f2a7d4c45ba5e78cb1540517b  pt.masked.tar
43d6f59d0f9f5ee8ce7b8e0009d6cd36c9e92e124c864931c78aea16bb40cd26  pt.tar
008c9da742e0bcd6588d91cea519eb3354ee805f83a0c8e06b9ad46bbbcd371e  us.masked.tar
c5604f1c4384b340216b7369b98940a3db91e0261060ce5a84f1d541d3a29f97  us.tar
```

## Compression of the converted-enhanced layout: zstd on a series' metadata as one stream

[`src/study_db/ratio.rs`](src/study_db/ratio.rs) asks what zstd makes of a series' metadata as one stream once the
series is one Legacy Converted Enhanced instance, which takes out at the source the repetition (§Repetition, 70–83 %
of the instance group) that one stream was compressing. Decided before it (10-25/26): frames are never compressed
again; only the metadata is, as one stream, on links where it gains (`docs/ingest/pacs-receive-design.md` §2). It
reports, and decides nothing.

```bash
cargo test -p metadata-store --features study-db --release
cargo run -p metadata-store --features study-db --release -- --mode ce-ratio --packages PKG --rounds 50 > ce-ratio.jsonl
```

**The packages** are §The study DB's, rebuilt by `package.py` (SHA-256 below that section; pt as written differs, as
it does from parse to parse). **The layouts**, each one stream of `[u32 LE length][bytes]` parts: **groups**, the
exam group, the series group, then each instance's group and private group as received; **converted enhanced**, the
exam group, the series group and §The study DB's converted instance (`shared::converted`, checked equal to the Python
reference on every package) as one group. The two inputs give the three arms asked: (a) groups, (b) converted
enhanced as written, (c) converted enhanced masked; groups masked is reported too. mg and us have no Legacy Converted
class: groups only. The conversion keeps group 0002 and the re-encoded attributes of the first instance only, so (b)
and (c) carry less than (a) (§The study DB). Tar headers and paths are not in the stream; the package tar's size is
reported beside it.

**What is measured**, per series, input, layout and zstd level 1, 3 and 19 (zstd crate 0.13, libzstd as linked,
`bulk` API, one thread): the stream's bytes raw and compressed, their ratio; median thread CPU ms to compress and to
decompress over 50 rounds, the six arms (two layouts × three levels) interleaved in each round, the order rotated;
two runs. Every round's output must equal the first compression and give the stream back. **The package** is the
metadata plus the series' frames coded HTJ2K-lossless as §Repetition measured them (41 184 983 B ct, 7 707 320 pt,
25 959 791 mr, 3 480 592 mg, 78 499 765 us); the metadata's share of it raw and compressed. **Send time**, arithmetic:
bytes × 8 ÷ the uplink of #156's link classes, fiber 100, 4G/5G 19, rural ADSL 1 Mbit/s — the saving of compressing
a layout's stream, and of sending it compressed instead of today's groups raw. A package of megabytes is bound by its
uplink; round trips, slow start and 4G/5G's loss are left out, so these are lower bounds on the time and not
measured on a link.

**No dictionary.** A dictionary trained per modality needs other series of that modality to train on; there is one
series per modality here, and one trained on the stream it compresses measures nothing. Not measured.

*Known before the pre-registration:* §The study DB's row bytes, which are near these streams raw (rows: 618, 617,
881 KB; converted 109, 128, 116 KB masked, 109, 258, 377 as written, for ct, pt, mr) and its blob of the groups at
level 3 (20, 20, 15 KB masked); the code above, its three tests (each mutated: the private group dropped, the exam
group dropped, the converted instance cut, bytes taken for bits, ADSL's downlink for its uplink; each failed a test);
the packages' hashes. No stream was compressed or timed.

*Pre-registered, 2026-10-26, before any run.*

| Prediction | Contradicted if |
| --- | --- |
| (c) at level 3 compresses 5–15×, ct, pt, mr | outside |
| (c) at level 3 weighs 0.3–0.8× groups masked at level 3, ct, pt, mr: the conversion removes repetition zstd mostly removed already | outside |
| (b) at level 3 weighs 0.5–1.0× (a) at level 3, ct, pt, mr | outside |
| level 19 is at most 15 % smaller than level 1, every arm; ≥ 20× its compress CPU | otherwise |
| level 1 compresses (c) in ≤ 0.5 ms and (a) in ≤ 2 ms CPU; every arm decompresses in ≤ 0.5 ms | over |
| compressed, the metadata is ≤ 0.5 % of the package, every series and layout | more |
| compressing (c) at level 1 saves 0.4–1.5 s on rural ADSL and ≤ 10 ms on fiber, ct, pt, mr | otherwise |
| (c) compressed against (a) compressed (level 1): ≤ 100 ms apart on rural ADSL, ≤ 1 ms on fiber | more |

*Measured, 2026-10-26, two runs* on the 2.10 GHz host of §The study DB, zstd 1.5.7. Bytes and ratios are
deterministic and equal in both runs; a time is the two runs' medians (thread CPU, which equals the wall within 3 %:
one core, saturated). Every check held: the Rust conversion equalled the Python on all six references, every round
compressed to the same bytes and gave the stream back.

| zstd, one stream: bytes raw → compressed (ratio) | ct | pt | mr |
| --- | ---: | ---: | ---: |
| (a) groups as written, raw | 620 491 | 619 434 | 881 925 |
| (a) level 1 | 13 823 (44.9×) | 17 648 (35.1×) | 11 944 (73.8×) |
| (a) level 3 | 14 391 (43.1×) | 19 281 (32.1×) | 12 958 (68.1×) |
| (a) level 19 | 13 023 (47.6×) | 15 579 (39.8×) | 11 087 (79.5×) |
| groups masked, level 1 / 3 / 19 | 13 762 / 14 327 / 12 957 | 12 930 / 13 809 / 11 622 | 11 538 / 11 869 / 10 631 |
| (b) converted enhanced as written, raw | 108 534 | 258 381 | 377 018 |
| (b) level 1 | 16 530 (6.57×) | 25 926 (9.97×) | 24 352 (15.5×) |
| (b) level 3 | 16 785 (6.47×) | 27 704 (9.33×) | 26 195 (14.4×) |
| (b) level 19 | 13 373 (8.12×) | 22 891 (11.3×) | 20 158 (18.7×) |
| (c) converted enhanced masked, raw | 108 534 | 127 620 | 116 090 |
| (c) level 1 | 16 480 (6.59×) | 16 232 (7.86×) | 14 791 (7.85×) |
| (c) level 3 | 16 721 (6.49×) | 16 623 (7.68×) | 15 699 (7.39×) |
| (c) level 19 | 13 285 (8.17×) | 14 072 (9.07×) | 12 291 (9.45×) |

mg and us, groups only (as written; masked within 15 %): raw 9 226 and 32 146 B; level 1 1 461 (6.3×) and 2 446
(13.1×), level 19 1 350 and 2 149.

| CPU ms, compress (decompress) | level 1 | level 3 | level 19 |
| --- | ---: | ---: | ---: |
| (a) ct, pt, mr | 0.31–0.39 (0.13–0.22) | 0.40–0.53 (0.11–0.19) | 79–148 (0.20–0.25) |
| (b) ct, pt, mr | 0.21–0.43 (0.10–0.20) | 0.23–0.49 (0.09–0.20) | 37–166 (0.11–0.31) |
| (c) ct, pt, mr | 0.22–0.23 (0.10–0.11) | 0.26–0.30 (0.09–0.11) | 38–52 (0.11–0.14) |
| mg, us | 0.03–0.05 (0.02–0.03) | 0.04–0.06 (0.02–0.03) | 1.5–8.1 (0.02–0.04) |

| The package (metadata + HTJ2K frames) and the send time saved, arithmetic | ct | pt | mr |
| --- | ---: | ---: | ---: |
| metadata's share raw: (a) / (b) / (c) | 1.48 / 0.26 / 0.26 % | 7.44 / 3.24 / 1.63 % | 3.29 / 1.43 / 0.45 % |
| metadata's share at level 1: (a) / (b) / (c) | 0.034 / 0.040 / 0.040 % | 0.23 / 0.34 / 0.21 % | 0.046 / 0.094 / 0.057 % |
| compressing (a) at level 1 saves, fiber / 4G/5G / rural ADSL | 49 ms / 0.26 s / 4.9 s | 48 ms / 0.25 s / 4.8 s | 70 ms / 0.37 s / 7.0 s |
| compressing (b) at level 1 saves | 7 ms / 39 ms / 0.74 s | 19 ms / 98 ms / 1.9 s | 28 ms / 0.15 s / 2.8 s |
| compressing (c) at level 1 saves | 7 ms / 39 ms / 0.74 s | 9 ms / 47 ms / 0.89 s | 8 ms / 43 ms / 0.81 s |
| (c) at level 1 against (a) at level 1, on rural ADSL | 21 ms slower | 11 ms faster | 23 ms slower |
| the whole package at (a) level 1 on rural ADSL, for scale | 330 s | 61.8 s | 207.8 s |

Level 3 and level 19 move the savings by under 2 % (at most 35 ms on rural ADSL, mr (b) at level 19). For mg and
us, compressing the groups at level 1 saves 62 and 238 ms on rural ADSL, under 3 ms on fiber.

Against the pre-registration:

| Prediction | Outcome |
| --- | --- |
| (c) at level 3 compresses 5–15× | holds: 6.5–7.7× |
| (c) at level 3 weighs 0.3–0.8× groups masked at level 3 | **contradicted, the other way: 1.17–1.32×** (ct 16 721 against 14 327 B, pt 16 623 against 13 809, mr 15 699 against 11 869) |
| (b) at level 3 weighs 0.5–1.0× (a) at level 3 | **contradicted, the other way: 1.17× ct, 1.44× pt, 2.02× mr** |
| level 19 ≤ 15 % smaller than level 1, every arm; ≥ 20× its CPU | **contradicted for converted enhanced on ct and mr** (17–19 % smaller, both inputs); holds for the groups (5.8–14.4 %) and pt (11.7–13.3 %); the CPU holds (36–380×) |
| level 1: (c) ≤ 0.5 ms, (a) ≤ 2 ms; every decompression ≤ 0.5 ms | holds: 0.22–0.23 ms, 0.31–0.39 ms; decompression ≤ 0.31 ms |
| compressed, the metadata ≤ 0.5 % of the package | holds: ≤ 0.36 % (pt (b) at level 3) |
| compressing (c) at level 1 saves 0.4–1.5 s on rural ADSL, ≤ 10 ms on fiber | holds: 0.74–0.89 s; 7–9 ms |
| (c) and (a) compressed at level 1 within 100 ms on rural ADSL, 1 ms on fiber | holds: 11–23 ms; ≤ 0.23 ms |

* **The converted instance is 4.9–7.6× smaller raw and compresses 6.5–9.5× masked, against 32–83× for
  the groups — and ends larger than the groups' stream:** 1.17–1.32× masked, 1.17–2.0× as written, at levels 1 and 3.
  zstd already removed the series' repetition from the groups' stream, so the conversion has little left to take;
  what it adds costs more than that. *Inference, not measured:* every per-frame record carries its frame's number in
  its key (`(5200,9230)` item n), so no two frames' records match byte for byte, where two instance groups match
  but for a few values. As written (b), the parser's nested keys hold address bytes that differ per instance, and
  the conversion files those records per frame (pt, and mr's private group): 1.4–2.0× the groups'.
* **Level 1 is the level.** Level 3 is larger than level 1 on ct, pt and mr in every arm; level 19 saves 6–19 % more
  bytes for 36–380× the CPU (37–166 ms a series), which is 6–34 ms on rural ADSL. Decompression is ≤ 0.31 ms at any
  level.
* **The package:** compressed, the metadata is 0.003–0.36 % of the package whichever layout, PET the largest. What
  compressing gains is the raw metadata's send time: 4.8–7.0 s per series on rural ADSL for today's groups, 0.74–2.8 s
  for the converted instance (0.74–0.89 s masked), 39–370 ms on 4G/5G, 7–70 ms on fiber. Next to the frames that is
  1.5–7.4 % of the package raw for today's groups (pt the largest), 0.26–1.6 % for the converted instance masked.
* **Against #150 and #154's ratios:** the groups' stream here is 32–83× where #154 reported 16–31× on the parser's
  output; the stream here holds the group bytes framed, without tar's 512-byte headers, whose paths carry a hash per
  file. *Not pre-registered:* the package tar itself at level 1 (python-zstandard 0.25.0) is 32 698 B for ct, 37 515
  pt, 28 638 mr (1.42–1.63 MB raw), about twice the groups' stream: the headers cost about as much as the metadata
  once compressed.
* **What it does not say.** The converted instance is simulated (§The parser's own output), not written by a
  converter; a real one adds its own attributes. One series per modality, de-identified (§Repetition); no dictionary
  (above). The send times are bytes over the uplink: no round trips, slow start or loss, no tar headers, no TLS; #156
  measured those on emulated links for corrections and resends of the groups, not for these streams. One thread on one
  host; nothing is claimed for parallel compression.
