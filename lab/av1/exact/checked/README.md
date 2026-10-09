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

**What was run** (2026-10-09): not this folder's variants, but total-time's own `check` variant —
`htj2k`'s frames with their digests ([`../../delivery/total-time/README.md`](../../delivery/total-time/README.md) §Row EXACT) —
on `dbtproj_ge` for the projections. The AV1 variants here (`av1chk`, `av1dchk`, `av1mchk`) have not been timed.
