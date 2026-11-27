/**
 * The grey path protocol's Firefox check: one untimed round of every set through the product's default config in a
 * fresh headless Firefox, which has no driver here, so index.html?firefox posts its rows back. README.md here
 *
 *   FIREFOX_PATH=.../FirefoxApp/firefox node lab/av1/decode/grey-path/firefox.mjs [--frames lab/.av1-work/grey-path/frames] [--out ff.json]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FRAMES = arg("--frames", "lab/.av1-work/grey-path/frames");
const ROOT = new URL("../../../..", import.meta.url).pathname;
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".html": "text/html", ".json": "application/json" };
const HEADERS = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin", "Cache-Control": "no-store" };

let done;
const posted = new Promise((r) => (done = r));
const server = createServer((req, res) => {
  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { res.writeHead(200, HEADERS).end(); done(JSON.parse(body)); });
    return;
  }
  const path = join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  try {
    if (!statSync(path).isFile()) throw new Error();
    res.writeHead(200, { ...HEADERS, "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(readFileSync(path));
  } catch {
    res.writeHead(404, HEADERS).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/lab/av1/decode/grey-path/index.html?firefox&frames=${encodeURIComponent(FRAMES)}`;
const profile = mkdtempSync(join(tmpdir(), "grey-path-ff-"));
writeFileSync(join(profile, "user.js"), [["browser.shell.checkDefaultBrowser", false], ["app.update.disabledForTesting", true],
  ["datareporting.policy.dataSubmissionEnabled", false], ["toolkit.telemetry.reportingpolicy.firstRun", false]]
  .map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join("\n"));
const ff = spawn(process.env.FIREFOX_PATH, ["--headless", "--no-remote", "--profile", profile, url], { stdio: "ignore" });
const got = await posted;
ff.kill();
rmSync(profile, { recursive: true, force: true });
const version = (await new Promise((r) => {
  const v = spawn(process.env.FIREFOX_PATH, ["--version"]);
  let s = "";
  v.stdout.on("data", (c) => (s += c));
  v.on("close", () => r(s.trim()));
}));
const out = arg("--out", null);
if (out) writeFileSync(out, JSON.stringify({ version, ...got }));
for (const r of got.rows) {
  const frames = [r.warm, ...r.frames].filter(Boolean);
  const ok = frames.filter((f) => f.path === "av1-dav1d" && f.digest && f.sha && !f.mismatchOn).length;
  const paths = [...new Set(frames.map((f) => f.path))].join(",");
  console.log(`${r.set} ${r.arm}: ${ok} of ${frames.length} on av1-dav1d and exact; paths ${paths}${r.error ? `; ${r.error}` : ""}`);
}
console.log(`${version}; ${got.userAgent}; cross-origin isolated ${got.isolated}`);
server.close();
process.exit(0);
