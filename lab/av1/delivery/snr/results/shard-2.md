## SNR preview, collected

rounds 10; VOID blocks 2

| volume · G · VL rung | A/A: median log (interval), n | A/A | arms flagged by order (p) |
| --- | --- | --- | --- |
| dbts_a1 · 1 · 4 | +0.0076 (-0.1233, 0.0717), 10 | passes | — |
| dbts_a1 · 1 · 8 | +0.0063 (-0.0513, 0.1136), 10 | passes | — |
| dbts_a1 · 8 · 4 | -0.1259 (-0.4222, -0.03), 10 | fails: not read | — |
| dbts_a1 · 8 · 8 | +0.0202 (-0.0072, 0.2215), 10 | passes | — |
| dbts_a1 · 16 · 4 | -0.0173 (-0.1389, 0.0477), 10 | passes | — |
| dbts_a1 · 16 · 8 | -0.0262 (-0.0933, 0.0192), 10 | passes | — |
| dbts_b1 · 1 · 4 | -0.0127 (-0.205, 0.0328), 9 | passes | — |
| dbts_b1 · 1 · 8 | +0.0179 (-0.0174, 0.0586), 9 | passes | — |
| dbts_b1 · 8 · 4 | -0.0090 (-0.0983, 0.1551), 10 | passes | — |
| dbts_b1 · 8 · 8 | -0.0253 (-0.0692, 0.0361), 10 | passes | — |
| dbts_b1 · 16 · 4 | -0.0046 (-0.0512, 0.0252), 10 | passes | — |
| dbts_b1 · 16 · 8 | +0.0117 (-0.056, 0.1144), 10 | passes | — |
| dbts_c1 · 1 · 4 | +0.0200 (-0.1778, 0.0549), 10 | passes | — |
| dbts_c1 · 1 · 8 | +0.0118 (-0.0297, 0.0478), 10 | passes | — |
| dbts_c1 · 8 · 4 | -0.0058 (-0.0528, 0.091), 10 | passes | — |
| dbts_c1 · 8 · 8 | -0.0019 (-0.0647, 0.3899), 10 | passes | — |
| dbts_c1 · 16 · 4 | -0.0180 (-0.0933, 0.0185), 10 | passes | — |
| dbts_c1 · 16 · 8 | -0.0443 (-0.1106, 0.0286), 10 | passes | — |

A/A decided (interval excludes 0) in 1 of 18 readable blocks

## dbts_a1 · G 1 · visually lossless rung Q 4

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 8842 B · 1.81 ✗ | 6161 B · 2.11 ? | 281178 B · 2.81 ✗ | 6161 B · 2.11 ? | 848 B · — | 1256607 B · 1.06 ? |
| every slice, preview | 669297 B · 96.2 ✗ | 432657 B · 89.5 ? | 15588376 B · 164 ✗ | 432657 B · 89.5 ? | 55223 B · — | 67812443 B · 59.3 ? |
| every slice, visually lossless | 20218772 B · 382 ✗ | 16021033 B · 257 ✗ | 15588376 B · 164 | 16021033 B · 257 ✗ | 66403640 B · — ? | 67812443 B · 59.3 ? |
| every slice, exact | 75956610 B · 456 ✗ | 70884030 B · 333 ✗ | 70451373 B · 239 ✗ | 83833476 B · 316 ✗ | 66403640 B · — | 67812443 B · 59.3 ? |
| jump, preview | 12031 B · 1.97 ✗ | 7770 B · 1.84 ? | 278887 B · 3.33 ✗ | 7770 B · 1.84 ? | 991 B · — | 1213665 B · 1.05 ? |
| jump, visually lossless | 361824 B · 7.47 ✗ | 286657 B · 5.18 ✗ | 278887 B · 3.33 | 286657 B · 5.18 ✗ | 1188563 B · — ? | 1213665 B · 1.05 ? |
| jump, exact | 1359417 B · 8.85 ✗ | 1268684 B · 6.66 ✗ | 1260914 B · 4.82 ✗ | 1500322 B · 6.24 ✗ | 1188563 B · — | 1213665 B · 1.05 ? |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 0, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 44.35 · 44.30 dB, visually lossless 54.28 · 53.71 dB (quantizers [25, 3])

*Reported:* per frame, median over rounds: snr preview frame 1.66; snr VL frame 4.92; snr residual decode 1.08; snr add 0.255; two preview frame 1.52; two VL frame 2.78; two residual decode 1.11; two add 0.255

* **snr against svc: not read** — snr dominates at no stage; svc dominates at no stage
* **snr against sep: worse** — snr dominates at no stage; sep dominates at first picture, every slice, preview, every slice, visually lossless, jump, preview, jump, visually lossless
* **snr against one: a trade** — snr dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: not read** — two dominates at no stage; svc dominates at no stage
* **two against sep: neither dominates** — two dominates at no stage; sep dominates at no stage
* **two against one: a trade** — two dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at first picture, every slice, preview, every slice, visually lossless, every slice, exact, jump, preview, jump, visually lossless, jump, exact

## dbts_a1 · G 1 · visually lossless rung Q 8

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 8842 B · 2.21 ✗ | 6161 B · 2.08 ✗ | 84454 B · 2.12 ✗ | 6161 B · 2.08 ✗ | 848 B · 0.273 | 1256607 B · 1.23 ✗ |
| every slice, preview | 669297 B · 118 ✗ | 432657 B · 108 ✗ | 4655594 B · 115 ✗ | 432657 B · 108 ✗ | 55223 B · 12.4 | 67812443 B · 60 ✗ |
| every slice, visually lossless | 5584289 B · 374 ✗ | 5088251 B · 222 ✗ | 4655594 B · 115 | 5088251 B · 222 ✗ | 66403640 B · 609 ✗ | 67812443 B · 60 |
| every slice, exact | 70307203 B · 452 ✗ | 69519738 B · 299 ✗ | 69087081 B · 193 ✗ | 72900694 B · 280 ✗ | 66403640 B · 609 | 67812443 B · 60 |
| jump, preview | 12031 B · 2.44 ✗ | 7770 B · 2.08 ✗ | 83341 B · 2.18 ✗ | 7770 B · 2.08 ✗ | 991 B · 0.286 | 1213665 B · 1.16 ✗ |
| jump, visually lossless | 99972 B · 7.39 ✗ | 91112 B · 4.29 ✗ | 83341 B · 2.18 | 91112 B · 4.29 ✗ | 1188563 B · 11.6 ✗ | 1213665 B · 1.16 |
| jump, exact | 1258331 B · 8.96 ✗ | 1244268 B · 5.78 ✗ | 1236498 B · 3.61 ✗ | 1304777 B · 5.45 ✗ | 1188563 B · 11.6 | 1213665 B · 1.16 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 10, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 44.35 · 44.30 dB, visually lossless 48.08 · 47.89 dB (quantizers [25, 8])

