"""The encoder configurations of the groups protocol — docs/av1/groups.md §5 — as aomenc flags over the bytes run's
base (lab/av1/profiles/bytes.py, aomenc_args)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "profiles"))
from bytes import aomenc_args  # noqa: E402

LAG = ["--lag-in-frames=39"]
OFF = ["--lag-in-frames=0", "--auto-alt-ref=0"]
A = [*LAG, "--auto-alt-ref=1", "--enable-tpl-model=0", "--enable-keyframe-filtering=0"]
AT = [*LAG, "--auto-alt-ref=1", "--enable-tpl-model=1", "--enable-keyframe-filtering=0"]
AD = [*AT[:-1], "--enable-keyframe-filtering=1"]
ARMS = {
    "O": OFF,
    "L": [*LAG, "--auto-alt-ref=0", "--enable-tpl-model=0", "--enable-keyframe-filtering=0"],
    "A": A,
    "AT": AT,
    "AD": AD,
    "AF": [*AD, "--deltaq-mode=1"],
    "AU": [*AT, "--arnr-strength=0"],
    "AW": [*AT, "--arnr-strength=2"],
    "AQ": AT,
    "I": ["--lag-in-frames=0"],
    "R": OFF,
    "O3": [*OFF, "--cpu-used=3"],
    "AT3": [*AT, "--cpu-used=3"],
}
ORDER = ("O", "L", "A", "AT", "AD", "AQ")
WITH_HIDDEN = {"A", "AT", "AD", "AQ", "AT3", "AF", "AU", "AW"}
LOOKAHEAD = {"L", *WITH_HIDDEN}
DROP = {"--lag-in-frames=0", "--auto-alt-ref=0", "--cpu-used=6"}


def args(arm, form, q, g, n, extra=()):
    """aomenc's flags for one arm; later flags in `extra` override the arm's (the checks' mutations)."""
    base = [a for a in aomenc_args(form, q, g, n) if a not in DROP]
    if arm == "AQ":
        base = [a for a in base if not a.startswith(("--min-q=", "--max-q="))]
    mode = {"I": "--allintra", "R": "--rt"}.get(arm, "--good")
    base = [mode if a == "--good" else a for a in base]
    flags = ["--cpu-used=6", *ARMS[arm], *extra]
    keys = {}
    for f in flags:
        keys[f.split("=")[0]] = f
    return [*base, *keys.values()]
