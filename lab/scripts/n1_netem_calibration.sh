#!/usr/bin/env bash
# Can a container's impaired link stand in for the kernel's? On the cloud rig, one server and the
# cold_open probe on its own loopback; per round and delay the link is either link_impair.py (the
# userspace relay rows 36-38 were measured through) or netem on `lo`, arms interleaved. Each arm's
# three delays are fitted: slope = round trips, intercept = fixed cost. Results: docs/rig-limits.md §3.
#
#   SSH_KEY=~/.ssh/id_ed25519_rig lab/scripts/n1_netem_calibration.sh [ROUNDS]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ROUNDS=${1:-5}
HOST=${CLOUD_HOST:-168.138.130.163}
SSH_KEY=${SSH_KEY:?the human rig key, docs/cloud-rig-access.md}
STUDY=${STUDY:?a .sbnd of 256 kB frames, as link_impair_check.sh packs}
OUT=${OUT:-$ROOT/.local/measurements/n1-netem-$(date +%Y%m%d-%H%M%S).tsv}
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes "ubuntu@$HOST")

mkdir -p "$(dirname "$OUT")"
"${SSH[@]}" 'mkdir -p n1'
scp -q -i "$SSH_KEY" "$ROOT/target/release/exact-server" "$ROOT/target/release/cold_open" \
  "$ROOT/lab/scripts/link_impair.py" "$STUDY" "ubuntu@$HOST:n1/"

"${SSH[@]}" bash -s "$ROUNDS" "$(basename "$STUDY")" <<'REMOTE' > "$OUT"
set -u
cd ~/n1
SRV=36600 IN=34600 CTRL=38600
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout key.pem -out cert.pem \
  -days 2 -nodes -subj '/CN=localhost' -addext 'subjectAltName=IP:127.0.0.1' 2> /dev/null
sudo -n tc qdisc del dev lo root 2> /dev/null
RUST_LOG=exact_server=warn ./exact-server --port $SRV --bind 127.0.0.1 --study "$2" \
  --cert-pem cert.pem --key-pem key.pem > server.log 2>&1 &
server=$!
for _ in $(seq 100); do grep -q wt_url= server.log && break; sleep 0.1; done

for ((r = 0; r < $1; r++)); do
  for d in 20 40 80; do
    for arm in $( ((r % 2)) && echo "netem relay" || echo "relay netem" ); do
      if [[ $arm == relay ]]; then
        python3 link_impair.py --udp "$IN:$SRV" --delay-ms "$d" --control-port $CTRL > relay.log 2>&1 &
        relay=$!
        for _ in $(seq 50); do grep -q READY relay.log && break; sleep 0.1; done
        port=$IN
      else
        # Both directions leave through `lo`, so a round trip is twice the delay, as with the relay.
        sudo -n tc qdisc add dev lo root netem delay "${d}ms" limit 10000
        port=$SRV
      fi
      line=$(./cold_open --url "https://127.0.0.1:$port/" --rounds 5 --rtt-ms $((2 * d)) 2>&1 | tail -1)
      if [[ $arm == relay ]]; then kill "$relay"; wait "$relay" 2> /dev/null; else sudo -n tc qdisc del dev lo root; fi
      printf '%s\t%s\t%s\t%s\n' "$r" "$arm" $((2 * d)) "$line"
      sleep 1
    done
  done
done
kill "$server"
sudo -n tc qdisc del dev lo root 2> /dev/null
exit 0
REMOTE

python3 - "$OUT" <<'PY'
import re, statistics as st, sys
rows = [l.rstrip("\n").split("\t", 3) for l in open(sys.argv[1]) if l.strip()]
def fit(pts):
    xs, ys = zip(*pts); mx, my = st.mean(xs), st.mean(ys)
    slope = sum((x - mx) * (y - my) for x, y in pts) / sum((x - mx) ** 2 for x in xs)
    return slope, my - slope * mx
for phase in ("session", "first_byte", "ask_to_last_byte"):
    for arm in ("relay", "netem"):
        fits = []
        for r in sorted({x[0] for x in rows}):
            pts = [(float(rtt), float(m.group(1))) for rr, a, rtt, line in rows
                   if rr == r and a == arm and (m := re.search(phase + r"=([0-9.]+)ms", line))]
            if len(pts) == 3:
                fits.append(fit(pts))
        if fits:
            s, i = [f[0] for f in fits], [f[1] for f in fits]
            print(f"{phase:17} {arm:6} round trips {st.median(s):5.2f} [{min(s):.2f}–{max(s):.2f}]"
                  f"  fixed ms {st.median(i):6.1f} [{min(i):.1f}–{max(i):.1f}]  n={len(fits)}")
PY
echo "wrote $OUT" >&2
