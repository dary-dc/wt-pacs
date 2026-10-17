#!/usr/bin/env bash
# `docker compose stop server` timed with a page mid-fill, each image an arm in lab/scripts/order.py's order; a JSON row
# per stop, with the server's signal log and exit in ms from its start. Protocol: deploy/README.md §The ten fixes, 2.
#
#   STUDIES=dir SERIES=name [MEMLOCK=… NOFILE=…] lab/scripts/stop_timing.sh ROUNDS IMAGE...
#
# SERIES of at least 200 frames, so the fill outlasts the stop. Needs root (tc in the server's
# namespace), docker compose, and playwright's Chromium under `npm root -g`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/deploy/compose.yml")
rounds=$1; shift
arms=("$@")
export NODE_PATH="$(npm root -g)"

# The page's own session beside the fill: the downloader keeps its sessions' `closed` in its worker.
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

since() { echo $((($(date -d "$1" +%s%N) - t0) / 1000000)); }

for ((r = 0; r < rounds; r++)); do
  for i in $(python3 "$ROOT/lab/scripts/order.py" row "${#arms[@]}" "$r"); do
    docker tag "${arms[$i]}" wt-pacs-server
    "${COMPOSE[@]}" up -d --no-build --wait
    cid=$("${COMPOSE[@]}" ps -q server)
    pid=$(docker inspect -f '{{.State.Pid}}' "$cid")
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
    signal_ms=$(since "$(docker logs -t "$cid" 2>&1 | grep -m1 'shutdown signal received' | cut -d' ' -f1)")
    exited_ms=$(since "$(docker inspect -f '{{.State.FinishedAt}}' "$cid")")
    "${COMPOSE[@]}" down >/dev/null 2>&1
    echo "{\"round\": $r, \"arm\": \"${arms[$i]}\", \"stop_ms\": $stop_ms, \"signal_ms\": $signal_ms, \"exited_ms\": $exited_ms, \"page\": $seen}"
  done
done
