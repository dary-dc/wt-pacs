#!/usr/bin/env bash
# Does a viewer that asks for a lot and then stops reading reach the flow-control ceilings?
# What is sampled, and every gate: docs/transport/measurements/mem/stall-client.md, appendix.
# Usage: [REPEATS=3] [NS="1 4 8 16"] [ASKS=400] stall_client_campaign.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRV_BIN="${SRV_BIN:-$ROOT/target/release/exact-server}"
HARNESS="${HARNESS:-$ROOT/target/release/window-harness}"
FIXTURE="${FIXTURE:-frames_500x64k}"
STUDY="$ROOT/lab/fixtures/$FIXTURE/$FIXTURE.sbnd"
FRAME_COUNT=$(python3 -c "import json;print(json.load(open('$ROOT/lab/fixtures/$FIXTURE/metadata.json'))['frameCount'])")
PORT="${PORT:-14631}"
NS="${NS:-1 4 8 16}"
REPEATS="${REPEATS:-3}"
# Must commit the server to more bytes than the ceiling under test: 400 asks is 25 MB.
ASKS="${ASKS:-400}"
HOLD_MS="${HOLD_MS:-16000}"
STREAM_MODES="${STREAM_MODES:-shared per-frame}"
OUT="${OUT:-$ROOT/.local/measurements/mem/stall_client.tsv}"

# The same bounded arm as mem_per_connection.sh, so the two sweeps are comparable.
BOUNDED_FLAGS="--receive-window 2000000 --send-window 200000"
ARMS="${ARMS:-default|;bounded|$BOUNDED_FLAGS}"

mkdir -p "$(dirname "$OUT")"
[ -s "$OUT" ] || printf 'arm\tstream_mode\tclients\trun\tsrv_anon_kb\tsrv_base_kb\tsrv_delta_kb\tcli_anon_kb\tasks\tbytes_read\tunis_opened\tstalled\talive\tvoid\tvoid_reason\n' > "$OUT"

anon_of() { awk '/^RssAnon:/{print $2}' /proc/"$1"/status 2>/dev/null || echo 0; }

for RUN in $(seq 1 "$REPEATS"); do
  IFS=';' read -r -a ARM_LIST <<< "$ARMS"
  for SPEC in "${ARM_LIST[@]}"; do
    LABEL="${SPEC%%|*}"; FLAGS="${SPEC#*|}"
    read -r -a SRV_FLAGS <<< "$FLAGS"
    for SM in $STREAM_MODES; do
      for N in $NS; do
        RESDIR=$(mktemp -d)
        "$SRV_BIN" --port "$PORT" --study "$STUDY" --bind 127.0.0.1 --stream-mode "$SM" \
          --cert-pem "$ROOT/server/dev-cert/cert.pem" --key-pem "$ROOT/server/dev-cert/key.pem" \
          "${SRV_FLAGS[@]}" > /tmp/stall_srv.log 2>&1 &
        SRV=$!
        for _ in $(seq 1 80); do grep -q '^wt_url=' /tmp/stall_srv.log && break; sleep 0.1; done
        if ! kill -0 "$SRV" 2>/dev/null; then
          echo "server died: $(tail -3 /tmp/stall_srv.log)" >&2; rm -rf "$RESDIR"; continue
        fi
        # Baseline before any client connects: the intercept this arm starts from.
        SRV_BASE=$(anon_of "$SRV")

        PIDS=()
        for i in $(seq 1 "$N"); do
          "$HARNESS" --url "https://127.0.0.1:$PORT/" --mode stall --stream-mode "$SM" \
            --bind 127.0.0.1 --frame-count "$FRAME_COUNT" --stall-after-ms 0 \
            --stall-asks "$ASKS" --stall-hold-ms "$HOLD_MS" --arm stall --json \
            > "$RESDIR/$i.json" 2>/dev/null &
          PIDS+=($!)
        done

        # Let every client connect, ask its backlog and stall before sampling. Sampling
        # earlier would catch the handshake rather than the stalled state.
        sleep 3
        PEAK_SRV=0; PEAK_CLI=0
        for _ in $(seq 1 20); do
          s=$(anon_of "$SRV")
          [ "${s:-0}" -gt "$PEAK_SRV" ] && PEAK_SRV=$s
          c=0
          for p in "${PIDS[@]}"; do c=$((c + $(anon_of "$p"))); done
          [ "$c" -gt "$PEAK_CLI" ] && PEAK_CLI=$c
          sleep 0.4
        done

        for p in "${PIDS[@]}"; do wait "$p" 2>/dev/null; done
        kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null

        # Aggregate the clients' own gates. One failure voids the row.
        read -r BYTES UNIS STALLED ALIVE VOID REASON < <(python3 "$ROOT/lab/transport/scripts/stall_gate.py" "$RESDIR" "$ASKS")
        rm -rf "$RESDIR"
        printf '%s\t%s\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%s\n' \
          "$LABEL" "$SM" "$N" "$RUN" "$PEAK_SRV" "$SRV_BASE" "$((PEAK_SRV - SRV_BASE))" \
          "$PEAK_CLI" "$ASKS" "$BYTES" "$UNIS" "$STALLED" "$ALIVE" "$VOID" "$REASON" \
          | tee -a "$OUT"
      done
    done
  done
done

echo
echo "--- $OUT"
python3 "$ROOT/lab/transport/scripts/stall_analyse.py" "$OUT"
