// node browser_probe.mjs DIR FILE — serves make_samples.sh's DIR, builds FILE's frame table with ffprobe, runs browser_probe.html.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const { chromium } = createRequire(import.meta.url)("playwright");

const [dir, file] = process.argv.slice(2);
const pkts = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_packets", "-of", "json", join(dir, file)])).packets;
const skip = file.endsWith(".mkv") || file.endsWith(".webm") ? 4 : 0;
writeFileSync(join(dir, "table.json"), JSON.stringify({ file, frames: pkts.map(p => [Number(p.pos) + skip, Number(p.size)]) }));
copyFileSync(join(dirname(fileURLToPath(import.meta.url)), "browser_probe.html"), join(dir, "probe.html"));
const types = { ".html": "text/html", ".json": "application/json", ".mp4": "video/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska" };
const server = createServer((q, r) => {
  const p = join(dir, q.url.slice(1));
  let body;
  try { body = readFileSync(p); } catch { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { "content-type": types[p.slice(p.lastIndexOf("."))] ?? "application/octet-stream" });
  r.end(body);
}).listen(0);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/probe.html`);
await page.waitForFunction(() => document.title === "done", null, { timeout: 60000 });
const r = await page.evaluate(() => window.result);
const source = readFileSync(join(dir, "source.gray10le"));
const frameBytes = source.length / pkts.length;
const sourceDigests = pkts.map((_, i) => createHash("sha256").update(source.subarray(i * frameBytes, (i + 1) * frameBytes)).digest("hex"));
const exact = r.webcodecs_digests.filter((d, i) => d === sourceDigests[i]).length;
const first = new Uint16Array(source.buffer, source.byteOffset, frameBytes / 2);
const red = r.video_element.red ?? [];
console.log(JSON.stringify({
  mse_isTypeSupported: r.mse, webcodecs_isConfigSupported: r.webcodecs, error: r.error,
  webcodecs: { format: r.webcodecs_format, frames_exact: `${exact}/${pkts.length}` },
  video_element: red.length ? {
    readback: r.video_element.readback,
    source_levels: new Set(first).size, readback_levels: new Set(red).size,
    readback_range: [Math.min(...red), Math.max(...red)], source_range: [Math.min(...first), Math.max(...first)],
  } : r.video_element,
}, null, 1));
await browser.close(); server.close();
