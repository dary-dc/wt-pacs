#!/usr/bin/env bash
# Interleaved A/B of exact-server: HEAD against a worktree at <base-commit>.
# The driver is a client; both servers stay up for the whole run.
# `docs/disk-access/READ-PATH-DESIGN.md` §15.4.
#
#   lab/scripts/server_ab.sh <base-commit>
#
# Prints tie / RESOLVED per A/B cell under the 28.5 % / 0.8n / MIN_N=5 rule on p50.
# A number from the sandbox is not evidence (§14.4); this is the workstation command.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
BASE="${1:?usage: lab/scripts/server_ab.sh <base-commit>}"
REPEATS="${REPEATS:-12}"
ASKS="${ASKS:-256}"
OUT="${OUT:-$ROOT/docs/disk-access/server_ab.tsv}"
HOST="${HOST:-$ROOT/docs/disk-access/server_ab_host.txt}"
TILE="${TILE:-$ROOT/lab/fixtures/frames_16k_big/frames_16k_big.sbnd}"
WT="${WT:-$(mktemp -d /tmp/server-ab-XXXX)}"
CERT="${CERT:-$ROOT/server/dev-cert/cert.pem}"
KEY="${KEY:-$ROOT/server/dev-cert/key.pem}"
PORT_BEFORE="${PORT_BEFORE:-14433}"
PORT_AFTER="${PORT_AFTER:-14434}"
LOGDIR="${LOGDIR:-$(mktemp -d /tmp/server-ab-logs-XXXX)}"

ensure_fixture() {
  local path="$1" name="$2" bytes="$3" frames="$4"
  [[ -f "$path" ]] && return
  echo "generating $name ($frames × $bytes B)" >&2
  NAME="$name" BYTES="$bytes" FRAMES="$frames" lab/scripts/gen_live_cell_fixture.sh
}

[[ -f "$CERT" && -f "$KEY" ]] || bash server/scripts/gen_dev_cert.sh
ensure_fixture "$TILE" frames_16k_big 16384 5120

before_pid="" after_pid=""
cleanup() {
  [[ -n "$before_pid" ]] && kill "$before_pid" 2>/dev/null || true
  [[ -n "$after_pid" ]] && kill "$after_pid" 2>/dev/null || true
  git worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"
}
trap cleanup EXIT

echo "worktree $WT at $BASE" >&2
git worktree add --detach "$WT" "$BASE"
(cd "$WT" && cargo build -p exact-server --bin exact-server --release)
cargo build -p exact-server --bin exact-server --release
cargo build -p disk-access-bench --bin server_ab --bin evict --release

BEFORE="$WT/target/release/exact-server"
AFTER="$ROOT/target/release/exact-server"
DRIVER="$ROOT/target/release/server_ab"
EVICT="$ROOT/target/release/evict"
[[ -x "$BEFORE" && -x "$AFTER" && -x "$DRIVER" && -x "$EVICT" ]] || {
  echo "build missing exact-server or server_ab" >&2
  exit 1
}

{
  echo "host $(hostname)"
  echo "date $(date -u +%FT%TZ)"
  echo "HEAD $(git rev-parse HEAD)"
  echo "base $BASE ($(git rev-parse "$BASE"))"
  echo "study $TILE"
  echo "stream_mode shared"
  if command -v check-fastpath >/dev/null 2>&1 || [[ -x "$ROOT/target/release/check-fastpath" ]]; then
    echo "check-fastpath"
    "$ROOT/target/release/check-fastpath" "$TILE" || cargo run -q -p check-fastpath -- "$TILE" || true
  else
    cargo run -q -p check-fastpath -- "$TILE" || true
  fi
} | tee "$HOST"

start_server() {
  local bin="$1" port="$2" log="$3"
  RUST_LOG=exact_server=info "$bin" \
    --port "$port" --study "$TILE" --stream-mode shared --bind 127.0.0.1 \
    --cert-pem "$CERT" --key-pem "$KEY" >"$log" 2>&1 &
  echo $!
}

