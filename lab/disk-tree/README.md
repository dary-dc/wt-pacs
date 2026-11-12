# disk-tree

Where a study sits under the PACS's root, measured: the protocols of
[`docs/adr/pacs-disk-layout.md`](../../docs/adr/pacs-disk-layout.md) §5, as amended there before each run, for five
path options. The ADR recommends; this directory reports and changes nothing in it. Run 2026-10-26.

| arm | path |
| --- | --- |
| A flat | `<root>/<Study>/` |
| B `<D>` | `<root>/<D>/<Study>/`, the PCS's coded `YYMMDD`, `PbPb` undated |
| C yyyy/mm/dd | `<root>/2026/10/25/<Study>/`, `0000/00/00` undated |
| D 256 | `<root>/<hh>/<Study>/`, `hh` the low byte of XXH3-64 of the coded name |
| D2 256² | `<root>/<hh>/<hh>/<Study>/`, the low two bytes |

```bash
cargo build --release --manifest-path lab/disk-tree/Cargo.toml   # outside the workspace and the gate
sudo lab/disk-tree/run.sh ext4 1000000 > rows-ext4-1e6.jsonl     # or xfs; 10000, 100000, 1000000
CEILING=1 sudo lab/disk-tree/run.sh ext4 0 > rows-ext4-ceiling.jsonl
python3 lab/disk-tree/summarize.py lab/disk-tree/rows-*-1e?.jsonl lab/disk-tree/rows-ext4-mut-*.jsonl lab/disk-tree/rows-ext4-ceiling.jsonl
```

## The host, and what that limits

* 4 vCPUs (Xeon, 2.1 GHz), 15 GiB of memory, kernel 6.18, no swap, about 30 GB of free disk on a virtio block
  device whose backing storage is not known. Each arm is its own image on a loop device with direct I/O, over a file
  on that device's ext4.
* **ext4:** mke2fs 1.47.0 defaults (`dir_index`, `dir_nlink`, `metadata_csum`, 4 KiB blocks, **no `large_dir`**),
  inode tables initialised at mkfs time so no background thread writes during a run. **XFS:** mkfs.xfs 6.6.0
  defaults (`crc=1`, `finobt=1`, 512-byte inodes, 4 KiB directory blocks).
* A study is a directory holding one empty `x.sbnd`. Its name is a 64-character UID in the PCS's coding,
  44 characters long. The site receives 1 000 studies a day, and one in 50 has no date.
* **Where it saturates.** 10⁷ studies do not fit: an ext4 directory takes a 4 KiB block, so five arms need about
  200 GB. Nothing here is claimed past 10⁶. At 10⁶ the five ext4 trees (about 4 GiB of blocks each, plus their inodes)
  do not fit in memory together. That is why some timed passes there read from the device, and every cell says how
  much. Publication is bound by the device's flush, and from 4 writers by the 4 vCPUs too.
* **Warm only.** `drop_caches` is refused here, and a remount is eviction, so there is no lever for a cold case.
  Every timed pass follows an untimed pass over what it touches and records the bytes read from the loop devices.
  A warm `open` resolves in the dentry cache, so P1 measures the kernel's path walk, not the on-disk index.
* Arms are interleaved (a Williams square, as `lab/order.mjs`) within one run. **ext4 and XFS ran one after the
  other, so a difference between them is not claimed.** No `drop_caches` was logged during any run.

## P1 · Lookup: from the URL to an open series file

Path built from the coded name (and, for B and C, the date as the URL would carry it), then `open`. 10 rounds of
20 000 opens per arm, drawn from a fixed sample of 10⁵ studies. Each cell gives p50 / p99 in ns, then the bytes read
from the device during the timed opens.

| fs | studies | A flat | B `<D>` | C yyyy/mm/dd | D 256 | D2 256² |
| --- | --- | --- | --- | --- | --- | --- |
| ext4 | 10000 | 1688 / 3376; 0 | 2217 / 5056; 0 | 2048 / 4083; 0 | 2005 / 4439; 0 | 2215 / 4481; 0 |
| ext4 | 100000 | 4273 / 8498; 0 | 4822 / 9749; 0 | 4973 / 10981; 0 | 4957 / 10570; 0 | 5446 / 12827; 0 |
| ext4 | 1000000 | 5160 / 44833; 6950912 | 6123 / 34647; 3534848 | 5891 / 31295; 2691072 | 4474 / 9779; 0 | 5325 / 11824; 0 |
| xfs | 10000 | 4367 / 10643; 0 | 4119 / 11428; 0 | 4043 / 9365; 0 | 3965 / 9116; 0 | 4880 / 14716; 0 |
| xfs | 100000 | 6068 / 17671; 0 | 6616 / 20274; 0 | 7244 / 26944; 0 | 6885 / 21775; 0 | 8359 / 30934; 0 |
| xfs | 1000000 | 7123 / 27371; 0 | 8612 / 32762; 0 | 7866 / 31344; 0 | 6880 / 29127; 0 | 11895 / 39341; 0 |

