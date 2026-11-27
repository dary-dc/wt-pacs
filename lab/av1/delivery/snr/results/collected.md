## SNR preview, collected

rounds 20; VOID blocks 2

| volume · G · VL rung | A/A: median log (interval), n | A/A | arms flagged by order (p) |
| --- | --- | --- | --- |
| dbts_a1 · 1 · 4 | +0.0112 (-0.0148, 0.0717), 20 | passes | — |
| dbts_a1 · 1 · 8 | +0.0063 (-0.0292, 0.1136), 20 | passes | — |
| dbts_a1 · 8 · 4 | -0.1313 (-0.2079, -0.03), 20 | fails: not read | — |
| dbts_a1 · 8 · 8 | +0.0141 (-0.0125, 0.067), 20 | passes | — |
| dbts_a1 · 16 · 4 | -0.0131 (-0.0654, 0.019), 20 | passes | — |
| dbts_a1 · 16 · 8 | -0.0126 (-0.0678, 0.0845), 20 | passes | — |
| dbts_b1 · 1 · 4 | +0.0052 (-0.0562, 0.0206), 19 | passes | — |
| dbts_b1 · 1 · 8 | +0.0163 (-0.0252, 0.0441), 19 | passes | — |
| dbts_b1 · 8 · 4 | +0.0077 (-0.0586, 0.0749), 20 | passes | — |
| dbts_b1 · 8 · 8 | -0.0163 (-0.0466, 0.0157), 20 | passes | — |
| dbts_b1 · 16 · 4 | +0.0018 (-0.0491, 0.0463), 20 | passes | — |
| dbts_b1 · 16 · 8 | +0.0142 (-0.0443, 0.0726), 20 | passes | — |
| dbts_c1 · 1 · 4 | +0.0194 (-0.0308, 0.0436), 20 | passes | — |
| dbts_c1 · 1 · 8 | -0.0134 (-0.0689, 0.0322), 20 | passes | — |
| dbts_c1 · 8 · 4 | -0.0021 (-0.0422, 0.04), 20 | passes | — |
| dbts_c1 · 8 · 8 | -0.0019 (-0.0348, 0.0945), 20 | passes | — |
| dbts_c1 · 16 · 4 | +0.0150 (-0.0196, 0.0362), 20 | passes | — |
| dbts_c1 · 16 · 8 | -0.0270 (-0.0823, 0.0286), 20 | passes | — |

A/A decided (interval excludes 0) in 1 of 18 readable blocks

## dbts_a1 · G 1 · visually lossless rung Q 4

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 8842 B · 1.92 ✗ | 6161 B · 1.88 ? | 281178 B · 2.84 ✗ | 6161 B · 1.88 ? | 848 B · — | 1256607 B · 1.05 ? |
| every slice, preview | 669297 B · 98.1 ✗ | 432657 B · 89.5 ? | 15588376 B · 166 ✗ | 432657 B · 89.5 ? | 55223 B · — | 67812443 B · 60 ? |
| every slice, visually lossless | 20218772 B · 384 ✗ | 16021033 B · 258 ✗ | 15588376 B · 166 | 16021033 B · 258 ✗ | 66403640 B · — ? | 67812443 B · 60 ? |
| every slice, exact | 75956610 B · 459 ✗ | 70884030 B · 334 ✗ | 70451373 B · 243 ✗ | 83833476 B · 318 ✗ | 66403640 B · — | 67812443 B · 60 ? |
| jump, preview | 12031 B · 2.09 ✗ | 7770 B · 1.88 ? | 278887 B · 3.22 ✗ | 7770 B · 1.88 ? | 991 B · — | 1213665 B · 1.04 ? |
| jump, visually lossless | 361824 B · 7.65 ✗ | 286657 B · 5.24 ✗ | 278887 B · 3.22 | 286657 B · 5.24 ✗ | 1188563 B · — ? | 1213665 B · 1.04 ? |
| jump, exact | 1359417 B · 9.14 ✗ | 1268684 B · 6.72 ✗ | 1260914 B · 4.7 ✗ | 1500322 B · 6.27 ✗ | 1188563 B · — | 1213665 B · 1.04 ? |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 20, two 20, one 20, sep 20, svc 0, htj2k 20

*Reported:* in-window PSNR, aomenc · quality layers: preview 44.35 · 44.30 dB, visually lossless 54.28 · 53.71 dB (quantizers [25, 3])

*Reported:* per frame, median over rounds: snr preview frame 1.66; snr VL frame 4.94; snr residual decode 1.08; snr add 0.249; two preview frame 1.52; two VL frame 2.78; two residual decode 1.11; two add 0.255

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
| first picture | 8842 B · 2.41 ✗ | 6161 B · 2.18 ✗ | 84454 B · 2.14 ✗ | 6161 B · 2.18 ✗ | 848 B · 0.277 | 1256607 B · 1.15 ✗ |
| every slice, preview | 669297 B · 118 ✗ | 432657 B · 108 ✗ | 4655594 B · 115 ✗ | 432657 B · 108 ✗ | 55223 B · 12.8 | 67812443 B · 59.7 ✗ |
| every slice, visually lossless | 5584289 B · 370 ✗ | 5088251 B · 223 ✗ | 4655594 B · 115 | 5088251 B · 223 ✗ | 66403640 B · 609 ✗ | 67812443 B · 59.7 |
| every slice, exact | 70307203 B · 448 ✗ | 69519738 B · 301 ✗ | 69087081 B · 193 ✗ | 72900694 B · 284 ✗ | 66403640 B · 609 | 67812443 B · 59.7 |
| jump, preview | 12031 B · 2.3 ✗ | 7770 B · 2.08 ✗ | 83341 B · 2.15 ✗ | 7770 B · 2.08 ✗ | 991 B · 0.267 | 1213665 B · 1.08 ✗ |
| jump, visually lossless | 99972 B · 7.27 ✗ | 91112 B · 4.23 ✗ | 83341 B · 2.15 | 91112 B · 4.23 ✗ | 1188563 B · 11.6 ✗ | 1213665 B · 1.08 |
| jump, exact | 1258331 B · 8.93 ✗ | 1244268 B · 5.59 ✗ | 1236498 B · 3.55 ✗ | 1304777 B · 5.38 ✗ | 1188563 B · 11.6 | 1213665 B · 1.08 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 20, two 20, one 20, sep 20, svc 20, htj2k 20

