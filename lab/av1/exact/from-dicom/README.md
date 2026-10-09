# from-dicom

The product's DICOM ingest ([`docs/FIXTURES.md`](../../../../docs/FIXTURES.md) §From DICOM) checked against
independent paths on the lab's pinned sets. Queue row 89 (INGEST) of
[`docs/av1/queue.md`](../../../../docs/av1/queue.md).

```bash
lab/av1/fetch_data.sh ct_nlst us_liver dbt12_ea1141 ffdm_a      # the DICOM, cached under lab/av1/data/dicom, and NNN.raw
cargo build --release -p pack-series && bash ingest/coded-frames/build.sh
export DCMDUMP=.../bin/dcmdump                                  # DCMTK 3.6.9, below
lab/av1/.venv/bin/python lab/av1/exact/from-dicom/check.py lab/.av1-build WORK \
  ct_nlst us_liver dbt12_ea1141 ffdm_a@0 ffdm_a@1 ffdm_a@2 ffdm_a@3 --rounds 6
NODE_PATH=$(npm root -g) node lab/av1/delivery/total-time/run.mjs --frames lab/.av1-work/from-dicom \
  --variants htj2k,av1 --links r50000 --throttles 1 --rounds 1      # WORK/fill copied there
```

**The sets.** A signed single-frame CT series as a folder (`ct_nlst`, 76 files); an RGB ultrasound cine, one
multi-frame object (`us_liver`); an enhanced multi-frame tomosynthesis volume (`dbt12_ea1141`, Breast Tomosynthesis
Image Storage, its window in the shared functional group); and a mammogram. `ffdm_a`'s four views are four series,
and the ingest refuses them as one folder by name, so each view is ingested alone (`ffdm_a@K`, file K). All are
native transfer syntaxes.

**What each check compares** (`check.py`):

* **samples** — every frame's bytes against `fetch_data.py`'s `NNN.raw` of the same file. That is pydicom's
  `pixel_array`, not the ingest's reader. `fetch_data.py` writes a folder's files in `data.json`'s order, the
  ingest in InstanceNumber order, so each frame is matched through its file.
* **attributes** — the metadata's series and per-frame display attributes against DCMTK's `dcmdump` (`+p +P`, every
  instance with its sequence path). Per-frame values are placed by order, and a per-frame group lacking one on any
  frame stops the check.
* **jobs** — the HTJ2K bundle and its metadata byte-identical at `--jobs` 1, 2 and 4.
* **client** — the HTJ2K and the AV1 bundle unpacked and decoded by `ingest/coded-frames/check.mjs`, which uses the
  client's codec modules (OpenJPH, and dav1d-WASM without WebCodecs), against the source's checksums. It also
  writes `WORK/fill` for total-time's fill, variants `htj2k` and `av1`, each with its digests.
* **time** — per set, the one command on each of its series against today's two steps (`fetch_data.py`'s extraction
  of the cached DICOM, `ingest/coded-frames/ingest.py --codec htj2k`, `pack-series`), each round interleaved by
  `lab/scripts/order.py`, `--jobs 4` in both, seconds a frame.

**Pins.** DCMTK 3.6.9, conda-forge `dcmtk-3.6.9-h43deee3_2.conda` (SHA-256
`a5f1e0d45e7247bc46b5ed13bdcd3a33d4925650b2cd6b49768014266222356f`), installed by micromamba 2.9.0 (as
[`../../delivery/total-time/README.md`](../../delivery/total-time/README.md) §Pins). pydicom 3.0.1, NumPy 2.4.6
and xxhash 3.6.0 from `lab/av1/requirements.txt`. Nothing fetched or built is committed.

## Measured (2026-10-09)

| set | frames | samples = `NNN.raw` | attributes = dcmdump | bundles at jobs 1/2/4 | `check.mjs` HTJ2K / AV1 | fill HTJ2K / AV1, `exact: true` |
| --- | ---: | --- | --- | --- | --- | --- |
| `ct_nlst`, 76 files, signed | 76 | 76/76 | series equal, 76/76 frames | identical | 76/76 / 76/76 | 76 / 76 |
| `us_liver`, RGB | 70 | 70/70 | equal, 70/70 | identical | 70/70 / 70/70 | 70 / 70 |
| `dbt12_ea1141`, enhanced | 29 | 29/29 | equal, 29/29 | identical | 29/29 / 29/29 | 29 / 29 |
| `ffdm_a`, 4 views | 4 × 1 | 4/4 | equal, 4/4 | identical | 4/4 / 4/4 | 4 / 4 |

All four sets are native transfer syntaxes. The tomosynthesis volume's three windows and SIGMOID function come from
its shared group, and no frame overrides them, so a per-frame override is held by `from_dicom_test.py` alone. The
fill ran through the downloader against the real server, r50000 at 1×, headless Chromium 141; AV1 went through
WebCodecs.

**Ingest time**, seconds a frame, 6 rounds interleaved on a 4-core host, `--jobs 4`. The time a frame and its
ratio to the two steps are medians of rounds, with their ranges:

| set | two steps | one command | ÷ two |
| --- | ---: | ---: | --- |
| CT | 0.020 | 0.015 | ×0.81 [0.66–0.91] |
| RGB cine | 0.032 | 0.023 | ×0.71 [0.65–0.86] |
| tomosynthesis | 0.048 | 0.067 | ×1.30 [0.81–1.56] |
| mammogram, views one after another | 0.595 | 1.316 | ×2.52 [1.71–2.75] |
| mammogram, views at once | 0.595 | 0.369 | ×0.65 [0.49–0.97] |

The command is faster on CT and the cine. On tomosynthesis it is within the spread, its pairs ranging either side
of 1.

The mammogram's views are four series. Ingested one after another, each command codes one frame on one core, while
the two steps code the four as one set across four. Run together, as several series are ingested, the command is
faster. Reading is a tenth of what it was once a frame whose stored bits fill its allocation is taken as it lies:
0.35 s for the 67 MB cine, against 3.7 s at first.