**What it says.** Warm, the path option costs at most a few µs on either filesystem. At 10⁶, flat is no slower than
hashed. D2's extra level is the most expensive on XFS at 10⁶ (11.9 µs against 6.9 µs for D). The ext4 10⁶ p99s of A,
B and C include reads of 3–7 MB from the device, so those three p99s are not warm. The cold case, where the on-disk
index is walked, is not measured.

## P4 · Scan: every entry listed and `lstat`ed, as a file-level backup does

5 rounds; the second of two back-to-back walks is timed. Each cell gives ns per entry, the median of rounds, then
the entries and the most MiB a timed walk read.

| fs | studies | A flat | B `<D>` | C yyyy/mm/dd | D 256 | D2 256² |
| --- | --- | --- | --- | --- | --- | --- |
| ext4 | 10000 | 3560 (20000; 0) | 3508 (20011; 0) | 4051 (20015; 0) | 4004 (20256; 0) | 5674 (29537; 0) |
| ext4 | 100000 | 5155 (200000; 0) | 4746 (200101; 0) | 5020 (200108; 0) | 5109 (200256; 0) | 5509 (251553; 0) |
| ext4 | 1000000 | 18978 (2000000; 2) | 18448 (2001001; 59) | 17297 (2001039; 9) | 18414 (2000256; 44) | 17441 (2065792; 0) |
| xfs | 10000 | 3727 (20000; 0) | 3744 (20011; 0) | 3465 (20015; 0) | 4276 (20256; 0) | 5223 (29537; 0) |
| xfs | 100000 | 5774 (200000; 0) | 5539 (200101; 0) | 5715 (200108; 0) | 5693 (200256; 0) | 6726 (251553; 0) |
| xfs | 1000000 | 13188 (2000000; 0) | 13139 (2001001; 0) | 14865 (2001039; 0) | 12256 (2000256; 0) | 12862 (2065792; 0) |

**What it says.** Within a size, the per-entry cost is the same across arms to about 20 %. It grows with the tree
(about 4, 5, then 12–19 µs an entry) as the tree outgrows the CPU caches and, for ext4 at 10⁶, memory: a full scan of
10⁶ studies took 26–40 s. No arm makes the full scan cheaper. A date tree lets a backup skip old days only if they
never change. The ext4 10⁶ row has 4 full rounds and 2 walks of a fifth, because a worker restart rebooted the
container during round 4. The scan was not repeated.

## P3 · Publication by rename, into the 10⁶ trees

k writers each publish 100 new studies per round, over 4 rounds, all dated the next day. A publish is: `mkdir` in
`incoming/`, write 4 KiB, `fsync` the file and the staging directory, `rename` into place, `fsync` the parent. Each
cell gives the whole publish p50 / p99 in µs, then the `rename` alone, then the KiB read during the cell. The
directories renamed into are listed first.

