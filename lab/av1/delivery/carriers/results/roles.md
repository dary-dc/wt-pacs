rounds 10; throttles [1, 4]; VOID cells 1

## dbts_a1: 56 × 1142×1785, 12-bit; HTJ2K 67812443 B

| quantity | layered | separate | lower |
| --- | --- | --- | --- |
| cheap view bytes (base · Q 56) | 14985 | 11272 | separate |
| high view m10 bytes; separate at its PSNR 48.46 dB | 2779497 | 1.65e+06 | separate |
| high view m20 bytes; separate at its PSNR 46.33 dB | 505513 | 3.24e+05 | separate |
| high view m30 bytes; separate at its PSNR 45.31 dB | 220298 | 1.14e+05 | separate |
| ask bytes, mean ÷ a shipped frame (three-full-m20 · residual) | 3.490 | 1.082 | separate |
| ask bytes, mean ÷ a shipped frame (three-full-m20-k1 · residual) | 1.027 | 1.082 | layered |
| storage ÷ HTJ2K (layered · by residual) | 0.9398 | 1.0036 | layered |
| storage ÷ HTJ2K (layered · by whole frame) | 0.9398 | 1.0076 | layered |

### dbts_a1, 1×

| role · metric | layered | separate | median sep ÷ layered | decided |
| --- | --- | --- | --- | --- |
| exact ask · svc vs res | 707 ms | 33.3 ms | 0.0474 | separate |
| exact ask · svc1 vs res | 224 ms | 33.3 ms | 0.151 | separate |
| exact ask · svc vs htj2k | 707 ms | 19.8 ms | 0.0288 | separate |
| exact ask · svc1 vs htj2k | 224 ms | 19.8 ms | 0.0881 | separate |
| cheap view · base vs sep-q56: decode a frame | 1.56 ms | 15.4 ms | 9.78 | layered |
| cheap view · base vs sep-q56: decode in total | 109 ms | 973 ms | 9.18 | layered |
| cheap view · base vs sep-q56: first picture, 5 Mbit/s | 45.4 ms | 93 ms | 1.99 | layered |
| cheap view · base vs sep-q56: every slice, 5 Mbit/s | 150 ms | 1.01e+03 ms | 6.85 | layered |
| cheap view · base vs sep-q56: first picture, 20 Mbit/s | 44.4 ms | 92.1 ms | 2.02 | layered |
| cheap view · base vs sep-q56: every slice, 20 Mbit/s | 149 ms | 1.01e+03 ms | 6.89 | layered |
| cheap view · base vs sep-q56: first picture, 50 Mbit/s | 44.2 ms | 91.9 ms | 2.02 | layered |
| cheap view · base vs sep-q56: every slice, 50 Mbit/s | 149 ms | 1.01e+03 ms | 6.9 | layered |
| high view · mid-m10 vs sep-q8: decode a frame | 42.2 ms | 45.5 ms | 1.08 | not resolved |
| high view · mid-m10 vs sep-q8: decode in total | 2.39e+03 ms | 2.57e+03 ms | 1.06 | not resolved |
| high view · mid-m10 vs sep-q8: first picture, 5 Mbit/s | 190 ms | 214 ms | 1.13 | not resolved |
| high view · mid-m10 vs sep-q8: every slice, 5 Mbit/s | 4.52e+03 ms | 7.5e+03 ms | 1.66 | layered |
| high view · mid-m10 vs sep-q8: first picture, 20 Mbit/s | 114 ms | 113 ms | 1 | not resolved |
| high view · mid-m10 vs sep-q8: every slice, 20 Mbit/s | 2.45e+03 ms | 2.65e+03 ms | 1.06 | not resolved |
| high view · mid-m10 vs sep-q8: first picture, 50 Mbit/s | 98.9 ms | 92.7 ms | 0.951 | not resolved |
| high view · mid-m10 vs sep-q8: every slice, 50 Mbit/s | 2.44e+03 ms | 2.63e+03 ms | 1.06 | not resolved |
| high view · mid-m20 vs sep-q16: decode a frame | 32.1 ms | 39.6 ms | 1.23 | not resolved |
| high view · mid-m20 vs sep-q16: decode in total | 1.83e+03 ms | 2.26e+03 ms | 1.22 | not resolved |
| high view · mid-m20 vs sep-q16: first picture, 5 Mbit/s | 107 ms | 99.4 ms | 0.938 | not resolved |
| high view · mid-m20 vs sep-q16: every slice, 5 Mbit/s | 1.89e+03 ms | 2.32e+03 ms | 1.21 | not resolved |
| high view · mid-m20 vs sep-q16: first picture, 20 Mbit/s | 88.5 ms | 84 ms | 0.96 | not resolved |
| high view · mid-m20 vs sep-q16: every slice, 20 Mbit/s | 1.88e+03 ms | 2.3e+03 ms | 1.21 | not resolved |
| high view · mid-m20 vs sep-q16: first picture, 50 Mbit/s | 84.8 ms | 80.9 ms | 0.966 | not resolved |
| high view · mid-m20 vs sep-q16: every slice, 50 Mbit/s | 1.87e+03 ms | 2.3e+03 ms | 1.21 | not resolved |
| high view · mid-m30 vs sep-q32: decode a frame | 28.9 ms | 33.7 ms | 1.17 | not resolved |
| high view · mid-m30 vs sep-q32: decode in total | 1.69e+03 ms | 1.97e+03 ms | 1.13 | not resolved |
| high view · mid-m30 vs sep-q32: first picture, 5 Mbit/s | 94.4 ms | 104 ms | 1.04 | not resolved |
| high view · mid-m30 vs sep-q32: every slice, 5 Mbit/s | 1.74e+03 ms | 2.01e+03 ms | 1.13 | not resolved |
| high view · mid-m30 vs sep-q32: first picture, 20 Mbit/s | 84.8 ms | 99.8 ms | 1.12 | not resolved |
| high view · mid-m30 vs sep-q32: every slice, 20 Mbit/s | 1.73e+03 ms | 2.01e+03 ms | 1.13 | not resolved |
| high view · mid-m30 vs sep-q32: first picture, 50 Mbit/s | 82.9 ms | 99 ms | 1.13 | not resolved |
| high view · mid-m30 vs sep-q32: every slice, 50 Mbit/s | 1.73e+03 ms | 2.01e+03 ms | 1.13 | not resolved |
| cheap view · base vs wc-q56: decode a frame | 1.56 ms | 10.5 ms | 6.78 | layered |
| cheap view · base vs wc-q56: decode in total | 109 ms | 613 ms | 5.74 | layered |
| cheap view · base vs wc-q56: first picture, 5 Mbit/s | 45.4 ms | 56.4 ms | 1.21 | not resolved |
| cheap view · base vs wc-q56: every slice, 5 Mbit/s | 150 ms | 654 ms | 4.43 | layered |
| cheap view · base vs wc-q56: first picture, 20 Mbit/s | 44.4 ms | 55.5 ms | 1.22 | not resolved |
| cheap view · base vs wc-q56: every slice, 20 Mbit/s | 149 ms | 653 ms | 4.45 | layered |
| cheap view · base vs wc-q56: first picture, 50 Mbit/s | 44.2 ms | 55.3 ms | 1.22 | not resolved |
| cheap view · base vs wc-q56: every slice, 50 Mbit/s | 149 ms | 653 ms | 4.46 | layered |
| high view · mid-m20 vs wc-q16: decode a frame | 32.1 ms | 14.4 ms | 0.443 | separate |
| high view · mid-m20 vs wc-q16: decode in total | 1.83e+03 ms | 818 ms | 0.445 | separate |
| high view · mid-m20 vs wc-q16: first picture, 5 Mbit/s | 107 ms | 79.1 ms | 0.734 | separate |
| high view · mid-m20 vs wc-q16: every slice, 5 Mbit/s | 1.89e+03 ms | 898 ms | 0.472 | separate |
| high view · mid-m20 vs wc-q16: first picture, 20 Mbit/s | 88.5 ms | 63.6 ms | 0.712 | separate |
| high view · mid-m20 vs wc-q16: every slice, 20 Mbit/s | 1.88e+03 ms | 863 ms | 0.458 | separate |
| high view · mid-m20 vs wc-q16: first picture, 50 Mbit/s | 84.8 ms | 60.5 ms | 0.707 | separate |
| high view · mid-m20 vs wc-q16: every slice, 50 Mbit/s | 1.87e+03 ms | 860 ms | 0.458 | separate |

