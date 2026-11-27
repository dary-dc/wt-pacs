import subprocess, sys
from collections import Counter
PACKS = {0x02: "HeaderPartition", 0x03: "BodyPartition", 0x04: "FooterPartition", 0x05: "Primer", 0x11: "RandomIndexPack"}

def name(k):
    if k[4:6] == b"\x02\x05" and k[8:13] == bytes.fromhex("0d01020101"): return PACKS.get(k[13], "pack")
    if k[4:6] == b"\x02\x53" and k[8:15] == bytes.fromhex("0d010201011001"): return "IndexTableSegment"
    if k[4:6] == b"\x02\x53": return "HeaderMetadataSet"
    if k[4] == 0x01 and k[8:13] == bytes.fromhex("0301021001"): return "Fill"
    if k[4] == 0x01 and k[8:11] == bytes.fromhex("0d0103"): return "Essence"
    if k[8:13] == bytes.fromhex("0d01030104"): return "SystemItem"
    return "other"

def klvs(d):
    i = 0
    while i < len(d):
        ber = d[i + 16]; n = ber & 0x7F if ber & 0x80 else 0
        length = int.from_bytes(d[i + 17:i + 17 + n], "big") if n else ber
        yield i, name(d[i:i + 16]), 17 + n, length
        i += 17 + n + length

def packets(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "packet=size,pos",
                          "-of", "csv=p=0", path], capture_output=True, text=True, check=True).stdout
    return [tuple(map(int, line.split(","))) for line in out.split()]

for path in sys.argv[1:]:
    d = open(path, "rb").read(); seen = Counter(); essence = 0
    print(f"== {path} ({len(d)} B)")
    for at, what, head, length in klvs(d):
        essence += length if what == "Essence" else 0
        seen[what] += 1
        if seen[what] <= (1 if what == "HeaderMetadataSet" else 4):
            print(f"  {what} @{at} key+length={head} value={length}")
    print("  counts:", dict(seen))
    frames = packets(path)
    soc = sum(d[pos:pos + 2] == b"\xff\x4f" for _, pos in frames)
    gaps = sorted({frames[k + 1][1] - frames[k][1] - frames[k][0] for k in range(len(frames) - 1)})
    print(f"  frames={len(frames)} ffprobe pos at the codestream (SOC)={soc} gaps between frames={gaps[0]}..{gaps[-1]} B")
    print(f"  container bytes={len(d) - essence} for {len(frames)} frames; RandomIndexPack length in the last 4 B="
          f"{int.from_bytes(d[-4:], 'big')}")
