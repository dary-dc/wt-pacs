#!/usr/bin/env bash
# L4 — p95 time-to-displayable across deployment cells, through `netsim`.
#
# Pre-registration: docs/lanes/L4-preregistration.md. Arms are interleaved WITHIN each
# repeat (not run one arm at a time) because host drift has already produced one wrong
# answer in this work. Records the stop-condition instruments alongside every row:
# peak_outstanding, client CPU, netsim CPU.
#
# Usage: EXP=e1 ARMS="a|flags;b|flags" CELLS="A B C" FIXTURE=frames_32k l4_campaign.sh <repeats>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REPEATS="${1:-3}"
EXP="${EXP:?set EXP}"
ARMS="${ARMS:?set ARMS as 'label|server flags;label|server flags'}"
CELLS="${CELLS:-A B C}"
FIXTURE="${FIXTURE:-frames_32k}"
DEPTH="${DEPTH:-4}"
TRACE="${TRACE:-$ROOT/lab/traces/x3_short_scroll.json}"
OUT="${OUT:-$ROOT/.local/measurements/l4/$EXP.tsv}"
SRV_BIN="${SRV_BIN:-$ROOT/target/lab-arms/exact-server-seg10}"
HARNESS="$ROOT/target/release/window-harness"
NETSIM="$ROOT/target/release/netsim"
SPORT="${SPORT:-14433}"; NPORT="${NPORT:-15000}"
STUDY="$ROOT/lab/fixtures/$FIXTURE/$FIXTURE.sbnd"
FRAME_COUNT=$(python3 -c "import json;print(json.load(open('$ROOT/lab/fixtures/$FIXTURE/metadata.json'))['frameCount'])")
TICK=$(getconf CLK_TCK)

# cell -> one-way delay ms, rate Mbps, per-direction loss %
cell_params() {
  case "$1" in
    A) echo "15 50 0.0" ;;
    B) echo "30 25 0.5" ;;
    C) echo "75 10 2.0" ;;
    *) echo "unknown cell $1" >&2; exit 1 ;;
  esac
}

mkdir -p "$(dirname "$OUT")"
[ -s "$OUT" ] || printf 'exp\tarm\tcell\trtt_ms\trate_mbps\tloss_pct\tfixture\tdepth\trun\tp95_wait_ms\tmean_wait_ms\tfill_rate\tpeak_outstanding\twait_samples\tsrv_cpu_s\tcli_cpu_s\tns_cpu_s\twall_s\n' > "$OUT"

cpu_of() { awk -v t="$TICK" '{print ($14+$15)/t}' /proc/"$1"/stat 2>/dev/null || echo 0; }

for RUN in $(seq 1 "$REPEATS"); do
  for CELL in $CELLS; do
    read -r DELAY RATE LOSS <<< "$(cell_params "$CELL")"
    # Interleave arms inside the repeat so host drift is common-mode.
    IFS=';' read -r -a ARM_LIST <<< "$ARMS"
    for SPEC in "${ARM_LIST[@]}"; do
      LABEL="${SPEC%%|*}"; FLAGS="${SPEC#*|}"
      read -r -a SRV_FLAGS <<< "$FLAGS"

      # env-prefixed flags of the form ENV:NAME=VAL are lifted out of the flag list
      ENVS=(); KEEP=()
      for f in "${SRV_FLAGS[@]}"; do
        case "$f" in ENV:*) ENVS+=("${f#ENV:}") ;; *) KEEP+=("$f") ;; esac
      done

      env "${ENVS[@]}" "$SRV_BIN" --port "$SPORT" --study "$STUDY" --bind 127.0.0.1 \
        --cert-pem "$ROOT/server/dev-cert/cert.pem" --key-pem "$ROOT/server/dev-cert/key.pem" \
        "${KEEP[@]}" > /tmp/l4_server.log 2>&1 &
      SRV=$!
      for _ in $(seq 1 60); do grep -q '^wt_url=' /tmp/l4_server.log && break; sleep 0.1; done
      kill -0 "$SRV" 2>/dev/null || { echo "server died: $(tail -3 /tmp/l4_server.log)" >&2; exit 1; }

      "$NETSIM" --listen 127.0.0.1:"$NPORT" --upstream 127.0.0.1:"$SPORT" \
        --delay-ms "$DELAY" --rate-mbps "$RATE" --loss-pct "$LOSS" --queue-pkts 500 \
        > /tmp/l4_netsim.log 2>&1 &
      NS=$!; sleep 0.4

      # stream mode must match on both ends; take it from the arm flags
      SM=shared; case " ${KEEP[*]} " in *" per-frame "*) SM=per-frame ;; esac

      S0=$(cpu_of "$SRV"); N0=$(cpu_of "$NS"); W0=$(date +%s.%N)
      timeout 180 "$HARNESS" --url "https://127.0.0.1:$NPORT/" --mode trace --trace "$TRACE" \
        --read-bps 0 --depth "$DEPTH" --frame-count "$FRAME_COUNT" --stream-mode "$SM" \
        --bind 127.0.0.1 --arm "$LABEL" --json > /tmp/l4_run.json 2>/dev/null &
      CLI=$!; CLI_CPU=0
      # `timeout` is the direct child; the harness is its child. Measuring $CLI would
      # measure `timeout` and always report ~0, silently disabling stop condition 3.
      HPID=""
      while kill -0 "$CLI" 2>/dev/null; do
        [ -n "$HPID" ] || HPID=$(pgrep -P "$CLI" 2>/dev/null | head -1)
        [ -n "$HPID" ] && CLI_CPU=$(cpu_of "$HPID")
        sleep 0.15
      done
      wait "$CLI" || true
      W1=$(date +%s.%N); S1=$(cpu_of "$SRV"); N1=$(cpu_of "$NS")
      kill "$NS" "$SRV" 2>/dev/null || true; wait "$NS" "$SRV" 2>/dev/null || true

      python3 - "$EXP" "$LABEL" "$CELL" "$((DELAY*2))" "$RATE" "$LOSS" "$FIXTURE" "$DEPTH" \
               "$RUN" "$S0" "$S1" "$CLI_CPU" "$N0" "$N1" "$W0" "$W1" "$OUT" /tmp/l4_run.json <<'PYEOF'
import json, sys
(exp, arm, cell, rtt, rate, loss, fx, depth, run,
 s0, s1, cli, n0, n1, w0, w1, out, jf) = sys.argv[1:19]
try:
    m = json.load(open(jf))
except Exception:
    print("VOID %s %s %s run %s — harness produced no JSON" % (exp, arm, cell, run)); sys.exit(0)
wall = float(w1) - float(w0)
row = "\t".join([exp, arm, cell, rtt, rate, loss, fx, depth, run,
                 "%.2f" % m["p95_wait_ms"], "%.2f" % m["mean_wait_ms"], "%.2f" % m["fill_rate"],
                 str(m["peak_outstanding"]), str(m["wait_samples"]),
                 "%.3f" % (float(s1)-float(s0)), "%.3f" % float(cli),
                 "%.3f" % (float(n1)-float(n0)), "%.2f" % wall])
print(row)
open(out, "a").write(row + "\n")
PYEOF
    done
  done
done