*Reported:* in-window PSNR, aomenc · quality layers: preview 44.35 · 44.30 dB, visually lossless 48.08 · 47.89 dB (quantizers [25, 8])

*Reported:* per frame, median over rounds: snr preview frame 1.94; snr VL frame 4.16; snr residual decode 1.23; snr add 0.328; two preview frame 1.79; two VL frame 1.94; two residual decode 1.08; two add 0.298

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
| first picture | 8842 B · 1.61 ? | 6161 B · 1.79 ? | 281178 B · 2.71 ? | 6161 B · 1.79 ? | 848 B · — | 1256607 B · 1.02 ? |
| every slice, preview | 310476 B · 74.4 ? | 209754 B · 79 ? | 15681641 B · 152 ? | 209754 B · 79 ? | 15062 B · — | 67812443 B · 58.3 ? |
| every slice, visually lossless | 19259300 B · 333 ? | 15891395 B · 234 ? | 15681641 B · 152 | 15891395 B · 234 ? | 63882051 B · — ? | 67812443 B · 58.3 ? |
| every slice, exact | 75077895 B · 403 ? | 70870038 B · 302 ? | 70660284 B · 219 ? | 83703838 B · 293 ? | 63882051 B · — | 67812443 B · 58.3 ? |
| jump, preview | 27809 B · 5.86 ? | 18410 B · 6.32 ? | 1248060 B · 11.2 ? | 18410 B · 6.32 ? | 1581 B · — | 1213665 B · 1.02 ? |
| jump, visually lossless | 1542411 B · 23.9 ? | 1266470 B · 16.9 ? | 1248060 B · 11.2 ? | 1266470 B · 16.9 ? | 3911401 B · — ? | 1213665 B · 1.02 |
| jump, exact | 2541411 B · 25.5 ? | 2250509 B · 18.4 ? | 2232099 B · 12.7 ? | 2480135 B · 18.1 ? | 3911401 B · — ? | 1213665 B · 1.02 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 20, two 20, one 20, sep 20, svc 0, htj2k 20

*Reported:* in-window PSNR, aomenc · quality layers: preview 44.26 · 44.28 dB, visually lossless 54.24 · 53.65 dB (quantizers [25, 3])

*Reported:* per frame, median over rounds: snr preview frame 1.26; snr VL frame 4.47; snr residual decode 0.959; snr add 0.221; two preview frame 1.37; two VL frame 2.56; two residual decode 0.969; two add 0.225

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
| first picture | 8842 B · 2.26 ✗ | 6161 B · 2.03 ✗ | 84454 B · 2.07 ✗ | 6161 B · 2.03 ✗ | 848 B · 0.262 | 1256607 B · 1.26 ✗ |
| every slice, preview | 309829 B · 99.9 ✗ | 209754 B · 112 ✗ | 4639708 B · 151 ✗ | 209754 B · 112 ✗ | 15062 B · 5.89 | 67812443 B · 60.5 ✗ |
| every slice, visually lossless | 4928175 B · 342 ✗ | 4849462 B · 265 ✗ | 4639708 B · 151 | 4849462 B · 265 ✗ | 63882051 B · 561 ✗ | 67812443 B · 60.5 |
| every slice, exact | 69623222 B · 424 ✗ | 69167785 B · 348 ✗ | 68958031 B · 235 ✗ | 72661905 B · 326 ✗ | 63882051 B · 561 | 67812443 B · 60.5 |
| jump, preview | 27742 B · 8.41 ✗ | 18410 B · 8.51 ✗ | 369734 B · 11.1 ✗ | 18410 B · 8.51 ✗ | 1581 B · 0.557 | 1213665 B · 1 ✗ |
| jump, visually lossless | 397671 B · 29.9 ✗ | 388144 B · 19.6 ✗ | 369734 B · 11.1 | 388144 B · 19.6 ✗ | 3911401 B · 30.6 ✗ | 1213665 B · 1 |
| jump, exact | 1555527 B · 31.3 ✗ | 1539246 B · 21.1 ✗ | 1520836 B · 12.6 ✗ | 1601810 B · 20.6 ✗ | 3911401 B · 30.6 ✗ | 1213665 B · 1 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 20, two 20, one 20, sep 20, svc 20, htj2k 20

*Reported:* in-window PSNR, aomenc · quality layers: preview 44.26 · 44.28 dB, visually lossless 48.20 · 47.91 dB (quantizers [25, 8])

*Reported:* per frame, median over rounds: snr preview frame 1.71; snr VL frame 4.18; snr residual decode 1.12; snr add 0.302; two preview frame 1.85; two VL frame 2.57; two residual decode 1.16; two add 0.316

