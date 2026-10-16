#!/usr/bin/env bash
# `docker compose stop server`, timed, with a page mid-fill, for each server image as an arm, in
# lab/scripts/order.py's order; one JSON row per stop. Row 270's protocol: deploy/README.md §The ten fixes, 2.
#
#   STUDIES=dir SERIES=name lab/scripts/stop_timing.sh ROUNDS IMAGE...
#
# SERIES of at least 200 frames, so the fill outlasts the stop. Needs root (tc in the server's
# namespace), docker compose, and playwright's Chromium under `npm root -g`. Compose's variables pass through
# (deploy/README.md): a host whose hard limits are lower needs `MEMLOCK` and `NOFILE` set to them.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/deploy/compose.yml")
rounds=$1; shift
arms=("$@")
export NODE_PATH="$(npm root -g)"

# Opens the viewer and, once its fill is under way, a session of the page's own beside it: the viewer's
# downloader re-dials a closed session and keeps its `closed` reason in the worker. Prints that session's
# `closed` outcome (or null after 15 s), how long after "stopping" it came, and the viewer's status line.
page='
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:8765/");
  await page.waitForFunction(() => /received [1-9]/.test(document.getElementById("status").textContent), null, { timeout: 60000 });
  await page.evaluate(async () => {
    const t = await (await fetch("/wt/dev-transport.json", { cache: "no-store" })).json();
    const value = new Uint8Array(t.cert_sha256.match(/../g).map((h) => parseInt(h, 16)));
    const wt = new WebTransport(t.wt_url, { serverCertificateHashes: [{ algorithm: "sha-256", value }] });
    await wt.ready;
    globalThis.closedAt = wt.closed.then(
      (i) => ({ closeCode: i.closeCode, reason: i.reason, at: performance.now() }),
      (e) => ({ error: `${e.name}: ${e.message}`, source: e.source, at: performance.now() }),
    );
  });
  console.log("filling");
  await new Promise((r) => process.stdin.once("data", r));
  const t0 = await page.evaluate(() => performance.now());
  const closed = await page.evaluate(() => Promise.race([globalThis.closedAt, new Promise((r) => setTimeout(() => r(null), 15000))]));
  const status = await page.evaluate(() => document.getElementById("status").textContent);
  if (closed) closed.ms = Math.round(closed.at - t0), delete closed.at;
  console.log(JSON.stringify({ closed, status }));
  // browser.close() can hang once a WebTransport session has failed; exiting ends Chromium too.
  process.exit(0);
})();
'

for ((r = 0; r < rounds; r++)); do
  for i in $(python3 "$ROOT/lab/scripts/order.py" row "${#arms[@]}" "$r"); do
    docker tag "${arms[$i]}" wt-pacs-server
    "${COMPOSE[@]}" up -d --no-build --wait
    pid=$(docker inspect -f '{{.State.Pid}}' "$("${COMPOSE[@]}" ps -q server)")
    nsenter -t "$pid" -n tc qdisc replace dev eth0 root tbf rate 18mbit burst 32kb latency 200ms
    coproc PAGE { node -e "$page"; }
    # Bash unsets PAGE and PAGE_PID when the page exits, which it may do before its last line is read.
    page_pid=$PAGE_PID
    exec {from_page}<&"${PAGE[0]}" {to_page}>&"${PAGE[1]}"
    read -r line <&"$from_page"
    [ "$line" = filling ] || { echo "page: $line" >&2; exit 1; }
    echo stopping >&"$to_page"
    t0=$(date +%s%N)
    "${COMPOSE[@]}" stop server >/dev/null 2>&1
    stop_ms=$((($(date +%s%N) - t0) / 1000000))
    read -r seen <&"$from_page"
    exec {from_page}<&- {to_page}>&-
    wait "$page_pid" || true
    "${COMPOSE[@]}" down >/dev/null 2>&1
    echo "{\"round\": $r, \"arm\": \"${arms[$i]}\", \"stop_ms\": $stop_ms, \"page\": $seen}"
  done
done
