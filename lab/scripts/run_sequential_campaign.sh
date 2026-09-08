#!/usr/bin/env bash
# Sequential-reader campaign (`x15`): consecutive reads, one stream per session, sessions on
# disjoint regions (`--partition`), i.e. thousands of sessions each streaming its own study
# out of a volume far larger than RAM. Answers docs/disk-access/SEQUENTIAL-READER.md.
#
# Two binaries take part: the normal build, and one built with tokio's io_uring file driver
# (`RUSTFLAGS="--cfg tokio_unstable" cargo build ... --features tokio-uring`), which is the
# only way to measure tokio's own ring path. They cannot share a process, so each round runs
# both back to back under the same label and the pairing script joins them by cell — the
# same-round rule from lab/scripts/pair_ab.py. Arm order rotates per round.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
STABLE="${STABLE:-target/release/read_campaign}"
UNSTABLE="${UNSTABLE:-target/unstable/release/read_campaign}"
BIG="${BIG:-lab/fixtures/frames_16k_seq/frames_16k_seq.sbnd}"   # 65536 × 16 KiB = 1 GiB
OUT="${OUT:-docs/disk-access/x15_sequential.tsv}"
SAFE="${SAFE:-docs/disk-access/x15_sequential_safety.tsv}"
ROUNDS="${ROUNDS:-6}"
ARMS=(pool hybrid_lazyring uring product tokio_fs)

[[ -x "$STABLE" && -x "$UNSTABLE" ]] || { echo "build both binaries first (see header)" >&2; exit 1; }
[[ -f "$BIG" ]] || { echo "missing $BIG — NAME=frames_16k_seq BYTES=16384 FRAMES=65536 lab/scripts/gen_live_cell_fixture.sh" >&2; exit 1; }

: > "$OUT"
first=1
emit() { # binary label args...
  local bin="$1" label="$2"; shift 2
  local hdr=()
  [[ $first -eq 1 ]] || hdr=(--no-header)
  "$bin" --study "$BIG" --label "$label" --repeats 1 --monitors 0 --partition "${hdr[@]}" "$@" >> "$OUT"
  first=0
}

n=${#ARMS[@]}
for ((r = 0; r < ROUNDS; r++)); do
  rot=(); for ((i = 0; i < n; i++)); do rot+=("${ARMS[$(( (i + r) % n ))]}"); done
  arms=$(IFS=,; echo "${rot[*]}")
  L="x15_r$r"
  # Every reader streams 8 MB per cell whatever the ask size, so cells compare bytes for bytes.
  emit "$STABLE"   "$L" --arms "$arms"  --size 16384  --stride 16384  --asks 512 --depths 1,4,16 --readers 1,8,64 --temps cold,warm
  emit "$UNSTABLE" "$L" --arms tokio_fs --size 16384  --stride 16384  --asks 512 --depths 1,4,16 --readers 1,8,64 --temps cold,warm
  emit "$STABLE"   "$L" --arms "$arms"  --size 65536  --stride 65536  --asks 128 --depths 1,4,16 --readers 1,8,64 --temps cold
  emit "$UNSTABLE" "$L" --arms tokio_fs --size 65536  --stride 65536  --asks 128 --depths 1,4,16 --readers 1,8,64 --temps cold
  emit "$STABLE"   "$L" --arms "$arms"  --size 262144 --stride 262144 --asks 32  --depths 1,4,16 --readers 1,8,64 --temps cold
  emit "$UNSTABLE" "$L" --arms tokio_fs --size 262144 --stride 262144 --asks 32  --depths 1,4,16 --readers 1,8,64 --temps cold
  echo "  round $r done $(date -u +%T)" >&2
done

# Safety: monitor on, gap columns only. An arm that streams fast by stalling the executor
# is invisible in every other column.
"$STABLE"   --study "$BIG" --label x15_safety --arms "$(IFS=,; echo "${ARMS[*]}")" --size 16384 --stride 16384 --asks 512 \
  --depths 1 --readers 8 --temps cold --repeats 6 --monitors 1 --partition > "$SAFE"
"$UNSTABLE" --study "$BIG" --label x15_safety --arms tokio_fs --size 16384 --stride 16384 --asks 512 \
  --depths 1 --readers 8 --temps cold --repeats 6 --monitors 1 --partition --no-header >> "$SAFE"
echo "x15 complete: $(wc -l < "$OUT") rows, safety $(wc -l < "$SAFE") rows" >&2
