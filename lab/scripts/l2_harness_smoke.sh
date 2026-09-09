#!/usr/bin/env bash
# L2 harness smoke gates — every gate here can fail, and one run is made to fail on purpose.
#
# Loopback: harness LinkPacer at 10 Mbps, emulated RTT. Needs exact-server on 4433 in shared mode:
#   target/release/exact-server --port 4433 --study lab/fixtures/frames_32k/frames_32k.sbnd \
#     --stream-mode shared --bind 127.0.0.1 &
# Output (JSON per run, gates.tsv) goes under .local/, never docs/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${OUT:-$ROOT/.local/l2/smoke}"
HARNESS="${HARNESS:-$ROOT/target/release/window-harness}"
URL="${URL:-https://127.0.0.1:4433/}"
BPS="${BPS:-10000000}"
RTT="${RTT:-60}"          # emulated; the campaign's middle cell
DEPTH="${DEPTH:-4}"       # formula depth for 32 KB frames at 10 Mbps and 60 ms
FRAME_BYTES=32004
SCROLL="$ROOT/lab/traces/l2_ask_policy_scroll.json"
JUMP="$ROOT/lab/traces/l2_jump.json"
mkdir -p "$OUT"
[[ -x "$HARNESS" ]] || { echo "missing $HARNESS — cargo build -p window-harness --release" >&2; exit 1; }

trace_at() {  # src step_ms -> path
  local out="$OUT/$(basename "$1" .json)_step$2.json"
  python3 -c "import json,sys; t=json.load(open(sys.argv[1])); t['step_interval_ms']=int(sys.argv[3]); json.dump(t, open(sys.argv[2],'w'))" "$1" "$out" "$2"
  echo "$out"
}

run_h() {  # label trace [harness args]
  local label=$1 trace=$2; shift 2
  local t0 t1
  t0=$(date +%s.%N)
  "$HARNESS" --url "$URL" --ipv4 --stream-mode shared --frame-count 80 --read-bps "$BPS" \
    --fill-dwell-ms 0 --mode trace --trace "$trace" --rtt-ms "$RTT" --arm "$label" "$@" --json \
    > "$OUT/$label.json" 2> "$OUT/$label.err" || echo "rc=$? for $label: $(tail -1 "$OUT/$label.err")" >&2
  t1=$(date +%s.%N)
  python3 -c "import json; m=json.load(open('$OUT/$label.json')); m['shell_wall_ms']=($t1-$t0)*1000; json.dump(m, open('$OUT/$label.json','w'))"
}

echo "== runs (rtt $RTT ms emulated, D $DEPTH)"
S16=$(trace_at "$SCROLL" 16); S26=$(trace_at "$SCROLL" 26); J40=$(trace_at "$JUMP" 40)
run_h control        "$S16" --depth 0
run_h fixed          "$S16" --depth "$DEPTH" --prefetch $((DEPTH - 1))
run_h dynamic_path   "$S16" --depth "$DEPTH" --prefetch $((DEPTH - 1)) --dynamic-depth --rtt-source path --path-rtt-ms "$RTT"
run_h dynamic_fb     "$S16" --depth "$DEPTH" --prefetch $((DEPTH - 1)) --dynamic-depth --rtt-source first-byte
run_h ring           "$S16" --depth 16 --prefetch 15 --window-shape ring
run_h control_step26 "$S26" --depth 0
run_h jump_fixed     "$J40" --depth "$DEPTH" --prefetch $((DEPTH - 1))
run_h jump_path      "$J40" --depth "$DEPTH" --prefetch $((DEPTH - 1)) --dynamic-depth --rtt-source path --path-rtt-ms "$RTT"
run_h jump_bulk      "$J40" --depth 0 --prefetch 79
run_h jump_bounded   "$J40" --depth "$DEPTH" --prefetch 79

python3 - "$OUT" "$DEPTH" "$FRAME_BYTES" <<'PY'
import json, os, sys
out, depth, frame_bytes = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
load = lambda name: json.load(open(os.path.join(out, name + ".json")))
c, f, dp, dfb, ring, c26 = (load(n) for n in ("control", "fixed", "dynamic_path", "dynamic_fb", "ring", "control_step26"))
jf, jp, jb, jbd = load("jump_fixed"), load("jump_path"), load("jump_bulk"), load("jump_bounded")
trace_wall = 119 * 16

def ask_order(m):
    return [r["frame_index"] for r in m["ask_join"]]

def monotone_forward(seq):
    return all(b >= a for a, b in zip(seq, seq[1:]))

