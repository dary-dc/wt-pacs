#!/usr/bin/env bash
# H1: what a production certificate chain costs a cold open, and what RFC 8879 compression
# gives back. Builds throwaway WebPKI-shaped chains from a private CA made here, reads each
# server first flight off the wire, and refits cold_open's first-byte slope with the arms
# interleaved. Numbers and what they mean: docs/proposal-session-open.md §What production adds.
#
#   lab/scripts/cert_chain_cells.sh [rounds]
#
# The probe skips certificate validation (cold_open uses `with_no_cert_validation`), so the test
# root is never trusted; only the bytes on the wire matter here.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

ROUNDS="${1:-7}"
DELAYS=(20 40 80)
ARMS=(dev ec rsa ec-z rsa-z)

T="$(mktemp -d)"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$T"; }
trap cleanup EXIT

BASE=$((30000 + (RANDOM % 200) * 100))
port_of() {  # arm kind -> port
  local i=0 a
  for a in "${ARMS[@]}"; do [[ "$a" == "$1" ]] && break; i=$((i + 1)); done
  case "$2" in
    front) echo $((BASE + i * 4)) ;;
    server) echo $((BASE + i * 4 + 1)) ;;
    tap) echo $((BASE + i * 4 + 2)) ;;
  esac
}
cert_of() { case "$1" in dev) echo "$T/dev";; ec|ec-z) echo "$T/ec-leaf";; rsa|rsa-z) echo "$T/rsa-leaf";; esac; }
bin_of()  { case "$1" in *-z) echo "$T/bin-on";; *) echo "$T/bin-off";; esac; }

echo "== throwaway chains"
# One SCT-sized blob pair: an RFC 6962 SCT with a P-256 signature is ~119 B on the wire, and a
# public leaf carries two or three of them.
SCT=$(head -c 244 /dev/urandom | od -An -tx1 | tr -d ' \n')
cat > "$T/ext-int.cnf" <<'EOF'
basicConstraints=critical,CA:TRUE,pathlen:0
keyUsage=critical,digitalSignature,keyCertSign,cRLSign
extendedKeyUsage=serverAuth,clientAuth
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid:always
authorityInfoAccess=OCSP;URI:http://ocsp.test-roots.example.com,caIssuers;URI:http://crt.test-roots.example.com/WTPACSTestRoot.crt
crlDistributionPoints=URI:http://crl.test-roots.example.com/WTPACSTestRoot.crl
certificatePolicies=2.23.140.1.2.1,@polsect
[polsect]
policyIdentifier=1.3.6.1.4.1.99999.1.2.3
CPS.1=http://cps.test-roots.example.com/repository/cps-v1.4.3.html
EOF
cat > "$T/ext-leaf.cnf" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=serverAuth,clientAuth
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid:always
subjectAltName=DNS:pacs.example.com,DNS:www.pacs.example.com,IP:127.0.0.1,DNS:localhost
authorityInfoAccess=OCSP;URI:http://ocsp.test-roots.example.com,caIssuers;URI:http://crt.test-roots.example.com/WTPACSTestE1.crt
crlDistributionPoints=URI:http://crl.test-roots.example.com/WTPACSTestE1-4.crl
certificatePolicies=2.23.140.1.2.1,@polsect
1.3.6.1.4.1.11129.2.4.2=DER:0481F4${SCT}
[polsect]
policyIdentifier=1.3.6.1.4.1.99999.1.2.3
CPS.1=http://cps.test-roots.example.com/repository/cps-v1.4.3.html
EOF

key() { case "$1" in ec) openssl ecparam -name prime256v1 -genkey -noout -out "$2";; rsa) openssl genrsa -out "$2" 2048;; esac 2>/dev/null; }