wait_banner() {
  local out="$1"
  for _ in $(seq 1 400); do
    grep -q '^wt_url=' "$out" 2>/dev/null && return
    sleep 0.05
  done
  echo "server never printed wt_url ($out)" >&2
  cat "$out" >&2 || true
  exit 1
}

banner_val() {
  local out="$1" key="$2"
  sed -n "s/^${key}=//p" "$out" | head -1
}

before_log="$LOGDIR/before.log"
after_log="$LOGDIR/after.log"
: >"$before_log" ; : >"$after_log"

before_pid=$(start_server "$BEFORE" "$PORT_BEFORE" "$before_log")
after_pid=$(start_server "$AFTER" "$PORT_AFTER" "$after_log")
wait_banner "$before_log"
wait_banner "$after_log"

frames=$(banner_val "$after_log" frames)
read_fast_path_before=$(banner_val "$before_log" read_fast_path)
read_fast_path_after=$(banner_val "$after_log" read_fast_path)
{
  echo "before_pid $before_pid  read_fast_path=$read_fast_path_before"
  echo "after_pid $after_pid  read_fast_path=$read_fast_path_after"
  echo "frames $frames"
} | tee -a "$HOST"

printf 'label\tarm\ttemp\tmode\tdepth\tasks\tp50_ns\tp90_ns\tp99_ns\twall_ns\tasks_per_s\tcpu_ns_per_ask\trss_kib\tmiss_pct\n' > "$OUT"

miss_from_log() {
  local log="$1" off="$2"
  tail -c +"$((off + 1))" "$log" | grep -oE 'miss_rate=[0-9.eE+-]+' | tail -1 | cut -d= -f2
}

drive() {
  local pid="$1" url="$2" arm="$3" label="$4" temp="$5" mode="$6" depth="$7" sessions="${8:-1}"
  "$DRIVER" --url "$url" --server-pid "$pid" --arm "$arm" --label "$label" \
    --temp "$temp" --mode "$mode" --depth "$depth" --asks "$ASKS" \
    --sessions "$sessions" --frames "$frames" --no-header
}

emit() {
  local pid="$1" url="$2" log="$3" arm="$4" kind="$5" temp="$6" mode="$7" depth="$8"
  local label="${kind}_r${r}"
  local off row miss
  off=$(wc -c <"$log")
  if [[ "$temp" == warm ]]; then
    drive "$pid" "$url" "$arm" "${kind}_warm_discard" "$temp" "$mode" "$depth" >/dev/null
    off=$(wc -c <"$log")
  else
    "$EVICT" "$TILE" >/dev/null
  fi
  row=$(drive "$pid" "$url" "$arm" "$label" "$temp" "$mode" "$depth")
  miss=""
  for _ in $(seq 1 20); do
    miss=$(miss_from_log "$log" "$off")
    [[ -n "$miss" ]] && break
    sleep 0.1
  done
  [[ -n "$miss" ]] || miss="-"
  row=$(printf '%s\n' "$row" | awk -v m="$miss" 'BEGIN{FS=OFS="\t"} { $NF=m; print }')
  printf '%s\n' "$row" >> "$OUT"
  if [[ "$temp" == cold && "$miss" != "-" ]]; then
    python3 - "$miss" "$label" <<'PY'
import sys
m, label = float(sys.argv[1]), sys.argv[2]
if m < 0.99:
    sys.stderr.write(f"cold cell {label} miss_rate={m} < 0.99\n")
    sys.exit(1)
PY
  fi
}

url_before="https://127.0.0.1:${PORT_BEFORE}/"
url_after="https://127.0.0.1:${PORT_AFTER}/"

for ((r = 0; r < REPEATS; r++)); do
  if (( r % 2 == 0 )); then
    order=("before:$before_pid:$url_before:$before_log" "after:$after_pid:$url_after:$after_log")
  else
    order=("after:$after_pid:$url_after:$after_log" "before:$before_pid:$url_before:$before_log")
  fi
  for spec in "${order[@]}"; do
    arm="${spec%%:*}"; rest="${spec#*:}"
    pid="${rest%%:*}"; rest="${rest#*:}"
    url="${rest%%:*}"; log="${rest#*:}"
    emit "$pid" "$url" "$log" "$arm" "cold_d1" cold on-demand 1
    emit "$pid" "$url" "$log" "$arm" "cold_d2" cold on-demand 2
    emit "$pid" "$url" "$log" "$arm" "cold_d4" cold on-demand 4
    emit "$pid" "$url" "$log" "$arm" "warm_d1" warm on-demand 1
    emit "$pid" "$url" "$log" "$arm" "warm_d4" warm on-demand 4
    emit "$pid" "$url" "$log" "$arm" "fill"    cold fill 1
  done
  echo "  round $r done $(date -u +%T)" >&2
