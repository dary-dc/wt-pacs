/**
 * K1: what each client does when the server takes its CONNECT and never answers it
 * (`exact-server --hold-sessions`), all four clients dialling side by side, and the same four
 * against a server that answers, as the control. lab/dial-deadline/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/dial-deadline/run.mjs [cap ms]   [SERVER_ARGS="--keep-alive-interval-ms 5000"]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const CAP = Number(process.argv[2] || 60000);
const CLIENTS = ["raw", "ts", "wasm", "downloader"];
const T = fs.mkdtempSync(path.join(os.tmpdir(), "k1-"));
const CFG = path.join(ROOT, "client/dev-transport.json");
const CFG_BAK = fs.existsSync(CFG) ? fs.readFileSync(CFG) : null;
const kids = [];
const port = () => 30000 + ((Math.random() * 20000) | 0);
const start = (cmd, args) => kids.push(spawn(cmd, args, { cwd: ROOT, stdio: "ignore" }));
process.on("exit", () => {
  for (const k of kids) k.kill();
  if (CFG_BAK) fs.writeFileSync(CFG, CFG_BAK);
  else fs.rmSync(CFG, { force: true });
  fs.rmSync(T, { recursive: true, force: true });
});

execFileSync("cargo", ["build", "-q", "--release", "-p", "exact-server"], { cwd: ROOT });
execFileSync("bash", ["-c", `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout ${T}/key.pem \
  -out ${T}/cert.pem -days 2 -nodes -subj '/CN=localhost' -addext 'subjectAltName=IP:127.0.0.1' 2>/dev/null`]);
const hash = execFileSync("bash", ["-c", `openssl x509 -in ${T}/cert.pem -outform DER | openssl dgst -sha256 | awk '{print $2}'`])
  .toString().trim();
const http = port();
start("python3", ["server/dev-server.py", "--port", String(http)]);
const extra = (process.env.SERVER_ARGS || "").split(" ").filter(Boolean);
const servers = { held: port(), answered: port() };
for (const [name, p] of Object.entries(servers)) {
  start("target/release/exact-server", ["--port", String(p), "--bind", "127.0.0.1", "--study", "lab/fixtures/frames_250k/frames_250k.sbnd",
    "--cert-pem", `${T}/cert.pem`, "--key-pem", `${T}/key.pem`, ...extra, ...(name === "held" ? ["--hold-sessions"] : [])]);
}
await new Promise((r) => setTimeout(r, 1500));

const browser = await chromium.launch({ headless: true });
for (const [name, p] of Object.entries(servers)) {
  fs.writeFileSync(CFG, JSON.stringify({ wt_url: `https://127.0.0.1:${p}/`, cert_sha256: hash }) + "\n");
  const results = await Promise.all(CLIENTS.map(async (client) => {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${http}/lab/dial-deadline/index.html?client=${client}&cap=${CAP}`);
    await page.waitForFunction(() => globalThis.__result, null, { timeout: CAP + 30000, polling: 200 });
    const r = await page.evaluate(() => globalThis.__result);
    await page.close();
    return { client, ...r };
  }));
  for (const r of results) console.log(`${name.padEnd(8)} ${r.client.padEnd(10)} ${r.outcome.padEnd(8)} ${String(r.ms).padStart(6)} ms  ${r.reason ?? ""}`);
}
await browser.close();
process.exit(0);