* **snr against svc: a trade** — snr dominates at every slice, visually lossless, jump, visually lossless, jump, exact; svc dominates at first picture, every slice, preview, jump, preview
* **snr against sep: worse** — snr dominates at no stage; sep dominates at first picture, every slice, visually lossless, jump, preview, jump, visually lossless
* **snr against one: a trade** — snr dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: a trade** — two dominates at every slice, visually lossless, jump, visually lossless, jump, exact; svc dominates at first picture, every slice, preview, jump, preview
* **two against sep: neither dominates** — two dominates at no stage; sep dominates at no stage
* **two against one: a trade** — two dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at first picture, every slice, visually lossless, every slice, exact, jump, preview, jump, visually lossless, jump, exact

## dbts_a1 · G 16 · visually lossless rung Q 4

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 8842 B · 1.65 ? | 6161 B · 1.82 ? | 281178 B · 2.92 ✗ | 6161 B · 1.82 ? | 848 B · — | 1256607 B · 0.997 ? |
| every slice, preview | 290864 B · 82.6 ? | 199087 B · 88.8 ? | 15685772 B · 172 ✗ | 199087 B · 88.8 ? | 12520 B · — | 67812443 B · 59.6 ? |
| every slice, visually lossless | 19203236 B · 365 ✗ | 15884859 B · 261 ✗ | 15685772 B · 172 | 15884859 B · 261 ✗ | 63715646 B · — ? | 67812443 B · 59.6 ? |
| every slice, exact | 75021387 B · 443 ✗ | 70890324 B · 337 ✗ | 70691237 B · 246 ✗ | 83697302 B · 323 ✗ | 63715646 B · — | 67812443 B · 59.6 ? |
| jump, preview | 45173 B · 12.5 ✗ | 30564 B · 11.9 ? | 2246009 B · 24.5 ✗ | 30564 B · 11.9 ? | 2186 B · — | 1213665 B · 1.01 ? |
| jump, visually lossless | 2759780 B · 51.1 ✗ | 2276574 B · 37.3 ✗ | 2246009 B · 24.5 ✗ | 2276574 B · 37.3 ✗ | 6728356 B · — ? | 1213665 B · 1.01 |
| jump, exact | 3758771 B · 52.8 ✗ | 3261111 B · 38.6 ✗ | 3230547 B · 25.8 ✗ | 3490239 B · 38.3 ✗ | 6728356 B · — ? | 1213665 B · 1.01 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 20, two 20, one 20, sep 20, svc 0, htj2k 20

*Reported:* in-window PSNR, aomenc · quality layers: preview 44.25 · 44.28 dB, visually lossless 54.23 · 53.64 dB (quantizers [25, 3])

*Reported:* per frame, median over rounds: snr preview frame 1.39; snr VL frame 4.75; snr residual decode 1.06; snr add 0.253; two preview frame 1.52; two VL frame 2.9; two residual decode 1.03; two add 0.233

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
| first picture | 8842 B · 2.12 ✗ | 6161 B · 2.22 ✗ | 84454 B · 2.18 ✗ | 6161 B · 2.22 ✗ | 848 B · 0.24 | 1256607 B · 1.08 ✗ |
| every slice, preview | 290430 B · 104 ✗ | 199087 B · 108 ✗ | 4640590 B · 145 ✗ | 199087 B · 108 ✗ | 12520 B · 4.93 | 67812443 B · 61.7 ✗ |
| every slice, visually lossless | 4895364 B · 343 ✗ | 4839677 B · 251 ✗ | 4640590 B · 145 | 4839677 B · 251 ✗ | 63715646 B · 556 ✗ | 67812443 B · 61.7 |
| every slice, exact | 69605633 B · 423 ✗ | 69184169 B · 334 ✗ | 68985082 B · 224 ✗ | 72652120 B · 315 ✗ | 63715646 B · 556 | 67812443 B · 61.7 |
| jump, preview | 45113 B · 14.7 ✗ | 30564 B · 15 ✗ | 666466 B · 20.5 ✗ | 30564 B · 15 ✗ | 2186 B · 0.941 | 1213665 B · 1.07 ✗ |
| jump, visually lossless | 706530 B · 49.5 ✗ | 697030 B · 36.3 ✗ | 666466 B · 20.5 | 697030 B · 36.3 ✗ | 6728356 B · 50.9 ✗ | 1213665 B · 1.07 |
| jump, exact | 1864663 B · 50.9 ✗ | 1848607 B · 37.7 ✗ | 1818043 B · 22.1 ✗ | 1910695 B · 37.4 ✗ | 6728356 B · 50.9 ✗ | 1213665 B · 1.07 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 20, two 20, one 20, sep 20, svc 20, htj2k 20

*Reported:* in-window PSNR, aomenc · quality layers: preview 44.25 · 44.28 dB, visually lossless 48.21 · 47.91 dB (quantizers [25, 8])

*Reported:* per frame, median over rounds: snr preview frame 1.78; snr VL frame 4.15; snr residual decode 1.15; snr add 0.303; two preview frame 1.84; two VL frame 2.49; two residual decode 1.1; two add 0.296

* **snr against svc: a trade** — snr dominates at every slice, visually lossless, jump, visually lossless; svc dominates at first picture, every slice, preview, jump, preview
* **snr against sep: worse** — snr dominates at no stage; sep dominates at first picture, every slice, preview, every slice, visually lossless, jump, visually lossless
* **snr against one: a trade** — snr dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: a trade** — two dominates at every slice, visually lossless, jump, visually lossless, jump, exact; svc dominates at first picture, every slice, preview, jump, preview
* **two against sep: neither dominates** — two dominates at no stage; sep dominates at no stage
* **two against one: a trade** — two dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at first picture, every slice, preview, every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact

