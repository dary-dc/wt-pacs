/**
 * DECODERBUILD: every AV1 payload of the contract set through the product's dav1d build, in Chromium,
 * Firefox and WebKitGTK, each engine a fresh process opening index.html; every frame against its source's sha256.
 * The engines are the stock builds lab/av1/exact/engines/README.md names. docs/decode/README.md §The build, as delivered
 *
 *   FIREFOX_PATH=... node lab/decode-bench/av1-engines/run.mjs [--engines chromium,firefox,webkit,webkit+sab] [--mutate]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ENGINE_NAMES = arg("--engines", "chromium,firefox,webkit,webkit+sab").split(",");
const MUTATE = process.argv.includes("--mutate");
const ROOT = new URL("../../..", import.meta.url).pathname;
const SET = "client/contract/av1/payloads";
const DISPLAY = ":78";
const payloads = readdirSync(join(ROOT, SET)).flatMap((d) =>
  readdirSync(join(ROOT, SET, d)).filter((f) => f.endsWith(".av1")).sort().map((f) => `/${SET}/${d}/${f.slice(0, -4)}`));

const MINIBROWSER = process.env.MINIBROWSER_PATH ?? "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser";
const ENGINES = {
  chromium: (url, dir) => [process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    ["--headless=new", "--no-sandbox", "--no-first-run", `--user-data-dir=${dir}`, url]],
  firefox: (url, dir) => {
    writeFileSync(join(dir, "user.js"), 'user_pref("browser.shell.checkDefaultBrowser", false);\n');
    return [process.env.FIREFOX_PATH, ["--headless", "--no-remote", "--profile", dir, url]];
  },
  webkit: (url) => [MINIBROWSER, [url]],
  // WebKitGTK leaves SharedArrayBuffer off under cross-origin isolation, where Safari turns it on.
  "webkit+sab": (url) => [MINIBROWSER, [url], { JSC_useSharedArrayBuffer: "1" }],
};

const TYPES = { ".js": "text/javascript", ".wasm": "application/wasm", ".html": "text/html" };
let cell = null;
const server = createServer((req, res) => {
  const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cache-Control": "no-store" };
  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200, { ...headers, "Content-Type": "application/json" });
      if (req.url === "/av1e/hello") {
        cell.caps = JSON.parse(body);
        res.end(JSON.stringify({ payloads, mutate: MUTATE }));
      } else {
        res.end("{}");
        cell.done(JSON.parse(body));
      }
    });
    return;
  }
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
const url = `http://127.0.0.1:${server.address().port}/lab/decode-bench/av1-engines/index.html`;
const xvfb = ENGINE_NAMES.some((e) => e.startsWith("webkit"))
  ? spawn("Xvfb", [DISPLAY, "-screen", "0", "1280x800x24", "-nolisten", "tcp"], { stdio: "ignore" }) : null;
await new Promise((r) => setTimeout(r, 1000));

let bad = 0;
for (const engine of ENGINE_NAMES) {
  const dir = mkdtempSync(join(tmpdir(), "av1e-"));
  const [bin, args, extra] = ENGINES[engine](url, dir);
  const proc = spawn(bin, args, { env: { ...process.env, DISPLAY, WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS: "1", ...extra }, stdio: "ignore" });
  const r = await new Promise((done) => {
    cell = { done };
    setTimeout(() => done({ error: "no result in 5 min" }), 5 * 60 * 1000);
  });
  proc.kill("SIGKILL");
  await new Promise((res) => setTimeout(res, 500));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  const exact = (r.rows ?? []).filter((x) => x.exact).length;
  bad += payloads.length - exact;
  const failures = (r.rows ?? []).filter((x) => !x.exact).slice(0, 3).map((x) => `${x.payload} ${x.error ?? "differs"}`);
  console.log(`${engine}: ${exact}/${payloads.length} exact through dav1d (sab ${cell.caps?.sab}, isolated ${cell.caps?.isolated})` +
    `${r.error ? ` — ${r.error}` : ""}${failures.length ? ` — e.g. ${failures.join("; ")}` : ""}`);
}
xvfb?.kill();
server.close();
process.exit(bad ? 1 : 0);
