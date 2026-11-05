## SNR preview, collected

rounds 10; VOID blocks 0

| volume · G · VL rung | A/A: median log (interval), n | A/A | arms flagged by order (p) |
| --- | --- | --- | --- |
| dbts_a1 · 1 · 4 | +0.0217 (-0.027, 0.3624), 10 | passes | — |
| dbts_a1 · 1 · 8 | +0.0266 (-0.2463, 0.2896), 10 | passes | — |
| dbts_a1 · 8 · 4 | -0.1313 (-0.271, 0.0572), 10 | passes | — |
| dbts_a1 · 8 · 8 | -0.0102 (-0.0923, 0.0708), 10 | passes | — |
| dbts_a1 · 16 · 4 | -0.0131 (-0.0836, 0.019), 10 | passes | — |
| dbts_a1 · 16 · 8 | +0.0615 (-0.0754, 0.2671), 10 | passes | — |
| dbts_b1 · 1 · 4 | +0.0091 (-0.0513, 0.0206), 10 | passes | — |
| dbts_b1 · 1 · 8 | +0.0147 (-0.1728, 0.1165), 10 | passes | — |
| dbts_b1 · 8 · 4 | +0.0379 (-0.0859, 0.2205), 10 | passes | — |
| dbts_b1 · 8 · 8 | -0.0128 (-0.1122, 0.0577), 10 | passes | — |
| dbts_b1 · 16 · 4 | +0.0283 (-0.2127, 0.2078), 10 | passes | — |
| dbts_b1 · 16 · 8 | +0.0324 (-0.0641, 0.1248), 10 | passes | — |
| dbts_c1 · 1 · 4 | +0.0124 (-0.0852, 0.1006), 10 | passes | — |
| dbts_c1 · 1 · 8 | -0.0466 (-0.2094, 0.0779), 10 | passes | — |
| dbts_c1 · 8 · 4 | -0.0021 (-0.1017, 0.0485), 10 | passes | — |
| dbts_c1 · 8 · 8 | +0.0070 (-0.0773, 0.0945), 10 | passes | — |
| dbts_c1 · 16 · 4 | +0.0347 (0.0117, 0.0979), 10 | fails: not read | — |
| dbts_c1 · 16 · 8 | +0.0034 (-0.4049, 0.0893), 10 | passes | — |

A/A decided (interval excludes 0) in 1 of 18 readable blocks

## dbts_a1 · G 1 · visually lossless rung Q 4

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 8842 B · 2.34 ✗ | 6161 B · 1.84 ? | 281178 B · 2.99 ✗ | 6161 B · 1.84 ? | 848 B · — | 1256607 B · 1.02 ? |
| every slice, preview | 669297 B · 104 ✗ | 432657 B · 90.3 ? | 15588376 B · 169 ✗ | 432657 B · 90.3 ? | 55223 B · — | 67812443 B · 60.3 ? |
| every slice, visually lossless | 20218772 B · 399 ✗ | 16021033 B · 263 ✗ | 15588376 B · 169 | 16021033 B · 263 ✗ | 66403640 B · — ? | 67812443 B · 60.3 ? |
| every slice, exact | 75956610 B · 476 ✗ | 70884030 B · 341 ✗ | 70451373 B · 246 ✗ | 83833476 B · 324 ✗ | 66403640 B · — | 67812443 B · 60.3 ? |
| jump, preview | 12031 B · 2.21 ✗ | 7770 B · 2.02 ? | 278887 B · 3.21 ✗ | 7770 B · 2.02 ? | 991 B · — | 1213665 B · 1.02 ? |
| jump, visually lossless | 361824 B · 7.95 ✗ | 286657 B · 5.24 ✗ | 278887 B · 3.21 | 286657 B · 5.24 ✗ | 1188563 B · — ? | 1213665 B · 1.02 ? |
| jump, exact | 1359417 B · 9.34 ✗ | 1268684 B · 6.72 ✗ | 1260914 B · 4.68 ✗ | 1500322 B · 6.27 ✗ | 1188563 B · — | 1213665 B · 1.02 ? |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 0, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 44.35 · 44.30 dB, visually lossless 54.28 · 53.71 dB (quantizers [25, 3])

*Reported:* per frame, median over rounds: snr preview frame 1.66; snr VL frame 5; snr residual decode 1.07; snr add 0.248; two preview frame 1.52; two VL frame 2.78; two residual decode 1.13; two add 0.255

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
| first picture | 8842 B · 2.58 ✗ | 6161 B · 2.28 ✗ | 84454 B · 2.15 ✗ | 6161 B · 2.28 ✗ | 848 B · 0.281 | 1256607 B · 1.15 ✗ |
| every slice, preview | 669297 B · 118 ✗ | 432657 B · 110 ✗ | 4655594 B · 114 ✗ | 432657 B · 110 ✗ | 55223 B · 13.7 | 67812443 B · 58.2 ✗ |
| every slice, visually lossless | 5584289 B · 366 ✗ | 5088251 B · 228 ✗ | 4655594 B · 114 | 5088251 B · 228 ✗ | 66403640 B · 602 ✗ | 67812443 B · 58.2 |
| every slice, exact | 70307203 B · 444 ✗ | 69519738 B · 309 ✗ | 69087081 B · 192 ✗ | 72900694 B · 290 ✗ | 66403640 B · 602 | 67812443 B · 58.2 |
| jump, preview | 12031 B · 2.2 ✗ | 7770 B · 1.98 ✗ | 83341 B · 2.05 ✗ | 7770 B · 1.98 ✗ | 991 B · 0.23 | 1213665 B · 1.05 ✗ |
| jump, visually lossless | 99972 B · 7.23 ✗ | 91112 B · 4.01 ✗ | 83341 B · 2.05 | 91112 B · 4.01 ✗ | 1188563 B · 11.2 ✗ | 1213665 B · 1.05 |
| jump, exact | 1258331 B · 8.93 ✗ | 1244268 B · 5.36 ✗ | 1236498 B · 3.38 ✗ | 1304777 B · 5.03 ✗ | 1188563 B · 11.2 | 1213665 B · 1.05 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 10, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 44.35 · 44.30 dB, visually lossless 48.08 · 47.89 dB (quantizers [25, 8])

