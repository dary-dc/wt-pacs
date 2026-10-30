#!/bin/sh
# Sends one package to the PACS's carrier and waits for its verdict: docs/ingest/link.md §12.5.
#   send-package.sh PACKAGE
# Needs CARRIER (https://host:port), CERT and KEY (this PCS's), CACERT (the carrier's); optional
# STALL_SECS 30, POLL_SECS 10, WAIT_SECS 86400, ATTEMPTS 20, BACKOFF_SECS 1, STATE PACKAGE.upload.
# Exit 0 committed (the package may be deleted), 3 refused (for an operator), 4 gave up, 2 usage.
set -eu

[ $# -eq 1 ] && [ -f "$1" ] || { echo "usage: send-package.sh PACKAGE" >&2; exit 2; }
: "${CARRIER:?}" "${CERT:?}" "${KEY:?}" "${CACERT:?}"
package=$1
name=$(basename "$package")
length=$(wc -c <"$package" | tr -d ' ')
stall=${STALL_SECS:-30}
state=${STATE:-$package.upload}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Prints the status code, 000 when no response came; leaves the head in $tmp/h, the body in $tmp/b.
call() {
  url=$1
  shift
  : >"$tmp/h"
  : >"$tmp/b"
  curl -sS -o "$tmp/b" -D "$tmp/h" -w '%{http_code}' --cert "$CERT" --key "$KEY" --cacert "$CACERT" \
    --connect-timeout "$stall" --speed-limit 1 --speed-time "$stall" \
    -H 'Upload-Draft-Interop-Version: 10' "$@" "$url" || :
}

header() {
  tr -d '\r' <"$tmp/h" | awk -v name="$1" -F': *' 'tolower($1) == name { value = $2 } END { print value }'
}

say() { echo "send-package: $name: $*" >&2; }

# Until the carrier holds the whole package; leaves its word on it, if it gave one, in $answer.
send() {
  location=$(cat "$state" 2>/dev/null || :)
  answer=
  tries=0
  delay=${BACKOFF_SECS:-1}
  last=-1
  while [ "$tries" -lt "${ATTEMPTS:-20}" ]; do
    tries=$((tries + 1))
    if [ -z "$location" ]; then
      code=$(call "$CARRIER/packages/$name" -X POST -H 'Upload-Complete: ?0' -H "Upload-Length: $length" \
        --data-binary '')
      offset=0
      if [ "$code" = 201 ]; then
        location=$(header location)
        printf '%s\n' "$location" >"$state"
      fi
    else
      code=$(call "$CARRIER$location" -I)
      offset=$(header upload-offset)
      [ "$code" = 404 ] && location= && rm -f "$state" && continue
      [ "$code" = 204 ] && [ "$(header upload-complete)" = '?1' ] && return 0
      [ "$offset" -gt "$last" ] 2>/dev/null && last=$offset && tries=0 && say "resume at $offset"
    fi
    if [ "$code" = 201 ] || [ "$code" = 204 ]; then
      code=$(tail -c +$((offset + 1)) "$package" | call "$CARRIER$location" -X PATCH -T - -H 'Expect:' \
        -H 'Content-Type: application/partial-upload' -H "Content-Length: $((length - offset))" \
        -H "Upload-Offset: $offset" -H 'Upload-Complete: ?1')
      [ "$code" = 404 ] && location= && rm -f "$state"
    fi
    if [ "$(header upload-complete)" = '?1' ]; then
      answer=$(head -n 1 "$tmp/b")
      return 0
    fi
    say "no answer for the package yet ($code), again in ${delay}s"
    sleep "$delay"
    delay=$((delay * 2 > 60 ? 60 : delay * 2))
  done
  return 1
}

# Until the receiver's verdict, in $answer; fails when the carrier no longer knows the package.
poll() {
  waited=0
  while [ "$waited" -lt "${WAIT_SECS:-86400}" ]; do
    code=$(call "$CARRIER/packages/$name")
    [ "$code" = 404 ] && return 1
    answer=$(head -n 1 "$tmp/b")
    case $answer in committed | refused*) return 0 ;; esac
    sleep "${POLL_SECS:-10}"
    waited=$((waited + ${POLL_SECS:-10}))
  done
  say "no verdict after ${WAIT_SECS:-86400}s"
  exit 4
}

resent=0
while :; do
  send || { say "gave up after ${ATTEMPTS:-20} attempts"; exit 4; }
  case $answer in
    committed | refused*) ;;
    *) poll || { say "the carrier lost it; sending again"; rm -f "$state"; continue; } ;;
  esac
  rm -f "$state"
  case $answer in
    committed)
      echo "committed $name"
      exit 0
      ;;
    'refused retry'*)
      if [ "$resent" -eq 0 ]; then
        resent=1
        say "$answer; sending once more"
        continue
      fi
      ;;
  esac
  echo "$answer $name" >&2
  exit 3
done