*Reported:* per frame, median over rounds: snr preview frame 1.95; snr VL frame 4.24; snr residual decode 1.23; snr add 0.328; two preview frame 1.8; two VL frame 1.97; two residual decode 1.11; two add 0.329

* **snr against svc: a trade** — snr dominates at every slice, visually lossless, jump, visually lossless; svc dominates at first picture, every slice, preview, jump, preview
* **snr against sep: worse** — snr dominates at no stage; sep dominates at first picture, every slice, preview, every slice, visually lossless, jump, preview, jump, visually lossless
* **snr against one: a trade** — snr dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: a trade** — two dominates at every slice, visually lossless, jump, visually lossless; svc dominates at first picture, every slice, preview, jump, preview
* **two against sep: neither dominates** — two dominates at no stage; sep dominates at no stage
* **two against one: a trade** — two dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at first picture, every slice, preview, every slice, visually lossless, every slice, exact, jump, preview, jump, visually lossless, jump, exact

## dbts_a1 · G 8 · visually lossless rung Q 4

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 8842 B · 1.67 ? | 6161 B · 1.79 ? | 281178 B · 2.74 ? | 6161 B · 1.79 ? | 848 B · — | 1256607 B · 1.03 ? |
| every slice, preview | 310476 B · 69.7 ? | 209754 B · 79 ? | 15681641 B · 147 ? | 209754 B · 79 ? | 15062 B · — | 67812443 B · 57.8 ? |
| every slice, visually lossless | 19259300 B · 320 ? | 15891395 B · 228 ? | 15681641 B · 147 | 15891395 B · 228 ? | 63882051 B · — ? | 67812443 B · 57.8 ? |
| every slice, exact | 75077895 B · 386 ? | 70870038 B · 293 ? | 70660284 B · 213 ? | 83703838 B · 285 ? | 63882051 B · — | 67812443 B · 57.8 ? |
| jump, preview | 27809 B · 4.98 ? | 18410 B · 5.3 ? | 1248060 B · 9.56 ? | 18410 B · 5.3 ? | 1581 B · — | 1213665 B · 1.02 ? |
| jump, visually lossless | 1542411 B · 20.1 ? | 1266470 B · 15.2 ? | 1248060 B · 9.56 ? | 1266470 B · 15.2 ? | 3911401 B · — ? | 1213665 B · 1.02 |
| jump, exact | 2541411 B · 21.3 ? | 2250509 B · 16.6 ? | 2232099 B · 10.9 ? | 2480135 B · 16.2 ? | 3911401 B · — ? | 1213665 B · 1.02 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 0, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 44.26 · 44.28 dB, visually lossless 54.24 · 53.65 dB (quantizers [25, 3])

*Reported:* per frame, median over rounds: snr preview frame 1.22; snr VL frame 4.27; snr residual decode 0.959; snr add 0.214; two preview frame 1.37; two VL frame 2.49; two residual decode 0.939; two add 0.205

* **snr against svc: not read** — snr dominates at no stage; svc dominates at no stage
* **snr against sep: not read** — snr dominates at no stage; sep dominates at no stage
* **snr against one: not read** — snr dominates at no stage; one dominates at no stage
* **two against svc: not read** — two dominates at no stage; svc dominates at no stage
* **two against sep: not read** — two dominates at no stage; sep dominates at no stage
* **two against one: not read** — two dominates at no stage; one dominates at no stage
* **snr against two: not read** — snr dominates at no stage; two dominates at no stage

## dbts_a1 · G 8 · visually lossless rung Q 8

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 8842 B · 2.17 ✗ | 6161 B · 2.06 ✗ | 84454 B · 2.07 ✗ | 6161 B · 2.06 ✗ | 848 B · 0.262 | 1256607 B · 1.24 ✗ |
| every slice, preview | 309829 B · 99.9 ✗ | 209754 B · 110 ✗ | 4639708 B · 151 ✗ | 209754 B · 110 ✗ | 15062 B · 5.84 | 67812443 B · 59.6 ✗ |
| every slice, visually lossless | 4928175 B · 342 ✗ | 4849462 B · 260 ✗ | 4639708 B · 151 | 4849462 B · 260 ✗ | 63882051 B · 569 ✗ | 67812443 B · 59.6 |
| every slice, exact | 69623222 B · 424 ✗ | 69167785 B · 343 ✗ | 68958031 B · 235 ✗ | 72661905 B · 320 ✗ | 63882051 B · 569 | 67812443 B · 59.6 |
| jump, preview | 27742 B · 7.14 ✗ | 18410 B · 8.14 ✗ | 369734 B · 10.3 ✗ | 18410 B · 8.14 ✗ | 1581 B · 0.554 | 1213665 B · 1.01 ✗ |
| jump, visually lossless | 397671 B · 23.7 ✗ | 388144 B · 18.4 ✗ | 369734 B · 10.3 | 388144 B · 18.4 ✗ | 3911401 B · 28.3 ✗ | 1213665 B · 1.01 |
| jump, exact | 1555527 B · 25.3 ✗ | 1539246 B · 20.1 ✗ | 1520836 B · 12 ✗ | 1601810 B · 19.6 ✗ | 3911401 B · 28.3 ✗ | 1213665 B · 1.01 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 10, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 44.26 · 44.28 dB, visually lossless 48.20 · 47.91 dB (quantizers [25, 8])

*Reported:* per frame, median over rounds: snr preview frame 1.72; snr VL frame 4.32; snr residual decode 1.1; snr add 0.293; two preview frame 1.83; two VL frame 2.57; two residual decode 1.21; two add 0.35

* **snr against svc: a trade** — snr dominates at every slice, visually lossless, jump, visually lossless, jump, exact; svc dominates at first picture, every slice, preview, jump, preview
* **snr against sep: worse** — snr dominates at no stage; sep dominates at first picture, every slice, preview, every slice, visually lossless, jump, preview, jump, visually lossless
* **snr against one: a trade** — snr dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: a trade** — two dominates at every slice, visually lossless, jump, visually lossless, jump, exact; svc dominates at first picture, every slice, preview, jump, preview
* **two against sep: neither dominates** — two dominates at no stage; sep dominates at no stage
* **two against one: a trade** — two dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at first picture, every slice, preview, every slice, visually lossless, every slice, exact, jump, preview, jump, visually lossless, jump, exact

