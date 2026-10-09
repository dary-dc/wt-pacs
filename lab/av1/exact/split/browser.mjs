/**
 * Row 43's items in Chromium, Firefox and WebKitGTK, as row 37 ran them (stock builds; lab/av1/exact/engines): each
 * engine opens index.html once and its worker takes every item of the manifest through verify.js. Which
 * decoder gave each item's pictures is read from verify.js's tag and held against what the engine should
 * choose: WebCodecs in Chromium where every stream is ≤ 10 bits, dav1d-WASM otherwise and in the other two.
 *
 * With --mixed (row 47, MIXDEC), a top over 10 bits goes to dav1d-WASM and its low to WebCodecs where the engine's probe passes.
 *
 *   node lab/av1/exact/split/browser.mjs SETS ITEMS [--engines chromium,firefox,webkit+sab] [--only k2,k3] [--mixed] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve } from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const [SETS, ITEMS] = process.argv.slice(2, 4).map((p) => resolve(p));
const ENGINE_NAMES = arg("--engines", "chromium,firefox,webkit+sab").split(",");
const ONLY = arg("--only", "").split(",").filter(Boolean);
const OUT = arg("--out", null);
const MIXED = process.argv.includes("--mixed");
const ENGINE_MS = 6 * 60 * 60 * 1000;
const ROOT = new URL("../../../..", import.meta.url).pathname;
const DISPLAY = ":78";

const MINIBROWSER = process.env.MINIBROWSER_PATH ?? "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser";
const ENGINES = {
  chromium: (url, dir) => [process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${dir}`, url]],
  firefox: (url, dir) => {
    writeFileSync(join(dir, "user.js"), [
      ["browser.shell.checkDefaultBrowser", false], ["browser.aboutwelcome.enabled", false],
      ["datareporting.policy.dataSubmissionEnabled", false], ["browser.startup.homepage_override.mstone", "ignore"],
      ["app.update.disabledForTesting", true], ["toolkit.telemetry.reportingpolicy.firstRun", false],
    ].map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join("\n"));
    return [process.env.FIREFOX_PATH, ["--headless", "--no-remote", "--profile", dir, url]];
  },
  // WebKitGTK leaves SharedArrayBuffer off under cross-origin isolation, where Safari turns it on.
  "webkit+sab": (url) => [MINIBROWSER, [url], { JSC_useSharedArrayBuffer: "1" }],
};
const expected = (engine, header) => (engine !== "chromium" || !header ? "dav1d" : header.depth <= 10 ? "webcodecs"
  : MIXED && header.split ? "dav1d+webcodecs" : "dav1d");

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const url = (p) => "/" + relative(ROOT, p);
const manifest = walk(ITEMS).filter((f) => f.endsWith("metadata.json")).sort()
  .map((m) => dirname(m))
  .filter((dir) => !ONLY.length || ONLY.some((o) => dir.split("/").pop().startsWith(`${o}.`)))
  .map((dir) => ({ cell: relative(ITEMS, dir), dir: url(dir), set: url(join(SETS, relative(ITEMS, dirname(dir)))),
    items: readdirSync(dir).filter((f) => f.endsWith(".av1")).sort().map((f) => f.slice(0, 3)) }));

const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".html": "text/html", ".json": "application/json" };
let run = null;
const server = createServer((req, res) => {
  const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin", "Cache-Control": "no-store" };
  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200, headers).end();
      const m = JSON.parse(body || "{}");
      if (req.url === "/sk/hello") run.caps = m;
      else if (req.url === "/sk/rows") run.cells.push(m);
      else run.done(m);
    });
    return;
  }
  if (req.url === "/sk/config") return void res.writeHead(200, { ...headers, "Content-Type": "application/json" }).end(JSON.stringify({ mixed: MIXED }));
  if (req.url === "/sk/manifest") return void res.writeHead(200, { ...headers, "Content-Type": "application/json" }).end(JSON.stringify(manifest));
  const path = join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  try {
    if (!statSync(path).isFile()) throw new Error();
    res.writeHead(200, { ...headers, "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(readFileSync(path));
  } catch {
    res.writeHead(404, headers).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PAGE = `http://127.0.0.1:${server.address().port}/lab/av1/exact/split/index.html`;

let xvfb = null;
if (ENGINE_NAMES.some((e) => e.startsWith("webkit"))) {
  xvfb = spawn("Xvfb", [DISPLAY, "-screen", "0", "1280x800x24", "-nolisten", "tcp"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 1000));
}

const all = [];
for (const engine of ENGINE_NAMES) {
  const dir = mkdtempSync(join(tmpdir(), "sk-"));
  const [bin, args, extra] = ENGINES[engine](PAGE, dir);
  const env = { ...process.env, DISPLAY, WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS: "1", MOZ_CRASHREPORTER_DISABLE: "1", ...extra };
  const proc = spawn(bin, args, { env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  proc.stderr.on("data", (c) => (stderr = (stderr + c).slice(-4000)));
  const end = await new Promise((done) => {
    run = { caps: null, cells: [], done };
    setTimeout(() => done({ error: `no result in ${ENGINE_MS / 60000} min` }), ENGINE_MS);
    proc.on("exit", (code) => setTimeout(() => done({ error: `exited ${code}; stderr: ${stderr}` }), 2000));
  });
  proc.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 500));
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  const cells = run.cells.map((c) => {
    const rows = c.rows;
    const wrongDecoder = rows.filter((r) => r.decoder !== expected(engine, r.header));
    return { engine, cell: c.cell, bits: c.bits, signed: c.signed, n: rows.length,
      exact: rows.filter((r) => r.exact && r.streamsSame !== false).length,
      decoders: [...new Set(rows.map((r) => r.decoder))].join(), wrongDecoder: wrongDecoder.length,
      fellBack: rows.filter((r) => r.fellBack).length, errors: [...new Set(rows.map((r) => r.error).filter(Boolean))] };
  });
  all.push(...cells);
  const frames = cells.reduce((a, c) => a + c.n, 0);
  const exact = cells.reduce((a, c) => a + c.exact, 0);
  const tally = {};
  for (const c of cells) tally[c.decoders] = (tally[c.decoders] ?? 0) + c.n;
  console.log(`${engine} (${run.caps?.ua ?? "no page"}; isolated ${run.caps?.isolated}, VideoDecoder ${run.caps?.videoDecoder}): ${cells.filter((c) => c.exact === c.n).length}/${manifest.length} cells exact,`
    + ` ${exact}/${frames} frames; decoders ${JSON.stringify(tally)}; chosen as expected ${frames - cells.reduce((a, c) => a + c.wrongDecoder, 0)}/${frames}`
    + `${end.error ? `; ${end.error}` : ""}`);
  for (const c of cells.filter((x) => x.exact !== x.n || x.wrongDecoder)) {
    console.log(`  ${c.cell}: ${c.exact}/${c.n} exact, ${c.decoders}, ${c.wrongDecoder} not as expected ${c.errors.join("; ")}`);
  }
}
xvfb?.kill();
server.close();
if (OUT) writeFileSync(OUT, all.map((c) => JSON.stringify(c)).join("\n") + "\n");
process.exit(0);
