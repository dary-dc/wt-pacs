#!/usr/bin/env bash
# `docker compose stop server`, timed, with a page mid-fill, for each server image as an arm, in
# lab/scripts/order.py's order; one JSON row per stop. Row 270's protocol: deploy/README.md §The ten fixes, 2.
#
#   STUDIES=dir SERIES=name lab/scripts/stop_timing.sh ROUNDS IMAGE...
#
# SERIES of at least 200 frames, so the fill outlasts the stop. Needs root (tc in the server's
# namespace), docker compose, and playwright's Chromium under `npm root -g`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/deploy/compose.yml")
rounds=$1; shift
arms=("$@")
export NODE_PATH="$(npm root -g)"

# Opens the viewer, says when the fill is under way, then prints the status line once the page
# has seen the session end (or after 10 s), with how long after "stopping" that was.
page='
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:8765/");
  await page.waitForFunction(() => /received [1-9]/.test(document.getElementById("status").textContent), null, { timeout: 60000 });
  console.log("filling");
  await new Promise((r) => process.stdin.once("data", r));
  const t0 = Date.now();
  const seen = await page.waitForFunction(() => /error:/.test(document.getElementById("status").textContent), null, { timeout: 10000 }).then(() => true, () => false);
  const status = await page.evaluate(() => document.getElementById("status").textContent);
  console.log(JSON.stringify({ page_saw_end: seen, page_ms: Date.now() - t0, status }));
  await browser.close();
})();
'

for ((r = 0; r < rounds; r++)); do
  for i in $(python3 "$ROOT/lab/scripts/order.py" row "${#arms[@]}" "$r"); do
    docker tag "${arms[$i]}" wt-pacs-server
    "${COMPOSE[@]}" up -d --no-build --wait
    pid=$(docker inspect -f '{{.State.Pid}}' "$("${COMPOSE[@]}" ps -q server)")
    nsenter -t "$pid" -n tc qdisc replace dev eth0 root tbf rate 18mbit burst 32kb latency 200ms
    coproc PAGE { node -e "$page"; }
    read -r line <&"${PAGE[0]}"
    [ "$line" = filling ] || { echo "page: $line" >&2; exit 1; }
    echo stopping >&"${PAGE[1]}"
    t0=$(date +%s%N)
    "${COMPOSE[@]}" stop server >/dev/null 2>&1
    stop_ms=$((($(date +%s%N) - t0) / 1000000))
    read -r seen <&"${PAGE[0]}"
    wait "$PAGE_PID" || true
    "${COMPOSE[@]}" down >/dev/null 2>&1
    echo "{\"round\": $r, \"arm\": \"${arms[$i]}\", \"stop_ms\": $stop_ms, \"page\": $seen}"
  done
done
