// I1's protocol (docs/lines/proposals.md §I1, claude/oq-integrity): each optimal-quality series of DIR filled in headless
// Chromium with its reconstruction check on (its metadata as written) and off (the same metadata without
// `lossy.reconstruction`), the arms and the CPU throttles interleaved per round by lab/order.mjs. One JSON row per fill.
//
//   node lab/oq-integrity/run.mjs DIR OUT.jsonl [--rounds 7] [--throttles 1,4] [--ids a,b] [--arms on,off] [--route dav1d]
//     DIR as `INTEGRITY=1 scripts/demo-series.sh DIR` wrote it; --route dav1d hides VideoDecoder from the page's workers
import { spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { order } from "../order.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const [dir, out] = process.argv.slice(2);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg("--rounds", 7));
const THROTTLES = arg("--throttles", "1,4").split(",").map(Number);
const ARMS = arg("--arms", "on,off").split(",");
const DAV1D = arg("--route") === "dav1d";
const ids = arg("--ids")?.split(",") ?? readdirSync(dir).filter((f) => /-q\d+-g\d+(-cut)?\.metadata\.json$/.test(f)).map((f) => f.replace(".metadata.json", ""));
const T = mkdtempSync(path.join(tmpdir(), "oq-integrity-"));
const children = [];
const stop = () => { for (const c of children.splice(0)) c.kill("SIGKILL"); };
process.on("exit", () => { stop(); rmSync(T, { recursive: true, force: true }); });

const started = (child, re) => new Promise((resolve, reject) => {
  let text = "";
  const read = (d) => { text += d; if (re.test(text)) resolve(); };
  child.stdout.on("data", read);
  child.stderr.on("data", read);
  child.once("exit", (c) => reject(new Error(`exited ${c}: ${text}`)));
});
const run = (cmd, args) => {
  const child = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  return child;
};

/** README §Demo's servers for series `id`, and one static host per arm: 8765 serves the metadata as written, 8766 without the check. */
async function serve(id) {
  stop();
  const meta = JSON.parse(readFileSync(path.join(dir, `${id}.metadata.json`)));
  const { reconstruction, ...lossy } = meta.lossy;
  if (!reconstruction) throw new Error(`${id}: no lossy.reconstruction: INTEGRITY=1 scripts/demo-series.sh`);
  writeFileSync(`${T}/off.json`, JSON.stringify({ ...meta, lossy }));
  const cert = ["--cert-pem", "server/dev-cert/cert.pem", "--key-pem", "server/dev-cert/key.pem"];
  const server = path.join(process.env.CARGO_TARGET_DIR || "target", "release/series-server");
  const lossyServer = run(server, ["--port", "4433", "--series", path.join(dir, `${id}.sbnd`), ...cert]);
  const exact = run(server, ["--port", "4434", "--series", path.join(dir, `${meta.exactSeries}.sbnd`), ...cert]);
  writeFileSync(`${T}/exact-transport.json`, readFileSync(path.join(ROOT, "client/dev-transport.json"), "utf8").replace(":4433", ":4434"));
  const host = (port, file) => run("python3", ["server/dev-server.py", "--port", String(port), "--metadata", file,
    "--exact-metadata", path.join(dir, `${meta.exactSeries}.metadata.json`), "--exact-transport", `${T}/exact-transport.json`]);
  const on = host(8765, path.join(dir, `${id}.metadata.json`));
  const off = host(8766, `${T}/off.json`);
  await Promise.all([started(lossyServer, /transport=/), started(exact, /transport=/), started(on, /port=8765/), started(off, /port=8766/)]);
  return meta;
}

/** Every write to the overlay and the status line, timed on the page's clock from its navigation. */
function watch() {
  globalThis.__log = [];
  addEventListener("DOMContentLoaded", () => {
    for (const id of ["overlay", "status"]) {
      const el = document.getElementById(id);
      new MutationObserver(() => globalThis.__log.push({ t: performance.now(), id, text: el.textContent }))
        .observe(el, { childList: true, characterData: true, subtree: true });
    }
  });
}

/** One fill: its time from the status line, the first picture from the first overlay write, and every frame's outcome. */
async function fill(browser, arm, throttle) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(watch);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  await page.goto(`http://127.0.0.1:${arm === "on" ? 8765 : 8766}/?overlay=1&view=page`);
  const status = () => page.evaluate(() => globalThis.__log.findLast((e) => e.id === "status")?.text ?? "");
  for (const end = Date.now() + 300000; Date.now() < end && !/fill \d+ ms/.test(await status()); ) await page.waitForTimeout(50);
  const log = await page.evaluate(() => globalThis.__log);
  await page.close();
  const s = log.findLast((e) => e.id === "status")?.text ?? "";
  const n = (re) => Number(s.match(re)?.[1] ?? NaN);
  return {
    fillMs: n(/fill (\d+) ms/), firstPictureMs: Math.round(log.find((e) => e.id === "overlay" && e.text)?.t ?? NaN),
    received: n(/received (\d+)/), asCoded: n(/as coded (\d+)/), unchecked: n(/unchecked (\d+)/),
    paths: s.match(/decoders: ([^·]*)/)?.[1].trim(), errors: [...errors, ...(s.match(/error: .*/g) ?? [])],
  };
}

const args = DAV1D ? ["--disable-blink-features=WebCodecs"] : [];
const browser = await createRequire(import.meta.url)("playwright").chromium.launch({ args });
const cells = THROTTLES.flatMap((throttle) => ARMS.map((arm) => ({ arm, throttle })));
try {
  for (const id of ids) {
    const meta = await serve(id);
    for (let round = 0; round < ROUNDS; round++) {
      for (const [k, { arm, throttle }] of order(cells, round).entries()) {
        const r = await fill(browser, arm, throttle);
        const row = { id, frames: meta.frameCount, g: meta.lossy.g, route: DAV1D ? "dav1d" : "default", round, position: k, arm, throttle, ...r };
        appendFileSync(out, JSON.stringify(row) + "\n");
        console.log(`${id} r${round} ${arm} ${throttle}x fill ${r.fillMs} ms first ${r.firstPictureMs} ms as coded ${r.asCoded}/${r.received} ${r.paths} ${r.errors.join("; ").slice(0, 120)}`);
      }
    }
  }
} finally {
  await browser.close();
}