* **exact ask**, times alone: separate better
* **cheap view**, times alone: layered better
* **high view**, times alone: a trade
* order effect base: 37.8%, not read
* order effect htj2k: 63.2%, not read
* order effect htj2k-aa: 38.4%, not read
* order effect mid-m20: 20.8%, not read
* order effect mid-m30: 14.6%, not read
* order effect mid1-m20: 14.6%, not read
* order effect res: 17.4%, not read
* order effect sep-q32: 15.3%, not read
* order effect sep-q56: 14.8%, not read
* order effect sep-q8: 15.7%, not read
* order effect svc: 10.5%, not read

### dbts_a1, 4×

| role · metric | layered | separate | median sep ÷ layered | decided |
| --- | --- | --- | --- | --- |
| exact ask · svc vs res | 2.97e+03 ms | 151 ms | 0.0506 | separate |
| exact ask · svc1 vs res | 959 ms | 151 ms | 0.158 | separate |
| exact ask · svc vs htj2k | 2.97e+03 ms | 97.3 ms | 0.0322 | separate |
| exact ask · svc1 vs htj2k | 959 ms | 97.3 ms | 0.102 | separate |
| cheap view · base vs sep-q56: decode a frame | 7.53 ms | 71.8 ms | 9.8 | layered |
| cheap view · base vs sep-q56: decode in total | 505 ms | 4.55e+03 ms | 9.26 | layered |
| cheap view · base vs sep-q56: first picture, 5 Mbit/s | 61.1 ms | 257 ms | 4.11 | layered |
| cheap view · base vs sep-q56: every slice, 5 Mbit/s | 547 ms | 4.59e+03 ms | 8.64 | layered |
| cheap view · base vs sep-q56: first picture, 20 Mbit/s | 60.1 ms | 256 ms | 4.16 | layered |
| cheap view · base vs sep-q56: every slice, 20 Mbit/s | 546 ms | 4.59e+03 ms | 8.66 | layered |
| cheap view · base vs sep-q56: first picture, 50 Mbit/s | 59.9 ms | 256 ms | 4.17 | layered |
| cheap view · base vs sep-q56: every slice, 50 Mbit/s | 545 ms | 4.59e+03 ms | 8.66 | layered |
| high view · mid-m10 vs sep-q8: decode a frame | 190 ms | 203 ms | 1.07 | not resolved |
| high view · mid-m10 vs sep-q8: decode in total | 1.1e+04 ms | 1.15e+04 ms | 1.05 | not resolved |
| high view · mid-m10 vs sep-q8: first picture, 5 Mbit/s | 371 ms | 361 ms | 0.971 | not resolved |
| high view · mid-m10 vs sep-q8: every slice, 5 Mbit/s | 1.11e+04 ms | 1.17e+04 ms | 1.06 | not resolved |
| high view · mid-m10 vs sep-q8: first picture, 20 Mbit/s | 294 ms | 259 ms | 0.876 | not resolved |
| high view · mid-m10 vs sep-q8: every slice, 20 Mbit/s | 1.11e+04 ms | 1.16e+04 ms | 1.05 | not resolved |
| high view · mid-m10 vs sep-q8: first picture, 50 Mbit/s | 279 ms | 239 ms | 0.851 | not resolved |
| high view · mid-m10 vs sep-q8: every slice, 50 Mbit/s | 1.1e+04 ms | 1.16e+04 ms | 1.05 | not resolved |
| high view · mid-m20 vs sep-q16: decode a frame | 147 ms | 177 ms | 1.2 | not resolved |
| high view · mid-m20 vs sep-q16: decode in total | 8.46e+03 ms | 1.01e+04 ms | 1.2 | not resolved |
| high view · mid-m20 vs sep-q16: first picture, 5 Mbit/s | 244 ms | 227 ms | 0.924 | not resolved |
| high view · mid-m20 vs sep-q16: every slice, 5 Mbit/s | 8.52e+03 ms | 1.02e+04 ms | 1.19 | not resolved |
| high view · mid-m20 vs sep-q16: first picture, 20 Mbit/s | 226 ms | 211 ms | 0.931 | not resolved |
| high view · mid-m20 vs sep-q16: every slice, 20 Mbit/s | 8.5e+03 ms | 1.02e+04 ms | 1.19 | not resolved |
| high view · mid-m20 vs sep-q16: first picture, 50 Mbit/s | 222 ms | 208 ms | 0.932 | not resolved |
| high view · mid-m20 vs sep-q16: every slice, 50 Mbit/s | 8.5e+03 ms | 1.02e+04 ms | 1.19 | not resolved |
| high view · mid-m30 vs sep-q32: decode a frame | 130 ms | 156 ms | 1.21 | not resolved |
| high view · mid-m30 vs sep-q32: decode in total | 7.53e+03 ms | 9.13e+03 ms | 1.19 | not resolved |
| high view · mid-m30 vs sep-q32: first picture, 5 Mbit/s | 231 ms | 306 ms | 1.35 | layered |
| high view · mid-m30 vs sep-q32: every slice, 5 Mbit/s | 7.58e+03 ms | 9.18e+03 ms | 1.19 | not resolved |
| high view · mid-m30 vs sep-q32: first picture, 20 Mbit/s | 221 ms | 302 ms | 1.39 | layered |
| high view · mid-m30 vs sep-q32: every slice, 20 Mbit/s | 7.57e+03 ms | 9.17e+03 ms | 1.19 | not resolved |
| high view · mid-m30 vs sep-q32: first picture, 50 Mbit/s | 219 ms | 301 ms | 1.4 | layered |
| high view · mid-m30 vs sep-q32: every slice, 50 Mbit/s | 7.57e+03 ms | 9.17e+03 ms | 1.19 | not resolved |
| cheap view · base vs wc-q56: decode a frame | 7.53 ms | 32 ms | 4.1 | layered |
| cheap view · base vs wc-q56: decode in total | 505 ms | 1.92e+03 ms | 3.78 | layered |
| cheap view · base vs wc-q56: first picture, 5 Mbit/s | 61.1 ms | 93.7 ms | 1.48 | layered |
| cheap view · base vs wc-q56: every slice, 5 Mbit/s | 547 ms | 1.96e+03 ms | 3.57 | layered |
| cheap view · base vs wc-q56: first picture, 20 Mbit/s | 60.1 ms | 92.8 ms | 1.49 | layered |
| cheap view · base vs wc-q56: every slice, 20 Mbit/s | 546 ms | 1.96e+03 ms | 3.58 | layered |
| cheap view · base vs wc-q56: first picture, 50 Mbit/s | 59.9 ms | 92.6 ms | 1.49 | layered |
| cheap view · base vs wc-q56: every slice, 50 Mbit/s | 545 ms | 1.96e+03 ms | 3.58 | layered |
| high view · mid-m20 vs wc-q16: decode a frame | 147 ms | 34.1 ms | 0.222 | separate |
| high view · mid-m20 vs wc-q16: decode in total | 8.46e+03 ms | 2.04e+03 ms | 0.24 | separate |
| high view · mid-m20 vs wc-q16: first picture, 5 Mbit/s | 244 ms | 113 ms | 0.454 | separate |
| high view · mid-m20 vs wc-q16: every slice, 5 Mbit/s | 8.52e+03 ms | 2.1e+03 ms | 0.246 | separate |
| high view · mid-m20 vs wc-q16: first picture, 20 Mbit/s | 226 ms | 97.2 ms | 0.426 | separate |
| high view · mid-m20 vs wc-q16: every slice, 20 Mbit/s | 8.5e+03 ms | 2.08e+03 ms | 0.244 | separate |
| high view · mid-m20 vs wc-q16: first picture, 50 Mbit/s | 222 ms | 94.1 ms | 0.419 | separate |
| high view · mid-m20 vs wc-q16: every slice, 50 Mbit/s | 8.5e+03 ms | 2.08e+03 ms | 0.244 | separate |

