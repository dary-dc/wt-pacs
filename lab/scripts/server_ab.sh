#!/usr/bin/env bash
# Interleaved A/B of exact-server: HEAD against a worktree at <base-commit>.
# The driver is a client; both servers stay up for the whole run.
# `docs/disk-access/IMPLEMENTATION.md`.
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
FRAME_BYTES="${FRAME_BYTES:-16384}"
# Consecutive asks must clear the kernel read-ahead, or a cold cell is a hit cell wearing
# a cold label (§14.4). `read_campaign` strides 250 kB for the same reason.
STEP="${STEP:-$(( (250000 + FRAME_BYTES - 1) / FRAME_BYTES ))}"
RSS_SESSIONS="${RSS_SESSIONS:-64}"
RSS_ROUNDS="${RSS_ROUNDS:-6}"
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
  NO_COLOR=1 RUST_LOG=exact_server=info "$bin" \
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
(( ASKS * STEP <= frames )) || {
  echo "asks $ASKS x step $STEP exceeds $frames frames: the plan would revisit warm frames" >&2
  exit 1
}
read_fast_path_before=$(banner_val "$before_log" read_fast_path)
read_fast_path_after=$(banner_val "$after_log" read_fast_path)
{
  echo "before_pid $before_pid  read_fast_path=$read_fast_path_before"
  echo "after_pid $after_pid  read_fast_path=$read_fast_path_after"
  echo "frames $frames  step $STEP  asks $ASKS"
} | tee -a "$HOST"

printf 'label\tarm\ttemp\tmode\tdepth\tasks\tp50_ns\tp90_ns\tp99_ns\twall_ns\tasks_per_s\tcpu_ns_per_ask\trss_kib\tmiss_pct\tnamed\n' > "$OUT"

# CSI-stripped `key=number`; `[^0-9]*` after the key would read the 0 in `[0m`.
# `|| true`: no match yet is what the caller retries on, not a reason to end the run.
field_from_log() {
  local key="$1" log="$2" off="$3"
  tail -c +"$((off + 1))" "$log" | sed $'s/\x1b\\[[0-9;]*[A-Za-z]//g' |
    grep -oE "${key}=[0-9.eE+-]+" | tail -1 | grep -oE '[0-9.eE+-]+$' || true
}

drive() {
  local pid="$1" url="$2" arm="$3" label="$4" temp="$5" mode="$6" depth="$7" sessions="${8:-1}"
  "$DRIVER" --url "$url" --server-pid "$pid" --arm "$arm" --label "$label" \
    --temp "$temp" --mode "$mode" --depth "$depth" --asks "$ASKS" \
    --sessions "$sessions" --frames "$frames" --step "$STEP" --no-header
}

# A fill is sequential, so read-ahead turns it into hits by design: it is evicted like a
# cold cell but not held to the miss floor. Only the on-demand cells are.
emit() {
  local pid="$1" url="$2" log="$3" arm="$4" kind="$5" temp="$6" mode="$7" depth="$8"
  local sessions="${9:-1}"
  local label="${kind}_r${r}"
  local off row miss named
  off=$(wc -c <"$log")
  if [[ "$temp" == warm ]]; then
    drive "$pid" "$url" "$arm" "${kind}_warm_discard" "$temp" "$mode" "$depth" "$sessions" >/dev/null
    off=$(wc -c <"$log")
  else
    "$EVICT" "$TILE" >/dev/null
  fi
  row=$(drive "$pid" "$url" "$arm" "$label" "$temp" "$mode" "$depth" "$sessions")
  miss=""
  named=""
  for _ in $(seq 1 30); do
    miss=$(field_from_log miss_rate "$log" "$off")
    named=$(field_from_log named "$log" "$off")
    [[ -n "$miss" ]] && break
    sleep 0.1
  done
  [[ -n "$miss" ]] || {
    echo "no session-reads line for $label ($arm): the cold control is unreadable" >&2
    exit 1
  }
  row=$(printf '%s\n' "$row" | awk -v m="$miss" -v n="${named:--}" 'BEGIN{FS=OFS="\t"} { $(NF-1)=m; $NF=n; print }')
  printf '%s\n' "$row" >> "$OUT"
  if [[ "$temp" == cold && "$mode" == on-demand ]]; then
    python3 - "$miss" "$label" <<'PY'
import sys
# A stray hit is not a warm cell: measured, a cold cell reads 0.98-1.00 and the failure this
# guards against -- a stride inside the kernel's read-ahead -- reads 0.02-0.05. §16.2a.
m, label = float(sys.argv[1]), sys.argv[2]
if m < 0.95:
    sys.stderr.write(f"cold cell {label} miss_rate={m} < 0.95 -- raise STEP\n")
    sys.exit(1)
PY
  fi
  # HEAD logs named; 580e312 does not. Missing named on before is expected.
  # After at depth ≥ 2 must name at least two frames or W is not engaging.
  if [[ "$arm" == after && "$mode" == on-demand && "$depth" -ge 2 ]]; then
    python3 - "${named:--}" "$label" <<'PY'
import sys
raw, label = sys.argv[1], sys.argv[2]
try:
    n = float(raw)
except ValueError:
    sys.stderr.write(f"after cell {label} named={raw!r} (need >=2)\n")
    sys.exit(1)
if n < 2:
    sys.stderr.write(f"after cell {label} named={n} < 2 — W is not engaging\n")
    sys.exit(1)
PY
  fi
}

