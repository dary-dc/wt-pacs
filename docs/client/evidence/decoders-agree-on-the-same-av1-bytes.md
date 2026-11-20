# Do the client's AV1 decoders return the same samples for the same bytes?

**Question:** the client decodes an optimal-quality frame through WebCodecs or, after a refusal, dav1d-WASM, and the
ingest decodes it through native dav1d. Do they all return the same samples, so that one digest taken at the ingest
holds for whichever decoder the page used?

*Folded 2026-11-14 from `claude/av1-residual-exact:docs/av1/residual-exact.md` §Verdict, §1, §2 (measured,
2026-11-07, `6c6cfb44`). It was asked for the residual (dropped 2026-11-09), whose exactness rested on equal decodes;
the same equality is what the reconstruction digest rests on
([`optimal-quality-reconstruction-digest.md`](optimal-quality-reconstruction-digest.md)).*

## Sources (theory)

AV1 §7.2: with `film_grain_params_present` = 0, "decoders shall produce output frames that are identical in all
respects"; film grain lifts that. WebCodecs' `copyTo()` with no `format` is a byte copy, and Chromium hands it dav1d's
luma. Every sequence header of the 20 views below has film grain off (read, and the reader mutated).

## Results (measured)

Fixtures: `dbts_a1`, `dbts_b1`, `dbts_c1` (one dataset; A and C 12-bit, B 10-bit); 20 views: Q 4 and 8, G 1 and 16,
the 12-bit volumes both at 12 bits and as their top 10 bits. One 4 vCPU Intel Xeon host at 2.10 GHz, headless Chromium 153, no GPU; nothing here is throughput-bound.

* **0 of 21 559 207 680 luma samples differ, over 6 200 frames**, between native dav1d 1.5.4 (1 and 4 threads), the
  host's libdav1d 1.4.1, libaom's reference `aomdec` 3.15.1, dav1d-WASM 1.5.4 and Chromium's WebCodecs, on every view
  each decoder accepted. The comparison catches a single flipped sample in every arm it judges (mutation).
* **WebCodecs in Chromium 153 refuses every 12-bit view** (24 of 24 arms: `decode()` rejects the key chunk though
  `isConfigSupported` says yes); those decode only through dav1d-WASM, which matches.
* **No hardware path in the cell:** `isConfigSupported` says no to `prefer-hardware` on 20 of 20 views, and
  `prefer-software` and `no-preference` both name `Dav1dVideoDecoder`, platform decoder `false` (24 of 24).
* **Found:** the lab's bare `dav1d` binary links libdav1d dynamically and loads the host's library when
  `LD_LIBRARY_PATH` is unset (1.4.1 here, not the pinned 1.5.4). Harnesses that call it bare may have decoded with the
  host's library (*unverified* on their hosts); here the two versions agree on every sample, so nothing here depends
  on it.

## Verdict, with its scope

On three DBT volumes, Q 4 and 8, G 1 and 16, film grain off, software decoders only: every decoder the client or the
ingest uses returns the same samples. It does not cover a hardware decoder, another browser's pipeline, a future
Chromium, other coding tools (higher Q, alt-ref, other `--cpu-used`), breast ultrasound cine or ABUS. Owed: the
hardware and other-browser runs (desktop GPU in Chrome, Android, Safari, Firefox) and the Argon conformance set through
the product's dav1d-WASM build.