* **exact ask**, times alone: separate better
* **cheap view**, times alone: layered better
* **high view**, times alone: a trade
* order effect base: 26.4%, not read
* order effect htj2k: 11.5%, not read
* order effect htj2k-aa: 18.4%, not read
* order effect mid-m20: 11.1%, not read
* order effect wc-q16: 48.9%, not read

## dbts_b1: 50 × 2560×3328, 10-bit; HTJ2K 107407602 B

| quantity | layered | separate | lower |
| --- | --- | --- | --- |
| cheap view bytes (base · Q 56) | 41497 | 37079 | separate |
| high view m10 bytes; separate at its PSNR 49.23 dB | 14821575 | 9.91e+06 | separate |
| high view m20 bytes; separate at its PSNR 45.84 dB | 3540776 | 2.34e+06 | separate |
| high view m30 bytes; separate at its PSNR 44.20 dB | 1141683 | 6.45e+05 | separate |
| ask bytes, mean ÷ a shipped frame (three-full-m20 · residual) | 4.461 | 1.035 | separate |
| ask bytes, mean ÷ a shipped frame (three-full-m20-k1 · residual) | 0.996 | 1.035 | layered |
| storage ÷ HTJ2K (layered · by residual) | 0.9470 | 1.0011 | layered |
| storage ÷ HTJ2K (layered · by whole frame) | 0.9470 | 1.0433 | layered |

### dbts_b1, 1×

