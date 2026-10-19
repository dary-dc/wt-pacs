#!/usr/bin/env bash
# The device kit on the Oracle machine, driven from the local machine: lab/devices/README.md, docs/devices.md §4.
#
#   lab/devices/deploy.sh up       ports checked, image and kit copied, D2's four arms and the collector started
#   lab/devices/deploy.sh fetch D  the collected rows into D, the host's names replaced and checked gone
#   lab/devices/deploy.sh down     the arms and the collector stopped
#
# From the environment, never committed: CLOUD_HOST, SSH_KEY (as lab/scripts/cloud_common.sh), PUBLIC_NAME (the name
# the phone dials, which TLS_DIR's certificate is for), TLS_DIR (cert.pem, key.pem), DEVICES_TOKEN, STUDIES (what
# make_bundles.sh wrote). SUPPLY_CERT=1 hands the certificate to the arms too (WebKit refused hashes in D0).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
: "${CLOUD_HOST:?}" "${SSH_KEY:?}" "${PUBLIC_NAME:?}"
CLOUD_USER="${CLOUD_USER:-ubuntu}"
COLLECT_PORT="${COLLECT_PORT:-8443}"
D2_SET="${D2_SET:-dbt10_ea1141}"
REMOTE_DIR="${REMOTE_DIR:-wt-pacs-devices}"
KNOWN="${SSH_KNOWN_HOSTS:-$ROOT/.local/r2/known_hosts}"
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes -o IdentitiesOnly=yes -o UserKnownHostsFile="$KNOWN" -o StrictHostKeyChecking=yes "$CLOUD_USER@$CLOUD_HOST")
RSYNC=(rsync -a -e "ssh -i $SSH_KEY -o BatchMode=yes -o IdentitiesOnly=yes -o UserKnownHostsFile=$KNOWN")
# name port flags…, one arm a line
ARMS="$(python3 -c 'import json,sys; [print(a["name"], a["port"], *a["flags"]) for a in json.load(open(sys.argv[1]))]' "$ROOT/lab/devices/arms.json")"

