state: done
started: 2026-11-11 18:59 UTC
heartbeat: 2026-11-12 15:08 UTC
outputs: `claude/htj2k-tiles` ef5adda2 (lab/htj2k-tiles/improve/stage3/, rows/stage3-*.jsonl, docs/htj2k-tiles.md §Improve, measured: stage 3; draft PR #324 into main, already open)
## Resume
Session 4 resumed 2026-11-12 13:25 UTC (stalled since 12:03, S3c at 153 visits of round 4, `cc035d06`): fresh container; setup as below, then S3c rounds 4–5 again into `rows/stage3-s3c-4.jsonl` (the 153 rows of round 4 are incomplete, so not kept). Setup done 13:45 as below (MANIFEST OK on the delivered build; levels.wasm sha256 equals the pins' 09756bcf; strip series 294/294 exact again).
  **S3c rerun running** from about 13:50: `/home/user/demo`, `--first-round 4 --rounds 2 --out /home/user/s3c4.jsonl`; `/home/user/pusher.sh` copies it to `rows/stage3-s3c-4.jsonl`, pushes and bumps this heartbeat every 15 min. **To resume:** keep only complete rounds (200 rows each) of `rows/stage3-s3c-4.jsonl`; set the container up again; run what is missing (`--first-round 5 --rounds 1` into `rows/stage3-s3c-5.jsonl` if round 4 is complete); then `python3 lab/htj2k-tiles/improve/stage3/summary.py rows/stage3-s3a.jsonl rows/stage3-s3b.jsonl <S3c's complete rounds>`, the readings R3–R7 in `docs/htj2k-tiles.md` §Improve, measured, `docs/lines/codecs.md`, this Result, done. `rows/stage3-s3c.jsonl` (153 rows of round 4, session 3) is incomplete and not kept.
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
* **S3a round 0 complete** (23:52–03:00, 3.1 h; `bd3252bb`, 200 rows in `rows/stage3-s3a.jsonl`): 180 kept, 13 void
  (relay late), 7 failed, all "no result in 720 s" after every byte had arrived (the relays' packet counts are full),
  so the page stalls after the transfer, cause unknown. Round 1 runs from 03:01 with `f606474f` (the same timed
  paths, plus a stall report: the page's stage and counts, read on timeout); the pins name each round's client. R0
  holds in every kept visit; the OQ digest agrees across D visits on every volume. J10's 0 asks and 0 decodes hold
  70/70; two D+L★ reopens on `dbts_b1` gave one picture in 50 different from its filled copy. From S3b, `3ec91da1`'s
  driver names the differing frames (sync it into the tree first: `/home/user/sync.sh`). The pre-registered
  decode-bound test (D's every-slice at 4× > 1.05 × 1×) names 13 of 20 (set, link) pairs, which leaves mostly
  `r5000` link-bound; to be stated in the readings, not amended.
* **S3a complete** (`a168d0c3`, 400 rows, 350 kept, 17 failed, 33 void; facts in docs, `f11800dd`). The stall: an
  OPFS write in the lab store never returns, after the clock (reproduced under debug). `f11800dd` restarts the store
  after 30 s and resends the operation, counting `storeRetries`; it is being tested (24 visits, `/home/user/repro2.jsonl`).
  Next: S3b, `/home/user/sync.sh` first, then from `/home/user/demo`: `NODE_PATH=$(npm root -g) node
  lab/htj2k-tiles/improve/stage3/run.mjs --series demo-series --bands lab/.av1-work/htj2k-improve --rounds 2
  --first-round 2 --out /home/user/s3b.jsonl`, with the pusher's paths changed to s3b.
* **S3b complete** (06:42–10:32, `46b31101`, `rows/stage3-s3b.jsonl`, the store retry `564deccb` with its mutant,
  which the retry recovers). The retry test's 24 visits and the mutant ran beside a stray debug driver, so they count
  as checks only. **S3c running from 10:33** (rounds 4–5, `/home/user/s3c.jsonl`, the pusher on s3c). After it:
  `summary.py rows/stage3-s3{a,b,c}.jsonl`, the readings R3–R7 in docs, `docs/lines/codecs.md`, this Result, done.
* **Done** 2026-11-12 14:25 UTC: S3c complete (`9d622d3e`), readings `ef5adda2`. Nothing left to resume; HTJ2K-VERDICT is next.
## Result
* Stages 0–3 of §Improve's protocol run. Stage 3: 1 200 visits over 6 rounds, 1 053 kept (125 void, 22 stalled in the
  lab store after the clock); R0 exact in every kept visit; PARITY OK on both builds; the cache mutants are caught.
* The decode-bound test as written leaves `r5000` the only link-bound cell (the software AV1 fill slows D at 4×).
* R3 holds with s on that cell: D+T3's Lossless is ×0.923 of D's on `dbts_b1` at 4× (×0.73–0.92 in cells that decide
  nothing), and ≤ ×1.02(1+s) of D in 40/40 groups. So D+T3 is proposed for the Lossless request (Layout 1).
* R4 holds: D+L★'s level picture is ×0.29 of D+T3's Lossless, its Lossless ×1.00–1.01. D+L★ is proposed beside D+T3.
* R5: S★ is withdrawn for the scroll; it is ×5.8–20 later to every slice where the fit is level 0.
* R6 holds: every reopen asks and decodes nothing (1 053/1 053). Outside the rule, 18 `dbts_b1` reopens read one 17 MB
  OQ picture back differently from the lab store.
* R7: the lossy cell moves ratios by ×0.4–4 (s up to 3.9); named, deciding nothing.
* Amendments before any run: D is Q 8 G 16; two relays a visit; the store is written after the clock.
* Fixtures: three timed DBT volumes of one dataset (EA1141); no breast US cine; 4-core host, no GPU, headless Chromium
  153, software WebCodecs; 4× cgroup throttle; emulated links. Nothing that only a phone can show is claimed.
* Owner: whether Layout 1 (three strips, band-major) becomes the DBT store format for the Lossless request; whether
  an exact level picture may be shown before the frame (D+L★), and in what words.