| role · metric | layered | separate | median sep ÷ layered | decided |
| --- | --- | --- | --- | --- |
| exact ask · svc vs res | 1.49e+03 ms | 123 ms | 0.083 | separate |
| exact ask · svc1 vs res | 407 ms | 123 ms | 0.302 | separate |
| exact ask · svc vs htj2k | 1.49e+03 ms | 64.9 ms | 0.0437 | separate |
| exact ask · svc1 vs htj2k | 407 ms | 64.9 ms | 0.163 | separate |
| cheap view · base vs sep-q56: decode a frame | 4.27 ms | 51.8 ms | 12.2 | layered |
| cheap view · base vs sep-q56: decode in total | 236 ms | 3.07e+03 ms | 13.3 | layered |
| cheap view · base vs sep-q56: first picture, 5 Mbit/s | 52.8 ms | 227 ms | 4.3 | layered |
| cheap view · base vs sep-q56: every slice, 5 Mbit/s | 280 ms | 3.11e+03 ms | 11.3 | layered |
| cheap view · base vs sep-q56: first picture, 20 Mbit/s | 49.8 ms | 224 ms | 4.5 | layered |
| cheap view · base vs sep-q56: every slice, 20 Mbit/s | 277 ms | 3.11e+03 ms | 11.4 | layered |
| cheap view · base vs sep-q56: first picture, 50 Mbit/s | 49.2 ms | 223 ms | 4.55 | layered |
| cheap view · base vs sep-q56: every slice, 50 Mbit/s | 276 ms | 3.11e+03 ms | 11.5 | layered |
| high view · mid-m10 vs sep-q8: decode a frame | 132 ms | 134 ms | 1.01 | not resolved |
| high view · mid-m10 vs sep-q8: decode in total | 6.88e+03 ms | 6.67e+03 ms | 0.99 | not resolved |
| high view · mid-m10 vs sep-q8: first picture, 5 Mbit/s | 774 ms | 917 ms | 1.19 | not resolved |
| high view · mid-m10 vs sep-q8: every slice, 5 Mbit/s | 2.39e+04 ms | 3.73e+04 ms | 1.56 | layered |
| high view · mid-m10 vs sep-q8: first picture, 20 Mbit/s | 354 ms | 356 ms | 1.01 | not resolved |
| high view · mid-m10 vs sep-q8: every slice, 20 Mbit/s | 7.06e+03 ms | 9.45e+03 ms | 1.34 | not resolved |
| high view · mid-m10 vs sep-q8: first picture, 50 Mbit/s | 270 ms | 244 ms | 0.907 | not resolved |
| high view · mid-m10 vs sep-q8: every slice, 50 Mbit/s | 6.97e+03 ms | 6.78e+03 ms | 0.993 | not resolved |
| high view · mid-m20 vs sep-q16: decode a frame | 92 ms | 126 ms | 1.36 | not resolved |
| high view · mid-m20 vs sep-q16: decode in total | 4.82e+03 ms | 6.34e+03 ms | 1.3 | not resolved |
| high view · mid-m20 vs sep-q16: first picture, 5 Mbit/s | 326 ms | 311 ms | 0.947 | not resolved |
| high view · mid-m20 vs sep-q16: every slice, 5 Mbit/s | 5.82e+03 ms | 7.55e+03 ms | 1.3 | not resolved |
| high view · mid-m20 vs sep-q16: first picture, 20 Mbit/s | 205 ms | 179 ms | 0.868 | not resolved |
| high view · mid-m20 vs sep-q16: every slice, 20 Mbit/s | 4.9e+03 ms | 6.42e+03 ms | 1.3 | not resolved |
| high view · mid-m20 vs sep-q16: first picture, 50 Mbit/s | 180 ms | 153 ms | 0.84 | separate |
| high view · mid-m20 vs sep-q16: every slice, 50 Mbit/s | 4.88e+03 ms | 6.4e+03 ms | 1.3 | not resolved |
| high view · mid-m30 vs sep-q32: decode a frame | 85.3 ms | 93.4 ms | 1.08 | not resolved |
| high view · mid-m30 vs sep-q32: decode in total | 4.43e+03 ms | 4.68e+03 ms | 1.05 | not resolved |
| high view · mid-m30 vs sep-q32: first picture, 5 Mbit/s | 220 ms | 191 ms | 0.874 | not resolved |
| high view · mid-m30 vs sep-q32: every slice, 5 Mbit/s | 4.53e+03 ms | 4.75e+03 ms | 1.05 | not resolved |
| high view · mid-m30 vs sep-q32: first picture, 20 Mbit/s | 172 ms | 164 ms | 0.952 | not resolved |
| high view · mid-m30 vs sep-q32: every slice, 20 Mbit/s | 4.49e+03 ms | 4.72e+03 ms | 1.05 | not resolved |
| high view · mid-m30 vs sep-q32: first picture, 50 Mbit/s | 163 ms | 159 ms | 0.973 | not resolved |
| high view · mid-m30 vs sep-q32: every slice, 50 Mbit/s | 4.48e+03 ms | 4.72e+03 ms | 1.05 | not resolved |
| cheap view · base vs wc-q56: decode a frame | 4.27 ms | 41 ms | 9.64 | layered |
| cheap view · base vs wc-q56: decode in total | 236 ms | 2.12e+03 ms | 8.76 | layered |
| cheap view · base vs wc-q56: first picture, 5 Mbit/s | 52.8 ms | 93.9 ms | 1.79 | layered |
| cheap view · base vs wc-q56: every slice, 5 Mbit/s | 280 ms | 2.16e+03 ms | 7.56 | layered |
| cheap view · base vs wc-q56: first picture, 20 Mbit/s | 49.8 ms | 91 ms | 1.84 | layered |
| cheap view · base vs wc-q56: every slice, 20 Mbit/s | 277 ms | 2.16e+03 ms | 7.63 | layered |
| cheap view · base vs wc-q56: first picture, 50 Mbit/s | 49.2 ms | 90.4 ms | 1.85 | layered |
| cheap view · base vs wc-q56: every slice, 50 Mbit/s | 276 ms | 2.16e+03 ms | 7.65 | layered |
| high view · mid-m20 vs wc-q16: decode a frame | 92 ms | 65.6 ms | 0.705 | separate |
| high view · mid-m20 vs wc-q16: decode in total | 4.82e+03 ms | 3.31e+03 ms | 0.685 | separate |
| high view · mid-m20 vs wc-q16: first picture, 5 Mbit/s | 326 ms | 289 ms | 0.892 | not resolved |
| high view · mid-m20 vs wc-q16: every slice, 5 Mbit/s | 5.82e+03 ms | 7.48e+03 ms | 1.29 | not resolved |
| high view · mid-m20 vs wc-q16: first picture, 20 Mbit/s | 205 ms | 158 ms | 0.779 | separate |
| high view · mid-m20 vs wc-q16: every slice, 20 Mbit/s | 4.9e+03 ms | 3.39e+03 ms | 0.69 | separate |
| high view · mid-m20 vs wc-q16: first picture, 50 Mbit/s | 180 ms | 131 ms | 0.738 | separate |
| high view · mid-m20 vs wc-q16: every slice, 50 Mbit/s | 4.88e+03 ms | 3.36e+03 ms | 0.688 | separate |

