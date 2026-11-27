#!/usr/bin/env sh
# Claim: every module path, relative or under /client/, a file of the web image names is a file of the image;
# the two transports' builds are not among them (web-files.sh), so they are the exceptions.
set -eu
cd "$(dirname "$0")/.."
web="$(mktemp -d)"
trap 'rm -rf "$web"' EXIT
deploy/web-files.sh "$web" >/dev/null
missing=$(cd "$web" && find client -name '*.js' -o -name '*.html' | while read -r f; do
  grep -oE "[\"'\`](\.{1,2}|/client)/[A-Za-z0-9_./-]+\.(js|mjs|wasm)[\"'\`]" "$f" | tr -d "\"'\`" | sort -u | while read -r r; do
    case "$r" in /*) t="$PWD$r" ;; *) t=$(realpath -m "$(dirname "$f")/$r") ;; esac
    case "$t" in */client/transport/wasm/pkg/*|*/client/transport/ts/dist/*) continue ;; esac
    [ -e "$t" ] || echo "$f names $r"
  done
done)
[ -z "$missing" ] || { echo "the web image misses a file its pages load (deploy/web-files.sh):"; echo "$missing"; exit 1; }
echo "every module the web image's files name is in it"