## dbts_b1 · G 1 · visually lossless rung Q 4

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 64206 B · 1.13 ? | 49522 B · 1.74 ? | 939638 B · 2.18 ✗ | 49522 B · 1.74 ? | 2500 B · — | 2113277 B · 0.968 ? |
| every slice, preview | 3438012 B · 59.4 ? | 2642917 B · 93.5 ? | 47554367 B · 110 ✗ | 2642917 B · 93.5 ? | 153160 B · — | 107407602 B · 52.7 ? |
| every slice, visually lossless | 66655708 B · 255 ✗ | 50197284 B · 201 ✗ | 47554367 B · 110 | 50197284 B · 201 ✗ | 109732176 B · — ? | 107407602 B · 52.7 |
| every slice, exact | 130960916 B · 321 ✗ | 115704938 B · 265 ✗ | 113062021 B · 176 ✗ | 157604886 B · 256 ✗ | 109732176 B · — ? | 107407602 B · 52.7 |
| jump, preview | 69038 B · 1.18 ? | 53037 B · 1.94 ? | 951730 B · 2.26 ✗ | 53037 B · 1.94 ? | 3090 B · — | 2149534 B · 1 ✗ |
| jump, visually lossless | 1334074 B · 5.06 ✗ | 1004767 B · 4.34 ✗ | 951730 B · 2.26 | 1004767 B · 4.34 ✗ | 2196448 B · — ? | 2149534 B · 1 |
| jump, exact | 2620729 B · 6.48 ✗ | 2315875 B · 5.59 ✗ | 2262838 B · 3.6 ✗ | 3154301 B · 5.34 ✗ | 2196448 B · — ? | 2149534 B · 1 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 19, two 19, one 19, sep 19, svc 0, htj2k 19

*Reported:* in-window PSNR, aomenc · quality layers: preview 40.64 · 40.65 dB, visually lossless 54.64 · 54.93 dB (quantizers [25, 2])

*Reported:* per frame, median over rounds: snr preview frame 1.11; snr VL frame 3.74; snr residual decode 0.996; snr add 0.292; two preview frame 1.76; two VL frame 2.12; two residual decode 0.991; two add 0.3

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
| first picture | 64206 B · 1.14 ✗ | 49522 B · 1.88 ✗ | 467815 B · 1.63 ✗ | 49522 B · 1.88 ✗ | 2500 B · 0.107 | 2113277 B · 1.01 ✗ |
| every slice, preview | 3438012 B · 57.5 ✗ | 2642917 B · 93 ✗ | 23477229 B · 82.9 ✗ | 2642917 B · 93 ✗ | 153160 B · 4.92 | 107407602 B · 53.9 ✗ |
| every slice, visually lossless | 27889701 B · 207 ✗ | 26120146 B · 177 ✗ | 23477229 B · 82.9 | 26120146 B · 177 ✗ | 109732176 B · 241 ✗ | 107407602 B · 53.9 |
| every slice, exact | 117225020 B · 272 ✗ | 114756812 B · 241 ✗ | 112113895 B · 148 ✗ | 133527748 B · 231 ✗ | 109732176 B · 241 ✗ | 107407602 B · 53.9 |
| jump, preview | 69038 B · 1.23 ✗ | 53037 B · 1.83 ✗ | 469734 B · 1.85 ✗ | 53037 B · 1.83 ✗ | 3090 B · 0.117 | 2149534 B · 1.05 ✗ |
| jump, visually lossless | 558224 B · 4.28 ✗ | 522771 B · 3.62 ✗ | 469734 B · 1.85 | 522771 B · 3.62 ✗ | 2196448 B · 4.83 ✗ | 2149534 B · 1.05 |
| jump, exact | 2346058 B · 5.55 ✗ | 2296756 B · 5.02 ✗ | 2243718 B · 3.09 ✗ | 2672305 B · 4.76 ✗ | 2196448 B · 4.83 ✗ | 2149534 B · 1.05 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 19, two 19, one 19, sep 19, svc 19, htj2k 19

*Reported:* in-window PSNR, aomenc · quality layers: preview 40.64 · 40.65 dB, visually lossless 47.33 · 47.07 dB (quantizers [25, 7])

*Reported:* per frame, median over rounds: snr preview frame 1.07; snr VL frame 2.8; snr residual decode 0.976; snr add 0.29; two preview frame 1.7; two VL frame 1.55; two residual decode 1.02; two add 0.299

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
| first picture | 64206 B · 1.05 ? | 49522 B · 1.83 ? | 939638 B · 2.2 ✗ | 49522 B · 1.83 ? | 2500 B · — | 2113277 B · 1.06 ✗ |
| every slice, preview | 2000037 B · 56.8 ? | 1673494 B · 71.6 ? | 46921123 B · 113 ✗ | 1673494 B · 71.6 ? | 41324 B · — | 107407602 B · 54 ? |
| every slice, visually lossless | 64595905 B · 256 ✗ | 48594617 B · 185 ✗ | 46921123 B · 113 | 48594617 B · 185 ✗ | 101537520 B · — ? | 107407602 B · 54 ? |
| every slice, exact | 127322694 B · 324 ✗ | 114562005 B · 250 ✗ | 112888511 B · 180 ✗ | 156002219 B · 239 ✗ | 101537520 B · — | 107407602 B · 54 ? |
| jump, preview | 190221 B · 4.46 ? | 156326 B · 6.03 ? | 4167994 B · 9.09 ✗ | 156326 B · 6.03 ? | 4746 B · — | 2149534 B · 1.04 ? |
| jump, visually lossless | 5745128 B · 19.4 ✗ | 4324320 B · 15.1 ✗ | 4167994 B · 9.09 ✗ | 4324320 B · 15.1 ✗ | 9079726 B · — ? | 2149534 B · 1.04 |
| jump, exact | 7000404 B · 20.8 ✗ | 5644595 B · 16.2 ✗ | 5488269 B · 10.2 ✗ | 6473854 B · 16.1 ✗ | 9079726 B · — ? | 2149534 B · 1.04 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 20, two 20, one 20, sep 20, svc 0, htj2k 20

