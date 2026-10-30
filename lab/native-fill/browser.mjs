// One visit of M2's browser arm: the viewer in headless Chromium, its fill timed by the page's own hooks, or its
// asks one at a time, each timed from the step to the status line after the paint. docs/native/README.md §6 M2.
//
//   node lab/native-fill/browser.mjs --page http://127.0.0.1:P/ --wt https://127.0.0.1:Q/ --hash HEX [--asks K]
// Prints one JSON line. CHROME_PATH as client/contract/browser_env.sh exports it.
import { createServer } from "node:http";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ASKS = Number(arg("--asks", 0));

const posted = {};
const arrived = { result: null };
const collector = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    // The page's fetch is cross-origin under COEP, so it needs CORS to resolve.
    res.writeHead(200, { "access-control-allow-origin": "*" }).end();
    posted[req.url.slice(1)] = body ? JSON.parse(body) : Date.now();
    if (req.url === "/result") arrived.result?.();
  });
});
await new Promise((r) => collector.listen(0, "127.0.0.1", r));
const q = new URLSearchParams({ wt: arg("--wt"), hash: arg("--hash"), post: `http://127.0.0.1:${collector.address().port}/`,
  ...(ASKS && { fill: "0" }) });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const out = {};
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const result = new Promise((resolve) => (arrived.result = resolve));
  await page.goto(`${arg("--page")}?${q}`);
  await Promise.race([result, new Promise((_, reject) => setTimeout(() => reject(new Error("no result in 600 s")), 600000))]);
  const r = posted.result;
  if (r.error) throw new Error(r.error);
  const frames = r.frames;
  Object.assign(out, {
    issued_at_ms: r.issuedAt,
    frames: frames.length,
    exact: frames.filter((f) => f.exact === true).length,
    from_dial_ms: Math.max(...frames.map((f) => f.page)) - r.issuedAt,
    first_exact_ms: Math.min(...frames.map((f) => f.page)) - r.issuedAt,
    shown_ms: r.firstShown - r.issuedAt,
    canvas: await page.evaluate(() => `${document.getElementById("view").width}x${document.getElementById("view").height}`),
  });
  if (ASKS) {
    out.asks = [];
    for (let k = 1; k <= ASKS; k++) {
      // The step's own status line comes first; the frame's arrival, decoded and checked, adds one to `received`;
      // the line after that is the paint's.
      out.asks.push(await page.evaluate((k) => new Promise((resolve) => {
        const status = document.getElementById("status");
        const t0 = performance.now();
        let exactAt = null;
        const watch = new MutationObserver(() => {
          const now = performance.now();
          if (exactAt === null) {
            if (status.textContent.includes(`received ${k + 1},`)) exactAt = now;
          } else {
            watch.disconnect();
            resolve({ ask_ms: exactAt - t0, painted_ms: now - t0 });
          }
        });
        watch.observe(status, { childList: true, characterData: true, subtree: true });
        dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      }), k));
    }
    const status = await page.textContent("#status");
    const m = /received (\d+), exact (\d+), not exact (\d+), unchecked (\d+)/.exec(status);
    Object.assign(out, { frames: Number(m[1]), exact: Number(m[2]) });
  }
  out.status = await page.textContent("#status");
  out.errors = errors;
} catch (e) {
  out.error = String(e.message ?? e);
} finally {
  await browser.close();
  collector.close();
}
console.log(JSON.stringify(out));
process.exit(0);
