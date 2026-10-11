# ingest-profile

Where today's ingest CPU goes, by stage, for HTJ2K and AV1. Queue row 136 (INGESTPROFILE) of
[`docs/av1/queue.md`](../../../../docs/av1/queue.md) (it lives on `claude/av1`), run as P-PROFILE in
[`docs/FIXTURES.md`](../../../../docs/FIXTURES.md) §A compiled ingest at the site, where the reading is.

```bash
lab/av1/fetch_data.sh rf_fluoro dbt10_ea1141 dbtproj_ge ffdm_d
lab/av1/tools/tools.sh && ingest/coded-frames/build.sh            # aomenc 3.15.1, dav1d 1.5.4 (meson 1.3.2), decode.cpp
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160    # OpenJPH 0.31.0, built once
for r in 0 1 2 3 4; do FIRST_ROUND=$r lab/av1/.venv/bin/python lab/av1/exact/ingest-profile/profile.py lab/.av1-build \
  lab/av1/exact/ingest-profile/raw/profile.jsonl 1 rf_fluoro:htj2k:cpu0 dbt10_ea1141:htj2k:cpu0 dbtproj_ge:htj2k:cpu0 \
  ffdm_d:htj2k:cpu0 rf_fluoro:av1:allintra:7 dbt10_ea1141:av1:good:6 dbtproj_ge:av1:good:6 ffdm_d:av1:good:6; done
lab/av1/.venv/bin/python lab/av1/exact/ingest-profile/summary.py lab/av1/exact/ingest-profile/raw/profile.jsonl
```

**What runs** ([`profile.py`](profile.py)). Each set's first 8 frames (`ffdm_d` has 4) go through `ingest.py`'s own
coding function (`CODECS[codec]`, the body of a `--jobs 1` chunk) in this process. Then come `main()`'s writes and
digests. The AV1 presets are `from_dicom.py`'s by content: `allintra:7` for the fluoroscopy, `good:6` for the breast
sets. Every frame is checked as the product checks it, and a frame that does not decode back refuses the run.

**Stages.** Each wrapped function's own CPU (`time.process_time`, less the wrapped calls inside it) is charged to:
* `read`: `Set.frame`.
* `hash`: `exact`, the SHA-256 against the source, and `frame_digest`, the XXH3-64 digests.
* `check`: `decoded` and `merge`.
* `temp`: `write_y4m`, `ivf_units`, and the codec function's own body (the PNM written, the codestream read back,
  conversions).
* `spawn`: this process inside `subprocess.run`.
* `write`: the outputs.

The encoder's CPU is the children's rusage over each `subprocess.run`. `start` is the CPU of a no-op run of the same
binary (`ojph_compress` without arguments, `aomenc --help`, 20 runs), times the number of runs. `encode` is the
encoder's CPU less that start.

**Arms and rounds.** Each (set, codec) runs as `stages` and as `cli` (`ingest.py` end to end at `--jobs 1`, children's
rusage: the interpreter, imports and the process pool included). The 16 units run in a Williams order
(`lab/scripts/order.py`), 5 rounds, one container, 4 cores, nothing else running.

**Mutations.** `MUTATE=check` (one sample +1 in every decode) refused every run in both codecs. `MUTATE=burn` (50 ms of
CPU before each read) raised `read` by 99.7 ms a frame at 2 reads a frame (1.9 → 101.6 ms).

**Pins.** Python 3.11.17 with `lab/av1/requirements.txt`; aomenc 3.15.1; OpenJPH 0.31.0 (`c68064d`); dav1d 1.5.4;
meson 1.3.2 for its build. Nothing built or fetched is committed; `raw/` holds the rounds as measured.
