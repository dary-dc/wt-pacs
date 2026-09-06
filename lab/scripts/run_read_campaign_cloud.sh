#!/usr/bin/env bash
# S1 — re-run the read-path campaign on the cloud rig, to close threat R1.
#
# Every number in docs/disk-access/ comes from one 4-vCPU KVM guest, and that host prices a
# `spawn_blocking` round trip at a median 34 us of process CPU. **That constant is what
# generates the ring's advantage.** The same host also ships an 8 MiB read-ahead window
# against Linux's 128 KiB default, and that knob alone moves every miss rate by 2-15x.
# Neither is shown to hold on the instance class we would actually deploy on, which makes
# this the highest-value unknown in the investigation.
#
# This ships the harness and fixture to the rig, runs the campaign there, and pulls the TSV
# back so the local analysis script can compare the two hosts directly.
#
#   lab/scripts/run_read_campaign_cloud.sh                 # full campaign (~40 min on the rig)
#   PHASES=A lab/scripts/run_read_campaign_cloud.sh        # phase A only (~12 min)
#   CLOUD_HOST=1.2.3.4 SSH_KEY=~/.ssh/other ... same
#
# Output: docs/disk-access/v16_campaign_cloud.tsv, then
#   python3 lab/scripts/analyze_read_campaign.py docs/disk-access/v16_campaign_cloud.tsv
#   python3 lab/scripts/compare_hosts.py docs/disk-access/v10_campaign.tsv \
#                                        docs/disk-access/v16_campaign_cloud.tsv
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/lab/scripts/cloud_common.sh"

BIN="${BIN:-$ROOT/target/release/read_campaign}"
BIG="${BIG:-$ROOT/lab/fixtures/frames_16k_big/frames_16k_big.sbnd}"
OUT="${OUT:-$ROOT/docs/disk-access/v16_campaign_cloud.tsv}"
REPEATS="${REPEATS:-6}"
ASKS="${ASKS:-512}"
RUN="${RUN:-1}"
PHASES="${PHASES:-ABCDE}"
REMOTE_DIR="${REMOTE_DIR:-/home/ubuntu/wt-pacs/readpath}"

STRIDE_SKIP=250000
STRIDE_SEQ=16384

[[ -x "$BIN" ]] || { echo "build first: cargo build -p disk-access-bench --release" >&2; exit 1; }
[[ -f "$BIG" ]] || { echo "missing fixture $BIG — lab/scripts/gen_live_cell_fixture.sh" >&2; exit 1; }

# The binary links glibc; if the rig is older than this builder, build with
# `--target x86_64-unknown-linux-musl` or build on the rig itself.
echo "==> host facts (record these next to the results)" >&2
# read_ahead_kb is not a footnote: the lab host ships 8192 (8 MiB) against Linux's 128 KiB
# default, and that single knob moved every trace-replay miss rate by 2-15x
# (docs/disk-access/ACCESS-PATTERNS.md). Record it before anything else.
"${SSH[@]}" 'uname -srm; nproc; free -m | head -2; \
  lsblk -d -o NAME,ROTA,MODEL 2>/dev/null | head -5; \
  findmnt -no FSTYPE,SOURCE /home 2>/dev/null; \
  for q in /sys/block/*/queue; do echo "$q read_ahead_kb=$(cat $q/read_ahead_kb 2>/dev/null) \
    scheduler=$(cat $q/scheduler 2>/dev/null)"; done | head -4' | sed 's/^/    /' >&2

echo "==> ship harness + fixture" >&2
"${SSH[@]}" "mkdir -p $REMOTE_DIR"
"${SCP[@]}" "$BIN" "$REMOTE_WT/readpath/read_campaign" >/dev/null
"${SCP[@]}" "$BIG" "$REMOTE_WT/readpath/study.sbnd" >/dev/null
"${SSH[@]}" "chmod +x $REMOTE_DIR/read_campaign"

# `fadvise(DONTNEED)` needs the file not to be mapped by anything else, and the campaign
# aborts a cold cell it cannot verify — so make sure the product server is not holding it.
echo "==> stop anything holding the study open" >&2
"${SSH[@]}" 'pkill -x exact-server 2>/dev/null || true; sleep 1' || true

remote_run() { # label, then read_campaign args
  local label="$1"; shift
  local hdr="--no-header"
  [[ "${FIRST:-1}" -eq 1 ]] && { hdr=""; FIRST=0; }
  # shellcheck disable=SC2029
  "${SSH[@]}" "cd $REMOTE_DIR && ./read_campaign --study study.sbnd \
     --label run${RUN}_${label} --asks $ASKS --repeats $REPEATS $hdr $*" >> "$OUT"
  echo "  done: $label" >&2
}

: > "$OUT"
FIRST=1
echo "==> campaign on $CLOUD_HOST -> $OUT" >&2

if [[ "$PHASES" == *A* ]]; then
  remote_run A_stride --arms pool,uring,hybrid,pooled_pread --depths 1,2,4,8,16,32,64 \
    --temps cold,warm --stride $STRIDE_SKIP --monitors 0
  remote_run A_sweep --arms pool,uring,hybrid,pooled_pread --depths 1,2,4,8,16,32,64 \
    --temps cold,warm --stride $STRIDE_SEQ --monitors 0
fi
if [[ "$PHASES" == *B* ]]; then
  remote_run B_prefetch_stride --arms pool,hybrid,uring --prefetch off,on --depths 1,4,16 \
    --temps cold --stride $STRIDE_SKIP --monitors 0
  remote_run B_prefetch_sweep --arms pool,hybrid,uring --prefetch off,on --depths 1,4,16 \
    --temps cold --stride $STRIDE_SEQ --monitors 0
fi
if [[ "$PHASES" == *C* ]]; then
  remote_run C_readers --arms pool,uring,hybrid --readers 1,4,16 --depths 1,4 \
    --temps cold --stride $STRIDE_SKIP --monitors 0
fi
if [[ "$PHASES" == *D* ]]; then
  for sz in 4096 65536 250000; do
    remote_run "D_size${sz}" --arms pool,hybrid,uring --depths 1,16 --temps cold,warm \
      --size "$sz" --stride $STRIDE_SKIP --monitors 0
  done
fi
if [[ "$PHASES" == *E* ]]; then
  remote_run E_safety --arms pool,uring,hybrid,pooled_pread --depths 1,16 --temps cold,warm \
    --stride $STRIDE_SKIP --monitors 1
fi

echo "==> $(wc -l < "$OUT") rows in $OUT" >&2
echo "    python3 lab/scripts/analyze_read_campaign.py $OUT" >&2
echo "    python3 lab/scripts/compare_hosts.py docs/disk-access/v10_campaign.tsv $OUT" >&2

echo "==> tidy up (the fixture is 81 MB)" >&2
"${SSH[@]}" "rm -f $REMOTE_DIR/study.sbnd" || true
