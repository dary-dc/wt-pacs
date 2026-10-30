#!/usr/bin/env bash
# The read path on this machine, in one command and one report to send back: docs/adr/disk-access.md §12, *On the
# workstation*, says what each part answers.
#
#   lab/scripts/workstation_run.sh [--quick] [--plan] [--only PART]... [--work DIR] [--exec-gap BIN_DIR|build]
#
# PART is host, ring, readers, server or execgap; --exec-gap adds execgap. Nothing here runs as root.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
quick=0 plan=0 parts=() exec_gap=""
WORK="${WORK:-$ROOT/.local/workstation}"
while (($#)); do
  case "$1" in
    --quick) quick=1 ;;
    --plan) plan=1 ;;
    --only) parts+=("$2"); shift ;;
    --work) WORK="$(realpath -m "$2")"; shift ;;
    --exec-gap) [[ $2 == build ]] && exec_gap=build || exec_gap="$(cd "$2" && pwd)"; shift ;;
    *) sed -n '5,7p' "$0" >&2; exit 2 ;;
  esac
  shift
done
cd "$ROOT"
((${#parts[@]})) || parts=(host ring readers server)
[[ -z "$exec_gap" || " ${parts[*]} " == *" execgap "* ]] || parts+=(execgap)
want() { [[ " ${parts[*]} " == *" $1 "* ]]; }

ROUNDS=$((quick ? 1 : 12))
ASKS=256
PORT="${PORT:-14480}"
PROFILE="${PROFILE:-$ROOT/deploy/seccomp-uring.json}"
R_VARIANTS="${R_VARIANTS:-product_tile,product_fill,hybrid_lazyring,uring,pool,pool_capped_probe,pooled_pread,product_tile,product_fill}"
R_DEPTHS="${R_DEPTHS:-1,4,16}"
R_READERS="${R_READERS:-1,16}"
T="${CARGO_TARGET_DIR:-$ROOT/target}/release"
F16="$WORK/fixtures/frames_16k_big/frames_16k_big.sbnd"
F250="$WORK/fixtures/frames_250k_big/frames_250k_big.sbnd"
SHAPES=("t16 16384 250000 $F16" "t250 250000 500000 $F250" "f16 16384 16384 $F16")
FRESH="$WORK/fresh"
CERT="$WORK/cert/cert.pem" KEY="$WORK/cert/key.pem"
ram_kib=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
# Row 258's series: past RAM, and at least the unread frames its rounds need (586 for --quick, 133 706 for 12).
PAST_RAM_FRAMES=$(( ram_kib * 1024 / 4 * 5 / 499000 + 1 ))
GAP_MIN_FRAMES=$((quick ? 586 : 133706))
PAST_RAM_FRAMES=$(( PAST_RAM_FRAMES > GAP_MIN_FRAMES ? PAST_RAM_FRAMES : GAP_MIN_FRAMES ))
GAP_SERIES="${EXEC_GAP_SERIES:-$WORK/fixtures/frames_499k_past_ram/frames_499k_past_ram.sbnd}"

if [[ -z "${RT+set}" ]]; then
  RT=""
  if command -v podman >/dev/null; then RT=podman
  elif command -v docker >/dev/null && docker info >/dev/null 2>&1; then RT=docker; fi
fi
selinux_mode() { echo "${FAKE_SELINUX:-$(getenforce 2>/dev/null || echo absent)}"; }

preflight() {
  local missing=() c
  for c in cargo git python3 openssl findmnt lsblk tar df awk; do command -v "$c" >/dev/null || missing+=("$c"); done
  [[ "$(uname -sm)" == "Linux x86_64" ]] || missing+=("Linux on x86-64")
  ((${#missing[@]} == 0)) || { echo "missing, README.md §Prerequisites: ${missing[*]}" >&2; exit 1; }
}

# The model's rates are guesses for a laptop NVMe; the report's timing.txt gives the real ones.
estimate() {
  python3 - "$ROUNDS" "$ASKS" "$R_VARIANTS" "$R_DEPTHS" "$R_READERS" "$RT" "$exec_gap" "${parts[*]}" \
    "$([[ -f "$GAP_SERIES" ]] && echo 0 || echo "$PAST_RAM_FRAMES")" "$(df -Pk "$(existing "$WORK")" | awk 'NR==2 {print $4}')" <<'PY'
import sys
rounds, asks, variants, depths, readers, rt, gap, parts, past_ram, free_kib = sys.argv[1:]
rounds, asks, past_ram = int(rounds), int(asks), int(past_ram)
nv, nd = len(variants.split(",")), len(depths.split(","))
readers = [int(r) for r in readers.split(",")]
COPY, READ, ASK = 0.5e9, 1.0e9, 20e-6
MB16, MB250 = 5120 * 16384, 2048 * 250000
shapes = [(16384, MB16), (250000, MB250), (16384, MB16)]
t, written = {"build": 300}, 0.0
if "host" in parts: t["host"] = 10
if "ring" in parts:
    t["ring"] = 15 + (900 + 3 * 30 if rt else 0)
    written += 4 * MB16
if "readers" in parts:
    cells = [(size, mb, r) for size, mb in shapes for r in readers]
    t["readers"] = sum(nd * nv * rounds * (mb / COPY + asks * r * (size / READ + ASK) + 0.1) for size, mb, r in cells)
    written += sum(nd * nv * rounds * mb for _, mb, _ in cells)
if "server" in parts:
    cold = 4 * 3 * rounds
    t["server"] = 6 * 3 * rounds * 1.2 + cold * (MB16 / COPY) + 6 * 3 * rounds * asks * 400e-6
    written += cold * MB16
need = MB16 + MB250 + MB250
if "execgap" in parts:
    t["execgap series"] = past_ram * 499000 / COPY
    need += past_ram * 499000
for k, v in t.items():
    print(f"  {k:<16} ~{v / 60:6.0f} min")
print(f"  {'total':<16} ~{sum(t.values()) / 60:6.0f} min, before row 258's own time" if gap else
      f"  {'total':<16} ~{sum(t.values()) / 60:6.0f} min")
print(f"  disk: {need / 1e9:.1f} GB in WORK (free {int(free_kib) / 1e6:.1f} GB)"
      + (", and ~4 GB of image and build cache in the container runtime's storage" if rt and "ring" in parts else ""))
print(f"  written by fresh copies: ~{written / 1e9:.0f} GB")
sys.exit(0 if need + 1e9 < int(free_kib) * 1024 else 3)
PY
}
existing() { local d="$1"; while [[ ! -d "$d" ]]; do d="$(dirname "$d")"; done; echo "$d"; }

preflight
echo "workstation run: parts ${parts[*]}, rounds $ROUNDS, work $WORK, container runtime ${RT:-none}"
status=0; est=$(estimate) || status=$?
echo "$est"
((status == 0)) || { echo "not enough free disk under $WORK: free some or pass --work DIR" >&2; exit 1; }
((plan)) && exit 0
[[ -t 0 ]] && { echo "starting in 10 s; Ctrl-C stops"; sleep 10; }

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
REPORT="$WORK/report-$STAMP"
mkdir -p "$REPORT/logs" "$FRESH" "$WORK/cert"
exec > >(tee -a "$REPORT/run.log") 2>&1
echo "$est" > "$REPORT/estimate.txt"
started=$(date +%s)
mark() { echo "$1 $(( $(date +%s) - started )) s  load $(cut -d' ' -f1-3 /proc/loadavg)" >> "$REPORT/timing.txt"; }

server=""
cleanup() {
  [[ -n "$server" ]] && kill "$server" 2>/dev/null || true
  [[ -n "$RT" ]] && $RT rm -f wtpacs-ws-default wtpacs-ws-profile wtpacs-ws-nolabel >/dev/null 2>&1 || true
  rm -f "$FRESH"/*.sbnd "$FRESH"/*/*.sbnd
}
trap cleanup EXIT

build() {
  echo "== build"
  cargo build --release -p series-server -p disk-access-bench -p container-bench -p check-fastpath
  [[ -f "$CERT" ]] && openssl x509 -in "$CERT" -noout -checkend 86400 >/dev/null || openssl req -x509 -newkey ec \
    -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$KEY" -out "$CERT" -days 10 -nodes -subj /CN=localhost \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" 2>/dev/null
  local spec name bytes frames
  for spec in "frames_16k_big 16384 5120" "frames_250k_big 250000 2048"; do
    read -r name bytes frames <<<"$spec"
    [[ -f "$WORK/fixtures/$name/$name.sbnd" ]] ||
      OUT_ROOT="$WORK/fixtures" NAME="$name" BYTES="$bytes" FRAMES="$frames" lab/scripts/gen_live_cell_fixture.sh
  done
  mark build
}

# A cold series is a copy written past the page cache, never an evicted one: CLAUDE.md §Measurement.
fresh() {
  "$T/writer_bench" direct --src "$1" --out "$2"
  "$T/writer_bench" resident --file "$2" | python3 -c 'import json,sys; print(json.load(sys.stdin)["resident"])'
}

host() {
  echo "== host"
  local mnt src fstype uuid dev
  read -r mnt src fstype uuid < <(findmnt -no TARGET,SOURCE,FSTYPE,UUID -T "$WORK")
  {
    echo "date $(date -u +%FT%TZ)"
    echo "git $(git rev-parse HEAD) $(git status --porcelain | grep -q . && echo dirty || echo clean)"
    echo "kernel $(uname -srvm)"
    echo "distro $(. /etc/os-release && echo "$PRETTY_NAME")"
    echo "cpu $(awk -F': ' '/^model name/ {print $2; exit}' /proc/cpuinfo), $(grep -c ^processor /proc/cpuinfo) threads"
    lscpu 2>/dev/null | grep -E '^(Core|Socket|Thread|CPU max MHz)' || true
    echo "governor $(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || echo -)"
    echo "on_ac $(cat /sys/class/power_supply/A*/online 2>/dev/null | head -1 || echo -)"
    echo "ram_kib $ram_kib"
    echo "swap_kib $(awk '/^SwapTotal:/ {print $2}' /proc/meminfo)"
    echo "series_volume $mnt  $src  $fstype"
    findmnt -no OPTIONS -T "$WORK"
    lsblk -s -o NAME,KNAME,TYPE,FSTYPE,MODEL,ROTA,SIZE "${src%%\[*}" 2>/dev/null || true
    for dev in $(lsblk -s -nro KNAME "${src%%\[*}" 2>/dev/null); do
      echo "read_ahead_kb $dev $(cat "/sys/block/$dev/queue/read_ahead_kb" 2>/dev/null || echo -)"
    done
    [[ "$fstype" == btrfs ]] && echo "read_ahead_kb bdi $(cat "/sys/fs/btrfs/$uuid/bdi/read_ahead_kb" 2>/dev/null || echo -)"
    echo "read_ahead_kb bdi $(cat "/sys/class/bdi/$(stat -c '%Hd:%Ld' "$WORK")/read_ahead_kb" 2>/dev/null || echo -)"
    echo "thp $(cat /sys/kernel/mm/transparent_hugepage/enabled) defrag $(cat /sys/kernel/mm/transparent_hugepage/defrag)"
    echo "glibc $(getconf GNU_LIBC_VERSION)"
    echo "ulimit_l $(ulimit -l) hard $(ulimit -Hl)"
    echo "ulimit_n $(ulimit -n) hard $(ulimit -Hn)"
    echo "selinux $(selinux_mode)${FAKE_SELINUX:+ (FAKE_SELINUX)}"
    echo "io_uring_disabled $(cat /proc/sys/kernel/io_uring_disabled 2>/dev/null || echo -)"
    echo "rustc $(rustc --version)"
    [[ -n "$RT" ]] && echo "runtime $($RT --version)"
    command -v rpm >/dev/null && rpm -q container-selinux containers-common 2>/dev/null || true
    echo "uptime $(uptime)"
    echo "check-fastpath:"
    "$T/check-fastpath" "$WORK/fixtures" || true
  } > "$REPORT/host.txt" 2>&1
  cat "$REPORT/host.txt"
  mark host
}

wait_for() { # log pattern
  for _ in $(seq 1 400); do
    grep -q "$2" "$1" 2>/dev/null && return 0
    sleep 0.05
  done
  echo "timed out waiting for '$2' in $1" >&2
  return 1
}
field() { sed $'s/\x1b\\[[0-9;]*[A-Za-z]//g' "$1" | grep "$2" | tail -1 | grep -oE "$3=[^ ]+" | tail -1 | cut -d= -f2-; }

serve() { # arm series log
  local mode=auto
  [[ "$1" == pool ]] && mode=pool
  WTPACS_READ_PATH=$mode NO_COLOR=1 RUST_LOG=series_server=info "$T/series-server" --port "$PORT" --series "$2" \
    --bind 127.0.0.1 --cert-pem "$CERT" --key-pem "$KEY" >"$3" 2>&1 &
  server=$!
  wait_for "$3" '^wt_url='
}
# A session's `session reads` line comes when it ends, which a clean shutdown forces.
stop() { kill "$server" 2>/dev/null || true; wait "$server" 2>/dev/null || true; server=""; }

drive() { # label arm temp mode depth asks [pid]
  "$T/server_ab" --url "https://127.0.0.1:$PORT/" ${7:+--server-pid "$7"} --variant "$2" --label "$1" --temp "$3" \
    --mode "$4" --depth "$5" --asks "$6" --frames 5120 --step 16 --no-header
}

ring_native() {
  local log="$REPORT/logs/ring-native.log" res
  res=$(fresh "$F16" "$FRESH/ring.sbnd")
  serve ring "$FRESH/ring.sbnd" "$log"
  drive ring_native ring cold on-demand 4 64 "$server" >/dev/null
  stop
  echo "native  resident=$res  read_fast_path=$(field "$log" read_fast_path= read_fast_path)" \
    "read_ring=$(sed -n 's/^read_ring=//p' "$log")  ring=$(field "$log" 'session reads' ring)" | tee -a "$REPORT/ring.txt"
}

ring_container() { # arm, then its runtime options
  local arm="$1" dir="$FRESH/$1" log="$REPORT/logs/ring-$1.log" res vol
  shift
  mkdir -p "$dir"
  res=$(fresh "$F16" "$dir/cold.sbnd")
  vol="$dir:/studies:ro"
  [[ "$(selinux_mode)" == Enforcing && " $* " != *label=disable* ]] && vol+=",z"
  $RT rm -f "wtpacs-ws-$arm" >/dev/null 2>&1 || true
  $RT run -d --name "wtpacs-ws-$arm" --network host -v "$vol" -e SERIES=cold -e NO_COLOR=1 \
    -e RUST_LOG=series_server=info "$@" wt-pacs-server --port "$PORT" --bind 127.0.0.1 >/dev/null
  for _ in $(seq 1 150); do
    $RT logs "wtpacs-ws-$arm" > "$log" 2>&1 && grep -q '^wt_url=' "$log" && break
    sleep 0.2
  done
  drive "ring_$arm" "$arm" cold on-demand 4 64 >/dev/null || true
  $RT stop -t 10 "wtpacs-ws-$arm" >/dev/null 2>&1 || true
  $RT logs "wtpacs-ws-$arm" > "$log" 2>&1 || true
  $RT rm -f "wtpacs-ws-$arm" >/dev/null 2>&1 || true
  echo "$arm  resident=$res  options: $*  read_ring=$(sed -n 's/^read_ring=//p' "$log")" \
    " ring=$(field "$log" 'session reads' ring)  $(grep -o 'io_uring unavailable.*' "$log" | head -1)" | tee -a "$REPORT/ring.txt"
}

selinux_ways_out() {
  local dir="$REPORT/selinux" granted=unknown
  mkdir -p "$dir"
  command -v sesearch >/dev/null &&
    granted=$(sesearch -A -s container_t -c io_uring -p allowed 2>/dev/null | grep -q allowed && echo yes || echo no)
  echo "selinux  io_uring { allowed } granted to container_t now: $granted" | tee -a "$REPORT/ring.txt"
  if command -v checkmodule >/dev/null && command -v semodule_package >/dev/null; then
    checkmodule -M -m -o "$dir/wtpacs_io_uring.mod" deploy/wtpacs_io_uring.te &&
      semodule_package -o "$dir/wtpacs_io_uring.pp" -m "$dir/wtpacs_io_uring.mod"
  fi
  cat > "$REPORT/ROOT-STEPS.txt" <<EOF
To try the policy module (deploy/wtpacs_io_uring.te: io_uring { allowed } for container_t, every container on
this host), as root, by choice:

  checkmodule -M -m -o /tmp/wtpacs_io_uring.mod $ROOT/deploy/wtpacs_io_uring.te
  semodule_package -o /tmp/wtpacs_io_uring.pp -m /tmp/wtpacs_io_uring.mod
  sudo semodule -i /tmp/wtpacs_io_uring.pp

then, as yourself:  lab/scripts/workstation_run.sh --only ring
and to remove it:   sudo semodule -r wtpacs_io_uring
If the ring is still refused with the module loaded:  sudo ausearch -m avc -ts recent
EOF
}

ring() {
  echo "== ring"
  : > "$REPORT/ring.txt"
  ring_native
  if [[ -z "$RT" ]]; then
    echo "container  no podman or docker: not checked" | tee -a "$REPORT/ring.txt"
  else
    local args=(--build-arg "REGISTRY=${REGISTRY:-docker.io/library}" --secret "id=build_ca,src=${BUILD_CA:-/dev/null}")
    [[ -n "${HTTPS_PROXY:-}" ]] && args+=(--network host --build-arg HTTPS_PROXY --build-arg NO_PROXY)
    if DOCKER_BUILDKIT=1 $RT build -q -f deploy/Containerfile --target server -t wt-pacs-server "${args[@]}" . \
      > "$REPORT/logs/image-build.log" 2>&1; then
      ring_container default
      ring_container profile --security-opt "seccomp=$PROFILE"
      if [[ "$(selinux_mode)" == Enforcing ]] && ! grep -q '^profile .* ring=true' "$REPORT/ring.txt"; then
        ring_container nolabel --security-opt "seccomp=$PROFILE" --security-opt label=disable
        selinux_ways_out
      fi
    else
      echo "container  image build failed: logs/image-build.log" | tee -a "$REPORT/ring.txt"
    fi
  fi
  mark ring
}

readers() {
  echo "== readers: ${#SHAPES[@]} shapes, depths $R_DEPTHS, readers $R_READERS, $ROUNDS rounds"
  local out="$REPORT/readers.tsv" hdr=() spec label size stride fix
  : > "$out"; : > "$REPORT/logs/readers.err"
  for spec in "${SHAPES[@]}"; do
    read -r label size stride fix <<<"$spec"
    "$T/read_campaign" --series "$fix" --fresh "$FRESH" --variants "$R_VARIANTS" --temps cold --depths "$R_DEPTHS" \
      --readers "$R_READERS" --monitors 0 --repeats "$ROUNDS" --asks "$ASKS" --size "$size" --stride "$stride" \
      --label "$label" "${hdr[@]}" >> "$out" 2> >(tee -a "$REPORT/logs/readers.err" >&2)
    hdr=(--no-header)
    echo "  $label done $(date -u +%T)"
  done
  {
    python3 lab/scripts/workstation_summary.py readers "$out" "$R_VARIANTS" || echo "summary failed"
    echo "cold cells skipped, their copy resident: $(grep -c 'skip:' "$REPORT/logs/readers.err" || true) (want 0)"
  } | tee "$REPORT/readers_summary.txt"
  mark readers
}

server_cells() {
  echo "== server: ring, pool and ring_aa, $ROUNDS rounds"
  local out="$REPORT/server.tsv" log="$REPORT/logs/server-cell.log" arms=(ring pool ring_aa)
  local r i spec kind temp mode depth arm series res row
  printf 'label\tvariant\ttemp\tmode\tdepth\tasks\tp50_ns\tp90_ns\tp99_ns\twall_ns\tasks_per_s\tcpu_ns_per_ask\trss_kib\tmiss_pct\tnamed\tring\tresident\n' > "$out"
  for ((r = 0; r < ROUNDS; r++)); do
    for spec in "cold_d1 cold on-demand 1" "cold_d2 cold on-demand 2" "cold_d4 cold on-demand 4" \
      "warm_d1 warm on-demand 1" "warm_d4 warm on-demand 4" "fill cold fill 1"; do
      read -r kind temp mode depth <<<"$spec"
      for i in $(python3 lab/scripts/order.py row 3 "$r"); do
        arm=${arms[$i]} series="$F16" res=-
        if [[ "$temp" == cold ]]; then
          series="$FRESH/cell.sbnd"
          res=$(fresh "$F16" "$series")
        fi
        if [[ "$temp" == warm ]]; then
          serve "$arm" "$series" "$log"
          drive "${kind}_discard" "$arm" "$temp" "$mode" "$depth" "$ASKS" >/dev/null
          stop
        fi
        serve "$arm" "$series" "$log"
        row=$(drive "${kind}_r$r" "$arm" "$temp" "$mode" "$depth" "$ASKS" "$server")
        stop
        printf '%s\n' "$row" | awk -v m="$(field "$log" 'session reads' miss_rate)" \
          -v n="$(field "$log" 'session reads' named)" -v g="$(field "$log" 'session reads' ring)" -v res="$res" \
          'BEGIN{FS=OFS="\t"} { $(NF-1)=m; $NF=n; print $0, g, res }' >> "$out"
      done
    done
    echo "  round $r done $(date -u +%T)"
  done
  { python3 lab/scripts/workstation_summary.py server "$out" || echo "summary failed"; } | tee "$REPORT/server_summary.txt"
  mark server
}

# Row 258's script, from its branch, given its binaries: lab/scripts/exec_gap.sh <series> <out> [--quick].
exec_gap_run() {
  local script="${EXEC_GAP_SCRIPT:-$ROOT/lab/scripts/exec_gap.sh}"
  local series="$GAP_SERIES"
  echo "== execgap: $script, BIN_DIR=$exec_gap"
  [[ -x "$script" && -n "$exec_gap" ]] || {
    echo "execgap: needs --exec-gap BIN_DIR|build and $script (row 258's branch, or EXEC_GAP_SCRIPT): skipped"
    return 0
  }
  [[ -f "$series" ]] || OUT_ROOT="$WORK/fixtures" NAME=frames_499k_past_ram BYTES=499000 FRAMES="$PAST_RAM_FRAMES" \
    lab/scripts/gen_live_cell_fixture.sh
  BIN_DIR="${exec_gap#build}" ROUNDS="$ROUNDS" "$script" "$series" "$REPORT/execgap" $( ((quick)) && echo --quick) ||
    echo "execgap: exit $? (its output is above and in $REPORT/execgap)"
  mark execgap
}

build
want host && host
want ring && ring
want readers && readers
want server && server_cells
want execgap && exec_gap_run
mark total
tar -czf "$WORK/workstation-$STAMP.tar.gz" -C "$WORK" "report-$STAMP"
echo
echo "report: $WORK/workstation-$STAMP.tar.gz  (send this file)"
[[ -f "$REPORT/ROOT-STEPS.txt" ]] && { echo; cat "$REPORT/ROOT-STEPS.txt"; }
exit 0
