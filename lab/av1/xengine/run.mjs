/**
 * XENGINE: each engine variant a fresh browser opening page.js, which probes every layout and posts what
 * came back. lab/av1/xengine/README.md
 *
 *   node lab/av1/xengine/run.mjs [--variants chromium,firefox,...] [--frames lab/.av1-work/xengine] [--mutate] [--out rows.json]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FRAMES = arg("--frames", "lab/.av1-work/xengine");
const MUTATE = process.argv.includes("--mutate");
const OUT = arg("--out", null);
const ROOT = new URL("../../..", import.meta.url).pathname;
const DISPLAY = ":78";
const MINIBROWSER = process.env.MINIBROWSER_PATH ?? "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser";

const firefox = (prefs) => (url, dir) => {
  writeFileSync(join(dir, "user.js"), [
    ["browser.shell.checkDefaultBrowser", false], ["browser.aboutwelcome.enabled", false],
    ["datareporting.policy.dataSubmissionEnabled", false], ["browser.startup.homepage_override.mstone", "ignore"],
    ["app.update.disabledForTesting", true], ["toolkit.telemetry.reportingpolicy.firstRun", false], ...prefs,
  ].map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join("\n"));
  return [process.env.FIREFOX_PATH, ["--headless", "--no-remote", "--profile", dir, url]];
};
// GST_PLUGIN_DAV1D: a directory holding gst-plugin-dav1d's libgstdav1d.so, ranked above libaom's av1dec.
const dav1d = { GST_PLUGIN_PATH: process.env.GST_PLUGIN_DAV1D ?? "", GST_PLUGIN_FEATURE_RANK: "dav1ddec:MAX" };
const VARIANTS = {
  chromium: (url, dir) => [process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${dir}`, url]],
  firefox: firefox([]),
  "firefox-nordd": firefox([["media.rdd-process.enabled", false]]),
  "firefox-noffvpx": firefox([["media.rdd-ffvpx.enabled", false]]),
  webkit: (url) => [MINIBROWSER, [url], { JSC_useSharedArrayBuffer: "1" }],
  "webkit-dav1d": (url) => [MINIBROWSER, [url], { JSC_useSharedArrayBuffer: "1", ...dav1d }],
};
const NAMES = arg("--variants", Object.keys(VARIANTS).join(",")).split(",");

const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html", ".json": "application/json" };
let cell = null;
const server = createServer((req, res) => {
  const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cache-Control": "no-store" };
  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const m = JSON.parse(body || "{}");
      res.writeHead(200, { ...headers, "Content-Type": "application/json" });
      if (req.url === "/xe/hello") (cell.caps = m), res.end(JSON.stringify({ frames: FRAMES, mutate: MUTATE }));
      else res.end("{}"), cell.done(m);
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
const URL_ = `http://127.0.0.1:${server.address().port}/lab/av1/xengine/index.html`;
const xvfb = spawn("Xvfb", [DISPLAY, "-screen", "0", "1280x800x24", "-nolisten", "tcp"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1000));

const results = {};
for (const name of NAMES) {
  const dir = mkdtempSync(join(tmpdir(), "xe-"));
  const [bin, args, extra] = VARIANTS[name](URL_, dir);
  const proc = spawn(bin, args, { env: { ...process.env, DISPLAY, WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS: "1", MOZ_CRASHREPORTER_DISABLE: "1", ...extra },
    stdio: ["ignore", "ignore", "pipe"], detached: true });
  let stderr = "";
  proc.stderr.on("data", (c) => (stderr = (stderr + c).slice(-3000)));
  const r = await new Promise((resolve) => {
    cell = { done: resolve };
    setTimeout(() => resolve({ error: `no result in 5 min; stderr: ${stderr}` }), 5 * 60 * 1000);
    proc.on("exit", (code) => setTimeout(() => resolve({ error: `exited ${code}; stderr: ${stderr}` }), 2000));
  });
  try { process.kill(-proc.pid, "SIGKILL"); } catch { proc.kill("SIGKILL"); }
  await new Promise((res) => setTimeout(res, 500));
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch {}
  results[name] = { ua: cell.caps?.ua, ...r };
  console.log(`\n${name}: ${cell.caps?.ua ?? ""}${r.error ? `\n  ERROR ${r.error}` : ""}`);
  for (const row of r.rows ?? []) {
    const copies = Object.entries(row.copies).map(([k, c]) => `${k} ${c.exact}/${row.frames}${c.why ? ` (${c.why})` : ""}`).join("; ");
    console.log(`  ${row.layout} ${row.string} ${row.codec} supported ${row.supported}: ` +
      (row.error ? row.error : `${row.format} ${row.coded} ${row.colour} — ${copies}`));
  }
}
xvfb.kill();
server.close();
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 1));
process.exit(0);
