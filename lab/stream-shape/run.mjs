/**
 * HOL1: one stream, a pool of k, or a stream per frame, in Chromium through the relay. Every run
 * starts its own server and relay; the arms are rotated inside every round. lab/stream-shape/README.md
 *
 *   NODE_PATH=$(npm root -g) node lab/stream-shape/run.mjs --cell loss1 [--rounds 7]
 *     [--arms "shared per-frame pool:2 pool:4 pool:8"] [--depth shared=3,pool:2=3 | --depth 3]
 *     [--fill 40] [--asks 30] [--frame-bytes 131072] [--out rows.jsonl]
 *   ... --sweep 1-6 --rounds 3      the asks alone at each depth, no loss: each arm's D_min
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CELL = arg("--cell", "loss0");
const ROUNDS = Number(arg("--rounds", 7));
const ARMS = arg("--arms", "shared per-frame pool:2 pool:4 pool:8").split(" ");
const FILL = Number(arg("--fill", 40));
const ASKS = Number(arg("--asks", 30));
const FRAME = Number(arg("--frame-bytes", 131072));
const SWEEP = arg("--sweep", "");
const OUT = arg("--out", "");
const RTT = 80;
const LINK = ["--delay-ms", String(RTT / 2), "--rate-kbit", "20000", "--queue-pkts", "200"];
const CELLS = { loss0: [], loss1: ["--loss", "1"], loss3: ["--loss", "3"], burst: ["--loss-model", "ge"] };
if (!CELLS[CELL]) throw new Error(`unknown cell ${CELL}`);

/** `--depth 3` for every arm, or `arm=d,...` for each its own. */
function depthOf(arm) {
  const spec = arg("--depth", "3");
  if (!spec.includes("=")) return Number(spec);
  const d = Object.fromEntries(spec.split(",").map((kv) => kv.split("=")).map(([k, v]) => [k, Number(v)]))[arm];
  if (!d) throw new Error(`no depth for ${arm} in --depth ${spec}`);
  return d;
}

const T = fs.mkdtempSync(path.join(os.tmpdir(), "hol1-"));
const kids = new Set();
const start = (cmd, args, log) => {
  const k = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", fs.openSync(log, "w"), fs.openSync(log, "a")] });
  kids.add(k);
  return k;
};
const stop = async (k) => {
  k.kill();
  await new Promise((r) => (k.exitCode !== null ? r() : k.once("exit", r)));
  kids.delete(k);
};
process.on("exit", () => {
  for (const k of kids) k.kill();
  fs.rmSync(T, { recursive: true, force: true });
});
process.on("SIGTERM", () => process.exit(143));
process.on("SIGINT", () => process.exit(130));
const sh = (cmd) => execFileSync("bash", ["-c", cmd], { cwd: ROOT }).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = () => 30000 + ((Math.random() * 20000) | 0);
async function until(file, text, ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(text)) return;
    await sleep(50);
  }
  throw new Error(`${path.basename(file)} never said ${text}`);
}

execFileSync("cargo", ["build", "-q", "--release", "-p", "exact-server"], { cwd: ROOT });
execFileSync("cargo", ["build", "-q", "-p", "pack-study"], { cwd: ROOT });
execFileSync("bash", ["client/transport-ts/build.sh"], { cwd: ROOT, stdio: "ignore" });
const frames = FILL + ASKS;
fs.mkdirSync(`${T}/frames`);
for (let i = 0; i < frames; i++) fs.writeFileSync(`${T}/frames/${String(i).padStart(3, "0")}.htj2k`, crypto.randomBytes(FRAME));
fs.writeFileSync(`${T}/m.json`, JSON.stringify({ frameCount: frames }));
sh(`target/debug/pack-study --metadata ${T}/m.json --frames ${T}/frames --output ${T}/study.sbnd`);
sh(`openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout ${T}/key.pem -out ${T}/cert.pem \
  -days 2 -nodes -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null`);
const hash = sh(`openssl x509 -in ${T}/cert.pem -outform DER | openssl dgst -sha256 | awk '{print $2}'`);
const http = port();
start("python3", ["server/dev-server.py", "--port", String(http)], `${T}/http.log`);
await sleep(500);

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
  args: ["--disable-background-networking", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
});

async function one(round, arm, depth, fill) {
  const [srv, relayPort] = [port(), port()];
  const server = start("target/release/exact-server", ["--port", String(srv), "--bind", "127.0.0.1",
    "--study", `${T}/study.sbnd`, "--cert-pem", `${T}/cert.pem`, "--key-pem", `${T}/key.pem`,
    "--stream-mode", arm], `${T}/server.log`);
  const relay = start("python3", ["lab/scripts/link_impair.py", "--udp", `${relayPort}:${srv}`, "--seed", String(round),
    ...LINK, ...CELLS[CELL]], `${T}/relay.log`);
  try {
    await until(`${T}/server.log`, "wt_url=");
    await until(`${T}/relay.log`, "READY");
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${http}/lab/stream-shape/index.html`);
    await page.waitForFunction(() => globalThis.__ready);
    const r = await page.evaluate((a) => globalThis.runArm(a), {
      url: `https://127.0.0.1:${relayPort}/`, hash, fill, asks: ASKS, depth, limitMs: 300000,
    });
    await page.close();
    return { cell: CELL, round, arm, depth, ...r };
  } finally {
    await stop(relay);
    await stop(server);
  }
}

const rows = [];
const emit = (row) => {
  rows.push(row);
  if (OUT) fs.appendFileSync(OUT, JSON.stringify(row) + "\n");
};
const rotate = (list, k) => [...list.slice(k % list.length), ...list.slice(0, k % list.length)];

if (SWEEP) {
  const [lo, hi] = SWEEP.split("-").map(Number);
  for (let round = 1; round <= ROUNDS; round++) {
    for (const arm of rotate(ARMS, round)) {
      for (let depth = lo; depth <= hi; depth++) {
        const r = await one(round, arm, depth, 0);
        emit(r);
        console.log(`sweep round ${round} ${arm.padEnd(9)} depth ${depth}: ${(r.latencies.length / r.asksMs * 1000).toFixed(2)} asks/s`);
      }
    }
  }
} else {
  for (let round = 1; round <= ROUNDS; round++) {
    for (const arm of rotate(ARMS, round)) {
      const r = await one(round, arm, depthOf(arm), FILL);
      emit(r);
      const got = r.arrived.filter((t) => t !== null).length;
      console.log(`${CELL} round ${round} ${arm.padEnd(9)} d=${r.depth}: fill ${got}/${FILL} in ${r.fillMs.toFixed(0)} ms, ` +
        `asks ${r.latencies.length}/${ASKS} (${r.failures} failed) in ${r.asksMs.toFixed(0)} ms`);
    }
  }
}
await browser.close();
process.exit(0);