gates = []
# G1 workload equalisation: the arms ask for the same frames once each and pull the same bytes.
gates.append(("G1 same unique frames, no duplicate asks, same bytes",
              c["unique_frames_asked"] == f["unique_frames_asked"] == dp["unique_frames_asked"] == 80
              and all(m["duplicate_asks"] == 0 for m in (c, f, dp, dfb))
              and c["bytes_on_wire"] == f["bytes_on_wire"] == dp["bytes_on_wire"],
              f"unique {c['unique_frames_asked']}/{f['unique_frames_asked']}/{dp['unique_frames_asked']} bytes {c['bytes_on_wire']}/{f['bytes_on_wire']}/{dp['bytes_on_wire']}"))
# G2 real wall clock: the reader keeps its schedule; the run ends when the link has caught up.
gates.append(("G2 control wall (measured) < 2.5x trace time",
              0 < c["wall_ms"] < trace_wall * 2.5 and c["shell_wall_ms"] < trace_wall * 3,
              f"wall {c['wall_ms']:.0f} ms, shell {c['shell_wall_ms']:.0f} ms, trace {trace_wall} ms"))
# G3 interior D: with the path RTT the estimator must settle on the formula, not a clamp.
gates.append(("G3 dynamic(path) settles on the interior formula D on an idle-pipe trace",
              jp["d_min_observed"] >= depth - 1 and jp["d_max_observed"] <= depth + 1 and not jp["depth_saturated"],
              f"D in [{jp['d_min_observed']},{jp['d_max_observed']}], saturated {jp['depth_saturated']}"))
# G3b the documented failure: ask->first-byte behind a full stream ratchets D to the clamp
# (the `saturated` flag needs more than half the trajectory there; 80 frames is not enough for that).
gates.append(("G3b dynamic(first-byte) on the saturated scroll ratchets to 16 (documented failure, must reproduce)",
              dfb["d_max_observed"] == 16,
              f"D in [{dfb['d_min_observed']},{dfb['d_max_observed']}], saturated {dfb['depth_saturated']}"))
# G4 the lateness metric moves with the cadence.
gates.append(("G4 slower reader has lower p95 lateness (16 ms vs 26 ms steps)",
              c26["p95_lateness_ms"] < c["p95_lateness_ms"] * 0.9,
              f"16 ms {c['p95_lateness_ms']:.1f}, 26 ms {c26['p95_lateness_ms']:.1f}"))
# G5 no shortfall: every ask was answered and read before the run closed (inverted vs v2).
gates.append(("G5 asks x frame bytes == bytes on wire, drain complete",
              all(m["asks_sent"] * frame_bytes == m["bytes_on_wire"] and not m["drain_incomplete"] for m in (c, f, dp, ring)),
              " ".join(f"{n}:{m['asks_sent'] * frame_bytes - m['bytes_on_wire']}" for n, m in (("c", c), ("f", f), ("dp", dp), ("ring", ring)))))
# G6 concurrency invariant, on a cell where the reader does not outrun the link: the capped arm
# reaches its cap and never exceeds cap+1 (the on-screen frame is exempt). On the saturated scroll
# the exempt on-screen asks pile up by design; that peak is reported, not gated.
gates.append(("G6 fixed arm peak_outstanding in [D, D+1] when the link keeps up",
              depth <= jf["peak_outstanding"] <= depth + 1,
              f"peak {jf['peak_outstanding']} for D {depth} (saturated scroll: {f['peak_outstanding']} on-screen asks in flight)"))
# G7 ask order: a forward window on a forward scroll never asks backwards; the ring must fail this.
gates.append(("G7 forward arm asks in scroll order over the first 80 asks",
              monotone_forward(ask_order(f)[:80]),
              f"first asks {ask_order(f)[:8]}"))
gates.append(("G7n ring arm (negative control) breaks scroll order — the gate can fail",
              not monotone_forward(ask_order(ring)[:80]),
              f"first asks {ask_order(ring)[:8]}"))
# G8 depth is worth something only against a bulk lookahead on a jump; the bounded arm must beat it.
gates.append(("G8 jump: bounded commitment beats the bulk ask on p95 lateness",
              jbd["p95_lateness_ms"] < jb["p95_lateness_ms"] * 0.7,
              f"bulk {jb['p95_lateness_ms']:.1f}, bounded {jbd['p95_lateness_ms']:.1f}"))

with open(os.path.join(out, "gates.tsv"), "w") as fh:
    fh.write("gate\tresult\tdetail\n")
    for name, ok, detail in gates:
        fh.write(f"{name}\t{'PASS' if ok else 'FAIL'}\t{detail}\n")
        print(f"{'PASS' if ok else 'FAIL'} {name} — {detail}")
failed = [g for g in gates if not g[1]]
print(f"{len(gates) - len(failed)}/{len(gates)} gates passed; output {out}/gates.tsv")
sys.exit(1 if failed else 0)
PY
