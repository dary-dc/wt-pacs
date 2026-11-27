/**
 * Stage 1.5 of docs/av1/top-first.md §4: every 8th slice of each volume, d_T and d_X interleaved frame by frame,
 * 1× and 4× interleaved, a fresh headless Chromium per (round × throttle × volume), volumes in a Williams order.
 *
 *   NODE_PATH=$(npm root -g) node lab/av1/delivery/top-first/bench.mjs [--rounds 5] [--out decode.jsonl] [--mutate sample]
 */
import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { order } from "../../../order.mjs";
import { throttleTree } from "../../../scripts/cpu_throttle.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 5));
const OUT = arg("--out", null);
const MUTATE = arg("--mutate", "");
const ROOT = new URL("../../../..", import.meta.url).pathname;
const SETS = { dbts_a1: 56, dbts_b1: 50, dbts_c1: 69 };
const T = mkdtempSync(path.join(tmpdir(), "tf-bench-"));
writeFileSync(`${T}/chrome.sh`, `#!/bin/sh\nexec taskset -c 0-2 "${chromium.executablePath()}" "$@"\n`, { mode: 0o755 });

let page = {};
const collector = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url === "/hello") page.hello?.();
    if (req.url === "/result") page.result?.(JSON.parse(body));
    res.writeHead(200, { "Access-Control-Allow-Origin": "*" }).end();
  });
});
await new Promise((r) => collector.listen(0, "127.0.0.1", r));
const HTTP = 20000 + ((Math.random() * 25000) | 0);
const http = spawn("python3", ["server/dev-server.py", "--port", String(HTTP)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => http.kill());
await new Promise((r) => setTimeout(r, 1500));

async function visit(set, throttle, round) {
  const frames = Array.from({ length: Math.ceil(SETS[set] / 8) }, (_, j) => 8 * j);
  const url = `http://127.0.0.1:${HTTP}/lab/av1/delivery/top-first/bench.html?set=${set}&frames=${frames}&first=${round % 2 ? "X" : "T"}&mutate=${MUTATE}` +
    `&post=${encodeURIComponent(`http://127.0.0.1:${collector.address().port}/`)}`;
  const browser = await chromium.launchServer({ executablePath: `${T}/chrome.sh` });
  const client = await chromium.connect(browser.wsEndpoint());
  const tab = await client.newPage();
  let stop = () => {};
  try {
    const result = new Promise((resolve, reject) => {
      page = { hello: () => (stop = throttleTree(browser.process().pid, throttle)), result: resolve };
      setTimeout(() => reject(new Error("no result in 600 s")), 600000);
    });
    await tab.goto(url);
    return await result;
  } finally {
    stop();
    await client.close();
    await browser.close();
  }
}

const cells = Object.keys(SETS).flatMap((set) => [1, 4].map((throttle) => ({ set, throttle })));
for (let round = 0; round < ROUNDS; round++) {
  for (const { set, throttle } of order(cells, round)) {
    const rows = await visit(set, throttle, round);
    for (const r of rows) if (OUT) appendFileSync(OUT, JSON.stringify({ round, set, throttle, mutate: MUTATE || undefined, ...r }) + "\n");
    const bad = rows.filter((r) => !r.exact);
    console.error(`round ${round} ${set} ${throttle}x: ${rows.length - bad.length}/${rows.length} exact` + (bad.length ? ` ${bad[0].error ?? ""}` : ""));
  }
}
rmSync(T, { recursive: true, force: true });
process.exit(0);
