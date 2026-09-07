#!/usr/bin/env bash
# Does a *hostile* stalled client — one that widens its own receive window first — reach
# the server's `send_window`?
#
# The main campaign (`stall_client_campaign.sh`) uses a stalled client with stack-default
# windows and finds the server unmoved. That result has an obvious objection: the client's
# own 1.25 MB `stream_receive_window` is what bounds the server, so a client that simply
# advertises a larger one should be able to push the server further — and quinn's 10 MB
# default `send_window` is the ceiling `transport-conclusions.md` recommends bounding.
#
# This sweeps that window and reports where the arrangement gives out. It is a probe, not
# a campaign: n = 1 per point, no repeats, and its output is a *shape*, not a number.
#
# Read `alive` first. A row where the connection died measured a teardown, and the memory
# figures beside it describe the moments before one — reportable as the failure mode, never
# as a per-connection cost.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRV="${SRV_BIN:-$ROOT/target/release/exact-server}"
HARNESS="$ROOT/target/release/window-harness"
FIXTURE="${FIXTURE:-frames_500x64k}"
STUDY="$ROOT/lab/fixtures/$FIXTURE/$FIXTURE.sbnd"
SPORT=${SPORT:-14661}
ASKS=${ASKS:-400}
HOLD_MS=${HOLD_MS:-12000}
SM=${SM:-shared}
# Stream receive windows to advertise. "default" leaves the flag off (quinn's 1.25 MB).
WINDOWS="${WINDOWS:-default 4194304 16777216 67108864 134217728}"
ARMS="${ARMS:-default|;bounded|--receive-window 2000000 --send-window 200000}"
OUT="${OUT:-$ROOT/.local/measurements/mem/stall_wide_window.tsv}"

mkdir -p "$(dirname "$OUT")"
[ -s "$OUT" ] || printf 'arm\tstream_mode\tclient_window\tsrv_base_kb\tsrv_peak_kb\tsrv_delta_kb\tcli_held_kb\tbytes_read\tunis\talive\tclose_reason\n' > "$OUT"

anon_of() { awk '/^RssAnon:/{print $2}' /proc/"$1"/status 2>/dev/null || echo 0; }

IFS=';' read -r -a ARM_LIST <<< "$ARMS"
for SPEC in "${ARM_LIST[@]}"; do
  LABEL="${SPEC%%|*}"; FLAGS="${SPEC#*|}"
  read -r -a SRV_FLAGS <<< "$FLAGS"
  for W in $WINDOWS; do
    CLI_FLAGS=()
    [ "$W" != "default" ] && CLI_FLAGS=(--stream-recv-window "$W")

    "$SRV" --port "$SPORT" --study "$STUDY" --bind 127.0.0.1 --stream-mode "$SM" \
      --cert-pem "$ROOT/server/dev-cert/cert.pem" --key-pem "$ROOT/server/dev-cert/key.pem" \
      "${SRV_FLAGS[@]}" > /tmp/stallwin_srv.log 2>&1 &
    SRV_PID=$!
    for _ in $(seq 1 80); do grep -q '^wt_url=' /tmp/stallwin_srv.log && break; sleep 0.1; done
    kill -0 "$SRV_PID" 2>/dev/null || { echo "server died" >&2; continue; }
    BASE=$(anon_of "$SRV_PID")

    "$HARNESS" --url "https://127.0.0.1:$SPORT/" --mode stall --stream-mode "$SM" \
      --bind 127.0.0.1 --frame-count 500 --stall-after-ms 0 --stall-asks "$ASKS" \
      --stall-hold-ms "$HOLD_MS" --arm widewin "${CLI_FLAGS[@]}" --json \
      > /tmp/stallwin_cli.json 2>/dev/null &
    CLI=$!

    sleep 2
    PS=0; PC=0
    while kill -0 "$CLI" 2>/dev/null; do
      s=$(anon_of "$SRV_PID"); c=$(anon_of "$CLI")
      [ "${s:-0}" -gt "$PS" ] && PS=$s
      [ "${c:-0}" -gt "$PC" ] && PC=$c
      sleep 0.3
    done
    wait "$CLI" 2>/dev/null
    kill "$SRV_PID" 2>/dev/null; wait "$SRV_PID" 2>/dev/null

    python3 - "$LABEL" "$SM" "$W" "$BASE" "$PS" "$PC" "$OUT" <<'PYWIN'
import json, sys
label, sm, w, base, peak, held, out = sys.argv[1:8]
base, peak, held = int(base), int(peak), int(held)
try:
    o = json.load(open("/tmp/stallwin_cli.json"))
except Exception:
    o = {"bytes_read": 0, "uni_streams_opened": 0,
         "connection_alive_at_end": False, "close_reason": "no-output"}
row = (f"{label}\t{sm}\t{w}\t{base}\t{peak}\t{peak - base}\t{held}\t"
       f"{o['bytes_read']}\t{o['uni_streams_opened']}\t"
       f"{int(o['connection_alive_at_end'])}\t{o['close_reason'] or '-'}")
print(row)
open(out, "a").write(row + "\n")
PYWIN
  done
done

echo
echo "--- $OUT"
python3 -c "
import sys
rows=[l.rstrip(chr(10)).split(chr(9)) for l in open(sys.argv[1]) if l.strip()]
w=[max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
for r in rows: print('  '.join(c.ljust(w[i]) for i,c in enumerate(r)))
" "$OUT"
