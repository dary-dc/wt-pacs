state: started
started: 2026-11-11 18:59 UTC
heartbeat: 2026-11-11 21:35 UTC
outputs: `claude/htj2k-tiles` e7b44077 (rows, docs; draft PR #324 into main, already open: the commits land in it)
## Resume
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