*Reported:* per frame, median over rounds: snr preview frame 1.94; snr VL frame 4.1; snr residual decode 1.23; snr add 0.34; two preview frame 1.78; two VL frame 1.91; two residual decode 1.01; two add 0.283

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
| first picture | 8842 B · 1.59 ✗ | 6161 B · 1.77 ? | 281178 B · 2.62 ✗ | 6161 B · 1.77 ? | 848 B · — | 1256607 B · 0.985 ? |
| every slice, preview | 310476 B · 78.3 ✗ | 209754 B · 79.7 ? | 15681641 B · 157 ✗ | 209754 B · 79.7 ? | 15062 B · — | 67812443 B · 59.1 ? |
| every slice, visually lossless | 19259300 B · 354 ✗ | 15891395 B · 236 ✗ | 15681641 B · 157 | 15891395 B · 236 ✗ | 63882051 B · — ? | 67812443 B · 59.1 ? |
| every slice, exact | 75077895 B · 427 ✗ | 70870038 B · 306 ✗ | 70660284 B · 226 ✗ | 83703838 B · 297 ✗ | 63882051 B · — | 67812443 B · 59.1 ? |
| jump, preview | 27809 B · 8.31 ✗ | 18410 B · 8.99 ? | 1248060 B · 16.2 ✗ | 18410 B · 8.99 ? | 1581 B · — | 1213665 B · 1.02 ? |
| jump, visually lossless | 1542411 B · 34.1 ✗ | 1266470 B · 25.2 ✗ | 1248060 B · 16.2 ✗ | 1266470 B · 25.2 ✗ | 3911401 B · — ? | 1213665 B · 1.02 |
| jump, exact | 2541411 B · 35.6 ✗ | 2250509 B · 26.6 ✗ | 2232099 B · 17.6 ✗ | 2480135 B · 26.3 ✗ | 3911401 B · — ? | 1213665 B · 1.02 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 0, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 44.26 · 44.28 dB, visually lossless 54.24 · 53.65 dB (quantizers [25, 3])

*Reported:* per frame, median over rounds: snr preview frame 1.32; snr VL frame 4.69; snr residual decode 1.02; snr add 0.23; two preview frame 1.39; two VL frame 2.66; two residual decode 1.03; two add 0.251

* **snr against svc: not read** — snr dominates at no stage; svc dominates at no stage
* **snr against sep: worse** — snr dominates at no stage; sep dominates at first picture, every slice, preview, every slice, visually lossless, jump, preview, jump, visually lossless, jump, exact
* **snr against one: a trade** — snr dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: not read** — two dominates at no stage; svc dominates at no stage
* **two against sep: better** — two dominates at jump, exact; sep dominates at no stage
* **two against one: a trade** — two dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at first picture, every slice, preview, every slice, visually lossless, every slice, exact, jump, preview, jump, visually lossless, jump, exact

## dbts_a1 · G 8 · visually lossless rung Q 8

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 8842 B · 2.48 ✗ | 6161 B · 2.03 ✗ | 84454 B · 2.1 ✗ | 6161 B · 2.03 ✗ | 848 B · 0.289 | 1256607 B · 1.27 ✗ |
| every slice, preview | 309829 B · 101 ✗ | 209754 B · 115 ✗ | 4639708 B · 155 ✗ | 209754 B · 115 ✗ | 15062 B · 6.16 | 67812443 B · 62 ✗ |
| every slice, visually lossless | 4928175 B · 341 ✗ | 4849462 B · 274 ✗ | 4639708 B · 155 | 4849462 B · 274 ✗ | 63882051 B · 543 ✗ | 67812443 B · 62 |
| every slice, exact | 69623222 B · 420 ✗ | 69167785 B · 361 ✗ | 68958031 B · 241 ✗ | 72661905 B · 337 ✗ | 63882051 B · 543 | 67812443 B · 62 |
| jump, preview | 27742 B · 9.92 ✗ | 18410 B · 10.5 ✗ | 369734 B · 13.9 ✗ | 18410 B · 10.5 ✗ | 1581 B · 0.648 | 1213665 B · 0.996 ✗ |
| jump, visually lossless | 397671 B · 34.9 ✗ | 388144 B · 24 ✗ | 369734 B · 13.9 | 388144 B · 24 ✗ | 3911401 B · 38.9 ✗ | 1213665 B · 0.996 |
| jump, exact | 1555527 B · 36.5 ✗ | 1539246 B · 25.6 ✗ | 1520836 B · 15.4 ✗ | 1601810 B · 25.3 ✗ | 3911401 B · 38.9 ✗ | 1213665 B · 0.996 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 10, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 44.26 · 44.28 dB, visually lossless 48.20 · 47.91 dB (quantizers [25, 8])

