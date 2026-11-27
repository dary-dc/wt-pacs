#!/bin/sh
# lab/phone/read-path.sh against a stub podman whose containers print what series-server prints: each container's
# read path and its sessions' rings are shown, SELinux's mode is named, and four servers that disagree stop the run.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/logs"
cat > "$T/bin/podman" <<'STUB'
#!/bin/sh
case "$1" in
  ps) ls "$LOGS" ;;
  logs) cat "$LOGS/$2" ;;
esac
STUB
printf '#!/bin/sh\necho Enforcing\n' > "$T/bin/getenforce"
chmod +x "$T/bin/podman" "$T/bin/getenforce"
server() {  # NAME RING [SESSION RINGS...]
  n=$1 ring=$2
  shift 2
  { echo "transport=quic"; echo "read_fast_path=preadv2"; echo "read_ring=$ring"; echo "telemetry=on"
    for r in "$@"; do printf "2026-11-11T20:00:00Z INFO session reads frames=50 \033[3mring\033[0m\033[2m=\033[0m%s\n" "$r"; done; } > "$T/logs/$n"
}
for p in 4433 4443; do server "srv-$p" "refused (EACCES)" false false; done
for p in 4434 4444; do server "srv-$p" "refused (EACCES)" false; done
echo "2026-11-11T20:00:01Z WARN io_uring refused; tile misses go to the pool (warned once) err=EACCES" >> "$T/logs/srv-4434"
failed=0
check() { if [ "$1" = "$2" ]; then echo "ok: $3"; else echo "FAIL: $3 (got '$1', want '$2')"; failed=1; fi; }

out="$(LOGS="$T/logs" PATH="$T/bin:$PATH" sh "$ROOT/lab/phone/read-path.sh")" && code=0 || code=$?
check "$code" 0 "four servers that agree pass"
check "$(echo "$out" | grep -c '^srv-')" 4 "one line per container"
check "$(echo "$out" | grep '^srv-4433')" "srv-4433 read_fast_path=preadv2 read_ring=refused (EACCES) io_uring_refused=0 sessions: 2 ring=false" \
  "a container's path, its ring, its refusals and its sessions' rings"
check "$(echo "$out" | grep '^srv-4434' | grep -o 'io_uring_refused=[0-9]*')" "io_uring_refused=1" "a refusal is counted"
check "$(echo "$out" | grep '^selinux')" "selinux Enforcing" "SELinux's mode is named"

server srv-4444 available
out="$(LOGS="$T/logs" PATH="$T/bin:$PATH" sh "$ROOT/lab/phone/read-path.sh" 2>&1)" && code=0 || code=$?
check "$code" 1 "a server that read another way stops the run"
check "$(echo "$out" | tail -1)" "the servers' read paths differ: stop" "and says so"

out="$(LOGS="$T/logs" PATH="$T/bin:$PATH" sh "$ROOT/lab/phone/read-path.sh" srv-4433 srv-4434)" && code=0 || code=$?
check "$code" 0 "named containers alone are read"
exit $failed
