"""Prints design.md §11.3's overlap tables: seconds from a series' last instance to its publication at the PACS."""

# coded bytes a frame and site coding ms a frame, one core; inputs and sources in design.md §11.3
SETS = {
    "CT 512², HTJ2K, ojph": (300, 163_624, 7.4),
    "fluoroscopy 768², HTJ2K, ojph": (300, 506_722, 12.1),
    "fluoroscopy 768², HTJ2K, Python ingest": (300, 506_722, 32.6),
    "fluoroscopy 768², AV1 allintra 7": (300, 506_722 * 1.017 / 0.974, 345.0),
    "tomosynthesis 678×1727, HTJ2K, ojph": (60, 571_039, 17.2),
    "tomosynthesis 678×1727, AV1 good 6": (60, 571_039 * 1.019 / 1.023, 936.0),
}
CORES = 4
LINKS_MBIT = (10, 50, 100, 1000)


def times(frames, frame_bytes, ms, mbit, wait):
    """(today, code on arrival, streamed): seconds after the last instance, the series arriving at once."""
    a = frames * ms / 1000 / CORES
    b = frames * frame_bytes * 8 / (mbit * 1e6)
    return wait + a + b, max(wait, a) + b, max(wait, a, b)


def main():
    for wait in (0, 30):
        print(f"\nQ = {wait} s, {CORES} cores; today · code on arrival · streamed, s")
        print("| set | frames | MB | coding s | " + " | ".join(f"{m} Mbit/s" for m in LINKS_MBIT) + " |")
        print("| --- | ---: | ---: | ---: | " + " | ".join("---" for _ in LINKS_MBIT) + " |")
        for name, (n, fb, ms) in SETS.items():
            cells = [" · ".join(f"{x:.1f}" for x in times(n, fb, ms, m, wait)) for m in LINKS_MBIT]
            print(f"| {name} | {n} | {n * fb / 1e6:.0f} | {n * ms / 1000 / CORES:.1f} | " + " | ".join(cells) + " |")


main()