*Reported:* per frame, median over rounds: snr preview frame 1.68; snr VL frame 4.03; snr residual decode 1.14; snr add 0.314; two preview frame 1.88; two VL frame 2.55; two residual decode 1.15; two add 0.305

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
| first picture | 8842 B · 1.64 ✗ | 6161 B · 2.09 ? | 281178 B · 2.77 ✗ | 6161 B · 2.09 ? | 848 B · — | 1256607 B · 1.01 ? |
| every slice, preview | 290864 B · 79.2 ✗ | 199087 B · 83.4 ? | 15685772 B · 174 ✗ | 199087 B · 83.4 ? | 12520 B · — | 67812443 B · 59.1 ? |
| every slice, visually lossless | 19203236 B · 365 ✗ | 15884859 B · 262 ✗ | 15685772 B · 174 | 15884859 B · 262 ✗ | 63715646 B · — ? | 67812443 B · 59.1 ? |
| every slice, exact | 75021387 B · 440 ✗ | 70890324 B · 338 ✗ | 70691237 B · 250 ✗ | 83697302 B · 323 ✗ | 63715646 B · — | 67812443 B · 59.1 ? |
| jump, preview | 45173 B · 12.5 ✗ | 30564 B · 11.9 ? | 2246009 B · 24.5 ✗ | 30564 B · 11.9 ? | 2186 B · — | 1213665 B · 0.969 ? |
| jump, visually lossless | 2759780 B · 49.7 ✗ | 2276574 B · 36.8 ✗ | 2246009 B · 24.5 ✗ | 2276574 B · 36.8 ✗ | 6728356 B · — ? | 1213665 B · 0.969 |
| jump, exact | 3758771 B · 51.2 ✗ | 3261111 B · 38.6 ✗ | 3230547 B · 25.8 ✗ | 3490239 B · 37.7 ✗ | 6728356 B · — ? | 1213665 B · 0.969 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 0, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 44.25 · 44.28 dB, visually lossless 54.23 · 53.64 dB (quantizers [25, 3])

*Reported:* per frame, median over rounds: snr preview frame 1.35; snr VL frame 4.79; snr residual decode 1.13; snr add 0.26; two preview frame 1.46; two VL frame 2.9; two residual decode 1; two add 0.228

* **snr against svc: not read** — snr dominates at no stage; svc dominates at no stage
* **snr against sep: worse** — snr dominates at no stage; sep dominates at first picture, every slice, preview, every slice, visually lossless, jump, preview, jump, visually lossless, jump, exact
* **snr against one: a trade** — snr dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: not read** — two dominates at no stage; svc dominates at no stage
* **two against sep: neither dominates** — two dominates at no stage; sep dominates at no stage
* **two against one: a trade** — two dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at first picture, every slice, preview, every slice, visually lossless, every slice, exact, jump, preview, jump, visually lossless, jump, exact

## dbts_a1 · G 16 · visually lossless rung Q 8

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 8842 B · 2.07 ✗ | 6161 B · 2.72 ✗ | 84454 B · 2.08 ✗ | 6161 B · 2.72 ✗ | 848 B · 0.231 | 1256607 B · 1.12 ✗ |
| every slice, preview | 290430 B · 103 ✗ | 199087 B · 106 ✗ | 4640590 B · 147 ✗ | 199087 B · 106 ✗ | 12520 B · 4.9 | 67812443 B · 61.7 ✗ |
| every slice, visually lossless | 4895364 B · 345 ✗ | 4839677 B · 253 ✗ | 4640590 B · 147 | 4839677 B · 253 ✗ | 63715646 B · 567 ✗ | 67812443 B · 61.7 |
| every slice, exact | 69605633 B · 426 ✗ | 69184169 B · 334 ✗ | 68985082 B · 228 ✗ | 72652120 B · 315 ✗ | 63715646 B · 567 | 67812443 B · 61.7 |
| jump, preview | 45113 B · 13.6 ✗ | 30564 B · 13.9 ✗ | 666466 B · 20.8 ✗ | 30564 B · 13.9 ✗ | 2186 B · 0.857 | 1213665 B · 1.08 ✗ |
| jump, visually lossless | 706530 B · 48 ✗ | 697030 B · 34.7 ✗ | 666466 B · 20.8 | 697030 B · 34.7 ✗ | 6728356 B · 48.8 ✗ | 1213665 B · 1.08 |
| jump, exact | 1864663 B · 49.9 ✗ | 1848607 B · 36.4 ✗ | 1818043 B · 22.5 ✗ | 1910695 B · 35.8 ✗ | 6728356 B · 48.8 ✗ | 1213665 B · 1.08 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 10, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 44.25 · 44.28 dB, visually lossless 48.21 · 47.91 dB (quantizers [25, 8])

*Reported:* per frame, median over rounds: snr preview frame 1.71; snr VL frame 4.15; snr residual decode 1.2; snr add 0.334; two preview frame 1.84; two VL frame 2.49; two residual decode 1.11; two add 0.296

* **snr against svc: a trade** — snr dominates at every slice, visually lossless, jump, visually lossless, jump, exact; svc dominates at first picture, every slice, preview, jump, preview
* **snr against sep: worse** — snr dominates at no stage; sep dominates at first picture, every slice, preview, every slice, visually lossless, jump, visually lossless
* **snr against one: a trade** — snr dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: a trade** — two dominates at every slice, visually lossless, jump, visually lossless, jump, exact; svc dominates at first picture, every slice, preview, jump, preview
* **two against sep: neither dominates** — two dominates at no stage; sep dominates at no stage
* **two against one: a trade** — two dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at first picture, every slice, preview, every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact

## dbts_b1 · G 1 · visually lossless rung Q 4

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 64206 B · 1.19 ? | 49522 B · 1.7 ? | 939638 B · 2.09 ✗ | 49522 B · 1.7 ? | 2500 B · — | 2113277 B · 0.964 ✗ |
| every slice, preview | 3438012 B · 59.5 ? | 2642917 B · 93.7 ? | 47554367 B · 110 ✗ | 2642917 B · 93.7 ? | 153160 B · — | 107407602 B · 53.6 ? |
| every slice, visually lossless | 66655708 B · 257 ✗ | 50197284 B · 205 ✗ | 47554367 B · 110 | 50197284 B · 205 ✗ | 109732176 B · — ? | 107407602 B · 53.6 |
| every slice, exact | 130960916 B · 325 ✗ | 115704938 B · 271 ✗ | 113062021 B · 176 ✗ | 157604886 B · 260 ✗ | 109732176 B · — ? | 107407602 B · 53.6 |
| jump, preview | 69038 B · 1.27 ? | 53037 B · 2.06 ? | 951730 B · 2.27 ✗ | 53037 B · 2.06 ? | 3090 B · — | 2149534 B · 1.04 ✗ |
| jump, visually lossless | 1334074 B · 5.31 ✗ | 1004767 B · 4.37 ✗ | 951730 B · 2.27 | 1004767 B · 4.37 ✗ | 2196448 B · — ? | 2149534 B · 1.04 |
| jump, exact | 2620729 B · 6.7 ✗ | 2315875 B · 5.62 ✗ | 2262838 B · 3.61 ✗ | 3154301 B · 5.48 ✗ | 2196448 B · — ? | 2149534 B · 1.04 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 0, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 40.64 · 40.65 dB, visually lossless 54.64 · 54.93 dB (quantizers [25, 2])