| fs | studies | writers | A flat | B `<D>` | C yyyy/mm/dd | D 256 | D2 256² |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ext4 | 1000000 | 1 | 2308 / 6873; 45.9 / 1319.8; 144 KiB | 2272 / 5955; 33.5 / 842.3; 140 KiB | 2192 / 6259; 30.7 / 1737.3; 140 KiB | 2466 / 9581; 44.1 / 2049.2; 144 KiB | 2808 / 12143; 43.2 / 2804.3; 8 KiB |
| ext4 | 1000000 | 2 | 2885 / 10056; 64.1 / 1882.8; 24 KiB | 3670 / 12346; 76.4 / 2760.8; 4 KiB | 3734 / 10107; 76.8 / 3079.3; 160 KiB | 3836 / 11100; 81.6 / 4926.5; 132 KiB | 3041 / 10327; 55.2 / 2711.9; 28 KiB |
| ext4 | 1000000 | 4 | 5924 / 14094; 270.4 / 4155.5; 72 KiB | 5811 / 15169; 238.6 / 4028.2; 12 KiB | 5440 / 13242; 251.1 / 2571.1; 152 KiB | 5930 / 15776; 297.2 / 4951.7; 208 KiB | 5266 / 15598; 180.5 / 3423.3; 24 KiB |
| ext4 | 1000000 | 8 | 7138 / 17724; 461.3 / 5397.5; 224 KiB | 6613 / 17977; 344.2 / 5211.5; 44 KiB | 6756 / 17150; 334.7 / 4392.5; 344 KiB | 6703 / 16256; 354.8 / 5477.0; 396 KiB | 7777 / 24555; 592.9 / 9327.4; 128 KiB |
| xfs | 1000000 | 1 | 1947 / 6904; 54.5 / 475.7; 178 KiB | 1949 / 7933; 43.5 / 152.0; 198 KiB | 1895 / 6178; 41.4 / 201.5; 270 KiB | 1849 / 6289; 62.7 / 494.1; 886 KiB | 1866 / 6511; 43.6 / 89.5; 198 KiB |
| xfs | 1000000 | 2 | 2398 / 7623; 57.6 / 339.0; 8 KiB | 2430 / 6299; 47.2 / 251.1; 28 KiB | 2426 / 8749; 48.3 / 270.7; 44 KiB | 2359 / 14385; 67.0 / 725.0; 992 KiB | 2331 / 7780; 45.7 / 147.2; 16 KiB |
| xfs | 1000000 | 4 | 3409 / 9381; 73.3 / 364.5; 0 KiB | 3600 / 10115; 64.2 / 704.4; 16 KiB | 3467 / 8370; 61.1 / 453.8; 96 KiB | 3253 / 11431; 94.5 / 1165.9; 1272 KiB | 3207 / 9584; 57.2 / 364.7; 16 KiB |
| xfs | 1000000 | 8 | 5576 / 16211; 74.1 / 545.9; 4 KiB | 5768 / 19171; 71.6 / 1385.2; 116 KiB | 5557 / 14822; 66.3 / 1005.7; 216 KiB | 5442 / 17101; 106.5 / 3102.8; 2616 KiB | 5028 / 19438; 61.5 / 551.6; 44 KiB |

**What it says.** A publish is three flushes: about 2 ms at one writer and 5–8 ms at eight, the same for every arm.
The `rename` is 1–10 % of the publish. It rises with writers on ext4 for every arm, B and C included, because the
next day's folder is one directory that every writer renames into, as A's root is. Spreading writers is what D and D2
would buy, and at this rate the flush hides it.

## P5 · Deletion by age (added)

The oldest 10 days (2 at 10⁴), one day at a time, interleaved. A, D and D2 take the day's studies from the catalog
(the generator stands in; the query is not timed). B and C list the day's folder and remove it. Each removes the file
and the directory with no `fsync`, then a `syncfs` per arm is timed. Each cell gives µs per study, then the `syncfs`
ms, then the KiB read.

| fs | studies | A flat | B `<D>` | C yyyy/mm/dd | D 256 | D2 256² |
| --- | --- | --- | --- | --- | --- | --- |
| ext4 | 10000 | 30.7; 27; 0 | 30.5; 23; 0 | 35.7; 25; 0 | 33.5; 25; 0 | 39.6; 68; 0 |
| ext4 | 100000 | 37.0; 77; 0 | 36.2; 36; 0 | 38.7; 37; 0 | 60.2; 93; 0 | 72.3; 114; 0 |
| ext4 | 1000000 | 34.0; 219; 8 | 33.9; 12; 8 | 31.0; 28; 8 | 40.5; 195; 8 | 59.1; 157; 12 |
| xfs | 10000 | 28.1; 18; 0 | 30.8; 17; 0 | 38.6; 11; 0 | 27.6; 12; 0 | 27.1; 15; 0 |
| xfs | 100000 | 36.8; 43; 0 | 37.6; 46; 0 | 33.8; 45; 0 | 42.7; 47; 0 | 45.1; 68; 0 |
| xfs | 1000000 | 34.8; 90; 32 | 57.4; 15; 6512 | 47.1; 24; 10048 | 45.5; 27; 288 | 47.9; 95; 116 |

