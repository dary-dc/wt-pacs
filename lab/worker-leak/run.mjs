/**
 * What closed downloader clients leave behind in the renderer: its threads and resident memory
 * after `--clients` are opened and closed, against an idle page, arms interleaved. `--driver none`
 * launches Chromium with no DevTools session attached to any worker; `playwright` also counts the
 * worker targets. docs/proposal-downloader.md §Closing a client
 *
 *   NODE_PATH=$(npm root -g) node lab/worker-leak/run.mjs --clients 40 --rounds 3 --driver none
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CLIENTS = Number(arg("--clients", 40));
const ROUNDS = Number(arg("--rounds", 3));
const DECODERS = Number(arg("--decoders", 3));
const DRIVER = arg("--driver", "none");
const PORT = Number(process.env.PORT || 8772);
const CHROME = process.env.CHROME_PATH || chromium.executablePath();

const ROOT = new URL("../..", import.meta.url).pathname;
const server = spawn("python3", ["server/dev-server.py", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
process.on("exit", () => server.kill());
await new Promise((r) => setTimeout(r, 1500));

const status = (pid) => { try { return fs.readFileSync(`/proc/${pid}/status`, "utf8"); } catch { return ""; } };
const field = (s, k) => Number(new RegExp(`${k}:\\s+(\\d+)`).exec(s)?.[1] ?? 0);
/** The renderer with the most threads is the page's: any other is an idle spare. */
const busiest = (pids) => pids.map(status).sort((a, b) => field(b, "Threads") - field(a, "Threads"))[0];
const cmdline = (pid) => { try { return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8"); } catch { return ""; } };
/** Renderers hang off the zygote, not the browser, so they are found by walking the tree. */
function descendants(root) {
  const kids = new Map();
  for (const pid of fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    const ppid = field(status(pid), "PPid");
    kids.set(ppid, [...(kids.get(ppid) ?? []), Number(pid)]);
  }
  const out = [];
  for (const todo = [root]; todo.length; ) for (const k of kids.get(todo.pop()) ?? []) out.push(k), todo.push(k);
  return out;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = (n) => `http://127.0.0.1:${PORT}/lab/worker-leak/index.html?auto=${n}&decoders=${DECODERS}`;
const FLAGS = ["--disable-background-networking", "--disable-features=SpareRendererForSitePerProcess"];

async function driverless(n) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leak-"));
  const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", "--no-first-run", `--user-data-dir=${dir}`, ...FLAGS, url(n)], { stdio: "ignore" });
  // Opening and closing 40 clients takes ~3 s here; the rest is for termination to finish.
  await sleep(15000);
  const r = busiest(descendants(chrome.pid).filter((p) => cmdline(p).includes("--type=renderer")));
  chrome.kill();
  await sleep(500);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  return { threads: field(r, "Threads"), rss_kib: field(r, "VmRSS") };
}

async function driven(n) {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: FLAGS });
  const cdp = await browser.newBrowserCDPSession();
  const page = await browser.newPage();
  await page.goto(url(n));
  await sleep(15000);
  const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
  const r = busiest(processInfo.filter((p) => p.type === "renderer").map((p) => p.id));
  const out = { threads: field(r, "Threads"), rss_kib: field(r, "VmRSS"), workers: page.workers().length };
  await browser.close();
  return out;
}

for (let round = 1; round <= ROUNDS; round++) {
  for (const n of round % 2 ? [0, CLIENTS] : [CLIENTS, 0]) {
    const out = await (DRIVER === "none" ? driverless(n) : driven(n));
    console.log(JSON.stringify({ round, driver: DRIVER, clients: n, ...out }));
  }
}
process.exit(0);
