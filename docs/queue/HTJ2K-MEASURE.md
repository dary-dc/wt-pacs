state: started
started: 2026-11-11 18:59 UTC
heartbeat: 2026-11-11 19:34 UTC
outputs: `claude/htj2k-tiles` 947bb3b9 (rows, docs; draft PR #324 into main, already open: the commits land in it)
## Resume
Stages 0–2 done and pushed; stage 3 (shards S3a–S3c) is next and needs a build first. Done: `lab/htj2k-tiles/improve/`
(offline.py stages 0–1, stage2_prep.py, decode/ worker, page, run.mjs, summary.py, levels_check.mjs, build_levels.sh),
rows `rows/stage0-<vol>.jsonl` (175 frames) and `rows/stage2.jsonl` (10 rounds), `docs/htj2k-tiles.md` §Improve,
measured: stages 0–2, `docs/lines/codecs.md` Open 3.
Next, in order (the doc's "Owed, for stage 3"): (1) the D arms' series from `claude/demo-fixes-2:scripts/demo-series.sh`
for dbts_a1, dbts_b1, dbts_c1; (2) the D+T3, D+L★, S★ series: strips in I1's profile cut into Layout 1's band-major
entries (`e = b·N·T + f·T + t`, bands = levels 2, 1, 0 at TLM boundaries; stage2_prep.py has the cuts) and packed with
`pack-series`; (3) a lab client under lab/htj2k-tiles/improve (product never imports it): D's fill through the product's
AV1 route, then a Lossless ask on the middle slice as the strips' entries decoded on decode/worker.js's three workers;
D+L★ asks the fit's bands first and paints the exact level picture; S★ fills at ℓ_fit's bands; I4's store of coded
bands and level pictures in OPFS and the reopen (J10), with stage 0's mutants "bands dropped" and "band 0 painted";
(4) `lab/decode-bench/parity.mjs` on both builds; (5) stage 3 as §Improve's protocol writes it on
`lab/av1/delivery/total-time/run.mjs`'s rig (links r5000, r20000, lte-good, wifi-home, r20000 l1; 1×, 4×; 6 rounds;
arms D, D′, D+T3, D+L★, S★), rows pushed as they land, then R3–R7 in the doc. HTJ2K-VERDICT waits on this row.
Setup in a fresh container (about 15 min): `OUT=/home/user/htj2k-data lab/av1/fetch_data.sh dbts_a1 dbts_b1 dbts_c1`;
`pip install meson && ingest/tools.sh`; OpenJPEG v2.5.4 native (cmake, `-DBUILD_SHARED_LIBS=OFF -DBUILD_CODEC=ON`);
`client/decode/wasm/build/build.sh` fills its cache, then with no Docker daemon `bash client/decode/wasm/build/inside.sh
$PWD/client/decode/wasm/build/.cache $PWD/client/decode/wasm/built 0:0` and `sha256sum -c` against manifest.sha256;
`lab/htj2k-tiles/improve/decode/build_levels.sh`; from lab/htj2k-tiles/improve: `../../av1/.venv/bin/python
stage2_prep.py ../../../ingest/.build DATA ../../../lab/.av1-work/htj2k-improve dbts_a1 dbts_b1 dbts_c1`. Write rows
outside the repo while a writer runs and copy them in: a rebase once replaced a row file under a running writer.
## Result
* Stages 0–2 of `docs/htj2k-tiles.md` §Improve's protocol run; stage 3 not yet, so R3–R7 are undecided.
* R0 holds: 175/175 frames exact at every level on OpenJPEG 2.5.4 and OpenJPH 0.31.0. The lab binding is exact on
  456/456 pictures, and stage 2 on 17 920/17 920. I1's TLM prefixes decode, which answers its "unverified" check.
* J1 and J2 hold: I1 adds +0.01 % (+112 B a frame) and the three strips +0.11–0.14 %. On dbts_b1, six decompositions
  save 0.27–0.30 %, a miss under the predicted band. R1 holds.
* J3 and R2 hold: one Lossless decode on three workers is ×0.43–0.48 of the whole frame at 4×, ≤ ×0.60 in 10/10 rounds
  on every volume. J9 is ×0.57 on dbts_b1 and ×0.43 on dbts_c1 sideways. One worker decodes the strips in ×0.98–1.04.
* Mutants caught: TLM short, strip order, untiled truth, truth flipped, SIZ reset removed (the last only by the
  binding check, not the bench). Not run: parity.mjs, the precinct reading, the two cache mutants (no client yet).
* Fixtures: three timed DBT volumes of one dataset (EA1141); no breast US cine; 4-core host, no GPU, headless Chromium
  153; 4× cgroup throttle (worker ×2.7 on its own check); no links yet; no phone, so nothing a phone alone shows.
* Owner: none yet; R3/R4's store-format and level-picture questions arise only after stage 3.