# Keyed by arm, not packed into one string: a URL has colons in it.
declare -A ARM_PID=([before]="$before_pid" [after]="$after_pid")
declare -A ARM_URL=([before]="https://127.0.0.1:${PORT_BEFORE}/" [after]="https://127.0.0.1:${PORT_AFTER}/")
declare -A ARM_LOG=([before]="$before_log" [after]="$after_log")

for ((r = 0; r < REPEATS; r++)); do
  if (( r % 2 == 0 )); then order=(before after); else order=(after before); fi
  for arm in "${order[@]}"; do
    pid="${ARM_PID[$arm]}"; url="${ARM_URL[$arm]}"; log="${ARM_LOG[$arm]}"
    emit "$pid" "$url" "$log" "$arm" "cold_d1" cold on-demand 1
    emit "$pid" "$url" "$log" "$arm" "cold_d2" cold on-demand 2
    emit "$pid" "$url" "$log" "$arm" "cold_d4" cold on-demand 4
    emit "$pid" "$url" "$log" "$arm" "warm_d1" warm on-demand 1
    emit "$pid" "$url" "$log" "$arm" "warm_d4" warm on-demand 4
    emit "$pid" "$url" "$log" "$arm" "fill"    cold fill 1
  done
  echo "  round $r done $(date -u +%T)" >&2
done

# Per-session memory needs an untouched heap, so each measurement gets its own server.
kill "$before_pid" "$after_pid" 2>/dev/null || true
before_pid="" ; after_pid=""
declare -A ARM_BIN=([before]="$BEFORE" [after]="$AFTER")
for ((r = 0; r < RSS_ROUNDS; r++)); do
  if (( r % 2 == 0 )); then order=(before after); else order=(after before); fi
  for arm in "${order[@]}"; do
    port=$((PORT_BEFORE + 100 + r * 2 + ${#arm}))
    log="$LOGDIR/rss_${arm}_$r.log" ; : >"$log"
    NO_COLOR=1 RUST_LOG=exact_server=info "${ARM_BIN[$arm]}" \
      --port "$port" --study "$TILE" --stream-mode shared --bind 127.0.0.1 \
      --cert-pem "$CERT" --key-pem "$KEY" >"$log" 2>&1 &
    pid=$!
    wait_banner "$log"
    "$DRIVER" --url "https://127.0.0.1:$port/" --server-pid "$pid" --arm "$arm" \
      --label "rss_d4_r$r" --temp warm --mode on-demand --depth 4 --asks "$ASKS" \
      --sessions "$RSS_SESSIONS" --frames "$frames" --step "$STEP" --no-header |
      awk 'BEGIN{FS=OFS="\t"} { $NF="-"; print }' >> "$OUT"
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
done
echo "  rss phase done $(date -u +%T)" >&2

python3 - "$OUT" "$RSS_SESSIONS" <<'PY'
import csv, collections, math, statistics as st, sys
DRIFT, MIN_N, path = 28.5, 5, sys.argv[1]
WANT = {
    "cold_d1": "tie",
    "cold_d2": "tie",
    "cold_d4": "win",
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

# RSS: per-session window memory only shows against many sessions (§15.4d).
rss = collections.defaultdict(list)
with open(path, newline="") as fh:
    for r in csv.DictReader(fh, delimiter="\t"):
        if r["label"].startswith("rss_d4_r") and r.get("rss_kib"):
            rss[r["arm"]].append(int(r["rss_kib"]))
if rss.get("before") and rss.get("after"):
    b, a = st.median(rss["before"]), st.median(rss["after"])
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 64
    print(f"rss_d4  {n} sessions  before {b:.0f} KiB  after {a:.0f} KiB  "
          f"delta {(a - b) / n:+.1f} KiB/session")

# Peak named at cold depth 4: before=2 after=4 is the §13 claim, without clocks.
print("named at cold depth=4 (median; before=2 after=4 is the §13 claim)")
named_d4 = collections.defaultdict(list)
with open(path, newline="") as fh:
    for r in csv.DictReader(fh, delimiter="\t"):
        if r.get("temp") != "cold" or r.get("mode") != "on-demand" or r.get("depth") != "4":
            continue
        try:
            named_d4[r["arm"]].append(int(float(r["named"])))
        except (TypeError, ValueError, KeyError):
            pass
for arm in ("before", "after"):
    xs = named_d4.get(arm) or []
    print(f"{arm}  cold_d4_named={st.median(xs) if xs else '-'}")

print(f"tsv: {path}")
sys.exit(1 if fail else 0)
PY
