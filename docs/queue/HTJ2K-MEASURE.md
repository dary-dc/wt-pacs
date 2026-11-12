state: started
started: 2026-11-11 18:59 UTC
heartbeat: 2026-11-12 02:07 UTC
outputs: `claude/htj2k-tiles` bc27fe97 (rows, docs; draft PR #324 into main, already open: the commits land in it)
## Resume
Session 3 plan (2026-11-11 23:24 UTC), the client's design fixed before any run:
* `lab/htj2k-tiles/improve/stage3/`: `page.js` (one lab page, every arm), `store.js` (a lab OPFS store worker: level
  pictures, coded bands, OQ pictures, by key), `run.mjs` (the driver, on 157b7109's total-time rig: Williams cells,
  arms inside), `summary.py`. Product never imports it.
* Amendment, before any run: D and D′ are Q 8 G 16 (the depth cut on a1, c1), D′ the same series under another name;
  G 1 not run (the Improve protocol names no G; time). Two series-servers a visit where the arm needs two series (the
  OQ fill and the exact or band ask), each behind its own relay of the same link and seed, started together; the ask
  is issued only after the fill ends, so the two never carry at once. The reopen runs in every visit through the lab
  store (J10 judged on S★ and D+L★); it stands in for the product store plus I4's two record kinds.
* Pushed: `c00d9959` the page, store and driver (untested). Container set up as the Resume above says (D series Q 8
  G 16 only: `sed -i 's/^QS=(8 24)/QS=(8)/; s/^GS=(1 8 16)/GS=(16)/'` on the demo worktree's script, reverted after;
  sbnd and metadata digests equal `rows/stage3-d-series.json`; strip series' frames.json equal). The served tree is
  `/home/user/demo` (157b7109) with `lab/htj2k-tiles/improve` copied in (`cp -r`, re-copied after each edit),
  `demo-series` and `lab/.av1-work/htj2k-improve` symlinked, `lab/.traces/TMobile-LTE-short.down`, levels.* built
  there by build_levels.sh. Next: a smoke visit per arm, then the mutants, then S3a:
  `cd /home/user/demo && NODE_PATH=$(npm root -g) node lab/htj2k-tiles/improve/stage3/run.mjs --series demo-series
  --bands lab/.av1-work/htj2k-improve --rounds 2 --first-round 0 --out /home/user/s3a.jsonl`.
* Done since: the client works in every arm (smoke visits, not kept: all exact, every reopen 0 asks 0 decodes);
  `ebbaeaeb`, `8ee94f69` fixes (store serialised; OQ series carry no digests, so OQ pictures are unchecked as in the
  viewer, and a visit's OQ pictures get one digest, equal across D visits). Also needed: `ln -s /home/user/demo-series
  /home/user/demo/lab/.demo-series` (dev-server serves only its top dirs). `6a4dde46` the cache mutants and two more,
  each caught (`rows/stage3-mutants.jsonl`). parity.mjs: needs `client/decode/wasm/fetch_openjph.sh` and
  `PATH=lab/av1/.venv/bin:$PATH lab/scripts/gen_htj2k_fixtures.sh g160 g256 g512 c512 g8 g1024 g2048 s512 s12` first;
  then `VARIANTS=$PWD/client/decode/wasm/built/openjph VARIANT=openjph` and `VARIANTS=$PWD/lab/.openjph-build/wasm
  VARIANT=levels`. Never run two drivers at once (they share cores and the collector's ports).
Session 3 resumed 2026-11-11 23:21 UTC (stalled since 21:35), from `e7b44077`.
Stages 0–2 done (19:33, `947bb3b9`). Session 2 (21:22–21:40): stage 3's inputs built and pushed; the lab client is next.
Done, session 2: `4224e96e` `stage3_prep.py` + `stage3_check.py` (every frame's three strips cut into Layout 1's
band-major entries, `e = b·N·T + f·T + t`, bands = levels 2, 1, 0; 294/294 pictures exact read back from the entries;
mutants band-order, entry-index, truth each 0 exact; `rows/stage3-series.json`); `7fdccd8d` the D series from the demo
commit `157b7109` (FREEZE-E2E's) by its own `scripts/demo-series.sh`, equal byte for byte to FREEZE-E2E's run,
`rows/stage3-d-series.json`; `e7b44077` docs and `docs/lines/codecs.md`.
**Next: the lab client** (Owed item 3), under `lab/htj2k-tiles/improve/stage3/`, product never imports it. Design found
from the demo commit's code: one lab page on the product's `DownloaderClient` (`/client/transport/consumer.js`), as
`lab/av1/delivery/total-time/page.js` does. D, D′: fill the OQ series with the decoder the viewer picks
(`client/viewer/viewer.js` ~l.140: `digests`, `groupLength` from `meta.lossy.g`, its `decoder`); Lossless = a second
client on the exact series `{decoders: 1, decoder: await built("openjph"), digests}` (the viewer's `connectExact`),
`requestExactFrame(mid)`, timed request → picture. D+T3, D+L★, S★: a client on the `-bands` series with `decode: false`
(downloader.js `arrived()` hands raw entry bytes to the page), the strips decoded on `decode/worker.js`'s three
workers as each strip's bands land (whole strip: delivered build; a level: the lab level binding); D+L★ asks the
fit's bands first; S★ fills at the fit's bands; I4's OPFS store of bands and level pictures and the reopen (J10), with
the two cache mutants. Every picture's sha256 against `frames.json`'s truth after the clock. Then a stage-3 driver on
the demo commit's `lab/av1/delivery/total-time/run.mjs` rig (one server per visit there; D needs two: the OQ and the
exact), `parity.mjs` on both builds, and §Improve's stage 3 as written: shards S3a–S3c, rows pushed as they land.
Serve from a tree = the demo commit plus `lab/htj2k-tiles/improve` copied in (`--serve`, `--bin`), printing both
commits; do not merge the demo tip into this branch (it would widen PR #324).
Setup in a fresh container (~10 min): `OUT=/home/user/htj2k-data lab/av1/fetch_data.sh dbts_a1 dbts_b1 dbts_c1`;
`pip install meson && ingest/tools.sh`; `git worktree add --detach /home/user/demo 157b7109`, copy `aom-3.15.1 dav1d
openjph` from this branch's `ingest/.build` into `/home/user/demo/ingest/.build`, `ln -s` this branch's
`lab/av1/.venv` there, `cd /home/user/demo && cargo build --release -p series-server -p pack-series && DATA=/home/user/htj2k-data
scripts/demo-series.sh /home/user/demo-series` (458 s) and check `rows/stage3-d-series.json`; from
lab/htj2k-tiles/improve: `../../av1/.venv/bin/python stage3_prep.py ../../../ingest/.build /home/user/htj2k-data
../../../lab/.av1-work/htj2k-improve dbts_a1 dbts_b1 dbts_c1` (~1 min) then `stage3_check.py` per volume. For stage 2's
pieces and the WASM builds: OpenJPEG v2.5.4 native (cmake, `-DBUILD_SHARED_LIBS=OFF -DBUILD_CODEC=ON`);
`client/decode/wasm/build/build.sh` fills its cache, then with no Docker daemon `bash client/decode/wasm/build/inside.sh
$PWD/client/decode/wasm/build/.cache $PWD/client/decode/wasm/built 0:0` and `sha256sum -c` against manifest.sha256;
`lab/htj2k-tiles/improve/decode/build_levels.sh`. Write rows outside the repo while a writer runs and copy them in.
HTJ2K-VERDICT waits on this row.
* **S3a running since 2026-11-11 23:52 UTC** (rounds 0–1, all 40 cells × 5 arms; ~2.5–3 h a round on this host).
  Pushed after: `29d85ac9` summary.py, `0ebc4be8` README, `ef5f1c62` parity (PARITY OK, both builds) and pins,
  `bc27fe97` docs §Improve, measured: stage 3 (amendments, mutants). `/home/user/pusher.sh` copies
  `/home/user/s3a.jsonl` to `rows/stage3-s3a.jsonl` and pushes, and bumps this heartbeat, every 15 min.
  **To resume:** keep only complete rounds of `rows/stage3-s3a.jsonl` (a round is complete with 200 rows); set up the
  container as above (~15 min, plus `lab/.demo-series`), then run the first incomplete round on with
  `--first-round K --rounds 2-K` into a new file `rows/stage3-s3a-K.jsonl`; then S3b (`--first-round 2 --rounds 2`),
  S3c (`--first-round 4 --rounds 2`), each ≤ 4.5 h, stopping at a round's end. Then `summary.py` over all kept rows
  and the readings R3–R7 in docs §Improve, measured: stage 3, `docs/lines/codecs.md`, this Result.
## Result
* Stages 0–2 of `docs/htj2k-tiles.md` §Improve's protocol run; stage 3's inputs built (strip series 294/294 exact from
  the entries; D series from `157b7109`, equal to FREEZE-E2E's), its client and runs not yet, so R3–R7 are undecided.
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