done

python3 - "$OUT" <<'PY'
import csv, collections, math, statistics as st, sys
DRIFT, MIN_N, path = 28.5, 5, sys.argv[1]
WANT = {
    "cold_d1": "tie",
    "cold_d2": "win",
    "cold_d4": "win_or_tie",
    "warm_d1": "tie",
    "warm_d4": "tie",
    "fill": "tie",
}
cells = collections.defaultdict(dict)
with open(path, newline="") as fh:
    for r in csv.DictReader(fh, delimiter="\t"):
        if r["arm"] not in ("before", "after") or not r.get("p50_ns"):
            continue
        kind, sep, rnd = r["label"].rpartition("_r")
        if not sep:
            continue
        cells[(kind, rnd)][r["arm"]] = int(r["p50_ns"])

print(f"{'cell':<12} {'n':>3}  {'p50 Δ':>11}  {'signs':>7}  {'verdict':<9}  {'want':<10}  {'before':>9}  {'after':>9}")
fail = 0
for kind in ["cold_d1", "cold_d2", "cold_d4", "warm_d1", "warm_d4", "fill"]:
    ds, b, a = [], [], []
    for (k, _rep), arms in cells.items():
        if k != kind or "before" not in arms or "after" not in arms:
            continue
        x, y = arms["before"], arms["after"]
        if not x:
            continue
        ds.append((y - x) / x * 100); b.append(x); a.append(y)
    want = WANT[kind]
    if len(ds) < MIN_N:
        print(f"{kind:<12} {len(ds):>3}  {'n/a':>11}  {'—':>7}  {'n<5':<9}  {want:<10}")
        continue
    med = st.median(ds)
    agree = max(sum(1 for d in ds if d < 0), sum(1 for d in ds if d > 0))
    resolved = abs(med) >= DRIFT and agree >= math.ceil(0.8 * len(ds))
    verdict = "RESOLVED" if resolved else "tie"
    ok = True
    if want == "tie" and resolved:
        ok = False
    if want == "win" and not (resolved and med < 0):
        ok = False
    if want == "win_or_tie" and resolved and med > 0:
        ok = False
    if not ok:
        fail += 1
    print(f"{kind:<12} {len(ds):>3}  {med:>+10.1f}%  {agree:>3}/{len(ds):<3}  {verdict:<9}  {want:<10}  {st.median(b):>9.0f}  {st.median(a):>9.0f}")

# HEAD depth ladder on asks/s (after arm only).
ladder = collections.defaultdict(list)
with open(path, newline="") as fh:
    for r in csv.DictReader(fh, delimiter="\t"):
        if r["arm"] != "after" or r.get("mode") != "on-demand" or r.get("temp") != "cold":
            continue
        kind, sep, _ = r["label"].rpartition("_r")
        if kind in ("cold_d1", "cold_d2", "cold_d4") and r.get("asks_per_s"):
            ladder[kind].append(float(r["asks_per_s"]))
if all(len(ladder[k]) >= 1 for k in ("cold_d1", "cold_d2", "cold_d4")):
    d1, d2, d4 = (st.median(ladder[k]) for k in ("cold_d1", "cold_d2", "cold_d4"))
    r2 = (d2 / d1 - 1) * 100 if d1 else 0
    r4 = (d4 / d2 - 1) * 100 if d2 else 0
    print(f"ladder after  d1={d1:.0f}/s  d2={d2:.0f}/s ({r2:+.1f}%)  d4={d4:.0f}/s ({r4:+.1f}% vs d2)")

print(f"tsv: {path}")
sys.exit(1 if fail else 0)
PY