make_chain() {  # alg
  local alg="$1" o="$T"
  key "$alg" "$o/$alg-root.key"
  openssl req -x509 -new -key "$o/$alg-root.key" -sha256 -days 3 -out "$o/$alg-root.crt" \
    -subj "/C=US/O=WT-PACS Test Roots/CN=WT-PACS Test ${alg} Root" \
    -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign' 2>/dev/null
  key "$alg" "$o/$alg-int.key"
  openssl req -new -key "$o/$alg-int.key" -out "$o/$alg-int.csr" \
    -subj "/C=US/O=WT-PACS Test Roots/CN=WT-PACS Test ${alg} Intermediate" 2>/dev/null
  openssl x509 -req -in "$o/$alg-int.csr" -CA "$o/$alg-root.crt" -CAkey "$o/$alg-root.key" \
    -set_serial 0x4a1f3c92b77e51d0 -days 3 -sha256 -extfile "$T/ext-int.cnf" -out "$o/$alg-int.crt" 2>/dev/null
  key "$alg" "$o/$alg-leaf.key.pem"
  openssl req -new -key "$o/$alg-leaf.key.pem" -out "$o/$alg-leaf.csr" \
    -subj '/C=US/ST=California/L=San Francisco/O=WT-PACS Example Health Network/CN=pacs.example.com' 2>/dev/null
  openssl x509 -req -in "$o/$alg-leaf.csr" -CA "$o/$alg-int.crt" -CAkey "$o/$alg-int.key" \
    -set_serial 0x0d7f2b4e91c5a06833ee12 -days 3 -sha256 -extfile "$T/ext-leaf.cnf" -out "$o/$alg-leaf.crt" 2>/dev/null
  cat "$o/$alg-leaf.crt" "$o/$alg-int.crt" > "$o/$alg-leaf.cert.pem"
  openssl verify -CAfile "$o/$alg-root.crt" -untrusted "$o/$alg-int.crt" "$o/$alg-leaf.crt" > /dev/null
  printf '  %-4s leaf %d B  intermediate %d B  shipped %d B\n' "$alg" \
    "$(openssl x509 -in "$o/$alg-leaf.crt" -outform DER | wc -c)" \
    "$(openssl x509 -in "$o/$alg-int.crt" -outform DER | wc -c)" \
    "$(( $(openssl x509 -in "$o/$alg-leaf.crt" -outform DER | wc -c) + $(openssl x509 -in "$o/$alg-int.crt" -outform DER | wc -c) ))"
}
make_chain ec
make_chain rsa

# Today's dial, reproduced exactly as link_impair_check.sh makes it: one self-signed P-256 leaf.
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$T/dev.key.pem" \
  -out "$T/dev.cert.pem" -days 2 -nodes -subj '/CN=localhost' \
  -addext 'basicConstraints=critical,CA:FALSE' -addext 'keyUsage=critical,digitalSignature' \
  -addext 'extendedKeyUsage=serverAuth' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null
printf '  %-4s leaf %d B  intermediate -       shipped %d B\n' dev \
  "$(openssl x509 -in "$T/dev.cert.pem" -outform DER | wc -c)" \
  "$(openssl x509 -in "$T/dev.cert.pem" -outform DER | wc -c)"

echo
echo "== builds"
cargo build -q -p exact-server -p pack-study -p window-harness
mkdir -p "$T/bin-off" "$T/bin-on"
D="${CARGO_TARGET_DIR:-target}/debug"
cp "$D/exact-server" "$D/cold_open" "$D/pack-study" "$T/bin-off/"
cargo build -q -p exact-server -p window-harness \
  --features exact-server/cert-compression,window-harness/cert-compression
cp "$D/exact-server" "$D/cold_open" "$T/bin-on/"
echo "  off $(stat -c%s "$T/bin-off/exact-server") B   on $(stat -c%s "$T/bin-on/exact-server") B  (debug)"

mkdir -p "$T/frames"
for i in $(seq 0 9); do head -c 256000 /dev/urandom > "$T/frames/$(printf '%03d' "$i").htj2k"; done
echo '{"frameCount": 10}' > "$T/metadata.json"
"$T/bin-off/pack-study" --metadata "$T/metadata.json" --frames "$T/frames" --output "$T/study.sbnd" > /dev/null

