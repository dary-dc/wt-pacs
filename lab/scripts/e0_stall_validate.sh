#!/usr/bin/env bash
# E0-STALL — does `--mode stall` actually produce a client that stops reading?
#
# A failure here voids the stalled-client campaign before it runs. The question is not
# "are the numbers good" but "is this client doing the thing its name claims". Every
# invalidated campaign in this project (`docs/HANDOFF.md` §5) was a guard that watched the
# measurement instead of the mechanism, and a stalled client is unusually easy to get
# wrong: a run that quietly read everything, and one whose connection died on the first
# blocked write, both produce a flat server-memory line and both look like a null result.
#
# The validation is a two-sided contrast in **one binary, one code path, one flag**:
#
#   PARKED   `--stall-after-ms 0`      stalls on the first byte
#   READING  `--stall-after-ms 60000`  deadline outside the run, so it never stalls
#
# The known answer is the READING arm's byte count. The client asks for exactly ASKS
# frames of exactly 64 000 bytes and the wire adds an 8-byte envelope, so a client that
# reads to completion must read exactly ASKS x 64008 bytes — a number derived before the
# run rather than read off it. Same shape as `e0_r6_reader_validate.sh`, whose open-loop
# reader was validated against a cell where the closed-loop reader strands exactly 0.00 MB.
#
# Passes only if all five hold:
#   1. READING reads exactly ASKS x 64008 bytes     (the instrument reads when told to)
#   2. PARKED reads less than one frame             (the stall actually engages)
#   3. both keep the connection alive to the end    (a stall, not a teardown)
#   4. PARKED sits on far more memory than it read  (bytes arrived and were withheld)
#   5. READING reads far more than it sits on       (its buffers are transient, not held)
#
# Rules 4 and 5 are the pair that separates "stopped reading" from "was never sent
# anything", and they are deliberately ratios against each run's *own* byte count rather
# than an absolute megabyte threshold. An absolute threshold silently encodes the window
# size: in `shared` a single 1.25 MB stream receive window caps what can be withheld at
# all, so a ">1 MB stranded" rule fails a perfectly good stall for a reason that has
# nothing to do with the client's behaviour. It did, on this gate's first run.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRV="${SRV_BIN:-$ROOT/target/release/exact-server}"
HARNESS="$ROOT/target/release/window-harness"
FIXTURE="${FIXTURE:-frames_500x64k}"
STUDY="$ROOT/lab/fixtures/$FIXTURE/$FIXTURE.sbnd"
SPORT=${SPORT:-14651}
ASKS=${ASKS:-200}
SM=${SM:-shared}
# 64 000 payload + 4 B length prefix + 4 B frame index. Derived, not observed.
FRAME_WIRE=64008
EXPECT=$((ASKS * FRAME_WIRE))

run_one() {
  local label=$1 after=$2 hold=$3
  "$SRV" --port "$SPORT" --study "$STUDY" --bind 127.0.0.1 --stream-mode "$SM" \
    --cert-pem "$ROOT/server/dev-cert/cert.pem" --key-pem "$ROOT/server/dev-cert/key.pem" \
    > /tmp/e0stall_srv.log 2>&1 &
  local s=$!
  for _ in $(seq 1 80); do grep -q '^wt_url=' /tmp/e0stall_srv.log && break; sleep 0.1; done
  # Launched without a `timeout` wrapper so `$!` is the harness itself. Wrapping it makes
  # `$!` the wrapper's pid, and sampling /proc for that reports the wrapper's few hundred
  # kB — which is how this gate first reported an identical 0.10 MB for both arms.
  "$HARNESS" --url "https://127.0.0.1:$SPORT/" --mode stall --stream-mode "$SM" \
    --bind 127.0.0.1 --frame-count 500 --stall-after-ms "$after" --stall-asks "$ASKS" \
    --stall-hold-ms "$hold" --arm "e0stall_$label" --json > "/tmp/e0stall_$label.json" 2>/dev/null &
  local h=$!
  echo 0 > "/tmp/e0stall_$label.peak"
  ( peak=0
    while kill -0 "$h" 2>/dev/null; do
      a=$(awk '/^RssAnon:/{print $2}' /proc/"$h"/status 2>/dev/null || echo 0)
      [ "${a:-0}" -gt "$peak" ] && peak=$a
      echo "$peak" > "/tmp/e0stall_$label.peak"
      sleep 0.25
    done ) &
  local mon=$!
  wait "$h" 2>/dev/null
  kill "$mon" 2>/dev/null; wait "$mon" 2>/dev/null
  kill "$s" 2>/dev/null; wait "$s" 2>/dev/null
}

echo "E0-STALL — stream_mode=$SM asks=$ASKS  expected full read = $EXPECT bytes"
echo
run_one reading 60000 6000
run_one parked  0     14000

python3 "$ROOT/lab/scripts/e0_stall_checks.py" "$EXPECT" "$FRAME_WIRE"
