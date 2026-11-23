// The engine's half of navigation-memory.mjs, with none of the product: a worker makes 50 buffers of 17 MB, the page
// (or the worker) holds them, the page navigates. docs/client/evidence/navigation-memory.md
//
//   NODE_PATH=$(npm root -g) node lab/viewer/navigation-memory-minimal.mjs sab|ab main|worker
import { createServer } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
const KIND = process.argv[2];
const HOLD = process.argv[3] ?? "main";
const page = `<!doctype html><script type=module>
const w = new Worker("/w.js");
const held = [];
w.onmessage = ({data}) => { if (data === "done") { document.title = "ready"; return; } held.push(data); };
w.postMessage({ kind: "${KIND}", hold: "${HOLD}" });
</script>`;
const worker = `onmessage = ({data}) => { const keep = [];
 for (let i = 0; i < 50; i++) { const b = data.kind === "sab" ? new SharedArrayBuffer(17e6) : new ArrayBuffer(17e6); new Uint8Array(b).fill(i + 1);
   if (data.hold === "worker") keep.push(b); else postMessage(b, data.kind === "ab" ? [b] : []); }
 self.keep = keep; postMessage("done"); };`;
const iso = { "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp" };
const srv = createServer((q, r) => {
  if (q.url.startsWith("/w.js")) { r.writeHead(200, { ...iso, "content-type": "text/javascript" }); return r.end(worker); }
  if (q.url.startsWith("/next")) { r.writeHead(302, { location: `/?k=${Date.now()}` }); return r.end(); }
  r.writeHead(200, { ...iso, "content-type": "text/html" }); r.end(page);
}).listen(8790);
const pss = () => readdirSync("/proc").filter(d => /^\d+$/.test(d)).flatMap(pid => { try { const c = readFileSync(`/proc/${pid}/cmdline`, "utf8"); if (!c.includes("--type=renderer")) return []; return [Math.round(Number(readFileSync(`/proc/${pid}/smaps_rollup`, "utf8").match(/^Pss:\s+(\d+)/m)[1]) / 1024)]; } catch { return []; } });
const { chromium } = createRequire(import.meta.url)("playwright");
const b = await chromium.launch(); const p = await b.newPage();
await p.goto("http://127.0.0.1:8790/");
const out = [];
for (let k = 0; k < 5; k++) { await p.waitForFunction(() => document.title === "ready"); await p.waitForTimeout(1500); out.push(pss().join("+"));
  await p.evaluate(() => location.assign("/next")); await p.waitForTimeout(300); }
console.log(KIND, HOLD, out.join(" -> "), "MiB");
await b.close(); srv.close();