*Reported:* per frame, median over rounds: snr preview frame 1.09; snr VL frame 3.74; snr residual decode 1; snr add 0.313; two preview frame 1.75; two VL frame 2.1; two residual decode 0.976; two add 0.3

* **snr against svc: not read** — snr dominates at no stage; svc dominates at no stage
* **snr against sep: worse** — snr dominates at no stage; sep dominates at every slice, visually lossless, jump, visually lossless
* **snr against one: a trade** — snr dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: not read** — two dominates at no stage; svc dominates at no stage
* **two against sep: better** — two dominates at jump, exact; sep dominates at no stage
* **two against one: a trade** — two dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact

## dbts_b1 · G 1 · visually lossless rung Q 8

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 64206 B · 1.1 ✗ | 49522 B · 1.75 ✗ | 467815 B · 1.58 ✗ | 49522 B · 1.75 ✗ | 2500 B · 0.105 | 2113277 B · 0.969 ✗ |
| every slice, preview | 3438012 B · 57.6 ✗ | 2642917 B · 91.7 ✗ | 23477229 B · 81.9 ✗ | 2642917 B · 91.7 ✗ | 153160 B · 4.75 | 107407602 B · 53.5 ✗ |
| every slice, visually lossless | 27889701 B · 205 ✗ | 26120146 B · 170 ✗ | 23477229 B · 81.9 | 26120146 B · 170 ✗ | 109732176 B · 238 ✗ | 107407602 B · 53.5 |
| every slice, exact | 117225020 B · 270 ✗ | 114756812 B · 232 ✗ | 112113895 B · 146 ✗ | 133527748 B · 222 ✗ | 109732176 B · 238 ✗ | 107407602 B · 53.5 |
| jump, preview | 69038 B · 1.19 ✗ | 53037 B · 1.79 ✗ | 469734 B · 1.76 ✗ | 53037 B · 1.79 ✗ | 3090 B · 0.116 | 2149534 B · 1.05 ✗ |
| jump, visually lossless | 558224 B · 4.48 ✗ | 522771 B · 3.57 ✗ | 469734 B · 1.76 | 522771 B · 3.57 ✗ | 2196448 B · 4.67 ✗ | 2149534 B · 1.05 |
| jump, exact | 2346058 B · 5.79 ✗ | 2296756 B · 4.93 ✗ | 2243718 B · 3.09 ✗ | 2672305 B · 4.72 ✗ | 2196448 B · 4.67 ✗ | 2149534 B · 1.05 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 10, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 40.64 · 40.65 dB, visually lossless 47.33 · 47.07 dB (quantizers [25, 7])

*Reported:* per frame, median over rounds: snr preview frame 1.03; snr VL frame 2.73; snr residual decode 0.979; snr add 0.277; two preview frame 1.66; two VL frame 1.51; two residual decode 0.992; two add 0.29

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
| first picture | 64206 B · 1.13 ? | 49522 B · 1.9 ? | 939638 B · 2.33 ✗ | 49522 B · 1.9 ? | 2500 B · — | 2113277 B · 1.04 ✗ |
| every slice, preview | 2000037 B · 57.6 ? | 1673494 B · 74.5 ? | 46921123 B · 114 ✗ | 1673494 B · 74.5 ? | 41324 B · — | 107407602 B · 54.1 ? |
| every slice, visually lossless | 64595905 B · 263 ✗ | 48594617 B · 191 ✗ | 46921123 B · 114 | 48594617 B · 191 ✗ | 101537520 B · — ? | 107407602 B · 54.1 ? |
| every slice, exact | 127322694 B · 332 ✗ | 114562005 B · 261 ✗ | 112888511 B · 182 ✗ | 156002219 B · 245 ✗ | 101537520 B · — | 107407602 B · 54.1 ? |
| jump, preview | 190221 B · 3.46 ? | 156326 B · 5.08 ? | 4167994 B · 6.79 ✗ | 156326 B · 5.08 ? | 4746 B · — | 2149534 B · 1.07 ? |
| jump, visually lossless | 5745128 B · 14.6 ✗ | 4324320 B · 11.7 ✗ | 4167994 B · 6.79 ✗ | 4324320 B · 11.7 ✗ | 9079726 B · — ? | 2149534 B · 1.07 |
| jump, exact | 7000404 B · 15.7 ✗ | 5644595 B · 13.2 ✗ | 5488269 B · 8.23 ✗ | 6473854 B · 12.8 ✗ | 9079726 B · — ? | 2149534 B · 1.07 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 0, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 40.60 · 40.54 dB, visually lossless 54.51 · 55.38 dB (quantizers [25, 2])

