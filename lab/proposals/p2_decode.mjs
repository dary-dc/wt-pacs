// P2's decode cell (docs/lines/proposals.md §P2, amendment 1): one fresh headless Chromium; on the page, the product's
// client/decode/av1.js decodes every frame of one series in order, one at a time, each timed around decodeFrame.
//
//   node lab/proposals/p2_decode.mjs TIP FRAMES_DIR METADATA     prints one JSON row; ms on the page's clock
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const [tip, frames, metaPath] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(metaPath));
const files = readdirSync(frames).filter((f) => f.endsWith(".av1")).sort();
const PORT = 8790;
// Cross-origin isolated, as the viewer is served: the decoders' pictures are SharedArrayBuffers.
const SERVE = `import http.server as h
class H(h.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin"); self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()
    def log_message(self, *a): pass
h.ThreadingHTTPServer(("127.0.0.1", ${PORT}), lambda *a: H(*a, directory="/")).serve_forever()`;
const host = spawn("python3", ["-c", SERVE], { stdio: "ignore" });
process.on("exit", () => host.kill("SIGKILL"));
const browser = await createRequire(import.meta.url)("playwright").chromium.launch();
const row = { frames: files.length, g: meta.lossy.g };
try {
  const page = await browser.newPage();
  for (let t = Date.now(); Date.now() - t < 10000; await new Promise((r) => setTimeout(r, 100))) {
    if (await page.goto(`http://127.0.0.1:${PORT}${tip}/client/decode/`).then(() => true, () => false)) break;
  }
  Object.assign(row, await page.evaluate(async ({ tip, frames, files, g, width, height }) => {
    const av1 = await import(`${tip}/client/decode/av1.js`);
    await av1.init({ groupLength: g, lossy: true });
    const ms = [];
    const wrong = [];
    for (let i = 0; i < files.length; i++) {
      const bytes = new Uint8Array(await (await fetch(`${frames}/${files[i]}`)).arrayBuffer());
      const t = performance.now();
      const p = await av1.decodeFrame(bytes, { key: i % g === 0, gen: 0, index: i });
      ms.push(performance.now() - t);
      if (p.path !== "av1-webcodecs" || p.info.width !== width || p.info.height !== height) wrong.push({ i, path: p.path, refusal: p.refusal, ...p.info });
    }
    return { ms: ms.map((x) => Math.round(x * 10) / 10), wrong };
  }, { tip, frames, files, g: meta.lossy.g, width: meta.columns ?? meta.width, height: meta.rows ?? meta.height }));
} catch (e) {
  row.error = e.message;
} finally {
  await browser.close();
}
console.log(JSON.stringify(row));
process.exit(0);