## dbts_a1 · G 16 · visually lossless rung Q 4

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 8842 B · 1.67 ? | 6161 B · 1.79 ? | 281178 B · 3.25 ✗ | 6161 B · 1.79 ? | 848 B · — | 1256607 B · 0.989 ? |
| every slice, preview | 290864 B · 85.4 ? | 199087 B · 92.5 ? | 15685772 B · 171 ✗ | 199087 B · 92.5 ? | 12520 B · — | 67812443 B · 60.1 ? |
| every slice, visually lossless | 19203236 B · 365 ✗ | 15884859 B · 261 ✗ | 15685772 B · 171 | 15884859 B · 261 ✗ | 63715646 B · — ? | 67812443 B · 60.1 ? |
| every slice, exact | 75021387 B · 443 ✗ | 70890324 B · 337 ✗ | 70691237 B · 245 ✗ | 83697302 B · 323 ✗ | 63715646 B · — | 67812443 B · 60.1 ? |
| jump, preview | 45173 B · 12.8 ✗ | 30564 B · 12.7 ? | 2246009 B · 24.6 ✗ | 30564 B · 12.7 ? | 2186 B · — | 1213665 B · 1.03 ? |
| jump, visually lossless | 2759780 B · 52.7 ✗ | 2276574 B · 37.3 ✗ | 2246009 B · 24.6 ✗ | 2276574 B · 37.3 ✗ | 6728356 B · — ? | 1213665 B · 1.03 |
| jump, exact | 3758771 B · 54.1 ✗ | 3261111 B · 38.6 ✗ | 3230547 B · 25.8 ✗ | 3490239 B · 38.4 ✗ | 6728356 B · — ? | 1213665 B · 1.03 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 0, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 44.25 · 44.28 dB, visually lossless 54.23 · 53.64 dB (quantizers [25, 3])

*Reported:* per frame, median over rounds: snr preview frame 1.41; snr VL frame 4.74; snr residual decode 1.04; snr add 0.244; two preview frame 1.6; two VL frame 2.91; two residual decode 1.03; two add 0.242

* **snr against svc: not read** — snr dominates at no stage; svc dominates at no stage
* **snr against sep: worse** — snr dominates at no stage; sep dominates at every slice, visually lossless, jump, preview, jump, visually lossless, jump, exact
* **snr against one: a trade** — snr dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: not read** — two dominates at no stage; svc dominates at no stage
* **two against sep: neither dominates** — two dominates at no stage; sep dominates at no stage
* **two against one: a trade** — two dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at every slice, visually lossless, every slice, exact, jump, preview, jump, visually lossless, jump, exact

## dbts_a1 · G 16 · visually lossless rung Q 8

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 8842 B · 2.18 ✗ | 6161 B · 2 ✗ | 84454 B · 2.63 ✗ | 6161 B · 2 ✗ | 848 B · 0.246 | 1256607 B · 1.08 ✗ |
| every slice, preview | 290430 B · 107 ✗ | 199087 B · 111 ✗ | 4640590 B · 144 ✗ | 199087 B · 111 ✗ | 12520 B · 5.3 | 67812443 B · 61.4 ✗ |
| every slice, visually lossless | 4895364 B · 343 ✗ | 4839677 B · 249 ✗ | 4640590 B · 144 | 4839677 B · 249 ✗ | 63715646 B · 549 ✗ | 67812443 B · 61.4 |
| every slice, exact | 69605633 B · 422 ✗ | 69184169 B · 329 ✗ | 68985082 B · 223 ✗ | 72652120 B · 311 ✗ | 63715646 B · 549 | 67812443 B · 61.4 |
| jump, preview | 45113 B · 15.1 ✗ | 30564 B · 16 ✗ | 666466 B · 20.5 ✗ | 30564 B · 16 ✗ | 2186 B · 0.952 | 1213665 B · 1.07 ✗ |
| jump, visually lossless | 706530 B · 49.9 ✗ | 697030 B · 36.3 ✗ | 666466 B · 20.5 | 697030 B · 36.3 ✗ | 6728356 B · 50.9 ✗ | 1213665 B · 1.07 |
| jump, exact | 1864663 B · 51.3 ✗ | 1848607 B · 37.7 ✗ | 1818043 B · 21.8 ✗ | 1910695 B · 37.4 ✗ | 6728356 B · 50.9 ✗ | 1213665 B · 1.07 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 10, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 44.25 · 44.28 dB, visually lossless 48.21 · 47.91 dB (quantizers [25, 8])

*Reported:* per frame, median over rounds: snr preview frame 1.81; snr VL frame 4.09; snr residual decode 1.13; snr add 0.293; two preview frame 1.84; two VL frame 2.47; two residual decode 1.09; two add 0.296

* **snr against svc: a trade** — snr dominates at every slice, visually lossless, jump, visually lossless, jump, exact; svc dominates at first picture, every slice, preview, jump, preview
* **snr against sep: worse** — snr dominates at no stage; sep dominates at first picture, every slice, preview, every slice, visually lossless, jump, preview, jump, visually lossless
* **snr against one: a trade** — snr dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: a trade** — two dominates at every slice, visually lossless, jump, visually lossless, jump, exact; svc dominates at first picture, every slice, preview, jump, preview
* **two against sep: neither dominates** — two dominates at no stage; sep dominates at no stage
* **two against one: a trade** — two dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at first picture, every slice, preview, every slice, visually lossless, every slice, exact, jump, preview, jump, visually lossless, jump, exact

## dbts_b1 · G 1 · visually lossless rung Q 4

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 64206 B · 1.13 ? | 49522 B · 1.74 ? | 939638 B · 2.22 ✗ | 49522 B · 1.74 ? | 2500 B · — | 2113277 B · 0.968 ? |
| every slice, preview | 3438012 B · 57.6 ? | 2642917 B · 92.2 ? | 47554367 B · 110 ✗ | 2642917 B · 92.2 ? | 153160 B · — | 107407602 B · 52.4 ? |
| every slice, visually lossless | 66655708 B · 252 ✗ | 50197284 B · 201 ✗ | 47554367 B · 110 | 50197284 B · 201 ✗ | 109732176 B · — ? | 107407602 B · 52.4 |
| every slice, exact | 130960916 B · 316 ✗ | 115704938 B · 265 ✗ | 113062021 B · 176 ✗ | 157604886 B · 252 ✗ | 109732176 B · — ? | 107407602 B · 52.4 |
| jump, preview | 69038 B · 1.07 ? | 53037 B · 1.81 ? | 951730 B · 2.26 ✗ | 53037 B · 1.81 ? | 3090 B · — | 2149534 B · 0.994 ✗ |
| jump, visually lossless | 1334074 B · 4.91 ✗ | 1004767 B · 4.27 ✗ | 951730 B · 2.26 | 1004767 B · 4.27 ✗ | 2196448 B · — ? | 2149534 B · 0.994 |
| jump, exact | 2620729 B · 6.1 ✗ | 2315875 B · 5.57 ✗ | 2262838 B · 3.58 ✗ | 3154301 B · 5.34 ✗ | 2196448 B · — ? | 2149534 B · 0.994 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 9, two 9, one 9, sep 9, svc 0, htj2k 9

*Reported:* in-window PSNR, aomenc · quality layers: preview 40.64 · 40.65 dB, visually lossless 54.64 · 54.93 dB (quantizers [25, 2])