ports_free() {
  local ports
  ports="$(awk '{print $2}' <<<"$ARMS" | tr '\n' ' ')"
  grep -qw 4437 <<<"$ports" && { echo "4437 is the field server's: arms.json" >&2; exit 1; }
  # Nothing listens on them, and a host firewall that rejects by default lets each in. The cloud's security list is
  # checked by D0's dials and the smoke fetch below: docs/rig-limits.md §9.
  "${SSH[@]}" "bad=0
    rules=\$(sudo -n iptables -S INPUT 2>/dev/null) || { echo 'cannot read the host firewall (sudo -n iptables)'; exit 1; }
    # In order: the port's ACCEPT, or a REJECT or DROP with no port of its own, whichever comes first; else the policy.
    open() { printf '%s\n' \"\$rules\" | awk -v p=\"-p \$1 .*--dport \$2 \" '
      /^-P INPUT DROP/ { r = 1 } \$0 ~ p && / -j ACCEPT/ { r = 0; exit } / -j (REJECT|DROP)/ && !/--dport/ { r = 1; exit } END { exit r }'; }
    for p in $ports; do
      ss -Hlun \"sport = :\$p\" | grep -q . && { echo \"UDP \$p is taken\"; bad=1; }
      open udp \$p || { echo \"UDP \$p: the host firewall rejects it\"; bad=1; }
    done
    ss -Hltn 'sport = :$COLLECT_PORT' | grep -q . && { echo 'TCP $COLLECT_PORT is taken'; bad=1; }
    open tcp $COLLECT_PORT || { echo 'TCP $COLLECT_PORT: the host firewall rejects it'; bad=1; }
    exit \$bad" \
    || { echo "ports: fix the above first (sudo iptables -I INPUT -p udp --dport PORT -j ACCEPT)" >&2; exit 1; }
  echo "ports: free, and open in the host firewall"
}

up() {
  : "${TLS_DIR:?}" "${DEVICES_TOKEN:?}" "${STUDIES:?}"
  [[ ${#DEVICES_TOKEN} -ge 16 ]] || { echo "DEVICES_TOKEN: 16 characters or more" >&2; exit 1; }
  docker image inspect wt-pacs-server >/dev/null || { echo "no wt-pacs-server image: docker compose -f deploy/compose.yml build server" >&2; exit 1; }
  for f in client/transport/ts/dist/session.js client/decode/wasm/built/THIRD_PARTY_NOTICES; do
    [[ -f "$ROOT/$f" ]] || { echo "missing $f: README.md §Prerequisites" >&2; exit 1; }
  done
  [[ -f "$STUDIES/$D2_SET.htj2k.sbnd" ]] || { echo "no $STUDIES/$D2_SET.htj2k.sbnd: lab/devices/make_bundles.sh" >&2; exit 1; }
  down
  ports_free
  local build image
  image="$(docker image inspect -f '{{.Id}}' wt-pacs-server | cut -c8-19)"
  build="$(git -C "$ROOT" rev-parse --short HEAD)$(git -C "$ROOT" diff --quiet || echo +dirty) image $image"
  echo "copying the image ($image)…"
  "${SSH[@]}" "docker image inspect -f '{{.Id}}' wt-pacs-server 2>/dev/null | grep -q $image" \
    || docker save wt-pacs-server | gzip -1 | "${SSH[@]}" 'gunzip | docker load -q'
  "${SSH[@]}" "mkdir -p $REMOTE_DIR/kit/lab $REMOTE_DIR/studies $REMOTE_DIR/rows && install -d -m 0700 $REMOTE_DIR/tls"
  "${RSYNC[@]}" --delete --exclude node_modules --exclude .cache --exclude '*.rs' "$ROOT/client" "$CLOUD_USER@$CLOUD_HOST:$REMOTE_DIR/kit/"
  "${RSYNC[@]}" --delete "$ROOT/lab/order.mjs" "$ROOT/lab/devices" "$CLOUD_USER@$CLOUD_HOST:$REMOTE_DIR/kit/lab/"
  "${RSYNC[@]}" --include '*.sbnd' --exclude '*' "$STUDIES/" "$CLOUD_USER@$CLOUD_HOST:$REMOTE_DIR/studies/"
  "${RSYNC[@]}" "$TLS_DIR/cert.pem" "$TLS_DIR/key.pem" "$CLOUD_USER@$CLOUD_HOST:$REMOTE_DIR/tls/"
  local name port flags
  while read -r name port flags; do
    # The arm's directory is written by the server's user (uid 10001); the certificate it is handed is its to read.
    "${SSH[@]}" "set -e; cd $REMOTE_DIR; docker rm -f wtp-$name >/dev/null 2>&1 || true
      sudo -n rm -rf wt/$name supplied/$name && sudo -n install -d -o 10001 -m 0755 wt/$name
      supplied=''
      if [ '${SUPPLY_CERT:-0}' = 1 ]; then
        sudo -n install -d -o 10001 -m 0500 supplied/$name && sudo -n install -o 10001 -m 0400 tls/cert.pem tls/key.pem supplied/$name/
        supplied=\"-v \$PWD/supplied/$name:/supplied:ro\"
      fi
      docker run -d --name wtp-$name --restart unless-stopped -p $port:$port/udp -v \$PWD/studies:/studies:ro \
        -v \$PWD/wt/$name:/run/wt-pacs \$supplied -e SERIES=$D2_SET.htj2k -e WT_URL=https://$PUBLIC_NAME:$port/ \
        wt-pacs-server --port $port $flags >/dev/null
      for i in \$(seq 50); do docker logs wtp-$name 2>/dev/null | grep -q '^transport=' && break; sleep 0.2; done
      docker logs wtp-$name > wt/$name/banner.txt 2>&1
      grep -q '^transport=' wt/$name/banner.txt || { cat wt/$name/banner.txt; exit 1; }
      # A supplied certificate gets no transport file from the server: the kit names the arm's URL itself.
      [ -z \"\$supplied\" ] || printf '{\"wt_url\": \"https://$PUBLIC_NAME:$port/\", \"cert_sha256\": \"\"}\\n' > wt/$name/dev-transport.json" </dev/null
    echo "arm $name: UDP $port, flags: ${flags:-none}"
  done <<<"$ARMS"
  "${SSH[@]}" "cd $REMOTE_DIR; read -r DEVICES_TOKEN; export DEVICES_TOKEN
    nohup python3 kit/lab/devices/collector.py --root kit --studies studies --wt wt --out rows --tls tls \
      --port $COLLECT_PORT --d2-set $D2_SET --build '$build' > collector.log 2>&1 < /dev/null &
    echo \$! > collector.pid; sleep 1; kill -0 \$(cat collector.pid) || { cat collector.log; exit 1; }" <<<"$DEVICES_TOKEN"
  local url="https://$PUBLIC_NAME:$COLLECT_PORT"
  # CURL_OPTS: e.g. --cacert for a stand-in host whose certificate no CA signed.
  mkdir -p "$ROOT/.local"
  curl -fsS ${CURL_OPTS:-} "$url/kit.json?t=$DEVICES_TOKEN" > "$ROOT/.local/kit.json" \
    || { echo "the collector does not answer at $url: the cloud's security list?" >&2; exit 1; }
  python3 - "$ROOT/.local/kit.json" <<'PY'
import json, sys
for a in json.load(open(sys.argv[1]))["arms"]:
    print(f"  {a['name']}: {a['wt_url']}, {'pinned by hash' if a['cert_sha256'] else 'CA-verified'}")
PY
  echo "build $build"
  echo "on the phone: $url/?t=\$DEVICES_TOKEN"
}

fetch() {
  local out=${1:?fetch DIR} raw
  raw="$(mktemp -d)"
  trap 'rm -rf "$raw"' RETURN
  "${RSYNC[@]}" "$CLOUD_USER@$CLOUD_HOST:$REMOTE_DIR/rows/" "$raw/"
  # docs/devices.md §4: nothing identifying is committed. The arms' URLs and banners name the host.
  python3 - "$raw" "$out" "$PUBLIC_NAME" "$CLOUD_HOST" <<'PY'
import pathlib, sys
raw, out, *names = sys.argv[1:]
pathlib.Path(out).mkdir(parents=True, exist_ok=True)
for f in pathlib.Path(raw).glob("*.jsonl"):
    t = f.read_text()
    for n in names:
        t = t.replace(n, "<host>")
    assert not any(n in t for n in names), f
    (pathlib.Path(out) / f.name).write_text(t)
PY
  echo "rows in $out, the host's names replaced"
}

down() {
  "${SSH[@]}" "cd $REMOTE_DIR 2>/dev/null && [ -f collector.pid ] && kill \$(cat collector.pid) 2>/dev/null; rm -f collector.pid; for n in $(awk '{print $1}' <<<"$ARMS" | tr '\n' ' '); do docker rm -f wtp-\$n >/dev/null 2>&1 || true; done"
  echo "arms and collector stopped"
}

case "${1:-}" in
  up) up ;;
  fetch) fetch "${2:-}" ;;
  down) down ;;
  *) sed -n '4,6p' "$0" >&2; exit 2 ;;
esac
