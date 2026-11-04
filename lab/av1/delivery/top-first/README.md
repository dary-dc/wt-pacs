# Top first — measured

The pre-registered protocol of [`docs/av1/top-first.md`](../../../../docs/av1/top-first.md) §4, run by a separate
session on 2026-11-04; the reading and the decision rule's verdict are in that file, §Top first, measured. Every result
rests on three DBT volumes, `dbts_a1`, `dbts_b1` and `dbts_c1`, and is claimed for those only.

```bash
lab/av1/tools/tools.sh aom dav1d                  # libaom 3.15.1, native dav1d 1.5.4 (needs meson: pip install meson ninja)
client/decode/wasm/fetch_openjph.sh && client/transport/ts/build.sh
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160      # builds ojph_compress once
lab/av1/fetch_data.sh dbts_a1 dbts_b1 dbts_c1
P=lab/av1/.venv/bin/python W=lab/.av1-work T=lab/av1/delivery/top-first
$P lab/av1/delivery/split-rule/make_frames.py lab/.av1-build $W/shipped lab/av1/data/dbts_{a1,b1,c1} --preset allintra:7 --k 2 --jobs 3  # ~5 min
$P $T/make_frames.py $W/shipped $W/top-first lab/av1/data/dbts_{a1,b1,c1}           # every arm, whole and head sets
$P $T/stage1.py lab/.av1-build $W/shipped $T/stage1.jsonl lab/av1/data/dbts_{a1,b1,c1}  # stage 1, items 1–4
$P $T/stage1.py lab/.av1-build $W/shipped /tmp/m.jsonl lab/av1/data/dbts_a1 --mutate low-byte   # must fail: 55/56
$P $T/stage1.py lab/.av1-build $W/shipped /tmp/m.jsonl lab/av1/data/dbts_a1 --mutate shift1     # must fail: 0/56
NODE_PATH=$(npm root -g) node $T/bench.mjs --rounds 5 --out $T/decode.jsonl                     # stage 1, item 5, ~20 min
$T/mutations.sh                                                                                  # stage 2's mutations, ~5 min
$T/stage2.sh 0 2                                                                                 # stage 2, three rounds
python3 $T/summary.py $T/rows.jsonl $W/top-first --decode $T/decode.jsonl --svc svc-rows.jsonl svc-rows-r50000.jsonl rows.jsonl
```

The last three files are `lab/av1/delivery/scalable/tool/`'s at `f4c396c8` (`git show f4c396c8:lab/av1/delivery/scalable/tool/svc-rows.jsonl`).

## The harness

**The rig** is `f4c396c8`'s total-time rig, ported: [`run.mjs`](run.mjs) and [`page.js`](page.js) are its
`lab/av1/delivery/total-time/` files with three additions — an AV1 variant may name the downloader's `transport`,
its worker's `mode`, and `serverEntries`, the bundle's entries when the downloader is told of more — and the page maps
`tf-frame`'s entries back to slices. This branch's `client/` is the product as it ships, unchanged. The port ran
against it at the first try, so `f4c396c8` was not run whole. dav1d-WASM is not built here: every payload of every
visit decoded through WebCodecs (the rows' `paths`), so the product's fallback was never taken.

**The arms** ([`make_frames.py`](make_frames.py)), from split-rule's shipped payloads at `allintra` 7 and k = 2:

* `htj2k`, `k2` and `k2-aa`: the served HTJ2K and the shipped payload, through the product's decoder worker.
* `tf-frame`: the `k2` bundle. [`transport.js`](transport.js) is the product's transport with its envelope reader
  replaced: each envelope is read in two reads, head and payload up to the end of its top, then the rest, and handed
  to the downloader twice — slice i's prefix (a copy) as entry 2i, the whole payload as entry 2i + 1. Told of 2F
  entries in groups of 2, the downloader's own group rule gives both to one decoder worker, prefix first, so the
  preview is posted before the exact frame is decoded, as the protocol words it. A first build gave the two to
  different decoders: 23 of 56 previews then came after their exact frame (`late`) at 50 Mbit/s, so it was not run.
* `tf-series`: 2F entries, entry i slice i's top-only payload and entry F + i its low-only payload, both cut from the
  shipped payload's bytes. The downloader may give a slice's low to another decoder than its top, so each worker
  shares the top-only payloads it decodes with the others over a `BroadcastChannel`; the product form would hold them
  in the downloader.

[`decoder.js`](decoder.js) is both arms' worker: a top is wrapped as a top-only payload (split 0, bits b − 2, the
top's depth), decoded through the product's `av1.js`, and posted as a preview, top ≪ 2, in a 16-bit buffer of its
own; an exact frame is the whole payload (`tf-frame`) or the one rejoined from the two (`tf-series`), decoded through
`av1.js` as shipped. Both arms decode each top twice.

**Checked on the page, every visit:** every exact frame's SHA-256 against the checksum the fetch wrote; every top-only
picture's against SHA-256 of (source ≫ 2) ≪ 2 as 16-bit little-endian samples, written by `make_frames.py` from the
source after checking the source's bytes against its checksum; previews after their exact frame (`late`) and frames
posted unmarked (`stray`).