*Reported:* per frame, median over rounds: snr preview frame 1.13; snr VL frame 3.74; snr residual decode 0.895; snr add 0.288; two preview frame 1.79; two VL frame 2.21; two residual decode 0.991; two add 0.289

* **snr against svc: not read** — snr dominates at no stage; svc dominates at no stage
* **snr against sep: worse** — snr dominates at no stage; sep dominates at every slice, visually lossless, jump, visually lossless
* **snr against one: a trade** — snr dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: not read** — two dominates at no stage; svc dominates at no stage
* **two against sep: neither dominates** — two dominates at no stage; sep dominates at no stage
* **two against one: a trade** — two dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact

## dbts_b1 · G 1 · visually lossless rung Q 8

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 64206 B · 1.25 ✗ | 49522 B · 1.88 ✗ | 467815 B · 1.64 ✗ | 49522 B · 1.88 ✗ | 2500 B · 0.107 | 2113277 B · 1.16 ✗ |
| every slice, preview | 3438012 B · 57.5 ✗ | 2642917 B · 94 ✗ | 23477229 B · 86.6 ✗ | 2642917 B · 94 ✗ | 153160 B · 5.31 | 107407602 B · 53.9 ✗ |
| every slice, visually lossless | 27889701 B · 208 ✗ | 26120146 B · 181 ✗ | 23477229 B · 86.6 | 26120146 B · 181 ✗ | 109732176 B · 241 ✗ | 107407602 B · 53.9 |
| every slice, exact | 117225020 B · 274 ✗ | 114756812 B · 249 ✗ | 112113895 B · 155 ✗ | 133527748 B · 235 ✗ | 109732176 B · 241 ✗ | 107407602 B · 53.9 |
| jump, preview | 69038 B · 1.23 ✗ | 53037 B · 1.83 ✗ | 469734 B · 1.9 ✗ | 53037 B · 1.83 ✗ | 3090 B · 0.117 | 2149534 B · 1.05 ✗ |
| jump, visually lossless | 558224 B · 4.28 ✗ | 522771 B · 3.71 ✗ | 469734 B · 1.9 | 522771 B · 3.71 ✗ | 2196448 B · 4.88 ✗ | 2149534 B · 1.05 |
| jump, exact | 2346058 B · 5.55 ✗ | 2296756 B · 5.04 ✗ | 2243718 B · 3.21 ✗ | 2672305 B · 4.76 ✗ | 2196448 B · 4.88 ✗ | 2149534 B · 1.05 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 9, two 9, one 9, sep 9, svc 9, htj2k 9

*Reported:* in-window PSNR, aomenc · quality layers: preview 40.64 · 40.65 dB, visually lossless 47.33 · 47.07 dB (quantizers [25, 7])

*Reported:* per frame, median over rounds: snr preview frame 1.09; snr VL frame 2.82; snr residual decode 0.948; snr add 0.295; two preview frame 1.76; two VL frame 1.61; two residual decode 1.08; two add 0.308

* **snr against svc: a trade** — snr dominates at every slice, visually lossless, jump, visually lossless; svc dominates at first picture, every slice, preview, every slice, exact, jump, preview, jump, exact
* **snr against sep: worse** — snr dominates at no stage; sep dominates at every slice, visually lossless, jump, visually lossless
* **snr against one: a trade** — snr dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: a trade** — two dominates at every slice, visually lossless, jump, visually lossless; svc dominates at first picture, every slice, preview, every slice, exact, jump, preview, jump, exact
* **two against sep: neither dominates** — two dominates at no stage; sep dominates at no stage
* **two against one: a trade** — two dominates at first picture, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact

## dbts_b1 · G 8 · visually lossless rung Q 4

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 64206 B · 0.995 ? | 49522 B · 1.8 ? | 939638 B · 2.09 ✗ | 49522 B · 1.8 ? | 2500 B · — | 2113277 B · 1.06 ✗ |
| every slice, preview | 2000037 B · 56.3 ? | 1673494 B · 68.3 ? | 46921123 B · 111 ✗ | 1673494 B · 68.3 ? | 41324 B · — | 107407602 B · 53.1 ✗ |
| every slice, visually lossless | 64595905 B · 244 ✗ | 48594617 B · 180 ✗ | 46921123 B · 111 | 48594617 B · 180 ✗ | 101537520 B · — ? | 107407602 B · 53.1 ? |
| every slice, exact | 127322694 B · 306 ✗ | 114562005 B · 246 ✗ | 112888511 B · 177 ✗ | 156002219 B · 233 ✗ | 101537520 B · — | 107407602 B · 53.1 ? |
| jump, preview | 190221 B · 4.75 ? | 156326 B · 6.25 ? | 4167994 B · 9.22 ✗ | 156326 B · 6.25 ? | 4746 B · — | 2149534 B · 1.03 ? |
| jump, visually lossless | 5745128 B · 20.2 ✗ | 4324320 B · 15.5 ✗ | 4167994 B · 9.22 ✗ | 4324320 B · 15.5 ✗ | 9079726 B · — ? | 2149534 B · 1.03 |
| jump, exact | 7000404 B · 21.5 ✗ | 5644595 B · 16.5 ✗ | 5488269 B · 10.3 ✗ | 6473854 B · 16.5 ✗ | 9079726 B · — ? | 2149534 B · 1.03 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 0, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 40.60 · 40.54 dB, visually lossless 54.51 · 55.38 dB (quantizers [25, 2])

*Reported:* per frame, median over rounds: snr preview frame 1.05; snr VL frame 3.64; snr residual decode 0.966; snr add 0.284; two preview frame 1.31; two VL frame 2.14; two residual decode 0.909; two add 0.284

* **snr against svc: not read** — snr dominates at no stage; svc dominates at no stage
* **snr against sep: worse** — snr dominates at no stage; sep dominates at every slice, visually lossless, jump, visually lossless, jump, exact
* **snr against one: a trade** — snr dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: not read** — two dominates at no stage; svc dominates at no stage
* **two against sep: neither dominates** — two dominates at no stage; sep dominates at no stage
* **two against one: a trade** — two dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact

