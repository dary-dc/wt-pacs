# Merging `claude/av1-unified` into `main`

Written by queue row MERGEPREP, 2026-10-10, for the owner, who merges. Nothing here is pushed to `main`.

## Where the branch stands

* `claude/av1` (the queue and its docs) is merged in at `4d2e68e`; its four lab scripts that this branch and `main`
  had already removed (`deploy_exact_server_cloud.sh`, `restore_mvp15b_cloud.sh`, `run_cloud_experiments.sh`,
  `run_cloud_queue.sh`) stay removed, as every earlier merge of `claude/av1` resolved them.
* **`scripts/gate.sh` in full is green** at `4d2e68e`: 320 s, every step run but the one it always skips by name
  (the viewer's cross-codec arm and Firefox). The decoder builds were made by `client/decode/wasm/build/build.sh` and
  matched `manifest.sha256`; Docker Hub answered 429, so the build's Debian base was pulled from `mirror.gcr.io` by
  the same digest for that run only.
* Against `main` at `c7230a9`, from their merge base (PR #33, `8407095`): 1 257 files, +61 397 / −5 369 lines.

**`main` has moved since the merge base: PR #34, the server redesign, is in it.** A trial merge of `origin/main` into
this branch stops on 24 conflicts — `Cargo.lock`; `server/src/main.rs`, `media/read_path.rs`, `record/tap.rs` and
`transport/` (`mod.rs`, `pipeline.rs`, `planner.rs`, `server.rs`, `tuning.rs`, `websocket.rs`, and `frame_out.rs`,
deleted on `main` and changed here); `common/frame-envelope/src/lib.rs` and `common/series-bundle/src/writer.rs`
(`ingest/study-bundle/Cargo.toml` changed on `main` at `c7230a9`, moved here); `client/transport/wasm/src/session.rs`;
`docs/WIRE.md` and four ADRs; `lab/disk-access-bench` (2 files), `lab/scripts/telemetry_e2e_baseline.sh` and
`server/scripts/check_telemetry_absent.sh`. Most are this branch's renames (below) meeting PR #34's refactor of the
same lines. The trial was aborted; how and where they are resolved is the owner's (`queue.md` §Blocked).

## What the branch adds

* **AV1 beside HTJ2K, not served by default**: the payload format, ingest of AV1 payloads, and their decode in the
  client through WebCodecs or dav1d-WASM behind the decoder worker's one contract — [`README.md`](README.md),
  [`payload-format.md`](payload-format.md). Ingest keeps HTJ2K for every series (§Total time there).
* **A product ingest from DICOM** to a served bundle, with per-frame digests: `ingest/from-dicom/`.
* **The viewer**, the product's page at `/`, painted by a WebGL2 painter in a worker (`client/viewer/`,
  `client/paint/`), with a page check the gate runs.
* **An unattended deployment**: pinned images, a certificate made at each start, TLS for the page (`deploy/`).
* **Lab only**: the measurements behind every row of [`queue.md`](queue.md), their harnesses and raw rows
  (`lab/**/raw/`, `*.jsonl`, the largest 0.79 MB), and the protocols that pre-registered them.

## What it changes in the HTJ2K path

Each change with the measurement that adopted it; HTJ2K codestreams are byte-for-byte as before.

| change | measured | where |
| --- | --- | --- |
| The client's OpenJPH is built from pinned sources (0.31.0, single-threaded, 4 MB heap), checked against a manifest before it is instantiated, in place of the fetched package | fill ×0.927 (1×) and ×0.941 (4×), cold ask ×0.715 and ×0.732 (10/10), JS+WASM 157 → 22 MB, every frame exact | decode README §The build, as delivered |
| `decoder.js` loads one codec module (`htj2k.js` or `av1.js`); HTJ2K's range pass runs in two loops | ×0.79–0.88 a frame on every 10–14-bit grey series, 1× and 4× | decode README §The range pass |
| Every decoded frame is hashed (XXH3-64) against the digest ingest wrote, before it is handed on; a mismatch is decoded again and never marked exact | 0–15 % of a decode-bound fill and of the first picture; nothing measurable on a fill where the wire is the clock | `docs/adr/exactness-in-production.md` §3 |
| The downloader resumes an ask its transport timed out (`FrameTimeoutError`) instead of failing it; two re-dial defects fixed | no client timer failed an ask under loss; the fill's time unchanged | `client/README.md` |
| The server opens the HTTP/3 control stream once the ClientHello is whole | Firefox's dial settles 30/30 on 5, 10, 20, 50 Mbit/s, against 0, 4, 12, 21 of 30 before | `docs/transport/transport-conclusions.md` §Firefox's dial on a slow link |
| `--congestion bbr-bound`, opt-in; the default stays `cubic-restart` | failed its rule; not recommended | `transport-conclusions.md` §1, The bound |
| `followQueue` on the downloader, a lab flag, off by default | fills ×0.998–1.002; one cell under its rule | `docs/ARCHITECTURE.md` §How many |
| Ingest encodes HTJ2K in-process and in parallel | 69/69 cells byte-identical; HTJ2K CPU −21 to −27 % | `ingest/coded-frames/README.md` |

**Renamed, which breaks a caller that uses the old names** (no behaviour change): the server binary `exact-server` →
`series-server`, `--study` → `--series`, `/study/metadata` → `/series/metadata`, `pack-study` → `pack-series`,
`ingest/study-bundle` → `common/series-bundle` (each old name retired); the client as `client/transport/` (downloader, consumer,
`ts/`, `wasm/`), `client/decode/` and `client/contract/` (retired: `client/conformance/`). `deploy/` and every script in
the tree use the new names.

## What ships that is not code

* 480 kB of AV1 golden payloads under `client/contract/av1/`, synthetic, made by `ingest/coded-frames/make_golden.py`,
  each with its `.sha256`; the two HTJ2K contract frames moved with `client/contract/`.
* Raw measurement rows and logs under `lab/` (one host load log, `lab/bb3/host.log`). No fetched data, no built
  binary, no secret; the only addresses are loopback and the documentation range (203.0.113.0/24).

## Verifying it

```bash
rustup target add wasm32-unknown-unknown && cargo install wasm-pack --version 0.15.0 --locked
bash client/transport/wasm/build.sh
bash client/decode/wasm/fetch_openjph.sh && bash client/decode/wasm/fetch_xxh3.sh
client/decode/wasm/build/build.sh                 # docker; matches manifest.sha256 or refuses
python3 -m venv lab/av1/.venv && lab/av1/.venv/bin/pip install --require-hashes -r lab/av1/requirements.txt
PYTHON=lab/av1/.venv/bin/python scripts/gate.sh   # GATE OK, one skip by name
git merge --no-commit --no-ff origin/main          # the 24 conflicts above; git merge --abort
```

## What stays open

Each with its decision in [`queue.md`](queue.md) §Blocked: serving AV1 by link, client or series; the code-block pool
for large series; stripes and precincts; the phone stages (WebGPU decode, paced decode's energy, Safari, phones'
AV1 decoders); `bbr-bound`'s future; sound sources for ultrasound, ABUS and angiography; what the public repository
stops carrying. After the merge: row FMT (rustfmt and clippy). Rows CCTHEORY, ORDERNEED and DATAAUDIT write docs
beside this note; what they push before the merge goes into it.