*Reported:* in-window PSNR, aomenc · quality layers: preview 40.60 · 40.54 dB, visually lossless 54.51 · 55.38 dB (quantizers [25, 2])

*Reported:* per frame, median over rounds: snr preview frame 1.07; snr VL frame 3.82; snr residual decode 1.01; snr add 0.291; two preview frame 1.32; two VL frame 2.15; two residual decode 0.95; two add 0.29

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
| first picture | 64206 B · 1.06 ✗ | 49522 B · 1.79 ✗ | 467815 B · 1.63 ✗ | 49522 B · 1.79 ✗ | 2500 B · 0.105 | 2113277 B · 0.999 ✗ |
| every slice, preview | 1999273 B · 56.3 ✗ | 1673494 B · 74.3 ✗ | 23205924 B · 92 ✗ | 1673494 B · 74.3 ✗ | 41324 B · 3.15 | 107407602 B · 53.9 ✗ |
| every slice, visually lossless | 26226658 B · 214 ✗ | 24879418 B · 166 ✗ | 23205924 B · 92 | 24879418 B · 166 ✗ | 101537520 B · 195 ✗ | 107407602 B · 53.9 |
| every slice, exact | 115218354 B · 281 ✗ | 113140410 B · 232 ✗ | 111466916 B · 159 ✗ | 132287020 B · 219 ✗ | 101537520 B · 195 | 107407602 B · 53.9 |
| jump, preview | 190139 B · 4.89 ✗ | 156326 B · 6.36 ✗ | 2060591 B · 7.54 ✗ | 156326 B · 6.36 ✗ | 4746 B · 0.272 | 2149534 B · 1.03 ✗ |
| jump, visually lossless | 2338094 B · 17.3 ✗ | 2216917 B · 13.9 ✗ | 2060591 B · 7.54 | 2216917 B · 13.9 ✗ | 9079726 B · 15.4 ✗ | 2149534 B · 1.03 |
| jump, exact | 4119050 B · 18.7 ✗ | 3983350 B · 15.4 ✗ | 3827023 B · 8.94 ✗ | 4366451 B · 15 ✗ | 9079726 B · 15.4 ✗ | 2149534 B · 1.03 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 20, two 20, one 20, sep 20, svc 20, htj2k 20

*Reported:* in-window PSNR, aomenc · quality layers: preview 40.60 · 40.54 dB, visually lossless 47.43 · 47.15 dB (quantizers [25, 7])

*Reported:* per frame, median over rounds: snr preview frame 1.05; snr VL frame 3; snr residual decode 0.98; snr add 0.299; two preview frame 1.38; two VL frame 1.76; two residual decode 1.02; two add 0.308

* **snr against svc: a trade** — snr dominates at jump, visually lossless; svc dominates at first picture, every slice, preview, every slice, exact, jump, preview
* **snr against sep: worse** — snr dominates at no stage; sep dominates at every slice, visually lossless, jump, visually lossless
* **snr against one: a trade** — snr dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: a trade** — two dominates at every slice, visually lossless, jump, visually lossless, jump, exact; svc dominates at first picture, every slice, preview, every slice, exact, jump, preview
* **two against sep: neither dominates** — two dominates at no stage; sep dominates at no stage
* **two against one: a trade** — two dominates at every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact

## dbts_b1 · G 16 · visually lossless rung Q 4

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 64206 B · 1.18 ? | 49522 B · 1.9 ? | 939638 B · 2.13 ✗ | 49522 B · 1.9 ? | 2500 B · — | 2113277 B · 0.993 ? |
| every slice, preview | 1914571 B · 57 ? | 1625800 B · 71.3 ? | 46853126 B · 114 ✗ | 1625800 B · 71.3 ? | 34048 B · — | 107407602 B · 53.3 ✗ |
| every slice, visually lossless | 64474968 B · 254 ✗ | 48478926 B · 185 ✗ | 46853126 B · 114 | 48478926 B · 185 ✗ | 100956608 B · — ? | 107407602 B · 53.3 ? |
| every slice, exact | 127109056 B · 320 ✗ | 114516487 B · 253 ✗ | 112890687 B · 181 ✗ | 155886528 B · 238 ✗ | 100956608 B · — | 107407602 B · 53.3 ? |
| jump, preview | 332504 B · 9.57 ? | 279269 B · 11.5 ? | 7838489 B · 17.8 ✗ | 279269 B · 11.5 ? | 6738 B · — | 2149534 B · 1.06 ? |
| jump, visually lossless | 10789273 B · 42 ✗ | 8117757 B · 29.3 ✗ | 7838489 B · 17.8 ✗ | 8117757 B · 29.3 ✗ | 16940736 B · — ? | 2149534 B · 1.06 |
| jump, exact | 12042657 B · 43.3 ✗ | 9439464 B · 30.7 ✗ | 9160196 B · 19.1 ✗ | 10267291 B · 30.4 ✗ | 16940736 B · — ? | 2149534 B · 1.06 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 20, two 20, one 20, sep 20, svc 0, htj2k 20