## dbts_b1 · G 8 · visually lossless rung Q 8

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 64206 B · 1.07 ✗ | 49522 B · 1.9 ✗ | 467815 B · 1.6 ✗ | 49522 B · 1.9 ✗ | 2500 B · 0.105 | 2113277 B · 0.999 ✗ |
| every slice, preview | 1999273 B · 55.3 ✗ | 1673494 B · 72.5 ✗ | 23205924 B · 90.7 ✗ | 1673494 B · 72.5 ✗ | 41324 B · 3.15 | 107407602 B · 52.9 ✗ |
| every slice, visually lossless | 26226658 B · 204 ✗ | 24879418 B · 163 ✗ | 23205924 B · 90.7 | 24879418 B · 163 ✗ | 101537520 B · 195 ✗ | 107407602 B · 52.9 |
| every slice, exact | 115218354 B · 270 ✗ | 113140410 B · 228 ✗ | 111466916 B · 156 ✗ | 132287020 B · 216 ✗ | 101537520 B · 195 | 107407602 B · 52.9 |
| jump, preview | 190139 B · 4.95 ✗ | 156326 B · 7.22 ✗ | 2060591 B · 8.38 ✗ | 156326 B · 7.22 ✗ | 4746 B · 0.304 | 2149534 B · 1.03 ✗ |
| jump, visually lossless | 2338094 B · 17.6 ✗ | 2216917 B · 15.3 ✗ | 2060591 B · 8.38 | 2216917 B · 15.3 ✗ | 9079726 B · 17.1 ✗ | 2149534 B · 1.03 |
| jump, exact | 4119050 B · 19 ✗ | 3983350 B · 16.7 ✗ | 3827023 B · 9.72 ✗ | 4366451 B · 16.3 ✗ | 9079726 B · 17.1 ✗ | 2149534 B · 1.03 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 10, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 40.60 · 40.54 dB, visually lossless 47.43 · 47.15 dB (quantizers [25, 7])

*Reported:* per frame, median over rounds: snr preview frame 1.05; snr VL frame 2.84; snr residual decode 0.967; snr add 0.297; two preview frame 1.38; two VL frame 1.72; two residual decode 1.02; two add 0.296

* **snr against svc: a trade** — snr dominates at jump, visually lossless, jump, exact; svc dominates at first picture, every slice, preview, every slice, exact, jump, preview
* **snr against sep: worse** — snr dominates at no stage; sep dominates at every slice, visually lossless, jump, visually lossless
* **snr against one: a trade** — snr dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: a trade** — two dominates at every slice, visually lossless, jump, visually lossless, jump, exact; svc dominates at first picture, every slice, preview, every slice, exact, jump, preview
* **two against sep: neither dominates** — two dominates at no stage; sep dominates at no stage
* **two against one: a trade** — two dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact

## dbts_b1 · G 16 · visually lossless rung Q 4

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 64206 B · 1.24 ? | 49522 B · 1.76 ? | 939638 B · 2.2 ✗ | 49522 B · 1.76 ? | 2500 B · — | 2113277 B · 0.971 ✗ |
| every slice, preview | 1914571 B · 57.2 ? | 1625800 B · 71.8 ? | 46853126 B · 114 ✗ | 1625800 B · 71.8 ? | 34048 B · — | 107407602 B · 53.3 ✗ |
| every slice, visually lossless | 64474968 B · 251 ✗ | 48478926 B · 186 ✗ | 46853126 B · 114 | 48478926 B · 186 ✗ | 100956608 B · — ? | 107407602 B · 53.3 ? |
| every slice, exact | 127109056 B · 317 ✗ | 114516487 B · 253 ✗ | 112890687 B · 181 ✗ | 155886528 B · 240 ✗ | 100956608 B · — | 107407602 B · 53.3 ? |
| jump, preview | 332504 B · 10.7 ? | 279269 B · 13.4 ? | 7838489 B · 20.8 ✗ | 279269 B · 13.4 ? | 6738 B · — | 2149534 B · 1.05 ? |
| jump, visually lossless | 10789273 B · 46 ✗ | 8117757 B · 34.2 ✗ | 7838489 B · 20.8 ✗ | 8117757 B · 34.2 ✗ | 16940736 B · — ? | 2149534 B · 1.05 |
| jump, exact | 12042657 B · 47.2 ✗ | 9439464 B · 35.6 ✗ | 9160196 B · 22.2 ✗ | 10267291 B · 35.2 ✗ | 16940736 B · — ? | 2149534 B · 1.05 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 0, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 40.61 · 40.53 dB, visually lossless 54.50 · 55.41 dB (quantizers [25, 2])

*Reported:* per frame, median over rounds: snr preview frame 1.07; snr VL frame 3.81; snr residual decode 0.942; snr add 0.283; two preview frame 1.36; two VL frame 2.15; two residual decode 1.02; two add 0.287

* **snr against svc: not read** — snr dominates at no stage; svc dominates at no stage
* **snr against sep: worse** — snr dominates at no stage; sep dominates at every slice, visually lossless, jump, visually lossless, jump, exact
* **snr against one: a trade** — snr dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: not read** — two dominates at no stage; svc dominates at no stage
* **two against sep: neither dominates** — two dominates at no stage; sep dominates at no stage
* **two against one: a trade** — two dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact

## dbts_b1 · G 16 · visually lossless rung Q 8

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 64206 B · 1.08 ✗ | 49522 B · 1.79 ✗ | 467815 B · 1.59 ✗ | 49522 B · 1.79 ✗ | 2500 B · 0.117 | 2113277 B · 0.995 ✗ |
| every slice, preview | 1912987 B · 57.3 ✗ | 1625800 B · 67.8 ✗ | 23191007 B · 87.5 ✗ | 1625800 B · 67.8 ✗ | 34048 B · 3.24 | 107407602 B · 53.9 ✗ |
| every slice, visually lossless | 26138799 B · 202 ✗ | 24816807 B · 159 ✗ | 23191007 B · 87.5 | 24816807 B · 159 ✗ | 100956608 B · 187 ✗ | 107407602 B · 53.9 |
| every slice, exact | 115129225 B · 265 ✗ | 113073904 B · 222 ✗ | 111448104 B · 150 ✗ | 132224409 B · 212 ✗ | 100956608 B · 187 | 107407602 B · 53.9 |
| jump, preview | 332319 B · 11.3 ✗ | 279269 B · 14.1 ✗ | 3878955 B · 17.5 ✗ | 279269 B · 14.1 ✗ | 6738 B · 0.573 | 2149534 B · 1.03 ✗ |
| jump, visually lossless | 4377512 B · 39.2 ✗ | 4158224 B · 32 ✗ | 3878955 B · 17.5 ✗ | 4158224 B · 32 ✗ | 16940736 B · 36.1 ✗ | 2149534 B · 1.03 |
| jump, exact | 6158442 B · 40.5 ✗ | 5924577 B · 33.3 ✗ | 5645308 B · 18.8 ✗ | 6307758 B · 33 ✗ | 16940736 B · 36.1 ✗ | 2149534 B · 1.03 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 10, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 40.61 · 40.53 dB, visually lossless 47.43 · 47.16 dB (quantizers [25, 7])

*Reported:* per frame, median over rounds: snr preview frame 1.07; snr VL frame 2.84; snr residual decode 0.964; snr add 0.277; two preview frame 1.28; two VL frame 1.7; two residual decode 0.998; two add 0.317

