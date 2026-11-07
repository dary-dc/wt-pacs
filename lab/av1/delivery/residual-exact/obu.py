"""What the run reads from an AV1 temporal unit: whether it opens with a sequence header, and that header's
film_grain_params_present — AV1 specification §5.5 (sequence_header_obu) and §5.5.2 (color_config)."""

OBU_SEQUENCE_HEADER = 1


def obus(unit):
    pos = 0
    while pos < len(unit):
        head = unit[pos]
        kind, ext, sized = (head >> 3) & 15, (head >> 2) & 1, (head >> 1) & 1
        pos += 1 + ext
        size, shift = 0, 0
        if not sized:
            yield kind, unit[pos:]
            return
        while True:
            b = unit[pos]
            pos += 1
            size |= (b & 127) << shift
            shift += 7
            if not b & 128:
                break
        yield kind, unit[pos:pos + size]
        pos += size


class Bits:
    def __init__(self, data):
        self.data, self.pos = data, 0

    def f(self, n):
        v = 0
        for _ in range(n):
            v = (v << 1) | ((self.data[self.pos >> 3] >> (7 - (self.pos & 7))) & 1)
            self.pos += 1
        return v


def sequence_header(unit):
    return next((payload for kind, payload in obus(unit) if kind == OBU_SEQUENCE_HEADER), None)


def film_grain_params_present(seq):
    """Walks every field before it; timing and decoder-model info are refused, libaom writes neither by default."""
    r = Bits(seq)
    profile, _still, reduced = r.f(3), r.f(1), r.f(1)
    if reduced:
        r.f(5)
    else:
        if r.f(1):
            raise ValueError("timing_info_present_flag set: not parsed here")
        delay = r.f(1)
        for _ in range(r.f(5) + 1):
            r.f(12)
            if r.f(5) > 7:
                r.f(1)
            if delay and r.f(1):
                r.f(4)
    wb, hb = r.f(4) + 1, r.f(4) + 1
    r.f(wb), r.f(hb)
    if not reduced and r.f(1):
        r.f(4), r.f(3)
    r.f(1), r.f(1), r.f(1)
    order_hint = 0
    if not reduced:
        r.f(1), r.f(1), r.f(1), r.f(1)
        order_hint = r.f(1)
        if order_hint:
            r.f(1), r.f(1)
        force_sct = 2 if r.f(1) else r.f(1)
        if force_sct > 0 and not r.f(1):
            r.f(1)
        if order_hint:
            r.f(3)
    r.f(1), r.f(1), r.f(1)
    high = r.f(1)
    depth = (12 if r.f(1) else 10) if profile == 2 and high else (10 if high else 8)
    mono = 0 if profile == 1 else r.f(1)
    cp = tc = mc = 2
    if r.f(1):
        cp, tc, mc = r.f(8), r.f(8), r.f(8)
    if mono:
        r.f(1)
    else:
        if (cp, tc, mc) != (1, 13, 0):
            r.f(1)
            sx, sy = (1, 1) if profile == 0 else (0, 0) if profile == 1 else (1, 0)
            if profile == 2 and depth == 12:
                sx = r.f(1)
                sy = r.f(1) if sx else 0
            if sx and sy:
                r.f(2)
        r.f(1)
    return dict(profile=profile, depth=depth, mono=mono, film_grain=r.f(1))
