# The Second amendment's functions (docs/devices.md §7), memlock 8388608 per its Note; RUN names the output dir.
tether_if() { for d in /sys/class/net/*; do case $(readlink -f "$d/device/driver") in */rndis_host|*/cdc_ncm|*/cdc_ether) echo "${d##*/}";; esac; done | head -1; }
wired_if() { nmcli -t -f DEVICE,TYPE,STATE device | awk -F: -v t="$(tether_if)" '$2=="ethernet" && $3=="connected" && $1!=t {print $1; exit}'; }
addr() { [ -n "$1" ] && ip -4 -o addr show dev "$1" | awk '{print $4}' | cut -d/ -f1 | head -1; }
IMAGE=wt-pacs-server-telemetry; RUN=${RUN:-target/phone-run}
serve() {
  n=srv-$1${4:+-published}; d=$RUN/$n; mkdir -p "$d"; podman unshare chown 10001:10001 "$d"
  net="--network host"; [ -n "$4" ] && net="-p $4:$1:$1/udp"
  podman run -d --name "$n" $net --security-opt seccomp="$PWD/deploy/seccomp-uring.json" \
    --ulimit memlock=8388608:8388608 --ulimit nofile=65535:65535 -e SERIES="$3" \
    -e WTPACS_LOSS_TRACE=/run/wt-pacs/loss.jsonl -e WTPACS_PATH_TELEMETRY=1 -e WTPACS_PATH_TELEMETRY_MS=250 \
    -e WTPACS_PATH_TELEMETRY_PATH=/run/wt-pacs/path.jsonl \
    -v "$PWD/demo-series:/studies:ro,z" -v "$PWD/$d:/run/wt-pacs:z" "$IMAGE" --port "$1" --congestion "$2" >/dev/null
}
stop() {
  for n in ${@:-$(podman ps -a --format '{{.Names}}' | grep '^srv-')}; do
    podman logs "$n" >> "$RUN/$n.log" 2>&1; podman rm -f "$n" >/dev/null
  done
}
static() {
  for p in $4 $5; do
    printf '{"wt_url": "https://%s:%s/", "cert_sha256": "%s"}\n' "$2" "$p" \
      "$(jq -r .cert_sha256 $RUN/srv-$p$SUFFIX/dev-transport.json)" > target/phone-transport-$1-$p.json
  done
  python3 server/dev-server.py --bind "$2" --port "$3" --metadata demo-series/$ID.metadata.json \
    --transport target/phone-transport-$1-$4.json \
    --exact-metadata demo-series/$EXACT.metadata.json --exact-transport target/phone-transport-$1-$5.json \
    --beacon $RUN/beacon-$1-$3$SUFFIX.jsonl >> $RUN/static-$1-$3.log 2>&1 &
}