* **snr against svc: a trade** — snr dominates at every slice, visually lossless; svc dominates at first picture, every slice, preview, every slice, exact, jump, preview
* **snr against sep: worse** — snr dominates at no stage; sep dominates at every slice, visually lossless, jump, visually lossless
* **snr against one: a trade** — snr dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: a trade** — two dominates at every slice, visually lossless, jump, visually lossless, jump, exact; svc dominates at first picture, every slice, preview, every slice, exact, jump, preview
* **two against sep: neither dominates** — two dominates at no stage; sep dominates at no stage
* **two against one: a trade** — two dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact

## dbts_c1 · G 1 · visually lossless rung Q 4

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 11470 B · 1.77 ✗ | 7884 B · 1.72 ? | 264686 B · 2.39 ✗ | 7884 B · 1.72 ? | 1162 B · — | 1094218 B · 1.03 ? |
| every slice, preview | 838862 B · 119 ✗ | 568606 B · 110 ? | 17498082 B · 162 ✗ | 568606 B · 110 ? | 80807 B · — | 70664924 B · 75.1 ? |
| every slice, visually lossless | 28082472 B · 447 ✗ | 18066688 B · 274 ✗ | 17498082 B · 162 | 18066688 B · 274 ✗ | 70700403 B · — ? | 70664924 B · 75.1 |
| every slice, exact | 82446160 B · 544 ✗ | 73729045 B · 371 ✗ | 73160439 B · 257 ✗ | 88731612 B · 348 ✗ | 70700403 B · — ? | 70664924 B · 75.1 |
| jump, preview | 12198 B · 1.85 ✗ | 8265 B · 1.81 ? | 254044 B · 2.39 ✗ | 8265 B · 1.81 ? | 1174 B · — | 1026553 B · 1.05 ? |
| jump, visually lossless | 407866 B · 6.72 ✗ | 262309 B · 4.18 ✗ | 254044 B · 2.39 | 262309 B · 4.18 ✗ | 1027067 B · — ? | 1026553 B · 1.05 |
| jump, exact | 1197688 B · 8.07 ✗ | 1071099 B · 5.51 ✗ | 1062834 B · 3.73 ✗ | 1288861 B · 5.28 ✗ | 1027067 B · — ? | 1026553 B · 1.05 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 0, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 43.28 · 43.25 dB, visually lossless 54.33 · 54.94 dB (quantizers [25, 2])

*Reported:* per frame, median over rounds: snr preview frame 1.54; snr VL frame 4.58; snr residual decode 1.05; snr add 0.303; two preview frame 1.45; two VL frame 2.25; two residual decode 1.09; two add 0.282

* **snr against svc: not read** — snr dominates at no stage; svc dominates at no stage
* **snr against sep: worse** — snr dominates at no stage; sep dominates at first picture, every slice, preview, every slice, visually lossless, jump, preview, jump, visually lossless
* **snr against one: a trade** — snr dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: not read** — two dominates at no stage; svc dominates at no stage
* **two against sep: neither dominates** — two dominates at no stage; sep dominates at no stage
* **two against one: a trade** — two dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at first picture, every slice, preview, every slice, visually lossless, every slice, exact, jump, preview, jump, visually lossless, jump, exact

## dbts_c1 · G 1 · visually lossless rung Q 8

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 11470 B · 2.01 ✗ | 7884 B · 2.16 ✗ | 95877 B · 2.05 ✗ | 7884 B · 2.16 ✗ | 1162 B · 0.347 | 1094218 B · 1.07 ✗ |
| every slice, preview | 838862 B · 138 ✗ | 568606 B · 132 ✗ | 6346125 B · 140 ✗ | 568606 B · 132 ✗ | 80807 B · 16.4 | 70664924 B · 75 ✗ |
| every slice, visually lossless | 8872050 B · 446 ✗ | 6914731 B · 274 ✗ | 6346125 B · 140 | 6914731 B · 274 ✗ | 70700403 B · 688 ✗ | 70664924 B · 75 |
| every slice, exact | 74198301 B · 553 ✗ | 72733632 B · 383 ✗ | 72165026 B · 248 ✗ | 77579655 B · 349 ✗ | 70700403 B · 688 ✗ | 70664924 B · 75 |
| jump, preview | 12198 B · 2.11 ✗ | 8265 B · 1.92 ✗ | 92130 B · 2.07 ✗ | 8265 B · 1.92 ✗ | 1174 B · 0.249 | 1026553 B · 1.11 ✗ |
| jump, visually lossless | 128815 B · 6.57 ✗ | 100395 B · 4.12 ✗ | 92130 B · 2.07 | 100395 B · 4.12 ✗ | 1027067 B · 10.5 ✗ | 1026553 B · 1.11 |
| jump, exact | 1077858 B · 8.07 ✗ | 1056604 B · 5.65 ✗ | 1048339 B · 3.63 ✗ | 1126948 B · 5.2 ✗ | 1027067 B · 10.5 ✗ | 1026553 B · 1.11 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 10, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 43.28 · 43.25 dB, visually lossless 47.95 · 48.33 dB (quantizers [25, 7])

*Reported:* per frame, median over rounds: snr preview frame 1.88; snr VL frame 4.11; snr residual decode 1.15; snr add 0.347; two preview frame 1.76; two VL frame 1.85; two residual decode 1.14; two add 0.349

* **snr against svc: a trade** — snr dominates at every slice, visually lossless, jump, visually lossless; svc dominates at first picture, every slice, preview, jump, preview
* **snr against sep: worse** — snr dominates at no stage; sep dominates at first picture, every slice, preview, every slice, visually lossless, jump, preview, jump, visually lossless
* **snr against one: a trade** — snr dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: a trade** — two dominates at every slice, visually lossless, jump, visually lossless; svc dominates at first picture, every slice, preview, jump, preview
* **two against sep: neither dominates** — two dominates at no stage; sep dominates at no stage
* **two against one: a trade** — two dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at first picture, every slice, preview, every slice, visually lossless, every slice, exact, jump, preview, jump, visually lossless, jump, exact

