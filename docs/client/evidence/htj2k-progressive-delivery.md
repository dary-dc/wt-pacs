# HTJ2K progressive delivery: the resolution ladder and quality layers against the AV1 view

**The question:** can the exact HTJ2K series itself, sent progressively (by resolution level, or by quality layer),
give the reader an early picture comparable to the AV1 view while keeping the exact series at today's bytes?

*Folded 2026-11-14 from `claude/htj2k-progressive:docs/decode/README.md` (`a7f89db1`) §HTJ2K progressive, measured
(2026-11-02/03, a session given the protocol and nothing else), §HTJ2K quality layers, built (2026-11-04) and §HTJ2K
quality layers, measured (2026-11-04/05); the pre-registered protocol is §HTJ2K progressive protocol in that file.
Harness and rows: `claude/htj2k-progressive:lab/htj2k-progressive/`. The AV1 preview it was compared with is
superseded by the 2026-11-09 design (one optimal-quality view, the exact frame on request); the HTJ2K-side facts stand.*

## Fixtures and saturation

Fifteen DBT volumes (994 frames) and the cine-like sets (`dbt12_ea1141`, `dbt10_ea1141`, `dbt12_c`, `dbt10_d`,
`rf_fluoro`, `mr_ispy1`, `mr9_ispy2`) plus lossy-sourced ultrasound; delivery timed on `dbts_a1`, `dbts_b1`,
`dbts_c1`. One 4 vCPU container (KVM, Xeon 2.80 GHz), headless Chromium 153, the relay alone on its own core. **Where
it saturates:** the unshaped cell voided in all 112 visits (dropped; nothing claimed above 50 Mbit/s); the relay voided
32–41 % of visits at 5 and 20 Mbit/s (both readings given, same verdict). The AV1 preview's exact series is
decode-bound at 4× and 50 Mbit/s. **Four rounds, n = 1–4 kept a cell**, against the protocol's 12.

## The resolution ladder (measured)

* **Exact.** The ladder's codestreams equal the ingest's; every level of every frame of 26 sets decodes to two
  independent witnesses; 83 200/83 200 pictures exact in stage 2. **A decoder reuse bug found and fixed in the lab
  decoder:** OpenJPH 0.31.0's `codestream::restart()` resets `skipped_res_for_read` and `skipped_res_for_recon` but
  not the SIZ's `skipped_resolutions`, which `restrict_input_resolution` sets and only `param_siz::init()` clears, so a
  reused decoder after a level (or a prefix that threw) read the next frame at the reduced size. **A product binding
  of `restrict_input_resolution` needs the same reset.**
* **Bytes, the smallest exact prefix's share** (15 DBT volumes): level 1 26.2–28.5 %, level 2 6.65–7.66 %, level 3
  1.78–2.40 %, level 4 0.53–0.95 %, level 5 0.19–0.56 %.
* **Quality.** No prefix of any level met the visually lossless proxy on any frame of any set; "exact at its level"
  is exact against the codestream's own reduced resolution, not against a viewer's resampling of the exact frame.
* **Decode** (× the whole frame): level 2 alone ×0.08–0.13 at 1×; a level then the frame from scratch ×1.10–1.45.
* **Delivery** (`dbts_b1`, `dbts_c1`; `dbts_a1` has no split at its fit level): every slice at display scale
  **×0.272–0.287 of today's exact series** (rule ≤ 0.3: holds at 5 and 20 Mbit/s); the exact series ×1.000–1.002 (holds);
  **the first picture ≤ 1.5× the AV1 preview's: fails in every cell, ×1.9–7.8** (strict and with the A/A spread of
  0–3.1 %), because the fit prefix is 27 % of a frame against the preview's base of 0.02–0.04 %. Every slice pictured
  at level 2 on 5 Mbit/s: 7.95–13.3 s, against the preview's 0.37–1.30 s.
* **Verdict: the ladder is not a candidate beside AV1** by the rule as written; more rounds would move the ratios, not
  the verdict (every cell failed by ×1.9 or more against 1.5).

## Quality layers (built, then measured)

* **Built:** a lab writer for both shapes (its one-layer output equal to `ojph_compress`'s byte for byte). One set, two
  layers: layer 1 80–99 % of today's bytes, the whole ×0.985–1.000. Two sets: layer 1 55–84 % (plane 1) to 0.4–1.3 %
  (plane 7), the whole that plus 99.7–100.6 %. **No open encoder writes HTJ2K with more than one layer** (OpenJPH,
  Grok, OpenJPEG, FFmpeg read at their tags), and no decoder here reads the layered bytes whole (OpenJPEG 2.5.4
  refuses or misreads layer 2); the client's OpenJPH build refuses two layers.
* **Measured** (23 grey sets, OpenJPH 0.31.0 patched to read layers, 2–3 rounds of the protocol's 12): **one set, two
  layers is interesting only on `rf_fluoro`**: its layer 1 at the proxy at full size, the whole ×0.988 of today's
  bytes, the exact series ×0.988–1.037; on `dbts_c1` and `dbt12_c` the same except at 50 Mbit/s 4× (×1.12–1.15, the
  whole's ×1.3–1.5 decode). Layer 1 is 77–99 % of the bytes, so the proxy comes 14–16 % before the exact series and
  the first picture no sooner. **Two sets are closed:** wherever layer 1 reaches the proxy the whole is ×1.45–1.85.

## Verdict, scope

For the scroll, progressive HTJ2K does not stand beside the AV1 view on these fixtures and this host: the ladder's first
picture fails its rule everywhere; layers give no earlier first picture. The facts that carry to the client: the
level byte shares, the SIZ reset any product use of reduced-resolution decode needs, and that no open encoder writes
layered HTJ2K. The exact level picture shown before the Lossless frame is a separate, surviving candidate
([`exact-frame-by-htj2k-layout.md`](exact-frame-by-htj2k-layout.md)).

Raw rows: `claude/htj2k-progressive:lab/htj2k-progressive/rows/` (`stage3-volumes.md`, `stage3-cine.md`, `stage1-levels.md`).