*Reported:* in-window PSNR, aomenc · quality layers: preview 40.61 · 40.53 dB, visually lossless 54.50 · 55.41 dB (quantizers [25, 2])

*Reported:* per frame, median over rounds: snr preview frame 1.06; snr VL frame 3.81; snr residual decode 0.953; snr add 0.283; two preview frame 1.35; two VL frame 2.15; two residual decode 0.965; two add 0.296

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
| first picture | 64206 B · 1.14 ✗ | 49522 B · 1.89 ✗ | 467815 B · 1.64 ✗ | 49522 B · 1.89 ✗ | 2500 B · 0.105 | 2113277 B · 1 ✗ |
| every slice, preview | 1912987 B · 57.7 ✗ | 1625800 B · 71 ✗ | 23191007 B · 91.4 ✗ | 1625800 B · 71 ✗ | 34048 B · 3.12 | 107407602 B · 53.6 ✗ |
| every slice, visually lossless | 26138799 B · 210 ✗ | 24816807 B · 161 ✗ | 23191007 B · 91.4 | 24816807 B · 161 ✗ | 100956608 B · 190 ✗ | 107407602 B · 53.6 |
| every slice, exact | 115129225 B · 274 ✗ | 113073904 B · 226 ✗ | 111448104 B · 156 ✗ | 132224409 B · 215 ✗ | 100956608 B · 190 | 107407602 B · 53.6 |
| jump, preview | 332319 B · 9.38 ✗ | 279269 B · 12.1 ✗ | 3878955 B · 15.6 ✗ | 279269 B · 12.1 ✗ | 6738 B · 0.512 | 2149534 B · 1.04 ✗ |
| jump, visually lossless | 4377512 B · 33.3 ✗ | 4158224 B · 28 ✗ | 3878955 B · 15.6 ✗ | 4158224 B · 28 ✗ | 16940736 B · 30.1 ✗ | 2149534 B · 1.04 |
| jump, exact | 6158442 B · 34.5 ✗ | 5924577 B · 29.4 ✗ | 5645308 B · 16.9 ✗ | 6307758 B · 29 ✗ | 16940736 B · 30.1 ✗ | 2149534 B · 1.04 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 20, two 20, one 20, sep 20, svc 20, htj2k 20

*Reported:* in-window PSNR, aomenc · quality layers: preview 40.61 · 40.53 dB, visually lossless 47.43 · 47.16 dB (quantizers [25, 7])

*Reported:* per frame, median over rounds: snr preview frame 1.07; snr VL frame 2.85; snr residual decode 0.964; snr add 0.277; two preview frame 1.32; two VL frame 1.73; two residual decode 0.994; two add 0.323

* **snr against svc: worse** — snr dominates at no stage; svc dominates at first picture, every slice, preview, every slice, exact, jump, preview
* **snr against sep: worse** — snr dominates at no stage; sep dominates at every slice, visually lossless, jump, visually lossless
* **snr against one: a trade** — snr dominates at first picture, every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **two against svc: a trade** — two dominates at every slice, visually lossless, jump, visually lossless, jump, exact; svc dominates at first picture, every slice, preview, every slice, exact, jump, preview
* **two against sep: neither dominates** — two dominates at no stage; sep dominates at no stage
* **two against one: a trade** — two dominates at every slice, preview, jump, preview; one dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact
* **snr against two: worse** — snr dominates at no stage; two dominates at every slice, visually lossless, every slice, exact, jump, visually lossless, jump, exact

## dbts_c1 · G 1 · visually lossless rung Q 4

| stage | snr | two | one | sep | svc | htj2k |
| --- | --: | --: | --: | --: | --: | --: |
| first picture | 11470 B · 1.77 ✗ | 7884 B · 1.72 ? | 264686 B · 2.49 ✗ | 7884 B · 1.72 ? | 1162 B · — | 1094218 B · 1.04 ? |
| every slice, preview | 838862 B · 117 ✗ | 568606 B · 109 ? | 17498082 B · 159 ✗ | 568606 B · 109 ? | 80807 B · — | 70664924 B · 75.7 ? |
| every slice, visually lossless | 28082472 B · 436 ✗ | 18066688 B · 271 ✗ | 17498082 B · 159 | 18066688 B · 271 ✗ | 70700403 B · — ? | 70664924 B · 75.7 |
| every slice, exact | 82446160 B · 532 ✗ | 73729045 B · 364 ✗ | 73160439 B · 252 ✗ | 88731612 B · 346 ✗ | 70700403 B · — ? | 70664924 B · 75.7 |
| jump, preview | 12198 B · 1.85 ✗ | 8265 B · 1.78 ? | 254044 B · 2.4 ✗ | 8265 B · 1.78 ? | 1174 B · — | 1026553 B · 1.05 ? |
| jump, visually lossless | 407866 B · 6.79 ✗ | 262309 B · 4.18 ✗ | 254044 B · 2.4 | 262309 B · 4.18 ✗ | 1027067 B · — ? | 1026553 B · 1.05 |
| jump, exact | 1197688 B · 8.14 ✗ | 1071099 B · 5.63 ✗ | 1062834 B · 3.82 ✗ | 1288861 B · 5.26 ✗ | 1027067 B · — ? | 1026553 B · 1.05 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 20, two 20, one 20, sep 20, svc 0, htj2k 20

*Reported:* in-window PSNR, aomenc · quality layers: preview 43.28 · 43.25 dB, visually lossless 54.33 · 54.94 dB (quantizers [25, 2])