*Reported:* per frame, median over rounds: snr preview frame 1.07; snr VL frame 3.85; snr residual decode 1.01; snr add 0.299; two preview frame 1.37; two VL frame 2.2; two residual decode 1.02; two add 0.292

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
| first picture | 64206 B · 1.03 ✗ | 49522 B · 1.76 ✗ | 467815 B · 1.7 ✗ | 49522 B · 1.76 ✗ | 2500 B · 0.105 | 2113277 B · 0.994 ✗ |
| every slice, preview | 1999273 B · 57.9 ✗ | 1673494 B · 76.6 ✗ | 23205924 B · 95.7 ✗ | 1673494 B · 76.6 ✗ | 41324 B · 3.15 | 107407602 B · 54.2 ✗ |
| every slice, visually lossless | 26226658 B · 222 ✗ | 24879418 B · 172 ✗ | 23205924 B · 95.7 | 24879418 B · 172 ✗ | 101537520 B · 192 ✗ | 107407602 B · 54.2 |
| every slice, exact | 115218354 B · 291 ✗ | 113140410 B · 242 ✗ | 111466916 B · 166 ✗ | 132287020 B · 227 ✗ | 101537520 B · 192 | 107407602 B · 54.2 |
| jump, preview | 190139 B · 3.93 ✗ | 156326 B · 5.1 ✗ | 2060591 B · 6.09 ✗ | 156326 B · 5.1 ✗ | 4746 B · 0.235 | 2149534 B · 1.04 ✗ |
| jump, visually lossless | 2338094 B · 13.6 ✗ | 2216917 B · 11.2 ✗ | 2060591 B · 6.09 | 2216917 B · 11.2 ✗ | 9079726 B · 12.8 ✗ | 2149534 B · 1.04 |
| jump, exact | 4119050 B · 15 ✗ | 3983350 B · 12.6 ✗ | 3827023 B · 7.52 ✗ | 4366451 B · 12.2 ✗ | 9079726 B · 12.8 ✗ | 2149534 B · 1.04 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 10, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 40.60 · 40.54 dB, visually lossless 47.43 · 47.15 dB (quantizers [25, 7])

*Reported:* per frame, median over rounds: snr preview frame 1.09; snr VL frame 3.07; snr residual decode 1.02; snr add 0.304; two preview frame 1.39; two VL frame 1.78; two residual decode 1.04; two add 0.317

* **snr against svc: a trade** — snr dominates at jump, visually lossless; svc dominates at first picture, every slice, preview, every slice, exact, jump, preview
* **snr against sep: worse** — snr dominates at no stage; sep dominates at every slice, visually lossless, jump, visually lossless
* **snr against one: a trade** — snr dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: a trade** — two dominates at every slice, visually lossless, jump, visually lossless, jump, exact; svc dominates at first picture, every slice, preview, every slice, exact, jump, preview
* **two against sep: neither dominates** — two dominates at no stage; sep dominates at no stage
* **two against one: a trade** — two dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact

## dbts_b1 · G 16 · visually lossless rung Q 4

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 64206 B · 1.08 ? | 49522 B · 2.05 ? | 939638 B · 2.04 ✗ | 49522 B · 2.05 ? | 2500 B · — | 2113277 B · 1.02 ? |
| every slice, preview | 1914571 B · 56 ? | 1625800 B · 69.8 ? | 46853126 B · 112 ✗ | 1625800 B · 69.8 ? | 34048 B · — | 107407602 B · 53.3 ✗ |
| every slice, visually lossless | 64474968 B · 257 ✗ | 48478926 B · 181 ✗ | 46853126 B · 112 | 48478926 B · 181 ✗ | 100956608 B · — ? | 107407602 B · 53.3 ? |
| every slice, exact | 127109056 B · 325 ✗ | 114516487 B · 248 ✗ | 112890687 B · 178 ✗ | 155886528 B · 234 ✗ | 100956608 B · — | 107407602 B · 53.3 ? |
| jump, preview | 332504 B · 8.21 ? | 279269 B · 10.6 ? | 7838489 B · 15.3 ✗ | 279269 B · 10.6 ? | 6738 B · — | 2149534 B · 1.08 ? |
| jump, visually lossless | 10789273 B · 34.3 ✗ | 8117757 B · 25.8 ✗ | 7838489 B · 15.3 ✗ | 8117757 B · 25.8 ✗ | 16940736 B · — ? | 2149534 B · 1.08 |
| jump, exact | 12042657 B · 35.5 ✗ | 9439464 B · 27.2 ✗ | 9160196 B · 16.6 ✗ | 10267291 B · 27 ✗ | 16940736 B · — ? | 2149534 B · 1.08 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 0, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 40.61 · 40.53 dB, visually lossless 54.50 · 55.41 dB (quantizers [25, 2])

*Reported:* per frame, median over rounds: snr preview frame 1.04; snr VL frame 3.81; snr residual decode 0.954; snr add 0.286; two preview frame 1.3; two VL frame 2.16; two residual decode 0.917; two add 0.304

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
| first picture | 64206 B · 1.3 ✗ | 49522 B · 2.21 ✗ | 467815 B · 1.72 ✗ | 49522 B · 2.21 ✗ | 2500 B · 0.105 | 2113277 B · 1.02 ✗ |
| every slice, preview | 1912987 B · 57.9 ✗ | 1625800 B · 71.7 ✗ | 23191007 B · 92.4 ✗ | 1625800 B · 71.7 ✗ | 34048 B · 3.09 | 107407602 B · 53.6 ✗ |
| every slice, visually lossless | 26138799 B · 215 ✗ | 24816807 B · 163 ✗ | 23191007 B · 92.4 | 24816807 B · 163 ✗ | 100956608 B · 194 ✗ | 107407602 B · 53.6 |
| every slice, exact | 115129225 B · 284 ✗ | 113073904 B · 229 ✗ | 111448104 B · 159 ✗ | 132224409 B · 217 ✗ | 100956608 B · 194 | 107407602 B · 53.6 |
| jump, preview | 332319 B · 8.58 ✗ | 279269 B · 10.3 ✗ | 3878955 B · 13.1 ✗ | 279269 B · 10.3 ✗ | 6738 B · 0.476 | 2149534 B · 1.04 ✗ |
| jump, visually lossless | 4377512 B · 30.1 ✗ | 4158224 B · 23.4 ✗ | 3878955 B · 13.1 ✗ | 4158224 B · 23.4 ✗ | 16940736 B · 26.5 ✗ | 2149534 B · 1.04 |
| jump, exact | 6158442 B · 31.3 ✗ | 5924577 B · 24.7 ✗ | 5645308 B · 14.4 ✗ | 6307758 B · 24.5 ✗ | 16940736 B · 26.5 ✗ | 2149534 B · 1.04 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 10, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 40.61 · 40.53 dB, visually lossless 47.43 · 47.16 dB (quantizers [25, 7])

