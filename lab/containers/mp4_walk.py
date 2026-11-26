import struct, sys
from collections import Counter
CONTAINERS = {b"moov", b"trak", b"mdia", b"minf", b"stbl", b"moof", b"traf", b"mvex", b"mfra", b"edts", b"dinf"}
d = open(sys.argv[1], "rb").read()
count, size_by = Counter(), Counter()
def full(body):  # version/flags, then entry_count
    return struct.unpack(">I", body[4:8])[0]
def walk(i, end, depth):
    while i < end:
        size, typ = struct.unpack(">I4s", d[i:i + 8]); hdr = 8
        if size == 1: size = struct.unpack(">Q", d[i + 8:i + 16])[0]; hdr = 16
        if size == 0: size = end - i
        t = typ.decode("latin1"); count[t] += 1; size_by[t] += size
        body = d[i + hdr:i + size]
        if depth <= 1 and t not in ("moof", "mdat") or count[t] <= 2:
            extra = ""
            if t in ("stsz",): extra = f" sample_size={struct.unpack('>I', body[4:8])[0]} count={struct.unpack('>I', body[8:12])[0]}"
            if t in ("stco", "co64", "stsc", "stss", "stts"): extra = f" entries={full(body)}"
            print("  " * depth + f"{t} @{i} size={size}{extra}")
        if typ in CONTAINERS: walk(i + hdr, i + size, depth + 1)
        i += size
walk(0, len(d), 0)
print({k: (count[k], size_by[k]) for k in ("moov", "moof", "mdat", "stsz", "stco", "stsc", "stss", "sidx", "mfra") if k in count})