* **exact ask**, times alone: separate better
* **cheap view**, times alone: layered better
* **high view**, times alone: a trade
* order effect base: 10.8%, not read
* order effect htj2k: 17.5%, not read
* order effect htj2k-aa: 27.5%, not read
* order effect k2: 10.2%, not read
* order effect res: 14.9%, not read

### dbts_b1, 4×

| role · metric | layered | separate | median sep ÷ layered | decided |
| --- | --- | --- | --- | --- |
| exact ask · svc vs res | 6.67e+03 ms | 559 ms | 0.0836 | separate |
| exact ask · svc1 vs res | 1.83e+03 ms | 559 ms | 0.306 | separate |
| exact ask · svc vs htj2k | 6.67e+03 ms | 288 ms | 0.0422 | separate |
| exact ask · svc1 vs htj2k | 1.83e+03 ms | 288 ms | 0.155 | separate |
| cheap view · base vs sep-q56: decode a frame | 19.7 ms | 236 ms | 11.9 | layered |
| cheap view · base vs sep-q56: decode in total | 1.04e+03 ms | 1.38e+04 ms | 13 | layered |
| cheap view · base vs sep-q56: first picture, 5 Mbit/s | 78.1 ms | 859 ms | 10.7 | layered |
| cheap view · base vs sep-q56: every slice, 5 Mbit/s | 1.08e+03 ms | 1.38e+04 ms | 12.6 | layered |
| cheap view · base vs sep-q56: first picture, 20 Mbit/s | 75.1 ms | 856 ms | 11.1 | layered |
| cheap view · base vs sep-q56: every slice, 20 Mbit/s | 1.08e+03 ms | 1.38e+04 ms | 12.6 | layered |
| cheap view · base vs sep-q56: first picture, 50 Mbit/s | 74.5 ms | 855 ms | 11.2 | layered |
| cheap view · base vs sep-q56: every slice, 50 Mbit/s | 1.08e+03 ms | 1.38e+04 ms | 12.6 | layered |
| high view · mid-m10 vs sep-q8: decode a frame | 594 ms | 609 ms | 1.02 | not resolved |
| high view · mid-m10 vs sep-q8: decode in total | 3.1e+04 ms | 3.08e+04 ms | 0.988 | not resolved |
| high view · mid-m10 vs sep-q8: first picture, 5 Mbit/s | 1.4e+03 ms | 1.37e+03 ms | 0.982 | not resolved |
| high view · mid-m10 vs sep-q8: every slice, 5 Mbit/s | 3.16e+04 ms | 3.77e+04 ms | 1.2 | layered |
| high view · mid-m10 vs sep-q8: first picture, 20 Mbit/s | 976 ms | 810 ms | 0.829 | not resolved |
| high view · mid-m10 vs sep-q8: every slice, 20 Mbit/s | 3.11e+04 ms | 3.1e+04 ms | 0.989 | not resolved |
| high view · mid-m10 vs sep-q8: first picture, 50 Mbit/s | 892 ms | 697 ms | 0.781 | separate |
| high view · mid-m10 vs sep-q8: every slice, 50 Mbit/s | 3.11e+04 ms | 3.09e+04 ms | 0.988 | not resolved |
| high view · mid-m20 vs sep-q16: decode a frame | 431 ms | 572 ms | 1.33 | layered |
| high view · mid-m20 vs sep-q16: decode in total | 2.26e+04 ms | 2.85e+04 ms | 1.26 | layered |
| high view · mid-m20 vs sep-q16: first picture, 5 Mbit/s | 811 ms | 634 ms | 0.801 | separate |
| high view · mid-m20 vs sep-q16: every slice, 5 Mbit/s | 2.28e+04 ms | 2.87e+04 ms | 1.26 | layered |
| high view · mid-m20 vs sep-q16: first picture, 20 Mbit/s | 690 ms | 503 ms | 0.749 | separate |
| high view · mid-m20 vs sep-q16: every slice, 20 Mbit/s | 2.27e+04 ms | 2.86e+04 ms | 1.26 | layered |
| high view · mid-m20 vs sep-q16: first picture, 50 Mbit/s | 665 ms | 477 ms | 0.736 | separate |
| high view · mid-m20 vs sep-q16: every slice, 50 Mbit/s | 2.27e+04 ms | 2.85e+04 ms | 1.26 | layered |
| high view · mid-m30 vs sep-q32: decode a frame | 394 ms | 428 ms | 1.09 | not resolved |
| high view · mid-m30 vs sep-q32: decode in total | 2.01e+04 ms | 2.17e+04 ms | 1.08 | not resolved |
| high view · mid-m30 vs sep-q32: first picture, 5 Mbit/s | 597 ms | 590 ms | 1.03 | not resolved |
| high view · mid-m30 vs sep-q32: every slice, 5 Mbit/s | 2.02e+04 ms | 2.17e+04 ms | 1.08 | not resolved |
| high view · mid-m30 vs sep-q32: first picture, 20 Mbit/s | 549 ms | 563 ms | 1.07 | not resolved |
| high view · mid-m30 vs sep-q32: every slice, 20 Mbit/s | 2.02e+04 ms | 2.17e+04 ms | 1.08 | not resolved |
| high view · mid-m30 vs sep-q32: first picture, 50 Mbit/s | 539 ms | 558 ms | 1.08 | not resolved |
| high view · mid-m30 vs sep-q32: every slice, 50 Mbit/s | 2.02e+04 ms | 2.17e+04 ms | 1.08 | not resolved |
| cheap view · base vs wc-q56: decode a frame | 19.7 ms | 127 ms | 6.55 | layered |
| cheap view · base vs wc-q56: decode in total | 1.04e+03 ms | 6.46e+03 ms | 6.26 | layered |
| cheap view · base vs wc-q56: first picture, 5 Mbit/s | 78.1 ms | 222 ms | 2.74 | layered |
| cheap view · base vs wc-q56: every slice, 5 Mbit/s | 1.08e+03 ms | 6.51e+03 ms | 6.05 | layered |
| cheap view · base vs wc-q56: first picture, 20 Mbit/s | 75.1 ms | 219 ms | 2.82 | layered |
| cheap view · base vs wc-q56: every slice, 20 Mbit/s | 1.08e+03 ms | 6.5e+03 ms | 6.07 | layered |
| cheap view · base vs wc-q56: first picture, 50 Mbit/s | 74.5 ms | 218 ms | 2.83 | layered |
| cheap view · base vs wc-q56: every slice, 50 Mbit/s | 1.08e+03 ms | 6.5e+03 ms | 6.07 | layered |
| high view · mid-m20 vs wc-q16: decode a frame | 431 ms | 161 ms | 0.381 | separate |
| high view · mid-m20 vs wc-q16: decode in total | 2.26e+04 ms | 8.29e+03 ms | 0.367 | separate |
| high view · mid-m20 vs wc-q16: first picture, 5 Mbit/s | 811 ms | 399 ms | 0.492 | separate |
| high view · mid-m20 vs wc-q16: every slice, 5 Mbit/s | 2.28e+04 ms | 8.51e+03 ms | 0.373 | separate |
| high view · mid-m20 vs wc-q16: first picture, 20 Mbit/s | 690 ms | 268 ms | 0.387 | separate |
| high view · mid-m20 vs wc-q16: every slice, 20 Mbit/s | 2.27e+04 ms | 8.38e+03 ms | 0.369 | separate |
| high view · mid-m20 vs wc-q16: first picture, 50 Mbit/s | 665 ms | 241 ms | 0.361 | separate |
| high view · mid-m20 vs wc-q16: every slice, 50 Mbit/s | 2.27e+04 ms | 8.35e+03 ms | 0.369 | separate |