*Reported:* per frame, median over rounds: snr preview frame 1.1; snr VL frame 2.94; snr residual decode 0.962; snr add 0.283; two preview frame 1.33; two VL frame 1.76; two residual decode 0.989; two add 0.326

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
| first picture | 11470 B · 1.74 ✗ | 7884 B · 1.72 ? | 264686 B · 2.69 ✗ | 7884 B · 1.72 ? | 1162 B · — | 1094218 B · 1.07 ? |
| every slice, preview | 838862 B · 114 ✗ | 568606 B · 109 ? | 17498082 B · 157 ✗ | 568606 B · 109 ? | 80807 B · — | 70664924 B · 76.9 ? |
| every slice, visually lossless | 28082472 B · 435 ✗ | 18066688 B · 268 ✗ | 17498082 B · 157 | 18066688 B · 268 ✗ | 70700403 B · — ? | 70664924 B · 76.9 |
| every slice, exact | 82446160 B · 532 ✗ | 73729045 B · 361 ✗ | 73160439 B · 250 ✗ | 88731612 B · 343 ✗ | 70700403 B · — ? | 70664924 B · 76.9 |
| jump, preview | 12198 B · 1.81 ✗ | 8265 B · 1.75 ? | 254044 B · 2.4 ✗ | 8265 B · 1.75 ? | 1174 B · — | 1026553 B · 1.05 ? |
| jump, visually lossless | 407866 B · 6.79 ✗ | 262309 B · 4.18 ✗ | 254044 B · 2.4 | 262309 B · 4.18 ✗ | 1027067 B · — ? | 1026553 B · 1.05 |
| jump, exact | 1197688 B · 8.14 ✗ | 1071099 B · 5.63 ✗ | 1062834 B · 3.84 ✗ | 1288861 B · 5.26 ✗ | 1027067 B · — ? | 1026553 B · 1.05 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 0, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 43.28 · 43.25 dB, visually lossless 54.33 · 54.94 dB (quantizers [25, 2])

*Reported:* per frame, median over rounds: snr preview frame 1.49; snr VL frame 4.43; snr residual decode 1.04; snr add 0.283; two preview frame 1.43; two VL frame 2.18; two residual decode 1.09; two add 0.303

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
| first picture | 11470 B · 2.02 ✗ | 7884 B · 2.11 ✗ | 95877 B · 2.11 ✗ | 7884 B · 2.11 ✗ | 1162 B · 0.238 | 1094218 B · 1.06 ✗ |
| every slice, preview | 838862 B · 144 ✗ | 568606 B · 124 ✗ | 6346125 B · 132 ✗ | 568606 B · 124 ✗ | 80807 B · 15.2 | 70664924 B · 73.1 ✗ |
| every slice, visually lossless | 8872050 B · 428 ✗ | 6914731 B · 259 ✗ | 6346125 B · 132 | 6914731 B · 259 ✗ | 70700403 B · 633 ✗ | 70664924 B · 73.1 |
| every slice, exact | 74198301 B · 529 ✗ | 72733632 B · 360 ✗ | 72165026 B · 233 ✗ | 77579655 B · 332 ✗ | 70700403 B · 633 ✗ | 70664924 B · 73.1 |
| jump, preview | 12198 B · 2.34 ✗ | 8265 B · 2.21 ✗ | 92130 B · 2.21 ✗ | 8265 B · 2.21 ✗ | 1174 B · 0.257 | 1026553 B · 1.04 ✗ |
| jump, visually lossless | 128815 B · 7.07 ✗ | 100395 B · 4.37 ✗ | 92130 B · 2.21 | 100395 B · 4.37 ✗ | 1027067 B · 9.86 ✗ | 1026553 B · 1.04 |
| jump, exact | 1077858 B · 8.67 ✗ | 1056604 B · 5.92 ✗ | 1048339 B · 3.78 ✗ | 1126948 B · 5.45 ✗ | 1027067 B · 9.86 ✗ | 1026553 B · 1.04 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 10, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 43.28 · 43.25 dB, visually lossless 47.95 · 48.33 dB (quantizers [25, 7])

*Reported:* per frame, median over rounds: snr preview frame 1.85; snr VL frame 3.95; snr residual decode 1.1; snr add 0.347; two preview frame 1.64; two VL frame 1.81; two residual decode 1.12; two add 0.368

* **snr against svc: a trade** — snr dominates at every slice, visually lossless, jump, visually lossless; svc dominates at first picture, every slice, preview, jump, preview
* **snr against sep: worse** — snr dominates at no stage; sep dominates at first picture, every slice, preview, every slice, visually lossless, jump, preview, jump, visually lossless
* **snr against one: a trade** — snr dominates at first picture, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: a trade** — two dominates at every slice, visually lossless, jump, visually lossless; svc dominates at first picture, every slice, preview, jump, preview
* **two against sep: neither dominates** — two dominates at no stage; sep dominates at no stage
* **two against one: a trade** — two dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at first picture, every slice, preview, every slice, visually lossless, every slice, exact, jump, preview, jump, visually lossless, jump, exact

