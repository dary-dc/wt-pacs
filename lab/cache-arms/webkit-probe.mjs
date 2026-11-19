// cache-plan.md §8.6: what WebKitGTK offers the four arms, over WebKitWebDriver (under Xvfb):
//   node lab/cache-arms/webkit-probe.mjs [--out rows.jsonl]
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { own, staticHost, started } from "../opfs-cache/browser.mjs";

const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
const BROWSER = "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser";
const PORT = 4444 + Math.floor(Math.random() * 1000);

const origin = await staticHost();
const driver = own("WebKitWebDriver", [`--port=${PORT}`]);
await Promise.race([started(driver, "stdout", /./), new Promise((r) => setTimeout(r, 2000))]);

const call = async (method, path, body) => {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { "content-type": "application/json" },
    body: body && JSON.stringify(body) });
  const j = await r.json();
  if (j.value?.error) throw new Error(`${j.value.error}: ${j.value.message}`);
  return j.value;
};

const { sessionId } = await call("POST", "/session", { capabilities: { alwaysMatch: {
  "webkitgtk:browserOptions": { binary: BROWSER, args: ["--automation"] } } } });
const s = `/session/${sessionId}`;
await call("POST", `${s}/url`, { url: `${origin}/lab/cache-arms/blank.html` });
const page = await call("POST", `${s}/execute/async`, { args: [], script: `
  const done = arguments[arguments.length - 1];
  const w = new Worker("probe-worker.js");
  w.onmessage = (e) => done({ crossOriginIsolated: self.crossOriginIsolated, pageSharedArrayBuffer: typeof SharedArrayBuffer === "function", worker: e.data });
  w.onerror = (e) => done({ crossOriginIsolated: self.crossOriginIsolated, worker: { error: String(e.message) } });` });
await call("DELETE", s);

const version = execFileSync("dpkg-query", ["-W", "-f", "${Version}", "libwebkit2gtk-4.1-0"]).toString();
const row = JSON.stringify({ probe: true, engine: "webkitgtk", libwebkit2gtk: version, at: new Date().toISOString(), ...page });
console.log(row);
if (out) appendFileSync(out, row + "\n");
process.exit(0);