* **exact ask**, times alone: separate better
* **cheap view**, times alone: layered better
* **high view**, times alone: a trade
* order effect base: 18.8%, not read
* order effect htj2k: 20.4%, not read
* order effect htj2k-aa: 21.6%, not read
* order effect res: 12.0%, not read

## dbts_c1: 69 × 976×2513, 12-bit; HTJ2K 70664924 B

| quantity | layered | separate | lower |
| --- | --- | --- | --- |
| cheap view bytes (base · Q 56) | 23613 | 15640 | separate |
| high view m10 bytes; separate at its PSNR 49.59 dB | 3892018 | 2.38e+06 | separate |
| high view m20 bytes; separate at its PSNR 46.98 dB | 718273 | 4.48e+05 | separate |
| high view m30 bytes; separate at its PSNR 45.77 dB | 278039 | 1.24e+05 | separate |
| ask bytes, mean ÷ a shipped frame (three-full-m20 · residual) | 3.469 | 1.066 | separate |
| ask bytes, mean ÷ a shipped frame (three-full-m20-k1 · residual) | 1.016 | 1.066 | layered |
| storage ÷ HTJ2K (layered · by residual) | 0.9373 | 1.0022 | layered |
| storage ÷ HTJ2K (layered · by whole frame) | 0.9373 | 1.0117 | layered |

### dbts_c1, 1×