## dbts_c1 · G 8 · visually lossless rung Q 4

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 11470 B · 1.67 ✗ | 7884 B · 1.6 ? | 264686 B · 2.46 ✗ | 7884 B · 1.6 ? | 1162 B · — | 1094218 B · 1.06 ? |
| every slice, preview | 401477 B · 90.3 ✗ | 270816 B · 83 ? | 17487791 B · 162 ✗ | 270816 B · 83 ? | 23641 B · — | 70664924 B · 75.1 ✗ |
| every slice, visually lossless | 26908510 B · 391 ✗ | 17758607 B · 248 ✗ | 17487791 B · 162 | 17758607 B · 248 ✗ | 66404346 B · — ? | 70664924 B · 75.1 ? |
| every slice, exact | 81291194 B · 491 ✗ | 73605279 B · 350 ✗ | 73334463 B · 264 ✗ | 88423531 B · 323 ✗ | 66404346 B · — | 70664924 B · 75.1 ? |
| jump, preview | 28584 B · 6.1 ✗ | 19014 B · 5.39 ? | 1118983 B · 10.4 ✗ | 19014 B · 5.39 ? | 1934 B · — | 1026553 B · 1.12 ? |
| jump, visually lossless | 1731622 B · 24.6 ✗ | 1137998 B · 15.7 ✗ | 1118983 B · 10.4 ✗ | 1137998 B · 15.7 ✗ | 3310825 B · — ? | 1026553 B · 1.12 |
| jump, exact | 2521714 B · 26.2 ✗ | 1949439 B · 17.4 ✗ | 1930425 B · 12.2 ✗ | 2164550 B · 16.9 ✗ | 3310825 B · — ? | 1026553 B · 1.12 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 0, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 43.18 · 43.25 dB, visually lossless 54.28 · 54.95 dB (quantizers [25, 2])

*Reported:* per frame, median over rounds: snr preview frame 1.21; snr VL frame 4.12; snr residual decode 1.06; snr add 0.403; two preview frame 1.13; two VL frame 2.27; two residual decode 1.12; two add 0.402

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
| first picture | 11470 B · 2 ✗ | 7884 B · 2.01 ✗ | 95877 B · 1.97 ✗ | 7884 B · 2.01 ✗ | 1162 B · 0.275 | 1094218 B · 1.1 ✗ |
| every slice, preview | 400064 B · 112 ✗ | 270816 B · 106 ✗ | 6236705 B · 158 ✗ | 270816 B · 106 ✗ | 23641 B · 6.79 | 70664924 B · 73.2 ✗ |
| every slice, visually lossless | 8029065 B · 392 ✗ | 6507521 B · 262 ✗ | 6236705 B · 158 | 6507521 B · 262 ✗ | 66404346 B · 577 ✗ | 70664924 B · 73.2 |
| every slice, exact | 73324673 B · 498 ✗ | 72158819 B · 369 ✗ | 71888003 B · 266 ✗ | 77172445 B · 337 ✗ | 66404346 B · 577 | 70664924 B · 73.2 |
| jump, preview | 28509 B · 6.88 ✗ | 19014 B · 6.68 ✗ | 399408 B · 10.4 ✗ | 19014 B · 6.68 ✗ | 1934 B · 0.545 | 1026553 B · 1.03 ✗ |
| jump, visually lossless | 518475 B · 23.5 ✗ | 418422 B · 17.1 ✗ | 399408 B · 10.4 | 418422 B · 17.1 ✗ | 3310825 B · 27 ✗ | 1026553 B · 1.03 |
| jump, exact | 1467080 B · 25.4 ✗ | 1372190 B · 19 ✗ | 1353176 B · 12.3 ✗ | 1444975 B · 18.2 ✗ | 3310825 B · 27 ✗ | 1026553 B · 1.03 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 10, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 43.18 · 43.25 dB, visually lossless 48.04 · 48.33 dB (quantizers [25, 7])

*Reported:* per frame, median over rounds: snr preview frame 1.53; snr VL frame 3.82; snr residual decode 1.16; snr add 0.366; two preview frame 1.49; two VL frame 2.21; two residual decode 1.09; two add 0.341

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
| first picture | 10322 B · 1.67 ? | 7884 B · 1.7 ? | 264686 B · 2.28 ? | 7884 B · 1.7 ? | 1162 B · — | 1094218 B · 1.38 ? |
| every slice, preview | 333671 B · 91.2 ? | 257360 B · 85.2 ? | 17483081 B · 170 ? | 257360 B · 85.2 ? | 19737 B · — | 70664924 B · 74.6 ? |
| every slice, visually lossless | 26801786 B · 402 ? | 17740441 B · 257 ? | 17483081 B · 170 | 17740441 B · 257 ? | 66118979 B · — ? | 70664924 B · 74.6 ? |
| every slice, exact | 81209936 B · 505 ? | 73675262 B · 367 ? | 73417902 B · 276 ? | 88405365 B · 331 ? | 66118979 B · — | 70664924 B · 74.6 ? |
| jump, preview | 42425 B · 9.1 ? | 32255 B · 9.15 ? | 2089987 B · 18.1 ? | 32255 B · 9.15 ? | 2738 B · — | 1026553 B · 1.05 ? |
| jump, visually lossless | 3216703 B · 42.3 ? | 2122242 B · 27 ? | 2089987 B · 18.1 ? | 2122242 B · 27 ? | 5882841 B · — ? | 1026553 B · 1.05 |
| jump, exact | 4007163 B · 44 ? | 2934980 B · 28.8 ? | 2902725 B · 19.8 ? | 3148795 B · 28.1 ? | 5882841 B · — ? | 1026553 B · 1.05 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 0, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 43.18 · 43.11 dB, visually lossless 54.27 · 54.93 dB (quantizers [26, 2])

*Reported:* per frame, median over rounds: snr preview frame 1.2; snr VL frame 4.35; snr residual decode 1.13; snr add 0.42; two preview frame 1.2; two VL frame 2.33; two residual decode 1.12; two add 0.403

