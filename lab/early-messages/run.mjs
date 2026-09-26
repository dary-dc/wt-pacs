/**
 * Messages posted before the other side listens, in the product's own sites: each trial opens the
 * receiver and posts at once, and a message that never arrives is a loss. Driverless — a DevTools
 * session pauses every worker at start — one page per arm per round, arms rotated.
 * docs/ARCHITECTURE.md §Messages posted before anyone listens
 *
 *   NODE_PATH=$(npm root -g) node lab/early-messages/run.mjs --rounds 5 --n 1000
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 5));
const N = Number(arg("--n", 1000));
const ARMS = arg("--arms", "bc,downloader,harness").split(",");
const PORT = Number(process.env.PORT || 8774);
const CHROME = process.env.CHROME_PATH || chromium.executablePath();

const ROOT = new URL("../..", import.meta.url).pathname;
const server = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => server.kill());
await new Promise((r) => setTimeout(r, 1500));

let report;
const sink = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.writeHead(204, { "access-control-allow-origin": "*" });
    res.end();
    if (req.method === "POST") report?.(JSON.parse(body));
  });
});
await new Promise((r) => sink.listen(0, "127.0.0.1", r));

async function page(arm) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "early-"));
  const got = new Promise((r) => (report = r));
  const url = `http://127.0.0.1:${PORT}/lab/early-messages/index.html?arm=${arm}&n=${N}&report=${sink.address().port}`;
  const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", "--no-first-run", "--disable-background-networking",
    `--user-data-dir=${dir}`, url], { stdio: "ignore" });
  const out = await got;
  chrome.kill();
  await new Promise((r) => setTimeout(r, 500));
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  return out;
}

for (let round = 0; round < ROUNDS; round++) {
  for (let k = 0; k < ARMS.length; k++) {
    console.log(JSON.stringify({ round: round + 1, ...(await page(ARMS[(k + round) % ARMS.length])) }));
  }
}
process.exit(0);
