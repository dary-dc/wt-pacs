#!/usr/bin/env python3
"""Per-frame container bytes for containers.md §3: inline framing plus index, as each spec or FFmpeg n7.1 writes it."""

MIB = 1 << 20
SIZES = [16_384, 250_000, 3_000_000, 27_000_000]  # bytes of one coded frame: containers.md §3 names each
FRAMES = 1_000
TICK_MS = 40  # a frame's duration where a container insists on time; Matroska's 1 ms tick (RFC 9559 §5.1.2.9)


def uint_len(v):
    return max(1, (v.bit_length() + 7) // 8)


def vint_len(n):
    """EBML data size: k octets hold 0 … 2^(7k) − 2 (RFC 8794 §6.1)."""
    return next(k for k in range(1, 9) if n <= (1 << (7 * k)) - 2)


def sbnd_v1(s):
    return 12


def sbnd_v2(s):
    return 28


def mp4_ffmpeg(s, n=FRAMES):
    per_chunk = max(1, -(-MIB // s) - 1)  # movenc.c:4899-4902: a sample joins while the chunk stays under 1 MiB
    offset = 8 if s * n > 0xFFFF_FFFF else 4  # movenc.c:163-168: co64 only past 4 GiB
    return 4 + offset / per_chunk


def mp4_one_per_chunk(s):
    return 12


def fmp4_dash(s, per_fragment=1, tfra=True):
    return 4 + 160 / per_fragment + (19 / per_fragment if tfra else 0)


def mkv_ffmpeg(s, n=FRAMES, crc=True):
    ts = uint_len(n * TICK_MS)
    block = 1 + vint_len(s + 4) + 4
    cluster_data = (6 if crc else 0) + 2 + ts + block + s
    cluster = 4 + vint_len(cluster_data) + (6 if crc else 0) + 2 + ts
    cue = 13 + ts + uint_len(s * n) + uint_len(cluster_data - block - s)
    return cluster + block + cue


def dicom_eot(s):
    return 8 + 16 + s % 2


def dicom_bot(s, n=FRAMES):
    return None if s * n > 0xFFFF_FFFF else 8 + 4 + s % 2  # 32-bit offsets (PS3.5 §A.4)


def mxf_minimal(s):
    return 16 + 4 + 11


def mxf_ffmpeg(s):
    pad = -(20 + s) % 512  # mxfenc.c:1955-1962: KLV fill to the 512-byte grid, a fill item no shorter than 20
    if 0 < pad < 20:
        pad += 512
    return 512 + 20 + pad + 15


def ivf_av1(s):
    return 12 + 2


ARMS = [
    (".sbnd today", sbnd_v1),
    (".sbnd draft (row 164)", sbnd_v2),
    ("MP4, FFmpeg's chunks", mp4_ffmpeg),
    ("MP4, one sample a chunk, co64", mp4_one_per_chunk),
    ("fragmented MP4, a frame a fragment", fmp4_dash),
    ("fragmented MP4, 30 frames a fragment", lambda s: fmp4_dash(s, 30)),
    ("Matroska, FFmpeg", mkv_ffmpeg),
    ("WebM, FFmpeg", lambda s: mkv_ffmpeg(s, crc=False)),
    ("DICOM, Extended Offset Table", dicom_eot),
    ("DICOM, Basic Offset Table", dicom_bot),
    ("MXF frame-wrapped, minimal", mxf_minimal),
    ("MXF frame-wrapped, FFmpeg OP1a", mxf_ffmpeg),
    ("IVF, AV1", ivf_av1),
]


def check():
    assert vint_len(16_382) == 2 and vint_len(16_383) == 3
    assert mkv_ffmpeg(16_379) == mkv_ffmpeg(16_378) + 1
    assert vint_len(10_244) == 2 and vint_len(307_204) == 3 and vint_len(31_457_284) == 4
    assert mkv_ffmpeg(10_240) == 42 and mkv_ffmpeg(307_200) == 45
    assert mkv_ffmpeg(10_240, crc=False) == 42 - 6
    assert mp4_ffmpeg(16_384) == 4 + 4 / 63 and mp4_ffmpeg(3_000_000) == 8 and mp4_ffmpeg(27_000_000) == 12
    assert fmp4_dash(1, tfra=False) == 164 and fmp4_dash(1) == 183
    assert mxf_ffmpeg(492) == 547 and mxf_ffmpeg(480) == 547 + 524 and mxf_ffmpeg(493) == 547 + 511
    assert mxf_ffmpeg(475) == 547 + 529
    assert ivf_av1(1) == 14 and mxf_minimal(1) == 31
    assert dicom_eot(10_000) == 24 and dicom_eot(10_001) == 25 and dicom_bot(10_001) == 13 and dicom_bot(4_294_968) is None


def fmt(x):
    if x is None:
        return "past 4 GiB"
    return f"{x:.0f}" if x == int(x) else f"{x:.2f}"


def cell(b, s):
    return fmt(b) if b is None else f"{fmt(b)} · {b / s:.2%}"


def main():
    check()
    head = " | ".join(f"{s:,} B".replace(",", " ") for s in SIZES)
    print(f"### Bytes a frame, framing plus index, {FRAMES} frames · share of the frame\n")
    print(f"| container | {head} |")
    print("| --- |" + " --: |" * len(SIZES))
    for name, f in ARMS:
        print(f"| {name} | " + " | ".join(cell(f(s), s) for s in SIZES) + " |")


if __name__ == "__main__":
    main()