**What it says.** Per study, 27–72 µs under every arm. After deletion, writing back takes longer under A, D and D2
(157–219 ms at 10⁶ on ext4, against 12–28 ms for B and C; mixed on XFS), because one day's studies are spread across the whole
directory index rather than one folder. The XFS 10⁶ B and C cells read 6–10 MiB while deleting, so they are not warm.
Folder deletion cannot reach undated studies (`PbPb`, `0000/00/00`): those need the catalog under every option.

## P6 · A corrected study date (added)

500 dated studies get another date. B and C `rename` the study into the new date's folder and `fsync` both parents.
A, D and D2 do nothing on disk. Each cell gives moved / old path gone, then p50 / p99 in µs.

| fs | studies | A flat | B `<D>` | C yyyy/mm/dd | D 256 | D2 256² |
| --- | --- | --- | --- | --- | --- | --- |
| ext4 | 10000 | 0/0, 0 / 0 | 500/500, 1099 / 3540 | 500/500, 1120 / 3556 | 0/0, 0 / 0 | 0/0, 0 / 0 |
| ext4 | 100000 | 0/0, 0 / 0 | 500/500, 988 / 2548 | 500/500, 991 / 2356 | 0/0, 0 / 0 | 0/0, 0 / 0 |
| ext4 | 1000000 | 0/0, 0 / 0 | 500/500, 1137 / 3965 | 500/500, 1246 / 3635 | 0/0, 0 / 0 | 0/0, 0 / 0 |
| xfs | 10000 | 0/0, 0 / 0 | 500/500, 732 / 1611 | 500/500, 716 / 2317 | 0/0, 0 / 0 | 0/0, 0 / 0 |
| xfs | 100000 | 0/0, 0 / 0 | 500/500, 674 / 1992 | 500/500, 715 / 1612 | 0/0, 0 / 0 | 0/0, 0 / 0 |
| xfs | 1000000 | 0/0, 0 / 0 | 500/500, 1081 / 9994 | 500/500, 927 / 2479 | 0/0, 0 / 0 | 0/0, 0 / 0 |

**What it says.** Under B and C a correction is a move of about 1 ms. Afterwards, every old path fails: a link that
carried the date is broken in all 500 cases. Under A, D and D2 nothing moves and every link still resolves.

## P2 · ext4's per-directory ceiling

ext4, 4 KiB blocks, `metadata_csum`, no `large_dir`. Entries are hard links, 60 000 to a file, added to one
directory until it refuses: an htree entry is the same record for a link as for a subdirectory.

| run | entries when refused | how |
| --- | --- | --- |
| 44-character names (64-character UIDs, coded) | **7 667 255** | `ENOSPC`; dmesg: "index full, reach max htree level :2", "Large directory feature is not enabled on this filesystem" |
| 30-character names (44-character `2.25.` UIDs, coded) | **9 950 066** | `ENOSPC`, same messages |
| `large_dir` on, 44-character names | not refused at 8 500 000 (the run's limit) | — |
| subdirectories, `dir_nlink` **off** | **64 998** | `EMLINK` |

**What it says.** The ADR inferred 10–26 M. The measured ceiling is lower, 7.7–10 M, because leaves average 38 %
full, not half. At 1 000 studies a day, A fills one ext4 directory without `large_dir` in about 21 years; at 10 000 a
day, in about 2. D's 256 folders put the ceiling at about 2 billion studies. B and C hold a day per folder, but
their undated folder grows without bound: at one study in 50 it reaches the ceiling after about 380 M studies.
`large_dir` lifts the limit. Without `dir_nlink`, a directory stops at 64 998 subdirectories: a flat root would
reach that in about 65 days. XFS's ceiling (about 600–700 M inferred) is not reachable here and stays inference.

## Rows

`rows-<fs>-1e<k>.jsonl` hold P1 and P4 for each size. For XFS they also hold P3, P5 and P6. `rows-ext4-mut-1e<k>.jsonl`
hold ext4's P3, P5 and P6, re-run with the warm-up of the second amendment. `rows-ext4-ceiling.jsonl` holds P2.
`rows-ext4-1e6-after-restart.jsonl` holds the first ext4 10⁶ P3, P5 and P6. They ran on trees that came back cold
after the reboot, so they are kept and not used. The ext4 10⁴ and 10⁵ P3, P5 and P6 from before the warm-up are in
this directory's first commit.
