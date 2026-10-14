# checked

The frame check as built ([`client/README.md`](../../../../client/README.md) §A frame says whether it is
exact): what it costs a whole fill through the downloader, and that every decoder path says `exact: true`.
Queue row 88 (EXACT) of [`docs/av1/queue.md`](../../../../docs/av1/queue.md); the reading is in
[`docs/adr/exactness-in-production.md`](../../../../docs/adr/exactness-in-production.md) §Built.

```bash
lab/av1/fetch_data.sh mr_ispy1 rf_fluoro dbtproj_c ffdm_a
D=lab/av1/data
lab/av1/.venv/bin/python lab/av1/exact/checked/make_frames.py lab/.av1-build lab/.av1-work/exact $D/mr_ispy1 $D/rf_fluoro $D/dbtproj_c $D/ffdm_a
NODE_PATH=$(npm root -g) node lab/av1/delivery/total-time/run.mjs --frames lab/.av1-work/exact --variants htj2k,chk --rounds 10 --out rows.jsonl
```

The setup is total-time's ([`../../delivery/total-time/README.md`](../../delivery/total-time/README.md)): the
real server behind the relay, a fresh browser a visit, cells and variants Williams-ordered per round.

**What was run** (2026-10-09). Two runs, both read in the ADR's §Built. The other build's session ran
total-time's own `check` variant ([`../../delivery/total-time/README.md`](../../delivery/total-time/README.md) §Row
EXACT) on three links with `dbtproj_ge`. This folder's `htj2k` and `chk` ran on all five of row 23's links, 10 rounds,
with `dbtproj_c` (`dbtproj_ge` answered 404 that day); its AV1 variants (`av1chk`, the product's choice; `av1dchk`,
WebCodecs taken away; `av1mchk`, the `mixed` split) one round on r50000 at 1× in Chromium and in Firefox 157.0.1
(`--engines chromium,firefox`, `FIREFOX_PATH` set), for exactness only; they are not timed. The ingest mutants were
made by editing `frame_digest` and running `make_frames.py --frames 4` on `mr_ispy1` and `ct_lidc` into a separate
`OUT`.