## dbts_c1 · G 8 · visually lossless rung Q 4

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 11470 B · 1.7 ✗ | 7884 B · 1.83 ? | 264686 B · 2.48 ✗ | 7884 B · 1.83 ? | 1162 B · — | 1094218 B · 1.03 ? |
| every slice, preview | 401477 B · 90.1 ✗ | 270816 B · 87.2 ? | 17487791 B · 167 ✗ | 270816 B · 87.2 ? | 23641 B · — | 70664924 B · 72.3 ✗ |
| every slice, visually lossless | 26908510 B · 385 ✗ | 17758607 B · 254 ✗ | 17487791 B · 167 | 17758607 B · 254 ✗ | 66404346 B · — ? | 70664924 B · 72.3 ? |
| every slice, exact | 81291194 B · 483 ✗ | 73605279 B · 363 ✗ | 73334463 B · 276 ✗ | 88423531 B · 326 ✗ | 66404346 B · — | 70664924 B · 72.3 ? |
| jump, preview | 28584 B · 5.66 ✗ | 19014 B · 5.11 ? | 1118983 B · 10.6 ✗ | 19014 B · 5.11 ? | 1934 B · — | 1026553 B · 1 ? |
| jump, visually lossless | 1731622 B · 23.9 ✗ | 1137998 B · 15.9 ✗ | 1118983 B · 10.6 ✗ | 1137998 B · 15.9 ✗ | 3310825 B · — ? | 1026553 B · 1 |
| jump, exact | 2521714 B · 25.3 ✗ | 1949439 B · 17.4 ✗ | 1930425 B · 12.1 ✗ | 2164550 B · 16.9 ✗ | 3310825 B · — ? | 1026553 B · 1 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 0, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 43.18 · 43.25 dB, visually lossless 54.28 · 54.95 dB (quantizers [25, 2])

*Reported:* per frame, median over rounds: snr preview frame 1.23; snr VL frame 4.12; snr residual decode 1.02; snr add 0.413; two preview frame 1.22; two VL frame 2.37; two residual decode 1.1; two add 0.385

* **snr against svc: not read** — snr dominates at no stage; svc dominates at no stage
* **snr against sep: worse** — snr dominates at no stage; sep dominates at first picture, every slice, preview, every slice, visually lossless, jump, preview, jump, visually lossless, jump, exact
* **snr against one: a trade** — snr dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: not read** — two dominates at no stage; svc dominates at no stage
* **two against sep: neither dominates** — two dominates at no stage; sep dominates at no stage
* **two against one: a trade** — two dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at first picture, every slice, preview, every slice, visually lossless, every slice, exact, jump, preview, jump, visually lossless, jump, exact

## dbts_c1 · G 8 · visually lossless rung Q 8

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 11470 B · 2.09 ✗ | 7884 B · 2 ✗ | 95877 B · 2.28 ✗ | 7884 B · 2 ✗ | 1162 B · 0.29 | 1094218 B · 1.44 ✗ |
| every slice, preview | 400064 B · 122 ✗ | 270816 B · 109 ✗ | 6236705 B · 161 ✗ | 270816 B · 109 ✗ | 23641 B · 6.74 | 70664924 B · 74.7 ✗ |
| every slice, visually lossless | 8029065 B · 398 ✗ | 6507521 B · 268 ✗ | 6236705 B · 161 | 6507521 B · 268 ✗ | 66404346 B · 583 ✗ | 70664924 B · 74.7 |
| every slice, exact | 73324673 B · 503 ✗ | 72158819 B · 377 ✗ | 71888003 B · 269 ✗ | 77172445 B · 342 ✗ | 66404346 B · 583 | 70664924 B · 74.7 |
| jump, preview | 28509 B · 7.34 ✗ | 19014 B · 6.98 ✗ | 399408 B · 10.1 ✗ | 19014 B · 6.98 ✗ | 1934 B · 0.496 | 1026553 B · 1.02 ✗ |
| jump, visually lossless | 518475 B · 25.4 ✗ | 418422 B · 17.2 ✗ | 399408 B · 10.1 | 418422 B · 17.2 ✗ | 3310825 B · 25.8 ✗ | 1026553 B · 1.02 |
| jump, exact | 1467080 B · 26.8 ✗ | 1372190 B · 18.7 ✗ | 1353176 B · 11.6 ✗ | 1444975 B · 18.2 ✗ | 3310825 B · 25.8 ✗ | 1026553 B · 1.02 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 10, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 43.18 · 43.25 dB, visually lossless 48.04 · 48.33 dB (quantizers [25, 7])

*Reported:* per frame, median over rounds: snr preview frame 1.62; snr VL frame 3.79; snr residual decode 1.07; snr add 0.348; two preview frame 1.5; two VL frame 2.23; two residual decode 1.13; two add 0.37

* **snr against svc: a trade** — snr dominates at every slice, visually lossless, jump, visually lossless, jump, exact; svc dominates at first picture, every slice, preview, jump, preview
* **snr against sep: worse** — snr dominates at no stage; sep dominates at first picture, every slice, preview, every slice, visually lossless, jump, preview, jump, visually lossless, jump, exact
* **snr against one: a trade** — snr dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: a trade** — two dominates at every slice, visually lossless, jump, visually lossless, jump, exact; svc dominates at first picture, every slice, preview, jump, preview
* **two against sep: neither dominates** — two dominates at no stage; sep dominates at no stage
* **two against one: a trade** — two dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at first picture, every slice, preview, every slice, visually lossless, every slice, exact, jump, preview, jump, visually lossless, jump, exact

## dbts_c1 · G 16 · visually lossless rung Q 4

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 10322 B · 1.55 ✗ | 7884 B · 1.62 ? | 264686 B · 2.56 ✗ | 7884 B · 1.62 ? | 1162 B · — | 1094218 B · 1.03 ? |
| every slice, preview | 333671 B · 82.4 ✗ | 257360 B · 78.4 ? | 17483081 B · 164 ✗ | 257360 B · 78.4 ? | 19737 B · — | 70664924 B · 71.7 ✗ |
| every slice, visually lossless | 26801786 B · 381 ✗ | 17740441 B · 242 ✗ | 17483081 B · 164 | 17740441 B · 242 ✗ | 66118979 B · — ? | 70664924 B · 71.7 ? |
| every slice, exact | 81209936 B · 481 ✗ | 73675262 B · 344 ✗ | 73417902 B · 269 ✗ | 88405365 B · 316 ✗ | 66118979 B · — | 70664924 B · 71.7 ? |
| jump, preview | 42425 B · 7.04 ✗ | 32255 B · 7.14 ? | 2089987 B · 14.2 ✗ | 32255 B · 7.14 ? | 2738 B · — | 1026553 B · 1.03 ? |
| jump, visually lossless | 3216703 B · 32.5 ✗ | 2122242 B · 21.2 ✗ | 2089987 B · 14.2 ✗ | 2122242 B · 21.2 ✗ | 5882841 B · — ? | 1026553 B · 1.03 |
| jump, exact | 4007163 B · 34 ✗ | 2934980 B · 22.6 ✗ | 2902725 B · 15.5 ✗ | 3148795 B · 22.1 ✗ | 5882841 B · — ? | 1026553 B · 1.03 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 0, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 43.18 · 43.11 dB, visually lossless 54.27 · 54.93 dB (quantizers [26, 2])

*Reported:* per frame, median over rounds: snr preview frame 1.14; snr VL frame 4.22; snr residual decode 0.966; snr add 0.376; two preview frame 1.14; two VL frame 2.31; two residual decode 1.13; two add 0.38

