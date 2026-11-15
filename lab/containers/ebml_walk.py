import sys
from collections import Counter
NAMES = {0x1A45DFA3: "EBML", 0x18538067: "Segment", 0x114D9B74: "SeekHead", 0x1549A966: "Info", 0x1654AE6B: "Tracks",
         0x1F43B675: "Cluster", 0x1C53BB6B: "Cues", 0xBB: "CuePoint", 0xB3: "CueTime", 0xB7: "CueTrackPositions",
         0xF1: "CueClusterPosition", 0xF0: "CueRelativePosition", 0xF7: "CueTrack", 0xE7: "Timestamp", 0xA3: "SimpleBlock",
         0xA0: "BlockGroup", 0x1254C367: "Tags", 0xEC: "Void", 0x63A2: "CodecPrivate", 0xBF: "CRC-32", 0xAE: "TrackEntry"}
MASTER = {0x18538067, 0x1F43B675, 0x1C53BB6B, 0xBB, 0xB7, 0x1654AE6B, 0xAE}
def vint(d, i, keep_marker):
    n = 8 - d[i].bit_length() + 1
    v = int.from_bytes(d[i:i + n], "big")
    return (v if keep_marker else v & ((1 << (7 * n)) - 1)), n
d = open(sys.argv[1], "rb").read()
bytes_by, count = Counter(), Counter()
def walk(i, end, depth):
    while i < end:
        eid, a = vint(d, i, True); size, b = vint(d, i + a, False)
        name = NAMES.get(eid, hex(eid)); body = i + a + b
        count[name] += 1; bytes_by[name] += a + b + (0 if eid in MASTER else size)
        if depth <= 1: print("  " * depth + f"{name} @{i} header={a + b} size={size}")
        if eid in MASTER: walk(body, body + size, depth + 1)
        i = body + size
walk(0, len(d), 0)
print("counts:", {k: v for k, v in count.items() if not k.startswith("0x")})