| role · metric | layered | separate | median sep ÷ layered | decided |
| --- | --- | --- | --- | --- |
| exact ask · svc vs res | 594 ms | 32 ms | 0.0529 | separate |
| exact ask · svc1 vs res | 207 ms | 32 ms | 0.151 | separate |
| exact ask · svc vs htj2k | 594 ms | 20.4 ms | 0.0337 | separate |
| exact ask · svc1 vs htj2k | 207 ms | 20.4 ms | 0.0962 | separate |
| cheap view · base vs sep-q56: decode a frame | 1.62 ms | 13.5 ms | 8.72 | layered |
| cheap view · base vs sep-q56: decode in total | 140 ms | 1.17e+03 ms | 8.28 | layered |
| cheap view · base vs sep-q56: first picture, 5 Mbit/s | 47 ms | 105 ms | 2.16 | layered |
| cheap view · base vs sep-q56: every slice, 5 Mbit/s | 182 ms | 1.21e+03 ms | 6.56 | layered |
| cheap view · base vs sep-q56: first picture, 20 Mbit/s | 45.6 ms | 103 ms | 2.2 | layered |
| cheap view · base vs sep-q56: every slice, 20 Mbit/s | 181 ms | 1.21e+03 ms | 6.61 | layered |
| cheap view · base vs sep-q56: first picture, 50 Mbit/s | 45.4 ms | 103 ms | 2.21 | layered |
| cheap view · base vs sep-q56: every slice, 50 Mbit/s | 180 ms | 1.21e+03 ms | 6.62 | layered |
| high view · mid-m10 vs sep-q8: decode a frame | 40.1 ms | 41.9 ms | 1.05 | not resolved |
| high view · mid-m10 vs sep-q8: decode in total | 2.91e+03 ms | 2.91e+03 ms | 0.999 | not resolved |
| high view · mid-m10 vs sep-q8: first picture, 5 Mbit/s | 221 ms | 238 ms | 1.09 | not resolved |
| high view · mid-m10 vs sep-q8: every slice, 5 Mbit/s | 6.3e+03 ms | 1e+04 ms | 1.59 | layered |
| high view · mid-m10 vs sep-q8: first picture, 20 Mbit/s | 132 ms | 123 ms | 0.959 | not resolved |
| high view · mid-m10 vs sep-q8: every slice, 20 Mbit/s | 2.98e+03 ms | 2.99e+03 ms | 1 | not resolved |
| high view · mid-m10 vs sep-q8: first picture, 50 Mbit/s | 114 ms | 99.5 ms | 0.906 | not resolved |
| high view · mid-m10 vs sep-q8: every slice, 50 Mbit/s | 2.96e+03 ms | 2.96e+03 ms | 1 | not resolved |
| high view · mid-m20 vs sep-q16: decode a frame | 29 ms | 35.9 ms | 1.24 | layered |
| high view · mid-m20 vs sep-q16: decode in total | 2.17e+03 ms | 2.6e+03 ms | 1.19 | not resolved |
| high view · mid-m20 vs sep-q16: first picture, 5 Mbit/s | 119 ms | 101 ms | 0.848 | not resolved |
| high view · mid-m20 vs sep-q16: every slice, 5 Mbit/s | 2.24e+03 ms | 2.67e+03 ms | 1.18 | not resolved |
| high view · mid-m20 vs sep-q16: first picture, 20 Mbit/s | 94.6 ms | 79 ms | 0.832 | not resolved |
| high view · mid-m20 vs sep-q16: every slice, 20 Mbit/s | 2.22e+03 ms | 2.64e+03 ms | 1.19 | not resolved |
| high view · mid-m20 vs sep-q16: first picture, 50 Mbit/s | 89.8 ms | 74.7 ms | 0.828 | not resolved |
| high view · mid-m20 vs sep-q16: every slice, 50 Mbit/s | 2.21e+03 ms | 2.64e+03 ms | 1.19 | not resolved |
| high view · mid-m30 vs sep-q32: decode a frame | 26.7 ms | 27.6 ms | 1.05 | not resolved |
| high view · mid-m30 vs sep-q32: decode in total | 1.97e+03 ms | 2.04e+03 ms | 1.04 | not resolved |
| high view · mid-m30 vs sep-q32: first picture, 5 Mbit/s | 99.9 ms | 112 ms | 1.13 | not resolved |
| high view · mid-m30 vs sep-q32: every slice, 5 Mbit/s | 2.02e+03 ms | 2.09e+03 ms | 1.03 | not resolved |
| high view · mid-m30 vs sep-q32: first picture, 20 Mbit/s | 88.3 ms | 107 ms | 1.22 | layered |
| high view · mid-m30 vs sep-q32: every slice, 20 Mbit/s | 2.01e+03 ms | 2.08e+03 ms | 1.03 | not resolved |
| high view · mid-m30 vs sep-q32: first picture, 50 Mbit/s | 86 ms | 106 ms | 1.24 | layered |
| high view · mid-m30 vs sep-q32: every slice, 50 Mbit/s | 2.01e+03 ms | 2.08e+03 ms | 1.03 | not resolved |
| cheap view · base vs wc-q56: decode a frame | 1.62 ms | 12.5 ms | 7.7 | layered |
| cheap view · base vs wc-q56: decode in total | 140 ms | 892 ms | 6.37 | layered |
| cheap view · base vs wc-q56: first picture, 5 Mbit/s | 47 ms | 59.8 ms | 1.25 | layered |
| cheap view · base vs wc-q56: every slice, 5 Mbit/s | 182 ms | 934 ms | 5.13 | layered |
| cheap view · base vs wc-q56: first picture, 20 Mbit/s | 45.6 ms | 58.6 ms | 1.26 | layered |
| cheap view · base vs wc-q56: every slice, 20 Mbit/s | 181 ms | 932 ms | 5.16 | layered |
| cheap view · base vs wc-q56: first picture, 50 Mbit/s | 45.4 ms | 58.3 ms | 1.26 | layered |
| cheap view · base vs wc-q56: every slice, 50 Mbit/s | 180 ms | 932 ms | 5.17 | layered |
| high view · mid-m20 vs wc-q16: decode a frame | 29 ms | 16.9 ms | 0.571 | separate |
| high view · mid-m20 vs wc-q16: decode in total | 2.17e+03 ms | 1.2e+03 ms | 0.56 | separate |
| high view · mid-m20 vs wc-q16: first picture, 5 Mbit/s | 119 ms | 92.1 ms | 0.769 | not resolved |
| high view · mid-m20 vs wc-q16: every slice, 5 Mbit/s | 2.24e+03 ms | 1.36e+03 ms | 0.62 | separate |
| high view · mid-m20 vs wc-q16: first picture, 20 Mbit/s | 94.6 ms | 70.2 ms | 0.732 | separate |
| high view · mid-m20 vs wc-q16: every slice, 20 Mbit/s | 2.22e+03 ms | 1.25e+03 ms | 0.569 | separate |
| high view · mid-m20 vs wc-q16: first picture, 50 Mbit/s | 89.8 ms | 65.8 ms | 0.723 | separate |
| high view · mid-m20 vs wc-q16: every slice, 50 Mbit/s | 2.21e+03 ms | 1.24e+03 ms | 0.569 | separate |

* **exact ask**, times alone: separate better
* **cheap view**, times alone: layered better
* **high view**, times alone: a trade
* order effect base: 49.8%, not read
* order effect htj2k: 18.2%, not read
* order effect htj2k-aa: 12.1%, not read
* order effect k2: 10.3%, not read
* order effect res: 21.2%, not read
* order effect sep-q16: 12.3%, not read
* order effect sep-q32: 14.8%, not read
* order effect sep-q56: 12.9%, not read
* order effect svc1: 15.6%, not read
* order effect wc-q16: 14.3%, not read

### dbts_c1, 4×

