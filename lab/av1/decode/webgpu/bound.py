"""The share of an HTJ2K frame a WebGPU block decoder could take, per series: docs/decode/README.md
§A WebGPU block decoder, bounded. Inputs are the HTJ2K decode profile, this folder's transfer run and the
ICIP 2019 GPU decoder's lossless kernel times; nothing is measured here."""

# ns a sample on the 384-core card, lossless 4K 4:4:4 12-bit (24.88 M samples): block kernels, wavelet + colour
BLOCK_NS, WAVELET_NS = (4.43 + 4.88) / 24.88, 6.15 / 24.88
KCUPS1_MS, KCUPS2_NS = 4.43, 4.88 / 24.88

# ms a sample, decode + copy out, from the projections' profile: the frames not profiled scale from it
PROJ_1X = (46.3 + 5.6) / 4.923
PROJ_4X = 204 / 0.89 / 4.923

# series, M samples, frame ms 1×, frame ms 4×, share leaving the CPU, WebGPU − heap transfer ms 1×, 4×
SERIES = [
    ("tomosynthesis 614×1359", 0.834, 6.4, 25.1 / 0.86, 0.81, 3.2, 10.75),
    ("dbt12_c 931×2124 *", 1.977, PROJ_1X * 1.977, PROJ_4X * 1.977, 0.85, 3.75, 9.5),
    ("projections 1914×2572", 4.923, 51.9, 204 / 0.89, 0.85, 5.9, 29.05),
    ("syn2d_d 2394×2850 *", 6.823, PROJ_1X * 6.823, PROJ_4X * 6.823, 0.85, 8.45, 37.45),
    ("ffdm_d 3328×4096 *", 13.63, PROJ_1X * 13.63, PROJ_4X * 13.63, 0.85, 15.65, 76.65),
    ("MR 512² (control)", 0.262, 2.9, 11.7 / 0.9, 0.86, 2.75, 6.8),
]

print("series | frame ms 1× / 4× | GPU ms throughput / floor | % saved 1× ideal/throughput/floor | 4×")
for name, ms, f1, f4, share, dt1, dt4 in SERIES:
    throughput = ms * (BLOCK_NS + WAVELET_NS)
    floor = KCUPS1_MS + ms * (KCUPS2_NS + WAVELET_NS)
    cells = ["/".join(f"{100 * (share * f - gpu - dt) / f:.0f}" for gpu in (0, throughput, floor)) for f, dt in ((f1, dt1), (f4, dt4))]
    print(f"{name} | {f1:.1f} / {f4:.0f} | {throughput:.1f} / {floor:.1f} | {cells[0]} | {cells[1]}")
