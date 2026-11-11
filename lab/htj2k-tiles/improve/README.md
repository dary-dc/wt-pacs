# htj2k-tiles/improve

[`docs/htj2k-tiles.md`](../../../docs/htj2k-tiles.md) §Improve's protocol, pre-registered by row HTJ2K-IMPROVE and run
by row HTJ2K-MEASURE, a session that wrote none of it. The readings and any amendment are in the same doc,
§Improve, measured.

```bash
ingest/tools.sh                                                    # OpenJPH 0.31.0's ojph_compress and ojph_expand
# OpenJPEG 2.5.4 native (tag v2.5.4, commit 6c4a29b0), as lab/av1/bytes/embedded/build.sh's first half builds it
OUT=DATA lab/av1/fetch_data.sh dbts_a1 dbts_b1 dbts_c1
lab/av1/.venv/bin/python lab/htj2k-tiles/improve/offline.py ingest/.build OPJ/opj_decompress DATA dbts_b1 \
  lab/htj2k-tiles/improve/rows/stage0-dbts_b1.jsonl            # stages 0 and 1, every frame; --mutate NAME
```

**Stage 0 and 1, offline** ([`offline.py`](offline.py)), every frame: today's codestream (the ingest's arguments)
and I1's (`-tileparts R -tlm_marker true`, NL 5, or 6 where DICOM's base ≤ 64 asks it: `dbts_b1`) of the whole
frame; I2's three strips in I1's profile, boundaries on multiples of 2^NL. Each TLM length is checked against its
SOT's Psot; each level's TLM prefix, EOC appended, is decoded by OpenJPEG 2.5.4 (`-r ℓ -allow-partial`) and by
OpenJPH's `ojph_expand -skip_res ℓ,ℓ` and held against the reversible 5/3 analysis of the strip
(`lab/av1/decode/resolution-level/ll.py`, `witness.py`'s `reduced`); the level-0 strips stacked against the frame's
sha256; Layout 1's three bands cut at TLM boundaries and tiling the strip. Mutants (`--mutate`), each must turn R0 off:
`tlm-short` (every TLM length one byte short), `strip-order` (strips stacked reversed), `untiled-truth` (a strip's
level truth taken from the untiled frame), `truth` (every comparison's truth flipped).
