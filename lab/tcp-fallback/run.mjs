/**
 * TC1's loopback smoke: the same fill and asks through the downloader over WebTransport, a
 * WebSocket and the race, every frame hashed against its source, rounds interleaved.
 * Correctness only — loopback says nothing about which transport is faster. lab/tcp-fallback/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/tcp-fallback/run.mjs [rounds]
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const ROUNDS = Number(process.argv[2] || 3);
const ARMS = ["wt", "ws", "race"];
const FRAMES = 140;
const PLAN = { fill: 120, at: 20, during: [130, 135, 139], after: [0, 57, 119] };
const T = fs.mkdtempSync(path.join(os.tmpdir(), "tc1-"));
const kids = [];
const port = () => 30000 + ((Math.random() * 20000) | 0);
const sh = (cmd) => execFileSync("bash", ["-c", cmd], { cwd: ROOT }).toString().trim();
process.on("exit", () => {
  for (const k of kids) k.kill();
  fs.rmSync(T, { recursive: true, force: true });
});

execFileSync("cargo", ["build", "-q", "-p", "exact-server", "-p", "pack-study"], { cwd: ROOT });
execFileSync("bash", ["client/transport-ts/build.sh"], { cwd: ROOT, stdio: "ignore" });

// Sizes from 1 KB to ~600 KB, none a multiple of the server's 64 KiB message, so frames and
// messages never line up.
fs.mkdirSync(`${T}/frames`);
const expected = [];
for (let i = 0; i < FRAMES; i++) {
  const bytes = crypto.randomBytes(1000 + ((i * 7919) % 600_000));
  fs.writeFileSync(`${T}/frames/${String(i).padStart(3, "0")}.htj2k`, bytes);
  expected.push(crypto.createHash("sha256").update(bytes).digest("hex"));
}
fs.writeFileSync(`${T}/metadata.json`, JSON.stringify({ frameCount: FRAMES }));
sh(`target/debug/pack-study --metadata ${T}/metadata.json --frames ${T}/frames --output ${T}/study.sbnd`);
sh(`openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout ${T}/key.pem -out ${T}/cert.pem \
  -days 2 -nodes -subj '/CN=localhost' -addext 'extendedKeyUsage=serverAuth' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null`);
const hash = sh(`openssl x509 -in ${T}/cert.pem -outform DER | openssl dgst -sha256 | awk '{print $2}'`);
// A WebSocket cannot pin by hash: Chromium trusts this one key instead.
const spki = sh(`openssl x509 -in ${T}/cert.pem -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256 -binary | base64`);

const wt = port();
const http = port();
kids.push(spawn("target/debug/exact-server", ["--port", String(wt), "--bind", "127.0.0.1", "--websocket",
  "--study", `${T}/study.sbnd`, "--cert-pem", `${T}/cert.pem`, "--key-pem", `${T}/key.pem`], { cwd: ROOT, stdio: "ignore" }));
kids.push(spawn("python3", ["server/dev-server.py", "--port", String(http)], { cwd: ROOT, stdio: "ignore" }));
await new Promise((r) => setTimeout(r, 1500));

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
  args: [`--ignore-certificate-errors-spki-list=${spki}`],
});
let failed = 0;
const want = { fill: PLAN.fill, during: PLAN.during.length, after: PLAN.after.length, duplicates: 0 };
console.log(`round arm    fill   during after  duplicates   (bit-exact of ${JSON.stringify(want)})`);
for (let round = 1; round <= ROUNDS; round++) {
  const order = [...ARMS.slice(round % ARMS.length), ...ARMS.slice(0, round % ARMS.length)];
  for (const arm of order) {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${http}/lab/tcp-fallback/index.html`);
    await page.waitForFunction(() => globalThis.__ready);
    const r = await page.evaluate((args) => globalThis.runArm(args), {
      arm, url: `https://127.0.0.1:${wt}/`, hash, expected, ...PLAN,
    });
    await page.close();
    const ok = Object.entries(want).every(([k, v]) => r[k] === v);
    if (!ok) failed += 1;
    console.log(`${round}     ${arm.padEnd(6)} ${String(r.fill).padEnd(6)} ${String(r.during).padEnd(6)} ${String(r.after).padEnd(6)} ${r.duplicates}${ok ? "" : "   FAIL"}`);
  }
}
await browser.close();
console.log(failed ? `\n${failed} run(s) not bit-exact` : `\nevery frame bit-exact on every arm, ${ROUNDS} rounds`);
process.exit(failed ? 1 : 0);