* **snr against svc: not read** — snr dominates at no stage; svc dominates at no stage
* **snr against sep: worse** — snr dominates at no stage; sep dominates at first picture, every slice, preview, every slice, visually lossless, jump, preview, jump, visually lossless, jump, exact
* **snr against one: a trade** — snr dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: not read** — two dominates at no stage; svc dominates at no stage
* **two against sep: neither dominates** — two dominates at no stage; sep dominates at no stage
* **two against one: a trade** — two dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at first picture, every slice, preview, every slice, visually lossless, every slice, exact, jump, preview, jump, visually lossless, jump, exact

## dbts_c1 · G 16 · visually lossless rung Q 8

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 11470 B · 2.46 ✗ | 7884 B · 2.23 ✗ | 95877 B · 1.94 ✗ | 7884 B · 2.23 ✗ | 1162 B · 0.326 | 1094218 B · 1.43 ✗ |
| every slice, preview | 374134 B · 108 ✗ | 257360 B · 99.8 ✗ | 6229812 B · 154 ✗ | 257360 B · 99.8 ✗ | 19737 B · 6.2 | 70664924 B · 75.5 ✗ |
| every slice, visually lossless | 7980697 B · 384 ✗ | 6487172 B · 254 ✗ | 6229812 B · 154 | 6487172 B · 254 ✗ | 66118979 B · 564 ✗ | 70664924 B · 75.5 |
| every slice, exact | 73300617 B · 487 ✗ | 72225283 B · 357 ✗ | 71967923 B · 256 ✗ | 77152096 B · 331 ✗ | 66118979 B · 564 | 70664924 B · 75.5 |
| jump, preview | 47470 B · 10.6 ✗ | 32255 B · 10.6 ✗ | 744037 B · 15.5 ✗ | 32255 B · 10.6 ✗ | 2738 B · 0.674 | 1026553 B · 1.15 ✗ |
| jump, visually lossless | 956922 B · 38.3 ✗ | 776292 B · 26 ✗ | 744037 B · 15.5 | 776292 B · 26 ✗ | 5882841 B · 36.1 ✗ | 1026553 B · 1.15 |
| jump, exact | 1905884 B · 39.7 ✗ | 1731324 B · 27.6 ✗ | 1699069 B · 17.1 ✗ | 1802845 B · 27.1 ✗ | 5882841 B · 36.1 ✗ | 1026553 B · 1.15 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 10, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 43.18 · 43.24 dB, visually lossless 48.04 · 48.33 dB (quantizers [25, 7])

*Reported:* per frame, median over rounds: snr preview frame 1.45; snr VL frame 3.71; snr residual decode 1.03; snr add 0.332; two preview frame 1.39; two VL frame 2.14; two residual decode 1.1; two add 0.353

* **snr against svc: a trade** — snr dominates at every slice, visually lossless, jump, visually lossless; svc dominates at first picture, every slice, preview, jump, preview
* **snr against sep: worse** — snr dominates at no stage; sep dominates at first picture, every slice, preview, every slice, visually lossless, jump, preview, jump, visually lossless, jump, exact
* **snr against one: a trade** — snr dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: a trade** — two dominates at every slice, visually lossless, jump, visually lossless, jump, exact; svc dominates at first picture, every slice, preview, jump, preview
* **two against sep: neither dominates** — two dominates at no stage; sep dominates at no stage
* **two against one: a trade** — two dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at first picture, every slice, preview, every slice, visually lossless, every slice, exact, jump, preview, jump, visually lossless, jump, exact

## The answer, per two-layer carrier, alternative, G and rung

| two-layer | against | G | VL rung | dbts_a1 | dbts_b1 | dbts_c1 | on these three volumes |
| --- | --- | --: | --: | --- | --- | --- | --- |
| snr | one | 1 | 4 | a trade | a trade | a trade | a trade |
| snr | one | 1 | 8 | a trade | a trade | a trade | a trade |
| snr | one | 8 | 4 | not read | a trade | a trade | differs |
| snr | one | 8 | 8 | a trade | a trade | a trade | a trade |
| snr | one | 16 | 4 | a trade | a trade | a trade | a trade |
| snr | one | 16 | 8 | a trade | a trade | a trade | a trade |
| snr | sep | 1 | 4 | worse | worse | worse | worse |
| snr | sep | 1 | 8 | worse | worse | worse | worse |
| snr | sep | 8 | 4 | not read | worse | worse | differs |
| snr | sep | 8 | 8 | worse | worse | worse | worse |
| snr | sep | 16 | 4 | worse | worse | worse | worse |
| snr | sep | 16 | 8 | worse | worse | worse | worse |
| snr | svc | 1 | 4 | not read | not read | not read | not read |
| snr | svc | 1 | 8 | a trade | a trade | a trade | a trade |
| snr | svc | 8 | 4 | not read | not read | not read | not read |
| snr | svc | 8 | 8 | a trade | a trade | a trade | a trade |
| snr | svc | 16 | 4 | not read | not read | not read | not read |
| snr | svc | 16 | 8 | a trade | a trade | a trade | a trade |
| snr | two | 1 | 4 | worse | worse | worse | worse |
| snr | two | 1 | 8 | worse | worse | worse | worse |
| snr | two | 8 | 4 | not read | worse | worse | differs |
| snr | two | 8 | 8 | worse | worse | worse | worse |
| snr | two | 16 | 4 | worse | worse | worse | worse |
| snr | two | 16 | 8 | worse | worse | worse | worse |
| two | one | 1 | 4 | a trade | a trade | a trade | a trade |
| two | one | 1 | 8 | a trade | a trade | a trade | a trade |
| two | one | 8 | 4 | not read | a trade | a trade | differs |
| two | one | 8 | 8 | a trade | a trade | a trade | a trade |
| two | one | 16 | 4 | a trade | a trade | a trade | a trade |
| two | one | 16 | 8 | a trade | a trade | a trade | a trade |
| two | sep | 1 | 4 | neither dominates | neither dominates | neither dominates | neither dominates |
| two | sep | 1 | 8 | neither dominates | neither dominates | neither dominates | neither dominates |
| two | sep | 8 | 4 | not read | neither dominates | neither dominates | differs |
| two | sep | 8 | 8 | neither dominates | neither dominates | neither dominates | neither dominates |
| two | sep | 16 | 4 | neither dominates | neither dominates | neither dominates | neither dominates |
| two | sep | 16 | 8 | neither dominates | neither dominates | neither dominates | neither dominates |
| two | svc | 1 | 4 | not read | not read | not read | not read |
| two | svc | 1 | 8 | a trade | a trade | a trade | a trade |
| two | svc | 8 | 4 | not read | not read | not read | not read |
| two | svc | 8 | 8 | a trade | a trade | a trade | a trade |
| two | svc | 16 | 4 | not read | not read | not read | not read |
| two | svc | 16 | 8 | a trade | a trade | a trade | a trade |
