import hashlib, json, os, subprocess, sys
# A frame table from ffprobe's demuxer: where each frame's bytes start relative to the position ffprobe reports,
# and the container's bytes beyond the coded frames, per frame.
for path in sys.argv[1:]:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_packets",
                          "-show_data_hash", "sha256", "-of", "json", path], capture_output=True, check=True)
    pkts = json.loads(out.stdout)["packets"]
    data = open(path, "rb").read()
    def skip(p):
        pos, n = int(p["pos"]), int(p["size"])
        return next((k for k in range(64) if "SHA256:" + hashlib.sha256(data[pos + k:pos + k + n]).hexdigest()
                     == p["data_hash"]), None)
    skips = {skip(p) for p in pkts}
    payload = sum(int(p["size"]) for p in pkts)
    print(f"{os.path.basename(path):14} frames={len(pkts):4} coded={payload:8} file={len(data):8} "
          f"overhead/frame={(len(data) - payload) / len(pkts):6.1f} B  frame bytes contiguous at pos+{sorted(skips)}")
