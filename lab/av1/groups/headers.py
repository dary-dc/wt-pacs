"""Per unit of an AV1 stream, each coded frame's show_existing_frame, frame_type and show_frame — AV1 specification
§5.9.2 (uncompressed_header), read only that far — docs/av1/groups.md §6.3."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "profiles"))
from obu import Bits, obus  # noqa: E402

SEQUENCE_HEADER, FRAME_HEADER, FRAME = 1, 3, 6
KEY = 0


def frames(units, late=0):
    """Per unit, a list of (show_existing_frame, frame_type, show_frame); frame_type is None for a shown existing
    frame. `late` reads show_frame that many bits late (the check's mutation)."""
    reduced, out = None, []
    for u in units:
        coded = []
        for kind, payload in obus(u):
            if kind == SEQUENCE_HEADER:
                r = Bits(payload)
                r.f(3), r.f(1)
                reduced = r.f(1)
            elif kind in (FRAME_HEADER, FRAME):
                if reduced:
                    coded.append((0, KEY, 1))
                    continue
                r = Bits(payload)
                if r.f(1):
                    coded.append((1, None, 1))
                    continue
                kind_of = r.f(2)
                r.f(late)
                coded.append((0, kind_of, r.f(1)))
        out.append(coded)
    return out


def summary(units, late=0):
    per = frames(units, late)
    coded = [f for u in per for f in u if not f[0]]
    return dict(units=len(per), coded=len(coded), hidden=sum(1 for f in coded if not f[2]),
                shown_existing=sum(1 for u in per if any(f[0] for f in u)),
                coded_per_unit_max=max(sum(1 for f in u if not f[0]) for u in per),
                coded_per_unit_mean=len(coded) / len(per),
                keyframes=[i for i, u in enumerate(per) if any(f[1] == KEY and f[2] for f in u)],
                shown_per_unit=[sum(1 for f in u if f[2]) for u in per],
                existing_units=[i for i, u in enumerate(per) if any(f[0] for f in u)])
