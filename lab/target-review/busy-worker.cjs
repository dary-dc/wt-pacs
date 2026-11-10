// node lab/target-review/busy-worker.cjs — show-message delay in a worker that also writes OPFS, interleaved arms.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ARMS = ["idle", "same", "split", "same+hash"];
const ROUNDS = 6;
const MS = 3000;
const types = { ".html": "text/html", ".js": "text/javascript" };
const server = http.createServer((req, res) => {
  const file = path.join(__dirname, path.basename(new URL(req.url, "http://x").pathname));
  fs.readFile(file, (err, body) => {
    if (err) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" }).end(body);
  });
});
const q = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];

server.listen(0, "127.0.0.1", async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://localhost:${server.address().port}/busy.html`);
  console.log(await browser.version(), "cores", await page.evaluate(() => navigator.hardwareConcurrency));
  const all = Object.fromEntries(ARMS.map((a) => [a, { d: [], io: [] }]));
  for (let r = 0; r < ROUNDS; r++) {
    for (const arm of r % 2 ? [...ARMS].reverse() : ARMS) {
      try {
        const { delays, io } = await page.evaluate(([a, ms]) => runArm(a, ms), [arm, MS]);
        all[arm].d.push(...delays);
        all[arm].io.push(...io);
      } catch (e) {
        console.log(`round ${r} ${arm}: ${e.message}`);
      }
    }
  }
  for (const arm of ARMS) {
    const d = all[arm].d.sort((a, b) => a - b);
    const io = all[arm].io.map((x) => `${x.writes}w/${x.medianMs?.toFixed(1)}ms`).join(" ");
    console.log(`${arm.padEnd(10)} n=${d.length} median=${q(d, 0.5)?.toFixed(2)} p95=${q(d, 0.95)?.toFixed(2)} max=${d.at(-1)?.toFixed(2)} ms  io per round: ${io}`);
  }
  await browser.close();
  server.close();
});
