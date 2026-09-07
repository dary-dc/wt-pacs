#!/usr/bin/env bash
# The pathological client, measured: does a viewer that asks for a lot and then stops
# reading reach the flow-control ceilings?
#
# `docs/measurements/mem/README.md` ends by naming this as the one case its two sweeps
# could not produce — *"What would actually reach the ceiling is a client that asks for a
# lot and then stops reading entirely… This harness always reads, so it cannot produce that
# case, and this measurement therefore does not rule it out."* The conclusions document
# carries "bound the windows … as a bound on the pathological case" on that unmeasured
# premise. `--mode stall` produces the case; this script measures it.
#
# WHAT IS SAMPLED, AND WHY BOTH ENDS
#
# Server RssAnon alone cannot answer the question. The bytes a stalled client refuses to
# read do not evaporate — they queue somewhere, and *which* end holds them is the whole
# finding. A sweep that watched only the server would see a flat line and could not
# distinguish "the ceiling bounds the server" from "the bytes went to the client instead".
# So every row carries both, and `cli_anon_kb` is the sum over all client processes.
#
# RssAnon, not RSS, for the reason `mem_per_connection.sh` documents at length: the study
# file is mmapped, so RSS counts file-backed pages that are the fixture rather than the
# connection, and they would swamp the effect.
#
# GATES — a row that fails any of these measured something other than a stalled client
#
#   stall_engaged            the deadline passed while the run was live
#   bytes_read > 0           data was actually flowing, so refusing to read stranded some
#   connection_alive_at_end  the connection survived; a dead one measures teardown
#   asks_sent == requested   the server was committed to the full backlog
#
# Failures are written to the TSV with void=1 rather than dropped. Deleting them would
# flatter whichever arm fails more often — the exact bias this project has already
# committed once (see `docs/HANDOFF.md` §5).
#
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
# Asks per client. Must commit the server to more bytes than the ceiling under test: at
# 64 KB frames, quinn's 10 MB default send_window needs ~160. 400 is 25 MB, comfortably
# past it, so a server that is *not* bounded by something else will show it.
ASKS="${ASKS:-400}"
HOLD_MS="${HOLD_MS:-16000}"
STREAM_MODES="${STREAM_MODES:-shared per-frame}"
OUT="${OUT:-$ROOT/.local/measurements/mem/stall_client.tsv}"

# Same bounded arm as `mem_per_connection.sh`, so the two sweeps are directly comparable:
# send_window from the spec's own rule (10 Mbps x 150 ms ~ 190 KB) and a finite
# receive_window, because "unlimited is not a policy".
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
        read -r BYTES UNIS STALLED ALIVE VOID REASON < <(python3 - "$RESDIR" "$ASKS" <<'PY'
import glob, json, sys
d, asks = sys.argv[1], int(sys.argv[2])
files = sorted(glob.glob(d + "/*.json"))
bytes_read = unis = 0
stalled = alive = True
reasons = []
if not files:
    reasons.append("no-client-output")
for f in files:
    try:
        o = json.load(open(f))
    except Exception:
        reasons.append("unparseable-client-output"); stalled = alive = False; continue
    bytes_read += o["bytes_read"]; unis += o["uni_streams_opened"]
    stalled &= o["stall_engaged"]; alive &= o["connection_alive_at_end"]
    if not o["stall_engaged"]: reasons.append("stall-never-engaged")
    if o["bytes_read"] == 0: reasons.append("no-bytes-read")
    if not o["connection_alive_at_end"]: reasons.append("connection-died")
    if o["asks_sent"] != asks: reasons.append("asks-truncated")
void = 1 if reasons else 0
print(bytes_read, unis, int(stalled), int(alive), void, ",".join(sorted(set(reasons))) or "-")
PY
)
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
python3 "$ROOT/lab/scripts/stall_analyse.py" "$OUT"