*Reported:* per frame, median over rounds: snr preview frame 1.52; snr VL frame 4.43; snr residual decode 1.04; snr add 0.293; two preview frame 1.43; two VL frame 2.21; two residual decode 1.09; two add 0.297

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
| first picture | 11470 B · 2.01 ✗ | 7884 B · 2.13 ✗ | 95877 B · 2.06 ✗ | 7884 B · 2.13 ✗ | 1162 B · 0.328 | 1094218 B · 1.06 ✗ |
| every slice, preview | 838862 B · 143 ✗ | 568606 B · 129 ✗ | 6346125 B · 137 ✗ | 568606 B · 129 ✗ | 80807 B · 15.6 | 70664924 B · 73.5 ✗ |
| every slice, visually lossless | 8872050 B · 440 ✗ | 6914731 B · 267 ✗ | 6346125 B · 137 | 6914731 B · 267 ✗ | 70700403 B · 672 ✗ | 70664924 B · 73.5 |
| every slice, exact | 74198301 B · 550 ✗ | 72733632 B · 375 ✗ | 72165026 B · 241 ✗ | 77579655 B · 343 ✗ | 70700403 B · 672 ✗ | 70664924 B · 73.5 |
| jump, preview | 12198 B · 2.14 ✗ | 8265 B · 2.13 ✗ | 92130 B · 2.13 ✗ | 8265 B · 2.13 ✗ | 1174 B · 0.253 | 1026553 B · 1.07 ✗ |
| jump, visually lossless | 128815 B · 6.66 ✗ | 100395 B · 4.3 ✗ | 92130 B · 2.13 | 100395 B · 4.3 ✗ | 1027067 B · 9.96 ✗ | 1026553 B · 1.07 |
| jump, exact | 1077858 B · 8.1 ✗ | 1056604 B · 5.77 ✗ | 1048339 B · 3.65 ✗ | 1126948 B · 5.33 ✗ | 1027067 B · 9.96 ✗ | 1026553 B · 1.07 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 20, two 20, one 20, sep 20, svc 20, htj2k 20

*Reported:* in-window PSNR, aomenc · quality layers: preview 43.28 · 43.25 dB, visually lossless 47.95 · 48.33 dB (quantizers [25, 7])

*Reported:* per frame, median over rounds: snr preview frame 1.87; snr VL frame 4.09; snr residual decode 1.13; snr add 0.347; two preview frame 1.74; two VL frame 1.85; two residual decode 1.14; two add 0.349

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
| first picture | 11470 B · 1.67 ✗ | 7884 B · 1.71 ? | 264686 B · 2.48 ✗ | 7884 B · 1.71 ? | 1162 B · — | 1094218 B · 1.04 ? |
| every slice, preview | 401477 B · 90.3 ✗ | 270816 B · 85.5 ? | 17487791 B · 166 ✗ | 270816 B · 85.5 ? | 23641 B · — | 70664924 B · 73.2 ? |
| every slice, visually lossless | 26908510 B · 388 ✗ | 17758607 B · 252 ✗ | 17487791 B · 166 | 17758607 B · 252 ✗ | 66404346 B · — ? | 70664924 B · 73.2 ? |
| every slice, exact | 81291194 B · 486 ✗ | 73605279 B · 359 ✗ | 73334463 B · 274 ✗ | 88423531 B · 324 ✗ | 66404346 B · — | 70664924 B · 73.2 ? |
| jump, preview | 28584 B · 5.77 ✗ | 19014 B · 5.15 ? | 1118983 B · 10.4 ✗ | 19014 B · 5.15 ? | 1934 B · — | 1026553 B · 1.02 ? |
| jump, visually lossless | 1731622 B · 24.5 ✗ | 1137998 B · 15.9 ✗ | 1118983 B · 10.4 ✗ | 1137998 B · 15.9 ✗ | 3310825 B · — ? | 1026553 B · 1.02 |
| jump, exact | 2521714 B · 26.1 ✗ | 1949439 B · 17.4 ✗ | 1930425 B · 12.1 ✗ | 2164550 B · 16.9 ✗ | 3310825 B · — ? | 1026553 B · 1.02 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 20, two 20, one 20, sep 20, svc 0, htj2k 20

*Reported:* in-window PSNR, aomenc · quality layers: preview 43.18 · 43.25 dB, visually lossless 54.28 · 54.95 dB (quantizers [25, 2])

*Reported:* per frame, median over rounds: snr preview frame 1.22; snr VL frame 4.12; snr residual decode 1.04; snr add 0.408; two preview frame 1.18; two VL frame 2.32; two residual decode 1.12; two add 0.389

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
| first picture | 11470 B · 2.06 ✗ | 7884 B · 2 ✗ | 95877 B · 1.99 ✗ | 7884 B · 2 ✗ | 1162 B · 0.275 | 1094218 B · 1.27 ✗ |
| every slice, preview | 400064 B · 116 ✗ | 270816 B · 107 ✗ | 6236705 B · 161 ✗ | 270816 B · 107 ✗ | 23641 B · 6.79 | 70664924 B · 73.4 ✗ |
| every slice, visually lossless | 8029065 B · 398 ✗ | 6507521 B · 268 ✗ | 6236705 B · 161 | 6507521 B · 268 ✗ | 66404346 B · 582 ✗ | 70664924 B · 73.4 |
| every slice, exact | 73324673 B · 503 ✗ | 72158819 B · 377 ✗ | 71888003 B · 269 ✗ | 77172445 B · 342 ✗ | 66404346 B · 582 | 70664924 B · 73.4 |
| jump, preview | 28509 B · 6.88 ✗ | 19014 B · 6.97 ✗ | 399408 B · 10.4 ✗ | 19014 B · 6.97 ✗ | 1934 B · 0.511 | 1026553 B · 1.03 ✗ |
| jump, visually lossless | 518475 B · 24.3 ✗ | 418422 B · 17.1 ✗ | 399408 B · 10.4 | 418422 B · 17.1 ✗ | 3310825 B · 25.8 ✗ | 1026553 B · 1.03 |
| jump, exact | 1467080 B · 26.1 ✗ | 1372190 B · 19 ✗ | 1353176 B · 12 ✗ | 1444975 B · 18.2 ✗ | 3310825 B · 25.8 ✗ | 1026553 B · 1.03 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 20, two 20, one 20, sep 20, svc 20, htj2k 20