| role · metric | layered | separate | median sep ÷ layered | decided |
| --- | --- | --- | --- | --- |
| exact ask · svc vs res | 2.62e+03 ms | 158 ms | 0.0611 | separate |
| exact ask · svc1 vs res | 860 ms | 158 ms | 0.184 | separate |
| exact ask · svc vs htj2k | 2.62e+03 ms | 97.5 ms | 0.0383 | separate |
| exact ask · svc1 vs htj2k | 860 ms | 97.5 ms | 0.113 | separate |
| cheap view · base vs sep-q56: decode a frame | 7.98 ms | 63.7 ms | 7.73 | layered |
| cheap view · base vs sep-q56: decode in total | 592 ms | 5.25e+03 ms | 8.83 | layered |
| cheap view · base vs sep-q56: first picture, 5 Mbit/s | 65.9 ms | 312 ms | 4.97 | layered |
| cheap view · base vs sep-q56: every slice, 5 Mbit/s | 634 ms | 5.29e+03 ms | 8.32 | layered |
| cheap view · base vs sep-q56: first picture, 20 Mbit/s | 64.5 ms | 311 ms | 5.06 | layered |
| cheap view · base vs sep-q56: every slice, 20 Mbit/s | 633 ms | 5.29e+03 ms | 8.33 | layered |
| cheap view · base vs sep-q56: first picture, 50 Mbit/s | 64.2 ms | 311 ms | 5.08 | layered |
| cheap view · base vs sep-q56: every slice, 50 Mbit/s | 632 ms | 5.29e+03 ms | 8.34 | layered |
| high view · mid-m10 vs sep-q8: decode a frame | 185 ms | 184 ms | 1 | not resolved |
| high view · mid-m10 vs sep-q8: decode in total | 1.33e+04 ms | 1.29e+04 ms | 0.988 | not resolved |
| high view · mid-m10 vs sep-q8: first picture, 5 Mbit/s | 396 ms | 363 ms | 0.902 | not resolved |
| high view · mid-m10 vs sep-q8: every slice, 5 Mbit/s | 1.35e+04 ms | 1.31e+04 ms | 0.991 | not resolved |
| high view · mid-m10 vs sep-q8: first picture, 20 Mbit/s | 306 ms | 247 ms | 0.79 | separate |
| high view · mid-m10 vs sep-q8: every slice, 20 Mbit/s | 1.34e+04 ms | 1.3e+04 ms | 0.989 | not resolved |
| high view · mid-m10 vs sep-q8: first picture, 50 Mbit/s | 288 ms | 224 ms | 0.759 | separate |
| high view · mid-m10 vs sep-q8: every slice, 50 Mbit/s | 1.34e+04 ms | 1.3e+04 ms | 0.989 | not resolved |
| high view · mid-m20 vs sep-q16: decode a frame | 129 ms | 163 ms | 1.28 | layered |
| high view · mid-m20 vs sep-q16: decode in total | 9.59e+03 ms | 1.15e+04 ms | 1.18 | layered |
| high view · mid-m20 vs sep-q16: first picture, 5 Mbit/s | 273 ms | 211 ms | 0.751 | separate |
| high view · mid-m20 vs sep-q16: every slice, 5 Mbit/s | 9.66e+03 ms | 1.16e+04 ms | 1.18 | layered |
| high view · mid-m20 vs sep-q16: first picture, 20 Mbit/s | 249 ms | 189 ms | 0.736 | separate |
| high view · mid-m20 vs sep-q16: every slice, 20 Mbit/s | 9.64e+03 ms | 1.15e+04 ms | 1.18 | layered |
| high view · mid-m20 vs sep-q16: first picture, 50 Mbit/s | 244 ms | 185 ms | 0.732 | separate |
| high view · mid-m20 vs sep-q16: every slice, 50 Mbit/s | 9.64e+03 ms | 1.15e+04 ms | 1.18 | layered |
| high view · mid-m30 vs sep-q32: decode a frame | 117 ms | 126 ms | 1.07 | not resolved |
| high view · mid-m30 vs sep-q32: decode in total | 8.69e+03 ms | 9.2e+03 ms | 1.04 | not resolved |
| high view · mid-m30 vs sep-q32: first picture, 5 Mbit/s | 242 ms | 318 ms | 1.34 | layered |
| high view · mid-m30 vs sep-q32: every slice, 5 Mbit/s | 8.74e+03 ms | 9.25e+03 ms | 1.04 | not resolved |
| high view · mid-m30 vs sep-q32: first picture, 20 Mbit/s | 231 ms | 313 ms | 1.39 | layered |
| high view · mid-m30 vs sep-q32: every slice, 20 Mbit/s | 8.73e+03 ms | 9.25e+03 ms | 1.04 | not resolved |
| high view · mid-m30 vs sep-q32: first picture, 50 Mbit/s | 228 ms | 312 ms | 1.4 | layered |
| high view · mid-m30 vs sep-q32: every slice, 50 Mbit/s | 8.73e+03 ms | 9.24e+03 ms | 1.04 | not resolved |
| cheap view · base vs wc-q56: decode a frame | 7.98 ms | 36.8 ms | 4.54 | layered |
| cheap view · base vs wc-q56: decode in total | 592 ms | 2.77e+03 ms | 4.78 | layered |
| cheap view · base vs wc-q56: first picture, 5 Mbit/s | 65.9 ms | 102 ms | 1.59 | layered |
| cheap view · base vs wc-q56: every slice, 5 Mbit/s | 634 ms | 2.81e+03 ms | 4.53 | layered |
| cheap view · base vs wc-q56: first picture, 20 Mbit/s | 64.5 ms | 101 ms | 1.61 | layered |
| cheap view · base vs wc-q56: every slice, 20 Mbit/s | 633 ms | 2.81e+03 ms | 4.54 | layered |
| cheap view · base vs wc-q56: first picture, 50 Mbit/s | 64.2 ms | 100 ms | 1.61 | layered |
| cheap view · base vs wc-q56: every slice, 50 Mbit/s | 632 ms | 2.81e+03 ms | 4.54 | layered |
| high view · mid-m20 vs wc-q16: decode a frame | 129 ms | 40.6 ms | 0.312 | separate |
| high view · mid-m20 vs wc-q16: decode in total | 9.59e+03 ms | 2.99e+03 ms | 0.307 | separate |
| high view · mid-m20 vs wc-q16: first picture, 5 Mbit/s | 273 ms | 126 ms | 0.458 | separate |
| high view · mid-m20 vs wc-q16: every slice, 5 Mbit/s | 9.66e+03 ms | 3.06e+03 ms | 0.312 | separate |
| high view · mid-m20 vs wc-q16: first picture, 20 Mbit/s | 249 ms | 105 ms | 0.413 | separate |
| high view · mid-m20 vs wc-q16: every slice, 20 Mbit/s | 9.64e+03 ms | 3.03e+03 ms | 0.31 | separate |
| high view · mid-m20 vs wc-q16: first picture, 50 Mbit/s | 244 ms | 100 ms | 0.403 | separate |
| high view · mid-m20 vs wc-q16: every slice, 50 Mbit/s | 9.64e+03 ms | 3.03e+03 ms | 0.31 | separate |

* **exact ask**, times alone: separate better
* **cheap view**, times alone: layered better
* **high view**, times alone: a trade
* order effect base: 25.9%, not read
* order effect htj2k-aa: 23.8%, not read
* order effect k2: 14.0%, not read
* order effect mid-m10: 11.3%, not read
* order effect res: 25.3%, not read
* order effect svc: 13.9%, not read
* order effect wc-q16: 11.4%, not read

