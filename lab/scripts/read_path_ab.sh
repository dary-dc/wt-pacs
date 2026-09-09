#!/usr/bin/env bash
# Interleaved A/B of the product read path: HEAD against a worktree at <base-commit>.
# A sequential before/after already read +8.1 % on a tie here; this alternates inside
# each round. `docs/disk-access/IMPLEMENTATION.md`.
#
#   lab/scripts/read_path_ab.sh <base-commit>
#
# Prints tie / RESOLVED per cell under the campaign's 28.5 % rule on p50.
# A refactor of the read path is expected to tie every product cell; seq1g is P0.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
BASE="${1:?usage: lab/scripts/read_path_ab.sh <base-commit>}"
REPEATS="${REPEATS:-12}"
ASKS="${ASKS:-256}"
OUT="${OUT:-$ROOT/docs/disk-access/read_path_ab.tsv}"
W="${W:-$(sed -n 's/^pub const WINDOWS: usize = \([0-9]*\);/\1/p' server/src/media/read_path.rs)}"
TILE="${TILE:-$ROOT/lab/fixtures/frames_16k_big/frames_16k_big.sbnd}"
SEQ="${SEQ:-$ROOT/lab/fixtures/frames_16k_seq/frames_16k_seq.sbnd}"
WT="${WT:-$(mktemp -d /tmp/read-path-ab-XXXX)}"

ensure_fixture() {
  local path="$1" name="$2" bytes="$3" frames="$4"
  [[ -f "$path" ]] && return
  echo "generating $name ($frames × $bytes B)" >&2
  NAME="$name" BYTES="$bytes" FRAMES="$frames" lab/scripts/gen_live_cell_fixture.sh
}

ensure_fixture "$TILE" frames_16k_big 16384 5120
ensure_fixture "$SEQ"  frames_16k_seq 16384 65536

cleanup() { git worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"; }
trap cleanup EXIT

echo "worktree $WT at $BASE" >&2
git worktree add --detach "$WT" "$BASE"
(cd "$WT" && cargo build -p disk-access-bench --bin read_campaign --release)
cargo build -p disk-access-bench --bin read_campaign --release

BEFORE="$WT/target/release/read_campaign"
AFTER="$ROOT/target/release/read_campaign"
[[ -x "$BEFORE" && -x "$AFTER" ]] || { echo "read_campaign missing after build" >&2; exit 1; }

: > "$OUT"
first=1
emit() { # bin arm label extra args...
  local bin="$1" arm="$2" label="$3"; shift 3
  local hdr=()
  [[ $first -eq 1 ]] || hdr=(--no-header)
  "$bin" --arms product --label "$label" --repeats 1 --monitors 0 --asks "$ASKS" \
    "${hdr[@]}" "$@" | awk -v arm="$arm" 'BEGIN{FS=OFS="\t"}
      NR==1 && $1=="label" {print; next}
      { $2=arm; print }' >> "$OUT"
  first=0
}

# Warm 16 KiB · cold 16 KiB at depth 1 and W · 1 GiB sequential. Order of the two
# binaries rotates each round so a host drift cannot masquerade as a delta.
for ((r = 0; r < REPEATS; r++)); do
  if (( r % 2 == 0 )); then bins=("$BEFORE:before" "$AFTER:after")
  else bins=("$AFTER:after" "$BEFORE:before"); fi
  for spec in "${bins[@]}"; do
    bin="${spec%%:*}"; arm="${spec##*:}"
    emit "$bin" "$arm" "warm16_d1_r$r"  --study "$TILE" --temps warm --depths 1 --size 16384 --stride 16384
    emit "$bin" "$arm" "cold16_d1_r$r"  --study "$TILE" --temps cold --depths 1 --size 16384 --stride 250000
    emit "$bin" "$arm" "cold16_dW_r$r"  --study "$TILE" --temps cold --depths "$W" --size 16384 --stride 250000
    emit "$bin" "$arm" "seq1g_d1_r$r"   --study "$SEQ"  --temps cold --depths 1 --size 16384 --stride 16384 --partition
  done
  echo "  round $r done $(date -u +%T)" >&2
done

python3 - "$OUT" <<'PY'
import csv, collections, math, statistics as st, sys
DRIFT, path = 28.5, sys.argv[1]
MIN_N = 5
METRIC = "p50_ns"
# One cell = one (kind, repeat). Kind is the label prefix before _rN.
cells = collections.defaultdict(dict)
with open(path, newline="") as fh:
    for r in csv.DictReader(fh, delimiter="\t"):
        if r["arm"] not in ("before", "after") or not r.get(METRIC):
            continue
        kind, sep, rnd = r["label"].rpartition("_r")
        if not sep:
            continue
        cells[(kind, rnd)][r["arm"]] = int(r[METRIC])

print(f"{'cell':<16} {'n':>3}  {'p50 Δ':>11}  {'signs':>7}  {'verdict':<9}  {'before':>9}  {'after':>9}")
kinds = sorted({k for k, _ in cells})
fail = 0
for kind in kinds:
    ds, b, a = [], [], []
    for (k, _rep), arms in cells.items():
        if k != kind or "before" not in arms or "after" not in arms:
            continue
        x, y = arms["before"], arms["after"]
        if not x:
            continue
        ds.append((y - x) / x * 100); b.append(x); a.append(y)
    if not ds:
        print(f"{kind:<16}   0  {'n/a':>11}  {'—':>7}  {'empty':<9}")
        if not kind.startswith("seq"):
            fail += 1
        continue
    if len(ds) < MIN_N:
        print(f"{kind:<16} {len(ds):>3}  {'n/a':>11}  {'—':>7}  {'n<5':<9}")
        continue
    med = st.median(ds)
    agree = max(sum(1 for d in ds if d < 0), sum(1 for d in ds if d > 0))
    ok = abs(med) >= DRIFT and agree >= math.ceil(0.8 * len(ds))
    verdict = "RESOLVED" if ok else "tie"
    # seq1g is a P0 I/O cell, not a product-refactor verdict.
    if ok and not kind.startswith("seq"):
        fail += 1
    print(f"{kind:<16} {len(ds):>3}  {med:>+10.1f}%  {agree:>3}/{len(ds):<3}  {verdict:<9}  {st.median(b):>9.0f}  {st.median(a):>9.0f}")
print(f"tsv: {path}")
sys.exit(1 if fail else 0)
PY