start_servers() {
  for arm in "${ARMS[@]}"; do
    RUST_LOG="${SERVER_LOG:-exact_server=warn}" "$(bin_of "$arm")/exact-server" \
      --port "$(port_of "$arm" server)" --study "$T/study.sbnd" \
      --cert-pem "$(cert_of "$arm").cert.pem" --key-pem "$(cert_of "$arm").key.pem" \
      > "$T/server-$arm.log" 2>&1 &
    PIDS+=("$!")
  done
  for arm in "${ARMS[@]}"; do
    for _ in $(seq 100); do grep -q "wt_url=" "$T/server-$arm.log" && break; sleep 0.1; done
    grep -q "wt_url=" "$T/server-$arm.log" || { echo "server $arm did not start:"; cat "$T/server-$arm.log"; exit 1; }
  done
}
start_relay() {  # arm listen_port upstream_port delay_ms
  python3 lab/scripts/link_impair.py --udp "$2:$3" --delay-ms "$4" > "$T/relay-$1.log" 2>&1 &
  echo "$!" >> "$T/relays"
  PIDS+=("$!")
  for _ in $(seq 50); do grep -q READY "$T/relay-$1.log" && return; sleep 0.1; done
  echo "relay $1 did not start" >&2; exit 1
}
stop_relays() {
  [[ -f "$T/relays" ]] || return 0
  while read -r p; do kill -TERM "$p" 2>/dev/null || true; done < "$T/relays"
  rm -f "$T/relays"; sleep 0.4
}

start_servers

echo
echo "== the server's first flight, on the wire (one-way 40 ms, three cold opens per arm)"
for arm in "${ARMS[@]}"; do
  start_relay "$arm" "$(port_of "$arm" front)" "$(port_of "$arm" server)" 40
  python3 lab/scripts/first_flight.py "$(port_of "$arm" tap)" "$(port_of "$arm" front)" \
    > "$T/tap-$arm.log" 2>&1 &
  TAP=$!; PIDS+=("$TAP")
  sleep 0.3
  "$(bin_of "$arm")/cold_open" --url "https://127.0.0.1:$(port_of "$arm" tap)/" --rounds 3 --rtt-ms 80 > /dev/null
  kill -TERM "$TAP" 2>/dev/null || true
  sleep 0.4
  stop_relays
  printf '  %-6s %s\n' "$arm" "$(head -1 "$T/tap-$arm.log")"
done

echo
echo "== first byte, arms interleaved, $ROUNDS rounds per delay"
: > "$T/samples.tsv"
for d in "${DELAYS[@]}"; do
  for arm in "${ARMS[@]}"; do
    start_relay "$arm" "$(port_of "$arm" front)" "$(port_of "$arm" server)" "$d"
  done
  for _ in $(seq "$ROUNDS"); do
    for arm in "${ARMS[@]}"; do
      line=$("$(bin_of "$arm")/cold_open" --url "https://127.0.0.1:$(port_of "$arm" front)/" \
             --rounds 1 --rtt-ms $((2 * d)))
      printf '%s\t%s\t%s\n' "$arm" "$((2 * d))" "$line" >> "$T/samples.tsv"
    done
  done
  stop_relays
done

cat > "$T/fit.py" <<'FIT'
"""Median per (arm, rtt), the slope of that median against the rtt, and how often each arm's
first byte landed behind the reference arm's in the same round."""
import collections, re, statistics, sys

phase, ref = sys.argv[2], sys.argv[3]
cells = collections.defaultdict(list)
for line in open(sys.argv[1]):
    arm, rtt, out = line.rstrip("\n").split("\t", 2)
    cells[(arm, int(rtt))].append(float(re.search(phase + r"=([0-9.]+)ms", out).group(1)))

arms = sorted({a for a, _ in cells}, key=lambda a: [x[0] for x in cells].index(a))
rtts = sorted({r for _, r in cells})
print("  %-7s %s" % ("arm", "  ".join("%-26s" % ("rtt %d ms" % r) for r in rtts)))
for arm in arms:
    row, xs, ys = [], [], []
    for rtt in rtts:
        v = sorted(cells[(arm, rtt)])
        med = statistics.median(v)
        beat = sum(1 for a, b in zip(cells[(arm, rtt)], cells[(ref, rtt)]) if a > b)
        row.append("%7.1f [%5.1f-%5.1f] %d/%d" % (med, v[0], v[-1], beat, len(v)))
        xs.append(rtt); ys.append(med)
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
    print("  %-7s %s  ->  %.2f round trips + %.1f ms" % (arm, "  ".join(row), slope, my - slope * mx))
FIT

echo
echo "first_byte: median ms [min-max] and rounds behind $([[ ${ARMS[0]} == dev ]] && echo dev)"
python3 "$T/fit.py" "$T/samples.tsv" first_byte "${ARMS[0]}"
echo
echo "session ready:"
python3 "$T/fit.py" "$T/samples.tsv" session "${ARMS[0]}"