*Reported:* in-window PSNR, aomenc · quality layers: preview 43.18 · 43.25 dB, visually lossless 48.04 · 48.33 dB (quantizers [25, 7])

*Reported:* per frame, median over rounds: snr preview frame 1.56; snr VL frame 3.79; snr residual decode 1.14; snr add 0.351; two preview frame 1.5; two VL frame 2.23; two residual decode 1.13; two add 0.358

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
| first picture | 10322 B · 1.59 ✗ | 7884 B · 1.68 ? | 264686 B · 2.45 ✗ | 7884 B · 1.68 ? | 1162 B · — | 1094218 B · 1.03 ? |
| every slice, preview | 333671 B · 86.7 ✗ | 257360 B · 83.3 ? | 17483081 B · 165 ✗ | 257360 B · 83.3 ? | 19737 B · — | 70664924 B · 73.1 ? |
| every slice, visually lossless | 26801786 B · 389 ✗ | 17740441 B · 245 ✗ | 17483081 B · 165 | 17740441 B · 245 ✗ | 66118979 B · — ? | 70664924 B · 73.1 ? |
| every slice, exact | 81209936 B · 492 ✗ | 73675262 B · 346 ✗ | 73417902 B · 270 ✗ | 88405365 B · 320 ✗ | 66118979 B · — | 70664924 B · 73.1 ? |
| jump, preview | 42425 B · 8.43 ✗ | 32255 B · 7.87 ? | 2089987 B · 15.6 ✗ | 32255 B · 7.87 ? | 2738 B · — | 1026553 B · 1.05 ? |
| jump, visually lossless | 3216703 B · 35.7 ✗ | 2122242 B · 23.8 ✗ | 2089987 B · 15.6 ✗ | 2122242 B · 23.8 ✗ | 5882841 B · — ? | 1026553 B · 1.05 |
| jump, exact | 4007163 B · 37.3 ✗ | 2934980 B · 25.3 ✗ | 2902725 B · 17.1 ✗ | 3148795 B · 24.8 ✗ | 5882841 B · — ? | 1026553 B · 1.05 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 20, two 20, one 20, sep 20, svc 0, htj2k 20

*Reported:* in-window PSNR, aomenc · quality layers: preview 43.18 · 43.11 dB, visually lossless 54.27 · 54.93 dB (quantizers [26, 2])

*Reported:* per frame, median over rounds: snr preview frame 1.19; snr VL frame 4.28; snr residual decode 1.02; snr add 0.403; two preview frame 1.16; two VL frame 2.31; two residual decode 1.12; two add 0.398

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
| first picture | 11470 B · 2.18 ✗ | 7884 B · 2.17 ✗ | 95877 B · 2.01 ✗ | 7884 B · 2.17 ✗ | 1162 B · 0.332 | 1094218 B · 1.25 ✗ |
| every slice, preview | 374134 B · 108 ✗ | 257360 B · 101 ✗ | 6229812 B · 157 ✗ | 257360 B · 101 ✗ | 19737 B · 6.44 | 70664924 B · 74.9 ✗ |
| every slice, visually lossless | 7980697 B · 381 ✗ | 6487172 B · 257 ✗ | 6229812 B · 157 | 6487172 B · 257 ✗ | 66118979 B · 566 ✗ | 70664924 B · 74.9 |
| every slice, exact | 73300617 B · 481 ✗ | 72225283 B · 362 ✗ | 71967923 B · 261 ✗ | 77152096 B · 334 ✗ | 66118979 B · 566 | 70664924 B · 74.9 |
| jump, preview | 47470 B · 11.2 ✗ | 32255 B · 10.6 ✗ | 744037 B · 15.7 ✗ | 32255 B · 10.6 ✗ | 2738 B · 0.715 | 1026553 B · 1.07 ✗ |
| jump, visually lossless | 956922 B · 39.1 ✗ | 776292 B · 26 ✗ | 744037 B · 15.7 | 776292 B · 26 ✗ | 5882841 B · 37.6 ✗ | 1026553 B · 1.07 |
| jump, exact | 1905884 B · 40.5 ✗ | 1731324 B · 27.6 ✗ | 1699069 B · 17.3 ✗ | 1802845 B · 27.1 ✗ | 5882841 B · 37.6 ✗ | 1026553 B · 1.07 |

bytes · median time ÷ the block's HTJ2K frame; ✗ dominated, ? not read, n per carrier snr 20, two 20, one 20, sep 20, svc 20, htj2k 20

*Reported:* in-window PSNR, aomenc · quality layers: preview 43.18 · 43.24 dB, visually lossless 48.04 · 48.33 dB (quantizers [25, 7])

*Reported:* per frame, median over rounds: snr preview frame 1.45; snr VL frame 3.71; snr residual decode 1.08; snr add 0.334; two preview frame 1.39; two VL frame 2.14; two residual decode 1.08; two add 0.339

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
| snr | svc | 16 | 8 | a trade | worse | a trade | differs |
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