* **snr against svc: not read** — snr dominates at no stage; svc dominates at no stage
* **snr against sep: not read** — snr dominates at no stage; sep dominates at no stage
* **snr against one: not read** — snr dominates at no stage; one dominates at no stage
* **two against svc: not read** — two dominates at no stage; svc dominates at no stage
* **two against sep: not read** — two dominates at no stage; sep dominates at no stage
* **two against one: not read** — two dominates at no stage; one dominates at no stage
* **snr against two: not read** — snr dominates at no stage; two dominates at no stage

## dbts_c1 · G 16 · visually lossless rung Q 8

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 11470 B · 1.97 ✗ | 7884 B · 2.09 ✗ | 95877 B · 2.06 ✗ | 7884 B · 2.09 ✗ | 1162 B · 0.332 | 1094218 B · 1.12 ✗ |
| every slice, preview | 374134 B · 107 ✗ | 257360 B · 105 ✗ | 6229812 B · 162 ✗ | 257360 B · 105 ✗ | 19737 B · 6.84 | 70664924 B · 72.3 ✗ |
| every slice, visually lossless | 7980697 B · 377 ✗ | 6487172 B · 264 ✗ | 6229812 B · 162 | 6487172 B · 264 ✗ | 66118979 B · 570 ✗ | 70664924 B · 72.3 |
| every slice, exact | 73300617 B · 478 ✗ | 72225283 B · 369 ✗ | 71967923 B · 268 ✗ | 77152096 B · 339 ✗ | 66118979 B · 570 | 70664924 B · 72.3 |
| jump, preview | 47470 B · 11.4 ✗ | 32255 B · 10.1 ✗ | 744037 B · 15.7 ✗ | 32255 B · 10.1 ✗ | 2738 B · 0.741 | 1026553 B · 1.05 ✗ |
| jump, visually lossless | 956922 B · 39.1 ✗ | 776292 B · 25.9 ✗ | 744037 B · 15.7 | 776292 B · 25.9 ✗ | 5882841 B · 37.7 ✗ | 1026553 B · 1.05 |
| jump, exact | 1905884 B · 40.6 ✗ | 1731324 B · 27.4 ✗ | 1699069 B · 17.3 ✗ | 1802845 B · 27 ✗ | 5882841 B · 37.7 ✗ | 1026553 B · 1.05 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 10, two 10, one 10, sep 10, svc 10, htj2k 10

*Reported:* in-window PSNR, aomenc · quality layers: preview 43.18 · 43.24 dB, visually lossless 48.04 · 48.33 dB (quantizers [25, 7])

*Reported:* per frame, median over rounds: snr preview frame 1.46; snr VL frame 3.73; snr residual decode 1.17; snr add 0.378; two preview frame 1.39; two VL frame 2.18; two residual decode 1.08; two add 0.32

* **snr against svc: a trade** — snr dominates at every slice, visually lossless; svc dominates at first picture, every slice, preview, jump, preview
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
| snr | one | 8 | 4 | a trade | a trade | a trade | a trade |
| snr | one | 8 | 8 | a trade | a trade | a trade | a trade |
| snr | one | 16 | 4 | a trade | a trade | not read | differs |
| snr | one | 16 | 8 | a trade | a trade | a trade | a trade |
| snr | sep | 1 | 4 | worse | worse | worse | worse |
| snr | sep | 1 | 8 | worse | worse | worse | worse |
| snr | sep | 8 | 4 | worse | worse | worse | worse |
| snr | sep | 8 | 8 | worse | worse | worse | worse |
| snr | sep | 16 | 4 | worse | worse | not read | differs |
| snr | sep | 16 | 8 | worse | worse | worse | worse |
| snr | svc | 1 | 4 | not read | not read | not read | not read |
| snr | svc | 1 | 8 | a trade | a trade | a trade | a trade |
| snr | svc | 8 | 4 | not read | not read | not read | not read |
| snr | svc | 8 | 8 | a trade | a trade | a trade | a trade |
| snr | svc | 16 | 4 | not read | not read | not read | not read |
| snr | svc | 16 | 8 | a trade | a trade | a trade | a trade |
| snr | two | 1 | 4 | worse | worse | worse | worse |
| snr | two | 1 | 8 | worse | worse | worse | worse |
| snr | two | 8 | 4 | worse | worse | worse | worse |
| snr | two | 8 | 8 | worse | worse | worse | worse |
| snr | two | 16 | 4 | worse | worse | not read | differs |
| snr | two | 16 | 8 | worse | worse | worse | worse |
| two | one | 1 | 4 | a trade | a trade | a trade | a trade |
| two | one | 1 | 8 | a trade | a trade | a trade | a trade |
| two | one | 8 | 4 | a trade | a trade | a trade | a trade |
| two | one | 8 | 8 | a trade | a trade | a trade | a trade |
| two | one | 16 | 4 | a trade | a trade | not read | differs |
| two | one | 16 | 8 | a trade | a trade | a trade | a trade |
| two | sep | 1 | 4 | neither dominates | better | neither dominates | differs |
| two | sep | 1 | 8 | neither dominates | neither dominates | neither dominates | neither dominates |
| two | sep | 8 | 4 | better | neither dominates | neither dominates | differs |
| two | sep | 8 | 8 | neither dominates | neither dominates | neither dominates | neither dominates |
| two | sep | 16 | 4 | neither dominates | neither dominates | not read | differs |
| two | sep | 16 | 8 | neither dominates | neither dominates | neither dominates | neither dominates |
| two | svc | 1 | 4 | not read | not read | not read | not read |
| two | svc | 1 | 8 | a trade | a trade | a trade | a trade |
| two | svc | 8 | 4 | not read | not read | not read | not read |
| two | svc | 8 | 8 | a trade | a trade | a trade | a trade |
| two | svc | 16 | 4 | not read | not read | not read | not read |
| two | svc | 16 | 8 | a trade | a trade | a trade | a trade |
