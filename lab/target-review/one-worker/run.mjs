// Probe: one worker holding WebGL2 + OPFS sync handles + rAF + WebTransport, and what it costs. README.md
//   node lab/target-review/one-worker/run.mjs [--rounds 7] [--frames 12] [--browser chromium|firefox]
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { order } from "../../order.mjs";

const playwright = createRequire(import.meta.url)("playwright");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? fallback : argv[i + 1];
};
const ROUNDS = Number(flag("rounds", 7));
const FRAMES = Number(flag("frames", 12));
const BROWSER = flag("browser", "chromium");
const SIZES = ["512x512", "614x1359", "2560x3328"];
const PARTS = ["open", "read", "close", "upload", "draw", "disk", "memory"];
const MIME = { ".html": "text/html", ".js": "text/javascript" };

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const cell = (xs) => `${median(xs).toFixed(2)} [${Math.min(...xs).toFixed(2)} … ${Math.max(...xs).toFixed(2)}]`;

const server = http.createServer((req, res) => {
  const file = path.join(HERE, path.basename(new URL(req.url, "http://x").pathname) || "page.html");
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" }).end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/page.html`;

const firefoxPath = process.env.FIREFOX_PATH
  ?? fs.readdirSync("/opt/pw-browsers").filter((d) => d.startsWith("firefox")).map((d) => path.join("/opt/pw-browsers", d, "firefox/firefox")).find(fs.existsSync);
const browser = BROWSER === "firefox"
  ? await playwright.firefox.launch({ headless: true, executablePath: firefoxPath })
  : await playwright.chromium.launch({ headless: true, args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("page error:", e.message));
page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));
await page.goto(url);

const caps = await page.evaluate(() => window.ready);
console.log(`engine: ${BROWSER} ${browser.version()}`);
console.log(`renderer: ${caps.renderer}`);
console.log(`capabilities in one worker: ${JSON.stringify(caps)}`);
if (!caps.webgl2 || !caps.syncHandle) throw new Error("the worker lacks WebGL2 or sync access handles; nothing to measure");

await page.evaluate((frames) => window.call("prepare", { frames }), FRAMES);
const samples = Object.fromEntries(SIZES.map((s) => [s, Object.fromEntries(PARTS.map((p) => [p, []]))]));
for (let round = 0; round < ROUNDS; round++) {
  for (const size of order(SIZES, round)) {
    for (let i = 0; i < FRAMES; i++) {
      const r = await page.evaluate((args) => window.call("step", args), { size, i });
      for (const p of PARTS) samples[size][p].push(r[p]);
    }
  }
}
console.log(`\n## A step, ms — median [min … max], n = ${ROUNDS * FRAMES} per size\n`);
console.log(`| part | ${SIZES.join(" | ")} |`);
console.log(`| --- | ${SIZES.map(() => "---").join(" | ")} |`);
const label = { disk: "**step from disk** (sum)", memory: "**step from memory** (upload + draw)" };
for (const p of PARTS) console.log(`| ${label[p] ?? p} | ${SIZES.map((s) => cell(samples[s][p])).join(" | ")} |`);

await page.evaluate(() => window.call("animate"));
await page.waitForTimeout(500);
const block = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const a = await window.call("mark", {});
  await wait(1000);
  const b = await window.call("mark", { pingIn: 500 });
  const t0 = performance.now();
  while (performance.now() < t0 + 1000) {}
  const blockEnd = performance.now();
  const c = await window.call("mark", {});
  await wait(50);
  const ping = window.pings[0];
  return {
    idle: { ticks: b.ticks - a.ticks, intervals: b.intervals - a.intervals, ms: b.t - a.t },
    blocked: { ticks: c.ticks - b.ticks, intervals: c.intervals - b.intervals, ms: c.t - b.t },
    ping: ping ? { afterBlockEndMs: ping.received - blockEnd, inFlightMs: ping.received - ping.sent } : null,
  };
});
console.log(`\n## Frames while the page is blocked\n`);
console.log("| second | worker rAF ticks | worker setInterval(16) firings | interval length ms |");
console.log("| --- | --- | --- | --- |");
for (const [k, v] of [["page idle", block.idle], ["page main thread spinning", block.blocked]]) {
  console.log(`| ${k} | ${v.ticks} | ${v.intervals} | ${v.ms.toFixed(0)} |`);
}
console.log(block.ping
  ? `\npostMessage sent by the worker during the block: delivered ${block.ping.afterBlockEndMs.toFixed(1)} ms after the block ended (${block.ping.inFlightMs.toFixed(0)} ms in flight).`
  : "\npostMessage sent by the worker during the block: NOT delivered within 50 ms of the block ending.");

await browser.close();
server.close();
