# Decode on a phone's browser: code only the content's rectangle

*Queue row MOBILE-OPT-CONTENT-CROP, 2026-11-15, by its brief in `claude/work-ledger:docs/queue-client-2026-11-14.md`
§The new mobile options, from `new-options.md` §6. The option's advocate: its best version, then its costs. Theory
and sources first; one cloud cell, pre-registered here before it ran. Nothing run on a phone or a GPU.*

Labels as in `new-options.md`: **(S)** a source quoted, listed in §9 with its revision; **(R)** a result of this
repository, by its file; **(M)** measured by this row's cell (§7); **(D)** derived here, the arithmetic written out;
**(T)** theory, not measured.

## 7. The cell, pre-registered

Written and pushed before anything ran. **A limit stated first:** the standing rule asks that a protocol be written by
a session other than the one that measures; this row's brief asks the row to pre-register its own cell, so one session
wrote this section and ran it. The predictions below were committed before the first frame was read.

**Fixtures.** The 19 DBT volumes of `docs/FIXTURES.md` §AV1 data (`dbts_a1`…`a5`, `dbts_b1`…`b5`, `dbts_c1`…`c5`,
`dbt12_ea1141`, `dbt12_c`, `dbt10_ea1141`, `dbt10_d`), fetched by `lab/av1/fetch_data.sh`, checked against
`lab/av1/data.json`. `dbt10_ea1141` and `dbt10_d` are stored already cropped to their non-zero box by the fetch (their
`crop` in `data.json`); their share of the detector's matrix (1890 × 2457) is reported beside their share of the
stored frame. Three reconstruction systems of one dataset; one 4-core x86-64 cloud host without a GPU.

### 7.1 Cell A: the rectangle

* **The background rule.** A volume's background value `bg` is the most frequent sample value among the samples of
  the outermost row and column on every side of every frame. A sample is *content* if it is not exactly `bg`. The
  volume's rectangle is the bounding box of content over **all** frames (one coded size a series, as one AV1 sequence
  needs), and, for the record, each frame's own box.
* **Why exactly `bg`:** every sample outside the rectangle then equals `bg`, so a paint that fills the outside with
  `bg` shows exactly the source there; the crop loses nothing (D). A threshold above `bg` would be a lossy rule and is
  not tested.
* **The safe rectangle**: the volume's box widened by a margin of 8 samples a side, then each side rounded outward
  to a multiple of 8 from the matrix's origin, clipped to the matrix. *No safe rectangle* when that box's area is
  0.90 of the matrix or more (the crop would save under 10 %).
* **Reported per volume:** `bg`, its count on the border, the share of all samples equal to `bg`; the box, the safe
  box and their areas as shares of the stored matrix; the mean and maximum of the per-frame box shares; the AV1 level
  the safe box needs (S1, Annex A.3: 4.x if its area ≤ 2 359 296, width ≤ 6144 and height ≤ 3456, else 5.x if ≤
  8 912 896, ≤ 8192, ≤ 4352).

**Predictions** (P-A1…P-A4, before the run):

* **P-A1.** System B (`dbts_b1`…`b5`, fixed detector sizes 2560 × 3328 and 1890–1996 × 2457): `bg` is 0 and the safe
  box's share is 0.25–0.60 on every volume, from the two system-B fixtures stored cropped at 0.25 and 0.38 (R).
* **P-A2.** Systems A and C, whose stored sizes differ by exam (`dbts_a1` 1142 × 1785, `dbts_a3` 712 × 2041, …),
  already crop to the breast at reconstruction: safe box share 0.80–1.00, and *no safe rectangle* on at least half
  of their ten volumes.
* **P-A3.** `dbt10_ea1141` and `dbt10_d`: share of the stored frame 1.00 (their crop is already the non-zero box);
  `dbt12_ea1141` and `dbt12_c` as P-A2.
* **P-A4.** `dbts_b1`'s safe box fits level 4.x (needs share under 0.277 of 2560 × 3328, `new-options.md` §6): **no**,
  predicted share 0.30–0.50 (a CC view of a large detector); `dbts_c1`'s needs ≤ 2 359 296 of 2 452 688 samples
  (0.962): **yes** if it has any safe rectangle.

### 7.2 Cell B: what the crop does to bytes and decode

* **Which volumes.** Those with a safe rectangle (§7.1), at most six: the three timed volumes `dbts_a1`, `dbts_b1`,
  `dbts_c1` if they have one, then the remaining eligible volumes by smallest safe share, up to six.
* **Frames.** The middle 16 frames of each (two G 8 groups), the same frames in both arms.
* **Arms.** *whole*: the stored frame. *crop*: the safe box cut from it. Both coded the same way:
  * the AV1 view as `docs/av1/payload-format.md` §Optimal quality codes it, Q 8 G 8, depth min(b, 10), a 12-bit source
    cut to its top 10 bits (rounded, as `top10` in `lab/av1/profiles/bytes.py`), aomenc 3.15.1 with the payload
    format's arguments, one thread; decoded by dav1d 1.5.4 `--threads=1`, output to the `null` muxer;
  * HTJ2K lossless as the exact series is coded (OpenJPH 0.31.0 `ojph_compress -num_decomps 5 -block_size {64,64}
    -prog_order RPCL -reversible true`), one frame a file, decoded by `ojph_expand` to a file on `/dev/shm`.
* **Bytes**: the sum over the 16 frames, crop ÷ whole.
* **Decode**: wall time of the decoder process over the 16 frames, repeated 7 times, the arms interleaved (whole,
  crop, whole, crop, …; the first pair discarded as warm-up), one process at a time on an otherwise idle host (one of
  four cores busy: not saturated). Reported as the ratio of medians, crop ÷ whole, per volume and codec. No absolute
  time is claimed from a cloud host; a ratio on one host only.
* **Checks:** every crop arm's decoded frames, put back into a frame filled with `bg`, equal the whole arm's source
  outside the box (by construction) and, for HTJ2K, the source exactly everywhere.

**Predictions** (P-B1…P-B3), with *s* the volume's safe share:

* **P-B1 (bytes).** Background is flat and costs little in either codec: bytes ratio 0.90–1.00 for AV1 and for HTJ2K
  on every volume, far above *s*.
* **P-B2 (decode, AV1).** dav1d's work has a part per block that a skipped flat block still pays (prediction, loop
  filters, CDEF and restoration run over the whole frame): decode ratio between *s* and (1 + *s*) ÷ 2.
* **P-B3 (decode, HTJ2K).** The inverse wavelet runs over every sample and empty code-blocks cost almost nothing:
  decode ratio between *s* and (1 + *s*) ÷ 2, nearer *s* than AV1's.

A miss is reported as a miss beside its prediction.
