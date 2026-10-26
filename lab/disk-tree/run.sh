#!/usr/bin/env bash
# One filesystem, one study count, every arm on its own loop-mounted image: build, then the protocols in order.
#   sudo lab/disk-tree/run.sh ext4|xfs N [WORK]     rows to stdout, one JSON object per line
#   CEILING=1 sudo lab/disk-tree/run.sh ext4 0      P2 alone: ext4's per-directory ceiling and the subdirectory cap
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
fs=$1 n=$2 work=${3:-${WORK:-/var/tmp/disk-tree}}
seed=${SEED:-20261026}
bin="$here/target/release/disk-tree"
(cd "$here" && cargo build --release --quiet)
mkdir -p "$work"

cleanup() {
  for m in $(findmnt -rn -o TARGET | grep "^$work/" || true); do umount "$m"; done
  losetup -D 2>/dev/null || true
  rm -f "$work"/*.img
}
trap cleanup EXIT

drops() { dmesg 2>/dev/null | grep -c drop_caches || true; }

mkimg() { # name size_bytes features → mount point
  local img="$work/$1.img" mnt="$work/$1"
  truncate -s "$2" "$img"
  if [[ $fs == ext4 ]]; then
    mkfs.ext4 -F -q -N "$((2 * n + 200000))" -E lazy_itable_init=0,lazy_journal_init=0 ${3:+-O "$3"} "$img"
  else
    mkfs.xfs -f -q "$img"
  fi
  local dev; dev=$(losetup --direct-io=on -f --show "$img")
  mkdir -p "$mnt" && mount "$dev" "$mnt"
  echo "$mnt"
}

host() {
  local feat
  if [[ $fs == ext4 ]]; then feat=$(tune2fs -l "$work/$1.img" | sed -n 's/^Filesystem features: *//p')
  else feat=$(xfs_info "$work/$1" | tr -s ' \n' ' '); fi
  printf '{"p":"host","fs":"%s","features":"%s","mkfs":"%s","kernel":"%s","cpus":%s,"mem_gb":%s,"disk":"%s"}\n' \
    "$fs" "$feat" "$( [[ $fs == ext4 ]] && mke2fs -V 2>&1 | head -1 || mkfs.xfs -V)" "$(uname -r)" "$(nproc)" \
    "$(free -g | awk '/Mem/{print $2}')" "loop --direct-io=on over a file on $(findmnt -no SOURCE,FSTYPE --target "$work" | tr ' ' ':')"
}

if [[ ${CEILING:-} ]]; then
  for len in 44 30; do
    m=$(mkimg "ceil$len" 8G)
    host "ceil$len"
    "$bin" ceiling dir="$m/root/flat" kind=link len=$len
    grep -h -m2 -e 'index full' -e 'Large directory' <(dmesg | tail -50) | sed 's/^/# dmesg: /' >&2 || true
  done
  m=$(mkimg nlink 2G ^dir_nlink)
  "$bin" ceiling dir="$m/root/flat" kind=dir len=44 limit=70000
  m=$(mkimg large 8G large_dir)
  host large
  "$bin" ceiling dir="$m/root/flat" kind=link len=44 limit="${LARGE_LIMIT:-30000000}"
  exit 0
fi

per_study=$([[ $fs == ext4 ]] && echo 5200 || echo 1600)
size=$(((n * per_study >> 20) + 1024))M
arms=(flat coded-date ymd hash1 hash2)
roots=""
for a in "${arms[@]}"; do m=$(mkimg "$a" "$size"); roots+="${roots:+,}$a:$m"; done
host flat
for a in "${arms[@]}"; do "$bin" build roots="$a:$work/$a" seed="$seed" n="$n" & done
wait
d0=$(drops)
"$bin" lookup roots="$roots" seed="$seed" n="$n"
"$bin" scan roots="$roots" rounds="${SCAN_ROUNDS:-5}"
"$bin" publish roots="$roots" seed="$seed" n="$n" ks=1,2,4,8 rounds=4 per=100
"$bin" delete roots="$roots" seed="$seed" n="$n" days=$((n >= 100000 ? 10 : 2))
"$bin" correct roots="$roots" seed="$seed" n="$n" from_day=$((n >= 100000 ? 10 : 2)) count=500
printf '{"p":"cache","drop_caches_during_run":%s}\n' "$(($(drops) - d0))"
df -B1 --output=used "$work" | tail -1 | xargs printf '{"p":"disk","host_fs_used_bytes":%s}\n'
