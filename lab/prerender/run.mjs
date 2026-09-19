/**
 * S20: does a worker start, and does a WebTransport session dial, while `document.prerendering`?
 * Loads the referrer, lets its Speculation Rules prerender the target, then activates it and
 * reads what the target recorded. lab/prerender/README.md.
 *
 *   NODE_PATH=$(npm root -g) node lab/prerender/run.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const port = () => 30000 + ((Math.random() * 20000) | 0);
const [WT, HTTP] = [port(), port()];
const T = fs.mkdtempSync(path.join(os.tmpdir(), "o1-"));
const CFG = path.join(ROOT, "client/dev-transport.json");
const CFG_BAK = fs.existsSync(CFG) ? fs.readFileSync(CFG) : null;
const kids = [];
process.on("exit", () => {
  for (const k of kids) k.kill();
  if (CFG_BAK) fs.writeFileSync(CFG, CFG_BAK);
  fs.rmSync(T, { recursive: true, force: true });
});

execFileSync("cargo", ["build", "-q", "-p", "exact-server", "-p", "pack-study"], { cwd: ROOT });
const BIN = path.join(ROOT, process.env.CARGO_TARGET_DIR || "target", "debug");
execFileSync("bash", ["-c", `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -keyout ${T}/key.pem -out ${T}/cert.pem -days 2 -nodes -subj '/CN=localhost' \
  -addext 'basicConstraints=critical,CA:FALSE' -addext 'keyUsage=critical,digitalSignature' \
  -addext 'extendedKeyUsage=serverAuth' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null`]);
const hash = execFileSync("bash", [
  "-c",
  `openssl x509 -in ${T}/cert.pem -outform DER | openssl dgst -sha256 | awk '{print $2}'`,
]).toString().trim();
fs.mkdirSync(path.join(T, "frames"));
for (let i = 0; i < 4; i++) {
  fs.writeFileSync(path.join(T, "frames", `${String(i).padStart(3, "0")}.htj2k`), Buffer.alloc(16384, i + 1));
}
fs.writeFileSync(path.join(T, "metadata.json"), JSON.stringify({ frameCount: 4 }));
execFileSync(path.join(BIN, "pack-study"), [
  "--metadata", path.join(T, "metadata.json"),
  "--frames", path.join(T, "frames"),
  "--output", path.join(T, "study.sbnd"),
]);
kids.push(spawn(path.join(BIN, "exact-server"), [
  "--port", String(WT), "--study", path.join(T, "study.sbnd"),
  "--cert-pem", path.join(T, "cert.pem"), "--key-pem", path.join(T, "key.pem"),
], { cwd: ROOT, stdio: "ignore" }));
kids.push(spawn("python3", ["server/dev-server.py", "--port", String(HTTP)], { cwd: ROOT, stdio: "ignore" }));
fs.writeFileSync(CFG, JSON.stringify({ wt_url: `https://127.0.0.1:${WT}/`, cert_sha256: hash }) + "\n");
await new Promise((r) => setTimeout(r, 2000));

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || chromium.executablePath(),
  // Prerender is off in headless unless the feature is asked for by name.
  args: ["--enable-features=Prerender2,SpeculationRulesPrerenderingTarget"],
});
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${HTTP}/lab/prerender/index.html`);
// Give the speculation rule time to run before the click that activates it.
await new Promise((r) => setTimeout(r, 4000));
await page.click("#go");
await page.waitForFunction(() => globalThis.__wtpacsDone, null, { timeout: 60000 });
const out = await page.evaluate(() => globalThis.__wtpacsPrerender);
await browser.close();

const yes = (v) => (v === null ? "not reached" : v ? "yes" : "no");
console.log(`
prerendered at load      ${yes(out.prerenderingAtLoad)}
activation seen          ${out.activatedMs === null ? "no" : `${out.activatedMs.toFixed(0)} ms`}
worker started           ${out.worker === null ? "no" : `${out.worker.toFixed(0)} ms`}, while prerendering: ${yes(out.workerWhilePrerendering)}
session dialled          ${out.session === null ? "no" : `${out.session.toFixed(0)} ms`}, while prerendering: ${yes(out.sessionWhilePrerendering)}
session error            ${out.sessionError ?? "none"}`);
process.exit(0);
