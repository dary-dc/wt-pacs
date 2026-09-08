#!/usr/bin/env bash
# Does the send path change what a stalled client costs the server?
# The confound this exists to rule out, and the prediction written before it ran:
# docs/measurements/mem/stall-client.md §5.
# Usage: [REPEATS=2] [NS="1 4 8 16"] stall_send_path_probe.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRV_BIN="${SRV_BIN:-$ROOT/target/release/exact-server}"
HARNESS="${HARNESS:-$ROOT/target/release/window-harness}"
FIXTURE="${FIXTURE:-frames_500x64k}"
STUDY="$ROOT/lab/fixtures/$FIXTURE/$FIXTURE.sbnd"
FRAME_COUNT=$(python3 -c "import json;print(json.load(open('$ROOT/lab/fixtures/$FIXTURE/metadata.json'))['frameCount'])")
PORT="${PORT:-14671}"
NS="${NS:-1 4 8 16}"
REPEATS="${REPEATS:-2}"
ASKS="${ASKS:-400}"
HOLD_MS="${HOLD_MS:-14000}"
STREAM_MODES="${STREAM_MODES:-shared per-frame}"
SEND_PATHS="${SEND_PATHS:-chunked copy split}"
OUT="${OUT:-$ROOT/.local/measurements/mem/stall_send_path.tsv}"

mkdir -p "$(dirname "$OUT")"
[ -s "$OUT" ] || printf 'send_path\tstream_mode\tclients\trun\tsrv_anon_kb\tsrv_base_anon_kb\tsrv_delta_anon_kb\tsrv_rss_kb\tsrv_base_rss_kb\tsrv_delta_rss_kb\tcli_anon_kb\tbytes_read\tunis\tstalled\talive\tvoid\tvoid_reason\n' > "$OUT"

anon_of() { awk '/^RssAnon:/{print $2}' /proc/"$1"/status 2>/dev/null || echo 0; }
rss_of()  { awk '/^VmRSS:/{print $2}'   /proc/"$1"/status 2>/dev/null || echo 0; }

for RUN in $(seq 1 "$REPEATS"); do
  for SP in $SEND_PATHS; do
    for SM in $STREAM_MODES; do
      for N in $NS; do
        RESDIR=$(mktemp -d)
        "$SRV_BIN" --port "$PORT" --study "$STUDY" --bind 127.0.0.1 --stream-mode "$SM" \
          --send-path "$SP" \
          --cert-pem "$ROOT/server/dev-cert/cert.pem" --key-pem "$ROOT/server/dev-cert/key.pem" \
          > /tmp/stallsp_srv.log 2>&1 &
        SRV=$!
        for _ in $(seq 1 80); do grep -q '^wt_url=' /tmp/stallsp_srv.log && break; sleep 0.1; done
        if ! kill -0 "$SRV" 2>/dev/null; then
          echo "server died ($SP): $(tail -3 /tmp/stallsp_srv.log)" >&2; rm -rf "$RESDIR"; continue
        fi
        BASE_ANON=$(anon_of "$SRV"); BASE_RSS=$(rss_of "$SRV")

        PIDS=()
        for i in $(seq 1 "$N"); do
          "$HARNESS" --url "https://127.0.0.1:$PORT/" --mode stall --stream-mode "$SM" \
            --bind 127.0.0.1 --frame-count "$FRAME_COUNT" --stall-after-ms 0 \
            --stall-asks "$ASKS" --stall-hold-ms "$HOLD_MS" --arm stallsp --json \
            > "$RESDIR/$i.json" 2>/dev/null &
          PIDS+=($!)
        done

        sleep 3
        PA=0; PR=0; PC=0
        for _ in $(seq 1 18); do
          a=$(anon_of "$SRV"); r=$(rss_of "$SRV")
          [ "${a:-0}" -gt "$PA" ] && PA=$a
          [ "${r:-0}" -gt "$PR" ] && PR=$r
          c=0; for p in "${PIDS[@]}"; do c=$((c + $(anon_of "$p"))); done
          [ "$c" -gt "$PC" ] && PC=$c
          sleep 0.4
        done

        for p in "${PIDS[@]}"; do wait "$p" 2>/dev/null; done
        kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null

        read -r BYTES UNIS STALLED ALIVE VOID REASON < <(python3 "$ROOT/lab/scripts/stall_gate.py" "$RESDIR" "$ASKS")
        rm -rf "$RESDIR"
        printf '%s\t%s\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%s\n' \
          "$SP" "$SM" "$N" "$RUN" "$PA" "$BASE_ANON" "$((PA - BASE_ANON))" \
          "$PR" "$BASE_RSS" "$((PR - BASE_RSS))" "$PC" \
          "$BYTES" "$UNIS" "$STALLED" "$ALIVE" "$VOID" "$REASON" | tee -a "$OUT"
      done
    done
  done
done

echo
echo "--- $OUT"
python3 "$ROOT/lab/scripts/stall_send_path_analyse.py" "$OUT"
